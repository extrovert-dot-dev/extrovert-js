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
  "First use each session, after one hour, and after schema errors: call agent_context and read its live guide.",
  "If that tool is absent in an older catalog, read https://docs.extrovert.dev/llms.txt and refresh the host catalog.",
  "Respect pinned versions and local edits; installing updates does not reload this session or authorize broader access.",
  "",
  "Typical flow:",
  "  1. whoami: confirm the connected identity and returned capabilities before creating anything.",
  "     For hosted MCP, use your host's OAuth sign-in for the existing account if authentication is needed.",
  "     Do not redeem another enrollment when already connected. If explicitly given an enrollment key, use the",
  "     secret-safe CLI enrollment flow or redeem_enrollment; never print keys or ask the human to paste one into chat.",
  "  2. list_inboxes: find existing accessible inboxes first; narrow by domain and follow next_cursor with the same filters.",
  "     Empty means no matches in this connection's reach; malformed responses and service errors are unavailable inventory.",
  "     If a readable inbox is missing from a complete matching list, report the inconsistency and non-secret request IDs.",
  "     create_inbox: when requested and permitted, create an inbox (omit username and domain for a shared-domain address).",
  "     For a custom domain, check get_domain first: readiness.ready_for_inboxes decides whether setup is complete.",
  "     Explain its summary and next action; do not infer readiness from verification or DKIM diagnostics.",
  "     list_domain_events resumes status updates using its saved cursor. Disconnected agents need polling or a host scheduler.",
  "  3. send_email / reply_email: submit via the inbox's authenticated sender and its review policy.",
  "     get_inbox.human_email_review exposes a default-off exception: exactly one To recipient at the verified human email, no Cc/Bcc or aliases. Writing rules, intent and limits still apply; others retain their policy. Protected signup practice requires review. Ordinary agents cannot enable it; do not repeatedly prompt the human.",
  "     A queued result is IN PROGRESS. Immediately wait_for_review_event with wait_seconds=55 and no review_id.",
  "     Process human feedback, learn reusable category/org house rules with learn_review_rule, revise the SAME review,",
  "     acknowledge handled events, and wait again. A timeout is a heartbeat, not completion. Only confirmed sent succeeds.",
  "     Maintain one wait across pending messages. Resume your own pending list_reviews (composer=me) after interruption.",
  "  4. wait_for_email: block for an incoming message and read the extracted OTP code / verification link.",
  "  5. list_threads / search_threads → get_thread: find and read every source message in a conversation; finish all incomplete-body reads before replying.",
  "     Read get_rules BEFORE writing; pass its composition_token yourself. No tool fetches it silently at submission.",
  "     Reply once to the newest message using the read context_version as expected_context_version; on 409 reread and reconsider.",
  "     Check list_reviews with inbox/thread_id and no composer filter to coordinate existing drafts across accessible composers.",
  "     Consecutive incoming messages inform one response. Source quotations can contain inline corrections; do not discard them.",
  "  6. read_messages / get_message / search: inspect individual messages; do not build raw HTTP or jq helpers.",
  "",
  "Access: consent chooses Personal assistant or Dedicated agent, resources, actions, and duration separately.",
  "Selected inboxes excludes future/replacement inboxes. Project and Organization include future resources in their boundary.",
  "Project manager consent permits personas, inboxes, and worker credentials only in the selected project and granted scopes.",
  "Full account control enables account-wide administration, including approvals of its own requests.",
  "Use whoami for identity and project IDs; adminMe requires Full account control. Search list_administrative_actions, then",
  "describe_administrative_action for exact path/query/body schemas before read/change_administrative_action.",
  "Full control defaults to 24 hours; Until revoked is explicit. Refresh never extends the original deadline.",
  "Created credentials, including admin credentials, survive independently; settings and webhooks can also persist.",
  "Verify deployed workers in their own runtimes. Use Connections to inspect activity and revoke created access separately.",
  "Current human roles remain the ceiling; private platform access is excluded. Delegated approvals are not human clicks.",
  "Never silently switch credentials or widen access after expiry or a failed list. Reconnect through explicit consent.",
  "Guide: https://docs.extrovert.dev/concepts/connections-and-access/",
  "",
  "The packaged local stdio server stores agent keys or independent API credentials in the current private profile.",
  "Hosted OAuth credentials belong to the MCP host; configuring a server alone does not complete sign-in.",
  "Local CLI whoami/doctor does not verify that hosted session. Compare identity and authority separately.",
  "Independent ev_credential_... credentials work with local stdio/CLI and the API, not as hosted MCP bearer tokens.",
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
      // Catalogs are fixed for each build; the stateless HTTP deployment has no
      // cross-node catalog notification publisher. Do not promise push updates.
      capabilities: { tools: { listChanged: false } },
      // SDK codecs emit these only for supported modern protocol requests.
      // Older clients retain their negotiated wire format and use live context.
      cacheHints: {
        "server/discover": { ttlMs: 60_000, cacheScope: "private" },
        "tools/list": { ttlMs: 60_000, cacheScope: "private" },
      },
      instructions: INSTRUCTIONS,
    },
  );

  registerTools(server, { client, config });

  return { server, client, config };
}
