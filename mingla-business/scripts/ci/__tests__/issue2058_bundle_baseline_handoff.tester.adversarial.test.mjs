/**
 * Independent tester guard for issue #2058.
 *
 * The handoff state machine is useful only if the producer workflow faithfully
 * carries the stale measurement result into both the baseline writer and the
 * REST handoff. A stale comparison that merely logs its result silently turns
 * the all-main ratchet into a no-op, so lock that output protocol directly.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../../");
const workflow = readFileSync(join(ROOT, ".github/workflows/bundle-baseline-ratchet.yml"), "utf8");
const producer = readFileSync(join(ROOT, "mingla-business/scripts/ci/bundle-baseline-update.mjs"), "utf8");

test("#2058 stale comparison explicitly drives the write and REST handoff", () => {
  const compareStart = workflow.indexOf("- name: Compare against the recorded baseline");
  const writeStart = workflow.indexOf("- name: Write the new baseline");
  const tokenStart = workflow.indexOf("- name: Mint the one-job bundle-baseline App token");
  assert.ok(compareStart >= 0 && writeStart > compareStart && tokenStart > writeStart);

  const compareStep = workflow.slice(compareStart, writeStart);
  const writeStep = workflow.slice(writeStart, tokenStart);
  assert.match(compareStep, /if \[ "\$code" -eq 0 \]; then[\s\S]*echo "stale=false" >> "\$GITHUB_OUTPUT"/);
  assert.match(compareStep, /node scripts\/ci\/bundle-baseline-update\.mjs --check/);
  assert.match(compareStep, /elif \[ "\$code" -eq 2 \]; then/);
  assert.match(producer, /if \(mode === "check"\)[\s\S]*const out = process\.env\.GITHUB_OUTPUT/);
  assert.match(producer, /`stale=true\\ndirection=\$\{direction\}\\nsummary=\$\{summary\}\\n`/);
  assert.match(producer, /process\.exit\(2\)/);
  assert.match(writeStep, /if: steps\.compare\.outputs\.stale == 'true'/);
  assert.match(workflow, /BASELINE_CHANGED: \$\{\{ steps\.compare\.outputs\.stale \}\}/);
});
