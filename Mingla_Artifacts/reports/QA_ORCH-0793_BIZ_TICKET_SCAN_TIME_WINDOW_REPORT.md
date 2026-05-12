# QA REPORT — ORCH-0793 `biz_ticket_scan` Time-Window Enforcement

| Field | Value |
|---|---|
| ORCH-ID | ORCH-0793 |
| Mode | TARGETED |
| Verdict | **FAIL** |
| P0 | 1 · P1 | 0 · P2 | 0 · P3 | 0 · P4 | 1 |
| Spec | `Mingla_Artifacts/specs/SPEC_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW.md` |
| Implementation | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW_REPORT.md` |
| Investigation | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW.md` |
| Working tree | `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` |
| DB migration on remote | YES (`supabase_migrations.schema_migrations` confirms `20260528000000`) |

---

## 1. Layman summary

The migration shipped and the function body on the remote DB does carry the time-window logic — `event_dates` join, `now()` comparison, both new discriminator values, return-shape additions, the verification probe. The SQL I extracted from `pg_get_functiondef` matches the source file. The boundary math is exact (119min/121min and 359min/361min flip the window membership as spec'd). For the two PRE_WINDOW events (Vibes and Stuff, The ripe) and the one POST_WINDOW event (Friday Free Sunset Mixer) on Seth's account, replicating the RPC's SELECT against `event_dates` produces `not_yet_open` and `event_ended` respectively, with the right `nextStartAt` / `lastEndAt` values populated.

**But the feature is broken in production by one missing line.** The `scan_events.scan_result` column has a pre-existing CHECK constraint that only accepts `('success', 'duplicate', 'not_found', 'wrong_event', 'void')`. The new RPC tries to INSERT rows with `scan_result = 'not_yet_open'` or `'event_ended'` — both will fail the CHECK, the transaction rolls back, the RPC throws, and the mobile UI shows a generic red "Scan failed" overlay instead of the friendly "Doors aren't open yet" overlay the SPEC promised. The buyer-burn protection is technically preserved (rollback means `tickets.status` doesn't flip), but the entire user-facing experience the feature shipped to deliver is non-functional.

Fix is one ALTER TABLE statement. Low risk, monotonic follow-up migration.

---

## 2. P0 finding

### 🔴 P0-1 — `scan_events.scan_result` CHECK constraint rejects `not_yet_open` and `event_ended`

| Field | Value |
|---|---|
| File + line | `supabase/migrations/20260528000000_orch_0793_scan_time_window.sql:155-170` (INSERT block) vs. existing constraint `scan_events_result_check` (baseline) |
| Constraint as deployed | `CHECK ((scan_result = ANY (ARRAY['success'::text, 'duplicate'::text, 'not_found'::text, 'wrong_event'::text, 'void'::text])))` — retrieved live from `pg_constraint` |
| Causal chain | (1) Buyer presents future-dated ticket today → (2) operator scans → (3) RPC computes `v_scan_result := 'not_yet_open'` per new logic → (4) UPDATE tickets is correctly skipped (good, no burn) → (5) RPC reaches `INSERT INTO public.scan_events (..., scan_result, ...) VALUES (..., v_scan_result, ...)` → (6) **CHECK constraint fires `check_violation` SQLSTATE 23514** → (7) entire RPC transaction rolls back → (8) edge function `scan-ticket` receives the rpc error → (9) returns `{error: 'scan_failed', detail: '...violates check constraint...'}` with HTTP 400 → (10) `scanTicketService.classify` maps to `code: 'scan_failed'` → (11) mobile UI catch branch shows generic "Scan failed" overlay with `kind: 'not_found'` (red close icon, Error haptic). **The new overlays the SPEC promised (`Doors aren't open yet`, `Event ended Xh ago`) never render.** |
| What it should do | The migration must widen the CHECK constraint to include `'not_yet_open'` and `'event_ended'`. |
| Verification step | (a) `SELECT pg_get_constraintdef(...)` on `scan_events_result_check` confirms only 5 values allowed (output captured above). (b) The migration's INSERT block at lines 155-170 explicitly inserts `v_scan_result` directly, which the new code paths set to the rejected values. (c) MCP execute_sql is read-only so I could not run a live INSERT to physically reproduce the check_violation, but the constraint definition is dispositive — PostgreSQL CHECK rejects rows where the expression is FALSE, and `'not_yet_open' = ANY (ARRAY['success','duplicate','not_found','wrong_event','void'])` is FALSE by inspection. |
| Side effect | Ticket is not burned (transaction rollback is accidental protection here, not by design). But: spec criteria SC-2, SC-3, SC-6, SC-7 are all unmet end-to-end. Constitution #3 violated (the user gets a misleading "Scan failed" instead of the truthful "Doors aren't open yet"). Constitution #8 violated (the new branch was layered without subtracting the blocking constraint first). |

### Required fix

A new monotonic-timestamp migration that widens the CHECK constraint. Drop + re-add in one migration, no data backfill required (only future inserts use the new values).

```sql
-- supabase/migrations/20260528000001_orch_0793_widen_scan_result_check.sql
-- ORCH-0793 follow-up: widen scan_events.scan_result CHECK to include the
-- new time-window discriminators emitted by biz_ticket_scan.
ALTER TABLE public.scan_events DROP CONSTRAINT scan_events_result_check;
ALTER TABLE public.scan_events
  ADD CONSTRAINT scan_events_result_check
  CHECK (scan_result = ANY (ARRAY[
    'success'::text,
    'duplicate'::text,
    'not_found'::text,
    'wrong_event'::text,
    'void'::text,
    'not_yet_open'::text,
    'event_ended'::text
  ]));

-- Verification probe — fail at migration time if constraint shape drifted.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'scan_events' AND c.conname = 'scan_events_result_check';
  IF v_def NOT LIKE '%not_yet_open%' OR v_def NOT LIKE '%event_ended%' THEN
    RAISE EXCEPTION 'ORCH-0793 widen probe failed: constraint missing new values: %', v_def;
  END IF;
END$$;
```

Also: extend the strict-grep gate to include a check that some migration carries the new constraint values. Add a Check 8 to `.github/scripts/strict-grep/orch-0793-scan-time-window.mjs`:

```js
// Check 8 — CHECK constraint widened somewhere in the migrations folder
let constraintWidened = false;
for (const fname of readdirSync(MIGRATIONS_DIR)) {
  const body = readOrEmpty(join(MIGRATIONS_DIR, fname));
  if (/scan_events_result_check/.test(body) && /not_yet_open/.test(body) && /event_ended/.test(body)) {
    constraintWidened = true;
    break;
  }
}
if (!constraintWidened) {
  failures.push(
    "Check 8 FAIL: no migration widens scan_events_result_check CHECK to include 'not_yet_open' and 'event_ended'",
  );
}
```

---

## 3. P4 finding

### 🔵 P4-1 — No multi-date events exist in production for SC-4 live-fire

| Field | Value |
|---|---|
| Note | Spec SC-4 (multi-date scan succeeds in ANY date window). Query against `event_dates` shows zero events with > 1 row. Logic is verifiable from the SQL (the RPC's `EXISTS event_dates ... WHERE event_id = p_event_id AND now() BETWEEN ...` naturally matches across all date rows for the event), but no production fixture exists today. |
| Recommendation | None blocking. Tester should re-verify on a manually-created multi-date event during the next product cycle that exercises multi-date publishing. |

---

## 4. Spec traceability

| SC | Criterion | Verdict | Evidence |
|---|---|---|---|
| SC-1 | In-window scan returns `success` and flips `tickets.status='used'` | **CODE-CORRECT, LIVE-UNVERIFIED** | RPC body confirmed via `pg_get_functiondef` includes the gated UPDATE. No IN_WINDOW event fixtures available today (Seth's only currently-or-recently-active event is Friday Free Sunset Mixer which is POST_WINDOW). |
| SC-2 | Pre-window returns `not_yet_open`, status remains `valid` | **FAIL** | Logic produces `'not_yet_open'`, but the INSERT into scan_events is rejected by CHECK constraint → entire RPC rolls back → user sees `scan_failed`. See P0-1. |
| SC-3 | Post-window returns `event_ended`, status remains `valid` | **FAIL** | Same root cause as SC-2. |
| SC-4 | Multi-date: succeeds in any date window | **LOGIC-CORRECT, NO FIXTURE** | EXISTS-based query in RPC naturally matches across rows. No production fixture. See P4-1. |
| SC-5 | Missing event_dates falls through to success | **PASS** | Live probe against cancelled "Visa" event (id `ecb4839f-...`) confirmed `has_event_dates=false` → expected_rpc_result `success (no event_dates fallback)`. |
| SC-6 | scan_events audit row with `metadata.nextStartAt`/`metadata.lastEndAt` | **FAIL (by SC-2/SC-3 blocker)** | The INSERT that would carry the metadata is the one rejected by the CHECK. Both audit and metadata are lost. |
| SC-7 | Mobile overlay shows correct copy + warning haptic | **FAIL (by SC-2/SC-3 blocker)** | UI code is correct (verified by reading `scanner/index.tsx`), but the RPC never returns `not_yet_open`/`event_ended` to the UI — only the `scan_failed` error path fires. |
| SC-8 | Existing branches unchanged | **PASS** | Migration preserves all 5 pre-0793 branch results verbatim (`not_found`, `wrong_event`, `void`, `duplicate`, `success`). |
| SC-9 | Strict-grep CI gate green | **PASS** | Re-run independently: `ORCH-0793 strict-grep gate: PASS (all checks)`. |
| SC-10 | Deno introspection test passes | **PASS** | Re-run: `2 passed | 0 failed`. |
| Boundary T-14/T-15 | 119min/121min, 359min/361min | **PASS** | Synthetic-timestamp probe confirms exact boundary flip. |

---

## 5. Five-truth-layer cross-check

| Layer | Finding |
|---|---|
| **Docs** | SPEC describes the new discriminators clearly. SPEC §3.1 includes the migration body and INSERT block but does NOT mention extending the existing `scan_events_result_check`. **Spec gap.** |
| **Schema** | CHECK constraint `scan_events_result_check` on `scan_events.scan_result` only allows the original 5 values. Verified via `pg_get_constraintdef` against remote. Trigger `trg_scan_events_ticket_event` enforces `event_id = tickets.event_id` (orthogonal — does not block new result values). |
| **Code (RPC)** | `pg_get_functiondef` confirms deployed body matches the source file: `event_dates`, `now()`, both new discriminators, `nextStartAt`/`lastEndAt`, gated UPDATE, comment block. |
| **Code (edge fn + mobile)** | Edge function passes RPC errors through transparently as `{error:'scan_failed', detail}`. Service `classify` maps to `code:'scan_failed'`. Mobile UI catch-branch shows generic "Scan failed" overlay (red close icon, error haptic) for that code — NOT the new overlays. |
| **Runtime** | Cannot invoke `biz_ticket_scan` via MCP execute_sql (read-only + needs the QR pepper). But the SQL the RPC executes is fully reproducible via execute_sql and produces the correct discriminator values for each test event. The INSERT step is what fails. |
| **Data** | Verified against production: 1 POST_WINDOW event (Friday Free Sunset Mixer, 66h since end), 7 PRE_WINDOW events, 1 cancelled event with no event_dates. Zero IN_WINDOW events today. Zero multi-date events today. |

Layers in disagreement: spec promises new discriminator emissions; schema rejects them. Schema wins until widened.

---

## 6. Independent verification log

```
$ node .github/scripts/strict-grep/orch-0793-scan-time-window.mjs
ORCH-0793 strict-grep gate: PASS (all checks)

$ deno test supabase/functions/scan-ticket/ --allow-read
running 2 tests from ./supabase/functions/scan-ticket/index.test.ts
biz_ticket_scan migration enforces event_dates time-window (ORCH-0793) ... ok (2ms)
scan-ticket edge function passes RPC result through transparently (ORCH-0793) ... ok (0ms)
ok | 2 passed | 0 failed (10ms)

$ cd mingla-business && npx tsc --noEmit
EXIT=0

[live-fire SQL probe results captured inline above]
```

---

## 7. Constitution compliance

| Rule | Verdict | Note |
|---|---|---|
| #3 No silent failures | **FAIL** | The CHECK violation surfaces as a misleading "Scan failed" / "Ticket not found" overlay instead of the truthful "Doors aren't open yet". The error is technically loud (it's surfaced) but its content is wrong. |
| #8 Subtract before adding | **FAIL** | New `'not_yet_open'` / `'event_ended'` INSERT path layered on top of an unchanged CHECK that blocks it. The constraint should have been widened before the INSERT was authored. |
| #12 Validate at right time | PASS | Server uses TIMESTAMPTZ + UTC `now()`; UI does not duplicate. |
| #13 Exclusion consistency | PASS in code, FAIL in schema | I-PROPOSED-BB invariant text is correct, but the schema constraint contradicts it for the audit-write path. The fix migration restores consistency. |

Other rules (#1, #2, #4, #5, #6, #7, #9, #10, #11, #14): N/A — not touched by this ORCH.

---

## 8. Cross-domain impact verification

- **Mobile (`mingla-business`)**: type union extended, UI overlay branches added, `tsc --noEmit` passes. ✅
- **App-mobile (`app-mobile`)**: N/A — buyers don't scan. ✅
- **Admin (`mingla-admin`)**: N/A — no scanner surface. ✅
- **Edge function `scan-ticket`**: source unchanged; transparent passthrough verified. ✅
- **Edge function `notify-dispatch` / others**: N/A — scan-ticket doesn't fan out notifications. ✅
- **`scan_events` audit table**: ❌ **breaks** — see P0-1.
- **`tickets` table state**: ticket stays `valid` on the rejected INSERT path due to transaction rollback. Accidental safety; not a regression but not by design either.

---

## 9. Discoveries for orchestrator

1. **CHECK constraint pre-existed unchanged from baseline.** The constraint is not unique to ORCH-0793 — it's been in `scan_events_result_check` since the baseline squash. The implementor's "no edge function deploy required" claim was correct, but the deeper claim "implementation is verified" missed this constraint. **No new ORCH-IDs needed; rework on ORCH-0793.**
2. **No multi-date events in production** — SC-4 cannot be live-fire tested today. Surface during product's next multi-date cycle.
3. **Spec §3.1 missed the CHECK widening.** The SPEC that I (forensics) wrote did not enumerate the downstream `scan_events_result_check` widening step. Add a SPEC §3.1 footnote on next pass to require schema-CHECK reconciliation any time a new `scan_result` value is introduced. Codify as a forensic-checklist step: "for every new enum value the RPC emits, grep all CHECK constraints downstream."
4. **Strict-grep gate weakness.** Existing 7 checks did not catch this. Adding the proposed Check 8 above closes the hole — every future contributor adding a `scan_result` value will be forced to widen the constraint at the same time or fail CI.

---

## 10. Rework instructions

Hand back to implementor with this scope:

1. Create monotonic-timestamp migration `supabase/migrations/20260528000001_orch_0793_widen_scan_result_check.sql` (or similar — must be `> 20260528000000`). Use the SQL block in §2 above verbatim including the verification probe.
2. Operator runs `supabase db push --linked` to apply the new migration.
3. Add Check 8 to `.github/scripts/strict-grep/orch-0793-scan-time-window.mjs` per §2 above.
4. Update strict-grep self-test (re-run `node .github/scripts/strict-grep/orch-0793-scan-time-window.mjs` → expect PASS).
5. No mobile UI / service / store changes required.
6. Update implementation report with old→new receipts for the two new files.
7. Re-dispatch to tester for RETEST sub-mode.

**Out of scope for rework:** changing the existing migration `20260528000000_orch_0793_scan_time_window.sql` — it's already applied; immutable now.

---

## 11. Verdict

**FAIL** · P0 × 1 · P4 × 1.

Re-dispatch to implementor with the bounded rework above. Single-file fix (plus the strict-grep extension). Should take one cycle.
