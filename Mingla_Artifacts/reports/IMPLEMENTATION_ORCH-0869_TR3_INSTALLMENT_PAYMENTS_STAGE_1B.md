# IMPLEMENTATION — ORCH-0869 [Tr3 Installment Payments] Stage 1b

**Skill:** Claude `mingla-implementor` (parity mirror; canonical implementor is Codex `implementor-mingla`)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0869_TR3_INSTALLMENT_PAYMENTS.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0869_TR3_INSTALLMENT_PAYMENTS.md`
**Stage 1 implementation:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0869_TR3_INSTALLMENT_PAYMENTS_STAGE_1.md`

---

## 0. Layman summary

Wires the existing ticket-checkout pipeline so trips with payment plans actually flow end-to-end. The `biz_ticket_checkout_create_session` RPC now reads the trip's installment schedule from `trip_pricing_tiers.tier_metadata.installments`, validates it (sums, ordinals, no past-due first installment), computes per-installment dollar amounts with last-installment-absorbs-rounding, and overrides the session's `total_cents` to the deposit amount that Stripe charges at booking. The `biz_ticket_checkout_finalize` RPC now accepts three new optional params and — when the deposit PaymentIntent's metadata carries `mingla_installment_plan_root='true'` — populates the five Stage 1 `orders` columns and INSERTs `order_installments` ledger rows from the persisted schedule. The Stripe webhook router passes the Stripe Customer ID + saved PaymentMethod ID from the succeeded PI into finalize so the cron has what it needs to charge installments off-session later. The ticket-confirmation dispatcher gains two new `kind` branches (`installment_dunning` + `installment_plan_paid_in_full`) that route through the existing Resend send path. Stage 1c will plumb the same params through the secondary finalize callers (reconcile-stuck-checkouts + ticket-checkout-confirm) and ship the consumer-facing UI surfaces.

Status: `implemented and verified` (Deno gates pass, regression test fails-on-revert) · Verification: `passed`.

---

## 1. Scope of this stage

**In scope (Stage 1b):**
- DB migration `20260610000002_tr3_ticket_checkout_session_installment_aware.sql`: amends two RPCs + adds 1 session column.
- Edge function modification: `supabase/functions/_shared/stripeWebhookRouter.ts` (webhook→finalize call).
- Edge function modification: `supabase/functions/ticket-confirmation-dispatch/index.ts` (2 new `kind` branches).
- NEW email renderer `supabase/functions/_shared/email/installmentPlanPaidInFullEmail.ts`.
- TS-debt fixes (carryover): `installmentDunningEmail.ts` (Stage 1) + `tripConfirmationEmail.ts` (Tr2) `SenderIdentity` type unification.
- Deno regression test `supabase/functions/ticket-confirmation-dispatch/__tests__/installment_kinds.test.ts`.

**Out of scope (deferred to Stage 1c / Stage 2):**
- `reconcile-stuck-checkouts/index.ts` + `ticket-checkout-confirm/index.ts` finalize callers — these are secondary recovery paths; webhook is the authoritative one.
- UI components (`PaymentPlanEditor.tsx`, `InstallmentScheduleDisplay.tsx`, Money tab).
- Service + hook layer (`orderInstallmentsService.ts`, `useOrderInstallments.ts`).
- 3 CI strict-grep gates remaining (1 of 3 shipped in Stage 1).
- Tester adversarial regression test.

---

## 2. Pre-flight: discoveries that changed the migration

During battlefield reading I found the live `biz_ticket_checkout_finalize` is the **5-arg** definition from `20260515000016_orch_0777_qr_pepper_service_role_rpc.sql` — NOT the 4-arg base from `20260515000013_orch_0777_ticket_checkout_core.sql`. The qr_pepper migration added `p_qr_token_pepper text` as the 5th param. My first migration draft was extending the 4-arg base + 3 new params = 7-arg signature, which would have caused a `DROP FUNCTION IF EXISTS biz_ticket_checkout_finalize(uuid,text,text,text)` no-op (the 4-arg overload was already replaced by the 5-arg) and would have left BOTH the 5-arg and the new 7-arg coexisting — making `supabase.rpc()` resolution ambiguous.

**Fix:** the migration now DROPs the 5-arg overload first and re-creates as 8-arg (`p_checkout_session_id, p_stripe_payment_intent_id, p_stripe_charge_id, p_stripe_payment_method_type, p_qr_token_pepper, p_stripe_customer_id_on_connected_account, p_saved_payment_method_id, p_installment_plan_root`). Self-verification probe asserts `pronargs = 8` AND `count(overloads) = 1`.

---

## 3. Old → New receipts

### `supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql` (NEW, 543 lines)
**What it did before:** N/A — Stage 1b creation.
**What it does now:**
1. Adds `ticket_checkout_sessions.installment_schedule jsonb` (nullable). Comment names the shape `{fullPriceCents, depositCents, currency, installments:[{ordinal, amountCents, dueAt, pct}]}`.
2. `CREATE OR REPLACE biz_ticket_checkout_create_session` — verbatim body from `0829b` PLUS:
   - Selects `events.event_type` so the trip branch can gate.
   - For `event_type='trip'` only: looks up `trip_pricing_tiers.tier_metadata` for the cart's first ticket type; if `tier_metadata->'installments'` is populated, validates (deposit_pct ∈ (0,100]; pct sum = 100 ±0.01; ordinals 1..N monotonic with no gaps/dups; 1≤N≤11; exactly one of `days_after_booking|fixed_date`; first installment due_at must be in the future → `installment_schedule_past_due_at_booking`); computes deposit + per-installment amounts with last-installment-absorbs-rounding (`floor()` math); overrides `v_total := v_deposit_cents` so the session row + Stripe PI charge only the deposit at booking; persists the schedule on `installment_schedule` column; returns `installmentSchedule` in JSONB.
   - Multi-line carts with installments rejected: `ticket_lines_mixed_with_installments`.
   - Replay path (existing tombstone short-circuit) reads back `installment_schedule` from the existing row so a retry sees the same plan.
3. `DROP FUNCTION IF EXISTS biz_ticket_checkout_finalize(uuid,text,text,text,text)` — removes the 5-arg overload to prevent overload ambiguity.
4. `CREATE OR REPLACE biz_ticket_checkout_finalize` with 8 params (the 5 original + 3 new: `p_stripe_customer_id_on_connected_account, p_saved_payment_method_id, p_installment_plan_root`; all 3 default NULL/false):
   - Body verbatim from 0777_qr_pepper PLUS: reads `v_session.installment_schedule`; INSERTs the new orders row with `installment_plan_root`, `stripe_customer_id_on_connected_account`, `saved_payment_method_id` populated from params when the caller flagged installment-plan-root AND the session carries a schedule; iterates `v_schedule->'installments'` and INSERTs one `order_installments` row per ordinal (status='scheduled'); rejects loudly with `installment_plan_finalize_missing_customer_or_pm` if customer or PM is null on an installment-plan finalize (prevents creating ledger rows the cron can never charge).
5. Self-verification probe: asserts session column exists, both functions exist, finalize has exactly 8 params with exactly 1 overload.
**Why:** SPEC §3.1 + §3.2.2; Stage 1b is the keystone that connects the Stage 1 ledger + cron to the buyer flow.
**Lines:** ~543 added.

### `supabase/functions/_shared/stripeWebhookRouter.ts` (MODIFIED, +17 lines)
**What it did before:** `handleTicketCheckoutPaymentIntent` called `biz_ticket_checkout_finalize` with the 5 original params on `payment_intent.succeeded`.
**What it does now:** Same call site, but extracts `paymentIntent.metadata.mingla_installment_plan_root === "true"` → if true, pulls `paymentIntent.customer` + `paymentIntent.payment_method` and passes them through as the 3 new finalize params. Non-installment PIs pass `null/null/false` (matching defaults) so the legacy path is byte-identical.
**Why:** SPEC §7 step 8 (deploy split — webhook deploys after operator db push). The webhook is the authoritative success-state writer; this is the only callsite Stage 1b updates.
**Lines:** +17 inserted at lines 768-784.

### `supabase/functions/_shared/email/installmentPlanPaidInFullEmail.ts` (NEW, 108 lines)
**What it did before:** N/A.
**What it does now:** Exports `renderInstallmentPlanPaidInFullEmail(input)` returning `{subject, html, text, from: SenderIdentity}` shape. Subject: `You're all paid up: ${trip.title}`. Body congratulates the buyer + confirms the spot + names the brand contact email. HTML-escaped throughout. Uses canonical `SenderIdentity` from `_shared/email/senders.ts`.
**Why:** SPEC SC-8 `fire a "fully paid" confirmation email` + Stage 1 webhook handler already dispatches `kind: "installment_plan_paid_in_full"` expecting this renderer.
**Lines:** 108.

### `supabase/functions/ticket-confirmation-dispatch/index.ts` (MODIFIED, +178 lines)
**What it did before:** `serve()` read `body.orderId`, fetched order from DB, rendered email via `renderTransactionalEmail` (or `renderTripConfirmationEmail` per Tr2 trip branch), polled `ticket_order_notifications` table for `pending`/`failed_retryable` rows, sent each via Resend (with PDF + ICS attachments for ticket-confirmation).
**What it does now:** Same legacy flow preserved when `body.kind` is absent (null). When `body.kind === "installment_dunning"`: routes to new `handleInstallmentDunning` which fetches the order + brand contact_email + installment row (by `body.installmentId`), renders via `renderInstallmentDunningEmail`, sends via Resend with NO attachments. When `body.kind === "installment_plan_paid_in_full"`: routes to new `handleInstallmentPaidInFull` which fetches order + brand, renders via `renderInstallmentPlanPaidInFullEmail`, sends via Resend with NO attachments. Unknown kinds return HTTP 400 `{error: "unknown_kind", kind}` (defensive — silent fall-through would render a ticket confirmation for a webhook that meant something else). Service-role auth check (line 286) precedes kind routing (line 292) so installment-email callers inherit the existing auth gate.
**Why:** SPEC §3.2.3 + §3.2.4; Stage 1 webhook handler in `installmentWebhookHandlers.ts:166-181 + 286-303` already POSTs to this dispatcher with `{kind, orderId, ...}` — Stage 1b makes those calls actually do something.
**Lines:** +178 (new imports +4, new helpers +146, new kind-routing block +28).

### `supabase/functions/_shared/email/installmentDunningEmail.ts` (MODIFIED, -5 / +9 = +4 net)
**What it did before:** Defined a local `interface SenderIdentity { email: string; name: string }` and returned `from: { email: "tickets@usemingla.com", name: "Mingla" }`. This shipped in Stage 1 but was never imported anywhere, so the type mismatch with the canonical `_shared/email/senders.ts` `SenderIdentity` (`{name, address}`) didn't fail Deno check.
**What it does now:** Imports the canonical `SenderIdentity` from `senders.ts`; returns `from: { address: "tickets@usemingla.com", name: "Mingla" }`. Comment explains why the change happened in Stage 1b.
**Why:** Stage 1b dispatcher imports this renderer, which exposed the Stage 1 type drift. Runtime behaviour identical (Resend reads `sender.address` via `formatSenderHeader`).
**Lines:** ~9 changed, ~5 removed.

### `supabase/functions/_shared/email/tripConfirmationEmail.ts` (MODIFIED, -4 / +9 = +5 net)
**What it did before:** Same Tr2 (ORCH-0859) bug — local `SenderIdentity { email, name }` and `from: { email, name }`. Never failed Deno check before Stage 1b because the dispatcher's union narrowing was already broken (TS18047) and TS prioritized the first error.
**What it does now:** Imports canonical `SenderIdentity` from `senders.ts`; returns `from: { address: fromAddress, name: DEFAULT_FROM_NAME }`. Fixing this unblocked the 2 pre-existing TS18047 narrowing errors in the dispatcher (they were chained to the same union resolution).
**Why:** Same as above — Stage 1b's type cleanup got the dispatcher to a fully clean `deno check` for the first time since Tr2 shipped.
**Lines:** ~9 changed, ~4 removed.

### `supabase/functions/ticket-confirmation-dispatch/__tests__/installment_kinds.test.ts` (NEW, 187 lines)
**What it did before:** N/A.
**What it does now:** 12 source-assertion Deno tests pinning Stage 1b dispatcher behaviour:
1. dispatcher imports `renderInstallmentDunningEmail` from the Stage 1 module path
2. dispatcher imports `renderInstallmentPlanPaidInFullEmail` from the Stage 1b module path
3. dispatcher reads `body.kind` into a `kind` local for routing
4. dispatcher branches on `kind === "installment_dunning"` → `handleInstallmentDunning`
5. dispatcher branches on `kind === "installment_plan_paid_in_full"` → `handleInstallmentPaidInFull`
6. unknown kind returns 400 `{error: "unknown_kind", kind}` (defensive)
7. unknown-kind gate is `if (kind !== null)` so null kinds (legacy callers) fall through to the existing notifications-table flow
8. `handleInstallmentDunning` calls `renderInstallmentDunningEmail({`
9. `handleInstallmentPaidInFull` calls `renderInstallmentPlanPaidInFullEmail({`
10. Both installment branches send via Resend with `attachments: []` (notification emails, not ticket emails)
11. Dunning branch reads `body.failureReason` and `body.installmentId` from request body
12. Service-role auth check precedes kind routing (auth-bypass regression guard)
Plus a helper `extractFunctionBody(src, fnName)` that depth-aware-extracts a function body between `{` and matching `}` for branch-specific assertions.
**Why:** ORCH-0840 [Regression-test enforcement] mandates implementor happy-path test; the 12 assertions cover every Stage 1b dispatcher acceptance criterion.
**Lines:** 187.

---

## 4. Verification

### Deno gates
```
$ /Users/sethogieva/.deno/bin/deno check \
    supabase/functions/_shared/email/installmentPlanPaidInFullEmail.ts \
    supabase/functions/_shared/email/installmentDunningEmail.ts \
    supabase/functions/_shared/email/tripConfirmationEmail.ts \
    supabase/functions/_shared/stripeWebhookRouter.ts \
    supabase/functions/ticket-confirmation-dispatch/index.ts \
    supabase/functions/ticket-confirmation-dispatch/__tests__/installment_kinds.test.ts
Check supabase/functions/_shared/email/installmentPlanPaidInFullEmail.ts
Check supabase/functions/_shared/email/installmentDunningEmail.ts
Check supabase/functions/_shared/email/tripConfirmationEmail.ts
Check supabase/functions/_shared/stripeWebhookRouter.ts
Check supabase/functions/ticket-confirmation-dispatch/index.ts
Check supabase/functions/ticket-confirmation-dispatch/__tests__/installment_kinds.test.ts
(zero errors)
```

### Regression test (ORCH-0840 gate)
```
$ /Users/sethogieva/.deno/bin/deno test --allow-read \
    supabase/functions/ticket-confirmation-dispatch/__tests__/installment_kinds.test.ts
running 12 tests
ORCH-0869 Stage 1b: dispatcher imports installmentDunningEmail renderer ... ok
ORCH-0869 Stage 1b: dispatcher imports installmentPlanPaidInFullEmail renderer ... ok
ORCH-0869 Stage 1b: dispatcher reads body.kind for routing ... ok
ORCH-0869 Stage 1b: dispatcher branches on kind === "installment_dunning" ... ok
ORCH-0869 Stage 1b: dispatcher branches on kind === "installment_plan_paid_in_full" ... ok
ORCH-0869 Stage 1b: unknown kind returns 400 (defensive) ... ok
ORCH-0869 Stage 1b: dispatcher preserves legacy fall-through when kind is null ... ok
ORCH-0869 Stage 1b: installment_dunning handler renders via renderInstallmentDunningEmail ... ok
ORCH-0869 Stage 1b: paid-in-full handler renders via renderInstallmentPlanPaidInFullEmail ... ok
ORCH-0869 Stage 1b: installment emails send with NO attachments ... ok
ORCH-0869 Stage 1b: dunning handler passes failureReason + installmentId from body ... ok
ORCH-0869 Stage 1b: dispatcher requires service-role auth (preserved from legacy) ... ok
ok | 12 passed | 0 failed (5ms)
```

**Fails-on-revert verified at commit `e17ca8db` (Merge remote-tracking branch 'origin/main' into Seth).** Procedure:
1. `git stash push -- supabase/functions/ticket-confirmation-dispatch/index.ts` → returns the dispatcher to its Stage 1 state (legacy-only).
2. `deno test ...installment_kinds.test.ts` → **12 FAILED, 0 PASSED**.
3. `git stash pop` → restore Stage 1b dispatcher.
4. `deno test ...installment_kinds.test.ts` → **12 PASSED, 0 FAILED**.

### Migration self-verification probe
The migration ends with a `DO $$ ... END $$` block that asserts:
- `ticket_checkout_sessions.installment_schedule` column exists (1 row).
- `biz_ticket_checkout_create_session` function exists.
- `biz_ticket_checkout_finalize` function exists with `pronargs = 8`.
- Exactly 1 `biz_ticket_checkout_finalize` overload remains (the 5-arg one was dropped).
Probe raises EXCEPTION if any assertion fails, so `supabase db push` will fail loudly on any drift.

---

## 5. Spec traceability (Stage 1b portion)

| SC | Spec criterion | Stage 1b coverage |
|---|---|---|
| SC-3 | Trip publish validates schedule via RPC | Partial — `biz_ticket_checkout_create_session` validates at CHECKOUT (not publish). Publish-time validation is a separate RPC owned by Stage 2 spec follow-up. |
| SC-6 | Deposit saves PM to connected-account Customer via `setup_future_usage` + finalize writes `stripe_customer_id_on_connected_account` + `saved_payment_method_id` | **Done.** Stage 1 already injects `setup_future_usage: 'off_session'`; Stage 1b's finalize amendment + webhook router pass-through complete the persistence half. |
| SC-15 | Failed deposit at booking does NOT write `order_installments` rows | **Done.** Order rows are only inserted on successful PI (`payment_intent.succeeded`) and the finalize RPC's installment branch only fires under `p_installment_plan_root=true`. Failed deposits never reach finalize. |
| SC-17 | Late-booking rejection: trips where first installment `due_at <= now()` rejected by RPC with `installment_schedule_past_due_at_booking` | **Done.** Migration §`first installment due check` raises this exact error. |
| SC-13/14 | Existing non-installment event/trip checkout unchanged | **Done by construction.** Trip branch is gated on `event_type='trip' AND tier_metadata->'installments' IS NOT NULL`; finalize installment branch is gated on `p_installment_plan_root AND v_schedule IS NOT NULL`. Both default to legacy behavior when off. Regression test #7 asserts legacy fall-through. |

Other SCs (SC-1, 2, 4 Stage 1, 5a/5b/5c, 7, 8, 9, 10, 11, 12, 16, 18, 19, 20) are Stage 1 (done) or Stage 2 (pending).

---

## 6. Invariants

### Preserved
- **I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER (DRAFT, shipped Stage 1):** unchanged — no new installment-PI creation sites added; the cron at `process-scheduled-installments` remains the sole owner. Strict-grep gate continues to pass.
- **I-PROPOSED-TR3-INSTALLMENT-CUSTOMER-DURABILITY (DRAFT):** no `customers.del` or `paymentMethods.detach` call sites added.
- **I-PROPOSED-TR3-LEDGER-INVARIANT-COLLECTED-IMPLIES-PI-ID (DRAFT):** preserved by Stage 1 CHECK constraints; Stage 1b only INSERTs new rows as `status='scheduled'` so the CHECK isn't exercised.
- **I-PROPOSED-TR3-SCHEDULE-CURRENCY-PINNED-AT-PUBLISH (DRAFT):** preserved — finalize takes `currency` from the persisted `v_session.installment_schedule.currency` which is itself pinned to `v_session.currency` at create_session.
- **I-CHECKOUT-IDEMPOTENT (existing):** preserved — the create_session replay branch returns the existing session AND its persisted `installment_schedule` so retries get the same plan.

### New
None this stage.

---

## 7. Parity check
N/A — no solo/collab parity surface touched. All work is backend (DB + edge functions).

---

## 8. Cache safety
No React Query keys, no Zustand state, no client storage changes. New DB column `ticket_checkout_sessions.installment_schedule` is service-role-only-written, no client read.

---

## 9. Regression surface
Adjacent flows tester should re-verify:
1. **Non-installment trip checkout** — buyer purchases a Tr2 trip (no `tier_metadata.installments` on the pricing tier). Expected: order rows + tickets created, NO `order_installments` rows, `orders.installment_plan_root = false`, `orders.stripe_customer_id_on_connected_account` + `orders.saved_payment_method_id` both NULL.
2. **Non-installment event checkout (events table)** — buyer purchases a regular event ticket. Expected: same as above; trip-branch in create_session is short-circuited by `v_is_trip = false`.
3. **Free checkout** — `total_cents = 0` path from `ticket-checkout-create:170`. Expected: finalize runs with 5 named params, the 3 new params default to NULL/false, order created as `free`.
4. **Refund-then-rebuy flow (ORCH-0791 tombstone)** — buyer refunds and rebuys with same email+phone+event. Expected: existing `paid_completed` session tombstones, fresh session created. Verify `installment_schedule` does NOT leak from the tombstoned row.
5. **Past-expiry retry (ORCH-0829-B)** — buyer abandons checkout, returns >1hr later. Expected: stale session tombstones, fresh session.

Adjacent files NOT touched but worth eyeballing:
- `reconcile-stuck-checkouts/index.ts` — still passes 5 params (defaults to non-installment behaviour, safe). Stage 1c will update.
- `ticket-checkout-confirm/index.ts` — same. Stage 1c will update.

---

## 10. Constitutional compliance
- **1. No dead taps:** N/A (backend).
- **2. One owner per truth:** Schedule lives on `ticket_checkout_sessions.installment_schedule` only; copied into `order_installments` at finalize. No duplication.
- **3. No silent failures:** Installment finalize without customer or PM → `RAISE EXCEPTION installment_plan_finalize_missing_customer_or_pm`. Unknown dispatcher kind → HTTP 400.
- **4. One key per entity:** N/A (no client query keys).
- **5. Server state server-side:** N/A.
- **6. Logout clears everything:** N/A (no client state).
- **7. Label temporary:** No `[TRANSITIONAL]` markers added this stage. Stage 1c follow-ups documented below.
- **8. Subtract before adding:** Yes — DROPped the stale 5-arg finalize overload before adding the 8-arg form.
- **9. No fabricated data:** Schedule is read from DB, validated, NEVER invented.
- **10-14:** N/A (no client surface touched).

---

## 11. Transition items
None this stage.

---

## 12. Discoveries for orchestrator

1. **`reconcile-stuck-checkouts/index.ts` and `ticket-checkout-confirm/index.ts` still call finalize with 5 params.** They'll work (the 3 new params default to non-installment behaviour) but for an installment-plan PI that hits these secondary recovery paths instead of the webhook, the resulting order will be created WITHOUT `order_installments` rows and the cron will have nothing to charge. **Recommended: register Stage 1c follow-up to update both callers.** Low-likelihood race (these are recovery paths used when webhooks fail) but worth closing.

2. **`tripConfirmationEmail.ts` (Tr2 / ORCH-0859) shipped with the same `SenderIdentity { email, name }` bug as Stage 1's `installmentDunningEmail.ts`.** Fixed in this Stage 1b implementation. The bug was hidden because Tr2's dispatcher path was never type-checked end-to-end; importing the new installment renderers exposed it. Should orchestrator backfill ORCH-0859 close artifact to note this drift fix? Or roll into ORCH-0869 close.

3. **Migration uses `events.event_type`.** Verified present (Tr2 added it). For events with `event_type IS NULL`, the trip branch short-circuits (`v_is_trip = false`). Behaviour matches expectation.

4. **The `installment_schedule` JSONB on the session row carries computed cents amounts AND the percentages.** Tester adversarial test could probe: what if operator hand-edits the JSONB via direct SQL between create_session and finalize? Finalize trusts the persisted amounts and never re-derives from percentages — so an attacker with DB write access could shift money. This is a reasonable trade (we trust our own DB writes), but worth flagging as an "untrusted-trust-boundary" note.

5. **Stage 1's dispatcher routing via fetch(`/functions/v1/ticket-confirmation-dispatch`) from `installmentWebhookHandlers.ts`** depends on `SUPABASE_URL` env var being set inside the webhook handler. Verified set in the Supabase project (per Stage 1 cron probe). If env drifts, the dunning email silently fails (caught + `console.error`-logged, non-fatal). Stage 1c could promote this to a metric/audit row.

6. **The 4-section "Money tab" UI in SPEC §3.5.3** is Stage 2 scope. The schema + ledger + cron + webhook + email all work without it now — operators would query `order_installments` via SQL or admin console until UI lands.

---

## 13. Regression Test (ORCH-0840 mandatory gate)

- **Test path:** `supabase/functions/ticket-confirmation-dispatch/__tests__/installment_kinds.test.ts`
- **Passing run output:** `ok | 12 passed | 0 failed (5ms)` — see §4 above.
- **Fails-on-revert verified at:** commit `e17ca8db` (Merge remote-tracking branch 'origin/main' into Seth, current HEAD pre-Stage-1b commit). Stashing `supabase/functions/ticket-confirmation-dispatch/index.ts` returned the dispatcher to its Stage 1 state; all 12 tests FAILED. Restoring (stash pop) returned all 12 to PASS. Procedure documented in §4.
- **Shipped in same diff:** Test file + dispatcher modification + new email renderer + Stage 1 email type fix are all in the working tree on branch `Seth`. Will land together in the closing PR.

---

## 14. Files awaiting operator action

- **`supabase/migrations/20260610000002_tr3_ticket_checkout_session_installment_aware.sql`** awaits `supabase db push`. Operator runs the standard command:
  ```bash
  supabase db push
  ```
  The migration's self-verification probe raises EXCEPTION on any drift, so failure is loud.

- **Edge function deploys** (Codex orchestrator owns deploy-after-DB-push per `feedback_orchestrator_deploys_edge_functions.md`):
  ```bash
  supabase functions deploy stripe-webhook --project-ref gqnoajqerqhnvulmnyvv
  supabase functions deploy ticket-confirmation-dispatch --project-ref gqnoajqerqhnvulmnyvv
  ```
  (`stripeWebhookRouter.ts` is in `_shared/` — included via `stripe-webhook/index.ts` which imports it; redeploy of `stripe-webhook` picks up the shared-module change.)

  Note: `ticket-checkout-create` is NOT touched in Stage 1b (Stage 1 already shipped the `setup_future_usage` injection); no redeploy needed.

---

## 15. Cross-Surface Impact (per `feedback_cross_surface_impact_inspection.md`)

| # | Surface | In scope (Stage 1b) | Why / What |
|---|---|---|---|
| 1 | Consumer iOS | NO | Trips not on consumer app (Tr2 + Tr3 scope is mingla-business + buyer-anon web). |
| 2 | Consumer Android | NO | Same. |
| 3 | Buyer/anonymous Web (`mingla-business/app/checkout/*`) | NO Stage 1b code path touched | Edge functions only. The buyer-web routes call `ticket-checkout-create` (already updated Stage 1) and observe checkout via existing `ticket-checkout-confirm` polling. The new `installmentSchedule` field in the session JSONB is returned by the RPC but Stage 1b doesn't ship UI to render it — that's SC-5a/b/c (Stage 2 scope). |
| 4 | Business iOS | NO Stage 1b | UI work (PaymentPlanEditor, Money tab) is Stage 2. |
| 5 | Business Android | NO Stage 1b | Same. |
| 6 | Admin Web | NO | Admin trip-ops dashboards are a separate future ORCH. |
| 7 | Business Web preview | NO Stage 1b | Same as Business iOS/Android. |

**Stage 1b is backend-only.** All 7 surfaces are NOT touched by code in this stage; they will be touched by Stage 2 UI work. The cron-installment auto-charge flow becomes possible (Stage 1 + Stage 1b together) but buyers/operators still need Stage 2 UI to configure plans + see ledgers in-product.

---

End of Stage 1b implementation report.
