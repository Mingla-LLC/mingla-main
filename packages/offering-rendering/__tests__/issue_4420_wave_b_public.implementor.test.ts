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

import {
  calendarUtcStamp,
  offeringCalendarEntry,
  offeringCalendarIcs,
  offeringGoogleCalendarUrl,
} from "../offeringCalendar.ts";

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

Deno.test("G-2 bar, header band and venue tabs mount the injected backdrop", () => {
  assertStringIncludes(read("../OfferingGlassBar.tsx"), "<OfferingGlassBackdrop radius={999}");
  assertStringIncludes(read("../ParallaxCoverShell.tsx"), "<OfferingGlassBackdrop radius={0}");
  assertStringIncludes(read("../../brand-rendering/PublicVenueTabs.tsx"), "<OfferingGlassBackdrop radius={999}");
  const provider = read("../../../mingla-business/src/components/offering/PublicGlassProvider.tsx");
  assertStringIncludes(provider, '<Material\n    kind="liquid"');
  assertStringIncludes(provider, 'env.platform === "ios" && !env.reduceTransparency && env.tint === "dark"');
  for (const route of [
    "../../../mingla-business/app/e/[brandSlug]/[eventSlug].tsx",
    "../../../mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx",
    "../../../mingla-business/app/t/[brandSlug]/[tripSlug].tsx",
    "../../../mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx",
  ]) {
    assertStringIncludes(read(route), "<PublicGlassProvider>", route);
  }
});

Deno.test("V-1 the venue reserve bar is the glass bar with the category's own action", () => {
  const venue = read("../../brand-rendering/PublicVenueScreen.tsx");
  assertStringIncludes(venue, "<OfferingGlassBar");
  assertStringIncludes(venue, "ctaLabel={profile.reserveAction}");
  assertStringIncludes(venue, 'actionTestID="issue-2729-reserve-cta"');
  // the live pill claims only what the venue clock says
  assertStringIncludes(venue, 'live: openState.status === "open" ? "Open now" : null');
});

Deno.test("V-2 the order bar shows only the server's total", () => {
  const bar = read("../../brand-rendering/venueOrdering/VenueOrderingStickyBar.tsx");
  assertStringIncludes(bar, "totalCents === null || currency === null");
  assertStringIncludes(bar, "title={total === null ? items : `${items} · ${total}`}");
});

Deno.test("R-1 RSVP: confirmed card with a tick that respects reduced motion", () => {
  const d = read("../RsvpMomentumDecision.tsx");
  assertStringIncludes(d, 'testID="issue-4420-rsvp-confirmed-card"');
  assertStringIncludes(d, "const reduceMotion = useReduceMotionPreference();");
  assertStringIncludes(d, "if (reduceMotion) {\n      tickIn.setValue(1);");
  // the going node keeps its contract (label + state) inside the card
  assertStringIncludes(d, "accessibilityState={{ disabled: true, selected: true }}");
});
