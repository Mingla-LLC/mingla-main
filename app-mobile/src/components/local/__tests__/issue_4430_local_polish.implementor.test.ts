// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// MINGLA-INVARIANT: I-4430-L5 | issue #4430 | a Local month that is submitted reads "Mingla is checking your review" in the app, never the doubled "Review in review"
// MINGLA-INVARIANT: I-4430-L6 | issue #4430 | the change-request deadline shows the date and the time in the phone's own time, with no zone name and never the word undefined
// MINGLA-INVARIANT: I-4430-L7 | issue #4430 | while one Pick is in flight every Pick button is disabled, and a duplicate-month unique violation refreshes the saved pick instead of showing an error
//
// FAILS-ON-REVERT: restoring the old words, a date-only deadline, per-row busy-only Pick buttons,
// or an unmapped duplicate-month error fails here.
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { localMonthWords } from "../localWords.ts";
import { changesCardWords } from "../localReviewDraft.ts";
import { isMonthAlreadyPicked } from "../localPick.ts";
import { formatInZone } from "../../../utils/programFormat.ts";
import { toProgramError } from "../../../services/programResult.ts";

const app = new URL("../../../../../", import.meta.url);
const read = (p: string): string => Deno.readTextFileSync(new URL(p, app));

Deno.test("#4430 L-5: submitted reads as Mingla checking the review", () => {
  assertEquals(localMonthWords("submitted"), "Mingla is checking your review");
  assert(!read("app-mobile/src/components/local/localWords.ts").includes("Review in review"));
});

Deno.test("#4430 L-6: the due line has date and time, the ended line is unchanged, no zone slug", () => {
  const now = new Date(2026, 10, 14, 12);
  const f = (v: string, at: Date) => formatInZone(v, null, at);
  const w = changesCardWords({ changes_due_at: "2026-11-20T10:00:00Z" }, ["x"], now, f);
  assert(/^Send your update by \w{3} Nov \d{1,2}, \d{1,2}:\d{2} (AM|PM)\.$/.test(w.line), w.line);
  assert(!/undefined|NaN|Africa|Europe|time\./.test(w.line), w.line);
  const ended = changesCardWords({ changes_due_at: "2026-11-20T10:00:00Z" }, ["x"], new Date("2026-11-21T00:00:00Z"), f);
  assertEquals(ended.line, "The time to update this review has ended.");
  assertEquals(changesCardWords({}, [], now, f).line, "Send your update soon.");
  assertEquals(formatInZone("not a date", null, now), "");
});

Deno.test("#4430 L-6: source guard — home card and review form both use formatInZone with no zone", () => {
  const index = read("app-mobile/app/local/index.tsx");
  const review = read("app-mobile/app/local/review.tsx");
  assert(index.includes("formatInZone(value, null, at)"));
  assert(review.includes("formatInZone(month.changes_due_at, null)"));
});

Deno.test("#4430 L-7: duplicate-month unique violation is recognised, other refusals are not", () => {
  assert(isMonthAlreadyPicked({ code: "23505", message: 'duplicate key value violates unique constraint "local_months_local_id_month_key"' }));
  assert(isMonthAlreadyPicked({ code: "23505", message: "x", details: "Key (local_id, month)=(1, 2026-11-01) already exists. local_months" }));
  assert(isMonthAlreadyPicked(new Error('duplicate key value violates unique constraint "local_months_local_id_month_key"')));
  assert(isMonthAlreadyPicked(toProgramError({ code: "23505", message: 'duplicate key value violates unique constraint "local_months_local_id_month_key"' })));
  assert(!isMonthAlreadyPicked(toProgramError(new Error("pick_window_closed"))));
  assert(!isMonthAlreadyPicked({ code: "pick_window_closed" }));
  assert(!isMonthAlreadyPicked({ code: "23505", message: 'duplicate key value violates unique constraint "other_pkey"' }));
  assert(!isMonthAlreadyPicked(null));
  assert(!isMonthAlreadyPicked(undefined));
  assert(!isMonthAlreadyPicked("boom"));
});

Deno.test("#4430 L-7: source guard — every Pick is disabled while any pick is busy, duplicate refreshes", () => {
  const index = read("app-mobile/app/local/index.tsx");
  assert(index.includes("const anyBusy = busyId !== null;"));
  assert(index.includes("disabled={anyBusy}"));
  assert(/isMonthAlreadyPicked\(e\)\) await onPicked\(\)/.test(index));
});
