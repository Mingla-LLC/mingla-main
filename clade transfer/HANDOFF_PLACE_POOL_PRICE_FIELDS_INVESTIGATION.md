# Handoff — `place_pool` price fields investigation — Mac continuation

**Authored:** 2026-05-06 by mingla-forensics on Windows session
**Branch:** `Seth` (no commits made — pure investigation)
**Trigger question:** "we have price levels, price tiers, and price starts at and ends at on the place pool. what do all of these do and do they talk to each other?"
**Status:** Investigation complete. **Decision needed from you** — see §6.

---

## 1. Where we are right now (one paragraph)

You spotted four price-related columns on `place_pool` and asked what each one does and whether they coordinate. We traced every column from Google Places ingestion through seed/refresh edge functions, the backfill migrations, the `query_pool_cards` RPC chain (chronologically, latest-wins per the Migration Chain Rule), the rules engine RPCs, and the admin UI. **Headline finding: the four columns were designed to chain together, but only `price_level` is currently consumed by any read path. `price_tier` / `price_tiers` were stripped out of `query_pool_cards` on 2026-04-15 (ORCH-0434 Phase 9) and the user-side `preferences.price_tiers` column was dropped that same day. The new `price_range_*_cents` columns (added 2026-04-20) are write-only — no reader exists yet.** No code change was made. You said you wanted to think about whether to clean up the zombie columns or rewire them.

---

## 2. The four (technically six) columns

| Column | Type | Source | Written by | Read by |
|--------|------|--------|------------|---------|
| `price_level` | TEXT | Google Places `priceLevel` (verbatim) | seed, refresh | **Rules engine** (live) |
| `price_tier` | TEXT (legacy scalar) | Derived from `price_level` via `PRICE_LEVEL_MAP`, or from `primary_type` rules | seed, refresh, `admin_edit_place`, backfill migration | **Nothing** since 2026-04-15 |
| `price_tiers` | TEXT[] (current) | Same as `price_tier`. Always kept in sync as `[price_tier]` minimum | Same as above | **Nothing** since 2026-04-15 |
| `price_min` / `price_max` | INTEGER | Derived from `price_level` via `PRICE_LEVEL_MAP` | seed, refresh | **Nothing** since 2026-04-15 (was the `p_budget_max` filter) |
| `price_range_start_cents` | INTEGER | Google v1 `priceRange.startPrice.units * 100` | seed, refresh, place-search | **Nothing** (added 2026-04-20) |
| `price_range_end_cents` | INTEGER | Google v1 `priceRange.endPrice.units * 100` | Same | **Nothing** |
| `price_range_currency` | TEXT | Google v1 `priceRange.startPrice.currencyCode` | Same | **Nothing** |

---

## 3. The chain (how they're supposed to talk to each other)

**Write-time chain (still works):**

```
Google Places API response
   │
   ├─ priceLevel: "PRICE_LEVEL_EXPENSIVE"
   │     └─► place_pool.price_level (verbatim)
   │           └─► PRICE_LEVEL_MAP lookup in admin-seed-places/index.ts:248-253
   │                 ├─► place_pool.price_tier  = "bougie"
   │                 ├─► place_pool.price_tiers = ["bougie"]
   │                 ├─► place_pool.price_min   = (cents)
   │                 └─► place_pool.price_max   = (cents)
   │
   └─ priceRange: { startPrice: { units: "25", currencyCode: "USD" },
                    endPrice:   { units: "50", currencyCode: "USD" } }
         ├─► place_pool.price_range_start_cents = 2500
         ├─► place_pool.price_range_end_cents   = 5000
         └─► place_pool.price_range_currency    = "USD"
```

The two branches are independent at write time. The `priceRange` (cents) branch does **not** influence the tier mapping — that comes solely from the discrete `priceLevel` enum.

**Read-time reality (mostly broken):**

- `price_level` → consumed by the rules engine (`pp.price_level = ANY(v_price_levels)`) to auto-promote restaurants into `upscale_fine_dining` etc. **This is the only live consumer.**
- `price_tier` / `price_tiers` → **zero readers in `query_pool_cards`.** The `preferences.price_tiers` column has been dropped (you can't even pass a user budget into the query anymore).
- `price_min` / `price_max` → also unread (was the old `p_budget_max <= price_min` clause; gone).
- `price_range_*_cents` → no readers anywhere in `app-mobile/`, `mingla-admin/`, or any RPC.

---

## 4. Evidence (so you can replay on Mac)

### 4.1 Latest authoritative `query_pool_cards` definition

[supabase/migrations/20260416100000_orch0443_fix_category_slug_mismatch.sql](supabase/migrations/20260416100000_orch0443_fix_category_slug_mismatch.sql) — the LATEST `CREATE OR REPLACE FUNCTION public.query_pool_cards`, signature is:

```sql
query_pool_cards(
  p_user_id, p_categories, p_lat_min, p_lat_max, p_lng_min, p_lng_max,
  p_card_type, p_experience_type, p_exclude_card_ids, p_limit,
  p_exclude_place_ids, p_center_lat, p_center_lng, p_max_distance_km
)
```

Note: **no `p_price_tiers`, no `p_budget_max`**. The function body has zero references to `price_tier`, `price_tiers`, `price_level`, `price_min`, or `price_max`.

### 4.2 Where filtering was removed

[supabase/migrations/20260415200000_orch0434_phase9_cleanup.sql](supabase/migrations/20260415200000_orch0434_phase9_cleanup.sql) lines 153-157:

> `Removed p_budget_max and p_price_tiers deprecated params`

…and lines 322-332:

```sql
ALTER TABLE preferences
  DROP COLUMN IF EXISTS budget_min,
  DROP COLUMN IF EXISTS budget_max,
  DROP COLUMN IF EXISTS price_tiers, ...
```

That migration (2026-04-15) is the official end of price filtering on the user-budget side. Confirmed by [app-mobile/src/types/preferences.ts:8](app-mobile/src/types/preferences.ts#L8): *"ORCH-0434: Removed budget_min, budget_max, time_slot, price_tiers."*

### 4.3 Where `price_level` is still consumed

[supabase/migrations/20260420000002_seed_rules_engine_v1.sql:777](supabase/migrations/20260420000002_seed_rules_engine_v1.sql#L777) — rules-engine threshold rules use `price_levels` as proposed thresholds; the executor in [supabase/migrations/20260420000003_create_rules_engine_rpcs.sql:403-412](supabase/migrations/20260420000003_create_rules_engine_rpcs.sql#L403-L412) reads:

```sql
v_price_levels := ARRAY(SELECT jsonb_array_elements_text(...->'price_levels'));
... WHERE pp.price_level = ANY(v_price_levels)
```

This is the *only* surviving live read path from any of the six columns.

### 4.4 Where `price_range_*_cents` is written

[supabase/functions/admin-seed-places/index.ts:272-307](supabase/functions/admin-seed-places/index.ts#L272-L307) — extracts `priceRange.startPrice.units * 100` etc. and writes the cents columns. Same logic mirrored in `admin-refresh-places` and `admin-place-search`.

### 4.5 Where `price_range_*_cents` is read

Grepped the entire repo for `price_range_start_cents|price_range_end_cents|price_range_currency`. **Four files match. All four are writers** (the migration that added the columns, plus the three edge functions above). Zero readers.

### 4.6 Admin UI display (still shows the zombie columns)

[mingla-admin/src/pages/PlacePoolManagementPage.jsx](mingla-admin/src/pages/PlacePoolManagementPage.jsx):
- Line 534-535: shows `Price Tiers:` and `Price Level:` in the place detail card
- Line 1234-1237: filter dropdowns let admins filter places by `price_tiers` or `price_level`
- Line 408-409: edit form passes `p_price_tier` and `p_price_tiers` to `admin_edit_place` RPC

So admins can still manually edit tiers, and the edit cascades into `card_pool` via the [admin_edit_place RPC](supabase/migrations/20260401000009_fix_price_tier_overlap.sql#L382-L388) — but the result of that edit doesn't change what cards users see, because the user-facing query no longer filters on tier.

---

## 5. The PRICE_LEVEL_MAP (for completeness)

Defined in [admin-seed-places/index.ts](supabase/functions/admin-seed-places/index.ts) (search for `PRICE_LEVEL_MAP`). Mirrors the backfill migration [20260401000007_price_tiers_array_migration.sql](supabase/migrations/20260401000007_price_tiers_array_migration.sql):

| Google `price_level` | Mingla `price_tier` |
|----------------------|---------------------|
| `PRICE_LEVEL_FREE` | `chill` |
| `PRICE_LEVEL_INEXPENSIVE` | `chill` |
| `PRICE_LEVEL_MODERATE` | `comfy` |
| `PRICE_LEVEL_EXPENSIVE` | `bougie` |
| `PRICE_LEVEL_VERY_EXPENSIVE` | `lavish` |
| (null) | derived from `primary_type` (parks → chill, fine_dining → bougie/lavish, etc.) |

The 4 Mingla tiers are: `chill`, `comfy`, `bougie`, `lavish`.

---

## 6. Decision needed from you (this is the open question)

Three reasonable directions. Pick one before any code change:

### Option A — Leave as-is

- Zero risk, zero work
- Cost: ongoing storage + write cost on dead columns; admin UI keeps editing fields with no user-visible effect, which is misleading
- Probably fine if Phase 7 vibe filtering (ORCH-0550.3) is going to wire up `price_range_*_cents` and `price_tiers` again soon

### Option B — Cleanup spec (delete zombies)

- Drop `price_tier`, `price_tiers`, `price_min`, `price_max` columns from `place_pool` AND `card_pool`
- Drop the `p_price_tier` / `p_price_tiers` params from `admin_edit_place` RPC
- Remove the price filter UI + edit UI from `PlacePoolManagementPage.jsx`
- **Keep** `price_level` (live, used by rules engine)
- **Keep** `price_range_*_cents` (intentional future use per ORCH-0550.1 invariants)
- Recommended if vibe filtering won't reuse the tier system

### Option C — Rewire spec (bring tier filtering back)

- Re-add `p_price_tiers` to `query_pool_cards` (the OLD ORCH-0421 logic in [20260414100001_price_exempt_categories.sql](supabase/migrations/20260414100001_price_exempt_categories.sql) is a working reference — has price-exempt category bypass + NULL tolerance)
- Re-add a budget preference column to `preferences` (was dropped in Phase 9 — would need new migration)
- Wire the mobile preferences UI back to it
- Recommended only if you actually want users to filter by price band again

**The investigation does not pick one.** This is a product call: do you still want users to filter by budget, or is the rules-engine (`price_level` driving category promotion) considered enough?

---

## 7. Files touched in this session

**None.** Pure read-only investigation. Working tree is unchanged from the prior handoff (`HANDOFF_ORCH_0742_PHASE_2.md`). The git status visible at session start (door/scanners/GlassChrome/Sheet/TopSheet/currentBrandStore + the two artifact files + `clade transfer/`) is still the same.

---

## 8. To resume on Mac

1. Read this file + skim [HANDOFF_ORCH_0742_PHASE_2.md](clade%20transfer/HANDOFF_ORCH_0742_PHASE_2.md) so you have both threads loaded
2. Make the §6 decision (A / B / C)
3. If B or C: dispatch `mingla-forensics` in SPEC mode with the chosen direction; the investigation evidence in §4 is sufficient input — no re-investigation needed
4. If A: nothing to do; close the question

**Confidence on findings: High.** Migration Chain Rule applied — verified the *latest* `query_pool_cards` definition (2026-04-16) and the Phase 9 column drops (2026-04-15). Sub-agent findings were not used; every claim above was verified by direct file read.
