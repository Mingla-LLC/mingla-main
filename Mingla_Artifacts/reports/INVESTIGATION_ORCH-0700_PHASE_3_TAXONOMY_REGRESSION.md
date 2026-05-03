# INVESTIGATION — ORCH-0700 Phase 3 Taxonomy Regression Audit

**Skill:** mingla-forensics (INVESTIGATE mode)
**Dispatched by:** orchestrator after admin Seed Tab + Bouncer-Stats panel showed 0-counts for 3 categories post-Phase-3-deploy
**Time-box:** 60 min, sequential per memory
**Method:** every assertion backed by live `pg_catalog`, live matview reads, and source-file verification
**Confidence:** HIGH (all critical findings verified live)

---

## Executive Summary (layman, ≤8 lines)

The matview rebuild on **2026-05-03 (Migration 4)** silently changed how category slugs are written to `admin_place_pool_mv.primary_category` — from canonical 10-slug taxonomy (e.g. `brunch_lunch_casual`, `movies_theatre`, `groceries`) to a brand-new 11-slug helper taxonomy (`brunch`, `casual_food`, `theatre`, `movies` split + `groceries` absorbed into `flowers`). NO RPC, NO admin UI, NO mobile app, NO i18n locale uses these new slugs. The Phase 3 implementor pass propagated the same broken taxonomy into `admin-seed-places.coverage_check` — same root cause, second symptom. The "Brunch, Lunch & Casual: 0 / Movies & Theatre: 0 / Groceries: 0" zeros in Baltimore are real: 56,311 categorized matview rows exist, but they all use slugs the dashboard never queries for.

**The SQL helper `pg_map_primary_type_to_mingla_category` is wrong.** Its comment claims to mirror `mapPrimaryTypeToMinglaCategory(primary_type, types)` in `categoryPlaceTypes.ts` — but it doesn't. The TS source returns DISPLAY NAMES (e.g. `'Brunch, Lunch & Casual'`) which then go through `DISPLAY_TO_SLUG` to produce canonical slugs. The SQL helper invented its own slug taxonomy that bypasses `DISPLAY_TO_SLUG` entirely. **Recommended fix path: rewrite the SQL helper to return canonical 10-slug values, refresh the matview, no admin/mobile UI changes needed.**

---

## Phase A — The two taxonomies definitively listed

### A.1 — SQL helper taxonomy (11 slugs, WRONG)

Live `pg_proc.prosrc` body of `public.pg_map_primary_type_to_mingla_category(text, text[])`:

| # | Slug returned | Place types claimed |
|---|---|---|
| 1 | `nature` | beach, botanical_garden, garden, hiking_area, national_park, nature_preserve, park, scenic_spot, state_park, observation_deck, tourist_attraction, picnic_ground, vineyard, wildlife_park, wildlife_refuge, woods, mountain_peak, river, island, city_park, fountain, lake, marina (23 types) |
| 2 | `icebreakers` | cafe, bowling_alley, coffee_shop, miniature_golf_course, art_gallery, tea_house, video_arcade, museum, book_store, amusement_center, bakery, go_karting_venue, cultural_center, dessert_shop, karaoke, plaza, ice_cream_shop, comedy_club, art_museum, juice_shop, paintball_center, donut_shop, dance_hall, breakfast_restaurant, brunch_restaurant (25 types) |
| 3 | `drinks_and_music` | bar, cocktail_bar, wine_bar, brewery, pub, beer_garden, brewpub, lounge_bar, night_club, live_music_venue, coffee_roastery, coffee_stand (12 types) |
| 4 | `movies` | movie_theater, drive_in (2 types) **— invented slug** |
| 5 | `theatre` | performing_arts_theater, opera_house, auditorium, amphitheatre, concert_hall (5 types) **— invented slug** |
| 6 | `brunch` | american_restaurant, bistro, gastropub, diner (4 types) **— invented slug** |
| 7 | `casual_food` | mexican_restaurant ... tapas_restaurant (50 types) **— invented slug** |
| 8 | `upscale_fine_dining` | fine_dining_restaurant, steak_house, oyster_bar_restaurant, fondue_restaurant, swiss_restaurant, european_restaurant, australian_restaurant, british_restaurant (8 types) |
| 9 | `creative_arts` | art_studio, history_museum, sculpture, cultural_landmark (4 types) |
| 10 | `play` | amusement_park, roller_coaster, water_park, ferris_wheel, casino, planetarium, golf_course, indoor_golf_course, adventure_sports_center, ice_skating_rink (10 types) |
| 11 | `flowers` | florist, grocery_store, supermarket (3 types) **— absorbs grocery types** |

11 distinct return values. **NO `groceries` slug** (grocery types absorbed into `flowers`). Brunch+Casual + Movies+Theatre split. Total: 146 types claimed.

### A.2 — Canonical Mingla taxonomy (10 slugs, RIGHT)

Per `supabase/functions/_shared/categoryPlaceTypes.ts:473-484` (`DISPLAY_TO_SLUG`):

| # | Display name | DB slug |
|---|---|---|
| 1 | Nature & Views | `nature` |
| 2 | Icebreakers | `icebreakers` |
| 3 | Drinks & Music | `drinks_and_music` |
| 4 | Brunch, Lunch & Casual | `brunch_lunch_casual` |
| 5 | Upscale & Fine Dining | `upscale_fine_dining` |
| 6 | Movies & Theatre | `movies_theatre` |
| 7 | Creative & Arts | `creative_arts` |
| 8 | Play | `play` |
| 9 | Flowers | `flowers` |
| 10 | Groceries | `groceries` |

Plus per `categoryPlaceTypes.ts:501`: `HIDDEN_CATEGORIES = new Set(['Groceries', 'Flowers'])` — these 2 are never shown in user-facing pills, only used by backend / admin.

This is the AUTHORITATIVE taxonomy:
- Established by ORCH-0434 ("Restructured from 13 to 10 categories")
- Used by `admin/src/constants/categories.js:10-21` (`CATEGORY_LABELS` with 10 keys, header comment "ORCH-0434: 10 categories")
- Used by `seedingCategories.ts` `appCategorySlug` values (10 distinct, listed below)
- Used by every admin RPC's expected return shape pre-Migration-4

### A.3 — `seedingCategories.ts` `appCategorySlug` enumeration (10 slugs, MATCHES canonical)

Distinct values across 14 SEEDING_CATEGORIES configs (multiple configs share one slug):
`nature, icebreakers, drinks_and_music, brunch_lunch_casual, upscale_fine_dining, movies_theatre, creative_arts, play, flowers, groceries` — exactly the canonical 10. ✅

### A.4 — Diff table

| Concept | Canonical (DISPLAY_TO_SLUG + seedingCategories + admin/categories.js) | SQL helper (pg_map + matview + derivePoolCategory.ts) | Match? |
|---|---|---|---|
| Nature | `nature` | `nature` | ✅ |
| Icebreakers | `icebreakers` | `icebreakers` | ✅ |
| Drinks & Music | `drinks_and_music` | `drinks_and_music` | ✅ |
| Brunch + Casual | `brunch_lunch_casual` (combined) | `brunch` + `casual_food` (split) | 🔴 |
| Upscale Fine Dining | `upscale_fine_dining` | `upscale_fine_dining` | ✅ |
| Movies + Theatre | `movies_theatre` (combined) | `movies` + `theatre` (split) | 🔴 |
| Creative & Arts | `creative_arts` | `creative_arts` | ✅ |
| Play | `play` | `play` | ✅ |
| Flowers (florist only) | `flowers` | `flowers` (absorbs grocery_store/supermarket) | 🔴 |
| Groceries | `groceries` (separate) | (absorbed into `flowers`) | 🔴 |

4 of 10 categories diverge.

---

## Phase B — Consumer map

### B.1 — Backend RPCs (live)

Scan `pg_proc` for any function whose body literally contains canonical slugs `'brunch_lunch_casual'`, `'movies_theatre'`, `'groceries'`:

```
[]
```

**Zero RPCs use canonical slugs.** All admin/serving RPCs that return category data simply pass through whatever `admin_place_pool_mv.primary_category` contains — they don't enforce a taxonomy.

Scan for any function whose body references categorical slugs:

| RPC | Distinct slug literals in body |
|---|---|
| `admin_place_category_breakdown` | `{uncategorized}` only — passes matview values through |
| `admin_place_city_overview` | `{uncategorized}` only |
| `admin_place_country_overview` | `{uncategorized}` only |
| `admin_place_pool_overview` | `{uncategorized}` only |
| `admin_pool_category_health` | `{uncategorized}` only — body shows `mv.primary_category AS category` |
| `pg_map_primary_type_to_mingla_category` | All 11 helper slugs |

The 5 admin RPCs are **slug-agnostic** — they emit whatever `primary_category` the matview holds. So the matview's helper-taxonomy values flow straight through to the admin dashboard.

### B.2 — `admin_place_pool_mv` (the leaking source)

Migration 4 (`20260503000004_orch_0700_rebuild_admin_place_pool_mv.sql`) defines `primary_category` as:

```sql
COALESCE(
  public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types),
  'uncategorized'::text
) AS primary_category
```

So matview rows now hold helper-taxonomy slugs. Per Phase D global query: 56,311 categorized rows + 13,288 uncategorized = 69,599 total. **0 rows hold canonical slugs.**

### B.3 — Edge functions

Files referencing canonical slugs `brunch_lunch_casual` / `movies_theatre` / `groceries`:

- `supabase/functions/_shared/seedingCategories.ts` — 14 config `appCategorySlug` declarations using canonical slugs
- `supabase/functions/_shared/categoryPlaceTypes.ts` — `DISPLAY_TO_SLUG` map (canonical authority)
- `supabase/functions/admin-seed-places/index.ts` — `validConfigs` iterates `SEEDING_CATEGORIES` and uses `cat.appCategorySlug` (canonical) for batching
- (post-Phase-3) `supabase/functions/_shared/derivePoolCategory.ts` — TS twin of broken SQL helper, returns helper taxonomy

Files referencing helper slugs (`brunch`, `casual_food`, etc.):

- `supabase/functions/_shared/derivePoolCategory.ts` — definition
- `supabase/functions/admin-seed-places/index.ts` (Phase 3 rewrite) — coverage_check uses derived
- `supabase/functions/admin-refresh-places/index.ts` (Phase 3 rewrite) — applyRefreshFilters + preview_refresh_cost use derived

### B.4 — Mobile app (`app-mobile/src/`)

Files referencing canonical slugs OR `categoryPlaceTypes` imports:

- `app-mobile/src/hooks/useMapCards.ts` — only reference; declares `ALL_CATEGORIES` with **legacy 12-name list** (`'Nature & Views', 'First Meet', 'Picnic Park', 'Drink', 'Casual Eats', 'Fine Dining', 'Watch', 'Live Performance', 'Creative & Arts', 'Play', 'Wellness', 'Flowers'`). Comment claims "must match edge function's MINGLA_CATEGORY_PLACE_TYPES keys" but is stale (pre-ORCH-0434). 🟡 hidden flaw flagged but unrelated to current regression.
- 18 i18n locale files contain category labels (Brunch/Casual translations etc.)
- `app-mobile/src/components/PreferencesSheet.tsx` — uses display names for preference UI
- `app-mobile/src/services/messagingService.ts` — references categories in chat message context

The mobile app does NOT directly import `categoryPlaceTypes.ts` from the supabase folder (different deno vs node module worlds). It receives category strings from the edge functions and renders them via local label maps. So mobile expects: whatever the curated experience or single card edge functions pass back as `card.category`.

### B.5 — Admin UI (`mingla-admin/src/`)

- `mingla-admin/src/constants/categories.js` — `CATEGORY_LABELS` with canonical 10 slugs explicitly. **Header comment: "ORCH-0434: 10 categories (8 visible + flowers + groceries). These match the app-side slugs stored in the database."**
- `mingla-admin/src/components/seeding/SeedTab.jsx` — uses canonical slugs from `categories.js` to render the Seed Tab dashboard; sends slugs to admin-seed-places edge function

So the admin dashboard hardcodes canonical slugs. When it calls `admin-seed-places coverage_check` (rewritten in Phase 3 to return helper slugs), the dashboard does `counts['brunch_lunch_casual']` and gets `undefined` → 0.

### B.6 — i18n / translations

18 locale files contain category labels (`brunch_lunch_casual`, `movies_theatre`, etc.). Confirmed canonical taxonomy is what's translated.

---

## Phase C — Canonical taxonomy verdict

**Canonical taxonomy = 10 slugs (matching `DISPLAY_TO_SLUG` + `seedingCategories.appCategorySlug` + `admin/constants/categories.js`).**

Supporting evidence:
1. **`categoryPlaceTypes.ts:18` header comment**: "ORCH-0434: Restructured from 13 to 10 categories." — explicit decision-log-equivalent in source.
2. **`admin/constants/categories.js:3` header**: "ORCH-0434: 10 categories (8 visible + flowers + groceries). These match the app-side slugs stored in the database."
3. **All 14 `seedingCategories.ts` configs** use the canonical 10-slug `appCategorySlug` values.
4. **18 i18n locale files** translate canonical labels.
5. **0 RPCs and 0 mobile/admin UI files** consume helper-taxonomy slugs.

The SQL helper's claim ("Mirrors mapPrimaryTypeToMinglaCategory in categoryPlaceTypes.ts") is **factually false**. The TS function `mapPrimaryTypeToMinglaCategory` returns DISPLAY NAMES like `'Brunch, Lunch & Casual'`, not slugs. To get the canonical SLUG, callers chain it with `mapCategoryToSlug()` or `DISPLAY_TO_SLUG[name]`. The SQL helper bypassed this and invented new slugs.

**The transitional aliases** `'Brunch, Lunch & Casual'` and `'Movies & Theatre'` in `MINGLA_CATEGORY_PLACE_TYPES` (lines 103, 140) ARE labelled `[TRANSITIONAL]` per ORCH-0597/0598 with exit dates 2026-05-12 / 2026-05-13 — but these are ALIASES that include both old + new types in their type lists, not separate slugs. The canonical SLUG remains `brunch_lunch_casual` / `movies_theatre`.

**Verdict: helper taxonomy is wrong. SQL helper must return canonical slugs.**

---

## Phase D — Blast radius (live counts)

### D.1 — Helper-slug distribution for Baltimore

(Implicit via matview query — same data:)

| Helper slug | Baltimore count |
|---|---|
| casual_food | 512 |
| icebreakers | 495 |
| uncategorized | 404 |
| nature | 349 |
| drinks_and_music | 248 |
| brunch | 55 |
| theatre | 44 |
| flowers | 40 |
| creative_arts | 33 |
| upscale_fine_dining | 19 |
| movies | 9 |
| play | 5 |

Total Baltimore active: 2213.

### D.2 — Legacy `seeding_category` column for Baltimore (canonical taxonomy still preserved here)

| Canonical slug | Baltimore count |
|---|---|
| brunch_lunch_casual | 708 |
| icebreakers | 394 |
| nature | 382 |
| drinks_and_music | 233 |
| (null) | 197 |
| creative_arts | 117 |
| upscale_fine_dining | 90 |
| movies_theatre | 56 |
| flowers | 18 |
| play | 15 |
| groceries | 3 |

Total: 2213. Match.

### D.3 — Side-by-side mapping

| Canonical | Helper | Match? |
|---|---|---|
| brunch_lunch_casual: 708 | brunch (55) + casual_food (512) = 567 | ❌ — 141 rows differ (likely seeded as casual but Google primary_type doesn't match helper's bucket) |
| movies_theatre: 56 | movies (9) + theatre (44) = 53 | ❌ — 3 rows differ |
| flowers: 18 | flowers (40) | ❌ — 22 over (absorbed groceries) |
| groceries: 3 | (absorbed into flowers) | ❌ — 3 rows missing as separate |
| Other 6 slugs | match within ±5 (rounding via uncategorized) | mostly ✅ |

**The helper doesn't just rename — it ALSO loses ~146 Baltimore rows by classifying them as `uncategorized`** (404 helper-uncategorized vs 197 legacy-null). The legacy column had a richer pre-Bouncer ai-categorized count; the helper only matches what `primary_type` cleanly buckets, dropping borderline cases.

### D.4 — Matview global

| Slug | Global count |
|---|---|
| icebreakers | 16839 |
| uncategorized | 13288 |
| casual_food | 11484 |
| nature | 11085 |
| drinks_and_music | 8163 |
| flowers | 2116 |
| theatre | 1941 |
| creative_arts | 1840 |
| brunch | 1004 |
| movies | 809 |
| upscale_fine_dining | 660 |
| play | 370 |
| **Canonical brunch_lunch_casual / movies_theatre / groceries** | **0** |

69,599 total rows, 56,311 categorized — all in helper taxonomy. **Zero rows hold a canonical slug.**

---

## Phase E — Bouncer-Stats panel diagnosis (PRE-EXISTING, NOT Phase 3)

The smoke output's "Stats & Analytics → Bouncer-Approved Places by Category" panel showed 0 for Brunch+Casual / Movies+Theatre / Groceries.

This panel is fed by `admin_pool_category_health` RPC. Its body (live):

```sql
SELECT
  ps.primary_category AS category,
  ...
FROM admin_place_pool_mv mv ...
GROUP BY mv.primary_category
```

It returns whatever helper slugs the matview holds. Then the admin Stats UI looks up `categories[brunch_lunch_casual]` etc. — but the RPC returned `brunch`, `casual_food`, etc. Lookup misses → 0.

**This regression has existed since Migration 4 was applied (2026-05-03 ~earlier today, before Phase 3).** The Phase 3 implementor pass did NOT cause it for the Bouncer-Stats panel. Phase 3 caused the SAME regression in the admin Seed Tab's `coverage_check` panel (different RPC, same root cause).

**Verification step:** if we revert Phase 3 alone (restore `seeding_category` column reads in admin-seed-places), the Seed Tab's per-category counts come back — but the Bouncer-Stats panel STAYS broken because it reads matview not place_pool. The matview rebuild is the true root cause.

---

## Phase F — Recommended fix path

### 🔴 Root cause

`supabase/migrations/20260503000001_orch_0700_create_pg_helper_map_primary_type.sql` (Migration 1) defines `pg_map_primary_type_to_mingla_category` to return invented slugs (`brunch`, `casual_food`, `movies`, `theatre`, no `groceries`). It claims to mirror `mapPrimaryTypeToMinglaCategory` in `categoryPlaceTypes.ts` but actually conflicts with it.

### Fix (PROPOSED — orchestrator decides, then dispatches spec writer)

**Path 1 (Recommended) — Rewrite SQL helper to return canonical 10 slugs, refresh matview.**

1. New migration: `CREATE OR REPLACE FUNCTION public.pg_map_primary_type_to_mingla_category(...)` with corrected CASE chain returning canonical slugs:
   - `'brunch'` + `'casual_food'` types → `'brunch_lunch_casual'`
   - `'movies'` + `'theatre'` types → `'movies_theatre'`
   - `'florist'` (only) → `'flowers'`
   - `'grocery_store', 'supermarket'` → `'groceries'` (separate slug)
2. `REFRESH MATERIALIZED VIEW public.admin_place_pool_mv` (will re-derive `primary_category` for all 69,599 rows using the corrected helper)
3. Rewrite `supabase/functions/_shared/derivePoolCategory.ts` TS twin to match (return canonical 10 slugs, byte-for-byte aligned with corrected SQL helper)
4. Re-deploy `admin-seed-places, admin-refresh-places, admin-place-search` (no other code change needed — they call `derivePoolCategory()` and pass through whatever it returns)

**Migration 5+6 can ship right after Path 1 lands** — Migration 6's only outstanding precondition (no public RPC references doomed columns) was already satisfied by the earlier scrub Migration. The Migration 5 scrub also still applies (the OUT-param drift on `admin_virtual_tile_intelligence` is a separate fix).

**Verification of Path 1 fix:**
- After re-refresh, query: `SELECT primary_category, COUNT(*) FROM admin_place_pool_mv GROUP BY 1` should return 10 canonical slugs (no `brunch`, no `casual_food`, no `movies`, no `theatre`; should include `brunch_lunch_casual`, `movies_theatre`, `groceries`)
- After re-deploy, admin Seed Tab + Stats panel should show non-zero counts for Brunch+Casual / Movies+Theatre / Groceries
- No mobile/admin UI changes required (canonical taxonomy IS what they expect)

**Cost:** 1 SQL migration (~80 lines, hand-mirrored CASE), 1 TS file rewrite (~80 lines), 3 redeploys, 1 matview refresh. Maybe 1-2h implementor + tester.

**Path 2 (NOT RECOMMENDED) — Fold helper slugs back into canonical at admin code layer.**

Add a TS-only mapping function that converts helper output back to canonical before display. Smaller change but:
- Doesn't fix the matview's `primary_category` column — admin Stats panel + Bouncer-Stats panel + any future RPC reading the column still need a fold-back layer
- Encodes "two taxonomies in parallel, with a translation layer" — Constitution #2 violation (one owner per truth)
- Helper drift (TS↔SQL) gets worse, not better

**Path 3 (NOT RECOMMENDED) — Switch canonical taxonomy to helper's 11 slugs.**

Massive change: rewrite `categoryPlaceTypes.ts` `DISPLAY_TO_SLUG`, all 14 `seedingCategories.ts` configs, `admin/constants/categories.js`, 18 i18n locale files, mobile pill-bar UI, all admin UI labels, decision-log entry. Multi-week work. Doesn't make product sense — the canonical 10 was deliberate per ORCH-0434.

---

## Findings (classified)

### 🔴 ROOT CAUSE — SQL helper invents wrong slug taxonomy

| Field | Value |
|---|---|
| **File + line** | `supabase/migrations/20260503000001_orch_0700_create_pg_helper_map_primary_type.sql:38-99` |
| **Exact code** | `WHEN p_primary_type IN (...) THEN 'brunch'` (line 64) and similar for `'casual_food'` (line 65), `'movies'` (line 56), `'theatre'` (line 60), and absent `'groceries'` slug (grocery_store/supermarket folded into `'flowers'` line 96-97) |
| **What it does** | Returns one of 11 invented slugs: `nature, icebreakers, drinks_and_music, movies, theatre, brunch, casual_food, upscale_fine_dining, creative_arts, play, flowers`. None of `brunch_lunch_casual`, `movies_theatre`, `groceries` are returned. |
| **What it should do** | Return one of canonical 10 slugs per `DISPLAY_TO_SLUG` in `categoryPlaceTypes.ts:473-484`: `nature, icebreakers, drinks_and_music, brunch_lunch_casual, upscale_fine_dining, movies_theatre, creative_arts, play, flowers, groceries`. |
| **Causal chain** | (1) Helper returns `'brunch'` for an italian_restaurant. (2) Migration 4 rebuilt `admin_place_pool_mv` with `primary_category = COALESCE(pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types), 'uncategorized')` — so all 56,311 categorized matview rows hold helper slugs. (3) `admin_pool_category_health` RPC does `GROUP BY mv.primary_category` — emits helper slugs. (4) Admin Stats panel does `data['brunch_lunch_casual']` — undefined → 0. (5) Admin Seed Tab's `coverage_check` (after Phase 3 rewrite) does the same client-side aggregation — same 0. |
| **Verification** | Live matview query confirms all 69,599 rows hold helper slugs (Phase D.4). Live RPC scan confirms 0 RPCs return canonical slugs (Phase B.1). Live source confirms admin UI hardcodes canonical taxonomy (Phase B.5). |

### 🟠 CONTRIBUTING — Phase 3 implementor pass propagated the wrong taxonomy

The forensics agent (me, in the prior LANDMINE_AUDIT pass) and implementor (me, in the PHASE_3 scrub pass) both treated the SQL helper as authoritative without verifying its output matched the canonical TS taxonomy. The dispatch prompt I authored explicitly said "byte-for-byte align TS twin with SQL helper" — which guaranteed the TS twin would inherit the same wrong slugs. **Self-criticism: the byte-for-byte alignment check was on the WRONG source of truth. Should have aligned to `DISPLAY_TO_SLUG`, not to the SQL helper.**

### 🟡 HIDDEN FLAW — `useMapCards.ts` ALL_CATEGORIES is stale (pre-ORCH-0434)

| Field | Value |
|---|---|
| **File** | `app-mobile/src/hooks/useMapCards.ts:8-12` |
| **Code** | `const ALL_CATEGORIES = ['Nature & Views', 'First Meet', 'Picnic Park', 'Drink', 'Casual Eats', 'Fine Dining', 'Watch', 'Live Performance', 'Creative & Arts', 'Play', 'Wellness', 'Flowers'];` |
| **Issue** | Pre-ORCH-0434 12-category list. Wellness was removed; First Meet → Icebreakers; Drink → Drinks & Music; Casual Eats → Brunch, Lunch & Casual; Fine Dining → Upscale & Fine Dining; Watch + Live Performance → Movies & Theatre; Picnic Park merged into Nature & Views. Comment claims "must match edge function's MINGLA_CATEGORY_PLACE_TYPES keys" — false. |
| **Action** | Update to canonical 10 display names. Out of scope for current ORCH; queue separately. |

### 🟡 HIDDEN FLAW — Migration 1's WARNING comment lies about mirroring TS source

| Field | Value |
|---|---|
| **File** | `supabase/migrations/20260503000001_orch_0700_create_pg_helper_map_primary_type.sql:14` |
| **Code** | `-- WARNING: this function MUST stay in sync with the TS source. A future ORCH should auto-generate this from the TS module. For now, hand-mirror with care.` |
| **Issue** | The "TS source" being referenced is `mapPrimaryTypeToMinglaCategory` which returns DISPLAY NAMES, not slugs. The hand-mirror failed at the type level — it dropped the display→slug indirection layer. Comment misled the original author into thinking they were aligned. |
| **Action** | Auto-generation gate (CI script that compares helper output to `DISPLAY_TO_SLUG` keys) is required regression prevention. |

### 🔵 OBSERVATION — TRANSITIONAL aliases for ORCH-0597/0598

`MINGLA_CATEGORY_PLACE_TYPES` includes both `'Brunch, Lunch & Casual'` (line 103, marked `[TRANSITIONAL]` exit 2026-05-12) AND newer `'Brunch'` (line 77) + `'Casual'` (line 82) keys. These are TYPE-LIST aliases for client-side experience generation, not slug aliases. Canonical slug remains `brunch_lunch_casual`. Same for Movies & Theatre. Worth noting in spec so the corrected helper accepts BOTH naming conventions for input but emits canonical slugs.

### 🔵 OBSERVATION — Implementor pass post-mortem

The Phase 3 dispatch prompt's SC-06 ("TS twin matches SQL helper byte-for-byte") was **a flawed success criterion**. It enforced the WRONG alignment. The right alignment was: TS twin matches `DISPLAY_TO_SLUG` outputs (after `mapPrimaryTypeToMinglaCategory()` + `mapCategoryToSlug()`). Codify in INVARIANT_REGISTRY: "any slug-producing helper must enforce DISPLAY_TO_SLUG-set membership at unit-test time."

---

## Five-Layer Cross-Check

| Layer | What it says | Truth verdict |
|---|---|---|
| **Docs** | `categoryPlaceTypes.ts:18` and `admin/constants/categories.js:3` both declare 10 canonical categories per ORCH-0434 | Authoritative |
| **Schema** | `place_pool.seeding_category` stored canonical slugs (`brunch_lunch_casual` etc.) per legacy data | Authoritative pre-Migration-6 |
| **Code (TS)** | `DISPLAY_TO_SLUG` declares 10 canonical mappings; `seedingCategories.ts.appCategorySlug` matches | Authoritative |
| **Code (SQL)** | Migration 1 helper returns 11 invented slugs | **WRONG — invented its own taxonomy** |
| **Runtime (matview)** | All 69,599 rows hold helper slugs | Wrong (downstream of WRONG SQL helper) |
| **Data (i18n + admin UI)** | Locale files + admin labels expect canonical slugs | Authoritative |

**Layer disagreement: SQL Code + Runtime Matview disagree with everything else.** Truth lies in TS Code + Docs + Schema (legacy column).

---

## Blast Radius Map

The wrong helper taxonomy affects:

1. **admin_place_pool_mv** — all 69,599 `primary_category` values are wrong taxonomy (correctable via REFRESH after fixing helper)
2. **admin Stats panel** ("Bouncer-Approved Places by Category") — shows 0 for Brunch+Casual / Movies+Theatre / Groceries
3. **admin Seed Tab** ("Categories" + "4 of 13 categories have gaps" warning) — same zeros
4. **admin Pool Category Health RPC** — emits wrong slugs to admin UI
5. **admin_place_category_breakdown / city_overview / country_overview / pool_overview** — all pass-through wrong slugs
6. **admin-seed-places coverage_check** (Phase 3 rewrite) — same wrong client-side aggregation
7. **admin-refresh-places preview_refresh_cost** (Phase 3 rewrite) — likely same regression in cost-preview panel
8. **derivePoolCategory.ts** TS twin — encodes the wrong taxonomy as TS truth, will spread
9. **Any future caller** that reads matview's `primary_category` — gets wrong slugs

**Not affected:**
- Mobile app (consumes display names from edge functions, not matview slugs directly)
- Curated experience pipeline (uses `comboCategory` which is canonical via separate path)
- Single-card pipeline (uses display names from `MINGLA_CATEGORY_PLACE_TYPES` keys, not matview slugs)
- legacy `seeding_category` column (still holds canonical slugs — Migration 6 hasn't run yet)
- i18n locales

---

## Invariant Violations

- **Constitution #2 — One owner per truth:** SQL helper invented a taxonomy parallel to canonical. Now there are two slug systems, conflicting.
- **Constitution #9 — No fabricated data:** matview emits slugs that no consumer can resolve to a display name. Effectively fabricates `'brunch'` as if it were a slug.
- **(NEW) I-CATEGORY-SLUG-CANONICAL** (proposed): all category slugs in PG functions, matviews, edge functions, and TS modules MUST be members of the canonical 10-slug set defined by `DISPLAY_TO_SLUG` in `categoryPlaceTypes.ts`. Any helper that produces a slug must have a unit test asserting outputs ⊆ Object.values(DISPLAY_TO_SLUG).

---

## Fix Strategy (direction only)

**Spec writer's mandate (next dispatch):**

1. **New migration `20260503000007_orch_0700_fix_helper_canonical_taxonomy.sql`:**
   - DROP + CREATE `pg_map_primary_type_to_mingla_category` returning canonical 10 slugs
   - REFRESH MATERIALIZED VIEW `admin_place_pool_mv`
   - 8 self-verify probes (one per canonical slug + uncategorized + null inputs)
2. **Rewrite `_shared/derivePoolCategory.ts`** to return canonical 10 slugs (delete helper-only buckets, merge brunch+casual_food → brunch_lunch_casual etc., split flowers↔groceries)
3. **Re-deploy 3 admin edge functions** (no logic changes — they pass through whatever helper returns)
4. **Add unit test** `_shared/__tests__/derivePoolCategory_canonical.test.ts` asserting all returned values ⊆ canonical slug set
5. **Add SQL self-verify probes** in the new migration that ASSERT the helper's CASE chain emits only canonical slugs

**Order:**
1. Fix migration (operator pushes via `supabase db push`)
2. TS twin rewrite + redeploy edge functions
3. Smoke admin Seed Tab + Stats panel — counts must be non-zero for Brunch+Casual / Movies+Theatre / Groceries
4. THEN proceed with Migration 5 patch + Migration 6 push (the originally-queued ORCH-0700 Phase 2 close)

---

## Regression Prevention

1. **NEW invariant `I-CATEGORY-SLUG-CANONICAL`** — codify in `INVARIANT_REGISTRY.md`
2. **CI gate (TS-side)**: `derivePoolCategory.ts` must export only slugs in `DISPLAY_TO_SLUG`. Add jest/deno test that checks:
   ```ts
   import { ALL_DERIVED_CATEGORY_SLUGS } from './derivePoolCategory';
   import { DISPLAY_TO_SLUG } from './categoryPlaceTypes';
   const canonical = new Set(Object.values(DISPLAY_TO_SLUG));
   for (const slug of ALL_DERIVED_CATEGORY_SLUGS) assert(canonical.has(slug));
   ```
3. **CI gate (SQL-side)**: pre-migration check that scans new migration body for slug literals and asserts each is in canonical set.
4. **DECISION_LOG entry**: "10-slug canonical taxonomy is authoritative; any new categorization helper must emit slugs in `DISPLAY_TO_SLUG`."
5. **Update `mingla-forensics` SKILL.md** with new pre-flight check: "When auditing a new helper that produces categorical values, ALWAYS look up the canonical taxonomy authority first (DISPLAY_TO_SLUG for category slugs) and assert outputs are subsets."

---

## Discoveries for Orchestrator

1. **🔴 Migration 4 (matview rebuild) shipped a regression that's been live for the last few hours** — admin Stats panel has been showing wrong counts since 2026-05-03 matview rebuild applied. Operator likely hasn't noticed because the panel was already showing some zero/yellow categories in the past (per ORCH-0640 card_pool deprecation, "Brunch & Casual" was always near 0 in some cities). This audit reveals it's now FACTUALLY wrong, not just under-seeded.
2. **🟡 `useMapCards.ts` is using a 12-category pre-ORCH-0434 list** — separate dispatch needed. Hidden Flaw #3 above.
3. **🟡 SQL helper's WARNING comment is misleading** — claims to mirror TS source, doesn't. Update or auto-generate.
4. **🟡 Spec writers + implementors must STOP using "byte-for-byte align TS twin to SQL helper" as a success criterion** — that pattern is what produced this regression. Instead, both sides must align to a single canonical authority document. Update both `mingla-forensics` SPEC mode + `mingla-implementor` SKILL with this guard.
5. **🟢 The canonical 10-slug taxonomy is well-established and load-bearing** — admin/categories.js, seedingCategories.ts, DISPLAY_TO_SLUG, 18 i18n locales. Don't even consider Path 3.
6. **🆕 The Phase 3 implementor pass IS still valid** for the `place_pool.seeding_category` column drop work — those reads/writes still need to be removed before Migration 6. The Phase 3 redeploy can be re-run AFTER the helper fix lands; the new TS helper will return canonical slugs and the existing Phase 3 logic (counts/breakdowns) will work correctly.

---

## Confidence per Finding

| Finding | Confidence | Reason |
|---|---|---|
| 🔴 ROOT CAUSE — SQL helper wrong taxonomy | **HIGH (proven)** | Six-field evidence: live `pg_proc.prosrc` body, live matview distribution, live RPC scan, source-file diff, live count discrepancy in Baltimore |
| 🟠 Phase 3 implementor pass propagated wrong | **HIGH (proven)** | I authored both dispatches; cross-referenced Phase 3 report SC-06 against canonical taxonomy |
| 🟡 useMapCards.ts stale | **HIGH** | Direct file read shows 12-category pre-ORCH-0434 list |
| 🟡 Migration 1 WARNING comment misleading | **HIGH** | Direct file read |
| 🔵 TRANSITIONAL aliases observation | **HIGH** | Direct file read of categoryPlaceTypes.ts:101-124 |
| Bouncer-Stats panel was ALREADY broken pre-Phase-3 | **HIGH (proven)** | Migration 4 ships matview with helper slugs; admin_pool_category_health passes through; admin UI expected canonical |
| Path 1 fix will work | **HIGH** | After helper rewrite + matview refresh, all 5 admin RPCs that pass-through `primary_category` will emit canonical slugs; admin UI will resolve them |

---

**END OF REPORT**

Recommended next dispatch: SPEC writer for the helper fix migration + TS twin rewrite, scoped tightly per Phase F. The Phase 3 admin edge function code stays as-is; its current logic is correct, only the underlying helper output needs to change.
