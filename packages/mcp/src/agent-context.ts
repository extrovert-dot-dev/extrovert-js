import { z } from "zod";
import { AGENT_RELEASE } from "./agent-release.generated.js";
import type { ExtrovertConfig } from "./config.js";

export const AGENT_CONTEXT_URL = "https://mcp.extrovert.dev/.well-known/agent-contract.json";
export const AGENT_GUIDE_URL = "https://docs.extrovert.dev/llms.txt";
const MAX_BYTES = 32_768;
const TIMEOUT_MS = 5_000;

const releaseSchema = z.object({
  schema_version: z.literal(1), release_version: z.string().max(80), channel: z.literal("next"),
  skills: z.record(z.string().max(64), z.object({ version: z.string().max(80), sha256: z.string().regex(/^[a-f0-9]{64}$/), source: z.string().url() })),
});
export const agentContextSchema = releaseSchema.extend({
  published_cli_version: z.string().max(80).nullable(), publication_observed_at: z.string().max(40).nullable(),
  freshness_ttl_seconds: z.number().int().min(0).max(3600),
  signup: z.object({ status: z.enum(["enabled", "disabled", "unavailable"]), status_url: z.string().url() }),
  docs: z.object({ agent_index: z.string().url(), onboarding: z.string().url(), updates: z.string().url() }),
  mcp: z.object({ url: z.string().url(), catalog_refresh: z.string().max(1000) }),
  guidance: z.array(z.string().max(2000)).max(15),
});
export type AgentContext = z.infer<typeof agentContextSchema>;

/** Public metadata only: no credentials, cookies, redirects, or arbitrary URL from a response. */
export async function readPublicJSON(url: string, fetcher: typeof fetch = fetch, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "error", headers: { accept: "application/json" } });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Public metadata unavailable (HTTP ${response.status})`); }
  if (!response.body) throw new Error("Public metadata has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("Public metadata exceeds the response limit");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Hosted HTTP is the canonical publisher; signup availability is always read live. */
export async function buildAgentContext(config: ExtrovertConfig, fetcher: typeof fetch = fetch): Promise<AgentContext> {
  const statusUrl = `${config.apiBaseUrl}/v1/signup-status`;
  let status: AgentContext["signup"]["status"] = "unavailable";
  let publishedVersion: string | null = config.mock ? AGENT_RELEASE.release_version : null;
  let publishedAt: string | null = null;
  const publication = config.mock ? Promise.resolve() : (async () => {
    try {
      const tags = z.object({ next: z.string().max(80) }).parse(await readPublicJSON("https://registry.npmjs.org/-/package/@extrovert.dev%2fmcp/dist-tags", fetcher, 2_000));
      publishedVersion = tags.next;
      publishedAt = new Date().toISOString();
    } catch { /* A served source release is not proof of npm publication. */ }
  })();
  if (config.mock) status = "enabled";
  else {
    try {
      const result = z.object({ free_signups_enabled: z.boolean() }).parse(await readPublicJSON(statusUrl, fetcher, 2_000));
      status = result.free_signups_enabled ? "enabled" : "disabled";
    } catch { /* Unknown is not disabled, and never permission to sign up. */ }
  }
  await publication;
  return {
    ...AGENT_RELEASE,
    published_cli_version: publishedVersion, publication_observed_at: publishedAt,
    freshness_ttl_seconds: 3600,
    signup: { status, status_url: statusUrl },
    docs: {
      agent_index: AGENT_GUIDE_URL,
      onboarding: "https://docs.extrovert.dev/quickstart/zero-to-first-email/",
      updates: "https://docs.extrovert.dev/operating/agent-updates/",
    },
    mcp: { url: "https://mcp.extrovert.dev/mcp", catalog_refresh: "Use the host's current tools/list. Refresh after schema errors; reconnect if the host cannot refresh. Preserve request IDs and inspect state before retrying a mutation." },
    guidance: [
      "Read the live agent guide on first Extrovert use in a session, after an hour of continued use, and after an unknown-tool or schema error. Installed skill details may be older than this release.",
      "Use the existing account and profile first. Confirm whoami and the requested resource reach. Signup is only for a new account when enabled; never replace an existing identity to repair access.",
      "Interactive setup uses hosted MCP and explicit OAuth consent. Unattended workers use already authorized scoped credentials; signup requires a supplied human email and that human's verification. Do not fabricate an email or bypass verification.",
      "If verification mail is missing, check spam/junk and the destination address. Use the returned sender information or the current guide; do not guess a fixed sender.",
      "A different local version is a refresh signal, not proof of incompatibility or permission to downgrade. published_cli_version comes from npm next; null means publication could not be checked. Preserve explicit pins and local edits; refresh only the Extrovert skills installed in their original scope when allowed.",
      "Updating files does not reload instructions already in context or a running stdio process. Read the live guide for this task, then reload the skill or restart the host when needed. A release check never authorizes wider access, sending, or purchases.",
      "Queued email is still in progress. Follow the current review workflow through confirmed sent or an unsuccessful terminal outcome. Inspect existing state before retrying an ambiguous send.",
    ],
  };
}

/** Local stdio and CLI fetch the hosted release, never present their bundle as current. */
export async function fetchAgentContext(fetcher: typeof fetch = fetch): Promise<AgentContext> {
  return agentContextSchema.parse(await readPublicJSON(AGENT_CONTEXT_URL, fetcher));
}
