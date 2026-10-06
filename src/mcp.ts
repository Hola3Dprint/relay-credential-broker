import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcp } from "./tools.js";
import { Store } from "./store.js";

async function main() {
  if (process.argv.includes("--data-dir"))
    process.env.RELAY_DATA_DIR =
      process.argv[process.argv.indexOf("--data-dir") + 1];
  const clientId = process.argv[process.argv.indexOf("--client-id") + 1];
  const store = await new Store().open();
  const token =
    process.env.RELAY_CLIENT_TOKEN ?? store.state.clientSecrets?.[clientId];
  store.close();
  if (!token) throw new Error("A scoped client grant is required");
  const url = process.env.RELAY_BROKER_URL ?? "http://127.0.0.1:4318";
  if (
    new URL(url).hostname !== "127.0.0.1" &&
    new URL(url).hostname !== "localhost"
  )
    throw new Error("The stdio bridge must call a local broker");
  const server = createMcp(async (op, input) => {
    const response = await fetch(`${url}/api/agent/${op}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok) throw new Error("Broker request denied");
    return response.json();
  });
  await server.connect(new StdioServerTransport());
}
main().catch(() => {
  process.stderr.write(
    "Relay MCP bridge could not start. Verify broker health and the client grant.\n",
  );
  process.exitCode = 1;
});
