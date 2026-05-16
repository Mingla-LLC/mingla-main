# SPEC — ORCH-0847 [Consumer ticket purchase parity with public business page]

**Mode:** SPEC (binding contract — not investigation, not implementation)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_SPEC_ORCH-0847_CONSUMER_TICKET_PURCHASE_PARITY.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0847_CONSUMER_TICKET_PURCHASE_PARITY.md`
**Date:** 2026-05-15

---

## §1. Executive summary (layman)

ORCH-0847 closes three concrete gaps so a signed-in consumer can buy tickets in the app with the same shape, feel, and effect as an anonymous buyer on the public business event page. Workstream 1 replaces the consumer's single-ticket confirmation modal with a multi-tier quantity cart sheet that mirrors the public page exactly — buyers can pick 2× GA + 1× VIP in one transaction with `+`/`−` steppers, a sticky subtotal, and one primary CTA. Workstream 2 adds a default-unchecked marketing opt-in checkbox in that same sheet that wires the existing `marketingOptIn` payload field instead of hardcoding `false`. Workstream 3 fixes the public buyer form's phone field, which is currently a single free-text input with a US-only fallback validator that silently mangles international numbers; the replacement is a country-picker + local-digits combination that emits a properly-formed E.164 string the existing server validator already accepts. No backend changes. No new tables. No new edge functions. No new RLS.

---

## §2. Sources ingested

### Investigation + memory
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0847_CONSUMER_TICKET_PURCHASE_PARITY.md` — entire report
- Memory: `feedback_anon_buyer_routes.md`, `feedback_zustand_persist_no_server_snapshots.md`, `feedback_verify_db_column_names_before_writing_queries.md`, `feedback_keyboard_never_blocks_input.md`, `feedback_rn_color_formats.md`, `feedback_implementor_uses_ui_ux_pro_max.md`, `feedback_rn_sub_sheet_must_render_inside_parent.md`, `feedback_strict_grep_registry_pattern.md`, `feedback_wcag_aa_kit_invariants.md`, `project_marketing_hub_strategy.md` (current — Phase A shipped early)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md`, `Mingla_Artifacts/DECISION_LOG.md`

### Public-flow reference UX (mirror target)
- `mingla-business/app/checkout/[eventId]/index.tsx` (J-C1 — tickets cart selection screen)
- `mingla-business/app/checkout/[eventId]/buyer.tsx` (J-C2 — buyer-details form, target of Workstream 3 phone fix)
- `mingla-business/app/checkout/[eventId]/payment.tsx` (paid checkout, ORCH-0839-B Hosted Checkout pivot)
- `mingla-business/src/components/checkout/QuantityRow.tsx` (per-tier stepper component — reused by consumer per §4.1.5)
- `mingla-business/src/components/checkout/CartContext.tsx` (cart state model — pattern reference)
- `mingla-business/src/components/checkout/CheckoutHeader.tsx`
- `mingla-business/src/utils/phone.ts` (current naive US-fallback validator — replaced by Workstream 3)
- `packages/event-rendering/PublicEventPage.tsx` (shared event-page renderer; callbacks contract preserved)

### Consumer code to modify
- `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx:130-435` (replace pendingClaim + TicketClaimConfirmModal wiring; rewire `handleBuy` to accept multi-line cart)
- `app-mobile/src/components/expandedCard/TicketClaimConfirmModal.tsx` (DELETED — replaced)
- `app-mobile/src/payments/nativeCheckoutFlow.ts:88-115` (no change — already accepts `lines[]`; `marketingOptIn` already wired)
- `app-mobile/src/hooks/useCalendarEntries.ts` (no change — post-purchase invalidation pattern continues to work)

### Backend contracts (read for invariance — NOT modified)
- `supabase/functions/ticket-checkout-create/index.ts:41-77` (validation gates client must respect: `buyerName` ≥ 2 chars, `buyerEmail` RFC, `buyerPhoneE164` non-null, `lines[]` ≥ 1)
- `supabase/functions/ticket-checkout-create/index.ts:151-183` (free-ticket $0 short-circuit)
- `supabase/functions/_shared/ticketCheckout.ts:78-86` (server `normalizePhoneE164` — accepts `/^\+[1-9][0-9]{1,14}$/` as first-class; client must always emit this shape)
- `supabase/functions/_shared/ticketCheckout.ts:88-105` (idempotency key — multi-line carts already supported; sorted-line composition is deterministic)
- `ticket_types` columns relied on: `id`, `name`, `description`, `price_cents` (read via `priceGbp` mapping), `currency`, `is_free`, `is_unlimited`, `quantity_total`, `min_purchase_qty`, `max_purchase_qty`, `sale_start_at`, `sale_end_at`, `is_hidden`, `is_disabled`, `available_online`, `display_order` (per latest migration baseline 20260505000000)

### Files expected and not found
- None. All targeted reads succeeded.

---

## §3. Scope, non-goals, assumptions

### Scope
Three workstreams in one SPEC. Each workstream is independently shippable but bundled in one implementor dispatch for atomic review.

1. **Consumer multi-tier quantity cart sheet** replacing `TicketClaimConfirmModal`.
2. **Consumer marketing-opt-in checkbox** in that same sheet.
3. **Public event page phone field UX** with country picker + local-digits + client-side E.164 validation.

### Non-goals (explicit — implementor MUST NOT widen scope)

- **Organiser sale notification (push or email).** Deferred to a separate cross-app notifications project covering consumer + business surfaces end-to-end. Do NOT add a `template_key='organiser_sale_received'` row or any organiser-targeted dispatch.
- **Consumer in-app push on own purchase.** Toast + email + SMS only. No new OneSignal target.
- **Audience-pool write-on-purchase / new audience tables / triggers.** Marketing Hub Phase A already reaches consumer buyers via `brand_buyers` / `event_buyers` audiences (resolved at query time from `orders.buyer_email`). Do NOT add `audience_members` table or any auto-trigger.
- **Consumer `profiles.phone` reliability / onboarding-phone enforcement.** Consumer-app users have phone numbers (collected at auth). Out of scope.
- **Refund / cancellation request UX on consumer side.** Operator-side admin path is sufficient.
- **Phase 0 consent + verified contact foundation** (`marketing_consent` table, `buyer_*_verified` columns, DB trigger). Separate ORCH; SPEC must NOT add these columns.
- **SMS / RCS marketing channels** (Phase B / C). Email opt-in only.
- **Public page Apple/Google Wallet integration.** Existing `[TRANSITIONAL]` stubs stay.
- **Server-side phone validator update** (`_shared/ticketCheckout.ts:78`). The client emits proper E.164 — the existing first-line regex `/^\+[1-9][0-9]{1,14}$/` already accepts it. Do NOT modify the edge function.
- **PublicEventPage shared component contract change.** Its `onBuyTicket(ticketId)` / `onClaimFreeTicket(ticketId)` callback shapes stay. Consumer cart aggregation lives in a layer ABOVE PublicEventPage.

### Assumptions

- Consumer `profile.phone` IS populated (collected at auth — Seth confirmed 2026-05-15). The existing `buyerPhone.length === 0` toast gate at `ExpandedBusinessEventSheet.tsx:220-226` stays as defensive code but is not expected to fire.
- `ticket_types.min_purchase_qty` defaults to `1` and `max_purchase_qty` is nullable (NULL = unbounded by per-tier cap, only bounded by `quantity_total`).
- `usePublicEventTickets` already returns the full ticket-type list for the consumer event sheet (current code at `ExpandedBusinessEventSheet.tsx:147` confirms).
- The free-ticket short-circuit on the edge function fires when `totalCents === 0` server-side; the client does not need to branch on free-vs-paid before calling — `nativeCheckoutFlow.ts:132-135` already handles `kind:"free_completed"`.
- Mixed carts (some paid tiers + some free tiers) route to paid path because `totalCents > 0`. This is the current edge-function contract and is correct behavior.

---

## §4. Per-workstream specification

### §4.1 — Workstream 1: Consumer multi-tier quantity cart sheet

#### §4.1.1 Database layer

**No DB changes.** Relies on existing `ticket_types` columns (id, name, description, price_cents, currency, is_free, is_unlimited, quantity_total, min_purchase_qty, max_purchase_qty, sale_start_at, sale_end_at, is_hidden, is_disabled, available_online, display_order) per baseline migration `20260505000000_baseline_squash_orch_0729.sql`. Relies on existing `orders` + `tickets` + `order_line_items` write path via `ticket-checkout-create` → `biz_ticket_checkout_finalize` RPC.

#### §4.1.2 Edge function layer

**No edge function changes.** `ticket-checkout-create` already accepts `lines: Array<{ticketTypeId: string; quantity: number}>` per index.ts:31-38, 77. Idempotency-key helper `checkoutIdempotencyKey` at `_shared/ticketCheckout.ts:88-105` already accepts multi-line carts via sorted-line composition. Free-ticket short-circuit at index.ts:151-183 already fires when `totalCents === 0` server-side, including multi-line carts where every tier is free.

Client must respect existing validation gates:
- `eventId` required (line 52, 69)
- `buyer.name` ≥ 2 trimmed chars (line 70)
- `buyer.email` RFC format (line 71)
- `buyer.phone` normalizes to E.164 server-side (line 65, 74-75)
- `lines[]` ≥ 1 line (line 77)
- Each line: `ticketTypeId` string + `quantity` positive integer

#### §4.1.3 Service layer

**No new service.** `nativeCheckoutFlow.ts:82-228` (the `useNativeCheckoutFlow` hook returned function) is the existing service-layer glue. Its `NativeCheckoutInput.lines` array (line 27) is already typed as `Array<{ticketTypeId: string; quantity: number}>` — multi-line is a no-op delta.

#### §4.1.4 Hook layer

**New hook:** `useTicketCart(eventId, tickets)` at `app-mobile/src/hooks/useTicketCart.ts`.

**Purpose:** Local cart state for the consumer ticket purchase sheet. NOT persisted in Zustand (per memory `feedback_zustand_persist_no_server_snapshots` — no server data in persist). Lives only for the duration of the cart sheet's open state; resets on close.

**Signature:**
```ts
export interface CartLine {
  ticketTypeId: string;
  quantity: number;
  ticketName: string;
  unitPriceCents: number;
  currency: string;
  isFree: boolean;
}

export interface CartTotals {
  totalCents: number;
  currency: string;
  itemCount: number;
  isEmpty: boolean;
  isFree: boolean;
}

export interface UseTicketCartResult {
  lines: CartLine[];                                       // sorted by tier display_order
  totals: CartTotals;
  setLineQuantity: (ticketTypeId: string, next: number) => void;
  reset: () => void;
}

export const useTicketCart: (
  eventId: string | null,
  tickets: ReadonlyArray<PublicTicketType>,
) => UseTicketCartResult;
```

**Behavior:**
- `lines` starts empty; populated by `setLineQuantity(id, n)`. `n === 0` removes the line.
- `totals.totalCents = sum(line.unitPriceCents * line.quantity)`.
- `totals.isFree = totals.totalCents === 0 && totals.itemCount > 0`.
- `totals.isEmpty = totals.itemCount === 0`.
- `totals.currency = lines[0]?.currency ?? "GBP"` — first-line currency is canonical; all tiers on one event share currency (DB-enforced at brand level).
- `reset()` empties all lines.

**Implementation:** `useReducer` with discriminated-union action `{type:"SET_QTY", ticketTypeId, quantity}` | `{type:"RESET"}`. NOT Zustand. NOT React Query (no server data).

**No query keys** — this hook holds client-only state. Existing `["businessEventOrders", userId]` invalidation pattern at `ExpandedBusinessEventSheet.tsx:274-285` is unaffected.

#### §4.1.5 Component layer

**New component:** `TicketCartSheet` at `app-mobile/src/components/expandedCard/TicketCartSheet.tsx`.

**Replaces:** `TicketClaimConfirmModal.tsx` (DELETED — see §4.1.6).

**Mounting:** Renders INSIDE the parent `ExpandedBusinessEventSheet`'s `<BottomSheet>` JSX, as a sibling of `BottomSheetScrollView` within the same `BottomSheet` root, per memory `feedback_rn_sub_sheet_must_render_inside_parent`. Actually a second `<BottomSheet>` instance — same parent fragment as today. Confirmed pattern: today's TicketClaimConfirmModal is rendered as a sibling `<BottomSheet>` at lines 397-413 of `ExpandedBusinessEventSheet.tsx`, in the same return `<>` fragment. TicketCartSheet follows the same structure.

**Props interface:**
```ts
export interface TicketCartSheetProps {
  visible: boolean;
  eventId: string;
  tickets: ReadonlyArray<PublicTicketType>;   // from usePublicEventTickets
  initialTicketTypeId: string | null;          // seed: the tier the user tapped to open
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  isSubmitting: boolean;
  onCancel: () => void;
  onCheckout: (params: {
    lines: Array<{ ticketTypeId: string; quantity: number }>;
    marketingOptIn: boolean;
  }) => void;
}
```

**Layout (top-to-bottom, all required, mirroring `mingla-business/app/checkout/[eventId]/index.tsx:222-316`):**

1. **Header:** Title "Get tickets". Close (×) button right-aligned.
2. **Section label:** "SELECT YOUR TICKETS" (matches public J-C1 styling — 11pt, 600 weight, letterSpacing 1.4, tertiary color).
3. **Tier rows** — one per visible+available ticket from `tickets`, sorted by `display_order`. Each row is the `QuantityRow` component from `mingla-business/src/components/checkout/QuantityRow.tsx`. **Reuse, do not reimplement.** If `QuantityRow` is currently coupled to `mingla-business/src/store/draftEventStore.TicketStub` shape, the implementor must extract it to a shared package `packages/event-rendering/QuantityRow.tsx` (or `packages/ticket-cart/`) and update both apps to import from there. Visible+available filter mirrors public J-C1 logic at index.tsx:56-57 (`visibility !== "hidden" && availableAt !== "door"`).
4. **Marketing opt-in row** — see §4.2.5 (Workstream 2). Renders BELOW the last tier row and ABOVE the sticky bar.
5. **Buyer recap card** — shows the pre-filled name + email + phone in a `GlassCard`-style block (compact, non-editable on consumer — the public flow has its own buyer.tsx step for editing; consumer pre-fills from profile). Text rows: "Name: {buyerName}", "Email: {buyerEmail}", "Phone: {buyerPhone}". This is a thin replacement for the public J-C2 buyer form since consumer pre-fills from auth — no inline editing.
6. **Sticky bottom bar** (per memory `feedback_keyboard_never_blocks_input` pattern — no keyboard interaction in this sheet but the pattern is the standard, so use `paddingBottom: insets.bottom + spacing.md`):
   - **Subtotal row:** "Subtotal" label left, total value right (formatted via existing `formatCurrency` util from app-mobile/src/utils/currency.ts; if not present, use `Intl.NumberFormat(undefined, {style:"currency", currency: totals.currency}).format(totals.totalCents / 100)` per `TicketClaimConfirmModal.tsx:60-67`).
   - **Primary CTA:** label = `totals.isEmpty ? "Add tickets above" : totals.isFree ? "Claim Free Ticket" : \`Continue to Payment\`` (Public uses "Reserve free ticket" + "Continue"; consumer uses "Claim Free Ticket" + "Continue to Payment" to match existing consumer copy at `TicketClaimConfirmModal.tsx:134`). Disabled when `isEmpty` OR `isSubmitting`. Shows `ActivityIndicator` when `isSubmitting`.

**States enumerated (ALL required, even if visually identical):**

| State | Condition | Render |
|---|---|---|
| `loading` | `tickets === undefined` (parent's `ticketsQuery.isLoading`) | Skeleton: 3 placeholder rows with shimmer (or simple gray bars). Reuse the existing skeleton pattern from `mingla-business/app/checkout/[eventId]/index.tsx:111-125`. |
| `empty` | `tickets.length === 0` | "No tickets available for this event." text + Close CTA. |
| `sold_out` | every tier `!isUnlimited && capacity <= 0` | "Sold out. Check back later." + Close CTA. Mirror public J-C1 logic at index.tsx:174-216. |
| `sales_closed` | event ended OR all tiers disabled/sale-ended/sold-out | "This event isn't taking new tickets." + Close CTA. Mirror public J-C1. |
| `populated` | tickets renderable; cart may be empty | Standard layout (1-6 above). Primary CTA disabled when cart empty. |
| `submitting` | `isSubmitting === true` | Standard layout but stepper buttons disabled; CTA shows spinner. |
| `error` | parent passes error toast — not in sheet | Sheet does NOT render error state; errors surface via `toastManager` from the parent's `handleBuy` flow. |

**Copy (all visible strings — implementor MUST use verbatim):**

- Title: `Get tickets`
- Section label: `SELECT YOUR TICKETS`
- Buyer recap section label: `YOUR TICKET GOES TO`
- Buyer row labels: `Name`, `Email`, `Phone`
- Subtotal label: `Subtotal`
- Empty-cart subtotal value: `—`
- Free-cart subtotal value: `Free`
- Paid subtotal value: `formatCurrency(totalCents/100, currency)`
- CTA empty-cart: `Add tickets above`
- CTA free: `Claim Free Ticket`
- CTA paid: `Continue to Payment`
- Sold-out state: `Sold out. Check back later.`
- Sales-closed state: `This event isn't taking new tickets.`
- No-tickets state: `No tickets available for this event.`
- Close button accessibility label: `Close`

**Haptics:**
- Stepper tap (+/−): `Haptics.selectionAsync()` — already implemented inside `QuantityRow` at lines 103-109; preserved by reuse.
- Primary CTA tap (Continue / Claim): `Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)`.
- Close tap: no haptic.

**Accessibility (per memory `feedback_wcag_aa_kit_invariants`):**
- Every `Pressable` has explicit `accessibilityLabel` and `accessibilityRole`.
- All stepper buttons ≥ 44pt touch target (already enforced by `QuantityRow.STEPPER_BTN = 44`).
- Primary CTA ≥ 44pt height (use `size="lg"` Button pattern).
- Quantity value has `accessibilityLiveRegion="polite"` (already in QuantityRow at line 178).
- Close button has `hitSlop={12}`.

**Inline-style colors (per memory `feedback_rn_color_formats`):** Only `hex` / `rgb` / `rgba` / `hsl` / `hwb`. No `oklch`, `lab`, `lch`, `color-mix`. Reuse the existing TicketClaimConfirmModal style palette (`#15181f` sheet background, `#fff` primary text, `rgba(255,255,255,...)` secondary tones, `#eb7825` accent for CTA) for visual continuity.

**Bottom-sheet config:**
- Library: `@gorhom/bottom-sheet` (matches existing `ExpandedBusinessEventSheet` + `TicketClaimConfirmModal` pattern, per memory `feedback_topsheet_extended_universal_creator` and ORCH-0834 migration).
- `snapPoints`: `["75%"]` (taller than the 60% TicketClaimConfirmModal because the cart needs to show 2-4 tier rows + opt-in + buyer recap + sticky bar).
- `index`: `visible ? 0 : -1` (declarative — same pattern as existing).
- `enablePanDownToClose`: `true`.
- `backdropComponent`: `BottomSheetBackdrop` with `appearsOnIndex={0}`, `disappearsOnIndex={-1}`, `pressBehavior="close"`.
- `onChange(-1) && visible === true` → call `onCancel` (mirror existing TicketClaimConfirmModal:103-110).
- During `isSubmitting === true`, swipe-down and backdrop tap are guarded inside `onCancel` (no-op if submitting).

**Defensive guard (mirror TicketClaimConfirmModal:140-146):** Use `useEffect(() => { if (visible) sheetRef.current?.snapToIndex(0); else sheetRef.current?.close(); }, [visible]);` to handle re-mount edge cases.

#### §4.1.6 Wiring + side effects

**File-by-file delta in `ExpandedBusinessEventSheet.tsx`:**

1. **Delete import** of `TicketClaimConfirmModal` (current line ~25).
2. **Add import** of `TicketCartSheet` from `./TicketCartSheet`.
3. **Delete state** `pendingClaim` and the `setPendingClaim` setter (lines 139-145).
4. **Add state:** `const [cartSheetVisible, setCartSheetVisible] = useState<boolean>(false);` and `const [initialTicketTypeId, setInitialTicketTypeId] = useState<string | null>(null);`
5. **Rewrite `handleBuy` signature** (lines 199-302):
   - New signature: `async (params: { lines: Array<{ticketTypeId: string; quantity: number}>; marketingOptIn: boolean }) => Promise<void>`
   - Remove the single-ticket `ticketId` / `isFreeTicket` params.
   - Body adjustments:
     - Pre-flight validation (email/phone presence) UNCHANGED (lines 213-226).
     - `runNativeCheckout` call (lines 233-242): pass `params.lines` directly instead of hardcoded `[{ticketTypeId, quantity: 1}]`; pass `params.marketingOptIn` instead of hardcoded `false`.
     - Free-vs-paid branching for the 3×1s post-purchase polling (lines 277-286) — change condition from `if (!isFreeTicket)` to `if (totals.totalCents > 0)` derived inside `handleBuy` from `params.lines` — implementor must compute total inside `handleBuy` from the lines (or accept a `totalCents` field on params; recommend the latter for less re-derivation).
6. **Rewrite the `callbacks` object** (lines 318-362):
   - `onBuyTicket(ticketId)` and `onClaimFreeTicket(ticketId)` both invoke: `setInitialTicketTypeId(ticketId); setCartSheetVisible(true);` instead of staging `pendingClaim`.
7. **Replace the `<TicketClaimConfirmModal>` render** (lines 397-413) with `<TicketCartSheet>`:
   ```tsx
   <TicketCartSheet
     visible={cartSheetVisible}
     eventId={data.eventId}
     tickets={ticketsQuery.data ?? []}
     initialTicketTypeId={initialTicketTypeId}
     buyerName={profile?.display_name?.trim() || user?.email?.split("@")[0] || "Guest"}
     buyerEmail={user?.email ?? profile?.email ?? ""}
     buyerPhone={profile?.phone ?? ""}
     isSubmitting={checkoutInFlight}
     onCancel={() => {
       setCartSheetVisible(false);
       setInitialTicketTypeId(null);
     }}
     onCheckout={async ({ lines, marketingOptIn }) => {
       setCartSheetVisible(false);
       await handleBuy({ lines, marketingOptIn });
     }}
   />
   ```
8. **Delete file** `app-mobile/src/components/expandedCard/TicketClaimConfirmModal.tsx` after wiring is verified.

**Inside `TicketCartSheet.tsx`:**

- Use `useTicketCart(eventId, tickets)` hook for cart state.
- On open (`visible` flips false → true): call `setLineQuantity(initialTicketTypeId, 1)` to seed the cart with the tapped tier at quantity 1.
- On close (`visible` flips true → false): call `reset()` to clear cart state.
- Render `QuantityRow` per visible tier; wire `onQuantityChange={(next) => setLineQuantity(ticket.id, next)}`.
- Render marketing opt-in checkbox (§4.2.5).
- Render buyer recap card (read-only).
- Primary CTA `onPress`: invokes `onCheckout({ lines: cart.lines.map(l => ({ticketTypeId: l.ticketTypeId, quantity: l.quantity})), marketingOptIn })`.

**Post-purchase invalidation pattern continues to work unchanged.** Lines 273-286 of ExpandedBusinessEventSheet — `queryClient.invalidateQueries(["businessEventOrders", userId])` + 3×1s poll for paid — are unaffected by this change.

**Multi-tier order DB writes:** Existing `biz_ticket_checkout_finalize` RPC already creates one `order_line_items` row per cart line and `quantity` `tickets` rows per line. No change to RPC. The fact that the consumer now sends multi-line `lines[]` is transparent.

---

### §4.2 — Workstream 2: Consumer marketing-opt-in checkbox

#### §4.2.1 Database layer
**No DB changes.** Existing payload field `ticket_checkout_sessions.metadata.marketing_opt_in` (per ORCH-0777 spec §5.3) already stores the value. Note: per memory `project_marketing_hub_strategy` current state, no downstream code consumes this field for suppression — the audience resolvers at `marketingAudienceService.ts:100-205` do NOT filter on `marketing_opt_in` today. This is a known Phase 0 consent-foundation gap, out of scope for ORCH-0847.

#### §4.2.2 Edge function layer
**No edge function changes.** `ticket-checkout-create/index.ts` already accepts `buyer.marketingOptIn` and writes it to the session metadata via the `biz_ticket_checkout_create_session` RPC.

#### §4.2.3 Service layer
**No service changes.** `nativeCheckoutFlow.ts:107` already wires `marketingOptIn: input.buyer.marketingOptIn === true` to the request payload.

#### §4.2.4 Hook layer
**No new hook.** Opt-in state lives in the `TicketCartSheet` component's local `useState<boolean>(false)` — does NOT flow through `useTicketCart` (the cart hook is about line items only).

#### §4.2.5 Component layer

**Inside `TicketCartSheet.tsx`, after the last `QuantityRow`:**

```tsx
const [marketingOptIn, setMarketingOptIn] = useState<boolean>(false);

<Pressable
  onPress={() => setMarketingOptIn((v) => !v)}
  accessibilityRole="checkbox"
  accessibilityState={{ checked: marketingOptIn }}
  accessibilityLabel="Email me about this organiser's future events"
  style={({ pressed }) => [
    styles.checkboxRow,
    pressed && styles.checkboxRowPressed,
  ]}
>
  <View
    style={[
      styles.checkboxBox,
      marketingOptIn && styles.checkboxBoxChecked,
    ]}
  >
    {marketingOptIn ? <Icon name="check" size={14} color="#fff" /> : null}
  </View>
  <Text style={styles.checkboxLabel}>
    Email me about this organiser&apos;s future events
  </Text>
</Pressable>
```

**Default state:** `false` (unchecked). Required for GDPR / CAN-SPAM cleanliness — pre-checking marketing consent is a compliance violation per memory `project_marketing_hub_strategy` §3.2 (M1 locked).

**Copy:** `Email me about this organiser's future events` — VERBATIM match with `mingla-business/app/checkout/[eventId]/buyer.tsx:415` so the consumer and anonymous-buyer wording is identical.

**Visual style:** Mirror the public-page checkbox at `buyer.tsx:551-580` styles. Box 22×22, `radiusTokens.sm` border, 1.5pt border, accent-warm (`#eb7825`) fill when checked.

**Wiring:** When primary CTA fires, pass `marketingOptIn` value through `onCheckout({ lines, marketingOptIn })`. Parent's `handleBuy` threads it to `runNativeCheckout`.

**Reset on sheet close:** `useEffect(() => { if (!visible) setMarketingOptIn(false); }, [visible])` — fresh opt-in state each cart session.

#### §4.2.6 Wiring + side effects
Already documented in §4.1.6 — `onCheckout` callback signature includes `marketingOptIn`. `handleBuy` in parent threads it to `runNativeCheckout`'s `buyer.marketingOptIn` field. End-to-end: cart sheet checkbox → cart sheet state → `onCheckout` payload → `handleBuy` → `runNativeCheckout` → `supabase.functions.invoke("ticket-checkout-create", { body: { buyer: { marketingOptIn } } })` → `ticket_checkout_sessions.metadata.marketing_opt_in`.

---

### §4.3 — Workstream 3: Public event page phone field UX

**Target file:** `mingla-business/app/checkout/[eventId]/buyer.tsx`. The phone field today (lines 378-391) is a plain `<Input variant="text" placeholder="Mobile number">` paired with the naive `isRequiredPhoneValid` validator at `mingla-business/src/utils/phone.ts:10-11`, which only accepts already-E.164 strings or US-shaped 10/11-digit numbers.

#### §4.3.1 Database layer
**No DB changes.** `orders.buyer_phone_e164` column unchanged. Server-side check constraint at orders table CHECK `orders_online_checkout_phone_e164_check (source <> 'online_checkout' OR (buyer_phone_e164 IS NOT NULL AND buyer_phone_e164 ~ '^\+[1-9][0-9]{1,14}$'))` continues to enforce E.164 format.

#### §4.3.2 Edge function layer
**No edge function changes.** `supabase/functions/_shared/ticketCheckout.ts:78-86` `normalizePhoneE164` function's first-line regex `/^\+[1-9][0-9]{1,14}$/` accepts any valid E.164 string. The client will always emit such a string, so the US-fallback branches at lines 83-84 will never fire for the new flow. The fallback stays in place for legacy callers (no removal — out of scope, also reduces blast radius).

#### §4.3.3 Service layer

**Update** `mingla-business/src/utils/phone.ts` — REPLACE the existing two-line file with a country-aware validator. New file content:

```ts
/**
 * Phone validation utilities for buyer checkout.
 *
 * Country picker emits `+{countryCode}{localDigits}` strings — these always
 * match E.164 format (1-3 digit country code + 1-12 digit subscriber number,
 * total ≤ 15 digits per ITU-T E.164). Server validator at
 * `supabase/functions/_shared/ticketCheckout.ts:78-86` accepts these via its
 * first-line regex.
 *
 * The legacy 10-digit / 11-digit-with-1 US fallback in the SERVER validator
 * stays for backward-compatibility with legacy callers; this client file no
 * longer needs the fallback because the new `<PhoneInputField>` always emits
 * proper E.164.
 */

/**
 * Tests whether a string is a valid E.164 phone number.
 * Matches the server validator's first-line regex exactly.
 */
export const isValidE164 = (value: string): boolean =>
  /^\+[1-9][0-9]{1,14}$/.test(value.trim());

/**
 * Composes an E.164 string from country dial code + local digits.
 * Strips non-digits from `localDigits` before composition.
 * Returns null if the composed string fails E.164 validation
 * (e.g., empty local digits, total length > 15).
 */
export const composeE164 = (countryDialCode: string, localDigits: string): string | null => {
  const digits = localDigits.replace(/\D/g, "");
  if (digits.length === 0) return null;
  const composed = `${countryDialCode}${digits}`;
  return isValidE164(composed) ? composed : null;
};

/**
 * Back-compat: kept for any non-buyer.tsx caller that still uses the
 * naive validator. The new <PhoneInputField> component does NOT use this.
 * @deprecated Use isValidE164 + composeE164 with <PhoneInputField>.
 */
export const isRequiredPhoneValid = (raw: string): boolean => isValidE164(raw);
```

**Justification for keeping `isRequiredPhoneValid` as deprecated alias:** other call sites may exist outside `buyer.tsx`. Implementor must grep `mingla-business/` for `isRequiredPhoneValid` and confirm only `buyer.tsx` uses it; if other files exist, migrate them to `isValidE164` in the same PR. The deprecated alias prevents a silent break if a caller is missed.

#### §4.3.4 Hook layer
**No new hook.** Phone state lives in `useCart` already (via `CartContext.BuyerDetails.phone`). The new `<PhoneInputField>` component is fully controlled by `useCart`'s `buyer.phone` value + `setBuyer({phone})` setter.

#### §4.3.5 Component layer

**New component:** `<PhoneInputField>` at `mingla-business/src/components/checkout/PhoneInputField.tsx`.

**Props interface:**
```ts
export interface PhoneInputFieldProps {
  /** Current full E.164 value (e.g., "+447700900000"). Empty string = not yet entered. */
  value: string;
  /** Called with a new full E.164 string OR empty string when invalid. */
  onChangeText: (next: string) => void;
  /** Default country dial code (e.g., "+44"). Resolution order: see §4.3.5. */
  defaultDialCode: string;
  /** Show error border + message when not null. */
  errorMessage: string | null;
  /** For accessibility tree. */
  accessibilityLabel: string;
  /** Fires on first blur for "touched" tracking. */
  onBlur: () => void;
  /** Optional focus callback for keyboard-scroll pattern. */
  onFocus?: () => void;
}
```

**Layout (horizontal row):**
- **Country picker button** — left-aligned, ~120pt wide. Shows: `🇬🇧 +44` (flag emoji + dial code). Tappable to open country picker sheet.
- **Vertical divider** — 1pt hairline at theme `glass.border.profileBase` color.
- **Local digits input** — right side, `flex: 1`. `keyboardType="phone-pad"`. `placeholder="Mobile number"`. Accepts digits only (input filter `value.replace(/\D/g, "")`).

Wrap in same `<Input>`-style container (rounded border, glass background) used by `mingla-business/src/components/ui/Input.tsx` for visual consistency with the Name + Email fields above it.

**Country picker sheet:**
- Opens as a `@gorhom/bottom-sheet` on country button tap.
- Snap point: `["85%"]`.
- Lists all countries with: flag emoji, country name, dial code (e.g., "🇺🇸 United States +1").
- Searchable: `<TextInput>` at top filters by country name or dial code.
- Tap a row → sets selected country, closes sheet, recomposes `<PhoneInputField>` value via `composeE164(newDialCode, currentLocalDigits)`.

**Country data:** Use a single static array from `mingla-business/src/utils/countries.ts` (NEW FILE). Implementor produces this file with all ITU countries (~250 entries). Schema:
```ts
export interface CountryEntry {
  iso2: string;        // "GB"
  name: string;        // "United Kingdom"
  dialCode: string;    // "+44"
  flag: string;        // "🇬🇧"
}
export const COUNTRIES: ReadonlyArray<CountryEntry>;
```
Source the list from a maintained npm package OR hardcode (operator preference is §10 Q3 below). Recommendation: hardcode to avoid runtime dependency; ~250 entries is a small file (~15 KB).

**Default country resolution order (composed at component mount):**
1. **Device locale** — `expo-localization` `Localization.region` (e.g., `"GB"`). Map ISO-2 region → `dialCode` via `COUNTRIES`. If not found, fall through.
2. **Brand country** — if the event's brand has a country code stored (check `brands.country` column if present; if absent, skip).
3. **Fallback:** `"+44"` (GB) — matches the existing default of the mingla-business `events.currency` baseline ("GBP").

Resolution happens once at mount; user can override via the picker.

**Validation feedback:**
- Inline error message under the field when `errorMessage !== null`.
- Border turns to `semantic.error` color (existing `Input` red-error pattern) when error visible.
- Error copy: `"Enter a valid mobile number"` (same copy as today's `buyer.tsx:95`).

**Required-ness indicator:** Add a `*` asterisk after the field label, OR (recommended — operator can pick in §10 Q2) a small "Required" pill in the field's top-right corner. Today's form does NOT visually indicate required-ness — this is the bug Seth flagged. Add the same indicator to the Name and Email fields for consistency (one-line addition; not separate workstream).

**Accessibility:**
- Country picker button: `accessibilityRole="button"`, `accessibilityLabel="Country code, currently {country.name} {country.dialCode}, tap to change"`.
- Local digits field: `accessibilityLabel="Mobile number"`, `accessibilityHint="Digits only; country code is selected separately"`.
- Country picker sheet rows: `accessibilityRole="button"`, `accessibilityLabel="${country.name}, ${country.dialCode}"`.
- All buttons ≥ 44pt.

**Inline-style colors:** hex/rgb/hsl only per memory `feedback_rn_color_formats`.

**Keyboard handling:** `keyboardType="phone-pad"` on the local digits input. `autoCapitalize="none"`. `autoCorrect={false}`. Numbers-only iOS keyboard prevents most invalid input client-side.

#### §4.3.6 Wiring + side effects

**File-by-file delta in `mingla-business/app/checkout/[eventId]/buyer.tsx`:**

1. **Replace** the Phone `<View style={styles.fieldWrap}>` block at lines 377-391 with:
   ```tsx
   <View style={styles.fieldWrap}>
     <PhoneInputField
       value={buyer.phone}
       onChangeText={(next) => setBuyer({ phone: next })}
       defaultDialCode={defaultDialCode}
       errorMessage={visibleErrors.phone}
       accessibilityLabel="Mobile number, required"
       onFocus={requestScrollToInput}
       onBlur={() => setPhoneTouched(true)}
     />
   </View>
   ```
2. **Add** `import { PhoneInputField } from "../../../src/components/checkout/PhoneInputField";` at the top.
3. **Add** default-country resolution near component top:
   ```tsx
   const defaultDialCode = useMemo<string>(() => resolveDefaultDialCode(event?.brand?.country ?? null), [event?.brand?.country]);
   ```
4. **Add required-ness indicators** to Name + Email + Phone field labels (asterisk OR pill per §10 Q2 answer).
5. **Update** `validate()` at lines 75-98 — the `phoneValid` line now reads:
   ```tsx
   const phoneValid = isValidE164(phoneTrim);
   ```
   Import update: `import { isValidE164 } from "../../../src/utils/phone";`
6. **Update** error copy at line 95 — keep `"Enter a valid mobile number"`.

**No change to `CartContext.tsx`** — `BuyerDetails.phone` stays as a single `string` field (the full E.164 value). The country picker is purely a UI helper that composes the value.

**No change to `payment.tsx` or `confirm.tsx`** — they read `buyer.phone` directly and don't care how it was composed.

**Mobile-web parity:** This change automatically applies to `surface: "mobile-web"` because the same `buyer.tsx` route handles both web and mobile-web buyers.

---

## §5. Success criteria

### Workstream 1 — Consumer multi-tier quantity cart sheet

**SC-01.** Tapping any tier's "Buy" or "Get Free" CTA inside `ExpandedBusinessEventSheet` opens `<TicketCartSheet>` (NOT the old `TicketClaimConfirmModal`) with the tapped tier seeded at quantity 1.

**SC-02.** `<TicketCartSheet>` renders a `<QuantityRow>` per visible+available ticket-type, sorted by `display_order`, mirroring `mingla-business/app/checkout/[eventId]/index.tsx:260-280` within 8pt visual tolerance for each tier-row element (badge, name, stepper, price text, "X left" caption, description, sale banner).

**SC-03.** Stepper `+`/`−` buttons respect `ticket_types.min_purchase_qty` (default 1), `ticket_types.max_purchase_qty` (null = unbounded by per-tier cap), `ticket_types.quantity_total` capacity (sold-out hides stepper, shows "Sold out" badge), `sale_start_at` (not-yet-open shows "Sales open {date}" banner, stepper hidden), `sale_end_at` (ended shows "Sales ended" banner, stepper hidden), `is_disabled` (greyed, stepper hidden, "Sales paused" banner). Verified by reusing `QuantityRow` component from mingla-business.

**SC-04.** Cart total preview at the sticky bottom bar updates synchronously on every stepper tap; `Subtotal` shows `formatCurrency(sum(line.unitPrice * line.quantity), currency)` for paid carts, `Free` for $0 carts with ≥ 1 line, `—` for empty cart.

**SC-05.** Primary CTA label is `Add tickets above` (disabled) when cart empty, `Claim Free Ticket` (enabled) when cart total === 0 and itemCount ≥ 1, `Continue to Payment` (enabled) when cart total > 0.

**SC-06.** Tapping the primary CTA on a paid cart calls `runNativeCheckout` with a multi-line `lines[]` payload representing every tier with quantity > 0. PaymentSheet opens with the full cart total. After successful payment, every ticket appears in the calendar-tab "Tickets" section within the existing 3×1s polling window.

**SC-07.** Tapping the primary CTA on a free cart (all-free or empty-paid + free tiers totaling $0) routes through `ticket-checkout-create`'s free short-circuit (no PaymentSheet shown) and immediately surfaces the success toast + calendar invalidation.

**SC-08.** Mixed carts (some paid tiers + some free tiers, total > 0) route to paid path with all tickets created server-side via `biz_ticket_checkout_finalize`.

**SC-09.** Closing the cart sheet (backdrop tap, swipe-down, or × button) resets the cart state to empty. Re-opening with a different tier seed starts fresh.

**SC-10.** During `isSubmitting === true`, stepper buttons are disabled and primary CTA shows an `ActivityIndicator`; backdrop tap and swipe-down are no-ops to prevent dismissal mid-charge.

**SC-11.** The deleted `TicketClaimConfirmModal.tsx` file is removed from disk; no imports reference it; the strict-grep gate (§9) catches any reintroduction.

### Workstream 2 — Marketing opt-in checkbox

**SC-12.** The opt-in checkbox renders below the last tier row and above the sticky bar in `<TicketCartSheet>`, default-unchecked.

**SC-13.** Tapping the checkbox row (label or box) toggles state with `accessibilityState.checked` reflecting the new value.

**SC-14.** Copy is verbatim: `Email me about this organiser's future events` — matches `mingla-business/app/checkout/[eventId]/buyer.tsx:415` exactly.

**SC-15.** Closing and re-opening the cart sheet resets opt-in state to `false`.

**SC-16.** When the primary CTA fires, the checked state is passed to `runNativeCheckout` as `buyer.marketingOptIn` and lands on the resulting `ticket_checkout_sessions.metadata.marketing_opt_in` field. Verifiable via `mcp__supabase__execute_sql` query post-test against a known checkout session.

### Workstream 3 — Public phone field UX

**SC-17.** `<PhoneInputField>` replaces the plain `<Input variant="text" placeholder="Mobile number">` at `mingla-business/app/checkout/[eventId]/buyer.tsx:378-391`.

**SC-18.** The country picker button left-aligns, shows `{flag} {dialCode}`, is tappable to open the country picker sheet.

**SC-19.** Local digits input accepts digits only (`keyboardType="phone-pad"`, input filter strips non-digits) and is `flex: 1` to the right of the country button.

**SC-20.** Default country resolves from `expo-localization.Localization.region` first, falling back to brand country, then `+44` (GB). Verified by mounting the form on a US-locale device and confirming `+1` is preselected.

**SC-21.** Country picker sheet lists ≥ 50 countries (full ITU-T list ~250 entries), is searchable by name and dial code, and selecting a row updates the dial code and recomposes the field value via `composeE164(newDialCode, currentLocalDigits)`.

**SC-22.** A "Required" indicator (asterisk or pill per §10 Q2 answer) renders on the Name, Email, and Phone field labels.

**SC-23.** `isValidE164(buyer.phone)` is the validator used in `buyer.tsx:validate()`. Continue button is disabled until all three (name, email, phone) pass validation, exactly as today.

**SC-24.** The composed E.164 string the field emits MUST match the server-side regex `^\+[1-9][0-9]{1,14}$` — verified by submitting the form and inspecting the request payload (or by unit test).

**SC-25.** A buyer with a UK number (e.g., `+447700900000`) can complete checkout end-to-end through Stripe and have their `orders.buyer_phone_e164` row populated with the full E.164 string.

**SC-26.** A buyer with a Nigerian number (e.g., `+2348012345678`) can complete checkout end-to-end — the country picker provides `+234`, the local digits input accepts the 10 subscriber digits, the composed string passes `isValidE164`, and the server accepts it.

**SC-27.** A buyer typing only `+1234` (too short to be a valid NSN for any country) sees the inline error `Enter a valid mobile number` after blur and Continue stays disabled.

**SC-28.** Mobile-web parity: the same `<PhoneInputField>` works on `surface: "mobile-web"` (mingla-business app inside `openAuthSessionAsync` browser session) — verified by the same buyer.tsx route handling both web and mobile-web traffic.

### Cross-workstream

**SC-29.** No edge function changes deployed. Verified by `git diff supabase/functions/` returning empty under the SPEC PR.

**SC-30.** No migration files added under `supabase/migrations/`. Verified by `git diff supabase/migrations/` returning empty under the SPEC PR.

**SC-31.** Anonymous public buyer flow regression check passes — a sim/browser run of the public flow (open public event URL → cart → buyer form with new phone field → Stripe Hosted Checkout → email + PDF delivery) succeeds end-to-end with a non-US phone number.

**SC-32.** Consumer free-ticket path regression check passes — a sim run of consumer cart with a single $0 tier completes via the free short-circuit, ticket appears in calendar tab.

---

## §6. Invariants preserved + new

### Existing invariants preserved

- **`feedback_anon_buyer_routes`** — `/checkout/{eventId}`, `/e/{brandSlug}/{eventSlug}`, `/b/{brandSlug}` stay outside `(tabs)/`, never call `useAuth`. Workstream 3 modifies `buyer.tsx` but does NOT introduce auth. Preserved by code review + existing CI gate.
- **`feedback_zustand_persist_no_server_snapshots`** — `useTicketCart` uses `useReducer` not Zustand. Cart never persists. Preserved.
- **`feedback_keyboard_never_blocks_input`** — buyer.tsx already implements the keyboard-listener + dynamic paddingBottom + deferred scrollToEnd pattern (lines 119-162). PhoneInputField does not regress this; the local digits input uses `requestScrollToInput` via `onFocus` prop.
- **`feedback_rn_color_formats`** — inline-style colors stay hex/rgb/hsl/hwb only. PhoneInputField + TicketCartSheet styles audited.
- **`feedback_rn_sub_sheet_must_render_inside_parent`** — TicketCartSheet renders as sibling `<BottomSheet>` in the same return fragment as ExpandedBusinessEventSheet's primary `<BottomSheet>`, mirroring the current TicketClaimConfirmModal mounting pattern (which is the canonical pattern).
- **`I-PROPOSED-TICKET-CLAIM-CONFIRMATION-REQUIRED`** (ORCH-0829-A) — the spec said "every transactional action gets at least one confirmation step." TicketCartSheet IS the confirmation step (cart review + opt-in + buyer recap + primary CTA). The user must explicitly tap "Continue to Payment" / "Claim Free Ticket" to proceed. **Invariant preserved with new mechanism** — this SPEC documents the mechanism shift (single-ticket modal → multi-tier cart sheet) without breaking the invariant intent.
- **`I-PROPOSED-CONFIRMATION-SHEET-VIA-GORHOM`** (ORCH-0834-rescoped) — confirmation surfaces use `@gorhom/bottom-sheet`. TicketCartSheet uses it. Preserved.
- **Anon-tolerant buyer invariant** — public flow continues to work for anonymous buyers. Workstream 3 does not introduce auth requirements. Regression-tested per SC-31.
- **`I-PROPOSED-AW` CHECKOUT_SESSION_NEVER_REUSED_POST_TERMINAL** (ORCH-0791 / 0829-B-D1) — multi-line carts compose a different idempotency-key hash than single-line carts (per `checkoutIdempotencyKey` sorted-line composition); no post-terminal session reuse risk introduced.
- **`I-PROPOSED-BB` SCAN_TIME_WINDOW_ENFORCED** — scan RPC unchanged; tickets created by multi-tier orders still scan correctly.

### New invariants this SPEC establishes

- **`I-PROPOSED-CONSUMER-MULTI-LINE-CHECKOUT`** (NEW) — every consumer-side `ticket-checkout-create` call MUST send a `lines[]` array (length ≥ 1) — never a hardcoded single-line shape. CI gate per §9.
- **`I-PROPOSED-PUBLIC-PHONE-FIELD-E164-CLIENT-SIDE`** (NEW) — the public buyer form's phone input MUST emit a properly-formed E.164 string client-side; the server's US-fallback branch (`_shared/ticketCheckout.ts:83-84`) MUST NOT be relied on by new code. CI gate: strict-grep on `buyer.tsx` to ensure `<PhoneInputField>` is imported (not a plain `<Input variant="text">` for phone).
- **`I-PROPOSED-MARKETING-OPT-IN-DEFAULT-UNCHECKED`** (NEW) — every marketing-opt-in UI surface (consumer + public) MUST default to `unchecked`. Pre-checking is a compliance violation. CI gate: strict-grep on opt-in checkbox initial state.

---

## §7. Test cases

| ID | Scenario | Input | Expected | Layer |
|----|----------|-------|----------|-------|
| **Workstream 1 — happy** ||||
| T-01 | Single-tier paid cart | Tap "Buy" on £10 GA, sheet opens with qty 1, tap +, total = £20, Continue → PaymentSheet | PaymentSheet opens with £20.00, after success ticket appears in calendar tab within 3s | Component + Service + Edge fn |
| T-02 | Multi-tier paid cart | Tap "Buy" on £10 GA → qty 2, increment £25 VIP to qty 1, total = £45, Continue → PaymentSheet | PaymentSheet opens with £45.00; 3 tickets (2 GA + 1 VIP) appear in calendar tab | Component + Service + Edge fn |
| T-03 | All-free cart (single tier) | Tap "Get Free" on £0 RSVP, sheet opens with qty 1, Continue ("Claim Free Ticket") | No PaymentSheet; success toast "Ticket secured!"; calendar tab shows ticket within 1s | Component + Edge fn free path |
| T-04 | All-free cart (multi-tier) | All tiers free; pick 2 of Tier A + 1 of Tier B, Continue | No PaymentSheet; 3 tickets created via free short-circuit | Component + Edge fn |
| T-05 | Mixed cart (free + paid tiers, total > 0) | 1 free RSVP + 1 £10 GA, total £10, Continue → PaymentSheet | PaymentSheet opens with £10.00; 2 tickets (1 RSVP + 1 GA) created server-side | Component + Edge fn |
| **Workstream 1 — edge** ||||
| T-06 | Cart at `min_purchase_qty` boundary | Tier with `min_purchase_qty=2`, tap +, qty jumps to 2 directly; tap −, qty drops to 0 (deselects entirely) | First add jumps to min; decrement to 0 always allowed | Component (QuantityRow inherited) |
| T-07 | Cart at `max_purchase_qty` boundary | Tier with `max_purchase_qty=4`, increment 4 times; 5th + tap | + button disabled at qty 4; no further increment | Component |
| T-08 | Sold-out tier | Tier with `quantity_total=0`, sheet renders | "Sold out" badge shown; stepper hidden; row visually greyed | Component |
| T-09 | Sale-not-yet-open tier | Tier with `sale_start_at` in future | "Sales open {date}" banner; stepper hidden | Component |
| T-10 | All tiers sold out | Every tier `quantity_total=0` | Sheet shows "Sold out. Check back later." + Close CTA | Component |
| T-11 | Sheet closes during checkout | User taps swipe-down while PaymentSheet is open | Cart sheet swipe-down is no-op (`isSubmitting=true` guards); PaymentSheet stays open | Component + Hook |
| T-12 | Re-open after cancel | Tap tier → cart sheet opens → tap × close → tap same tier → cart sheet opens | Cart state reset; second open seeded fresh at qty 1 | Hook + Component |
| **Workstream 1 — error** ||||
| T-13 | Empty cart Continue | Cart qty all 0, tap CTA | CTA is disabled ("Add tickets above" label); no edge function call | Component |
| T-14 | Network failure during checkout | Continue → kill network mid-Stripe init | Toast "Couldn't reach checkout. Tap to try again."; cart state preserved; can retry | Component + Service |
| T-15 | PaymentSheet user cancel | Continue → PaymentSheet opens → user dismisses | Silent (no toast); cart sheet returns visible; user can retry | Component |
| T-16 | Server rejects (stripe_account_not_ready) | Brand has no Stripe Connect account | Edge function returns 409; toast surfaces "Brand cannot accept payments yet" or similar | Component + Edge fn |
| **Workstream 2** ||||
| T-17 | Default unchecked | Open cart sheet | Checkbox renders unchecked (border-only state, no fill) | Component |
| T-18 | Toggle on, complete checkout | Tap opt-in to check, complete paid checkout | Post-checkout: `SELECT metadata->>'marketing_opt_in' FROM ticket_checkout_sessions WHERE id = ?` returns `'true'` | Component + Edge fn + DB |
| T-19 | Toggle off after toggle on | Tap to check, tap again to uncheck, complete checkout | DB row has `marketing_opt_in = 'false'` | Component + Edge fn + DB |
| T-20 | Reset on sheet close | Tap to check, close sheet without Continue, re-open | Re-opened sheet shows unchecked | Component |
| **Workstream 3 — happy** ||||
| T-21 | UK buyer flow | Default `+44`, type "7700900000", Continue → Stripe → success | `orders.buyer_phone_e164 = '+447700900000'`; email delivered | Component + Service + Edge fn + DB |
| T-22 | US buyer flow | Tap country picker → select "United States +1", type "4155551234", Continue | `orders.buyer_phone_e164 = '+14155551234'` | Component + Edge fn + DB |
| T-23 | Nigerian buyer flow | Tap picker → "Nigeria +234", type "8012345678" | `orders.buyer_phone_e164 = '+2348012345678'` | Component + Edge fn + DB |
| T-24 | Default-country from locale | Mount form on iOS sim with US locale | Country picker preselected to "+1" without user action | Component (Localization) |
| **Workstream 3 — edge** ||||
| T-25 | Country picker search | Open picker, type "nig" in search | "Nigeria +234" surfaces in results | Component |
| T-26 | Local-digits filter | Type "abc-1234-defg" into local digits field | Field shows only "1234" (non-digits stripped) | Component |
| T-27 | Switch country after typing | Type "7700900000" while on +44, switch to "+1" | Composed value becomes "+17700900000"; validation re-runs | Component |
| **Workstream 3 — error** ||||
| T-28 | Empty phone, blur, Continue | Leave phone blank, blur out, tap Continue | Inline error "Enter a valid mobile number" under phone; Continue stays disabled | Component |
| T-29 | Too-short number | Type "12" into local digits, blur | Inline error appears | Component |
| T-30 | Required indicator visible | Mount form fresh | Asterisk or pill renders next to Name, Email, Phone labels | Component |
| **Cross-workstream regression** ||||
| T-31 | Anonymous public buyer end-to-end | Open `/e/{brandSlug}/{eventSlug}` URL anonymously → cart → buyer form (new phone field) → Stripe Hosted Checkout → success | Buyer receives email + PDF; `orders.buyer_user_id IS NULL`; anon-tolerant invariant preserved | Public flow regression |
| T-32 | Consumer free path regression | Open consumer event sheet → cart sheet → all-free cart → Claim | Ticket in calendar tab; no PaymentSheet | Consumer free path regression |
| T-33 | Edge function unchanged | `git diff supabase/functions/` after PR | Empty | CI |
| T-34 | Migration unchanged | `git diff supabase/migrations/` after PR | Empty | CI |
| **Adversarial regression (META-ORCH-0840 Step 0.5)** ||||
| T-35 | **Adversarial:** PhoneInputField composes wrong E.164 when country code changes mid-typing | Type "7700" while on +44; switch to +1 mid-entry; submit | Verifies composed value updates synchronously, NOT staleness; if implementation has a stale-closure bug, the test FAILS | Component (race / closure) |
| T-36 | **Adversarial:** Multi-tier cart with `max_purchase_qty=NULL` and `quantity_total=3` | Try to increment to 5 | Stepper hard-stops at 3 (capacity cap), not at maxPurchaseQty (which is unbounded). Verifies effectiveMax = min(remainingCapacity, maxPurchaseQty ?? Infinity) | Component (boundary) |
| T-37 | **Adversarial:** Cart sheet survives parent ExpandedBusinessEventSheet swipe-down during isSubmitting | Open cart sheet → Continue → swipe down on PARENT sheet | Parent sheet dismisses, cart sheet also dismisses; PaymentSheet state preserved; checkoutInFlight flag clears via try/finally per ORCH-0829-B-D1 | Integration |

**Implementor MUST write T-35, T-36, T-37 attack tests (one per workstream, picking the strongest angle for each) plus happy-path T-01, T-17, T-21. Tester writes additional adversarial coverage at QA time per CLOSE Step 0.5 (different attack angle than implementor — operator-flagged precedent).**

---

## §8. Implementation order

1. **Country data file** — Create `mingla-business/src/utils/countries.ts` with full ITU-T list (~250 entries). Hardcoded for zero runtime dependency. No tests beyond a count sanity assertion.
2. **`<PhoneInputField>` component** — Create `mingla-business/src/components/checkout/PhoneInputField.tsx`. Use `@gorhom/bottom-sheet` for the country picker sheet. Self-contained; no buyer.tsx changes yet. Write unit tests T-25, T-26, T-27, T-35.
3. **`mingla-business/src/utils/phone.ts` update** — Replace contents with `isValidE164` + `composeE164` per §4.3.3. Keep `isRequiredPhoneValid` as deprecated alias.
4. **Wire `<PhoneInputField>` into `mingla-business/app/checkout/[eventId]/buyer.tsx`** — Replace the existing phone Input block; add required-ness indicators to Name + Email + Phone labels; update validator import. Write T-21, T-22, T-23, T-24, T-28, T-29, T-30, T-31.
5. **Pre-flight design step (mandatory per memory `feedback_implementor_uses_ui_ux_pro_max`):** Implementor MUST invoke `/ui-ux-pro-max` BEFORE writing TicketCartSheet code, to confirm tier-row spacing, sticky-bar height, opt-in checkbox styling, buyer recap typography, and snap-point against the public J-C1 reference within 8pt visual tolerance per SC-02.
6. **`QuantityRow` extraction** — If `QuantityRow.tsx` is tightly coupled to mingla-business types, extract to a shared location (recommend `packages/event-rendering/QuantityRow.tsx` since that package already serves both apps). Verify mingla-business import still works after move.
7. **`useTicketCart` hook** — Create `app-mobile/src/hooks/useTicketCart.ts` per §4.1.4. Write unit tests for line aggregation, totals computation, reset.
8. **`<TicketCartSheet>` component** — Create `app-mobile/src/components/expandedCard/TicketCartSheet.tsx`. Mirror public J-C1 layout. Include marketing opt-in checkbox (Workstream 2). Write T-01 through T-20, T-32, T-36, T-37.
9. **Wire `<TicketCartSheet>` into `ExpandedBusinessEventSheet.tsx`** per §4.1.6: replace `pendingClaim` state with `cartSheetVisible`+`initialTicketTypeId`; rewrite `handleBuy` signature; update `callbacks.onBuyTicket` / `onClaimFreeTicket`; swap modal render block.
10. **Delete `TicketClaimConfirmModal.tsx`** — only after all references are removed.
11. **Strict-grep CI gates** — Add per §9.
12. **Regression run** — Execute full T-01..T-37 on iOS sim + Android emulator + mingla-business web in browser. PASS required on all platforms per memory `feedback_tester_canonical_and_platform_parity`.

---

## §9. Regression prevention

**Strict-grep registry gates** — plug into existing `.github/workflows/strict-grep-mingla-business.yml` per memory `feedback_strict_grep_registry_pattern`. Never create a parallel workflow file.

**Gate 1: `orch-0847-consumer-multi-line-checkout.mjs`**
- Asserts: no occurrence of `lines: [{ ticketTypeId:` followed by `quantity: 1 }]` literal in `app-mobile/src/` (catches hardcoded single-line shape regression).
- Asserts: every call site of `runNativeCheckout` passes a `lines` array that's not a literal single-line constant.
- Codifies invariant `I-PROPOSED-CONSUMER-MULTI-LINE-CHECKOUT`.

**Gate 2: `orch-0847-public-phone-field-e164.mjs`**
- Asserts: `mingla-business/app/checkout/[eventId]/buyer.tsx` imports `PhoneInputField` from `../../../src/components/checkout/PhoneInputField`.
- Asserts: `mingla-business/app/checkout/[eventId]/buyer.tsx` does NOT contain a plain `<Input ... placeholder="Mobile number"` line (catches regression to the old field).
- Asserts: validator call site uses `isValidE164` not `isRequiredPhoneValid` in `buyer.tsx`.
- Codifies invariant `I-PROPOSED-PUBLIC-PHONE-FIELD-E164-CLIENT-SIDE`.

**Gate 3: `orch-0847-marketing-opt-in-default-unchecked.mjs`**
- Asserts: every `setMarketingOptIn` / `marketingOptIn` initial state in `TicketCartSheet.tsx` is `useState<boolean>(false)` not `(true)`.
- Asserts: same for `buyer.tsx` CartContext default (`marketingOptIn: false` at CartContext.tsx:127).
- Codifies invariant `I-PROPOSED-MARKETING-OPT-IN-DEFAULT-UNCHECKED`.

**Gate 4: `orch-0847-ticket-claim-confirm-modal-removed.mjs`**
- Asserts: no file at `app-mobile/src/components/expandedCard/TicketClaimConfirmModal.tsx` exists.
- Asserts: no import of `TicketClaimConfirmModal` anywhere in `app-mobile/`.
- Prevents accidental restoration during rebase / cherry-pick.

**Regression test files (CLOSE Step 0.5 mandatory):**
- Implementor's happy-path test: `app-mobile/src/components/expandedCard/__tests__/TicketCartSheet.test.tsx` covering T-01, T-02, T-17, T-18.
- Adversarial regression: same path with `__tests__/TicketCartSheet.adversarial.test.tsx` covering T-35 (or rotate to T-36 / T-37 per tester's angle choice).
- Public-side regression: `mingla-business/src/components/checkout/__tests__/PhoneInputField.test.tsx` covering T-21, T-22, T-23, T-25, T-26, T-27.
- Append-only enforcement: per `.github/workflows/tests-append-only.yml` (existing per META-ORCH-0840), these test files become immutable once landed.

**Fails-on-revert verification (Step 0.5 gate):**
- Implementor MUST verify that reverting the `<PhoneInputField>` change in buyer.tsx causes T-23 (Nigerian buyer) to FAIL (the old US-only validator rejects `+234...`).
- Implementor MUST verify that reverting the cart sheet wiring in ExpandedBusinessEventSheet causes T-02 (multi-tier paid cart) to FAIL (single-line hardcode at line 235 sends only one line).
- Both reverts documented in implementation report with commit hashes.

---

## §10. Operator decisions (answered 2026-05-15)

**Q1 → Option A: locale-first.** Default country resolves from device locale → brand country → +44 (GB) fallback. Implementor uses `expo-localization.Localization.region` as the primary signal.

**Q2 → Required indicator: asterisk `*` after the field label.** Apply to Name, Email, Phone labels on `mingla-business/app/checkout/[eventId]/buyer.tsx`. Single character; visual noise minimal; industry standard.

**Q3 → Reuse existing consumer onboarding stack.** The consumer app already ships a country-picker phone field for auth onboarding:
- `app-mobile/src/components/onboarding/PhoneInput.tsx` (276 lines — country trigger + local digits + i18n + animations + InputAccessoryView)
- `app-mobile/src/components/onboarding/CountryPickerModal.tsx` (345 lines — full-screen modal with search + flag + dial code + ISO-2 mapping)
- `app-mobile/src/constants/countries.ts` (full country list with `getCountryByCode` helper)

**Implementation revision:** Extract these three files to a shared package, then both apps import from it. Recommended destination is the new package `packages/phone-input/` (rather than `packages/event-rendering/`) because the asset is generic — it's a phone-input building block, not event-page UX. `QuantityRow` still goes to `packages/event-rendering/` per Q4.

Implementor MUST:
1. Move the three files from `app-mobile/src/components/onboarding/` + `app-mobile/src/constants/countries.ts` to `packages/phone-input/`.
2. Update `app-mobile/src/components/onboarding/` import sites to consume from `@mingla/phone-input` (or whatever the package name resolves to per existing `packages/` conventions — check `packages/event-rendering/package.json` for the pattern).
3. Update `mingla-business/app/checkout/[eventId]/buyer.tsx` to import `PhoneInput` from the same shared location and use it in place of the plain `<Input variant="text" placeholder="Mobile number">`.
4. Verify the existing onboarding flow on app-mobile still works after the move (regression test the auth signup).
5. Drop the previously-planned NEW components `<PhoneInputField>` and `mingla-business/src/utils/countries.ts` from the spec — the shared `PhoneInput` replaces them.
6. Keep the `mingla-business/src/utils/phone.ts` rewrite (`isValidE164` + `composeE164`) — these helpers complement (not duplicate) what the existing `PhoneInput` returns; the public buyer form's `validate()` uses `isValidE164` to gate the Continue button.

**Q4 → `packages/event-rendering/QuantityRow.tsx`.** Extract `QuantityRow` from mingla-business into the existing shared package where `PublicEventPage` already lives. Both apps import from there.

**Q1 — Default country resolution priority.**
Locale → brand country → +44 (GB) is the recommendation. Some buyers may have device locale ≠ their phone-number country (expat travelers). Alternative: brand country first, then locale, then +44. Which order?

**Q2 — Required-ness indicator style.**
Two options for the visible required indicator on Name / Email / Phone field labels:
- (a) Asterisk `*` after the label text (industry-standard, terse).
- (b) Small "Required" pill in field's top-right corner (more explicit but more visual noise).
Which?

**Q3 — Country data source.**
Two options for the ~250-entry country list:
- (a) Hardcoded in `mingla-business/src/utils/countries.ts` (no runtime dependency; ~15KB; never goes stale beyond ITU-T changes which happen yearly at most).
- (b) Import from a maintained npm package (e.g., `country-list` or similar; one more dependency, but lower long-term maintenance).
Recommend (a). Confirm?

**Q4 — `QuantityRow` extraction destination.**
The component currently lives at `mingla-business/src/components/checkout/QuantityRow.tsx` and is coupled to the mingla-business `TicketStub` type from `draftEventStore`. To reuse on consumer, it must be extracted. Two destinations:
- (a) `packages/event-rendering/QuantityRow.tsx` — adds to the existing shared package; matches where `PublicEventPage` lives.
- (b) New `packages/ticket-cart/QuantityRow.tsx` package — isolates cart UI as a separate package; cleaner separation of concerns.
Recommend (a). Confirm?

---

## §11. Discoveries for Orchestrator

- **Server `normalizePhoneE164` US-fallback is dead code post-ORCH-0847.** After Workstream 3 ships, no client emits a 10-or-11-digit US-shaped string to the edge function. The fallback at `_shared/ticketCheckout.ts:83-84` stays for back-compat with hypothetical other callers, but is functionally unused for ticket checkout. Consider a follow-up cleanup ORCH to remove it.
- **`mingla-business/src/utils/phone.ts` is currently a 12-line file.** The deprecated `isRequiredPhoneValid` alias adds a small amount of surface area; if a grep shows no other call site than `buyer.tsx`, the deprecated export can be removed in the same PR (implementor's discretion, not a blocker).
- **`useCart` hook in mingla-business is feature-rich.** The consumer's new `useTicketCart` is intentionally lighter (no buyer details, no `recordResult` post-purchase storage, no marketing checkbox state — those live elsewhere). If mingla-business and the consumer ever need a fully shared cart hook, that's a separate ORCH.
- **`profile.phone` collected at auth signup but not currently validated in onboarding.** Out of scope for ORCH-0847 (Seth confirmed). Worth a separate verification ORCH to ensure all consumer accounts have valid E.164 stored.
- **Phase A marketing-audience resolver does NOT filter on `marketing_opt_in`.** `mingla-business/src/services/marketing/marketingAudienceService.ts:100-205` resolves `brand_buyers` / `event_buyers` audiences purely from `orders.payment_status IN ('paid','partial_refund')` + brand/event scope. The `marketing_opt_in` flag is stored on session metadata but never read for suppression. This is the Phase 0 consent gap per memory `project_marketing_hub_strategy` — flagged for the next strategic decision on consent infrastructure.

---

## §12. Confidence

**HIGH** on every workstream — code read directly for every file referenced; edge-function contracts and DB schema verified against latest migrations; public J-C1 / J-C2 / public PhoneInputField targets read line-by-line; `_shared/ticketCheckout.ts` validator regex matched explicitly between client and server.

**Sources, every file:line citation, and full request/response shapes live in §2–§4 above and in the investigation report at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0847_CONSUMER_TICKET_PURCHASE_PARITY.md`.**
