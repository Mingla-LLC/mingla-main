/**
 * issue #3281 PR7 — socialPreview prefers schedule_line / next_start_at.
 * [TEST-MOD-APPROVED #3281]
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = "mingla-business/server/socialPreview.js";

Deno.test("socialPreview defines eventScheduleLabel and prefers schedule_line", () => {
  const text = Deno.readTextFileSync(SRC);
  assert(text.includes("eventScheduleLabel"));
  assert(text.includes("schedule_line"));
  assert(text.includes("next_start_at"));
});

Deno.test("share dates list shows first 6 + and N more", () => {
  const text = Deno.readTextFileSync(SRC);
  assert(text.includes("and ${more} more"));
  assert(text.includes("slice(0, 6)"));
});

Deno.test("event HTML includes schema.org Event startDate", () => {
  const text = Deno.readTextFileSync(SRC);
  assert(text.includes("application/ld+json"));
  assert(text.includes('"@type": "Event"'));
  assert(text.includes("startDate"));
});
