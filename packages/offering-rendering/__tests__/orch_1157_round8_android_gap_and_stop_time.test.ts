// ORCH-1157 [rsvp-public-redesign] Round-8 — implementor-owned happy-path
// regression for (A) the Android see-through sheet-gap fix in the SHARED sheet
// host and (B) the cross-offering-type time audit (experience per-stop time pill
// made device-locale-aware to match the RSVP doors treatment).
//
// TASK A — Android sheet-gap. The consumer detail sheets (RSVP / event / trip /
// experience) all mount the SAME `BaseBottomSheet` host as NON-`wrapInRNModal`
// inline sheets at `windowHeight`. gorhom paints the sheet body only to that
// height, so on Android the OS nav-bar inset region (`insets.bottom`) below it was
// UNPAINTED → the deck behind showed through (see-through band). Round-8 paints an
// Android-only opaque filler of the sheet's OWN background colour across exactly
// that inset, anchored to the screen bottom, as a SIBLING of the gorhom container
// (so the ORCH-1016 viewport invariant is untouched). One host = all four types.
//
// TASK B — per-stop time. The experience page's per-stop timeline time pill was
// FORCED 12h AM/PM ("7:00 PM") on both consumer (`formatStartTime`) and
// business/web (`formatStopTime`) — a 24h-clock device still saw "7:00 PM". Now
// both decide the device clock via `Intl.DateTimeFormat(locale,{hour:"numeric"})
// .resolvedOptions().hour12` (the same mechanism as the RSVP doors helper) →
// device 12h "7:00 PM" / device 24h "19:00", always carrying minutes. Standard
// events already render the round-7 locale-aware doors pill; trips are date-only
// (no time-of-day) and unchanged — see the report audit table.
//
// These three screen helpers/hosts pull RN-bound siblings Deno cannot import, so
// they are asserted via SOURCE-CONTRACT. Each assertion is written to FAIL on a
// true line-deletion revert of the Round-8 fix (proof in the implementation
// report): delete the Android filler render → the host assertions fail; revert
// either stop-time helper to its forced-12h body → the locale-mechanism / no-
// hard-coded-AMPM assertions fail.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));

// ── TASK A: BaseBottomSheet Android nav-bar filler (shared host) ──────────────

const baseSheet = await read(
  "../../../app-mobile/src/components/ui/BaseBottomSheet.tsx",
);

Deno.test("Round-8 A: BaseBottomSheet paints an Android-only nav-bar filler", () => {
  // Android-gated render.
  assertStringIncludes(baseSheet, "androidNavFiller");
  assertStringIncludes(baseSheet, "Platform.OS === 'android'");
  // Gated on a real nav-bar inset (no-op on gesture-nav / no bar).
  assertStringIncludes(baseSheet, "insets.bottom > 0");
});

Deno.test("Round-8 A: the filler uses the SHEET'S OWN resolved background colour", () => {
  // Reads the resolved background style colour (per-consumer override or theme
  // default) — so RSVP/event/trip/experience all get the right fill.
  assertStringIncludes(baseSheet, "resolvedBgColor");
  assertStringIncludes(baseSheet, "resolvedBackgroundStyle");
  assertStringIncludes(baseSheet, "backgroundColor: resolvedBgColor");
});

Deno.test("Round-8 A: the filler height equals the nav-bar inset and is bottom-anchored", () => {
  assertStringIncludes(baseSheet, "height: insets.bottom");
  // styles.androidNavFiller is bottom:0, full-width, absolute.
  const fillerStyle = baseSheet.slice(baseSheet.indexOf("androidNavFiller: {"));
  assertStringIncludes(fillerStyle, "position: 'absolute'");
  assertStringIncludes(fillerStyle, "bottom: 0");
});

Deno.test("Round-8 A: the filler is a SIBLING of the gorhom host (ORCH-1016 viewport untouched)", () => {
  // The inline host height stays exactly inlineContainerHeight; the filler is a
  // separate element rendered after the host, never nested inside the gorhom-
  // measured container, so it cannot perturb the snap/viewport math.
  assertStringIncludes(baseSheet, "{androidNavFiller}");
  assertStringIncludes(
    baseSheet,
    "height: inlineContainerHeight",
  );
});

// ── TASK B: experience per-stop time is device-locale-aware (consumer + biz) ──

const consumerExp = await read(
  "../../../app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx",
);
const bizExp = await read(
  "../../../mingla-business/src/components/experience/ExperiencePreview.tsx",
);

// The exact device-clock detection used by the RSVP doors helper (round-7).
const LOCALE_CLOCK_MECHANISM =
  'new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions()';

Deno.test("Round-8 B: consumer formatStartTime decides the device 12h/24h clock", () => {
  const fn = consumerExp.slice(
    consumerExp.indexOf("const formatStartTime = ("),
    consumerExp.indexOf("// Per-stop media"),
  );
  assertStringIncludes(fn, LOCALE_CLOCK_MECHANISM);
  assertStringIncludes(fn, ".hour12 ===");
  // 24h → zero-padded "2-digit"; 12h → "numeric".
  assertStringIncludes(fn, 'is24h ? "2-digit" : "numeric"');
  // Always carries minutes.
  assertStringIncludes(fn, 'minute: "2-digit"');
  // The OLD forced-12h ternary must be GONE (fails-on-revert anchor).
  assert(
    !fn.includes('h >= 12 ? "PM" : "AM"'),
    "consumer formatStartTime still forces 12h AM/PM — revert detected",
  );
});

Deno.test("Round-8 B: business formatStopTime decides the device 12h/24h clock", () => {
  const fn = bizExp.slice(
    bizExp.indexOf("function formatStopTime("),
    bizExp.indexOf("// ORCH-1138 Leg 3 — id → human label"),
  );
  assertStringIncludes(fn, LOCALE_CLOCK_MECHANISM);
  assertStringIncludes(fn, ".hour12 ===");
  assertStringIncludes(fn, 'is24h ? "2-digit" : "numeric"');
  assertStringIncludes(fn, 'minute: "2-digit"');
  // The OLD forced paths must be GONE (fails-on-revert anchors):
  //   - HH:MM branch hard-coded ternary, and
  //   - the en-US ISO branch.
  assert(
    !fn.includes('h >= 12 ? "PM" : "AM"'),
    "business formatStopTime still forces 12h AM/PM — revert detected",
  );
  assert(
    !fn.includes('toLocaleTimeString("en-US"'),
    "business formatStopTime still hard-codes en-US — revert detected",
  );
});

Deno.test("Round-8 B: experience per-stop time still renders in a PILL (not plain bare time)", () => {
  // Consumer: stopTimePill text element fed by formatStartTime(stop.startTime).
  assertStringIncludes(consumerExp, "formatStartTime(stop.startTime)");
  assertStringIncludes(consumerExp, "styles.stopTimePill");
  // Business: stop time chip fed by formatStopTime(stop.startTime).
  assertStringIncludes(bizExp, "formatStopTime(stop.startTime)");
});
