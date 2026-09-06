<!-- // SCOPED EMAIL FOR AGENTS -->

# @extrovert.dev/sdk

**A real inbox for your agent, in one call.**

The TypeScript SDK for [Extrovert](https://extrovert.dev): Message Science's agent-email
platform. Extrovert gives an AI agent a real, persistent inbox on a domain we own: created in one
call, sends and receives, behind a scoped key that expires and revokes on its own.

- **One call to a live inbox.** Paid accounts use `agent7@extrovertmail.com`; free
  signups use `agent7@free.extrovertmail.com`. No DNS setup is required.
- **`waitForEmail`, the killer primitive.** Block until the next matching message lands and get the
  OTP code / verification link extracted as a structured field. No polling loop.
- **Typed everything.** Request and response models matching the Extrovert `/v1` contract, a typed
  `ApiError` hierarchy, full `.d.ts` declarations.
- **Runs where your agent runs.** Pure `fetch`. Node 18+, Cloudflare Workers, Vercel Edge, Deno,
  the browser. Zero runtime dependencies.
- **Don't hand an MCP host your master key.** Redeem a scoped enrollment key; issue an agent key that
  expires and revokes on its own.

---

## Install the prerelease

The SDK is published on npm under the `next` dist-tag so an unqualified install cannot be mistaken
for a stable release:

```bash
npm install @extrovert.dev/sdk@next
```

Pin `@extrovert.dev/sdk@0.1.0-pre.11` when a dogfood test needs a reproducible contract snapshot.
Requires Node 18+ for global `fetch` and Web Crypto.

## Build and use from source

```bash
cd extrovert/sdk/ts
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
```

The build produces ESM, CommonJS, and types in `dist/`. The public release source is mirrored at
[`extrovert-dot-dev/extrovert-js`](https://github.com/extrovert-dot-dev/extrovert-js), while the
REST API and served OpenAPI document remain the underlying contract.

---

## Quickstart: inbox in one call

Use the scoped key issued for this agent on your existing account. Do not sign up for another
account to connect a new agent. Confirm the connection with `extrovert.whoami()` before creating
resources; its capability summary explains what the connection can do.

```ts
import { Extrovert, isQueuedForReview } from "@extrovert.dev/sdk";

const extrovert = new Extrovert({ apiKey: process.env.EXTROVERT_API_KEY! });

// One call. A real, send-and-receive-capable inbox.
const inbox = await extrovert.inboxes.create({ display_name: "Support Bot" });
console.log(inbox.address); // agent7@extrovertmail.com

// Queue a message for a human. `intent.summary` is what the reviewer reads
// first, and it is REQUIRED: under the default `require_review` policy a send
// without one is refused 422 `intent_required` (nothing sent, nothing queued).
const outcome = await inbox.send({
  to: "ops@acme.test",
  subject: "agent online",
  text: "Reporting in.",
  intent: { summary: "Tell ops the support agent is live and invite a reply." },
});

if (isQueuedForReview(outcome)) {
  // The normal outcome. Nothing is delivered until a human approves.
  console.log(outcome.review.id); // rr_...
}
```

**Your agent queues mail; it does not send it.** A message parks as a review request, a human
approves / edits / rejects it, and your agent watches for that outcome and redrafts as needed.
`allow_direct` inboxes and graduated categories are the exceptions, not the default: read
`inbox.record?.effective_review_policy` once rather than learning the policy by being refused. The
other half of the loop is the [agent contract](https://docs.extrovert.dev/review-loop/agent-contract/).

`inboxes.create()` returns an `InboxHandle`: an ergonomic handle bound to one address, so the rest
of your agent code reads naturally: `inbox.send(...)`, `inbox.messages()`, `inbox.waitForEmail(...)`,
`inbox.delete()`. This is the curl-style sugar that resolves to your key's default project.

---

## Check whether your domain is ready

```ts
const domain = await extrovert.domains.get("mail.example.com");
const readiness = domain.readiness;
if (!readiness) throw new Error("This server did not return domain readiness.");
console.log(readiness.label, readiness.summary);
console.log(readiness.inboxes); // counts visible to this connection, not a global total

if (readiness.ready_for_inboxes && readiness.next_action === "create_inbox") {
  console.log("Ready to create an inbox when you want one.");
} else if (readiness.action_required_by === "extrovert") {
  console.log("Extrovert is handling the next steps. No DNS changes are needed.");
}

// A deliberate recheck verifies the DNS entries now; ordinary reads do not.
// Use after publishing/fixing the entries, not in a tight polling loop.
await extrovert.domains.verify("mail.example.com");

// Wait at most 45 seconds. A timeout does not stop background setup.
const waiting = await extrovert.domains.wait("mail.example.com", { timeout_seconds: 45 });
if (waiting.outcome === "timed_out") {
  console.log(`Resume checking in ${waiting.resume_after_seconds} seconds.`);
}

// Persist next_cursor privately and pass it as after on the next check.
const updates = await extrovert.domains.events("mail.example.com", { after: "0", limit: 50 });
for (const event of updates.items) console.log(event.summary);
```

`waiting_for_dns` means your DNS entries are not confirmed yet; `setting_up` means Extrovert is
finishing setup. `ready` means mail setup is complete. `action_required` identifies a customer DNS
repair; `needs_attention` identifies work for Extrovert. Temporary `checking` results are inconclusive,
not a request to change DNS. Use the returned summary and next action when answering a person.

Do not infer readiness from legacy verification or signing fields. Ready inboxes still follow their
permissions, account limits, and review rules. Setup continues while your agent is disconnected, but
the agent must stay connected or resume its event/status checks to receive updates.

## The canonical chain: `projects.inboxes.*`

Scope lives in your **key**, not in headers. A broad (org-tier) key narrows to one **project** by
path; a project/inbox key is already pinned. The canonical, contract-aligned surface is the
`projects.inboxes.*` chain, keyed by the **opaque `inbox_id`** (the inbox address is accepted as a
within-project alias):

```ts
const x = new Extrovert({ apiKey: process.env.EXTROVERT_API_KEY! });
const { project_id } = await x.whoami();          // the key's fixed project

// Create / send / list in a project: keyed by the opaque inbox_id.
const inbox = await x.projects.inboxes.create(project_id!, { username: "ada" });
await x.projects.inboxes.send(project_id!, inbox.id, { to: "ops@acme.test", subject: "hi", text: "…",
  intent: { summary: "…one sentence for the human reviewer…" } });   // queues for review

// One list envelope: { object: "list", data, has_more, next_cursor }. The ListPage
// auto-paginates over OPAQUE cursors: never thread a cursor by hand.
const page = await x.projects.inboxes.list(project_id!, { limit: 50 });
for await (const ib of page) console.log(ib.id);   // walks every page
const all = await (await x.projects.inboxes.list(project_id!)).collect();  // eager

// Expand relations (per-resource allowlist, depth ≤ 2):
await x.projects.inboxes.get(project_id!, inbox.id, { include: ["agent", "domain"] });
```

An **org-tier** key can fan out across its subtree with the `-` wildcard
(`x.projects.inboxes.list("-")`); a non-org key on the wildcard is a `forbidden_scope` 403, and an
org key on a bare list is a `breadth_required` 400 (see [Errors](#errors)). The advisory
`x.keyTier` (`org` | `project` | `inbox`) is derived from your key prefix so you can branch before a
round-trip.

The SDK pins a dated **`Extrovert-Version`** header on every request (default `x.apiVersion`, the
latest this SDK was built against); pin an older dated version with `new Extrovert({ apiVersion })`
to opt into the server's transform shim.

---

## The OTP flow: `waitForEmail`

Agents sign up for things. The high-value, time-boxed task is "wait for the verification email and
read the code." Extrovert holds the request open, polls the mailbox server-side, and hands you the extracted code.

```ts
import { Extrovert } from "@extrovert.dev/sdk";

const extrovert = new Extrovert({ apiKey: process.env.EXTROVERT_API_KEY! });
const inbox = await extrovert.inboxes.create({ username: "signup-agent" });

// ... trigger a sign-up that emails an OTP to inbox.address ...
await fetch("https://acme.test/signup", {
  method: "POST",
  body: JSON.stringify({ email: inbox.address }),
});

// Block until it lands (up to 2 min), then read the structured result.
const result = await inbox.waitForEmail({
  from: "no-reply@acme.test",
  subject: "verification",
  timeout_seconds: 120,
});

if (result.timed_out) throw new Error("no email in time");

console.log(result.extracted.otp);  // "492013"
console.log(result.extracted.link); // "https://acme.test/verify?token=..."

// ... submit result.extracted.otp back to the form ...
```

`extracted.otp` and `extracted.link` come from the same extraction machinery that has pulled OTPs out
of real warmup mail for years. Need it standalone? Import `extractOtp` / `extractLink` /
`extractCredentials`.

---

## Try it offline (no API key, no network)

Run the whole SDK against built-in, deterministic fixtures: no key, no network. Every method
works, including a synthesized `waitForEmail` OTP, and the mock models the real review policy,
so a send without an `intent` is refused offline exactly as it would be live:

```ts
const extrovert = new Extrovert({ transport: "mock" });
const inbox = await extrovert.inboxes.create();
const { extracted } = await inbox.waitForEmail();
console.log(extracted.otp); // a fixture OTP: no network touched
```

Set `EXTROVERT_API_BASE_URL=mock` to flip every client into offline mode from the environment.

Offline domain setup remains `waiting_for_dns`: it does not query DNS, run background setup, or
produce lifecycle events. Recheck does not fabricate a ready result. Use a test HTTP response for
readiness transitions and resumable event scenarios; only the live service confirms actual setup.

---

## Scoped keys: redeem an enrollment key

The identity model: a human (or org-admin call) **issues** a scoped `pk_enroll_...` enrollment key
that can create up to *N* inboxes and nothing else. An agent **redeems** it for a short-lived,
individually-revocable `pk_agent_...` key.

```ts
// The agent is handed only the enrollment key: never an org-wide key.
const bootstrap = new Extrovert({ apiKey: process.env.EXTROVERT_ENROLLMENT_KEY! });

const { client, enrollment } = await bootstrap.enrolled({
  token: process.env.EXTROVERT_ENROLLMENT_KEY!, // the raw pk_enroll_... token (required)
  agent_handle: "support-bot", // idempotent: same handle -> same agent
  agent_name: "Support Bot", // optional human-readable label
});

// EnrollResult carries agent_id, agent_key (shown once), scopes, org_id, project_id.
console.log(enrollment.agent_id, enrollment.scopes);
console.log(enrollment.org_id, enrollment.project_id); // the key's fixed org + project

// `client` is already authenticated with the issued agent key.
const inbox = await client.inboxes.create();

// The issued key is bound to a fixed org + project: visible via whoami, never selectable.
const me = await client.whoami();
console.log(me.org_id, me.project_id, me.scopes);
```

---

## Inbox metadata: attach your own key-value data

Every inbox carries an arbitrary `metadata` object (string / number / boolean values; ≤256 keys,
≤256 chars per key and per string value). Set it at create time, read it on every inbox shape, and
patch it in place with shallow-merge / null-delete semantics: no delete+recreate.

```ts
// Set metadata at create time. It is echoed back on the inbox record.
const inbox = await extrovert.inboxes.create({
  username: "support",
  metadata: { team: "growth", tier: 2, vip: true },
});
console.log(inbox.metadata); // { team: "growth", tier: 2, vip: true }

// PATCH semantics on update():
//   - omitting `metadata` leaves it unchanged
//   - an object MERGES (set/overwrite the given keys)
//   - a key whose value is `null` DELETES that key
//   - top-level `metadata: null` CLEARS all metadata (reads back as {})
const updated = await extrovert.inboxes.update(inbox.address, {
  metadata: { tier: 3, team: null }, // bump tier, delete team
});
console.log(updated.metadata); // { tier: 3, vip: true }
```

Metadata is **project-scoped**: a key only reads/mutates inboxes in its bound project. Where the
API accepts a `project_id`, it is an **assertion** that must match the key's bound project (a
mismatch is a 403), never a selector: the project is always derived from the key. See `whoami` for
the fixed `org_id` / `project_id` the key is bound to.

---

## Receiving mail: read, thread, reply

```ts
// Find a conversation. Pass next_cursor back unchanged to continue.
const firstPage = await extrovert.threads.search(inbox.address, {
  q: "deployment",
  limit: 25,
});
const nextPage = firstPage.next_cursor
  ? await extrovert.threads.search(inbox.address, {
      q: "deployment",
      limit: 25,
      cursor: firstPage.next_cursor,
    })
  : undefined;

// Read the complete oldest-first conversation before acting.
const summary = firstPage.items[0];
if (summary) {
  const thread = await extrovert.threads.get(inbox.address, summary.id);
  const authoredText = thread.messages.map((message) =>
    message.extracted_text ?? message.text
  );

  // Recipients, subject, In-Reply-To, and References are derived server-side.
  await extrovert.threads.reply(inbox.address, {
    thread_id: thread.id,
    expected_last_message_id: thread.last_message_id,
    text: "On it — thanks.",
    intent: { summary: "Acknowledge the deployment request." },
    idempotency_key: "deployment-ack-v1",
  });
}
```

If the thread advances first, `expected_last_message_id` returns a 409: fetch the thread again and
reconsider the draft. It is an optimistic check at submission, not an atomic lock through delivery.

For an inbox-bound style, use `inbox.threads(...)`, `inbox.searchThreads(...)`,
`inbox.thread(...)`, `inbox.reply(...)`, and `inbox.deleteThread(...)`.

---

## Webhooks: verified inbound, anywhere

Register an HMAC-signed, timestamped webhook, then verify deliveries with Web Crypto (works in Node
and at the edge, no dependency):

```ts
import { Extrovert, verifyWebhookSignature } from "@extrovert.dev/sdk";

const extrovert = new Extrovert({ apiKey: process.env.EXTROVERT_API_KEY! });

const webhook = await extrovert.webhooks.register({
  url: "https://my-agent.example.com/inbound",
  events: ["message.received"],
});
// Store webhook.secret now: it is shown once.

// In your handler (Workers / Vercel Edge / Node):
export async function POST(req: Request) {
  const payload = await req.text(); // raw body: do not re-serialize
  const ok = await verifyWebhookSignature({
    payload,
    signature: req.headers.get("x-extrovert-signature")!,
    secret: process.env.EXTROVERT_WEBHOOK_SECRET!,
  });
  if (!ok) return new Response("bad signature", { status: 400 });
  // ... handle the verified message.received event ...
  return new Response("ok");
}
```

Or `parseWebhook({ ... })` to verify and JSON-parse in one step (returns `null` on a bad signature).

---

## Configuration

```ts
new Extrovert({
  apiKey: "pk_agent_...",          // or env EXTROVERT_API_KEY
  baseUrl: "https://api.extrovert.dev", // or env EXTROVERT_API_BASE_URL; "mock" for offline
  transport: "http",               // "mock" to force offline fixtures
  timeoutMs: 30_000,               // default request timeout (waitForEmail manages its own)
  retry: { maxRetries: 2, baseDelayMs: 250, maxDelayMs: 8_000 }, // idempotent 429/5xx/network
  fetch: customFetch,              // inject a fetch (tests, proxies, instrumentation)
  defaultHeaders: { "X-Tenant": "acme" },
});
```

| Option       | Env                     | Default                              |
| ------------ | ----------------------- | ------------------------------------ |
| `apiKey`     | `EXTROVERT_API_KEY`       |: (required for `http` transport)    |
| `baseUrl`    | `EXTROVERT_API_BASE_URL`  | `https://api.extrovert.dev`      |
| `transport`  | (`baseUrl=mock`)        | `http`                               |
| `timeoutMs`  |:                       | `30000`                              |

Idempotency: pass `client_id` to `inboxes.create()` and `idempotency_key` to `send` / `reply` :
retries won't duplicate. Cursor pagination: list responses carry `next_cursor`; pass it back as
`cursor`.

---

## Errors

Every non-2xx response throws a typed error extending `ApiError`. Branch on the class or `.code`:

```ts
import {
  ApiError,
  AuthenticationError,  // 401: key missing / expired / revoked
  PermissionError,      // 403: scope denied
  ForbiddenScopeError,  // 403 forbidden_scope: out of the key's ceiling / non-org key on the wildcard
  BreadthRequiredError, // 400 breadth_required: org key on a bare list must pick a project / "-"
  NotFoundError,        // 404: incl. an out-of-ceiling id (never an existence oracle)
  ConflictError,        // 409: incl. idempotency_conflict (same key, different body)
  ValidationError,      // 422: see err.body.error.details
  PaymentRequiredError, // 402: x402 test-mode challenge in err.paymentRequired
  RateLimitError,       // 429: err.retryAfter (seconds)
  ConnectionError,      // network failure before a response
  TimeoutError,         // request timed out / aborted
} from "@extrovert.dev/sdk";

try {
  await x.projects.inboxes.list("-");
} catch (err) {
  if (err instanceof RateLimitError) {
    await sleep((err.retryAfter ?? 1) * 1000);
  } else if (err instanceof ApiError) {
    // The redesigned surface returns RFC-9457 problem+json; switch on the CLOSED code union.
    switch (err.problemCode) {
      case "forbidden_scope": /* pick your own project */ break;
      case "breadth_required": /* err.problem.errors names the next call */ break;
      default: console.error(err.status, err.code, err.problem?.detail, err.requestId);
    }
  } else {
    throw err;
  }
}
```

Every `ApiError` carries `status`, `code`, `requestId`, `body`, and `isClientError` / `isServerError`.
On the redesigned surface it additionally carries the parsed RFC-9457 `problem` and the typed
`problemCode` (the closed `ProblemCode` union: `bad_request`, `unauthorized`, `forbidden_scope`,
`not_found`, `conflict`, `idempotency_conflict`, `breadth_required`, `quota_exceeded`, `rate_limited`,
`domain_not_allowed`, `recipient_blocked`, `not_configured`, `domain_unavailable`, `internal`). The
legacy `{ error, message }` envelope is still parsed for back-compat. GET and DELETE requests retry
automatically on 429/5xx/network errors with jittered backoff that honors `Retry-After`.

---

## API surface

Maps 1:1 to the Extrovert `/v1` REST contract.

| SDK                                   | Endpoint                              |
| ------------------------------------- | ------------------------------------- |
| `extrovert.enroll()` / `.enrolled()`    | `POST /v1/enroll`                     |
| `x.projects.inboxes.create(p, ...)`     | `POST /v1/projects/{project_id}/inboxes`              |
| `x.projects.inboxes.list(p, ...)`       | `GET /v1/projects/{project_id}/inboxes` (List envelope) |
| `x.projects.inboxes.get(p, inbox_id)`   | `GET /v1/projects/{project_id}/inboxes/{inbox_id}`   |
| `x.projects.inboxes.update(p, inbox_id)`| `PATCH /v1/projects/{project_id}/inboxes/{inbox_id}` |
| `x.projects.inboxes.delete(p, inbox_id)`| `DELETE /v1/projects/{project_id}/inboxes/{inbox_id}`|
| `x.projects.inboxes.credentials(...)`   | `GET /v1/projects/{project_id}/inboxes/{inbox_id}/credentials` |
| `extrovert.inboxes.create()` *(sugar)*  | `POST /v1/inboxes`                    |
| `extrovert.inboxes.list()` *(sugar)*    | `GET /v1/inboxes`                     |
| `extrovert.inboxes.get(addr)` *(sugar)* | `GET /v1/inboxes/{inbox_id}`          |
| `extrovert.inboxes.delete(addr)` *(sugar)* | `DELETE /v1/inboxes/{inbox_id}`     |
| `inbox.send()`                        | `POST /v1/inboxes/{addr}/send`        |
| `inbox.messages()`                    | `GET /v1/inboxes/{addr}/messages`     |
| `inbox.threads()`                     | `GET /v1/inboxes/{addr}/threads`      |
| `inbox.searchThreads()`               | `GET /v1/inboxes/{addr}/threads/search` |
| `inbox.thread(thread_id)`             | `GET /v1/inboxes/{addr}/threads/{thread_id}` |
| `inbox.reply({ thread_id, ... })`      | `POST /v1/inboxes/{addr}/reply`       |
| `inbox.deleteThread(thread_id)`        | `DELETE /v1/inboxes/{addr}/threads/{thread_id}` |
| `inbox.waitForEmail()`                | `POST /v1/inboxes/{addr}/wait`        |
| `extrovert.inboxes.update(addr, ...)`   | `PATCH /v1/inboxes/{addr}`            |
| `extrovert.messages.get(id)`            | `GET /v1/messages/{id}`               |
| `extrovert.threads.list(inbox, ...)`     | `GET /v1/inboxes/{inbox}/threads`     |
| `extrovert.threads.search(inbox, ...)`   | `GET /v1/inboxes/{inbox}/threads/search` |
| `extrovert.threads.get(inbox, id)`       | `GET /v1/inboxes/{inbox}/threads/{id}` |
| `extrovert.threads.reply(inbox, ...)`    | `POST /v1/inboxes/{inbox}/reply`      |
| `extrovert.threads.delete(inbox, id)`    | `DELETE /v1/inboxes/{inbox}/threads/{id}` |
| `extrovert.webhooks.register()`         | `POST /v1/webhooks`                   |
| `extrovert.domains.onboard(...)`        | `POST /v1/domains`                    |
| `extrovert.commerce.quoteDomain(...)`   | `POST /v1/commerce/domain-quotes`     |
| `extrovert.commerce.requestDomainPurchase(...)` | `POST /v1/commerce/requests/domain-purchases` |
| `extrovert.commerce.requestPlanChange(...)` | `POST /v1/commerce/requests/plan-changes` |
| `extrovert.commerce.get(...)`           | `GET /v1/commerce/requests/{id}`      |
| `extrovert.whoami()`                    | `GET /v1/auth/me`                     |

Helpers: `verifyWebhookSignature`, `parseWebhook`, `extractOtp`, `extractLink`,
`extractCredentials`, `MockBackend`.

### Inbox quota and deletion

`extrovert.inboxes.update(address, { daily_send_limit: 250 })` and the
project-prefixed mirror set the inbox's effective rolling-24-hour recipient cap.
The value must be an integer from 1 through 10,000, and the key needs the
opt-in `mailbox:quota` scope. The returned `Inbox.daily_send_limit` is the cap
the service will enforce.

`extrovert.inboxes.delete(address)` and its project-prefixed mirror require
`mailbox:delete`. Deletion permanently removes the inbox, its messages, and its
sender identity; it cannot be undone or recovered.

### Scopes

A key carries a subset of these capability scopes (`whoami().scopes`):

| Scope             | Grants                                                                 |
| ----------------- | ---------------------------------------------------------------------- |
| `mailbox:create`  | Create inboxes.                                                        |
| `mailbox:read`    | Read inboxes, messages, threads.                                       |
| `mailbox:credentials` | Export raw IMAP/SMTP credentials on paid plans; never implied by read. |
| `mailbox:send`    | Send / reply / forward.                                                |
| `mailbox:quota`   | Change an inbox's effective daily recipient cap (opt-in).              |
| `mailbox:delete`  | Delete inboxes.                                                        |
| `webhook:write`   | Register / manage webhooks.                                            |
| `domain:manage`   | Onboard / verify / offboard shared or customer-controlled domains. It never buys a domain. |
| `domain:read`     | Read accessible domains, readiness, and domain updates without permission to change setup. |
| `commerce:request` | Quote and request a domain purchase or plan change, then poll status. It never approves or spends directly. |
| `review:act`      | The BYO reviewer decision plane.                                       |

> The `mailbox:*` scope strings are the live wire contract (the public product term is **inbox**;
> the scope strings are kept verbatim so already-issued keys stay valid).

---

## Review Loop: the open contract

The **Review Loop** (HITL) adds supervised autonomy: an agent submits a draft `mode:"review"`,
a human approves / edits / rejects it, and the loop learns. The stable agent-facing JSON shapes
are published here as a documented, **versioned open contract**: an SDK + skill contract, **not**
a wire protocol (there is no `/v1/contract` endpoint).

```ts
import { CONTRACT_VERSION, CONTRACT_MANIFEST } from "@extrovert.dev/sdk";

CONTRACT_VERSION;            // "0.1.0-pre.11": provisional, pre-1.0; pin it
CONTRACT_MANIFEST.stability; // "provisional"
CONTRACT_MANIFEST.core_shapes; // ["ReviewIntent","ReviewFeedback","DiffJson","Rule","ReviewEvent"]
```

**Rule layering (org / project).** A `Rule` carries a `rule_layer` (`"org" | "project"`) plus
`org_id` / `project_id`. `org` rules are house-style inherited by every project in the org;
`project` rules are layered on top and outrank broader org rules in the ordered `get_rules`
precedence ladder. An agent-plane `rules.save(...)` is **always project-layer** (bound to the key's
project); an agent **cannot author `rule_layer: "org"` rules in v1**: that is a console/admin
action. (`scope: "general"` still means a house-style rule *within* the project layer: `scope` is
the category axis, `rule_layer` is the ownership axis.)

Full reference: the [agent contract](https://docs.extrovert.dev/review-loop/agent-contract/) docs
page and the agent skills (`extrovert-send-email`, `extrovert-writing-rules`).

### Contract & versioning

The Review-Loop shapes are an **open, documented contract: versioned *with* this SDK** (not a wire
protocol; there is no `/v1/contract` endpoint). Three guarantees:

- **One version, everywhere.** `CONTRACT_VERSION` is **`0.1.0-pre.11`**, reconciled across the SDK package
  version, the MCP server, and the OpenAPI `info.version`. Pin it; pin `CONTRACT_MANIFEST` for the
  exact shape set you built against.
- **Named, documented types.** The five canonical shapes: `ReviewIntent`, `ReviewFeedback`,
  `DiffJson` (+`DiffHunk`), `Rule`, `ReviewEvent`: plus the full M1–M8 surface (submit/states,
  chat, categories, graduation + risk dial, reconciliation + pacing, rules + audit, the BYO reviewer
  decision plane) are exported as named TypeScript types from the `contract` module.
  `CONTRACT_MANIFEST.shapes` enumerates them all by name.
- **Drift-proof.** A conformance/drift test validates the canonical example JSON against **both** the
  OpenAPI component schemas (Go) and these SDK types, and asserts the version is reconciled across
  every surface (plus a negative test so the guard isn't a tautology). Rename a field anywhere and
  the build breaks: the published types can't silently diverge from the wire.

> **Provisional 0.x.** The contract is open and documented but MAY still evolve additively before
> 1.0 (no external users yet). Pin `CONTRACT_VERSION` and `CONTRACT_MANIFEST`.

---

## Examples

Runnable with [`tsx`](https://github.com/privatenumber/tsx): work offline out of the box:

```bash
EXTROVERT_API_BASE_URL=mock npx tsx examples/mailbox-in-one-call.ts
EXTROVERT_API_BASE_URL=mock npx tsx examples/wait-for-otp.ts
```

---

## Status

> **Note.** This source SDK tracks the `/v1` contract at `CONTRACT_VERSION` `0.1.0-pre.11`: a
> deliberate **prerelease**, pre-1.0, expect additive change. The offline `mock` transport models the
> live server closely enough to reproduce a 422 `intent_required` and a queued review, so build and
> test against it before you have a key. Install from the `next` tag until a stable release is cut.

---

MIT © Message Science. *A side gate for agents.*

## Explicitly delegated administration

Use an API-audience connection token or independently issued `ev_credential_...` credential with
explicit Full account control. Ordinary `pk_agent_...` keys do not grant administration.

```ts
const client = new Extrovert({ apiKey: process.env.EXTROVERT_API_KEY });
const identity = await client.administration.call("adminMe", {});
const actions = client.administration.list({ search: "project", limit: 10 });
const schema = client.administration.describe("createProject");
// Use an organization returned by adminMe and the requested project name.
const project = await client.administration.call("createProject", {
  path: { org_id: organizationId },
  body: { name: "Support", slug: "support" },
});
```

Inputs and outputs are typed from the customer OpenAPI contract. Read state after an ambiguous
mutation result; mutations are not automatically retried. Current human roles remain the ceiling
and private platform access is excluded. The original full-control connection expires after
24 hours by default; refresh does not extend it. Credentials it creates, including admin
credentials, survive independently and require separate revocation.

For offline catalog and project-creation demos, pass `transport: "mock"` and the exported
`ADMINISTRATIVE_FIXTURE_KEY` as `apiKey`. Other administrative execution fixtures fail explicitly;
use a test HTTP server through the custom `fetch` option to test additional workflows.
