#!/usr/bin/env node
// #2435 implementor-owned happy-path regression. This is intentionally separate
// from the adversarial governance self-test so deleting either proof is visible.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DEFAULT_MANIFEST,
  DEFAULT_ROOT,
  discoverLiveOrigins,
  discoverWorkflowProviders,
  inspectWorkflows,
  validateRegistry,
} from "../ci-batch/validate-manifest-v2.mjs";

test("#2435 registry v2 proves the complete current topology", () => {
  const manifest = JSON.parse(fs.readFileSync(DEFAULT_MANIFEST, "utf8"));
  const errors = validateRegistry(manifest, { root: DEFAULT_ROOT });
  assert.deepEqual(errors, []);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.suites.length, 22);
  assert.equal(manifest.legacyOrigins.length, 198);
  assert.equal(manifest.workflowProviders.length, 89);
  assert.equal(discoverLiveOrigins(DEFAULT_ROOT).length, 176);
  assert.equal(discoverWorkflowProviders(DEFAULT_ROOT).length, 89);
  assert.equal(new Set(manifest.legacyOrigins.map((item) => `${item.stem}.${item.extension}`)).size, 198);
  assert.equal(new Set(manifest.workflowProviders.map((item) => item.workflow)).size, 89);
  const suite1036 = manifest.suites.find((suite) => suite.id === "issue-1036-contrast-chip-removal-tests");
  const suite1532 = manifest.suites.find((suite) => suite.id === "issue-1532-tester-adversarial");
  assert.ok(suite1036.expectedFiles.includes("mingla-business/src/components/theme/__tests__/issue1036NoContrastNode.web.render.test.tsx"));
  assert.ok(suite1532.expectedFiles.includes("mingla-business/src/components/stay/__tests__/stayGuardReachability.issue1532.tester.render.test.tsx"));

  const live = discoverLiveOrigins(DEFAULT_ROOT);
  const yamlTruth = inspectWorkflows(DEFAULT_ROOT, live);
  const registered = new Map(
    manifest.legacyOrigins
      .filter((item) => item.disposition !== "batched-active")
      .map((item) => [`${item.stem}.${item.extension}`, item.workflowMetadata]),
  );
  const metadata = (stem) => registered.get(`${stem}.${"yml"}`);
  assert.equal([...registered].filter(([name, metadata]) => JSON.stringify(metadata) === JSON.stringify(yamlTruth[name])).length, 176);

  // Real repository shapes that defeated the original line parser.
  assert.equal(metadata("issue-1773-reservation-stay-ingest-tests").pathScope.length, 10, "YAML path aliases must resolve");
  assert.ok(metadata("issue-1171-dark-payout-ledger-tests").setupActions.includes("./.github/actions/migrated-postgres"), "named-step uses keys must be inventoried");
  assert.ok(metadata("issue-1403-listing-insights-tests").setupActions.includes("actions/upload-artifact@v4"), "later mapping-key actions must be inventoried");
  assert.ok(metadata("issue-1995-contact-book-blast").runtimeVersions.includes("node:20"), "flow-style with maps must preserve runtime versions");
});
