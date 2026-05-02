# Spec — BIZ Cycle 8 — Checkout flow (J-C1 → J-C5)

**Date:** 2026-05-01
**Author:** mingla-forensics
**Investigation:** [Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_8_CHECKOUT.md](Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_8_CHECKOUT.md)
**Estimated effort:** ~24–30 hours implementor + ~3 hours smoke. 5 screens net-new, 1 entry-point edit, 1 cart context. NO new dependencies. NO schema. NO API. STUB ALL THE WAY.

---

## 1 — Scope

Cycle 8 ships the buyer-facing checkout flow inside `mingla-business` Expo Web (also iOS + Android per parity). Five sibling screens under `app/checkout/[eventId]/`:

1. **J-C1 — Tickets** (`index.tsx`) — pick ticket types + quantities; running total; "Continue" CTA.
2. **J-C2 — Buyer Details** (`buyer.tsx`) — name, email, optional phone, marketing opt-in; validate; "Continue to payment" CTA.
3. **J-C3 — Payment** (`payment.tsx`) — stub Stripe Payment Element with 4 method tabs; "Pay £X.XX" CTA; 1.2s mock processing; resolves to confirmation OR (if 3DS-test ticked) to J-C4.
4. **J-C4 — 3DS Challenge** (rendered as a `Sheet` overlay over J-C3, NOT a separate route) — stubbed challenge UI; resolves to confirmation.
5. **J-C5 — Confirmation** (`confirm.tsx`) — "You're in" + QR + ticket summary + Apple/Google Wallet add intents (toast stub) + "Back to event" CTA.

Plus:
- 1 entry-point edit in `PublicEventPage.tsx` to wire `handleBuyerAction("buy"|"free")` to `router.push("/checkout/{eventId}")`.
- 1 cart Context provider in `app/checkout/[eventId]/_layout.tsx`.
- 1 stub Stripe Element component (`PaymentElementStub.tsx`).
- 1 stub QR helper (`stubOrderId.ts`).

**Files affected (target):**
- `mingla-business/src/components/event/PublicEventPage.tsx` — 1 edit (cases "buy" + "free")
- `mingla-business/app/checkout/[eventId]/_layout.tsx` — NEW
- `mingla-business/app/checkout/[eventId]/index.tsx` — NEW
- `mingla-business/app/checkout/[eventId]/buyer.tsx` — NEW
- `mingla-business/app/checkout/[eventId]/payment.tsx` — NEW
- `mingla-business/app/checkout/[eventId]/confirm.tsx` — NEW
- `mingla-business/src/components/checkout/CheckoutHeader.tsx` — NEW (back chrome + step pill, shared)
- `mingla-business/src/components/checkout/QuantityRow.tsx` — NEW (per-line-item +/- in J-C1)
- `mingla-business/src/components/checkout/PaymentElementStub.tsx` — NEW
- `mingla-business/src/components/checkout/ThreeDSStubSheet.tsx` — NEW (uses Sheet primitive)
- `mingla-business/src/components/checkout/CartContext.tsx` — NEW (Context provider + useCart hook)
- `mingla-business/src/utils/stubOrderId.ts` — NEW (deterministic stub ID generator)

12 net-new files + 1 edit. Total LOC: ~1,200–1,500.

---

## 2 — Non-goals

- ❌ NO real Stripe integration (B3 only)
- ❌ NO real email send (B-cycle Resend)
- ❌ NO real Apple/Google Wallet (B-cycle + Apple Dev cert)
- ❌ NO new Zustand store; NO AsyncStorage cart
- ❌ NO sign-in gate (guest checkout per Q-C1)
- ❌ NO new kit primitive (DEC-079 closure honored)
- ❌ NO `mingla-web/` Next.js codebase (DEC-086)
- ❌ NO real Supabase rows created (no orders, no tickets, no waitlist)
- ❌ NO live capacity decrement (stub purchase doesn't mutate `liveEvent.tickets[].capacity`)
- ❌ NO multi-event cart
- ❌ NO multi-currency (GBP only)
- ❌ NO referral/promo codes (deferred)
- ❌ NO seat assignment / venue map (deferred)

---

## 3 — Resolved decisions (from investigation §5)

These are BINDING for implementor:

| ID | Decision |
|----|----------|
| Q-C1 | Guest checkout — no sign-in. Email is buyer identity. |
| Q-C2 | Multi-line cart — `{ ticketTypeId, quantity, unitPriceGbp, isFree }[]`. |
| Q-C3 | In-memory React state via Context. NO Zustand. NO AsyncStorage. |
| Q-C4 | Quantity clamped to `[minPurchaseQty, min(remainingCapacity, maxPurchaseQty ?? Infinity)]`. "X left" caption when ≤5 AND not isUnlimited. |
| Q-C5 | Free orders skip J-C3 + J-C4 — go straight from J-C2 to J-C5. |
| Q-C6 | QR encodes `mingla:order:{orderId}:ticket:{ticketId}`. orderId = `ord_<ts36>_<rand4>`. |
| Q-C7 | Wallet-add buttons render but fire toast "Coming soon — saved to your account." Both platforms. TRANSITIONAL. |
| Q-C8 | 3DS-test checkbox on J-C3, gated `__DEV__`. When ticked, payment stub returns `requiresAction` → opens J-C4 sheet. |
| Q-C9 | GBP only. `formatGbp` everywhere. |
| Q-C10 | "Sent to {email}" copy on J-C5. TRANSITIONAL — no email actually sent in stub. |
| Q-C11 | Cart survives back from J-C2. Native back disabled on J-C5; explicit "Back to event" CTA. |
| Q-C12 | Race conditions in stub: both buyers succeed. Documented; resolved at B3 by Supabase. |

---

## 4 — Layer specification

### 4.1 — `PublicEventPage.tsx` entry-point edit

**Current** (`src/components/event/PublicEventPage.tsx:256-281`):
```tsx
const handleBuyerAction = useCallback(
  (action: "buy" | "free" | "approval" | "password" | "waitlist"): void => {
    switch (action) {
      case "buy":
        showToast("Online checkout lands Cycle 8. Your card won't be charged yet.");
        return;
      case "free":
        showToast("Free ticket flow lands Cycle 8.");
        return;
      ...
    }
  },
  [showToast],
);
```

**Replace** the two cases that go live in Cycle 8:
```tsx
const handleBuyerAction = useCallback(
  (action: "buy" | "free" | "approval" | "password" | "waitlist"): void => {
    // Cycle 8: "buy" + "free" route to checkout. Other cases stay TRANSITIONAL.
    switch (action) {
      case "buy":
      case "free":
        // Cart is initialized empty; user picks tickets on J-C1.
        // event.id is the LiveEvent id (le_<ts36>); checkout reads it as
        // a route param and resolves the live event via getLiveEvent.
        router.push(`/checkout/${event.id}` as never);
        return;
      case "approval":
        showToast("Approval flow lands Cycle 10 + B4.");
        return;
      case "waitlist":
        showToast("Waitlist invites land B5.");
        return;
      case "password":
        // Password-gate handles its own flow inline.
        return;
    }
  },
  [router, event.id, showToast],
);
```

**Required:** add `useRouter` import + `event.id` to the dep array.

**Why:** OBS-1 — the TRANSITIONAL toast was the Cycle 8 handoff contract. This is the only edit to PublicEventPage in this dispatch.

---

### 4.2 — `app/checkout/[eventId]/_layout.tsx` (NEW)

**Purpose:** Stack provider + cart Context + tab-bar suppression. Lives OUTSIDE `(tabs)` so anon-tolerance is automatic and bottom tab bar doesn't render.

**Contract:**
```tsx
import { Stack } from "expo-router";
import { CartProvider } from "../../../src/components/checkout/CartContext";

export default function CheckoutLayout(): React.ReactElement {
  return (
    <CartProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          // iOS: native swipe-back enabled by default. Confirmation
          // screen disables it via usePreventRemove (J-C5 spec).
        }}
      />
    </CartProvider>
  );
}
```

**Tab-bar suppression:** automatic by virtue of being outside `(tabs)` group.

**Anon-tolerance:** `useAuth()` is not called in this layout — buyers without sign-in pass through.

---

### 4.3 — `CartContext.tsx` (NEW)

**Path:** `mingla-business/src/components/checkout/CartContext.tsx`

**Shape:**
```tsx
export interface CartLine {
  ticketTypeId: string;
  ticketName: string;          // snapshot for display (in case event renames)
  quantity: number;
  unitPriceGbp: number;        // 0 for free tickets
  isFree: boolean;
}

export interface BuyerDetails {
  name: string;
  email: string;
  phone: string;               // E.164-ish, optional
  marketingOptIn: boolean;
}

export interface OrderResult {
  orderId: string;             // ord_<ts36>_<rand4>
  ticketIds: string[];         // tkt_<ord-suffix>_<lineIdx>_<seatIdx>, one per quantity unit
  paidAt: string;              // ISO 8601
  paymentMethod: "card" | "apple_pay" | "google_pay" | "free";
  totalGbp: number;
}

export interface CartState {
  // Cart contents
  lines: CartLine[];
  // Buyer
  buyer: BuyerDetails;
  // Result (populated after J-C3 → J-C4 → J-C5 flow completes)
  result: OrderResult | null;
  // Mutations
  setLineQuantity: (ticketTypeId: string, quantity: number) => void;
  setBuyer: (patch: Partial<BuyerDetails>) => void;
  recordResult: (result: OrderResult) => void;
  reset: () => void;
}
```

**Implementation:** plain React Context + useReducer. NO Zustand. NO persistence.

**Hook:**
```tsx
export const useCart = (): CartState => {
  const ctx = useContext(CartCtx);
  if (ctx === null) {
    throw new Error("useCart must be used within CartProvider");
  }
  return ctx;
};
```

**Derived values** (provided as separate hook to avoid re-render cascades):
```tsx
export const useCartTotals = (): {
  subtotalGbp: number;
  totalGbp: number;
  totalQuantity: number;
  isFree: boolean;
  isEmpty: boolean;
} => { ... };
```

**Reset behavior:** called from `_layout.tsx` unmount (when buyer leaves checkout entirely). NOT called between screens.

---

### 4.4 — J-C1 — Tickets screen (`index.tsx`)

**Route:** `/checkout/{eventId}`
**Purpose:** Pick ticket type(s) + quantity. Show running total. "Continue" → `/checkout/{eventId}/buyer`.

**Entry conditions:**
- `eventId` present in route params
- `useLiveEventStore.getLiveEvent(eventId)` returns non-null
- If null: render "Event not found" empty-state with "Back" CTA → `router.back()`

**State machine:**
- Loading: cart Context is synchronous; LiveEvent lookup is sync. No async loading state. Render skeleton ONLY if `getLiveEvent` returns null AND we're still mounting (effectively never — render empty-state).
- Error: event not found → empty-state.
- Empty (cart subtotal = 0 with no quantities): "Continue" disabled.
- Populated: at least one line has quantity ≥ minPurchaseQty.
- Submitting: N/A — Continue is synchronous router.push.
- Offline: N/A — no network call on this screen.

**Visual contract** (mirrors Cycle 6 dark-glass):
- Host: `flex: 1, backgroundColor: "#0c0e12"` (matches PublicEventPage)
- Header: `<CheckoutHeader stepIndex={0} totalSteps={3} title="Get tickets" onBack={handleBack} />` (3 logical steps for buyer-facing display: Tickets / Details / Payment; 3DS is invisible to buyer; Confirmation is post-purchase)
- ScrollView body
  - Event mini-card (top): cover hue band 64px tall + event name + date line via `formatDraftDateLine`
  - Section label: "Select your tickets" (`textTokens.tertiary`, letterSpacing 1.4, fontSize 11)
  - For each visible+enabled ticket type: `<QuantityRow ticket={ticket} />`
- Sticky bottom bar:
  - Subtotal line: "Subtotal" + `formatGbp(total)` right-aligned
  - "Continue" `Button` (variant primary, full-width, disabled when cart empty)
  - Caption below if free: "Free — no payment required"

**Per-ticket QuantityRow (`src/components/checkout/QuantityRow.tsx`):**
```
┌─ GlassCard ─────────────────────────────────┐
│ Ticket Name             [- 0 +]             │
│ £30.00 · 50 left                            │  (50 left only when ≤5)
│ "Includes dinner + meet-and-greet"          │  (description, optional, max 2 lines)
│ ⚠ Sales open Sat 3 May at 10:00            │  (saleStartAt > now)
└─────────────────────────────────────────────┘
```

**Quantity stepper (inline composition — NO new primitive):**
- Three sub-elements: minus button (44×44 IconChrome with "minus" icon), qty Text (min-width 32, centered, font-weight 600), plus button (44×44 IconChrome with "plus" icon).
- Minus disabled when `quantity <= minPurchaseQty` AND quantity 0 OK (selecting nothing).
- Plus disabled when `quantity >= effectiveMax`.
- effectiveMax = `Math.min(remainingCapacity ?? Infinity, maxPurchaseQty ?? Infinity)`.
- remainingCapacity = `isUnlimited ? Infinity : capacity ?? 0`. (Stub uses static capacity from TicketStub.)
- Tap on minus/plus dispatches `setLineQuantity(ticketTypeId, qty ± 1)`.
- Haptics: `Haptics.selectionAsync()` on each tap.

**Sale-window state:**
- If `saleStartAt > now`: show ⚠ banner; row disabled (stepper greyed out).
- If `saleEndAt < now`: show "Sales ended" caption; row disabled.
- Hide stepper entirely on disabled rows; render grey "Sales not open yet" text.

**Empty/sold-out state:**
- If ALL visible+enabled tickets are sold-out (capacity 0, not isUnlimited): render `<EmptyState>` "Sold out" + "Back to event" CTA. NO quantity rows.
- If event is `cancelled` / `past`: this screen should not have been navigable here (PublicEventPage's `variant` filter blocks the buy CTA). Defensive: render same "Sold out" empty-state with copy "This event isn't taking new tickets."

**Copy:**
- Header: "Get tickets"
- Subtotal label: "Subtotal"
- Free caption: "Free — no payment required"
- Continue (paid): "Continue"
- Continue (free): "Reserve free ticket"
- Empty cart bottom bar: "Add tickets above"
- Sold-out: "Sold out — back to event"

**Accessibility:**
- minus button: `accessibilityLabel="Decrease {ticketName} quantity"`
- plus button: `accessibilityLabel="Increase {ticketName} quantity"`
- qty text: `accessibilityLabel="{quantity} {ticketName} selected"`
- Continue button: `accessibilityLabel="Continue to buyer details, total {formatGbp(total)}"` when paid; "Reserve free ticket" when free.

---

### 4.5 — J-C2 — Buyer Details screen (`buyer.tsx`)

**Route:** `/checkout/{eventId}/buyer`
**Purpose:** Collect name + email + optional phone + marketing opt-in.

**Entry conditions:**
- Cart has ≥1 line with quantity ≥ minPurchaseQty
- If cart empty: redirect to `/checkout/{eventId}` (defensive)

**State machine:**
- Loading: N/A
- Error: per-field validation errors render inline below each Input
- Empty (no fields filled): "Continue" disabled
- Populated (all required filled + valid): "Continue" enabled
- Submitting: not applicable (synchronous nav to next screen)
- Offline: N/A

**Visual contract:**
- Header: `<CheckoutHeader stepIndex={1} totalSteps={3} title="Your details" onBack={() => router.back()} />`
- Form body:
  - Order summary `GlassCard`: lines + subtotal (compact recap of J-C1; tap → router.back())
  - Section label: "Buyer details"
  - `<Input>` Name (required) — `accessibilityLabel="Full name"`
  - `<Input>` Email (required, validated) — `keyboardType="email-address"`, `autoCapitalize="none"`
  - `<Input>` Phone (optional) — `keyboardType="phone-pad"`
  - Checkbox row: marketing opt-in (default UNCHECKED) — copy: "Email me about this organiser's future events"
- Sticky bottom bar:
  - Total line: "Total" + `formatGbp(total)` right-aligned
  - Button "Continue to payment" (paid) / "Reserve free ticket" (free)
  - For free orders: Button skips Payment screen → goes straight to confirmation flow (see §4.7 for the simulated transition).

**Validation rules:**
- Name: trim, length ≥ 2 → error "Please enter your full name"
- Email: regex `^[^\s@]+@[^\s@]+\.[^\s@]+$` → error "Enter a valid email"
- Phone (if present): length ≥ 7 (loose) → error "Enter a valid phone or leave blank"
- All errors render inline below each Input in `semantic.danger` color.

**Keyboard handling (NON-NEGOTIABLE per memory rule):**
- Use the same Cycle 3 wizard root pattern: Keyboard listener + dynamic paddingBottom + deferred scrollToEnd via `requestAnimationFrame`.
- Reference: `mingla-business/src/components/event/CreatorRoot.tsx` (verify path).
- Tester regression: every Input scrolls into view above keyboard.

**Copy:**
- Header: "Your details"
- Continue (paid): "Continue to payment"
- Continue (free): "Reserve free ticket"
- Section label: "Buyer details"
- Marketing opt-in: "Email me about this organiser's future events"

---

### 4.6 — J-C3 — Payment screen (`payment.tsx`)

**Route:** `/checkout/{eventId}/payment`
**Purpose:** Stub Stripe Payment Element + Apple Pay + Google Pay + 3DS-test toggle. Resolves payment.

**Entry conditions:**
- Cart non-empty AND not free (free orders never reach this screen — see §4.7)
- Buyer.name + Buyer.email valid (defensive: if missing, redirect to `/buyer`)

**State machine:**
- Idle: payment method tabs visible; Pay button enabled.
- Submitting: Pay button shows spinner + "Processing..."; method tabs disabled. 1.2s elapse.
- Result: succeeds (→ J-C5 confirmation) OR `requiresAction` (→ open J-C4 3DS sheet) OR declined (→ inline error toast + return to Idle).
- Offline: graceful "You're offline — payment can't process right now" inline toast.

**Visual contract:**
- Header: `<CheckoutHeader stepIndex={2} totalSteps={3} title="Payment" onBack={() => router.back()} />`
- Body:
  - Order summary `GlassCard` (same as J-C2)
  - `<PaymentElementStub>` — see §4.8
- Sticky bottom bar:
  - Total: "Total" + `formatGbp(total)`
  - Button: "Pay {formatGbp(total)}" (variant primary, full-width)
  - Spinner overlays button text during 1.2s processing

**Stub processing** (PaymentElementStub returns a `paymentResult: "ok" | "requiresAction" | "declined"`):
- "ok" → record OrderResult into Cart Context → router.replace(`/checkout/{eventId}/confirm`)
- "requiresAction" → open `<ThreeDSStubSheet>` (Sheet primitive)
- "declined" → inline toast in `semantic.danger`: "Card declined — try another payment method." Return to Idle.

**Decline path trigger:** PaymentElementStub renders a hidden-by-default `__DEV__` "Force decline (stub only)" checkbox. When ticked, next Pay tap returns "declined". Invisible in production builds.

**3DS path trigger:** `__DEV__` "Force 3DS challenge (stub only)" checkbox. When ticked, returns "requiresAction".

**Copy:**
- Header: "Payment"
- Pay button: `Pay {formatGbp(total)}`
- Decline toast: "Card declined — try another payment method."
- Offline toast: "You're offline — payment can't process right now."

---

### 4.7 — Free-ticket flow (skip J-C3 + J-C4)

When buyer taps "Reserve free ticket" on J-C2:
1. Generate stub `OrderResult` synchronously (orderId via `stubOrderId.ts`, paymentMethod="free", totalGbp=0).
2. `recordResult(result)` into Cart Context.
3. `router.replace("/checkout/{eventId}/confirm")` (router.replace, not push — buyer can't back into Buyer Details).

Rationale: charging £0 is absurd. PaymentElementStub never mounts.

---

### 4.8 — `PaymentElementStub.tsx` (NEW)

**Path:** `mingla-business/src/components/checkout/PaymentElementStub.tsx`

**Visual contract** — 4 method tabs in a horizontal row:
1. Card (default selected) — Card icon
2. Apple Pay (iOS + Web Safari only — hidden on Android) — Apple Pay icon
3. Google Pay (Android + Web Chrome only — hidden on iOS) — Google Pay icon
4. PayPal (RESERVED — hidden behind a feature flag for B-cycle; do NOT render in Cycle 8)

**Card method body** (selected by default):
- 4 stub Inputs: Card number (16 digit pattern, fake), Expiry (MM/YY), CVC (3 digit), Postcode (UK pattern)
- Inputs validate format only (no real card validation in stub)
- All Inputs accept any matching pattern — they're for visual fidelity only
- Hint copy: "Stub mode — no card data is sent or stored."

**Apple Pay / Google Pay method bodies:**
- Just the platform's native pay button (visual mock — `Pressable` styled to match)
- Tap → simulates 1.2s processing → resolves payment

**Stub processing logic:**
```ts
const onPay = async (method: PaymentMethod): Promise<PaymentResult> => {
  setProcessing(true);
  await sleep(1200); // simulate Stripe roundtrip
  setProcessing(false);
  if (force3DS) return "requiresAction";
  if (forceDecline) return "declined";
  return "ok";
};
```

**Dev-only checkboxes** (rendered only when `__DEV__`):
- "Force 3DS challenge (stub only)"
- "Force decline (stub only)"

**Lib import note:** This component does NOT import `@stripe/stripe-react-native`. It's a UI stub. Real Cycle B3 implementor swaps this file for the real Stripe Element wrapper.

**TRANSITIONAL comment:**
```tsx
// [TRANSITIONAL] Stub Stripe Payment Element. Real Stripe wires in B3.
// Exit: when @stripe/stripe-react-native ships in mingla-business, replace
// this entire component with <StripePaymentElement> + clientSecret prop.
```

---

### 4.9 — J-C4 — 3DS Challenge sheet (`ThreeDSStubSheet.tsx`)

**Path:** `mingla-business/src/components/checkout/ThreeDSStubSheet.tsx`
**Implementation:** uses `Sheet` primitive (DEC-085 portal-correct).

**Trigger:** PaymentElementStub returns `"requiresAction"`.

**Sheet contents** (snap = "half"):
- Header: "Verify your purchase"
- Subhead: "Your bank wants to confirm this payment is you."
- Mock challenge UI: a fake 6-digit code Input + "Continue" Button + "Cancel" Button (close sheet).
- Continue: validates "any 6 digits" → 800ms processing → sheet dismisses → `paymentResult = "ok"` → confirmation.
- Cancel: sheet dismisses → return to PaymentElementStub Idle state.

**TRANSITIONAL comment:**
```tsx
// [TRANSITIONAL] Stub 3DS challenge. Real Stripe handles 3DS via
// stripe.confirmCardPayment() returning a `next_action` URL that Stripe SDK
// presents natively. This stub mirrors the buyer-facing UX without the SDK.
```

---

### 4.10 — J-C5 — Confirmation screen (`confirm.tsx`)

**Route:** `/checkout/{eventId}/confirm`
**Purpose:** Show "You're in" + QR + Wallet add intents + Back-to-event CTA.

**Entry conditions:**
- `cart.result !== null` (defensive: if null, redirect to `/checkout/{eventId}`)

**Native back guard:**
```tsx
import { usePreventRemove } from "@react-navigation/native";
// or expo-router equivalent
usePreventRemove(true, () => {
  // Show confirm dialog: "Leave confirmation? Your ticket is still valid."
  // For simplicity in stub: silently block the back.
});
```
On web, `window.history.back()` is similarly blocked via `beforeunload`. (Implementor verifies the cleanest cross-platform approach; if Expo Router's `usePreventRemove` works on web, use that.)

**State machine:**
- Loading: N/A — synchronous render from Cart Context.
- Error: cart.result null → redirect.
- Populated: render confirmation.
- Submitting: N/A.

**Visual contract:**
- NO header back chrome (back is blocked).
- Top: large checkmark icon + "You're in" + buyer.email muted line "Sent to {email}"
- Order summary `GlassCard`:
  - Event name + date line
  - For each line: "{quantity}× {ticketName} — {formatGbp(line.unitPriceGbp * line.quantity)}"
  - Total: `formatGbp(result.totalGbp)`
  - Order ID (small, muted): `Order {orderId}`
- QR `GlassCard`:
  - `<QRCode value="mingla:order:{orderId}:ticket:{ticketId}" size={200} />`
  - For multi-quantity orders: render the FIRST ticket's QR by default + "View all {N} tickets" link → opens a Sheet with all QRs (one per ticket unit). For Cycle 8 simplicity: render only the first QR. Document multi-ticket viewer as a Cycle 9 follow-up (D-INV-CYCLE8-7).
  - Caption: "Show this at the door"
- Wallet row:
  - Apple Wallet button (iOS + web Safari — hide on Android) → toast "Coming soon — saved to your account"
  - Google Wallet button (Android + web Chrome — hide on iOS) → same toast
- Bottom CTA: Button "Back to event" → `router.replace("/e/{event.brandSlug}/{event.eventSlug}")` using FROZEN slugs (I-17).

**Copy:**
- "You're in" (large heading)
- "Sent to {email} — check your spam folder if you don't see it in 5 min." (caption, muted)
- Order ID line: "Order {orderId}" (muted, monospace font)
- Total line: "Total"
- QR caption: "Show this at the door"
- Wallet toast: "Coming soon — saved to your account"
- "Back to event" CTA

---

### 4.11 — `CheckoutHeader.tsx` (NEW)

**Path:** `mingla-business/src/components/checkout/CheckoutHeader.tsx`
**Purpose:** Shared back chrome + step pill for J-C1 / J-C2 / J-C3.

**Props:**
```tsx
interface CheckoutHeaderProps {
  stepIndex: 0 | 1 | 2;
  totalSteps: 3;
  title: string;
  onBack: () => void;
}
```

**Visual contract:**
- Top safe-area inset spacer
- Horizontal row:
  - Left: `<IconChrome icon="back" size={40} onPress={onBack} accessibilityLabel="Back" />`
  - Center: title (`fontSize: 17, fontWeight: 600, color: textTokens.primary, textAlign: center`)
  - Right: step pill: "{stepIndex + 1} of {totalSteps}" — small `<Pill>` with `accent.warm` border + muted text
- Bottom 1px divider line: `rgba(255, 255, 255, 0.06)`

---

### 4.12 — `stubOrderId.ts` (NEW)

**Path:** `mingla-business/src/utils/stubOrderId.ts`

```ts
const TS36 = (): string => Date.now().toString(36);
const RAND4 = (): string =>
  Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, "0");

export const generateOrderId = (): string => `ord_${TS36()}_${RAND4()}`;

export const generateTicketId = (
  orderId: string,
  lineIdx: number,
  seatIdx: number,
): string => {
  const orderSuffix = orderId.slice(4); // strip "ord_" prefix
  return `tkt_${orderSuffix}_${lineIdx}_${seatIdx}`;
};

export const buildQrPayload = (
  orderId: string,
  ticketId: string,
): string => `mingla:order:${orderId}:ticket:${ticketId}`;
```

**TRANSITIONAL comment** in file header:
```ts
/**
 * Stub order/ticket ID generators. Replaced in B3 by Supabase-issued IDs
 * (orders.id BIGSERIAL or UUID; tickets.id similar). The QR payload format
 * stays similar but the encoded ID switches from stub format to a real
 * signed JWT containing { order_id, ticket_id, sig } for scanner validation.
 *
 * EXIT CONDITION: B3 Stripe webhook handler creates real order rows; this
 * file becomes irrelevant and gets deleted.
 */
```

---

## 5 — Success Criteria

| AC | Criterion |
|----|-----------|
| AC#1 | Tap "Get tickets" on `/e/sundaylanguor/{slug}` → routes to `/checkout/{eventId}` (web Chrome + iOS sim + Android). |
| AC#2 | J-C1 renders all visible+enabled ticket types as QuantityRows with correct prices. |
| AC#3 | Quantity stepper clamps to `[minPurchaseQty, min(remainingCapacity, maxPurchaseQty ?? Infinity)]`. |
| AC#4 | "X left" caption shows when `remainingCapacity ≤ 5` AND `!isUnlimited`. |
| AC#5 | Subtotal updates live as buyer adjusts quantities. Uses `formatGbp` (pence-precision). |
| AC#6 | "Continue" disabled when cart empty. |
| AC#7 | Tap Continue → router.push to `/checkout/{eventId}/buyer`. Cart survives. |
| AC#8 | J-C2 inline validation: name length ≥ 2, email regex, phone length ≥ 7 (if present). Errors render in `semantic.danger`. |
| AC#9 | All Inputs scroll into view above keyboard (Cycle 3 wizard root pattern). |
| AC#10 | Marketing opt-in checkbox defaults UNCHECKED. |
| AC#11 | "Continue to payment" disabled until name + email valid. |
| AC#12 | Tap Continue (paid) → `/checkout/{eventId}/payment`. |
| AC#13 | Tap "Reserve free ticket" (free order) → skip Payment + 3DS, generate stub OrderResult, route to `/confirm`. |
| AC#14 | Native back from J-C2 returns to J-C1 with cart intact. |
| AC#15 | J-C3 renders 4 payment method tabs (Card default; Apple Pay on iOS+Web Safari; Google Pay on Android+Web Chrome). |
| AC#16 | Tap "Pay {formatGbp(total)}" → 1.2s processing → routes to `/confirm`. |
| AC#17 | `__DEV__` "Force 3DS" checkbox → opens ThreeDSStubSheet → Continue → routes to `/confirm`. |
| AC#18 | `__DEV__` "Force decline" checkbox → inline toast "Card declined — try another payment method" → return to Idle. |
| AC#19 | J-C5 renders QR via `react-native-qrcode-svg`; QR encodes `mingla:order:{orderId}:ticket:{ticketId}`. |
| AC#20 | J-C5 "Sent to {email}" copy uses buyer's typed email. |
| AC#21 | J-C5 Apple Wallet / Google Wallet buttons fire toast "Coming soon — saved to your account". |
| AC#22 | J-C5 "Back to event" → `router.replace("/e/{brandSlug}/{eventSlug}")` using FROZEN slugs from `event.brandSlug` + `event.eventSlug`. |
| AC#23 | Native back / browser back BLOCKED on J-C5. |
| AC#24 | Bottom tab bar SUPPRESSED on all 4 checkout routes (J-C1, J-C2, J-C3, J-C5). |
| AC#25 | Buyer NOT prompted to sign in on any checkout screen. |
| AC#26 | TypeScript strict EXIT=0. |
| AC#27 | grep `oklch(` in `mingla-business/src/components/checkout` returns 0. |
| AC#28 | Cart state does NOT persist across browser tab close (in-memory React Context). |
| AC#29 | NO regression on Cycle 6 PublicEventPage 7 variants. |
| AC#30 | NO regression on Cycle 7 public brand page or share modal. |

---

## 6 — Test cases

| Test | Scenario | Layer |
|------|----------|-------|
| T-01 | Web Chrome — tap Get Tickets on Sunday Languor → land on /checkout/{id} | Full stack |
| T-02 | iOS sim — same | Full stack |
| T-03 | Android emulator — same | Full stack |
| T-04 | Multi-line cart — add 2× General + 1× VIP → subtotal = 2×£X + 1×£Y | Component |
| T-05 | Quantity clamp — try to add more than capacity → plus button disabled | Component |
| T-06 | "X left" caption — set ticket capacity to 3 → caption shows | Component |
| T-07 | Sale-window pre-sale — saleStartAt > now → row disabled, banner shows | Component |
| T-08 | Free order — single free ticket → "Reserve free ticket" → skips payment → confirm | Full stack |
| T-09 | Buyer details validation — invalid email → inline error | Component |
| T-10 | Keyboard — focus email input → keyboard rises, input scrolls into view above keyboard | Runtime |
| T-11 | Back from J-C2 → J-C1 cart intact | Navigation |
| T-12 | Pay path — Card method → 1.2s processing → confirm screen | Full stack |
| T-13 | 3DS path — `__DEV__` Force 3DS ticked → sheet opens → Continue → confirm | Full stack |
| T-14 | Decline path — `__DEV__` Force decline ticked → toast → Idle | Full stack |
| T-15 | Confirmation QR — verify QR scannable + encodes `mingla:order:...` payload | Full stack |
| T-16 | Confirmation back-block — native swipe-back → blocked | Navigation |
| T-17 | Confirmation "Back to event" → `/e/{brandSlug}/{eventSlug}` | Navigation |
| T-18 | Wallet button → toast "Coming soon" | Component |
| T-19 | Tab bar suppression on all 4 checkout routes | Layout |
| T-20 | Anon access — no `useAuth` redirect | Auth |
| T-21 | Cart persistence — close browser tab → reopen `/checkout/{id}` → cart empty | Cache |
| T-22 | Regression — Cycle 6 PublicEventPage 7 variants still render correctly | Regression |
| T-23 | Regression — Cycle 7 brand page + share modal still work | Regression |
| T-24 | tsc strict EXIT=0 | Type system |
| T-25 | grep `oklch(` in `src/components/checkout` returns 0 | Static analysis |

---

## 7 — Invariants Preserved

All I-11 through I-17 + Constitution #1, #3, #7, #8, #9, #10, #14 — see investigation §7.

---

## 8 — Implementation order

1. **Edit 1:** PublicEventPage.tsx `handleBuyerAction` — wire "buy" + "free" cases to router.push (~5 LOC)
2. **Stub helpers:** `src/utils/stubOrderId.ts` — generate functions
3. **Cart Context:** `src/components/checkout/CartContext.tsx` — Provider + useCart + useCartTotals
4. **Checkout layout:** `app/checkout/[eventId]/_layout.tsx` — Stack + CartProvider
5. **Shared header:** `src/components/checkout/CheckoutHeader.tsx`
6. **Quantity row:** `src/components/checkout/QuantityRow.tsx`
7. **J-C1 Tickets:** `app/checkout/[eventId]/index.tsx`
8. **J-C2 Buyer:** `app/checkout/[eventId]/buyer.tsx`
9. **Stub Stripe:** `src/components/checkout/PaymentElementStub.tsx`
10. **3DS sheet:** `src/components/checkout/ThreeDSStubSheet.tsx`
11. **J-C3 Payment:** `app/checkout/[eventId]/payment.tsx`
12. **J-C5 Confirm:** `app/checkout/[eventId]/confirm.tsx`
13. **Verification:** `cd mingla-business && npx tsc --noEmit` → EXIT=0
14. **Smoke:** Web Chrome happy path + 3DS path + decline path + free path; iOS sim happy path; Android sim happy path
15. **Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_8_CHECKOUT.md`

**Sequencing rule:** complete each step + verify before moving to next. Implementor follows the 1-by-1 order; no parallel scaffolding.

---

## 9 — Hard constraints

- ❌ NO real Stripe SDK import (no `@stripe/stripe-react-native`)
- ❌ NO real email send (no Resend SDK import)
- ❌ NO real Apple `.pkpass` generation
- ❌ NO new Zustand store
- ❌ NO AsyncStorage cart
- ❌ NO `oklch` / `lab` / `lch` color functions (memory rule)
- ❌ NO sign-in gate
- ❌ NO new kit primitive without DEC entry
- ✅ Mirror Cycle 6/7 dark-glass visual language
- ✅ Web + iOS + Android parity
- ✅ Currency = GBP only
- ✅ TypeScript strict EXIT=0
- ✅ Implementor MUST run `/ui-ux-pro-max` as a pre-flight design step (memory rule — UI work)
- ✅ Implementor MUST run web + iOS smoke before declaring "implemented"
- ✅ Implementor MUST cite this spec by section number in the implementation report

---

## 10 — PR #59 forward-compat appendix

When Cycle B3 wires the live backend, the cart shape maps to PR #59 schema as follows:

| Cycle 8 cart field | PR #59 column | Conversion |
|---------------------|---------------|------------|
| `cart.lines[].ticketTypeId` | `order_line_items.ticket_type_id` | 1:1 |
| `cart.lines[].quantity` | `order_line_items.quantity` | 1:1 |
| `cart.lines[].unitPriceGbp` | `order_line_items.unit_price_gbp_pence` | × 100 (whole-units → pence) |
| `cart.lines[].isFree` | `order_line_items.unit_price_gbp_pence === 0` | derived |
| `cart.buyer.name` | `orders.buyer_name` | 1:1 |
| `cart.buyer.email` | `orders.buyer_email` | 1:1 |
| `cart.buyer.phone` | `orders.buyer_phone_e164` | format-normalize |
| `cart.buyer.marketingOptIn` | `orders.marketing_opt_in` | 1:1 |
| `cart.result.orderId` | `orders.id` | replaced — B3 issues real ID |
| `cart.result.totalGbp` | `orders.total_gbp_pence` | × 100 |
| `cart.result.paymentMethod` | `orders.payment_method` | 1:1 |
| `cart.result.paidAt` | `orders.created_at` (or `paid_at` if separate) | 1:1 |
| QR payload `mingla:order:{ord}:ticket:{tkt}` | `tickets.qr_code` (signed JWT in B3) | format-replace |

If PR #59 review surfaces schema changes that break this 1:1 map, the spec is reopened. Otherwise the cart shape is forward-compatible.

---

## 11 — Discovered during spec writing

**D-INV-CYCLE8-7 (Note severity)** — Multi-quantity confirmation: rendering ALL ticket QRs on J-C5 risks a long scroll. Cycle 8 spec renders only the FIRST ticket's QR + a "View all {N} tickets" link that's stubbed (just a console.log) for this cycle. Cycle 9 (event management) or a Cycle 8 polish dispatch fills this in with a Sheet view of all tickets.

**D-INV-CYCLE8-8 (Note severity)** — Sheet navigation guard: `usePreventRemove` is React Navigation; expo-router has its own primitives. Implementor must verify the cleanest cross-platform approach. Worst case: a `useEffect` that calls `router.replace` if buyer hits back from J-C5.

**D-INV-CYCLE8-9 (Low severity)** — `feedback_anon_buyer_routes.md` memory rule recommended (D-INV-CYCLE8-1 from investigation): orchestrator may want to lock in the anon-tolerant route pattern for `/checkout/...`, `/e/...`, `/b/...`.

---

## 12 — Estimated scope

- 12 net-new files (~1,200–1,500 LOC total)
- 1 file edit (~5 LOC)
- 0 new deps (all pieces already installed)
- 0 schema bumps
- 0 new TRANSITIONALs except the documented stubs (Stripe / email / wallet)
- Implementor wall: ~24–30 hrs
- Smoke: ~2–3 hrs

---

End of spec.
