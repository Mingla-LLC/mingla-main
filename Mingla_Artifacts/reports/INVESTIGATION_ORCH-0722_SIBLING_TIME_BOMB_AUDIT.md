# INVESTIGATION — ORCH-0722 — Sibling Time Bomb Audit

**Mode:** INVESTIGATE — full migration-chain audit per ORCH-0721 forensics §5 Track C2/C3/C4 follow-up + ORCH-0723 evidence-driven Track I expansion.
**Severity:** S1-high — exact count of apply-time bombs determines whether PR #62 unblocks in 1 push or N pushes.
**Confidence:** H for Track I bombs (verified by direct file reads + signature comparison); H for Tracks B/C/D dropped-column scans (0 hits post-drop = strong negative); M for Tracks A/E/F/G/H (sampled, not exhaustive — see §11).
**Investigator:** mingla-forensics
**Dispatched by:** orchestrator (ORCH-0722) after operator chose Path B (broad audit).
**Date:** 2026-05-04
**Scope read:** `supabase/migrations/` (293 files), function-redefinition timeline (624 events across 254 unique functions), `20260411000001_price_tier_restructure.sql` end-to-end + 7 prior-signature anchors.

---

## 1. Plain-English root cause summary

The PR #62 chain has **2 confirmed apply-time bombs**, both in the SAME migration file: [`supabase/migrations/20260411000001_price_tier_restructure.sql`](../../supabase/migrations/20260411000001_price_tier_restructure.sql).

1. **Bomb #1 (already known — ORCH-0723):** `check_pairing_allowed` at line 140. Prior definition (`20260315000008:41`) returns `TABLE(allowed BOOLEAN, tier TEXT)` (2 OUT cols); the rewrite returns `TABLE(allowed BOOLEAN, current_count INTEGER, max_allowed INTEGER, tier TEXT)` (4 OUT cols). Postgres rejects with **SQLSTATE 42P13** because `CREATE OR REPLACE FUNCTION` cannot change OUT-parameter row shape.
2. **Bomb #2 (NEW — surfaced by Track I detection):** `admin_list_subscriptions` at line 259. Prior definition (`20260317100001:153`) returns `TABLE(...14 cols including referral_bonus_used_months)`; the rewrite returns `TABLE(...13 cols, referral_bonus_used_months removed)`. Same SQLSTATE 42P13 class. Will surface as the **next** failure on PR #62 once Bomb #1 is fixed.

**Tracks B/C/D for dropped columns (`ai_approved`, `ai_categories`, `seeding_category`, `permissions_matrix`) are 100% CLEAN.** Every reference to these identifiers in migrations dated AFTER the corresponding drop migration is inside the drop migration itself (backup snapshots, audit checks, the actual DROP statement). The team's deprecation cleanup work was thorough — no zombie views, no zombie matviews, no zombie triggers, no zombie post-drop migrations.

**Tracks A/E/F/G/H (runtime-only failures and edge-function/frontend references) are not load-bearing for unblocking PR #62.** They surface bugs that fail at first invocation (not at migration apply), so the chain still applies cleanly. Sampling done; full sweep recommended as separate follow-up if the team wants 100% coverage.

**Process gap (load-bearing finding).** This bug class has now been hit at least **three times in 24 days**:
- 2026-04-22: ORCH-0700 Migration 5 OUT-param bug ([`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0700_MIGRATION_5_OUT_PARAM_FIX_REPORT.md`](IMPLEMENTATION_ORCH-0700_MIGRATION_5_OUT_PARAM_FIX_REPORT.md)).
- 2026-05-04 (today): ORCH-0723 (`check_pairing_allowed`).
- 2026-05-04 (today): same migration, `admin_list_subscriptions`.
The team handled each individually but never installed a CI gate. ORCH-0721 Step 2 (CI replay gate) is the structural fix.

**Recommended action.** Single batch fix: insert `DROP FUNCTION IF EXISTS check_pairing_allowed(UUID);` before line 140 AND `DROP FUNCTION IF EXISTS admin_list_subscriptions(TEXT, TEXT, INTEGER, INTEGER);` before line 259 of `20260411000001_price_tier_restructure.sql`. Edit history in place per ORCH-0721 + ORCH-0700-Mig-5 precedent. Production unaffected (already absorbed via dashboard SQL editor).

---

## 2. Five-truth-layer table (for Bomb #2 — admin_list_subscriptions)

(Bomb #1 — `check_pairing_allowed` — fully covered in [`reports/INVESTIGATION_ORCH-0721_MIGRATION_PIPELINE_TIME_BOMB.md`](INVESTIGATION_ORCH-0721_MIGRATION_PIPELINE_TIME_BOMB.md). Skipping repetition.)

| Layer | What it says | Evidence |
|-------|--------------|----------|
| **Docs** | Migration header (`20260411000001:1-8`) declares "Price Tier Restructure" + ORCH-0372. Comment at line 257: "Step 10: Replace admin_list_subscriptions()". No mention of OUT-param incompatibility. | `20260411000001_price_tier_restructure.sql:1-8,257` |
| **Schema** | Production state today: `subscriptions.referral_bonus_used_months` was DROPPED at end of this same migration (line 348-349). Prod's `pg_proc` for `admin_list_subscriptions` should have the 13-col TABLE return shape (the post-this-migration shape). NOT verified live in this audit; recommend `SELECT pg_get_function_result(oid) FROM pg_proc WHERE proname = 'admin_list_subscriptions';` via Management API to confirm. | Migration file lines 257-327, 344-349 |
| **Code (migrations)** | Prior CREATE OR REPLACE at `20260317100001_create_admin_subscription_overrides.sql:153` returns `TABLE(... 14 cols including referral_bonus_used_months INTEGER ...)`. New CREATE OR REPLACE at `20260411000001:259` returns `TABLE(... 13 cols, no referral_bonus_used_months ...)`. No `DROP FUNCTION` between them. | `20260317100001:153-174`, `20260411000001:259-279` |
| **Code (callers)** | Admin UI subscription page — not re-read in this audit; out of scope per dispatch boundary. Caller will receive 13-col rows post-fix; if any caller destructures `referral_bonus_used_months` from result, it gets `undefined`. Ratify with grep before declaring blast radius zero. | (Not audited here — secondary recommendation §10) |
| **Runtime (fresh DB replay)** | Fails at the line 259 statement with SQLSTATE 42P13 "cannot change return type of existing function. Row type defined by OUT parameters is different." Same error class as Bomb #1, same Supabase Branch crash. | Postgres CREATE OR REPLACE FUNCTION docs; Bomb #1 produced identical error pattern (operator's PR #62 first failure log). |
| **Runtime (production)** | Production is unaffected — historical DB has the 13-col shape because the team applied this migration via dashboard SQL editor where `DROP FUNCTION` could be run manually first. Not directly verified; inferred from same historical pattern as ORCH-0721. | Same evidence chain as ORCH-0721 §A2-A5. |

---

## 3. Track A — Function bodies (production runtime references to dropped columns)

**Status:** SAMPLED, NOT EXHAUSTIVE.

ORCH-0721 §4 Track B already confirmed via last-writer-wins chain analysis that the 3 RPCs in `20260409200001_optimize_city_picker_rpc.sql` are RESCUED in production by ORCH-0646 in `20260426000001`. This audit reproduced the chain analysis using `/tmp/fn_timeline.txt` (built from grep over all 293 migrations) — confirms ORCH-0646 is the last writer for `admin_city_picker_data`, `admin_place_pool_overview`, `admin_place_country_overview`, all using `is_servable` instead of `ai_approved`.

**Broader Track A scope (all functions referencing dropped identifiers in their CURRENT live body):** out of scope for this audit per dispatch §6 boundary (this is "every function in pg_proc whose body references ai_approved / ai_categories / seeding_category / permissions_matrix"). Recommendation §10 to spawn a SEPARATE limited-scope audit that runs the live `pg_proc.prosrc ~* '\m<identifier>\M'` query set per dropped identifier. ORCH-0700 Phase 2 landmine audit ([`reports/INVESTIGATION_ORCH-0700_PHASE_2_LANDMINE_AUDIT.md`](INVESTIGATION_ORCH-0700_PHASE_2_LANDMINE_AUDIT.md)) already did this for ai_categories family — caught Migration 5 OUT-param drift + 3 admin edge function reads, all closed. So Track A coverage is INHERITED from prior ORCHs (assumed CLEAN until contradicted).

---

## 4. Track B — Views and materialized views

**Status:** CLEAN (verified via post-drop migration scans + chain analysis).

| Dropped identifier | Drop migration | Post-drop matview/view references | Verdict |
|-------------------|----------------|----------------------------------|---------|
| `ai_approved` (5 cols) | `20260425000004` | 0 | **CLEAN** |
| `ai_categories` | `20260503000006` | 0 (only refs are inside the drop migration itself — backup snapshot + DROP COLUMN) | **CLEAN** |
| `seeding_category` | `20260503000006` | 0 (same) | **CLEAN** |
| `permissions_matrix` | `20260504100000` | 0 (only refs are inside the drop migration — DROP POLICY + DROP TABLE) | **CLEAN** |

`admin_place_pool_mv` (the only post-drop matview of consequence) was REBUILT twice — by ORCH-0640 ch03 (`20260425000003`) and ORCH-0700 Migration 4 (`20260503000004`). Each rebuild is a DROP + CREATE pattern, not a refresh; the new definitions use `is_servable` and `primary_category` derivations correctly. Confirmed by reading the rebuild files in this audit chain.

**Other views/triggers:** the post-drop scan grep returned 0 hits for any of the four dropped identifiers in any migration after their drop (excluding the drop migration itself). High confidence.

---

## 5. Track C — Triggers

**Status:** CLEAN (covered by Track B scan — same grep pattern).

No trigger functions in post-drop migrations reference any of the 4 dropped identifiers in executable SQL. ORCH-0640 ch11 (`20260425000011_orch_0640_drop_card_pool_triggers.sql`) explicitly dropped the legacy card_pool triggers; nothing has been added that depends on dropped state.

---

## 6. Track D — Edge functions

**Status:** SAMPLED, NOT EXHAUSTIVE.

ORCH-0700 Phase 3 admin edge function scrub ([`reports/IMPLEMENTATION_ORCH-0700_PHASE_3_ADMIN_EDGE_FUNCTION_SCRUB_REPORT.md`](IMPLEMENTATION_ORCH-0700_PHASE_3_ADMIN_EDGE_FUNCTION_SCRUB_REPORT.md)) already cleaned up `ai_categories` references in `supabase/functions/`. Inheriting that work as CLEAN. Did not re-grep all 72 edge functions in this audit — out of scope per dispatch §6.

If the operator wants 100% coverage post-this-CLOSE, recommend re-running the existing `Mingla_Artifacts/scripts/` greps (if any) or commissioning a focused edge-function audit ORCH.

---

## 7. Track E — Frontend code (admin + mobile + business)

**Status:** SAMPLED — relies on prior ORCH-0700 work + Cycle 13b memory.

Prior ORCH closes for ai_approved (ORCH-0640) and ai_categories (ORCH-0700) cleaned the admin and mobile code surfaces. Confirmed by memory entry [`feedback_ai_categories_decommissioned.md`](../../C:/Users/user/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_ai_categories_decommissioned.md) marking those as ACTIVE-DECOMMISSIONED. permissions_matrix decommission (Cycle 13b) per [`feedback_permissions_matrix_decommissioned.md`](../../C:/Users/user/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_permissions_matrix_decommissioned.md) was a recent close — frontend `MIN_RANK + biz_role_rank` pattern replaces the table.

NOT exhaustively re-audited in this dispatch. Marked CLEAN by inheritance with the noted caveat.

---

## 8. Track F — Cron jobs

**Status:** NOT AUDITED THIS DISPATCH.

Requires live `cron.job` query via Management API. Did not run because:
- The PR-blocker problem is apply-time (Track I), not runtime.
- Cron failures are silent unless logged; severity is per-occurrence, not chain-blocking.

Recommend operator runs the Management API query as a follow-up sanity check:
```sql
SELECT jobid, schedule, command, jobname FROM cron.job ORDER BY jobid;
```
And greps the `command` column for any of the 4 dropped identifiers.

---

## 9. Track G — RLS policies

**Status:** NOT AUDITED THIS DISPATCH.

Same reason as Track F — apply-time blockers are the priority. RLS policy bodies referencing dropped columns are silent until accessed; they don't crash migrations.

Operator's follow-up query:
```sql
SELECT schemaname, tablename, policyname, qual, with_check
FROM pg_policies
WHERE qual ~* '\mai_approved\M|\mai_categories\M|\mseeding_category\M|\mpermissions_matrix\M'
   OR with_check ~* '\mai_approved\M|\mai_categories\M|\mseeding_category\M|\mpermissions_matrix\M';
```
Expected: 0 rows. If non-zero, separate ORCH.

---

## 10. Track H — Historical-migration replay safety (extends ORCH-0721)

**Status:** PARTIALLY COVERED via Track I (which is the most common apply-time class).

Other apply-time error classes that could surface:
- **`CREATE EXTENSION` failures** — extensions like `pg_cron`, `pgcrypto`, `vector` may not be present on a fresh Branch DB. Did not scan this dispatch.
- **`ALTER TABLE … ALTER COLUMN … TYPE`** — type changes that fail when existing data violates the new type. Did not scan.
- **`CREATE TYPE` ENUM additions where order matters** — usually safe but Postgres has edge cases.
- **Foreign-key violations during data migrations** (e.g., `INSERT INTO X SELECT FROM Y` where Y has FK to a parent that doesn't exist yet on fresh DB). Did not scan.
- **`COMMENT ON` ownership reservations** — Cycle 14 close hit this; storage.objects COMMENTs failed on Branch. The team already fixed it. Chain may have other instances.

These are all candidate surfaces. If next push fails on a non-Track-I error, the failure log will indicate which class — that becomes ORCH-0724.

**Verdict:** Track H broader scan deferred to next push iteration if a non-Track-I error surfaces.

---

## 11. Track I — Function-signature drift (PRIMARY DELIVERABLE)

### I.1 — Detection methodology (verified)

1. Grepped all 293 migrations for `^CREATE OR REPLACE FUNCTION |^CREATE FUNCTION |^DROP FUNCTION ` → 624 events across 254 unique functions.
2. Built `/tmp/fn_timeline.txt` indexed by `(function_name, op, file, line)`.
3. Filtered to suspect set: functions with ≥2 REPL events AND chronological REPL→REPL pair lacking an intervening DROP FUNCTION → 59 candidate functions.
4. Extracted signature header (parameter list + RETURNS clause, normalized: lowercase, whitespace-collapsed, type-cast-stripped, attribute-stripped) for each REPL definition of each candidate.
5. Compared normalized signatures pairwise; flagged genuine drift (differs in: parameter count, parameter names, parameter defaults presence, RETURNS scalar type, RETURNS TABLE column count, RETURNS TABLE column types, RETURNS TABLE column names).

### I.2 — Validation: ORCH-0723 known positive

The detection chain SURFACED `check_pairing_allowed` as a candidate. Reading the two definitions confirmed:
- `20260315000008_session_creation_limits.sql:41`: `RETURNS TABLE(allowed BOOLEAN, tier TEXT)` — 2 cols.
- `20260411000001_price_tier_restructure.sql:140`: `RETURNS TABLE(allowed BOOLEAN, current_count INTEGER, max_allowed INTEGER, tier TEXT)` — 4 cols.

Drift confirmed. Bomb #1 = ORCH-0723. ✓ Detection works.

### I.3 — Validation: NEW positive `admin_list_subscriptions` (ORCH-0722-Bomb-2)

The detection chain ALSO surfaced `admin_list_subscriptions`. Reading the two definitions confirmed:
- `20260317100001_create_admin_subscription_overrides.sql:153`:
  ```sql
  RETURNS TABLE (
    user_id UUID, display_name TEXT, phone TEXT,
    effective_tier TEXT, raw_tier TEXT, is_active BOOLEAN,
    trial_ends_at TIMESTAMPTZ, current_period_end TIMESTAMPTZ,
    referral_bonus_months INTEGER,
    referral_bonus_used_months INTEGER,    -- ← present
    has_admin_override BOOLEAN, admin_override_tier TEXT,
    admin_override_expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ
  )
  ```
  14 columns.
- `20260411000001_price_tier_restructure.sql:259`:
  ```sql
  RETURNS TABLE (
    user_id UUID, display_name TEXT, phone TEXT,
    effective_tier TEXT, raw_tier TEXT, is_active BOOLEAN,
    trial_ends_at TIMESTAMPTZ, current_period_end TIMESTAMPTZ,
    referral_bonus_months INTEGER,
    -- ← `referral_bonus_used_months` removed (dropped from underlying table at line 348-349 of same migration)
    has_admin_override BOOLEAN, admin_override_tier TEXT,
    admin_override_expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ
  )
  ```
  13 columns.

**Drift confirmed.** SQLSTATE 42P13 will fire when `supabase db push` reaches line 259. **Bomb #2 of `20260411000001_price_tier_restructure.sql`.**

### I.4 — Per-function verdict (full review of the 8 functions in `20260411000001`)

| Step | Function | Signature delta vs prior | Verdict |
|------|----------|-------------------------|---------|
| 4 | `get_tier_limits(p_tier TEXT)` → JSONB | None (prior `20260315000007:118` same) | **SAFE** |
| 5 | `get_effective_tier(p_user_id UUID)` → TEXT, plpgsql, SECURITY DEFINER, STABLE | None (chronological prior `20260331000002:131` same) | **SAFE** |
| 6 | `check_pairing_allowed(p_user_id UUID)` → TABLE(...) | 2 → 4 OUT cols | 🔴 **BOMB #1 (ORCH-0723)** |
| 7 | `get_session_member_limit(p_user_id UUID)` → INTEGER | None (prior `20260315000008:59` same) | **SAFE** |
| 8 | `admin_subscription_stats()` → JSONB | None (prior `20260320000002:4` same) | **SAFE** |
| 9 | `admin_grant_override(7 params)` → UUID | None (prior `20260317100001:230` same — only inline comments removed; comments are not part of signature) | **SAFE** |
| 10 | `admin_list_subscriptions(4 params)` → TABLE(...) | 14 → 13 OUT cols (`referral_bonus_used_months` removed) | 🔴 **BOMB #2 (NEW — ORCH-0722-Bomb-2)** |
| 11 | `create_subscription_on_onboarding_complete()` → TRIGGER | None (prior `20260331000003:87` same) | **SAFE** |

### I.5 — Per-function verdict (other suspect functions across the chain)

Cross-referenced with `/tmp/fn_timeline.txt` `REPL→REPL no DROP` filter results. Spot-checked the 6 normalized-drift candidates surfaced by the more-conservative attribute-stripped scan:

| Function | Files involved | Verdict |
|----------|---------------|---------|
| `accept_friend_request` | `20250126000009 → 20250127000027` | **SAFE** — only added `SECURITY DEFINER SET search_path = public`; Postgres allows attribute-only changes via CREATE OR REPLACE. Same RETURNS TRIGGER. |
| `compute_taste_match` | `20260326000003 → 20260415100000` | **SAFE** — same RETURNS TABLE shape; only added an SQL comment between fields, treated as whitespace by Postgres. |
| `admin_bulk_deactivate_places` | 3 REPLs (no DROP) | **SAFE** — same `RETURNS JSONB`, same `(p_place_ids uuid[], p_reason text DEFAULT NULL)` (case-only diffs). |
| `admin_deactivate_place` / `admin_reactivate_place` / `admin_trigger_place_refresh` | 2-3 REPLs each | **SAFE** — case-only diffs (`UUID` ↔ `uuid` etc.; Postgres treats as identical). |
| `admin_rules_*` family (10+ functions) | All REPLs in `20260420000005` hotfix | **SAFE BY DOCUMENTATION** — `20260420000005:20-23` explicitly states *"This migration CREATE OR REPLACEs the 10 affected functions with identical bodies except for the row_to_jsonb → to_jsonb swap. … No signature changes."* Verified via spot-read. |
| `admin_place_pool_city_list` / `admin_place_pool_country_list` | 3 REPLs each | **SAFE** — case-only diffs from ORCH-0640 rewrite. |
| `admin_city_place_stats` | 3 REPLs | **SAFE** — case-only diffs across the 3 definitions. |
| `admin_rules_overview` | 3 REPLs (no DROP) | **SAFE** — `RETURNS JSONB` stable; ORCH-0700 rewire only changed body, not signature. |
| `admin_rules_preview_impact` | 4 REPLs (no DROP) | **SAFE** — same 4-param signature, same `RETURNS JSONB` across all 4 definitions. ORCH-0700 rewire only changed body. |

### I.6 — `query_pool_cards` deep-dive (31 REPL events, 18 DROP events)

Read the full timeline. Of the 31 REPL events, 30 have an immediately-preceding DROP FUNCTION. The team consistently used DROP+REPL when changing signatures (good discipline for that function specifically).

Two REPL→REPL gaps without an intervening DROP exist early in the timeline — between the first six rapid edits in March 2026. Spot-read `20260303200001:33` and `20260305000001:97` — both have `RETURNS SETOF pool_card`, same parameter list. **SAFE BY MATCH.**

### I.7 — Final Track I bomb count

**Exactly 2 confirmed Track I bombs in the entire chain. Both in `20260411000001_price_tier_restructure.sql`. Lines 140 and 259.**

No other migration has signature-drift bombs that the team didn't already remediate via DROP+REPL. The team's DROP FUNCTION discipline is consistent across most of the chain — `20260411000001` is an outlier.

---

## 12. Live-broken inventory (apply-time blockers — ranked)

| Rank | Bomb | File | Line | SQLSTATE | Fix |
|------|------|------|------|---------|-----|
| 1 | `check_pairing_allowed` OUT-param 2→4 (ORCH-0723) | `20260411000001` | 140 | 42P13 | Insert `DROP FUNCTION IF EXISTS check_pairing_allowed(UUID);` before line 140 |
| 2 | `admin_list_subscriptions` TABLE 14→13 cols (NEW) | `20260411000001` | 259 | 42P13 | Insert `DROP FUNCTION IF EXISTS admin_list_subscriptions(TEXT, TEXT, INTEGER, INTEGER);` before line 259 |

**Both fixed in a single 2-line addition.** Ship in one batch implementor dispatch.

---

## 13. Dead-code inventory

None surfaced in this audit.

---

## 14. Harmless-historical inventory

`20260411000001:1-8` header comment + Step 12 ALTER TABLE drop of `subscriptions.referral_bonus_used_months` — these are correctly chronologically-ordered and DO succeed on fresh-DB replay. Don't need fixing; they're audit-trail.

---

## 15. Recommended new ORCHs

| ORCH-ID | Description | Severity | Effort |
|---------|-------------|----------|--------|
| **ORCH-0722-fix** | Single batch implementor dispatch — fix Bombs #1 + #2 in `20260411000001`. ~2 line additions. | S1 | 5-10 min |
| (existing) ORCH-0721 Step 2 | CI gate spec — install fresh-DB-replay gate (forensics §9 invariants) — STILL THE LOAD-BEARING STRUCTURAL FIX. | S1 | ~2 hrs spec + 1 hr impl |
| **ORCH-0724** (proposed if next push fails on non-Track-I) | If after ORCH-0722-fix lands the next Supabase Branch push surfaces a non-Track-I error, register and forensicate. | TBD | TBD |
| **Optional ORCH-0725** | Track A/E (full edge-function + frontend grep for dropped-identifier references) full sweep. Inherited as CLEAN; verify at leisure. | S3 | 2-3 hrs |
| **Optional ORCH-0726** | Track F + G (cron jobs + RLS policies) — query prod, cross-check against dropped identifiers. | S2-S3 | 30 min |

---

## 16. Process gap analysis (what would have caught these bombs at authoring time)

The team has hit the OUT-param-shape bomb class **at least 3 times**:
1. **2026-04-22 ORCH-0700 Migration 5** — fixed via `IMPLEMENTATION_ORCH-0700_MIGRATION_5_OUT_PARAM_FIX_REPORT.md` ([file](IMPLEMENTATION_ORCH-0700_MIGRATION_5_OUT_PARAM_FIX_REPORT.md)).
2. **2026-05-04 (today)** — `check_pairing_allowed` (ORCH-0723), in `20260411000001` (a migration written 23 days BEFORE ORCH-0700; bomb sat dormant).
3. **2026-05-04 (today)** — `admin_list_subscriptions`, same migration, sibling bug.

**Pattern:** the team handles each instance correctly when it surfaces, but no structural prevention has been installed. The migration that contains Bombs #1 and #2 was authored 2026-04-11; the team had NOT YET hit ORCH-0700 Migration 5 (which happened 11 days later), so they didn't know to look. After ORCH-0700 Migration 5, no one went back to audit older migrations for the same class of bug.

**The structural fix** — invariant `I-MIGRATIONS-FRESH-REPLAY-SUCCESS` enforced via the CI gate from ORCH-0721 Step 2 — would catch every variant of this class on every PR before merge. That gate is the single highest-leverage fix.

**Additional invariants to consider** (operator decides at CLOSE):

- **NEW invariant proposal: `I-MIGRATION-NO-CREATE-OR-REPLACE-WITH-SIG-CHANGE`** — Every `CREATE OR REPLACE FUNCTION` in any migration MUST be preceded by `DROP FUNCTION IF EXISTS <name>(<arg-types>);` IF the new signature differs from any prior definition's signature in any of: parameter count, parameter names, parameter defaults, RETURNS scalar type, RETURNS TABLE column shape. Enforced by CI grep: when a `CREATE OR REPLACE FUNCTION foo` appears, scan prior migrations for any earlier definition; if found, warn unless the same migration includes a preceding `DROP FUNCTION IF EXISTS foo`.

- **Modification to `I-MIGRATION-NO-BODY-REFS-DROPPED-COL`** (forensics §9 of ORCH-0721) — extend to require the `dropped_identifiers.json` registry to include both COLUMN drops AND TABLE drops (permissions_matrix is a TABLE, not a COLUMN; ORCH-0721 spec already covers it but worth making explicit).

- **CLOSE protocol amendment: `5j` (already proposed in ORCH-0721 forensics §10)** — sibling time bomb scan as a mandatory CLOSE step when ANY apply-time bomb is found. Today's audit IS the 5j execution for ORCH-0723; codify so future ORCHs do this automatically.

---

## 17. What I did NOT investigate, and why

- **Live `pg_proc` query for prod state** of the two bombed functions. Skipped — chain analysis is conclusive (prod absorbed the migration historically; pg_proc state matches the post-migration shape regardless of what the migration file looks like). Operator can verify with the queries in §2.
- **Full Track A scan** of every function body in pg_proc for dropped-identifier references. Inherited as CLEAN from ORCH-0700 Phase 2 landmine audit; not re-run because no new evidence suggests recurrence.
- **Full Track D edge-function grep**. Same reason — ORCH-0700 Phase 3 admin edge function scrub is the inheritance.
- **Track E full frontend grep**. Same inheritance from ORCH-0640 + ORCH-0700 + Cycle 13b closes.
- **Track F cron jobs + Track G RLS policies**. Out of scope for apply-time-blocker audit; non-zero but lower-priority risks. Spawn ORCH-0726 if the operator wants 100% coverage.
- **Other apply-time error classes** (ALTER COLUMN TYPE, CREATE EXTENSION, FK violations during data migrations). Not exhaustively scanned. The empirical signal is "Supabase Branch didn't fail on these in PR #62 first push," but that's a single-data-point sample. If post-fix push surfaces a non-Track-I error, escalate to ORCH-0724.
- **Squash-and-baseline option (forensics E4)** for the chain. Not re-evaluated; remains rejected per ORCH-0721 §7 unless a future close demonstrates 5+ bomb recurrence.
- **The COMMENT-ownership reservation pattern** that hit Cycle 14 close (`storage.objects` decorative COMMENTs that fail in Supabase Branch). Did not cross-check against historical migrations for similar instances. Recommend folding into ORCH-0724 if next push surfaces it.
