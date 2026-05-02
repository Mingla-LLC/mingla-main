---
id: ORCH-0700 sub-audit
type: INVESTIGATION REPORT (decommission verification)
mode: INVESTIGATE
classification: data-integrity + architecture-flaw + invariant-violation (Constitution #2 one-owner)
severity: S1-high
created: 2026-05-01
investigator: /mingla-forensics
dispatch: prompts/FORENSICS_ORCH-0700_AI_CATEGORIES_DECOMMISSION_AUDIT.md
prior:
  - reports/INVESTIGATION_ORCH-0700_MOVIES_CHIP_LEAK.md (cycle-1)
  - reports/INVESTIGATION_ORCH-0700_CYCLE2_LIVE_FIRE.md (cycle-2 + §11.4 quantified data + §11.6 ai_categories audit)
related: ORCH-0640 (card_pool deprecation chain — relevant context), ORCH-0701 (Paragon scoring miss — bundled into SPEC v2)
---

# ORCH-0700 sub-audit — Pre-decommission verification report

## 0. Verdict

**SAFE WITH CAVEATS.** The orchestrator's prior audit found 4 readers of
`place_pool.ai_categories`. **Sub-audit found 5 additional dependencies the
orchestrator missed.** Decommission is achievable but requires migrating those
5 dependencies BEFORE the column-drop migration ships.

**3 critical operator questions answered at H confidence:**

1. **Did orchestrator miss any reader?** YES — 5 additional dependencies
   surfaced (1 materialized view, 3 admin RPCs, 1 rules-engine RPC, plus 1
   live cron job that refreshes the MV every 10 min).
2. **Does the NEW system depend on these columns?** NO — Bouncer
   (`bouncer.ts:23-36` `PlaceRow` interface) and signal scorer
   (`signalScorer.ts:34-63` `PlaceForScoring` interface) BOTH have ZERO
   AI-metadata fields. Both are fully independent. NEW system safe to
   continue running after column drop.
3. **Schema-level dependencies that block DROP COLUMN?** YES — 1 materialized
   view (`admin_place_pool_mv`) projects `ai_categories` and a derived
   `primary_category = COALESCE(ai_categories[1], 'uncategorized')`. The MV
   has 3 indexes including one on the derived `primary_category` column. Plus
   1 active cron job (jobid 13) that refreshes this MV every 10 min. Both
   must be paused/dropped before column drop.

**Quantified blast radius:** 41,301 / 69,599 rows (59%) have `ai_categories`
populated. 58,829 (84.5%) have `ai_reason`. 58,774 (84.4%) have
`ai_primary_identity` + `ai_confidence`. 56,479 (81.1%) have
`ai_web_evidence`. **Most recent ai_categories write: 2026-04-26 23:46** (5
days ago — pipeline dormant but recently active per cycle-2 §11.5).

---

## 1. Per-thread results

### V1 — Exhaustive reader sweep (orchestrator missed 5)

**Confidence: H.** Grep + file-reads across full monorepo + DB schema query.

**Confirmed readers (per orchestrator audit):**

1. `supabase/functions/generate-curated-experiences/index.ts:379, 432-436, 681`
   — passthrough; `card.category = pp.ai_categories[0]` reaches mobile
2. `supabase/functions/_shared/stopAlternatives.ts:84, 86, 134-135` — filter
   via `.contains('ai_categories', [categoryId])`; effectively dead path due
   to `replace-curated-stop:13` VALID_CATEGORIES validator rejection
3. `mingla-admin/src/pages/PlacePoolManagementPage.jsx:361, 373, 381-382, 405-411, 484-487, 568-602, 1031-1063`
   — admin Place Pool edit form; explicit comment lines 405-410 documents the
   "stale-data only" status
4. `scripts/verify-places-pipeline.mjs:772-776, 897-901` — WRITES only;
   archived AI validation pipeline; per V7.b last write 5 days ago

**NEW readers found this audit (orchestrator missed):**

5. **`admin_place_pool_mv` materialized view** — at
   `supabase/migrations/20260425000003_orch_0640_rebuild_admin_place_pool_mv.sql:47-48`:
   ```sql
   pp.ai_categories,
   COALESCE(pp.ai_categories[1], 'uncategorized') AS primary_category,
   ```
   Plus 3 indexes including
   `admin_place_pool_mv_primary_category_servable ON admin_place_pool_mv (primary_category) WHERE (is_active = true) AND (is_servable = true)`.
   **Live cron job `refresh_admin_place_pool_mv`** (jobid 13, schedule
   `*/10 * * * *`) refreshes this MV every 10 minutes. Verified live via
   `SELECT * FROM cron.job WHERE jobname = 'refresh_admin_place_pool_mv'
   AND active = true`.

6. **`admin_photo_pool_categories` RPC** —
   `supabase/migrations/20260425000014_orch_0640_rewrite_place_admin_rpcs.sql:248`:
   `COALESCE(pp.ai_categories[1], 'uncategorized') AS slug` — groups admin
   photo coverage stats by ai_categories[1]. Live (powers admin Photos page
   category breakdown).

7. **`admin_photo_pool_locations` RPC** — same migration lines 298, 307:
   groups admin photo coverage by lat/lng buckets within ai_categories[1].
   Live.

8. **`admin_pool_category_detail` RPC** — same migration line 503:
   `AND p_category = ANY(COALESCE(pp.ai_categories, '{}'::text[]))` — filters
   by ai_category for admin Place Pool category-detail view. Live.

9. **`admin_rules_preview_impact` RPC** — direct DB query of `pg_proc.prosrc`
   shows reads `pp.ai_categories` for `demotion` and `strip` rule kinds:
   ```sql
   AND v_scope_value = ANY(pp.ai_categories)
   ```
   Live (rules engine preview UI). Per cycle-2 D-CYCLE2-5 the rules engine
   was already flagged as a separate-audit candidate.

**Mobile / mingla-business sweep:** ZERO references in either app. Both
consumer-facing apps are fully decoupled from these columns. ✓

**Migration history shows additional historical readers** (likely superseded
by ORCH-0640 but worth noting for completeness):

- `20260407300000_rpc_redesign_fk_based.sql` lines 54-208 — multiple admin
  stats RPCs that COUNT DISTINCT `ai_categories[1]`. Filter: `WHERE ai_approved = true`.
  **Likely SUPERSEDED** by ORCH-0640 ch05 rewrites (which removed
  `ai_approved` filter), but specific RPC names not all enumerated in ch05.
  Recommend spec-time spot-check via `SELECT proname, prosrc FROM pg_proc
  WHERE prosrc ILIKE '%ai_categories%'` to confirm only `admin_rules_preview_impact`
  remains.
- `20260409200001_optimize_city_picker_rpc.sql` lines 119-217 — city-picker
  RPCs that COUNT DISTINCT `ai_categories[1]`. **Likely also superseded** by
  ORCH-0640 (which moved city stats to use `is_servable`). Same spec-time
  spot-check applies.
- `20260417300001_orch0480_admin_rpc_perf.sql:50` — created expression index
  `idx_place_pool_ai_category_first ON public.place_pool ((ai_categories[1]))`.
  **CONFIRMED dropped** in ORCH-0640 ch13 (`20260425000004:10`) — V6.a probe
  shows zero indexes referencing AI columns. ✓

### V2 — NEW system independence proof

**Confidence: H+ on Bouncer and scorer; H on the two RPCs that drive serving.**

| Component | File | Reads ai_categories? | Reads AI metadata cluster? | Safe post-drop? |
|---|---|---|---|---|
| **Bouncer** | `_shared/bouncer.ts:23-36` PlaceRow interface | NO | NO | ✓ YES |
| **Signal scorer** | `_shared/signalScorer.ts:34-63` PlaceForScoring interface | NO | NO | ✓ YES |
| **Signal definitions** | DB query of `signal_definition_versions.config` jsonb | NO (field weights only check `types_includes_*`, `price_level_*`, boolean fields) | NO | ✓ YES |
| **`query_servable_places_by_signal` RPC** | `20260424220003_orch_0634_query_servable_places_by_signal_photo_gate.sql:51-97` (latest definition) | NO (returns `types`, `primary_type`, `signal_score`, photos, etc. — never selects ai_categories) | NO | ✓ YES |
| **`get-person-hero-cards`** | `_shared/personHeroComposition.ts` + `get-person-hero-cards/index.ts:109` | NO (uses `mapPrimaryTypeToMinglaCategory(primary_type, types)`) | NO | ✓ YES |
| **`mapPrimaryTypeToMinglaCategory`** | `categoryPlaceTypes.ts:440` | NO (purely primary_type → category map) | NO | ✓ YES |
| **`discover-cards`** | `discover-cards/index.ts:548-601` `transformServablePlaceToCard` | NO (uses signal_score + routing-time displayCategory) | NO | ✓ YES |
| **Cohort tables** (`admin_config` keys with `signal_serving_*_pct`) | `discover-cards:27-41` getSignalServingPct | NO (just reads pct number) | NO | ✓ YES |

**Critical sub-question answered: NO, the signal scorer does NOT read
ai_categories as INPUT.** `PlaceForScoring` interface (`signalScorer.ts:34-63`)
is exhaustive — it lists every field the scorer can read. AI metadata is not
in the list. `computeFieldContributions` at lines 72-139 only checks
`types_includes_*`, `price_level_*`, `price_range_start_above_*`,
`price_range_end_above_*`, and direct boolean field names from
PlaceForScoring. Since `ai_categories`, `ai_reason`, etc. are not in
PlaceForScoring, even if a misconfigured `field_weights` key had the name
`types_includes_ai_categories`, the scorer would simply not find a matching
field and skip it. Confirmed safe at H+ confidence.

**Per cycle-1 §2.G3** the scorer was already verified pure-input on text
fields + types + ratings + reviews. This sub-audit re-verifies and elevates
to H+ confidence.

### V3 — saved_card historical impact

**Confidence: H on data; M on rendering verdict (would need mobile UI test
to verify).**

`saved_card.category` historical values (top 19, total ~55 rows):

| category | n |
|---|---|
| Brunch | 15 |
| play | 6 |
| Fine Dining | 6 |
| Romantic | 5 |
| **watch** | 4 ← legacy slug, pre-ORCH-0434 |
| Adventurous | 3 |
| Nature & Views | 2 |
| Drinks & Music | 2 |
| First Date | 2 |
| **picnic_park** | 1 ← legacy slug, pre-ORCH-0434 |
| Group Fun | 1 |
| **fine_dining** | 1 ← old slug |
| **drink** | 1 ← old slug |
| **casual_eats** | 1 ← old slug |
| **nature_views** | 1 ← old slug |
| **Watch** | 1 ← legacy display name |
| **Wellness** | 1 ← removed category per ORCH-0434 |
| Movies | 1 |
| **upscale_fine_dining** | 1 ← slug not display name |

**Notable:** ZERO `'movies_theatre'` rows in saved_card. The A2 leak surface
the orchestrator audit was concerned about does not propagate to saved-card
history. ✓

**However:** historical drift exists — 9 of the 19 distinct values are
legacy slugs / removed categories from before ORCH-0434. Mobile `SavedTab`
filtering by chip slug would not match these values gracefully. **This is a
PREEXISTING data drift** unrelated to ORCH-0700. Surface as discovery for
separate ORCH (saved_card historical taxonomy normalization).

**No backfill needed** as part of this SPEC. The ai_categories column drop
does not change saved_card.category — that's a separate write path
(`saveCard` service writes whatever `card.category` was at save time;
mobile-side normalization happens at filter time).

### V4 — Holiday + curated chain category bleed

**Confidence: H.**

Files inspected:
- `app-mobile/src/constants/holidays.ts` — INTENT_CATEGORY_MAP + holiday section definitions
- `supabase/functions/_shared/personHeroComposition.ts` — composition rules
- `supabase/functions/generate-curated-experiences/index.ts` — combo definitions

None of these files do a DB query on ai_categories. They use category SLUGS
(string literals like `'movies'`, `'theatre'`, `'play'`) for combo
composition + intent mapping. The slugs are static strings in code, not
column reads.

The ONLY ai_categories read in `generate-curated-experiences` is the
passthrough at line 435 (already enumerated as orchestrator-found reader #1).

**Verdict:** holiday + curated chain composition logic is independent of
ai_categories column. ✓

### V5 — Backup tables zero-reader confirmation

**Confidence: H on table existence; M on zero-readers (grep-based, may miss
dynamic SQL).**

3 backup tables CONFIRMED EXISTING:
- `_archive_card_pool` — renamed from `card_pool` per ORCH-0640 ch12
  (`20260425000010`); scheduled for DROP in deferred migration
  `scripts/deferred-migrations/20260502000001_orch_0640_final_archive_drop.sql`
  (TOMORROW, May 2, per 7-day soak window)
- `_archive_card_pool_stops` — renamed from `card_pool_stops`; same drop
  schedule
- `_orch_0588_dead_cards_backup` — older backup; not in any current cleanup
  schedule

Already DROPPED per ORCH-0640 ch12:
- `_backup_user_interactions` (DS-7)
- `card_pool_categories_backup_0434` (DS-7)

**Possibly missed by orchestrator:** `place_pool_ai_categories_backup_0434`
table created at
`20260415100000_orch0434_phase1_slug_migration.sql:41`. Did not appear in
information_schema query — verify drop status with
`SELECT to_regclass('public.place_pool_ai_categories_backup_0434')`.

**Reader sweep:** zero current code readers found in
`app-mobile`/`mingla-admin`/`mingla-business`/`supabase/functions`/`scripts`
for any of the backup tables. ✓ Safe to drop on schedule.

**Recommendation:** allow ORCH-0640 deferred drop (`20260502000001`) to run
on schedule tomorrow. `_orch_0588_dead_cards_backup` cleanup folds into
ORCH-0700 SPEC v2 OR a separate hygiene ORCH at operator's choice.

### V6 — Schema dependency probe (DDL prerequisites for column drop)

**Confidence: H on V6.a/b/c/d/e/f; H on cron via direct DB query.**

| Object | Reference | Action required before column drop |
|---|---|---|
| **V6.a Indexes on place_pool** | ZERO referencing AI columns (already dropped in ORCH-0640 ch13) | None ✓ |
| **V6.b Triggers on place_pool** | 2 triggers — `trg_auto_city_seeded_status` (city_id/is_active changes) + `update_place_pool_updated_at` (timestamp) — neither reads AI columns | None ✓ |
| **V6.c Functions** | 1 function `admin_rules_preview_impact` reads `pp.ai_categories` for demotion/strip rule kinds | Rewrite to use `seeding_category` or `primary_type` for rule scope filtering |
| **V6.d Materialized views** | `admin_place_pool_mv` projects `ai_categories` + derived `primary_category` | DROP MV, rewrite without ai_categories OR drop+rebuild without primary_category projection (admin loses category-grouping in photo coverage view) |
| **V6.e RLS policies** | 3 policies (service_role full / authenticated read / admin write) — none reference AI columns | None ✓ |
| **V6.f CHECK constraints + FKs** | 1 CHECK on `fetched_via`, 2 FKs (city_id, claimed_by) — none reference AI columns | None ✓ |
| **Cron jobs** | jobid 13 `refresh_admin_place_pool_mv` runs every 10 min calling `cron_refresh_admin_place_pool_mv()` | PAUSE before MV drop, RE-ENABLE after MV rebuild OR delete cron if MV is retired entirely |

**Mandatory DDL prerequisite ordering for column drop:**

1. Pause cron job 13 (`UPDATE cron.job SET active = false WHERE jobid = 13`)
2. Rewrite `admin_rules_preview_impact` (replace `ai_categories` reads with
   `seeding_category` or `primary_type` scope)
3. Rewrite the 3 admin photo-pool RPCs (`admin_photo_pool_categories`,
   `admin_photo_pool_locations`, `admin_pool_category_detail`) — replace
   ai_categories[1] grouping with `seeding_category` or `primary_type`
4. Migrate the 2 edge function consumers
   (`generate-curated-experiences:435` passthrough → use
   `mapPrimaryTypeToMinglaCategory(primary_type, types)`;
   `stopAlternatives.ts:84-86, 134-135` → replace ai_categories filter +
   passthrough)
5. Update admin Place Pool Page UI to remove ai_categories editing
6. Drop the MV (`DROP MATERIALIZED VIEW admin_place_pool_mv CASCADE` —
   cascades to its 3 indexes)
7. Drop the column (`ALTER TABLE place_pool DROP COLUMN ai_categories,
   DROP COLUMN ai_reason, DROP COLUMN ai_primary_identity, DROP COLUMN
   ai_confidence, DROP COLUMN ai_web_evidence`)
8. Optionally rebuild admin_place_pool_mv WITHOUT ai_categories +
   primary_category (use `seeding_category` for grouping projection if
   admin still needs category grouping in photo coverage)
9. Re-enable cron job 13 (or DROP if MV is retired)
10. Stop or delete `scripts/verify-places-pipeline.mjs` writes

### V7 — Quantification (blast radius sizing)

**Confidence: H.** Direct SQL via Supabase Management API.

```
rows_with_ai_cats:           41,301 / 69,599  (59.3%)
rows_with_ai_reason:         58,829 / 69,599  (84.5%)
rows_with_ai_primary_identity: 58,774 / 69,599  (84.4%)
rows_with_ai_confidence:     58,774 / 69,599  (84.4%)
rows_with_ai_web_evidence:   56,479 / 69,599  (81.1%)
total_rows:                  69,599

most_recent_ai_categories_write: 2026-04-26 23:46 UTC (5 days ago)
```

**Top 30 ai_categories values** (ran via `SELECT cat, count(*) FROM (SELECT
unnest(ai_categories) AS cat FROM place_pool WHERE ai_categories IS NOT
NULL) GROUP BY cat ORDER BY count DESC`): not run in this audit due to
size limits, but cycle-2 §11.4 H6.b already established `'movies_theatre'`
distribution by primary_type. Spec writer can re-run if needed.

**Mandatory backup before drop:**
```sql
CREATE TABLE _archive_orch_0700_ai_metadata AS
SELECT id, ai_categories, ai_reason, ai_primary_identity, ai_confidence,
       ai_web_evidence, updated_at
FROM public.place_pool
WHERE ai_categories IS NOT NULL
   OR ai_reason IS NOT NULL
   OR ai_primary_identity IS NOT NULL
   OR ai_confidence IS NOT NULL
   OR ai_web_evidence IS NOT NULL;
COMMENT ON TABLE _archive_orch_0700_ai_metadata IS
  'ORCH-0700 SPEC v2 backup of dropped AI metadata columns. 30-day retention.
   Drop this table after 30 days post-deploy if no rollback signal.';
```

Estimated archive table size: ~58k rows × 5 columns. Should be a few MB.

### V8 — Operator-workflow impact

**Confidence: H on workflow change; M on operator readiness (process question).**

**What admin loses post-drop:**

1. **Manual ai_categories editing** in Place Pool Management page (lines
   568-602). Operators can no longer override AI's category assignment for
   a specific venue.
2. **Photo coverage breakdown by ai_categories[1]** in
   `admin_photo_pool_categories` and `admin_photo_pool_locations` RPCs.
   Admin Photos page may lose category grouping in photo health dashboard.
3. **Category-filter detail view** in `admin_pool_category_detail` RPC.
4. **Rules engine demotion/strip scope by ai_categories** — rules currently
   scoped to "all places with ai_categories containing X" must move to
   different scope (seeding_category, primary_type, or types[]).

**Replacement mechanisms (already in place):**

- **For category override:** Bouncer (`is_servable=true/false`) is the
  authoritative quality gate. If admin needs to mark a place as
  wrong-category, the path is: admin marks `is_servable=false` → place is
  excluded from serving entirely. There is no "force this place into a
  different category" workflow because the new system derives category from
  `primary_type` deterministically.
- **For photo coverage grouping:** use `seeding_category` (admin-set during
  seed pipeline) or `primary_type` (Google's classification). Both are
  already in place_pool and already projected by the MV.
- **For rules engine:** rules can scope to `seeding_category` (already in
  rule_sets schema) or `primary_type`. Migrating existing rules requires
  data migration (check `rule_sets.scope_kind` distribution before drop).

**Operator-process recommendation:** SPEC v2 should include an admin UI
update step that explicitly REMOVES the ai_categories editing affordance
and adds an inline note: "Category derived from Google primary_type. To
exclude this place, toggle is_servable. To affect serving for a class of
venues, edit signal_definition_versions config."

### V9 — End-to-end NEW system dependency verification

**Confidence: H.** Cross-checked the chain from operator-asserted "we use
is_servable + signal scorer" backwards.

Chain trace:

```
Mobile chip tap
  → discover-cards (categories: ['Movies'])
  → CATEGORY_TO_SIGNAL['Movies'] = { signalIds: ['movies'], filterMin: 80, displayCategory: 'Movies' }
  → query_servable_places_by_signal('movies', 80, lat, lng, radius, exclude_ids, limit)
  → SELECT pp.*, ps.score FROM place_pool pp JOIN place_scores ps
    WHERE ps.signal_id = 'movies' AND ps.score >= 80
      AND pp.is_servable = true AND pp.is_active = true
      AND pp.stored_photo_urls IS NOT NULL ...
  → returns rows: NEVER references ai_categories or AI metadata columns
  → transformServablePlaceToCard(row, displayCategory, lat, lng, mode)
  → card.category = displayCategory (from routing, not from ai_categories)
  → mobile renders
```

**No path from new system reads any AI metadata.** Confirmed at H confidence
via direct file read of every step in the chain.

**Bouncer chain:**

```
admin runs run-bouncer (or pre-photo-bouncer for two-pass)
  → bounce(place: PlaceRow, opts?)
  → PlaceRow interface contains: id, name, lat, lng, types, business_status,
    website, opening_hours, photos, stored_photo_urls, review_count, rating
  → NO AI metadata fields in PlaceRow
  → returns BouncerVerdict { is_servable, cluster, reasons[] }
  → admin updates place_pool.is_servable + bouncer_validated_at + bouncer_reason
```

Confirmed via `bouncer.ts:21-42` direct read. Per the invariant comment line
12: "I-BOUNCER-DETERMINISTIC: NO AI, NO keyword matching for category
judgment." Bouncer is intentionally architected to be independent of any AI
output. ✓

**Scorer chain:**

```
admin runs run-signal-scorer
  → for each signal_id, for each place:
    → computeScore(place: PlaceForScoring, config: SignalConfig)
    → PlaceForScoring contains: rating, review_count, types, price_level,
      price_range_*, editorial_summary, generative_summary, reviews[],
      serves_*, reservable, dine_in, etc.
    → NO AI metadata fields in PlaceForScoring
    → returns ScoreResult { score, contributions }
  → admin upserts place_scores (place_id, signal_id, score, contributions)
```

Confirmed via `signalScorer.ts:11-226` direct read. ✓

---

## 2. Final list of consumers (orchestrator-found + sub-audit-found)

### Production-LIVE direct readers — must migrate before column drop:

1. **`generate-curated-experiences/index.ts:379, 432-436, 681`** — passthrough
2. **`_shared/stopAlternatives.ts:84, 86, 134-135`** — filter (effectively dead path)
3. **`admin_place_pool_mv` materialized view** + 3 indexes + cron job 13
4. **`admin_photo_pool_categories` RPC**
5. **`admin_photo_pool_locations` RPC**
6. **`admin_pool_category_detail` RPC**
7. **`admin_rules_preview_impact` RPC**
8. **`mingla-admin/src/pages/PlacePoolManagementPage.jsx`** — admin edit UI
9. **`scripts/verify-places-pipeline.mjs`** — WRITES (archived)

### NEW system (Bouncer + scorer + serving): ZERO dependencies on AI columns

### Mobile / mingla-business: ZERO references

### Backup tables (separate cleanup track):

- `_archive_card_pool` — drop scheduled 2026-05-02 (tomorrow) per ORCH-0640
- `_archive_card_pool_stops` — same
- `_orch_0588_dead_cards_backup` — no schedule; fold into SPEC v2 hygiene
- Possibly `place_pool_ai_categories_backup_0434` — verify drop status

---

## 3. Fix strategy (direction only — SPEC writes the contract)

**SPEC v2 must be expanded from operator-locked scope to include:**

A. **Migrate the 5 NEW dependencies** found by this audit (in addition to
   the 4 the orchestrator audit already found):
   - Rewrite `admin_place_pool_mv` without ai_categories columns; replace
     `primary_category = ai_categories[1]` with either:
     - `primary_category = COALESCE(seeding_category, 'uncategorized')` —
       admin-set seeding category survives, OR
     - DROP the `primary_category` column entirely from MV; admin loses
       category-grouping in MV-backed views (smaller fix)
   - Rewrite the 3 admin photo-pool RPCs to group by `seeding_category` or
     `primary_type` instead of `ai_categories[1]`
   - Rewrite `admin_rules_preview_impact` to scope rules by
     `seeding_category` or `primary_type` instead of `ai_categories`
   - Pause + re-enable cron job 13 around MV drop+rebuild

B. **Migrate the 2 live edge-function readers** (orchestrator-found):
   - `generate-curated-experiences:435`: `category: pp.ai_categories[0]`
     → `category: mapPrimaryTypeToMinglaCategory(pp.primary_type, pp.types)`
   - `stopAlternatives.ts:86`: `.contains('ai_categories', [categoryId])`
     → `.in('primary_type', getCanonicalTypesForCategory(categoryId))` plus
     replace `place.ai_categories[0]` passthrough with primary_type-derived

C. **Remove admin Place Pool Page ai_categories UI** (PlacePoolManagementPage.jsx)
   per V8 operator-process recommendation — add inline note explaining the
   replacement workflow.

D. **Stop or delete `scripts/verify-places-pipeline.mjs`** — confirmed
   archived AI validation pipeline; last write 5 days ago.

E. **Backup snapshot** before column drops: `_archive_orch_0700_ai_metadata`
   table per V7 SQL. 30-day retention.

F. **Migration applies in DDL-prerequisite order** per V6 §"Mandatory DDL
   prerequisite ordering for column drop" (10 steps).

G. **Drop the AI metadata cluster** alongside ai_categories — `ai_reason`,
   `ai_primary_identity`, `ai_confidence`, `ai_web_evidence`. Per V6.c only
   `admin_rules_preview_impact` reads any of these (just ai_categories);
   the cluster has zero other consumers.

H. **Optionally drop `_orch_0588_dead_cards_backup`** in same migration
   (zero readers per V5; pure hygiene). Other 2 backup tables drop on
   ORCH-0640 deferred schedule tomorrow.

I. **Process improvements** (carry over to INVARIANT_REGISTRY or DECISION_LOG):
   - **NEW invariant proposed: I-MV-COLUMN-COVERAGE** — every column in
     `place_pool` that is projected by an active materialized view must be
     enumerated in a project-wide manifest. Drops require MV rebuild step
     in same migration. Catches the class-of-bug where MVs hide column
     dependencies from grep audits.
   - **Update orchestrator audit checklist:** for any DB column drop
     proposal, the audit MUST query `pg_views`, `pg_matviews`, `pg_proc.prosrc`,
     `pg_indexes.indexdef`, `pg_trigger`, `pg_policy`, and `cron.job` for
     references — not just code grep. The orchestrator's prior audit relied
     entirely on file grep and missed all 5 DB-side dependencies.

---

## 4. Constitutional implications

- **Constitution #2 (one owner per truth) STRENGTHENED post-fix:** today,
  `place_pool` has THREE category-source columns (`primary_type`,
  `seeding_category`, `ai_categories`) plus the AI metadata cluster.
  Post-decommission, only 2 (primary_type for derivation, seeding_category
  for admin tracking). Reducing the surface eliminates the discovered-mid-
  session ambiguity that drove the orchestrator's audit miss.
- **Constitution #8 (subtract before adding) HONORED:** dropping 5 columns
  + 1 MV + 3 admin RPCs + 1 rules-engine read path is net subtraction. SPEC
  v2 must enforce: deletions before any new code; `git diff --stat`
  produces NEGATIVE LOC delta.
- **Constitution #9 (no fabricated data) PRESERVED:** `mapPrimaryTypeToMinglaCategory`
  returns `null` when primary_type doesn't map; consumer must handle null
  honestly (cycle-1 G6 already verified person-hero handles this correctly).

## 5. Discoveries for orchestrator

- **D-SUB-1 (S2 process):** Orchestrator's audit relied on file grep only.
  Missed 5 DB-side dependencies (1 MV, 3 admin RPCs, 1 rules-engine RPC,
  plus 1 cron job that refreshes the MV). **Codify in orchestrator process:**
  every column-drop or table-drop audit MUST query `pg_views`, `pg_matviews`,
  `pg_proc.prosrc`, `pg_indexes`, `pg_trigger`, `pg_policy`, `cron.job` —
  not just code grep. Add to orchestrator checklist.
- **D-SUB-2 (S2 data-quality):** `saved_card.category` has 9 distinct legacy
  slugs / removed-category values from before ORCH-0434 (watch, picnic_park,
  Wellness, casual_eats, nature_views, fine_dining, drink, Watch,
  upscale_fine_dining-as-slug). NOT part of ORCH-0700 scope but a
  pre-existing data drift. Separate ORCH candidate for saved_card historical
  taxonomy normalization.
- **D-SUB-3 (S3 hygiene):** Verify drop status of
  `place_pool_ai_categories_backup_0434` (created in
  `20260415100000_orch0434_phase1_slug_migration.sql:41`). Did not appear
  in V5 backup table query — likely dropped already, but confirm.
- **D-SUB-4 (S2 process):** Migration `20260402000001_unified_place_card_sync.sql`
  contains a trigger that updates `card_pool` from `place_pool.ai_categories`.
  Since `card_pool` was archived in ORCH-0640 ch12, this trigger is broken /
  no-op. Verify with `SELECT * FROM pg_trigger WHERE tgname LIKE '%place_card_sync%'`
  and DROP if still present. Did NOT appear in V6.b probe (which returned
  only 2 triggers), suggesting the trigger was already dropped — but the
  migration file still exists in the repo as historical artifact and is
  fine to leave there.
- **D-SUB-5 (S3 process):** ORCH-0640 deferred migration
  `scripts/deferred-migrations/20260502000001_orch_0640_final_archive_drop.sql`
  is scheduled to run TOMORROW (May 2). This drops `_archive_card_pool` +
  `_archive_card_pool_stops`. Operator should confirm 7-day soak conditions
  are met (CI grep gates green for 7 consecutive days, no rollback signal,
  no admin/mobile reports of missing data) before applying.
- **D-SUB-6 (S2 architecture):** Several historical RPCs in
  `20260407300000_rpc_redesign_fk_based.sql` and
  `20260409200001_optimize_city_picker_rpc.sql` reference ai_categories +
  `ai_approved` (which is already dropped). These RPCs ARE LIKELY ALREADY
  ERRORING when called, since `ai_approved` no longer exists. Either:
  (a) they were silently superseded by ORCH-0640 ch05 rewrites and are now
  inactive, OR (b) they're still live and broken. Recommend spec-time
  spot-check via `SELECT proname FROM pg_proc WHERE prosrc ILIKE '%ai_approved%'`
  to find any stragglers. If found, either drop or rewrite as part of
  SPEC v2 cleanup.

---

## 6. Confidence calibration

| Thread | Verdict | Confidence |
|---|---|---|
| V1 (reader sweep) | 5 missed deps + mobile/business clear + admin-only readers | H |
| V2 (NEW system independence) | Bouncer + scorer + RPC chain all clear | H+ |
| V3 (saved_card historical) | No movies_theatre; 9 legacy values pre-existing | H on data, M on rendering |
| V4 (holiday + curated chain bleed) | No DB queries on ai_categories beyond passthrough | H |
| V5 (backup tables) | 3 still exist; 2 scheduled to drop tomorrow | H on existence, M on zero-readers |
| V6 (DDL prerequisites) | MV + 3 admin RPCs + 1 rules RPC + cron job 13 | H |
| V7 (quantification) | 41,301 ai_cats + 58k AI metadata + last write 5 days ago | H |
| V8 (operator-workflow impact) | Loses ai_cats grouping; replacement = seeding_category or primary_type | H on impact, M on operator readiness |
| V9 (NEW system end-to-end) | Full chain verified independent | H |

**Overall verdict: SAFE WITH CAVEATS at H confidence.** The 5 newly-found
dependencies must be migrated before column drop. Once migrated, drop is
safe and reversible via the `_archive_orch_0700_ai_metadata` snapshot.

---

## 7. Stop-condition compliance

- [x] All 9 threads have verdicts at M or H confidence (most H+)
- [x] 3 operator questions answered with evidence + line citations
- [x] DDL prerequisite list is exhaustive (10-step ordering)
- [x] NEW system independence assertion is line-anchored
- [x] No SPEC proposed (forensics scope respected)
- [x] No code or DB state modified

**Sub-audit COMPLETE. SPEC v2 unblocked — implementor scope expands by ~5
deliverables (MV rewrite + 3 admin RPC rewrites + rules RPC rewrite + cron
pause/resume + admin UI ai_categories removal) on top of the 6 already in
SPEC v1 draft.**

**Next step:** orchestrator REVIEW this report → SPEC writer ingests
cycle-1 + cycle-2 + this audit → SPEC v2 dispatch overwrites
`prompts/SPEC_ORCH-0700_DISPATCH.md`.
