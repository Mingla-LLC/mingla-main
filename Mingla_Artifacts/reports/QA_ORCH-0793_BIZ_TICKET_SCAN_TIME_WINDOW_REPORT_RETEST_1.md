# QA RETEST 1 — ORCH-0793 `biz_ticket_scan` Time-Window Enforcement

| Field | Value |
|---|---|
| ORCH-ID | ORCH-0793 |
| Retest cycle | 1 of (max 2 before stuck-flag) |
| Mode | RETEST (originally TARGETED → FAIL → REWORK) |
| Verdict | **PASS** |
| P0 | 0 · P1 | 0 · P2 | 0 · P3 | 0 · P4 | 1 |
| v1 QA (FAIL) | `Mingla_Artifacts/reports/QA_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW_REPORT.md` |
| v2 Implementation | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW_REPORT_v2.md` |
| Working tree | `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` |
| DB migrations on remote | `20260528000000` + `20260528000001` both registered |

---

## 1. Layman summary

The CHECK constraint on `scan_events.scan_result` has been widened to accept the two new discriminator values. Verified live against remote — `pg_get_constraintdef` now returns the 7-value allowlist (5 original + `not_yet_open` + `event_ended`). The v2 migration registered cleanly (migration head shows both `20260528000000` and `20260528000001`). The strict-grep gate carries the new Check 8 that will fail CI for any future contributor who adds a `scan_result` value without widening the constraint — proven by the negative-control re-run during this retest.

The full RPC → audit-write path is now consistent end-to-end. Every previously-failing SC criterion (SC-2, SC-3, SC-6, SC-7) is unblocked. Constitution rules #3, #8, #13 restored.

---

## 2. Previous FAIL findings — resolution status

### P0-1 — CHECK constraint rejecting new discriminators

**Status: RESOLVED**

| Layer | Evidence |
|---|---|
| Schema | `pg_get_constraintdef` on `scan_events_result_check` now returns: `CHECK ((scan_result = ANY (ARRAY['success'::text, 'duplicate'::text, 'not_found'::text, 'wrong_event'::text, 'void'::text, 'not_yet_open'::text, 'event_ended'::text])))`. Both new values present. |
| Migration head | `supabase_migrations.schema_migrations` contains `20260528000001`. The verification probe inside the migration (which RAISE EXCEPTIONs if the constraint lacks `not_yet_open` or `event_ended`) passed during apply. |
| CI gate | Strict-grep Check 8 (NEW in v2) PASSES. Negative-control re-confirmed: renaming the widen migration off-disk and re-running the gate produces `Check 8 FAIL: no migration widens scan_events_result_check CHECK to include 'not_yet_open' and 'event_ended'` exit 1; restoring → PASS. |
| Logic | `'not_yet_open' = ANY (ARRAY[...,'not_yet_open',...])` evaluates TRUE. INSERT into `scan_events` with the new values will now satisfy the predicate. |

---

## 3. SC criteria re-verification

| SC | v1 Verdict | v2 Verdict | Evidence |
|---|---|---|---|
| SC-1 | CODE-CORRECT, LIVE-UNVERIFIED | **CODE-CORRECT, LIVE-UNVERIFIED** | No change. Still no IN_WINDOW fixtures on Seth's account today (all his events are either POST or PRE the window). Live-fire success path needs a future operator smoke against a real in-window event. Not blocking. |
| SC-2 | FAIL | **PASS (logic)** | RPC body emits `'not_yet_open'`; schema now accepts it. Logic verified earlier in v1 QA §1 against Vibes/The ripe events. |
| SC-3 | FAIL | **PASS (logic)** | RPC body emits `'event_ended'`; schema now accepts it. Logic verified against Friday Free Sunset Mixer (POST_WINDOW). |
| SC-4 | LOGIC-CORRECT, NO FIXTURE | **LOGIC-CORRECT, NO FIXTURE** | Still no multi-date events in production. Deferred to future product cycle. |
| SC-5 | PASS | **PASS** | Cancelled "Visa" event (no event_dates) probe still confirms success fallback. |
| SC-6 | FAIL | **PASS (logic)** | Audit row INSERT with `metadata.nextStartAt` / `metadata.lastEndAt` no longer blocked. Migration body confirms `jsonb_build_object(..., 'nextStartAt', v_next_start, 'lastEndAt', v_last_end, ...)`. |
| SC-7 | FAIL | **PASS (logic)** | RPC now successfully returns the new discriminators to the edge function → mobile UI overlay branches (`case "not_yet_open"`, `case "event_ended"`) fire. UI code unchanged from v1; no regression possible. |
| SC-8 | PASS | **PASS** | Pre-0793 branches preserved. |
| SC-9 | PASS | **PASS** | Strict-grep PASS (now 8 checks). |
| SC-10 | PASS | **PASS** | Deno test PASS. |
| T-14/T-15 boundary | PASS | **PASS** | Math unchanged. |

---

## 4. Five-truth-layer cross-check

| Layer | Status |
|---|---|
| **Docs** | SPEC + v2 implementation report consistent. |
| **Schema** | `scan_events_result_check` now widened. `biz_ticket_scan` body unchanged from v1 (correct). |
| **Code (RPC)** | Unchanged — already correct. |
| **Code (edge fn + mobile)** | Unchanged — already correct. |
| **Runtime** | No runtime contradiction post-widening: RPC computes new discriminator → INSERT succeeds → returns full jsonb to edge fn → mobile UI hits new overlay branch. |
| **Data** | Migration head confirms `20260528000001` applied. Constraint def confirms the 7-value allowlist. |

All five layers in agreement.

---

## 5. Independent verification log

```
$ mcp__supabase__execute_sql
> SELECT (SELECT version FROM supabase_migrations.schema_migrations WHERE version = '20260528000001') AS v2_migration_registered,
>        (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
>         WHERE n.nspname = 'public' AND t.relname = 'scan_events' AND c.conname = 'scan_events_result_check') AS check_constraint_def;

[{
  "v2_migration_registered": "20260528000001",
  "check_constraint_def": "CHECK ((scan_result = ANY (ARRAY['success'::text, 'duplicate'::text, 'not_found'::text, 'wrong_event'::text, 'void'::text, 'not_yet_open'::text, 'event_ended'::text])))"
}]

$ node .github/scripts/strict-grep/orch-0793-scan-time-window.mjs
ORCH-0793 strict-grep gate: PASS (all checks)

$ deno test supabase/functions/scan-ticket/ --allow-read
running 2 tests from ./supabase/functions/scan-ticket/index.test.ts
biz_ticket_scan migration enforces event_dates time-window (ORCH-0793) ... ok (3ms)
scan-ticket edge function passes RPC result through transparently (ORCH-0793) ... ok (0ms)
ok | 2 passed | 0 failed (9ms)

$ cd mingla-business && npx tsc --noEmit
EXIT=0
```

---

## 6. P4 finding

### 🔵 P4-1 — IN_WINDOW + multi-date live-fire fixtures still absent

Same as v1. Not blocking. Operator should keep this in mind when next scanning a real ticket on a real currently-active event — that operator smoke is the final corroboration for SC-1.

---

## 7. Constitution compliance (post-rework)

| Rule | Status |
|---|---|
| #3 No silent failures | PASS — the new overlays will actually render. |
| #8 Subtract before adding | PASS — constraint widening landed before the audit-write path needs it (in dependency-of-deployment order). |
| #12 Validate at right time | PASS. |
| #13 Exclusion consistency | PASS — code-side enum and schema-side CHECK now match. |

All other rules: N/A.

---

## 8. Cross-domain impact

| Surface | Status |
|---|---|
| `scan_events` table | NOW ACCEPTS new discriminators ✅ |
| `biz_ticket_scan` RPC | Unchanged from v1 (still correct) ✅ |
| `scan-ticket` edge function | Unchanged ✅ |
| `mingla-business` mobile UI | Unchanged from v1 (still correct) ✅ |
| `app-mobile` / `mingla-admin` | N/A ✅ |

---

## 9. Discoveries for orchestrator

- **CLOSE protocol Extension Step 5e candidate:** Establish I-PROPOSED-BB SCAN_TIME_WINDOW_ENFORCED in `Mingla_Artifacts/INVARIANT_REGISTRY.md` (flip from "proposed" to ACTIVE).
- **Process improvement (already noted in v2):** SPEC/INVESTIGATION pass should grep every CHECK constraint on tables that hold enum-like text columns whenever a new enum value is introduced. Codify in `mingla-forensics` skill on a separate META-ORCH if operator wants.
- **IN_WINDOW live-fire** (P4-1) — operator smoke deferred to next real active event.

---

## 10. Verdict

**PASS** · P0: 0 · P1: 0 · P2: 0 · P3: 0 · P4: 1.

CLOSE may proceed.
