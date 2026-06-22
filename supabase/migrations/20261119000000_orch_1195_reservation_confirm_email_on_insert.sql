-- ORCH-1195 FIX 3 — enqueue the buyer reservation-confirmation email on booking
-- CREATION (INSERT), not just on a requested→confirmed UPDATE.
--
-- Root cause (verified in prod: SELECT count(*) FROM notification_outbox
-- WHERE category_key='buyer_reservation_confirmed' = 0): the ORCH-1161 producer
-- `orch_1161_reservation_notify_outbox()` was an AFTER **UPDATE**-only trigger that
-- maps `requested → confirmed`. But the fee/table reservation flow
-- (pg_finalize_guest_reservation / pg_create_guest_reservation, default
-- p_status='confirmed') INSERTs the row ALREADY 'confirmed' — so the
-- requested→confirmed UPDATE never happens, the trigger never fires, and NO
-- confirmation email is ever queued. The template (`buyer_reservation_confirmed`),
-- the category seed (transactional, email channel), and the dispatcher all already
-- exist — ONLY the producer was missing.
--
-- FIX: make the SAME trigger function ALSO fire on INSERT. When a reservation is
-- born 'confirmed', enqueue the identical `buyer_reservation_confirmed`
-- notification_outbox row the UPDATE path would. A STABLE idempotency_key
-- (`buyer_reservation_confirmed:<reservation_id>`) guarantees exactly one confirmed
-- email per reservation and dedups against any later requested→confirmed UPDATE on
-- the same row. The existing UPDATE behavior is byte-identical (unchanged).
--
-- ENQUEUE ONLY — never touches money/lifecycle (DO-NOT-TOUCH, per ORCH-1161).

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
  -- ORCH-1195 — INSERT path: the fee/table reservation is born 'confirmed' (no
  -- requested→confirmed UPDATE ever fires), so the buyer confirmation email MUST be
  -- enqueued here. Anon guests (consumer_user_id NULL) still get the transactional
  -- email — can_send short-circuits on null user_id and the contact resolves to the
  -- guest email/phone, exactly as the UPDATE path does.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'confirmed' THEN
      v_contact := COALESCE(NEW.guest_phone_e164, NEW.guest_email);
      -- STABLE key (no timestamp): one confirmed email per reservation, and a
      -- later requested→confirmed UPDATE on the same row dedups to a no-op.
      v_idem := 'buyer_reservation_confirmed:' || NEW.id::text;

      INSERT INTO public.notification_outbox
        (category_key, user_id, contact, brand_id, payload, idempotency_key)
      VALUES (
        'buyer_reservation_confirmed',
        NEW.consumer_user_id,
        v_contact,
        NEW.brand_id,
        jsonb_build_object(
          'reservation_id',   NEW.id,
          'status',           NEW.status,
          'reserved_for',     NEW.reserved_for,
          'party_size',       NEW.party_size,
          'guest_name',       NEW.guest_name,
          'guest_phone_e164', NEW.guest_phone_e164,
          'guest_email',      NEW.guest_email
        ),
        v_idem
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;

  -- ── UPDATE path (UNCHANGED from ORCH-1161 §7.2) ──
  -- Only enqueue on a real change to status / table / time.
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id
     AND NEW.reserved_for IS NOT DISTINCT FROM OLD.reserved_for THEN
    RETURN NEW;
  END IF;

  -- Map the transition to a category.
  IF NEW.status IN ('cancelled_by_guest','cancelled_by_venue')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    v_category := 'buyer_reservation_cancelled';
  ELSIF NEW.status = 'confirmed' AND OLD.status = 'requested' THEN
    v_category := 'buyer_reservation_confirmed';
  ELSE
    v_category := 'buyer_reservation_changed';
  END IF;

  v_contact := COALESCE(NEW.guest_phone_e164, NEW.guest_email);

  -- For the requested→confirmed UPDATE use the SAME stable confirmed key so it
  -- dedups against the INSERT enqueue above; other transitions keep the per-instant
  -- key (a reservation can legitimately change/cancel more than once).
  IF v_category = 'buyer_reservation_confirmed' THEN
    v_idem := 'buyer_reservation_confirmed:' || NEW.id::text;
  ELSE
    v_idem := v_category || ':' || NEW.id::text || ':'
              || to_char(now(), 'YYYYMMDD"T"HH24MISSMS');
  END IF;

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

-- ORCH-1195 — fire on INSERT (born-confirmed) AND UPDATE (transitions).
DROP TRIGGER IF EXISTS orch_1161_reservation_notify_trg ON public.reservations;
CREATE TRIGGER orch_1161_reservation_notify_trg
  AFTER INSERT OR UPDATE ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.orch_1161_reservation_notify_outbox();

COMMENT ON FUNCTION public.orch_1161_reservation_notify_outbox() IS
  'META-ORCH-1161 §7.2 + ORCH-1195 — enqueues a notification_outbox row on '
  'reservation INSERT (born-confirmed → buyer_reservation_confirmed) and on '
  'status/table/time UPDATE. ENQUEUE ONLY; never touches money/lifecycle.';
