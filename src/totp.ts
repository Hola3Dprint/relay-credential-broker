import { createHmac, randomBytes } from "node:crypto";
function decodeBase32(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.toUpperCase().replace(/[\s=]/g, "")) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("Invalid Base32 secret");
    bits += index.toString(2).padStart(5, "0");
  }
  if (bits.length < 80) throw new Error("TOTP secret is too short");
  return Buffer.from(bits.match(/.{8}/g)!.map((v) => parseInt(v, 2)));
}
export function totp(
  secret: string,
  now = Date.now(),
  digits = 6,
  period = 30,
  algorithm = "sha1",
): string {
  const key = decodeBase32(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / period)));
  try {
    const hmac = createHmac(algorithm, key).update(counter).digest();
    const offset = hmac[hmac.length - 1] & 15;
    return ((hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits)
      .toString()
      .padStart(digits, "0");
  } finally {
    key.fill(0);
  }
}
export function generatePassword() {
  return randomBytes(24).toString("base64url");
}
