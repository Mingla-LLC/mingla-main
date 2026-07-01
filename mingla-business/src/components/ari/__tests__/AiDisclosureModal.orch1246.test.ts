/**
 * ORCH-1246 (Apple 2.1a) — "Meet Ari" disclosure must always show its dismiss
 * CTA on every device (iPad included). The owner's decision: NO X / close button;
 * the existing "Got it — let's start" CTA must simply always be on-screen.
 *
 * Two guards:
 *   1. resolveSheetMaxHeight — pure: the sheet height is the SMALLER of 88% of
 *      the viewport and a fixed POINT cap, so a tall iPad viewport can't stretch
 *      the sheet and bury the footer CTA.
 *   2. Source assertions — the footer padding is safe-area aware
 *      (useSafeAreaInsets + Math.max(insets.bottom, …)), and the sheet has a
 *      maxWidth point cap. Reverting either makes this FAIL.
 */
import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

import { resolveSheetMaxHeight } from "../aiDisclosureSheetLayout";

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "AiDisclosureModal.tsx"),
  "utf8",
);

describe("resolveSheetMaxHeight (ORCH-1246 Apple 2.1a)", () => {
  test("phone viewport → 88% (well under the point cap)", () => {
    // iPhone-ish ~844pt tall: 88% = 742.7 > 640 cap → capped at 640.
    // A short viewport stays at 88%.
    expect(resolveSheetMaxHeight(600)).toBeCloseTo(528, 5); // 600 * 0.88
  });

  test("tall iPad viewport → POINT cap, not 88% (footer stays in view)", () => {
    // iPad Air 11" portrait ~1180pt: 88% = 1038.4 — the cap MUST win.
    const capped = resolveSheetMaxHeight(1180);
    expect(capped).toBeLessThan(1180 * 0.88);
    expect(capped).toBe(640);
  });

  test("is the MIN of 88% and the cap (never exceeds the cap)", () => {
    for (const h of [400, 800, 1180, 2000]) {
      expect(resolveSheetMaxHeight(h)).toBeLessThanOrEqual(640);
      expect(resolveSheetMaxHeight(h)).toBeLessThanOrEqual(h * 0.88 + 0.001);
    }
  });
});

describe("AiDisclosureModal source guards (ORCH-1246 Apple 2.1a)", () => {
  test("footer paddingBottom is safe-area aware (insets.bottom)", () => {
    expect(SOURCE).toContain("useSafeAreaInsets");
    expect(SOURCE).toMatch(/paddingBottom:\s*Math\.max\(insets\.bottom/);
  });

  test("sheet is capped on large screens (point maxHeight + maxWidth)", () => {
    expect(SOURCE).toMatch(/maxHeight:\s*sheetMaxHeight/);
    expect(SOURCE).toMatch(/maxWidth:\s*520/);
  });

  // ORCH-1248 (Apple 2.1a) SUPERSEDES the ORCH-1246 "no X button" decision:
  // build 15's single-CTA approach still trapped the reviewer (BlurView swallowed
  // the tap on iOS 26). The new contract requires REDUNDANT escape routes.
  test("CTA still present and wired to onAccept", () => {
    expect(SOURCE).toContain("Got it");
    expect(SOURCE).toContain("onPress={onAccept}");
  });
});
