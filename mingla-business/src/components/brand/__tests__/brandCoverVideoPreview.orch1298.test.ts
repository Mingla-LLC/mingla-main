// ORCH-1298 [brand cover-video doesn't display] — regression test.
//
// BrandEditView rendered the cover preview with a plain Image
// (ExpoImage / RNImage, source={{ uri: draft.coverMediaUrl }}). A VIDEO cover's
// coverMediaUrl is a Bunny …/play_720p.mp4 that an Image cannot render → the
// preview came up empty after a successful video upload. The fix renders the
// cover through the shared, video-capable EventCoverMedia (the same component
// every other authoring surface already uses).
//
// Source-structural (BrandEditView is a full RN screen — it can't mount under the
// default node/ts-jest config; the RTL render configs are for tester proofs).
// Fails-on-revert: on origin/main BrandEditView imports expo-image and renders
// the cover via <ExpoImage/RNImage source={{ uri: draft.coverMediaUrl }}>, and
// has no <EventCoverMedia mediaUrl={draft.coverMediaUrl …}> — so every assertion
// below flips.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const businessRoot = join(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(join(businessRoot, rel), "utf8");

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const SRC = stripComments(read("src/components/brand/BrandEditView.tsx"));

describe("ORCH-1298 — brand cover preview renders video via EventCoverMedia", () => {
  it("imports the video-capable EventCoverMedia", () => {
    expect(SRC).toMatch(
      /import\s*\{\s*EventCoverMedia\s*\}\s*from\s*["']\.\.\/ui\/EventCoverMedia["']/,
    );
  });

  it("renders the cover through EventCoverMedia bound to the draft cover fields", () => {
    expect(SRC).toMatch(/<EventCoverMedia[\s\S]*?mediaUrl=\{draft\.coverMediaUrl/);
    expect(SRC).toMatch(/<EventCoverMedia[\s\S]*?mediaType=\{draft\.coverMediaType/);
    // Video preview must pause while the picker sheet (own live preview) is open.
    expect(SRC).toMatch(/<EventCoverMedia[\s\S]*?playbackActive=\{!coverPickerVisible/);
  });

  it("does NOT render the cover via a raw Image (which cannot display a video mp4)", () => {
    expect(SRC).not.toMatch(/source=\{\{\s*uri:\s*draft\.coverMediaUrl\s*\}\}/);
    // The outlier expo-image import for the cover preview is gone.
    expect(SRC).not.toMatch(/from\s*["']expo-image["']/);
  });
});
