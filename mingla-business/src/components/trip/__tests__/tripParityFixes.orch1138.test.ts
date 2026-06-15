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

const previewSrc = read("src/components/trip/TripPreview.tsx");
const hookSrc = read("src/hooks/usePublicTripBySlug.ts");

describe("ORCH-1138 FIX-2 — destination normalized everywhere (business/web)", () => {
  test("the eyebrow trailing destination uses destinationCityCountry (not raw)", () => {
    // phone leadBlock eyebrow + desktop hero eyebrow both append the normalized
    // value; the raw `bt.destinationLocationText` must NOT be appended to either.
    expect(
      /` · \$\{destinationCityCountry\}`/.test(previewSrc),
    ).toBe(true);
    expect(
      /` · \$\{bt\.destinationLocationText\}`/.test(previewSrc),
    ).toBe(false);
  });

  test("the 📍 location chip renders destinationCityCountry (icon='location')", () => {
    // The location MetaChip child is the normalized value, gated on it being non-null.
    expect(
      /destinationCityCountry != null \? \([\s\S]{0,260}icon="location"[\s\S]{0,120}\{destinationCityCountry\}/.test(
        previewSrc,
      ),
    ).toBe(true);
  });

  test("the route block still normalizes both legs (shared normalizer, not forked)", () => {
    expect(
      /const departureCityCountry = normalizeCityCountry\(bt\.departureLocationText\)/.test(
        previewSrc,
      ),
    ).toBe(true);
    expect(
      /const destinationCityCountry = normalizeCityCountry\(bt\.destinationLocationText\)/.test(
        previewSrc,
      ),
    ).toBe(true);
  });
});

describe("ORCH-1138 FIX-3 — brand cover is media-aware (business/web)", () => {
  test("the brand chip renders EventCoverMedia inside the brandTile (not a plain <Image>)", () => {
    expect(
      /<View style=\{styles\.brandTile\}>[\s\S]{0,300}<EventCoverMedia/.test(
        previewSrc,
      ),
    ).toBe(true);
  });

  test("EventCoverMedia receives the brand cover url + TYPE + hue (animated covers render)", () => {
    expect(/mediaUrl=\{brand\.coverMediaUrl \?\? null\}/.test(previewSrc)).toBe(
      true,
    );
    expect(
      /mediaType=\{brand\.coverMediaType \?\? null\}/.test(previewSrc),
    ).toBe(true);
    expect(/hue=\{brand\.coverHue/.test(previewSrc)).toBe(true);
  });

  test("the brandTile clips its media (overflow:'hidden') so a video/gif stays circular", () => {
    expect(
      /brandTile:\s*\{[\s\S]{0,400}overflow:\s*["']hidden["']/.test(previewSrc),
    ).toBe(true);
  });

  test("the brand EventCoverMedia passes label=\"\" (no 'COVE…' truncated 'Cover' text)", () => {
    expect(
      /mediaUrl=\{brand\.coverMediaUrl[\s\S]{0,600}label=""/.test(previewSrc),
    ).toBe(true);
  });

  test("the public-trip hook selects + maps cover_media_type and cover_hue from brands", () => {
    expect(/cover_media_type/.test(hookSrc)).toBe(true);
    expect(/cover_hue/.test(hookSrc)).toBe(true);
    expect(
      /coverMediaType:\s*coerceBrandCoverType\(brand\.cover_media_type\)/.test(
        hookSrc,
      ),
    ).toBe(true);
  });

  test("coerceBrandCoverType maps unknown/null → null (no fabricated type, no broken alt)", () => {
    expect(
      /coerceBrandCoverType[\s\S]{0,260}return null;/.test(hookSrc),
    ).toBe(true);
  });
});

describe("ORCH-1138 FIX-6 — Cancellation BEFORE How-you-pay (business/web)", () => {
  // STRUCTURAL fails-on-revert (comment-independent): in the LEFT column the
  // `{refundBlock}` render token must precede the phone payment block, whose
  // body is the `{paymentBlock}` token rendered under the "Choose how you pay"
  // heading. Swapping the two JSX blocks back (the pre-1138 payment-then-refund
  // order) makes `{refundBlock}` come AFTER `{paymentBlock}` → this test fails.
  test("the {refundBlock} render precedes the inline {paymentBlock} render", () => {
    const refundRenderIdx = previewSrc.indexOf("{refundBlock}");
    // the phone payment block renders {paymentBlock} (the desktop sticky panel
    // also renders it, wrapped in deskPayWrap — exclude that by taking the FIRST
    // bare "{paymentBlock}\n" occurrence, which is the phone left-column one).
    const phonePaymentIdx = previewSrc.indexOf("          {paymentBlock}\n");
    expect(refundRenderIdx).toBeGreaterThan(-1);
    expect(phonePaymentIdx).toBeGreaterThan(-1);
    expect(refundRenderIdx).toBeLessThan(phonePaymentIdx);
  });

  test("the 'Choose how you pay' heading still renders (block intact, just reordered)", () => {
    expect(/Choose how you pay/.test(previewSrc)).toBe(true);
    expect(/Cancellation policy/.test(previewSrc)).toBe(true);
  });
});
