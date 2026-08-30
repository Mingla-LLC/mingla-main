// #2438 implementor-owned happy-path and fail-on-revert proof.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { discoverWorkflowProviders, isNonAuthoritativeProviderEvidence, normalizeProviderReferenceFilesForSeal, providerDiscoveryAccounting, PROVIDER_REFERENCE_FILES_ADDED_SINCE_SEAL, PROVIDERS_ADDED_SINCE_SEAL, trackedFilesProcessInvocations, validateRegistry, withTrackedFilesScope } from "../validate-manifest-v2.mjs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { buildShardReport, commandFingerprint, createIsolatedWorkspace, expectedPrimarySuites, materializeToolExposures, minimalChildEnvironment, resolveLeafCapability, runSuiteV2, validateSetupEvidence } from "../run-suite-batch.mjs";
import { expectedPhase3bIdentities, reconcilePhase3bReports, selectionDocument } from "../select-phase3b-suites.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const manifest = () => JSON.parse(fs.readFileSync(path.join(ROOT, ".github/ci-batch/MANIFEST.json"), "utf8"));
// [TEST-MOD-APPROVED #2591] Raw discovery carries the providers declared in
// PROVIDERS_ADDED_SINCE_SEAL; only the SEAL subtracts them. Counted by presence in
// the workspace under test rather than by the declaration's length, so an isolated
// workspace that does not carry the workflow still reconciles.
const declaredAdditionsIn = (root) => PROVIDERS_ADDED_SINCE_SEAL
  .filter((item) => fs.existsSync(path.join(root, ".github/workflows", item.workflow))).length;
const digest = (value) => crypto.createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const WRAPPERS = {
  "issue-1022-theme-control-tests.yml":"f4d461a534e2d0a0273e9ea60957605a4f6e9f832229f74cf9f695445ff655df",
  "issue-1461-venue-current-brand-race-tests.yml":"30bff6582d3d775133eb9c1ffc997b8985f24fc6985fec7585a2ba0f1ce88785",
  "issue-1467-venue-submit-idempotency-tests.yml":"39c84667a17817587b4c1b66813b7a5d028e7ef33ec2bda47e04f1cc19763597",
  "issue-1485-web-missing-chunk-404-tests.yml":"056e93d8b5e3f24a51c0ca874192607da05a90b43565293ee9318efb004d749b",
  "issue-1685-venue-draft-multi-tests.yml":"b738a1749da6d5a22a440bf2c12c6d0a62bb97c7f9fc93b9a5f7bb5ea0056ab8",
  "issue-1902-public-event-lifecycle-tests.yml":"ee303de029f2ff1abe129f42c8fbbcefca17287bfa8536cc60ee7c1f10c8b900",
  "issue-2013-ari-tenant-containment.yml":"ac59c3d6b732d34db7a5ddb4b03d407330d9916619812da7b49a339e9911601c",
  "issue-679-brand-follow-tests.yml":"613f672bb1da1644a0de30695ea0dd5a4d24086c01dd0e9540e6e75dfb200e90",
  "issue-885-scanner-invite-loader-tests.yml":"931afbb3ca488138de1ed0b2c2f669f7d3359f66edf46cbaaa9651a1e6426a8b",
  "issue-948-w1-enablers-tests.yml":"6cc978c1adb0635dfe2ed669745a2889d8e70a043c4ad88c581489753684bd66",
  "issue-948-w3-screens-copy-tests.yml":"55a53aeece48e2c07a2915190c1a1c4861d24295518b537e1b07346000ca5e9f",
  "orch-0976-draft-promotion-tests.yml":"74d7bc9877095f150b423373072bd7f4172428b1f0ed1df43f667c1600278ba1",
};
const MARKER = "# #2438 SHADOW-PARITY-TRIGGER — remove before cutover";
const RESERVED_TESTER = ".github/scripts/strict-grep/issue-2148-ci-postgres-wave-shadow.tester.test.mjs";
// #2725: Amendment 8 adds the PG17 competitor-budget workflow covered by this refreshed seal.
const PROVIDER_DIGEST = "c0813be9c105418cd60697b22be5ae5dbc2055b03895c2e5c77f68606a498a7f";
const PHASE3B_PROVIDER_NAMES = new Set(["issue-1022-theme-control-tests.yml","issue-1902-public-event-lifecycle-tests.yml","issue-2013-ari-tenant-containment.yml","issue-885-scanner-invite-loader-tests.yml","issue-948-w1-enablers-tests.yml","orch-0976-draft-promotion-tests.yml"]);
const PHASE3B_PROVIDER_DIGEST = "1676cbe80860ee0181cf95fcbd70dcb95a9d535066161e25f11348212264abc1";

// [TEST-MOD-APPROVED #2438 · SC-21] SC-21 deleted the twelve wrappers, so provider
// discovery can no longer see the six Phase 3B records at all. There is deliberately
// NO second frozen digest for the terminal state: a literal nobody can re-derive is
// exactly the fragility this contract already rejected (Amendment 7 D-B, and the
// orchestrator ruling on mutant 10). The single frozen seal above is RECONSTRUCTED
// at runtime — what terminal discovery still sees, plus the six records the registry
// carries for the deleted wrappers, re-sorted exactly as discovery sorts — which is
// the same derivation the production validator performs.
const carriedPhase3bProviders = (root) =>
  JSON.parse(fs.readFileSync(path.join(root, ".github/ci-batch/MANIFEST.json"), "utf8"))
    .workflowProviders.filter((item) => PHASE3B_PROVIDER_NAMES.has(item.workflow))
    .map((item) => ({ workflow: item.workflow, referenceFiles: item.referenceFiles }))
    .sort((a, b) => a.workflow.localeCompare(b.workflow));
// [TEST-MOD-APPROVED #2439 · SC-21] The reconstruction now carries EVERY wave that
// reached terminal after the seal was frozen, not just Phase 3B. #2439 deletes
// seventeen more wrappers carrying seven more provider records, so terminal
// discovery falls 67 -> 60 and a Phase-3B-only carry reconstructs 66, not 73.
// The set is READ from the registry's own wave headers, never typed, and Phase
// 3A is deliberately excluded: the frozen 73 was measured AFTER 3A's cutover, so
// its eighteen deleted-wrapper records are already outside the seal. Still one
// frozen seal, still no second digest anywhere.
const carriedWaveProviders = (root) => {
  const value = JSON.parse(fs.readFileSync(path.join(root, ".github/ci-batch/MANIFEST.json"), "utf8"));
  const waves = new Set(Object.entries(value.migrationWaves || {})
    .filter(([wave, contract]) => contract.lifecycle === "batched-historical" && wave !== "phase3a-node-wave")
    .map(([wave]) => wave));
  const deleted = new Set(value.legacyOrigins.filter((origin) => waves.has(origin.migrationWave))
    .map((origin) => `${origin.stem}.${origin.extension}`));
  // [TEST-MOD-APPROVED #2591 · cutover] A record can now leave discovery WITHOUT
  // belonging to a wave: the #2591 cutover deletes the nine Postgres wrappers, and
  // the two records #1172 and #1840 contributed die with their files. The registry
  // carries them under the `consolidated-provider` transition and the validator
  // reconstructs the frozen authority from them exactly as it does the waves' —
  // so this helper, which every digest assertion in this file goes through, has to
  // see them too. Extended in the ONE place rather than at each call site.
  for (const item of value.workflowProviders) {
    if (item.transition === "consolidated-provider") deleted.add(item.workflow);
  }
  return value.workflowProviders.filter((item) => deleted.has(item.workflow))
    .map((item) => ({ workflow: item.workflow, referenceFiles: item.referenceFiles }))
    .sort((a, b) => a.workflow.localeCompare(b.workflow));
};
// [TEST-MOD-APPROVED #2591] The reconstruction MIRRORS the validator, in the one
// helper all four digest assertions go through. Providers declared in
// PROVIDERS_ADDED_SINCE_SEAL are subtracted BY EXACT CONTENT before the digest, so
// the frozen 73/aac3d8cf… seal is unchanged and every one of those four assertions
// keeps checking it at full strength. Subtracting by content and not by name is
// what keeps a drifted declaration red, and an UNDECLARED new provider is not
// subtracted at all, so it still breaks the digest — which is the tripwire.
const sealedDiscovery = (discovered) => {
  const referenceNormalized = normalizeProviderReferenceFilesForSeal(discovered);
  const declared = new Map(PROVIDERS_ADDED_SINCE_SEAL
    .map((item) => [item.workflow, JSON.stringify([...item.referenceFiles])]));
  return referenceNormalized.filter((item) => declared.get(item.workflow) !== JSON.stringify(item.referenceFiles));
};
const reconstructShadowAuthority = (root, discovered) =>
  [...sealedDiscovery(discovered), ...carriedWaveProviders(root)].sort((a, b) => a.workflow.localeCompare(b.workflow));

// [#2438] CI runners carry NO global git identity. Every invocation supplies its
// own via -c, so no callsite here can depend on ambient config: relying on it is
// green on a developer machine and `fatal: empty ident name` on a runner, which
// is the same local-only-green shape this rework exists to remove. Never make a
// commit conditional on identity being present — a skip is worse than the red.
const GIT_IDENTITY = ["-c", "user.email=ci@example.invalid", "-c", "user.name=CI"];
function git(root, args) { return execFileSync("git", [...GIT_IDENTITY, ...args], { cwd: root, encoding: "utf8" }).trim(); }
function providerSnapshot(root) {
  const value = JSON.parse(fs.readFileSync(path.join(root, ".github/ci-batch/MANIFEST.json"), "utf8"));
  const providers = discoverWorkflowProviders(root);
  return JSON.stringify({ providers, errors: validateRegistry(value, { root }) });
}

test("reviewed partial provider references preserve the frozen seal and fail closed", () => {
  const discovered = discoverWorkflowProviders(ROOT);
  const declaration = PROVIDER_REFERENCE_FILES_ADDED_SINCE_SEAL[0];
  assert.equal(digest(reconstructShadowAuthority(ROOT, discovered)), PROVIDER_DIGEST,
    "the reviewed reference addition must reconstruct the unchanged frozen seal");

  const missing = structuredClone(discovered);
  missing.find((item) => item.workflow === declaration.workflow).referenceFiles = missing
    .find((item) => item.workflow === declaration.workflow).referenceFiles
    .filter((item) => !declaration.referenceFiles.includes(item));
  assert.throws(() => normalizeProviderReferenceFilesForSeal(missing), /delta is missing/,
    "missing declared reference must be RED");

  const wrongWorkflow = [{ ...declaration, workflow: "issue-1485-web-missing-chunk-404-tests.yml" }];
  assert.throws(() => normalizeProviderReferenceFilesForSeal(discovered, wrongWorkflow), /must appear exactly once/,
    "declaring the reference against the wrong workflow must be RED");

  const duplicate = structuredClone(discovered);
  duplicate.push(structuredClone(duplicate.find((item) => item.workflow === declaration.workflow)));
  assert.throws(() => normalizeProviderReferenceFilesForSeal(duplicate), /exactly once/,
    "duplicate provider records must be RED");

  const extra = structuredClone(discovered);
  extra.find((item) => item.workflow === declaration.workflow).referenceFiles.push("undeclared/provider-reference.mjs");
  extra.find((item) => item.workflow === declaration.workflow).referenceFiles.sort();
  assert.notEqual(digest(reconstructShadowAuthority(ROOT, extra)), PROVIDER_DIGEST,
    "an undeclared reference must remain inside the reconstructed seal and be RED");
});

function assertWave(value) {
  const suites = value.suites.filter((suite) => suite.migrationWave === "phase3b-postgres-wave");
  // [TEST-MOD-APPROVED #2591] Literal -> derivation. The provider totals are now
  // `<frozen> + PROVIDERS_ADDED_SINCE_SEAL.length`, read from the one declared set the
  // validator subtracts from the frozen provider seal. Subject and strength unchanged;
  // the number simply stops being typed in a second place where it can disagree.
  assert.equal(value.legacyOrigins.length, 200); assert.equal(value.suites.length, 84); assert.equal(value.commandCapabilities.commands.length, 240); assert.equal(value.workflowProviders.length, 91 + PROVIDERS_ADDED_SINCE_SEAL.length);
  assert.equal(suites.length, 12); assert.equal(suites.flatMap((suite) => suite.steps).length, 36);
  // [TEST-MOD-APPROVED #2438 · SC-21] Terminal, and atomic on all three carriers of
  // the lifecycle: the suites, the wave header, and the legacy-origin dispositions.
  assert.deepEqual([...new Set(suites.map((suite) => suite.lifecycle))], ["batched-historical"]);
  assert.equal(value.migrationWaves["phase3b-postgres-wave"].lifecycle, "batched-historical");
  assert.deepEqual([...new Set(value.legacyOrigins
    .filter((origin) => origin.migrationWave === "phase3b-postgres-wave")
    .map((origin) => origin.disposition))], ["batched-historical"]);
  // Exactly the frozen six providers transitioned, the record total did not move,
  // and each now names the batch provider rather than a deleted wrapper.
  const phase3bRecords = value.workflowProviders.filter((item) => PHASE3B_PROVIDER_NAMES.has(item.workflow));
  assert.equal(phase3bRecords.length, PHASE3B_PROVIDER_NAMES.size);
  assert.deepEqual([...new Set(phase3bRecords.map((item) => item.transition))], ["batched-provider"]);
  assert.deepEqual([...new Set(phase3bRecords.map((item) => item.providerWorkflow))], [".github/workflows/ci-batch.yml"]);
  const transitions = value.workflowProviders.reduce((acc, item) => ({ ...acc, [item.transition]: (acc[item.transition] || 0) + 1 }), {});
  // [TEST-MOD-APPROVED #2439 · SC-17.1] The split is DERIVED, never typed: #2439
  // moves seven more records from retained to batched, and a typed 67/24 would
  // have been a wave-relative number that silently absorbed the next wave. Every
  // batched record must have an absent wrapper and every retained one a live
  // wrapper — which is what the split actually MEANS — and the two must still
  // sum to the frozen 91 plus whatever PROVIDERS_ADDED_SINCE_SEAL declares.
  const wrapperLive = (item) => fs.existsSync(path.join(ROOT, ".github/workflows", item.workflow));
  const retained = value.workflowProviders.filter((item) => item.transition === "retained-live-provider");
  const batched = value.workflowProviders.filter((item) => item.transition === "batched-provider");
  // [TEST-MOD-APPROVED #2591 · cutover] The MIRROR of the addition above. The
  // #2591 cutover deletes the nine Postgres wrappers, so the two records #1172
  // and #1840 still contributed leave discovery with their files and move to the
  // `consolidated-provider` transition. Derived from the registry, never typed,
  // for the same reason the addition is: a second hand-written number is how two
  // sides disagree and auto-merge clean.
  const consolidated = value.workflowProviders.filter((item) => item.transition === "consolidated-provider");
  assert.equal(retained.filter((item) => !wrapperLive(item)).length, 0, "a retained provider whose wrapper is gone is a lie");
  assert.equal(batched.filter(wrapperLive).length, 0, "a batched provider whose wrapper is back is a duplicate provider");
  assert.equal(consolidated.filter(wrapperLive).length, 0, "a consolidated provider whose wrapper is back is a duplicate provider");
  assert.deepEqual(transitions, {
    "retained-live-provider": retained.length,
    "batched-provider": batched.length,
    ...(consolidated.length > 0 ? { "consolidated-provider": consolidated.length } : {}),
  });
  // [TEST-MOD-APPROVED #2591] Literal -> derivation. The provider totals are now
  // `<frozen> + PROVIDERS_ADDED_SINCE_SEAL.length`, read from the one declared set the
  // validator subtracts from the frozen provider seal. Subject and strength unchanged;
  // the number simply stops being typed in a second place where it can disagree.
  assert.equal(retained.length + batched.length + consolidated.length, 91 + PROVIDERS_ADDED_SINCE_SEAL.length);
  assert.equal(value.phase3bLeafCapabilities.leaves.length, 40); assert.equal(value.phase3bLeafCapabilities.currentExecutedLeaves, 40); assert.equal(value.phase3bLeafCapabilities.currentAbsentLeaves, 0);
  assert.equal(new Set(suites.map((suite) => suite.executionClass)).size, 9); assert.equal(new Set(suites.map((suite) => suite.hostClass)).size, 9); assert.equal(value.classes.length, 14); assert.equal(value.executionClasses.length, 29);
  assert.equal(digest(value.commandCapabilities.commands.slice(0,51)), "bb9c0e598a08ab91d8714ec2db80100c8b4d966d980a3cc290c3bcad93990a3f");
  assert.equal(digest(value.commandCapabilities.commands.slice(51,158)), "3cdccc5cb491f7a642ffa2a49f450d6f7ed5b37450d1f18a1fe219d5c629e709");
  assert.equal(digest(value.commandCapabilities.commands.slice(158, 194)), "df9f09e2454fa05f7d74ae96517657a8582aff4c3ad742c6f2ab657cef179bc1");
  assert.equal(digest(value.phase3bLeafCapabilities.leaves), "76d627f1f117923c41dc2a4b928d606a134c2a3a0d948010e565828fa91be89d");
  assert.equal(value.phase3bContractSha256, "8b3a94d67e1e32b7cb5580bbab84db525ad196769608d42cc0607652a3c6cad9");
  const lifecycle=value.suites.find((suite)=>suite.id==="issue-1902-public-event-lifecycle-tests");
  assert.deepEqual(lifecycle.steps.map((step)=>step.env||null).filter(Boolean),[{NODE_PATH:"./node_modules"}]);
  assert.deepEqual(value.setupProfiles["phase3b-lifecycle-node20-deno2"].installs.map((install)=>[install.cwd,install.invocation.argv]),[["mingla-business",["ci"]],["app-mobile",["ci"]]]);
}

function setupForClass(value, klass) {
  const [name, profile] = Object.entries(value.setupProfiles).find(([, candidate]) => candidate.classes.includes(klass));
  const installs = profile.install ? [profile.install] : profile.installs || [];
  const orderedInstalls = installs.map((install) => ({ id: install.id, cwd: install.cwd, command: install.invocation.command,
    argv: install.invocation.argv, status: "passed", durationMs: 0 }));
  const orderedToolExposures = (profile.toolExposures || []).map((exposure) => ({ ...exposure, status: "passed", durationMs: 0 }));
  const installPayload = orderedInstalls.map(({ id, cwd, command, argv }) => ({ id, cwd, command, argv }));
  const exposurePayload = orderedToolExposures.map(({ status, durationMs, ...payload }) => payload);
  return { profile, evidence: { class: klass, setupProfile: name, setupExecutions: 1, installExecutions: installs.length,
    orderedInstalls, setupFingerprint: digest(installPayload), toolExposureExecutions: orderedToolExposures.length,
    orderedToolExposures, toolExposureFingerprint: digest(exposurePayload) } };
}

function greenResult(value, suite) {
  const { profile } = setupForClass(value, suite.executionClass || suite.class);
  const installs = profile.install ? [profile.install] : profile.installs || [];
  const dependencyCwds = [...new Set(installs.map((install) => install.cwd))];
  const result = { id: suite.id, setupProfile: suite.setupProfile, commandFingerprint: commandFingerprint(suite), status: "passed",
    ok: true, code: 0, reason: null, durationMs: 0, seconds: 0, timeoutSeconds: suite.timeoutSeconds,
    expected: suite.steps.length, executed: suite.steps.length, allowedCleanup: [], dependencyCwds, dependencyCloneCount: dependencyCwds.length };
  if (suite.migrationWave !== "phase3b-postgres-wave") return result;
  result.leafResults = suite.steps.flatMap((step, stepIndex) => (step.children || [{
    id: `leaf:${suite.id}:${String(stepIndex + 1).padStart(2, "0")}:1`, predicate: { kind: "always" },
  }]).map((leaf) => {
    // Independent oracle: conditionalExpectedFiles owns which paths are optional;
    // do not repeat the production predicate-kind branch in this fixture builder.
    const conditional = suite.conditionalExpectedFiles?.includes(leaf.predicate?.path);
    const absent = conditional && !fs.existsSync(path.join(ROOT, leaf.predicate.path));
    return { id: leaf.id, outerCommandId: step.commandId, status: absent ? "skipped-absent" : "passed", executed: !absent };
  }));
  result.outerResults = suite.steps.map((step) => {
    const leaves = result.leafResults.filter((leaf) => leaf.outerCommandId === step.commandId);
    return { id: step.commandId, status: "passed", executed: true, expectedLeaves: leaves.length,
      executedLeaves: leaves.filter((leaf) => leaf.executed).length,
      skippedAbsentLeaves: leaves.filter((leaf) => leaf.status === "skipped-absent").length };
  });
  result.expectedLeaves = result.leafResults.length;
  result.absentLeaves = result.leafResults.filter((leaf) => leaf.status === "skipped-absent").length;
  result.presentLeaves = result.expectedLeaves - result.absentLeaves;
  result.executedLeaves = result.presentLeaves;
  return result;
}

function canonicalReconciliation(value, host) {
  const decision = selectionDocument(value, host, [], { failSafe: true });
  const primarySuites = expectedPrimarySuites(value, host); const primaryResults = primarySuites.map((suite) => greenResult(value, suite));
  const primary = buildShardReport(host, primarySuites, primaryResults, setupForClass(value, host).evidence, 0);
  const selectedSuites = decision.selectedSuiteIds.map((id) => value.suites.find((suite) => suite.id === id));
  const secondaryClass = selectedSuites[0].executionClass; const secondaryResults = selectedSuites.map((suite) => greenResult(value, suite));
  const secondary = buildShardReport(`phase3b:${host}`, selectedSuites, secondaryResults, setupForClass(value, secondaryClass).evidence, 0);
  const identities = expectedPhase3bIdentities(value, decision.selectedSuiteIds);
  secondary.expectedOuterIds = identities.outerIds; secondary.executedOuterIds = identities.outerIds;
  secondary.expectedLeafIds = identities.leafIds;
  const leaves = secondaryResults.flatMap((result) => result.leafResults);
  secondary.observedLeafIds = leaves.map((leaf) => leaf.id);
  secondary.executedLeafIds = leaves.filter((leaf) => leaf.executed).map((leaf) => leaf.id);
  secondary.absentLeafIds = leaves.filter((leaf) => leaf.status === "skipped-absent").map((leaf) => leaf.id);
  secondary.selectionDigest = decision.digest; secondary.selectionMode = decision.mode; secondary.deferredError = decision.deferredError;
  return { decision, primary, secondary };
}

test("terminal registry has exact identities, counts, digests, and the twelve wrappers absent", () => {
  const value = manifest(); assertWave(value); assert.deepEqual(validateRegistry(value, { root: ROOT }), []);
  // [TEST-MOD-APPROVED #2438 · SC-21] The twelve wrappers are DELETED, so their bytes
  // can no longer be read from disk. The twelve frozen pre-shadow source seals are
  // NOT abandoned with them: the registry carries each one as its suite's immutable
  // `shadowContract.workflowSha256`, so the same twelve literals stay pinned against
  // the provenance the deletion left behind, and each file's absence is asserted.
  const workflowDir = path.join(ROOT, ".github/workflows");
  for (const [name, expected] of Object.entries(WRAPPERS)) {
    assert.equal(fs.existsSync(path.join(workflowDir, name)), false, `${name} must be absent at terminal`);
    const suite = value.suites.find((item) => path.basename(item.origin) === name);
    assert.ok(suite, name);
    assert.equal(suite.shadowContract.workflowSha256, expected, `${name} frozen pre-shadow source seal`);
  }
  // SC-10: the marker disappeared with the wrappers and survives in no workflow.
  for (const entry of fs.readdirSync(workflowDir)) {
    assert.equal(fs.readFileSync(path.join(workflowDir, entry), "utf8").includes(MARKER), false, `${entry} still carries the #2438 marker`);
  }
  // SC-1: the sibling that merely shares a filename stem is untouched.
  assert.equal(digest(fs.readFileSync(path.join(ROOT, ".github/workflows/issue-679-brand-follows-rls-proof.yml"))), "a2d6b6274bf7f52c9e84ad4bfb8c16d0fb549c30cf69475415426d2906adf7ad");
});

test("provider authority ignores reserved tester bytes but rejects eligible source drift", () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "phase3b-provider-authority-")));
  try {
    execFileSync("git", ["clone", "-q", "--no-hardlinks", ROOT, temp]);
    git(temp, ["config", "user.email", "ci@example.invalid"]); git(temp, ["config", "user.name", "CI"]);
    fs.rmSync(path.join(temp, RESERVED_TESTER), { force: true }); git(temp, ["add", "-A"]);
    if (git(temp, ["status", "--porcelain"])) git(temp, ["commit", "-qm", "tester absent"]);
    const absent = providerSnapshot(temp); const absentValue = JSON.parse(absent);
    // [TEST-MOD-APPROVED #2438 · SC-21] Terminal authority, DERIVED not re-pinned.
    assert.equal(absentValue.providers.length, 73 - carriedWaveProviders(temp).length + declaredAdditionsIn(temp)); assert.deepEqual(absentValue.errors, []);
    assert.equal(absentValue.providers.filter((item) => PHASE3B_PROVIDER_NAMES.has(item.workflow)).length, 0);
    assert.equal(digest(reconstructShadowAuthority(temp, absentValue.providers)), PROVIDER_DIGEST);
    assert.equal(digest(carriedPhase3bProviders(temp)), PHASE3B_PROVIDER_DIGEST);

    const testerPath = path.join(temp, RESERVED_TESTER); fs.mkdirSync(path.dirname(testerPath), { recursive: true });
    const allWrapperNames = Object.keys(WRAPPERS);
    const variants = [
      "",
      "arbitrary text\n",
      allWrapperNames.join("\n"),
      allWrapperNames.slice(0, 5).join("\n"),
      [...allWrapperNames].reverse().join("\n"),
      [...allWrapperNames, ...[...allWrapperNames].reverse()].join("\n"),
    ];
    for (const [index, source] of variants.entries()) {
      // [#2438 A7-SC3] This region MUTATES the Git index, so it must never run
      // inside a tracked-files scope and must never be served by an ambient memo.
      // Either would make the six add/commit mutations invisible and turn the
      // A4-SC4 byte-invariance proof below into a tautology that proves nothing.
      const spawnsBeforeMutation = trackedFilesProcessInvocations();
      fs.writeFileSync(testerPath, source); git(temp, ["add", RESERVED_TESTER]); git(temp, ["commit", "-qm", `tester variant ${index}`]);
      assert.equal(git(temp, ["ls-files", "--error-unmatch", RESERVED_TESTER]), RESERVED_TESTER, "the mutation must really be in the index");
      assert.equal(providerSnapshot(temp), absent);
      assert.ok(trackedFilesProcessInvocations() - spawnsBeforeMutation >= 1,
        "a mutating region must re-derive the tracked-file listing: no scope, no ambient memo");
    }
    git(temp, ["rm", "-q", RESERVED_TESTER]); git(temp, ["commit", "-qm", "tester absent again"]); assert.equal(providerSnapshot(temp), absent);
    assert.equal(git(temp, ["ls-files", RESERVED_TESTER]), "", "the removal must really leave the index");

    // [TEST-MOD-APPROVED #2438 · SC-21] The old drift probes mutated the exact literal
    // `issue-1022-theme-control-tests.yml`, which SC-12 has now repointed out of every
    // eligible source. Both directions are preserved and re-derived from whatever the
    // terminal tree actually references, so neither can rot into a literal again.
    const eligible = "mingla-business/src/utils/__tests__/serverDraftEventMapper.storeEcho.tester.test.ts";
    const eligiblePath = path.join(temp, eligible); const original = fs.readFileSync(eligiblePath, "utf8");
    // (a) LOSING a genuine reference ⇒ RED. Pick a live single-source provider and
    //     mangle the workflow stem so discovery can no longer resolve it.
    const soleReference = absentValue.providers.find((item) => item.referenceFiles.length === 1
      && !isNonAuthoritativeProviderEvidence(item.referenceFiles[0]));
    assert.ok(soleReference, "a single-source live provider is needed to attack the lost-reference direction");
    const solePath = path.join(temp, soleReference.referenceFiles[0]);
    const soleOriginal = fs.readFileSync(solePath, "utf8");
    fs.writeFileSync(solePath, soleOriginal.replaceAll(soleReference.workflow, soleReference.workflow.replace(/\.ya?ml$/, "-retired.yml")));
    let changed = providerSnapshot(temp); assert.notEqual(changed, absent);
    assert.match(changed, /authority drifted|inventory drifted|stale external provider/);
    fs.writeFileSync(solePath, soleOriginal); assert.equal(providerSnapshot(temp), absent);
    // (b) GAINING an unregistered reference ⇒ RED. Derived: a live workflow that no
    //     registered provider record claims.
    const registeredNames = new Set(absentValue.providers.map((item) => item.workflow));
    const unreferenced = fs.readdirSync(path.join(temp, ".github/workflows"))
      .find((name) => /\.ya?ml$/.test(name) && !registeredNames.has(name));
    assert.ok(unreferenced, "an unreferenced live workflow is needed to attack the omitted-provider direction");
    fs.writeFileSync(eligiblePath, `${original}\n// ${unreferenced}\n`);
    changed = providerSnapshot(temp); assert.notEqual(changed, absent);
    assert.match(changed, /authority drifted|externally referenced workflow provider omitted/);
    fs.writeFileSync(eligiblePath, original); assert.equal(providerSnapshot(temp), absent);
    // (c) A retired wrapper name re-added to an eligible source is INERT at terminal:
    //     the file is gone, so discovery filters it before it can become a record.
    //     That is precisely why the retired-reference inventory is a separate,
    //     EXECUTED guard below rather than something this subtest could ever catch.
    fs.writeFileSync(eligiblePath, `${original}\n// issue-1022-theme-control-tests.yml\n`);
    assert.equal(providerSnapshot(temp), absent);
    fs.writeFileSync(eligiblePath, original); assert.equal(providerSnapshot(temp), absent);
    // (d) The fixture role exclusion still does real work, proven with ONE literal in
    //     both directions: red from an eligible source, inert from a fixture path.
    const fixtureProbe = ".github/scripts/ci-batch/__tests__/fixtures/issue-2438-role-probe.jsonl";
    assert.equal(isNonAuthoritativeProviderEvidence(fixtureProbe), true);
    fs.writeFileSync(path.join(temp, fixtureProbe), `${unreferenced}\n`);
    git(temp, ["add", fixtureProbe]); git(temp, ["commit", "-qm", "fixture role probe"]);
    assert.equal(providerSnapshot(temp), absent, "a fixture must never move provider authority");
    git(temp, ["rm", "-q", fixtureProbe]); git(temp, ["commit", "-qm", "fixture role probe removed"]);
    assert.equal(providerSnapshot(temp), absent);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("provider evidence role grammar is bounded and production has no exact tester coupling", () => {
  assert.equal(isNonAuthoritativeProviderEvidence(RESERVED_TESTER), true);
  assert.equal(isNonAuthoritativeProviderEvidence(".github/scripts/strict-grep/issue-2148-ci-node-wave-shadow.tester.test.mjs"), true);
  assert.equal(isNonAuthoritativeProviderEvidence(".github/scripts/ci-batch/__tests__/fixtures/evidence.jsonl"), true);
  for (const relative of [
    ".github/scripts/strict-grep/issue-2148-ci-postgres-wave-shadow.implementor.test.mjs",
    ".github/scripts/strict-grep/issue-2148-ci-postgres-wave.tester.test.mjs",
    ".github/scripts/strict-grep/issue-0-ci-postgres-wave-shadow.tester.test.mjs",
    ".github/scripts/strict-grep/ordinary.tester.test.mjs",
    ".github/scripts/ci-batch/__tests__/ordinary.test.mjs",
    "elsewhere/__tests__/fixtures/evidence.jsonl",
  ]) assert.equal(isNonAuthoritativeProviderEvidence(relative), false, relative);
  const production = fs.readFileSync(path.join(ROOT, ".github/scripts/ci-batch/validate-manifest-v2.mjs"), "utf8");
  assert.equal(production.includes(RESERVED_TESTER), false);
  assert.equal(production.includes("issue-2148-ci-node-wave-shadow.tester.test.mjs"), false);
});

test("#1902 setup, env, compounds, and conditional leaf accounting are separate and exact", () => {
  const value = manifest(); const suite = value.suites.find((item) => item.id === "issue-1902-public-event-lifecycle-tests");
  assert.equal(suite.steps.length, 11); assert.deepEqual(suite.steps.map((step) => step.env || null).filter(Boolean), [{ NODE_PATH: "./node_modules" }]);
  assert.deepEqual(value.setupProfiles[suite.setupProfile].installs.map((install) => [install.id, install.cwd, install.invocation.command, install.invocation.argv]), [
    ["setup:phase3b-lifecycle-node20-deno2:01", "mingla-business", "npm", ["ci"]],
    ["setup:phase3b-lifecycle-node20-deno2:02", "app-mobile", "npm", ["ci"]],
  ]);
  const compounds = value.suites.filter((item) => item.migrationWave === "phase3b-postgres-wave").flatMap((item) => item.steps.filter((step) => step.children));
  assert.deepEqual(compounds.map((step) => step.children.length).sort(), [2,4]);
  assert.equal(suite.conditionalExpectedFiles.filter((file) => fs.existsSync(path.join(ROOT,file))).length, 4);
  assert.equal(suite.conditionalExpectedFiles.filter((file) => !fs.existsSync(path.join(ROOT,file))).length, 0);
  const installs = value.setupProfiles[suite.setupProfile].installs;
  const exposures = value.setupProfiles[suite.setupProfile].toolExposures;
  const orderedInstalls = installs.map((install) => ({ id: install.id, cwd: install.cwd, command: install.invocation.command, argv: install.invocation.argv }));
  const evidence = { class: suite.executionClass, setupProfile: suite.setupProfile, setupExecutions: 1, installExecutions: 2,
    orderedInstalls, setupFingerprint: digest(orderedInstalls), toolExposureExecutions: 1,
    orderedToolExposures: exposures, toolExposureFingerprint: digest(exposures) };
  assert.equal(validateSetupEvidence(value, suite.executionClass, evidence).name, suite.setupProfile);
  assert.throws(() => validateSetupEvidence(value, suite.executionClass, { ...evidence, orderedInstalls: [...orderedInstalls].reverse() }), /ordered capability mismatch/);
  assert.throws(() => minimalChildEnvironment({ NODE_PATH: "./node_modules" }, "/tmp/home"), /undeclared child environment capability/);
  assert.equal(minimalChildEnvironment({ NODE_PATH: "./node_modules" }, "/tmp/home", { allowNodePath: true }).NODE_PATH, "./node_modules");
  const compound = suite.steps.find((step) => step.children?.length === 4); const child = compound.children[0];
  assert.deepEqual(resolveLeafCapability(value.phase3bLeafCapabilities, suite, compound, 6, child, 0).argv, child.invocation.argv);
  assert.throws(() => resolveLeafCapability(value.phase3bLeafCapabilities, suite, compound, 6, { ...child, cwd: ".." }, 0), /drifted|mismatch/);
});

test("secondary reconciliation identities account for every selected outer and leaf in order", () => {
  const value = manifest(); const selected = ["issue-1902-public-event-lifecycle-tests", "issue-948-w3-screens-copy-tests"];
  const identities = expectedPhase3bIdentities(value, selected);
  assert.equal(identities.outerIds.length, 14); assert.equal(identities.leafIds.length, 18);
  assert.equal(new Set(identities.outerIds).size, identities.outerIds.length);
  assert.equal(new Set(identities.leafIds).size, identities.leafIds.length);
});

test("primary and secondary reconciliation is lane-exact and non-masking", () => {
  const value=manifest(); const host="ota-app-node20-19-install"; const {decision,primary,secondary}=canonicalReconciliation(value,host);
  const selected=decision.selectedSuiteIds; const secondaryResults=secondary.results;
  assert.deepEqual(reconcilePhase3bReports(value,host,decision,primary,secondary),[]);
  const wrongLane=structuredClone(primary); wrongLane.results.push({...secondaryResults[0]}); wrongLane.executedSuiteIds.push(selected[0]); wrongLane.executed++;
  assert.match(reconcilePhase3bReports(value,host,decision,wrongLane,null).join("\n"),/wrong-lane-duplicate.*missing-intended-secondary/s);
  const redPrimary=structuredClone(primary); redPrimary.ok=false; redPrimary.results[0].ok=false;
  assert.match(reconcilePhase3bReports(value,host,decision,redPrimary,secondary).join("\n"),/primary-failed/);
  const reordered=structuredClone(secondary); reordered.results.reverse(); reordered.executedSuiteIds.reverse(); assert.match(reconcilePhase3bReports(value,host,decision,primary,reordered).join("\n"),/secondary-order-mismatch|secondary-evidence-mismatch/);
  const duplicate=structuredClone(secondary); duplicate.results.push(duplicate.results[0]); assert.match(reconcilePhase3bReports(value,host,decision,primary,duplicate).join("\n"),/duplicate-secondary/);
  const foreign=structuredClone(secondary); foreign.results[0].id=value.suites.find((suite)=>suite.migrationWave==="phase3b-postgres-wave"&&suite.hostClass!==host).id;
  assert.match(reconcilePhase3bReports(value,host,decision,primary,foreign).join("\n"),/wrong-host-or-unselected-secondary/);
  const none=selectionDocument(value,host,["unrelated/file.ts"],{source:{eventName:"push",baseSha:"a".repeat(40),headSha:"b".repeat(40),mergeBaseSha:"a".repeat(40),pathSource:"local-git-two-dot-nul"}});
  const emptySecondary={schemaVersion:2,class:`phase3b:${host}`,results:[],executed:0};
  assert.match(reconcilePhase3bReports(value,host,none,primary,emptySecondary).join("\n"),/no-selection-secondary-execution/);

  const missingPrimaryRows=structuredClone(primary); missingPrimaryRows.results=[];
  assert.match(reconcilePhase3bReports(value,host,decision,missingPrimaryRows,secondary).join("\n"),/primary-identity-mismatch/);
  const foreignLeaves=structuredClone(secondary); foreignLeaves.executedLeafIds=foreignLeaves.executedLeafIds.map((_,index)=>`foreign:${index}`);
  assert.match(reconcilePhase3bReports(value,host,decision,primary,foreignLeaves).join("\n"),/secondary-evidence-mismatch/);
  const forgedSetup=structuredClone(secondary); forgedSetup.setupProfile="forged"; forgedSetup.setupExecutions=9;
  forgedSetup.installExecutions=0; forgedSetup.orderedInstalls=[]; forgedSetup.setupFingerprint="0".repeat(64);
  forgedSetup.results[0].setupProfile="forged"; forgedSetup.results[0].commandFingerprint="1".repeat(64);
  forgedSetup.results[0].dependencyCwds=["foreign"]; forgedSetup.results[0].dependencyCloneCount=99;
  assert.match(reconcilePhase3bReports(value,host,decision,primary,forgedSetup).join("\n"),/secondary-evidence-mismatch/);

  for (const mutate of [
    (report)=>report.results.push(structuredClone(report.results[0])),
    (report)=>report.expectedSuiteIds.pop(),
    (report)=>{report.setupClass="foreign-class";},
    (report)=>{report.results[0].status="failed";},
    (report)=>{report.results[0].outerResults[0].executedLeaves=99;},
    (report)=>{report.results[0].leafResults[0].status="skipped-absent";report.results[0].leafResults[0].executed=false;},
    (report)=>{report.absentLeafIds=[report.executedLeafIds[0]];},
  ]) { const attack=structuredClone(secondary); mutate(attack); assert.notDeepEqual(reconcilePhase3bReports(value,host,decision,primary,attack),[]); }

  const lifecycle=canonicalReconciliation(value,"admin-node20-install");
  assert.deepEqual(reconcilePhase3bReports(value,"admin-node20-install",lifecycle.decision,lifecycle.primary,lifecycle.secondary),[]);
  assert.equal(value.phase3bLeafCapabilities.currentExecutedLeaves,40);
  assert.equal(value.phase3bLeafCapabilities.currentAbsentLeaves,0);
  assert.equal(lifecycle.secondary.executedLeafIds.length,14);
  assert.equal(lifecycle.secondary.absentLeafIds.length,0);
  assert.deepEqual(lifecycle.secondary.absentLeafIds,[]);
  const fabricatedAbsence=structuredClone(lifecycle.secondary);
  const fabricatedAbsentId="leaf:issue-1902-public-event-lifecycle-tests:07:brand";
  const fabricatedAbsentLeaf=fabricatedAbsence.results[0].leafResults.find((leaf)=>leaf.id===fabricatedAbsentId);
  fabricatedAbsentLeaf.status="skipped-absent";fabricatedAbsentLeaf.executed=false;
  fabricatedAbsence.results[0].outerResults[6].executedLeaves=3;fabricatedAbsence.results[0].outerResults[6].skippedAbsentLeaves=1;
  fabricatedAbsence.results[0].presentLeaves=13;fabricatedAbsence.results[0].executedLeaves=13;fabricatedAbsence.results[0].absentLeaves=1;
  fabricatedAbsence.executedLeafIds=fabricatedAbsence.executedLeafIds.filter((id)=>id!==fabricatedAbsentId);fabricatedAbsence.absentLeafIds=[fabricatedAbsentId];
  assert.match(reconcilePhase3bReports(value,"admin-node20-install",lifecycle.decision,lifecycle.primary,fabricatedAbsence).join("\n"),/secondary-evidence-mismatch/);
  const presentClaimedAbsent=structuredClone(lifecycle.secondary);const presentId="leaf:issue-1902-public-event-lifecycle-tests:07:offering";
  const presentLeaf=presentClaimedAbsent.results[0].leafResults.find((leaf)=>leaf.id===presentId);presentLeaf.status="skipped-absent";presentLeaf.executed=false;
  assert.match(reconcilePhase3bReports(value,"admin-node20-install",lifecycle.decision,lifecycle.primary,presentClaimedAbsent).join("\n"),/secondary-evidence-mismatch/);
  const presentOmitted=structuredClone(lifecycle.secondary);
  presentOmitted.executedLeafIds=presentOmitted.executedLeafIds.filter((id)=>id!==presentId);
  assert.match(reconcilePhase3bReports(value,"admin-node20-install",lifecycle.decision,lifecycle.primary,presentOmitted).join("\n"),/secondary-evidence-mismatch/);
  for(const mutate of [
    (report)=>{report.toolExposureExecutions=0;},
    (report)=>{report.orderedToolExposures[0].version="29.7.1";},
    (report)=>{report.toolExposureFingerprint="2".repeat(64);},
  ]) {const attack=structuredClone(lifecycle.secondary);mutate(attack);assert.match(reconcilePhase3bReports(value,"admin-node20-install",lifecycle.decision,lifecycle.primary,attack).join("\n"),/secondary-evidence-mismatch/);}
  for(const mutate of [
    (suite)=>{suite.steps[6].children[0].predicate.kind="exists";},
    (suite)=>{suite.steps[6].children[0].predicate.path="../escape";suite.conditionalExpectedFiles[0]="../escape";},
    (suite)=>{suite.steps[6].children[1].predicate.path=suite.steps[6].children[0].predicate.path;suite.conditionalExpectedFiles[1]=suite.conditionalExpectedFiles[0];},
  ]) {const attacked=structuredClone(value);mutate(attacked.suites.find((suite)=>suite.id==="issue-1902-public-event-lifecycle-tests"));
    const fixture=canonicalReconciliation(attacked,"admin-node20-install");
    assert.match(reconcilePhase3bReports(attacked,"admin-node20-install",fixture.decision,fixture.primary,fixture.secondary).join("\n"),/secondary-evidence-mismatch/);}
});

test("#1902 typed Business Jest exposure is lock-pinned and resolves exact offline npx", () => {
  const value=manifest(); const profile=value.setupProfiles["phase3b-lifecycle-node20-deno2"]; const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"phase3b-jest-exposure-")));
  try {
    const exposure=profile.toolExposures[0];
    fs.mkdirSync(path.join(root,"mingla-business/node_modules/jest/bin"),{recursive:true}); fs.mkdirSync(path.join(root,"app-mobile/node_modules/.bin"),{recursive:true});
    fs.writeFileSync(path.join(root,"mingla-business/package-lock.json"),JSON.stringify({packages:{"node_modules/jest":{version:"29.7.0"}}}));
    fs.writeFileSync(path.join(root,"app-mobile/proof.js"),"proof\n");
    execFileSync("git",[...GIT_IDENTITY,"init","-q"],{cwd:root}); execFileSync("git",["config","user.email","ci@example.invalid"],{cwd:root}); execFileSync("git",["config","user.name","CI"],{cwd:root});
    execFileSync("git",[...GIT_IDENTITY,"add","mingla-business/package-lock.json","app-mobile/proof.js"],{cwd:root}); execFileSync("git",[...GIT_IDENTITY,"commit","-qm","fixture"],{cwd:root});
    fs.writeFileSync(path.join(root,"mingla-business/node_modules/jest/package.json"),JSON.stringify({name:"jest",version:"29.7.0",bin:{jest:"./bin/jest.js"}}));
    const bin=path.join(root,"mingla-business/node_modules/jest/bin/jest.js"); fs.writeFileSync(bin,"#!/usr/bin/env node\nif(!process.argv.includes('--runInBand'))process.exit(2);\n"); fs.chmodSync(bin,0o755);
    const cache=path.join(root,"empty-cache"); fs.mkdirSync(cache);
    assert.throws(()=>execFileSync("npx",["jest","--runInBand","proof.js"],{cwd:path.join(root,"app-mobile"),env:{PATH:process.env.PATH,HOME:root,npm_config_cache:cache,npm_config_offline:"true"},stdio:"pipe"}),/Command failed/);
    const records=materializeToolExposures(profile,root); assert.equal(records.length,1); assert.equal(digest(records.map((record)=>{const copy={...record};delete copy.status;delete copy.durationMs;return copy;})),digest(profile.toolExposures));
    execFileSync("npx",["jest","--runInBand","proof.js"],{cwd:path.join(root,"app-mobile"),env:{PATH:process.env.PATH,HOME:root,npm_config_cache:cache,npm_config_offline:"true"},stdio:"pipe"});
    assert.equal(fs.realpathSync(path.join(root,exposure.consumerPackageLink)),fs.realpathSync(path.join(root,"mingla-business/node_modules/jest")));
    assert.equal(fs.realpathSync(path.join(root,exposure.consumerBinLink)),fs.realpathSync(bin));
    const workspace=createIsolatedWorkspace({root,profile,suite:{setupProfile:"phase3b-lifecycle-node20-deno2"}});
    try {
      assert.deepEqual(workspace.dependencyCwds,["mingla-business","app-mobile"]); assert.equal(workspace.dependencyCloneCount,2);
      assert.equal(fs.realpathSync(path.join(workspace.root,exposure.consumerPackageLink)),fs.realpathSync(path.join(workspace.root,"mingla-business/node_modules/jest")));
      execFileSync("npx",["jest","--runInBand","proof.js"],{cwd:path.join(workspace.root,"app-mobile"),env:{PATH:process.env.PATH,HOME:root,npm_config_cache:cache,npm_config_offline:"true"},stdio:"pipe"});
    } finally {workspace.cleanup();}
    for(const key of ["version","packageName","providerExecutable","consumerPackageLinkTarget","consumerBinLinkTarget","authorityKey"]){const attack=structuredClone(value);attack.setupProfiles["phase3b-lifecycle-node20-deno2"].toolExposures[0][key]+="-drift";assert.match(validateRegistry(attack,{root:ROOT}).join("\n"),/setupProfiles differ|exposure contract drifted/);}
  } finally {fs.rmSync(root,{recursive:true,force:true});}
  const hashes={"app-mobile/package.json":"2e167f8c716e80e9baf53dd2b2ba14833afd3a3da48f19718442672bbd0ce6a2","app-mobile/package-lock.json":"80d18eae58c8e0a81c7e858730caaaae7294e767a27b078ffae2c6d2a2786624","mingla-business/package.json":"61ddd3137b3cc5542f9d58b28edd0a4f1cd6479a9212d99b8067025a03547601","mingla-business/package-lock.json":"6725babece1c8c2aab52d3d66dae35de0a45088e4a240560d7f4eb8317ee6513"};
  for(const [relative,expected] of Object.entries(hashes)) assert.equal(digest(fs.readFileSync(path.join(ROOT,relative))),expected);
});

test("suite deadline records every remaining outer and leaf instead of hiding work", async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"phase3b-deadline-"));
  try {
    execFileSync("git",[...GIT_IDENTITY,"init","-q"],{cwd:root}); execFileSync("git",["config","user.email","ci@example.invalid"],{cwd:root}); execFileSync("git",["config","user.name","CI"],{cwd:root});
    fs.writeFileSync(path.join(root,"proof.test"),"proof\n"); execFileSync("git",["add","."] ,{cwd:root}); execFileSync("git",[...GIT_IDENTITY,"commit","-qm","fixture"],{cwd:root});
    const invocation={kind:"reviewed-shell-v1",command:"bash",argv:["-c","true"]};
    const steps=[1,2].map((ordinal)=>({name:`step ${ordinal}`,cwd:".",run:"true",invocation,commandId:`assert:fixture:${String(ordinal).padStart(2,"0")}`}));
    // [TEST-MOD-APPROVED #2439] The fixture named a migrated wave but omitted the
    // field that MAKES a suite migrated. It only routed through the leaf lane
    // because the runner keyed on the wave NAME — the assumption that took six
    // batch hosts red on PR #2546. A migrated fixture now declares the same
    // executionClass/hostClass a real migrated record carries, so it exercises
    // the derived lane instead of a literal.
    const suite={id:"fixture",migrationWave:"phase3b-postgres-wave",executionClass:"fixture",hostClass:"fixture",setupProfile:"fixture",expectedFiles:["proof.test"],generatedPaths:[],timeoutSeconds:60,steps};
    const leaves=steps.map((step,index)=>{const payload={cwd:".",executable:"bash",argv:["-c","true"],env:null,predicate:{kind:"always"}};return{id:`leaf:fixture:${String(index+1).padStart(2,"0")}:1`,suiteId:"fixture",outerCommandId:step.commandId,outerIndex:index,leafIndex:0,...payload,payloadSha256:digest(payload)}});
    const leafCapabilities={schemaVersion:1,expectedLeaves:leaves.length,registrySha256:digest(leaves),leaves};
    const result=await runSuiteV2(suite,{root,profile:{classes:["fixture"],runtime:{name:"node",version:"20"},installs:[]},workspaceFactory:()=>({root,cleanup(){}}),leafCapabilities,execute:async()=>({ok:false,code:124,timedOut:true,reason:"suite deadline exceeded"})});
    assert.deepEqual(result.outerResults.map(({status})=>status),["timed-out","not-run-suite-deadline"]);
    assert.deepEqual(result.leafResults.map(({status})=>status),["timed-out","not-run-suite-deadline"]);
    assert.deepEqual([result.executed,result.expected,result.executedLeaves,result.expectedLeaves],[1,2,1,2]);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test("material count, attribution, setup, env, marker, and sibling reversions are red", () => {
  const base = manifest(); const attacks = [];
  // [TEST-MOD-APPROVED #2439] WAVE-SCOPED, not positional. `suites.pop()` and
  // `suites.at(-1)` meant "a Phase 3B suite" only while Phase 3B was the last
  // wave in the array; once Phase 3C was appended both attacks became NO-OPS
  // against assertWave, which asserts the Phase 3B wave. Same attacks, now aimed
  // at the wave they were always written for.
  const phase3bOf = (value) => value.suites.filter((suite) => suite.migrationWave === "phase3b-postgres-wave");
  const omitted = structuredClone(base); omitted.suites.splice(omitted.suites.indexOf(phase3bOf(omitted).at(-1)), 1); attacks.push(omitted);
  const outer = structuredClone(base); phase3bOf(outer).at(-1).steps.pop(); attacks.push(outer);
  const leaf = structuredClone(base); leaf.phase3bLeafCapabilities.leaves.pop(); attacks.push(leaf);
  const setup = structuredClone(base); setup.setupProfiles["phase3b-lifecycle-node20-deno2"].installs.reverse(); attacks.push(setup);
  const env = structuredClone(base); env.suites.find((suite)=>suite.id==="issue-1902-public-event-lifecycle-tests").steps[2].env.NODE_PATH="../node_modules"; attacks.push(env);
  for (const attack of attacks) assert.throws(() => assertWave(attack));
});

// [#2438 A7-SC4] The cost contract is COUNTS. A wall-clock, high-resolution
// timer or elapsed-millisecond threshold is forbidden in any gate — it flakes on
// shared runners and this repository already carries one nondeterministic
// required gate (#2178). Elapsed time is verified out of band from Actions
// timestamps, never asserted here.
test("provider discovery work accounting stays inside its reviewed count bounds", () => {
  const value = manifest();
  const providers = discoverWorkflowProviders(ROOT);
  const accounting = providerDiscoveryAccounting();
  // Byte-identity is the acceptance test for the A7-SC2 pre-filter, not speed.
  // [TEST-MOD-APPROVED #2438 · SC-21] Terminal authority, derived from the one seal.
  assert.equal(providers.length, 73 - carriedWaveProviders(ROOT).length + declaredAdditionsIn(ROOT));
  assert.equal(providers.filter((item) => PHASE3B_PROVIDER_NAMES.has(item.workflow)).length, 0);
  assert.equal(digest(reconstructShadowAuthority(ROOT, providers)), PROVIDER_DIGEST);
  assert.equal(digest(carriedPhase3bProviders(ROOT)), PHASE3B_PROVIDER_DIGEST);
  // (a) exactly one tracked-file listing per discovery call.
  assert.equal(accounting.trackedListInvocations, 1, "discovery must list tracked files exactly once");
  // (b) every eligible path is accounted for, and the reviewed fact that nothing
  //     in this tree is unreadable is bound separately so an added symlink or
  //     submodule fails informatively instead of looking like a cost regression.
  assert.equal(accounting.filesRead + accounting.skippedUnreadable, accounting.eligible, "read accounting must cover every eligible path");
  assert.equal(accounting.skippedUnreadable, 0, "git ls-files -s shows only modes 100644/100755: nothing can be unreadable");
  // (c) two-sided window. Upper bound catches reverting the pre-filter (8,000);
  //     lower bound catches dropping the `.yml` literal (14). Neither catches
  //     dropping `.yaml` (175) — there are 0 `.yaml` workflows today, so that
  //     half is deliberately, documentedly non-falsifiable and no mutant claims
  //     otherwise. Adding a `.yaml` workflow makes it falsifiable and it must
  //     then be guarded.
  assert.ok(accounting.filesPatternScanned >= 120, `filesPatternScanned ${accounting.filesPatternScanned} below the 120 floor`);
  assert.ok(accounting.filesPatternScanned <= 400, `filesPatternScanned ${accounting.filesPatternScanned} above the 400 ceiling`);
  assert.equal(Object.isFrozen(accounting), true);
  // (d) structural, suite-scaled bound outside any scope. A fixed number here is
  //     a cannot-pass check waiting to be inherited: the dominant term is one
  //     listing per suite, so Phase 3C raises it by construction.
  const suiteCount = value.suites.length;
  const unscopedBefore = trackedFilesProcessInvocations();
  assert.deepEqual(validateRegistry(value, { root: ROOT }), []);
  const unscoped = trackedFilesProcessInvocations() - unscopedBefore;
  assert.ok(unscoped >= suiteCount, `unscoped validateRegistry listed ${unscoped} times, below the per-suite floor ${suiteCount}`);
  assert.ok(unscoped <= suiteCount + 25, `unscoped validateRegistry listed ${unscoped} times, above the bound ${suiteCount + 25}`);
  // (e) one listing for the whole validation inside an entered scope, with
  //     identical results — the scope removes spawns, never observations.
  const scopedBefore = trackedFilesProcessInvocations();
  const scopedErrors = withTrackedFilesScope(ROOT, () => validateRegistry(value, { root: ROOT }));
  const scoped = trackedFilesProcessInvocations() - scopedBefore;
  assert.deepEqual(scopedErrors, []);
  assert.ok(scoped <= 1, `scoped validateRegistry listed ${scoped} times, above the in-scope bound of 1`);
  // The scope must be EXITED, not ambient: the next call outside it spawns again.
  const exitedBefore = trackedFilesProcessInvocations();
  discoverWorkflowProviders(ROOT);
  assert.equal(trackedFilesProcessInvocations() - exitedBefore, 1, "leaving the scope must restore uncached listing");
  // No wall-clock threshold anywhere in the modules this contract governs. The
  // needles are assembled at runtime so this assertion cannot match itself.
  const timerNeedles = [["performance", "now("].join("."), ["process", "hrtime"].join("."), ["Date", "now()"].join(".")];
  for (const relative of [
    ".github/scripts/ci-batch/validate-manifest-v2.mjs",
    ".github/scripts/strict-grep/issue-2148-ci-registry-v2.mjs",
    ".github/scripts/strict-grep/issue-2148-ci-runner-v2.mjs",
  ]) {
    const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
    for (const needle of timerNeedles) assert.equal(source.includes(needle), false, `${relative} uses a forbidden wall-clock source ${needle}`);
  }
});

// [#2438 A7-SC3] Ambient, process-lifetime or module-global memoisation of
// trackedFiles() — and any cache keyed only on `root` — is forbidden by name,
// because it is proven to manufacture a false green. This subtest executes both
// directions of that proof against a real mutating tree.
test("tracked-file scoping is explicit, exited, and provably wrong around a mutation", () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "phase3b-tracked-scope-")));
  try {
    execFileSync("git", ["clone", "-q", "--no-hardlinks", ROOT, temp]);
    git(temp, ["config", "user.email", "ci@example.invalid"]); git(temp, ["config", "user.name", "CI"]);
    const before = discoverWorkflowProviders(temp);
    // [TEST-MOD-APPROVED #2438 · SC-21] The terminal baseline is MEASURED, then bound
    // back to the one frozen seal by reconstruction — never re-pinned as a second
    // literal. Everything below is expressed relative to that measured baseline.
    const BASE = before.length; const BASE_DIGEST = digest(before);
    assert.equal(BASE, 73 - carriedWaveProviders(temp).length + declaredAdditionsIn(temp));
    assert.equal(digest(reconstructShadowAuthority(temp, before)), PROVIDER_DIGEST);

    // Commit a brand-new eligible source that names a real live workflow.
    // [TEST-MOD-APPROVED #2438 · SC-21] The probe MUST name a workflow that is still
    // live. It used to name issue-948-w3-screens-copy-tests.yml, which the cutover
    // deleted: discovery filters an absent workflow, so that probe would now move
    // nothing and every assertion in this subtest would pass vacuously. Derived at
    // runtime from a live workflow no provider record claims.
    const registeredNames = new Set(before.map((item) => item.workflow));
    const probeWorkflow = fs.readdirSync(path.join(temp, ".github/workflows"))
      .find((name) => /\.ya?ml$/.test(name) && !registeredNames.has(name));
    assert.ok(probeWorkflow, "an unreferenced live workflow is required for a non-vacuous scope probe");
    const probe = "mingla-business/src/utils/__tests__/issue2438ScopeProbe.probe.ts";
    fs.writeFileSync(path.join(temp, probe), `export const provider = "${probeWorkflow}";\n`);
    git(temp, ["add", probe]); git(temp, ["commit", "-qm", "scope probe"]);

    // 1. HONEST, UNSCOPED discovery observes the commit. This is the assertion a
    //    scope around a mutating region breaks, and it is why entering one here
    //    is forbidden (mutant 13).
    const honest = discoverWorkflowProviders(temp);
    assert.equal(honest.length, BASE + 1, "unscoped discovery must observe a newly tracked provider source");
    assert.notEqual(digest(honest), BASE_DIGEST, "unscoped discovery digest must move when the corpus moves");
    assert.equal(honest.some((item) => item.referenceFiles.includes(probe)), true);

    // 2. The scope genuinely hides it, so assertion 1 is not vacuous. A blind
    //    ambient memo behaves exactly like this everywhere, permanently.
    git(temp, ["rm", "-q", probe]); git(temp, ["commit", "-qm", "scope probe removed"]);
    const blind = withTrackedFilesScope(temp, () => {
      const first = discoverWorkflowProviders(temp);
      fs.writeFileSync(path.join(temp, probe), `export const provider = "${probeWorkflow}";\n`);
      git(temp, ["add", probe]); git(temp, ["commit", "-qm", "scope probe again"]);
      return { first, second: discoverWorkflowProviders(temp) };
    });
    assert.equal(blind.first.length, BASE);
    assert.equal(blind.second.length, BASE, "an entered scope must be shown to hide index mutations");
    assert.equal(digest(blind.second), BASE_DIGEST);

    // 3. Exiting restores truth. Cached-forever would keep reporting 73.
    const afterExit = discoverWorkflowProviders(temp);
    assert.equal(afterExit.length, BASE + 1, "exiting the scope must restore uncached truth");
    assert.equal(digest(afterExit), digest(honest));

    // 4. Inside a scope over an immutable tree the results are identical to the
    //    uncached path and cost exactly one listing.
    git(temp, ["rm", "-q", probe]); git(temp, ["commit", "-qm", "scope probe gone"]);
    const spawnsBefore = trackedFilesProcessInvocations();
    const scoped = withTrackedFilesScope(temp, () => [discoverWorkflowProviders(temp), discoverWorkflowProviders(temp), discoverWorkflowProviders(temp)]);
    assert.equal(trackedFilesProcessInvocations() - spawnsBefore, 1);
    for (const snapshot of scoped) { assert.equal(snapshot.length, BASE); assert.equal(digest(snapshot), BASE_DIGEST); }

    // 5. The scope stack unwinds even when the body throws.
    assert.throws(() => withTrackedFilesScope(temp, () => { throw new Error("boom"); }), /boom/);
    const unwound = trackedFilesProcessInvocations();
    discoverWorkflowProviders(temp);
    assert.equal(trackedFilesProcessInvocations() - unwound, 1, "a thrown scope body must still exit the scope");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

// [#2438 SC-13/SC-17/SC-21] The terminal branch is the LIVE state now, so this
// contract is executed against the real cutover rather than a synthesised fixture.
// Nothing here mutates the repository: every state is built in a temp clone.
//
// [TEST-MOD-APPROVED #2438] What changed at cutover and why. Before SC-21 this
// subtest read the twelve wrapper files, stashed their bytes, and drove the tree
// shadow -> terminal -> shadow. Those bytes no longer exist on any tree, so the
// direction is inverted: the clone IS terminal, and the shadow side is proven by
// the assertion that actually protects it — a registry that still DECLARES
// shadow-active while the wrappers are gone must be red. Every attack the old
// version executed is preserved: restored terminal wrapper, mixed lifecycle,
// third lifecycle form, wave header disagreeing with its suites, and all five
// properties of the terminal provider derivation. One attack is ADDED, because
// only the cutover can express it: a provider record left at
// retained-live-provider after its wrapper is deleted.
test("SC-21 terminal state is executable and fail-closed in both directions", () => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "phase3b-terminal-state-")));
  const SIBLING = ".github/workflows/issue-679-brand-follows-rls-proof.yml";
  const SIBLING_SHA = "a2d6b6274bf7f52c9e84ad4bfb8c16d0fb549c30cf69475415426d2906adf7ad";
  const wrapperNames = Object.keys(WRAPPERS);
  const wrapperPath = (name) => path.join(temp, ".github/workflows", name);
  const guard = (relative) => {
    try { execFileSync("node", [relative], { cwd: temp, stdio: "pipe" }); return 0; }
    catch (error) { return error.status ?? 1; }
  };
  const GUARDS = [
    ".github/scripts/strict-grep/issue-1902-public-event-lifecycle.mjs",
    ".github/scripts/strict-grep/issue-2013-ari-tenant-containment.mjs",
  ];
  const siblingIsIntact = () => assert.equal(digest(fs.readFileSync(path.join(temp, SIBLING))), SIBLING_SHA);
  try {
    execFileSync("git", ["clone", "-q", "--no-hardlinks", ROOT, temp]);
    // [#2438] This clone commits a drift probe below, so it needs its own identity.
    // A clone inherits none, and a CI runner has no global one to fall back to.
    git(temp, ["config", "user.email", "ci@example.invalid"]); git(temp, ["config", "user.name", "CI"]);
    // The clone carries the last commit. Overlay the working-tree gate sources so
    // this contract is proven against the code under review, not against HEAD.
    fs.cpSync(path.join(ROOT, ".github/scripts"), path.join(temp, ".github/scripts"), { recursive: true });
    fs.cpSync(path.join(ROOT, ".github/ci-batch"), path.join(temp, ".github/ci-batch"), { recursive: true });
    const terminal = JSON.parse(fs.readFileSync(path.join(temp, ".github/ci-batch/MANIFEST.json"), "utf8"));
    const writeManifest = (value) => fs.writeFileSync(path.join(temp, ".github/ci-batch/MANIFEST.json"), `${JSON.stringify(value, null, 2)}\n`);
    const withPhase3b = (mutate) => { const copy = structuredClone(terminal); mutate(copy); writeManifest(copy); return validateRegistry(copy, { root: temp }); };
    const restoreTerminal = () => { writeManifest(terminal); assert.deepEqual(validateRegistry(terminal, { root: temp }), []); };

    // 1. TERMINAL — 12 batched-historical, all 12 wrappers absent. This is the live
    //    state; it must PASS and must reach a clean verdict rather than throwing.
    for (const name of wrapperNames) assert.equal(fs.existsSync(wrapperPath(name)), false, `${name} must be absent`);
    assert.deepEqual(validateRegistry(terminal, { root: temp }), [], "terminal state must validate clean");
    for (const relative of GUARDS) assert.equal(guard(relative), 0, `${relative} must pass at terminal`);
    siblingIsIntact();

    // 2. RESTORED TERMINAL WRAPPER — a wrapper put back is the error, whatever its
    //    bytes: the validator owns this, and neither guard is coupled to the file.
    const restored = wrapperNames[0];
    fs.writeFileSync(wrapperPath(restored), "name: restored\non: workflow_dispatch\njobs: {}\n");
    const restoredErrors = validateRegistry(terminal, { root: temp });
    assert.notDeepEqual(restoredErrors, []);
    assert.match(restoredErrors.join("\n"), new RegExp(`terminal wrapper ${restored.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} must be absent`));
    for (const relative of GUARDS) assert.equal(guard(relative), 0, `${relative} must NOT re-couple to ${restored}`);
    fs.rmSync(wrapperPath(restored));
    assert.deepEqual(validateRegistry(terminal, { root: temp }), []);
    siblingIsIntact();

    // 3. MIXED LIFECYCLE — 11 terminal + 1 shadow is never a valid wave.
    assert.notDeepEqual(withPhase3b((copy) => {
      copy.suites.find((suite) => suite.migrationWave === "phase3b-postgres-wave").lifecycle = "shadow-active";
    }), []);
    restoreTerminal();

    // 4. DECLARED SHADOW WITH THE WRAPPERS GONE — the shadow-side guard, and the
    //    only form of it the terminal tree can still express. A registry that
    //    claims the wrappers are live when they are deleted must be red.
    const declaredShadow = withPhase3b((copy) => {
      for (const suite of copy.suites) if (suite.migrationWave === "phase3b-postgres-wave") suite.lifecycle = "shadow-active";
      for (const origin of copy.legacyOrigins) if (origin.migrationWave === "phase3b-postgres-wave") origin.disposition = "shadow-active";
      copy.migrationWaves["phase3b-postgres-wave"].lifecycle = "shadow-active";
    });
    assert.notDeepEqual(declaredShadow, []);
    assert.match(declaredShadow.join("\n"), /shadow wrapper .* (must remain live until cutover|missing)/);
    restoreTerminal();

    // 5. WRONG PROVIDER TRANSITION — a Phase 3B record left retained-live after its
    //    wrapper is deleted, and the same record pointed at a deleted wrapper.
    const wrongTransition = withPhase3b((copy) => {
      copy.workflowProviders.find((item) => PHASE3B_PROVIDER_NAMES.has(item.workflow)).transition = "retained-live-provider";
    });
    assert.notDeepEqual(wrongTransition, []);
    assert.match(wrongTransition.join("\n"), /retained provider must remain the exact live historical wrapper|stale external provider registration/);
    const wrongProviderWorkflow = withPhase3b((copy) => {
      const record = copy.workflowProviders.find((item) => PHASE3B_PROVIDER_NAMES.has(item.workflow));
      record.providerWorkflow = `.github/workflows/${record.workflow}`;
    });
    assert.notDeepEqual(wrongProviderWorkflow, []);
    assert.match(wrongProviderWorkflow.join("\n"), /batched provider requires exact batch provider and absent historical wrapper/);
    // The same drift on the legacy-origin disposition is red too.
    assert.match(withPhase3b((copy) => {
      const origin = copy.legacyOrigins.find((item) => item.migrationWave === "phase3b-postgres-wave");
      origin.providerWorkflow = `.github/workflows/${origin.stem}.${origin.extension}`;
    }).join("\n"), /cutover requires the historical wrapper absent and the batch provider exact/);
    restoreTerminal();

    // 6. A third lifecycle form is rejected outright, and a shadow wave header over
    //    terminal suites is rejected too — the header must agree with them.
    assert.match(withPhase3b((copy) => {
      for (const suite of copy.suites) if (suite.migrationWave === "phase3b-postgres-wave") suite.lifecycle = "batched-active";
    }).join("\n"), /one atomic shadow-active or batched-historical lifecycle/);
    assert.match(withPhase3b((copy) => {
      copy.migrationWaves["phase3b-postgres-wave"].lifecycle = "shadow-active";
    }).join("\n"), /Phase 3B wave count contract drifted/);
    restoreTerminal();
    siblingIsIntact();

    // 6b. [#2438 SC-13] The TERMINAL provider authority is a runtime DERIVATION
    //     from the one frozen shadow seal, never a second hard-coded digest.
    //     All five properties the derivation must satisfy are attacked here.
    const validator = fs.readFileSync(path.join(temp, ".github/scripts/ci-batch/validate-manifest-v2.mjs"), "utf8");
    // (i) computed at runtime — exactly one frozen provider seal exists in the
    //     validator, and no second 64-hex constant stands in for the terminal one.
    assert.equal(validator.split(PROVIDER_DIGEST).length - 1, 1, "the shadow authority must be the single frozen provider seal");
    const terminalDiscovery = discoverWorkflowProviders(temp);
    const terminalDigest = digest(terminalDiscovery);
    assert.equal(terminalDiscovery.length, 73 - carriedWaveProviders(temp).length + declaredAdditionsIn(temp));
    assert.notEqual(terminalDigest, PROVIDER_DIGEST);
    assert.equal(validator.includes(terminalDigest), false,
      "a hard-coded terminal provider digest is forbidden: the terminal value must be derived");
    assert.match(validator, /reconstructedDigest !== LOCKED_PROVIDER_DISCOVERY_SHA256/,
      "the terminal branch must check its reconstruction against the frozen shadow seal");
    // (ii) the derivation actually reproduces the one frozen seal.
    assert.equal(digest(reconstructShadowAuthority(temp, terminalDiscovery)), PROVIDER_DIGEST);
    // (iii) a fabricated substitute for any carried record ⇒ RED.
    assert.match(withPhase3b((copy) => {
      copy.workflowProviders.find((item) => PHASE3B_PROVIDER_NAMES.has(item.workflow)).referenceFiles = ["README.md"];
    }).join("\n"), /workflow provider authority drifted/);
    // (iv) dropping one of the six subtracted records ⇒ RED.
    assert.match(withPhase3b((copy) => {
      copy.workflowProviders.splice(copy.workflowProviders.findIndex((item) => PHASE3B_PROVIDER_NAMES.has(item.workflow)), 1);
    }).join("\n"), /workflow provider authority drifted|workflowProviders must contain exactly/);
    // (iv-b) subtracting a SEVENTH record ⇒ RED. Re-label a non-Phase-3B provider
    //        as one of the twelve wrapper names.
    assert.notDeepEqual(withPhase3b((copy) => {
      copy.workflowProviders.find((item) => !PHASE3B_PROVIDER_NAMES.has(item.workflow)).workflow = wrapperNames[3];
    }), []);
    restoreTerminal();
    // (v) fails CLOSED when the shadow authority itself drifts: with a genuine
    //     corpus change at terminal, the reconstruction cannot hash back to the
    //     seal, so it reds rather than silently accepting the new reality.
    //     The probe must name a workflow that is still LIVE at terminal, so the
    //     drift is real: naming a deleted Phase 3B wrapper would be filtered out
    //     by workflowNames and change nothing, which is correct behaviour.
    const probe = "mingla-business/src/utils/__tests__/issue2438TerminalAuthorityProbe.probe.ts";
    const liveProvider = terminalDiscovery.find((item) => !PHASE3B_PROVIDER_NAMES.has(item.workflow)).workflow;
    fs.writeFileSync(path.join(temp, probe), `export const provider = "${liveProvider}";\n`);
    git(temp, ["add", probe]); git(temp, ["commit", "-qm", "terminal authority probe"]);
    assert.match(validateRegistry(terminal, { root: temp }).join("\n"), /workflow provider authority drifted/,
      "the terminal derivation must fail closed when the shadow authority drifts");
    git(temp, ["rm", "-q", probe]); git(temp, ["commit", "-qm", "terminal authority probe removed"]);
    assert.deepEqual(validateRegistry(terminal, { root: temp }), [], "removing the drift must restore the terminal PASS");
    siblingIsIntact();
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

// [#2438 SC-12/SC-21] The retired-reference inventory. Deleting the twelve wrappers
// silently turns every surviving mention of their filenames into a pointer at
// nothing: provider discovery filters them (the file is gone), so NOTHING else in
// this repository reds on one. This is the guard that does, and it is exact in both
// directions — a new stale reference reds, and so does removing a carrier that is
// still doing real work.
test("no retired wrapper filename survives outside its authorised historical carriers", () => {
  // Exactly the roles allowed to carry a retired filename after SC-21:
  //   - the registry itself, whose `origin` provenance IS the historical filename;
  //   - the validator's frozen deletion allowlist, which names the twelve to keep
  //     them absent;
  //   - this file's frozen pre-shadow source seals;
  //   - the #2013 guard's registry `origin` identity;
  //   - non-authoritative evidence (frozen cost baseline, wave-shadow tester
  //     reconstructions), recognised BY ROLE via the production classifier rather
  //     than by naming a tester-owned path, which A4-SC1 forbids.
  const SELF = ".github/scripts/ci-batch/__tests__/issue-2438-postgres-wave-shadow-parity.implementor.test.mjs";
  const CARRIERS = new Set([
    ".github/ci-batch/MANIFEST.json",
    ".github/scripts/ci-batch/validate-manifest-v2.mjs",
    ".github/scripts/strict-grep/issue-2013-ari-tenant-containment.mjs",
    SELF,
  ]);
  const names = Object.keys(WRAPPERS);
  const scan = (root) => {
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
    const offenders = [];
    for (const relative of tracked) {
      if (CARRIERS.has(relative) || isNonAuthoritativeProviderEvidence(relative)) continue;
      let source;
      try { source = fs.readFileSync(path.join(root, relative), "utf8"); } catch { continue; }
      if (!source.includes(".yml")) continue;
      if (names.some((name) => source.includes(name))) offenders.push(relative);
    }
    return offenders.sort();
  };
  assert.deepEqual(scan(ROOT), [], "a retired wrapper filename survives outside its authorised carriers");

  // Fails-on-revert, executed: one stale reference planted in an ordinary tracked
  // file is red, and removing it is green again.
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "phase3b-stale-reference-")));
  try {
    execFileSync("git", ["clone", "-q", "--no-hardlinks", ROOT, temp]);
    git(temp, ["config", "user.email", "ci@example.invalid"]); git(temp, ["config", "user.name", "CI"]);
    assert.deepEqual(scan(temp), []);
    const victim = "mingla-business/src/utils/__tests__/serverDraftEventMapper.storeEcho.tester.test.ts";
    const victimPath = path.join(temp, victim); const original = fs.readFileSync(victimPath, "utf8");
    fs.writeFileSync(victimPath, `${original}\n// wired into CI by ${names[0]}\n`);
    assert.deepEqual(scan(temp), [victim], "a stale retired-filename reference must be detected");
    fs.writeFileSync(victimPath, original);
    assert.deepEqual(scan(temp), []);
    // The classifier is doing the exclusion, not a hard-coded tester path: the same
    // literal inside a fixture is authorised evidence, not a stale reference.
    const fixture = ".github/scripts/ci-batch/__tests__/fixtures/issue-2438-stale-reference-probe.jsonl";
    assert.equal(isNonAuthoritativeProviderEvidence(fixture), true);
    fs.writeFileSync(path.join(temp, fixture), `${names[0]}\n`);
    git(temp, ["add", fixture]); git(temp, ["commit", "-qm", "stale reference fixture probe"]);
    assert.deepEqual(scan(temp), []);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
