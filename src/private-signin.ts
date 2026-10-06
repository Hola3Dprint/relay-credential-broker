import { randomUUID } from "node:crypto";
import { z } from "zod";
import { demoCredential } from "./demo.js";
import type { ClientGrant, Store } from "./store.js";

export const dotIdSchema = z.string().uuid();
export const privateDotUrlSchema = z
  .string()
  .trim()
  .max(500)
  .default("")
  .transform((v, ctx) => {
    if (!v) return undefined;
    try {
      const url = new URL(v);
      const match = /^\/dots\/([0-9a-f-]{36})\/?$/.exec(url.pathname);
      if (
        url.origin === "https://chatgpt.com" &&
        !url.search &&
        !url.hash &&
        match
      )
        return dotIdSchema.parse(match[1]);
    } catch {}
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Use the exact ChatGPT Dot address",
    });
    return z.NEVER;
  });
export const privateOriginSchema = z
  .string()
  .url()
  .max(500)
  .refine((v) => new URL(v).origin === v && new URL(v).protocol === "https:");
export const privateDeliverySchema = z.object({
  id: z.string().uuid(),
  tabId: z.number().int().nonnegative(),
  dotId: dotIdSchema,
  origin: privateOriginSchema,
  nonce: z.string().uuid(),
  fields: z
    .array(z.enum(["username", "password"]))
    .min(1)
    .max(2)
    .refine((v) => new Set(v).size === v.length),
});
type Job = {
  id: string;
  clientId: string;
  dotId: string;
  origin: string;
  demo: boolean;
  expires: number;
  status: "ARMED" | "DELIVERED" | "FILLED" | "BLOCKED";
  reason?: string;
  companion?: string;
};

// A pending job contains only routing metadata. Values are released once, to
// the paired companion, after it identifies the native private sign-in form.
export class PrivateSignIn {
  private jobs = new Map<string, Job>();
  constructor(private store: Store) {}
  private granted(job: Job) {
    const client = this.store.state.clients.find((c) => c.id === job.clientId);
    return (
      client?.privateSignInDotId === job.dotId &&
      client.operations.includes("prepare_private_signin") &&
      client.operations.includes("fill_saved_username") &&
      client.operations.includes("fill_saved_password") &&
      (!job.demo || client.accounts.includes("relay-demo:business"))
    );
  }
  private validate(job: Job) {
    if (!["ARMED", "DELIVERED"].includes(job.status)) return;
    if (Date.now() > job.expires || !this.granted(job)) {
      job.status = "BLOCKED";
      job.reason =
        Date.now() > job.expires ? "PRIVATE_SIGNIN_EXPIRED" : "GRANT_REVOKED";
    }
  }
  prepare(client: ClientGrant, origin: string, demo = false) {
    privateOriginSchema.parse(origin);
    const dotId = dotIdSchema.parse(client.privateSignInDotId);
    const job: Job = {
      id: randomUUID(),
      clientId: client.id,
      dotId,
      origin,
      demo,
      expires: Date.now() + 300000,
      status: "ARMED",
    };
    if (!this.granted(job)) throw new Error("PRIVATE_SIGNIN_NOT_GRANTED");
    if (!demo && !this.store.state.sharedCredential)
      return { status: "BLOCKED", reason: "SHARED_CREDENTIAL_NOT_CONFIGURED" };
    for (const old of this.jobs.values()) {
      this.validate(old);
      if (old.status === "DELIVERED" && old.dotId === dotId)
        return { status: "BLOCKED", reason: "PRIVATE_SIGNIN_IN_PROGRESS" };
      if (old.status === "ARMED" && old.dotId === dotId) {
        old.status = "BLOCKED";
        old.reason = "SUPERSEDED";
      }
    }
    this.jobs.set(job.id, job);
    // Bound in-memory history; jobs and plaintext values are never persisted.
    for (const [id, old] of this.jobs) {
      if (this.jobs.size <= 100) break;
      if (!["ARMED", "DELIVERED"].includes(old.status)) this.jobs.delete(id);
    }
    void this.store
      .audit("prepare_private_signin", "ARMED", undefined, origin)
      .catch(() => {});
    return {
      status: "ARMED",
      requestId: job.id,
      origin,
      expiresInSeconds: 300,
      demo,
      instructions:
        "Now request native private sign-in. Relay fills the matching form locally and leaves Sign in confirmation to the owner.",
    };
  }
  status(client: ClientGrant, id: string) {
    const job = this.jobs.get(id);
    if (!job || job.clientId !== client.id)
      throw new Error("PRIVATE_SIGNIN_NOT_GRANTED");
    this.validate(job);
    return {
      requestId: job.id,
      status: job.status,
      origin: job.origin,
      demo: job.demo,
      ...(job.reason ? { reason: job.reason } : {}),
    };
  }
  pending() {
    return [...this.jobs.values()]
      .filter((job) => {
        this.validate(job);
        return job.status === "ARMED";
      })
      .map(({ id, dotId, origin, expires, demo }) => ({
        id,
        dotId,
        origin,
        expires,
        demo,
      }));
  }
  deliver(companion: string, input: z.infer<typeof privateDeliverySchema>) {
    privateDeliverySchema.parse(input);
    const job = this.jobs.get(input.id);
    if (!job) throw new Error("PRIVATE_SIGNIN_NOT_GRANTED");
    this.validate(job);
    if (
      job.status !== "ARMED" ||
      input.dotId !== job.dotId ||
      input.origin !== job.origin
    )
      throw new Error("PRIVATE_SIGNIN_NOT_GRANTED");
    const credential = job.demo
      ? demoCredential
      : this.store.state.sharedCredential;
    if (!credential) throw new Error("CREDENTIAL_UNAVAILABLE");
    job.status = "DELIVERED";
    job.companion = companion;
    return {
      id: job.id,
      dotId: job.dotId,
      origin: job.origin,
      tabId: input.tabId,
      nonce: input.nonce,
      expires: job.expires,
      fields: input.fields.map((field) => ({
        field,
        value: credential[field],
      })),
    };
  }
  complete(companion: string, id: string, status: "FILLED" | "BLOCKED") {
    const job = this.jobs.get(id);
    if (!job || job.companion !== companion || job.status !== "DELIVERED")
      throw new Error("PRIVATE_SIGNIN_NOT_GRANTED");
    this.validate(job);
    if (job.status !== "DELIVERED") return;
    job.status = status;
    if (status === "BLOCKED") job.reason = "PRIVATE_FORM_CHANGED";
    void this.store
      .audit("private_signin_fill", status, undefined, job.origin)
      .catch(() => {});
  }
  revokeClient(id: string) {
    for (const job of this.jobs.values())
      if (job.clientId === id) {
        job.status = "BLOCKED";
        job.reason = "GRANT_REVOKED";
      }
  }
  revokeCompanion(id: string) {
    for (const job of this.jobs.values())
      if (job.companion === id) {
        job.status = "BLOCKED";
        job.reason = "BROWSER_REVOKED";
      }
  }
  close() {
    this.jobs.clear();
  }
}
