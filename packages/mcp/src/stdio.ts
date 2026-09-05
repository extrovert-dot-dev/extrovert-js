/**
 * stdio transport - for local MCP hosts (Claude Desktop, Claude Code, Cursor).
 *
 * The host spawns this process and speaks MCP over stdin/stdout. Diagnostics go
 * to stderr only; stdout is reserved for the JSON-RPC stream.
 */

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { ExtrovertClient } from "./client.js";
import { loadConfig } from "./config.js";
import { createCredentialStore } from "./credentials.js";
import { createExtrovertServer } from "./server.js";

export async function runStdio(): Promise<void> {
  const credentialStore = createCredentialStore();
  const stored = credentialStore.load();
  const env = { ...process.env };
  if (!(env.EXTROVERT_API_KEY ?? "").trim() && stored) {
    env.EXTROVERT_API_KEY = stored.agent_key;
    if (!(env.EXTROVERT_API_BASE_URL ?? "").trim()) {
      env.EXTROVERT_API_BASE_URL = stored.api_base_url;
    }
  }

  const config = loadConfig(env);
  const client = new ExtrovertClient(config, {
    onDurableAgentKey: config.mock
      ? undefined
      : (agentKey, apiBaseUrl) => {
          credentialStore.save(agentKey, apiBaseUrl);
          return { location: credentialStore.paths.credential };
        },
  });
  const { server } = createExtrovertServer({ config, client });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const auth = config.apiKey ? "credential loaded; call whoami to verify access" : "ready for enrollment or an existing agent key";
  const mode = config.mock ? "offline fixtures" : `live API ${config.apiBaseUrl} · ${auth}`;
  process.stderr.write(`extrovert-mcp: stdio transport ready - ${mode}\n`);

  const shutdown = async (): Promise<void> => {
    await server.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
