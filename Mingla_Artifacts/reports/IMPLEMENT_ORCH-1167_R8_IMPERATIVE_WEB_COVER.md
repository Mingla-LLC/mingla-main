# IMPLEMENT — ORCH-1167 R8 — Imperative-DOM web cover video (WebKit autoplay poison fix)

**Ticket:** ORCH-1167 [event-page-canonical] · Round 8
**Branch:** `ORCH-1167-r8-imperative-web-cover` (off latest origin/main, incl. R1–R7)
**Scope:** WEB-ONLY, UI-ONLY. Cover video render mechanism in the shared cover component. No schema / RPC / migration / package-config / native changes.
**Surface impact:** buyer-web + business-web event/trip/experience/rsvp public-page hero cover (shared component). Native (expo-video) path UNCHANGED. Image/GIF covers UNCHANGED.

> ⚠️ **Autoplay verification is the ORCHESTRATOR's job, not this report's.** Three prior rounds (R5/R6/R7) FALSE-PASSED because local/isolated test beds do NOT reproduce the desktop-Safari/WebKit autoplay denial. This report makes **no claim** that autoplay is fixed. The authoritative check is the orchestrator's headless-WebKit verification against a real **Vercel PREVIEW** deploy of this branch. This report only attests that the imperative-DOM cover is implemented cleanly, typechecks, and passes the gates/tests.

---

## Proven root cause (orchestrator, exhaustive Playwright forensics on the LIVE page vs desktop Safari/WebKit)

- The event-cover video PLAYS but does NOT AUTOPLAY on desktop Safari/WebKit (native play button shown; user must click). Autoplays fine on Chrome + all mobile (incl. mobile web).
- NOT caused by: play() calls, attributes, ancestor CSS (transform/overflow/aspect-ratio), or the lazy-mount swap — all autoplay fine when tested with a hand-created element on the same live page.
- **Decisive finding:** EVERY video created via `document.createElement('video')` (raw DOM) and appended on the exact live page AUTOPLAYS — but the component's REACT-RENDERED `<video>` (R5/R6/R7 used `React.createElement("video", {...})`) is PERMANENTLY DENIED autoplay by WebKit. **React's rendering/reconciliation of the `<video>` node is itself the poison.**

## The fix (this round)

In `EventCoverWebVideo` (web branch of `packages/event-rendering/EventCoverMedia.tsx`):

- React now renders ONLY a plain container `React.createElement("div", { ref: containerRef, ... })`. **React never owns/reconciles the `<video>` node.**
- A `useEffect` (keyed on `uri` + `contentFit`) creates the video with `document.createElement('video')`, mirrors the proven-working bare element, and appends it into the container ref:
  - `muted = true` (property) + `setAttribute('muted','')` + `setAttribute('playsinline','')` + `setAttribute('webkit-playsinline','')` + `playsInline = true`
  - `autoplay = shouldPlay` + `loop = <loop>` + `controls = false` + `preload = 'auto'`
  - cover styles (objectFit `cover|contain`, absolute fill) via `Object.assign(video.style, …)`
  - `src = uri` set LAST, then `appendChild` — matching the bare element's construction order.
  - **No manual play() is required for autoplay** — the attributes drive it (the WebKit-granted path).
- **Existing features wired through to the imperative element:**
  - **Mute/Unmute toggle:** a follow-prop `useEffect` updates `videoEl.muted` (= `effectiveMuted`) when the parent `muted` prop changes (unmute = real user gesture → honored). R5 behavior preserved: FIRST autoplay is hard-muted (`hasUnmutedRef`); only follows the prop after the user has unmuted.
  - **Aspect ratio:** `loadedmetadata` → `videoWidth/videoHeight` → `onAspectRatio` (read via ref so the create effect doesn't re-run on a callback swap).
  - **Error → fallback:** `error` event → existing `onError` path (EventCover placeholder shows).
  - **Reduce-motion freeze:** preserved via the existing parent path — when frozen, presentation becomes `video_still` and the parent passes `autoplay={false}`, so `shouldPlay` is false and `video.autoplay` is not set / the element is paused.
  - **Guarded late recovery:** the `canplaythrough` listener (gated `readyState >= 3` AND `paused`) is retained — never at readyState 0.
  - **Full teardown** on unmount / src change: listeners removed, `pause()`, `removeAttribute('src')`, `removeChild`, ref cleared.
- Lazy-mount/`inView` gating, image/GIF covers, and the NATIVE (expo-video) path are UNCHANGED.

`WEB_VIDEO_STYLE` (the old element style) was replaced by `WEB_VIDEO_CONTAINER_STYLE` (the React-owned div); the video's styles are applied imperatively.

---

## Changed files

| File | Change |
|------|--------|
| `packages/event-rendering/EventCoverMedia.tsx` | `EventCoverWebVideo` rewritten to render a React `<div>` container + an imperatively-created DOM `<video>` (was `React.createElement("video")`). Style constant renamed `WEB_VIDEO_STYLE` → `WEB_VIDEO_CONTAINER_STYLE`. Native path untouched. |
| `packages/event-rendering/__tests__/coverWebVideoImperativeMount.orch1167r8.test.ts` | **NEW** source-structural test for the imperative-mount contract + feature wiring + teardown + native-path-untouched. |
| `packages/offering-rendering/__tests__/orch_1167_r7_webkit_cover_no_play_hammer.test.ts` | **`[TEST-MOD-APPROVED ORCH-1167]`** — migrated assertions from the React-rendered-`<video>` mechanism to the imperative-DOM mechanism (intent preserved). |
| `packages/offering-rendering/__tests__/orch_1167_r5_web_cover_autoplay_muted.test.ts` | **`[TEST-MOD-APPROVED ORCH-1167]`** — first `describe` block's React-prop assertions migrated to the imperative-element form (intent preserved). Parent-state `describe` block unchanged. |

The two test files were MODIFIED IN PLACE (not deleted) per the tests-append-only gate; the new test is ADDED.

---

## Results

**Typecheck:** zero net-new type errors. Diff of `EventCoverMedia.tsx` errors between baseline (R7) and R8 under `mingla-business/tsc -p .` is EMPTY (the only errors are the pre-existing `react`-module-resolution artifact of compiling the path-mapped package, identical on both).

**Jest — ORCH-1167 cover tests (run via `jest --roots ../packages`):**
- `coverWebVideoImperativeMount.orch1167r8.test.ts` (NEW) — PASS (7 tests)
- `orch_1167_r7_webkit_cover_no_play_hammer.test.ts` — PASS (6 tests)
- `orch_1167_r5_web_cover_autoplay_muted.test.ts` — PASS (7 tests)
- `coverWebVideoAutoplay.orch1167r6.test.ts` — PASS (placeholder)
- `orch_1167_r2/r3/r4_*` + `orch_1167_event_box_totals` — PASS (unchanged)

**Full offering-rendering + event-rendering jest run:** `Tests: 52 passed, 52 total`. The 13 "failed suites" are pre-existing **Deno-syntax** tests (`Deno.test(...)`) that error at collection under jest — identical to baseline (verified each FAIL file contains `Deno.test`). Zero jest-runnable tests fail. Net delta vs baseline: only the new R8 file added (now passing) and R5 flipped back to passing.

**5 ORCH-1167 strict-grep gates:** ALL PASS
- `orch-1167-allin-price-in-ticket-box` ✅
- `orch-1167-canonical-9-section-order` ✅
- `orch-1167-city-level-map-no-exact-pin-when-hidden` ✅
- `orch-1167-one-read-rpc` ✅
- `orch-1167-shell-agnostic-body` ✅

**I-MOR-0827 package-isolation gate:** PASS (no new app-src imports; only react/react-native + the `document` web global).

**FAILS-ON-REVERT proof:** the NEW `coverWebVideoImperativeMount.orch1167r8.test.ts` FAILS against the unmodified R7 source (proven by running it on `git stash`-reverted baseline — the React-rendered-`<video>` source has no `document.createElement('video')`/imperative mount, so the imperative-mount assertions fail). It passes only with the R8 imperative-DOM cover.

---

## Guards honored

- WEB-only; native (expo-video) path byte-unchanged.
- No schema/RPC/migration/package-config change.
- R1–R7 contracts preserved (canonical body, one-read RPC, shell-agnostic body, all-in price, city-level map). The 5 I-PROPOSED-1167 gates + I-MOR-0827 all green.
- Trip/experience/rsvp covers inherit the same shared cover component (expected — same cover, no per-page logic touched).

## `[deploy]`-readiness

Buyer-web ships from **main** only (it can't be OTA'd). This branch is PUSHED so Vercel builds a **PREVIEW** for the orchestrator's headless-WebKit autoplay verification. Do NOT merge/OTA from here. When the orchestrator confirms autoplay on the preview, the merge commit to main must carry `[deploy]` (and beware the Vercel `[deploy]`-gate cancel trap — a non-`[deploy]` commit landing after yours cancels the web build; push an empty `[deploy]` commit if so).
