// ORCH-1167-R8 [imperative DOM web cover]. New implementor-owned source contract
// for the R8 fix: on WEB the cover `<video>` is created IMPERATIVELY via
// `document.createElement('video')` and appended into a React-owned container
// `<div>`, so React NEVER reconciles the `<video>` node. PROVEN ROOT CAUSE
// (orchestrator, exhaustive Playwright forensics on the LIVE page, headless
// WebKit): every React-rendered/reconciled `<video>` is permanently DENIED
// inline-muted autoplay on desktop Safari/WebKit (shows the play button), while
// every `document.createElement('video')` appended on the same live page
// AUTOPLAYS. So React's reconciliation of the `<video>` is itself the poison.
//
// This test pins the IMPERATIVE-MOUNT contract specifically:
//   • the element is built imperatively and appended into the container ref;
//   • the existing features are wired through to the imperative element —
//     aspect-ratio (loadedmetadata), error → onError fallback, loop (ended),
//     mute toggle (video.muted follows effectiveMuted), reduce-motion freeze
//     (the autoplay attribute follows shouldPlay, which the parent zeroes when
//     the cover is frozen / not playing);
//   • the element is fully TORN DOWN on unmount / src change (listeners removed,
//     src cleared, node removed from the DOM);
//   • the NATIVE (expo-video) branch is untouched.
//
// Source-structural (readFileSync) — these mounts pull react-native + expo-video
// and there is no jsdom here, so the web autoplay contract is a SOURCE contract;
// the AUTHORITATIVE runtime proof is the orchestrator's Vercel-preview headless-
// WebKit autoplay check (no local bed reproduces the WebKit poison).

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

const sliceBetween = (src: string, startMarker: string, endMarker: string): string => {
  const open = src.indexOf(startMarker);
  expect(open).toBeGreaterThanOrEqual(0);
  const next = src.indexOf(endMarker, open + startMarker.length);
  expect(next).toBeGreaterThan(open);
  return src.slice(open, next);
};

describe("ORCH-1167-R8 — imperative DOM <video> mount + feature wiring + teardown", () => {
  const cover = stripComments(read(COVER));
  const web = sliceBetween(cover, "const EventCoverWebVideo", "const EventCoverNativeVideo");
  const native = sliceBetween(cover, "const EventCoverNativeVideo", "const EventCoverVideo");

  it("builds the <video> imperatively and appends it into the container ref (React reconciles only the div)", () => {
    expect(web).toMatch(/const video\s*=\s*document\.createElement\(\s*["']video["']\s*\)/);
    expect(web).toMatch(/container(?:Ref\.current)?\??\.appendChild\(\s*video\s*\)/);
    // The src is assigned to the imperative element (not a React `src=` prop).
    expect(web).toMatch(/video\.src\s*=\s*uri/);
    // React renders the container div, never a video element.
    expect(web).toMatch(/React\.createElement\(\s*["']div["']/);
    expect(web).not.toMatch(/React\.createElement\(\s*["']video["']/);
  });

  it("wires aspect-ratio reporting through loadedmetadata on the imperative element", () => {
    expect(web).toMatch(/addEventListener\(\s*["']loadedmetadata["']/);
    expect(web).toMatch(/video\.videoWidth\s*\/\s*video\.videoHeight/);
  });

  it("wires error → onError fallback and loop via the ended event", () => {
    expect(web).toMatch(/addEventListener\(\s*["']error["']/);
    expect(web).toMatch(/onError/);
    expect(web).toMatch(/addEventListener\(\s*["']ended["']/);
    // The loop recovery only fires when we should be playing.
    expect(web).toMatch(/shouldPlay/);
  });

  it("the mute toggle follows the parent prop on the imperative element (effectiveMuted, R5 first-autoplay-muted)", () => {
    expect(web).toMatch(/const effectiveMuted\s*=/);
    expect(web).toMatch(/hasUnmutedRef/);
    expect(web).toMatch(/video\.muted\s*=\s*effectiveMuted/);
  });

  it("the reduce-motion freeze flows through the autoplay attribute (shouldPlay drives video.autoplay)", () => {
    expect(web).toMatch(/const shouldPlay\s*=\s*autoplay\s*&&\s*playbackActive/);
    expect(web).toMatch(/video\.autoplay\s*=\s*shouldPlay/);
  });

  it("fully tears down the imperative element on unmount / src change (listeners removed, src cleared, node removed)", () => {
    expect(web).toMatch(/removeEventListener\(\s*["']loadedmetadata["']/);
    expect(web).toMatch(/removeEventListener\(\s*["']error["']/);
    expect(web).toMatch(/removeEventListener\(\s*["']ended["']/);
    expect(web).toMatch(/video\.removeAttribute\(\s*["']src["']\s*\)/);
    expect(web).toMatch(/removeChild\(\s*video\s*\)/);
    // The create effect re-runs on uri change (so a new src rebuilds + cleans up
    // the old element). The dependency array includes uri.
    expect(web).toMatch(/\}\s*,\s*\[uri[\s\S]*?\]\s*\)/);
  });

  it("leaves the NATIVE (expo-video) path untouched — still uses VideoView + useVideoPlayer, no document.createElement", () => {
    expect(native).toMatch(/useVideoPlayer/);
    expect(native).toMatch(/VideoView/);
    expect(native).not.toMatch(/document\.createElement/);
  });
});
