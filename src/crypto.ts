import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export type Envelope = { version: 1; iv: string; tag: string; data: string };
export function seal(value: unknown, key: Buffer, aad: string): Envelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}
export function unseal<T>(value: Envelope, key: Buffer, aad: string): T {
  if (value.version !== 1)
    throw new Error("Unsupported encrypted store version");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(value.iv, "base64"),
  );
  cipher.setAAD(Buffer.from(aad));
  cipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(value.data, "base64")),
      cipher.final(),
    ]).toString(),
  );
}
export type Protection = "dpapi" | "tpm" | "passphrase";
export type KeyEnvelope = {
  version: 1;
  id: string;
  mode: Protection;
  value: string;
  salt?: string;
};
async function windows(
  mode: "dpapi" | "tpm",
  action: "wrap" | "unwrap",
  value: string,
  id: string,
): Promise<string> {
  if (process.platform !== "win32")
    throw new Error("This key protector requires Windows");
  const script = resolve(
    fileURLToPath(new URL("../../scripts/key-protector.ps1", import.meta.url)),
  );
  // Compiled code is dist/server/crypto.js; source is src/crypto.ts.
  const sourceScript = resolve(process.cwd(), "scripts/key-protector.ps1");
  const actualScript = import.meta.url.includes("/dist/")
    ? script
    : sourceScript;
  return new Promise((accept, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        actualScript,
        "-Mode",
        mode,
        "-Action",
        action,
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.resume();
    const timer = setTimeout(() => child.kill(), 30000);
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Windows key protector is unavailable"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && /^[A-Za-z0-9+/=\r\n]+$/.test(output))
        accept(output.trim());
      else
        reject(
          new Error(
            "Windows key protection failed; verify TPM and service identity",
          ),
        );
    });
    child.stdin.end(JSON.stringify({ id, value }));
  });
}
export async function protectKey(
  key: Buffer,
  mode: Protection,
  id: string,
): Promise<KeyEnvelope> {
  if (mode === "passphrase") {
    const passphrase = process.env.RELAY_PASSPHRASE;
    if (!passphrase || passphrase.length < 20)
      throw new Error(
        "Set RELAY_PASSPHRASE to at least 20 characters for portable mode",
      );
    const salt = randomBytes(16);
    const wrappingKey = scryptSync(passphrase, salt, 32);
    try {
      return {
        version: 1,
        id,
        mode,
        salt: salt.toString("base64"),
        value: JSON.stringify(seal(key.toString("base64"), wrappingKey, id)),
      };
    } finally {
      wrappingKey.fill(0);
    }
  }
  return {
    version: 1,
    id,
    mode,
    value: await windows(mode, "wrap", key.toString("base64"), id),
  };
}
export async function recoverKey(envelope: KeyEnvelope): Promise<Buffer> {
  if (envelope.mode === "passphrase") {
    if (!process.env.RELAY_PASSPHRASE)
      throw new Error(
        "RELAY_PASSPHRASE is required to unlock this portable store",
      );
    const key = scryptSync(
      process.env.RELAY_PASSPHRASE,
      Buffer.from(envelope.salt!, "base64"),
      32,
    );
    try {
      return Buffer.from(
        unseal<string>(JSON.parse(envelope.value), key, envelope.id),
        "base64",
      );
    } finally {
      key.fill(0);
    }
  }
  return Buffer.from(
    await windows(envelope.mode, "unwrap", envelope.value, envelope.id),
    "base64",
  );
}
