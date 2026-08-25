import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  SHADOW_PARITY_MARKER,
  SHADOW_PARITY_WRAPPER_NAMES,
  canonicalizeShadowWrapperSource,
  decodeManifestTextRepresentations,
  discoverLiveOrigins,
  discoverWorkflowProviders,
  inspectBatchWorkflow,
  inspectWorkflow,
  validateRegistry,
  validateManifestTextRepresentations,
  validateShadowParityMarkers,
} from "../validate-manifest-v2.mjs";
import { commandFingerprint } from "../run-suite-batch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MANIFEST_PATH = path.join(ROOT, ".github/ci-batch/MANIFEST.json");
const WORKFLOW_PATH = path.join(ROOT, ".github/workflows/ci-batch.yml");
const STRICT_WORKFLOW_PATH = path.join(ROOT, ".github/workflows/strict-grep-mingla-business.yml");
const ISSUE_1593_REFERENCE_PATH = path.join(ROOT, "app-mobile/src/components/swipeDeck/__tests__/issue_1593_poster_hole_geometry.adversarial.test.mjs");
const STATIC_CLASS_A_STEP_SHA256 = "d89bf9920ba031d7f4243f3d36772376af753427bcabe1a289b1b781b871b6eb";
const manifest = () => JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const clone = (value) => structuredClone(value);
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sourceDigest = (value) => crypto.createHash("sha256").update(value).digest("hex");

const validateIssue1593Reporter = (source) => {
  const exact = "spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(dir, REL.adversarial)], {";
  const errors = [];
  if (source.split(exact).length - 1 !== 1) errors.push("#1593 child command must use exactly one deterministic TAP reporter flag");
  if (source.split("path.join(dir, REL.adversarial)").length - 1 !== 1) errors.push("#1593 child command target must remain unique");
  return errors;
};

const workflowSources = () => Object.fromEntries(fs
  .readdirSync(path.join(ROOT, ".github/workflows"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
  .map((entry) => [entry.name, fs.readFileSync(path.join(ROOT, ".github/workflows", entry.name), "utf8")]));

const parseRealYaml = (source) => JSON.parse(execFileSync(
  "ruby",
  ["-rjson", "-ryaml", "-e", "source=STDIN.read; print JSON.generate(YAML.safe_load(source, aliases: true))"],
  { input: source, encoding: "utf8" },
));

const validateStaticClassAJob = (source) => {
  const errors = [];
  let document;
  try {
    document = parseRealYaml(source);
  } catch (error) {
    return [`Strict Class A workflow must parse as real YAML: ${error.message}`];
  }
  const job = document?.jobs?.["static-gates"];
  if (!job || typeof job !== "object" || Array.isArray(job)) return ["Strict Class A static-gates job must exist"];
  if (job.name !== "Strict grep — static gates (class A)") errors.push("Strict Class A required-context name must remain exact");
  if (!Number.isInteger(job["timeout-minutes"]) || job["timeout-minutes"] !== 15) {
    errors.push("Strict Class A timeout-minutes must be the exact bounded integer 15");
  }
  if (!Array.isArray(job.steps) || digest(job.steps) !== STATIC_CLASS_A_STEP_SHA256) {
    errors.push("Strict Class A protected step sequence must remain byte-semantically exact");
  }
  return errors;
};

test("#2437 terminal registry is exactly 31 historical origins / 32 typed variants", () => {
  // [TEST-MOD-APPROVED #2438] Phase 3A stays independently selected after the additive Phase 3B wave.
  const value = manifest();
  const shadow = value.suites.filter((suite) => suite.migrationWave === "phase3a-node-wave");
  // [TEST-MOD-APPROVED #2438 · SC-15/SC-21] Select Phase 3A by its explicit WAVE, not
  // by the lifecycle value alone. #2438's cutover flips twelve more origins to
  // batched-historical, so a lifecycle-only filter silently absorbs another wave's
  // work into Phase 3A's count — the exact class of drift A9-SC2 names. Both waves
  // are now counted separately and the combined total is asserted, so nothing hides.
  const origins = value.legacyOrigins.filter((origin) => origin.disposition === "batched-historical"
    && origin.migrationWave === "phase3a-node-wave");
  const phase3bOrigins = value.legacyOrigins.filter((origin) => origin.disposition === "batched-historical"
    && origin.migrationWave === "phase3b-postgres-wave");
  assert.equal(phase3bOrigins.length, 12);
  // [TEST-MOD-APPROVED #2439 · SC-17.1] The cross-wave total is DERIVED from the
  // registry's own wave headers, never typed. #2439's cutover flips seventeen
  // more origins to batched-historical, and the typed subtrahend that stood here
  // (43) was already the exact defect SC-17.1 bans: a wave-relative number that
  // silently absorbs the next wave's work. Every terminal origin must now be
  // owned by a wave whose header declares that wave terminal, and the total is
  // the sum over exactly those waves — which stays honest when Phase 3D flips.
  const historicalOrigins = value.legacyOrigins.filter((origin) => origin.disposition === "batched-historical");
  for (const origin of historicalOrigins) {
    assert.equal(value.migrationWaves?.[origin.migrationWave]?.lifecycle, "batched-historical",
      `${origin.stem}.${origin.extension}: terminal origin outside a terminal wave header`);
  }
  const terminalWaves = Object.entries(value.migrationWaves)
    .filter(([, contract]) => contract.lifecycle === "batched-historical").map(([wave]) => wave);
  assert.deepEqual([...terminalWaves].sort(), ["phase3a-node-wave", "phase3b-postgres-wave", "phase3c-deno-wave"]);
  assert.equal(historicalOrigins.length, terminalWaves.reduce((sum, wave) => sum
    + value.legacyOrigins.filter((origin) => origin.disposition === "batched-historical"
      && origin.migrationWave === wave).length, 0));
  assert.equal(value.legacyOrigins.length, 200);
  assert.equal(value.suites.length, 84);
  assert.equal(value.workflowProviders.length, 91);
  assert.equal(origins.length, 31);
  assert.equal(shadow.length, 32);
  assert.equal(new Set(shadow.map((suite) => suite.id)).size, 32);
  assert.equal(shadow.filter((suite) => path.basename(suite.origin) === "issue-994-ota-env-resolution.yml").length, 2);
  assert.equal(shadow.filter((suite) => path.basename(suite.origin) !== "issue-994-ota-env-resolution.yml").length, 30);
  for (const suite of shadow) assert.equal(fs.existsSync(path.join(ROOT, suite.origin)), false, `${suite.origin} must be absent after terminal cutover`);
  assert.equal(fs.existsSync(path.join(ROOT, ".github/workflows/issue-2393-valid-marketing-test-fixtures.yml")), true);
});

test("all original Phase 2 commands and all shadow commands have independent immutable locks", () => {
  const value = manifest();
  assert.equal(digest(value.commandCapabilities.commands.slice(0, 51)), "bb9c0e598a08ab91d8714ec2db80100c8b4d966d980a3cc290c3bcad93990a3f");
  assert.equal(digest(value.commandCapabilities.commands.slice(51, 158)), "3cdccc5cb491f7a642ffa2a49f450d6f7ed5b37450d1f18a1fe219d5c629e709");
  assert.equal(value.suites.filter((suite) => suite.migrationWave === "phase3a-node-wave").flatMap((suite) => suite.steps).length, 107);
  assert.equal(value.commandCapabilities.commands.length, 240);
});

test("#1593 reference proof pins one exact TAP reporter without changing its child target", () => {
  const source = fs.readFileSync(ISSUE_1593_REFERENCE_PATH, "utf8");
  assert.deepEqual(validateIssue1593Reporter(source), []);
  const attacks = [
    source.replace("'--test-reporter=tap', ", ""),
    source.replace("--test-reporter=tap", "--test-reporter=spec"),
    source.replace("'--test-reporter=tap', ", "'--test-reporter=tap', '--test-reporter=tap', "),
  ];
  for (const attack of attacks) {
    assert.ok(validateIssue1593Reporter(attack).some((error) => /exactly one deterministic TAP reporter/.test(error)));
  }
});

test("terminal source wave retains all 107 exact assertion commands with wrappers absent", () => {
  const value = manifest();
  // [TEST-MOD-APPROVED #2438 · SC-15/SC-21] Wave-scoped for the same reason as above:
  // after #2438's cutover, `lifecycle === "batched-historical"` also matches twelve
  // Phase 3B suites carrying 36 more assertions, which would inflate Phase 3A's
  // frozen 107 to 143 without a single marker pointing at it. Phase 3B's own count
  // is asserted separately and the sum is checked, so the wider total stays honest.
  const suites = value.suites.filter((suite) => suite.lifecycle === "batched-historical"
    && suite.migrationWave === "phase3a-node-wave");
  const phase3bSuites = value.suites.filter((suite) => suite.lifecycle === "batched-historical"
    && suite.migrationWave === "phase3b-postgres-wave");
  const names = value.legacyOrigins.filter((origin) => origin.disposition === "batched-historical").map((origin) => `${origin.stem}.${origin.extension}`);
  assert.equal(suites.flatMap((suite) => suite.steps).length, 107);
  assert.equal(phase3bSuites.length, 12);
  assert.equal(phase3bSuites.flatMap((suite) => suite.steps).length, 36);
  // [TEST-MOD-APPROVED #2439 · SC-17.1] Both cross-wave totals are DERIVED per
  // wave from the registry's own headers instead of typed. #2439 adds a third
  // terminal wave (17 suites / 46 outers), and the typed 143 and 43 would have
  // gone stale the moment it flipped — the same wave-relative-subtrahend defect
  // SC-17.1 bans. Each wave's own frozen count is still pinned above.
  const terminalWaves = Object.entries(value.migrationWaves)
    .filter(([, contract]) => contract.lifecycle === "batched-historical").map(([wave]) => wave);
  assert.deepEqual([...terminalWaves].sort(), ["phase3a-node-wave", "phase3b-postgres-wave", "phase3c-deno-wave"]);
  const outersInWave = (wave) => value.suites.filter((suite) => suite.lifecycle === "batched-historical"
    && suite.migrationWave === wave).flatMap((suite) => suite.steps).length;
  assert.equal(value.suites.filter((suite) => suite.lifecycle === "batched-historical").flatMap((suite) => suite.steps).length,
    terminalWaves.reduce((sum, wave) => sum + outersInWave(wave), 0));
  assert.equal(names.length, terminalWaves.reduce((sum, wave) => sum
    + value.legacyOrigins.filter((origin) => origin.disposition === "batched-historical"
      && origin.migrationWave === wave).length, 0));
  assert.equal(names.filter((name) => fs.existsSync(path.join(ROOT, ".github/workflows", name))).length, 0);
});

test("terminal lifecycle rejects restored wrappers and leaves no parity markers", () => {
  const value = manifest();
  const sources = workflowSources();
  assert.equal(SHADOW_PARITY_WRAPPER_NAMES.length, 31);
  assert.deepEqual(validateShadowParityMarkers(value, sources), []);
  for (const name of SHADOW_PARITY_WRAPPER_NAMES) {
    assert.equal(sources[name], undefined);
  }
  const restored = { ...sources, [SHADOW_PARITY_WRAPPER_NAMES[0]]: "restored\n" };
  assert.ok(validateShadowParityMarkers(value, restored).some((error) => /terminal wrapper must be absent/.test(error)));
});

test("canonical validation rejects terminal omission, restored wrapper, setup drift, and trust drift", () => {
  const value = manifest();
  const workflowSource = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const discovery = { root: ROOT, liveOrigins: discoverLiveOrigins(ROOT), workflowProviders: discoverWorkflowProviders(ROOT), matrixSource: workflowSource };
  assert.deepEqual(validateRegistry(value, discovery), []);

  const omitted = clone(value);
  omitted.suites.splice(23, 1);
  assert.ok(validateRegistry(omitted, discovery).some((error) => /55 executable suites|55 entries|32 .*variants/.test(error)));

  const setup = clone(value);
  setup.setupProfiles["cross-root-node22-ignore-scripts"].installs.reverse();
  assert.ok(validateRegistry(setup, discovery).some((error) => /exact reviewed.*setup contract/.test(error)));

  const workflow = workflowSource.replace("persist-credentials: false", "persist-credentials: true");
  assert.ok(validateRegistry(value, { ...discovery, matrixSource: workflow }).some((error) => /pinned checkout\/setup-node/.test(error)));
});

test("job startup uses supported pre-matrix contexts and dispatch is isolated to #2300", () => {
  const value = manifest();
  const workflowSource = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const topology = inspectBatchWorkflow(workflowSource);
  assert.equal(topology.jobIf, "github.event_name != 'workflow_dispatch'");
  assert.equal(topology.dispatch.jobIf, "github.event_name == 'workflow_dispatch' && inputs.suite == 'issue-2300-orch-artifact-reap'");
  assert.equal(topology.dispatch.hasStrategy, false);
  assert.equal(topology.dispatch.runSuitesStep.run, 'node .github/scripts/ci-batch/run-suite-batch.mjs --run "node20-19-noinstall"');

  const unavailable = workflowSource.replace("if: github.event_name != 'workflow_dispatch'", "if: github.event_name != 'workflow_dispatch' || matrix.class == 'node20-19-noinstall'");
  assert.ok(validateRegistry(value, { root: ROOT, matrixSource: unavailable }).some((error) => /supported pre-matrix event contexts/.test(error)));
  const unbounded = workflowSource.replace("inputs.suite == 'issue-2300-orch-artifact-reap'", "true");
  assert.ok(validateRegistry(value, { root: ROOT, matrixSource: unbounded }).some((error) => /exact isolated #2300-only route/.test(error)));
});

test("Strict static Class A has the exact bounded 15-minute timeout and unchanged parsed steps", () => {
  const source = fs.readFileSync(STRICT_WORKFLOW_PATH, "utf8");
  assert.deepEqual(validateStaticClassAJob(source), []);

  const mutations = [
    source.replace("timeout-minutes: 15", "timeout-minutes: 10"),
    source.replace("timeout-minutes: 15", "timeout-minutes: 16"),
    source.replace("    timeout-minutes: 15\n", ""),
    source.replace("timeout-minutes: 15", 'timeout-minutes: "15"'),
    source.replace("timeout-minutes: 15", "timeout-minutes: ${{ vars.CLASS_A_TIMEOUT }}"),
  ];
  for (const mutation of mutations) {
    assert.ok(validateStaticClassAJob(mutation).some((error) => /exact bounded integer 15/.test(error)));
  }

  const stepSubstitution = source.replace(
    "node .github/scripts/strict-grep/run-batch.mjs --class A",
    "node .github/scripts/strict-grep/run-batch.mjs --class B",
  );
  assert.ok(validateStaticClassAJob(stepSubstitution).some((error) => /protected step sequence/.test(error)));
});

test("#2062 repository audit cannot be contaminated by losslessly stored #994 provenance", () => {
  const raw = manifest();
  const rawSource = fs.readFileSync(MANIFEST_PATH, "utf8");
  const staleRoot = ["app.config", "ts"].join(".");
  assert.equal(rawSource.split(staleRoot).length - 1, 0);
  assert.deepEqual(validateManifestTextRepresentations(raw), []);

  const decoded = decodeManifestTextRepresentations(raw);
  const selectedSuites = decoded.suites.filter((suite) => suite.id.startsWith("issue-994-ota-env-resolution-"));
  assert.equal(selectedSuites.flatMap((suite) => suite.originPaths).filter((value) => value.endsWith(staleRoot)).length, 4);
  const origin = decoded.legacyOrigins.find((item) => item.stem === "issue-994-ota-env-resolution" && item.extension === "yml");
  assert.equal(origin.workflowMetadata.pathScope.filter((value) => value.endsWith(staleRoot)).length, 2);

  const rawBusiness = raw.suites.find((suite) => suite.id === "issue-994-ota-env-resolution-mingla-business");
  const decodedBusiness = decoded.suites.find((suite) => suite.id === rawBusiness.id);
  assert.deepEqual(decodedBusiness.steps, rawBusiness.steps);
  assert.equal(commandFingerprint(decodedBusiness), "064b393af16099018770cf8f08456114e777a3b5ad79586f5bcfa3ebff217c25");
  execFileSync(process.execPath, ["--test", "scripts/ci/__tests__/issue-2062-expo-config-node20.tester.adversarial.test.mjs"], { cwd: ROOT, stdio: "pipe" });
});
