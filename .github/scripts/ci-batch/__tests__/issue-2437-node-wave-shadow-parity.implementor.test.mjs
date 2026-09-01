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
  PROVIDERS_ADDED_SINCE_SEAL,
  inspectBatchWorkflow,
  inspectWorkflow,
  validateRegistry,
  validateManifestTextRepresentations,
  validateShadowParityMarkers,
  SUITES_ADDED_SINCE_SEAL,
} from "../validate-manifest-v2.mjs";
import { commandFingerprint } from "../run-suite-batch.mjs";
import { SELF_JOB_NAME as CLASS_A_BUDGET_JOB_NAME } from "../../strict-grep/issue-2594-class-a-budget.mjs";

// [TEST-MOD-APPROVED #2897] Counts derived from the validator's single declared
// post-seal set, never re-typed. See SUITES_ADDED_SINCE_SEAL.
const ADDED_SUITES = SUITES_ADDED_SINCE_SEAL.length;
const ADDED_STEPS = SUITES_ADDED_SINCE_SEAL.reduce((sum, item) => sum + item.steps, 0);


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MANIFEST_PATH = path.join(ROOT, ".github/ci-batch/MANIFEST.json");
const WORKFLOW_PATH = path.join(ROOT, ".github/workflows/ci-batch.yml");
const STRICT_WORKFLOW_PATH = path.join(ROOT, ".github/workflows/strict-grep-mingla-business.yml");
const ISSUE_1593_REFERENCE_PATH = path.join(ROOT, "app-mobile/src/components/swipeDeck/__tests__/issue_1593_poster_hole_geometry.adversarial.test.mjs");
// [TEST-MOD-APPROVED #2594] SC-14 — the seal is RE-CUT, deliberately, and this is
// not a discovered drift. #2594 removes two steps from the static-gates job: the
// `setup-cli` provisioning action and the Dockerised PostgreSQL replay whose four
// SQL suites now run in the Postgres contract-suites lane, proven there by G-1 (9 of 9),
// G-2/G-5 (35 of 35 rows, 112/112 DO blocks) and L-5 (22 of 22) before this line
// moved. Nine steps became seven.
//
//   old (9 steps) d89bf9920ba031d7f4243f3d36772376af753427bcabe1a289b1b781b871b6eb
//   new (7 steps) 982cd17671b3452b6d24bc56fb237327c4b0d2b4b4620be89af14ce6b196c83d
//
// RECOMPUTED from the file, through the same ruby YAML.safe_load this test uses,
// never copied from a projection. It agrees with the #2594 SPEC's projected value,
// and the agreement is expected rather than lucky: deliverable 1 added a SIBLING
// JOB, not a step, so the static-gates step array was untouched between the
// projection and this cut.
const STATIC_CLASS_A_STEP_SHA256 = "982cd17671b3452b6d24bc56fb237327c4b0d2b4b4620be89af14ce6b196c83d";
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

// [TEST-MOD-APPROVED #2594] SC-11 / I-PROPOSED-2594-STATIC-GATES-IS-CONTAINERLESS.
//
// The job is named "static gates" and, until #2594, 19.5 % of it was a Docker
// bring-up replaying all 533 migrations from zero. That work now lives in the
// Postgres contract-suites lane, which already holds an unconditional from-zero
// replay. This assertion is what stops it coming back: the job runs no container
// and provisions no database.
//
// EVERY FORBIDDEN LITERAL IS ASSEMBLED FROM FRAGMENTS. A guard that carries the
// string it forbids can be matched by anything that greps the corpus for that
// string — including itself — and the repo has now hit that class five times.
// G-4 in the Postgres contract-suites lane is the working precedent this copies.
const staticClassAContainerErrors = (job) => {
  const cli = ["supa", "base"].join("");
  const container = ["doc", "ker"].join("");
  const setupAction = [cli, "/setup-", "cli"].join("");
  const forbiddenRun = [container, `${cli} init`, `${cli} start`, `${cli} stop`, `${cli} db `];
  const errors = [];
  if (job.services !== undefined) {
    errors.push("Strict Class A must declare no job services; it is containerless");
  }
  if (!Array.isArray(job.steps)) return errors;
  for (const [index, step] of job.steps.entries()) {
    const uses = typeof step?.uses === "string" ? step.uses : "";
    const run = typeof step?.run === "string" ? step.run : "";
    if (uses.includes(setupAction)) {
      errors.push(`Strict Class A step ${index} provisions the ${cli} CLI; the job is containerless`);
    }
    for (const needle of forbiddenRun) {
      if (run.includes(needle)) {
        errors.push(`Strict Class A step ${index} runs [${needle}]; the job is containerless and provisions no database`);
      }
    }
  }
  return errors;
};

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
  errors.push(...staticClassAContainerErrors(job));
  return errors;
};

// [TEST-MOD-APPROVED #2594] SC-7 — the wiring proof for the out-of-band class-A
// elapsed-time adjudicator.
//
// It lands HERE and nowhere else, and that is forced rather than chosen. The
// frozen provider seal in validate-manifest-v2.mjs derives, for every workflow
// filename, the sorted set of tracked source files containing that filename as a
// literal. The strict-grep host workflow's record is INSIDE that seal with no
// declared-mutation mechanism, so any NEW file naming it reds the seal with no
// escape. This file is already on that record, already parses the workflow's
// YAML, and already holds the class-A step seal.
//
// The adjudicator module itself carries no workflow filename at all — asserted
// below from fragments, because a check that greps its own source for the string
// it forbids matches itself and can never pass.
const CLASS_A_BUDGET_MODULE_REL = ".github/scripts/strict-grep/issue-2594-class-a-budget.mjs";
const CLASS_A_BUDGET_ENFORCE_RUN = `node ${CLASS_A_BUDGET_MODULE_REL} --enforce`;
// Assembled from fragments, NOT written as a literal. META-1383 P6 reads a source
// containing the self-test flag as a claim that the FILE supports that flag, and
// this file's manifest row says selfTest:"none" — a bare literal here reds the
// parity gate on a string that is about a different file entirely. Same
// self-matching trap as the workflow-extension assertion below.
const SELF_TEST_FLAG = ["--self", "test"].join("-");

const validateClassABudgetJob = (source) => {
  const errors = [];
  let document;
  try {
    document = parseRealYaml(source);
  } catch (error) {
    return [`#2594 host workflow must parse as real YAML: ${error.message}`];
  }

  // SC-2 — the token every other job inherits must not move. A workflow-level
  // permissions block would rewrite all eleven of them to buy this one job a read.
  if (Object.prototype.hasOwnProperty.call(document ?? {}, "permissions")) {
    errors.push("#2594 workflow-level permissions must stay ABSENT so no other job's token moves");
  }

  const job = document?.jobs?.["class-a-budget"];
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    errors.push("#2594 class-a-budget adjudication job must exist");
    return errors;
  }

  if (job.name !== CLASS_A_BUDGET_JOB_NAME) {
    errors.push("#2594 class-a-budget job name must stay in lockstep with the adjudicator's own SELF_JOB_NAME");
  }
  if (!Array.isArray(job.needs) || job.needs.length !== 1 || job.needs[0] !== "static-gates") {
    errors.push("#2594 class-a-budget must depend on exactly [static-gates]; without that edge it can conclude before the job it measures");
  }
  if (job.if !== "always()") {
    errors.push("#2594 class-a-budget must carry if: always(); without it a timeout kill of class A skips the only check that can see it");
  }
  if (!Number.isInteger(job["timeout-minutes"]) || job["timeout-minutes"] !== 5) {
    errors.push("#2594 class-a-budget timeout-minutes must be the exact bounded integer 5");
  }
  const permissions = job.permissions;
  const permissionPairs = permissions && typeof permissions === "object" && !Array.isArray(permissions)
    ? Object.entries(permissions).sort(([a], [b]) => a.localeCompare(b))
    : null;
  if (JSON.stringify(permissionPairs) !== JSON.stringify([["actions", "read"], ["contents", "read"]])) {
    errors.push("#2594 class-a-budget permissions must be JOB-level and exactly {actions: read, contents: read}");
  }

  const steps = Array.isArray(job.steps) ? job.steps : [];
  const adjudicationStep = steps[steps.length - 1];
  if (adjudicationStep?.run !== CLASS_A_BUDGET_ENFORCE_RUN) {
    errors.push("#2594 class-a-budget final step must run the adjudicator in --enforce mode");
  }

  const env = adjudicationStep?.env ?? {};
  if (typeof env.GITHUB_TOKEN !== "string" || !env.GITHUB_TOKEN.includes("secrets.GITHUB_TOKEN")) {
    errors.push("#2594 class-a-budget must thread the default token; with no token it cannot read the timing it exists to read");
  }
  // The subject is named by VALUE, not by convention: a rename of class A would
  // otherwise leave the adjudicator hunting a job that no longer exists, and D0
  // would fire on every run forever.
  if (env.CLASS_A_JOB_NAME !== document?.jobs?.["static-gates"]?.name) {
    errors.push("#2594 class-a-budget must name the class-A job by its exact current display name");
  }
  // A CEILING, deliberately not an equality. A7-SC1(1) is a maximum, so a value
  // ABOVE it cannot be honest and is refused; a value BELOW it is exactly how the
  // SC/D1-7 real-head mutant is driven, and pinning equality here would red class
  // A during that mutant, flipping the adjudicator to D2 pass-through and
  // destroying the very RED the mutant exists to produce.
  const budgetSeconds = Number(env.CLASS_A_BUDGET_SECONDS);
  if (!Number.isInteger(budgetSeconds) || budgetSeconds <= 0 || budgetSeconds > 600) {
    errors.push("#2594 class-a-budget CLASS_A_BUDGET_SECONDS must be a positive integer at or under the 600 s A7-SC1(1) bound");
  }
  const timeoutKillSeconds = Number(env.CLASS_A_TIMEOUT_KILL_SECONDS);
  if (!Number.isInteger(timeoutKillSeconds) || timeoutKillSeconds <= budgetSeconds || timeoutKillSeconds >= 900) {
    errors.push("#2594 class-a-budget CLASS_A_TIMEOUT_KILL_SECONDS must sit strictly between the bound and the 900 s cap");
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
  assert.equal(value.legacyOrigins.length, 200 + ADDED_SUITES);
  assert.equal(value.suites.length, 84 + ADDED_SUITES);
  // [TEST-MOD-APPROVED #2591] Literal -> derivation. The provider totals are now
  // `<frozen> + PROVIDERS_ADDED_SINCE_SEAL.length`, read from the one declared set the
  // validator subtracts from the frozen provider seal. Subject and strength unchanged;
  // the number simply stops being typed in a second place where it can disagree.
  assert.equal(value.workflowProviders.length, 91 + PROVIDERS_ADDED_SINCE_SEAL.length);
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
  assert.equal(value.commandCapabilities.commands.length, 240 + ADDED_STEPS);
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

  // [TEST-MOD-APPROVED #2594] SC-11 mutants. The container fragments are built
  // the same way the guard builds them, so this test does not carry the literal
  // it forbids either.
  const cli = ["supa", "base"].join("");
  const container = ["doc", "ker"].join("");
  const adminStep = '      - name: "Issue #1384: Admin reason and revision-CAS suites"\n';
  assert.equal(source.split(adminStep).length - 1, 1, "the #1384 admin step must anchor the mutants exactly once");

  // Mutant A — the replay step comes back. This is the one the invariant exists
  // for: it must red on BOTH the container verbs and the re-cut step seal.
  const replayRestored = source.replace(adminStep, [
    '      - name: "Issues #1384/#1397: disposable PostgreSQL 17 replay and SQL matrix"',
    "        shell: bash",
    "        run: |",
    "          set -euo pipefail",
    `          ${cli} init --workdir "$sql_root" --yes`,
    `          ${cli} start --workdir "$sql_root" --yes`,
    `          ${container} exec -i pg_db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -`,
    adminStep,
  ].join("\n"));
  const replayErrors = validateStaticClassAJob(replayRestored);
  assert.ok(replayErrors.some((error) => /is containerless and provisions no database/.test(error)));
  assert.ok(replayErrors.some((error) => /protected step sequence/.test(error)));

  // Mutant B — only the CLI provisioning action comes back.
  const setupRestored = source.replace(adminStep, [
    `      - uses: ${cli}/setup-cli@v1`,
    "        with:",
    '          version: 2.98.2',
    adminStep,
  ].join("\n"));
  assert.ok(validateStaticClassAJob(setupRestored).some((error) => /provisions the .* CLI; the job is containerless/.test(error)));

  // Mutant C — a job-level service container.
  const servicesRestored = source.replace(
    "  static-gates:\n    name: \"Strict grep — static gates (class A)\"\n",
    "  static-gates:\n    name: \"Strict grep — static gates (class A)\"\n    services:\n      db:\n        image: postgres:17\n",
  );
  assert.ok(validateStaticClassAJob(servicesRestored).some((error) => /declare no job services/.test(error)));
});

// [TEST-MOD-APPROVED #2594] SC-7 — new test, no existing assertion weakened or
// removed. The four mutants below are the fails-on-revert contract for
// deliverable 1: each disarms the adjudicator in a different, plausible way, and
// each must turn this RED.
test("#2594 the class-A elapsed-time bound is adjudicated out-of-band, and the wiring cannot be quietly removed", () => {
  const source = fs.readFileSync(STRICT_WORKFLOW_PATH, "utf8");
  assert.deepEqual(validateClassABudgetJob(source), []);

  // SC-3 — deliverable 1 adds a SIBLING job. The class-A step seal covers
  // jobs["static-gates"].steps only, so adding a job must not move it. Asserted
  // here as well as above because "I added a job and something else moved" is
  // exactly the kind of drift that gets discovered in CI rather than locally.
  assert.deepEqual(validateStaticClassAJob(source), []);

  // SC-5 — the adjudicator module carries NO workflow filename, and therefore no
  // workflow file extension. Both forbidden literals are assembled from fragments
  // so this assertion does not match its own source, which is the trap that has
  // now bitten this programme five times.
  const shortExtension = [".", "y", "m", "l"].join("");
  const longExtension = [".", "y", "a", "m", "l"].join("");
  const moduleSource = fs.readFileSync(path.join(ROOT, CLASS_A_BUDGET_MODULE_REL), "utf8");
  assert.equal(moduleSource.includes(shortExtension), false,
    "the adjudicator must name no workflow file: one literal makes it a referenceFile of the sealed record");
  assert.equal(moduleSource.includes(longExtension), false,
    "the adjudicator must name no workflow file: one literal makes it a referenceFile of the sealed record");

  // Mutant 1 — the job is deleted (renamed out from under its key).
  const jobDeleted = source.replace("  class-a-budget:\n", "  class-a-budget-removed:\n");
  assert.notEqual(jobDeleted, source);
  assert.ok(validateClassABudgetJob(jobDeleted).some((error) => /adjudication job must exist/.test(error)));

  // Mutant 2 — `needs:` is dropped, so the adjudicator can conclude before the
  // job it measures and read timestamps that are not there yet.
  const needsDropped = source.replace("    needs: [static-gates]\n", "");
  assert.notEqual(needsDropped, source);
  assert.ok(validateClassABudgetJob(needsDropped).some((error) => /exactly \[static-gates\]/.test(error)));

  // Mutant 3 — `if: always()` is removed, which silently disarms the check in the
  // ONE case that matters most: a timeout kill of class A skips every dependent.
  const alwaysRemoved = source.replace("    needs: [static-gates]\n    if: always()\n", "    needs: [static-gates]\n");
  assert.notEqual(alwaysRemoved, source);
  assert.ok(validateClassABudgetJob(alwaysRemoved).some((error) => /if: always\(\)/.test(error)));

  // Mutant 4 — the enforcing step is substituted for the harmless self-test, so
  // the job stays green while adjudicating nothing at all.
  const enforceSubstituted = source.replace(
    `${CLASS_A_BUDGET_MODULE_REL} --enforce`,
    `${CLASS_A_BUDGET_MODULE_REL} ${SELF_TEST_FLAG}`,
  );
  assert.notEqual(enforceSubstituted, source);
  assert.ok(validateClassABudgetJob(enforceSubstituted).some((error) => /--enforce mode/.test(error)));

  // The adjudicator's own decision table, driven end to end. A wiring proof that
  // never executes the thing it wires is a check that carries no information.
  execFileSync(process.execPath, [CLASS_A_BUDGET_MODULE_REL, SELF_TEST_FLAG], { cwd: ROOT, stdio: "pipe" });
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
