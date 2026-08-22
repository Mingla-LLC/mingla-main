// #2438 implementor-owned happy-path and fail-on-revert proof.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalizeShadowWrapperSource, discoverWorkflowProviders, isNonAuthoritativeProviderEvidence, validateRegistry } from "../validate-manifest-v2.mjs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { buildShardReport, commandFingerprint, createIsolatedWorkspace, expectedPrimarySuites, materializeToolExposures, minimalChildEnvironment, resolveLeafCapability, runSuiteV2, validateSetupEvidence } from "../run-suite-batch.mjs";
import { expectedPhase3bIdentities, reconcilePhase3bReports, selectionDocument } from "../select-phase3b-suites.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const manifest = () => JSON.parse(fs.readFileSync(path.join(ROOT, ".github/ci-batch/MANIFEST.json"), "utf8"));
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
const PROVIDER_DIGEST = "2f43d33d10134bc0e9989213bae161d93b59707b2ce0295c697cc5c90d3ab86d";
const PHASE3B_PROVIDER_NAMES = new Set(["issue-1022-theme-control-tests.yml","issue-1902-public-event-lifecycle-tests.yml","issue-2013-ari-tenant-containment.yml","issue-885-scanner-invite-loader-tests.yml","issue-948-w1-enablers-tests.yml","orch-0976-draft-promotion-tests.yml"]);
const PHASE3B_PROVIDER_DIGEST = "1676cbe80860ee0181cf95fcbd70dcb95a9d535066161e25f11348212264abc1";

function git(root, args) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }
function providerSnapshot(root) {
  const value = JSON.parse(fs.readFileSync(path.join(root, ".github/ci-batch/MANIFEST.json"), "utf8"));
  const providers = discoverWorkflowProviders(root);
  return JSON.stringify({ providers, errors: validateRegistry(value, { root }) });
}

function assertWave(value) {
  const suites = value.suites.filter((suite) => suite.migrationWave === "phase3b-postgres-wave");
  assert.equal(value.legacyOrigins.length, 199); assert.equal(value.suites.length, 67); assert.equal(value.commandCapabilities.commands.length, 194); assert.equal(value.workflowProviders.length, 89);
  assert.equal(suites.length, 12); assert.equal(suites.flatMap((suite) => suite.steps).length, 36);
  assert.deepEqual([...new Set(suites.map((suite) => suite.lifecycle))], ["shadow-active"]);
  assert.equal(value.phase3bLeafCapabilities.leaves.length, 40); assert.equal(value.phase3bLeafCapabilities.currentExecutedLeaves, 37); assert.equal(value.phase3bLeafCapabilities.currentAbsentLeaves, 3);
  assert.equal(new Set(suites.map((suite) => suite.executionClass)).size, 9); assert.equal(new Set(suites.map((suite) => suite.hostClass)).size, 9); assert.equal(value.classes.length, 14); assert.equal(value.executionClasses.length, 23);
  assert.equal(digest(value.commandCapabilities.commands.slice(0,51)), "bb9c0e598a08ab91d8714ec2db80100c8b4d966d980a3cc290c3bcad93990a3f");
  assert.equal(digest(value.commandCapabilities.commands.slice(51,158)), "3cdccc5cb491f7a642ffa2a49f450d6f7ed5b37450d1f18a1fe219d5c629e709");
  assert.equal(digest(value.commandCapabilities.commands.slice(158)), "df9f09e2454fa05f7d74ae96517657a8582aff4c3ad742c6f2ab657cef179bc1");
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

test("shadow registry has exact identities, counts, digests, and marker-stripped bytes", () => {
  const value = manifest(); assertWave(value); assert.deepEqual(validateRegistry(value, { root: ROOT }), []);
  for (const [name, expected] of Object.entries(WRAPPERS)) {
    const source = fs.readFileSync(path.join(ROOT, ".github/workflows", name), "utf8");
    assert.equal(source.split("\n").filter((line) => line === MARKER).length, 1); assert.equal(source.startsWith(`${MARKER}\n`), true);
    assert.equal(digest(canonicalizeShadowWrapperSource(name, source)), expected);
  }
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
    assert.equal(absentValue.providers.length, 71); assert.equal(digest(absentValue.providers), PROVIDER_DIGEST); assert.deepEqual(absentValue.errors, []);
    const phase3bProviders = absentValue.providers.filter((item) => PHASE3B_PROVIDER_NAMES.has(item.workflow));
    assert.equal(phase3bProviders.length, 6); assert.equal(digest(phase3bProviders), PHASE3B_PROVIDER_DIGEST);

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
      fs.writeFileSync(testerPath, source); git(temp, ["add", RESERVED_TESTER]); git(temp, ["commit", "-qm", `tester variant ${index}`]);
      assert.equal(providerSnapshot(temp), absent);
    }
    git(temp, ["rm", "-q", RESERVED_TESTER]); git(temp, ["commit", "-qm", "tester absent again"]); assert.equal(providerSnapshot(temp), absent);

    const eligible = "mingla-business/src/utils/__tests__/serverDraftEventMapper.storeEcho.tester.test.ts";
    const eligiblePath = path.join(temp, eligible); const original = fs.readFileSync(eligiblePath, "utf8");
    fs.writeFileSync(eligiblePath, original.replaceAll("issue-1022-theme-control-tests.yml", "issue-1022-theme-control-test.yml"));
    let changed = providerSnapshot(temp); assert.notEqual(changed, absent); assert.match(changed, /authority drifted|inventory drifted|stale external provider/);
    fs.writeFileSync(eligiblePath, `${original}\nissue-948-w3-screens-copy-tests.yml\n`);
    changed = providerSnapshot(temp); assert.notEqual(changed, absent); assert.match(changed, /authority drifted|externally referenced workflow provider omitted/);
    fs.writeFileSync(eligiblePath, original); assert.equal(providerSnapshot(temp), absent);

    const fixtureSource = fs.readFileSync(path.join(temp, ".github/scripts/ci-batch/__tests__/fixtures/issue-2438-cost-baseline-v1.jsonl"), "utf8");
    fs.writeFileSync(eligiblePath, `${original}\n${fixtureSource}`); changed = providerSnapshot(temp); assert.notEqual(changed, absent); assert.match(changed, /authority drifted/);
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
  assert.equal(suite.conditionalExpectedFiles.filter((file) => fs.existsSync(path.join(ROOT,file))).length, 1);
  assert.equal(suite.conditionalExpectedFiles.filter((file) => !fs.existsSync(path.join(ROOT,file))).length, 3);
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
  assert.equal(value.phase3bLeafCapabilities.currentExecutedLeaves,37);
  assert.equal(value.phase3bLeafCapabilities.currentAbsentLeaves,3);
  assert.equal(lifecycle.secondary.executedLeafIds.length,11);
  assert.equal(lifecycle.secondary.absentLeafIds.length,3);
  assert.deepEqual(lifecycle.secondary.absentLeafIds,[
    "leaf:issue-1902-public-event-lifecycle-tests:07:brand",
    "leaf:issue-1902-public-event-lifecycle-tests:07:business",
    "leaf:issue-1902-public-event-lifecycle-tests:07:consumer",
  ]);
  const fabricatedAllPresent=structuredClone(lifecycle.secondary);
  for(const leaf of fabricatedAllPresent.results[0].leafResults){leaf.status="passed";leaf.executed=true;}
  fabricatedAllPresent.results[0].outerResults[6].executedLeaves=4;fabricatedAllPresent.results[0].outerResults[6].skippedAbsentLeaves=0;
  fabricatedAllPresent.results[0].presentLeaves=14;fabricatedAllPresent.results[0].executedLeaves=14;fabricatedAllPresent.results[0].absentLeaves=0;
  fabricatedAllPresent.executedLeafIds=[...fabricatedAllPresent.expectedLeafIds];fabricatedAllPresent.absentLeafIds=[];
  assert.match(reconcilePhase3bReports(value,"admin-node20-install",lifecycle.decision,lifecycle.primary,fabricatedAllPresent).join("\n"),/secondary-evidence-mismatch/);
  const presentClaimedAbsent=structuredClone(lifecycle.secondary);const presentId="leaf:issue-1902-public-event-lifecycle-tests:07:offering";
  const presentLeaf=presentClaimedAbsent.results[0].leafResults.find((leaf)=>leaf.id===presentId);presentLeaf.status="skipped-absent";presentLeaf.executed=false;
  assert.match(reconcilePhase3bReports(value,"admin-node20-install",lifecycle.decision,lifecycle.primary,presentClaimedAbsent).join("\n"),/secondary-evidence-mismatch/);
  const absentClaimedPassed=structuredClone(lifecycle.secondary);const absentLeaf=absentClaimedPassed.results[0].leafResults.find((leaf)=>leaf.id===lifecycle.secondary.absentLeafIds[0]);
  absentLeaf.status="passed";absentLeaf.executed=true;
  assert.match(reconcilePhase3bReports(value,"admin-node20-install",lifecycle.decision,lifecycle.primary,absentClaimedPassed).join("\n"),/secondary-evidence-mismatch/);
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
    execFileSync("git",["init","-q"],{cwd:root}); execFileSync("git",["config","user.email","ci@example.invalid"],{cwd:root}); execFileSync("git",["config","user.name","CI"],{cwd:root});
    execFileSync("git",["add","mingla-business/package-lock.json","app-mobile/proof.js"],{cwd:root}); execFileSync("git",["commit","-qm","fixture"],{cwd:root});
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
    execFileSync("git",["init","-q"],{cwd:root}); execFileSync("git",["config","user.email","ci@example.invalid"],{cwd:root}); execFileSync("git",["config","user.name","CI"],{cwd:root});
    fs.writeFileSync(path.join(root,"proof.test"),"proof\n"); execFileSync("git",["add","."] ,{cwd:root}); execFileSync("git",["commit","-qm","fixture"],{cwd:root});
    const invocation={kind:"reviewed-shell-v1",command:"bash",argv:["-c","true"]};
    const steps=[1,2].map((ordinal)=>({name:`step ${ordinal}`,cwd:".",run:"true",invocation,commandId:`assert:fixture:${String(ordinal).padStart(2,"0")}`}));
    const suite={id:"fixture",migrationWave:"phase3b-postgres-wave",setupProfile:"fixture",expectedFiles:["proof.test"],generatedPaths:[],timeoutSeconds:60,steps};
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
  const omitted = structuredClone(base); omitted.suites.pop(); attacks.push(omitted);
  const outer = structuredClone(base); outer.suites.at(-1).steps.pop(); attacks.push(outer);
  const leaf = structuredClone(base); leaf.phase3bLeafCapabilities.leaves.pop(); attacks.push(leaf);
  const setup = structuredClone(base); setup.setupProfiles["phase3b-lifecycle-node20-deno2"].installs.reverse(); attacks.push(setup);
  const env = structuredClone(base); env.suites.find((suite)=>suite.id==="issue-1902-public-event-lifecycle-tests").steps[2].env.NODE_PATH="../node_modules"; attacks.push(env);
  for (const attack of attacks) assert.throws(() => assertWave(attack));
});
