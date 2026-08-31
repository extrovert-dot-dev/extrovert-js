<!-- // SCOPED EMAIL FOR AGENTS -->

# Extrovert MCP server

**A real inbox for your agent, in one call.**

`@extrovert/mcp` is the [Model Context Protocol](https://modelcontextprotocol.io) server for
[Extrovert](../README.md) — Message Science's agentic-email platform. It gives an AI agent a real,
persistent inbox on a domain Extrovert owns: created in one tool call, sends and receives, behind a
**scoped key that expires and revokes on its own**. The key is bound to a fixed org + project (call
`whoami` to see them) — there is no project selector to manage.

> **Prerelease status:** the package is published on npm under the `next` dist-tag. Extrovert does
> not currently operate a hosted MCP endpoint; use the packaged stdio server or an HTTP deployment
> you operate yourself.

The standout tool is **`wait_for_email`** — a blocking call that returns the next matching message
with the **OTP code and verification link already extracted**. Trigger a sign-in elsewhere, then act
on the code in the same turn. No polling loop, no losing the 5-minute window.

```text
redeem an enrollment key  ->  create_inbox  ->  use it as a sign-up address  ->  wait_for_email -> { otp_code, verification_link }
```

---

## Tools

| Tool | What it does |
|---|---|
| `redeem_enrollment` | Exchange an enrollment token (`pk_enroll_…`) for a **scoped agent key** (`pk_agent_…`). |
| `create_inbox` | Provision an inbox. Omit username/domain for an instant `agent@smtp.extrovert.dev` address. Attach arbitrary metadata. |
| `list_inboxes` | List the inboxes this agent owns. Project keys need no args; an **org-tier** key must pick a breadth (`project:<id>` or `wildcard:true`). |
| `get_inbox` | Fetch one inbox by opaque `inbox_id` (`pmbx_…`) or address (with its metadata). |
| `update_inbox` | Update settings; `daily_send_limit` (1–10,000) sets the enforced rolling-24-hour recipient cap and requires opt-in `mailbox:quota`. |
| `delete_inbox` | Permanently delete an inbox, its messages, and sender identity. Requires `mailbox:delete`; cannot be undone. |
| `send_email` | Send a new email via the inbox's authenticated sender. |
| `reply_email` | Reply within an existing thread. |
| `read_messages` | List messages in an inbox (optionally unread-only). |
| `list_threads` | List conversation threads. |
| `search` | Full-text search across one or all inboxes. |
| **`wait_for_email`** | **Block until a matching message arrives; return it + extracted `otp_code` / `verification_link`.** |

Every tool is registered with a typed [zod](https://zod.dev) input schema and behavioural
annotations (`readOnlyHint`, `destructiveHint`, …) so hosts can present and gate them correctly.

---

## The security model (why a scoped key, not a master key)

> Don't hand an MCP host your master key. Hand it a scoped key.

An MCP host should never hold the keys to your whole account — it only ever needs a narrow, outbound
voice. With Extrovert it receives nothing more than a **scoped agent key**:

- **scoped** — carries only the granted capabilities (e.g. `mailbox:create`, `mailbox:read`,
  `mailbox:send`); quota changes require opt-in `mailbox:quota`, deletion requires
  `mailbox:delete`, and the key may additionally be restricted to fixed domains;
- **server-enforced** — the inbox counter and revocation live server-side; a cloned key can't
  exceed its `max_mailboxes`;
- **revocable** — killing one agent's key never rotates anyone else's;
- **audited** — every action is attributed to the token + agent.

This is the deliberate containment of the Postmark-MCP supply-chain blast radius: no org-wide key
ever reaches the model host. Keep every model host on the narrowest scoped key it needs.

---

## Install and run the prerelease

Use the explicit prerelease tag:

```bash
# stdio for an MCP host
npx -y @extrovert/mcp@next

# inspect the packaged CLI
npx -y @extrovert/mcp@next --help
```

Pin `@extrovert/mcp@0.1.0-pre.3` for a reproducible dogfood environment. The package installs the
`extrovert-mcp` binary; this is the only Extrovert CLI currently shipped.

## Build and run from source

Requires Node ≥ 18.18. From this directory:

```bash
pnpm install --frozen-lockfile
pnpm run build      # compiles to dist/ (excludes tests)
```

Two transports, one binary:

```bash
# stdio — for local hosts (Claude Desktop, Claude Code, Cursor)
node /absolute/path/to/extrovert/mcp/dist/bin.js

# self-hosted Streamable HTTP at POST /mcp (default :8787)
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
| `EXTROVERT_API_KEY` | *(empty)* | Scoped agent key (`pk_agent_…`) or enrollment key (`pk_enroll_…`). |
| `EXTROVERT_MOCK` | *(off)* | Set `1` to force offline fixtures. |
| `EXTROVERT_REQUEST_TIMEOUT_MS` | `30000` | Per-request timeout for non-blocking calls. |
| `EXTROVERT_MAX_WAIT_MS` | `300000` | Upper bound the server allows `wait_for_email` to block. |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | `--http` bind. |

> **Offline fixtures are opt-in.** With no `EXTROVERT_API_KEY`, the server still talks to the live
> API so an agent can start with `sign_up` and receive a limited key in-session. Set
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
      "args": ["-y", "@extrovert/mcp@next"],
      "env": {
        "EXTROVERT_API_BASE_URL": "https://api.extrovert.dev",
        "EXTROVERT_API_KEY": "pk_agent_…"
      }
    }
  }
}
```

For Claude Code, register that same local entrypoint:

```bash
claude mcp add extrovert \
  --env EXTROVERT_API_BASE_URL=https://api.extrovert.dev \
  --env EXTROVERT_API_KEY=pk_agent_… \
  -- npx -y @extrovert/mcp@next
```

> **Offline:** omit `EXTROVERT_API_KEY` and set `EXTROVERT_MOCK=1`; the packaged server uses
> deterministic fixtures with no network or mail.

---

## Example agent flow

The canonical flow — **redeem → create_inbox → wait_for_email** — as an agent would run it.

**1. Redeem an enrollment key for a scoped agent key.** Skip this if the host already has a key in
`EXTROVERT_API_KEY`.

```jsonc
// tool: redeem_enrollment
{ "enrollment_token": "pk_enroll_42_aZ9…", "agent_handle": "signup-bot" }
// -> { agent_id, agent_key: "pk_agent_… (shown once)", scopes: ["mailbox:create", ...],
//      org_id, project_id }
```

**2. Mint an inbox.** Omit `username`/`domain` for an instant address on a pre-warmed, verified
shared subdomain. Optionally tag it with arbitrary `metadata` (string/number/boolean values).

```jsonc
// tool: create_inbox
{ "display_name": "Signup Bot", "metadata": { "team": "growth", "vip": true } }
// -> { object: "inbox", id: "pmbx_… (opaque inbox_id — treat as opaque)",
//      org_id, project_id, address: "agent3@smtp.extrovert.dev", status: "live",
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
{ "inbox": "agent3@smtp.extrovert.dev", "from": "stripe.com", "subject": "verify", "timeout_ms": 120000 }
// -> { matched: true,
//      message: { from, subject, text, … },
//      otp_code: "481920",
//      verification_link: "https://dashboard.stripe.com/verify?code=481920&id=evt_9" }
```

The agent now has the OTP and the link in the same turn — paste the code, or open the link, and
continue. No polling, no separate "check the inbox" round-trips.

**4. Keep working.** Send, reply in-thread, search, list:

```jsonc
// tool: send_email
{ "inbox": "agent3@smtp.extrovert.dev", "to": ["founder@acme.example"],
  "subject": "intro", "text": "Hi — provisioned via Extrovert.",
  "intent": { "summary": "Introduce the new agent inbox." }, "client_id": "send-intro-1" }

// tool: reply_email
{ "inbox": "agent3@smtp.extrovert.dev", "thread_id": "thr_…", "text": "Following up.",
  "intent": { "summary": "Continue the existing conversation." }, "client_id": "reply-followup-1" }

// tool: search
{ "query": "invoice", "inbox": "agent3@smtp.extrovert.dev" }
```

---

## Self-hosted HTTP notes

`extrovert-mcp --http` speaks MCP Streamable HTTP:

- `POST /mcp` — client→server messages (the first must be `initialize`); the SDK assigns an
  `mcp-session-id` returned on the response.
- `GET /mcp` — server→client SSE stream for an established session.
- `DELETE /mcp` — tear a session down.
- `GET /healthz` — liveness + mode (`mock`/`live`) + active session count.

Each session gets an isolated server + client. A **per-request scoped key** may be supplied via
`Authorization: Bearer …` (or `x-extrovert-api-key`), so one hosted deployment can serve many agents,
each with their own scoped key — falling back to `EXTROVERT_API_KEY` when no header is present. This
is how a single hosted endpoint stays multi-tenant without ever holding an org-wide key.

Extrovert does not operate this transport as a public hosted endpoint. These notes apply only to a
deployment you control.

---

## Architecture

```text
src/
  bin.ts        CLI entrypoint (--http | stdio)
  server.ts     McpServer factory + instructions
  stdio.ts      stdio transport
  http.ts       Streamable HTTP transport (Express, per-session, bearer key)
  tools.ts      manifest-driven tools — zod schemas, annotations, handlers, registration
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
tool surface without network access. The endpoints the client targets:

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
| `search` | `GET /v1/inboxes/{inbox_id}/messages/search` (fans out across inboxes when none given) |
| `wait_for_email` | `POST /v1/inboxes/{inbox_id}/wait` (server holds the connection via IMAP IDLE) |

The path key is the canonical opaque **`inbox_id`** (`pmbx_…`); the inbox's email address is accepted
as a within-project alias. **Scope is in the KEY** (no scope headers): a `pk_agent_proj_…` key's
project is implicit; a `pk_agent_org_…` key reaches its org subtree and must pick a list breadth
(`project`/`wildcard`) — a bare org-key list is a `400 breadth_required`. Errors are RFC-9457
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
