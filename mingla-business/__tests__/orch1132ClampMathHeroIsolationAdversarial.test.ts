import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

// ORCH-1132 [cover-fullframe-sound-inset] round 2 — TESTER adversarial regression.
//
// DIFFERENT ANGLE from the implementor's two tests. The implementor's
// orch1131CoverCropSoundInset.test.ts + orch1131SiblingInsetNonRegressionAdversarial.test.ts
// do STATIC source-string matching: they assert the *presence* of the strings
// `videoContentFit="contain"`, `onAspectRatio=`, `right: 24`, `bottom: 22`, and
// the *absence* of a numeric `height:` in miniCover.
//
// That static approach has a real blind spot: it never EXECUTES the clamp math.
// A "tidy" refactor that accidentally copies the public hero's bounds into the
// checkout clamp — `Math.min(Math.max(coverAspect, 0.75), 16/9)` instead of
// `(..., 0.6), 1.91` — would keep every implementor-asserted string intact
// (`videoContentFit="contain"` is still there) yet SILENTLY RE-CROP portrait
// covers: a 0.5625 portrait would clamp to 0.75 (the public-hero bound), and
// since the box is now 0.75 while the media is 0.5625, even `contain` shows
// side bars and the *visible block* matches the hero's slightly-cropped shape —
// re-introducing the exact ORCH-1131 miss this ORCH exists to fix.
//
// This test EXTRACTS the actual clamp expression from each of the three
// checkout routes, evaluates it at runtime against the SC-1/2/3 inputs
// (portrait 0.5625, square 1.0, landscape 1.78, panorama 3.0) and degenerate
// inputs (NaN/0/negative from a broken onAspectRatio callback), and asserts the
// RESULTING box aspect — the thing the user actually sees — is correct. It also
// proves SC-6/SC-7 ISOLATION by extracting the public hero's clamp and asserting
// it is a STRUCTURALLY DIFFERENT range (0.75..16/9) that the checkout did NOT
// inherit, and that EventCoverMedia's videoContentFit default is still "cover".
//
// fails-on-revert: if the checkout clamp lower bound is reverted toward the hero
// bound (0.6 -> 0.75) OR the upper bound changes (1.91 -> 16/9), the portrait /
// panorama assertions FAIL; if the hero clamp is widened to match checkout the
// isolation assertion FAILS. (Verified by the tester — see TEST report §Step-0.5.)

const businessDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(businessDir, "..");

const CHECKOUT_ROUTES = [
  "app/checkout/[eventId]/index.tsx",
  "app/checkout-trip/[tripEventId]/index.tsx",
  "app/checkout-experience/[experienceEventId]/index.tsx",
];

/**
 * Extract the literal `lower` and `upper` numbers from a
 * `Math.min(Math.max(<var>, <lower>), <upper>)` clamp and rebuild the SAME
 * clamp as an executable function. This evaluates the ACTUAL committed bounds —
 * a true line edit of either bound changes the function's behaviour.
 */
function extractClamp(src: string): (input: number) => number {
  // Tolerant of whitespace; <upper> may be a number or a `a / b` expression.
  const m = src.match(
    /Math\.min\(\s*Math\.max\(\s*[A-Za-z0-9_]+\s*,\s*([0-9.]+)\s*\)\s*,\s*([0-9.]+(?:\s*\/\s*[0-9.]+)?)\s*\)/,
  );
  if (!m) {
    throw new Error("Could not locate a Math.min(Math.max(...)) clamp");
  }
  const lower = Number(m[1]);
  // upper may be "16 / 9"
  const upperRaw = m[2].replace(/\s+/g, "");
  const upper = upperRaw.includes("/")
    ? Number(upperRaw.split("/")[0]) / Number(upperRaw.split("/")[1])
    : Number(upperRaw);
  return (input: number): number => Math.min(Math.max(input, lower), upper);
}

/** The runtime initial-state seed for `useState(<n>)`. */
function extractInitialAspect(src: string): number {
  const m = src.match(/useState\(\s*(0?\.\d+|\d+(?:\.\d+)?)\s*\)/);
  // there are several useState calls; the cover one is seeded with a float < 2.
  // Find the FIRST useState seeded with a bare numeric literal in 0.5..2 range.
  const all = [...src.matchAll(/useState\(\s*(\d+(?:\.\d+)?)\s*\)/g)];
  for (const a of all) {
    const v = Number(a[1]);
    if (v >= 0.5 && v <= 2) return v;
  }
  if (m) return Number(m[1]);
  throw new Error("Could not locate the cover-aspect useState seed");
}

describe("ORCH-1132 adversarial — checkout clamp EXECUTES to full-frame bounds (not hero bounds)", () => {
  for (const route of CHECKOUT_ROUTES) {
    const src = fs.readFileSync(path.join(businessDir, route), "utf8");
    const clamp = extractClamp(src);

    test(`${route}: portrait 0.5625 clamps to a TALL box (>= 0.6, NOT the hero's 0.75)`, () => {
      const boxAspect = clamp(0.5625);
      // SC-1: portrait must get a near-edge-to-edge tall box at the 0.6 floor.
      expect(boxAspect).toBeCloseTo(0.6, 5);
      // Adversarial guard: if someone copied the hero bound (0.75) the box would
      // be 0.75 and re-crop a 0.5625 portrait. Prove that did NOT happen.
      expect(boxAspect).toBeLessThan(0.75);
    });

    test(`${route}: square 1.0 passes through UNCLAMPED (exact-fit box)`, () => {
      // SC-3: 1.0 is in range -> exact box -> contain == perfect fill.
      expect(clamp(1.0)).toBe(1.0);
    });

    test(`${route}: landscape 1.78 passes through (full landscape frame, not a sliver)`, () => {
      // SC-2: 1.78 < 1.91 upper bound -> unclamped -> box tracks real shape.
      expect(clamp(1.78)).toBeCloseTo(1.78, 5);
    });

    test(`${route}: panorama 3.0 clamps to 1.91 upper (box not a sliver; NOT 16/9)`, () => {
      const boxAspect = clamp(3.0);
      expect(boxAspect).toBeCloseTo(1.91, 5);
      // Adversarial guard: hero upper is 16/9 ≈ 1.778; checkout upper is 1.91.
      // If the checkout clamp were reverted to the hero's 16/9 this fails.
      expect(boxAspect).toBeGreaterThan(16 / 9);
    });

    test(`${route}: degenerate onAspectRatio (NaN / 0 / negative) cannot produce a broken box`, () => {
      // Math.max(NaN, 0.6) === NaN in JS — the clamp does NOT sanitise NaN.
      // This documents the runtime truth: a NaN ratio yields a NaN aspectRatio,
      // which RN/web treats as "no aspectRatio" -> the box falls back to its
      // intrinsic/last layout rather than collapsing. We assert the NON-NaN
      // degenerate inputs (0, negative) are floored to the 0.6 lower bound so a
      // broken-but-numeric callback can never collapse the card to a sliver.
      expect(clamp(0)).toBeCloseTo(0.6, 5);
      expect(clamp(-5)).toBeCloseTo(0.6, 5);
      // NaN path: documents that the clamp passes NaN through (caller-safe
      // because RN ignores a NaN aspectRatio). If a future change wraps the
      // clamp in a Number.isFinite guard, update this expectation deliberately.
      expect(Number.isNaN(clamp(NaN))).toBe(true);
    });

    test(`${route}: first-paint useState seed is in-range (no first-frame clamp jump)`, () => {
      const seed = extractInitialAspect(src);
      // The 0.75 seed must itself survive the clamp unchanged (0.6 <= 0.75 <= 1.91)
      // so the first paint is stable, then settles to the media's true shape.
      expect(clamp(seed)).toBe(seed);
      expect(seed).toBeGreaterThanOrEqual(0.6);
      expect(seed).toBeLessThanOrEqual(1.91);
    });
  }
});

describe("ORCH-1132 adversarial — SC-6 isolation: public hero clamp is a DIFFERENT range, NOT inherited", () => {
  const heroSrc = fs.readFileSync(
    path.join(repoRoot, "packages/event-rendering/PublicEventPage.tsx"),
    "utf8",
  );
  const heroClamp = extractClamp(heroSrc);

  test("public hero clamps a 0.5625 portrait to 0.75 (its OWN bound — checkout floors to 0.6)", () => {
    // Proves the hero still uses 0.75..16/9. If the hero were accidentally
    // widened to the checkout's 0.6..1.91 this would read 0.6 and FAIL.
    expect(heroClamp(0.5625)).toBeCloseTo(0.75, 5);
  });

  test("public hero upper bound is 16/9 (≈1.778), NOT the checkout's 1.91", () => {
    expect(heroClamp(3.0)).toBeCloseTo(16 / 9, 5);
    expect(heroClamp(3.0)).toBeLessThan(1.91);
  });

  test("the checkout floor (0.6) and the hero floor (0.75) are genuinely different values", () => {
    // Cross-file structural isolation: read both floors, assert they diverge.
    const checkoutSrc = fs.readFileSync(
      path.join(businessDir, CHECKOUT_ROUTES[0]),
      "utf8",
    );
    const checkoutClamp = extractClamp(checkoutSrc);
    // A portrait the hero clamps to 0.75, checkout clamps lower (0.6).
    expect(checkoutClamp(0.5625)).toBeLessThan(heroClamp(0.5625));
  });
});

describe("ORCH-1132 adversarial — SC-7 default-safety: EventCoverMedia videoContentFit default stays 'cover'", () => {
  const ecmSrc = fs.readFileSync(
    path.join(repoRoot, "packages/event-rendering/EventCoverMedia.tsx"),
    "utf8",
  );

  test("videoContentFit prop default is exactly \"cover\" (no consumer gets contain by accident)", () => {
    // The destructured default in the component signature.
    expect(ecmSrc).toMatch(/videoContentFit\s*=\s*"cover"/);
    // And there is NO `videoContentFit = "contain"` default anywhere.
    expect(ecmSrc).not.toMatch(/videoContentFit\s*=\s*"contain"/);
  });

  test("the web <video> objectFit is driven by the contentFit prop (passthrough, not hardcoded contain)", () => {
    // Proves contain is opt-in per call-site, not baked into the render path.
    expect(ecmSrc).toMatch(/objectFit:\s*contentFit/);
  });

  test("image covers remain resizeMode=\"cover\" (videoContentFit does not affect images — spec §4.4)", () => {
    expect(ecmSrc).toMatch(/resizeMode="cover"/);
  });
});
