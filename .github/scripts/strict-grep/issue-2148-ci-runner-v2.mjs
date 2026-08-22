#!/usr/bin/env node
// #2436 / #2148 Phase 2. Governance proof for the deterministic isolated runner.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeManifestTextRepresentations, validateManifestTextRepresentations, validateRegistry, validatePhase2Contract, forbiddenEmbeddedSetup, DEFAULT_ROOT } from "../ci-batch/validate-manifest-v2.mjs";
import { commandFingerprint } from "../ci-batch/run-suite-batch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const MANIFEST_PATH = path.join(ROOT, ".github/ci-batch/MANIFEST.json");
const WORKFLOW_PATH = path.join(ROOT, ".github/workflows/ci-batch.yml");
const PRESERVED_ASSERTION_SHA256 = "46b4392592c5d6cb56bc600adc98e083b14880b79dad29fe4e1438ac41923764";
const ASSERTION_CAPABILITY_SHA256 = "bb9c0e598a08ab91d8714ec2db80100c8b4d966d980a3cc290c3bcad93990a3f";
const SHADOW_ASSERTION_SHA256 = "9dea11e17920bd597c737fd1a9afa096ae740aab28eabb82d93029fbb0be7b3e";
const SHADOW_CAPABILITY_SHA256 = "3cdccc5cb491f7a642ffa2a49f450d6f7ed5b37450d1f18a1fe219d5c629e709";
const TIMEOUT_CONTRACT_SHA256 = "8a166a8eb146763528659c9f8306bd2e7ce068dc9d922cdac90ad0c71c90bdbe";
const PROCESS_SUPERVISOR_SHA256 = "1c890b876833df9e6f9c8cf2b0dc8cec4ba1364b7b5519e68b0245b5077dfb20";

function clone(value) { return structuredClone(value); }
function manifest() { return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")); }
function workflow() { return fs.readFileSync(WORKFLOW_PATH, "utf8"); }
function assertionDigest(suites) {
  const assertions = suites.map((suite) => ({ id: suite.id, steps: suite.steps.map(({ name, cwd, run, invocation }) => ({ name, cwd, run, invocation })) }));
  return crypto.createHash("sha256").update(JSON.stringify(assertions)).digest("hex");
}
function orderedDigest(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function errors(value, matrixSource = workflow()) { return validateRegistry(value, { root: DEFAULT_ROOT, matrixSource }); }

export function verifyLive() {
  const raw = manifest();
  const failures = errors(raw);
  assert.deepEqual(failures, [], failures.join("\n"));
  assert.deepEqual(validateManifestTextRepresentations(raw), []);
  const value = decodeManifestTextRepresentations(raw);
  const baseline = value.suites.slice(0, 23);
  const shadow = value.suites.slice(23);
  assert.equal(value.suites.length, 55);
  assert.equal(baseline.flatMap((suite) => suite.steps).length, 51);
  assert.equal(shadow.length, 32);
  assert.equal(shadow.flatMap((suite) => suite.steps).length, 107);
  assert.equal(baseline.flatMap((suite) => suite.steps).filter((step) => forbiddenEmbeddedSetup(step.run)).length, 0);
  assert.equal(assertionDigest(baseline), PRESERVED_ASSERTION_SHA256, "the current-main 23 suites / 51 commands drifted");
  assert.equal(assertionDigest(shadow), SHADOW_ASSERTION_SHA256, "the ordered 32 shadow variants / 107 commands drifted");
  assert.equal(orderedDigest(value.commandCapabilities.commands.slice(0, 51)), ASSERTION_CAPABILITY_SHA256, "current-main 51 assertion capabilities drifted");
  assert.equal(orderedDigest(value.commandCapabilities.commands.slice(51)), SHADOW_CAPABILITY_SHA256, "shadow assertion capabilities drifted");
  assert.equal(value.commandCapabilities.commands.length, 158);
  const business994 = value.suites.find((suite) => suite.id === "issue-994-ota-env-resolution-mingla-business");
  assert.equal(commandFingerprint(business994), "064b393af16099018770cf8f08456114e777a3b5ad79586f5bcfa3ebff217c25", "#994 business execution bytes drifted");
  const supervisor = fs.readFileSync(path.join(ROOT, ".github/scripts/ci-batch/process-supervisor.py"), "utf8");
  assert.equal(crypto.createHash("sha256").update(supervisor).digest("hex"), PROCESS_SUPERVISOR_SHA256, "atomic process supervisor drifted");
  assert.match(supervisor, /PR_SET_CHILD_SUBREAPER/);
  assert.match(supervisor, /install_subreaper\(\).*\n[\s\S]*subprocess\.Popen/);
  assert.ok(baseline.every((suite) => suite.timeoutSeconds === 480 && suite.isolation === "clean-worktree"));
  assert.ok(shadow.every((suite) => suite.lifecycle === "shadow-active" && suite.isolation === "clean-worktree"));
  assert.equal(orderedDigest(value.suites.map(({ id, timeoutSeconds }) => ({ id, timeoutSeconds }))), TIMEOUT_CONTRACT_SHA256, "exact baseline + shadow timeout contract drifted");
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
  assert.notEqual(assertionDigest(substituted.suites.slice(0, 22)), PRESERVED_ASSERTION_SHA256, "assertion substitution must change the locked digest");
  expectRed("setup evidence wiring removed", () => {}, (source) => source.replace('--setup "${{ matrix.class }}"', '--setup "missing"'));
  expectRed("runner route removed", () => {}, (source) => source.replace('--run "${{ matrix.class }}"', '--run "wrong"'));
  expectRed("atomic Linux containment removed", () => {}, (source) => source.replace("runs-on: ubuntu-latest", "runs-on: macos-latest"));
  expectRed("duplicate install route", () => {}, (source) => source.replace('run: node .github/scripts/ci-batch/run-suite-batch.mjs --setup "${{ matrix.class }}"', 'run: node .github/scripts/ci-batch/run-suite-batch.mjs --setup "${{ matrix.class }}"\n      - name: Hidden second install\n        run: npm install'));
  expectRegistryRed("missing shadow variant", (value) => { value.suites.splice(22, 1); });
  expectRegistryRed("swapped shadow variant", (value) => { [value.suites[22], value.suites[23]] = [value.suites[23], value.suites[22]]; });
  expectRegistryRed("duplicated shadow variant", (value) => { value.suites[23] = clone(value.suites[22]); });
  expectRegistryRed("shadow capability drift", (value) => { value.commandCapabilities.commands[46].argv[1] += " # drift"; });
  expectRegistryRed("shadow setup profile drift", (value) => { value.setupProfiles["app-node22-install"].installs[0].invocation.argv.push("--unsafe"); });
  expectRegistryRed("reviewed split-text representation removed", (value) => {
    const suite = value.suites.find((item) => item.id === "issue-994-ota-env-resolution-mingla-business");
    const index = suite.originPaths.findIndex((item) => item?.encoding === "concat-v1");
    suite.originPaths[index] = "forged-storage";
  });
  const timeoutDrift = manifest();
  timeoutDrift.suites[22].timeoutSeconds += 1;
  assert.notEqual(orderedDigest(timeoutDrift.suites.map(({ id, timeoutSeconds }) => ({ id, timeoutSeconds }))), TIMEOUT_CONTRACT_SHA256, "shadow timeout drift must change the gate lock");
  expectRed("shared trust drift", () => {}, (source) => source.replace("persist-credentials: false", "persist-credentials: true"));
  expectRed("unavailable pre-matrix job context", () => {}, (source) => source.replace("if: github.event_name != 'workflow_dispatch'", "if: github.event_name != 'workflow_dispatch' || matrix.class == 'node20-19-noinstall'"));
  expectRed("unbounded dispatch", () => {}, (source) => source.replace("inputs.suite == 'issue-2300-orch-artifact-reap'", "true"));
  expectRed("dispatch route removed", () => {}, (source) => source.replace("  dispatch:\n", "  missing-dispatch:\n"));
  console.log("#2437 shadow runner self-test: PASS — Phase 2 baseline and additive shadow attacks went RED");
}

if (process.argv[2] === "--self-test") selfTest();
else { verifyLive(); console.log("#2437 shadow runner: PASS — current-main 23/51 immutable; additive 32/107 locked"); }
