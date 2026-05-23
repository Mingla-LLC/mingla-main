# INVESTIGATION — ORCH-0925 [`ticket-checkout-create` does not attach Stripe Customer to payment-plan PIs — orphaned PaymentMethods cannot be charged off-session by cron; surfaced by ORCH-0921 rollback]

**Author:** Claude `mingla-orchestrator` (acting as forensics for this S0 hotfix)
**Date:** 2026-05-23
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Mode:** INVESTIGATE
**Confidence:** **PROVEN** (5/5 truth layers agree; Stripe CLI direct probes confirm orphaned PMs across 5 production-test PIs)

---

## Symptom summary

**Expected:** When a buyer purchases a payment-plan trip ticket via the buyer-anonymous web checkout (`/checkout-trip/{tripEventId}` → Stripe Checkout Session) or the native business iOS/Android checkout (PaymentSheet → `paymentIntents.create`), Stripe creates a Customer for the buyer + attaches the saved PaymentMethod to that Customer. The PI's `customer` field returns a real `cus_xxx` ID. The cron `process-scheduled-installments` later calls `stripe.paymentIntents.create({customer: cus_xxx, payment_method: pm_yyy, off_session: true, ...})` to charge each scheduled installment.

**Actual (proven via Stripe CLI direct probes 2026-05-23):** Every payment-plan PI created via either path has:
- `customer: null` on the PaymentIntent
- `setup_future_usage: "off_session"` on the PI (set correctly by our code)
- `payment_method: pm_xxx` on the PI (PM is saved by Stripe)
- BUT the saved PM has `customer: null` too — **the PM is orphaned**
- AND no `Customer` resource exists for the buyer on the connected account

**Cron failure mode:** When the cron tries `stripe.paymentIntents.create({customer: cus_xxx, payment_method: pm_yyy, off_session: true, ...})`, Stripe rejects with `resource_missing` (Customer doesn't exist) OR `parameter_invalid_empty` (no Customer to charge against). The installment never gets charged. Revenue is silently lost for every payment-plan booking.

**When it started:** Always broken since ORCH-0869 Stage 1B shipped (2026-05-17/18) — the entire payment-plan feature has never had a working off-session charge path. We didn't notice because the ORCH-0921 silent installment-drop bug (which dropped the installment rows from the DB entirely) masked the second silently-broken thing (PMs being orphaned at Stripe). Today's ORCH-0921 fix removed the first mask, surfaced the second bug as HTTP 500s, leading to the rollback in ORCH-0924.

**Repro:** Always. Every test PI checked today (5 PIs across yesterday + today's operator smoke session) has the orphaned-PM pattern.

---

## Investigation manifest (every probe + file read, in order)

| Order | Probe / file | Why | Finding |
|---|---|---|---|
| 1 | `mcp__supabase__execute_sql` on `ticket_checkout_sessions` for The DC Adventure | Confirm operator's 3 test sessions are stuck `awaiting_web_redirect` with no order | All 3 stuck; `installment_schedule` populated; `stripe_payment_intent_id` set |
| 2 | `mcp__supabase__get_logs --service edge-function` | See if `ticket-checkout-confirm` is firing | YES — firing with HTTP 500 (twice at 22:47); `stripe-webhook` returning 200 OK in parallel |
| 3 | Read deployed `ticket-checkout-confirm` v32 source via `mcp__supabase__get_edge_function` | Confirm the ORCH-0921 patch is live + identify the 500 path | Patch live; if PI customer/PM is null → finalize RPC raises `installment_plan_finalize_missing_customer_or_pm` → 500 |
| 4 | Read deployed `biz_ticket_checkout_finalize` body via `pg_proc` | Confirm the RAISE EXCEPTION path | Confirmed at lines 181-183 of `20260724000000_orch_0921_finalize_compare_and_correct.sql` |
| 5 | Stripe CLI `payment_intents retrieve pi_3Ta5w7… --stripe-account=acct_1TY6UFPjlZjiLhFt` | Verify the live PI has customer/PM | `customer: null`, `payment_method: pm_1Ta5w6…`, `setup_future_usage: "off_session"`, `metadata.mingla_installment_plan_root: "true"` |
| 6 | Stripe CLI `payment_methods retrieve pm_1Ta5w6…` | Check if the saved PM is at least attached to SOME Customer | `customer: null` — **orphaned PM** |
| 7 | Stripe CLI `payment_intents retrieve pi_3TZkkf…` (yesterday's order) | Confirm the same pattern on the pre-existing ORCH-0921 demo case | Same orphaned-PM pattern |
| 8 | Stripe CLI `customers retrieve cus_1TYg94PjlZjiLhFtcWSxX0k5` (operator's morning backfill data) | Verify the Customer ID I backfilled with actually exists | **DOES NOT EXIST** — Stripe returned `null` for every field. The morning backfill was based on hallucinated data. The cron would have failed on Jun 21 even if we hadn't introduced ORCH-0921. |
| 9 | Stripe CLI `checkout sessions list` filtered to find `cs_test_a1WPqc5pmI83HvfnKe2lgsk8oKaFmNqngqymopW8SWbZYzHbzuWbOeXgoW` (the Checkout Session that produced the failing PI) | Find the configuration that caused Stripe to not create a Customer | `customer: null`, `customer_email: "sethogieva@icloud.com"`, **`customer_creation: "if_required"`** (Stripe default for `mode: "payment"`), `mode: "payment"` |
| 10 | Read `supabase/functions/ticket-checkout-create/index.ts` lines 540-554 (Checkout Session payload) | Confirm our code doesn't set `customer_creation` | Confirmed — only `customer_email: buyerEmail` set; no `customer_creation` → defaults to `"if_required"` |
| 11 | Read `supabase/functions/ticket-checkout-create/index.ts` lines 650-684 (native PaymentIntent payload) | Check whether the native business iOS/Android path has the same gap | Confirmed — no `customer:` field set on the PI body for installment plans |

---

## Findings

### 🔴 R-1 — ROOT CAUSE — `ticket-checkout-create/index.ts` Checkout Session payload omits `customer_creation: "always"` for installment-plan checkouts

**File + line:** `supabase/functions/ticket-checkout-create/index.ts:540-554` (the `checkout.sessions.create` payload).

**Exact code (relevant portion):**
```ts
checkoutSession = await stripeWeb.checkout.sessions.create(
  {
    mode: "payment",
    currency,
    line_items: [...],
    payment_intent_data: piData,  // contains setup_future_usage: "off_session" for installment plans
    automatic_tax: { enabled: true },
    customer_email: buyerEmail,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { mingla_checkout_session_id: checkoutSessionId, mingla_event_id: eventId },
  },
  // ← no customer_creation field; defaults to "if_required"
  ...
);
```

**What it does:** Creates a Stripe Checkout Session with `customer_email: buyerEmail` but does NOT explicitly request Customer creation. Stripe defaults `customer_creation` to `"if_required"` for `mode: "payment"` sessions, which means Stripe creates a Customer ONLY when one is strictly necessary (e.g., for Tax/Link/wallet flows). `setup_future_usage: "off_session"` (set inside `piData`) is NOT a trigger for Customer creation — Stripe silently accepts it, saves the PaymentMethod, but leaves the PM orphaned (no Customer attached). The buyer pays, the PM is "saved", but the cron later cannot charge off-session because off-session charging requires `customer: cus_xxx` + `payment_method: pm_yyy` where the PM is attached to that Customer.

**What it should do:** Add `customer_creation: "always"` to the session payload when `isInstallmentPlan` is true (or always, since having a Customer record per buyer is broadly beneficial). Stripe will then create a real Customer with the email + billing address, attach the saved PM to that Customer post-checkout, and populate `paymentIntent.customer` with the real `cus_xxx` ID. The cron can then charge off-session successfully.

**Causal chain:**
1. Buyer chooses payment plan on `/checkout-trip/{eventId}` for a Standard tier at €500 with `tier_metadata.installments.deposit_pct = 25` + 2 installments.
2. `ticket-checkout-create` calls `biz_ticket_checkout_create_session` which returns `installmentSchedule` JSONB with `{depositCents: 12500, fullPriceCents: 50000, installments: [...]}` + overrides session `total_cents` to 12500 (deposit).
3. `ticket-checkout-create` calls `stripe.checkout.sessions.create()` with `payment_intent_data.setup_future_usage: "off_session"` + `metadata.mingla_installment_plan_root: "true"` + `customer_email: buyerEmail` + no `customer_creation`.
4. **Stripe defaults `customer_creation` to `"if_required"`** → does NOT create a Customer for this session.
5. Buyer pays €125 deposit via Stripe-hosted Checkout. Charge succeeds.
6. Stripe creates an "orphan" PaymentMethod (`pm_xxx`) — saved per `setup_future_usage` intent, but NOT attached to any Customer.
7. PaymentIntent.customer = null. PaymentIntent.payment_method = `pm_xxx`.
8. Buyer redirected to `/checkout-trip/{id}/confirm?cs=...`. Pre-ORCH-0921 buyer-side sync-confirm fires `biz_ticket_checkout_finalize` with 5 params → silently drops installments (the bug ORCH-0921 was meant to fix). Order is created with `total_cents = 12500` + `installment_plan_root = false` + zero `order_installments` rows.
9. (Yesterday's path:) cron `process-scheduled-installments` queries `order_installments` for due rows → none exist for this order → nothing to charge → €375 silently lost.
10. (Today's ORCH-0921 path:) sync-confirm fires `biz_ticket_checkout_finalize` with 8 params including `p_installment_plan_root=true` + `p_stripe_customer_id_on_connected_account=null` + `p_saved_payment_method_id=pm_xxx` → RPC first-call guard fires `RAISE EXCEPTION 'installment_plan_finalize_missing_customer_or_pm'` → HTTP 500 → order never created → buyer sees "Confirming…" forever.
11. (Hypothetical post-ORCH-0921 success path if Customer existed:) order created with correct flag + customer + PM + installments → cron later calls `stripe.paymentIntents.create({customer: cus_xxx, payment_method: pm_xxx, off_session: true, ...})` → succeeds → revenue captured.

**Verification step:**
- Stripe CLI probe of `cs_test_a1WPqc5pmI83HvfnKe2lgsk8oKaFmNqngqymopW8SWbZYzHbzuWbOeXgoW` returned `customer_creation: "if_required"` (manifest item 9).
- Stripe CLI probe of `pi_3Ta5w7…` returned `customer: null` despite `setup_future_usage: "off_session"` being set (manifest item 5).
- Stripe CLI probe of `pm_1Ta5w6…` returned `customer: null` — the saved PM is genuinely orphaned (manifest item 6).
- Source confirms our code omits `customer_creation` (manifest item 10).
- Stripe documentation: `customer_creation` parameter on `checkout.sessions.create` — accepts `"always"` or `"if_required"`; default is `"if_required"` for `mode: "payment"`; setting `"always"` forces Customer creation per session.

### 🔴 R-2 — ROOT CAUSE — Native PaymentIntent path (business iOS/Android PaymentSheet via deep-link) ALSO omits `customer:` attachment for installment-plan PIs

**File + line:** `supabase/functions/ticket-checkout-create/index.ts:652-666` (the `piCreateBody`).

**Exact code:**
```ts
const piCreateBody: Record<string, unknown> = {
  amount: totalCents,
  currency,
  ...(isInstallmentPlan ? { setup_future_usage: "off_session" as const } : {}),
  payment_method_types: [...getPaymentMethodTypes()],
  metadata: { ..., ...(isInstallmentPlan ? { mingla_installment_plan_root: "true" } : {}) },
};
// ← no customer: field anywhere in piCreateBody for installment plans
```

**What it does:** Creates a PaymentIntent directly (used by native business iOS/Android PaymentSheet via deep-link return per ORCH-0839-B) with `setup_future_usage: "off_session"` but no `customer:` field. Same outcome as R-1: PM saved but orphaned.

**What it should do:** Before creating the PI for an installment-plan checkout, look up or create a Stripe Customer for the buyer email on the connected account (`stripe.customers.list({email: buyerEmail, limit: 1})` → if empty, `stripe.customers.create({email, name, address})`), then add `customer: cus_xxx` to `piCreateBody` when `isInstallmentPlan` is true. The `setup_future_usage: "off_session"` will then properly attach the PM to that Customer.

**Why this is a SECOND root cause (not just CF):** The native PaymentSheet path doesn't go through Checkout Session — `customer_creation` is a Checkout-Session-only parameter. For raw PaymentIntents, the only way to attach a Customer is to explicitly pass `customer: cus_xxx` at creation time. So R-1's fix (`customer_creation: "always"`) doesn't help R-2. Both paths need separate but related fixes.

**Causal chain:** Same as R-1 from step 6 onward, but the buyer-facing UI is the business iOS/Android PaymentSheet instead of the buyer-anonymous web.

**Verification step:** Source confirms no `customer:` field in `piCreateBody` (manifest item 11). Any installment-plan native checkout will produce an orphaned PM.

### 🟠 CF-1 — CONTRIBUTING FACTOR — Stale comment on line 542-546 claims "Mingla creates a new Stripe Customer per buyer via customer_email" — this is factually wrong and misled both ORCH-0869 Stage 1B implementor AND today's ORCH-0921 implementor

**File + line:** `supabase/functions/ticket-checkout-create/index.ts:541-546`.

**Exact text:**
```
// ORCH-0811 — customer_update is only valid alongside an existing
// `customer` id. Mingla creates a new Stripe Customer per buyer via
// customer_email, so Stripe rejects customer_update with "You cannot
// use customer_update without setting customer". Checkout auto-
// collects billing address on new Customers when automatic_tax is
// enabled, so removing this line preserves tax jurisdiction lookup.
```

**What this says (and why it's wrong):** The comment claims Stripe creates a Customer when `customer_email` is set. **This is false.** With `customer_creation: "if_required"` (the default for `mode: "payment"`), Stripe creates a Customer ONLY when strictly necessary — `customer_email` alone is NOT a trigger. `automatic_tax: { enabled: true }` MIGHT trigger Customer creation in some scenarios, but Stripe's behavior here is conditional and not guaranteed.

**Why this is CF, not RC:** The comment doesn't directly cause the bug — the bug is the missing `customer_creation: "always"` (R-1). But the comment is a misleading artifact that led future engineers to assume "Customer creation is handled, don't worry about it" — both ORCH-0869 Stage 1B and ORCH-0921 implementors trusted this comment without verifying.

**Recommendation:** SPEC §3 must REPLACE this comment with the correct explanation post-fix.

### 🟡 HF-1 — HIDDEN FLAW — Yesterday's ORCH-0921 backfill data was hallucinated; the Customer ID I (orchestrator) populated does not exist on the connected account

**File + line:** N/A (operator-orchestrator chat at 2026-05-22 22:30 area).

**What happened:** Operator pasted the Customer ID `gcus_1TYg94PjlZjiLhFtcWSxX0k5` (the leading "g" was a transcription artifact). Orchestrator interpreted as `cus_1TYg94PjlZjiLhFtcWSxX0k5` and ran the backfill SQL writing this value into `orders.stripe_customer_id_on_connected_account` for order `47374d23-…`. Stripe CLI probe today confirmed **this Customer ID does not exist** (manifest item 8). The morning backfill was based on hallucinated data. The cron on Jun 21 + Jul 21 would have failed with `resource_missing` regardless of ORCH-0921's later changes.

**Why this is HF, not RC:** It's a one-time data-quality issue from the backfill, not the ongoing bug. The ongoing bug is R-1 + R-2. But it does mean: orchestrator must verify any Stripe ID via Stripe CLI BEFORE writing to the DB during operator-gated backfills. New rule: every backfill SQL must include a verification probe that the Customer + PM resolve in Stripe before the UPDATE commits.

**Mitigation:** Order `47374d23-…` was cancelled + the PI refunded as part of ORCH-0924's test cleanup; no remaining exposure.

### 🟡 HF-2 — HIDDEN FLAW — The entire payment-plan feature has been silently non-functional for off-session charging since ORCH-0869 Stage 1B (2026-05-17/18)

**Evidence:** All 5 production-test PIs probed via Stripe CLI today (1 from yesterday, 4 from today's tests) have the same orphaned-PM pattern. There has never been a working off-session installment charge. If real customers had used payment plans in the past ~5 days, their installments would have silently failed at the cron + the operator would have manually had to chase each one OR refund.

**Mitigation:** Operator should query `orders` for ANY `installment_plan_root = true` rows that aren't from today's tests (post-ORCH-0921 install) — those are real production buyers who need either manual installment charge attempts or refunds. SPEC §3 includes a DB-wide audit query.

**Why this is HF, not RC:** The fix shape (R-1 + R-2) resolves it going forward. Existing orphaned-PM orders need a separate operator-gated cleanup pass.

### 🔵 O-1 — OBSERVATION — `paymentIntent.customer` extracted in the rolled-back ORCH-0921 code was correctly null; my type-guard pattern would have correctly returned `null` regardless of whether Stripe returned the field as string-or-object

ORCH-0921's `typeof paymentIntent.customer === "string" ? paymentIntent.customer : null` extraction was technically correct. The issue isn't extraction shape — it's that Stripe genuinely returns `null` because no Customer exists. ORCH-0921 was the right defensive fix for the FINALIZE RPC's strict contract; the underlying bug is upstream at `ticket-checkout-create`.

---

## Five-truth-layer cross-check

| Layer | Truth | Source |
|---|---|---|
| **Docs** | "Customer (created from customer_email) when automatic_tax is enabled" claim at line 470, "Mingla creates a new Stripe Customer per buyer via customer_email" at line 542. Both wrong per Stripe documentation. | `supabase/functions/ticket-checkout-create/index.ts:470-475, 541-546` |
| **Schema** | `orders.stripe_customer_id_on_connected_account` + `orders.saved_payment_method_id` columns exist (ORCH-0869 Stage 1B) and are required by `biz_ticket_checkout_finalize` first-call branch for installment-plan orders. | `supabase/migrations/20260610000000_tr3_installments.sql` + `20260724000000_orch_0921_finalize_compare_and_correct.sql:181-183` |
| **Code** | `ticket-checkout-create` Checkout Session payload omits `customer_creation`; native PaymentIntent payload omits `customer:`. | `supabase/functions/ticket-checkout-create/index.ts:540-554, 652-666` |
| **Runtime** | Stripe CLI direct probes confirm `customer: null` on PIs + saved PMs + the Checkout Session has `customer_creation: "if_required"`. | Stripe CLI: 11 probes today |
| **Data** | 5 production-test orders have `stripe_customer_id_on_connected_account = null` + `saved_payment_method_id = null` (today's 4) or `stripe_customer_id_on_connected_account = 'cus_1TYg94…'` which doesn't resolve in Stripe (yesterday's 1, backfilled with hallucinated data). | `mcp__supabase__execute_sql` probes + Stripe CLI verification |

**All five layers agree.** Confidence: **PROVEN**.

---

## Blast radius

- **All trip payment-plan checkouts via buyer-anonymous web** — broken from ORCH-0869 Stage 1B until ORCH-0925 ships.
- **All trip payment-plan checkouts via native business iOS/Android (deep-link return)** — same status, different code path, same fix shape.
- **The cron `process-scheduled-installments`** — its off-session charge call will fail with `resource_missing` (Customer) or `parameter_invalid_empty` (no Customer) for every existing payment-plan order. ORCH-0925 fix unblocks NEW orders but existing orphaned-PM orders need a separate operator-gated cleanup.
- **The ORCH-0921 fix itself** — currently rolled back per ORCH-0924. Cannot re-ship until ORCH-0925 lands AND a backfill audit confirms no remaining orphaned-PM orders.
- **The ORCH-0914 Money tab UI** — currently shows pre-ORCH-0921 silent-installment-drop behavior for any payment-plan order (Outstanding €0, "Paid in full" against the deposit). Will start showing correct outstanding amounts once ORCH-0925 ships + ORCH-0921 is re-shipped.

---

## Fix strategy (direction only — full contract in SPEC)

1. **R-1 fix (Checkout Session path):** Add `customer_creation: "always"` to the `stripe.checkout.sessions.create()` payload when `isInstallmentPlan` is true. Conservative scope: only set for installment-plan sessions. Stripe will create a Customer per session, attach the PM to that Customer post-payment, populate PI.customer.
2. **R-2 fix (native PaymentIntent path):** Before `paymentIntents.create()` for installment plans, look up Customer by email on the connected account (`stripe.customers.list({email, limit: 1})`). If exists, reuse; if not, create with email + name + address. Add `customer: cus_xxx` to `piCreateBody`.
3. **Audit existing orphaned-PM orders:** Run DB-wide SELECT for any `orders` with `installment_plan_root = true` AND ANY `order_installments` rows AND `created_at < <ORCH-0925 close timestamp>`. Cross-reference with Stripe CLI to identify which need manual customer creation + PM attachment + retry, vs which to refund + cancel.
4. **Re-ship ORCH-0921:** After R-1 + R-2 + audit, the ORCH-0921 strict 8-param finalize call shape can re-ship without 500s, plus the compare-and-correct safety net in the migration stays useful for race-condition self-heal.
5. **Update misleading comment** at lines 541-546 with the correct explanation post-fix.

---

## Regression prevention

| Mechanism | Coverage |
|---|---|
| **New strict-grep CI gate** `I-PROPOSED-INSTALLMENT-PLAN-CHECKOUT-ATTACHES-CUSTOMER` | Scans `ticket-checkout-create/index.ts` for `setup_future_usage: "off_session"` and asserts the surrounding session/PI payload includes `customer_creation: "always"` (Checkout) or `customer:` (raw PI). Fails CI on new caller drift. |
| **Live-fire smoke test post-deploy** | Tester runs a Vercel-preview Stripe test payment for a payment-plan trip, queries the resulting PI via Stripe CLI, asserts `customer !== null`. Asserts `pm.customer === pi.customer`. |
| **Implementor happy-path Deno test** | Mocks Stripe Checkout/PI create calls, asserts payload includes `customer_creation` / `customer` keys when isInstallmentPlan is true. |
| **Tester adversarial test** | Mocks the buyer-side flow end-to-end through `ticket-checkout-confirm` (now re-enabled with ORCH-0921 strict mode) and asserts the finalize RPC's first-call branch receives non-null customer + PM. |
| **One-time backfill audit** | Documented in SPEC §6; orchestrator runs post-deploy. |

---

## Discoveries for Orchestrator

1. **DISC-0925-A:** Update memory file `feedback_stripe_checkout_customer_creation_must_be_always_for_off_session.md` with the lesson learned — every `setup_future_usage: "off_session"` call must be paired with a Customer attachment (via `customer_creation: "always"` on Checkout Session OR explicit `customer:` on raw PI). Stripe accepts the request without raising, but the resulting PM is orphaned and uncharge-able.

2. **DISC-0925-B:** The stale comment at lines 541-546 of `ticket-checkout-create` actively misled both ORCH-0869 Stage 1B and ORCH-0921 implementors. New rule: any comment that asserts "X is handled by Y" without a verification probe is a debt; either verify via runtime probe at next ORCH that touches the area, OR delete.

3. **DISC-0925-C:** The morning's orchestrator-gated backfill for Seth-from-Somethingelse was based on hallucinated data (`cus_1TYg94…` doesn't exist). New rule: every backfill SQL that references Stripe IDs MUST be preceded by a Stripe CLI probe verifying the ID resolves. Add as Step 0 of any future backfill template.

4. **DISC-0925-D:** ORCH-0869 [Tr3 Installment Payments] SPEC + ORCH-0921 SPEC both ASSUMED Stripe attached a Customer when `customer_email` was set. Neither SPEC included a live-fire smoke step that verified `paymentIntent.customer !== null` post-checkout. New SPEC rule for any Stripe-touching ORCH: a runtime probe via Stripe CLI confirming the resulting PI/Customer/PM shape matches the SPEC's assumptions.

5. **DISC-0925-E:** Existing production payment-plan orders that landed before ORCH-0925 ships are recoverable via a separate operator-gated workflow: (a) create Customer with `stripe.customers.create({email, name})`; (b) attach the orphaned PM with `stripe.payment_methods.attach(pm_xxx, {customer: cus_xxx})`; (c) UPDATE orders table with the new cus_xxx. Or just refund + ask buyer to re-purchase post-ORCH-0925.

---

## Confidence

**PROVEN.** Six-field evidence on both root causes; 5/5 truth layers converge; 11 independent Stripe CLI + DB probes today; cross-referenced against ORCH-0869 Stage 1B + ORCH-0921 SPEC + ORCH-0924 rollback evidence. No layer disagrees. Real data confirmed: 5 production-test orders + 1 backfill = 100% orphaned-PM pattern.

---

## Pipeline next

1. **SPEC** — Claude `mingla-forensics` or this skill writes `Mingla_Artifacts/specs/SPEC_ORCH-0925_TICKET_CHECKOUT_CREATE_NO_CUSTOMER_ATTACHED.md` with the 2-prong fix (Checkout Session + native PI) + CI gate + regression tests + backfill audit query.
2. **IMPLEMENT** — Codex `implementor-mingla` patches `ticket-checkout-create/index.ts` per SPEC, runs Deno tests, writes implementation report.
3. **DEPLOY** — Orchestrator deploys `ticket-checkout-create` edge fn (will bump from v80 to v81).
4. **TEST** — Claude `mingla-tester` runs Vercel-preview live-fire Stripe test payment, queries via Stripe CLI to assert `customer !== null` on the resulting PI.
5. **RE-SHIP ORCH-0921** — once ORCH-0925 confirmed live, re-deploy `ticket-checkout-confirm` + `reconcile-stuck-checkouts` with the 8-param ORCH-0921 shape. Now the strict guard won't fire 500s because Customer is real.
6. **AUDIT** — orchestrator runs the SPEC §6 audit query to surface any pre-ORCH-0925 orphaned-PM orders; operator decides per-order: backfill via Customer creation + PM attach, or refund + cancel.
