// Read-only preflight: never publish or move a dist-tag from this script.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function checkPublish({ version, tag, approveStable, packages }) {
  assert.match(version ?? "", /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/, "Exact release version required");
  assert(["latest", "next", "beta"].includes(tag), "Unsupported dist-tag");
  const prerelease = version.includes("-");
  if (tag === "latest") {
    assert(!prerelease, "A prerelease cannot be promoted to latest");
    assert.equal(approveStable, "true", "Stable promotion requires explicit confirmation");
  }
  assert.equal(packages.length, 2, "Both SDK and MCP must be checked before publishing either");
  assert.deepEqual(packages.map(p => p.name).sort(), ["@extrovert.dev/mcp", "@extrovert.dev/sdk"]);
  for (const pkg of packages) {
    assert.equal(pkg.version, version, `${pkg.name}: requested version mismatch`);
    assert.equal(pkg.publishConfig?.access, "public", `${pkg.name}: public access required`);
    assert.equal(pkg.publishConfig?.tag, prerelease ? "next" : "latest", `${pkg.name}: package default tag mismatch`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkPublish({ version: process.env.EXPECTED_VERSION, tag: process.env.DIST_TAG,
    approveStable: process.env.APPROVE_STABLE,
    packages: ["sdk", "mcp"].map(name => JSON.parse(readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url), "utf8"))) });
  console.log("Both package versions and requested publication channel validated");
}
