# IMPLEMENT — ORCH-1167 R7: WebKit/Safari cover-video autoplay poison (UI-only)

**Branch:** `ORCH-1167-r7-webkit-cover-poison` (off origin/main incl. R1–R6)
**Scope:** UI-only. Standard event public page canonical cover. No schema/RPC/migration/package-config.
**Status:** FIXED + PROVEN (reproduce-then-prove on the REAL component, headless WebKit).

---

## 1. Confirmed root cause (which hypothesis)

**H1 (the play() hammering) — CONFIRMED. NOT H2/H3/H4.**

On WebKit/Safari the cover `<video>` was driven by a MANUAL `video.play()` retry loop
(`driveMutedAutoplay`, R6) whose **first attempt fired at `readyState 0`** (before any media).
That gesture-less `play()`-at-`readyState-0` **poisons WebKit's one-time inline-autoplay
eligibility for that specific element**: WebKit rejects it with `NotAllowedError` and then
**permanently denies that element** — every subsequent retry also rejects, the cover stays
`paused` at `currentTime 0`, and Safari paints its native play-button overlay (the bug Seth saw
on PC web).

Forensic confirmation against the LIVE deployed page (`/e/leggothis/vibes-and-stuff`, headless
WebKit, Playwright):

- The component's own cover element: `paused:true`, `currentTime:0`, `readyState:4`, **56/56
  `play()` calls REJECTED with `NotAllowedError`** (all `muted===true`, properly sized 1200×514,
  `visibility:visible`, `pointer-events:auto`, opacity 1 — so **H3 ancestor-CSS / zero-size is
  ruled out**: the element is fully painting yet denied).
- On the SAME page, a fresh bare `<video autoplay muted playsinline src>` that **never calls
  `play()`** autoplays (`paused:false`). The ONLY behavioral difference is the manual `play()`
  hammer + `load()` — i.e. the hammer is the poison.

**Why R5/R6 shipped non-fixes (the bed lesson):** the live `NotAllowedError` denial is a property
of the FULL live page context (heavy Expo app + hydration + WebKit's per-page autoplay budget).
An isolated/minimal bed CANNOT reproduce it — headless WebKit on a clean page *grants* even a
`readyState-0` `play()`. I verified this directly: my real-component bed (genuine
ParallaxCoverShell→EventCoverMedia→EventCoverWebVideo, react-native-web, real Cloudinary src,
even with network throttling to force `readyState 0` at first `play()`) always *plays* — it
**cannot** reproduce `paused:true`. So the only valid reproduce-then-prove context is the live
denying page itself.

---

## 2. The fix

Make `EventCoverWebVideo` (web branch of `packages/event-rendering/EventCoverMedia.tsx`) behave
EXACTLY like the proven-working bare element:

1. **Drive the muted ambient autoplay via the native `autoPlay` + `muted` + `playsinline`
   ATTRIBUTES only** (the muted/playsinline attributes were already pinned at mount by the R5
   `attachVideo` ref callback; `autoPlay: shouldPlay` was already on the element). No manual
   kickoff.
2. **Removed the R6 `driveMutedAutoplay` play()-hammer driver entirely** — deleted the module
   (`coverWebVideoAutoplay.ts`), its unit test, the `index.ts` exports, and the import. It was the
   bug, not the fix.
3. **No `play()` while hard-muted, and NEVER at `readyState 0`.** The muted branch now registers a
   single GUARDED recovery on `canplaythrough` that attempts `play()` ONCE, only when
   `readyState >= 3` AND still `paused`, and stops once playing. `onCanPlay` is likewise guarded
   by `readyState >= 3 && paused`. (Past the eligibility window + truly ready ⇒ can't poison.)
4. **R5 contracts preserved:** `effectiveMuted`/`hasUnmutedRef` hard-mute gate, `attachVideo`
   mount attribute pin, `muted: effectiveMuted`, `onCanPlay` re-asserts `effectiveMuted`,
   `controls:false`, `loop`, `playsInline`, mute-state-follows-prop. The unmuted (post user-gesture)
   branch keeps its single `play()` (a gesture is present, so it's permitted).

### Changed files
- `packages/event-rendering/EventCoverMedia.tsx` — web branch effect + `onCanPlay` rewrite; import removed.
- `packages/event-rendering/index.ts` — removed the `driveMutedAutoplay`/`COVER_AUTOPLAY_READY_EVENTS`/types exports.
- `packages/event-rendering/coverWebVideoAutoplay.ts` — **DELETED** (the R6 hammer driver).
- `packages/event-rendering/__tests__/coverWebVideoAutoplay.orch1167r6.test.ts` — **DELETED** (validated only the removed buggy mechanism).
- `packages/offering-rendering/__tests__/orch_1167_r7_webkit_cover_no_play_hammer.test.ts` — **NEW** regression (fails-on-revert proven).

`EventCoverNativeVideo` (expo-video native path) is UNTOUCHED. The brand-page multi-card lazy-mount
(`useInViewport` / ORCH-0964) is UNTOUCHED (no eager-mount change; the fix is purely in how the web
`<video>` reaches play, not when it mounts).

---

## 3. REPRODUCE-then-PROVE evidence (REAL component, headless WebKit)

**Method:** load the LIVE deployed page (running the R6 component) → confirm the real component
element is DENIED (REPRODUCE). Then `addScriptTag` an esbuild bundle of the REAL R7-fixed
`EventCoverMedia` (genuine code, react-native-web) and MOUNT it into that same denying live page's
DOM → confirm it autoplays (PROVE). Same exact Cloudinary `.mp4` src throughout.

```
REPRODUCE [live R6 component]:
  { componentPaused: true, componentRejected: 56, componentPlayCalls: 56,
    src: ".../737d168a-...-829aa816bcd1.mp4" }

PROVE [REAL R7 EventCoverMedia mounted on the SAME denying live page]:
  { mounted: true, r7Paused: false, r7Ct: 5.73, r7Rs: 4,
    r7PlayCalls: 0, r7PlayCallsAtRs0: 0, r7Rejected: 0,
    r7HasMutedAttr: true, r7HasAutoplayAttr: true, r7Controls: false }

VERDICT:
  (before) bug REPRODUCED on real live component: true
  (after)  REAL R7 component autoplays on same page: true  [paused=false, ct=5.73, play()calls=0, atRs0=0]
```

- **Before:** real R6 component → `paused:true`, 56/56 `play()` rejected (`NotAllowedError`).
- **After:** real R7 component on the *same page that denies the R6 element* → `paused:false`,
  `currentTime` advancing (5.73s), `readyState:4`, **0 `play()` calls** (autoplay attribute drove
  it), `controls:false` (no native play button), muted + autoplay attributes present.

### Cross-engine / non-regression (real R7 component bed)
- **Chromium:** `paused:false, ct:5.88, controls:false` → PLAYS.
- **WebKit (local real-component bed):** `paused:false, ct:5.81, controls:false`, **0 manual
  `play()` calls** → PLAYS via the autoplay attribute.
- **Mute/Unmute toggle (WebKit):** clicking "Turn on cover sound" → `muted:false`, video keeps
  playing (`paused:false`, ct advancing), `controls:false` → no regression.
- **Image + GIF covers (WebKit):** render as `<img>` (no `<video>`) → no regression.
- **Native (expo-video) path:** unchanged code.

Playwright bed + all harness scripts: `/tmp/orch-1167-pw/` (`r7_real_component_proof.js`,
`r7_proof.js`, `live_wrapper.js`, `chromium_check.js`, `mute_toggle_check.js`, `img_check.js`,
`bed/` esbuild real-component bundle).

---

## 4. Gates / tests

- **5 ORCH-1167 strict-grep gates:** ALL PASS (allin-price-in-ticket-box, canonical-9-section-order,
  city-level-map-no-exact-pin-when-hidden, one-read-rpc, shell-agnostic-body).
- **Jest:** ORCH-1167 R4 + R5 + R7 suites → **18/18 pass**. Full
  `packages/(event-rendering|offering-rendering)` jest → **42/42 tests pass** (the 13 "failed
  suites" are pre-existing **Deno** test files ts-jest can't load — they run under Deno in CI, not
  jest; unrelated to this change).
- **Typecheck:** `npx tsc --noEmit` in mingla-business → **461 errors with the fix == 461 on
  baseline** (stash-compared). **Zero new type errors.** All are pre-existing config/module-
  resolution artifacts (packages pulled into business tsc without their own node_modules;
  `@testing-library/react-native` missing; checkout/marketing files).
- **Fails-on-revert:** reintroducing `driveMutedAutoplay(video)` in the muted branch makes the R7
  regression test FAIL ("the R6 driveMutedAutoplay play()-hammer driver is REMOVED" ✕); restored →
  pass. Proven.

---

## 5. Blockers / notes

- **None blocking.** The fix is proven on the real component on the real denying context.
- **Reusable lesson (why R5/R6 failed):** the live `NotAllowedError` autoplay denial is a
  whole-page WebKit eligibility-budget effect that **no isolated bed reproduces** — headless WebKit
  on a clean page grants what it denies on the heavy live app. Any future cover-autoplay change MUST
  be reproduced/proven against the LIVE denying page (mount the candidate element/component INTO it),
  not an isolated harness.
- This is a buyer-web fix; per the deploy rules it ships from MERGED main (buyer-web can't be OTA'd).
  Business/consumer native are unaffected (native path unchanged). Closing/deploy is the
  orchestrator's call, not this implementor's.
