// META-ORCH-1174 Leg A.4 [trip-page polish · lucide pills + date-tz fix] —
// implementor-owned source-contract regression (the established offering-rendering
// deno-readfile style). These assertions FAIL-ON-REVERT:
//   §1 — the shared LucideIcons module exports all 9 icons, drawn as react-native-
//        svg paths (NO lucide dependency — I-MOR-0827 isolation) on a 24×24 frame.
//   §2 — the three shared bodies render the lucide icon components (Calendar/Plane/
//        Moon/Users/Globe/MapPin/Minus/Plus/BadgeCheck) and NO LONGER carry the
//        prior emoji / geometric-glyph icon `<Text>` (📅 ✈ ⏱ 👥 ◷ ◯ ⌖ + the bare
//        ✓ verified glyph + the stepper −/+/–).
//   §3 — the §4 trip meta pills are COMPACT (a MetaPill icon+label row) so
//        days&nights + seats-left sit side-by-side on one line.
//   §4 — the trip date formatter formats the calendar date in UTC (timeZone:"UTC"),
//        so a UTC-midnight start is NOT shifted back a day by the device timezone
//        ("Aug 17", never "Aug 16").

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));

const lucide = await read("../LucideIcons.tsx");
const barrel = await read("../index.ts");
const trip = await read("../TripOfferingBody.tsx");
const event = await read("../EventOfferingBody.tsx");
const rsvp = await read("../RsvpOfferingBody.tsx");
const rsvpMomentum = await read("../RsvpMomentumDecision.tsx");
const dateRange = await read("../formatTripDateRange.ts");

const ICONS = [
  "Calendar",
  "Plane",
  "Moon",
  "Users",
  "Globe",
  "MapPin",
  "Minus",
  "Plus",
  "BadgeCheck",
];

// ── §1 — the LucideIcons module exports all 9 icons, SVG-path, no lucide dep ──
Deno.test("§1 LucideIcons exports all 9 icons", () => {
  for (const name of ICONS) {
    assertStringIncludes(
      lucide,
      `export const ${name}`,
      `LucideIcons must export ${name}`,
    );
    assertStringIncludes(barrel, name);
  }
});

Deno.test("§1 LucideIcons draws react-native-svg paths — NO lucide dependency", () => {
  assertStringIncludes(lucide, 'from "react-native-svg"');
  // The exact lucide path data for the distinctive icons (proves real art, not a
  // placeholder): the moon crescent + the minus/plus strokes.
  assertStringIncludes(lucide, "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"); // Moon
  assertStringIncludes(lucide, "M5 12h14"); // Minus + Plus horizontal
  assertStringIncludes(lucide, "M12 5v14"); // Plus vertical
  // lucide-standard frame: 24×24 viewBox, fill="none", round caps/joins.
  assertStringIncludes(lucide, 'viewBox="0 0 24 24"');
  assertStringIncludes(lucide, 'fill="none"');
  assertStringIncludes(lucide, 'strokeLinecap="round"');
  assertStringIncludes(lucide, 'strokeLinejoin="round"');
  // NO runtime lucide dependency anywhere (I-MOR-0827 isolation — SVG paths only).
  assert(
    !/from\s+["']lucide(-react|-react-native)?["']/.test(lucide),
    "LucideIcons must NOT import the lucide library (hand-drawn SVG paths only)",
  );
});

// ── §2 — the three bodies use the lucide components + dropped the glyphs ──
Deno.test("§2 TripOfferingBody swaps its pill/verified glyphs to lucide", () => {
  assertStringIncludes(trip, 'from "./LucideIcons"');
  assertStringIncludes(trip, "<Calendar"); // §3 date pill
  assertStringIncludes(trip, "<Plane"); // §3 route pill
  assertStringIncludes(trip, "<Moon"); // §4 days·nights
  assertStringIncludes(trip, "<Users"); // §4 seats-left
  assertStringIncludes(trip, "<BadgeCheck"); // brand verified tick
  for (const glyph of ["📅", "✈", "⏱", "👥"]) {
    assert(!trip.includes(glyph), `TripOfferingBody must not keep the "${glyph}" glyph`);
  }
  // The bare "✓" verified glyph in a <Text> is gone (BadgeCheck replaces it).
  assert(
    !/<Text[^>]*>\s*✓\s*<\/Text>/.test(trip),
    "TripOfferingBody must not render the bare ✓ verified glyph",
  );
});

Deno.test("§2 EventOfferingBody swaps date/where/stepper glyphs to lucide", () => {
  assertStringIncludes(event, 'from "./LucideIcons"');
  assertStringIncludes(event, "<Calendar"); // date row
  assertStringIncludes(event, "<Globe"); // online
  assertStringIncludes(event, "<MapPin"); // location pin
  assertStringIncludes(event, "<Minus"); // stepper −
  assertStringIncludes(event, "<Plus"); // stepper +
  for (const glyph of ["◷", "◯", "⌖", "−"]) {
    assert(!event.includes(glyph), `EventOfferingBody must not keep the "${glyph}" glyph`);
  }
});

Deno.test("§2 RsvpOfferingBody swaps date/where/stepper glyphs to lucide", () => {
  assertStringIncludes(rsvp, 'from "./LucideIcons"');
  assertStringIncludes(rsvp, "<Calendar"); // date row
  assertStringIncludes(rsvp, "<Globe"); // online
  assertStringIncludes(rsvp, "<MapPin"); // location pin
  assertStringIncludes(rsvp, "<Minus"); // +1 stepper –
  assertStringIncludes(rsvp, "<Plus"); // +1 stepper +
  // The date/where geometric glyphs are gone entirely.
  for (const glyph of ["◷", "◯", "⌖"]) {
    assert(!rsvp.includes(glyph), `RsvpOfferingBody must not keep the "${glyph}" glyph`);
  }
  // The bare stepGlyph "–"/"+" Text steppers are gone (lucide replaces them). We
  // target the stepGlyph Text element specifically — the en-dash also legitimately
  // appears in prose comments ("sections 2–8"), so a blanket char-scan over-matches.
  assert(
    !/<Text[^>]*styles\.stepGlyph[^>]*>\s*[–+]\s*<\/Text>/.test(rsvp),
    "RsvpOfferingBody must not render the bare –/+ stepGlyph Text steppers",
  );
});

Deno.test("§2 the RSVP decision-button glyphs are LEFT UNTOUCHED (out of scope)", () => {
  // The Going/Maybe/Can't SVG glyphs live in RsvpMomentumDecision and stay as-is.
  assertStringIncludes(rsvpMomentum, "CheckGlyph");
  assertStringIncludes(rsvpMomentum, "MaybeGlyph");
  assertStringIncludes(rsvpMomentum, "XGlyph");
});

// ── §3 — the §4 trip pills are compacted onto one row ──
Deno.test("§3 trip §4 meta pills are a COMPACT icon+label row (side-by-side)", () => {
  // The new MetaPill carries the lucide icon + a one-line label in a flex-ROW pill.
  assertStringIncludes(trip, "MetaPill");
  // The pill style is a flexDirection:'row' (icon next to label) — the compaction.
  assert(
    /pill:\s*\{[^}]*flexDirection:\s*"row"/s.test(trip),
    "the §4 pill must be a flexDirection:'row' icon+label row (compacted)",
  );
  // Tighter footprint than the §3 full-width pills (smaller padding + font).
  assert(
    /pillText:\s*\{\s*fontSize:\s*12/.test(trip),
    "the §4 compact pill text must use the tighter fontSize 12",
  );
});

// ── §4 — the trip date formatter is timezone-safe (UTC calendar date) ──
Deno.test("§4 formatTripDateRange formats the calendar date in UTC (no tz shift)", () => {
  // The Aug-16-vs-Aug-17 device bug: a UTC-midnight start formatted in the device
  // tz slips back a day west of UTC. The fix passes timeZone:"UTC" to the
  // Intl/toLocaleDateString formatter so the displayed date == the stored date.
  assert(
    /toLocaleDateString\([^)]*timeZone:\s*"UTC"/s.test(dateRange),
    "formatTripDateRange must format with timeZone:'UTC' (calendar date, no device shift)",
  );
});
