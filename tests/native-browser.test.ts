import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store, hashToken, type ClientGrant } from "../src/store.js";
import { NativeBrowser } from "../src/native-browser.js";
let store: Store;
let browser: NativeBrowser;
let dir: string;
let companion: string;
const password = "Test-only-shared-password-32!";
const email = "fixture@relay.test";
const origin = "https://employer.example";
const oldMode = process.env.RELAY_KEY_MODE;
const oldPass = process.env.RELAY_PASSPHRASE;
const client: ClientGrant = {
  id: "dot",
  name: "Fixture Dot",
  tokenHash: hashToken("fixture-client-token"),
  accounts: [],
  operations: ["fill_saved_password", "fill_saved_username", "fill_saved_totp"],
  createdAt: new Date().toISOString(),
};
beforeAll(async () => {
  process.env.RELAY_KEY_MODE = "passphrase";
  process.env.RELAY_PASSPHRASE =
    "test-only-passphrase-never-use-for-real-accounts";
  dir = await mkdtemp(join(tmpdir(), "relay-native-"));
  store = await new Store(dir).open();
});
beforeEach(async () => {
  browser?.close();
  browser = new NativeBrowser(store);
  await store.update((s) => {
    s.ready = true;
    s.clients = [structuredClone(client)];
    s.sharedCredential = { username: email, password, recoveryCodes: [] };
    s.sharedSignup = false;
    s.browserCompanions = [];
  });
  const paired = await browser.pair(browser.ticket().code);
  companion = browser.authenticate(paired.token)!;
});
afterAll(async () => {
  browser?.close();
  store?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
  if (oldMode === undefined) delete process.env.RELAY_KEY_MODE;
  else process.env.RELAY_KEY_MODE = oldMode;
  if (oldPass === undefined) delete process.env.RELAY_PASSPHRASE;
  else process.env.RELAY_PASSPHRASE = oldPass;
});
function focus(
  tabId = 1,
  kind: "password" | "username" | "totp" = "password",
  targetOrigin = origin,
) {
  const nonce = randomUUID();
  browser.focus(companion, {
    tabId,
    frameId: 0,
    origin: targetOrigin,
    nonce,
    kind,
  });
  return nonce;
}
describe("private native browser autofill", () => {
  it("distinguishes a saved credential from a paired, online browser and matching focus", async () => {
    await browser.revokeCompanion(companion);
    const fill = () =>
      browser.fill(
        client,
        undefined,
        "business",
        "username",
        undefined,
        origin,
      );
    expect(browser.readiness()).toEqual({
      status: "BLOCKED",
      reason: "BROWSER_COMPANION_NOT_PAIRED",
    });
    expect(await fill()).toEqual(browser.readiness());
    const paired = await browser.pair(browser.ticket().code);
    expect(browser.readiness()).toEqual({
      status: "BLOCKED",
      reason: "BROWSER_COMPANION_OFFLINE",
    });
    expect(await fill()).toEqual(browser.readiness());
    companion = browser.authenticate(paired.token)!;
    expect(browser.readiness()).toEqual({ status: "READY_TO_FILL" });
    expect(await fill()).toHaveProperty("reason", "NO_MATCHING_FOCUSED_FIELD");
    focus(1, "username");
    const result = fill();
    const delivery = await browser.poll(companion);
    browser.complete(companion, delivery.command!.id, "FILLED");
    expect(await result).toHaveProperty("status", "FILLED");
  });
  it("uses one password for different HTTPS sites and returns no secret to the Dot", async () => {
    for (const targetOrigin of [origin, "https://another-company.example"]) {
      focus(1, "password", targetOrigin);
      const result = browser.fill(
        client,
        undefined,
        "business",
        "password",
        undefined,
        targetOrigin,
      );
      const delivery = await browser.poll(companion);
      expect(delivery.command?.value).toBe(password);
      expect(delivery.command?.target.origin).toBe(targetOrigin);
      expect(delivery.command?.allowNewPassword).toBe(false);
      browser.complete(companion, delivery.command!.id, "FILLED");
      expect(await result).toEqual({
        status: "FILLED",
        origin: targetOrigin,
        field: "password",
      });
      expect(JSON.stringify(await result)).not.toContain(password);
      expect(JSON.stringify(await result)).not.toContain(email);
    }
    const encrypted = await readFile(join(dir, "vault.enc"), "utf8");
    expect(encrypted).not.toContain(password);
    expect(encrypted).not.toContain(email);
  });
  it("requires the exact requested HTTPS origin, matching field and explicit client grant", async () => {
    focus();
    await expect(
      browser.fill(
        { ...client, operations: [] },
        undefined,
        "business",
        "password",
        undefined,
        origin,
      ),
    ).rejects.toThrow("NOT_GRANTED");
    await expect(
      browser.fill(
        client,
        undefined,
        "business",
        "password",
        undefined,
        origin + "/login",
      ),
    ).rejects.toThrow("EXACT_HTTPS");
    await expect(
      browser.fill(
        client,
        undefined,
        "business",
        "password",
        undefined,
        "http://employer.example",
      ),
    ).rejects.toThrow("EXACT_HTTPS");
    expect(
      await browser.fill(
        client,
        undefined,
        "business",
        "username",
        undefined,
        origin,
      ),
    ).toHaveProperty("reason", "NO_MATCHING_FOCUSED_FIELD");
    expect(
      await browser.fill(
        client,
        undefined,
        "business",
        "password",
        undefined,
        "https://wrong.example",
      ),
    ).toHaveProperty("reason", "NO_MATCHING_FOCUSED_FIELD");
    expect((await browser.poll(companion)).command).toBeNull();
  });
  it("rejects ambiguous focus and stops a delivery if focus changes", async () => {
    const first = focus(1);
    const second = focus(2);
    expect(
      await browser.fill(
        client,
        undefined,
        "business",
        "password",
        undefined,
        origin,
      ),
    ).toHaveProperty("reason", "MULTIPLE_FOCUSED_FIELDS_SPECIFY_TAB");
    const result = browser.fill(
      client,
      undefined,
      "business",
      "password",
      1,
      origin,
    );
    browser.blur(companion, first);
    expect((await browser.poll(companion)).command).toBeNull();
    expect(await result).toHaveProperty("reason", "FIELD_FOCUS_CHANGED");
    browser.blur(companion, second);
  });
  it("rechecks permission before secret delivery and rejects another companion's completion", async () => {
    focus();
    const revoked = browser.fill(
      client,
      undefined,
      "business",
      "password",
      undefined,
      origin,
    );
    await store.update((s) => {
      s.clients = [];
    });
    expect((await browser.poll(companion)).command).toBeNull();
    expect(await revoked).toHaveProperty("reason", "GRANT_REVOKED");
    await store.update((s) => {
      s.clients = [structuredClone(client)];
    });
    const result = browser.fill(
      client,
      undefined,
      "business",
      "password",
      undefined,
      origin,
    );
    const delivery = await browser.poll(companion);
    expect(() =>
      browser.complete("another-companion", delivery.command!.id, "FILLED"),
    ).toThrow("COMMAND_NOT_GRANTED");
    browser.complete(
      companion,
      delivery.command!.id,
      "BLOCKED",
      "FIELD_FOCUS_CHANGED",
    );
    expect(await result).toHaveProperty("status", "BLOCKED");
  });
  it("requires both owner signup setting and Dot signup grant for new-password fields", async () => {
    focus();
    await expect(
      browser.fill(
        client,
        undefined,
        "business",
        "password",
        undefined,
        origin,
        true,
      ),
    ).rejects.toThrow("SIGNUP_NOT_GRANTED");
    const signupClient = {
      ...client,
      operations: [...client.operations, "create_account"],
    };
    await expect(
      browser.fill(
        signupClient,
        undefined,
        "business",
        "password",
        undefined,
        origin,
        true,
      ),
    ).rejects.toThrow("SIGNUP_NOT_GRANTED");
    await store.update((s) => {
      s.sharedSignup = true;
      s.clients = [signupClient];
    });
    const result = browser.fill(
      signupClient,
      undefined,
      "business",
      "password",
      undefined,
      origin,
      true,
    );
    const delivery = await browser.poll(companion);
    expect(delivery.command?.allowNewPassword).toBe(true);
    browser.complete(companion, delivery.command!.id, "FILLED");
    expect(await result).toHaveProperty("status", "FILLED");
  });
  it("uses pairing codes once and immediately revokes a paired browser", async () => {
    const ticket = browser.ticket();
    const paired = await browser.pair(ticket.code);
    await expect(browser.pair(ticket.code)).rejects.toThrow(
      "PAIRING_CODE_INVALID",
    );
    expect(browser.authenticate(paired.token)).toBe(paired.id);
    await browser.revokeCompanion(paired.id);
    expect(browser.authenticate(paired.token)).toBeUndefined();
    expect(JSON.stringify(browser.status())).not.toContain(paired.token);
  });
});
