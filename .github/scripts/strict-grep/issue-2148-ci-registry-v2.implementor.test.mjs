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
  PROVIDERS_ADDED_SINCE_SEAL,
  SUITES_ADDED_SINCE_SEAL,
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
  // [TEST-MOD-APPROVED #2897] Derived, not re-typed. `baseline` above is the
  // positional slice(0, 23) and is untouched; only the total moves, and it moves
  // from the one declared set the validator subtracts from its own floors.
  assert.equal(manifest.suites.length, 84 + SUITES_ADDED_SINCE_SEAL.length);
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
  assert.equal(manifest.legacyOrigins.length, 200 + SUITES_ADDED_SINCE_SEAL.length);
  // [TEST-MOD-APPROVED #2591] Re-pointed to its derivation, not weakened. The
  // literal 91 is now `91 + PROVIDERS_ADDED_SINCE_SEAL.length`, read from the one
  // declared set the validator subtracts from the frozen provider seal. Two
  // hand-typed numbers that must agree is how a 607 once landed where two sides
  // had said 606 and 603 — auto-merged clean, no conflict marker. Deriving both
  // from one set makes that disagreement unrepresentable.
  assert.equal(manifest.workflowProviders.length, 91 + PROVIDERS_ADDED_SINCE_SEAL.length);
  // [TEST-MOD-APPROVED #2438 · SC-15/SC-21] The cutover deletes exactly the twelve
  // Phase 3B wrappers, so live-origin discovery and provider discovery each fall by
  // exactly that wave's own size. Neither figure is re-chosen: the A9-SC1 146 and the
  // A8-SC1 73 stay pinned, and the subtrahend is READ from the registry rather than
  // typed, so a wave that grows or shrinks moves this assertion instead of silently
  // agreeing with it.
  const phase3bWrappers = manifest.legacyOrigins.filter((origin) => origin.migrationWave === "phase3b-postgres-wave");
  const phase3bProviders = manifest.workflowProviders.filter((item) =>
    phase3bWrappers.some((origin) => `${origin.stem}.${origin.extension}` === item.workflow));
  // [TEST-MOD-APPROVED #2439 · SC-17.1] Phase 3C deletes SEVENTEEN more wrappers
  // carrying SEVEN more provider records, so the subtrahend is no longer one
  // wave. It is now every wave whose own header declares it terminal AFTER the
  // Phase 3A baseline the 146 was measured at — read from the registry, never
  // typed, so Phase 3D moves this assertion instead of silently agreeing with
  // it. Each wave's own contribution is still pinned separately below, so a wave
  // that quietly changed size cannot hide inside the combined subtraction.
  const terminalWavesAfter3a = Object.entries(manifest.migrationWaves)
    .filter(([wave, contract]) => contract.lifecycle === "batched-historical" && wave !== "phase3a-node-wave")
    .map(([wave]) => wave);
  assert.deepEqual([...terminalWavesAfter3a].sort(), ["phase3b-postgres-wave", "phase3c-deno-wave"]);
  const deletedWrappers = manifest.legacyOrigins.filter((origin) => terminalWavesAfter3a.includes(origin.migrationWave));
  const deletedProviders = manifest.workflowProviders.filter((item) =>
    deletedWrappers.some((origin) => `${origin.stem}.${origin.extension}` === item.workflow));
  const phase3cWrappers = manifest.legacyOrigins.filter((origin) => origin.migrationWave === "phase3c-deno-wave");
  // [TEST-MOD-APPROVED #2591 · :137 :164] A SECOND way to leave these inventories,
  // and it is not a wave. The nine migration-gated Postgres lanes were folded into
  // the consolidated contract-suites capability workflow at #2591 — deliberately
  // NOT named here in full, because discovery derives a provider record from any
  // source file that spells a workflow's filename, and a test that named it would
  // register ITSELF as that workflow's provider and break the seal it checks.
  // Their wrappers are deleted, so they leave the live-origin and metadata
  // inventories exactly as a batched wave's wrappers do,
  // but they carry no migrationWave and `deletedWrappers` above does NOT move for
  // them — MEASURED, it is still 29. Deriving one from the other would be wrong in
  // both directions, so both are read from the registry independently.
  const consolidatedOrigins = manifest.legacyOrigins.filter((origin) => origin.disposition === "consolidated-provider");
  const consolidatedProviders = manifest.workflowProviders.filter((item) => item.transition === "consolidated-provider");
  assert.equal(consolidatedOrigins.length, 9);
  assert.equal(consolidatedProviders.length, 2);
  assert.equal(consolidatedOrigins.filter((origin) => fs.existsSync(path.join(DEFAULT_ROOT, `.github/workflows/${origin.stem}.${origin.extension}`))).length, 0);
  assert.equal(phase3bWrappers.length, 12);
  assert.equal(phase3bProviders.length, 6);
  assert.equal(phase3cWrappers.length, 17);
  assert.equal(deletedWrappers.length, 29);
  assert.equal(deletedProviders.length, 13);
  assert.equal(deletedWrappers.filter((origin) => fs.existsSync(path.join(DEFAULT_ROOT, `.github/workflows/${origin.stem}.${origin.extension}`))).length, 0);
  // [TEST-MOD-APPROVED #2591 · :137] The ratified 146 still stays pinned and both
  // subtrahends are still read from the registry, never typed. MEASURED on the
  // merged tree: 146 - 29 - 9 = 108.
  assert.equal(discoverLiveOrigins(DEFAULT_ROOT).length, 146 - deletedWrappers.length - consolidatedOrigins.length);
  // [TEST-MOD-APPROVED #2591] Same derivation. Raw discovery now also carries the
  // declared additions; the SEAL subtracts them, this count does not. It no longer
  // carries the two records the consolidated wrappers contributed: discovery reads
  // workflow names from the live directory, so those records died with the files
  // even though the source text still names them. MEASURED: 73 - 13 - 2 + 1 = 59.
  assert.equal(
    discoverWorkflowProviders(DEFAULT_ROOT).length,
    73 - deletedProviders.length - consolidatedProviders.length + PROVIDERS_ADDED_SINCE_SEAL.length,
  );
  assert.equal(new Set(manifest.legacyOrigins.map((item) => `${item.stem}.${item.extension}`)).size, 200 + SUITES_ADDED_SINCE_SEAL.length);
  assert.equal(new Set(manifest.workflowProviders.map((item) => item.workflow)).size, 91 + PROVIDERS_ADDED_SINCE_SEAL.length);
  const suite1036 = manifest.suites.find((suite) => suite.id === "issue-1036-contrast-chip-removal-tests");
  const suite1532 = manifest.suites.find((suite) => suite.id === "issue-1532-tester-adversarial");
  assert.ok(suite1036.expectedFiles.includes("mingla-business/src/components/theme/__tests__/issue1036NoContrastNode.web.render.test.tsx"));
  assert.ok(suite1532.expectedFiles.includes("mingla-business/src/components/stay/__tests__/stayGuardReachability.issue1532.tester.render.test.tsx"));

  const live = discoverLiveOrigins(DEFAULT_ROOT);
  const yamlTruth = inspectWorkflows(DEFAULT_ROOT, live);
  const registered = new Map(
    manifest.legacyOrigins
      // [TEST-MOD-APPROVED #2591 · :177] `consolidated-provider` joins the excluded
      // dispositions for the same reason batched-historical is excluded: the entry
      // no longer describes a live wrapper, so it carries no workflowMetadata. Left
      // in, it would have MATCHED — `JSON.stringify(undefined) === JSON.stringify(
      // undefined)` is true, so all nine would have counted as agreeing with a
      // yamlTruth entry that does not exist, and the assertion would have read 117
      // while proving nothing about them. That is the check-carries-no-information
      // shape (#2438); excluding them keeps the comparison meaningful.
      .filter((item) => !["batched-active", "batched-historical", "consolidated-provider"].includes(item.disposition))
      .map((item) => [`${item.stem}.${item.extension}`, item.workflowMetadata]),
  );
  const metadata = (stem) => registered.get(`${stem}.${"yml"}`);
  // [TEST-MOD-APPROVED #2438 · SC-15/SC-21] Same subtraction, same reason: the twelve
  // Phase 3B origins are batched-historical now, so they leave this non-batched
  // inventory with their wrappers. The ratified 146 stays pinned; the wave's own
  // size is read from the registry, never typed.
  // [TEST-MOD-APPROVED #2439 · SC-17.1] Extended to every post-3A terminal wave
  // for the same reason: Phase 3C's seventeen origins are batched-historical now
  // and leave this non-batched inventory with their wrappers. The ratified 146
  // stays pinned; the subtrahend is still read from the registry, never typed.
  // [TEST-MOD-APPROVED #2591 · :164] Same subtraction, same reason: a consolidated
  // origin has no yamlTruth[name] either, because its wrapper is gone.
  assert.equal([...registered].filter(([name, metadata]) => JSON.stringify(metadata) === JSON.stringify(yamlTruth[name])).length, 146 - deletedWrappers.length - consolidatedOrigins.length);

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
  // [TEST-MOD-APPROVED #2591 · :179] Re-pointed, not weakened. #1171's wrapper is
  // deleted by this change, so the old subject no longer describes a live file.
  // issue-1403-listing-insights-tests keeps its Postgres job — it was the one lane
  // of the ten deliberately left alone — and genuinely still uses the action, so
  // the assertion's actual subject, that a named-step `uses:` key is inventoried,
  // keeps a live subject rather than being retired with the file.
  assert.ok(metadata("issue-1403-listing-insights-tests").setupActions.includes("./.github/actions/migrated-postgres"), "named-step uses keys must be inventoried");
  assert.ok(metadata("issue-1403-listing-insights-tests").setupActions.includes("actions/upload-artifact@v4"), "later mapping-key actions must be inventoried");
  assert.ok(metadata("issue-1995-contact-book-blast").runtimeVersions.includes("node:20"), "flow-style with maps must preserve runtime versions");
});
