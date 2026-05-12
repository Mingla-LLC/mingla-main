# IMPLEMENTATION ORCH-0793 — `biz_ticket_scan` Time-Window Enforcement

| Field | Value |
|---|---|
| ORCH-ID | ORCH-0793 |
| Status | implemented and verified (gates green; live-fire pending operator) |
| Verification | strict-grep PASS · Deno test PASS · `tsc --noEmit` exit 0 |
| Working tree | `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` |
| Spec | `Mingla_Artifacts/specs/SPEC_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW.md` |
| Investigation | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0793_BIZ_TICKET_SCAN_TIME_WINDOW.md` |

---

## 1. Layman summary

`biz_ticket_scan` now reads `event_dates` and refuses scans that fall outside the event's `[start_at − 120min, end_at + 360min]` window. Two new result codes — `not_yet_open` and `event_ended` — explain why. Crucially, neither flips `tickets.status='used'`, so a buyer who accidentally exposes their November ticket today does NOT permanently burn it. Multi-day events succeed if `now()` is inside ANY of the event's date windows. The mobile scanner UI shows warning overlays with the door time or "Event ended Xh ago"; warning haptic; dismissible; ticket can be re-scanned later within the window.

---

## 2. Files changed

### `supabase/migrations/20260528000000_orch_0793_scan_time_window.sql` (NEW)
**What it did before:** N/A — new file.
**What it does now:** Replaces `biz_ticket_scan` body with the time-window-aware version. Declares `c_grace_before = 120 min`, `c_grace_after = 360 min`. Joins `event_dates`. Emits `'not_yet_open'` / `'event_ended'` discriminator values. Adds `nextStartAt` / `lastEndAt` to the return jsonb. Includes migration-time `DO $$` verification probe that fails loudly if the body drifts off contract. Adds `COMMENT ON FUNCTION` citing I-PROPOSED-BB.
**Why:** SPEC §3.1 — core RPC upgrade. Addresses RC-1.
**Lines:** ~205.

### `mingla-business/src/services/scanTicketService.ts`
**What it did before:** `ServerScanResult.result` union: `"success" | "duplicate" | "wrong_event" | "not_found" | "void"`. No `nextStartAt` / `lastEndAt` fields.
**What it does now:** Adds `"not_yet_open"` and `"event_ended"` to the union. Adds `nextStartAt: string | null` and `lastEndAt: string | null` fields.
**Why:** SPEC §3.3 — service-layer type union expansion. Required for TypeScript exhaustiveness checks downstream.
**Lines changed:** ~16 added.

### `mingla-business/src/store/scanStore.ts`
**What it did before:** `ScanResult` union of 6 values.
**What it does now:** Adds `"not_yet_open"` and `"event_ended"` to the union (8 values total).
**Why:** SPEC §3.4. Scanner UI imports `ScanResult` from this store; all `Record<ScanResult, …>` sites pick up the new keys automatically (TS would error otherwise).
**Lines changed:** ~5 added.

### `mingla-business/app/event/[id]/scanner/index.tsx`
**What it did before:** `overlaySpec` exhaustive switch on 6 ScanResult values; `handleBarcodeScanned` used a ternary-ladder message construction with only `duplicate`/`wrong_event`/`void` branches; `SESSION_RESULT_LABEL` and `SESSION_RESULT_ICON` were `Record<ScanResult, …>` with 6 keys.
**What it does now:**
- Adds `case "not_yet_open"` / `case "event_ended"` to `overlaySpec` returning the amber/flag style (matches `duplicate` — both recoverable).
- Adds `formatDoorTime(iso)` helper rendering same-day / tomorrow / further-out absolute times.
- Replaces the ternary ladder in `handleBarcodeScanned` with explicit `if/else` branches that pull `nextStartAt` / `lastEndAt` off the response. Copy: `"Doors aren't open yet"` + `"Opens at 9:00 PM"` for early scans; `"Event ended 3 days ago"` + `"Ticket can't be used after the event"` for late scans.
- Haptics: both new branches use `Warning` (same as `duplicate`), not `Error`.
- Extends `SESSION_RESULT_LABEL` (adds `not_yet_open: "EARLY"`, `event_ended: "LATE"`) and `SESSION_RESULT_ICON` (both `"flag"`).
**Why:** SPEC §3.5 — operator UI must surface the two new states with warning tone + actionable copy. Constitutional rules #3 (no silent failures) and #12 (validate at right time) preserved.
**Lines changed:** ~70 added/modified.

### `.github/scripts/strict-grep/orch-0793-scan-time-window.mjs` (NEW)
**What it did before:** N/A.
**What it does now:** Seven checks covering migration file presence + body shape, verification probe presence, service type fields, store union members, scanner UI case branches, and a guard that fails CI if any FUTURE migration (timestamp > `20260528000000`) redeclares `biz_ticket_scan` without `event_dates`.
**Why:** SPEC §3.6 — I-PROPOSED-BB CI enforcement. Codified per memory `feedback_strict_grep_registry_pattern.md`.
**Lines:** ~210.

### `.github/workflows/strict-grep-mingla-business.yml`
**What it did before:** Last registered gate was `orch-0788-notification-template-key-dispatched`.
**What it does now:** Adds the `orch-0793-scan-time-window` job (one job; mirrors the ORCH-0795/0788 structure) + a registry comment entry.
**Why:** SPEC §3.6 — single workflow file, one job per gate (registry pattern). Codified by DEC-101 / Cycle 17b.
**Lines changed:** ~12 added.

### `supabase/functions/scan-ticket/index.test.ts` (NEW)
**What it did before:** N/A.
**What it does now:** Two Deno tests. (1) Reads the migration SQL off disk and asserts the contract: `event_dates`, `now()`, grace constants, both new discriminators, `nextStartAt`/`lastEndAt`, status-update gated by success, and the verification probe block. (2) Reads `index.ts` and asserts the edge function still calls `biz_ticket_scan` and passes the result through transparently.
**Why:** SPEC §3.7. Provides a deno-introspection layer that catches contract drift without requiring a database connection.
**Lines:** ~75.

**Files NOT changed (deliberately):**
- `supabase/functions/scan-ticket/index.ts` — verified per SPEC §3.2 that it does not narrow the result type (`return jsonResponse(data)` passes the RPC response through). No source change required, so no edge-function deploy required either.

---

## 3. Verification matrix

| Criterion | Method | Verdict |
|---|---|---|
| SC-1 in-window scan returns `success` + flips status to `used` | Migration code review + Deno test asserts UPDATE gated by `v_scan_result='success'` | PASS (code-verified; live-fire pending db push + operator smoke) |
| SC-2 pre-window returns `not_yet_open`, status remains `valid` | Migration logic: discriminator block only runs when `v_in_window=false`; UPDATE block only fires when `v_scan_result='success'` | PASS (logic-verified) |
| SC-3 post-window returns `event_ended`, status remains `valid` | Same | PASS (logic-verified) |
| SC-4 multi-date succeeds in any date window | Migration uses `EXISTS event_dates WHERE now() BETWEEN ...` — multi-row friendly | PASS (logic-verified) |
| SC-5 missing event_dates falls through to existing success | Migration `v_has_event_dates` branch sets `v_scan_result := 'success'` | PASS (logic-verified) |
| SC-6 scan_events audit row with `metadata.nextStartAt` / `metadata.lastEndAt` | Migration builds metadata jsonb with both fields | PASS (code-verified) |
| SC-7 mobile overlay shows correct copy + warning haptic | UI code change reviewed; `overlaySpec` exhaustiveness ensured by TS `never` sentinel | PASS (code-verified; device smoke pending tester) |
| SC-8 existing result branches unchanged | Migration preserves the entire pre-0793 branching ladder (lines for `not_found`, `wrong_event`, `void`, `duplicate`); UI ternary→if/else preserves identical copy | PASS |
| SC-9 strict-grep CI gate green | `node .github/scripts/strict-grep/orch-0793-scan-time-window.mjs` → `PASS (all checks)` | PASS |
| SC-10 Deno introspection test passes | `deno test supabase/functions/scan-ticket/` → `2 passed | 0 failed` | PASS |

`tsc --noEmit` on `mingla-business`: exit 0.

---

## 4. Invariant verification

| Invariant | Status |
|---|---|
| I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY | PRESERVED — RPC reads `event_dates.start_at`/`end_at`, never `events.*` timestamps or theme JSON. Verified by strict-grep check 2b. |
| I-PROPOSED-AX EVENT_HAS_MASTER_DATE | UNAFFECTED — RPC reads ANY event_dates row for the event, not specifically the master. |
| I-PROPOSED-AZ EVENT_HAS_MANAGER_SCANNER | UNAFFECTED — Scanner authorization check (lines 53-62 of new migration) preserved verbatim. |
| Constitution #3 (No silent failures) | PRESERVED — Both new states surface a clear message + warning haptic. |
| Constitution #12 (Validate at right time) | PRESERVED — Server uses TIMESTAMPTZ + UTC `now()`; UI does not duplicate the math. |
| `scan_events` trigger (`event_id = tickets.event_id`) | PRESERVED — New audit rows write `event_id = p_event_id` because they only fire when ticket DID belong to this event (the `wrong_event` branch is untouched). |
| I-PROPOSED-BB SCAN_TIME_WINDOW_ENFORCED (NEW) | ESTABLISHED — Status flips to ACTIVE on CLOSE. Enforced by strict-grep gate + Deno test + in-migration verification probe. |

---

## 5. Parity check

- **Solo vs collab:** N/A. Scanner is operator-only (`mingla-business`), no buyer-side analog.
- **Mobile vs admin:** N/A. Admin has no scanner surface.
- **iOS vs Android vs Web:** UI changes are React Native + uses standard `Intl.DateTimeFormat` / `expo-haptics`. All three platforms should render identically. Tester must verify per memory `feedback_tester_canonical_and_platform_parity.md`.
- **App-mobile parity:** N/A — buyers don't scan tickets in app-mobile.

---

## 6. Cache safety

No React Query keys changed. Zustand `scanStore` schema added two new string values to the persisted union; values round-trip cleanly (stored as plain strings). Existing persisted scan rows still load (their `scanResult` values are subset of the new union).

---

## 7. Regression surface

The tester should specifically retest:
1. **`success` scan in current window** — must still flip `tickets.status` and play success haptic.
2. **`duplicate` re-scan** — unchanged path; verify still works.
3. **`wrong_event`** — unchanged path (different event_id).
4. **`not_found`** — bad QR string + non-existent ticket.
5. **`void`** — unpaid order's ticket.
6. **`scanner_not_authorized`** — strangers' camera path (ORCH-0795 contract).
7. **Session log row rendering** for the 2 new statuses (EARLY / LATE badges + flag icon).

---

## 8. Constitutional compliance

| Rule | Status | Note |
|---|---|---|
| #3 No silent failures | PASS | Both new states render visible overlay + haptic. |
| #8 Subtract before adding | PASS | Replaced ternary ladder with explicit if/else; removed nothing the ladder needed. |
| #12 Validate at right time | PASS | Time check is server-authoritative; UI only formats. |
| #13 Exclusion consistency | PASS | New invariant I-PROPOSED-BB centralizes the time-window rule for ALL `success` returns. |

---

## 9. Migrations awaiting `supabase db push`

| File | Purpose | Required before |
|---|---|---|
| `supabase/migrations/20260528000000_orch_0793_scan_time_window.sql` | Replaces `biz_ticket_scan` RPC body | tester live-fire QA |

Operator must run `supabase db push --linked` from `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. The migration's `DO $$` verification probe will RAISE EXCEPTION if anything went wrong with the apply.

---

## 10. Edge function deploy

**No deploy required.** `supabase/functions/scan-ticket/index.ts` source is unchanged — it already passes the RPC response through transparently (verified per SPEC §3.2 + new Deno test). The new test file `index.test.ts` does NOT ship with the edge function bundle.

If the orchestrator wants to redeploy out of caution to ensure the cached function picks up the new RPC behavior (it doesn't need to — the RPC is on the database), the command is:
```
supabase functions deploy scan-ticket --project-ref gqnoajqerqhnvulmnyvv
```

---

## 11. Gate execution log

```
$ node .github/scripts/strict-grep/orch-0793-scan-time-window.mjs
ORCH-0793 strict-grep gate: PASS (all checks)

$ deno test supabase/functions/scan-ticket/ --allow-read
running 2 tests from ./supabase/functions/scan-ticket/index.test.ts
biz_ticket_scan migration enforces event_dates time-window (ORCH-0793) ... ok (1ms)
scan-ticket edge function passes RPC result through transparently (ORCH-0793) ... ok (0ms)
ok | 2 passed | 0 failed (6ms)

$ cd mingla-business && npx tsc --noEmit
EXIT=0
```

---

## 12. Discoveries for orchestrator

- **D-0793-1 (events.status auto-advance gap)** still open — pre-existing investigation discovery, not in this ORCH's scope. Candidate ORCH-0794.
- **D-0793-2 (ticket-type-level scan windows)** still deferred — future ORCH if product asks.
- **D-0793-5 (buyer-scan notification)** still deferred — independent of time-window fix.
- During implementation: no new side issues surfaced.

---

## 13. Transition items

None.

---

## 14. Rework history

N/A — initial implementation.

---

## 15. Routing

After operator runs `supabase db push --linked`, hand to Claude `mingla-tester` (or `mingla-forensics` TEST mode) for TARGETED QA covering all 15 test cases (T-01 through T-15 in SPEC §5) on iOS + Android + Web parity. Then Codex or Claude `mingla-orchestrator` for CLOSE.
