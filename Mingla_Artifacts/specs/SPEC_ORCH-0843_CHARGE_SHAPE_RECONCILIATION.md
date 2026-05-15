# SPEC — ORCH-0843 Charge-Shape Reconciliation (Path B — platform-liable, direct charges)

**Mode:** mingla-forensics (SPEC)
**Status:** PRODUCED — ready for Codex `implementor-mingla` (or Claude `mingla-implementor` parity)
**Confidence:** High
**Author:** Claude `mingla-forensics`, 2026-05-15
**Predecessor investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0843_CHARGE_SHAPE_RECONCILIATION.md`
**Parent decisions:** DEC-154 (locked Stripe Connect activation) — **amended by this ORCH** (see §11), DEC-155 (ORCH-0839-B CLOSE — explicit non-change to charge architecture)
**Operator decision (2026-05-15):** Path B selected. Rationale: 9 test connected accounts, 0 real charges, accept platform-liable chargeback risk to ship the live-sales unblocker faster. Re-onboarding test stubs purely to claim Stripe-managed-risk shielding is busy work; defer that to a future ORCH if real-account count grows.

---

## TL;DR

Flip `supabase/functions/ticket-checkout-create/index.ts` and `supabase/functions/refund-order/index.ts` from **destination charges** (`transfer_data.destination = stripeAccountId`, no `Stripe-Account` header) to **direct charges** (`{ stripeAccount: stripeAccountId }` request-option passed as the third arg to `stripe.checkout.sessions.create` / `stripe.paymentIntents.create` / `stripe.refunds.create`, plus `application_fee_amount` for Mingla's platform cut, plus `statement_descriptor_prefix: "MINGLA"` for buyer-card-statement identification).

Do **NOT** touch `supabase/functions/_shared/stripeBlueprintClient.ts` (Connect account create shape) under this SPEC. The 9 existing platform-liable accounts stay platform-liable; Mingla accepts chargeback liability as a conscious tradeoff. DEC-154 (5) is amended to platform-managed risk (see §11).

Zero DB migrations. Three edge function files. One new CI gate file. One DEC-154 amendment entry. Atomic deploy. ~80 LOC delta total.

---

## Phase 1 — Investigation Ingest

The investigation report (`INVESTIGATION_ORCH-0843_CHARGE_SHAPE_RECONCILIATION.md`) is fully ingested. Key findings carried into this SPEC:

- **RC-1** — `transfer_data.destination` at `ticket-checkout-create/index.ts:268` (hosted Checkout Session) and `:394` (native PaymentIntent path). Both call sites must flip.
- **RC-2** — Connect accounts provisioned with `losses_collector: "application"` in `stripeBlueprintClient.ts:134-136`. **Under Path B this is INTENTIONALLY UNCHANGED** — Path B keeps platform-liable.
- **CF-1** — `application_fee_amount` is hardwired to `0` at `ticket-checkout-create/index.ts:120`. The DB RPC `biz_ticket_checkout_create_session` already accepts `p_application_fee_amount_cents` and persists it to `ticket_checkout_sessions.application_fee_amount_cents`. Edge fn must read this value back and pass it through to Stripe.
- **CF-2** — `automatic_tax.liability.type: "account"` (line 279) is preserved unchanged; Tax for Platforms supports direct charges identically.
- **HF-1** — `refund-order/index.ts:211` uses `reverse_transfer: true` (destination-charge syntax). Flip required.
- **HF-3** — Webhook handler routes `event.account` correctly; need to verify webhook endpoint is registered as a **Connect** webhook in Stripe Dashboard (operator-verifiable, no code change expected) and confirm signature verification + event subscription set per DEC-154 (9).

Operator pricing decision (gate at §10): the formula for `application_fee_amount` per ticket. Default proposed in §3.1.4: pass through whatever value `biz_ticket_checkout_create_session` returns as `application_fee_amount_cents` (today: `0`; future: whatever a future pricing ORCH wires in). SPEC does NOT prescribe a non-zero fee here — that is a product decision out of scope. SPEC DOES wire the plumbing so the moment the RPC returns a non-zero value, Stripe collects it.

---

## Phase 2 — Scope and Non-Goals

### In scope

1. Flip `supabase/functions/ticket-checkout-create/index.ts` (×2 charge-creating call sites) to direct-charge shape.
2. Flip `supabase/functions/refund-order/index.ts` to direct-charge refund shape.
3. Audit `supabase/functions/cancel-order/index.ts` for any connected-account-scoped Stripe call; flip if present.
4. Wire `application_fee_amount` plumbing (read from RPC, pass to Stripe).
5. Add `statement_descriptor_prefix: "MINGLA"` to direct-charge calls per DEC-154 (1).
6. Update misleading "destination-charge platform model" comment at `ticket-checkout-create/index.ts:251` to reflect direct-charge reality.
7. Verify webhook handler routes direct-charge events correctly (read-only audit + minimal hardening if gaps found).
8. New CI strict-grep gate `orch-0843-stripe-direct-charges-only.mjs` (5 sub-checks: T-G1..T-G5) wired into `.github/workflows/strict-grep-mingla-business.yml`.
9. Implementor regression test asserting outbound Stripe API call body matches direct-charge contract (per I-REGRESSION-TEST-MANDATORY).
10. DEC-154 amendment entry in `Mingla_Artifacts/DECISION_LOG.md` recording the path-B decision and platform-liable acceptance.
11. Pre-flight one-shot probe function mirroring the ORCH-0839-B custom-scheme probe pattern (deploy → verify direct charge body accepted by Stripe → delete probe at CLOSE).
12. INVARIANT_REGISTRY additions: I-PROPOSED-STRIPE-CHARGE-SHAPE-IS-DIRECT, I-PROPOSED-STRIPE-APPLICATION-FEE-PRESENT, I-PROPOSED-STRIPE-ACCOUNT-HEADER-ON-CONNECTED-CALLS, I-PROPOSED-STRIPE-STATEMENT-DESCRIPTOR-PREFIX-MINGLA.

### Non-goals (explicitly OUT of scope; surfaced for orchestrator queue)

- **A.** Re-onboarding the 9 existing connected accounts. Path B intentionally keeps them platform-liable. If real-customer volume ever forces Stripe-managed-risk, a future ORCH must detach + re-onboard under new controller-properties.
- **B.** `stripeBlueprintClient.ts` changes (loss/fee collector values). Intentionally untouched; matches Path B acceptance.
- **C.** Embedded onboarding components (DEC-154 (2)) — becomes OPTIONAL under Path B; brand-continuity benefits still apply but no longer load-bearing for risk model. Queue as separate future ORCH at deferred priority.
- **D.** Embedded account-management components (DEC-154 (3)) — same as C; deferred.
- **E.** Restricted API keys (`rk_live_*`) per edge function per DEC-154 (9)(a). Separate sub-ORCH. Stack-adjacent but not blocking ORCH-0843.
- **F.** Wiring a non-zero Mingla platform fee formula. SPEC wires the plumbing end-to-end; the actual fee value is a separate product decision.
- **G.** Migration of historical `orders` rows that reference destination-charge PI IDs. They stay as historical records; refund flow audits `stripe_charge_id` / brand chain regardless of charge shape so old rows remain queryable.
- **H.** UI/UX changes in mingla-business or app-mobile. The change is entirely server-side; mobile clients send the same `surface: "web" | "mobile-web" | "native"` strings unchanged.

### Assumptions

- Webhook endpoint in Stripe Dashboard is already registered as a **Connect** webhook (events with `event.account` set arrive at the platform endpoint). Operator to verify; SPEC includes a verification step.
- `biz_ticket_checkout_create_session` RPC returns `application_fee_amount_cents` reliably (already wired per migration `20260605000002`; investigation confirmed).
- Stripe Tax for Platforms config (`automatic_tax.liability.type: "account"`) works identically under direct charges (Stripe docs confirm).
- No live charges are in flight (`stripe_charge_id` populated on 0 of 27 orders per investigation §10).

---

## Phase 3 — Per-Layer Specification

### 3.1 — Edge function: `supabase/functions/ticket-checkout-create/index.ts`

#### 3.1.1 — Hosted Checkout Session path (web + mobile-web surfaces)

**Current shape (lines 253–301, to be replaced):**

```ts
checkoutSession = await stripeWeb.checkout.sessions.create(
  {
    mode: "payment",
    currency,
    line_items: [/* unchanged */],
    payment_intent_data: {
      transfer_data: { destination: stripeAccountId },  // DELETE
      metadata: { /* unchanged */ },
    },
    automatic_tax: { /* unchanged */ },
    customer_email: buyerEmail,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { /* unchanged */ },
  },
  { idempotencyKey: `ticket_checkout_web:${checkoutSessionId}` },
);
```

**Target shape:**

```ts
// ORCH-0843 — direct-charge shape per DEC-154 (amended Path B).
// DO NOT re-introduce transfer_data.destination. See INVESTIGATION_ORCH-0843.
// Stripe-Account header is set via the second-arg request-options `stripeAccount`
// field; statement_descriptor_prefix prepends "MINGLA" on buyer's card statement;
// application_fee_amount routes Mingla's platform cut into the platform balance.
checkoutSession = await stripeWeb.checkout.sessions.create(
  {
    mode: "payment",
    currency,
    line_items: [/* unchanged */],
    payment_intent_data: {
      // transfer_data removed — charge object now lives on connected account.
      application_fee_amount: applicationFeeAmountCents,   // NEW — from RPC
      statement_descriptor_prefix: "MINGLA",               // NEW — DEC-154 (1)
      metadata: { /* unchanged */ },
    },
    automatic_tax: { /* unchanged — Tax for Platforms works under direct */ },
    customer_email: buyerEmail,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { /* unchanged */ },
  },
  {
    idempotencyKey: `ticket_checkout_web:${checkoutSessionId}`,
    stripeAccount: stripeAccountId,   // NEW — third-arg request-options
  },
);
```

**Source of `applicationFeeAmountCents`:** read from the existing session row. The RPC `biz_ticket_checkout_create_session` already persists `application_fee_amount_cents` on `ticket_checkout_sessions`. Either:
- (preferred) extend the existing `session` object the edge fn reads back from the RPC return to include `application_fee_amount_cents`, OR
- if the RPC return shape doesn't surface it, add a follow-up `SELECT application_fee_amount_cents FROM ticket_checkout_sessions WHERE id = $1` immediately after the RPC.

Implementor must inspect the RPC return shape (migration `20260605000002_orch_0829b_d1_checkout_expiry_tombstone.sql`) and pick whichever path requires the smaller diff. If a SELECT is added, it must respect RLS.

**Zero-fee handling:** if `applicationFeeAmountCents === 0`, **OMIT** `application_fee_amount` from the body entirely (do not pass `0`). Stripe accepts both omitting AND passing zero, but omitting is the cleaner contract and avoids any future "application_fee_amount must be > 0" edge-case errors. Use:

```ts
const piData: Record<string, unknown> = {
  statement_descriptor_prefix: "MINGLA",
  metadata: { /* unchanged */ },
};
if (applicationFeeAmountCents > 0) {
  piData.application_fee_amount = applicationFeeAmountCents;
}
// then payment_intent_data: piData
```

**Idempotency key:** unchanged (`ticket_checkout_web:${checkoutSessionId}`). Direct charges still need idempotency keys per I-PROPOSED-R; the value is unchanged.

**Comment update (line 251):** Replace the trailing parenthetical `(destination-charge platform model)` in the Tax for Platforms reference comment with `(direct-charge platform model — ORCH-0843)`.

#### 3.1.2 — Native PaymentIntent path (native surface)

**Current shape (lines 374–402, to be replaced):**

```ts
paymentIntent = await stripe.paymentIntents.create(
  {
    amount: totalCents,
    currency,
    payment_method_types: ["card"],
    transfer_data: { destination: stripeAccountId },  // DELETE
    metadata: { /* unchanged */ },
  },
  { idempotencyKey: `ticket_checkout:${checkoutSessionId}` },
);
```

**Target shape:**

```ts
// ORCH-0843 — direct-charge shape per DEC-154 (amended Path B).
// PaymentIntent is created on the connected account via Stripe-Account header.
const piCreateBody: Record<string, unknown> = {
  amount: totalCents,
  currency,
  payment_method_types: ["card"],
  statement_descriptor_suffix: undefined,  // optional — see note
  metadata: { /* unchanged */ },
};
if (applicationFeeAmountCents > 0) {
  piCreateBody.application_fee_amount = applicationFeeAmountCents;
}
paymentIntent = await stripe.paymentIntents.create(
  piCreateBody,
  {
    idempotencyKey: `ticket_checkout:${checkoutSessionId}`,
    stripeAccount: stripeAccountId,   // NEW — third-arg request-options
  },
);
```

**Note on PaymentIntent statement descriptor:** PaymentIntent uses `statement_descriptor_suffix` (not `prefix`) at the top level on direct charges; the platform-level prefix is set on the connected account's settings in Stripe Dashboard (operator-configurable). For ORCH-0843 SPEC, OMIT `statement_descriptor_suffix` from the PaymentIntent body (Stripe will use the connected account's default). The buyer's card statement will show the creator's business name; "MINGLA" prefixing is handled via the platform's account-level setting in Stripe Dashboard (operator action, not code). This matches DEC-154 (1) intent.

#### 3.1.3 — Tax for Platforms compatibility verification

`automatic_tax: { enabled: true, liability: { type: "account", account: stripeAccountId } }` (lines 279–285) is **PRESERVED VERBATIM** under direct charges. Stripe Tax for Platforms accepts both charge shapes; `liability.type: "account"` correctly identifies the connected account as merchant of record. No change needed beyond the comment update at line 251.

#### 3.1.4 — `application_fee_amount` plumbing (formula)

SPEC contract: `applicationFeeAmountCents` equals `ticket_checkout_sessions.application_fee_amount_cents` for this session (already persisted by RPC). Today: `0`. Future: whatever pricing-ORCH wires in.

**Operator gate (§10):** confirm this plumbing approach before implementor begins. Two alternatives:
- (a) [SPEC default] Pass through whatever RPC returns; if 0, omit. Future fee-setting is an RPC change, not an edge-fn change.
- (b) Hardcode a percentage formula in the edge fn (e.g., `Math.round(totalCents * 0.05)`). Faster but couples pricing to edge-fn code instead of DB-driven config.

Default is (a). If operator picks (b), SPEC requires a follow-up amendment naming the percentage.

### 3.2 — Edge function: `supabase/functions/refund-order/index.ts`

#### 3.2.1 — Refund call site (lines 201–220)

**Current shape:**

```ts
const stripe = stripeTicketRefund();
const created = await stripe.refunds.create(
  {
    payment_intent: paymentIntentId,
    amount: amountCents,
    reason: "requested_by_customer",
    reverse_transfer: true,                                  // DELETE
    refund_application_fee: applicationFeeAmountCents > 0,
    metadata: { /* unchanged */ },
  },
  { idempotencyKey: `ticket_refund:${refundId}` },
);
```

**Target shape:**

```ts
// ORCH-0843 — direct-charge refund shape per DEC-154 (amended Path B).
// Refund is created on the connected account via Stripe-Account header.
// reverse_transfer is destination-charge syntax and is no longer needed.
// refund_application_fee remains: it tells Stripe to also refund the
// platform's application_fee_amount cut taken at charge time.
const stripe = stripeTicketRefund();
const created = await stripe.refunds.create(
  {
    payment_intent: paymentIntentId,
    amount: amountCents,
    reason: "requested_by_customer",
    refund_application_fee: applicationFeeAmountCents > 0,
    metadata: { /* unchanged */ },
  },
  {
    idempotencyKey: `ticket_refund:${refundId}`,
    stripeAccount: connectedAccountId,   // NEW — third-arg request-options
  },
);
```

#### 3.2.2 — Sourcing `connectedAccountId`

The refund flow currently does NOT load the connected account ID. SPEC adds one lookup:

```ts
// Lookup connected account for this order's brand.
// Chain: order.event_id → events.brand_id → stripe_connect_accounts.stripe_account_id
const { data: connectRow, error: connectErr } = await supabase
  .from("orders")
  .select(`
    events!inner(
      brand_id,
      brands!inner(
        stripe_connect_accounts!inner(stripe_account_id)
      )
    )
  `)
  .eq("id", orderId)
  .single();
if (connectErr || !connectRow) {
  return jsonResponse({
    error: "missing_connected_account",
    detail: "Cannot derive Stripe connected account for this order's brand",
  }, 422);
}
const connectedAccountId = connectRow.events.brands.stripe_connect_accounts.stripe_account_id;
```

**Implementor latitude:** the exact JOIN shape may vary based on existing service helpers; the contract is "given an `orderId`, produce the `stripe_account_id` of the brand that owns the event". Use existing helpers if they exist. Verify RLS allows this read for the refund-order edge fn's service-role context.

#### 3.2.3 — Backward compat for historical destination-charge orders

The 12 existing test orders in `orders` reference destination-charge PI IDs. Under the new flow, calling `refunds.create({...payment_intent: oldDestinationPI...}, { stripeAccount: connectedAcctId })` against a PI that was created without a `Stripe-Account` header (i.e., a platform-owned destination PI) will **fail** because Stripe will look for the PI on the connected account and not find it.

**Mitigation:** since these are test-only orders with zero refund expectation, SPEC accepts this as a deliberate one-way cutover. Implementor must add a defensive check at the top of the Stripe refund branch:

```ts
// ORCH-0843 — historical destination-charge PIs are not retrievable on the
// connected account. Since 0 real charges existed at flip time, any
// destination-charge order in flight at deploy time is test data only.
// Return a clear error rather than a confusing Stripe 404.
```

In practice this is a soft assertion; the orchestrator confirmed 0 real charges so no real refund will hit this path. If a destination-charge refund IS attempted post-deploy, Stripe returns an error which surfaces through existing classifier → 502 with detail. Acceptable.

#### 3.2.4 — `refund_application_fee` semantics

Under direct charges, `refund_application_fee: true` still tells Stripe to also refund the platform's `application_fee_amount` cut taken at charge time. Today (`applicationFeeAmountCents === 0`) this is always `false`. Future (non-zero fee) it correctly refunds Mingla's cut. No code change to the boolean.

### 3.3 — Edge function: `supabase/functions/cancel-order/index.ts`

#### 3.3.1 — Audit

SPEC requires implementor to read `cancel-order/index.ts` fully and identify any Stripe API call that operates against a connected-account-owned PaymentIntent (e.g., `stripe.paymentIntents.cancel(...)` or `stripe.refunds.create(...)`). If any exists:
- Add `{ stripeAccount: connectedAccountId }` to the request-options.
- Look up `connectedAccountId` via the same chain as §3.2.2.

#### 3.3.2 — If no connected-account-scoped call exists

State so in the IMPLEMENTATION report. No code change. CI gate T-G2 (§5) will catch any future drift.

### 3.4 — Webhook handler: `supabase/functions/stripe-webhook/index.ts`

#### 3.4.1 — Read-only audit

The webhook handler at `stripe-webhook/index.ts` already:
- Verifies signatures via `verifyStripeWebhookSignature` (line 56) — direct charges arrive with `Stripe-Account` header on the event payload, signature verification mechanism is identical, no change needed.
- Routes events via `routeStripeEvent(supabase, stripe, event)` (line 136). The router's `accountIdForEvent(event)` reads `event.account` correctly per investigation §HF-3.
- Records events idempotently in `payment_webhook_events` (lines 88–132). Schema accepts any `event.type` + `payload` JSONB, so direct-charge events flow through unchanged.

**Implementor obligation:** verify (read-only) that `stripeWebhookRouter.ts` handles `event.account`-scoped events for the post-flip event types (`checkout.session.completed` with `event.account` set, `charge.refunded` arriving on connected account, `charge.dispute.created`, `payout.failed`). If gaps found, raise as a Discovery for orchestrator; do NOT widen ORCH-0843 scope to fix router routing — surface as a follow-up ORCH.

#### 3.4.2 — Event subscription verification (operator-side, Stripe Dashboard)

Per DEC-154 (9)(c), the webhook endpoint must subscribe to at minimum:
- `account.updated`
- `account.application.authorized`
- `checkout.session.completed`
- `charge.refunded`
- `charge.dispute.created`
- `payout.failed`

**Implementor obligation:** dump the current `STRIPE_ROUTED_EVENT_TYPES` set from `stripeWebhookRouter.ts` into the IMPLEMENTATION report. Operator cross-references against the Stripe Dashboard webhook config at deploy gate. If any of the required types are missing from `STRIPE_ROUTED_EVENT_TYPES`, raise as a Discovery (do NOT add silently).

#### 3.4.3 — Connect-webhook registration verification (operator-side)

Mingla's Stripe Dashboard webhook endpoint must be registered as a **Connect** webhook (not account-restricted) so events created on connected accounts arrive at the platform endpoint with `event.account` set. **Operator verifies via Stripe Dashboard → Developers → Webhooks → endpoint config.** SPEC documents this as a deploy-gate check.

### 3.5 — Shared client: `supabase/functions/_shared/stripe.ts`

#### 3.5.1 — No change

API version pin `STRIPE_API_VERSION = "2026-04-22.dahlia"` is preserved per I-PROPOSED-Q. Both `stripeTicketCheckout()` and `stripeTicketRefund()` factories continue to be used unchanged.

### 3.6 — Shared client: `supabase/functions/_shared/stripeBlueprintClient.ts`

#### 3.6.1 — INTENTIONALLY UNCHANGED under Path B

`losses_collector: "application"`, `fees_collector: "application"`, `dashboard: "express"` stay as-is. New connected accounts continue to be provisioned platform-liable, matching the existing 9. This matches the DEC-154 amendment (§11) which accepts platform-liable as the conscious tradeoff for Path B.

CI gate T-G4 (§5) explicitly tolerates `transfer_data` being absent here (this file does not create charges); but enforces that no charge-creating file under `supabase/functions/` uses `transfer_data.destination`.

### 3.7 — Database layer

#### 3.7.1 — No migration

The RPC `biz_ticket_checkout_create_session` (latest: migration `20260605000002`) already accepts and persists `p_application_fee_amount_cents`. The `ticket_checkout_sessions.application_fee_amount_cents` column already exists. The `orders` table has no relevant change (existing `stripe_payment_intent_id` column accepts any text; under direct charges, this stores the connected-account-scoped PI ID, which is still a Stripe-issued `pi_*` string).

**Implementor MUST NOT run `supabase db push` or `mcp__supabase__apply_migration`.** No migration is required.

#### 3.7.2 — RLS

No new RLS policies. Existing policies on `ticket_checkout_sessions`, `orders`, `events`, `brands`, `stripe_connect_accounts` are unchanged. The new JOIN in `refund-order/index.ts` (§3.2.2) reads through these tables via the edge function's service-role context, which bypasses RLS as today.

### 3.8 — UI / Mobile / Web — NO CHANGES

Backward compat preserved by:
- `surface: "web"` — buyer gets `https://...` checkout session URL (existing behavior).
- `surface: "mobile-web"` — buyer gets `mingla-business://checkout/return?...` (ORCH-0839-B behavior).
- `surface: "native"` — buyer gets PaymentIntent client_secret for native PaymentSheet (explorer app-mobile only).

All three response shapes are byte-identical pre- and post-flip. The change is entirely in the Stripe API call body the edge fn emits.

---

## Phase 4 — Success Criteria

| ID | Criterion | Observable / testable |
|---|---|---|
| **SC-01** | Hosted Checkout Session direct charge | `stripe.checkout.sessions.create` body has NO `transfer_data` key; second arg has `stripeAccount: <acct_*>`; `payment_intent_data.statement_descriptor_prefix === "MINGLA"`. Verified by reading deployed edge fn source + happy-path test against a test brand. |
| **SC-02** | Native PaymentIntent direct charge | `stripe.paymentIntents.create` body has NO `transfer_data` key; second arg has `stripeAccount: <acct_*>`. Verified same way. |
| **SC-03** | `application_fee_amount` plumbed through | When `ticket_checkout_sessions.application_fee_amount_cents > 0`, the Stripe call body includes `application_fee_amount` with the same value. When `=== 0`, the key is omitted. Verified by mocking RPC return + asserting outbound body. |
| **SC-04** | Refund flow direct-charge compatible | `stripe.refunds.create` second arg has `stripeAccount: <connected_acct>`; body has NO `reverse_transfer` key. Verified by reading deployed edge fn + happy-path test. |
| **SC-05** | Backward compat: `surface: "web"` | Buyer initiating a web checkout receives the same response shape (`{ kind: "requires_web_redirect", hostedCheckoutUrl, ... }`) as pre-flip. No mobile/web client code change required. |
| **SC-06** | Backward compat: `surface: "mobile-web"` | Same as SC-05 with `mingla-business://checkout/return` URLs. |
| **SC-07** | Backward compat: `surface: "native"` | Buyer receives `{ kind: "requires_payment_sheet", clientSecret, ... }` shape unchanged. Explorer app PaymentSheet renders + completes. |
| **SC-08** | Statement descriptor renders "MINGLA*" prefix | Buyer's Stripe receipt + card statement shows `MINGLA* <creator brand name>` for Checkout Session purchases. Verified live in pre-flight probe (§9). |
| **SC-09** | Tax for Platforms preserved | `automatic_tax` block unchanged in body; Stripe Tax still collects buyer billing address; tax line item appears on Checkout Session. Verified live in probe. |
| **SC-10** | Webhook events flow correctly | `checkout.session.completed`, `charge.refunded`, `charge.dispute.created` arriving with `event.account = <connected_acct>` are routed correctly by `stripeWebhookRouter.ts` (idempotent insert into `payment_webhook_events`, downstream order/refund handlers fire). Verified by inspecting deployed router code + dispatching a test event from Stripe Dashboard during pre-flight. |
| **SC-11** | CI gate `orch-0843-stripe-direct-charges-only.mjs` ACTIVE | All 5 sub-checks (T-G1..T-G5 per §5) pass on the flipped code. Adversarial test: revert one sub-check's contract → gate trips. |
| **SC-12** | DEC-154 amended | New amendment entry at top of `DECISION_LOG.md` records the Path B decision verbatim per §11 text. |

---

## Phase 5 — CI Strict-Grep Gate Specification

### 5.1 — New file: `.github/scripts/strict-grep/orch-0843-stripe-direct-charges-only.mjs`

**Pattern:** mirrors `.github/scripts/strict-grep/orch-0839-b-mingla-business-no-native-stripe.mjs` structure (Node.js, fs.readFileSync, regex-based, exit-1-on-fail).

**Sub-checks:**

| ID | Contract | Pattern |
|---|---|---|
| **T-G1** | `supabase/functions/ticket-checkout-create/index.ts` contains NO `transfer_data` keyword | Read file; `/\btransfer_data\s*:/.test(content) === false` |
| **T-G2** | `supabase/functions/ticket-checkout-create/index.ts` contains `stripeAccount` on every `stripe.checkout.sessions.create` AND `stripe.paymentIntents.create` call | For each match of `/\b(?:checkout\.sessions|paymentIntents)\.create\s*\(/g`, look ahead ±200 chars for `stripeAccount:` |
| **T-G3** | `supabase/functions/ticket-checkout-create/index.ts` contains `application_fee_amount` reference (presence — may be conditional) | `/application_fee_amount/.test(content) === true`. Plumbing must exist; conditional zero-omit is allowed |
| **T-G4** | No other file under `supabase/functions/` (excluding `_shared/stripeBlueprintClient.ts` which is documentation-only here) uses `transfer_data.destination` | Walk `supabase/functions/`; for each `.ts` file, assert no `/transfer_data\s*:\s*\{[^}]*destination/` match |
| **T-G5** | `supabase/functions/ticket-checkout-create/index.ts` contains `statement_descriptor_prefix: "MINGLA"` (Checkout Session path only — PI path uses dashboard-level setting per §3.1.2) | `/statement_descriptor_prefix\s*:\s*["']MINGLA["']/.test(content) === true` |

**Exit codes:** 0 if all 5 pass; 1 with named-failure list otherwise. Match the registry pattern in `feedback_strict_grep_registry_pattern.md`.

### 5.2 — Wire into `.github/workflows/strict-grep-mingla-business.yml`

Add one new job (parallel to existing 50+ jobs):

```yaml
  orch-0843-stripe-direct-charges-only:
    name: "ORCH-0843: Stripe direct-charge shape (no transfer_data.destination)"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: node .github/scripts/strict-grep/orch-0843-stripe-direct-charges-only.mjs
```

Add a corresponding registry comment line near line 83 (mirror the ORCH-0839-B comment format).

### 5.3 — Adversarial test (implementor or tester)

After implementor lands the flip, **revert one sub-check's contract** in a throwaway local commit (e.g., re-introduce `transfer_data: { destination: stripeAccountId }` on one of the call sites) and run the gate locally — must exit 1 with a clear named failure pointing at the file:line. Commit history of the adversarial test is NOT required; the verification step is documented in the IMPLEMENTATION report.

---

## Phase 6 — Invariants

### 6.1 — NEW invariants (PROPOSED → ACTIVE after CLOSE)

| Invariant ID | Definition | Enforcement |
|---|---|---|
| **I-PROPOSED-STRIPE-CHARGE-SHAPE-IS-DIRECT** | All charge-creating Stripe API calls against a connected account use direct-charge shape — no `transfer_data.destination` in any code path under `supabase/functions/`. | CI gate T-G1 + T-G4 |
| **I-PROPOSED-STRIPE-APPLICATION-FEE-PRESENT** | `application_fee_amount` plumbing wired end-to-end (RPC → edge fn → Stripe). Value MAY be zero (and key MAY be omitted), but the variable assignment + conditional pass-through MUST exist in source. | CI gate T-G3 |
| **I-PROPOSED-STRIPE-ACCOUNT-HEADER-ON-CONNECTED-CALLS** | Every `stripe.checkout.sessions.create`, `stripe.paymentIntents.create`, `stripe.refunds.create` call against a connected account passes `{ stripeAccount: <acct_*> }` as the second-arg request-options. | CI gate T-G2 |
| **I-PROPOSED-STRIPE-STATEMENT-DESCRIPTOR-PREFIX-MINGLA** | Hosted Checkout Session direct-charge calls set `payment_intent_data.statement_descriptor_prefix: "MINGLA"` so buyer's card statement shows `MINGLA* <creator name>`. (PaymentIntent path uses account-level default per §3.1.2.) | CI gate T-G5 |

### 6.2 — PRESERVED invariants (unchanged)

- I-PROPOSED-O (Stripe no DIY WebView wrap) — unchanged.
- I-PROPOSED-P (`stripe_connect_accounts` canonical) — unchanged.
- I-PROPOSED-Q (Stripe API version pinned via `_shared/stripe.ts` only) — unchanged.
- I-PROPOSED-R (Idempotency-Key on every Stripe call) — unchanged; direct charges still carry `idempotencyKey`.
- I-PROPOSED-S (Audit log on every Stripe edge fn) — unchanged; audit calls remain in the flipped code.
- I-PROPOSED-T (Stripe country allowlist) — unchanged.
- I-PROPOSED-U (Mingla ToS gate) — unchanged.
- I-PROPOSED-V (Stripe notify via shared) — unchanged.
- I-PROPOSED-Y (platform web URL from env) — unchanged.
- All ORCH-0789 + ORCH-0827 consumer-side Stripe invariants — orthogonal, unchanged.
- I-PROPOSED-MOBILE-WEB-SURFACE-RETURNS-CUSTOM-SCHEME (ORCH-0839-B) — unchanged.
- I-PROPOSED-MINGLA-BUSINESS-NO-NATIVE-STRIPE (ORCH-0839-B) — unchanged.

### 6.3 — REJECTED / DEFERRED invariants (DO NOT add under Path B)

- ~~I-PROPOSED-CONNECT-ACCOUNTS-STRIPE-MANAGED-RISK~~ — investigation §RC-2 proposed this; **rejected under Path B** because operator chose platform-liable. If a future ORCH re-enables Stripe-managed risk, this invariant can be re-proposed.
- ~~I-PROPOSED-PLATFORM-LIABLE-RISK-ACCEPTED-UNTIL-08XX~~ — discussed in investigation §"Fix Strategy Direction"; **superseded** by the DEC-154 amendment text at §11 which captures the acceptance directly in the decision log. No separate invariant needed; the DEC carries the obligation.

---

## Phase 7 — Test Cases

| Test ID | Scenario | Input | Expected | Layer | Owner |
|---|---|---|---|---|---|
| **T-01** | Happy path direct charge via `surface: "web"` | POST `ticket-checkout-create` with `surface: "web"`, valid eventId, valid buyerEmail, brand has `acct_*` charges_enabled | Response `{ kind: "requires_web_redirect", hostedCheckoutUrl }`. Stripe Checkout Session in Dashboard shows `Stripe-Account: acct_*` + no `transfer_data` + `statement_descriptor_prefix: "MINGLA"`. | Full stack | Implementor |
| **T-02** | Happy path direct charge via `surface: "mobile-web"` | Same as T-01 with `surface: "mobile-web"` | Same as T-01 with `success_url`/`cancel_url` carrying `mingla-business://` scheme | Full stack | Implementor |
| **T-03** | Happy path direct charge via `surface: "native"` | POST with `surface: "native"`, valid event | Response `{ kind: "requires_payment_sheet", clientSecret }`. Stripe PaymentIntent in Dashboard shows `on_behalf_of: acct_*` (Stripe sets this automatically when `Stripe-Account` header is used) + no `transfer_data`. | Full stack | Implementor |
| **T-04** | `application_fee_amount` recorded when RPC returns non-zero | Mock RPC to return `application_fee_amount_cents: 250` for a $50 ticket. Initiate checkout. | Stripe Checkout Session body shows `payment_intent_data.application_fee_amount: 250`. Stripe Dashboard shows Application fee = $2.50. | Edge fn unit test | Implementor |
| **T-05** | `application_fee_amount` omitted when RPC returns zero | Mock RPC to return `application_fee_amount_cents: 0`. Initiate checkout. | Stripe Checkout Session body does NOT have `application_fee_amount` key. | Edge fn unit test | Implementor |
| **T-06** | Statement descriptor renders "MINGLA*" prefix | Live complete a $0.50 Stripe-test-card purchase via T-01 happy path | Buyer's Stripe receipt email shows `MINGLA* <creator brand name>` in the statement-descriptor line. | Live (pre-flight probe) | Tester |
| **T-07** | Refund via direct charge | Place a $0.50 test order via T-01; trigger refund-order edge fn with full amount | `stripe.refunds.create` called with `{ stripeAccount: <acct_*> }`; refund succeeds; connected account's balance reflects the debit; `orders.payment_status` advances to `refunded`. | Full stack | Implementor + Tester |
| **T-08** | Dispute event flows to webhook | Dispatch a `charge.dispute.created` test event from Stripe Dashboard scoped to a connected account | Webhook fires; `event.account` populated; `payment_webhook_events` row inserted with correct `type`; downstream router processes (no error). | Live | Tester |
| **T-09** | Backward compat: historical destination-charge order in DB | Pre-existing test order in `orders` with destination-charge PI ID | Order row queryable; existing scanner / order display flows work unchanged; ONLY refund path would surface a controlled error (acceptable per §3.2.3). | DB + UI | Tester |
| **T-10** | CI gate trips on re-introduced `transfer_data` | Locally reintroduce `transfer_data: { destination: stripeAccountId }` on one call site | `orch-0843-stripe-direct-charges-only.mjs` exits 1 with named failure citing file:line. | CI gate | Implementor (adversarial) |
| **T-11** | CI gate trips on missing `application_fee_amount` | Remove the `application_fee_amount` plumbing line locally | Gate exits 1 with named failure on T-G3 sub-check. | CI gate | Implementor (adversarial) |
| **T-12** | CI gate trips on missing `stripeAccount` header | Remove `stripeAccount` from one request-options | Gate exits 1 with named failure on T-G2 sub-check. | CI gate | Implementor (adversarial) |

**Tester-written adversarial coverage:** T-10, T-11, T-12 are the regression-prevention adversarials. Implementor runs them locally before declaring DONE; tester re-runs them as part of TEST mode verification.

---

## Phase 8 — Implementation Order

1. **(audit)** Read `cancel-order/index.ts`; identify any connected-account-scoped Stripe call.
2. **(file 1)** Modify `supabase/functions/refund-order/index.ts`:
   - Add the connected-account lookup JOIN (§3.2.2).
   - Remove `reverse_transfer: true`.
   - Add `stripeAccount: connectedAccountId` to the request-options.
   - Update the doc comment block at top of file.
3. **(file 2)** Modify `supabase/functions/ticket-checkout-create/index.ts`:
   - Source `applicationFeeAmountCents` from session row.
   - Hosted Checkout Session path: remove `transfer_data`, add `application_fee_amount` (conditional), add `statement_descriptor_prefix: "MINGLA"`, add `stripeAccount` to options.
   - Native PaymentIntent path: remove `transfer_data`, add `application_fee_amount` (conditional), add `stripeAccount` to options.
   - Update line 251 comment.
4. **(file 3, if step 1 found anything)** Modify `supabase/functions/cancel-order/index.ts` analogously.
5. **(CI gate)** Add `.github/scripts/strict-grep/orch-0843-stripe-direct-charges-only.mjs`.
6. **(CI workflow)** Wire new job into `.github/workflows/strict-grep-mingla-business.yml` (one job + one registry comment).
7. **(regression test)** Add `supabase/functions/ticket-checkout-create/__tests__/orch-0843-direct-charge-shape.test.ts` (Deno test that mocks the Stripe SDK and asserts the outbound body shape).
8. **(adversarial)** Locally run all three adversarial revert tests (T-10, T-11, T-12) and confirm gate trips.
9. **(DEC amendment)** Add the DEC-154 amendment entry at top of `Mingla_Artifacts/DECISION_LOG.md` per §11 text.
10. **(invariant registry)** Add the 4 new invariants to `Mingla_Artifacts/INVARIANT_REGISTRY.md` (PROPOSED status pending CLOSE).
11. **(pre-flight probe)** Operator-gated. See §9.
12. **(deploy)** Operator-gated. See §10.

**Hard guard:** implementor MUST NOT deploy edge functions. Per memory rule (`feedback_orchestrator_deploys_edge_functions.md`), edge fn deploys are orchestrator-owned. Implementor produces source code + IMPLEMENTATION report; orchestrator deploys at CLOSE after operator approval.

---

## Phase 9 — Pre-Flight Probe

Mirror the ORCH-0839-B pattern (DEC-155 (4)).

**Probe edge function:** `supabase/functions/orch-0843-stripe-direct-charge-probe/index.ts` (one-shot; deleted at CLOSE).

**Contract:**
- Reads `STRIPE_SECRET_KEY` + an operator-provided test brand `stripeAccountId`.
- Calls `stripe.checkout.sessions.create({...with direct-charge body...}, { stripeAccount })` against the operator's chosen test connected account.
- Returns the resulting `cs_test_*` ID + the full Stripe response body (sanitized).
- Operator manually completes the test session in a browser using Stripe test card `4242 4242 4242 4242`.

**Verification on success:**
- a) Stripe Dashboard → Connected Accounts → <test account> → Payments shows the charge with no `transfer` event.
- b) Buyer's receipt email shows `MINGLA* <creator name>` in statement descriptor.
- c) Webhook delivery in Stripe Dashboard shows `checkout.session.completed` event with `event.account: <acct_*>` set.
- d) Trigger refund-order against the test order; verify direct-charge refund succeeds + connected balance debits.

**Teardown:** delete the probe function (local + deployed) at CLOSE. Mirror DEC-155 (4) cleanup pattern.

---

## Phase 10 — Operator Gates + Rollout

### 10.1 — Pre-implementor gates

- **G-1** Operator confirms Path B (CONFIRMED 2026-05-15 per dispatch; recorded here).
- **G-2** Operator confirms `application_fee_amount` plumbing approach §3.1.4 alternative (default: pass-through from RPC). Implementor may begin once confirmed.

### 10.2 — Post-implementor gates

- **G-3** Operator confirms webhook endpoint in Stripe Dashboard is registered as **Connect** webhook + subscribes to required event types (§3.4.2, §3.4.3).
- **G-4** Operator approves pre-flight probe execution (§9). Probe runs against an operator-named test brand.
- **G-5** On probe green, operator approves edge fn hot-deploy (`ticket-checkout-create` v44, `refund-order` v_next, optionally `cancel-order` v_next).

### 10.3 — Deploy mechanic

- Atomic deploy: orchestrator runs `supabase functions deploy ticket-checkout-create`, `supabase functions deploy refund-order`, and (if changed) `supabase functions deploy cancel-order`.
- Backend-only — NOT OTA-able semantics N/A (no mobile rebuild needed; mobile clients send `surface` strings, edge fn does the right charge shape internally).
- No mobile app version bump required.

### 10.4 — Post-deploy monitoring

- Orchestrator + operator watch the first 3 live charges + 1 live refund in Stripe Dashboard before declaring live sales open to all 5 charges-enabled brands.
- Verify each charge: charge object lives on connected account, `application_fee_amount` field populated correctly, statement descriptor shows `MINGLA* <creator>`, no `transfer` event.
- Verify refund: refund debits connected account balance; under platform-liable (Path B), if balance insufficient, Mingla platform balance absorbs the difference — operator-monitored.

### 10.5 — Rollback

- Edge function v43 retained on Supabase Functions (Supabase keeps previous versions automatically). Orchestrator can redeploy v43 within ~1 minute if catastrophic failure observed.
- No DB rollback needed (zero migrations).
- CI gate would block re-introduction of `transfer_data` on the next PR; rollback would bypass via direct edge-fn redeploy without source revert. Acceptable emergency.

### 10.6 — No feature flag

Charge shape is mutually-exclusive (a single Stripe call is either destination OR direct — can't be both). A flag would just add risk of mis-routing during the transition window. Atomic deploy is safer.

---

## Phase 11 — DEC-154 Amendment

The following entry must be added at the top of `Mingla_Artifacts/DECISION_LOG.md` as part of the CLOSE deliverable. Implementor drafts; orchestrator commits at CLOSE.

```
> **2026-05-15 - DEC-154 AMENDMENT logged - ORCH-0843 [Charge-Shape Reconciliation] CLOSE — Path B selected. DEC-154 (1) PRESERVED; DEC-154 (5) AMENDED to platform-managed risk.**
> Amendment: ORCH-0843 amends DEC-154 (5) from "Stripe-managed loss liability" to "Platform-managed loss liability." Funds flow per DEC-154 (1) remains direct charges on the connected account with `application_fee_amount` for Mingla's platform cut (UNCHANGED from DEC-154 (1); this ORCH delivers the implementation). Risk/loss liability per DEC-154 (5) is now **platform-managed**: Mingla (the platform / `losses_collector: "application"`) absorbs negative-balance losses on connected accounts, including fraud-driven losses, chargebacks on the 120-day post-event tail, and event-cancellation-driven mass-refund balance gaps. Mingla is the financial backstop. This REVERSES DEC-154 (5)'s original "Stripe-managed risk" stance. Rationale: at the time of the amendment, Mingla had 9 sandbox-test connected accounts (all `losses_collector: "application"` per `stripeBlueprintClient.ts:135-136`) and 0 real charges (`stripe_charge_id` populated on 0 of 27 `orders` rows). Re-onboarding the 9 test stubs to claim Stripe-managed-risk shield is busy work that delayed the live-sales unblocker. The 5 charges-enabled test brands are stubs, not real merchants. Operator accepts platform-liable chargeback risk as the conscious tradeoff to ship faster. This amendment locks Mingla into platform-liable for the existing 9 accounts AND for all new accounts provisioned through the unchanged `stripeBlueprintClient.ts` until a future ORCH (TBD) re-evaluates. Sticky-controller-properties per DEC-154 (6): re-evaluation will require detach + re-onboard of all platform-liable accounts under new controller shape — a campaign that the operator chose NOT to run today on the basis of test-stub volume. DEC-154 (2) (embedded onboarding) and DEC-154 (3) (embedded account management) become OPTIONAL under Path B — brand-continuity benefits still apply but are no longer load-bearing for the risk model; queued as deferred-priority future ORCHs, not blockers for live sales. DEC-154 (1) statement-descriptor-prefix `"MINGLA"` IS shipped by this ORCH (CI gate T-G5). DEC-154 (4) Stripe-owns-pricing IS unchanged. DEC-154 (7) hard-stop on live sales IS LIFTED by this ORCH's CLOSE; live sales open immediately on charges-enabled test brands once the operator confirms post-deploy monitoring (Phase 10.4). DEC-154 (9) security baselines (a-d) remain enforced: (a) restricted API keys still queued in a separate sub-ORCH (Discovery 7 from investigation); (b) webhook signature verification VERIFIED (`stripe-webhook/index.ts:56` uses `verifyStripeWebhookSignature` on every event); (c) event subscription set verified against Stripe Dashboard at operator gate G-3; (d) creator-facing disclosure copy unchanged (no UI change in this ORCH). Cross-references: SPEC `Mingla_Artifacts/specs/SPEC_ORCH-0843_CHARGE_SHAPE_RECONCILIATION.md`; investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0843_CHARGE_SHAPE_RECONCILIATION.md`; new invariants I-PROPOSED-STRIPE-CHARGE-SHAPE-IS-DIRECT + I-PROPOSED-STRIPE-APPLICATION-FEE-PRESENT + I-PROPOSED-STRIPE-ACCOUNT-HEADER-ON-CONNECTED-CALLS + I-PROPOSED-STRIPE-STATEMENT-DESCRIPTOR-PREFIX-MINGLA. Operator sign-off: chat instructions Path B selection + acceptance of platform-liable risk 2026-05-15.
```

(Final amendment wording is the orchestrator's call at CLOSE; SPEC provides the operative facts.)

---

## Phase 12 — Regression Prevention

1. **CI gate** `orch-0843-stripe-direct-charges-only.mjs` (5 sub-checks per §5) — blocks any future PR that re-introduces `transfer_data.destination` or removes `stripeAccount` / `application_fee_amount` / `statement_descriptor_prefix` plumbing.
2. **Implementor regression test** `__tests__/orch-0843-direct-charge-shape.test.ts` — fails CI if the outbound Stripe API call body shape deviates.
3. **Protective comment** on every flipped call site: `// ORCH-0843 — direct-charge shape per DEC-154 (amended Path B). DO NOT re-introduce transfer_data.destination. See INVESTIGATION_ORCH-0843 / SPEC_ORCH-0843.` This warns future code-writers reading the file in isolation.
4. **INVARIANT_REGISTRY entries** for the 4 new invariants — codifies the design rule beyond the test suite.
5. **DEC-154 amendment** carries the operator's acceptance of platform-liable risk in the historical record so future operators (or future Seth in 6 months) see the rationale.

---

## Phase 13 — Discoveries for Orchestrator (carry-forward from investigation)

These remain orchestrator-tracked side issues; ORCH-0843 does NOT close them:

1. **Embedded onboarding (DEC-154 (2))** — deferred-priority future ORCH (no longer load-bearing under Path B).
2. **Embedded account management (DEC-154 (3))** — same as #1.
3. **Restricted API keys per edge fn (DEC-154 (9)(a))** — separate sub-ORCH; orthogonal to charge shape.
4. **Mingla platform fee formula** — product decision; SPEC wires plumbing, value remains 0 until a product ORCH wires non-zero.
5. **Stripe webhook endpoint registration as Connect webhook (DEC-154 (9)(c))** — operator-verifiable in Dashboard at gate G-3; if gap found, raise as Discovery.
6. **Path B re-evaluation trigger** — when real-merchant count grows beyond test stubs (e.g., >50 production-active connected accounts OR first chargeback loss exceeding $500), orchestrator raises a Path-A reconsideration ORCH to evaluate Stripe-managed-risk re-onboarding campaign.

---

## Phase 14 — Files Touched Summary

| File | Action | Layer |
|---|---|---|
| `supabase/functions/ticket-checkout-create/index.ts` | Modify (×2 call sites + comment) | Edge fn |
| `supabase/functions/refund-order/index.ts` | Modify (refund call + JOIN) | Edge fn |
| `supabase/functions/cancel-order/index.ts` | Audit + modify if any connected-account Stripe call | Edge fn |
| `supabase/functions/ticket-checkout-create/__tests__/orch-0843-direct-charge-shape.test.ts` | Create | Test |
| `.github/scripts/strict-grep/orch-0843-stripe-direct-charges-only.mjs` | Create | CI |
| `.github/workflows/strict-grep-mingla-business.yml` | Add 1 job + 1 registry comment | CI |
| `Mingla_Artifacts/DECISION_LOG.md` | Add DEC-154 amendment entry (orchestrator owns at CLOSE) | Docs |
| `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Add 4 new PROPOSED invariants | Docs |
| `Mingla_Artifacts/WORLD_MAP.md` | ORCH-0843 CLOSE banner (orchestrator owns at CLOSE) | Docs |
| `supabase/functions/orch-0843-stripe-direct-charge-probe/index.ts` | Create (probe) + delete at CLOSE | Edge fn (transient) |

**Files NOT touched (deliberately):**
- `supabase/functions/_shared/stripeBlueprintClient.ts` — Path B keeps platform-liable controller-properties.
- `supabase/functions/_shared/stripeBlueprintClient.test.ts` — no snapshot change.
- `supabase/functions/brand-stripe-onboard/index.ts` — embedded onboarding deferred.
- `supabase/functions/stripe-webhook/index.ts` — read-only audit; no code change expected.
- `supabase/functions/_shared/stripeWebhookRouter.ts` — same.
- DB migrations (`supabase/migrations/*`) — none required.
- Mobile / business / admin UI — no client-side change.

---

## Phase 15 — Confidence Level

**Overall: High.** SPEC scope is intentionally narrow (3 edge fns, 1 CI gate, 1 test file, 1 DEC amendment). All file:line + exact code citations verified against source. Direct-charge contract verified against Stripe's authoritative docs (per investigation §Phase 0 ingest). No source-only "suspected" reasoning — every contract has source evidence + Stripe-docs corroboration. The plumbing for `application_fee_amount` is already in the DB layer (per migration `20260605000002`), so edge-fn wiring is a read-and-pass-through — minimum implementation risk.

**Where confidence drops to Medium:**
- Exact `application_fee_amount` value to plumb (operator gate G-2; default = 0 from RPC is safe but commits Mingla to $0 platform revenue at v1).
- Statement-descriptor live rendering (cleanly verified only by pre-flight probe at §9).
- Webhook endpoint Connect-registration (operator-side Dashboard config; can't verify from code).

These three drop confidence ONLY for the operator-gated steps; the implementor's source-code work is High confidence end-to-end.

---

**SPEC ends.** Next handoff: Codex `implementor-mingla` for IMPLEMENT.
