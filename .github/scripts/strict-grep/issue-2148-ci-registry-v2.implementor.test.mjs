#!/usr/bin/env node
// #2435 implementor-owned happy-path regression. This is intentionally separate
// from the adversarial governance self-test so deleting either proof is visible.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DEFAULT_MANIFEST,
  DEFAULT_ROOT,
  decodeManifestTextRepresentations,
  discoverLiveOrigins,
  discoverWorkflowProviders,
  inspectWorkflows,
  validateRegistry,
} from "../ci-batch/validate-manifest-v2.mjs";

test("#2435 registry v2 proves the complete current topology", () => {
  const rawManifest = JSON.parse(fs.readFileSync(DEFAULT_MANIFEST, "utf8"));
  const errors = validateRegistry(rawManifest, { root: DEFAULT_ROOT });
  assert.deepEqual(errors, []);
  const manifest = decodeManifestTextRepresentations(rawManifest);
  assert.equal(manifest.schemaVersion, 2);
  const baseline = manifest.suites.slice(0, 23);
  const shadow = manifest.suites.slice(23);
  assert.equal(manifest.suites.length, 55);
  assert.deepEqual(baseline.map(({ id, ownerIssue, lifecycle }) => [id, ownerIssue, lifecycle]), [
    ["issue-1282-google-bespoke-copy-tests", "#1282", "batched-active"],
    ["issue-903-open-external-admin-tests", "#903", "batched-active"],
    ["issue-979-campaign-builder-correctness-tests", "#979", "batched-active"],
    ["issue-980-campaign-builder-clarity-tests", "#980", "batched-active"],
    ["issue-986-campaign-builder-platform-picker-tests", "#986", "batched-active"],
    ["issue-995-campaign-builder-creative-tests", "#995", "batched-active"],
    ["971-paystack-onboard-scroll-tests", "#971", "batched-active"],
    ["issue-1027-keyboard-and-datetime-tests", "#1027", "batched-active"],
    ["issue-1035-theme-sheet-hoist-tests", "#1035", "batched-active"],
    ["issue-1036-contrast-chip-removal-tests", "#1036", "batched-active"],
    ["issue-1348-icloud-video-patch-tests", "#1348", "batched-active"],
    ["issue-1532-tester-adversarial", "#1532", "batched-active"],
    ["issue-1881-business-signin-transient-failure-tests", "#1881", "batched-active"],
    ["issue-1996-business-desktop-sharing-tests", "#1996", "batched-active"],
    ["issue-948-w2-bank-route-web-tests", "#948", "batched-active"],
    ["issue-948-web-skip-download-tests", "#948", "batched-active"],
    ["issue-959-scanner-invite-error-parse-tests", "#959", "batched-active"],
    ["orch-1403-onboard-scroll-tests", "#1403", "batched-active"],
    ["orch-1404-invite-error-recovery-tests", "#1404", "batched-active"],
    ["production-readiness-audit", "#2148", "batched-active"],
    ["issue-2343-host-forced-light-appearance-tests", "#2343", "batched-active"],
    ["issue-2322-ios-picker-theming-tests", "#2322", "batched-active"],
    ["issue-2399-multiday-picker-ticket-box", "#2399", "batched-active"],
  ]);
  assert.equal(shadow.length, 32);
  assert.equal(new Set(shadow.map((suite) => suite.id)).size, 32);
  assert.ok(shadow.every((suite) => suite.lifecycle === "shadow-active"));
  const approvedShadowIds = manifest.legacyOrigins.filter((origin) => origin.disposition === "shadow-active").flatMap((origin) => origin.replacementSuites).sort();
  assert.deepEqual(shadow.map((suite) => suite.id).sort(), approvedShadowIds);
  assert.equal(baseline.some((suite) => approvedShadowIds.includes(suite.id)), false);
  assert.equal(manifest.legacyOrigins.length, 199);
  assert.equal(manifest.workflowProviders.length, 89);
  assert.equal(discoverLiveOrigins(DEFAULT_ROOT).length, 176);
  assert.equal(discoverWorkflowProviders(DEFAULT_ROOT).length, 89);
  assert.equal(new Set(manifest.legacyOrigins.map((item) => `${item.stem}.${item.extension}`)).size, 199);
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
