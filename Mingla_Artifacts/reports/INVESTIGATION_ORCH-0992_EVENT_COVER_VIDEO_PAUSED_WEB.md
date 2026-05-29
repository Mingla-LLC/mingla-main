# INVESTIGATION — ORCH-0992 [event-cover video paused on web]

**Status:** ROOT CAUSE PROVEN (live browser reproduction)
**Surface:** Buyer/anonymous Web (`mingla-business` web export) — confirmed by Seth
**Date:** 2026-05-29
**Branch/anchor:** `orch-0992-event-cover-video-paused-web` (local, anchor checkout — network offline blocked worktree spawn)

## Symptom (operator report)
On a brand, an event's video plays in the brand-page event list, but on the event's
cover it "shows up but seems paused."

## Five-truth-layer trace

### Data (Supabase, live)
- Only **2** event video covers exist, both on brand `leggothis`, both **`.mp4`**
  (Cloudinary `f_mp4`): `a-life-in-vegas`, `vibes-and-stuff`. **Zero** legacy
  `.mov`/quicktime covers. 11 GIF covers exist across brands.
- Kills the first hypothesis (see Rejected Theory 1).

### Code
- Both surfaces render the SAME shared component
  `packages/event-rendering/EventCoverMedia.tsx`:
  - Brand list card → `packages/brand-rendering/PublicBrandPage.tsx:1368` (`CoverBlock`)
  - Event hero → `packages/event-rendering/PublicEventPage.tsx:467`
- `EventCoverMedia` honors `prefers-reduced-motion`:
  - `EventCoverMedia.tsx:327` `AccessibilityInfo.isReduceMotionEnabled()` → on web maps to
    `window.matchMedia('(prefers-reduced-motion: reduce)')`.
  - `coverMediaPresentation.ts:24-25`: `mediaType==="video"` →
    returns **`"video_still"`** when reduceMotion is true, else `"video"`.
  - `EventCoverMedia.tsx:418`: `autoplay={presentation === "video" ? autoplay : false}`
    and `loop` likewise → a `video_still` renders the `<video>` element but with
    **autoplay OFF, loop OFF** → frozen on frame 0.
- GIF covers (`mediaType==="gif"`) are NEVER downgraded → they always animate,
  regardless of reduce-motion.

### Runtime (Playwright on production `business.usemingla.com`, real WebKit + Chromium)
| Condition | Hero `<video>` state |
|---|---|
| Reduce Motion OFF (desktop + iPhone viewport, direct load AND SPA click-through) | `paused:false`, currentTime advancing (2.9s→6.7s), `readyState:4`, muted autoplay — **PLAYS** |
| Reduce Motion ON (desktop) | `paused:true`, `autoplayAttr:false`, `currentTime:0`, `readyState:4` — **element present + fully loaded but FROZEN on frame 0** |

The reduce-motion result is an exact match for "shows up but seems paused."

## Root cause
`EventCoverMedia` downgrades a true `video` cover to a non-autoplaying `video_still`
when the viewer has `prefers-reduced-motion: reduce`. The `<video>` is present and
loaded but never plays — reading as "paused." GIF covers in the same list keep
animating (no downgrade), which is why the list *looks* like it "plays" while the
mp4 cover is frozen.

## Why list-vs-cover diverge for the same component (PROVEN)
Playwright on the live brand page (`/b/leggothis`, Events tab, scrolled to the card):
- Reduce Motion OFF → brand-list mp4 card `paused:false`, currentTime advancing (16s).
- Reduce Motion ON → brand-list mp4 card `paused:true`, `autoplayAttr:false`,
  `currentTime:0` — frozen, IDENTICAL to the hero.

So the list mp4 card freezes too. What makes the list *look* alive under reduce-motion
is that this brand's other covers are **GIFs** (11 exist; `imgSrcs` were giphy URLs),
and GIF covers are NEVER downgraded — they keep animating. A frozen mp4 thumbnail
sitting beside animating GIFs reads as "a static card"; the same frozen frame blown up
to the full hero reads as "broken / paused." Same component, same bug, different
perceptual salience.

## Rejected theories
1. **Legacy QuickTime safety filter** (`isLegacyUnsafeEventCoverVideoUrl` nullifies
   `.mov` covers on the event page but not the list). REJECTED: live data has zero
   `.mov` covers, so the filter never fires; and it would cause "no video at all," not
   "paused video."
2. **Missing autoplay prop on the hero.** REJECTED: hero defaults to
   `autoplay=true, muted=true, loop=true` and PLAYS under normal motion (proven).
3. **Unreachable dead branch** at `PublicEventPage.tsx:476-488`. Real (the second
   ternary arm can never run because the first arm already catches
   `coverMediaUrl !== null`), but it is NOT the cause — harmless dead code. Worth
   deleting opportunistically in the fix.

## Open confirmation (gating the fix)
The proven trigger is reduce-motion. NOT yet confirmed: that the operator's machine
has Reduce Motion ON (vs. a device-specific autoplay block headless can't replicate,
e.g. iOS Low Power Mode). One 10-second check resolves it.

## Fix SHIPPED (operator approved: autoplay muted + loop; all surfaces)
New helper `shouldFreezeCoverForReduceMotion({reduceMotion, autoplay, muted, loop})`
in `packages/event-rendering/coverMediaPresentation.ts` (mirrored byte-for-byte in
`mingla-business/src/utils/eventCoverMediaRules.ts` per its existing parity contract).
`EventCoverMedia.tsx` now feeds the gate's result into the presentation resolver's
`reduceMotion` instead of the raw flag:

```
const freezeForReduceMotion = shouldFreezeCoverForReduceMotion({ reduceMotion, autoplay, muted, loop });
const presentation = resolveEventCoverMediaPresentation({ mediaUrl, mediaType, hasMediaError, reduceMotion: freezeForReduceMotion });
```

A muted-autoplay-loop cover (the default for both hero and list) is ambient motion →
exempt from the reduce-motion freeze. Sound-on / non-autoplay / non-loop covers still
freeze to a still frame (a11y preserved). Also removed the unreachable dead `video`
branch in the shared `PublicEventPage.tsx` hero.

- Fixes hero + list on web AND native (shared component) — consistent.
- a11y trade-off: muted looping covers now animate for reduce-motion users (same as
  GIF covers always have). Operator accepted; matches the chosen behavior.
- Blast radius: `packages/event-rendering/` (mingla-business web+native, app-mobile
  native). Operator approved all-surfaces.

## Follow-up: event-hero cover FIT (operator request, 2026-05-29)
After the reduce-motion fix, operator asked that the event-page hero show the WHOLE
cover (no edge crop) AND have no black bars, for any uploaded shape incl. square.
`cover` crops; `contain` bars — neither alone satisfies both. Fix: make the hero
size itself to the cover's real aspect ratio, then cover-fill (fills exactly → no
crop, no bars).

- `EventCoverMedia` gained `onAspectRatio?(ratio)` — reports intrinsic ratio from
  web `<video>.loadedmetadata` (videoWidth/Height), native expo-video 3.0.16
  `sourceLoad` → `availableVideoTracks[0].size`, and RN `<Image>.onLoad`
  `source.width/height` for image/gif covers. Guarded: list/grid cards omit the
  callback and pay nothing.
- Event hero (`PublicEventPage.tsx`) moved from a fixed-380px absolute band to an
  in-flow, column-width (`maxWidth: 660`) box whose `aspectRatio` follows the measured
  ratio, clamped to `[0.75, 16/9]`. Body card pulled up `-28` to keep the rounded
  immersive seam; state banner moved in-flow. The old fixed `paddingTop: 288` offset
  removed.
- Clamp behavior (verified): 16:9 / square / 4:3 / anything in [0.75,1.78] → exact
  fit, no bars/no crop. Extreme vertical (<0.75) or ultrawide (>1.78) → cover-fills
  with bounded crop so a portrait video can't push the page off-screen.
- **Verified on a real production web export** (`expo export -p web`, served static,
  Playwright): video 1280×720 (AR 1.778) → hero box rendered 660×371 (AR 1.778),
  `objectFit: cover`, `matchesShape: true`, playing. Screenshot confirmed no bars,
  no crop, seam preserved. (Dev-web `expo start --web` could not be used — unrelated
  `expo-file-system getEnforcing` dev-only crash; production export is the real
  artifact and renders clean.)

## Tests
- `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts` — new
  `describe("ORCH-0992 reduce-motion ambient cover gate")`: 5 truth-table cases
  (happy path) + 3 real-resolver integration cases (adversarial, different angle).
  8/8 pass.
- Fails-on-revert proven: reverting the gate body in both copies flips exactly the two
  ambient-exemption assertions to fail (the truth-table ambient case + the integration
  "resolves to playing video" case); restoring → 8/8 green again.
- Gates green: orch-0978-video-autoplay-muted-contract, orch-0770, orch-0783,
  orch-0964-brand-rendering-self-contained, meta-orch-0827-package-isolation.

## Pre-existing unrelated test debt (NOT ORCH-0992)
`eventCoverMedia.test.ts` already had **6 failing source-assertion tests on clean main**
(confirmed by stash test). They assert strings in `CreatorStep4Cover.tsx` (now uses
`<CoverPicker>`, ORCH-0876) and the `src/components/event/PublicEventPage.tsx` adapter
(rendering moved to the shared package, ORCH-0964) — `mediaTypes: ["images"]`,
`usePathname`, `showAudioControl`, `mediaPlaybackActive`, etc. These are stale from prior
refactors, are NOT touched by ORCH-0992, and need a separate cleanup ORCH with
`[TEST-MOD-APPROVED]` (some are locked). Flagged to operator.
