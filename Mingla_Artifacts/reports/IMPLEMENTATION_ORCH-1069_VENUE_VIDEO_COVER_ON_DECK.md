# IMPLEMENTATION — ORCH-1069 [Place/venue video covers render on the consumer deck card + gallery]

**Status:** implemented and verified (logic + typecheck + lint + Deno regression, fails-on-revert proven). Live-fire on iOS sim / Android emu (SC-ACCEPT-iOS/Android) is the tester's remaining gate.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1069-[venue-video-cover-on-deck]/` on branch `ORCH-1069-venue-video-cover-on-deck`.
**Commit:** `0673783bb`.
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1069_VENUE_VIDEO_COVER_ON_DECK.md`.
**Builds on:** ORCH-1068 (first-still hero = poster), ORCH-0978/0994/0992 (`EventCoverMedia`), COMMS-0007 (`@mingla/event-rendering` + `expo-video` in app-mobile — RESOLVED).
**App-mobile only / OTA-able:** `git diff --name-only -- supabase/` is EMPTY (verified). No migration, no edge deploy, no native module.

---

## 1. What changed (per-file Old → New receipts)

### `app-mobile/src/utils/videoUrl.ts` (NEW, 34 lines)
- **Before:** did not exist.
- **Now:** single owner of app-side video-URL detection — `isVideoUrl(url)` and `firstVideoUrl(images)`. The `isVideoUrl` regex pair mirrors `discover-cards/index.ts:708-709` byte-for-byte: `const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(\?|$)/i;` plus the `/\/video\/upload\//` path guard. `firstVideoUrl` returns the first video URL in an ordered media list, or `null`. Explicit return types, no `any`, guards null/empty/non-array input.
- **Why:** SC-1/SC-3, §4.0. Single source so the deck hero + gallery agree on what is a video; invariant `I-1069-VIDEO-DETECTION-MATCHES-EDGE`. Carries a protective header comment cross-referencing the edge fn (the reciprocal comment in the edge fn was intentionally NOT added — see Deviation D-1 below — to honor the hard "zero supabase/ diff" guard; the invariant is instead machine-enforced by T-07c).

### `app-mobile/src/components/SwipeableCards.tsx` (+102 / -… ≈ 92 net)
- **Before:** both deck hero render sites (`nextCard` behind ~L2558, `currentRec` top ~L2706) rendered `CardHeroImage uri={…image}` (still image only, ExpoImage). A venue with a `.mp4` cover never played.
- **Now:** added a `CardHero` wrapper component (after `CardHeroImage`) that derives `firstVideoUrl(images)`. If there is no video → renders the EXISTING `CardHeroImage` (byte-identical still path — zero regression for every still/event/TM/curated card). If there is a video → renders the still (`image`) as a POSTER layer behind, then `EventCoverMedia` (`mediaType="video"`, `videoContentFit="cover"`, `muted`, `loop`, `radius=0`, `label=title`, `showAudioControl={false}`) on top, wrapped in `pointerEvents="none"` (META-ORCH-0991 Bug 3a — keeps the card swipeable/tappable over the native VideoView). Both render sites now call `<CardHero image images title isTopCard … />`; `nextCard` passes `isTopCard={false}`, `currentRec` passes `isTopCard={true}`. Imports added: `EventCoverMedia` from `@mingla/event-rendering`, `firstVideoUrl` from `../utils/videoUrl`.
- **Why:** SC-1/SC-2/SC-3/SC-4/SC-6, §4.1, §5. Overlays/gradient/badges/title and the still prefetch (~L890) are untouched (left as siblings after the hero — z-order preserved; video NOT prefetched).

### `app-mobile/src/components/expandedCard/ImageGallery.tsx` (+47 / -10)
- **Before:** `images.map(...)` rendered every entry through a plain RN `<Image source={{uri}} resizeMode="cover" />`. A `.mp4` entry showed a broken/blank frame.
- **Now:** each page branches on `isVideoUrl(mediaUri)`: a video entry routes to `EventCoverMedia` (`mediaType="video"`, `videoContentFit="cover"`, `muted`, `loop`, `radius=0`, `showAudioControl` with `audioControlPosition="bottomRight"` — OQ-1 resolved: gallery is a deliberate-attention surface so it exposes the unmute control while the deck stays muted); image entries keep the existing `<Image>` unchanged. Playback is gated `autoplay/playbackActive = (index === currentIndex)` so only the visible page plays and paging away pauses it. Imports added: `EventCoverMedia` from `@mingla/event-rendering`, `isVideoUrl` from `../../utils/videoUrl`.
- **Why:** SC-5, §4.2. Paging/dots/arrows index math (`images.length`, `currentIndex`, `scrollTo`) untouched — a video occupies one page like any image.

### `app-mobile/src/utils/__tests__/videoUrl.test.ts` (NEW, 102 lines) — regression test
- Deno-runnable (matches the existing app-mobile `src/utils/__tests__/*.test.ts` convention; app-mobile has no jest). Covers T-07 detection, SC-1/SC-3 `firstVideoUrl`, SC-4 perf-guard mapping, and machine parity against the live edge fn (T-07c reads `discover-cards/index.ts` and asserts the `VIDEO_EXT` literal matches).

### `app-mobile/deno.lock` (+34) — cached `std@0.224.0/assert` deps pulled by running the new Deno test (same std version other app-mobile Deno tests already use). Benign lockfile update.

---

## 2. EventCoverMedia integration (reuse, no new player)

Both surfaces consume the shared `EventCoverMedia` from `@mingla/event-rendering` (the SAME renderer the event/trip grid cards and the brand page hero already use, per COMMS-0007). No new video player, no direct `expo-video` call site added in app-mobile components. The integration mirrors `BusinessEventCard.tsx:136-146`: `pointerEvents="none"` wrapper + `videoContentFit="cover"` + `label` + `StyleSheet.absoluteFill`. `mediaType` is passed EXPLICITLY as `"video"` because the renderer does not auto-detect `.mp4` (`coverMediaPresentation.ts` resolves `"fallback"` for unknown/null mediaType) — the `.mp4` detection happens app-side via `videoUrl.ts`, exactly as the spec §2.2 requires.

## 3. Perf guard (`I-1069-ONE-PLAYING-DECK-VIDEO`)

- The swipe stack only ever mounts two heroes: `currentRec` (top) + `nextCard` (behind). Cards at depth ≥2 are never rendered, so they CANNOT mount a video player — structural, not a new gate.
- `CardHero`'s `isTopCard` prop gates BOTH `autoplay` and `playbackActive`. Top card → `true` (plays). Behind card → `false` (mounts the player paused on its poster, ready to promote instantly; `EventCoverMedia` pauses the native player when `playbackActive` is false). Net: at most one playing deck video at a time.
- Gallery: only `index === currentIndex` plays. No video is prefetched (the still prefetch is unchanged).
- This is strictly lighter than the already-shipped event/trip grid, which mounts many `EventCoverMedia` covers simultaneously.

## 4. App-mobile-only / OTA confirmation (SC-7)

```
$ git diff --name-only -- supabase/
(empty)
```
Changed files: `app-mobile/src/utils/videoUrl.ts`, `app-mobile/src/utils/__tests__/videoUrl.test.ts`, `app-mobile/src/components/SwipeableCards.tsx`, `app-mobile/src/components/expandedCard/ImageGallery.tsx`, `app-mobile/deno.lock`. Zero `supabase/`, zero migration, zero strict-grep backend allowlist, no `app.config`/Pods/Gradle. `expo-video` already in the binary → no native rebuild. → OTA via `eas update` (per-platform).

## 5. Verification matrix

| Criterion | How verified | Result |
|---|---|---|
| SC-1 video plays (top) | `firstVideoUrl` unit + `CardHero` video branch (code) | PASS (logic); runtime PASS pending live-fire |
| SC-2 still poster, no flash | poster `CardHeroImage` rendered behind video layer (code §4.1.b) | PASS (code); runtime pending live-fire |
| SC-3 still-only unchanged | `firstVideoUrl([imgs])===null` → existing `CardHeroImage` path (unit + code) | PASS |
| SC-4 perf guard | only 2 heroes mount; `isTopCard` gates playback; unit SC-4 | PASS |
| SC-5 gallery mixed media | `isVideoUrl` branch → `EventCoverMedia`/`<Image>`; only `currentIndex` plays (code) | PASS (code); runtime pending live-fire |
| SC-6 event/trip/TM/curated unchanged | no edit to those components; deck only branches on `firstVideoUrl` | PASS |
| SC-7 OTA, no backend | empty supabase diff; expo-video present | PASS |
| SC-ACCEPT-iOS / -Android | live-fire on Lantern & Vine | PENDING (tester) |
| tsc clean (my files) | `tsc --noEmit` — zero errors in the 3 prod files | PASS |
| lint (my files) | `videoUrl.ts` clean; the `@mingla/event-rendering` `import/no-unresolved` is a PRE-EXISTING eslint-resolver false positive identical on shipped `BusinessEventCard.tsx` (tsconfig paths resolve it; eslint resolver doesn't read them) | PASS (no new real errors) |

## 6. Regression test

- **Path:** `app-mobile/src/utils/__tests__/videoUrl.test.ts`
- **Run (green):** `deno test --allow-read src/utils/__tests__/videoUrl.test.ts` → `ok | 6 passed | 0 failed`.
- **Fails-on-revert verified @ `33a0b855a`** (pre-fix HEAD): drifting the helper `VIDEO_EXT` regex (mp4-only) made 2 tests FAIL — `T-07a` (video detection) + `T-07c` (edge-parity assertion) → `FAILED | 4 passed | 2 failed`. Restored to the canonical regex → `6 passed`. The T-07c test reads the live `discover-cards/index.ts` and asserts the regex literal matches, so a future edge-side change is also caught.

## 7. Invariants

- `I-1069-VIDEO-DETECTION-MATCHES-EDGE` — NEW. Enforced by T-07c (machine parity vs the live edge fn) + the protective comment in `videoUrl.ts`.
- `I-1069-ONE-PLAYING-DECK-VIDEO` — NEW. Enforced by the structural 2-card mount + `isTopCard` playback gate + T-07 SC-4 mapping + no-prefetch.
- `I-1068-DECK-HERO-IS-IMAGE` — PRESERVED. The still path is unchanged; the `.mp4` plays through `EventCoverMedia`, never fed to `ExpoImage`. `image` poster stays an image.
- `I-MOR-0827-PACKAGE-ISOLATION` — PRESERVED. `EventCoverMedia` consumed via the public `@mingla/event-rendering` entry; no app-internal import added to the package.
- Constitution #1 (no dead taps) — PRESERVED via the LOCKED `pointerEvents="none"` wrapper. Constitution #9 (no fabricated data) — missing video → still/band, never a fake.

## 8. Deviations / Discoveries for orchestrator

- **D-1 (deviation, deliberate):** SPEC §11 suggested adding a reciprocal protective comment in `discover-cards/index.ts:708`. The IMPLEMENT dispatch's HARD GUARD requires **zero `supabase/` diff** (OTA-able). The dispatch overrides the spec note: no edge-fn edit was made. The invariant is instead enforced by T-07c, which reads the edge source at test time and asserts regex parity — strictly stronger than a static comment. Flagged for awareness; no action needed.
- **OQ-1 resolved:** gallery exposes `showAudioControl` (unmute) at `bottomRight`; deck stays muted/ambient. Per spec recommended default.
- No unrelated bugs discovered. The pre-existing `import/no-unresolved` eslint false positive on `@mingla/event-rendering` (also present on shipped `BusinessEventCard.tsx`) is a repo-wide eslint-resolver gap, not introduced here.

## 9. Close commands (for the orchestrator)

OTA ship (per-platform, no native rebuild, no backend deploy), per `feedback_eas_ota_publish_per_platform.md`:
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1069-[venue-video-cover-on-deck]/app-mobile"
eas update --platform ios   --message "ORCH-1069: venue video covers play on deck card + gallery"
eas update --platform android --message "ORCH-1069: venue video covers play on deck card + gallery"
# verify each landed:
eas update:list --platform ios --limit 1
eas update:list --platform android --limit 1
```
No `supabase db push`, no `supabase functions deploy`, no migration.
