# Investigation — BIZ Cycle 9c — Orders ops + useOrderStore + buyer order detail

**Date:** 2026-05-02
**Author:** mingla-forensics
**Mode:** INVESTIGATE-THEN-SPEC (this file = investigation; spec = [SPEC_BIZ_CYCLE_9c_ORDERS_OPS.md](../specs/SPEC_BIZ_CYCLE_9c_ORDERS_OPS.md))
**Confidence:** HIGH
**Closes:** 6 net-new operator journeys (J-M1..J-M6) + 4 of 8 ORCH-0704 forward-handoff stubs + Cycle 9 HF-4 (soldCount derivation)
**Backward dependency:** ORCH-0704 v2 (CLOSED grade A 2026-05-02) — Cycle 9c MUST NOT regress its 49 ACs

---

## 1 — Charter

ORCH-0704 v2 shipped operator-side full edit-after-publish + buyer-protection guard rails + reason audit + 4-channel notification stack. It left 4 forward-handoff stubs (D-704-IMPL-3 through D-704-IMPL-10 in implementation report) and depends on a `useOrderStore` that doesn't exist yet — so guard rails are dormant (`getSoldCountByTier` returns zeros) and the buyer-side material-change banner has no rendering surface.

Cycle 9c builds:
1. NEW `useOrderStore` per ORCH-0704 SPEC v2 §3.1.5 OrderRecord shape (canonical, no drift)
2. 1-line wire from `confirm.tsx` recording each successful checkout
3. 4 stub-swaps that activate ORCH-0704's guard rails + notification population
4. 6 operator journeys (J-M1 Orders list · J-M2 Order detail · J-M3 Refund full · J-M4 Refund partial · J-M5 Cancel order · J-M6 Resend ticket)
5. NEW buyer order detail page at `/o/[orderId]` (anon-tolerant, outside `(tabs)/`) with material-change banner reading from `useEventEditLogStore.getEditsForEventSince`
6. EventListCard `soldCount` derivation (Cycle 9 HF-4 closure)

After this cycle: 8 of 8 Cycle 9 journeys delivered. Mingla Business operator product feature-complete for the event lifecycle (create → publish → edit → orders → refund → cancel).

---

## 2 — Investigation Manifest

| # | File | Why |
|---|------|-----|
| 1 | `Mingla_Artifacts/specs/SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_v2.md` §3.1.5 | OrderRecord/OrderLineRecord/BuyerSnapshot/RefundRecord shapes — CANONICAL for this cycle |
| 2 | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_REPORT.md` §12 | Cycle 9c handoff notes — 8 forward-handoff stubs documented |
| 3 | `Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_9_EVENT_MANAGEMENT.md` §3 OBS-3 + §3 HF-4 + Q-9-2 | Cycle 9 master forensics — OrderStore option B + soldCount derivation + design-package coverage map |
| 4 | `Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_9_EVENT_MANAGEMENT.md` §3 J-M | Cycle 9 master spec — J-M1..J-M6 journey contracts |
| 5 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` (top) | I-19 + I-20 ratified 2026-05-02; Cycle 9c ratifies I-18 (DRAFT → ACTIVE) |
| 6 | `Mingla_Artifacts/DECISION_LOG.md` (top) | DEC-087 (full-edit + buyer protection); operator's Q-9c-1..8 defaults all locked A |
| 7 | `mingla-business/src/components/checkout/CartContext.tsx` | OrderResult + CartLine + BuyerDetails shapes — input to recordOrder |
| 8 | `mingla-business/app/checkout/[eventId]/confirm.tsx` lines 76-78 + 130-145 | recordOrder wire-point (after existing recordResult call) |
| 9 | `mingla-business/src/utils/stubOrderId.ts` | generateOrderId + buildQrPayload — carry forward to 9c (B3 swaps for signed JWTs) |
| 10 | `mingla-business/src/store/orderStoreHelpers.ts` (full) | TRANSITIONAL stub body — Cycle 9c rewrites to live selectors (signature stable) |
| 11 | `mingla-business/src/store/eventEditLogStore.ts` (full) | NEW from ORCH-0704; Cycle 9c extends with optional `orderId?` field per Q-9c-3 default |
| 12 | `mingla-business/src/store/liveEventStore.ts:updateLiveEventFields` (lines ~410-430) | `affectedOrderIds: []` literal — Cycle 9c populates |
| 13 | `mingla-business/src/components/event/EditPublishedScreen.tsx` (`webPurchasePresent: false` literal + reject dialog "Open Orders" CTA) | 2 stub-swap-points |
| 14 | `mingla-business/src/components/event/EventListCard.tsx:96` | `const soldCount = 0; // [Cycle 9c] derive from useOrderStore` — explicit swap-point |
| 15 | `mingla-business/src/components/event/EventManageMenu.tsx:149-155 + 252-257` | Two TRANSITIONAL toasts: "Orders ledger lands Cycle 9c." + "Refund ops land Cycle 9c." — both removed in 9c |
| 16 | `Mingla_Artifacts/design-package/mingla-business-app-screens/project/screens-ops.jsx:171-298` | OrdersScreen + OrderDetailScreen + Row component — DESIGN-PACKAGE-FULL for J-M1 + J-M2 |
| 17 | `Mingla_Artifacts/design-package/mingla-business-app-screens/project/screens-extra.jsx:175-211` | RefundSheet — DESIGN-PACKAGE-FULL for J-M3 (full refund); J-M4 partial NOT covered (forensics designs) |
| 18 | `mingla-business/src/components/ui/Sheet.tsx` | snapPoint contract; portal-correct (DEC-085); reused for refund sheets |
| 19 | `mingla-business/src/components/ui/ConfirmDialog.tsx` | simple variant for cancel-order confirmation |
| 20 | `mingla-business/src/components/ui/Avatar.tsx` (DEC-083) | Buyer initials in J-M1 row |
| 21 | `mingla-business/app/event/[id]/index.tsx` | Cycle 9a Event Detail — Cycle 9c adds nav entry to Orders ledger from KPI/manage menu |
| 22 | `mingla-business/src/utils/clearAllStores.ts` | Wire-point for `useOrderStore.reset` (Const #6) |
| 23 | `mingla-business/src/utils/currency.ts` | formatGbp / formatGbpRound for refund/order amount rendering |
| 24 | Memory rule `feedback_anon_buyer_routes.md` | Buyer route `/o/[orderId]` outside `(tabs)/`, no useAuth |

---

## 3 — Findings

### 🔵 OBS-9c-1 — OrderRecord shape buildable from cart layer with zero gaps

**File:** `mingla-business/src/components/checkout/CartContext.tsx` lines 34-67 (CartLine + BuyerDetails + OrderResult interfaces).

Cross-checked every field of ORCH-0704 SPEC v2 §3.1.5 OrderRecord against current cart state:

| OrderRecord field | Source | Status |
|-------------------|--------|--------|
| `id` | `result.orderId` | ✅ |
| `eventId` | route param `eventId` | ✅ |
| `brandId` | `event.brandId` from `useLiveEventStore.events.find(e => e.id === eventId)` | ✅ |
| `buyer.name` | `cart.buyer.name` | ✅ |
| `buyer.email` | `cart.buyer.email` | ✅ |
| `buyer.phone` | `cart.buyer.phone` (empty string if not provided) | ✅ |
| `buyer.marketingOptIn` | `cart.buyer.marketingOptIn` | ✅ |
| `lines[i].ticketTypeId` | `cart.lines[i].ticketTypeId` | ✅ |
| `lines[i].ticketNameAtPurchase` | `cart.lines[i].ticketName` (snapshot at selection per Cycle 8) | ✅ |
| `lines[i].unitPriceGbpAtPurchase` | `cart.lines[i].unitPriceGbp` (snapshot per Cycle 8) | ✅ |
| `lines[i].isFreeAtPurchase` | `cart.lines[i].isFree` (snapshot per Cycle 8) | ✅ |
| `lines[i].quantity` | `cart.lines[i].quantity` | ✅ |
| `lines[i].refundedQuantity` | literal `0` at insertion | ✅ |
| `lines[i].refundedAmountGbp` | literal `0` at insertion | ✅ |
| `totalGbpAtPurchase` | `result.totalGbp` | ✅ |
| `currency` | literal `"GBP"` (per Const #10 + Cycle 8 frozen UK currency) | ✅ |
| `paymentMethod` | `result.paymentMethod` (CheckoutPaymentMethod) | ✅ |
| `paidAt` | `result.paidAt` | ✅ |
| `status` | literal `"paid"` at insertion (free orders also "paid" with totalGbp=0 — semantically "completed") | ✅ |
| `refundedAmountGbp` | literal `0` | ✅ |
| `refunds` | literal `[]` | ✅ |
| `cancelledAt` | literal `null` | ✅ |
| `lastSeenEventUpdatedAt` | `event.updatedAt` (current value at confirmation entry — prevents stale banner on first view) | ✅ |

**Implication:** the 1-line claim in ORCH-0704 dispatch is structurally accurate, BUT the constructor is genuinely ~20 lines (object literal expansion). Spec §3.6 will note this — not a blocker, just truthful labeling.

### 🔵 OBS-9c-2 — Idempotency strategy required for `recordOrder`

**File:** `mingla-business/app/checkout/[eventId]/confirm.tsx` lines 91-105 (beforeRemove guard) + lines 107-137 (popstate guard).

Confirmation screen mounts ONCE per buyer session, but cart state IS preserved on tab refresh (in-memory React Context). The `result` populated by Cycle 8 is only persisted INSIDE CartContext for the session. If the buyer:
1. Completes checkout → confirm.tsx mounts → recordOrder fires → OrderRecord created
2. Refreshes the tab → CartContext resets → result is null → defensive useEffect bounces to `/checkout/{eventId}` → cart is empty → no second record

So in stub mode, idempotency violation is unlikely. BUT the spec MUST require `recordOrder` to dedupe by orderId (`getOrderById(orderId)` check) because:
- Cycle 9c implementor might add a re-render path that re-fires the effect
- Future B-cycle webhook recovery flow may attempt to re-create
- I-19 immutable-snapshot guarantee depends on write-once semantics

Spec contract: `recordOrder` checks `getOrderById(id)`. If exists, returns the existing record without overwriting. If absent, appends.

### 🔵 OBS-9c-3 — soldCount derivation is straightforward

**File:** `mingla-business/src/components/event/EventListCard.tsx:96`
**Code:** `const soldCount = 0; // [Cycle 9c] derive from useOrderStore`
**Cycle 9c swap:** `const soldCount = useOrderStore((s) => s.getSoldCountForEvent(event.id));`

`getSoldCountForEvent(eventId)` selector logic per ORCH-0704 SPEC v2 §3.6:
```ts
const orders = state.entries.filter(o => o.eventId === eventId);
const liveOrders = orders.filter(o => o.status === "paid" || o.status === "refunded_partial");
return liveOrders.reduce((sum, o) =>
  sum + o.lines.reduce((s, l) => s + Math.max(0, l.quantity - l.refundedQuantity), 0),
  0,
);
```

Same pattern as `getSoldCountContextForEvent` already specified for ORCH-0704 swap-point. Single source of truth.

### 🔵 OBS-9c-4 — DESIGN-PACKAGE-FULL coverage for J-M1 + J-M2 + J-M3

**Files verified:**
- `screens-ops.jsx:171-231` — OrdersScreen with filter pills + Row layout (avatar + buyer name + order ID + qty×ticket + time + amount + status pill) + `oklch()` avatar bg
- `screens-ops.jsx:233-298` — OrderDetailScreen with hero (avatar + name + email) + status banner (paid/refunded) + lines table + Refund button
- `screens-extra.jsx:175-211` — RefundSheet (full refund) with computed total + Stripe-fee-retained line + destructive Send refund button + Cancel ghost

**oklch translation rule (memory `feedback_rn_color_formats`):** screens-ops.jsx:211 `background: oklch(0.5 0.15 ${(i*47) % 360})` → spec MUST translate to `hsl(${(i*47) % 360}, 60%, 45%)` per EventCover pattern.

**J-M4 PARTIAL refund: NOT covered in design package.** Forensics designs per Q-9c-1 default A — line-item picker (checkbox per OrderLineRecord with qty stepper, total auto-computed).

**J-M5 + J-M6: silent in design package.** Forensics designs:
- J-M5 Cancel order: ConfirmDialog "simple" variant per Q-9c-5 default (paymentMethod === "free" only).
- J-M6 Resend ticket: action button on OrderDetail → 800ms processing → toast "Sent to {email}" + fires `notifyEventChanged` with severity "additive".

### 🔵 OBS-9c-5 — Notification stack reuse strategy verified

**File:** `mingla-business/src/services/eventChangeNotifier.ts` (NEW from ORCH-0704). Channels: banner + email + sms + push (push always false in ORCH-0704 stub).

Per Q-9c-2 default A: introduce NEW severity tag `"destructive"` (refund/cancel events). `deriveChannelFlags` extension: `severity === "destructive"` fires banner + email + SMS ALWAYS regardless of `hasWebPurchaseOrders` (because money moved — buyer needs all signals).

Per Q-9c-3 default A: `useEventEditLogStore` extends with optional `orderId?: string` field. When set, the entry was order-level (refund/cancel/resend). Single audit trail per event.

`EditSeverity` union extends from `"additive" | "material"` to `"additive" | "material" | "destructive"`. Backward-compat: ORCH-0704's `classifySeverity` always returns `"additive"` or `"material"`; only Cycle 9c's order-level mutations emit `"destructive"`.

### 🟡 HF-9c-1 — Free vs paid order action disambiguation must be deterministic

**File:** `mingla-business/src/components/checkout/CartContext.tsx:52` — `CheckoutPaymentMethod = "card" | "apple_pay" | "google_pay" | "free"`.

J-M2 Order detail's primary action button MUST switch based on `order.paymentMethod`:
- `paymentMethod === "free"` → "Cancel order" button (J-M5)
- `paymentMethod !== "free"` → "Refund order" button (J-M3) which opens partial/full chooser (J-M4 enters via "Partial refund" sub-action)

Confirmed Q-9-8 from Cycle 9 forensics + Q-9c-5 default `correct`. Spec encodes deterministic button-switching logic.

**Why hidden flaw:** if implementor reflexively shows BOTH buttons or wrong button, organiser confusion + accidental misuse. Spec is explicit.

### 🟡 HF-9c-2 — `lastSeenEventUpdatedAt` advance semantic must be precise

**Files:** new `useOrderStore.updateLastSeenEventUpdatedAt(orderId, isoTimestamp)` mutation + buyer order detail page banner consumer.

Per Q-9c-6 default A — single-tap "Got it" advances. The exact value advanced TO matters:
- WRONG: advance to `Date.now()` — would mark all future edits stale until buyer revisits
- CORRECT: advance to `latestEdit.editedAt` — buyer is acknowledging UP TO this specific edit; new edits AFTER `latestEdit.editedAt` will trigger fresh banner

Spec contract: `lastSeenEventUpdatedAt = latestEdit.editedAt` where `latestEdit` is the most recent entry from `getEditsForEventSince`.

### 🟡 HF-9c-3 — Resend ticket eligibility must check live order status

**File:** new J-M6 action handler.

Per Q-9c-7 default A: allowed for `status === "paid" || status === "refunded_partial"`; hidden for `"refunded_full" || "cancelled"`.

Logic: only show Resend button when at least one OrderLineRecord has `quantity - refundedQuantity > 0`. The button is computed live from order state — no separate flag.

### 🟡 HF-9c-4 — `useOrderStore` partialize must NOT serialize selectors

**File:** new `mingla-business/src/store/orderStore.ts`

Standard Zustand persist gotcha: if `partialize` returns `{ entries }` only, selectors reconstruct cleanly on rehydrate. If it accidentally serializes the full state (including computed getters), the rehydrated store may have stale or duplicated logic. Spec explicitly: `partialize: (s) => ({ entries: s.entries })` — selectors regenerate.

Same pattern as `useEventEditLogStore` (already proven in ORCH-0704).

### 🟡 HF-9c-5 — Anon-tolerant route must NOT trigger AuthContext

**File:** new `mingla-business/app/o/[orderId].tsx`

Per memory rule `feedback_anon_buyer_routes` — buyer routes outside `(tabs)/` MUST NOT call `useAuth` or trigger any sign-in redirect. The route handler reads `useOrderStore` + `useLiveEventStore` only. If the buyer doesn't have an account at all (default for stub mode), the page renders identically to a logged-in operator viewing the same URL.

This is critical because: shared order URLs go to friends/family who may not have Mingla accounts. Forcing sign-in breaks the share-link UX.

Spec: route handler explicitly avoids `useAuth`. Document as protected behavior. Recommend ratifying as I-21 (anon-tolerant route discipline) on close.

### 🟠 CF-9c-1 — Material-change banner depends on Cycle 9c building the surface AND ORCH-0704 already populating the audit log

**File:** banner consumer in new `mingla-business/app/o/[orderId].tsx`.

ORCH-0704 already populates `useEventEditLogStore` with every edit (additive + material). Cycle 9c only ADDS the rendering surface — it does NOT need to retroactively populate. Banner reads `getEditsForEventSince(eventId, order.lastSeenEventUpdatedAt)` filtered to `severity !== "additive"`.

For orders created BEFORE ORCH-0704 lived (none, because both shipped 2026-05-02), `lastSeenEventUpdatedAt` would be unset. Defensive: spec sets `lastSeenEventUpdatedAt = event.updatedAt` at recordOrder time (= confirmation entry time) — guarantees no stale banner on first view of a fresh order.

**Why contributing factor (not root cause):** the rendering surface IS the missing piece; Cycle 9c builds it. No timing race because both stores rehydrate on app start.

---

## 4 — Field-by-field useOrderStore mutation contract

| Mutation | Inputs | Effect | I-19 enforced? |
|----------|--------|--------|----------------|
| `recordOrder(payload)` | full OrderRecord shape | Idempotent (dedupe by id); appends entries[]; returns existing if id present | YES — write-once on snapshot fields |
| `recordRefund(orderId, refund)` | RefundRecord (no id, no refundedAt — store generates) | Appends to order.refunds[]; updates order.refundedAmountGbp aggregate; per-line refundedQuantity + refundedAmountGbp updated; status flips to "refunded_full" or "refunded_partial" based on remaining live qty; FIRES `notifyEventChanged` with severity="destructive" | YES — never overwrites snapshot fields |
| `cancelOrder(orderId, reason)` | reason string | Sets status="cancelled", cancelledAt=now; FIRES `notifyEventChanged` with severity="destructive" | YES |
| `updateLastSeenEventUpdatedAt(orderId, iso)` | orderId + ISO timestamp | Updates only the lastSeenEventUpdatedAt field (buyer acknowledge); does NOT fire notification | YES — only touches buyer-side tracking field |
| `reset()` | none | `set({ entries: [] })` for logout | N/A |

NO `updateLine`, NO `updateBuyer`, NO `updatePrice`, NO `setStatus` (status flips computed from refund aggregates). I-19 enforcement at API surface.

Selectors:
- `getOrdersForEvent(eventId): OrderRecord[]` — newest first
- `getOrderById(orderId): OrderRecord | null`
- `getSoldCountForEvent(eventId): number` — sum of (quantity - refundedQuantity) across paid/partial orders
- `getSoldCountByTier(eventId): Record<string, number>` — same logic, grouped by ticketTypeId
- `getOrdersForBrand(brandId): OrderRecord[]` — for Account/Brand-level revenue (out of 9c scope but useful)

---

## 5 — Five-Layer Cross-Check

| Layer | State |
|-------|-------|
| **Docs** | Cycle 9 master forensics §6 + spec §3 J-M section locked. ORCH-0704 SPEC v2 §3.1.5 + §3.6 + §12 cycle 9c handoff notes locked. Q-9c-1..8 operator answers locked all to A. |
| **Schema (current)** | OrderRecord shape spec'd in ORCH-0704 SPEC v2 §3.1.5 — Cycle 9c implements verbatim. All input fields constructible from CartContext (OBS-9c-1). |
| **Schema (forward 9c)** | New AsyncStorage key `mingla-business.orderStore.v1`. New optional `orderId?` field on `EventEditEntry`. New `EditSeverity` value `"destructive"`. |
| **Code (current)** | 4 swap-points verified: orderStoreHelpers.ts:39-46 (stub returns zeros) · liveEventStore.ts updateLiveEventFields (`affectedOrderIds: []`) · EditPublishedScreen `webPurchasePresent: false` literal + reject dialog "Open Orders" toast stub · EventListCard.tsx:96 `soldCount = 0` + EventManageMenu lines 149-155 + 252-257 transitional toasts. |
| **Runtime** | Greenfield routes for J-M1..J-M6 + buyer order detail. Existing ORCH-0704 reject-flow continues working post-9c (now fires real reject dialogs once orders exist + operator clicks "Open Orders"). |
| **Data** | Stub orders persist to AsyncStorage; clearAllStores wipes on logout. B3 future migration: orderStore → Supabase orders + order_line_items per PR #59 §B.4. |

No cross-layer contradictions.

---

## 6 — Blast Radius

| Surface | Impact | Action |
|---------|--------|--------|
| `mingla-business/src/store/orderStore.ts` | NEW — full useOrderStore | CREATE |
| `mingla-business/src/store/orderStoreHelpers.ts` | REWRITE body (signature stable) | MOD |
| `mingla-business/src/store/eventEditLogStore.ts` | Add optional `orderId?` field on EventEditEntry; extend `EditSeverity` with `"destructive"` | MOD (additive) |
| `mingla-business/src/services/eventChangeNotifier.ts` | Extend `deriveChannelFlags` for `"destructive"` severity (banner+email+SMS always); update `composeEmailPayload` + `composeSmsPayload` for refund/cancel copy | MOD (additive) |
| `mingla-business/src/store/liveEventStore.ts:updateLiveEventFields` | Replace `affectedOrderIds: []` literal with `useOrderStore.getState().getOrdersForEvent(id).map(o => o.id)` | MOD (one-line swap) |
| `mingla-business/src/utils/clearAllStores.ts` | Add `useOrderStore.getState().reset()` line | MOD |
| `mingla-business/app/checkout/[eventId]/confirm.tsx` | Add ~20-line recordOrder block after recordResult | MOD |
| `mingla-business/src/components/event/EventListCard.tsx:96` | Replace `const soldCount = 0;` stub with selector call | MOD |
| `mingla-business/src/components/event/EventManageMenu.tsx` | Replace TWO transitional toasts (Orders + Issue refunds): Orders → onOpenOrders callback; Issue refunds (past events) → onOpenOrders | MOD |
| `mingla-business/src/components/event/EditPublishedScreen.tsx` | Replace `webPurchasePresent: false` literal with selector; replace "Open Orders" toast stub in buildRejectDialog with `router.push('/event/${eventId}/orders')` | MOD |
| `mingla-business/app/event/[id]/index.tsx` | Add Orders KPI tile / nav action to Event Detail | MOD |
| `mingla-business/app/event/[id]/orders/index.tsx` | NEW — J-M1 Orders list route | CREATE |
| `mingla-business/app/event/[id]/orders/[oid]/index.tsx` | NEW — J-M2 Order detail route | CREATE |
| `mingla-business/src/components/orders/RefundSheet.tsx` | NEW — J-M3 + J-M4 (full + partial refund) | CREATE |
| `mingla-business/src/components/orders/OrderListCard.tsx` | NEW — J-M1 list row component | CREATE |
| `mingla-business/app/o/[orderId].tsx` | NEW — buyer order detail (anon-tolerant) | CREATE |
| `mingla-business/src/components/orders/MaterialChangeBanner.tsx` | NEW — buyer-side banner reading from useEventEditLogStore | CREATE |

**Net:** 6 NEW + 8 MOD + 1 REWRITE-body. Estimated ~+1300 LOC net.

---

## 7 — Invariant Compliance Plan

| ID | How preserved |
|----|---------------|
| I-15 (ticket display single source) | Refund flow uses `ticketDisplay.ts` helpers + `formatGbp` for amount rendering |
| I-16 (live-event ownership separation) | `useOrderStore` is orthogonal to `addLiveEvent`; never touches LiveEvent shape |
| I-17 (brand-slug stability) | Buyer order page uses frozen `event.brandSlug` for any brand-link rendering |
| I-18 (buyer→founder order persistence — DRAFT) | RATIFIED at Cycle 9c CLOSE. Implemented via `useOrderStore.recordOrder` + `confirm.tsx` 1-line wire |
| I-19 (immutable order financials) | Preserved via API surface — recordOrder write-once + recordRefund creates RefundRecord (never overwrites snapshot) + cancelOrder only updates status+cancelledAt |
| I-20 (edit reason mandatory + audit log permanence) | Preserved + extended — refund/cancel reason captured in mutations + logged to `useEventEditLogStore` (Q-9c-3 default A) |

### Proposed NEW

**I-21 — Anon-tolerant buyer routes (mingla-business)**

> Routes outside `(tabs)/` group serving buyer/anon contexts MUST NOT call `useAuth`, MUST NOT redirect to sign-in, and MUST function identically for logged-in and anon users. Reads come from `useOrderStore`, `useLiveEventStore`, `useEventEditLogStore` (all client-side persisted) + buyer-shared URL parameters.

Codifies the existing memory rule `feedback_anon_buyer_routes`. Established by Cycle 8 anon checkout (`/checkout/[eventId]/...`); extended by Cycle 9c buyer order detail (`/o/[orderId]`); will extend to Cycle 6+ public surfaces (`/e/[brandSlug]/[eventSlug]`, `/b/[brandSlug]`).

CI gate: grep for `useAuth` + `requireAuth` inside any `app/(?!.*\(tabs\)).*\.tsx` file → zero hits.

---

## 8 — Fix Strategy (direction; spec encodes details)

### Phase 1 — useOrderStore + dependents
1. NEW `orderStore.ts` per ORCH-0704 §3.1.5 shape
2. Wire `clearAllStores.reset` (Const #6)
3. Add 1-line recordOrder block to `confirm.tsx`
4. REWRITE `orderStoreHelpers.ts.getSoldCountContextForEvent` body (signature stable)
5. Extend `eventEditLogStore.ts` (additive: optional orderId, "destructive" severity)
6. Extend `eventChangeNotifier.ts` `deriveChannelFlags` + payload composers for "destructive"

### Phase 2 — Activate ORCH-0704 stubs
7. Replace `liveEventStore.updateLiveEventFields` `affectedOrderIds: []` literal
8. Replace `EditPublishedScreen` `webPurchasePresent: false` literal
9. Replace `EditPublishedScreen.buildRejectDialog` "Open Orders" toast stub with router.push
10. Replace `EventListCard.tsx:96` soldCount stub
11. Replace `EventManageMenu` transitional toasts (lines 149-155 + 252-257)

### Phase 3 — Operator J-M screens
12. NEW `app/event/[id]/orders/index.tsx` — J-M1 Orders list
13. NEW `app/event/[id]/orders/[oid]/index.tsx` — J-M2 Order detail
14. NEW `components/orders/RefundSheet.tsx` — J-M3 + J-M4
15. NEW `components/orders/OrderListCard.tsx` — J-M1 row
16. Wire J-M5 Cancel order action (ConfirmDialog "simple" variant)
17. Wire J-M6 Resend ticket action (button + 800ms processing + toast)
18. Wire Event Detail Orders entry-point

### Phase 4 — Buyer surface
19. NEW `app/o/[orderId].tsx` — anon-tolerant buyer order detail
20. NEW `components/orders/MaterialChangeBanner.tsx` — banner consumer

### Phase 5 — Verify
21. tsc EXIT=0
22. grep `[TRANSITIONAL]` in orderStoreHelpers.ts → zero
23. grep `useAuth` in `app/o/` → zero (I-21)
24. grep `oklch(` → only pre-existing comments
25. Manual smoke per spec ACs

---

## 9 — Regression Prevention

### What could break

1. **ORCH-0704 surface (operator full edit)** — guard rails activate post-Cycle 9c. Tier delete with sales now fires reject dialog (was silent in stub). Test: edit a live event with a paid order → tier delete blocked.
2. **Cycle 8 buyer checkout** — recordOrder wire is additive (after recordResult). Verify existing checkout still completes + new order shows in Orders ledger.
3. **Cycle 9a manage menu** — Orders action used to fire transitional toast; now navigates. Verify the navigation path is correct + back returns to Event Detail.
4. **Cycle 3 wizard create flow** — must be unchanged. StepBodyProps `editMode` already optional in ORCH-0704; create-flow doesn't pass it.
5. **Logout** — useOrderStore wired into clearAllStores; verify no order data survives sign-out.

### Structural safeguards

- API surface enforcement: useOrderStore exposes ONLY recordOrder + recordRefund + cancelOrder + updateLastSeenEventUpdatedAt + reset (no updateLine/updateBuyer/updatePrice). I-19 baked in.
- Anon route discipline: I-21 ratified + CI grep gate.
- Notification severity exhaustive switch in `deriveChannelFlags` — TypeScript catches unhandled tags.
- Idempotent recordOrder via dedupe — write-once snapshot fields cannot be re-overwritten.

---

## 10 — Discoveries for Orchestrator

**D-9c-1 (Note severity)** — `Order Number` semantic for J-M1 list rows. Design package shows "M-44218" mono-font. Cycle 8's `generateOrderId` produces `ord_<base36-ts>_<base36-rand>` (e.g., `ord_n5k2_a8c3`). Spec recommends displaying the full ID without prefix dropping (operator sees the buyer's exact order ID). The `M-44218` design-package format is illustrative, not contractual.

**D-9c-2 (Note severity)** — Order ID on the buyer's URL `/o/[orderId]` is opaque-but-not-encrypted. Anyone with the URL can view the order. This is intentional (shareable URL UX) but worth flagging that future B-cycle may add a signed token (`/o/[orderId]?t=<jwt>`) for stronger access control. Out of 9c scope.

**D-9c-3 (Note severity)** — Cycle 9 master spec §3 J-M sections were narrow placeholders pre-9c. Cycle 9c spec replaces them. v1 J-M sections in `SPEC_BIZ_CYCLE_9_EVENT_MANAGEMENT.md` should be marked OBSOLETE-on-close (banner: "superseded by SPEC_BIZ_CYCLE_9c_ORDERS_OPS.md"); this is housekeeping for the orchestrator at CLOSE protocol.

**D-9c-4 (Low severity)** — Stripe-fee-retained line in J-M3 RefundSheet (design package shows "Stripe fee retained — £0.30"). In stub mode there's no real Stripe fee; spec recommends OMITTING this line until B-cycle wires real Stripe (otherwise the operator sees fabricated fee data, violating Const #9). When Stripe lands, the fee comes from real refund response + line activates.

**D-9c-5 (Low severity)** — `paymentMethod` of recorded orders depends on Cycle 8 stub branch the buyer took. Real Apple Pay / Google Pay flows in Cycle 8 produce `apple_pay` / `google_pay` strings (per CartContext.tsx:52). Stub mode all 4 branches produce realistic paymentMethod values; J-M2 displays them via a label map. Confirm in spec.

**D-9c-6 (Note severity)** — Reusing `eventChangeNotifier` for refund/cancel events means the email subject template currently is `"{brandName} updated '{eventName}': {reason}"`. For refund/cancel, this reads weirdly ("Mingla updated 'Friday Night': Refund issued"). Spec recommends extending `composeEmailPayload` with order-event branch when `payload.severity === "destructive"`: subject becomes `"{brandName} {refunded|cancelled} your order — '{eventName}'"`. SMS template similar.

**D-9c-7 (Low severity)** — J-M5 Cancel order is FREE-orders-only per Q-9-8 + Q-9c-5. Spec must hide the Cancel button entirely on paid orders (buyer would see Refund instead). If implementor reflexively shows both, operator confusion.

**D-9c-8 (Note severity)** — Cycle 9 OBS-2 noted `liveEvent.orders: never[]` is a Cycle 6 forward-compat stub. Cycle 9c does NOT populate this field — orders live in their own store (per Q-9-2 option B). The placeholder field stays as-is. If future B-cycle migrates LiveEvent to server-side, the orders array can be deleted entirely (replaced by `useOrderStore` selector) — flag for B-cycle backlog.

**D-9c-9 (Low severity)** — RefundRecord.reason field is optional (`reason: string | null`). Spec recommends MAKING REQUIRED (10..200 chars trimmed) for symmetry with edit reason capture (I-20). Refund without reason creates a buyer-confusion gap ("why was I refunded?"). Default reason input mandatory; covers sympathetic edge cases like "buyer requested" via free text.

**No other side issues.**

---

## 11 — Confidence

**HIGH.**

- OrderRecord shape is canonical (ORCH-0704 SPEC v2 §3.1.5 verbatim — zero drift permitted).
- All field sources verified constructible from CartContext (OBS-9c-1 cross-checked every field).
- 4 forward-handoff stub-swap-points read in code (orderStoreHelpers.ts, liveEventStore.ts updateLiveEventFields, EditPublishedScreen, EventListCard, EventManageMenu).
- DESIGN-PACKAGE-FULL coverage for J-M1 + J-M2 + J-M3 read directly from source files.
- 6 of 8 Q-9c questions have low-stakes recommended defaults A (operator confirmed); 2 questions (Q-9c-2 destructive severity tag, Q-9c-3 audit log unification) have non-trivial implications fully documented in spec for orchestrator review.

The only uncertainty is real-runtime behavior of the buyer order detail page (anon-tolerance verification on shared URL across browsers) — that's smoke-test territory, not investigation territory.

---

## 12 — Cross-references

- Spec: [SPEC_BIZ_CYCLE_9c_ORDERS_OPS.md](../specs/SPEC_BIZ_CYCLE_9c_ORDERS_OPS.md)
- Dispatch: [FORENSICS_SPEC_BIZ_CYCLE_9c_ORDERS_OPS.md](../prompts/FORENSICS_SPEC_BIZ_CYCLE_9c_ORDERS_OPS.md)
- Backward dependency: ORCH-0704 v2 [SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_v2.md](../specs/SPEC_ORCH-0704_FULL_EDIT_AFTER_PUBLISH_v2.md) §3.1.5 (canonical OrderRecord)
- Cycle 9 master forensics: [INVESTIGATION_BIZ_CYCLE_9_EVENT_MANAGEMENT.md](INVESTIGATION_BIZ_CYCLE_9_EVENT_MANAGEMENT.md)
- Cycle 9 master spec: [SPEC_BIZ_CYCLE_9_EVENT_MANAGEMENT.md](../specs/SPEC_BIZ_CYCLE_9_EVENT_MANAGEMENT.md) (J-M sections obsolete-on-close per D-9c-3)
- Forward dependency: B-cycle (real Stripe + Resend + Twilio); ORCH-0705 (no-show + post-event + dispute, post-Stripe deferred)
