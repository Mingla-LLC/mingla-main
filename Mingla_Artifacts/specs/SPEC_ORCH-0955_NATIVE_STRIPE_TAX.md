# SPEC — ORCH-0955 [Native Stripe Tax for Platforms]

**Author:** Claude `mingla-forensics` (SPEC mode).
**Date:** 2026-05-24.
**Working tree:** `~/Desktop/mingla-orchs/ORCH-0955-[native-stripe-tax]/` on branch `ORCH-0955-native-stripe-tax` (rebased onto main HEAD `bba40a82`).
**Predecessors:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0955_NATIVE_STRIPE_TAX.md` (11 findings F-1..F-11 + Amendment 1). `Mingla_Artifacts/prompts/SPEC_ORCH-0955_NATIVE_STRIPE_TAX.md` (dispatch with 13 locked decisions + Q8).
**Comms-ledger context:** COMMS-0001 (tax dashboard link rewrite absorbed into ORCH-0955; both forensics + orchestrator acked).
**Cross-ORCH:** F-11 plumbing depends on ORCH-0954 [Embedded onboarding cutover] embedded-components helpers; ORCH-0954 SPEC has NOT landed yet (no `specs/` dir in its worktree as of 2026-05-24). This SPEC names canonical helpers; IMPLEMENT will reconcile names if ORCH-0954 SPEC ships a different convention first. ORCH-0956 [Stripe ops alerts → email] mild overlap on `_shared/stripeWebhookRouter.ts` — different handler regions; first-PR-lands-clean policy.

---

## 1. Scope, non-goals, assumptions

### Scope (in)

1. Wire Stripe Tax for Platforms 3-step (`tax.calculations.create` → tax-inclusive `paymentIntents.create` → `tax.transactions.createFromCalculation` on webhook → `tax.transactions.createReversal` on refund) into the native PaymentIntent direct-charge path in `supabase/functions/ticket-checkout-create/index.ts`.
2. Collect buyer billing address in the cart sheet BEFORE invoking `ticket-checkout-create` (consumer + business mobile apps).
3. Add cart-sheet tax preview via new `mode: 'preview'` request flag on `ticket-checkout-create`.
4. Persist tax data: new columns `orders.stripe_tax_transaction_id` (text nullable), `orders.tax_breakdown` (jsonb nullable), `refunds.stripe_tax_transaction_id` (text nullable). Refresh stale `COMMENT ON COLUMN` text on `orders.tax_amount_cents` + `orders.tax_calculation_id` (ORCH-0843 superseded the ORCH-0804 destination-charge framing).
5. Webhook commit handler: extend `_shared/stripeWebhookRouter.ts` `handleTicketCheckoutPaymentIntent` to call `createFromCalculation` after `biz_ticket_checkout_finalize` succeeds, when PI metadata carries `mingla_tax_calculation_id`. Persist `transaction.id` to `orders.stripe_tax_transaction_id` and `tax_breakdown` to `orders.tax_breakdown`.
6. Refund reversal inline-sync in `refund-order/index.ts`: after `stripe.refunds.create` succeeds and before `biz_refund_order_commit`, look up `orders.stripe_tax_transaction_id` and call `createReversal` (`mode: 'full' | 'partial'`). Persist reversal `transaction.id` to `refunds.stripe_tax_transaction_id`.
7. Webhook backstop: extend `charge.refunded` / `refund.created` / `refund.updated` handlers to attempt reversal if order has `stripe_tax_transaction_id` and `refunds.stripe_tax_transaction_id` is null (defense-in-depth against inline-sync failure paths).
8. Receipt rendering: amend `_shared/email/ticketBody.ts` to render a Tax row between line items and Total (ORCH-0804 added the column; the template never wired it).
9. F-11 dashboard-link rewrite: DELETE `supabase/functions/brand-stripe-tax-dashboard-link/index.ts`; CREATE `supabase/functions/brand-stripe-tax-account-session/index.ts` that mints an `account_sessions` client_secret with `components: { tax_registrations: { enabled: true }, tax_settings: { enabled: true } }`; CREATE new Mingla-hosted page `mingla-business/app/connect-tax-registrations/index.tsx` mounting `@stripe/connect-js` with both components; UPDATE `mingla-business/src/components/brand/BrandPaymentsView.tsx` CTA to open the new URL via `expo-web-browser.openAuthSessionAsync`.
10. DELETE ORCH-0953's region gate: `supabase/functions/_shared/stripeTax.ts` (file), the enforcement block at `ticket-checkout-create/index.ts:360-389`, the 4 gate-defending test files, the `native_paid_not_allowed_in_region` error-handling toast paths in both `nativeCheckoutFlow` files. CLOSE commit body MUST include `[TEST-MOD-APPROVED ORCH-0955]`.
11. CI: 5 new strict-grep gates (one per new invariant); delete ORCH-0953's `orch-0953-native-region-gate*.mjs` gates (whichever ones existed — check at IMPLEMENT time).
12. CLOSE Step 3: `supabase secrets unset NATIVE_PAID_ALLOWED_REGIONS`.

### Non-goals (out of scope — explicit)

- Tax-exempt buyer flow (non-profits, comped tickets).
- VAT / EU regional tax beyond what Stripe Tax auto-handles.
- Per-venue `performance_location` (`taxloc_*`) provisioning — Stripe Tax falls back to buyer-address-only jurisdiction; sufficient for v1. Future ORCH if a brand hits a venue-specific surcharge gap.
- Embedded Tax Settings UX deeper than mounting the component as-is (no Mingla-custom wrapper, no copy injection).
- Web Checkout Session tax (already shipped by ORCH-0804; untouched).
- Bumping `STRIPE_API_VERSION` to `.preview` (locked per Q4).
- Admin-web tax-status surface (per ORCH-0954 F-13: admin has zero Stripe surface today; not introduced here).

### Assumptions

- Stripe Tax for Platforms is enabled on the platform Stripe account (ORCH-0953 §"Connect Platform Setup locked" implies yes; verify with operator at IMPLEMENT time).
- Brand connected accounts will register in tax jurisdictions via the new embedded `<ConnectTaxRegistrations>` UI; unregistered jurisdictions return `tax = 0` from `tax.calculations.create` and the PaymentIntent runs at face value.
- `STRIPE_RAK_ONBOARD` either already has `account_sessions:write` scope or operator adds it at IMPLEMENT (per ORCH-0954 F-14 plan).
- The PaymentSheet will accept a tax-inclusive `amount` set at PI creation (this is the standard Stripe pattern; PaymentSheet just displays what the PI amount says).
- `tax.transactions.createReversal` accepts the `Stripe-Account` header for direct-charge connected-account scoping (parity with the other Tax API endpoints; ORCH-0955 investigation §F-5 cites Stripe's Tax for Platforms docs).

---

## 2. Cross-Surface Impact (Phase 2.5 — MANDATORY)

| Surface | In scope? | What changes | Files | Parity model |
|---|---|---|---|---|
| **Consumer iOS** (`app-mobile/` on iOS) | YES | Cart-sheet address form + tax preview; new request shape on `ticket-checkout-create` invoke; gate-error-handling toast deleted | `app-mobile/src/payments/nativeCheckoutFlow.ts`; new cart-sheet address component (TBD by implementor; the existing cart entry point is `ExpandedBusinessEventSheet.tsx`); receipt screen if it surfaces tax | Automatic (shared RN code across iOS+Android) |
| **Consumer Android** (`app-mobile/` on Android) | YES | Parity with iOS via shared RN code | Same | Automatic |
| **Buyer-anon Web** (`mingla-business/checkout/{eventId}`, `/e/...`, `/b/...`) | **NO** | Already tax-enabled via `automatic_tax: { enabled: true }` on Checkout Sessions (ORCH-0804). No edits. | n/a | n/a |
| **Business iOS** (`mingla-business/` on iOS) | YES | (a) buyer-side cart-sheet address form + tax preview when business app sells tickets, (b) new tax-registrations page mount + BrandPaymentsView CTA rewrite | `mingla-business/src/payments/nativeCheckoutFlow.native.ts`; cart-sheet TBD by implementor; `mingla-business/src/components/brand/BrandPaymentsView.tsx`; `mingla-business/app/connect-tax-registrations/index.tsx` (NEW) | Manual parity with consumer for the cart/payment flow (separate per-app code per ORCH-0849 DEC-PASS2-4) — SC-N-iOS-consumer + SC-N-iOS-business per criterion |
| **Business Android** (`mingla-business/` on Android) | YES | Parity with business iOS via shared RN code | Same | Automatic across iOS+Android within business app |
| **Admin Web** (`mingla-admin/`) — adjacent | **NO** | No payment surface; per ORCH-0954 F-13, admin has zero Stripe-status surface today. | n/a | n/a |
| **Business Web preview** (`mingla-business/` dev/web) — adjacent | YES (partial) | New `/connect-tax-registrations` page must render in web builds (it's the page opened in expo-web-browser from the mobile app). Cart-flow on this surface uses the buyer-web Checkout Session path which is already taxed. | `mingla-business/app/connect-tax-registrations/index.tsx` — must be a universal-app route, not native-only | Automatic via universal route |

**Per-surface success criteria** are numbered with surface suffix where parity is manual (e.g., SC-1-iOS-consumer, SC-1-iOS-business). See §4.

---

## 3. Layer-by-layer specs

### 3.1 Database layer

**Migration filename:** `supabase/migrations/20260727000000_orch_0955_native_stripe_tax.sql`. Verified at SPEC-write time as the lowest available prefix above ORCH-0953's `20260726000000` across all in-flight worktrees (per orchestrator memory rule).

**SQL:**

```sql
-- ORCH-0955 [Native Stripe Tax for Platforms] — schema additions for tax commit + reversal persistence.
-- Per SPEC §3.1.

BEGIN;

-- (1) orders: tax_transaction id + breakdown jsonb.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stripe_tax_transaction_id text,
  ADD COLUMN IF NOT EXISTS tax_breakdown jsonb;

COMMENT ON COLUMN public.orders.stripe_tax_transaction_id IS
  'Stripe Tax transaction id (tt_...) committed by stripeWebhookRouter.handleTicketCheckoutPaymentIntent on payment_intent.succeeded via tax.transactions.createFromCalculation. NULL on free / pre-ORCH-0955 historical orders. Connected-account-scoped (brand is merchant of record per ORCH-0843 direct-charge). ORCH-0955.';

COMMENT ON COLUMN public.orders.tax_breakdown IS
  'Full tax_breakdown array from Stripe Tax transaction (per-jurisdiction line items). Populated alongside stripe_tax_transaction_id. NULL when tax_amount_cents=0. Used for per-jurisdiction receipt rendering. ORCH-0955.';

-- (2) refunds: tax reversal transaction id.
ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS stripe_tax_transaction_id text;

COMMENT ON COLUMN public.refunds.stripe_tax_transaction_id IS
  'Stripe Tax reversal transaction id (tt_...) issued by refund-order.index.ts after stripe.refunds.create succeeds, via tax.transactions.createReversal against the original orders.stripe_tax_transaction_id. NULL when the parent order had no committed tax. ORCH-0955.';

-- (3) Refresh stale comments on ORCH-0804 columns (ORCH-0843 cutover left these inaccurate).
COMMENT ON COLUMN public.orders.tax_amount_cents IS
  'Stripe Tax amount collected on this order, in cents. Native paid path (ORCH-0955): populated by stripeWebhookRouter.handleTicketCheckoutPaymentIntent from the Stripe Tax transaction.amount_total (calc result). Web Checkout Session path (ORCH-0804): populated from session.total_details.amount_tax. Brand is merchant of record (Connect direct charge per ORCH-0843 — connected account is merchant of record implicitly via Stripe-Account header; automatic_tax.liability is NOT set on direct charges).';

COMMENT ON COLUMN public.orders.tax_calculation_id IS
  'Stripe tax_calculation reference (taxcalc_...). Native paid path (ORCH-0955): minted in ticket-checkout-create.index.ts before paymentIntents.create; passed forward to webhook commit via PI metadata.mingla_tax_calculation_id. Web Checkout Session path (ORCH-0804): minted by Stripe automatic_tax on session creation. NULL on free / door-sale / pre-ORCH-0804 historical orders.';

COMMIT;
```

**Constraints / indexes:** none new. Both new columns are nullable; no CHECK constraint needed (Stripe's id strings are opaque; format validation would over-couple). No index on either column (refund lookup is by `order_id`; tax_transaction_id is only read via that join).

**RLS:** no new policies. The two affected tables (`orders`, `refunds`) already have RLS policies that cover the new columns implicitly (column-level grants follow the row policy).

**Read-only invariant probe** (run BEFORE `db push` per the orchestrator's invariant-migration backstop):

```sql
-- Probe: no pre-existing row should violate either column's nullability.
-- Both columns are nullable + no DEFAULT, so this is informational only.
SELECT
  (SELECT COUNT(*) FROM public.orders WHERE tax_amount_cents IS NULL) AS orders_with_null_tax_amount,
  (SELECT COUNT(*) FROM public.refunds) AS total_refunds;
```

Expected: `orders_with_null_tax_amount = 0` (column is NOT NULL DEFAULT 0 per ORCH-0804); `total_refunds = N` (any count is fine, no constraint conflict possible).

### 3.2 Edge function layer

#### 3.2.1 `ticket-checkout-create` (MODIFY)

**File:** `supabase/functions/ticket-checkout-create/index.ts`.

**Request body additions:**

```ts
interface RequestBody {
  // existing fields preserved:
  eventId: string;
  surface: 'native' | 'web' | 'mobile-web';
  buyer: { name: string; email: string; phone: string; marketingOptIn?: boolean;
    // NEW (required when surface==='native' AND mode!=='preview'-with-no-address):
    address?: {
      line1: string;        // required, 1-200 chars
      line2?: string;       // optional, 1-200 chars
      city: string;         // required, 1-100 chars
      state?: string;       // optional, 1-50 chars (US: 2-letter code preferred; intl: free text)
      postal: string;       // required, 1-20 chars
      country: string;      // required, ISO-3166 alpha-2 uppercase
    };
  };
  lines: Array<{ ticketTypeId: string; quantity: number }>;
  idempotencyKey?: string;
  intake_form_data?: ...;  // existing trip intake gate; preserved
  // NEW:
  mode?: 'create' | 'preview';        // default 'create'
  taxCalculationId?: string;          // optional; if present and within Stripe 48h expiry, reuse instead of re-calc
}
```

**Validation rules (in order):**
1. Existing validations preserved verbatim (eventId, buyerName, buyerEmail, buyerPhoneE164, lines.length, event_dates gate, bookings_closed gate, intake_form_data gate).
2. NEW: if `surface === 'native'` AND `(mode === 'create' OR mode === undefined)`, `buyer.address` is REQUIRED. Validate every required sub-field; `country` must match `/^[A-Z]{2}$/`. Return `400 buyer_address_required` or `400 buyer_address_invalid` with `detail` naming the missing/malformed field.
3. NEW: when `mode === 'preview'`, `buyer.address` SHOULD be present (otherwise the calc returns 0 tax and the preview is misleading). If missing in preview mode, the edge function returns `{ subtotalCents, taxCents: 0, totalCents: subtotalCents, currency, taxBreakdown: [], calculationId: null, calculationExpiresAt: null, addressMissing: true }` — UI can use the `addressMissing: true` signal to prompt the user.

**DELETED block (Q13 lock):** lines 360-389 (the `connectedAccountCountry` lookup + `isNativePaidAllowedForBrand` check + `return jsonResponse({ error: "native_paid_not_allowed_in_region", retryWithSurface: "web" }, 400)`). The `import { isNativePaidAllowedForBrand } from "../_shared/stripeTax.ts"` at line 4 is also DELETED.

**Tax calc block** (NEW; inserted between line ~787 [end of customer provisioning] and the `paymentIntents.create` call at line ~859):

```ts
// ORCH-0955 — Stripe Tax for Platforms direct-charge tax calculation.
// Per SPEC §3.2.1. Connected-account-scoped via Stripe-Account header.
let taxCalculation: { id: string; amount_total: number; tax_breakdown: unknown[] } | null = null;
let usingClientProvidedCalculation = false;

// Resolve per-tier line items for the calc API. The session RPC builds these in
// ticket_checkout_session_items; we already have them via the v_items jsonb path,
// but per Q1 deferred decision: extend the RPC return to include `lineItems` array
// (single source of truth, no extra round trip). [SEE SPEC §3.2.1.bis FOR THE RPC AMENDMENT.]
const taxLineItems = (session.lineItems as Array<{
  ticketTypeId: string;
  ticketName: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}>).map((line) => ({
  amount: line.totalCents,
  reference: line.ticketName.slice(0, 200),
  tax_code: 'txcd_50010001',  // Admission to Amusement, Entertainment and Recreation Venues – Participant
  tax_behavior: 'exclusive' as const,  // Mingla tier price_cents is pre-tax; tax is additive
}));

const buyerAddress = body.buyer.address as RequestBody['buyer']['address']; // proven present by validation
const taxCalcCustomerDetails = {
  address: {
    line1: buyerAddress.line1,
    ...(buyerAddress.line2 ? { line2: buyerAddress.line2 } : {}),
    city: buyerAddress.city,
    ...(buyerAddress.state ? { state: buyerAddress.state } : {}),
    postal_code: buyerAddress.postal,
    country: buyerAddress.country,
  },
  address_source: 'billing' as const,
};

// Reuse client-provided calculation if still valid (within Stripe 48h expiry).
if (body.taxCalculationId && typeof body.taxCalculationId === 'string') {
  try {
    // @ts-ignore — Stripe SDK namespace runtime-provided in Deno
    const existing = await stripe.tax.calculations.retrieve(body.taxCalculationId, {}, {
      stripeAccount: stripeAccountId,
    });
    if (existing && typeof existing.id === 'string' && Number(existing.expires_at ?? 0) > Math.floor(Date.now() / 1000)) {
      taxCalculation = { id: existing.id, amount_total: Number(existing.amount_total ?? 0), tax_breakdown: Array.isArray(existing.tax_breakdown) ? existing.tax_breakdown : [] };
      usingClientProvidedCalculation = true;
    }
  } catch {
    // Fall through to fresh calc.
  }
}

if (taxCalculation === null) {
  try {
    // @ts-ignore — Stripe SDK namespace runtime-provided in Deno
    const fresh = await stripe.tax.calculations.create(
      {
        currency,
        line_items: taxLineItems,
        customer_details: taxCalcCustomerDetails,
      },
      {
        stripeAccount: stripeAccountId,
        // No idempotency key — tax calcs are not idempotency-keyed by Stripe; multiple
        // calls with same input return new calc ids each, which is fine.
      },
    );
    taxCalculation = { id: String(fresh.id), amount_total: Number(fresh.amount_total ?? 0), tax_breakdown: Array.isArray(fresh.tax_breakdown) ? fresh.tax_breakdown : [] };
  } catch (taxErr) {
    const detail = taxErr instanceof Error ? taxErr.message : String(taxErr);
    console.error('[ticket-checkout-create] tax calculation failed', detail);
    await supabase.from('ticket_checkout_sessions').update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      failure_reason: 'tax_calculation_failed',
      updated_at: new Date().toISOString(),
    }).eq('id', checkoutSessionId);
    return jsonResponse({ error: 'tax_calculation_failed', detail }, 502);
  }
}

// Persist tax_calculation_id on the session row before short-circuit (preview) or PI create.
await supabase.from('ticket_checkout_sessions').update({
  tax_calculation_id: taxCalculation.id,
  tax_amount_cents: taxCalculation.amount_total - totalCents,  // amount_total includes tax; diff is tax cents
  updated_at: new Date().toISOString(),
}).eq('id', checkoutSessionId);
// NOTE: ticket_checkout_sessions may not have tax_amount_cents/tax_calculation_id today;
// add these columns in the same migration (see §3.1 amendment).
```

**Wait — the migration in §3.1 only added tax columns to `orders` and `refunds`, not `ticket_checkout_sessions`.** SPEC amendment to §3.1: also add `tax_amount_cents integer NOT NULL DEFAULT 0` + `tax_calculation_id text` to `ticket_checkout_sessions` so the persistence step above works AND the `payment_intent.succeeded` handler can read them back at commit time (see §3.2.2). Migration SQL extended:

```sql
ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN IF NOT EXISTS tax_amount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_calculation_id text;

COMMENT ON COLUMN public.ticket_checkout_sessions.tax_amount_cents IS
  'Stripe Tax amount in cents, populated by ticket-checkout-create after tax.calculations.create. Copied into orders.tax_amount_cents by biz_ticket_checkout_finalize on payment_intent.succeeded. ORCH-0955.';

COMMENT ON COLUMN public.ticket_checkout_sessions.tax_calculation_id IS
  'Stripe tax_calculation id (taxcalc_...). Read by stripeWebhookRouter.handleTicketCheckoutPaymentIntent to call tax.transactions.createFromCalculation. ORCH-0955.';
```

**Preview short-circuit** (when `mode === 'preview'`):

```ts
if (body.mode === 'preview') {
  // No PaymentIntent created; return preview data only.
  return jsonResponse({
    kind: 'preview',
    checkoutSessionId,  // client can pass back at create-time to reuse the session row
    subtotalCents: totalCents,
    taxCents: taxCalculation.amount_total - totalCents,
    totalCents: taxCalculation.amount_total,
    currency,
    taxBreakdown: taxCalculation.tax_breakdown,
    calculationId: taxCalculation.id,
    // Stripe Tax calcs expire after 48h; client may re-call preview to refresh.
    calculationExpiresAt: null,  // SDK doesn't expose this on Tax.Calculation in 18.0.0; client should re-call if older than 47h to be safe
  });
}
```

**PaymentIntent creation amendment** (at the existing call site around line 859):

```ts
const piCreateBody: Record<string, unknown> = {
  amount: taxCalculation.amount_total,  // TAX-INCLUSIVE (was totalCents)
  currency,
  ...(isInstallmentPlan ? { setup_future_usage: 'off_session' as const } : {}),
  ...(isInstallmentPlan && customerId !== null ? { customer: customerId } : {}),
  payment_method_types: [...getPaymentMethodTypes()],
  metadata: {
    mingla_checkout_session_id: checkoutSessionId,
    mingla_event_id: eventId,
    mingla_buyer_email: buyerEmail,
    ...(isInstallmentPlan ? { mingla_installment_plan_root: 'true' } : {}),
    // NEW — webhook commit handler reads this to call createFromCalculation:
    mingla_tax_calculation_id: taxCalculation.id,
  },
};
// Rest of PI create body construction (installment branch, application_fee) unchanged.
```

**Response shape addition (`requires_payment` kind):**

```ts
return jsonResponse({
  kind: 'requires_payment',
  checkoutSessionId,
  buyerStatusToken,
  totalCents: taxCalculation.amount_total,  // TAX-INCLUSIVE (was totalCents)
  subtotalCents: totalCents,                // NEW — pre-tax for receipt display
  taxCents: taxCalculation.amount_total - totalCents,  // NEW
  taxBreakdown: taxCalculation.tax_breakdown,  // NEW — for receipt rendering
  currency: String(session.currency ?? 'GBP'),
  clientSecret,
  paymentIntentId: paymentIntent.id,
  publishableKey: ...,
  stripeAccountId,
  customerId,
  customerEphemeralKeySecret,
});
```

#### 3.2.1.bis RPC `biz_ticket_checkout_create_session` (MODIFY)

Add `lineItems: v_items` to the return jsonb at the existing RETURN statement (currently builds `v_items` at lines 253-259 of `20260610000002_tr3_ticket_checkout_session_installment_aware.sql` but does NOT return them). Single-line addition to the existing `jsonb_build_object` at line 433:

```sql
RETURN jsonb_build_object(
  'checkoutSessionId', v_session_id,
  'eventId', p_event_id,
  'brandId', v_event.brand_id,
  'status', v_status,
  'totalCents', v_total,
  'subtotalCents', v_total,  -- NEW: same as totalCents pre-tax; orchestrator-renamed if confusing
  'currency', trim(COALESCE(v_currency, 'GBP'::character(3))),
  'eventName', v_event.title,
  'stripeAccountId', v_stripe_account_id,
  'lineItems', v_items,  -- NEW: per-tier breakdown for tax calc
  -- existing fields preserved (installmentSchedule etc.)
  ...
);
```

This is a NEW `CREATE OR REPLACE FUNCTION` in the same `20260727000000_orch_0955_native_stripe_tax.sql` migration. Migration-chain rule: copy the current full body of `biz_ticket_checkout_create_session` from `20260610000002_tr3_ticket_checkout_session_installment_aware.sql` verbatim, add the two new return fields, and ship in this migration. Do NOT skip — the latest definition wins; partial diffs are not how Postgres `CREATE OR REPLACE FUNCTION` works.

#### 3.2.2 `_shared/stripeWebhookRouter.ts` (MODIFY)

**Insertion point:** inside `handleTicketCheckoutPaymentIntent` (line 723 post-rebase), AFTER the `biz_ticket_checkout_finalize` RPC call returns success (line ~798), BEFORE the AppsFlyer block (~line 817):

```ts
// ORCH-0955 — commit Stripe Tax transaction after order finalize.
// Per SPEC §3.2.2. Connected-account-scoped; idempotent against webhook re-delivery
// via Stripe-side idempotency key keyed on paymentIntentId.
const piMetadataForTax = (paymentIntent.metadata as Record<string, unknown> | undefined) ?? {};
const taxCalculationId = typeof piMetadataForTax['mingla_tax_calculation_id'] === 'string'
  ? piMetadataForTax['mingla_tax_calculation_id'] as string
  : null;

if (taxCalculationId && orderId) {
  // Resolve connected account from session.brand_id (same chain as refund-order:225-265).
  const { data: brandRow } = await supabase
    .from('orders').select('event_id, events(brand_id, brands(stripe_connect_id))')
    .eq('id', orderId).maybeSingle();
  const connectedAccountId = (((brandRow as any)?.events?.brands?.stripe_connect_id) ?? null) as string | null;

  if (connectedAccountId) {
    try {
      const stripeForTax = stripeTicketCheckout();
      // @ts-ignore — Stripe SDK namespace runtime-provided in Deno
      const taxTx = await stripeForTax.tax.transactions.createFromCalculation(
        { calculation: taxCalculationId, reference: paymentIntentId, expand: ['line_items'] },
        { stripeAccount: connectedAccountId, idempotencyKey: paymentIntentId },
      );
      await supabase.from('orders').update({
        stripe_tax_transaction_id: String(taxTx.id),
        tax_breakdown: (taxTx as any).line_items ?? null,
        updated_at: new Date().toISOString(),
      }).eq('id', orderId);
    } catch (taxCommitErr) {
      // NON-FATAL: order is already finalized; tax record is recoverable via Stripe Tax dashboard
      // OR by a future reconciliation sweep. Log + continue.
      console.error('[stripe-webhook] tax.transactions.createFromCalculation failed', orderId, taxCommitErr instanceof Error ? taxCommitErr.message : String(taxCommitErr));
    }
  }
}
```

**Backstop in refund event handlers:** in the existing `case 'charge.refunded':` / `case 'refund.created':` / `case 'refund.updated':` arms at lines ~1000-1009, AFTER the existing refund-row reconciliation logic, add:

```ts
// ORCH-0955 — backstop tax reversal if inline-sync path in refund-order failed.
// Idempotent: only fires when orders.stripe_tax_transaction_id is set AND
// refunds.stripe_tax_transaction_id is null AND refund status is 'succeeded'.
// Full reversal mode only on backstop path (partial-refund line-amount math is the
// inline-sync handler's job; backstop never sees enough info to do partial accurately).
// On any error, log + continue. The inline-sync 502 response is the operator's primary
// signal; the backstop is defense-in-depth, not the source of truth.
// [Implementor: write this conservatively; tester adversarial T-22 below covers the
// idempotency + race-with-inline-sync angles.]
```

#### 3.2.3 `refund-order/index.ts` (MODIFY)

**Insertion point:** after `stripe.refunds.create` returns success (line 298 post-rebase) and BEFORE `biz_refund_order_commit` (line 335):

```ts
// ORCH-0955 — inline-sync Stripe Tax reversal.
// Per SPEC §3.2.3. Fails 502 on error so the operator sees the failure and can manually
// reconcile via Stripe Tax dashboard; the webhook backstop (§3.2.2) is defense-in-depth only.
const { data: orderTaxRow } = await supabase
  .from('orders').select('stripe_tax_transaction_id, tax_amount_cents')
  .eq('id', orderId).maybeSingle();
const originalTaxTxId = typeof orderTaxRow?.stripe_tax_transaction_id === 'string'
  ? orderTaxRow.stripe_tax_transaction_id : null;

let reversalTaxTxId: string | null = null;
if (originalTaxTxId) {
  const isFullRefund = pending.is_full_refund === true;
  try {
    const stripeForTaxReversal = stripeTicketRefund();
    // @ts-ignore — Stripe SDK namespace runtime-provided in Deno
    const reversal = await stripeForTaxReversal.tax.transactions.createReversal(
      {
        mode: isFullRefund ? 'full' : 'partial',
        original_transaction: originalTaxTxId,
        reference: `mingla_refund:${refundId}`,
        expand: ['line_items'],
        // For partial: SPEC author / implementor must construct line_items[] with per-line
        // negative amounts proportional to the refunded portion. Use the refund-input
        // `lines: RefundLineInput[]` (already validated at line 138) — for each refund line,
        // emit { amount: -line.amount_cents, reference: `line:${line.order_line_item_id}` }.
        // For full reversals, line_items is OMITTED (Stripe reverses every line of original_transaction).
        ...(isFullRefund ? {} : {
          line_items: lines.map((l) => ({
            amount: -l.amount_cents,
            reference: `line:${l.order_line_item_id}`,
          })),
        }),
      },
      { stripeAccount: connectedAccountId, idempotencyKey: `tax_reversal:${refundId}` },
    );
    reversalTaxTxId = String(reversal.id);
  } catch (taxReversalErr) {
    const detail = taxReversalErr instanceof Error ? taxReversalErr.message : String(taxReversalErr);
    console.error('[refund-order] tax.transactions.createReversal failed', detail);
    // Mark refund as failed so the row reflects reality + operator gets a signal.
    await supabaseAsUser.rpc('biz_refund_order_commit', {
      p_refund_id: refundId,
      p_stripe_refund_id: stripeRefund.id,
      p_application_fee_refunded_cents: 0,
      p_status: 'failed',
    });
    return jsonResponse(
      { error: 'stripe_tax_reversal_failed', detail, refund_id: refundId, stripe_refund_id: stripeRefund.id },
      502,
    );
  }
}
```

**Persist reversal id on the commit RPC call:**

```ts
// Existing biz_refund_order_commit call (line 335) — extend with new param:
const { data: commitResult, error: commitError } = await supabaseAsUser.rpc(
  'biz_refund_order_commit',
  {
    p_refund_id: refundId,
    p_stripe_refund_id: stripeRefund.id,
    p_application_fee_refunded_cents: applicationFeeRefundedCents,
    p_status: 'succeeded',
    p_stripe_tax_transaction_id: reversalTaxTxId,  // NEW
  },
);
```

**RPC `biz_refund_order_commit` (MODIFY):** add `p_stripe_tax_transaction_id text DEFAULT NULL` to the signature; persist to `refunds.stripe_tax_transaction_id` in the UPDATE. Latest definition lives at TBD (implementor greps `supabase/migrations/` for `biz_refund_order_commit`). Ship the amended definition in the ORCH-0955 migration via `CREATE OR REPLACE FUNCTION`.

#### 3.2.4 `brand-stripe-tax-account-session` (NEW)

**File:** `supabase/functions/brand-stripe-tax-account-session/index.ts`.

```ts
// ORCH-0955 — mints Stripe AccountSession for embedded Tax UI components.
// Replaces brand-stripe-tax-dashboard-link (DELETED) per Q7 / COMMS-0001.
// Per SPEC §3.2.4. Reuses STRIPE_RAK_ONBOARD per Q9 (must have account_sessions:write).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createStripeClient } from '../_shared/stripe.ts';
import { writeAudit } from '../_shared/audit.ts';
import { generateIdempotencyKey } from '../_shared/idempotency.ts';
import {
  corsHeaders, isValidUuid, jsonResponse, requirePaymentsManager,
  requireUserId, serviceRoleClient,
} from '../_shared/stripeEdgeAuth.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const userIdOrResponse = await requireUserId(req);
  if (userIdOrResponse instanceof Response) return userIdOrResponse;
  const userId = userIdOrResponse;

  let body: { brand_id?: string; brandId?: string };
  try { body = await req.json(); } catch { return jsonResponse({ error: 'validation_error', detail: 'invalid_json' }, 400); }

  const brandId = body.brand_id ?? body.brandId;
  if (!isValidUuid(brandId)) return jsonResponse({ error: 'validation_error', detail: 'brand_id_invalid_uuid' }, 400);

  const supabase = serviceRoleClient();
  const forbidden = await requirePaymentsManager(supabase, brandId, userId);
  if (forbidden) return forbidden;

  const { data: account, error: accountError } = await supabase
    .from('stripe_connect_accounts')
    .select('stripe_account_id, detached_at')
    .eq('brand_id', brandId).maybeSingle();
  if (accountError) return jsonResponse({ error: 'internal_error' }, 500);
  if (!account?.stripe_account_id) return jsonResponse({ error: 'stripe_account_not_connected' }, 409);
  if (account.detached_at !== null) return jsonResponse({ error: 'stripe_account_detached' }, 409);

  let sessionResult: { client_secret: string; expires_at?: number };
  try {
    const stripe = createStripeClient('STRIPE_RAK_ONBOARD');
    // @ts-ignore — Stripe SDK namespace runtime-provided in Deno
    sessionResult = await stripe.accountSessions.create(
      {
        account: account.stripe_account_id,
        components: {
          tax_registrations: { enabled: true },
          tax_settings: { enabled: true },
        },
      },
      { idempotencyKey: generateIdempotencyKey(brandId, 'tax_account_session') },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown_error';
    console.error('[brand-stripe-tax-account-session] accountSessions.create failed:', detail);
    return jsonResponse({ error: 'stripe_account_session_failed', detail }, 502);
  }

  if (typeof sessionResult?.client_secret !== 'string' || sessionResult.client_secret.length === 0) {
    return jsonResponse({ error: 'stripe_account_session_empty' }, 502);
  }

  await writeAudit(supabase, {
    user_id: userId, brand_id: brandId,
    action: 'stripe_tax.account_session_minted',
    target_type: 'stripe_connect_account',
    target_id: account.stripe_account_id,
  });

  return jsonResponse(
    { clientSecret: sessionResult.client_secret, expiresAt: sessionResult.expires_at ?? null, brandStripeAccountId: account.stripe_account_id },
    200,
  );
});
```

#### 3.2.5 `brand-stripe-tax-dashboard-link` (DELETE)

Delete the entire file `supabase/functions/brand-stripe-tax-dashboard-link/index.ts`. Delete `supabase/functions/brand-stripe-tax-dashboard-link/` directory. The export `stripeTaxDashboardLink` in `_shared/stripe.ts:72-73` becomes unreferenced after the UI callsite update (§3.4.2); DELETE the export too (no other callers per grep at IMPLEMENT time — verify).

**CLOSE Step 5 Deprecation Extension applies** (deleted edge function): orchestrator must run the 8-substep extension at CLOSE time. SPEC pre-flags: new memory file `feedback_brand_stripe_tax_dashboard_link_decommissioned.md` with `status: DRAFT — flips to ACTIVE on ORCH-0955 CLOSE`; new invariant `I-PROPOSED-EMBEDDED-TAX-UI` in INVARIANT_REGISTRY.

#### 3.2.6 `_shared/stripeTax.ts` (DELETE)

Delete the entire file (22 lines, ORCH-0953 §3.8). Delete the import at `ticket-checkout-create/index.ts:4`. Delete the gate-test files enumerated in §3.6.

### 3.3 Service / hook layer

**No new service files.** The mobile-side flow is:
- Cart sheet collects address → invokes `ticket-checkout-create` with `mode: 'preview'` → renders tax preview.
- "Pay" tap → re-invokes `ticket-checkout-create` with `mode: 'create'` + same `taxCalculationId` (passes through) → receives tax-inclusive PI client_secret → PaymentSheet flow as today.

**`nativeCheckoutFlow.ts` (consumer) and `nativeCheckoutFlow.native.ts` (business) — MODIFY:**

1. Add `address: NativeCheckoutInput['buyer']['address']` field to the `NativeCheckoutInput.buyer` interface (matches the edge function request shape in §3.2.1).
2. Pass `address` through to the edge function invocation (line 99-115 consumer / 159-178 business).
3. DELETE the gate-error-handling toast logic: any code path that surfaces `native_paid_not_allowed_in_region` to the user (verify presence at IMPLEMENT time — likely in `extractFunctionError` / `extractEdgeFunctionError` callers).
4. NEW optional input: `taxCalculationId?: string` — when present, passed through to the edge function.

**No React Query hook changes** (the flow is mutation-style via `supabase.functions.invoke`; no cached server state).

### 3.4 Component layer

#### 3.4.1 Cart-sheet address form + tax preview (NEW)

**Files (consumer):** new component at `app-mobile/src/components/checkout/CartTaxPreview.tsx` OR inline within the existing cart entry component (`ExpandedBusinessEventSheet.tsx` — exact insertion point left to implementor, but the cart flow MUST collect address before "Pay" is enabled).

**Files (business):** mirror at `mingla-business/src/components/checkout/CartTaxPreview.tsx` (mirroring per ORCH-0849 DEC-PASS2-4).

**Address form fields** (all `TextInput` per the established mingla pattern; respect the keyboard-never-blocks-input memory rule):
- Line 1 (required) — `autoComplete="address-line1"`, `textContentType="streetAddressLine1"`
- Line 2 (optional) — `autoComplete="address-line2"`, `textContentType="streetAddressLine2"`
- City (required) — `autoComplete="address-level2"`, `textContentType="addressCity"`
- State / Region (optional) — `autoComplete="address-level1"`, `textContentType="addressState"`
- Postal code (required) — `autoComplete="postal-code"`, `textContentType="postalCode"`, `keyboardType="default"` (NOT numeric — international postal codes contain letters)
- Country (required) — `Picker` or autocomplete bound to a Stripe-supported-country list (cache locally; do NOT inline the list inside the component, put it in `app-mobile/src/utils/stripeSupportedCountries.ts` mirrored from the existing `supabase/functions/_shared/stripeSupportedCountries.ts`).

**States:**
- **Initial / address-empty:** form rendered, "Calculate tax" button DISABLED until required fields filled.
- **Address-complete, calc-pending:** show inline spinner ("Calculating tax…").
- **Calc-success:** render line items table:
  ```
  3× General Admission   $20.00 each    $60.00
  ─────────────────────────────────────────────
  Subtotal                                $60.00
  Tax (NC sales tax 7.25%)                 $4.35   [if tax_breakdown.length===1: show jurisdiction name]
  Total                                   $64.35
  ─────────────────────────────────────────────
                                         [Pay]
  ```
  When `tax_breakdown.length > 1`, expand into per-jurisdiction lines (e.g., "NC state tax: $3.00, Wake County: $1.35").
- **Calc-zero-tax:** render "Tax $0.00" line explicitly (per Constitution #9: missing ≠ hidden; show $0.00 so buyer sees Stripe Tax confirmed zero — don't fabricate "tax-free" copy).
- **Calc-error:** render error toast "Couldn't calculate tax. Tap to retry." — re-invokes preview. Do NOT auto-proceed to "Pay" without tax confirmed.

**"Pay" button handler:** invokes `useNativeCheckoutFlow()(...)` with `address` + `taxCalculationId` (the one returned from preview, if still valid). Edge function reuses it; if expired, edge function re-calcs silently. No UI difference.

**Accessibility:** every field has `accessibilityLabel`. Form is keyboard-aware (per `feedback_keyboard_never_blocks_input.md`). Loading + error states have visible labels (no spinners-only).

#### 3.4.2 `BrandPaymentsView.tsx` Tax CTA (MODIFY)

**File:** `mingla-business/src/components/brand/BrandPaymentsView.tsx`.

**Current behaviour:** Tax CTA invokes `brand-stripe-tax-dashboard-link` and opens the returned URL in `expo-web-browser.openAuthSessionAsync`.

**New behaviour:** Tax CTA invokes `brand-stripe-tax-account-session`, receives `{ clientSecret, brandStripeAccountId }`, opens Mingla-hosted URL `https://<MINGLA_PUBLIC_WEB_BASE_URL>/connect-tax-registrations?clientSecret=${encodeURIComponent(clientSecret)}&brandStripeAccountId=${encodeURIComponent(brandStripeAccountId)}` in `expo-web-browser.openAuthSessionAsync`. Same auth-session pattern as ORCH-0954 onboarding (mirror naming convention if ORCH-0954 SPEC has landed by IMPLEMENT-time).

CTA copy stays "Manage tax registrations" (existing copy is fine).

#### 3.4.3 New page `mingla-business/app/connect-tax-registrations/index.tsx` (NEW)

```tsx
// ORCH-0955 — Mingla-hosted page that renders Stripe embedded Tax components.
// Opened from BrandPaymentsView Tax CTA via expo-web-browser.openAuthSessionAsync.
// Mirror ORCH-0954's connect-onboarding page pattern exactly (helper-naming TBD pending
// ORCH-0954 SPEC landing; IMPLEMENT reconciles if needed).

import { useEffect, useState } from 'react';
import { loadConnectAndInitialize } from '@stripe/connect-js';
import {
  ConnectComponentsProvider, ConnectTaxRegistrations, ConnectTaxSettings,
} from '@stripe/react-connect-js';
// ...full implementation per ORCH-0954's onboarding page; both components mounted on the same page.
```

**Page behaviour:**
- Reads `clientSecret` + `brandStripeAccountId` from URL search params.
- Initialises `@stripe/connect-js` with `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` (read from env).
- Wraps `<ConnectComponentsProvider>` with the connect instance.
- Renders both `<ConnectTaxRegistrations>` and `<ConnectTaxSettings>` stacked vertically with a heading per component ("Tax registrations" / "Tax settings"). Stripe handles all internal UX; Mingla provides shell chrome only.
- Errors (invalid clientSecret, expired session) surface via the Connect SDK's onLoadError callback → render "Tax tools temporarily unavailable. Close this window and try again from the app."

**Package additions:**
- `mingla-business/package.json`: add `@stripe/connect-js` + `@stripe/react-connect-js` if not already present (ORCH-0954 may add them first; IMPLEMENT checks).

#### 3.4.4 Receipt screen (mobile) — surface tax line

If a receipt / order-detail screen exists in `app-mobile/` or `mingla-business/` that renders order totals, amend to display:
- Subtotal
- Tax (only if `order.tax_amount_cents > 0`)
- Total

Exact files TBD by implementor — grep `formatMoney.*tax\|order.*total\|orderDetails` in `app-mobile/src/components/` and `mingla-business/src/components/`. Mirror the email template style (§3.5).

#### 3.4.5 Refund detail UI — show tax portion

When the business app displays a refund summary, if the parent order had tax:
- Refund amount
- Tax portion of refund (read `tax_amount_cents * (refund_amount_cents / order.total_cents)` or, more precisely, the difference between order's `tax_amount_cents` and `tax_amount_cents - reversal_tax_amount` — implementor picks the cleanest data path)
- Net refund to buyer

### 3.5 Email template layer

**File:** `supabase/functions/_shared/email/ticketBody.ts`.

**Current state (verified at SPEC-write):** `renderLineItems` function (lines 70-100) renders line items + Total row but **zero tax line**. `text` rendering (line 213-217) likewise.

**Required amendment to `renderLineItems`:** insert a tax row between the last line item and the Total row, ONLY when `order.taxAmountCents > 0` (need to add `taxAmountCents` + `taxBreakdown?` to `TicketBodyInput['order']` interface in `_shared/email/types.ts`).

```ts
const taxRow = order.taxAmountCents > 0
  ? `<tr>
       <td style="padding:10px 0;font-size:14px;color:${BRAND_MUTED};border-bottom:1px solid ${BRAND_BORDER};">Tax${order.taxBreakdown && order.taxBreakdown.length === 1 ? ` (${escapeHtml(extractJurisdictionLabel(order.taxBreakdown[0]))})` : ''}</td>
       <td></td>
       <td align="right" style="padding:10px 0;font-size:14px;color:${BRAND_INK};border-bottom:1px solid ${BRAND_BORDER};">${escapeHtml(formatMoneyFromCents(order.taxAmountCents, order.currency))}</td>
     </tr>`
  : '';
```

Position the tax row between the `rows` (line items) and the Total row. Text rendering: add a `Tax: $X.XX` line above the Total line.

**Caller plumbing:** `ticket-confirmation-dispatch/index.ts` (1296 lines) builds the `TicketBodyInput` from the orders row. Implementor extends to include `taxAmountCents` (from `orders.tax_amount_cents`) + `taxBreakdown` (from `orders.tax_breakdown`).

### 3.6 Test files to DELETE (Q13 lock + `[TEST-MOD-APPROVED ORCH-0955]`)

All four verified to exist at SPEC-write time (`ls` output 2026-05-24):
1. `supabase/functions/ticket-checkout-create/__tests__/nativeRegionGate_adversarial.test.ts` (3169 bytes)
2. `supabase/functions/ticket-checkout-create/__tests__/nativePaidRegionGate.test.ts` (1870 bytes)
3. `app-mobile/src/payments/__tests__/nativeCheckoutFlow_regionGateToast.test.tsx` (440 bytes)
4. `mingla-business/src/payments/__tests__/nativeCheckoutFlow_regionGateToast.test.tsx` (484 bytes)

IMPLEMENT also greps `.github/scripts/strict-grep/` for any `orch-0953-native-region-gate*.mjs` strict-grep gates and deletes them.

CLOSE commit body MUST contain literal string `[TEST-MOD-APPROVED ORCH-0955]` so the orchestrator's pre-commit hook permits the deletions.

---

## 4. Success criteria

Numbered. Observable. Testable. Per-surface where parity is manual.

**SC-1 — Native paid in tax-collecting jurisdiction charges tax.** US ticket purchase on consumer iOS with NC buyer address, $20 ticket, brand registered in NC for sales tax: PaymentSheet shows total $21.45 (subtotal $20.00 + 7.25% NC tax = $1.45); buyer is charged $21.45; `orders.tax_amount_cents = 145`, `orders.tax_calculation_id` is non-null; Stripe Tax dashboard for the connected account shows a committed transaction matching the order.
- SC-1-iOS-consumer / SC-1-Android-consumer / SC-1-iOS-business / SC-1-Android-business (manual parity).

**SC-2 — Native paid in non-registered jurisdiction succeeds with zero tax.** US ticket purchase with TX buyer address, brand registered only in NC: tax preview shows "Tax $0.00", PaymentSheet total = subtotal, buyer pays face value, `orders.tax_amount_cents = 0`, `tax_calculation_id` is non-null (calc still ran, just returned zero), `tax_breakdown` is empty array. No Stripe error.

**SC-3 — Tax preview matches PaymentSheet total exactly.** Cart sheet preview total === PaymentSheet "Total to pay" === `orders.total_cents` (post-finalize) === Stripe charge amount, to-the-cent.

**SC-4 — Full refund issues `createReversal` (mode='full').** Operator refunds the full order: `refunds.stripe_tax_transaction_id` populated; Stripe Tax dashboard shows reversal transaction; brand's Stripe Tax report reflects net-zero collected tax for that order; buyer receives full refunded amount including tax.

**SC-5 — Partial refund issues `createReversal` (mode='partial') with correct line amounts.** Operator refunds 1 of 3 tickets: reversal line_items[] contains one entry with `amount = -unit_total_with_tax_proportion`; net `orders.tax_amount_cents - reversed_tax_portion` reflects the still-owed tax on the 2 retained tickets.

**SC-6 — Webhook re-delivery is idempotent.** Same `payment_intent.succeeded` event delivered twice: `tax.transactions.createFromCalculation` called twice with same `idempotencyKey: paymentIntentId`; second call returns the existing transaction (Stripe-side dedup); `orders.stripe_tax_transaction_id` is the SAME value both times (not overwritten with a new id). No duplicate tax committed.

**SC-7 — Address-missing on native paid mode='create' returns 400 with clear error.** Edge function returns `{ error: 'buyer_address_required', detail: 'buyer.address.line1 is required for native paid checkout' }` (or similar per-field detail); mobile client displays the per-field error to the user.

**SC-8 — Address-missing on mode='preview' returns zero-tax preview with flag.** Response shape includes `addressMissing: true`; client UI prompts the user to fill the address rather than displaying $0.00 tax as truth.

**SC-9 — Brand admin taps "Manage tax registrations" → sees embedded Stripe Tax UI.** From `BrandPaymentsView` → CTA opens Mingla-hosted `/connect-tax-registrations` page in `expo-web-browser` → `<ConnectTaxRegistrations>` + `<ConnectTaxSettings>` render → admin can click into Stripe's flow to register in a new jurisdiction → registration appears in a follow-up `account_sessions.create` call (verified by re-opening the page).
- SC-9-iOS-business / SC-9-Android-business / SC-9-web (manual parity; web is the rendering target).

**SC-10 — Old `brand-stripe-tax-dashboard-link` is gone.** Greppin `supabase/functions/` for `brand-stripe-tax-dashboard-link` returns ZERO hits. Greppin `stripeTaxDashboardLink` returns ZERO hits. Greppin `mingla-business/src/` for `brand-stripe-tax-dashboard-link` returns ZERO hits (UI callsite updated).

**SC-11 — Region gate is deleted.** Greppin entire repo for `NATIVE_PAID_ALLOWED_REGIONS`, `isNativePaidAllowedForBrand`, `_shared/stripeTax.ts`, `native_paid_not_allowed_in_region` returns ZERO hits (all instances removed; gate-defending tests deleted).

**SC-12 — Email receipt renders tax line when present.** Buyer receipt email for an order with `tax_amount_cents = 145, currency='USD'` renders an explicit "Tax $1.45" row between the last line item and the Total row; HTML + text bodies both. Order with `tax_amount_cents = 0` renders NO tax row (don't show "Tax $0.00" in the email — different rule from the cart preview because email is post-purchase and clutter-sensitive).

**SC-13 — Stale ORCH-0804 column comments refreshed.** `SELECT col_description('public.orders'::regclass::oid, attnum) FROM pg_attribute WHERE attname IN ('tax_amount_cents', 'tax_calculation_id')` returns comments that mention "ORCH-0955" and "direct charge per ORCH-0843"; does NOT mention `automatic_tax.liability.type=account` (stale destination-charge framing).

**SC-14 — `NATIVE_PAID_ALLOWED_REGIONS` secret deleted from Supabase.** After CLOSE Step 3 deploy, `supabase secrets list --project-ref gqnoajqerqhnvulmnyvv` does NOT include `NATIVE_PAID_ALLOWED_REGIONS`.

**SC-15 — Stripe RAK permissions accept the new calls.** Live-mode tax calculation call from edge function against an authorized RAK succeeds without 403 (verified post-RAK-update by operator at IMPLEMENT time; tester re-verifies in TEST live-fire phase).

**SC-16 — Reversal commit-RPC failure mid-flight leaves consistent state.** If `stripe.refunds.create` succeeds but `tax.transactions.createReversal` fails: refund row marked `failed`; HTTP 502 returned to operator; `orders.stripe_tax_transaction_id` untouched; webhook backstop (§3.2.2) attempts reversal on next `refund.updated` event and succeeds OR also fails (operator gets second signal). Order is NOT in a partially-refunded-with-orphaned-tax state.

---

## 5. Invariants

### New invariants (this SPEC establishes)

- **I-PROPOSED-NATIVE-TAX-COVERAGE** — every native PaymentIntent created in `ticket-checkout-create` is preceded by `tax.calculations.create` against the same connected account. Strict-grep gate: file must contain both `stripe.tax.calculations.create(` and `stripe.paymentIntents.create(` AND the calc must appear before the PI create. Enforced by `.github/scripts/strict-grep/orch-0955-native-tax-coverage.mjs`.
- **I-PROPOSED-TAX-COMMIT-ON-SUCCESS** — `_shared/stripeWebhookRouter.ts` `handleTicketCheckoutPaymentIntent` calls `tax.transactions.createFromCalculation` when PI metadata contains `mingla_tax_calculation_id`. Strict-grep gate: file must contain `'mingla_tax_calculation_id'` AND `tax.transactions.createFromCalculation(`.
- **I-PROPOSED-TAX-REVERSAL-ON-REFUND** — `refund-order/index.ts` calls `tax.transactions.createReversal` when `orders.stripe_tax_transaction_id IS NOT NULL`. Strict-grep gate: file must contain `stripe_tax_transaction_id` AND `tax.transactions.createReversal(`.
- **I-PROPOSED-EMBEDDED-TAX-UI** — `brand-stripe-tax-account-session/index.ts` exists; `brand-stripe-tax-dashboard-link/index.ts` does NOT exist; `mingla-business/src/components/brand/BrandPaymentsView.tsx` invokes the new function name. Strict-grep gate: any reference to `brand-stripe-tax-dashboard-link` anywhere is a FAIL.
- **I-PROPOSED-REGION-GATE-DELETED** — `_shared/stripeTax.ts` does NOT exist; `NATIVE_PAID_ALLOWED_REGIONS` does NOT appear in any source file (including comments, configs, scripts); `isNativePaidAllowedForBrand` is not referenced. Strict-grep gate: any hit on these tokens is a FAIL. Supersedes any ORCH-0953 region-gate gate.

### Existing invariants this SPEC must preserve

- I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST (ORCH-0849) — `payment_method_types` continues to use `getPaymentMethodTypes()` / `getInstallmentPaymentMethodTypes()`. Tax wiring does not touch this.
- I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY (ORCH-0849) — consumer + business `nativeCheckoutFlow` files stay in mirrored shape (same address-field plumbing, same tax-preview UI components).
- I-RLS-RETURNING-OWNER-GAP — refund RPC pattern preserved; new column additions don't change RLS shape.
- ORCH-0843 direct-charge invariant — `application_fee_amount` preserved on the tax-inclusive amount (Mingla's 1.5% cut applies to the subtotal, NOT the tax; SPEC IMPLEMENT detail: `application_fee_amount = Math.round(totalCents * 0.015)` stays based on pre-tax subtotal, not the new tax-inclusive total; otherwise Mingla would extract a fee from tax that belongs to the jurisdiction).

---

## 6. Test matrix (ORCH-0840 regression contract)

Format: `T-NN | Layer | Scenario | Owner | Expected`.

### Implementor happy-path tests (≥1 per layer touched)

| Test | Layer | Scenario | Expected |
|---|---|---|---|
| T-IH-01 | Edge fn `ticket-checkout-create` | Native paid US with NC address, $20 ticket, brand registered NC | `tax.calculations.create` called once; PI created with amount=$21.45; response includes `subtotalCents=2000`, `taxCents=145`, `totalCents=2145`, non-null `paymentIntentId` |
| T-IH-02 | Edge fn `ticket-checkout-create` mode=preview | Same inputs, `mode: 'preview'` | Returns `kind:'preview'` shape; NO `paymentIntents.create` call (verify via Stripe SDK mock); `calculationId` non-null |
| T-IH-03 | Webhook router | `payment_intent.succeeded` event with `mingla_tax_calculation_id` metadata | `tax.transactions.createFromCalculation` called with `stripeAccount` header + `idempotencyKey=PI.id`; `orders.stripe_tax_transaction_id` populated |
| T-IH-04 | Edge fn `refund-order` | Full refund of order with `stripe_tax_transaction_id` | `tax.transactions.createReversal` called with `mode:'full'`; `refunds.stripe_tax_transaction_id` populated; HTTP 200 |
| T-IH-05 | Edge fn `refund-order` | Partial refund of 1-of-3 tickets | `createReversal` called with `mode:'partial'` + `line_items[]` containing 1 entry with negative `amount` proportional to refunded portion |
| T-IH-06 | DB migration | After apply, `orders` has columns `stripe_tax_transaction_id` + `tax_breakdown`; `refunds` has `stripe_tax_transaction_id`; `ticket_checkout_sessions` has tax columns; stale comments refreshed | `information_schema.columns` returns all 5 new columns; `col_description` returns ORCH-0955 string |
| T-IH-07 | New edge fn `brand-stripe-tax-account-session` | Brand admin POSTs with valid `brand_id` | Returns `{clientSecret, expiresAt, brandStripeAccountId}` ; audit row `stripe_tax.account_session_minted` written |
| T-IH-08 | Email template `ticketBody.ts` | `renderLineItems` called with `order.taxAmountCents=145, currency='USD'` | Output HTML contains "Tax" + "$1.45" rendered as a `<tr>` between line items and Total; text output contains "Tax: $1.45" line |
| T-IH-09 | Component `CartTaxPreview` (consumer) | Address filled, preview returns `taxCents=145` | Renders "Tax (NC sales tax) $1.45" line; "Pay" button enabled |
| T-IH-10 | Component `CartTaxPreview` (business) | Mirror of T-IH-09 | Same rendering, business merchant identifier |
| T-IH-11 | Component `BrandPaymentsView` | Tap "Manage tax registrations" CTA | Invokes `brand-stripe-tax-account-session`, then `expo-web-browser.openAuthSessionAsync` with the Mingla-hosted URL |
| T-IH-12 | Strict-grep gate | Run `orch-0955-native-tax-coverage.mjs` against `ticket-checkout-create/index.ts` | Returns exit 0 (calc-before-create pattern detected) |

**Implementor fails-on-revert verification:** for each happy-path test, after the test passes against the implemented fix, revert the corresponding code change to ORCH-0953 baseline and re-run the test — it MUST fail. Implementor records `fails-on-revert verified at <commit-hash>` in the implementation report per ORCH-0840 contract.

### Tester adversarial tests (≥1 per layer, different angles than happy-path)

| Test | Layer | Scenario | Angle | Expected |
|---|---|---|---|---|
| T-TA-01 | Edge fn `ticket-checkout-create` | Address with `country: 'us'` (lowercase) | Input validation case-sensitivity | 400 `buyer_address_invalid` with `detail: 'country must match ISO-3166 alpha-2 uppercase'` |
| T-TA-02 | Edge fn `ticket-checkout-create` | `taxCalculationId` provided but expired (>48h old) | Stale cache poisoning | Edge function detects expiry, silently re-calcs; response has NEW `calculationId`; no error to user |
| T-TA-03 | Edge fn `ticket-checkout-create` | `tax.calculations.create` returns 503 (Stripe transient) | External API failure | 502 `tax_calculation_failed` with detail; session marked `failed`; no orphaned PI created |
| T-TA-04 | Webhook router | `payment_intent.succeeded` event WITHOUT `mingla_tax_calculation_id` (legacy / web flow PI) | Backward compat | Tax commit block skipped; order finalizes normally; no error logged |
| T-TA-05 | Webhook router | Duplicate `payment_intent.succeeded` event (Stripe re-delivery) | Idempotency | `createFromCalculation` called twice with same `idempotencyKey`; both calls return same `tax_transaction_id`; `orders.stripe_tax_transaction_id` is the SAME value (not changed on second event); no Stripe billing duplication |
| T-TA-06 | Edge fn `refund-order` | Order has NO `stripe_tax_transaction_id` (pre-ORCH-0955 historical order being refunded today) | Backward compat | Reversal block skipped; refund proceeds; HTTP 200; no error |
| T-TA-07 | Edge fn `refund-order` | `tax.transactions.createReversal` returns 400 (Stripe rejects reversal — e.g., already-fully-reversed) | Stripe-side state drift | 502 `stripe_tax_reversal_failed`; refund row marked `failed`; operator gets clear signal; webhook backstop attempts on next refund event |
| T-TA-08 | DB migration | Apply migration twice (idempotency) | Idempotency | Second `db push` is no-op; `IF NOT EXISTS` on ADD COLUMN prevents error; comments updated to ORCH-0955 text both times |
| T-TA-09 | New edge fn `brand-stripe-tax-account-session` | Caller is not a payments manager of the brand | RBAC | 403 from `requirePaymentsManager` gate; no Stripe call made |
| T-TA-10 | New edge fn `brand-stripe-tax-account-session` | Brand's Stripe connect account is detached | State guard | 409 `stripe_account_detached`; no Stripe call |
| T-TA-11 | Page `connect-tax-registrations` | Invalid `clientSecret` in URL (expired session) | Client error UX | `onLoadError` callback fires; page renders "Tax tools temporarily unavailable. Close this window and try again from the app." |
| T-TA-12 | Component `CartTaxPreview` | Address country = 'XX' (Stripe-unsupported country) | Stripe rejection | Edge function returns 400 from `tax.calculations.create`; UI shows "Tax couldn't be calculated for this country. Choose a different billing country."  |
| T-TA-13 | Component `CartTaxPreview` | User changes address AFTER preview was calculated | Stale preview | UI invalidates `taxCalculationId` on any address field change; next preview call mints a fresh calc |
| T-TA-14 | Strict-grep gate | After implementor adds tax commit but inserts a comment containing `NATIVE_PAID_ALLOWED_REGIONS` | False-positive defense | Gate `orch-0955-region-gate-deleted.mjs` FAILs (and SHOULD — even comments referencing the deleted env are a regression risk) |
| T-TA-15 | Email template | `order.taxBreakdown` has 2 entries (state + county tax) | Per-jurisdiction breakdown rendering | Output HTML contains BOTH jurisdiction names; combined tax row OR per-jurisdiction rows (SPEC permits either; tester verifies the chosen approach is consistent) |
| T-TA-16 | Edge fn `ticket-checkout-create` | `application_fee_amount` calculation uses pre-tax subtotal, not tax-inclusive total | Fee correctness | Verify `application_fee_amount === Math.round(2000 * 0.015) === 30`, NOT `Math.round(2145 * 0.015) === 32`. Mingla doesn't take a cut from tax. |

### Strict-grep gate scripts to add

- `.github/scripts/strict-grep/orch-0955-native-tax-coverage.mjs` — enforces I-PROPOSED-NATIVE-TAX-COVERAGE
- `.github/scripts/strict-grep/orch-0955-tax-commit-on-success.mjs` — enforces I-PROPOSED-TAX-COMMIT-ON-SUCCESS
- `.github/scripts/strict-grep/orch-0955-tax-reversal-on-refund.mjs` — enforces I-PROPOSED-TAX-REVERSAL-ON-REFUND
- `.github/scripts/strict-grep/orch-0955-embedded-tax-ui.mjs` — enforces I-PROPOSED-EMBEDDED-TAX-UI
- `.github/scripts/strict-grep/orch-0955-region-gate-deleted.mjs` — enforces I-PROPOSED-REGION-GATE-DELETED

Each script wires into `.github/workflows/strict-grep-mingla-business.yml` as a new job per the registry pattern.

DELETE any ORCH-0953 region-gate gates: implementor greps `.github/scripts/strict-grep/` for `orch-0953-native-paid-region` (or whatever ORCH-0953 named them) and deletes; remove the job entries from the workflow YAML.

---

## 7. Implementation order

1. **Migration (DB)** — write `20260727000000_orch_0955_native_stripe_tax.sql` with: orders + refunds + ticket_checkout_sessions column adds + comment refreshes + amended `biz_ticket_checkout_create_session` (CREATE OR REPLACE with `lineItems` added to return) + amended `biz_refund_order_commit` (add `p_stripe_tax_transaction_id`). Run the read-only probe in §3.1 before instructing operator to `db push`.
2. **`_shared/stripe.ts`** — DELETE `stripeTaxDashboardLink` export.
3. **`_shared/stripeTax.ts`** — DELETE entire file.
4. **`ticket-checkout-create/index.ts`** — DELETE region-gate block + import; ADD tax calc block + buyer.address validation + mode='preview' short-circuit + PI body changes + response shape changes.
5. **`_shared/stripeWebhookRouter.ts`** — ADD tax commit logic in `handleTicketCheckoutPaymentIntent`; ADD backstop in refund event handlers.
6. **`refund-order/index.ts`** — ADD inline-sync tax reversal block.
7. **`brand-stripe-tax-account-session/index.ts`** — CREATE entire file.
8. **`brand-stripe-tax-dashboard-link/index.ts`** — DELETE entire file (and directory).
9. **DELETE 4 gate test files** (per §3.6).
10. **`_shared/email/types.ts` + `_shared/email/ticketBody.ts`** — extend `TicketBodyInput['order']` type; render tax row.
11. **`ticket-confirmation-dispatch/index.ts`** — extend builder to populate new `TicketBodyInput.order.taxAmountCents` + `taxBreakdown`.
12. **`nativeCheckoutFlow.ts` (consumer)** — interface extension; pass address + taxCalculationId through; delete gate-error handling.
13. **`nativeCheckoutFlow.native.ts` (business)** — mirror.
14. **`CartTaxPreview.tsx` (consumer)** — new component.
15. **`CartTaxPreview.tsx` (business)** — mirror.
16. **`BrandPaymentsView.tsx`** — CTA rewrite.
17. **`app/connect-tax-registrations/index.tsx`** (mingla-business) — new page.
18. **`mingla-business/package.json`** — add `@stripe/connect-js` + `@stripe/react-connect-js` if absent.
19. **CI:** add 5 strict-grep gate scripts; delete ORCH-0953 region-gate gate(s); update workflow YAML.
20. **Tests:** add T-IH-01..T-IH-12 (implementor happy-path) with fails-on-revert verification.

DEPLOY (orchestrator owns post-IMPLEMENT-REVIEW):
- Operator: `cd <worktree> && /Users/sethogieva/bin/supabase migration list --linked` to confirm no remote-only versions; then `/Users/sethogieva/bin/supabase db push --linked`.
- Orchestrator: deploy 4 edge functions via local CLI — `ticket-checkout-create`, `stripe-webhook` (via `_shared/stripeWebhookRouter.ts` change), `refund-order`, `brand-stripe-tax-account-session`. Verify versions bump via `mcp__supabase__list_edge_functions`. Confirm `verify_jwt` preserved (webhook stays `false`).
- Operator: RAK permission updates per §9.

---

## 8. Regression prevention

- **Structural safeguards:** 5 strict-grep gates listed in §6 enforce the new invariants in CI on every PR.
- **Schema-level safeguards:** new columns are nullable + defaulted; no breaking schema change. RPC `CREATE OR REPLACE FUNCTION` is forward-compatible (existing callers get extra fields they can ignore).
- **Operational safeguards:** `application_fee_amount` calculation pinned to pre-tax subtotal in a code comment + adversarial test T-TA-16 (Mingla never takes a cut from tax the jurisdiction is owed — would be a compliance gap).
- **Backstop coverage:** inline-sync refund reversal failure surfaces via 502; webhook handlers retry on `refund.updated`. Both paths are idempotent.

---

## 9. Operator IMPLEMENT-phase prerequisites (FLAG FOR ORCHESTRATOR TO RELAY)

These steps must be completed by the operator (Seth) in Stripe Dashboard BEFORE the edge functions deploy:

1. **`STRIPE_RAK_TICKET_CHECKOUT`:** add `Tax > Tax Calculations: Write` + `Tax > Tax Transactions: Write` permissions. Live RAK is referenced at `supabase/functions/_shared/stripe.ts:77`.
2. **`STRIPE_RAK_TICKET_REFUND`:** add `Tax > Tax Transactions: Write`. Live RAK referenced at `supabase/functions/_shared/stripe.ts:81`.
3. **`STRIPE_RAK_ONBOARD`:** confirm it has `account_sessions:write` (likely added by ORCH-0954 IMPLEMENT; if ORCH-0954 hasn't shipped first, add it).
4. **Verify Stripe Tax for Platforms is enabled** on the platform account (already enabled per ORCH-0953 §Connect Platform Setup; verify).

If Stripe rotates the key value on edit, operator updates the Supabase secret via `supabase secrets set STRIPE_RAK_TICKET_CHECKOUT=...` etc.

**CLOSE Step 3 operator action:** after DEPLOY, `supabase secrets unset NATIVE_PAID_ALLOWED_REGIONS --project-ref gqnoajqerqhnvulmnyvv` (per Q14 lock).

---

## 10. Discoveries for orchestrator

1. **ORCH-0804 column comments are stale** — `tax_amount_cents` + `tax_calculation_id` comments still cite `automatic_tax.liability.type=account` (destination-charge era). This SPEC fixes them, but it surfaces that the ORCH-0843 close (direct-charge cutover) didn't sweep ORCH-0804's comments. Pattern flag: when a downstream ORCH supersedes an architectural assumption, the prior ORCH's `COMMENT ON COLUMN` strings often go stale silently.
2. **`ticket-checkout-create/index.ts` is now 933 lines** (post-ORCH-0953). After this SPEC, will grow further (~200 lines for the tax block). Recommend a future refactoring ORCH to extract the native PI creation logic into `_shared/ticketCheckoutNative.ts` (parallel to the existing `_shared/ticketCheckout.ts`). NOT in scope here.
3. **No `ticket_checkout_sessions` tax columns existed before this ORCH** — the schema gap was a pre-existing hole (ORCH-0804 added them to `orders` only). Web path persists tax via `handleCheckoutSessionCompleted` reading directly from Stripe; native path needs the session-level cache for the webhook commit to find it. SPEC §3.1 addresses.
4. **`brand-stripe-tax-account-session` will be the second `account_sessions`-using edge function** alongside ORCH-0954's onboarding equivalent. Recommend factoring `_shared/stripeAccountSession.ts` helper at ORCH-0954 IMPLEMENT time so both ORCHs share it. Flag for ORCH-0954 SPEC author when they get to that phase.
5. **Webhook router file size** — adding tax commit + backstop will push `_shared/stripeWebhookRouter.ts` from 1068 to ~1200 lines. Three event families now coexist (ticket checkout / disputes ORCH-0953 / tax ORCH-0955). Future split candidate but not blocking.
6. **CLOSE Step 5 Deprecation Extension applies** — deleting `brand-stripe-tax-dashboard-link` is a function-family removal. SPEC pre-flags the 8-substep extension; orchestrator runs at CLOSE.
7. **Memory file pre-write (Extension Step 5a):** `feedback_brand_stripe_tax_dashboard_link_decommissioned.md` should be drafted at SPEC-time with `status: DRAFT — flips to ACTIVE on ORCH-0955 CLOSE`. Orchestrator handles.

---

## 11. Confidence + readiness

**Confidence:** HIGH on all 15 SCs (each has a measurable / runnable verification). MEDIUM on the F-11 page-mount details — depends on whether ORCH-0954 SPEC lands a different `@stripe/connect-js` wrapper convention before IMPLEMENT; SPEC explicitly says "mirror ORCH-0954's pattern" so IMPLEMENT reconciles.

**Ready for IMPLEMENT dispatch.** No open SPEC-author questions remain. The 12+13+14 questions from the investigation are all answered (13 locked by orchestrator, Q8 by operator, Q1+Q11+Q13 resolved by SPEC-author code reads, Q3+Q12+Q14 N/A or locked).

**Estimated implementation effort:** 2-3 days (per INTAKE estimate; SPEC complexity validates this is on the upper end of that range due to 5 edge fns + 2 new components + new page + email template + 5 strict-grep gates).

---

## 12. Amendment A — ORCH-0863 C7 backend-files allowlist (added 2026-05-25 post-COMMS-0002)

**Trigger:** COMMS-0002 from `mingla-tester+codex (ORCH-0956)` (acked by `mingla-forensics+claude (ORCH-0955)`). ORCH-0956 hit GitHub-required check `ORCH-0863: Marketing Hub Phase B invariants` C7 `no-new-backend-files` because their PR added a new `supabase/functions/_shared/*.ts` file. The gate is globally applied to all PR diffs and requires per-ORCH allowlist entries to pass.

**ORCH-0955 trip-wire:** this SPEC adds ONE new file under `supabase/functions/`: `supabase/functions/brand-stripe-tax-account-session/index.ts`. The gate WILL fail on the ORCH-0955 PR unless an allowlist entry is added in the SAME commit.

**Required IMPLEMENT amendment to step 19 of §7:**

When updating CI gates, ALSO modify `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` to add (anywhere alongside the existing ORCH-XXXX allowlist arrays around lines 248-415):

```js
// ORCH-0955 [Native Stripe Tax for Platforms] PR (2026-05-25). C7 is scoped to
// ORCH-0863 marketing; these backend touches are native Stripe Tax wiring and
// must be allowlisted so the gate accepts them. Per COMMS-0002 + orchestrator
// memory feedback_close_commit_precommit_checks.md.
const ORCH_0955_BACKEND_ALLOWLIST = [
  "supabase/functions/brand-stripe-tax-account-session/index.ts",
  "supabase/migrations/20260727000000_orch_0955_native_stripe_tax.sql",
];
```

Wire this allowlist into the C7 check the same way the other `ORCH_NNNN_BACKEND_ALLOWLIST` arrays are wired (read lines 248-415 of the gate file for the exact pattern — typically a `[...A, ...B, ...C].includes(file)` test inside the offender loop). Implementor MUST commit this allowlist update in the SAME commit that adds `brand-stripe-tax-account-session/index.ts` and the new migration, OR the PR check will fail and CLOSE will be blocked.

This is NOT a new invariant or strict-grep gate this SPEC introduces — it's an allowlist amendment to an EXISTING gate. The new ORCH-0955 strict-grep gates listed in §6 are separate scripts owned by ORCH-0955 (they don't need an allowlist; they're scoped to enforce ORCH-0955's own invariants).

**Tester amendment:** add T-IH-13 to §6 happy-path tests — "Run all required CI checks locally pre-PR; `ORCH-0863: Marketing Hub Phase B invariants` C7 check passes with the new allowlist entries (verified before push)." Adversarial T-TA-17 — "Remove the ORCH_0955_BACKEND_ALLOWLIST entries; re-run gate; expect C7 FAIL with offender list naming both new files. Restore; expect PASS." Both immutable per ORCH-0840 append-only.

**Affected by ORCH-0863 mass-decommission (future):** the C7 gate comment block already notes that future close will "drop both allowlists" and re-scope C7 to fire ONLY against PRs whose commit message references ORCH-0863. When that happens, the `ORCH_0955_BACKEND_ALLOWLIST` should be removed too (along with all the others). NOT this ORCH's job — flag for whoever owns the C7 scoping cleanup.
