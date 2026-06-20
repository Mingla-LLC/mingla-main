// ORCH-1167-R7 → R8 [TEST-MOD-APPROVED ORCH-1167]. This file originally pinned
// the R7 fix: a React-RENDERED `<video>` (React.createElement) driven by the
// native `autoPlay` attribute with no play()-hammer. R8 SUPERSEDES the
// MECHANISM (not the intent): exhaustive Playwright forensics on the LIVE page
// (headless WebKit) proved that ANY React-RENDERED / React-reconciled `<video>`
// is PERMANENTLY DENIED inline-muted autoplay by desktop Safari/WebKit — it
// shows the native play button and never autoplays — while EVERY video created
// via `document.createElement('video')` (raw DOM) and appended on the EXACT
// same live page AUTOPLAYS. So React's rendering/reconciliation of the
// `<video>` node is ITSELF the poison; the R7 attribute-only React video was
// still poisoned.
//
// THE R8 FIX, asserted here (all in the EventCoverWebVideo web branch of
// EventCoverMedia.tsx):
//   (1) React owns ONLY a plain container `<div>` (React.createElement("div"));
//       it NEVER owns/reconciles the `<video>`. The `<video>` is created
//       IMPERATIVELY via `document.createElement('video')` and appended into
//       the container ref. There is NO `React.createElement("video"` and NO
//       `<video>` JSX in the web branch.
//   (2) The muted ambient autoplay is driven by the native ATTRIBUTES on the
//       imperative element (autoplay + muted + playsinline), mirroring the
//       proven-working bare element — NOT by a manual play() kickoff.
//   (3) The R6 `driveMutedAutoplay` play()-hammer driver stays GONE (no import,
//       no call, no export), and there is no setTimeout/rAF retry-backoff in
//       the web path. Any recovery play() is GUARDED by `readyState >= 3` AND
//       `paused` — never at readyState 0 (the WebKit poison theory).
//   (4) The R5 contracts survive on the imperative element: `effectiveMuted`,
//       the muted/playsinline attribute pin at create, `controls = false`,
//       loop, inline playback (`playsInline`).
//
// Source-structural (readFileSync) — the same proven pattern as the R2–R7
// ORCH-1167 tests: these mounts import react-native + expo-video and cannot run
// under node-env jest, and there is no jsdom in this repo, so the web autoplay
// contract is pinned as a source contract. The AUTHORITATIVE runtime proof
// (real R8 imperative-DOM cover autoplaying on the live denying page, headless
// WebKit) is the ORCHESTRATOR's Vercel-preview WebKit check — NOT any local bed.
//
// FAILS-ON-REVERT:
//   • Reintroduce a React-rendered `<video>` (React.createElement("video") or
//     `<video>` JSX) → "React owns ONLY the container div" FAILS.
//   • Reintroduce the `driveMutedAutoplay(video)` hammer → "no play()-hammer
//     driver" FAILS.
//   • Drop `document.createElement('video')` → "creates the video imperatively"
//     FAILS.
//   • Issue an unguarded play() while muted (drop the readyState>=3 guard) →
//     "no unguarded play() while muted" FAILS.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(__dirname, "..", "..", "..");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const COVER = "packages/offering-rendering/EventCoverMedia.tsx";
const INDEX = "packages/offering-rendering/index.ts";

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

describe("ORCH-1167-R8 — web cover renders an IMPERATIVE DOM <video> (React never reconciles it); attribute-driven autoplay, no play()-hammer (WebKit poison fix)", () => {
  const rawCover = read(COVER);
  const cover = stripComments(rawCover);
  const web = webVideoBody(cover);
  const index = stripComments(read(INDEX));

  it("React owns ONLY a container div — there is NO React-rendered <video> in the web branch (the R8 poison fix)", () => {
    // No React.createElement("video", …) and no <video> JSX — React must never
    // own/reconcile the cover video node (that is what WebKit poisons).
    expect(web).not.toMatch(/React\.createElement\(\s*["']video["']/);
    expect(web).not.toMatch(/<video[\s/>]/);
    // React owns the plain container div instead.
    expect(web).toMatch(/React\.createElement\(\s*["']div["']/);
  });

  it("creates the <video> IMPERATIVELY via document.createElement and appends it into the container ref", () => {
    expect(web).toMatch(/document\.createElement\(\s*["']video["']\s*\)/);
    expect(web).toMatch(/\.appendChild\(\s*video\s*\)/);
    // The container ref is wired to the React div.
    expect(web).toMatch(/const containerRef\s*=/);
    expect(web).toMatch(/ref:\s*containerRef/);
  });

  it("drives the muted ambient autoplay via the native ATTRIBUTES on the imperative element (like the proven bare element)", () => {
    // autoplay attribute set from shouldPlay; muted + playsinline attributes
    // pinned at create.
    expect(web).toMatch(/video\.autoplay\s*=\s*shouldPlay/);
    expect(web).toMatch(/video\.setAttribute\(\s*["']muted["']\s*,\s*""\s*\)/);
    expect(web).toMatch(
      /video\.setAttribute\(\s*["']playsinline["']\s*,\s*""\s*\)/,
    );
    expect(web).toMatch(
      /video\.setAttribute\(\s*["']webkit-playsinline["']\s*,\s*""\s*\)/,
    );
  });

  it("the R6 driveMutedAutoplay play()-hammer driver is REMOVED (no import, no call, no export)", () => {
    expect(web).not.toMatch(/driveMutedAutoplay/);
    expect(cover).not.toMatch(/driveMutedAutoplay/);
    expect(cover).not.toMatch(/coverWebVideoAutoplay/);
    expect(index).not.toMatch(/driveMutedAutoplay/);
    expect(index).not.toMatch(/coverWebVideoAutoplay/);
  });

  it("issues NO unguarded play() while hard-muted — any recovery play() is gated by readyState >= 3 AND paused (never at readyState 0)", () => {
    // The guarded late recovery is the canplaythrough listener gated by rs>=3.
    expect(web).toMatch(/addEventListener\(\s*["']canplaythrough["']/);
    expect(web).toMatch(/readyState\s*<\s*3/);
    expect(web).toMatch(/const recover\s*=/);
    expect(web).toMatch(
      /if\s*\(\s*video\.readyState\s*<\s*3\s*\|\|\s*!video\.paused\s*\)\s*return/,
    );
    expect(web).toMatch(/removeEventListener\(\s*["']canplaythrough["']/);
    // No retry-backoff hammer anywhere in the web cover branch.
    expect(web).not.toMatch(/COVER_AUTOPLAY_READY_EVENTS/);
    expect(web).not.toMatch(/setTimeout/);
    expect(web).not.toMatch(/requestAnimationFrame/);
  });

  it("preserves the R5 contracts on the imperative element (effectiveMuted, controls disabled, loop, inline playback)", () => {
    expect(web).toMatch(/const effectiveMuted\s*=/);
    expect(web).toMatch(/video\.muted\s*=\s*effectiveMuted/);
    expect(web).toMatch(/video\.controls\s*=\s*false/);
    expect(web).toMatch(/video\.loop\s*=/);
    expect(web).toMatch(/video\.playsInline\s*=\s*true/);
    expect(web).not.toMatch(/video\.controls\s*=\s*true/);
  });
});
