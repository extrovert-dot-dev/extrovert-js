<!-- // SCOPED EMAIL FOR AGENTS -->

# Extrovert MCP server

**A real inbox for your agent, in one call.**

`@extrovert.dev/mcp` is the [Model Context Protocol](https://modelcontextprotocol.io) server for
[Extrovert](../README.md): Message Science's agentic-email platform. It gives an AI agent a real,
persistent inbox on a platform or customer domain, with explicit permission to create, read, send,
and administer. Hosted OAuth connections carry the resource reach and actions chosen during
consent; existing scoped agent keys retain their fixed resource ceilings. Call `whoami` to inspect
the actual connection, its reach, actions, and expiry before starting work.

> **Prerelease status:** the package is published on npm under the `next` dist-tag. Extrovert also
> operates `https://mcp.extrovert.dev/mcp` as a stateless Streamable HTTP endpoint with browser OAuth.
> The same package installs `extrovert-mcp` for transports and `extrovert` for supported setup,
> authentication, mailbox, review-status, and reviewed-send commands.

The standout tool is **`wait_for_email`**: a blocking call that returns the next matching message
with the **OTP code and verification link already extracted**. Trigger a sign-in elsewhere, then act
on the code in the same turn. No polling loop, no losing the 5-minute window.

```text
redeem an enrollment key  ->  create_inbox  ->  use it as a sign-up address  ->  wait_for_email -> { otp_code, verification_link }
```

---

## Start and stay current

Tell your agent:

> Read https://docs.extrovert.dev/llms.txt, connect Extrovert using my existing account if I have one, and help me send my first email.

Prefer hosted OAuth in compatible hosts. `extrovert setup --host auto` detects an unambiguous
Codex, Claude Code or Hermes runtime and prefers hosted setup; unsupported or ambiguous environments
receive a native setup handoff. Explicit host selection retains the stdio default. Existing entries
and profile credentials are preserved. Configuration is complete only after sign-in and `whoami`
in the actual MCP session.

Call `agent_context` on first Extrovert use in a session, after an hour, and after schema errors.
Without connected tools, read https://mcp.extrovert.dev/.well-known/agent-contract.json or the live
agent guide. The CLI exposes `extrovert version --json` and `extrovert agent status --json`.
These checks never update files or authenticate, and status does not inspect installed skill files.
`@next` resolves the prerelease channel; `--prefer-online` requests fresh registry metadata.
Resolution does not restart an already running MCP process. Respect pinned versions and local edits; update only Extrovert skills in their original scope when
allowed. Updating files does not reload an active skill or local stdio process.

Current signup availability comes from the live context. Use an existing account first; new signup
requires a supplied human email and human verification. If the code is missing, confirm the
recipient address and check Spam/Junk. See [agent updates](https://docs.extrovert.dev/operating/agent-updates/).

## Tools

| Tool | What it does |
|---|---|
| `agent_context` | Read the hosted release, skill versions/digests, signup availability and current guides. |
| `redeem_enrollment` | Exchange an enrollment token (`pk_enroll_…`) for a **scoped agent key** (`pk_agent_…`). |
| `create_inbox` | Create an inbox. Paid accounts use `extrovertmail.com`; free signups use `free.extrovertmail.com`. Attach arbitrary metadata. |
| `list_inboxes` | List readable inboxes within the connection grant or legacy key ceiling. Broader connections can narrow the selection; legacy org keys must choose `project:<id>` or `wildcard:true`. |
| `get_inbox` | Fetch one inbox by opaque `inbox_id` (`pmbx_…`) or address (with its metadata). |
| `update_inbox` | Update settings; `daily_send_limit` (1–10,000) sets the enforced rolling-24-hour recipient cap and requires opt-in `mailbox:quota`. |
| `delete_inbox` | Permanently delete an inbox, its messages, and sender identity. Requires `mailbox:delete`; cannot be undone. |
| `send_email` | Send a new email via the inbox's authenticated sender. |
| `reply_email` | Reply within an existing thread. |
| `read_messages` | List messages in an inbox (optionally unread-only). |
| `list_threads` | List conversation threads with cursor pagination. |
| `search_threads` | Search conversation summaries by subject, participant, or snippet. |
| `get_thread` | Read the complete oldest-first conversation plus extracted-first context. |
| `delete_thread` | Move every message in a thread to Trash, or permanently expunge it. |
| `search` | Full-text search across one or all inboxes. |
| **`wait_for_email`** | **Block until a matching message arrives; return it + extracted `otp_code` / `verification_link`.** |
| `quote_domain` | Return a short-lived registration and renewal quote without reserving, charging, or registering. |
| `request_domain_purchase` | Create an idempotent, durable domain-purchase request for human approval. |
| `request_plan_change` | Create an idempotent upgrade or downgrade request for human approval. |
| `get_commerce_request` | Read the exact blocker, approval URL, payment state, progress, and next safe action. |
| `list_commerce_requests` | Recover and list this agent's purchase and plan requests. |
| `whoami` | Confirm the connected agent, organization, project, and available actions. |
| `get_domain` | Answer whether a domain is ready, who needs to act, and how many inboxes this connection can see. |
| `verify_domain` | Recheck the customer's nameserver entries now and return the latest readiness result. |
| `wait_for_domain` | Wait for readiness for a bounded interval, then return a clear resumable outcome. |
| `list_domain_events` | Resume domain updates using the previous cursor, including ready, action-needed, and recovery events. |

Every tool is registered with a typed [zod](https://zod.dev) input schema and behavioural
annotations (`readOnlyHint`, `destructiveHint`, …) so hosts can present and gate them correctly.

---

## Access and delegation

Hosted OAuth uses an explicit connection grant. Choose Personal assistant or a
Dedicated agent, then choose selected inboxes, a project, an organization, or Full
account control. Resource reach and permitted actions are separate. Current human
authority remains the upper bound; public connections never gain private operator
access.

Full account control is intended for interactive setup and administration. It can
use other agents' inboxes, change access and policies, create credentials, and
approve requests—including its own. The default is 24 hours; Until revoked is an
explicit alternative. Refresh never extends the original deadline. Credentials
created during setup, including administrative credentials, survive independently
until separately expired or revoked. See **Connections** in the account menu to
review activity and revoke the parent or its created access separately.

Existing scoped agent keys remain available for unattended workers. Their scopes,
resource ceiling, expiry, and revocation still apply. Knowing an inbox address
never grants access. Do not automatically substitute credentials after expiry.

For the complete setup-to-worker handoff, identity comparison, expiry recovery, and list/read
troubleshooting, see [Connections and access](https://docs.extrovert.dev/concepts/connections-and-access/).
Start administrative discovery with `read_administrative_action {action_id: "adminMe"}`, then search
and describe the relevant action before passing its exact `path`, `query`, and `body` inputs.

## Connect with hosted OAuth

Give an OAuth-capable MCP client this URL:

```text
https://mcp.extrovert.dev/mcp
```

The endpoint publishes RFC 9728 protected-resource metadata and Extrovert authorization-server
discovery at `https://api.extrovert.dev`. Compatible clients open the browser sign-in and consent flow, then store and refresh the
grant. Existing scoped `pk_agent_…` bearer keys also work when a client is configured explicitly.

The hosted service runs MCP SDK v2's fresh-server-per-request handler: no process-local session map,
sticky routing, or session teardown is required.

## Install and run the prerelease

Use the explicit prerelease tag:

```bash
# stdio for an MCP host
npx -y @extrovert.dev/mcp@next

# inspect the packaged CLI
npx -y @extrovert.dev/mcp@next --help

# register the stdio server in Codex or Claude Code
npx -y @extrovert.dev/mcp@next setup --host codex
npx -y @extrovert.dev/mcp@next setup --host claude
npx -y @extrovert.dev/mcp@next setup --host hermes
```

For reproducible environments, replace `@next` with the exact release version you intend to pin. The package installs the
`extrovert-mcp` and `extrovert` aliases over one entrypoint; there is no second package or transport
implementation to keep in sync.

### CLI fallback

The CLI uses the same typed client as MCP and prints ordinary message text without a `curl | jq`
pipeline:

For an existing account, use browser sign-in in the intended local profile:

```bash
export EXTROVERT_PROFILE=support
extrovert auth login
extrovert whoami
extrovert inbox list
extrovert message list --inbox support@extrovertmail.com
```

`auth login` verifies and reuses working profile access first. Otherwise it opens local browser
sign-in and explicit consent when available. Its printed fallback URL returns to Extrovert's website
with a one-use completion code, so it also works on another machine. SSH/headless sessions use this
hosted completion path directly. In an interactive terminal, paste the code at the hidden prompt.

For automation:

```bash
extrovert auth login --no-browser --json
# When pending, the person opens authorization_url and approves access.
extrovert auth complete --json
# Supply the website's completion code on private stdin in this same profile.
extrovert whoami
```

Never put a completion code or key in command arguments, chat, or logs. `pending` is not connected;
wait for `complete`, then verify `whoami`. `auth cancel` clears pending login state while preserving
existing credentials. Use `auth login --reconnect` for deliberate new consent. Requests expire after
10 minutes. See the [login guide](https://docs.extrovert.dev/quickstart/authentication/#local-cli-and-stdio-sign-in).

Local OAuth is saved privately and refreshed within the original consent grant: identity, resource
reach, actions, and expiry remain bounded. Start or reload the matching stdio MCP process and call
`whoami` there. Hosted MCP OAuth belongs to the host; local login or `doctor` does not verify it.

Enrollment is also supported: `extrovert enroll --agent-handle support` reads a hidden prompt or
`EXTROVERT_ENROLLMENT_KEY`. Existing agent keys and independently issued API credentials use
`extrovert auth login --with-token` with hidden stdin. Use these deliberately; do not create another
customer account or borrow another agent's credential to repair access.

On Unix the credential directory is mode `0700` and credential files are mode `0600`.
`EXTROVERT_CONFIG_DIR` selects an explicit directory; otherwise Hermes uses its own
`HERMES_HOME/extrovert` directory, and other runtimes use the platform config directory.
`EXTROVERT_PROFILE` separates agents within that base. An explicit `EXTROVERT_API_KEY` takes
precedence; remove that override from the intended environment before new browser consent.
Keep the same profile and API environment throughout a pending login.

For Hermes hosted OAuth, use `extrovert setup --host hermes --transport hosted`, then
`hermes mcp login extrovert`. Finish browser consent, restart Hermes, and call `whoami`.
If approved OAuth fails, keep the non-secret request ID and report the failed step instead of
repeating consent or creating another account. Read live context for signup availability.

### Is my domain ready?

```bash
extrovert domain status mail.example.com
extrovert domain recheck mail.example.com
extrovert domain wait mail.example.com
```

Status leads with a plain-language answer: whether you need to change DNS, whether Extrovert is
finishing setup, or whether you can create/use inboxes. `Ready` includes scoped inbox counts and
the next action. Technical verification/signing fields are diagnostics, not readiness evidence.
Automatic setup continues after the agent disconnects. A disconnected agent must resume status
checks or its event cursor to receive updates; a bounded wait does not promise a later callback.

## Build and run from source

Requires Node ≥ 20. From this directory:

```bash
pnpm install --frozen-lockfile
pnpm run build      # compiles to dist/ (excludes tests)
```

Two transports, one binary:

```bash
# stdio: for local hosts (Claude Desktop, Claude Code, Cursor)
node /absolute/path/to/extrovert/mcp/dist/bin.js

# self-hosted stateless Streamable HTTP at /mcp (default :8787)
node /absolute/path/to/extrovert/mcp/dist/bin.js --http --port 8787
```

Run it without building during development:

```bash
pnpm run dev            # tsx watch, stdio
pnpm run dev -- --http  # tsx watch, HTTP
```

### Configuration (environment)

| Variable | Default | Purpose |
|---|---|---|
| `EXTROVERT_API_BASE_URL` | `https://api.extrovert.dev` | Base URL of the Extrovert REST API. |
| `EXTROVERT_API_KEY` | *(empty)* | Scoped agent key (`pk_agent_…`), independent API credential (`ev_credential_…`), or local enrollment key (`pk_enroll_…`). |
| `EXTROVERT_CONFIG_DIR` | platform config directory | Override the local credential directory. |
| `EXTROVERT_MOCK` | *(off)* | Set `1` to force offline fixtures. |
| `EXTROVERT_REQUEST_TIMEOUT_MS` | `30000` | Per-request timeout for non-blocking calls. |
| `EXTROVERT_MAX_WAIT_MS` | `300000` | Upper bound the server allows `wait_for_email` to block. |
| `EXTROVERT_MCP_OAUTH_ENABLED` | *(off)* | Require consent-bound Extrovert OAuth or an introspected agent key on HTTP. |
| `EXTROVERT_MCP_OAUTH_ISSUER` | `https://api.extrovert.dev` | Extrovert OAuth authorization-server issuer. |
| `EXTROVERT_MCP_PUBLIC_URL` | `https://mcp.extrovert.dev/mcp` | Public RFC 9728 resource identifier. |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | `--http` bind. |

> **Offline fixtures are opt-in.** With no `EXTROVERT_API_KEY`, the server still talks to the live
> API. Self-signup is currently disabled. When enabled, an agent can start with `sign_up` and receive a short-lived limited key in-session. The
> key expires with its activation reservation and is revoked when `verify_signup` returns its replacement. For an `incoming_email` response, ask the human to email the reserved inbox, call `check_activation`, then `verify_signup` without an OTP once proven. `correct_activation_email` requires the current revision and a fresh matching email; it does not extend expiry. Previously issued OTPs remain supported until their original expiry. Set
> `EXTROVERT_MOCK=1` to use deterministic in-memory fixtures; `create_inbox`, `send_email`, and
> `wait_for_email` then operate on one coherent offline dataset.

---

## Host configuration

Point any stdio-capable host at the prerelease package:

```json
{
  "mcpServers": {
    "extrovert": {
      "command": "npx",
      "args": ["-y", "@extrovert.dev/mcp@next"]
    }
  }
}
```

For Codex or Claude Code, register that same local entrypoint:

```bash
npx -y @extrovert.dev/mcp@next setup --host codex
npx -y @extrovert.dev/mcp@next setup --host claude
```

> **Offline:** omit `EXTROVERT_API_KEY` and set `EXTROVERT_MOCK=1`; the packaged server uses
> deterministic fixtures with no network or mail.

---

## Example agent flow

The canonical flow: **redeem → create_inbox → wait_for_email**: as an agent would run it.

**1. Redeem an enrollment key for a scoped agent key.** Skip this if the host already has a key in
`EXTROVERT_API_KEY`.

```jsonc
// tool: redeem_enrollment
{ "enrollment_token": "pk_enroll_42_aZ9…", "agent_handle": "signup-bot" }
// -> { agent_id, agent_key: "pk_agent_… (shown once)", scopes: ["mailbox:create", ...],
//      org_id, project_id }
```

**2. Create an inbox.** Omit `username` and `domain` to use the account's shared domain.
Shared local parts must normalize to at least five characters and cannot use a reserved name.
Optionally tag it with arbitrary `metadata` (string/number/boolean values).

```jsonc
// tool: create_inbox
{ "display_name": "Signup Bot", "metadata": { "team": "growth", "vip": true } }
// -> { object: "inbox", id: "pmbx_… (opaque inbox_id: treat as opaque)",
//      org_id, project_id, address: "agent3@extrovertmail.com", status: "live",
//      sender_verified: true, metadata: { "team": "growth", "vip": true } }
```

> **Addressing an inbox.** Every inbox-keyed tool's `inbox` argument takes the canonical opaque
> `inbox_id` (`pmbx_…`) **or** the inbox's email address as a within-project alias. The id is the
> stable key; treat it as opaque (do not parse the prefix). Each inbox carries its fixed
> `org_id`/`project_id` (a key only ever touches inboxes in its bound project).

> **Inbox metadata** is a shallow-merged map. On `update_inbox`, pass an object to merge keys in
> (a key whose value is `null` deletes it), pass a top-level `null` to clear all metadata, or omit
> `metadata` entirely to leave it untouched. Reads always return an object (`{}` when empty).

**3. Use the address to sign up somewhere** (the agent fills a form, hits an API, etc.), then block
for the verification email and read the code straight out of the result:

```jsonc
// tool: wait_for_email
{ "inbox": "agent3@extrovertmail.com", "from": "stripe.com", "subject": "verify", "timeout_ms": 120000 }
// -> { matched: true,
//      message: { from, subject, text, … },
//      otp_code: "481920",
//      verification_link: "https://dashboard.stripe.com/verify?code=481920&id=evt_9" }
```

The agent now has the OTP and the link in the same turn: paste the code, or open the link, and
continue. No polling, no separate "check the inbox" round-trips.

**4. Keep working.** Send, reply in-thread, search, list:

```jsonc
// tool: send_email
{ "inbox": "agent3@extrovertmail.com", "to": ["founder@acme.example"],
  "subject": "intro", "text": "Hi: provisioned via Extrovert.",
  "intent": { "summary": "Introduce the new agent inbox." }, "client_id": "send-intro-1" }

// tool: reply_email
{ "inbox": "agent3@extrovertmail.com", "thread_id": "thr_…", "text": "Following up.",
  "intent": { "summary": "Continue the existing conversation." }, "client_id": "reply-followup-1" }

// tool: search
{ "query": "invoice", "inbox": "agent3@extrovertmail.com" }
```

---

## Stateless HTTP notes

`extrovert-mcp --http` speaks MCP Streamable HTTP:

- `POST /mcp`: one authenticated client→server request, served by a fresh MCP server instance.
- `GET /mcp` and `DELETE /mcp`: legacy stateless compatibility responses; no session is retained.
- `GET /healthz`: liveness, version, transport, and authentication mode.
- `GET /.well-known/oauth-protected-resource/mcp`: RFC 9728 protected-resource metadata when
  OAuth is enabled.

Each request gets an isolated server + client and emits no `mcp-session-id`, so requests can land on
any service instance. Hosted MCP requires `Authorization: Bearer …` with an MCP-audience Extrovert
OAuth access token or an existing scoped `pk_agent_…` key. The API rechecks the grant, expiry,
revocation, current human roles, and resource/action boundaries. Independent `ev_credential_…`
credentials are API-only: use them through local stdio/CLI or an SDK, not as hosted MCP bearer tokens.
The raw bearer token is never persisted by MCP or API.

`EXTROVERT_API_KEY` and unauthenticated fixture mode remain local/self-hosting conveniences only;
the production service refuses to start without OAuth enabled.

---

## Architecture

```text
src/
  bin.ts        CLI entrypoint (--http | stdio)
  cli.ts        setup/auth/signup/mailbox/review CLI using the typed client
  credentials.ts permission-restricted, atomic local credential persistence
  server.ts     McpServer factory + instructions
  stdio.ts      stdio transport
  http.ts       stateless Streamable HTTP transport (Express, OAuth + scoped keys)
  auth.ts       consent-bound OAuth exchange, RFC discovery, and agent-key introspection
  tools.ts      manifest-driven tools: zod schemas, annotations, handlers, registration
  client.ts     thin typed Extrovert REST client (one method per /v1 endpoint)
  config.ts     env-driven configuration
  types.ts      Extrovert resource types (the REST wire shapes)
  extract.ts    OTP code + verification-link extraction (ported from Go)
  fixtures.ts   offline fixture store for tests and demos
  extract.test.ts  unit tests for the extraction logic
```

The **typed client** (`ExtrovertClient`) is the single network seam: tools never call `fetch`
directly. OTP/link extraction is shared by the MCP wait tool and its offline fixtures.

### Live API and fixtures

The MCP client talks to the Extrovert Go REST API by default. When `EXTROVERT_MOCK=1`,
`ExtrovertClient` returns fixture data instead so tests and offline demos can exercise the same
tool surface without network access. Offline domains remain `waiting_for_dns`: fixtures do not
check real DNS or run background setup, and their event pages stay empty while preserving the
supplied cursor. Recheck never fabricates confirmation. The endpoints the client targets:

| Tool | Method + path |
|---|---|
| `redeem_enrollment` | `POST /v1/enroll` |
| `create_inbox` | `POST /v1/inboxes` (project-tier sugar) / `POST /v1/projects/{project_id}/inboxes` |
| `list_inboxes` | `GET /v1/inboxes` (project sugar) · `GET /v1/projects/{project_id}/inboxes` · `GET /v1/projects/-/inboxes` (org wildcard) |
| `get_inbox` | `GET /v1/inboxes/{inbox_id}` |
| `update_inbox` | `PATCH /v1/inboxes/{inbox_id}` (set `daily_send_limit` with `mailbox:quota`) |
| `delete_inbox` | `DELETE /v1/inboxes/{inbox_id}` |
| `send_email` | `POST /v1/inboxes/{inbox_id}/send` |
| `reply_email` | `POST /v1/inboxes/{inbox_id}/reply` |
| `read_messages` | `GET /v1/inboxes/{inbox_id}/messages` |
| `list_threads` | `GET /v1/inboxes/{inbox_id}/threads` |
| `search_threads` | `GET /v1/inboxes/{inbox_id}/threads/search` |
| `get_thread` | `GET /v1/inboxes/{inbox_id}/threads/{thread_id}` |
| `delete_thread` | `DELETE /v1/inboxes/{inbox_id}/threads/{thread_id}` |
| `search` | `GET /v1/inboxes/{inbox_id}/messages/search` (fans out across inboxes when none given) |
| `wait_for_email` | `POST /v1/inboxes/{inbox_id}/wait` (server holds the connection via IMAP IDLE) |

The path key is the canonical opaque **`inbox_id`** (`pmbx_…`); the inbox's email address is accepted
as a within-project alias. **Scope is in the KEY** (no scope headers): a `pk_agent_proj_…` key's
project is implicit; a `pk_agent_org_…` key reaches its org subtree and must pick a list breadth
(`project`/`wildcard`): a bare org-key list is a `400 breadth_required`. Errors are RFC-9457
**problem+json** (`application/problem+json`) with a closed machine `code`
(`forbidden_scope`, `breadth_required`, `not_found`, `idempotency_conflict`, …); the client surfaces
that `code` (and any `request_id`) on every tool error, in both live and `EXTROVERT_MOCK=1` modes.

---

## Scripts

```bash
pnpm run build      # tsc -> dist/ (production build, tests excluded)
pnpm run typecheck  # tsc --noEmit over the whole project (incl. tests)
pnpm run test       # node:test via tsx
pnpm run dev        # tsx watch (stdio); add -- --http for HTTP
pnpm run start      # node dist/bin.js
pnpm run start:http # node dist/bin.js --http
```

---

MIT © Message Science. Extrovert is *steel-at-dusk*: a dark, technical developer brand whose single
warm signal is the amber seam of a side-gate.
