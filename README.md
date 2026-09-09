# Extrovert JavaScript packages

Public prerelease source for Extrovert's JavaScript integration surfaces:

- [`@extrovert.dev/sdk`](./packages/sdk) — typed TypeScript client for the Extrovert REST API.
- [`@extrovert.dev/mcp`](./packages/mcp) — MCP SDK v2 server with stdio and stateless Streamable HTTP transports.

Both packages share one provisional contract version. Install the dogfood releases through the
explicit `next` tag:

```bash
npm install @extrovert.dev/sdk@next
npx -y @extrovert.dev/mcp@next --help
```

The MCP package installs `extrovert-mcp` for MCP transports and the `extrovert` CLI alias for setup,
authentication, inbox reads, review status, and reviewed sends. OAuth-capable clients can connect directly to the production protected resource
at `https://mcp.extrovert.dev/mcp`; the browser flow avoids putting an Extrovert key in client config.

Choose [Connections and access](https://docs.extrovert.dev/concepts/connections-and-access/) for the
job: selected inboxes for existing mail, project/organization reach for future resources, or explicit
Full account control for explicitly requested account administration. Ordinary email setup
uses a dedicated agent with selected inboxes and only the needed actions; see the
[installation guide](https://docs.extrovert.dev/quickstart/install/). Full control defaults to 24 hours; refresh never extends it. Created
credentials, including administrative credentials, survive independently and need separate revocation.

MCP exposes administrative catalog/read/change tools; the CLI provides `admin actions/describe/read/change`,
and the SDK provides typed `client.administration.call`. Start with `whoami`, then inspect exact schemas.
`adminMe` is only for Full account control; project managers use their fixed project and granted actions.
Use API-audience credentials for the SDK/local CLI, and hosted MCP OAuth in the host; they are distinct.

For a manager that creates its own team, authorize **Project → Project manager** in
OAuth, or choose **Credentials → API keys → Create project manager key** in the
console. The console key requires human organization admin/owner authority and no
prior OAuth connection. Copy it into `EXTROVERT_API_KEY` for API/SDK/local MCP use;
hosted MCP uses OAuth. Sending is opt-in and must be included if workers need it.

An authorized connection can create project manager or worker credentials through
`createConnectionCredential` in the API, MCP administrative tools, or SDK. It can
delegate only its own reach and permissions; project managers stay inside their
project. The human-only root-key creation endpoint is separate from delegation.
Created workers survive ordinary parent expiry/revocation; Connections can revoke
the entire team. See the [manager walkthrough](https://docs.extrovert.dev/concepts/connections-and-access/#give-a-manager-one-project).

Documentation: [docs.extrovert.dev](https://docs.extrovert.dev)

## Email your human without review

**Skip review for emails to you** starts off. The account human can enable it in
**Review → Auto-send**. It applies only when the sole recipient is their displayed
verified email: exactly one To entry, no Cc or Bcc, and no aliases. Writing rules and
sending limits still apply. Messages to anyone else keep their existing review policy,
including any separately enabled category auto-send. Signup practice still requires review.

Read `human_email_review` through MCP `get_inbox` or a single-inbox SDK read to check
availability, the verified address, and the settings link. Ordinary agents cannot
enable it; programmatic changes require explicit Full account control.
[Read the exact scope and API instructions](https://docs.extrovert.dev/review-loop/agent-contract/#email-your-human-without-review).

## Release model

This repository is a generated public release mirror. Cross-surface contract checks and adversarial
skill evaluations run before each export; this repository then rebuilds and packs both public npm
artifacts. Future publishes use npm trusted publishing through `.github/workflows/publish.yml`.

MIT © Message Science LLC.

Optional project and organization review exceptions let agents email one another when every recipient belongs to the enabled scope. Both start off, grant no inbox access, and preserve writing rules and sending limits. [Scope, settings, and API instructions](https://docs.extrovert.dev/review-loop/agent-contract/#email-between-agents-without-review).
