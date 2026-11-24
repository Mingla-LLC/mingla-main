// MINGLA-INVARIANT: I-4420-CALENDAR-FROM-REAL-TIMES | issue #4420 | "Add to calendar" appears on a public page only when its public data carries a real start AND a real end (offeringCalendarEntry returns null otherwise, and the surface passes no action). No duration is ever invented.
// MINGLA-INVARIANT: I-4420-INJECTED-GLASS | issue #4420 | The public-page glass (bar, header band, venue tabs) never imports expo-blur from the shared packages; an app may inject a real material through OfferingGlassProvider, and without one the surfaces keep their near-opaque fill.
// issue #4420 wave B — implementor regression (Deno source + pure contracts).
//
// FAILS-ON-REVERT:
//   - let a missing / reversed end produce a calendar entry → C-1;
//   - render "Add to calendar" on the event or RSVP page without the real-data
//     entry → C-3;
//   - import expo-blur into the package glass, or drop the injected backdrop
//     from the bar / header / venue tabs → G-1/G-2;
//   - turn the venue reserve bar back into the old solid button, or let the
//     order bar print a total the server did not price → V-1/V-2;
//   - drop the RSVP confirmed card or its reduced-motion guard → R-1.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { createRequire } from "node:module";

// offeringCalendar is a CommonJS module (one owner, shared with the server
// route api/event-calendar.js), so Deno loads it through createRequire.
const {
  calendarUtcStamp,
  offeringCalendarEntry,
  offeringCalendarIcs,
  offeringGoogleCalendarUrl,
} = createRequire(import.meta.url)("../offeringCalendar.cjs");

const read = (rel: string): string =>
  Deno.readTextFileSync(new URL(rel, import.meta.url));

Deno.test("C-1 no real start and end → no calendar entry", () => {
  assertEquals(offeringCalendarEntry({ title: "Supper", startIso: null, endIso: "2030-01-01T20:00:00Z" }), null);
  assertEquals(offeringCalendarEntry({ title: "Supper", startIso: "2030-01-01T18:00:00Z", endIso: null }), null);
  assertEquals(offeringCalendarEntry({ title: "Supper", startIso: "2030-01-01T18:00:00Z", endIso: "2030-01-01T17:00:00Z" }), null);
  assertEquals(offeringCalendarEntry({ title: "Supper", startIso: "nope", endIso: "2030-01-01T20:00:00Z" }), null);
  assertEquals(offeringCalendarEntry({ title: "  ", startIso: "2030-01-01T18:00:00Z", endIso: "2030-01-01T20:00:00Z" }), null);
});

Deno.test("C-2 a real entry makes a valid ICS and Google link", () => {
  const entry = offeringCalendarEntry({
    title: "Sunday Supper, Club",
    startIso: "2030-12-20T16:00:00.000Z",
    endIso: "2030-12-20T20:00:00.000Z",
    location: "Lagos",
    url: "https://usemingla.com/e/x/y",
  });
  assert(entry !== null);
  assertEquals(calendarUtcStamp(entry.startMs), "20301220T160000Z");
  const ics = offeringCalendarIcs(entry, "id@usemingla.com");
  assertStringIncludes(ics, "DTSTART:20301220T160000Z\r\n");
  assertStringIncludes(ics, "DTEND:20301220T200000Z\r\n");
  assertStringIncludes(ics, "SUMMARY:Sunday Supper\\, Club\r\n");
  assertStringIncludes(ics, "LOCATION:Lagos\r\n");
  const g = offeringGoogleCalendarUrl(entry);
  assertStringIncludes(g, "dates=20301220T160000Z/20301220T200000Z");
  assertStringIncludes(g, "location=Lagos");
});

Deno.test("C-3 the event and RSVP pages offer the action only from the real-data entry", () => {
  const page = read("../../../mingla-business/src/components/event/PublicEventPage.tsx");
  assertStringIncludes(page, "offeringCalendarEntry({");
  assertStringIncludes(page, "startIso: event.masterStartAtUtc ?? null");
  assertStringIncludes(page, "endIso: event.masterEndAtUtc ?? null");
  assertStringIncludes(page, "calendarEntry === null\n      ? undefined");
  assertStringIncludes(page, "{handleAddToCalendar !== undefined ? (");
  // a window with no location (test renderers, embeds) never crashes the page
  assertStringIncludes(page, "window.location != null &&\n              typeof window.location.href === \"string\"");
  const rsvp = read("../RsvpOfferingBody.tsx");
  assertStringIncludes(rsvp, "onAddToCalendar !== undefined\n                ? { label: \"Add to calendar\", onPress: onAddToCalendar }\n                : null");
});

Deno.test("G-1 the package glass never imports expo-blur", () => {
  for (const rel of ["../OfferingGlassContext.tsx", "../OfferingGlassBar.tsx", "../OfferingDecideParts.tsx", "../../brand-rendering/PublicVenueTabs.tsx"]) {
    const src = read(rel);
    assert(!src.includes('from "expo-blur"'), rel);
    assert(!src.includes('from "./GlassBlur"'), rel);
  }
});

Deno.test("R-1 RSVP: confirmed card with a tick that respects reduced motion", () => {
  const d = read("../RsvpMomentumDecision.tsx");
  assertStringIncludes(d, 'testID="issue-4420-rsvp-confirmed-card"');
  assertStringIncludes(d, "const reduceMotion = useReduceMotionPreference();");
  assertStringIncludes(d, "if (reduceMotion) {\n      tickIn.setValue(1);");
  // the going node keeps its contract (label + state) inside the card
  assertStringIncludes(d, "accessibilityState={{ disabled: true, selected: true }}");
});

// ── wave B round 2: stay strip, venue booking controls, native pinned tabs ──

Deno.test("S-1 stay strip: tap check-in then a later day for check-out; earlier tap restarts", async () => {
  // StayDateStrip.tsx imports react-native; its rules are mirrored here
  // against the SAME stayDateRules the field uses, and the source is pinned.
  const rules = await import("../../brand-rendering/stayDateRules.ts");
  const strip = read("../../brand-rendering/StayDateStrip.tsx");
  assertStringIncludes(strip, "applyCheckInChange({ checkIn: range.checkIn, checkOut: \"\" }, day)");
  assertStringIncludes(strip, "applyCheckOutChange(range, day)");
  assertStringIncludes(strip, "compareStayDates(day, bounds.maxCheckOut) <= 0");
  assertStringIncludes(strip, "compareStayDates(day, bounds.maxCheckIn) <= 0");
  assertStringIncludes(strip, "compareStayDates(day, bounds.minCheckIn) < 0");
  // no fabricated per-night price or "booked" state
  assert(!strip.includes("Booked"), "no fabricated booked state");
  assertEquals(rules.applyCheckOutChange({ checkIn: "2030-01-10", checkOut: "" }, "2030-01-13"), {
    checkIn: "2030-01-10",
    checkOut: "2030-01-13",
  });
  assertEquals(rules.applyCheckInChange({ checkIn: "2030-01-10", checkOut: "" }, "2030-01-08"), {
    checkIn: "2030-01-08",
    checkOut: "",
  });
  const booking = read("../../brand-rendering/StayGuestBooking.tsx");
  assert(booking.indexOf("<StayDateStrip") < booking.indexOf("<StayDateRangeField"), "strip sits above the field, which stays");
});

Deno.test("S-2 venue booking: date strip, stepper, time chips and occasion picks on the same state", () => {
  const g = read("../../../mingla-business/src/components/venue/GuestVenueReservation.tsx");
  assertStringIncludes(g, "<OfferingDateStrip");
  assertStringIncludes(g, 'decrementLabel="Decrease party size"');
  // #4490 P5-3: a big party asks availability at the table maximum, and a
  // picked seat narrows it to that space; the call still reads the same state.
  assertStringIncludes(g, "usePublicVenueAvailability(\n    venueId,\n    date,\n    big ? range.tableMax : partySize,\n    seatSpaceId,\n  )");
  assertStringIncludes(g, "submissionTruthRef.current.selectableSlotUtcValues.includes(");
  assertStringIncludes(g, "occasion: occasion.trim() || null");
  assertStringIncludes(g, "setOccasion((current) => (current.trim() === label ? \"\" : label))");
});

