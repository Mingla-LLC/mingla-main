-- META-ORCH-1161 Sub-A (thin slice) — can_send() gate + reservation→outbox trigger.
--
-- can_send() (SPEC §5.3) is the SINGLE consent chokepoint. Simultaneous model
-- (DEC-185): the dispatcher calls can_send() once per channel and fires EVERY
-- channel that passes — there is no fallback ordering. can_send() itself has no
-- waterfall logic; it answers a pure per-channel question.
--
-- The AFTER UPDATE trigger on reservations (SPEC §7.2) writes a notification_outbox
-- row on a status/table/time change → mapped to buyer_reservation_changed. It does
-- NOT touch reservation money/lifecycle logic (DO-NOT-TOUCH) — it only enqueues.

-- =============================================================
-- §1. can_send(user, category, channel, contact) — SECURITY DEFINER.
-- =============================================================
-- Returns true iff:
--   category active
--   AND channel ∈ category.default_channels
--   AND (is_transactional OR an explicit pref enabled=true)   -- marketing off-by-default
--   AND no explicit per-(category,channel) opt-out row (enabled=false)
--   AND no suppression for (user|contact, channel, scope ∈ {category_scope,'all'})
-- Quiet-hours is a marketing-only concern (Sub-B) and is NOT applied to
-- transactional categories here (thin slice is transactional-only).
CREATE OR REPLACE FUNCTION public.can_send(
  p_user_id uuid,
  p_category_key text,
  p_channel text,
  p_contact text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_cat            public.notification_categories%ROWTYPE;
  v_pref_enabled   boolean;
  v_category_scope text;
  v_suppressed     boolean;
BEGIN
  -- 1. Category must exist + be active.
  SELECT * INTO v_cat
    FROM public.notification_categories
   WHERE key = p_category_key;
  IF NOT FOUND OR v_cat.active IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- 2. Channel must be in the category's default_channels.
  IF NOT (p_channel = ANY (v_cat.default_channels)) THEN
    RETURN false;
  END IF;

  -- 3. Pref gate. Look up the explicit per-(category,channel) pref (if any).
  v_pref_enabled := NULL;
  IF p_user_id IS NOT NULL THEN
    SELECT enabled INTO v_pref_enabled
      FROM public.notification_channel_prefs
     WHERE user_id = p_user_id
       AND category_key = p_category_key
       AND channel = p_channel;
  END IF;

  IF v_cat.is_transactional THEN
    -- Transactional: on-by-default; an EXPLICIT enabled=false opts out of this channel.
    IF v_pref_enabled IS NOT NULL AND v_pref_enabled = false THEN
      RETURN false;
    END IF;
  ELSE
    -- Marketing: off-by-default; requires an explicit enabled=true.
    IF v_pref_enabled IS DISTINCT FROM true THEN
      RETURN false;
    END IF;
  END IF;

  -- 4. Suppression gate (only email/sms can be suppressed; inapp/push always pass step 4).
  IF p_channel IN ('email','sms') THEN
    v_category_scope := CASE WHEN v_cat.is_transactional
                             THEN 'transactional' ELSE 'marketing' END;
    SELECT EXISTS (
      SELECT 1 FROM public.channel_suppressions s
       WHERE s.channel = p_channel
         AND s.scope IN (v_category_scope, 'all')
         AND (
           (p_user_id IS NOT NULL AND s.user_id = p_user_id)
           OR (p_contact IS NOT NULL AND s.contact = lower(p_contact))
           OR (p_contact IS NOT NULL AND s.contact = p_contact)
         )
    ) INTO v_suppressed;
    IF v_suppressed THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$function$;

-- SECURITY DEFINER auto-grant gotcha — REVOKE PUBLIC + anon explicitly.
REVOKE ALL ON FUNCTION public.can_send(uuid, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_send(uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_send(uuid, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.can_send(uuid, text, text, text) IS
  'META-ORCH-1161 §5.3 — the single consent chokepoint. Pure per-channel answer; '
  'the dispatcher fires every channel that returns true (DEC-185 simultaneous, no fallback).';

-- =============================================================
-- §2. reservations AFTER UPDATE → notification_outbox (buyer_reservation_changed).
-- =============================================================
-- Fires only on a meaningful change: status, table_id, or reserved_for (time).
-- Maps to buyer_reservation_changed. confirmed/cancelled mappings are documented
-- but the thin slice only PROVES `changed`. The trigger only ENQUEUES — it never
-- touches money/lifecycle (DO-NOT-TOUCH).
CREATE OR REPLACE FUNCTION public.orch_1161_reservation_notify_outbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_category text;
  v_contact  text;
  v_idem     text;
BEGIN
  -- Only enqueue on a real change to status / table / time.
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id
     AND NEW.reserved_for IS NOT DISTINCT FROM OLD.reserved_for THEN
    RETURN NEW;
  END IF;

  -- Map the transition to a category. Thin slice proves `changed`.
  IF NEW.status IN ('cancelled_by_guest','cancelled_by_venue')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    v_category := 'buyer_reservation_cancelled';
  ELSIF NEW.status = 'confirmed' AND OLD.status = 'requested' THEN
    v_category := 'buyer_reservation_confirmed';
  ELSE
    -- table reassignment, time change, seated, or any other status move.
    v_category := 'buyer_reservation_changed';
  END IF;

  -- Contact for the SMS/email leg: the guest phone (preferred) or email.
  v_contact := COALESCE(NEW.guest_phone_e164, NEW.guest_email);

  -- Idempotency: one outbox row per (category, reservation, transition instant).
  v_idem := v_category || ':' || NEW.id::text || ':'
            || to_char(now(), 'YYYYMMDD"T"HH24MISSMS');

  INSERT INTO public.notification_outbox
    (category_key, user_id, contact, brand_id, payload, idempotency_key)
  VALUES (
    v_category,
    NEW.consumer_user_id,
    v_contact,
    NEW.brand_id,
    jsonb_build_object(
      'reservation_id', NEW.id,
      'status',         NEW.status,
      'reserved_for',   NEW.reserved_for,
      'party_size',     NEW.party_size,
      'guest_name',     NEW.guest_name,
      'guest_phone_e164', NEW.guest_phone_e164,
      'guest_email',    NEW.guest_email
    ),
    v_idem
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.orch_1161_reservation_notify_outbox() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.orch_1161_reservation_notify_outbox() FROM anon;

DROP TRIGGER IF EXISTS orch_1161_reservation_notify_trg ON public.reservations;
CREATE TRIGGER orch_1161_reservation_notify_trg
  AFTER UPDATE ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.orch_1161_reservation_notify_outbox();

COMMENT ON FUNCTION public.orch_1161_reservation_notify_outbox() IS
  'META-ORCH-1161 §7.2 — enqueues a notification_outbox row on a reservation '
  'status/table/time change. ENQUEUE ONLY; never touches money/lifecycle.';
