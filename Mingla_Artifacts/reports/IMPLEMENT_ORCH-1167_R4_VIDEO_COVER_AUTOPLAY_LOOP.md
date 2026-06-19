# IMPLEMENT — ORCH-1167 R4 [event-page video cover autoplay + loop]

**Phase:** IMPLEMENT (UI-only, tightly scoped revision R4)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1167-[event-page-canonical]/`
**Branch:** `ORCH-1167-r4-video-cover-autoplay-loop` (off origin/main incl. merged ORCH-1167 + R2 + R3)
**Date:** 2026-06-19
**Status:** COMPLETE — all gates + tests green, fails-on-revert proven. NOT deployed/merged/OTA'd.

---

## The change (only this)

When the canonical standard-event public page's COVER is a VIDEO, it AUTOPLAYS
(muted, inline) and LOOPS continuously on every surface (buyer-web, business
iOS/Android, consumer iOS/Android). Image / GIF covers are unchanged. The
existing reduce-motion freeze policy is preserved (not overridden).

## Ground truth found on entry (important)

The autoplay + loop intent was **already wired** by ORCH-1167 R1 — both physical
cover mounts already passed `autoplay`/`playbackActive`/`loop` to
`EventCoverMedia` (which itself defaults `autoplay=true`, `muted=true`,
`loop=true` and fully implements muted-inline autoplay on web Safari via the
imperative `muted`+`playsinline` attribute path, native autoplay via expo-video,
web loop via `onEnded`→`currentTime=0`+`play()`, and native loop via the
`playToEnd`→`replay()` listener). So R4 was functionally satisfied; the risk was
**regression** (a future edit silently dropping the props), not absence.

R4 therefore (a) made the props EXPLICIT (`autoplay={true}` / `loop={true}`
instead of bare-boolean shorthand) with an ORCH-1167-R4 anchor comment, and
(b) added a fails-on-revert regression test pinning both the autoplay+loop wiring
on each surface AND the reduce-motion freeze policy.

## Architecture (where the cover lives, per surface)

- **buyer-web + business iOS/Android + business host preview:** the standard-event
  page (`mingla-business/src/components/event/PublicEventPage.tsx`) renders
  `FoundationEventPreview.tsx` → shared `ParallaxCoverShell`
  (`packages/offering-rendering/ParallaxCoverShell.tsx`), which mounts the single
  `EventCoverMedia` cover. (This shell also serves trip/experience — they inherit
  the same autoplay+loop, which is correct and unchanged.)
- **consumer iOS/Android:** `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx`
  pins its own `EventCoverMedia` cover directly inside the `BaseBottomSheet`
  (`styles.nativeCover`), NOT via the shell — so it carries its own props.

`EventOfferingBody.tsx` itself does NOT mount the cover (it is the scrollable
BODY; the cover is a pinned sibling owned by the surface shell) — confirmed by
grep (no `EventCoverMedia` reference in the body). No change needed there.

## Files changed (2 source + 1 test + this report)

1. `packages/offering-rendering/ParallaxCoverShell.tsx`
   — cover `EventCoverMedia` props made explicit: `autoplay` → `autoplay={true}`,
   `playbackActive` → `playbackActive={true}`, `loop` → `loop={true}` (+ R4
   anchor comment). `muted={muted}` unchanged (cover follows page mute state;
   default-muted ⇒ ambient autoplay; chrome Mute toggle still unmutes).
   Drives buyer-web + business iOS/Android (+ trip/experience, unchanged behavior).

2. `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx`
   — the standard-event pinned cover (`styles.nativeCover`) props made explicit
   the same way (+ R4 anchor comment). Other consumer covers in the file
   untouched.

3. `packages/offering-rendering/__tests__/orch_1167_r4_video_cover_autoplay_loop.test.ts` (NEW)
   — 7 assertions (below).

4. `Mingla_Artifacts/reports/IMPLEMENT_ORCH-1167_R4_VIDEO_COVER_AUTOPLAY_LOOP.md` (this file).

No schema / RPC / migration / pricing / package-config change. No edge function.
RSVP / trip / experience body logic untouched (the shell is shared, but only the
cover autoplay/loop intent — already its behavior — was made explicit).

## What was deliberately NOT touched

- `EventCoverMedia.tsx` — already correct (muted-inline autoplay, loop, reduce-
  motion freeze). No edit.
- `coverMediaPresentation.ts` `shouldFreezeCoverForReduceMotion` — already
  correct; left intact (the R4 test pins it).
- Mute toggle ownership — the chrome (`OfferingChrome`) owns Mute via `onToggleMute`;
  covers do NOT pass `showAudioControl` (intentional, unchanged).
- All R1–R3 contracts (full-width date, solid pills, always-active buy button,
  floating-button position, desktop 2-column, Σ all-in, privacy, ORCH-1159
  close-X, I-MOR-0827 package isolation, gorhom scroll).

## Cross-surface impact (Step 5.5)

| Surface | Affected? | What changes for the user | File |
|---|---|---|---|
| Consumer iOS | yes (parity, manual path) | video cover autoplays+loops on the standard-event sheet | `ConsumerEventDetailScreen.tsx` |
| Consumer Android | yes (same code) | same | same |
| Buyer/anon Web | yes (parity, shared) | video cover autoplays+loops on `/e/{brand}/{event}` | `ParallaxCoverShell.tsx` |
| Business iOS | yes (shared) | same on the public/preview event page | `ParallaxCoverShell.tsx` |
| Business Android | yes (shared) | same | same |
| Admin Web | no | does not render the event public page | — |
| Business Web preview | yes (shared) | host preview cover autoplays+loops | `ParallaxCoverShell.tsx` |

Parity is automatic for the 4 shell-served surfaces (one shared file). The
consumer pair is a separate (hand-kept-parity) path — both covered by the R4 test.

Note: the shell is also the trip + experience cover host; the explicit
`autoplay={true}`/`loop={true}` matches their prior bare-boolean behavior exactly
(no behavior change for those offerings).

## Invariants

- **I-MOR-0827-PACKAGE-ISOLATION** — preserved; the shell change adds only
  literal boolean props, no app-src import. `orch-1167-shell-agnostic-body` gate
  PASS.
- All 5 I-PROPOSED-1167 gates re-run PASS (below).

## Verification

### The 5 ORCH-1167 strict-grep gates — ALL PASS
```
orch-1167-allin-price-in-ticket-box                 PASS
orch-1167-canonical-9-section-order                 PASS
orch-1167-city-level-map-no-exact-pin-when-hidden   PASS
orch-1167-one-read-rpc                              PASS
orch-1167-shell-agnostic-body                       PASS
```

### Jest — R4 test + existing ORCH-1167 offering-rendering suites
Run via `cd mingla-business && npx jest --config jest.config.cjs --roots
../packages/offering-rendering --runTestsByPath <files>`:
```
orch_1167_r4_video_cover_autoplay_loop.test.ts   7 passed   (NEW)
orch_1167_r3_pills_button_polish.test.ts        14 passed
orch_1167_r2_layout_polish.test.ts               passed
orch_1167_event_box_totals.test.ts               passed
```
R4 test assertions:
1. ambient muted-autoplay-loop video cover KEEPS PLAYING under reduce-motion
   (autoplay intent survives the freeze).
2. sound-on cover STILL frozen under reduce-motion (freeze NOT overridden).
3. non-loop cover STILL frozen under reduce-motion.
4. non-autoplay (tap-to-play) cover STILL frozen under reduce-motion.
5. reduce-motion OFF ⇒ ambient cover never frozen.
6. shared `ParallaxCoverShell` cover passes `autoplay={true}` + `loop={true}` +
   `muted={muted}` (buyer-web + business iOS/Android).
7. consumer standard-event cover passes `autoplay={true}` + `loop={true}` +
   `muted={muted}` (consumer iOS/Android).

### Fails-on-revert (proven by true edit + restore)
- Revert shell `autoplay={true}` → `autoplay={false}` ⇒ assertion 6 FAILS.
- Revert `shouldFreezeCoverForReduceMotion`'s `isAmbientMutedLoop` guard to
  `false` ⇒ assertion 1 FAILS.
- Both reverts restored; suite returns 7/7 green.

### Typecheck
- `mingla-business` `tsc --noEmit`: the touched files (`ParallaxCoverShell.tsx`,
  `ConsumerEventDetailScreen.tsx`) report the IDENTICAL error count (25) WITH and
  WITHOUT my edits (verified by stash/recount) ⇒ ZERO new type errors. The 25 are
  pre-existing monorepo `Cannot find module 'react'` / implicit-any resolution
  noise across `packages/*` (same on `EventOfferingBody.tsx`, `phone-input`, etc.),
  not introduced by R4.
- `app-mobile` `tsc --noEmit`: 562 pre-existing errors; ZERO in my edited consumer
  lines (1004–1020) — grep of `ConsumerEventDetailScreen.tsx(10[0-2][0-9]` empty.

## Confirmation

Autoplay + loop for VIDEO covers is wired (now explicitly + regression-guarded) on
ALL surfaces: buyer-web, business iOS/Android (+ host preview) via the shared
`ParallaxCoverShell`, and consumer iOS/Android via the directly-pinned cover.
Muted-inline autoplay and the reduce-motion freeze are intact; image/GIF covers
unchanged.

## Comms ledger

Read on entry. No BLOCK rows addressed to ORCH-1167 / implementor / ALL.
COMMS-0040 (RSVP body promotion) and COMMS-0041 (experience body promotion) ask
coordination only for RSVP/experience render paths and `packages/offering-rendering`
*body promotions / export changes* — this R4 touches neither (it changes two
literal props inside an existing shared component; no new export, no body move, no
RSVP/experience logic). No ledger write required; no cross-ORCH impact introduced.

## Deviation / blocker

None. (Sole note: R4 was already functionally satisfied by R1's wiring; this round
hardened it to explicit + fails-on-revert-guarded per the dispatch's "ensure"
requirement.)

## Next

Route back to orchestrator for REVIEW → tester. Do NOT deploy/merge/OTA (UI-only;
ships with the standard ORCH-1167 web `[deploy]` + per-platform OTA when the ORCH
closes).
