import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.log("Mac startup verification requires macOS.");
  process.exit(0);
}
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = await mkdtemp(join(tmpdir(), "relay-mac-check-"));
const env = {
  ...process.env,
  RELAY_DATA_DIR: dataDir,
  RELAY_PASSPHRASE: "public-test-fixture-mac-vault-unlock",
};
let child;
let closed;
let vaultId;
try {
  for (let cycle = 0; cycle < 2; cycle++) {
    let output = "";
    child = spawn(
      process.execPath,
      ["scripts/mac.mjs", "start", "--no-console"],
      { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stdout.on("data", (value) => {
      output += value;
    });
    child.stderr.on("data", (value) => {
      output += value;
    });
    closed = new Promise((accept) => child.once("close", accept));
    let healthy = false;
    for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) {
      try {
        healthy = (
          await fetch("http://127.0.0.1:4318/api/health", {
            signal: AbortSignal.timeout(500),
          })
        ).ok;
      } catch {}
      if (healthy) break;
      await new Promise((accept) => setTimeout(accept, 100));
    }
    assert(healthy, "Mac broker must reach its local health endpoint");
    const envelope = JSON.parse(
      await readFile(join(dataDir, "master-key.json"), "utf8"),
    );
    assert.equal(envelope.mode, "passphrase");
    if (vaultId)
      assert.equal(envelope.id, vaultId, "Restart must reopen the same vault");
    vaultId = envelope.id;
    assert(!JSON.stringify(envelope).includes(env.RELAY_PASSPHRASE));
    assert(
      !output.includes(env.RELAY_PASSPHRASE),
      "Launcher output must not contain the unlock passphrase",
    );
    child.kill("SIGTERM");
    assert.equal(await closed, 0, "The launcher must stop cleanly");
    assert(
      !output.includes(env.RELAY_PASSPHRASE),
      "Shutdown output must keep the passphrase private",
    );
    child = undefined;
  }
  console.log(
    "Mac broker startup, encrypted vault reopen and private launcher output passed.",
  );
} finally {
  if (child) {
    child.kill("SIGTERM");
    await closed;
  }
  await rm(dataDir, { recursive: true, force: true });
}
