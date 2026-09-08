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
and the SDK provides typed `client.administration.call`. Start with `adminMe`, then inspect exact schemas.
Use API-audience credentials for the SDK/local CLI, and hosted MCP OAuth in the host; they are distinct.

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
