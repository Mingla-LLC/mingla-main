#!/usr/bin/env node
// #2436 / #2148 Phase 2. Governance proof for the deterministic isolated runner.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRegistry, validatePhase2Contract, forbiddenEmbeddedSetup, DEFAULT_ROOT } from "../ci-batch/validate-manifest-v2.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const MANIFEST_PATH = path.join(ROOT, ".github/ci-batch/MANIFEST.json");
const WORKFLOW_PATH = path.join(ROOT, ".github/workflows/ci-batch.yml");
const PRESERVED_ASSERTION_SHA256 = "46b4392592c5d6cb56bc600adc98e083b14880b79dad29fe4e1438ac41923764";
const ASSERTION_CAPABILITY_SHA256 = "bb9c0e598a08ab91d8714ec2db80100c8b4d966d980a3cc290c3bcad93990a3f";
const PROCESS_SUPERVISOR_SHA256 = "710c70df84e0d3c4773c75f18979dfffeb2aaa397d69356bb4beabd5340f39e8";

function clone(value) { return structuredClone(value); }
function manifest() { return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")); }
function workflow() { return fs.readFileSync(WORKFLOW_PATH, "utf8"); }
function assertionDigest(value) {
  const assertions = value.suites.map((suite) => ({ id: suite.id, steps: suite.steps.map(({ name, cwd, run, invocation }) => ({ name, cwd, run, invocation })) }));
  return crypto.createHash("sha256").update(JSON.stringify(assertions)).digest("hex");
}
function errors(value, matrixSource = workflow()) { return validateRegistry(value, { root: DEFAULT_ROOT, matrixSource }); }

export function verifyLive() {
  const value = manifest();
  const failures = errors(value);
  assert.deepEqual(failures, [], failures.join("\n"));
  assert.equal(value.suites.length, 23);
  assert.equal(value.suites.flatMap((suite) => suite.steps).length, 51);
  assert.equal(value.suites.flatMap((suite) => suite.steps).filter((step) => forbiddenEmbeddedSetup(step.run)).length, 0);
  assert.equal(assertionDigest(value), PRESERVED_ASSERTION_SHA256, "the 51 preserved underlying commands/assertions drifted");
  assert.equal(value.commandCapabilities.registrySha256, ASSERTION_CAPABILITY_SHA256, "reviewed assertion command capabilities drifted");
  assert.equal(value.commandCapabilities.commands.length, 51);
  const supervisor = fs.readFileSync(path.join(ROOT, ".github/scripts/ci-batch/process-supervisor.py"), "utf8");
  assert.equal(crypto.createHash("sha256").update(supervisor).digest("hex"), PROCESS_SUPERVISOR_SHA256, "atomic process supervisor drifted");
  assert.match(supervisor, /PR_SET_CHILD_SUBREAPER/);
  assert.match(supervisor, /install_subreaper\(\).*\n[\s\S]*subprocess\.Popen/);
  assert.ok(value.suites.every((suite) => suite.timeoutSeconds === 480 && suite.isolation === "clean-worktree"));
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
  assert.notEqual(assertionDigest(substituted), PRESERVED_ASSERTION_SHA256, "assertion substitution must change the locked digest");
  expectRed("setup evidence wiring removed", () => {}, (source) => source.replace("--record-setup", "--record-setup-missing"));
  expectRed("runner route removed", () => {}, (source) => source.replace('--run "${{ matrix.class }}"', '--run "wrong"'));
  expectRed("atomic Linux containment removed", () => {}, (source) => source.replace("runs-on: ubuntu-latest", "runs-on: macos-latest"));
  expectRed("duplicate install route", () => {}, (source) => source.replace("        run: npm ci", "        run: npm ci\n      - name: Hidden second install\n        run: npm install"));
  console.log("#2436 runner v2 self-test: PASS — setup, timeout, isolation, preservation, and wiring mutations went RED");
}

if (process.argv[2] === "--self-test") selfTest();
else { verifyLive(); console.log("#2436 runner v2: PASS — 23 suites, 51 assertions, zero embedded setup, isolated deadline runner wired"); }
