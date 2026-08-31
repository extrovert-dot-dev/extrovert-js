# Extrovert JavaScript packages

Public prerelease source for Extrovert's JavaScript integration surfaces:

- [`@extrovert/sdk`](./packages/sdk) — typed TypeScript client for the Extrovert REST API.
- [`@extrovert/mcp`](./packages/mcp) — MCP server with stdio and self-hosted Streamable HTTP transports.

Both packages share one provisional contract version. Install the dogfood releases through the
explicit `next` tag:

```bash
npm install @extrovert/sdk@next
npx -y @extrovert/mcp@next --help
```

The MCP package installs the `extrovert-mcp` binary. Extrovert does not yet publish a separate
general-purpose CLI, and does not currently operate a production hosted `/mcp` endpoint.

Documentation: [docs.extrovert.dev](https://docs.extrovert.dev)

## Release model

This repository is a generated public release mirror. Cross-surface contract checks and adversarial
skill evaluations run before each export; this repository then rebuilds and packs both public npm
artifacts. Future publishes use npm trusted publishing through `.github/workflows/publish.yml`.

MIT © Message Science LLC.
