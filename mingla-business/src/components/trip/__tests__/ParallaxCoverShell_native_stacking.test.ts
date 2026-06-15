/**
 * ORCH-1138 [trip-page-redesign] — NATIVE parallax stacking regression test.
 *
 * Device-confirmed bug (Seth, business dev build): on the public trip page
 * `/t/{brandSlug}/{tripSlug}` the DETAILS body scrolled BEHIND the cover on
 * NATIVE RN (the intended parallax — cover pinned, body slides UP and OVER it —
 * worked on react-native-web but inverted on native).
 *
 * ROOT CAUSE: RN native has no `position:fixed`; it resolves z-order by SIBLING
 * zIndex within a shared parent + tree order. The three direct children of the
 * native host are the absolute cover (zIndex 1), the ScrollView (content host),
 * and the absolute chrome (zIndex 70). The ScrollView carried NO zIndex
 * (auto = 0), so the absolute cover (zIndex 1) painted OVER it. The `zIndex: 2`
 * set only on the inner `nativeBody` was inert — it ordered the body against the
 * spacer, not against the cover (which is a sibling of the ScrollView, one level
 * up). FIX: z-index the ScrollView itself so the content layer sits between the
 * cover and the chrome: cover (COVER_Z) < content (CONTENT_Z) < chrome (CHROME_Z).
 *
 * Contract (must hold on BOTH native + react-native-web):
 *   cover (lowest) < content (middle, opaque, slides over) < chrome (highest).
 *
 * Source-structure test (mirrors TripVisualParity.test.ts) so it runs under the
 * default mingla-business node/ts-jest config without RTL. The visual parallax
 * itself still needs on-device confirmation (Seth re-tests via a dev OTA).
 *
 * Spec: Mingla_Artifacts/specs/SPEC_ORCH-1138_LEG1_FOUNDATION_AND_TRIP.md §4.1.1
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const SHELL_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "packages",
  "offering-rendering",
  "ParallaxCoverShell.tsx",
);
const SRC = readFileSync(SHELL_PATH, "utf8");

/** Extract `export const NAME = <int>;` from the shell source. */
function constValue(name: string): number {
  const m = SRC.match(new RegExp(`export const ${name} = (\\d+);`));
  if (m == null) throw new Error(`constant ${name} not exported`);
  return Number(m[1]);
}

/** Extract the body of a StyleSheet.create entry `NAME: { ... }`. */
function styleBlock(name: string): string {
  const m = SRC.match(new RegExp(`\\b${name}:\\s*\\{([\\s\\S]*?)\\n  \\},`));
  if (m == null) throw new Error(`style block ${name} not found`);
  return m[1];
}

describe("ORCH-1138 ParallaxCoverShell — native z-order contract", () => {
  it("exports the 3-layer z-index contract ordered cover < content < chrome", () => {
    const cover = constValue("COVER_Z");
    const content = constValue("CONTENT_Z");
    const chrome = constValue("CHROME_Z");
    expect(cover).toBeLessThan(content);
    expect(content).toBeLessThan(chrome);
  });

  it("native ScrollView (content layer) carries an explicit zIndex above the cover (THE FIX — fails-on-revert)", () => {
    // The load-bearing fix: the native Scroll element wires the content-layer
    // style. Without it the ScrollView is auto-z (0) and the absolute cover
    // (zIndex 1) paints over the scrolling body — the device-confirmed bug.
    expect(SRC).toMatch(/<Scroll\b[\s\S]*?style=\{styles\.nativeScroll\}/);

    const nativeScroll = styleBlock("nativeScroll");
    expect(nativeScroll).toMatch(/zIndex:\s*CONTENT_Z/);

    // And the content layer's zIndex MUST be strictly above the cover's.
    expect(constValue("CONTENT_Z")).toBeGreaterThan(constValue("COVER_Z"));
  });

  it("native cover is the lowest layer (zIndex COVER_Z) and is absolutely positioned out of scroll flow", () => {
    const cover = styleBlock("nativeCover");
    expect(cover).toMatch(/position:\s*"absolute"/);
    expect(cover).toMatch(/zIndex:\s*COVER_Z/);
  });

  it("native chrome is the highest layer (zIndex CHROME_Z) and absolutely positioned", () => {
    const chrome = styleBlock("nativeChrome");
    expect(chrome).toMatch(/position:\s*"absolute"/);
    expect(chrome).toMatch(/zIndex:\s*CHROME_Z/);
  });

  it("native body has an opaque page background so it occludes the cover as it slides over", () => {
    // The opaque bg is applied inline from palette.page on the nativeBody View.
    expect(SRC).toMatch(/styles\.nativeBody[\s\S]*?backgroundColor:\s*palette\.page/);
  });

  it("native spacer holds the full cover height so the body starts below the cover then slides over it", () => {
    const spacer = styleBlock("nativeSpacer");
    const cover = styleBlock("nativeCover");
    // Spacer aspect ratio matches the cover aspect ratio (4/5) — equal visible height.
    expect(spacer).toMatch(/aspectRatio:\s*4\s*\/\s*5/);
    expect(cover).toMatch(/aspectRatio:\s*4\s*\/\s*5/);
  });

  it("web parallax is preserved — web cover/content/chrome reference the SAME contract constants", () => {
    // The fix did not regress the web branch the tester already passed: the
    // web phone branch's pinned cover, sliding body, and fixed chrome all read
    // the shared COVER_Z / CONTENT_Z / CHROME_Z constants (values unchanged).
    expect(SRC).toMatch(/position:\s*"fixed"[\s\S]*?zIndex:\s*COVER_Z/);
    expect(SRC).toMatch(/position:\s*"relative",\s*\n\s*zIndex:\s*CONTENT_Z/);
    expect(SRC).toMatch(/position:\s*"fixed"[\s\S]*?zIndex:\s*CHROME_Z/);
  });
});
