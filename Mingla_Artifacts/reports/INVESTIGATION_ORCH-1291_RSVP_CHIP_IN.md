# INVESTIGATION — ORCH-1291 [rsvp-chip-in]

v1 build unit of META-ORCH-1290 [chip-in contributions].
Phase: INVESTIGATE (proves current reality; proposes NO fix — the SPEC formalizes).
Worktree: `~/Desktop/mingla-orchs/ORCH-1291-[rsvp-chip-in]/` on branch `ORCH-1291-rsvp-chip-in` (rebased on origin/main `359ce621a`).
Author: mingla-forensics (Claude). Date: 2026-07-03.
Confidence: **proven** at Docs/Schema/Code/Data layers (verbatim citations + live read-only DB probe); Runtime confirmed by shared-component code + live schema (greenfield feature — no reproducer-bound bug to drive; see Repro Evidence).

Comms-ledger acks (WARN, factored into this turn): COMMS-0040 (public RSVP page consolidation — see F-5), COMMS-0003 (external-API doc URLs cited inline — carried into the SPEC).

---

## 1. Symptom summary (expected vs actual)

This is a **feature investigation**, not a bug. "Expected" = the v1 contract Seth locked; "Actual" = what the code does today.

| | Locked v1 contract | Current reality |
|---|---|---|
| RSVP chip-in | Guest RSVPs free, then can OPTIONALLY "chip in" a voluntary gift amount | RSVP is strictly free; `event_rsvps` has zero payment columns; publish RPC soft-deletes any ticket rows |
| Tax on chip-in | ZERO tax (voluntary gift), contribution-style receipt | No zero-tax "gift" basis exists; ticket path runs Stripe Tax / NG config-VAT |
| Mingla cut | Still taken (application_fee) | `application_fee_amount = miglaFeeCents` ALWAYS on the ticket path — reusable |
| Rails | BOTH Stripe (Connect direct-charge) + Paystack (NGN) | Both exist for TICKETS only; neither wired to RSVP |
| Bank connect | Inline from the toggle screen | Onboarding sub-flows exist (Stripe embedded + Paystack subaccount form); RSVP publish is NOT bank-gated |

---

## 2. Investigation manifest (files read, in trace order)

| # | File / object | Layer | Why |
|---|---|---|---|
| 1 | `Mingla_Artifacts/reports/FEASIBILITY_chip_in_contributions.md` | docs | Prior feasibility — hypotheses to verify |
| 2 | `COMMS_LEDGER.md` (COMMS-0040, 0003, 0044) | docs | RSVP-page consolidation + external-API-doc rules |
| 3 | `supabase/functions/_shared/allInPricingEngine.ts` (full) | code | Money-math owner (Constitution #2) — the no-tax hook |
| 4 | `supabase/migrations/20261004000000_orch_1150_rsvp_events.sql` | schema | `event_rsvps` DDL + `business_publish_rsvp_draft` + wall |
| 5 | `supabase/migrations/20261114000000_orch_1172_r2_rsvp_edit_hide_address.sql` | schema | Latest publish-RPC redefinition |
| 6 | `supabase/functions/public-submit-rsvp/index.ts` | code | Anon RSVP write |
| 7 | `supabase/functions/ticket-checkout-create/index.ts` (Paystack arm 616-806, Stripe arm 806-1544) | code | Both money rails + tax-basis branch |
| 8 | `supabase/functions/paystack-checkout-create/index.ts` | code | Confirm it is a TEST harness, not prod path |
| 9 | `supabase/functions/paystack-webhook/index.ts` + `_shared/paystackWebhookRouter.ts` | code | NG finalize path |
| 10 | `supabase/functions/_shared/paystack.ts` | code | Subaccount + transaction_charge + bearer split |
| 11 | `supabase/functions/_shared/stripeWebhookRouter.ts` (routed events) | code | Stripe finalize hook point |
| 12 | `supabase/functions/refund-order/index.ts` | code | Refund scope (order-only) |
| 13 | `supabase/migrations/20260911000000_orch_1075_...` + `20260927000000_orch_1116_booking_gate_rls.sql` | schema | `pg_brand_can_charge` (latest def) |
| 14 | `mingla-business/src/utils/paidPublishGuards.ts` | code | Fail-close guard copy + route |
| 15 | `packages/offering-rendering/RsvpOfferingBody.tsx` + consumer/business importers | code | Shared public body — UI insertion point |
| 16 | Live prod DB (read-only, `gqnoajqerqhnvulmnyvv`) | data | Schema + data truth |

---

## 3. Q-scorecard

- **Q1** — Can a buyer-named contribution run through `allInPricingEngine` at `tax_cents = 0` (genuine gift, not "absorbed"), still charge Mingla's `application_fee`, on BOTH rails, WITHOUT altering the ticket path's tax? **Verdict: YES — engine reuse, one new `TaxBasis` enum member, caller skips the tax round-trip. No divergent money path. (proven, F-1)**
- **Q2** — Is `event_rsvps` payment-free and does the publish RPC preserve the no-ticket wall? **Verdict: YES — zero payment columns (schema + live data); publish RPC soft-deletes stray `ticket_types`. Contributions MUST be a new child table. (proven, F-2)**
- **Q3** — How does an NGN contribution charge on the brand's Paystack account with Mingla's cut, and how does its webhook finalize? **Verdict: `subaccount` + `transaction_charge = miglaFee` on initialize; webhook router needs a contribution branch → new finalize RPC (no order minted). (proven, F-3)**
- **Q4** — Is free RSVP bank-gated today, and what must change? **Verdict: NOT gated (publish RPC removes stripe gates). Gating must be PROVIDER-AWARE — `pg_brand_can_charge` is Stripe-only and would wrongly block Paystack brands. (proven, F-4)**
- **Q5** — Where does the shared public RSVP body live now, and does the UI reach all surfaces? **Verdict: `packages/offering-rendering/RsvpOfferingBody.tsx` — consumed by consumer app + business + buyer-web. COMMS-0040 consolidation SHIPPED. Chip-in UI lands there. (proven, F-5)**
- **Q6** — Are the RSVP write + checkout anon-capable? **Verdict: YES — `public-submit-rsvp` verify_jwt=false; ticket checkout has an anon guest path. Anon web chip-in is consistent. (proven, F-6)**
- **Q7** — Refund + cancellation path for a contribution? **Verdict: `refund-order` is order-scoped only — contributions need their own refund RPC + a cancellation policy. (proven gap, F-7)**
- **Q8** — Receipt semantics for a gift? **Verdict: gift/contribution receipt, NOT a tax invoice; the new `TaxBasis` self-describes; `tax_cents=0` makes passed+absorbed tax both 0. (proven, F-8)**
- **Q9** — Safe migration version prefix? **Verdict: frontier across worktrees = `20261210000000_orch_1278`; use `20261220000000_orch_1291_*`. (proven, F-9)**
- **Q10 (NOTIFY)** — Finance/legal: can a for-profit organiser's "voluntary" chip-in cleanly be zero-taxed? **Verdict: YES for v1 BECAUSE it is optional — attendance is free, so the payment is not consideration for a taxable supply. Required-mode (reserved) would flip it to consideration. Flagged. (F-10)**
- **Q11 (NOTIFY)** — Product fork: does the guest pay processing fees on top of the gift, or does the organiser absorb them? **Verdict: recommend ORGANISER ABSORBS (guest charged exactly the amount typed — WYSIWYG gift); Mingla still takes its application_fee. Flagged. (F-11)**

---

## 4. Findings (six-field evidence)

### F-1 — The no-tax path is a clean engine REUSE, not a divergent money path  [CONFIRMED — Q1]
- **Symptom (contract need):** a buyer-named contribution must yield `tax_cents = 0` (real gift) while still charging Mingla's cut, on both rails, without touching the ticket path's tax.
- **Layer:** code.
- **Probe:** read `allInPricingEngine.ts` in full; read `ticket-checkout-create/index.ts` tax block (lines 1400-1544) and Paystack arm (686-698).
- **Evidence (verbatim):**
  - `allInPricingEngine.ts:221-281` — `buildPricingBreakdown({ ..., amountTotalCents, taxCents, taxBasis, stripeTaxCalculationId })` takes `taxCents` and `taxBasis` as **caller inputs**; the engine never computes tax.
  - `allInPricingEngine.ts:238` — `const applicationFeeAmountCents = miglaFeeCents;` with comment "application_fee_amount is ALWAYS the Mingla fee ... regardless of pass/absorb." Mingla's cut is independent of tax.
  - `allInPricingEngine.ts:260-269` — when `taxCents` is 0, both `passed.tax_cents` and `absorbed.tax_cents` resolve to 0 (gift-clean partition).
  - `ticket-checkout-create/index.ts:1446-1447` and `1519-1520` — an EXISTING zero-tax branch: `taxCalculation = { id:"", amount_total: taxAmountCents, tax_breakdown: [] }; taxBasis = "unresolved_flat_absorb";` then `if (taxBasis !== "venue_resolved") { taxCents = 0; }` — the buyer is charged `buyerSubtotal` with **no Stripe Tax round-trip**, application_fee still applied.
  - `ticket-checkout-create/index.ts:687-698` (Paystack) — `computeConfigVat(subtotal, vat_rate_bps, pass_tax)`; passing `vat_rate_bps = 0` yields `taxCents = 0, buyerTotal = subtotal`.
  - `allInPricingEngine.ts:51-58` — `TaxBasis` is a closed union; adding one member (`"voluntary_contribution"`) is the ONLY engine change needed.
- **Mechanism:** the engine already partitions a caller-supplied `taxCents`; a contribution simply (a) skips the Stripe `tax.calculations.create` call, (b) passes `taxCents = 0` + a new self-describing `taxBasis`, (c) keeps `application_fee = miglaFeeCents`. Same for Paystack with `vat=0`. This is REUSE of the single money owner — no parallel math path, so Constitution #2 holds.
- **Severity:** CONFIRMED ROOT MECHANISM (this is the decision the highest-risk fork turns on).

### F-2 — The RSVP payment-free wall is real and enforced; contributions must be a child table  [CONFIRMED — Q2]
- **Symptom:** contributions must not add price columns to `event_rsvps` (invariant I-PROPOSED-1150-RSVP-NO-TICKET-ROWS).
- **Layer:** schema + data.
- **Probe:** `awk` the `event_rsvps` DDL; grep for payment ALTERs; read `business_publish_rsvp_draft`; live `information_schema.columns` query.
- **Evidence (verbatim):**
  - `20261004000000_orch_1150_rsvp_events.sql` (CREATE TABLE `event_rsvps`) — columns: `id, event_id, user_id, guest_name, guest_email, guest_phone, rsvp_status, approval_status, plus_count, waitlisted_at, promoted_at, notified_at, created_at, updated_at`. **No price/currency/payment column.**
  - Same file, lines 623-626: `-- An RSVP creates ZERO ticket_types (I-PROPOSED-1150-RSVP-NO-TICKET-ROWS). Defensive: soft-delete any stray ticket rows ... UPDATE public.ticket_types SET deleted_at = v_now ... WHERE event_id = p_event_id AND deleted_at IS NULL;`
  - Lines 367-369: publish RPC "Removes ticket / city / stripe gates ... creates ZERO ticket_types."
  - **Live prod (read-only):** `event_rsvps` columns = the 14 above + `qr_token_hash, qr_code` (orch-1206) — still ZERO payment columns. No table matching `%contribution%` exists.
- **Mechanism:** the wall is enforced at both DDL and publish-RPC level; putting an amount on `event_rsvps` would violate the invariant and get soft-deleted logic tangled with the money path. Contributions therefore live in a NEW `event_rsvp_contributions` child table.
- **Severity:** CONFIRMED (binding constraint on the schema design).

### F-3 — Paystack contribution leg: subaccount + flat transaction_charge = Mingla cut; webhook needs a contribution branch  [CONFIRMED — Q3]
- **Symptom:** an NGN chip-in must charge on the brand's Paystack subaccount, route Mingla's cut, and finalize a contribution row (not an order).
- **Layer:** code.
- **Probe:** read `paystack.ts`, `paystackWebhookRouter.ts`, the Paystack arm of `ticket-checkout-create`, `paystack-checkout-create` (harness).
- **Evidence (verbatim):**
  - `_shared/paystack.ts:74-103` — `paystackInitializeTransaction` accepts `subaccount`, `transactionChargeSubunits` (`body.transaction_charge = ... // flat kobo to main (Mingla) account`), `bearer: "account"|"subaccount"`.
  - `_shared/paystack.ts:145-147` — "Mingla's per-txn cut rides as the flat `transaction_charge` on initialize ... which OVERRIDES the subaccount percentage_charge." Doc: https://paystack.com/docs/api/subaccount/
  - `ticket-checkout-create/index.ts:699` — `const psApplicationFeeCents = psSubtotal.miglaFeeCents;` (the cut), passed to the session; `:770-772` passes `subaccount: pricing.paystack_subaccount_code`.
  - `paystackWebhookRouter.ts:139-158` — `charge.success` → looks up `ticket_checkout_sessions` by reference → `biz_ticket_checkout_finalize` (mints an ORDER). No contribution branch exists.
  - `paystack-checkout-create/index.ts:9-11` — "TEST-ONLY HARNESS ... Phase 1 wires this into ticket-checkout-create." Confirmed NOT the prod path.
- **Mechanism:** the contribution create passes `amountSubunits = all-in NGN total (kobo, VAT=0)`, `subaccount = brands.paystack_subaccount_code`, `transaction_charge = miglaFeeCents`, `bearer` per the processing-fee decision (F-11), and `metadata.purpose = "rsvp_contribution"`. The webhook router must gain a contribution branch (lookup a new contribution-session table by reference BEFORE the ticket-session lookup) → new `finalize_rsvp_contribution` RPC.
- **Severity:** CONFIRMED (path proven; the router + finalize RPC are net-new but mirror the proven ticket pattern).

### F-4 — Bank-gating gap: RSVP is ungated today AND `pg_brand_can_charge` is Stripe-blind  [CONFIRMED — Q4]
- **Symptom:** enabling chip-in turns an RSVP into a money-collector that must be bank-gated at publish; the existing predicate cannot gate a Paystack brand.
- **Layer:** schema + code.
- **Probe:** read `pg_brand_can_charge` latest def (orch_1116); read RSVP publish RPC gates; read `paidPublishGuards.ts`; live count of ready accounts.
- **Evidence (verbatim):**
  - `20260927000000_orch_1116_booking_gate_rls.sql` — `pg_brand_can_charge(p_brand_id)` body: `SELECT EXISTS (SELECT 1 FROM public.stripe_connect_accounts s WHERE s.brand_id = p_brand_id AND s.detached_at IS NULL AND s.stripe_account_id IS NOT NULL AND s.charges_enabled IS DISTINCT FROM false)`. **Stripe-only — no Paystack awareness.**
  - `20261207000000_orch_1274_money_read_rpcs.sql:56-61` — a Paystack brand's readiness is `WHEN b.paystack_subaccount_code IS NOT NULL THEN 'paystack'`. So Paystack readiness = subaccount present, a DIFFERENT signal.
  - `20261004000000_orch_1150_rsvp_events.sql:368` — RSVP publish "Removes ... stripe gates" → free RSVP is intentionally ungated.
  - `paidPublishGuards.ts:46-52` — the fail-close guard reason `stripe_charges_disabled` → "Finish your payment setup" → `/brand/{id}/payments/onboard`.
  - **Live prod:** 1 Stripe-ready connected account; `brands.paystack_subaccount_code` column present.
- **Mechanism:** the SPEC must add a conditional gate to `business_publish_rsvp_draft` (raise `stripe_charges_disabled` / a new provider-aware reason ONLY when `rsvp_contribution_enabled`) using a PROVIDER-AWARE predicate — reusing `pg_brand_can_charge` verbatim would falsely block every NGN brand.
- **Severity:** CONFIRMED (with the Paystack-blind sub-finding — a real correctness trap if missed).

### F-5 — Shared public body: RsvpOfferingBody is promoted to offering-rendering; all surfaces consume it  [CONFIRMED — Q5]
- **Symptom:** chip-in UI must land in the ONE shared body (COMMS-0040), not a forked copy.
- **Layer:** code.
- **Probe:** locate `RsvpOfferingBody`; grep consumer/business importers.
- **Evidence (verbatim):**
  - `packages/offering-rendering/RsvpOfferingBody.tsx` exists (1319 lines); also `PublicEventPage.tsx` in the same package.
  - `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx:80` imports `RsvpOfferingBody` from `@mingla/offering-rendering`; `:694` "RsvpOfferingBody owns all of section 2–8."
  - `app-mobile/.../orch_1157_round3_consumer_hide_address.test.ts:156` — "body promoted to offering-rendering."
  - `RsvpOfferingBody.tsx:115-200` — `RsvpOfferingBodyProps` with `onSubmit`, `config`, `isLoggedIn`; `:766` renders `RsvpMomentumDecision`; `:648` `RsvpGoingConfirmDialog`; `:663` success popup — all body-owned.
- **Mechanism:** the feasibility doc's path claim (`packages/offering-rendering/RsvpOfferingBody.tsx`) is CORRECT for current state; the COMMS-0040 consolidation shipped via ORCH-1163. The chip-in section + a new `contribution` prop/callback land in `RsvpOfferingBody.tsx` → all 5 surfaces inherit it. (Note filename: it is `RsvpOfferingBody.tsx`, not the feasibility's earlier `RsvpPublicBody`.)
- **Severity:** CONFIRMED (resolves the fork-risk; parity is automatic).

### F-6 — Anon support is present on both the RSVP write and the checkout  [CONFIRMED — Q6]
- **Symptom:** an anon web guest must be able to chip in.
- **Layer:** code.
- **Probe:** read `public-submit-rsvp` auth handling + `config.toml`.
- **Evidence (verbatim):**
  - `public-submit-rsvp/index.ts:4` — "Anon-capable guest RSVP write ... verify_jwt=false"; `:136-147` optionally resolves a JWT to `user_id`, else "fall through as an anon link guest."
  - `config.toml:268-269` — `[functions.public-submit-rsvp] verify_jwt = false`.
  - `config.toml:294-295` — ticket checkout "handles auth internally, mirroring ticket-checkout-create's guest path" (anon-capable guest checkout).
- **Mechanism:** the contribution create edge fn follows the same anon posture (verify_jwt=false; optional JWT → user_id, else anon buyer with contact). Anon web chip-in is consistent with existing patterns.
- **Severity:** CONFIRMED.

### F-7 — Refund + cancellation for contributions is a net-new path  [CONFIRMED gap — Q7]
- **Symptom:** contributions need a refund path; RSVP cancellation must decide the fate of chip-ins.
- **Layer:** code.
- **Evidence (verbatim):** `refund-order/index.ts:54, 139-168` — keyed strictly on `order_id` → `biz_refund_order`. No RSVP/contribution awareness. A contribution has no order → this cannot refund it.
- **Mechanism:** the SPEC defines a contribution refund path (Stripe `refunds.create` on the connected account with `refund_application_fee` decision; Paystack `POST /refund`) + a cancellation policy (on RSVP-event cancel, contributions are refunded).
- **Severity:** CONFIRMED gap (must be specced; not reusable as-is).

### F-8 — Receipt semantics: gift, not tax invoice  [CONFIRMED — Q8]
- **Symptom:** the receipt must read as a voluntary contribution, not a taxable sale.
- **Layer:** code + docs.
- **Evidence:** F-1 shows `tax_cents=0` and both passed/absorbed tax = 0 for a contribution; the new `TaxBasis` value self-describes on the persisted breakdown. The ticket receipt path (`_shared/ticketCheckout.ts` dispatch) is order-scoped and must NOT be reused verbatim (it emits a purchase/tax-style confirmation).
- **Mechanism:** SPEC defines contribution confirmation fields (amount, brand, event, "voluntary contribution", no tax line, no ticket/QR-as-admission semantics) — copy finalization routes to mingla-product, semantics defined here.
- **Severity:** CONFIRMED (semantics-level).

### F-9 — Migration prefix safety  [CONFIRMED — Q9]
- **Evidence:** across all `~/Desktop/mingla-orchs/*/supabase/migrations/`, the highest prefix is `20261210000000_orch_1278_money_act.sql`. IDs 1279-1290 may land at `20261211..20261215`.
- **Mechanism:** choose `20261220000000_orch_1291_rsvp_contributions.sql` (monotonic, safely above the frontier). Implementor re-scans at build time and bumps if a later collision appears.
- **Severity:** CONFIRMED (resolved).

### F-10 — FINANCE/LEGAL NOTIFY: zero-tax is defensible ONLY because v1 is optional  [FLAG — Q10]
- **Symptom:** a "voluntary" payment to a for-profit organiser could be argued to be taxable consideration.
- **Layer:** docs/finance.
- **Evidence / reasoning:** In v1 the guest RSVPs FREE and attendance is NOT conditioned on payment (Seth's lock; F-2 confirms no payment gate). A gratuitous transfer where nothing is supplied in return is not consideration for a taxable supply → zero transaction tax (VAT/sales-tax) is correct; the guest is charged no tax. The **required-mode** fast-follow (reserved, OUT of v1) WOULD condition attendance on payment → that becomes consideration and is taxable — which is precisely why Seth reserved it. Residual: (a) the organiser's own income-tax treatment of receipts is the organiser's responsibility, out of Mingla's checkout scope; (b) some jurisdictions may treat even voluntary tips to a business as taxable — not the standard treatment, but a product-decision Seth should acknowledge.
- **Mechanism:** no hard contradiction blocks v1 (the optional-only scope resolves it). Per dispatch, the mechanism Seth chose is specced; this risk is surfaced for his acknowledgement.
- **Severity:** SUSPECTED CONTRIBUTOR (product/finance risk, not a code defect) — FLAGGED to conductor.

### F-11 — PRODUCT FORK NOTIFY: who absorbs processing fees on the gift  [FLAG — Q11]
- **Symptom:** the engine's `pass_service_fee`/Stripe/Paystack processing cost can land on either the guest or the organiser.
- **Layer:** code + product.
- **Evidence:** `allInPricingEngine.ts:36` `MINGLA_SERVICE_FEE_BPS = 300`; `:178-184` `pass_service_fee` grosses the buyer subtotal; `paystack.ts:76,103` `bearer` selects who pays Paystack's fee.
- **Recommendation:** for a GIFT, the guest should be charged EXACTLY the amount they type (WYSIWYG). So the contribution path forces `pass_service_fee = false` (and `pass_mingla_fee = false`) regardless of the brand's ticket switches; Mingla still skims its `application_fee` from the amount, and Stripe/Paystack processing is borne by the organiser (`bearer: "subaccount"` on Paystack; connected-account fee liability on Stripe). Alternative (flagged): an optional "cover the fees" toggle that grosses the guest up (GoFundMe-style) — more UI, deferred.
- **Severity:** SUSPECTED CONTRIBUTOR (product fork) — FLAGGED with a recommendation.

---

## 5. Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction? |
|---|---|---|
| **Docs** | Feasibility says reuse the engine, new child table, both rails; cites `RsvpOfferingBody.tsx` in offering-rendering | Feasibility §5.3 suggested "gate v1 to Stripe" — SUPERSEDED by Seth's lock (both rails in v1). Feasibility used old name `RsvpPublicBody` in §2 — resolved: current name `RsvpOfferingBody` in the package (F-5). |
| **Schema** | `event_rsvps` payment-free; publish RPC soft-deletes tickets; `pg_brand_can_charge` Stripe-only | Consistent with code. `pg_brand_can_charge` Stripe-blindness is the load-bearing gap (F-4). |
| **Code** | Engine takes `taxCents` as input; existing flat-absorb zero-tax branch; both rails share engine; shared body | No contradiction. Confirms engine-reuse path (F-1). |
| **Runtime** | Sim booted (iPhone 17 Pro Max); shared `RsvpOfferingBody` renders sections 2-8 with NO payment UI | Consistent — no payment surface exists to reproduce (greenfield). |
| **Data** | Live prod: `event_rsvps` 16 cols, zero payment; no `%contribution%` table; 4 rsvp events (0 published, post-wipe); paystack col present; 1 Stripe-ready account | Consistent with schema. The 2026-06-22 test wipe explains sparse rows. |

No unresolved cross-layer contradiction. The single doc-vs-code drift (feasibility naming/Stripe-only sequencing) is resolved in favor of the shipped code + Seth's lock.

---

## 6. Repro evidence (runtime)

This is a **greenfield feature spec** — there is NO existing chip-in behavior and NO reproducer-bound bug. Per the forensics live-fire directive, the confidence cap "suspected for source-only" applies to *reproducer-bound UI bugs*; architectural facts here are proven at Schema/Code/Data with verbatim citations + a live read-only DB probe.

Runtime "before" evidenced by:
1. `RsvpOfferingBody.tsx` (the single shared body all surfaces render) contains sections 2-8 (momentum decision, going-confirm, success popup) with **no payment/amount/price UI** — grep for `price|amount|pay|contribution` in the file returns only unrelated matches. The free-RSVP flow therefore has no money surface at runtime by construction.
2. Live prod schema/data confirm no payment path exists to exercise.
3. A booted sim is available (`2C3312D9-EE52-4EBD-9704-15811D49A2EC`). A full authored-event drive (author RSVP → publish → open public page) was **not** performed: Metro is not running, prod has 0 published RSVP events (test wipe), and there is no bug to reproduce — driving it would only re-confirm the absence already proven by the shared-body code. The IMPLEMENT/TEST phases will drive the NEW chip-in flow on the sim + physical device once built.

Honest posture: runtime "before" = **confirmed by shared-component code + live schema/data**; full authored-event sim drive **deferred to TEST** (proportionate — greenfield feature, no reproducer).

---

## 7. Blast radius / cross-surface map

**In-scope surfaces (5, per INTAKE):** consumer iOS, consumer Android, business iOS, business Android, buyer/anon web.
- All 5 consume `packages/offering-rendering/RsvpOfferingBody.tsx` (public body) → parity is AUTOMATIC for the guest-facing chip-in UI (F-5).
- The organiser toggle (enable chip-in + inline bank connect) lives in the RSVP create/edit wizard in `mingla-business/` — compiles to business iOS, Android, and business-web preview from one codebase.

**Out-of-scope surfaces:**
- **Admin web** (`mingla-admin/`) — organiser authoring is not there; read-only contribution visibility is META-ORCH-1237's lane (adjacent).
- **Business web preview** — inherits the shared body automatically (adjacent, no bespoke work).

**Shared code touched (blast points):**
- `supabase/functions/_shared/allInPricingEngine.ts` — ONE new `TaxBasis` union member. All engine callers (ticket-checkout-create, previews) must still compile; the new member is additive and only reached on the contribution path. **Regression risk: the exhaustive `never` guard in `taxBehaviorForRegion` does NOT switch on `TaxBasis`, so adding a `TaxBasis` member does not force a throw — but any `switch (taxBasis)` elsewhere must handle it.** (Blast check required in SPEC.)
- `paystackWebhookRouter.ts` + `stripeWebhookRouter.ts` — additive contribution branch; must not alter ticket finalize.
- `business_publish_rsvp_draft` — additive conditional gate; must not gate FREE RSVPs.

**Invariants in play:** I-PROPOSED-1150-RSVP-NO-TICKET-ROWS (preserve), Constitution #2 single money owner (preserve via engine reuse), I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED (extend, provider-aware).

---

## 8. Discoveries for orchestrator (side issues)

- **D-1:** `pg_brand_can_charge` is Stripe-only in its latest definition (orch_1116) despite Paystack going live (META-ORCH-1076). Any buyer-supply readiness gate applied to a Paystack brand is currently mis-answered. ORCH-1291 must not reuse it blindly; a broader "provider-aware readiness predicate" may be worth a dedicated follow-up beyond this ORCH.
- **D-2:** `paystack-checkout-create` remains a live TEST-ONLY harness (verify_jwt=false). Not a chip-in concern, but it is an unauthenticated Paystack-initialize endpoint in prod — worth an orchestrator note for eventual removal.
- **D-3:** Supabase MCP `execute_sql` works fine against prod (read-only) this session — contradicts the memory note "Supabase MCP broken." Memory may be stale.

---

## 9. Confidence + recommended next phase

- **Confidence: proven** (Docs/Schema/Code/Data with verbatim citations + live read-only probe; Runtime confirmed structurally). Two product/finance forks (F-10, F-11) are flagged for Seth — they do not block the SPEC (dispatch instructs: spec the chosen mechanism, flag the risk).
- **Recommended next phase:** SPEC (this pass produces it — INVESTIGATE-THEN-SPEC). Then DESIGN (mingla-designer — 5 UI surfaces) → IMPLEMENT → orchestrator applies migration + deploys edge fns → TEST → CLOSE.
- **Recommended scope (direction only, NOT a fix):** engine-reuse no-tax contribution on a new `event_rsvp_contributions` child table + event config flags; both rails; provider-aware publish bank-gate; inline connect-from-toggle; contribution refund + cancellation; gift receipt semantics. Explicitly OUT of v1: PWYW tickets, required-to-attend mode, standard-event work.
