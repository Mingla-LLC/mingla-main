// ORCH-1138 [trip-page-redesign] — SIX device-feedback parity fixes (BUSINESS/WEB).
//
// Covers the business/web halves of the six fixes from Seth's device screenshots:
//   FIX 2 — the eyebrow trailing location + the 📍 location chip + the route block
//           are ALL the normalized "City, Country" (not raw long destination text).
//   FIX 3 — the "Presented by" brand cover renders via the media-aware
//           EventCoverMedia (image/gif/video + hue fallback), NOT a plain <Image>
//           that showed a broken "COVE…" alt on a video/gif URL.
//   FIX 6 — STANDARD section order: Cancellation policy renders BEFORE the
//           How-you-pay/payment block on the business/web page too.
//
// Source-grep assertions over TripPreview.tsx + usePublicTripBySlug.ts, in the
// established mingla-business ts-jest convention (see routeCityCountry.orch1138).
// fails-on-revert: each assertion fails on a true LINE-DELETION of the guard.

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel: string): string =>
  readFileSync(path.join(ROOT, rel), "utf8");

// [TEST-MOD-APPROVED META-ORCH-1174] retarget: the inline FoundationTripPreview
// layout was promoted into the shared @mingla/offering-rendering body. FIX-2's
// City,Country normalization now lives in the per-surface adapter
// (tripOfferingAdapter); FIX-2's eyebrow/location-pill + FIX-3's media-aware brand
// cover + FIX-6's cancellation-before-pay ordering now live in TripOfferingBody.
// The behaviors are byte-preserved; the assertions read their new homes. Each still
// fails on a true line-deletion of its guard.
const bodySrc = read("../packages/offering-rendering/TripOfferingBody.tsx");
const adapterSrc = read("src/components/trip/tripOfferingAdapter.ts");
const hookSrc = read("src/hooks/usePublicTripBySlug.ts");

describe("ORCH-1138 FIX-2 — destination normalized everywhere (business/web)", () => {
  test("the eyebrow trailing destination uses destinationCityCountry (not raw)", () => {
    // The body's eyebrow appends the normalized data.destinationCityCountry; the
    // raw destination text is NEVER appended to the eyebrow.
    expect(
      /` · \$\{data\.destinationCityCountry\}`/.test(bodySrc),
    ).toBe(true);
    expect(
      /` · \$\{[a-zA-Z.]*destinationLocationText\}`/.test(bodySrc),
    ).toBe(false);
  });

  test("the 📍 location pill renders destinationCityCountry", () => {
    // The §3 location pill renders the normalized value, gated on it being non-null.
    expect(
      /data\.destinationCityCountry !== null \?[\s\S]{0,600}\{data\.destinationCityCountry\}/.test(
        bodySrc,
      ),
    ).toBe(true);
  });

  test("the adapter still normalizes both legs (shared normalizer, not forked)", () => {
    expect(
      /departureCityCountry:\s*normalizeCityCountry\(bt\.departureLocationText\)/.test(
        adapterSrc,
      ),
    ).toBe(true);
    expect(
      /destinationCityCountry:\s*normalizeCityCountry\(bt\.destinationLocationText\)/.test(
        adapterSrc,
      ),
    ).toBe(true);
  });
});

describe("ORCH-1138 FIX-3 — brand cover is media-aware (business/web)", () => {
  test("the brand chip renders EventCoverMedia inside the brandTile (not a plain <Image>)", () => {
    expect(
      /style=\{\[\s*styles\.brandTile[\s\S]{0,400}<EventCoverMedia/.test(
        bodySrc,
      ),
    ).toBe(true);
  });

  test("EventCoverMedia receives the brand cover url + TYPE + hue (animated covers render)", () => {
    expect(/mediaUrl=\{brand\.coverMediaUrl\}/.test(bodySrc)).toBe(true);
    expect(/mediaType=\{brand\.coverMediaType\}/.test(bodySrc)).toBe(true);
    expect(/hue=\{brand\.coverHue/.test(bodySrc)).toBe(true);
  });

  test("the brandTile clips its media (overflow:'hidden') so a video/gif stays circular", () => {
    expect(
      /brandTile:\s*\{[\s\S]{0,400}overflow:\s*["']hidden["']/.test(bodySrc),
    ).toBe(true);
  });

  test("the brand EventCoverMedia passes label=\"\" (no 'COVE…' truncated 'Cover' text)", () => {
    expect(
      /mediaUrl=\{brand\.coverMediaUrl[\s\S]{0,600}label=""/.test(bodySrc),
    ).toBe(true);
  });

  // [TEST-MOD-APPROVED META-ORCH-1174] — Leg A.2 moved the brand cover read off a
  // direct `.from("brands").select("...cover_media_type, cover_hue")` onto the
  // canonical `pg_public_trip_by_slug` RPC payload (`brand.coverMediaType` /
  // `brand.coverHue`). The FIX-3 invariant (the chip gets a media-aware brand
  // cover type + hue, coerced) is unchanged — only the source moved to the RPC.
  test("the public-trip hook maps the RPC brand coverMediaType + coverHue (coerced)", () => {
    expect(
      /coverMediaType:\s*coerceBrandCoverType\(p\.brand\.coverMediaType\)/.test(
        hookSrc,
      ),
    ).toBe(true);
    expect(/coverHue:\s*numOrNull\(p\.brand\.coverHue\)/.test(hookSrc)).toBe(true);
  });

  test("coerceBrandCoverType maps unknown/null → null (no fabricated type, no broken alt)", () => {
    expect(
      /coerceBrandCoverType[\s\S]{0,260}return null;/.test(hookSrc),
    ).toBe(true);
  });
});

describe("ORCH-1138 FIX-6 — Cancellation BEFORE How-you-pay (business/web)", () => {
  // STRUCTURAL fails-on-revert in the shared body: §9 Cancellation (the
  // TripRefundLadder block) must render BEFORE §10 "Choose how you pay". Swapping
  // them back (the pre-1138 pay-then-refund order) makes the cancellation testID
  // come AFTER the pay-box heading → this test fails.
  test("the §9 cancellation block precedes the §10 pay box", () => {
    // Anchor on the JSX testIDs (not the heading text, which also appears in the
    // file's section-order doc comment): the cancellation testID must precede the
    // pay-box testID in the rendered body.
    const cancellationIdx = bodySrc.indexOf('testID="trip-body-cancellation"');
    const payBoxIdx = bodySrc.indexOf('testID="trip-body-pay-box"');
    expect(cancellationIdx).toBeGreaterThan(-1);
    expect(payBoxIdx).toBeGreaterThan(-1);
    expect(cancellationIdx).toBeLessThan(payBoxIdx);
  });

  test("the 'Choose how you pay' heading still renders (block intact, just reordered)", () => {
    expect(/Choose how you pay/.test(bodySrc)).toBe(true);
    expect(/TripRefundLadder/.test(bodySrc)).toBe(true);
  });
});
