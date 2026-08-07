// Issue #1647 — the pg_cron watchdog's evaluator.
//
// WHY THIS FILE EXISTS: `refresh_admin_place_pool_mv` failed 4,320 of 4,320 runs
// over 66 days and nothing surfaced it. The fix is a tile on the alert rail, and
// the one thing that must not happen is for the WATCHDOG to inherit the same
// property — reporting green while it knows nothing, or shrugging at a job that
// has been dead for two months.
//
// Every case below is a real production shape:
//   * the exact #1647 signature (0 successes, 66 days stale, timeout text)
//   * an empty/unreadable read, which must be `unknown`, never `healthy`
//   * a one-off blip, which must NOT page anyone
//   * a job that has never succeeded at all (hours_since_success = null)

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CRON_HEALTH_DEFAULTS,
  type CronJobHealthRow,
  evaluateCronJobHealth,
} from "../logic.ts";

function row(over: Partial<CronJobHealthRow> = {}): CronJobHealthRow {
  return {
    jobid: 99,
    jobname: "some_job",
    schedule: "*/10 * * * *",
    runs: 36,
    successes: 36,
    failures: 0,
    consecutive_failures: 0,
    last_success_at: new Date().toISOString(),
    last_failure_at: null,
    last_error: null,
    hours_since_success: 0.2,
    ...over,
  };
}

// The real thing: jobid 13, 6-hour window, 36 runs, 36 failures, last success
// 2026-05-31, "canceling statement due to statement timeout".
const ISSUE_1647_ROW: CronJobHealthRow = row({
  jobid: 13,
  jobname: "refresh_admin_place_pool_mv",
  runs: 36,
  successes: 0,
  failures: 36,
  consecutive_failures: 36,
  last_success_at: "2026-05-31T23:01:00.000Z",
  last_failure_at: "2026-08-05T23:32:00.000Z",
  last_error: "ERROR: canceling statement due to statement timeout",
  hours_since_success: 1584.5, // 66 days
});

Deno.test("#1647 — the exact production signature is DOWN, and says which job and how stale", () => {
  const { status, detail } = evaluateCronJobHealth([ISSUE_1647_ROW, row(), row({ jobid: 7 })]);

  assertEquals(status, "down", "a job failing 36 consecutive runs must be DOWN, not degraded");

  const failing = detail.failing as Array<Record<string, unknown>>;
  assertEquals(failing.length, 1);
  assertEquals(failing[0].job, "refresh_admin_place_pool_mv");
  assertEquals(failing[0].consecutive_failures, 36);
  assertEquals(failing[0].last_success_at, "2026-05-31T23:01:00.000Z");
  assert(
    String(failing[0].last_error).includes("statement timeout"),
    "the operator must be told WHY, not just that something failed",
  );

  // The summary is what lands in the alert email subject/body.
  const summary = String(detail.summary);
  assert(summary.includes("refresh_admin_place_pool_mv"), `summary names no job: ${summary}`);
  assert(summary.includes("66 day"), `summary does not carry the staleness: ${summary}`);
});

Deno.test("#1647 — an unreadable or empty read is UNKNOWN, never healthy", () => {
  assertEquals(evaluateCronJobHealth(null).status, "unknown");
  assertEquals(evaluateCronJobHealth(undefined).status, "unknown");
  assertEquals(evaluateCronJobHealth([]).status, "unknown");

  // Constitution #9 — a probe that learned nothing must not fabricate health.
  // `unknown` also never drives failedTick, so it cannot page anyone either.
  for (const r of [null, undefined, []] as const) {
    assert(
      evaluateCronJobHealth(r).status !== "healthy",
      "an empty read reported as healthy is how a dead job stays invisible",
    );
  }
});

Deno.test("#1647 — every job succeeding is healthy", () => {
  const { status, detail } = evaluateCronJobHealth([row(), row({ jobid: 2 }), row({ jobid: 3 })]);
  assertEquals(status, "healthy");
  assertEquals((detail.failing as unknown[]).length, 0);
  assertEquals((detail.degraded as unknown[]).length, 0);
  assertEquals(detail.jobs, 3);
});

Deno.test("#1647 — a single blip is DEGRADED, not DOWN (one platform incident is not five bugs)", () => {
  // 2026-06-12 hit five unrelated jobs inside twelve minutes. Paging on one
  // failed tick would have cried wolf five times for one incident.
  const { status, detail } = evaluateCronJobHealth([
    row({ jobname: "kick_pending_trial_runs", consecutive_failures: 1, failures: 1, successes: 35 }),
    row(),
  ]);
  assertEquals(status, "degraded");
  assertEquals((detail.failing as unknown[]).length, 0);
  assertEquals((detail.degraded as unknown[]).length, 1);
});

Deno.test("#1647 — the DOWN threshold is the trailing streak, not the lifetime rate", () => {
  // notify-lifecycle-daily is 39.4% failed for its LIFETIME and succeeded today.
  // Reporting it as down would be the false positive that gets alerts ignored.
  const historicallyBad = row({
    jobname: "notify-lifecycle-daily",
    runs: 6,
    successes: 6,
    failures: 0,
    consecutive_failures: 0,
  });
  assertEquals(evaluateCronJobHealth([historicallyBad]).status, "healthy");

  // And the boundary is exact: degradedStreak..downStreak-1 is degraded.
  const atThreshold = row({ consecutive_failures: CRON_HEALTH_DEFAULTS.downStreak });
  assertEquals(evaluateCronJobHealth([atThreshold]).status, "down");
  const belowThreshold = row({ consecutive_failures: CRON_HEALTH_DEFAULTS.downStreak - 1 });
  assertEquals(evaluateCronJobHealth([belowThreshold]).status, "degraded");
});

Deno.test("#1647 — a job that has NEVER succeeded is reported as such, not skipped", () => {
  const { status, detail } = evaluateCronJobHealth([
    row({
      jobname: "never_worked",
      successes: 0,
      failures: 12,
      consecutive_failures: 12,
      last_success_at: null,
      hours_since_success: null,
    }),
  ]);
  assertEquals(status, "down");
  assert(
    String(detail.summary).includes("never succeeded"),
    `a job with no success at all must say so: ${detail.summary}`,
  );
});

Deno.test("#1647 — the worst offender leads the report", () => {
  const { detail } = evaluateCronJobHealth([
    row({ jobname: "mildly_broken", consecutive_failures: 4 }),
    ISSUE_1647_ROW,
    row({ jobname: "also_broken", consecutive_failures: 9 }),
  ]);
  const failing = detail.failing as Array<Record<string, unknown>>;
  assertEquals(failing.length, 3);
  assertEquals(failing[0].job, "refresh_admin_place_pool_mv");
  assertEquals(failing[1].job, "also_broken");
  assertEquals(failing[2].job, "mildly_broken");
});
