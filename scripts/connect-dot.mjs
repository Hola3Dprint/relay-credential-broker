import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [clientId, tunnelId] = process.argv.slice(2);
const quote = (value) => {
  if (/[\r\n\0]/.test(value)) throw new Error("Invalid command path.");
  // This is parsed by tunnel-client as a command, not executed by a shell.
  return (
    '"' +
    value
      .replace(/\\/g, process.platform === "win32" ? "/" : "\\\\")
      .replace(/"/g, '\\"') +
    '"'
  );
};

try {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      clientId || "",
    ) ||
    !/^tunnel_[A-Za-z0-9]+$/.test(tunnelId || "")
  )
    throw new Error(
      "Use the client ID from Relay and the tunnel ID from OpenAI Platform.",
    );
  const mcp = join(repo, "dist/server/mcp.js");
  const dataDir = resolve(process.env.RELAY_DATA_DIR || join(repo, "data"));
  await access(mcp);
  await mkdir(join(repo, "data"), { recursive: true, mode: 0o700 });
  const connection = {
    tunnelId,
    clientId,
    profile: "relay",
    mcpCommand: `${quote(process.execPath)} ${quote(mcp)} --data-dir ${quote(dataDir)} --client-id ${clientId}`,
  };
  // Configuration contains IDs and paths only; no API or client token.
  await writeFile(
    join(repo, "data/dot-connection.json"),
    JSON.stringify(connection, null, 2) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    "Prepared the private Dot connection. See docs/MAC.md for the official client and secure credential setup.",
  );
} catch (error) {
  console.error(
    error.code === "EEXIST"
      ? "Connection metadata already exists. Review it before replacing it."
      : "Connection preparation failed. Check IDs and run npm run build first.",
  );
  process.exitCode = 1;
}
