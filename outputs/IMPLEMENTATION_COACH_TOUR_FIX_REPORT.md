# Implementation Report: Coach Mark Tour Fixes

## What Was There Before

The coach mark tour had 5 confirmed bugs preventing it from working:

1. **PreferencesSheet mounted outside TourTargetProvider** — Step 2 opens the preferences sheet, but it rendered outside the context provider (index.tsx:2195 was outside the `</TourTargetProvider>` at line 2170). The TourTarget inside PreferencesSheet threw or silently failed, causing the overlay to show its "target not found" blocker state — the frozen screen.

2. **Pairing query keys missing userId** — mockTourData.ts seeded `['pairings', 'pills']` and `['pairings', 'incoming']`, but the real hooks in usePairings.ts look for `['pairings', 'pills', userId]`. Cache miss → real network call → empty or failed state during tour.

3. **Three nested TourTargets wrapping one component** — `tour-target-sessions`, `tour-target-invite`, and `tour-target-collab-prefs` all wrapped the same `CollaborationSessions` component in HomePage.tsx. Three separate tour stops highlighting the identical box.

4. **Static screen dimensions** — TourOverlay.tsx captured `Dimensions.get('window')` once at module load. On orientation changes or split-screen, positions would be wrong. Tooltip positioning also lacked clamping, allowing off-screen placement.

## What Changed

### File: `app-mobile/app/index.tsx`
- **Moved `</TourTargetProvider>` closing tag** from line 2170 (before PreferencesSheet) to after the PreferencesSheet conditional block (~line 2211). Now both collab and solo PreferencesSheet instances render **inside** the TourTargetProvider, so `TourTarget id="tour-target-preferences"` can register successfully.

### File: `app-mobile/src/data/mockTourData.ts`
- **Fixed pairing seed keys** — Changed `['pairings', 'pills']` → `['pairings', 'pills', userId]` and `['pairings', 'incoming']` → `['pairings', 'incoming', userId]`. Now matches the exact key structure in `usePairings.ts` query key factories.

### File: `app-mobile/src/components/tour/TourOrchestrator.tsx`
- **Consolidated 3 collab steps into 1** — Removed `tour_invite` and `tour_collab_prefs` from COACH_MARK_IDS. Removed the two extra TOUR_STEPS entries. The single remaining step (`tour-target-sessions`) uses combined tooltip text: "Plan together! Invite friends, merge tastes, and discover as a group."
- **Fixed hardcoded last-step check** — Changed `tourStep >= 10` to `tourStep >= TOUR_STEPS.length - 1` so the tour completes correctly regardless of step count.
- Tour is now **9 steps** (was 11): deck → preferences → sessions → pairings → map → chats → saved → calendar → profile.

### File: `app-mobile/src/components/HomePage.tsx`
- **Removed 2 redundant nested TourTargets** — Kept only `<TourTarget id="tour-target-sessions">` wrapping `CollaborationSessions`. Removed `tour-target-invite` and `tour-target-collab-prefs` wrappers.

### File: `app-mobile/src/components/tour/TourOverlay.tsx`
- **Replaced static `Dimensions.get('window')`** with `useWindowDimensions()` hook — screen size now updates dynamically on rotation/resize.
- **Added tooltip position clamping** — `tooltipTopBelow` capped at `SCREEN_H - 160` to leave room for content. `tooltipBottomAbove` floored at `16` to prevent top-edge clipping.
- Removed unused `Dimensions` and `FadeOut` imports.

## Verification Checklist

| # | Criterion | Status |
|---|-----------|--------|
| 1 | PreferencesSheet renders inside TourTargetProvider | PASS — closing tag moved after sheet conditionals |
| 2 | Tour-target-preferences can register with context | PASS — parent provider now wraps it |
| 3 | Pairing pills seed key matches real hook key | PASS — both use `['pairings', 'pills', userId]` |
| 4 | Incoming pairings seed key matches real hook key | PASS — both use `['pairings', 'incoming', userId]` |
| 5 | No duplicate tour targets highlighting same element | PASS — single TourTarget on CollaborationSessions |
| 6 | Tour step count matches COACH_MARK_IDS length | PASS — both are 9 |
| 7 | Last step detection is dynamic | PASS — uses `TOUR_STEPS.length - 1` |
| 8 | Screen dimensions are dynamic | PASS — useWindowDimensions hook |
| 9 | Tooltip clamped to screen bounds | PASS — min/max guards on both directions |

## Known Limitations

- **No automated tour tests exist** — these regressions slipped through because the tour has no test coverage. Recommend adding integration tests for the step flow.
- **Realtime subscription kill on tour start** (TourOrchestrator.tsx:144) — still present. Other screens may show stale data during tour. Not fixed here as it's a separate concern.
- **clearTourData uses `exact: false`** prefix matching — could theoretically remove non-tour data if a real query key starts with the same prefix. Low risk since tour uses synthetic user IDs.
- **Tour step 2 timing** — PreferencesSheet still needs to mount and register its TourTarget after `setShowPreferences(true)`. The existing 400ms delay + 5s poll fallback in TourOrchestrator handles this, but on very slow devices it may briefly show the loading overlay before the sheet registers.

## Files Modified

1. `app-mobile/app/index.tsx` — TourTargetProvider scope expansion
2. `app-mobile/src/data/mockTourData.ts` — Pairing query key fix
3. `app-mobile/src/components/tour/TourOrchestrator.tsx` — Step consolidation + dynamic last-step
4. `app-mobile/src/components/HomePage.tsx` — Redundant TourTarget removal
5. `app-mobile/src/components/tour/TourOverlay.tsx` — Dynamic dimensions + position clamping
