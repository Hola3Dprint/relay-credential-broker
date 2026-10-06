import type { Request, Response } from "express";
import { z } from "zod";
import {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  type JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { MCP_INSTRUCTIONS } from "./tools.js";

// A narrow SEP-2575 adapter for Relay's stateless tools. Authentication and
// grant checks remain in the enclosing /mcp route and the existing handlers.
export const MODERN_PROTOCOL_VERSION = "2026-07-28";
const protocolKey = "io.modelcontextprotocol/protocolVersion";
const serverInfo = { name: "relay", version: "0.1.0" };
const identityMeta = { "io.modelcontextprotocol/serverInfo": serverInfo };
const versions = [MODERN_PROTOCOL_VERSION, ...SUPPORTED_PROTOCOL_VERSIONS];
const metadataSchema = z.object({
  [protocolKey]: z.literal(MODERN_PROTOCOL_VERSION),
  "io.modelcontextprotocol/clientInfo": z.object({
    name: z.string(),
    version: z.string(),
  }),
  "io.modelcontextprotocol/clientCapabilities": z.record(z.unknown()),
});

export function adaptModernMcp(req: Request, res: Response) {
  const body = req.body;
  const meta = body?.params?._meta;
  if (!meta?.[protocolKey] && body?.method !== "server/discover")
    return { handled: false, modern: false };
  const error = (code: number, message: string) => {
    res
      .status(200)
      .json({ jsonrpc: "2.0", id: body?.id ?? null, error: { code, message } });
    return { handled: true, modern: true };
  };
  if (
    body?.jsonrpc !== "2.0" ||
    (typeof body.id !== "number" && typeof body.id !== "string")
  )
    return error(-32600, "A request requires a JSON-RPC id");
  if (!metadataSchema.safeParse(meta).success)
    return error(
      -32602,
      "Unsupported protocol version or invalid client metadata",
    );
  const headerVersion = req.headers["mcp-protocol-version"];
  if (headerVersion && headerVersion !== MODERN_PROTOCOL_VERSION)
    return error(-32602, "Protocol version metadata and header must agree");
  if (body.method === "server/discover") {
    res.json({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        resultType: "complete",
        supportedVersions: versions,
        capabilities: { tools: {} },
        instructions: MCP_INSTRUCTIONS,
        _meta: identityMeta,
        ttlMs: 0,
        cacheScope: "private",
      },
    });
    return { handled: true, modern: true };
  }
  if (body.method !== "tools/list" && body.method !== "tools/call")
    return error(-32601, "Method not supported by Relay's stateless tools");
  // Only the wire envelope changes. SDK validation and scoped tool execution
  // still handle the original params, including the selected tool arguments.
  req.headers["mcp-protocol-version"] = LATEST_PROTOCOL_VERSION;
  return { handled: false, modern: true };
}

export function adaptModernResponses(
  transport: Pick<StreamableHTTPServerTransport, "send">,
  method: string,
) {
  const send = transport.send.bind(transport);
  transport.send = async (message, options) => {
    let reply: JSONRPCMessage = message;
    if ("result" in message) {
      reply = {
        ...message,
        result: {
          ...message.result,
          resultType: "complete",
          _meta: { ...message.result._meta, ...identityMeta },
          ...(method === "tools/list"
            ? { ttlMs: 0, cacheScope: "private" }
            : {}),
        },
      };
    }
    await send(reply, options);
  };
}
