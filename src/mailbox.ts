import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { Mailbox } from "./schema.js";

export type MailRule = {
  sender: string;
  subjectIncludes: string;
  codePattern?: string;
  dkimDomain?: string;
};
export function trustedAuthentication(
  header: string | undefined,
  authservId: string,
  domain: string,
) {
  if (!header) return false;
  const normalized = header
    .replace(/\r?\n\s+/g, " ")
    .replace(/^Authentication-Results:\s*/i, "")
    .trim();
  const parts = normalized.split(";");
  if (parts[0].trim().toLowerCase() !== authservId.toLowerCase()) return false;
  return parts
    .slice(1)
    .some(
      (part) =>
        /\bdkim=pass\b/i.test(part) &&
        part.match(/\bheader\.d=([^\s;]+)/i)?.[1].toLowerCase() ===
          domain.toLowerCase(),
    );
}
export function extractCode(
  text: string,
  pattern = "\\b([0-9]{6})\\b",
): string | undefined {
  // Deliberately support only bounded numeric OTPs; never execute arbitrary regular expressions.
  const widths: Record<string, number> = {
    "\\b([0-9]{6})\\b": 6,
    "\\b([0-9]{8})\\b": 8,
  };
  if (!widths[pattern]) throw new Error("MAIL_CODE_PATTERN_UNSUPPORTED");
  return text.match(new RegExp(`\\b([0-9]{${widths[pattern]}})\\b`))?.[1];
}
export function extractLink(
  text: string,
  origins: string[],
): string | undefined {
  for (const match of text.matchAll(/https:\/\/[^\s<>"']+/g)) {
    try {
      const url = new URL(match[0].replace(/&amp;/g, "&"));
      if (origins.includes(url.origin) && !url.username && !url.password)
        return url.href;
    } catch {}
  }
  return undefined;
}
export class MailboxReader {
  constructor(
    private config: Mailbox,
    private used: Set<string>,
    private consume: (id: string) => Promise<void>,
  ) {}
  async wait(
    rule: MailRule,
    after: Date,
    recipient: string,
    kind: "code" | "link",
    origins: string[] = [],
    timeout = 25000,
  ): Promise<string> {
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: true,
      auth: { user: this.config.username, pass: this.config.password },
      logger: false,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
    const deadline = Date.now() + timeout;
    try {
      await client.connect();
      const lock = await client.getMailboxLock(this.config.folder);
      try {
        while (Date.now() < deadline) {
          const ids = await client.search(
            { since: after, from: rule.sender },
            { uid: true },
          );
          if (ids && ids.length) {
            for await (const message of client.fetch(
              ids.slice(-30),
              { source: true, internalDate: true, uid: true },
              { uid: true },
            )) {
              const mailId = `${client.mailbox && client.mailbox.uidValidity}:${message.uid}`;
              if (
                this.used.has(mailId) ||
                !message.source ||
                message.source.length > 1_000_000
              )
                continue;
              if (
                !message.internalDate ||
                new Date(message.internalDate).getTime() <
                  after.getTime() - 2000
              )
                continue;
              const parsed = await simpleParser(message.source);
              // Trust only the top Authentication-Results stamped by the configured receiving MTA.
              // The mailbox provider must strip inbound forged copies of its own authserv-id.
              const authentication = parsed.headerLines.find(
                (v) => v.key === "authentication-results",
              )?.line;
              if (
                !trustedAuthentication(
                  authentication,
                  this.config.authservId,
                  rule.dkimDomain ?? rule.sender.split("@")[1],
                )
              )
                continue;
              if (
                !parsed.from?.value.some(
                  (v) => v.address?.toLowerCase() === rule.sender.toLowerCase(),
                )
              )
                continue;
              const recipients = [parsed.to, parsed.cc]
                .flat()
                .filter(Boolean)
                .flatMap((v) => v!.value.map((x) => x.address?.toLowerCase()));
              if (!recipients.includes(recipient.toLowerCase())) continue;
              if (
                !parsed.subject
                  ?.toLowerCase()
                  .includes(rule.subjectIncludes.toLowerCase())
              )
                continue;
              const text = `${parsed.text ?? ""}\n${parsed.html || ""}`;
              const value =
                kind === "code"
                  ? extractCode(text, rule.codePattern)
                  : extractLink(text, origins);
              if (value) {
                await this.consume(mailId);
                this.used.add(mailId);
                return value;
              }
            }
          }
          await new Promise((r) => setTimeout(r, 2000));
          await client.noop();
        }
        throw new Error("MAIL_TIMEOUT");
      } finally {
        lock.release();
      }
    } catch (error) {
      if ((error as Error).message === "MAIL_TIMEOUT") throw error;
      throw new Error("MAIL_UNAVAILABLE");
    } finally {
      await client.logout().catch(() => {});
    }
  }
}
