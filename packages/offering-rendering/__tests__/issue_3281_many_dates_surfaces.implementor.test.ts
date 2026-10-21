/**
 * issue #3281 many-dates — Host Dates theme + guest picker wrappers (surfaces).
 * [TEST-MOD-APPROVED #3281] append-only suite.
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (rel: string): string =>
  Deno.readTextFileSync(new URL(`../../../${rel}`, import.meta.url));

Deno.test("Host Dates screen uses discover canvas + pull-to-refresh (no Refresh button)", () => {
  const text = read("mingla-business/app/event/[id]/dates.tsx");
  assert(text.includes("canvas.discover"));
  assert(text.includes("RefreshControl"));
  assert(!text.includes('accessibilityLabel="Refresh dates"'));
  assert(text.includes("Past dates are read-only"));
  assert(text.includes("placeholderTextColor"));
});

Deno.test("Event detail Dates tile is multi_date-only with calendar icon", () => {
  const text = read("mingla-business/app/event/[id]/index.tsx");
  assert(text.includes('whenMode === "multi_date"'));
  assert(text.includes('icon="calendar"'));
  assert(text.includes('label="Dates"'));
});

Deno.test("MultiDateDayChooser deep-imports EventDatePicker (off barrel)", () => {
  const text = read(
    "mingla-business/src/components/event/MultiDateDayChooser.tsx",
  );
  assert(
    text.includes(
      'from "@mingla/offering-rendering/EventDatePicker"',
    ),
  );
  assert(text.includes('testID="issue-2135-day-chooser"'));
  assert(text.includes('occurrenceTestIDPrefix="issue-2135-day-row"'));
});

Deno.test("Explorer EventDayChooser deep-imports EventDatePicker", () => {
  const text = read(
    "app-mobile/src/components/expandedCard/EventDayChooser.tsx",
  );
  assert(
    text.includes(
      'from "@mingla/offering-rendering/EventDatePicker"',
    ),
  );
  assert(text.includes('testID="issue-2230-event-day-chooser"'));
});

Deno.test("EventDatePicker stays off the package barrel", () => {
  const barrel = read("packages/offering-rendering/index.ts");
  assert(!barrel.includes("export { EventDatePicker"));
  assert(!barrel.includes('from "./EventDatePicker"'));
});
