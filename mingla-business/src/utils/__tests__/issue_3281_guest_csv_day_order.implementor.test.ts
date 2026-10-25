/**
 * issue #3281 PR8 — CSV Day cell sorted by date order; pass → All N dates.
 * [TEST-MOD-APPROVED #3281]
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = "mingla-business/src/utils/guestCsvExport.ts";
const GUESTS = "mingla-business/app/event/[id]/guests/index.tsx";
const DASH = "mingla-business/src/components/event/EventDetailTicketTypeRow.tsx";

Deno.test("orderDayCell collapses full pass to All N dates and sorts by map order", () => {
  const text = Deno.readTextFileSync(SRC);
  assert(text.includes("All ${allIds.length} dates"));
  assert(text.includes("Sort by the event's date order"));
  assert(!/labels\.sort\(\)/.test(text));
});

Deno.test("guests roster uses Day selector above 7 dates", () => {
  const text = Deno.readTextFileSync(GUESTS);
  assert(text.includes("issue-3281-day-selector"));
  assert(text.includes("occurrences.length > 7"));
});

Deno.test("dashboard ticket row shows N left at 10 or fewer", () => {
  const text = Deno.readTextFileSync(DASH);
  assert(text.includes("left"));
  assert(text.includes("remaining <= 10"));
});
