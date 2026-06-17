// ORCH-1153 WS2 — shared rule-based open-daily detector regression
// (implementor-owned happy-path). Deno-runnable (experienceOpenDaily.ts is pure,
// dep-free — no RN imports).
//
// THE FIX (F-5): the consumer used an occurrence-density heuristic while the
// buyer-web /exp/ page used the recurrence RULE, so the SAME experience could
// classify differently per surface. The canonical owner is now the rule-based
// isOpenDailyExperience: open-daily ⇔ is_recurring && preset==='daily' &&
// termination.kind==='never'. Both surfaces consume it.
//
// FAILS-ON-REVERT: change the predicate to accept any recurring (drop the
// daily/never gate) → the "weekly recurring" and "daily count-terminated" cases
// below flip to true and this test FAILS. Verified by true line-deletion in the
// implementation report.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { isOpenDailyExperience } from "../experienceOpenDaily.ts";

// 1) GENUINE OPEN-DAILY: recurring daily/never (the QA fixture + the backfilled
//    casualty b8bd995b…). → restaurant-style date+time+party picker.
Deno.test("daily/never recurring → open-daily true", () => {
  assert(
    isOpenDailyExperience({
      isRecurring: true,
      recurrenceRule: { preset: "daily", termination: { kind: "never" } },
    }),
  );
});

// 2) NOT recurring → never open-daily (single / multi-date experiences).
Deno.test("non-recurring → open-daily false", () => {
  assertEquals(
    isOpenDailyExperience({ isRecurring: false, recurrenceRule: null }),
    false,
  );
});

// 3) Recurring but NOT daily (weekly) → false (use the flat slot list).
Deno.test("weekly recurring → open-daily false", () => {
  assertEquals(
    isOpenDailyExperience({
      isRecurring: true,
      recurrenceRule: {
        preset: "weekly",
        termination: { kind: "never" },
      },
    }),
    false,
  );
});

// 4) Daily but TERMINATED (count/until) → false (a finite series is not "open
//    daily forever").
Deno.test("daily but count-terminated → open-daily false", () => {
  assertEquals(
    isOpenDailyExperience({
      isRecurring: true,
      recurrenceRule: { preset: "daily", termination: { kind: "count" } },
    }),
    false,
  );
});

// 5) recurring=true but rule missing/undefined (shape anomaly / cold deep-link)
//    → false (safe default, no fabrication).
Deno.test("recurring with null rule → open-daily false", () => {
  assertEquals(
    isOpenDailyExperience({ isRecurring: true, recurrenceRule: null }),
    false,
  );
  assertEquals(
    isOpenDailyExperience({ isRecurring: true, recurrenceRule: undefined }),
    false,
  );
});
