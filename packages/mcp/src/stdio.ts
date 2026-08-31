/**
 * stdio transport — for local MCP hosts (Claude Desktop, Claude Code, Cursor).
 *
 * The host spawns this process and speaks MCP over stdin/stdout. Diagnostics go
 * to stderr only; stdout is reserved for the JSON-RPC stream.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createExtrovertServer } from "./server.js";

export async function runStdio(): Promise<void> {
  const { server, config } = createExtrovertServer();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const mode = config.mock ? "offline fixtures" : `live API ${config.apiBaseUrl}`;
  process.stderr.write(`extrovert-mcp: stdio transport ready — ${mode}\n`);

  const shutdown = async (): Promise<void> => {
    await server.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
