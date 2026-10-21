/**
 * issue #3281 many-dates foundation — structural pins on the migration.
 * [TEST-MOD-APPROVED #3281]
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION =
  "supabase/migrations/20271124003281_issue_3281_many_dates_foundation.sql";

Deno.test("many-dates foundation migration ships schedule helper + bundle keys", () => {
  const text = Deno.readTextFileSync(MIGRATION);
  assert(text.includes("issue_3281_event_schedule"));
  assert(text.includes("'allDaysPass'"));
  assert(text.includes("'nextStartAt'"));
  assert(text.includes("'upcomingCount'"));
  assert(text.includes("'overrideTitle'"));
  assert(text.includes("'placesLeftByTicket'"));
  assert(text.includes("business_set_event_date_override"));
  assert(text.includes("override_title"));
  // F5 — multi-date rows keep the same end_at filter as #3313 recurring-only.
  assert(
    /NOT \(COALESCE\(ev\.is_recurring,\s*false\) AND NOT COALESCE\(ev\.is_multi_date,\s*false\)\)\s*OR d\.end_at > now\(\)/
      .test(text),
  );
  // #3284 R-15 — refundPolicy remains the final json key (no trailing comma).
  assert(/'recurrenceRule'[\s\S]*?'refundPolicy',\s*ev\.refund_policy\s*\) END/.test(text));
  assert(!/'refundPolicy'[\s\S]*?'recurrenceRule'/.test(
    text.slice(text.indexOf("'allDaysPass'"), text.indexOf("$function$;"))
  ));
  assertEquals(
    text.includes("GRANT EXECUTE ON FUNCTION public.issue_3281_event_schedule"),
    true,
  );
  assert(text.includes("is_supported_offering_currency"));
  // 0e9c26165 — Host Dates (business_set_event_date_override) owns per-date
  // title/place; When-save must never write them.
  const patchWhenStart = text.indexOf("FUNCTION public.business_patch_event_when");
  assert(patchWhenStart >= 0);
  const patchWhen = text
    .slice(patchWhenStart, text.indexOf("$function$;", patchWhenStart))
    .replace(/--.*$/gm, "");
  assert(!/override_title|override_location/.test(patchWhen));
  // Schedule helper evaluated once per bundle row.
  assert(text.includes("LEFT JOIN LATERAL"));
  assertEquals(
    (text.match(/issue_3281_event_schedule\(ev\.id\)/g) ?? []).length,
    1,
  );
});
