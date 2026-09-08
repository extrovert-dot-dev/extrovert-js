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
import { createLocalCredentialProvider } from "./local-oauth.js";
import { createExtrovertServer } from "./server.js";

export async function runStdio(): Promise<void> {
  const credentialStore = createCredentialStore();
  // Explicit host credentials are authoritative; do not even read an unrelated
  // local profile (which may be stale, malformed or belong to another account).
  const stored = (process.env.EXTROVERT_API_KEY ?? "").trim() ? undefined : (credentialStore.load() ?? credentialStore.loadPendingSignup());
  const env = { ...process.env };
  if (!(env.EXTROVERT_API_KEY ?? "").trim() && stored) {
    env.EXTROVERT_API_KEY = stored.agent_key;
    if (!(env.EXTROVERT_API_BASE_URL ?? "").trim()) {
      env.EXTROVERT_API_BASE_URL = stored.api_base_url;
    }
  }

  const config = loadConfig(env);
  const client = new ExtrovertClient(config, {
    credentialProvider: !config.mock && !(process.env.EXTROVERT_API_KEY ?? "").trim()
      ? createLocalCredentialProvider(credentialStore, { apiBaseUrl: config.apiBaseUrl, allowPendingSignup: true }) : undefined,
    beforeSignup: config.mock ? undefined : () => {
      if ((process.env.EXTROVERT_API_KEY ?? "").trim() || credentialStore.load()) throw new Error("This profile already has Extrovert access. Verify whoami; use a separate profile for an intended new account.");
      if (credentialStore.loadPendingSignup()) throw new Error("Signup is already pending in this profile. Resume check_activation and verify_signup; do not create another account.");
    },
    onPendingSignup: config.mock ? undefined : (result, apiBaseUrl) => {
      credentialStore.savePendingSignup({ agent_key: result.agent_key,
        human_email: result.human_email ?? result.otp_sent_to ?? "",
        address: result.address, activation_method: result.activation_method,
        otp_expires_at: result.activation_expires_at ?? result.otp_expires_at ?? "",
        api_base_url: apiBaseUrl });
    },
    onDurableAgentKey: config.mock
      ? undefined
      : (agentKey, apiBaseUrl) => {
          credentialStore.save(agentKey, apiBaseUrl);
          credentialStore.clearPendingSignup();
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
