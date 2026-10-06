import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";
const clientId = process.argv[process.argv.indexOf("--client-id") + 1];
if (!/^[0-9a-f-]{36}$/.test(clientId ?? ""))
  throw new Error("Pass a client ID created in the Relay console");
const client = new Client({ name: "relay-verification", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    resolve("dist/server/mcp.js"),
    "--data-dir",
    resolve(process.env.RELAY_DATA_DIR ?? "data"),
    "--client-id",
    clientId,
  ],
  stderr: "pipe",
});
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  if (
    tools.length !== 7 ||
    tools.some((t) => /get_password|get_cookie|get_secret/.test(t.name))
  )
    throw new Error("Unexpected tool surface");
  const listed = await client.callTool({
    name: "list_accounts",
    arguments: {},
  });
  const accounts = JSON.parse(
    listed.content.find((c) => c.type === "text").text,
  );
  const demo = accounts.find((a) => a.site === "relay-demo");
  if (!demo)
    throw new Error("Grant the local demo account for this verification");
  const login = await client.callTool({
    name: "ensure_login",
    arguments: { site: demo.site, identity: demo.identity },
  });
  const result = JSON.parse(login.content.find((c) => c.type === "text").text);
  if (result.status !== "AUTHENTICATED") throw new Error("Demo sign-in failed");
  const page = await client.callTool({
    name: "read_account_page",
    arguments: {
      site: demo.site,
      identity: demo.identity,
      url: demo.taskPages[0],
    },
  });
  const data = JSON.parse(page.content.find((c) => c.type === "text").text);
  if (!data.text?.includes("PLA filament"))
    throw new Error("Authenticated page reading failed");
  console.log(
    "MCP stdio verified: tool discovery, scoped account list, sign-in, and authenticated page reading.",
  );
} finally {
  await client.close();
}
