#!/usr/bin/env node
// #2435 implementor-owned happy-path regression. This is intentionally separate
// from the adversarial governance self-test so deleting either proof is visible.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_MANIFEST,
  DEFAULT_ROOT,
  decodeManifestTextRepresentations,
  discoverLiveOrigins,
  discoverWorkflowProviders,
  inspectWorkflows,
  SHADOW_PARITY_MARKER,
  SHADOW_PARITY_WRAPPER_NAMES,
  validateRegistry,
} from "../ci-batch/validate-manifest-v2.mjs";

const WAVE_IDS_SHA256 = "54b55bc2c9986869c057f7e1de53712601f98338c630ab439fe515318ad230c0";
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

function assertWaveStage(manifest, exists = (name) => fs.existsSync(path.join(DEFAULT_ROOT, ".github/workflows", name))) {
  // [TEST-MOD-APPROVED #2438] Phase 3A remains an explicit immutable wave after Phase 3B is appended.
  const wave = manifest.suites.filter((suite) => suite.migrationWave === "phase3a-node-wave");
  assert.equal(wave.length, 32);
  assert.equal(new Set(wave.map((suite) => suite.id)).size, 32);
  assert.equal(digest(wave.map((suite) => suite.id)), WAVE_IDS_SHA256, "exact wave identities drifted");
  const lifecycles = new Set(wave.map((suite) => suite.lifecycle));
  assert.equal(lifecycles.size, 1, "mixed wave lifecycle is forbidden");
  const lifecycle = [...lifecycles][0];
  assert.ok(["shadow-active", "batched-historical"].includes(lifecycle));
  const waveIds = new Set(wave.map((suite) => suite.id));
  const origins = manifest.legacyOrigins.filter((origin) =>
    (origin.replacementSuites || []).some((id) => waveIds.has(id)));
  assert.equal(origins.length, 31);
  for (const origin of origins) {
    const name = `${origin.stem}.${origin.extension}`;
    if (lifecycle === "shadow-active") {
      assert.equal(origin.disposition, "shadow-active");
      assert.equal(exists(name), true, `${name}: shadow wrapper missing`);
      assert.equal(fs.readFileSync(path.join(DEFAULT_ROOT, ".github/workflows", name), "utf8").split("\n").filter((line) => line === SHADOW_PARITY_MARKER).length, 1);
    } else {
      assert.equal(origin.disposition, "batched-historical");
      assert.equal(origin.providerWorkflow, ".github/workflows/ci-batch.yml");
      assert.equal(exists(name), false, `${name}: terminal wrapper restored`);
    }
  }
  if (lifecycle === "batched-historical") {
    const waveNames = new Set(SHADOW_PARITY_WRAPPER_NAMES);
    const providers = manifest.workflowProviders.filter((provider) => waveNames.has(provider.workflow));
    assert.equal(providers.length, 18);
    assert.ok(providers.every((provider) => provider.transition === "batched-provider"
      && provider.providerWorkflow === ".github/workflows/ci-batch.yml"));
  }
}

test("#2435 registry v2 proves the complete current topology", () => {
  const rawManifest = JSON.parse(fs.readFileSync(DEFAULT_MANIFEST, "utf8"));
  const errors = validateRegistry(rawManifest, { root: DEFAULT_ROOT });
  assert.deepEqual(errors, []);
  const manifest = decodeManifestTextRepresentations(rawManifest);
  assert.equal(manifest.schemaVersion, 2);
  const baseline = manifest.suites.slice(0, 23);
  const shadow = manifest.suites.filter((suite) => suite.migrationWave === "phase3a-node-wave");
  assert.equal(manifest.suites.length, 67);
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
  assertWaveStage(manifest);
  const approvedShadowIds = manifest.legacyOrigins.filter((origin) => origin.migrationWave === "phase3a-node-wave").flatMap((origin) => origin.replacementSuites).sort();
  assert.deepEqual(shadow.map((suite) => suite.id).sort(), approvedShadowIds);
  assert.equal(baseline.some((suite) => approvedShadowIds.includes(suite.id)), false);
  assert.equal(manifest.legacyOrigins.length, 200);
  assert.equal(manifest.workflowProviders.length, 91);
  assert.equal(discoverLiveOrigins(DEFAULT_ROOT).length, 146);
  assert.equal(discoverWorkflowProviders(DEFAULT_ROOT).length, 73);
  assert.equal(new Set(manifest.legacyOrigins.map((item) => `${item.stem}.${item.extension}`)).size, 200);
  assert.equal(new Set(manifest.workflowProviders.map((item) => item.workflow)).size, 91);
  const suite1036 = manifest.suites.find((suite) => suite.id === "issue-1036-contrast-chip-removal-tests");
  const suite1532 = manifest.suites.find((suite) => suite.id === "issue-1532-tester-adversarial");
  assert.ok(suite1036.expectedFiles.includes("mingla-business/src/components/theme/__tests__/issue1036NoContrastNode.web.render.test.tsx"));
  assert.ok(suite1532.expectedFiles.includes("mingla-business/src/components/stay/__tests__/stayGuardReachability.issue1532.tester.render.test.tsx"));

  const live = discoverLiveOrigins(DEFAULT_ROOT);
  const yamlTruth = inspectWorkflows(DEFAULT_ROOT, live);
  const registered = new Map(
    manifest.legacyOrigins
      .filter((item) => !["batched-active", "batched-historical"].includes(item.disposition))
      .map((item) => [`${item.stem}.${item.extension}`, item.workflowMetadata]),
  );
  const metadata = (stem) => registered.get(`${stem}.${"yml"}`);
  assert.equal([...registered].filter(([name, metadata]) => JSON.stringify(metadata) === JSON.stringify(yamlTruth[name])).length, 146);

  const mixed = structuredClone(manifest);
  mixed.suites[23].lifecycle = "shadow-active";
  assert.throws(() => assertWaveStage(mixed), /mixed wave lifecycle/);
  const missing = structuredClone(manifest);
  missing.suites.splice(23, 1);
  assert.throws(() => assertWaveStage(missing));
  const substituted = structuredClone(manifest);
  substituted.suites[23].id = "forged-wave-suite";
  assert.throws(() => assertWaveStage(substituted), /exact wave identities drifted/);
  assert.throws(() => assertWaveStage(manifest, (name) => name === SHADOW_PARITY_WRAPPER_NAMES[0]), /terminal wrapper restored/);

  // Real repository shapes that defeated the original line parser.
  assert.equal(metadata("issue-1773-reservation-stay-ingest-tests").pathScope.length, 10, "YAML path aliases must resolve");
  assert.ok(metadata("issue-1171-dark-payout-ledger-tests").setupActions.includes("./.github/actions/migrated-postgres"), "named-step uses keys must be inventoried");
  assert.ok(metadata("issue-1403-listing-insights-tests").setupActions.includes("actions/upload-artifact@v4"), "later mapping-key actions must be inventoried");
  assert.ok(metadata("issue-1995-contact-book-blast").runtimeVersions.includes("node:20"), "flow-style with maps must preserve runtime versions");
});
