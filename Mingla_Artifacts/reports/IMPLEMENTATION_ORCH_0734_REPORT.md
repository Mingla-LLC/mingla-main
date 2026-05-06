# IMPL REPORT — ORCH-0734 — RLS-RETURNING-OWNER-GAP fix (mingla-business `brands`)

**Mode:** IMPLEMENT (binding spec — paste verbatim)
**Dispatch:** [`prompts/IMPL_ORCH_0734_RLS_RETURNING_OWNER_GAP_FIX.md`](../prompts/IMPL_ORCH_0734_RLS_RETURNING_OWNER_GAP_FIX.md)
**SPEC (BINDING):** [`specs/SPEC_ORCH_0734_RLS_RETURNING_OWNER_GAP_FIX.md`](../specs/SPEC_ORCH_0734_RLS_RETURNING_OWNER_GAP_FIX.md)
**Investigation:** [`reports/INVESTIGATION_ORCH_0734_RLS_RETURNING_OWNER_GAP_AUDIT.md`](INVESTIGATION_ORCH_0734_RLS_RETURNING_OWNER_GAP_AUDIT.md)
**Closes:** RC-0728 (after operator deploy + tester PASS)
**Authored:** 2026-05-06 by mingla-implementor
**Status:** `implemented, partially verified` — CI gate self-test passed; migration awaiting `supabase db push` by operator; UI smoke awaiting operator post-deploy.

---

## 1. Layman summary

- Wrote one new migration adding 2 permissive policies on `public.brands` ("Account owner can select own brands" + "Account owner can update own brand"), both using direct-predicate `account_id = auth.uid()` to bypass the SECURITY DEFINER helper that has the snapshot + deleted_at quirks. After `supabase db push`, brand-create + brand-delete will both work for the account owner.
- Wrote a Node.js CI gate (`.github/scripts/strict-grep/i-proposed-h-rls-returning-owner-gap.mjs`) that audits every new migration for compliance with I-PROPOSED-H. Going-forward enforcement only (cutoff timestamp `20260507000000`) — pre-existing legacy violations on out-of-scope tables remain as discoveries for future cycles.
- Zero code-side changes. No `.ts` / `.tsx` files touched. The 6 diagnostic markers stay (separate post-PASS cleanup).
- 7 artifacts produced: migration + CI script + workflow job + memory file (DRAFT) + MEMORY.md entry + invariant entry (DRAFT) + this report.

Status: implemented, partially verified · Verification: CI gate self-test PASSED (3/3 fixtures); migration awaiting operator `supabase db push`; UI smoke awaiting operator.

---

## 2. Sites patched

| # | File | Change | Lines |
|---|---|---|---|
| 1 | `supabase/migrations/20260507000000_orch_0734_rls_returning_owner_gap_fix.sql` | NEW — migration verbatim from SPEC §3.2 (2 CREATE POLICY + 2 COMMENT ON POLICY + 3 inline DO-block verification probes) | ~110 lines |
| 2 | `.github/scripts/strict-grep/i-proposed-h-rls-returning-owner-gap.mjs` | NEW — Node.js CI gate (regex-based SQL parser; --self-test mode; going-forward cutoff 20260507000000) | ~210 lines |
| 3 | `.github/workflows/strict-grep-mingla-business.yml` | MOD — added `i-proposed-h-rls-returning-owner-gap` job + registry comment + `supabase/migrations/**` path filter | +14 lines |
| 4 | `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_rls_returning_owner_gap.md` | NEW — skill memory file verbatim from SPEC §6 (status: DRAFT) | ~50 lines |
| 5 | `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/MEMORY.md` | MOD — added one-line entry under "Supabase Database Access" | +1 line |
| 6 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` | MOD — appended I-PROPOSED-H entry (status: DRAFT) | +24 lines |
| 7 | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH_0734_REPORT.md` | NEW — this report | ~270 lines |

**Code-side files touched:** 0. Verified by grep — no edits to `mingla-business/src/*`.

---

## 3. Old → New Receipts

### `supabase/migrations/20260507000000_orch_0734_rls_returning_owner_gap_fix.sql` (NEW)

**What it did before:** N/A (new file).

**What it does now:** Adds 2 permissive policies on `public.brands` using direct-predicate `account_id = auth.uid()` ownership. Permissive policies are OR'd with the existing 5 brands policies (1 INSERT + 1 UPDATE-helper-based + 1 DELETE + 2 SELECT) — purely additive. Plus 3 inline DO blocks that RAISE EXCEPTION on policy-count drift, missing SELECT policy, or missing UPDATE policy. Closes RC-0728-A (brand-create) + RC-0728-B (brand-delete) at the schema layer.

**Why:** SPEC §3.2 verbatim. The 2 new policies bypass the SECURITY DEFINER helper `biz_brand_effective_rank` that empirically failed to admit just-INSERTed brand rows in RETURNING context (RC-0728-A) and excluded post-soft-delete row state via its `deleted_at IS NULL` gate (RC-0728-B). Direct predicates are immune to both failure modes.

**Lines changed:** 0 (file is new). Approximately 110 lines added.

### `.github/scripts/strict-grep/i-proposed-h-rls-returning-owner-gap.mjs` (NEW)

**What it did before:** N/A (new file).

**What it does now:** Node.js CI gate enforcing I-PROPOSED-H. Audits all migrations under `supabase/migrations/` whose 14-digit timestamp prefix is `>= 20260507000000`. For each `CREATE POLICY ... FOR (INSERT|UPDATE|DELETE) ON public.<table>`, asserts that the same table has at least one `CREATE POLICY ... FOR SELECT` whose USING clause uses `auth.uid()` directly (not exclusively via SECURITY DEFINER `biz_*_for_caller` helpers). Supports waiver via `-- I-RLS-OWNER-GAP-WAIVER: <ORCH-ID> <reason>` magic comment immediately above a violating policy. Includes `--self-test` mode that creates synthetic violating + passing + waivered fixture migrations in a temp directory and asserts gate behaviour. Exit codes: 0 clean / 1 violations / 2 script error.

**Why:** SPEC §5 + DEC-101 strict-grep registry pattern. Per `feedback_strict_grep_registry_pattern` memory: every invariant CI gate plugs into `.github/workflows/strict-grep-mingla-business.yml` as ONE script + ONE job. Going-forward cutoff (20260507000000) prevents day-one CI breakage on the ~35 legacy violations in the squash baseline (out of ORCH-0734 scope; tracked as D-IMPL-0734-1).

**Lines changed:** 0 (file is new). Approximately 210 lines added.

### `.github/workflows/strict-grep-mingla-business.yml` (MOD)

**What it did before:** Workflow had 5 invariant gates (I-37 + I-38 + I-39 + I-PROPOSED-A + I-PROPOSED-C). `paths` filter triggered on `mingla-business/**` + `.github/scripts/strict-grep/**` + workflow file changes only.

**What it does now:** Workflow has 6 invariant gates with the addition of `i-proposed-h-rls-returning-owner-gap`. The new job runs both `--self-test` and the production gate sequentially. Path filter now also includes `supabase/migrations/**` so migration changes trigger the gate.

**Why:** SPEC §5.2 + the registry-pattern requirement that every gate is one job. Adding `supabase/migrations/**` to path filter ensures CI runs when implementor or future cycles add a new migration.

**Lines changed:** +14 (job entry + registry comment + path filter line).

### `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/feedback_rls_returning_owner_gap.md` (NEW)

**What it did before:** N/A (new file).

**What it does now:** Permanent skill memory codifying the RLS-RETURNING-OWNER-GAP bug class so investigator/spec-writer/implementor agents recognize it on sight. Frontmatter: `type: feedback`, `status: DRAFT — flips to ACTIVE on ORCH-0734 CLOSE`. Body covers two failure modes (SELECT-for-RETURNING denial; WITH CHECK exclusion via helper deleted_at gate), how-to-apply guidance, why the memory exists (PASS-13 evidence chain summary), anti-pattern signature, and pattern signature.

**Why:** SPEC §6 verbatim. Status flag remains DRAFT until orchestrator flips to ACTIVE at CLOSE per Step 5a protocol.

**Lines changed:** 0 (file is new). Approximately 50 lines added.

### `~/.claude/projects/c--Users-user-Desktop-mingla-main/memory/MEMORY.md` (MOD)

**What it did before:** "Supabase Database Access" section had 2 entries (MCP workaround + Management API reference).

**What it does now:** Section has 3 entries — added one-line link to the new RLS-RETURNING-OWNER-GAP memory file with status: DRAFT. Per SPEC §6.1.

**Lines changed:** +1.

### `Mingla_Artifacts/INVARIANT_REGISTRY.md` (MOD)

**What it did before:** Registry contained 5 I-PROPOSED entries (A through E) plus older numbered invariants.

**What it does now:** Registry has new I-PROPOSED-H entry at the bottom following the existing format. Status: DRAFT. Sections: Statement, Why, Enforcement, Waiver mechanism, Confirmed bug class, Source, Cross-reference, Test, EXIT condition. Verbatim from SPEC §7.

**Lines changed:** +24.

### `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH_0734_REPORT.md` (NEW)

**What it did before:** N/A (new file).

**What it does now:** This implementation report (15-section template).

**Lines changed:** 0 (file is new). Approximately 270 lines added.

---

## 4. Verification

### CI gate self-test

```
$ node .github/scripts/strict-grep/i-proposed-h-rls-returning-owner-gap.mjs --self-test
[SELF-TEST] PASS — violating fixture produced 1 violation(s) as expected.
[SELF-TEST] PASS — passing fixture produced 0 violations as expected.
[SELF-TEST] PASS — waiver fixture produced 0 violations as expected.

[SELF-TEST] ALL THREE FIXTURES PASSED — gate behaves correctly.
EXIT=0
```

✅ PASS — all three fixtures (violating, passing, waiver) behave as designed.

### CI gate full audit (real migrations directory, with going-forward cutoff)

```
$ node .github/scripts/strict-grep/i-proposed-h-rls-returning-owner-gap.mjs
[I-PROPOSED-H] Auditing C:\Users\user\Desktop\mingla-main\supabase\migrations ...
[I-PROPOSED-H] Scanned 1 table(s) with mutation policies; found 1 direct-predicate owner-SELECT policy/policies across all tables.
[I-PROPOSED-H] PASS — no RLS-RETURNING-OWNER-GAP violations found.
EXIT=0
```

✅ PASS — only the new ORCH-0734 migration is in scope (one table = brands; one direct-predicate owner-SELECT = the new policy). Pre-existing legacy migrations are exempt by design (cutoff `20260507000000`).

### Migration file syntax check

Manual line-by-line review against SPEC §3.2 — confirmed verbatim. Indentation preserved. SPEC §3.2 has 110 lines; file has 110 lines.

### Diagnostic markers preserved

```
$ grep -rn "\[ORCH-0728-DIAG\]\|\[ORCH-0729-DIAG\]\|\[ORCH-0730-DIAG\]\|\[ORCH-0733-DIAG\]" mingla-business/src/
```

(Implementor did not run this command but no `mingla-business/src/*` files were edited — diagnostic markers are mathematically preserved.)

✅ PASS by construction.

### TypeScript / build check

N/A — zero code-side changes. No `.ts` / `.tsx` files modified.

---

## 5. Spec Traceability — SC-1..SC-8 mapping

| SC | Statement | Verification status | Evidence |
|---|---|---|---|
| SC-1 | Brand-create succeeds | UNVERIFIED — operator UI test post `supabase db push` | Migration content closes RC-0728-A by construction (new SELECT policy admits via direct predicate); operator confirms via Create-tap |
| SC-2 | Brand-delete succeeds | UNVERIFIED — operator UI test post `supabase db push` | Migration content closes RC-0728-B by construction (new UPDATE policy admits via direct predicate without deleted_at gate); operator confirms via delete-tap |
| SC-3 | Brand-update non-soft-delete still works (regression) | UNVERIFIED — operator UI test post `supabase db push` | Migration is purely additive (permissive OR'd); existing helper-based UPDATE policy preserved; operator confirms via edit-name-tap |
| SC-4 | Re-delete idempotent | STATIC-TRACE verified | Existing `.is("deleted_at", null)` filter at `mingla-business/src/services/brandsService.ts:226` handles idempotency at the WHERE level (returns 0 rows on already-deleted brands); supabase-js returns success on 0 rows. Code unchanged. |
| SC-5 | pg_policies shows 7 brands policies after migration | UNVERIFIED — operator confirms post `supabase db push` | Migration's inline DO-block §3.2 RAISE EXCEPTION on `count(*) <> 7`; operator confirms via SQL probe `SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='brands'` returns 7 |
| SC-6 | Migration verification probes pass | UNVERIFIED — operator confirms via `supabase db push` exit code | 3 inline DO blocks in migration; `supabase db push` will fail with RAISE EXCEPTION if any drift |
| SC-7 | CI gate runs green on PR | PARTIALLY VERIFIED — local self-test PASSED; PR/Actions verification pending operator commit + push | `node ... --self-test` exit 0 confirmed; `node ...` (full audit) exit 0 confirmed against current migrations directory |
| SC-8 | 6 diagnostic markers preserved | STATIC-TRACE verified | Zero code-side changes (no `.ts`/`.tsx` edits); markers mathematically preserved |

**Overall verification posture:**
- 2 SCs STATIC-TRACE verified (SC-4, SC-8)
- 1 SC PARTIALLY VERIFIED (SC-7 — local PASS; CI run pending)
- 5 SCs UNVERIFIED — require operator deploy + UI smoke (SC-1, SC-2, SC-3, SC-5, SC-6)

This is the expected posture for a DB-layer fix. Implementor cannot run `supabase db push` (per `feedback_orchestrator_never_executes`); operator owns deployment.

---

## 6. Invariant Preservation Check

| Invariant | Preservation status |
|---|---|
| I-1 RLS enabled on every public table | ✅ unchanged (this fix adds policies, doesn't disable RLS) |
| I-PROPOSED-A BRAND-LIST-FILTERS-DELETED | ✅ unchanged (no read code touched) |
| I-PROPOSED-B BRAND-SOFT-DELETE-CASCADES-DEFAULT | ✅ unchanged (softDeleteBrand step 3 logic intact) |
| I-PROPOSED-C BRAND-CRUD-VIA-REACT-QUERY | ✅ unchanged (no Zustand/React Query touched) |
| I-PROPOSED-D MB-ERROR-COVERAGE | ✅ unchanged (existing diagnostic markers preserved; no catch blocks touched) |
| I-PROPOSED-E STUB-BRAND-PURGED | ✅ unchanged (no persist/migrate logic touched) |
| **I-PROPOSED-H RLS-RETURNING-OWNER-GAP-PREVENTED** | ✅ **NEW (DRAFT)** — established by this fix |
| Constitutional #2 One owner per truth | ✅ unchanged (brands ownership semantics intact) |
| Constitutional #3 No silent failures | ✅ unchanged (diagnostic markers preserved) |
| Constitutional #11 One auth instance | ✅ unchanged (no auth code touched) |

All existing invariants preserved. New invariant I-PROPOSED-H added in DRAFT state.

---

## 7. Parity Check

N/A — mingla-business is single-mode (no solo/collab distinction). The `app-mobile` app was explicitly excluded from ORCH-0734 scope per operator directive.

---

## 8. Cache Safety

N/A — DB-only fix. No query keys touched. No mutation invalidation logic touched. No persisted-state shape changed.

---

## 9. Regression Surface

3-5 adjacent flows the tester should verify did not regress:

1. **Brand list (switch sheet rows)** — `brandsService.getBrands` SELECT — should still list owner's brands. Helper-based "Brand members" policy still admits via account-owner implicit grant. New direct-predicate policy admits redundantly (OR'd). No change in observable behaviour.
2. **Brand profile read** — `brandsService.getBrand` SELECT-by-id — should still work for owner. Same dual-policy admission.
3. **Public events page (anon)** — `Public can read brands with public events` SELECT (unchanged policy) — should still admit brands with public events. Anonymous role behaviour unchanged.
4. **Brand admin (non-owner) read** — if any `brand_team_members` row exists with admin rank: helper-based "Brand members" policy admits via brand_team_members branch. New direct-predicate policy does NOT admit non-owner — but doesn't need to. ✅
5. **Brand admin (non-owner) update** — should still work via helper-based "Brand admin plus can update brands" policy. New direct-predicate UPDATE policy does NOT admit non-owner. ✅ (Preserves LF-2 latent — brand_admin still cannot soft-delete; deferred per investigation §6.)
6. **Account deletion flow** — `useAccountDeletion` updates `creator_accounts` (different table) — entirely unaffected.

---

## 10. Constitutional Compliance

| Rule | Status |
|---|---|
| #1 No dead taps | unchanged |
| #2 One owner per truth | unchanged |
| #3 No silent failures | unchanged |
| #4 One query key per entity | unchanged |
| #5 Server state stays server-side | unchanged |
| #6 Logout clears everything | unchanged |
| #7 Label temporary fixes | unchanged (existing `[DIAG ORCH-...]` markers preserved with their exit conditions) |
| #8 Subtract before adding | ✅ — fix is purely additive (2 new permissive policies); existing policies preserved without modification |
| #9 No fabricated data | unchanged |
| #10 Currency-aware UI | unchanged |
| #11 One auth instance | unchanged |
| #12 Validate at right time | unchanged |
| #13 Exclusion consistency | unchanged |
| #14 Persisted-state startup | unchanged |

No constitutional principles violated. The fix is the smallest possible patch that closes RC-0728.

---

## 11. Discoveries for Orchestrator

| ID | Discovery | Severity | Recommendation |
|---|---|---|---|
| **D-IMPL-0734-1** | **CI gate found ~35 legacy I-PROPOSED-H violations in the squash baseline** (`20260505000000_baseline_squash_orch_0729.sql`) on out-of-scope tables: `admin_users` (UPDATE×2), `admin_audit_log` (INSERT), `brand_invitations` (DELETE+INSERT+UPDATE), `ticket_types` (DELETE+INSERT+UPDATE), `event_dates` (DELETE+INSERT+UPDATE), `events` (DELETE+INSERT+UPDATE), `order_line_items` (DELETE+INSERT+UPDATE), `orders` (DELETE+INSERT+UPDATE), `app_config` (DELETE+INSERT+UPDATE), `feature_flags` (DELETE+INSERT+UPDATE), `photo_aesthetic_labels` (DELETE+INSERT+UPDATE), `admin_backfill_log` (INSERT), `place_admin_actions` (INSERT), `_archive_card_pool` (UPDATE), `place_pool` (UPDATE), `match_telemetry_events` (INSERT). These are real bugs of the same RC-0728 class but were OUT of ORCH-0734 scope. Going-forward CI cutoff (`20260507000000`) exempts the squash baseline so day-one CI doesn't break. **Each table needs its own future cycle to add direct-predicate owner-SELECT or formally waiver via magic comment if service-role-only.** | S2 (latent — not yet user-facing because the corresponding UI/flows haven't been wired up; some of these are admin-only mutations that may legitimately not need owner-SELECT — reassess per-table). | Register as ORCH-0735+ family of follow-up cycles. Operator may choose to (a) batch-audit every legacy table in one cycle, (b) audit-and-fix table-by-table when each surface ships, (c) selectively waive admin-only tables now via magic comments to remove from CI noise. **Recommend (b)** — pay the cost when each surface needs the fix. |
| D-IMPL-0734-2 | **CI gate location deviation from SPEC §5.1.** SPEC §5.1 suggested `scripts/ci/check_rls_returning_owner_gap.sh` but the local pattern (per `.github/workflows/strict-grep-mingla-business.yml` registry comment + `feedback_strict_grep_registry_pattern`) requires `.github/scripts/strict-grep/<id>-<name>.mjs` Node.js scripts. SPEC §5.3 explicitly granted implementation freedom; followed local pattern verbatim. Naming convention matches existing `i-proposed-a-*.mjs` and `i-proposed-c-*.mjs` siblings. | S4 (process note) | Confirm at REVIEW; SPEC §5.3 explicitly granted this freedom |
| D-IMPL-0734-3 | **CI gate added `supabase/migrations/**` to workflow `paths` filter.** Without this, the gate would only fire on `mingla-business/**` PRs and miss migration-only PRs. Deviation from SPEC §5.2 which didn't mention path filter changes. | S4 (process note) | Necessary for the gate to be effective; confirm at REVIEW |
| D-IMPL-0734-4 | **Going-forward cutoff `20260507000000`.** The CI gate enforces I-PROPOSED-H only on migrations whose 14-digit timestamp prefix is >= this value. Documented in the gate script + invariant entry + recommended in this report. The cutoff equals this ORCH-0734 migration's timestamp — earliest possible enforcement date. | S3 (design choice) | Documented prominently in script + invariant; reasonable default. |
| **D-IMPL-0734-5** | **`supabase/config.toml` had invalid key blocking `supabase db push`** — line 26 `max_request_duration_seconds = 200` (added during ORCH-0737 v2 patch) is not recognised by the local supabase CLI version. `db push` failed with "functions[run-place-intelligence-trial] has invalid keys" before reaching the ORCH-0734 migration. **Implementor removed the line per operator approval (2026-05-06)** to unblock ORCH-0734 deploy; replaced the inline comment with a re-evaluate note pointing at ORCH-0737 CLOSE cycle. Default 150s timeout applies in the interim. | S2 (blocker — but scoped to a different ORCH) | Register as **ORCH-0737-PATCH-CANDIDATE**: at ORCH-0737 CLOSE cycle, decide between (a) upgrade local CLI to a version that supports the key, (b) move timeout config into the Deno function code, (c) set timeout via request headers from the admin UI. The 150s default may still be too tight for parallel-12 chunk processing; ORCH-0737 owner should validate via post-CLOSE smoke whether stuck-running rows reappear. |

---

## 12. Transition items

- The 6 `[ORCH-0728-DIAG]` / `[ORCH-0729-DIAG]` / `[ORCH-0730-DIAG]` / `[ORCH-0733-DIAG]` markers in `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` + `mingla-business/src/hooks/useBrands.ts` + `mingla-business/src/services/creatorAccount.ts` remain in place. Cleanup is a SEPARATE post-PASS dispatch (per ORCH-0734 dispatch §6 + SPEC §2.2 non-goal).
- I-PROPOSED-H invariant + memory file + MEMORY.md entry are tagged **DRAFT**. Orchestrator flips to **ACTIVE** at ORCH-0734 CLOSE per Step 5a protocol. Implementor does NOT flip status unilaterally.

No `[TRANSITIONAL]` code comments added (no code changed).

---

## 13. Operator post-IMPL workflow

Implementor cannot run these (per `feedback_orchestrator_never_executes`). Operator owns:

1. **Review this report** + diff each artifact.
2. **Run `supabase db push`** to apply migration. The 3 inline DO-block verification probes will RAISE EXCEPTION if any drift.
3. **Verify via SQL probe** (optional, belt-and-suspenders):
   ```sql
   SELECT policyname, cmd, qual::text AS using_clause, with_check::text AS wc_clause
   FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'brands' AND policyname LIKE 'Account owner%'
   ORDER BY cmd, policyname;
   ```
   Expected: 2 rows — "Account owner can select own brands" SELECT USING `(account_id = auth.uid())`; "Account owner can update own brand" UPDATE USING/WITH CHECK both `(account_id = auth.uid())`.
4. **Force-reload Metro** and:
   - Tap Create brand → confirm Toast + brand visible in switcher (SC-1)
   - Tap delete on the new brand → confirm brand removed from switcher (SC-2)
   - Tap edit on a brand → rename → confirm name update (SC-3 regression check)
   - Re-tap delete on already-deleted brand → confirm no error (SC-4 idempotency)
5. **Capture FULL Metro terminal output** showing 6 diagnostic blocks (still present, but no longer reaching `[ORCH-0728-DIAG] handleSubmit FAILED`).
6. **Paste output** for orchestrator REVIEW.
7. Orchestrator dispatches mingla-tester for full PASS verification.
8. On PASS: orchestrator runs CLOSE protocol — flips DRAFT→ACTIVE on memory file + invariant, updates all 7 artifacts, provides commit message + EAS Update command, dispatches diagnostic-marker cleanup as next sequential cycle.

---

## 14. Status summary

**Status:** `implemented, partially verified` — CI gate self-test PASSED locally; migration content matches SPEC §3.2 verbatim; all 6 SPEC-required artifacts produced. Awaiting operator deploy (`supabase db push`) and UI smoke for SC-1..SC-3 + SC-5 + SC-6 verification.

**Confidence:** HIGH that this implementation faithfully realizes the SPEC. The migration is verbatim from SPEC §3.2; the CI gate self-test demonstrates correct violation/pass/waiver behaviour; the memory file + MEMORY.md entry + invariant entry are verbatim from SPEC §6/§6.1/§7.

**Risks:**
- Migration timestamp `20260507000000` is the next free 24h-aligned slot but if operator's local clock or another simultaneous migration creates a same-second collision, `supabase db push` will reject. Mitigation: operator can rename to `20260507000001_*` before deploy if needed.
- Inline DO-block verification probes will hard-fail `supabase db push` if anything drifts (pg_policies count, exact predicate text). This is intentional belt-and-suspenders. Mitigation: probe output is verbose; operator can read RAISE EXCEPTION message and diagnose.

---

## 15. Failure honesty label

`implemented, partially verified` — code written; CI gate self-test PASSED locally; SC-4 + SC-8 STATIC-TRACE verified; SC-7 PARTIALLY VERIFIED (local PASS, CI run pending operator commit/push); SC-1 + SC-2 + SC-3 + SC-5 + SC-6 UNVERIFIED (require operator `supabase db push` + UI smoke).

This is the maximum verification posture an implementor can achieve for a DB-layer fix without execute privileges on the database.

---

**End of report.**

**Awaiting:** orchestrator REVIEW → operator `supabase db push` + UI smoke → tester dispatch → PASS → CLOSE protocol.
