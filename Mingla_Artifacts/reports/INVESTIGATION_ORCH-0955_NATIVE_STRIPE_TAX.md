# INVESTIGATION — ORCH-0955 [Native Stripe Tax for Platforms]

**Mode:** INVESTIGATE only (no solutions, no code changes).
**Date:** 2026-05-24.
**Working tree:** `~/Desktop/mingla-orchs/ORCH-0955-[native-stripe-tax]/` on branch `ORCH-0955-native-stripe-tax` (rebased onto current `main` at HEAD `44c643c0` post-ORCH-0953 close).

**⚠ READ AMENDMENT 1 AT THE BOTTOM BEFORE ACTING ON F-1, F-2, F-4, OR F-9.** ORCH-0953 [Stripe live-mode cutover] merged into main AFTER the original body of this investigation was drafted (PR #201, commit `44c643c0`, 2026-05-24). ORCH-0953 actually shipped `_shared/stripeTax.ts` + `NATIVE_PAID_ALLOWED_REGIONS` env wiring + a region-gate enforcement block at the top of the native-PI branch. The original body of this investigation was authored against an older base where those files did not exist — line numbers in F-1, F-2, F-4 have shifted, and F-9 ("region-gate concept abandoned; SPEC does not introduce stripeTax.ts") is materially wrong in its second clause. Amendment 1 supersedes the affected sections; original body retained intact for audit.
**Investigator:** Claude `mingla-forensics`.
**Routing notes:** parallel ORCHs in flight — ORCH-0954 [Embedded onboarding cutover] + ORCH-0956 [Stripe ops alerts → email]; mild file overlap with ORCH-0956 on `stripe-webhook/index.ts`.
**Scope decision (operator, 2026-05-24):** native paid is the universal launch default; the `NATIVE_PAID_ALLOWED_REGIONS` allowlist concept (ORCH-0953 §3.8) is **abandoned**. Stripe Tax for Platforms is wired on every native PaymentIntent; jurisdictions where the brand is not Tax-registered return `$0` tax and the buyer pays face value with no UI surprise.

---

## 1. Scope statement

This investigation establishes the ground truth needed for a SPEC that wires Stripe Tax for Platforms (calculate → commit → reverse) into the native `ticket-checkout-create` direct-charge PaymentIntent path on iOS + Android (consumer `app-mobile/` and brand `mingla-business/`), preserves the connected-account direct-charge model, persists what the refund flow needs to issue tax reversals, exposes a tax preview in the cart sheet, and rewrites the Tax registration UX that ORCH-0954's `dashboard:"none"` cutover will break (COMMS-0001 absorbed). It does NOT propose solutions; SPEC turns the documented gaps into contracts.

The investigation cross-checks five truth layers — Stripe documentation (live fetch + skill references), edge function source, mobile source, deployed edge function inventory, and live database schema — and surfaces all 11 findings with six-field evidence each.

---

## 2. Findings

### F-1 — Current native PI creation shape (proven)

**File + lines:** `supabase/functions/ticket-checkout-create/index.ts:756-835`.

**Exact code (abbreviated):**
```ts
// ORCH-0804 / I-PROPOSED-BF — native PaymentIntent path is NOT tax-enabled in v1.
// ...Stripe Tax on PaymentIntent requires pre-computing a tax_calculation id via
// separate POST /v1/tax/calculations call. Material complexity. Deferred to ORCH-0804-A.
const piCreateBody: Record<string, unknown> = {
  amount: totalCents,
  currency,
  ...(isInstallmentPlan ? { setup_future_usage: "off_session" as const } : {}),
  ...(isInstallmentPlan && customerId !== null ? { customer: customerId } : {}),
  payment_method_types: [...getPaymentMethodTypes()],
  metadata: {
    mingla_checkout_session_id: checkoutSessionId,
    mingla_event_id: eventId,
    mingla_buyer_email: buyerEmail,
    ...(isInstallmentPlan ? { mingla_installment_plan_root: "true" } : {}),
  },
};
if (applicationFeeAmountCents > 0) {
  piCreateBody.application_fee_amount = applicationFeeAmountCents;  // line 824
}
paymentIntent = await stripe.paymentIntents.create(
  piCreateBody,
  {
    idempotencyKey: `ticket_checkout:${checkoutSessionId}`,
    stripeAccount: stripeAccountId,  // ORCH-0843 direct-charge: line 833
  },
);
```

**What it does today:** creates a PaymentIntent on the connected account (Stripe-Account header), `amount` is the cart subtotal in cents only (no tax), `application_fee_amount` carries Mingla's 1.5% platform cut (line 372-375: `MINGLA_APPLICATION_FEE_RATE = 0.015`), `metadata` carries 3-4 mingla discriminators only, idempotency-keyed off `checkoutSessionId`. Direct-charge model — connected account is merchant of record.

**What it should do:** before `paymentIntents.create`, call `tax.calculations.create` against the same connected account (Stripe-Account header) with cart line items + buyer billing address + `tax_code: 'txcd_50010001'` per line item; use the returned `amount_total` as the PaymentIntent `amount`; carry the calculation `id` on the PI so the webhook commit handler (F-4) can call `tax.transactions.createFromCalculation` after `payment_intent.succeeded`.

**Causal chain → user symptom:** native paid checkout in any tax-collecting US state charges the buyer the face value with no tax line; brand is the merchant of record (direct-charge model) and therefore owes the tax to the jurisdiction; brand carries a silent tax-compliance liability on every native ticket sale.

**Verification step:** `grep -n "automatic_tax\|tax_calculation\|tax_code\|customer_details\|hooks\[inputs\]\[tax\]" supabase/functions/ticket-checkout-create/index.ts` → zero matches in the native branch (lines 640-899). The web Checkout Session branch (lines 419-637) sets `automatic_tax: { enabled: true }` at line 550 — proving Stripe Tax for Platforms direct-charge **already works** in our setup on web; only the native PI path is missing it.

**Connect boundary:** confirmed. Line 833 sets `stripeAccount: stripeAccountId` on the third-arg request option. Per Stripe Tax for Platforms direct-charge docs (live fetch 2026-05-24), the same header must be added to `tax.calculations.create`, `tax.transactions.createFromCalculation`, and `tax.transactions.createReversal` for the connected account to be merchant of record.

**Classification:** 🔴 root cause of native paid tax gap.

---

### F-2 — Exact tax injection point + data needed (proven)

**File + lines:** insertion point is **immediately before** `paymentIntents.create` at `ticket-checkout-create/index.ts:827`, after `applicationFeeAmountCents` is computed (line 373) and after `customerId` is provisioned (lines 655-715) so a calculation-time `customer_details` can use it.

**Data available at that point (read from edge function state):**
- `currency` — line 305, sourced from `session.currency` returned by `biz_ticket_checkout_create_session` RPC.
- `totalCents` — line 304, the cart subtotal pre-tax.
- `stripeAccountId` — line 352, the connected account; required as the Stripe-Account header.
- `session.eventName` — used in the web branch (line 462); usable as the `line_items[].reference` for tax calc.
- `customerId` (paired with `customerEphemeralKeySecret`) when present — line 690.

**Data NOT available at that point (gap):**
- Per-line breakdown of unit amounts. The RPC returns a single `totalCents`; the calc API wants `line_items[]` per ticket tier with `amount`, `reference`, `tax_code`, optional `performance_location`. We have `lines: [{ ticketTypeId, quantity }]` from the request body (line 95) but need the per-tier unit price. Either (a) extend `biz_ticket_checkout_create_session` to return a `lineItems` array with per-tier amounts, or (b) re-query `ticket_types` after the RPC for unit prices.
- **Buyer billing address** — NOT in the request body today (see F-3); blocking gap for calc.
- **Performance location** (Stripe Tax `taxloc_*` reference) per Stripe Tax for Tickets recipe — these are connected-account-scoped Stripe Tax objects that have to be provisioned at brand-onboarding time for each venue. Not present today; SPEC must decide whether to provision lazily on first ticket sale, eagerly via embedded `<ConnectTaxRegistrations>` (F-11), or omit (Stripe Tax accepts calc without `performance_location` and falls back to buyer-address-only jurisdiction).

**Causal chain:** without buyer address + per-line amounts at calc time, `tax.calculations.create` returns `400 invalid_request_error: line_items required` or `customer_details required`. Implementor cannot wire tax without first solving F-3 (address) AND a per-line amount source decision.

**Verification step:** `grep -n "p_lines\|line_items\|tier_unit_amount\|ticketTypeUnitAmount" supabase/functions/ticket-checkout-create/index.ts supabase/migrations/*biz_ticket_checkout*` to confirm RPC response shape; check whether session result already carries per-tier unit amounts.

**Classification:** 🔴 root cause — data shape gap must be closed before tax calc can fire.

---

### F-3 — Buyer billing address not collected today (proven)

**Request body shape at `ticket-checkout-create` entry** (`index.ts:90-95`):
```ts
const buyer = (body.buyer ?? {}) as Record<string, unknown>;
const buyerName  = typeof buyer.name  === "string" ? buyer.name.trim() : "";
const buyerEmail = typeof buyer.email === "string" ? buyer.email.trim().toLowerCase() : "";
const buyerPhoneE164 = normalizePhoneE164(buyer.phone);
const marketingOptIn = buyer.marketingOptIn === true;
const lines = Array.isArray(body.lines) ? body.lines.filter(isCheckoutLine) : [];
```

No `buyer.address`, `buyer.country`, `buyer.postal`, or anything address-shaped is parsed or validated.

**Upstream callers (mobile):**
- `app-mobile/src/payments/nativeCheckoutFlow.ts:99-115` — `supabase.functions.invoke("ticket-checkout-create", { body: { eventId, surface:"native", buyer: { name, email, phone, marketingOptIn }, lines, idempotencyKey } })`. No address fields constructed or sent.
- `mingla-business/src/payments/nativeCheckoutFlow.native.ts:159-178` — identical shape (intentional parity per ORCH-0849 `I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY`).

**Stripe RN SDK capability:** `@stripe/stripe-react-native` `^0.65.1` (pinned in `app-mobile/package.json` and `mingla-business/package.json`). The SDK supports `billingDetailsCollectionConfiguration` on `initPaymentSheet` from v0.27.x onward; v0.65.1 is far past that floor. Per Stripe RN docs (live 2026-05-24), the configuration field name is `billingDetailsCollectionConfiguration` and the value is an object like `{ address: 'full' | 'automatic' | 'never', name: 'always' | 'never' | 'automatic', email: 'always' | 'never' | 'automatic', phone: 'always' | 'never' | 'automatic' }`. PaymentSheet then collects the chosen fields in its UI and returns them at confirm time. **No version bump required.**

**Current `initPaymentSheet` config** (`app-mobile/src/payments/nativeCheckoutFlow.ts:172-215`, mirror in `mingla-business/...nativeCheckoutFlow.native.ts:230-262`): sets `merchantDisplayName`, `paymentIntentClientSecret`, `returnURL`, `customerId`+`customerEphemeralKeySecret` (paired-or-absent), `applePay: { merchantCountryCode: "US" }`, `googlePay: { merchantCountryCode: "US", testEnv: __DEV__, currencyCode: "usd" }`. **Zero billing-details configuration today** — verified with grep returning empty for `billingDetails` across both `app-mobile/src` and `mingla-business/src`.

**Two possible architectures (SPEC chooses):**

(a) **Address-before-PI (preferred):** client collects buyer address in a step BEFORE invoking `ticket-checkout-create` (a cart-sheet form), passes it in the request body, edge function uses it for tax calc, PI is created with the tax-inclusive total. Pros: tax preview can show before PaymentSheet opens; PI amount is final and correct. Cons: extra UI step.

(b) **Address-via-PaymentSheet:** rely on `billingDetailsCollectionConfiguration: { address: 'full' }` to collect address inside PaymentSheet, then re-create or update the PI after confirm. Cons: changing PI amount post-creation is gnarly (PaymentSheet has already shown the buyer "Pay $X" — can't bump it up); preview UX (F-6) impossible without pre-collection.

The Stripe Tax for Tickets recipe (`docs.stripe.com/tax/tax-for-tickets/integration-guide`) recommends (a) — calculation precedes PI; PI amount is tax-inclusive.

**Causal chain → user symptom:** without (a), no tax preview is possible (F-6); without either, buyer's address is unknown to Stripe Tax calc.

**Classification:** 🔴 root cause + UX architectural decision the SPEC must lock.

---

### F-4 — Webhook commit insertion point (proven)

**File + lines:** `supabase/functions/_shared/stripeWebhookRouter.ts:711-869` (function `handleTicketCheckoutPaymentIntent`). Subscribed event types list at lines 30-63 includes `payment_intent.succeeded` (line 53). Switch dispatch at lines 971-1027 routes the event into `handleTicketCheckoutPaymentIntent`.

**Insertion point inside the function:** lines 815-816, **between** the `ticket-confirmation-dispatch` fetch (lines 802-814) and the AppsFlyer S2S milestone block (lines 817-855). Or even better: **after** the finalize RPC returns (line 798) and **before** the confirmation dispatch fetch — fewer side effects on partial failure. The exact placement is a SPEC call.

**Required action at that point:**
- Read `paymentIntent.metadata.mingla_tax_calculation_id` (set by F-1's tax-calc step).
- If present, call `stripe.tax.transactions.createFromCalculation({ calculation: <id>, reference: paymentIntentId, expand: ['line_items'] }, { stripeAccount: <connected account>, idempotencyKey: paymentIntentId })`.
- Persist the returned `transaction.id` to `orders.stripe_tax_transaction_id` (new column — F-8).

**Idempotency contract:** the `payment_intent.succeeded` event CAN be re-delivered by Stripe (any webhook can per Stripe webhook docs). Standard mitigation is the `Idempotency-Key` header — Stripe Tax API supports it (live doc fetch 2026-05-24 §7). Pattern: `idempotencyKey: paymentIntentId` ensures a re-delivery returns the existing transaction, not a duplicate. Our codebase already uses this pattern elsewhere (`ticket_checkout:${checkoutSessionId}` at `ticket-checkout-create:830`).

**Connect boundary:** must pass `stripeAccount: <connected account id>` (the brand's `stripe_connect_id` — derivable from `session.brand_id` → `brands.stripe_connect_id`, same chain as `refund-order/index.ts:225-265`). Without it, the call hits the platform account and returns `404 No such tax_calculation` (calculations are connected-account-scoped per F-1).

**Causal chain:** without this commit, Stripe holds a "calculated but uncommitted" tax record. Stripe Tax reports show the brand collected no tax for that order — even though the buyer was charged tax. Compliance gap.

**Verification step:** the file location, the existing switch case at line 1010 (`case "payment_intent.succeeded"`), and the handler at line 711 are confirmed; SPEC author can pick the precise line to insert at.

**Conflict with ORCH-0956:** ORCH-0956 [Stripe ops alerts → email] also targets `stripe-webhook/index.ts` and likely the same router file. The webhook router file is large (1051 lines) and adding tax handling in `handleTicketCheckoutPaymentIntent` (line 711-869) is isolated from where ops-alert events (payout failures, account.updated negative deltas) would land. **Merge-order strategy:** whichever ORCH lands first should not touch any line outside its scope; the second rebases cleanly. Add COMMS entry if the SPEC discovers actual line overlap.

**Classification:** 🔴 root cause — without this hook, every native paid tax calc dangles uncommitted.

---

### F-5 — Refund reversal insertion point (proven)

**Refund entrypoint:** `supabase/functions/refund-order/index.ts:115-435` (operator-initiated organiser refund per ORCH-0787, direct-charge shape per ORCH-0843).

**Stripe call site:** lines 270-298. Calls `stripe.refunds.create({ payment_intent: paymentIntentId, amount: amountCents, reason: "requested_by_customer", refund_application_fee: applicationFeeAmountCents > 0, metadata: { ... } }, { idempotencyKey: \`ticket_refund:${refundId}\`, stripeAccount: connectedAccountId })`.

**Required action after refund succeeds (lines 299-303):**
- Look up `orders.stripe_tax_transaction_id` (new column F-8) for this order.
- If present, call `stripe.tax.transactions.createReversal({ original_transaction: <tax_tx_id>, reference: \`mingla_refund:${refundId}\`, mode: <'full' | 'partial'>, expand: ['line_items'] }, { stripeAccount: connectedAccountId, idempotencyKey: \`tax_reversal:${refundId}\` })`. For partial refunds the API requires `mode: 'partial'` plus a per-line `shipping_cost.amount` or `line_items[].amount` describing the reversed portion.
- Persist the returned reversal `transaction.id` to a new `refunds.stripe_tax_transaction_id` column (F-8 extension) for audit.

**Critical Stripe doc nuance** (live fetch 2026-05-24 §6): the docs do NOT include an explicit `createReversal` example. The Stripe Tax for Tickets guide *recommends* the **Tax Payment Intent integration** (`hooks[inputs][tax][calculation]`) which **auto-handles refund reversals**. That mode requires the Stripe API version `2026-04-22.preview`. **We are pinned to `2026-04-22.dahlia` stable** (verified at `supabase/functions/_shared/stripe.ts:29` — `STRIPE_API_VERSION = "2026-04-22.dahlia" as const`). Switching to `.preview` is non-trivial: the same comment block (lines 22-29) explains that 2026-04-30.preview was tried and rejected by Stripe; the current `.dahlia` pin is the stable shape we use across Accounts V1 controller-mode (the Connect onboarding path). Switching to `.preview` risks regressing that Connect path.

**Decision the SPEC must make:** (i) bump API version to `.preview` and use Tax-PI auto-integration (refund reversals automatic, simplest code, but Connect-onboarding regression risk + Stripe preview-channel volatility), OR (ii) stay on `.dahlia` stable and implement manual `createFromCalculation` (F-4) + manual `createReversal` (F-5) (more code, no API version risk).

**Existing refund event webhook coverage:** `_shared/stripeWebhookRouter.ts:41-48` subscribes to `charge.refund.updated`, `charge.refunded`, `refund.created`, `refund.updated` — all four are routed (lines 1000-1009). If the SPEC chooses path (ii), the tax reversal call ideally fires INLINE inside `refund-order/index.ts` (synchronous, the operator sees the result) rather than on webhook (asynchronous, harder to surface failures). Webhook reversal is a defense-in-depth backstop only.

**Connect boundary:** `connectedAccountId` is already resolved at lines 225-265 in the refund handler. Same connected-account scoping required for the tax reversal call.

**Causal chain:** without reversal, Stripe Tax reports show the brand "collected" tax that was actually refunded to the buyer — over-stating the brand's tax liability to the jurisdiction.

**Classification:** 🔴 root cause — without reversal, refund tax is double-counted in Stripe Tax reporting.

---

### F-6 — Tax preview endpoint shape (probable)

**Stripe API supports calculation without PaymentIntent creation.** A `tax.calculations.create` call returns `amount_total` + `tax_breakdown` without any PI being created or charged. The calculation can be discarded or used later. Per the docs, calculations expire after 48 hours.

**Cleanest paths (SPEC chooses):**

(a) **Extend `ticket-checkout-create` with a `mode: 'preview'` flag** in the request body. When set, the function performs steps 1-3 of the current flow (validate event, RPC for cart total, address tax calc) and returns `{ subtotalCents, taxCents, totalCents, taxBreakdown }` without creating a PaymentIntent. Pros: zero new functions, reuses all existing validation and brand-account resolution. Cons: stretches one function's responsibility (already 901 lines).

(b) **New `ticket-tax-preview` edge function.** Takes `{ eventId, lines, buyerAddress }`, performs lookup-then-calc, returns the same shape. Pros: single-responsibility, easier to RLS-lock at the function level. Cons: code duplication of cart validation logic.

**Abuse / rate-limit surface:** either path is a buyer-facing endpoint that calls Stripe per request. Stripe Tax API quota is generous, but a malicious caller could rack up calc requests to enumerate brand jurisdictions or DDoS. Mitigation: keep the function authenticated where possible (`mingla-business` buyer-anon path is unauth — accept this; rate-limit at Supabase edge function gateway if available, or add a session-bound nonce that the cart sheet mints once).

**Causal chain:** without a preview endpoint, buyer doesn't see tax until the PaymentSheet renders the tax-inclusive total. This is allowed but feels like sticker shock. INTAKE §5 (cart sheet tax line) requires preview.

**Verification step:** existing pattern is option (a) — `surface` discriminator at `ticket-checkout-create/index.ts:84-89` already branches on a string flag. A `mode: 'preview'` field follows the same pattern with low risk.

**Classification:** 🟠 contributing factor — UX promise of cart-sheet tax line cannot be met without one of these.

---

### F-7 — RAK permission gap (proven, flag-only)

**Active RAK:** `STRIPE_RAK_TICKET_CHECKOUT`. Sole reference in production code: `supabase/functions/_shared/stripe.ts:77`:
```ts
export const stripeTicketCheckout = () =>
  createStripeClient("STRIPE_RAK_TICKET_CHECKOUT");
```
The factory is invoked by `ticket-checkout-create/index.ts:469` (web branch), `:659` (customer provisioning), `:769` (native PI creation).

**Permissions needed for the new flow** (per Stripe RAK scope catalog, doc fetch 2026-05-24):
- `Tax > Tax Calculations` = **Write** (for `tax.calculations.create`).
- `Tax > Tax Transactions` = **Write** (for `tax.transactions.createFromCalculation` AND `tax.transactions.createReversal`).
- Existing scopes preserved: `PaymentIntents Write`, `Customers Write`, `EphemeralKeys Write`, `Customers Read` (search), `Checkout Sessions Write` (web branch).

**For refund flow:** `STRIPE_RAK_TICKET_REFUND` (`stripe.ts:81`) is a SEPARATE RAK used by `refund-order/index.ts:271`. It will ALSO need `Tax > Tax Transactions = Write` because that's where `createReversal` fires from per F-5.

**Operator action required at IMPLEMENT time:**
1. Open Stripe Dashboard → Developers → API keys → find live `STRIPE_RAK_TICKET_CHECKOUT` → Edit → add `Tax > Tax Calculations: Write` + `Tax > Tax Transactions: Write` → Save.
2. Repeat for `STRIPE_RAK_TICKET_REFUND` (just `Tax > Tax Transactions: Write`).
3. If Stripe issues a new key value on edit (some scope-add flows rotate the key), update Supabase secrets via `supabase secrets set STRIPE_RAK_TICKET_CHECKOUT=...` and `STRIPE_RAK_TICKET_REFUND=...`.
4. Confirm read-only RAK paths (search/list) still work post-edit; the scope additions are pure-additive but Stripe occasionally rotates as a side effect.

**This is the only Stripe Dashboard mutation the operator must perform** for ORCH-0955 (modulo F-11 which is brand-side, not platform-side). Flag in SPEC as IMPLEMENT-phase prerequisite.

**Classification:** 🔵 observation + IMPLEMENT-phase prerequisite.

---

### F-8 — Persistence schema gap (proven; new columns required)

**Live `orders` schema** (queried 2026-05-24 via `mcp__supabase__execute_sql`):

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `stripe_payment_intent_id` | text | YES | — | exists |
| `stripe_charge_id` | text | YES | — | exists |
| `stripe_payment_intent_status` | text | YES | — | exists |
| `stripe_application_fee_amount_cents` | integer | NO | 0 | exists (ORCH-0843) |
| `stripe_transfer_destination` | text | YES | — | legacy destination-charge era |
| `stripe_payment_method_type` | text | YES | — | exists |
| `refunded_amount_cents` | integer | NO | 0 | exists |
| `tax_amount_cents` | integer | NO | 0 | exists (ORCH-0804 migration `20260530000000`) |
| `tax_calculation_id` | text | YES | — | exists (ORCH-0804) |
| `stripe_customer_id_on_connected_account` | text | YES | — | exists (ORCH-0925) |

**Gap:** **`orders.stripe_tax_transaction_id` does NOT exist**. The refund reversal in F-5 needs this column to look up the original tax transaction. Without it, refund handler cannot issue `createReversal` (no `original_transaction` argument).

**Likely SPEC schema additions:**
- `orders.stripe_tax_transaction_id text` (nullable; populated by webhook commit in F-4).
- `refunds.stripe_tax_transaction_id text` (nullable; populated by `refund-order` after successful `createReversal`).
- Optional: `orders.tax_breakdown jsonb` (the `tax_breakdown` array from calc response; useful for receipt rendering). The ORCH-0804 migration didn't add this — the web flow only persists `tax_amount_cents` + `tax_calculation_id`. Decision for SPEC.

**Migration filename:** must be `>= 20260601000000` to come after the ORCH-0804 migration (`20260530000000`) and any unmerged migrations on other branches. Check `~/Desktop/mingla-orchs/*/supabase/migrations/` at SPEC time for the actual upper bound — orchestrator memory rule (2026-05-24) flags collision risk.

**RLS impact:** `orders` already has RLS policies; adding nullable columns doesn't require policy updates. `refunds` likewise.

**Comment fix opportunity:** the ORCH-0804 migration comment on `orders.tax_amount_cents` (file `20260530000000_orch_0804_orders_tax_columns.sql:36-37`) still says "Connect destination charge with automatic_tax.liability.type=account" — this is **stale** since ORCH-0843 cut over to direct charges. SPEC should include a `COMMENT ON COLUMN` refresh as a hygiene line item.

**Classification:** 🔴 root cause — refund tax reversal CANNOT be implemented without this column.

---

### F-9 — Region-gate concept abandoned (decided by operator, 2026-05-24)

**Original premise (INTAKE):** ORCH-0953 was to ship `NATIVE_PAID_ALLOWED_REGIONS` env var + a `_shared/stripeTax.ts` helper that gated native paid checkout on country allowlist. ORCH-0955 was to wire actual tax and then flip the allowlist to `"US,GB,BE,CH"`.

**Current state:** ORCH-0953 has NOT merged (confirmed via `git log origin/main`, only `META-ORCH-0953` batch INTAKE present; no commits matching `bc5935fc ORCH-0953 stripe live cutover implementation` on main). No `_shared/stripeTax.ts` file exists in this branch (confirmed via `ls supabase/functions/_shared/stripe*`). No `NATIVE_PAID_ALLOWED_REGIONS` references anywhere in `supabase/functions/` (confirmed via `grep -rn "NATIVE_PAID_ALLOWED_REGIONS"`).

**Operator decision (chat, 2026-05-24):** "native paid is what we launch with. Native paid should be available in all stripe countries so no need for the allowed regions." Decision codified here. Implications:

- **No allowlist env var.** Native paid is unconditional.
- **No region-gate helper file.** `_shared/stripeTax.ts` is NOT introduced by this ORCH.
- **Tax calc runs on every native PI**, regardless of buyer country.
- **Unregistered-jurisdiction behaviour:** Stripe Tax returns `tax = 0` for jurisdictions the connected account is not registered in. Buyer pays face value with no tax line; no UI surprise; no compliance gap because Stripe Tax confirms zero owed in that jurisdiction.

**Cross-ORCH consequence:** ORCH-0955 proceeds **independent of ORCH-0953**. ORCH-0953's §3.8 region gate becomes dead-on-arrival scope if ORCH-0953 is still planning to ship it; whoever owns ORCH-0953 should remove §3.8 from its SPEC. (Out of scope for this investigation; flag for orchestrator.)

**Classification:** 🔵 observation + 🟠 cross-ORCH scope-change signal.

---

### F-10 — Cross-surface blast (proven)

Every UI surface that displays cart/order monetary detail must accommodate the tax line. Enumerated per the 5 primary + 2 adjacent shipping surfaces per orchestrator INTAKE rule:

| Surface | Touch? | What needs updating | Source-of-truth file (current) |
|---|---|---|---|
| Consumer iOS (`app-mobile/` on iOS) | YES | Cart sheet → tax preview line + total; confirmation → tax line on receipt; calendar/saved screen → optional tax-in-total chip | `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` (one of the cart entries), receipt screen TBC by SPEC |
| Consumer Android (`app-mobile/` on Android) | YES | Parity with iOS via shared RN code | same files |
| Buyer/anon Web (`mingla-business/checkout/[eventId]`, `/e/{brandSlug}/{eventSlug}`) | **NO** — already tax-enabled via `automatic_tax: { enabled: true }` on Checkout Session (line 550 of `ticket-checkout-create`). Stripe hosts the tax UI. Confirm/receipt screens already render `orders.tax_amount_cents` per ORCH-0804. **Out of scope.** | n/a |
| Business iOS (`mingla-business/` on iOS) | YES | Buyer-side native flow in business app uses `mingla-business/src/payments/nativeCheckoutFlow.native.ts` — parity required with consumer flow. Cart preview UI in business needs tax line too. | `mingla-business/src/payments/nativeCheckoutFlow.native.ts`, business cart sheet TBC |
| Business Android (`mingla-business/` on Android) | YES | Parity | same |
| Admin Web (`mingla-admin/`) | **NO** — admin has no payment surface; per ORCH-0954 F-13, admin has zero Stripe-status surface today. Out of scope. | n/a |
| Business Web preview (`mingla-business/` web dev) | NO (uses web Checkout Session path, already taxed) | n/a |

**Additional non-UI surfaces:**
- **Buyer email receipts** (`ticket-confirmation-dispatch` flow + `send-message-email` template) — current template likely doesn't show a tax line. SPEC must confirm and amend.
- **Business order detail view** (planner-side, `mingla-business/app/orders/[id]/...` or similar) — needs tax line for brand reconciliation.
- **Refund UI** (`mingla-business` refund issuance screen) — when partial refund, brand sees the refund amount; SPEC must decide whether the tax portion of the refund is shown separately.

**Classification:** 🟠 contributing factor — cross-surface UI scope wider than SPEC author may initially assume.

---

### F-11 — `brand-stripe-tax-dashboard-link` rewrite required (proven, COMMS-0001 absorbed)

**File:** `supabase/functions/brand-stripe-tax-dashboard-link/index.ts` (131 lines, deployed v60).

**Current behaviour** (lines 92-113):
```ts
const stripe = stripeTaxDashboardLink();  // uses STRIPE_SECRET_KEY per stripe.ts:72-73
loginLink = await stripe.accounts.createLoginLink(
  account.stripe_account_id,
  undefined,
  { idempotencyKey: generateIdempotencyKey(brandId, "tax_dashboard_link") },
);
return jsonResponse({ url: loginLink.url }, 200);
```
The buyer's mobile app receives this URL and opens it (in-app browser) so the brand admin lands on Stripe Express Dashboard's Tax Registrations page.

**Why it breaks:** `accounts.createLoginLink` requires `controller.stripe_dashboard.type='express'`. ORCH-0954's [Embedded onboarding cutover] flips the platform controller to `dashboard:"none"` (Stripe-managed risk + embedded onboarding). Per Stripe API contract (ORCH-0954 F-6 evidence), the `createLoginLink` call will return `400 invalid_request_error` for every new live brand from day one.

**File-level comment already concedes this** (`brand-stripe-tax-dashboard-link/index.ts:6-13`):
> "Stripe Tax registration is a brand-side compliance step. Stripe ships an embedded `<TaxSettings />` component on web, but the React Native preview SDK doesn't include it yet."

**Replacement architecture (per ORCH-0954 F-11 evidence, doc fetch 2026-05-24):** `tax_registrations` AND `tax_settings` are GA components in the `POST /v1/account_sessions` `components` array. They have empty feature sets. Architecture mirrors the established Path B in `feedback_mingla_business_desktop_web_contracts.md` (Mingla-hosted web page + `@stripe/connect-js`):

1. **New edge function** `brand-stripe-tax-account-session` (or extend an existing helper):
   - Calls `POST /v1/account_sessions` with `account: stripe_account_id`, `components: { tax_registrations: { enabled: true }, tax_settings: { enabled: true } }`.
   - Returns `{ client_secret, expires_at }`.
   - Requires same RAK scopes as current ORCH-0954 onboarding session (operator handles).
2. **New Mingla-hosted page** `mingla-business/app/connect-tax-registrations/index.tsx` (or `/connect-tax-settings`):
   - Mounts `@stripe/connect-js` with the publishable key.
   - Initialises `<ConnectAccountProvider>` with the client_secret.
   - Renders `<ConnectTaxRegistrations>` and/or `<ConnectTaxSettings>`.
3. **Replace the existing endpoint** `brand-stripe-tax-dashboard-link`:
   - Either delete + replace with the new edge function (clean cutover, requires UI callsite update in `mingla-business/src/components/brand/BrandPaymentsView.tsx`), OR
   - Repurpose it to return a Mingla-hosted URL `/connect-tax-registrations?session_id={sessionId}` instead of the Stripe login link (smaller blast radius, keeps the function name stable).
4. **Mobile app callsite** (`BrandPaymentsView` "Manage Stripe account" / "Tax Registrations" CTA): opens the Mingla-hosted URL in `expo-web-browser.openAuthSessionAsync`, identical pattern to ORCH-0802 / ORCH-0954 embedded onboarding flow.

**Sequencing constraint:** must ship in lockstep with (or before) ORCH-0954's `dashboard:"none"` cutover, otherwise the live brand has no tax-settings UX at all. Per COMMS-0001 operator decision: brands will have no tax-settings UI between ORCH-0954 close and ORCH-0955 close; acceptable because zero live brands exist at INTAKE.

**Permission requirements (operator):** the new `brand-stripe-tax-account-session` edge function will need `account_sessions:write` scope (same as ORCH-0954's `STRIPE_RAK_ONBOARD` per ORCH-0954 F-14). Either share that RAK or provision a new `STRIPE_RAK_TAX_ACCOUNT_SESSION` with `account_sessions:write` only.

**Cross-ORCH:** the embedded-components plumbing (`@stripe/connect-js` package, the Mingla-hosted page scaffold, the `account_sessions` factory) is being introduced by ORCH-0954 for `<ConnectAccountOnboarding>`. ORCH-0955 should **reuse that plumbing** rather than duplicate it. SPEC should reference ORCH-0954's chosen page paths and `@stripe/connect-js` initialisation pattern (whichever shape ORCH-0954 lands on). If ORCH-0955 SPEC is written before ORCH-0954 SPEC, leave the page-path detail flexible and pin in IMPLEMENT.

**Classification:** 🔴 root cause — without rewrite, every live brand loses tax-registration UX the moment ORCH-0954 ships.

---

## 3. Open questions for SPEC author

1. **Per-line amount source** (F-2): does `biz_ticket_checkout_create_session` RPC currently return per-tier unit amounts, or must SPEC extend the RPC, or must SPEC re-query `ticket_types` after the RPC? RPC signature must be read end-to-end before deciding.
2. **Address-before-PI vs address-via-PaymentSheet** (F-3): which architecture does the SPEC adopt? Stripe-recommended is address-before-PI; decision drives whether `billingDetailsCollectionConfiguration` is set on PaymentSheet or whether a cart-sheet form collects address first.
3. **Performance location strategy** (F-2): do we provision `taxloc_*` objects per brand at onboarding (eager), on first ticket sale (lazy), or omit and let Stripe Tax fall back to buyer-address-only jurisdiction? The third option works but loses some venue-specific tax precision (e.g., stadium-specific surcharges in some jurisdictions).
4. **API version path** (F-5): bump to `2026-04-22.preview` (Tax-PI auto-integration; refund auto-handled; Connect-onboarding regression risk) OR stay on `2026-04-22.dahlia` stable (manual `createFromCalculation` + manual `createReversal`; more code but no regression risk)?
5. **Tax preview shape** (F-6): `mode: 'preview'` flag on `ticket-checkout-create` OR new `ticket-tax-preview` edge function?
6. **Refund reversal timing** (F-5): inline-sync in `refund-order/index.ts` (operator sees the result; failures surface immediately) OR async via webhook `charge.refunded` handler (cleaner but operator gets no live signal)?
7. **F-11 endpoint shape:** replace `brand-stripe-tax-dashboard-link` outright (UI callsite update needed) OR repurpose it to return the Mingla-hosted URL (smaller blast)?
8. **F-11 embedded components scope:** `<ConnectTaxRegistrations>` alone, OR pair with `<ConnectTaxSettings>` (the latter exposes broader tax config UI to the brand admin)?
9. **F-11 RAK strategy:** reuse ORCH-0954's `STRIPE_RAK_ONBOARD` (already has `account_sessions:write` per ORCH-0954 F-14) OR provision a tax-scoped RAK?
10. **Tax breakdown persistence** (F-8): persist full `tax_breakdown jsonb` on `orders` for receipt rendering, or rely on Stripe API lookup at render time?
11. **Buyer-email receipt format:** does the existing `ticket-confirmation-dispatch` template render `orders.tax_amount_cents`? If not, SPEC must include template amendment. (Out-of-scope discovery — check at SPEC time.)
12. **Performance location ↔ ORCH-0954 timing:** if `performance_location` is provisioned at brand onboarding, that lives inside the ORCH-0954 onboarding flow. Need to confirm with ORCH-0954 whether its SPEC reserves room for it.

---

## 4. Cross-ORCH conflicts observed

**ORCH-0953 [Stripe live cutover hardening]:** NOT merged to main. Its §3.8 (region-gate `NATIVE_PAID_ALLOWED_REGIONS` env + `_shared/stripeTax.ts` helper) is **superseded** by operator decision (F-9). Whoever owns ORCH-0953 should drop §3.8 from scope. Other ORCH-0953 deliverables (dispute hardening per `222daa04 ORCH-0953 harden dispute migration regression`, etc.) appear unrelated and should land independently. **Action:** orchestrator may want to write a COMMS-0002 entry notifying ORCH-0953 of the §3.8 abandonment. (Not written by this investigation; flag for orchestrator decision.)

**ORCH-0954 [Embedded onboarding cutover]:** F-11 of THIS investigation is the absorbed scope from COMMS-0001 acked 2026-05-24. ORCH-0955 reuses ORCH-0954's plumbing (`@stripe/connect-js`, account_sessions factory, Mingla-hosted page pattern). ORCH-0955 SPEC should reference ORCH-0954 SPEC's page-path and helper-factory choices, OR explicitly note "page path TBD pending ORCH-0954 SPEC" and pin in IMPLEMENT. **No file overlap** on the core tax work (different edge functions, different mobile files). Mild overlap on the new `account_sessions` helper if both ORCHs need to add it to `_shared/stripeBlueprintClient.ts` — first to land wins; second reuses.

**ORCH-0956 [Stripe ops alerts → email]:** declared file overlap on `stripe-webhook/index.ts` per orchestrator dispatch. Per F-4, the actual insertion point for tax commit is inside `_shared/stripeWebhookRouter.ts:711-869` (`handleTicketCheckoutPaymentIntent`), not in `stripe-webhook/index.ts` itself. ORCH-0956 likely targets `_shared/stripeWebhookRouter.ts` too (for payout-failure / account-update ops alerts) but in different handlers. **No direct line overlap expected.** Merge order: first PR lands clean; second rebases on the router file's growth. Flag for orchestrator if SPEC discovers actual overlap.

---

## 5. Recommended SPEC scope summary

The SPEC must define: (1) the cart-sheet → preview-endpoint → calculation-with-address → PI-with-tax-inclusive-amount → webhook-commit → refund-reversal flow end to end; (2) the schema additions (`orders.stripe_tax_transaction_id`, `refunds.stripe_tax_transaction_id`, optional `orders.tax_breakdown jsonb`, migration `>= 20260601000000`); (3) the upstream client changes (request-body extension for address, possibly per-line amounts; preview-endpoint call from cart UI); (4) the cross-surface UI scope across consumer + business iOS and Android (cart sheet, confirmation, receipt, business order detail, refund detail); (5) the API-version decision (preview vs dahlia) with the implementor's regression-test plan; (6) the F-11 dashboard-link rewrite — new `brand-stripe-tax-account-session` edge function + new Mingla-hosted `/connect-tax-registrations` page reusing ORCH-0954 plumbing + UI callsite update; (7) the implementor-phase operator prerequisites (RAK scope additions on `STRIPE_RAK_TICKET_CHECKOUT` + `STRIPE_RAK_TICKET_REFUND` + possibly new tax-scoped RAK; Stripe Dashboard tax-registration confirmation per brand); (8) success criteria + invariants + adversarial test cases covering tax = $0 jurisdictions, tax > $0 jurisdictions, full refund reversal, partial refund reversal, webhook re-delivery idempotency, address-missing block path, brand-unregistered fall-through, dashboard-link rewrite live for both pre- and post-ORCH-0954 brand kinds; (9) explicit declaration that the region-gate concept is abandoned and the SPEC does not introduce `NATIVE_PAID_ALLOWED_REGIONS` or `_shared/stripeTax.ts`. The SPEC author must answer the 12 open questions in §3 before finalising.

---

## Appendix A — Five-layer cross-check

| Layer | Status | Notes |
|---|---|---|
| Docs | Verified | Stripe Tax for Tickets integration guide fetched live 2026-05-24; `stripe-best-practices` skill connect.md + security.md read; INTAKE + ORCH-0954 F-6+F-11+F-14 read |
| Schema | Verified | `orders` table queried live via `mcp__supabase__execute_sql`; tax columns from ORCH-0804 confirmed; gap on `stripe_tax_transaction_id` proven |
| Code | Verified | `ticket-checkout-create/index.ts` (900 lines, full read); `_shared/stripe.ts` (full); `_shared/stripeWebhookRouter.ts` (key handlers + event subscription list); `refund-order/index.ts` (full); `brand-stripe-tax-dashboard-link/index.ts` (full); both `nativeCheckoutFlow` files (full); `package.json` versions confirmed |
| Runtime | Partially verified | Deployed edge function versions enumerated via `mcp__supabase__list_edge_functions` — `ticket-checkout-create` v103, `stripe-webhook` v128 (verify_jwt:false ✓), `refund-order` v70, `brand-stripe-tax-dashboard-link` v60 (all ACTIVE). No live tax-collecting brand exists to run an end-to-end smoke; live-fire is blocked on ORCH-0954 (no live brand) per INTAKE blocking conditions |
| Data | Verified | Live `orders` schema confirms which fields exist; no existing native-paid tax-collected order rows checked (would all be zero per F-1) |

## Appendix B — Confidence

- **F-1, F-3, F-4, F-7, F-8, F-9, F-11:** PROVEN (six-field evidence, source + live verification).
- **F-2, F-5:** PROVEN structurally; the *decisions* embedded in them are SPEC-author calls.
- **F-6:** PROBABLE — preview endpoint shape is doc-confirmed; choice between (a)/(b) is style.
- **F-10:** PROVEN per the file-level grep; specific UI files touched per surface are SPEC-time refinements.

Overall investigation confidence: **HIGH**. Ready for SPEC dispatch pending operator answers to the 12 open questions in §3 plus the 2 new questions in Amendment 1 §A1.4.

---

# Amendment 1 — Post-ORCH-0953 merge (2026-05-24)

**Trigger:** ORCH-0953 [Stripe live-mode cutover] merged to main at commit `44c643c0` (PR #201) AFTER the original body above was authored. Worktree rebased onto the new main; this amendment captures the deltas.

**What ORCH-0953 actually shipped** (verified via `git show 44c643c0 --name-only`): (1) `supabase/functions/_shared/stripeTax.ts` (NEW, 22 lines, exports `getNativePaidAllowedRegions()` + `isNativePaidAllowedForBrand(country)`); (2) region-gate enforcement block in `ticket-checkout-create/index.ts:360-389` that runs BEFORE native PI creation; (3) `stripe_disputes` table + router handlers + persistence (orthogonal to ORCH-0955); (4) `pk_live_` production fail-close (orthogonal); (5) RAK fail-close (orthogonal); (6) Android intent filters (orthogonal); (7) reconciliation probe SQL (orthogonal); (8) signature-failure alert hook (orthogonal); (9) webhook event-list correction (touched `_shared/stripeWebhookRouter.ts` for dispute coverage, not for tax). `refund-order/index.ts`, `brand-stripe-tax-dashboard-link/index.ts`, `_shared/stripe.ts` untouched.

**Current production state:** `NATIVE_PAID_ALLOWED_REGIONS` env is empty (per the merged PR body §"Supabase secrets intentionally on TEST mode pending ORCH-0954 + ORCH-0955 close"). `isNativePaidAllowedForBrand()` returns `false` for every brand. Every native checkout currently hits `400 native_paid_not_allowed_in_region, retryWithSurface: "web"` and is forced to the web Checkout path (which already has tax via ORCH-0804). Native paid is **disabled in production today**.

## A1.1 — F-1 line-number correction (PROVEN)

PI creation site shifted from **lines 756-835 → lines 788-862**. Logic shape unchanged: same `piCreateBody` shape, same `application_fee_amount` at line 856, same `paymentIntents.create(piCreateBody, { idempotencyKey, stripeAccount })` at lines 859-862. The "tax NOT enabled" comment block now lives at lines 788-794. **All other F-1 substance holds.**

## A1.2 — F-2 insertion-point correction (PROVEN)

Insertion point for `tax.calculations.create` shifted from "immediately before line 827" to **"immediately before line 859"** (the new `paymentIntents.create` call). All preconditions still hold: `customerId` (now provisioned earlier in the file), `stripeAccountId` (now line 352 — same logic, slightly different line number), `connectedAccountCountry` (NEW — populated at line 380 by the region-gate block; usable by tax calc for `customer_details.address.country` fallback when buyer address omits country), `applicationFeeAmountCents` (now line 405).

**New data point available:** `connectedAccountCountry` is now in scope at the PI creation site (line 380). SPEC can use it as the default country for `customer_details.address.country` when buyer-supplied address is partial. This is a small simplification opportunity, not a correctness change.

## A1.3 — F-4 line-number correction (PROVEN)

`handleTicketCheckoutPaymentIntent` shifted from **line 711 → line 723**. The `payment_intent.succeeded` switch case shifted from line 1010 → **line 1022**. The `biz_ticket_checkout_finalize` RPC call inside the handler shifted from line 785 → **line 798**. Insertion-point logic unchanged.

**New context:** the router file grew by 17 lines (from 1051 to 1068) due to ORCH-0953's `charge.dispute.*` handlers landing in the same switch statement. **Positive precedent for ORCH-0955:** the router architecture absorbed a brand-new event family cleanly; tax-transaction handling will fit the same pattern. **Conflict with ORCH-0956 [Stripe ops alerts → email]:** still no direct line overlap expected — disputes (ORCH-0953) + tax (ORCH-0955) + ops-alerts (ORCH-0956) all add to different handler regions of the same router file. Merge order: first lands clean, others rebase.

## A1.4 — F-9 SUPERSEDED — region-gate is live code, not abandoned concept (CRITICAL)

The original F-9 said "the region-gate concept is abandoned; SPEC does NOT introduce `_shared/stripeTax.ts` or `NATIVE_PAID_ALLOWED_REGIONS`." **That second clause is now wrong** — both shipped via ORCH-0953. The operator's underlying intent (native paid universal across Stripe-supported countries; no allowlist) still holds, but the SPEC must now actively decide what to DO with the live gate rather than choose whether to introduce it.

**Three coherent paths the SPEC can take:**

(a) **Delete the gate entirely.** Once Stripe Tax is wired (every native PI runs calc → commit → reverse), the gate's original purpose (preventing brand from silently carrying tax liability) is satisfied by the tax wiring itself. Remove `_shared/stripeTax.ts`, remove the env var, remove the `360-389` enforcement block, remove the `nativeCheckoutFlow` region-gate toast tests, remove `ticket-checkout-create/__tests__/nativeRegionGate_adversarial.test.ts` (this would need `[TEST-MOD-APPROVED ORCH-0955]` in the CLOSE commit per the orchestrator's CLOSE pre-commit rule). Cleanest end state.

(b) **Repurpose the gate as a kill-switch.** Keep `_shared/stripeTax.ts` but rename/reframe: `isNativePaidEnabled(): boolean` reads `NATIVE_PAID_KILL_SWITCH` (default false = enabled). Gives operator a fast disable lever for incidents post-launch without a redeploy. Strictly more operational power than (a) at the cost of one extra primitive to maintain.

(c) **Leave gate as-is and just flip the env.** Set `NATIVE_PAID_ALLOWED_REGIONS` to a literal list of every country Stripe supports for direct charges (~46 countries today per Stripe's [list of supported countries](https://docs.stripe.com/connect/cross-border-payouts)) and ship. Pros: zero code change to the gate. Cons: every time Stripe adds/removes a supported country (rare but happens), operator must update the env; functionally equivalent to (a) once the list is exhaustive, with extra ops burden and no upside.

**My recommendation:** **(a) — delete the gate entirely.** Reasoning: the gate's purpose was to protect against the very gap ORCH-0955 closes. Once tax is wired, the gate is vestigial. The kill-switch idea (b) is reasonable but premature — there's no evidence we need that lever, and adding it speculatively violates the orchestrator's "no speculative scope" memory rule. Option (c) is operationally worse than (a) for no benefit.

**Cross-ORCH consequence:** none. ORCH-0953 has merged; its `nativeRegionGate_adversarial.test.ts` is now part of the regression suite. Path (a) removes those tests with `[TEST-MOD-APPROVED ORCH-0955]` in the CLOSE commit body per the orchestrator's pre-commit rule (codified 2026-05-23 by ORCH-0840). Path (b)/(c) preserves them.

**New SPEC question for the open-questions list:** "Which gate-disposition path: (a) delete, (b) kill-switch, or (c) env-flip-only?" — appears as question 13.

## A1.5 — F-3 (native PaymentSheet billing details) unchanged in substance

The `nativeCheckoutFlow.ts` + `nativeCheckoutFlow.native.ts` changes ORCH-0953 made are limited to handling the new region-gate error response (toast surface). The `initPaymentSheet` config still has no `billingDetailsCollectionConfiguration`. The Stripe RN SDK is still `^0.65.1`. The request body parser in `ticket-checkout-create:90-95` still has no `buyer.address`. F-3 substance unchanged. SPEC author should still pick between address-before-PI (recommended) and address-via-PaymentSheet.

## A1.6 — F-5, F-6, F-7, F-8, F-10, F-11 unchanged

ORCH-0953 did not touch the refund flow, the `orders` schema, the dashboard-link function, `_shared/stripe.ts` (so RAK references are unchanged), `brand-stripe-tax-dashboard-link/index.ts`, or any of the cross-surface UI files in F-10's matrix. All six findings stand verbatim.

## A1.7 — Updated open question list

Add to §3 of the original body:

**13.** Gate disposition (per A1.4): delete, kill-switch, or env-flip-only? My recommendation: delete.

**14.** Once tax is wired and the gate is disposed of, can `NATIVE_PAID_ALLOWED_REGIONS` Supabase secret be deleted as part of CLOSE (Step 3 deploy notes)? Or does any unmerged ORCH still depend on it? (Quick grep at SPEC time across all in-flight worktrees.)

## A1.8 — Confidence

Amendment 1 confidence: **HIGH**. All line-number shifts verified via `wc -l` + targeted `grep -n` post-rebase. F-9 rewrite reflects the operator's already-stated decision (chat 2026-05-24 "no need for the allowed regions") applied to the now-discovered live code rather than the hypothesised pre-merge state.
