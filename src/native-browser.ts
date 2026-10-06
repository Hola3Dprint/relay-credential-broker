import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  equalToken,
  hashToken,
  accountKey,
  type Store,
  type ClientGrant,
} from "./store.js";
import { CredentialProvider } from "./providers.js";
import { totp } from "./totp.js";

export const focusSchema = z.object({
  tabId: z.number().int().nonnegative(),
  frameId: z.number().int().nonnegative(),
  origin: z
    .string()
    .url()
    .max(500)
    .refine((v) => new URL(v).origin === v),
  nonce: z.string().uuid(),
  kind: z.enum(["password", "username", "totp"]),
});
type Focus = z.infer<typeof focusSchema> & { companion: string; at: number };
type Command = {
  id: string;
  companion: string;
  client: string;
  key: string;
  target: Focus;
  field: "password" | "username" | "totp";
  signup: boolean;
  expires: number;
  delivered: boolean;
  finish: (result: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};
export class NativeBrowser {
  private tickets = new Map<string, { hash: string; expires: number }>();
  private focuses = new Map<string, Focus>();
  private commands = new Map<string, Command>();
  private seen = new Map<string, number>();
  constructor(private store: Store) {}
  ticket() {
    this.tickets.clear();
    const code = randomBytes(18).toString("base64url");
    this.tickets.set("current", {
      hash: hashToken(code),
      expires: Date.now() + 5 * 60000,
    });
    return { code, expiresInSeconds: 300 };
  }
  async pair(code: string) {
    const ticket = this.tickets.get("current");
    if (
      !ticket ||
      ticket.expires < Date.now() ||
      !equalToken(hashToken(code), ticket.hash)
    )
      throw new Error("PAIRING_CODE_INVALID_OR_EXPIRED");
    this.tickets.delete("current");
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    await this.store.update((s) => {
      (s.browserCompanions ??= []).push({
        id,
        name: "Chrome companion",
        tokenHash: hashToken(token),
        pairedAt: new Date().toISOString(),
      });
    });
    await this.store.audit("pair_browser", "COMPLETE");
    return { id, token };
  }
  authenticate(token: string) {
    const companion = this.store.state.browserCompanions?.find((c) =>
      equalToken(hashToken(token), c.tokenHash),
    );
    if (companion) this.seen.set(companion.id, Date.now());
    return companion?.id;
  }
  status() {
    return (this.store.state.browserCompanions ?? []).map(
      ({ tokenHash: _, ...c }) => ({
        ...c,
        online: Date.now() - (this.seen.get(c.id) ?? 0) < 15000,
      }),
    );
  }
  focus(companion: string, input: z.infer<typeof focusSchema>) {
    this.focuses.set(`${companion}:${input.tabId}:${input.frameId}`, {
      ...input,
      companion,
      at: Date.now(),
    });
  }
  blur(companion: string, nonce: string) {
    for (const [key, focus] of this.focuses)
      if (focus.companion === companion && focus.nonce === nonce)
        this.focuses.delete(key);
  }
  private account(key: string) {
    if (key === "shared") {
      if (!this.store.state.sharedCredential)
        throw new Error("SHARED_CREDENTIAL_NOT_CONFIGURED");
      return {
        origin: undefined,
        account: {
          binding: { provider: "local" as const },
          credential: this.store.state.sharedCredential,
        },
      };
    }
    const legacy = this.store.state.accounts[key];
    if (!legacy) throw new Error("ACCOUNT_NOT_ENROLLED");
    return { origin: new URL(legacy.site.login.url).origin, account: legacy };
  }
  async fill(
    client: ClientGrant,
    site: string | undefined,
    identity: string,
    field: Command["field"],
    tabId?: number,
    requestedOrigin?: string,
    signup = false,
  ) {
    const key = site ? accountKey(site, identity) : "shared";
    if (
      (key !== "shared" && !client.accounts.includes(key)) ||
      !client.operations.includes(`fill_saved_${field}`)
    )
      throw new Error("ACCOUNT_OR_OPERATION_NOT_GRANTED");
    if (key === "shared" && !this.store.state.sharedCredential)
      return { status: "BLOCKED", reason: "SHARED_CREDENTIAL_NOT_CONFIGURED" };
    const { origin: boundOrigin } = this.account(key);
    const origin = boundOrigin ?? requestedOrigin;
    if (
      !origin ||
      new URL(origin).origin !== origin ||
      (key === "shared" && new URL(origin).protocol !== "https:")
    )
      throw new Error("EXACT_HTTPS_ORIGIN_REQUIRED");
    if (
      signup &&
      (!client.operations.includes("create_account") ||
        (key === "shared" && !this.store.state.sharedSignup))
    )
      throw new Error("SIGNUP_NOT_GRANTED");
    const candidates = [...this.focuses.values()].filter(
      (f) =>
        f.origin === origin &&
        f.kind === field &&
        Date.now() - f.at < 15000 &&
        Date.now() - (this.seen.get(f.companion) ?? 0) < 15000 &&
        (tabId === undefined || f.tabId === tabId),
    );
    if (candidates.length !== 1)
      return {
        status: "BLOCKED",
        reason: candidates.length
          ? "MULTIPLE_FOCUSED_FIELDS_SPECIFY_TAB"
          : "NO_MATCHING_FOCUSED_FIELD",
        site,
        identity,
      };
    const target = candidates[0];
    if (
      [...this.commands.values()].some((c) => c.target.nonce === target.nonce)
    )
      return { status: "BLOCKED", reason: "FILL_IN_PROGRESS", site, identity };
    return new Promise<unknown>((finish) => {
      const id = randomUUID();
      const timer = setTimeout(
        () => this.resolve(id, "BLOCKED", "BROWSER_COMPANION_TIMEOUT"),
        10000,
      );
      this.commands.set(id, {
        id,
        client: client.id,
        key,
        companion: target.companion,
        target,
        field,
        signup,
        expires: Date.now() + 10000,
        delivered: false,
        finish,
        timer,
      });
    });
  }
  async poll(companion: string) {
    for (const command of this.commands.values()) {
      if (
        command.companion !== companion ||
        command.delivered ||
        command.expires < Date.now()
      )
        continue;
      const grant = this.store.state.clients.find(
        (c) => c.id === command.client,
      );
      if (
        !grant ||
        (command.key !== "shared" && !grant.accounts.includes(command.key)) ||
        !grant.operations.includes(`fill_saved_${command.field}`) ||
        (command.signup &&
          (!grant.operations.includes("create_account") ||
            (command.key === "shared" && !this.store.state.sharedSignup)))
      ) {
        this.resolve(command.id, "BLOCKED", "GRANT_REVOKED");
        continue;
      }
      const focus = [...this.focuses.values()].find(
        (f) =>
          f.nonce === command.target.nonce &&
          f.companion === companion &&
          f.kind === command.field &&
          f.origin === command.target.origin &&
          Date.now() - f.at < 15000,
      );
      if (!focus) {
        this.resolve(command.id, "BLOCKED", "FIELD_FOCUS_CHANGED");
        continue;
      }
      const { origin, account } = this.account(command.key);
      if (origin && focus.origin !== origin) {
        this.resolve(command.id, "BLOCKED", "ORIGIN_NOT_ALLOWED");
        continue;
      }
      command.delivered = true;
      try {
        const credential = await new CredentialProvider(this.store).get(
          account,
        );
        let value: string;
        if (command.field === "totp") {
          if (!credential.totpSecret) {
            this.resolve(command.id, "BLOCKED", "MFA_NOT_CONFIGURED");
            continue;
          }
          value = totp(credential.totpSecret);
        } else value = credential[command.field];
        if (
          !this.commands.has(command.id) ||
          !this.store.state.clients.some(
            (c) =>
              c.id === command.client &&
              c.operations.includes(`fill_saved_${command.field}`) &&
              (command.key === "shared" || c.accounts.includes(command.key)),
          )
        ) {
          this.resolve(command.id, "BLOCKED", "GRANT_REVOKED");
          continue;
        }
        // This response is exclusively for the paired extension, never MCP or the Dot.
        const allowNewPassword =
          command.signup &&
          command.key === "shared" &&
          !!this.store.state.sharedSignup;
        return {
          command: {
            id: command.id,
            target: command.target,
            field: command.field,
            value,
            allowNewPassword,
          },
        };
      } catch {
        this.resolve(command.id, "BLOCKED", "CREDENTIAL_UNAVAILABLE");
      }
    }
    return { command: null };
  }
  complete(
    companion: string,
    id: string,
    status: "FILLED" | "BLOCKED",
    reason?: string,
  ) {
    const command = this.commands.get(id);
    if (!command || command.companion !== companion || !command.delivered)
      throw new Error("COMMAND_NOT_GRANTED");
    this.resolve(id, status, status === "BLOCKED" ? reason : undefined);
  }
  private resolve(id: string, status: string, reason?: string) {
    const command = this.commands.get(id);
    if (!command) return;
    clearTimeout(command.timer);
    this.commands.delete(id);
    command.finish({
      status,
      ...(reason ? { reason } : {}),
      origin: command.target.origin,
      field: command.field,
    });
    void this.store
      .audit("fill_saved_" + command.field, status, command.key, reason)
      .catch(() => {});
  }
  async revokeCompanion(id: string) {
    await this.store.update((s) => {
      s.browserCompanions = s.browserCompanions?.filter((c) => c.id !== id);
    });
    for (const command of this.commands.values())
      if (command.companion === id)
        this.resolve(command.id, "BLOCKED", "BROWSER_REVOKED");
    for (const [key, focus] of this.focuses)
      if (focus.companion === id) this.focuses.delete(key);
  }
  revokeClient(id: string) {
    for (const c of this.commands.values())
      if (c.client === id) this.resolve(c.id, "BLOCKED", "GRANT_REVOKED");
  }
  close() {
    for (const c of this.commands.values())
      this.resolve(c.id, "BLOCKED", "BROKER_STOPPED");
    this.tickets.clear();
    this.focuses.clear();
  }
}
