import { z } from "zod";

export const id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const selector = z.string().min(1).max(300);
const origin = z
  .string()
  .url()
  .refine((v) => {
    const url = new URL(v);
    return (
      url.origin === v &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && url.hostname === "127.0.0.1"))
    );
  }, "Use an HTTPS origin, or 127.0.0.1 for local tests");
export const credentialsSchema = z.object({
  username: z.string().min(1).max(320),
  password: z.string().min(1).max(4096),
  totpSecret: z
    .string()
    .regex(/^[A-Z2-7\s=]+$/i)
    .optional(),
  recoveryCodes: z.array(z.string().min(1).max(200)).max(100).default([]),
});
export type Credential = z.infer<typeof credentialsSchema>;
const mailRule = z.object({
  sender: z.string().email(),
  subjectIncludes: z.string().min(3).max(100),
  codePattern: z
    .enum(["\\b([0-9]{6})\\b", "\\b([0-9]{8})\\b"])
    .default("\\b([0-9]{6})\\b"),
  dkimDomain: z
    .string()
    .regex(/^[a-z0-9.-]+$/i)
    .optional(),
});
const flow = z.object({
  url: z.string().url(),
  username: selector,
  password: selector,
  submit: selector,
  success: selector,
});
export const siteSchema = z
  .object({
    id,
    name: z.string().min(1).max(80),
    identity: id.default("business"),
    origins: z.array(origin).min(1).max(8),
    login: flow,
    mfa: z
      .object({
        input: selector,
        submit: selector,
        method: z.enum(["totp", "email", "recovery"]).default("totp"),
        mail: mailRule.optional(),
      })
      .optional(),
    blockedSelectors: z.array(selector).max(20).default([]),
    sessionCheckUrl: z.string().url(),
    taskPages: z.array(z.string().url()).max(30).default([]),
    signup: flow
      .extend({
        confirmPassword: selector.optional(),
        verificationMail: mailRule.optional(),
        verificationOrigins: z.array(origin).max(4).default([]),
        totpEnrollment: z
          .object({
            url: z.string().url(),
            secret: selector,
            code: selector,
            submit: selector,
            success: selector,
            recoveryCodes: selector.optional(),
          })
          .optional(),
      })
      .optional(),
    reset: z
      .object({
        expired: selector,
        requestUrl: z.string().url(),
        username: selector,
        requestSubmit: selector,
        mail: mailRule,
        linkOrigins: z.array(origin).min(1).max(4),
        newPassword: selector,
        confirmPassword: selector.optional(),
        submit: selector,
        success: selector,
      })
      .optional(),
    renewalMinutes: z.number().int().min(15).max(10080).default(720),
    timeoutMs: z.number().int().min(1000).max(60000).default(15000),
  })
  .superRefine((s, ctx) => {
    const urls = [
      s.login.url,
      s.sessionCheckUrl,
      ...s.taskPages,
      ...(s.signup
        ? [
            s.signup.url,
            ...(s.signup.totpEnrollment ? [s.signup.totpEnrollment.url] : []),
          ]
        : []),
      ...(s.reset ? [s.reset.requestUrl] : []),
    ];
    for (const url of urls)
      if (!s.origins.includes(new URL(url).origin))
        ctx.addIssue({
          code: "custom",
          message: "Every configured URL must belong to an allowed origin",
        });
    if (s.mfa?.method === "email" && !s.mfa.mail)
      ctx.addIssue({
        code: "custom",
        message: "Email MFA requires a mail rule",
      });
    const verificationOrigins = [
      ...(s.signup?.verificationOrigins ?? []),
      ...(s.reset?.linkOrigins ?? []),
    ];
    for (const value of verificationOrigins)
      if (!s.origins.includes(value))
        ctx.addIssue({
          code: "custom",
          message: "Email links must stay on allowed site origins",
        });
    if (s.signup?.verificationMail && !s.signup.verificationOrigins.length)
      ctx.addIssue({
        code: "custom",
        message: "Signup email verification requires allowed link origins",
      });
  });
export type Site = z.infer<typeof siteSchema>;
export const mailboxSchema = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535).default(993),
  username: z.string().min(1).max(320),
  password: z.string().min(1).max(4096),
  folder: z.string().min(1).max(100).default("INBOX"),
  aliasTemplate: z.string().email().optional(),
  authservId: z
    .string()
    .regex(/^[a-z0-9._-]+$/i)
    .min(3)
    .max(253),
});
export type Mailbox = z.infer<typeof mailboxSchema>;
export const bindingSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("local") }),
  z.object({ provider: z.literal("bitwarden"), secretId: z.string().uuid() }),
]);
export type Binding = z.infer<typeof bindingSchema>;
export type LoginResult = {
  status: "AUTHENTICATED" | "BLOCKED" | "ERROR";
  site: string;
  identity: string;
  reason?: string;
  reused?: boolean;
};
