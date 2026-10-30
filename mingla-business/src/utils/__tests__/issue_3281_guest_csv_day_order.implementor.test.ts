/**
 * issue #3281 PR8 — CSV Day cell sorted by date order; pass → All N dates.
 * [TEST-MOD-APPROVED #3281]
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const DAY_ORDER = "mingla-business/src/utils/guestCsvDayOrder.ts";
const GUESTS = "mingla-business/app/event/[id]/guests/index.tsx";

Deno.test("orderDayCell collapses full pass to All N dates and sorts by map order", () => {
  const text = Deno.readTextFileSync(DAY_ORDER);
  assert(text.includes("All ${allIds.length} dates"));
  assert(text.includes("Sort by the event's date order"));
  assert(text.includes("orderDayCellByOccurrence"));
  assert(text.includes("exportGuestsCsvByOccurrence"));
  assert(text.includes("serializeGuestsToCsvByOccurrence"));
  assert(!/labels\.sort\(\)/.test(text));
  const guests = Deno.readTextFileSync(GUESTS);
  assert(guests.includes("exportGuestsCsvByOccurrence"));
  assert(guests.includes("guestCsvDayOrder"));
  assert(!guests.includes("formatDayCell"));
});

Deno.test("guests roster uses Day selector above 7 dates", () => {
  const text = Deno.readTextFileSync(GUESTS);
  assert(text.includes("LazyGuestDaySelector"));
  assert(text.includes("occurrences.length > 7"));
  const selector = Deno.readTextFileSync(
    "mingla-business/src/components/guests/GuestDaySelector.tsx",
  );
  assert(selector.includes("issue-3281-day-selector"));
  assert(selector.includes("occurrenceLocalDay"));
  assert(selector.includes("prevDayFilterRef"));
  assert(selector.includes("monthIndexForDay"));
});
