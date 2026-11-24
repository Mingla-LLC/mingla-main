// issue #4420 — public-page design audit regressions (implementor).
//
// FAILS-ON-REVERT:
//   - number itinerary dots from stop.stopOrder again → A-1 fails;
//   - phone-web glass header band back below opaque → A-2 fails;
//   - print a trip day's raw "2027-01-27" → A-3 fails;
//   - eyebrow parts joined without keeping short parts whole → A-4 fails;
//   - an ended event keeps "going / are pulling up" and the meter → A-5 fails;
//   - print a place line equal to the venue name under it → A-6 fails.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { formatTripDayDate } from "../tripDayDate.ts";
import { deriveSocialProofMomentum } from "../socialProofMomentum.ts";

const read = (rel: string): string =>
  Deno.readTextFileSync(new URL(rel, import.meta.url));

Deno.test("A-1 the itinerary dot is the stop's position in the list", () => {
  const spine = read("../StopSpine.tsx");
  assert(!spine.includes("stop.stopOrder + 1"), "dot still reads stopOrder");
  assertStringIncludes(spine, "const position = idx + 1;");
  assertStringIncludes(spine, "{position}");
});

Deno.test("A-2 the phone-web glass header band is opaque", () => {
  const shell = read("../ParallaxCoverShell.tsx");
  assertStringIncludes(shell, 'Platform.OS === "web" ? (isDesktop ? (headerBlurred ? 0.72 : 0.78) : 1)');
  // #4490: the phone-web branch is opaque even when the glass material asks
  // for blur, because phone web never applies the blur (desktopBlur(0)).
  assert(!shell.includes("? headerBlurred\n                      ? 0.72"), "phone web band must not drop to 0.72");
});

Deno.test("A-3 a trip day's calendar date is formatted, never raw ISO", () => {
  const out = formatTripDayDate("2027-01-27");
  assert(!out.includes("2027-01-27"), out);
  assert(/27/.test(out), out);
  assertEquals(formatTripDayDate("Day one"), "Day one");
  assertStringIncludes(read("../DayByDay.tsx"), "formatTripDayDate(day.date");
});

Deno.test("A-4 cover eyebrow keeps short facts on one line", () => {
  const identity = read("../OfferingCoverIdentity.tsx");
  assertStringIncludes(identity, 'p.length <= 28 ? p.replace(/ /g, "\\u00A0") : p');
  // and stays readable over a bright photo
  assertStringIncludes(identity, "{ color: soft }, onCover ? styles.titleShadow : null]");
});

Deno.test("A-5 an ended event's going box speaks in the past tense", () => {
  const summary = {
    entityType: "event" as const,
    goingCount: 6,
    capacity: 40,
    hideRemainingCount: false,
  };
  const live = deriveSocialProofMomentum(summary);
  assertEquals(live.countLabel, "going");
  assertEquals(live.clusterNote, "are pulling up");
  const ended = deriveSocialProofMomentum(summary, { ended: true });
  assertEquals(ended.countLabel, "went");
  assertEquals(ended.clusterNote, "were there");
  assertEquals(ended.subLabel, null);
  assertEquals(ended.showMeter, false);
  assertEquals(ended.displayCount, 6);
  assertStringIncludes(read("../EventOfferingBody.tsx"), 'ended={variant === "past"}');
});

Deno.test("A-6 a place line that repeats the venue name is not printed twice", () => {
  const rows = read("../OfferingFactRows.tsx");
  assertStringIncludes(rows, "!sameLine(fact.detail, fact.value)");
  assertStringIncludes(read("../EventOfferingBody.tsx"), "sameLine(venueAddressLabel, event.venueName)");
  assertStringIncludes(read("../RsvpOfferingBody.tsx"), "sameLine(");
});
