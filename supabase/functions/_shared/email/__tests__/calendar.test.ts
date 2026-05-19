// ORCH-0877 happy-path regression test #5 — buildCalendarLinks Constitution
// #9 honest end-time. Closes the latent 3-hour DTEND fabrication in ICS
// attachments.
//
// fails-on-revert verified at HEAD aa79f79c39be1bda08396f30dfdb79725d959e19
//   Pre-ORCH-0877 `buildCalendarLinks` defaulted to `DEFAULT_DURATION_HOURS
//   = 3` when endAtIso was null, fabricating DTEND ≈ start+3h on every ICS
//   the email pipeline produced. Revert SPEC §4.2.4 and the "DTEND absent"
//   assertion below fails because the ICS still contains a fabricated
//   DTEND line.
//
// Run with:
//   /Users/sethogieva/.deno/bin/deno test supabase/functions/_shared/email/__tests__/calendar.test.ts

import { buildCalendarLinks } from "../calendar.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

Deno.test("ORCH-0877 — ICS carries real DTEND when endAtIso is provided", () => {
  const links = buildCalendarLinks({
    title: "Saturday Night",
    startAtIso: "2026-05-18T22:00:00.000Z",
    endAtIso: "2026-05-19T02:00:00.000Z",
    locationText: "London",
    isOnline: false,
    description: "A late one.",
  });
  if (links === null) {
    throw new Error("Expected calendar links to render, got null");
  }
  assertStringIncludes(links.icsContent, "DTSTART:20260518T220000Z");
  // DTEND must reflect the REAL end_at, not start+3h (= 2026-05-19T01:00).
  assertStringIncludes(links.icsContent, "DTEND:20260519T020000Z");
});

Deno.test("ORCH-0877 — ICS omits DTEND when endAtIso is null (Constitution #9)", () => {
  const links = buildCalendarLinks({
    title: "Event with unknown end",
    startAtIso: "2026-05-18T22:00:00.000Z",
    endAtIso: null,
    locationText: "Online",
    isOnline: true,
    description: "End time TBD.",
  });
  if (links === null) {
    throw new Error("Expected calendar links to render, got null");
  }
  assertStringIncludes(links.icsContent, "DTSTART:20260518T220000Z");
  // CRITICAL: no DTEND line in the ICS. Pre-ORCH-0877 this contained
  // DTEND:20260519T010000Z (start + 3h fabrication).
  assert(
    !links.icsContent.includes("DTEND:"),
    `Expected ICS to omit DTEND when endAtIso is null. Got: ${links.icsContent}`,
  );
});

Deno.test("ORCH-0877 — returns null when startAtIso is null (graceful degradation)", () => {
  assertEquals(
    buildCalendarLinks({
      title: "x",
      startAtIso: null,
      endAtIso: null,
      locationText: null,
      isOnline: false,
      description: "x",
    }),
    null,
  );
});
