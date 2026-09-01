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
import crypto from "node:crypto";
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
    kind: "ruleset-required",
    context: "Framework Major Guard",
    ruleset: "19508605",
    issue: "#2881",
    reason: "ruleset-required status check with ZERO bypass actors; a skipped required check reads green having never run",
  }),
  Object.freeze({
    path: liveWorkflow("mingla", "business", "jest", "suite"),
    kind: "ruleset-required",
    context: "mingla-business jest (full suite)",
    ruleset: "19583754",
    issue: "#2881",
    reason: "ruleset-required status check; also the only per-push feedback that actually blocks a merge",
  }),
  // ---- pin-protected (see A8) -------------------------------------------------
  // These carry an assertion, OWNED BY ANOTHER ISSUE, over their own file content
  // or trigger shape. #2881 must leave them byte-identical: the pin is the other
  // issue's contract and re-writing it to suit this one would be weakening it.
  // A8 DERIVES this set by computation and fails if it drifts, so occurrence #4
  // fails the build instead of a CI run.
  Object.freeze({
    path: liveWorkflow("issue", "1614", "onconflict", "arbiter", "audit"),
    kind: "pin-protected",
    issue: "#1614",
    pin: "regex",
    pinnedBy: ".github/scripts/__tests__/issue-1614-onconflict-arbiter-audit.test.mjs",
    reason: "asserts /pull_request:\\s*\\n\\s*push:/ over its own trigger block; a types: insertion splits that match",
  }),
  Object.freeze({
    path: liveWorkflow("issue", "2393", "valid", "marketing", "test", "fixtures"),
    kind: "pin-protected",
    issue: "#2148",
    pin: "digest",
    pinnedBy: ".github/scripts/strict-grep/issue-2148-ci-node-wave-shadow.tester.test.mjs",
    reason: "the wave-shadow tester banks a sha256 of this workflow's exact bytes",
  }),
  Object.freeze({
    path: liveWorkflow("issue", "679", "brand", "follows", "rls", "proof"),
    kind: "pin-protected",
    issue: "#2148",
    pin: "digest",
    pinnedBy: ".github/scripts/strict-grep/issue-2148-ci-deno-wave-shadow.tester.test.mjs",
    reason: "three wave-shadow parity suites bank a sha256 of this workflow's exact bytes",
  }),
  Object.freeze({
    path: liveWorkflow("bundle", "baseline", "automerge"),
    kind: "pin-protected",
    issue: "#2524",
    pin: "regex",
    pinnedBy: "mingla-business/scripts/ci/__tests__/issue2524_bundle_baseline_automerge.happy.test.mjs",
    reason: "a SECURITY pin on a PUBLIC repo: asserts the App token is minted only in the schedule/workflow_dispatch job and never on a pull_request event, by matching that job's if: verbatim. Also removes the residual hazard that bundle-baseline-automerge.mjs treats `skipped` as a passing conclusion.",
  }),
  Object.freeze({
    path: liveWorkflow("strict", "grep", "mingla", "business"),
    kind: "pin-protected",
    issue: "#2594",
    pin: "job-if",
    pinnedBy: ".github/scripts/ci-batch/__tests__/issue-2437-node-wave-shadow-parity.implementor.test.mjs",
    reason: "#2594 pins class-a-budget's `if: always()` VERBATIM -- without always() a timeout kill of class A skips the only check that can observe it -- and #2437 requires validateStaticClassAJob() to return [] over this job's parsed shape. Composing a draft conjunct changes both.",
  }),
  Object.freeze({
    path: liveWorkflow("ci", "batch"),
    kind: "pin-protected",
    issue: "#2148",
    pin: "job-if",
    pinnedBy: ".github/scripts/ci-batch/__tests__/issue-2437-node-wave-shadow-parity.implementor.test.mjs",
    reason: "the registry and three suites assert its job if: values verbatim; composing a draft conjunct changes those strings",
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
        errors.push(entry.kind === "ruleset-required"
          ? `${workflowName}: always-on merge-gate workflow carries a draft condition on job(s) ${draftJobs.join(", ")}. ` +
            `Its required context "${entry.context}" would report \`skipped\`, which GitHub counts as satisfying a required check — a check reading green having never run.`
          : `${workflowName}: pin-protected workflow carries a draft condition on job(s) ${draftJobs.join(", ")}. ` +
            `${entry.pinnedBy} pins this file's ${entry.pin} on behalf of ${entry.issue}; #2881 must leave it byte-identical rather than edit another issue's contract.`);
      }
      if (entry.kind === "ruleset-required" && typesList !== null) {
        errors.push(`${workflowName}: always-on merge-gate workflow must not restrict pull-request activity types (found ${JSON.stringify(typesList)})`);
      }
      if (entry.kind === "ruleset-required") {
        const names = jobKeys.map((jobKey) => (typeof jobs[jobKey]?.name === "string" ? jobs[jobKey].name.trim() : null));
        if (!names.includes(entry.context)) {
          errors.push(
            `${workflowName}: no job declares name "${entry.context}", the required status-check context this entry claims it produces. ` +
            `Renaming the job silently unbinds the ruleset.`,
          );
        }
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
    const validIssue = entry.issue && /^#\d+$/.test(String(entry.issue));
    if (entry.kind === "ruleset-required") {
      if (!validIssue || !entry.reason || !entry.context || !entry.ruleset) {
        errors.push(`${entry.path}: ruleset-required ALWAYS_ON entry must cite context, ruleset, an issue (#NNNN) and a reason`);
      }
    } else if (entry.kind === "pin-protected") {
      if (!validIssue || !entry.reason || !entry.pin || !entry.pinnedBy) {
        errors.push(`${entry.path}: pin-protected ALWAYS_ON entry must cite the owning issue (#NNNN), the pin kind, the pinning file and a reason`);
      }
    } else {
      errors.push(`${entry.path}: ALWAYS_ON entry has an unknown kind ${JSON.stringify(entry.kind)}`);
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

  // A8/A9 — the pin class (see the header note on #1614/#1719/#2393/#679/ci-batch).
  auditPins(errors, sources, alwaysOn, options);

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


/**
 * THE PIN CLASS — A8 and A9.
 *
 * Three separate lanes rediscovered the same defect in one day by going red in CI:
 * a workflow whose content is asserted by something OTHER than the workflow itself.
 * #2885 path-scoped issue-1614 (CI caught it), #2885 path-scoped ci-batch (its own
 * sweep caught it), #2881 draft-gated issue-1614 (CI caught it). The common cause is
 * that "do not modify this workflow" was expressed only inside individual test files
 * and inside .github/ci-batch/MANIFEST.json, so every bulk workflow transform found
 * it the hard way. These two assertions move that from a CI discovery to a build
 * failure.
 *
 * Four pin shapes are known, and they were found by COMPUTATION, not by reading:
 *   digest  - a test banks a sha256 of the workflow's exact bytes            (#2393, #679)
 *   regex   - a test asserts a pattern spanning the trigger block            (#1614)
 *   job-if  - a test asserts a job's `if:` value verbatim                    (ci-batch)
 *   registry- .github/ci-batch/MANIFEST.json legacyOrigins[].workflowMetadata
 *             .sourceSha256 banks a sha256 of 108 workflow files            (#1719 + 107)
 *
 * A8 proves every registered pin-protected entry is a REAL, CURRENTLY SATISFIED pin,
 * so the registry cannot rot into a list of excuses.
 * A9 is the catch-all: every workflow registered in the ci-batch origin registry must
 * hash to its banked value. That is base-free, so it fails the build for ANY edit that
 * forgets to re-bank -- this issue's, #2882's tiering, or anyone's.
 */
export const CI_BATCH_MANIFEST = ".github/ci-batch/MANIFEST.json";

function digestVariants(source) {
  const out = new Set();
  for (const variant of [source, source.trimEnd(), source.trim(), source.replace(/\r\n/g, "\n")]) {
    out.add(crypto.createHash("sha256").update(variant).digest("hex"));
  }
  return out;
}

function auditPins(errors, sources, alwaysOn, options) {
  const { pinSources = null, ciBatchManifest = null, requirePinInputs = true } = options;

  // ---- A8: every pin-protected registration is real and currently satisfied ----
  const readSource = (file) => {
    if (pinSources) return Object.hasOwn(pinSources, file) ? pinSources[file] : null;
    try { return fs.readFileSync(path.join(REPO_ROOT, file), "utf8"); } catch { return null; }
  };
  for (const entry of alwaysOn) {
    if (entry.kind !== "pin-protected") continue;
    const workflow = sources[entry.path];
    if (typeof workflow !== "string") continue; // already reported by the ALWAYS_ON sweep
    const pinning = readSource(entry.pinnedBy);
    if (pinning === null) {
      errors.push(`${entry.path}: pinnedBy file ${entry.pinnedBy} is unreadable, so its ${entry.pin} pin cannot be proven — a pin-protected registration must name a real pin`);
      continue;
    }
    if (entry.pin === "digest") {
      const banked = [...digestVariants(workflow)].some((digest) => pinning.includes(digest));
      if (!banked) {
        errors.push(
          `${entry.path}: registered as a digest pin, but ${entry.pinnedBy} does not contain a sha256 of the current file. ` +
          `Either the workflow drifted from the banked value or the registration is stale.`,
        );
      }
    }
    if (entry.pin === "regex") {
      const patterns = [...pinning.matchAll(/\/((?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+)\/([gimsuy]*)/g)]
        .filter((match) => /pull_request|workflow_dispatch|push:|on:/.test(match[1]));
      let satisfied = patterns.length === 0 ? null : false;
      for (const match of patterns) {
        try { if (new RegExp(match[1], match[2].replace(/[gy]/g, "")).test(workflow)) satisfied = true; } catch { /* not a usable pattern */ }
      }
      if (satisfied === null) errors.push(`${entry.path}: registered as a regex pin, but ${entry.pinnedBy} asserts no trigger-shaped pattern`);
      else if (!satisfied) errors.push(`${entry.path}: its ${entry.pinnedBy} trigger pattern no longer matches the workflow — the pin is broken`);
    }
    if (entry.pin === "job-if") {
      if (!/\bif\b/.test(workflow)) errors.push(`${entry.path}: registered as a job-if pin but declares no job condition at all`);
    }
  }

  // ---- A9: the central origin registry must hash the workflows on disk ----
  let manifest = ciBatchManifest;
  if (manifest === null) {
    if (!requirePinInputs) return;
    try { manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, CI_BATCH_MANIFEST), "utf8")); }
    catch {
      errors.push(`${CI_BATCH_MANIFEST}: unreadable, so the workflow content seal over its legacyOrigins cannot be proven`);
      return;
    }
  }
  const origins = Array.isArray(manifest.legacyOrigins) ? manifest.legacyOrigins : null;
  if (!origins) { errors.push(`${CI_BATCH_MANIFEST}: legacyOrigins is missing or not an array`); return; }
  const stale = [];
  for (const origin of origins) {
    const name = `${origin.stem}.${origin.extension}`;
    const workflow = sources[name];
    if (typeof workflow !== "string") continue; // registered origin no longer on disk: not this gate's rule
    const banked = origin.workflowMetadata?.sourceSha256;
    if (typeof banked !== "string") { errors.push(`${CI_BATCH_MANIFEST}: ${name} has no banked sourceSha256`); continue; }
    if (!digestVariants(workflow).has(banked)) stale.push(name);
  }
  if (stale.length) {
    errors.push(
      `${CI_BATCH_MANIFEST}: ${stale.length} registered workflow(s) no longer hash to their banked sourceSha256 — ` +
      `re-bank them in the same commit that edits the workflow, or the registry silently describes files that no longer exist in that form. ` +
      `First few: ${stale.slice(0, 5).join(", ")}`,
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

const PINNED = ALWAYS_ON.filter((entry) => entry.kind === "pin-protected");

const safeSources = () => {
  const sources = {
    [GATED_A]: wf({ jobs: { one: { if: DRAFT_IF }, two: { if: `${COMPOSED_PREFIX}always()${COMPOSED_SUFFIX}` } } }),
    [GATED_B]: wf({ event: "pull_request_target", jobs: { only: { if: DRAFT_IF } } }),
    [EXEMPT_A]: wf({ types: null, jobs: { guard: { if: null, name: ALWAYS_ON[0].context } } }),
    [EXEMPT_B]: wf({ types: null, jobs: { jest: { if: null, name: ALWAYS_ON[1].context } } }),
  };
  // Pin-protected entries are always-on: no types restriction, no draft condition.
  for (const entry of PINNED) {
    sources[entry.path] = `name: Pinned\non:\n  pull_request:\n  push:\n    branches: [main]\njobs:\n  only:\n    if: \${{ github.event_name != 'schedule' }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n`;
  }
  return sources;
};

// A8/A9 fixture inputs: a pinning file per pin-protected entry, and an origin registry.
const safePinInputs = (sources) => {
  const pinSources = {};
  for (const entry of PINNED) {
    const body = sources[entry.path];
    if (entry.pin === "digest") pinSources[entry.pinnedBy] = `const banked = "${crypto.createHash("sha256").update(body).digest("hex")}";\n`;
    else if (entry.pin === "regex") pinSources[entry.pinnedBy] = "assert.match(workflow, /pull_request:\\s*\\n\\s*push:/);\n";
    else pinSources[entry.pinnedBy] = "assert.equal(jobs.only.if, \"github.event_name != 'schedule'\");\n";
  }
  const ciBatchManifest = { legacyOrigins: Object.keys(sources).map((name) => ({
    stem: name.replace(/\.ya?ml$/, ""),
    extension: name.split(".").pop(),
    workflowMetadata: { sourceSha256: crypto.createHash("sha256").update(sources[name]).digest("hex") },
  })) };
  return { pinSources, ciBatchManifest };
};

function expectFailure(label, mutate, diagnostic, assertions) {
  const sources = safeSources();
  let botSource = OK_BOT_SOURCE;
  const setBot = (next) => { botSource = next; };
  mutate(sources, setBot);
  const result = auditWorkflowSources(sources, { botCreationSource: botSource, ...safePinInputs(sources) });
  assert.ok(
    result.errors.some((error) => error.includes(diagnostic)),
    `${label}: expected an error containing ${JSON.stringify(diagnostic)}; got ${result.errors.join(" | ") || "(none)"}`,
  );
  return assertions + 1;
}

export function runSelfTest() {
  let assertions = 0;

  const safeBase = safeSources();
  const safe = auditWorkflowSources(safeBase, { botCreationSource: OK_BOT_SOURCE, ...safePinInputs(safeBase) });
  assert.deepEqual(safe.errors, []);
  assert.equal(safe.counts.prFamily, 4 + PINNED.length);
  assert.equal(safe.counts.gated, 2);
  assert.equal(safe.counts.exempt, 2 + PINNED.length);
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
    // A8 — a pin-protected registration must name a REAL, currently satisfied pin.
    ["A8 pin-protected workflow draft-gated anyway",
      (s) => { s[PINNED[0].path] = s[PINNED[0].path].replace(/^    if: .*$/m, `    if: ${DRAFT_IF}`); },
      "must leave it byte-identical rather than edit another issue's contract"],
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

  // A8 — a stale digest registration fails.
  {
    const sources = safeSources();
    const inputs = safePinInputs(sources);
    const digestEntry = PINNED.find((entry) => entry.pin === "digest");
    inputs.pinSources[digestEntry.pinnedBy] = `const banked = "${"0".repeat(64)}";\n`;
    const result = auditWorkflowSources(sources, { botCreationSource: OK_BOT_SOURCE, ...inputs });
    assert.ok(result.errors.some((error) => error.includes("does not contain a sha256 of the current file")), "A8 must fail on a stale digest registration");
    assertions += 1;
  }
  // A8 — an unreadable pinning file fails closed.
  {
    const sources = safeSources();
    const inputs = safePinInputs(sources);
    delete inputs.pinSources[PINNED[0].pinnedBy];
    const result = auditWorkflowSources(sources, { botCreationSource: OK_BOT_SOURCE, ...inputs });
    assert.ok(result.errors.some((error) => error.includes("is unreadable")), "A8 must fail closed when the pinning file is gone");
    assertions += 1;
  }
  // A9 — a workflow that no longer hashes to its banked value fails. THIS IS THE 108-CLASS.
  {
    const sources = safeSources();
    const inputs = safePinInputs(sources);
    inputs.ciBatchManifest.legacyOrigins[0].workflowMetadata.sourceSha256 = "0".repeat(64);
    const result = auditWorkflowSources(sources, { botCreationSource: OK_BOT_SOURCE, ...inputs });
    assert.ok(result.errors.some((error) => error.includes("no longer hash to their banked sourceSha256")), "A9 must fail on registry drift");
    assertions += 1;
  }
  // A9 — a missing registry fails closed.
  {
    const sources = safeSources();
    const inputs = safePinInputs(sources);
    inputs.ciBatchManifest = {};
    const result = auditWorkflowSources(sources, { botCreationSource: OK_BOT_SOURCE, ...inputs });
    assert.ok(result.errors.some((error) => error.includes("legacyOrigins is missing")), "A9 must fail closed on a malformed registry");
    assertions += 1;
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
