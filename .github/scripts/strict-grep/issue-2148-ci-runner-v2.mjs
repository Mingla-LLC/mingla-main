#!/usr/bin/env node
// #2436 / #2148 Phase 2. Governance proof for the deterministic isolated runner.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeManifestTextRepresentations, validateManifestTextRepresentations, validateRegistry, validatePhase2Contract, forbiddenEmbeddedSetup, SUITES_ADDED_SINCE_SEAL, withTrackedFilesScope, discoverWorkflowProviders, discoverLiveOrigins, DEFAULT_ROOT } from "../ci-batch/validate-manifest-v2.mjs";
import { commandFingerprint, executesLeaves, absentFileIsFailure } from "../ci-batch/run-suite-batch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const MANIFEST_PATH = path.join(ROOT, ".github/ci-batch/MANIFEST.json");
const WORKFLOW_PATH = path.join(ROOT, ".github/workflows/ci-batch.yml");
const PRESERVED_ASSERTION_SHA256 = "46b4392592c5d6cb56bc600adc98e083b14880b79dad29fe4e1438ac41923764";
const ASSERTION_CAPABILITY_SHA256 = "bb9c0e598a08ab91d8714ec2db80100c8b4d966d980a3cc290c3bcad93990a3f";
const SHADOW_ASSERTION_SHA256 = "9dea11e17920bd597c737fd1a9afa096ae740aab28eabb82d93029fbb0be7b3e";
const SHADOW_CAPABILITY_SHA256 = "3cdccc5cb491f7a642ffa2a49f450d6f7ed5b37450d1f18a1fe219d5c629e709";
const TIMEOUT_CONTRACT_SHA256 = "8a166a8eb146763528659c9f8306bd2e7ce068dc9d922cdac90ad0c71c90bdbe";
const PHASE3B_ASSERTION_SHA256 = "315f490f71623287fb2b0cfa1a6cfe8e9846408c5fa35cc6529488e08450e1bf";
const PHASE3B_CAPABILITY_SHA256 = "df9f09e2454fa05f7d74ae96517657a8582aff4c3ad742c6f2ab657cef179bc1";
const PHASE3B_TIMEOUT_SHA256 = "94e778c9202e5f55537115cfe17cd4a099f897a76e38cd1a607c0159ec86aa87";
const PROCESS_SUPERVISOR_SHA256 = "1c890b876833df9e6f9c8cf2b0dc8cec4ba1364b7b5519e68b0245b5077dfb20";
const PHASE3C_ASSERTION_SHA256 = "7df4a25e2fe8642092c96b444427fb01e8a4103ebb392da8f21c8dcc540c763f";
const PHASE3C_CAPABILITY_SHA256 = "625a72f9109b1b05887ac6e399d21d03c4ebd476345dd90df150bb8fc658b255";
const PHASE3C_TIMEOUT_SHA256 = "a1d4ed3f7b064f6f9fb2dba35572c7dea56049e0315073d0a433420b1f14a869";
const PHASE3C_LEAF_SHA256 = "a5707e6e6450e63192c2c0c93b2a4422fb1802970a0082c51b45eac1b5be68a1";
// [#2897] Suites registered AFTER the Phase 1 -> Phase 3C seal, read from the
// validator's single declared set - never re-typed here. They are SUBTRACTED
// before every frozen digest below, in the same shape #2591 used for
// PROVIDERS_ADDED_SINCE_SEAL. Nothing is re-frozen: the Phase 1 baseline digest
// and the Phase 3C capability digest keep their original literals and stay
// armed, so an UNDECLARED 85th suite still breaks them. What is declared gets
// its own digest below.
const POST_SEAL_IDS = new Set(SUITES_ADDED_SINCE_SEAL.map((item) => item.suite));
const POST_SEAL_CAPABILITY_SHA256 = "17c1cbd750d21c4905e08221e1576b08399eecc1d1f67e98ef04f51c80bcfb07";

function clone(value) { return structuredClone(value); }
function manifest() { return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")); }
function workflow() { return fs.readFileSync(WORKFLOW_PATH, "utf8"); }
function assertionDigest(suites) {
  const assertions = suites.map((suite) => ({ id: suite.id, steps: suite.steps.map(({ name, cwd, run, invocation }) => ({ name, cwd, run, invocation })) }));
  return crypto.createHash("sha256").update(JSON.stringify(assertions)).digest("hex");
}
function orderedDigest(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
// [#2439 SC-16.6(1)] Discovery is precomputed ONCE per entry point and handed to
// every mutant. No mutant below touches the tree or the index, so the provider
// inventory and the live-origin list are invariant across all of them; without
// this, each of the ~24 registry attacks re-read the whole tracked corpus and the
// self-test alone ran past two minutes. Nothing is removed or weakened - the same
// attacks run against the same validator, only the shared inputs are hoisted.
let DISCOVERY = null;
function discovery() {
  if (!DISCOVERY) DISCOVERY = { workflowProviders: discoverWorkflowProviders(DEFAULT_ROOT), liveOrigins: discoverLiveOrigins(DEFAULT_ROOT) };
  return DISCOVERY;
}
function errors(value, matrixSource = workflow()) {
  return validateRegistry(value, { root: DEFAULT_ROOT, matrixSource, ...discovery() });
}

export function verifyLive() {
  const raw = manifest();
  const failures = errors(raw);
  assert.deepEqual(failures, [], failures.join("\n"));
  assert.deepEqual(validateManifestTextRepresentations(raw), []);
  const value = decodeManifestTextRepresentations(raw);
  // [#2439 SC-11.1 / SC-17.1] Wave-SCOPED selection, not positional slicing. A
  // positional slice silently re-partitions the moment another wave is appended,
  // and selecting by lifecycle VALUE would auto-pass at shadow and go wrong the
  // moment a later wave reached terminal. Every existing digest below is
  // unchanged under this selection, which is what proves it is the same set.
  const baseline = value.suites.filter((suite) => !suite.migrationWave && !POST_SEAL_IDS.has(suite.id));
  const postSeal = value.suites.filter((suite) => POST_SEAL_IDS.has(suite.id));
  const shadow = value.suites.filter((suite) => suite.migrationWave === "phase3a-node-wave");
  const phase3b = value.suites.filter((suite) => suite.migrationWave === "phase3b-postgres-wave");
  const phase3c = value.suites.filter((suite) => suite.migrationWave === "phase3c-deno-wave");
  assert.equal(value.suites.length, 84 + SUITES_ADDED_SINCE_SEAL.length);
  assert.equal(postSeal.length, POST_SEAL_IDS.size);
  assert.equal(baseline.flatMap((suite) => suite.steps).length, 51);
  assert.equal(shadow.length, 32);
  assert.equal(shadow.flatMap((suite) => suite.steps).length, 107);
  assert.equal(phase3b.length, 12);
  assert.equal(phase3b.flatMap((suite) => suite.steps).length, 36);
  assert.equal(baseline.flatMap((suite) => suite.steps).filter((step) => forbiddenEmbeddedSetup(step.run)).length, 0);
  assert.equal(assertionDigest(baseline), PRESERVED_ASSERTION_SHA256, "the current-main 23 suites / 51 commands drifted");
  assert.equal(assertionDigest(shadow), SHADOW_ASSERTION_SHA256, "the ordered 32 shadow variants / 107 commands drifted");
  assert.equal(orderedDigest(value.commandCapabilities.commands.slice(0, 51)), ASSERTION_CAPABILITY_SHA256, "current-main 51 assertion capabilities drifted");
  assert.equal(orderedDigest(value.commandCapabilities.commands.slice(51, 158)), SHADOW_CAPABILITY_SHA256, "Phase 3A assertion capabilities drifted");
  assert.equal(assertionDigest(phase3b), PHASE3B_ASSERTION_SHA256, "the ordered 12 Phase 3B variants / 36 commands drifted");
  assert.equal(orderedDigest(value.commandCapabilities.commands.slice(158, 194)), PHASE3B_CAPABILITY_SHA256, "Phase 3B assertion capabilities drifted");
  assert.equal(phase3c.length, 17);
  assert.equal(phase3c.flatMap((suite) => suite.steps).length, 46);
  assert.equal(phase3c.flatMap((suite) => suite.steps).flatMap((step) => step.children || []).length, 54);
  assert.equal(assertionDigest(phase3c), PHASE3C_ASSERTION_SHA256, "the ordered 17 Phase 3C variants / 46 commands drifted");
  // Bounded at 240, not open-ended: the slice must keep meaning "Phase 3C's 46",
  // and an open tail would silently absorb every later addition into a digest
  // named after a wave it does not belong to.
  assert.equal(orderedDigest(value.commandCapabilities.commands.slice(194, 240)), PHASE3C_CAPABILITY_SHA256, "Phase 3C assertion capabilities drifted");
  assert.equal(orderedDigest(value.commandCapabilities.commands.slice(240)), POST_SEAL_CAPABILITY_SHA256, "post-seal assertion capabilities drifted");
  assert.deepEqual([...new Set(value.commandCapabilities.commands.slice(240).map((c) => c.suiteId))].sort(),
    [...POST_SEAL_IDS].sort(), "post-seal capabilities must belong to declared post-seal suites");
  assert.equal(value.phase3cLeafCapabilities.registrySha256, PHASE3C_LEAF_SHA256, "Phase 3C leaf capabilities drifted");
  assert.equal(value.commandCapabilities.commands.length,
    240 + SUITES_ADDED_SINCE_SEAL.reduce((sum, item) => sum + item.steps, 0));
  // [#2439 SC-2.3] The runner must route this wave through the LEAF branch.
  // Without this, 46 outers report executed and all 54 leaves silently never
  // run - a green check carrying no information on seventeen migrations.
  assert.ok(phase3c.every((suite) => executesLeaves(suite)), "phase3c-deno-wave must route through the runner leaf branch");
  assert.ok(phase3b.every((suite) => executesLeaves(suite)), "phase3b-postgres-wave leaf routing must be preserved");
  assert.ok(baseline.concat(shadow, postSeal).every((suite) => !executesLeaves(suite)), "Phase 1, Phase 3A and post-seal suites must keep the single-command branch");
  assert.equal(postSeal.flatMap((suite) => suite.steps).filter((step) => forbiddenEmbeddedSetup(step.run)).length, 0);
  // [#2439 SC-5.1] Fail-loud absence is derived per TARGET, not per wave: a
  // target registered as a conditional proof skips, anything else fails.
  const anyRequired = (suite) => suite.steps.flatMap((step) => step.children || [])
    .filter((child) => child.predicate?.kind === "file-exists")
    .flatMap((child) => child.predicate.paths || [child.predicate.path]);
  for (const suite of phase3c) {
    for (const target of anyRequired(suite)) assert.ok(absentFileIsFailure(suite, target), `${suite.id}: an absent required file must fail the suite`);
  }
  for (const suite of phase3b) {
    for (const target of anyRequired(suite)) assert.ok(!absentFileIsFailure(suite, target), `${suite.id}: Phase 3B conditional-proof semantics must be unchanged`);
  }
  const business994 = value.suites.find((suite) => suite.id === "issue-994-ota-env-resolution-mingla-business");
  assert.equal(commandFingerprint(business994), "064b393af16099018770cf8f08456114e777a3b5ad79586f5bcfa3ebff217c25", "#994 business execution bytes drifted");
  const supervisor = fs.readFileSync(path.join(ROOT, ".github/scripts/ci-batch/process-supervisor.py"), "utf8");
  assert.equal(crypto.createHash("sha256").update(supervisor).digest("hex"), PROCESS_SUPERVISOR_SHA256, "atomic process supervisor drifted");
  assert.match(supervisor, /PR_SET_CHILD_SUBREAPER/);
  assert.match(supervisor, /install_subreaper\(\).*\n[\s\S]*subprocess\.Popen/);
  assert.ok(baseline.every((suite) => suite.timeoutSeconds === 480 && suite.isolation === "clean-worktree"));
  assert.equal(new Set(shadow.map((suite) => suite.lifecycle)).size, 1, "wave lifecycle must transition atomically");
  assert.ok(shadow.every((suite) => ["shadow-active", "batched-historical"].includes(suite.lifecycle)
    && suite.isolation === "clean-worktree"));
  assert.equal(orderedDigest(value.suites.slice(0, 55).map(({ id, timeoutSeconds }) => ({ id, timeoutSeconds }))), TIMEOUT_CONTRACT_SHA256, "exact Phase 2 + Phase 3A timeout contract drifted");
  assert.equal(orderedDigest(phase3b.map(({ id, timeoutSeconds }) => ({ id, timeoutSeconds }))), PHASE3B_TIMEOUT_SHA256, "exact Phase 3B timeout contract drifted");
  assert.equal(orderedDigest(phase3c.map(({ id, timeoutSeconds }) => ({ id, timeoutSeconds }))), PHASE3C_TIMEOUT_SHA256, "exact Phase 3C timeout contract drifted");
}

function expectRed(label, mutateManifest, mutateWorkflow = (source) => source) {
  const value = manifest();
  mutateManifest(value);
  assert.ok(validatePhase2Contract(value, mutateWorkflow(workflow())).length > 0, `${label} must fail closed`);
}

function expectRegistryRed(label, mutateManifest) {
  const value = manifest();
  mutateManifest(value);
  assert.ok(errors(value).length > 0, `${label} must fail closed`);
}

// The Phase 3C tertiary route is validated by the full registry validator, not
// by the Phase 2 contract, so its workflow attacks need the registry entry point.
function expectRegistryWorkflowRed(label, mutateWorkflow) {
  assert.ok(errors(manifest(), mutateWorkflow(workflow())).length > 0, `${label} must fail closed`);
}

export function selfTest() {
  const patterns = [
    "npm ci", "npm install --no-save x", "yarn install", "pnpm i", "apt-get install jq",
    "brew update", "docker compose up", "supabase db reset", "actions/setup-node@v4",
    "command npm ci", "env FOO=1 npm ci", "npm \\\n ci", "(npm ci)",
    "if npm ci; then true; fi", "sudo -u root npm ci", "corepack pnpm install", "eval 'npm ci'",
  ];
  for (const command of patterns) assert.equal(forbiddenEmbeddedSetup(`true && ${command}`), true, `${command} must be rejected`);
  assert.equal(forbiddenEmbeddedSetup("node --test safe.test.mjs"), false);
  assert.equal(forbiddenEmbeddedSetup("echo 'npm ci is forbidden'"), false, "narration is not executable setup");
  assert.equal(forbiddenEmbeddedSetup("unknown-bootstrap-wrapper tests"), true, "unknown executable families fail closed");

  expectRed("embedded setup", (value) => { value.suites[0].steps[0].run += " && npm ci"; value.suites[0].steps[0].invocation.argv[1] = value.suites[0].steps[0].run; });
  expectRed("missing timeout", (value) => { delete value.suites[0].timeoutSeconds; });
  expectRed("minute timeout bypass", (value) => { value.suites[0].timeoutMinutes = 8; });
  expectRed("isolation drift", (value) => { value.suites[0].isolation = "shared"; });
  expectRed("runner contract drift", (value) => { value.runnerContract.processGroup = "none"; });
  expectRegistryRed("unreviewed command capability", (value) => { value.commandCapabilities.commands[0].argv.push("--new-capability"); });
  expectRegistryRed("step capability relocation", (value) => { [value.suites[0].steps[0].commandId, value.suites[1].steps[0].commandId] = [value.suites[1].steps[0].commandId, value.suites[0].steps[0].commandId]; });
  expectRegistryRed("job secret environment capability", (value) => { value.suites[0].envNames = ["GITHUB_TOKEN"]; });
  const substituted = manifest();
  substituted.suites[0].steps[0].run += " ";
  substituted.suites[0].steps[0].invocation.argv[1] += " ";
  assert.notEqual(assertionDigest(substituted.suites.slice(0, 23)), PRESERVED_ASSERTION_SHA256, "assertion substitution must change the locked digest");
  expectRed("setup evidence wiring removed", () => {}, (source) => source.replace('--setup "${{ matrix.class }}"', '--setup "missing"'));
  expectRed("runner route removed", () => {}, (source) => source.replace('--run "${{ matrix.class }}"', '--run "wrong"'));
  expectRed("atomic Linux containment removed", () => {}, (source) => source.replace("runs-on: ubuntu-latest", "runs-on: macos-latest"));
  expectRed("duplicate install route", () => {}, (source) => source.replace('run: node .github/scripts/ci-batch/run-suite-batch.mjs --setup "${{ matrix.class }}"', 'run: node .github/scripts/ci-batch/run-suite-batch.mjs --setup "${{ matrix.class }}"\n      - name: Hidden second install\n        run: npm install'));
  expectRegistryRed("missing shadow variant", (value) => { value.suites.splice(23, 1); });
  expectRegistryRed("swapped shadow variant", (value) => { [value.suites[23], value.suites[24]] = [value.suites[24], value.suites[23]]; });
  expectRegistryRed("duplicated shadow variant", (value) => { value.suites[24] = clone(value.suites[23]); });
  expectRegistryRed("shadow capability drift", (value) => { value.commandCapabilities.commands[51].argv[1] += " # drift"; });
  expectRegistryRed("Phase 3B variant omission", (value) => { value.suites.splice(55, 1); });
  expectRegistryRed("Phase 3B capability drift", (value) => { value.commandCapabilities.commands[158].argv[1] += " # drift"; });
  expectRegistryRed("shadow setup profile drift", (value) => { value.setupProfiles["app-node22-install"].installs[0].invocation.argv.push("--unsafe"); });
  expectRegistryRed("reviewed split-text representation removed", (value) => {
    const suite = value.suites.find((item) => item.id === "issue-994-ota-env-resolution-mingla-business");
    const index = suite.originPaths.findIndex((item) => item?.encoding === "concat-v1");
    suite.originPaths[index] = "forged-storage";
  });
  const timeoutDrift = manifest();
  timeoutDrift.suites[23].timeoutSeconds += 1;
  assert.notEqual(orderedDigest(timeoutDrift.suites.slice(0, 55).map(({ id, timeoutSeconds }) => ({ id, timeoutSeconds }))), TIMEOUT_CONTRACT_SHA256, "Phase 3A timeout drift must change the gate lock");
  const phase3bTimeoutDrift = manifest(); phase3bTimeoutDrift.suites[55].timeoutSeconds += 1;
  assert.notEqual(orderedDigest(phase3bTimeoutDrift.suites.slice(55, 67).map(({ id, timeoutSeconds }) => ({ id, timeoutSeconds }))), PHASE3B_TIMEOUT_SHA256, "Phase 3B timeout drift must change the gate lock");
  const phase3cTimeoutDrift = manifest(); phase3cTimeoutDrift.suites[67].timeoutSeconds += 1;
  assert.notEqual(orderedDigest(phase3cTimeoutDrift.suites.slice(67).map(({ id, timeoutSeconds }) => ({ id, timeoutSeconds }))), PHASE3C_TIMEOUT_SHA256, "Phase 3C timeout drift must change the gate lock");
  expectRegistryRed("Phase 3C variant omission", (value) => { value.suites.splice(67, 1); });
  expectRegistryRed("Phase 3C capability drift", (value) => { value.commandCapabilities.commands[194].argv[1] += " # drift"; });
  expectRegistryRed("Phase 3C leaf omission", (value) => { value.phase3cLeafCapabilities.leaves.pop(); });
  expectRegistryRed("Phase 3C required-file predicate deleted", (value) => {
    value.suites.find((suite) => suite.id === "issue-1637-discover-single-fetch-tests").steps[0].children[0].predicate.paths.pop();
  });
  expectRegistryRed("Phase 3C retry collapsed to one attempt", (value) => {
    value.suites.find((suite) => suite.id === "issue-1326-ng-reservation-finalize-tests").steps[0].retry.attempts = 1;
  });
  expectRegistryRed("Phase 3C source-contract sense inverted", (value) => {
    const leaf = value.phase3cLeafCapabilities.leaves.find((item) => item.predicate?.needle === "brand.account_id !== userId");
    leaf.predicate.sense = "must-contain";
  });
  expectRegistryWorkflowRed("Phase 3C run route removed", (source) => source.replace('--run-phase3c-host "${{ matrix.class }}"', '--run-phase3c-host "wrong"'));
  expectRegistryWorkflowRed("Phase 3C tertiary host route removed", (source) => source.replace("tertiaryClass: phase3c-deno146-node20", 'tertiaryClass: ""'));
  expectRegistryWorkflowRed("Phase 3C host ceiling silently raised", (source) => source.replace("hostTimeoutMinutes: 45", "hostTimeoutMinutes: 90"));
  expectRegistryWorkflowRed("Phase 3C result artifact renamed", (source) => source.replace("path: suite-results-phase3c.json", "path: suite-results.json"));
  expectRegistryWorkflowRed("Phase 3C exact Deno selector folded into the floating one",
    (source) => source.replace("          deno-version: v2.7.14\n", "          deno-version: v2.x\n"));
  expectRegistryWorkflowRed("Phase 3C Deno action tag floated",
    (source) => source.replace("        uses: denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed\n        with:\n          deno-version: v2.7.14",
      "        uses: denoland/setup-deno@v2\n        with:\n          deno-version: v2.7.14"));
  expectRed("shared trust drift", () => {}, (source) => source.replace("persist-credentials: false", "persist-credentials: true"));
  expectRed("unavailable pre-matrix job context", () => {}, (source) => source.replace("if: github.event_name != 'workflow_dispatch'", "if: github.event_name != 'workflow_dispatch' || matrix.class == 'node20-19-noinstall'"));
  expectRed("unbounded dispatch", () => {}, (source) => source.replace("inputs.suite == 'issue-2300-orch-artifact-reap'", "true"));
  expectRed("dispatch route removed", () => {}, (source) => source.replace("  dispatch:\n", "  missing-dispatch:\n"));
  console.log("#2438/#2439 wave runner self-test: PASS — Phase 2/3A locks held and additive Phase 3B + Phase 3C attacks went RED");
}

// [#2438 A7-SC3] Explicitly entered, explicitly exited tracked-file scope. This
// module performs no fs write, mkdir, rm or subprocess, so the tree and index are
// provably immutable for the duration. Ambient memoisation stays forbidden.
if (process.argv[2] === "--self-test") withTrackedFilesScope(ROOT, () => selfTest());
else { withTrackedFilesScope(ROOT, () => verifyLive()); console.log("#2438/#2439 wave runner: PASS — 23/51 and 32/107 immutable; additive 12/36 and 17/46/54 locked"); }
