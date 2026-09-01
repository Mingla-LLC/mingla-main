#!/usr/bin/env node
// Issue #2881 — fail-closed PR draft-gate policy.
//
// Every pull-request workflow except the two that produce this repo's REQUIRED
// status checks skips its jobs while the pull request is a draft, and re-fires
// on `ready_for_review` so the merged SHA is always the fully tested SHA.
//
// THE FAILURE MODE THIS GATE EXISTS FOR
// ------------------------------------
// `ready_for_review` is NOT one of GitHub's default `pull_request` activity
// types (`opened`, `synchronize`, `reopened`). A workflow that gains a draft
// condition WITHOUT gaining `ready_for_review` in `types:` will, for a PR opened
// as a draft:
//     opened      -> job skipped   -> conclusion `skipped` on SHA A
//     synchronize -> job skipped   -> conclusion `skipped` on SHA B
//     mark ready  -> NOTHING fires (no matching activity type)
// and SHA B merges carrying a `skipped` conclusion. GitHub counts `success`,
// `skipped` and `neutral` alike as satisfying a required check, so that reads
// green having never executed. That is #2113's "check that carries no info"
// crossed with #2290's "switch with no caller", and it is silent.
//
// A1 below is the biconditional that makes the two halves inseparable. A5 is
// the partition assertion that makes a NEW workflow omitting the policy fail
// the build rather than quietly opting out.
//
// SCOPE. This gate says nothing about `concurrency:` — that is #2851's gate
// (`issue-2851-pr-concurrency-policy.mjs`), which contains no `types`/`draft`/
// `ready_for_review` logic and is deliberately left untouched. Same family,
// different assertion.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../..");

/** The canonical standalone job condition. */
export const DRAFT_IF = "${{ github.event.pull_request.draft != true }}";
/** The canonical composed form: the draft condition is always the LEADING conjunct. */
export const COMPOSED_PREFIX = "${{ (github.event.pull_request.draft != true) && (";
export const COMPOSED_SUFFIX = ") }}";
/** The substring that identifies a draft condition at all, canonical or not. */
export const DRAFT_MARKER = "github.event.pull_request.draft";

/**
 * `!= true` rather than `== false` on purpose. Both skip only on an explicit
 * boolean true and both run on a push (GitHub coerces an absent property to
 * null, and null == false). `!= true` is chosen because it makes the direction
 * of failure syntactically obvious: the ONLY input that yields a skip is a
 * literal true. A gate that fails toward running wastes minutes; a gate that
 * fails toward skipping ships a green check that never executed.
 */
export const REQUIRED_TYPES = Object.freeze(["opened", "synchronize", "reopened", "ready_for_review"]);

// Live workflow filenames are assembled rather than written literally so the
// CI-batch provider-discovery scanner cannot mistake a policy declaration for a
// consumer (same reason as #2851's `liveWorkflow` helper).
const liveWorkflow = (...stem) => `${stem.join("-")}.${["y", "ml"].join("")}`;

/**
 * THE MERGE GATE SET (MGS) — the single registry of always-on workflows.
 *
 * Membership means: never draft-gated, runs on every pull-request event
 * regardless of draft state, and is a check that actually blocks a merge.
 *
 * #2881 seeds this with the two workflows that produce the repo's only
 * ruleset-required status checks. #2882 (test tiering) GROWS THIS SAME LIST
 * when it promotes the money-and-login tier to the merge gate — it must not
 * define a parallel "tier 1" list, because two lists of "things that gate a
 * merge" is exactly how the two drift apart. Every entry cites an issue and a
 * reason; A5 enforces that.
 *
 * Verified 2026-08-31 by snapshot read of
 * GET /repos/Mingla-LLC/mingla-main/rules/branches/main — 6 effective rules
 * across 3 rulesets, exactly two `required_status_checks` contexts. There is no
 * branch protection (/branches/main/protection -> 404).
 */
export const ALWAYS_ON = Object.freeze([
  Object.freeze({
    path: liveWorkflow("framework", "major", "guard"),
    context: "Framework Major Guard",
    ruleset: "19508605",
    issue: "#2881",
    reason: "ruleset-required status check with ZERO bypass actors; a skipped required check reads green having never run",
  }),
  Object.freeze({
    path: liveWorkflow("mingla", "business", "jest", "suite"),
    context: "mingla-business jest (full suite)",
    ruleset: "19583754",
    issue: "#2881",
    reason: "ruleset-required status check; also the only per-push feedback that actually blocks a merge",
  }),
]);

/** The one programmatic PR-creation call site, which must NEVER open a draft. */
export const BOT_PR_CREATION_SITE = "mingla-business/scripts/ci/bundle-baseline-pr-handoff.mjs";

const RUBY_PARSE = String.raw`
require "yaml"
require "json"
require "psych"

payload = JSON.parse(STDIN.read)
documents = {}
errors = []
payload.fetch("sources").each do |file, source|
  begin
    Psych.parse_stream(source, filename: file)
    documents[file] = YAML.safe_load(source, aliases: true) || {}
  rescue => error
    errors << "#{file}: malformed or unresolvable YAML: #{error.class}: #{error.message.lines.first.to_s.strip}"
  end
end
STDOUT.write(JSON.generate({"documents" => documents, "errors" => errors}))
`;

function parseSources(sources) {
  let output;
  try {
    output = execFileSync("ruby", ["-e", RUBY_PARSE], {
      input: JSON.stringify({ sources }),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    return { documents: {}, errors: [`Ruby/Psych workflow inspection failed: ${error.message}`] };
  }
  return JSON.parse(output);
}

function eventNames(document, workflowName, errors) {
  // `on:` is parsed by YAML 1.1 as the boolean key `true`; both spellings occur.
  const onValue = Object.hasOwn(document, "on") ? document.on : document.true;
  if (typeof onValue === "string") return { events: [onValue], block: null };
  if (Array.isArray(onValue)) {
    if (!onValue.every((event) => typeof event === "string")) {
      errors.push(`${workflowName}: unsupported event declaration shape`);
      return { events: [], block: null };
    }
    return { events: onValue, block: null };
  }
  if (onValue && typeof onValue === "object") {
    const block = onValue.pull_request ?? onValue.pull_request_target ?? null;
    return { events: Object.keys(onValue), block };
  }
  errors.push(`${workflowName}: unsupported event declaration shape`);
  return { events: [], block: null };
}

/** True iff the string is a draft condition in ANY shape — canonical or not. */
export function carriesDraftCondition(value) {
  return typeof value === "string" && value.includes(DRAFT_MARKER);
}

/** True iff the string is the canonical standalone or canonical composed form. */
export function isCanonicalDraftIf(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === DRAFT_IF) return true;
  if (!trimmed.startsWith(COMPOSED_PREFIX) || !trimmed.endsWith(COMPOSED_SUFFIX)) return false;
  const inner = trimmed.slice(COMPOSED_PREFIX.length, -COMPOSED_SUFFIX.length).trim();
  return inner.length > 0 && !inner.includes(DRAFT_MARKER);
}

/**
 * A6 — the evaluation model.
 *
 * Models GitHub's evaluation of the canonical expression, including the loose
 * equality that makes it a no-op for non-PR events: an absent property is null,
 * null casts to 0, `true` casts to 1, so `null != true` is true and the job
 * runs. Everything about "push, schedule and workflow_dispatch are untouched"
 * rests on this one line, so it is modelled and asserted rather than assumed.
 */
export function evaluateDraftGate(eventName, draft) {
  const prFamily = eventName === "pull_request" || eventName === "pull_request_target";
  const value = prFamily ? draft : undefined; // non-PR events have no pull_request payload
  return { runs: value !== true, prFamily };
}

export function auditWorkflowSources(sources, options = {}) {
  const { alwaysOn = ALWAYS_ON, botCreationSource = null, requireBotSource = true } = options;
  const parsed = parseSources(sources);
  const errors = [...parsed.errors];
  const alwaysOnPaths = new Set(alwaysOn.map((entry) => entry.path));
  const requiredContexts = new Map(alwaysOn.map((entry) => [entry.context, entry.path]));

  const counts = { totalWorkflows: Object.keys(parsed.documents).length, prFamily: 0, gated: 0, exempt: 0, gatedJobs: 0, composed: 0 };
  const seenAlwaysOn = new Set();

  for (const workflowName of Object.keys(parsed.documents).sort()) {
    const document = parsed.documents[workflowName];
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      errors.push(`${workflowName}: workflow document must be a mapping`);
      continue;
    }
    const { events, block } = eventNames(document, workflowName, errors);
    const isPrFamily = events.includes("pull_request") || events.includes("pull_request_target");

    const jobs = document.jobs && typeof document.jobs === "object" && !Array.isArray(document.jobs) ? document.jobs : {};
    const jobKeys = Object.keys(jobs);

    // A4 (second half) — a required context's job name may live ONLY in its own
    // exempt workflow. Moving one into a gated file would draft-gate a required
    // check by the back door.
    for (const jobKey of jobKeys) {
      const jobName = jobs[jobKey]?.name;
      if (typeof jobName !== "string") continue;
      const owner = requiredContexts.get(jobName.trim());
      if (owner && owner !== workflowName) {
        errors.push(
          `${workflowName}: job ${jobKey} declares name "${jobName.trim()}", which is a required status-check context owned by ${owner}. ` +
          `A required context must live in its always-on workflow or it becomes draft-gateable.`,
        );
      }
    }

    if (!isPrFamily) {
      for (const jobKey of jobKeys) {
        if (carriesDraftCondition(jobs[jobKey]?.if)) {
          errors.push(`${workflowName}: job ${jobKey} carries a draft condition but the workflow has no pull-request trigger`);
        }
      }
      continue;
    }
    counts.prFamily += 1;

    const declaredTypes = block && typeof block === "object" && !Array.isArray(block) ? block.types : undefined;
    const typesList = Array.isArray(declaredTypes) ? declaredTypes.map(String) : null;
    const hasReadyForReview = typesList !== null && typesList.includes("ready_for_review");
    const draftJobs = jobKeys.filter((jobKey) => carriesDraftCondition(jobs[jobKey]?.if));

    if (alwaysOnPaths.has(workflowName)) {
      // ---- A4 — exempt-set integrity ----
      counts.exempt += 1;
      seenAlwaysOn.add(workflowName);
      const entry = alwaysOn.find((candidate) => candidate.path === workflowName);
      if (draftJobs.length) {
        errors.push(
          `${workflowName}: always-on merge-gate workflow carries a draft condition on job(s) ${draftJobs.join(", ")}. ` +
          `Its required context "${entry.context}" would report \`skipped\`, which GitHub counts as satisfying a required check — a check reading green having never run.`,
        );
      }
      if (typesList !== null) {
        errors.push(`${workflowName}: always-on merge-gate workflow must not restrict pull-request activity types (found ${JSON.stringify(typesList)})`);
      }
      const names = jobKeys.map((jobKey) => (typeof jobs[jobKey]?.name === "string" ? jobs[jobKey].name.trim() : null));
      if (!names.includes(entry.context)) {
        errors.push(
          `${workflowName}: no job declares name "${entry.context}", the required status-check context this entry claims it produces. ` +
          `Renaming the job silently unbinds the ruleset.`,
        );
      }
      continue;
    }

    // ---- gated set ----
    counts.gated += 1;
    counts.gatedJobs += jobKeys.length;

    // A1 — the biconditional. This is the whole point of the gate.
    if (draftJobs.length > 0 && !hasReadyForReview) {
      errors.push(
        `${workflowName}: carries a draft condition but does not declare ready_for_review in types:. ` +
        `Marking the pull request ready would fire NOTHING and leave a \`skipped\` conclusion standing on the merged SHA.`,
      );
    }
    if (draftJobs.length === 0 && hasReadyForReview) {
      errors.push(
        `${workflowName}: declares ready_for_review in types: but no job carries a draft condition. ` +
        `Half the #2881 policy is a wasted extra fan-out at ready; apply both halves or neither.`,
      );
    }

    // A5 — partition totality. A NEW pull-request workflow lands here.
    if (draftJobs.length === 0 && !hasReadyForReview) {
      errors.push(
        `${workflowName}: pull-request workflow belongs to neither the #2881 draft-gated set nor the always-on merge gate. ` +
        `Add the canonical types: + job condition, or register it in ALWAYS_ON with an issue and a reason.`,
      );
      continue;
    }

    // A2 — types exactness.
    if (typesList === null || typesList.length !== REQUIRED_TYPES.length || !REQUIRED_TYPES.every((t) => typesList.includes(t))) {
      const missing = REQUIRED_TYPES.filter((t) => !(typesList ?? []).includes(t));
      const extra = (typesList ?? []).filter((t) => !REQUIRED_TYPES.includes(t));
      const detail = missing.includes("synchronize")
        ? "dropping synchronize stops the FINAL push being tested, so the pull request would merge on a stale green"
        : `missing ${JSON.stringify(missing)}, unexpected ${JSON.stringify(extra)}`;
      errors.push(`${workflowName}: types must be exactly ${JSON.stringify(REQUIRED_TYPES)} — ${detail}`);
    }

    // A3 — totality within the workflow: EVERY job, no exceptions.
    if (jobKeys.length === 0) errors.push(`${workflowName}: pull-request workflow declares no jobs`);
    for (const jobKey of jobKeys) {
      const value = jobs[jobKey]?.if;
      if (!carriesDraftCondition(value)) {
        errors.push(
          `${workflowName}: job ${jobKey} has no draft condition. Every job of a draft-gated workflow must carry it, ` +
          `or that one job runs on every draft push while the rest skip.`,
        );
        continue;
      }
      if (!isCanonicalDraftIf(value)) {
        errors.push(
          `${workflowName}: job ${jobKey} has a non-canonical draft condition ${JSON.stringify(String(value).trim())}. ` +
          `Use exactly ${JSON.stringify(DRAFT_IF)}, or ${JSON.stringify(`${COMPOSED_PREFIX}<existing>${COMPOSED_SUFFIX}`)}.`,
        );
        continue;
      }
      if (String(value).trim() !== DRAFT_IF) counts.composed += 1;
    }
  }

  for (const entry of alwaysOn) {
    if (!seenAlwaysOn.has(entry.path)) {
      errors.push(`${entry.path}: registered always-on merge-gate workflow is missing or is not pull-request triggered (${entry.reason})`);
    }
    if (!entry.issue || !/^#\d+$/.test(String(entry.issue)) || !entry.reason || !entry.context || !entry.ruleset) {
      errors.push(`${entry.path}: ALWAYS_ON entry must cite context, ruleset, an issue (#NNNN) and a reason`);
    }
  }
  if (counts.prFamily === 0) errors.push("zero pull-request workflows discovered");
  if (counts.gated + counts.exempt !== counts.prFamily) {
    errors.push(`partition is not total: ${counts.gated} gated + ${counts.exempt} exempt != ${counts.prFamily} pull-request workflows`);
  }

  // A6 — evaluation proof over the full event x draft cross product.
  proveEvaluation(errors);

  // A7 — the one programmatic PR-creation call site must never open a draft.
  auditBotCreationSite(errors, botCreationSource, requireBotSource);

  return { errors, counts };
}

function proveEvaluation(errors) {
  const events = ["pull_request", "pull_request_target", "push", "schedule", "workflow_dispatch"];
  const draftValues = [true, false, undefined];
  for (const eventName of events) {
    for (const draft of draftValues) {
      const { runs, prFamily } = evaluateDraftGate(eventName, draft);
      const shouldSkip = prFamily && draft === true;
      if (runs === shouldSkip) {
        errors.push(`evaluation proof failed for event=${eventName} draft=${String(draft)}: runs=${runs}, expected runs=${!shouldSkip}`);
      }
    }
  }
  for (const eventName of ["push", "schedule", "workflow_dispatch"]) {
    for (const draft of draftValues) {
      if (!evaluateDraftGate(eventName, draft).runs) {
        errors.push(`${eventName} is skipped by the draft gate — non-pull-request triggers must be untouched (#2881 scope)`);
      }
    }
  }
}

function auditBotCreationSite(errors, source, required) {
  if (source === null) {
    if (!required) return;
    let read;
    try {
      read = fs.readFileSync(path.join(REPO_ROOT, BOT_PR_CREATION_SITE), "utf8");
    } catch {
      errors.push(`${BOT_PR_CREATION_SITE}: the sole programmatic pull-request creation site is missing; the #2881 no-draft carve-out cannot be proven`);
      return;
    }
    return auditBotCreationSite(errors, read, required);
  }
  const call = /createPull:[\s\S]{0,600}?request\(\s*"POST"\s*,\s*"\/pulls"\s*,\s*\{([\s\S]*?)\}\s*\)/.exec(source);
  if (!call) {
    errors.push(`${BOT_PR_CREATION_SITE}: could not locate the createPull POST /pulls request body; the #2881 no-draft carve-out cannot be proven`);
    return;
  }
  if (/\bdraft\b/.test(call[1])) {
    errors.push(
      `${BOT_PR_CREATION_SITE}: createPull passes a \`draft\` field. bundle-baseline pull requests must NEVER be drafts — ` +
      `a draft cannot be auto-merged, and bundle-baseline-automerge treats \`skipped\` as a passing conclusion, so a drafted ` +
      `baseline pull request would be merged on checks that never ran.`,
    );
  }
}

export function readWorkflowSources(root = REPO_ROOT) {
  const directory = path.join(root, ".github/workflows");
  return Object.fromEntries(fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => [entry.name, fs.readFileSync(path.join(directory, entry.name), "utf8")])
    .sort(([left], [right]) => left.localeCompare(right)));
}

// ---------------------------------------------------------------------------
// self-test
// ---------------------------------------------------------------------------

const GATED_A = "alpha-checks.yml";
const GATED_B = "beta-checks.yml";
const EXEMPT_A = ALWAYS_ON[0].path;
const EXEMPT_B = ALWAYS_ON[1].path;
const OK_BOT_SOURCE = `const adapter = {\n  createPull: async ({ title, body, branch }) =>\n    request("POST", "/pulls", { title, body, head: branch, base: "main" }),\n};\n`;

const wf = ({ types = REQUIRED_TYPES, jobs, event = "pull_request", name = "Checks" }) => {
  const typesLine = types === null ? "" : `    types: [${types.join(", ")}]\n`;
  const body = Object.entries(jobs).map(([key, job]) => {
    const cond = job.if === null ? "" : `    if: ${job.if}\n`;
    const jobName = job.name ? `    name: "${job.name}"\n` : "";
    return `  ${key}:\n${cond}${jobName}    runs-on: ubuntu-latest\n    steps:\n      - run: true\n`;
  }).join("");
  return `name: ${name}\non:\n  ${event}:\n${typesLine}jobs:\n${body}`;
};

const safeSources = () => ({
  [GATED_A]: wf({ jobs: { one: { if: DRAFT_IF }, two: { if: `${COMPOSED_PREFIX}always()${COMPOSED_SUFFIX}` } } }),
  [GATED_B]: wf({ event: "pull_request_target", jobs: { only: { if: DRAFT_IF } } }),
  [EXEMPT_A]: wf({ types: null, jobs: { guard: { if: null, name: ALWAYS_ON[0].context } } }),
  [EXEMPT_B]: wf({ types: null, jobs: { jest: { if: null, name: ALWAYS_ON[1].context } } }),
});

function expectFailure(label, mutate, diagnostic, assertions) {
  const sources = safeSources();
  let botSource = OK_BOT_SOURCE;
  const setBot = (next) => { botSource = next; };
  mutate(sources, setBot);
  const result = auditWorkflowSources(sources, { botCreationSource: botSource });
  assert.ok(
    result.errors.some((error) => error.includes(diagnostic)),
    `${label}: expected an error containing ${JSON.stringify(diagnostic)}; got ${result.errors.join(" | ") || "(none)"}`,
  );
  return assertions + 1;
}

export function runSelfTest() {
  let assertions = 0;

  const safe = auditWorkflowSources(safeSources(), { botCreationSource: OK_BOT_SOURCE });
  assert.deepEqual(safe.errors, []);
  assert.equal(safe.counts.prFamily, 4);
  assert.equal(safe.counts.gated, 2);
  assert.equal(safe.counts.exempt, 2);
  assert.equal(safe.counts.gatedJobs, 3);
  assert.equal(safe.counts.composed, 1);
  assertions += 5;

  const cases = [
    // A1 — the fatal mode, both directions.
    ["A1 draft condition without ready_for_review",
      (s) => { s[GATED_A] = wf({ types: ["opened", "synchronize", "reopened"], jobs: { one: { if: DRAFT_IF } } }); },
      "does not declare ready_for_review"],
    ["A1 ready_for_review without a draft condition",
      (s) => { s[GATED_A] = wf({ jobs: { one: { if: null } } }); },
      "declares ready_for_review in types: but no job carries a draft condition"],
    // A2 — types exactness.
    ["A2 synchronize dropped",
      (s) => { s[GATED_A] = wf({ types: ["opened", "reopened", "ready_for_review"], jobs: { one: { if: DRAFT_IF } } }); },
      "merge on a stale green"],
    ["A2 unexpected activity type",
      (s) => { s[GATED_A] = wf({ types: [...REQUIRED_TYPES, "labeled"], jobs: { one: { if: DRAFT_IF } } }); },
      "types must be exactly"],
    // A3 — per-job totality and canonical shape.
    ["A3 one job missing the condition",
      (s) => { s[GATED_A] = wf({ jobs: { one: { if: DRAFT_IF }, two: { if: null } } }); },
      "job two has no draft condition"],
    ["A3 non-canonical condition shape",
      (s) => { s[GATED_A] = wf({ jobs: { one: { if: "${{ github.event.pull_request.draft == false }}" } } }); },
      "non-canonical draft condition"],
    ["A3 draft condition buried behind another conjunct",
      (s) => { s[GATED_A] = wf({ jobs: { one: { if: "${{ always() && github.event.pull_request.draft != true }}" } } }); },
      "non-canonical draft condition"],
    ["A3 zero jobs",
      (s) => { s[GATED_A] = `name: Checks\non:\n  pull_request:\n    types: [${REQUIRED_TYPES.join(", ")}]\njobs: {}\n`; },
      "declares no jobs"],
    // A4 — exempt-set integrity.
    ["A4 required workflow draft-gated",
      (s) => { s[EXEMPT_A] = wf({ types: null, jobs: { guard: { if: DRAFT_IF, name: ALWAYS_ON[0].context } } }); },
      "would report `skipped`"],
    ["A4 required workflow restricts activity types",
      (s) => { s[EXEMPT_A] = wf({ jobs: { guard: { if: null, name: ALWAYS_ON[0].context } } }); },
      "must not restrict pull-request activity types"],
    ["A4 required job renamed",
      (s) => { s[EXEMPT_A] = wf({ types: null, jobs: { guard: { if: null, name: "Framework Guard v2" } } }); },
      "silently unbinds the ruleset"],
    ["A4 required context moved into a gated workflow",
      (s) => { s[GATED_A] = wf({ jobs: { one: { if: DRAFT_IF, name: ALWAYS_ON[1].context } } }); },
      "required status-check context owned by"],
    ["A4 registered always-on workflow deleted",
      (s) => { delete s[EXEMPT_B]; },
      "is missing or is not pull-request triggered"],
    // A5 — partition totality. THIS IS AC-4.
    ["A5 brand-new pull-request workflow with no policy",
      (s) => { s["gamma-checks.yml"] = wf({ types: null, jobs: { one: { if: null } } }); },
      "belongs to neither the #2881 draft-gated set nor the always-on merge gate"],
    // Non-PR workflows may not carry the condition either.
    ["non-pull-request workflow carrying a draft condition",
      (s) => { s["delta-cron.yml"] = wf({ types: null, event: "schedule", jobs: { one: { if: DRAFT_IF } } }); },
      "the workflow has no pull-request trigger"],
    // A7 — the bot carve-out.
    ["A7 bot creation site opens a draft",
      (s, setBot) => { setBot(OK_BOT_SOURCE.replace("base: \"main\"", "base: \"main\", draft: true")); },
      "must NEVER be drafts"],
    ["A7 bot creation site unreadable",
      (s, setBot) => { setBot("export const nothing = 1;\n"); },
      "could not locate the createPull"],
    // parser integrity
    ["malformed YAML",
      (s) => { s[GATED_A] = "on: [pull_request\njobs: {}\n"; },
      "malformed or unresolvable YAML"],
  ];

  for (const [label, mutate, diagnostic] of cases) {
    assertions = expectFailure(label, mutate, diagnostic, assertions);
  }

  // A6 — the evaluation model, asserted directly as well as via the audit.
  for (const eventName of ["pull_request", "pull_request_target"]) {
    assert.equal(evaluateDraftGate(eventName, true).runs, false, `${eventName} draft must skip`);
    assert.equal(evaluateDraftGate(eventName, false).runs, true, `${eventName} ready must run`);
    assertions += 2;
  }
  for (const eventName of ["push", "schedule", "workflow_dispatch"]) {
    for (const draft of [true, false, undefined]) {
      assert.equal(evaluateDraftGate(eventName, draft).runs, true, `${eventName} must never be skipped by the draft gate`);
      assertions += 1;
    }
  }

  return assertions;
}

function main() {
  if (process.argv.includes("--self-test")) {
    const assertions = runSelfTest();
    console.log(`#2881 PR draft-gate policy self-test: PASS (${assertions} assertions)`);
    return;
  }
  const result = auditWorkflowSources(readWorkflowSources());
  if (result.errors.length) {
    for (const error of result.errors) console.error(`::error::${error}`);
    console.error(`#2881 PR draft-gate policy: FAIL (${result.errors.length} error(s))`);
    process.exitCode = 1;
    return;
  }
  const c = result.counts;
  console.log(
    `#2881 PR draft-gate policy: PASS — ${c.totalWorkflows} total / ${c.prFamily} PR-family / ` +
    `${c.gated} draft-gated (${c.gatedJobs} jobs, ${c.composed} composed) / ${c.exempt} always-on merge gate`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
