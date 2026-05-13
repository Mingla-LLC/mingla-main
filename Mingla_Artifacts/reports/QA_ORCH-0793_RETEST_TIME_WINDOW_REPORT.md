# QA REPORT (RETEST 1) — ORCH-0793 `biz_ticket_scan` Time-Window Enforcement

| Field | Value |
|---|---|
| ORCH-ID | ORCH-0793 |
| Mode | RETEST (sub-mode of TARGETED) |
| Verdict | **CONDITIONAL PASS** — every deterministic gate green, schema P0-1 verifiably fixed; live-fire device parity pending operator unblock (see §10) |
| P0 | 0 · P1 | 0 · P2 | 0 · P3 | 0 · P4 | 1 |
| Spec | `Mingla_Artifacts/specs/SPEC_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW.md` |
| v1 implementation | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW_REPORT.md` |
| v1 QA (FAIL) | `Mingla_Artifacts/reports/QA_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW_REPORT.md` |
| v2 implementation | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW_REPORT_v2.md` |
| Investigation | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW.md` |
| Working tree | `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` |
| DB migration `20260528000000` on remote | YES (re-confirmed via `supabase_migrations.schema_migrations`) |
| DB migration `20260528000001` (v2 widen) on remote | YES (`widen_migration_applied=true`) |

---

## 1. Layman summary

The previous P0 is fixed at the schema layer. The widening migration `20260528000001_orch_0793_widen_scan_result_check.sql` is applied; the `scan_events_result_check` constraint now contains all 7 values (`success | duplicate | not_found | wrong_event | void | not_yet_open | event_ended`). I verified the live constraint definition via `pg_get_constraintdef` and proved the predicate accepts both new values via a synthetic VALUES filter — both checks dispositive. The RPC body on the live database still carries every required token (event_dates join, grace constants, both new discriminators, `nextStartAt`/`lastEndAt` jsonb fields). For each of Seth's 9 owned events I replicated the RPC's discriminator logic against `event_dates` and produced the spec-correct expected return value (1 cancelled event with no event_dates → `success` legacy fallback, 1 post-window event → `event_ended`, 7 pre-window events → `not_yet_open`, zero in-window events today). The transport layer (`scan-ticket` edge function source unchanged from v1) and mobile UI (which parses the new discriminator union and renders the new overlays) are deductively chained — every link verified independently.

What I cannot demonstrate from this seat: a real end-to-end scan driven through the operator scanner UI on iOS Simulator + Android Emulator + Expo Web producing a fresh `scan_events` row with `scan_result='not_yet_open'` (or `'event_ended'`) and the matching overlay rendered on screen. No such row exists in production yet — operator hasn't driven a scan since the migration applied. This is the only remaining gap. CONDITIONAL PASS with explicit unblock request below.

---

## 2. Verdict + per-SC table

| SC | Criterion | Verdict | Evidence |
|---|---|---|---|
| SC-1 | In-window scan returns `success` and flips `tickets.status='used'` | **CODE-CORRECT, NO IN-WINDOW FIXTURE** | RPC body verified (UPDATE gated by `v_scan_result='success'`). Zero IN-WINDOW events on Seth's account today (probe §6). Same status as v1 QA — non-regression; operator may live-fire when the next event enters its window. |
| SC-2 | Pre-window returns `not_yet_open`, ticket stays `valid` | **PASS (deductive — every link verified)** | Constraint accepts `not_yet_open` (probe §3). RPC body emits `not_yet_open` for `now() < start_at - 120 min` (probe §4 line 27 of new migration; replicated against 7 pre-window events at probe §6). UPDATE gated only on `success` so ticket stays `valid` (probe §4 + v1 QA SC-2 logic check carried forward). Live-fire smoke deferred to §10 unblock. |
| SC-3 | Post-window returns `event_ended`, ticket stays `valid` | **PASS (deductive)** | Same as SC-2; replicated against "Friday Free Sunset Mixer" (66.5h since end) at probe §6 → expected `event_ended`. |
| SC-4 | Multi-date succeeds in any date window | **LOGIC-CORRECT, NO MULTI-DATE FIXTURE** | RPC uses `EXISTS event_dates ... WHERE event_id = p_event_id AND now() BETWEEN ...` — naturally matches across rows. Zero multi-date events in production (probe §6). Same status as v1 QA. |
| SC-5 | Missing event_dates falls through to `success` | **PASS (live-data probe)** | "Visa" event (cancelled, `has_event_dates=false`) → expected `success (no event_dates fallback)` at probe §6. Identical to v1 QA result. |
| SC-6 | scan_events audit row with `metadata.nextStartAt` / `metadata.lastEndAt` | **PASS (deductive — schema unblocked + RPC body builds metadata)** | RPC body builds `jsonb_build_object('source','scan-ticket','requestedEventId',p_event_id,'buyerName',...,'ticketName',...,'nextStartAt',v_next_start,'lastEndAt',v_last_end)` (probe §4 lines 158-167 of base migration). Now that constraint accepts the row, INSERT proceeds; metadata fields are populated. Live-fire smoke deferred. |
| SC-7 | iOS + Android + Web overlay parity | **DEFERRED — operator unblock required (§10)** | UI code unchanged from v1; verified at v1 QA §4. TS exhaustiveness ensures branch coverage. Cannot drive simulators from this seat. |
| SC-8 | Existing branches unchanged | **PASS** | Migration body preserves all 5 pre-0793 branch results verbatim (probe §4). Strict-grep + Deno introspection confirm no drift. |
| SC-9 | Strict-grep CI gate green | **PASS (8/8 incl. new Check 8)** | `node .github/scripts/strict-grep/orch-0793-scan-time-window.mjs` → `PASS (all checks)`. |
| SC-10 | Deno introspection test passes | **PASS** | `deno test supabase/functions/scan-ticket/ --allow-read` → `2 passed | 0 failed`. |
| Boundary T-14/T-15 | 119min/121min, 359min/361min flip the window | **PASS (carried forward from v1 QA)** | Synthetic-timestamp probe at v1 QA §4 confirmed exact boundary flip; logic unchanged in v2. |

**Verdict legend:**
- **PASS (deductive)**: every link in the causal chain independently verified; the only step not exercised is the physical end-to-end smoke. No reasonable code path can produce a contradicting outcome.
- **DEFERRED**: cannot be tested from this seat; operator unblock required.

---

## 3. P0/P1/P2/P3 findings

**Zero.** The previous P0-1 (`scan_events_result_check` rejecting new enum values) is verifiably fixed:

- Live constraint definition (probe §3): `CHECK ((scan_result = ANY (ARRAY['success'::text, 'duplicate'::text, 'not_found'::text, 'wrong_event'::text, 'void'::text, 'not_yet_open'::text, 'event_ended'::text])))`
- Predicate test against the 7-value array passes for both new values (probe §3).
- v2 widening migration applied (`schema_migrations.version = '20260528000001'`).
- Verification probe inside the migration RAISEd no exception on apply.

## 4. P4 findings

### 🔵 P4-1 — Live-fire device parity smoke not run from this seat

**Note:** Per `feedback_tester_canonical_and_platform_parity.md`, every test dispatch should exercise iOS Simulator + Android Emulator + Web Browser parity for the affected app. For this RETEST I have:

- Code-read every link in the chain (constraint → RPC → edge function → service → store → UI).
- Independently verified the schema fix that v1 QA blocked on.
- Replicated the RPC's discriminator logic against live data and confirmed correct values for every Seth-owned event.

What I have not done: physically driven a scan through the operator scanner UI on each platform and observed the new overlays render. **Recommendation:** operator does the device smoke at first opportunity (instructions in §10). If anything renders unexpectedly, file ORCH-0793-A as a follow-up.

This is intentionally graded P4 (note, not blocker) because every deterministic mechanism along the chain is independently verified; any rendering surprise would be a UI-only issue downstream of working data.

---

## 5. Five-truth-layer cross-check (focused on previously-failing items)

| Layer | v1 QA finding | v2 / RETEST finding |
|---|---|---|
| **Docs** | SPEC §3.1 missed the CHECK-widening step | v2 implementation report §1 documents the gap; the SPEC itself was not edited but the implementation report owns the corrected sequence |
| **Schema** | Constraint had only 5 values; `scan_result='not_yet_open'` raised `check_violation` | Constraint now has 7 values (probe §3); both new values accepted (probe §3 predicate test) |
| **Code (RPC)** | Body shipped correctly; emitted new values that the schema then rejected | Unchanged from v1; still emits new values; now path is unblocked end-to-end |
| **Code (transport)** | `scan-ticket` edge fn passes RPC errors through transparently → `scan_failed` | Unchanged; will now pass through the success body (with `result='not_yet_open'`/`'event_ended'`) instead of an error |
| **Code (mobile UI)** | UI overlay branches correct but never reached because RPC threw | Unchanged; will now hit `case 'not_yet_open'` / `case 'event_ended'` in `overlaySpec` and render amber/flag warning + Warning haptic + dismissible |
| **Runtime** | Could not invoke RPC via MCP (read-only + needs QR pepper) — same constraint applies in retest | Same; supplemented by direct CHECK predicate test which is dispositive for the schema layer |
| **Data** | Pre-window/post-window/legacy events identified; zero in-window | Same distribution today (1 event 66.5h post-end, 7 pre-window, 1 cancelled-no-dates); zero new `scan_events` rows with new discriminators (probe §5) — confirms operator hasn't physically tested yet |

**Layers in agreement:** all six. The schema-vs-code disagreement that v1 QA exposed is resolved. The only gap is runtime end-to-end (operator smoke) — not a layer disagreement, just a missing observation.

---

## 6. Independent verification log

```
$ node .github/scripts/strict-grep/orch-0793-scan-time-window.mjs
ORCH-0793 strict-grep gate: PASS (all checks)

$ deno test supabase/functions/scan-ticket/ --allow-read
running 2 tests from ./supabase/functions/scan-ticket/index.test.ts
biz_ticket_scan migration enforces event_dates time-window (ORCH-0793) ... ok (5ms)
scan-ticket edge function passes RPC result through transparently (ORCH-0793) ... ok (0ms)
ok | 2 passed | 0 failed (13ms)

$ cd mingla-business && npx tsc --noEmit
EXIT=0
```

### Live SQL probes (read-only via Supabase MCP)

**Probe 1 — predicate test against the 7-value array:** new values passed.
```
[{"scan_result":"not_yet_open"},{"scan_result":"event_ended"},{"scan_result":"success"},{"scan_result":"duplicate"}]
```

**Probe 2 — RPC discriminator simulation against Seth's 9 events:** spec-correct values for every event.
| Event | Status | has_event_dates | Expected RPC result | Hours from now |
|---|---|---|---|---|
| Visa | cancelled | false | `success (legacy fallback)` | n/a |
| Friday Free Sunset Mixer QA | scheduled | true | `event_ended` | end −66.5h |
| Vibes and Stuff | scheduled | true | `not_yet_open` | start +3611.5h |
| The ripe | scheduled | true | `not_yet_open` | start +4338.5h |
| The party block | scheduled | true | `not_yet_open` | start +4364.5h |
| Runtime Share Test Free | scheduled | true | `not_yet_open` | start +4364.5h |
| A life in vegas | scheduled | true | `not_yet_open` | start +4365.5h |
| Test event | scheduled | true | `not_yet_open` | start +3595.5h |
| Party Like it's 99 | draft | true | `not_yet_open` | start +1412.5h |

Zero events currently in window — same as v1 QA day.

**Probe 3 — live constraint definition + predicate:**
```
CHECK ((scan_result = ANY (ARRAY['success'::text, 'duplicate'::text, 'not_found'::text,
  'wrong_event'::text, 'void'::text, 'not_yet_open'::text, 'event_ended'::text])))
has_not_yet_open=true, has_event_ended=true, widen_migration_applied=true
```

**Probe 4 — live RPC body (`pg_get_functiondef`):**
```
has_event_dates=true, has_c_grace_before=true, has_c_grace_after=true,
has_not_yet_open=true, has_event_ended=true, has_next_start_at=true, has_last_end_at=true
```

**Probe 5 — existing scan_events with new discriminators:** zero rows. Confirms no live scans have been driven since v2 migration applied. (Not a defect — just the absence of after-the-fact runtime evidence.)

---

## 7. Cross-domain impact verification

- **Mobile (`mingla-business`)**: type union extended, UI overlay branches added; tsc clean. ✅
- **App-mobile (`app-mobile`)**: N/A — buyers don't scan. ✅
- **Admin (`mingla-admin`)**: N/A — no scanner surface. ✅
- **Edge function `scan-ticket`**: source unchanged; transparent passthrough preserved. ✅
- **`scan_events` audit table**: ✅ **now accepts new values** (was the v1 P0-1 blocker)
- **`tickets` table state**: out-of-window scans do NOT mutate `tickets.status` (UPDATE gated by `success` discriminator only). ✅
- **`scan_events` trigger** (`event_id = tickets.event_id`): preserved verbatim by v2 (constraint widening doesn't touch the trigger). ✅
- **Other RPCs / edge functions**: none consume the `scan_result` column or the new discriminator values today. No downstream blast. ✅

---

## 8. Constitutional compliance

| Rule | v1 QA Verdict | RETEST Verdict | Note |
|---|---|---|---|
| #3 No silent failures | FAIL | **PASS** | Out-of-window scans now surface the truthful overlay, not a misleading "Scan failed". |
| #8 Subtract before adding | FAIL | **PASS** | The blocking constraint is widened before the INSERT path executes. |
| #12 Validate at right time | PASS | PASS | Server-authoritative; UI doesn't duplicate. |
| #13 Exclusion consistency | partial | **PASS** | Code-side enum (RPC + service + store + UI) and schema-side enum (CHECK) now agree. |

Other rules (#1, #2, #4, #5, #6, #7, #9, #10, #11, #14): N/A — not touched by this ORCH.

---

## 9. Discoveries for orchestrator

1. **No new product-side findings.** The v2 rework was correctly bounded — only the constraint widening + Check 8. No collateral changes leaked.
2. **Process discovery (carried forward from v1 QA §9.3 and v2 §7):** SPEC/INVESTIGATION should grep every CHECK constraint on tables holding enum-like text columns whenever a new enum value is introduced. The forensics skill should codify this in a META-ORCH cycle if operator wants the checklist update permanent.
3. **No multi-date events in production today** — SC-4 still cannot be live-fired. Re-verify on the next product cycle that exercises multi-date publishing.
4. **No in-window events today** — SC-1 live-fire opportunistic. Operator can synthesize a test event with `event_dates` covering `now()` for a one-time live-fire smoke.
5. **No `scan_events` rows with the new discriminators yet** (probe §5) — operator hasn't physically tested. Once they do, the row(s) will be the definitive end-to-end proof.

---

## 10. Operator unblock — live-fire device smoke

Specific actionable steps to close the only remaining gap (P4-1):

**Per-platform smoke (target ≥1 platform; ideally all three per memory `feedback_tester_canonical_and_platform_parity.md`):**

1. Open the operator scanner for any of Seth's pre-window events (e.g. "The ripe", "Vibes and Stuff", "The party block"). Any unused paid ticket — issue a $0 comp ticket if needed via the operator UI.
2. Scan the comp ticket's QR. **Expected:** amber overlay reading "Doors aren't open yet" + "Opens [Mon Nov X, 9:00 PM]" or similar; flag icon; warning haptic; dismissible.
3. Open the scanner for "Friday Free Sunset Mixer" (post-window). Issue a $0 comp ticket. Scan it. **Expected:** amber overlay "Event ended 3 days ago" + flag icon + warning haptic.
4. After both scans, run this SQL probe to confirm audit rows:
   ```sql
   SELECT scan_result, scanner_user_id, synced_at, metadata->>'nextStartAt' AS next_start, metadata->>'lastEndAt' AS last_end
     FROM public.scan_events
    WHERE scan_result IN ('not_yet_open','event_ended')
    ORDER BY synced_at DESC LIMIT 5;
   ```
   **Expected:** at least one row per scan, `metadata.nextStartAt` populated for `not_yet_open`, `metadata.lastEndAt` populated for `event_ended`. **Critical:** also probe the underlying ticket — `SELECT id, status FROM public.tickets WHERE id = '<comp ticket id>';` — `status` MUST still be `'valid'` (NOT `'used'`).
5. Re-scan one of the comp tickets later when the actual event opens — should hit `success` and burn `status='used'`.

**Platforms:** iOS Simulator (`xcrun simctl boot <UDID>` + Expo dev), Android Emulator (`emulator -avd <name>` + Expo dev), Expo Web (`cd mingla-business && expo start --web`).

If anything renders unexpectedly or the SQL probe shows missing metadata or burned tickets, file ORCH-0793-A with the exact failure shape and re-dispatch implementor + tester.

---

## 11. Final verdict

**CONDITIONAL PASS — recommend close at orchestrator's discretion.**

Reasoning: the previous P0 is unambiguously fixed at the schema layer with live evidence; every deductive link in the chain is verified; zero new findings; the only remaining gap is operator-driven device smoke (P4 note, not blocker). Operator may either (a) accept the deductive proof and close now (same posture as ORCH-0800), or (b) drive the §10 smoke first and re-dispatch RETEST 2 to flip CONDITIONAL → PASS.

If the operator's directive is "close now," the orchestrator should record §10 as the explicit unblock the operator has waived in chat — same recorded-deviation framing as the just-closed ORCH-0800.

---

## Routing

NEXT HANDOFF — paste into Claude `mingla-orchestrator`:

ORCH-0793 RETEST 1 returned **CONDITIONAL PASS** (zero P0/P1/P2/P3, one P4 — live-fire device smoke deferred to operator §10 unblock). Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Inputs for close: investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW.md`, spec `Mingla_Artifacts/specs/SPEC_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW.md`, v2 implementation `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW_REPORT_v2.md`, this RETEST report `Mingla_Artifacts/reports/QA_ORCH-0793_RETEST_TIME_WINDOW_REPORT.md`. Schema P0-1 from v1 QA verifiably fixed (probe §3 + §6). Both migrations on remote (`20260528000000` + `20260528000001`). All mechanical gates green (strict-grep 8/8, Deno 2/2, tsc clean). Hard guards for close: ask operator whether to (a) close now on the deductive proof + recorded operator-waived §10 unblock (same posture as ORCH-0800), or (b) wait for the §10 device smoke and re-RETEST. If operator authorises close, run the full CLOSE protocol — artifact sync (MASTER_BUG_LIST + WORLD_MAP + INVARIANT_REGISTRY DRAFT→ACTIVE for I-PROPOSED-BB + new CLOSE_NOTE_ORCH-0793.md) + commit on `Seth` + push + PR + pre-merge gate (per Working-Branch Discipline §"Pre-merge gate") + merge after operator code-owner approval.
