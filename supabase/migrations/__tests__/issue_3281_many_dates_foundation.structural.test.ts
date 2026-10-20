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
  // Ended multi-date rows must NOT be filtered (F5).
  assert(text.includes("do NOT filter ended multi-date"));
  assertEquals(text.includes("GRANT EXECUTE ON FUNCTION public.issue_3281_event_schedule"), true);
});
