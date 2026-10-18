-- ===========================================================================
-- #2879 / #2947 slices 4+5 — set-based free/NO_REF expiry + waitlist drain handoff.
--
-- Slice 4: `issue_2947_expire_no_ref_holds` expires past-cutoff rows with NO payment
-- reference (classifyRef → NO_REF) in one statement, releases their queue entries,
-- and returns freed qty per ticket type. Equivalence to classify(): for NO_REF,
-- classify returns expire iff expires_at < now — the same predicate. PAYSTACK
-- (mingla_* in the PI column) and Stripe refs are never touched here.
--
-- Slice 5: `issue_2947_waitlist_drain_for_ticket_type` factors the invite loop out
-- of `fn_waitlist_drain_on_capacity_freed` so a released *hold* (sweep) and a
-- refunded *ticket* (trigger) invite waitlisted buyers in the same join order.
-- The trigger is re-emitted to delegate; this is ORCH-0948 lineage, not a
-- checkout-guard re-emit.
--
-- `issue_2947_note_expired_session` is the per-row companion for the Stripe arm
-- after a successful expiry CAS: release the queue entry and return freed qty.
--
-- The sweep (reconcile-stuck-checkouts) owns calling the drain after both arms.
-- ===========================================================================

BEGIN;

-- ── Shared invite loop (slice 5) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_2947_waitlist_drain_for_ticket_type(
  p_ticket_type_id uuid,
  p_freed integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_running integer := 0;
  v_entry record;
  v_notification_id uuid;
  v_channel text;
  v_recipient text;
BEGIN
  IF p_ticket_type_id IS NULL OR p_freed IS NULL OR p_freed < 1 THEN
    RETURN 0;
  END IF;

  FOR v_entry IN
    SELECT id, event_id, ticket_type_id, email, phone, qty_requested
      FROM public.waitlist_entries
     WHERE ticket_type_id = p_ticket_type_id
       AND status = 'waiting'
       AND notified_at IS NULL
     ORDER BY created_at ASC, id ASC
  LOOP
    EXIT WHEN v_running >= p_freed;

    IF v_entry.email IS NOT NULL AND length(btrim(v_entry.email)) > 0 THEN
      v_channel := 'email';
      v_recipient := v_entry.email;
    ELSIF v_entry.phone IS NOT NULL AND length(btrim(v_entry.phone)) > 0 THEN
      v_channel := 'sms';
      v_recipient := v_entry.phone;
    ELSE
      CONTINUE;
    END IF;

    INSERT INTO public.ticket_order_notifications
      (order_id, event_id, channel, recipient, status, payload, idempotency_key, attempt_count)
    VALUES
      (NULL, v_entry.event_id, v_channel, v_recipient, 'pending',
       jsonb_build_object(
         'template_key','waitlist_spot_open',
         'waitlist_entry_id', v_entry.id,
         'event_id', v_entry.event_id,
         'ticket_type_id', v_entry.ticket_type_id,
         'qty_requested', v_entry.qty_requested,
         'invite_expires_at', (now() + interval '24 hours')
       ),
       'waitlist_invite:' || v_entry.id::text,
       0)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_notification_id;

    IF v_notification_id IS NOT NULL THEN
      UPDATE public.waitlist_entries
         SET status = 'invited',
             invited_at = now(),
             notified_at = now(),
             notification_id = v_notification_id
       WHERE id = v_entry.id;
      v_running := v_running + v_entry.qty_requested;
    END IF;
  END LOOP;

  RETURN v_running;
END
$fn$;

COMMENT ON FUNCTION public.issue_2947_waitlist_drain_for_ticket_type(uuid, integer) IS
  'issue #2947 slices 4+5 — invite waiting waitlist_entries in created_at ASC join order '
  'up to p_freed seats. Called by the sweep after hold expiry and by fn_waitlist_drain_on_capacity_freed.';

REVOKE ALL ON FUNCTION public.issue_2947_waitlist_drain_for_ticket_type(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2947_waitlist_drain_for_ticket_type(uuid, integer)
  TO service_role;

-- ── Trigger delegates (slice 5 re-emit of ORCH-0948 body only) ───────────────
CREATE OR REPLACE FUNCTION public.fn_waitlist_drain_on_capacity_freed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NEW.status NOT IN ('refunded','cancelled','void') THEN RETURN NEW; END IF;
  IF OLD.status NOT IN ('valid','used','transferred') THEN RETURN NEW; END IF;
  IF NEW.ticket_type_id IS NULL THEN RETURN NEW; END IF;

  PERFORM public.issue_2947_waitlist_drain_for_ticket_type(NEW.ticket_type_id, 1);
  RETURN NEW;
END
$fn$;

-- ── Per-session side effects after arm B expiry CAS ─────────────────────────
CREATE OR REPLACE FUNCTION public.issue_2947_note_expired_session(
  p_session_id uuid,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS TABLE(ticket_type_id uuid, freed_qty integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF p_session_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.ticket_queue_entries q
     SET released_at = p_now,
         release_reason = 'abandoned_past_expiry'
   WHERE q.checkout_session_id = p_session_id
     AND q.released_at IS NULL;

  RETURN QUERY
  SELECT i.ticket_type_id, SUM(i.quantity)::integer
    FROM public.ticket_checkout_session_items i
   WHERE i.checkout_session_id = p_session_id
   GROUP BY i.ticket_type_id
   HAVING SUM(i.quantity) > 0;
END
$fn$;

COMMENT ON FUNCTION public.issue_2947_note_expired_session(uuid, timestamptz) IS
  'issue #2947 slice 4 — after a successful per-row expiry CAS, release any queue entry '
  'and return freed qty per ticket type for the waitlist drain handoff.';

REVOKE ALL ON FUNCTION public.issue_2947_note_expired_session(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2947_note_expired_session(uuid, timestamptz)
  TO service_role;

-- ── Set-based free / NO_REF arm (slice 4) ───────────────────────────────────
-- Returns jsonb: { "expired_count": int, "freed": [{ "ticket_type_id", "freed_qty" }, ...] }
CREATE OR REPLACE FUNCTION public.issue_2947_expire_no_ref_holds(
  p_now timestamptz DEFAULT clock_timestamp(),
  p_limit integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_limit integer := GREATEST(COALESCE(p_limit, 5000), 0);
  v_ids uuid[];
  v_expired integer := 0;
  v_freed jsonb := '[]'::jsonb;
BEGIN
  IF v_limit < 1 THEN
    RETURN jsonb_build_object('expired_count', 0, 'freed', '[]'::jsonb);
  END IF;

  WITH picked AS (
    SELECT s.id
      FROM public.ticket_checkout_sessions s
     WHERE s.status IN (
             'processing_payment',
             'awaiting_web_redirect',
             'requires_payment',
             'pending_free'
           )
       AND s.stripe_payment_intent_id IS NULL
       AND s.stripe_checkout_session_id IS NULL
       AND s.order_id IS NULL
       AND s.expires_at < p_now
     ORDER BY s.created_at ASC, s.id ASC
     LIMIT v_limit
     FOR UPDATE OF s SKIP LOCKED
  )
  SELECT COALESCE(array_agg(picked.id), ARRAY[]::uuid[])
    INTO v_ids
    FROM picked;

  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RETURN jsonb_build_object('expired_count', 0, 'freed', '[]'::jsonb);
  END IF;

  UPDATE public.ticket_checkout_sessions s
     SET status = 'expired',
         failed_at = p_now,
         failure_reason = 'abandoned_past_expiry',
         updated_at = p_now
   WHERE s.id = ANY (v_ids)
     AND s.status IN (
           'processing_payment',
           'awaiting_web_redirect',
           'requires_payment',
           'pending_free'
         )
     AND s.stripe_payment_intent_id IS NULL
     AND s.stripe_checkout_session_id IS NULL
     AND s.order_id IS NULL
     AND s.expires_at < p_now;

  GET DIAGNOSTICS v_expired = ROW_COUNT;

  UPDATE public.ticket_queue_entries q
     SET released_at = p_now,
         release_reason = 'abandoned_past_expiry'
   WHERE q.checkout_session_id = ANY (v_ids)
     AND q.released_at IS NULL;

  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'ticket_type_id', x.ticket_type_id,
               'freed_qty', x.freed_qty
             )
             ORDER BY x.ticket_type_id
           ),
           '[]'::jsonb
         )
    INTO v_freed
    FROM (
      SELECT i.ticket_type_id, SUM(i.quantity)::integer AS freed_qty
        FROM public.ticket_checkout_session_items i
       WHERE i.checkout_session_id = ANY (v_ids)
       GROUP BY i.ticket_type_id
      HAVING SUM(i.quantity) > 0
    ) x;

  RETURN jsonb_build_object('expired_count', v_expired, 'freed', v_freed);
END
$fn$;

COMMENT ON FUNCTION public.issue_2947_expire_no_ref_holds(timestamptz, integer) IS
  'issue #2947 slice 4 — set-based expiry for NO_REF holds (both Stripe ref columns null). '
  'Provably equivalent to classify() for NO_REF: expire iff expires_at < now. Never touches '
  'PAYSTACK or Stripe-referenced rows. Releases queue entries; caller drains the waitlist.';

REVOKE ALL ON FUNCTION public.issue_2947_expire_no_ref_holds(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2947_expire_no_ref_holds(timestamptz, integer)
  TO service_role;

-- ── Probes ──────────────────────────────────────────────────────────────────
DO $probe$
DECLARE
  v_drain_src text;
  v_trigger_src text;
BEGIN
  IF has_function_privilege(
       'anon',
       'public.issue_2947_waitlist_drain_for_ticket_type(uuid, integer)'::regprocedure,
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.issue_2947_waitlist_drain_for_ticket_type(uuid, integer)'::regprocedure,
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.issue_2947_expire_no_ref_holds(timestamptz, integer)'::regprocedure,
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.issue_2947_expire_no_ref_holds(timestamptz, integer)'::regprocedure,
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.issue_2947_note_expired_session(uuid, timestamptz)'::regprocedure,
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.issue_2947_note_expired_session(uuid, timestamptz)'::regprocedure,
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION 'PROBE FAIL: anon/authenticated can execute issue_2947 waitlist/expire helpers';
  END IF;

  SELECT pg_get_functiondef('public.fn_waitlist_drain_on_capacity_freed()'::regprocedure)
    INTO v_trigger_src;
  IF v_trigger_src IS NULL
     OR position('issue_2947_waitlist_drain_for_ticket_type' IN v_trigger_src) = 0
  THEN
    RAISE EXCEPTION 'PROBE FAIL: fn_waitlist_drain_on_capacity_freed must delegate to issue_2947_waitlist_drain_for_ticket_type';
  END IF;

  SELECT pg_get_functiondef(
           'public.issue_2947_expire_no_ref_holds(timestamptz, integer)'::regprocedure
         )
    INTO v_drain_src;
  IF v_drain_src IS NULL
     OR position('stripe_payment_intent_id IS NULL' IN v_drain_src) = 0
     OR position('stripe_checkout_session_id IS NULL' IN v_drain_src) = 0
     OR position('abandoned_past_expiry' IN v_drain_src) = 0
  THEN
    RAISE EXCEPTION 'PROBE FAIL: expire_no_ref_holds must require both Stripe refs null and stamp abandoned_past_expiry';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_waitlist_drain_on_capacity_freed'
       AND tgrelid = 'public.tickets'::regclass
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'PROBE FAIL: trg_waitlist_drain_on_capacity_freed missing on tickets';
  END IF;
END
$probe$;

COMMIT;
