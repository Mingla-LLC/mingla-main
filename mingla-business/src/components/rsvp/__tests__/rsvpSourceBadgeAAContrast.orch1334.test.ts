/**
 * ORCH-1334 [rsvp-guest-console-identity-gap] P2-1 — SourceBadge AA-contrast guard.
 *
 * Owner: mingla-implementor (rework after tester finding P2-1). The tester keeps
 * the on-device/measured adversarial re-check.
 *
 * The "On Mingla" SourceBadge text originally used the brand token accent.warm
 * (#eb7825) on the composited accent.tint fill over the dark row. The tester
 * MEASURED that pairing at 3.94:1 (iOS) / 3.38:1 (Android) — below WCAG AA 4.5:1
 * for 11px/600 normal text (violates SPEC §4E-4 + invariants I-38/I-39). The fix
 * swaps ONLY the app-badge TEXT color to the AA-safe lightened accent #ffa94d
 * (6.00:1 iOS / 5.15:1 Android). The fill (accent.tint) + border (accent.border)
 * + web badge (#7ab0ff) are unchanged.
 *
 * Two guard layers:
 *  (1) SOURCE — both rsvp components declare APP_BADGE_TEXT = "#ffa94d" and the
 *      SourceBadge app branch renders APP_BADGE_TEXT (NOT accent.warm). Reverting
 *      the color literal fails these — the fails-on-revert anchor.
 *  (2) MATH — the composited WCAG contrast of #ffa94d clears AA on both platforms,
 *      #7ab0ff (web) clears AA, and the OLD #eb7825 did NOT (documents the defect).
 */

import { readFileSync } from "fs";
import { join } from "path";

const CONSOLE_SRC = readFileSync(
  join(__dirname, "..", "RsvpGuestConsole.tsx"),
  "utf8",
);
const SHEET_SRC = readFileSync(
  join(__dirname, "..", "RsvpGuestDetailSheet.tsx"),
  "utf8",
);

// ---- (1) SOURCE guards (fail on revert to accent.warm) ----
describe("ORCH-1334 P2-1 — SourceBadge app-badge text uses the AA-safe token", () => {
  it.each([
    ["RsvpGuestConsole.tsx", CONSOLE_SRC],
    ["RsvpGuestDetailSheet.tsx", SHEET_SRC],
  ])("%s declares APP_BADGE_TEXT = '#ffa94d'", (_name, src) => {
    expect(src).toMatch(/const\s+APP_BADGE_TEXT\s*=\s*["']#ffa94d["']/);
  });

  it.each([
    ["RsvpGuestConsole.tsx", CONSOLE_SRC],
    ["RsvpGuestDetailSheet.tsx", SHEET_SRC],
  ])(
    "%s renders the app SourceBadge text with APP_BADGE_TEXT",
    (_name, src) => {
      expect(src).toMatch(/color:\s*isApp\s*\?\s*APP_BADGE_TEXT\s*:\s*WEB_BADGE_TEXT/);
    },
  );

  it.each([
    ["RsvpGuestConsole.tsx", CONSOLE_SRC],
    ["RsvpGuestDetailSheet.tsx", SHEET_SRC],
  ])(
    "%s does NOT color the app SourceBadge text with accent.warm (the failing token)",
    (_name, src) => {
      expect(src).not.toMatch(/color:\s*isApp\s*\?\s*accent\.warm/);
    },
  );

  it.each([
    ["RsvpGuestConsole.tsx", CONSOLE_SRC],
    ["RsvpGuestDetailSheet.tsx", SHEET_SRC],
  ])(
    "%s leaves the badge FILL (accent.tint) + border (accent.border) untouched",
    (_name, src) => {
      expect(src).toMatch(/backgroundColor:\s*accent\.tint,\s*borderColor:\s*accent\.border/);
    },
  );

  it.each([
    ["RsvpGuestConsole.tsx", CONSOLE_SRC],
    ["RsvpGuestDetailSheet.tsx", SHEET_SRC],
  ])("%s keeps the web badge token #7ab0ff", (_name, src) => {
    expect(src).toMatch(/const\s+WEB_BADGE_TEXT\s*=\s*["']#7ab0ff["']/);
  });
});

// ---- (2) WCAG contrast math (independent, self-contained) ----
type RGB = [number, number, number];
type RGBA = [number, number, number, number];

const hexToRgb = (hex: string): RGB => {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
};

const srgbToLin = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]: RGB): number =>
  0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);

const contrast = (fg: RGB, bg: RGB): number => {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
};

// alpha-composite a translucent fg over an opaque bg
const over = ([fr, fg, fb, fa]: RGBA, [br, bg, bb]: RGB): RGB => [
  fa * fr + (1 - fa) * br,
  fa * fg + (1 - fa) * bg,
  fa * fb + (1 - fa) * bb,
];

// design tokens (mingla-business/src/constants/designSystem.ts)
const CANVAS: RGB = [12, 14, 18]; // canvas.discover #0c0e12
const ACCENT_TINT: RGBA = [235, 120, 37, 0.28]; // accent.tint rgba(235,120,37,0.28)
const INFO_TINT: RGBA = [59, 130, 246, 0.18]; // semantic.infoTint
const PROFILE_BASE: RGBA = [255, 255, 255, 0.04]; // glass.tint.profileBase (iOS row)
const ANDROID_ROW: RGB = [35, 38, 43]; // #23262b (Android opaque row)

const IOS_ROW = over(PROFILE_BASE, CANVAS);
const IOS_APP_FILL = over(ACCENT_TINT, IOS_ROW);
const AND_APP_FILL = over(ACCENT_TINT, ANDROID_ROW);
const IOS_WEB_FILL = over(INFO_TINT, IOS_ROW);
const AND_WEB_FILL = over(INFO_TINT, ANDROID_ROW);

const APP_TEXT = hexToRgb("#ffa94d"); // fix
const WEB_TEXT = hexToRgb("#7ab0ff"); // web badge (unchanged)
const OLD_APP_TEXT = hexToRgb("#eb7825"); // accent.warm — the defect
const AA_NORMAL = 4.5;

describe("ORCH-1334 P2-1 — composited WCAG contrast clears AA 4.5:1", () => {
  it('"On Mingla" #ffa94d clears AA on the accent.tint fill (iOS + Android)', () => {
    expect(contrast(APP_TEXT, IOS_APP_FILL)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(contrast(APP_TEXT, AND_APP_FILL)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('"RSVP\'d on web" #7ab0ff clears AA on the info-tint fill (iOS + Android)', () => {
    expect(contrast(WEB_TEXT, IOS_WEB_FILL)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(contrast(WEB_TEXT, AND_WEB_FILL)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("the OLD accent.warm #eb7825 FAILED AA on both platforms (regression documented)", () => {
    expect(contrast(OLD_APP_TEXT, IOS_APP_FILL)).toBeLessThan(AA_NORMAL);
    expect(contrast(OLD_APP_TEXT, AND_APP_FILL)).toBeLessThan(AA_NORMAL);
  });
});
