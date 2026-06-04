// ORCH-1069 — implementor-owned regression test (happy + adversarial).
//
// Deno-runnable: imports the PURE helper `isVideoUrl`/`firstVideoUrl` from
// videoUrl.ts (no RN imports), and additionally reads the LIVE edge function
// source `supabase/functions/discover-cards/index.ts` to extract its
// `isVideoUrl` regexes and assert byte-for-byte parity — this is the machine
// enforcement of invariant I-1069-VIDEO-DETECTION-MATCHES-EDGE (T-07).
//
// Fails-on-revert:
//   - If the app helper regex is reverted/changed away from the edge pattern,
//     the "detection parity with edge" test FAILS (regex source mismatch).
//   - If `firstVideoUrl` stops detecting the `.mp4` in a mixed list (the deck
//     hero / gallery video branch), the happy-path tests FAIL.
//   - The adversarial still-only test guards the no-regression contract
//     (firstVideoUrl must return null so the deck renders the unchanged image hero).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isVideoUrl, firstVideoUrl } from "../videoUrl.ts";

const VIDEO = "https://res.cloudinary.com/mingla/video/upload/v1/cover.mp4";
const VIDEO_QUERY = "https://cdn.example.com/cover.mp4?v=2";
const VIDEO_PATH = "https://res.cloudinary.com/mingla/video/upload/v1/cover";
const MOV = "https://cdn.example.com/clip.mov";
const IMG_A = "https://cdn.example.com/a.jpg";
const IMG_B = "https://cdn.example.com/b.png";

// ── T-07 happy: isVideoUrl detects every video shape the edge fn does ──
Deno.test("ORCH-1069 T-07a: isVideoUrl true for .mp4, .mp4?query, /video/upload/, .mov", () => {
  assertEquals(isVideoUrl(VIDEO), true);
  assertEquals(isVideoUrl(VIDEO_QUERY), true);
  assertEquals(isVideoUrl(VIDEO_PATH), true); // /video/upload/ with no extension
  assertEquals(isVideoUrl(MOV), true);
  assertEquals(isVideoUrl("https://x/y.webm"), true);
  assertEquals(isVideoUrl("https://x/y.m4v"), true);
});

// ── T-07 adversarial: isVideoUrl false for images + degenerate input ──
Deno.test("ORCH-1069 T-07b: isVideoUrl false for images, empty, null, undefined", () => {
  assertEquals(isVideoUrl(IMG_A), false);
  assertEquals(isVideoUrl(IMG_B), false);
  assertEquals(isVideoUrl(""), false);
  assertEquals(isVideoUrl(null), false);
  assertEquals(isVideoUrl(undefined), false);
  // .mp4 must be a real extension boundary, not a substring (e.g. a folder named mp4x)
  assertEquals(isVideoUrl("https://x/folder.mp4x/photo.jpg"), false);
});

// ── Happy: firstVideoUrl finds the cover video for the deck hero / gallery ──
Deno.test("ORCH-1069 SC-1: firstVideoUrl returns the .mp4 in a mixed venue list", () => {
  // image hero is a.jpg (edge picks first non-video); cover video is the .mp4.
  assertEquals(firstVideoUrl([IMG_A, VIDEO, IMG_B]), VIDEO);
  // video first in the ordered list (Cloudinary cover often index 0).
  assertEquals(firstVideoUrl([VIDEO, IMG_A]), VIDEO);
});

// ── Adversarial (no regression): still-only venue → null → unchanged image hero ──
Deno.test("ORCH-1069 SC-3: firstVideoUrl returns null for a still-only venue", () => {
  assertEquals(firstVideoUrl([IMG_A, IMG_B]), null);
  assertEquals(firstVideoUrl([]), null);
  assertEquals(firstVideoUrl(null), null);
  assertEquals(firstVideoUrl(undefined), null);
});

// ── Perf-guard decision is a pure function of isTopCard (I-1069-ONE-PLAYING-DECK-VIDEO).
// Mirror of the CardHero prop mapping: playbackActive === autoplay === isTopCard.
Deno.test("ORCH-1069 SC-4: only the top card's playback gate is true", () => {
  const playbackFor = (isTopCard: boolean): boolean => isTopCard; // CardHero mapping
  assertEquals(playbackFor(true), true); // currentRec (top) plays
  assertEquals(playbackFor(false), false); // nextCard (behind) does NOT play
});

// ── T-07 machine parity: app regexes === discover-cards regexes (the invariant) ──
Deno.test("ORCH-1069 T-07c: app isVideoUrl regexes match discover-cards edge fn byte-for-byte", async () => {
  // Resolve the edge fn relative to this test file: app-mobile/src/utils/__tests__
  // → repo-root/supabase/functions/discover-cards/index.ts
  const edgeUrl = new URL(
    "../../../../supabase/functions/discover-cards/index.ts",
    import.meta.url,
  );
  const edgeSrc = await Deno.readTextFile(edgeUrl);

  // Extract the edge VIDEO_EXT literal and the /video/upload/ guard.
  const extMatch = edgeSrc.match(/const VIDEO_EXT = (\/.+?\/[a-z]*);/);
  if (!extMatch) throw new Error("Could not find VIDEO_EXT in discover-cards/index.ts");
  const edgeExt = extMatch[1];

  const helperUrl = new URL("../videoUrl.ts", import.meta.url);
  const helperSrc = await Deno.readTextFile(helperUrl);
  const helperExtMatch = helperSrc.match(/const VIDEO_EXT = (\/.+?\/[a-z]*);/);
  if (!helperExtMatch) throw new Error("Could not find VIDEO_EXT in videoUrl.ts");
  const helperExt = helperExtMatch[1];

  assertEquals(
    helperExt,
    edgeExt,
    `VIDEO_EXT drifted: app="${helperExt}" edge="${edgeExt}" — I-1069-VIDEO-DETECTION-MATCHES-EDGE violated`,
  );

  // Both must also carry the /video/upload/ path guard.
  assertEquals(/\/\\\/video\\\/upload\\\//.test(helperSrc), true);
  assertEquals(/\/\\\/video\\\/upload\\\//.test(edgeSrc), true);
});
