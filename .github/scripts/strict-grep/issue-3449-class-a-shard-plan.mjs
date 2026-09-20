#!/usr/bin/env node
/**
 * issue #3449 — the Class A shard PLAN and WIRING gate.
 *
 * WHAT WENT WRONG. Class A ran all 1,033 strict-grep executions in one job: mean
 * 519 s over 14 runs against the #3336 readiness ceiling of 540 s, worst 539 s —
 * ONE SECOND of margin — growing +3.6 to +8.8 s/day, because the corpus grows by
 * policy (#2865) and the append-only ratchet forbids removal. Within days ordinary
 * pull requests would have gone red, each red costing a 13-minute rerun.
 *
 * THE FIX, AND WHY IT NEEDS A GATE. Three parallel shards run the same executions
 * at about 183 s each. Membership is COMPUTED, never listed, so a new batch:A gate
 * needs no human decision. That computation has inputs — the registry, a committed
 * cost table, and a shard count — and a shape in the host workflow that has to
 * match it. This gate is the thing that proves the inputs are valid and the wiring
 * still matches; the aggregate completeness job proves the shards actually ran the
 * whole class.
 *
 * WHY MEMBERSHIP IS COST-BASED, NOT COUNT-BASED. The class is wildly skewed: ONE
 * execution is 89.1 s — 18% of the whole class — while about 800 executions
 * together are 6%. A count-based split would leave one shard roughly twice as slow
 * as another and spend the margin this change exists to create.
 *
 * WHY EXPLICIT SIBLING JOBS AND NOT `strategy: matrix`. `fail-fast: true` is the
 * documented matrix default and cancels sibling shards; a cancelled shard with a
 * simultaneously-cancelled peer classifies as D5 NEUTRAL exit 0 in
 * issue-2594-class-a-budget.mjs — "the pool was busy" — the exact "a kill reads as
 * noise" failure #2594 and #3336 closed. `fail-fast: false` is a one-line default a
 * future edit silently restores and no seal covers it. Explicit siblings carry no
 * `fail-fast` at all, so this gate refusing any `strategy:` key on a Class A job
 * makes the hazard unreachable BY CONSTRUCTION rather than by a line someone can
 * drop. The misclassification itself is reproduced as a fixture in
 * issue-3449-class-a-shard-plan.tester.test.mjs (SC-13.1), so the rejection stays
 * falsifiable rather than folkloric.
 *
 * WHY PER-SHARD `executed === expected` IS NOT COMPLETENESS. Three shards each
 * honestly reporting "I ran all of mine" is compatible with executions belonging
 * to no shard at all. That is why this gate is paired with
 * issue-3449-class-a-shard-completeness.mjs, which recomputes the plan and proves
 * the shards PARTITION the class.
 *
 * WHY THIS GATE IS CLASS E AND NOT CLASS A. Class E runs about 45 s against a
 * 600 s bound. A proof about Class A's margin must not be charged to Class A's
 * margin. Measured here: 0.4 s plain and 0.3 s self-test. The self-test is that
 * cheap because its fixtures drive auditHostDocuments() with plain objects rather
 * than shelling out to Ruby once per mutant — 27 mutants at one shell-out each
 * measured 15 s, which is real budget for a suite that asserts nothing extra by
 * spending it. The live run is the only path that parses.
 *
 * NAMING CONSTRAINT, load-bearing. This file names NO workflow file. The frozen
 * provider seal in .github/scripts/ci-batch/validate-manifest-v2.mjs derives, for
 * every workflow filename, the sorted set of tracked files containing that name as
 * a literal; one mention here would rewrite that record and red `external
 * reference file inventory drifted` with no escape. The host is located by the
 * display name GitHub itself shows on the check — the issue-2909 precedent — and
 * EVERY error message names the display name, never a filename.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  SHARD_COUNT_FIELD,
  SHARD_ENV_VAR,
  classAShardPlan,
  executionKey,
  expectedExecutions,
  loadManifest,
  loadShardCosts,
} from "./run-batch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");

/** Assembled from fragments, never written as literals — see the header. */
const WORKFLOW_EXTENSIONS = [["y", "ml"].join(""), ["ya", "ml"].join("")];

export const HOST_NAME = "Strict Grep Gates (Mingla Host)";
export const CARRIER_JOB_KEY = "static-gates";
export const ALERT_JOB_KEY = "main-red-alert";
export const RUN_BATCH_CLASS_A = "node .github/scripts/strict-grep/run-batch.mjs --class A";
export const BUDGET_MODULE = ".github/scripts/strict-grep/issue-2594-class-a-budget.mjs";
export const BUDGET_ENFORCE_RUN = `node ${BUDGET_MODULE} --enforce`;
export const COMPLETENESS_MODULE = ".github/scripts/strict-grep/issue-3449-class-a-shard-completeness.mjs";
export const SHARD_TIMEOUT_MINUTES = 15;
export const ADJUDICATOR_TIMEOUT_MINUTES = 5;
export const BUDGET_SECONDS = "600";
export const TIMEOUT_KILL_SECONDS = "890";

/**
 * The cost table's honesty floor. At top-25 the worst observed shard was 178.5 s
 * against a 540 s ceiling, so 25 is a REAL floor that still balances rather than a
 * decorative one: it catches an emptied or truncated table while leaving room to
 * shrink the table deliberately.
 */
export const MINIMUM_COSTED_EXECUTIONS = 25;
/** 600 s in ms. No single execution can honestly cost more than the whole bound. */
export const MAXIMUM_COST_MS = 600000;

/**
 * Two required status contexts exist on `main`. Neither is a Class A job, and a
 * new job here must never claim one of their names: a rename-by-collision would
 * make an unrelated job satisfy a required context. issue-2881's A4 also refuses
 * this; asserting it here keeps the reason next to the jobs being added.
 */
export const REQUIRED_CONTEXTS = Object.freeze(["Framework Major Guard", "mingla-business jest (full suite)"]);

const RUBY_PARSE = String.raw`
require "yaml"
require "json"
payload = JSON.parse(STDIN.read)
out = {}
payload.each do |file, source|
  begin
    out[file] = YAML.safe_load(source, aliases: true) || {}
  rescue => e
    out[file] = {"__parse_error" => "#{e.class}: #{e.message.lines.first.to_s.strip}"}
  end
end
STDOUT.write(JSON.generate(out))
`;

/**
 * House Ruby shell-out, matching parseRealYaml / parseWorkflows elsewhere. The
 * `yaml` npm package is installed for the Class B lane only and is NOT available
 * to this class, so a JS parser here would be a gate that cannot run.
 */
export function parseWorkflows(sources) {
  const out = execFileSync("ruby", ["-e", RUBY_PARSE], {
    input: JSON.stringify(sources),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

export function readWorkflowSources(root = REPO_ROOT) {
  const directory = path.join(root, ".github", "workflows");
  return Object.fromEntries(
    fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && WORKFLOW_EXTENSIONS.some((ext) => entry.name.endsWith(`.${ext}`)))
      .map((entry) => [entry.name, fs.readFileSync(path.join(directory, entry.name), "utf8")]),
  );
}

const permissionPairs = (value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
    : null;

const steps = (job) => (Array.isArray(job?.steps) ? job.steps : []);
const runLines = (job) => steps(job).map((step) => String(step?.run ?? "").trim());
const usesStep = (job, needle) => steps(job).find((step) => String(step?.uses ?? "").includes(needle));

/**
 * R-1.5 / R-2.2 — are the plan's INPUTS valid? Exported so the regression suites
 * can drive it over fixtures without touching the live repository.
 */
export function auditPlanInputs({ manifest, costs, notes = [] }) {
  const errors = [];

  const shardCount = manifest?.[SHARD_COUNT_FIELD];
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    // Deliberately NO default. A missing count is a refusal, never "run everything".
    errors.push(`the registry's ${SHARD_COUNT_FIELD} must be an integer >= 1; got ${JSON.stringify(shardCount)}`);
  }

  if (costs === null || typeof costs !== "object" || Array.isArray(costs)) {
    errors.push("the class A shard cost table is absent or is not a JSON object");
    return { errors, notes, plan: null };
  }
  if (!Number.isInteger(costs.defaultCostMs) || costs.defaultCostMs <= 0) {
    errors.push(`the cost table's defaultCostMs must be a positive integer; got ${JSON.stringify(costs.defaultCostMs)}. A missing entry is costed at this value, so a malformed default would make the whole plan meaningless.`);
  }
  if (costs.costMs === null || typeof costs.costMs !== "object" || Array.isArray(costs.costMs)) {
    errors.push("the cost table's costMs must be an object of script -> mode -> milliseconds");
    return { errors, notes, plan: null };
  }

  const live = new Set(expectedExecutions(manifest, "A").map(executionKey));
  let declared = 0;
  let fresh = 0;
  const stale = [];
  for (const [script, modes] of Object.entries(costs.costMs)) {
    if (modes === null || typeof modes !== "object" || Array.isArray(modes)) {
      errors.push(`the cost table entry for ${script} must be an object of mode -> milliseconds`);
      continue;
    }
    for (const [mode, ms] of Object.entries(modes)) {
      declared += 1;
      if (!Number.isInteger(ms) || ms <= 0 || ms > MAXIMUM_COST_MS) {
        errors.push(`the cost table's ${script} [${mode}] must be a positive integer of at most ${MAXIMUM_COST_MS} ms; got ${JSON.stringify(ms)}`);
      }
      if (live.has(executionKey({ script, mode }))) fresh += 1;
      else stale.push(`${script} [${mode}]`);
    }
  }

  if (fresh < MINIMUM_COSTED_EXECUTIONS) {
    errors.push(`the cost table names only ${fresh} live class A execution(s); at least ${MINIMUM_COSTED_EXECUTIONS} are required. Below that the plan degenerates towards a count-based split, and the class is skewed enough (one execution is 18% of it) that a count-based split spends the margin this change exists to create.`);
  }
  if (stale.length * 2 > declared && declared > 0) {
    errors.push(`${stale.length} of ${declared} cost-table entries name executions that are no longer class A. A majority being stale means the table is measuring a corpus that no longer exists; refresh it with scripts/ci/refresh-class-a-shard-costs.mjs.`);
  } else if (stale.length) {
    // REPORTED, never failed, below the halfway line: failing here would make
    // removing any gate require a cost refresh, which is exactly the hand
    // maintenance this design refuses. The planner ignores stale keys.
    notes.push(`${stale.length} of ${declared} cost-table entries are stale (ignored by the planner): ${stale.slice(0, 5).join(", ")}${stale.length > 5 ? ", …" : ""}`);
  }

  if (errors.length) return { errors, notes, plan: null };

  // R-3.10's five numbers, asserted as PROPERTIES rather than as literals, so a
  // growing corpus cannot make this gate red for the wrong reason. The exact
  // 168.8/168.8/168.8 s and 340/351/342 numbers are pinned in the regression
  // suites, which are re-derived when the corpus moves.
  let plan;
  try {
    plan = classAShardPlan({ manifest, costs, shardCount });
  } catch (error) {
    errors.push(`the class A shard plan could not be computed: ${error.message}`);
    return { errors, notes, plan: null };
  }

  const whole = expectedExecutions(manifest, "A").map(executionKey);
  const seen = new Set();
  let duplicates = 0;
  for (const shard of plan.shards) {
    for (const item of shard) {
      const key = executionKey(item);
      if (seen.has(key)) duplicates += 1;
      seen.add(key);
    }
  }
  if (duplicates) errors.push(`the plan places ${duplicates} execution(s) in more than one shard`);
  const missing = whole.filter((key) => !seen.has(key));
  if (missing.length) {
    errors.push(`the plan leaves ${missing.length} class A execution(s) in NO shard; first ${missing[0].replace(String.fromCharCode(31), " [")}]`);
  }
  if (seen.size !== new Set(whole).size) {
    errors.push(`the plan's union is ${seen.size} execution(s) but the class has ${new Set(whole).size}`);
  }
  const emptyShards = plan.shards.map((shard, index) => (shard.length ? null : index + 1)).filter((value) => value !== null);
  if (emptyShards.length) {
    errors.push(`shard(s) ${emptyShards.join(", ")} are EMPTY. A shard that runs nothing is a job that always passes and proves nothing.`);
  }

  return { errors, notes, plan };
}

/**
 * §4.4 / §4.5 — does the host workflow's shape still match the plan? This is the
 * LIVE entry point: it Ruby-parses real workflow sources, then delegates.
 */
export function auditWorkflowWiring({ sources, manifest, notes = [] }) {
  return auditHostDocuments({ documents: parseWorkflows(sources), manifest, notes });
}

/**
 * The same audit over ALREADY-PARSED workflow documents. Split out so the fixtures
 * and the regression suites drive the identical logic with plain objects and spawn
 * no Ruby at all — 27 mutants at one shell-out each cost 15 s of a class budget this
 * change exists to protect. The live path above is the only caller that parses.
 */
export function auditHostDocuments({ documents, manifest, notes = [] }) {
  const errors = [];
  for (const [file, document] of Object.entries(documents)) {
    if (document?.__parse_error) errors.push(`${file}: ${document.__parse_error}`);
  }

  const matches = Object.values(documents).filter((document) => document?.name === HOST_NAME);
  if (matches.length !== 1) {
    errors.push(`exactly one workflow must be named "${HOST_NAME}"; found ${matches.length}`);
    return { errors, notes };
  }
  const host = matches[0];
  const jobs = host.jobs && typeof host.jobs === "object" ? host.jobs : {};

  // R-4.6 — #2437 SC-2 asserts the absence of a workflow-level token block, and
  // adding one would rewrite every other job's token to buy one job a read.
  if (Object.prototype.hasOwnProperty.call(host, "permissions")) {
    errors.push(`"${HOST_NAME}": workflow-level permissions must stay ABSENT so no other job's token moves`);
  }

  const shardCount = manifest?.[SHARD_COUNT_FIELD];
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    errors.push(`the registry's ${SHARD_COUNT_FIELD} must be an integer >= 1 before the wiring can be checked; got ${JSON.stringify(shardCount)}`);
    return { errors, notes };
  }

  // ---- the shard gate jobs, DISCOVERED by their shard value ----------------
  // Found by the env value they carry, never by an enumerated list of keys: the
  // whole point is that membership and topology are computed, not listed.
  const shardJobs = new Map(); // index -> {key, job}
  const duplicateClaims = [];
  for (const [key, job] of Object.entries(jobs)) {
    const raw = job?.env?.[SHARD_ENV_VAR];
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (!/^[0-9]+$/.test(value)) {
      errors.push(`job "${key}": ${SHARD_ENV_VAR} must be a plain positive integer; got ${JSON.stringify(raw)}`);
      continue;
    }
    const index = Number(value);
    if (index < 1 || index > shardCount) {
      errors.push(`job "${key}": ${SHARD_ENV_VAR}=${index} is outside 1..${shardCount} (${SHARD_COUNT_FIELD}). A shard index the registry does not allow means a job that runs nothing, or a slice of the class nobody owns.`);
      continue;
    }
    if (shardJobs.has(index)) {
      duplicateClaims.push(`${shardJobs.get(index).key} and ${key} both claim shard ${index}`);
      continue;
    }
    shardJobs.set(index, { key, job });
  }
  for (const claim of duplicateClaims) {
    errors.push(`two jobs claim one shard: ${claim}. Two jobs on one shard leaves another shard unrun while every per-shard check still passes.`);
  }
  for (let index = 1; index <= shardCount; index += 1) {
    if (!shardJobs.has(index)) {
      errors.push(`no job declares ${SHARD_ENV_VAR}=${index}, so shard ${index} of ${shardCount} is never run by anything.`);
    }
  }
  if (!shardJobs.size) return { errors, notes };

  // The carrier shard IS the pre-existing job, byte-identical apart from its
  // shard value: its step array is sealed by STATIC_CLASS_A_STEP_SHA256 in
  // issue-2437-node-wave-shadow-parity.implementor.test.mjs, so it must keep its key.
  const carrier = shardJobs.get(1);
  if (!carrier || carrier.key !== CARRIER_JOB_KEY) {
    errors.push(`shard 1 must be the pre-existing "${CARRIER_JOB_KEY}" job, whose step array is sealed; found ${JSON.stringify(carrier?.key ?? null)}`);
  }

  const artifactNames = new Map(); // name -> [job keys]
  for (const [index, { key, job }] of [...shardJobs].sort((a, b) => a[0] - b[0])) {
    const label = `shard ${index} ("${key}")`;

    // R-4.7 — the structural form of the matrix rejection. No `strategy:` key can
    // exist, so no `fail-fast` default can exist to be restored.
    if (Object.prototype.hasOwnProperty.call(job, "strategy")) {
      errors.push(`${label} declares a strategy: key. Class A shards must be explicit sibling jobs — a matrix's fail-fast default cancels siblings, and a cancelled shard reads as a neutral concurrency eviction rather than a failure.`);
    }
    // 15 minutes is 900 s, and the adjudicators' 890 s kill floor is what
    // separates a cap kill (FAIL) from an unexplained lone cancellation
    // (INCONCLUSIVE). A shorter timeout kills a shard BELOW the floor and
    // misclassifies a genuine cap kill.
    if (!Number.isInteger(job["timeout-minutes"]) || job["timeout-minutes"] !== SHARD_TIMEOUT_MINUTES) {
      errors.push(`${label} timeout-minutes must be the exact integer ${SHARD_TIMEOUT_MINUTES}; a shorter cap kills the shard below the ${TIMEOUT_KILL_SECONDS} s floor and misclassifies the kill.`);
    }
    if (job.if !== undefined && job.if !== null) {
      errors.push(`${label} must carry NO job-level if:. This host is pin-protected in the draft-gate policy's ALWAYS_ON set, so a draft condition here is an error there too, and any condition is how a shard silently stops running.`);
    }
    if (job.needs !== undefined && job.needs !== null) {
      errors.push(`${label} must carry NO needs:; the shards are independent and must start in parallel.`);
    }
    if (!usesStep(job, "actions/checkout")) errors.push(`${label} must check out the repository`);
    const setupNode = usesStep(job, "actions/setup-node");
    if (!setupNode) errors.push(`${label} must set up Node`);
    else if (String(setupNode?.with?.["node-version"] ?? "") !== "20") {
      errors.push(`${label} must set up Node 20; got ${JSON.stringify(setupNode?.with?.["node-version"] ?? null)}`);
    }
    // MANDATORY on every shard, not a style choice: 13 class A gates reference
    // deno, two of them among the heaviest rows, and membership is COMPUTED — any
    // gate may land on any shard at any time. A shard missing a toolchain is a
    // gate that fails, or worse passes vacuously, for a reason nobody edited.
    if (!usesStep(job, "setup-deno")) {
      errors.push(`${label} must set up Deno. Shard membership is computed, so any deno-dependent class A gate may land here at any time.`);
    }
    if (!runLines(job).includes(RUN_BATCH_CLASS_A)) {
      errors.push(`${label} must run the batched class A runner with the exact line: ${RUN_BATCH_CLASS_A}`);
    }
    const upload = steps(job).find((step) => String(step?.uses ?? "").includes("upload-artifact"));
    const artifact = String(upload?.with?.name ?? "");
    if (!artifact) errors.push(`${label} must upload its results; with no artifact the completeness proof cannot see it, which is a fail-closed red every run.`);
    else {
      if (!artifactNames.has(artifact)) artifactNames.set(artifact, []);
      artifactNames.get(artifact).push(key);
    }
    if (upload && String(upload.if ?? "").trim() !== "always()") {
      errors.push(`${label} upload step must carry if: always(); a failing shard's rows are exactly what the aggregate needs to name the failure.`);
    }
    if (upload && String(upload?.with?.["if-no-files-found"] ?? "") !== "error") {
      errors.push(`${label} upload step must set if-no-files-found: error; a silently empty upload is indistinguishable from a shard that ran nothing.`);
    }
    for (const context of REQUIRED_CONTEXTS) {
      if (job.name === context) errors.push(`${label} must not be named "${context}": that is a required status context on main, and a collision lets an unrelated job satisfy it.`);
    }
  }

  // ---- one adjudicator per shard ------------------------------------------
  const adjudicators = Object.entries(jobs).filter(([, job]) => runLines(job).includes(BUDGET_ENFORCE_RUN));
  const bySubject = new Map();
  for (const [key, job] of adjudicators) {
    const enforcing = steps(job).find((step) => String(step?.run ?? "").trim() === BUDGET_ENFORCE_RUN);
    const subject = String(enforcing?.env?.CLASS_A_JOB_NAME ?? "");
    if (bySubject.has(subject)) {
      errors.push(`two adjudicator jobs ("${bySubject.get(subject)}" and "${key}") both name the subject "${subject}"; one shard would then be adjudicated twice and another not at all.`);
      continue;
    }
    bySubject.set(subject, key);
  }
  for (const [index, { key, job }] of [...shardJobs].sort((a, b) => a[0] - b[0])) {
    const subject = String(job?.name ?? "");
    const adjudicatorKey = bySubject.get(subject);
    if (!adjudicatorKey) {
      errors.push(`shard ${index} ("${key}") has no out-of-band elapsed-time adjudicator naming it. Its subject is named by VALUE through CLASS_A_JOB_NAME: without one, nothing checks that shard against the 600 s bound or the 540 s readiness ceiling.`);
      continue;
    }
    const adjudicator = jobs[adjudicatorKey];
    const label = `adjudicator "${adjudicatorKey}" (shard ${index})`;
    if (String(adjudicator.if ?? "").trim() !== "always()") {
      errors.push(`${label} must carry if: always(); without it a timeout kill of its shard skips the only check that can see it.`);
    }
    if (!Array.isArray(adjudicator.needs) || adjudicator.needs.length !== 1 || adjudicator.needs[0] !== key) {
      errors.push(`${label} must depend on exactly ["${key}"]; without that edge it can conclude before the job it measures.`);
    }
    if (!Number.isInteger(adjudicator["timeout-minutes"]) || adjudicator["timeout-minutes"] !== ADJUDICATOR_TIMEOUT_MINUTES) {
      errors.push(`${label} timeout-minutes must be the exact integer ${ADJUDICATOR_TIMEOUT_MINUTES}`);
    }
    if (permissionPairs(adjudicator.permissions) !== JSON.stringify([["actions", "read"], ["contents", "read"]])) {
      errors.push(`${label} permissions must be JOB-level and exactly {actions: read, contents: read}`);
    }
    const enforcing = steps(adjudicator).find((step) => String(step?.run ?? "").trim() === BUDGET_ENFORCE_RUN);
    const env = enforcing?.env ?? {};
    if (!String(env.GITHUB_TOKEN ?? "").includes("secrets.GITHUB_TOKEN")) {
      errors.push(`${label} must thread the default token; with no token it cannot read the timing it exists to read.`);
    }
    if (String(env.CLASS_A_BUDGET_SECONDS ?? "") !== BUDGET_SECONDS) {
      errors.push(`${label} CLASS_A_BUDGET_SECONDS must be "${BUDGET_SECONDS}"; the constitutional bound and its derived ${Math.round(Number(BUDGET_SECONDS) * 0.9)} s readiness ceiling apply per shard, unchanged.`);
    }
    if (String(env.CLASS_A_TIMEOUT_KILL_SECONDS ?? "") !== TIMEOUT_KILL_SECONDS) {
      errors.push(`${label} CLASS_A_TIMEOUT_KILL_SECONDS must be "${TIMEOUT_KILL_SECONDS}", the floor that separates a cap kill from an unexplained cancellation.`);
    }
  }

  // ---- the aggregate completeness job -------------------------------------
  const completenessEntries = Object.entries(jobs)
    .filter(([, job]) => runLines(job).some((line) => line.includes(COMPLETENESS_MODULE) && line.includes("--aggregate")));
  if (completenessEntries.length !== 1) {
    errors.push(`exactly one job must run the class A shard completeness aggregate; found ${completenessEntries.length}. Without it, three shards each honestly reporting "I ran all of mine" is compatible with executions belonging to no shard at all.`);
  }
  let completenessKey = null;
  if (completenessEntries.length === 1) {
    const [key, job] = completenessEntries[0];
    completenessKey = key;
    if (String(job.if ?? "").trim() !== "always()") {
      errors.push(`completeness job "${key}" must carry if: always(); without it a failing or cancelled shard SKIPS the completeness proof at exactly the moment completeness is most in doubt.`);
    }
    const needs = Array.isArray(job.needs) ? [...job.needs].sort() : [];
    const shardKeys = [...shardJobs.values()].map((entry) => entry.key).sort();
    if (JSON.stringify(needs) !== JSON.stringify(shardKeys)) {
      errors.push(`completeness job "${key}" needs must be exactly every shard job ${JSON.stringify(shardKeys)}; got ${JSON.stringify(needs)}`);
    }
    if (!Number.isInteger(job["timeout-minutes"]) || job["timeout-minutes"] !== ADJUDICATOR_TIMEOUT_MINUTES) {
      errors.push(`completeness job "${key}" timeout-minutes must be the exact integer ${ADJUDICATOR_TIMEOUT_MINUTES}`);
    }
    if (permissionPairs(job.permissions) !== JSON.stringify([["actions", "read"], ["contents", "read"]])) {
      errors.push(`completeness job "${key}" permissions must be JOB-level and exactly {actions: read, contents: read}`);
    }
    const download = usesStep(job, "download-artifact");
    if (!download) errors.push(`completeness job "${key}" must download the shard result artifacts`);
    else {
      // THE most dangerous single key in this change. With merge-multiple: true,
      // three artifacts each holding a file called gate-results-A.json collapse
      // into one path and two shards' rows are SILENTLY OVERWRITTEN — a green run
      // that lost 693 executions, the exact failure this job exists to prevent.
      const merge = download.with?.["merge-multiple"];
      if (merge !== undefined && merge !== null && merge !== false && String(merge).toLowerCase() !== "false") {
        errors.push(`completeness job "${key}" must not set merge-multiple on the download: every shard writes a file of the SAME name, so merging collapses them into one path and two shards' rows are silently overwritten.`);
      }
      if (!String(download.with?.pattern ?? "")) {
        errors.push(`completeness job "${key}" download must select the shard artifacts by pattern`);
      }
    }
    const upload = steps(job).find((step) => String(step?.uses ?? "").includes("upload-artifact"));
    const artifact = String(upload?.with?.name ?? "");
    if (!artifact) errors.push(`completeness job "${key}" must upload the aggregate; it is the canonical full-class record acceptance tooling reads.`);
    else {
      if (!artifactNames.has(artifact)) artifactNames.set(artifact, []);
      artifactNames.get(artifact).push(key);
    }
    for (const context of REQUIRED_CONTEXTS) {
      if (job.name === context) errors.push(`completeness job "${key}" must not be named "${context}": that is a required status context on main.`);
    }
  }

  for (const [artifact, owners] of artifactNames) {
    if (owners.length > 1) {
      errors.push(`artifact name "${artifact}" is uploaded by ${owners.length} jobs (${owners.join(", ")}). Two uploads under one artifact name in a run is refused by the upload action, and a shard whose upload failed reports nothing.`);
    }
  }

  // ---- the red-main alert must wait for all of them ------------------------
  const alert = jobs[ALERT_JOB_KEY];
  if (!alert) {
    errors.push(`"${HOST_NAME}": job "${ALERT_JOB_KEY}" is missing, so a red main reaches nobody`);
  } else {
    const needs = Array.isArray(alert.needs) ? alert.needs : [];
    const required = [...[...shardJobs.values()].map((entry) => entry.key), ...bySubject.values()];
    if (completenessKey) required.push(completenessKey);
    const missing = [...new Set(required)].filter((key) => !needs.includes(key)).sort();
    if (missing.length) {
      errors.push(`"${ALERT_JOB_KEY}" needs must include every shard, adjudicator and completeness job; missing ${JSON.stringify(missing)}. Its own comment claims it covers every job in this host, and without these it can conclude before the shards do — and the aggregate's failure is what turns a LOST shard into an alert, because a cancelled job yields 'cancelled' rather than 'failure'.`);
    }
  }

  return { errors, notes };
}

export function audit({ manifest, costs, sources }) {
  const notes = [];
  const inputs = auditPlanInputs({ manifest, costs, notes });
  const wiring = auditWorkflowWiring({ sources, manifest, notes });
  return { errors: [...inputs.errors, ...wiring.errors], notes, plan: inputs.plan };
}

// ── fixtures ──────────────────────────────────────────────────────────────

const FIXTURE_MANIFEST = Object.freeze({
  classAShardCount: 3,
  gates: Object.freeze(Array.from({ length: 40 }, (unused, index) => Object.freeze({
    script: `g/gate-${String(index).padStart(2, "0")}.mjs`,
    kind: "file",
    enforcement: "batch:A",
    invocation: "node",
    modes: index % 3 === 0 ? ["self-test", "plain"] : ["plain"],
    selfTest: index % 3 === 0 ? "wired" : "none",
    jobKeys: [],
  }))),
});

function fixtureCosts() {
  const costMs = {};
  for (const gate of FIXTURE_MANIFEST.gates) costMs[gate.script] = { plain: 1000 + Number(gate.script.slice(-6, -4)) * 10 };
  return { defaultCostMs: 100, costMs };
}

/** A minimal host document set, returned as plain objects — no Ruby, no parsing. */
function fixtureHostDocuments({ shards = [1, 2, 3], mutate = (document) => document } = {}) {
  const shardJob = (index) => ({
    name: index === 1 ? "Strict grep — static gates (class A)" : `Strict grep — static gates (class A shard ${index})`,
    "runs-on": "ubuntu-latest",
    "timeout-minutes": 15,
    env: { [SHARD_ENV_VAR]: String(index) },
    steps: [
      { uses: "actions/checkout@v4" },
      { uses: "actions/setup-node@v4", with: { "node-version": "20" } },
      { uses: "denoland/setup-deno@v2", with: { "deno-version": "v2.x" } },
      { run: RUN_BATCH_CLASS_A },
      { name: "upload", if: "always()", uses: "actions/upload-artifact@v4", with: { name: index === 1 ? "gate-results-A" : `gate-results-A-shard-${index}`, path: "gate-results-A.json", "if-no-files-found": "error" } },
    ],
  });
  const adjudicatorJob = (index) => ({
    name: index === 1 ? "Strict grep — class A elapsed-time budget (out-of-band)" : `Strict grep — class A shard ${index} elapsed-time budget (out-of-band)`,
    needs: [index === 1 ? CARRIER_JOB_KEY : `static-gates-shard-${index}`],
    if: "always()",
    "runs-on": "ubuntu-latest",
    "timeout-minutes": 5,
    permissions: { contents: "read", actions: "read" },
    steps: [
      { uses: "actions/checkout@v4" },
      { uses: "actions/setup-node@v4", with: { "node-version": "20" } },
      {
        env: {
          GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}",
          CLASS_A_JOB_NAME: shardJob(index).name,
          CLASS_A_BUDGET_SECONDS: BUDGET_SECONDS,
          CLASS_A_TIMEOUT_KILL_SECONDS: TIMEOUT_KILL_SECONDS,
        },
        run: BUDGET_ENFORCE_RUN,
      },
    ],
  });
  const jobs = {};
  const shardKey = (index) => (index === 1 ? CARRIER_JOB_KEY : `static-gates-shard-${index}`);
  for (const index of shards) jobs[shardKey(index)] = shardJob(index);
  for (const index of shards) jobs[index === 1 ? "class-a-budget" : `class-a-budget-shard-${index}`] = adjudicatorJob(index);
  jobs["class-a-shard-completeness"] = {
    name: "Strict grep — class A shard completeness",
    needs: shards.map(shardKey),
    if: "always()",
    "runs-on": "ubuntu-latest",
    "timeout-minutes": 5,
    permissions: { contents: "read", actions: "read" },
    steps: [
      { uses: "actions/checkout@v4" },
      { uses: "actions/setup-node@v4", with: { "node-version": "20" } },
      { uses: "actions/download-artifact@v4", with: { pattern: "gate-results-A*", path: "shard-results" } },
      { run: `node ${COMPLETENESS_MODULE} --aggregate --input shard-results --out gate-results-A-aggregate.json` },
      { if: "always()", uses: "actions/upload-artifact@v4", with: { name: "gate-results-A-aggregate", path: "gate-results-A-aggregate.json", "if-no-files-found": "error" } },
    ],
  };
  jobs[ALERT_JOB_KEY] = {
    name: "Alert: main went red",
    needs: Object.keys(jobs),
    if: "always()",
    "runs-on": "ubuntu-latest",
  };
  return { "fixture-host": mutate({ name: HOST_NAME, on: { push: { branches: ["main"] } }, jobs }) };
}

export function runSelfTest(log = console.log) {
  let assertions = 0;
  const costs = fixtureCosts();

  const expectClean = (label, result) => {
    assert.deepEqual(result.errors, [], `${label}: expected no errors, got ${JSON.stringify(result.errors)}`);
    assertions += 1;
  };
  const expectError = (label, result, needle) => {
    assert.ok(result.errors.length > 0, `${label}: expected at least one error and got NONE. A fixture set that produces zero errors is itself the failure — it is the "matched nothing, therefore green" mode.`);
    assert.ok(result.errors.some((error) => error.includes(needle)),
      `${label}: no error mentioned "${needle}"; got ${JSON.stringify(result.errors)}`);
    assertions += 1;
  };

  // ---- the healthy fixture must be clean, or nothing below means anything --
  expectClean("a correctly wired host", auditHostDocuments({ documents: fixtureHostDocuments(), manifest: FIXTURE_MANIFEST }));
  expectClean("valid plan inputs", auditPlanInputs({ manifest: FIXTURE_MANIFEST, costs }));

  // ---- plan input mutants -------------------------------------------------
  expectError("an emptied cost table", auditPlanInputs({ manifest: FIXTURE_MANIFEST, costs: { defaultCostMs: 100, costMs: {} } }),
    `at least ${MINIMUM_COSTED_EXECUTIONS} are required`);
  expectError("a stale-majority cost table", auditPlanInputs({
    manifest: FIXTURE_MANIFEST,
    costs: { defaultCostMs: 100, costMs: Object.fromEntries(Array.from({ length: 60 }, (unused, i) => [`g/ghost-${i}.mjs`, { plain: 500 }])) },
  }), "name executions that are no longer class A");
  const minorityStale = auditPlanInputs({ manifest: FIXTURE_MANIFEST, costs: { ...costs, costMs: { ...costs.costMs, "g/ghost.mjs": { plain: 500 } } } });
  assert.deepEqual(minorityStale.errors, [], "a MINORITY of stale keys must pass: failing would make removing any gate require a cost refresh");
  assert.ok(minorityStale.notes.some((note) => note.includes("stale")), "a minority of stale keys must still be REPORTED");
  assertions += 2;
  for (const [label, bad] of [["absent", undefined], ["zero", 0], ["negative", -5], ["a string", "100"]]) {
    expectError(`defaultCostMs ${label}`, auditPlanInputs({ manifest: FIXTURE_MANIFEST, costs: { defaultCostMs: bad, costMs: costs.costMs } }), "defaultCostMs must be a positive integer");
  }
  expectError("a cost above the whole bound", auditPlanInputs({
    manifest: FIXTURE_MANIFEST,
    costs: { ...costs, costMs: { ...costs.costMs, "g/gate-00.mjs": { plain: MAXIMUM_COST_MS + 1 } } },
  }), `at most ${MAXIMUM_COST_MS} ms`);
  expectError("an absent cost table", auditPlanInputs({ manifest: FIXTURE_MANIFEST, costs: null }), "is absent or is not a JSON object");
  for (const [label, bad] of [["absent", undefined], ["zero", 0], ["a string", "3"]]) {
    expectError(`${SHARD_COUNT_FIELD} ${label}`, auditPlanInputs({ manifest: { ...FIXTURE_MANIFEST, classAShardCount: bad }, costs }), `${SHARD_COUNT_FIELD} must be an integer >= 1`);
  }
  // shardCount 4 must still partition the class exactly.
  expectClean(`${SHARD_COUNT_FIELD} raised to 4`, auditPlanInputs({ manifest: { ...FIXTURE_MANIFEST, classAShardCount: 4 }, costs }));
  // A count larger than the class would leave a shard empty, which is a job that
  // always passes and proves nothing.
  expectError("more shards than executions", auditPlanInputs({ manifest: { ...FIXTURE_MANIFEST, classAShardCount: 5000 }, costs }), "are EMPTY");

  // ---- wiring mutants ----------------------------------------------------
  const wiring = (options) => auditHostDocuments({ documents: fixtureHostDocuments(options), manifest: FIXTURE_MANIFEST });

  expectError("a shard job missing entirely", wiring({ shards: [1, 2] }), `no job declares ${SHARD_ENV_VAR}=3`);
  expectError("two jobs claiming one shard index", wiring({
    mutate: (document) => {
      document.jobs["static-gates-shard-3"].env[SHARD_ENV_VAR] = "2";
      return document;
    },
  }), "two jobs claim one shard");
  expectError("a shard index outside range", wiring({
    mutate: (document) => {
      document.jobs["static-gates-shard-3"].env[SHARD_ENV_VAR] = "4";
      return document;
    },
  }), `${SHARD_ENV_VAR}=4 is outside 1..3`);
  expectError("a shard job carrying strategy:", wiring({
    mutate: (document) => {
      document.jobs["static-gates-shard-2"].strategy = { "fail-fast": false, matrix: { shard: [2, 3] } };
      return document;
    },
  }), "declares a strategy: key");
  expectError("a shard job with a shorter timeout", wiring({
    mutate: (document) => {
      document.jobs["static-gates-shard-2"]["timeout-minutes"] = 10;
      return document;
    },
  }), `timeout-minutes must be the exact integer ${SHARD_TIMEOUT_MINUTES}`);
  expectError("a shard job gaining a condition", wiring({
    mutate: (document) => {
      document.jobs["static-gates-shard-2"].if = "${{ github.event.pull_request.draft != true }}";
      return document;
    },
  }), "must carry NO job-level if:");
  expectError("a shard job gaining a needs edge", wiring({
    mutate: (document) => {
      document.jobs["static-gates-shard-3"].needs = ["static-gates-shard-2"];
      return document;
    },
  }), "must carry NO needs:");
  expectError("a shard job losing Deno", wiring({
    mutate: (document) => {
      document.jobs["static-gates-shard-2"].steps = document.jobs["static-gates-shard-2"].steps
        .filter((step) => !String(step.uses ?? "").includes("setup-deno"));
      return document;
    },
  }), "must set up Deno");
  expectError("a shard job not running the batched runner", wiring({
    mutate: (document) => {
      document.jobs["static-gates-shard-2"].steps = document.jobs["static-gates-shard-2"].steps
        .map((step) => (step.run === RUN_BATCH_CLASS_A ? { run: "echo skip" } : step));
      return document;
    },
  }), "must run the batched class A runner");
  expectError("two shards sharing an artifact name", wiring({
    mutate: (document) => {
      for (const step of document.jobs["static-gates-shard-3"].steps) {
        if (String(step.uses ?? "").includes("upload-artifact")) step.with.name = "gate-results-A-shard-2";
      }
      return document;
    },
  }), "is uploaded by 2 jobs");
  expectError("an adjudicator naming the wrong job", wiring({
    mutate: (document) => {
      for (const step of document.jobs["class-a-budget-shard-3"].steps) {
        if (step.run === BUDGET_ENFORCE_RUN) step.env.CLASS_A_JOB_NAME = "Strict grep — static gates (class A shard 2)";
      }
      return document;
    },
  }), "both name the subject");
  expectError("a shard losing its adjudicator", wiring({
    mutate: (document) => {
      delete document.jobs["class-a-budget-shard-3"];
      document.jobs[ALERT_JOB_KEY].needs = document.jobs[ALERT_JOB_KEY].needs.filter((key) => key !== "class-a-budget-shard-3");
      return document;
    },
  }), "has no out-of-band elapsed-time adjudicator");
  expectError("an adjudicator losing if: always()", wiring({
    mutate: (document) => {
      delete document.jobs["class-a-budget-shard-2"].if;
      return document;
    },
  }), "must carry if: always()");
  expectError("an adjudicator's bound lowered off the constitutional value", wiring({
    mutate: (document) => {
      for (const step of document.jobs["class-a-budget-shard-2"].steps) {
        if (step.run === BUDGET_ENFORCE_RUN) step.env.CLASS_A_BUDGET_SECONDS = "450";
      }
      return document;
    },
  }), "CLASS_A_BUDGET_SECONDS must be");
  expectError("an adjudicator's kill floor moved", wiring({
    mutate: (document) => {
      for (const step of document.jobs["class-a-budget-shard-2"].steps) {
        if (step.run === BUDGET_ENFORCE_RUN) step.env.CLASS_A_TIMEOUT_KILL_SECONDS = "700";
      }
      return document;
    },
  }), "CLASS_A_TIMEOUT_KILL_SECONDS must be");
  expectError("the completeness job deleted", wiring({
    mutate: (document) => {
      delete document.jobs["class-a-shard-completeness"];
      document.jobs[ALERT_JOB_KEY].needs = document.jobs[ALERT_JOB_KEY].needs.filter((key) => key !== "class-a-shard-completeness");
      return document;
    },
  }), "exactly one job must run the class A shard completeness aggregate");
  expectError("the completeness job losing if: always()", wiring({
    mutate: (document) => {
      delete document.jobs["class-a-shard-completeness"].if;
      return document;
    },
  }), "must carry if: always()");
  expectError("the completeness job no longer needing every shard", wiring({
    mutate: (document) => {
      document.jobs["class-a-shard-completeness"].needs = [CARRIER_JOB_KEY];
      return document;
    },
  }), "needs must be exactly every shard job");
  expectError("merge-multiple enabled on the download", wiring({
    mutate: (document) => {
      for (const step of document.jobs["class-a-shard-completeness"].steps) {
        if (String(step.uses ?? "").includes("download-artifact")) step.with["merge-multiple"] = true;
      }
      return document;
    },
  }), "must not set merge-multiple");
  expectError("a job key absent from the alert's needs", wiring({
    mutate: (document) => {
      document.jobs[ALERT_JOB_KEY].needs = document.jobs[ALERT_JOB_KEY].needs.filter((key) => key !== "static-gates-shard-2");
      return document;
    },
  }), "needs must include every shard, adjudicator and completeness job");
  expectError("a workflow-level permissions block appearing", wiring({
    mutate: (document) => {
      document.permissions = { contents: "read" };
      return document;
    },
  }), "workflow-level permissions must stay ABSENT");
  expectError("shard 1 no longer being the sealed carrier job", wiring({
    mutate: (document) => {
      document.jobs["static-gates-renamed"] = document.jobs[CARRIER_JOB_KEY];
      delete document.jobs[CARRIER_JOB_KEY];
      document.jobs["class-a-budget"].needs = ["static-gates-renamed"];
      document.jobs["class-a-shard-completeness"].needs = ["static-gates-renamed", "static-gates-shard-2", "static-gates-shard-3"];
      document.jobs[ALERT_JOB_KEY].needs = Object.keys(document.jobs).filter((key) => key !== ALERT_JOB_KEY);
      return document;
    },
  }), `shard 1 must be the pre-existing "${CARRIER_JOB_KEY}" job`);
  expectError("a new job claiming a required status context's name", wiring({
    mutate: (document) => {
      document.jobs["static-gates-shard-2"].name = REQUIRED_CONTEXTS[0];
      for (const step of document.jobs["class-a-budget-shard-2"].steps) {
        if (step.run === BUDGET_ENFORCE_RUN) step.env.CLASS_A_JOB_NAME = REQUIRED_CONTEXTS[0];
      }
      return document;
    },
  }), `must not be named "${REQUIRED_CONTEXTS[0]}"`);
  expectError("no host carrying the display name", auditHostDocuments({
    documents: { "fixture-host": { name: "Something Else", jobs: {} } },
    manifest: FIXTURE_MANIFEST,
  }), `exactly one workflow must be named "${HOST_NAME}"`);

  // The Ruby parser is still the LIVE path, and a parse error must be an error and
  // not a silent "no host found". Exercised once, on a deliberately broken document.
  expectError("a workflow that does not parse", auditWorkflowWiring({
    sources: { "fixture-host": "name: [unclosed\n  bad: : :" },
    manifest: FIXTURE_MANIFEST,
  }), "fixture-host:");

  log(`#3449 class A shard plan self-test: PASS (${assertions} assertions)`);
  return assertions;
}

function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    return;
  }

  let manifest;
  let costs = null;
  try {
    manifest = loadManifest();
  } catch (error) {
    console.error(`::error::#3449 class A shard plan: the gate registry could not be read — ${error.message}`);
    process.exitCode = 1;
    return;
  }
  try {
    costs = loadShardCosts();
  } catch (error) {
    console.error(`::error::#3449 class A shard plan: the class A shard cost table could not be read — ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const { errors, notes, plan } = audit({ manifest, costs, sources: readWorkflowSources() });
  for (const note of notes) console.log(`  note: ${note}`);
  if (plan) {
    console.log(`  planned loads (s): ${plan.loadsMs.map((ms) => (ms / 1000).toFixed(1)).join(" / ")}`);
    console.log(`  planned counts   : ${plan.shards.map((shard) => shard.length).join(" / ")}`);
    console.log(`  union ${plan.shards.reduce((sum, shard) => sum + shard.length, 0)} execution(s) · costed ${plan.costed} · defaulted ${plan.defaulted}`);
  }
  if (errors.length) {
    for (const error of errors) console.error(`::error::${error}`);
    console.error(`#3449 class A shard plan: FAIL (${errors.length} error(s))`);
    process.exitCode = 1;
    return;
  }
  console.log(`#3449 class A shard plan: PASS — the plan partitions class A and "${HOST_NAME}" is wired to run it.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
