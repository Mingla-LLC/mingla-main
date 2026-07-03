// META-ORCH-1270 Phase 3 [native leak-proofing — provider-agnostic] — implementor
// happy-path regression test. Closes the three Vector-A/C native cover-video leaks
// that killed the media account (ORCH-1209 fixed only web + a play/pause gate that
// never stopped the native download):
//
//   LEAK A (native "preload none"): EventCoverNativeVideo now creates the player
//     with a NULL source and attaches the real source via `replaceAsync` ONLY the
//     first time `shouldPlay` is true. An off-screen / paused / grid cover fetches
//     ZERO bytes. (The ORCH-1209 test proved the WRONG property — it only checked
//     `pause()`, never that the SOURCE is withheld. This checks the source.)
//   LEAK B (grid autoplay off): BusinessEventCard + TripCard pass
//     autoplay={false} playbackActive={false} → the discover grid draws the poster
//     still and streams nothing until a card is opened.
//   LEAK C (on-device cache): the native source carries expo-video's persistent
//     useCaching flag, so a re-open replays from disk instead of re-downloading.
//
// The cache-source decision is a PURE function (coverVideoCache) and is imported +
// run directly (real behavioural coverage). The component/card wiring is asserted
// source-structurally (readFileSync) — the established repo pattern for the
// RN/expo-video-heavy EventCoverMedia module (see
// orch_1209_no_eager_video_preload.test.ts), since a full player mount needs a
// simulator. Reverting any fix flips the matching assertion → fails-on-revert.
// Runtime byte-level proof (a Charles/Metro trace of zero .mp4 GETs in the grid)
// is SIM-BLOCKED and owned by the tester.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  nativeCachedCoverSource,
  webCoverSource,
} from "../coverVideoCache";

const pkgRoot = join(__dirname, "..");
const repoRoot = join(pkgRoot, "..", "..");
const read = (abs: string): string => readFileSync(abs, "utf8");

const COVER = join(pkgRoot, "EventCoverMedia.tsx");
const BUSINESS_CARD = join(
  repoRoot,
  "app-mobile/src/components/discover/BusinessEventCard.tsx",
);
const TRIP_CARD = join(
  repoRoot,
  "app-mobile/src/components/discover/TripCard.tsx",
);

// Strip comments so an explanatory note (which mentions e.g. `useVideoPlayer(uri`)
// never trips a live-code assertion — only shipped code is scanned.
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const sliceBetween = (src: string, start: string, end: string): string => {
  const open = src.indexOf(start);
  expect(open).toBeGreaterThanOrEqual(0);
  const close = src.indexOf(end, open + start.length);
  expect(close).toBeGreaterThan(open);
  return src.slice(open, close);
};

// ── LEAK C behavioural: cache-source decision (pure, run directly) ────────────
describe("META-ORCH-1270 P3 — cache-source decision (LEAK C)", () => {
  const BUNNY = "https://vz-abcd1234-xyz.b-cdn.net/guid-123/play_720p.mp4";
  const CLOUDINARY = "https://res.cloudinary.com/x/video/upload/v1/abc.mp4";

  it("native: wraps the remote uri as a CACHED expo-video source (useCaching:true)", () => {
    // [FAILS-ON-REVERT KEY] drop useCaching (or set it false) → Finding-C
    // re-download returns → this deep-equal fails.
    expect(nativeCachedCoverSource(BUNNY)).toEqual({
      uri: BUNNY,
      useCaching: true,
    });
    expect(nativeCachedCoverSource(CLOUDINARY)).toEqual({
      uri: CLOUDINARY,
      useCaching: true,
    });
  });

  it("native: a null / empty url yields NO source (nothing is fetched)", () => {
    expect(nativeCachedCoverSource(null)).toBeNull();
    expect(nativeCachedCoverSource(undefined)).toBeNull();
    expect(nativeCachedCoverSource("")).toBeNull();
  });

  it("web: passes the plain remote uri through (browser HTTP cache handles reuse)", () => {
    // A bare string source — NOT the native cache object; web must never carry
    // the native useCaching flag (that path is native-only).
    expect(webCoverSource(BUNNY)).toBe(BUNNY);
    expect(typeof webCoverSource(BUNNY)).toBe("string");
    expect(webCoverSource(null)).toBeNull();
    expect(webCoverSource("")).toBeNull();
  });
});

// ── LEAK A source-defer: player un-sourced until shouldPlay ───────────────────
describe("META-ORCH-1270 P3 — native source-defer (LEAK A)", () => {
  const native = sliceBetween(
    stripComments(read(COVER)),
    "const EventCoverNativeVideo",
    "const EventCoverVideo",
  );

  it("creates the player with a NULL source (native preload=none), never with uri", () => {
    // [FAILS-ON-REVERT KEY] the leak lived on `useVideoPlayer(uri, …)`. Sourcing
    // on creation buffers the mp4 for every mount regardless of play state.
    expect(native).toMatch(/useVideoPlayer\(\s*null\s*,/);
    expect(native).not.toMatch(/useVideoPlayer\(\s*uri\b/);
  });

  it("attaches the real source lazily via replaceAsync, latched by a sourcedRef", () => {
    expect(native).toMatch(/const\s+source\s*=\s*useCachedCoverVideoUri\(uri\)/);
    expect(native).toMatch(/const\s+sourcedRef\s*=\s*useRef\(false\)/);
    expect(native).toMatch(/player\s*\n?\s*\.replaceAsync\(source\)/);
  });

  it("only attaches the source INSIDE the shouldPlay branch, once (not on mount)", () => {
    const shouldPlayIdx = native.indexOf("if (shouldPlay) {");
    const latchIdx = native.indexOf("sourcedRef.current = true");
    const replaceIdx = native.search(/\.replaceAsync\(source\)/);
    expect(shouldPlayIdx).toBeGreaterThan(0);
    // The source is attached only after entering the shouldPlay branch AND after
    // setting the once-only latch → an unsourced player streams nothing.
    expect(latchIdx).toBeGreaterThan(shouldPlayIdx);
    expect(replaceIdx).toBeGreaterThan(latchIdx);
  });
});

// ── LEAK B: discover grid is poster-only (autoplay + playbackActive false) ────
describe("META-ORCH-1270 P3 — discover grid poster-only (LEAK B)", () => {
  const businessCard = sliceBetween(
    stripComments(read(BUSINESS_CARD)),
    "<EventCoverMedia",
    "/>",
  );
  const tripCard = sliceBetween(
    stripComments(read(TRIP_CARD)),
    "<EventCoverMedia",
    "/>",
  );

  it("BusinessEventCard passes autoplay={false} playbackActive={false}", () => {
    // [FAILS-ON-REVERT KEY] remove either prop → both default true → the whole
    // grid autoplay-streams again.
    expect(businessCard).toMatch(/autoplay=\{false\}/);
    expect(businessCard).toMatch(/playbackActive=\{false\}/);
  });

  it("TripCard passes autoplay={false} playbackActive={false}", () => {
    expect(tripCard).toMatch(/autoplay=\{false\}/);
    expect(tripCard).toMatch(/playbackActive=\{false\}/);
  });
});
