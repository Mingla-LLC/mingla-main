# SPEC — ORCH-0829-A: Free-ticket confirmation + Consumer calendar union

**Mode:** SPEC
**Investigator + spec author:** Claude `mingla-forensics`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0829_CHECKOUT_FLOW_BUGS_FREE_CALENDAR_STRIPE.md` (Bug X + Bug Y, both `proven`)
**Sibling:** ORCH-0829-B (Stripe double-resolve, separate spec)

---

## 1. Layman Summary

Two surgical fixes to make the consumer business-event purchase loop honest end-to-end. (1) Tapping "Get Free" on a free ticket now opens a one-tap confirmation modal that previews the ticket + buyer info BEFORE creating the order — no more silent claims. (2) The consumer Calendar tab now also queries the `orders` + `tickets` + `events` tables for the signed-in user's business-event purchases and merges them into the existing calendar timeline — no schema change, no migration, no edge function, just a parallel client-side fetch + union. After Stripe success the calendar query invalidates immediately and short-polls (3 retries × 1s) to cover webhook→finalize latency. Zero SDK upgrade; that's ORCH-0829-B.

---

## 2. Scope and Non-Goals

### 2.1 In scope

| # | Scope item | Source |
|---|---|---|
| S1 | Free-ticket confirmation modal in `ExpandedBusinessEventSheet` | Investigation R-X (proven) |
| S2 | Same confirmation modal reused for paid ticket "review before pay" step (operator-preferred UX consistency per investigation §6 fix strategy) | Investigation §6 |
| S3 | `CalendarService.fetchUserCalendarEntries` extended to also fetch consumer's business-event orders + tickets + events; merge into single timeline | Investigation R-Y (proven) |
| S4 | New `BusinessEventCalendarEntry` shape (discriminator-based) so the UI can render either source variant | Consequence of S3 |
| S5 | Calendar UI rendering for business-event entries: cover image, event title, master date in `event_dates.timezone`, "View ticket" affordance opening QR | Consequence of S3 |
| S6 | Post-`runNativeCheckout` invalidation + short-polling on `["calendarEntries", userId]` query (3 retries × 1s) | Operator-confirmed strategy, investigation §6 contributing factor |
| S7 | Jest-style Node regression check at `app-mobile/scripts/ci/orch-0829a-regression-check.mjs` covering: confirmation modal present, calendar service unions, invalidation fires, polling configuration correct | Regression prevention |

### 2.2 Non-goals (explicit)

| # | Non-goal | Rationale |
|---|---|---|
| N1 | Stripe SDK upgrade or `useStripePaymentSheet` changes | Covered by ORCH-0829-B |
| N2 | New edge function for calendar | Operator chose client-side union (lower risk); reconsider if calendar load times exceed 800ms |
| N3 | Trigger on `orders` insert mirroring rows into `calendar_entries` | Same rationale as N2 — operator chose client union |
| N4 | Cancellation/refund handling in calendar render | Display only `payment_status IN ('paid','pending')` orders to start. Refunded/cancelled treatment is a sibling ORCH if/when needed. |
| N5 | Ticketmaster ticket integration into calendar | Out of scope; longer-standing gap, register sibling P2 ORCH |
| N6 | Realtime subscription on orders | Operator chose polling; revisit only if 3s polling proves insufficient on real-world Stripe latency |
| N7 | Notifications / push for ticket-secured | Sibling P2 ORCH |
| N8 | Confirmation modal for Ticketmaster purchases | TM uses external redirect, no confirmation modal needed |

### 2.3 Assumptions

- A1: Consumer authenticated; `user.id` = `orders.buyer_user_id` for any signed-in purchase.
- A2: `payment_status='paid'` for free tickets returns immediately from `ticket-checkout-create` (verify by reading the edge function during IMPLEMENT pre-flight; if free path leaves status='pending', the calendar should still surface them).
- A3: `event_dates` table contains the master date for every published business event (per ORCH-0828 invariants).
- A4: `tickets` table is populated synchronously for free orders (per `ticket-checkout-create` free path); for paid orders it's populated by the Stripe webhook → finalize RPC (asynchronously, 1-3s typical).
- A5: `glass.bottomSheet.snapPoints` design tokens can be reused for the confirmation modal styling.
- A6: The existing `useCalendarEntries` query (`staleTime: 5min`) is acceptable for non-purchase navigations; only post-purchase needs aggressive invalidation.

---

## 3. Per-Layer Specification

### 3.1 Database layer — N/A

No schema changes. No migrations. Reads only from `orders`, `tickets`, `events`, `event_dates`, `brands`.

### 3.2 Edge function layer — N/A

No edge function changes. `ticket-checkout-create` already creates the order rows correctly. Reads are direct Supabase client → RLS.

### 3.3 RLS verification (read-only audit, no changes)

Confirm via DB probe during IMPLEMENT pre-flight that the signed-in consumer can SELECT their own rows from:
- `orders WHERE buyer_user_id = auth.uid()`
- `tickets JOIN orders ON … WHERE orders.buyer_user_id = auth.uid()`
- `events WHERE id IN (SELECT event_id FROM orders WHERE buyer_user_id = auth.uid())`
- `event_dates WHERE event_id IN (...)` — likely already allowed via public-event RLS
- `brands WHERE id IN (...)` — likely already allowed

If any read is blocked by RLS, this spec is INCOMPLETE — flag to operator and add the SELECT policy in a follow-up rather than weakening the policy in this rework. (RLS is the security boundary; if a consumer's own orders are blocked, that's a security review, not a spec change.)

### 3.4 Service layer — `app-mobile/src/services/calendarService.ts`

#### 3.4.1 New types

```ts
// Existing
export interface CalendarEntryRecord { /* unchanged */ }

// NEW — discriminator-based unified shape
export interface ConsumerCalendarEntry {
  kind: "calendar" | "business_event";
  id: string;              // stable key across renders
  scheduledAt: string;     // ISO timestamp for sort
  title: string;
  imageUrl: string | null;
  // calendar variant data
  calendar?: CalendarEntryRecord;
  // business_event variant data
  businessEvent?: BusinessEventCalendarRow;
}

export interface BusinessEventCalendarRow {
  orderId: string;
  eventId: string;
  eventTitle: string;
  brandName: string;
  brandSlug: string;
  coverMediaUrl: string | null;
  masterDateUtc: string | null;
  timezone: string;
  paymentStatus: "pending" | "paid" | "failed" | "refunded" | "partial_refund" | "cancelled";
  ticketCount: number;
  ticketCountValid: number; // tickets with status='valid'
  tickets: ConsumerTicketRow[];
  publicBuyerUrl: string | null;
}

export interface ConsumerTicketRow {
  id: string;
  ticketTypeId: string;
  qrCode: string;
  status: "valid" | "used" | "void" | "transferred" | "refunded";
  attendeeName: string | null;
  attendeeEmail: string | null;
}
```

#### 3.4.2 New method — `fetchUserBusinessEventOrders(userId)`

Add to `CalendarService`:

```ts
static async fetchUserBusinessEventOrders(
  userId: string,
): Promise<BusinessEventCalendarRow[]> {
  // 1. Fetch orders for this user (only paid + pending — exclude failed/refunded/cancelled)
  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select(`
      id, event_id, payment_status, created_at,
      events!inner ( id, title, slug, cover_media_url, timezone,
        brand:brands!inner ( id, slug, name ),
        event_dates!left ( id, start_at, end_at, is_master )
      ),
      tickets:tickets ( id, ticket_type_id, qr_code, status, attendee_name, attendee_email )
    `)
    .eq("buyer_user_id", userId)
    .in("payment_status", ["paid", "pending"])
    .order("created_at", { ascending: false });

  if (ordersError) {
    console.error("[CalendarService] fetchUserBusinessEventOrders error:", ordersError);
    throw ordersError;
  }

  // 2. Normalize to BusinessEventCalendarRow[]
  return (orders ?? []).map((order: any): BusinessEventCalendarRow => {
    const event = order.events;
    const brand = event?.brand;
    const masterDate = (event?.event_dates ?? []).find(
      (ed: any) => ed?.is_master === true,
    );
    const tickets: ConsumerTicketRow[] = (order.tickets ?? []).map((t: any) => ({
      id: t.id,
      ticketTypeId: t.ticket_type_id,
      qrCode: t.qr_code,
      status: t.status,
      attendeeName: t.attendee_name ?? null,
      attendeeEmail: t.attendee_email ?? null,
    }));
    return {
      orderId: order.id,
      eventId: event?.id ?? order.event_id,
      eventTitle: event?.title ?? "Event",
      brandName: brand?.name ?? "",
      brandSlug: brand?.slug ?? "",
      coverMediaUrl: event?.cover_media_url ?? null,
      masterDateUtc: masterDate?.start_at ?? null,
      timezone: event?.timezone ?? "UTC",
      paymentStatus: order.payment_status,
      ticketCount: tickets.length,
      ticketCountValid: tickets.filter((t) => t.status === "valid").length,
      tickets,
      publicBuyerUrl: brand && event
        ? `${BUSINESS_BUYER_DOMAIN}/e/${brand.slug}/${event.slug}`
        : null,
    };
  });
}
```

(`BUSINESS_BUYER_DOMAIN` constant matches the value used in `discover-merged-events`: `https://business.mingla.app` unless overridden; import or hardcode for now and register a sibling P3 to consolidate.)

#### 3.4.3 New unified fetcher — `fetchConsumerCalendar(userId)`

```ts
static async fetchConsumerCalendar(
  userId: string,
): Promise<ConsumerCalendarEntry[]> {
  // Run both fetches in parallel — independent, no shared state.
  const [legacyEntries, businessOrders] = await Promise.all([
    CalendarService.fetchUserCalendarEntries(userId),
    CalendarService.fetchUserBusinessEventOrders(userId),
  ]);

  const calendarVariants: ConsumerCalendarEntry[] = legacyEntries.map((e) => ({
    kind: "calendar",
    id: `calendar:${e.id}`,
    scheduledAt: e.scheduled_at,
    title: e.card_data?.title ?? "Saved experience",
    imageUrl: e.card_data?.image ?? null,
    calendar: e,
  }));

  const businessVariants: ConsumerCalendarEntry[] = businessOrders.map((b) => ({
    kind: "business_event",
    id: `business:${b.orderId}`,
    scheduledAt: b.masterDateUtc ?? new Date(0).toISOString(),
    title: b.eventTitle,
    imageUrl: b.coverMediaUrl,
    businessEvent: b,
  }));

  return [...calendarVariants, ...businessVariants].sort(
    (a, b) => Date.parse(b.scheduledAt) - Date.parse(a.scheduledAt),
  );
}
```

#### 3.4.4 Error contract

- `fetchUserBusinessEventOrders` THROWS on Supabase error (matches existing `fetchUserCalendarEntries` pattern, line 33-36).
- `fetchConsumerCalendar` does NOT swallow either source's error; first failure throws. Calendar UI shows error state. (Operator can later soften to "show whichever source succeeded" if needed; first-pass is strict.)

### 3.5 Hook layer — `app-mobile/src/hooks/useCalendarEntries.ts`

#### 3.5.1 Add new hook (keep old hook for backward compat with other consumers)

```ts
export const useConsumerCalendar = (userId: string | undefined) => {
  return useQuery({
    queryKey: ["consumerCalendar", userId],
    queryFn: async () => {
      if (!userId) return [];
      return await CalendarService.fetchConsumerCalendar(userId);
    },
    enabled: !!userId,
    staleTime: 60 * 1000,        // 1 minute (shorter than legacy 5min — post-purchase freshness matters more)
    gcTime: 10 * 60 * 1000,
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,  // catch order fulfillment when user returns to app
    retry: false,                 // explicit polling lives in the mutation handler
  });
};
```

The existing `useCalendarEntries` hook stays unchanged for SwipeableCards / AppStateManager which use it for "is this card already scheduled?" lookups — they don't need business-event entries.

#### 3.5.2 Calendar tab UI swaps to new hook

Calendar tab component (locate via `grep "useCalendarEntries" app-mobile/src/components/ | grep CalendarTab\|calendar` — likely `app-mobile/src/components/activity/CalendarTab.tsx`) switches its data source from `useCalendarEntries` to `useConsumerCalendar`. The component renders by `entry.kind` switch:
- `kind === "calendar"` → existing render path
- `kind === "business_event"` → new render path (see §3.6)

### 3.6 Component layer — business-event calendar row

A new sibling to the existing calendar row component renders the business-event variant. File path: `app-mobile/src/components/activity/BusinessEventCalendarRow.tsx`.

Props:

```ts
interface BusinessEventCalendarRowProps {
  entry: BusinessEventCalendarRow;
  onViewTicket: (entry: BusinessEventCalendarRow) => void;
  accountPreferences?: { currency: string; measurementSystem: "Metric" | "Imperial" };
}
```

Render contract:
- Cover image (square thumbnail, 64×64) on the left
- Title (event name) + subtitle (`${brandName} · ${formattedMasterDate}`) — date formatted in `event.timezone` using the same `Intl.DateTimeFormat` pattern used in `ExpandedBusinessEventSheet`
- Right side: ticket count pill ("1 ticket" / "2 tickets") + "View ticket(s)" CTA opening a sheet with the QR codes
- Disabled state when `paymentStatus === "pending"` (1-3s window between Stripe ack and webhook finalize): show a spinner badge + copy "Finalizing payment…"
- Status pill when `paymentStatus === "refunded"` or `"cancelled"` — but per N4 we don't render those at all in v1

Loading state: skeleton row matching dimensions.
Error state: handled by parent (CalendarTab's `isError`); row doesn't need its own.
Empty state: if BOTH calendar entries AND business orders are empty, parent shows the existing "no calendar entries" empty state.

QR-code-view sheet: reuse the existing `InAppBrowserModal` is NOT appropriate (that's web view); instead create a minimal `<Modal>` carrier rendering each ticket's QR (already-rendered SVG via `react-native-qrcode-svg` per `app-mobile/package.json`).

### 3.7 Post-Stripe success — invalidation + polling

In `ExpandedBusinessEventSheet.handleBuy` after the success branch:

```ts
if (result.outcome === "succeeded") {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  toastManager.show("Ticket secured! Check your calendar.", "success");
  sheetRef.current?.close();

  // ORCH-0829-A: invalidate + short-poll for the order to appear.
  // Stripe webhook → biz_ticket_checkout_finalize → orders insert/update
  // is async with 1-3s typical latency on paid orders. Free orders are
  // already finalized synchronously by ticket-checkout-create.
  queryClient.invalidateQueries({ queryKey: ["consumerCalendar", user.id] });

  // Defensive poll for paid orders: 3 attempts × 1s. Free orders see the
  // entry on the first refetch; paid orders may need 1-2 retries.
  if (!isFreeTicket) {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts += 1;
      queryClient.invalidateQueries({ queryKey: ["consumerCalendar", user.id] });
      if (attempts >= 3) clearInterval(interval);
    }, 1000);
  }
}
```

`queryClient` comes from `useQueryClient()` — add the hook at the top of `ExpandedBusinessEventSheet`. `isFreeTicket` is the existing `_isFree` parameter to `handleBuy` (currently unused — drop the underscore prefix).

### 3.8 Component layer — Confirmation modal

Single shared component: `app-mobile/src/components/expandedCard/TicketClaimConfirmModal.tsx`.

```tsx
interface TicketClaimConfirmModalProps {
  visible: boolean;
  ticketName: string;
  ticketPriceCents: number | null;  // null = free
  ticketCurrency: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  isFreeTicket: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}
```

Render (wrapped in RN `<Modal animationType="fade" transparent>` carrier so it sits above the parent `<BottomSheet>`):

- Backdrop: dim 60%, tap-to-cancel
- Card (centered, 320pt wide):
  - Header: `ticketName` (large)
  - Price row: "Free" (when `isFreeTicket`) OR formatted `ticketPriceCents` in `ticketCurrency`
  - Divider
  - Buyer block:
    - "Name" → buyerName
    - "Email" → buyerEmail
    - "Phone" → buyerPhone
  - Disclosure: "By confirming, you'll get a ticket QR for {ticketName}." (free) OR "By confirming, you'll be charged {price}. You can review and complete payment in the next step." (paid)
  - CTA row:
    - Cancel (outline button, calls onCancel)
    - Confirm (primary button — "Claim Free Ticket" or "Continue to Payment" depending on free/paid)

Haptic on Confirm tap (`Haptics.impactAsync(Medium)`).
Accessibility labels on every button.
Loading state during the brief Confirm→handleBuy gap: Confirm disabled with spinner.

### 3.9 Component layer — `ExpandedBusinessEventSheet` wiring

Modify the callbacks (currently lines 228-251):

```ts
const [pendingClaim, setPendingClaim] = useState<{
  ticketId: string;
  isFreeTicket: boolean;
  ticketName: string;
  ticketPriceCents: number | null;
  ticketCurrency: string;
} | null>(null);

const handleConfirmClaim = useCallback((): void => {
  if (pendingClaim === null) return;
  const { ticketId, isFreeTicket } = pendingClaim;
  setPendingClaim(null);
  void handleBuy(ticketId, isFreeTicket); // existing handler — unchanged
}, [pendingClaim, handleBuy]);

const handleCancelClaim = useCallback((): void => {
  setPendingClaim(null);
}, []);

const callbacks: PublicEventCallbacks = useMemo(
  () => ({
    onClose: () => sheetRef.current?.close(),
    onShare: () => toastManager.show("Share is coming soon.", "info"),
    onBuyTicket: (ticketId: string) => {
      const tt = ticketsQuery.data?.find((t) => t.id === ticketId);
      if (!tt) return;
      setPendingClaim({
        ticketId,
        isFreeTicket: false,
        ticketName: tt.name ?? "Ticket",
        ticketPriceCents: tt.priceCents ?? null,
        ticketCurrency: tt.currency ?? data.currency,
      });
    },
    onClaimFreeTicket: (ticketId: string) => {
      const tt = ticketsQuery.data?.find((t) => t.id === ticketId);
      if (!tt) return;
      setPendingClaim({
        ticketId,
        isFreeTicket: true,
        ticketName: tt.name ?? "Ticket",
        ticketPriceCents: null,
        ticketCurrency: tt.currency ?? data.currency,
      });
    },
    onJoinWaitlist: () => toastManager.show("Waitlist coming soon.", "info"),
    onRequestApproval: () => toastManager.show("Request-to-attend coming soon.", "info"),
  }),
  [ticketsQuery.data, data.currency],
);
```

Render the confirmation modal alongside the `<BottomSheet>` (as a sibling in a React fragment, NOT inside the sheet — RN Modal needs to be at the top of the rendered output so it overlays the sheet):

```tsx
return (
  <>
    <BottomSheet
      ref={sheetRef}
      index={visible ? SHEET_INITIAL_INDEX : -1}
      // … existing props …
    >
      <BottomSheetScrollView /* … */>
        <PublicEventPage event={publicEvent} brand={publicBrand} viewerRole={viewerRole} callbacks={callbacks} />
      </BottomSheetScrollView>
    </BottomSheet>
    <TicketClaimConfirmModal
      visible={pendingClaim !== null}
      ticketName={pendingClaim?.ticketName ?? ""}
      ticketPriceCents={pendingClaim?.ticketPriceCents ?? null}
      ticketCurrency={pendingClaim?.ticketCurrency ?? data.currency}
      buyerName={profile?.display_name?.trim() ?? user?.email?.split("@")[0] ?? "Guest"}
      buyerEmail={user?.email ?? profile?.email ?? ""}
      buyerPhone={profile?.phone ?? ""}
      isFreeTicket={pendingClaim?.isFreeTicket ?? true}
      onCancel={handleCancelClaim}
      onConfirm={handleConfirmClaim}
    />
  </>
);
```

`useQueryClient` import added at the top of the file.

---

## 4. Success Criteria

| # | Criterion | Layer | Test |
|---|---|---|---|
| C1 | Tap "Get Free" → confirmation modal opens within 200ms with the correct ticket name, "Free" price label, and the user's name/email/phone | Component | T-01 live-fire |
| C2 | Tap Confirm → modal dismisses + `handleBuy` fires → existing success path runs → toast appears | Component | T-02 live-fire |
| C3 | Tap Cancel on confirmation modal → modal dismisses + NO `handleBuy` call (no order created) | Component | T-03 live-fire + DB probe |
| C4 | Tap "Buy" on a paid ticket → confirmation modal opens with the formatted price + "Continue to Payment" CTA | Component | T-04 live-fire |
| C5 | Calendar tab shows the just-claimed business-event ticket within 5s of the toast (free path) and within 10s (paid path, accounting for Stripe webhook latency) | Full stack | T-05 live-fire |
| C6 | Calendar tab continues to show pre-existing `calendar_entries` rows (no regression) | Full stack | T-06 live-fire |
| C7 | Calendar entries are sorted by `scheduledAt` descending (newest first) | Component | T-07 unit-like assertion in regression check |
| C8 | When user is signed out: `useConsumerCalendar` returns empty array, no Supabase calls | Hook | T-08 unit-like assertion |
| C9 | Regression check passes 100% of contract assertions | CI | `npm run test:orch-0829a` |
| C10 | `tsc --noEmit` clean on touched files | Type | `npx tsc --noEmit` |

---

## 5. Invariants

### 5.1 Preserved

| Invariant | How |
|---|---|
| Const #1 No dead taps | Free claim now responds to user with a modal + agency |
| Const #3 No silent failures | Confirmation modal makes the transaction visible |
| Const #5 Server state server-side | New `useConsumerCalendar` is a server query, not Zustand |
| Const #9 No fabricated data | Calendar shows only orders that exist in DB |
| I-PROPOSED-EXPANSION-TARGET-UNION (ORCH-0828) | Discriminated union pattern reused for `ConsumerCalendarEntry` |

### 5.2 New invariants

| ID | Description | Enforcement |
|---|---|---|
| `I-PROPOSED-TICKET-CLAIM-CONFIRMATION-REQUIRED` | Every consumer business-event ticket claim (free or paid) MUST present a confirmation modal before invoking `runNativeCheckout`. | Regression check T-A1 (modal renders for both free and paid paths) |
| `I-PROPOSED-CONSUMER-CALENDAR-UNIONS-ORDERS` | The consumer calendar surface MUST query both `calendar_entries` and `orders + tickets + events` for the signed-in user and merge them. | Regression check T-A2 (calendarService unions both sources) |

---

## 6. Test Cases

| Test ID | Scenario | Input | Expected | Layer | Auto |
|---|---|---|---|---|---|
| T-01 | Free ticket tap → confirm modal | Maestro tap "Get Free" on Big Party free ticket | Modal visible with title + "Free" + buyer name/email/phone | Component | Manual + screenshot |
| T-02 | Confirm fires handleBuy | Maestro tap Confirm | Modal dismisses; toast "Ticket secured!"; sheet closes | Component | Manual + Metro log |
| T-03 | Cancel does NOT create order | Maestro tap Cancel | Modal dismisses; no toast; DB probe `SELECT count FROM orders WHERE event_id=… AND buyer_user_id=… AND created_at > T0` returns 0 | Full stack | Manual + curl |
| T-04 | Paid ticket tap → confirm modal | Maestro tap "Buy" on paid ticket | Modal visible with formatted price + "Continue to Payment" CTA | Component | Manual + screenshot |
| T-05 | Free → calendar appears | After T-02 succeeds | Tap Calendar tab; entry visible within 5s with event title, master date, "View ticket" CTA | Full stack | Manual + log |
| T-06 | Calendar regression for legacy entries | Pre-existing `calendar_entries` row | Calendar tab shows it alongside business-event entries | Full stack | Manual |
| T-07 | Sort order | Mix of legacy + business entries with varied `scheduled_at` / `masterDateUtc` | Newest first | Component | Regression assertion + manual |
| T-08 | Signed out | userId undefined | `useConsumerCalendar` returns empty array; zero Supabase calls (verify via Metro log absence of `[QUERY] success consumerCalendar.*`) | Hook | Manual + log |
| T-A1 | Confirmation modal codified | Source file content | `TicketClaimConfirmModal.tsx` exists + exports component + is imported from ExpandedBusinessEventSheet | Source | Regression script |
| T-A2 | Calendar union codified | Source file content | `calendarService.ts` defines `fetchConsumerCalendar` + `fetchUserBusinessEventOrders` + `useConsumerCalendar` hook | Source | Regression script |
| T-A3 | Polling codified | Source file content | `handleBuy` success branch invalidates `["consumerCalendar", user.id]` + 3-retry polling loop | Source | Regression script |
| T-A4 | useQueryClient imported | Source file content | `ExpandedBusinessEventSheet.tsx` imports `useQueryClient` from `@tanstack/react-query` | Source | Regression script |
| T-09 | RLS sanity | DB probe as signed-in consumer | `SELECT id FROM orders WHERE buyer_user_id = '{userId}' LIMIT 1` returns the consumer's own row | DB | Manual probe |

---

## 7. Implementation Order

1. **Step 1 — RLS sanity check (pre-flight DB probe).** Before any code, run T-09 via Supabase Management API. If consumer cannot SELECT their own orders, STOP and escalate to operator.
2. **Step 2 — `calendarService` extensions.** Add types + `fetchUserBusinessEventOrders` + `fetchConsumerCalendar` per §3.4. No removal of existing methods.
3. **Step 3 — `useConsumerCalendar` hook.** Add to `useCalendarEntries.ts` (alongside existing `useCalendarEntries`); separate query key `["consumerCalendar", userId]`.
4. **Step 4 — `TicketClaimConfirmModal` component.** New file at `app-mobile/src/components/expandedCard/TicketClaimConfirmModal.tsx` per §3.8.
5. **Step 5 — `BusinessEventCalendarRow` component.** New file at `app-mobile/src/components/activity/BusinessEventCalendarRow.tsx` per §3.6.
6. **Step 6 — CalendarTab UI swap.** Switch data source from `useCalendarEntries` to `useConsumerCalendar`. Render by `entry.kind` discriminator. Reuse existing row component for `kind === "calendar"`, new component for `kind === "business_event"`.
7. **Step 7 — `ExpandedBusinessEventSheet` wiring.** Per §3.9: add `pendingClaim` state, `handleConfirmClaim`, `handleCancelClaim`, update `callbacks`, render the modal as a sibling fragment. Add `useQueryClient` import + post-success invalidation + polling per §3.7.
8. **Step 8 — Regression check.** Add `app-mobile/scripts/ci/orch-0829a-regression-check.mjs` covering T-A1 through T-A4 + T-07 contract.
9. **Step 9 — Local gates.** `npm run test:orch-0829a` PASS; `tsc --noEmit` clean.
10. **Step 10 — Implementation report.** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0829-A_CHECKOUT_CONFIRM_AND_CALENDAR.md`.

---

## 8. Regression Prevention

| Bug class | Prevention |
|---|---|
| Silent claim path (any new ticket-purchase entry point bypasses confirmation) | `I-PROPOSED-TICKET-CLAIM-CONFIRMATION-REQUIRED` + regression T-A1 grep |
| Calendar source forgetting to include orders again | `I-PROPOSED-CONSUMER-CALENDAR-UNIONS-ORDERS` + regression T-A2 grep |
| Post-purchase calendar staleness | Polling + invalidation pattern documented in `ExpandedBusinessEventSheet` comment + regression T-A3 grep |

---

## 9. Discoveries for Orchestrator (NOT in this spec)

1. Ticketmaster ticket integration into calendar (P2 sibling — longer-standing gap)
2. Notifications/push for ticket-secured (P2 sibling)
3. Cancellation/refund handling in calendar render (depends on operator decision — currently hidden per N4)
4. `BUSINESS_BUYER_DOMAIN` constant duplication (P3 hygiene)
5. The 30+ render cascade on DiscoverScreen (already known as H2)

---

End of spec.
