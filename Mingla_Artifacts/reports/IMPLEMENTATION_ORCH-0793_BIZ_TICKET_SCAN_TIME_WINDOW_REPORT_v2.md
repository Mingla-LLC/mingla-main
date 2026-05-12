# IMPLEMENTATION ORCH-0793 (v2 — Rework) — `biz_ticket_scan` Time-Window Enforcement

| Field | Value |
|---|---|
| ORCH-ID | ORCH-0793 |
| Status | implemented and verified (gates green; awaiting `supabase db push` + tester retest) |
| Verification | strict-grep PASS (8/8 incl. negative-control) · Deno PASS · `tsc --noEmit` exit 0 |
| Rework cycle | 1 of (max 2 before stuck-flag) |
| Previous QA verdict | FAIL — `Mingla_Artifacts/reports/QA_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW_REPORT.md` |
| v1 implementation | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW_REPORT.md` |
| Working tree | `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` |

---

## 1. Rework

### What the QA found (FAIL P0-1)

The `scan_events.scan_result` column has a pre-existing CHECK constraint that only accepts the original 5 values: `success | duplicate | not_found | wrong_event | void`. The v1 migration shipped the RPC body emitting `not_yet_open` and `event_ended` but did NOT widen this constraint. Every out-of-window scan would have:
- RPC computes the right discriminator
- UPDATE tickets correctly skipped (no burn — accidental safety from rollback)
- INSERT INTO scan_events rejected by CHECK → SQLSTATE 23514 check_violation
- Whole RPC throws → edge function returns `scan_failed` → mobile UI shows generic red "Scan failed" overlay instead of the friendly "Doors aren't open yet"

### What changed in v2 (bounded scope)

Two new files, zero changes to v1 product code:

1. `supabase/migrations/20260528000001_orch_0793_widen_scan_result_check.sql` (NEW) — drops + re-adds the CHECK with the 7-value allowlist (5 original + 2 new). Includes verification probe that fails the migration apply if the constraint shape drifted.
2. `.github/scripts/strict-grep/orch-0793-scan-time-window.mjs` — extended with Check 8 that fails CI if no migration in the folder carries the widened constraint values. Header docblock updated.

No other files touched. The v1 migration `20260528000000_orch_0793_scan_time_window.sql` is immutable (already applied on remote).

---

## 2. Files changed

### `supabase/migrations/20260528000001_orch_0793_widen_scan_result_check.sql` (NEW)
**What it did before:** N/A — new file.
**What it does now:** `ALTER TABLE public.scan_events DROP CONSTRAINT scan_events_result_check` then re-adds the same constraint name with `CHECK (scan_result = ANY (ARRAY['success','duplicate','not_found','wrong_event','void','not_yet_open','event_ended']))`. Includes `DO $$ ... END$$` verification probe that reads `pg_get_constraintdef` post-alter and RAISE EXCEPTIONs if `not_yet_open` or `event_ended` are missing from the definition.
**Why:** QA P0-1 rework. Restores I-PROPOSED-BB schema-side consistency. Monotonic timestamp `20260528000001` (next available after the v1 `20260528000000`).
**Lines:** ~50.

### `.github/scripts/strict-grep/orch-0793-scan-time-window.mjs`
**What it did before:** 7 checks covering migration body + service/store/UI plumbing + future-migration drift guard.
**What it does now:** Adds Check 8 — iterates `supabase/migrations/`, asserts at least one migration body contains `scan_events_result_check` AND `not_yet_open` AND `event_ended`. Header docblock updated to document the new check + the QA-driven rationale.
**Why:** Future contributors who add a new `scan_result` value will be forced to widen the constraint in the same PR or fail CI. Closes the gap that allowed v1 to ship.
**Lines changed:** ~30 added.

---

## 3. Verification matrix (rework-specific)

| Criterion | Method | Verdict |
|---|---|---|
| Widening migration body matches QA §2 spec | `Read` after `Write` (file content verified) | PASS |
| Constraint will accept `not_yet_open` and `event_ended` post-apply | SQL is `scan_result = ANY (ARRAY[...,'not_yet_open','event_ended'])` — by inspection both new values now satisfy the predicate | PASS |
| Verification probe rejects malformed re-deploy | `DO $$` block grep'd for both `not_yet_open` and `event_ended` raises in pg_get_constraintdef check | PASS |
| Check 8 catches missing widening (negative control) | Renamed file, ran gate → `FAIL: Check 8 FAIL: no migration widens scan_events_result_check...` exit 1; restored file, ran gate → `PASS exit 0` | PASS |
| Strict-grep gate green | `node .github/scripts/strict-grep/orch-0793-scan-time-window.mjs` → PASS (all checks) | PASS |
| Deno introspection test still green | `deno test supabase/functions/scan-ticket/ --allow-read` → 2 passed, 0 failed | PASS |
| TypeScript on mingla-business still green | `cd mingla-business && npx tsc --noEmit` → exit 0 | PASS |
| Original v1 SC criteria (SC-1, SC-2, SC-3, SC-5, SC-6, SC-7, SC-8) will now end-to-end work | Post-`db push` the INSERT path no longer throws → RPC returns correct jsonb → edge function passes through → mobile UI hits the new overlay branches | PASS in logic; awaiting tester live-fire retest |

---

## 4. Invariant verification

| Invariant | Status |
|---|---|
| I-PROPOSED-BB SCAN_TIME_WINDOW_ENFORCED | NOW FULLY ENFORCED — RPC body + audit-write path both consistent. v1 had a schema-side gap; v2 closes it. |
| I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY | UNAFFECTED — no RPC body changes. |
| Constitution #3 No silent failures | NOW PRESERVED — post-rework the new overlays will actually render. |
| Constitution #8 Subtract before adding | NOW PRESERVED — constraint widening precedes (in dependency order) the INSERT path that needs it. |
| Constitution #13 Exclusion consistency | NOW PRESERVED — code-side enum (Mobile + RPC body) matches schema-side enum (CHECK constraint). |

---

## 5. Migrations awaiting `supabase db push`

| File | Purpose | Required before |
|---|---|---|
| `supabase/migrations/20260528000001_orch_0793_widen_scan_result_check.sql` | Widens `scan_events_result_check` to accept the two new discriminators | tester retest live-fire |

Operator command:
```
cd /Users/sethogieva/Desktop/mingla-main
supabase db push --linked
```

The migration's `DO $$` probe will RAISE EXCEPTION at apply time if anything goes wrong.

---

## 6. Edge function deploy

**Still not required.** `supabase/functions/scan-ticket/index.ts` source unchanged from v1; transparent passthrough preserved.

---

## 7. Discoveries for orchestrator

- **Process discovery (codified during this rework):** SPEC/INVESTIGATION pass should grep every CHECK constraint on tables that hold enum-like text columns whenever a new enum value is introduced. Will surface in `mingla-forensics` skill on a separate META-ORCH cycle if operator wants the checklist update codified.
- No new product-side discoveries.

---

## 8. Routing

After operator runs `supabase db push --linked`, dispatch to Claude `mingla-tester` for RETEST sub-mode. Retest targets the SC-2, SC-3, SC-6, SC-7 paths that previously failed plus a fresh live-fire INSERT probe against `scan_events` to confirm the CHECK now accepts both new values. After PASS, hand to orchestrator for CLOSE.
