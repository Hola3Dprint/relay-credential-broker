import express from "express";
import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import { siteSchema } from "./schema.js";
import { totp } from "./totp.js";

export const demoCredential = {
  username: "demo@relay.test",
  password: "Demo-only-account-32-characters!!",
  totpSecret: "JBSWY3DPEHPK3PXP",
  recoveryCodes: ["DEMO-RECOVERY-001", "DEMO-RECOVERY-002"],
};
export function demoSite(port = 4320) {
  const origin = `http://127.0.0.1:${port}`;
  return siteSchema.parse({
    id: "relay-demo",
    name: "Relay demo",
    origins: [origin],
    login: {
      url: `${origin}/login`,
      username: "#username",
      password: "#password",
      submit: "#submit",
      success: "#signed-in",
    },
    mfa: { input: "#code", submit: "#verify", method: "totp" },
    blockedSelectors: ["#human-check"],
    sessionCheckUrl: `${origin}/account`,
    taskPages: [`${origin}/account`],
    timeoutMs: 3000,
  });
}
export async function startDemo(port = 4320): Promise<{
  server: Server;
  port: number;
  expire: () => void;
  challenge: (on: boolean) => void;
}> {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  const sessions = new Set<string>();
  const pending = new Set<string>();
  let blocked = false;
  const cookie = (req: express.Request, key: string) =>
    (req.headers.cookie ?? "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${key}=`))
      ?.slice(key.length + 1);
  const html = (body: string) =>
    `<!doctype html><html><head><meta charset="utf-8"><title>Relay local test website</title><style>body{font:16px system-ui;max-width:600px;margin:80px auto;color:#102334}form{display:grid;gap:16px}input,button{font:inherit;padding:12px}button{background:#087e78;color:white;border:0}</style></head><body>${body}</body></html>`;
  app.get("/modal-login", (_, res) =>
    res.send(
      html(
        blocked
          ? '<h1 id="human-check">Human verification required</h1>'
          : '<h1>Relay modal sign-in fixture</h1><button id="open-login" onclick="document.getElementById(\'login-dialog\').showModal()">Sign in</button><dialog id="login-dialog"><form method="post" action="/login"><label>Email<input id="username" name="username"></label><label>Password<input id="password" name="password" type="password"></label><button id="submit">Sign in</button></form></dialog>',
      ),
    ),
  );
  app.get("/login", (_, res) =>
    res.send(
      html(
        blocked
          ? '<h1 id="human-check">Human verification required</h1>'
          : '<h1>Relay test account</h1><form method="post" action="/login"><label>Email<input id="username" name="username" autocomplete="username"></label><label>Password<input id="password" name="password" type="password" autocomplete="current-password"></label><button id="submit">Sign in</button></form>',
      ),
    ),
  );
  app.post("/login", (req, res) => {
    if (
      req.body.username !== demoCredential.username ||
      req.body.password !== demoCredential.password
    )
      return res.status(401).send(html("<h1>Sign-in failed</h1>"));
    const id = randomBytes(16).toString("hex");
    pending.add(id);
    res.cookie("pending", id, { httpOnly: true, sameSite: "strict" });
    res.redirect("/mfa");
  });
  app.get("/mfa", (_, res) =>
    res.send(
      html(
        '<h1>Authenticator verification</h1><form method="post" action="/mfa"><label>Authenticator code<input id="code" name="code" autocomplete="one-time-code"></label><button id="verify">Verify</button></form>',
      ),
    ),
  );
  app.post("/mfa", (req, res) => {
    const id = cookie(req, "pending");
    if (
      !id ||
      !pending.has(id) ||
      req.body.code !== totp(demoCredential.totpSecret)
    )
      return res.status(401).send(html("<h1>Verification failed</h1>"));
    pending.delete(id);
    const session = randomBytes(16).toString("hex");
    sessions.add(session);
    res.cookie("session", session, {
      httpOnly: true,
      sameSite: "strict",
      maxAge: 3600000,
    });
    res.clearCookie("pending");
    res.redirect("/account");
  });
  app.get("/account", (req, res) => {
    if (!sessions.has(cookie(req, "session") ?? ""))
      return res.redirect("/login");
    res.send(
      html(
        '<h1 id="signed-in">You are signed in</h1><p>Session restoration and TOTP verification work.</p><h2>Demo supplier catalog</h2><p>PLA filament — available</p><p>PETG filament — available</p>',
      ),
    );
  });
  const server = await new Promise<Server>((accept, reject) => {
    const s = app.listen(port, "127.0.0.1", () => accept(s));
    s.on("error", reject);
  });
  return {
    server,
    port: (server.address() as { port: number }).port,
    expire: () => sessions.clear(),
    challenge: (on) => {
      blocked = on;
    },
  };
}
