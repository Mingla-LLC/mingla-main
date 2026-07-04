# SPEC — ORCH-1291 [rsvp-chip-in]

v1 build unit of META-ORCH-1290 [chip-in contributions].
Phase: SPEC (binding contract). Follows `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1291_RSVP_CHIP_IN.md`.
Worktree: `~/Desktop/mingla-orchs/ORCH-1291-[rsvp-chip-in]/` on branch `ORCH-1291-rsvp-chip-in`.
Author: mingla-forensics (Claude). Date: 2026-07-03.
External-API doc URLs cited inline per COMMS-0003 / I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED. Stripe skill (`stripe-best-practices`) loaded at SPEC start.

---

## 1. Executive summary

Let a guest who RSVPs to a free RSVP event OPTIONALLY "chip in" a voluntary gift amount, on both Stripe (Connect direct-charge) and Paystack (NGN) rails. The chip-in is a SECOND, voluntary action — the guest can always RSVP for free. The contribution is treated as a **gift: ZERO transaction tax, contribution-style receipt** (not a tax invoice), while Mingla still takes its normal platform cut (`application_fee`). The money math reuses the single all-in engine (Constitution #2) with ONE new `TaxBasis` member and a skipped tax round-trip — no divergent money path. Contributions persist in a NEW `event_rsvp_contributions` child table, preserving the RSVP payment-free wall (`event_rsvps` never gains a payment column). Enabling chip-in flips the RSVP into a money-collector that MUST be bank-gated at publish via a PROVIDER-AWARE predicate (Stripe `charges_enabled` OR Paystack subaccount present); an organiser with no bank can connect one inline from the same toggle screen and continue. The chip-in guest UI lands in the shared `packages/offering-rendering/RsvpOfferingBody.tsx` so all 5 surfaces inherit it.

---

## 2. Scope & non-goals

### In scope (v1)
1. Organiser toggle in the RSVP create/edit wizard: "Let guests chip in" (optional voluntary contribution), with an optional suggested-amount and an optional minimum floor.
2. Inline bank-connect from the toggle screen when the brand cannot collect (provider-aware).
3. Provider-aware publish bank-gate for chip-in-enabled RSVP events.
4. Guest-facing chip-in UI in the shared public RSVP body (voluntary, after RSVP) — consumer iOS/Android + business + buyer/anon web.
5. Contribution payment on BOTH rails: Stripe Connect direct-charge + Paystack NGN, via the reused all-in engine at `tax_cents = 0`, `application_fee = miglaFee`.
6. New `event_rsvp_contributions` child table + event config columns/flags.
7. Contribution finalize (webhook-driven) on both rails.
8. Contribution refund path + RSVP-event-cancellation handling.
9. Gift/contribution-style receipt & confirmation semantics (copy finalization routed to mingla-product).

### Non-goals (explicitly OUT — each reserved for a fast-follow)
- **Pay-what-you-want TICKETS on standard/ticketed events** — reserved for fast-follow (a different container: `orders`/`ticket_types`).
- **Required-to-attend contribution mode** ("Going" is payment-gated) — reserved for fast-follow; also this is the mode that would make the payment taxable consideration (see §10 Q-A / investigation F-10).
- **Standard-event / ticketed-event work of any kind** — out.
- **Admin-web authoring or contribution management** — out; read-only visibility is META-ORCH-1237's lane.
- **"Guest covers the fees" gross-up toggle** — out (§4 fixes organiser-absorbs; the toggle is a reserved enhancement, investigation F-11).

### Assumptions
- The brand's provider is already resolved by `resolve_event_pricing_inputs` (returns `payment_provider`, `paystack_subaccount_code`, switches, region, currency, take-rate, `vat_rate_bps`).
- `event_rsvps` remains payment-free (I-PROPOSED-1150-RSVP-NO-TICKET-ROWS).

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered | User-visible behavior | Files touched | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/` iOS) | YES | Sees "Chip in" section in the public RSVP body after RSVP; can pay via native Stripe PaymentSheet / Paystack redirect | Consumes `packages/offering-rendering/RsvpOfferingBody.tsx`; wires `onChipIn` in `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` | AUTOMATIC (shared body) + thin per-app handler |
| 2 | Consumer Android (`app-mobile/` Android) | YES | Same as iOS; Android glass = opaque fallback per policy | Same as #1 | AUTOMATIC + thin handler |
| 3 | Buyer/anon Web (`mingla-business/` public routes `/e/{brandSlug}/{eventSlug}`) | YES | Anon guest sees chip-in in the shared body; pays via hosted Stripe Checkout / Paystack redirect | `packages/offering-rendering/RsvpOfferingBody.tsx`; buyer-web submit handler in `mingla-business/src/services/rsvpEvents.ts` | AUTOMATIC (shared body) |
| 4 | Business iOS | YES | Organiser toggles chip-in in RSVP wizard; inline bank-connect; sees contribution totals on the event | RSVP wizard screen(s) in `mingla-business/src/...` (create/edit); reuses `useStartBrandStripeOnboarding()` + Paystack onboard | MANUAL (business app code) |
| 5 | Business Android | YES | Same as business iOS | Same as #4 | MANUAL (same codebase → parity) |
| 6 | Admin Web (`mingla-admin/`, adjacent) | NO | Organiser authoring not present in admin; read-only contribution visibility is META-ORCH-1237 | none | n/a |
| 7 | Business Web preview (adjacent) | YES (inherited) | Preview renders the shared body incl. chip-in section (host preview) | none bespoke (inherits `RsvpOfferingBody`) | AUTOMATIC |

---

## 4. Layered specification

### 4.1 Database

**New table `public.event_rsvp_contributions`** (the child table — preserves the wall):

```
id                       uuid PK default gen_random_uuid()
event_id                 uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE
rsvp_id                  uuid NULL REFERENCES event_rsvps(id) ON DELETE SET NULL  -- link to the guest's RSVP row (nullable: anon may pay pre-link)
brand_id                 uuid NOT NULL REFERENCES brands(id)
user_id                  uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL   -- null for anon
guest_name               text NULL
guest_email              text NULL
provider                 text NOT NULL CHECK (provider IN ('stripe','paystack'))
currency                 text NOT NULL
amount_cents             integer NOT NULL CHECK (amount_cents > 0)                -- the buyer-named gift (settlement minor unit)
buyer_total_cents        integer NOT NULL                                          -- what the buyer is actually charged (= amount + passed fees; tax always 0)
application_fee_amount_cents integer NOT NULL DEFAULT 0                            -- Mingla's cut (miglaFee)
pricing_breakdown        jsonb NOT NULL                                            -- the engine's PricingBreakdown (tax_basis='voluntary_contribution', tax_cents=0)
status                   text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','paid','failed','refunded','partially_refunded','cancelled'))
stripe_payment_intent_id text NULL                                                 -- Stripe PI id OR Paystack reference (UNIQUE → idempotency)
stripe_charge_id         text NULL                                                 -- Stripe charge id OR Paystack txn id
refunded_amount_cents    integer NOT NULL DEFAULT 0
refund_reason            text NULL
created_at               timestamptz NOT NULL DEFAULT now()
paid_at                  timestamptz NULL
updated_at               timestamptz NOT NULL DEFAULT now()
UNIQUE (stripe_payment_intent_id)                                                  -- reused as reference slot on both rails (mirrors ticket_checkout_sessions)
```

**New config columns on `public.events`** (organiser config; nullable so non-RSVP events are unaffected):

```
rsvp_contribution_enabled        boolean NOT NULL DEFAULT false
rsvp_contribution_suggested_cents integer NULL CHECK (rsvp_contribution_suggested_cents IS NULL OR rsvp_contribution_suggested_cents > 0)
rsvp_contribution_min_cents      integer NULL CHECK (rsvp_contribution_min_cents IS NULL OR rsvp_contribution_min_cents > 0)
```
(No `rsvp_contribution_mode` column in v1 — mode is implicitly `optional`. The column is DEFERRED to the required-mode fast-follow so we do not ship an unused enum.)

**RLS on `event_rsvp_contributions`:**
- INSERT/UPDATE: service_role only (all writes go through the edge fn + finalize RPC; buyers never write directly).
- SELECT: (a) the contributing `user_id = auth.uid()` may read their own rows; (b) the brand owner/team (existing brand-membership predicate used by orders) may read rows for their brand's events; (c) anon may read NOTHING (contribution state is returned to the anon buyer only via the edge fn's response / status poll, never via direct table read).
- A read-only invariant probe (see §6 I-PROPOSED-1291-RSVP-NO-PAYMENT-COLUMNS) asserts `event_rsvps` gains no payment column.

**New RPC `finalize_rsvp_contribution(p_contribution_id, p_provider_ref, p_charge_id, p_payment_method_type)`** — SECURITY DEFINER, service_role. Idempotent (early-return if `status='paid'`). Flips `status='paid'`, sets `paid_at`, `stripe_charge_id`. Mirrors `biz_ticket_checkout_finalize`'s idempotency shape but writes the contribution row (NO order, NO ticket, NO chat/QR-as-admission).

**Publish-gate change — `business_publish_rsvp_draft`** (additive, conditional): when the draft payload has `rsvp_contribution_enabled = true`, require a provider-aware readiness check BEFORE marking published; else RAISE the fail-close reason. Do NOT gate free RSVPs.

**New predicate `pg_brand_can_collect(p_brand_id)`** — SECURITY DEFINER, provider-aware (investigation F-4/D-1):
```
SELECT pg_brand_can_charge(p_brand_id)                                  -- Stripe: charges_enabled
    OR EXISTS (SELECT 1 FROM brands b WHERE b.id = p_brand_id
               AND b.paystack_subaccount_code IS NOT NULL);             -- Paystack: subaccount present
```
The RSVP publish gate calls `pg_brand_can_collect`, NOT `pg_brand_can_charge` (reusing the Stripe-only predicate would wrongly block every NGN brand).

### 4.2 Edge function — `rsvp-contribution-create` (new)

- **Route/method:** `POST /functions/v1/rsvp-contribution-create`. `verify_jwt = false` (anon-capable, mirrors `public-submit-rsvp` and the ticket guest path — investigation F-6). Optional `Authorization` bearer resolves `user_id`; else anon buyer with name/email.
- **Request:** `{ eventId, rsvpId?, amountCents, guestName?, guestEmail?, surface: 'native'|'web'|'mobile-web', buyerStatusToken? }`.
- **Validation:** event exists, `event_type='rsvp'`, `rsvp_contribution_enabled=true`; `amountCents` integer > 0 AND `>= rsvp_contribution_min_cents` (if set); provider readiness via `pg_brand_can_collect` (fail-close `brand_cannot_collect` 409).
- **Pricing (reused engine, tax_cents=0):**
  1. `resolve_event_pricing_inputs(eventId)` → switches, region, currency, take-rate, provider, `paystack_subaccount_code`, `vat_rate_bps`.
  2. FORCE `pass_service_fee = false` and `pass_mingla_fee = false` for contributions (WYSIWYG gift — §10 Q-B decision); `pass_tax` irrelevant.
  3. `computeBuyerSubtotal({ baseCents: amountCents, switches, region, currency, ... })`.
  4. **No `tax.calculations.create` call** (Stripe) / **no VAT** (Paystack: pass `vat_rate_bps = 0` to `computeConfigVat`, or set taxCents=0 directly).
  5. `buildPricingBreakdown({ input, amountTotalCents: buyerSubtotal, taxCents: 0, taxBasis: 'voluntary_contribution', stripeTaxCalculationId: null })`.
  6. `application_fee = buyerSubtotal.miglaFeeCents` (Mingla's cut — ALWAYS, per `allInPricingEngine.ts:238`).
- **Stripe arm (direct-charge, mirrors `ticket-checkout-create`):** create the charge on the brand's connected account (`{ stripeAccount: stripeAccountId }` request option), `application_fee_amount = miglaFeeCents`, `metadata: { mingla_purpose: 'rsvp_contribution', contribution_id, event_id }`. Native → PaymentIntent + PaymentSheet; web/mobile-web → hosted Checkout Session. Persist the `event_rsvp_contributions` row (status `pending`) with the PI id in `stripe_payment_intent_id` BEFORE returning.
  - Doc: direct-charge + application_fee — https://docs.stripe.com/connect/direct-charges#collect-fees
  - Doc: PaymentIntent `application_fee_amount` — https://docs.stripe.com/api/payment_intents/create#create_payment_intent-application_fee_amount
  - Doc: Checkout Session on connected account — https://docs.stripe.com/connect/direct-charges
  - Doc: amounts in minor units — https://docs.stripe.com/currencies
- **Paystack arm (NGN, mirrors `ticket-checkout-create` Paystack arm):** insert the contribution row with a unique `reference` in `stripe_payment_intent_id`; call `paystackInitializeTransaction({ amountSubunits: buyerTotal (kobo), subaccount: paystack_subaccount_code, transactionChargeSubunits: miglaFeeCents, bearer: 'subaccount', metadata: { purpose:'rsvp_contribution', contribution_id }, channels: NG })`; return `authorization_url`.
  - Doc: initialize transaction (amount in subunits) — https://paystack.com/docs/api/transaction/#initialize
  - Doc: subaccount split + `transaction_charge` override + `bearer` — https://paystack.com/docs/api/subaccount/
  - Doc: payment channels (NG: card/bank/ussd/bank_transfer; NEVER mobile_money) — https://paystack.com/docs/payments/payment-channels/
- **Response:** `{ kind: 'requires_native_payment', clientSecret, ... }` | `{ kind: 'requires_web_redirect', url }` | `{ kind: 'requires_paystack_redirect', authorization_url }`.

### 4.3 Edge function finalize hooks (existing fns, additive branches)

- **`stripe-webhook` / `stripeWebhookRouter.ts`:** on `payment_intent.succeeded` / `checkout.session.completed`, if `metadata.mingla_purpose === 'rsvp_contribution'`, route to `finalize_rsvp_contribution` (by `contribution_id`) INSTEAD of `biz_ticket_checkout_finalize`. Must not alter the ticket path (branch on metadata first).
  - Doc: event types — https://docs.stripe.com/api/events/types
- **`paystack-webhook` / `paystackWebhookRouter.ts`:** on `charge.success`, verify-by-reference, then LOOK UP the reference in `event_rsvp_contributions` FIRST; if found → `finalize_rsvp_contribution`; else fall through to the existing `ticket_checkout_sessions` lookup. Amount + currency match retained (verified amount == `buyer_total_cents`, currency NGN).
  - Doc: verify transaction — https://paystack.com/docs/api/transaction/#verify
  - Doc: webhook signature (HMAC-SHA512 of raw body) — https://paystack.com/docs/payments/webhooks/

### 4.4 Edge function — contribution refund (extend or sibling of `refund-order`)

- A contribution has no `order` → `refund-order` cannot handle it (investigation F-7). Add `rsvp-contribution-refund` (or a `contribution` branch keyed on `contribution_id`):
  - Stripe: `refunds.create({ payment_intent, amount?, refund_application_fee: <decision> }, { stripeAccount })` on the connected account. Set `refund_application_fee` per policy (v1: refund the full amount incl. Mingla's fee on a gift refund — a gift refund should make the guest whole; flag if Seth wants Mingla to keep its cut).
    - Doc: refunds + `refund_application_fee` — https://docs.stripe.com/connect/direct-charges#issue-refunds
  - Paystack: `POST /refund { transaction: <reference|id>, amount? }`.
    - Doc: refunds — https://paystack.com/docs/api/refund/#create
  - Flip `event_rsvp_contributions.status` → `refunded` / `partially_refunded`, set `refunded_amount_cents`.
- **Cancellation:** when an RSVP event is cancelled, all `status='paid'` contributions for it are refunded (batch) and set to `cancelled`/`refunded`; the guest's RSVP status is unchanged (free RSVP survives; only the gift is returned).

### 4.5 Service / hooks (business + consumer)

- `mingla-business/src/services/rsvpEvents.ts` — add `submitRsvpContribution(input)` calling `rsvp-contribution-create` (mirrors `submitPublicRsvp`). Anon-capable.
- New hook `useRsvpContribution(eventId)` (React Query mutation) — `onError` mandatory (toast), invalidates the event's contribution summary query key from the shared query-key factory. No hardcoded key strings.

### 4.6 Component (shared body + wizard)

- **`packages/offering-rendering/RsvpOfferingBody.tsx`** — add a **Chip-in section** rendered only when `config.rsvp_contribution_enabled` (extend `RsvpOfferingBodyProps.config`) and a new callback prop `onChipIn(input: { amountCents }) => Promise<...>`. Placement: a voluntary second action after the RSVP momentum decision / in the success popup ("You're in — want to chip in?"). Amount input with optional suggested-amount presets + free-form; enforces the min floor client-side (server re-validates). All states: idle / entering / submitting / success / error / (brand cannot collect → hidden). a11y labels + ≥44pt targets; RN inline colors hex/rgb only.
- **RSVP wizard (business app, `mingla-business/src/...`)** — add the "Let guests chip in" toggle + suggested/min fields. When toggled ON and `pg_brand_can_collect` is false, surface the inline connect sub-flow: Stripe brand → `useStartBrandStripeOnboarding()` + `expo-web-browser.openAuthSessionAsync` (deep-link return, re-check readiness); Paystack brand → the `brand-paystack-onboard` create_subaccount form. On return, re-check and unlock.
- **DESIGN dependency:** the exact pixel spec for the chip-in section + wizard toggle is produced by `mingla-designer` (5 surfaces, incl. Android opaque-glass delta) and embedded here before IMPLEMENT (see §11).

---

## 5. Success criteria (numbered, observable; per-surface where parity is manual)

- **SC-1** — A guest can RSVP FREE to a chip-in-enabled event without paying anything (chip-in never blocks RSVP). (all surfaces via shared body)
- **SC-2** — After RSVP, a chip-in affordance appears iff `rsvp_contribution_enabled=true`.
  - SC-2-iOS / SC-2-Android / SC-2-Web — visible on each.
- **SC-3 (Stripe)** — A guest chip-in of X on a Stripe brand charges the buyer exactly X (no tax, no service fee added), lands `event_rsvp_contributions.status='paid'` with `pricing_breakdown.tax_cents=0`, `tax_basis='voluntary_contribution'`, and `application_fee_amount_cents = round(X * take_rate_bps / 10000)` collected to Mingla.
- **SC-4 (Paystack)** — A guest chip-in of X (NGN) on a Paystack brand charges X kobo on the brand's subaccount, routes `transaction_charge = miglaFee` to Mingla's main account, and the verified `charge.success` webhook finalizes the contribution row (amount+currency matched).
- **SC-5** — The persisted receipt/confirmation reads as a voluntary contribution (no tax line, no "tax invoice", no admission-ticket/QR), amount + brand + event present.
- **SC-6** — Publishing a chip-in-enabled RSVP with NO connected bank is BLOCKED with the fail-close reason and routes to the correct inline connect flow for the brand's provider; a FREE (chip-in OFF) RSVP publishes with NO bank requirement.
  - SC-6-Stripe — Stripe brand without `charges_enabled` blocked; SC-6-Paystack — Paystack brand without `paystack_subaccount_code` blocked; SC-6-Paystack-ready — Paystack brand WITH a subaccount is NOT blocked (guards against the `pg_brand_can_charge` Stripe-blind trap).
- **SC-7** — An ANON web guest can chip in end-to-end (no login) and receives confirmation.
- **SC-8** — A refund of a paid contribution flips status to `refunded`/`partially_refunded` and returns funds on the correct rail; cancelling the event refunds all its paid contributions and leaves guests' free RSVPs intact.
- **SC-9** — `event_rsvps` has NO new payment column and `business_publish_rsvp_draft` still soft-deletes stray `ticket_types` (wall preserved).
- **SC-10** — The ticket/all-in money path is byte-unchanged for non-contribution charges (no tax-behavior regression on tickets).

---

## 6. Invariants

**Preserved:**
- **I-PROPOSED-1150-RSVP-NO-TICKET-ROWS** — publish RPC still soft-deletes stray `ticket_types`; contributions never create tickets. Verified by SC-9 + the existing publish-RPC test.
- **Constitution #2 (single money-math owner)** — contributions reuse `allInPricingEngine.ts`; no parallel math path. Verified by SC-3/SC-4 asserting the engine's `PricingBreakdown` shape.
- **I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED** — extended provider-aware (Stripe OR Paystack). Verified by SC-6.
- **I-PROPOSED-ALLIN-REGION-TAX-BEHAVIOR** — untouched; contributions skip the tax call entirely rather than mis-set a region behavior.

**New (DRAFT — flip ACTIVE on CLOSE; orchestrator owns the flip):**
- **I-PROPOSED-1291-RSVP-NO-PAYMENT-COLUMNS (DRAFT)** — `event_rsvps` must never carry a price/amount/currency/payment column; contributions live only in `event_rsvp_contributions`. Read-only probe: `information_schema.columns` on `event_rsvps` contains none of `{price,amount,currency,contribution,paid,application_fee}`.
- **I-PROPOSED-1291-CONTRIBUTION-TAX-ZERO (DRAFT)** — every `event_rsvp_contributions` row has `pricing_breakdown->>'tax_basis' = 'voluntary_contribution'` AND `pricing_breakdown->'components'->>'tax_cents' = '0'` AND `(passed.tax_cents = 0 AND absorbed.tax_cents = 0)`. A contribution is never a taxed sale.
- **I-PROPOSED-1291-CONTRIBUTION-MINGLA-FEE (DRAFT)** — every paid contribution has `application_fee_amount_cents = round(amount_cents * effective_take_rate_bps / 10000)` (Mingla's cut is always taken).
- **I-PROPOSED-1291-CONTRIBUTION-BANK-GATED (DRAFT)** — a chip-in-enabled RSVP event cannot be `published` unless `pg_brand_can_collect(brand_id)` is true.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-1 (happy) | Stripe chip-in | amount=£10, take_rate=150bps | buyer charged £10.00; contribution `paid`; `tax_cents=0`; `application_fee=15` | edge+db |
| T-2 (happy) | Paystack chip-in | amount=₦5000, subaccount set | ₦5000 kobo charged on subaccount; `transaction_charge=miglaFee`; webhook finalizes | edge+db |
| T-3 (error) | Publish chip-in ON, no bank | Stripe brand, `charges_enabled=false` | publish RAISEs `stripe_charges_disabled`; UI shows "Finish bank setup" | rpc+ui |
| **T-4 (ADVERSARIAL)** | **Paystack-ready brand publishes chip-in RSVP** | **Paystack brand, `paystack_subaccount_code` set, NO stripe_connect_accounts row** | **publish SUCCEEDS (must NOT be blocked by the Stripe-only `pg_brand_can_charge`)** | **rpc** |
| T-5 (edge) | Below floor | amount < `rsvp_contribution_min_cents` | edge rejects `amount_below_min`; no row minted | edge |
| T-6 (edge) | Anon web chip-in | no JWT, name+email | contribution `paid`, `user_id` null | edge+db |
| T-7 (adversarial) | Free RSVP still works | chip-in ON, guest declines to pay | RSVP row `going`, NO contribution row, no charge | edge+db |
| T-8 (error) | Refund | paid contribution | Stripe/Paystack refund issued; status `refunded` | edge |
| T-9 (regression) | Ticket charge unchanged | standard ticket checkout | tax path + `tax_basis` unchanged vs origin/main | edge |
| T-10 (wall) | Stray ticket on RSVP draft | RSVP draft with a ticket_type | publish soft-deletes it; contribution unaffected | rpc |
| T-11 (idempotency) | Duplicate webhook | same PI/reference twice | one `paid` row (finalize early-return) | edge |

---

## 8. Implementation order

1. **DB migration** `20261220000000_orch_1291_rsvp_contributions.sql` (re-scan prefixes at build; bump if collided): create `event_rsvp_contributions` + RLS; add 3 `events` config columns; create `finalize_rsvp_contribution`, `pg_brand_can_collect`; alter `business_publish_rsvp_draft` (conditional gate). Append a `__tests__/orch_1291_*.test.sql` asserting the wall + gate.
2. **Engine** — add `'voluntary_contribution'` to `TaxBasis` in `supabase/functions/_shared/allInPricingEngine.ts` (additive; blast-check all `switch (taxBasis)` sites).
3. **Edge fn** `rsvp-contribution-create` (+ `config.toml` `verify_jwt=false`); reuse pricing helpers.
4. **Webhook routers** — contribution branches in `stripeWebhookRouter.ts` + `paystackWebhookRouter.ts`.
5. **Refund** — `rsvp-contribution-refund` (or a `contribution` branch) + cancellation batch.
6. **Service/hook** — `submitRsvpContribution` in `rsvpEvents.ts` + `useRsvpContribution`.
7. **Shared body** — chip-in section + `onChipIn` in `RsvpOfferingBody.tsx` (per the embedded designer spec).
8. **Business wizard** — toggle + suggested/min fields + inline provider-aware bank-connect.
9. **Consumer/business handlers** — wire `onChipIn` in `ConsumerEventDetailScreen.tsx` + business preview path.

Orchestrator (NOT the implementor) applies the migration and deploys the edge fns.

### Scoped allowlist (implementor may modify ONLY these)
- `supabase/migrations/20261220000000_orch_1291_rsvp_contributions.sql` (new) + `__tests__/orch_1291_*.test.sql`
- `supabase/functions/_shared/allInPricingEngine.ts` (one enum member only)
- `supabase/functions/rsvp-contribution-create/` (new) + `supabase/config.toml` (its block)
- `supabase/functions/rsvp-contribution-refund/` (new) OR `refund-order/index.ts` (contribution branch — pick one, note in report)
- `supabase/functions/_shared/stripeWebhookRouter.ts`, `_shared/paystackWebhookRouter.ts` (additive branches)
- `mingla-business/src/services/rsvpEvents.ts` + the new hook file
- `packages/offering-rendering/RsvpOfferingBody.tsx` (chip-in section + prop)
- RSVP wizard screen(s) in `mingla-business/src/` (toggle + connect)
- `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (wire `onChipIn`)

### DO-NOT-TOUCH (stop-and-amend before touching)
- `event_rsvps` table shape (NO payment columns — the wall).
- `ticket-checkout-create`, `biz_ticket_checkout_finalize`, `ticket_types`, `orders` (ticket money path — reference only).
- The engine's math functions `computeBuyerSubtotal` / `buildPricingBreakdown` bodies (reuse, do not edit).
- `pg_brand_can_charge` (Stripe-only predicate — add the sibling `pg_brand_can_collect`, do not repurpose).
- Any admin-web (`mingla-admin/`) file.

---

## 9. Regression prevention (fails-on-revert contract)

- **Structural safeguard:** the DRAFT invariants become CI-checkable probes.
- **Named test (must FAIL on revert, PASS on restore):** `supabase/migrations/__tests__/orch_1291_rsvp_contribution_wall.test.sql` asserts (a) `event_rsvps` has zero payment columns, (b) `business_publish_rsvp_draft` blocks a chip-in-enabled publish when `pg_brand_can_collect` is false AND allows a Paystack-subaccount brand (T-4). Reverting the migration/gate makes T-3/T-4 fail.
- **Engine guard:** a jest/deno test asserts a contribution `PricingBreakdown` has `tax_cents=0`, `tax_basis='voluntary_contribution'`, `application_fee_amount_cents>0`. Reverting the enum member or the taxCents=0 wiring fails it.
- **Ticket-path guard (T-9):** assert a standard ticket charge's `tax_basis`/tax behavior is byte-identical to origin/main — catches any accidental coupling of the contribution path into the ticket path.
- **Protective comment** on the `business_publish_rsvp_draft` gate + the `pg_brand_can_collect` body explaining WHY it is provider-aware (cites investigation F-4/D-1, the Stripe-blind trap).

---

## 10. Open questions (need Seth / a decision — do NOT silently resolve)

- **Q-A (FINANCE/LEGAL — NOTIFY, investigation F-10):** the zero-tax gift model is defensible in v1 ONLY because chip-in is optional (attendance is free → not taxable consideration). This SPEC ships the zero-tax mechanism Seth locked. **Seth to acknowledge:** (1) the organiser's own income-tax treatment of receipts is out of Mingla's checkout scope; (2) the required-to-attend mode (reserved) will need a taxable-consideration path, not this gift path. No code blocker.
- **Q-B (PRODUCT FORK — NOTIFY, investigation F-11):** processing-fee incidence. **Recommendation shipped in this SPEC:** organiser absorbs processing (guest charged exactly the amount typed; `pass_service_fee=false`, `pass_mingla_fee=false`, Paystack `bearer:'subaccount'`); Mingla still takes `application_fee`. Alternative (deferred): a "cover the fees" guest toggle. **Seth to confirm** the organiser-absorbs default.
- **Q-C:** refund of a gift — does Mingla return its `application_fee` too (make the guest fully whole, SPEC default `refund_application_fee=true`) or keep its cut? Confirm.
- **Q-D:** does an anon web contribution require linking to a prior `event_rsvps` row, or can a guest chip in without a formal RSVP row (`rsvp_id` nullable already allows either)? Product call on whether "chip in" implies "RSVP going."

---

## 11. Downstream routing

- **Next → DESIGN (`mingla-designer`):** produce the pixel-precise spec for the chip-in section (shared body, 5 surfaces incl. Android opaque-glass delta) + the wizard toggle + inline connect. Embed the result into §4.6 before IMPLEMENT. Worktree: `~/Desktop/mingla-orchs/ORCH-1291-[rsvp-chip-in]/` on branch `ORCH-1291-rsvp-chip-in`.
- **Then → IMPLEMENT (`mingla-implementor`):** build per §8 order + allowlist; do NOT apply the migration or deploy edge fns.
- **Then → orchestrator:** apply migration `20261220000000_orch_1291_*` + deploy `rsvp-contribution-create`, `rsvp-contribution-refund`, redeploy webhook fns; verify with one curl each.
- **Then → TEST (`mingla-tester`):** drive T-1..T-11 incl. the adversarial T-4 (Paystack-ready publish) and live-fire the chip-in on sim + physical device; live-fire the money path against Stripe/Paystack TEST APIs.
- **Then → CLOSE:** flip the 4 `I-PROPOSED-1291-*` invariants ACTIVE; one PR, `gh pr merge --squash --admin`.
