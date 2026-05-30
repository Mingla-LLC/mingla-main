# PARTIAL INVESTIGATION — ORCH-1020

**[Collab group-chat deck — preferences sheet swipe-down freezes the app]**

Status: **PARTIAL EVIDENCE ONLY — no final investigation verdict.** This note preserves work that happened before the investigation was interrupted. It must not be treated as a completed forensic report, and it must not be promoted to SPEC.

## Why this exists

The original ORCH-1020 dispatch was written correctly as an INVESTIGATE prompt, but a prior turn then executed specialist-style runtime steps directly and stopped mid-run. This note captures the evidence so the next user-dispatched investigator does not rediscover the same setup and does not overstate the nested-modal hypothesis.

## Current evidence summary

- Source-only hypothesis remains: `CollabDeckSheet` is a full-screen RN `Modal`, and it mounts `PreferencesSheet`, whose `visible` path uses `BaseBottomSheet wrapInRNModal`, creating a unique nested-modal stack.
- iOS runtime evidence from this partial run **did not reproduce the freeze** on the available iPhone 17 Pro Max simulator.
- Solo preferences sheet swipe-down was checked and did not freeze.
- Android investigation was started but interrupted before the preferences sheet gesture was tested.
- Therefore the root cause is still **suspected**, not probable or confirmed.

## Exact partial runtime setup

- Worktree: `~/Desktop/mingla-orchs/ORCH-1020-[collab-deck-prefs-swipe-freeze]`
- Branch: `ORCH-1020-collab-deck-prefs-swipe-freeze`
- Intended Metro port from `spawn.sh`: `8088`
- Actual iOS runtime used in the partial run: app-mobile Metro on `8082`, because `8088` was already occupied by a `mingla-business` Metro process.
- Guard used before running from `8082`: the three suspected files were compared between the ORCH-1020 worktree and the anchor checkout and were byte-identical:
  - `app-mobile/src/components/connections/CollabDeckSheet.tsx`
  - `app-mobile/src/components/PreferencesSheet.tsx`
  - `app-mobile/src/components/ui/BaseBottomSheet.tsx`
- iOS sim: iPhone 17 Pro Max `2C3312D9-EE52-4EBD-9704-15811D49A2EC`
- Driver: Maestro for taps/swipes; `simctl` for screenshots/recordings.

## iOS partial reproduction path

The run reached a genuine collaboration group-chat deck:

1. Opened consumer app on iPhone 17 Pro Max sim.
2. Navigated to Friends.
3. Opened the existing `Fly Group` collab session chat.
4. Tapped `Swipe Fly Group`.
5. Confirmed `CollabDeckSheet` open with header actions: `Close deck`, `Preferences`, and `Fly Group`.
6. Tapped `Preferences`, opening the collab `PreferencesSheet`.

## iOS partial observations

Solo preferences isolation:

- Opened solo preferences from the Home/Explore path.
- Swiped down to dismiss.
- Result: sheet dismissed and the app stayed responsive.
- Evidence files from the partial run: `/tmp/orch1020_002_solo_prefs_open.png`, `/tmp/orch1020_004_solo_after_swipe.png`, `/tmp/orch1020_005_friends.png`.

Collab preferences path:

- Opened `CollabDeckSheet` via `Fly Group` → `Swipe Fly Group`.
- Opened collab preferences via the deck header `Preferences` button.
- Tried multiple down-gesture variants:
  - long swipe from top/content region to bottom;
  - decisive pan from the visible grab-handle area to bottom;
  - rapid/aggressive double pan to race animations.
- Result: the run did **not** freeze. Depending on gesture start, the sheet either stayed open, scrolled, or dismissed cleanly. The deck remained responsive afterward: the preferences sheet could be reopened, and `Shift preferences` responded.
- Metro log check around the final swipe showed no new lines and no modal/gesture/error output.
- Evidence files from the partial run: `/tmp/orch1020_026_deck.png`, `/tmp/orch1020_027_prefs.png`, `/tmp/orch1020_032_after_pandown.png`, `/tmp/orch1020_033_reopen.png`, `/tmp/orch1020_034_agg.png`, `/tmp/orch1020_035_shift.png`, `/tmp/orch1020_036_final.png`, `/tmp/orch1020_clean_swipe.mp4`, `/tmp/orch1020_aggressive.mp4`.

Android partial state:

- Android emulator `emulator-5554` had `com.mingla.app.v2` installed and launched.
- The run navigated to Friends, then into `Fly Group`, then tapped the `Swipe` entry.
- The run was interrupted after `/tmp/orch1020_android_006.png`; no Android preferences swipe-down verdict exists yet.

## Source facts confirmed during partial run

- `CollabDeckSheet.tsx` is the only `presentationStyle="fullScreen"` RN Modal found under `app-mobile/src/`.
- `PreferencesSheet` has only the solo and collab mount sites expected by the original dispatch: `app/index.tsx`, `MessageInterface.tsx`, and `CollabDeckSheet.tsx`.
- `wrapInRNModal` usage is broad across the app, but the hypothesized `presentationStyle="fullScreen"` parent + `wrapInRNModal` child stack remains unique to the collab deck path.

## Required next investigation moves

1. Re-run the iOS repro from a clean app launch on the ORCH-1020 worktree bundle or explicitly prove the bundle parity if a different checkout/port is used.
2. Try the exact operator-described gesture, and also vary the preconditions that the partial run did not cover: different group chat (`Testing stuff`), fresh deck open vs long-lived deck, prefs opened while deck cards are still loading, gesture while keyboard/input focus or filter sections are active, and repeat loops.
3. Confirm whether the freeze reproduces on a release-like/dev-client build difference or only on a particular simulator/device state.
4. Finish Android behavior: open the collab preferences sheet and test the same gesture; record whether Android dismiss is inert, clean, or freezing.
5. If the freeze still does not reproduce after controlled attempts, the final report must say so plainly and downgrade the root-cause theory instead of forcing a SPEC.

## Do not overclaim

The correct current statement is: **source facts support a plausible nested-modal regression hypothesis, but the available partial iOS runtime run did not reproduce the freeze.** No implementation or SPEC should proceed until a user-dispatched forensic report either reproduces the freeze or reframes the issue from stronger evidence.
