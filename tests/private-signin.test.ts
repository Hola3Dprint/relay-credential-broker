import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrivateSignIn } from "../src/private-signin.js";
import type { Store, ClientGrant } from "../src/store.js";
import { demoCredential } from "../src/demo.js";
function fixture() {
  const client: ClientGrant = {
    id: "dot",
    name: "Fixture",
    tokenHash: "unused",
    accounts: ["relay-demo:business"],
    operations: [
      "prepare_private_signin",
      "private_signin_status",
      "fill_saved_username",
      "fill_saved_password",
    ],
    privateSignInDotId: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const secret = "private-fixture-password-never-use";
  const store = {
    state: {
      clients: [client],
      sharedCredential: { username: "fixture@relay.test", password: secret },
    },
    audit: async () => {},
  } as unknown as Store;
  const broker = new PrivateSignIn(store);
  const prepare = (demo = false) =>
    broker.prepare(client, "https://employer.example", demo) as {
      requestId: string;
    };
  const target = (id: string) => ({
    id,
    dotId: client.privateSignInDotId!,
    origin: "https://employer.example",
    nonce: randomUUID(),
    tabId: 1,
    fields: ["username", "password"] as ("username" | "password")[],
  });
  return { client, store, broker, prepare, target, secret };
}
describe("native private sign-in preparation", () => {
  it("arms before the native request and releases values once only to the companion delivery", () => {
    const f = fixture(),
      prepared = f.prepare();
    expect(JSON.stringify(prepared)).not.toContain(f.secret);
    expect(JSON.stringify(f.broker.pending())).not.toContain(f.secret);
    const delivery = f.broker.deliver(
      "paired-browser",
      f.target(prepared.requestId),
    );
    expect(delivery.fields[1].value).toBe(f.secret);
    expect(() =>
      f.broker.deliver("paired-browser", f.target(prepared.requestId)),
    ).toThrow("NOT_GRANTED");
    expect(() =>
      f.broker.complete("other-browser", prepared.requestId, "FILLED"),
    ).toThrow("NOT_GRANTED");
    f.broker.complete("paired-browser", prepared.requestId, "FILLED");
    expect(f.broker.status(f.client, prepared.requestId).status).toBe("FILLED");
    expect(
      JSON.stringify(f.broker.status(f.client, prepared.requestId)),
    ).not.toContain(f.secret);
  });
  it("binds to the configured Dot, exact HTTPS origin, and current grant", () => {
    const f = fixture(),
      prepared = f.prepare(),
      target = f.target(prepared.requestId);
    for (const change of [
      { origin: "https://wrong.example" },
      { dotId: randomUUID() },
    ])
      expect(() =>
        f.broker.deliver("browser", { ...target, ...change }),
      ).toThrow("NOT_GRANTED");
    expect(() =>
      f.broker.prepare(f.client, "http://employer.example"),
    ).toThrow();
    expect(() =>
      f.broker.status({ ...f.client, id: "other" }, prepared.requestId),
    ).toThrow("NOT_GRANTED");
    f.client.operations = [];
    expect(f.broker.pending()).toEqual([]);
    expect(f.broker.status(f.client, prepared.requestId)).toHaveProperty(
      "reason",
      "GRANT_REVOKED",
    );
    expect(() => f.broker.deliver("browser", target)).toThrow("NOT_GRANTED");
  });
  it("expires jobs and supersedes old armed destinations without a second credential delivery", () => {
    const f = fixture(),
      first = f.prepare(),
      second = f.prepare();
    expect(f.broker.status(f.client, first.requestId).reason).toBe(
      "SUPERSEDED",
    );
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 300001);
    try {
      expect(f.broker.pending()).toEqual([]);
      expect(f.broker.status(f.client, second.requestId).reason).toBe(
        "PRIVATE_SIGNIN_EXPIRED",
      );
      expect(() =>
        f.broker.deliver("browser", f.target(second.requestId)),
      ).toThrow();
    } finally {
      vi.restoreAllMocks();
    }
  });
  it("uses public fake credentials in demo mode and revokes in-flight delivery", () => {
    const f = fixture(),
      prepared = f.prepare(true);
    const delivery = f.broker.deliver("browser", f.target(prepared.requestId));
    expect(delivery.fields[1].value).toBe(demoCredential.password);
    expect(JSON.stringify(delivery)).not.toContain(f.secret);
    f.broker.revokeCompanion("browser");
    expect(f.broker.status(f.client, prepared.requestId).reason).toBe(
      "BROWSER_REVOKED",
    );
    expect(() =>
      f.broker.complete("browser", prepared.requestId, "FILLED"),
    ).toThrow();
    f.client.accounts = [];
    expect(() => f.prepare(true)).toThrow("NOT_GRANTED");
  });
});
