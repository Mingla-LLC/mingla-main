// #2829 W7c (A13.3) — the Sites design goldens were rendered on arm64, so the
// CI step that compares against them runs on the arm64 runner, in its own job,
// and nowhere else. Moving the step back onto an x64 job (or deleting it)
// fails here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Path parts, like the other Sites ops tests: docs/checks reserve the literal
// workflow path for workflow files themselves.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "web-build-check.yml"), "utf8");

/** The text of one top-level job (from its `  name:` line to the next job). */
function jobSection(name) {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join("\n");
}

test("#2829 goldens run in their own job on ubuntu-24.04-arm", () => {
  const goldens = jobSection("mingla-sites-goldens");
  assert.ok(goldens, "mingla-sites-goldens job exists");
  assert.match(goldens, /^    runs-on: ubuntu-24\.04-arm$/m);
  assert.match(goldens, /npm run goldens:render/);
  assert.match(goldens, /mcr\.microsoft\.com\/playwright:v1\.64\.0-noble node e2e\/goldens\/goldens\.mjs/);
  assert.match(workflow, /# \[WORKFLOW-MOD-APPROVED #2829\] Sites design goldens/);
});

test("#2829 the goldens comparison runs nowhere else (no x64 copy)", () => {
  const occurrences = workflow.split("e2e/goldens/goldens.mjs").length - 1;
  assert.equal(occurrences, 1);
  const build = jobSection("mingla-sites-build");
  assert.ok(build);
  assert.doesNotMatch(build, /goldens:render|goldens\.mjs/);
});
