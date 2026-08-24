#!/usr/bin/env node
/**
 * Guarded auto-merge for the machine-authored baseline recording PR (issue #2524).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * `orch-1083-initial-bundle-budget.mjs` charges a pull request for
 * `measured - baseline`, and enforces PR_DELTA_ALLOWANCE against that number.
 * That is only a PER-PR allowance if bundle-baseline.json tracks main. It does
 * not track main on its own: the post-merge ratchet (#1509) only ever LOWERS the
 * baseline, to bank savings, and growth is recorded by a pull request that
 * nobody merged. Eight were opened and abandoned on 2026-08-23 alone, each
 * superseding the last. The baseline therefore goes stale by construction and
 * the bill lands on whoever opens the next PR — #2479 was charged 9,660 B it did
 * not write, and #2515 3,718 B, on consecutive days.
 *
 * This closes that by merging the recording PR promptly. It does NOT make growth
 * quieter: the recording still lands as its own commit on main, with the delta
 * printed in the merge message, which is the whole point of #1509. What changes
 * is only that a MEASURED number arrives on time instead of waiting for a human
 * to remember.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT MAY MERGE — five locks, every one fail-closed
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. AUTHOR      Only a PR authored by the `mingla-bundle-baseline` App, on a
 *                  `bundle-baseline/main-<sha>` ref in THIS repository, whose
 *                  single commit is authored AND committed by that same App.
 *                  Delegated wholesale to #2058's `verifyPullRequest`, which is
 *                  already the trusted provenance verifier for these PRs.
 *   2. ONE FILE    Exactly one changed file, and that file is the baseline. A
 *                  recording PR that somehow carries a second file is left for a
 *                  human — no exception, no allowlist.
 *   3. ALL GREEN   Every check has COMPLETED and none failed. PENDING IS NOT
 *                  GREEN, and neither is an EMPTY listing: a rate-limited, raced
 *                  or truncated response reports zero checks, and reading zero
 *                  as "nothing failing" is the unfalsifiable-gate class that has
 *                  already cost this repo real coverage (#2113, and the jest
 *                  bracketed-glob trap). Zero checks, a truncated listing, a
 *                  malformed payload and a still-running check all resolve to
 *                  NOT SETTLED, which refuses.
 *   4. CEILING     Never merge a recording that leaves less than one full
 *                  PR_DELTA_ALLOWANCE of runway beneath a product ceiling. See
 *                  REFUSAL MARGIN below.
 *   5. LOUD        The merge is a squash commit whose message names this
 *                  automation, the source SHA and the exact recorded movement,
 *                  and the same facts go to the job summary. Every refusal
 *                  prints its reason. Nothing here is silent, and nothing here
 *                  can move a limit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REFUSAL MARGIN — one full per-PR allowance of runway
 * ─────────────────────────────────────────────────────────────────────────────
 * A PERCENTAGE margin is the wrong instrument here: the payload already sits at
 * 85–92% of its ceilings by design (2026-08-24: common brotli 452,820 of
 * 500,000 = 90.6%), so any round percentage either refuses everything or means
 * nothing. The honest question is not "how full is it" but "after recording
 * this, can the next ordinary pull request still land?"
 *
 * So the margin is one PR_DELTA_ALLOWANCE, in the same units the allowance is
 * written in:
 *
 *     refuse when   measurement  >  ceiling - allowance
 *
 *   __common raw     > 2,588,000 B   (2,600,000 - 12,000)
 *   __common brotli  >   488,000 B   (  500,000 - 12,000)
 *   eager raw        > 3,975,000 B   (4,000,000 - 25,000)
 *   eager brotli     >   725,000 B   (  750,000 - 25,000)
 *
 * and refuse outright at or above the ceiling itself. That fires roughly one
 * ordinary PR before the gate would begin hard-failing every branch — which is
 * exactly the moment the number stops being bookkeeping and starts being a
 * product fact about the app. At that point a human should see it, so the
 * automation stands down and leaves the PR open.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DELIBERATELY DOES NOT DO
 * ─────────────────────────────────────────────────────────────────────────────
 *   - It does not approve. #2058 forbade the review/approval endpoints and that
 *     stands: an automation that approves its own artifact has no independent
 *     verifier left. If main's ruleset requires a human review, this refuses
 *     with `blocked` and says so rather than routing around it.
 *   - It does not touch HARD_CEILING, PR_DELTA_ALLOWANCE, or the budget maths.
 *     The two constants below are a READ-ONLY MIRROR, and
 *     `assertCeilingMirrorMatchesBudgetSource` re-derives them from
 *     orch-1083-initial-bundle-budget.mjs so the mirror cannot rot in silence.
 *   - It does not hand-edit bundle-baseline.json, ever. It only merges a file a
 *     linux CI export measured.
 *   - It does not force, retry past a refusal, or adopt a PR it did not verify.
 *
 * Usage:
 *   node scripts/ci/bundle-baseline-automerge.mjs --automerge
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  BASELINE_PATH,
  BRANCH_RE,
  HandoffError,
  makeRestAdapter,
  verifyPullRequest,
} from "./bundle-baseline-pr-handoff.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUDGET_SOURCE = join(HERE, "orch-1083-initial-bundle-budget.mjs");
const apiVersion = "2022-11-28";

/**
 * READ-ONLY MIRROR of HARD_CEILING in orch-1083-initial-bundle-budget.mjs.
 * #2524 is explicitly forbidden from changing the ceilings; this copy exists
 * only so the merge decision can read them, and the drift assertion below
 * proves the copy is still true.
 */
export const CEILING = Object.freeze({
  common: Object.freeze({ raw: 2_600_000, brotli: 500_000 }),
  eager: Object.freeze({ raw: 4_000_000, brotli: 750_000 }),
});

/**
 * READ-ONLY MIRROR of PR_DELTA_ALLOWANCE, used here as the RUNWAY the
 * automation insists on leaving beneath every ceiling. See REFUSAL MARGIN.
 */
export const REFUSAL_RUNWAY = Object.freeze({ common: 12_000, eager: 25_000 });

export const SCOPES = Object.freeze(["common", "eager"]);
export const METRICS = Object.freeze(["raw", "brotli"]);

/** Completed conclusions that are not a failure. Anything else refuses. */
export const PASSING_CONCLUSIONS = Object.freeze(new Set(["success", "neutral", "skipped"]));

export class AutomergeError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "AutomergeError";
    this.code = code;
    this.details = details;
  }
}

function refuse(reason, detail) {
  return { settled: false, ok: false, reason, detail };
}

/**
 * Re-derive the two mirrored constants from the budget script's own source and
 * prove they still equal the copies above. Nothing here parses at runtime in
 * the merge path for correctness — it runs so that a future edit to the real
 * ceilings cannot leave this automation quietly merging against stale numbers.
 */
export function assertCeilingMirrorMatchesBudgetSource(source = readFileSync(BUDGET_SOURCE, "utf8")) {
  const readNumber = (block, key) => {
    const match = new RegExp(`${key}:\\s*([0-9_]+)`).exec(block);
    if (!match) {
      throw new AutomergeError("MIRROR_UNREADABLE", `Could not read ${key} from the budget source.`);
    }
    return Number(match[1].replace(/_/g, ""));
  };
  const ceilingBlock = /const HARD_CEILING = \{([\s\S]*?)\n\};/.exec(source);
  if (!ceilingBlock) throw new AutomergeError("MIRROR_UNREADABLE", "HARD_CEILING is not present in the budget source.");
  const commonLine = /common:\s*\{([^}]*)\}/.exec(ceilingBlock[1]);
  const eagerLine = /eager:\s*\{([^}]*)\}/.exec(ceilingBlock[1]);
  if (!commonLine || !eagerLine) throw new AutomergeError("MIRROR_UNREADABLE", "HARD_CEILING scopes are not readable.");
  const derivedCeiling = {
    common: { raw: readNumber(commonLine[1], "raw"), brotli: readNumber(commonLine[1], "brotli") },
    eager: { raw: readNumber(eagerLine[1], "raw"), brotli: readNumber(eagerLine[1], "brotli") },
  };

  const allowanceLine = /const PR_DELTA_ALLOWANCE = \{([^}]*)\}/.exec(source);
  if (!allowanceLine) throw new AutomergeError("MIRROR_UNREADABLE", "PR_DELTA_ALLOWANCE is not present in the budget source.");
  const derivedRunway = {
    common: readNumber(allowanceLine[1], "common"),
    eager: readNumber(allowanceLine[1], "eager"),
  };

  for (const scope of SCOPES) {
    for (const metric of METRICS) {
      if (derivedCeiling[scope][metric] !== CEILING[scope][metric]) {
        throw new AutomergeError(
          "MIRROR_DRIFTED",
          `HARD_CEILING.${scope}.${metric} is ${derivedCeiling[scope][metric]} in the budget source but ${CEILING[scope][metric]} in the auto-merge mirror.`,
        );
      }
    }
    if (derivedRunway[scope] !== REFUSAL_RUNWAY[scope]) {
      throw new AutomergeError(
        "MIRROR_DRIFTED",
        `PR_DELTA_ALLOWANCE.${scope} is ${derivedRunway[scope]} in the budget source but ${REFUSAL_RUNWAY[scope]} in the auto-merge mirror.`,
      );
    }
  }
  return { ceiling: derivedCeiling, runway: derivedRunway };
}

/**
 * GUARD 3 — all-green.
 *
 * Every refusal path here is deliberate. The only input that returns `settled`
 * is a complete, self-consistent listing in which every entry finished and none
 * failed. In particular an EMPTY listing does not mean "nothing is failing"; it
 * means the answer was not obtained, and the answer not being obtained is a
 * refusal.
 */
export function assessChecks(checkRunsPayload, combinedStatus) {
  if (checkRunsPayload === null || typeof checkRunsPayload !== "object") {
    return refuse("CHECKS_UNREADABLE", "The check-runs listing was not an object.");
  }
  const runs = checkRunsPayload.check_runs;
  const runTotal = checkRunsPayload.total_count;
  if (!Array.isArray(runs)) {
    return refuse("CHECKS_UNREADABLE", "The check-runs listing did not contain an array.");
  }
  if (!Number.isSafeInteger(runTotal) || runTotal < 0) {
    return refuse("CHECKS_UNREADABLE", "The check-runs listing did not report a usable total_count.");
  }
  // A short page is a TRUNCATED answer, not a smaller one.
  if (runs.length !== runTotal) {
    return refuse(
      "CHECKS_TRUNCATED",
      `The check-runs listing reported ${runTotal} checks but returned ${runs.length}; a partial listing is not a green listing.`,
    );
  }

  if (combinedStatus === null || typeof combinedStatus !== "object") {
    return refuse("CHECKS_UNREADABLE", "The combined-status listing was not an object.");
  }
  const statuses = combinedStatus.statuses;
  const statusTotal = combinedStatus.total_count;
  if (!Array.isArray(statuses)) {
    return refuse("CHECKS_UNREADABLE", "The combined-status listing did not contain an array.");
  }
  if (!Number.isSafeInteger(statusTotal) || statusTotal < 0) {
    return refuse("CHECKS_UNREADABLE", "The combined-status listing did not report a usable total_count.");
  }
  if (statuses.length !== statusTotal) {
    return refuse(
      "CHECKS_TRUNCATED",
      `The combined-status listing reported ${statusTotal} statuses but returned ${statuses.length}.`,
    );
  }

  // THE EMPTY-LISTING TRAP. Rate limiting, a race against check creation, and a
  // dropped response all look exactly like this, and every one of them means
  // "not settled" — never "nothing failing".
  if (runTotal === 0 && statusTotal === 0) {
    return refuse(
      "CHECKS_NOT_REPORTED",
      "No check runs and no commit statuses were reported for this head. An empty listing is not a green listing.",
    );
  }

  const pending = runs.filter((run) => run?.status !== "completed");
  if (pending.length > 0) {
    return refuse(
      "CHECKS_PENDING",
      `${pending.length} check(s) have not completed: ${pending.map((run) => `${run?.name ?? "<unnamed>"}=${run?.status ?? "<no status>"}`).join(", ")}.`,
    );
  }
  const failed = runs.filter((run) => !PASSING_CONCLUSIONS.has(run?.conclusion));
  if (failed.length > 0) {
    return refuse(
      "CHECKS_FAILED",
      `${failed.length} check(s) did not pass: ${failed.map((run) => `${run?.name ?? "<unnamed>"}=${run?.conclusion ?? "<no conclusion>"}`).join(", ")}.`,
    );
  }

  if (statusTotal > 0) {
    if (combinedStatus.state === "pending") {
      return refuse("CHECKS_PENDING", "The combined commit status is still pending.");
    }
    if (combinedStatus.state !== "success") {
      return refuse("CHECKS_FAILED", `The combined commit status is ${combinedStatus.state ?? "<none>"}.`);
    }
  }

  return {
    settled: true,
    ok: true,
    reason: "CHECKS_GREEN",
    detail: `${runTotal} check run(s) and ${statusTotal} commit status(es) completed, all passing.`,
    checkCount: runTotal,
    statusCount: statusTotal,
  };
}

/**
 * GUARD 4 — ceiling runway. Refuses on a breach, on a recording that leaves
 * less than one per-PR allowance of runway, and on any measurement that is not
 * a usable positive integer.
 */
export function assessCeilingRunway(baseline) {
  const breaches = [];
  for (const scope of SCOPES) {
    const measured = baseline?.[scope];
    for (const metric of METRICS) {
      const value = measured?.[metric];
      if (!Number.isSafeInteger(value) || value <= 0) {
        breaches.push({
          scope,
          metric,
          kind: "UNREADABLE",
          value,
          limit: null,
          message: `${scope}.${metric} is not a usable measurement (${JSON.stringify(value)}).`,
        });
        continue;
      }
      const ceiling = CEILING[scope][metric];
      const limit = ceiling - REFUSAL_RUNWAY[scope];
      if (value >= ceiling) {
        breaches.push({
          scope,
          metric,
          kind: "OVER_CEILING",
          value,
          limit: ceiling,
          message: `${scope}.${metric} is ${value} B, at or above the product ceiling of ${ceiling} B.`,
        });
      } else if (value > limit) {
        breaches.push({
          scope,
          metric,
          kind: "NO_RUNWAY",
          value,
          limit,
          message: `${scope}.${metric} is ${value} B, leaving less than one ${REFUSAL_RUNWAY[scope]} B per-PR allowance beneath the ${ceiling} B ceiling (refusal threshold ${limit} B).`,
        });
      }
    }
  }
  return { ok: breaches.length === 0, breaches };
}

function decodeBaselineContent(response) {
  if (response?.encoding !== "base64" || typeof response?.content !== "string") {
    throw new AutomergeError("BASELINE_UNREADABLE", `GitHub did not return base64 content for ${BASELINE_PATH}.`);
  }
  return Buffer.from(response.content, "base64").toString("utf8");
}

function parseBaseline(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new AutomergeError("BASELINE_UNREADABLE", `The ${label} baseline is not valid JSON.`);
  }
}

function signed(value) {
  return `${value > 0 ? "+" : value < 0 ? "-" : "±"}${Math.abs(value).toLocaleString("en-US")}`;
}

/** GUARD 5 — the recorded movement, in the form that lands in the merge commit. */
export function describeMovement(previous, next) {
  const lines = [];
  for (const scope of SCOPES) {
    for (const metric of METRICS) {
      const before = previous?.[scope]?.[metric];
      const after = next?.[scope]?.[metric];
      if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after)) {
        lines.push(`${scope} ${metric}: ${JSON.stringify(before)} -> ${JSON.stringify(after)} (unreadable)`);
        continue;
      }
      lines.push(`${scope} ${metric}: ${before.toLocaleString("en-US")} B -> ${after.toLocaleString("en-US")} B (${signed(after - before)} B)`);
    }
  }
  return lines;
}

export function makeAutomergeApi({ token, owner, repo, fetchImpl = fetch }) {
  const base = makeRestAdapter({ token, owner, repo, fetchImpl });
  const root = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const request = async (method, path, body = undefined) => {
    const response = await fetchImpl(`${root}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": apiVersion,
        "User-Agent": "mingla-bundle-baseline-automerge",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { message: "GitHub returned a non-JSON response." };
    }
    if (!response.ok) {
      // Never leak the token into a diagnostic; #2058 established this posture.
      throw new AutomergeError("REST_FAILURE", `${method} ${root}${path}: ${payload?.message ?? response.status}`, {
        status: response.status,
      });
    }
    return payload;
  };
  return {
    ...base,
    // `filter=latest` is the default and is what we want: a re-run supersedes an
    // earlier failure of the same check name.
    listCheckRuns: async (sha) => request("GET", `/commits/${sha}/check-runs?per_page=100`),
    getCombinedStatus: async (sha) => request("GET", `/commits/${sha}/status?per_page=100`),
    mergePull: async ({ number, headSha, title, message }) =>
      request("PUT", `/pulls/${number}/merge`, {
        sha: headSha,
        merge_method: "squash",
        commit_title: title,
        commit_message: message,
      }),
  };
}

/**
 * GUARDS 1 + 2, selection half: only an open PR from THIS repository on the
 * reserved ref grammar, whose source SHA is the live main, is even a candidate.
 * `verifyPullRequest` then proves authorship and single-file-ness properly.
 */
export async function selectCandidate(api, { liveMain }) {
  const open = await api.listPulls("open");
  if (!Array.isArray(open)) {
    throw new AutomergeError("REST_FAILURE", "The open pull request listing was not an array.");
  }
  const managed = open.filter((pull) =>
    pull?.head?.repo?.full_name === api.fullName && BRANCH_RE.test(pull?.head?.ref ?? ""));
  const current = managed.filter((pull) => BRANCH_RE.exec(pull.head.ref)[1] === liveMain);
  if (current.length > 1) {
    throw new AutomergeError(
      "COLLISION",
      `More than one open recording PR claims the live main ${liveMain}: ${current.map((pull) => `#${pull.number}`).join(", ")}.`,
    );
  }
  return { candidate: current[0] ?? null, managedCount: managed.length, staleCount: managed.length - current.length };
}

export async function runAutomerge(api, { expectedAppSlug }) {
  assertCeilingMirrorMatchesBudgetSource();

  const liveMain = await api.getMainSha();
  const { candidate, managedCount, staleCount } = await selectCandidate(api, { liveMain });
  const log = { liveMain, managedCount, staleCount, pullNumber: candidate?.number ?? null, movement: [] };

  if (!candidate) {
    return {
      ...log,
      state: "NO_CANDIDATE",
      reason: managedCount === 0
        ? "No open recording PR exists."
        : `${managedCount} open recording PR(s) exist but none records the live main ${liveMain}; the ratchet supersedes those itself.`,
    };
  }

  // GUARDS 1 + 2: authorship, ref grammar, sole-App commit identity, exactly one
  // changed file and that file the baseline, base is the live main. This is
  // #2058's own verifier — the same code path the provenance guard already runs
  // on every one of these PRs — so the automation cannot be looser than it.
  let provenance;
  try {
    provenance = await verifyPullRequest(api, { pullNumber: candidate.number, expectedAppSlug });
  } catch (error) {
    if (error instanceof HandoffError) {
      return { ...log, state: "REFUSED", reason: `PROVENANCE_${error.code}`, detail: error.message };
    }
    throw error;
  }
  if (provenance.state !== "VALID_GENERATED_PR") {
    return { ...log, state: "REFUSED", reason: "PROVENANCE_NOT_GENERATED", detail: `Provenance verifier returned ${provenance.state}.` };
  }

  const pull = await api.getPull(candidate.number);
  const headSha = provenance.headSha;
  if (pull?.head?.sha !== headSha) {
    return { ...log, state: "REFUSED", reason: "HEAD_MOVED", detail: "The head moved between provenance verification and the merge decision." };
  }

  // GUARD 3.
  const [checkRuns, combinedStatus] = await Promise.all([
    api.listCheckRuns(headSha),
    api.getCombinedStatus(headSha),
  ]);
  const checks = assessChecks(checkRuns, combinedStatus);
  if (!checks.ok) {
    return { ...log, state: "REFUSED", reason: checks.reason, detail: checks.detail };
  }

  // GitHub computes mergeability asynchronously; `null` means NOT YET KNOWN,
  // which is the same class of non-answer as an empty check listing.
  if (pull?.mergeable !== true) {
    return {
      ...log,
      state: "REFUSED",
      reason: pull?.mergeable === null || pull?.mergeable === undefined ? "MERGEABILITY_UNKNOWN" : "NOT_MERGEABLE",
      detail: `GitHub reports mergeable=${JSON.stringify(pull?.mergeable)}, mergeable_state=${JSON.stringify(pull?.mergeable_state)}.`,
    };
  }
  if (pull?.mergeable_state !== "clean") {
    // `blocked` with every check already green is almost always the repo's
    // required-review rule, which this App cannot satisfy and must not route
    // around. Name it, so a run that no-ops forever is diagnosable from one
    // line of the job summary instead of a ruleset audit.
    const blockedByReview = pull.mergeable_state === "blocked";
    return {
      ...log,
      state: "REFUSED",
      reason: "MERGE_BLOCKED",
      detail: blockedByReview
        ? `GitHub reports mergeable_state="blocked" with all ${checks.checkCount} check(s) green. `
          + `That is the required-review rule on main, which the ${expectedAppSlug} App cannot satisfy. `
          + `This automation never approves its own pull request (issue #2058 forbade the review endpoints, and an `
          + `automation that approves its own artifact has no independent verifier left), so it stands down. `
          + `OPERATOR PREREQUISITE: to let this merge, add the ${expectedAppSlug} App as a bypass actor on the `
          + `"general security" ruleset. Until then every run will refuse here.`
        : `GitHub reports mergeable_state=${JSON.stringify(pull.mergeable_state)}, so the pull request is not in a mergeable condition.`,
    };
  }

  // GUARD 4, read from the exact blob being merged.
  const nextBaseline = parseBaseline(decodeBaselineContent(await api.getContent(BASELINE_PATH, headSha)), "proposed");
  const runway = assessCeilingRunway(nextBaseline);
  if (!runway.ok) {
    return {
      ...log,
      state: "REFUSED",
      reason: "CEILING_RUNWAY",
      detail: runway.breaches.map((breach) => breach.message).join(" "),
      breaches: runway.breaches,
    };
  }

  const previousBaseline = parseBaseline(decodeBaselineContent(await api.getContent(BASELINE_PATH, liveMain)), "recorded");
  const movement = describeMovement(previousBaseline, nextBaseline);
  log.movement = movement;

  // Last read before the only shared write this file performs. #2058's rule.
  const stillLive = await api.getMainSha();
  if (stillLive !== liveMain) {
    return { ...log, state: "SUPERSEDED", reason: "MAIN_MOVED", detail: `main moved to ${stillLive} while the guards were being evaluated.` };
  }

  // GUARD 5: the trace rides on the merge commit itself, so it is permanent and
  // greppable in `git log` long after this job's summary has expired.
  const title = `${pull.title} (#${pull.number})`;
  const message = [
    `Auto-merged by scripts/ci/bundle-baseline-automerge.mjs (issue #2524).`,
    ``,
    `Measured main at ${provenance.sourceSha} and recorded the result into ${BASELINE_PATH}.`,
    `This moves only the MEASURED baseline. HARD_CEILING and PR_DELTA_ALLOWANCE are untouched.`,
    ``,
    `Recorded movement:`,
    ...movement.map((line) => `  ${line}`),
    ``,
    `Guards satisfied: author=${provenance.state}, files=1 (${BASELINE_PATH}), ${checks.detail}, ceiling runway clear.`,
  ].join("\n");

  const merged = await api.mergePull({ number: pull.number, headSha, title, message });
  if (merged?.merged !== true) {
    throw new AutomergeError("MERGE_REFUSED", `GitHub did not merge #${pull.number}: ${merged?.message ?? "no reason given"}.`);
  }

  return {
    ...log,
    state: "MERGED",
    reason: "GUARDS_SATISFIED",
    detail: checks.detail,
    sourceSha: provenance.sourceSha,
    headSha,
    mergeSha: merged.sha ?? null,
    prUrl: pull.html_url ?? null,
  };
}

export function renderSummary(result) {
  return [
    "## Bundle baseline auto-merge (#2524)",
    "",
    `- state: \`${result.state}\``,
    `- reason: \`${result.reason ?? "n/a"}\``,
    `- live main: \`${result.liveMain ?? "n/a"}\``,
    `- candidate PR: ${result.pullNumber ? `#${result.pullNumber}` : "none"}`,
    `- open recording PRs seen: ${result.managedCount ?? 0} (stale: ${result.staleCount ?? 0})`,
    `- merge commit: \`${result.mergeSha ?? "none"}\``,
    "",
    ...(result.movement?.length
      ? ["Recorded movement:", "", ...result.movement.map((line) => `- ${line}`), ""]
      : []),
    ...(result.detail ? [`> ${result.detail}`, ""] : []),
  ].join("\n");
}

async function main() {
  if (process.argv[2] !== "--automerge") {
    throw new AutomergeError("INVALID_INPUT", "Usage: bundle-baseline-automerge.mjs --automerge");
  }
  const owner = process.env.GITHUB_REPOSITORY_OWNER;
  const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
  const api = makeAutomergeApi({ token: process.env.BUNDLE_BASELINE_APP_TOKEN, owner, repo });
  const result = await runAutomerge(api, { expectedAppSlug: process.env.BUNDLE_BASELINE_APP_SLUG });

  const summary = renderSummary(result);
  console.log(summary);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) writeFileSync(summaryPath, `${summary}\n`, { flag: "a" });

  // A refusal is a NORMAL outcome and must not red a scheduled job — but it is
  // never silent: the reason is on stdout and in the job summary above.
  console.log(`bundle-baseline auto-merge: ${result.state} (${result.reason ?? "n/a"})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`bundle-baseline auto-merge FAILED: ${error?.code ?? "ERROR"}: ${error?.message ?? error}`);
    process.exit(1);
  });
}
