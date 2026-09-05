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
  "Extrovert gives your agent a persistent email inbox with reviewed sending.",
  "",
  "Typical flow:",
  "  1. whoami: confirm the connected identity and returned capabilities before creating anything.",
  "     For hosted MCP, use your host's OAuth sign-in for the existing account if authentication is needed.",
  "     Do not redeem another enrollment when already connected. If explicitly given an enrollment key, use the",
  "     secret-safe CLI enrollment flow or redeem_enrollment; never print keys or ask the human to paste one into chat.",
  "  2. create_inbox: when requested and permitted, create an inbox (omit username and domain for a shared-domain address).",
  "     For a custom domain, check get_domain first: readiness.ready_for_inboxes decides whether setup is complete.",
  "     Explain its summary and next action; do not infer readiness from verification or DKIM diagnostics.",
  "     list_domain_events resumes status updates using its saved cursor. Disconnected agents need polling or a host scheduler.",
  "  3. send_email / reply_email: submit via the inbox's authenticated sender and its review policy.",
  "  4. wait_for_email: block for an incoming message and read the extracted OTP code / verification link.",
  "  5. list_threads / search_threads → get_thread: find and read a complete conversation; use extracted context before replying.",
  "  6. read_messages / get_message / search: inspect individual messages; do not build raw HTTP or jq helpers.",
  "",
  "The packaged local stdio server stores full keys in the current private profile and reloads them in future sessions.",
  "Hosted OAuth credentials belong to the MCP host; configuring a server alone does not complete sign-in.",
  "The limited signup key is never promoted into that durable credential store.",
  "",
  "An enrolled agent key is bound to its org and project; whoami is the authority for the current identity and permissions. Addresses are",
  "real and live on Extrovert shared domains or customer domains. Identifiers, addresses, and keys are stable",
  "strings: pass them back verbatim.",
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
