/**
 * ORCH-1150-R2 [rsvp-retest-fixes] D-7c — WEB-PHONE parallax stacking regression test.
 *
 * Orchestrator-proven bug (from source): on web at mobile width the public
 * offering page's scroll content slid UNDER the `position:fixed` cover instead
 * of over it. The web-phone path never received the zIndex fix the NATIVE path
 * already had (`styles.nativeScroll` → CONTENT_Z).
 *
 * ROOT CAUSE: the web-phone `<Scroll>` element had NO `style` prop, so it was
 * statically positioned with auto z-index. A static/auto-z element paints in the
 * flow layer BENEATH every positioned child — including the `position:fixed`
 * cover at COVER_Z (1). The inner body View carried `zIndex: CONTENT_Z`, but that
 * only orders the body against the spacer WITHIN the Scroll's own stacking
 * context — NOT against the host-level fixed cover (a sibling of the Scroll, one
 * level up). So the entire scroll body rendered behind the cover. This is the
 * exact stacking trap the shell header documents for native, never applied to
 * web-phone.
 *
 * FIX: give the web-phone `<Scroll>` `position:relative; zIndex:CONTENT_Z` (so it
 * sits above the fixed cover), and make `webPhoneHost` establish a local stacking
 * context (`position:relative; zIndex:0`) so the three children resolve
 * cover(COVER_Z) < Scroll(CONTENT_Z) < chrome(CHROME_Z) deterministically.
 *
 * Contract (must hold on BOTH native + react-native-web):
 *   cover (lowest) < content (middle, opaque, slides over) < chrome (highest).
 *
 * Shared-shell note: ParallaxCoverShell backs event / trip / experience / rsvp
 * public pages alike, so this fix makes the documented "content over cover"
 * contract hold on web-phone for ALL offering types (the intended behavior).
 *
 * Source-structure test (mirrors ParallaxCoverShell_native_stacking.test.ts) so
 * it runs under the default mingla-business node/ts-jest config without RTL. The
 * visual parallax itself still needs on-device/browser confirmation.
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

describe("ORCH-1150-R2 ParallaxCoverShell — web-phone z-order contract", () => {
  it("exports the 3-layer z-index contract ordered cover < content < chrome", () => {
    const cover = constValue("COVER_Z");
    const content = constValue("CONTENT_Z");
    const chrome = constValue("CHROME_Z");
    expect(cover).toBeLessThan(content);
    expect(content).toBeLessThan(chrome);
  });

  it("web-phone Scroll element carries position:relative + zIndex CONTENT_Z above the fixed cover (THE FIX — fails-on-revert)", () => {
    // The load-bearing fix: the web-phone <Scroll> wires the content-layer style
    // via the webStyle escape hatch. Without it the Scroll is static + auto-z and
    // the position:fixed cover (COVER_Z) paints over the scrolling body — the
    // orchestrator-proven bug. We assert the <Scroll ... style={webStyle({...})}>
    // shape carries both position:relative and zIndex:CONTENT_Z.
    expect(SRC).toMatch(
      /<Scroll\b[\s\S]*?style=\{webStyle\(\{\s*position:\s*"relative",\s*zIndex:\s*CONTENT_Z\s*\}\)\}/,
    );

    // And the content layer's zIndex MUST be strictly above the cover's.
    expect(constValue("CONTENT_Z")).toBeGreaterThan(constValue("COVER_Z"));
  });

  it("webPhoneHost establishes a stacking context so cover/content/chrome resolve against each other", () => {
    // Without a stacking context on the host, the fixed cover, relative Scroll,
    // and fixed chrome could resolve at the root rather than locally. position:
    // relative + an explicit zIndex is the minimal trigger.
    const host = styleBlock("webPhoneHost");
    expect(host).toMatch(/position:\s*"relative"/);
    expect(host).toMatch(/zIndex:\s*0/);
  });

  it("web-phone cover is the lowest layer (position:fixed, zIndex COVER_Z)", () => {
    expect(SRC).toMatch(/position:\s*"fixed"[\s\S]*?zIndex:\s*COVER_Z/);
  });

  it("web-phone chrome is the highest layer (position:fixed, zIndex CHROME_Z)", () => {
    expect(SRC).toMatch(/position:\s*"fixed"[\s\S]*?zIndex:\s*CHROME_Z/);
  });

  it("web-phone body keeps the −SEAM overlap + rounded-top seam so it slides up over the cover", () => {
    // The body still overlaps the cover's bottom edge (negative margin) and the
    // seam is rounded — unchanged by the stacking fix.
    expect(SRC).toMatch(/position:\s*"relative",\s*\n\s*zIndex:\s*CONTENT_Z,\s*\n\s*marginTop:\s*-SEAM/);
    expect(SRC).toMatch(/borderTopLeftRadius:\s*SEAM/);
  });
});
