// issue #3281 Experience Round 1 PR 1c — source-level implementor pins.
//
// Run:
//   deno test --allow-read supabase/functions/__tests__/issue_3281_live_edit_keeps_date_ids.implementor.test.ts
//
// Pins the migration + Ari lift that the pg17 suites execute. Fails on revert of
// reconcile-in-place, the top-up status fix, or the Ari "do not pre-refuse live
// date edits" guidance.
//
// DRAFT invariant I-PROPOSED-3281-LIVE-EDIT-KEEPS-DATE-IDS is declared in the
// migration header and the pg17 happy suite (registry frozen).

import { assert } from "jsr:@std/assert@1";

const migration = await Deno.readTextFile(
  "supabase/migrations/20271026003801_issue_3281_live_edit_keeps_date_ids.sql",
);
const prompt = await Deno.readTextFile(
  "supabase/functions/_shared/agentSystemPrompt.ts",
);
const domain = await Deno.readTextFile(
  "supabase/functions/_shared/agentDomainTools.ts",
);

function liveExperienceBody(sql: string): string {
  const match = sql.match(
    /CREATE OR REPLACE FUNCTION public\.biz_update_live_experience[\s\S]*?AS \$function\$([\s\S]*?)\$function\$/,
  );
  assert(match !== null, "biz_update_live_experience is re-emitted in 1c");
  return match![1];
}

const body = liveExperienceBody(migration);

Deno.test("1c-01 live-edit no longer wholesale-deletes event_dates or experience_stops", () => {
  assert(
    !/DELETE FROM public\.event_dates WHERE event_id = p_event_id/.test(body),
    "must not DELETE all event_dates",
  );
  assert(
    !/DELETE FROM public\.experience_stops WHERE event_id = p_event_id/.test(
      body,
    ),
    "must not DELETE all experience_stops",
  );
  assert(
    /issue_3285_event_date_hold_reason/.test(body),
    "held dates use issue_3285_event_date_hold_reason",
  );
});

Deno.test("1c-02 #3827 notice hunks and sold-ticket refusals are preserved", () => {
  assert(/event_edit_notice_flush/.test(body), "notice flush kept");
  assert(/buyer_notice/.test(body), "buyer_notice return key kept");
  assert(/dates_shifted_with_sales/.test(body), "date shift refusal kept");
  assert(/stop_removed_with_sales/.test(body), "stop removal refusal kept");
  assert(/price_change_with_sales/.test(body), "price refusal kept");
});

Deno.test("1c-03 F-A top-up includes live, not published", () => {
  assert(
    /e\.status IN \('scheduled','live'\)/.test(migration),
    "top-up status filter is scheduled|live",
  );
  assert(
    !/e\.status IN \('scheduled','published'\)/.test(migration),
    "top-up must not filter on published",
  );
});

Deno.test("1c-04 expander skips existing starts", () => {
  assert(
    /issue #3281 1c: skip starts that already exist/.test(migration),
    "expander skip-existing hunk present",
  );
});

Deno.test("1c-05 Ari lifts the pre-emptive live-date-edit refusal", () => {
  assert(
    /do not invent a pre-emptive "I can't change dates when there are orders" block/
      .test(prompt),
    "EXPERIENCE RULES must not pre-refuse date edits when orders exist",
  );
  assert(
    /do not pre-refuse date edits merely because orders exist/.test(domain),
    "update_experience tool description lifts the pre-refusal",
  );
});
