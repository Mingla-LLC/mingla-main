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
