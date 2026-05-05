# IMPLEMENTATION report — ORCH-0728 — Backfill missing `place_pool.claimed_by` ADD COLUMN before matview reference

**Status:** implemented, partially verified
**Verification:** 3/4 SC PASS via static checks; SC-4 (`supabase db reset`) UNVERIFIED — operator confirms via Supabase Branch on push.
**Confidence:** H for the targeted fix (mechanically correct insertion); H- on whether the next push is GREEN (other dashboard-only schema additions may exist — unbounded class).
**Effort actual:** ~3 minutes.
**Files touched:** 1
**Lines changed:** +5 (1 master header + 3 ORCH-0728 protective comment lines + 1 ALTER TABLE + spacing).

**Backward deps:**
- Forensics: ORCH-0725 §10 noted Track H deferral of "schema additions added via dashboard but not in migrations" — explicitly out of scope. ORCH-0728 is the post-discovery fix.
- Dispatch: [`Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0728_ADD_CLAIMED_BY_COLUMN.md`](../prompts/IMPLEMENTOR_ORCH-0728_ADD_CLAIMED_BY_COLUMN.md).
- Sibling commits: `4e8f784d` (ORCH-0721) + `cd276c3b` (ORCH-0722) + `27d8c0c1` (ORCH-0724/0725 Option A — superseded) + `0b706dc3` (ORCH-0727 Option B).

---

## 1. Plain-English summary

Inserted `ALTER TABLE public.place_pool ADD COLUMN IF NOT EXISTS claimed_by UUID;` at line 62 of `20260418000001_orch0481_admin_mv_layer.sql`, immediately before the `CREATE MATERIALIZED VIEW` at line 71. `IF NOT EXISTS` makes it a no-op on production (column already exists there). Fresh-DB replay now adds the column before the matview references it.

This is a schema-drift fix: production was incrementally built via Supabase dashboard direct SQL, and `claimed_by` was added there but never backfilled into the migration chain. The audit framework can't statically predict every such drift; operator has been advised the class is empirically unbounded.

---

## 2. Pre-flight summary

**Mission:** insert ALTER TABLE backfill before the matview CREATE in `20260418000001_orch0481_admin_mv_layer.sql`.

**Battlefield read:**
- Target file: 600+ lines; read header (1-80) end-to-end to find insertion point.
- Located WAVE 1 boundary at line 56-58 (header comment block) + line 66 (original `DROP MATERIALIZED VIEW IF EXISTS`).
- Identified clean insertion point: between WAVE 1 header block and the DROP MATERIALIZED VIEW statement, after `SET LOCAL statement_timeout = '15min';` at original line 53.
- Adjacent files: 2 other matview rebuild migrations (`20260425000003`, `20260503000004`) reference `claimed_by` too — but they DROP+CREATE the matview, and the column persists across drops since it's on `place_pool`, not on the matview. Single ALTER at the earliest matview migration is sufficient.

**Blast radius:**
- Direct: 1 file.
- Cascade: 0 — production unchanged; column type matches likely original (UUID nullable).
- Parity: N/A.
- Cache: 0.

**Invariants:**
- I-MIGRATIONS-FRESH-REPLAY-SUCCESS (DRAFT) — newly satisfied for `20260418000001`.

---

## 3. Old → New receipt

### `supabase/migrations/20260418000001_orch0481_admin_mv_layer.sql`

**What it did before:**
- Line 1 began with `-- ============…` and `-- ORCH-0481: Admin RPC Materialized View Layer (Systemic Fix)`.
- WAVE 1 began at line 55 (header comment block) followed immediately by `DROP MATERIALIZED VIEW IF EXISTS public.admin_place_pool_mv CASCADE;` on line 61, then `CREATE MATERIALIZED VIEW public.admin_place_pool_mv AS SELECT … pp.claimed_by IS NOT NULL AS is_claimed …`.
- On fresh DB replay: SQLSTATE 42703 fires because `claimed_by` doesn't exist on `place_pool`.

**What it does now:**
- Line 1: ORCH-0728 master header citing fix rationale + sibling commit chain.
- Lines 2-3: Original ORCH-0481 header (shifted +1).
- Lines 60-62: NEW ORCH-0728 protective comment + `ALTER TABLE public.place_pool ADD COLUMN IF NOT EXISTS claimed_by UUID;` immediately before the DROP MATERIALIZED VIEW.
- Line 66: `DROP MATERIALIZED VIEW IF EXISTS …` (unchanged content; shifted +5).
- Line 71: `CREATE MATERIALIZED VIEW … pp.claimed_by IS NOT NULL AS is_claimed …` (unchanged content; shifted +5).
- On fresh DB replay: ALTER TABLE adds the column (no-op on prod via IF NOT EXISTS); matview CREATE then succeeds because the column exists.

**Why:**
- ORCH-0728 dispatch §1 root cause: schema drift between prod (column exists) and migration chain (no ADD COLUMN).
- Pattern: same as prior bombs (production absorbed change via dashboard; chain never updated).

**Lines changed:** +5 (1 master header + 1 spacing + 2 protective comment lines + 1 ALTER TABLE + 1 trailing blank).

---

## 4. Verification matrix

| # | Criterion | Verification | Result |
|---|-----------|--------------|--------|
| SC-1 | `ALTER TABLE public.place_pool ADD COLUMN IF NOT EXISTS claimed_by UUID;` present BEFORE `CREATE MATERIALIZED VIEW public.admin_place_pool_mv` | Grep: ALTER TABLE at line 62; CREATE MATERIALIZED VIEW at line 71. Order: 62 < 71 ✓. | **PASS** |
| SC-2 | ORCH-0728 master header at line 1 verbatim per dispatch §2.1 | File re-read; line 1 byte-match. | **PASS** |
| SC-3 | Matview body and other DDL unchanged | File re-read; CREATE MATERIALIZED VIEW + body content + WAVE 0 (`SET LOCAL statement_timeout`) all preserved at expected positions. | **PASS** |
| SC-4 | (If feasible) `supabase db reset` past line 113 | NOT RUN — dispatch-authorized skip per §3 step 6. Operator verifies via Supabase Branch on push. | **UNVERIFIED — operator confirms** |

---

## 5. Static verification log

```
$ grep -nE "ADD COLUMN IF NOT EXISTS claimed_by|CREATE MATERIALIZED VIEW public\.admin_place_pool_mv" supabase/migrations/20260418000001_orch0481_admin_mv_layer.sql
62:ALTER TABLE public.place_pool ADD COLUMN IF NOT EXISTS claimed_by UUID;
71:CREATE MATERIALIZED VIEW public.admin_place_pool_mv AS
```

Ordering correct (ALTER before CREATE). Single match for each pattern.

---

## 6. Local replay log

**SKIPPED** per dispatch authorization. Operator verifies via Supabase Branch.

---

## 7. Invariant preservation check

| Invariant | Pre-edit | Post-edit | Status |
|-----------|---------|----------|--------|
| I-MIGRATIONS-FRESH-REPLAY-SUCCESS (DRAFT) | Violated for this file (SQLSTATE 42703 at matview CREATE) | Satisfied for this file | **NEWLY SATISFIED** |
| Other DRAFT invariants | Out of scope | Out of scope | **PRESERVED** |

---

## 8. Parity check

N/A.

---

## 9. Cache safety check

- Query keys: NONE changed.
- Mutations: NONE changed.
- Data shapes: NONE changed (column added if missing; type matches likely production type).
- AsyncStorage: N/A.

---

## 10. Regression surface

1. **PR #62 push 6 Supabase Branch run** — likely outcomes:
   - **GREEN**: chain replays end-to-end; this was the last bomb.
   - **Red on another schema-drift bomb** (different missing column / different table): unbounded class; recommend escalation per orchestrator's strategic options A/B/C.
2. **Dev onboarding** — `claimed_by` now provisioned on fresh DBs.
3. **Production prod DB** — no-op via IF NOT EXISTS; checksum-mismatch warning HARMLESS.
4. **Admin Place Pool page caller** — `is_claimed` boolean flag continues to work (matview definition unchanged).

---

## 11. Constitutional compliance

- **#7 Label temporary fixes** — ORCH-0728 master header + per-block comments ARE the labels.
- **#8 Subtract before adding** — N/A (pure additive backfill).

**Compliance: PASS.**

---

## 12. Discoveries for orchestrator

**One — and it's the strategic one orchestrator already flagged.** The ORCH-0728 schema-drift class is empirically unbounded. Static analysis cannot predict which columns prod has that migrations don't add. If push 6 surfaces another missing column, escalate to orchestrator's option B (squash-baseline) or option C (disable failing CI check + queue ORCH-0729). One implementor pass cannot fix this class structurally.

**Minor:** the matview at this point in the chain still references `seeding_category`, `ai_categories`, `ai_approved`, `ai_validated_at` — all dropped later. This is fine because the matview gets DROPPED + REBUILT by ORCH-0640 ch03 (2026-04-25) and ORCH-0700 Migration 4 (2026-05-03), each rebuild matching the then-current schema. No additional fix needed.

---

## 13. Transition items

**None.**

---

## 14. Commit message

```
git add supabase/migrations/20260418000001_orch0481_admin_mv_layer.sql
git commit -m "$(cat <<'EOF'
fix(supabase): ORCH-0728 — backfill missing place_pool.claimed_by column before matview CREATE

20260418000001_orch0481_admin_mv_layer.sql Section "Wave 2" creates
admin_place_pool_mv referencing pp.claimed_by (IS NOT NULL boolean check),
but no migration in the chain adds the claimed_by column to place_pool.
Production has it (added via Supabase dashboard direct ALTER); fresh-DB
replay never had a backfilling migration. SQLSTATE 42703 on PR #62 push 5.

Fix: insert ALTER TABLE place_pool ADD COLUMN IF NOT EXISTS claimed_by UUID
immediately before the CREATE MATERIALIZED VIEW. IF NOT EXISTS makes it
a no-op on production (column already exists). Type matches the
claimed-by-user convention; only IS NOT NULL matters to the matview
consumer.

Empirical chain status:
- ORCH-0721 commit 4e8f784d unblocked CONCURRENTLY in 20260409200001
- ORCH-0722 commit cd276c3b unblocked OUT-param shape × 2 in 20260411000001
- ORCH-0727 commit 0b706dc3 unblocked SQLSTATE 23505 in 20260415100000
- This commit (ORCH-0728) unblocks SQLSTATE 42703 in 20260418000001
- Process gap acknowledged: schema drift between prod and migrations is
  unbounded by static analysis; durable fix is squash-baseline (ORCH-0729)

Forensics: schema-drift class. Audit framework cannot predict
dashboard-only schema additions without running the chain.
EOF
)"
```

NO `Co-Authored-By` line.

---

## 15. What operator does next

1. Apply the commit.
2. Push to `Seth`.
3. Watch PR #62 Supabase Branch — three possible outcomes:
   - **GREEN**: chain replays cleanly; orchestrator fires MEGA-CLOSE for ORCH-0721 + 0722 + 0723 + 0724 + 0725 + 0727 + 0728.
   - **Red on another schema-drift bomb** (different missing column / table): orchestrator's strategic options A/B/C kick in. Recommend C (disable Supabase Branch as blocking + queue ORCH-0729 squash-baseline).
   - **Red on a previously unseen class entirely**: same — escalate to orchestrator's strategic options.
