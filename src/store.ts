import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  protectKey,
  recoverKey,
  seal,
  unseal,
  type KeyEnvelope,
  type Protection,
} from "./crypto.js";
import type {
  Binding,
  Credential,
  LoginResult,
  Mailbox,
  Site,
} from "./schema.js";

export type Account = {
  site: Site;
  binding: Binding;
  credential?: Credential;
  result?: LoginResult;
  checkedAt?: string;
  session?: unknown;
  pendingPassword?: string;
};
export type Audit = {
  id: string;
  at: string;
  site?: string;
  action: string;
  status: string;
  reason?: string;
};
export type ClientGrant = {
  id: string;
  name: string;
  tokenHash: string;
  accounts: string[];
  operations: string[];
  createdAt: string;
};
export type State = {
  version: 1;
  ready: boolean;
  adminToken: string;
  bwsToken?: string;
  mailbox?: Mailbox;
  usedMail?: string[];
  clientSecrets?: Record<string, string>;
  accounts: Record<string, Account>;
  clients: ClientGrant[];
  audit: Audit[];
};
export const accountKey = (site: string, identity: string) =>
  `${site}:${identity}`;
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function equalToken(a: string, b: string): boolean {
  const x = Buffer.from(hashToken(a), "hex");
  const y = Buffer.from(hashToken(b), "hex");
  return timingSafeEqual(x, y);
}
export class Store {
  state!: State;
  envelope!: KeyEnvelope;
  private key!: Buffer;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly dir = resolve(process.env.RELAY_DATA_DIR ?? "data")) {}
  async open() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    if (process.platform === "win32") {
      const user = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
      await promisify(execFile)(
        "icacls.exe",
        [
          this.dir,
          "/inheritance:r",
          "/grant:r",
          `${user}:(OI)(CI)F`,
          "SYSTEM:(OI)(CI)F",
        ],
        { windowsHide: true },
      );
    }
    const keyFile = join(this.dir, "master-key.json");
    try {
      this.envelope = JSON.parse(await readFile(keyFile, "utf8"));
      this.key = await recoverKey(this.envelope);
      this.state = unseal<State>(
        JSON.parse(await readFile(join(this.dir, "vault.enc"), "utf8")),
        this.key,
        this.envelope.id,
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT")
        throw new Error(
          "Cannot unlock Relay storage; do not delete its key or vault",
        );
      // A missing vault beside an existing key is a damaged store, never an invitation to reset it.
      if (
        await stat(keyFile).then(
          () => true,
          () => false,
        )
      )
        throw new Error(
          "Encrypted vault is missing; restore a matching backup",
        );
      this.key = randomBytes(32);
      this.envelope = await protectKey(
        this.key,
        process.env.RELAY_KEY_MODE === "passphrase" ? "passphrase" : "dpapi",
        randomUUID(),
      );
      this.state = {
        version: 1,
        ready: false,
        adminToken: randomBytes(32).toString("base64url"),
        accounts: {},
        clients: [],
        audit: [],
      };
      await this.atomic(keyFile, this.envelope);
      await this.persist();
    }
    return this;
  }
  private async atomic(path: string, value: unknown) {
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await rename(temp, path);
  }
  private persist() {
    return this.atomic(
      join(this.dir, "vault.enc"),
      seal(this.state, this.key, this.envelope.id),
    );
  }
  async update<T>(fn: (state: State) => T | Promise<T>): Promise<T> {
    const job = this.queue.then(async () => {
      const previous = structuredClone(this.state);
      try {
        const result = await fn(this.state);
        await this.persist();
        return result;
      } catch (error) {
        this.state = previous;
        throw error;
      }
    });
    this.queue = job.catch(() => {});
    return job;
  }
  async rewrap(mode: Protection) {
    const envelope = await protectKey(this.key, mode, this.envelope.id);
    await this.atomic(join(this.dir, "master-key.json"), envelope);
    this.envelope = envelope;
  }
  async audit(action: string, status: string, site?: string, reason?: string) {
    await this.update((s) => {
      s.audit.unshift({
        id: randomUUID(),
        at: new Date().toISOString(),
        action,
        status,
        site,
        reason,
      });
      s.audit = s.audit.slice(0, 500);
    });
  }
  close() {
    this.key?.fill(0);
  }
}
