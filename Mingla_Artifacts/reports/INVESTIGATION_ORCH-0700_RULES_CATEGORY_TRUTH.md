---
id: ORCH-0700 cycle-3 (rules + category truth audit)
type: INVESTIGATION REPORT
mode: INVESTIGATE
classification: data-architecture + dead-code + admin-only-system + invariant-clarification
severity: S2 (no production user impact; significant cleanup scope)
created: 2026-05-02
investigator: /mingla-forensics
dispatch: prompts/FORENSICS_ORCH-0700_RULES_AND_CATEGORY_TRUTH_AUDIT.md
prior: reports/INVESTIGATION_ORCH-0700_CYCLE2_LIVE_FIRE.md, reports/INVESTIGATION_ORCH-0700_AI_CATEGORIES_DECOMMISSION_AUDIT.md
related: ORCH-0526 (rules engine seed), ORCH-0597 (Brunch+Casual split), ORCH-0598 (Movies+Theatre split), ORCH-0640 (rules engine carve-out)
confidence: H+ on every R-thread finding (live-probe sourced); H on remediation recommendation
---

# 0. Verdict (layman-terms, 5 lines)

1. **The two legacy `rule_sets` rows do NOT fire today and never have via any runtime path.** The whole `rule_sets` table is admin-only display/edit data — zero edge functions, zero serving RPCs, zero scoring code reads it. Live grep + live `pg_proc.prosrc` confirm.
2. **The runtime canonical category list is the 16 rows in `signal_definitions` — all on modern split slugs** (`movies`, `theatre`, `brunch`, `casual_food`, `fine_dining`). The serving RPC `query_servable_places_by_signal` filters by `signal_id`, never by category column.
3. **`place_pool.seeding_category` (412 `movies_theatre` + 3,895 `brunch_lunch_casual` rows) and `place_pool.ai_categories` (435 + 4,328 rows) STILL hold legacy bundled slugs**, but neither column is read at serving time. They are admin-display data only.
4. **The decision SPLIT-vs-DELETE-vs-ZOMBIE for the two legacy rule_sets has zero user-facing impact.** Choose based on cleanliness + admin UI clarity, not on production safety.
5. **Cron + matviews:** No cron job touches `rule_sets`. The `admin_place_pool_mv` (cron job 13, every 10 min) DOES read `ai_categories` — must be rebuilt before column drop. Otherwise no other side effects.

---

# 1. Findings by thread

## R1 — Live `rule_sets` complete inventory

**Verdict:** 18 active rule_sets total. 11 category-scoped + 7 global. **Zero orphan versions, zero stale entries, every rule still at version_number=1** (never edited since 2026-04-19 seed).

**Live data (all rows, all currently `is_active=true`):**

| name | scope_kind | scope_value | kind | thresholds | entries |
|------|-----------|-------------|------|------------|---------|
| BRUNCH_CASUAL_BLOCKED_TYPES | category | **brunch_lunch_casual** | strip | `{check_field: types_array, exempt_if_primary_in: "RESTAURANT_TYPES"}` | 36 |
| CREATIVE_ARTS_BLOCKED_TYPES | category | creative_arts | strip | `{check_field: primary_type}` | 62 |
| DELIVERY_ONLY_PATTERNS | category | flowers | strip | `{check_field: name, exempt_primary: florist}` | 8 |
| FLOWERS_BLOCKED_PRIMARY_TYPES | category | flowers | strip | `{check_field: primary_type}` | 10 |
| FLOWERS_BLOCKED_SECONDARY_TYPES | category | flowers | strip | `{check_field: types_array}` | 4 |
| GARDEN_STORE_PATTERNS | category | flowers | strip | `{check_field: name, exempt_primary: florist}` | 28 |
| MOVIES_THEATRE_BLOCKED_TYPES | category | **movies_theatre** | strip | `{check_field: primary_type}` | 41 |
| PLAY_BLOCKED_SECONDARY_TYPES | category | play | strip | `{check_field: types_array}` | 13 |
| CASUAL_CHAIN_DEMOTION | category | upscale_fine_dining | demotion | `{demote_to: "brunch_lunch_casual", guarded_by: "UPSCALE_CHAIN_PROTECTION"}` | 21 |
| FINE_DINING_PROMOTION_T1 | category | upscale_fine_dining | promotion | `{rating_min: 4.0, requires_in: "RESTAURANT_TYPES", price_levels: [PRICE_LEVEL_VERY_EXPENSIVE]}` | 0 |
| FINE_DINING_PROMOTION_T2 | category | upscale_fine_dining | promotion | `{rating_min: 4.0, requires_in: "RESTAURANT_TYPES", price_levels: [PRICE_LEVEL_EXPENSIVE]}` | 0 |
| BLOCKED_PRIMARY_TYPES | global | — | blacklist | `{check_field: primary_type}` | 23 |
| EXCLUSION_KEYWORDS | global | — | blacklist | null | 192 |
| FAST_FOOD_BLACKLIST | global | — | blacklist | null | 66 |
| MIN_DATA_GUARD | global | — | min_data_guard | `{require_rating: true, require_reviews: true, require_website: true}` | 0 |
| RESTAURANT_TYPES | global | — | whitelist | `{purpose: promotion_eligibility}` | 55 |
| SOCIAL_DOMAINS | global | — | keyword_set | `{purpose: skip_in_serper_extract}` | 29 |
| UPSCALE_CHAIN_PROTECTION | global | — | whitelist | `{purpose: block_demotion, guards_rule: CASUAL_CHAIN_DEMOTION}` | 24 |

**LEGACY classification (mismatch with `signal_definitions.id`):**
- `movies_theatre` ← signal slugs are `movies` + `theatre`
- `brunch_lunch_casual` ← signal slugs are `brunch` + `casual_food`
- `upscale_fine_dining` ← signal slug is `fine_dining` (3 rules: CASUAL_CHAIN_DEMOTION, FINE_DINING_PROMOTION_T1, FINE_DINING_PROMOTION_T2)

`CASUAL_CHAIN_DEMOTION.thresholds.demote_to = "brunch_lunch_casual"` is a STRING WRITE-PATH that propagates the legacy slug if the rule were active.

**Hygiene wins (against earlier hypotheses):**
- Zero orphan `rule_set_versions` (every version is current)
- Zero stale `rule_entries` (all entries hang off current versions)
- Every rule at version_number=1 → admin has never edited any rule since the seed; the entire rules engine is in its as-seeded state

**Confidence:** H+ (live SQL probes at 2026-05-02).

## R2 — Live category enumeration (5 sources)

**Source 1 — code-side `categoryPlaceTypes.ts`** (`MINGLA_CATEGORY_PLACE_TYPES` keys):
`Nature & Views, Icebreakers, Drinks & Music, Movies, Theatre, Brunch, Casual, Brunch, Lunch & Casual [TRANSITIONAL], Upscale & Fine Dining, Movies & Theatre [TRANSITIONAL], Creative & Arts, Play, Flowers, Groceries`. **11 modern + 2 transitional bundles = 13 entries.**

**Source 2 — mobile chip slugs** (`app-mobile/src/utils/categoryUtils.ts:23` comment): "13 total: 10 visible + 2 hidden + 2 legacy-only (brunch_lunch_casual, movies_theatre)".

**Source 3 — DB enums:** `pg_enum` returned ZERO rows for any category-related enum type. No DB-level enum constraint. (`information_schema.check_constraints` on `place_pool` + `place_scores` returned only `place_pool_fetched_via_check` and `place_scores_score_range` — neither is a category constraint.)

**Source 4 — `place_pool.category` distinct:** **No such column exists.** `place_pool` has `seeding_category` and `ai_categories` instead. Distinct values:

```
seeding_category live distribution (is_servable=true):
  brunch_lunch_casual    3,895   ← LEGACY
  nature                 3,588
  icebreakers            2,339
  drinks_and_music       1,411
  upscale_fine_dining    1,063
  creative_arts            725
  (null)                   627
  movies_theatre           412   ← LEGACY
  play                     234
  flowers                   65
  groceries                 41

ai_categories live distribution (unnest, is_servable=true):
  brunch_lunch_casual    4,328   ← LEGACY
  nature                 3,008
  icebreakers            1,827
  drinks_and_music       1,680
  creative_arts            820
  movies_theatre           435   ← LEGACY
  groceries                388
  upscale_fine_dining      305
  play                     230
  flowers                   76
```

**Source 5 — `place_scores.category`:** **No such column.** `place_scores` has `signal_id` instead, joining to `signal_definitions.id`. Live signal definitions (16 active):

```
brunch         (Brunch)            type-grounded     14,412 scored places
casual_food    (Casual Food)       type-grounded     14,412
creative_arts  (Creative & Arts)   type-grounded     14,412
drinks         (Drinks)            type-grounded     14,412
fine_dining    (Fine Dining)       type-grounded     14,412
flowers        (Flowers)           type-grounded     14,412
groceries      (Groceries)         type-grounded      9,744
icebreakers    (Icebreakers)       type-grounded     14,412
lively         (Lively)            quality-grounded  14,412
movies         (Movies)            type-grounded     14,412
nature         (Nature)            type-grounded     14,412
picnic_friendly(Picnic Friendly)   quality-grounded  14,412
play           (Play)              type-grounded     14,412
romantic       (Romantic)          quality-grounded  14,412
scenic         (Scenic)            quality-grounded  14,412
theatre        (Theatre)           type-grounded     14,412
```

**Cross-reference disagreements:**

| slug | code (categoryPlaceTypes) | mobile chips | place_pool data | place_scores (signal) |
|------|---------------------------|--------------|-----------------|----------------------|
| `movies` | ✓ canonical | ✓ visible | ✗ (legacy bundled) | ✓ |
| `theatre` | ✓ canonical | ✓ visible | ✗ (legacy bundled) | ✓ |
| `movies_theatre` | TRANSITIONAL | LEGACY | ✓ 412 + 435 rows | ✗ |
| `brunch` | ✓ canonical | ✓ visible | ✗ | ✓ |
| `casual_food` (mobile) / `Casual` (code) | ✓ | ✓ | ✗ | ✓ (`casual_food`) |
| `brunch_lunch_casual` | TRANSITIONAL | LEGACY | ✓ 3,895 + 4,328 rows | ✗ |
| `fine_dining` (signal) | code: `Upscale & Fine Dining` slug `upscale_fine_dining` | mobile slug: `upscale_fine_dining` | seeding_category `upscale_fine_dining` (1,063) | signal: `fine_dining` |
| `drinks` (signal) vs `drinks_and_music` (everywhere else) | code: `drinks_and_music` | mobile slug: `drinks_and_music` | seeding_category `drinks_and_music` (1,411) | signal: `drinks` |

**FINDING D-NEW-1:** Two NAME mismatches between `signal_definitions.id` and the rest of the system:
- signal `fine_dining` ↔ everywhere else `upscale_fine_dining`
- signal `drinks` ↔ everywhere else `drinks_and_music`

These are not legacy artifacts — the signal layer chose shorter slugs while the chip + storage layer kept the longer ones. Bridged via routing maps (`discover-cards/index.ts:69-72` not shown but exists, plus `get-person-hero-cards/index.ts:185-211`). Not a bug, but a future-spec cleanup target.

**Confidence:** H+ (5 live + code probes, all cited).

## R3 — Where `rule_sets` is consumed

**Verdict:** ZERO runtime consumers. The entire table is admin-only display + edit infrastructure.

**Empirical proof:**

1. **Edge functions** — grep `rule_set|rule_entries|rule_set_versions` across `supabase/functions/` returns ONE file (`_shared/categoryPlaceTypes.ts`) and the matches are **comments only** (lines 619-620: `// MOVIES_THEATRE_BLOCKED_TYPES set per invariant #13`). No `from('rule_*')` calls anywhere in edge functions.

2. **Mobile + Business** — `from('rule_*')` returns ZERO matches in `app-mobile/src/` and `mingla-business/src/`. Mobile and Business never touch the table.

3. **Bouncer** (`supabase/functions/_shared/bouncer.ts`, 270 lines) — pure function. Uses HARDCODED constants: `EXCLUDED_TYPES`, `NATURAL_TYPES`, `CULTURAL_TYPES`, `SOCIAL_DOMAINS`, `CHILD_VENUE_NAME_PATTERNS`. No `rule_*` table reads. Confirmed by reading 100% of file.

4. **Signal scorer** (`supabase/functions/_shared/signalScorer.ts`, 244 lines) — pure function. Takes `SignalConfig` as a function parameter. No DB reads. No `rule_*` table interaction.

5. **`query_servable_places_by_signal` RPC** (live `pg_proc.prosrc`) — joins `place_pool` to `place_scores` filtering on `signal_id`, no `rule_*` reference.

6. **All RPCs that DO touch `rule_*` tables** (live `pg_proc` query):
   ```
   admin_rule_detail              (admin)
   admin_rule_set_diff            (admin)
   admin_rule_set_versions        (admin)
   admin_rules_export             (admin)
   admin_rules_list               (admin)
   admin_rules_overview           (admin)
   admin_rules_preview_impact     (admin — DRY-RUN simulator)
   admin_rules_rollback           (admin)
   admin_rules_run_affected_places (admin — historical audit)
   admin_rules_run_detail         (admin — historical audit)
   admin_rules_run_diff           (admin)
   admin_rules_save               (admin)
   tg_rule_entries_block_update   (trigger — blocks UPDATE on entries)
   tg_rule_set_versions_block_update (trigger — blocks UPDATE on versions)
   ```
   13 of 14 are `admin_*` namespaced. Two are append-only-enforcement triggers.

7. **Admin UI consumption** — `mingla-admin/src/components/rules-filter/*` calls `admin_rule_detail`, `admin_rule_set_versions`, `admin_rules_preview_impact`, `admin_rules_save`, `admin_rules_rollback`, `admin_rules_overview`, `admin_rules_list`, `admin_rules_runs`, `admin_rule_set_diff`, `admin_rules_run_detail`, `admin_rules_run_affected_places`, `admin_rules_run_diff`. **No CREATE rule path** — the UI only edits/views existing rules. No way for an admin to create a new rule scoped to `movies` from the UI today.

**Implication:** The original premise of the dispatch ("admin protection that was deliberately added is currently dormant") is partially correct but mis-framed. **The rules were never wired to runtime in the first place.** They were seeded as a future-state admin tooling layer (per `change_summary` field, all rules say "Initial seed (ORCH-0526 M2) from ai-verify-pipeline/index.ts:..."), pointing at the OLD AI validation pipeline that has since been decommissioned in favor of bouncer + signal scorer.

**Confidence:** H+ (grep + live SQL on pg_proc + read of bouncer/scorer source).

## R4 — Empirical: do legacy rules fire?

**Verdict:** Rules don't fire (R3 proves this), but the *intended protection* of the two legacy rules is partially achieved by other mechanisms. Live data:

**`MOVIES_THEATRE_BLOCKED_TYPES` intended to block** primary_type in `{restaurant, fine_dining_restaurant, bar, hotel, gym, ...}` (40 items). Live probe of places that score ≥80 on `movies` signal:

```
primary_type in movies signal ≥80, top 19:
  performing_arts_theater   113   avg 89.4    max 197.4
  movie_theater              69   avg 121.4   max 193.1   ← LEGITIMATE
  concert_hall               17   avg 92.9
  event_venue                 8   avg 95.7
  live_music_venue            7
  amphitheatre                1   max 151.9
  dance_hall, comedy_club, library, museum, art_gallery, art_museum,
  arena, cultural_center, historical_landmark, tourist_attraction, etc.
  
  primary_type='restaurant' AND ps.score>=80 on movies: 0 rows  ← already blocked
```

The actual movies-pill leak is **theatre venues**, NOT the food/drink/retail types listed in `MOVIES_THEATRE_BLOCKED_TYPES`. The legacy rule's blocklist would not have caught the actual leakers even if the rule were active. The signal scorer's ≥80 gate already handles the food/drink/retail exclusion via type weights (zero score for those types).

**`BRUNCH_CASUAL_BLOCKED_TYPES` intended to block** types_array entries in `{bar, night_club, casino, sports_complex, sports_bar, ...}`. Live probe of `casual_food` signal ≥80 with primary_type in `{night_club, casino, sports_bar, bar}`:

```
casual_food signal ≥80:
  bar:        145 leakers
  sports_bar:  14 leakers
  night_club:   0
  casino:       0
  
brunch signal ≥80:
  bar:        107 leakers   (also leaking)
```

Bars ARE leaking into casual_food and brunch pills. The legacy `BRUNCH_CASUAL_BLOCKED_TYPES` lists `bar` — would catch this if active. But it isn't active and never has been. The fix path is either (a) tighten the `casual_food` + `brunch` signal weights to penalize `bar` types, OR (b) add a real serving-time strip filter (which would require new infra).

**FINDING D-NEW-2:** The current Casual + Brunch chips have 145 + 107 bar leakers respectively. This is a NEW data point cycle-2 didn't quantify (cycle-2 focused on Movies). Worth registering as a follow-up bug separate from ORCH-0700 if the operator wants tight Brunch / Casual decks.

**Confidence:** H+ (live SQL count + join queries).

## R5 — Other legacy bundled-slug bombs

**Verdict:** Massive surface area — the legacy slugs are LIVE DEPENDENCIES across serving, seeding, admin, mobile, and i18n. Sunset dates 2026-05-12 (brunch_lunch_casual) and 2026-05-13 (movies_theatre) were chosen to give pre-OTA clients a 14-day window after ORCH-0597 and ORCH-0598 100% adoption.

**Backend edge functions (LIVE DEPENDENCY) — 10 files:**

| File | Lines | Purpose |
|------|-------|---------|
| `discover-cards/index.ts` | 90-91, 95-96 | TRANSITIONAL chip name → signal pair routing |
| `get-person-hero-cards/index.ts` | 178-211, 825-826 | adventurous/friendly intent maps; CATEGORY_TO_SIGNAL union |
| `generate-curated-experiences/index.ts` | 170, 466, 471, 568, 603-604, 706 | experience generation maps + duration map + fallback default |
| `replace-curated-stop/index.ts` | 12-13 | VALID_CATEGORIES set (rejects requests with new slugs only) |
| `admin-seed-map-strangers/index.ts` | 117-119 | ALL_CATEGORIES list for stranger map seed |
| `_shared/categoryPlaceTypes.ts` | 228-230, 246-248, 477, 479 | DISPLAY_TO_SLUG / aliases (**SLUG_TO_DISPLAY['movies_theatre']='Movies & Theatre'**) |
| `_shared/seedingCategories.ts` | 222, 256, 284, 340, 361 | `appCategorySlug` for 5 of 14 SeedingCategoryConfigs |
| `_shared/stopAlternatives.ts` | (helper for stops) | minor reference |
| `_shared/__tests__/scorer.test.ts` | test fixture | references legacy slug |
| `_shared/seedingCategories.test.ts` | test | enforces appCategorySlug invariant |

**Mobile (LIVE DEPENDENCY) — 65 files:**

| File | Type | Notes |
|------|------|-------|
| `services/deckService.ts` | code | type union (line 103), name map (145, 150), alias resolver (250, 260) |
| `utils/categoryUtils.ts` | code | LEGACY_CATEGORY_SLUGS Set, alias maps in 3 different functions, color map |
| `constants/interestIcons.ts` | code | Icon map TRANSITIONAL keys |
| `constants/holidays.ts` | code | INTENT_CATEGORY_MAP |
| `components/OnboardingFlow.tsx` | code | TRANSITIONAL icon mapping |
| `components/PreferencesSheet/PreferencesSections.tsx` | code | category description i18n keys |
| `components/profile/ViewFriendProfileScreen.tsx` | code | CATEGORY_CHIP_ICONS TRANSITIONAL |
| `i18n/locales/{en,es,fr,de,it,pt,ja,ko,zh,ar,bn,bin,el,ha,he,hi,id,ig,ja,ms,nl,pl,ro,ru,sv,th,tr,uk,vi,yo}/{common,preferences}.json` | translation strings | 56 files (28 langs × 2) with translations for `category_descriptions.brunch_lunch_casual` and `.movies_theatre` |

**Admin — 2 files:**
- `mingla-admin/src/constants/categories.js` — `CATEGORY_DISPLAY_NAMES.brunch_lunch_casual` + `.movies_theatre` + `CATEGORY_COLORS` keyed on legacy slugs
- `mingla-admin/src/components/seeding/SeedTab.jsx` — primary_type → slug mapping (writes legacy slug into seeding_category)

**Business:** ZERO references — Business does not have any category-related code yet.

**Verdict per consumer:**

| Consumer category | Verdict | Cleanup at sunset |
|-------------------|---------|-------------------|
| `discover-cards` TRANSITIONAL aliases | LIVE — pre-OTA clients still hit | Remove after 2026-05-13 |
| `get-person-hero-cards` CATEGORY_TO_SIGNAL union | LIVE — same conduit | Remove after 2026-05-13 |
| `generate-curated-experiences` slug fallback default `'brunch_lunch_casual'` | LIVE — affects derived category | Replace default with new slug |
| `replace-curated-stop` VALID_CATEGORIES | LIVE — rejects requests not in this set | Replace legacy entries with new slugs |
| `admin-seed-map-strangers` ALL_CATEGORIES | LIVE — admin tool | Replace with modern split slugs |
| `categoryPlaceTypes.SLUG_TO_DISPLAY` | LIVE — backwards compat | Remove after 2026-05-13 |
| `seedingCategories.ts` 5 configs writing legacy `appCategorySlug` | **LIVE WRITE PATH** — every new seed adds to the 412 / 3,895 stale rows | **Must update before further seeding** |
| `mingla-admin/SeedTab.jsx` primary_type→slug map | **LIVE WRITE PATH** — admin seed UI writes legacy slug | Replace with new split slugs |
| `mingla-admin/constants/categories.js` | LIVE — display map; legacy chips still appear in admin | Replace |
| Mobile `deckService` deckMode union + name map + alias | LIVE — pre-OTA clients send legacy slug | Remove after 2026-05-13 |
| Mobile `utils/categoryUtils` LEGACY_CATEGORY_SLUGS | LIVE — backwards compat resolution | Remove after 2026-05-13 |
| Mobile UI icon/color maps for legacy slugs | LIVE — defensive defaults | Remove after 2026-05-13 |
| Mobile i18n locale files | LIVE — descriptions for legacy chip if user has stored preference | Remove after 2026-05-13 |

**Confidence:** H+ (greps cite exact file:line; verdicts derive from code reads).

## R6 — Migration archaeology

**Verdict:** The `rule_sets` legacy slugs were seeded ONCE on 2026-04-19 and have NEVER been migrated since. The ORCH-0597 + ORCH-0598 splits never updated `rule_sets` data.

**Migrations touching `rule_*` tables (chronological):**

```
20260420000001_create_rules_engine_tables.sql       schema  (creates rule_sets, rule_set_versions, rule_entries)
20260420000002_seed_rules_engine_v1.sql             DATA    (seeds ALL 18 rules with current scope_value strings — including 'movies_theatre' + 'brunch_lunch_casual')
20260420000003_create_rules_engine_rpcs.sql         RPCs    (admin_rules_*)
20260420000005_fix_rules_rpcs_to_jsonb.sql          RPCs    (jsonb conversion)
20260421000010_orch_0550_2_rules_filter_polish.sql  RPCs    (display polish)
20260425000002_orch_0640_rules_engine_carveout.sql  schema  (renames ai_validation_jobs→rules_runs, ai_validation_results→rules_run_results, drops ai_validation_batches)
```

**Migration grep for legacy slug literals** (`movies_theatre|brunch_lunch_casual`):
- `20260420000002_seed_rules_engine_v1.sql` ← the ONLY rule-touching migration referencing these slugs.

No subsequent migration:
- Renamed scope_value
- Created modern-slug rule_sets rows
- Soft-deleted the legacy rules
- Migrated `seeding_category` or `ai_categories` data

**Last writer wins:** for `rule_sets`, the seed migration on 2026-04-19 IS the current truth. ORCH-0597 (Brunch+Casual split) and ORCH-0598 (Movies+Theatre split) updated edge functions, mobile constants, and admin display — but not the `rule_sets` data layer. The split was logically completed in serving but never reached the rules engine.

**Confidence:** H+ (`ls` of all 472 migrations + grep filtering).

## R7 — `RESTAURANT_TYPES` constant chase

**Verdict:** `RESTAURANT_TYPES` is COMPLETELY DEAD CODE in the runtime. The DB rule_set has 55 live entries; the string `RESTAURANT_TYPES` appears in:

- `BRUNCH_CASUAL_BLOCKED_TYPES.thresholds.exempt_if_primary_in = "RESTAURANT_TYPES"` (DB)
- `FINE_DINING_PROMOTION_T1.thresholds.requires_in = "RESTAURANT_TYPES"` (DB)
- `FINE_DINING_PROMOTION_T2.thresholds.requires_in = "RESTAURANT_TYPES"` (DB)
- `UPSCALE_CHAIN_PROTECTION.thresholds.guards_rule = "CASUAL_CHAIN_DEMOTION"` (cross-reference convention)
- `CASUAL_CHAIN_DEMOTION.thresholds.guarded_by = "UPSCALE_CHAIN_PROTECTION"`

**Code consumption probe:**

```bash
grep "RESTAURANT_TYPES" supabase/functions/  →  No matches found
```

ZERO TypeScript / Deno consumers of the string `RESTAURANT_TYPES` exist. The thresholds field is dead string data — no consumer ever resolves the constant.

**Live entry sample (positions 1-10 of 55):**
`restaurant, fine_dining_restaurant, american_restaurant, asian_restaurant, asian_fusion_restaurant, barbecue_restaurant, brazilian_restaurant, caribbean_restaurant, chinese_restaurant, ethiopian_restaurant, ...`

**Implication:** The exempt-if/requires-in logic referenced in `BRUNCH_CASUAL_BLOCKED_TYPES` and `FINE_DINING_PROMOTION_T1/T2` was an ASPIRATIONAL design feature that never shipped. This is a third "designed but unwired" element of the rules engine.

**Confidence:** H+ (grep + live SQL on rule_entries).

## R8 — Admin UI rule-editor behavior under split

**Verdict:** Admin cannot create new rules from the UI. Only existing rules can be edited/rolled-back.

**Evidence:**

1. **No `admin_rules_create` RPC** in pg_proc. The full RPC set is enumerated in R3.
2. **`admin_rules_save`** signature is `(p_rule_set_id uuid, p_new_entries jsonb, p_change_summary text, p_new_thresholds jsonb)` — requires an EXISTING `rule_set_id`. It can only modify entries + thresholds of a rule that's already been seeded.
3. **`RuleSidePanel.jsx`** loads `admin_rule_detail` for an existing `ruleSetId` and exposes Add/Remove entry pills + thresholds editor. No "Create Rule" UI surface.
4. **Admin UI scope dropdown** — N/A; admins cannot change `scope_value` on existing rules either (no UI control surfaces it).

**Implication:** Even if an operator wanted to create modern-split rules (`movies`, `theatre`, `brunch`, `casual_food`, `fine_dining`), they CANNOT do so via the admin UI. A new rule would require a database migration. The dispatch's question "if an admin creates a new rule scoped to `movies`, will any consumer fire it?" is doubly moot:
- The admin can't create the rule
- Even if they could, no consumer reads `rule_sets` at runtime

**Confidence:** H+ (grep `create_rule|new_rule|admin_rules_create` returned 0 admin matches; pg_proc enumeration matches; `RuleSidePanel.jsx` reading confirms).

## R9 — `place_scores` and category serving alignment

**Verdict:** Serving uses `signal_id` (modern split slug). Place_pool's `seeding_category` and `ai_categories` columns are NEVER read at serving time. Zero alignment risk.

**Evidence:**

1. **`query_servable_places_by_signal`** live source (1,431 chars from pg_proc.prosrc):

   ```sql
   SELECT pp.id AS place_id, pp.google_place_id, pp.name, pp.address, pp.lat, pp.lng,
          pp.rating, pp.review_count, pp.price_level, ...,
          ps.score AS signal_score, ps.contributions AS signal_contributions
   FROM public.place_pool pp
   JOIN public.place_scores ps ON ps.place_id = pp.id AND ps.signal_id = p_signal_id
   WHERE pp.is_servable = true
     AND pp.is_active = true
     AND ps.score >= p_filter_min
     AND pp.stored_photo_urls IS NOT NULL
     AND array_length(pp.stored_photo_urls, 1) > 0
     AND NOT (... __backfill_failed__ ...)
     AND (haversine_distance) <= p_radius_m
     AND NOT (pp.id = ANY(p_exclude_place_ids))
   ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST
   LIMIT p_limit;
   ```

   Filters: `is_servable`, `is_active`, signal score, photo gate, distance, exclusions. **Zero reference to `seeding_category` or `ai_categories`.**

2. **Caller passes `p_signal_id`** = modern slug. Live `discover-cards/index.ts:79-96` `CATEGORY_TO_SIGNAL` map:
   - `'Movies' / 'movies'` → `signalIds: ['movies']`, filterMin=80
   - `'Theatre' / 'theatre'` → `signalIds: ['theatre']`, filterMin=120
   - `'movies_theatre'` (TRANSITIONAL) → `signalIds: ['movies', 'theatre']`, filterMin=100 (parallel-RPC merge)
   - `'brunch_lunch_casual'` (TRANSITIONAL) → `signalIds: ['brunch', 'casual_food']`, filterMin=120
   - All other modern chips routed to single signal slugs.

3. **`place_scores` per-signal counts** (live SQL): every active signal has 14,412 scored places (groceries 9,744 — that's the only with-coverage gap). No deck-empty risk from slug mismatch.

**Confidence:** H+ (live pg_proc + code read + per-signal count SQL).

## R10 — Cron + materialized view dependencies

**Verdict:** Zero cron jobs touch `rule_sets`. ONE materialized view (`admin_place_pool_mv`) reads `ai_categories` and is consumed by 10 admin RPCs.

**Live `cron.job` enumeration (11 active jobs):**

| jobid | name | schedule | touches rule_sets? | touches ai_categories? |
|-------|------|----------|-------------------|----------------------|
| 1 | keep-functions-warm | */5 * * * * | no | no |
| 2 | cleanup-old-notifications | 0 3 * * 0 | no | no |
| 3 | notify-lifecycle-daily | 0 10 * * * | no | no |
| 4 | notify-calendar-reminder-hourly | 15 * * * * | no | no |
| 5 | notify-holiday-reminder-daily | 0 9 * * * | no | no |
| 6 | compute-engagement-scores-weekly | 0 6 * * 1 | no | no |
| 7 | notify-birthday-reminder-daily | 0 9 * * * | no | no |
| 8 | cleanup-stale-leaderboard-presence | 0 * * * * | no | no |
| 9 | expire-tag-along-requests | 0 * * * * | no | no |
| **13** | **refresh_admin_place_pool_mv** | **\*/10 \* \* \* \*** | no | **YES (indirect)** |
| 14 | orch_0558_match_telemetry_purge | 0 3 * * * | no | no |

**Live `pg_matviews`:** ONE matview. Definition (key columns):

```sql
SELECT pp.id, pp.google_place_id, pp.name, pp.city_id, sc.country_code, ...,
       pp.seeding_category,
       pp.ai_categories,
       COALESCE(pp.ai_categories[1], 'uncategorized'::text) AS primary_category,
       pp.types, pp.primary_type, pp.rating, pp.review_count, pp.price_level,
       pp.is_active, pp.is_servable, pp.bouncer_validated_at, pp.bouncer_reason, ...
FROM (place_pool pp LEFT JOIN seeding_cities sc ON ((pp.city_id = sc.id)));
```

**Consumers of `admin_place_pool_mv`** (live `pg_proc.prosrc`):

```
admin_place_category_breakdown
admin_place_city_overview
admin_place_country_overview
admin_place_photo_stats
admin_place_pool_city_list
admin_place_pool_country_list
admin_place_pool_overview
admin_pool_category_health
admin_refresh_place_pool_mv
cron_refresh_admin_place_pool_mv
```

10 RPCs. All admin namespace. Mobile + Business never read this matview directly.

**Implication for ai_categories decommission:**
- `admin_place_pool_mv` MUST be rebuilt (drop `ai_categories`, drop `primary_category`, replace with `mapPrimaryTypeToMinglaCategory(primary_type, types)` derivation OR drop entirely)
- All 10 admin RPCs above must be audited for whether they read `ai_categories` or `primary_category` from the matview
- Cron job 13 will refresh the matview every 10 minutes — once the matview is rebuilt without `ai_categories`, the cron stays the same (just refreshes the new shape)

**Confidence:** H+ (live cron.job + pg_matviews + pg_proc enumeration).

---

# 2. Discoveries (beyond dispatch scope)

| ID | Discovery | Severity | Implication |
|----|-----------|----------|-------------|
| **D-NEW-1** | Signal slug ↔ chip slug name mismatches: `fine_dining` (signal) vs `upscale_fine_dining` (everywhere); `drinks` (signal) vs `drinks_and_music` (everywhere) | M | Routing maps bridge it (`get-person-hero-cards/index.ts:185-211`). Future-spec cleanup; not blocking. |
| **D-NEW-2** | Live empirical leak counts beyond Movies: `casual_food` ≥80 has 145 bar + 14 sports_bar; `brunch` ≥80 has 107 bar | S2 | Out-of-scope of ORCH-0700 but should be registered as separate signal-tightening tickets (or a single signal-quality-pass ticket). |
| **D-NEW-3** | `RESTAURANT_TYPES` is dead string data — 55 entries, zero consumers. `MIN_DATA_GUARD` and `FINE_DINING_PROMOTION_T1/T2` have ZERO entries (pure threshold rules). The whole rules engine is "designed but unwired" admin scaffolding. | M | Consider deactivating + dropping the entire rule_sets table during ORCH-0700 cleanup (4-table cascade: rule_sets, rule_set_versions, rule_entries, rules_run_results, rules_runs). 14 admin RPCs become orphan. |
| **D-NEW-4** | Admin UI has no rule-creation surface — only edits existing seeded rules. Combined with R3, this means the entire rules engine is currently a one-shot view-only artifact frozen since 2026-04-19. | M | Strengthens D-NEW-3 — drop the table, drop the RPCs, drop the admin UI tab. |
| **D-NEW-5** | `admin_place_pool_mv` definition includes `COALESCE(pp.ai_categories[1], 'uncategorized') AS primary_category` — meaning admin pages that show "primary_category" derive it from the FIRST entry in the legacy `ai_categories` array. Post-decommission, this field becomes `'uncategorized'` for every row unless the matview is rewritten. | H | Mandatory matview rewrite as part of ai_categories decommission (covered by sub-audit's INV I-MV-COLUMN-COVERAGE). |
| **D-NEW-6** | `seedingCategories.ts` has FIVE configs whose `appCategorySlug` is `'movies_theatre'` or `'brunch_lunch_casual'`. Combined with `admin-seed-places/index.ts:716` (`seeding_category: config.appCategorySlug`), this is a CONTINUOUSLY-BLEEDING write path: every new admin seed ADDS to the 412 / 3,895 stale legacy rows. | H | Must update `seedingCategories.ts` BEFORE any further seeding runs, or new rows continue to populate legacy slugs. |
| **D-NEW-7** | `mingla-admin/SeedTab.jsx` primary_type→slug map ALSO writes legacy slugs (15+ entries mapping to `'brunch_lunch_casual'` and 9+ to `'movies_theatre'`). Same continuously-bleeding write path on the admin client side. | H | Must update with `seedingCategories.ts`. |
| **D-NEW-8** | `replace-curated-stop/index.ts:11-15` has a hardcoded `VALID_CATEGORIES` set listing legacy bundled slugs but NOT the new modern split slugs (`brunch`, `casual_food`, `movies`, `theatre`). This means a curated-stop replacement request with a modern slug will be REJECTED. | S2 | Live bug. If any curated-experience flow uses modern slugs, it silently fails. Verify operator wants to fix as part of ORCH-0700 or separate ticket. |
| **D-NEW-9** | `generate-curated-experiences/index.ts:706` fallback default for derived category is hardcoded `'brunch_lunch_casual'` — which becomes a stale-default once that slug is removed. | M | Replace fallback with modern slug. |
| **D-NEW-10** | The `rules_runs` history shows ZERO runs since 2026-04-20 (12 days ago). The 4 historical runs all wrote `decision='reject'` with 1959 total reject rows — this was the OLD AI validation pipeline that was decommissioned in favor of bouncer + signal scorer. | L | Confirms rules engine has been dormant for 12+ days. Tables can be archived. |

---

# 3. Decision matrix — legacy rule_sets remediation

For each of the two legacy rules (`MOVIES_THEATRE_BLOCKED_TYPES`, `BRUNCH_CASUAL_BLOCKED_TYPES`), three options:

| Option | What it means | Production impact | Admin UI impact | Spec complexity |
|--------|---------------|-------------------|-----------------|-----------------|
| **SPLIT** | Create new rules: `MOVIES_BLOCKED_TYPES` (scope=movies, copy of 41 entries), `THEATRE_BLOCKED_TYPES` (scope=theatre, possibly tighter list), `BRUNCH_BLOCKED_TYPES` (scope=brunch, copy of 36), `CASUAL_FOOD_BLOCKED_TYPES` (scope=casual_food, copy of 36). Deactivate the bundled originals. Same for `CASUAL_CHAIN_DEMOTION.thresholds.demote_to`. | **Zero** — no consumer reads rule_sets at runtime. | Admin sees correct modern-slug rules in the rules dashboard. Future-state alignment. | Medium — 4 INSERT migrations + UPDATE the bundled originals to is_active=false + UPDATE thresholds.demote_to on `CASUAL_CHAIN_DEMOTION` |
| **DELETE** | DELETE the two bundled rules + `CASUAL_CHAIN_DEMOTION` (which writes legacy slug). DROP CASCADE removes their versions + entries. | **Zero** — same reason. | Admin sees fewer rules; the "drift detection" check at `admin_rules_overview` (`IF (SELECT COUNT(*) FROM public.rule_sets WHERE is_active = true) < 18`) would flag a warning until the threshold is updated. | Low — 1 DELETE migration + UPDATE the drift-threshold constant from 18 to 15 |
| **ZOMBIE** | Leave as-is. | **Zero** — same. | Admin sees stale legacy rules forever; new admin onboarding creates confusion. Tech debt. | None |
| **NUKE-ALL** (D-NEW-3+4 fusion) | Drop the entire rules engine: `rule_sets`, `rule_set_versions`, `rule_entries`, `rules_runs`, `rules_run_results`, all 14 admin_rules_* RPCs, the `mingla-admin/src/components/rules-filter/` UI, the cron-irrelevant rules infra. | **Zero** — empirically dormant since 2026-04-20 with no runtime consumers. | Admin loses Rules dashboard tab entirely. Removes "designed but unwired" infrastructure. | High — multi-migration sequence + admin UI removal + 14 RPC drops + invariant cleanup |

**My recommendation: SPLIT, with NUKE-ALL deferred to a separate cycle.**

Reasoning:
- DELETE risks "we'll regret this later" — the rules engine architecture (immutable versions, append-only entries, dry-run preview, rollback, run history) is genuinely well-designed scaffolding. If the operator wants to wire bouncer/scorer to read from this engine in a future cycle, the scaffolding is ready.
- ZOMBIE accumulates confusion debt — the legacy slugs in admin will trip every new engineer / agent reading the system.
- NUKE-ALL is the most architecturally honest answer (D-NEW-3 + D-NEW-4 establish the engine is currently a one-shot frozen artifact), but it's a much larger blast radius and deserves its own ticket so the operator can weigh keeping the engine alive for future use.
- SPLIT keeps the engine viable AND aligns admin display with the modern split. Lowest risk, cleanest forward path.

If the operator picks NUKE-ALL, register it as ORCH-0705 (separate from ORCH-0700) so the spec scope stays tight.

---

# 4. Open questions for operator

| OQ | Question | Why it matters |
|----|----------|----------------|
| OQ-1 | SPLIT, DELETE, ZOMBIE, or NUKE-ALL for the legacy rule_sets? Recommendation = SPLIT (per §3). | Determines spec scope for the rules-engine cleanup. |
| OQ-2 | If SPLIT for `MOVIES_THEATRE_BLOCKED_TYPES`, should the `theatre` half use the same 41-item blocklist, or a tighter curated subset (e.g., admit `restaurant` near a theatre district)? | Affects new rule_entries. Default = same 41 items unless operator wants curation. |
| OQ-3 | If SPLIT for `BRUNCH_CASUAL_BLOCKED_TYPES`, should `brunch` and `casual_food` get identical 36-item blocklists, or differ (e.g., breakfast_restaurant included in casual exclusion but not brunch)? | Default = identical unless operator wants curation. |
| OQ-4 | D-NEW-2 surfaced 145 bar + 14 sports_bar leaking into Casual; 107 bar leaking into Brunch. Fix in this cycle (extend Movies cinemas-only spirit to Casual+Brunch bar-cleanup) or defer to a separate signal-tightening ticket? | Affects ORCH-0700 scope. |
| OQ-5 | D-NEW-8 surfaced `replace-curated-stop` rejecting modern slugs. Fix in ORCH-0700 (which is now the "category-truth alignment" cycle anyway) or defer? | Affects ORCH-0700 scope. |
| OQ-6 | Sunset dates 2026-05-12 / 2026-05-13 are 10-11 days from today (2026-05-02). Should ORCH-0700 ship BEFORE the sunset (so all the legacy compat code can be removed in the same cycle), or AFTER (giving ai_categories decommission its own cycle, then a follow-up to remove transitional aliases)? | Affects sequencing. |
| OQ-7 | Per D-NEW-1, signal slug `fine_dining` ≠ chip slug `upscale_fine_dining`; signal `drinks` ≠ chip `drinks_and_music`. Rename signals to match (1 migration), or keep the routing maps as the bridge? | Future-spec cleanup; not blocking ORCH-0700. |

---

# 5. What this audit changed about ORCH-0700 framing

**Before audit:** The prevailing framing was "the legacy rule_sets are silently inactive — we need to SPLIT them so admin protection fires for movies / theatre / brunch / lunch / casual."

**After audit:** The legacy rule_sets are silently inactive because **the rules engine has zero runtime consumers.** Splitting them produces correct admin-display semantics but no production behavior change. The Movies-pill leak fix lives in the SIGNAL scorer (the operator's already-confirmed Path 1 = strip theatre weights from `movies` signal v1.10.0), NOT in `rule_sets`.

**Updated mental model:**
- **rule_sets** = admin-only scaffolding, frozen since 2026-04-19, zero runtime impact
- **signal_definitions + signal_definition_versions** = the LIVE category-quality system (modern slugs, read by `run-signal-scorer` to populate `place_scores`)
- **place_scores** = the LIVE serving truth (joined by `query_servable_places_by_signal` filtering on `signal_id`)
- **place_pool.seeding_category + ai_categories** = stale legacy classification columns, admin-display only via `admin_place_pool_mv`
- **Bouncer + signal scorer = pure functions** with hardcoded type lists; do not consult any DB rule table

**Implication for ORCH-0700 spec writing:**
- The Movies cinemas-only fix is purely a `signal_definition_versions` row update for the `movies` signal (drop theatre type weights). Migration v1.10.0.
- The ai_categories decommission must STILL happen as planned (place_pool column drop + matview rebuild + 56 i18n cleanup + transitional alias removal post-sunset).
- The legacy rule_sets remediation is a SEPARATE deliverable — admin-cleanup hygiene, not production safety.

---

# 6. Confidence summary

| Thread | Confidence | Source |
|--------|-----------|--------|
| R1 — rule_sets inventory | H+ | Live SQL on rule_sets + rule_set_versions + rule_entries |
| R2 — category enumeration | H+ | 5 sources cross-referenced live |
| R3 — rule_sets consumers | H+ | grep across all 4 codebases + live pg_proc + bouncer/scorer source read |
| R4 — empirical legacy fire | H+ | Live SQL with primary_type joins on place_scores |
| R5 — legacy slug bombs | H+ | Greps with file:line cited |
| R6 — migration archaeology | H+ | `ls supabase/migrations` + grep |
| R7 — RESTAURANT_TYPES | H+ | grep + live rule_entries |
| R8 — admin UI rule editor | H+ | RuleSidePanel.jsx read + pg_proc enumeration |
| R9 — serving alignment | H+ | Live pg_proc.prosrc + discover-cards source |
| R10 — cron + matviews | H+ | Live cron.job + pg_matviews + pg_proc |
| Recommendation (SPLIT vs NUKE-ALL) | H | Reasoning depends on operator's future plans for the rules engine |

---

**END OF REPORT**
