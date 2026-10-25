/**
 * issue #3281 PR7 — contentShare carries all occurrences (no 24 cut).
 * [TEST-MOD-APPROVED #3281]
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC = "supabase/functions/_shared/contentShare.ts";

Deno.test("contentShare event occurrences are not sliced at 24", () => {
  const text = Deno.readTextFileSync(SRC);
  // The historical 24-date cut on share occurrences must be gone.
  assert(!/relevantDates \|\| \[\]\)\.slice\(0,\s*24\)/.test(text));
  assert(text.includes("no 24-date cut"));
  assert(text.includes("scheduleLine"));
  assert(text.includes("nextStartAt"));
});

Deno.test("contentShare maps a label per occurrence for the share page", () => {
  const text = Deno.readTextFileSync(SRC);
  assert(text.includes("label:"));
  assertEquals(text.includes("localSchedule(date.start_at"), true);
});
