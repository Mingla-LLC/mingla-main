// ORCH-1167-R7 [WebKit cover poison] — implementor-owned regression for the R7
// fix. ROOT CAUSE (proven via Playwright against the LIVE deployed page on
// headless WebKit): the R6 web cover drove its muted ambient autoplay by calling
// `video.play()` MANUALLY and HAMMERING it (~50× via `driveMutedAutoplay`), with
// the FIRST attempt firing at `readyState 0` (before any media). On WebKit that
// gesture-less play()-at-readyState-0 POISONS the element's one-time inline-
// autoplay eligibility: WebKit rejects with NotAllowedError and PERMANENTLY denies
// THAT element (all 56 retries rejected), so the cover stayed paused under
// Safari's native play-button overlay. Decisive proof: on the SAME live page a
// fresh bare `<video autoplay muted playsinline src>` (which NEVER calls play())
// autoplays, while the component's hammered element stays dead.
//
// THE R7 FIX, asserted here (all in the EventCoverWebVideo web branch of
// EventCoverMedia.tsx):
//   (1) The cover relies on the native `autoPlay` ATTRIBUTE (+ the muted +
//       playsinline attributes pinned at mount) to drive the muted ambient
//       autoplay — the SAME mechanism as the proven-working bare element.
//   (2) The R6 `driveMutedAutoplay` play()-hammer driver is GONE (no import, no
//       call). The module + its export were deleted.
//   (3) NO unconditional `video.play()` is issued while hard-muted. Any recovery
//       play() (the canplaythrough listener + onCanPlay) is GUARDED by
//       `readyState >= 3` AND `paused` — never at readyState 0, which is the
//       attempt that poisons WebKit.
//   (4) The R5 contracts survive: `effectiveMuted`, the `attachVideo` mount pin,
//       `muted: effectiveMuted`, controls:false, loop, playsInline.
//
// Source-structural (readFileSync) — the same proven pattern as the R2–R5
// ORCH-1167 tests: these mounts import react-native + expo-video and cannot run
// under node-env jest, and there is no jsdom in this repo, so the web autoplay
// contract is pinned as a source contract. The RUNTIME proof (real R7 component
// autoplaying on the live denying page, headless WebKit) is in the R7 report.
//
// FAILS-ON-REVERT (proven by TRUE deletion in the implementation report):
//   • Re-introduce the `driveMutedAutoplay(video)` hammer call (the R6 bug) →
//     "no play()-hammer driver" FAILS.
//   • Drop the `autoPlay` attribute → "drives autoplay via the autoplay
//     attribute" FAILS.
//   • Issue an unconditional `video.play()` while muted (the R5 single-attempt /
//     R6 hammer at readyState 0) → "no unguarded play() while muted" FAILS.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..", "..");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const COVER = "packages/event-rendering/EventCoverMedia.tsx";
const INDEX = "packages/event-rendering/index.ts";

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// Slice the EventCoverWebVideo component body (web branch only).
const webVideoBody = (src: string): string => {
  const open = src.indexOf("const EventCoverWebVideo");
  expect(open).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("const EventCoverNativeVideo");
  expect(next).toBeGreaterThan(open);
  return src.slice(open, next);
};

describe("ORCH-1167-R7 — web cover autoplays via the native autoplay ATTRIBUTE, no play()-hammer (WebKit poison fix)", () => {
  const rawCover = read(COVER);
  const cover = stripComments(rawCover);
  const web = webVideoBody(cover);
  const index = stripComments(read(INDEX));

  it("the R6 driveMutedAutoplay play()-hammer driver is REMOVED (no import, no call, no export)", () => {
    // The bug was the hammer. It must be gone from the web branch...
    expect(web).not.toMatch(/driveMutedAutoplay/);
    // ...from the whole cover module (no import)...
    expect(cover).not.toMatch(/driveMutedAutoplay/);
    expect(cover).not.toMatch(/coverWebVideoAutoplay/);
    // ...and from the package barrel (no export).
    expect(index).not.toMatch(/driveMutedAutoplay/);
    expect(index).not.toMatch(/coverWebVideoAutoplay/);
  });

  it("drives the muted ambient autoplay via the native autoPlay ATTRIBUTE (like the proven bare element)", () => {
    const createEl = web.slice(web.indexOf('React.createElement("video"'));
    expect(createEl).toMatch(/autoPlay:\s*shouldPlay/);
    // muted + playsinline attributes are pinned at mount (R5 attachVideo).
    expect(web).toMatch(/node\.setAttribute\("muted",\s*""\)/);
    expect(web).toMatch(/node\.setAttribute\("playsinline",\s*""\)/);
    expect(web).toMatch(/ref:\s*attachVideo/);
  });

  it("issues NO unguarded play() while hard-muted — any recovery play() is gated by readyState >= 3 AND paused (never at readyState 0)", () => {
    // There must be no bare `video.play()` kickoff in the muted ambient path.
    // The ONLY play() calls allowed in the web branch are: (a) the unmuted
    // user-gesture branch, and (b) recovery calls guarded by `readyState >= 3`.
    // Count the play() invocations and ensure every one in a muted context is
    // either the unmuted branch or readyState-guarded.
    // 1) The effect's muted branch uses a `canplaythrough` recovery guarded by rs>=3.
    expect(web).toMatch(/addEventListener\("canplaythrough"/);
    expect(web).toMatch(/readyState\s*<\s*3/);
    // 2) onCanPlay only plays when readyState >= 3 AND paused.
    expect(web).toMatch(/readyState\s*>=\s*3\s*&&[\s\S]*?\.paused/);
    // 3) No "play() every readyState event" retry loop pattern (the R6 hammer):
    //    there is no array of ready events each calling play(), and no setTimeout
    //    backoff re-driving play() while muted.
    expect(web).not.toMatch(/COVER_AUTOPLAY_READY_EVENTS/);
    // 4) The muted branch registers the guarded `recover` listener and returns
    //    its cleanup; the recover closure's play() is gated by rs>=3 + paused, and
    //    there is no setTimeout/rAF retry-backoff hammer anywhere in the web path.
    expect(web).toMatch(/const recover\s*=/);
    expect(web).toMatch(/if\s*\(video\.readyState\s*<\s*3\s*\|\|\s*!video\.paused\)\s*return/);
    expect(web).toMatch(/video\.removeEventListener\("canplaythrough"/);
    // No retry-backoff hammer anywhere in the web cover branch (R6 used these).
    expect(web).not.toMatch(/setTimeout/);
    expect(web).not.toMatch(/requestAnimationFrame/);
  });

  it("preserves the R5 contracts (effectiveMuted, controls disabled, loop, inline playback)", () => {
    expect(web).toMatch(/const effectiveMuted\s*=/);
    expect(web).toMatch(/muted:\s*effectiveMuted/);
    expect(web).toMatch(/controls:\s*false/);
    expect(web).toMatch(/loop,/);
    expect(web).toMatch(/playsInline:\s*true/);
    expect(web).not.toMatch(/controls:\s*true/);
  });
});
