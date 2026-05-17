# SPEC — ORCH-0854 [Consumer ticket status live-flip valid→used on scan]

**Mode:** SPEC (single-pass; investigation already complete).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Date:** 2026-05-17
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0854_CONSUMER_TICKET_SCAN_STATUS_NOT_LIVE.md`

---

## Layman summary

Add a Supabase realtime subscription to `public.tickets` so the consumer Mingla app's Tickets/Calendar tab flips a ticket badge from "Valid" to "Used" within ~1 second of the door scanner marking it used, instead of waiting up to 60 seconds for the cache to expire. Requires two coupled changes shipped together: (1) a one-line migration adding `tickets` to the `supabase_realtime` publication (without this, the client subscription silently no-ops — same trap ORCH-0816 [Brand KPI tile freshness + Realtime] caught for `orders`), and (2) a new `useTicketsRealtimeSubscription` hook wired into `CalendarTab.tsx`. Pattern is verbatim mirror of the post-ORCH-0851 [Consumer Tickets tab post-purchase realtime freshness] orders subscription, one table over. No server-side change to `scan-ticket` or `biz_ticket_scan` — they're already correct.

---

## Scope

1. New migration `supabase/migrations/20260606000200_orch_0854_tickets_realtime_publication.sql` — adds `public.tickets` to the `supabase_realtime` publication.
2. New hook `useTicketsRealtimeSubscription(userId: string | undefined): void` in `app-mobile/src/hooks/useCalendarEntries.ts` — mirrors `useOrdersRealtimeSubscription` (lines 86–112 of same file). On every postgres_changes `UPDATE` event on `public.tickets`, invalidates BOTH `["businessEventOrders", userId]` AND `["consumerCalendar", userId]`.
3. Wire the new hook into `app-mobile/src/components/activity/CalendarTab.tsx` next to the existing `useOrdersRealtimeSubscription(user?.id)` call.
4. New CI gate scripts per ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5:
   - `app-mobile/scripts/ci/orch-0854-regression-check.mjs` (implementor happy-path, fails-on-revert anchored to the invalidate call).
   - `app-mobile/scripts/ci/orch-0854-adversarial-check.mjs` (tester adversarial, attacks different angles).
5. Add the two `test:orch-0854` / `test:orch-0854-adv` scripts to `app-mobile/package.json`.
6. New strict-grep CI gate `.github/scripts/strict-grep/orch-0854-tickets-realtime-publication-paired.mjs` enforcing the new invariant I-PROPOSED-BV (see §Invariants), plugged into the existing `.github/workflows/strict-grep-mingla-business.yml` per `feedback_strict_grep_registry_pattern.md`.

## Non-goals

- **No server-side change.** `supabase/functions/scan-ticket/index.ts` and `biz_ticket_scan` (latest definition in `supabase/migrations/20260528000000_orch_0793_scan_time_window.sql`) are correct as-is. Do NOT add an `UPDATE orders` side-effect to the scan path — that would be modeling theatre, not a fix.
- **No push-notification-on-scan.** Architecturally separate concern, registered as a discovery in the investigation; out of scope.
- **No optimistic single-ticket UI updates.** Cache shape (H-1 in investigation) does not support per-ticket sharding; full-entry invalidation is the right tool today.
- **No audit of other unpublished tables.** Discovery item 1 in the investigation (project-wide publication-coverage audit) is a separate ORCH if operator chooses to register.
- **No change to existing fallback layers.** `refetchOnWindowFocus: true`, `staleTime: 60_000`, and the 3-attempt invalidate loop in `ExpandedBusinessEventSheet.handleBuy` stay UNTOUCHED. They remain as belt-and-suspenders if realtime fails to connect.
- **No `useConsumerCalendar` hook addition.** H-2 defense is handled by also invalidating `["consumerCalendar", userId]` from the new hook; we do NOT create a parallel `useTicketsRealtimeSubscriptionForCalendar` hook.

## Assumptions

- RLS policy `"Buyer or brand team can select tickets"` on `public.tickets` already allows the buyer to SELECT their own tickets (verified by live probe during investigation). Realtime delivery is gated by the same RLS, so a per-user filter is NOT required at the publication layer.
- Supabase Realtime postgres_changes filters do not support joins; the new hook subscribes without a server-side filter and relies on RLS to gate delivery client-side. A spurious invalidation of the cache from a non-owned ticket UPDATE is impossible because RLS prevents delivery in the first place.
- The migration filename uses timestamp `20260606000200` (next free slot after `20260606000100_orch_0852`).

---

## Phase 2.5 — Cross-Surface Impact

| # | Surface | Covered? | Behaviour spec demands | Files touched | Parity |
|---|---------|----------|------------------------|---------------|--------|
| 1 | Consumer iOS | YES | Ticket badge flips `Valid → Used` within ≤1s of scanner-side commit. `BusinessEventCalendarRow.ticketCountValid` and `TicketPdfSheet` per-ticket badge both reflect the new state without app re-focus or manual refresh. | `app-mobile/src/hooks/useCalendarEntries.ts`, `app-mobile/src/components/activity/CalendarTab.tsx`, `supabase/migrations/20260606000200_orch_0854_*.sql` | Automatic (shared RN code) |
| 2 | Consumer Android | YES | Identical to iOS. | Same as above. | Automatic (shared RN code) |
| 3 | Buyer/anonymous Web | NO | No authenticated Tickets/Calendar surface exists on `mingla-business/` for anonymous buyers; nothing to flip. | None | N/A |
| 4 | Business iOS | NO | Scanner UI already gets the scan result synchronously from the RPC return value (per O-2 in investigation). No consumer-style cache there. | None | N/A |
| 5 | Business Android | NO | Same as Business iOS. | None | N/A |
| 6 | Admin Web (adjacent) | NO | Admin uses its own queries; no consumer Tickets realtime path. | None | N/A |
| 7 | Business Web preview (adjacent) | NO | Not a consumer surface. | None | N/A |

Parity is automatic across iOS and Android because the entire fix lives in `app-mobile/` shared code. Per-surface success criteria are split (SC-1-iOS / SC-1-Android) only to give the tester explicit per-platform live-fire gates per the parity-enforcement rule.

---

## Layer specs

### Database layer

**File:** `supabase/migrations/20260606000200_orch_0854_tickets_realtime_publication.sql` (NEW)

**Exact contents:**
```sql
-- ORCH-0854 — add `public.tickets` to the supabase_realtime publication so the
-- consumer Mingla app can subscribe to postgres_changes on their tickets
-- and flip the ticket badge from "Valid" to "Used" within ~1s of the door
-- scanner marking it used. Mirror of ORCH-0816 [Brand KPI tile freshness +
-- Realtime] publication-add for `public.orders`.
--
-- Security note: RLS policy "Buyer or brand team can select tickets"
-- (defined in baseline squash, see supabase/migrations/20260505000000_baseline_squash_orch_0729.sql)
-- gates SELECT to (a) the buyer via the orders.buyer_user_id = auth.uid()
-- subquery and (b) brand team members via biz_is_brand_member_for_read.
-- The publication change does NOT broaden read access — Supabase Realtime
-- enforces the same RLS on event delivery as it does on direct SELECT.
-- A buyer subscribing without a server-side filter will receive UPDATE
-- events only for tickets whose order they own.
--
-- Invariant: I-PROPOSED-BV REALTIME_TABLE_IN_PUBLICATION_OR_NO_SUBSCRIPTION
-- (any client-side postgres_changes subscription to a table MUST have a
-- matching publication-add migration; enforced by strict-grep CI gate
-- orch-0854-tickets-realtime-publication-paired.mjs).
ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
```

**No schema changes, no constraints, no RLS changes.** RLS on `public.tickets` is unchanged and already correct (live-probed during investigation).

**Operator pre-flight verification (post-apply):**
```sql
SELECT tablename FROM pg_publication_tables
 WHERE pubname = 'supabase_realtime' AND tablename = 'tickets';
-- Expected: [{"tablename":"tickets"}]
```

### Hook layer

**File:** `app-mobile/src/hooks/useCalendarEntries.ts` (MODIFY)

**Exact addition** (placed immediately after `useOrdersRealtimeSubscription` at current line 112, before `useConsumerCalendar` at current line 114):

```ts
// ORCH-0854 H-1: Supabase realtime subscription on `tickets` table. Closes
// the up-to-60s post-scan staleness window on the consumer Tickets/Calendar
// tab by invalidating BOTH `["businessEventOrders", userId]` AND
// `["consumerCalendar", userId]` on every UPDATE event the buyer is entitled
// to see. RLS policy "Buyer or brand team can select tickets" (baseline
// squash) gates delivery to tickets whose order.buyer_user_id = auth.uid(),
// so the buyer cannot receive events for tickets they don't own. Pattern is
// a verbatim mirror of `useOrdersRealtimeSubscription` above. Existing
// fallback layers (`refetchOnWindowFocus: true` on `useBusinessEventOrders`,
// 60s staleTime, and the post-purchase invalidate loop in
// `ExpandedBusinessEventSheet.handleBuy`) remain as belt-and-suspenders if
// realtime fails to connect. Companion migration:
// `supabase/migrations/20260606000200_orch_0854_tickets_realtime_publication.sql`.
export const useTicketsRealtimeSubscription = (userId: string | undefined): void => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`tickets:buyer=${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tickets",
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["businessEventOrders", userId] });
          queryClient.invalidateQueries({ queryKey: ["consumerCalendar", userId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
};
```

**Notes for implementor:**
- No new imports — `useEffect`, `useQueryClient`, and `supabase` are already imported by the existing `useOrdersRealtimeSubscription` block.
- Channel name is `tickets:buyer=${userId}` (NOT `tickets:buyer_user_id=eq.${userId}` like the orders channel uses) because the postgres_changes filter has no `buyer_user_id` column on `tickets`. The userId suffix is purely a channel-name disambiguator so two buyers signed in on the same dev environment don't collide.
- Event scope is `"UPDATE"` only (NOT `"*"`) because tickets are INSERTed at checkout time via the buyer's own purchase flow — the existing orders subscription + the 3-attempt invalidate loop already cover the post-purchase appearance path; INSERTing here would duplicate work without benefit.
- Both invalidations fire unconditionally; React Query deduplicates same-tick invalidations and the second key has zero subscribers today (defense-in-depth for H-2 per investigation).
- No filter on the postgres_changes options object. Reason: postgres_changes filter syntax (`column=eq.value`) cannot join to `orders.buyer_user_id`. Server-side RLS gates delivery; the buyer cannot receive events for tickets they don't own.

### Component layer

**File:** `app-mobile/src/components/activity/CalendarTab.tsx` (MODIFY)

**Exact change:** Widen the existing import from `useCalendarEntries` to include the new hook, and add one line invoking it next to the existing `useOrdersRealtimeSubscription` call. Implementor must locate the existing import + invocation site (post-ORCH-0851) and add the parallel construct.

**Before:**
```ts
import { useBusinessEventOrders, useOrdersRealtimeSubscription } from "../../hooks/useCalendarEntries";
// ...inside component body...
useOrdersRealtimeSubscription(user?.id);
```

**After:**
```ts
import {
  useBusinessEventOrders,
  useOrdersRealtimeSubscription,
  useTicketsRealtimeSubscription, // ORCH-0854
} from "../../hooks/useCalendarEntries";
// ...inside component body...
useOrdersRealtimeSubscription(user?.id);
useTicketsRealtimeSubscription(user?.id); // ORCH-0854
```

No render changes. No props changes. No state changes.

---

## Success criteria

| ID | Criterion | Observable / testable |
|----|-----------|------------------------|
| SC-1-iOS | On iOS sim, with consumer signed in as a known buyer holding a `valid` ticket, when the scanner-side `biz_ticket_scan` RPC commits `tickets.status='used'` for that ticket, the badge on `TicketPdfSheet` flips from "Valid" → "Used" within ≤2 seconds and without app re-focus, pull-to-refresh, or background/foreground cycling. | Live-fire on iOS Simulator; screen-record before/after. |
| SC-1-Android | Identical to SC-1-iOS on the Android emulator. | Live-fire on Android Emulator; screen-record before/after. |
| SC-2 | `BusinessEventCalendarRow.ticketCountValid` decrements by 1 within the same ≤2s window when the scanned ticket was the user's only `valid` ticket on that order; for orders with multiple tickets, the count reflects only-remaining-valid count. | Live-fire on iOS or Android with a 2-ticket order; observe the count change. |
| SC-3 | Publication probe `SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='tickets'` returns one row after operator applies the migration. | `mcp__supabase__execute_sql` after `supabase db push --linked`. |
| SC-4 | Signed-out app (`userId` undefined) does NOT subscribe — no channel created, no console warnings. | Static check `if (!userId) return;` guard present at top of hook; runtime sim verification: cold-launch app pre-login, observe Metro logs for no `tickets:buyer=` channel subscription. |
| SC-5 | Sign-out → sign-in flow cleanly tears down the prior buyer's channel via `supabase.removeChannel(channel)` and opens a fresh one. No leaked channels. | Static check that `useEffect` returns a cleanup function calling `removeChannel`; runtime check via Metro / Supabase dashboard channel count remains stable across sign-out/sign-in cycle. |
| SC-6 | Existing fallback layers untouched: `useBusinessEventOrders` still has `staleTime: 60_000` + `refetchOnWindowFocus: true`; 3-attempt invalidate loop in `ExpandedBusinessEventSheet.handleBuy` still present. | Adversarial CI gate (orch-0854-adversarial-check.mjs) static check; git diff review at PR time. |
| SC-7 | The ORCH-0840 [Regression-test enforcement + append-only CI] two-test pair is in place: implementor happy-path script `orch-0854-regression-check.mjs` (≥6 checks covering hook export, channel name pattern, postgres_changes shape, both invalidation keys, cleanup, CalendarTab wiring) + tester adversarial script `orch-0854-adversarial-check.mjs` (≥5 checks attacking different angles per Step 0.5 different-angle rule). Implementor's script demonstrates fails-on-revert at a named commit hash by reverting the invalidate call and re-running. | Both scripts exit 0 on PASS, exit 1 on revert; commit hashes captured in implementation + QA reports. |
| SC-8 | New strict-grep CI gate `orch-0854-tickets-realtime-publication-paired.mjs` enforces I-PROPOSED-BV by failing if `app-mobile/src/` ever subscribes to `postgres_changes { table: 'tickets' }` without a matching `ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets` migration on disk. Plugged into `.github/workflows/strict-grep-mingla-business.yml` per `feedback_strict_grep_registry_pattern.md` (one script + one job; do NOT create parallel workflow files). | Gate exit 0 on PASS; deletion of the migration file triggers exit 1. |

---

## Invariants

**Existing invariants preserved:**

| ID | How preserved |
|----|---------------|
| I-PROPOSED-J zustand_persist_no_server_snapshots | No Zustand involved; React Query only. Confirmed unchanged. |
| Constitution #3 No silent failures | The publication-add migration ships with the client subscription so the subscription cannot silently no-op. Strict-grep gate enforces the pairing structurally going forward. |
| Constitution #4 One key per entity | `["businessEventOrders", userId]` and `["consumerCalendar", userId]` are the existing keys; no new key namespaces created. |
| Cross-Surface Impact Inspection (codified 2026-05-15) | Phase 2.5 table present above. |

**New invariant proposed (DRAFT → ACTIVE on ORCH-0854 CLOSE):**

- **I-PROPOSED-BV REALTIME_TABLE_IN_PUBLICATION_OR_NO_SUBSCRIPTION**
  - **Rule:** Any client-side `supabase.channel(...).on('postgres_changes', { table: T, ... })` reference in `app-mobile/src/`, `mingla-business/src/`, or `mingla-admin/src/` MUST have a matching `ALTER PUBLICATION supabase_realtime ADD TABLE public.T` SQL migration on disk under `supabase/migrations/`. EXEMPT: subscriptions explicitly justified as inert in a SPEC (e.g., placeholder for upcoming work) — exemption requires a `// REALTIME-INERT-OK: <ORCH-ID> <reason>` comment within 3 lines of the subscription call.
  - **Why:** Two confirmed instances of this silent-failure trap in the codebase (ORCH-0816 [Brand KPI tile freshness + Realtime] for `orders`, ORCH-0854 [Consumer ticket status live-flip] for `tickets`). A third instance must be prevented at gate time, not at user-bug-report time.
  - **Enforced by:** `.github/scripts/strict-grep/orch-0854-tickets-realtime-publication-paired.mjs` plugged into `.github/workflows/strict-grep-mingla-business.yml`.

(Invariant ID chosen as next free contiguous slot in `Mingla_Artifacts/INVARIANT_REGISTRY.md` after BU; orchestrator should re-verify at CLOSE time and renumber only if a parallel ORCH has reserved BV in the meantime.)

---

## Test cases

| ID | Scenario | Input | Expected | Layer |
|----|----------|-------|----------|-------|
| T-01 | Happy path — single ticket scanned | Buyer signed in with 1 `valid` ticket on iOS sim; scanner commits `tickets.status='used'` via real scan UI OR `mcp__supabase__execute_sql` direct UPDATE wrapped in `SET ROLE service_role`. | Badge flips `Valid → Used` within ≤2s; calendar row count `1 → 0`. | Full stack |
| T-02 | Happy path — Android parity | Same as T-01 on Android emulator. | Identical outcome. | Full stack |
| T-03 | Cleanup on sign-out | Sign out while subscription is active. | Channel removed; no leaked subscribers in Supabase dashboard. | Hook |
| T-04 | Cleanup on sign-in cycle | Sign out, sign in as a different buyer. | Old channel removed, new channel `tickets:buyer=${newUserId}` opens. | Hook |
| T-05 | Anonymous guard | Cold-launch app pre-login; observe Metro logs. | No `tickets:buyer=` channel subscription. | Hook |
| T-06 | RLS gate (cross-buyer privacy) | Buyer A signed in; scanner commits `tickets.status='used'` on a ticket owned by Buyer B. | Buyer A's app receives no event for Buyer B's ticket (RLS blocks delivery); A's cache is not invalidated. | RLS + Hook |
| T-07 | Publication probe | `SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='tickets'`. | Returns one row post-migration; zero rows pre-migration. | DB |
| T-08 | Subscription is genuinely live (fails-on-revert proof) | Revert the `queryClient.invalidateQueries({ queryKey: ["businessEventOrders", userId] })` line and re-run the implementor happy-path script. | Script exits 1. Restoring the line returns exit 0. | CI |
| T-09 | Fallback layers preserved | Static-check `staleTime`, `refetchOnWindowFocus`, and the `handleBuy` invalidate loop. | All three still present unchanged. | CI (adversarial) |
| T-10 | New strict-grep gate is live | Run `.github/scripts/strict-grep/orch-0854-tickets-realtime-publication-paired.mjs`. | Exit 0 with current state; exit 1 if the migration file is deleted. | CI |

---

## Implementation order

1. **DB migration first.** Create `supabase/migrations/20260606000200_orch_0854_tickets_realtime_publication.sql` with the exact contents in §Database layer. Operator runs `supabase db push --linked` to apply. Implementor MUST NOT apply it directly (per `feedback_orchestrator_deploys_edge_functions.md` — operator owns `supabase db push`).

2. **Hook addition.** Edit `app-mobile/src/hooks/useCalendarEntries.ts` and append the `useTicketsRealtimeSubscription` export immediately after the existing `useOrdersRealtimeSubscription` block.

3. **Component wiring.** Edit `app-mobile/src/components/activity/CalendarTab.tsx` per §Component layer.

4. **CI gate scripts.** Create both `app-mobile/scripts/ci/orch-0854-regression-check.mjs` and `app-mobile/scripts/ci/orch-0854-adversarial-check.mjs` mirroring the file shape of `app-mobile/scripts/ci/orch-0851-regression-check.mjs` + `app-mobile/scripts/ci/orch-0851-adversarial-check.mjs`. The implementor's happy-path script MUST exercise the fails-on-revert proof and the report MUST cite the commit hash at which it was verified.

5. **package.json entries.** Append `test:orch-0854` and `test:orch-0854-adv` script entries to `app-mobile/package.json` immediately after the `test:orch-0851-adv` entry.

6. **Strict-grep CI gate.** Create `.github/scripts/strict-grep/orch-0854-tickets-realtime-publication-paired.mjs` and add a corresponding job entry to `.github/workflows/strict-grep-mingla-business.yml`. Do NOT create a parallel workflow file. Gate body: scan `app-mobile/src/`, `mingla-business/src/`, `mingla-admin/src/` for any `postgres_changes` subscription with `table: 'tickets'`; if found, assert a migration matching `^supabase/migrations/.*\.sql$` containing `ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets` exists. Include a `REALTIME-INERT-OK: ORCH-XXXX <reason>` comment-line exemption check.

7. **Implementation report.** Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0854_CONSUMER_TICKET_SCAN_STATUS_LIVE_FLIP.md` with old→new receipts per file, the fails-on-revert commit hash for T-08, and gate pass evidence for T-09 + T-10. Do NOT deploy any edge function (none touched). Do NOT push migrations directly. Hand back to operator for `supabase db push --linked`.

---

## Regression prevention

**Class of bug being fixed:** silent-failure realtime subscription that watches an unpublished table. Two instances confirmed in this codebase to date.

**Structural safeguards:**

1. **The publication-pairing strict-grep gate (§Implementation Step 6)** — fails CI if any future client subscription to a table lacks a matching publication-add migration. Codified as I-PROPOSED-BV.

2. **The fails-on-revert anchor (§Implementation Step 4)** — reverting the invalidate call makes the regression script fail, so a silent regression cannot land without CI catching it.

3. **Protective comment in the new hook (§Hook layer)** — explicit explanation of WHY the channel is filterless (RLS gates delivery) prevents a well-meaning future engineer from "tightening" the filter and silently breaking it.

4. **Adversarial check covers fallback preservation (§Implementation Step 4, T-09)** — explicit static-check that the `staleTime`, `refetchOnWindowFocus`, and `handleBuy` invalidate loop survive prevents accidental removal during cleanup refactors.

---

## Open items for operator gate

- Operator must run `supabase db push --linked` after the PR lands the migration. CI cannot apply this safely.
- Verify post-apply via `mcp__supabase__execute_sql` (probe in SC-3 above).
- No edge function deploy required.
- No native build required — JS-only change to `app-mobile/`.
- EAS OTA after CLOSE per `feedback_eas_update_no_web.md` two-command pattern: `cd app-mobile && eas update --branch production --platform ios --message "ORCH-0854: ticket scan live-flip"` then the same with `--platform android`.
