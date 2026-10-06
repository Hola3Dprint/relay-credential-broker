import { spawn } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { release } from "node:os";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const action = process.argv[2];
const flags = process.argv.slice(3);
class MacSetupError extends Error {}
let broker;
let dotStarted = false;
let stopping;
let env;

function hiddenInput(label) {
  if (!process.stdin.isTTY || !process.stderr.isTTY)
    throw new MacSetupError(
      "Open a local terminal to enter the vault passphrase privately.",
    );
  return new Promise((accept, reject) => {
    const input = process.stdin;
    const wasRaw = input.isRaw;
    let value = "";
    const finish = (error) => {
      input.off("data", data);
      input.off("end", ended);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      process.stderr.write("\n");
      if (error) reject(error);
      else accept(value);
    };
    const ended = () => finish(new MacSetupError("Passphrase entry ended."));
    const data = (chunk) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u0003")
          return finish(new MacSetupError("Startup canceled."));
        if (char === "\u007f" || char === "\b")
          value = Array.from(value).slice(0, -1).join("");
        else if (char >= " " && value.length < 4096) value += char;
      }
    };
    process.stderr.write(label);
    input.setRawMode(true);
    input.on("data", data);
    input.once("end", ended);
    input.resume();
  });
}

async function run(command, args, childEnv = process.env) {
  const child = spawn(command, args, {
    cwd: repo,
    env: childEnv,
    stdio: ["ignore", "inherit", "inherit"],
  });
  const code = await new Promise((accept, reject) => {
    child.once("error", () =>
      reject(new MacSetupError("A required local helper could not start.")),
    );
    child.once("close", (exitCode) => accept(exitCode));
  });
  if (code !== 0)
    throw new MacSetupError(
      "A required local helper failed. Review its diagnostics above.",
    );
}

async function checkPort() {
  const probe = createServer();
  await new Promise((accept, reject) => {
    probe.once("error", () =>
      reject(
        new MacSetupError(
          "Port 4318 is in use. Stop the existing broker before starting another.",
        ),
      ),
    );
    probe.listen(4318, "127.0.0.1", () => probe.close(accept));
  });
}

function stop() {
  if (stopping) return stopping;
  stopping = (async () => {
    if (dotStarted) {
      dotStarted = false;
      await run(
        process.execPath,
        [join(repo, "scripts/dot-runtime.mjs"), "stop"],
        env,
      ).catch(() => {
        process.stderr.write(
          "Stop the Relay tunnel separately if it is still running.\n",
        );
      });
    }
    broker?.kill("SIGTERM");
  })();
  return stopping;
}

async function main() {
  if (!action || action === "--help") {
    console.log(
      "Usage: node scripts/mac.mjs setup|start [--with-dot] [--no-console]",
    );
    return;
  }
  if (
    !["setup", "start"].includes(action) ||
    flags.some((flag) => !["--with-dot", "--no-console"].includes(flag))
  )
    throw new MacSetupError("Use setup or start with the documented options.");
  if (process.platform !== "darwin")
    throw new MacSetupError("This launcher requires your own Mac.");
  if (Number(release().split(".")[0]) < 23)
    throw new MacSetupError("Use macOS 14 or later.");
  if (Number(process.versions.node.split(".")[0]) < 22)
    throw new MacSetupError("Install Node.js 22 or newer first.");
  if (action === "setup") {
    await run("npm", ["ci"]);
    await run("npm", ["run", "browser:install"]);
    await run("npm", ["run", "build"]);
    console.log(
      "Mac files are ready. Run npm run start:mac, then pair Chrome in Relay Settings.",
    );
    return;
  }
  await access(join(repo, "dist/server/server.js"));
  await checkPort();
  const dataDir = resolve(process.env.RELAY_DATA_DIR || join(repo, "data"));
  let existing = false;
  try {
    const key = JSON.parse(
      await readFile(join(dataDir, "master-key.json"), "utf8"),
    );
    existing = true;
    if (key.mode !== "passphrase")
      throw new MacSetupError(
        "This store is tied to Windows. Create a fresh Mac vault; do not overwrite it.",
      );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (flags.includes("--with-dot")) {
    await access(join(repo, "data/dot-connection.json"));
    await access(join(repo, ".env.local"));
    await access(join(repo, "data/tools/tunnel-client/tunnel-client"));
  }
  let passphrase = process.env.RELAY_PASSPHRASE;
  if (!passphrase) {
    passphrase = await hiddenInput(
      existing
        ? "Vault unlock passphrase: "
        : "Create a vault unlock passphrase (20+ characters): ",
    );
    if (
      !existing &&
      passphrase !==
        (await hiddenInput("Confirm the vault unlock passphrase: "))
    )
      throw new MacSetupError("Passphrase confirmation did not match.");
  }
  if (passphrase.length < 20)
    throw new MacSetupError(
      "The vault unlock passphrase must contain at least 20 characters.",
    );
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  env = {
    ...process.env,
    RELAY_KEY_MODE: "passphrase",
    RELAY_PASSPHRASE: passphrase,
    RELAY_DATA_DIR: dataDir,
  };
  passphrase = undefined;
  broker = spawn(process.execPath, [join(repo, "dist/server/server.js")], {
    cwd: repo,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  let exited = false;
  const closed = new Promise((accept) => {
    broker.once("error", () => {
      exited = true;
      accept(1);
    });
    broker.once("close", (code) => {
      exited = true;
      accept(code ?? 1);
    });
  });
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  let ready = false;
  for (let attempt = 0; attempt < 100 && !exited && !stopping; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:4318/api/health", {
        signal: AbortSignal.timeout(1000),
      });
      ready = response.ok;
    } catch {}
    if (ready) break;
    await new Promise((accept) => setTimeout(accept, 100));
  }
  if (stopping) {
    await closed;
    return;
  }
  if (!ready || exited)
    throw new MacSetupError("Relay could not start or unlock the Mac vault.");
  if (!flags.includes("--no-console"))
    await run(process.execPath, [join(repo, "dist/server/console.js")], env);
  if (flags.includes("--with-dot")) {
    for (const operation of ["init", "doctor", "connect"])
      await run(
        process.execPath,
        [join(repo, "scripts/dot-runtime.mjs"), operation],
        env,
      );
    dotStarted = true;
  }
  console.log(
    "Relay is running on this Mac. Keep this terminal open; Control-C stops this launch.",
  );
  const code = await closed;
  const requestedStop = Boolean(stopping);
  await stop();
  process.exitCode = requestedStop ? 0 : code;
}

main().catch(async (error) => {
  // Fixed error text avoids exposing an environment-provided passphrase or credential.
  process.stderr.write(
    error instanceof MacSetupError
      ? error.message + "\n"
      : "Mac setup/start failed. Check the build, local files and vault passphrase.\n",
  );
  await stop();
  process.exitCode = 1;
});
