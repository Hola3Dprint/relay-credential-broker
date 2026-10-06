import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { seal, unseal } from "../src/crypto.js";
import { totp, generatePassword } from "../src/totp.js";
import { siteSchema } from "../src/schema.js";
import {
  extractCode,
  extractLink,
  trustedAuthentication,
} from "../src/mailbox.js";
import { demoSite } from "../src/demo.js";
describe("credential boundaries", () => {
  it("authenticates ciphertext, key, and store identity", () => {
    const key = randomBytes(32);
    const envelope = seal({ password: "private" }, key, "store-a");
    expect(JSON.stringify(envelope)).not.toContain("private");
    expect(unseal(envelope, key, "store-a")).toEqual({ password: "private" });
    expect(() => unseal(envelope, key, "store-b")).toThrow();
    expect(() => unseal(envelope, randomBytes(32), "store-a")).toThrow();
    envelope.data = Buffer.from("altered").toString("base64");
    expect(() => unseal(envelope, key, "store-a")).toThrow();
  });
  it("matches the SHA-1 RFC 6238 test vectors", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const vectors = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ] as const;
    for (const [timestamp, expected] of vectors)
      expect(totp(secret, timestamp * 1000, 8)).toBe(expected);
    expect(() => totp("not-valid!")).toThrow();
  });
  it("creates distinct 32-character cryptographic passwords", () => {
    const passwords = new Set(Array.from({ length: 100 }, generatePassword));
    expect(passwords.size).toBe(100);
    for (const password of passwords) expect(password.length).toBe(32);
  });
  it("rejects cross-origin adapters and missing email verification rules", () => {
    const site = demoSite();
    expect(
      siteSchema.safeParse({
        ...site,
        sessionCheckUrl: "https://evil.example/login",
      }).success,
    ).toBe(false);
    expect(
      siteSchema.safeParse({
        ...site,
        mfa: { input: "#otp", submit: "#ok", method: "email" },
      }).success,
    ).toBe(false);
  });
  it("extracts only bounded numeric OTPs and explicitly allowed HTTPS links", () => {
    expect(extractCode("Your code is 123456.")).toBe("123456");
    expect(() => extractCode("anything", "(a+)+$")).toThrow();
    expect(
      extractLink(
        "https://evil.example/reset?token=secret https://good.example/reset?token=secret",
        ["https://good.example"],
      ),
    ).toBe("https://good.example/reset?token=secret");
    expect(
      extractLink("https://good.example.evil.test/reset", [
        "https://good.example",
      ]),
    ).toBeUndefined();
    expect(
      extractLink("https://user:pass@good.example/reset", [
        "https://good.example",
      ]),
    ).toBeUndefined();
  });
  it("requires aligned DKIM attested by the configured receiving mail server", () => {
    expect(
      trustedAuthentication(
        "Authentication-Results: mx.mail.test; dkim=pass header.d=supplier.test",
        "mx.mail.test",
        "supplier.test",
      ),
    ).toBe(true);
    expect(
      trustedAuthentication(
        "Authentication-Results: attacker.test; dkim=pass header.d=supplier.test",
        "mx.mail.test",
        "supplier.test",
      ),
    ).toBe(false);
    expect(
      trustedAuthentication(
        "Authentication-Results: mx.mail.test; dkim=fail header.d=supplier.test",
        "mx.mail.test",
        "supplier.test",
      ),
    ).toBe(false);
    expect(
      trustedAuthentication(
        "Authentication-Results: mx.mail.test; dkim=pass header.d=attacker.test",
        "mx.mail.test",
        "supplier.test",
      ),
    ).toBe(false);
  });
});
