// #2438 independent tester-owned reconstruction. CI-only; no runtime surface.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PHASE3B_SHADOW_MARKER,
  discoverLiveOrigins,
  discoverWorkflowProviders,
  PROVIDERS_ADDED_SINCE_SEAL,
  isNonAuthoritativeProviderEvidence,
  validateRegistry,
} from "../ci-batch/validate-manifest-v2.mjs";
import {
  normalizeDecision,
  parseNulPaths,
  parseOriginPattern,
  pathMatches,
  selectionDocument,
  validateDecision,
} from "../ci-batch/select-phase3b-suites.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const manifest = () => JSON.parse(read(".github/ci-batch/MANIFEST.json"));
const sha = (value) => crypto.createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const PARTIAL_REFERENCE_DELTAS = [{
  workflow: "issue-1486-dormant-render-suites.yml",
  referenceFiles: [".github/scripts/strict-grep/issue-2774-public-hero-accessibility.mjs"],
}];
const independentlyNormalizePartialReferences = (discovered, declarations = PARTIAL_REFERENCE_DELTAS) => {
  const normalized = structuredClone(discovered);
  for (const declaration of declarations) {
    const records = normalized.filter((item) => item.workflow === declaration.workflow);
    assert.equal(records.length, 1, `partial-reference workflow must appear once: ${declaration.workflow}`);
    assert.equal(new Set(declaration.referenceFiles).size, declaration.referenceFiles.length, "partial-reference declaration must not duplicate paths");
    const current = records[0].referenceFiles;
    assert.equal(new Set(current).size, current.length, "discovered provider references must not duplicate paths");
    for (const referenceFile of declaration.referenceFiles) {
      assert.equal(current.includes(referenceFile), true, `partial-reference declaration must exist: ${referenceFile}`);
    }
    records[0].referenceFiles = current.filter((item) => !declaration.referenceFiles.includes(item));
    assert.ok(records[0].referenceFiles.length > 0, "partial-reference normalization must preserve the historical record");
  }
  return normalized;
};
const WAVE = "phase3b-postgres-wave";
const independentErrors = (value) => {
  const errors = validateRegistry(value, { root: ROOT });
  for (const suite of value.suites.filter((item) => item.migrationWave === WAVE)) {
    const name = path.basename(suite.origin);
    // [#2438 SC-21] The wrapper source is deleted, so originPaths can no longer be
    // re-derived from YAML. Two terminal facts replace it, both RECOMPUTED here rather
    // than read: the wrapper must be ABSENT, and the registry's own triggerContract must
    // still hash to the frozen shadowContract seal it was sealed with at shadow.
    if (fs.existsSync(path.join(ROOT, ".github/workflows", name))) errors.push(`${name}: terminal wrapper must be absent`);
    if (sha(suite.triggerContract) !== suite.shadowContract?.triggerSha256) errors.push(`${name}: frozen trigger seal drift`);
    // originPaths is what the wave wakes on, and it is NOT inside triggerContract's hash
    // input, so the seal alone cannot see an edit to it. Close the chain: originPaths must
    // still equal the union of the sealed trigger paths, which the seal above pins.
    const sealedPaths = [...new Set([...(suite.triggerContract?.push?.paths || []), ...(suite.triggerContract?.pullRequest?.paths || [])])].sort();
    if (JSON.stringify([...suite.originPaths].sort()) !== JSON.stringify(sealedPaths)) errors.push(`${name}: originPaths drift`);
  }
  return errors;
};
const WRAPPERS = [
  ["issue-1022-theme-control-tests.yml", "f4d461a534e2d0a0273e9ea60957605a4f6e9f832229f74cf9f695445ff655df", 1, 2, 32, 900],
  ["issue-1461-venue-current-brand-race-tests.yml", "30bff6582d3d775133eb9c1ffc997b8985f24fc6985fec7585a2ba0f1ce88785", 1, 2, 5, 900],
  ["issue-1467-venue-submit-idempotency-tests.yml", "39c84667a17817587b4c1b66813b7a5d028e7ef33ec2bda47e04f1cc19763597", 1, 2, 8, 900],
  ["issue-1485-web-missing-chunk-404-tests.yml", "056e93d8b5e3f24a51c0ca874192607da05a90b43565293ee9318efb004d749b", 1, 1, 19, 900],
  ["issue-1685-venue-draft-multi-tests.yml", "b738a1749da6d5a22a440bf2c12c6d0a62bb97c7f9fc93b9a5f7bb5ea0056ab8", 1, 3, 10, 1200],
  ["issue-1902-public-event-lifecycle-tests.yml", "ee303de029f2ff1abe129f42c8fbbcefca17287bfa8536cc60ee7c1f10c8b900", 2, 11, 11, 900],
  ["issue-2013-ari-tenant-containment.yml", "ac59c3d6b732d34db7a5ddb4b03d407330d9916619812da7b49a339e9911601c", 1, 5, 16, 600],
  ["issue-679-brand-follow-tests.yml", "613f672bb1da1644a0de30695ea0dd5a4d24086c01dd0e9540e6e75dfb200e90", 1, 2, 13, 1200],
  ["issue-885-scanner-invite-loader-tests.yml", "931afbb3ca488138de1ed0b2c2f669f7d3359f66edf46cbaaa9651a1e6426a8b", 2, 2, 4, 900],
  ["issue-948-w1-enablers-tests.yml", "6cc978c1adb0635dfe2ed669745a2889d8e70a043c4ad88c581489753684bd66", 1, 2, 7, 900],
  ["issue-948-w3-screens-copy-tests.yml", "55a53aeece48e2c07a2915190c1a1c4861d24295518b537e1b07346000ca5e9f", 2, 3, 18, 900],
  ["orch-0976-draft-promotion-tests.yml", "74d7bc9877095f150b423373072bd7f4172428b1f0ed1df43f667c1600278ba1", 2, 1, 2, 720],
];

test("reconstructs source truth before trusting generated registry", () => {
  const value = manifest();
  const suites = value.suites.filter((suite) => suite.migrationWave === WAVE);
  assert.equal(suites.length, 12);
  let installs = 0, outers = 0;
  for (const [name, sourceHash, installCount, outerCount, pathCount, timeout] of WRAPPERS) {
    // [#2438 SC-21] The wrapper is deleted, so its bytes cannot be read and the marker
    // count cannot be taken. Absence is now the assertion the marker count used to make.
    // This WRAPPERS table is tester-owned evidence of what those bytes WERE at shadow;
    // binding it to the registry's own frozen seal is what stops the cutover quietly
    // rewriting history that can no longer be checked against a file.
    assert.equal(fs.existsSync(path.join(ROOT, ".github/workflows", name)), false, `${name} must be absent at terminal`);
    const suite = suites.find((item) => item.origin === `.github/workflows/${name}`);
    assert.ok(suite, name); assert.equal(suite.steps.length, outerCount); assert.equal(suite.timeoutSeconds, timeout);
    assert.equal(suite.shadowContract.workflowSha256, sourceHash, `${name} frozen source seal`);
    assert.equal(sha(suite.triggerContract), suite.shadowContract.triggerSha256, `${name} frozen trigger seal`);
    assert.equal(suite.originPaths.length, pathCount, `${name} trigger paths`);
    const profile = value.setupProfiles[suite.setupProfile]; assert.equal((profile.installs || (profile.install ? [profile.install] : [])).length, installCount);
    installs += installCount; outers += outerCount;
  }
  assert.deepEqual([installs, outers], [16, 36]);
  // [#2438 SC-21] SC-10's terminal counterpart: the markers left with the wrappers.
  const workflowDir = path.join(ROOT, ".github/workflows");
  const liveWorkflows = fs.readdirSync(workflowDir).filter((file) => /\.ya?ml$/.test(file));
  assert.equal(liveWorkflows.filter((file) => fs.readFileSync(path.join(workflowDir, file), "utf8").includes(PHASE3B_SHADOW_MARKER)).length, 0);
  assert.equal(liveWorkflows.some((file) => WRAPPERS.some(([name]) => name === file)), false);
  assert.equal(sha(fs.readFileSync(path.join(ROOT, ".github/workflows/issue-679-brand-follows-rls-proof.yml"))), "a2d6b6274bf7f52c9e84ad4bfb8c16d0fb549c30cf69475415426d2906adf7ad");
  assert.equal(suites.find((suite) => suite.origin.endsWith("issue-2013-ari-tenant-containment.yml")).originPaths.includes(".github/workflows/issue-2013-ari-tenant-containment.yml"), false);
  assert.match(read(".github/scripts/strict-grep/issue-2013-ari-tenant-containment.mjs"), /ci-batch|phase3b/i);
});

test("locks independent registry, leaf, setup, provider and lifecycle identities", () => {
  const value = manifest(); const suites = value.suites.filter((suite) => suite.migrationWave === WAVE);
  // [TEST-MOD-APPROVED #2591] Literal -> derivation. The provider totals are now
  // `<frozen> + PROVIDERS_ADDED_SINCE_SEAL.length`, read from the one declared set the
  // validator subtracts from the frozen provider seal. Subject and strength unchanged;
  // the number simply stops being typed in a second place where it can disagree.
  assert.deepEqual([value.legacyOrigins.length, value.suites.length, value.commandCapabilities.commands.length, value.workflowProviders.length], [200,84,240,91 + PROVIDERS_ADDED_SINCE_SEAL.length]);
  assert.deepEqual([suites.length, suites.flatMap((suite) => suite.steps).length, value.phase3bLeafCapabilities.leaves.length, value.phase3bLeafCapabilities.currentExecutedLeaves, value.phase3bLeafCapabilities.currentAbsentLeaves], [12,36,40,40,0]);
  assert.equal(sha(value.commandCapabilities.commands.slice(0,51)), "bb9c0e598a08ab91d8714ec2db80100c8b4d966d980a3cc290c3bcad93990a3f");
  assert.equal(sha(value.commandCapabilities.commands.slice(51,158)), "3cdccc5cb491f7a642ffa2a49f450d6f7ed5b37450d1f18a1fe219d5c629e709");
  assert.equal(sha(value.commandCapabilities.commands.slice(158,194)), "df9f09e2454fa05f7d74ae96517657a8582aff4c3ad742c6f2ab657cef179bc1");
  assert.equal(sha(value.phase3bLeafCapabilities.leaves), "76d627f1f117923c41dc2a4b928d606a134c2a3a0d948010e565828fa91be89d");
  assert.equal(new Set(suites.map((suite) => suite.lifecycle)).size, 1); assert.equal(suites[0].lifecycle, "batched-historical");
  // The flip is only atomic if the wave header moved with the suites, and the legacy
  // origins with both. A per-suite check alone cannot see a half-applied cutover.
  assert.equal(value.migrationWaves[WAVE].lifecycle, "batched-historical");
  assert.equal(value.legacyOrigins.filter((origin) => origin.migrationWave === WAVE && origin.disposition === "batched-historical").length, 12);
  const lifecycle = suites.find((suite) => suite.origin.endsWith("issue-1902-public-event-lifecycle-tests.yml"));
  assert.deepEqual(lifecycle.steps.map((step) => step.env || null).filter(Boolean), [{ NODE_PATH: "./node_modules" }]);
  assert.deepEqual(value.setupProfiles[lifecycle.setupProfile].installs.map((item) => [item.cwd,item.invocation.command,item.invocation.argv]), [["mingla-business","npm",["ci"]],["app-mobile","npm",["ci"]]]);
  // [#2439 SC-18.2(6)] The raw-discovery digest that stood here is DELETED, not re-pinned.
  // It drifted every wave — 71 at shadow, 73 after #2492, 67 after Phase 3B's cutover,
  // 60 after Phase 3C's — so as a literal it measured the calendar, not the contract, and
  // it went stale three times in three phases. "No second digest may be pinned anywhere."
  // The count stays exact, and the cryptographic weight moves entirely onto the
  // reconstruction below, which is checked against the ONE frozen shadow seal and does not
  // drift when a later wave retires more wrappers.
  // [TEST-MOD-APPROVED #2591] Literal -> derivation. The provider totals are now
  // `<frozen> + PROVIDERS_ADDED_SINCE_SEAL.length`, read from the one declared set the
  // validator subtracts from the frozen provider seal. Subject and strength unchanged;
  // the number simply stops being typed in a second place where it can disagree.
  // [TEST-MOD-APPROVED #2591 · cutover] The MIRROR of that addition: the nine
  // deleted Postgres wrappers take two discovery records with them, and the
  // registry carries them under `consolidated-provider`. Every term derived.
  const consolidatedCount = value.workflowProviders.filter((item) => item.transition === "consolidated-provider").length;
  const providers = discoverWorkflowProviders(ROOT); assert.equal(providers.length, 60 + PROVIDERS_ADDED_SINCE_SEAL.length - consolidatedCount);
  // [#2438 SC-21] The single-wrapper W3 assertion that stood here was removed under the
  // ruling at issue #2438 comment 5398524723. At shadow it was real: W3 was live and kept
  // out of discovery only by the A4-SC2 carve-out. At terminal it interrogates a deleted
  // file, so in the shipped state it has nothing to fail against, and the only way to make
  // it fail — restoring W3 — is caught identically and more broadly by the line below,
  // which subsumes it across all twelve. A check that reads as coverage without adding any
  // is noise, so it is gone rather than left in the guard written to catch that class.
  assert.equal(providers.filter((item) => WRAPPERS.some(([name]) => name === item.workflow)).length, 0);
  // The terminal authority is a RECONSTRUCTION, not a second frozen digest. Re-derive it
  // independently: what discovery still sees, plus the six records the registry carries
  // for the deleted wrappers, re-sorted as discovery sorts, must hash back to the one
  // locked shadow seal. A fabricated terminal digest cannot satisfy this.
  // [#2439] Phase 3C retired seventeen more wrappers, so the seal is now reconstructed
  // from BOTH retired waves. The carried set is DERIVED from the registry's own wave
  // membership rather than a second hard-coded name list, so the next wave extends it
  // without another literal going stale.
  const RETIRED_WAVES = ["phase3b-postgres-wave", "phase3c-deno-wave"];
  const carriedNames = new Set(value.suites
    .filter((suite) => RETIRED_WAVES.includes(suite.migrationWave))
    .map((suite) => suite.origin.split("/").pop()));
  assert.equal(carriedNames.size, 29);
  // [TEST-MOD-APPROVED #2591 · cutover] A record can leave discovery WITHOUT
  // belonging to a retired wave. The #2591 cutover deletes the nine Postgres
  // wrappers and the two records #1172 and #1840 contributed die with their files;
  // the registry carries them under `consolidated-provider` and the validator
  // reconstructs the frozen authority from them exactly as it does the waves'.
  // Derived from the registry's own transition, so it cannot go stale — and the
  // 29/13 wave literals above are untouched, which keeps the two mechanisms
  // separately falsifiable rather than folded into one moving number.
  const carriedConsolidated = value.workflowProviders
    .filter((item) => item.transition === "consolidated-provider")
    .map((item) => ({ workflow: item.workflow, referenceFiles: item.referenceFiles }));
  assert.equal(carriedConsolidated.length, 2);
  const carriedWave = value.workflowProviders
    .filter((item) => carriedNames.has(item.workflow))
    .map((item) => ({ workflow: item.workflow, referenceFiles: item.referenceFiles }));
  assert.equal(carriedWave.length, 13);
  // Pinned by IDENTITY for the same reason the Phase 3C seven are below: a swapped
  // record reds even when the count holds.
  assert.deepEqual(carriedConsolidated.map((item) => item.workflow).sort(),
    ["issue-1172-stripe-payout-execution-tests.yml", "issue-1840-ng-payout-float-alerts-tests.yml"]);
  const carried = [...carriedWave, ...carriedConsolidated];
  assert.equal(carried.length, 13 + carriedConsolidated.length);
  // The Phase 3B six keep their A4-SC3 locked subset digest, unchanged and still exact.
  const carriedPhase3b = carriedWave.filter((item) => WRAPPERS.some(([name]) => name === item.workflow));
  assert.equal(carriedPhase3b.length, 6);
  assert.equal(sha(carriedPhase3b), "1676cbe80860ee0181cf95fcbd70dcb95a9d535066161e25f11348212264abc1");
  // The Phase 3C seven are pinned by IDENTITY, not by a digest — SC-18.2(6) forbids a
  // second pinned digest, and identity is the stronger form here anyway: a swapped record
  // reds even if the count holds.
  assert.deepEqual(carriedWave.filter((item) => !WRAPPERS.some(([name]) => name === item.workflow))
    .map((item) => item.workflow).sort(),
    ["issue-1430-refund-replay-tests.yml", "issue-1437-secret-bundle-compatibility-tests.yml",
     "issue-1950-app-readiness-tests.yml", "issue-1999-ari-provider-schema-tests.yml",
     "issue-2019-ari-delegated-auth.yml", "issue-2230-consumer-multiday-tests.yml",
     "issue-2321-account-deletion-tests.yml"]);
  // [TEST-MOD-APPROVED #2591] The reconstruction MIRRORS the validator: providers
  // declared in PROVIDERS_ADDED_SINCE_SEAL are subtracted before the digest, so the
  // frozen 73/aac3d8cf… seal is unchanged and still asserted here at full strength.
  // Subtracting by exact content, not by name, is what keeps a drifted declaration
  // red; an undeclared new provider still lands in `sealed` and still breaks it.
  const declared = new Map(PROVIDERS_ADDED_SINCE_SEAL.map((item) => [item.workflow, JSON.stringify([...item.referenceFiles])]));
  const referenceNormalized = independentlyNormalizePartialReferences(providers);
  const sealed = referenceNormalized.filter((item) => declared.get(item.workflow) !== JSON.stringify(item.referenceFiles));
  assert.equal(referenceNormalized.length - sealed.length, PROVIDERS_ADDED_SINCE_SEAL.length,
    "every declared provider addition must be present in discovery and byte-equal to its declaration");
  const reconstructed = [...sealed, ...carried].sort((a, b) => a.workflow.localeCompare(b.workflow));
  assert.equal(reconstructed.length, 73);
  // #2725: Amendment 8 adds the PG17 competitor-budget workflow covered by this refreshed seal.
  assert.equal(sha(reconstructed), "c0813be9c105418cd60697b22be5ae5dbc2055b03895c2e5c77f68606a498a7f");

  const partial = PARTIAL_REFERENCE_DELTAS[0];
  const missing = structuredClone(providers);
  missing.find((item) => item.workflow === partial.workflow).referenceFiles = missing
    .find((item) => item.workflow === partial.workflow).referenceFiles
    .filter((item) => !partial.referenceFiles.includes(item));
  assert.throws(() => independentlyNormalizePartialReferences(missing), /must exist/,
    "missing reviewed partial reference must be RED");
  const undeclared = structuredClone(providers);
  undeclared.find((item) => item.workflow === partial.workflow).referenceFiles.push("undeclared/provider-reference.mjs");
  undeclared.find((item) => item.workflow === partial.workflow).referenceFiles.sort();
  const undeclaredNormalized = independentlyNormalizePartialReferences(undeclared);
  const undeclaredSealed = undeclaredNormalized.filter((item) => declared.get(item.workflow) !== JSON.stringify(item.referenceFiles));
  assert.notEqual(sha([...undeclaredSealed, ...carried].sort((a, b) => a.workflow.localeCompare(b.workflow))),
    "c0813be9c105418cd60697b22be5ae5dbc2055b03895c2e5c77f68606a498a7f",
    "undeclared partial reference must remain RED against the frozen seal");
  // [#2438 A9-SC3] Tighter than a straight substitution. A9-SC1 ratified TWO totals;
  // the amended line above pins only the first. discoverLiveOrigins() is the second and
  // nothing in this file pinned it, so half of A9-SC1 would have shipped untested.
  // [TEST-MOD-APPROVED #2591 · cutover] 117 -> 108. The nine consolidated origins
  // leave this inventory with their wrappers, exactly as a retired wave's do. The
  // subtrahend is READ from the registry rather than typed, so the ratified total
  // stays pinned and the number cannot be quietly adjusted until it passes.
  const consolidatedOriginCount = value.legacyOrigins.filter((item) => item.disposition === "consolidated-provider").length;
  assert.equal(consolidatedOriginCount, 9);
  assert.equal(discoverLiveOrigins(ROOT).length, 117 - consolidatedOriginCount);
  // The invariant #2492 actually violated: two workflows were externally REFERENCED but
  // never REGISTERED. A pair of totals cannot catch that — they both just move. Bind the
  // derived discovery set to the declared live-provider set by identity, so a referenced
  // but unregistered workflow reds here even when every count still agrees.
  const retained = value.workflowProviders.filter((item) => item.transition === "retained-live-provider");
  const batched = value.workflowProviders.filter((item) => item.transition === "batched-provider");
  // [TEST-MOD-APPROVED #2591] Literal -> derivation. The provider totals are now
  // `<frozen> + PROVIDERS_ADDED_SINCE_SEAL.length`, read from the one declared set the
  // validator subtracts from the frozen provider seal. Subject and strength unchanged;
  // the number simply stops being typed in a second place where it can disagree.
  // Only the retained half moves: a declared addition is a live provider. The 31
  // batched records are untouched and stay a literal.
  // [TEST-MOD-APPROVED #2591 · cutover] The MIRROR of the addition above. The
  // #2591 cutover deletes the nine Postgres wrappers, so the two records #1172
  // and #1840 still contributed leave discovery with their files and move to the
  // `consolidated-provider` transition. Derived from the registry, never typed,
  // for the same reason the addition is: a second hand-written number is how two
  // sides disagree and auto-merge clean.
  const consolidated = value.workflowProviders.filter((item) => item.transition === "consolidated-provider");
  assert.deepEqual([retained.length, batched.length], [60 + PROVIDERS_ADDED_SINCE_SEAL.length - consolidated.length, 31]);
  assert.equal(retained.length + batched.length + consolidated.length, value.workflowProviders.length);
  assert.deepEqual(providers.map((item) => item.workflow).sort(), retained.map((item) => item.workflow).sort());
  assert.deepEqual(validateRegistry(value, { root: ROOT }), []);
});

test("selector grammar, NUL parsing, host fail-safe and evidence tampering fail closed", () => {
  assert.equal(pathMatches("mingla-business/app/event/[id]/edit.tsx", "mingla-business/app/event/[id]/edit.tsx"), true);
  assert.equal(pathMatches("mingla-business/app/event/[id]/edit.tsx", "mingla-business/app/event/i/edit.tsx"), false);
  for (const unsafe of ["../x", "/x", "x?", "x/**/y", "x\ny", "x\0y"]) assert.throws(() => parseOriginPattern(unsafe), /pattern|relative|NUL|line|wildcard|unsafe|segment/i);
  assert.deepEqual(parseNulPaths(Buffer.from("b\0a\0a\0")), ["a","b"]);
  assert.throws(() => parseNulPaths(Buffer.from("a\nb\0")), /line|valid|unsafe/i);
  const value = manifest(); const host = "ota-app-node20-19-install";
  const failed = normalizeDecision(value, null, host, "failure");
  assert.equal(failed.mode, "fail-safe-host"); assert.equal(failed.deferredError, true); assert.equal(failed.selectedSuiteIds.length, 4);
  const normal = selectionDocument(value, host, ["mingla-business/src/services/offeringTheme.ts"], { source: {eventName:"pull_request",baseSha:"a".repeat(40),headSha:"b".repeat(40),mergeBaseSha:"a".repeat(40),pathSource:"local-git-three-dot-nul"} });
  assert.equal(validateDecision(value, normal, host).selectedSuiteIds.length, 0);
  assert.throws(() => validateDecision(value, {...normal,digest:"0".repeat(64)}, host), /digest/);
  assert.equal(isNonAuthoritativeProviderEvidence(".github/scripts/strict-grep/issue-2148-ci-postgres-wave-shadow.tester.test.mjs"), true);
  assert.equal(isNonAuthoritativeProviderEvidence("mingla-business/src/x.tester.test.ts"), false);
});

test("canonical cost fixture and workflow topology remain exact", () => {
  const fixture = read(".github/scripts/ci-batch/__tests__/fixtures/issue-2438-cost-baseline-v1.jsonl");
  assert.equal(sha(fixture), "e31b286ac8d29fbb5749a1fd21025559aab6ce7df62af9f1562e6a8c52bd8d55");
  const rows = fixture.trimEnd().split("\n").map(JSON.parse); assert.equal(rows.length,100);
  assert.deepEqual(rows.find((row)=>row.pr===2201), {pr:2201,baseSha:"4414436a9617b075e2065118f5821458248058d2",headSha:"9a3c551798a3aae58fa4de5de3e1511647f5fa21",mergeBaseSha:"4414436a9617b075e2065118f5821458248058d2",pathSource:"git-diff-z-v1",pathCount:11362,pathSha256:"51764c43bad76f056f343f9bb851597e378e23b005680d10b7e4b5fc1a7c135b",matchedOrigins:[]});
  const histogram = Object.fromEntries([0,1,2,3,4,5].map((n)=>[n,rows.filter((row)=>row.matchedOrigins.length===n).length])); assert.deepEqual(histogram,{0:25,1:41,2:20,3:9,4:4,5:1});
  const workflow = read(".github/workflows/ci-batch.yml");
  assert.equal((workflow.match(/^\s+- class:/gm)||[]).length,14); assert.equal((workflow.match(/^\s+secondaryClass: phase3b-/gm)||[]).length,9);
  assert.deepEqual([...workflow.matchAll(/hostTimeoutMinutes:\s*(\d+)/g)].map((m)=>Number(m[1])), [50,45,40,45,45,55,55,50,60,62,55,55,105,55]);
  for (const pin of ["actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683","denoland/setup-deno@11b63cf76cfcafb4e43f97b6cad24d8e8438f62d","denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed"]) assert.match(workflow,new RegExp(pin));
  assert.doesNotMatch(workflow,/pull_request_target|id-token:\s*write|contents:\s*write|secrets\./);
  for (const stage of ["id: phase3b-select","id: phase3b-decision","Run selected Phase 3B suites with exact attribution","Upload Phase 3B suite results","Reconcile Phase 3B host"]) assert.match(workflow,new RegExp(stage));
});

test("independent manifest mutants reject omission, swap, widening and false terminal state", () => {
  const base=manifest(); const attacks=[];
  const mutate=(fn)=>{const value=structuredClone(base);fn(value);attacks.push(value);};
  mutate((m)=>m.suites.find((s)=>s.migrationWave===WAVE).steps.pop());
  mutate((m)=>m.phase3bLeafCapabilities.leaves.pop());
  mutate((m)=>m.commandCapabilities.commands.splice(158,1));
  mutate((m)=>m.setupProfiles["phase3b-lifecycle-node20-deno2"].installs.reverse());
  mutate((m)=>m.suites.find((s)=>s.origin.endsWith("issue-1902-public-event-lifecycle-tests.yml")).steps[2].env.NODE_PATH="../node_modules");
  mutate((m)=>m.suites.find((s)=>s.origin.endsWith("issue-2013-ari-tenant-containment.yml")).originPaths.push(".github/workflows/issue-2013-ari-tenant-containment.yml"));
  mutate((m)=>m.suites.find((s)=>s.ownerIssue==="#1685").timeoutSeconds=900);
  mutate((m)=>m.workflowProviders.push({workflow:"issue-948-w3-screens-copy-tests.yml",ownerIssue:"#948",transition:"retained-live-provider",providerWorkflow:".github/workflows/issue-948-w3-screens-copy-tests.yml",referenceFiles:[],rationale:"forged"}));
  // [#2438 SC-21] At shadow this flipped one suite forward to prove a premature partial
  // cutover reds. Post-cutover that value is what all twelve already carry, so the mutation
  // became a NO-OP and the assertion could no longer fail. Inverted to the terminal-correct
  // form: dragging one suite back to shadow-active is now the mixed lifecycle to catch.
  mutate((m)=>m.suites.filter((s)=>s.migrationWave===WAVE)[0].lifecycle="shadow-active");
  for (const [index, attack] of attacks.entries()) assert.ok(independentErrors(attack).length>0,`mutant ${index} false-green`);
});
