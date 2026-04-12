# Implementation Report: ORCH-0394 — Fix Collaboration Preferences Location Pipeline

**Date:** 2026-04-11
**Status:** Implemented, partially verified (needs device testing)
**Confidence:** HIGH

---

## Changes Summary

6 files changed, ~25 lines added, 3 lines modified.

### useSessionManagement.ts (Fix 1A)
**What it did before:** `buildSeedFromSoloPrefs` declared `custom_lat/custom_lng` as null defaults but never read them from the solo prefs object, even though `getUserPreferences` returns them via `select("*")`.
**What it does now:** Reads `custom_lat` and `custom_lng` from solo prefs using the same `soloAny` pattern as `use_gps_location` and `custom_location`.
**Why:** ORCH-0395 — coordinates must be seeded into collab prefs on session creation.
**Lines changed:** +6 (lines 122-127)

### collaborationInviteService.ts (Fix 1B)
**What it did before:** Invite acceptance seeded collab prefs from solo prefs but the SELECT and upsert both omitted `custom_lat` and `custom_lng`.
**What it does now:** SELECT includes `custom_lat, custom_lng`. Upsert includes `custom_lat: soloPrefs?.custom_lat ?? null, custom_lng: soloPrefs?.custom_lng ?? null`.
**Why:** ORCH-0395 — coordinates must be seeded on invite accept.
**Lines changed:** +2 fields in SELECT, +2 lines in upsert

### OnboardingFlow.tsx (Fix 1C)
**What it did before:** Backfill logic for existing collab sessions omitted `custom_lat` and `custom_lng` from both the SELECT and update payload.
**What it does now:** SELECT includes `custom_lat, custom_lng`. Update includes `custom_lat: soloPrefs.custom_lat ?? null, custom_lng: soloPrefs.custom_lng ?? null`.
**Why:** ORCH-0395 — backfill must include coordinates for pre-onboarding sessions.
**Lines changed:** +2 fields in SELECT, +2 lines in update

### PreferencesSheet.tsx (Fix 2)
**What it did before:** `hasChanges` returned `false` when `initialPreferences` was null. `countChanges` returned `0`.
**What it does now:** `hasChanges` returns `true` when `initialPreferences` is null (any form state counts as a change from nothing). `countChanges` returns `1`.
**Why:** ORCH-0396 — lock-in button must be enabled when creating preferences from scratch.
**Lines changed:** 2 lines modified (636, 712)

### generate-session-deck/index.ts (Fix 3)
**What it did before:** Solo prefs fallback only selected `use_gps_location, custom_location`. Only handled GPS users via `user_location_history`. Manual-location users had no fallback at all.
**What it does now:** Selects `use_gps_location, custom_location, custom_lat, custom_lng`. Checks direct coordinates first (works for both GPS and manual users), then falls back to `user_location_history` for GPS users without saved coords.
**Why:** ORCH-0397 + ORCH-0399 — edge function must resolve location for all user types.
**Lines changed:** +8 lines (restructured fallback logic)

### useBoardSession.ts (Fix 4)
**What it did before:** Used `.single()` for the collaboration_sessions query, which throws PGRST116 when the session is deleted. Error was uncaught at this level.
**What it does now:** Uses `.maybeSingle()` and checks for null result with a clean error message: "This session is no longer available."
**Why:** ORCH-0398 — deleted sessions should show a message, not crash.
**Lines changed:** 1 line modified + 6 lines added

---

## Verification Checklist

| Check | Status |
|-------|--------|
| `buildSeedFromSoloPrefs` returns `custom_lat` and `custom_lng` from solo prefs | PASS (grep confirms lines 122-126) |
| `collaborationInviteService.ts` SELECT includes `custom_lat, custom_lng` | PASS (grep confirms line 320) |
| `collaborationInviteService.ts` upsert includes `custom_lat, custom_lng` | PASS (grep confirms lines 345-346) |
| `OnboardingFlow.tsx` SELECT includes `custom_lat, custom_lng` | PASS (grep confirms line 1605) |
| `OnboardingFlow.tsx` update includes `custom_lat, custom_lng` | PASS (grep confirms lines 1626-1627) |
| `hasChanges` returns `true` when `initialPreferences` is null | PASS (grep confirms line 636) |
| `countChanges` returns `1` when `initialPreferences` is null | PASS (grep confirms line 712) |
| Edge function selects `custom_lat, custom_lng` from solo prefs | PASS (grep confirms line 322) |
| Edge function handles BOTH GPS users AND manual-location users in fallback | PASS (grep confirms lines 327-331) |
| `loadSession` uses `.maybeSingle()` and handles null result gracefully | PASS (grep confirms lines 100, 134) |
| Solo deck is completely untouched by these changes | PASS (no changes to deckService, discover-cards, or solo prefs loading) |

---

## Regression Surface

1. **Solo deck generation** — untouched, no regression risk
2. **Session creation flow** — `buildSeedFromSoloPrefs` now writes 2 more fields; could fail if DB column doesn't exist (it does — verified in migration `20250127000014`)
3. **Invite acceptance flow** — 2 more fields in upsert; same DB verification applies
4. **Onboarding completion** — backfill writes 2 more fields; same pattern as existing fields
5. **PreferencesSheet first open** — `hasChanges` now returns `true` on null initial; verify button enables correctly but doesn't auto-save

---

## Discoveries for Orchestrator

None. All changes are within spec scope.
