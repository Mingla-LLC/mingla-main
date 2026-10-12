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
 *
 * Issue #2830 — THE WATCHDOG JUDGES THE BACKUP BY ITS EVIDENCE.
 *
 * Measuring a job's colour is measuring a proxy. From 2026-10-07 a clean-up
 * step at the end of the backup job failed on every run, so the job was red,
 * and this watchdog reported `NO_SUCCESSFUL_BACKUP_IN_SCANNED_WINDOW` for four
 * days while Core held fresh, verified evidence from every one of those runs.
 * The same proxy fails the other way too: nothing here ever looked at the
 * public site, so a pilot that had been deactivated and then forgotten, with
 * perfectly fresh evidence behind it, read as healthy.
 *
 * Three inputs now, in this order:
 *   1. THE LEDGER (primary). After Core accepts and reads back the readiness
 *      evidence, the backup run publishes the accepted timestamps as ONE issue
 *      comment, edited in place. That receipt is the evidence. It carries
 *      timestamps and nothing else, and needs no credential to read.
 *   2. THE JOB CONCLUSION (secondary). Still read, always printed, and it
 *      decides the verdict only when no ledger exists yet.
 *   3. THE PUBLIC HOST (ground truth). One unauthenticated GET. Fresh evidence
 *      with a site that is not serving is its own alerting verdict.
 */

import { fileURLToPath } from "node:url";

import { fail, safeCliFailure } from "./lib/sites-ops.mjs";
import { notifySitesOps, safeCode } from "./notify-sites-ops.mjs";

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
/** #2830 — evidence is inside its budget and the public site is not serving. */
export const VERDICT_HOST_DOWN = "SITES_PILOT_HOST_DOWN_EVIDENCE_FRESH";

/** Verdicts that mean "the public site is at risk and somebody must be told". */
const ALERTING_VERDICTS = Object.freeze([
  VERDICT_LATE,
  VERDICT_EXPIRED,
  VERDICT_NO_SUCCESS,
  VERDICT_UNPROVEN,
  VERDICT_HOST_DOWN,
]);

/** First line of the one comment that carries the accepted evidence. */
export const LEDGER_MARKER = "SITES_RECOVERY_EVIDENCE_LEDGER v1";
/**
 * Only a ledger written by the workflow's own token is evidence. The
 * repository is public and anyone can comment on the issue, so a ledger from
 * any other author is not a ledger at all: it is ignored and counted, it can
 * never refill the budget, and it cannot be used to set the alarm off either.
 */
export const LEDGER_AUTHOR = "github-actions[bot]";
/** The ledger is edited in place twice a day, so this window always holds it. */
export const LEDGER_WINDOW_HOURS = 72;
export const LEDGER_TIMESTAMP_FIELDS = Object.freeze([
  "evidence_object_manifest_at",
  "evidence_entitlement_at",
  "evidence_database_backup_at",
  "evidence_accepted_at",
  "evidence_restore_drill_at",
]);
/** MUST equal the resolver's restore-drill interval, for the reason above. */
export const RESTORE_DRILL_BUDGET_DAYS = 100;
export const RESTORE_DRILL_WARN_DAYS = 93;

/** The pilot's public address. A constant: this probe takes no configuration. */
export const PILOT_PUBLIC_URL = "https://gogi.sites.usemingla.com/";
export const HOST_PROBE_GAP_MS = 10_000;
const HOST_PROBE_TIMEOUT_MS = 15_000;
const DAY_MS = 24 * 60 * 60 * 1000;

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
    // #2830 — additive, and only when known, so a verdict built before these
    // existed still prints the line it always did.
    ...(verdict.source ? [`source=${verdict.source}`] : []),
    ...(verdict.secondary_job_success_at !== undefined
      ? [`secondary_job_success_at=${verdict.secondary_job_success_at ?? "none"}`]
      : []),
    ...(verdict.ledger_ignored ? [`ledger_ignored=${verdict.ledger_ignored}`] : []),
    ...(verdict.public_host_status ? [`public_host_status=${verdict.public_host_status}`] : []),
  ].join(" ");
}

// ---------------------------------------------------------------------------
// #2830 — the evidence ledger
// ---------------------------------------------------------------------------

/** The ledger comment body. `publish-recovery-evidence.mjs` writes exactly this. */
export function formatLedger(fields) {
  return [
    LEDGER_MARKER,
    ...LEDGER_TIMESTAMP_FIELDS.map((name) => `${name}=${fields[name]}`),
    `run_id=${fields.run_id}`,
    `head_sha=${fields.head_sha}`,
  ].join("\n");
}

/**
 * Strict read. Exactly the marker line, then exactly the seven known keys, each
 * once, each in its own shape. Returns `{ fields }` or `{ unproven }`; a ledger
 * that is nearly right is not evidence.
 */
export function parseLedger(body) {
  if (typeof body !== "string") return { unproven: "LEDGER_BODY_NOT_TEXT" };
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  while (lines.length && lines.at(-1) === "") lines.pop();
  if (lines[0] !== LEDGER_MARKER) return { unproven: "LEDGER_MARKER_MISSING" };
  const expected = [...LEDGER_TIMESTAMP_FIELDS, "run_id", "head_sha"];
  if (lines.length !== expected.length + 1) return { unproven: "LEDGER_SHAPE_INVALID" };
  const fields = {};
  for (const line of lines.slice(1)) {
    const at = line.indexOf("=");
    const name = at > 0 ? line.slice(0, at) : "";
    if (!expected.includes(name) || Object.hasOwn(fields, name)) {
      return { unproven: "LEDGER_SHAPE_INVALID" };
    }
    fields[name] = line.slice(at + 1);
  }
  for (const name of LEDGER_TIMESTAMP_FIELDS) {
    if (parseInstant(fields[name]) === null) return { unproven: "LEDGER_FIELD_UNREADABLE" };
  }
  if (!/^[1-9]\d{0,19}$/.test(fields.run_id) || !/^[0-9a-f]{40}$/.test(fields.head_sha)) {
    return { unproven: "LEDGER_FIELD_UNREADABLE" };
  }
  return { fields };
}

/**
 * The newest ledger the workflow itself wrote, from a page of issue comments.
 * `{ ledger: null }` means none exists; `{ unproven }` means one exists and
 * cannot be read. `ignored` counts comments that carry the marker and were not
 * written by the workflow.
 */
export function selectLedger(comments) {
  if (!Array.isArray(comments)) return { unproven: "LEDGER_COMMENTS_NOT_A_LIST" };
  let newest = null;
  let ignored = 0;
  for (const comment of comments) {
    if (typeof comment?.body !== "string" || !comment.body.startsWith(LEDGER_MARKER)) continue;
    if (comment?.user?.login !== LEDGER_AUTHOR) {
      ignored += 1;
      continue;
    }
    const updated = parseInstant(comment.updated_at);
    if (updated === null) return { unproven: "LEDGER_UPDATED_AT_UNREADABLE", ignored };
    if (newest === null || updated > newest.updated) newest = { comment, updated };
  }
  if (newest === null) return { ledger: null, ignored };
  const parsed = parseLedger(newest.comment.body);
  if (parsed.unproven) return { unproven: parsed.unproven, ignored };
  return { ledger: { ...parsed.fields, comment_id: newest.comment.id }, ignored };
}

/**
 * The verdict for a readable ledger.
 *
 * `evidence_at` is the EARLIER of the two instants the resolver measures
 * against its 26-hour budget (the object manifest and the entitlement stamp),
 * because the site goes dark when the first of them ages out, not the last.
 * The restore drill has its own, much longer, budget.
 */
export function evaluateLedgerFreshness(ledger, { now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  const stamps = LEDGER_TIMESTAMP_FIELDS.map((name) => parseInstant(ledger?.[name]));
  if (!Number.isFinite(nowMs) || stamps.some((value) => value === null)) {
    return evaluateRecoveryFreshnessUnproven("LEDGER_FIELD_UNREADABLE");
  }
  // A stamp from the future is a clock or data fault. Refusing it here covers
  // all five fields, not only the two that decide the budget.
  if (stamps.some((value) => value > nowMs + CLOCK_SKEW_MS)) {
    return evaluateRecoveryFreshnessUnproven("LEDGER_TIMESTAMP_IN_THE_FUTURE");
  }
  const evidenceMs = Math.min(
    parseInstant(ledger.evidence_object_manifest_at),
    parseInstant(ledger.evidence_entitlement_at),
  );
  const verdict = evaluateRecoveryFreshness({
    lastSuccessAt: new Date(evidenceMs).toISOString(),
    now,
  });
  const drillDays = (nowMs - parseInstant(ledger.evidence_restore_drill_at)) / DAY_MS;
  if (drillDays >= RESTORE_DRILL_BUDGET_DAYS && verdict.code !== VERDICT_EXPIRED) {
    return { ...verdict, ok: false, code: VERDICT_EXPIRED, reason: "RESTORE_DRILL_EXPIRED" };
  }
  if (drillDays > RESTORE_DRILL_WARN_DAYS && verdict.code === VERDICT_OK) {
    return { ...verdict, ok: false, code: VERDICT_LATE, reason: "RESTORE_DRILL_NEARLY_EXPIRED" };
  }
  return verdict;
}

// ---------------------------------------------------------------------------
// #2830 — the public host, asked directly
// ---------------------------------------------------------------------------

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Is the pilot's public address answering 200? No credential, no redirect
 * following, at most two requests.
 *
 * `down` is true only when BOTH attempts returned a readable status that was
 * not 200. A request that could not be made at all says nothing about the site
 * (it says something about this runner's network), so it is reported as
 * `unreadable` and never pages; that is also why an unreadable first attempt is
 * not retried.
 */
export async function probePublicHost({
  fetchImpl = fetch,
  url = PILOT_PUBLIC_URL,
  delay = wait,
  gapMs = HOST_PROBE_GAP_MS,
} = {}) {
  const once = async () => {
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(HOST_PROBE_TIMEOUT_MS),
      });
      return Number.isInteger(response?.status) ? response.status : null;
    } catch {
      return null;
    }
  };
  const first = await once();
  if (first === null) return { status: "unreadable", down: false };
  if (first === 200) return { status: "200", down: false };
  await delay(gapMs);
  const second = await once();
  if (second === null) return { status: "unreadable", down: false };
  if (second === 200) return { status: "200", down: false };
  return { status: String(second), down: true };
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
  if (verdict.code === VERDICT_HOST_DOWN) {
    // #2830 — a different fault with a different fix: another backup run will
    // not bring back a site that was deactivated.
    return [
      alertMarker(verdict),
      "",
      formatVerdictLine(verdict),
      "",
      "The pilot host is not answering 200 although its recovery evidence is inside the freshness budget. The usual cause is a pilot that was deactivated after an earlier failure and never switched back on: nothing re-activates it automatically.",
      "",
      "Recover by following \"Re-activating the pilot after a deactivation\" in `docs/runbooks/MINGLA_SITES_PILOT.md`. Dispatching another backup does not help.",
      "",
      `Watchdog run: ${runUrl}`,
    ].join("\n");
  }
  return [
    alertMarker(verdict),
    "",
    formatVerdictLine(verdict),
    "",
    verdict.code === VERDICT_EXPIRED
      ? "The public Sites runtime resolver no longer has recovery evidence inside its freshness budget. Every page on the pilot host is 404 until a successful backup run lands."
      : "The public Sites runtime resolver gates every page request on recovery evidence that is close to expiring. A successful backup run must land before the headroom above reaches zero, or the pilot host starts returning 404 on every route.",
    "",
    // #2830 — this used to end "a failed run triggers signed pilot
    // deactivation", which stopped being true at #3628 and was never what a
    // person at 3am needed to hear. It now says which failures do.
    `Recover by dispatching the backup workflow: \`gh workflow run ${DEFAULT_WORKFLOW_FILE}\`. Its restore runs into an ephemeral PostgreSQL service container and does not touch production data. The run must SUCCEED. A failed run triggers signed pilot deactivation only when it proves the database backup is missing, stale, unretained or disabled, or when it fails without saying why; a failure it can name as anything else (a storage or network fault, a failed clean-up) leaves the site up on the evidence it already has.`,
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
 * The secondary indicator: the newest successful completion of the backup JOB,
 * from bounded Actions history. Returns `{ lastSuccessAt }` or `{ unproven }`,
 * and throws (through `fail`) when the API cannot be read.
 */
async function scanBackupJobConclusion({ fetchImpl, apiUrl, repository, token, workflowFile }) {
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
  if (runs === null) return { unproven: "RUNS_RESPONSE_SHAPE_INVALID" };

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
    // Stop as soon as the newest success is known; older runs cannot beat it.
    if (partial.unproven || partial.lastSuccessAt) return partial;
  }
  return selectLatestBackupCompletion(runs, jobsByRunId);
}

/** The ledger, read from the issue. Throws (through `fail`) when unreadable. */
async function readLedger({ fetchImpl, apiUrl, repository, token, issue, now }) {
  const since = new Date(now.getTime() - LEDGER_WINDOW_HOURS * HOUR_MS).toISOString();
  const comments = await readJson(
    fetchImpl,
    `${apiUrl}/repos/${repository}/issues/${issue}/comments` +
      `?per_page=100&since=${encodeURIComponent(since)}`,
    token,
    "LEDGER_COMMENTS_READ_FAILED",
  );
  return selectLedger(comments);
}

/**
 * Reads the evidence ledger, then bounded Actions history, and returns the
 * pure verdict. Every network or shape failure lands on UNPROVEN, which alerts.
 *
 * #2830 — the ledger decides whenever one exists. The job conclusion is still
 * read and always reported as `secondary_job_success_at`, and it decides only
 * when no ledger exists (the first run after this shipped, or a repository that
 * has never published one), marked `source=job_conclusion`. A ledger that
 * exists and cannot be read is UNPROVEN: it is never quietly replaced by the
 * job's colour, because "the receipt is unreadable" is itself the news.
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
  const issue = env.SITES_RECOVERY_ALERT_ISSUE || DEFAULT_ALERT_ISSUE;
  if (typeof repository !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    fail("GITHUB_REPOSITORY_INVALID");
  }
  if (typeof token !== "string" || token.length < 8) fail("GITHUB_TOKEN_MISSING");
  if (!/^[1-9]\d*$/.test(String(issue))) fail("ALERT_ISSUE_INVALID");
  const github = { fetchImpl, apiUrl, repository, token };

  const selected = await readLedger({ ...github, issue, now });
  const ignored = selected.ignored ? { ledger_ignored: selected.ignored } : {};
  if (selected.unproven) {
    return { ...evaluateRecoveryFreshnessUnproven(selected.unproven), source: "ledger", ...ignored };
  }

  if (selected.ledger) {
    // The secondary indicator must never be able to change, or lose, a verdict
    // the receipt already decided.
    let secondary;
    try {
      const scan = await scanBackupJobConclusion({ ...github, workflowFile });
      secondary = scan.unproven ? "unreadable" : scan.lastSuccessAt;
    } catch {
      secondary = "unreadable";
    }
    return {
      ...evaluateLedgerFreshness(selected.ledger, { now }),
      source: "ledger",
      secondary_job_success_at: secondary,
      ...ignored,
    };
  }

  const scan = await scanBackupJobConclusion({ ...github, workflowFile });
  if (scan.unproven) {
    return { ...evaluateRecoveryFreshnessUnproven(scan.unproven), source: "job_conclusion", ...ignored };
  }
  return {
    ...evaluateRecoveryFreshness({ lastSuccessAt: scan.lastSuccessAt, now }),
    source: "job_conclusion",
    secondary_job_success_at: scan.lastSuccessAt,
    ...ignored,
  };
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

/**
 * The verdict, printed. Never throws: a watchdog that cannot read its evidence
 * has NOT proved health, so an unreachable or malformed API becomes an alerting
 * verdict rather than an exception that only shows up as a red square.
 *
 * #2830 — when the evidence is inside its budget, the public host is asked
 * directly. Evidence that is fresh behind a site that is not serving is the
 * exact four-day state of October 2026, and nothing reported it.
 */
export async function resolveWatchdogVerdict({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  stdout = process.stdout,
  probe = probePublicHost,
} = {}) {
  let verdict;
  try {
    verdict = await checkRecoveryFreshness({ env, fetchImpl, now });
  } catch (error) {
    verdict = evaluateRecoveryFreshnessUnproven(
      error?.code || error?.message || "FRESHNESS_READ_FAILED",
    );
  }
  if (verdict.code === VERDICT_OK || verdict.code === VERDICT_LATE) {
    let host;
    try {
      host = await probe({ fetchImpl });
    } catch {
      host = { status: "unreadable", down: false };
    }
    verdict = { ...verdict, public_host_status: host.status };
    if (host.down) {
      verdict = {
        ...verdict,
        ok: false,
        code: VERDICT_HOST_DOWN,
        reason: "PUBLIC_HOST_NOT_SERVING",
      };
    }
  }
  // Always audible, healthy or not: a watchdog whose only output is an exit code
  // reads the same as a watchdog that never ran.
  stdout.write(`${formatVerdictLine(verdict)}\n`);
  return verdict;
}

export async function runRecoveryFreshnessWatchdog({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  stdout = process.stdout,
  probe = probePublicHost,
} = {}) {
  const verdict = await resolveWatchdogVerdict({ env, fetchImpl, now, stdout, probe });
  if (!isAlertingVerdict(verdict.code)) return { verdict, alert: null };
  const alert = await postAlertOnce(verdict, { env, fetchImpl, now });
  stdout.write(
    `SITES_RECOVERY_ALERT_DELIVERY posted=${alert.posted} reason=${alert.reason}\n`,
  );
  return { verdict, alert };
}

/** Which page an alerting verdict calls for. The email is deduped per UTC day. */
export function pageForVerdict(verdict) {
  const headroomHours = verdict.headroom_hours;
  if (verdict.code === VERDICT_HOST_DOWN) {
    return {
      kind: "PILOT_HOST_DOWN_EVIDENCE_FRESH",
      code: VERDICT_HOST_DOWN,
      outcome: `PILOT_NOT_SERVING status=${safeCode(`HTTP_${verdict.public_host_status}`, "HTTP_UNKNOWN")}`,
      headroomHours,
    };
  }
  if (verdict.code === VERDICT_LATE) {
    return {
      kind: "EVIDENCE_AGEING",
      code: safeCode(verdict.reason, VERDICT_LATE),
      outcome: "PILOT_UP recovery_evidence_ageing",
      headroomHours,
    };
  }
  if (verdict.code === VERDICT_EXPIRED) {
    return {
      kind: "EVIDENCE_EXPIRED",
      code: safeCode(verdict.reason, VERDICT_EXPIRED),
      outcome: "PILOT_NOT_SERVING recovery_evidence_expired",
      headroomHours,
    };
  }
  return {
    kind: "EVIDENCE_UNPROVEN",
    code: safeCode(verdict.reason, "FRESHNESS_READ_FAILED"),
    outcome: "PILOT_STATE_NOT_PROVEN",
    headroomHours: null,
  };
}

/**
 * What the hourly job runs: the verdict, the per-generation issue comment, and
 * the email.
 *
 * #2830 — the comment and the email are independent. The comment used to be the
 * only alarm, and if it could not be posted the run threw and nothing else
 * happened. Now a comment that cannot be posted is reported and the email is
 * still attempted, because the email is the one that reaches a person.
 */
export async function runWatchdogAndPage({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  stdout = process.stdout,
  probe = probePublicHost,
  notify = notifySitesOps,
} = {}) {
  const verdict = await resolveWatchdogVerdict({ env, fetchImpl, now, stdout, probe });
  if (!isAlertingVerdict(verdict.code)) return { verdict, alert: null, page: null, exitCode: 0 };
  let alert;
  try {
    alert = await postAlertOnce(verdict, { env, fetchImpl, now });
  } catch (error) {
    alert = { posted: false, reason: safeCode(error?.code, "ALERT_COMMENT_FAILED") };
  }
  stdout.write(
    `SITES_RECOVERY_ALERT_DELIVERY posted=${alert.posted} reason=${alert.reason}\n`,
  );
  const page = await notify(pageForVerdict(verdict), { env, fetchImpl, now, stdout });
  // An alerting verdict is a red run whatever the delivery did.
  return { verdict, alert, page, exitCode: 1 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runWatchdogAndPage()
    .then(({ exitCode }) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      safeCliFailure(error);
    });
}
