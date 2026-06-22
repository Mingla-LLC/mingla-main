// ORCH-1209 [cover-video bandwidth fix] — TESTER ADVERSARIAL (different angle).
//
// The implementor's happy-path test (orch_1209_no_eager_video_preload.test.ts)
// is source-structural greps + 4 deriveCoverPosterUrl examples. This file
// attacks DIFFERENT, harder angles:
//   A. deriveCoverPosterUrl EDGE CASES the implementor did not test (uppercase
//      ext, no extension, nested Cloudinary transforms, query-before-ext, the
//      /image/upload/ near-miss, protocol-relative, garbage) — proving NO throw
//      and the right null-vs-jpg decision on each (graceful, no eager download).
//   B. The resolvedPosterUrl GATING contract at the chokepoint: the poster is
//      derived ONLY for video/video_still presentations, NEVER for image/gif/
//      fallback — so the image-cover path can never receive a poster prop
//      (image byte-identity). Proven against the SHIPPED source structure.
//   C. The NATIVE gate BOUNDARY: shouldPlay = autoplay && playbackActive in the
//      native video, and the card threads autoplay={isTopCard}
//      playbackActive={isTopCard} — so isTopCard=false ⇒ shouldPlay=false ⇒ no
//      player.play() (off-front card streams nothing), isTopCard=true ⇒ plays.
//
// The browser-network half (no .mp4 on a real bot load + real-viewer autoplay
// intact) is proven separately by the Playwright runtime probe
// (mingla-business/playwright/orch1209-cover-video-bandwidth-runtime-probe.mjs).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { deriveCoverPosterUrl } from "../coverMediaPresentation";

const pkgRoot = join(__dirname, "..");
const repoRoot = join(pkgRoot, "..", "..");
const read = (abs: string): string => readFileSync(abs, "utf8");

const COVER = join(pkgRoot, "EventCoverMedia.tsx");
const CARD = join(
  repoRoot,
  "app-mobile/src/components/CuratedExperienceSwipeCard.tsx",
);

const stripComments = (s: string): string =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("ORCH-1209 adversarial — derivation edge cases", () => {
  // A. Edge cases — NONE may throw; each must return the documented value.
  it("A1: uppercase extension still derives the .jpg first-frame", () => {
    expect(
      deriveCoverPosterUrl(
        "https://res.cloudinary.com/x/video/upload/v1/abc.MP4",
      ),
    ).toBe("https://res.cloudinary.com/x/video/upload/so_0/v1/abc.jpg");
  });

  it("A2: a /video/upload/ URL with NO extension still appends .jpg (no throw)", () => {
    expect(
      deriveCoverPosterUrl(
        "https://res.cloudinary.com/x/video/upload/v1/abc",
      ),
    ).toBe("https://res.cloudinary.com/x/video/upload/so_0/v1/abc.jpg");
  });

  it("A3: nested Cloudinary transforms are preserved AFTER the inserted so_0", () => {
    expect(
      deriveCoverPosterUrl(
        "https://res.cloudinary.com/x/video/upload/c_fill,w_400/q_auto/v1/abc.mp4",
      ),
    ).toBe(
      "https://res.cloudinary.com/x/video/upload/so_0/c_fill,w_400/q_auto/v1/abc.jpg",
    );
  });

  it("A4: a multi-param query string is dropped from the still", () => {
    expect(
      deriveCoverPosterUrl(
        "https://res.cloudinary.com/x/video/upload/v1/abc.mp4?a=1&b=2",
      ),
    ).toBe("https://res.cloudinary.com/x/video/upload/so_0/v1/abc.jpg");
  });

  it("A5: a Cloudinary /image/upload/ URL is NOT a video path → null (no false derive)", () => {
    expect(
      deriveCoverPosterUrl(
        "https://res.cloudinary.com/x/image/upload/v1/abc.jpg",
      ),
    ).toBeNull();
  });

  it("A6: protocol-relative video URL still derives (indexOf marker is scheme-agnostic)", () => {
    expect(
      deriveCoverPosterUrl("//res.cloudinary.com/x/video/upload/v1/abc.webm"),
    ).toBe("//res.cloudinary.com/x/video/upload/so_0/v1/abc.jpg");
  });

  it("A7: garbage / whitespace / non-URL input → null, never throws", () => {
    expect(deriveCoverPosterUrl("not a url at all")).toBeNull();
    expect(deriveCoverPosterUrl("   ")).toBeNull();
    expect(deriveCoverPosterUrl("video upload mp4")).toBeNull();
    // typed-as-never abuse must still be safe (defensive — callers are JS too)
    expect(() =>
      deriveCoverPosterUrl(12345 as unknown as string),
    ).not.toThrow();
    expect(deriveCoverPosterUrl(12345 as unknown as string)).toBeNull();
  });

  it("A8: the derived poster is ALWAYS a .jpg image URL — it is never an .mp4 (so the poster can never trigger a video download)", () => {
    const inputs = [
      "https://res.cloudinary.com/x/video/upload/v1/a.mp4",
      "https://res.cloudinary.com/x/video/upload/v1/a.mov",
      "https://res.cloudinary.com/x/video/upload/v1/a.webm",
      "https://res.cloudinary.com/x/video/upload/v1/a.m4v",
    ];
    for (const i of inputs) {
      const out = deriveCoverPosterUrl(i);
      expect(out).not.toBeNull();
      expect(out as string).toMatch(/\.jpg$/i);
      expect(out as string).not.toMatch(/\.(mp4|mov|webm|m4v)(\?|$)/i);
    }
  });
});

describe("ORCH-1209 adversarial — image-cover path can never receive a poster (B)", () => {
  const coverSrc = stripComments(read(COVER));

  it("B1: resolvedPosterUrl is gated to video/video_still ONLY (null for image/gif/fallback)", () => {
    // The exact gating expression in the shipped chokepoint.
    expect(coverSrc).toMatch(
      /const resolvedPosterUrl\s*=\s*\n?\s*presentation === "video" \|\| presentation === "video_still"/,
    );
    // The else branch yields null (no derive for non-video presentations).
    const idx = coverSrc.indexOf("const resolvedPosterUrl");
    const window = coverSrc.slice(idx, idx + 260);
    expect(window).toMatch(/:\s*null/);
  });

  it("B2: the <Image> cover branch (source={{ uri: mediaUrl }}) never carries a posterUrl prop", () => {
    // Locate the EventCoverMedia image fallthrough specifically (sourced from
    // mediaUrl, NOT the native poster Image which is sourced from posterUrl).
    const imgIdx = coverSrc.indexOf("source={{ uri: mediaUrl }}");
    expect(imgIdx).toBeGreaterThan(0);
    const close = coverSrc.indexOf("/>", imgIdx);
    const imgBranch = coverSrc.slice(imgIdx, close);
    expect(imgBranch).not.toMatch(/posterUrl/);
    // And resizeMode stays "cover" (image shaping untouched by this ORCH).
    expect(imgBranch).toMatch(/resizeMode="cover"/);
  });

  it("B3: posterUrl is only passed into the VIDEO renderer (EventCoverVideo), not the Image branch", () => {
    expect(coverSrc).toMatch(/posterUrl=\{resolvedPosterUrl\}/);
    // The pass-down sits inside the EventCoverVideo element, which only mounts
    // for video/video_still (the ternary's video arm).
    const videoArmIdx = coverSrc.indexOf("<EventCoverVideo");
    expect(videoArmIdx).toBeGreaterThan(0);
    const videoArm = coverSrc.slice(videoArmIdx, videoArmIdx + 400);
    expect(videoArm).toMatch(/posterUrl=\{resolvedPosterUrl\}/);
  });
});

describe("ORCH-1209 adversarial — native gate boundary (C)", () => {
  const coverSrc = stripComments(read(COVER));
  const cardSrc = stripComments(read(CARD));

  it("C1: native shouldPlay = autoplay && playbackActive (both must be true to stream)", () => {
    const nStart = coverSrc.indexOf("const EventCoverNativeVideo");
    const nEnd = coverSrc.indexOf("const EventCoverVideo");
    const native = coverSrc.slice(nStart, nEnd);
    expect(native).toMatch(
      /const shouldPlay\s*=\s*autoplay\s*&&\s*playbackActive/,
    );
    // The play()/pause() effect keys on shouldPlay: false ⇒ pause, true ⇒ play.
    expect(native).toMatch(/if\s*\(shouldPlay\)\s*\{[\s\S]*?player\.play\(\)/);
    expect(native).toMatch(/player\.pause\(\)/);
  });

  it("C2: the card binds BOTH autoplay and playbackActive to isTopCard (no bare autoplay)", () => {
    // The cover must NOT pass a bare `autoplay` (always-true) without the gate.
    expect(cardSrc).toMatch(/autoplay=\{isTopCard\}/);
    expect(cardSrc).toMatch(/playbackActive=\{isTopCard\}/);
    // Boundary semantics: isTopCard=false ⇒ both false ⇒ shouldPlay=false.
    // Assert the card never hard-codes autoplay/playbackActive to a literal true.
    const evIdx = cardSrc.indexOf("<EventCoverMedia");
    const evEnd = cardSrc.indexOf("/>", evIdx);
    const ev = cardSrc.slice(evIdx, evEnd);
    expect(ev).not.toMatch(/autoplay(\s|=\{true\})?\s*\n\s*muted/);
    expect(ev).not.toMatch(/playbackActive=\{true\}/);
  });

  it("C3: isTopCard defaults true so non-deck callers (none today) are byte-identical", () => {
    expect(cardSrc).toMatch(/isTopCard\?:\s*boolean/);
    expect(cardSrc).toMatch(/isTopCard\s*=\s*true/);
  });
});
