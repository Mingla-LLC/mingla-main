/**
 * ORCH-1150 R2 D-7 — RsvpPublicBody parallax content-layering safety-net.
 *
 * Owner: mingla-implementor (the tester adds the device fresh-build re-test).
 *
 * The shared ParallaxCoverShell carries the ORCH-1138 cover<content<chrome
 * z-order (proven + guarded by ParallaxCoverShell_native_stacking.test.ts). The
 * RSVP body must consume that SHARED, fixed shell and pass its content as a bare
 * <View> with NO competing stacking style — so the shell, not the body, owns the
 * seam/z-order (re-adding a zIndex/marginTop here re-creates the pre-ORCH-1138
 * double-seam inversion Seth reported; investigation F-1 = most likely a stale
 * build). These source-structure assertions FAIL on any such revert.
 */

import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(join(__dirname, "..", "RsvpPublicBody.tsx"), "utf8");
const PAGE_SRC = readFileSync(
  join(__dirname, "..", "PublicEventPage.tsx"),
  "utf8",
);

describe("ORCH-1150 R2 D-7 — RsvpPublicBody parallax content layering", () => {
  it("imports ParallaxCoverShell from the shared @mingla/offering-rendering package", () => {
    expect(SRC).toMatch(
      /import\s*\{[\s\S]*ParallaxCoverShell[\s\S]*\}\s*from\s*["']@mingla\/offering-rendering["']/,
    );
  });

  it("passes its body as a bare <View> child of <ParallaxCoverShell> (shell owns the seam)", () => {
    expect(SRC).toMatch(/<ParallaxCoverShell[\s\S]*?>\s*<View>\s*\{\/\* Brand chip/);
  });

  it("does NOT give the RSVP content wrapper a zIndex / position / marginTop / backgroundColor", () => {
    const m = SRC.match(/<ParallaxCoverShell[\s\S]*?>\s*<View(\s[^>]*)?>/);
    expect(m).not.toBeNull();
    const childOpenTag = m ? m[0] : "";
    expect(childOpenTag).not.toMatch(/zIndex/);
    expect(childOpenTag).not.toMatch(/position:/);
    expect(childOpenTag).not.toMatch(/marginTop/);
    expect(childOpenTag).not.toMatch(/backgroundColor/);
  });
});

/**
 * ORCH-1150 R2 D-7b — RSVP scroll-runway parity (fails-on-revert).
 *
 * The RSVP public page is SHORT (no tier list, no docked CTA) and sits under an
 * ~80%-tall pinned-cover spacer. With `contentBottomInset=0` (the shell default),
 * the body barely exceeds the viewport ⇒ near-zero scroll travel ⇒ the correctly
 * pinned cover dominates and content reads as "stuck behind the cover." The fix:
 * plumb a POSITIVE `contentBottomInset` end-to-end (PublicEventPage RSVP branch →
 * RsvpPublicBodyProps → <ParallaxCoverShell>), giving real scroll runway so the
 * body scrolls UP and OVER the cover — parity with trip / experience / ticketed.
 *
 * These source assertions FAIL if the inset plumbing is reverted to 0 / removed.
 */
describe("ORCH-1150 R2 D-7b — RSVP scroll-runway parity", () => {
  it("RsvpPublicBody declares a contentBottomInset prop", () => {
    expect(SRC).toMatch(/contentBottomInset\?:\s*number/);
  });

  it("RsvpPublicBody defaults contentBottomInset to a NON-ZERO positive value", () => {
    const m = SRC.match(/contentBottomInset\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    const dflt = m ? Number(m[1]) : 0;
    expect(dflt).toBeGreaterThan(0);
  });

  it("RsvpPublicBody forwards contentBottomInset to <ParallaxCoverShell>", () => {
    expect(SRC).toMatch(
      /<ParallaxCoverShell[\s\S]*?contentBottomInset=\{contentBottomInset\}[\s\S]*?>/,
    );
  });

  it("RsvpPublicBody forwards onScroll / onScrollViewLayout to <ParallaxCoverShell> (convention parity)", () => {
    expect(SRC).toMatch(
      /<ParallaxCoverShell[\s\S]*?onScroll=\{onScroll\}[\s\S]*?>/,
    );
    expect(SRC).toMatch(
      /<ParallaxCoverShell[\s\S]*?onScrollViewLayout=\{onScrollViewLayout\}[\s\S]*?>/,
    );
  });

  it("PublicEventPage RSVP branch passes a POSITIVE contentBottomInset to <RsvpPublicBody>", () => {
    const m = PAGE_SRC.match(/<RsvpPublicBody[\s\S]*?\/>/);
    expect(m).not.toBeNull();
    const tag = m ? m[0] : "";
    // must pass contentBottomInset, and it must NOT be a literal 0
    expect(tag).toMatch(/contentBottomInset=\{[\s\S]*?\}/);
    expect(tag).not.toMatch(/contentBottomInset=\{0\}/);
    // the chosen value adds safe-area bottom plus a spacing runway
    expect(tag).toMatch(/contentBottomInset=\{insets\.bottom\s*\+\s*spacing\./);
  });
});
