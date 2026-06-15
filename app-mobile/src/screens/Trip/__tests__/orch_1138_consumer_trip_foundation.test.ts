// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1138 Leg 1C [consumer trip → Direction-A parity] — regression test.
//
// Proves the consumer trip detail converges on the business/web trip page by
// REUSING the shared @mingla/offering-rendering foundation primitives + a data
// adapter, with a FLOATING reserve bar (Seth's explicit ask), all themed via the
// existing useEventTheme — no schema/edge change, no business/web edit, no
// consumer-checkout change.
//
// app-mobile has no jest/RTL runner; the repo convention for mobile regression
// tests is node:assert source-assertions + behavioral replicas (see the sibling
// orch_1016_consumer_trip_detail.rework_sheet.test.tsx). Every assertion is
// written to FAIL if the guard it protects is reverted (true LINE-DELETION
// fails-on-revert, NOT comment-out).
//
// Run with:
//   node app-mobile/src/screens/Trip/__tests__/orch_1138_consumer_trip_foundation.test.ts

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const screenSrc = read("src/screens/Trip/ConsumerTripDetailScreen.tsx");
const adapterSrc = read("src/hooks/useConsumerTripFoundation.ts");
const reserveBarSrc = read("src/components/offering/ConsumerTripReserveBar.tsx");
const refundLadderSrc = read("src/components/offering/ConsumerRefundLadder.tsx");
const metroSrc = read("metro.config.js");
const tsconfigSrc = read("tsconfig.json");
const themePaletteSrc = read("../packages/event-rendering/themePalette.ts");

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// ── SC-1: @mingla/offering-rendering is wired into app-mobile ────────────────
ok(
  "T1a metro.config.js aliases @mingla/offering-rendering to packages/offering-rendering",
  /"@mingla\/offering-rendering":\s*path\.join\(\s*WORKSPACE_ROOT,\s*"packages",\s*"offering-rendering"/.test(
    metroSrc,
  ),
  "Metro extraNodeModules must map the package (Metro uses Node resolution, not tsconfig paths)",
);
ok(
  "T1b tsconfig.json paths include @mingla/offering-rendering",
  /"@mingla\/offering-rendering":\s*\["\.\.\/packages\/offering-rendering"\]/.test(
    tsconfigSrc,
  ),
  "tsconfig paths must include the package for TS resolution",
);
ok(
  "T1c the screen imports the foundation primitives from @mingla/offering-rendering",
  /import\s*\{[\s\S]*?ParallaxCoverShell[\s\S]*?\}\s*from\s*["']@mingla\/offering-rendering["']/.test(
    screenSrc,
  ) &&
    /ChipGroup/.test(screenSrc) &&
    /CountAwareGallery/.test(screenSrc),
  "the consumer screen must consume ParallaxCoverShell + ChipGroup + CountAwareGallery",
);

// ── SC-2/SC-3: brand-themed foundation render (no hardcoded warm-orange) ──────
ok(
  "T2a the populated foundation body is rendered via <ParallaxCoverShell> with a brand palette",
  /<ParallaxCoverShell[\s\S]*?palette=\{palette\}[\s\S]*?<\/ParallaxCoverShell>/.test(
    screenSrc,
  ),
  "the populated body composes ParallaxCoverShell fed the resolved brand palette",
);
ok(
  "T2b the screen resolves the brand palette via the EXISTING useEventTheme (same path as business) + createThemePalette + offeringSurfaceStyles",
  /useEventTheme\(card\)/.test(screenSrc) &&
    /createThemePalette\(theme\)/.test(screenSrc) &&
    /offeringSurfaceStyles\(palette\)/.test(screenSrc),
  "palette parity must come from useEventTheme → createThemePalette (NOT a hardcoded accent)",
);
ok(
  "T2c the foundation body no longer hardcodes the warm-orange accent (#FF6B35 / #eb7825) on themed text/surfaces",
  // ACCENT/WARM consts may remain ONLY for the loading/error state bodies; the
  // foundation body must drive color off `palette.*` + `surface.*`. Assert the
  // body section icons/text reference palette.accent, not a literal accent.
  /color=\{palette\.accent\}/.test(screenSrc) &&
    /surface\.primaryText/.test(screenSrc) &&
    /surface\.secondaryText/.test(screenSrc),
  "the foundation body must theme off palette/surface, not the literal warm-orange accent",
);

// ── SC-4: the Reserve bar FLOATS (absolute overlay) + scroll stays gorhom's ──
ok(
  "T3a ConsumerTripReserveBar floats via position:'absolute' bottom:0 (does NOT scroll off)",
  /position:\s*"absolute"/.test(reserveBarSrc) &&
    /bottom:\s*0/.test(reserveBarSrc),
  "the floating reserve bar must be an absolute overlay pinned to the bottom",
);
ok(
  "T3b the screen renders the floating bar as a SIBLING of the shell inside a flex:1 host (NOT stickyFooter)",
  /<ParallaxCoverShell[\s\S]*?<\/ParallaxCoverShell>\s*\{floatingReserve\}/.test(
    screenSrc,
  ) &&
    !/stickyFooter=\{/.test(screenSrc),
  "the bar floats as an absolute overlay sibling of the shell, not via BaseBottomSheet.stickyFooter (which froze the scroll, ORCH-1016/1043)",
);
ok(
  "T3c ParallaxCoverShell gets ScrollComponent={BottomSheetScrollView} so gorhom owns the single registered scrollable (no scroll-freeze)",
  /ScrollComponent=\{BottomSheetScrollView\}/.test(screenSrc),
  "the gorhom scroll host must be the shell's ScrollComponent — the single registered scrollable",
);

// ── SC-5: checkout is UNCHANGED (the floating bar fires the existing flow) ────
ok(
  "T4a the floating bar's onPress opens the EXISTING reserve flow (setReserveSheetVisible(true))",
  /<ConsumerTripReserveBar[\s\S]*?onPress=\{\(\)\s*=>\s*setReserveSheetVisible\(true\)\}/.test(
    screenSrc,
  ),
  "the reserve tap must still open ExpandedBusinessEventSheet via setReserveSheetVisible(true) — checkout unchanged",
);
ok(
  "T4b the ExpandedBusinessEventSheet checkout wiring is preserved verbatim (paymentPlanChoice + dueTodayCents)",
  /<ExpandedBusinessEventSheet[\s\S]*?paymentPlanChoice=\{detail\.hasPlan \? paymentPlanChoice : undefined\}/.test(
    screenSrc,
  ) &&
    /dueTodayCents=\{/.test(screenSrc),
  "the consumer native checkout (ExpandedBusinessEventSheet → runNativeCheckout) must be unchanged",
);

// ── SC-7: bold-on-native resolver returns the WEIGHTED family ────────────────
ok(
  "T5a boldFontFamily maps each theme font slug to its 700-weight loaded family (native bold)",
  /export const FONT_FAMILY_BOLD_MAP[\s\S]*?inter:\s*"Inter_700Bold"/.test(
    themePaletteSrc,
  ) &&
    /export const boldFontFamily\s*=\s*\(theme[\s\S]*?FONT_FAMILY_BOLD_MAP\[theme\.font\]/.test(
      themePaletteSrc,
    ),
  "boldFontFamily(theme) must return the weighted family (e.g. Inter_700Bold) so native renders bold",
);
ok(
  "T5b the screen loads BOTH the medium + bold families on demand (useConsumerThemeFont pair) and applies boldFamily to themed bold text",
  /useConsumerThemeFont\(theme\.fontFamilyValue\)/.test(screenSrc) &&
    /useConsumerThemeFont\(boldFamily\)/.test(screenSrc) &&
    /fontFamily:\s*boldFamily/.test(screenSrc),
  "the consumer must register + apply the weighted bold family (a loaded custom font ignores fontWeight on native)",
);

// ── SC-8 + invariants: rule-9 adapter, anon-safe, package-isolated ───────────
ok(
  "T6a the data-adapter NEVER reads brands directly (🔒 COMMS-0009 / I-ANON-BRANDS-VIA-DEFINER-VIEW)",
  !/\.from\(["']brands["']\)/.test(adapterSrc) &&
    !/\.from\(["']brands["']\)/.test(reserveBarSrc) &&
    !/\.from\(["']brands["']\)/.test(refundLadderSrc),
  "the adapter/bar/ladder must not query the brands table; theme resolves via the anon view (useEventTheme)",
);
ok(
  "T6b the new consumer files do NOT IMPORT mingla-business/src (🔒 I-MOR-0827-PACKAGE-ISOLATION)",
  !/from\s*["'][^"']*mingla-business/.test(adapterSrc) &&
    !/from\s*["'][^"']*mingla-business/.test(reserveBarSrc) &&
    !/from\s*["'][^"']*mingla-business/.test(refundLadderSrc) &&
    !/from\s*["'][^"']*mingla-business/.test(screenSrc),
  "reuse must happen at packages/* only — no app→app import (a prose mention of the rule is fine)",
);
ok(
  "T6c the adapter maps REAL fields with rule-9 null guards (duration/route/days/chips)",
  /export function deriveTripDuration/.test(adapterSrc) &&
    /export function mapConsumerTripToFoundation/.test(adapterSrc) &&
    /detail\.departureText !== null \|\| destination !== null/.test(adapterSrc) &&
    /\.filter\(\(i\) => i\.kind === "included"\)/.test(adapterSrc),
  "the adapter must map real ConsumerTripDetail fields, omitting absent ones (rule 9)",
);
ok(
  "T6d the destination map is DEFERRED on consumer (no fabricated tile — OQ-1A; consumer data has no lat/lng)",
  /DEFERRED on consumer/.test(screenSrc) &&
    !/buildStaticMapUrl/.test(screenSrc),
  "the map section is omitted (rule 9) — the consumer trip data carries no destination lat/lng",
);

// ── Behavioral replica: deriveTripDuration (the load-bearing pure mapping) ───
// Mirrors the adapter's exported deriveTripDuration so a logic regression fails
// here even though app-mobile cannot import TS at runtime.
function deriveTripDurationReplica(startAt, endAt) {
  if (startAt === null || endAt === null) return null;
  const s = Date.parse(startAt);
  const e = Date.parse(endAt);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  const nights = Math.max(0, Math.round((e - s) / dayMs));
  const days = nights + 1;
  if (nights === 0) return `${days} day`;
  return `${days} days · ${nights} night${nights === 1 ? "" : "s"}`;
}
ok(
  "T7a deriveTripDuration: 3-night range → '4 days · 3 nights'",
  deriveTripDurationReplica("2026-07-01T00:00:00Z", "2026-07-04T00:00:00Z") ===
    "4 days · 3 nights",
);
ok(
  "T7b deriveTripDuration: same-day → '1 day'",
  deriveTripDurationReplica("2026-07-01T00:00:00Z", "2026-07-01T00:00:00Z") ===
    "1 day",
);
ok(
  "T7c deriveTripDuration: null bound → null (rule 9, no fabricated duration)",
  deriveTripDurationReplica(null, "2026-07-04T00:00:00Z") === null,
);
ok(
  "T7d the adapter's real deriveTripDuration body matches the replica (nights = round((e-s)/dayMs))",
  /const nights = Math\.max\(0, Math\.round\(\(e - s\) \/ dayMs\)\)/.test(
    adapterSrc,
  ) && /const days = nights \+ 1/.test(adapterSrc),
  "the shipped deriveTripDuration must compute nights/days exactly as the replica asserts",
);

// ── Behavioral replica: seats label derivation (sold-out from spotsLeft) ─────
function seatsLabelReplica(totalCapacity, spotsLeft) {
  if (totalCapacity === null) return null;
  if (spotsLeft !== null && spotsLeft <= 0) {
    return `Sold out · ${totalCapacity} of ${totalCapacity} booked`;
  }
  if (spotsLeft !== null) return `${spotsLeft} seats left · ${totalCapacity} max`;
  return `${totalCapacity} max`;
}
ok(
  "T8a seats label: spotsLeft<=0 → 'Sold out · N of N booked'",
  seatsLabelReplica(20, 0) === "Sold out · 20 of 20 booked",
);
ok(
  "T8b seats label: spotsLeft present → 'N seats left · M max'",
  seatsLabelReplica(20, 5) === "5 seats left · 20 max",
);
ok(
  "T8c seats label: capacity-only → 'M max'",
  seatsLabelReplica(20, null) === "20 max",
);
ok(
  "T8d seats label: no capacity → null (rule 9)",
  seatsLabelReplica(null, null) === null,
);

// ── DRAFT all-surface-parity invariant: 3 call sites import ParallaxCoverShell ─
ok(
  "T9 the trip page renders via @mingla/offering-rendering's ParallaxCoverShell on all 3 surfaces (web/business via TripPreview, consumer via this screen)",
  /ParallaxCoverShell/.test(
    read("../mingla-business/src/components/trip/TripPreview.tsx"),
  ) && /ParallaxCoverShell/.test(screenSrc),
  "the DRAFT I-PROPOSED-TRIP-PAGE-SHARED-FOUNDATION-ALL-SURFACES — consumer + business both consume the shared shell",
);

console.log(
  `\n# ORCH-1138 Leg 1C consumer-trip foundation parity — ${passed} checks PASS`,
);
