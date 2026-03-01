# Implementation Report: Preferences-Driven Card Filtering & Curated Experiences (All Types)
**Date:** 2026-02-28
**Status:** Complete
**Implementer:** Senior Engineer Skill

---

## What Was There Before

### Existing Files Modified
| File | Purpose Before Change |
|------|-----------------------|
| `app-mobile/src/services/experiencesService.ts` | UserPreferences interface missing custom_location, use_gps_location, experience_types |
| `app-mobile/src/components/PreferencesSheet.tsx` | Budget presets at $100/$200/$500; no GPS toggle state |
| `app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx` | LocationInputSection had no GPS toggle |
| `app-mobile/src/hooks/useUserLocation.ts` | Always used GPS; did not read use_gps_location flag |
| `app-mobile/src/hooks/useCuratedExperiences.ts` | Hard-coded to `'solo_adventure'` type only |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | One curated hook with underscore bug; experience_types never populated |
| `supabase/functions/generate-curated-experiences/index.ts` | Only solo-adventure pairings; early return for other types |
| `app-mobile/src/components/AppHandlers.tsx` | Did not save use_gps_location to DB |

### Pre-existing Behavior
- Budget presets were $100/$200/$500 (too high for casual use)
- Curated multi-stop cards were only wired for solo-adventure but NEVER actually fired due to two bugs:
  1. `'solo_adventure'` (underscore) was checked but stored IDs use hyphens (`'solo-adventure'`)
  2. `experienceTypes` was read from `userPrefs.experience_types` which does not exist in DB — categories array was never filtered for intent IDs
- No GPS toggle in Starting Location section — GPS was always used
- `useUserLocation` ignored `use_gps_location` field entirely
- Other experience types (romantic, first-dates, etc.) had no curated cards at all

---

## What Changed

### New Files Created
| File | Purpose |
|------|---------|
| `supabase/migrations/20260228000002_add_use_gps_location.sql` | Adds `use_gps_location BOOLEAN DEFAULT TRUE` to preferences table |

### Files Modified
| File | Change Summary |
|------|---------------|
| `app-mobile/src/services/experiencesService.ts` | Added `custom_location`, `use_gps_location`, `experience_types` to UserPreferences; typed travel_constraint_type as union |
| `app-mobile/src/components/PreferencesSheet.tsx` | Budget presets → $25/$50/$100/$150; added useGpsLocation + selectedCoords state; GPS toggle handler; passes use_gps_location + custom_location to onSave |
| `app-mobile/src/components/PreferencesSheet/PreferencesSectionsAdvanced.tsx` | Added Switch import; GPS toggle row + disabled input UI; new styles |
| `app-mobile/src/hooks/useUserLocation.ts` | Reads use_gps_location from React Query cache; respects flag; adds customLocation+useGpsFlag to query key |
| `app-mobile/src/hooks/useCuratedExperiences.ts` | Exported CuratedExperienceType union; updated interface to use it |
| `app-mobile/src/contexts/RecommendationsContext.tsx` | Added shuffleArray helper; fixed experienceTypes derivation (filter categories by INTENT_IDS); 5 unconditional hook calls with enabled gates |
| `supabase/functions/generate-curated-experiences/index.ts` | Added 4 new pairing arrays; PAIRINGS_BY_TYPE routing map; dynamic lookup replaces hard-coded solo; removed early return for other types; dynamic experienceType in card id |
| `app-mobile/src/components/AppHandlers.tsx` | Saves use_gps_location to DB; handles pre-computed custom_location from preferences; adds use_gps_location to React Query cache and offline cache |

### Database Changes
```sql
ALTER TABLE preferences
  ADD COLUMN IF NOT EXISTS use_gps_location BOOLEAN NOT NULL DEFAULT TRUE;
```

### Edge Functions
| Function | Change | Endpoint |
|----------|--------|----------|
| `generate-curated-experiences` | Modified — now supports all 5 experience types | POST /generate-curated-experiences |

### State Changes
- React Query: `['userLocation', userId, mode, refreshKey, customLocation, useGpsFlag]` — extended key
- React Query cache: `use_gps_location` now included in setQueryData
- 5 new React Query keys: `['curated-experiences', type, lat, lng, budgetMin, budgetMax]` for each type

---

## Implementation Details

### Architecture Decisions

**experienceTypes derivation fix (critical):** The DB `categories` column stores both intent IDs (`'solo-adventure'`) and category slugs (`'casual_eats'`) in one array. The old code read `userPrefs.experience_types` which never exists in the DB response — always returning `[]`. Fixed by filtering `userPrefs.categories` using a Set of known intent IDs.

**5 unconditional hook calls:** React rules of hooks prohibit conditional hook calls. All 5 `useCuratedExperiences` calls are at the top level and use the `enabled` flag to gate fetching. This is the correct pattern.

**GPS toggle approach:** When GPS is ON, `custom_location` is set to `null` in the DB. When OFF, coordinates from autocomplete (or geocoded address) are stored. `useUserLocation` reads `use_gps_location` from the React Query cache (already populated) to decide which location source to use, without an extra DB fetch.

**query key extension:** Added `customLocation` and `useGpsFlag` to the `userLocation` query key so changing location preferences triggers an automatic re-fetch without manual invalidation.

### New Pairing Types Added
- **first-dates:** botanical_garden/art_gallery/museum/park + wine bars/restaurants + creative activities
- **romantic:** botanical gardens/beach/park + fine dining/wine + spa/stargazing/hot springs
- **friendly:** bowling/escape room/hiking/mini golf + casual food + comedy/karaoke/bar
- **group-fun:** bowling/arcade/trampoline/laser tag + fast/buffet food + karaoke/comedy/bar

---

## Deployment Required
1. Run in Supabase Studio SQL editor:
```sql
ALTER TABLE preferences ADD COLUMN IF NOT EXISTS use_gps_location BOOLEAN NOT NULL DEFAULT TRUE;
```

2. Deploy edge function:
```
supabase functions deploy generate-curated-experiences
```

3. Hard-close and reopen the app to clear stale React Query cache (staleTime is 10min for curated cards).

---

## Success Criteria Verification
- [x] Budget presets $25/$50/$100/$150 — replaced in PreferencesSheet.tsx
- [x] GPS toggle in Starting Location — Switch component added, disables text field when ON
- [x] experienceTypes correctly derived from categories — INTENT_IDS filter in RecommendationsContext
- [x] Curated cards for all 5 experience types — 5 hook calls + edge function updated
- [x] use_gps_location saved to DB — AppHandlers updated
- [x] useUserLocation respects GPS toggle — flag read from React Query cache
- [x] TypeScript: UserPreferences interface updated with proper types
- [x] No as-any for custom_location/use_gps_location — now properly typed
