// ORCH-1167-R5 [web cover autoplay-muted] — implementor-owned regression for the
// single R5 revision: a VIDEO event-cover on BUYER WEB must AUTOPLAY MUTED by
// default so the browser permits inline autoplay and NEVER paints its native
// PLAY BUTTON. On mobile the cover already autoplays muted+loops (R4); R5 is
// web-specific — browsers only allow gesture-free inline autoplay when the
// <video> is MUTED at play() time, so a single unmuted play() attempt paints the
// native control overlay (the bug Seth saw live on buyer-web).
//
// THE FIX, asserted here (all in the web branch of EventCoverMedia.tsx):
//   (1) The web <video>'s FIRST autoplay attempt is HARD-MUTED regardless of the
//       incoming `muted` prop (`effectiveMuted` is true until the user unmutes),
//       so the browser always permits the inline autoplay and no play button
//       shows. A `hasUnmutedRef` records the first user-gesture unmute; only then
//       does the element follow the live `muted` prop.
//   (2) The element is mounted via a SYNCHRONOUS ref callback that pins the
//       `muted` + `playsinline` ATTRIBUTES the instant it mounts — before the
//       browser evaluates autoplay eligibility (React 19 emits `muted` as a
//       property only, which can land after the first eligibility check).
//   (3) `onCanPlay` re-asserts `muted` before the (re)play attempt.
//   (4) `controls` stays false (no native chrome), `playsInline`/`webkit-
//       playsinline` stay set, `loop` is preserved.
//   (5) The shared EventCoverMedia mute STATE follows the parent `muted` prop on
//       in-place changes (so the chrome Mute/Unmute toggle reaches the cover),
//       and resets to the web autoplay-muted default only on a NEW media url.
//
// Source-structural (readFileSync) — the same proven pattern as the R2/R3/R4
// ORCH-1167 tests: these mounts import react-native + expo-video and cannot run
// under node-env jest, and there is no jsdom in this repo, so the web autoplay
// contract is pinned as a source contract.
//
// FAILS-ON-REVERT (proven by TRUE deletion in the implementation report):
//   • Pass the raw `muted` prop to the web <video> instead of `effectiveMuted`
//     (drop the hasUnmutedRef hard-mute) → "first autoplay is hard-muted" FAILS.
//   • Drop the synchronous ref-callback muted-attribute pin → "ref callback pins
//     muted attribute on mount" FAILS.
//   • Drop the onCanPlay muted re-assert → "onCanPlay re-asserts muted" FAILS.
//   • Make EventCoverMedia's sync effect force muted on web again (re-mute on
//     every prop change) → "mute state follows the parent prop on in-place
//     change" FAILS.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..", "..");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const COVER = "packages/event-rendering/EventCoverMedia.tsx";

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// Slice the EventCoverWebVideo component body (web branch only) so assertions
// target the WEB path, not the native expo-video path.
const webVideoBody = (src: string): string => {
  const open = src.indexOf("const EventCoverWebVideo");
  expect(open).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("const EventCoverNativeVideo");
  expect(next).toBeGreaterThan(open);
  return src.slice(open, next);
};

describe("ORCH-1167-R5 — web video cover autoplays MUTED (no native play button)", () => {
  const src = stripComments(read(COVER));
  const web = webVideoBody(src);

  it("the web <video> autoplay attempt is HARD-MUTED until the user unmutes (effectiveMuted, not the raw prop)", () => {
    // The hard-mute gate exists.
    expect(web).toMatch(/hasUnmutedRef/);
    expect(web).toMatch(/const effectiveMuted\s*=/);
    // The element's `muted` is driven by effectiveMuted, NOT the raw `muted` prop.
    expect(web).toMatch(/muted:\s*effectiveMuted/);
    // The imperative effect mutes the element with effectiveMuted before play().
    expect(web).toMatch(/video\.muted\s*=\s*effectiveMuted/);
    // The user-gesture unmute is recorded so the toggle can later take over.
    expect(web).toMatch(/if\s*\(!muted\)\s*hasUnmutedRef\.current\s*=\s*true/);
  });

  it("a synchronous ref callback pins the muted + playsinline ATTRIBUTES on mount (before autoplay eligibility check)", () => {
    expect(web).toMatch(/attachVideo/);
    expect(web).toMatch(/node\.muted\s*=\s*true/);
    expect(web).toMatch(/node\.setAttribute\("muted",\s*""\)/);
    expect(web).toMatch(/setAttribute\("playsinline",\s*""\)/);
    expect(web).toMatch(/setAttribute\("webkit-playsinline",\s*""\)/);
    // The element uses the ref callback (not a bare ref) so the pin runs on mount.
    expect(web).toMatch(/ref:\s*attachVideo/);
  });

  it("onCanPlay re-asserts muted before the (re)play attempt", () => {
    expect(web).toMatch(/onCanPlay/);
    expect(web).toMatch(/event\.currentTarget\.muted\s*=\s*effectiveMuted/);
  });

  it("keeps controls disabled, loop, and inline-playback attributes (no native chrome regression)", () => {
    expect(web).toMatch(/controls:\s*false/);
    expect(web).toMatch(/loop,/);
    expect(web).toMatch(/playsInline:\s*true/);
    // It must NOT regress to showing native controls.
    expect(web).not.toMatch(/controls:\s*true/);
  });

  it("does NOT pass the raw `muted` prop straight to the <video> element (would reintroduce the play button)", () => {
    // The element-level muted is effectiveMuted; a bare `muted,` (shorthand) or
    // `muted: muted` on the createElement props would defeat the hard-mute gate.
    const createEl = web.slice(web.indexOf('React.createElement("video"'));
    expect(createEl).toMatch(/muted:\s*effectiveMuted/);
    expect(createEl).not.toMatch(/\bmuted,\b/);
    expect(createEl).not.toMatch(/muted:\s*muted\b/);
  });
});

describe("ORCH-1167-R5 — EventCoverMedia mute state follows the chrome toggle (unmute works on web)", () => {
  const src = stripComments(read(COVER));

  it("the sync effect follows the parent `muted` prop on an IN-PLACE change (not force-muted on web)", () => {
    // The R4-era effect hard-set `setIsMuted(Platform.OS === "web" && autoplay ?
    // true : muted)` on EVERY prop change, which re-muted the cover the instant
    // the user unmuted via the chrome toggle. R5 splits NEW-media (reset to the
    // web autoplay-muted default) from an in-place change (pass `muted` through).
    expect(src).toMatch(/const isNewMedia\s*=\s*mediaUrlRef\.current\s*!==\s*mediaUrl/);
    // In-place change passes the parent prop straight through.
    expect(src).toMatch(/setIsMuted\(muted\)/);
    // New media still resets to the web autoplay-muted default.
    expect(src).toMatch(
      /setIsMuted\(Platform\.OS === "web" && autoplay \? true : muted\)/,
    );
  });

  it("the cover still DEFAULTS to muted on web autoplay (initial ambient muted loop)", () => {
    expect(src).toMatch(
      /const initialMuted\s*=\s*Platform\.OS === "web" && autoplay \? true : muted/,
    );
    expect(src).toMatch(/useState\(initialMuted\)/);
  });
});
