# IMPLEMENTATION_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING_REPORT

**Status:** implemented, unverified (DB-side migration awaits operator `supabase db push` — only verifiable post-deploy by tester)
**ORCH-ID:** ORCH-0706
**SPEC:** [`specs/SPEC_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING.md`](../specs/SPEC_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING.md)
**Dispatch:** [`prompts/IMPLEMENTOR_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING.md`](../prompts/IMPLEMENTOR_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING.md)
**Investigation:** [`reports/INVESTIGATION_PR_59_CYCLE_B1_BACKEND_REVIEW.md`](INVESTIGATION_PR_59_CYCLE_B1_BACKEND_REVIEW.md)
**Author green-light:** PR #59 issuecomment-4364474041 (Fehintola — general OK, SPEC defaults locked)
**Date:** 2026-05-03

---

## 1 — Layman summary

Single SQL migration adds 5 guard rails to PR #59's foundation tables: 3 immutability triggers (brands.slug + events.slug + events.created_by — all FROZEN at creation per consumer-code invariants), audit-log + scan-events COMMENT ON TABLE honesty fix (Option B documented carve-out per DEC-088), and 2 missing CHECK constraints (refunds.status + door_sales_ledger.payment_method). Pure structural integrity work — no schema reshape, no RLS, no new columns. Single transaction, idempotent on re-apply, ~95 LOC SQL. tsc N/A (SQL-only). Deploy gate: PR #59 must merge + apply BEFORE this migration runs.

---

## 2 — Status label

**`implemented, unverified`**

The migration `.sql` file is written and atomically structured. CANNOT verify success criteria without applying to a real Supabase instance — those checks live in the SPEC §5 SC-1..SC-8 and run via Supabase Management API direct SQL after operator runs `supabase db push`.

What IS verified:
- File written to correct path
- Timestamp `> 20260502100000` (PR #59 baseline)
- Single `BEGIN; ... COMMIT;` transaction
- Idempotency wrappers on ALTER TABLE ADD CONSTRAINT (DO blocks)
- Verbatim SQL match against SPEC §3 for SF-1, SF-2, SF-3, SF-4, SF-5
- GRANT/REVOKE block matches PR #59 pattern
- No other files modified

What needs operator + tester:
- All 8 SCs (SC-1..SC-8) require live DB execution — see §5 below
- Idempotency (re-running migration) requires apply + re-apply + re-verify
- Tester live-fire per SPEC §5 + memory rule `feedback_headless_qa_rpc_gap`

---

## 3 — Old → New receipt

### `supabase/migrations/20260503100000_b1_5_pr_59_hardening.sql` (NEW — 179 lines)

**What it did before:** File did not exist. PR #59 (`20260502100000_b1_business_schema_rls.sql`) creates the 19-table backend with `brands.slug`, `events.slug`, `events.created_by` mutable; `refunds.status` + `door_sales_ledger.payment_method` without CHECK constraints; `audit_log` + `scan_events` COMMENTS that don't disclose the service-role short-circuit.

**What it does now:**

1. **SF-1** — `biz_prevent_brand_slug_change()` trigger function + `trg_brands_immutable_slug` trigger + `COMMENT ON TRIGGER` citing I-17. Throws on UPDATE if `NEW.slug IS DISTINCT FROM OLD.slug`.
2. **SF-2** — `biz_prevent_event_slug_change()` + `trg_events_immutable_slug` + COMMENT. Same shape as SF-1, on events table.
3. **SF-3** — `biz_prevent_event_created_by_change()` + `trg_events_immutable_created_by` + COMMENT citing audit-trail integrity. Throws on UPDATE if `NEW.created_by IS DISTINCT FROM OLD.created_by`.
4. **SF-4** — REWRITES `COMMENT ON TABLE public.audit_log` and `COMMENT ON TABLE public.scan_events` to honestly disclose: *"Service role (auth.uid() IS NULL) may UPDATE/DELETE for reconciliation jobs and migration scripts. Application code MUST NOT mutate; new entries via INSERT only."* PR #59's trigger functions LEFT UNTOUCHED per Option B / DEC-088.
5. **SF-5** — Adds `refunds_status_check` CHECK `(status IN ('pending', 'succeeded', 'failed', 'cancelled'))` and `door_sales_ledger_payment_method_check` CHECK `(payment_method IN ('cash', 'card_reader', 'nfc', 'manual'))`. Both wrapped in `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` blocks for idempotency.
6. **GRANT/REVOKE block** — REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO authenticated + GRANT EXECUTE TO service_role on the 3 new functions. Mirrors PR #59 pattern (lines 2088-2142 of `20260502100000_b1_business_schema_rls.sql`).

Wrapped in single `BEGIN; ... COMMIT;` for atomic apply.

**Why:** SPEC §3 SF-1..SF-5 verbatim. Reviewer's "must address before any production write" + Fehintola's general green-light + DEC-088 Option B ratification.

**Lines changed:** 0 → 179 (NEW; 95 SQL statements + 84 comments/blank lines).

---

## 4 — Pre-flight grep results

Per dispatch §2.3, before locking SPEC §3.SF-5 CHECK values:

### refunds.status consumer enum check

**Command:** `grep "refund.*status\|RefundStatus\|RefundRecord.*status\|refunded_full\|refunded_partial\|status.*refund" mingla-business/src/store/orderStore.ts`

**Result:** Found `OrderStatus = "paid" | "refunded_full" | "refunded_partial" | "cancelled"` (this is ORDER-level status; line 53-54 of orderStore.ts). Client-side `RefundRecord` interface (line 83-93 of orderStore.ts) has fields `id, orderId, amountGbp, reason, refundedAt, lines[]` — **NO status field**. Refunds in client store are recorded as already-completed in stub mode; status is purely a backend concern.

**Conclusion:** Zero consumer enum to broaden. SPEC's proposed `('pending', 'succeeded', 'failed', 'cancelled')` is authoritative — Stripe's standard Refund Object status enum.

### door_sales_ledger.payment_method consumer check

**Command:** `grep "door_sales\|DoorSales\|payment_method.*door\|door.*payment" mingla-business/src/`

**Result:** Zero matches. Door-sales is a §6.2 PRD feature gated entirely on B-cycle (scanner-payments + Stripe Connect + door_sales_ledger writes). No client-side consumer code.

**Conclusion:** Zero consumer enum to broaden. SPEC's proposed `('cash', 'card_reader', 'nfc', 'manual')` is authoritative — strict subset of `orders.payment_method` excluding `'online_card'` since door sales are physical-presence only.

---

## 5 — Spec traceability (SC-1..SC-8)

| SC | Description | Status | Verification step |
|----|-------------|--------|-------------------|
| SC-1 | brands.slug UPDATE rejected | UNVERIFIED | Tester live-fire: `UPDATE public.brands SET slug = 'forbidden-test' WHERE id = (SELECT id FROM public.brands LIMIT 1);` — expect error `brands.slug is immutable (I-17 — ...)`. Static check: trigger function + DROP/CREATE pattern verbatim from SPEC §3.SF-1 ✅ |
| SC-2 | events.slug UPDATE rejected | UNVERIFIED | Tester live-fire same pattern. Static check ✅ |
| SC-3 | events.created_by UPDATE rejected | UNVERIFIED | Tester live-fire. Static check ✅ |
| SC-4a (Option B) | audit_log COMMENT updated | UNVERIFIED | Tester reads `\d+ public.audit_log` and verifies comment includes *"Service role (auth.uid() IS NULL) may UPDATE/DELETE for reconciliation jobs"*. Static check ✅ — comment string verbatim from SPEC §3.SF-4 |
| SC-4b (Option B) | scan_events COMMENT updated | UNVERIFIED | Same as SC-4a for scan_events. Static check ✅ |
| SC-4c (Option B) | Authenticated UPDATE on audit_log still rejected | UNVERIFIED | Tester live-fire from authenticated session. Static check N/A — trigger functions UNCHANGED (Option B preserves PR #59 behavior); pre-existing test |
| SC-4d (Option B) | service_role UPDATE on audit_log succeeds | UNVERIFIED | Tester live-fire from service_role. Static check N/A — trigger short-circuit unchanged (Option B carve-out preserved) |
| SC-5a | INSERT bogus refund status rejected | UNVERIFIED | Tester live-fire: `INSERT INTO public.refunds (order_id, amount_cents, status) VALUES (..., 100, 'bogus_status');` expect `refunds_status_check` violation. Static check ✅ |
| SC-5b | INSERT valid refund status succeeds | UNVERIFIED | Tester live-fire with `'pending'`. Static check N/A (regression check) |
| SC-6a | INSERT bogus door_sales_ledger payment_method rejected | UNVERIFIED | Tester live-fire: `INSERT INTO public.door_sales_ledger (..., payment_method, ...) VALUES (..., 'venmo', ...);` expect `door_sales_ledger_payment_method_check` violation. Static check ✅ |
| SC-6b | INSERT valid payment_method succeeds | UNVERIFIED | Tester with `'cash'`. Static check N/A (regression check) |
| SC-7 | Existing PR #59 RLS regression | UNVERIFIED | Tester runs prior PR #59 functional tests (e.g., authenticated SELECT on brands works). No RLS changes in this migration → expect zero impact. |
| SC-8 | Re-apply migration twice (idempotency) | UNVERIFIED | Tester runs `supabase db push` twice; second run is no-op (no errors, no duplicate triggers). Static check ✅ — all `CREATE OR REPLACE` + `DROP IF EXISTS … CREATE` + DO block exception handlers |

**Static verification PASS:** SQL structure matches SPEC §3 verbatim across all 5 fixes + GRANT/REVOKE block.

**Live-fire verification GATE:** All SCs require `supabase db push` to apply, then Supabase Management API SQL probes per SPEC §5 + memory rule `feedback_supabase_mcp_workaround`.

---

## 6 — Invariant registrations (proposed)

Implementor proposes orchestrator registers these at CLOSE protocol. Numbers verified against `Mingla_Artifacts/INVARIANT_REGISTRY.md` at write time — recommend final IDs but orchestrator confirms next-available.

### I-17 (existing — promote)

**Before:** "Brand slug FROZEN at creation per consumer-side convention (`currentBrandStore.ts:271–283`)."

**After:** "Brand slug FROZEN at creation. **DB-enforced** via `trg_brands_immutable_slug` (PR #59 + ORCH-0706 hardening). Cycle 7 `/b/{brandSlug}` share URLs depend on permanence. Origin: ORCH-0706 (2026-05-03)."

### I-22 (NEW — proposed)

**Statement:** "Event slug FROZEN at creation. DB-enforced via `trg_events_immutable_slug`. Cycle 7 `/e/{brandSlug}/{eventSlug}` public URLs depend on permanence — a renamed slug 404s every shared event link."
**Origin:** ORCH-0706 (2026-05-03)
**Enforcement:** `BEFORE UPDATE` trigger on `public.events`
**Test:** SC-2

### I-23 (NEW — proposed)

**Statement:** "`events.created_by` FROZEN at creation. Even `event_manager+` cannot rewrite who created an event. Protects audit-trail integrity."
**Origin:** ORCH-0706 (2026-05-03)
**Enforcement:** `BEFORE UPDATE` trigger on `public.events`
**Test:** SC-3

### I-24 (NEW — proposed)

**Statement (Option B — DEC-088 ratified):** "`audit_log` and `scan_events` are append-only for non-service-role callers. Service role (auth.uid() IS NULL) MAY mutate for reconciliation jobs and migration scripts. Application code MUST NOT mutate; new entries via INSERT only. Documented disclosure in `COMMENT ON TABLE`."
**Origin:** ORCH-0706 (2026-05-03)
**Enforcement:** `BEFORE UPDATE OR DELETE` triggers on both tables (PR #59-shipped, semantics unchanged) + COMMENT ON TABLE disclosure
**Test:** SC-4a/b/c/d

**Number conflict check:** Cycle 10 used I-25 + I-26. Cycle 11 SPEC proposed I-27 + I-28. Cycle 11 IMPL hasn't shipped yet. **Numbers I-22, I-23, I-24 should be free** — orchestrator confirms at CLOSE. If conflict, bump.

---

## 7 — DEC-088 entry text (for orchestrator at CLOSE)

```
## DEC-088 — Audit-log + scan-events append-only carve-out (Option B)

**Date:** 2026-05-03
**ORCH:** ORCH-0706
**Decision:** audit_log and scan_events tables remain append-only for non-service-role
callers, but service_role retains UPDATE/DELETE permission for reconciliation jobs and
migration scripts. The carve-out is documented verbatim in COMMENT ON TABLE for both
tables.

**Rationale:** Reconciliation jobs are an operational reality (partial scanner sync,
double-charged refund, mis-attributed door sale). Strict-no-mutations-ever creates
real on-call pain the first time bad data lands and we cannot fix it without dropping
and recreating triggers. The cost of Option B is one comment string; the cost of
Option A is a midnight-emergency migration.

**Reversal cost:** Low — flipping to Option A is an 8-line trigger function rewrite.

**Reverses:** None (formalises ambiguous PR #59 state).
**Reversed by:** None.

**PR-author concurrence:** Fehintola general green-light per
https://github.com/Mingla-LLC/mingla-main/pull/59#issuecomment-4364474041 — chose
SPEC defaults; did not flip Q2 to oversight (Option A).
```

**Number conflict check:** Earlier in this session, the priority board mentioned a separate ORCH-0708 also pre-staging a "DEC-088" for cap-raise rationale. **DECISION_LOG.md modified state at orchestrator close should resolve.** If conflict, this becomes DEC-089 — orchestrator's call at registration time.

---

## 8 — Memory rule deference

| Rule | Compliance |
|------|------------|
| `feedback_supabase_mcp_workaround` | **YES** — file-only deliverable. Did NOT use `mcp__supabase__apply_migration`. Operator runs `supabase db push`. |
| `feedback_orchestrator_never_executes` | **YES** — implementor wrote SQL + report. Did NOT spawn forensics/orchestrator subagents. |
| `feedback_diagnose_first_workflow` | **YES** — pre-flight grep run + documented in §4 BEFORE writing SQL. No silent SPEC overrides. |
| `feedback_no_summary_paragraph` | **YES** — chat output is tight summary + report path; this report has structured sections. |
| `feedback_no_coauthored_by` | **YES** — N/A pre-commit; orchestrator confirms at CLOSE. |
| `feedback_headless_qa_rpc_gap` | **HONORED** — flagged tester MUST run live-fire SC-1..SC-8 via Supabase Management API; static check is insufficient for trigger RAISE EXCEPTION verification. |

---

## 9 — Constitutional compliance

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| 1 | No dead taps | N/A | Backend-only; no UI |
| 2 | One owner per truth | **PASS** | Triggers add structural enforcement; no duplication of authority |
| 3 | No silent failures | **PASS** | RAISE EXCEPTION on slug/created_by changes is explicit error surface; no silent rejection |
| 4 | One query key per entity | N/A | No React Query touched |
| 5 | Server state stays server-side | **PASS** | DB-enforced rules now mirror client-side invariant intent |
| 6 | Logout clears | N/A | No client state introduced |
| 7 | Label temporary fixes | **PASS** | No `[TRANSITIONAL]` items in this migration; all changes are permanent |
| 8 | Subtract before adding | **PASS** | DROP TRIGGER IF EXISTS before each CREATE TRIGGER (idempotent re-apply) |
| 9 | No fabricated data | N/A | No data writes |
| 10 | Currency-aware UI | N/A | Backend-only |
| 11 | One auth instance | N/A | No auth changes |
| 12 | Validate at the right time | **PASS** | CHECK constraints validate at INSERT/UPDATE time; immutability triggers fire BEFORE UPDATE |
| 13 | Exclusion consistency | **PASS** | door_sales_ledger.payment_method excludes `'online_card'` consistently with the table's physical-presence semantics |
| 14 | Persisted-state startup | N/A | DB-enforced |

---

## 10 — Regression surface (3-5 features tester should spot-check)

1. **PR #59 functional smoke** — every prior PR #59 SELECT / INSERT / UPDATE that doesn't touch the locked columns should still work. Specifically:
   - `INSERT INTO brands (...)` with new slug — works (only UPDATE is blocked)
   - `UPDATE brands SET name = 'New Name' WHERE id = ...` — works (slug not touched)
   - Same for events table (UPDATE without slug/created_by changes still works)
2. **PR #59 RLS surface** — no policy changes in this migration; all `biz_can_*` helpers unchanged. Spot-check: authenticated user with brand_admin role can still UPDATE non-slug brand fields.
3. **`audit_log` + `scan_events` insert flow** — service-role INSERTs (the dominant write path) unchanged; just the `COMMENT ON TABLE` text changes.
4. **Stripe webhook reconciliation paths** — service-role calls that update audit_log for reconciliation now have explicit documented blessing (Option B). Spot-check: simulate a service-role reconciliation UPDATE on audit_log — should succeed (carve-out preserved).
5. **Refunds INSERT flow** — `INSERT INTO refunds (...) VALUES (..., 'pending')` continues to work; only `'bogus_status'` (or any non-listed value) gets rejected.

**No CASCADE risk:** triggers only block UPDATE; INSERT and DELETE pathways unchanged.

---

## 11 — Discoveries for orchestrator

**None.**

Pre-flight greps clean. Zero consumer enum conflicts. SPEC §3 SQL applied verbatim. No silent overrides. No drift from operator-locked decisions.

**One process observation (not a discovery):** PR #59 schema source pulled at SPEC drafting time used head ref `836ce108…`. If PR #59 has been force-pushed or rebased since, the migration timestamp ordering still holds (`> 20260502100000`) but the line citations in SPEC §3 (e.g., "lines 1305–1318") may shift. Tester should re-pull head ref at apply time if any anomaly surfaces.

---

## 12 — Transition items

**None.** All 5 fixes are permanent structural changes. No `[TRANSITIONAL]` markers in the migration.

---

## 13 — Files touched matrix

| File | Action | LOC delta |
|------|--------|-----------|
| `supabase/migrations/20260503100000_b1_5_pr_59_hardening.sql` | NEW | +179 / 0 |
| **TOTAL** | 1 NEW / 0 MOD | **+179 / 0** |

No other files modified. Implementor did NOT touch:
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (orchestrator-owned; proposed text in §6)
- `Mingla_Artifacts/DECISION_LOG.md` (orchestrator-owned; proposed text in §7)
- Any file under `mingla-business/`, `mingla-admin/`, or `app-mobile/` (this is backend-only)

---

## 14 — Verification commands run

```bash
# Pre-flight grep #1 — refund status consumer enum
grep -rn "refund.*status\|RefundStatus\|RefundRecord.*status\|refunded_full\|refunded_partial\|status.*refund" mingla-business/src/store/orderStore.ts
# → 11 matches, all about ORDER-level OrderStatus enum (paid|refunded_full|refunded_partial|cancelled).
#   Client RefundRecord interface has NO status field. Zero consumer enum to broaden.

# Pre-flight grep #2 — door_sales consumer references
grep -rn "door_sales\|DoorSales\|payment_method.*door\|door.*payment" mingla-business/src/
# → 0 matches. Door sales is §6.2 B-cycle-gated; no client-side code yet.

# File verification
ls supabase/migrations/20260503100000_b1_5_pr_59_hardening.sql
# → exists

wc -l supabase/migrations/20260503100000_b1_5_pr_59_hardening.sql
# → 179 lines (95 SQL + 84 comments/blank)

# Timestamp ordering check
ls supabase/migrations/ | grep "^2026050[23]" | sort
# → 20260502000001_orch_0700_movies_signal_v1_10_0_cinemas_only.sql
#   20260503100000_b1_5_pr_59_hardening.sql
# Migration timestamp > 20260502100000 ✅ (PR #59 baseline)
# (Note: PR #59 file 20260502100000_b1_business_schema_rls.sql lives on the PR branch
#  and lands at merge; our migration's timestamp is correctly LATER for proper ordering.)
```

---

## 15 — Open questions for operator

**None.** SPEC §2 locked decisions held throughout. Pre-flight greps confirmed SPEC defaults are authoritative. Fehintola's general green-light authorized SPEC defaults verbatim.

If post-deploy live-fire reveals any unexpected behavior — e.g., a refund-related script writes a status value broader than `('pending', 'succeeded', 'failed', 'cancelled')` — surface immediately for SPEC re-scope. Until then, no operator action required beyond `supabase db push` after PR #59 itself merges.

---

## Cross-references

- SPEC: [`specs/SPEC_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING.md`](../specs/SPEC_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING.md)
- Reviewer report: [`reports/INVESTIGATION_PR_59_CYCLE_B1_BACKEND_REVIEW.md`](INVESTIGATION_PR_59_CYCLE_B1_BACKEND_REVIEW.md)
- Reviewer paste-ready PR comment: [`reports/PR_59_REVIEW_COMMENTS.md`](PR_59_REVIEW_COMMENTS.md)
- Author green-light: https://github.com/Mingla-LLC/mingla-main/pull/59#issuecomment-4364474041
- Dispatch: [`prompts/IMPLEMENTOR_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING.md`](../prompts/IMPLEMENTOR_ORCH-0706_PR_59_B1_5_BACKEND_HARDENING.md)
- PR #59 head ref (verify if rebased): `836ce108054800aba1573d8bc30684f5728a86ce`
- I-17 origin: `mingla-business/src/store/currentBrandStore.ts:271–283`
- Memory rules referenced: `feedback_supabase_mcp_workaround`, `feedback_orchestrator_never_executes`, `feedback_diagnose_first_workflow`, `feedback_no_summary_paragraph`, `feedback_no_coauthored_by`, `feedback_headless_qa_rpc_gap`
