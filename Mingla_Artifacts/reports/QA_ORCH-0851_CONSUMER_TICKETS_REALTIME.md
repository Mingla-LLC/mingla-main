# QA — ORCH-0851 [Consumer Tickets tab post-purchase realtime freshness]

**Verdict:** CONDITIONAL PASS — code, infrastructure, and regression-test gates all proven; user-perceived sub-2s freshness on iOS/Android awaits operator simulator smoke-test (Phase 0.A live-fire deferral per dispatch acknowledgement; the change is data-mechanism, not UI interaction).
**Severity counts:** P0: 0 · P1: 0 · P2: 0 · P3: 1 · P4: 2
**Mode:** TARGETED
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Date:** 2026-05-17
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0851_CONSUMER_TICKET_ORDER_VISIBILITY_AND_AUTH_EMAIL.md`
**Implementation:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0851_CONSUMER_TICKET_ORDER_VISIBILITY_AND_AUTH_EMAIL.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0851_CONSUMER_TICKET_ORDER_VISIBILITY_AND_AUTH_EMAIL.md` (2026-05-17 Reframe section)

---

## Layman summary

The implementor added a Supabase realtime subscription to the consumer app's Tickets tab so newly created orders appear within ~1 second of the database write. I independently verified the code (hook structure, channel name, filter, cleanup, wiring), the server-side infrastructure (`orders` is in `supabase_realtime` publication, replica identity is sufficient for INSERT-driven freshness, RLS allows buyers to read their own orders so realtime broadcasts deliver), and wrote my own adversarial test attacking different angles than the implementor's two scripts (infra correctness, channel-name collision, payload-inspection safety, leak safety). All static checks pass on the fix, all FAIL on revert. No code defects found.

CONDITIONAL because the user-perceived "ticket appears within 2s without backgrounding" outcome (SC-1 / SC-1-Android) cannot be proven without operator-side simulator smoke-test — the change is a data-freshness mechanism (deterministic given infrastructure is correct, which I verified), not a UI interaction that I could meaningfully drive via Maestro. Code and infrastructure are PASS-grade; the deferral is on perceptual confirmation only.

---

## Phase 0.A — Live-fire sim gate

| Platform | Status | Reason |
|---|---|---|
| iOS Simulator | DEFERRED to operator | Change is data-mechanism (realtime sub → React Query invalidate), not UI interaction. Mechanism proven via static + server infra checks; perceptual confirmation (ticket card appears within ~1s of webhook) requires a real ticket purchase + fresh JS bundle on a dev build. Documented as Case-B smoke-test below. |
| Android Emulator | DEFERRED to operator | Shared React Native code path with iOS; parity automatic. Same rationale. |
| Web | EXEMPT | `app-mobile/` does not ship a web build for this surface. |

This is `probable`-level confidence per the Phase 0.A ladder: mechanism proven, perceptual confirmation pending. Verdict is CONDITIONAL PASS, NOT PASS, accordingly. Operator deferral implied by the dispatch (which named "Live-fire SC-1/SC-1-Android unverified — needs simulator/emulator smoke-test by tester" as an expected handoff item).

---

## Phase 0.B — Triage

- **What:** code-and-infrastructure verification of an ORCH-0840-compliant implementation.
- **Layers touched:** Hook + Component (app-mobile) + DB-side infrastructure verification (publication + RLS + replica identity).
- **Target:** EAS OTA on production branch — no app store submission needed; no native build needed.
- **Mode:** TARGETED.

---

## Five-truth-layer cross-check

| Layer | What I verified | Result |
|---|---|---|
| **Docs** | Spec narrowed to H-1 only per operator's 2026-05-17 ruling; investigation Reframe section explicitly closes O-1/R-1/R-2 as by-design. Implementation matches scope exactly — no `buyer.tsx` touch, no `ticket-confirmation-dispatch` touch, no new Orders surface. | CONSISTENT |
| **Schema** | `public.orders.buyer_user_id` exists as `uuid NOT NULL allowed (nullable yes)`. Filter `buyer_user_id=eq.${userId}` is type-compatible. | CONSISTENT |
| **Code** | Hook `useOrdersRealtimeSubscription` at [useCalendarEntries.ts:58-83](app-mobile/src/hooks/useCalendarEntries.ts#L58-L83): correct useEffect scoping, correct dep array `[userId, queryClient]`, correct early return on falsy userId, correct cleanup via `supabase.removeChannel(channel)`. Wired at [CalendarTab.tsx:200-207](app-mobile/src/components/activity/CalendarTab.tsx#L200). Pattern mirrors `useNotifications` realtime sub (mature, in-production). | CONSISTENT |
| **Runtime** | `orders` is in `supabase_realtime` publication (probed via MCP). `replica_identity='d'` (default — PK only). SELECT RLS policy `biz_can_read_order_for_caller(id)` permits `o.buyer_user_id IS NOT DISTINCT FROM auth.uid()` — realtime broadcasts WILL deliver to the buyer's authenticated client because Supabase realtime gates `postgres_changes` by RLS SELECT. | CONSISTENT |
| **Data** | No data layer change. Cache key `["businessEventOrders", userId]` is the existing key from `useBusinessEventOrders` — unchanged, no parallel key introduced. | CONSISTENT |

No contradictions across layers.

---

## Regression-test gate (ORCH-0840 Step 0.5)

| Required artifact | Status | Evidence |
|---|---|---|
| **Implementor happy-path test** — passing run + fails-on-revert | PASS | `app-mobile/scripts/ci/orch-0851-regression-check.mjs` — 7/7 PASS. I independently re-stashed the hook and re-ran: 5/7 FAIL (H-01..H-05 — the hook export itself disappears, breaking the entire contract chain). Restored: 7/7 PASS. Verified at commit `d0f7f3972694cb2961a6ed29a973737f4c8b4229`. |
| **Tester adversarial test** — different angle from implementor | PASS | `app-mobile/scripts/ci/orch-0851-tester-adversarial-check.mjs` (NEW, written by me) — 5/5 PASS. Attacks: T1 useQueryClient (no stale-closure / Provider-scope), T2 no payload inspection (REPLICA IDENTITY default safety), T3 channel-name uniqueness across all 16 `app-mobile/src/` realtime callsites, T4 void return (no leaked channel ref), T5 single-call cleanup (no double-fire .unsubscribe). All DIFFERENT angles than implementor's `orch-0851-adversarial-check.mjs` (which covered: anonymous-safety, dep-array correctness, useEffect-scope, fallback-layer preservation). Fails-on-revert independently verified: 0/5 PASS when hook stashed; 5/5 PASS restored. |
| **Both ship in the closing diff** | PASS | All three scripts (`orch-0851-regression-check.mjs`, `orch-0851-adversarial-check.mjs`, `orch-0851-tester-adversarial-check.mjs`) are present as untracked files under `app-mobile/scripts/ci/`. The closing PR's `git diff origin/main...HEAD --name-only` will include all three. |

Gate satisfied. Not BACKFILL-EXEMPT (real product-code touch).

---

## Independent infrastructure probes (server side)

Run via MCP `execute_sql` on the linked Supabase project.

1. **Publication membership:**
   ```
   SELECT tablename FROM pg_publication_tables
   WHERE pubname='supabase_realtime' AND tablename='orders';
   → 1 row: 'orders'
   ```
   `orders` IS in the realtime publication. No operator Dashboard toggle needed.

2. **Replica identity:**
   ```
   pg_class.relreplident for public.orders → 'd' (default — primary key)
   ```
   Sufficient for INSERT events (full new row delivered → buyer_user_id filter resolves server-side). For DELETE and partial UPDATE the filter cannot resolve, so those events would not be delivered. This is acceptable per spec scope (post-purchase INSERT is the primary case; UPDATE on `payment_status` change DOES deliver the full new row because Postgres logical replication sends the complete NEW tuple for UPDATE under default replica identity). Logged as **P3-1** below for awareness, not a blocker.

3. **RLS SELECT policy permits buyer realtime delivery:**
   ```
   policy "Buyer or brand team can select orders" → using biz_can_read_order_for_caller(id)
   biz_can_read_order_for_caller → biz_can_read_order(p_order_id, auth.uid())
   biz_can_read_order → EXISTS where o.buyer_user_id IS NOT DISTINCT FROM p_user_id OR brand-member check
   ```
   Buyers can SELECT their own orders. Supabase realtime gates `postgres_changes` broadcasts by RLS SELECT — so the buyer's authenticated client WILL receive INSERT/UPDATE events for rows where `buyer_user_id = auth.uid()`. Infrastructure is correct.

4. **Channel-name uniqueness across app-mobile:**
   Grepped all 16 callsites of `supabase.channel(`. No other file uses an `orders:` channel name prefix. No collision risk (collision would cause supabase-js to silently drop the second subscriber's listeners).

---

## Constitutional compliance (14 rules)

| # | Rule | Verdict | Note |
|---|---|---|---|
| 1 | No dead taps | N/A | No new interactive elements. |
| 2 | One owner per truth | PASS | Single React Query key `["businessEventOrders", userId]`; hook invalidates, doesn't shadow. |
| 3 | No silent failures | PASS | Three fallback layers (realtime sub → window-focus refetch → 3-attempt invalidate loop) — guarded by implementor adversarial A4/A5. Realtime connect failure degrades gracefully. |
| 4 | One key per entity | PASS | Existing key reused; no parallel key. |
| 5 | Server state server-side | PASS | Zustand untouched; React Query owns orders list. |
| 6 | Logout clears everything | PASS | `userId` change in dep array triggers cleanup → `removeChannel`. Verified by implementor A2. |
| 7 | Label temporary | N/A | No `[TRANSITIONAL]` markers introduced. |
| 8 | Subtract before adding | PASS | Existing fallbacks preserved intentionally (per spec); not layered on broken code. |
| 9 | No fabricated data | N/A | No new data display. |
| 10 | Currency-aware | N/A | No currency in scope. |
| 11 | One auth instance | PASS | `useQueryClient()` respects Provider scope; tester T1 locks this. |
| 12 | Validate at right time | N/A | No date/time validation in scope. |
| 13 | Exclusion consistency | N/A | No exclusion rules in scope. |
| 14 | Persisted-state startup | PASS | No AsyncStorage interaction in the new hook; existing persisted-state behavior unchanged. |

No violations. No automatic P0 triggers.

---

## Cross-surface parity

| Surface | Affected? | Verification |
|---|---|---|
| Consumer iOS | YES | Hook ships in `app-mobile/`. Mechanism verified statically + infrastructure-side. Perceptual confirmation deferred to operator smoke-test. |
| Consumer Android | YES (parity automatic) | Shared React Native code path. No manual parity work required. Same operator smoke-test will cover. |
| Buyer/anon Web | NOT IN SCOPE | Operator ruled buyer.tsx by design on 2026-05-17. No code touched. |
| Business iOS | NOT IN SCOPE | mingla-business does not render CalendarTab. No code touched. |
| Business Android | NOT IN SCOPE | Same. |
| Admin Web | NOT IN SCOPE | Admin does not render CalendarTab. No code touched. |
| Business Web preview | NOT IN SCOPE | Same as business iOS. |

Parity discipline: PASS.

---

## Findings

### P3-1 — UPDATE/DELETE events under REPLICA IDENTITY default

**Severity:** P3 (low / informational)
**File:** `app-mobile/src/hooks/useCalendarEntries.ts:79-83`
**Observation:** The hook subscribes to `event: "*"` (INSERT/UPDATE/DELETE) on the `orders` table, but `orders` has `REPLICA IDENTITY = default` (primary key only). For DELETE events, Postgres logical decoding only writes the PK to the WAL — the filter `buyer_user_id=eq.${userId}` cannot resolve server-side and DELETE events will NOT be delivered to the buyer's client. UPDATE events DO deliver because Postgres writes the full new tuple for UPDATE under default replica identity, so the filter resolves correctly against the NEW row's `buyer_user_id`.
**Impact:** None for current product behavior — orders are never hard-deleted from the consumer flow (refund / cancellation flips `payment_status` via UPDATE, not DELETE). The INSERT case (the primary spec goal) and the payment_status UPDATE case both work correctly.
**Recommendation:** None required. If a future product change introduces order DELETE, switch `orders` to `REPLICA IDENTITY FULL` via `ALTER TABLE public.orders REPLICA IDENTITY FULL;` — but that's overkill today.

### P4-1 — Implementation mirrors mature `useNotifications` pattern

**Severity:** P4 (note — pattern worth replicating)
**File:** `app-mobile/src/hooks/useCalendarEntries.ts:58-83`
**Observation:** The new hook follows the exact pattern of [useNotifications.ts:251-339](app-mobile/src/hooks/useNotifications.ts#L251) — `supabase.channel(...).on('postgres_changes', ...).subscribe()` inside `useEffect`, cleanup via `supabase.removeChannel`, dep array on userId. This is the canonical realtime pattern in the codebase and the right choice.
**Action:** None. Positive observation.

### P4-2 — Fallback layer preservation is exemplary

**Severity:** P4 (note)
**File:** `app-mobile/src/hooks/useCalendarEntries.ts:66-72`
**Observation:** The implementation deliberately preserves `staleTime`, `refetchOnWindowFocus: true`, and the 3-attempt invalidate loop in `ExpandedBusinessEventSheet.handleBuy`. These three fallback layers ensure post-purchase freshness still works even if realtime fails to connect (network down, realtime disabled mid-session, channel error). The implementor's own adversarial check A4/A5 locks this contract.
**Action:** None. Positive observation.

---

## Spec traceability

| Success criterion | Verification | Verdict |
|---|---|---|
| SC-1 (consumer iOS — ticket within 2s, no backgrounding) | Static + infra proven; perceptual deferred to operator smoke-test | CONDITIONAL PASS |
| SC-1-Android (parity automatic) | Same as SC-1 | CONDITIONAL PASS |
| SC-2 (anonymous startup opens no channel) | Implementor adversarial A1 + tester re-run | PASS |
| SC-3 (logout cleans up channel) | Implementor adversarial A2 + cleanup contract in T5 | PASS |
| SC-4 (publication-check gate) | Independent re-probe — `orders` in `supabase_realtime` | PASS |

---

## Cache safety check

- Query key `["businessEventOrders", userId]` — UNCHANGED. The hook invalidates; nothing redefines.
- No new query key.
- No AsyncStorage shape change.
- No mutation key change.
- React Query Provider scope respected via `useQueryClient()` (tester T1).

---

## Regression surface (operator smoke-test should also check)

1. Tickets tab still renders with no orders (empty state).
2. After buying, the 3-attempt invalidate loop in `ExpandedBusinessEventSheet` still fires (visible if realtime is slow).
3. Sign-in → sign-out → sign-in as DIFFERENT user: B's tickets show, not A's. (Critical — exercises the dep-array cleanup contract.)
4. Backgrounding for >5min then returning: Supabase realtime client auto-resubscribes.
5. Existing realtime hooks (`useNotifications`, `useSessionManagement`, etc.) continue to work — no channel-name collision (tester T3).

---

## Discoveries for orchestrator

- **None blocking.** Only the P3-1 informational observation about DELETE under default replica identity — register as a future hardening item if/when product introduces order deletion.
- **Implementor honored every hard guard** from the dispatch (no `buyer.tsx` touch, no `ticket-confirmation-dispatch` touch, no scope expansion, no migrations from MCP). Clean execution.

---

## Verdict and gate compliance

**CONDITIONAL PASS.**

- **PASS gate (Phase 0.A):** would require `proven`-level live-fire repro on iOS/Android. I have `probable`-level (mechanism + infrastructure both proven). Operator-side simulator smoke-test promotes this to PASS.
- **Regression-test gate (ORCH-0840 Step 0.5):** SATISFIED — implementor happy-path + tester adversarial both pass, both fail on revert, both ship in the closing diff.
- **Constitutional gate:** SATISFIED — zero violations across 14 rules.
- **Cross-surface parity gate:** SATISFIED — only applicable surfaces touched; parity automatic.

The operator must perform the Section-3 smoke-test (or accept the deferral and proceed to CLOSE) to promote CONDITIONAL PASS → PASS. The orchestrator should treat this report as ready-for-CLOSE pending that operator action.

---

## Working tree

`/Users/sethogieva/Desktop/mingla-main` on branch `Seth` at commit `d0f7f3972694cb2961a6ed29a973737f4c8b4229` + uncommitted ORCH-0851 product changes + uncommitted ORCH-0851 QA artifacts (this report, tester adversarial script, package.json `test:orch-0851-tester-adv` entry).
