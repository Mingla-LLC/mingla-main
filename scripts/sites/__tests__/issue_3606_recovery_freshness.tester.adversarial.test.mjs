/**
 * Issue #3606 — adversarial.
 *
 * The implementor suite proves the watchdog reports the right number. This one
 * attacks the two ways it could report a comfortable number and still let the
 * public site go dark:
 *
 *   1. It is fooled about WHAT succeeded. The watchdog now lives inside the very
 *      workflow it watches, so `sites-backup-restore.yml` can conclude `success`
 *      having taken no backup at all. A watchdog that asks "did the newest run
 *      succeed?" reports a full budget every hour while the budget drains to
 *      zero — a failure mode this change CREATED and therefore owes a test.
 *   2. It arms something it must never arm. That same co-tenancy means the
 *      hourly cron skips `backup_restore`, and the existing `deactivate` job
 *      fires on ANY non-success of that job. Left alone, adding the watchdog
 *      would have signed-deactivated the pilot every hour, on the hour.
 *
 * Plus the boring half that matters more than either: a watchdog must never
 * answer OK to a question it could not read.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BACKUP_JOB_NAME,
  RECOVERY_BUDGET_HOURS,
  VERDICT_EXPIRED,
  VERDICT_LATE,
  VERDICT_NO_SUCCESS,
  VERDICT_OK,
  VERDICT_UNPROVEN,
  WARN_HEADROOM_HOURS,
  alertBody,
  checkRecoveryFreshness,
  evaluateRecoveryFreshness,
  isAlertingVerdict,
  postAlertOnce,
  runRecoveryFreshnessWatchdog,
  selectLatestBackupCompletion,
} from "../check-recovery-freshness.mjs";

const HOUR = 60 * 60 * 1000;
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const workflow = readFileSync(
  join(REPO_ROOT, ".github", "workflows", "sites-backup-restore.yml"),
  "utf8",
);

/**
 * Observed GitHub dispatch lateness for the nominal 07:23Z cron, from the ten
 * runs recorded on #3606: starts between 11:56Z and 13:06Z.
 */
const MIN_DRIFT_HOURS = 4 + 33 / 60;
const MAX_DRIFT_HOURS = 5 + 43 / 60;

function jobIf(source, jobName) {
  const at = source.indexOf(`\n  ${jobName}:\n`);
  assert.ok(at >= 0, `job ${jobName} exists`);
  const rest = source.slice(at + 1);
  const end = rest.search(/\n {2}[A-Za-z_][A-Za-z0-9_-]*:\s*\n/);
  const block = end === -1 ? rest : rest.slice(0, end);
  const condition = /\n {4}if: >-\n((?: {6}.*\n)+)/.exec(block);
  return condition ? condition[1] : null;
}

function watchdogCron() {
  const schedule = /\n {2}schedule:\n((?: {4}- cron: "[^"]+"\n)+)/.exec(workflow);
  const crons = [...schedule[1].matchAll(/- cron: "([^"]+)"/g)].map((m) => m[1]);
  return crons.find((cron) => /^\d+ \* \* \* \*$/.test(cron));
}

function fakeGitHub({ runs = [], jobs = {}, comments = [], failUrl = null } = {}) {
  const posted = [];
  const fetchImpl = async (url, init = {}) => {
    if (failUrl && url.includes(failUrl)) throw new Error("network down");
    if (init.method === "POST") {
      posted.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ id: 1 }) };
    }
    if (url.includes("/issues/") && url.includes("/comments")) {
      return { ok: true, json: async () => comments };
    }
    const jobsMatch = /\/actions\/runs\/(\d+)\/jobs/.exec(url);
    if (jobsMatch) {
      const value = jobs[Number(jobsMatch[1])];
      return { ok: true, json: async () => (value === "malformed" ? { jobs: "nope" } : { jobs: value ?? [] }) };
    }
    if (url.includes("/actions/workflows/")) {
      return { ok: true, json: async () => (runs === "malformed" ? {} : { workflow_runs: runs }) };
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { fetchImpl, posted };
}

const ENV = Object.freeze({
  GITHUB_REPOSITORY: "Mingla-LLC/mingla-main",
  GH_TOKEN: "ghs_testtoken_0123456789",
  GITHUB_RUN_ID: "999",
  GITHUB_SERVER_URL: "https://github.com",
});

function sink() {
  const lines = [];
  return { lines, write: (value) => lines.push(value.trimEnd()) };
}

test("#3606 a workflow that succeeds without backing anything up is not freshness", async () => {
  // Twenty consecutive hourly watchdog runs, every one concluding `success`,
  // and the last real backup two days ago. The naive reading is "newest run
  // succeeded, we are fine"; the correct reading is EXPIRED.
  const runs = [];
  const jobs = {};
  for (let index = 0; index < 20; index += 1) {
    const id = 9000 + index;
    runs.push({ id, head_branch: "main" });
    jobs[id] = [
      { name: "Sites recovery contracts", conclusion: "success", completed_at: "2026-09-30T09:37:20Z" },
      { name: "Recovery freshness watchdog", conclusion: "success", completed_at: "2026-09-30T09:38:00Z" },
    ];
  }
  const { fetchImpl } = fakeGitHub({ runs, jobs });
  const verdict = await checkRecoveryFreshness({
    env: ENV,
    fetchImpl,
    now: new Date("2026-09-30T10:00:00Z"),
  });
  assert.equal(verdict.code, VERDICT_NO_SUCCESS);
  assert.equal(verdict.ok, false);
  assert.ok(isAlertingVerdict(verdict.code));
});

test("#3606 a backup job that was skipped or cancelled never counts as success", () => {
  for (const conclusion of ["skipped", "cancelled", "failure", null]) {
    const result = selectLatestBackupCompletion(
      [{ id: 1, head_branch: "main" }],
      { 1: [{ name: BACKUP_JOB_NAME, conclusion, completed_at: "2026-09-28T12:04:59Z" }] },
    );
    assert.deepEqual(
      result,
      { lastSuccessAt: null },
      `conclusion ${conclusion} must not refill the budget`,
    );
  }
});

test("#3606 a successful backup on another branch never counts", () => {
  const result = selectLatestBackupCompletion(
    [{ id: 1, head_branch: "3606-backup-freshness" }],
    { 1: [{ name: BACKUP_JOB_NAME, conclusion: "success", completed_at: "2026-09-28T12:04:59Z" }] },
  );
  assert.deepEqual(result, { lastSuccessAt: null });
});

test("#3606 the hourly watchdog cannot arm deactivation, alerting, or a backup", () => {
  const cron = watchdogCron();
  assert.ok(cron, "an hourly watchdog cron is declared");

  // EXCLUSION polarity: each production-side-effect job must refuse the watchdog
  // cron BY NAME. Rename the cron without touching these and the test goes red
  // here rather than the pilot being deactivated hourly in production.
  for (const job of ["backup_restore", "deactivate", "alert"]) {
    const condition = jobIf(workflow, job);
    assert.ok(condition, `${job} has an if: condition`);
    assert.ok(
      condition.includes(`github.event.schedule != '${cron}'`),
      `${job} must exclude the watchdog cron '${cron}'`,
    );
    assert.ok(
      condition.includes("github.event.inputs.mode != 'freshness-check'"),
      `${job} must exclude a manual freshness-check dispatch`,
    );
  }

  // `deactivate` keeps firing on every OTHER non-success, including the skipped
  // backup_restore caused by a contract failure that #2893 deliberately covers.
  const deactivate = jobIf(workflow, "deactivate");
  assert.ok(deactivate.includes("needs.backup_restore.result != 'success'"));
  assert.ok(deactivate.includes("always()"));

  // The watchdog itself uses inclusion, so a broken expression silences the
  // watchdog rather than starting an hourly production backup.
  const watchdog = jobIf(workflow, "recovery_freshness");
  assert.ok(watchdog.includes(`github.event.schedule == '${cron}'`));
  assert.ok(watchdog.includes("github.ref == 'refs/heads/main'"));
  assert.ok(watchdog.includes("github.event_name != 'pull_request'"));
});

test("#3606 the old daily cadence left no threshold that was both honest and quiet", () => {
  // A generation that is fresh when the next run STARTS and stale by the time
  // it lands. With one daily cron, consecutive completions are 24 hours apart
  // plus the spread in observed drift.
  const singleCronGap = 24 + (MAX_DRIFT_HOURS - MIN_DRIFT_HOURS);
  const lastSuccessAt = "2026-09-27T13:08:00Z";
  const atNextLanding = evaluateRecoveryFreshness({
    lastSuccessAt,
    now: new Date(Date.parse(lastSuccessAt) + singleCronGap * HOUR),
  });
  // Under 1.2 hours of a 26-hour budget left on a day nothing went wrong. Any
  // warn threshold worth having fires every single day — which is why the
  // cadence had to change before the alert could mean anything.
  assert.equal(atNextLanding.code, VERDICT_LATE);
  assert.ok(atNextLanding.headroom_hours < 1.5, `headroom ${atNextLanding.headroom_hours}`);

  // The measured near-miss itself: the worst observed dispatch (07:23 + 5h43m =
  // 13:06Z) lands AFTER the old 12:51:05Z deadline and before the new one.
  const worstStart = Date.parse("2026-09-28T07:23:00Z") + MAX_DRIFT_HOURS * HOUR;
  assert.ok(worstStart > Date.parse("2026-09-27T10:51:05Z") + RECOVERY_BUDGET_HOURS * HOUR);
  assert.ok(worstStart < Date.parse(lastSuccessAt) + RECOVERY_BUDGET_HOURS * HOUR);
});

test("#3606 the two-cron cadence stays quiet on a normally-late day", () => {
  // Worst plausible consecutive gap under the shipped schedule: one run lands at
  // its earliest observed drift, the next at its latest, 12 hours later.
  const gap = 12 + (MAX_DRIFT_HOURS - MIN_DRIFT_HOURS);
  const lastSuccessAt = "2026-09-27T13:08:00Z";
  const verdict = evaluateRecoveryFreshness({
    lastSuccessAt,
    now: new Date(Date.parse(lastSuccessAt) + gap * HOUR),
  });
  assert.equal(verdict.code, VERDICT_OK);
  assert.ok(
    verdict.headroom_hours > WARN_HEADROOM_HOURS,
    `a merely-late day must not page: headroom ${verdict.headroom_hours}`,
  );
  // But a whole skipped run does page, with hours to spare before expiry.
  const skipped = evaluateRecoveryFreshness({
    lastSuccessAt,
    now: new Date(Date.parse(lastSuccessAt) + (gap + 12) * HOUR),
  });
  assert.equal(skipped.code, VERDICT_LATE);
  assert.ok(skipped.headroom_hours > 0);
});

test("#3606 nothing unreadable is ever reported as healthy", async () => {
  const unreadable = [
    { label: "runs payload is not a list", runs: "malformed" },
    { label: "jobs payload is not a list", runs: [{ id: 1, head_branch: "main" }], jobs: { 1: "malformed" } },
    { label: "run id is not an integer", runs: [{ id: 1.5, head_branch: "main" }] },
    { label: "run branch is missing", runs: [{ id: 1 }] },
    { label: "job name is not a string", runs: [{ id: 1, head_branch: "main" }], jobs: { 1: [{ name: 7 }] } },
    {
      label: "successful backup has an unreadable completion",
      runs: [{ id: 1, head_branch: "main" }],
      jobs: { 1: [{ name: BACKUP_JOB_NAME, conclusion: "success", completed_at: "yesterday" }] },
    },
  ];
  for (const scenario of unreadable) {
    const { fetchImpl } = fakeGitHub(scenario);
    const verdict = await checkRecoveryFreshness({ env: ENV, fetchImpl });
    assert.equal(verdict.code, VERDICT_UNPROVEN, scenario.label);
    assert.equal(verdict.ok, false, scenario.label);
    assert.ok(isAlertingVerdict(verdict.code), scenario.label);
  }

  // A completion in the future is a clock fault, not the maximum headroom.
  const future = evaluateRecoveryFreshness({
    lastSuccessAt: "2027-01-01T00:00:00Z",
    now: new Date("2026-09-28T12:00:00Z"),
  });
  assert.equal(future.code, VERDICT_UNPROVEN);
});

test("#3606 an unreachable Actions API pages instead of throwing quietly", async () => {
  const { fetchImpl, posted } = fakeGitHub({ failUrl: "/actions/workflows/" });
  const stdout = sink();
  const { verdict, alert } = await runRecoveryFreshnessWatchdog({
    env: ENV,
    fetchImpl,
    stdout,
  });
  assert.equal(verdict.code, VERDICT_UNPROVEN);
  assert.equal(alert.posted, true);
  assert.equal(posted.length, 1);
  // Audible: the verdict line is on stdout even though nothing could be read.
  assert.ok(stdout.lines.some((line) => line.includes(VERDICT_UNPROVEN)));
});

test("#3606 one late generation pages once, and an escalation pages again", async () => {
  const late = evaluateRecoveryFreshness({
    lastSuccessAt: "2026-09-27T13:08:00Z",
    now: new Date("2026-09-28T10:55:41Z"),
  });
  assert.equal(late.code, VERDICT_LATE);

  // Second hour, same generation, same verdict: the marker is already there.
  const already = fakeGitHub({
    comments: [{ body: `SITES_RECOVERY_ALERT code=${VERDICT_LATE} last_success_at=2026-09-27T13:08:00.000Z\n...` }],
  });
  const repeat = await postAlertOnce(late, { env: ENV, fetchImpl: already.fetchImpl });
  assert.equal(repeat.posted, false);
  assert.equal(already.posted.length, 0);

  // The budget then runs out. Different verdict, so the escalation is reported
  // even though the same generation was already flagged as late.
  const expired = evaluateRecoveryFreshness({
    lastSuccessAt: "2026-09-27T13:08:00Z",
    now: new Date("2026-09-28T16:00:00Z"),
  });
  assert.equal(expired.code, VERDICT_EXPIRED);
  const escalation = await postAlertOnce(expired, {
    env: ENV,
    fetchImpl: already.fetchImpl,
  });
  assert.equal(escalation.posted, true);
  assert.equal(already.posted.length, 1);

  // The page has to be actionable on its own, at 3am, by someone who has not
  // read this issue: it names the recovery command and warns that a failed run
  // deactivates the pilot.
  const body = alertBody(expired, "https://github.com/x/y/actions/runs/1");
  assert.ok(body.includes("gh workflow run sites-backup-restore.yml"));
  assert.ok(body.includes("deactivation"));
  assert.ok(body.includes("404"));
});

test("#3606 a healthy budget pages nobody", async () => {
  const runs = [{ id: 1, head_branch: "main" }];
  const jobs = {
    1: [{ name: BACKUP_JOB_NAME, conclusion: "success", completed_at: "2026-09-28T12:04:59Z" }],
  };
  const { fetchImpl, posted } = fakeGitHub({ runs, jobs });
  const stdout = sink();
  const { verdict, alert } = await runRecoveryFreshnessWatchdog({
    env: ENV,
    fetchImpl,
    now: new Date("2026-09-28T13:04:59Z"),
    stdout,
  });
  assert.equal(verdict.code, VERDICT_OK);
  assert.equal(alert, null);
  assert.equal(posted.length, 0);
  // Still audible on a good day — silence is how a stopped watchdog looks.
  assert.ok(stdout.lines.some((line) => line.startsWith("SITES_RECOVERY_FRESHNESS code=")));
});
