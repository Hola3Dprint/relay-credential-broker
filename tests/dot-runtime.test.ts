import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const scriptUrl = new URL("../scripts/dot-runtime.mjs", import.meta.url);
const source = readFileSync(scriptUrl, "utf8")
  .replace(/^import .*;\r?\n/gm, "")
  .replace("await import(", "await loadModule(")
  .replaceAll("import.meta.url", "scriptUrl");

async function run(
  action: string,
  toolExit = 0,
  mcpServerUrl?: string,
  token = "public-client-token",
) {
  // Model the official client's generated profile: connect drops custom fields.
  const generated = {
    control_plane: { api_key: "env:CONTROL_PLANE_API_KEY" },
    mcp: { commands: [{ channel: "main", command: "relay-mcp" }] },
  };
  let launchEnv: Record<string, string> = {};
  let saved = "";
  let launchArgs: string[] = [];
  let grantOpened = false;
  let grantClosed = false;
  const fakeProcess = {
    argv: ["node", "script", action],
    env: {},
    platform: "win32",
    exitCode: 0,
    stdout: { write() {} },
  };
  await runInNewContext(`(async () => {${source}})()`, {
    scriptUrl: scriptUrl.href,
    dirname,
    join,
    resolve,
    fileURLToPath,
    pathToFileURL,
    loadModule: async () => ({
      Store: class {
        state = {
          clientSecrets: { "00000000-0000-0000-0000-000000000000": token },
        };
        async open() {
          grantOpened = true;
          return this;
        }
        close() {
          grantClosed = true;
        }
      },
    }),
    parseEnv,
    process: fakeProcess,
    console: { log() {}, error() {} },
    lstat: async () => ({ isSymbolicLink: () => false }),
    readFile: async (path: string) =>
      path.endsWith("dot-connection.json")
        ? JSON.stringify({
            tunnelId: "tunnel_test",
            clientId: "00000000-0000-0000-0000-000000000000",
            mcpCommand: "relay-mcp",
            ...(mcpServerUrl === undefined ? {} : { mcpServerUrl }),
          })
        : path.endsWith(".env.local")
          ? "OPENAI_API_KEY=public-test-key"
          : JSON.stringify(generated),
    writeFile: async (_path: string, content: string) => {
      saved = content;
    },
    spawn: (
      _binary: string,
      _args: string[],
      options: { env: Record<string, string> },
    ) => {
      launchEnv = options.env;
      launchArgs = _args;
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.stdout.emit("data", "{}");
        child.emit("close", toolExit);
      });
      return child;
    },
  });
  return {
    launchEnv,
    launchArgs,
    saved,
    code: fakeProcess.exitCode,
    generated,
    grantOpened,
    grantClosed,
  };
}

describe("managed tunnel initialization", () => {
  it.each(["init", "connect"])(
    "retains initialization after %s regenerates its profile",
    async (action) => {
      const result = await run(action);
      expect(result.code).toBe(0);
      expect(result.launchEnv.MCP_STDIO_SEND_INITIALIZED_NOTIFICATION).toBe(
        "true",
      );
      expect(JSON.parse(result.saved)).toEqual({
        ...result.generated,
        mcp: {
          ...result.generated.mcp,
          stdio_send_initialized_notification: true,
        },
      });
      expect(result.saved).not.toContain("public-test-key");
    },
  );
  it("does not modify the profile when managed connect fails", async () => {
    const result = await run("connect", 1);
    expect(result.code).toBe(1);
    expect(result.saved).toBe("");
  });
  it("uses the existing scoped grant for authenticated loopback HTTP without saving it", async () => {
    const result = await run("connect", 0, "http://127.0.0.1:4318/mcp");
    expect(result.code).toBe(0);
    expect(result.launchArgs).toContain("--mcp-server-url");
    expect(result.launchArgs).not.toContain("--mcp-command");
    expect(result.launchArgs.join(" ")).not.toContain("public-client-token");
    expect(result.launchEnv.RELAY_MCP_AUTHORIZATION).toBe(
      "Bearer public-client-token",
    );
    expect(result.grantOpened && result.grantClosed).toBe(true);
    expect(JSON.parse(result.saved).mcp.extra_headers).toEqual({
      Authorization: "env:RELAY_MCP_AUTHORIZATION",
    });
    expect(result.saved).not.toContain("public-client-token");
  });
  it("refuses to transmit the grant to a different destination", async () => {
    const result = await run("connect", 0, "https://other.example/mcp");
    expect(result.code).toBe(1);
    expect(result.grantOpened).toBe(false);
    expect(result.launchArgs).toEqual([]);
  });
  it("refuses HTTP startup without the existing grant", async () => {
    const result = await run("connect", 0, "http://127.0.0.1:4318/mcp", "");
    expect(result.code).toBe(1);
    expect(result.grantClosed).toBe(true);
    expect(result.launchArgs).toEqual([]);
  });
});
