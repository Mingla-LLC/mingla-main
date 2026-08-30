#!/usr/bin/env node
// #2435 / #2148 Phase 1. Fail-closed validator for the deterministic CI registry.
// The registry is deliberately static. Discovery is used only to prove that the
// committed inventory is complete; it is never used to decide what CI executes.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, "../../..");
export const DEFAULT_MANIFEST = path.join(DEFAULT_ROOT, ".github/ci-batch/MANIFEST.json");
const LIVE_ORIGIN = /^(?:issue-|orch-|meta-).*\.ya?ml$/;
const ALLOWED_DISPOSITIONS = new Set([
  "batched-active",
  "shadow-active",
  "batched-historical",
  "full-suite-superset",
  "build-assertion-consumer",
  "database-special",
  "operational-excluded",
  "approved-retired",
  // [#2591] A live origin whose lane was folded into a shared capability
  // workflow. Distinct from batched-historical, which hardcodes ci-batch.yml as
  // the provider, and from every other value, which requires the origin file to
  // still exist. Here the origin file is GONE and the provider is a named
  // workflow that is not the origin's own. Nothing else in the set can say that
  // without lying about one of the two.
  "consolidated-provider",
]);
// [#2591] The nine migration-gated Postgres lanes folded into
// postgres-contract-suites.yml. Their workflow files are deleted; their
// legacyOrigins entries stay (legacyOrigins.length is pinned at 200 and entries
// are re-dispositioned, never removed).
const CONSOLIDATED_ORIGIN_PROVIDER = ".github/workflows/postgres-contract-suites.yml";
const LOCKED_ASSERTION_CAPABILITY_SHA256 = "bb9c0e598a08ab91d8714ec2db80100c8b4d966d980a3cc290c3bcad93990a3f";
const LOCKED_SHADOW_CAPABILITY_SHA256 = "7af6028109ff91e1c996a8231e932d5deb26b714d2c22b2264b17fb072593091";
const LOCKED_SHADOW_CONTRACT_SHA256 = "b54121cb297f466d1d4d0ed4fae467e5c895804898018b752aa8e191159e673c";
const LOCKED_PHASE3B_CONTRACT_SHA256 = "8b3a94d67e1e32b7cb5580bbab84db525ad196769608d42cc0607652a3c6cad9";
const LOCKED_PHASE3C_CONTRACT_SHA256 = "caaed7cab03f977c040a68e884b2c2dfb4316f832756de8e10943179d2e5abe5";
const LOCKED_SETUP_PROFILES_SHA256 = "982809d5c0f79590410647543013b8bd71d40b1ae47d1ae4728761e1659adc47";
const PINNED_CHECKOUT = "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683";
const PINNED_SETUP_NODE = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020";
const PINNED_UPLOAD_ARTIFACT = "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02";
const PHASE3_WAVE_LIFECYCLES = new Set(["shadow-active", "batched-historical"]);
const PHASE3A_WAVE = "phase3a-node-wave";
const PHASE3B_WAVE = "phase3b-postgres-wave";
// [#2438 SC-13] The two reviewed Phase 3B lifecycles. The wave is atomic in one
// of them; there is no third form and a mixed wave is red.
const PHASE3B_SHADOW_LIFECYCLE = "shadow-active";
const PHASE3B_TERMINAL_LIFECYCLE = "batched-historical";
const PHASE3B_ATOMIC_LIFECYCLES = new Set([PHASE3B_SHADOW_LIFECYCLE, PHASE3B_TERMINAL_LIFECYCLE]);
const PHASE3C_WAVE = "phase3c-deno-wave";
// [#2439 SC-11.1] Phase 3C is one atomic wave in exactly one of the two reviewed
// lifecycles. A mixed wave (16 terminal + 1 shadow) is red by construction.
const PHASE3C_ATOMIC_LIFECYCLES = new Set([PHASE3B_SHADOW_LIFECYCLE, PHASE3B_TERMINAL_LIFECYCLE]);
const PHASE3C_SUITE_COUNT = 17;

/**
 * [#2439] THE lane derivation. Read this before adding another wave.
 *
 * A suite runs in the PRIMARY lane of its matrix job unless it has been migrated
 * into a reviewed secondary/tertiary execution class hosted inside that job. The
 * registry already records exactly that, and records it for no other reason:
 * `executionClass` is present on a migrated suite and ABSENT on a primary one.
 * Measured on this tree — Phase 1: 23 suites, 0 with executionClass; Phase 3A:
 * 32 suites, 0; Phase 3B: 12 suites, all 12; Phase 3C: 17 suites, all 17.
 *
 * Every lane decision in this repository must go through these two predicates.
 * Identifying a lane by WAVE NAME has now broken three times as soon as a second
 * wave appeared — the runner's leaf branch (SPEC item 11), two #2438 mutants that
 * selected positionally, and the reconciler's primary vector, which is what took
 * six batch hosts red on PR #2546. Adding `phase3cIds` beside `phase3bIds` would
 * have been the fourth. A name-free predicate cannot be broken by Phase 3D.
 *
 * @param {object} suite a registry suite record
 * @returns {boolean} true when the suite belongs to a migrated wave's own lane
 */
export function isMigratedSuite(suite) {
  return typeof suite?.executionClass === "string" && suite.executionClass.length > 0;
}

/** @returns {boolean} true when the suite is executed by the primary batch lane. */
export function isPrimarySuite(suite) {
  return !isMigratedSuite(suite);
}

/**
 * [PR #2546] THE canonical suite command fingerprint. There used to be two
 * implementations of this — one in run-suite-batch.mjs keyed on the leaf lane and
 * one in select-phase3b-suites.mjs keyed on the literal Phase 3B wave name — and
 * for a Phase 3C suite they produced DIFFERENT digests. The runner writes the
 * fingerprint and the reconciler checks it, so a divergence here is a
 * `primary-identity-mismatch` waiting for the next wave. One definition, imported
 * by both, makes the divergence unrepresentable.
 *
 * A migrated suite's fingerprint covers its env, its leaves and its bounded retry,
 * because all three are executable semantics the runner honours.
 */
export function suiteCommandFingerprint(suite) {
  const rows = isMigratedSuite(suite)
    ? suite.steps.map((step) => ({ commandId: step.commandId, cwd: step.cwd, invocation: step.invocation,
      env: step.env || null, children: step.children || null, ...(step.retry ? { retry: step.retry } : {}) }))
    : suite.steps.map((step) => ({ commandId: step.commandId, cwd: step.cwd, invocation: step.invocation }));
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

const PHASE3C_OUTER_COUNT = 46;
const PHASE3C_LEAF_COUNT = 54;
const PHASE3C_INSTALL_COUNT = 3;
const PHASE3C_FILE_EXISTS_PREDICATES = 11;
// [#2439 SC-6.1] The exact authorised literal environment maps, byte for byte,
// on exactly the two #1326 steps that carry them. This is an allowlist that
// cannot be extended at runtime: it is a frozen module constant, and SC-6.3's
// guard proves a mutation attempt does not take effect.
const PHASE3C_AUTHORISED_ENV = Object.freeze([
  Object.freeze({
    SUPABASE_URL: "https://example-test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-not-real",
  }),
  Object.freeze({
    SUPABASE_URL: "https://example-test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-not-real",
    PAYSTACK_MODE: "test",
    PAYSTACK_SECRET_KEY_TEST: "sk_test_issue1326_confirm_secret",
  }),
]);
const LOCKED_PROVIDER_DISCOVERY_SHA256 = "c0813be9c105418cd60697b22be5ae5dbc2055b03895c2e5c77f68606a498a7f";
const LOCKED_PHASE3B_PROVIDER_DISCOVERY_SHA256 = "1676cbe80860ee0181cf95fcbd70dcb95a9d535066161e25f11348212264abc1";
// [#2591] Providers that have legitimately appeared SINCE the seal, each
// declared by name and by exact content and each reviewed on its own issue.
//
// LOCKED_PROVIDER_DISCOVERY_SHA256 is NOT re-frozen and the reconstructed length
// stays 73. Nothing is added to the sealed world; what has been added since it is
// declared here and SUBTRACTED before the digest is taken. Three properties fall
// out of that, and all three are the reason this is stronger than moving the
// literal would have been:
//
//   * an UNDECLARED new provider still breaks the seal — that tripwire is the
//     whole point and it stays armed;
//   * a declared addition whose referenceFiles drift still breaks it, because the
//     subtraction is by exact content, never by name;
//   * the blind-memo detection this file forbids by name at the trackedFiles
//     scope survives intact: a memo that keeps reporting the pre-#2591 discovery
//     means the declared addition is ABSENT, the presence assertion fails, and
//     this goes RED naming it. Re-freezing the literal is precisely what would
//     have destroyed that.
//
// Every count that moves because of an addition is DERIVED from this one set. A
// second hand-typed number is how a value of 607 once landed where two sides had
// independently said 606 and 603, auto-merged clean with no conflict marker.
export const PROVIDERS_ADDED_SINCE_SEAL = Object.freeze([
  Object.freeze({
    issue: 2591,
    workflow: "postgres-contract-suites.yml",
    // Discovery derives a provider record from the source files that name a
    // workflow. These are the workflow-content tests the #2591 tester re-pointed
    // at the consolidated lane under [TEST-MOD-APPROVED #2591].
    //
    // A fourth file was here at shadow: `.github/scripts/parity/parse-origin-log.mjs`,
    // which read the consolidated workflow to recover the command-id join key
    // (U-5). It derived its expectations from the nine origin workflows' YAML, so
    // the cutover removed its subject; it is retired in the same commit rather
    // than left to report `no such workflow` for every lane forever. The
    // subtraction is by exact content, so dropping the file here is not optional
    // bookkeeping — leaving it listed fails this closed.
    //
    // [#2594] A FOURTH file joins, and it lands at index 0 because discovery
    // sorts plain lexicographically. issue-1397-fx-refresh-eol-cron.mjs asserted
    // that the #1397 migration and its SQL suite are wired into the class-A
    // workflow; #2594 moved both into this lane, so the gate now names BOTH
    // workflows — it keeps the class-A filename (dropping it would remove the
    // file from that workflow's frozen record and red the seal) and adds this
    // one. Naming this workflow is exactly what makes it a reference file here.
    // The subtraction is by exact content, so this list and MANIFEST.json's
    // workflowProviders entry move together or both fail closed.
    //
    // This adds a referenceFile to an EXISTING record. The provider count stays
    // 91 + 1 = 92; no provider is added.
    referenceFiles: Object.freeze([
      ".github/scripts/strict-grep/issue-1397-fx-refresh-eol-cron.mjs",
      "supabase/functions/payout-release-sweep/__tests__/issue_1172_stripe_payout_rework.test.ts",
      "supabase/functions/payout-release-sweep/__tests__/issue_1840_ng_float_alerts.test.ts",
      "supabase/functions/payout-release-sweep/__tests__/issue_1840_ng_float_alerts_adversarial.test.ts",
    ]),
  }),
]);
// [#2774] Reviewed reference-file additions to providers that ALREADY belong to
// the frozen 73-provider authority. Unlike PROVIDERS_ADDED_SINCE_SEAL, these
// declarations remove only the named new references while reconstructing the
// historical record; live discovery and MANIFEST.json retain the full record.
export const PROVIDER_REFERENCE_FILES_ADDED_SINCE_SEAL = Object.freeze([
  Object.freeze({
    issue: 2774,
    workflow: "issue-1486-dormant-render-suites.yml",
    referenceFiles: Object.freeze([
      ".github/scripts/strict-grep/issue-2774-public-hero-accessibility.mjs",
    ]),
  }),
]);
const PROVIDER_REFERENCE_FILES_ADDED_SINCE_SEAL_NAMES = new Set(
  PROVIDER_REFERENCE_FILES_ADDED_SINCE_SEAL.map((item) => item.workflow),
);

export function normalizeProviderReferenceFilesForSeal(
  discovered,
  declarations = PROVIDER_REFERENCE_FILES_ADDED_SINCE_SEAL,
) {
  if (!Array.isArray(discovered) || !Array.isArray(declarations)) {
    throw new TypeError("provider reference seal normalization requires arrays");
  }
  const byWorkflow = new Map();
  for (const [index, item] of discovered.entries()) {
    const indices = byWorkflow.get(item?.workflow) || [];
    indices.push(index);
    byWorkflow.set(item?.workflow, indices);
  }
  const declaredWorkflows = new Set();
  const normalized = discovered.map((item) => ({
    ...item,
    referenceFiles: [...(item.referenceFiles || [])],
  }));
  for (const declaration of declarations) {
    if (!declaration || !Number.isInteger(declaration.issue)
      || typeof declaration.workflow !== "string" || declaration.workflow.length === 0
      || !Array.isArray(declaration.referenceFiles) || declaration.referenceFiles.length === 0) {
      throw new Error("provider reference delta declaration is malformed");
    }
    if (declaredWorkflows.has(declaration.workflow)) {
      throw new Error(`duplicate provider reference delta declaration: ${declaration.workflow}`);
    }
    declaredWorkflows.add(declaration.workflow);
    const additions = new Set(declaration.referenceFiles);
    if (additions.size !== declaration.referenceFiles.length
      || declaration.referenceFiles.some((item) => typeof item !== "string" || item.length === 0)) {
      throw new Error(`duplicate or empty provider reference delta: ${declaration.workflow}`);
    }
    const indices = byWorkflow.get(declaration.workflow) || [];
    if (indices.length !== 1) {
      throw new Error(`provider reference delta workflow must appear exactly once: ${declaration.workflow}`);
    }
    const record = normalized[indices[0]];
    const current = record.referenceFiles;
    if (new Set(current).size !== current.length) {
      throw new Error(`provider reference inventory contains duplicates: ${declaration.workflow}`);
    }
    for (const referenceFile of additions) {
      if (!current.includes(referenceFile)) {
        throw new Error(`provider reference delta is missing: ${declaration.workflow} -> ${referenceFile}`);
      }
    }
    const historical = current.filter((referenceFile) => !additions.has(referenceFile));
    if (historical.length === 0) {
      throw new Error(`provider reference delta would empty historical record: ${declaration.workflow}`);
    }
    record.referenceFiles = historical;
  }
  return normalized;
}
const PROVIDERS_ADDED_SINCE_SEAL_NAMES = new Set(
  PROVIDERS_ADDED_SINCE_SEAL.map((item) => item.workflow),
);
const PHASE3B_PROVIDER_NAMES = new Set([
  "issue-1022-theme-control-tests.yml",
  "issue-1902-public-event-lifecycle-tests.yml",
  "issue-2013-ari-tenant-containment.yml",
  "issue-885-scanner-invite-loader-tests.yml",
  "issue-948-w1-enablers-tests.yml",
  "orch-0976-draft-promotion-tests.yml",
]);
const CI_BATCH_EVIDENCE_PREFIX = ".github/scripts/ci-batch/__tests__/fixtures/";
const WAVE_SHADOW_TESTER_ROLE = /^\.github\/scripts\/strict-grep\/issue-[1-9][0-9]*-ci-[a-z0-9]+(?:-[a-z0-9]+)*-wave-shadow\.tester\.test\.mjs$/;
export const SHADOW_PARITY_MARKER = "# #2437 SHADOW-PARITY-TRIGGER — remove before cutover";
const SHADOW_PARITY_TOKEN = "#2437 SHADOW-PARITY-TRIGGER";
const SHADOW_PARITY_WRAPPER_STEMS = Object.freeze([
  "issue-1009-campaign-builder-retry-tests",
  "issue-1322-admin-sentry-tests",
  "issue-1481-explorer-deck-tests",
  "issue-1509-boot-budget-tests",
  "issue-1516-coach-mark-tests",
  "issue-1576-deck-promoted-card",
  "issue-1579-deck-tap-expand",
  "issue-1593-deck-layer-geometry",
  "issue-1605-expanded-card",
  "issue-1609-card-identity",
  "issue-1615-public-share-surfaces",
  "issue-1636-likes-load-tests",
  "issue-1638-tab-switch-quickwins-tests",
  "issue-1638-tab-switch-scheduling-tests",
  "issue-1639-profile-cards-tests",
  "issue-1642-been-here-offline-bound",
  "issue-1661-completed-write-unparks-invalidation",
  "issue-1687-been-here-rating-prompt",
  "issue-1860-rls-coverage-tests",
  "issue-1880-expanded-share-handoff",
  "issue-1960-share-art-isolation",
  "issue-1962-unlisted-share-previews",
  "issue-1968-public-web-canonical-sharing",
  "issue-2004-share-click-canonical-destination",
  "issue-2058-bundle-baseline-handoff-tests",
  "issue-2084-credential-output-safety",
  "issue-2207-manifest-merge-awareness",
  "issue-2300-orch-artifact-reap",
  "issue-2393-tester-assertion-credential",
  "issue-994-ota-env-resolution",
  "orch-1386-tester-adversarial",
]);
export const SHADOW_PARITY_WRAPPER_NAMES = Object.freeze(SHADOW_PARITY_WRAPPER_STEMS.map((stem) => `${stem}.yml`));
const SHADOW_PARITY_WRAPPER_SET = new Set(SHADOW_PARITY_WRAPPER_NAMES);
export const PHASE3B_SHADOW_MARKER = "# #2438 SHADOW-PARITY-TRIGGER — remove before cutover";
const PHASE3B_SHADOW_TOKEN = "#2438 SHADOW-PARITY-TRIGGER";
export const PHASE3B_WRAPPER_NAMES = Object.freeze([
  "issue-1022-theme-control-tests.yml", "issue-1461-venue-current-brand-race-tests.yml",
  "issue-1467-venue-submit-idempotency-tests.yml", "issue-1485-web-missing-chunk-404-tests.yml",
  "issue-1685-venue-draft-multi-tests.yml", "issue-1902-public-event-lifecycle-tests.yml",
  "issue-2013-ari-tenant-containment.yml", "issue-679-brand-follow-tests.yml",
  "issue-885-scanner-invite-loader-tests.yml", "issue-948-w1-enablers-tests.yml",
  "issue-948-w3-screens-copy-tests.yml", "orch-0976-draft-promotion-tests.yml",
]);
const PHASE3B_WRAPPER_SET = new Set(PHASE3B_WRAPPER_NAMES);
export const PHASE3C_SHADOW_MARKER = "# #2439 SHADOW-PARITY-TRIGGER — remove before cutover";
const PHASE3C_SHADOW_TOKEN = "#2439 SHADOW-PARITY-TRIGGER";
// [#2439 SC-1] The exact seventeen Deno wrapper identities. No pattern-expanded
// neighbour is admissible: membership is this literal list and nothing else.
export const PHASE3C_WRAPPER_NAMES = Object.freeze([
  "issue-1170-stripe-money-path-tests.yml", "issue-1176-paystack-recipient-tests.yml",
  "issue-1178-ng-split-removal-tests.yml", "issue-1237-parse-falsy-amount-tests.yml",
  "issue-1326-ng-reservation-finalize-tests.yml", "issue-1427-admin-stay-support-tests.yml",
  "issue-1430-refund-replay-tests.yml", "issue-1437-secret-bundle-compatibility-tests.yml",
  "issue-1465-permitted-staff-authoring-pipeline-tests.yml", "issue-1637-discover-single-fetch-tests.yml",
  "issue-1950-app-readiness-tests.yml", "issue-1999-ari-provider-schema-tests.yml",
  "issue-2019-ari-delegated-auth.yml", "issue-2230-consumer-multiday-tests.yml",
  "issue-2245-declared-app-links-resolve.yml", "issue-2321-account-deletion-tests.yml",
  "orch-1371-1372-tester-adversarial.yml",
]);
const PHASE3C_WRAPPER_SET = new Set(PHASE3C_WRAPPER_NAMES);
// [#2439 SC-11.5] The seven Phase 3C records that hold a provider record and
// transition retained-live-provider -> batched-provider at cutover. The other
// ten hold none and must not gain one.
const PHASE3C_PROVIDER_NAMES = new Set([
  "issue-1430-refund-replay-tests.yml",
  "issue-1437-secret-bundle-compatibility-tests.yml",
  "issue-1950-app-readiness-tests.yml",
  "issue-1999-ari-provider-schema-tests.yml",
  "issue-2019-ari-delegated-auth.yml",
  "issue-2230-consumer-multiday-tests.yml",
  "issue-2321-account-deletion-tests.yml",
]);
const REVIEWED_TEXT_ENCODING = "concat-v1";
const STALE_CONFIG_ROOT = ["app.config", "ts"].join(".");
const REVIEWED_SPLIT_PATHS = Object.freeze([
  `app-mobile/${STALE_CONFIG_ROOT}`,
  `mingla-business/${STALE_CONFIG_ROOT}`,
]);

function fail(errors, message) {
  errors.push(message);
}

function strings(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function reviewedText(parts) {
  return { encoding: REVIEWED_TEXT_ENCODING, parts };
}

function decodeReviewedText(value) {
  if (typeof value === "string") return value;
  if (value?.encoding === REVIEWED_TEXT_ENCODING && strings(value.parts)) return value.parts.join("");
  return value;
}

export function decodeManifestTextRepresentations(rawManifest) {
  const manifest = structuredClone(rawManifest);
  for (const suite of manifest.suites || []) {
    if (["issue-994-ota-env-resolution-app-mobile", "issue-994-ota-env-resolution-mingla-business"].includes(suite.id)) {
      suite.originPaths = (suite.originPaths || []).map(decodeReviewedText);
    }
  }
  const origin = (manifest.legacyOrigins || []).find((item) => item.stem === "issue-994-ota-env-resolution" && item.extension === "yml");
  if (origin?.workflowMetadata?.pathScope) origin.workflowMetadata.pathScope = origin.workflowMetadata.pathScope.map(decodeReviewedText);
  return manifest;
}

export function validateManifestTextRepresentations(rawManifest) {
  const errors = [];
  const expected = new Set(REVIEWED_SPLIT_PATHS);
  const encoded = (value) => value?.encoding === REVIEWED_TEXT_ENCODING && strings(value.parts) ? value.parts.join("") : null;
  const expectedEncoding = (value) => reviewedText([value.slice(0, -3), ".ts"]);
  const locations = [];
  for (const suite of rawManifest.suites || []) {
    for (const [index, value] of (suite.originPaths || []).entries()) {
      if (value && typeof value === "object") locations.push({ location: `suite:${suite.id}:originPaths:${index}`, value });
    }
  }
  for (const origin of rawManifest.legacyOrigins || []) {
    for (const [index, value] of (origin.workflowMetadata?.pathScope || []).entries()) {
      if (value && typeof value === "object") locations.push({ location: `origin:${origin.stem}.${origin.extension}:pathScope:${index}`, value });
    }
  }
  if (locations.length !== 6) fail(errors, `registry must contain exactly six reviewed split-text path representations, got ${locations.length}`);
  for (const { location, value } of locations) {
    const decoded = encoded(value);
    if (!expected.has(decoded) || JSON.stringify(value) !== JSON.stringify(expectedEncoding(decoded))) {
      fail(errors, `${location}: malformed or unreviewed split-text representation`);
    }
    const allowedSuite = /^suite:issue-994-ota-env-resolution-(?:app-mobile|mingla-business):originPaths:/.test(location);
    const allowedOrigin = /^origin:issue-994-ota-env-resolution\.yml:pathScope:/.test(location);
    if (!allowedSuite && !allowedOrigin) fail(errors, `${location}: split-text representation is outside the exact #994 provenance fields`);
  }
  const decoded = decodeManifestTextRepresentations(rawManifest);
  for (const suiteId of ["issue-994-ota-env-resolution-app-mobile", "issue-994-ota-env-resolution-mingla-business"]) {
    const paths = decoded.suites?.find((suite) => suite.id === suiteId)?.originPaths || [];
    for (const required of expected) if (!paths.includes(required)) fail(errors, `${suiteId}: decoded #994 originPaths lost reviewed provenance`);
  }
  const originPaths = decoded.legacyOrigins?.find((item) => item.stem === "issue-994-ota-env-resolution" && item.extension === "yml")?.workflowMetadata?.pathScope || [];
  for (const required of expected) if (!originPaths.includes(required)) fail(errors, `issue-994 workflow metadata lost decoded path provenance`);
  return errors;
}

export function canonicalizeShadowWrapperSource(workflowName, source) {
  const marker = SHADOW_PARITY_WRAPPER_SET.has(workflowName) ? SHADOW_PARITY_MARKER
    : PHASE3B_WRAPPER_SET.has(workflowName) ? PHASE3B_SHADOW_MARKER
      : PHASE3C_WRAPPER_SET.has(workflowName) ? PHASE3C_SHADOW_MARKER : null;
  if (!marker) return source;
  const lines = source.split("\n");
  const index = lines.indexOf(marker);
  if (index !== -1) lines.splice(index, 1);
  return lines.join("\n");
}

export function validateShadowParityMarkers(manifest, workflowSources) {
  const errors = [];
  const shadowNames = new Set((manifest.legacyOrigins || [])
    .filter((origin) => origin.disposition === "shadow-active" && origin.migrationWave === PHASE3A_WAVE)
    .map((origin) => `${origin.stem}.${origin.extension}`));

  for (const name of shadowNames) {
    if (!SHADOW_PARITY_WRAPPER_SET.has(name)) fail(errors, `${name}: shadow parity marker path is outside the exact #2437 allowlist`);
  }
  for (const name of SHADOW_PARITY_WRAPPER_NAMES) {
    const source = workflowSources[name];
    const lifecycle = (manifest.legacyOrigins || []).find((origin) => `${origin.stem}.${origin.extension}` === name)?.disposition;
    if (!shadowNames.has(name)) {
      if (source?.includes(SHADOW_PARITY_TOKEN)) fail(errors, `${name}: shadow parity marker is forbidden outside shadow-active lifecycle`);
      if (lifecycle === "batched-historical" && typeof source === "string") fail(errors, `${name}: terminal wrapper must be absent`);
      continue;
    }
    if (typeof source !== "string") {
      fail(errors, `${name}: shadow-active wrapper and exact parity marker are required`);
      continue;
    }
    const exactLines = source.split("\n").filter((line) => line === SHADOW_PARITY_MARKER).length;
    const tokenCount = source.split(SHADOW_PARITY_TOKEN).length - 1;
    if (exactLines !== 1 || tokenCount !== 1) {
      fail(errors, `${name}: requires exactly one exact #2437 shadow parity marker line`);
    }
  }
  for (const [name, source] of Object.entries(workflowSources)) {
    if (!SHADOW_PARITY_WRAPPER_SET.has(name) && source.includes(SHADOW_PARITY_TOKEN)) {
      fail(errors, `${name}: stray #2437 shadow parity marker on an unapproved workflow`);
    }
  }
  return errors;
}

export function validatePhase3bMarkers(manifest, workflowSources) {
  const errors = [];
  const records = (manifest.legacyOrigins || []).filter((origin) => origin.migrationWave === PHASE3B_WAVE);
  const names = records.map((origin) => `${origin.stem}.${origin.extension}`);
  if (names.length !== 12 || new Set(names).size !== 12 || names.some((name) => !PHASE3B_WRAPPER_SET.has(name))) {
    fail(errors, "Phase 3B must own the exact 12 reviewed wrapper identities");
  }
  const lifecycles = new Set(records.map((origin) => origin.disposition));
  if (lifecycles.size !== 1 || !["shadow-active", "batched-historical"].includes([...lifecycles][0])) fail(errors, "Phase 3B lifecycle must be atomic");
  for (const name of PHASE3B_WRAPPER_NAMES) {
    const source = workflowSources[name]; const shadow = lifecycles.has("shadow-active");
    if (shadow && typeof source !== "string") { fail(errors, `${name}: shadow wrapper missing`); continue; }
    if (!shadow && typeof source === "string") { fail(errors, `${name}: terminal wrapper must be absent`); continue; }
    if (!shadow) continue;
    const exact = source.split("\n").filter((line) => line === PHASE3B_SHADOW_MARKER).length;
    const tokens = source.split(PHASE3B_SHADOW_TOKEN).length - 1;
    if (exact !== 1 || tokens !== 1 || !source.startsWith(`${PHASE3B_SHADOW_MARKER}\n`)) fail(errors, `${name}: requires one exact top-level #2438 marker`);
  }
  for (const [name, source] of Object.entries(workflowSources)) if (!PHASE3B_WRAPPER_SET.has(name) && source.includes(PHASE3B_SHADOW_TOKEN)) fail(errors, `${name}: stray #2438 marker`);
  return errors;
}

// [#2439 SC-12.1] Phase 3C marker contract. The wave owns exactly seventeen
// wrapper identities, holds one atomic lifecycle across all of them, and each
// shadow wrapper carries exactly one exact top-level marker line. A missing,
// duplicated, altered or stray marker is red, and so is a marker on any
// workflow outside the seventeen.
export function validatePhase3cMarkers(manifest, workflowSources) {
  const errors = [];
  const records = (manifest.legacyOrigins || []).filter((origin) => origin.migrationWave === PHASE3C_WAVE);
  const names = records.map((origin) => `${origin.stem}.${origin.extension}`);
  if (names.length !== PHASE3C_SUITE_COUNT || new Set(names).size !== PHASE3C_SUITE_COUNT
      || names.some((name) => !PHASE3C_WRAPPER_SET.has(name))) {
    fail(errors, `Phase 3C must own the exact ${PHASE3C_SUITE_COUNT} reviewed wrapper identities`);
  }
  const lifecycles = new Set(records.map((origin) => origin.disposition));
  if (lifecycles.size !== 1 || ![...PHASE3C_ATOMIC_LIFECYCLES].includes([...lifecycles][0])) fail(errors, "Phase 3C lifecycle must be atomic");
  for (const name of PHASE3C_WRAPPER_NAMES) {
    const source = workflowSources[name]; const shadow = lifecycles.has("shadow-active");
    if (shadow && typeof source !== "string") { fail(errors, `${name}: shadow wrapper missing`); continue; }
    if (!shadow && typeof source === "string") { fail(errors, `${name}: terminal wrapper must be absent`); continue; }
    if (!shadow) continue;
    const exact = source.split("\n").filter((line) => line === PHASE3C_SHADOW_MARKER).length;
    const tokens = source.split(PHASE3C_SHADOW_TOKEN).length - 1;
    if (exact !== 1 || tokens !== 1 || !source.startsWith(`${PHASE3C_SHADOW_MARKER}\n`)) fail(errors, `${name}: requires one exact top-level #2439 marker`);
  }
  for (const [name, source] of Object.entries(workflowSources)) if (!PHASE3C_WRAPPER_SET.has(name) && source.includes(PHASE3C_SHADOW_TOKEN)) fail(errors, `${name}: stray #2439 marker`);
  return errors;
}

// [#2438 A7-SC3] Explicitly entered, explicitly exited tracked-file scope.
//
// Ambient, process-lifetime or module-global memoisation of trackedFiles() (or
// of discoverWorkflowProviders()), and any cache keyed only on `root`, are
// FORBIDDEN BY NAME. A blind memo is proven to manufacture a false green:
// honest discovery moves 73 -> 74 with a different digest the moment a new
// eligible source naming a real workflow is committed, while a blind memo keeps
// reporting 73 / aac3d8cf... and the reviewed byte-invariance proof silently
// stops being performed. A caller may opt into caching only where the working
// tree and the Git index are provably immutable for the whole duration of the
// scope. Outside a scope the uncached path runs and every call spawns
// `git ls-files -z`; no callsite that mutates the tree or the index inside the
// measured window may enter a scope.
const trackedFilesScopeStack = [];
let trackedFilesCallTotal = 0;
let trackedFilesProcessInvocationTotal = 0;

// [#2438 A7-SC4] Monotonic counters. Counts only — a wall-clock, high-resolution
// timer or elapsed-millisecond threshold inside a gate is forbidden: it flakes on
// shared runners and this repository already carries one nondeterministic
// required gate (#2178). The cost contract is counts; elapsed time is verified
// out of band from Actions timestamps.
export function trackedFilesProcessInvocations() {
  return trackedFilesProcessInvocationTotal;
}

export function trackedFilesCalls() {
  return trackedFilesCallTotal;
}

export function withTrackedFilesScope(root, fn) {
  const scope = { root: path.resolve(root), cache: new Map() };
  trackedFilesScopeStack.push(scope);
  try {
    return fn();
  } finally {
    const exited = trackedFilesScopeStack.pop();
    if (exited !== scope) throw new Error("tracked-files scope was not exited in order");
  }
}

function trackedFilesScopeFor(key) {
  for (let index = trackedFilesScopeStack.length - 1; index >= 0; index -= 1) {
    if (trackedFilesScopeStack[index].cache.has(key)) return trackedFilesScopeStack[index];
  }
  return trackedFilesScopeStack.length ? trackedFilesScopeStack[trackedFilesScopeStack.length - 1] : null;
}

// [#2439 SC-15.4] Exported so the post-cutover retired-reference inventory can
// reuse the SAME A7-SC3 scope and the SAME cached listing. The alternative — the
// gate spawning its own `git ls-files` — would do work the accounting record
// cannot see, which is precisely the dishonest-accounting class this tranche
// exists to close. Read-only; the scope still owns the cache and the count.
export function trackedFiles(root) {
  trackedFilesCallTotal += 1;
  const key = path.resolve(root);
  const scope = trackedFilesScopeFor(key);
  const cached = scope?.cache.get(key);
  // Hand back a fresh array on every call so an entered scope is observationally
  // identical to the uncached path apart from the process spawn it removes.
  if (cached) return cached.slice();
  trackedFilesProcessInvocationTotal += 1;
  let listed;
  try {
    listed = execFileSync("git", ["ls-files", "-z"], { cwd: root })
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
  } catch {
    throw new Error("registry validation requires a git worktree");
  }
  if (!scope) return listed;
  scope.cache.set(key, listed);
  return listed.slice();
}

const requireFromValidator = createRequire(import.meta.url);

function globToRegExp(glob) {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*") {
      if (glob[index + 1] === "*") {
        index += 1;
        if (glob[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else if (character === "[") {
      const end = glob.indexOf("]", index + 1);
      if (end === -1) source += "\\[";
      else {
        const contents = glob.slice(index + 1, end);
        source += `[${contents.startsWith("!") ? `^${contents.slice(1)}` : contents}]`;
        index = end;
      }
    } else if (character === "{") {
      const end = glob.indexOf("}", index + 1);
      if (end === -1) source += "\\{";
      else {
        source += `(?:${glob.slice(index + 1, end).split(",").map((part) => globToRegExp(part).source.slice(1, -1)).join("|")})`;
        index = end;
      }
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

function configPathsFromCommand(command) {
  const configs = [];
  const expression = /(?:^|\s)--config(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/g;
  for (const match of command.matchAll(expression)) configs.push(match[1] || match[2] || match[3]);
  return configs;
}

function filesSelectedByJestConfig(configRelative, cwd, root, commandTestMatch = []) {
  const configAbsolute = path.resolve(root, cwd, configRelative);
  const repositoryRelative = path.relative(root, configAbsolute);
  if (repositoryRelative.startsWith("..") || path.isAbsolute(repositoryRelative) || !fs.statSync(configAbsolute).isFile()) {
    throw new Error(`Jest config is outside the repository or missing: ${configRelative}`);
  }

  delete requireFromValidator.cache?.[configAbsolute];
  const loaded = requireFromValidator(configAbsolute);
  const config = loaded?.default ?? loaded;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`Jest config must synchronously export an object: ${repositoryRelative}`);
  }

  const configDirectory = path.dirname(configAbsolute);
  const rootDir = config.rootDir
    ? path.resolve(configDirectory, String(config.rootDir).replaceAll("<rootDir>", configDirectory))
    : configDirectory;
  const rootRelative = path.relative(root, rootDir);
  if (rootRelative.startsWith("..") || path.isAbsolute(rootRelative)) {
    throw new Error(`Jest rootDir is outside the repository: ${repositoryRelative}`);
  }

  const testMatch = commandTestMatch.length ? commandTestMatch : Array.isArray(config.testMatch) ? config.testMatch : [];
  const testRegex = Array.isArray(config.testRegex)
    ? config.testRegex
    : typeof config.testRegex === "string" ? [config.testRegex] : [];
  if (testMatch.length === 0 && testRegex.length === 0) {
    throw new Error(`Jest config has no deterministic testMatch or testRegex: ${repositoryRelative}`);
  }
  const matchers = testMatch.map((pattern) => {
    const expanded = String(pattern).replaceAll("<rootDir>", rootDir).replaceAll(path.sep, "/");
    return globToRegExp(expanded);
  });
  const regexes = testRegex.map((pattern) => new RegExp(pattern));
  const ignores = (Array.isArray(config.testPathIgnorePatterns) ? config.testPathIgnorePatterns : [])
    .map((pattern) => new RegExp(String(pattern).replaceAll("<rootDir>", rootDir)));
  const configuredRoots = (Array.isArray(config.roots) && config.roots.length ? config.roots : [rootDir])
    .map((configuredRoot) => path.resolve(rootDir, String(configuredRoot).replaceAll("<rootDir>", rootDir)));

  return trackedFiles(root).filter((relative) => {
    const absolute = path.resolve(root, relative);
    const normalized = absolute.replaceAll(path.sep, "/");
    if (!configuredRoots.some((configuredRoot) => absolute === configuredRoot || absolute.startsWith(`${configuredRoot}${path.sep}`))) return false;
    if (ignores.some((ignore) => ignore.test(normalized))) return false;
    return matchers.some((matcher) => matcher.test(normalized)) || regexes.some((regex) => regex.test(normalized));
  });
}

export function discoverLiveOrigins(root = DEFAULT_ROOT) {
  return fs
    .readdirSync(path.join(root, ".github/workflows"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && LIVE_ORIGIN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

const RUBY_WORKFLOW_INSPECTOR = String.raw`
require "yaml"
require "json"
require "digest"

payload = JSON.parse(STDIN.read)
names = payload.fetch("names")
sources = payload.fetch("sources")
result = {}

names.each do |name|
  source = sources.fetch(name)
  document = YAML.safe_load(source, aliases: true) || {}
  on_value = document["on"] || document[true] || {}
  events = case on_value
           when Hash then on_value.keys.map(&:to_s)
           when Array then on_value.map(&:to_s)
           when String then [on_value]
           else []
           end
  path_scope = []
  if on_value.is_a?(Hash)
    on_value.each_value do |config|
      next unless config.is_a?(Hash)
      path_scope.concat(Array(config["paths"]).map(&:to_s))
      path_scope.concat(Array(config["paths-ignore"]).map(&:to_s))
    end
  end

  jobs = document["jobs"].is_a?(Hash) ? document["jobs"] : {}
  steps = jobs.values.flat_map { |job| job.is_a?(Hash) ? Array(job["steps"]) : [] }
  steps.select! { |step| step.is_a?(Hash) }
  actions = steps.map { |step| step["uses"]&.to_s }.compact.uniq.sort
  runners = jobs.values.map { |job| job.is_a?(Hash) ? job["runs-on"] : nil }.compact
                .flat_map { |runner| Array(runner).map(&:to_s) }.uniq.sort
  runtimes = steps.map do |step|
    action = step["uses"]&.to_s
    with = step["with"].is_a?(Hash) ? step["with"] : {}
    case action
    when %r{^actions/setup-node@}
      "node:#{with.fetch("node-version", "unspecified")}"
    when %r{^actions/setup-python@}
      "python:#{with.fetch("python-version", "unspecified")}"
    when %r{^denoland/setup-deno@}
      "deno:#{with.fetch("deno-version", "unspecified")}"
    end
  end.compact.uniq.sort
  permissions = document["permissions"]
  permission_rows = case permissions
                    when Hash then permissions.map { |key, value| "#{key}: #{value}" }.sort
                    when nil then []
                    else [permissions.to_s]
                    end
  environments = jobs.values.map do |job|
    next unless job.is_a?(Hash)
    value = job["environment"]
    value.is_a?(Hash) ? value["name"]&.to_s : value&.to_s
  end.compact.uniq.sort
  concurrency = document["concurrency"].is_a?(Hash) ? document["concurrency"] : {}

  result[name] = {
    "sourceSha256" => Digest::SHA256.hexdigest(source),
    "triggers" => events.uniq.sort,
    "pathScope" => path_scope.uniq.sort,
    "jobKeys" => jobs.keys.map(&:to_s).uniq.sort,
    "runners" => runners,
    "runtimeVersions" => runtimes,
    "setupActions" => actions,
    "concurrency" => {
      "group" => concurrency["group"]&.to_s,
      "cancelOnPullRequest" => concurrency["cancel-in-progress"] == "$" + "{{ github.event_name == 'pull_request' }}"
    },
    "trustBoundary" => {
      "permissions" => permission_rows,
      "environments" => environments,
      "usesRepositorySecrets" => source.include?("secrets."),
      "usesOidc" => source.match?(/id-token:\s*write/),
      "pullRequestTarget" => events.include?("pull_request_target")
    }
  }
end

STDOUT.write(JSON.generate(result))
`;

const workflowInspectionCache = new Map();

export function inspectWorkflows(root = DEFAULT_ROOT, workflowNames = discoverLiveOrigins(root)) {
  const names = [...new Set(workflowNames)].sort();
  const sources = Object.fromEntries(names.map((name) => {
    const source = fs.readFileSync(path.join(root, ".github/workflows", name), "utf8");
    return [name, canonicalizeShadowWrapperSource(name, source)];
  }));
  const sourceDigest = crypto.createHash("sha256").update(JSON.stringify(sources)).digest("hex");
  const key = `${path.resolve(root)}\0${names.join("\0")}\0${sourceDigest}`;
  if (!workflowInspectionCache.has(key)) {
    const output = execFileSync("ruby", ["-e", RUBY_WORKFLOW_INSPECTOR], {
      input: JSON.stringify({ names, sources }),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const parsed = JSON.parse(output);
    for (const metadata of Object.values(parsed)) {
      Object.defineProperty(metadata, "phase3bConcurrency", { value: metadata.concurrency, enumerable: false });
      delete metadata.concurrency;
    }
    workflowInspectionCache.set(key, parsed);
  }
  return workflowInspectionCache.get(key);
}

export function inspectWorkflow(root, workflowName) {
  return inspectWorkflows(root, discoverLiveOrigins(root))[workflowName];
}

const RUBY_BATCH_INSPECTOR = String.raw`
require "yaml"
require "json"
document = YAML.safe_load(STDIN.read, aliases: true) || {}
jobs = document["jobs"].is_a?(Hash) ? document["jobs"] : {}
batch = jobs["batch"].is_a?(Hash) ? jobs["batch"] : {}
steps = Array(batch["steps"]).select { |step| step.is_a?(Hash) }
setup_node = steps.find { |step| step["uses"].to_s.start_with?("actions/setup-node@") } || {}
checkout = steps.find { |step| step["uses"].to_s.start_with?("actions/checkout@") } || {}
record_setup = steps.find { |step| step["name"].to_s == "Execute and record one typed shard setup" } || {}
run_suites = steps.find { |step| step["name"].to_s.start_with?("Run the ") } || {}
strategy = batch["strategy"].is_a?(Hash) ? batch["strategy"] : {}
matrix = strategy["matrix"].is_a?(Hash) ? strategy["matrix"] : {}
dispatch = jobs["dispatch"].is_a?(Hash) ? jobs["dispatch"] : {}
dispatch_steps = Array(dispatch["steps"]).select { |step| step.is_a?(Hash) }
dispatch_setup_node = dispatch_steps.find { |step| step["uses"].to_s.start_with?("actions/setup-node@") } || {}
dispatch_checkout = dispatch_steps.find { |step| step["uses"].to_s.start_with?("actions/checkout@") } || {}
dispatch_record_setup = dispatch_steps.find { |step| step["name"].to_s == "Execute and record one typed shard setup" } || {}
dispatch_run_suites = dispatch_steps.find { |step| step["name"].to_s.start_with?("Run the ") } || {}
dispatch_upload = dispatch_steps.find { |step| step["uses"].to_s.start_with?("actions/upload-artifact@") } || {}
output = {
  "jobKeys" => jobs.keys.map(&:to_s).sort,
  "runner" => batch["runs-on"]&.to_s,
  "timeoutMinutes" => batch["timeout-minutes"]&.to_s,
  "matrix" => Array(matrix["include"]).map do |entry|
    next {} unless entry.is_a?(Hash)
    { "class" => entry["class"]&.to_s, "node" => entry["node"]&.to_s,
      "cache" => entry["cache"]&.to_s, "cacheLock" => entry["cache-lock"]&.to_s,
      "hostTimeoutMinutes" => entry["hostTimeoutMinutes"], "secondaryClass" => entry["secondaryClass"]&.to_s,
      "secondaryNode" => entry["secondaryNode"]&.to_s, "secondaryDeno" => entry["secondaryDeno"]&.to_s,
      "tertiaryClass" => entry["tertiaryClass"]&.to_s, "tertiaryNode" => entry["tertiaryNode"]&.to_s,
      "tertiaryDeno" => entry["tertiaryDeno"]&.to_s, "tertiaryOrder" => entry["tertiaryOrder"]&.to_s }
  end,
  "setupNode" => {
    "action" => setup_node["uses"]&.to_s,
    "nodeVersion" => setup_node.dig("with", "node-version")&.to_s,
    "count" => steps.count { |step| step["uses"].to_s.start_with?("actions/setup-node@") && step["name"].to_s.empty? }
  },
  "checkout" => {
    "action" => checkout["uses"]&.to_s,
    "fetchDepth" => checkout.dig("with", "fetch-depth"),
    "persistCredentials" => checkout.dig("with", "persist-credentials")
  },
  "recordSetupStep" => {
    "run" => record_setup["run"]&.to_s,
    "count" => steps.count { |step| step["name"].to_s == "Execute and record one typed shard setup" }
  },
  "runSuitesStep" => {
    "run" => run_suites["run"]&.to_s,
    "count" => steps.count { |step| step["name"].to_s.start_with?("Run the ") }
  },
  "runSteps" => steps.map { |step| { "run" => step["run"]&.to_s, "if" => step["if"]&.to_s } }.select { |step| step["run"] },
  "steps" => steps.map { |step| { "name" => step["name"]&.to_s, "id" => step["id"]&.to_s,
    "uses" => step["uses"]&.to_s, "run" => step["run"]&.to_s, "if" => step["if"]&.to_s,
    "timeoutMinutes" => step["timeout-minutes"], "continueOnError" => step["continue-on-error"] } },
  "jobIf" => batch["if"]&.to_s,
  "dispatch" => {
    "runner" => dispatch["runs-on"]&.to_s,
    "timeoutMinutes" => dispatch["timeout-minutes"],
    "jobIf" => dispatch["if"]&.to_s,
    "hasStrategy" => dispatch.key?("strategy"),
    "setupNode" => {
      "action" => dispatch_setup_node["uses"]&.to_s,
      "nodeVersion" => dispatch_setup_node.dig("with", "node-version")&.to_s,
      "count" => dispatch_steps.count { |step| step["uses"].to_s.start_with?("actions/setup-node@") }
    },
    "checkout" => {
      "action" => dispatch_checkout["uses"]&.to_s,
      "fetchDepth" => dispatch_checkout.dig("with", "fetch-depth"),
      "persistCredentials" => dispatch_checkout.dig("with", "persist-credentials")
    },
    "recordSetupStep" => {
      "run" => dispatch_record_setup["run"]&.to_s,
      "count" => dispatch_steps.count { |step| step["name"].to_s == "Execute and record one typed shard setup" }
    },
    "runSuitesStep" => {
      "run" => dispatch_run_suites["run"]&.to_s,
      "count" => dispatch_steps.count { |step| step["name"].to_s.start_with?("Run the ") }
    },
    "runSteps" => dispatch_steps.map { |step| { "run" => step["run"]&.to_s, "if" => step["if"]&.to_s } }.select { |step| step["run"] },
    "upload" => {
      "action" => dispatch_upload["uses"]&.to_s,
      "if" => dispatch_upload["if"]&.to_s,
      "name" => dispatch_upload.dig("with", "name")&.to_s,
      "path" => dispatch_upload.dig("with", "path")&.to_s,
      "ifNoFilesFound" => dispatch_upload.dig("with", "if-no-files-found")&.to_s,
      "count" => dispatch_steps.count { |step| step["uses"].to_s.start_with?("actions/upload-artifact@") }
    }
  },
  "workflowDispatch" => document.dig("on", "workflow_dispatch") || document.dig(true, "workflow_dispatch")
}
STDOUT.write(JSON.generate(output))
`;

export function inspectBatchWorkflow(source) {
  return JSON.parse(execFileSync("ruby", ["-e", RUBY_BATCH_INSPECTOR], {
    input: source,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }));
}

export function validatePhase2Contract(manifestOrOptions, matrixSource) {
  const optionShape = manifestOrOptions?.manifest && typeof manifestOrOptions.manifest === "object";
  const manifest = optionShape ? manifestOrOptions.manifest : manifestOrOptions;
  const contractRoot = optionShape ? manifestOrOptions.root || DEFAULT_ROOT : DEFAULT_ROOT;
  const workflowText = (optionShape ? manifestOrOptions.workflowText : matrixSource)
    ?? fs.readFileSync(path.join(contractRoot, ".github/workflows/ci-batch.yml"), "utf8");
  const errors = [];
  const requiredRunnerContract = {
    workspaceIsolation: "detached-git-worktree",
    processGroup: "detached",
    timeoutGraceSeconds: 2,
    resultsFile: "suite-results.json",
    setupEvidencePrefix: "ci-batch-setup-",
    processOwnership: "linux-subreaper-before-fork",
    dependencyIsolation: "independent-tree-no-escaping-links-with-shard-snapshot",
    childEnvironment: "minimal-allowlist-no-job-secrets",
  };
  if (JSON.stringify(manifest.runnerContract) !== JSON.stringify(requiredRunnerContract)) {
    fail(errors, "runnerContract must equal the exact Phase 2 isolation, process-group, timeout, result, and setup-evidence contract");
  }
  for (const suite of manifest.suites || []) {
    if ("timeoutMinutes" in suite || !Number.isInteger(suite.timeoutSeconds) || suite.timeoutSeconds < 1 || suite.timeoutSeconds > 1500) {
      fail(errors, `${suite.id}: timeoutSeconds must be an integer from 1 through 1500 and timeoutMinutes is forbidden`);
    }
    if (suite.isolation !== "clean-worktree") fail(errors, `${suite.id}: isolation must be exactly clean-worktree`);
    const exactPhase3bEnv = suite.id === "issue-1902-public-event-lifecycle-tests"
      && JSON.stringify((suite.steps || []).map((step) => step.env || null).filter(Boolean)) === JSON.stringify([{ NODE_PATH: "./node_modules" }]);
    // [#2439 SC-6] Exactly four keys, two maps, literals only, on exactly the two
    // #1326 steps that carry them. Everything else about the env boundary is
    // unchanged: no interpolation, no command substitution, no process-env
    // forwarding, no secrets.* reference, and no other suite may carry env at all.
    const exactPhase3cEnv = suite.id === "issue-1326-ng-reservation-finalize-tests"
      && JSON.stringify((suite.steps || []).map((step) => step.env || null).filter(Boolean)) === JSON.stringify(PHASE3C_AUTHORISED_ENV);
    if (JSON.stringify(suite.envNames) !== "[]" && !exactPhase3cEnv) {
      fail(errors, `${suite.id}: assertion children may not receive repository or job environment capabilities`);
    }
    if ((suite.steps || []).some((step) => step.env && Object.keys(step.env).length) && !exactPhase3bEnv && !exactPhase3cEnv) {
      fail(errors, `${suite.id}: assertion children may not receive repository or job environment capabilities`);
    }
    for (const step of suite.steps || []) {
      for (const [key, value] of Object.entries(step.env || {})) {
        if (typeof value !== "string" || /\$\{\{|\$\(|`|secrets\./.test(value) || /\$\{\{|secrets\./.test(key)) {
          fail(errors, `${suite.id}: environment value for ${key} must be an inert literal`);
        }
      }
    }
    for (const generated of suite.generatedPaths || []) {
      if (!generated || path.isAbsolute(generated) || path.normalize(generated).startsWith("..")) {
        fail(errors, `${suite.id}: generated path must remain repository-relative: ${generated}`);
      }
    }
    for (const [index, step] of (suite.steps || []).entries()) {
      if (!PHASE3_WAVE_LIFECYCLES.has(suite.lifecycle) && forbiddenEmbeddedSetup(step)) fail(errors, `${suite.id}: step ${index} embeds forbidden setup/bootstrap work`);
    }
  }
  try {
    const topology = inspectBatchWorkflow(workflowText);
    if (topology.runner !== "ubuntu-latest") fail(errors, "ci-batch process containment requires the locked ubuntu-latest runner");
    if (topology.recordSetupStep?.run !== 'node .github/scripts/ci-batch/run-suite-batch.mjs --setup "${{ matrix.class }}"') {
      fail(errors, "ci-batch must record exactly one typed setup execution for the selected class");
    }
    const installCommandCount = (topology.runSteps || []).filter((step) => forbiddenEmbeddedSetup({ cmd: "bash", args: ["-lc", step.run] })).length;
    if (topology.setupNode?.count !== 1 || installCommandCount !== 0 || topology.recordSetupStep?.count !== 1 || topology.runSuitesStep?.count !== 1) {
      fail(errors, "ci-batch must contain one runtime setup, no free-form install route, one typed setup executor, and one suite runner step");
    }
    if (topology.runSuitesStep?.run !== 'node .github/scripts/ci-batch/run-suite-batch.mjs --run "${{ matrix.class }}"') {
      fail(errors, "ci-batch must invoke the Phase 2 runner with the selected class");
    }
    if (topology.checkout?.action !== PINNED_CHECKOUT || topology.checkout?.fetchDepth !== 0 || topology.checkout?.persistCredentials !== false
        || topology.setupNode?.action !== PINNED_SETUP_NODE || topology.setupNode?.nodeVersion !== "${{ matrix.node }}") {
      fail(errors, "ci-batch must preserve the exact pinned checkout/setup-node, fetch-depth 0, persist-credentials false trust contract");
    }
    const dispatch = topology.dispatch || {};
    const unsupportedPreMatrixContext = [topology.jobIf, dispatch.jobIf].some((condition) => /\b(?:matrix|strategy|steps|runner|job)\b/.test(condition || ""));
    if (unsupportedPreMatrixContext || topology.jobIf !== "github.event_name != 'workflow_dispatch'") {
      fail(errors, "ci-batch job-level if must use only supported pre-matrix event contexts");
    }
    const dispatchInstallCommandCount = (dispatch.runSteps || []).filter((step) => forbiddenEmbeddedSetup({ cmd: "bash", args: ["-lc", step.run] })).length;
    const expectedDispatchUpload = {
      action: "actions/upload-artifact@v4",
      if: "always()",
      name: "suite-results-node20-19-noinstall",
      path: "suite-results.json",
      ifNoFilesFound: "error",
      count: 1,
    };
    if (JSON.stringify(topology.jobKeys) !== JSON.stringify(["batch", "dispatch"])
        || dispatch.runner !== "ubuntu-latest" || dispatch.timeoutMinutes !== 25 || dispatch.hasStrategy
        || dispatch.jobIf !== "github.event_name == 'workflow_dispatch' && inputs.suite == 'issue-2300-orch-artifact-reap'"
        || dispatch.setupNode?.action !== PINNED_SETUP_NODE || dispatch.setupNode?.nodeVersion !== "20.19.4" || dispatch.setupNode?.count !== 1
        || dispatch.checkout?.action !== PINNED_CHECKOUT || dispatch.checkout?.fetchDepth !== 0 || dispatch.checkout?.persistCredentials !== false
        || dispatch.recordSetupStep?.run !== 'node .github/scripts/ci-batch/run-suite-batch.mjs --setup "node20-19-noinstall"' || dispatch.recordSetupStep?.count !== 1
        || dispatch.runSuitesStep?.run !== 'node .github/scripts/ci-batch/run-suite-batch.mjs --run "node20-19-noinstall"' || dispatch.runSuitesStep?.count !== 1
        || dispatchInstallCommandCount !== 0 || JSON.stringify(dispatch.upload) !== JSON.stringify(expectedDispatchUpload)
        || JSON.stringify(topology.workflowDispatch) !== JSON.stringify({ inputs: { suite: { description: "Bounded operational suite", required: true, type: "choice", options: ["issue-2300-orch-artifact-reap"] } } })) {
      fail(errors, "ci-batch workflow_dispatch must use the exact isolated #2300-only route and pinned trust contract");
    }
  } catch (error) {
    fail(errors, `ci-batch.yml is not valid inspectable YAML: ${error.message}`);
  }
  return errors;
}

function sameStrings(actual, expected) {
  return strings(actual) && JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function profileInstallList(profile) {
  if (profile?.install) return [profile.install];
  return Array.isArray(profile?.installs) ? profile.installs : [];
}

function canonicalInstallCwd(cwd) {
  return typeof cwd === "string" && cwd && cwd.trim() === cwd && !cwd.startsWith("/") && !/^[A-Za-z]:/.test(cwd) && !cwd.includes("\\") && !cwd.includes("\0") && !cwd.endsWith("/")
    && !cwd.split("/").some((part) => !part || part === "." || part === "..") && path.posix.normalize(cwd) === cwd;
}

export function canonicalInstallIdentity(profileName, profile, installIndex) {
  const installs = profileInstallList(profile); const install = installs[installIndex];
  const rootTuple = profileName === "root-node20-yaml-no-save" && installIndex === 0 && installs.length === 1 && install?.cwd === "."
    && install.invocation?.kind === "argv" && install.invocation.command === "npm"
    && JSON.stringify(install.invocation.argv) === JSON.stringify(["install", "--no-save", "yaml"])
    && JSON.stringify(profile.classes) === JSON.stringify(["root-node20-yaml-no-save"]);
  if (rootTuple) return "<repo-root>";
  if (!canonicalInstallCwd(install?.cwd) || install?.cwd === "<repo-root>") throw new Error(`noncanonical install cwd: ${JSON.stringify(install?.cwd)}`);
  return install.cwd;
}

// #2436 Phase 2: setup belongs to the class profile and executes once per shard.
// Suite commands are assertions only. Keep this deliberately broad and fail closed:
// a newly embedded package/bootstrap/migration operation is a cost and isolation
// regression even when it is hidden in a compound shell command.
export function forbiddenEmbeddedSetup(command) {
  const source = typeof command === "string"
    ? command
    : Array.isArray(command?.args)
      ? command.args[command.args.length - 1] || ""
      : command?.run || command?.invocation?.argv?.at(-1) || "";
  return shellCommands(String(source)).some(({ executable, argv }) => setupExecutable(executable, argv));
}

function shellTokens(source) {
  const normalized = source.replace(/\\\r?\n/g, " ");
  const tokens = [];
  let word = "";
  let quote = null;
  let escaped = false;
  const push = () => { if (word) { tokens.push({ type: "word", value: word }); word = ""; } };
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (escaped) { word += character; escaped = false; continue; }
    if (quote === "'") { if (character === "'") quote = null; else word += character; continue; }
    if (quote === '"') {
      if (character === '"') quote = null;
      else if (character === "\\") escaped = true;
      else word += character;
      continue;
    }
    if (character === "\\") { escaped = true; continue; }
    if (character === "'" || character === '"') { quote = character; continue; }
    if (character === "#" && !word) {
      while (index < normalized.length && normalized[index] !== "\n") index += 1;
      push(); tokens.push({ type: "op", value: ";" }); continue;
    }
    if (/\s/.test(character)) { push(); if (character === "\n") tokens.push({ type: "op", value: ";" }); continue; }
    if (";&|(){}".includes(character)) {
      push();
      const pair = normalized.slice(index, index + 2);
      if (["&&", "||", ";;"].includes(pair)) { tokens.push({ type: "op", value: pair }); index += 1; }
      else tokens.push({ type: "op", value: character });
      continue;
    }
    word += character;
  }
  push();
  return tokens;
}

function shellCommands(source) {
  const tokens = shellTokens(source);
  const commands = [];
  let words = [];
  const flush = () => {
    if (!words.length) return;
    let index = 0;
    while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(words[index])) index += 1;
    while (["command", "builtin", "exec", "sudo", "env", "nice", "nohup", "time"].includes(words[index])) {
      const wrapper = words[index++];
      const optionTakesValue = wrapper === "sudo"
        ? new Set(["-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt", "-C", "--chdir", "-R", "--chroot", "-T", "--command-timeout"])
        : wrapper === "env" ? new Set(["-u", "--unset", "-C", "--chdir"])
          : wrapper === "nice" ? new Set(["-n", "--adjustment"]) : new Set();
      while (index < words.length && words[index].startsWith("-")) {
        const option = words[index++];
        if (optionTakesValue.has(option) && index < words.length) index += 1;
      }
      if (wrapper === "env") while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(words[index])) index += 1;
    }
    if (words[index] === "corepack") index += 1;
    const executable = words[index];
    const argv = words.slice(index + 1);
    if (executable) commands.push({ executable: path.basename(executable).toLowerCase(), argv });
    words = [];
  };
  const reserved = new Set(["if", "then", "elif", "else", "fi", "while", "until", "do", "done", "case", "esac", "for", "select", "in", "time", "!"]);
  for (const token of tokens) {
    if (token.type === "op") { flush(); continue; }
    if (!words.length && reserved.has(token.value)) continue;
    words.push(token.value);
  }
  flush();
  return commands;
}

function setupExecutable(executable, argv) {
  const args = argv.map((value) => value.toLowerCase());
  const firstAction = args.find((value) => !value.startsWith("-") && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(value));
  if (["npm", "pnpm", "yarn"].includes(executable) && ["ci", "install", "i", "add"].includes(firstAction)) return true;
  if (["apt", "apt-get", "brew"].includes(executable) && ["update", "install"].includes(firstAction)) return true;
  if (["docker", "podman"].includes(executable) && args.some((value) => ["up", "run", "start"].includes(value))) return true;
  if (executable === "supabase" && (args.join(" ").includes("db reset") || args.join(" ").includes("migration up"))) return true;
  if (["setup-node", "setup-deno", "setup-python"].includes(executable) || /setup-(?:node|deno|python)@/.test(executable)) return true;
  if (["bash", "sh", "zsh"].includes(executable)) {
    const commandIndex = args.findIndex((value) => value === "-c" || value === "-lc");
    if (commandIndex >= 0 && argv[commandIndex + 1]) return forbiddenEmbeddedSetup(argv[commandIndex + 1]);
    return true; // stdin-sourced shell text is not statically inspectable.
  }
  // Dynamic evaluation/source can synthesize an uninspectable setup command.
  if (["eval", "source", ".", "alias"].includes(executable) || executable.includes("$") || executable.includes("`")) return true;
  if (executable === "xargs" && argv.some((value) => ["npm", "pnpm", "yarn", "apt", "apt-get", "brew", "docker", "podman", "supabase"].includes(value.toLowerCase()))) return true;
  if (executable === "find" && args.some((value, index) => ["-exec", "-execdir"].includes(value) && setupExecutable(path.basename(args[index + 1] || ""), args.slice(index + 2)))) return true;
  if (/(?:^|[-_])migrat(?:e|ion)(?:$|[-_])/.test(executable) && args.some((value) => ["up", "apply", "run"].includes(value))) return true;
  // The 46 original commands plus #2399's 5 migrated assertions need only
  // these executable families.
  // Unknown shell executables are not assumed harmless: aliases, copied package
  // managers, bespoke bootstrap wrappers, and future setup tools would otherwise
  // recreate the same bypass under a new name. Adding a family is a reviewed
  // grammar change, not an accidental green.
  return !new Set(["node", "npx", "grep", "echo", "printf", "true", "false", "exit", "test", "["]).has(executable);
}

export function discoverExpectedFilesForSuite(suite, root = DEFAULT_ROOT) {
  const found = new Set();
  const repositoryFiles = new Set(trackedFiles(root));
  for (const step of suite.steps || []) {
    // Compound shell blocks are executed through their typed leaves. Derive
    // provenance from those real leaf cwd/invocations, never from the inert
    // outer narration that merely preserves the historical YAML bytes.
    const units = step.children?.length ? step.children : [step];
    for (const unit of units) {
    const cwd = unit.cwd || step.cwd || suite.cwd || ".";
    // [#2439 SC-5.1 / SC-5.2] A typed required-file or source-contract leaf
    // carries no shell at all: its named targets ARE its file selection, and
    // they must enter the inventory or the tokenizer would report a leaf that
    // asserts on files the registry never claims exist.
    for (const declared of [...(unit.predicate?.paths || []), ...(unit.predicate?.path ? [unit.predicate.path] : [])]) {
      const relative = path.normalize(path.join(cwd, declared)).replaceAll(path.sep, "/");
      if (repositoryFiles.has(relative) && fs.statSync(path.join(root, relative), { throwIfNoEntry: false })?.isFile()) found.add(relative);
    }
    const command = unit.invocation?.argv?.[1] ?? unit.run ?? step.invocation?.argv?.[1] ?? step.run ?? "";
    const commandTestMatch = [...command.matchAll(/(?:^|\s)--testMatch(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/g)]
      .map((match) => match[1] || match[2] || match[3]);
    for (const config of configPathsFromCommand(command)) {
      for (const selected of filesSelectedByJestConfig(config, cwd, root, commandTestMatch)) found.add(selected);
    }
    const tokens = command.match(PHASE3_WAVE_LIFECYCLES.has(suite.lifecycle)
      ? /[A-Za-z0-9_@.()\/\[\]+*\-]+/g
      : /[A-Za-z0-9_@.()\/[\]+-]+/g) || [];
    for (let token of tokens) {
      token = token.replace(/[),;:]+$/, "");
      if (!token) continue;
      if (token.includes("*")) {
        // Phase 1 intentionally ignored wildcard tokens. Preserve that reviewed
        // baseline byte-for-byte; Phase 3 shadow variants opt into deterministic
        // wildcard expansion so newly migrated files cannot disappear.
        if (!PHASE3_WAVE_LIFECYCLES.has(suite.lifecycle)) continue;
        const relativePattern = path.normalize(path.join(cwd, token)).replaceAll(path.sep, "/");
        const matcher = globToRegExp(relativePattern);
        for (const tracked of trackedFiles(root)) {
          if (matcher.test(tracked.replaceAll(path.sep, "/"))) found.add(tracked);
        }
        continue;
      }
      for (const relative of [path.normalize(path.join(cwd, token)), path.normalize(token)]) {
        // node_modules is setup output, never source ownership. Installed-lane
        // assertions may inspect patched dependency bytes, but their presence
        // must not make the static expectedFiles inventory environment-dependent.
        if (relative.split(path.sep).includes("node_modules")) continue;
        try {
          if (repositoryFiles.has(relative) && fs.statSync(path.join(root, relative)).isFile()) found.add(relative);
        } catch {
          // A command token is often a flag, package, shell variable, or output.
        }
      }
      // Jest also accepts a path/name pattern instead of an explicit filename.
      // Resolve that pattern against the real suite cwd so the registry cannot
      // silently omit a file that the preserved command actually selects.
      if (/^(?:issue|orch|meta)[_-]\d+/i.test(token) && !token.includes("/")) {
        const base = path.join(root, cwd);
        const pending = [base];
        while (pending.length) {
          const directory = pending.pop();
          for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) pending.push(absolute);
            else if (entry.isFile() && entry.name.toLowerCase().includes(token.toLowerCase())) {
              found.add(path.relative(root, absolute));
            }
          }
        }
      }
    }
    }
  }
  return [...found].sort();
}

export function isNonAuthoritativeProviderEvidence(relative) {
  return relative.startsWith(CI_BATCH_EVIDENCE_PREFIX) || WAVE_SHADOW_TESTER_ROLE.test(relative);
}

/**
 * [#2438 A7-SC4] Reviewed, typed work-accounting record for one
 * discoverWorkflowProviders() call. Counts only — never timings.
 *
 * @typedef {object} ProviderDiscoveryAccounting
 * @property {number} trackedListInvocations trackedFiles() calls this discovery made. Exactly 1.
 * @property {number} eligible               tracked paths surviving the exclusion list.
 * @property {number} filesRead              eligible paths read without throwing.
 * @property {number} skippedUnreadable      eligible paths whose read threw. Reviewed fact: 0 today,
 *                                           because `git ls-files -s` shows only modes 100644/100755 —
 *                                           no symlinks (120000) and no gitlinks (160000) — so nothing
 *                                           in the tree can currently make readFileSync throw.
 * @property {number} filesPatternScanned    sources the workflow-filename pattern was evaluated against.
 */

/** @type {Readonly<ProviderDiscoveryAccounting> | null} */
let lastProviderDiscoveryAccountingRecord = null;

/** @returns {Readonly<ProviderDiscoveryAccounting> | null} */
export function providerDiscoveryAccounting() {
  return lastProviderDiscoveryAccountingRecord;
}

export function discoverWorkflowProviders(root = DEFAULT_ROOT) {
  const accounting = { trackedListInvocations: 0, eligible: 0, filesRead: 0, skippedUnreadable: 0, filesPatternScanned: 0 };
  const callsBefore = trackedFilesCallTotal;
  const workflowNames = new Set(
    fs
      .readdirSync(path.join(root, ".github/workflows"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
      .map((entry) => entry.name),
  );
  const references = new Map();
  for (const relative of trackedFiles(root)) {
    if (
      relative.startsWith(".github/workflows/") ||
      relative.startsWith("docs/") ||
      relative.endsWith(".md") ||
      relative === ".github/ci-batch/MANIFEST.json" ||
      // [#2524] Same disposition as the registry one line above, for the same
      // reason. .github/ci-capability-workflows.json is #2431's pre-approval
      // contract: it must name a capability workflow by its exact
      // .github/workflows/<name>.yml path, or the topology gate cannot match a
      // commit token against it. That literal is a POLICY DECLARATION about the
      // workflow, not a consumer of the checks it provides, so counting it as an
      // external provider reference would invent a record for every workflow the
      // exception mechanism is ever used for -- breaking the frozen provider seal
      // on the FIRST use, and permanently. Excluding it preserves the seal rather
      // than moving it: with the registry empty this file holds no .yml literal at
      // all, so discovery is byte-identical either way today.
      relative === ".github/ci-capability-workflows.json" ||
      relative === ".github/scripts/ci-batch/__tests__/issue-2438-postgres-wave-shadow-parity.implementor.test.mjs" ||
      relative === ".github/scripts/ci-batch/__tests__/select-phase3b-suites.test.mjs" ||
      isNonAuthoritativeProviderEvidence(relative)
    ) continue;
    accounting.eligible += 1;
    const absolute = path.join(root, relative);
    let source;
    try {
      source = fs.readFileSync(absolute, "utf8");
    } catch {
      accounting.skippedUnreadable += 1;
      continue;
    }
    accounting.filesRead += 1;
    // [#2438 A7-SC2] Correctness-preserving pre-filter. /[A-Za-z0-9_.-]+\.ya?ml/
    // is composed only of literal characters after the class, so a match's final
    // code units are exactly `.yml` or `.yaml`, both pure ASCII; String.includes
    // over the same string cannot miss what the regex would find. Skipping the
    // pattern for a source that can hold neither literal is therefore provably
    // output-preserving, and it removes the catastrophic backtracking the greedy
    // dot-bearing class suffers on the multi-megabyte SVG payloads in the corpus.
    // Both literals are load-bearing: `.yaml` is forward defence for a future
    // `.yaml` workflow and has no falsifiable guard today (there are 165 `.yml`
    // and 0 `.yaml` files in .github/workflows), so no mutant asserts it RED.
    if (!source.includes(".yml") && !source.includes(".yaml")) continue;
    accounting.filesPatternScanned += 1;
    const mentioned = new Set(source.match(/[A-Za-z0-9_.-]+\.ya?ml/g) || []);
    for (const name of mentioned) {
      // This file carries the reviewed wave identity lists as literals. Its own
      // source naming a wrapper is an identity declaration, not evidence that the
      // wrapper provides a suite, so it is exempted for the wave sets only.
      //
      // [#2591] PROVIDERS_ADDED_SINCE_SEAL is the same shape of literal and gets
      // the same exemption, for the same reason and no wider. Without it the
      // declaration MANUFACTURES the drift it exists to detect: naming
      // postgres-contract-suites.yml in the declaration made this file a fourth
      // discovered referenceFile for it, so the byte-equality subtraction failed
      // against a list the declaration itself had changed. MEASURED, not
      // theorised — it was the first thing the new guard reported.
      if (relative === ".github/scripts/ci-batch/validate-manifest-v2.mjs"
        && (PHASE3B_WRAPPER_SET.has(name) || PHASE3C_WRAPPER_SET.has(name)
          || PROVIDERS_ADDED_SINCE_SEAL_NAMES.has(name)
          || PROVIDER_REFERENCE_FILES_ADDED_SINCE_SEAL_NAMES.has(name))) continue;
      if (!workflowNames.has(name)) continue;
      if (!references.has(name)) references.set(name, []);
      references.get(name).push(relative);
    }
  }
  accounting.trackedListInvocations = trackedFilesCallTotal - callsBefore;
  lastProviderDiscoveryAccountingRecord = Object.freeze(accounting);
  return [...references]
    .map(([workflow, referenceFiles]) => ({ workflow, referenceFiles: [...new Set(referenceFiles)].sort() }))
    .sort((a, b) => a.workflow.localeCompare(b.workflow));
}

export function validateRegistry(
  rawManifest,
  { root = DEFAULT_ROOT, liveOrigins = null, workflowProviders = null, matrixSource = null } = {},
) {
  const errors = [];
  errors.push(...validateManifestTextRepresentations(rawManifest));
  const manifest = decodeManifestTextRepresentations(rawManifest);
  const workflowSources = Object.fromEntries(fs
    .readdirSync(path.join(root, ".github/workflows"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => [entry.name, fs.readFileSync(path.join(root, ".github/workflows", entry.name), "utf8")]));
  // [#2439 SC-16.7] ONE workflow inspection per validateRegistry call.
  // inspectWorkflow() re-derives its cache key by reading and hashing all 165
  // workflow sources, so calling it once per shadow suite paid that 29 times per
  // validation. Hoisting it is not memoisation - nothing is cached across calls
  // and every observation is identical - it simply stops recomputing one
  // deterministic map inside a loop. This makes the shared path cheaper for
  // Phase 3A, Phase 3B and Phase 3C alike, which is SC-16.7's structural remedy
  // rather than a Phase 3C-only shortcut.
  const inspections = inspectWorkflows(root, liveOrigins ?? discoverLiveOrigins(root));
  const inspect = (name) => inspections[name];
  errors.push(...validateShadowParityMarkers(manifest, workflowSources));
  errors.push(...validatePhase3bMarkers(manifest, workflowSources));
  errors.push(...validatePhase3cMarkers(manifest, workflowSources));
  if (manifest.schemaVersion !== 2) fail(errors, "schemaVersion must be exactly 2");
  if (manifest.generatedAtCommit !== undefined) fail(errors, "generatedAtCommit is forbidden: it makes registry diffs nondeterministic");
  if (manifest.expectedExecutableSuites !== 84 || manifest.expectedSuites !== 84 || manifest.shadowExpectedVariants !== 44) {
    fail(errors, "wave lock requires exactly 84 executable suites, including 32 Phase 3A, 12 Phase 3B and 17 Phase 3C variants");
  }
  if (!Array.isArray(manifest.classes) || manifest.classes.length === 0 || new Set(manifest.classes).size !== manifest.classes.length) {
    fail(errors, "classes must be a non-empty unique array");
  }
  if (!manifest.setupProfiles || typeof manifest.setupProfiles !== "object" || Array.isArray(manifest.setupProfiles)) {
    fail(errors, "setupProfiles must be an object");
  } else if (crypto.createHash("sha256").update(JSON.stringify(manifest.setupProfiles)).digest("hex") !== LOCKED_SETUP_PROFILES_SHA256) {
    fail(errors, "setupProfiles differ from the exact reviewed Phase 2 + #2437 + #2439 shadow setup contract");
  }
  if (!Array.isArray(manifest.suites) || manifest.suites.length !== 84) fail(errors, "suites must contain exactly 84 entries");

  const resolvedMatrixSource = matrixSource ?? fs.readFileSync(path.join(root, ".github/workflows/ci-batch.yml"), "utf8");
  errors.push(...validatePhase2Contract(manifest, resolvedMatrixSource));
  let batchTopology = { matrix: [], setupNode: {}, checkout: {}, recordSetupStep: {}, runSuitesStep: {} };
  try {
    batchTopology = inspectBatchWorkflow(resolvedMatrixSource);
  } catch (error) {
    fail(errors, `ci-batch.yml is not valid inspectable YAML: ${error.message}`);
  }
  // [#2438 / #2439] Every matrix row's exact host ceiling and its secondary
  // (Phase 3B) and tertiary (Phase 3C) migrated-class routes. A drifted route,
  // a silently-raised ceiling, or a class hosted where the registry does not put
  // it is red. Phase 3C adds NO new matrix row: the fourteen primary jobs are
  // unchanged and the six new classes ride inside six of them.
  const expectedPhase3bRows = {
    "node20-noinstall": [50, "phase3b-tenant-node20-deno146", "20", "1.46.x", "", "", "", ""],
    "business-node20-1": [45, "", "", "", "phase3c-deno146-node20", "20", "1.46.x", "node-first"],
    "business-node20-2": [40, "", "", "", "phase3c-deno2x-node20", "20", "v2.x", "node-first"],
    "business-node20-3": [45, "", "", "", "phase3c-deno2714-admin-node20", "20", "v2.7.14", "node-first"],
    "business-node20-4": [45, "", "", "", "phase3c-deno2x-admin-node20", "20", "v2.x", "deno-first"],
    "admin-node20-install": [55, "phase3b-lifecycle-node20-deno2", "20", "v2.x", "", "", "", ""],
    "node22-noinstall": [55, "phase3b-theme-node20", "20", "", "", "", "", ""],
    "app-node22-install": [50, "", "", "", "phase3c-deno2x-app-node22", "22", "v2.x", "node-first"],
    "business-node22-ignore-scripts": [60, "phase3b-brand-follow-node20-deno146", "20", "1.46.x", "", "", "", ""],
    "cross-root-node22-ignore-scripts": [62, "phase3b-draft-node20-renderer", "20", "", "phase3c-deno2714-node20", "20", "v2.7.14", "node-first"],
    "root-node20-yaml-no-save": [55, "phase3b-scanner-node20-renderer", "20", "", "", "", "", ""],
    "node20-19-noinstall": [55, "phase3b-screens-node20-deno2-renderer", "20", "v2.x", "", "", "", ""],
    "ota-app-node20-19-install": [105, "phase3b-business-node22", "22", "", "", "", "", ""],
    "ota-business-node20-19-install": [55, "phase3b-enablers-node20-deno2", "20", "v2.x", "", "", "", ""],
  };
  if (batchTopology.timeoutMinutes !== "${{ matrix.hostTimeoutMinutes }}") fail(errors, "batch timeout must be sourced from the exact integer matrix ceiling");
  for (const route of batchTopology.matrix || []) {
    const expected = expectedPhase3bRows[route.class];
    if (!expected || JSON.stringify([route.hostTimeoutMinutes, route.secondaryClass, route.secondaryNode, route.secondaryDeno,
      route.tertiaryClass, route.tertiaryNode, route.tertiaryDeno, route.tertiaryOrder]) !== JSON.stringify(expected)) {
      fail(errors, `${route.class}: Phase 3B/3C host timeout, secondary or tertiary route drifted`);
    }
  }
  const named = Object.fromEntries((batchTopology.steps || []).filter((step) => step.name).map((step) => [step.name, step]));
  const rawSelect = named["Select Phase 3B suites from complete local Git history"];
  const decision = named["Normalize Phase 3B decision fail-safe"];
  const selectionUpload = named["Upload Phase 3B selection evidence"];
  const reconcile = named["Reconcile Phase 3B host and surface deferred selector errors"];
  if (rawSelect?.id !== "phase3b-select" || rawSelect?.timeoutMinutes !== 2 || rawSelect?.continueOnError !== true
      || decision?.id !== "phase3b-decision" || decision?.if !== "always()" || decision?.timeoutMinutes !== 1 || decision?.continueOnError !== true
      || selectionUpload?.if !== "always()" || selectionUpload?.uses !== PINNED_UPLOAD_ARTIFACT
      || reconcile?.if !== "always()" || reconcile?.timeoutMinutes !== 2) fail(errors, "Phase 3B selector/normalizer/reconciliation protocol drifted");
  if (!resolvedMatrixSource.includes("name: phase3b-selection-${{ matrix.class }}")
      || !resolvedMatrixSource.includes("path: ${{ runner.temp }}/phase3b-decision-${{ matrix.class }}.json")
      || !resolvedMatrixSource.includes("if-no-files-found: error")) fail(errors, "Phase 3B selection artifact identity/path/fail-closed contract drifted");
  const deno1 = named["Select immutable Deno 1.46 runtime"];
  const deno2 = named["Select immutable Deno v2 runtime"];
  if (deno1?.uses !== "denoland/setup-deno@11b63cf76cfcafb4e43f97b6cad24d8e8438f62d"
      || deno2?.uses !== "denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed") fail(errors, "Phase 3B Deno actions must remain immutable");
  // [#2439 SC-7.1 / SC-7.3] One and only one correct action/selector per Phase 3C
  // Deno class, every action SHA immutable, and the run route pinned by name.
  const phase3cDeno = {
    "Select immutable Phase 3C Deno 1.46 runtime": ["denoland/setup-deno@11b63cf76cfcafb4e43f97b6cad24d8e8438f62d", "1.46.x"],
    "Select immutable Phase 3C Deno v2 runtime": ["denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed", "v2.x"],
    "Select immutable Phase 3C Deno v2.7.14 runtime": ["denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed", "v2.7.14"],
  };
  for (const [stepName, [action, selector]] of Object.entries(phase3cDeno)) {
    const step = named[stepName];
    // The step inventory carries name/uses/if; the exact `with: deno-version`
    // pair lives only in the source, so both are checked. A selector that
    // drifted without its action would otherwise pass here.
    const exactBlock = `      - name: ${stepName}\n        if: always() && matrix.tertiaryDeno == '${selector}'\n        uses: ${action}\n        with:\n          deno-version: ${selector}\n`;
    if (step?.uses !== action || step?.if !== `always() && matrix.tertiaryDeno == '${selector}'`
        || !resolvedMatrixSource.includes(exactBlock)) {
      fail(errors, `Phase 3C Deno runtime selector drifted: ${stepName}`);
    }
  }
  // [#2439 SC-7.2] Setup ORDER is part of the profile. Exactly two mutually
  // exclusive setup-node steps exist, one before the Deno selectors and one
  // after, and a host takes exactly one of them.
  const phase3cNodeFirst = named["Select tertiary Node runtime before Deno"];
  const phase3cDenoFirst = named["Select tertiary Node runtime after Deno"];
  const phase3cSetup = named["Execute one typed Phase 3C setup"];
  const phase3cRun = named["Run assigned Phase 3C suites with exact attribution"];
  const phase3cUpload = named["Upload Phase 3C suite results"];
  if (phase3cNodeFirst?.uses !== PINNED_SETUP_NODE
      || phase3cNodeFirst?.if !== "always() && matrix.tertiaryClass != '' && matrix.tertiaryOrder == 'node-first'"
      || phase3cDenoFirst?.uses !== PINNED_SETUP_NODE
      || phase3cDenoFirst?.if !== "always() && matrix.tertiaryClass != '' && matrix.tertiaryOrder == 'deno-first'"
      || phase3cSetup?.run !== 'node .github/scripts/ci-batch/run-suite-batch.mjs --setup "${{ matrix.tertiaryClass }}"'
      || phase3cSetup?.timeoutMinutes !== 5
      || phase3cRun?.run !== 'node .github/scripts/ci-batch/run-suite-batch.mjs --run-phase3c-host "${{ matrix.class }}"'
      || phase3cUpload?.if !== "always() && matrix.tertiaryClass != ''") {
    fail(errors, "Phase 3C tertiary setup/run/upload protocol drifted");
  }
  // The node-first step must precede every Deno selector and the deno-first step
  // must follow them, or the matrix field would name an order the file does not
  // actually implement.
  const stepNames = (batchTopology.steps || []).map((step) => step.name);
  const firstDeno = stepNames.findIndex((name) => name?.startsWith("Select immutable Phase 3C Deno"));
  const lastDeno = stepNames.reduce((last, name, index) => (name?.startsWith("Select immutable Phase 3C Deno") ? index : last), -1);
  const beforeIndex = stepNames.indexOf("Select tertiary Node runtime before Deno");
  const afterIndex = stepNames.indexOf("Select tertiary Node runtime after Deno");
  if (firstDeno < 0 || beforeIndex < 0 || afterIndex < 0 || beforeIndex > firstDeno || afterIndex < lastDeno) {
    fail(errors, "Phase 3C tertiary setup ORDER does not match the reviewed per-class profile");
  }
  if (!resolvedMatrixSource.includes("name: suite-results-phase3c-${{ matrix.class }}")
      || !resolvedMatrixSource.includes("path: suite-results-phase3c.json")) fail(errors, "Phase 3C result artifact identity/path contract drifted");
  const matrixRoutes = new Map();
  for (const route of batchTopology.matrix || []) {
    if (!route.class || matrixRoutes.has(route.class)) fail(errors, `duplicate or empty ci-batch matrix class: ${route.class || "<empty>"}`);
    else matrixRoutes.set(route.class, route);
  }
  if (batchTopology.setupNode?.action !== PINNED_SETUP_NODE || batchTopology.setupNode?.nodeVersion !== "${{ matrix.node }}") {
    fail(errors, "ci-batch setup-node route must use the reviewed pinned action with node-version from matrix.node");
  }

  const profileOwners = new Map();
  const profileEntries = Object.entries(manifest.setupProfiles || {});
  for (const [name, profile] of profileEntries) {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      fail(errors, `setup profile ${name} must be an object`);
      continue;
    }
    const expectedKeys = "installs" in profile
      ? ["phase3b-lifecycle-node20-deno2", "phase3c-deno2x-app-node22"].includes(name)
        ? ["runtime", "installs", "toolExposures", "classes"] : ["runtime", "installs", "classes"]
      : ["runtime", "install", "classes"];
    if (!sameStrings(Object.keys(profile), expectedKeys)) fail(errors, `setup profile ${name} has a malformed or unknown field`);
    const nodeRuntime = profile.runtime?.name === "node" && ["20", "22", "20.19.4"].includes(profile.runtime?.version)
      && sameStrings(Object.keys(profile.runtime || {}), ["name", "version"]);
    // [#2439 SC-7.3] The action SHA is immutable in every row. The runtime
    // selector may float exactly where the audited origin floated (v2.x) and no
    // further; v2.7.14 is an exact selector and must NOT fold into the v2.x row.
    const denoRuntime = profile.runtime?.name === "node+deno" && ["20", "22"].includes(profile.runtime?.nodeVersion)
      && [["1.46.x", "denoland/setup-deno@11b63cf76cfcafb4e43f97b6cad24d8e8438f62d"],
        ["v2.x", "denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed"],
        ["v2.7.14", "denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed"]]
        .some(([version, action]) => profile.runtime?.deno?.version === version && profile.runtime?.deno?.action === action);
    if (!nodeRuntime && !denoRuntime) {
      fail(errors, `setup profile ${name} must use an approved exact Node runtime schema`);
    }
    const profileClasses = strings(profile.classes) ? profile.classes : [];
    if (profileClasses.length === 0 || new Set(profileClasses).size !== profileClasses.length) {
      fail(errors, `setup profile ${name} must own a non-empty unique class list`);
    }
    for (const klass of profileClasses) {
      if (!profileOwners.has(klass)) profileOwners.set(klass, []);
      profileOwners.get(klass).push(name);
    }
    const installs = profileInstallList(profile);
    if (profile.install !== null || "installs" in profile) {
      // [#2439 SC-8.2] Three of the six Phase 3C classes install nothing: their
      // suites rely on the host's ambient Node for .mjs gates and on the typed
      // Deno runtime for everything else. An empty ordered array is the honest
      // representation; only a Phase 3C profile may use it.
      const mayBeEmpty = name.startsWith("phase3c-");
      if ("installs" in profile && (!Array.isArray(profile.installs) || (profile.installs.length === 0 && !mayBeEmpty))) fail(errors, `setup profile ${name} installs must be a non-empty ordered array`);
      for (const [installIndex, install] of installs.entries()) {
      const phase3bInstall = typeof install?.id === "string" && /^setup:phase3[bc]-/.test(install.id);
      if (!install || typeof install !== "object" || !sameStrings(Object.keys(install), phase3bInstall ? ["id", "cwd", "invocation"] : ["cwd", "invocation"])) {
        fail(errors, `setup profile ${name} install must use the exact typed schema`);
      }
      try { canonicalInstallIdentity(name, profile, installIndex); }
      catch { fail(errors, `setup profile ${name} install cwd is noncanonical: ${install?.cwd}`); }
      if (!fs.existsSync(path.join(root, install.cwd))) {
        fail(errors, `setup profile ${name} install cwd does not exist: ${install?.cwd}`);
      }
      const invocation = install?.invocation;
      const approvedArgv = [["ci"], ["ci", "--ignore-scripts"], ["install", "--no-save", "yaml"],
        ["install", "--no-save", "--package-lock=false", "react-test-renderer@19.1.0"],
        ["install", "--no-save", "react-test-renderer@19.1.0"]];
      if (invocation?.kind !== "argv" || invocation.command !== "npm" || !sameStrings(Object.keys(invocation || {}), ["kind", "command", "argv"])
          || !approvedArgv.some((argv) => JSON.stringify(argv) === JSON.stringify(invocation.argv))) {
        fail(errors, `setup profile ${name} install is not one of the exact approved typed npm invocations`);
      }
      }
    }
  }
  for (const klass of manifest.executionClasses || []) {
    const owners = profileOwners.get(klass) || [];
    if (owners.length !== 1) fail(errors, `class ${klass} must have exactly one setup profile owner, got ${owners.length}`);
  }
  for (const klass of profileOwners.keys()) {
    if (!manifest.executionClasses?.includes(klass)) fail(errors, `setup profile owns stale or unknown class ${klass}`);
  }
  for (const [klass, route] of matrixRoutes) {
    const ownerName = profileOwners.get(klass)?.[0];
    const profile = manifest.setupProfiles?.[ownerName];
    if (!profile) continue;
    if (route.node !== profile.runtime?.version) fail(errors, `class ${klass}: matrix runtime ${route.node} disagrees with setup profile runtime ${profile.runtime?.version}`);
    const expectsCache = profileInstallList(profile).some((install) => install.invocation.argv[0] === "ci") && profileInstallList(profile).length === 1;
    if ((expectsCache ? "npm" : "") !== route.cache) fail(errors, `class ${klass}: matrix cache route disagrees with exact setup profile`);
  }

  const suiteIds = new Set();
  const suiteOrigins = new Map();
  const selectedProfiles = new Set();
  const suitesById = new Map();
  const capabilityRegistry = manifest.commandCapabilities;
  const capabilityCommands = capabilityRegistry?.commands || [];
  const capabilityRegistryDigest = crypto.createHash("sha256").update(JSON.stringify(capabilityCommands)).digest("hex");
  const preservedPhase2Digest = crypto.createHash("sha256").update(JSON.stringify(capabilityCommands.slice(0, 51))).digest("hex");
  if (capabilityRegistry?.schemaVersion !== 1 || capabilityRegistry?.expectedCommands !== 240
      || capabilityCommands.length !== 240 || capabilityRegistry?.registrySha256 !== LOCKED_SHADOW_CAPABILITY_SHA256
      || capabilityRegistryDigest !== capabilityRegistry?.registrySha256) {
    fail(errors, "the 240 assertion command capabilities must equal the locked Phase 1 + Phase 3A + Phase 3B + Phase 3C registry");
  }
  if (preservedPhase2Digest !== LOCKED_ASSERTION_CAPABILITY_SHA256) fail(errors, "the current-main 51 Phase 2 assertion capabilities changed");
  const capabilitiesById = new Map();
  for (const capability of capabilityCommands) {
    if (!capability.id || capabilitiesById.has(capability.id)) fail(errors, `duplicate or empty command capability: ${capability.id || "<empty>"}`);
    else capabilitiesById.set(capability.id, capability);
  }
  const claimedCapabilities = new Set();
  for (const suite of manifest.suites || []) {
    if (!suite.id || suiteIds.has(suite.id)) fail(errors, `duplicate or empty suite id: ${suite.id || "<empty>"}`);
    suiteIds.add(suite.id);
    suitesById.set(suite.id, suite);
    if (!["batched-active", "shadow-active", "batched-historical"].includes(suite.lifecycle)) fail(errors, `${suite.id}: lifecycle must be batched-active, shadow-active, or batched-historical`);
    if (!manifest.executionClasses?.includes(suite.class)) fail(errors, `${suite.id}: unknown class ${suite.class}`);
    if (!suite.setupProfile || !manifest.setupProfiles?.[suite.setupProfile]) fail(errors, `${suite.id}: unknown setupProfile ${suite.setupProfile}`);
    else selectedProfiles.add(suite.setupProfile);
    const ownedClass = isMigratedSuite(suite) ? suite.executionClass : suite.class;
    if (manifest.setupProfiles?.[suite.setupProfile]?.classes?.includes(ownedClass) !== true) {
      fail(errors, `${suite.id}: setupProfile ${suite.setupProfile} does not route execution class ${ownedClass}`);
    }
    if (!suiteOrigins.has(suite.origin)) suiteOrigins.set(suite.origin, []);
    suiteOrigins.get(suite.origin).push(suite);
    const originIsLive = fs.existsSync(path.join(root, suite.origin || ""));
    if (suite.lifecycle === "batched-active" && originIsLive) fail(errors, `${suite.id}: origin is live and batched (duplicate provider): ${suite.origin}`);
    if (suite.lifecycle === "shadow-active" && !originIsLive) fail(errors, `${suite.id}: shadow origin must remain live: ${suite.origin}`);
    if (suite.lifecycle === "batched-historical" && originIsLive) fail(errors, `${suite.id}: terminal origin wrapper must be absent: ${suite.origin}`);
    // The lane predicate is only safe if a migrated record is complete: an
    // executionClass without a wave or a host would route into a lane nothing
    // reconciles. Fail closed rather than let a half-migrated record through.
    if (isMigratedSuite(suite) && (!suite.migrationWave || !suite.hostClass)) {
      fail(errors, `${suite.id}: a migrated suite must declare migrationWave and hostClass`);
    }
    if (!isMigratedSuite(suite) && suite.hostClass) {
      fail(errors, `${suite.id}: a primary suite must not declare a hostClass`);
    }
    const phase3b = suite.migrationWave === PHASE3B_WAVE;
    const phase3c = suite.migrationWave === PHASE3C_WAVE;
    // Phase 3B and Phase 3C share one reviewed typed-capability boundary:
    // reviewed-shell-v1 invocations, env/compound-bearing payload digests, a
    // full runtime object, and leaf-aware expected-file derivation.
    const phase3 = phase3b || phase3c;
    if (!phase3 && (suite.runtime?.name !== "node" || !["20", "22", "20.19.4"].includes(suite.runtime?.version))) fail(errors, `${suite.id}: runtime must use an approved exact Node version`);
    const profileRuntime = manifest.setupProfiles?.[suite.setupProfile]?.runtime;
    const matrixRuntime = matrixRoutes.get(suite.class)?.node;
    if ((!phase3 && (suite.runtime?.name !== profileRuntime?.name || suite.runtime?.version !== profileRuntime?.version || suite.runtime?.version !== matrixRuntime))
        || (phase3 && (JSON.stringify(suite.runtime) !== JSON.stringify(profileRuntime) || suite.class !== suite.hostClass || !matrixRoutes.has(suite.hostClass)))) {
      fail(errors, `${suite.id}: suite, setup profile, and matrix runtime must agree exactly`);
    }
    if (!suite.ownerIssue || !/^#\d+$/.test(suite.ownerIssue)) fail(errors, `${suite.id}: ownerIssue must be an issue token`);
    if (!suite.cwd || !fs.existsSync(path.join(root, suite.cwd))) fail(errors, `${suite.id}: cwd does not exist: ${suite.cwd}`);
    if (!suite.requiredContext?.trim()) fail(errors, `${suite.id}: requiredContext classification is missing`);
    if (!phase3 && !suite.exceptionRationale?.includes("Raw shell")) fail(errors, `${suite.id}: suite raw-shell exception is missing`);
    if (!suite.timingSeconds || !("p50" in suite.timingSeconds) || !("p95" in suite.timingSeconds)) fail(errors, `${suite.id}: p50/p95 timing classification is missing`);
    for (const key of ["envNames", "expectedFiles", "originPaths", "externalReferenceFiles", "generatedPaths"]) {
      if (!strings(suite[key])) fail(errors, `${suite.id}: ${key} must be a string array`);
    }
    if (suite.expectedFiles?.length === 0) fail(errors, `${suite.id}: expectedFiles cannot be empty`);
    for (const expected of suite.expectedFiles || []) {
      if (!fs.existsSync(path.join(root, expected))) fail(errors, `${suite.id}: expected file is missing: ${expected}`);
    }
    if (!Array.isArray(suite.steps) || suite.steps.length === 0) fail(errors, `${suite.id}: missing execution steps`);
    for (const [index, step] of (suite.steps || []).entries()) {
      if (!step.run?.trim()) fail(errors, `${suite.id}: step ${index} has an empty compatibility command`);
      const invocation = step.invocation;
      const expectedKind = phase3 ? "reviewed-shell-v1" : "raw-shell";
      if (invocation?.kind !== expectedKind || invocation.command !== "bash" || !strings(invocation.argv) || invocation.argv.length !== 2 || invocation.argv[0] !== "-c" || invocation.argv[1] !== step.run) {
        fail(errors, `${suite.id}: step ${index} typed invocation must be bash [-c, exact legacy command]`);
      }
      if (!phase3 && !step.exceptionRationale?.includes("legacy workflow")) fail(errors, `${suite.id}: step ${index} raw-shell exception is not explicit`);
      const expectedCommandId = `assert:${suite.id}:${String(index + 1).padStart(2, "0")}`;
      const capability = capabilitiesById.get(step.commandId);
      if (step.commandId !== expectedCommandId || !capability) {
        fail(errors, `${suite.id}: step ${index} has no stable assertion command capability`);
      } else {
        claimedCapabilities.add(capability.id);
        const payload = phase3 ? { cwd: step.cwd || ".", executable: invocation.command, argv: invocation.argv, env: step.env || null, compound: Boolean(step.children) }
          : { cwd: step.cwd || ".", executable: invocation.command, argv: invocation.argv };
        const payloadSha256 = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
        if (capability.suiteId !== suite.id || capability.stepIndex !== index || capability.cwd !== payload.cwd
            || capability.executable !== payload.executable || JSON.stringify(capability.argv) !== JSON.stringify(payload.argv)
            || capability.payloadSha256 !== payloadSha256) {
          fail(errors, `${suite.id}: step ${index} differs from its immutable executable/argv capability`);
        }
      }
    }
    const derivedExpectedFiles = discoverExpectedFilesForSuite(suite, root);
    const registeredExpectedFiles = phase3
      ? [...new Set([...(suite.expectedFiles || []), ...(suite.conditionalExpectedFiles || []).filter((file) => fs.existsSync(path.join(root, file)))])].sort()
      : suite.expectedFiles;
    if (JSON.stringify(registeredExpectedFiles) !== JSON.stringify(derivedExpectedFiles)) {
      fail(errors, `${suite.id}: expectedFiles must exactly equal files selected by the preserved typed command`);
    }
  }
  const waveSuites = (manifest.suites || []).filter((suite) => suite.migrationWave === PHASE3A_WAVE);
  const waveLifecycle = new Set(waveSuites.map((suite) => suite.lifecycle));
  if (waveSuites.length !== 32 || waveLifecycle.size !== 1) {
    fail(errors, `Phase 3 wave must contain exactly 32 variants in one atomic lifecycle, got ${waveSuites.length} across ${waveLifecycle.size} lifecycle(s)`);
  }
  for (const [origin, owners] of suiteOrigins) {
    const expected = path.basename(origin) === "issue-994-ota-env-resolution.yml" ? 2 : 1;
    if (owners.length !== expected) fail(errors, `${origin}: expected exactly ${expected} executable variant(s), got ${owners.length}`);
    const waveOwners = owners.filter((suite) => suite.migrationWave === PHASE3A_WAVE);
    if (waveOwners.length) {
      const variants = waveOwners.map((suite) => suite.originVariant).sort();
      const expectedVariants = expected === 2 ? ["app-mobile", "mingla-business"] : ["default"];
      if (JSON.stringify(variants) !== JSON.stringify(expectedVariants)) fail(errors, `${origin}: originVariant mapping drifted`);
    }
    for (const suite of waveOwners) {
      const metadata = suite.lifecycle === "shadow-active" ? inspect(path.basename(origin)) : null;
      if (!suite.shadowContract || (metadata && suite.shadowContract.workflowSha256 !== metadata.sourceSha256)
          || suite.shadowContract.variant !== suite.originVariant) fail(errors, `${suite.id}: immutable wave contract no longer matches its reviewed variant`);
    }
  }
  const calculatedShadowDigest = crypto.createHash("sha256").update(JSON.stringify(waveSuites.map((suite) => ({
    id: suite.id, origin: suite.origin, originVariant: suite.originVariant, shadowContract: suite.shadowContract,
  })))).digest("hex");
  if (manifest.shadowContractSha256 !== LOCKED_SHADOW_CONTRACT_SHA256 || calculatedShadowDigest !== LOCKED_SHADOW_CONTRACT_SHA256) {
    fail(errors, "the exact 32-variant shadow command/setup/options/trigger contract drifted");
  }
  const phase3bSuites = (manifest.suites || []).filter((suite) => suite.migrationWave === PHASE3B_WAVE);
  const phase3bLifecycles = new Set(phase3bSuites.map((suite) => suite.lifecycle));
  // [#2438 SC-13] Phase 3B is atomic in EITHER reviewed lifecycle. A mixed wave
  // stays red, and no third form is accepted.
  const phase3bLifecycle = phase3bLifecycles.size === 1 ? [...phase3bLifecycles][0] : null;
  const phase3bTerminal = phase3bLifecycle === PHASE3B_TERMINAL_LIFECYCLE;
  if (phase3bSuites.length !== 12 || !PHASE3B_ATOMIC_LIFECYCLES.has(phase3bLifecycle)) {
    fail(errors, `Phase 3B must contain exactly 12 suites in one atomic ${[...PHASE3B_ATOMIC_LIFECYCLES].join(" or ")} lifecycle`);
  }
  if (phase3bSuites.reduce((sum, suite) => sum + suite.steps.length, 0) !== 36) fail(errors, "Phase 3B must own exactly 36 outer assertions");
  for (const suite of phase3bSuites) {
    // [#2438 SC-13/SC-17] Follow the reviewed Phase 3A pattern above: never read a
    // wrapper the lifecycle says is gone, and never dereference a missing one.
    // At shadow the wrapper must be LIVE and match the frozen shadowContract; at
    // terminal it must be ABSENT (a restored wrapper is the error) and the
    // trigger/concurrency/source digests are validated from the frozen registry
    // shadowContract, which the locked Phase 3B contract digest below seals.
    const wrapperName = path.basename(suite.origin);
    const wrapperPresent = fs.existsSync(path.join(root, ".github/workflows", wrapperName));
    const triggerPaths = [...new Set([...(suite.triggerContract?.push?.paths || []), ...(suite.triggerContract?.pullRequest?.paths || [])])].sort();
    const triggerEvents = [suite.triggerContract?.push && "push", suite.triggerContract?.pullRequest && "pull_request"].filter(Boolean).sort();
    const triggerDigest = crypto.createHash("sha256").update(JSON.stringify(suite.triggerContract)).digest("hex");
    if (phase3bTerminal) {
      if (wrapperPresent) {
        fail(errors, `${suite.id}: terminal wrapper ${wrapperName} must be absent`);
        continue;
      }
      if (triggerPaths.length === 0 || triggerEvents.length === 0
          || suite.triggerContract?.concurrency == null
          || suite.shadowContract?.triggerSha256 !== triggerDigest
          || !/^[0-9a-f]{64}$/.test(String(suite.shadowContract?.workflowSha256))) {
        fail(errors, `${suite.id}: exact trigger/concurrency/wrapper terminal contract drifted`);
      }
      continue;
    }
    if (!wrapperPresent) {
      fail(errors, `${suite.id}: shadow wrapper ${wrapperName} must remain live until cutover`);
      continue;
    }
    const metadata = inspect(wrapperName);
    if (!metadata) {
      fail(errors, `${suite.id}: shadow wrapper ${wrapperName} could not be inspected`);
      continue;
    }
    if (JSON.stringify(triggerPaths) !== JSON.stringify(metadata.pathScope)
        || JSON.stringify(triggerEvents) !== JSON.stringify(metadata.triggers)
        || JSON.stringify(suite.triggerContract?.concurrency) !== JSON.stringify(metadata.phase3bConcurrency)
        || suite.shadowContract?.triggerSha256 !== triggerDigest
        || suite.shadowContract?.workflowSha256 !== metadata.sourceSha256) {
      fail(errors, `${suite.id}: exact trigger/concurrency/wrapper shadow contract drifted`);
    }
  }
  const phase3bContractDigest = crypto.createHash("sha256").update(JSON.stringify(phase3bSuites.map((suite) => ({
    id: suite.id, origin: suite.origin, hostClass: suite.hostClass, executionClass: suite.executionClass,
    runtime: suite.runtime, setupProfile: suite.setupProfile, timeoutSeconds: suite.timeoutSeconds,
    triggerContract: suite.triggerContract, shadowContract: suite.shadowContract,
  })))).digest("hex");
  if (manifest.phase3bContractSha256 !== LOCKED_PHASE3B_CONTRACT_SHA256 || phase3bContractDigest !== LOCKED_PHASE3B_CONTRACT_SHA256) {
    fail(errors, "Phase 3B exact host/runtime/setup/timeout/trigger shadow contract drifted");
  }
  if (crypto.createHash("sha256").update(JSON.stringify(capabilityCommands.slice(51, 158))).digest("hex") !== "3cdccc5cb491f7a642ffa2a49f450d6f7ed5b37450d1f18a1fe219d5c629e709") {
    fail(errors, "Phase 3A 107-command capability digest changed");
  }

  // ==========================================================================
  // [#2439] Phase 3C - the seventeen Deno origins.
  //
  // Every number below is COUNTED from the merged tree and compared against the
  // reviewed contract; none is copied from a sibling wave. The wave-scoped
  // selectors are deliberate (SC-17.1): selecting by lifecycle value rather than
  // by wave is what let three #2438 governance tests auto-pass at shadow and go
  // wrong the moment another wave reached terminal.
  // ==========================================================================
  const phase3cSuites = (manifest.suites || []).filter((suite) => suite.migrationWave === PHASE3C_WAVE);
  const phase3cLifecycles = new Set(phase3cSuites.map((suite) => suite.lifecycle));
  const phase3cLifecycle = phase3cLifecycles.size === 1 ? [...phase3cLifecycles][0] : null;
  const phase3cTerminal = phase3cLifecycle === PHASE3B_TERMINAL_LIFECYCLE;
  if (phase3cSuites.length !== PHASE3C_SUITE_COUNT || !PHASE3C_ATOMIC_LIFECYCLES.has(phase3cLifecycle)) {
    fail(errors, `Phase 3C must contain exactly ${PHASE3C_SUITE_COUNT} suites in one atomic ${[...PHASE3C_ATOMIC_LIFECYCLES].join(" or ")} lifecycle`);
  }
  const phase3cOuterCount = phase3cSuites.reduce((sum, suite) => sum + suite.steps.length, 0);
  if (phase3cOuterCount !== PHASE3C_OUTER_COUNT) fail(errors, `Phase 3C must own exactly ${PHASE3C_OUTER_COUNT} outer assertions, counted ${phase3cOuterCount}`);
  for (const suite of phase3cSuites) {
    if (!PHASE3C_WRAPPER_SET.has(path.basename(suite.origin || ""))) fail(errors, `${suite.id}: origin is outside the exact Phase 3C candidate list`);
    if (manifest.phase3cHostMap?.[suite.id] !== suite.hostClass) fail(errors, `${suite.id}: Phase 3C host map disagrees with the suite host class`);
    const wrapperName = path.basename(suite.origin);
    const wrapperPresent = fs.existsSync(path.join(root, ".github/workflows", wrapperName));
    const triggerDigest = crypto.createHash("sha256").update(JSON.stringify(suite.triggerContract)).digest("hex");
    if (phase3cTerminal) {
      if (wrapperPresent) { fail(errors, `${suite.id}: terminal wrapper ${wrapperName} must be absent`); continue; }
      if (suite.shadowContract?.triggerSha256 !== triggerDigest || !/^[0-9a-f]{64}$/.test(String(suite.shadowContract?.workflowSha256))) {
        fail(errors, `${suite.id}: exact trigger/wrapper terminal contract drifted`);
      }
      continue;
    }
    if (!wrapperPresent) { fail(errors, `${suite.id}: shadow wrapper ${wrapperName} must remain live until cutover`); continue; }
    const metadata = inspect(wrapperName);
    if (!metadata) { fail(errors, `${suite.id}: shadow wrapper ${wrapperName} could not be inspected`); continue; }
    // [#2439 SC-9] Provenance is preserved exactly as audited: the union of the
    // push and pull_request path lists must equal the wrapper's own path scope,
    // the declared events must match, and the marker-stripped source digest must
    // equal the frozen shadow contract.
    const triggerPaths = [...new Set([...(suite.triggerContract?.push?.paths || []), ...(suite.triggerContract?.pullRequest?.paths || [])])].sort();
    const triggerEvents = [suite.triggerContract?.push && "push", suite.triggerContract?.pullRequest && "pull_request",
      suite.triggerContract?.workflowDispatch && "workflow_dispatch"].filter(Boolean).sort();
    if (JSON.stringify(triggerPaths) !== JSON.stringify(metadata.pathScope)
        || JSON.stringify(triggerEvents) !== JSON.stringify(metadata.triggers)
        || JSON.stringify(suite.triggerContract?.concurrency) !== JSON.stringify(metadata.phase3bConcurrency)
        || JSON.stringify(suite.triggerContract?.permissions) !== JSON.stringify(metadata.trustBoundary?.permissions)
        || suite.shadowContract?.triggerSha256 !== triggerDigest
        || suite.shadowContract?.workflowSha256 !== metadata.sourceSha256) {
      fail(errors, `${suite.id}: exact trigger/concurrency/permission/wrapper shadow contract drifted`);
    }
  }
  // [#2439 SC-21] The seal is RECONSTRUCTED at terminal, never re-pinned.
  //
  // `lifecycle` is inside this digest on purpose: at shadow it binds the wave's
  // lifecycle into the same seal that binds host, runtime, setup, timeout and
  // trigger, so none of them can move independently. Cutover flips all
  // seventeen at once, which necessarily moves the raw digest — and pinning a
  // SECOND literal for the terminal value would be a constant nobody can
  // re-derive, exactly the fragility the provider-authority block below already
  // rejects. So terminal normalises the wave-uniform lifecycle back to the
  // shadow value and checks the ONE frozen seal, on both sides of cutover.
  //
  // This loses nothing: a partial flip cannot reach here at all. The atomicity
  // check above requires all seventeen to hold ONE lifecycle before
  // `phase3cLifecycle` is even defined, so the value substituted below is the
  // wave's single agreed lifecycle and never a mixture.
  const phase3cSealedLifecycle = phase3cTerminal ? PHASE3B_SHADOW_LIFECYCLE : phase3cLifecycle;
  const phase3cContractDigest = crypto.createHash("sha256").update(JSON.stringify(phase3cSuites.map((suite) => ({
    id: suite.id, origin: suite.origin, lifecycle: phase3cSealedLifecycle, executionClass: suite.executionClass,
    hostClass: suite.hostClass, timeoutSeconds: suite.timeoutSeconds, shadowContract: suite.shadowContract,
  })))).digest("hex");
  if (manifest.phase3cContractSha256 !== LOCKED_PHASE3C_CONTRACT_SHA256 || phase3cContractDigest !== LOCKED_PHASE3C_CONTRACT_SHA256) {
    fail(errors, "Phase 3C exact host/runtime/setup/timeout/trigger shadow contract drifted");
  }

  // ---- Phase 3C leaf registry: 54 leaves, three typed predicate kinds -------
  const phase3cLeafRegistry = manifest.phase3cLeafCapabilities;
  const phase3cLeaves = phase3cLeafRegistry?.leaves || [];
  const phase3cSuiteIds = new Set(phase3cSuites.map((suite) => suite.id));
  const declaredLeaves = phase3cSuites.flatMap((suite) => suite.steps.flatMap((step) => step.children || []));
  const requiredFilePredicates = phase3cLeaves.reduce((sum, leaf) => sum + (leaf.predicate?.kind === "file-exists" ? (leaf.predicate.paths || []).length : 0), 0);
  if (phase3cLeafRegistry?.schemaVersion !== 1 || phase3cLeafRegistry?.expectedLeaves !== PHASE3C_LEAF_COUNT
      || phase3cLeaves.length !== PHASE3C_LEAF_COUNT || declaredLeaves.length !== PHASE3C_LEAF_COUNT
      || requiredFilePredicates !== PHASE3C_FILE_EXISTS_PREDICATES
      || phase3cLeafRegistry?.currentRequiredFilePredicates !== PHASE3C_FILE_EXISTS_PREDICATES
      || crypto.createHash("sha256").update(JSON.stringify(phase3cLeaves)).digest("hex") !== phase3cLeafRegistry?.registrySha256) {
    fail(errors, `Phase 3C leaf registry must equal ${PHASE3C_LEAF_COUNT} leaves carrying ${PHASE3C_FILE_EXISTS_PREDICATES} required-file predicates, got ${phase3cLeaves.length}/${requiredFilePredicates}`);
  }
  const phase3cLeafIds = new Set();
  for (const leaf of phase3cLeaves) {
    if (!leaf.id || phase3cLeafIds.has(leaf.id)) fail(errors, `duplicate or empty Phase 3C leaf capability: ${leaf.id || "<empty>"}`);
    phase3cLeafIds.add(leaf.id);
    if (!capabilitiesById.has(leaf.outerCommandId) || !phase3cSuiteIds.has(leaf.suiteId)) fail(errors, `${leaf.id}: leaf ownership is stale`);
    const kind = leaf.predicate?.kind;
    if (!["always", "file-exists", "source-contract"].includes(kind)) fail(errors, `${leaf.id}: unsupported leaf predicate`);
    if (kind === "always" && (leaf.executable !== "bash" || !strings(leaf.argv) || leaf.argv.length !== 2 || leaf.argv[0] !== "-c")) {
      fail(errors, `${leaf.id}: command leaf must be bash [-c, exact command]`);
    }
    // A typed predicate leaf carries NO shell at all. That is the whole point:
    // the runner evaluates it and names the exact failing target, where the
    // origin's own `test -f` / `grep -q` would have to be re-parsed to do so.
    if (kind !== "always" && (leaf.executable !== null || leaf.argv !== null)) fail(errors, `${leaf.id}: typed predicate leaf must carry no shell invocation`);
    if (kind === "file-exists") {
      const owner = phase3cSuites.find((suite) => suite.id === leaf.suiteId);
      if (!strings(leaf.predicate.paths) || leaf.predicate.paths.length === 0) fail(errors, `${leaf.id}: required-file predicate must name at least one target`);
      for (const target of leaf.predicate.paths || []) {
        if (!owner?.expectedFiles?.includes(target)) fail(errors, `${leaf.id}: required file is not registered in expectedFiles: ${target}`);
      }
    }
    if (kind === "source-contract") {
      const owner = phase3cSuites.find((suite) => suite.id === leaf.suiteId);
      if (!["must-contain", "must-not-contain"].includes(leaf.predicate.sense)
          || typeof leaf.predicate.needle !== "string" || !leaf.predicate.needle
          || typeof leaf.predicate.path !== "string" || !owner?.expectedFiles?.includes(leaf.predicate.path)) {
        fail(errors, `${leaf.id}: source-contract predicate must name a registered target, a literal needle and an explicit sense`);
      }
    }
    const payload = { cwd: leaf.cwd, executable: leaf.executable, argv: leaf.argv, env: leaf.env, predicate: leaf.predicate };
    if (crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex") !== leaf.payloadSha256) fail(errors, `${leaf.id}: immutable leaf payload drifted`);
  }
  if (JSON.stringify(declaredLeaves.map((leaf) => leaf.id)) !== JSON.stringify(phase3cLeaves.map((leaf) => leaf.id))) {
    fail(errors, "Phase 3C leaf registry order must equal the registry's own declared leaf order");
  }
  // The suite-side child and the capability entry are TWO copies of one fact.
  // Comparing only ids leaves the suite side free to drift - a predicate path
  // could be deleted from the suite while the sealed registry kept reporting
  // eleven. Bind the whole payload in both directions.
  const phase3cLeavesById = new Map(phase3cLeaves.map((leaf) => [leaf.id, leaf]));
  for (const suite of phase3cSuites) {
    suite.steps.forEach((step, outerIndex) => {
      (step.children || []).forEach((child, leafIndex) => {
        const registered = phase3cLeavesById.get(child.id);
        if (!registered) { fail(errors, `${child.id}: declared leaf has no capability entry`); return; }
        const declaredPayload = { cwd: child.cwd || ".", executable: child.invocation?.command ?? null,
          argv: child.invocation?.argv ?? null, env: child.env || null, predicate: child.predicate };
        const registeredPayload = { cwd: registered.cwd, executable: registered.executable,
          argv: registered.argv, env: registered.env, predicate: registered.predicate };
        if (JSON.stringify(declaredPayload) !== JSON.stringify(registeredPayload)
            || registered.outerCommandId !== step.commandId || registered.suiteId !== suite.id
            || registered.outerIndex !== outerIndex || registered.leafIndex !== leafIndex) {
          fail(errors, `${child.id}: declared leaf differs from its immutable leaf capability`);
        }
      });
    });
  }
  // [#2439 SC-5.2] Exactly three source-contract predicates, all on #1465, and
  // the third is the INVERTED one. Its sense is pinned by name: an inverted
  // sense would assert the opposite of its purpose while staying green.
  const sourceContracts = phase3cLeaves.filter((leaf) => leaf.predicate?.kind === "source-contract");
  const expectedSourceContracts = [
    ["issue-1465-permitted-staff-authoring-pipeline-tests", "biz_brand_effective_rank", "must-contain"],
    ["issue-1465-permitted-staff-authoring-pipeline-tests", "RANK_EVENT_MANAGER = 40", "must-contain"],
    ["issue-1465-permitted-staff-authoring-pipeline-tests", "brand.account_id !== userId", "must-not-contain"],
  ];
  if (JSON.stringify(sourceContracts.map((leaf) => [leaf.suiteId, leaf.predicate.needle, leaf.predicate.sense])) !== JSON.stringify(expectedSourceContracts)
      || phase3cLeafRegistry?.currentSourceContractPredicates !== expectedSourceContracts.length) {
    fail(errors, "Phase 3C source-contract predicates must be the exact three reviewed #1465 assertions with their audited senses");
  }
  // [#2439 SC-4] The bounded retry is a typed field on exactly the two #1326
  // steps that carried the shell loop, and nowhere else. Collapsing it to one
  // attempt is a weakening; a retry on any other step is an invention.
  const retryOwners = phase3cSuites.flatMap((suite) => suite.steps
    .filter((step) => step.retry !== undefined)
    .map((step) => [step.commandId, step.retry?.attempts, step.retry?.backoffSeconds]));
  if (JSON.stringify(retryOwners) !== JSON.stringify([
    ["assert:issue-1326-ng-reservation-finalize-tests:01", 3, 10],
    ["assert:issue-1326-ng-reservation-finalize-tests:02", 3, 10],
  ])) fail(errors, "Phase 3C bounded retry must be the exact two reviewed #1326 steps at 3 attempts / 10s backoff");
  for (const [, attempts, backoff] of retryOwners) {
    if (!Number.isInteger(attempts) || attempts !== 3 || !Number.isInteger(backoff) || backoff !== 10) {
      fail(errors, "Phase 3C retry schema rejects any attempts value other than 3 and any non-integer backoff");
    }
  }
  // [#2439 SC-6.1] Typed env has exactly the two reviewed #1326 owners.
  const phase3cEnvOwners = phase3cSuites.flatMap((suite) => suite.steps.filter((step) => step.env).map((step) => `${step.commandId}:${JSON.stringify(step.env)}`));
  if (JSON.stringify(phase3cEnvOwners) !== JSON.stringify(PHASE3C_AUTHORISED_ENV.map((env, index) =>
    `assert:issue-1326-ng-reservation-finalize-tests:0${index + 1}:${JSON.stringify(env)}`))) {
    fail(errors, "Phase 3C typed env must have the sole exact #1326 owners with the audited inert literals");
  }
  // [#2439 SC-8.2] Six new execution classes, each with exactly one setup
  // profile, and exactly three installs across the whole wave.
  const phase3cClasses = [...new Set(phase3cSuites.map((suite) => suite.executionClass))].sort();
  if (phase3cClasses.length > 7 || phase3cClasses.some((klass) => !klass.startsWith("phase3c-"))) {
    fail(errors, `Phase 3C may introduce at most 7 reviewed execution classes, got ${phase3cClasses.length}`);
  }
  // [PR #2546 follow-up] TWO quantities, derived from two different sources.
  // Conflating them is what let a broken suite hide behind a green-looking count:
  //   originInstallSteps       - `npm ci` steps in the seventeen ORIGIN workflows.
  //   profileInstallExecutions - dependency trees the reviewed setup profiles
  //                              materialise, which is larger whenever a suite
  //                              needs a tool its own package tree lacks.
  // #1902 has the same shape: one origin install step, two profile installs plus
  // a typed jest exposure, because app-mobile declares no jest at all.
  const phase3cProfileInstalls = phase3cClasses.reduce((sum, klass) => sum + profileInstallList(manifest.setupProfiles?.[klass]).length, 0);
  const phase3cOriginInstallSteps = PHASE3C_INSTALL_COUNT;
  if (phase3cProfileInstalls < phase3cOriginInstallSteps) {
    fail(errors, `Phase 3C profiles materialise ${phase3cProfileInstalls} trees, fewer than the ${phase3cOriginInstallSteps} the origins install`);
  }
  // A tool exposure's provider AND consumer must both be installed by the same
  // profile, or the link target cannot exist when the suite runs.
  for (const klass of phase3cClasses) {
    const profile = manifest.setupProfiles?.[klass];
    const installedCwds = new Set(profileInstallList(profile).map((install) => install.cwd));
    for (const exposure of profile?.toolExposures || []) {
      if (!installedCwds.has(exposure.providerCwd) || !installedCwds.has(exposure.consumerCwd)) {
        fail(errors, `${klass}: tool exposure ${exposure.id} needs both ${exposure.providerCwd} and ${exposure.consumerCwd} installed by this profile`);
      }
    }
  }
  // A leaf that invokes `npx <tool>` in a cwd whose package tree cannot resolve
  // that tool MUST have a typed exposure providing it. The absence of this check
  // is what let `npx jest` in app-mobile reach CI and exit 1 while every
  // assertion in the suite passed.
  for (const suite of phase3cSuites) {
    const profile = manifest.setupProfiles?.[suite.executionClass];
    const exposed = new Set((profile?.toolExposures || []).map((exposure) => `${exposure.consumerCwd}::${exposure.executableName}`));
    for (const step of suite.steps) {
      for (const child of step.children || []) {
        const match = (child.invocation?.argv?.[1] || "").match(/^npx\s+([A-Za-z0-9@._-]+)/);
        if (!match) continue;
        const cwd = child.cwd || step.cwd || ".";
        const lockPath = path.join(root, cwd, "package-lock.json");
        const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, "utf8")) : null;
        if (!lock?.packages?.[`node_modules/${match[1]}`] && !exposed.has(`${cwd}::${match[1]}`)) {
          fail(errors, `${child.id}: npx ${match[1]} cannot resolve in ${cwd} and no typed tool exposure provides it`);
        }
      }
    }
  }
  // [#2439 SC-11.4] The wave header is DERIVED, then compared. A typed header
  // over a differently-shaped wave stays red.
  const phase3cWaveContract = manifest.migrationWaves?.[PHASE3C_WAVE];
  const expectedPhase3cWave = { suiteCount: phase3cSuites.length, outerCommandCount: phase3cOuterCount,
    maximumLeafCount: phase3cLeaves.length, originInstallSteps: phase3cOriginInstallSteps,
    profileInstallExecutions: phase3cProfileInstalls, fileExistsPredicateCount: requiredFilePredicates,
    lifecycle: phase3cTerminal ? PHASE3B_TERMINAL_LIFECYCLE : PHASE3B_SHADOW_LIFECYCLE };
  if (JSON.stringify(phase3cWaveContract) !== JSON.stringify(expectedPhase3cWave)) fail(errors, "Phase 3C wave count contract drifted");
  // [#2439 SC-11.5] Seven provider records transition; the other ten must not
  // gain one. Membership is derived from the registry, never typed here.
  const phase3cProviderRecords = (manifest.workflowProviders || []).filter((item) => PHASE3C_WRAPPER_SET.has(item.workflow));
  if (phase3cProviderRecords.length !== PHASE3C_PROVIDER_NAMES.size
      || phase3cProviderRecords.some((item) => !PHASE3C_PROVIDER_NAMES.has(item.workflow))) {
    fail(errors, `Phase 3C must hold exactly the ${PHASE3C_PROVIDER_NAMES.size} reviewed provider records, got ${phase3cProviderRecords.length}`);
  }
  for (const item of phase3cProviderRecords) {
    const expectedTransition = phase3cTerminal ? "batched-provider" : "retained-live-provider";
    if (item.transition !== expectedTransition) fail(errors, `${item.workflow}: provider transition must be ${expectedTransition} at this lifecycle`);
  }
  const leafRegistry = manifest.phase3bLeafCapabilities;
  const leaves = leafRegistry?.leaves || [];
  if (leafRegistry?.schemaVersion !== 1 || leafRegistry?.expectedLeaves !== 40 || leaves.length !== 40
      || leafRegistry?.currentExecutedLeaves !== 40 || leafRegistry?.currentAbsentLeaves !== 0
      || crypto.createHash("sha256").update(JSON.stringify(leaves)).digest("hex") !== leafRegistry?.registrySha256) {
    fail(errors, "Phase 3B leaf registry must equal 40 maximum / current 40 executed + 0 absent");
  }
  const leafIds = new Set();
  for (const leaf of leaves) {
    if (!leaf.id || leafIds.has(leaf.id)) fail(errors, `duplicate or empty leaf capability: ${leaf.id || "<empty>"}`);
    leafIds.add(leaf.id);
    if (!capabilitiesById.has(leaf.outerCommandId) || !phase3bSuites.some((suite) => suite.id === leaf.suiteId)) fail(errors, `${leaf.id}: leaf ownership is stale`);
    if (!["always", "file-exists"].includes(leaf.predicate?.kind)) fail(errors, `${leaf.id}: unsupported leaf predicate`);
    if (leaf.predicate?.kind === "file-exists" && !phase3bSuites.find((suite) => suite.id === leaf.suiteId)?.conditionalExpectedFiles?.includes(leaf.predicate.path)) fail(errors, `${leaf.id}: conditional proof is not registered`);
    const payload = { cwd: leaf.cwd, executable: leaf.executable, argv: leaf.argv, env: leaf.env, predicate: leaf.predicate };
    if (crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex") !== leaf.payloadSha256) fail(errors, `${leaf.id}: immutable leaf payload drifted`);
  }
  const compound = phase3bSuites.flatMap((suite) => suite.steps.filter((step) => step.children));
  if (compound.length !== 2 || compound.map((step) => step.children.length).sort().join(",") !== "2,4") fail(errors, "Phase 3B must retain the exact two compound outers with 2 and 4 leaves");
  const envOwners = phase3bSuites.flatMap((suite) => suite.steps.filter((step) => step.env).map((step) => `${suite.id}:${step.commandId}:${JSON.stringify(step.env)}`));
  if (JSON.stringify(envOwners) !== JSON.stringify(["issue-1902-public-event-lifecycle-tests:assert:issue-1902-public-event-lifecycle-tests:03:{\"NODE_PATH\":\"./node_modules\"}"])) {
    fail(errors, "Phase 3B typed env must have the sole exact #1902 Business Jest owner");
  }
  const lifecycleSetup = manifest.setupProfiles?.["phase3b-lifecycle-node20-deno2"];
  const setupShape = (lifecycleSetup?.installs || []).map((install) => ({ id: install.id, cwd: install.cwd, command: install.invocation?.command, argv: install.invocation?.argv }));
  if (JSON.stringify(setupShape) !== JSON.stringify([
    { id: "setup:phase3b-lifecycle-node20-deno2:01", cwd: "mingla-business", command: "npm", argv: ["ci"] },
    { id: "setup:phase3b-lifecycle-node20-deno2:02", cwd: "app-mobile", command: "npm", argv: ["ci"] },
  ])) fail(errors, "#1902 setup must be one setup with two exact ordered installs");
  const exposure = lifecycleSetup?.toolExposures;
  const exactExposure = [{
    id: "tool:phase3b-lifecycle-node20-deno2:jest-29.7.0", providerCwd: "mingla-business", consumerCwd: "app-mobile",
    packageName: "jest", executableName: "jest", version: "29.7.0",
    providerPackage: "mingla-business/node_modules/jest/package.json", providerExecutable: "mingla-business/node_modules/jest/bin/jest.js",
    consumerPackageLink: "app-mobile/node_modules/jest", consumerPackageLinkTarget: "../../mingla-business/node_modules/jest",
    consumerBinLink: "app-mobile/node_modules/.bin/jest", consumerBinLinkTarget: "../jest/bin/jest.js",
    authorityLock: "mingla-business/package-lock.json", authorityKey: "node_modules/jest",
  }];
  if (JSON.stringify(exposure) !== JSON.stringify(exactExposure)
      || crypto.createHash("sha256").update(JSON.stringify(exposure)).digest("hex") !== "08d4e3d37b2c5a45805b110cfb9e20fc100d05f065a34ce46ef5b56444bee1ef") {
    fail(errors, "#1902 typed Jest 29.7.0 exposure contract drifted");
  }
  const packageAuthorities = {
    "app-mobile/package.json": "2e167f8c716e80e9baf53dd2b2ba14833afd3a3da48f19718442672bbd0ce6a2",
    "app-mobile/package-lock.json": "80d18eae58c8e0a81c7e858730caaaae7294e767a27b078ffae2c6d2a2786624",
    "mingla-business/package.json": "61ddd3137b3cc5542f9d58b28edd0a4f1cd6479a9212d99b8067025a03547601",
    "mingla-business/package-lock.json": "6725babece1c8c2aab52d3d66dae35de0a45088e4a240560d7f4eb8317ee6513",
  };
  for (const [relative, expected] of Object.entries(packageAuthorities)) {
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex");
    if (actual !== expected) fail(errors, `#1902 package authority drifted: ${relative}`);
  }
  const primaryVector = Object.fromEntries((manifest.classes || []).map((klass) => [klass,
    manifest.suites.filter((suite) => suite.class === klass && isPrimarySuite(suite)).length]));
  const expectedPrimaryVector = { "admin-node20-install":2, "app-node22-install":6, "business-node20-1":2, "business-node20-2":3,
    "business-node20-3":5, "business-node20-4":5, "business-node22-ignore-scripts":3, "cross-root-node22-ignore-scripts":1,
    "node20-19-noinstall":1, "node20-noinstall":14, "node22-noinstall":10, "ota-app-node20-19-install":1,
    "ota-business-node20-19-install":1, "root-node20-yaml-no-save":1 };
  if (JSON.stringify(Object.entries(primaryVector).sort()) !== JSON.stringify(Object.entries(expectedPrimaryVector).sort())
      || Object.values(primaryVector).reduce((sum, count) => sum + count, 0) !== 55) fail(errors, "primary lane must retain exactly the frozen 55-suite host vector");
  // Derived, not positional: `slice(158)` meant "the migrated waves" only while
  // Phase 3B was the last block in the array. Select the capabilities owned by
  // migrated suites and the check keeps meaning what it says as waves are added.
  const migratedSuiteIds = new Set((manifest.suites || []).filter(isMigratedSuite).map((suite) => suite.id));
  if (capabilityCommands.filter((capability) => migratedSuiteIds.has(capability.suiteId))
    .some((capability) => capability.argv?.[1]?.trim?.() === "npm ci")) {
    fail(errors, "setup/install leaked into a migrated wave's assertion capabilities");
  }
  if (manifest.executionClasses?.length !== 29 || manifest.classes?.length !== 14) fail(errors, "topology must remain 14 matrix hosts / 29 execution classes");
  const waveContract = manifest.migrationWaves?.[PHASE3B_WAVE];
  // [#2438 SC-13] Exactly two accepted forms — the shadow contract and the
  // terminal contract — and the wave header must agree with the suites' own
  // atomic lifecycle, so a terminal wave header over shadow suites stays red.
  const expectedWaveContract = { suiteCount: 12, outerCommandCount: 36, maximumLeafCount: 40, currentExecutedLeaves: 40,
    currentAbsentLeaves: 0, lifecycle: phase3bTerminal ? PHASE3B_TERMINAL_LIFECYCLE : PHASE3B_SHADOW_LIFECYCLE };
  if (JSON.stringify(waveContract) !== JSON.stringify(expectedWaveContract)) {
    fail(errors, "Phase 3B wave count contract drifted");
  }
  for (const capability of capabilityCommands) {
    if (!claimedCapabilities.has(capability.id)) fail(errors, `stale unclaimed command capability: ${capability.id}`);
  }

  for (const [name] of profileEntries) if (!selectedProfiles.has(name)) fail(errors, `stale setup profile is not selected by any suite: ${name}`);

  const matrixClasses = new Set(matrixRoutes.keys());
  for (const klass of manifest.classes || []) {
    if (!matrixClasses.has(klass)) fail(errors, `class ${klass} has no ci-batch matrix route`);
  }
  for (const klass of matrixClasses) {
    if (!manifest.classes?.includes(klass)) fail(errors, `ci-batch matrix class ${klass} is absent from registry`);
  }

  const legacy = manifest.legacyOrigins || [];
  if (!Array.isArray(legacy) || legacy.length !== 200) fail(errors, "legacyOrigins must contain exactly the amended 200 origins");
  const legacyKeys = new Set();
  const suiteClaims = new Map();
  for (const item of legacy) {
    const key = `${item.stem}.${item.extension}`;
    if (!item.stem || !["yml", "yaml"].includes(item.extension)) fail(errors, `invalid legacy origin identity: ${key}`);
    if (legacyKeys.has(key)) fail(errors, `duplicate legacy origin: ${key}`);
    legacyKeys.add(key);
    if (!ALLOWED_DISPOSITIONS.has(item.disposition)) fail(errors, `${key}: unknown disposition ${item.disposition}`);
    if (!item.ownerIssue || !/^#\d+$/.test(item.ownerIssue)) fail(errors, `${key}: missing ownerIssue`);
    if (!item.rationale?.trim()) fail(errors, `${key}: missing disposition rationale`);
    const replacements = item.disposition === "batched-active" ? [item.replacementSuite] : item.replacementSuites;
    if (["batched-active", "shadow-active", "batched-historical"].includes(item.disposition)) {
      const expectedClaims = key === "issue-994-ota-env-resolution.yml" ? 2 : 1;
      if (!strings(replacements) || replacements.length !== expectedClaims || new Set(replacements).size !== replacements.length) {
        fail(errors, `${key}: expected exactly ${expectedClaims} unique replacement suite claim(s)`);
      }
      for (const replacement of replacements || []) {
        const suite = suitesById.get(replacement);
        if (!suite) fail(errors, `${key}: missing active replacement suite ${replacement}`);
        else {
          suiteClaims.set(suite.id, (suiteClaims.get(suite.id) || 0) + 1);
          if (path.basename(suite.origin || "") !== key) fail(errors, `${key}: replacement suite ${suite.id} owns ${path.basename(suite.origin || "<empty>")}, not this origin`);
          if (suite.ownerIssue !== item.ownerIssue) fail(errors, `${key}: replacement suite ${suite.id} ownerIssue does not match legacy ownerIssue`);
        }
      }
    }
    if (item.disposition === "shadow-active") {
      if (item.providerWorkflow !== `.github/workflows/${key}` || !fs.existsSync(path.join(root, item.providerWorkflow || ""))) {
        fail(errors, `${key}: shadow stage must keep the exact historical workflow live`);
      }
      const expectedMetadata = inspect(key);
      if (JSON.stringify(item.workflowMetadata) !== JSON.stringify(expectedMetadata)) fail(errors, `${key}: shadow runtime/setup/trust/trigger inventory drifted`);
    } else if (item.disposition === "batched-historical") {
      if (item.providerWorkflow !== ".github/workflows/ci-batch.yml" || fs.existsSync(path.join(root, `.github/workflows/${key}`))) {
        fail(errors, `${key}: cutover requires the historical wrapper absent and the batch provider exact`);
      }
    } else if (item.disposition === "consolidated-provider") {
      // [#2591] Both halves are load-bearing and they fail for different reasons.
      // The origin file must be ABSENT — otherwise this disposition is being used
      // to skip the metadata-drift check on a file that is still live. The named
      // provider must EXIST and must not be the origin's own path — otherwise a
      // deleted lane could claim itself as its own provider and the consolidation
      // would be unfalsifiable.
      if (fs.existsSync(path.join(root, `.github/workflows/${key}`))) {
        fail(errors, `${key}: consolidated origin must be absent — its lane moved to ${item.providerWorkflow}`);
      }
      if (!item.providerWorkflow || item.providerWorkflow === `.github/workflows/${key}`) {
        fail(errors, `${key}: consolidated origin must name a provider workflow other than itself`);
      } else if (!fs.existsSync(path.join(root, item.providerWorkflow))) {
        fail(errors, `${key}: consolidated provider workflow is missing: ${item.providerWorkflow}`);
      }
      // The deleted lane's own trigger paths, captured from its YAML at the
      // cutover commit. G-9 in the provider workflow checks that the consolidated
      // trigger union is a SUPERSET of every one of these; the files are gone, so
      // this record is the only surviving subject that check has. An entry that
      // lost it, or emptied it, would make G-9 pass by having nothing to compare —
      // so it is refused here rather than left to read as a green check.
      const recorded = item.consolidatedTriggerPaths;
      for (const event of ["pull_request", "push"]) {
        if (!strings(recorded?.[event]) || recorded[event].length === 0) {
          fail(errors, `${key}: consolidated origin must record its on.${event} trigger paths — without them the provider's superset guard has nothing to check`);
        }
      }
    } else if (item.disposition !== "batched-active") {
      if (item.providerWorkflow !== `.github/workflows/${key}`) fail(errors, `${key}: live origin must name its sole provider workflow`);
      if (!fs.existsSync(path.join(root, item.providerWorkflow || ""))) fail(errors, `${key}: live provider workflow is missing`);
      const expectedMetadata = inspect(key);
      if (JSON.stringify(item.workflowMetadata) !== JSON.stringify(expectedMetadata)) fail(errors, `${key}: runtime/setup/trust/trigger inventory drifted`);
    }
  }
  for (const suite of manifest.suites || []) {
    const claims = suiteClaims.get(suite.id) || 0;
    if (claims !== 1) fail(errors, `${suite.id}: executable suite must be claimed by exactly one batched legacy origin, got ${claims}`);
  }
  const expectedOriginKeys = new Set(liveOrigins ?? discoverLiveOrigins(root));
  for (const suite of manifest.suites || []) expectedOriginKeys.add(path.basename(suite.origin));
  // [#2591] A consolidated origin's file is deleted, so discoverLiveOrigins can
  // never see it, exactly as a batched-historical origin is admitted via
  // suite.origin above. Without this the nine trip `stale or invented origin in
  // registry` — the entry is neither stale nor invented, it is re-dispositioned.
  // Only entries the branch above has already validated reach here, so this
  // cannot admit a key whose provider is missing or whose file is still live.
  for (const item of manifest.legacyOrigins || []) {
    if (item.disposition === "consolidated-provider") expectedOriginKeys.add(`${item.stem}.${item.extension}`);
  }
  for (const key of expectedOriginKeys) if (!legacyKeys.has(key)) fail(errors, `origin omitted from registry: ${key}`);
  for (const key of legacyKeys) if (!expectedOriginKeys.has(key)) fail(errors, `stale or invented origin in registry: ${key}`);

  const discoveredProviders = workflowProviders ?? discoverWorkflowProviders(root);
  if (workflowProviders == null) {
    let referenceNormalizedProviders = discoveredProviders;
    try {
      referenceNormalizedProviders = normalizeProviderReferenceFilesForSeal(discoveredProviders);
    } catch (error) {
      fail(errors, `provider reference delta normalization failed: ${error.message}`);
    }
    // [#2591] Subtract the declared additions before the seal is computed. Each
    // must be PRESENT and BYTE-EQUAL to its declaration; anything else is RED.
    const declaredAdditions = new Map(PROVIDERS_ADDED_SINCE_SEAL.map((item) => [item.workflow, item]));
    const declaredSeen = new Set();
    const sealedDiscovery = [];
    for (const item of referenceNormalizedProviders) {
      const declared = declaredAdditions.get(item.workflow);
      if (!declared) { sealedDiscovery.push(item); continue; }
      declaredSeen.add(item.workflow);
      if (JSON.stringify(item.referenceFiles) !== JSON.stringify([...declared.referenceFiles])) {
        fail(errors, `declared provider addition ${declared.workflow} (#${declared.issue}) has drifted: discovery reports ${JSON.stringify(item.referenceFiles)}, the declaration in PROVIDERS_ADDED_SINCE_SEAL says ${JSON.stringify([...declared.referenceFiles])}. The seal subtracts declared additions by exact content, never by name.`);
      }
    }
    for (const declared of PROVIDERS_ADDED_SINCE_SEAL) {
      if (declaredSeen.has(declared.workflow)) continue;
      fail(errors, `declared provider addition ${declared.workflow} (#${declared.issue}) was NOT FOUND in discovery. Either the workflow or the sources that reference it are gone, or discovery is being served from a cache — a blind memo reporting the pre-addition world looks exactly like this, and that is why the seal subtracts a declared set instead of being re-frozen.`);
    }
    const discoveryDigest = crypto.createHash("sha256").update(JSON.stringify(sealedDiscovery)).digest("hex");
    const phase3bProviders = sealedDiscovery.filter((item) => PHASE3B_PROVIDER_NAMES.has(item.workflow));
    const phase3bDigest = crypto.createHash("sha256").update(JSON.stringify(phase3bProviders)).digest("hex");
    // [#2438 SC-13] The authority expectation follows the wave's own atomic
    // lifecycle, and there is exactly ONE frozen seal on both sides of it:
    // LOCKED_PROVIDER_DISCOVERY_SHA256, the 73-record shadow authority.
    //
    // At SHADOW the twelve wrappers are live, so discovery must reproduce that
    // seal directly and its Phase 3B subset must be the frozen six.
    //
    // At TERMINAL the twelve wrappers are deleted, so discovery can no longer
    // see the six Phase 3B records at all. There is deliberately NO frozen
    // terminal digest: a second literal would be a constant nobody can
    // re-derive, and locking one is the fragility this contract already
    // rejected elsewhere. Instead the shadow authority is RECONSTRUCTED at
    // runtime — what terminal discovery still sees, plus the six records the
    // registry carries for the deleted wrappers, re-sorted exactly as discovery
    // sorts — and that reconstruction is checked against the one frozen seal.
    // Deleting the twelve wrappers is the only way discovery can change here,
    // because .github/workflows/** is excluded from the scan, so no other
    // record's referenceFiles can move; if anything else drifted, the
    // reconstruction cannot hash back to the seal and this fails closed.
    //
    // [#2439 SC-18.2(6)] Phase 3C extends the SAME reconstruction, one wave
    // more. Its seventeen wrappers carry SEVEN of these records, so terminal
    // discovery drops 67 -> 60 — MEASURED here from the tree, never predicted
    // and never pinned. `workflowNames` above is read from the live directory,
    // so once a wrapper file is gone no source text anywhere can put its record
    // back; the seven are re-added from the registry exactly as the six Phase 3B
    // ones are, and the union still has to hash to the single frozen
    // 73-record shadow authority. There is still exactly ONE seal in this file.
    if (phase3bTerminal) {
      if (phase3bProviders.length !== 0) {
        fail(errors, `Phase 3B provider authority drifted: terminal wrappers are deleted and must contribute no provider record, got ${phase3bProviders.length}`);
      }
      const phase3cDiscoveredProviders = sealedDiscovery.filter((item) => PHASE3C_PROVIDER_NAMES.has(item.workflow));
      const expectedPhase3cDiscovered = phase3cTerminal ? 0 : PHASE3C_PROVIDER_NAMES.size;
      if (phase3cDiscoveredProviders.length !== expectedPhase3cDiscovered) {
        fail(errors, `Phase 3C provider authority drifted: expected ${expectedPhase3cDiscovered} discovered provider records at this lifecycle, got ${phase3cDiscoveredProviders.length}`);
      }
      // [#2591] The SAME reconstruction, one mechanism more — and this one is a
      // REMOVAL, the mirror of PROVIDERS_ADDED_SINCE_SEAL. Deleting the nine
      // Postgres wrappers drops the two records that #1172 and #1840 still
      // contributed (their re-pointed tests name both the old wrapper and the new
      // capability workflow, and `workflowNames` is read from the live directory,
      // so the record dies with the file). MEASURED from the tree, 60 -> 58.
      //
      // The seal is NOT re-frozen. The two records are carried from the registry
      // exactly as Phase 3B's six and Phase 3C's seven are, and the union still
      // has to hash to the one frozen 73-record shadow authority. Carrying them
      // cannot launder a change: the content must be byte-identical to the sealed
      // world or the digest moves, and the disposition branch above has already
      // proved each one's wrapper is absent and its provider exists. There is
      // still exactly ONE seal in this file.
      const consolidatedProviderNames = new Set(
        (manifest.workflowProviders || [])
          .filter((item) => item.transition === "consolidated-provider")
          .map((item) => item.workflow),
      );
      const carriedNames = new Set([
        ...PHASE3B_PROVIDER_NAMES,
        ...(phase3cTerminal ? PHASE3C_PROVIDER_NAMES : []),
        ...consolidatedProviderNames,
      ]);
      const carriedPhase3bProviders = (manifest.workflowProviders || [])
        .filter((item) => carriedNames.has(item.workflow))
        .map((item) => ({ workflow: item.workflow, referenceFiles: item.referenceFiles }));
      const reconstructedShadow = [...sealedDiscovery, ...carriedPhase3bProviders]
        .sort((a, b) => a.workflow.localeCompare(b.workflow));
      const reconstructedDigest = crypto.createHash("sha256").update(JSON.stringify(reconstructedShadow)).digest("hex");
      if (carriedPhase3bProviders.length !== carriedNames.size
          || sealedDiscovery.length !== 73 - carriedNames.size
          || reconstructedShadow.length !== 73
          || reconstructedDigest !== LOCKED_PROVIDER_DISCOVERY_SHA256) {
        fail(errors, `workflow provider authority drifted: terminal discovery plus the ${carriedPhase3bProviders.length} carried records must reconstruct the frozen 73/${LOCKED_PROVIDER_DISCOVERY_SHA256}, got ${reconstructedShadow.length}/${reconstructedDigest} from ${sealedDiscovery.length} discovered (${discoveredProviders.length} before subtracting ${PROVIDERS_ADDED_SINCE_SEAL.length} declared addition(s))`);
      }
    } else {
      if (sealedDiscovery.length !== 73 || discoveryDigest !== LOCKED_PROVIDER_DISCOVERY_SHA256) {
        fail(errors, `workflow provider authority drifted: expected 73/${LOCKED_PROVIDER_DISCOVERY_SHA256}, got ${sealedDiscovery.length}/${discoveryDigest}`);
      }
      if (phase3bProviders.length !== 6 || phase3bDigest !== LOCKED_PHASE3B_PROVIDER_DISCOVERY_SHA256) {
        fail(errors, `Phase 3B provider authority drifted: expected 6/${LOCKED_PHASE3B_PROVIDER_DISCOVERY_SHA256}, got ${phase3bProviders.length}/${phase3bDigest}`);
      }
    }
  }
  const registeredProviders = manifest.workflowProviders || [];
  // [#2591] DERIVED from the one declared set, never hand-typed alongside it.
  const expectedProviderCount = 91 + PROVIDERS_ADDED_SINCE_SEAL.length;
  if (!Array.isArray(registeredProviders) || registeredProviders.length !== expectedProviderCount) fail(errors, `workflowProviders must contain exactly the amended 91 providers plus ${PROVIDERS_ADDED_SINCE_SEAL.length} declared addition(s) = ${expectedProviderCount}`);
  const providerKeys = new Set();
  const registeredByName = new Map();
  for (const item of registeredProviders) {
    if (!item.workflow || providerKeys.has(item.workflow)) fail(errors, `duplicate or empty workflow provider: ${item.workflow || "<empty>"}`);
    providerKeys.add(item.workflow);
    registeredByName.set(item.workflow, item);
    if (!["retained-live-provider", "batched-provider", "consolidated-provider"].includes(item.transition)) fail(errors, `${item.workflow}: unknown provider transition`);
    if (!strings(item.referenceFiles) || item.referenceFiles.length === 0) fail(errors, `${item.workflow}: referenceFiles must be non-empty`);
    for (const ref of item.referenceFiles || []) if (!fs.existsSync(path.join(root, ref))) fail(errors, `${item.workflow}: stale reference file ${ref}`);
    if (item.transition === "retained-live-provider") {
      if (item.providerWorkflow !== `.github/workflows/${item.workflow}` || !fs.existsSync(path.join(root, item.providerWorkflow))) {
        fail(errors, `${item.workflow}: retained provider must remain the exact live historical wrapper`);
      }
    } else if (item.transition === "consolidated-provider") {
      // [#2591] Mirror of the legacyOrigins disposition. The wrapper is deleted,
      // so discovery drops this record; the record survives here because the seal
      // reconstruction below carries it. Same two-sided check: the wrapper must
      // be gone and the provider must be a different, existing workflow.
      if (fs.existsSync(path.join(root, `.github/workflows/${item.workflow}`))) {
        fail(errors, `${item.workflow}: consolidated provider requires the historical wrapper absent`);
      }
      if (!item.providerWorkflow || item.providerWorkflow === `.github/workflows/${item.workflow}`
          || !fs.existsSync(path.join(root, item.providerWorkflow))) {
        fail(errors, `${item.workflow}: consolidated provider must name a different, existing provider workflow`);
      }
    } else {
      if (item.providerWorkflow !== ".github/workflows/ci-batch.yml" || fs.existsSync(path.join(root, `.github/workflows/${item.workflow}`))) {
        fail(errors, `${item.workflow}: batched provider requires exact batch provider and absent historical wrapper`);
      }
    }
  }
  for (const discovered of discoveredProviders) {
    const registered = registeredByName.get(discovered.workflow);
    if (!registered) fail(errors, `externally referenced workflow provider omitted: ${discovered.workflow}`);
    else if (JSON.stringify(registered.referenceFiles) !== JSON.stringify(discovered.referenceFiles)) {
      fail(errors, `${discovered.workflow}: external reference file inventory drifted`);
    }
  }
  for (const name of providerKeys) {
    const registration = registeredByName.get(name);
    if (registration.transition === "retained-live-provider" && !discoveredProviders.some((item) => item.workflow === name)) {
      // A `consolidated-provider` record is deliberately undiscoverable: its
      // wrapper is deleted, and the branch above already proved that. Only
      // `retained-live-provider` claims to be discoverable, so only it is swept.
      fail(errors, `stale external provider registration: ${name}`);
    }
  }

  return errors;
}

export function loadAndValidate(manifestPath = DEFAULT_MANIFEST, options = {}) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return { manifest, errors: validateRegistry(manifest, options) };
}

function main() {
  const manifestPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_MANIFEST;
  const { manifest, errors } = loadAndValidate(manifestPath);
  if (errors.length) {
    for (const error of errors) console.error(`::error::${error}`);
    console.error(`#2435 registry v2: FAIL (${errors.length} error(s))`);
    process.exit(1);
  }
  // Every figure below is COUNTED from the validated registry, never typed: a
  // printed literal is a number nobody re-derives, which is the class this
  // tranche keeps finding.
  const count = (wave) => manifest.suites.filter((suite) => suite.migrationWave === wave);
  const outers = (suites) => suites.reduce((sum, suite) => sum + suite.steps.length, 0);
  const phase1 = manifest.suites.filter((suite) => !suite.migrationWave);
  const a = count("phase3a-node-wave"); const b = count("phase3b-postgres-wave"); const c = count("phase3c-deno-wave");
  console.log(`Phase 1: ${phase1.length} suites / ${outers(phase1)} outer assertions`);
  console.log(`Phase 3A: ${a.length} suites / ${outers(a)} outer assertions`);
  console.log(`Phase 3B: ${b.length} suites / ${outers(b)} outer assertions / ${manifest.phase3bLeafCapabilities.expectedLeaves} maximum leaves / current ${manifest.phase3bLeafCapabilities.currentExecutedLeaves} executed + ${manifest.phase3bLeafCapabilities.currentAbsentLeaves} absent`);
  console.log(`Phase 3C: ${c.length} suites / ${outers(c)} outer assertions / ${manifest.phase3cLeafCapabilities.expectedLeaves} leaves / ${manifest.migrationWaves["phase3c-deno-wave"].originInstallSteps} origin installs / ${manifest.migrationWaves["phase3c-deno-wave"].profileInstallExecutions} materialised / ${manifest.phase3cLeafCapabilities.currentRequiredFilePredicates} required-file predicates (${manifest.migrationWaves["phase3c-deno-wave"].lifecycle})`);
  console.log(`Terminal: ${manifest.legacyOrigins.length} origins / ${manifest.suites.length} suites / ${outers(manifest.suites)} outer assertions / ${manifest.workflowProviders.length} providers`);
  console.log("#1902 setup: 1 setup execution / 2 ordered install executions");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
