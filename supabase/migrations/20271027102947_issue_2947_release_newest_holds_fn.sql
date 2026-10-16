-- ===========================================================================
-- #2879 / #2947 rule 5 — a capacity cut mid-sale releases the NEWEST holds first.
--
-- This ships the release FUNCTION only, with no trigger. Main has moved since the
-- #2947 SPEC: `issue_1930_ticket_types_revoke` (AFTER UPDATE OF quantity_total, among
-- other columns) calls issue_1930_revoke_event_checkout_admissions, which marks the
-- event not sellable and fails EVERY open hold for the event ('inventory_changed')
-- before any rule-5 trigger could run. So on current main a capacity cut already
-- releases all holds, not the newest, and a rule-5 trigger would find nothing to
-- release. Reconciling that is a product/design decision recorded on #2879 and is
-- deliberately not made here. The function is correct on its own, callable by the
-- service role, and is what a reconciled trigger or an explicit organiser action
-- would call.
--
-- WHAT IS RELEASED. Only holds that carry no payment: status `pending_free` or
-- `requires_payment`, no payment reference, no order. A buyer on the provider's
-- page (`awaiting_web_redirect`), mid-charge (`processing_payment`) or with a
-- PaymentIntent is never released here; releasing them would charge and reverse.
-- Queued holds (`expires_at = 'infinity'`) are ordinary holds for this purpose and
-- their queue entry is released with them.
--
-- NOT A TIME-BASED EXPIRY. This is an explicit organiser-triggered release and
-- carries its own `failure_reason`, so it is never confused with the sweep, which
-- remains the only owner of expiry on the passage of time.
--
-- A cut below `sold` is #2888's floor guard, not this migration's: this releases
-- holds and nothing else. The waitlist handoff for the freed stock is a later slice.
-- Order is deterministic: created_at DESC, then id DESC.
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_2947_release_newest_holds(p_ticket_type_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_total integer;
  v_unlimited boolean;
  v_sold integer;
  v_held integer;
  v_excess integer;
  v_freed integer := 0;
  v_released integer := 0;
  v_now timestamptz := clock_timestamp();
  r record;
BEGIN
  SELECT tt.quantity_total, tt.is_unlimited, tt.sold_count
    INTO v_total, v_unlimited, v_sold
    FROM public.ticket_types tt
   WHERE tt.id = p_ticket_type_id
   FOR UPDATE;
  IF NOT FOUND OR v_total IS NULL OR COALESCE(v_unlimited, false) THEN
    RETURN 0;
  END IF;

  v_held := public.issue_2491_derived_held(p_ticket_type_id);
  v_excess := COALESCE(v_sold, 0) + v_held - v_total;
  IF v_excess <= 0 THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT s.id AS session_id,
           (SELECT SUM(i.quantity)::integer
              FROM public.ticket_checkout_session_items i
             WHERE i.checkout_session_id = s.id
               AND i.ticket_type_id = p_ticket_type_id) AS qty
      FROM public.ticket_checkout_sessions s
     WHERE EXISTS (SELECT 1 FROM public.ticket_checkout_session_items i
                    WHERE i.checkout_session_id = s.id
                      AND i.ticket_type_id = p_ticket_type_id)
       AND s.expires_at > v_now
       AND s.status IN ('pending_free', 'requires_payment')
       AND s.stripe_payment_intent_id IS NULL
       AND s.order_id IS NULL
     ORDER BY s.created_at DESC, s.id DESC
     FOR UPDATE OF s
  LOOP
    EXIT WHEN v_freed >= v_excess;

    UPDATE public.ticket_checkout_sessions s
       SET status = 'expired',
           expires_at = v_now,
           failed_at = v_now,
           failure_reason = 'capacity_reduced_by_organiser',
           updated_at = v_now
     WHERE s.id = r.session_id;

    UPDATE public.ticket_queue_entries q
       SET released_at = v_now,
           release_reason = 'capacity_reduced_by_organiser'
     WHERE q.checkout_session_id = r.session_id
       AND q.released_at IS NULL;

    v_freed := v_freed + r.qty;
    v_released := v_released + 1;
  END LOOP;

  RETURN v_released;
END
$fn$;

REVOKE ALL ON FUNCTION public.issue_2947_release_newest_holds(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2947_release_newest_holds(uuid) TO service_role;

DO $probe$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'issue_2947_capacity_cut'
              AND tgrelid = 'public.ticket_types'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'PROBE FAIL: no capacity-cut trigger may ship until #1930 inventory revocation is reconciled (see #2879)';
  END IF;
  IF has_function_privilege('anon', 'public.issue_2947_release_newest_holds(uuid)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_2947_release_newest_holds(uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'PROBE FAIL: anon/authenticated can execute issue_2947_release_newest_holds';
  END IF;
END
$probe$;

COMMIT;
