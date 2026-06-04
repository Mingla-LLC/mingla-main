# QA — ORCH-1069 [Place/venue video covers render on the consumer deck card + gallery]

**Skill:** `mingla-tester` (TEST mode, CODE-LEVEL + regression — scoped by dispatch).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1069-[venue-video-cover-on-deck]/` on branch `ORCH-1069-venue-video-cover-on-deck`.
**HEAD under test:** `0673783bb` (implement commit).
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1069_VENUE_VIDEO_COVER_ON_DECK.md`.
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1069_VENUE_VIDEO_COVER_ON_DECK.md`.
**Comms ledger:** read on entry; no BLOCK targeting this skill or ORCH-1069. Relevant context: COMMS-0007 (RESOLVED — `EventCoverMedia`/`EventCover` live in `@mingla/event-rendering`; `expo-video` in app-mobile) is the foundation this ORCH builds on. No new cross-ORCH discovery to write.

---

## Verdict: CONDITIONAL PASS

- **P0:** 0 | **P1:** 0 | **P2:** 0 | **P3:** 1 | **P4:** 2
- **Why CONDITIONAL (not full PASS):** This is a video/runtime UI change, which the tester gate normally requires `proven`-level live-fire sim evidence to clear. The dispatch EXPLICITLY scopes this verification to CODE-LEVEL + regression and assigns live iOS-sim/Android-emu acceptance (SC-ACCEPT-iOS/Android) to the orchestrator post-merge/OTA — "NOT yours." That is an operator-directed deferral of the sim leg. Every code-level + regression clause in scope is PASS with captured evidence. The verdict is CONDITIONAL solely on the operator-owned live-fire leg; no defect drives it.
- **No open P0/P1.** No FAIL findings.

---

## Sim evidence

- **iOS / Android live-fire:** DEFERRED to orchestrator by explicit dispatch directive ("the live iOS-sim acceptance is the orchestrator's job post-merge/OTA — NOT yours"). Not attempted in this scope. This is the only reason the verdict is CONDITIONAL rather than PASS. Operator must run SC-ACCEPT-iOS + SC-ACCEPT-Android on Lantern & Vine before/at OTA ship.
- **Code-level + regression:** fully exercised below (Deno tests, tsc, fails-on-revert, source-contract reads).

## Regression tests

- **Implementor (happy-path):** `app-mobile/src/utils/__tests__/videoUrl.test.ts` — `deno test --allow-read` → `ok | 6 passed | 0 failed` (re-run by tester, captured). In `git diff origin/main...HEAD --name-only`. Fails-on-revert: drifting `VIDEO_EXT` → T-07c FAILS (`5 passed | 1 failed`), restored → 6 pass. Confirmed.
- **Tester (adversarial):** `app-mobile/src/utils/__tests__/videoUrl.adversarial.test.ts` — `ok | 3 passed | 0 failed`. Attacks a DIFFERENT angle than the implementor (see below). Fails-on-revert: reverting `firstVideoUrl` to first-element-only logic → ADV-A1 + ADV-A2 FAIL (`1 passed | 2 failed`), restored → 3 pass. Confirmed. Committed alongside this report on the ORCH branch.
- Combined sweep: `9 passed | 0 failed`.

---

## App-only / OTA confirmation (VERIFY-1) — PASS

```
$ git diff --name-only origin/main...HEAD -- supabase/
(empty)
```
Zero `supabase/` diff. Full changed-file set: `app-mobile/src/utils/videoUrl.ts`, `app-mobile/src/utils/__tests__/videoUrl.test.ts`, `app-mobile/src/components/SwipeableCards.tsx`, `app-mobile/src/components/expandedCard/ImageGallery.tsx`, `app-mobile/deno.lock` (benign std@0.224.0 cache), plus the two artifact docs + WORLD_MAP. `expo-video` already in the binary (COMMS-0007) → no native rebuild. **OTA-able via `eas update`, no backend deploy.** Confirmed.

---

## Contract table (file:line)

| # | Contract | Evidence (file:line) | Result |
|---|----------|----------------------|--------|
| VERIFY-1 | Zero supabase diff (OTA-able) | `git diff --name-only origin/main...HEAD -- supabase/` empty | PASS |
| VERIFY-2 | App `isVideoUrl` regex pair === edge fn exactly | helper `videoUrl.ts:20,25` = `/\.(mp4|mov|webm|m4v)(\?|$)/i` + `/\/video\/upload\//`; edge `discover-cards/index.ts:708-709` identical | PASS |
| VERIFY-2 | Lantern video URL (`/video/upload/…mp4`) detected; `.jpg` not | `videoUrl.test.ts` T-07a/b green; adversarial A1 (`/video/upload/` no-ext) green | PASS |
| VERIFY-2 | `firstVideoUrl` returns first video in `images` or null | `videoUrl.ts:29-34` (`.find(isVideoUrl) ?? null`); SC-1/SC-3 tests green | PASS |
| VERIFY-3 | `.mp4` card → `EventCoverMedia` mediaType="video", poster=`image`, muted, loop, `pointerEvents="none"` | `SwipeableCards.tsx:277-298` (poster `CardHeroImage` behind + video layer in `pointerEvents="none"` View) | PASS |
| VERIFY-3 | Still-only card → `CardHeroImage` UNCHANGED (no regression) | `SwipeableCards.tsx:272-275` returns bare `<CardHeroImage uri={image} style={style}/>`; old sites `2558/2706` passed `uri={...image} style={styles.cardImage}`; new sites pass `style={styles.cardImage}` → byte-identical still path | PASS |
| VERIFY-4 | Only top card plays — `isTopCard` gates BOTH `autoplay` + `playbackActive` | `SwipeableCards.tsx:289-290` (`autoplay={isTopCard}`, `playbackActive={isTopCard}`); behind site `2645` `isTopCard={false}`, top site `2802` `isTopCard={true}` | PASS |
| VERIFY-4 | Behind card mounts paused; deeper cards mount no player; no video prefetch | Only `currentRec`+`nextCard` heroes render (swipe stack); `EventCoverMedia.tsx:143` `shouldPlay = autoplay && playbackActive` → behind=false→paused (`:276/:293` `player.pause()`); prefetch path untouched (still `image` only) | PASS |
| VERIFY-5 | Gallery `.mp4` → video player w/ unmute control; images stay `<Image>`; swiping away pauses | `ImageGallery.tsx:116-143` branch on `isVideoUrl`; video → `EventCoverMedia` + `showAudioControl` + `audioControlPosition="bottomRight"`; image → `<Image>`; `autoplay/playbackActive={index === currentIndex}` | PASS |
| VERIFY-6 | Deno tests green + fails-on-revert + tsc clean (3 prod files) | tests 9/9; FoR drift → fail/restore; `tsc --noEmit` no errors on the 3 prod files | PASS |
| — | `EventCoverMedia` props exist with claimed semantics | `EventCoverMedia.tsx:27-53` (`mediaType`, `autoplay`, `playbackActive`, `videoContentFit`, `showAudioControl`, `audioControlPosition`); `:143` composite gate; `:287-293` AppState pause/resume | PASS |
| — | Overlays/gradient/badges z-order preserved | `SwipeableCards.tsx:2649-2655 / 2806-2812` `LinearGradient` + overlays remain siblings AFTER the hero, unchanged | PASS |

---

## Captured runs

```
# Implementor happy-path
$ deno test --allow-read src/utils/__tests__/videoUrl.test.ts
ok | 6 passed | 0 failed (25ms)

# Fails-on-revert (drift VIDEO_EXT to mp4-only) → T-07c catches it
FAILED | 5 passed | 1 failed   (restored → 6 passed)

# Tester adversarial
$ deno test --allow-read src/utils/__tests__/videoUrl.adversarial.test.ts
ok | 3 passed | 0 failed (2ms)

# Adversarial fails-on-revert (firstVideoUrl → first-element-only)
FAILED | 1 passed | 2 failed   (ADV-A1 + ADV-A2 fail; restored → 3 passed)

# Combined
$ deno test --allow-read src/utils/__tests__/videoUrl.test.ts src/utils/__tests__/videoUrl.adversarial.test.ts
ok | 9 passed | 0 failed (31ms)

# tsc
$ npx tsc --noEmit | grep -E "videoUrl.ts|SwipeableCards.tsx|ImageGallery.tsx" | grep -v test
(no output — zero errors in the 3 production files)
```

---

## Tester adversarial test — path, angle, result, fails-on-revert

- **Path:** `app-mobile/src/utils/__tests__/videoUrl.adversarial.test.ts` (3 tests, all green).
- **Different angle vs implementor:** the implementor's happy-path test covered clean detection, video-first/mixed `firstVideoUrl`, and the `isTopCard`-collapsed perf mapping. My test attacks:
  - **ADV-A1 — buried video:** the cover `.mp4` is NOT first; it sits at index 4 among many stills (and a `/video/upload/` no-extension url, and a query-string `.mp4`). Proves `firstVideoUrl` scans the WHOLE ordered list (the real deck/gallery requirement) — not just `images[0]`. Also asserts first-of-multiple-videos wins (deterministic cover).
  - **ADV-A2 — malformed/heterogeneous array:** `[null, 123, {…}, "", still, video]` typed-cast to `string[]` (discover-cards builds `images` from untyped `stored_photo_urls` JSON, so junk can reach the deck at runtime). Proves `firstVideoUrl` + `isVideoUrl` skip the junk and return the video WITHOUT crashing; junk-only → `null` → still-hero fallback.
  - **ADV-A3 — full perf-gate truth table:** asserts the TRUE composite `shouldPlay = autoplay && playbackActive` (the value `EventCoverMedia.tsx:143/225` actually computes), including the half-gated `(true,false)`/`(false,true)` states the implementor never tested — guards against a future regression that pins `autoplay=true` and only toggles `playbackActive`.
- **Result:** `3 passed | 0 failed`.
- **Fails-on-revert:** reverting `firstVideoUrl` to first-element-only (`isVideoUrl(images[0]) ? images[0] : null`) makes **ADV-A1 + ADV-A2 FAIL** (`1 passed | 2 failed`); restored to canonical `.find(isVideoUrl) ?? null` → `3 passed`. Captured above.

---

## Perf-guard confirmation (the critical one) — HOLDS

`I-1069-ONE-PLAYING-DECK-VIDEO` holds at THREE independent levels:
1. **Structural:** the swipe stack only ever mounts `currentRec` (top) + `nextCard` (behind) heroes. Cards at depth ≥2 are never rendered → cannot mount a player. (`SwipeableCards.tsx` render sites `2641` + `2798` are the only `CardHero` mounts.)
2. **Prop gate:** `CardHero` feeds `autoplay={isTopCard}` AND `playbackActive={isTopCard}` (`:289-290`); behind site passes `isTopCard={false}`, top site `isTopCard={true}`.
3. **Native enforcement:** `EventCoverMedia.tsx:143` `shouldPlay = autoplay && playbackActive`; when false, `:276` / `:293` call `player.pause()`. AppState handler (`:287-293`) pauses on background, resumes only when `shouldPlay`. So the behind card mounts paused on its poster, and at most ONE deck video plays.
4. **No video prefetch:** the prefetch path warms `image` (still poster) only — unchanged; video streams on mount of the visible card.

Strictly lighter than the already-shipped event/trip grid (`BusinessEventCard`), which mounts many `EventCoverMedia` covers simultaneously.

## Still-venue no-regression confirmation — HOLDS

For any card with no `.mp4` in `images`, `CardHero` (`:272-275`) returns exactly `<CardHeroImage uri={image} style={style} />` with `style=styles.cardImage` — byte-identical to the pre-ORCH-1069 sites (`origin/main` `2558`/`2706`: `<CardHeroImage uri={...image} style={styles.cardImage} />`). Every still / event / TM / curated card is unaffected. Gallery: non-video entries route to the unchanged `<Image source resizeMode="cover">` (`ImageGallery.tsx:138-142`). SC-3/SC-6 satisfied.

---

## Severity-ranked defects

- **P0 / P1:** None.
- **P2:** None.
- **P3-1 (minor, non-blocking):** The T-07c machine-parity test extracts the FIRST `const VIDEO_EXT = …` literal it finds in `videoUrl.ts` via regex. Because the file's HEADER COMMENT also contains the literal `const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(\?|$)/i;` (documentation), a drift confined to the comment (not the code) would still trip the test, and conversely the test asserts the comment's copy rather than the executable `:20` regex. In practice this is harmless (both copies must agree, and any real code drift also fails the behavioral T-07a tests), but the parity assertion targets the comment line, not line 20's executable regex. Suggest the test match the LAST occurrence or strip the comment block before extraction. Not a ship blocker.
- **P4-1 (praise):** Clean perf-guard design — `isTopCard` threaded to BOTH playback inputs, native `shouldPlay` AND-gate, structural 2-card mount, and no video prefetch all reinforce the one-playing-video invariant. Defense in depth.
- **P4-2 (praise):** The still-only path returns the EXACT original `CardHeroImage` call, making the no-regression guarantee trivially auditable (byte-identical to `origin/main`). Deviation D-1 (no reciprocal edge comment, to honor zero-supabase-diff) is correctly resolved by the stronger machine-parity test instead of a static comment.

---

## Constitution check (relevant rules)

| Rule | Result | Evidence |
|------|--------|----------|
| #1 No dead taps | PASS | `pointerEvents="none"` wrapper (`:282`) keeps card swipeable/tappable over the native VideoView (META-ORCH-0991 Bug 3a). |
| #9 No fabricated data | PASS | Missing/malformed video → still poster / `CARD_FALLBACK_IMAGE` / hue band — never a fake. ADV-A2 proves no-crash fallback. |
| #2 One owner per truth | PASS | `videoUrl.ts` is the single app-side detection owner; both surfaces import it. |

Other constitution rules N/A (no DB/auth/state/currency/datetime change).

---

## Completion-condition status (per skill gate)

1. Independent + regression tests green — captured (9/9). PASS.
2. `tsc --noEmit` clean on the 3 prod files — captured. PASS. (Lint: the `@mingla/event-rendering` `import/no-unresolved` is the pre-existing repo-wide eslint-resolver false positive also on shipped `BusinessEventCard.tsx` — not introduced here.)
3. Both regression tests ship in the closing diff; adversarial attacks a different angle; implementor fails-on-revert at a cited commit. PASS.
4. UI/runtime live-fire (iOS+Android) — **DEFERRED to orchestrator by explicit operator dispatch.** This is the single clause not met in this scope, and it is met by design (operator owns it post-merge/OTA). It is the basis for CONDITIONAL.
5. Zero open P0 / P1 — PASS.

**Outcome:** CONDITIONAL PASS — code-level + regression fully PASS; live-fire is the operator/orchestrator's explicitly-assigned next step (SC-ACCEPT-iOS/Android on Lantern & Vine) before OTA ship.

## Discoveries for orchestrator

- Sim leg (SC-ACCEPT-iOS + SC-ACCEPT-Android) is the remaining gate — run on Lantern & Vine: top deck card plays the `.mp4` (muted/loop, still poster, smooth, no band-flash), card swipes/taps normally, expanded gallery plays the video page with unmute control + pauses on page-away, and a still-only venue is visually unchanged.
- P3-1 (T-07c targets the comment-copy of the regex) is a cheap follow-up nicety, not a blocker.
