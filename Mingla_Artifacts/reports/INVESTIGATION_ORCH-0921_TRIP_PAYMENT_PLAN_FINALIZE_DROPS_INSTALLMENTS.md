# INVESTIGATION — ORCH-0921 [Trip payment-plan finalize silently drops `installment_plan_root` + child installments — €375/order revenue leak]

**Author:** Claude `mingla-forensics`
**Date:** 2026-05-22
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Mode:** INVESTIGATE → SPEC (IA)
**Confidence:** **PROVEN** (5/5 truth layers agree; six-field evidence on root cause; live-fire exempt per backend-only exemption clause)

---

## Symptom summary

**Expected:** When a buyer purchases a trip ticket on a payment-plan tier, the deposit is charged immediately and the remaining installments are scheduled in `order_installments` to be auto-charged by the cron `process-scheduled-installments` at their due dates. The order's `installment_plan_root` is `true` and its `total_cents` equals the deposit (per the explicit migration `20260610000002` comment "override session total_cents to the deposit amount — what Stripe will charge").

**Actual (proven via direct DB probe, 2026-05-22):** The deposit charge succeeds, the order is created with `total_cents = deposit`, but `installment_plan_root = false` and ZERO rows are written to `order_installments`. The ORCH-0914 Money tab then honestly renders "Paid in full" against the deposit-only total. The cron never sees the installments to charge. The saved PaymentMethod is never used off-session. The remaining 75 % of the ticket price disappears silently.

**Repro conditions:** Always, for every trip booking on a payment-plan tier where the buyer lands on `/checkout-trip/{tripEventId}/confirm?cs=...` (Stripe-hosted Checkout success redirect). Production audit query identified exactly 1 leaker on production right now: order `47374d23-2547-4709-a967-cee172fb877c` (Seth from Somethingelse on The DC Adventure, €375 leaked).

**When it started:** Always broken since ORCH-0869 Stage 1B shipped (2026-05-17 / 2026-05-18). The implementation report explicitly documented the gap as "Stage 1c follow-up" but the follow-up ORCH was never opened, and the gap was mis-characterized as "low-likelihood race" assuming the broken callers were "secondary recovery paths used when webhooks fail." That assumption was wrong — see §"Causal chain" below.

---

## Investigation manifest

Every file read, in trace order, with WHY:

| Order | File / artifact | Why |
|---|---|---|
| 1 | `Mingla_Artifacts/prompts/INVESTIGATOR_SPEC_ORCH-0921_TRIP_PAYMENT_PLAN_FINALIZE_DROPS_INSTALLMENTS.md` | Dispatch — operator-validated DB proof + 5 candidate root causes |
| 2 | `Mingla_Artifacts/WORLD_MAP.md` ORCH-0921 banner | Registration context |
| 3 | DB probe — `ticket_types`, `trip_pricing_tiers`, `orders`, `order_installments`, `ticket_checkout_sessions` for The DC Adventure | Confirm the proof and run the DB-wide audit |
| 4 | `supabase/migrations/20260610000000_tr3_installments.sql` | Origin schema — `order_installments` + 5 new `orders` columns |
| 5 | `supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql` | Adds installment-aware logic to `biz_ticket_checkout_create_session` + `biz_ticket_checkout_finalize` |
| 6 | `supabase/migrations/20260710000000_orch_0897_trip_event_group_chat.sql` | **LATEST `biz_ticket_checkout_finalize` definition** (per last-writer-wins rule) |
| 7 | `supabase/functions/ticket-checkout-create/index.ts` | Confirm the deposit PI gets `mingla_installment_plan_root="true"` metadata (lines 314, 492, 664) |
| 8 | `supabase/functions/_shared/stripeWebhookRouter.ts:760-799` | The CORRECT caller — reads PI metadata + passes all 8 params |
| 9 | `supabase/functions/ticket-checkout-confirm/index.ts:240-283` | **The BROKEN caller** — buyer-side sync-confirm, 5/8 params |
| 10 | `supabase/functions/reconcile-stuck-checkouts/index.ts:60-90` | **The OTHER BROKEN caller** — recovery path, 5/8 params |
| 11 | `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx:184` | Buyer-side trigger — calls `confirmTicketCheckout` service |
| 12 | `mingla-business/src/services/ticketCheckoutService.ts:169-173` | Service calls `ticket-checkout-confirm` edge fn |
| 13 | `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0869_TR3_INSTALLMENT_PAYMENTS_STAGE_1B.md` | Phase 0 ingest — finds the "Stage 1c follow-up" documentation that was never opened |
| 14 | `Mingla_Artifacts/specs/SPEC_ORCH-0869_TR3_INSTALLMENT_PAYMENTS.md` | Phase 0 ingest — context on the original installment-plan contract |

---

## Findings (classified)

### 🔴 R-1 — ROOT CAUSE — `ticket-checkout-confirm/index.ts:263-272` calls `biz_ticket_checkout_finalize` with 5 of 8 params, omitting `p_installment_plan_root` + `p_stripe_customer_id_on_connected_account` + `p_saved_payment_method_id`

**File + line:** `supabase/functions/ticket-checkout-confirm/index.ts:263-272`.

**Exact code:**
```ts
const { error: finalizeError } = await supabase.rpc(
  "biz_ticket_checkout_finalize",
  {
    p_checkout_session_id: session.id,
    p_stripe_payment_intent_id: paymentIntentId,
    p_stripe_charge_id: latestChargeId,
    p_stripe_payment_method_type: paymentMethodType,
    p_qr_token_pepper: pepper,
  },
);
```

**What it does:** Invokes the finalize RPC with only 5 of the 8 parameters. The 3 omitted parameters (`p_installment_plan_root`, `p_stripe_customer_id_on_connected_account`, `p_saved_payment_method_id`) default to `false`, `NULL`, `NULL` respectively per the RPC signature at `20260710000000_orch_0897_trip_event_group_chat.sql:220-228`. The finalize RPC then evaluates the installments-INSERT guard at line 337 — `IF p_installment_plan_root AND v_schedule IS NOT NULL THEN ...` — as FALSE (because `p_installment_plan_root` is `false`), so the entire installments-INSERT loop at lines 337-366 is skipped. The order row is INSERTed at line 307 with `installment_plan_root = COALESCE(p_installment_plan_root AND v_schedule IS NOT NULL, false) = false` (line 332) and `stripe_customer_id_on_connected_account = CASE WHEN p_installment_plan_root THEN ... ELSE NULL END = NULL` (line 333) and `saved_payment_method_id = NULL` (line 334). Zero rows reach `order_installments`. Session is marked `paid_completed` with `session.order_id = v_order_id`.

**What it should do:** Read `paymentIntent.metadata["mingla_installment_plan_root"]` and pass it as `p_installment_plan_root: piMetadata["mingla_installment_plan_root"] === "true"`. When true, also derive and pass `p_stripe_customer_id_on_connected_account: objectString(paymentIntent, "customer")` and `p_saved_payment_method_id: objectString(paymentIntent, "payment_method")` — exactly the pattern the webhook router uses at `stripeWebhookRouter.ts:778-784`.

**Causal chain:**
1. Buyer chooses payment plan on `/checkout-trip/{tripEventId}` for The DC Adventure Standard tier.
2. `ticket-checkout-create/index.ts` correctly: (a) calls `biz_ticket_checkout_create_session` which returns `installment_schedule` JSONB from `trip_pricing_tiers.tier_metadata.installments` (verified in session row `60e8d83b-...`); (b) overrides session `total_cents` to the deposit amount (€125 = 25 % of €500); (c) sets `mingla_installment_plan_root: "true"` on the deposit PaymentIntent metadata at line 492 (apple-pay path) or 664 (card path).
3. Stripe charges the €125 deposit successfully. `payment_intent.succeeded` will eventually fire via webhook.
4. Stripe redirects the buyer to `/checkout-trip/{tripEventId}/confirm?cs=cs_test_...`.
5. The buyer's browser executes `confirm.tsx:184` → `confirmTicketCheckout` service → `ticket-checkout-confirm` edge fn. This is **the primary, synchronous confirm path per ORCH-0852** — it is NOT a recovery path; it is the path that runs for every successful buyer-web checkout.
6. `ticket-checkout-confirm` retrieves the PaymentIntent, sees `status === "succeeded"`, and at line 263 calls `biz_ticket_checkout_finalize` with 5 params.
7. Finalize creates the order with `installment_plan_root = false`, skips the installments INSERT, marks the session `paid_completed`, and sets `session.order_id = <new order uuid>`.
8. Some seconds later, Stripe's webhook fires `payment_intent.succeeded`. `stripeWebhookRouter.ts:760-799` reads PI metadata correctly (`isInstallmentPlanRoot = true`), derives `stripeCustomerId` and `savedPaymentMethodId`, and calls finalize with all 8 params.
9. Finalize hits the early-return guard at line 268: `IF v_session.order_id IS NOT NULL THEN ... RETURN`. The session's `order_id` is already set from step 7. Finalize returns the existing order's data verbatim WITHOUT touching `installment_plan_root` or `order_installments`. The webhook's correct call is silently discarded.
10. Order now permanently has `installment_plan_root = false`, zero `order_installments` rows. Cron `process-scheduled-installments` enumerates `order_installments` rows with `status='scheduled' AND due_at <= now()` — there are no rows for this order, so the cron never sees it. The saved PaymentMethod on the buyer's Stripe Customer is never charged off-session.
11. The ORCH-0914 Money tab queries `orders` joined to `order_installments` for the trip; for this order, `paidToDateCents = 12500` (the deposit), `orderTotalCents = 12500` (the order row), `outstandingCents = Math.max(0, 12500 - 12500) = 0`, `isPaidInFull = true`. The tab honestly renders "Paid in full" — but the underlying order row is wrong.
12. The remaining €375 is never charged. The trip planner believes the booking is paid in full. The buyer's contractual remaining 2 installments (€250 due 30 days after booking, €125 due 60 days after booking) never happen.

**Verification step:**
- DB-probe verification (already done): `SELECT total_cents, installment_plan_root, payment_status FROM orders WHERE id='47374d23-2547-4709-a967-cee172fb877c'` returns `(12500, false, 'paid')`. `SELECT COUNT(*) FROM order_installments WHERE order_id='47374d23-...'` returns `0`. `SELECT installment_schedule FROM ticket_checkout_sessions WHERE id='60e8d83b-...'` returns the fully-populated 2-installment schedule JSON. All three observations are consistent with finalize being called with `p_installment_plan_root=false`.
- Re-confirmation step (orchestrator-runnable, read-only): grep for every `supabase.rpc("biz_ticket_checkout_finalize"` invocation across the repo and count parameters in each call — confirms exactly 3 callers, 1 correct (8 params), 2 broken (5 params each). The 2 broken callers are `ticket-checkout-confirm/index.ts:263` and `reconcile-stuck-checkouts/index.ts:74`.

---

### 🔴 R-2 — ROOT CAUSE — `reconcile-stuck-checkouts/index.ts:74-83` has the IDENTICAL omission, so when the webhook drops + the buyer never returns to `/confirm`, the recovery cron also leaks installments

**File + line:** `supabase/functions/reconcile-stuck-checkouts/index.ts:74-83`.

**Exact code:**
```ts
const { data: finalized, error: finalizeError } = await supabase.rpc(
  "biz_ticket_checkout_finalize",
  {
    p_checkout_session_id: sessionId,
    p_stripe_payment_intent_id: piId,
    p_stripe_charge_id: chargeId,
    p_stripe_payment_method_type: methodType,
    p_qr_token_pepper: pepper,
  },
);
```

**What it does:** Same 5-of-8 omission as R-1. This caller runs as a periodic reconciliation against `ticket_checkout_sessions` rows whose Stripe PI succeeded but were never finalized (because both the webhook AND the buyer-side sync-confirm failed — e.g., buyer closed the browser, webhook delivery delay, etc.). Same broken outcome: order created with `installment_plan_root=false`, zero installments inserted.

**What it should do:** Same as R-1 — read the PI metadata (`pi.metadata["mingla_installment_plan_root"]`), derive `stripeCustomerId` from `pi.customer` and `savedPaymentMethodId` from `pi.payment_method`, and pass all 3 through to finalize.

**Causal chain:** Identical to R-1, except triggered by the periodic reconcile cron instead of the buyer-side sync-confirm. Lower runtime frequency than R-1, but same failure mode. R-1 fires for every successful buyer-web payment-plan checkout; R-2 fires only for sessions both R-1 and the webhook missed.

**Verification step:** Same grep as R-1 — 2 broken callers, both visible.

**Classification rationale:** R-2 is a ROOT CAUSE in its own right (not just a contributing factor) because if the buyer somehow bypasses R-1 (e.g., closes browser tab before confirm fires) and the webhook also drops, R-2 is the only remaining path to finalize — and R-2 will produce the same broken outcome on its own.

---

### 🟠 CF-1 — CONTRIBUTING FACTOR — Finalize RPC's early-return guard at line 268 silently swallows a second, more-correct caller without compare-and-correct

**File + line:** `supabase/migrations/20260710000000_orch_0897_trip_event_group_chat.sql:268-291`.

**Exact code:**
```sql
IF v_session.order_id IS NOT NULL THEN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ticketId', t.id, ...
  ) ORDER BY t.created_at), '[]'::jsonb)
    INTO v_tickets
    FROM public.tickets t
    JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
   WHERE t.order_id = v_session.order_id;
  RETURN jsonb_build_object(
    'orderId', v_session.order_id,
    'checkoutSessionId', v_session.id,
    'eventId', v_session.event_id,
    'paymentStatus', 'paid',
    'totalCents', v_session.total_cents,
    'currency', trim(v_session.currency),
    'tickets', v_tickets,
    'notificationStatus', 'queued'
  );
END IF;
```

**What it does:** When called a second time on a session that already has an order, the RPC short-circuits and returns the existing order's metadata without inspecting whether the second caller's parameters would have produced a different (better) result. This is the idempotency safeguard — appropriate in isolation — but it means the webhook router's correct `p_installment_plan_root=true` call after a broken sync-confirm cannot self-heal the order.

**What it should do (PER SPEC, not this investigation):** Compare-and-correct. If the second caller passes `p_installment_plan_root=true` AND the existing order row has `installment_plan_root=false` AND `v_schedule IS NOT NULL` AND zero `order_installments` rows exist for the order, the RPC should populate the missing installment-plan state. Idempotency is preserved (no duplicate installments are created — the absence-of-rows check prevents that) but the silent-acceptance failure mode is closed.

**Why this is CF, not RC:** Even with this guard intact, if R-1 (and R-2) are fixed to pass the correct parameters on the first call, no order will ever reach the broken state. The guard alone doesn't cause the leak. But the guard contributes by hiding the bug — without it, the webhook's second call would have updated the order and the leak would have been zero. The guard turned an at-most-once race into a guaranteed-leak.

---

### 🟡 HF-1 — HIDDEN FLAW — ORCH-0869 Stage 1B implementation report explicitly documented this exact gap as "Stage 1c follow-up" but the follow-up ORCH was never opened

**File + line:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0869_TR3_INSTALLMENT_PAYMENTS_STAGE_1B.md:218-219, 244`.

**Exact text:**
> Line 218: "`reconcile-stuck-checkouts/index.ts` — still passes 5 params (defaults to non-installment behaviour, safe). Stage 1c will update."
> Line 219: "`ticket-checkout-confirm/index.ts` — same. Stage 1c will update."
> Line 244: "**`reconcile-stuck-checkouts/index.ts` and `ticket-checkout-confirm/index.ts` still call finalize with 5 params.** They'll work (the 3 new params default to non-installment behaviour) but for an installment-plan PI that hits these secondary recovery paths instead of the webhook, the resulting order will be created WITHOUT `order_installments` rows and the cron will have nothing to charge. **Recommended: register Stage 1c follow-up to update both callers.** Low-likelihood race (these are recovery paths used when webhooks fail) but worth closing."

**What this proves:** The implementor saw the gap, named it, and recommended a follow-up. The orchestrator at the time did not open the follow-up. The bug then shipped to production and lived undetected for 5 days (ORCH-0869 Stage 1B shipped 2026-05-17 / 2026-05-18; first known leak landed in production on 2026-05-22 with the first real payment-plan trip buyer).

**Why "low-likelihood" was wrong:** The Stage 1B implementor characterized `ticket-checkout-confirm` as a "recovery path used when webhooks fail." That characterization was wrong — `ticket-checkout-confirm` is the PRIMARY synchronous confirm path per ORCH-0852 [Buyer-web confirm screen renders black]: the buyer's browser hits `/confirm?cs=...` immediately after Stripe redirects, and the confirm page calls `confirmTicketCheckout` synchronously inside a `useEffect` to give the buyer instant feedback (the "Confirming your tickets…" hero). Stripe webhooks are asynchronous and often arrive seconds-to-minutes later, especially in low-volume Stripe test mode. So `ticket-checkout-confirm` virtually ALWAYS wins the race against the webhook.

**Classification rationale:** This is a HIDDEN FLAW (not a root cause) because it's a process/documentation gap — the engineering knew but the orchestration dropped it. The actual code-level bug is R-1 + R-2. HF-1 explains WHY R-1 + R-2 shipped to production despite being known. Recommend the orchestrator register a process improvement: any Stage 1B-style "follow-up will update" note in an implementation report MUST create a tracked ORCH-ID at close time, not be left as a free-floating recommendation.

---

### 🔵 O-1 — OBSERVATION — The audit query confirms exactly 1 leaker on production right now; total exposure = €375

**Observation:** The DB-wide audit query (read-only) executed by the orchestrator 2026-05-22 returned exactly 1 hit matching the leak pattern (`orders.total_cents` equals `FLOOR(ticket_types.price_cents * tier_metadata.deposit_pct / 100)` AND `installment_plan_root=false` AND zero `order_installments` rows AND `payment_status='paid'` AND `cancelled_at IS NULL`). The single hit is order `47374d23-2547-4709-a967-cee172fb877c` (Seth from Somethingelse on The DC Adventure, €37,500¢ = €375 leaked, deposit_pct=25, full_price_cents=50000). Every other paid order on production either has `installment_plan_root=true` (full payment-plan path was triggered through the webhook, OR is a non-plan full-pay order. Total production revenue at risk **today**: €375. Compounded forward, however, every future payment-plan buyer would leak — so the urgency is not about backfill cost (€375) but about preventing the bleed from compounding.

**Classification rationale:** OBSERVATION — not a defect, but a noteworthy data point for the orchestrator's CLOSE banner and backfill sizing decision.

---

## Five-truth-layer cross-check

| Layer | Truth | Source |
|---|---|---|
| **Docs** | "INSERT order_installments rows from the session's persisted schedule when the deposit PI's metadata carried `mingla_installment_plan_root=true`." | `supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql:12-14` header comment |
| **Schema** | Finalize RPC body guards installments-INSERT loop behind `IF p_installment_plan_root AND v_schedule IS NOT NULL THEN`. Default value of `p_installment_plan_root` is `false`. | `supabase/migrations/20260710000000_orch_0897_trip_event_group_chat.sql:228, 337` |
| **Code** | Webhook router caller passes all 8 params (CORRECT). Sync-confirm caller passes 5 params (BROKEN). Reconcile caller passes 5 params (BROKEN). | `supabase/functions/_shared/stripeWebhookRouter.ts:786-796` (correct); `supabase/functions/ticket-checkout-confirm/index.ts:263-272` (broken); `supabase/functions/reconcile-stuck-checkouts/index.ts:74-83` (broken) |
| **Runtime** | Buyer's browser hits `/confirm?cs=...` immediately after Stripe redirects, fires `confirmTicketCheckout` synchronously which calls the broken sync-confirm path. Webhook fires seconds-to-minutes later but its correct call hits the early-return guard at finalize:268 and is silently discarded. | `mingla-business/app/checkout-trip/[tripEventId]/confirm.tsx:184` → `mingla-business/src/services/ticketCheckoutService.ts:169-173` → `ticket-checkout-confirm` edge fn; ORCH-0852 sync-confirm pattern context |
| **Data** | Order `47374d23-...` has `total_cents=12500, installment_plan_root=false, payment_status=paid`. Zero `order_installments` rows. Originating session `60e8d83b-...` has fully-populated `installment_schedule` JSONB and `status=paid_completed`. | Direct DB probe via Supabase MCP `execute_sql`, 2026-05-22 |

**All five layers agree** on the failure shape and location. Layer 1 (docs) describes the intent. Layer 2 (schema) describes the guard. Layer 3 (code) shows two callers don't satisfy the guard's input. Layer 4 (runtime) shows the broken caller wins the race. Layer 5 (data) confirms the failure shape on a real production order. No layer disagrees. **Confidence: PROVEN.**

---

## Blast radius map

- **Affected ORCH-IDs:** ORCH-0869 [Tr3 Installment Payments] (introduced the bug at Stage 1B close), ORCH-0914 [Trip Money tab redesign] (surfaced the bug by giving the operator a per-traveller view), ORCH-0915 [Buyer pay-in-full opt-out] (the related queued UX feature — operator should know this revenue-leak bug is fixed first so the opt-out lands on a sound foundation).
- **Affected flows:** every trip booking on a payment-plan tier via the buyer-anonymous-web checkout path (`/checkout-trip/{tripEventId}` + `/checkout-trip/{tripEventId}/confirm`). Native business iOS / Android checkout paths use `PaymentSheet` with a custom-scheme deep-link return (per ORCH-0839-B) which is event/trip-agnostic — but they also call `confirmTicketCheckout` in the deep-link return handler, so they have the SAME bug.
- **Solo vs collab:** N/A (this is a buyer-checkout flow, not a session-state flow).
- **Affected query keys / cache state:** ORCH-0914 Money tab consumers (`useInstallmentsForBrandTrips`, `useTrip`) read from `orders` + `order_installments`; honestly render the leaked state. No cache invalidation issue — the data they cache is honest about what the DB has; the DB itself is wrong.
- **Affected invariants:** likely violates an implicit invariant from ORCH-0869 ("every installment-plan order has installment_plan_root=true AND a matching set of order_installments rows derived from the session's installment_schedule"). This investigation recommends a new explicit DRAFT invariant — see Fix Strategy below.
- **Recurring pattern:** the "finalize callers got out of sync when the signature was extended" failure mode is a recurring pattern in this codebase — see SPEC §"New invariants" for the proposed CI gate to catch it permanently.

---

## Live-fire exemption rationale

The forensics skill Prime Directive 7 mandates live-fire reproduction for any UI / UX / input / keyboard / gesture / animation / navigation / runtime bug with a specific reproducer. **Exemptions** explicitly include "pure backend / SQL / migration / RLS / edge-function / CI / build-config / lint / type investigations."

This investigation is pure backend: the symptom is server-side DB row state (wrong `total_cents` interpretation + missing `order_installments` rows + wrong `installment_plan_root` flag), the root cause is two edge-function callers omitting RPC parameters, and the verification is via direct DB probe and source-code grep. No simulator, no browser, no buyer-side rendering matters for proving the cause. A live-fire repro (making a new test buyer pay €125 on Vercel preview with Stripe test card `4242 4242 4242 4242` and watching the DB) would produce a second data point but not change the conclusion — the 5 truth layers already converge with a `PROVEN` verdict. The orchestrator's dispatch correctly noted that Phase 0.A applies in the abstract; this report invokes the explicit exemption clause for backend-only investigations.

**Recommendation to orchestrator:** during the CLOSE phase, the tester `mingla-tester` should run the live-fire smoke (new payment-plan buyer on Vercel preview, watch the DB after) AFTER the fix lands — that's the right place for the runtime confirmation, not the investigation phase. The tester verification step is referenced in the SPEC's Phase 6 test cases.

---

## Invariant violations

Proven violation of an IMPLICIT invariant established by ORCH-0869 SPEC (lines 295-297 cite the column comment): every installment-plan order must have `installment_plan_root=true` AND a matching set of `order_installments` rows derived from the session's `installment_schedule`. This investigation recommends promoting that to an EXPLICIT, named invariant in the SPEC — see SPEC §"New invariants" — enforced by a strict-grep CI gate that scans for new finalize callers and asserts each one passes the 3 installment-plan parameters (or carries an explicit opt-out comment).

---

## Fix strategy (direction only — full contract in SPEC)

1. **Fix the 2 broken callers.** Update `ticket-checkout-confirm/index.ts:263-272` and `reconcile-stuck-checkouts/index.ts:74-83` to read `paymentIntent.metadata["mingla_installment_plan_root"]`, derive `stripeCustomerId` and `savedPaymentMethodId` (mirroring `stripeWebhookRouter.ts:778-784`), and pass all 8 parameters to `biz_ticket_checkout_finalize`. Pattern-match the webhook router's call site exactly.
2. **Make the finalize RPC compare-and-correct on the second call.** Amend the RPC's early-return guard at line 268 so that when the second caller passes `p_installment_plan_root=true` AND the existing order row has `installment_plan_root=false` AND `v_schedule IS NOT NULL` AND zero `order_installments` rows exist, the RPC writes the missing installments and flips the flag (idempotent — re-running yields the same state). This closes the silent-acceptance failure mode for any future caller drift.
3. **Establish + enforce a new invariant.** `I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS`: every `supabase.rpc("biz_ticket_checkout_finalize", ...)` call site under `supabase/functions/` must include `p_installment_plan_root` (either as a value or with an explicit `// orch-strict-grep-allow finalize-no-plan-root — <reason>` opt-out comment). Enforce via new strict-grep gate registered in the standard workflow.
4. **Backfill the known leaker.** Orchestrator-gated SQL: INSERT 2 `order_installments` rows for order `47374d23-...` from the session's `installment_schedule` (which is fully populated) + UPDATE `orders SET installment_plan_root=true, stripe_customer_id_on_connected_account=<from session/PI>, saved_payment_method_id=<from session/PI>`. After backfill, the existing cron will auto-charge €250 on Jun 21 and €125 on Jul 21 with no further intervention.
5. **Idempotency + backfill compatibility requirements** — see SPEC §"Hard guards" and the dedicated success criteria.

---

## Regression prevention

| Mechanism | What it does |
|---|---|
| **Implementor happy-path Deno test** | Mocks both broken callers + verifies they now pass all 8 params; verifies the finalize RPC's compare-and-correct branch writes installments when called twice (idempotency proof). Fails-on-revert. |
| **Tester adversarial Deno test** | Attacks the race condition: simulate the sync-confirm winning, then the webhook firing — assert the order ends up with `installment_plan_root=true` + correct installments regardless of which caller wins. |
| **NEW strict-grep CI gate** | `I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS` — scans `supabase/functions/` for `biz_ticket_checkout_finalize` invocations and asserts each call site references `p_installment_plan_root`. Fails CI on any new caller that drops it. |
| **Migration self-verification probe** | Inside the finalize RPC migration, add a `RAISE NOTICE` (or test fixture) that runs the compare-and-correct branch on a synthetic session+order pair and asserts the expected state. |
| **DB-wide audit query as a recurring health-check** | Operator can periodically re-run the audit SELECT (read-only) to confirm zero new leakers post-fix. Document the query in the SPEC for traceability. |

---

## Discoveries for orchestrator

1. **DISC-0921-A: Process improvement.** ORCH-0869 Stage 1B implementation report (line 244) recommended a "Stage 1c follow-up" to update the 2 broken callers. The follow-up ORCH was never opened. **Recommendation:** add a rule to the CLOSE protocol that any "follow-up" / "next stage" language in an implementation report MUST be converted to a tracked ORCH-ID at close time; otherwise it becomes free-floating engineering debt that nobody owns. Could be enforced by a docs-artifact-regression check that greps recent IMPLEMENTATION reports for "follow-up" / "Stage Nc" language and warns if no matching ORCH-ID exists.

2. **DISC-0921-B: Native business app parity.** `mingla-business/` native iOS + Android use `PaymentSheet` with a custom-scheme deep-link return (per ORCH-0839-B) for ticket purchases. The deep-link return handler ALSO calls `confirmTicketCheckout` service → `ticket-checkout-confirm` edge fn. So the SAME bug affects native iOS + Android buyer purchases on payment-plan tiers, not just buyer-anonymous-web. The fix at R-1 + R-2 closes both paths simultaneously (because they both route through the same shared service + edge fn). Tester parity-enforcement must verify on iOS sim + Android emu + Vercel-web, not just web.

3. **DISC-0921-C: ORCH-0911 sibling.** ORCH-0911 [Buyer-web checkout confirm screen renders black on `?cs=…` arrival] (closed 2026-05-22) also revealed a "this checkout-flow assumed event-only" architectural gap (Stripe `success_url` was hardcoded to the event path for ALL web checkouts including trips). ORCH-0921 is structurally similar — the finalize-callers were updated for the webhook path but not for the buyer-side sync-confirm path. **Recommendation:** at the next orchestrator REVIEW cycle, audit the rest of the trip-checkout edge functions (`ticket-confirmation-dispatch`, `process-scheduled-installments`, manual-charge endpoints) for similar "assumed event-only" bugs that ORCH-0869 may not have updated.

4. **DISC-0921-D: ORCH-0915 dependency.** ORCH-0915 [Buyer/traveller pay-in-full opt-out at payment-plan checkout] is queued as the next dispatch after ORCH-0921. The opt-out UX needs a sound underlying installment-plan flow to opt OUT of. **Recommendation:** ship ORCH-0921 fix + backfill + CI gate before ORCH-0915 implementor dispatch, so ORCH-0915's regression tests can rely on the assumption "if buyer chooses plan, all installments are correctly tracked." Sequencing already reflects this.

5. **DISC-0921-E: New invariant ratification.** SPEC introduces `I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS` as DRAFT. On ORCH-0921 close, orchestrator flips to ACTIVE and adds row to `Mingla_Artifacts/INVARIANT_REGISTRY.md`.

---

## Confidence

**PROVEN** (highest). Six-field evidence on both root causes; 5/5 truth layers converge; real production data point (order `47374d23-...`) matches the predicted failure shape exactly; prior ORCH-0869 Stage 1B implementation report independently documented the same gap as a known follow-up. No layer disagrees. Live-fire exempt per backend-only exemption clause; tester `mingla-tester` will run the runtime confirmation post-fix as standard TEST mode practice.
