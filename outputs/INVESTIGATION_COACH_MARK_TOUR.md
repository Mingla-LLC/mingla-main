# Investigation: Coach Mark Tour System

## What You're Seeing

The coach mark tour either doesn't appear at all, or shows a dark overlay with no tooltip and gets stuck. The app also crashed on startup with a `borderRadius` TypeError — that crash has been fixed (see Bug #1 below).

The RevenueCat errors in your logs are a **separate issue** — your App Store products aren't configured in the RevenueCat dashboard. That's not a code bug; it's a dashboard setup task.

---

## The Full Chain (How the Tour Should Work)

```
AppStateManager.tsx (auto-trigger)
  → appStore.ts startTour() sets tourMode=true
    → index.tsx renders <TourOrchestrator> when tourMode=true
      → TourOrchestrator seeds mock data, navigates tabs, measures targets
        → TourOverlay renders spotlight cutout + tooltip
```

### Trigger Condition (AppStateManager.tsx:304)
```typescript
if ((profile as any).coach_map_tour_status === null && !useAppStore.getState().tourMode) {
  hasRestoredPageRef.current = true;
  useAppStore.getState().startTour();
  return;
}
```

Requirements for tour to auto-start:
1. `user` is not null (authenticated)
2. `profile` is not null (loaded from Supabase)
3. `profile.has_completed_onboarding === true`
4. `profile.coach_map_tour_status === null` (never completed or skipped)
5. `tourMode` is currently false in Zustand store

---

## Bugs Found (Ordered by Severity)

### Bug #1 — CRASH: TourOverlay import crash (FIXED)
- **File:** `app-mobile/src/components/tour/TourOverlay.tsx:16`
- **What:** Imported `{ designSystem }` which doesn't exist. The design system exports individual constants (`radius`, `spacing`, etc.), not a bundled object.
- **Impact:** App crashes at module load time — nothing renders at all.
- **Status:** FIXED — replaced with correct named imports.

### Bug #2 — HIGH: `coach_map_tour_status` accessed via `(profile as any)` type cast
- **File:** `app-mobile/src/components/AppStateManager.tsx:304`
- **What:** The trigger uses `(profile as any).coach_map_tour_status` — a type cast that bypasses TypeScript. If the column isn't included in the Supabase profile query, this will be `undefined`, not `null`. In JavaScript, `undefined === null` is **false**, so the tour never triggers.
- **Impact:** Tour silently never starts for any user.
- **Root Cause Chain:** Need to verify that the profile query in the auth/profile loading code actually SELECTs `coach_map_tour_status`. If it uses `SELECT *`, it works. If it selects specific columns, it might be missing.
- **Verification needed:** Check the profile fetch query (likely in `appStore.ts` or a profile service).

### Bug #3 — HIGH: No timeout on target measurement polling
- **File:** `app-mobile/src/components/tour/TourOrchestrator.tsx:164-179`
- **What:** When the tour navigates to a new step, it polls every 200ms for the target element's layout. If the target component hasn't rendered (e.g., Preferences sheet isn't open, or the component is behind a loading state), polling continues **forever**.
- **Impact:** User sees a permanent dark overlay with no tooltip and no way to dismiss it. They're stuck.
- **Steps to reproduce:** Start tour → Step 1 tries to highlight `tour-target-preferences` → calls `setShowPreferences(true)` → if PreferencesSheet doesn't render fast enough or fails, user is stuck.

### Bug #4 — MEDIUM: `realtimeService.unsubscribeAll()` during tour
- **File:** `app-mobile/src/components/tour/TourOrchestrator.tsx:144`
- **What:** When tour starts, ALL Supabase realtime subscriptions are killed. This disconnects friend updates, message notifications, session changes, etc.
- **Impact:** During the tour (which could take minutes), no live data arrives. After tour completes, subscriptions may not be re-established until the user navigates away and back.
- **Side effect:** Other hooks that depend on realtime data may show stale or empty states.

### Bug #5 — MEDIUM: Tour state persists in Zustand but DB state doesn't
- **File:** `app-mobile/src/store/appStore.ts` (persist config)
- **What:** `tourMode` and `tourStep` are persisted to AsyncStorage. But `coach_map_tour_status` lives in the database. If the app crashes mid-tour:
  - Zustand rehydrates `tourMode=true` from storage
  - But the profile still has `coach_map_tour_status=null` (not yet written)
  - The TourOrchestrator renders, but `hasSeedRef` is false, so it re-seeds data
- **Impact:** Mostly benign — tour resumes from persisted step. But if the user completed the tour and the DB write succeeded but `completeTour()` (which sets `tourMode=false`) didn't persist, the tour re-triggers on next launch.

### Bug #6 — MEDIUM: Duplicate `tour-target-preferences` ID
- **Files:** Both `HomePage.tsx` and `PreferencesSheet.tsx` register `tour-target-preferences`
- **What:** TourTargetContext uses a `Map<string, TourTargetLayout>`. The last component to register wins.
- **Impact:** Step 1 might highlight the wrong element, or measure a now-unmounted component's position.

### Bug #7 — LOW: Fire-and-forget DB writes with no error handling
- **Files:** `TourOrchestrator.tsx:187-193`, `205-217`, `234-251`
- **What:** All three handlers (Next, Skip, Complete) write to `coach_mark_progress` and `profiles` using `.then(() => {})` — errors are swallowed.
- **Impact:** If DB writes fail (RLS error, network issue), the app thinks tour is done but the server disagrees. Next launch could re-trigger the tour.

### Bug #8 — LOW: `FadeOut` imported but unused
- **File:** `app-mobile/src/components/tour/TourOverlay.tsx:12`
- **What:** `FadeOut` is imported from `react-native-reanimated` but never used.
- **Impact:** No runtime effect, just dead code.

---

## Summary of Issues by Category

| Category | Bugs | Impact |
|----------|------|--------|
| App crash | #1 (FIXED) | App won't start at all |
| Tour never starts | #2 | Tour silently doesn't trigger |
| Tour gets stuck | #3 | Dark overlay forever, user trapped |
| Side effects | #4 | Realtime data stops during tour |
| State drift | #5, #7 | Tour re-triggers unexpectedly |
| Wrong highlight | #6 | Spotlight on wrong element |
| Dead code | #8 | Cosmetic |

---

## Recommended Fix Priority

1. **Bug #2** — Verify profile query includes `coach_map_tour_status`. Remove `(as any)` cast. Add proper typing.
2. **Bug #3** — Add a 5-second hard timeout on target measurement. If target isn't found, either skip that step or show a "skip" option.
3. **Bug #4** — Don't kill all realtime subscriptions. Either scope the unsubscribe or remove it entirely.
4. **Bug #5 + #7** — Add error handling on DB writes. Consider making `completeTour()` also clear Zustand persistence.
5. **Bug #6** — Use unique target IDs or ensure only one registers at a time.

---

## Files in the Chain (All Read)

| File | Role |
|------|------|
| `app-mobile/src/components/AppStateManager.tsx:298-308` | Auto-trigger logic |
| `app-mobile/src/store/appStore.ts` | Tour state (tourMode, tourStep, actions) |
| `app-mobile/app/index.tsx` | Renders TourOrchestrator conditionally |
| `app-mobile/src/components/tour/TourOrchestrator.tsx` | Step navigation, seeding, measurement |
| `app-mobile/src/components/tour/TourOverlay.tsx` | Spotlight UI + tooltip |
| `app-mobile/src/components/tour/TourTarget.tsx` | Target measurement wrapper |
| `app-mobile/src/contexts/TourTargetContext.tsx` | Target layout registry |
| `app-mobile/src/data/mockTourData.ts` | Mock data for tour steps |
| `app-mobile/src/components/ProfilePage.tsx` | "Replay Tips" button |
| `supabase/migrations/20260327000001_recreate_coach_mark_progress.sql` | DB schema |
