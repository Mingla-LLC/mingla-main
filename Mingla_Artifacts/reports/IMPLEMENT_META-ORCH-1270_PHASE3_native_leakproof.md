# IMPLEMENT — META-ORCH-1270 Phase 3 — Native leak-proofing (provider-agnostic)

Date: 2026-07-03
Author: mingla-implementor
Branch: `META-ORCH-1270-bunny-migration`
Contract: `Mingla_Artifacts/specs/SPEC_META-ORCH-1270_bunny_migration.md` §5 (Phase 3)
Context: `Mingla_Artifacts/reports/META-ORCH-1270_VECTOR_A_DELIVERY_BANDWIDTH.md` (Findings A/B/C)
Status: **implemented + verified** (typecheck delta-clean, unit tests pass, fails-on-revert proven per leak). Full byte-level runtime proof is SIM-BLOCKED → tester.

This phase is provider-AGNOSTIC: it fixes how the native app STREAMS any cover video
(Cloudinary or Bunny). It is the true closer of the bandwidth leak that killed the media
account (ORCH-1209 fixed only web + a play/pause gate that never stopped the native download).

---

## 1. What changed (files)

Modified (3):
- `packages/offering-rendering/EventCoverMedia.tsx` — `EventCoverNativeVideo`: native "preload
  none" source-defer + on-device cache wiring. Web path byte-unchanged.
- `app-mobile/src/components/discover/BusinessEventCard.tsx` — grid cover `autoplay={false}
  playbackActive={false}`.
- `app-mobile/src/components/discover/TripCard.tsx` — grid cover `autoplay={false}
  playbackActive={false}`.

New (4):
- `packages/offering-rendering/coverVideoCache.ts` — pure, import-free cache-source decision
  (`nativeCachedCoverSource` / `webCoverSource` + `CoverVideoSource` type). Unit-testable.
- `packages/offering-rendering/useCachedCoverVideoUri.ts` — WEB/default hook variant (passthrough).
- `packages/offering-rendering/useCachedCoverVideoUri.native.ts` — NATIVE hook variant (cached
  expo-video source). Metro resolves `.native.ts` on iOS/Android, `.ts` on web (same split the
  package already uses for `ThemeEntranceAnimation.web.tsx`).
- `packages/offering-rendering/__tests__/meta_orch_1270_phase3_native_leakproof.test.ts` — the
  regression guard (behavioural + source-structural; fails-on-revert per leak).

Commit: the Phase-3 tip of `META-ORCH-1270-bunny-migration` (this commit; single commit,
message `META-ORCH-1270 Phase 3: native cover-video leak-proofing (provider-agnostic)`).

Untouched (as required): all Phase-1/2 files, provider/server code, backend, the web cover path
(`EventCoverWebVideo`), the three detail screens (they keep autoplay — a detail screen SHOULD
play — and now benefit from the disk cache for free), and every existing test file.

---

## 2. How each of the three Vector-A leaks is now closed (mechanism)

### LEAK A (PRIME) — native `useVideoPlayer(uri)` buffered on creation
Root cause: `useVideoPlayer(uri, …)` sourced the player ON MOUNT, so expo-video opened the HTTP
connection and buffered the mp4 the instant ANY video cover mounted — off-screen, behind a card,
a reduce-motion still, a whole grid — regardless of play state. The ORCH-1209 "gate" only
`pause()`d; pausing never releases the source or cancels the in-flight download.

Fix (`EventCoverNativeVideo`, `EventCoverMedia.tsx`):
- The player is now created with a **NULL source**: `useVideoPlayer(null, (p) => { p.loop; p.muted;
  p.volume; p.staysActiveInBackground=false; p.showNowPlayingNotification=false; })`. No source →
  no HTTP connection → **zero bytes on mount**.
- A `sourcedRef = useRef(false)` latch. The play/pause effect attaches the real source via
  `player.replaceAsync(source)` **only the first time `shouldPlay` (= autoplay && playbackActive)
  is true**, then `play()`. `shouldPlay=false` never attaches the source (only pauses an
  already-sourced player). A new `uri` re-arms the latch.
- The poster `<Image>` (ORCH-1209) still renders behind the (now unsourced) `VideoView`, so a
  paused/grid/off-screen cover shows the still thumbnail with zero video bytes.

### LEAK B (FAN-OUT) — discover grid autoplayed every video at once
Root cause: `BusinessEventCard` / `TripCard` rendered `<EventCoverMedia>` with NO play props;
both default `true`, and the discover grid is a non-windowed `<ScrollView>` (every card mounts),
so N concurrent looping streams — growing with supply. The card header even CLAIMED "autoplay
disabled for the grid"; it never was.

Fix: both cards now pass `autoplay={false} playbackActive={false}` → `shouldPlay=false` →
combined with Leak A's source-defer the player is never sourced → the grid draws the poster still
(Bunny `thumbnail.jpg` / Cloudinary `so_0` .jpg) and fetches **zero video bytes** until a card is
opened. The header contract is finally true.

### LEAK C (COMPOUNDING) — no native cross-mount cache; re-opens re-download
Root cause: per-mount `useVideoPlayer` kept no persistent disk cache, so the immutable/long-
max-age delivery header was ignored — every screen re-open re-downloaded the same clip.

Fix: the native source now carries **expo-video's built-in persistent on-device cache**
(`{ uri, useCaching: true }`). expo-video (`~3.0.16`) keeps a size-capped LRU disk cache (default
1 GB, persistent, LRU-evicted) keyed on the url, so a re-open replays from disk instead of
re-downloading. This is the spec's **preferred** branch (§5.3: "Prefer expo-video source-level
caching if the installed expo-video exposes `useCaching`/cached sources") — it does, so I used it
rather than a hand-rolled `expo-file-system` download. Bonus: it needs **no new dependency**
(expo-file-system was NOT a peer dep of offering-rendering; expo-video already is), avoids the
`.native.ts`/ts-jest expo-file-system resolution hazard flagged in Phase 1, and uses the
platform's battle-tested cache. Web returns the plain uri (browser HTTP cache handles reuse).

Leak-safety of the cache: the cached source is only ever ATTACHED via `replaceAsync` on a
legitimate play (Leak A's source-defer), so the cache only fills on real playback — a
paused/off-screen/grid cover still downloads nothing.

---

## 3. Legitimate autoplay still streams + plays (the non-regression proof)

A cover that SHOULD play (the event/trip/experience detail hero, an active swipe card) passes
`autoplay playbackActive` (both true, unchanged) → `shouldPlay=true` on first render →
`sourcedRef` is false → `player.replaceAsync({ uri, useCaching:true })` attaches the source and
`.then(() => player.play())` starts it (the `readyToPlay` listener is a belt-and-suspenders
resume). So a genuinely-playing cover **fetches (first open) and plays** exactly as before, and
on the second open replays from the expo-video disk cache. This phase stops OFF-SCREEN / paused /
grid streaming ONLY — never legitimate playback. The three detail screens were intentionally NOT
touched (§5.3): they keep autoplay and inherit the disk cache.

Preserved contracts (verified): web imperative `<video preload="none">` autoplay path
(ORCH-1167, byte-unchanged — `EventCoverWebVideo` untouched); ORCH-0992 aspect-ratio reporting
(`sourceLoad`/`videoTrack` listeners intact, fire after `replaceAsync`); reduce-motion freeze;
mute/unmute toggle (initializer + muted effect keep `player.muted`/`volume`); error→fallback;
poster-behind-video (`so_0`/Bunny thumbnail); `useInViewport` web lazy-mount. The existing
ORCH-1209 native structural tests (`const shouldPlay = autoplay && playbackActive`, the
`if (shouldPlay){…player.play()}` / `player.pause()` shape, the poster `<Image source={{uri:
posterUrl}}>` + `<VideoView>`) all remain true and stay green.

---

## 4. Tests + fails-on-revert

New suite `meta_orch_1270_phase3_native_leakproof.test.ts` (8 tests, all pass). Run:
`cd mingla-business && npx jest --roots=../packages/offering-rendering --testPathPattern="meta_orch_1270_phase3_native_leakproof"`.

| Angle | Assertion | Fails-on-revert (proven) |
|---|---|---|
| LEAK C behavioural | `nativeCachedCoverSource(url) === { uri, useCaching:true }` (pure fn, run directly) | set `useCaching:false` → deep-equal FAILS ✓ |
| LEAK C behavioural | `webCoverSource(url) === url` (string passthrough, no native flag); null/empty → null | — |
| LEAK A structural | `EventCoverNativeVideo` uses `useVideoPlayer(null,` and NEVER `useVideoPlayer(uri` | revert to `useVideoPlayer(uri,` → FAILS ✓ |
| LEAK A structural | `source = useCachedCoverVideoUri(uri)` + `sourcedRef = useRef(false)` + `player.replaceAsync(source)`, and `replaceAsync` sits after `if (shouldPlay)` + the once-only latch | — |
| LEAK B structural | `BusinessEventCard` passes `autoplay={false} playbackActive={false}` | remove props → FAILS ✓ |
| LEAK B structural | `TripCard` passes `autoplay={false} playbackActive={false}` | remove props → FAILS ✓ |

Fails-on-revert was demonstrated live: reverting all three fixes at once
(`useVideoPlayer(null→uri)`, drop the BusinessEventCard props, `useCaching:true→false`) turned the
suite red on exactly the three matching assertions (3 failed / 5 passed); restoring → 8/8 green.

Regression safety on existing suites (all still green after my change):
- `orch_1209_no_eager_video_preload.test.ts` — 6/6 pass (web preload=none + poster + native gate).
- `orch_1209_bandwidth_adversarial.test.ts` — 13/13 pass (incl. C1 native `shouldPlay`/play/pause
  structure, which I deliberately preserved).
- `orch-0994-business-event-card-video-cover*.test.tsx` — pass (node, exit 0): the grid tests are
  structural (single EventCoverMedia, no ExpoImage, `videoContentFit="cover"`, hue forwarded);
  adding play props does not violate any of them.
- Existing test files were NOT modified (tests-append-only gate respected). The ORCH-1209
  adversarial test that "proved the wrong property" (only checked `pause()`) is left intact and
  green; the NEW suite adds the missing guard (source is WITHHELD — `useVideoPlayer(null`).

Invariant registered (DRAFT): **`I-MOR-1270-NO-EAGER-NATIVE-STREAM`** — on native,
`EventCoverMedia` does not attach the video source until `autoplay && playbackActive` is first
true; the discover grid passes both false. Guard = the new suite (source-structural `useVideoPlayer(null`
+ replaceAsync-gated + grid poster-only). A CI strict-grep mirroring the ORCH-1209 one could be
added at CLOSE if the orchestrator wants belt-and-suspenders.

---

## 5. Typecheck

Authoritative native check = `cd app-mobile && npx tsc --noEmit`.
- `coverVideoCache.ts` (pure, no react import) → **0 errors** (clean).
- No new type errors on the wiring: zero diagnostics mention `replaceAsync` / `useCaching` /
  `CoverVideoSource` / `source`.
- The remaining diagnostics on `EventCoverMedia.tsx` / the cards are the **pre-existing**
  worktree-layout cascade: this worktree has no hoisted `node_modules` the `packages/offering-
  rendering` files can resolve, so `react` / `react-native` / `expo-*` are "Cannot find module"
  for the whole package (line-1 `import React` fails on pristine HEAD too), which makes every JSX
  binding implicit-any. **Delta vs pristine baseline = ZERO**: I stashed my edits + hid the new
  files, captured the baseline error set (34 lines for EventCoverMedia + cards), restored, and
  re-captured — the two sets are identical error-for-error, only shifted by my added comment lines
  (e.g. the pre-existing TripCard `Icon` TS2322 moved 182→189 = +7 lines). The new hook files add
  only the same "Cannot find module 'react'" class (unavoidable in this worktree; resolves in a
  linked build). This matches the Phase-1 report's note that shared-package module resolution is a
  known, pre-existing ts-jest/tsc limitation in this worktree.

---

## 6. What needs simulator runtime proof (SIM-BLOCKED → tester)

Static + unit verification is complete; byte-level behaviour requires a device (the "merged but
DARK" trap that reopened ORCH-1209 — these are native-only, pure-JS, OTA-deliverable, and MUST
reach devices). Tester, with a Metro proxy / Charles on a physical device:
1. **LEAK A/B**: open Discover with several Bunny/Cloudinary video covers in the grid → assert
   **ZERO `.mp4` GETs** until a card is tapped (only `thumbnail.jpg`/`so_0.jpg` posters load).
2. **Legitimate play**: tap a card / open a detail hero → assert the `.mp4` DOES fetch and the
   cover autoplays muted+looping (non-regression).
3. **LEAK C**: open a detail screen twice → assert the **second** open serves from cache (no
   second full `.mp4` GET). This is the leak's true regression guard.
4. Confirms the fix ships to devices via OTA / next build (repo merge alone does not stop the bleed).

---

## 7. Notes / edge

- Grid poster completeness: the poster still shows for Bunny (`thumbnail.jpg`) and Cloudinary
  (`so_0` .jpg) covers — i.e. every Mingla cover video. A video cover from a host with no derivable
  poster would show the empty (unsourced) `VideoView` in the grid rather than streaming; this is
  the correct leak-safe behaviour and not a real case in prod (all covers are Bunny/Cloudinary).
- The `useCachedCoverVideoUri` hook returns a `VideoSource` (native: `{uri, useCaching:true}`;
  web: the plain string) rather than a bare uri string, because the on-device cache flag must ride
  on the source object handed to `replaceAsync`. Same name/signature the spec asked for; the
  return type is `CoverVideoSource` (documented in `coverVideoCache.ts`).
- No deploy / merge / close performed (implementor scope).
