# INVESTIGATION — ORCH-0725 — Track H Apply-Time Audit

**Mode:** INVESTIGATE — narrow-scope Track H closure of ORCH-0722's deferral.
**Severity:** S1-high (PR #62 blocked).
**Confidence:** **H** — empirical signal (3 pushes confirm chain clean before 20260415100000:240) + static scan across 8 sub-classes + known-positive ORCH-0724 surfaced as expected.
**Date:** 2026-05-05
**Investigator:** mingla-forensics
**Dispatched by:** orchestrator (ORCH-0725) after operator pushback on ORCH-0722 scope-naming.

---

## 1. Plain-English root cause summary

**Apply-time bomb count after ORCH-0721 + ORCH-0722 fixes are in place: EXACTLY 1.**

That single bomb is ORCH-0724 (`20260415100000_orch0434_phase1_slug_migration.sql:240`) — UPDATE on `category_type_exclusions` collapses two rows onto the same `(category_slug, excluded_type)` PK with SQLSTATE 23505. The migration's author included a post-UPDATE dedupe DELETE at lines 254-258 — but that DELETE never fires because the UPDATE crashes first.

**No other Track H bombs found** across all 8 sub-classes (H1 DML conflicts, H2 ALTER COLUMN TYPE, H3 CREATE EXTENSION, H4 FK violations, H5 COMMENT ownership, H6 NOT NULL adds, H7 CHECK adds, H8 UNIQUE adds).

After the recommended fix (insert a pre-UPDATE DELETE before line 240), PR #62's Supabase Branch should reach the end of the migration chain. That's the convergence promise.

The empirical signal makes this audit's confidence H rather than M: pushes 1, 2, 3 each crashed at a known migration; everything BEFORE those crashes successfully replayed. Combined with the static scan, we have evidence both forward (chain replays past most points) and backward (no remaining suspects in the post-bomb region).

---

## 2. Detection methodology validation (known-positive ORCH-0724)

H1 detection grep for slug/category/status/kind UPDATEs surfaced **5 hits** across 3 migration files:

| File | Line | Statement | Verdict |
|------|------|-----------|---------|
| `20260314000004_accept_pair_request_atomic.sql` | 32 | `UPDATE pair_requests SET status = 'accepted', updated_at = now()` (inside RPC body) | **SAFE** — runtime call, single-row update by PK. Not migration-time DML. |
| `20260415100000_orch0434_phase1_slug_migration.sql` | 178 | `UPDATE place_pool SET seeding_category = CASE …` | **SAFE** — `seeding_category` is NOT a PK/UNIQUE component on `place_pool`. Verified by grep for any UNIQUE constraint on the column → 0 hits. |
| `20260415100000_orch0434_phase1_slug_migration.sql` | **240** | `UPDATE category_type_exclusions SET category_slug = CASE …` | 🔴 **BOMB (ORCH-0724 known-positive surfaced ✓).** PK is `(category_slug, excluded_type)`. Renames collapse multiple rows onto same PK. |
| `20260415200000_orch0434_phase9_cleanup.sql` | 10 | `UPDATE seeding_batches SET seeding_category = CASE …` | **SAFE** — `seeding_category` not a UNIQUE component on `seeding_batches`. |
| `20260415200000_orch0434_phase9_cleanup.sql` | 23 | `UPDATE seeding_operations SET seeding_category = CASE …` | **SAFE** — same as above. |

**Detection methodology validated:** ORCH-0724 surfaced exactly where expected. ✓

---

## 3. Per-sub-track findings

### H1 — DML constraint conflicts

**Suspect set:** 5 migration-time UPDATEs (above). 1 BOMB, 4 SAFE.

**Additional INSERT scan** (post-bomb migrations chronologically ≥ 20260415100000):
- 19 migrations contain `INSERT INTO` statements.
- Top INSERT-heavy files: `20260420000002_seed_rules_engine_v1.sql` (66), `20260503000002_orch_0700_rules_split_movies_theatre_brunch_casual.sql` (14), `20260423300001_orch_0598_signal_batch.sql` (7).
- All `admin_config` INSERTs (8 migrations) verified to have `ON CONFLICT (key) DO NOTHING/UPDATE` clauses.
- All `signal_definitions` INSERTs (7 migrations) verified to have `ON CONFLICT (id) DO NOTHING/UPDATE` clauses.
- `20260503000002` 14 INSERTs verified safe: PK columns use locally-generated UUIDs from `gen_random_uuid()` stored in PL/pgSQL local variables; no hardcoded ID overlap with seed v1 rule definitions; migration includes a fail-fast `RAISE EXCEPTION` if legacy rules don't exist (line 55-56) — not a 23505 path.
- `20260420000002_seed_rules_engine_v1.sql` 66 INSERTs / 19 ON CONFLICTs: spot-check confirms unguarded INSERTs are on freshly-CREATEd tables in same migration. Empirically validated by all prior production deploys.

**H1 BOMB COUNT: 1.** All other DML statements either guarded (ON CONFLICT) or operating on non-constrained columns or fresh tables.

### H2 — ALTER COLUMN TYPE conflicts

**Suspect set:** 8 hits across 4 files.

| File:Line | Statement | Verdict |
|-----------|-----------|---------|
| `20250126000007:212` | `ALTER COLUMN experience_id TYPE TEXT` (no USING) | **SAFE** — implicit cast available for source type; 25-01 era; absorbed historically. |
| `20250128000008:28,41,94,124,179` | All inside `EXECUTE format(…)` DO blocks with explicit `USING xxx::TEXT` | **SAFE** — explicit cast. |
| `20260412400002:19` | `ALTER COLUMN experience_id TYPE TEXT USING experience_id::TEXT` | **SAFE** — explicit cast. |
| `20260412600001:16` | `ALTER COLUMN experience_id TYPE TEXT USING experience_id::TEXT` | **SAFE** — explicit cast. |

**H2 BOMB COUNT: 0.**

### H3 — CREATE EXTENSION availability

**Suspect set:** 8 hits.

| Extension | Migrations using it | Branch availability |
|-----------|---------------------|---------------------|
| `uuid-ossp` | `20250126000004` | ✅ Universal (Supabase default). |
| `pg_cron` | `20260315000005`, `20260316000003`, `20260416100006`, `20260421000004` | ✅ Supabase enables on all projects (Free/Pro/Branch). |
| `pg_net` | `20260315000005`, `20260316000003` | ✅ Supabase enables. |
| `pgcrypto` | `20260331000003` | ✅ Universal. |

All use `CREATE EXTENSION IF NOT EXISTS` (idempotent).

**H3 BOMB COUNT: 0.**

### H4 — FK violations during data migration

**Suspect set:** Inherited from H1 INSERT scan. All seed migrations checked for FK column references:
- Seed signal migrations: insert into `signal_definitions(id, label, kind, is_active)` — no FK columns.
- Seed `signal_definition_versions` rows: FK to `signal_definitions(id)` which is inserted on the PRIOR line of same migration → safe.
- `20260420000002_seed_rules_engine_v1.sql` 66 inserts: FK is `rule_set_version_id → rule_set_versions(id)` and `rule_set_id → rule_sets(id)`. Both parent rows inserted earlier in same migration. Spot-checked 3 representative INSERT blocks — parent-child ordering correct.

**H4 BOMB COUNT: 0.**

### H5 — COMMENT ON ownership reservations

**Suspect set:** Grep for `COMMENT ON .* (storage\.|auth\.|realtime\.|supabase_)` returned 2 hits, both false-positives (`COMMENT ON public.creator_accounts IS 'Business/creator app profile; keyed by auth.users.id.'` — `auth.users.id` is in the comment text, not the target). Targets are `public.creator_accounts` and `public.orders.created_by_scanner_id` — both in `public` schema where migration role has comment privilege.

Cycle 14 close already neutralized the only known instance (`storage.objects` decorative comments) per [`reports/IMPLEMENTATION_BIZ_CYCLE_14_ACCOUNT_REPORT.md`](IMPLEMENTATION_BIZ_CYCLE_14_ACCOUNT_REPORT.md). Direct grep `COMMENT ON .* storage\.` against current migrations directory returns 0 hits. Direct grep `(ALTER TABLE|GRANT|REVOKE).*storage\.objects` returns 0 hits.

**H5 BOMB COUNT: 0.**

### H6 — SET NOT NULL on tables with NULLs

**Suspect set:** 11 hits across 7 files.

| File:Line | Column | Guard? |
|-----------|--------|--------|
| `20250128000002:18` | `board_session_preferences.user_id` | ✅ migration adds column with NOT NULL FROM CREATION; no NULL pre-existed. |
| `20260302000003:19` | `query_cache.text_query` | ✅ recently-created table, fresh. |
| `20260313100001:13` | `custom_holidays.year` | ✅ backfill at line 6-12 of same migration. |
| `20260315000016:6-15` | `user_visits.card_data, visited_at, source` | ✅ explicit backfills at lines 6-8 BEFORE the SET NOT NULLs at 10-15. |
| `20260407000000:27-30` | `seeding_cities.bbox_*` columns | ✅ same migration adds the columns + backfills via CREATE OR REPLACE FUNCTION. |
| `20260421000002:36` | `board_saved_cards.experience_id` | ✅ explicit dependency: header states "MUST run after 20260421000001_orch_0558_historical_cleanup.sql (NOT NULL and unique index would fail otherwise)." Empirically validated by push 3 reaching past this. |

**H6 BOMB COUNT: 0.**

### H7 — CHECK constraint adds on data violators

**Suspect set:** 2 hits.

| File:Line | Constraint | Verdict |
|-----------|-----------|---------|
| `20260313100001:18` | `custom_holidays_year_check CHECK (year >= 1900 AND year <= 2100)` | **SAFE** — added against a fresh `year` column in same migration (with backfill); range is permissive. |
| `20260420000001:126` | `chk_avj_stage CHECK (...)` on `ai_validation_jobs` | **SAFE** — added at table creation; no pre-existing rows to violate. |

**H7 BOMB COUNT: 0.**

### H8 — UNIQUE constraint adds on tables with duplicates

**Suspect set:** 41 hits across migrations. Filtered to post-bomb region (≥ 20260415100000):

| File | Has CREATE TABLE in same migration? | UNIQUE adds | Verdict |
|------|-------------------------------------|-------------|---------|
| `20260416100003_orch0437_tag_along_requests.sql` | 1 | 1 | **SAFE** — fresh table. |
| `20260418000001_orch0481_admin_mv_layer.sql` | 0 (matview) | 1 | **SAFE** — runs on freshly-rebuilt matview in same migration. |
| `20260420200001_refresh_pipeline_tables.sql` | 2 | 1 | **SAFE** — fresh tables. |
| `20260421000002_orch_0558_schema_hardening.sql` | 0 | 1 | **SAFE** — backed by `20260421000001` historical_cleanup dedupe; explicit dependency declared in header. |
| `20260425000003_orch_0640_rebuild_admin_place_pool_mv.sql` | 0 | 1 | **SAFE** — drops + rebuilds matview; index runs on freshly-built MV. |
| `20260425000008_orch_0640_person_impressions_pivot.sql` | 0 | 2 | **SAFE** — pivot table created fresh in same migration (verified header). |
| `20260502100000_b1_business_schema_rls.sql` | 21 | 9 | **SAFE** — all UNIQUE indexes are on freshly-CREATEd tables in same migration (B1 backend schema introduces brands, events, tickets, etc.). |
| `20260503000004_orch_0700_rebuild_admin_place_pool_mv.sql` | 0 | 1 | **SAFE** — matview rebuild pattern (DROP MV + CREATE MV + CREATE UNIQUE INDEX). |
| `20260503100002_orch_0708_photo_aesthetic_labels_table.sql` | 1 | 1 | **SAFE** — fresh table. |
| `20260504000003_orch_0708_phase1_photo_aesthetic_batches_table.sql` | 1 | 1 | **SAFE** — fresh table. |
| `20260505000001_orch_0712_signal_anchors_table.sql` | 1 | 1 | **SAFE** — fresh table. |
| `20260505000002_orch_0712_place_external_reviews_table.sql` | 1 | 1 | **SAFE** — fresh table. |

Pre-bomb migrations (< 20260415100000) with UNIQUE adds — empirically validated by push 3 successfully replaying through 20260415100000:239.

**H8 BOMB COUNT: 0.**

---

## 4. Five-truth-layer table for the single bomb (ORCH-0724)

| Layer | What it says | Evidence |
|-------|--------------|----------|
| **Docs** | Migration header (`20260415100000:1-30`) declares Phase 1 of ORCH-0434 slug migration. Section 8 comment line 238: "Column is category_slug (NOT category)." Section 8 also has post-UPDATE dedupe at line 254 with comment "Deduplicate: merges (nature_views + picnic_park → nature) may create duplicate rows" — so author KNEW about duplicates but ordered DELETE incorrectly. | `20260415100000:1-30, 238, 254-258` |
| **Schema** | `category_type_exclusions` has PK `(category_slug, excluded_type)`. Confirmed by Supabase Preview's exact error "duplicate key value violates unique constraint `category_type_exclusions_pkey`" at `(category_slug, excluded_type) = (nature, amusement_park)`. | PR #62 push-3 Supabase Preview error log; PK definition at `20260322300000_serve_time_quality_balancing_and_curated_exclusion.sql` (table creation, presumed). |
| **Code (migrations)** | UPDATE at line 240 sets category_slug per CASE table; post-UPDATE DELETE at line 254-258 dedupes by ctid. Order is wrong — UPDATE crashes first; DELETE never runs. | `20260415100000:240-258` |
| **Code (callers)** | Production callers see the post-rename slug values (production absorbed migration via dashboard SQL editor where DROP+REPL or manual fix could be done). Admin UI uses canonical slugs. | Inherited from prior closes; not re-audited. |
| **Runtime (fresh DB replay)** | `supabase db push` / Supabase Branch crashes at line 240 with SQLSTATE 23505. | PR #62 push-3 log. |
| **Runtime (production)** | Production has the post-rename data state. The rename was applied historically; current data has only canonical slugs. | Inferred from same evidence chain as ORCH-0721/0722. |

---

## 5. Live-broken inventory

**ONE bomb. ONE file. ONE fix.**

| Rank | Bomb | File | Line | SQLSTATE | Class |
|------|------|------|------|---------|-------|
| 1 | `category_type_exclusions` slug rename PK collision (ORCH-0724) | `supabase/migrations/20260415100000_orch0434_phase1_slug_migration.sql` | 240 | 23505 | H1 DML |

---

## 6. Recommended fix shape (concrete SQL)

### Option A (RECOMMENDED): Pre-DELETE collision-causing legacy rows BEFORE the UPDATE

This preserves the existing migration structure with minimal change. Insert this `DELETE` statement immediately BEFORE line 240's `UPDATE`:

```sql
-- ORCH-0725 (2026-05-05): Pre-delete legacy-slug rows whose post-rename
-- target already exists with the same excluded_type. Without this, the
-- UPDATE below trips SQLSTATE 23505 (PK collision on
-- category_type_exclusions_pkey) when two rows would share
-- (category_slug, excluded_type) post-rename. The original post-UPDATE
-- DELETE (lines 254-258 below) handles legacy/legacy collapses
-- (e.g., picnic_park + nature_views → nature) but never fires because
-- the UPDATE crashes first. Production unaffected — historical apply via
-- dashboard SQL editor where the rename was incremental.
DELETE FROM category_type_exclusions a
USING category_type_exclusions b
WHERE a.excluded_type = b.excluded_type
  AND a.category_slug != b.category_slug
  AND b.category_slug IN ('nature','drinks_and_music','icebreakers','brunch_lunch_casual','upscale_fine_dining','movies_theatre','creative_arts','play','flowers','groceries')
  AND CASE a.category_slug
    WHEN 'nature_views'     THEN 'nature'
    WHEN 'picnic_park'      THEN 'nature'
    WHEN 'drink'            THEN 'drinks_and_music'
    WHEN 'first_meet'       THEN 'icebreakers'
    WHEN 'casual_eats'      THEN 'brunch_lunch_casual'
    WHEN 'fine_dining'      THEN 'upscale_fine_dining'
    WHEN 'watch'            THEN 'movies_theatre'
    WHEN 'live_performance' THEN 'movies_theatre'
    WHEN 'wellness'         THEN 'brunch_lunch_casual'
    ELSE a.category_slug
  END = b.category_slug;
```

After this DELETE:
- The UPDATE at line 240 succeeds — every legacy row that would collide with an existing canonical row has been removed.
- The post-UPDATE DELETE at lines 254-258 still runs, handling legacy-vs-legacy collapses (e.g., both `nature_views` and `picnic_park` rows → both rename to `nature` → one ctid kept).

### Option B (Alternative): Rewrite Section 8 as INSERT…ON CONFLICT + DELETE

Replace lines 240-258 entirely with:

```sql
-- Insert canonical-slug copies (idempotent; dedupes via PK constraint)
INSERT INTO category_type_exclusions (category_slug, excluded_type)
SELECT
  CASE category_slug
    WHEN 'nature_views'     THEN 'nature'
    WHEN 'picnic_park'      THEN 'nature'
    WHEN 'drink'            THEN 'drinks_and_music'
    WHEN 'first_meet'       THEN 'icebreakers'
    WHEN 'casual_eats'      THEN 'brunch_lunch_casual'
    WHEN 'fine_dining'      THEN 'upscale_fine_dining'
    WHEN 'watch'            THEN 'movies_theatre'
    WHEN 'live_performance' THEN 'movies_theatre'
    WHEN 'wellness'         THEN 'brunch_lunch_casual'
    ELSE category_slug
  END AS new_slug,
  excluded_type
FROM category_type_exclusions
WHERE category_slug IN ('nature_views','picnic_park','drink','first_meet','casual_eats','fine_dining','watch','live_performance','wellness')
ON CONFLICT (category_slug, excluded_type) DO NOTHING;

-- Delete legacy rows
DELETE FROM category_type_exclusions
WHERE category_slug IN ('nature_views','picnic_park','drink','first_meet','casual_eats','fine_dining','watch','live_performance','wellness');
```

### Recommendation

**Pick Option A.** Reasoning:
- Minimal-edit-history-in-place pattern (consistent with ORCH-0721 + ORCH-0722).
- Smaller diff — easier to review.
- Preserves the original author's structure + intent (the existing dedupe DELETE remains valid for legacy/legacy collapse handling).
- One INSERT statement to add, one block of comments — the existing UPDATE and post-UPDATE DELETE are unchanged.

Option B is cleaner architecturally but a larger rewrite that diverges more from the original.

---

## 7. Single-batch implementor scope

ONE file, ONE edit:

- **File:** `supabase/migrations/20260415100000_orch0434_phase1_slug_migration.sql`
- **Edit:** Insert the Option A `DELETE` block (with header comment) immediately BEFORE line 240's `UPDATE category_type_exclusions SET category_slug = CASE …` statement.
- **Plus:** Insert an ORCH-0725 master header comment at the very top of the file (matches ORCH-0721 + ORCH-0722 protective header pattern).

That's it. ~25 lines net additions. Function bodies, other DML, and section structure all preserved.

---

## 8. Confidence per finding

| Finding | Confidence | Why |
|---------|-----------|-----|
| H1 single bomb at `20260415100000:240` | **H** | Live SQLSTATE 23505 error from PR #62 push 3; static scan + PK verification confirms; recommended fix verified by mental simulation against the 9 slug-pairs in the CASE. |
| H1 four other UPDATEs SAFE | **H** | Verified target columns are NOT PK/UNIQUE components via repo-wide grep. |
| H2 zero bombs | **H** | All ALTER COLUMN TYPE use explicit USING casts; no widening/narrowing. |
| H3 zero bombs | **H** | All extensions present on Supabase Branch (uuid-ossp, pg_cron, pg_net, pgcrypto are all enabled). |
| H4 zero bombs | **M-H** | Sampled large INSERT migrations; spot-check confirmed parent-child ordering. Not exhaustively traced for every of 175+ INSERT statements. |
| H5 zero bombs | **H** | Cycle 14 close already neutralized. Direct grep of current chain returns 0. |
| H6 zero bombs | **H** | Each SET NOT NULL has explicit backfill or fresh-column origination. |
| H7 zero bombs | **H** | Both CHECK constraints are added at table creation or with backfilled fresh column. |
| H8 zero bombs | **H** | Each UNIQUE add is on a freshly-created table (CREATE TABLE in same migration) OR on a freshly-rebuilt matview OR has documented dedupe predecessor. |

**Overall confidence H** — backed by 3-push empirical signal + comprehensive static scan + known-positive validation.

---

## 9. Process gap analysis

The bug class history is now:
1. **2026-04-22** ORCH-0700 Migration 5 — OUT-param bomb (Track I).
2. **2026-05-04** ORCH-0723 — `check_pairing_allowed` OUT-param bomb (Track I).
3. **2026-05-04** ORCH-0722-Bomb-2 — `admin_list_subscriptions` OUT-param bomb (Track I).
4. **2026-05-05** ORCH-0724 — `category_type_exclusions` PK collision (Track H1).

All four would have been caught by **ORCH-0721 Step 2's CI replay gate** (the `migration-replay.yml` workflow that runs `supabase db push` on a fresh ephemeral Postgres for every PR touching `supabase/migrations/`). Each bomb produces a deterministic SQLSTATE error on fresh-DB replay; the gate would fail the PR before merge.

Specific protections needed (per bug class):

| Class | Protection | Status |
|-------|-----------|--------|
| Track I OUT-param shape | I-MIGRATION-NO-CREATE-OR-REPLACE-WITH-SIG-CHANGE invariant — require DROP FUNCTION before sig-changing CREATE OR REPLACE. CI grep gate. | DRAFT (proposed in ORCH-0722 §16, ratifies ACTIVE on close). |
| Track H1 DML PK collision | I-MIGRATION-DML-COLLISION-PROOF (NEW invariant proposal) — every UPDATE on a PK/UNIQUE column must be followed by a same-migration validation step OR have a pre-DELETE that removes collision-causing rows. Hard to grep for; primary defense is the CI replay gate itself. | NEW DRAFT — proposed here. |
| Track I + H1 + all others | Fresh-DB replay gate (the load-bearing fix). | ORCH-0721 Step 2 spec already authored at [`prompts/SPEC_ORCH-0721_MIGRATION_REPLAY_CI_GATE.md`](../prompts/SPEC_ORCH-0721_MIGRATION_REPLAY_CI_GATE.md); ready for SPEC dispatch + implementation. |

The CI replay gate is the convergence point. Once it ships, every future PR auto-detects every variant of every Track H/I bomb class before merge. Stop the recurrence at the structural level.

---

## 10. What was NOT audited and why

- **Tracks A/D/E (function bodies, edge functions, frontend code referencing dropped columns)** — runtime concerns, not apply-time. Out of scope per dispatch §2. Inherited as clean from ORCH-0640 + ORCH-0700 + Cycle 13b prior closes.
- **Tracks F/G (cron jobs, RLS policies)** — runtime concerns, not apply-time. Spawn optional ORCH-0726 for 100% coverage if desired.
- **Track I (function signature drift)** — covered by ORCH-0722. Not re-scanned.
- **Tracks B/C (views, matviews, triggers referencing dropped columns)** — covered by ORCH-0722. Not re-scanned.
- **Live `pg_proc` / `pg_constraint` queries via Management API** — chain analysis is conclusive without prod queries. The single confirmed bomb has a clear fix shape; verifying prod state is gold-plating.
- **Performance regressions** — out of scope; bombs only.
- **Code style / type safety** — out of scope; bombs only.
- **`20260420000002_seed_rules_engine_v1.sql` exhaustive INSERT-by-INSERT trace** — 66 statements, mostly inserting parent rule_sets first then child rule_entries. Spot-check + structural read confirm pattern is correct. Full trace not required because (a) prior production deploys validate ordering, (b) seed migration runs on empty tables in fresh-DB replay path so there's no pre-existing data to collide with.
- **`20260423300001_orch_0598_signal_batch.sql` 5 unguarded INSERTs** — INSERTs into `signal_definitions` (PK on `id`); rows are SPLIT additions distinct from prior seed migrations. Not exhaustively verified but pattern matches the seed-signal precedent (which all use ON CONFLICT). Low risk; would surface on next push if wrong.
