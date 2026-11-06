// Issue #4275 tester adversarial — the cron stagger against the job list read from
// production cron.job on 2026-11-05. The implementor's suites check the migrated
// schedules one by one. This one recomputes what they add up to, across every
// minute of a week, and that no job's cadence or a payment backstop's minute moved.
//
// FAILS-ON-REVERT, each proven at the tester commit recorded on #4275:
//   - put any moved job back on `*/5` or `*/15`: "starts per minute" fails.
//   - give a job an uneven minute list: "cadence" fails.
//   - schedule a refund, revocation or stuck-checkout job in either migration:
//     "backstops" fails.
//   - remove a job from the migrations: "every job on the shared minutes" fails.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const here = new URL(".", import.meta.url);
const read = (name: string) => Deno.readTextFileSync(new URL(`../${name}`, here));

const MIGRATIONS = ["20280406014275_issue_4275_cron_stagger.sql", "20280406024275_issue_4275_cron_stagger_more.sql"];

// `count x schedule` of production jobs NOT named in either migration.
const UNMOVED: Array<[number, string]> = [
  [13, "* * * * *"],
  [2, "*/15 * * * *"], // meta_orch_1009_sub_d rescore, orch_1187 stuck checkouts
  [2, "*/5 * * * *"], // issue_1221 source refund, issue_2168 revocation
  [1, "*/20 * * * *"],
  [3, "*/30 * * * *"],
  [5, "0 * * * *"],
  [2, "0 */6 * * *"],
  [1, "0 10 * * *"],
  [1, "0 3 * * *"],
  [1, "0 3 * * 0"],
  [1, "0 4 1 */3 *"],
  [1, "0 6 * * 1"],
  [3, "0 9 * * *"],
  [2, "15 * * * *"],
  [1, "15 1 * * *"],
  [1, "15 10 * * *"],
  [1, "15 9 * * *"],
  [2, "17 * * * *"],
  [5, "17 3 * * *"],
  [1, "17 4 * * *"],
  [1, "20 0 * * *"],
  [1, "23 * * * *"],
  [1, "23 */6 * * *"],
  [1, "30 4 * * 0"],
  [1, "37 * * * *"],
  [1, "37 14 * * *"],
  [1, "40 3 * * *"],
  [1, "41 * * * *"],
  [1, "47 3 * * *"],
  [1, "50 3 * * *"],
];

const ON_SHARED_MINUTES: Record<string, number> = {
  crm_reconcile_live: 10,
  issue_1179_cancel_refund_fanout_backstop: 10,
  issue_3197_public_search_converged: 10,
  issue_4073_city_watch_scan: 10,
  kick_pending_thumb_backfill: 10,
  ops_reconcile: 10,
  refresh_admin_place_pool_mv: 30, // the one cadence change, decided on #4275
  issue_2218_sms_delivery_reconcile: 15,
  issue_2491_counter_shadow_observer: 15,
  issue_2725_competitor_intel_worker: 15,
  issue_3872_discount_maintenance: 15,
  issue_3988_support_overdue_sweep: 15,
  issue_4111_enquiry_nudge: 15,
  meta_orch_1009_sub_e_expire_agent_pending_actions: 15,
  orch_1203_rsvp_qr_backfill: 15,
  issue_1221_admin_refund_snapshot_cleanup: 5,
  issue_1221_attention_cleanup: 5,
  issue_1221_guest_token_scrub: 5,
  issue_1389_stay_reservation_sweep: 5,
  issue_2290_brand_person_ingest_worker: 5,
  issue_3720_product_avengers_reconcile: 5,
  issue_4111_enquiry_guest_digest: 5,
  "keep-functions-warm": 5,
  orch_0788_notification_retry_sweeper: 5,
  orch_1161_notify_reminders: 5,
};

const BACKSTOPS_THAT_MUST_NOT_MOVE = [
  "issue_1221_source_refund_backstop",
  "issue_2168_checkout_revocation_sweep",
  "orch_1187_reconcile_stuck_checkouts",
  "issue_1171_payout_release_dark_sweep",
  "issue_3872_payee_payout_sweep",
  "orch_1331_partner_paystack_split_retry",
];

function migrated(): Map<string, string> {
  const found = new Map<string, string>();
  for (const name of MIGRATIONS) {
    const text = read(name);
    for (const match of text.matchAll(/WHERE jobname = '([^']+)';[\s\S]*?schedule := '([^']+)'/g)) {
      assert(!found.has(match[1]), `${match[1]} scheduled twice`);
      found.set(match[1], match[2]);
    }
  }
  return found;
}

function field(text: string, low: number, high: number): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const match = part.match(/^(\*|\d+)(?:\/(\d+))?$/);
    assert(match, `unparsed cron field ${part}`);
    const from = match[1] === "*" ? low : Number(match[1]);
    const to = match[1] === "*" ? high : Number(match[1]);
    for (let value = from; value <= to; value += Number(match[2] ?? 1)) out.add(value);
  }
  return out;
}

function expand(schedule: string) {
  const [minute, hour, dom, month, dow] = schedule.split(" ");
  return {
    minute: field(minute, 0, 59),
    hour: field(hour, 0, 23),
    dom: field(dom, 1, 31),
    month: field(month, 1, 12),
    dow: field(dow, 0, 6),
  };
}

Deno.test("every job on the shared minutes is moved, under its name, with a static schedule", () => {
  const jobs = migrated();
  assertEquals([...jobs.keys()].sort(), Object.keys(ON_SHARED_MINUTES).sort());
  for (const name of MIGRATIONS) {
    const text = read(name);
    assert(!/\bEXECUTE\b/.test(text), `${name} must stay static`);
    assert(!/command\s*:=/.test(text), `${name} must not touch a job's command`);
    assert(!/cron\.(un)?schedule\s*\(/.test(text), `${name} must alter, not recreate`);
  }
});

Deno.test("cadence: each moved job's minutes are evenly spaced at its own interval, around the hour", () => {
  for (const [name, schedule] of migrated()) {
    const [minute, ...rest] = schedule.split(" ");
    assertEquals(rest.join(" "), "* * * *", `${name} runs every hour`);
    const minutes = minute.split(",").map(Number);
    const interval = ON_SHARED_MINUTES[name];
    assertEquals(minutes.length, 60 / interval, `${name} run count`);
    minutes.forEach((value, index) => {
      const next = index + 1 < minutes.length ? minutes[index + 1] : minutes[0] + 60;
      assertEquals(next - value, interval, `${name} gap after :${value}`);
    });
  }
});

Deno.test("backstops: refund, revocation, stuck-checkout and payout jobs are not in either migration", () => {
  const all = MIGRATIONS.map(read).join("\n");
  for (const job of BACKSTOPS_THAT_MUST_NOT_MOVE) {
    assert(!all.includes(`jobname = '${job}'`), `${job} must not move`);
  }
});

Deno.test("the seven */10 jobs: at most one per minute and none on a :x0 or :x5", () => {
  const jobs = migrated();
  const ten = Object.entries(ON_SHARED_MINUTES).filter(([, interval]) => interval === 10 || interval === 30).map(([name]) => name);
  assertEquals(ten.length, 7);
  const seen = new Set<number>();
  for (const name of ten) {
    for (const minute of expand(jobs.get(name)!).minute) {
      assert(minute % 5 !== 0, `${name} on :${minute}`);
      assert(!seen.has(minute), `two of the seven on :${minute}`);
      seen.add(minute);
    }
  }
});

Deno.test("starts per minute across a year stay well under the 32 running job cap", () => {
  const jobs = [...migrated().values()].map((schedule) => ({ count: 1, cron: expand(schedule) }));
  for (const [count, schedule] of UNMOVED) jobs.push({ count, cron: expand(schedule) });
  assertEquals(jobs.reduce((sum, job) => sum + job.count, 0), 84, "the production list had 84 jobs");

  let worst = 0;
  let worstOrdinaryHour = 0;
  const start = Date.UTC(2026, 10, 1);
  for (let day = 0; day < 366; day += 1) {
    const date = new Date(start + day * 86_400_000);
    const today = jobs.filter(({ cron }) =>
      cron.dom.has(date.getUTCDate()) && cron.month.has(date.getUTCMonth() + 1) && cron.dow.has(date.getUTCDay())
    );
    for (let hour = 0; hour < 24; hour += 1) {
      const thisHour = today.filter(({ cron }) => cron.hour.has(hour));
      for (let minute = 0; minute < 60; minute += 1) {
        const starts = thisHour.reduce((sum, job) => sum + (job.cron.minute.has(minute) ? job.count : 0), 0);
        worst = Math.max(worst, starts);
        if (hour === 13) worstOrdinaryHour = Math.max(worstOrdinaryHour, starts);
      }
    }
  }
  assertEquals(worstOrdinaryHour, 26, "the :00 peak of an ordinary hour (was 51)");
  assertEquals(worst, 29, "the worst minute of the year, 09:00 UTC (was 54)");
});
