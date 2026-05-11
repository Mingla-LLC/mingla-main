# SPEC — ORCH-0789 + ORCH-0790: Public Ticket Checkout Failure-Handling (mobile) + Web Buyer Payment Flow

**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Mode:** SPEC (contract). No implementation.
**Predecessor:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0789_AND_0790_PUBLIC_TICKET_CHECKOUT_FAILURE_HANDLING_AND_WEB_BUYER_FLOW.md`.
**Implementor target:** Codex `implementor-mingla` (default IMPLEMENT owner; Claude `mingla-implementor` is a parity peer if operator delegates).

---

## 1. Scope and non-goals

### In scope (this spec)

1. **ORCH-0789 / iPhone stuck-toast + cancel-mis-classification.** Three coordinated layer fixes:
   - **a. Toast primitive** — make `kind="error"` user-dismissible (close icon + tap-to-dismiss + bounded fallback auto-dismiss).
   - **b. Stripe wrapper** — preserve `code: "Canceled" | "Failed" | "Timeout"` and `declineCode?: string` through `PaymentSheetResult` on both `.native.ts` and the `.ts` Metro fallback.
   - **c. `payment.tsx` `handlePay`** — branch on `payResult.error.code`: `Canceled` → silent return (no toast), `Failed` → existing decline toast (now dismissible per 1a), `Timeout` → distinct timeout toast.

2. **ORCH-0790 / web buyer paid checkout.** Stripe **Checkout Sessions** path for desktop and mobile web (operator-recommended in Open Question 1).
   - Extend `ticket-checkout-create` edge function to accept `surface: "native" | "web"` and, when `surface === "web"`, create a Stripe Checkout Session on the platform with destination charges (mirroring the existing PaymentIntent's `transfer_data.destination = stripeAccountId`) and return `{kind: "requires_web_redirect", hostedCheckoutUrl, checkoutSessionId, buyerStatusToken, ...}`.
   - Update `mingla-business/src/services/ticketCheckoutService.ts` to discriminate the new `kind`.
   - Update `mingla-business/app/checkout/[eventId]/payment.tsx` so that on web it issues `createTicketCheckout({surface: "web"})` and redirects (`window.location.assign(hostedCheckoutUrl)`); on native it keeps the existing PaymentSheet path.
   - Stripe Checkout success URL → `/checkout/{eventId}/confirm?session_id={CHECKOUT_SESSION_ID}`. Cancel URL → `/checkout/{eventId}/payment` (back where the buyer was, no toast).
   - The existing webhook router (`supabase/functions/_shared/stripeWebhookRouter.ts`) already finalises ticket orders from `payment_intent.succeeded`; the Checkout-Session-driven PaymentIntent will route through the same handler. Webhook code changes are limited to ensuring the Mingla metadata stamp (`mingla_checkout_session_id`, `mingla_event_id`, `mingla_buyer_email`) is preserved on the Checkout Session's `payment_intent_data.metadata`.

3. **Strict-grep CI gate** `orch-0789-error-toast-dismissible` per registry pattern (memory `feedback_strict_grep_registry_pattern.md`): one script + one job appended to `.github/workflows/strict-grep-mingla-business.yml`.

4. **Two new proposed invariants** registered (DRAFT, flip to ACTIVE on CLOSE):
   - `I-PROPOSED-ERROR-TOAST-DISMISSIBLE` — every `<Toast kind="error">` is user-dismissible without external state changes.
   - `I-PROPOSED-STRIPE-ERROR-CODE-DISCRIMINATED` — Mingla Business Stripe wrapper preserves `PaymentSheetError` code so callers can distinguish `Canceled` from `Failed`.

### Non-goals (explicitly NOT in this spec)

- Stripe Payment Element (in-page Stripe.js Elements) integration. Operator-deferred per Open Question 1 — Checkout Sessions ships v1, in-page Elements is a future ORCH if brand-in-buyer-frame becomes a launch blocker.
- Apple Pay / Google Pay native integration on iOS/Android beyond what Stripe RN's PaymentSheet already offers. (Stripe Checkout Sessions on web auto-handles wallet payments — no extra work.)
- Server-side reconciliation of orphan client-cancelled PaymentIntents. Operator-deferred to a new sub-ORCH at P2 (see Discovery DISC-1 in the investigation).
- `Toast.tsx` visual redesign — only the dismiss-affordance contract changes. Existing 5-layer glass card and orange/red token palette unchanged.
- Cleanup of the stale `toastWrap` View at `payment.tsx:361-368`. Allowed as housekeeping but not required.
- Removal of the Metro-fallback `stripePaymentSheet.ts` (Discovery DISC-2) — separate P3 ORCH.
- Buyer notification email content changes (ORCH-0785 owns; ORCH-0788 owns dispatcher).
- Organiser refund/cancel flow (ORCH-0787 territory; closed but separate).
- Native iOS/Android in-app browser flows for the Checkout Session redirect — out of scope; web buyers redirect within their existing browser, native buyers continue to use the PaymentSheet.

### Assumptions

- The platform's Stripe restricted API key (`STRIPE_RAK_TICKET_CHECKOUT` or platform secret already used by `stripeTicketCheckout()` in `_shared/stripe.ts`) has scope to create Checkout Sessions. **Verification step for implementor:** if the existing RAK only permits `payment_intents:write`, the implementor must NOT add a new key in this dispatch — surface to operator as a deploy-gate blocker and the operator will mint a new RAK with `checkout_sessions:write` (similar to ORCH-0787's pattern). Do not proceed past Phase 2 of implementation if scope is insufficient.
- The connected account model is destination charges via `transfer_data.destination = stripeAccountId` (proven in `ticket-checkout-create/index.ts:144-172`). Checkout Sessions will mirror this exactly via `payment_intent_data.transfer_data.destination`.
- Mingla Business web is served at the same origin as the universal-link domain that Stripe success/cancel redirects can return to. Implementor must confirm the production web URL with the operator before hard-coding into `success_url`/`cancel_url` — until confirmed, use the public domain from `MINGLA_PUBLIC_WEB_BASE_URL` env var (new — to be added to `supabase/config.toml` `[functions.ticket-checkout-create].env` allowlist).
- Buyer routes remain anon-tolerant (memory `feedback_anon_buyer_routes.md`); no `useAuth` calls and `orders.account_id` stays nullable. Preserved.

---

## 2. Layer-by-layer specification

### 2.1 Toast primitive — `mingla-business/src/components/ui/Toast.tsx`

#### Interface changes (additive, no breaking renames)

```ts
export type ToastKind = "success" | "error" | "warn" | "info";

export interface ToastProps {
  visible: boolean;
  kind: ToastKind;
  message: string;
  onDismiss: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /**
   * Optional override for the per-kind auto-dismiss timer (ms).
   * Default: success/info = 2600, warn = 6000, error = 12000.
   * Pass null to disable auto-dismiss for this instance (only callers
   * that guarantee an external dismiss path may do so).
   */
  autoDismissMs?: number | null;
}
```

#### `AUTO_DISMISS` default change

Replace:
```ts
const AUTO_DISMISS: Record<ToastKind, number | null> = {
  success: 2600,
  info: 2600,
  warn: 6000,
  error: null,
};
```

With:
```ts
const AUTO_DISMISS: Record<ToastKind, number> = {
  success: 2600,
  info: 2600,
  warn: 6000,
  error: 12000,
};
```

`AUTO_DISMISS.error` becomes 12 s (operator-recommended in Open Question 3). The `null` case is gone from defaults; per-instance opt-out is still possible via `autoDismissMs={null}` but is the explicit exception.

Auto-dismiss `useEffect` (lines 218–224) updates to read `props.autoDismissMs ?? AUTO_DISMISS[kind]` and only skips the timer when the resolved value is `null`. (Type-narrow with `if (ms === null) return;`.)

#### Dismiss affordances (render-tree changes)

Inside the existing `<Animated.View ... style={[styles.wrap, ...]}>` at the body content row (current lines 305–313), wrap the entire toast card in a `Pressable` whose `onPress` calls `onDismiss`. The `Pressable` covers the whole card body so any tap dismisses.

Additionally, add a 32 × 32 close-icon button positioned at the right of `styles.body`:

```tsx
<View style={styles.body}>
  <View style={[styles.iconBadge, { backgroundColor: tokens.iconBg }]}>
    <Icon name={tokens.icon} size={18} color="#ffffff" />
  </View>
  <Text style={styles.message} numberOfLines={3}>
    {message}
  </Text>
  <Pressable
    onPress={onDismiss}
    hitSlop={12}
    accessibilityRole="button"
    accessibilityLabel="Dismiss notification"
    style={styles.closeButton}
  >
    <Icon name="close" size={16} color={textTokens.primary} />
  </Pressable>
</View>
```

`styles.closeButton` is a 32 × 32 transparent hit target, right-aligned, flexShrink: 0. The close `Icon` uses `name="close"` (already exists in the icon set per the existing error variant).

The whole `styles.card` wraps inside a `Pressable` so card-area tap also dismisses (without intercepting the close button's tap thanks to React Native event-bubbling — implementor verifies by test).

WCAG AA touch-target invariants `I-38 IconChrome ≥ 44pt` (memory `feedback_wcag_aa_kit_invariants.md`): the close button visible-tap-region is 32 × 32 with hitSlop 12, yielding 44 × 44 effective hit area. Preserved.

#### Behavioral contract — Toast primitive

| Scenario | Expected |
|----------|----------|
| `kind="error"` mounts, no user interaction for 12 s | `onDismiss()` fires |
| `kind="error"` mounts, user taps anywhere on the card body | `onDismiss()` fires within one frame |
| `kind="error"` mounts, user taps the close-icon button | `onDismiss()` fires within one frame; body-card press is NOT fired in addition |
| `kind="error"` mounts, user swipes the card (out of scope v1) | No-op (allowed; can add later) |
| `kind="success" \| "info" \| "warn"` — existing behavior preserved | Auto-dismiss timer fires at 2600/2600/6000 ms |
| `autoDismissMs={null}` passed explicitly | No auto-dismiss; must rely on close/tap |

### 2.2 Stripe payment-sheet wrapper

#### `mingla-business/src/payments/stripePaymentSheet.ts`

```ts
export type PaymentSheetErrorCode = "Canceled" | "Failed" | "Timeout";

export interface PaymentSheetError {
  code: PaymentSheetErrorCode;
  message: string;
  localizedMessage?: string;
  declineCode?: string;
  stripeErrorCode?: string;
}

export interface PaymentSheetResult {
  error?: PaymentSheetError;
}

export interface PaymentSheetInitInput {
  merchantDisplayName: string;
  paymentIntentClientSecret: string;
  allowsDelayedPaymentMethods: boolean;
}

export interface StripePaymentSheetController {
  isPaymentSheetSupported: boolean;
  initPaymentSheet: (input: PaymentSheetInitInput) => Promise<PaymentSheetResult>;
  presentPaymentSheet: () => Promise<PaymentSheetResult>;
}
```

The Metro-fallback `useStripePaymentSheet` (lines 21–29) stays structurally identical but its `unsupported` helper now returns `{ error: { code: "Failed", message: "Stripe PaymentSheet is not available on web." } }`. **Note:** this fallback should never be resolved at runtime on native (Metro picks `.native.ts`) or web (Metro picks `.web.ts`); it exists only to satisfy TypeScript when bundlers lack platform extensions. DISC-2 follow-up will harden this.

#### `mingla-business/src/payments/stripePaymentSheet.native.ts`

Update to pass the Stripe SDK's `StripeError<PaymentSheetError>` through, mapping `code` verbatim and including `declineCode` / `localizedMessage` when present. The SDK's runtime `code` values are the enum strings `"Canceled" | "Failed" | "Timeout"` (verified in `node_modules/@stripe/stripe-react-native/lib/typescript/src/types/Errors.d.ts:33-37`), so the wrapper does an identity passthrough on `code` with a type-narrowing guard:

```ts
import { useStripe } from "@stripe/stripe-react-native";
import type {
  PaymentSheetError,
  PaymentSheetErrorCode,
  PaymentSheetInitInput,
  PaymentSheetResult,
  StripePaymentSheetController,
} from "./stripePaymentSheet";

const PAYMENT_SHEET_ERROR_CODES: readonly PaymentSheetErrorCode[] = [
  "Canceled",
  "Failed",
  "Timeout",
] as const;

const isPaymentSheetErrorCode = (value: unknown): value is PaymentSheetErrorCode =>
  typeof value === "string" &&
  (PAYMENT_SHEET_ERROR_CODES as readonly string[]).includes(value);

const normalize = (raw: { error?: unknown }): PaymentSheetResult => {
  if (!raw.error || typeof raw.error !== "object") return {};
  const e = raw.error as Record<string, unknown>;
  const code: PaymentSheetErrorCode = isPaymentSheetErrorCode(e.code)
    ? e.code
    : "Failed";
  const error: PaymentSheetError = {
    code,
    message: typeof e.message === "string" ? e.message : "Payment failed",
  };
  if (typeof e.localizedMessage === "string") error.localizedMessage = e.localizedMessage;
  if (typeof e.declineCode === "string") error.declineCode = e.declineCode;
  if (typeof e.stripeErrorCode === "string") error.stripeErrorCode = e.stripeErrorCode;
  return { error };
};

export const useStripePaymentSheet = (): StripePaymentSheetController => {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  return {
    isPaymentSheetSupported: true,
    initPaymentSheet: async (input: PaymentSheetInitInput): Promise<PaymentSheetResult> =>
      normalize(await initPaymentSheet(input)),
    presentPaymentSheet: async (): Promise<PaymentSheetResult> =>
      normalize(await presentPaymentSheet()),
  };
};
```

If Stripe ever returns an unknown code, the wrapper defaults to `"Failed"` (most-conservative; user sees a real-error toast rather than a silent return). The unit test for this normalisation is mandatory.

#### `mingla-business/src/payments/stripePaymentSheet.web.ts`

Stays structurally a stub (web never invokes Stripe PaymentSheet; it uses Checkout Sessions per §2.5). But the stub now returns the typed error shape:

```ts
const unsupported = async (): Promise<PaymentSheetResult> => ({
  error: { code: "Failed", message: "Stripe PaymentSheet is not available on web." },
});
```

### 2.3 `payment.tsx` `handlePay` — error-code branching

Replace lines 162–166:

```tsx
const payResult = await presentPaymentSheet();
if (payResult.error) {
  setDeclineToast(true);
  throw new Error(payResult.error.message);
}
```

With:

```tsx
const payResult = await presentPaymentSheet();
if (payResult.error) {
  switch (payResult.error.code) {
    case "Canceled":
      // Buyer closed the sheet; Stripe already gave them visual feedback by dismissing.
      // Silent return to the payment summary — no toast, no error text.
      setProcessing(false);
      return;
    case "Timeout":
      setProcessing(false);
      setPaymentError("Stripe took too long — please try again.");
      return;
    case "Failed":
    default:
      setDeclineToast(true);
      setProcessing(false);
      return;
  }
}
```

Notes:
- `throw` is removed for `Canceled` and `Timeout` paths so the `catch` block at lines 199–211 doesn't overwrite the surgical state. The `processing` reset moves inline.
- The `Failed` path no longer throws (toast handles the user-visible feedback). Implementor must verify by inspection that no downstream `try { ... } catch` block depended on the throw.
- `setDeclineToast(true)` still fires for `Failed`. The toast is now dismissible per §2.1.
- The `useEffect` decline-toast → `onDismiss` resets `declineToast=false` and clears the `setProcessing` state (which is already handled inline above). No new state machine required.

The `paymentError` text rendered at lines 329–331 stays for `Timeout` and any other non-toast inline messaging. The misleading "use the Business mobile app" copy at line 142 is **removed entirely** (replaced by the web redirect path in §2.5, so the inline error branch for `!isPaymentSheetSupported` is gone on web; native always has it `true`).

### 2.4 `payment.tsx` PAYMENT GlassCard copy (lines 304–314)

Remove the Platform.OS === "web" branch entirely. Replace with the native-only copy:

```tsx
<GlassCard variant="base" radius="lg" padding={spacing.md}>
  <Text style={styles.summaryLabel}>PAYMENT</Text>
  <Text style={styles.paymentCopy}>
    Card, Apple Pay, and Google Pay are handled by Stripe.
  </Text>
  {checkoutSessionId !== null ? (
    <Text style={styles.paymentMeta}>Session {checkoutSessionId.slice(0, 8)}</Text>
  ) : null}
</GlassCard>
```

(On web, the buyer is redirected to Stripe-hosted Checkout before this screen completes, so the copy is never seen — but the misleading "Mingla Business mobile app" string is fully gone.)

### 2.5 Web buyer payment surface — Stripe Checkout Sessions

#### Edge function — extend `supabase/functions/ticket-checkout-create/index.ts`

Add `surface` field to the request schema:

```ts
type TicketCheckoutCreateRequest = {
  eventId: string;
  buyer: { name: string; email: string; phone: string };
  lines: Array<{ ticketTypeId: string; quantity: number; expectedUnitPriceCents: number }>;
  surface?: "native" | "web"; // default: "native" (back-compat)
};
```

Default `surface = "native"` when absent (existing mobile builds keep working without re-shipping).

After the existing `stripeAccountId` resolution and BEFORE the `paymentIntents.create` call (line 159), branch:

```ts
if (surface === "web") {
  const baseUrl = Deno.env.get("MINGLA_PUBLIC_WEB_BASE_URL");
  if (!baseUrl || !/^https:\/\//.test(baseUrl)) {
    return jsonResponse({ error: "web_base_url_missing" }, 500);
  }
  let checkoutSession: { id: string; url: string | null };
  try {
    // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
    checkoutSession = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        currency,
        line_items: [
          {
            price_data: {
              currency,
              unit_amount: totalCents,
              product_data: { name: `Tickets — ${eventName}` },
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          transfer_data: { destination: stripeAccountId },
          metadata: {
            mingla_checkout_session_id: checkoutSessionId,
            mingla_event_id: eventId,
            mingla_buyer_email: buyerEmail,
          },
        },
        customer_email: buyerEmail,
        success_url: `${baseUrl}/checkout/${eventId}/confirm?cs={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/checkout/${eventId}/payment`,
        metadata: {
          mingla_checkout_session_id: checkoutSessionId,
          mingla_event_id: eventId,
        },
      },
      { idempotencyKey: `ticket_checkout_web:${checkoutSessionId}` },
    );
  } catch (err) {
    const failure = classifyStripeCheckoutSessionCreateFailure(err);
    console.error("[ticket-checkout-create] checkout session create failed", failure.detail);
    await supabase
      .from("ticket_checkout_sessions")
      .update({
        status: "failed",
        failed_at: new Date().toISOString(),
        failure_reason: failure.detail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", checkoutSessionId);
    return jsonResponse(
      { error: "checkout_session_create_failed", detail: failure.detail },
      failure.httpStatus,
    );
  }
  if (!checkoutSession.url) {
    return jsonResponse({ error: "checkout_session_url_missing" }, 502);
  }
  await supabase
    .from("ticket_checkout_sessions")
    .update({
      status: "awaiting_web_redirect",
      stripe_checkout_session_id: checkoutSession.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", checkoutSessionId);
  return jsonResponse({
    kind: "requires_web_redirect",
    checkoutSessionId,
    buyerStatusToken,
    hostedCheckoutUrl: checkoutSession.url,
    totalCents,
    currency,
  });
}
```

A new helper `classifyStripeCheckoutSessionCreateFailure` mirrors `classifyStripePaymentIntentCreateFailure` in `_shared/ticketCheckout.ts` (same shape; reuse with renamed `detail` prefix `stripe_checkout_session_create_failed`).

Schema additions (see §2.6):
- `ticket_checkout_sessions.status` CHECK constraint gains `'awaiting_web_redirect'` value.
- `ticket_checkout_sessions.stripe_checkout_session_id` text column (nullable; indexed).

#### Webhook router — `supabase/functions/_shared/stripeWebhookRouter.ts`

Add a handler for `checkout.session.completed` that resolves the embedded PaymentIntent and routes it through the existing `payment_intent.succeeded` finalisation. Pseudocode:

```ts
case "checkout.session.completed": {
  const cs = event.data.object as { id: string; payment_intent: string | null; metadata?: { mingla_checkout_session_id?: string } };
  if (!cs.payment_intent) return ok(); // free or unfinalised — Stripe will fire payment_intent.succeeded later
  const checkoutSessionId = cs.metadata?.mingla_checkout_session_id;
  if (!checkoutSessionId) {
    console.warn("[stripe-webhook] checkout.session.completed missing mingla metadata", cs.id);
    return ok();
  }
  await supabase
    .from("ticket_checkout_sessions")
    .update({
      stripe_payment_intent_id: cs.payment_intent,
      stripe_checkout_session_id: cs.id,
      status: "processing_payment",
      updated_at: new Date().toISOString(),
    })
    .eq("id", checkoutSessionId)
    .is("stripe_payment_intent_id", null); // idempotent — only set if not already
  return ok();
}
```

The existing `payment_intent.succeeded` handler then runs the same finalisation path (no change required there because it already resolves session by metadata + PI ID).

**Verify**: the implementor must read `_shared/stripeWebhookRouter.ts` end-to-end to confirm the `payment_intent.succeeded` path already idempotently writes the order regardless of whether the PI was created directly or through a Checkout Session. If it does NOT, raise as a P0 finding rather than patching here.

#### Service layer — `mingla-business/src/services/ticketCheckoutService.ts`

Add a new union variant:

```ts
export interface TicketCheckoutRequiresWebRedirect {
  kind: "requires_web_redirect";
  checkoutSessionId: string;
  buyerStatusToken: string;
  hostedCheckoutUrl: string;
  totalCents: number;
  currency: string;
}

export type TicketCheckoutCreateResult =
  | TicketCheckoutRequiresPayment
  | TicketCheckoutRequiresWebRedirect
  | TicketCheckoutFreeCompleted;

export interface TicketCheckoutCreateInput {
  eventId: string;
  buyer: BuyerDetails;
  lines: CartLine[];
  surface?: "native" | "web";
}
```

`createTicketCheckout` passes `surface` through to the edge function body.

#### Payment screen — `mingla-business/app/checkout/[eventId]/payment.tsx`

After the early-return guards (line 95–103), determine surface:

```tsx
const surface: "native" | "web" = Platform.OS === "web" ? "web" : "native";
```

In `handlePay`, when `surface === "web"`:

```tsx
if (surface === "web") {
  try {
    setProcessing(true);
    setPaymentError(null);
    const checkout = await createTicketCheckout({ eventId, buyer, lines, surface: "web" });
    if (checkout.kind !== "requires_web_redirect") {
      throw new Error("Web checkout did not return a redirect URL.");
    }
    setCheckoutSessionId(checkout.checkoutSessionId);
    // Hand off to Stripe hosted Checkout. The browser will navigate away;
    // success returns to /checkout/{eventId}/confirm?cs={CHECKOUT_SESSION_ID},
    // cancel returns to this screen with no toast.
    window.location.assign(checkout.hostedCheckoutUrl);
    return;
  } catch (error) {
    setProcessing(false);
    setPaymentError(
      error instanceof Error
        ? error.message
        : "We couldn't start checkout. Please try again.",
    );
    return;
  }
}
```

The existing native-path code (lines 137–227) runs unchanged when `surface === "native"`.

`Platform.OS === "web"` is the canonical web-discriminator in React Native Web. The `window.location.assign` call is web-only and reachable only inside the `surface === "web"` branch. Wrap with `typeof window !== "undefined"` defence at the implementor's discretion.

#### Confirm screen — `mingla-business/app/checkout/[eventId]/confirm.tsx`

Add a `useEffect` that, when the URL contains `?cs={...}` and there is no cart `recordResult` yet, calls `pollTicketCheckoutStatus(cs, buyerStatusToken)` to wait for webhook finalisation, then records the result and renders normally. Implementor: the `buyerStatusToken` for web is in the edge function response; persist it in the cart context just like the native path does. On token-missing (deep-link or refresh), fall back to displaying a "tickets coming by email" message — Stripe success URL means payment definitely succeeded; the buyer's confirmation email is the authoritative artifact.

(Read `confirm.tsx` first — if it already handles deep-link/cold-start cases, reuse; if not, add the minimal branching here.)

### 2.6 Database migration — `supabase/migrations/<timestamp>_orch_0789_0790_web_checkout.sql`

```sql
-- ORCH-0790: web buyer checkout via Stripe Checkout Sessions

BEGIN;

-- 1. Allow new status value
ALTER TABLE public.ticket_checkout_sessions
  DROP CONSTRAINT IF EXISTS ticket_checkout_sessions_status_check;

ALTER TABLE public.ticket_checkout_sessions
  ADD CONSTRAINT ticket_checkout_sessions_status_check
  CHECK (status IN (
    'pending',
    'processing_payment',
    'awaiting_web_redirect', -- new
    'paid',
    'failed',
    'expired',
    'cancelled'
  ));

-- 2. Persist Stripe Checkout Session ID for web flow
ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT;

CREATE INDEX IF NOT EXISTS ticket_checkout_sessions_stripe_checkout_session_id_idx
  ON public.ticket_checkout_sessions (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

COMMIT;
```

Implementor verifies the current CHECK constraint values by reading the latest migration that touches `ticket_checkout_sessions.status` (per Migration Chain Rule). If the current values differ from what is listed above, the implementor produces a migration that strictly adds `'awaiting_web_redirect'` to whatever the latest set is — never silently dropping a value that already exists.

**Operator owns `supabase db push --linked`** (memory `feedback_orchestrator_deploys_edge_functions.md`). The implementor does NOT run `supabase db push`. The migration file is committed on `Seth`; the operator applies it during the close.

### 2.7 Strict-grep CI gate — `.github/scripts/strict-grep/orch-0789-error-toast-dismissible.mjs`

New script + new job in `.github/workflows/strict-grep-mingla-business.yml`, per registry pattern (memory `feedback_strict_grep_registry_pattern.md`).

#### Script contract

```js
// .github/scripts/strict-grep/orch-0789-error-toast-dismissible.mjs
// Enforces I-PROPOSED-ERROR-TOAST-DISMISSIBLE:
// 1. Toast.tsx must define AUTO_DISMISS.error as a number (not null).
// 2. Toast.tsx render tree must include a Pressable with onPress={onDismiss}.
// 3. No caller may use <Toast kind="error" autoDismissMs={null} without paired
//    explicit reachable dismiss-state callback (assertion: literal "null" rejected;
//    operator may override per-call via a justified `// eslint-disable-next-line` style
//    comment matching /\/\/ orch-0789-allow-null-autodismiss: .+/ on the preceding line).
```

Exit 0 on pass; exit 1 with file:line on fail. The job appends to the existing workflow:

```yaml
- name: ORCH-0789 error-toast-dismissible gate
  if: always()
  run: node .github/scripts/strict-grep/orch-0789-error-toast-dismissible.mjs
```

The job MUST be added to the required-checks set in branch protection at CLOSE time (operator action; orchestrator surfaces).

---

## 3. Success criteria

| # | Criterion | Layer | Verifiable by |
|---|-----------|-------|--------------|
| SC-01 | iPhone buyer who taps "Pay" then closes the Stripe sheet returns to the payment summary with NO toast and Pay re-enabled. | Component | Simulator + RN unit test |
| SC-02 | iPhone buyer whose card is declined sees "Card declined — try another payment method.", AND can dismiss the toast within one tap (close icon OR tap anywhere on toast), AND the toast auto-dismisses after 12 s if untouched. | Toast primitive + Component | Render test + simulator |
| SC-03 | iPhone buyer who experiences a Stripe `Timeout` sees a distinct "Stripe took too long — please try again." message and can retry. | Component | Unit test mocking `presentPaymentSheet → {error:{code:"Timeout"}}` |
| SC-04 | Web buyer on `/checkout/{eventId}/payment` tapping Pay is redirected to a Stripe-hosted Checkout Session URL within 2 s of network confirmation. | Edge + Service + Component | Browser smoke test; verify `window.location.assign` called with `checkout.stripe.com/c/pay/...` URL |
| SC-05 | After Stripe Checkout success, the buyer lands on `/checkout/{eventId}/confirm` and sees tickets recorded in cart context. | Edge + Webhook + Component | Browser smoke + DB inspection of `orders` + `tickets` rows |
| SC-06 | After Stripe Checkout cancel, the buyer lands back on `/checkout/{eventId}/payment` with no toast and no error message. | Component | Browser smoke |
| SC-07 | Existing native checkout flow (PaymentSheet, free completion, polling) is unchanged behaviorally. | Full stack | Existing Cycle 8 regression tests still pass |
| SC-08 | `<Toast kind="error">` with no `autoDismissMs` override auto-dismisses at 12 s. | Toast | Render test |
| SC-09 | Strict-grep gate `orch-0789-error-toast-dismissible` exits 0 on clean code and exits 1 with a clear file:line message on a forced violation. | CI | Run the script against a deliberately broken Toast.tsx fixture |
| SC-10 | No `useAuth()` is added to `/checkout/*`, `/e/*`, or `/b/*` routes. | Component | Grep / strict-grep |
| SC-11 | The misleading "Please complete checkout in the Mingla Business mobile app" copy is fully removed from `payment.tsx`. | Component | Grep |
| SC-12 | Wrapper unit test: `presentPaymentSheet` returning `{error:{code:"Canceled", message:"x"}}` is preserved as `{error:{code:"Canceled", message:"x"}}` after passing through the wrapper. | Wrapper | Jest unit test |
| SC-13 | Wrapper unit test: unknown Stripe error `code` falls back to `"Failed"` (conservative default). | Wrapper | Jest unit test |
| SC-14 | `ticket_checkout_sessions.status` accepts `'awaiting_web_redirect'`. | DB | SQL probe |

---

## 4. Invariants (must hold AND new)

### Must hold (existing)

- **I-PUBLIC-BUYER-ANON-TOLERANT** (memory) — `/checkout/{eventId}/payment` and `/checkout/{eventId}/confirm` MUST NOT call `useAuth`. Strict-grep gate `orch-0789-error-toast-dismissible` extension: ensure the existing anon-buyer strict-grep continues to pass.
- **I-TOAST-SELF-PORTAL** (post-2026-05-02) — Toast continues to use the `Modal` portal pattern. Render-tree changes in §2.1 happen INSIDE the Animated.View, not outside the Modal.
- **I-38 IconChrome ≥ 44pt** (memory `feedback_wcag_aa_kit_invariants.md`) — close-icon hit area is 32 + (2 × 12) = 56 px. Preserved.
- **I-39 explicit accessibilityLabel on interactive Pressable** — close icon has `accessibilityLabel="Dismiss notification"`. Preserved.
- **I-PROPOSED-J Zustand persist no server snapshots** (memory) — no order/event data added to Zustand `partialize`. Preserved (cart context is in-memory React state, not Zustand).
- **I-CHECKOUT-IDEMPOTENT** (implicit from ORCH-0777) — Checkout Session creation uses `idempotencyKey: ticket_checkout_web:${checkoutSessionId}`. Preserved.

### New (DRAFT → ACTIVE on CLOSE)

- **I-PROPOSED-ERROR-TOAST-DISMISSIBLE** — every `<Toast kind="error">` is user-dismissible without external state changes. Enforced by strict-grep gate + render test.
- **I-PROPOSED-STRIPE-ERROR-CODE-DISCRIMINATED** — Mingla Business `PaymentSheetResult` carries `code: "Canceled" | "Failed" | "Timeout"`. Enforced by typing + wrapper unit test.

Register both in `Mingla_Artifacts/INVARIANT_REGISTRY.md` as DRAFT during implementation; orchestrator flips to ACTIVE on CLOSE.

---

## 5. Test matrix

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Wrapper preserves Canceled code | Mock `presentPaymentSheet` → `{error:{code:"Canceled",message:"x"}}` | Wrapper returns `{error:{code:"Canceled",message:"x"}}` | Wrapper unit |
| T-02 | Wrapper preserves Failed code + declineCode | `{error:{code:"Failed",declineCode:"insufficient_funds"}}` | Same passed through | Wrapper unit |
| T-03 | Wrapper coerces unknown code → Failed | `{error:{code:"WeirdCode"}}` | `{error:{code:"Failed",...}}` | Wrapper unit |
| T-04 | handlePay: Canceled is silent | Mock wrapper → Canceled | `declineToast === false`, `paymentError === null`, `processing === false`, screen stays on payment summary | Component (RN test) |
| T-05 | handlePay: Failed shows decline toast | Mock wrapper → Failed | `declineToast === true`, `processing === false` | Component |
| T-06 | handlePay: Timeout shows timeout message | Mock wrapper → Timeout | `paymentError === "Stripe took too long..."`, `processing === false`, `declineToast === false` | Component |
| T-07 | Toast error auto-dismisses at 12 s | Mount `<Toast kind="error" visible />`, advance timers 12000 ms | `onDismiss` fires exactly once | Toast unit |
| T-08 | Toast error tap-on-card dismisses | Mount + simulate press on toast card body | `onDismiss` fires within one render frame | Toast unit |
| T-09 | Toast error close-icon dismisses | Mount + simulate press on close icon | `onDismiss` fires; tap is not double-dispatched | Toast unit |
| T-10 | Toast `autoDismissMs={null}` disables timer | Mount `<Toast kind="error" autoDismissMs={null} visible />`, advance 60 s | `onDismiss` does NOT fire from timer | Toast unit |
| T-11 | Web handlePay redirects | Force `Platform.OS === "web"`, mock `createTicketCheckout` → `{kind:"requires_web_redirect", hostedCheckoutUrl:"https://checkout.stripe.com/test"}` | `window.location.assign("https://checkout.stripe.com/test")` called once | Component web-bundle test |
| T-12 | Web handlePay edge failure shows inline error | Force web, mock edge → throws | `paymentError` set, `processing === false`, no redirect attempted | Component |
| T-13 | Edge accepts `surface:"web"` and returns hostedCheckoutUrl | POST to function with `surface:"web"` + valid event + buyer | 200 with `kind:"requires_web_redirect"` + `hostedCheckoutUrl` starting `https://checkout.stripe.com/` | Deno test against staging Stripe |
| T-14 | Edge defaults `surface` to `native` | POST without `surface` | Returns `kind:"requires_payment"` (existing behaviour) | Deno test |
| T-15 | DB constraint accepts `awaiting_web_redirect` | `UPDATE ticket_checkout_sessions SET status='awaiting_web_redirect'` after migration | No error | SQL probe |
| T-16 | Webhook handler routes `checkout.session.completed` → existing PI finalisation | Replay a recorded `checkout.session.completed` event with mingla metadata | `ticket_checkout_sessions.stripe_payment_intent_id` populated | Deno test |
| T-17 | Strict-grep gate detects null AUTO_DISMISS.error | Run gate against a Toast.tsx with `error: null` | Exits 1 with file:line | CI script |
| T-18 | Strict-grep gate detects missing close button | Run gate against a Toast.tsx with the Pressable removed | Exits 1 with file:line | CI script |
| T-19 | Existing native flow regression | Run the existing Cycle 8 / ORCH-0777 payment-sheet smoke (mock Stripe init+present succeed → record → confirm) | No changes in behavior | Component integration |
| T-20 | iPhone simulator live smoke | Build EAS preview, open public Party Block, tap Pay, close sheet, tap Pay again, complete with 4242 card | Cancel = silent return; successful pay = confirm screen | Manual on real device |
| T-21 | Web Safari live smoke | Open public event in browser, tap Pay, complete on Stripe hosted page with 4242 card | Returns to /confirm with tickets | Manual on real browser |
| T-22 | Web Safari cancel smoke | Open public event in browser, tap Pay, tap "Back" on Stripe hosted page | Returns to /payment with no toast and no error | Manual on real browser |

---

## 6. Implementation order

Per memory `feedback_orchestrator_deploys_edge_functions.md`: operator owns DB push, orchestrator owns edge deploy. Therefore the implementor commits everything as one PR on `Seth`, the operator pushes the migration, then the orchestrator deploys the edge function, then iOS OTA ships.

1. **Migration** — `supabase/migrations/<timestamp>_orch_0789_0790_web_checkout.sql` (§2.6). Implementor verifies current `status` CHECK values first; appends `awaiting_web_redirect` to whatever the latest set is.
2. **Edge function** — extend `supabase/functions/ticket-checkout-create/index.ts` with `surface` branching (§2.5). Add `classifyStripeCheckoutSessionCreateFailure` helper to `_shared/ticketCheckout.ts`. Add `MINGLA_PUBLIC_WEB_BASE_URL` to `supabase/config.toml` `[functions.ticket-checkout-create].env`.
3. **Webhook router** — `_shared/stripeWebhookRouter.ts` `checkout.session.completed` handler (§2.5).
4. **Stripe wrapper** — update `stripePaymentSheet.ts` + `.native.ts` + `.web.ts` (§2.2). Write `mingla-business/src/payments/__tests__/stripePaymentSheet.test.ts` covering T-01..T-03.
5. **Toast primitive** — update `Toast.tsx` (§2.1). Write `mingla-business/src/components/ui/__tests__/Toast.test.tsx` covering T-07..T-10.
6. **Service** — update `ticketCheckoutService.ts` with new union variant (§2.5). Tests for surface passthrough.
7. **Payment screen** — update `payment.tsx` `handlePay` (§2.3), surface detection (§2.5), and PAYMENT GlassCard copy (§2.4). Tests T-04..T-06, T-11, T-12.
8. **Confirm screen** — update `confirm.tsx` to handle `?cs=...` deep-link from Stripe success URL (§2.5).
9. **Strict-grep gate** — `.github/scripts/strict-grep/orch-0789-error-toast-dismissible.mjs` + workflow job (§2.7). Tests T-17, T-18.
10. **Invariant registry** — register `I-PROPOSED-ERROR-TOAST-DISMISSIBLE` + `I-PROPOSED-STRIPE-ERROR-CODE-DISCRIMINATED` as DRAFT in `Mingla_Artifacts/INVARIANT_REGISTRY.md`.
11. **Implementation report** — `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0789_AND_0790_PUBLIC_TICKET_CHECKOUT_FAILURE_HANDLING_AND_WEB_BUYER_FLOW.md` with old→new receipts.

After step 11, return to operator. Operator runs `supabase db push --linked` (Step 1 migration). Orchestrator deploys `ticket-checkout-create` and the webhook function (Step 2-3). Then TEST mode runs.

---

## 7. Regression prevention

1. **Type-level** — `PaymentSheetResult.error.code` is a typed union, not a loose string. Any future caller that wants to branch on the code gets compiler enforcement. Removal of `code` from the type would break every caller — visible regression in CI.
2. **Strict-grep gate** — `orch-0789-error-toast-dismissible` catches anyone resetting `AUTO_DISMISS.error = null` or removing the close-button Pressable from `Toast.tsx`.
3. **Render tests** — T-07..T-10 catch any future `Toast` refactor that breaks dismissibility on the primitive.
4. **Wrapper tests** — T-01..T-03 catch any future wrapper change that throws away `code`.
5. **handlePay tests** — T-04..T-06 catch any future regression where Canceled is re-conflated with Failed.
6. **Protective comments** — add a short one-line comment at the new `switch (payResult.error.code)` block in `payment.tsx`:
   `// Stripe Canceled is NOT a decline — buyer closed the sheet. Silent return only. (ORCH-0789)`
   And in `Toast.tsx` next to `AUTO_DISMISS.error = 12000`:
   `// error toasts MUST be user-dismissible. Permanent toast strands buyers. (ORCH-0789)`
7. **Decision log entry** — DEC-XXX (orchestrator-assigned) records the Checkout Sessions vs Payment Element trade-off so a future ORCH revisiting web payment knows what was decided and why.

---

## 8. Hard guards (implementor MUST NOT)

- Do NOT run `supabase db push`. Operator owns DB migration deployment.
- Do NOT deploy any edge function. Orchestrator owns post-merge edge deploy.
- Do NOT add `useAuth` to any buyer route. Anon-tolerant invariant.
- Do NOT modify the existing native PaymentSheet path beyond the `handlePay` error-code branching specified in §2.3. The native flow is in production and must remain behaviorally identical for non-error paths.
- Do NOT change `Toast.tsx` visual style (colors, blur, padding, border) — only the dismissal affordances + auto-dismiss timer.
- Do NOT add Apple Pay / Google Pay native wallet code; Stripe Checkout on web auto-handles them and the native PaymentSheet already does.
- Do NOT introduce `@stripe/stripe-js` or `@stripe/react-stripe-js` dependencies. The web path uses Stripe-hosted Checkout (redirect), not in-page Elements.
- Do NOT commit any Stripe restricted API keys, publishable keys, or secrets. The platform Stripe client is already wired through `stripeTicketCheckout()` in `_shared/stripe.ts` and reads its secret from env.
- Do NOT bleed scope into ORCH-0787 (refund/cancel), ORCH-0788 (buyer notification dispatcher), ORCH-0785 (email branding), or ORCH-0786 (avatar).
- Do NOT add a "summary of changes" paragraph at the end of the implementation report. List old→new receipts and stop (memory `feedback_no_summary_paragraph.md`).

---

## 9. Output

Implementor produces:
- All code changes per §6 steps 1–9.
- Implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0789_AND_0790_PUBLIC_TICKET_CHECKOUT_FAILURE_HANDLING_AND_WEB_BUYER_FLOW.md` with:
  - Per-file old→new receipts (file path + line range + before/after snippet)
  - Test files added and what they cover
  - Strict-grep gate output (run locally before commit)
  - Any deviations from this spec with justification (none expected)
  - **No summary paragraph.** End the report at the last receipt.

---

## 10. Downstream routing

After implementor return:
1. Orchestrator reviews implementation report.
2. Operator runs `supabase db push --linked` for the migration.
3. Orchestrator deploys `ticket-checkout-create` (and `stripe-webhook` if a separate function — verify) via `supabase functions deploy`.
4. Orchestrator verifies version bumps via `mcp__supabase__list_edge_functions`.
5. Claude `mingla-forensics` (TEST mode) runs the full test matrix in §5 against iPhone simulator + web browser + (best effort) Android emulator.
6. On PASS / CONDITIONAL PASS, orchestrator owns CLOSE: artifact sync, DIAG reap, commit message, EAS iOS OTA (web reachability is direct from `Seth`/`main` — no OTA), and queue advance.
7. Operator manually live-fires on the production Party Block public page on iPhone and on Safari/Chrome before the close is final.
