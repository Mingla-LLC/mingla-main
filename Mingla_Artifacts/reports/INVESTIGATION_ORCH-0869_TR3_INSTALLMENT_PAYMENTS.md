# INVESTIGATION — ORCH-0869 [Tr3 Installment Payments]

**Skill:** Claude `mingla-forensics` (INVESTIGATE mode)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Dispatched by:** Claude `mingla-orchestrator` 2026-05-17 post-ORCH-0859 [Tr2 Minimum Viable Trip] CLOSE
**Confidence:** H (proven for the recommendation; suspected for two Open SPEC Questions flagged in §10)

---

## 0. Layman summary

The brief asks: should Mingla build Tr3's installment-payment engine on top of **Stripe Subscription Schedules** (Stripe owns the schedule + retry logic) or on top of **Scheduled PaymentIntents** (we own a daily cron that fires individual PIs per due installment)?

**Recommendation: Scheduled PaymentIntents (Option B).** Five reasons:
1. The existing Mingla checkout architecture (ORCH-0843 direct charges + ORCH-0844 connected-account Customer + ephemeralKey) is already PaymentIntent-shaped — Subscription Schedules would force a parallel invoicing pipeline that doesn't fit.
2. Refund math (Tr4's whole purpose) needs a per-installment ledger row with a 1:1 mapping to a Stripe PI/charge id. Subscription Schedules don't naturally give us that — invoice line items are messier to refund individually.
3. Brief Acceptance Criterion #9 ("after 3 retries with grace period, booking flagged at-risk") requires us to OWN the retry cadence and dunning trigger; Subscription Schedules hands that to Stripe and we'd be reverse-engineering its retry behaviour to fire ORCH-0785 dunning emails at the right times.
4. WeTravel parity on per-installment custom currencies + custom due dates: each PI can carry its own currency; subscriptions pin one currency per schedule.
5. The cron edge function `process-scheduled-installments` is the highest-risk new piece, and it's a 100-line file that calls `stripe.paymentIntents.create` in a loop — much smaller blast radius than introducing Stripe's subscription product/price/invoice graph to a checkout that doesn't currently use it.

There's also an **architectural choice the brief glosses over** that SPEC must lock down: the brief proposes putting `installment_schedule` JSONB on `public.ticket_types.installment_schedule`, but the Tr2 migration `20260608000000_orch_0859_trip_sidecar_tables.sql:94` already reserved `trip_pricing_tiers.tier_metadata` JSONB with an explicit comment: "Tr3 [Installment Payments] will populate tier_metadata = {installments: [...]}." Pick one before writing code.

---

## 1. Investigation method

Phase 0.A live-fire sim gate: **EXEMPT** per dispatch (backend / Stripe-API / migration / edge-function investigation; no UI/runtime surface to repro at this phase). Five-truth-layer cross-check applied per `mingla-forensics` SKILL.md Phase 4.

**Pre-investigation reading completed:**
- Milestone brief `Mingla_Artifacts/milestones/Tr3_INSTALLMENT_PAYMENTS.md` (12 acceptance criteria + 4 hard guards + 11-step smoke test + open polish items)
- WeTravel research `Mingla_Artifacts/reports/RESEARCH_ORCH-0825_WETRAVEL_COMPETITIVE_INGEST.md` §4 Installment Payment Engine (1-24 installments, auto-adjust on late bookings, deposit-on-booking constraint, auto-billing pattern, refund weakness)
- Tr2 implementation report `IMPLEMENTATION_ORCH-0866-AND-0865_TR2_STRUCTURAL_FIX.md` + Tr2 sidecar migration `20260608000000_orch_0859_trip_sidecar_tables.sql`
- Stripe-pivot implementation reports `IMPLEMENTATION_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md` + `IMPLEMENTATION_ORCH-0839-B_STRIPE_HOSTED_CHECKOUT_PIVOT.md`
- Existing Stripe code: `supabase/functions/_shared/stripe.ts` + `supabase/functions/_shared/stripePaymentMethods.ts` + `supabase/functions/_shared/ticketCheckout.ts` + `supabase/functions/ticket-checkout-create/index.ts` (648 lines, full read) + `supabase/functions/stripe-webhook/index.ts` (168 lines, full read)
- Active Stripe invariants: I-PROPOSED-O (Embedded Components via SDK), I-PROPOSED-P (Connect Accounts canonical), I-PROPOSED-Q (API version pinned), I-PROPOSED-R (idempotency-key on every call), I-PROPOSED-S (audit-log on every edge fn), I-PROPOSED-T (country allowlist), I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY, I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST

---

## 2. Stripe API Decision Matrix

| Decision criterion | Stripe Subscription Schedules | Scheduled PaymentIntents (custom cron) |
|---|---|---|
| **Existing architecture fit** | ❌ MISMATCH — Mingla today has no Stripe Products / Prices / Invoices / Subscriptions in any code path. Adding Subscription Schedules requires a parallel pipeline (create Product per trip + Price per tier + Subscription Schedule with phases). 0 reuse of `ticket-checkout-create`. | ✅ STRONG FIT — reuses the exact PaymentIntent + Customer + ephemeralKey + Stripe-Account header + application_fee_amount shape proven by ORCH-0843 direct charges + ORCH-0844 connected-account Customer (ticket-checkout-create:454-647). The deposit PI gets `setup_future_usage:'off_session'` added; future installments are new PI creates with `payment_method` + `off_session:true`. |
| **Refund semantics** (Tr4 dependency) | ❌ Subscription invoice items are refundable but require navigating `invoice → invoice_line_items → charge → refund` to target a specific installment. The whole-subscription cancel pathway is the natural Stripe affordance — single-installment surgical refunds are awkward. | ✅ Each installment = independent PI = independent charge id = `stripe.refunds.create({payment_intent: <pi>})` directly. Per-installment ledger row in `order_installments` carries the `stripe_payment_intent_id` (brief §5 schema explicit). Tr4 refund engine reads ledger + refunds the specific PI. Clean 1:1 mapping. |
| **Multi-currency support** | ❌ Subscription pins ONE currency at creation. Late-changing or per-installment currency = new subscription. WeTravel allows per-package currency variation — Mingla matches via per-PI currency. | ✅ Each PaymentIntent carries its own `currency` arg. Multi-currency support is free — same shape as current `ticket-checkout-create:150` (`currency = session.currency`). |
| **Error recovery / retry control** | ❌ Stripe's smart-retry runs on its own schedule (default: 8 retries over ~3 weeks, configurable in Dashboard). We can listen via webhook but cannot stop Stripe from retrying when WE want to mark booking "at-risk" per brief AC #9. | ✅ Our cron owns it. Brief AC #9 ("after 3 retries with grace period, booking flagged at-risk") = 3 lines of code in `process-scheduled-installments`: count `retry_count >= 3` and write `orders.at_risk=true`. |
| **Dunning email integration** | ❌ Stripe sends its own subscription-failure emails (Hosted Invoice URL etc.) — would either fire ORCH-0785 dunning emails on TOP of Stripe's (duplicate) or require disabling Stripe-side emails via Dashboard (out-of-band config drift risk). | ✅ Cron fires ORCH-0785 dunning email via existing `_shared/email/` pipeline on PI failure. We own the cadence (brief Open Polish §9: "Day-immediate / Day-3 / Day-7" — SPEC locks). |
| **Operator-dashboard ledger fidelity** (brief AC #10 Money tab) | ❌ Subscription invoice + line item state must be reverse-mapped into per-traveler installment status. Multiple Stripe objects per installment. | ✅ `order_installments` row IS the dashboard model. 1:1 with Stripe PI. Status field directly drives "scheduled / collected / failed / refunded / cancelled" pills in the Money tab. |
| **Direct-charge connected-account fit** | ⚠ Subscription Schedules work on connected accounts via Stripe-Account header BUT add complexity in application_fee_amount routing — fees on subscription invoices use `application_fee_percent` (percentage, not amount) and `transfer_data.destination` (NOT direct charges). This conflicts with the post-ORCH-0843 DEC-154 direct-charge-only invariant + CI gate `orch-0843-stripe-direct-charges-only.mjs`. | ✅ Per-installment PI = per-installment direct charge via Stripe-Account header. application_fee_amount = `Math.round(amount * 0.015)` per ORCH-0843 hardcoded rate (ticket-checkout-create:206-209). CI gate already enforces. |
| **Webhook event surface area** | ⚠ Listens for ~8 new event types (`invoice.created`, `invoice.payment_succeeded`, `invoice.payment_failed`, `invoice.upcoming`, `customer.subscription.updated`, `customer.subscription.deleted`, `payment_intent.succeeded`, `payment_intent.payment_failed`). Existing router `_shared/stripeWebhookRouter.ts` would need 8 new handlers. | ✅ Listens for the SAME 2 events already routed by the existing webhook (`payment_intent.succeeded`, `payment_intent.payment_failed`). Router adds metadata-discriminator logic to route installment PIs to the installment-finalize path (vs the existing ticket-checkout-finalize). |
| **Idempotency** (I-PROPOSED-R) | ✅ Stripe subscriptions are natively idempotent on `subscription_schedules.create` with idempotency-key. | ✅ Each PI create carries `idempotencyKey: \`installment:${order_id}:${ordinal}\``. Cron is safe to run twice on same installment without double-charging. Brief Regression Test #4 directly demands this. |
| **Active-invariant preservation** | ❌ I-PROPOSED-Q (API version pinned via shared client only) — subscription schedules pin to Stripe products + prices that may have catalog-version interactions. ⚠ I-PROPOSED-V (notifications via shared dispatcher) — Stripe-side subscription emails are NOT via dispatcher. | ✅ All Stripe invariants preserved as-is. PI shape doesn't change. |
| **Migration cost** | ❌ HIGH — `stripe_products` + `stripe_prices` + `stripe_subscriptions` + `stripe_invoices` tables OR fully-deferred-to-Stripe (no local mirror) + dashboard scraping. Either way, Tr4 refund engine needs a local invoice-line-item mirror to compute refunds. | ✅ LOW — `order_installments` ledger (per brief §5 SQL) + 1 column add (`ticket_types.installment_schedule` JSONB OR `trip_pricing_tiers.tier_metadata.installments` — see Open Question O-1 below) + nothing else. |
| **Testability with Stripe test clock** | ✅ Subscription Schedules + test clock works (Stripe explicitly supports). | ✅ Test clock works on connected-account customers — `customer.test_clock` argument creates the clock; advancing fires due PIs. SPEC must require live-fire on a connected test account. |

**Recommendation: Option B — Scheduled PaymentIntents.**

---

## 3. WeTravel Comparison

Per dispatch §2 and RESEARCH §4. Mingla 1.2 Tr3 matches WeTravel on the core engine and beats them on two operator-facing dimensions:

**Matched (WeTravel parity):**
- 1-24 installments per booking (Option B supports any N; UI limit is operator choice, SPEC sets reasonable cap e.g. 12)
- Custom dates per installment (PI scheduled at `due_at timestamptz`)
- Deposit always at booking, undelayable (brief Hard Guard; enforced by `ticket-checkout-create` paths that already charge at booking)
- Auto-billing via saved PaymentMethod (Option B uses `setup_future_usage:'off_session'` on deposit PI + saved PM on connected-account Customer)
- Auto-adjust on late bookings (custom logic in `process-scheduled-installments`: if `now() > installments[i].due_at` for some i, redistribute the missed amount across remaining installments)
- Reminder emails before due date (Open Polish §9 dunning cadence; ORCH-0785 dispatcher reused)

**Beat WeTravel:**
1. **Operator awareness when installments fail.** WeTravel surfaces failed payments only via the participant's view; the organizer must check Manage Trip per participant. Mingla's `order_installments.status='failed'` + `orders.at_risk=true` flag both light up in the operator dashboard Money tab (brief AC #10). Plus ORCH-0785 dunning email fires automatically (WeTravel sends generic reminder; Mingla sends Resend-templated branded email).
2. **Refund engine** — Tr4 will read this ledger and auto-compute the refund per the declared cancellation policy. WeTravel requires manual operator math (per RESEARCH §5: "WeTravel does NOT have a cascading-tier refund engine ... the organizer must do this math themselves and enter the amount manually"). This Mingla advantage is contingent on Option B (per-installment ledger gives Tr4 the structured data to compute against).
3. **Plan cancellation flexibility** — WeTravel cannot cancel an active payment plan (RESEARCH §4 "Plan modifications"). Mingla's per-installment ledger allows cancellation of remaining scheduled installments without affecting collected ones (clean status flip `scheduled → cancelled`).

**Open polish items that SPEC must lock down** (carried over from brief §9 + RESEARCH §4 inferences):
- Dunning cadence (RESEARCH §4 notes WeTravel's specific retry cadence is "not publicly documented"; Mingla picks: Day-immediate, Day-3, Day-7, then `at_risk` flag).
- Grace period before "at risk" (brief proposes 7 days; SPEC affirms or amends).
- "Pay early" support (RESEARCH §4 silent on whether WeTravel supports voluntary early-payment; brief §9 open). Recommendation: defer to a future ORCH; not blocking.
- Currency mixing (RESEARCH §3 confirms WeTravel supports multi-currency at checkout; Option B's per-PI currency carries this for free; SPEC locks "schedule currency = trip currency at publish; no mixing per schedule, multi-currency across schedules OK").

---

## 4. Recommended Option — Scheduled PaymentIntents (Option B)

### Six-field evidence

| Field | Content |
|---|---|
| **File + line** | `supabase/functions/ticket-checkout-create/index.ts:454-518` (existing PaymentIntent create on connected account with idempotency + application fee + payment_method_types allowlist) + `:564-626` (Customer + ephemeralKey on connected account, ORCH-0844). |
| **Exact code** | `paymentIntent = await stripe.paymentIntents.create(piCreateBody, { idempotencyKey: \`ticket_checkout:${checkoutSessionId}\`, stripeAccount: stripeAccountId })` (line 491). Customer create on connected account at line 581. |
| **What it does now** | Creates a single PI per buyer at booking; saves checkout session row; provisions Customer+ephemeralKey on connected account; returns clientSecret + customerEphemeralKeySecret for the mobile SDK. NO PaymentMethod is saved for future use. |
| **What it should do (Tr3)** | (a) Conditional addition `piCreateBody.setup_future_usage = "off_session"` when the trip's `installment_schedule` is non-null. (b) New cron-scheduled edge function `process-scheduled-installments` runs daily, queries `order_installments WHERE status='scheduled' AND due_at <= now()`, creates a new PI per row with `payment_method: <saved-pm-id from buyer's connected-account Customer>`, `customer: <connected-account-customer-id>`, `confirm: true`, `off_session: true`, `stripeAccount: stripeAccountId`, `application_fee_amount: Math.round(amount * 0.015)`. (c) On `payment_intent.succeeded` webhook for installment metadata, write `order_installments.status='collected', collected_at=now()`. On `payment_intent.payment_failed`, write `status='failed', failed_at=now(), retry_count++` AND fire ORCH-0785 dunning email AND if `retry_count >= 3` write `orders.at_risk=true`. |
| **Causal chain** | Reusing the existing PI architecture → preserves ALL 5 brief Hard Guards (no card details stored locally — only `stripe_payment_intent_id`; tax-on-PI deferred per ORCH-0804-A; idempotency; direct charges + application_fee_amount per ORCH-0843; trips-only feature guard via UI + RPC validation) → satisfies 12/12 brief Acceptance Criteria (see §5 mapping) → preserves ALL active Stripe invariants → enables Tr4's refund engine with clean per-installment refund targeting → matches WeTravel parity AND beats WeTravel on operator-awareness + refund automation + plan-cancellation flexibility. |
| **Verification step** | SPEC §7 implementation order MUST start with migration + cron edge function in Stripe test mode BEFORE building UI (brief §10 Pipeline Notes: "build it first and prove it works with Stripe test clock"). Test gate: provision a Stripe test clock customer on a connected test account; create a 3-installment order via the test path; advance time 30 days; assert installment #2 PI fires + succeeds + ledger writes; advance another 30 days; swap the saved PM to test card `4000 0000 0000 0341` (auth required fail); assert installment #3 fires + fails + dunning email fires + at_risk=true after 3 retries. This is brief Smoke Test §2 steps 5-11 made into a regression test. |

---

## 5. 12-Acceptance-Criterion Mapping

| AC # | Brief criterion | Option B implementation |
|---|---|---|
| 1 | Trip wizard pricing step gains "Payment plan" sub-section with "Full price" / "Installments" toggle | New component `PaymentPlanEditor.tsx`; conditional render inside `TripCreatorStep4Pricing.tsx`. Toggle stored on local draft state; persisted on publish into `installment_schedule` JSONB. |
| 2 | Installment config UI: deposit % + N installments + due-date offsets OR fixed dates | `PaymentPlanEditor.tsx` props: `value: InstallmentSchedule | null`, `onChange`. UI emits the JSONB structure: `{ deposit_pct: 25, installments: [{ ordinal: 1, days_after_booking: 30, pct: 37.5 }, ...] }`. Validation: `deposit_pct + sum(installments[].pct) === 100`. |
| 3 | `ticket_types.installment_schedule` JSONB column stores `{deposit_pct, installments:[{ordinal, days_after_booking OR fixed_date, pct}]}` | **Open Question O-1 in §10:** brief says `ticket_types.installment_schedule`; Tr2 migration reserved `trip_pricing_tiers.tier_metadata.installments`. SPEC must pick one. Recommendation: `trip_pricing_tiers.tier_metadata.installments` (Tr2 already reserved + keeps trip-specific config off shared `ticket_types`). |
| 4 | `order_installments` ledger table with full per-installment row per order | New migration. Schema per brief §5. RLS: buyer reads own; brand members read all on their events. Indexes per brief. |
| 5 | At checkout, buyer sees full schedule with amounts + dates | New component `InstallmentScheduleDisplay.tsx`; rendered inside `TripCheckoutFlow.tsx` (Tr2 file already exists; reuse pattern) AND inside the `/checkout/{eventId}/index.tsx` ticket selection screen. |
| 6 | Stripe SetupIntent attached to PaymentIntent on initial booking; saves card for future charges | Add `setup_future_usage: "off_session"` to PI create body in `ticket-checkout-create:463-498` when schedule is non-null. PaymentMethod is saved to the connected-account Customer (ORCH-0844 already provisions Customer). |
| 7 | Cron-scheduled edge function `process-scheduled-installments` runs daily, charges due installments | New file `supabase/functions/process-scheduled-installments/index.ts`. Scheduled via Supabase cron (TBD in SPEC: pg_cron vs Vercel cron vs Stripe webhook on `invoice.upcoming`). Recommendation: **pg_cron** running every 6 hours invokes the edge function (lower-cost than webhook-driven; idempotent loop is safe to run hourly if SPEC chooses higher cadence). |
| 8 | Failed installment writes `status='failed'`, fires dunning email via Resend | Webhook handler `handleInstallmentPaymentFailed` in `stripeWebhookRouter.ts` discriminates by metadata `mingla_installment_ordinal` (TBD: SPEC defines metadata schema). Writes status. Fires existing dispatcher pattern. |
| 9 | After 3 retries with grace period, booking flagged "at risk" | Cron logic: on each failed attempt, increment `retry_count`. On retry attempt 3 with `now() > failed_at + 7d` (grace per brief Open Polish), set `orders.at_risk = true`. |
| 10 | Operator dashboard Money tab shows per-traveler installment status | New route `mingla-business/app/trip/[id]/money.tsx` (or as a tab on existing `trip/[id]/index.tsx` per brief §4). Reads `order_installments` joined to `orders`. Per-traveler list with status pill + amount + due_at + next-action ("Retry" button for failed, "Refund" link for collected — but refund is Tr4 scope). |
| 11 | Manual retry from operator dashboard works | New RPC `biz_retry_installment(installment_id uuid)` → triggers `process-scheduled-installments` with that specific row. Returns success/failure. Money tab calls via mutation hook. |
| 12 | Refund engine in Tr4 will read this ledger — schema must support that need | `order_installments` schema explicitly carries `stripe_payment_intent_id`, `collected_at`, `amount_cents`, `currency` per row. Tr4 reads ledger + computes refund per cancellation-policy tier → fires `stripe.refunds.create({payment_intent: <pi>, amount: <computed>})` per-installment OR aggregate. Schema is Tr4-ready. |

All 12 satisfied by Option B.

---

## 6. Cross-Surface Impact Inspection (mandatory per `feedback_cross_surface_impact_inspection.md`)

| Surface | In scope | What changes |
|---|---|---|
| **Business iOS** | YES | New PaymentPlanEditor + InstallmentScheduleDisplay components rendered inside trip wizard Step 4 + trip operator dashboard new "Money" tab. Existing PaymentSheet path for deposit gains `setup_future_usage` config when schedule non-null. |
| **Business Android** | YES | Shared RN source with iOS — same components, same behavior, parity automatic. |
| **Business Web preview** | YES | Shared RN-Web bundle — components render in web preview. Hosted-checkout flow on web buyers uses `payment_intent_data.setup_future_usage` config injection. |
| **Buyer/anonymous Web** | YES | `/checkout/{eventId}/index.tsx` + `/checkout/{eventId}/buyer.tsx` + `/checkout/{eventId}/payment.tsx` gain InstallmentScheduleDisplay above the existing line-item summary. Schedule shown plainly: "$X today + $Y on Jan 15 + $Y on Feb 15". |
| **Consumer iOS / Android** | NO | `app-mobile/` untouched — trips are business-side per Tr2 scope. Consumer-app trip surfacing is a future-track concern. |
| **Admin Web** | NO | `mingla-admin/` untouched — admin doesn't render trip operator tools yet. Future admin trip-ops dashboard is out of scope for Tr3. |

Parity automatic across business iOS + Android + web-preview (shared RN source). Parity manual for buyer-anon-web (separate routes under `app/checkout/` and `app/t/` and `app/e/`) — SPEC must list separate success criteria per buyer-anon route (SC-N-checkout-ticket-step, SC-N-checkout-buyer-step, SC-N-checkout-payment-step) so each route gets its own SafeArea + display + currency parity gate.

---

## 7. Findings (classified)

### 🔴 Root cause / decision-load-bearing findings

**F-1. Scheduled PaymentIntents fit the existing architecture; Subscription Schedules do not.** Six-field evidence in §4 above. This is the load-bearing investigation finding the SPEC will operationalize.

### 🟡 Hidden flaws / SPEC must address

**H-1. Schema-placement ambiguity for `installment_schedule`.** Brief proposes `public.ticket_types.installment_schedule jsonb`. Tr2 migration `20260608000000_orch_0859_trip_sidecar_tables.sql:94` already reserved `public.trip_pricing_tiers.tier_metadata jsonb` with the comment "Tr3 [Installment Payments] will populate tier_metadata = {installments: [...]}." Conflict: two reserved homes for the same JSONB. **SPEC must pick one.** Recommendation: `trip_pricing_tiers.tier_metadata.installments` (Tr2 already reserved + keeps trip-specific scheduling off the shared `ticket_types` table, which is also used by event tickets that explicitly should NOT have installment plans per brief Hard Guard #3). If SPEC picks the `ticket_types` route, the trip_pricing_tiers comment becomes a misleading historical artifact and should be amended.

**H-2. `payment_method_types` allowlist excludes Link for off-session reuse.** Existing allowlist (`stripePaymentMethods.ts:34`) = `["card", "link"]`. Link works for on-session checkout but Stripe Link's off-session reuse semantics (charging without buyer present) are not the same shape as a saved card; SPEC should explicitly state whether installment auto-charges fall back to `card` only when the saved PM is a Link wallet, OR if Link PMs are excluded from installment-plan-eligible flows. Recommendation: SPEC explicitly excludes Link from installment plans v1 (allow card only); Phase 2 can add Link off-session if proven to work.

**H-3. `automatic_tax: { enabled: true }` not on PI path.** Existing `ticket-checkout-create:362` enables automatic_tax on web Hosted Checkout, but the native PI path at :454-518 has the comment "ORCH-0804 / I-PROPOSED-BF — native PaymentIntent path is NOT tax-enabled in v1. Stripe Tax on PaymentIntent requires pre-computing a tax_calculation id via separate POST /v1/tax/calculations call. Material complexity. Deferred to ORCH-0804-A." For Tr3 installments: each installment PI created by the cron will likewise NOT be tax-enabled. **SPEC must declare this is acceptable v1 behavior** (trip tax is the brand's compliance gap, same as the existing deposit PI on native today) AND register the gap as a follow-up: tax-on-installment-PIs lands when ORCH-0804-A is shipped (whichever lands first).

**H-4. Customer + ephemeralKey lifetime.** ORCH-0844 creates a Customer per email per connected account at booking (`ticket-checkout-create:564-626`); the saved PaymentMethod attaches to that Customer when `setup_future_usage` is enabled. **The Customer must persist for the full installment-schedule duration** (could be 6+ months). Stripe Customers are durable, but if Mingla ever introduces a "delete brand → cascade delete connected-account customers" path (no such code exists today, verified by grep), Tr3 installment auto-charges would break for in-flight schedules. SPEC must mandate: **no code path may delete a connected-account Customer that has any `order_installments WHERE status='scheduled'`** AND register `I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY` as a DRAFT invariant flipping to ACTIVE on close, enforced by a CI gate that scans for `stripe.customers.del` or `stripe.customers.update({deleted:true})` calls.

**H-5. Stripe test clock plumbing not in current code.** No existing Mingla edge function references `test_clock`. The implementor will need to provision a test clock on the connected test account, attach the buyer Customer to the clock, and advance time via Stripe API. SPEC should require a test fixture / helper in `supabase/functions/_shared/__tests__/` that encapsulates this for the regression test gate.

### 🔵 Observations

**O-1. ORCH-0843 application_fee_amount rate is hardcoded 0.015 (1.5%).** Per `ticket-checkout-create:206-209`. Each installment PI applies the same rate to its installment amount. This is consistent and correct. Discovery flagged in the source comment for future plumbing through env/brand config; Tr3 inherits the same flag (no new debt).

**O-2. Webhook routing already supports `payment_intent.succeeded` + `payment_intent.payment_failed`.** Per `stripe-webhook/index.ts:136` → `routeStripeEvent`. The router file (`_shared/stripeWebhookRouter.ts`, not read in full but its 14+2 event count is documented) handles these for the ticket-checkout flow. Tr3 needs the router to discriminate by metadata: if PI metadata carries `mingla_installment_id`, route to installment-finalize; otherwise route to existing ticket-checkout-finalize. **Single-router-multiple-discriminator pattern; no new webhook file needed.**

**O-3. ORCH-0844 deposit-saving via `setup_future_usage` is one config line, not architectural.** The existing deposit PI body at `ticket-checkout-create:463-485` is a `Record<string, unknown>`; adding `piCreateBody.setup_future_usage = "off_session"` (conditional on `installment_schedule != null`) is a 2-line change. No restructure required.

**O-4. Existing `idempotencyKey` pattern carries over naturally.** Pattern: `\`installment:${order_id}:${ordinal}\`` for installment PIs. Cron is safe to re-run on a row that already has `stripe_payment_intent_id` set — the Stripe API returns the existing PI rather than creating a duplicate.

**O-5. ORCH-0852 fire-and-forget confirm pattern is reusable.** The existing buyer-side post-payment confirm uses a 3-second client-side timeout per `payment.tsx` comment + ORCH-0852 SPEC §M0. For installment auto-charges (no buyer present), this pattern doesn't apply — webhook is the only confirm path. SPEC should state explicitly that the installment cron does NOT block on PI status; it fires-and-forgets and trusts the webhook to write the ledger row.

---

## 8. Five-Layer Cross-Check

| Layer | Truth |
|---|---|
| **Docs** | Brief `Tr3_INSTALLMENT_PAYMENTS.md` proposes ledger + cron + dunning. WeTravel research §4 confirms market-standard mechanics. Stripe API docs (Subscription Schedules and PaymentIntents with setup_future_usage) both support the use case. |
| **Schema** | `public.ticket_types` exists (per Tr2 baseline). `public.trip_pricing_tiers.tier_metadata jsonb` reserved for Tr3 per Tr2 migration. `public.events`, `public.event_dates`, `public.orders` exist. NO `order_installments` table exists yet (verified — `grep "order_installments" supabase/migrations/` returns 0 in current chain). RLS pattern `biz_is_brand_member_for_read_for_caller(brand_id)` proven for Tr2. |
| **Code** | `ticket-checkout-create` shape proven (648 lines, full read). Stripe shared helpers complete (`stripe.ts`, `stripePaymentMethods.ts`, `ticketCheckout.ts`). Webhook routing extensible via metadata discrimination (verified by `stripe-webhook/index.ts` routing through `_shared/stripeWebhookRouter.ts`). NO existing installment-related code (verified — `grep -rn "installment" supabase/functions/` returns only the brief itself). |
| **Runtime** | Existing Stripe Connect direct-charge flow works in production (per ORCH-0843 + ORCH-0844 + ORCH-0849 + ORCH-0852 closes). Webhook processing idempotent via `payment_webhook_events` table (`stripe-webhook/index.ts:88-132`). |
| **Data** | Live DB has `orders` table populated; `ticket_types` populated; `trip_pricing_tiers` recently shipped (post-Tr2). 0 rows in any installment table (none exist). |

**No layer contradictions.** All five layers consistent on the recommendation: Option B is the natural fit. Layer disagreements would have flagged a bug; none flagged.

---

## 9. Blast Radius Map

**New files (per Option B):**
- `supabase/migrations/<timestamp>_tr3_installments.sql` — `order_installments` table + RLS + indexes + 1 column on `trip_pricing_tiers` OR `ticket_types` (Open Q O-1)
- `supabase/functions/process-scheduled-installments/index.ts` — daily cron edge function
- `supabase/functions/process-scheduled-installments/__tests__/*.test.ts` — Deno tests for the cron loop + idempotency + stripe-clock fixture
- `supabase/functions/_shared/email/installmentDunningEmail.ts` — Resend template (modeled after existing `tripConfirmationEmail.ts` shape)
- `mingla-business/src/components/trip/PaymentPlanEditor.tsx`
- `mingla-business/src/components/trip/InstallmentScheduleDisplay.tsx`
- `mingla-business/app/trip/[id]/money.tsx` (OR new tab on `[id]/index.tsx` — brief §4 leaves choice open)
- `mingla-business/src/hooks/useOrderInstallments.ts` (React Query hook)
- `mingla-business/src/services/orderInstallmentsService.ts`
- Multiple test files per the brief regression-test scope

**Modified files:**
- `mingla-business/src/components/trip/TripCreatorStep4Pricing.tsx` — render PaymentPlanEditor below price input
- `mingla-business/src/services/tripCheckoutService.ts` — pass schedule to checkout
- `mingla-business/src/components/trip/TripCheckoutFlow.tsx` — render InstallmentScheduleDisplay
- `mingla-business/app/checkout/[eventId]/index.tsx` + `buyer.tsx` + `payment.tsx` — render InstallmentScheduleDisplay above line-item summary
- `supabase/functions/_shared/ticketCheckout.ts` — add `setup_future_usage` parameter to PI create helper (if extracted into helper; currently inline)
- `supabase/functions/ticket-checkout-create/index.ts` — add `setup_future_usage: "off_session"` conditional on schedule presence; add metadata `mingla_installment_root_order_id` to the deposit PI for webhook discrimination
- `supabase/functions/_shared/stripeWebhookRouter.ts` — add `handleInstallmentPaymentSucceeded` + `handleInstallmentPaymentFailed` paths discriminated by PI metadata
- `mingla-business/src/store/tripDraftStore.ts` — extend draft state with `installmentSchedule` field
- Likely a new RPC `biz_retry_installment(installment_id uuid)` in a new migration

**Impact on adjacent flows:**
- Non-installment trip checkout (legacy single-payment): MUST remain unchanged (brief Regression Test #2). Achieved by conditional `setup_future_usage`.
- Non-installment event checkout (existing ticket-checkout-create today): unchanged. Hard Guard #3 limits installments to trips (event_type='trip') via UI + RPC validation.
- Failed deposit at booking: existing rollback behavior must remain — no `order_installments` rows are written (brief Regression Test #3). Achieved by writing `order_installments` rows ONLY from the finalize RPC after the deposit PI succeeds.

---

## 10. Open SPEC Questions

**O-1. Schema placement: `ticket_types.installment_schedule` (brief) vs `trip_pricing_tiers.tier_metadata.installments` (Tr2 reserved)?**
- Recommend `trip_pricing_tiers.tier_metadata.installments`. SPEC locks; if alternate, brief amendment required.

**O-2. Cron mechanism: pg_cron (Supabase built-in) vs Stripe webhook on `invoice.upcoming` (would require Stripe subscriptions, contradicts Option B) vs external cron (Vercel / GitHub Actions)?**
- Recommend pg_cron invoking the edge function every 6 hours; idempotency makes hourly safe if SPEC prefers tighter SLA.

**O-3. Dunning cadence per brief §9 (Day-immediate / Day-3 / Day-7?).** SPEC locks. Recommendation: Day-immediate + Day-3 + Day-7, then `at_risk=true`.

**O-4. "Pay early" voluntary buyer-initiated payment of remaining installments. Brief §9 open.**
- Recommend: defer to a future ORCH (Tr3.x or post-Tr-launch polish). Not blocking v1.

**O-5. Currency mixing.** Recommendation: SPEC locks "schedule currency = trip currency at publish; cannot mix currencies within one schedule; different schedules can be different currencies." Matches WeTravel + Option B per-PI capability.

**O-6. Installment count cap.** WeTravel allows 1-24. Brief doesn't specify. Recommendation: SPEC locks at 12 (1 deposit + 11 future installments) as a reasonable v1 limit; raise via future ORCH if operators request.

**O-7. UI placement: new `trip/[id]/money.tsx` route vs new tab on `trip/[id]/index.tsx`?** Brief §4 leaves open. Recommendation: new tab on the existing dashboard (matches the existing Overview / Travelers tab pattern already shipped in Tr2 per `mingla-business/app/trip/[id]/index.tsx:196-217`). Saves a route file; consistent with operator's mental model of "all trip ops live on the trip dashboard."

**O-8. Retry mechanism for failed installments — Stripe Smart Retries (Dashboard config) vs custom cron retry vs both?**
- Recommend: Mingla cron-driven retry only. Disable Stripe's PaymentMethod-level smart-retries on the platform account or rely on it being already-disabled for one-off PIs (only Subscription invoices get smart-retried by default; one-off PIs do NOT). Cron retries on Day-1 fail + Day-3 fail + Day-7 fail → if all 3 fail, `at_risk=true` per brief AC #9.

---

## 11. Invariant Violations / Preservations / New Invariants

**Preserved by Option B (no violations):**
- I-PROPOSED-O — STRIPE-EMBEDDED-COMPONENTS-VIA-OFFICIAL-SDK-ONLY (Tr3 doesn't add embedded components)
- I-PROPOSED-P — STRIPE-STATE-CANONICAL-IS-CONNECT-ACCOUNTS (PI on connected account preserves)
- I-PROPOSED-Q — STRIPE-API-VERSION-PINNED-VIA-SHARED-CLIENT-ONLY (use `stripeTicketCheckout()` helper)
- I-PROPOSED-R — STRIPE-IDEMPOTENCY-KEY-ON-EVERY-CALL (installment PI carries `installment:${order_id}:${ordinal}`)
- I-PROPOSED-S — STRIPE-AUDIT-LOG-ON-EVERY-EDGE-FN (cron writes audit row via `writeAudit`)
- I-PROPOSED-T — STRIPE-COUNTRY-FROM-CANONICAL-ALLOWLIST-ONLY (no new country logic)
- I-PROPOSED-STRIPE-PAYMENTSHEET-PARITY (Tr3 doesn't touch PaymentSheet config)
- I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST (installment PIs use same allowlist; v1 explicitly card-only per H-2)
- I-PROPOSED-J — ZUSTAND-PERSIST-NO-SERVER-SNAPSHOTS (no Zustand changes)
- I-PROPOSED-TR2-SAFEAREA-ON-FULLSCREEN-ROUTES (new screens MUST follow — SPEC mandates `<SafeScreen>` wrap or allowlist with reason)
- I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE (no new tap-handlers route to /event/{id} or /trip/{id} unless via `routeForEventRow` helper)

**New invariants proposed (DRAFT → ACTIVE at close):**

1. **`I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER`** — Installment PaymentIntent creation may ONLY originate from `process-scheduled-installments` edge function and the manual-retry RPC `biz_retry_installment`. Any other call site that creates a PI on behalf of `order_installments` is FORBIDDEN. CI gate: scan for `stripe.paymentIntents.create(...)` calls with `off_session: true` outside the allowlisted file paths.

2. **`I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY`** — No code path may delete a connected-account Stripe Customer that has any `order_installments` rows with `status='scheduled'`. CI gate: scan for `stripe.customers.del(` or `stripe.customers.update({..., deleted:true})` calls; allowlist only paths that pre-check the dependency.

3. **`I-PROPOSED-TR3-LEDGER-INVARIANT-COLLECTED-IMPLIES-PI-ID`** — `order_installments.status='collected'` rows MUST have non-null `stripe_payment_intent_id` AND non-null `collected_at`. CHECK constraint or trigger enforces. Pure DB invariant.

4. **`I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH`** — All `order_installments` rows for a given `order_id` MUST share `currency`. SPEC enforces via SQL trigger OR row-count assertion in the publish RPC.

---

## 12. Confidence Level

**H (High) — proven** for the recommendation (Option B):
- All 5 truth layers cross-checked; no contradictions
- Six-field evidence on the recommendation
- Existing architecture path is proven via Tr2 close + ORCH-0843 + ORCH-0844 + ORCH-0849 + ORCH-0852 (all closed and shipped)
- WeTravel parity dimensions documented from primary research

**M (Medium) — probable** for the Open SPEC Questions §10:
- 8 questions surfaced; recommendations given for each; SPEC phase locks final answers after operator review of the cron-mechanism + schema-placement tradeoffs

**L (Low) — suspected** for:
- Stripe Link off-session reuse semantics (H-2 deferred to v1 exclusion)
- Auto-adjust behavior for late bookings (RESEARCH §4 documents WeTravel does it but algorithm undocumented; brief is silent; SPEC must invent reasonable algorithm)

---

## 13. Discoveries for Orchestrator

1. **ORCH-0867 + ORCH-0868 follow-ups STILL not registered** in WORLD_MAP (carried from ORCH-0859 close — orchestrator deferred to a follow-up sync pass). Tr3's SPEC will mention them in cross-cutting context; SPEC dispatch should remind orchestrator.
2. **Tr4 (refund engine) hard dependency on Tr3 ledger schema.** This investigation's recommendation locks the per-installment PI shape; Tr4 will read that. Worth a flag in WORLD_MAP for Tr4 milestone tracking.
3. **ORCH-0804-A (Stripe Tax on native PaymentIntent path)** remains deferred per H-3. Tr3 installment PIs inherit the same tax gap. If ORCH-0804-A lands during Tr3 build, the installment PI tax integration is essentially free (one shared helper). If ORCH-0804-A lands after Tr3, a Tr3.x cleanup adds it.
4. **No `stripe-best-practices` skill exists** in `.claude/skills/` (operator asked if needed; confirmed absent). Investigation proceeded with the existing Stripe code as the canonical pattern source.
5. **pg_cron extension status not verified live.** SPEC must confirm pg_cron is enabled on the Mingla Supabase project (or arrange an alternative cron mechanism). Verifiable via `mcp__supabase__list_extensions`.
6. **Brief Hard Guard #3 ("Don't allow installment plans on events (event_type='event') for now")** — UI guard alone is insufficient; SPEC must also enforce at the publish RPC (`biz_trip_publish_*` or equivalent) so no API client can bypass.

---

## 14. Pipeline next

This investigation feeds the SPEC phase. Per dispatch §6:

1. **Operator reads §2 decision matrix + §4 recommendation + §10 open questions** and locks (a) Option A or B (recommendation: B), (b) answers to O-1 through O-8.
2. **Claude `mingla-forensics` SPEC** writes `Mingla_Artifacts/specs/SPEC_ORCH-0869_TR3_INSTALLMENT_PAYMENTS.md` with full success criteria + acceptance test matrix + the 4 new invariants in DRAFT.
3. **Codex `implementor-mingla`** implements in brief order: migration + cron in Stripe test mode FIRST → UI second.
4. **Claude `mingla-tester`** RETEST with Stripe test clock + 11-step Smoke Test as the gate.
5. **Claude or Codex `mingla-orchestrator`** CLOSE with one-PR-per-CLOSE.

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. SPEC file lives in `Mingla_Artifacts/specs/`.
