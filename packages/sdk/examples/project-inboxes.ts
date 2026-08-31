/**
 * The canonical project-scoped chain: `x.projects.inboxes.*`.
 *
 * Scope lives in the KEY; a broad (org-tier) key narrows to one project by PATH.
 * This is the contract-canonical surface — the bare `x.inboxes.*` is curl sugar that
 * resolves to the key's default project.
 *
 * Run offline against the built-in fixtures:
 *   EXTROVERT_API_BASE_URL=mock npx tsx examples/project-inboxes.ts
 *
 * Against the live API:
 *   EXTROVERT_API_KEY=pk_agent_proj_... npx tsx examples/project-inboxes.ts
 */

import { Extrovert, BreadthRequiredError, ForbiddenScopeError } from "@extrovert.dev/sdk";

async function main() {
  const x = new Extrovert({ transport: process.env.EXTROVERT_API_KEY ? "http" : "mock" });

  // The mock binds every key to "prj_mock"; live, use whoami().project_id.
  const projectId =
    x.baseUrl === "mock" ? "prj_mock" : ((await x.whoami()).project_id ?? "prj_mock");

  // The key tier is derived from the key prefix (advisory; the server is authoritative).
  console.log(`key tier: ${x.keyTier}; api version pinned: ${x.apiVersion}`);

  // Create an inbox in the project. The opaque inbox_id is the canonical key.
  const inbox = await x.projects.inboxes.create(projectId, { username: "ada", display_name: "Ada" });
  console.log(`inbox ${inbox.id} @ ${inbox.address} in project ${inbox.project_id}`);

  // Send from it via the chain.
  await x.projects.inboxes.send(projectId, inbox.id, {
    to: "ops@acme.test",
    subject: "online",
    text: "Reporting in.",
  });

  // List with the ONE envelope + opaque cursor; the ListPage auto-paginates.
  const page = await x.projects.inboxes.list(projectId, { limit: 50 });
  console.log(`page: object=${page.object} has_more=${page.hasMore}`);
  for await (const ib of page) console.log(`  - ${ib.id} ${ib.address}`);

  // Errors are typed RFC-9457 problems. An org-tier key on a bare list needs a
  // breadth pick; a non-org key on the org wildcard is forbidden_scope.
  try {
    await x.projects.inboxes.list("-");
  } catch (err) {
    if (err instanceof ForbiddenScopeError) console.log("expected: non-org key may not use the wildcard");
    else if (err instanceof BreadthRequiredError) console.log("expected: pick a breadth");
    else throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
