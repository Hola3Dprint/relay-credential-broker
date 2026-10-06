import express from "express";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  Store,
  accountKey,
  equalToken,
  hashToken,
  type ClientGrant,
} from "./store.js";
import { Broker, safeReason } from "./broker.js";
import {
  bindingSchema,
  credentialsSchema,
  id,
  mailboxSchema,
  siteSchema,
} from "./schema.js";
import { demoCredential, demoSite, startDemo } from "./demo.js";
import { createMcp } from "./tools.js";

export async function createApp(store: Store) {
  const app = express();
  const broker = new Broker(store);
  let demo: Awaited<ReturnType<typeof startDemo>> | undefined;
  const failures = new Map<string, { count: number; until: number }>();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const host = req.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))
      return res.status(403).json({ error: "HOST_NOT_ALLOWED" });
    if (
      req.headers.origin &&
      ![
        "http://127.0.0.1:4318",
        "http://localhost:4318",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
      ].includes(req.headers.origin)
    )
      return res.status(403).json({ error: "ORIGIN_NOT_ALLOWED" });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    next();
  });
  app.use(express.json({ limit: "64kb" }));
  const bearer = (req: express.Request) =>
    /^Bearer ([A-Za-z0-9_-]{30,200})$/.exec(
      req.headers.authorization ?? "",
    )?.[1] ?? "";
  const admin: express.RequestHandler = (req, res, next) => {
    if (!equalToken(bearer(req), store.state.adminToken))
      return res.status(401).json({ error: "CONSOLE_ACCESS_REQUIRED" });
    next();
  };
  const grant = (req: express.Request): ClientGrant | undefined => {
    const token = bearer(req);
    if (!token) return;
    const hashed = Buffer.from(hashToken(token), "hex");
    return store.state.clients.find((c) =>
      timingSafeEqual(hashed, Buffer.from(c.tokenHash, "hex")),
    );
  };
  function limited(key: string) {
    const current = failures.get(key);
    const next =
      !current || current.until < Date.now()
        ? { count: 1, until: Date.now() + 60000 }
        : { ...current, count: current.count + 1 };
    failures.set(key, next);
    return next.count > 30;
  }
  async function agentCall(
    client: ClientGrant,
    op: string,
    body: Record<string, unknown>,
  ) {
    if (!client.operations.includes(op))
      throw new Error("OPERATION_NOT_GRANTED");
    if (op === "list_accounts")
      return Object.entries(store.state.accounts)
        .filter(([key]) => client.accounts.includes(key))
        .map(([_, a]) => ({
          site: a.site.id,
          identity: a.site.identity,
          name: a.site.name,
          status: a.result?.status ?? "ENROLLED",
          taskPages: a.site.taskPages,
        }));
    const input = z
      .object({
        site: id,
        identity: id.default("business"),
        url: z.string().url().max(2000).optional(),
      })
      .parse(body);
    if (!client.accounts.includes(accountKey(input.site, input.identity)))
      throw new Error("ACCOUNT_NOT_GRANTED");
    if (!store.state.ready)
      return {
        status: "BLOCKED",
        reason: "SETUP_REQUIRED",
        site: input.site,
        identity: input.identity,
      };
    if (op === "ensure_login")
      return broker.ensureLogin(input.site, input.identity);
    if (op === "create_account")
      return broker.createAccount(input.site, input.identity);
    if (op === "read_account_page" && input.url)
      return broker.readPage(input.site, input.identity, input.url);
    throw new Error("UNKNOWN_OPERATION");
  }
  app.get("/api/health", (_, res) =>
    res.json({ service: "Relay", version: "0.1.0", ready: store.state.ready }),
  );
  app.get("/api/state", admin, (_, res) =>
    res.json({
      ready: store.state.ready,
      protection: store.envelope.mode,
      vaultConnected: !!store.state.bwsToken,
      mailboxConnected: !!store.state.mailbox,
      accounts: Object.entries(store.state.accounts).map(([key, a]) => ({
        key,
        site: a.site.id,
        identity: a.site.identity,
        name: a.site.name,
        origin: a.site.origins[0],
        provider: a.binding.provider,
        status: a.result?.status ?? "ENROLLED",
        reason: a.result?.reason,
        checkedAt: a.checkedAt,
        mfa: a.site.mfa?.method ?? "none",
      })),
      audit: store.state.audit,
      clients: store.state.clients.map(({ tokenHash: _, ...c }) => c),
    }),
  );
  app.post("/api/setup", admin, async (req, res) => {
    const input = z
      .object({ protection: z.enum(["tpm", "dpapi", "passphrase"]) })
      .parse(req.body);
    if (store.state.ready)
      return res.status(409).json({ error: "ALREADY_CONFIGURED" });
    await store.rewrap(input.protection);
    await store.update((s) => {
      s.ready = true;
    });
    await store.audit("bootstrap", "COMPLETE");
    res.json({ ready: true });
  });
  app.post("/api/vault", admin, async (req, res) => {
    const token = z.string().min(20).max(2000).parse(req.body.token);
    const previous = store.state.bwsToken;
    await store.update((s) => {
      s.bwsToken = token;
    });
    try {
      await broker.provider.validateConnection();
    } catch {
      await store.update((s) => {
        s.bwsToken = previous;
      });
      return res.status(400).json({ error: "VAULT_CONNECTION_FAILED" });
    }
    await store.audit("connect_vault", "COMPLETE");
    res.json({ connected: true });
  });
  app.post("/api/mailbox", admin, async (req, res) => {
    const config = mailboxSchema.parse(req.body);
    await store.update((s) => {
      s.mailbox = config;
    });
    await store.audit("configure_mailbox", "COMPLETE");
    res.json({ configured: true });
  });
  app.post("/api/accounts", admin, async (req, res) => {
    const input = z
      .object({
        site: siteSchema,
        binding: bindingSchema,
        credential: credentialsSchema.optional(),
      })
      .parse(req.body);
    if (
      input.site.origins.some(
        (v) => new URL(v).port === "4318" || new URL(v).port === "5173",
      )
    )
      return res.status(400).json({ error: "BROKER_ORIGIN_FORBIDDEN" });
    const key = accountKey(input.site.id, input.site.identity);
    if (store.state.accounts[key])
      return res.status(409).json({ error: "ACCOUNT_EXISTS" });
    if (
      input.binding.provider === "local" &&
      !input.credential &&
      !input.site.signup
    )
      return res.status(400).json({ error: "CREDENTIAL_REQUIRED" });
    await store.update((s) => {
      s.accounts[key] = input;
    });
    await store.audit("enroll_account", "COMPLETE", key);
    res.status(201).json({ key });
  });
  app.post("/api/accounts/:site/:identity/login", admin, async (req, res) =>
    res.json(
      await broker.ensureLogin(
        String(req.params.site),
        String(req.params.identity),
      ),
    ),
  );
  app.post("/api/demo", admin, async (_, res) => {
    demo ??= await startDemo();
    const site = demoSite(demo.port);
    const key = accountKey(site.id, site.identity);
    await store.update((s) => {
      s.accounts[key] ??= {
        site,
        binding: { provider: "local" },
        credential: demoCredential,
      };
    });
    res.json(await broker.ensureLogin(site.id));
  });
  app.post("/api/clients", admin, async (req, res) => {
    const input = z
      .object({
        name: z.string().min(1).max(60),
        accounts: z.array(z.string().max(130)).min(1).max(100),
        signup: z.boolean().default(false),
      })
      .parse(req.body);
    if (input.accounts.some((key) => !store.state.accounts[key]))
      return res.status(400).json({ error: "UNKNOWN_ACCOUNT" });
    const token = randomBytes(32).toString("base64url");
    const clientId = randomUUID();
    const operations = [
      "list_accounts",
      "ensure_login",
      "read_account_page",
      ...(input.signup ? ["create_account"] : []),
    ];
    await store.update((s) => {
      s.clients.push({
        id: clientId,
        name: input.name,
        accounts: input.accounts,
        operations,
        tokenHash: hashToken(token),
        createdAt: new Date().toISOString(),
      });
      (s.clientSecrets ??= {})[clientId] = token;
    });
    await store.audit("create_client", "COMPLETE");
    res.status(201).json({ id: clientId, token });
  });
  app.delete("/api/clients/:id", admin, async (req, res) => {
    await store.update((s) => {
      s.clients = s.clients.filter((c) => c.id !== req.params.id);
      if (s.clientSecrets) delete s.clientSecrets[String(req.params.id)];
    });
    await store.audit("revoke_client", "COMPLETE");
    res.json({ revoked: true });
  });
  app.post("/api/agent/:operation", async (req, res) => {
    const client = grant(req);
    if (!client)
      return res.status(401).json({ error: "CLIENT_ACCESS_REQUIRED" });
    if (limited(client.id))
      return res.status(429).json({ error: "RATE_LIMITED" });
    try {
      res.json(await agentCall(client, req.params.operation, req.body));
    } catch {
      res.status(403).json({ error: "OPERATION_NOT_GRANTED_OR_INVALID" });
    }
  });
  app.post("/mcp", async (req, res) => {
    const client = grant(req);
    if (!client)
      return res.status(401).json({ error: "CLIENT_ACCESS_REQUIRED" });
    if (limited(client.id))
      return res.status(429).json({ error: "RATE_LIMITED" });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createMcp((op, body) => agentCall(client, op, body));
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.get("/mcp", (_, res) => res.status(405).end());
  app.delete("/mcp", (_, res) => res.status(405).end());
  app.use(express.static(resolve("dist/web")));
  app.get("/", (_, res) => res.sendFile(resolve("dist/web/index.html")));
  app.use(
    (
      error: unknown,
      _: express.Request,
      res: express.Response,
      __: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError)
        return res
          .status(400)
          .json({
            error: "INVALID_INPUT",
            fields: error.issues.map((i) => i.path.join(".")),
          });
      res.status(500).json({ error: safeReason(error) });
    },
  );
  const renewal = setInterval(() => {
    void broker.renewDue().catch(() => {});
  }, 60000);
  renewal.unref();
  return {
    app,
    broker,
    agentCall,
    close: async () => {
      clearInterval(renewal);
      await broker.close();
      await new Promise<void>((r) =>
        demo ? demo.server.close(() => r()) : r(),
      );
      store.close();
    },
  };
}
export async function main() {
  const store = await new Store().open();
  const runtime = await createApp(store);
  const server = runtime.app.listen(4318, "127.0.0.1", () =>
    process.stdout.write(
      "Relay is running at http://127.0.0.1:4318. Run npm run console to open the authenticated dashboard.\n",
    ),
  );
  server.on("error", () => {
    process.stderr.write("Relay could not bind its local port.\n");
    process.exitCode = 1;
  });
  const close = () => {
    server.close(() => {
      void runtime.close().then(() => process.exit(0));
    });
  };
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(() => {
    process.stderr.write(
      "Relay startup failed. Check the encrypted store and Windows account identity.\n",
    );
    process.exitCode = 1;
  });
