import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, accountKey } from "../src/store.js";
import { Broker } from "../src/broker.js";
import { demoCredential, demoSite, startDemo } from "../src/demo.js";
let dir: string;
let store: Store;
let broker: Broker;
let demo: Awaited<ReturnType<typeof startDemo>>;
const oldMode = process.env.RELAY_KEY_MODE;
const oldPass = process.env.RELAY_PASSPHRASE;
beforeAll(async () => {
  process.env.RELAY_KEY_MODE = "passphrase";
  process.env.RELAY_PASSPHRASE =
    "test-only-passphrase-never-use-for-real-accounts";
  dir = await mkdtemp(join(tmpdir(), "relay-tests-"));
  store = await new Store(dir).open();
  demo = await startDemo(0);
  broker = new Broker(store);
  const site = demoSite(demo.port);
  await store.update((s) => {
    s.ready = true;
    s.accounts[accountKey(site.id, site.identity)] = {
      site,
      binding: { provider: "local" },
      credential: demoCredential,
    };
  });
});
afterAll(async () => {
  await broker?.close();
  store?.close();
  if (demo) await new Promise<void>((r) => demo.server.close(() => r()));
  if (dir) await rm(dir, { recursive: true, force: true });
  if (oldMode === undefined) delete process.env.RELAY_KEY_MODE;
  else process.env.RELAY_KEY_MODE = oldMode;
  if (oldPass === undefined) delete process.env.RELAY_PASSPHRASE;
  else process.env.RELAY_PASSPHRASE = oldPass;
});
describe("real browser authentication", () => {
  it("signs in with a password and TOTP without returning secrets", async () => {
    const result = await broker.ensureLogin("relay-demo");
    expect(result.status).toBe("AUTHENTICATED");
    expect(result.reused).toBe(false);
    expect(JSON.stringify(result)).not.toContain(demoCredential.password);
    const encrypted = await readFile(join(dir, "vault.enc"), "utf8");
    expect(encrypted).not.toContain(demoCredential.password);
    expect(encrypted).not.toContain(demoCredential.totpSecret);
    expect(encrypted).not.toContain("session");
  });
  it("restores its encrypted session after a process-style restart", async () => {
    await broker.close();
    store.close();
    store = await new Store(dir).open();
    broker = new Broker(store);
    const result = await broker.ensureLogin("relay-demo");
    expect(result.status).toBe("AUTHENTICATED");
    expect(result.reused).toBe(true);
  });
  it("renews an invalidated session and deduplicates concurrent sign-ins", async () => {
    demo.expire();
    const results = await Promise.all([
      broker.ensureLogin("relay-demo"),
      broker.ensureLogin("relay-demo"),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].status).toBe("AUTHENTICATED");
    expect(results[0].reused).toBe(false);
  });
  it("reads an allowed task page and refuses arbitrary URLs", async () => {
    const result = await broker.readPage(
      "relay-demo",
      "business",
      `http://127.0.0.1:${demo.port}/account`,
    );
    expect(result).toHaveProperty("text");
    expect(JSON.stringify(result)).toContain("Demo supplier catalog");
    const denied = await broker.readPage(
      "relay-demo",
      "business",
      "https://evil.example/",
    );
    expect(denied).toHaveProperty("reason", "TASK_PAGE_NOT_ALLOWED");
  });
  it("returns BLOCKED for human verification without bypassing it", async () => {
    demo.expire();
    demo.challenge(true);
    const result = await broker.ensureLogin("relay-demo");
    expect(result).toMatchObject({
      status: "BLOCKED",
      reason: "HUMAN_VERIFICATION_REQUIRED",
    });
    demo.challenge(false);
  });
  it("returns a safe result for an unenrolled site", async () => {
    expect(await broker.ensureLogin("unrecognized")).toMatchObject({
      status: "BLOCKED",
      reason: "ACCOUNT_NOT_ENROLLED",
    });
  });
  it("opens an owner-configured sign-in dialog and renews its session", async () => {
    const site = demoSite(demo.port);
    site.id = "modal-demo";
    site.login.url = `http://127.0.0.1:${demo.port}/modal-login`;
    site.login.open = "#open-login";
    await store.update((s) => {
      s.accounts[accountKey(site.id, site.identity)] = {
        site,
        binding: { provider: "local" },
        credential: structuredClone(demoCredential),
      };
    });
    expect(await broker.ensureLogin(site.id)).toMatchObject({
      status: "AUTHENTICATED",
      reused: false,
    });
    expect(await broker.ensureLogin(site.id)).toMatchObject({
      status: "AUTHENTICATED",
      reused: true,
    });
    demo.expire();
    expect(await broker.ensureLogin(site.id)).toMatchObject({
      status: "AUTHENTICATED",
      reused: false,
    });
  });
  it("does not open a sign-in dialog when a human challenge is present", async () => {
    demo.expire();
    demo.challenge(true);
    try {
      expect(await broker.ensureLogin("modal-demo")).toMatchObject({
        status: "BLOCKED",
        reason: "HUMAN_VERIFICATION_REQUIRED",
      });
    } finally {
      demo.challenge(false);
    }
  });
  it("recovers the previous password if a pending reset never reached the website", async () => {
    demo.expire();
    await store.update((s) => {
      s.accounts["relay-demo:business"].pendingPassword =
        "never-accepted-by-the-site";
    });
    const result = await broker.ensureLogin("relay-demo");
    expect(result.status).toBe("AUTHENTICATED");
    expect(
      store.state.accounts["relay-demo:business"].pendingPassword,
    ).toBeUndefined();
    expect(
      store.state.accounts["relay-demo:business"].credential?.password,
    ).toBe(demoCredential.password);
  });
  it("serializes updates without losing concurrent changes", async () => {
    await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        store.audit(`event_${i}`, "COMPLETE"),
      ),
    );
    expect(
      store.state.audit.filter((a) => a.action.startsWith("event_")).length,
    ).toBe(15);
  });
});
