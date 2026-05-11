# IMPLEMENTATION ORCH-0795 — Scanner Auto-Provision + UX Honesty

| Field | Value |
|---|---|
| ORCH-ID | ORCH-0795 |
| Spec | `Mingla_Artifacts/specs/SPEC_ORCH-0795_SCANNER_AUTO_PROVISION_AND_UX_HONESTY.md` |
| Investigation | proven inline at intake (SPEC §1); no separate investigation file |
| Status | **implemented and verified** (local gates green; live-fire pending operator `supabase db push` + tester simulator parity) |
| Working tree | `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` |
| Implementer | Claude `mingla-implementor` (parity mirror; operator-delegated execution) |

---

## 1. Layman summary

Brand owners couldn't scan their own events' tickets. Root cause was a gap: nothing ever wrote them into `event_scanners`. This fix adds a database trigger that auto-provisions a scanner row for every brand owner and event manager on every newly-created event, backfills the existing 17 events Seth owns (and any other unprovisioned events from any user), and makes the mobile scanner UI honest about *why* a scan failed instead of always showing generic `"Scan failed"`.

A pre-flight probe found 4 stray soft-deleted scanner rows for Seth — all self-assigned and removed within 1.2 seconds of insertion (broken-flow churn, not deliberate). Per operator decision on the in-line question, these are hard-deleted via a shape-based predicate (self-assigned + removed < 5s after assignment) so future deliberate removals are not affected.

---

## 2. Pre-flight findings (resolved)

**Probe (read-only):** `SELECT … FROM public.event_scanners` against remote `gqnoajqerqhnvulmnyvv`.

Result: 4 rows total, all soft-deleted, all belonging to `b17e3e15-218d-475b-8c80-32d4948d6905` (sethogieva@gmail.com), all self-assigned, removed 0.5–1.2 seconds after insertion. Two events affected: `a3f71d85-…` ("The party block") and `b1ab659e-…` ("A life in vegas").

**Resolution (operator-approved via in-line question):** §1.5 of the new migration hard-deletes this class by shape:
```sql
DELETE FROM public.event_scanners
WHERE removed_at IS NOT NULL
  AND assigned_by = user_id
  AND (removed_at - assigned_at) < interval '5 seconds';
```
This catches the exact pattern (self-assigned + removed in under 5 s — no human could deliberately invite-then-remove via UI that fast). Deliberate manager removals over longer windows are NOT touched.

---

## 3. Files changed (old → new receipts)

### 3.1 NEW: `supabase/migrations/20260526000000_orch_0795_event_scanner_auto_provision.sql`

| Field | Value |
|---|---|
| What it did before | n/a — new file |
| What it does now | Defines `biz_event_auto_provision_scanners()` SECURITY DEFINER trigger fn, attaches `biz_event_auto_provision_scanners_after_insert AFTER INSERT ON public.events FOR EACH ROW`, hard-deletes churn-pattern soft-deletes (§1.5), runs idempotent backfill (§3) inserting one scanner row per (existing event, qualifying user) pair where none active exists, executes 3 verification probes that `RAISE EXCEPTION` on failure (trigger fn registered, trigger attached, zero owner orphans post-backfill). |
| Why | Closes the auto-provision gap that surfaces as `scanner_not_authorized` 403s. Threshold = `biz_role_rank('event_manager') = 40` matches existing "Event manager plus can insert events" RLS policy exactly. |
| Lines | 217 |
| Monotonic prefix | latest deployed prefix is `20260525000003`; new file is `20260526000000` (strictly greater) ✓ |

Key SQL excerpt — candidate selection (used by both trigger and backfill):
```sql
SELECT b.account_id AS user_id WHERE b.account_id IS NOT NULL
UNION
SELECT m.user_id
FROM public.brand_team_members m
WHERE m.brand_id = b.id
  AND m.removed_at IS NULL
  AND m.accepted_at IS NOT NULL
  AND public.biz_role_rank(m.role) >= public.biz_role_rank('event_manager')
```
Roles caught: `account_owner` (60), `brand_admin` (50), `event_manager` (40). Excluded: `finance_manager` (30), `marketing_manager` (20), `scanner` (10).

### 3.2 REWRITE: `mingla-business/src/services/scanTicketService.ts`

| Field | Value |
|---|---|
| What it did before | `if (error) throw new Error(error.message)` — threw away `error.context.body`, so callers only saw the generic supabase-js "Edge Function returned a non-2xx status code" message. |
| What it does now | Parses `error.context` via duck-typed `.text()` → `JSON.parse` (RN polyfill-safe), exposes `ScanTicketError` class with `code: ScanTicketErrorCode`, `status: number \| null`, `detail: string \| null`. Classifier maps `body.detail === "scanner_not_authorized"` → code `scanner_not_authorized`, `body.error === "auth_required" \|\| status === 401` → `auth_required`, etc. |
| Why | Spec §5.1 — UI needs the discriminated error to render the "Not authorized" overlay. |
| Lines | 22 → 132 (full rewrite) |

### 3.3 EDIT: `mingla-business/app/event/[id]/scanner/index.tsx`

| Field | Value |
|---|---|
| What it did before | Catch block on QR scan failure rendered `{ message: "Scan failed", detail: error.message }` overlay for every error. |
| What it does now | When `error instanceof ScanTicketError` with `code === "scanner_not_authorized"`, overlay shows `"You're not authorized to scan this event"` + `"Ask the event owner to add you as a scanner."`. When `code === "auth_required"`, overlay shows `"Please sign in again"` + `"Your session expired."`. Other paths preserved (generic "Scan failed" with detail = error.message). |
| Why | Spec §5.2 — UI honesty layer. |
| Lines | +18, -5 (catch block at L344-L349 region) |

Import updated:
```diff
-import { scanTicket } from "../../../../src/services/scanTicketService";
+import {
+  ScanTicketError,
+  scanTicket,
+} from "../../../../src/services/scanTicketService";
```

### 3.4 NEW: `.github/scripts/strict-grep/orch-0795-event-scanner-auto-provision.mjs`

| Field | Value |
|---|---|
| What it did before | n/a — new file |
| What it does now | Enforces 6 patterns: migration filename exists; trigger function declared; trigger attached on `AFTER INSERT ON public.events`; `biz_role_rank('event_manager')` literal present (threshold pin); `class ScanTicketError` + `type ScanTicketErrorCode` exported from service; `ScanTicketError` + `"scanner_not_authorized"` referenced in scanner UI. |
| Why | Spec §6.3 — protects the new I-PROPOSED-AZ invariant from accidental regression. |
| Lines | 144 |

### 3.5 EDIT: `.github/workflows/strict-grep-mingla-business.yml`

| Field | Value |
|---|---|
| What it did before | 32 gates registered; ORCH-0792-B was the last job. |
| What it does now | Added ORCH-0795 to the registry comment block (line 60) and appended `orch-0795-event-scanner-auto-provision` job at the end. Mirrors the existing one-script-one-job pattern per CLAUDE memory `feedback_strict_grep_registry_pattern.md` — no parallel workflow file created. |
| Why | Spec §9 step 5. |
| Lines | +12 |

### 3.6 NEW: `mingla-business/src/services/__tests__/scanTicketService.test.ts`

| Field | Value |
|---|---|
| What it did before | n/a — new file |
| What it does now | 6 jest tests covering: success path, scanner_not_authorized classification, auth_required classification, scan_failed without detail, unknown on non-JSON body, instanceof guarantees. Mocks `supabase.functions.invoke` and constructs FunctionsHttpError-shaped errors with duck-typed `.text()` to validate the parser. |
| Why | Spec §8 T-09 + SC-9. |
| Lines | 142 |

---

## 4. Local verification results

### 4.1 tsc --noEmit
```
$ cd mingla-business && npx tsc --noEmit
(0 errors)
```

### 4.2 Jest (scanTicketService)
```
PASS src/services/__tests__/scanTicketService.test.ts
  scanTicketService
    ✓ returns ServerScanResult on success (2 ms)
    ✓ throws ScanTicketError with code scanner_not_authorized on 403 with matching detail (1 ms)
    ✓ throws ScanTicketError with code auth_required on 401 (1 ms)
    ✓ throws ScanTicketError with code scan_failed when detail is absent
    ✓ throws ScanTicketError with code unknown when body is non-JSON (1 ms)
    ✓ the thrown error is instanceof ScanTicketError AND instanceof Error

Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
```

### 4.3 Strict-grep gate
```
$ node .github/scripts/strict-grep/orch-0795-event-scanner-auto-provision.mjs
ORCH-0795 strict-grep gate: PASS (6/6 checks)
```

### 4.4 Deno gate
**Not run.** No edge function source was modified (the existing `scan-ticket/index.ts` is untouched). Per spec §1 / CLAUDE memory `feedback_orchestrator_deploys_edge_functions.md`, no edge function deploy is needed. Deno gates are N/A for this dispatch.

### 4.5 Migration dry-run

Not run locally — `supabase db push` is operator-owned per CLAUDE memory. The migration's internal verification probes (§4 of the SQL file) will fail loudly via `RAISE EXCEPTION` if the trigger function isn't registered, the trigger isn't attached, or any owner-orphan events remain post-backfill. Operator will see clear error messages on `supabase db push` if anything is off.

---

## 5. Spec traceability

| Spec criterion | Status | Verified by |
|---|---|---|
| SC-1 zero owner-orphan events post-backfill | **Implemented; verified at apply time** | Probe 3 in migration §4 — `RAISE EXCEPTION` if any orphans remain |
| SC-2 trigger fires on new event INSERT | **Implemented** | Probe 2 (trigger attached). Live-fire by tester. |
| SC-3 owner scan returns success | **Implemented** | Live-fire by tester on iOS Simulator. |
| SC-4 unauthorized user sees new overlay text | **Implemented** | Scanner UI catch block §3.3; strict-grep §3.4 enforces literal. Live-fire by tester. |
| SC-5 soft-deleted rows NOT resurrected by trigger | **Implemented** | Trigger NOT EXISTS guard checks only `removed_at IS NULL` rows. (Note: §1.5 hard-deletes a specific churn-pattern subset before backfill — that is a one-time cleanup, not resurrection. See §2 of this report.) |
| SC-6 migration idempotent | **Implemented** | NOT EXISTS guards in §1 trigger and §3 backfill; §1.5 cleanup is also idempotent (DELETE matches 0 rows on re-run). |
| SC-7 RLS reads continue working | **Implemented; unchanged** | No RLS modifications. Existing "Scanners and managers read event_scanners" policy continues to apply. |
| SC-8 mobile typecheck + tests pass | **Verified** | tsc --noEmit clean; jest 6/6 pass. |
| SC-9 ScanTicketError thrown with correct fields | **Verified** | Jest tests 2, 3, 4, 5 cover all four classification branches plus null-detail edge case. |
| SC-10 strict-grep gate passes on clean checkout | **Verified** | Gate exits 0 with `PASS (6/6 checks)`. |

---

## 6. Invariant verification

| Invariant | Status | Note |
|---|---|---|
| I-PROPOSED-AZ EVENT_HAS_MANAGER_SCANNER | **DRAFT** | Established by this implementation. Flips to ACTIVE on CLOSE per spec §6.1. |
| I-PROPOSED-AX EVENT_HAS_MASTER_DATE | preserved | This change does not touch `event_dates` or the publish RPC. |
| I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY | preserved | Same as AX. |
| I-PROPOSED-AU/AV/AW (Stripe / toast) | preserved | Untouched layers. |
| I-CATEGORY-DERIVED-ON-DROP, I-CATEGORY-SLUG-CANONICAL | preserved | No place_pool changes. |
| event_scanners RLS / unique index | preserved | No schema modifications to event_scanners table. |
| Constitution #2 "one owner per truth" | preserved | event_scanners remains the single authority for scan permission per event. |
| Constitution #3 "no silent failures" | **strengthened** | Scanner UI now surfaces specific 403/401 reasons instead of generic "Scan failed". |
| Constitution #9 "no fabricated data" | preserved | No fake data; just accurate categorisation of the existing error. |

---

## 7. Parity check

- **Solo/collab**: N/A — scanner is operator-side only.
- **iOS/Android**: code is platform-agnostic React Native; both platforms exercise the same catch block.
- **Web**: mingla-business camera path is iOS+Android-first. Web behaviour is unchanged. Tester probe T-14 in spec must surface this to operator rather than silently CONDITIONAL PASS.
- **mingla-business vs app-mobile**: app-mobile has no scanner UI; only mingla-business is affected.
- **admin dashboard**: no admin scanner surface exists; no parity work needed.

---

## 8. Cache safety

No React Query keys changed. No persisted Zustand shape changed. The scanner UI uses local React state for the overlay (`useState<ResultOverlayState | null>`), not server-state — no cache invalidation needed.

---

## 9. Regression surface (adjacent features to verify)

For tester:

1. **Existing scanner invitation flow** — `InviteScannerSheet` → `accept-scanner-invitation` edge fn. Auto-provisioned rows should not collide with subsequent invitations (the `idx_event_scanners_event_user_active` unique index already enforces ≤1 active row per (event, user) — if a manager is auto-provisioned and then invited again, the invitation acceptance would fail; that's pre-existing behavior and not regressing).
2. **Scanner remove flow** — operator can remove themselves or a team member from `event_scanners`. After this fix, an auto-provisioned manager who removes themselves will stay removed (no resurrection on later event re-edit) — the §3.5 spec rule.
3. **Event creation latency** — the trigger adds one INSERT-with-NOT-EXISTS-guard per new event. For brands with N qualifying members, that's N inserts. Default expected N = 1 (owner only); larger brands may see N = 2-5. Negligible.
4. **Scanner UI overlay rendering** — verify the new overlay text doesn't overflow the existing `overlayCard` `numberOfLines={2}` constraint. The new message `"You're not authorized to scan this event"` is 38 chars; existing strings (e.g. "Already checked in") were 17 chars. The card already supports 2 lines; should render fine but tester should confirm visually.
5. **scan_events audit trail** — the existing `scan_events` insert flow is unchanged; verify that scans that previously returned 403 (and inserted no audit row, since the RPC raises before the INSERT) now succeed and ARE audited.

---

## 10. Constitutional compliance

| Principle | Status | Note |
|---|---|---|
| 1 No dead taps | preserved | No new interactive elements. |
| 2 One owner per truth | preserved | event_scanners remains the single source. |
| 3 No silent failures | **strengthened** | 403/scanner_not_authorized now surfaces explicitly. |
| 4 One key per entity | n/a | No React Query keys touched. |
| 5 Server state server-side | preserved | No Zustand changes. |
| 6 Logout clears everything | preserved | No persistence changes. |
| 7 Label temporary | n/a | No transitional code added. |
| 8 Subtract before adding | followed | Replaced the throw-everything-away catch with discriminated error class; old impl removed in same edit. |
| 9 No fabricated data | preserved | All overlay text matches real error categories. |
| 10 Currency-aware | n/a | No currency surface. |
| 11 One auth instance | preserved | Same `supabase.auth.getUser` path in edge fn. |
| 12 Validate at right time | preserved | Validation order unchanged. |
| 13 Exclusion consistency | preserved | Auto-provision threshold matches events RLS gate exactly (event_manager rank). |
| 14 Persisted-state startup | preserved | No persisted-state changes. |

---

## 11. Transition items

None. Implementation is production-grade with no `[TRANSITIONAL]` markers.

---

## 12. DIAG markers

No `[ORCH-0795-DIAG]` markers were added. Implementation reached final state without needing diagnostic instrumentation. CLOSE-time DIAG reap is a no-op.

---

## 13. Discoveries for orchestrator

1. **Audit gap: every existing soft-deleted row in `event_scanners` was bogus churn** (4/4, all Seth self-add-then-instant-remove). Likely caused by the existing `InviteScannerSheet` flow when an operator self-invites — needs follow-up investigation to find the path that adds-and-removes within 1.2 s. Not in scope for ORCH-0795 (the §1.5 cleanup removes the existing damage; the trigger doesn't introduce new churn since it only INSERTs new rows). Consider a new ORCH to find and fix the upstream cause if more churn appears.

2. **scan-ticket UX still doesn't tell the user WHO to ask.** The new "Ask the event owner to add you as a scanner" detail is generic; we don't surface the owner's email or name. Could be a follow-up polish item.

3. **`event_scanners` does NOT auto-clean on `brand_team_members` removal.** If a brand_admin is removed from the brand, their auto-provisioned scanner rows remain active on all events they were provisioned for. They'd be able to scan tickets after losing brand membership. This is pre-existing behavior, not introduced by this fix — but worth a follow-up ORCH for tightening (e.g., a trigger on `brand_team_members.removed_at` UPDATE that cascades to soft-delete matching `event_scanners` rows).

4. **Web scanner parity** is unclear — see §7 + spec T-14. Tester must surface to operator.

---

## 14. Migrations awaiting `supabase db push`

| File | Purpose |
|---|---|
| `supabase/migrations/20260526000000_orch_0795_event_scanner_auto_provision.sql` | Trigger + churn cleanup + backfill + 3 verification probes |

Operator runs `supabase db push --linked` from `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. The migration's internal `RAISE EXCEPTION` probes will fail loudly if state is inconsistent — no silent partial apply.

After successful apply, operator can confirm by running this read-only SQL (will be 0 if fix succeeded):
```sql
SELECT count(*) AS orphans
FROM public.events e
JOIN public.brands b ON b.id = e.brand_id
WHERE e.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND b.account_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.event_scanners es
    WHERE es.event_id = e.id
      AND es.user_id = b.account_id
      AND es.removed_at IS NULL
  );
-- Expected: orphans = 0
```

---

## 15. Edge function deploys

**None.** No `supabase/functions/**` source was modified. No deploy step needed for this dispatch.

---

## 16. Test plan for `mingla-forensics` (TEST mode)

After operator's `supabase db push` succeeds:

1. **DB invariant** — run the orphan count SQL above; assert = 0.
2. **iOS Simulator live-fire** — sign in as Seth, navigate to one of his events (e.g. "The party block" or "A life in vegas" — the two with prior churn), buy a test ticket, scan it. Expect success overlay + "Test Buyer checked in". Verify a `scan_events` row with `result='success'` was written.
3. **Android Emulator live-fire** — same scenario.
4. **Unauthorized user path** — sign in as a different test user with no brand membership, attempt to scan ANY event's QR. Expect new overlay: `"You're not authorized to scan this event"` + `"Ask the event owner to add you as a scanner."`.
5. **Auth-required path** — sign out mid-session, attempt to scan. Expect: `"Please sign in again"` overlay.
6. **Soft-delete respect** — pick one auto-provisioned row, set `removed_at` manually, create a fresh event in the same brand, verify the removed user is NOT re-provisioned for the new event.
7. **Brand_admin auto-provision** — invite a test user as `brand_admin` on Seth's brand, create a new event, verify both Seth AND the test brand_admin get scanner rows.
8. **Web parity** — attempt to use the scanner camera UI in a web browser build of mingla-business; if unsupported (RN camera API doesn't run on web), document as N/A and ask operator to confirm acceptance per CLAUDE memory `feedback_tester_canonical_and_platform_parity.md`.
