// ORCH-1208 [cover-video bandwidth fix — Phase 1]. Implementor happy-path
// regression test for the 3 fixes:
//   FIX 1 — WEB: the imperative cover <video> sets preload="none" (never "auto")
//           and sets video.poster so a bot / SSR / desktop-WebKit (play-button,
//           no autoplay) gets the still image, NOT an eager .mp4 download.
//   FIX 2 — NATIVE: CuratedExperienceSwipeCard threads isTopCard and passes
//           autoplay={isTopCard} playbackActive={isTopCard} so only the active
//           front card streams; SwipeableCards passes isTopCard to its render.
//   FIX 3 — POSTER: deriveCoverPosterUrl derives the Cloudinary so_0 first-frame
//           .jpg with ZERO new dependency; EventCoverMedia computes
//           resolvedPosterUrl and threads posterUrl into EventCoverVideo.
//
// Most assertions are SOURCE-structural (readFileSync) matching the existing
// coverWebVideoImperativeMount.orch1167r8.test.ts style — these mounts pull
// react-native + expo-video and there is no jsdom here. The derivation unit
// (T-3) is a PURE function and is imported + run directly. Reverting any fix
// flips the corresponding assertion → the test fails (fails-on-revert).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { deriveCoverPosterUrl } from "../coverMediaPresentation";

const pkgRoot = join(__dirname, "..");
const repoRoot = join(pkgRoot, "..", "..");
const read = (abs: string): string => readFileSync(abs, "utf8");

const COVER = join(pkgRoot, "EventCoverMedia.tsx");
const PRESENTATION = join(pkgRoot, "coverMediaPresentation.ts");
const CARD = join(
  repoRoot,
  "app-mobile/src/components/CuratedExperienceSwipeCard.tsx",
);
const DECK = join(repoRoot, "app-mobile/src/components/SwipeableCards.tsx");

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const sliceBetween = (
  src: string,
  startMarker: string,
  endMarker: string,
): string => {
  const open = src.indexOf(startMarker);
  expect(open).toBeGreaterThanOrEqual(0);
  const next = src.indexOf(endMarker, open + startMarker.length);
  expect(next).toBeGreaterThan(open);
  return src.slice(open, next);
};

describe("ORCH-1208 — cover-video bandwidth (preload=none + poster + native gate)", () => {
  const coverSrc = stripComments(read(COVER));
  const web = sliceBetween(
    coverSrc,
    "const EventCoverWebVideo",
    "const EventCoverNativeVideo",
  );
  const native = sliceBetween(
    coverSrc,
    "const EventCoverNativeVideo",
    "const EventCoverVideo",
  );
  const cardSrc = stripComments(read(CARD));
  const deckSrc = stripComments(read(DECK));

  // ── T-1: WEB preload ──────────────────────────────────────────────────────
  it("T-1: the web cover <video> sets preload=\"none\" and NEVER preload=\"auto\"", () => {
    expect(web).toMatch(/video\.preload\s*=\s*["']none["']/);
    expect(web).not.toMatch(/preload\s*=\s*["']auto["']/);
  });

  // ── T-2: poster wired (web + EventCoverMedia plumbing + export) ────────────
  it("T-2: the web <video> sets video.poster, EventCoverMedia computes resolvedPosterUrl and threads posterUrl, and deriveCoverPosterUrl is exported", () => {
    // Web imperative element gets the poster attribute.
    expect(web).toMatch(/video\.poster\s*=/);
    // EventCoverMedia computes the resolved poster and passes it to the video.
    expect(coverSrc).toMatch(/const resolvedPosterUrl\s*=/);
    expect(coverSrc).toMatch(/deriveCoverPosterUrl\(mediaUrl\)/);
    expect(coverSrc).toMatch(/posterUrl=\{resolvedPosterUrl\}/);
    // The derivation helper is exported + emits the so_0 first-frame transform.
    const presentation = read(PRESENTATION);
    expect(presentation).toMatch(/export const deriveCoverPosterUrl/);
    expect(presentation).toMatch(/so_0/);
    // Native renders the poster Image still behind the VideoView.
    expect(native).toMatch(/source=\{\{\s*uri:\s*posterUrl\s*\}\}/);
    expect(native).toMatch(/<VideoView/);
  });

  // ── T-3: derivation unit (pure function, run directly) ─────────────────────
  it("T-3: deriveCoverPosterUrl produces the Cloudinary so_0 .jpg first-frame", () => {
    expect(
      deriveCoverPosterUrl(
        "https://res.cloudinary.com/x/video/upload/v1/abc.mp4",
      ),
    ).toBe("https://res.cloudinary.com/x/video/upload/so_0/v1/abc.jpg");

    // Existing transforms preserved, query string dropped.
    expect(
      deriveCoverPosterUrl(
        "https://res.cloudinary.com/x/video/upload/c_fill/v1/abc.mp4?x=1",
      ),
    ).toBe("https://res.cloudinary.com/x/video/upload/so_0/c_fill/v1/abc.jpg");

    // .mov / .webm / .m4v all swap to .jpg.
    expect(
      deriveCoverPosterUrl(
        "https://res.cloudinary.com/x/video/upload/v1/clip.mov",
      ),
    ).toBe("https://res.cloudinary.com/x/video/upload/so_0/v1/clip.jpg");

    // Non-Cloudinary / non-video / empty → null (hue-band placeholder shows).
    expect(
      deriveCoverPosterUrl("https://storage.supabase.co/cover.png"),
    ).toBeNull();
    expect(deriveCoverPosterUrl(null)).toBeNull();
    expect(deriveCoverPosterUrl(undefined)).toBeNull();
    expect(deriveCoverPosterUrl("")).toBeNull();
  });

  // ── T-4: native gate wired (card + caller) ─────────────────────────────────
  it("T-4: CuratedExperienceSwipeCard declares isTopCard, defaults it true, and gates the cover on it; SwipeableCards passes isTopCard", () => {
    expect(cardSrc).toMatch(/isTopCard\?:\s*boolean/);
    expect(cardSrc).toMatch(/isTopCard\s*=\s*true/);
    // The cover EventCoverMedia gates BOTH autoplay and playbackActive on it.
    expect(cardSrc).toMatch(/autoplay=\{isTopCard\}/);
    expect(cardSrc).toMatch(/playbackActive=\{isTopCard\}/);
    // No bare always-on "autoplay\n muted\n loop" survives on the cover.
    expect(cardSrc).not.toMatch(/\bautoplay\s*\n\s*muted\s*\n\s*loop\b/);
    // The caller (Current Card slot) passes isTopCard to the experience variant.
    expect(deckSrc).toMatch(/isTopCard=\{true\}/);
  });

  // ── Image-cover path unaffected: resolvedPosterUrl is null for non-video ───
  it("image/GIF cover path is unaffected — resolvedPosterUrl is null unless presentation is video/video_still", () => {
    expect(coverSrc).toMatch(
      /presentation === "video" \|\| presentation === "video_still"/,
    );
    // The NON-VIDEO cover <Image> branch (the EventCoverMedia image fallthrough,
    // sourced from mediaUrl) never receives a posterUrl prop. Slice from its
    // distinctive `source={{ uri: mediaUrl }}` so this targets the image branch,
    // not the new native poster <Image> (which is sourced from posterUrl).
    const imageBranch = sliceBetween(
      coverSrc,
      "source={{ uri: mediaUrl }}",
      "/>",
    );
    expect(imageBranch).not.toMatch(/posterUrl/);
  });
});
