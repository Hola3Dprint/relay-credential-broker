import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest, type Server } from "node:http";
import { Store, hashToken } from "../src/store.js";
import { createApp } from "../src/server.js";
import { demoCredential, demoSite } from "../src/demo.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
let store: Store;
let runtime: Awaited<ReturnType<typeof createApp>>;
let server: Server;
let url: string;
let dir: string;
const token = "scoped-test-client-token-000000000000000000";
const oldMode = process.env.RELAY_KEY_MODE;
const oldPass = process.env.RELAY_PASSPHRASE;
beforeAll(async () => {
  process.env.RELAY_KEY_MODE = "passphrase";
  process.env.RELAY_PASSPHRASE =
    "test-only-passphrase-never-use-for-real-accounts";
  dir = await mkdtemp(join(tmpdir(), "relay-api-"));
  store = await new Store(dir).open();
  await store.update((s) => {
    s.ready = true;
    s.accounts["relay-demo:business"] = {
      site: demoSite(4322),
      binding: { provider: "local" },
      credential: demoCredential,
    };
    s.clients.push({
      id: "client",
      name: "Dot",
      tokenHash: hashToken(token),
      accounts: ["relay-demo:business"],
      operations: ["list_accounts", "ensure_login", "read_account_page"],
      createdAt: new Date().toISOString(),
    });
  });
  runtime = await createApp(store);
  server = await new Promise<Server>((r) => {
    const s = runtime.app.listen(0, "127.0.0.1", () => r(s));
  });
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
  await runtime?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
  if (oldMode === undefined) delete process.env.RELAY_KEY_MODE;
  else process.env.RELAY_KEY_MODE = oldMode;
  if (oldPass === undefined) delete process.env.RELAY_PASSPHRASE;
  else process.env.RELAY_PASSPHRASE = oldPass;
});
const request = (
  path: string,
  auth?: string,
  body?: unknown,
  headers: Record<string, string> = {},
  method?: string,
) =>
  fetch(url + path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
describe("admin and client separation", () => {
  it("refuses unauthenticated and client access to the console", async () => {
    expect((await request("/api/state")).status).toBe(401);
    expect((await request("/api/state", token)).status).toBe(401);
    expect((await request("/api/state", store.state.adminToken)).status).toBe(
      200,
    );
  });
  it("lists scoped metadata without any credential values", async () => {
    const response = await request("/api/agent/list_accounts", token, {});
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("relay-demo");
    for (const secret of [
      demoCredential.username,
      demoCredential.password,
      demoCredential.totpSecret,
    ])
      expect(text).not.toContain(secret);
  });
  it("refuses cross-account calls, signup without a grant, and credential tools", async () => {
    for (const [op, body] of [
      ["ensure_login", { site: "other" }],
      ["create_account", { site: "relay-demo" }],
      ["get_password", {}],
      ["prepare_private_signin", { origin: "https://employer.example" }],
      [
        "private_signin_status",
        { requestId: "00000000-0000-4000-8000-000000000001" },
      ],
    ] as const)
      expect((await request(`/api/agent/${op}`, token, body)).status).toBe(403);
  });
  it("rejects foreign browser origins and DNS-rebinding hosts", async () => {
    expect(
      (
        await request("/api/health", undefined, undefined, {
          Origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
    const status = await new Promise<number | undefined>((accept, reject) => {
      const req = httpRequest(
        url + "/api/health",
        { headers: { Host: "evil.example" } },
        (res) => {
          res.resume();
          accept(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });
  it("never exposes private-form jobs or values to Dot/admin tokens", async () => {
    for (const auth of [undefined, token, store.state.adminToken]) {
      expect((await request("/api/browser/private-jobs", auth)).status).toBe(
        401,
      );
      expect(
        (await request("/api/browser/private-delivery", auth, {})).status,
      ).toBe(401);
      expect(
        (await request("/api/browser/private-complete", auth, {})).status,
      ).toBe(401);
    }
  });
  it("supports MCP initialization and refuses unauthenticated transport access", async () => {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test-dot", version: "1" },
      },
    };
    expect((await request("/mcp", undefined, body)).status).toBe(401);
    const response = await request("/mcp", token, body, {
      Accept: "application/json, text/event-stream",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty(
      "result.serverInfo.name",
      "relay",
    );
  });
  it("discovers narrow tools and returns scoped account data over the real MCP HTTP client", async () => {
    const client = new Client({ name: "http-test-dot", version: "1" });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(url + "/mcp"), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      );
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name).sort()).toEqual([
        "create_account",
        "ensure_login",
        "fill_saved_password",
        "fill_saved_totp",
        "fill_saved_username",
        "list_accounts",
        "prepare_private_signin",
        "private_signin_status",
        "read_account_page",
      ]);
      const result = await client.callTool({
        name: "list_accounts",
        arguments: {},
      });
      expect(JSON.stringify(result)).toContain("relay-demo");
      expect(JSON.stringify(result)).not.toContain(demoCredential.password);
      const denied = await client.callTool({
        name: "create_account",
        arguments: { site: "relay-demo" },
      });
      expect(denied.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
  it("keeps shared credential setup and browser pairing separate from Dot access", async () => {
    const config = {
      email: "shared@relay.test",
      password: "Fixture-only-shared-password-32!",
      signup: true,
    };
    expect(
      (await request("/api/shared-credential", token, config)).status,
    ).toBe(401);
    const saved = await request(
      "/api/shared-credential",
      store.state.adminToken,
      config,
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ configured: true });
    const autofillToken = "scoped-autofill-fixture-token-00000000000000";
    await store.update((s) => {
      s.clients.push({
        id: "autofill-readiness",
        name: "Fixture autofill client",
        tokenHash: hashToken(autofillToken),
        accounts: [],
        operations: [
          "list_accounts",
          "fill_saved_username",
          "fill_saved_password",
        ],
        createdAt: new Date().toISOString(),
      });
    });
    const readiness = async () =>
      (
        await (
          await request("/api/agent/list_accounts", autofillToken, {})
        ).json()
      )[0];
    expect(await readiness()).toMatchObject({
      mode: "shared",
      credentialSaved: true,
      status: "BLOCKED",
      reason: "BROWSER_COMPANION_NOT_PAIRED",
    });
    expect(
      await (
        await request("/api/agent/fill_saved_username", autofillToken, {
          origin: "https://example.com",
        })
      ).json(),
    ).toEqual({ status: "BLOCKED", reason: "BROWSER_COMPANION_NOT_PAIRED" });
    const metadata = await (
      await request("/api/state", store.state.adminToken)
    ).text();
    expect(metadata).not.toContain(config.password);
    expect((await request("/api/browser/poll", token)).status).toBe(401);
    expect((await request("/api/browser/pairing-code", token, {})).status).toBe(
      401,
    );
    const ticket = await (
      await request("/api/browser/pairing-code", store.state.adminToken, {})
    ).json();
    const pair = await (
      await request("/api/browser/pair", undefined, { code: ticket.code })
    ).json();
    expect(await readiness()).toMatchObject({
      status: "BLOCKED",
      reason: "BROWSER_COMPANION_OFFLINE",
    });
    expect((await request("/api/state", pair.token)).status).toBe(401);
    expect(
      (await request("/api/agent/list_accounts", pair.token, {})).status,
    ).toBe(401);
    expect((await request("/api/browser/status", pair.token)).status).toBe(200);
    expect(await readiness()).toMatchObject({
      mode: "shared",
      status: "READY_TO_FILL",
    });
    expect(JSON.stringify(await readiness())).not.toContain(config.password);
    expect(
      await (
        await request("/api/agent/fill_saved_username", autofillToken, {
          origin: "https://example.com",
        })
      ).json(),
    ).toHaveProperty("reason", "NO_MATCHING_FOCUSED_FIELD");
    await store.update((s) => {
      s.clients = s.clients.filter((c) => c.id !== "autofill-readiness");
    });
    expect(
      (await request("/api/browser/pair", undefined, { code: ticket.code }))
        .status,
    ).toBe(403);
    expect(
      (
        await request("/api/agent/fill_saved_password", token, {
          origin: "https://example.com",
        })
      ).status,
    ).toBe(403);
  });
  it("changes grants only through the console and preserves the existing token", async () => {
    await store.update((s) => {
      s.accounts["relay-demo:second"] = {
        site: { ...demoSite(4322), identity: "second" },
        binding: { provider: "local" },
        credential: { ...demoCredential },
      };
    });
    const tokenHash = store.state.clients[0].tokenHash;
    const grant = { accounts: ["relay-demo:second"], signup: false };
    expect(
      (await request("/api/clients/client", token, grant, {}, "PUT")).status,
    ).toBe(401);
    expect(
      (
        await request(
          "/api/clients/client",
          store.state.adminToken,
          { accounts: ["missing"] },
          {},
          "PUT",
        )
      ).status,
    ).toBe(400);
    expect(store.state.clients[0].accounts).toEqual(["relay-demo:business"]);
    expect(
      (
        await request(
          "/api/clients/client",
          store.state.adminToken,
          grant,
          {},
          "PUT",
        )
      ).status,
    ).toBe(200);
    expect(store.state.clients[0].tokenHash).toBe(tokenHash);
    expect(store.state.clients[0].id).toBe("client");
    const listed = await request("/api/agent/list_accounts", token, {});
    expect(await listed.json()).toEqual([
      {
        site: "relay-demo",
        identity: "second",
        name: "Relay demo",
        status: "ENROLLED",
        taskPages: ["http://127.0.0.1:4322/account"],
      },
    ]);
    expect(
      (
        await request("/api/agent/ensure_login", token, {
          site: "relay-demo",
          identity: "business",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/api/agent/create_account", token, {
          site: "relay-demo",
          identity: "second",
        })
      ).status,
    ).toBe(403);
  });
  it("immediately revokes existing client tokens", async () => {
    await store.update((s) => {
      s.clients = [];
    });
    expect((await request("/api/agent/list_accounts", token, {})).status).toBe(
      401,
    );
    expect(
      (
        await request(
          "/api/clients/client",
          store.state.adminToken,
          { accounts: ["relay-demo:second"], signup: false },
          {},
          "PUT",
        )
      ).status,
    ).toBe(404);
    expect((await request("/api/agent/list_accounts", token, {})).status).toBe(
      401,
    );
  });
});
