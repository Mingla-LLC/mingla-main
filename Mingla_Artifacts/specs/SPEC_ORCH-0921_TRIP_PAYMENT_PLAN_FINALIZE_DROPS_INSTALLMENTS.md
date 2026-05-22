# SPEC — ORCH-0921 [Trip payment-plan finalize silently drops `installment_plan_root` + child installments — €375/order revenue leak]

**Author:** Claude `mingla-forensics`
**Date:** 2026-05-22
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0921_TRIP_PAYMENT_PLAN_FINALIZE_DROPS_INSTALLMENTS.md`
**Confidence at SPEC time:** Investigation PROVEN; SPEC is bounded fix contract.

---

## 1. Scope

This SPEC defines the fix for two broken callers of the `biz_ticket_checkout_finalize` RPC that omit the 3 installment-plan parameters added at ORCH-0869 Stage 1B, causing every trip booking on a payment-plan tier to silently lose 75 % of its revenue (the installment portion never gets scheduled, the cron never charges).

### In-scope

1. **Edge function fix:** `supabase/functions/ticket-checkout-confirm/index.ts:263-272` — read PI metadata + pass all 8 params to finalize.
2. **Edge function fix:** `supabase/functions/reconcile-stuck-checkouts/index.ts:74-83` — same fix.
3. **Defense-in-depth migration:** amend `biz_ticket_checkout_finalize` to compare-and-correct on the second call when the first call left the order in a half-finalized state (idempotent self-heal).
4. **New strict-grep CI gate:** `i-proposed-finalize-callers-pass-installment-params.mjs` + workflow registration — scans `supabase/functions/` for `biz_ticket_checkout_finalize` invocations and asserts each call site references `p_installment_plan_root`.
5. **NEW invariant (DRAFT → flips ACTIVE on close):** `I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS`.
6. **Regression tests:** implementor happy-path (Deno test for both edge functions) + tester adversarial (race-condition Deno test).
7. **Operator-gated hot-fix backfill SQL** for order `47374d23-...` — written as an artifact in this SPEC, run by orchestrator out-of-band.

### Non-goals

1. **No changes to the cron** `process-scheduled-installments` — the cron is already correct; it just had no rows to process. Once installments are correctly written, the cron picks them up automatically.
2. **No changes to ORCH-0914 Money tab UI** — the UI is honest about what the DB has; once the DB is correct, the UI will correctly show outstanding amounts without any code change.
3. **No changes to the manual-charge-installment edge fn** (ORCH-0914) — preserve as recovery surface per Hard Guard 6.
4. **No changes to `ticket-checkout-create`** — the deposit PI metadata + session schedule persistence are already correct.
5. **No changes to `stripeWebhookRouter.ts`** — already calls finalize with all 8 params correctly.
6. **No changes to ORCH-0915 [Buyer pay-in-full opt-out]** — that's a separate UX feature shipped after this SPEC.
7. **No retroactive backfill of any leaker beyond order `47374d23-...`** — production audit returned exactly 1 leaker; SPEC's backfill SQL handles that single order only. If future audits surface more, run the same template per-order.

### Assumptions

1. The 2 broken callers' authentication context is the same as the webhook router's (service-role) — verified by reading the edge fn headers.
2. The PaymentIntent metadata `mingla_installment_plan_root="true"` is reliably set on every deposit PI created by `ticket-checkout-create` for payment-plan tiers — verified at edge fn line 492 (apple-pay path) + 664 (card path).
3. The Stripe Customer ID + saved PaymentMethod ID are reliably present on the deposit PI when `mingla_installment_plan_root=true` (because `ticket-checkout-create` already sets the PI to save the PM for off-session per ORCH-0869 contract) — verified via `paymentIntent.customer` + `paymentIntent.payment_method` field presence on succeeded PIs.
4. `process-scheduled-installments` cron will pick up correctly-written `order_installments` rows on its next run with no modification — verified by reading the cron source.
5. The `biz_ticket_checkout_finalize` 8-param signature is stable; no caller will need a different signature for the foreseeable future.

---

## 2. Cross-Surface Impact Inspection (mandatory Phase 2.5)

### Surfaces COVERED by this SPEC

| Surface | User-visible behavior | Files touched | Parity |
|---|---|---|---|
| **Buyer/anonymous Web** (`mingla-business/` `/checkout-trip/{tripEventId}/confirm`) | Buyer who chose a payment plan now correctly sees their plan tracked in the planner's Money tab + future installments auto-charge on schedule. Buyer-facing UI on `confirm.tsx` is unchanged (still shows tickets + confirmation hero); the change is invisible to the buyer. | `supabase/functions/ticket-checkout-confirm/index.ts`, `supabase/migrations/<NEW>_orch_0921_finalize_compare_and_correct.sql` | Automatic — shared edge fn |
| **Business iOS** (`mingla-business/` native) | Native PaymentSheet deep-link return flow also calls `ticket-checkout-confirm` (per DISC-0921-B in the investigation), so the fix at the edge fn closes this path simultaneously. Operators (planners) see correct per-traveller plan state in the Hub → Trips → Payments tab. | Same edge fn (no native code change) | Automatic — shared edge fn |
| **Business Android** (`mingla-business/` native) | Same as Business iOS. | Same edge fn | Automatic — shared edge fn |
| **Business Web preview** (`mingla-business/` dev/web build) | Same as Buyer/anonymous Web for the buyer-facing checkout flow; same as Business iOS/Android for the operator-facing Money tab. | Same edge fn | Automatic — shared edge fn |
| **Admin Web** (`mingla-admin/`) | Audit-log labels added at ORCH-0914 (`INSTALLMENT_CHARGED_MANUALLY`, `INSTALLMENT_REMINDER_SENT`) continue to render correctly. No new admin surfaces. | None (no admin diff) | N/A |

### Surfaces NOT covered

| Surface | Why not in scope |
|---|---|
| **Consumer iOS** (`app-mobile/` on iOS) | Consumer app has no trip-checkout flow; trip purchases happen via business buyer-web or business-app. Zero diff. |
| **Consumer Android** (`app-mobile/` on Android) | Same as Consumer iOS. Zero diff. |

### Parity verdict

Parity is **AUTOMATIC** across all 4 covered surfaces because the fix lives in a shared edge function (`ticket-checkout-confirm`) and a shared SQL migration. No per-surface code paths exist for the fix itself. Tester `mingla-tester` parity-enforcement step 7 must still verify on iOS sim + Android emu + Vercel-web by reproducing a payment-plan trip purchase on each surface and confirming the post-fix `orders` + `order_installments` rows are correctly populated — but the SPEC does not need per-surface SC variants (no SC-N-iOS / SC-N-Android / SC-N-Web split required).

---

## 3. Per-layer specifications

### 3.1 Database layer — migration `<timestamp>_orch_0921_finalize_compare_and_correct.sql`

Migration filename must be monotonic-greater than current head. As of 2026-05-22 the latest migration is `20260723000001_orch_0914_manual_charge_installment.sql`. Use timestamp `20260724000000_orch_0921_finalize_compare_and_correct.sql` (next-day at 00:00:00).

**Action 1 — `CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_finalize`:**

Same signature as the current 8-param version at `20260710000000_orch_0897_trip_event_group_chat.sql:220-228`. Body changes ONLY at the early-return guard (current lines 268-291) — replace with a compare-and-correct branch:

```sql
-- ORCH-0921: replace the silent early-return with compare-and-correct.
-- When the second caller passes p_installment_plan_root=true AND the
-- existing order row has installment_plan_root=false AND the session
-- carries an installment_schedule AND zero order_installments rows exist,
-- backfill the missing installment-plan state. Idempotent: re-running
-- after the backfill is a no-op (the EXISTS check prevents duplicate
-- INSERTs; the flag check prevents redundant UPDATEs).
IF v_session.order_id IS NOT NULL THEN
  IF p_installment_plan_root
     AND v_session.installment_schedule IS NOT NULL
     AND p_stripe_customer_id_on_connected_account IS NOT NULL
     AND p_saved_payment_method_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.order_installments
       WHERE order_id = v_session.order_id
     )
  THEN
    -- Self-heal: write the installment rows + flip the flag + set the PM.
    v_schedule := v_session.installment_schedule;
    v_inst_array := v_schedule -> 'installments';
    v_inst_currency := COALESCE((v_schedule ->> 'currency')::char(3), v_session.currency);
    v_inst_count := COALESCE(jsonb_array_length(v_inst_array), 0);

    FOR v_idx IN 0 .. v_inst_count - 1 LOOP
      v_inst_item := v_inst_array -> v_idx;
      v_inst_amount := COALESCE((v_inst_item ->> 'amountCents')::bigint, 0);
      v_inst_due := (v_inst_item ->> 'dueAt')::timestamptz;
      IF v_inst_amount <= 0 THEN
        RAISE EXCEPTION 'installment_amount_invalid';
      END IF;
      INSERT INTO public.order_installments (
        order_id, ordinal, amount_cents, currency, due_at, status
      ) VALUES (
        v_session.order_id,
        (v_inst_item ->> 'ordinal')::smallint,
        v_inst_amount,
        v_inst_currency,
        v_inst_due,
        'scheduled'
      );
    END LOOP;

    UPDATE public.orders
       SET installment_plan_root = true,
           stripe_customer_id_on_connected_account = p_stripe_customer_id_on_connected_account,
           saved_payment_method_id = p_saved_payment_method_id,
           updated_at = now()
     WHERE id = v_session.order_id;
  END IF;

  -- Return the (possibly self-healed) order's tickets.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ticketId', t.id,
    'ticketTypeId', t.ticket_type_id,
    'ticketName', tt.name,
    'qrPayload', t.qr_code,
    'status', t.status
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
    'notificationStatus', 'queued',
    'installmentPlanRoot', (
      SELECT installment_plan_root FROM public.orders WHERE id = v_session.order_id
    )
  );
END IF;
```

The rest of the function body (lines 293-457 of the current definition) is **unchanged** — same INSERT, same line-items, same tickets, same chat helper, same notifications.

**Action 2 — REVOKE + GRANT** to `service_role` as before (lines 461-466 of current definition).

**Action 3 — Self-verification probe** at the end of the migration:

```sql
DO $$
BEGIN
  -- Confirm the new function exists with exactly one overload at 8 params.
  IF (SELECT COUNT(*) FROM pg_proc WHERE proname = 'biz_ticket_checkout_finalize' AND pronargs = 8) <> 1 THEN
    RAISE EXCEPTION 'ORCH-0921 self-verify: expected exactly 1 biz_ticket_checkout_finalize overload with 8 params';
  END IF;
END$$;
```

**No new tables, no new columns, no RLS changes.** Migration is additive at the DDL level (only `CREATE OR REPLACE FUNCTION`).

### 3.2 Edge function fix — `supabase/functions/ticket-checkout-confirm/index.ts`

**File + line:** `supabase/functions/ticket-checkout-confirm/index.ts:263-272`.

**Current code:**
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

**Spec'd replacement:**
```ts
// ORCH-0921: pass installment-plan params through so payment-plan trip
// checkouts get their installments scheduled. Mirror the webhook router's
// pattern at stripeWebhookRouter.ts:778-784. Non-installment PIs leave
// these params null/false and the legacy finalize path runs unchanged.
const piMetadata = (paymentIntent.metadata as Record<string, unknown> | undefined) ?? {};
const isInstallmentPlanRoot = piMetadata["mingla_installment_plan_root"] === "true";
const stripeCustomerId = isInstallmentPlanRoot
  ? (typeof paymentIntent.customer === "string" ? paymentIntent.customer : null)
  : null;
const savedPaymentMethodId = isInstallmentPlanRoot
  ? (typeof paymentIntent.payment_method === "string" ? paymentIntent.payment_method : null)
  : null;
const { error: finalizeError } = await supabase.rpc(
  "biz_ticket_checkout_finalize",
  {
    p_checkout_session_id: session.id,
    p_stripe_payment_intent_id: paymentIntentId,
    p_stripe_charge_id: latestChargeId,
    p_stripe_payment_method_type: paymentMethodType,
    p_qr_token_pepper: pepper,
    p_stripe_customer_id_on_connected_account: stripeCustomerId,
    p_saved_payment_method_id: savedPaymentMethodId,
    p_installment_plan_root: isInstallmentPlanRoot,
  },
);
```

No other changes to this file. The `paymentIntent` variable is already in scope (retrieved earlier in the function).

### 3.3 Edge function fix — `supabase/functions/reconcile-stuck-checkouts/index.ts`

**File + line:** `supabase/functions/reconcile-stuck-checkouts/index.ts:74-83`.

**Current code:** (5-param call — see investigation R-2)

**Spec'd replacement:** mirror the same pattern as §3.2 but use `pi.metadata`, `pi.customer`, `pi.payment_method` (the variable is named `pi` in this file, not `paymentIntent`):

```ts
// ORCH-0921: pass installment-plan params through so payment-plan trip
// checkouts get their installments scheduled even on the recovery path.
const piMetadata = (pi.metadata as Record<string, unknown> | undefined) ?? {};
const isInstallmentPlanRoot = piMetadata["mingla_installment_plan_root"] === "true";
const stripeCustomerId = isInstallmentPlanRoot
  ? (typeof (pi as unknown as { customer?: unknown }).customer === "string"
      ? String((pi as unknown as { customer: string }).customer)
      : null)
  : null;
const savedPaymentMethodId = isInstallmentPlanRoot
  ? (typeof (pi as unknown as { payment_method?: unknown }).payment_method === "string"
      ? String((pi as unknown as { payment_method: string }).payment_method)
      : null)
  : null;
const { data: finalized, error: finalizeError } = await supabase.rpc(
  "biz_ticket_checkout_finalize",
  {
    p_checkout_session_id: sessionId,
    p_stripe_payment_intent_id: piId,
    p_stripe_charge_id: chargeId,
    p_stripe_payment_method_type: methodType,
    p_qr_token_pepper: pepper,
    p_stripe_customer_id_on_connected_account: stripeCustomerId,
    p_saved_payment_method_id: savedPaymentMethodId,
    p_installment_plan_root: isInstallmentPlanRoot,
  },
);
```

No other changes to this file.

### 3.4 New strict-grep CI gate — `.github/scripts/strict-grep/i-proposed-finalize-callers-pass-installment-params.mjs`

**File:** new file at the path above.

**Behavior:** scan all `.ts` files under `supabase/functions/` (excluding `__tests__/` dirs). For each occurrence of `supabase.rpc("biz_ticket_checkout_finalize"` (with single or double quotes), check the next 30 lines (the RPC call payload object) for a literal `p_installment_plan_root` key. If not found, AND no `// orch-strict-grep-allow finalize-no-plan-root — <reason>` opt-out comment exists in the surrounding 5 lines, fail with a clear message naming the file + line.

**Output format:** matches existing gate convention (see `.github/scripts/strict-grep/i-proposed-manual-installment-action-via-shared-helper.mjs` shipped at ORCH-0914 as the reference pattern).

**Exit codes:** 0 on pass, 1 on violation, 2 on filesystem error.

**Workflow registration:** add a new job to `.github/workflows/strict-grep-mingla-business.yml` mirroring the existing `i-proposed-manual-installment-action-via-shared-helper` block (also added at ORCH-0914 — that's the canonical reference).

### 3.5 NEW invariant — `I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS`

Status: DRAFT — flips ACTIVE on ORCH-0921 close (after tester PASS + orchestrator CLOSE protocol).

**Text:** "Every `supabase.rpc('biz_ticket_checkout_finalize', ...)` invocation under `supabase/functions/` MUST include `p_installment_plan_root` in the call payload (either as a derived boolean value or with an explicit `// orch-strict-grep-allow finalize-no-plan-root — <reason>` opt-out comment in the surrounding 5 lines). This prevents future drift where a new caller silently defaults the param to `false` and drops the installment-plan persistence for trip payment-plan checkouts."

**Enforcement:** strict-grep CI gate at `.github/scripts/strict-grep/i-proposed-finalize-callers-pass-installment-params.mjs` (§3.4).

**Registry entry on close:** orchestrator adds row to `Mingla_Artifacts/INVARIANT_REGISTRY.md` with ID `I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS`, status `ACTIVE`, enforcement `CI gate (strict-grep)`, ORCH ref `ORCH-0921`.

### 3.6 Hot-fix backfill SQL — operator-gated, run out-of-band by orchestrator

This SQL is NOT part of the migration. It is a one-shot operator-gated repair for the single known leaker (order `47374d23-...`). Orchestrator runs it via Supabase MCP `execute_sql` AFTER the SPEC is approved + BEFORE the implementor's code fix lands (so the existing cron picks up Jun 21 + Jul 21 charges automatically).

```sql
-- ORCH-0921 backfill — repair the one known leaker.
-- Source of truth: ticket_checkout_sessions.installment_schedule for the session
-- that produced this order. Idempotent via NOT EXISTS guard + the WHERE clause
-- on UPDATE. Re-running is a no-op.

-- Step 1: INSERT the 2 missing installment rows from the session schedule.
INSERT INTO public.order_installments (
  order_id, ordinal, amount_cents, currency, due_at, status
)
SELECT
  '47374d23-2547-4709-a967-cee172fb877c'::uuid,
  (inst ->> 'ordinal')::smallint,
  (inst ->> 'amountCents')::bigint,
  COALESCE((s.installment_schedule ->> 'currency')::char(3), s.currency),
  (inst ->> 'dueAt')::timestamptz,
  'scheduled'
FROM public.ticket_checkout_sessions s,
     jsonb_array_elements(s.installment_schedule -> 'installments') AS inst
WHERE s.id = '60e8d83b-0d45-41c3-8f8a-80a9ffd5e54b'
  AND NOT EXISTS (
    SELECT 1 FROM public.order_installments
    WHERE order_id = '47374d23-2547-4709-a967-cee172fb877c'
  );

-- Step 2: flip installment_plan_root + populate Stripe Customer + saved PM
-- on the order row. Source: the Stripe PI's customer + payment_method fields.
-- Operator must inspect the PI 'pi_xxx' (from orders.stripe_payment_intent_id
-- for order 47374d23) and fill in the literals below from Stripe Dashboard.
UPDATE public.orders
   SET installment_plan_root = true,
       stripe_customer_id_on_connected_account = '<paste cus_xxx from Stripe>',
       saved_payment_method_id = '<paste pm_xxx from Stripe>',
       updated_at = now()
 WHERE id = '47374d23-2547-4709-a967-cee172fb877c'
   AND installment_plan_root = false;

-- Step 3: verify post-state.
SELECT
  o.id,
  o.total_cents,
  o.installment_plan_root,
  o.stripe_customer_id_on_connected_account IS NOT NULL AS has_customer,
  o.saved_payment_method_id IS NOT NULL AS has_pm,
  (SELECT COUNT(*) FROM order_installments oi WHERE oi.order_id = o.id) AS installment_count,
  (SELECT SUM(amount_cents) FROM order_installments oi WHERE oi.order_id = o.id) AS installment_total_cents
FROM public.orders o
WHERE o.id = '47374d23-2547-4709-a967-cee172fb877c';
-- Expected: total_cents=12500, installment_plan_root=true, has_customer=true,
-- has_pm=true, installment_count=2, installment_total_cents=37500.
```

After backfill, the existing cron at `process-scheduled-installments` will pick up the 2 new rows on its next run; they will be charged off-session on Jun 21 (€250) + Jul 21 (€125) via the existing helper at `supabase/functions/_shared/installments/createInstallmentPI.ts` (shipped at ORCH-0914). No further intervention needed.

---

## 4. Success criteria (testable, atomic)

| SC | Description | Verification |
|---|---|---|
| **SC-01** | After the fix lands, `ticket-checkout-confirm/index.ts:~263` call to `biz_ticket_checkout_finalize` includes all 8 parameters: 5 existing + `p_stripe_customer_id_on_connected_account` + `p_saved_payment_method_id` + `p_installment_plan_root`. | Grep + read; implementor happy-path Deno test asserts the call payload shape. |
| **SC-02** | After the fix lands, `reconcile-stuck-checkouts/index.ts:~74` call to `biz_ticket_checkout_finalize` includes all 8 parameters (same shape as SC-01). | Same as SC-01. |
| **SC-03** | When the buyer pays a payment-plan deposit and lands on `/checkout-trip/{tripEventId}/confirm?cs=...`, the resulting `orders` row has `total_cents = deposit_cents` (unchanged), `installment_plan_root = true`, `stripe_customer_id_on_connected_account IS NOT NULL`, `saved_payment_method_id IS NOT NULL`. | Live-fire on Vercel preview by tester: pay €125 via Stripe test mode, query `orders` after, assert all 4 fields. |
| **SC-04** | After the same scenario (SC-03), `order_installments` has exactly N rows where N = `jsonb_array_length(session.installment_schedule -> 'installments')`. Each row's `amount_cents`, `due_at`, `ordinal`, and `currency` match the session's `installment_schedule.installments[i]`. Each row's `status = 'scheduled'`. | Live-fire query after SC-03. |
| **SC-05** | When `reconcile-stuck-checkouts` runs against a stuck session with a successful payment-plan deposit PI, the resulting order satisfies SC-03 + SC-04. | Deno test: mock a stuck session + PI with `mingla_installment_plan_root=true`, run reconcile, assert order + installments. |
| **SC-06** | When `biz_ticket_checkout_finalize` is called a SECOND time on a session that already has an order in the half-finalized state (`installment_plan_root=false`, zero installments), AND the second caller passes `p_installment_plan_root=true` + non-null customer + non-null PM, the order is updated to `installment_plan_root=true` AND the 2 (or N) installment rows are written. Compare-and-correct path. | Deno test: insert a half-finalized order, call finalize, assert post-state. Also covered by tester adversarial race test (SC-09). |
| **SC-07** | Calling the compare-and-correct path a THIRD time (after SC-06) is a no-op: `installment_plan_root` stays `true`, no duplicate `order_installments` rows are inserted (`COUNT(*)` stays at N). Idempotency proof. | Deno test: run SC-06 setup, call finalize twice, assert post-state matches single-call post-state. |
| **SC-08** | The strict-grep gate `i-proposed-finalize-callers-pass-installment-params` exits 0 with the post-fix codebase (scans 1 correct caller + 2 newly-correct callers, finds 3 valid invocations, zero violations). | CI run + local `node .github/scripts/strict-grep/i-proposed-finalize-callers-pass-installment-params.mjs`. |
| **SC-09** | The strict-grep gate FAILS (exit 1) when a synthetic test fixture injects a 4th caller that omits `p_installment_plan_root`. Adversarial proof that the gate actually catches drift. | Adversarial Deno/Node test that spawns the gate against a tmp-dir fixture with the violation present + asserts non-zero exit. |
| **SC-10** | After the fix, the cron `process-scheduled-installments` charges the 2 backfilled installments for order `47374d23-...` on Jun 21 and Jul 21 successfully (€250 + €125 → €375 recovered). | Operator-gated runtime observation; not a Deno test (requires real Stripe Customer + saved PM in production). Verification: query `order_installments` for the order on Jun 22 + Jul 22 and assert `status='collected'` + `collected_at IS NOT NULL`. |
| **SC-11** | After the fix, the orchestrator's DB-wide audit query (read-only) returns ZERO leakers (the known leaker has been backfilled; the fix prevents new leakers). | Re-run the audit SQL from the investigation report. |
| **SC-12** | Backfill compatibility: the SPEC's hot-fix SQL at §3.6 can be run BEFORE the code fix lands (orchestrator schedules backfill out-of-band) without breaking the compare-and-correct path in the migration. Re-running finalize after backfill is a no-op (SC-07 covers this). | Conceptual proof: backfill writes the same shape the compare-and-correct branch would write; the NOT EXISTS guard in §3.1 prevents duplicate INSERTs. Demonstrated by SC-07. |
| **SC-13** | Non-installment-plan event/trip checkouts continue to work unchanged. Legacy fall-through path is preserved. | Deno test: mock a non-plan PI (no `mingla_installment_plan_root` metadata key), call finalize via both confirm + webhook + reconcile paths, assert `installment_plan_root=false`, zero installments, order created normally. |
| **SC-14** | The 13/13 ORCH-0914 Deno cron regression tests at `supabase/functions/process-scheduled-installments/__tests__/` continue to PASS. | Re-run Deno tests post-implementor. |
| **SC-15** | The 33/33 ORCH-0914 + 41/41 ORCH-0919 + 19/19 ORCH-0914-edge-fn jest/Deno regression tests shipped this week continue to PASS. | Re-run full suites post-implementor. |
| **SC-16** | The migration `20260724000000_orch_0921_finalize_compare_and_correct.sql` self-verification probe passes (exactly 1 8-param overload of `biz_ticket_checkout_finalize` exists post-migration). | Probe runs inside the migration; `supabase db push` fails loudly if violated. |
| **SC-17** | The new invariant `I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS` is registered in `Mingla_Artifacts/INVARIANT_REGISTRY.md` with ACTIVE status post-close. | Orchestrator CLOSE checklist Step 1.5e. |
| **SC-18** | Tester parity-enforcement: live-fire on (a) buyer-anonymous web via Vercel preview, (b) business iOS sim, (c) business Android emu. All 3 produce identical correct DB state. | Tester `mingla-tester` parity check step 7. |

---

## 5. Invariants

### Invariants this fix MUST preserve

| Invariant | How preserved |
|---|---|
| `I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER` (ORCH-0869, ORCH-0914 update) | No new caller of `paymentIntents.create(...)` with `mingla_installment_id` metadata is introduced. The fix only adds parameters to existing finalize callers. |
| `I-PROPOSED-MANUAL-INSTALLMENT-ACTION-VIA-SHARED-HELPER` (ORCH-0914) | Manual-charge edge fn untouched. |
| `I-PROPOSED-TR3-PLAN-DISCLOSURE-ON-EVERY-BUYER-TOUCHPOINT` (ORCH-0882) | Buyer-facing checkout disclosure unchanged. |
| ORCH-0852 sync-confirm + Realtime architecture | The fix adds 3 RPC params at the same call site; the surrounding sync-confirm + Realtime fallback architecture is unchanged. |
| Finalize idempotency on second call | The compare-and-correct branch preserves idempotency via NOT EXISTS guard + WHERE clause on UPDATE. Re-running after a successful first call is a no-op (SC-07). |
| The 13/13 cron Deno regression tests | Cron source unchanged; tests continue to PASS. |

### NEW invariants (DRAFT → ACTIVE on close)

| Invariant ID | Text | Enforcement |
|---|---|---|
| `I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS` | See §3.5 | Strict-grep CI gate at `.github/scripts/strict-grep/i-proposed-finalize-callers-pass-installment-params.mjs` |

---

## 6. Test cases

### Implementor happy-path tests (Deno + Node where applicable)

| Test | Path | Scenario | Assertion |
|---|---|---|---|
| T-01 | `supabase/functions/ticket-checkout-confirm/__tests__/orch_0921_installment_params.test.ts` | Mock PaymentIntent with `mingla_installment_plan_root="true"` metadata + customer + payment_method, call the handler, capture the `supabase.rpc` payload | Payload includes `p_installment_plan_root: true`, `p_stripe_customer_id_on_connected_account: "cus_xxx"`, `p_saved_payment_method_id: "pm_xxx"` |
| T-02 | Same file | Mock PaymentIntent WITHOUT the metadata key | Payload includes `p_installment_plan_root: false`, `p_stripe_customer_id_on_connected_account: null`, `p_saved_payment_method_id: null` (legacy fall-through) |
| T-03 | `supabase/functions/reconcile-stuck-checkouts/__tests__/orch_0921_installment_params.test.ts` | Mock stuck session + PI with `mingla_installment_plan_root="true"` | Payload includes all 3 installment params populated |
| T-04 | Same file | Mock stuck session + PI without metadata key | Payload includes the 3 params with null/false (legacy fall-through) |
| T-05 | `supabase/functions/_shared/__tests__/orch_0921_compare_and_correct.test.ts` (or a migration self-test) | Insert a half-finalized order + session with schedule, call finalize with correct params via the RPC | Order's `installment_plan_root = true`, exactly N `order_installments` rows match the session schedule |
| T-06 | Same file | Call finalize a SECOND time on the just-self-healed order | No duplicate rows, no flag flip, no error (idempotency) |
| T-07 | Same file | Insert a fully-finalized order + call finalize again | Returns existing data with no modifications (legacy idempotency path preserved for cases where the order was correct from the start) |
| T-08 | New strict-grep gate self-test | Run the gate against the post-fix codebase | Exit 0, "scanned N files, 0 violations" |
| T-09 | New strict-grep gate self-test | Run the gate against a tmp-dir fixture with a 4th caller missing the param | Exit 1, violation reported |

All T-01..T-09 must have **fails-on-revert verification by the implementor** per ORCH-0840 Step 0.5 (cite commit hash in implementation report).

### Tester adversarial tests (different angles)

| Test | Angle | Scenario | Assertion |
|---|---|---|---|
| T-A01 | Race condition | Simulate sync-confirm winning the race: call confirm fn first, then webhook fn second, both with same PI + session | Final order state: `installment_plan_root=true`, all installments written (sync-confirm seeded them; webhook compare-and-correct path is a no-op the second time) |
| T-A02 | Race condition reversed | Simulate webhook winning the race: webhook fires first, then sync-confirm fires second | Same end state as T-A01 (webhook seeded correctly the first time; sync-confirm's second call is the legacy idempotency path) |
| T-A03 | Cross-table read miss prevention | Insert a session with NULL `installment_schedule` (non-plan tier) + call finalize via the new path with `p_installment_plan_root=true` | Should fail with `installment_plan_finalize_missing_customer_or_pm` OR (if customer/PM passed) should NOT write installments AND NOT flip flag — because `v_schedule IS NOT NULL` guard fails. Existing behaviour preserved. |
| T-A04 | Backfill compatibility | Insert a half-finalized order, run the §3.6 backfill SQL, then call finalize with correct params (compare-and-correct path) | Compare-and-correct is a no-op (rows already exist per NOT EXISTS guard); flag is already true per WHERE guard. Order state unchanged. |
| T-A05 | Strict-grep gate functional | Spawn the new gate as a subprocess against a tmp-fixture that contains a 4th caller missing the param | Non-zero exit, violation message includes the fixture's file path + line |
| T-A06 | Strict-grep gate allowlist | Spawn the gate against a fixture with a caller that omits the param BUT has the `// orch-strict-grep-allow finalize-no-plan-root — test reason` opt-out comment | Exit 0, no violation (opt-out respected) |
| T-A07 | Native app parity | (manual sim test) — purchase a payment-plan trip ticket on business iOS via PaymentSheet → deep-link return → confirm.tsx fires → query `orders` + `order_installments` | Order state matches SC-03 + SC-04 |
| T-A08 | Native app parity (Android) | Same as T-A07 on Android emu | Same |
| T-A09 | Buyer-web parity | (Vercel preview) — purchase a payment-plan trip ticket on buyer-anon-web via Stripe test card | Same |

T-A01..T-A09 must **attack different angles from the implementor's T-01..T-09**; copy-with-rename is forbidden per ORCH-0840 discipline.

### Operator-runnable verification post-deploy

| Step | Action | Expected |
|---|---|---|
| OP-1 | Re-run the audit SELECT from the investigation report | 0 leakers |
| OP-2 | Run the §3.6 backfill SQL for order `47374d23-...` (after looking up `cus_xxx` + `pm_xxx` in Stripe Dashboard) | 2 `order_installments` rows inserted, `installment_plan_root=true`, verification SELECT returns expected post-state |
| OP-3 | On Jun 22 + Jul 22, query `order_installments` for order `47374d23-...` | Both rows show `status='collected'`, `collected_at IS NOT NULL` (€375 recovered) |
| OP-4 | Make a test payment-plan trip purchase end-to-end on Vercel preview + buyer-web | Post-purchase: order has `installment_plan_root=true`, N installments scheduled, ORCH-0914 Money tab shows correct outstanding |

---

## 7. Implementation order

Sequential per operator one-step-at-a-time rule:

1. **Migration first.** Write `supabase/migrations/20260724000000_orch_0921_finalize_compare_and_correct.sql` per §3.1. Run `deno check` + targeted Deno tests for the finalize RPC mock if any exist.
2. **Strict-grep gate next.** Write `.github/scripts/strict-grep/i-proposed-finalize-callers-pass-installment-params.mjs` per §3.4 + register in workflow. Run locally against pre-fix code to confirm it FAILS (proves gate catches the bug). Run against an inline test fixture for the allowlist behaviour.
3. **Edge fn fixes.** Update `ticket-checkout-confirm/index.ts` per §3.2 + `reconcile-stuck-checkouts/index.ts` per §3.3. Run local strict-grep gate — should now PASS.
4. **Implementor happy-path tests** per §6 T-01..T-09. Verify fails-on-revert by stashing the edge-fn fixes + re-running tests (must FAIL on revert) + restoring fixes + re-running (must PASS). Cite commit hash in implementation report.
5. **Run all existing Deno tests** to confirm no regression: `deno test supabase/functions/process-scheduled-installments/__tests__/` (13/13) + `deno test supabase/functions/manual-charge-installment/__tests__/` + `deno test supabase/functions/send-installment-reminder/__tests__/` + `deno test supabase/functions/ticket-checkout-confirm/__tests__/` (if any).
6. **Implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0921_TRIP_PAYMENT_PLAN_FINALIZE_DROPS_INSTALLMENTS.md` per the implementor skill's template (old → new receipts, spec traceability, invariant verification, cache safety, regression surface, regression test paths + fails-on-revert commit hashes).
7. **Operator runs `supabase db push --linked`** to ship the migration to remote.
8. **Orchestrator deploys** `ticket-checkout-confirm` + `reconcile-stuck-checkouts` edge fns (preserving each one's `verify_jwt` setting — `ticket-checkout-confirm` is typically `verify_jwt: false` since it's a buyer-anon endpoint; `reconcile-stuck-checkouts` is typically a cron-invoked endpoint also `verify_jwt: false` — confirm both via `supabase/config.toml` before deploy).
9. **Orchestrator runs the §3.6 backfill SQL** for order `47374d23-...` after looking up `cus_xxx` + `pm_xxx` in Stripe Dashboard. Operator-gated step.
10. **Claude `mingla-tester` TEST mode dispatch** — runs adversarial T-A01..T-A09 + live-fire on (a) Vercel preview + (b) business iOS sim + (c) business Android emu.
11. **On tester PASS → orchestrator CLOSE** per standard protocol (Step 0.5 regression gate, Step 1 artifact sync, Step 1.5 DIAG reap, Step 2 commit with `[deploy]` tag if needed — likely not, since this is backend-only and the front-end Money tab will auto-update from honest data with no Vercel rebuild required, but include it if any `mingla-business/src/` file is touched).
12. **EAS OTA** — likely NOT NEEDED (backend-only fix; ORCH-0914 mobile UI is unchanged). Skip per Step 3 of CLOSE protocol unless implementor inadvertently touches mobile code.

---

## 8. Regression prevention

| Mechanism | Coverage |
|---|---|
| **Strict-grep CI gate** `I-PROPOSED-FINALIZE-CALLERS-PASS-INSTALLMENT-PARAMS` | Catches any future caller drift at PR time, before merge |
| **Compare-and-correct branch** in the finalize RPC | Self-heals any half-finalized order if a future caller bug ships despite the gate (defense in depth) |
| **Implementor T-01..T-09** | Pin the call-payload shape at both fixed callers + the compare-and-correct branch + the gate functionality |
| **Tester T-A01..T-A09** | Attack the race conditions and parity surfaces (iOS sim + Android emu + Vercel-web) |
| **DB-wide audit query** documented in the investigation | Operator can re-run periodically to confirm zero new leakers post-fix |
| **DRAFT → ACTIVE invariant** in `INVARIANT_REGISTRY.md` | Documents the contract for future engineering reference |

---

## 9. Hard guards (NON-NEGOTIABLE)

1. **No changes to `process-scheduled-installments` cron.** Already correct.
2. **No changes to `stripeWebhookRouter.ts` finalize call site.** Already correct.
3. **No changes to `ticket-checkout-create` deposit PI metadata or session schedule persistence.** Already correct.
4. **No changes to ORCH-0914 manual-charge-installment edge fn.** Preserve as recovery surface.
5. **No changes to ORCH-0914 Money tab UI.** It is honest about DB state; the fix makes the DB correct.
6. **No changes to ORCH-0852 sync-confirm + Realtime architecture.** Only the RPC call payload is amended at the existing call site.
7. **No new tables, no new columns, no RLS changes.** Migration is `CREATE OR REPLACE FUNCTION` only.
8. **No `supabase db push` from implementor.** Operator-only per orchestrator deploy split.
9. **No edge function deploys from implementor.** Orchestrator-only per orchestrator deploy split.
10. **Idempotency MUST hold.** Re-running finalize after a successful first call (legacy or compare-and-correct path) must be a no-op. SC-07 enforces.
11. **Backfill compatibility MUST hold.** The §3.6 hot-fix SQL must be runnable before OR after the code fix lands without breaking anything. SC-12 + T-A04 enforce.
12. **`verify_jwt` settings on deployed edge fns must be preserved** per orchestrator standing rule. Verify via `supabase/config.toml` before deploy.
13. **Test files immutable post-landing** per ORCH-0840 append-only rule. T-01..T-09 + T-A01..T-A09 become immutable once merged. Modifications require `[TEST-MOD-APPROVED ORCH-NNNN]` token in commit body.
14. **One PR per CLOSE** per `feedback_one_pr_per_close.md`. ORCH-0921 ships in its own PR from `Seth` to `main`; do not bundle with ORCH-0915 or anything else.
15. **No scope creep into ORCH-0915.** ORCH-0915 [Buyer pay-in-full opt-out] is the next dispatch after ORCH-0921; this SPEC does NOT touch the buyer-facing opt-out UX.

---

## 10. Deferred / out-of-scope items

| Item | Why deferred | Where it goes |
|---|---|---|
| Process improvement: auto-tracked "follow-up will update" language in implementation reports | DISC-0921-A from investigation; bigger orchestration-skill change, not in ORCH-0921 scope | Operator may register as META-ORCH-NNNN |
| Audit of other trip-checkout edge functions for "assumed event-only" gaps | DISC-0921-C from investigation; broader audit | Operator may register as ORCH-NNNN follow-up |
| Backfill of any leakers beyond order `47374d23-...` | Production audit returned exactly 1 leaker; SPEC handles that one. If future audits surface more, run the same template per-order | Operator-gated, repeatable |
| ORCH-0915 [Buyer pay-in-full opt-out] | Separate UX feature; queued as next dispatch | Already in priority board |

---

## Summary

Fix 2 edge function callers to pass 3 missing parameters (the same 3 the webhook router already passes correctly). Add a self-heal branch to the finalize RPC so any future caller drift doesn't silently leak. Add a CI gate so the drift can't ship in the first place. Backfill the one known production leaker via operator-gated SQL. Zero changes to UI, schema (other than `CREATE OR REPLACE FUNCTION`), RLS, or any other edge function. 18 success criteria, 18 test cases, 1 NEW invariant. Live-fire confirmation runs in TEST phase via `mingla-tester` on Vercel preview + iOS sim + Android emu. Ready for Codex `implementor-mingla` dispatch.
