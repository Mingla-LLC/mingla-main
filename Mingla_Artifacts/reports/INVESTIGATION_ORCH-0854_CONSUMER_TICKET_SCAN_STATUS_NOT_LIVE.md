# INVESTIGATION — ORCH-0854 [Consumer ticket status does not flip valid→used immediately after scan]

**Mode:** INVESTIGATE
**Confidence:** Proven (six-field evidence on the root cause; one contributing factor on realtime publication; sim live-fire NOT performed — see Confidence note below).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Date:** 2026-05-17

---

## Executive summary (layman terms)

When a door scanner marks a buyer's ticket as used, the consumer's "Tickets" tab on the Mingla mobile app keeps showing the badge as "valid" for up to ~60 seconds. The database flip itself is correct and instant — the scanner's RPC writes `tickets.status = 'used'` and stamps `used_at = now()` synchronously. The gap is on the consumer side: the post-ORCH-0851 realtime subscription that closes the post-purchase freshness window only listens to changes on the `orders` table, not the `tickets` table. The scan mutation never touches `orders`, so no `postgres_changes` event reaches the consumer app, no React Query cache invalidation fires, and the cached `tickets:tickets(...)` join keeps rendering the pre-scan `status = 'valid'` until either (a) the 60-second `staleTime` expires, (b) the user backgrounds/foregrounds the app and `refetchOnWindowFocus` re-runs, or (c) the user manually pulls to refresh. There is a second-layer gap: even if the consumer app added a `tickets` subscription today, no event would fire because `public.tickets` is NOT in the `supabase_realtime` publication (only `public.orders` is — confirmed by live DB probe).

This is exactly the same shape of bug as ORCH-0851 [Consumer Tickets tab post-purchase realtime freshness], one table over.

---

## Phase 0 ingestion trace

Files read for this investigation:

- `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0854_CONSUMER_TICKET_SCAN_STATUS_NOT_LIVE.md` — dispatch.
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0851_CONSUMER_TICKET_ORDER_VISIBILITY_AND_AUTH_EMAIL.md` — prior investigation establishing the orders-only realtime model.
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0851_CONSUMER_TICKET_ORDER_VISIBILITY_AND_AUTH_EMAIL.md` — confirmed the shipped scope was `orders` only.
- `Mingla_Artifacts/reports/QA_ORCH-0851_CONSUMER_TICKETS_REALTIME.md` — confirmed verdict PASS only covers post-purchase, not post-scan.
- `app-mobile/src/hooks/useCalendarEntries.ts` (full file, esp. lines 32–112) — sole realtime subscription site for the consumer Tickets tab.
- `app-mobile/src/services/calendarService.ts` (lines 313–423) — `fetchUserBusinessEventOrders` query with `tickets:tickets(...)` join.
- `app-mobile/src/components/activity/BusinessEventCalendarRow.tsx` (lines 75–85) — `ticketCountValid` render path.
- `app-mobile/src/components/activity/TicketPdfSheet.tsx` (lines 313–330) — per-ticket status badge.
- `supabase/functions/scan-ticket/index.ts` — server-side scanner entry point.
- `supabase/migrations/20260528000000_orch_0793_scan_time_window.sql` — current `CREATE OR REPLACE FUNCTION biz_ticket_scan` definition (latest in chain).
- `supabase/migrations/20260515000013_orch_0777_ticket_checkout_core.sql` — original `biz_ticket_scan` (superseded).
- `supabase/migrations/20260515000016_orch_0777_qr_pepper_service_role_rpc.sql` (superseded).
- `supabase/migrations/20260515000017_orch_0777_scan_wrong_event_result.sql` (superseded).

Migration chain rule applied: the authoritative current definition of `biz_ticket_scan` is in `20260528000000_orch_0793_scan_time_window.sql`. All earlier `CREATE OR REPLACE FUNCTION biz_ticket_scan` blocks are historical context.

Live DB probes:
- `pg_publication_tables` for `supabase_realtime` filtered on `tickets`/`orders` → `orders` present, `tickets` ABSENT.
- `pg_policies` for `public.tickets` → confirms buyer-SELECT policy is RLS-correct (buyer can SELECT tickets via the `orders.buyer_user_id = auth.uid()` predicate), so a buyer-filtered realtime subscription WOULD be RLS-deliverable IF the publication included `tickets`.

Memory checks:
- `MEMORY.md` confirms ORCH-0851 close 2026-05-17 and the I-PROPOSED-J persist-no-server-snapshots invariant; no existing memory specifically addresses `tickets`-table realtime gap.

---

## Investigation manifest (data flow trace)

```
Door scanner taps "Scan"
  → mingla-business scanner UI
  → POST supabase/functions/scan-ticket
  → service-role client invokes RPC biz_ticket_scan(p_event_id, p_qr_payload, p_scanner_user_id, p_qr_token_pepper)
  → (PROVEN, line 140–144 of orch_0793 migration)
       UPDATE public.tickets
          SET status = 'used',
              used_at = now(),
              used_by_scanner_id = p_scanner_user_id
        WHERE id = v_ticket.id;
  → INSERT INTO public.scan_events (...)
  → NO write to public.orders at any point

——— REALTIME BOUNDARY ———

Consumer app reads:
  → app-mobile/src/components/activity/CalendarTab.tsx (renders Tickets section)
  → useBusinessEventOrders(user.id) → React Query
  → CalendarService.fetchUserBusinessEventOrders(userId)
  → SELECT id, event_id, payment_status, ..., tickets:tickets(id, ..., status, ...)
     FROM orders WHERE buyer_user_id = userId AND payment_status IN ('paid','pending')
  → cached under key ["businessEventOrders", userId], staleTime = 60s, refetchOnWindowFocus = true

Realtime invalidation chain (post-ORCH-0851):
  → useOrdersRealtimeSubscription(user.id) at useCalendarEntries.ts:86–112
  → channel `orders:buyer_user_id=eq.${userId}`
  → on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `buyer_user_id=eq.${userId}` })
  → queryClient.invalidateQueries({ queryKey: ["businessEventOrders", userId] })
  → BUT: scan mutation writes to tickets, not orders → no event fires → no invalidation
```

---

## Findings (classified)

### 🔴 Root Cause R-1 — Consumer realtime subscription scope is `orders` only; ticket-status mutations never reach the cache

**File + line:** `app-mobile/src/hooks/useCalendarEntries.ts:86-112`
**Exact code:**
```ts
export const useOrdersRealtimeSubscription = (userId: string | undefined): void => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`orders:buyer_user_id=eq.${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `buyer_user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["businessEventOrders", userId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
};
```
**What it does:** Subscribes only to `postgres_changes` on `public.orders` filtered by `buyer_user_id`. Invalidates the calendar cache exclusively on order-row INSERT/UPDATE/DELETE events.
**What it should do:** Must also subscribe to mutations on `public.tickets` for rows the buyer owns (RLS-validated by `tickets.order_id → orders.buyer_user_id = auth.uid()`), so that scanner-driven `status = 'used'` flips invalidate the same `["businessEventOrders", userId]` cache key. Because Supabase Realtime postgres_changes filters only support direct column predicates on the changed row (no join filters), the practical implementation is to subscribe with `event: 'UPDATE'` on `public.tickets` with NO server-side filter, then in the handler verify the inbound ticket's `order_id` resolves to one of the current buyer's known orders (cheap client-side guard) OR simply invalidate unconditionally (cheap — invalidation is idempotent and the user's calendar query already filters by `buyer_user_id`, so cross-buyer events trigger a wasted but harmless refetch). RLS at the publication-delivery layer still gates which rows the client actually receives, but only if the row passes RLS for that user — see R-2 below for the publication gap that blocks delivery entirely today.
**Causal chain:** Scanner at door taps Scan → `scan-ticket` edge function → `biz_ticket_scan` RPC → `UPDATE public.tickets SET status='used'` commits → buyer's consumer app does NOT subscribe to `tickets` realtime → `["businessEventOrders", userId]` cache stays untouched → `CalendarTab` re-renders from cache showing the stale `tickets:[{ status: 'valid' }]` join → `BusinessEventCalendarRow.ticketCountValid` (line 78) counts the ticket as valid → `TicketPdfSheet` per-ticket badge (line 317) renders "Valid" green chip → user sees no flip until staleTime (60s) + refetchOnWindowFocus / next mount.
**Verification step:** Open consumer app on iOS sim while signed in as a buyer holding a valid ticket; observe initial badge = "Valid". Have business app scan the ticket (or manually invoke `biz_ticket_scan` via service role in SQL editor with a correct QR payload). Watch consumer Tickets tab — badge does NOT flip. Background app, foreground → badge flips. OR wait 60s + tap the tab → badge flips. Reverse test: shipping the fix (add ticket-table subscription) → badge flips within ~1s of the scan.

### 🔴 Root Cause R-2 — `public.tickets` is NOT in the `supabase_realtime` publication

**File + line:** Database state. Confirmed via live probe:
```sql
SELECT tablename FROM pg_publication_tables
 WHERE pubname = 'supabase_realtime' AND tablename IN ('orders','tickets');
-- → [{"tablename":"orders"}]   (tickets ABSENT)
```
**Exact code:** No migration in `supabase/migrations/` adds `public.tickets` to the publication. `20260602000004_orch_0816_orders_realtime_publication.sql` adds `public.orders` only (see ORCH-0816 [Brand KPI tile freshness + Realtime] close note).
**What it does:** Postgres logical-replication does not emit row-level changes on `public.tickets` to the `supabase_realtime` slot, so even a correctly-coded client subscription on `table: 'tickets'` would silently never fire any handler.
**What it should do:** A migration must `ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;` before any client-side ticket-table subscription can do useful work. Without this, the R-1 fix would ship and silently no-op — same trap ORCH-0816 caught for `orders` in this codebase.
**Causal chain:** Even if a future ORCH adds `useTicketsRealtimeSubscription`, no event fires → cache stays stale → user-visible bug unchanged → tester would have to live-fire to catch the silent-failure regression. This is also the seed of `Constitution #3 (No silent failures)` if not handled at SPEC time.
**Verification step:** `SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime';` — confirm `tickets` is absent before fix, present after migration.

### 🟡 Hidden Flaw H-1 — Consumer `["businessEventOrders", userId]` cache lacks ticket-level columns in its key namespace, so partial-invalidation strategies cannot scope to a single ticket

**File + line:** `app-mobile/src/services/calendarService.ts:328-344` and `useCalendarEntries.ts:60`.
**Exact code:**
```ts
queryKey: ["businessEventOrders", userId]
// Single key holds all orders + nested tickets for the buyer.
```
**What it does:** All orders + their joined tickets share one cache entry. A ticket-table realtime event must invalidate the entire entry — there is no per-ticket or per-order cache shard.
**What it should do:** Acceptable for current scale (a buyer holds tens of tickets, not thousands), but worth noting: if a later ORCH adds optimistic single-ticket UI updates (e.g. animating a single chip from "Valid" → "Used" with no full refetch), the cache shape would force re-fetching everything just to update one ticket. Acceptable today; flag for orchestrator.
**Causal chain:** Not contributing to today's symptom.
**Verification step:** N/A — observation about future flexibility.

### 🟡 Hidden Flaw H-2 — `useConsumerCalendar` query at `useCalendarEntries.ts:114-129` ALSO lacks a tickets-table subscription

**File + line:** `app-mobile/src/hooks/useCalendarEntries.ts:114-129`.
**Exact code:**
```ts
export const useConsumerCalendar = (userId: string | undefined) => {
  return useQuery<ConsumerCalendarEntry[]>({
    queryKey: ["consumerCalendar", userId],
    ...
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
  });
};
```
**What it does:** Second consumer-side query that surfaces calendar entries; not currently displaying ticket-status, but lives in the same hook file and would inherit the same gap if a future surface added ticket-status to its output.
**What it should do:** When R-1's SPEC lands, the tickets-realtime invalidation handler should also invalidate `["consumerCalendar", userId]` for defense in depth, since `fetchConsumerCalendar` reads from the same orders/tickets joins and any future surface re-using this key inherits freshness.
**Causal chain:** Not contributing to today's reported symptom; preventive.
**Verification step:** Grep `["consumerCalendar"` after the fix lands — confirm the invalidation handler covers both keys.

### 🔵 Observation O-1 — Notification-driven invalidation is NOT a fallback path here

**File + line:** `app-mobile/src/hooks/useNotifications.ts:251-339` (mentioned in dispatch as candidate fallback).
**Exact code:** Subscribes to `public.notifications` for the user, dispatches OneSignal foreground display, invalidates notification-specific caches. Does NOT invalidate `["businessEventOrders", ...]`.
**What it does:** Independent system; even if the scan-ticket flow produced a notification row for the buyer (it does not today — `supabase/functions/scan-ticket/index.ts` writes only to `tickets` + `scan_events`), the notification handler would not invalidate the ticket cache.
**What it should do:** N/A — observation only. The architectural cleanest fix is the realtime-subscription pattern (R-1 + R-2), not bolting a notification side-channel onto scan.
**Verification step:** N/A.

### 🔵 Observation O-2 — Business-side scanner UI sees the scan result synchronously

**File + line:** `supabase/functions/scan-ticket/index.ts:33-44`.
**Exact code:** RPC returns the row data including `scan_result` to the scanner client immediately on commit.
**What it does:** Confirms the DB write IS correct and synchronous; the gap is purely consumer-side propagation. Eliminates any "the scanner didn't actually write" alternative explanation.
**Verification step:** Live probe confirms scan_events rows exist for past scans with `scan_result='success'` and corresponding `tickets.status='used' + used_at NOT NULL` — left as a smoke-test for the implementor's pre-flight to verify on the actual operator's test event.

---

## Five-layer cross-check

| Layer | Truth | Disagreement? |
|-------|-------|---------------|
| Docs | ORCH-0851 close note says "post-purchase freshness solved via realtime on orders." ORCH-0816 close note adds `orders` to publication. Neither addresses `tickets`. | No drift — docs honestly describe partial coverage |
| Schema | `tickets.status` constraint `IN ('valid','used','void','transferred','refunded')`. RLS allows buyer to SELECT tickets via orders join. `tickets` NOT in `supabase_realtime` publication. | Schema correct for SELECT; publication scope is the gap |
| Code (server) | `biz_ticket_scan` (orch_0793 migration, lines 140–144) UPDATEs `tickets` and INSERTs `scan_events`. Touches `orders` only via SELECT (line 75–81 join). No `UPDATE orders` anywhere in scan path. | None — server is correct |
| Code (client) | `useOrdersRealtimeSubscription` subscribes ONLY to `orders` table; no `tickets` subscription anywhere in `app-mobile/src/`. Grep `app-mobile/src/ -e "table.*tickets"` returns zero hits in realtime contexts. | Client coverage incomplete |
| Runtime | Predicted: scanner taps → DB row flips → consumer sees stale `valid` for up to 60s. Not directly live-fired this turn (see Confidence note); pattern matches ORCH-0851's pre-fix runtime exactly. | Live-fire pending |
| Data | Confirmed via live probe: `public.orders` in publication; `public.tickets` NOT in publication. | Data confirms the gap |

---

## Blast radius map

Every consumer-side reader of `tickets.status` that depends on `["businessEventOrders", userId]` or `["consumerCalendar", userId]`:

| Surface | File | Symptom from R-1 + R-2 |
|---------|------|------------------------|
| Consumer Tickets tab — calendar row count | `app-mobile/src/components/activity/BusinessEventCalendarRow.tsx:75-85` | `ticketCountValid` shows pre-scan count |
| Consumer Ticket PDF sheet — per-ticket status badge | `app-mobile/src/components/activity/TicketPdfSheet.tsx:313-330` | Per-ticket badge stays "Valid" until cache refresh |
| Any future surface joining tickets via `["consumerCalendar"]` | `useConsumerCalendar` consumers (none today) | Inherits the same gap (H-2) |

Cross-platform: identical RN code, identical gap on iOS and Android (`app-mobile/` is single-source).

NOT in blast radius (verified):
- Business-side scanner UI — gets row data synchronously from the RPC return value
- Admin web — uses separate queries; no consumer realtime
- Buyer/anonymous web — no authenticated Tickets surface

---

## Invariant analysis

**Existing invariants checked** (`Mingla_Artifacts/INVARIANT_REGISTRY.md`):
- I-PROPOSED-J (`zustand_persist_no_server_snapshots`) — not violated; cache is React Query, not Zustand.
- Constitution #3 (No silent failures) — violated indirectly by R-2: without the publication add, a future tickets subscription would silently never fire. SPEC must include a positive verification probe.
- Constitution #4 (One query key per entity) — not violated; the key factory pattern is intact.

**New invariant proposed:**
- **I-PROPOSED-CB REALTIME_TABLE_IN_PUBLICATION_OR_NO_SUBSCRIPTION** — any client-side `supabase.channel().on('postgres_changes', { table: T }, ...)` MUST have a corresponding migration adding table T to the `supabase_realtime` publication, OR the SPEC must explicitly justify why the subscription is intentionally inert (e.g., placeholder for upcoming work). Enforced as a strict-grep CI gate that pairs every client postgres_changes table reference with a publication-add migration. Reason: this codebase has hit the silent-failure pattern twice — once in ORCH-0816 [Brand KPI tile freshness + Realtime] (orders) and structurally pending here (tickets). The third instance must be prevented at gate time.

(Numbering is provisional — orchestrator should renumber against the live registry to avoid collision; the registry is the authority.)

---

## Fix strategy (direction only — not a spec)

Two coupled changes that must ship together to be observable:

1. **Migration** — `ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;` (new migration `2026...._orch_0854_tickets_realtime_publication.sql`). RLS already allows the buyer to SELECT their own tickets, so publication delivery will be correctly gated per-user.

2. **Client hook** — add `useTicketsRealtimeSubscription(userId)` to `app-mobile/src/hooks/useCalendarEntries.ts` mirroring the `useOrdersRealtimeSubscription` pattern verbatim. Subscribe to `event: 'UPDATE'` on `table: 'tickets'` with no server filter (postgres_changes can't join through `orders` for the `buyer_user_id` predicate; RLS gates delivery). On each event, invalidate BOTH `["businessEventOrders", userId]` AND `["consumerCalendar", userId]` (H-2 defense). Wire the hook in `CalendarTab.tsx` next to the existing `useOrdersRealtimeSubscription` call.

Keep all existing fallback layers (refetchOnWindowFocus, 60s staleTime, manual pull-to-refresh) untouched.

**Regression-prevention requirements:**
- Implementor happy-path regression check (`app-mobile/scripts/ci/orch-0854-regression-check.mjs`) covering: hook exported with correct signature; channel name shape; postgres_changes filter shape; invalidation keys include both `businessEventOrders` and `consumerCalendar`; cleanup via `removeChannel`; CalendarTab wiring present. Fails-on-revert anchor = the `queryClient.invalidateQueries` line.
- Tester adversarial check (`orch-0854-adversarial-check.mjs`) covering: anonymous-safety (`if (!userId) return;`); useEffect dep array correctness; fallback-layer preservation (refetchOnWindowFocus + staleTime not regressed); publication-presence probe-style guard (a static assertion that the migration file exists and contains `ADD TABLE public.tickets`).
- Live-fire repro on iOS sim + Android emu: real ticket purchase → scanner invocation (via direct RPC or business scanner UI) → consumer badge flips within ~1s.

---

## Discoveries for orchestrator

1. **Publication coverage is incomplete project-wide.** `tickets` is the second known instance after `orders` (ORCH-0816). A one-shot audit of every `supabase.channel().on('postgres_changes', { table: X })` reference in `app-mobile/src/` against `pg_publication_tables` would surface any other silently-inert subscriptions. Worth a follow-up ORCH if any hits are found.
2. **`scan_events` is also not in the publication.** If any future surface wants to show live scan history to organisers, the same gap applies. Not in scope for this ORCH; flag-and-track.
3. **No notification fan-out on scan.** A buyer is not currently push-notified when their ticket is scanned ("Welcome — you're in!"). Strong UX win, low effort, but explicitly out of scope here. Register as a separate ORCH if product wants it.
4. **Suggested orchestrator-side memory file** post-CLOSE: `feedback_realtime_publication_coverage_required.md` (status: DRAFT) tying R-2 + I-PROPOSED-CB to the recurring pattern.

---

## Confidence

**Proven** for R-1 and R-2 at the code/schema/data layer:
- R-1: code inspection of `useCalendarEntries.ts:86-112` + grep of `app-mobile/src/` confirms zero tickets-table subscriptions.
- R-2: live SQL probe against `pg_publication_tables` directly confirms `tickets` absent from `supabase_realtime`.

**Probable** at the runtime layer: live-fire on the iOS simulator was NOT performed this turn. Reproducing requires a full ticket purchase + a scanner invocation, which depends on a business-app build with scanner permissions plus a real buyer auth state. The code-trace and the DB-state probe are sufficient to establish proven causality at the structural level, and the pattern matches ORCH-0851's pre-fix runtime exactly (same fallback chain, same fallback timings). Per Prime Directive #7, runtime live-fire is the right gate for TEST mode after the implementor lands the fix — not for this INVESTIGATE turn whose evidence is structural. If the operator wants runtime confirmation before authorizing SPEC, request explicitly and the next turn will set up the repro: simulator boot → consumer signed in as a known buyer → SQL-edit invocation of `biz_ticket_scan(...)` against one of that buyer's `valid` tickets → screen recording of the badge state over 60s.

---

## Recommended next phase

**SPEC** by this same skill (`mingla-forensics`). Spec must cover: the migration, the new hook, the CalendarTab wiring, the two new CI regression scripts (per ORCH-0840 Step 0.5 gate), the new invariant I-PROPOSED-CB (or renumbered equivalent), and explicit per-platform success criteria (SC-N-iOS, SC-N-Android). Cross-Surface Impact section is required.
