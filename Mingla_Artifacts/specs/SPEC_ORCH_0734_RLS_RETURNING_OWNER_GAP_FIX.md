# SPEC — ORCH-0734 — RLS-RETURNING-OWNER-GAP fix (mingla-business `brands`)

**Authored:** 2026-05-06 by mingla-forensics
**Investigation:** [`reports/INVESTIGATION_ORCH_0734_RLS_RETURNING_OWNER_GAP_AUDIT.md`](../reports/INVESTIGATION_ORCH_0734_RLS_RETURNING_OWNER_GAP_AUDIT.md)
**Closes root causes:** RC-0728-A (brand-create RETURNING) + RC-0728-B (brand-delete WITH CHECK)
**Status:** BINDING (implementor follows verbatim; deviations require new SPEC version)

---

## 1. Layman summary

Two new permissive policies on `public.brands` that say "the account owner can see and update their own brand," using a direct `account_id = auth.uid()` predicate that bypasses the SECURITY DEFINER helper function (which has the snapshot + deleted_at quirks that caused the bugs). One migration. Zero code changes. Zero risk to existing flows. After this ships, brand-create + brand-delete + brand-update all work for the account owner via the new direct policies, while non-owner brand admins continue to be governed by the existing helper-based policy unchanged.

Plus: one new invariant, one CI gate, one permanent skill memory file (DRAFT until tester PASSes ORCH-0734).

---

## 2. Scope, Non-goals, Assumptions

### 2.1 Scope

- **Database**: 1 new migration file adding 2 new permissive policies on `public.brands`, plus a database-level COMMENT documenting WHY each policy exists
- **CI**: 1 new shell/Node script + 1 new job entry in `.github/workflows/strict-grep-mingla-business.yml`
- **Memory**: 1 new file at `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_rls_returning_owner_gap.md` (status: DRAFT — flips to ACTIVE on ORCH-0734 CLOSE)
- **Invariant registry**: 1 new entry I-PROPOSED-H in `Mingla_Artifacts/INVARIANT_REGISTRY.md` (status: DRAFT — flips to ACTIVE on tester PASS)

### 2.2 Non-goals

- **Code changes** — zero. The migration alone closes both bugs without touching `brandsService.ts`.
- **Helper function modifications** — zero. `biz_brand_effective_rank` is preserved verbatim (CF-0734-1 in the investigation explains why).
- **Diagnostic-marker cleanup** — out of scope; orchestrator dispatches as a separate post-PASS cycle.
- **`events` soft-delete fix** (LF-1) — latent only; deferred until events soft-delete UI ships.
- **Brand admin (non-owner) soft-delete fix** (LF-2) — deferred to a future cycle when team-management features ship.
- **AFTER INSERT trigger creating brand_team_members for owner** (LF-3) — architectural improvement, not a bug fix; deferred.
- **App-mobile** — explicitly excluded by ORCH-0734 dispatch (operator directive).

### 2.3 Assumptions

- **A-1**: Postgres permissive policies are OR'd. Adding new policies cannot DENY anything that the existing policies admitted. (Verified: Postgres docs §5.8.)
- **A-2**: The `auth.uid()` function returns the JWT `sub` claim as a UUID under the `authenticated` role. (Verified: H40 PASS-12 JWT decode.)
- **A-3**: Existing migrations have been applied to production via `supabase db push`. (Verified: pg_policies + pg_proc enumeration matches latest migration text in `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` for the 23 policies + 7 helpers in scope.)
- **A-4**: `public.brands.account_id` is `NOT NULL` and immutable post-INSERT (verified: `trg_brands_immutable_account_id` BEFORE UPDATE trigger).
- **A-5**: supabase-js v2 default `Prefer` header for bare `.update()`/`.insert()` is `return=minimal`; chained `.select()` switches to `return=representation`. (Verified: PASS-7 raw-fetch probe.)

---

## 3. Database layer — exact SQL

### 3.1 Migration file

**Filename**: `supabase/migrations/20260507000000_orch_0734_rls_returning_owner_gap_fix.sql`

(Note: timestamp `20260507000000` chosen to follow `20260506000000_brand_kind_address_cover_hue_media.sql` and `20260506000001_orch_0737_async_trial_runs.sql` — the next free 24h-aligned slot. Implementor verifies no migration with this timestamp exists before write; if collision, bump by 1 second.)

### 3.2 Migration contents (verbatim — implementor pastes unchanged)

```sql
-- ORCH-0734 — RLS-RETURNING-OWNER-GAP fix for public.brands
--
-- Closes RC-0728 (proven 2026-05-06 after 13 forensic passes).
-- Two new permissive policies that admit the brand's account_owner via a
-- direct `account_id = auth.uid()` predicate (no SECURITY DEFINER helper),
-- bypassing both:
--   (a) The Postgres SECURITY DEFINER + STABLE function snapshot quirk that
--       prevents `biz_brand_effective_rank` from seeing a just-INSERTed brand
--       in the SELECT-for-RETURNING phase (BUG #1: brand-create 42501).
--   (b) The helper's `b.deleted_at IS NULL` gate that excludes a brand whose
--       deleted_at is being SET in the same UPDATE statement (BUG #2:
--       brand-delete 42501 at WITH CHECK time).
--
-- Permissive policies are OR'd in Postgres RLS. The existing
-- `Brand admin plus can update brands` policy continues to govern
-- non-owner brand admins exactly as before. The existing
-- `Brand members can select brands` and `Public can read brands with
-- public events` policies continue to govern collaborators and
-- public-page consumers exactly as before. This migration is purely
-- additive.
--
-- Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH_0734_RLS_RETURNING_OWNER_GAP_AUDIT.md
-- Spec:          Mingla_Artifacts/specs/SPEC_ORCH_0734_RLS_RETURNING_OWNER_GAP_FIX.md
-- Invariant:     I-PROPOSED-H (RLS-RETURNING-OWNER-GAP-PREVENTED)

-- =============================================================
-- Policy 1 of 2 — owner can SELECT own brand (any deleted_at state)
-- =============================================================
-- Direct predicate: no helper function, no in-transaction snapshot dependency.
-- Admits the just-INSERTed brand via SELECT-for-RETURNING because the new
-- row's account_id matches auth.uid() and Postgres RLS evaluates the policy
-- expression directly against NEW row columns.
--
-- We deliberately do NOT gate on `deleted_at IS NULL` here. Reasons:
--   1. Owners need to see soft-deleted brands in admin/recovery UI flows.
--   2. The brand-delete UPDATE...RETURNING (if .select() ever chained) needs
--      a SELECT policy that admits the post-delete row state.
--   3. Existing `"Brand members"` SELECT policy still gates on deleted_at
--      IS NULL for the brand-team flows that should not see tombstones.

CREATE POLICY "Account owner can select own brands"
ON public.brands
FOR SELECT
TO authenticated
USING (account_id = auth.uid());

COMMENT ON POLICY "Account owner can select own brands" ON public.brands IS
  'ORCH-0734 RC-0728-A fix: direct-predicate owner-SELECT bypasses SECURITY DEFINER helper that empirically failed to admit just-INSERTed brand row in RETURNING context. No deleted_at gate so owners can see tombstones for recovery / audit and so soft-delete UPDATE...RETURNING (if ever wired) admits the post-mutation row.';

-- =============================================================
-- Policy 2 of 2 — owner can UPDATE own brand (incl. soft-delete)
-- =============================================================
-- Direct predicate for both USING (find old row) and WITH CHECK (admit new
-- row). The brand's account_id is enforced immutable by trg_brands_immutable_account_id
-- BEFORE UPDATE trigger, so this WITH CHECK is safe (new account_id ALWAYS
-- equals old account_id ALWAYS equals auth.uid() for the owner).
--
-- Critically: WITH CHECK has no `deleted_at IS NULL` gate. This is the fix
-- for BUG #2: when the UPDATE sets deleted_at = now(), the post-mutation
-- row's account_id still equals auth.uid() so WITH CHECK passes. The
-- existing helper-based "Brand admin plus can update brands" policy still
-- governs non-owner admins for non-soft-delete updates.

CREATE POLICY "Account owner can update own brand"
ON public.brands
FOR UPDATE
TO authenticated
USING (account_id = auth.uid())
WITH CHECK (account_id = auth.uid());

COMMENT ON POLICY "Account owner can update own brand" ON public.brands IS
  'ORCH-0734 RC-0728-B fix: direct-predicate owner-UPDATE bypasses SECURITY DEFINER helper whose `b.deleted_at IS NULL` gate excluded the post-mutation row state during soft-delete UPDATE WITH CHECK evaluation. account_id immutability is enforced by trg_brands_immutable_account_id BEFORE UPDATE trigger.';

-- =============================================================
-- Verification probes (read-only; do NOT modify state)
-- =============================================================
-- These probes run inline after the policies are created so a `supabase
-- db push` failure surfaces immediately if anything is wrong. They do not
-- modify state. Implementor + tester rely on `supabase db push` exit code +
-- `supabase migration list` to confirm migration was applied; these probes
-- are belt-and-suspenders.

DO $$
DECLARE
  expected_count int := 7;  -- original 5 + 2 new = 7 policies on brands
  actual_count   int;
BEGIN
  SELECT count(*) INTO actual_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'brands';

  IF actual_count <> expected_count THEN
    RAISE EXCEPTION 'ORCH-0734 verification probe failed: brands has % policies, expected %', actual_count, expected_count;
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'brands'
      AND policyname = 'Account owner can select own brands'
      AND cmd = 'SELECT'
      AND qual = '(account_id = auth.uid())'
  ) THEN
    RAISE EXCEPTION 'ORCH-0734 verification probe failed: SELECT policy not registered correctly';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'brands'
      AND policyname = 'Account owner can update own brand'
      AND cmd = 'UPDATE'
      AND qual = '(account_id = auth.uid())'
      AND with_check = '(account_id = auth.uid())'
  ) THEN
    RAISE EXCEPTION 'ORCH-0734 verification probe failed: UPDATE policy not registered correctly';
  END IF;
END$$;
```

### 3.3 What this migration does NOT change

- Existing 5 policies on `public.brands` (1 INSERT, 1 UPDATE-helper-based, 1 DELETE, 2 SELECT) — unchanged.
- All policies on every other table — unchanged.
- All 7 SECURITY DEFINER helper functions (`biz_*`) — unchanged.
- All 9 BEFORE-UPDATE triggers on in-scope tables — unchanged.
- All `brand_team_members`, `brand_invitations`, `audit_log`, `creator_accounts`, `events` policies — unchanged.

---

## 4. Code layer — zero changes

The fix is purely DB-layer. mingla-business code is correct as-written:
- `services/brandsService.ts:94-98` createBrand `.insert(...).select().single()` — works after migration (new SELECT policy admits RETURNING)
- `services/brandsService.ts:165-171` updateBrand `.update(...).select().single()` — already worked for non-soft-delete updates (helper admits owner); continues to work
- `services/brandsService.ts:222-228` softDeleteBrand bare `.update(...)` — works after migration (new UPDATE policy admits soft-delete WITH CHECK)
- All other supabase calls — unaffected

**No service-layer, hook-layer, or component-layer changes are required.**

---

## 5. CI Gate — strict-grep enforcement of I-PROPOSED-H

### 5.1 New script: `scripts/ci/check_rls_returning_owner_gap.sh`

```bash
#!/usr/bin/env bash
# I-PROPOSED-H — RLS-RETURNING-OWNER-GAP-PREVENTED
#
# For every CREATE POLICY ... FOR (INSERT|UPDATE|DELETE) added in a migration
# under supabase/migrations/, assert that EITHER:
#   (a) the table has a CREATE POLICY ... FOR SELECT with a USING clause
#       that uses `auth.uid()` directly (not via a SECURITY DEFINER helper),
#       OR
#   (b) the migration explicitly waives this rule with the magic comment
#       `-- I-RLS-OWNER-GAP-WAIVER: <ORCH-ID> <reason>` immediately above
#       the CREATE POLICY statement.
#
# The waiver mechanism exists for genuinely service-role-only tables where
# direct-predicate owner-SELECT doesn't make sense (e.g., audit_log).

set -euo pipefail

MIGRATIONS_DIR="${1:-supabase/migrations}"
EXIT_CODE=0

# Collect every (table, mutation) pair that has a mutation policy
# Collect every (table) with a direct-predicate owner-SELECT policy
# Diff them; report tables that have mutation policies but no admitting SELECT

# (Implementor: write the actual grep + parse logic here; this is a sketch.)
# Recommended approach: use Postgres SQL parser (e.g., pg_query npm package)
# to walk every migration file and extract CREATE POLICY DDL nodes.

# Minimal viable version (line-grep heuristic):
# 1. Find all CREATE POLICY ... FOR (INSERT|UPDATE|DELETE) statements.
# 2. For each, extract table name + verify that the same table has a
#    CREATE POLICY ... FOR SELECT statement somewhere in migrations/ whose
#    USING clause matches /auth\.uid\(\)/ AND does NOT match /biz_[a-z_]*for_caller/.
# 3. If not, fail with file:line:table.

# Skeleton:
echo "[I-PROPOSED-H] Running RLS-RETURNING-OWNER-GAP CI gate against $MIGRATIONS_DIR..."

# (full implementation deferred to implementor — see §10 implementation notes)

if [ $EXIT_CODE -ne 0 ]; then
  echo "[I-PROPOSED-H] FAIL: see above for tables missing direct-predicate owner-SELECT policy."
  exit 1
fi

echo "[I-PROPOSED-H] PASS"
```

### 5.2 Workflow integration

Add to existing `.github/workflows/strict-grep-mingla-business.yml`:

```yaml
  rls-returning-owner-gap:
    name: I-PROPOSED-H — RLS-RETURNING-OWNER-GAP
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run CI gate
        run: bash scripts/ci/check_rls_returning_owner_gap.sh supabase/migrations
```

Per `feedback_strict_grep_registry_pattern` — single script + single job; never create parallel workflow files.

### 5.3 Implementor freedom

The exact parser implementation is left to the implementor. **Acceptable approaches:**
- pg_query (npm) for proper SQL AST parsing
- ripgrep + awk for line-based heuristic (acceptable if it correctly handles multi-line CREATE POLICY)
- Custom Deno script (implementor's choice)

**Required behavior** regardless of implementation:
- For every `CREATE POLICY ... FOR (INSERT|UPDATE|DELETE) ON public.<table>` in migrations/, find at least one `CREATE POLICY ... FOR SELECT ON public.<table>` whose USING clause uses `auth.uid()` directly (matches `auth\.uid\(\)` AND does not match `biz_[a-z_]+_for_caller\(`).
- If absent, fail unless the magic waiver comment is present immediately above the mutation policy.
- Exit code 1 on failure with a clear human-readable message.
- Run on PR + push to `Seth` and `main`.

---

## 6. Permanent skill memory (DRAFT — flips to ACTIVE on tester PASS)

**Path**: `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_rls_returning_owner_gap.md`

**Frontmatter**:

```markdown
---
name: RLS-RETURNING-OWNER-GAP bug class
description: supabase-js mutations on RLS-gated tables can fail with 42501 even when the mutation's WITH CHECK passes — because RETURNING (default for .insert/.update/.delete chained with .select()) and WITH CHECK (for soft-delete UPDATE) evaluate SELECT/UPDATE policies on the post-mutation row state. If no policy admits that state, the entire mutation rolls back. Always pair every owner-callable mutation policy with a direct-predicate owner-SELECT (and direct-predicate owner-UPDATE for soft-delete) that bypasses SECURITY DEFINER helpers.
type: feedback
status: DRAFT — flips to ACTIVE on ORCH-0734 CLOSE
---
```

**Body** (binding text — implementor copies verbatim):

```markdown
# RLS-RETURNING-OWNER-GAP

When a supabase-js mutation on an RLS-gated table fails with code 42501 / "new row violates row-level security policy" but the mutation's WITH CHECK predicate is *demonstrably* satisfied (e.g., direct-predicate equality between row column and auth.uid()), the bug is almost always one of:

1. **SELECT-for-RETURNING denial** — `.insert(...).select()` / `.update(...).select()` / `.delete().select()` triggers PostgREST `Prefer: return=representation`, which makes Postgres evaluate SELECT policies on the post-mutation row. If no SELECT policy admits that row state, the mutation rolls back with 42501 even though the mutation policy WITH CHECK passed. **Always pair every owner-callable mutation policy with a direct-predicate (`account_id = auth.uid()` style) owner-SELECT policy** that admits the post-mutation row state. Direct predicates are immune to SECURITY DEFINER + STABLE snapshot quirks that affect helper-function-based policies in INSERT...RETURNING context.

2. **WITH CHECK exclusion via helper deleted_at gate** — soft-delete UPDATEs that set `deleted_at = now()` produce post-mutation row state where `deleted_at IS NOT NULL`. If the UPDATE policy's WITH CHECK uses a SECURITY DEFINER helper that gates on `deleted_at IS NULL`, the helper retroactively excludes the in-transaction NEW row, returns FALSE, WITH CHECK fails. **Always pair every owner-callable UPDATE policy with a direct-predicate owner-UPDATE policy** whose WITH CHECK does NOT depend on a column being mutated.

## How to apply

When auditing or designing RLS for a new table, check each authenticated INSERT/UPDATE/DELETE policy:

- Does the table have at least one SELECT policy whose USING clause uses `auth.uid()` directly (no SECURITY DEFINER helper) and admits the post-mutation row state?
- Does each UPDATE policy have a WITH CHECK that does not require a column the UPDATE itself can modify?

If either answer is "no", add a direct-predicate owner policy that closes the gap.

## Why this exists

ORCH-0728 + ORCH-0729 + ORCH-0731 + ORCH-0734 (2026-05-06) — operator reported brand-create + brand-delete glitches. After 13 forensic passes:

- H39 toggle proved RLS is the denier (DISABLE RLS → success; ENABLE RLS → 42501)
- H40 JWT decode proved JWT `sub` matches `user.id` exactly (not an auth issue)
- H41 pg_policies enumeration proved only 5 policies on brands; none admit a just-INSERTed row via direct predicate (only via SECURITY DEFINER `biz_is_brand_member_for_read_for_caller` which empirically fails)
- H42 INSERT-without-RETURNING succeeded under simulated authenticated context (proved RETURNING is the failure point for brand-create)
- Operator confirmed brand-delete fails with 42501 too (different mechanism: WITH CHECK of helper that gates on deleted_at IS NULL)

ORCH-0734 closes both with 2 new permissive policies on `public.brands` using direct-predicate `account_id = auth.uid()`. CI gate I-PROPOSED-H enforces this pattern for every future migration.

## Anti-pattern signature

Look for: `CREATE POLICY ... FOR (INSERT|UPDATE|DELETE)` on a public table whose only SELECT policies route through SECURITY DEFINER helpers.

## Pattern signature

Pair: one `CREATE POLICY ... FOR INSERT WITH CHECK (col = auth.uid() AND ...)` + one `CREATE POLICY ... FOR SELECT USING (col = auth.uid())` + one `CREATE POLICY ... FOR UPDATE USING (col = auth.uid()) WITH CHECK (col = auth.uid())` (the latter only if soft-delete or owner-driven UPDATE is supported).

## Discovered: 2026-05-06 (ORCH-0734)
## Codified: at ORCH-0734 CLOSE (operator flips this file to ACTIVE)
```

### 6.1 MEMORY.md index entry (DRAFT until ACTIVE)

Add under "Supabase / Backend Patterns" section heading (or create section if absent):

```markdown
- [RLS-RETURNING-OWNER-GAP bug class](feedback_rls_returning_owner_gap.md) — pair every owner-callable mutation policy with direct-predicate owner-SELECT/UPDATE; SECURITY DEFINER helpers fail in RETURNING + soft-delete WITH CHECK contexts (status: DRAFT — flips to ACTIVE on ORCH-0734 CLOSE)
```

---

## 7. Invariant Registry — I-PROPOSED-H (DRAFT)

**Add to `Mingla_Artifacts/INVARIANT_REGISTRY.md`** (orchestrator owns this update; implementor confirms entry exists post-write):

```markdown
### I-PROPOSED-H — RLS-RETURNING-OWNER-GAP-PREVENTED (DRAFT)

**Status:** DRAFT — flips to ACTIVE on ORCH-0734 tester PASS

**Statement:** Every authenticated mutation policy (`CREATE POLICY ... FOR INSERT|UPDATE|DELETE`) on a `public.*` schema table MUST be paired with at least one SELECT policy whose USING clause uses `auth.uid()` directly (not via a SECURITY DEFINER helper function), AND every UPDATE policy whose WITH CHECK uses a helper function MUST also be paired with a direct-predicate fallback policy if the mutation can change a column referenced in the helper's predicate.

**Why:** SECURITY DEFINER + STABLE helper functions called from RLS policies have two failure modes:
(1) In INSERT...RETURNING context, the helper may not see the just-inserted row (snapshot quirk); SELECT-for-RETURNING fails; mutation rolls back with 42501 even though WITH CHECK passed.
(2) When UPDATE sets a column the helper gates on (e.g., `deleted_at`), the helper's evaluation against the post-mutation row excludes it; WITH CHECK fails; mutation rolls back with 42501.

Direct-predicate policies (`account_id = auth.uid()`-style) bypass both failure modes.

**Enforcement:** CI gate at `.github/workflows/strict-grep-mingla-business.yml` job `rls-returning-owner-gap` running `scripts/ci/check_rls_returning_owner_gap.sh`. Fails build if any `CREATE POLICY FOR (INSERT|UPDATE|DELETE)` on `public.*` lacks a paired direct-predicate SELECT policy on the same table (waivable via magic comment for genuinely service-role-only tables).

**Confirmed bug class:** RC-0728 (RLS-RETURNING-OWNER-GAP)

**Source:** ORCH-0734 (audit 2026-05-06)
```

---

## 8. Success Criteria

| ID | Statement | Verification | Layer |
|---|---|---|---|
| SC-1 | Brand-create from `BrandSwitcherSheet` succeeds: brand row persists in `public.brands`, appears in switcher list, no 42501 in Metro logs | Force-reload Metro → tap Create brand with name "TestBrand" → confirm Toast "Brand created" + brand visible in switcher dropdown. SQL probe: `SELECT id, name, account_id, deleted_at FROM brands WHERE name = 'TestBrand'` returns 1 row. | Full-stack |
| SC-2 | Brand-delete from `BrandDeleteSheet` succeeds: row marked soft-deleted in DB (`deleted_at IS NOT NULL`), brand removed from switcher, no 42501 in Metro logs | Force-reload Metro → open switcher → tap delete on TestBrand → confirm in delete sheet → confirm brand removed from switcher list. SQL probe: `SELECT deleted_at FROM brands WHERE name = 'TestBrand'` returns non-null timestamp. | Full-stack |
| SC-3 | Brand-update non-soft-delete (e.g., rename via `BrandSettings`) still succeeds (regression check) | Force-reload Metro → edit brand name → save → confirm name updated. SQL probe: `SELECT name, deleted_at FROM brands WHERE id = X` returns new name + `deleted_at IS NULL`. | Full-stack |
| SC-4 | Re-deleting an already-soft-deleted brand is idempotent (no 42501, no toast error) | Tap delete on already-soft-deleted brand → confirm no error. The `.is("deleted_at", null)` filter at WHERE level returns 0 rows; UPDATE 0 ROWS — supabase-js returns success. | Code (existing pattern) |
| SC-5 | After migration, `pg_policies` shows exactly 7 policies on `brands` (existing 5 + 2 new), with the 2 new policies' qual + with_check matching the spec verbatim | SQL probe: `SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='brands'` returns 7. + `SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='brands' AND policyname LIKE 'Account owner%'` returns 2 rows matching spec. | DB |
| SC-6 | The migration's inline DO blocks (verification probes in §3.2) all pass without RAISE EXCEPTION | `supabase db push` exits 0; `supabase migration list` shows new migration as applied | DB |
| SC-7 | CI gate `rls-returning-owner-gap` runs on PR and reports PASS for the post-migration codebase (no false positives on existing waiver-not-needed tables) | GitHub Actions log shows job green; manual test by adding a deliberate violating policy and confirming the gate catches it | CI |
| SC-8 | Six diagnostic markers `[ORCH-0728/0729/0730/0733-DIAG]` continue to log on every Create-tap (PROOF that the markers stayed; their REMOVAL is a separate post-PASS dispatch) | Force-reload + Create-tap → Metro logs show all 6 diagnostic blocks AS BEFORE | Code |

---

## 9. Test Cases

| ID | Scenario | Input | Expected Output | Layer | Maps to SC |
|---|---|---|---|---|---|
| T-01 | Brand-create happy path (owner) | name="TestBrand1", auth: account owner | brand row in DB; appears in switcher; no 42501 | Full-stack | SC-1 |
| T-02 | Brand-create with duplicate slug | name="TestBrand1" again (slug collision) | inline error "This brand name is taken..."; no 42501 (existing slug-collision logic) | Service + UI | SC-1 |
| T-03 | Brand-soft-delete happy path (owner) | tap delete on TestBrand1 | row.deleted_at NOT NULL; brand removed from switcher; no 42501 | Full-stack | SC-2 |
| T-04 | Brand-soft-delete blocked by upcoming events | (workflow rejection — pre-existing) | reject-modal shows "X upcoming events" — pre-existing UX | Service + UI | (regression check) |
| T-05 | Brand-update non-soft-delete | edit brand name "TestBrand2" → "TestBrand2_renamed" | row.name updated; deleted_at unchanged; no 42501 | Full-stack | SC-3 |
| T-06 | Brand-update on already-soft-deleted brand | UPDATE on brand whose deleted_at IS NOT NULL | the existing `.is("deleted_at", null)` filter returns 0 rows; UPDATE 0 rows; supabase-js returns success (idempotent) — pre-existing safety | Service | SC-4 |
| T-07 | Re-soft-delete already-deleted brand | tap delete twice fast | second delete returns success (0 rows updated); no 42501 | Service + UI | SC-4 |
| T-08 | Migration dry-run (DO blocks) | `supabase db push` against staging | exit 0; verification probes all pass; new policies registered | DB | SC-5, SC-6 |
| T-09 | CI gate detects violation | add a deliberate `CREATE POLICY FOR INSERT ON public.x_table` with no direct-predicate SELECT companion → run CI | CI fails with clear message identifying x_table | CI | SC-7 |
| T-10 | CI gate respects waiver | add `-- I-RLS-OWNER-GAP-WAIVER: ORCH-XXX service-role-only audit table` above the violating policy | CI passes | CI | SC-7 |

Test execution by mingla-tester per ORCH-0734 dispatch protocol; SC-1..SC-3 + SC-5 + SC-6 are blocking; SC-7 is also blocking; SC-4, SC-8 are regression checks.

---

## 10. Implementation Order

1. **Apply migration** — Implementor writes `supabase/migrations/20260507000000_orch_0734_rls_returning_owner_gap_fix.sql` per §3.2 verbatim. Implementor does NOT run `supabase db push` (operator owns deployment per memory `feedback_orchestrator_never_executes`). Implementor confirms file is on-disk + content matches §3.2 verbatim.
2. **Write CI script** — Implementor writes `scripts/ci/check_rls_returning_owner_gap.sh` with full parser logic (per §5.3 acceptable approaches). Implementor includes a self-test mode (`--self-test` flag) that creates a temp file with a violating policy, runs the gate, asserts FAIL, then creates a passing temp file, runs the gate, asserts PASS. Implementor manually runs `bash scripts/ci/check_rls_returning_owner_gap.sh --self-test` and confirms exit 0.
3. **Add CI workflow job** — Implementor adds the `rls-returning-owner-gap` job to `.github/workflows/strict-grep-mingla-business.yml` per §5.2.
4. **Write skill memory file** — Implementor creates `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_rls_returning_owner_gap.md` with frontmatter `status: DRAFT — flips to ACTIVE on ORCH-0734 CLOSE` and body verbatim per §6.
5. **Add MEMORY.md index entry** — Implementor adds the one-line entry per §6.1.
6. **Add invariant entry** — Implementor adds I-PROPOSED-H to `Mingla_Artifacts/INVARIANT_REGISTRY.md` per §7 with `status: DRAFT`.
7. **Write implementation report** — Implementor produces `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH_0734_REPORT.md` with old/new receipts for each file, verification matrix, traceability to SC-1..SC-8, and explicit confirmation that CODE FILES (services/brandsService.ts, etc.) are UNCHANGED.

**No code-side changes.** Implementor flags as a deviation if any `.ts`/`.tsx` file is modified.

**Operator post-IMPL steps:**
- Operator runs `supabase db push` to apply migration.
- Operator force-reloads Metro and runs T-01 through T-07 (UI-driven tests).
- Operator captures terminal output showing 6 diagnostic markers + brand-create + brand-delete success.
- Operator dispatches mingla-tester for full PASS verification.

---

## 11. Invariants this fix preserves (regression check)

| Invariant | Preservation |
|---|---|
| I-1 RLS enabled on every public table | ✅ unchanged |
| I-PROPOSED-D MB-ERROR-COVERAGE | ✅ unchanged (existing diagnostic markers preserved) |
| I-PROPOSED-E STUB-BRAND-PURGED | ✅ unchanged |
| I-PROPOSED-F JWT-PROJECT-MATCH (per ORCH-0729 SPEC) | ✅ unchanged |
| Constitutional #2 One owner per truth | ✅ unchanged — brands ownership semantics unchanged |
| Constitutional #3 No silent failures | ✅ unchanged — diagnostic markers preserved |
| Soft-delete pattern semantics ("tombstones don't grant operational permission to non-owners") | ✅ preserved — the new owner-direct policy admits owner-only; non-owner brand admins still gated by helper |

This fix preserves every existing invariant. The new invariant I-PROPOSED-H is purely additive.

---

## 12. Regression surface

3-5 adjacent flows the tester should verify did not regress:

1. **Brand list (switch sheet rows)** — `brandsService.getBrands` SELECT — should still list owner's brands. Helper-based "Brand members" policy still admits via account-owner implicit grant. Plus new direct-predicate policy admits redundantly.
2. **Brand profile read** — `brandsService.getBrand` SELECT-by-id — should still work for owner. Same dual-policy admission.
3. **Public events page** — `Public can read brands with public events` SELECT (anon + authenticated) — unchanged policy; should still admit brands with public events.
4. **Brand admin (non-owner) read** — if any `brand_team_members` row exists with rank ≥ admin and the user attempts to read the brand: helper-based "Brand members" policy admits. New direct-predicate policy does NOT admit (account_id != auth.uid()) but it doesn't need to — helper already admits. ✅
5. **Brand admin (non-owner) update** — should still work via helper-based "Brand admin plus can update brands" policy. New direct-predicate UPDATE policy does NOT admit non-owner. ✅
6. **Account deletion** — `useAccountDeletion` flow updates `creator_accounts` (different table) — entirely unaffected.

---

## 13. Discoveries that DO NOT block this SPEC

These are flagged in the investigation report (§9) and pre-registered as future cycles by orchestrator:

- **D-FOR-0734-1** — events soft-delete RETURNING latent bug (LF-1) → ORCH-0735 candidate
- **D-FOR-0734-2** — brand_admin (non-owner) cannot soft-delete brand after this fix (LF-2) → ORCH-0736 candidate
- **D-FOR-0734-3** — no AFTER INSERT trigger creating brand_team_members owner row (LF-3) → architectural improvement
- **D-FOR-0734-4** — `trg_audit_log_block_update` naming inconsistency → cosmetic cleanup
- **D-FOR-0734-5** — 6 diagnostic markers cleanup → orchestrator's separate post-PASS dispatch
- **D-FOR-0734-6** — Postgres SECURITY DEFINER STABLE in INSERT...RETURNING mechanism → covered in skill memory file (§6) appendix

---

## 14. Confidence

**HIGH** that this SPEC closes RC-0728 cleanly:
- Empirical proof from PASS-13 chain (H39+H40+H41+H42) localizes the bug to RLS at the policy level.
- The fix is purely additive (permissive policies OR'd) — cannot regress existing behavior.
- Direct-predicate `account_id = auth.uid()` is immune to all known SECURITY DEFINER + STABLE failure modes.
- Migration verification probes (DO blocks in §3.2) catch any drift between spec and applied DB state at deploy time.
- CI gate prevents reintroduction.

**MEDIUM** on whether one or two new policies will fire in production (vs. helper-based admission winning the OR):
- Doesn't matter for correctness — Postgres OR-evaluation order is implementation-defined.
- Logging/EXPLAIN diagnostics could confirm but is not blocking.

---

**End of SPEC.**
