import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

// ORCH-1132 [cover-fullframe-sound-inset] round 2 — TESTER adversarial regression.
// ORCH-1133 [TEST-MOD-APPROVED ORCH-1133] round 3 — INVERTED.
//
// Round 2 (ORCH-1132) introduced an adaptive checkout cover whose box aspectRatio
// was driven by an in-screen `Math.min(Math.max(coverAspect, 0.6), 1.91)` clamp.
// This file EXECUTED that clamp and asserted its math.
//
// ORCH-1133 REVERTS the checkout cover to the e90875dda~1 compact fixed 64px band
// (Seth round-3 reject: "The cover fills the entire screen. Revert to original.").
// The checkout clamp NO LONGER EXISTS — so the old `extractClamp(checkoutSrc)`
// would throw, and asserting the clamp's math is meaningless. The append-only CI
// gate (ORCH-0840) forbids DELETING a test file outright (no token bypasses a
// deletion), so this file is INVERTED in place (MODIFY, token-covered) into the
// durable guard that the clamp must STAY gone, while preserving the still-valid
// SC-6 public-hero isolation + SC-7 EventCoverMedia default-safety checks.
//
//   (A) NO checkout route may re-introduce a `Math.min(Math.max(...))` cover-
//       aspect clamp, a `coverAspect`/`clampedCoverAspect` state, an
//       `onAspectRatio=` cover prop, a `videoContentFit=` cover prop, or an inline
//       cover `aspectRatio` — the exact ORCH-1131/1132 additions the revert undid.
//       Each route's miniCover must declare the fixed `height: 64` band.
//   (B) The public-event HERO clamp (PublicEventPage) is UNCHANGED — it still
//       uses its OWN 0.75..16/9 range. The revert was scoped away from the hero
//       (spec §2 DO-NOT-TOUCH); a "tidy" that drags the hero clamp out with the
//       checkout clamp would break the public page. This stays a live guard.
//   (C) EventCoverMedia's `videoContentFit` default stays "cover" (no consumer
//       silently gets "contain").
//
// fails-on-revert: if any checkout route re-adds the clamp / onAspectRatio /
// videoContentFit / inline aspectRatio (i.e. a future ORCH-1132-style change),
// the (A) assertions FAIL; if the public hero clamp is removed/changed, (B) FAILS.

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
 * clamp as an executable function. Used ONLY for the public hero now (the
 * checkout clamp is gone — see this file's header).
 */
function extractClamp(src: string): (input: number) => number {
  const m = src.match(
    /Math\.min\(\s*Math\.max\(\s*[A-Za-z0-9_]+\s*,\s*([0-9.]+)\s*\)\s*,\s*([0-9.]+(?:\s*\/\s*[0-9.]+)?)\s*\)/,
  );
  if (!m) {
    throw new Error("Could not locate a Math.min(Math.max(...)) clamp");
  }
  const lower = Number(m[1]);
  const upper = eval(m[2]) as number; // safe: regex-restricted to digits/`/`
  return (input: number): number => Math.min(Math.max(input, lower), upper);
}

/** Extract the body of `styleKey: { ... }` from a StyleSheet.create block. */
function extractStyleBody(src: string, styleKey: string): string {
  const m = src.match(new RegExp(`\\n\\s*${styleKey}:\\s*\\{([\\s\\S]*?)\\n\\s*\\},`));
  if (!m) {
    throw new Error(`Could not locate \`${styleKey}:\` style block`);
  }
  return m[1];
}

/** Extract the first `<EventCoverMedia ... />` JSX call body from source. */
function extractEventCoverMediaCall(src: string): string {
  const m = src.match(/<EventCoverMedia([\s\S]*?)\/>/);
  if (!m) {
    throw new Error("Could not locate an `<EventCoverMedia ... />` call");
  }
  return m[1];
}

describe("ORCH-1133 inverted (A) — the ORCH-1132 checkout cover-aspect clamp is GONE and stays gone", () => {
  for (const route of CHECKOUT_ROUTES) {
    const src = fs.readFileSync(path.join(businessDir, route), "utf8");

    test(`${route}: NO Math.min(Math.max(...)) cover-aspect clamp`, () => {
      expect(src).not.toMatch(/Math\.min\(\s*Math\.max\(/);
    });

    test(`${route}: NO coverAspect / clampedCoverAspect state`, () => {
      expect(src).not.toMatch(/coverAspect/);
      expect(src).not.toMatch(/clampedCoverAspect/);
    });

    test(`${route}: the EventCoverMedia cover call has NO onAspectRatio / videoContentFit / inline aspectRatio`, () => {
      const call = extractEventCoverMediaCall(src);
      expect(call).not.toMatch(/onAspectRatio=/);
      expect(call).not.toMatch(/videoContentFit=/);
      expect(call).not.toMatch(/aspectRatio:/);
    });

    test(`${route}: miniCover declares the fixed compact height: 64 band`, () => {
      const body = extractStyleBody(src, "miniCover");
      expect(body).toMatch(/^\s*height:\s*64,/m);
    });
  }
});

describe("ORCH-1133 inverted (B) — public hero clamp UNCHANGED (revert scoped away from the hero)", () => {
  const heroSrc = fs.readFileSync(
    path.join(repoRoot, "packages/event-rendering/PublicEventPage.tsx"),
    "utf8",
  );
  const heroClamp = extractClamp(heroSrc);

  test("public hero still clamps a 0.5625 portrait to its OWN 0.75 bound", () => {
    expect(heroClamp(0.5625)).toBeCloseTo(0.75, 5);
  });

  test("public hero upper bound is still 16/9 (≈1.778), not the old checkout 1.91", () => {
    expect(heroClamp(3.0)).toBeCloseTo(16 / 9, 5);
    expect(heroClamp(3.0)).toBeLessThan(1.91);
  });
});

describe("ORCH-1133 inverted (C) — EventCoverMedia videoContentFit default stays 'cover'", () => {
  const ecmSrc = fs.readFileSync(
    path.join(repoRoot, "packages/event-rendering/EventCoverMedia.tsx"),
    "utf8",
  );

  test('videoContentFit prop default is exactly "cover" (no consumer gets contain by accident)', () => {
    expect(ecmSrc).toMatch(/videoContentFit\s*=\s*"cover"/);
    expect(ecmSrc).not.toMatch(/videoContentFit\s*=\s*"contain"/);
  });

  test("the web <video> objectFit is driven by the contentFit prop (passthrough)", () => {
    expect(ecmSrc).toMatch(/objectFit:\s*contentFit/);
  });

  test('image covers remain resizeMode="cover"', () => {
    expect(ecmSrc).toMatch(/resizeMode="cover"/);
  });
});
