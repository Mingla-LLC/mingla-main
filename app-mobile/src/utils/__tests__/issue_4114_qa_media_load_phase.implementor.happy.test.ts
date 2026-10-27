// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 simulator QA run 2 (evidence 02j): the view-once photo spinner
// never cleared because the modal's onShow re-armed loading after the image's
// onLoadEnd had already fired.
//
// FAILS-ON-REVERT: re-arm loading on show (or reset it from an effect after a
// cached load), or let the video player miss a status reached before it
// subscribed, and the matching case fails.

import {
  EMPTY_MEDIA_LOAD_STATE,
  markMediaFailed,
  markMediaLoaded,
  mediaLoadPhase,
} from "../mediaLoadPhase.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("QA run 2: a new url is loading until its own load end", () => {
  assert(mediaLoadPhase(null, EMPTY_MEDIA_LOAD_STATE) === "idle", "no url is idle");
  assert(mediaLoadPhase("a", EMPTY_MEDIA_LOAD_STATE) === "loading", "a new url loads");
  const loaded = markMediaLoaded(EMPTY_MEDIA_LOAD_STATE, "a");
  assert(mediaLoadPhase("a", loaded) === "loaded", "load end clears the spinner");
  assert(mediaLoadPhase("b", loaded) === "loading", "a retry url starts over");
});

Deno.test("QA run 2: a cached image that loaded before the modal showed stays loaded", () => {
  // Load end lands first; showing the modal changes nothing in the state.
  const state = markMediaLoaded(EMPTY_MEDIA_LOAD_STATE, "cached");
  assert(mediaLoadPhase("cached", state) === "loaded", "never re-armed");
});

Deno.test("QA run 2: an error clears the spinner, and a trailing load end does not hide it", () => {
  const failed = markMediaFailed(EMPTY_MEDIA_LOAD_STATE, "a");
  assert(mediaLoadPhase("a", failed) === "failed", "error shown");
  assert(mediaLoadPhase("a", markMediaLoaded(failed, "a")) === "failed", "iOS onLoadEnd after onError keeps the error");
  assert(mediaLoadPhase("b", markMediaLoaded(failed, "b")) === "loaded", "the retry url loads");
});

Deno.test("QA run 2: the viewers never re-arm loading on show and read the video status on subscribe", async () => {
  const photo = strip(await read("components/chat/ViewOncePhotoViewer.tsx"));
  assert(!/onShow=/.test(photo), "no onShow reset");
  assert(!/setLoading\(/.test(photo), "no loading flag to re-arm");
  assert(/onLoadEnd=\{\(\) => setLoadState\(\(prev\) => markMediaLoaded\(prev, url\)\)\}/.test(photo), "load end settles this url");
  assert(/onError=\{\(\) => \{\s*setLoadState\(\(prev\) => markMediaFailed\(prev, url\)\);/.test(photo), "error settles this url");
  const video = strip(await read("components/chat/ChatVideoPlayerModal.tsx"));
  const effect = video.slice(video.indexOf('player.addListener("statusChange"'));
  assert(/setStatus\(player\.status\);/.test(effect.slice(0, 600)), "video reads the status it may have missed");
  assert(!/onShow=/.test(video), "video modal has no onShow reset");
});
