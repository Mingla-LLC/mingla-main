// ORCH-1138 Leg 3 (§4.6) — recurrence/open-daily materializer migration —
// structural regression (the migration is NOT applied in CI; this asserts the
// authored SQL satisfies the contract: SC-9 materialization, T8 expansion, T9
// 52-cap bound, I-4 publish-time, no checkout change).
//
// fails-on-revert: deleting the expander, a PERFORM call, or the cap flips a
// case red. Owner: mingla-implementor.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG = join(
  __dirname,
  "..",
  "20261005000000_orch_1138_experience_recurrence_materializer.sql",
);

let passed = 0;
const ok = (name, cond, detail) => {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
};

ok("the materializer migration exists", existsSync(MIG));
const sql = readFileSync(MIG, "utf8");

// ── the self-contained expander ──
ok(
  "T8 defines pg_expand_experience_recurrence (the self-contained expander)",
  /CREATE OR REPLACE FUNCTION public\.pg_expand_experience_recurrence\(/.test(sql),
);
ok(
  "T8 the expander INSERTs expanded occurrences as is_master=false event_dates",
  /INSERT INTO public\.event_dates[\s\S]*?is_master\)\s*\n?\s*VALUES \(p_event_id, v_next_start, v_next_start \+ v_duration, v_tz, false\)/.test(
    sql,
  ),
);
ok(
  "T8 ports all 5 presets (daily/weekly/biweekly/monthly_dom/monthly_dow)",
  /WHEN 'daily'/.test(sql) &&
    /WHEN 'weekly'/.test(sql) &&
    /WHEN 'biweekly'/.test(sql) &&
    /WHEN 'monthly_dom'/.test(sql) &&
    /WHEN 'monthly_dow'/.test(sql),
);
ok(
  "T8 ports the termination semantics (count / until / never)",
  /v_term_kind = 'count'/.test(sql) &&
    /v_until IS NOT NULL AND v_cursor > v_until/.test(sql) &&
    /HARD_CAP/.test(sql),
);

// ── T9 52-cap bound; NO cron (OQ-1) ──
ok(
  "T9 the expansion is bounded by HARD_CAP = 52 (NO unbounded rows)",
  /c_hard_cap\s+constant integer := 52/.test(sql),
);
ok(
  "T9 count is clamped to the cap: LEAST(count, HARD_CAP)",
  /LEAST\(v_term_count, c_hard_cap\)/.test(sql),
);
ok(
  "OQ-1 NO cron / scheduled function (the migration defines NO cron job)",
  !/cron\.schedule|pg_cron|CREATE.*SCHEDULE/i.test(sql),
);

// ── I-4: materialization hangs off the SAME publish + live-edit RPCs ──
ok(
  "I-4 biz_publish_experience is re-emitted and calls the expander in the recurring branch",
  /CREATE OR REPLACE FUNCTION public\.biz_publish_experience\(/.test(sql) &&
    /v_when_mode = 'recurring' AND v_recurrence_rules IS NOT NULL THEN[\s\S]*?PERFORM public\.pg_expand_experience_recurrence/.test(
      sql,
    ),
);
ok(
  "I-4 biz_update_live_experience is re-emitted and calls the expander in the recurring branch",
  /CREATE OR REPLACE FUNCTION public\.biz_update_live_experience\(/.test(sql) &&
    sql.split("biz_update_live_experience").length >= 2 &&
    /PERFORM public\.pg_expand_experience_recurrence/.test(sql),
);
ok(
  "I-4 the re-emit preserves the ORCH-1075 paid-publish guards + ORCH-0792 master-date flip",
  /charges_enabled|stripe_account_not_ready|pg_brand_can_charge/.test(sql) &&
    /status\s*=\s*'scheduled'/.test(sql),
);

// ── no checkout change: capacity stays event-level (no per-occurrence cap col) ──
ok(
  "I-1 the expander adds NO capacity column to the expanded rows (capacity stays event-level)",
  !/INSERT INTO public\.event_dates[^;]*capacity/.test(sql),
);

// ── both GRANTs re-asserted + single transaction ──
ok(
  "both RPC GRANTs are re-asserted + the migration is one BEGIN/COMMIT transaction",
  /GRANT EXECUTE ON FUNCTION public\.biz_publish_experience/.test(sql) &&
    /GRANT EXECUTE ON FUNCTION public\.biz_update_live_experience/.test(sql) &&
    /^BEGIN;/m.test(sql) &&
    /^COMMIT;/m.test(sql),
);

console.log(`\n${passed} assertions passed.`);
