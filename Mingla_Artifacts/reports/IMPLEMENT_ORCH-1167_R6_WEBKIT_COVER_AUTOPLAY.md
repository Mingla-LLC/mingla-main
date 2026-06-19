# IMPLEMENT — ORCH-1167 R6 [WebKit/Safari cover-video autoplay]

**Skill:** mingla-implementor
**Date:** 2026-06-19
**Branch:** `ORCH-1167-r6-webkit-cover-autoplay` (off origin/main incl. ORCH-1167 R1–R5)
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1167-[event-page-canonical]/`
**Scope:** UI-only, web-specific, WebKit/Safari. Standard-event public cover video. No schema/RPC/migration/package-config.

---

## 1. Summary (plain English)

On Safari / iPhone web, the standard-event public page showed a native PLAY BUTTON on a
frozen cover video instead of autoplaying it (the button Seth sees on PC web). The R5 fix
made Chrome autoplay muted, but Safari/WebKit still refused: it fully LOADS the muted video
yet its FIRST `play()` call is rejected, and the old code swallowed that rejection with no
retry, so the video stayed paused forever and Safari painted its native play button.

The fix makes the muted autoplay RESILIENT on WebKit: it keeps re-attempting `play()`
(re-pinning the video muted before each attempt so it stays autoplay-eligible) across the
late readiness events Safari fires AND a sustained, bounded backoff, until the video
actually starts. Proven on the real WebKit engine via Playwright: the cover now plays
(`paused:false`, `currentTime` advancing). Chromium, the R5 muted-first behavior, the
Mute/Unmute toggle, loop, reduce-motion freeze, and native (expo-video) are all untouched.

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence (commit hash at handoff) |
|----|-----------|--------|-----------|
| SC-1 | WebKit muted inline cover autoplay STARTS (no native play button) | ✓ PASS | Playwright webkit: fix AFTER `paused:false, currentTime:3.99`; broken AFTER `paused:true, currentTime:0` (reproduces bug). §9 |
| SC-2 | Bounded retry — no infinite loop / no leak; cleans up on unmount + unmute | ✓ PASS | Unit test "is bounded…" + "stops retrying once playing and cleans up all listeners (no leak)". §6 |
| SC-3 | Every retry re-pins `muted=true` (stays autoplay-eligible) | ✓ PASS | Unit test "re-pins muted=true before every play() attempt". §6 |
| SC-4 | `controls:false` preserved | ✓ PASS | Harness state shows `controls:false` on both modes. §9 |
| SC-5 | Chromium path / R5 muted-first / Mute toggle / loop / reduce-motion / native unchanged | ✓ PASS | Full ORCH-1167 jest suite 53/53; only the web `effectiveMuted===true` branch changed. §6, §7 |
| SC-6 | All 5 ORCH-1167 strict-grep gates pass | ✓ PASS | §6 — all 5 PASS. |

## 3. Files changed

| File | Δ | What |
|------|---|------|
| `packages/event-rendering/coverWebVideoAutoplay.ts` | **NEW** (+177) | Pure, host-agnostic `driveMutedAutoplay(video, opts)` — the WebKit-robust retry driver (injectable schedulers → unit-testable). |
| `packages/event-rendering/EventCoverMedia.tsx` | +32 / −3 | Web video effect now calls `driveMutedAutoplay` while hard-muted; unmuted path keeps the single R5 play(); import added. |
| `packages/event-rendering/index.ts` | +11 | Export `driveMutedAutoplay` + types + `COVER_AUTOPLAY_READY_EVENTS`. |
| `packages/event-rendering/__tests__/coverWebVideoAutoplay.orch1167r6.test.ts` | **NEW** (+~210) | 5-assertion happy-path regression (fails-on-revert proven). |

## 4. Data-model changes applied

None. UI-only.

## 5. Edge functions touched

None.

## 6. Regression tests added

**Path:** `packages/event-rendering/__tests__/coverWebVideoAutoplay.orch1167r6.test.ts` (5 tests).

```
PASS ../packages/event-rendering/__tests__/coverWebVideoAutoplay.orch1167r6.test.ts
  ✓ retries until the element actually starts (WebKit late-eligibility)
  ✓ re-pins muted=true before every play() attempt (autoplay eligibility)
  ✓ calls load() once before the first attempt to nudge WebKit eligibility
  ✓ stops retrying once playing and cleans up all listeners (no leak)
  ✓ is bounded — a permanently-ineligible element stops after maxAttempts
Tests: 5 passed, 5 total
```
Run: `cd mingla-business && npx jest --roots=../packages --testPathPattern="coverWebVideoAutoplay.orch1167r6" --runInBand`.

**fails-on-revert verified at HEAD of `ORCH-1167-r6-webkit-cover-autoplay`** (TRUE LINE
DELETION, not comment-out): replaced the retry machinery in
`driveMutedAutoplay` (the `scheduleRetry`/`attemptPlay` chain + readiness-event listeners +
rAF re-attempt) with the R5 single swallowed `video.play()` attempt → **3 of 5 tests FAIL**
(the WebKit-late-eligibility, no-leak, and bounded tests; expected `paused:false`, got
`paused:true`). Restored the fix → **5/5 PASS** again.

**Full ORCH-1167 jest suite:** `npx jest --roots=../packages --roots=. --testPathPattern="orch_?1167" --runInBand`
→ **7 suites, 53 tests, all PASS** (R5 was 48; +5 mine). R1–R5 contracts intact.

**5 ORCH-1167 strict-grep gates — ALL PASS:**
`orch-1167-allin-price-in-ticket-box` · `orch-1167-canonical-9-section-order` ·
`orch-1167-city-level-map-no-exact-pin-when-hidden` · `orch-1167-one-read-rpc` ·
`orch-1167-shell-agnostic-body`.

**Typecheck:** `mingla-business npx tsc --noEmit` — `coverWebVideoAutoplay.ts` has **0 errors**;
`EventCoverMedia.tsx` error count is the pre-existing "Cannot find module 'react'" cascade
(29, identical to the R5 baseline; all are downstream implicit-any of the unresolved `react`
type, present on clean HEAD at the same locations, only line-shifted). **My change introduces
ZERO new typecheck errors.** (The package isn't independently typecheckable in this worktree's
resolution setup — same constraint R4/R5 worked under.)

## 7. Old → New receipts

### `packages/event-rendering/coverWebVideoAutoplay.ts` (NEW)
**Before:** did not exist.
**Now:** exports `driveMutedAutoplay(video, opts)` — drives WebKit-robust muted inline
autoplay. On each rejected `play()` it re-pins `muted=true` and re-attempts, both on the late
readiness events WebKit fires (`loadedmetadata`/`loadeddata`/`canplay`/`canplaythrough`) AND a
sustained bounded backoff (default 50 attempts × 150ms ≈ 7.5s budget — sized to outlast
WebKit's eligibility latency), stopping the instant `video.paused` flips false. Calls
`video.load()` once first to nudge WebKit re-evaluation. Returns a cleanup that tears down all
listeners + pending timers/rAF. Schedulers are injectable → unit-testable under node.
**Why:** SC-1/2/3 — the retry-until-playing fix, extracted pure so it's testable + reusable.

### `packages/event-rendering/EventCoverMedia.tsx`
**Before (`EventCoverWebVideo` autoplay effect):** when `shouldPlay`, a single
`void video.play().catch(() => undefined)` — one attempt, rejection swallowed, no retry. On
WebKit that first attempt rejects (NotAllowedError) → the cover stays paused forever and
Safari paints its native play button.
**Now:** when `shouldPlay`: if `effectiveMuted` (the initial ambient autoplay, and every state
until the user takes over with a real unmute gesture) → `return driveMutedAutoplay(video)` (the
WebKit-robust retry, with the effect's cleanup wiring it to unmount / shouldPlay-flip / unmute,
because `effectiveMuted` is already in the deps). If NOT `effectiveMuted` (user unmuted, a
gesture the browser honors) → the original single `video.play()` (no hard-muted loop). The
non-play branch (`video.pause()`), the `attachVideo` sync mute-attribute pin, `onCanPlay`,
`onEnded` loop, `controls:false`, and the aspect-ratio reporting are all unchanged.
**Why:** SC-1/SC-5 — fix WebKit autoplay without touching the Chromium-proven R5 behavior or
the toggle.

### `packages/event-rendering/index.ts`
**Before:** no export for the autoplay driver.
**Now:** exports `driveMutedAutoplay`, `COVER_AUTOPLAY_READY_EVENTS`, and the two option/video
types. **Why:** package API surface + test import.

## 8. Cross-surface impact table

| Surface | Affected? | Detail |
|---------|-----------|--------|
| Buyer/anonymous Web | **YES** | The cover video now autoplays muted on Safari/WebKit (incl. iPhone web) — the native play button is gone. Parity AUTOMATIC (shared `@mingla/event-rendering`). |
| Business Web preview (adjacent) | **YES** | Same shared web `<video>` renderer; same fix. AUTOMATIC. |
| Consumer iOS | No | Native path = `EventCoverNativeVideo` (expo-video), untouched; only the `Platform.OS === "web"` branch changed. |
| Consumer Android | No | Same — native path untouched. |
| Business iOS | No | Native path untouched. |
| Business Android | No | Native path untouched. |
| Admin Web (adjacent) | No | Does not render the event cover media. |

Parity is automatic (single shared package); no manual mirror.

## 9. WebKit (Safari engine) Playwright proof — BEFORE / AFTER

Standalone HTML harness (`/tmp/orch1167r6_webkit/harness.html`) mounting a muted inline
`<video>` driven by the EXACT shipped retry logic (same `driveMutedAutoplay`, same
defaults 50×150ms), pointed at a public muted mp4
(`https://res.cloudinary.com/demo/video/upload/dog.mp4`), loaded over http in Playwright
**webkit** (`webkit-2311`, Playwright 1.60.0), state asserted after 4s. Two modes: `broken`
= R5 single swallowed attempt; `fix` = R6 retry. Stable across repeated runs:

```
=== ORCH-1167-R6 WebKit (Safari engine) cover autoplay proof ===
Engine: WebKit | src: https://res.cloudinary.com/demo/video/upload/dog.mp4

MODE=broken (R5 single swallowed attempt — the bug):
  BEFORE: {"paused":true,"muted":true,"currentTime":0,"readyState":4,"controls":false,"hasMutedAttr":true,"autoplay":true}
  AFTER : {"paused":true,"muted":true,"currentTime":0,"readyState":4,"controls":false,"hasMutedAttr":true,"autoplay":true}

MODE=fix (ORCH-1167-R6 driveMutedAutoplay retry-until-playing):
  BEFORE: {"paused":true,"muted":true,"currentTime":0,"readyState":4,"controls":false,"hasMutedAttr":true,"autoplay":true}
  AFTER : {"paused":false,"muted":true,"currentTime":3.99,"readyState":4,"controls":false,"hasMutedAttr":true,"autoplay":true}

ASSERT fix AFTER paused===false : PASS
ASSERT broken AFTER paused===true (reproduces bug) : PASS
```

The `broken` AFTER state is byte-for-byte the orchestrator's live observation
(`paused:true, currentTime:0, muted:true, readyState:4, controls:false, hasMutedAttr:true,
autoplay:true`) → the harness faithfully reproduces the real bug. The `fix` flips it to
`paused:false` with `currentTime` advancing → autoplay lands on WebKit. A `play()`-call
trace (separate diag run) showed the WebKit sequence: **REJECTED (NotAllowedError) →
REJECTED (NotAllowedError) → RESOLVED** — i.e. the first attempts reject exactly as
observed, and the retry lands the play.

## 10. Known issues / deferred

- **Critical robustness finding (fixed mid-implementation):** the first cut used a 12-attempt
  × 120ms (~1.5s) burst. Playwright WebKit proved that burst GAVE UP BEFORE WebKit granted
  eligibility (the cover stayed paused at `currentTime:0` through 7.75s). Raised to 50×150ms
  (~7.5s bounded budget); now lands reliably. This is exactly the failure the dispatch warned
  against — caught because the proof was run on the real WebKit engine, not assumed.
- No `[TRANSITIONAL]` code. The retry is bounded and self-cleaning.
- The Playwright harness used a public Cloudinary muted mp4 as a faithful stand-in for the
  self-hosted cover (the live `/e/leggothis/vibes-and-stuff` cover requires no auth but the
  harness is intentionally asset-independent for reproducibility). The bug repro matches the
  live observation byte-for-byte, so the engine behavior is the same.

## 11. Operator action required (for the orchestrator/operator)

- **No migration, no edge-fn deploy.** UI-only.
- **Buyer-web ships from MERGED main (cannot be OTA'd).** On merge: ensure the merge commit
  carries `[deploy]` and watch the Vercel `[deploy]`-gate cancel trap (a non-`[deploy]` commit
  landing after yours cancels the web build → push an empty `[deploy]` commit). After deploy,
  open `https://business.usemingla.com/e/leggothis/vibes-and-stuff` in **Safari** (Mac or
  iPhone) and confirm the cover autoplays with NO play button.
- Route to REVIEW, then tester dispatch (the tester should re-run the WebKit Playwright proof
  against the LIVE deployed page post-merge to confirm the runtime, since this harness proves
  the LOGIC on the engine but not the deployed bundle).

## 12. Discoveries for Orchestrator

- **Headless WebKit autoplay is policy-stricter than Chromium AND rejects the first muted
  attempts even at readyState 4** — any future cover/video autoplay work must be proven on the
  WebKit engine, not Chromium, or it will pass CI/local and still ship broken on Safari. This
  R6 retry-driver is now the reusable WebKit-robust primitive (`driveMutedAutoplay`, exported
  from `@mingla/event-rendering`) — future video covers should use it, not re-fork a single
  `play().catch()`.
- **COMMS-0040 (WARN, RSVP public-page standardization):** read and factored. It governs the
  RSVP page body files (`RsvpPublicBody.tsx` etc.); this change touches only
  `EventCoverMedia.tsx` (standard-event cover, shared package) — NOT in its file list — so no
  coordination conflict. No ledger edit needed (WARN, not acted-on).
```
fails-on-revert verified at: HEAD of ORCH-1167-r6-webkit-cover-autoplay (post-commit)
```
