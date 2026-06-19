# IMPLEMENT — ORCH-1167 R5 [web cover autoplay-muted]

**Skill:** mingla-implementor
**Date:** 2026-06-19
**Branch:** `ORCH-1167-r5-web-cover-autoplay` (off origin/main incl. ORCH-1167 R1–R4)
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1167-[event-page-canonical]/`
**Scope:** UI-only, web-specific. Standard-event public cover video. No schema/RPC/migration/package-config.

---

## The bug (Seth, live on buyer-web)

A VIDEO event-cover still showed the browser's native PLAY BUTTON on web instead of
autoplaying. On mobile it autoplays muted + loops correctly (R4). Web-specific: the
browser BLOCKED the inline autoplay, so it painted its native play-button overlay.

## Root cause (exact, verified in code)

Browsers permit gesture-free **inline autoplay only when the `<video>` is MUTED at
`play()` time**. The web branch lives in `packages/event-rendering/EventCoverMedia.tsx`
→ `EventCoverWebVideo`, which the shared `ParallaxCoverShell` mounts (it imports
`EventCoverMedia` from `@mingla/event-rendering`; the standard-event page reaches it via
`FoundationEventPreview` → `ParallaxCoverShell`).

The mute value reaching the `<video>` came from the parent-owned `muted` state
(`PublicEventPage` `useState(true)` → `ParallaxCoverShell muted` → `EventCoverMedia
muted={muted}` → web `<video>`). Two interacting defects let the FIRST autoplay attempt
fire while the element was not guaranteed-muted at the element level:

1. **React 19 emits `muted` as a DOM *property* only, never an HTML *attribute*** — and
   even the property can land *after* the browser's first autoplay-eligibility check on
   `<video autoPlay>`. The element's `muted` was driven by the incoming `muted` prop
   (`muted: muted` in `React.createElement`), so a single unmuted/late-muted first
   `play()` was rejected → native play button. The existing R4-era imperative effect set
   the attribute, but it runs *after* mount/paint — the rejecting first attempt already
   happened.
2. **A second, latent defect**: `EventCoverMedia`'s sync effect force-set
   `setIsMuted(Platform.OS === "web" && autoplay ? true : muted)` on EVERY `muted`-prop
   change, so the moment the user unmuted via the chrome toggle (parent `muted`→false),
   the effect re-muted the cover → the chrome Mute/Unmute toggle was effectively broken
   on web.

(Note: the cover's *initial* `isMuted` was already forced `true` on web by the
`initialMuted` line — so the initial *state* was muted; the failure was the
*element-level* mute guarantee at the FIRST autoplay attempt, plus the broken toggle.)

## The fix

All in `packages/event-rendering/EventCoverMedia.tsx`, web branch + shared mute state.
Mobile (`EventCoverNativeVideo`), image/GIF covers, and reduce-motion freeze are
untouched.

**`EventCoverWebVideo` — hard-mute the first autoplay, then honor the toggle:**
- `hasUnmutedRef` (ref) records the first user-gesture unmute (`if (!muted)
  hasUnmutedRef.current = true`). `effectiveMuted = hasUnmutedRef.current ? muted : true`
  — so EVERY autoplay attempt is hard-muted until the user unmutes; the browser always
  permits the inline autoplay and never paints the play button. After a real gesture
  unmute, the element follows the live `muted` prop (re-mute works too).
- A **synchronous `attachVideo` ref callback** pins `node.muted = true` + the `muted`,
  `playsinline`, `webkit-playsinline` ATTRIBUTES the instant the element mounts — BEFORE
  the browser evaluates autoplay eligibility (no longer relying on a post-paint effect).
- The element's `muted` is now `effectiveMuted` (not the raw prop). The imperative effect
  sets `video.muted = effectiveMuted`. `onCanPlay` re-asserts `muted` before the (re)play.
- Preserved: `controls: false`, `loop`, `playsInline`, `preload`, `objectFit`.

**`EventCoverMedia` — fix the toggle (mute state follows the parent prop):**
- The sync effect now splits NEW media (reset to the web autoplay-muted default so the
  next cover's first inline autoplay is permitted) from an in-place change (the user
  toggling sound → `setIsMuted(muted)` passes straight through). `initialMuted` / initial
  `useState` still default muted on web autoplay (ambient muted loop, matches native).
- This is safe: dropping the old "force muted on web on every change" can never
  reintroduce the play button, because `EventCoverWebVideo` independently hard-mutes its
  FIRST autoplay via `hasUnmutedRef`.

### Data flow after the fix
- Initial: parent `muted=true` → `isMuted=true` → web `<video> effectiveMuted=true` →
  muted inline autoplay permitted, **no play button**.
- Chrome Unmute tap (user gesture): parent `muted`→false → `isMuted=false` → web video
  `hasUnmutedRef=true`, `effectiveMuted=false` → plays unmuted (gesture-permitted).
- Chrome Mute tap: parent `muted`→true → `effectiveMuted=true` → re-mutes. Toggle works.

## Changed files
- `packages/event-rendering/EventCoverMedia.tsx` — web video hard-mute + sync-ref
  attribute pin + onCanPlay re-assert; mute-state sync follows parent prop. (+66/−6)
- `packages/offering-rendering/__tests__/orch_1167_r5_web_cover_autoplay_muted.test.ts`
  — NEW R5 regression (7 assertions, fails-on-revert).

## Verification

### R5 regression (NEW)
`cd mingla-business && npx jest --roots=../packages
--testPathPattern="orch_1167_r5_web_cover_autoplay_muted"` → **7/7 PASS**.

Fails-on-revert (TRUE deletion, both proven + restored):
- Revert web `muted: effectiveMuted` → `muted,` → 2 assertions FAIL.
- Revert the sync effect to the old "force muted on web on every change" → 1 assertion
  FAIL.

### Full ORCH-1167 jest suite
`npx jest --roots=../packages --roots=. --testPathPattern="orch_1167"` → **48/48 PASS**
(R2 layout, R3 pills/button, R4 autoplay+loop, R5 web-muted, event_box_totals,
cart_seed.adversarial). R1–R4 contracts intact.

### 5 ORCH-1167 strict-grep gates — ALL PASS
- `orch-1167-allin-price-in-ticket-box` PASS
- `orch-1167-canonical-9-section-order` PASS
- `orch-1167-one-read-rpc` PASS
- `orch-1167-shell-agnostic-body` PASS
- `orch-1167-city-level-map-no-exact-pin-when-hidden` PASS

### Typecheck
`mingla-business tsc --noEmit`: `EventCoverMedia.tsx` error count IDENTICAL pre/post (29
== 29). All errors are the pre-existing "Cannot find module 'react'" cascade + 2
`<Image>`/`<Pressable>` JSX-overload artifacts (present on clean HEAD at the same code
locations, only line-shifted by the added lines). **My change introduces ZERO new
typecheck errors.** (The package isn't independently typecheckable in this worktree's
resolution setup — same constraint R4 worked under; this was the verification method R4
used.)

### Regression scan
Adjacent cover/audio tests run; pre-existing failures in
`mingla-business/src/components/ui/EventCoverMedia.test.ts` (upload/picker copy) +
`eventCoverMediaService.test.ts` are unrelated (different files, fail identically on
clean HEAD — 10 fail pre + post) and out of scope.

## Preserved invariants
R1–R4 (full-width date, solid pills, always-active buy, floating button, desktop
2-column, autoplay+loop), Σ all-in, privacy/city-centroid, ORCH-1159 close-X,
I-MOR-0827 package isolation (no app-level imports added; only React + DOM), gorhom
scroll, reduce-motion freeze (untouched), all 5 ORCH-1167 gates. RSVP / trip / experience
untouched.

## Confirmation
The web cover video now autoplays MUTED on the first attempt — the browser permits the
inline autoplay and the native play button is gone. The OfferingChrome Mute/Unmute toggle
still unmutes (user gesture) and re-mutes. Mobile autoplay+loop unchanged.

## Not done (per dispatch)
No deploy / merge / OTA. Buyer-web is web-only and ships from main on merge (cannot be
OTA'd). Recommend on merge: ensure the merge commit carries `[deploy]` and watch the
Vercel `[deploy]`-gate cancel trap.
