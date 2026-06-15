// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1138 [trip-page-redesign] — SIX device-feedback parity fixes (CONSUMER).
//
// Covers the consumer-app halves of the six fixes from Seth's device
// screenshots. app-mobile has no jest/RTL runner; the repo convention is
// node:assert source-assertions + behavioral replicas (see the sibling
// orch_1138_consumer_trip_foundation.test.ts). Every assertion is written to
// FAIL on a true LINE-DELETION of the guard it protects (fails-on-revert), NOT
// on a comment-out.
//
// Run with:
//   node app-mobile/src/screens/Trip/__tests__/orch_1138_trip_parity_fixes.test.ts

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const screenSrc = read("src/screens/Trip/ConsumerTripDetailScreen.tsx");
const adapterSrc = read("src/hooks/useConsumerTripFoundation.ts");
const reserveBarSrc = read("src/components/offering/ConsumerTripReserveBar.tsx");

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// ── FIX 1: eyebrow + title render EXACTLY ONCE (no seam-overlaid duplicate) ───
// The duplicate copy was a seam heroEyebrow/heroTitle rendered over the cover in
// the scroll body, IN ADDITION to the in-body leadBlock. The fix removes the seam
// copy. Guard: the screen must NOT render <Text style={styles.heroEyebrow}> nor
// <Text style={[styles.heroTitle ...]}> (those styles were deleted with it), and
// the in-body leadBlock (eyebrowLead + fndTitle) remains the sole render.
ok(
  "FIX1a no seam heroEyebrow render (styles.heroEyebrow removed)",
  !/styles\.heroEyebrow/.test(screenSrc),
  "the duplicate cover-overlaid eyebrow must be removed",
);
ok(
  "FIX1b no seam heroTitle render (styles.heroTitle removed)",
  !/styles\.heroTitle/.test(screenSrc),
  "the duplicate cover-overlaid title must be removed",
);
ok(
  "FIX1c the in-body leadBlock keeps the SOLE eyebrow (eyebrowLead) + title (fndTitle)",
  /styles\.eyebrowLead/.test(screenSrc) && /styles\.fndTitle/.test(screenSrc),
  "the single eyebrow/title render lives in the body leadBlock",
);
// Structural fails-on-revert: the title text source `fnd.title` must appear
// exactly once as the rendered title node ({fnd.title} in a <Text>). Count the
// `{fnd.title}` occurrences — must be exactly 1 (the leadBlock title).
ok(
  "FIX1d {fnd.title} renders exactly once (no duplicate title node)",
  (screenSrc.match(/\{fnd\.title\}/g) || []).length === 1,
  "a second {fnd.title} node = the duplicate is back",
);

// ── FIX 2: destination normalized to "City, Country" in eyebrow + chip + route ─
// The adapter must normalize the destination from the SAME raw source for all
// three surfaces via the shared normalizer.
ok(
  "FIX2a adapter imports the shared normalizeCityCountry",
  /import\s*\{[^}]*normalizeCityCountry[^}]*\}\s*from\s*["']@mingla\/offering-rendering["']/.test(
    adapterSrc,
  ),
  "must reuse the shared normalizer, not fork",
);
ok(
  "FIX2b the eyebrow/chip `destination` is the NORMALIZED value (not raw destinationText)",
  /const destination = normalizeCityCountry\(detail\.destinationText\)/.test(
    adapterSrc,
  ),
  "destination must be normalizeCityCountry(detail.destinationText)",
);
ok(
  "FIX2c the route destination leg is normalized from the SAME raw source",
  /const destinationCityCountry = normalizeCityCountry\(detail\.destinationText\)/.test(
    adapterSrc,
  ),
  "route destination must normalize detail.destinationText (so eyebrow+chip+route match)",
);
ok(
  "FIX2d the route departure leg is normalized",
  /const departureCityCountry = normalizeCityCountry\(detail\.departureText\)/.test(
    adapterSrc,
  ),
);
// Behavioral fails-on-revert: a real free-text destination must collapse to
// "City, Country" via the same normalizer the adapter uses. We require the source
// to pass detail.destinationText THROUGH normalizeCityCountry — if a revert puts
// the raw value back, FIX2b's regex fails. Belt-and-suspenders behavioral check
// against the normalizer itself:
const {
  normalizeCityCountry,
} = require("../../../../../packages/offering-rendering/normalizeCityCountry.ts");
ok(
  "FIX2e normalizer collapses 'Washington, District of Columbia, United States' → 'Washington, USA'",
  normalizeCityCountry("Washington, District of Columbia, United States") ===
    "Washington, USA",
  "the FIX-2 target string from Seth's screenshot",
);

// ── FIX 3 (consumer): the brand cover uses the media-aware EventCoverMedia ─────
// The consumer brand chip must render the cover via EventCoverMedia (image/gif/
// video aware + hue fallback), NOT a plain <Image>. The anon-safe consumer data
// path carries no brand cover today (COMMS-0009), so it shows the hue fallback —
// but the COMPONENT must be the media-aware one so a future cover animates and no
// broken alt text ever shows.
ok(
  "FIX3a the brand chip uses EventCoverMedia (media-aware), inside the brandTile",
  /styles\.brandTile[\s\S]{0,260}<EventCoverMedia/.test(screenSrc),
  "brand cover must render via EventCoverMedia, never a plain <Image> with broken alt",
);
ok(
  "FIX3b no plain <Image ... brandTile> brand cover (the broken-alt path is gone)",
  !/<Image[\s\S]{0,160}styles\.brandTile/.test(screenSrc),
);
ok(
  "FIX3c the brand EventCoverMedia passes label=\"\" (no 'COVE…' truncated 'Cover' text)",
  /styles\.brandTile[\s\S]{0,800}label=""/.test(screenSrc),
  "the no-cover fallback must be a clean hue gradient, not the default 'Cover' label",
);

// ── FIX 4: "Choose how you pay" parity with the business PaymentMockupCard ─────
ok(
  "FIX4a heading is 'Choose how you pay' (matches business + mockup)",
  /Choose how you pay/.test(screenSrc),
  "consumer heading must match the business/web casing exactly",
);
ok(
  "FIX4b old 'How you pay' uppercase sectionLabel heading is gone",
  !/styles\.sectionLabel/.test(screenSrc),
  "the legacy warm-orange uppercase 'How you pay' label must be removed",
);
ok(
  "FIX4c the tabbed segmented control (payMockSeg) replaces the radio-dot pills",
  /styles\.payMockSeg\b/.test(screenSrc) && !/styles\.paySegment\b/.test(screenSrc),
  "must use the full-width tab track, not the old radio segments",
);
ok(
  "FIX4d the amount block + sub-copy mirror the mockup ('all-in. Taxes & fees included')",
  /One payment, all-in\. Taxes &amp; fees included\./.test(screenSrc),
);
ok(
  "FIX4e the plan sub-copy mirrors the mockup ('total — no\\n extra cost')",
  /total — no\s*\n?\s*extra cost\./.test(screenSrc),
);
ok(
  "FIX4f the schedule rows + total render (payMockSchedule + payMockSchedTotal)",
  /styles\.payMockSchedule\b/.test(screenSrc) &&
    /styles\.payMockSchedTotal\b/.test(screenSrc),
);

// ── FIX 5: the Reserve CTA is safe-area-inset (no bottom bleed) ────────────────
ok(
  "FIX5a the reserve bar reads useSafeAreaInsets",
  /useSafeAreaInsets\(\)/.test(reserveBarSrc),
);
// FIX5b (device rework #2) — both variants resolve a safe-area floor so the
// button never bleeds under the home indicator; the FLOATING variant additionally
// adds the gorhom overshoot + a gap to its absolute `bottom`.
ok(
  "FIX5b the bar resolves a safe-area floor = max(screen inset, own inset, 34); floating adds overshoot + gap",
  /const safeBottom\s*=\s*Math\.max\(safeAreaBottom \?\? 0, insets\.bottom, HOME_INDICATOR_FLOOR\)/.test(
    reserveBarSrc,
  ) &&
    /const wrapperBottom\s*=\s*safeBottom\s*\+\s*SHEET_BOTTOM_OVERSHOOT\s*\+\s*FLOAT_GAP/.test(
      reserveBarSrc,
    ),
  "the bar must clear the home indicator from the screen-passed inset + a 34pt floor; floating adds the gorhom overshoot + a float gap",
);
ok(
  "FIX5b2 the bar accepts the screen-level safeAreaBottom prop (gorhom inset is ~0)",
  /safeAreaBottom\?:\s*number/.test(reserveBarSrc) &&
    /safeAreaBottom=\{insets\.bottom\}/.test(screenSrc),
  "the screen must pass its own inset down because the bar's own hook reads ~0 inside gorhom",
);

// ── FIX 5 device-rework #3 (Seth's screenshot feedback): DOCKED + FLOATING ──────
// (a) the bar supports a two-mode `variant: "docked" | "floating"`.
ok(
  "DR3a the reserve bar exposes a docked|floating variant prop",
  /variant:\s*"docked"\s*\|\s*"floating"/.test(reserveBarSrc),
  "the CTA must render in two modes — docked (resting) and floating (pill)",
);
// (b) the FLOATING variant is JUST the pill — NO full-width opaque bar bg. The
// floating branch renders styles.floatPill and there is NO page-colored
// full-width fade band in the floating wrapper (the floatWrapper has no
// backgroundColor). Fails-on-revert: if the floating branch reintroduces a
// full-width page-colored band, the negative assertion fails.
ok(
  "DR3b the FLOATING variant renders just the pill (floatPill), not a full-width opaque bar",
  /styles\.floatPill\b/.test(reserveBarSrc) &&
    /styles\.floatWrapper\b/.test(reserveBarSrc),
  "floating must be a pill, not a solid full-width bar",
);
ok(
  "DR3b2 the floatWrapper has NO page-colored full-width background band",
  /floatWrapper:\s*\{[^}]*\}/.test(reserveBarSrc) &&
    /floatWrapper:\s*\{(?:(?!backgroundColor)[\s\S])*?\},/.test(reserveBarSrc),
  "the floating overlay must not paint a full-width opaque bar behind the pill",
);
// (c) the DOCKED variant is an IN-FLOW card (the LAST scroll child), NOT absolute,
// and reports its layout via onDockLayout so the screen can hide the pill.
ok(
  "DR3c the DOCKED variant is an in-flow card with onLayout reporting (dockedCard, not absolute)",
  /if \(variant === "docked"\)/.test(reserveBarSrc) &&
    /styles\.dockedCard\b/.test(reserveBarSrc) &&
    /onLayout=\{onDockLayout\}/.test(reserveBarSrc) &&
    !/dockedCard:\s*\{[^}]*position:\s*"absolute"/.test(reserveBarSrc),
  "the docked CTA must sit in normal flow as the last scroll child (no void above it)",
);
// (d) the screen renders the DOCKED bar as the LAST child inside the scroll body,
// AFTER {bodyChildren}, so it sits flush beneath "Choose how you pay".
const bodyChildrenIdx = screenSrc.lastIndexOf("{bodyChildren}");
const dockedReserveIdx = screenSrc.lastIndexOf("{dockedReserve}");
ok(
  "DR3d the screen renders {dockedReserve} as the LAST scroll child (after {bodyChildren})",
  bodyChildrenIdx > -1 &&
    dockedReserveIdx > -1 &&
    dockedReserveIdx > bodyChildrenIdx,
  "the docked CTA must be the final element inside the scroll content (flush, no gap)",
);
ok(
  "DR3d2 the screen passes variant=\"docked\" with onDockLayout",
  /variant="docked"/.test(screenSrc) && /onDockLayout=\{handleDockLayout\}/.test(screenSrc),
);
// (e) the FLOATING pill is CONDITIONAL on floatingPillVisible (hides when docked
// in view), tracked via the docked layout y + scroll offset + viewport height.
ok(
  "DR3e the floating pill is gated by floatingPillVisible (hides when docked visible)",
  /floatingPillVisible\s*\?\s*\(/.test(screenSrc) &&
    /const floatingPillVisible\s*=/.test(screenSrc) &&
    /dockTopY > scrollY \+ viewportH - REVEAL_MARGIN/.test(screenSrc),
  "the float pill must hide once the docked button's top crosses the viewport bottom",
);
ok(
  "DR3e2 the scroll wires onScroll + onLayout to track offset + viewport",
  /onScroll=\{handleScroll\}/.test(screenSrc) &&
    /onLayout=\{handleScrollLayout\}/.test(screenSrc) &&
    /variant="floating"/.test(screenSrc),
);
// (f) NO oversized bar-sized paddingBottom void — the screen no longer reserves a
// bar-height + overshoot clearance; the docked card carries its own bottom pad.
ok(
  "DR3f NO oversized paddingBottom void (reserveBarClearance is a small tail pad, not bar-sized)",
  /const reserveBarClearance\s*=\s*8\b/.test(screenSrc) &&
    !/BAR_FLOAT_BOTTOM\s*\+\s*BAR_CARD_HEIGHT/.test(screenSrc),
  "the black void came from an oversized bottom padding — it must be removed",
);

// ── FIX 6 standard-order is enforced on the BUSINESS side (covered in the
//     business test file). Consumer already renders Cancellation before
//     How-you-pay; assert that ordering holds here too (the refund ladder
//     appears in source BEFORE the payment-choice block). ──────────────────────
const refundIdx = screenSrc.indexOf("ConsumerRefundLadder");
const payIdx = screenSrc.indexOf("orch-1130-consumer-payment-choice");
ok(
  "FIX6-consumer Cancellation (ConsumerRefundLadder) renders BEFORE How-you-pay",
  refundIdx > -1 && payIdx > -1 && refundIdx < payIdx,
  "consumer must keep Cancellation → How-you-pay order",
);

console.log(`\n${passed} assertions passed (ORCH-1138 consumer parity fixes).`);
