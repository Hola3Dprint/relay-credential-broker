import { spawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const action = process.argv[2];
if (
  !["init", "doctor", "connect", "status", "stop", "save-service-key"].includes(
    action,
  )
) {
  console.log(
    "Usage: node scripts/dot-runtime.mjs init|doctor|connect|status|stop|save-service-key",
  );
  process.exit(action ? 1 : 0);
}

let key = "";
const redact = (value) =>
  String(value)
    .replaceAll(key || "\0", "[REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]");

async function execute(args, env) {
  const binary =
    action === "save-service-key"
      ? join(
          process.env.SystemRoot || "C:/Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        )
      : join(repo, "data", "tools", "tunnel-client", "tunnel-client.exe");
  await lstat(binary);
  return await new Promise((done, reject) => {
    const child = spawn(binary, args, {
      cwd: repo,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk) => {
      output += chunk.toString();
      if (output.length > 1_000_000) child.kill();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", (code) => {
      // Buffer complete output before redaction so chunk boundaries cannot reveal a key.
      const safeOutput = redact(output);
      if (code === 0 && ["connect", "status", "stop"].includes(action)) {
        try {
          const result = JSON.parse(safeOutput);
          const fields = [
            "alias",
            "tunnel_id",
            "process_running",
            "healthy",
            "ready",
            "runtime_state",
            "ui_url",
            "config_path",
            "error",
          ];
          const summary = Object.fromEntries(
            fields
              .filter((field) => field in result)
              .map((field) => [field, result[field]]),
          );
          process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
        } catch {
          process.stdout.write(safeOutput);
        }
      } else {
        process.stdout.write(safeOutput);
      }
      done(code ?? 1);
    });
  });
}

try {
  const connection = JSON.parse(
    await readFile(join(repo, "data", "dot-connection.json"), "utf8"),
  );
  if (
    !/^tunnel_[A-Za-z0-9]+$/.test(connection.tunnelId) ||
    !/^[0-9a-f-]{36}$/.test(connection.clientId) ||
    typeof connection.mcpCommand !== "string"
  ) {
    throw new Error(
      "Invalid local Dot connection. Run scripts/connect-dot.ps1 first.",
    );
  }
  const profileDir = join(repo, "data", "tunnel-profiles");
  const env = { ...process.env };
  if (!["status", "stop"].includes(action)) {
    const keyPath = join(repo, ".env.local");
    if ((await lstat(keyPath)).isSymbolicLink())
      throw new Error("Refusing a linked credential file.");
    key = parseEnv(await readFile(keyPath, "utf8")).OPENAI_API_KEY || "";
    if (!key)
      throw new Error(
        "OPENAI_API_KEY is missing from the approved .env.local file.",
      );
    env.CONTROL_PLANE_API_KEY = key;
  }
  const initArgs = [
    "init",
    "--sample",
    "sample_mcp_stdio_local",
    "--profile",
    "relay",
    "--profile-dir",
    profileDir,
    "--tunnel-id",
    connection.tunnelId,
    "--mcp-command",
    connection.mcpCommand,
    "--health-listen-addr",
    "127.0.0.1:0",
    "--control-plane-api-key-ref",
    "env:CONTROL_PLANE_API_KEY",
  ];
  const args = {
    init: initArgs,
    doctor: [
      "doctor",
      "--profile",
      "relay",
      "--profile-dir",
      profileDir,
      "--explain",
    ],
    connect: [
      "runtimes",
      "--json",
      "connect",
      "--alias",
      "relay",
      "--profile",
      "relay",
      "--profile-dir",
      profileDir,
      "--tunnel-id",
      connection.tunnelId,
      "--mcp-command",
      connection.mcpCommand,
      "--runtime-api-key",
      "env:CONTROL_PLANE_API_KEY",
    ],
    status: ["runtimes", "--json", "status", "relay"],
    stop: ["runtimes", "--json", "stop", "relay"],
    "save-service-key": [
      "-NoProfile",
      "-File",
      join(repo, "scripts", "save-tunnel-credential.ps1"),
      "-FromEnvironment",
    ],
  }[action];
  process.exitCode = await execute(args, env);
} catch (error) {
  console.error(redact(error.message));
  process.exitCode = 1;
}
