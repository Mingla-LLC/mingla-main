#!/usr/bin/env node
/**
 * Issue #3606 — the public Sites runtime resolver re-checks recovery evidence on
 * EVERY page request, and the freshness budget it enforces is refilled by ONE
 * scheduled job a day. On 2026-09-28 the live gogi site came within 47 minutes
 * of returning 404 on every route and NOTHING alerted, because the only alarm
 * in `sites-backup-restore.yml` fires when a run FAILS. A run that is hours late,
 * or that never starts at all, produces no failure — so it produces no signal.
 *
 * This watchdog closes that gap. It answers one question, on a cadence far
 * tighter than the job it watches:
 *
 *   "How much of the resolver's freshness budget is left before the public host
 *    disappears, and is anybody being told?"
 *
 * It measures the COMPLETION of the most recent successful `backup_restore` job
 * — the same moment the resolver's binding predicate now measures after the
 * companion migration — and refuses to report health it cannot prove. Every
 * refusal is audible: an unreadable API response, a malformed run, a missing
 * success and an expired budget all produce a distinct non-zero verdict rather
 * than a quiet pass. A watchdog that fails closed AND silently is only half a
 * watchdog; this one always says which verdict it reached and why.
 *
 * Deliberately production-credential-free: it reads the repository's own Actions
 * history with `GITHUB_TOKEN`, so it can run on a tight schedule without ever
 * touching the Sites CMS database, the private Blob store, or the signing keys.
 */

import { fileURLToPath } from "node:url";

import { fail, safeCliFailure } from "./lib/sites-ops.mjs";

/**
 * MUST equal the `interval` the runtime resolver
 * (`public.brand_site_resolve_publication`) enforces against the completion
 * stamped readiness fields. If that interval ever changes, this constant changes
 * in the same commit — a watchdog measuring a different budget than the gate it
 * guards is worse than none, because it reports comfort that does not exist.
 */
export const RECOVERY_BUDGET_HOURS = 26;

/**
 * Headroom at which lateness becomes reportable.
 *
 * Sized from measured scheduler behaviour, not from the nominal cron. Over the
 * ten runs before #3606 GitHub dispatched the nominal 07:23Z schedule between
 * 11:56Z and 13:06Z — 4.5 to 5.7 hours late, and drifting later. With the second
 * daily cron added by #3606 the gap between consecutive successful completions
 * is ~12 hours plus drift, so 8 hours of remaining headroom is never reached on
 * a day when the schedule merely runs late. It is reached when an entire
 * scheduled run was skipped, never dispatched, or failed — which is exactly the
 * condition that has no other alarm.
 */
export const WARN_HEADROOM_HOURS = 8;

/** The job inside `sites-backup-restore.yml` whose success refills the budget. */
export const BACKUP_JOB_NAME = "Private backup and isolated restore";

export const DEFAULT_WORKFLOW_FILE = "sites-backup-restore.yml";
export const DEFAULT_ALERT_ISSUE = "2830";

/** Bounded API reads. The watchdog runs hourly; it must stay cheap. */
export const MAX_RUNS_SCANNED = 20;

const HOUR_MS = 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

export const VERDICT_OK = "SITES_RECOVERY_FRESHNESS_OK";
export const VERDICT_LATE = "SITES_RECOVERY_FRESHNESS_LATE";
export const VERDICT_EXPIRED = "SITES_RECOVERY_FRESHNESS_EXPIRED";
export const VERDICT_NO_SUCCESS = "SITES_RECOVERY_NO_SUCCESS_IN_WINDOW";
export const VERDICT_UNPROVEN = "SITES_RECOVERY_FRESHNESS_UNPROVEN";

/** Verdicts that mean "the public site is at risk and somebody must be told". */
const ALERTING_VERDICTS = Object.freeze([
  VERDICT_LATE,
  VERDICT_EXPIRED,
  VERDICT_NO_SUCCESS,
  VERDICT_UNPROVEN,
]);

export function isAlertingVerdict(code) {
  return ALERTING_VERDICTS.includes(code);
}

function parseInstant(value) {
  if (typeof value !== "string" || !ISO_RE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Pure verdict. `lastSuccessAt` is the ISO completion instant of the newest
 * successful backup job, or `null` when no success was found in the scanned
 * window. Anything it cannot read becomes `UNPROVEN` — never `OK`.
 */
export function evaluateRecoveryFreshness({
  lastSuccessAt,
  now = new Date(),
  budgetHours = RECOVERY_BUDGET_HOURS,
  warnHeadroomHours = WARN_HEADROOM_HOURS,
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(budgetHours) || budgetHours <= 0 ||
    !Number.isFinite(warnHeadroomHours) || warnHeadroomHours < 0 ||
    warnHeadroomHours >= budgetHours
  ) {
    return {
      ok: false,
      code: VERDICT_UNPROVEN,
      reason: "INVALID_BUDGET",
      last_success_at: null,
      age_hours: null,
      headroom_hours: null,
      expires_at: null,
      budget_hours: budgetHours,
      warn_headroom_hours: warnHeadroomHours,
    };
  }

  const base = {
    budget_hours: budgetHours,
    warn_headroom_hours: warnHeadroomHours,
  };

  if (lastSuccessAt === null || lastSuccessAt === undefined) {
    return {
      ...base,
      ok: false,
      code: VERDICT_NO_SUCCESS,
      reason: "NO_SUCCESSFUL_BACKUP_IN_SCANNED_WINDOW",
      last_success_at: null,
      age_hours: null,
      headroom_hours: null,
      expires_at: null,
    };
  }

  const successMs = parseInstant(lastSuccessAt);
  if (successMs === null) {
    return {
      ...base,
      ok: false,
      code: VERDICT_UNPROVEN,
      reason: "LAST_SUCCESS_TIMESTAMP_UNREADABLE",
      last_success_at: null,
      age_hours: null,
      headroom_hours: null,
      expires_at: null,
    };
  }
  // A completion in the future is a clock or data fault, not freshness. Refuse
  // it rather than converting it into the maximum possible headroom.
  if (successMs > nowMs + CLOCK_SKEW_MS) {
    return {
      ...base,
      ok: false,
      code: VERDICT_UNPROVEN,
      reason: "LAST_SUCCESS_IN_THE_FUTURE",
      last_success_at: new Date(successMs).toISOString(),
      age_hours: null,
      headroom_hours: null,
      expires_at: null,
    };
  }

  const expiresMs = successMs + budgetHours * HOUR_MS;
  const ageHours = (nowMs - successMs) / HOUR_MS;
  const headroomHours = (expiresMs - nowMs) / HOUR_MS;

  let code = VERDICT_OK;
  if (headroomHours <= 0) code = VERDICT_EXPIRED;
  else if (headroomHours <= warnHeadroomHours) code = VERDICT_LATE;

  return {
    ...base,
    ok: code === VERDICT_OK,
    code,
    reason: code === VERDICT_OK ? "WITHIN_BUDGET" : "BUDGET_NEARLY_OR_FULLY_SPENT",
    last_success_at: new Date(successMs).toISOString(),
    age_hours: round(ageHours),
    headroom_hours: round(headroomHours),
    expires_at: new Date(expiresMs).toISOString(),
  };
}

/**
 * Newest successful completion of the backup job, from raw Actions payloads.
 *
 * The trap this exists to avoid: `sites-backup-restore.yml` now carries the
 * watchdog itself, so a run of that workflow can conclude `success` having taken
 * no backup at all. Asking "did the newest run succeed?" would therefore report
 * a fresh budget every single hour while the budget actually drained to zero.
 * Only a `success` conclusion on the named backup JOB counts.
 *
 * Returns `{ lastSuccessAt }` or `{ unproven: <reason> }`. Shapes it cannot read
 * are refused, never skipped — skipping silently is how a watchdog learns to
 * report health it never checked.
 */
export function selectLatestBackupCompletion(runs, jobsByRunId, {
  jobName = BACKUP_JOB_NAME,
} = {}) {
  if (!Array.isArray(runs)) return { unproven: "RUNS_RESPONSE_NOT_A_LIST" };
  for (const run of runs) {
    if (!run || typeof run !== "object" || Array.isArray(run)) {
      return { unproven: "RUN_ENTRY_NOT_AN_OBJECT" };
    }
    if (!Number.isSafeInteger(run.id)) return { unproven: "RUN_ID_INVALID" };
    if (typeof run.head_branch !== "string") {
      return { unproven: "RUN_HEAD_BRANCH_INVALID" };
    }
    if (run.head_branch !== "main") continue;

    const jobs = jobsByRunId instanceof Map
      ? jobsByRunId.get(run.id)
      : jobsByRunId?.[run.id];
    if (jobs === undefined) continue;
    if (!Array.isArray(jobs)) return { unproven: "JOBS_RESPONSE_NOT_A_LIST" };

    for (const job of jobs) {
      if (!job || typeof job !== "object" || Array.isArray(job)) {
        return { unproven: "JOB_ENTRY_NOT_AN_OBJECT" };
      }
      if (typeof job.name !== "string") return { unproven: "JOB_NAME_INVALID" };
      if (job.name !== jobName) continue;
      if (job.conclusion !== "success") continue;
      const completed = parseInstant(job.completed_at);
      if (completed === null) return { unproven: "JOB_COMPLETED_AT_UNREADABLE" };
      return { lastSuccessAt: new Date(completed).toISOString() };
    }
  }
  return { lastSuccessAt: null };
}

/** One line, stable shape, greppable in the Actions log and in issue comments. */
export function formatVerdictLine(verdict) {
  return [
    `SITES_RECOVERY_FRESHNESS code=${verdict.code}`,
    `last_success_at=${verdict.last_success_at ?? "none"}`,
    `age_hours=${verdict.age_hours ?? "unknown"}`,
    `headroom_hours=${verdict.headroom_hours ?? "unknown"}`,
    `budget_hours=${verdict.budget_hours}`,
    `reason=${verdict.reason}`,
  ].join(" ");
}

/**
 * Dedupe marker. Includes the verdict code AND the generation of evidence it was
 * reached against, so one late generation produces exactly one comment, and an
 * escalation from LATE to EXPIRED still produces its own.
 */
export function alertMarker(verdict) {
  return `SITES_RECOVERY_ALERT code=${verdict.code} last_success_at=${verdict.last_success_at ?? "none"}`;
}

export function alertBody(verdict, runUrl) {
  return [
    alertMarker(verdict),
    "",
    formatVerdictLine(verdict),
    "",
    verdict.code === VERDICT_EXPIRED
      ? "The public Sites runtime resolver no longer has recovery evidence inside its freshness budget. Every page on the pilot host is 404 until a successful backup run lands."
      : "The public Sites runtime resolver gates every page request on recovery evidence that is close to expiring. A successful backup run must land before the headroom above reaches zero, or the pilot host starts returning 404 on every route.",
    "",
    `Recover by dispatching the backup workflow: \`gh workflow run ${DEFAULT_WORKFLOW_FILE}\`. Its restore runs into an ephemeral PostgreSQL service container and does not touch production data. The run must SUCCEED — a failed run triggers signed pilot deactivation.`,
    "",
    `Watchdog run: ${runUrl}`,
  ].join("\n");
}

function apiHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "mingla-sites-recovery-freshness",
    "x-github-api-version": "2022-11-28",
  };
}

async function readJson(fetchImpl, url, token, code) {
  let response;
  try {
    response = await fetchImpl(url, { headers: apiHeaders(token) });
  } catch {
    fail(code);
  }
  if (!response?.ok) fail(code);
  try {
    return await response.json();
  } catch {
    fail(code);
  }
  return undefined;
}

/**
 * Reads bounded Actions history and returns the pure verdict.
 * Every network or shape failure lands on UNPROVEN, which alerts.
 */
export async function checkRecoveryFreshness({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  const apiUrl = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
  const repository = env.GITHUB_REPOSITORY;
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  const workflowFile = env.SITES_BACKUP_WORKFLOW_FILE || DEFAULT_WORKFLOW_FILE;
  if (typeof repository !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    fail("GITHUB_REPOSITORY_INVALID");
  }
  if (typeof token !== "string" || token.length < 8) fail("GITHUB_TOKEN_MISSING");

  const runsPayload = await readJson(
    fetchImpl,
    `${apiUrl}/repos/${repository}/actions/workflows/${encodeURIComponent(workflowFile)}` +
      `/runs?branch=main&per_page=${MAX_RUNS_SCANNED}&page=1`,
    token,
    "ACTIONS_RUNS_READ_FAILED",
  );
  const runs = Array.isArray(runsPayload?.workflow_runs)
    ? runsPayload.workflow_runs.slice(0, MAX_RUNS_SCANNED)
    : null;
  if (runs === null) {
    return evaluateRecoveryFreshnessUnproven("RUNS_RESPONSE_SHAPE_INVALID");
  }

  const jobsByRunId = new Map();
  for (const run of runs) {
    if (!run || !Number.isSafeInteger(run.id) || run.head_branch !== "main") continue;
    const payload = await readJson(
      fetchImpl,
      `${apiUrl}/repos/${repository}/actions/runs/${run.id}/jobs?per_page=50`,
      token,
      "ACTIONS_JOBS_READ_FAILED",
    );
    jobsByRunId.set(run.id, Array.isArray(payload?.jobs) ? payload.jobs : null);
    const partial = selectLatestBackupCompletion(runs, jobsByRunId);
    if (partial.unproven) return evaluateRecoveryFreshnessUnproven(partial.unproven);
    // Stop as soon as the newest success is known; older runs cannot beat it.
    if (partial.lastSuccessAt) {
      return evaluateRecoveryFreshness({ lastSuccessAt: partial.lastSuccessAt, now });
    }
  }

  const selected = selectLatestBackupCompletion(runs, jobsByRunId);
  if (selected.unproven) return evaluateRecoveryFreshnessUnproven(selected.unproven);
  return evaluateRecoveryFreshness({ lastSuccessAt: selected.lastSuccessAt, now });
}

function evaluateRecoveryFreshnessUnproven(reason) {
  return {
    ok: false,
    code: VERDICT_UNPROVEN,
    reason,
    last_success_at: null,
    age_hours: null,
    headroom_hours: null,
    expires_at: null,
    budget_hours: RECOVERY_BUDGET_HOURS,
    warn_headroom_hours: WARN_HEADROOM_HOURS,
  };
}

/** Posts the alert unless an identical marker is already on the issue. */
export async function postAlertOnce(verdict, {
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  const apiUrl = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
  const repository = env.GITHUB_REPOSITORY;
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  const issue = env.SITES_RECOVERY_ALERT_ISSUE || DEFAULT_ALERT_ISSUE;
  if (!/^[1-9]\d*$/.test(String(issue))) fail("ALERT_ISSUE_INVALID");
  const since = new Date(now.getTime() - 7 * 24 * HOUR_MS).toISOString();

  const existing = await readJson(
    fetchImpl,
    `${apiUrl}/repos/${repository}/issues/${issue}/comments` +
      `?per_page=100&since=${encodeURIComponent(since)}`,
    token,
    "ALERT_COMMENTS_READ_FAILED",
  );
  const marker = alertMarker(verdict);
  if (
    Array.isArray(existing) &&
    existing.some((comment) => typeof comment?.body === "string" &&
      comment.body.includes(marker))
  ) {
    return { posted: false, reason: "ALREADY_REPORTED", marker };
  }

  const runUrl = `${env.GITHUB_SERVER_URL || "https://github.com"}/${repository}` +
    `/actions/runs/${env.GITHUB_RUN_ID || "unknown"}`;
  let response;
  try {
    response = await fetchImpl(
      `${apiUrl}/repos/${repository}/issues/${issue}/comments`,
      {
        method: "POST",
        headers: { ...apiHeaders(token), "content-type": "application/json" },
        body: JSON.stringify({ body: alertBody(verdict, runUrl) }),
      },
    );
  } catch {
    fail("ALERT_COMMENT_POST_FAILED");
  }
  if (!response?.ok) fail("ALERT_COMMENT_POST_FAILED");
  return { posted: true, reason: "REPORTED", marker };
}

export async function runRecoveryFreshnessWatchdog({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  stdout = process.stdout,
} = {}) {
  // A watchdog that cannot read its evidence has NOT proved health, so an
  // unreachable or malformed Actions API becomes an alerting verdict rather than
  // an exception that only shows up as a red square nobody reads.
  let verdict;
  try {
    verdict = await checkRecoveryFreshness({ env, fetchImpl, now });
  } catch (error) {
    verdict = evaluateRecoveryFreshnessUnproven(
      error?.code || error?.message || "FRESHNESS_READ_FAILED",
    );
  }
  // Always audible, healthy or not: a watchdog whose only output is an exit code
  // reads the same as a watchdog that never ran.
  stdout.write(`${formatVerdictLine(verdict)}\n`);
  if (!isAlertingVerdict(verdict.code)) return { verdict, alert: null };
  const alert = await postAlertOnce(verdict, { env, fetchImpl, now });
  stdout.write(
    `SITES_RECOVERY_ALERT_DELIVERY posted=${alert.posted} reason=${alert.reason}\n`,
  );
  return { verdict, alert };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runRecoveryFreshnessWatchdog()
    .then(({ verdict }) => {
      if (isAlertingVerdict(verdict.code)) process.exitCode = 1;
    })
    .catch((error) => {
      safeCliFailure(error);
    });
}
