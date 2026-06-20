// ORCH-1167-R5 [web cover autoplay-muted] — implementor-owned regression for the
// single R5 revision: a VIDEO event-cover on BUYER WEB must AUTOPLAY MUTED by
// default so the browser permits inline autoplay and NEVER paints its native
// PLAY BUTTON. On mobile the cover already autoplays muted+loops (R4); R5 is
// web-specific — browsers only allow gesture-free inline autoplay when the
// <video> is MUTED at play() time, so a single unmuted play() attempt paints the
// native control overlay (the bug Seth saw live on buyer-web).
//
// [TEST-MOD-APPROVED ORCH-1167] — R8 MECHANISM MIGRATION (intent UNCHANGED).
// R5/R6/R7 expressed the web cover as a React-RENDERED <video> (React.createElement
// + JSX props: `muted: effectiveMuted`, `attachVideo` ref callback, `onCanPlay`,
// `controls: false`). ORCH-1167-R8 proved (orchestrator Playwright forensics, live
// page, headless WebKit) that ANY React-reconciled <video> is permanently DENIED
// inline-muted autoplay by desktop Safari/WebKit, and replaced it with an
// IMPERATIVELY created `document.createElement('video')` appended into a React-owned
// container <div>. The R5 INTENT below is fully preserved on the imperative element
// — the FIRST autoplay is hard-muted (`effectiveMuted` / `hasUnmutedRef`), the
// muted + playsinline + webkit-playsinline ATTRIBUTES are pinned at create, controls
// stay off, loop + inline playback are preserved — but the ASSERTION ANCHORS are
// migrated from the React-prop form to the imperative-element form
// (`video.muted = effectiveMuted`, `video.controls = false`, `video.loop = …`,
// `video.playsInline = true`). The React-prop assertions are intentionally removed
// (they would now pin the very mechanism R8 proved poisons WebKit autoplay).
//
// THE FIX, asserted here (all in the web branch of EventCoverMedia.tsx):
//   (1) The web <video>'s FIRST autoplay attempt is HARD-MUTED regardless of the
//       incoming `muted` prop (`effectiveMuted` is true until the user unmutes),
//       so the browser always permits the inline autoplay and no play button
//       shows. A `hasUnmutedRef` records the first user-gesture unmute; only then
//       does the element follow the live `muted` prop.
//   (2) The imperatively created element pins the `muted` + `playsinline` +
//       `webkit-playsinline` ATTRIBUTES at create — before the browser evaluates
//       autoplay eligibility.
//   (3) `controls` stays false (no native chrome), `playsInline` stays true,
//       `loop` is preserved.
//   (4) The shared EventCoverMedia mute STATE follows the parent `muted` prop on
//       in-place changes (so the chrome Mute/Unmute toggle reaches the cover),
//       and resets to the web autoplay-muted default only on a NEW media url.
//
// Source-structural (readFileSync) — the same proven pattern as the R2/R3/R4/R7/R8
// ORCH-1167 tests: these mounts import react-native + expo-video and cannot run
// under node-env jest, and there is no jsdom in this repo, so the web autoplay
// contract is pinned as a source contract. The AUTHORITATIVE runtime proof is the
// orchestrator's Vercel-preview headless-WebKit check (no local bed reproduces it).
//
// FAILS-ON-REVERT:
//   • Pass the raw `muted` prop to the element instead of `effectiveMuted` (drop
//     the hasUnmutedRef hard-mute) → "first autoplay is hard-muted" FAILS.
//   • Drop the muted-attribute pin at create → "pins muted attribute" FAILS.
//   • Re-enable controls → "controls disabled" FAILS.
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

  it("the imperative <video>'s autoplay attempt is HARD-MUTED until the user unmutes (effectiveMuted, not the raw prop)", () => {
    // The hard-mute gate exists.
    expect(web).toMatch(/hasUnmutedRef/);
    expect(web).toMatch(/const effectiveMuted\s*=/);
    // The imperative element's `muted` is driven by effectiveMuted, NOT the raw prop.
    expect(web).toMatch(/video\.muted\s*=\s*effectiveMuted/);
    // The user-gesture unmute is recorded so the toggle can later take over.
    expect(web).toMatch(/if\s*\(!muted\)\s*hasUnmutedRef\.current\s*=\s*true/);
  });

  it("pins the muted + playsinline + webkit-playsinline ATTRIBUTES at create (before autoplay eligibility check)", () => {
    // The imperative element is muted at create...
    expect(web).toMatch(/video\.muted\s*=\s*true/);
    // ...and the autoplay-eligibility attributes are pinned on it.
    expect(web).toMatch(/video\.setAttribute\(\s*["']muted["']\s*,\s*""\s*\)/);
    expect(web).toMatch(/video\.setAttribute\(\s*["']playsinline["']\s*,\s*""\s*\)/);
    expect(web).toMatch(
      /video\.setAttribute\(\s*["']webkit-playsinline["']\s*,\s*""\s*\)/,
    );
    // It is built imperatively via document.createElement (never React-rendered).
    expect(web).toMatch(/document\.createElement\(\s*["']video["']\s*\)/);
    expect(web).not.toMatch(/React\.createElement\(\s*["']video["']/);
  });

  it("re-asserts muted (effectiveMuted) when prop changes on the existing element", () => {
    // The follow-prop effect re-applies effectiveMuted to the existing element.
    expect(web).toMatch(/video\.muted\s*=\s*effectiveMuted/);
  });

  it("keeps controls disabled, loop, and inline-playback on the imperative element (no native chrome regression)", () => {
    expect(web).toMatch(/video\.controls\s*=\s*false/);
    expect(web).toMatch(/video\.loop\s*=/);
    expect(web).toMatch(/video\.playsInline\s*=\s*true/);
    // It must NOT regress to enabling native controls.
    expect(web).not.toMatch(/video\.controls\s*=\s*true/);
  });

  it("does NOT pass the raw `muted` prop straight to the element (would reintroduce the play button)", () => {
    // The element-level muted is effectiveMuted; a `video.muted = muted` would
    // defeat the hard-mute gate.
    expect(web).toMatch(/video\.muted\s*=\s*effectiveMuted/);
    expect(web).not.toMatch(/video\.muted\s*=\s*muted\b/);
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
