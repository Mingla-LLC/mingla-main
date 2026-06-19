// ORCH-1162 Bug 3 — Button brand-accent contrast helpers. (implementor-owned
// happy-path; Deno-runnable — buttonAccentContrast.ts is pure.)
//
// THE FIX (3A): the three checkout CTAs hardcoded Mingla orange via
// variant="primary". The Button now takes an optional accentColor (primary only)
// and auto-resolves the label color for legibility on ANY brand hue, using these
// pure WCAG helpers.
//
// FAILS-ON-REVERT: drop readableTextFor's contrast comparison (or normalizeHex's
// validation) and these assertions FAIL — the label no longer flips for
// contrast, or invalid hex is accepted. Verified by true line-deletion in the
// implementation report. The CTA-themed behavior is additionally proven by the
// Button source carrying accentColor (see the report's source-level proof).
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  contrastRatio,
  mixHex,
  normalizeHex,
  readableTextFor,
} from "../buttonAccentContrast.ts";

Deno.test("TC-9: normalizeHex accepts valid 3/6-char hex, rejects junk", () => {
  assertEquals(normalizeHex("#1d4ed8"), "#1d4ed8");
  assertEquals(normalizeHex("1D4ED8"), "#1d4ed8");
  assertEquals(normalizeHex("#abc"), "#aabbcc");
  assertEquals(normalizeHex("not-a-hex"), null);
  assertEquals(normalizeHex("#12345"), null);
});

Deno.test("TC-11: label color flips for contrast on extreme hues (≥4.5:1)", () => {
  // Yellow (coverHue ~55, hsl(55,60%,45%) ≈ #b8a51d) → black label.
  const yellow = normalizeHex("#b8a51d");
  assert(yellow !== null);
  assertEquals(readableTextFor(yellow), "#000000");
  assert(contrastRatio("#000000", yellow) >= 4.5, "black on yellow ≥4.5:1");

  // Deep blue (#1d4ed8) → white label.
  const blue = normalizeHex("#1d4ed8");
  assert(blue !== null);
  assertEquals(readableTextFor(blue), "#ffffff");
  assert(contrastRatio("#ffffff", blue) >= 4.5, "white on blue ≥4.5:1");

  // Mingla orange (#eb7825) — the default; confirm a legible label resolves.
  const orange = normalizeHex("#eb7825");
  assert(orange !== null);
  const label = readableTextFor(orange);
  assert(contrastRatio(label, orange) >= 4.5, "resolved label on orange ≥4.5:1");
});

Deno.test("TC-9b: mixHex lightens toward white (web hover shade)", () => {
  const hover = mixHex("#1d4ed8", "#ffffff", 0.06);
  // 6% toward white → strictly lighter than the base (every channel ≥ base).
  assert(hover !== "#1d4ed8");
  assert(contrastRatio(hover, "#000000") > contrastRatio("#1d4ed8", "#000000"));
});
