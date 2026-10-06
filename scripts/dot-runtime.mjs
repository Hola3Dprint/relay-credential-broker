import { spawn } from "node:child_process";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
let clientAuthorization = "";
const redact = (value) =>
  String(value)
    .replaceAll(key || "\0", "[REDACTED]")
    .replaceAll(clientAuthorization || "\0", "[REDACTED]")
    .replaceAll(
      clientAuthorization.replace(/^Bearer /, "") || "\0",
      "[REDACTED]",
    )
    .replaceAll(process.env.RELAY_PASSPHRASE || "\0", "[REDACTED]")
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
      : join(
          repo,
          "data",
          "tools",
          "tunnel-client",
          process.platform === "win32" ? "tunnel-client.exe" : "tunnel-client",
        );
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
  if (action === "save-service-key" && process.platform !== "win32")
    throw new Error("The DPAPI service helper requires Windows.");
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
  // Managed connect regenerates the profile before starting (or reusing) its
  // child. Supply the handshake setting at launch as well as persisting it.
  const env = {
    ...process.env,
    MCP_STDIO_SEND_INITIALIZED_NOTIFICATION: "true",
  };
  const useHttp = connection.mcpServerUrl !== undefined;
  if (useHttp && connection.mcpServerUrl !== "http://127.0.0.1:4318/mcp")
    throw new Error(
      "Relay HTTP MCP must use its authenticated loopback endpoint.",
    );
  if (!["status", "stop"].includes(action)) {
    const keyPath = join(repo, ".env.local");
    const keyStat = await lstat(keyPath);
    if (keyStat.isSymbolicLink())
      throw new Error("Refusing a linked credential file.");
    if (
      process.platform !== "win32" &&
      ((keyStat.mode & 0o077) !== 0 || keyStat.uid !== process.getuid())
    )
      throw new Error(
        "The credential file must be owner-only: chmod 600 .env.local.",
      );
    key = parseEnv(await readFile(keyPath, "utf8")).OPENAI_API_KEY || "";
    if (!key)
      throw new Error(
        "OPENAI_API_KEY is missing from the approved .env.local file.",
      );
    env.CONTROL_PLANE_API_KEY = key;
    if (useHttp) {
      const { Store } = await import(
        pathToFileURL(join(repo, "dist/server/store.js")).href
      );
      const dataDir = resolve(process.env.RELAY_DATA_DIR ?? join(repo, "data"));
      await lstat(join(dataDir, "vault.enc"));
      const store = await new Store(dataDir).open();
      const token = store.state.clientSecrets?.[connection.clientId];
      store.close();
      if (!token)
        throw new Error("A scoped client grant is required for HTTP MCP.");
      clientAuthorization = `Bearer ${token}`;
      env.RELAY_MCP_AUTHORIZATION = clientAuthorization;
      env.MCP_EXTRA_HEADERS = "Authorization: env:RELAY_MCP_AUTHORIZATION";
    }
  }
  const targetArgs = useHttp
    ? ["--mcp-server-url", connection.mcpServerUrl]
    : ["--mcp-command", connection.mcpCommand];
  const initArgs = [
    "init",
    "--profile",
    "relay",
    "--profile-dir",
    profileDir,
    "--tunnel-id",
    connection.tunnelId,
    ...targetArgs,
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
      ...targetArgs,
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
  if (process.exitCode === 0 && ["init", "connect"].includes(action)) {
    // Official init/connect profiles are JSON (also valid YAML). Connect
    // replaces custom fields, so restore this setting after every generation.
    const profilePath = join(profileDir, "relay.yaml");
    const profile = JSON.parse(await readFile(profilePath, "utf8"));
    profile.mcp ??= {};
    if (useHttp)
      profile.mcp.extra_headers = { Authorization: "env:RELAY_MCP_AUTHORIZATION" };
    else profile.mcp.stdio_send_initialized_notification = true;
    await writeFile(profilePath, JSON.stringify(profile, null, 2) + "\n");
  }
} catch (error) {
  console.error(redact(error.message));
  process.exitCode = 1;
}
