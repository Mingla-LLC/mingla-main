/**
 * #4389 (iPhone 15 screenshot of F4 "You're all set.") — the Tap to Pay on
 * iPhone card drew Apple's art at full width and its own 720×559 aspect ratio
 * (~260pt tall on an iPhone 15), so the button and the offering list fell far
 * below the fold. The design (.ttph .vis) is a 186pt band, overflow hidden,
 * with the art 330pt wide pinned right -26 / top -6.
 *
 * Source-level on purpose: jest has no layout engine, and the band is pure
 * style. FAILS ON REVERT: the old `width: "100%", aspectRatio: 720 / 559` art,
 * or the band wrapper / its 186pt height removed.
 */
import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

// The card moved into the door chunk (F4TapToPayCard.tsx) to keep __common small.
const src = fs.readFileSync(path.join(__dirname, "..", "..", "door", "tap", "F4TapToPayCard.tsx"), "utf8");

describe("#4389 — F4 Tap to Pay visual is a short cropped band", () => {
  test("B1: the band is 186pt and clips the art", () => {
    expect(src).toMatch(/export const TTP_BAND_HEIGHT = 186;/);
    expect(src).toMatch(/band: \{ height: TTP_BAND_HEIGHT, overflow: "hidden"/);
  });

  test("B2: the art sits inside the band, 330pt wide, never full-width by aspect ratio", () => {
    expect(src).toMatch(/<View style=\{styles\.band\}[^>]*>\s*<Image source=\{TTP_VISUAL\} style=\{styles\.visual\}/);
    expect(src).toMatch(/export const TTP_ART_WIDTH = 330;/);
    expect(src).toMatch(/visual: \{ position: "absolute", right: -26, top: -6, width: TTP_ART_WIDTH/);
    expect(src).not.toMatch(/aspectRatio: 720 \/ 559/);
  });
});
