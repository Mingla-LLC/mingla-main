/**
 * Issue #3606 — implementor happy path.
 *
 * The public Sites resolver re-checks recovery evidence on every page request
 * against a 26-hour budget that one daily job refills. Two things were wrong at
 * once: the field that BOUND the window was stamped hours before the job that
 * refilled it, and nothing at all reported lateness — the only alarm fires when
 * a run FAILS, so a run that is late or never starts produces no signal.
 *
 * Every timestamp below is real, read from production and from GitHub Actions
 * run 36419324279 on 2026-09-28, not a shape invented to match the fix.
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
  WARN_HEADROOM_HOURS,
  alertMarker,
  evaluateRecoveryFreshness,
  isAlertingVerdict,
  selectLatestBackupCompletion,
} from "../check-recovery-freshness.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW_PATH = join(
  REPO_ROOT,
  ".github",
  "workflows",
  "sites-backup-restore.yml",
);
const MIGRATION_PATH = join(
  REPO_ROOT,
  "supabase",
  "migrations",
  "20270718003606_issue_3606_recovery_freshness_measured_at_completion.sql",
);

/**
 * The four readiness stamps written by ONE successful run, 2026-09-28.
 * `database_backup_verified_at` is 1h21m older than the other three because it
 * carries the upstream managed backup's own `inserted_at`.
 */
const RUN_36419324279 = Object.freeze({
  database_backup_verified_at: "2026-09-28T10:42:47Z",
  object_manifest_verified_at: "2026-09-28T12:03:39Z",
  restore_drill_verified_at: "2026-09-28T12:04:56Z",
  backup_entitlement_verified_at: "2026-09-28T12:04:59Z",
});

/** The run before it, whose recovery point set the 12:51:05Z near-miss deadline. */
const RUN_2026_09_27 = Object.freeze({
  database_backup_verified_at: "2026-09-27T10:51:05Z",
  backup_entitlement_verified_at: "2026-09-27T13:08:00Z",
});

const workflow = readFileSync(WORKFLOW_PATH, "utf8");
const migration = readFileSync(MIGRATION_PATH, "utf8");

/** Minimal job-block splitter: no YAML dependency is available to `node --test`. */
function jobBlocks(source) {
  const jobsAt = source.indexOf("\njobs:\n");
  assert.ok(jobsAt >= 0, "workflow has a jobs: block");
  const body = source.slice(jobsAt + "\njobs:\n".length);
  const blocks = new Map();
  let name = null;
  let lines = [];
  for (const line of body.split("\n")) {
    const header = /^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*$/.exec(line);
    if (header) {
      if (name) blocks.set(name, lines.join("\n"));
      name = header[1];
      lines = [];
      continue;
    }
    if (name) lines.push(line);
  }
  if (name) blocks.set(name, lines.join("\n"));
  return blocks;
}

/** The hourly watchdog cron, read from the workflow rather than hardcoded twice. */
function watchdogCron(source) {
  const schedule = /\n {2}schedule:\n((?: {4}- cron: "[^"]+"\n)+)/.exec(source);
  assert.ok(schedule, "workflow declares a schedule block");
  const crons = [...schedule[1].matchAll(/- cron: "([^"]+)"/g)].map((m) => m[1]);
  const hourly = crons.filter((cron) => /^\d+ \* \* \* \*$/.test(cron));
  assert.equal(hourly.length, 1, `exactly one hourly watchdog cron: ${crons}`);
  return { cron: hourly[0], all: crons };
}

test("#3606 the near-miss deadline moves by exactly the stamping lag", () => {
  const hour = 60 * 60 * 1000;
  // What actually gated the site on 2026-09-28: the 09-27 run's recovery point
  // plus 26 hours. The issue measured 12:51Z, and the site was 1.92 hours away.
  const oldDeadline = Date.parse(RUN_2026_09_27.database_backup_verified_at) +
    RECOVERY_BUDGET_HOURS * hour;
  assert.equal(new Date(oldDeadline).toISOString(), "2026-09-28T12:51:05.000Z");

  // What gates it after the fix: the same run's COMPLETION plus 26 hours.
  const newDeadline = Date.parse(RUN_2026_09_27.backup_entitlement_verified_at) +
    RECOVERY_BUDGET_HOURS * hour;
  assert.equal(new Date(newDeadline).toISOString(), "2026-09-28T15:08:00.000Z");

  // The recovered budget is the stamping lag itself — 2h16m55s on that run —
  // and nothing more. The fix buys back what was being spent, not extra rope.
  assert.equal(newDeadline - oldDeadline, 2 * hour + 16 * 60 * 1000 + 55 * 1000);
});

test("#3606 the watchdog would have paged hours before the site went dark", () => {
  const hour = 60 * 60 * 1000;
  const lastSuccessAt = RUN_2026_09_27.backup_entitlement_verified_at;

  // 10:55:41Z on 2026-09-28: the moment the issue was filed. Nothing had fired.
  const atFiling = evaluateRecoveryFreshness({
    lastSuccessAt,
    now: new Date("2026-09-28T10:55:41Z"),
  });
  assert.equal(atFiling.code, VERDICT_LATE);
  assert.equal(atFiling.ok, false);
  assert.ok(isAlertingVerdict(atFiling.code));

  // The watchdog crosses into LATE at completion + (26 - 8) hours, which on this
  // generation is 07:08:00Z — 5h43m before anybody noticed by hand, and 8 hours
  // before resolution would have started failing.
  const firstAlertAt = Date.parse(lastSuccessAt) +
    (RECOVERY_BUDGET_HOURS - WARN_HEADROOM_HOURS) * hour;
  assert.equal(new Date(firstAlertAt).toISOString(), "2026-09-28T07:08:00.000Z");
  assert.equal(
    evaluateRecoveryFreshness({
      lastSuccessAt,
      now: new Date(firstAlertAt - 1000),
    }).code,
    VERDICT_OK,
  );
  assert.equal(
    evaluateRecoveryFreshness({ lastSuccessAt, now: new Date(firstAlertAt + 1000) })
      .code,
    VERDICT_LATE,
  );
});

test("#3606 the verdict boundaries are the budget, not a rounded guess", () => {
  const hour = 60 * 60 * 1000;
  const lastSuccessAt = RUN_36419324279.backup_entitlement_verified_at;
  const completed = Date.parse(lastSuccessAt);

  const healthy = evaluateRecoveryFreshness({
    lastSuccessAt,
    now: new Date(completed + hour),
  });
  assert.equal(healthy.code, VERDICT_OK);
  assert.equal(healthy.ok, true);
  assert.equal(healthy.age_hours, 1);
  assert.equal(healthy.headroom_hours, RECOVERY_BUDGET_HOURS - 1);
  assert.equal(healthy.expires_at, "2026-09-29T14:04:59.000Z");
  assert.equal(isAlertingVerdict(healthy.code), false);

  // Exactly at expiry the budget is spent, so the boundary is EXPIRED, not LATE.
  assert.equal(
    evaluateRecoveryFreshness({
      lastSuccessAt,
      now: new Date(completed + RECOVERY_BUDGET_HOURS * hour),
    }).code,
    VERDICT_EXPIRED,
  );
  assert.equal(
    evaluateRecoveryFreshness({
      lastSuccessAt,
      now: new Date(completed + RECOVERY_BUDGET_HOURS * hour - 1000),
    }).code,
    VERDICT_LATE,
  );
});

test("#3606 freshness is read from the backup JOB, never from the run", () => {
  // This workflow now carries the watchdog itself, so a run of it can conclude
  // `success` having taken no backup at all.
  const runs = [
    { id: 3, head_branch: "main" },
    { id: 2, head_branch: "main" },
  ];
  const jobs = {
    3: [
      { name: "Sites recovery contracts", conclusion: "success", completed_at: "2026-09-29T09:37:40Z" },
      { name: "Recovery freshness watchdog", conclusion: "success", completed_at: "2026-09-29T09:38:10Z" },
    ],
    2: [
      { name: BACKUP_JOB_NAME, conclusion: "success", completed_at: RUN_36419324279.backup_entitlement_verified_at },
    ],
  };
  assert.deepEqual(selectLatestBackupCompletion(runs, jobs), {
    lastSuccessAt: "2026-09-28T12:04:59.000Z",
  });
});

test("#3606 an empty history is NO_SUCCESS, which alerts", () => {
  const verdict = evaluateRecoveryFreshness({ lastSuccessAt: null });
  assert.equal(verdict.code, VERDICT_NO_SUCCESS);
  assert.equal(verdict.ok, false);
  assert.ok(isAlertingVerdict(verdict.code));
  assert.equal(alertMarker(verdict), `SITES_RECOVERY_ALERT code=${VERDICT_NO_SUCCESS} last_success_at=none`);
});

test("#3606 the resolver no longer binds its window to the recovery point", () => {
  // The removed shape: the recovery point measured against wall clock. If this
  // ever comes back the window silently shrinks by the stamping lag again, so
  // the old shape is FORBIDDEN beside the new marker, not merely unasserted.
  const oldShape =
    /config\.database_backup_verified_at\s*>\s*\n?\s*statement_timestamp\(\)\s*-\s*interval\s*'26 hours'/;
  assert.equal(
    oldShape.test(migration),
    false,
    "resolver must not measure database_backup_verified_at against statement_timestamp()",
  );

  // The new shape: the recovery point bound RELATIVE to the verification that
  // observed it — the same 26-hour bound the record RPC enforces on write.
  assert.match(
    migration,
    /config\.database_backup_verified_at\s*>\s*\n?\s*config\.backup_entitlement_verified_at\s*-\s*interval\s*'26 hours'/,
  );

  // The completion-stamped fields keep the unchanged absolute budget. Losing any
  // of these would remove the gate rather than re-anchor it.
  for (const field of ["backup_entitlement_verified_at", "object_manifest_verified_at"]) {
    assert.match(
      migration,
      new RegExp(`config\\.${field}\\s*>\\s*\\n?\\s*statement_timestamp\\(\\)\\s*-\\s*interval\\s*'26 hours'`),
      `${field} keeps the absolute 26-hour completion budget`,
    );
  }
  assert.match(migration, /config\.restore_drill_verified_at\s*>\s*\n?\s*statement_timestamp\(\)\s*-\s*interval\s*'100 days'/);

  // Reachability is unchanged: still service_role only.
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.brand_site_resolve_publication\(text\)\s*\n?\s*FROM PUBLIC, anon, authenticated;/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.brand_site_resolve_publication\(text\)\s*\n?\s*TO service_role;/);
});

test("#3606 the schedule no longer rests on one daily dispatch", () => {
  const { all, cron } = watchdogCron(workflow);
  const daily = all.filter((value) => value !== cron);
  assert.equal(daily.length, 2, `two backup crons, got ${all}`);
  assert.ok(daily.includes("23 7 * * *"), "the original daily cron is preserved");

  // The two backup crons must be far apart, or a second cron buys nothing: a
  // pair minutes apart would drift together and fail together.
  const hours = daily.map((value) => Number(value.split(" ")[1])).sort((a, b) => a - b);
  const gap = Math.min(hours[1] - hours[0], 24 - (hours[1] - hours[0]));
  assert.ok(gap >= 8, `backup crons must be at least 8 hours apart, got ${gap}`);
});

test("#3606 the watchdog job exists, reads Actions, and can report", () => {
  const blocks = jobBlocks(workflow);
  const job = blocks.get("recovery_freshness");
  assert.ok(job, "recovery_freshness job exists");
  assert.match(job, /node scripts\/sites\/check-recovery-freshness\.mjs/);
  assert.match(job, /actions: read/);
  assert.match(job, /issues: write/);
  // It must never be handed production recovery credentials: an hourly job with
  // the signing keys is a far larger blast radius than the one it guards.
  for (const secret of [
    "SITES_CMS_MIGRATOR_DATABASE_URL",
    "SITES_BACKUP_ENCRYPTION_KEY_B64",
    "MINGLA_CMS_TO_CORE_CURRENT_KEY_B64",
    "SITES_BACKUP_BLOB_READ_WRITE_TOKEN",
  ]) {
    assert.equal(job.includes(secret), false, `watchdog must not read ${secret}`);
  }
});

test("#3606 the contract lane runs both #3606 suites", () => {
  const contracts = jobBlocks(workflow).get("contracts");
  assert.ok(contracts);
  assert.match(contracts, /issue_3606_recovery_freshness\.implementor\.test\.mjs/);
  assert.match(contracts, /issue_3606_recovery_freshness\.tester\.adversarial\.test\.mjs/);
});
