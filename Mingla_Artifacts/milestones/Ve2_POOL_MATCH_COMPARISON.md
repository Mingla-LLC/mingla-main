# Ve2 — Pool Match Comparison Flow

> **Track:** Track 2 — Physical venues
> **Duration:** 1 week
> **Depends on:** Ve1 (in TestFlight; physical brand schema + admin queue exist)
> **Status:** locked, not started

---

## 1. User Outcome

When the operator types a venue name that matches a row we already have in `place_pool` (our consumer-side database of seeded venues), a comparison card surfaces immediately: "We found Joe's Pizza at 123 Main St. Is this you?" Tap Yes and the wizard prefills every field — name, address, lat/lng, city, photos, category — with our existing Google-seeded data. They just accept or replace each field rather than typing from scratch.

The result is dramatically faster onboarding for venues we already know about. We seeded thousands of venues from Google for consumer use; this is the path most physical-venue claims should take.

---

## 2. Smoke Test

1. Sign in as new test account
2. Open brand creation sheet → type a known seeded venue name (use a real `place_pool` row from production, e.g., a well-known restaurant in NYC)
3. **As you type, real-time pool lookup runs** — debounced ~300ms
4. **Match card surfaces inline** showing the matched venue: name, address, primary photo, "Is this you?" CTA
5. Tap Yes
6. Land directly in the wizard (skip the persona / category fork — we already know it's physical + the category)
7. Wizard prefills every field: name, address, lat/lng/city/country, primary photos, category, hours (if we have them) — all from `place_pool`
8. Walk through accepting/editing each step
9. Submit
10. **Verify DB state:**
    ```sql
    SELECT id, name, place_pool_id, google_place_id, lat, lng, city
    FROM public.brands WHERE name = '<matched name>';
    -- Expect: place_pool_id NOT NULL, populated from place_pool row
    SELECT id, name FROM public.place_pool WHERE id = <place_pool_id_from_above>;
    -- Expect: matches
    ```
11. **Test duplicate prevention:** as a different account, try to claim the same `google_place_id`. Confirm both rows go to admin queue (admin arbitrates per project spec §8 DEC); UI doesn't block the second signup.

---

## 3. Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | Real-time pool lookup as user types in brand creation name field (debounced 300ms, min 3 chars) |
| 2 | New edge function `claim-search-pool` returns matching pool rows by name + optional location filter |
| 3 | Match card UI surfaces in-sheet with name + address + primary photo + "Is this you?" CTA |
| 4 | "Yes, this is me" → wizard prefilled with pool data |
| 5 | "No, different business" → falls through to no-match persona fork (Ve1's path) |
| 6 | "Skip — create from scratch" → same as no-match path with prefilled name |
| 7 | Prefilled fields are editable (operator can override any field) |
| 8 | Photos prefilled from `place_pool` photo references; operator can hide / replace / add |
| 9 | `brands.place_pool_id` populated on submission |
| 10 | `brands.google_place_id` inherited from `place_pool` row |
| 11 | Duplicate claims for same `google_place_id` allowed at signup; both queue for admin arbitration |
| 12 | RLS on `claim-search-pool` returns only public-safe pool fields (no internal scoring data) |

---

## 4. Files Touched

**New:**
- `mingla-business/src/services/poolSearchService.ts`
- `mingla-business/src/components/brand/PoolMatchCard.tsx`
- `mingla-business/src/components/brand/ComparisonWizard.tsx` (prefilled variant of Ve1's PhysicalVenueWizard, OR same component with prefill mode)
- `supabase/functions/claim-search-pool/index.ts`

**Modified:**
- `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` (debounced lookup as user types)
- `mingla-business/src/components/brand/PhysicalVenueWizard.tsx` (accepts prefill data)

---

## 5. Data Model Changes

No schema changes. Ve1 already added `place_pool_id` FK + `google_place_id` column.

The `claim-search-pool` edge function reads `place_pool` directly. RLS on `place_pool` must allow authenticated reads of public-safe fields (verify via project context — `place_pool` is consumer-side data, generally readable).

---

## 6. Dependencies

- Upstream: Ve1 (schema + admin queue + physical-venue wizard)
- Downstream: Ve3 (admin arbitration for duplicate claims uses the `google_place_id` linkage)

---

## 7. Regression Tests

1. No-match flow (Ve1's path) — must remain unchanged when query returns no pool rows
2. Pool search rate-limited — bursts of typing don't hammer the edge function (debounce + max 10 req/min)
3. Pool match found but operator picks "No" — falls through cleanly without leaving stale state
4. Pool data prefill — every field can be overridden by operator
5. Per memory `feedback_ai_categories_decommissioned.md` — DO NOT read `place_pool.seeding_category`, `ai_categories`, `ai_reason`, `ai_primary_identity`, `ai_confidence`, `ai_web_evidence`. These columns are DROPPED. Use the matview `admin_place_pool_mv.primary_category` if category derivation is needed.

---

## 8. Hard Guards

- Don't expose internal `place_pool` scoring fields to the business app (only public-safe fields)
- Don't reference any of the 6 decommissioned AI-categorization columns (would crash with "column does not exist")
- Don't auto-claim on pool match — always require explicit "Yes, this is me" tap
- Don't block second claim of same `google_place_id` — admin arbitrates
- Don't allow the pool search to bypass auth — authenticated calls only

---

## 9. Open Polish

- Pool search by location proximity (filter to user's current city) — defer; name-search is sufficient v1
- Pool search UX when there are 5+ matches (currently top 1; show list?)
- Photo prefill UX (operator-friendly bulk-hide vs per-photo accept/reject)
- Fuzzy matching threshold (exact vs fuzzy)

---

## 10. Pipeline Notes

**Seth-owned:** SPEC must specify the exact `place_pool` columns the edge function returns (public-safe whitelist) and the search algorithm (exact name vs trigram vs full-text).

**Taofeek-owned:** start with the edge function + a unit test that finds known pool rows. Then wire the UI. The debouncing in the name field is small but critical — copy the pattern from existing autocomplete inputs.
