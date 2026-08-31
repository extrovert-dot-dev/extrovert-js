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

The MCP package installs the `extrovert-mcp` binary. Extrovert does not yet publish a separate
general-purpose CLI. OAuth-capable clients can connect directly to the production protected resource
at `https://mcp.extrovert.dev/mcp`; the browser flow avoids putting an Extrovert key in client config.

Documentation: [docs.extrovert.dev](https://docs.extrovert.dev)

## Release model

This repository is a generated public release mirror. Cross-surface contract checks and adversarial
skill evaluations run before each export; this repository then rebuilds and packs both public npm
artifacts. Future publishes use npm trusted publishing through `.github/workflows/publish.yml`.

MIT © Message Science LLC.
