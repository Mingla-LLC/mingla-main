# SPEC — BIZ Cycle 9c — Orders ops + useOrderStore + buyer order detail

**Date:** 2026-05-02
**Author:** mingla-forensics
**Mode:** SPEC (companion to [INVESTIGATION_BIZ_CYCLE_9c_ORDERS_OPS.md](../reports/INVESTIGATION_BIZ_CYCLE_9c_ORDERS_OPS.md))
**Closes:** 6 net-new operator journeys (J-M1..J-M6) + 4 ORCH-0704 stub-swaps + Cycle 9 HF-4 + new buyer order detail surface
**Backward dependency:** ORCH-0704 v2 (CLOSED grade A 2026-05-02)
**Forward dependencies:** B-cycle (real Stripe/Resend/Twilio); ORCH-0705 (no-show + post-event + dispute paths, post-Stripe deferred)

---

## 1 — Why this spec

ORCH-0704 v2 shipped operator-side full edit-after-publish with buyer-protection guard rails that depend on a `useOrderStore` that doesn't exist yet. Cycle 9c builds the store, wires the 1-line confirm.tsx insertion, swaps 4 ORCH-0704 forward-handoff stubs to live, ships the operator Orders ledger (J-M1..J-M6), and adds the buyer-side order detail page where the material-change banner finally renders.

Operator's 8 Q-9c defaults locked 2026-05-02:
1. Refund partial UX = line-item picker
2. Refund/cancel notification severity = NEW `"destructive"` tag (banner + email + SMS always fires)
3. Audit log unification = same `useEventEditLogStore` extended with optional `orderId?` field
4. Buyer route path = `/o/[orderId]`
5. Free vs paid disambiguation = re-confirmed (Q-9-8 from Cycle 9: free→Cancel, paid→Refund)
6. Banner acknowledge = single tap "Got it"
7. Resend ticket eligibility = paid + refunded_partial only (hidden for fully-refunded + cancelled)
8. Refund stub processing = 1.2s (matches Cycle 8 stub)

---

## 2 — Scope and Non-Goals

### 2.1 In scope

**Schema:**
- NEW `useOrderStore` (Zustand persisted) — full implementation per ORCH-0704 SPEC v2 §3.1.5 OrderRecord/OrderLineRecord/BuyerSnapshot/RefundRecord
- Extend `useEventEditLogStore.EventEditEntry` with optional `orderId?: string`
- Extend `EditSeverity` union with `"destructive"`

**Wires:**
- 1-line recordOrder addition to `app/checkout/[eventId]/confirm.tsx` after recordResult
- Wire `useOrderStore.reset` into `clearAllStores.ts` (Const #6)
- REWRITE `orderStoreHelpers.ts.getSoldCountContextForEvent` body (signature stable — zero callers change)
- REPLACE `liveEventStore.updateLiveEventFields` `affectedOrderIds: []` literal with selector call
- REPLACE `EditPublishedScreen` `webPurchasePresent: false` literal with selector
- REPLACE `EditPublishedScreen.buildRejectDialog` "Open Orders" toast stub with router.push
- REPLACE `EventListCard.tsx:96` `soldCount = 0` stub with selector
- REPLACE `EventManageMenu.tsx` Orders + Issue refunds transitional toasts with onOpenOrders callback

**Operator screens (6 journeys):**
- J-M1 Orders list at `app/event/[id]/orders/index.tsx`
- J-M2 Order detail at `app/event/[id]/orders/[oid]/index.tsx`
- J-M3 Refund full sheet
- J-M4 Refund partial (line-item picker per Q-9c-1 default A)
- J-M5 Cancel order (free orders only per Q-9c-5)
- J-M6 Resend ticket (paid + refunded_partial per Q-9c-7)

**Buyer screen (NEW journey J-M7):**
- Buyer order detail page at `app/o/[orderId].tsx` (anon-tolerant, outside `(tabs)/`)
- Material-change banner consumer reading from `useEventEditLogStore.getEditsForEventSince`

**Notification:**
- Extend `eventChangeNotifier.deriveChannelFlags` for `"destructive"` severity (banner + email + SMS always)
- Extend `composeEmailPayload` + `composeSmsPayload` with refund/cancel-aware copy when `severity === "destructive"`

### 2.2 Out of scope

- Real Stripe refund / cancel (B-cycle)
- Real Resend email send (B-cycle wires; ORCH-0704 stub continues firing)
- Real Twilio SMS send (B-cycle)
- OneSignal push (consumer-app cycle; channels.push always false)
- No-show handling, post-event ops, dispute paths, post-Stripe refund flows (ORCH-0705 deferred)
- Pre-seeded fake orders (Const #9 — useOrderStore starts empty)
- Backend persistence (Zustand client-side; B3 migrates to Supabase orders + order_line_items per PR #59 §B.4)
- Stripe-fee-retained line in J-M3 RefundSheet (D-9c-4 — omitted until real Stripe; would violate Const #9 in stub)
- Account/Brand-level revenue dashboards (Cycles 13-14)

### 2.3 Assumptions

- Operator Q-9c-1..8 defaults all locked A (confirmed 2026-05-02)
- ORCH-0704 v2 invariants I-19 + I-20 ratified
- `expandRecurrenceToDates` / `useEventEditLogStore` / `eventChangeNotifier` stable from ORCH-0704
- `mingla-business/` Expo Web only per DEC-081 — no EAS Update for this cycle

---

## 3 — Layer-by-Layer Specification

### 3.1 Schema (TypeScript types)

#### 3.1.1 `useOrderStore` types (NEW file `mingla-business/src/store/orderStore.ts`)

Verbatim from ORCH-0704 SPEC v2 §3.1.5:

```ts
import type { CheckoutPaymentMethod } from "../components/checkout/CartContext";

export type OrderStatus =
  | "paid"
  | "refunded_full"
  | "refunded_partial"
  | "cancelled";

export interface OrderLineRecord {
  ticketTypeId: string;          // references LiveEvent.tickets[].id (stable)
  ticketNameAtPurchase: string;  // FROZEN at purchase
  unitPriceGbpAtPurchase: number; // FROZEN
  isFreeAtPurchase: boolean;     // FROZEN
  quantity: number;              // FROZEN
  refundedQuantity: number;      // mutable post-refund (0..quantity)
  refundedAmountGbp: number;     // mutable post-refund
}

export interface BuyerSnapshot {
  // All FROZEN at purchase
  name: string;
  email: string;
  phone: string;
  marketingOptIn: boolean;
}

export interface OrderRecord {
  id: string;
  eventId: string;
  brandId: string;
  buyer: BuyerSnapshot;
  lines: OrderLineRecord[];
  totalGbpAtPurchase: number;
  currency: "GBP";
  paymentMethod: CheckoutPaymentMethod;
  paidAt: string;
  status: OrderStatus;
  refundedAmountGbp: number;     // sum across all refunds (denormalized cache)
  refunds: RefundRecord[];        // append-only audit log
  cancelledAt: string | null;
  lastSeenEventUpdatedAt: string; // advances when buyer views detail page
}

export interface RefundRecord {
  id: string;                                                                  // rf_<ts36>_<rand4>
  orderId: string;
  amountGbp: number;
  reason: string;                                                              // REQUIRED 10..200 chars per D-9c-9 (was nullable; now required for symmetry with I-20)
  refundedAt: string;
  lines: { ticketTypeId: string; quantity: number; amountGbp: number }[];      // for partial refunds; full refund = all lines
}

export interface OrderStoreState {
  entries: OrderRecord[];
  // ---- Mutations ----
  recordOrder: (order: OrderRecord) => OrderRecord;          // idempotent dedupe by id
  recordRefund: (orderId: string, refund: Omit<RefundRecord, "id" | "refundedAt">) => OrderRecord | null;
  cancelOrder: (orderId: string, reason: string) => OrderRecord | null;
  updateLastSeenEventUpdatedAt: (orderId: string, iso: string) => void;
  reset: () => void;
  // ---- Selectors ----
  getOrdersForEvent: (eventId: string) => OrderRecord[];     // newest first
  getOrderById: (orderId: string) => OrderRecord | null;
  getSoldCountForEvent: (eventId: string) => number;          // sum of (qty - refundedQty) across paid + refunded_partial
  getSoldCountByTier: (eventId: string) => Record<string, number>;
}
```

**API surface enforces I-19:** NO `updateLine`, NO `updateBuyer`, NO `updatePrice`, NO `setStatus` (status flips are computed from refund aggregates inside `recordRefund` + `cancelOrder`).

Persistence:
- AsyncStorage key: `mingla-business.orderStore.v1`
- `partialize: (s) => ({ entries: s.entries })` — selectors regenerate on rehydrate (HF-9c-4 guard)
- Version: 1 (no migrators yet)

#### 3.1.2 `useEventEditLogStore` extension (MOD)

```ts
// In eventEditLogStore.ts:
export type EditSeverity = "additive" | "material" | "destructive";  // NEW: "destructive"

export interface EventEditEntry {
  id: string;
  eventId: string;
  brandId: string;
  editedAt: string;
  reason: string;
  severity: EditSeverity;
  changedFieldKeys: string[];
  diffSummary: string[];
  affectedOrderIds: string[];
  /**
   * NEW (Cycle 9c). When set, this entry was triggered by an order-level
   * action (refund / cancel / resend) rather than an event-level edit.
   * The order-level events are logged here so the buyer's material-change
   * banner reads a single audit trail.
   * Per Q-9c-3 default A.
   */
  orderId?: string;
}
```

Backward-compat: `orderId?` is optional; pre-Cycle-9c entries (event edits) don't set it. Banner consumer in buyer order detail page filters edits by `eventId` + `editedAt > lastSeenEventUpdatedAt` + `severity !== "additive"`; the `orderId` field is informational (not a filter input).

#### 3.1.3 `eventChangeNotifier` extensions

```ts
// In eventChangeNotifier.ts:
export const deriveChannelFlags = (
  severity: EditSeverity,
  hasWebPurchaseOrders: boolean,
): NotificationChannelFlags => ({
  banner: true,
  email: true,
  // EXTENDED: destructive always fires SMS (refund/cancel = money moved)
  sms: severity === "destructive" || (severity === "material" && hasWebPurchaseOrders),
  push: false, // [TRANSITIONAL] deferred — consumer app cycle wires OneSignal
});
```

Email + SMS payload composers extend with destructive-aware copy:

```ts
export const composeEmailPayload = (p: NotificationPayload): { subject: string; body: string } => {
  if (p.severity === "destructive") {
    // Refund / cancel — different subject template
    const subject = `${p.brandName}: ${p.diffSummary[0] ?? "Order updated"} — '${p.eventName}'`;
    // (e.g. "Mingla: Refund issued — 'Friday Night'")
    const body = [
      `Hi,`,
      ``,
      `${p.brandName} ${p.diffSummary[0] ?? "updated your order"} for '${p.eventName}'.`,
      ``,
      `Reason: ${p.reason}`,
      ``,
      `Tap here to review your order: <web-link-resolved-by-9c>`,
      ``,
      `— Mingla Business`,
    ].join("\n");
    return { subject, body };
  }
  // Existing additive/material path unchanged
  // ... (preserve existing logic)
};

export const composeSmsPayload = (p: NotificationPayload): string => {
  if (p.severity === "destructive") {
    const action = p.diffSummary[0] ?? "Order updated";
    const baseTemplate = `${p.brandName}: ${action} for ${p.eventName}: . Details: <orderUrl>`;
    const baseLen = baseTemplate.length;
    const reasonBudget = 160 - baseLen;
    const reasonForSms = p.reason.length > reasonBudget
      ? `${p.reason.slice(0, Math.max(reasonBudget - 1, 0))}…`
      : p.reason;
    return `${p.brandName}: ${action} for ${p.eventName}: ${reasonForSms}. Details: <orderUrl>`;
  }
  // Existing material/additive path unchanged
};
```

`<orderUrl>` placeholder in stub; cycle 9c's buyer URL `/o/[orderId]` is the eventual swap-in (B-cycle wires real domain).

### 3.2 Store layer

#### 3.2.1 `useOrderStore` mutation contracts

**`recordOrder(order)`** — idempotent dedupe by id:
```ts
recordOrder: (order) => {
  const existing = get().entries.find((o) => o.id === order.id);
  if (existing !== undefined) return existing;  // I-19 write-once
  set((s) => ({ entries: [order, ...s.entries] }));  // newest first
  return order;
}
```

**`recordRefund(orderId, refund)`** — appends RefundRecord + updates per-line aggregates + flips status + fires destructive notification:
```ts
recordRefund: (orderId, refund) => {
  const order = get().entries.find((o) => o.id === orderId);
  if (order === undefined) return null;
  const id = `rf_${Date.now().toString(36)}_${Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, "0")}`;
  const refundedAt = new Date().toISOString();
  const fullRefund: RefundRecord = { ...refund, id, refundedAt };
  // Update per-line aggregates
  const newLines = order.lines.map((line) => {
    const lineRefund = fullRefund.lines.find((rl) => rl.ticketTypeId === line.ticketTypeId);
    if (lineRefund === undefined) return line;
    return {
      ...line,
      refundedQuantity: line.refundedQuantity + lineRefund.quantity,
      refundedAmountGbp: line.refundedAmountGbp + lineRefund.amountGbp,
    };
  });
  // Compute new aggregate + status
  const newRefundedAmount = order.refundedAmountGbp + fullRefund.amountGbp;
  const allLinesFullyRefunded = newLines.every((l) => l.refundedQuantity >= l.quantity);
  const newStatus: OrderStatus = allLinesFullyRefunded ? "refunded_full" : "refunded_partial";
  const updatedOrder: OrderRecord = {
    ...order,
    lines: newLines,
    refundedAmountGbp: newRefundedAmount,
    refunds: [...order.refunds, fullRefund],
    status: newStatus,
  };
  set((s) => ({
    entries: s.entries.map((o) => (o.id === orderId ? updatedOrder : o)),
  }));
  // Fire destructive notification (banner + email + SMS always)
  // ALSO record edit log entry per Q-9c-3 default A (single audit trail)
  const event = useLiveEventStore.getState().getLiveEvent(order.eventId);
  if (event !== null) {
    const brandName = useCurrentBrandStore.getState().brands.find((b) => b.id === order.brandId)?.displayName ?? "";
    useEventEditLogStore.getState().recordEdit({
      eventId: order.eventId,
      brandId: order.brandId,
      reason: refund.reason,
      severity: "destructive",
      changedFieldKeys: ["__refund__"],
      diffSummary: [allLinesFullyRefunded ? "Order fully refunded" : "Order partially refunded"],
      affectedOrderIds: [orderId],
      orderId,
    });
    void notifyEventChanged(
      {
        eventId: order.eventId,
        eventName: event.name,
        brandName,
        brandSlug: event.brandSlug,
        eventSlug: event.eventSlug,
        reason: refund.reason,
        diffSummary: [allLinesFullyRefunded ? "Refund issued" : "Partial refund issued"],
        severity: "destructive",
        affectedOrderIds: [orderId],
        occurredAt: refundedAt,
      },
      deriveChannelFlags("destructive", false /* webPurchase doesn't matter for destructive */),
    );
  }
  return updatedOrder;
}
```

**`cancelOrder(orderId, reason)`** — sets status + cancelledAt + fires destructive notification:
```ts
cancelOrder: (orderId, reason) => {
  const order = get().entries.find((o) => o.id === orderId);
  if (order === undefined) return null;
  const cancelledAt = new Date().toISOString();
  const updatedOrder: OrderRecord = { ...order, status: "cancelled", cancelledAt };
  set((s) => ({
    entries: s.entries.map((o) => (o.id === orderId ? updatedOrder : o)),
  }));
  // Fire destructive notification + audit log
  const event = useLiveEventStore.getState().getLiveEvent(order.eventId);
  if (event !== null) {
    const brandName = useCurrentBrandStore.getState().brands.find((b) => b.id === order.brandId)?.displayName ?? "";
    useEventEditLogStore.getState().recordEdit({
      eventId: order.eventId,
      brandId: order.brandId,
      reason,
      severity: "destructive",
      changedFieldKeys: ["__cancel__"],
      diffSummary: ["Order cancelled"],
      affectedOrderIds: [orderId],
      orderId,
    });
    void notifyEventChanged(
      {
        eventId: order.eventId,
        eventName: event.name,
        brandName,
        brandSlug: event.brandSlug,
        eventSlug: event.eventSlug,
        reason,
        diffSummary: ["Order cancelled"],
        severity: "destructive",
        affectedOrderIds: [orderId],
        occurredAt: cancelledAt,
      },
      deriveChannelFlags("destructive", false),
    );
  }
  return updatedOrder;
}
```

**`updateLastSeenEventUpdatedAt(orderId, iso)`** — buyer-side acknowledge; does NOT fire notification:
```ts
updateLastSeenEventUpdatedAt: (orderId, iso) => {
  set((s) => ({
    entries: s.entries.map((o) =>
      o.id === orderId ? { ...o, lastSeenEventUpdatedAt: iso } : o,
    ),
  }));
}
```

**`reset()`** — `set({ entries: [] })` — wired into clearAllStores.

#### 3.2.2 `useOrderStore` selector contracts

```ts
getOrdersForEvent: (eventId) => get().entries.filter((o) => o.eventId === eventId),
getOrderById: (orderId) => get().entries.find((o) => o.id === orderId) ?? null,
getSoldCountForEvent: (eventId) => {
  const orders = get().entries.filter((o) => o.eventId === eventId);
  const liveOrders = orders.filter((o) => o.status === "paid" || o.status === "refunded_partial");
  return liveOrders.reduce(
    (sum, o) => sum + o.lines.reduce((s, l) => s + Math.max(0, l.quantity - l.refundedQuantity), 0),
    0,
  );
},
getSoldCountByTier: (eventId) => {
  const orders = get().entries.filter((o) => o.eventId === eventId);
  const liveOrders = orders.filter((o) => o.status === "paid" || o.status === "refunded_partial");
  const out: Record<string, number> = {};
  for (const order of liveOrders) {
    for (const line of order.lines) {
      const live = Math.max(0, line.quantity - line.refundedQuantity);
      if (live === 0) continue;
      out[line.ticketTypeId] = (out[line.ticketTypeId] ?? 0) + live;
    }
  }
  return out;
},
```

#### 3.2.3 `clearAllStores.ts` extension

```ts
import { useOrderStore } from "../store/orderStore";

export const clearAllStores = (): void => {
  useCurrentBrandStore.getState().reset();
  useDraftEventStore.getState().reset();
  useLiveEventStore.getState().reset();
  useEventEditLogStore.getState().reset();
  useOrderStore.getState().reset();  // NEW Cycle 9c — Const #6
};
```

### 3.3 Stub-swap-points (4)

#### 3.3.1 `orderStoreHelpers.ts.getSoldCountContextForEvent` body REWRITE

Signature unchanged. Body replaces TRANSITIONAL stub with live selector composition:

```ts
import { useOrderStore } from "./orderStore";

export const getSoldCountContextForEvent = (event: LiveEvent): SoldCountContext => {
  const soldCountByTier = useOrderStore.getState().getSoldCountByTier(event.id);
  const soldCountForEvent = useOrderStore.getState().getSoldCountForEvent(event.id);
  return { soldCountByTier, soldCountForEvent };
};
```

REMOVE all `[TRANSITIONAL]` markers and EXIT CONDITION comments — cycle is closed.

#### 3.3.2 `liveEventStore.ts:updateLiveEventFields` `affectedOrderIds` populate

Replace literal:
```ts
// OLD:
affectedOrderIds: [],
// NEW:
affectedOrderIds: useOrderStore.getState().getOrdersForEvent(id).map((o) => o.id),
```

(Add `import { useOrderStore } from "./orderStore";` at top of liveEventStore.ts.)

Apply at BOTH call sites — `recordEdit` block + `notifyEventChanged` payload. Same value (selector returns same array reference within a single mutation tick).

#### 3.3.3 `EditPublishedScreen.tsx` `webPurchasePresent` populate

```ts
// OLD:
const webPurchasePresent = false;
// NEW:
const webPurchasePresent = useMemo(
  () =>
    useOrderStore
      .getState()
      .getOrdersForEvent(liveEvent.id)
      .some((o) => o.paymentMethod === "card" || o.paymentMethod === "apple_pay" || o.paymentMethod === "google_pay"),
  [liveEvent.id],
);
```

#### 3.3.4 `EditPublishedScreen.tsx` reject dialog "Open Orders" CTA

Replace toast stub in `buildRejectDialog` `closeAndOpenOrders`:
```ts
// OLD:
const closeAndOpenOrders = (): void => {
  setRejectDialog(null);
  showToast("Orders ledger lands Cycle 9c — your refund flow is coming.");
};
// NEW:
const closeAndOpenOrders = (): void => {
  setRejectDialog(null);
  router.push(`/event/${eventId}/orders` as never);
};
```

(`eventId` is already in scope as `liveEvent.id`.)

#### 3.3.5 `EventListCard.tsx:96` soldCount swap

```ts
// OLD:
const soldCount = 0; // [Cycle 9c] derive from useOrderStore
// NEW:
const soldCount = useOrderStore((s) => s.getSoldCountForEvent(event.id));
```

Same one-line swap for `revenueGbp` (line 97) — sum of `(o.totalGbpAtPurchase - o.refundedAmountGbp)` across paid/refunded_partial orders. Add `getRevenueForEvent(eventId)` selector to useOrderStore.

#### 3.3.6 `EventManageMenu.tsx` Orders + Issue refunds wires

Two transitional toasts replaced with onOpenOrders callback:

```ts
// At lines ~149-155 (Orders action — non-draft):
{
  key: "orders",
  icon: "ticket",
  label: "Orders",
  tone: "default",
  onPress: () => {
    onClose();
    onOpenOrders();  // NEW callback
  },
}

// At lines ~252-257 (Issue refunds action — past events):
{
  key: "issue-refunds",
  icon: "refund",
  label: "Issue refunds",
  tone: "default",
  onPress: () => {
    onClose();
    onOpenOrders();  // SAME callback — past events route to Orders ledger filtered to past
  },
}
```

Add `onOpenOrders: () => void` to `EventManageMenuProps`. Parent's onOpenOrders implementation: `router.push('/event/${eventId}/orders')`.

#### 3.3.7 `app/checkout/[eventId]/confirm.tsx` recordOrder wire

Add ~20-line block immediately after the existing `recordResult(...)` call site (currently in Cycle 8 confirm flow).

```ts
// After cart.recordResult({...}):
const order: OrderRecord = {
  id: result.orderId,
  eventId,
  brandId: event.brandId,
  buyer: {
    name: cart.buyer.name,
    email: cart.buyer.email,
    phone: cart.buyer.phone,
    marketingOptIn: cart.buyer.marketingOptIn,
  },
  lines: cart.lines.map((l) => ({
    ticketTypeId: l.ticketTypeId,
    ticketNameAtPurchase: l.ticketName,
    unitPriceGbpAtPurchase: l.unitPriceGbp,
    isFreeAtPurchase: l.isFree,
    quantity: l.quantity,
    refundedQuantity: 0,
    refundedAmountGbp: 0,
  })),
  totalGbpAtPurchase: result.totalGbp,
  currency: "GBP",
  paymentMethod: result.paymentMethod,
  paidAt: result.paidAt,
  status: "paid",
  refundedAmountGbp: 0,
  refunds: [],
  cancelledAt: null,
  lastSeenEventUpdatedAt: event.updatedAt,
};
useOrderStore.getState().recordOrder(order);  // idempotent dedupe by id
```

### 3.4 Component layer — operator screens

#### 3.4.1 J-M1 Orders list (`app/event/[id]/orders/index.tsx`)

**Pre-flight:** `/ui-ux-pro-max` for the list layout.

Contract per design package `screens-ops.jsx:171-231`:
- Chrome: back arrow + "Orders" title + IconChrome search action (right slot)
- Filter pills: All · Paid · Refunded · Cancelled (per design `["All · 284", "Paid", "Refunded", "Pending"]`; "Pending" is removed since stub mode has no pending state — all orders are "paid" immediately)
- Search input (collapsible — taps search icon expands)
- Order rows (component `OrderListCard.tsx`):
  - Avatar with `hsl((i*47) % 360, 60%, 45%)` bg + buyer initials (oklch translation per memory rule)
  - Buyer name (bold)
  - Subline: `<order ID> · <qty>×<ticket name> · <relative time>`
  - Right-aligned: total amount + status pill (PAID green / REFUNDED red strikethrough / CANCELLED grey strikethrough)
  - Tap row → `/event/${id}/orders/${orderId}`
- Empty state when `orders.length === 0`: "No orders yet" copy + "Share event link" CTA → opens ShareModal
- Loading state: skeleton 3 rows

Filter pill counts: `All · ${orders.length}` · `Paid · ${paidCount}` · `Refunded · ${refundedCount}` · `Cancelled · ${cancelledCount}`. Refunded count includes partial + full.

Search filter: matches buyer name (case-insensitive contains) OR order ID (substring).

**State-handling:**
- Loading: skeleton
- Error: N/A (in-memory store; no async)
- Empty: empty-state copy
- Populated: filtered + sorted orders (newest first)

**Accessibility:**
- Filter pills: `accessibilityRole="button"`, `accessibilityState={{selected: active}}`
- Order rows: `accessibilityLabel` = "Order from {buyerName}, {qty}×{ticket}, {amount}, {status}"

#### 3.4.2 J-M2 Order detail (`app/event/[id]/orders/[oid]/index.tsx`)

**Pre-flight:** `/ui-ux-pro-max` for the detail layout.

Contract per design package `screens-ops.jsx:233-298`:
- Chrome: back arrow + "Order" title
- Hero card (GlassCard elev): avatar (56px hsl) + buyer name (bold 18px) + email (secondary 13px) + status banner (paid green-tint / refunded_full red-tint / refunded_partial orange-tint / cancelled grey-tint)
- Lines table (GlassCard): Order ID (mono) · Tickets (qty × name) · Subtotal · Total · Method
- Method label map: `card` → "Card", `apple_pay` → "Apple Pay", `google_pay` → "Google Pay", `free` → "Free"
- For refunded: show refund ledger sub-section listing each RefundRecord with amount + reason + date
- Primary action button (deterministic per HF-9c-1):
  - `paymentMethod !== "free" && status === "paid"` → "Refund order" (red ghost) → opens RefundSheet
  - `paymentMethod !== "free" && status === "refunded_partial"` → "Refund again" → opens RefundSheet (line-item picker excludes already-fully-refunded lines)
  - `paymentMethod === "free" && status === "paid"` → "Cancel order" (red ghost) → opens ConfirmDialog
  - `status === "refunded_full" || status === "cancelled"` → no primary action; status banner only
- Secondary action: "Resend ticket" (per Q-9c-7: visible when at least one line has `quantity - refundedQuantity > 0`)
- Tertiary: "Copy order ID" (mono ID copy-to-clipboard)

**State-handling:**
- Loading: spinner while order resolves
- Error: order not found → "Couldn't find this order" copy + Back button
- Submitting: refund/cancel button disabled + spinner during 1.2s processing

#### 3.4.3 J-M3 + J-M4 RefundSheet (`components/orders/RefundSheet.tsx`)

**Pre-flight:** `/ui-ux-pro-max` for the sheet layout.

Sheet primitive (snap=full). Two modes via prop `mode: "full" | "partial"`:

**Full mode** (J-M3):
- Title: "Refund £{totalGbp}?"
- Subhead: "Buyer will see refund on their card in 3–5 business days." (stub copy; B-cycle wires real Stripe)
- Single line: "Refund total — £{total}" (bold)
- D-9c-4: NO "Stripe fee retained" line until B-cycle wires real Stripe (Const #9 — no fabricated fee data)
- Required reason input (10..200 chars, multiline TextInput, char counter) per D-9c-9
- Confirm button: destructive variant, "Send refund" with refund icon
- Cancel button: ghost, "Cancel"

**Partial mode** (J-M4) — per Q-9c-1 default A line-item picker:
- Title: "Refund partial?"
- Per-line picker (one row per OrderLineRecord with `quantity - refundedQuantity > 0`):
  - Checkbox + line name + remaining qty + qty stepper (1..maxRefundable)
  - Per-line refund amount auto-computed: `selectedQty × unitPriceGbpAtPurchase`
- Computed total: sum of selected line refund amounts
- Required reason input (same as full)
- Confirm button: destructive variant, "Refund £{computedTotal}"
- Cancel button: ghost

**Shared logic:**
- Confirm onPress: setSubmitting(true) → 1.2s sleep (per Q-9c-8) → call `useOrderStore.recordRefund(orderId, refund)` → setSubmitting(false) → close sheet → toast "Refunded £{amount}"
- recordRefund returns updated OrderRecord with new status — UI auto-rerenders via Zustand subscription

#### 3.4.4 J-M5 Cancel order (per Q-9c-5)

ConfirmDialog "simple" variant + required reason input as a wrapper component:

```
Title: "Cancel this order?"
Description: "{buyerName}'s ticket will be marked invalid. They'll be notified by email."
Reason input: required 10..200 chars
Cancel label: "Keep order"
Confirm label: "Cancel order"
Confirm variant: destructive
```

Confirm onPress: 1.2s sleep → `useOrderStore.cancelOrder(orderId, reason)` → toast "Order cancelled" → router.back to Orders list.

ONLY shown when `paymentMethod === "free" && status === "paid"`.

#### 3.4.5 J-M6 Resend ticket (per Q-9c-7)

Action button on Order detail. Visibility condition:
```ts
const canResend = (order.status === "paid" || order.status === "refunded_partial") &&
  order.lines.some((l) => l.quantity - l.refundedQuantity > 0);
```

Hidden when canResend is false.

onPress flow:
1. setSubmitting(true) → 800ms sleep
2. Construct synthetic NotificationPayload with severity="additive" + reason="Resent ticket" + diffSummary=["Ticket resent"]
3. Call `notifyEventChanged(payload, { banner: false, email: true, sms: false, push: false })` — only email-stub fires; no banner-recorded log noise (this is a one-off direct send)
4. setSubmitting(false) + toast "Sent to {buyer.email}"

NOTE: this DOES NOT log to `useEventEditLogStore` because resends aren't material changes worth audit-logging. Alternative: log with severity="additive" + orderId set for audit completeness — TBD by spec.

**Spec recommendation:** log with severity="additive" + orderId — keeps audit log complete (operator dispute defense).

### 3.5 Component layer — buyer screen (J-M7)

#### 3.5.1 `app/o/[orderId].tsx` (anon-tolerant; outside `(tabs)/`)

**Pre-flight:** `/ui-ux-pro-max` for the buyer-facing layout.

**CRITICAL constraints (HF-9c-5 + I-21):**
- MUST NOT call `useAuth`
- MUST NOT redirect to sign-in
- Reads ONLY from `useOrderStore` + `useLiveEventStore` + `useEventEditLogStore` + `useCurrentBrandStore` (all client-side persisted)

Layout:
- Chrome: minimal (X close → router.back or `/`)
- Material-change banner (`MaterialChangeBanner.tsx`): conditional render when `materialEdits.length > 0` where `materialEdits = useEventEditLogStore.getEditsForEventSince(order.eventId, order.lastSeenEventUpdatedAt).filter(e => e.severity !== "additive")`. Banner shows: "{brandName} updated this event{N > 1 ? ' multiple times' : ''}. Latest reason: '{latestEdit.reason}'." Action: "Got it" → `useOrderStore.updateLastSeenEventUpdatedAt(orderId, latestEdit.editedAt)` per HF-9c-2.
- Hero: event cover + name (live read from LiveEvent) + date line (live)
- Order summary card: order ID (mono) + buyer name + paid date + payment method
- Lines: per OrderLineRecord render `{quantity}× {ticketNameAtPurchase} — £{unitPriceGbpAtPurchase × quantity}` (FROZEN snapshot fields)
- Status banner: paid (green) / refunded_full (red strikethrough total) / refunded_partial (orange + remaining) / cancelled (grey strikethrough)
- QR code (per ticketIds[0] via `buildQrPayload`) — same primitive as confirm.tsx. Hidden when status === "refunded_full" || "cancelled".
- Wallet add row: Apple Wallet + Google Wallet (TRANSITIONAL toast "Coming soon — saved to your account."; same stub as confirm.tsx)
- Refund ledger section (when status involves refunds): list of RefundRecord with amount + reason + date
- "Need help?" footer: contact info from brand (email/phone if set on Brand)

**Lookup pattern:**
```ts
const order = useOrderStore((s) => s.getOrderById(orderId));
const event = useLiveEventStore((s) => order !== null ? s.events.find(e => e.id === order.eventId) ?? null : null);
const brand = useCurrentBrandStore((s) => order !== null ? s.brands.find(b => b.id === order.brandId) ?? null : null);
const materialEdits = useEventEditLogStore((s) =>
  order !== null
    ? s.entries.filter(e =>
        e.eventId === order.eventId &&
        e.editedAt > order.lastSeenEventUpdatedAt &&
        e.severity !== "additive"
      )
    : [],
);
```

**Empty/error states:**
- order === null → "Order not found" + "If you have your confirmation email, the link there is the canonical reference. Contact the organiser if needed."
- event === null (deleted by operator) → "This event was removed by the organiser. Your order details below."
- brand === null (rare) → silently fall back to "the organiser" in copy

#### 3.5.2 `MaterialChangeBanner.tsx` (NEW)

Props:
```ts
interface MaterialChangeBannerProps {
  materialEdits: EventEditEntry[];  // pre-filtered by parent
  brandName: string;
  onAcknowledge: () => void;
}
```

Layout: orange-tinted GlassCard + flag icon + heading + reason quote + "Got it" button.

Heading copy:
```
materialEdits.length === 1 → "Event details changed"
materialEdits.length > 1 → "Event updated {N} times since you last viewed"
```

Body copy:
```
"{brandName} {materialEdits.length === 1 ? 'updated this event' : 'has made several updates'}.
Latest reason: '{latestEdit.reason}'"
```

(latest = `materialEdits[0]` since edit log is newest-first.)

Action: "Got it" → `onAcknowledge()` → parent calls `useOrderStore.updateLastSeenEventUpdatedAt(orderId, latestEdit.editedAt)`.

After acknowledge, banner disappears. Next material edit triggers fresh banner.

### 3.6 Routing

Operator routes (inside `(tabs)/` group inheriting auth):
- `/event/[id]/orders` — J-M1 Orders list
- `/event/[id]/orders/[oid]` — J-M2 Order detail

Buyer route (outside `(tabs)/`, anon-tolerant):
- `/o/[orderId]` — J-M7 buyer order detail

NO useAuth call in `/o/[orderId]` (HF-9c-5 + I-21).

---

## 4 — Success Criteria

Numbered list (continues from ORCH-0704's 0704-AC#49):

| # | Criterion | Verification |
|---|-----------|-------------|
| 9c-AC#1 | Successful checkout records OrderRecord in useOrderStore (idempotent on retry/refresh) | Manual + unit |
| 9c-AC#2 | Operator opens `/event/[id]/orders` → list shows all orders for event with filter pills | Manual |
| 9c-AC#3 | Filter pills work: All shows everything; Paid/Refunded/Cancelled filter accordingly | Manual |
| 9c-AC#4 | Search bar filters by buyer name (case-insensitive) AND order ID substring | Manual |
| 9c-AC#5 | Empty state when no orders for event | Manual |
| 9c-AC#6 | Operator taps order → `/event/[id]/orders/[oid]` Order detail loads with correct buyer + lines + status + frozen financials | Manual |
| 9c-AC#7 | Order detail primary action button = Refund (paid + paymentMethod≠"free") OR Cancel (paid + paymentMethod="free") OR none (refunded_full/cancelled) | Manual |
| 9c-AC#8 | Operator triggers full refund → reason input required → 1.2s processing → toast "Refunded £X" → status flips to "refunded_full" → useOrderStore.refunds[] appended | Manual |
| 9c-AC#9 | Operator triggers partial refund → line-item picker → select line+qty → computed total → reason → confirm → status "refunded_partial" + per-line refundedQuantity updated | Manual |
| 9c-AC#10 | Operator cancels free order → ConfirmDialog → reason → toast → status "cancelled" + cancelledAt set | Manual |
| 9c-AC#11 | Operator resends ticket on paid order → 800ms processing → toast "Sent to {email}" + `[email-stub]` console log fires | Manual + console |
| 9c-AC#12 | Resend button hidden on refunded_full and cancelled orders | Manual |
| 9c-AC#13 | EventListCard `soldCount` displays correct count from useOrderStore (was 0 before) | Manual |
| 9c-AC#14 | EventListCard `revenueGbp` displays correct revenue from useOrderStore | Manual |
| 9c-AC#15 | ORCH-0704 reject dialog "Open Orders" CTA navigates to `/event/[id]/orders` (was toast stub) | Manual |
| 9c-AC#16 | `getSoldCountContextForEvent` returns live counts post-9c (zero stub markers remain) | grep + manual |
| 9c-AC#17 | `EditPublishedScreen.webPurchasePresent` is true when any web-purchase order exists (was hardcoded false) | Manual |
| 9c-AC#18 | `useLiveEventStore.updateLiveEventFields` populates `affectedOrderIds` from useOrderStore (was always empty array) | Manual + console |
| 9c-AC#19 | EventManageMenu Orders + Issue refunds actions navigate (no transitional toasts remain) | Manual |
| 9c-AC#20 | Buyer visits `/o/[orderId]` → page renders with frozen financials + LIVE event displayable info + QR code | Manual |
| 9c-AC#21 | Buyer's order page shows material-change banner when operator made material/destructive edits since last view | Manual |
| 9c-AC#22 | Buyer taps "Got it" on banner → lastSeenEventUpdatedAt advances → banner disappears on next mount | Manual |
| 9c-AC#23 | Buyer's order page does NOT call useAuth or redirect to sign-in (anon-tolerant per I-21) | grep + manual (logged out) |
| 9c-AC#24 | Logout clears useOrderStore (Const #6 — `clearAllStores` wired) | Manual: sign out → entries === [] |
| 9c-AC#25 | recordRefund creates new RefundRecord (never overwrites OrderLineRecord snapshot — I-19) | grep + unit |
| 9c-AC#26 | Refund event fires destructive notification: banner + email-stub + sms-stub all log to console | Manual + console |
| 9c-AC#27 | Cancel event fires destructive notification: banner + email-stub + sms-stub | Manual + console |
| 9c-AC#28 | Refund/cancel events appear in useEventEditLogStore with `orderId` set + severity `"destructive"` | Manual: getEditsForEvent post-refund |
| 9c-AC#29 | I-18 RATIFIED — buyer→founder order persistence verified end-to-end | Smoke pass |
| 9c-AC#30 | I-19 preserved — operator edits LiveEvent (rename tier); existing OrderRecord lines unchanged | Smoke + grep |
| 9c-AC#31 | I-20 preserved + extended — refund/cancel events logged with reason | Manual |
| 9c-AC#32 | I-21 NEW — anon-tolerant buyer route ratified | grep + manual |
| 9c-AC#33 | tsc EXIT=0 across mingla-business workspace | tsc |
| 9c-AC#34 | grep `[TRANSITIONAL]` in `orderStoreHelpers.ts` → zero hits (Cycle 9c removes them) | grep |
| 9c-AC#35 | grep `useAuth` inside `app/o/` → zero hits | grep |
| 9c-AC#36 | grep `oklch(` in mingla-business/src + app → only pre-existing comments in EventCover.tsx | grep |
| 9c-AC#37 | Cycle 8 buyer checkout regression unaffected (recordOrder additive) | Smoke |
| 9c-AC#38 | Cycle 9a manage menu regression: Orders + Issue refunds work post-9c (transitional toasts gone) | Smoke |
| 9c-AC#39 | Cycle 3 wizard create flow regression unchanged | Smoke |
| 9c-AC#40 | ORCH-0704 49 ACs continue passing post-9c (guard rails activate but UX unchanged) | Smoke |

---

## 5 — Invariants

### Preserved
- I-11..I-17 (Mingla Business invariants) — unchanged; useOrderStore is orthogonal
- I-19 (immutable order financials) — preserved via API surface (no updateLine/updateBuyer/updatePrice)
- I-20 (edit reason mandatory + audit log permanence) — preserved + extended (refund/cancel reasons captured)

### Ratified at Cycle 9c CLOSE
- **I-18 — Buyer→founder order persistence** — Cycle 9c implements via useOrderStore + confirm.tsx 1-line wire. Was DRAFT since Cycle 8; ACTIVE post-9c.

### NEW at Cycle 9c CLOSE
- **I-21 — Anon-tolerant buyer routes (mingla-business)**

> Routes outside `(tabs)/` group serving buyer/anon contexts MUST NOT call `useAuth`, MUST NOT redirect to sign-in, and MUST function identically for logged-in and anon users. Reads come from `useOrderStore`, `useLiveEventStore`, `useEventEditLogStore`, `useCurrentBrandStore` (all client-side persisted). Established by Cycle 8 (anon checkout `/checkout/[eventId]/...`) + Cycle 9c (`/o/[orderId]`); applies to Cycle 6+ public surfaces (`/e/[brandSlug]/[eventSlug]`, `/b/[brandSlug]`).

CI gate: grep for `useAuth\b|requireAuth\b` inside `app/{checkout,o,e,b}/**/*.tsx` → zero hits.

---

## 6 — Test Cases

### Operator full refund (T-1 to T-5)
| Test | Scenario | Expected |
|------|----------|----------|
| T-1 | Refund paid order, full amount | recordRefund appends; status="refunded_full"; line.refundedQuantity = quantity; toast |
| T-2 | Refund paid order with reason="abc" (3 chars) | Save button disabled; reason gating |
| T-3 | Refund paid order with reason="" | API returns null; UI prevents call |
| T-4 | Refund order that doesn't exist | recordRefund returns null |
| T-5 | Refund order twice (re-fund) | Both refunds append; total refundedAmountGbp accumulates |

### Operator partial refund (T-6 to T-9)
| Test | Scenario | Expected |
|------|----------|----------|
| T-6 | Pick 1 line of 2, qty 1 of 3 | Computed amount = unitPrice; status="refunded_partial" |
| T-7 | Pick 2 lines fully | All lines refunded; status="refunded_full" |
| T-8 | Pick line where remaining qty = 0 | Line hidden from picker |
| T-9 | Cancel partial refund mid-flow | No state change; modal dismissed |

### Operator cancel free order (T-10 to T-12)
| Test | Scenario | Expected |
|------|----------|----------|
| T-10 | Cancel free order | status="cancelled"; cancelledAt set; destructive notification fires |
| T-11 | Cancel paid order | Cancel button NOT shown (only Refund) |
| T-12 | Cancel cancelled order | Button NOT shown |

### Resend ticket (T-13 to T-15)
| Test | Scenario | Expected |
|------|----------|----------|
| T-13 | Resend on paid order | email-stub fires; toast |
| T-14 | Resend on refunded_full | Button hidden |
| T-15 | Resend on cancelled | Button hidden |

### Cycle 9c stub-swap activation (T-16 to T-22)
| Test | Scenario | Expected |
|------|----------|----------|
| T-16 | Buyer checkouts; operator opens edit | guard rails active (sold>0 → reject) |
| T-17 | EventListCard shows real soldCount | sum of live order qty per event |
| T-18 | Reject dialog "Open Orders" navigates | `/event/[id]/orders` opens |
| T-19 | Notification stack populates affectedOrderIds | Console: payload includes order IDs |
| T-20 | webPurchasePresent populates from useOrderStore | Material edit fires SMS-stub when web orders exist |
| T-21 | EventManageMenu Orders action navigates | `/event/[id]/orders` opens |
| T-22 | Past event Issue refunds action navigates | Same route |

### Buyer order detail (T-23 to T-30)
| Test | Scenario | Expected |
|------|----------|----------|
| T-23 | Buyer visits valid `/o/[orderId]` | Page renders with frozen financials |
| T-24 | Operator edits event after order; buyer revisits | Material-change banner shows |
| T-25 | Buyer taps "Got it" | lastSeenEventUpdatedAt advances; banner gone |
| T-26 | Buyer revisits with no new edits | No banner |
| T-27 | Buyer visits `/o/[invalid_id]` | "Order not found" empty state |
| T-28 | Buyer page logged-OUT | Renders identically; no auth redirect |
| T-29 | Operator deletes event after buyer's order | "Event was removed" copy |
| T-30 | Order is fully-refunded | QR hidden; refund ledger shown |

### Regression (T-R1 to T-R5)
| T-R1 | ORCH-0704 49 ACs continue passing | Smoke |
| T-R2 | Cycle 8 checkout completes | Smoke |
| T-R3 | Cycle 9a manage menu | Smoke |
| T-R4 | Cycle 9b-1 lifecycle | Smoke |
| T-R5 | Cycle 3 wizard create | Smoke |

---

## 7 — Implementation Order

Strictly sequential, tsc verify between major phases:

### Phase 1 — Schema + store
1. CREATE `mingla-business/src/store/orderStore.ts` per §3.1.1 + §3.2.1 + §3.2.2
2. MOD `mingla-business/src/store/eventEditLogStore.ts` — extend `EditSeverity` with `"destructive"`; add optional `orderId?` field on `EventEditEntry`
3. MOD `mingla-business/src/services/eventChangeNotifier.ts` — extend `deriveChannelFlags` for `"destructive"`; extend `composeEmailPayload` + `composeSmsPayload` with destructive copy branch
4. MOD `mingla-business/src/utils/clearAllStores.ts` — add `useOrderStore.reset()` line

### Phase 2 — Activate ORCH-0704 stubs
5. MOD `mingla-business/src/store/orderStoreHelpers.ts` — REWRITE body (signature stable); remove TRANSITIONAL markers
6. MOD `mingla-business/src/store/liveEventStore.ts:updateLiveEventFields` — replace `affectedOrderIds: []` literal at both call sites
7. MOD `mingla-business/src/components/event/EditPublishedScreen.tsx` — replace `webPurchasePresent: false` literal + replace "Open Orders" toast with router.push

### Phase 3 — Cross-cycle wires
8. MOD `mingla-business/app/checkout/[eventId]/confirm.tsx` — add ~20-line recordOrder block after recordResult
9. MOD `mingla-business/src/components/event/EventListCard.tsx:96` — replace soldCount + revenueGbp stubs
10. MOD `mingla-business/src/components/event/EventManageMenu.tsx` — add `onOpenOrders` prop; replace 2 transitional toasts; thread the prop through parents (events tab + EventDetail)

### Phase 4 — Operator screens
11. CREATE `mingla-business/src/components/orders/OrderListCard.tsx` (J-M1 row)
12. CREATE `mingla-business/app/event/[id]/orders/index.tsx` (J-M1)
13. CREATE `mingla-business/src/components/orders/RefundSheet.tsx` (J-M3 + J-M4)
14. CREATE `mingla-business/app/event/[id]/orders/[oid]/index.tsx` (J-M2 with J-M3/J-M5/J-M6 actions wired)
15. Wire J-M2's resend button + cancel-order ConfirmDialog wrapper

### Phase 5 — Buyer screen
16. CREATE `mingla-business/src/components/orders/MaterialChangeBanner.tsx` (J-M7 banner)
17. CREATE `mingla-business/app/o/[orderId].tsx` (J-M7 buyer detail)

### Phase 6 — Verify
18. tsc --noEmit → EXIT=0
19. grep `[TRANSITIONAL]` in orderStoreHelpers.ts → zero
20. grep `useAuth` in `app/o/` + `app/checkout/` + `app/e/` + `app/b/` → zero (I-21 CI gate)
21. grep `oklch(` → only pre-existing EventCover comments
22. grep `Orders ledger lands Cycle 9c` and `Refund ops land Cycle 9c` → zero (transitional toasts removed)
23. Manual smoke per ACs

---

## 8 — Regression Prevention

### Structural safeguards
1. **API surface enforcement** — useOrderStore exposes only recordOrder + recordRefund + cancelOrder + updateLastSeenEventUpdatedAt + reset (no updateLine/updateBuyer/updatePrice). I-19 baked in.
2. **Idempotent recordOrder** — dedupe by id; write-once snapshots cannot be re-overwritten.
3. **Anon-tolerant route discipline** — I-21 + CI grep gate prevents future regressions in `/o/`, `/checkout/`, `/e/`, `/b/`.
4. **Severity exhaustive switch** — TypeScript catches unhandled tags in `deriveChannelFlags`.
5. **TRANSITIONAL label removal** — orderStoreHelpers stub markers REMOVED at Cycle 9c CLOSE; replaced with permanent comments documenting the live wiring.
6. **Status flips computed from refund aggregates** — operator can't directly setStatus; status is a derived field.

### Protective comments
- `orderStore.ts` header: "Per ORCH-0704 SPEC v2 §3.1.5 + Cycle 9c spec §3.1.1. I-19 enforced via API surface (no updateLine/updateBuyer/updatePrice)."
- `confirm.tsx` recordOrder block: "// Per Cycle 9c spec §3.3.7 — buyer→founder order persistence (I-18). Idempotent dedupe by orderId."
- `app/o/[orderId].tsx` header: "Anon-tolerant per I-21 + memory rule `feedback_anon_buyer_routes`. NO useAuth call. Reads from client-persisted stores only."

### Test that catches regression
Unit test: `recordRefund` on fully-refunded order should not double-refund (line.refundedQuantity should not exceed line.quantity).

---

## 9 — Decisions to log

When Cycle 9c closes:

### DEC-088 — Buyer-side order detail page + audit log unification

Date: 2026-05-02 (steering); ratify on tester PASS.

Locks:
1. Buyer route `/o/[orderId]` outside `(tabs)/`, anon-tolerant per I-21
2. Material-change banner reads from `useEventEditLogStore.getEditsForEventSince(eventId, order.lastSeenEventUpdatedAt)` filtered to `severity !== "additive"`
3. Refund/cancel events logged to SAME `useEventEditLogStore` (not separate sibling store) with optional `orderId?` field per Q-9c-3 default A
4. NEW `EditSeverity` value `"destructive"` (refund/cancel) → notification stack fires banner + email + SMS ALWAYS regardless of webPurchasePresent
5. Stripe-fee-retained line in J-M3 RefundSheet OMITTED until B-cycle wires real Stripe (Const #9)
6. Refund partial UX = line-item picker (not amount slider) per Q-9c-1 default A

Rationale: operator decision 2026-05-02 (Q-9c-1..8 all defaults A). Single audit trail keeps banner consumer simple; destructive severity tag carries the heavier signal weight refund/cancel demands.

Alternatives considered:
- Refund partial = amount slider — rejected (audit trail less specific)
- Separate useOrderEventLogStore — rejected (two streams complicate banner; single store with optional orderId is the canonical pattern)
- `severity: "material"` for refund/cancel — rejected (SMS gating on webPurchase too restrictive when money has actually moved)

### I-18 ratify, I-21 ratify

I-18 (DRAFT → ACTIVE): buyer→founder order persistence — implemented in Cycle 9c.
I-21 (NEW): anon-tolerant buyer routes — codified at Cycle 9c CLOSE.

---

## 10 — File touch matrix

| File | Action | LOC est |
|------|--------|---------|
| `mingla-business/src/store/orderStore.ts` | NEW | ~280 |
| `mingla-business/src/store/eventEditLogStore.ts` | MOD | +12 (severity union + optional orderId) |
| `mingla-business/src/services/eventChangeNotifier.ts` | MOD | +60 (destructive branch in deriveChannelFlags + composers) |
| `mingla-business/src/store/orderStoreHelpers.ts` | REWRITE | -18 / +12 (live impl; TRANSITIONAL markers removed) |
| `mingla-business/src/store/liveEventStore.ts` | MOD | +6 (affectedOrderIds populate; useOrderStore import) |
| `mingla-business/src/utils/clearAllStores.ts` | MOD | +2 |
| `mingla-business/app/checkout/[eventId]/confirm.tsx` | MOD | +25 (recordOrder block) |
| `mingla-business/src/components/event/EventListCard.tsx` | MOD | +4 (soldCount + revenueGbp swaps) |
| `mingla-business/src/components/event/EventManageMenu.tsx` | MOD | +5 / -8 (onOpenOrders prop; remove transitional toasts) |
| `mingla-business/app/event/[id]/index.tsx` | MOD | +6 (Orders entry-point wire) |
| `mingla-business/app/(tabs)/events.tsx` | MOD | +6 (onOpenOrders thread-through) |
| `mingla-business/src/components/event/EditPublishedScreen.tsx` | MOD | +6 / -4 (webPurchasePresent + Open Orders router.push) |
| `mingla-business/src/components/orders/OrderListCard.tsx` | NEW | ~140 |
| `mingla-business/src/components/orders/RefundSheet.tsx` | NEW | ~380 (full + partial mode + reason input) |
| `mingla-business/src/components/orders/MaterialChangeBanner.tsx` | NEW | ~80 |
| `mingla-business/app/event/[id]/orders/index.tsx` | NEW | ~250 |
| `mingla-business/app/event/[id]/orders/[oid]/index.tsx` | NEW | ~350 |
| `mingla-business/app/o/[orderId].tsx` | NEW | ~280 |
| **Net** | | ~+1900 / -30 (~+1870 net) |

6 NEW + 8 MOD + 1 REWRITE-body. ~+1870 LOC net (slightly higher than ORCH-0704's ~+1180 — primarily because of two new full screens + two new sheets vs ORCH-0704's one screen).

---

## 11 — Constraints

Memory rules in force (verify implementor honors):
- `feedback_keyboard_never_blocks_input` — RefundSheet's amount/reason input + orders search input + reason input on Cancel must stay above keyboard (Cycle 3 wizard pattern)
- `feedback_rn_color_formats` — hsl/hex only; design package's `oklch()` for buyer avatars MUST translate to `hsl(hue, 60%, 45%)`
- `feedback_toast_needs_absolute_wrap` (REVISED 2026-05-02) — Toast self-positions via Modal portal; no toastWrap
- `feedback_anon_buyer_routes` — `/o/[orderId]` outside `(tabs)/`, MUST NOT call useAuth (I-21 codifies)
- `feedback_back_listener_disarm_pattern` — buyer order detail has no back-block requirement (it's a destination, not a flow)
- `feedback_implementor_uses_ui_ux_pro_max` — implementor MUST run `/ui-ux-pro-max` for: J-M1 Orders list, J-M2 Order detail, J-M3+J-M4 RefundSheet, J-M7 buyer order detail page, MaterialChangeBanner
- `feedback_short_responses` — chat reply ≤ 20 lines, all detail in this spec file
- `feedback_no_summary_paragraph` — implementor's chat reply has no summary paragraph

Constitution honored:
- #1 No dead taps — every list row, action button, banner CTA wired
- #2 One owner per truth — OrderRecord in useOrderStore; LiveEvent canonical for displayable; EventEditEntry single audit trail (extended for orderId)
- #3 No silent failures — recordRefund/cancelOrder return discriminated unions; UI surfaces every reject path
- #6 Logout clears — useOrderStore.reset wired into clearAllStores
- #7 TRANSITIONAL labels — Cycle 9c REMOVES ORCH-0704's stub markers; email/SMS/push notification stubs remain TRANSITIONAL until B-cycle / consumer-app
- #8 Subtract before adding — TRANSITIONAL markers removed BEFORE live impl ships
- #9 No fabricated data — never seed fake orders; useOrderStore starts empty; Stripe-fee-retained line OMITTED
- #10 Currency-aware UI — currency: "GBP" frozen on order; refund flow uses formatGbp helpers
- #11 One auth instance — operator routes inherit (tabs)/ auth; buyer route is anon-tolerant by design

---

## 12 — Open questions for orchestrator (resolved unless deviation flagged)

All 8 Q-9c questions resolved per operator's 2026-05-02 answers (all defaults A). No new questions surface from forensics. Spec assumes accepted.

If operator wants to flip any:
- Q-9c-1 → amount slider: spec §3.4.3 RefundSheet partial mode rewrites
- Q-9c-2 → severity="material": spec §3.1.3 + §3.2.1 deriveChannelFlags reverts; SMS gates on webPurchasePresent
- Q-9c-3 → separate sibling store: spec §3.1.2 + §3.2.1 splits log; banner consumer in §3.5.2 reads from new store
- Q-9c-4 → different route path: spec §3.6 + §3.5.1 path swaps
- Q-9c-6 → scroll-to-end before tap: §3.5.2 banner adds scroll detection
- Q-9c-7 → always allowed: §3.4.5 Resend visibility condition simplifies

---

## 13 — Implementor dispatch readiness

Spec is implementor-ready WHEN orchestrator REVIEW returns APPROVED.

Implementor pre-flight reading list:
1. This v2 spec
2. Investigation report (companion file)
3. ORCH-0704 SPEC v2 §3.1.5 (canonical OrderRecord shape)
4. ORCH-0704 implementation report §12 (Cycle 9c handoff notes)
5. Cycle 8 confirm.tsx + CartContext
6. Existing useEventEditLogStore + eventChangeNotifier (extending)
7. EventListCard (line 96 swap-point)
8. EventManageMenu (lines 149-155 + 252-257 swap-points)
9. EditPublishedScreen (webPurchasePresent + buildRejectDialog swap-points)
10. Memory rule `feedback_anon_buyer_routes`
11. Design package `screens-ops.jsx:171-298` + `screens-extra.jsx:175-211`

Pre-implementation checklist:
- [ ] Read all 11 files
- [ ] Run `/ui-ux-pro-max` for J-M1, J-M2, RefundSheet, MaterialChangeBanner, buyer order detail page
- [ ] Verify ORCH-0704's 49 ACs pre-implementation (regression baseline)
- [ ] Begin in order: schema/types/stores → stub-swaps → cross-cycle wires → operator screens → buyer screen → verify

---

## 14 — Cross-references

- Investigation: [INVESTIGATION_BIZ_CYCLE_9c_ORDERS_OPS.md](../reports/INVESTIGATION_BIZ_CYCLE_9c_ORDERS_OPS.md)
- Dispatch: [FORENSICS_SPEC_BIZ_CYCLE_9c_ORDERS_OPS.md](../prompts/FORENSICS_SPEC_BIZ_CYCLE_9c_ORDERS_OPS.md)
- Backward dependency: [SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_v2.md](SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_v2.md) §3.1.5 (canonical OrderRecord)
- Cycle 9 master spec (J-M sections obsolete-on-close per D-9c-3): [SPEC_BIZ_CYCLE_9_EVENT_MANAGEMENT.md](SPEC_BIZ_CYCLE_9_EVENT_MANAGEMENT.md)
- Forward dependency: B-cycle (real Stripe + Resend + Twilio); ORCH-0705 (no-show + post-event ops; deferred until post-Stripe)
- Memory rules: feedback_anon_buyer_routes, feedback_rn_color_formats, feedback_keyboard_never_blocks_input, feedback_implementor_uses_ui_ux_pro_max
