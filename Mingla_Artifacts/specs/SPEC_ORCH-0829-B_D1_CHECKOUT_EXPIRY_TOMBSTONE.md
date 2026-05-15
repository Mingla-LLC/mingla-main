# SPEC — ORCH-0829-B D-1: Checkout-session expiry tombstone + handleBuy try/finally + PaymentSheet timeout race

**Mode:** SPEC
**Author:** Claude `mingla-forensics`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0829-B_D1_CHECKOUT_CREATE_RETURNS_200_NO_SESSION.md`
**Predecessor RETEST:** `Mingla_Artifacts/reports/QA_ORCH-0829-B_STRIPE_LIVEFIRE_REPORT_RETEST_2.md`
**Sibling implementation under retest:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0829-B_STRIPE_DOUBLE_RESOLVE.md` (the defensive JS guard from -B's first pass; stays as-is)

---

## 1. Layman Summary

When a buyer abandons or hangs on a paid checkout — and then retries the SAME ticket with the SAME details more than 15 minutes later — Mingla's idempotency logic reuses the old stuck checkout session and its stale Stripe PaymentIntent. Stripe's iOS SDK can't render a stale PaymentIntent, so the payment sheet hangs at a loading spinner for ~90 seconds and then silently disappears with no charge, no order, and no error toast. This spec fixes the underlying RPC bug, plus two defensive patches in the mobile layer that prevent a related class of silent stuck-state bugs.

**Three changes, one PR:**
1. **Migration** (DB): the RPC `biz_ticket_checkout_create_session` will recognize past-expiry in-flight sessions as tombstone candidates, free their idempotency key, mark them `'expired'`, and fall through to a fresh insert. Operator runs `supabase db push` once after the implementor pushes to Seth.
2. **Try/finally in handleBuy** (mobile): `checkoutInFlight` flag will always reset, even if `runNativeCheckout` throws or hangs. Prevents the "second tap silently no-ops" symptom that locks the user out for the rest of the app session.
3. **60s timeout race in useStripePaymentSheet** (packages): if `presentPaymentSheet` or `initPaymentSheet` hangs past 60 seconds, the wrapper rejects with a synthetic timeout error AND clears the in-flight ref. Converts silent hang into a loud toast the user can retry.

**No edge function deploy needed** — `ticket-checkout-create/index.ts` is unchanged. The RPC change is migration-only.

**Re-verification:** after operator's `supabase db push`, the same Maestro reproducer from RETEST_2 (Discover → Big Party → Buy ticket → Continue) should advance to Stripe's actual card-entry form within ~1s, accept test card `4242 4242 4242 4242`, and produce a success toast plus a 4th ticket in the user's calendar within 5 seconds.

---

## 2. Scope, Non-Goals, Assumptions

### 2.1 In-scope (this SPEC)

| ID | Change | Layer | Cites |
|---|---|---|---|
| S1 | New migration: tombstone past-expiry non-terminal sessions in `biz_ticket_checkout_create_session` | Database (Postgres RPC) | Investigation R-1 |
| S2 | Wrap `runNativeCheckout` call in `try/finally` so `checkoutInFlight` always clears | Component | Investigation H-2 / RETEST_2 D-2 |
| S3 | Add 60s timeout race to `presentPaymentSheet` and `initPaymentSheet` wrappers | Package (`@mingla/payments-native`) | Investigation H-3 / RETEST_2 fallback (a) |
| S4 | Regression check (Node script) covering the three above contracts | CI | Investigation Regression Prevention |
| S5 | Strict-grep CI gate asserting the migration body contains the new OR clause | CI | Investigation Regression Prevention |

### 2.2 Out-of-scope (deferred — register as sibling ORCHs at CLOSE if operator wants)

| ID | Deferred change | Why deferred |
|---|---|---|
| D-1 | H-1: Cancel stale Stripe PaymentIntents on tombstone (`stripe.paymentIntents.cancel(stale_pi_id)`) | Requires edge-function changes + error handling around Stripe API failure modes; larger blast radius. Recommend ORCH-0830. |
| D-2 | C-1 / D-NEW-1: Periodic pg_cron job to transition all past-expiry non-terminal sessions to `'expired'` | Needs operator to enable pg_cron extension; defense-in-depth only. The fix in S1 makes this non-blocking. Recommend ORCH-0831. |
| D-3 | D-NEW-3: Dedupe `brands.stripe_connect_*` columns vs `stripe_connect_accounts` table | Architectural; not a fix. Recommend ORCH-0832 (investigation first). |
| D-4 | Stripe RN SDK upgrade matrix (spec §3.4 of original -B SPEC) | Already deferred per operator decision. R-1 fix should make the SDK 0.50.3 + iOS 26 hang non-reproducible because we'll never send stale clientSecrets. If hang still reproduces with fresh PIs, escalate as new investigation. |

### 2.3 Non-goals (this SPEC explicitly does NOT cover)

- Removing or modifying the original ORCH-0829-B JS once-only guard. The guard stays — it's a useful defense-in-depth against the actual SDK double-resolve regression that we still can't prove was the original bug. It is innocent for D-1's scenario but useful for future scenarios.
- Changing the deterministic idempotency-key construction in `checkoutIdempotencyKey`. The key shape is correct; the bug is in how stale sessions matching that key are handled.
- Touching the free-ticket flow. Free tickets transition to `'free_completed'` (terminal) immediately, so the bug cannot manifest for them.
- Touching the web checkout (Stripe Checkout Sessions) flow. The fix in S1 is below the surface branch and benefits BOTH native and web buyers.
- Touching the original investigator-prescribed PI cancellation (deferred to ORCH-0830).
- Changing edge function `ticket-checkout-create/index.ts`. The RPC fix alone is sufficient because all surface-specific code paths run AFTER the RPC returns.

### 2.4 Assumptions

| ID | Assumption | Validation |
|---|---|---|
| A1 | `supabase db push --linked` will apply the new migration cleanly to the remote without conflict against the latest migration prefix `20260605000001` | Implementor must use a monotonic prefix > `20260605000001`; operator runs the push and reports success before tester begins |
| A2 | The only active definition of `biz_ticket_checkout_create_session` is in `20260520000002_orch_0791_session_terminal_tombstone.sql` (verified during investigation via `pg_get_functiondef`) | Re-verified at SPEC time; implementor MUST re-verify before writing the CREATE OR REPLACE FUNCTION block to avoid stale-source drift |
| A3 | The stuck session row `acc20778-8b55-4e2c-9ad3-fedd2637a164` will still be in the DB at retest time, OR the operator will manually tombstone it before RETEST_3 begins | If the row was naturally tombstoned by some other process between SPEC and RETEST, the tester will be unable to reproduce the bug pre-fix — they should still verify the fix works on a freshly seeded stuck-state row (test case T-04 below) |
| A4 | `expires_at` on `ticket_checkout_sessions` is set to creation_time + 15 minutes by the edge function (`new Date(Date.now() + 15 * 60 * 1000).toISOString()` at index.ts:102) and is NOT updated by any subsequent UPDATE | True per code reading; if a future change extends a session's expiry, this spec's logic still holds (only past-expiry sessions tombstone) |
| A5 | The Stripe RN SDK 0.50.3 on iOS 26 issue is downstream of stale clientSecret, not an independent SDK bug that triggers on fresh PIs too | If RETEST_3 shows the sheet STILL hangs after S1+S2+S3 ship and a fresh PaymentIntent is being passed, escalate as a new investigation targeting Stripe SDK directly (sibling ORCH). The investigation report's confidence on this assumption is "high" because the stuck-row mechanism explains the observed timing, the matching idempotency key, and the unchanged `updated_at` advance. |

---

## 3. Layer-by-Layer Specification

### 3.1 Database Layer (S1)

**Migration file:** `supabase/migrations/<monotonic_timestamp>_orch_0829b_d1_checkout_expiry_tombstone.sql`

**Naming constraint:** the `<monotonic_timestamp>` prefix MUST be strictly greater than `20260605000001` (the most recent migration on Seth at SPEC time). Implementor SHOULD use `20260605000002` if no later migration has landed by IMPLEMENT time; otherwise, use a prefix strictly greater than the latest on disk AND greater than the latest on the remote (`mcp__supabase__list_migrations`). This is the standing monotonic-naming rule per `feedback_implementor_uses_ui_ux_pro_max.md` adjacent guidance and the cross-skill parity rule #10 in the implementor skill.

**Migration body (authoritative — implementor MUST match this contract exactly; commentary and naming may be adapted):**

```sql
-- ORCH-0829-B D-1: Past-expiry in-flight checkout sessions are no longer
-- treated as "genuine retries" by the idempotency-key short-circuit.
--
-- Pre-existing bug: biz_ticket_checkout_create_session (last replaced in
-- migration 20260520000002_orch_0791_session_terminal_tombstone.sql) only
-- tombstones the idempotency_key when the existing session's status is in
-- the terminal set ('paid_completed','free_completed','failed','expired').
-- It does NOT tombstone when the session is past expires_at but still in
-- an in-flight status ('pending_free','requires_payment',
-- 'processing_payment','awaiting_web_redirect') — typically because the
-- buyer abandoned without completing payment and no Stripe webhook ever
-- drove the row to a terminal status. The next retry by the same buyer
-- for the same inputs computes the SAME deterministic idempotency_key,
-- matches the stuck row, short-circuits, and the edge function reuses the
-- stale Stripe PaymentIntent via `ticket_checkout:<sessionId>` Stripe
-- idempotency key. Stripe RN PaymentSheet on iOS 26 cannot present a
-- stale (often >1 hour old) PaymentIntent and hangs at the loading
-- skeleton for ~90s before silently dismissing with no order created.
--
-- Fix: extend the tombstone-eligibility predicate so that any session
-- with expires_at < now() is also a tombstone candidate, regardless of
-- status. Transition the tombstoned row's status to 'expired' in the
-- same UPDATE so the system has consistent state going forward (terminal
-- statuses are preserved as-is).
--
-- Invariant established: I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE — see
-- Mingla_Artifacts/INVARIANT_REGISTRY.md (added at ORCH-0829-B CLOSE).
-- CI gate: .github/workflows/strict-grep-mingla-business.yml job
-- orch-0829b-d1-checkout-expiry-tombstone-or-clause-present.
--
-- Reference: original RPC at 20260515000013_orch_0777_ticket_checkout_core.sql.
-- Tombstone semantics introduced in 20260520000002_orch_0791_session_terminal_tombstone.sql.
-- This migration only restructures the tombstone-eligibility predicate;
-- the rest of the body is preserved verbatim.

BEGIN;

CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session(
  p_event_id uuid,
  p_buyer_user_id uuid,
  p_buyer_name text,
  p_buyer_email text,
  p_buyer_phone_e164 text,
  p_marketing_opt_in boolean,
  p_lines jsonb,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_application_fee_amount_cents integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_existing record;
  v_event record;
  v_session_id uuid;
  v_status text;
  v_currency character(3);
  v_total integer := 0;
  v_line jsonb;
  v_ticket_type record;
  v_qty integer;
  v_sold integer;
  v_reserved integer;
  v_items jsonb := '[]'::jsonb;
  v_stripe_account_id text;
BEGIN
  IF p_buyer_phone_e164 IS NULL OR p_buyer_phone_e164 !~ '^\+[1-9][0-9]{1,14}$' THEN
    RAISE EXCEPTION 'buyer_phone_required';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'ticket_lines_required';
  END IF;

  SELECT *
    INTO v_existing
    FROM public.ticket_checkout_sessions
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    -- ORCH-0791: terminal sessions are historical artifacts; do not reuse them.
    -- ORCH-0829-B D-1: past-expiry in-flight sessions are also dead artifacts;
    -- their Stripe PaymentIntent (if any) is stale and Stripe SDK cannot
    -- present a stale clientSecret. Treat them as tombstone candidates and
    -- transition status to 'expired' so the system state is consistent.
    IF v_existing.status IN ('paid_completed','free_completed','failed','expired')
       OR v_existing.expires_at < now() THEN
      UPDATE public.ticket_checkout_sessions
         SET idempotency_key = idempotency_key || ':tombstone:' || id::text,
             status = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN status
               ELSE 'expired'
             END,
             failed_at = CASE
               WHEN status IN ('paid_completed','free_completed','failed','expired') THEN failed_at
               WHEN status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect')
                 AND expires_at < now() THEN now()
               ELSE failed_at
             END,
             updated_at = now()
       WHERE id = v_existing.id;
      -- Fall through to the normal create path below.
    ELSE
      -- In-flight session within its expiry window — preserve I-CHECKOUT-IDEMPOTENT
      -- for genuine retries during checkout.
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ticketTypeId', i.ticket_type_id,
        'ticketName', i.ticket_name_at_purchase,
        'quantity', i.quantity,
        'unitPriceCents', i.unit_price_cents,
        'totalCents', i.total_cents
      ) ORDER BY i.created_at), '[]'::jsonb)
        INTO v_items
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id = v_existing.id;

      RETURN jsonb_build_object(
        'checkoutSessionId', v_existing.id,
        'eventId', v_existing.event_id,
        'brandId', v_existing.brand_id,
        'status', v_existing.status,
        'totalCents', v_existing.total_cents,
        'currency', trim(v_existing.currency),
        'stripeAccountId', v_existing.stripe_account_id,
        'orderId', v_existing.order_id,
        'items', v_items
      );
    END IF;
  END IF;

  -- Remainder of function body (event lookup, line validation, INSERT, items insert,
  -- final RETURN) is UNCHANGED from 20260520000002. Implementor MUST copy lines 115-249
  -- of that migration verbatim into this CREATE OR REPLACE definition. Do not paraphrase
  -- and do not "improve" — the rest of the body is load-bearing and any drift introduces
  -- regression risk against a working flow.
  SELECT e.id, e.brand_id, e.visibility, e.status, e.deleted_at, s.stripe_account_id, s.charges_enabled
    INTO v_event
    FROM public.events e
    LEFT JOIN public.stripe_connect_accounts s
      ON s.brand_id = e.brand_id
     AND s.detached_at IS NULL
   WHERE e.id = p_event_id
   FOR SHARE OF e;

  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;
  IF v_event.visibility <> 'public' OR NOT (v_event.status = ANY (ARRAY['scheduled'::text, 'live'::text])) THEN
    RAISE EXCEPTION 'event_not_selling';
  END IF;

  v_session_id := gen_random_uuid();

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_qty := COALESCE((v_line ->> 'quantity')::integer, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'ticket_quantity_invalid';
    END IF;

    SELECT *
      INTO v_ticket_type
      FROM public.ticket_types
     WHERE id = (v_line ->> 'ticketTypeId')::uuid
       AND event_id = p_event_id
       AND deleted_at IS NULL
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ticket_type_not_found';
    END IF;
    IF v_ticket_type.is_hidden OR v_ticket_type.is_disabled OR NOT v_ticket_type.available_online THEN
      RAISE EXCEPTION 'ticket_type_unavailable';
    END IF;
    IF v_ticket_type.sale_start_at IS NOT NULL AND v_ticket_type.sale_start_at > now() THEN
      RAISE EXCEPTION 'ticket_sales_not_started';
    END IF;
    IF v_ticket_type.sale_end_at IS NOT NULL AND v_ticket_type.sale_end_at <= now() THEN
      RAISE EXCEPTION 'ticket_sales_ended';
    END IF;
    IF v_qty < v_ticket_type.min_purchase_qty THEN
      RAISE EXCEPTION 'ticket_quantity_below_min';
    END IF;
    IF v_ticket_type.max_purchase_qty IS NOT NULL AND v_qty > v_ticket_type.max_purchase_qty THEN
      RAISE EXCEPTION 'ticket_quantity_above_max';
    END IF;

    IF NOT v_ticket_type.is_unlimited THEN
      SELECT COUNT(*)
        INTO v_sold
        FROM public.tickets t
       WHERE t.ticket_type_id = v_ticket_type.id
         AND t.status IN ('valid', 'used', 'transferred');

      SELECT COALESCE(SUM(i.quantity), 0)::integer
        INTO v_reserved
        FROM public.ticket_checkout_session_items i
        JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
       WHERE i.ticket_type_id = v_ticket_type.id
         AND s.expires_at > now()
         AND s.status IN ('pending_free', 'requires_payment', 'processing_payment');

      IF v_ticket_type.quantity_total IS NOT NULL
         AND v_sold + v_reserved + v_qty > v_ticket_type.quantity_total THEN
        RAISE EXCEPTION 'ticket_capacity_exceeded';
      END IF;
    END IF;

    IF v_currency IS NULL THEN
      v_currency := v_ticket_type.currency;
    ELSIF v_currency <> v_ticket_type.currency THEN
      RAISE EXCEPTION 'mixed_currency_cart';
    END IF;

    v_total := v_total + (v_ticket_type.price_cents * v_qty);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'ticketTypeId', v_ticket_type.id,
      'ticketName', v_ticket_type.name,
      'quantity', v_qty,
      'unitPriceCents', v_ticket_type.price_cents,
      'totalCents', v_ticket_type.price_cents * v_qty
    ));
  END LOOP;

  v_status := CASE WHEN v_total = 0 THEN 'pending_free' ELSE 'requires_payment' END;
  IF v_total > 0 AND (v_event.stripe_account_id IS NULL OR v_event.charges_enabled IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'stripe_account_not_ready';
  END IF;
  v_stripe_account_id := CASE WHEN v_total > 0 THEN v_event.stripe_account_id ELSE NULL END;

  INSERT INTO public.ticket_checkout_sessions (
    id, event_id, brand_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    marketing_opt_in, subtotal_cents, application_fee_amount_cents, total_cents,
    currency, status, idempotency_key, cart_fingerprint, expires_at,
    stripe_account_id, stripe_application_fee_amount_cents
  ) VALUES (
    v_session_id, p_event_id, v_event.brand_id, p_buyer_user_id, trim(p_buyer_name),
    lower(trim(p_buyer_email)), p_buyer_phone_e164, COALESCE(p_marketing_opt_in, false),
    v_total, COALESCE(p_application_fee_amount_cents, 0), v_total,
    COALESCE(v_currency, 'GBP'::character(3)), v_status, p_idempotency_key,
    md5(v_items::text), p_expires_at, v_stripe_account_id, COALESCE(p_application_fee_amount_cents, 0)
  );

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO public.ticket_checkout_session_items (
      checkout_session_id, ticket_type_id, ticket_name_at_purchase, quantity,
      unit_price_cents, total_cents
    ) VALUES (
      v_session_id,
      (v_line ->> 'ticketTypeId')::uuid,
      v_line ->> 'ticketName',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unitPriceCents')::integer,
      (v_line ->> 'totalCents')::integer
    );
  END LOOP;

  RETURN jsonb_build_object(
    'checkoutSessionId', v_session_id,
    'eventId', p_event_id,
    'brandId', v_event.brand_id,
    'status', v_status,
    'totalCents', v_total,
    'currency', trim(COALESCE(v_currency, 'GBP'::character(3))),
    'stripeAccountId', v_stripe_account_id,
    'orderId', NULL,
    'items', v_items
  );
END;
$$;

COMMIT;
```

**Migration contract checks (implementor MUST verify after writing):**

| Check | How |
|---|---|
| The `IF FOUND THEN ... IF v_existing.status IN (...) OR v_existing.expires_at < now() THEN` block matches the contract above exactly | Read your own migration file; the predicate MUST include `OR v_existing.expires_at < now()` |
| The UPDATE statement transitions status to 'expired' only for non-terminal rows | The CASE expression must preserve terminal statuses as-is and write 'expired' for in-flight statuses |
| Lines 115-249 of `20260520000002_orch_0791_session_terminal_tombstone.sql` are copied verbatim into the new CREATE OR REPLACE | `diff <(tail -n +115 supabase/migrations/20260520000002_orch_0791_session_terminal_tombstone.sql \| head -n 135) <(echo "the corresponding lines from your new migration")` should show only whitespace/commentary differences |
| Migration timestamp prefix is monotonic | `ls supabase/migrations/*.sql \| sort \| tail -3` shows your new file as the LAST entry |
| Migration is the ONLY change in `supabase/migrations/` this commit | No other migrations added or modified |

**Operator deploy step (post-implementor):**
- Operator runs `supabase db push --linked` from `/Users/sethogieva/Desktop/mingla-main`.
- Verify post-push via Management API SQL probe:
  ```sql
  SELECT pg_get_functiondef(p.oid) LIKE '%expires_at < now()%' AS or_clause_present
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'biz_ticket_checkout_create_session';
  ```
  Expected: `or_clause_present = true`.

**No edge function deploy needed.** `ticket-checkout-create/index.ts` source is unchanged.

### 3.2 Component Layer (S2)

**File:** `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`

**Function:** `handleBuy` (lines 190-277)

**Current code (lines 219-267):**
```tsx
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setCheckoutInFlight(true);

      const result = await runNativeCheckout({
        eventId: data.eventId,
        lines: [{ ticketTypeId: ticketId, quantity: 1 }],
        buyer: { /* ... */ },
      });

      setCheckoutInFlight(false);

      if (result.outcome === "succeeded") {
        // ... toast + cache invalidate + poll
      } else if (result.outcome === "canceled") {
        // Silent
      } else {
        // Error toast
      }
```

**Required new code (must preserve all current behavior in the success/cancel/failed branches; only the control-flow wrapper changes):**
```tsx
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setCheckoutInFlight(true);

      let result: NativeCheckoutOutcome;
      try {
        result = await runNativeCheckout({
          eventId: data.eventId,
          lines: [{ ticketTypeId: ticketId, quantity: 1 }],
          buyer: { /* unchanged */ },
        });
      } catch (err) {
        // ORCH-0829-B D-1 H-2: runNativeCheckout's contract is to return a
        // NativeCheckoutOutcome, but if the underlying useStripePaymentSheet
        // wrapper rejects (e.g., timeout race from S3 fires), the await throws.
        // Convert to the failed outcome so the existing failed-branch UX runs.
        const message = err instanceof Error ? err.message : "Payment failed.";
        result = { outcome: "failed", message };
      } finally {
        // ORCH-0829-B D-1 H-2: always clear the in-flight flag so a subsequent
        // tap can re-fire the flow. Without this finally, a hung or thrown
        // runNativeCheckout leaves checkoutInFlight=true forever, silently
        // no-op'ing all subsequent Buy taps for the rest of the session.
        setCheckoutInFlight(false);
      }

      if (result.outcome === "succeeded") {
        // ... existing success branch unchanged ...
      } else if (result.outcome === "canceled") {
        // Silent — existing behavior
      } else {
        // Existing error toast branch unchanged
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        toastManager.show(result.message, "error");
      }
```

**Component contract checks:**
- `setCheckoutInFlight(false)` MUST appear inside a `finally` block, not after the `await`.
- The catch block MUST convert the thrown error into `{outcome: "failed", message}` so the existing error-toast branch fires (Constitutional Rule 3 — no silent failures).
- The thrown-error message MUST be a non-empty string; use `err instanceof Error ? err.message : "Payment failed."` as the fallback.
- No other behavior changes — success branch keeps its toast + sheet close + cache invalidate + poll; cancel branch stays silent.

### 3.3 Package Layer (S3)

**File:** `packages/payments-native/useStripePaymentSheet.ts`

**Functions:** `initPaymentSheet` and `presentPaymentSheet` inside the hook return (lines 48-99)

**Current code (the relevant parts):**
```ts
const inFlightInitRef = useRef<Promise<PaymentSheetResult> | null>(null);
const inFlightPresentRef = useRef<Promise<PaymentSheetResult> | null>(null);

return {
  isPaymentSheetSupported: true,
  initPaymentSheet: async (input: PaymentSheetInitInput): Promise<PaymentSheetResult> => {
    if (inFlightInitRef.current !== null) {
      console.log("[useStripePaymentSheet] initPaymentSheet already in flight; returning existing promise");
      return inFlightInitRef.current;
    }
    const p: Promise<PaymentSheetResult> = (async () => {
      console.log("[useStripePaymentSheet] initPaymentSheet → native call");
      try {
        const result = normalizePaymentSheetResult(await initPaymentSheet(input));
        console.log("[useStripePaymentSheet] initPaymentSheet ← resolved error=", result.error?.code ?? "none");
        return result;
      } finally {
        inFlightInitRef.current = null;
      }
    })();
    inFlightInitRef.current = p;
    return p;
  },
  presentPaymentSheet: async (): Promise<PaymentSheetResult> => {
    // symmetric pattern
  },
};
```

**Required new code (add a timeout race; preserve all current behavior including diagnostic logs and once-only-guard semantics):**

```ts
// ORCH-0829-B D-1 H-3: timeout race for both initPaymentSheet and
// presentPaymentSheet. Stripe RN 0.50.3 on iOS 26 can hang the native
// completion handler indefinitely (proven in ORCH-0829-B RETEST_2 where
// the PaymentSheet showed loading skeleton for ~90s then silently
// self-dismissed, leaving the JS-side Promise pending forever). Without a
// timeout race, the inFlight refs stay set permanently and the user is
// locked out of the entire payment flow for the rest of the app session.
// 60s matches Stripe SDK's own internal soft-timeout behavior; any longer
// and the user gives up. The synthetic timeout error has code='Timeout'
// so callers can detect it specifically.
const PAYMENT_SHEET_TIMEOUT_MS = 60_000;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      console.log(
        `[useStripePaymentSheet] ${label} timed out after ${ms}ms — rejecting with synthetic Timeout error`,
      );
      reject(
        Object.assign(new Error(`${label} timed out after ${ms}ms`), {
          code: "Timeout",
        }),
      );
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
```

Then wrap each native call with the timeout race, INSIDE the existing IIFE so the `finally` block still fires when the timeout rejects:

```ts
initPaymentSheet: async (input: PaymentSheetInitInput): Promise<PaymentSheetResult> => {
  if (inFlightInitRef.current !== null) {
    console.log("[useStripePaymentSheet] initPaymentSheet already in flight; returning existing promise");
    return inFlightInitRef.current;
  }
  const p: Promise<PaymentSheetResult> = (async () => {
    console.log("[useStripePaymentSheet] initPaymentSheet → native call");
    try {
      const result = normalizePaymentSheetResult(
        await withTimeout(initPaymentSheet(input), PAYMENT_SHEET_TIMEOUT_MS, "initPaymentSheet"),
      );
      console.log("[useStripePaymentSheet] initPaymentSheet ← resolved error=", result.error?.code ?? "none");
      return result;
    } finally {
      inFlightInitRef.current = null;
    }
  })();
  inFlightInitRef.current = p;
  return p;
},
presentPaymentSheet: async (): Promise<PaymentSheetResult> => {
  if (inFlightPresentRef.current !== null) {
    console.log("[useStripePaymentSheet] presentPaymentSheet already in flight; returning existing promise (double-invoke suppressed)");
    return inFlightPresentRef.current;
  }
  const p: Promise<PaymentSheetResult> = (async () => {
    console.log("[useStripePaymentSheet] presentPaymentSheet → native call");
    try {
      const result = normalizePaymentSheetResult(
        await withTimeout(presentPaymentSheet(), PAYMENT_SHEET_TIMEOUT_MS, "presentPaymentSheet"),
      );
      console.log("[useStripePaymentSheet] presentPaymentSheet ← resolved error=", result.error?.code ?? "none");
      return result;
    } finally {
      inFlightPresentRef.current = null;
    }
  })();
  inFlightPresentRef.current = p;
  return p;
},
```

**Package contract checks:**
- `withTimeout` is a module-level helper, NOT inlined per-call.
- `PAYMENT_SHEET_TIMEOUT_MS = 60_000` is a module-level constant.
- The timeout's rejection MUST propagate through the IIFE's try/finally so `inFlightInitRef.current = null` / `inFlightPresentRef.current = null` runs.
- The synthetic error MUST have `code: "Timeout"` so downstream `nativeCheckoutFlow.ts:148-160` (`presentResult.error.code === "Canceled"`) does not match it (it would fall through to the failed branch, which is correct).
- The diagnostic log `[useStripePaymentSheet] <label> timed out after <ms>ms` MUST fire on timeout — this gives the tester a positive Metro-log signal that the timeout race fired.
- Both `initPaymentSheet` and `presentPaymentSheet` get the same treatment — symmetry per the investigation H-3.

### 3.4 CI Layer (S4 + S5)

#### S4: Regression check (Node script)

**File:** `app-mobile/scripts/ci/orch-0829b-d1-regression-check.mjs` (new file)

**Contracts to verify:**

| ID | Contract | How to verify |
|---|---|---|
| T-A1 | The new migration file exists and matches the monotonic-prefix rule | `fs.readdirSync('supabase/migrations/')` filtered by `_orch_0829b_d1_checkout_expiry_tombstone.sql` suffix → exactly 1 file with prefix > `20260605000001` |
| T-A2 | The migration body contains the new OR clause for tombstone eligibility | grep for `OR v_existing.expires_at < now()` in the migration body |
| T-A3 | The migration body sets status to 'expired' in the tombstone UPDATE for non-terminal rows | grep for `WHEN status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect')` AND `ELSE 'expired'` (or equivalent CASE shape that covers the same set) |
| T-A4 | `handleBuy` in ExpandedBusinessEventSheet.tsx wraps `runNativeCheckout` in try/finally | grep for the pattern `try {\s*result = await runNativeCheckout` followed by `finally {\s*setCheckoutInFlight(false)` within ~30 lines |
| T-A5 | `handleBuy` has a catch block that converts thrown errors to `{outcome: "failed", message}` | grep for `catch (err)` followed by `result = { outcome: "failed", message`  within ~10 lines |
| T-A6 | `useStripePaymentSheet.ts` exports/uses a `withTimeout` helper with a 60s constant | grep for `const PAYMENT_SHEET_TIMEOUT_MS = 60_000` AND `function withTimeout` |
| T-A7 | Both `initPaymentSheet` and `presentPaymentSheet` wrap their native calls in `withTimeout(...)` | grep for `withTimeout(initPaymentSheet(input)` AND `withTimeout(presentPaymentSheet()` |
| T-A8 | The synthetic timeout error has `code: "Timeout"` | grep for `code: "Timeout"` in `useStripePaymentSheet.ts` |
| T-A9 | The timeout fires the diagnostic log `[useStripePaymentSheet] <label> timed out after <ms>ms` | grep for `timed out after \${ms}ms` (template literal) |

**Script pattern:** mirror existing `app-mobile/scripts/ci/orch-0829b-regression-check.mjs` from the prior pass — `import fs from 'node:fs'`, define `assertContractsPass({ name, file, mustContain })` runner, exit 1 on any FAIL. Add `npm run test:orch-0829b-d1` to `app-mobile/package.json` scripts.

**Implementor MUST run `npm run test:orch-0829b-d1` after writing each of S1/S2/S3 and the final pass MUST be 9/9 PASS.**

#### S5: Strict-grep CI gate

**File:** `.github/scripts/strict-grep/orch-0829b-d1-checkout-expiry-tombstone-or-clause-present.mjs` (new)

**Job entry in `.github/workflows/strict-grep-mingla-business.yml`** (mirror the registry pattern in `feedback_strict_grep_registry_pattern.md` — single script + single job):

```yaml
orch-0829b-d1-checkout-expiry-tombstone:
  name: ORCH-0829-B D-1 expiry-tombstone OR clause present
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Run strict-grep
      run: node .github/scripts/strict-grep/orch-0829b-d1-checkout-expiry-tombstone-or-clause-present.mjs
```

**Script contract:**
1. Find the LATEST `supabase/migrations/*biz_ticket_checkout_create_session*.sql` migration by lexical sort of `supabase/migrations/*.sql` filenames that contain `CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_create_session`.
2. Read its body.
3. Assert it contains `OR v_existing.expires_at < now()`.
4. Assert it contains a CASE expression that sets `status = ... 'expired'` for non-terminal rows.
5. Exit 0 on PASS, exit 1 with a clear error message on FAIL.

This gate prevents a future migration from replacing the RPC without preserving the D-1 fix.

---

## 4. Success Criteria

| # | Criterion | Observable | Testable |
|---|---|---|---|
| C1 | After `supabase db push`, the deployed `biz_ticket_checkout_create_session` function body contains the OR clause `expires_at < now()` in its tombstone-eligibility predicate | Yes — via `pg_get_functiondef` SQL probe | Yes — automated via T-C1 below |
| C2 | After `supabase db push`, any existing in-flight session past its `expires_at` will be tombstoned and transitioned to status='expired' on the next idempotency-key match | Yes — via direct SQL inspection of the row's idempotency_key + status before/after a re-trigger | Yes — T-C2 |
| C3 | The same Maestro reproducer that failed in RETEST_2 (Discover → Big Party → Buy ticket → Continue) now advances to the Stripe card-entry form within ~1s of "Continue to Payment" tap | Yes — screenshot evidence | Yes — T-C3 (live-fire) |
| C4 | After typing test card `4242 4242 4242 4242` exp `12/34` CVC `123` ZIP `94103` and tapping Pay, the user sees "Ticket secured! Check your calendar." success toast within 5 seconds | Yes — screenshot + DB probe for new order row | Yes — T-C4 (live-fire) |
| C5 | Within 5 seconds of the success toast, the Calendar tab shows a 4th Big Party ticket (Tickets count = 4) | Yes — screenshot + DB probe for new ticket row | Yes — T-C5 (live-fire) |
| C6 | If `presentPaymentSheet` hangs (induced by killing network mid-attempt OR by manually setting Stripe key invalid), the user sees an error toast within 65 seconds and `checkoutInFlight` is cleared (proven by a subsequent Buy tap re-firing the flow successfully) | Yes — Maestro flow + screenshot evidence + Metro log assertion | Yes — T-C6 (induced-hang live-fire) |
| C7 | No "Tried to resolve a promise more than once" red banner appears in any scenario | Yes — visual confirmation across all test cases | Yes — every test case checks |
| C8 | Regression check `npm run test:orch-0829b-d1` returns 9/9 PASS | Yes — exit code | Yes — T-C8 |
| C9 | Strict-grep CI gate `orch-0829b-d1-checkout-expiry-tombstone` returns PASS in GitHub Actions on Seth | Yes — GitHub Actions UI | Yes — T-C9 |
| C10 | `tsc --noEmit` clean on touched files (`ExpandedBusinessEventSheet.tsx`, `useStripePaymentSheet.ts`) | Yes — exit code | Yes — T-C10 |
| C11 | The pre-existing tests `npm run test:orch-0829a` (15/15) and `npm run test:orch-0829b` (6/6) still pass | Yes — exit codes | Yes — T-C11 |

---

## 5. Invariants

### 5.1 New invariant (to be added at CLOSE)

**ID:** `I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE`
**Statement:** The idempotency-key short-circuit in `public.biz_ticket_checkout_create_session` MUST treat any existing session past its `expires_at` as a tombstone candidate, regardless of `status`. The tombstoned row MUST have its status transitioned to `'expired'` if it was in a non-terminal state.
**Why:** Past-expiry in-flight sessions reference stale Stripe PaymentIntents that Stripe SDK cannot present, causing user-visible silent failure (ORCH-0829-B D-1, ~94-min-old session reproduced on 2026-05-14).
**Backed by:** ORCH-0829-B D-1 close.
**CI gate:** `.github/workflows/strict-grep-mingla-business.yml` job `orch-0829b-d1-checkout-expiry-tombstone-or-clause-present`.

### 5.2 Pre-existing invariants preserved

| Invariant | How this spec preserves it |
|---|---|
| `I-CHECKOUT-IDEMPOTENT` (per `20260520000002_orch_0791_session_terminal_tombstone.sql:19`) | Still enforced for genuine retries within the expires_at window — the ELSE branch on line 89 of the original migration is preserved verbatim and still short-circuits for in-flight non-terminal sessions whose expires_at is still in the future |
| `I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS` (per recent ORCH-0828 close) | Untouched — this spec does not modify the sheet rendering |
| `I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY` (per ORCH-0829-B first pass) | Preserved — the once-only guard refs stay; the timeout race is layered ABOVE the guard, not replacing it |
| Constitutional Rule 3 (No silent failures) | This spec EXPLICITLY fixes a silent-failure regression caused by the prior ORCH-0829-B guard's interaction with stale PIs; both H-2 and H-3 ensure errors surface as toasts |
| Constitutional Rule 11 (One auth instance) / Rule 12 (Validate at right time) | Unaffected — auth, datetime, all unchanged |

---

## 6. Test Cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-C1 | Deployed RPC body has OR clause | SQL probe: `SELECT pg_get_functiondef('public.biz_ticket_checkout_create_session'::regproc::oid) LIKE '%OR v_existing.expires_at < now()%'` | `true` | DB (post-migration) |
| T-C2 | Tombstone fires on past-expiry in-flight row | Pre: stuck row `acc20778-8b55-4e2c-9ad3-fedd2637a164` with status='processing_payment', expires_at='2026-05-14 07:53:45+00'. Action: call RPC with the matching deterministic idempotency_key. After: query `ticket_checkout_sessions WHERE id = 'acc20778...'` | Row now has `idempotency_key` ending in `:tombstone:acc20778...` AND `status='expired'` AND `failed_at` is set to now() | DB |
| T-C3 | Maestro reproducer reaches Stripe card-entry form | iPhone 17 Pro sim `17091E60-C3B6-4167-980D-60C348E177F6`, Metro `:8084`, signed in as Marcus Rivera. Drive: Discover → Big Party → scroll → Buy ticket (Maestro `tapOn: point: "18%,87%"`) → confirmation modal → Continue to Payment (Maestro `tapOn: "Continue to Payment"`) | Within ~3s, Stripe PaymentSheet renders with visible card-number input, expiry input, CVC input, ZIP input. Screenshot evidence required. | Full stack (live-fire) |
| T-C4 | Successful paid checkout end-to-end | After T-C3 reaches card form. Maestro `inputText: "4242424242424242"` into card field, then expiry, CVC, ZIP per the iOS Stripe form sequence. (If Maestro cannot reach Stripe's UIKit fields, STOP and ASK operator per Prime Directive 8 — operator types manually while tester captures screenshots.) Tap "Pay $250.00". | Within ~10s: success toast "Ticket secured! Check your calendar." appears; modal dismisses; DB shows a new `orders` row with `event_id='549e0a64...'` and `total_cents=25000` and `payment_status='paid'`; new `tickets` row with `order_id` matching the new order | Full stack (live-fire) |
| T-C5 | Calendar updates within 5s of paid success | Immediately after T-C4 success toast, Maestro `tapOn: "Calendar"` | Within 5s of tab nav, Calendar shows "Tickets (4)" section header (was 3 before this test); 4th Big Party row visible with cover thumbnail, "On Mingla" badge, brand+date, "1 ticket" pill, "View ticket" CTA | Full stack (live-fire) |
| T-C6 | Hang induces toast + flag clears | Pre: kill Stripe SDK reachability (e.g., toggle airplane mode, OR manually invalidate `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` in `app-mobile/.env`, OR mock by setting publishableKey returned by `ticket-checkout-create` to a known-bad string — operator's call). Drive same flow up through "Continue to Payment". | Within ~65s of Continue tap, error toast appears with synthetic timeout message OR Stripe error message; Maestro re-taps "Buy ticket" (after dismissing toast); confirmation modal re-opens (proving `checkoutInFlight` was cleared). Metro log MUST contain `[useStripePaymentSheet] presentPaymentSheet timed out after 60000ms — rejecting with synthetic Timeout error`. | Full stack (live-fire) |
| T-C7 | No double-resolve banner across all scenarios | Visual check of every screenshot from T-C3 through T-C6 | No red "Tried to resolve a promise more than once" banner in any frame | UI |
| T-C8 | Regression check passes | `cd app-mobile && npm run test:orch-0829b-d1` | Exit 0, stdout contains `9/9 PASS` | CI |
| T-C9 | Strict-grep CI gate passes | Push to Seth, observe GitHub Actions | `orch-0829b-d1-checkout-expiry-tombstone` job PASS | CI |
| T-C10 | TS clean on touched files | `cd app-mobile && tsc --noEmit 2>&1 \| grep -E 'ExpandedBusinessEventSheet\.tsx\|useStripePaymentSheet\.ts'` | Empty output (no new TS errors on touched files; pre-existing unrelated errors elsewhere are acceptable) | Code quality |
| T-C11 | Pre-existing -A and -B regression checks still pass | `cd app-mobile && npm run test:orch-0829a && npm run test:orch-0829b` | Exit 0, 15/15 then 6/6 | Regression |
| T-C12 | Free ticket claim still works (no regression on the working path) | Drive same flow but tap "Get free ticket" instead of paid Buy ticket | Free ticket success toast + Calendar shows 5 tickets (4 from before + 1 new free) | Full stack (live-fire) |
| T-C13 | Negative — first-time buyer (no stuck row exists for their inputs) still gets a fresh session | Use a DIFFERENT buyer (or test event) where no prior `ticket_checkout_sessions` row exists with the same deterministic idempotency_key. Drive paid flow. | RPC inserts fresh row, function returns 200 with FRESH clientSecret, Stripe sheet renders card form, payment completes | Full stack (live-fire) — optional if A3 holds |
| T-C14 | Negative — in-flight session within expires_at window still short-circuits (idempotency preserved) | Pre-arrange a session row with status='processing_payment' and expires_at = now() + 10 minutes (within window). Action: call RPC with matching idempotency_key. After: check response | Response's `checkoutSessionId` equals the existing row's id (short-circuit fired); row's idempotency_key UNCHANGED (no tombstone); row's status UNCHANGED | DB |

---

## 7. Implementation Order

1. **Database** — create the new migration file in `supabase/migrations/<monotonic_timestamp>_orch_0829b_d1_checkout_expiry_tombstone.sql` per §3.1. Do NOT run `supabase db push` — that's operator's gate.
2. **Component** — edit `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx:219-267` per §3.2 (try/catch/finally wrapper).
3. **Package** — edit `packages/payments-native/useStripePaymentSheet.ts` per §3.3 (withTimeout helper + wrap both initPaymentSheet and presentPaymentSheet).
4. **CI scripts** — create `app-mobile/scripts/ci/orch-0829b-d1-regression-check.mjs` per §3.4 S4 + `.github/scripts/strict-grep/orch-0829b-d1-checkout-expiry-tombstone-or-clause-present.mjs` per §3.4 S5 + add `npm run test:orch-0829b-d1` to `app-mobile/package.json` + add job to `.github/workflows/strict-grep-mingla-business.yml`.
5. **Local verification** — implementor runs `npm run test:orch-0829b-d1` (9/9 PASS), `npm run test:orch-0829a` (15/15 PASS unchanged), `npm run test:orch-0829b` (6/6 PASS unchanged), and `cd app-mobile && tsc --noEmit 2>&1 | grep -v node_modules | head -20` to confirm no NEW TS errors on touched files.
6. **Implementation report** — write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0829-B_D1_CHECKOUT_EXPIRY_TOMBSTONE.md` per the standard 15-section template with old→new receipts per file.
7. **HANDOFF (NOT BY IMPLEMENTOR)** — orchestrator picks up the implementation report, confirms operator runs `supabase db push`, then dispatches tester for RETEST_3 live-fire of all spec criteria + close protocol for the four-ORCH bundle.

---

## 8. Regression Prevention

### 8.1 Structural safeguards

1. **Migration shape:** the new migration uses the exact same `CREATE OR REPLACE FUNCTION` block as the previous tombstone-related migration (`20260520000002_orch_0791_session_terminal_tombstone.sql`). Any future migration that replaces this RPC must also preserve the D-1 OR clause OR the strict-grep CI gate (S5) will fail.

2. **Defense in depth (mobile):** even if a future RPC change accidentally drops the D-1 OR clause, the H-2 try/finally and H-3 timeout race ensure the user gets a loud error rather than a silent stuck state.

### 8.2 Test coverage

1. **T-C2** (DB): tombstone behavior is regression-tested directly.
2. **T-C14** (DB): the existing in-flight short-circuit behavior is regression-tested directly — ensures the OR clause doesn't accidentally over-trigger on rows within their expires_at window.
3. **T-C8** (CI): all 9 contracts are checked on every implementor pass.
4. **T-C9** (CI): the strict-grep gate runs on every GitHub Actions trigger, preventing the bug from being re-introduced in any future migration.

### 8.3 Protective comments

- The migration body's commentary explicitly cites the bug, the prior partial fix (ORCH-0791), and the invariant ID. Anyone modifying the RPC in future MUST encounter this comment.
- The H-2 finally block has a comment explaining the contract — "without this finally, a hung or thrown runNativeCheckout leaves checkoutInFlight=true forever".
- The H-3 withTimeout helper has a comment explaining the Stripe SDK hang scenario and why the 60s timeout is chosen.

---

## 9. Deploy Notes (for orchestrator + operator)

### 9.1 Migration deploy
- **Owner:** operator (per cross-skill rule "operator runs supabase db push" / `feedback_orchestrator_deploys_edge_functions.md`)
- **Command:** `supabase db push --linked` (from `/Users/sethogieva/Desktop/mingla-main`)
- **Post-deploy verification:** orchestrator runs the SQL probe in §3.1 to confirm `or_clause_present=true`
- **Rollback path:** if the migration breaks anything, a sibling migration that `CREATE OR REPLACE FUNCTION` with the ORCH-0791 body (no OR clause) restores prior behavior. Investigation note in `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0829-B_D1_*.md` documents the prior body's location for fast restoration.

### 9.2 Edge function deploy
- **None.** `ticket-checkout-create/index.ts` is unchanged in this spec.

### 9.3 Mobile deploy
- **OTA via EAS Update** is sufficient — no native module changes. After CLOSE, orchestrator emits:
  ```bash
  cd app-mobile && eas update --branch production --platform ios --message "ORCH-0829-B D-1: checkout expiry tombstone + handleBuy try/finally + PaymentSheet timeout race"
  ```
- **Order:** apply the migration FIRST (operator), then OTA the JS bundle (orchestrator). Otherwise the mobile bundle calls a RPC that doesn't yet have the fix, and stuck rows are still reused for ~few minutes between OTA push and DB push.

### 9.4 Manual cleanup of the existing stuck row (operator-optional)
The existing row `acc20778-8b55-4e2c-9ad3-fedd2637a164` will be auto-tombstoned the next time anyone hits the matching idempotency key post-deploy. If operator wants to pre-clear it before retest, run:
```sql
UPDATE public.ticket_checkout_sessions
   SET idempotency_key = idempotency_key || ':tombstone:' || id::text,
       status = 'expired',
       failed_at = now(),
       updated_at = now()
 WHERE id = 'acc20778-8b55-4e2c-9ad3-fedd2637a164';
```
This is NOT required; the migration's own logic handles it. But it makes T-C3 reproducible immediately without first triggering the tombstone via a doomed live-fire.

---

## 10. Working-Branch Discipline

All scoped work for this SPEC lives on `Seth` in `/Users/sethogieva/Desktop/mingla-main`. Implementor commits scoped files only (the migration, the component change, the package change, the two CI scripts, the package.json + workflow YAML edits, the implementation report). Global indexes (DECISION_LOG, INVARIANT_REGISTRY, WORLD_MAP, AGENT_HANDOFFS) are written by the orchestrator at CLOSE, not by the implementor.

---

NEXT HANDOFF — paste into Codex `implementor-mingla`:

Implement the spec at `Mingla_Artifacts/specs/SPEC_ORCH-0829-B_D1_CHECKOUT_EXPIRY_TOMBSTONE.md` following the proven root cause in `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0829-B_D1_CHECKOUT_CREATE_RETURNS_200_NO_SESSION.md`. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. Five scoped changes: (1) new migration `supabase/migrations/<monotonic_timestamp>_orch_0829b_d1_checkout_expiry_tombstone.sql` with the exact CREATE OR REPLACE FUNCTION body in spec §3.1 (extend tombstone-eligibility predicate to `OR v_existing.expires_at < now()` AND transition tombstoned non-terminal rows to status='expired' in the same UPDATE; rest of function body lines 115-249 of the prior `20260520000002_orch_0791_session_terminal_tombstone.sql` MUST be copied verbatim); (2) try/catch/finally wrap around `runNativeCheckout` in `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx:219-267` per spec §3.2 — the catch MUST convert thrown errors to `{outcome: "failed", message}` so the existing error-toast branch fires (Constitutional Rule 3); (3) `withTimeout` helper + 60s `PAYMENT_SHEET_TIMEOUT_MS` constant in `packages/payments-native/useStripePaymentSheet.ts` wrapping both `initPaymentSheet` and `presentPaymentSheet` native calls inside the existing IIFEs so the `finally` blocks still clear the in-flight refs on timeout, with synthetic error `code: "Timeout"` and the diagnostic log line `[useStripePaymentSheet] <label> timed out after <ms>ms` per spec §3.3; (4) regression script `app-mobile/scripts/ci/orch-0829b-d1-regression-check.mjs` covering all 9 contracts in spec §3.4 S4 wired via new `npm run test:orch-0829b-d1` script; (5) strict-grep CI gate `.github/scripts/strict-grep/orch-0829b-d1-checkout-expiry-tombstone-or-clause-present.mjs` plus single job entry in `.github/workflows/strict-grep-mingla-business.yml` per spec §3.4 S5 mirroring `feedback_strict_grep_registry_pattern.md`. Hard guards: stay strictly within the named files; do NOT modify `supabase/functions/ticket-checkout-create/index.ts` (this spec is a pure-RPC fix on the DB side plus two mobile defensive patches — no edge function source change is needed or permitted in this scope); do NOT run `supabase db push` (operator owns that gate); do NOT deploy any edge function (orchestrator owns deploys and this spec needs zero edge deploys); do NOT touch the original ORCH-0829-B once-only guard refs/logic (preserve as-is); migration filename's monotonic timestamp prefix MUST be strictly greater than `20260605000001`; before writing the migration's CREATE OR REPLACE FUNCTION body, re-read `supabase/migrations/20260520000002_orch_0791_session_terminal_tombstone.sql` lines 115-249 to ensure verbatim copy of the unchanged portion (use the Deno gate from cross-skill parity rule 8 to validate `supabase/functions/_shared/` import chain still resolves if you touch anything by accident — but you shouldn't be touching anything there); run `npm run test:orch-0829b-d1` after each step and confirm 9/9 PASS at the end; run `npm run test:orch-0829a` (15/15 PASS) + `npm run test:orch-0829b` (6/6 PASS) to confirm no regression on the prior passes; run `tsc --noEmit` in app-mobile and confirm no NEW TS errors on touched files. Expected output: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0829-B_D1_CHECKOUT_EXPIRY_TOMBSTONE.md` with full old→new receipts per file (5 files modified + 4 files created), spec-traceability matrix mapping each S1-S5 + C1-C11 to a verification, regression-surface notes, and a Discoveries-for-Orchestrator section. Downstream routing: IMPLEMENT return → orchestrator REVIEW + operator runs `supabase db push --linked` → orchestrator post-push SQL probe per spec §3.1 confirms `or_clause_present=true` → Claude `mingla-forensics` (TEST mode) RETEST_3 live-fire on iPhone 17 Pro sim covering all spec criteria T-C1..T-C14 → orchestrator CLOSE of four-ORCH bundle 0824 + 0828 + 0829-A + 0829-B in one PR Seth→main with pre-merge gate.