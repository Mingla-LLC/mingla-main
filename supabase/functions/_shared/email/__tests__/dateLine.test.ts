// ORCH-0877 happy-path regression test #4 — formatEventDateLine (server-side
// email date formatter). Exercises same-day, cross-midnight, and null-end
// branches.
//
// fails-on-revert verified at HEAD aa79f79c39be1bda08396f30dfdb79725d959e19
//   Pre-ORCH-0877 `formatEventDateLine` accepted only `(startAtIso, timezone)`.
//   Calling with the new 3-arg signature triggers a TS compile error and the
//   `endAtIso` branch is unreachable. Revert SPEC §4.2.3 and the cross-
//   midnight assertion below fails because the output never contains the
//   end-side weekday + time.
//
// Run with:
//   /Users/sethogieva/.deno/bin/deno test supabase/functions/_shared/email/__tests__/dateLine.test.ts

import { formatEventDateLine } from "../dateLine.ts";
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

Deno.test("ORCH-0877 — start-only when endAtIso is null", () => {
  const out = formatEventDateLine(
    "2026-05-18T22:00:00.000Z",
    null,
    "UTC",
  );
  // Should render start only with year + tz suffix.
  assertStringIncludes(out, "10:00 PM");
  // No range separator when end is absent.
  if (out.includes(" – ")) {
    throw new Error(`Unexpected range separator in null-end output: ${out}`);
  }
});

Deno.test("ORCH-0877 — returns empty string when startAtIso is null", () => {
  assertEquals(formatEventDateLine(null, null, "UTC"), "");
  assertEquals(formatEventDateLine(undefined, null, "UTC"), "");
});

Deno.test("ORCH-0877 — same-day inline range with uppercase AM/PM", () => {
  // 10 PM → 11 PM in UTC, same calendar day.
  const out = formatEventDateLine(
    "2026-05-18T22:00:00.000Z",
    "2026-05-18T23:00:00.000Z",
    "UTC",
  );
  assertStringIncludes(out, "10:00 PM");
  assertStringIncludes(out, "11:00 PM");
  assertStringIncludes(out, " – ");
});

Deno.test("ORCH-0877 — cross-midnight with weekday prefix on both sides", () => {
  // 10 PM Mon May 18 UTC → 2 AM Tue May 19 UTC.
  const out = formatEventDateLine(
    "2026-05-18T22:00:00.000Z",
    "2026-05-19T02:00:00.000Z",
    "UTC",
  );
  // Both weekdays present.
  assertStringIncludes(out, "Mon");
  assertStringIncludes(out, "Tue");
  assertStringIncludes(out, "10:00 PM");
  assertStringIncludes(out, "2:00 AM");
});
