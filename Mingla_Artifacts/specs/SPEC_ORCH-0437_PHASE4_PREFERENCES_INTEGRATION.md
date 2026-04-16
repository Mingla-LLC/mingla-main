# SPEC — ORCH-0437 Phase 4: Preferences Integration

**Author:** Mingla Forensics
**Date:** 2026-04-16
**Status:** Complete — ready for orchestrator review
**Depends on:** Investigation findings below

---

## Investigation Summary

### PreferencesSheet Save Flow — How It Works Today

The PreferencesSheet has **two completely separate save paths**:

**Solo mode** (no `sessionId` prop):
1. User taps "Apply" → `onClose()` fires immediately (sheet closes)
2. Fire-and-forget async: calls `onSave(preferences)` which maps to `handleSavePreferences` in AppHandlers.tsx
3. That function: updates local state, sets `queryClient.setQueryData(["userPreferences", userId], ...)` optimistically, then fire-and-forget writes to `preferences` table via `PreferencesService.updateUserPreferences`
4. **Critical:** No `invalidateQueries` call — deliberately avoided to prevent a race condition where stale DB data overwrites the optimistic cache

**Collab mode** (`sessionId` present):
1. Same "Apply" → `onClose()` → fire-and-forget pattern
2. Writes to `board_session_preferences` via `useBoardSession.updatePreferences`
3. Invalidates `['session-deck', sessionId]` to trigger deck regeneration

**Neither path touches `user_map_settings`.** Map settings are managed entirely by `useMapSettings` hook, which is independent of the PreferencesSheet.

### Key Finding: Leaderboard Settings Are Isolated from Deck Preferences

This is good news. The leaderboard settings (`is_discoverable`, `available_seats`, `visibility_level`, `activity_status`) have **zero overlap** with deck generation preferences (`categories`, `intents`, `travel_mode`, `location`, `date_option`). They live in a different table (`user_map_settings` via `useMapSettings`). The save paths don't intersect.

**This means:** Adding a Section 7 to the PreferencesSheet for leaderboard settings will NOT affect the solo deck, collab deck, or any existing preference pipeline — as long as we save leaderboard settings through `useMapSettings.updateSettings` (which writes to `user_map_settings`) and NOT through the existing `handleApplyPreferences` save flow.

### Phase 1-3 Audit Findings

| # | Finding | Classification | Severity |
|---|---------|---------------|----------|
| F-1 | `onOpenPreferences` callback in LeaderboardFeed is a no-op — DiscoverScreen doesn't receive this prop from index.tsx, and DiscoverScreenProps doesn't declare it | 🔴 Missing wiring | Blocks header tap |
| F-2 | LeaderboardProfileHeader passes `categories: settings ? [] : []` — always empty array regardless of settings | 🟡 Hidden flaw | Shows no categories on self-card |
| F-3 | `useLeaderboardPresence` hook filters out self (`row.user_id === user?.id`) in the enrichment step, but the initial query from Supabase may not return the user's own row at all (RLS "Users manage own presence" allows it, but the query filters `is_discoverable = true` which may be false for the current user) | 🟡 Hidden flaw | Self-card data may not load |
| F-4 | LeaderboardFeed references `profile?.avatar_url` and `profile?.display_name` from appStore user — these are optional fields that may be undefined for new users | 🟡 Hidden flaw | Potential undefined rendering |
| F-5 | The swipe wire-up in SwipeableCards calls `upsertPresence` only on right-swipe, but there's no initial presence registration when the user first opens the Discover tab | 🟠 Contributing factor | User invisible on leaderboard until first swipe |
| F-6 | The `accept-tag-along` edge function creates a collab session, but LeaderboardFeed's `onOpenSession` callback is undefined (never passed from DiscoverScreen) | 🟡 Hidden flaw | Match overlay CTA does nothing |
| F-7 | `useMapSettings` now has `is_discoverable` and `available_seats` in its query, but the PreferencesSheet does NOT read or write these fields | 🔵 Observation | Expected — Phase 4 will add this |

---

## Integration Spec

### Scope

Add leaderboard settings to the PreferencesSheet (Section 7) and wire the remaining callbacks. **No changes to the solo/collab deck pipeline.** No changes to existing sections 1-6. No changes to the `handleApplyPreferences` save flow.

### Non-Goals

- Modifying the solo deck generation pipeline
- Modifying the collab preference seeding
- Modifying `handleSavePreferences` in AppHandlers.tsx
- Modifying `useBoardSession.updatePreferences`
- Adding leaderboard settings to the collab mode PreferencesSheet

---

### Change 1: Add `onOpenPreferences` to DiscoverScreen

**Files:** `app-mobile/src/components/DiscoverScreen.tsx` + `app-mobile/app/index.tsx`

**DiscoverScreen.tsx:**
- Add `onOpenPreferences?: () => void` to `DiscoverScreenProps` interface (line ~332)
- Pass it to `<LeaderboardFeed onOpenPreferences={onOpenPreferences} />`

**index.tsx:**
- At line ~2003 where `<DiscoverScreen>` is rendered, add:
  ```tsx
  onOpenPreferences={() => {
    setShowPreferences(true);
  }}
  ```

**Risk:** Zero — additive prop, no existing behavior changed.

---

### Change 2: Add Section 7 to PreferencesSheet (Solo Mode Only)

**File:** `app-mobile/src/components/PreferencesSheet.tsx`

**Where:** After Section 6 (line ~1093), before `</KeyboardAwareScrollView>` (line ~1095).

**Condition:** Section 7 renders ONLY in solo mode (`!isCollaborationMode`). In collab mode, leaderboard settings are irrelevant — the user is already in a session.

**What to add:**

```
Section 7: "Near You Leaderboard"
├── Master toggle: "Appear on the leaderboard" (Switch)
│   └── When OFF: sub-controls hidden (LayoutAnimation collapse)
├── "Who sees you" selector (inline options, not dropdown)
│   └── Everyone | Friends | Friends of Friends | Paired | Nobody
├── "Your status" radio group
│   └── None | Exploring | Looking for Plans | Open to Meet | Busy | Custom [TextInput]
└── "Available seats" stepper (1-5)
    └── [-] [number] [+]
```

**State variables to add:**

| Variable | Type | Default | DB Column | Table |
|----------|------|---------|-----------|-------|
| `isDiscoverable` | `boolean` | `false` | `is_discoverable` | `user_map_settings` |
| `leaderboardVisibility` | `VisibilityLevel` | `'friends'` | `visibility_level` | `user_map_settings` |
| `leaderboardStatus` | `string \| null` | `null` | `activity_status` | `user_map_settings` |
| `availableSeats` | `number` | `1` | `available_seats` | `user_map_settings` |
| `customStatusText` | `string` | `''` | (transient UI state) | — |

**Loading initial values:**
- Read from `useMapSettings()` hook (already returns `is_discoverable`, `available_seats`, `visibility_level`, `activity_status`)
- In the existing `useEffect` that loads preferences (line ~282), add a block for leaderboard settings that reads from `mapSettings`
- Alternatively, call `useMapSettings()` directly in the PreferencesSheet component (simpler — avoids threading through usePreferencesData)

**Save flow (CRITICAL — completely separate from existing save paths):**

Leaderboard settings do NOT save through `handleApplyPreferences`. They save through `useMapSettings.updateSettings()`, which:
1. Optimistically updates the React Query cache `['map-settings', userId]`
2. Upserts to `user_map_settings` table
3. On error, rolls back the optimistic update and shows a toast

**When to save:** Inside the fire-and-forget IIFE in `handleApplyPreferences` (lines ~794-879), add a SEPARATE write block for leaderboard settings — ONLY if any leaderboard setting changed:

```typescript
// Inside the fire-and-forget IIFE, AFTER the solo/collab save:
if (!isCollaborationMode && leaderboardSettingsChanged) {
  try {
    await updateMapSettings({
      is_discoverable: isDiscoverable,
      visibility_level: leaderboardVisibility,
      activity_status: leaderboardStatus,
      available_seats: availableSeats,
    });
    // Also sync to leaderboard_presence (transient copy)
    if (isDiscoverable && locationLat && locationLng) {
      leaderboardService.upsertPresence({
        lat: locationLat,
        lng: locationLng,
        is_discoverable: isDiscoverable,
        visibility_level: leaderboardVisibility,
        activity_status: leaderboardStatus || undefined,
        available_seats: availableSeats,
        preference_categories: selectedCategories,
      }).catch((err) => console.warn('[PreferencesSheet] Presence sync failed:', err));
    }
  } catch (err) {
    console.warn('[PreferencesSheet] Leaderboard settings save failed:', err);
  }
}
```

**Why this is safe:**
- `updateMapSettings` writes to `user_map_settings` — a DIFFERENT table from `preferences` and `board_session_preferences`
- It uses a DIFFERENT query key (`['map-settings', userId]`) — no interference with `["userPreferences", userId]` or `['session-deck', sessionId]`
- The `upsertPresence` call is fire-and-forget — failure doesn't affect the sheet close
- It's inside the same IIFE but AFTER the existing save — if the existing save fails, this still runs (they're independent)

**What NOT to modify:**
- Do NOT add leaderboard fields to the `preferences` object passed to `onSave`
- Do NOT add `invalidateQueries` for `["userPreferences"]`
- Do NOT modify the collab path
- Do NOT modify `handleSavePreferences` in AppHandlers.tsx

---

### Change 3: Fix Self-Card Categories

**File:** `app-mobile/src/components/leaderboard/LeaderboardFeed.tsx`

Replace:
```tsx
categories={settings ? [] : []}
```

With:
```tsx
categories={myPresence?.preference_categories ?? []}
```

If `myPresence` is null (user hasn't swiped yet), fall back to the user's `preferences` categories. This requires reading from the preferences context or appStore.

---

### Change 4: Initial Presence Registration on Tab Open

**File:** `app-mobile/src/components/leaderboard/LeaderboardFeed.tsx`

Add a `useEffect` that fires when the component mounts (user opens Near You tab). If the user is discoverable and has location:

```typescript
useEffect(() => {
  if (userLocation && settings?.is_discoverable) {
    leaderboardService.upsertPresence({
      lat: userLocation.lat,
      lng: userLocation.lng,
      is_discoverable: true,
      visibility_level: settings.visibility_level,
      activity_status: settings.activity_status ?? undefined,
      available_seats: settings.available_seats,
    }).catch((err) => console.warn('[LeaderboardFeed] Initial presence registration failed:', err));
  }
}, [userLocation?.lat, userLocation?.lng, settings?.is_discoverable]);
```

This ensures the user appears on the leaderboard as soon as they open the Near You tab, not just after their first swipe.

---

### Change 5: Wire `onOpenSession` in DiscoverScreen

**Files:** `app-mobile/src/components/DiscoverScreen.tsx` + `app-mobile/app/index.tsx`

Pass a callback that navigates to the collab session when the match overlay CTA is tapped:

```tsx
<LeaderboardFeed
  userLocation={...}
  onOpenPreferences={onOpenPreferences}
  onOpenSession={(sessionId) => {
    // Navigate to session — use the existing session opening mechanism
    // This requires passing down the session opener from index.tsx
  }}
/>
```

The exact wiring depends on how sessions are currently opened from other contexts. Check `index.tsx` for how `SessionViewModal` is triggered.

---

### Change 6: Bump `sectionAnims` Array Size

**File:** `app-mobile/src/components/PreferencesSheet.tsx`

- Line ~229: `Array.from({ length: 6 }, ...)` → `Array.from({ length: 7 }, ...)`
- Line ~246: Add 7th delay value `420` to the delays array
- Wrap Section 7 in `<Animated.View style={[styles.section, { opacity: sectionAnims[6], ... }]}>`

---

### Change 7: Add Leaderboard Settings to `hasChanges` and `countChanges`

**File:** `app-mobile/src/components/PreferencesSheet.tsx`

In `hasChanges` (lines ~592-632), add comparisons for the 4 new state variables against their loaded values.

In `countChanges` (lines ~688-733), count changes to the leaderboard settings.

This ensures the "Apply" button shows the correct change count and is enabled/disabled properly.

---

## Animation Entry Fix

When Section 7 is the only section with changes (user only changed leaderboard settings), the existing `sectionAnims` stagger ensures it animates in naturally.

---

## Success Criteria

| # | Criterion |
|---|-----------|
| SC-1 | Tapping the LeaderboardProfileHeader opens the PreferencesSheet in solo mode |
| SC-2 | Section 7 appears in PreferencesSheet ONLY in solo mode (not in collab) |
| SC-3 | Section 7 shows all 4 controls (toggle, visibility, status, seats) |
| SC-4 | Changing leaderboard settings and tapping Apply writes to `user_map_settings` (NOT to `preferences`) |
| SC-5 | Changing leaderboard settings does NOT trigger deck regeneration (no `invalidateQueries` on `["userPreferences"]` or `['session-deck']`) |
| SC-6 | Changing leaderboard settings syncs to `leaderboard_presence` via `upsertPresence` (fire-and-forget) |
| SC-7 | Solo deck still works after the change — swipe, save, get new cards |
| SC-8 | Collab deck still works after the change — create session, set preferences, get cards |
| SC-9 | Opening the Near You tab registers the user on the leaderboard (if discoverable) |
| SC-10 | Self-profile header shows the user's preference categories (not empty array) |
| SC-11 | Match overlay CTA navigates to the collab session |
| SC-12 | Section 7 animates in with the same stagger pattern as sections 1-6 |

---

## Implementation Order

1. Add `onOpenPreferences` to `DiscoverScreenProps` + pass through to LeaderboardFeed
2. Pass `onOpenPreferences` from `index.tsx` to `DiscoverScreen`
3. Add Section 7 to PreferencesSheet (solo mode only) — UI + state + save flow
4. Bump `sectionAnims` array size + delays
5. Add leaderboard settings to `hasChanges` + `countChanges`
6. Fix self-card categories in LeaderboardFeed
7. Add initial presence registration `useEffect` in LeaderboardFeed
8. Wire `onOpenSession` callback through DiscoverScreen
9. TypeScript check
10. Manual verification: solo deck works, collab deck works, leaderboard settings save correctly

---

## Regression Prevention

**The #1 risk is accidentally adding leaderboard writes to the `preferences` or `board_session_preferences` save path.** To prevent this:

1. Leaderboard settings ALWAYS save through `useMapSettings.updateSettings()` — never through `onSave` or `updateBoardPreferences`
2. The Section 7 state variables are completely separate from existing state variables — no shared state
3. The Section 7 save block runs AFTER the existing save and is wrapped in its own try/catch — failure is isolated
4. Add a comment at the save point: `// ORCH-0437: Leaderboard settings save via useMapSettings — NEVER via onSave or board prefs`

**Files that MUST NOT be modified:**
- `AppHandlers.tsx` (`handleSavePreferences`)
- `preferencesService.ts`
- `useBoardSession.ts` (`updatePreferences`)
- `experienceGenerationService.ts`
- `generate-session-deck` edge function
- `discover-cards` edge function
