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

const moreSql = Deno.readTextFileSync(new URL("../20280406024275_issue_4275_cron_stagger_more.sql", import.meta.url));
const moreCode = moreSql.replace(/--.*$/gm, "");

Deno.test("T-D4 the second stagger is static too", () => {
  assert(!/\bEXECUTE\b/i.test(moreCode), "RLS gate C7 refuses dynamic SQL");
});

Deno.test("T-D4 every moved job keeps its cadence, and the time-critical jobs do not move", () => {
  const expected: Array<[string, string]> = [
    ["orch_1161_notify_reminders", "1,6,11,16,21,26,31,36,41,46,51,56 * * * *"],
    ["orch_0788_notification_retry_sweeper", "1,6,11,16,21,26,31,36,41,46,51,56 * * * *"],
    ["keep-functions-warm", "1,6,11,16,21,26,31,36,41,46,51,56 * * * *"],
    ["issue_1389_stay_reservation_sweep", "2,7,12,17,22,27,32,37,42,47,52,57 * * * *"],
    ["issue_4111_enquiry_guest_digest", "2,7,12,17,22,27,32,37,42,47,52,57 * * * *"],
    ["issue_1221_admin_refund_snapshot_cleanup", "3,8,13,18,23,28,33,38,43,48,53,58 * * * *"],
    ["issue_1221_attention_cleanup", "3,8,13,18,23,28,33,38,43,48,53,58 * * * *"],
    ["issue_1221_guest_token_scrub", "3,8,13,18,23,28,33,38,43,48,53,58 * * * *"],
    ["issue_2290_brand_person_ingest_worker", "4,9,14,19,24,29,34,39,44,49,54,59 * * * *"],
    ["issue_3720_product_avengers_reconcile", "4,9,14,19,24,29,34,39,44,49,54,59 * * * *"],
    ["issue_3872_discount_maintenance", "3,18,33,48 * * * *"],
    ["issue_2218_sms_delivery_reconcile", "3,18,33,48 * * * *"],
    ["issue_3988_support_overdue_sweep", "6,21,36,51 * * * *"],
    ["issue_4111_enquiry_nudge", "6,21,36,51 * * * *"],
    ["issue_2491_counter_shadow_observer", "9,24,39,54 * * * *"],
    ["meta_orch_1009_sub_e_expire_agent_pending_actions", "9,24,39,54 * * * *"],
    ["issue_2725_competitor_intel_worker", "12,27,42,57 * * * *"],
    ["orch_1203_rsvp_qr_backfill", "12,27,42,57 * * * *"],
  ];
  for (const [job, schedule] of expected) {
    const at = moreCode.indexOf(`jobname = '${job}'`);
    assert(at >= 0, `${job} is looked up by name`);
    const next = moreCode.indexOf("jobname = ", at + 10);
    const block = moreCode.slice(at, next === -1 ? undefined : next);
    assert(block.includes(`schedule := '${schedule}'`), `${job} gets ${schedule}`);
    assert(block.includes("not found; nothing to reschedule"), `${job} tolerates a missing job`);
    const minutes = schedule.split(" ")[0].split(",").map(Number);
    const cadence = 60 / minutes.length;
    assert(cadence === 5 || cadence === 15, `${job} cadence ${cadence}`);
    minutes.forEach((minute, index) => {
      const gap = (minutes[(index + 1) % minutes.length] - minute + 60) % 60;
      assert(gap === cadence, `${job} has a ${gap} minute gap`);
    });
  }
  for (const unmoved of [
    "issue_1221_source_refund_backstop",
    "issue_2168_checkout_revocation_sweep",
    "orch_1187_reconcile_stuck_checkouts",
    "meta_orch_1009_sub_d_ai_score_rescore_sweep",
  ]) {
    assert(!moreCode.includes(`jobname = '${unmoved}'`), `${unmoved} stays on offset 0`);
  }
});

Deno.test("the admin copy states the place pool view's real cadence", () => {
  assert(code.includes("schedule := '3,33 * * * *'"), "the view refreshes every 30 minutes");
  const root = new URL("../../../mingla-admin/src/", import.meta.url);
  const page = Deno.readTextFileSync(new URL("pages/PlacePoolPage.jsx", root));
  assert(page.includes("Counts refresh every 30 minutes."), "the page says 30");
  const service = Deno.readTextFileSync(new URL("services/systemPagesService.js", root));
  assert(service.includes("refreshes every 30 minutes"), "the service comment says 30");
});
