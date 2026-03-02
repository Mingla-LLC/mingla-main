# Implementation Report: Deck Pipeline Fix — Edge Function 500s, Curated TypeError, Legacy Categories
**Date:** 2026-03-01
**Status:** Complete (code changes) / Infrastructure action required (DB migration + deploy)
**Implementer:** Senior Engineer Skill

---

## What Was There Before

### Existing Files Modified
| File | Purpose Before Change | Lines Before |
|------|-----------------------|--------------|
| `app-mobile/src/services/deckService.ts` | Multi-pill parallel pipeline | ~489 lines |
| `app-mobile/src/services/curatedExperiencesService.ts` | Curated experience edge function client | ~58 lines |
| `supabase/functions/generate-curated-experiences/index.ts` | Curated experience generator edge function | ~1100+ lines |

### Pre-existing Behavior
- All 10 discover-* edge functions (nature, drink, first_meet, etc.) crashed with 500 `FunctionsHttpError`, returning 0 category cards
- The "romantic" curated pill crashed with `TypeError: Cannot read property 'includes' of undefined` because `session_id: undefined` serialized as `null` in JSON, causing the edge function to enter the session aggregation path with malformed data
- Other curated pills (adventurous, etc.) returned 0 cards because `generate-curated-experiences` depends on the same card pool infrastructure
- Legacy category "Play & Move" from pre-v2 preferences fell through `CATEGORY_PILL_MAP`, producing noise warnings and being misrouted as a curated filter
- Net result: users saw a permanent loading/empty state with 0 cards

---

## What Changed

### Files Modified
| File | Change Summary |
|------|---------------|
| `app-mobile/src/services/deckService.ts` | Added 10 legacy category name mappings to `CATEGORY_PILL_MAP` (Play & Move → play, Stroll → nature, Sip & Chill → drink, Dining → fine_dining, Screen & Relax → watch, Creative & Hands-On → creative_arts, plus `&`/`and` variants) |
| `app-mobile/src/services/curatedExperiencesService.ts` | Destructured `sessionId` and `selectedCategories` separately; only include `session_id` in body when truthy; only include `selectedCategories` when non-empty array; prevents `session_id: null` and `selectedCategories: undefined` from reaching edge function |
| `supabase/functions/generate-curated-experiences/index.ts` | Strengthened session_id guard from `if (session_id)` to `if (session_id && typeof session_id === 'string' && session_id.length > 0)`; added defensive null-check `!agg.experienceTypes ||` before `.includes()` call |

### Database Changes
**No new migrations.** The existing migration `supabase/migrations/20260301000002_card_pool_pipeline.sql` creates the required `place_pool`, `card_pool`, and `user_card_impressions` tables — but it **must be applied to production** if not already done.

### Edge Functions
| Function | Change | Re-deploy Required |
|----------|--------|--------------------|
| `generate-curated-experiences` | Defensive session_id + experienceTypes null checks | **Yes** |
| All `discover-*` functions | No code change — but need re-deploy to bundle shared modules | **Yes** |

---

## Implementation Details

### Architecture Decisions

1. **Client-side defense (curatedExperiencesService):** Rather than relying solely on the edge function to handle `null` gracefully, the client now omits `session_id` and `selectedCategories` entirely when they have no meaningful value. This is the correct contract: don't send fields you don't intend to use.

2. **Server-side defense (generate-curated-experiences):** Belt-and-suspenders approach — even if the client sends a bad `session_id`, the edge function now guards against it with a type+length check. The `experienceTypes` null-guard prevents the crash even if aggregation returns malformed data.

3. **Legacy category mappings:** All 6 old category names (Stroll, Sip & Chill, Dining, Screen & Relax, Creative & Hands-On, Play & Move) are mapped to their v2 equivalents, with both `&` and `and` variants since the `_` → space normalization in the lookup code already handles underscores.

---

## Infrastructure Actions Required

These are **not code changes** — they require Supabase dashboard/CLI access:

| # | Action | Command / Location | Why |
|---|--------|--------------------|-----|
| 1 | **Apply card pool migration** | `supabase db push` or paste `20260301000002_card_pool_pipeline.sql` in SQL Editor | Creates `place_pool`, `card_pool`, `user_card_impressions` tables — without these, ALL discover-* functions crash with 500 |
| 2 | **Verify env vars** | `supabase secrets list` or Dashboard → Edge Functions → Secrets | Confirm `GOOGLE_MAPS_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` are set |
| 3 | **Re-deploy ALL edge functions** | `supabase functions deploy` | Bundles `_shared/*.ts` modules with each function; also deploys the updated `generate-curated-experiences` |
| 4 | **Clean legacy DB data** (optional) | `UPDATE preferences SET categories = array_remove(categories, 'Play & Move') WHERE 'Play & Move' = ANY(categories);` (repeat for Stroll, Sip & Chill, Dining, Screen & Relax, Creative & Hands-On) | Removes legacy names at source; the code-side mapping handles stragglers |

---

## Test Results

| Test | Result | Notes |
|------|--------|-------|
| TypeScript compilation (deckService.ts) | Pass | Legacy mappings are valid Record entries |
| TypeScript compilation (curatedExperiencesService.ts) | Pass | Destructuring + conditional body build compiles cleanly |
| Edge function syntax (generate-curated-experiences) | Pass | Guard conditions are valid JS |
| RCA-2: romantic pill with undefined sessionId | Fixed | `session_id` omitted from body entirely; server-side guard added |
| RCA-4: "Play & Move" in preferences | Fixed | Maps to `play` pill via `CATEGORY_PILL_MAP` |
| RCA-1/RCA-3: Edge function 500s | **Requires infrastructure** | Code changes alone don't fix this — DB migration + deploy needed |

### Bugs Found and Fixed
1. **Bug:** `session_id: undefined` serialized as `null` in JSON body | **Root Cause:** `curatedExperiencesService` spread `sessionId` unconditionally via `...edgeParams` | **Fix:** Destructure separately, only include when truthy
2. **Bug:** `agg.experienceTypes.includes()` crashes on undefined | **Root Cause:** Session aggregation can return malformed `agg` when `session_id` is `null` | **Fix:** Added `!agg.experienceTypes ||` null-guard before `.includes()` call
3. **Bug:** "Play & Move" unrecognized category warning | **Root Cause:** Legacy category name not in `CATEGORY_PILL_MAP` | **Fix:** Added all 6 legacy names with `&`/`and` variants

---

## Success Criteria Verification
- [x] No `TypeError: Cannot read property 'includes' of undefined` — client omits null session_id; server guards against it
- [x] No `Unrecognized category: "Play & Move"` warning — legacy names mapped in CATEGORY_PILL_MAP
- [x] `selectedCategories: undefined` no longer sent to edge function — omitted when empty
- [ ] All discover-* edge functions return 200 — **requires DB migration + function deploy**
- [ ] `generate-curated-experiences` returns cards — **requires function deploy**
- [ ] Deck loads with >0 cards — **requires infrastructure actions above**
