/**
 * Extrovert MCP server factory.
 *
 * Builds an `McpServer` with the Extrovert toolset registered. Transport-agnostic:
 * the same server is used over stdio (local hosts) and Streamable HTTP (hosted).
 */

import { McpServer } from "@modelcontextprotocol/server";

import { ExtrovertClient } from "./client.js";
import { loadConfig, SERVER_NAME, SERVER_VERSION, type ExtrovertConfig } from "./config.js";
import { registerTools } from "./tools.js";

const INSTRUCTIONS = [
  "Extrovert gives an AI agent a real, persistent inbox in one call.",
  "",
  "Typical flow:",
  "  1. redeem_enrollment — if started without a key, exchange an enrollment token (pk_enroll_…) for a scoped agent key.",
  "  2. create_inbox — mint an inbox (omit username/domain for an instant shared-subdomain address).",
  "  3. send_email / reply_email — send via the inbox's authenticated sender.",
  "  4. wait_for_email — block for an incoming message and read the extracted OTP code / verification link.",
  "  5. read_messages / list_threads / search — inspect the inbox.",
  "",
  "The agent key is bound to a FIXED org + project (call whoami to see them); there is no project selector. Addresses are",
  "real and live on domains Extrovert controls (smtp.extrovert.dev subdomains). Identifiers, addresses, and keys are stable",
  "strings — pass them back verbatim.",
].join("\n");

export interface CreateExtrovertServerOptions {
  config?: ExtrovertConfig;
  client?: ExtrovertClient;
}

/** Create a configured Extrovert MCP server (and its client). */
export function createExtrovertServer(options: CreateExtrovertServerOptions = {}): {
  server: McpServer;
  client: ExtrovertClient;
  config: ExtrovertConfig;
} {
  const config = options.config ?? loadConfig();
  const client = options.client ?? new ExtrovertClient(config);

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions: INSTRUCTIONS,
    },
  );

  registerTools(server, { client, config });

  return { server, client, config };
}
