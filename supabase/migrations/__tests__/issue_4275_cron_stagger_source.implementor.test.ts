// Issue #4275 T-D2 — the cron migration stays static and carries every schedule.
//
// The behaviour after replay is T-D1 in issue_4275_cron_stagger.implementor.pg17.test.sql.
//
// FAILS-ON-REVERT: edit a schedule or add dynamic SQL and this fails.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = Deno.readTextFileSync(new URL("../20280406014275_issue_4275_cron_stagger.sql", import.meta.url));
const code = sql.replace(/--.*$/gm, "");

Deno.test("T-D2 no dynamic SQL", () => {
  assert(!/\bEXECUTE\b/i.test(code), "RLS gate C7 refuses dynamic SQL");
});

Deno.test("T-D2 every job has its literal schedule, on a minute of its own", () => {
  const expected: Array<[string, string]> = [
    ["kick_pending_thumb_backfill", "1,11,21,31,41,51 * * * *"],
    ["issue_1179_cancel_refund_fanout_backstop", "2,12,22,32,42,52 * * * *"],
    ["refresh_admin_place_pool_mv", "3,33 * * * *"],
    ["issue_3197_public_search_converged", "4,14,24,34,44,54 * * * *"],
    ["crm_reconcile_live", "6,16,26,36,46,56 * * * *"],
    ["ops_reconcile", "7,17,27,37,47,57 * * * *"],
    ["issue_4073_city_watch_scan", "8,18,28,38,48,58 * * * *"],
  ];
  for (const [job, schedule] of expected) {
    const at = code.indexOf(`jobname = '${job}'`);
    assert(at >= 0, `${job} is looked up by name`);
    const next = code.indexOf("jobname = ", at + 10);
    const block = code.slice(at, next === -1 ? undefined : next);
    assert(block.includes(`schedule := '${schedule}'`), `${job} gets ${schedule}`);
    assert(block.includes("not found; nothing to reschedule"), `${job} tolerates a missing job with a notice`);
  }
});
