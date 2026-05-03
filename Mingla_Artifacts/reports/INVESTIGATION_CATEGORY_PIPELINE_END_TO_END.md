# INVESTIGATION — End-to-End Category Pipeline Map

**Skill:** mingla-forensics (INVESTIGATE mode)
**Dispatched by:** orchestrator after operator caught two prior audits' tunnel vision; operator's correction: "there is a seeding category... and the categories we use for the signals and scoring... all the other labels live on it no?"
**Time-box:** 90 min, sequential per memory
**Method:** every assertion backed by live `pg_catalog`, `place_pool` sample rows, sister-table queries, and source-file diffs
**Confidence:** HIGH on the pipeline structure; MEDIUM on a few historical-intent quotes (operator may need to confirm)
**This is a MAP, not a verdict.** No fix recommendations. The orchestrator routes open questions to operator before specing the fix.

---

## Executive Summary (layman, ≤10 lines)

Mingla has **FOUR distinct category taxonomies**, each living in different fields, each serving a different purpose. They were always meant to coexist. The bug isn't that one is "right" and one is "wrong" — the bug is that one specific store-and-display pairing got crossed: a column that the admin dashboard treats as the **display taxonomy** is now being filled with values from the **signal-scoring taxonomy** (subset of 11 of the 16 signals). The other three taxonomies are healthy.

The four taxonomies, in order of appearance on a place's life:
1. **Seeding taxonomy (10 slugs)** — the category we ASKED Google to find when crawling. Stored on `seeding_batches.seeding_category` + as a snapshot on `place_pool.seeding_category`. Examples: `brunch_lunch_casual`, `movies_theatre`, `groceries`.
2. **Bouncer verdict (boolean + reason code)** — does this place pass deterministic quality gates? Stored on `place_pool.is_servable` + `bouncer_reason`. Not category-shaped at all.
3. **Signal-scoring taxonomy (16 signals)** — per-place per-signal score for ranking. Stored as ROWS in `place_scores`, one row per (place, signal). Includes 11 type-grounded + 5 quality-grounded signals. Examples: `brunch`, `casual_food`, `theatre`, `movies`, `picnic_friendly`, `romantic`.
4. **Display taxonomy (10 slugs)** — what users see on home screen pills + admin dashboard. Lives in `categoryPlaceTypes.ts` `DISPLAY_TO_SLUG`. Same as seeding taxonomy by design (10 user-facing buttons matching 10 admin Seed categories).

**The mismatch:** today's matview rebuild made `admin_place_pool_mv.primary_category` derive from `pg_map_primary_type_to_mingla_category()` — which produces a SUBSET of the signal-scoring taxonomy (11 type-grounded slugs, no quality-grounded). The admin dashboard reads `primary_category` expecting the **display taxonomy** values. They mismatch on 3 categories: `brunch_lunch_casual` vs `brunch`+`casual_food`, `movies_theatre` vs `movies`+`theatre`, `groceries` (separate in display, absorbed into `flowers` in helper).

---

## Phase A — `place_pool` column inventory (78 columns)

Live query of `pg_attribute` for `public.place_pool`. **Every category-related field on a place row:**

| Column | Type | Default | Comment | Purpose |
|---|---|---|---|---|
| `primary_type` | text | none | none | Google's single primary type (e.g. "italian_restaurant") |
| `types` | text[] | `'{}'` | none | Google's full type array (e.g. `['italian_restaurant','restaurant','food','establishment']`) |
| `seeding_category` | text | none | none | **Snapshot of the SEEDING taxonomy slug** (10 canonical values). Set when admin pushed this place via admin-seed-places; preserves "what shopping list was this place found on." Live sample: `'brunch_lunch_casual', 'nature', 'creative_arts'`. **Migration 6 will drop this column.** |
| `ai_categories` | text[] | `'{}'` | none | Legacy AI validator output. ORCH-0707 deprecated. Migration 6 will drop. |
| `ai_reason`, `ai_primary_identity`, `ai_confidence`, `ai_web_evidence` | text/real | none | none | Legacy AI metadata. Migration 6 will drop. |
| `is_servable` | bool | none | "ORCH-0588 Bouncer v2: deterministic gate. Parallel to ai_approved during Slice 1+. Owned by run-bouncer edge fn only." | **Bouncer verdict.** Boolean — passes gates or doesn't. Not a category. |
| `bouncer_reason` | text | none | "ORCH-0588: rejection reason in format B<N>:<token>. NULL when is_servable=true. Multi-reason concatenated with ;" | Why bouncer rejected (e.g. `B1:gas_station`, `B4:no_website`, `B6:no_hours`). |
| `bouncer_validated_at` | timestamptz | none | "timestamp of last run-bouncer pass. NULL = never bouncered." | When bouncer ran. |
| `passes_pre_photo_check`, `pre_photo_bouncer_reason`, `pre_photo_bouncer_validated_at` | bool/text/ts | none | "ORCH-0678 — true if place clears all Bouncer rules EXCEPT B8 (stored photos)." | Pre-photo gate (allows photo backfill). |
| `price_tier`, `price_tiers` | text/text[] | none | "Canonical price tier: chill, comfy, bougie, lavish" | Price classification — separate axis from category. |
| 60+ Google attribute fields (`serves_brunch`, `outdoor_seating`, `dine_in`, `live_music`, etc.) | bool/jsonb | mostly null | none | Raw Google signals consumed by signal scorer. Not categories themselves. |

**Sample 5 Baltimore rows showing the seeding taxonomy at work:**

| Name | primary_type | seeding_category (canonical) | is_servable | bouncer_reason |
|---|---|---|---|---|
| HipHop Fish & Chicken | `restaurant` | `brunch_lunch_casual` | false | B8:no_stored_photos |
| Chinquapin Run Park | `park` | `nature` | true | null |
| ArtSea Ink | `florist` | `creative_arts` | false | B4:no_website |
| Brew & Bites | `restaurant` | `brunch_lunch_casual` | false | B6:no_hours |
| Shell | `gas_station` | `brunch_lunch_casual` | false | B1:gas_station |

Two observations from the samples:
- `seeding_category` reflects what shopping list the admin used, NOT what Google's primary_type indicates. (Shell's primary_type is `gas_station` but it was found on the `brunch_lunch_casual` shopping list — bouncer correctly rejected it as `B1:gas_station`.)
- `seeding_category` uses the canonical 10-slug taxonomy.

---

## Phase B — Sister tables in the category orbit

### B.1 — `seeding_batches` (the SEEDING taxonomy authority)

| Column | Type | Purpose |
|---|---|---|
| `seeding_category` | text | The CONFIG ID used for this batch (e.g. `casual_eats_world`, the granular Google-API-tuned bucket — note: NOT always = canonical app slug) |
| `app_category` | text | The display app slug (`brunch_lunch_casual`, `movies_theatre`) — ONE level above the granular config ID |
| 18 other operational fields | various | API call counts, success/failure tallies |

**Critical:** `seeding_batches` carries TWO category fields. `seeding_category` = granular Google-API config ID (~14 distinct values across the 14 SEEDING_CATEGORIES configs in `seedingCategories.ts`). `app_category` = the canonical 10-slug display value. The admin Seed Tab UI displays `app_category`; the actual Google query is built from the config keyed by `seeding_category`.

### B.2 — `seeding_operations`
Same dual-column structure (`seeding_category` + `app_category`). Aggregates ops across batches.

### B.3 — `seeding_runs`
`selected_categories ARRAY` — the canonical 10-slug values selected by the admin when launching the run.

### B.4 — `seeding_cities`
No category field. Just city geography + status.

### B.5 — `place_scores` (the SIGNAL-SCORING taxonomy authority)

| Column | Type | Purpose |
|---|---|---|
| `place_id` | uuid | FK to place_pool |
| `signal_id` | text | One of 16 signal IDs (see B.6 below) |
| `score` | numeric | 0-200 score for this place against this signal |
| `contributions` | jsonb | Component breakdown (e.g. `_rating_scale:35, types_includes_restaurant:-40`) |
| `signal_version_id` | uuid | FK to signal_definition_versions |

**Live distribution (Phase I.3):** 16 signal_ids × 14,412 places ≈ 230,000 rows. Note `groceries` only has 9,744 rows (under-scored cities). Each place gets one row PER signal, even when score=0.

### B.6 — `signal_definitions` (16 signals, mix of type/quality grounded)

| Signal | Kind | What it scores |
|---|---|---|
| `nature` | type-grounded | scenic/outdoor places |
| `icebreakers` | type-grounded | first-meet light spots |
| `drinks` | type-grounded | bars, cocktail venues |
| `brunch` | type-grounded | brunch restaurants |
| `casual_food` | type-grounded | casual restaurants |
| `fine_dining` | type-grounded | upscale restaurants (note: signal name `fine_dining` ≠ display slug `upscale_fine_dining`) |
| `creative_arts` | type-grounded | museums/galleries |
| `play` | type-grounded | activity venues |
| `movies` | type-grounded | cinemas |
| `theatre` | type-grounded | live performance |
| `flowers` | type-grounded | florists (only) |
| `groceries` | type-grounded | grocery stores |
| `lively` | quality-grounded | atmosphere = lively |
| `picnic_friendly` | quality-grounded | suitability for picnics |
| `romantic` | quality-grounded | romantic atmosphere |
| `scenic` | quality-grounded | views/aesthetic appeal |

**Schema:** `signal_definitions` (id, label, kind, current_version_id, is_active) + `signal_definition_versions` (id, signal_id, version_label, config jsonb, created_at, notes). Active version per signal selected via `current_version_id`. Versions enable history and rollback.

**Sample `brunch` v1.4.0 config (truncated):**
```json
{
  "cap": 200,
  "min_rating": 4,
  "min_reviews": 30,
  "field_weights": {
    "serves_brunch": 65,
    "reservable": 40,
    "serves_cocktails": 35,
    "types_includes_bar": -50,
    "types_includes_brunch_restaurant": 30,
    ...
  },
  "text_patterns": {
    "summary_regex": "brunch|mimosa|...",
    "summary_weight": 35,
    ...
  }
}
```

Each signal config is hand-tuned with weights for boolean Google attributes, type membership rules, regex patterns over reviews + summary text.

### B.7 — `rule_sets` + `rule_set_versions` + `rule_entries`

| Column on rule_sets | Purpose |
|---|---|
| `kind` | One of: `strip` / `demotion` / `promotion` / `blacklist` / `whitelist` / `keyword_set` / `min_data_guard` |
| `scope_kind` | `global` or `category` |
| `scope_value` | When `scope_kind='category'`: the **signal-scoring slug** the rule applies to |

**Live rule_sets (22 rows) reveal the dual-taxonomy split mid-migration:**

| Rule | Scope value | Active? | Note |
|---|---|---|---|
| BRUNCH_BLOCKED_TYPES | `brunch` | true | NEW signal-scoring slug |
| BRUNCH_CASUAL_BLOCKED_TYPES | `brunch_lunch_casual` | **false** | OLD canonical slug, deactivated |
| CASUAL_FOOD_BLOCKED_TYPES | `casual_food` | true | NEW signal-scoring slug |
| MOVIES_BLOCKED_TYPES | `movies` | true | NEW |
| MOVIES_THEATRE_BLOCKED_TYPES | `movies_theatre` | **false** | OLD, deactivated |
| THEATRE_BLOCKED_TYPES | `theatre` | true | NEW |
| CASUAL_CHAIN_DEMOTION | `upscale_fine_dining` | true | Both taxonomies share this slug |
| FINE_DINING_PROMOTION_T1 | `upscale_fine_dining` | true | Same |
| FLOWERS_BLOCKED_PRIMARY_TYPES | `flowers` | true | Same |
| (5 global rules — no category scope) | n/a | true | BLOCKED_PRIMARY_TYPES, FAST_FOOD_BLACKLIST, MIN_DATA_GUARD, RESTAURANT_TYPES, SOCIAL_DOMAINS, EXCLUSION_KEYWORDS, UPSCALE_CHAIN_PROTECTION |

**Operator-relevant fact:** the rules engine has been actively migrated from canonical taxonomy to signal-scoring taxonomy. The split was Migration 2 of ORCH-0700 today (`20260503000002_orch_0700_rules_split_movies_theatre_brunch_casual.sql`) — splitting `BRUNCH_CASUAL_BLOCKED_TYPES` into separate `BRUNCH_BLOCKED_TYPES` + `CASUAL_FOOD_BLOCKED_TYPES`, etc. **The rules engine NOW uses signal-scoring taxonomy.**

### B.8 — `admin_place_pool_mv` (the matview — the LEAK SITE)

30 columns. Critical column for this audit: `primary_category text`. Per Migration 4 today:

```sql
COALESCE(
  public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types),
  'uncategorized'::text
) AS primary_category
```

**This column was newly populated today via the SQL helper, which produces a SUBSET of the signal-scoring taxonomy (11 of the 16 signals — only the type-grounded ones).** The admin Place Pool dashboard reads this column as if it were the canonical display taxonomy. Mismatch.

### B.9 — `card_*` tables (post-ORCH-0640 archive)
Empty/archived. No category fields in active use.

### B.10 — `category_type_exclusions` table
Exists but empty (`[]` rows). Schema: `category_slug text, excluded_type text, created_at`. Likely future-use for per-category type-exclusion rules; currently unused.

---

## Phase C — Helpers/RPCs that DERIVE category

### C.1 — `pg_map_primary_type_to_mingla_category(text, text[]) → text` (SQL helper)

**Live source:** Migration 1 of ORCH-0700, applied today. Returns one of 11 slugs:
`nature, icebreakers, drinks_and_music, movies, theatre, brunch, casual_food, upscale_fine_dining, creative_arts, play, flowers`. **Notable: 11 type-grounded signal slugs — `drinks_and_music` instead of `drinks` (taxonomy mismatch with signals!), `flowers` absorbs grocery_store + supermarket, no separate `groceries` slug.**

**Where used:**
- `admin_place_pool_mv.primary_category` derivation (Migration 4 — primary leak site)
- `admin_uncategorized_places` RPC (per Migration 3 rewire)
- `admin_pool_category_health` RPC (per Migration 3 rewire)
- `admin_rules_preview_impact` RPC (per Migration 3 rewire)
- `admin_virtual_tile_intelligence` RPC (per Migration 3 rewire)
- `admin_city_place_stats` RPC (per Migration 3 rewire)

### C.2 — `mapPrimaryTypeToMinglaCategory(primaryType, fallbackTypes)` (TS, in `categoryPlaceTypes.ts`)

Returns one of the 12 keys of `MINGLA_CATEGORY_PLACE_TYPES`: 
`'Nature & Views', 'Icebreakers', 'Drinks & Music', 'Brunch', 'Casual', 'Brunch, Lunch & Casual', 'Upscale & Fine Dining', 'Movies', 'Theatre', 'Movies & Theatre', 'Creative & Arts', 'Play', 'Flowers', 'Groceries'`. **Returns DISPLAY NAMES (not slugs).** Caller chains with `mapCategoryToSlug()` or `DISPLAY_TO_SLUG[name]` to get a slug.

Two transitional aliases preserved per ORCH-0597/0598 (`'Brunch, Lunch & Casual'`, `'Movies & Theatre'` exit 2026-05-12/13).

**First-write-wins iteration:** the TS function caches `_PRIMARY_TYPE_TO_CATEGORY_CACHE` mapping each primary_type to the FIRST category whose type list contains it. Order matters — `'Nature & Views'` is first in `MINGLA_CATEGORY_PLACE_TYPES`, so `'park'` claims it. `'Brunch, Lunch & Casual'` (the transitional alias) appears AFTER `'Brunch'` and `'Casual'` in iteration order — so `'italian_restaurant'` would claim `'Casual'` first, never reaching `'Brunch, Lunch & Casual'`.

**Where used:** ORCH-0684 person-hero card mapper (was). Possibly other callers (need broader grep).

### C.3 — `derivePoolCategory(primaryType, types) → string | null` (TS, NEW from Phase 3 implementor pass)

Mirrors the broken SQL helper byte-for-byte. Returns the same 11 helper-taxonomy slugs. Used by:
- `admin-seed-places` `coverage_check` (Phase 3 rewrite)
- `admin-refresh-places` `applyRefreshFilters` + `preview_refresh_cost` (Phase 3 rewrite)
- `admin-place-search` (currently no usage, helper imported but not called)

### C.4 — Bouncer (`run-bouncer` edge function — file not read in this audit)

From comments on `is_servable`/`bouncer_reason` columns: deterministic gate that emits B-codes (B1:gas_station, B4:no_website, B6:no_hours, B8:no_stored_photos, etc.). Does NOT derive a category — operates on category-agnostic quality criteria.

### C.5 — Signal scorer (the engine that writes `place_scores`)

For each of 16 signals, computes a per-place score by combining:
- `field_weights` — boolean Google attributes scaled by per-signal weights
- `text_patterns` — regex matches against editorial/generative summary + reviews
- `scale` — rating + review count scaled to a base
- `cap` / `clamp_min` — bounds
- `min_rating` / `min_reviews` / `bypass_rating` — entry gates

Each signal version is a fully self-contained scoring formula. The scorer doesn't "know" categories — it knows signals. Different signals have completely different formulas.

---

## Phase D — Every WRITE site for category data

| When | Who | Writes | Field | Value source |
|---|---|---|---|---|
| Admin pushes Seed Tab batch | `admin-seed-places.ts` `transformGooglePlaceForSeed` (Phase 3 removed `seeding_category` write) | `place_pool` row | (formerly `seeding_category`; nothing now) | (was) admin's selected app slug |
| Admin pushes Seed Tab batch | `admin-seed-places.ts` `handleCreateRun` | `seeding_batches` row | `seeding_category` (granular config ID) + `app_category` (canonical) | `config.appCategorySlug` |
| Admin pushes from Place Search | `admin-place-search.ts` `handlePush` | `place_pool` row | (formerly `seeding_category`; nothing now post-Phase 3) | (was) admin selection or `null` |
| Admin runs Refresh | `admin-refresh-places.ts` `refreshPlace` | `place_pool` row | nothing category-related; only updates Google attribute fields | n/a |
| Bouncer validates | `run-bouncer` edge function | `place_pool` row | `is_servable, bouncer_reason, bouncer_validated_at` | deterministic rules |
| Pre-photo Bouncer | `run-pre-photo-bouncer` edge function | `place_pool` row | `passes_pre_photo_check, pre_photo_bouncer_reason, pre_photo_bouncer_validated_at` | deterministic rules sans B8 |
| Signal scorer runs | (likely `score-places` or similar; not read this audit) | `place_scores` (one row per place per signal) | `signal_id, score, contributions, signal_version_id` | `signal_definition_versions.config` formula |
| Matview cron refresh (every 10 min) | `cron_refresh_admin_place_pool_mv` | `admin_place_pool_mv` (rebuild) | `primary_category` derived from `pg_map_primary_type_to_mingla_category(primary_type, types)` | helper output (11-slug subset of signal-scoring taxonomy) |
| Admin edits a place | `admin_edit_place` RPC (Migration 3 rewired) | `place_pool` | name, price_tier, price_tiers, is_active. Category override capability REMOVED. | n/a |

---

## Phase E — Every READ site for category data

### E.1 — Mobile home screen pill bar
- File: not exhaustively traced this audit (out of time-box). Known reference: `app-mobile/src/components/HomePage.tsx` (per grep)
- Categories present in mobile component grep: `SwipeableCards.tsx, HomePage.tsx, GlassTopBar.tsx`
- Source of pill labels: edge functions return `category` and/or `categoryLabel` field on responses; mobile renders that string directly
- Display authority: `categoryPlaceTypes.ts` `DISPLAY_TO_SLUG` (10 canonical) + `SLUG_TO_DISPLAY` reverse map

### E.2 — Mobile Discover/Map cards
- `useMapCards.ts` declares a STALE 12-category list (`'Nature & Views', 'First Meet', 'Picnic Park', 'Drink', 'Casual Eats', 'Fine Dining', 'Watch', 'Live Performance', 'Creative & Arts', 'Play', 'Wellness', 'Flowers'`). Pre-ORCH-0434 vocabulary. Hidden flaw — stale legacy. Out of scope for current investigation.

### E.3 — Mobile category filter (when user taps a pill)
- Calls `query_servable_places_by_signal` RPC with a `signal_id` parameter
- **CRITICAL**: filtering uses **signal-scoring taxonomy**, not display taxonomy. So when user taps "Brunch & Casual" pill, the mobile app must translate it to a signal_id (likely fanning out to BOTH `brunch` and `casual_food` signals, OR mapping to a single one)
- This explains why signal-scoring taxonomy needs to exist — the underlying scoring is per-signal, but pills are display

### E.4 — Curated experience generation
- `generate-curated-experiences/index.ts:490` — `placeType: opts.comboCategory` — uses operator-selected experience type (`romantic`, `adventurous`, etc.), NOT a Mingla category
- Line 563 — `categoryLabel: CURATED_TYPE_LABELS[experienceType] || 'Explore'` — display label from experience type, not place category
- Curated pipeline operates on a **separate axis (experience type)**, parallel to category. ORCH-0707 enforced this as `I-CURATED-LABEL-SOURCE`

### E.5 — Single card generation
- Not deep-traced this audit. Likely uses signal-scoring per-signal queries via `fetch_local_signal_ranked` RPC.

### E.6 — Admin Place Pool dashboard - Categories panel (LEAK)
- File: `mingla-admin/src/components/seeding/SeedTab.jsx` calls `admin-seed-places coverage_check` action
- Edge function returns `coverage[]` array keyed by `appSlugConfigs` (canonical 10 slugs from `seedingCategories.ts.appCategorySlug`)
- Phase 3 rewrite tallies counts via `derivePoolCategory()` → returns helper 11-slug subset
- UI looks up `counts['brunch_lunch_casual']` → undefined → renders 0
- **BUG**

### E.7 — Admin Place Pool dashboard - Bouncer-Approved Stats panel (LEAK)
- Reads `admin_pool_category_health` RPC
- RPC does `GROUP BY mv.primary_category` and emits whatever the matview holds
- Matview holds helper-11-slug values
- Admin UI labels expect canonical 10 slugs
- **BUG (was already broken from Migration 4 today, before Phase 3)**

### E.8 — Admin Place Pool other panels
- `admin_place_category_breakdown` — same matview pass-through
- `admin_place_pool_overview` — same
- `admin_place_city_overview` — same
- `admin_place_country_overview` — same
- All inherit the leak.

### E.9 — Admin Refresh Cost Preview
- Edge function: `admin-refresh-places` `preview_refresh_cost`
- Phase 3 rewrite uses `derivePoolCategory()` → returns helper 11 slugs
- UI displays whatever it gets — doesn't strictly require canonical taxonomy here, the breakdown is just informative
- **Likely shows wrong-but-not-broken category names in the cost-preview category breakdown**

### E.10 — Admin Rules dashboard
- `admin_rules_overview` RPC returns rule sets with their `scope_value`
- Rules engine now uses signal-scoring taxonomy (`brunch`, `casual_food`, `movies`, `theatre`, etc.)
- Admin UI for Rules likely now displays signal slugs rather than display slugs — separate question for operator

---

## Phase F — Display labels (what users see)

### F.1 — Mobile pill labels (NOT exhaustively read; from `categoryPlaceTypes.ts`)
`'Nature & Views', 'Icebreakers', 'Drinks & Music', 'Brunch, Lunch & Casual', 'Upscale & Fine Dining', 'Movies & Theatre', 'Creative & Arts', 'Play'` (8 visible, hidden: Flowers, Groceries)

### F.2 — Admin labels (`mingla-admin/src/constants/categories.js`)
```js
CATEGORY_LABELS = {
  nature: "Nature & Views",
  icebreakers: "Icebreakers",
  drinks_and_music: "Drinks & Music",
  brunch_lunch_casual: "Brunch, Lunch & Casual",
  upscale_fine_dining: "Upscale & Fine Dining",
  movies_theatre: "Movies & Theatre",
  creative_arts: "Creative & Arts",
  play: "Play",
  flowers: "Flowers",
  groceries: "Groceries",
}
```

10 canonical slugs, identical to `DISPLAY_TO_SLUG` in `categoryPlaceTypes.ts`. ✅ aligned.

### F.3 — i18n locales (sample 3 spot-check from prior dispatch findings)
Translate canonical 10-slug display names. ✅ aligned with display.

---

## Phase G — THE Mismatch Ledger

This is the section the orchestrator needs.

### G.1 — Field-by-field map of every category-related label

| Concept / Label | WRITTEN where | WRITTEN by | Taxonomy | READ where | READ by | Match? |
|---|---|---|---|---|---|---|
| **SEEDING — granular config ID** | `seeding_batches.seeding_category`, `seeding_operations.seeding_category` | admin-seed-places | 14 granular slugs (e.g. `casual_eats_world`) | admin Seed Tab batch progress display | admin UI | ✅ |
| **SEEDING — app slug** | `seeding_batches.app_category`, `seeding_operations.app_category`, `seeding_runs.selected_categories[]` | admin-seed-places | 10 canonical slugs | admin Seed Tab dashboard, app counts | admin UI | ✅ |
| **SEEDING — snapshot on place** | `place_pool.seeding_category` | admin-seed-places (Phase 3 REMOVED this write) + admin-place-search push (Phase 3 REMOVED) | 10 canonical slugs (legacy data only — no new writes) | (none currently — was used by old admin-pool-category-health pre-Migration-3) | (no reader after Phase 3) | 🟡 column dying — Migration 6 will drop |
| **BOUNCER — verdict** | `place_pool.is_servable, bouncer_reason, bouncer_validated_at` | run-bouncer edge fn | boolean + B-codes | `query_servable_places_by_signal` filter, admin Stats panel "X% servable" | mobile + admin | ✅ |
| **PRE-PHOTO BOUNCER** | `place_pool.passes_pre_photo_check` etc. | run-pre-photo-bouncer | boolean | photo backfill pipeline | photo job | ✅ |
| **SIGNAL-SCORING — per signal score** | `place_scores` (one row per place per signal) | signal scorer | 16 signal IDs (11 type-grounded + 5 quality-grounded) | `query_servable_places_by_signal`, `fetch_local_signal_ranked`, `query_person_hero_places_by_signal` | mobile pills, ranking | ✅ |
| **SIGNAL-SCORING — config blueprint** | `signal_definitions, signal_definition_versions` | admin Rules dashboard | 16 signal IDs | signal scorer | scorer | ✅ |
| **RULES — engine scope** | `rule_sets.scope_value` | admin Rules dashboard | NEW: signal-scoring slugs (11 type-grounded). OLD canonical-slug rules deactivated. | rules engine | rules engine | ✅ (post-Migration-2) |
| **HELPER-DERIVED — per place** | `admin_place_pool_mv.primary_category` | matview cron refresh via SQL helper | 11 type-grounded subset of signal-scoring taxonomy + `'uncategorized'` | admin RPCs (`admin_pool_category_health` etc.), Phase 3 admin-seed-places `coverage_check`, Phase 3 admin-refresh-places `preview_refresh_cost` | admin UI | 🔴 **MISMATCH — admin UI expects canonical 10-slug DISPLAY taxonomy here** |
| **DISPLAY** | (no DB column — read from constants) | n/a | `categoryPlaceTypes.ts:DISPLAY_TO_SLUG` (10 canonical slugs) + `mingla-admin/src/constants/categories.js:CATEGORY_LABELS` | mobile pill bar, admin dashboard labels, i18n | mobile + admin | ✅ within itself |

### G.2 — The single mismatch in plain English

`admin_place_pool_mv.primary_category` is being filled with values from the **signal-scoring taxonomy subset** (11 type-grounded slugs). The admin dashboard reads that column expecting **display taxonomy** values (10 canonical slugs).

Three categories collide:
- `brunch_lunch_casual` (display, 1 slug) ↔ `brunch` + `casual_food` (signal-scoring, 2 slugs)
- `movies_theatre` (display, 1 slug) ↔ `movies` + `theatre` (signal-scoring, 2 slugs)
- `groceries` (display, 1 slug) + `flowers` (display) ↔ `flowers` (helper, absorbs grocery_store + supermarket)

One additional taxonomy mismatch worth noting:
- `drinks_and_music` (display) ↔ `drinks` (signal-scoring) — different slug entirely. **Not currently breaking the dashboard because both panels happen to display the value as-is and the legacy column had `drinks_and_music` stored. After matview rebuild, helper emits NO `drinks_and_music`. Need operator to confirm if this is intentional split (ORCH-0598-style) or accidental.**

---

## Phase H — Historical / spec context

### H.1 — Quote from `categoryPlaceTypes.ts:18-25`
> **ORCH-0434: Restructured from 13 to 10 categories.** Merged: nature + picnic_park → Nature & Views. Merged: watch + live_performance → Movies & Theatre. Renamed: First Meet → Icebreakers, Drink → Drinks & Music, Casual Eats → Brunch Lunch & Casual, Fine Dining → Upscale & Fine Dining. Removed: Wellness. Hidden: Flowers (was visible, now backend-only like Groceries)

> ORCH-0597 (Slice 5): split "Brunch, Lunch & Casual" into two separate canonical categories. Old display name retained as [TRANSITIONAL] alias for pre-OTA clients during the 14-day soak window ending 2026-05-12.
> ORCH-0598 (Slice 6): split "Movies & Theatre" into two separate canonical categories. Old display name retained as [TRANSITIONAL] for pre-OTA clients (exit 2026-05-13).

**Critical operator-level question:** Were ORCH-0597 + ORCH-0598 supposed to also split the *slug* (`brunch_lunch_casual` → `brunch`+`casual` slugs in DISPLAY_TO_SLUG)? Or just the *display name* aliases? The current `DISPLAY_TO_SLUG` map still has the COMBINED slugs (`brunch_lunch_casual`, `movies_theatre`) — only the display-name aliases were added, not new slug entries. **This may be an incomplete migration.**

### H.2 — DECISION_LOG entries
Did not read fully this audit. Operator should confirm what DEC entries exist for ORCH-0597/0598/0700 category split intent.

### H.3 — Memory `project_categorization_rules.md`
Existence noted in MEMORY.md index. Did not read in this audit. Operator should review.

### H.4 — ORCH-0700 spec quote
Migration 1 file's WARNING comment:
> WARNING: this function MUST stay in sync with the TS source. A future ORCH should auto-generate this from the TS module. For now, hand-mirror with care.

The "TS source" referenced is `mapPrimaryTypeToMinglaCategory` in `categoryPlaceTypes.ts`. As established in Phase C.2, that TS function returns DISPLAY NAMES, not slugs. The SQL helper claims to mirror it but actually emits invented slugs that match neither display nor seeding taxonomies.

### H.5 — Prior audits' assumptions
- LANDMINE_AUDIT (this morning) identified Migration 5 OUT-param drift + 3 admin edge functions still reading dropped column. Did NOT examine the helper output's taxonomy.
- TAXONOMY_REGRESSION (just before this audit) identified the helper-vs-canonical mismatch but assumed there were ONLY two taxonomies (helper 11 vs display 10). Missed that the helper's 11 are actually a SUBSET of the signal-scoring 16. Operator's correction surfaced the missing third dimension.

---

## Phase I — Bouncer + Signal Scorer Architecture

### I.1 — Signal scorer design
- 16 signals total: 11 type-grounded (close to one per Mingla "place category") + 5 quality-grounded (`lively, picnic_friendly, romantic, scenic`) which are CROSS-CATEGORY (a park can be both `nature`-scored AND `picnic_friendly`-scored).
- Each place gets a row per signal in `place_scores`, even when score=0. So a park has rows for all 16 signals; its high scores are on `nature`, `picnic_friendly`, `scenic`; its low/zero scores are on `casual_food`, `brunch`, etc.
- Mobile ranking calls `query_servable_places_by_signal(signal_id, lat, lng, ...)` — fetches places ranked by that one signal's score. Pills map to one or more signals.

### I.2 — Bouncer logic
- Reads many fields on `place_pool` (rating, reviews, hours, photos, primary_type, types, name).
- Emits `is_servable=true/false` + `bouncer_reason`.
- Does NOT consume or produce a category. Category-agnostic quality gate.
- Rules engine (`rule_sets`) provides the deterministic gates. Some rules are scoped by category (the new signal-scoring taxonomy) — e.g. `BRUNCH_BLOCKED_TYPES` only applies when filtering for brunch.

### I.3 — Signal taxonomy: 16 signals × 14,412 places ≈ 230,000 score rows
| Signal | Rows | Notes |
|---|---|---|
| brunch | 14,412 | every place gets a brunch score |
| casual_food | 14,412 | etc. |
| creative_arts, drinks, fine_dining, flowers, icebreakers, lively, movies, nature, picnic_friendly, play, romantic, scenic, theatre | 14,412 each | |
| groceries | 9,744 | scored fewer cities (recent addition, cron caught up to most but not all) |

---

## Findings (classified — NO FIX RECOMMENDATIONS)

### 🔴 ROOT CAUSE — `admin_place_pool_mv.primary_category` is wired to the wrong taxonomy

| Field | Value |
|---|---|
| **File + line** | `supabase/migrations/20260503000004_orch_0700_rebuild_admin_place_pool_mv.sql:60-63` |
| **Exact code** | `COALESCE(public.pg_map_primary_type_to_mingla_category(pp.primary_type, pp.types), 'uncategorized'::text) AS primary_category` |
| **What it does** | Stores helper-output (11-slug subset of signal-scoring taxonomy) in a column the admin dashboard reads as if it were display taxonomy. |
| **What it should do** | (Operator decides — see Open Questions §13.) Either: (a) wire to display taxonomy via a different helper that returns canonical 10 slugs; (b) expose two columns (`signal_category` for ranking + `display_category` for UI); (c) add a translation layer where admin RPCs read it; (d) leave matview as scoring-taxonomy and fix admin UI to translate at read time. |
| **Causal chain** | (1) ORCH-0700 Phase 2.D rebuilt the matview today. (2) The column derivation pipes helper output directly into `primary_category`. (3) Admin dashboard's `coverage_check`/`admin_pool_category_health` read `primary_category` expecting display-taxonomy slugs (`brunch_lunch_casual`, `movies_theatre`, `groceries`). (4) Helper never emits those slugs — emits scoring-taxonomy slugs (`brunch`/`casual_food`, `movies`/`theatre`, no `groceries`). (5) Dashboard renders 0. |
| **Verification** | Live matview group-by shows zero rows with `brunch_lunch_casual`/`movies_theatre`/`groceries`. Live `mingla-admin/src/constants/categories.js` declares those exact slugs as the canonical 10. |

### 🟠 CONTRIBUTING — SQL helper claims to mirror TS source but doesn't

The helper's WARNING comment claims alignment with `mapPrimaryTypeToMinglaCategory`. The TS function returns DISPLAY NAMES; SQL helper invented slugs that neither display nor signal-scoring taxonomies use coherently. (`drinks_and_music` is the display slug, `drinks` is the signal-scoring slug — helper uses `drinks_and_music` even though it splits other categories per signal-scoring taxonomy. Internally inconsistent.)

### 🟡 HIDDEN FLAW — DISPLAY_TO_SLUG split per ORCH-0597/0598 may be incomplete

Per the file comments, ORCH-0597 split `'Brunch, Lunch & Casual'` and ORCH-0598 split `'Movies & Theatre'`. But `DISPLAY_TO_SLUG` still maps the COMBINED display names to combined slugs. New display names `'Brunch'` / `'Casual'` / `'Movies'` / `'Theatre'` exist in `MINGLA_CATEGORY_PLACE_TYPES` keys but have NO entries in `DISPLAY_TO_SLUG`. Their `mapCategoryToSlug()` returns empty string — silent drop.

### 🟡 HIDDEN FLAW — `useMapCards.ts` ALL_CATEGORIES is pre-ORCH-0434 (12 stale names)

(Same as prior audit — already known.)

### 🟡 HIDDEN FLAW — `place_pool.seeding_category` snapshot column has 197 NULLs in Baltimore

Phase D query showed 197 rows with `seeding_category = null` (out of 2213 total). These were seeded before the field was added or via paths that didn't write it. Migration 6 will drop the column anyway, so this is moot — just note that for any historical analysis, the snapshot is incomplete.

### 🔵 OBSERVATION — The 4 taxonomies are LEGITIMATELY parallel, not redundant

This is the conceptual takeaway. Each taxonomy exists for its job:
- **Seeding (10 + 14 granular)** — admin-curated lists optimized for Google API constraints
- **Bouncer (boolean+codes)** — quality gates, agnostic to category
- **Signal-scoring (16)** — ranking engine; finer than display because scoring needs precision
- **Display (10)** — user-facing labels

The first three live in the database; display is read from constants and shown alongside.

### 🔵 OBSERVATION — Curated experience pipeline is on a SEPARATE axis (experience type)

`generate-curated-experiences` operates on `comboCategory` (experience type slugs like `romantic, adventurous, first-date`), NOT category. Confirmed: I-CURATED-LABEL-SOURCE invariant from ORCH-0707. Doesn't intersect this regression.

---

## Open Questions for Operator (§13 — orchestrator's primary takeaway)

These are the architectural intent questions the codebase doesn't answer on its own. Orchestrator routes to operator before specing the fix.

**Q1: What should `admin_place_pool_mv.primary_category` represent?**
- (a) The display category (canonical 10 slug) — show to admin dashboard as the place's user-facing category bucket
- (b) The signal-scoring "primary signal" — the place's strongest category among the 11 type-grounded signals
- (c) The seeding category — the slug under which the place was originally added
- (d) Something else (operator articulates)

The matview was just renamed/rebuilt today. Was its intent (a), (b), or (c)? Migration 4 didn't preserve the comment about intent. The original column it replaced was `seeding_category` — which is (c). But the helper that fills it produces (b)-ish.

**Q2: Should the admin Place Pool dashboard show counts by which taxonomy?**
- (a) Display taxonomy (Brunch+Casual combined as one row, Movies+Theatre as one row, Groceries separate)
- (b) Signal-scoring taxonomy (Brunch separate from Casual, Movies separate from Theatre, no Groceries — absorbed into Flowers)
- (c) Both (two panels)
- (d) Operator's preference

**Q3: What's the correct relationship between display and signal-scoring slugs?**
- Currently display has 10 slugs. Signal-scoring has 16 (11 type + 5 quality).
- Are display pills (which can map to multiple signal queries) intended to fan out internally? E.g., user taps "Brunch & Casual" → app queries BOTH `brunch` and `casual_food` signals?
- Was ORCH-0597/0598 intended to split DISPLAY into 12 slugs (separate Brunch from Casual, separate Movies from Theatre), making display align with the 11 type-grounded signals plus Groceries?

**Q4: Are signal slugs like `drinks` (signal) vs `drinks_and_music` (display) intentionally different?**
- Signal scorer scores `drinks` (12 distinct types: bar, cocktail_bar, etc.)
- Display shows "Drinks & Music"
- Is the music aspect handled via a separate signal we missed? Or is the display name just legacy mismatch?

**Q5: What's the future of `place_pool.seeding_category` after Migration 6 drops it?**
- The snapshot ("which shopping list found this place") goes away.
- Replaced by what? `seeding_batches.seeding_category` joined back via batch FK? Or do we just lose this audit trail?

**Q6: Should the matview have ONE `primary_category` column or TWO+?**
- Could expose `display_category` AND `top_signal_category` — separate columns for different consumers.
- Tradeoff: more storage + dual maintenance vs single-source clarity.

---

## Confidence per Finding

| Finding | Confidence | Reason |
|---|---|---|
| 4 taxonomies exist + their fields | HIGH | live SQL + sample rows + source files all corroborate |
| Mismatch root cause | HIGH | live matview distribution + admin code + dashboard render = three layers agree on the failure mode |
| Helper invented slugs neither match | HIGH | source file directly readable |
| Curated pipeline orthogonal | HIGH | source file shows different axis |
| ORCH-0597/0598 split incomplete | MEDIUM | comment-based; need decision-log + DISPLAY_TO_SLUG cross-check operator can confirm |
| Bouncer category-agnostic | MEDIUM | inferred from column comments; did not read run-bouncer source this audit |
| Signal scorer formulas per-signal | HIGH | live config samples for 4 different signals showed full-formula isolation |
| Mobile pill → signal_id mapping | LOW | inferred from RPC signature `query_servable_places_by_signal(signal_id)`; did not read mobile pill component this audit |

---

## Discoveries for Orchestrator (no fix requested — just register)

1. 🔴 **The orchestrator should NOT spec a fix until Q1–Q6 are answered by operator.** This audit's whole point is "ask the right architectural question before patching."
2. 🟡 **DISPLAY_TO_SLUG may be incomplete per ORCH-0597/0598 split** — operator should confirm whether 10 or 12 was the intended end state.
3. 🟡 **`useMapCards.ts:8-12` stale 12-category list** (already known from prior audit).
4. 🟡 **`drinks_and_music` (display) vs `drinks` (signal) slug divergence** — confirm if intentional.
5. 🟢 **The signal-scoring system is well-architected** — `signal_definitions.kind` + `current_version_id` versioning + per-signal formulas is solid. The taxonomy isn't "wrong" — it's a different axis from display.
6. 🟡 **Bouncer source file (`run-bouncer/index.ts`) was NOT read this audit** — should be read before any spec touches bouncer behavior.
7. 🟡 **Signal scorer source file was NOT read this audit** — same.
8. 🟡 **The decision-log + memory categorization-rules were NOT read this audit** — should be quoted before specing.
9. 🟢 **Migration 6 column drop is still safe** — once Q1 is answered + matview is fixed accordingly, the column drop has no remaining live consumers (Phase 3 already removed all `place_pool.seeding_category` reads/writes from active edge functions).

---

## Investigation Manifest (audit trail)

Live SQL queries: 13 (place_pool columns, sister tables, place_scores sample, signal_definitions, signal_definition_versions sample, rule_sets, category_type_exclusions, RPC scans, helper source, matview shape, helper-slug distribution, seeding_category distribution, BRUNCH/CASUAL/THEATRE mismatch counts).

Source files read: 6 (`categoryPlaceTypes.ts` (sections), `seedingCategories.ts` (header), Migration 1 helper, Migration 4 matview, `mingla-admin/src/constants/categories.js`, partial grep into 5 mobile components + `generate-curated-experiences/index.ts`).

Files INTENTIONALLY NOT read this audit (out of time-box; flagged for orchestrator):
- `run-bouncer` edge function source
- Signal scorer edge function source
- `query_servable_places_by_signal` RPC body
- `app-mobile/src/components/HomePage.tsx` pill rendering
- `Mingla_Artifacts/DECISION_LOG.md`
- Memory `project_categorization_rules.md`
- Mobile + business app i18n locale files

---

**END OF REPORT**

The orchestrator now has the four-taxonomy map. Next move per dispatch contract: orchestrator surfaces Q1–Q6 to operator in plain English, gets answers, THEN dispatches spec writer with the chosen direction.
