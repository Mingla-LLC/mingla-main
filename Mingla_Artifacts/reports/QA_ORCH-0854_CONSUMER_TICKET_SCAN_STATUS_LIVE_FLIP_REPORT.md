# QA — ORCH-0854 [Consumer ticket status live-flip valid→used on scan]

**Mode:** TARGETED
**Verdict:** **PASS** — promoted from CONDITIONAL PASS 2026-05-17 after operator-run live-fire smoke-test post-merge + EAS OTA confirmed `Valid → Used` badge flip ≤2s on iOS + Android consumer apps (SC-1-iOS, SC-1-Android, SC-2 all PASS).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Date:** 2026-05-17
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0854_CONSUMER_TICKET_SCAN_STATUS_LIVE_FLIP.md`
**Implementation:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0854_CONSUMER_TICKET_SCAN_STATUS_LIVE_FLIP.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0854_CONSUMER_TICKET_SCAN_STATUS_NOT_LIVE.md`

---

## Verdict

**CONDITIONAL PASS** — P0:0 | P1:0 | P2:0 | P3:0 | P4:3 (praise).

**Conditions for full PASS:** runtime live-fire on iOS Simulator + Android Emulator on a Mingla consumer dev build with a signed-in test buyer holding a `valid` ticket, scanner-side invocation of `biz_ticket_scan` against that ticket, and observed `Valid → Used` badge flip within ≤2s. Per Phase 0.A live-fire sim gate this is a UI/runtime change and PASS requires `proven`-level sim repro. Today the dev build is not installed on the booted iOS sim (UDID `17091E60-C3B6-4167-980D-60C348E177F6`, iOS 26.4) and the operator has not pre-staged a signed-in buyer auth state nor a known-good test ticket. **Confidence level: `probable`** — code is structurally correct, all five truth layers cross-checked, RLS verified, publication state verified, but runtime end-to-end has not been observed by the tester. Sim attempt was made; specific blockers named below.

Per the Phase 0.A confidence ladder and the verdict gate, **PASS requires the live-fire — CONDITIONAL PASS is the ceiling at this point.** Seth-run live-fire (steps in §Smoke-test) will flip the verdict to PASS without re-dispatch if the badge flips as predicted. If the badge does NOT flip, this becomes FAIL with implementor REWORK.

---

## Phase 0.A live-fire sim gate — execution log

| Leg | Surface ships there? | Performed? | Outcome |
|-----|----------------------|------------|---------|
| iOS Simulator | YES (consumer iOS) | ATTEMPTED — sim booted (iPhone 17 Pro iOS 26.4, UDID `17091E60-...`), but Mingla consumer dev build NOT installed (`xcrun simctl listapps booted` shows no Mingla bundle). | BLOCKED — needs dev build install + signed-in buyer auth + test ticket. |
| Android Emulator | YES (consumer Android) | ATTEMPTED — `emulator-5554` connected, no app installed. | BLOCKED — same reason. |
| Web Preview | NO (no authed consumer Tickets surface on web) | EXEMPT (skip leg) | N/A |

Blocker named to Seth in the chat handoff. Per Phase 0.A this satisfies the `probable` confidence-level requirement (sim attempt made + blocker named) and authorizes CONDITIONAL PASS. It does NOT authorize PASS — that requires the live-fire to actually run.

---

## Phase 0 ingestion

- Spec read in full; 8 success criteria extracted (SC-1-iOS, SC-1-Android, SC-2..SC-8).
- Implementation report read in full; 6 discoveries surfaced.
- Investigation report read in full; R-1 + R-2 root causes verified.
- Migration `supabase/migrations/20260606000200_orch_0854_tickets_realtime_publication.sql` read.
- Hook diff `app-mobile/src/hooks/useCalendarEntries.ts` read (lines 113-153 of new hook).
- CalendarTab wiring diff read (lines 50-56 import widen + lines 210-217 hook call).
- `supabase/functions/scan-ticket/index.ts` read in full — server path correct, unchanged.
- `supabase/migrations/20260528000000_orch_0793_scan_time_window.sql` lines 60-148 read — `biz_ticket_scan` writes ONLY to `public.tickets` + `public.scan_events`; never touches `orders`. Confirms investigation R-1.
- All three implementor CI scripts (happy + adversarial + strict-grep gate) re-run by tester from a fresh shell.

---

## Independent five-layer cross-check

| Layer | Tester verification | Result |
|-------|---------------------|--------|
| Docs | Spec / investigation / implementation cross-reference each other accurately. ORCH-0816 [Brand KPI tile freshness + Realtime] precedent correctly cited as the orders-side analog. ORCH-0851 [Consumer Tickets tab post-purchase realtime freshness] fallback chain accurately preserved. | PASS |
| Schema | Live MCP probe `SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename IN ('orders','tickets','scan_events')` returns `[orders, tickets]`. `tickets` IS in publication. `scan_events` is NOT (out of scope; surfaced as Discovery). RLS policy `Buyer or brand team can select tickets` confirmed via `pg_policies` — predicate `EXISTS (SELECT 1 FROM orders o WHERE o.id = tickets.order_id AND NOT (o.buyer_user_id IS DISTINCT FROM auth.uid()))` gates SELECT (and therefore Realtime delivery) to the buyer's own rows. NULL-safe equality (`IS DISTINCT FROM` negation) handles anonymous orders correctly. | PASS |
| Code (client) | `useTicketsRealtimeSubscription` correctly: (a) early-returns on falsy userId, (b) opens channel `tickets:buyer=${userId}` distinct from `orders:` prefix, (c) subscribes to `event: 'UPDATE'` on `public.tickets` with NO server filter (correct — RLS gates delivery; no filter means no false-negative-from-nonexistent-column trap), (d) invalidates BOTH `["businessEventOrders", userId]` AND `["consumerCalendar", userId]`, (e) cleans up via `removeChannel`, (f) dep array `[userId, queryClient]`. Mirror of `useOrdersRealtimeSubscription` shape. | PASS |
| Code (server) | `scan-ticket/index.ts` invokes `supabase.rpc('biz_ticket_scan', ...)` — unchanged from prior state. `biz_ticket_scan` (latest definition `orch_0793_scan_time_window.sql` lines 140-144) does `UPDATE public.tickets SET status='used', used_at=now(), used_by_scanner_id=...` synchronously inside the same transaction that returns scan_result. Confirmed: zero `UPDATE orders` or `.from('orders').update(...)` in scan path. Tester TA4a + TA4b enforce going forward. | PASS |
| Runtime | NOT VERIFIED — requires Seth live-fire (see Verdict gate). Predicted: scan-event commit → Postgres logical replication emits row to `supabase_realtime` slot for `public.tickets` (publication confirmed) → Supabase Realtime evaluates RLS per-subscriber → buyer-A's app receives event for buyer-A's tickets only → `useTicketsRealtimeSubscription` handler invalidates `["businessEventOrders", userId]` → React Query refetches the orders+tickets join → `CalendarTab` re-renders with `status='used'` → `BusinessEventCalendarRow.ticketCountValid` decrements; `TicketPdfSheet` badge flips Valid→Used. Round-trip latency comparable to ORCH-0851 (sub-second). | UNVERIFIED (probable per code) |
| Data | Live publication state confirms migration is no-op-state-wise (table already added in parallel — Discovery #2 in implementation report). Migration file still required for fresh-environment provisioning + ledger consistency; `ALTER PUBLICATION ... ADD TABLE` is idempotent per PostgreSQL docs (returns NOTICE when table already a member). | PASS |

No layer disagreements found.

---

## Spec criterion verification matrix

| SC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| SC-1-iOS | Badge flips Valid→Used ≤2s on iOS sim | UNVERIFIED (probable) | Code structurally correct; runtime not observed. Pending Seth live-fire. |
| SC-1-Android | Same on Android emu | UNVERIFIED (probable) | Single RN codebase; identical behaviour predicted. Pending Seth live-fire. |
| SC-2 | Multi-ticket count decrements | UNVERIFIED (probable) | `ticketCountValid` already reads the invalidated cache; no new code on this path. Pending live-fire. |
| SC-3 | Migration on disk + publication probe returns one row | PASS | File present at `supabase/migrations/20260606000200_orch_0854_tickets_realtime_publication.sql`. Live probe confirms `tickets` in publication. Operator still owes `supabase db push --linked` for ledger consistency. |
| SC-4 | Anonymous-safety (`if (!userId) return;`) | PASS | Implementor A1 + tester direct read of hook body. |
| SC-5 | Cleanup + dep array | PASS | Implementor A2 + happy-path H-06 + tester direct read. |
| SC-6 | Fallback layers preserved | PASS | Implementor A4/A5/A6 + tester verified `useBusinessEventOrders` `staleTime: 60_000` + `refetchOnWindowFocus: true` unchanged; ExpandedBusinessEventSheet 3-attempt loop unchanged. |
| SC-7 | ORCH-0840 two-test pair + fails-on-revert | PASS | Implementor happy-path 9/9 + implementor adversarial 7/7; fails-on-revert verified by implementor at `d8b2aa96b1c4f1b1536d68b15c63d66a85ea72e0` (true line deletion → FAIL H-04 → exit 1; restore → exit 0). Tester adversarial 7/7 (`orch-0854-tester-adversarial-check.mjs`, attacks NEW angles per ORCH-0840 Step 0.5 different-angle rule — see §Tester adversarial regression). |
| SC-8 | Strict-grep gate live | PASS | Gate exit 0 with 14 informational WARN lines (legacy unpublished subscriptions — Discovery #1 in implementation report) and 0 violations. Workflow plug-in present in `.github/workflows/strict-grep-mingla-business.yml`. |

---

## Constitutional sweep

| # | Rule | Status | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | N/A | No new interactive elements |
| 2 | One owner per truth | PASS | React Query is sole cache authority |
| 3 | No silent failures | PASS | Publication migration + client subscription ship paired; new strict-grep gate enforces I-PROPOSED-BV |
| 4 | One key per entity | PASS | Reuses existing `["businessEventOrders", userId]` + `["consumerCalendar", userId]`; tester TA1a + TA1b lock cache-key consistency between subscriber and producers |
| 5 | Server state server-side | PASS | RQ only; no Zustand |
| 6 | Logout clears everything | PASS | useEffect cleanup tears down channel on userId change to undefined |
| 7 | Label temporary | N/A | No transitional code |
| 8 | Subtract before adding | PASS | Additive only |
| 9 | No fabricated data | PASS | |
| 10–14 | Currency / auth / time / exclusion / persisted-state | N/A | |

Zero violations.

---

## Tester adversarial regression (ORCH-0840 Step 0.5)

**File:** `app-mobile/scripts/ci/orch-0854-tester-adversarial-check.mjs`
**Run output:** `7/7 PASS` (exit 0)
**Angles attacked (DIFFERENT from implementor's adversarial):**

- **TA1a / TA1b — Cache-key consistency.** Producer hooks (`useBusinessEventOrders`, `useConsumerCalendar`) must literally declare the same keys the subscription invalidates. A future rename of either producer key without updating `useTicketsRealtimeSubscription` would silently break the live-flip without any TypeScript error. Constitution #4 enforcement at QA gate.
- **TA2 — Migration filename monotonicity.** Asserts `20260606000200 > 20260606000100` (the prior ORCH-0852 migration prefix). Backdated migrations create `supabase_migrations.schema_migrations` ledger drift.
- **TA3 — No `buyer_user_id` filter trap.** `public.tickets` has NO `buyer_user_id` column. A contributor copying the orders subscription pattern verbatim would add `filter: \`buyer_user_id=eq.${userId}\``, and postgres_changes would silently match zero rows. Asserts no such filter ever appears in the tickets subscription body. RLS is the right gate.
- **TA4a / TA4b — Server-side scan path untouched.** SPEC §Non-goals forbids any change to `supabase/functions/scan-ticket/index.ts` or adding an `UPDATE orders` hack. Asserts the edge function still routes through `biz_ticket_scan` and contains zero orders-table writes. Prevents future "modeling theatre" fixes.
- **TA5a — ALTER (not CREATE / DROP) PUBLICATION semantics.** Asserts the migration uses `ALTER PUBLICATION supabase_realtime ADD TABLE`. CREATE PUBLICATION on a fresh environment would lose all the dashboard-added legacy tables (orders, notifications, messages, etc.) — every other realtime consumer would silently break. DROP + CREATE is worse.

**Append-only enforcement:** new file under `app-mobile/scripts/ci/`; no existing test modified. CI gate `tests-append-only.yml` is satisfied.

Implementor's happy-path test (`orch-0854-regression-check.mjs`, 9/9, fails-on-revert anchor H-04) and adversarial test (`orch-0854-adversarial-check.mjs`, 7/7, lifecycle + fallback + channel-name collision) confirmed via fresh tester run. Both ship in the closing PR alongside this tester adversarial.

---

## P4 — praise / patterns worth replicating

- **P4-1: Comment block in `useTicketsRealtimeSubscription` explicitly explains WHY no server-side filter** (`Note: postgres_changes has no server-side filter — RLS gates delivery.`). This is the right defensive-comment pattern — a future contributor reading this is told the load-bearing rationale before they "tighten" the filter and silently break the subscription. Pattern worth replicating on every Supabase Realtime hook.
- **P4-2: Verbatim mirror of `useOrdersRealtimeSubscription` shape.** Lifecycle (early-return, dep array, removeChannel) is identical to the established orders pattern. Easy for a future maintainer to grep + update both hooks consistently when the underlying Supabase Realtime API changes.
- **P4-3: Strict-grep gate uses warn-list (`LEGACY_KNOWN_UNPUBLISHED_SUBSCRIPTIONS`) rather than silent allowlist.** The gate's `[WARN]` lines for the 14 legacy unpublished subscriptions keep Discovery #1 visible in every CI run instead of burying it. This is the right balance of "don't block the PR" with "don't hide the bug class." Pattern worth replicating in other multi-instance bug-class gates.

---

## Discoveries for orchestrator

1. **14 legacy unpublished client subscriptions** — confirmed by tester independently via the strict-grep gate. Tables: `boards`, `board_collaborators`, `board_experiences`, `board_message_reads`, `board_session_preferences`, `friend_requests`, `pending_invites`, `message_reads`, `session_decks`, `stripe_external_accounts`, `stripe_connect_accounts`. Each is either silently dead realtime code or needs a publication-add migration. RECOMMEND register as ORCH-0855 (S2, quality-gap, audit + decide per-table) post-CLOSE.
2. **`public.tickets` was already in the live publication** when tester ran the probe today. Either operator applied the migration in parallel, or a prior session/dashboard add landed between INVESTIGATE and IMPLEMENT. On-disk migration still required for fresh-environment provisioning + ledger consistency (ALTER PUBLICATION is idempotent). Surfaced in implementation report Discovery #2; tester confirms.
3. **`scan_events` not in publication.** If a future surface wants to show live scan history to organisers (e.g., mingla-business "scanned at the door" feed), the same trap applies. Flag-and-track.
4. **No push-notification-on-scan** for the buyer. Discovery #4 in implementation report — confirmed by tester (no notification fan-out in `scan-ticket/index.ts`). Strong UX win, separate ORCH if product wants it.
5. **Regression-script anti-pattern lesson (codified by ORCH-0854):** comment-revert of a regression-anchor line does NOT trigger fails-on-revert because regex matches commented text. True line-deletion is required for the proof. Should be added to ORCH-0840 enforcement guidance: implementor's fails-on-revert proof MUST use line-deletion, not comment-out. Worth a process note.
6. **No edge function deploy required** — no edge functions touched. No native rebuild required — JS-only change. EAS OTA after CLOSE per `feedback_eas_update_no_web.md` (two separate iOS + Android commands).

---

## Pre-existing state observed (not blockers, surfaced for awareness)

- The branch is carrying unstaged changes to other ORCHs (`mingla-business/app/checkout/[eventId]/confirm.tsx`, `payment.tsx`, `o/[orderId].tsx`, `TicketQrCarousel.tsx`, `ticketCheckoutService.ts`, `supabase/config.toml`, `deno.lock`) — these appear to be in-progress ORCH-0852 [Buyer web confirmation broken] work and are OUTSIDE ORCH-0854 scope. The closing PR for ORCH-0854 should stage ONLY the 8 ORCH-0854 files per `feedback_one_pr_per_close.md`. Tester did NOT touch these other files.
- `git log` shows branch HEAD is currently `2fb80fb9` (merge of origin/main), not `d8b2aa96` (the commit cited by the implementor for fails-on-revert proof). The fails-on-revert at `d8b2aa96` is still valid as a historical proof — tester independently re-ran fails-on-revert against current branch state and reproduced the result (true line-deletion of the `businessEventOrders` invalidate triggers exit 1; restore returns exit 0).

---

## Blocking issues

**None.** No P0, no P1, no P2, no P3.

CONDITIONAL PASS is gated on Seth-run live-fire, not on any code defect. The code as-shipped is, on the available evidence, correct.

---

## Conditions for full PASS (Seth-run)

Per Phase 0.A verdict gate, ONE of the following two operator actions flips this verdict from CONDITIONAL PASS to PASS:

(A) **Seth runs the live-fire on iOS sim + Android emu** per the smoke-test steps in the chat handoff. If badges flip `Valid → Used` within ≤2s of the scanner commit on both platforms (and the cross-buyer privacy test in step 6 shows no event leakage), verdict flips to PASS without re-dispatch.

(B) **Seth explicitly accepts the deferred live-fire as out-of-scope** and authorizes orchestrator CLOSE on the current CONDITIONAL PASS basis. Operator memory `feedback_tester_canonical_and_platform_parity.md` reminds tester that operator acceptance alone is NOT enough for CONDITIONAL PASS on UI/runtime findings — sim attempt + named blocker (both present here) ARE enough.

If live-fire reveals a defect: verdict flips to FAIL with REWORK dispatched to implementor.
