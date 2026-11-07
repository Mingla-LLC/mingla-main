/**
 * issue #3281 (bundle 2b, #3645) — the checkout edge never sells a cancelled
 * date, and an all-days pass with one date cancelled keeps selling the rest.
 *
 * The database refuses a cancelled date (issue_3872_checkout_day_context,
 * issue_1930_ticket_session_authorized; proofs in
 * supabase/migrations/__tests__/issue_3645_sell_publish_integrity.pg17.test.sql).
 * These checks pin the edge half:
 *   - every event_dates read that decides what can be sold filters
 *     status = 'active' (or refuses a non-active chosen date);
 *   - the all-days pass expands only the dates still on, so one cancelled
 *     date does not make every later checkout fail;
 *   - a database `occurrence_not_available` reaches the buyer as that token
 *     with HTTP 422 (the apps' re-pick path), not as checkout_quote_failed /
 *     checkout_session_failed 409.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

function between(start: string, end: string, from = 0): string {
  const a = src.indexOf(start, from);
  assert(a >= 0, `missing: ${start}`);
  const b = src.indexOf(end, a + start.length);
  assert(b > a, `missing after ${start}: ${end}`);
  return src.slice(a, b);
}

Deno.test("#3281 the event must still have an active upcoming date", () => {
  const block = between("const { count: futureDateCount", "event_no_active_dates");
  assert(block.includes('.eq("status", "active")'), "future-date count ignores cancelled dates");
});

Deno.test("#3281 every upcoming date cancelled answers occurrence_not_available, not event_no_active_dates", () => {
  const block = between("const { count: futureDateCount", "// ORCH-1072");
  const cancelledAt = block.indexOf('.eq("status", "cancelled")');
  const tokenAt = block.indexOf('refuse({ error: "occurrence_not_available" }, 422)');
  const oldAt = block.indexOf('refuse({ error: "event_no_active_dates" }, 422)');
  assert(cancelledAt > 0, "no lookup of cancelled upcoming dates");
  assert(tokenAt > cancelledAt && oldAt > tokenAt, "cancelled-only must answer occurrence_not_available before event_no_active_dates");
});

Deno.test("#3281 a single chosen occurrence that is cancelled is refused", () => {
  const block = between("if (eventDateId !== null) {", "// ═══");
  assert(block.includes('.select("id, end_at, status")'));
  assert(/status !== "active"\)[\s\S]{0,160}occurrence_not_available/.test(block));
});

Deno.test("#3281 the all-days pass covers only the dates still on", () => {
  const block = between("if (allDaysPass) {", "const upcoming = rows");
  assert(block.includes('.eq("status", "active")'), "all-days expansion includes cancelled dates");
});

Deno.test("#3281 a chosen day set with a cancelled day is refused", () => {
  const block = between("if (orderedEventDateIds.length === 0 && eventDateIds.length > 0) {", "orderedEventDateIds.push(");
  assert(block.includes('.select("id, end_at, status")'));
  assert(block.includes('row.status !== "active"'));
  assert(block.includes('occurrence_not_available'));
});

Deno.test("#3281 quote forwards occurrence_not_available as 422 before the generic failure", () => {
  const block = between("const quote = await loadTicketQuote();", 'error: "checkout_quote_failed"');
  assert(/detail\.includes\("occurrence_not_available"\)[\s\S]{0,120}refuse\(\{ error: "occurrence_not_available" \}, 422\)/.test(block));
});

Deno.test("#3281 session creation forwards occurrence_not_available as 422 before the generic failure", () => {
  const generic = 'return jsonResponse(\n        { error: "checkout_session_failed", detail: sessionError?.message },\n        409,\n      );\n    }';
  const at = src.indexOf(generic);
  assert(at > 0, "generic session failure not found");
  const before = src.slice(Math.max(0, at - 600), at);
  assert(/sessionError\.message\.includes\("occurrence_not_available"\)[\s\S]{0,80}refuse\(\{ error: "occurrence_not_available" \}, 422\)/.test(before));
  assertEquals(src.split('includes("occurrence_not_available")').length - 1, 2);
});
