-- Issue #4490, spec 08 O4 fix round 2 (file number 609490). Two defects from
-- the O4 browser pass are owned by the server:
--
-- O4-B3 (guest money). After a seated booking's table-deposit credit was
--   voided, the Host's cancel could never refund it: the booking stayed
--   'seated' and a seated booking is never refunded automatically
--   (seated_no_auto_refund, the live #3391 rule, unchanged). Voiding the
--   deposit credit on an open check now also UNSEATS the booking, server-side
--   inside the void (issue_4490_till_line_voided, the trigger the void
--   already fires): the booking goes back to the status it had before the
--   Till seated it (confirmed or requested; confirmed when the Till did not
--   seat it), an audit row says why, and the check no longer carries the
--   booking. The booking's own rules then apply: the Host's cancel refunds
--   the deposit once (the refund guard of 608490 allows it: no live credit).
--   Never a client-editable field: only the void does it.
-- O4-B2. The sale projection's split.evenOnly counted an UNPAID even split as
--   money already paid, so the Pay sheet greyed "By item" and said "Part of
--   this bill is already paid" after "2 ways" with nothing paid. set_split
--   itself drops unpaid shares first and was right; the projection now
--   counts an even share only once it is being paid or paid (the rule of
--   O4 deviation 8: an unshared payment, a paid even share, a refund, a
--   deposit).
--
-- Re-emits from the latest bodies (608490 for the line-voided trigger, 607490
-- for the sale extras), patched in place, precondition-counted. No live
-- cancel/refund function is touched. pg_venue_order_finalize_payment is NOT
-- touched. No venue_id column (the #2099 seal is unchanged). Static SQL.
-- Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_o4f2_patch(
  p_sig regprocedure,
  p_old text,
  p_new text,
  p_count integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> p_count THEN
    RAISE EXCEPTION 'issue_4490 O4 fix 2 patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ===========================================================================
-- O4-B3: voiding the deposit credit unseats the booking (server-side).
-- ===========================================================================
SELECT pg_temp.issue_4490_o4f2_patch(
  'public.issue_4490_till_line_voided()'::regprocedure,
  $old$AS $function$
BEGIN
  IF NEW.state <> 'voided' OR OLD.state = 'voided' THEN$old$,
  $new$AS $function$
DECLARE
  v_from text;
  v_brand uuid;
BEGIN
  IF NEW.state <> 'voided' OR OLD.state = 'voided' THEN$new$);
SELECT pg_temp.issue_4490_o4f2_patch(
  'public.issue_4490_till_line_voided()'::regprocedure,
  $old$    PERFORM set_config('mingla.issue_4490_deposit_stamp', '', true);
  ELSIF NEW.kind = 'by_the_hour' THEN$old$,
  $new$    PERFORM set_config('mingla.issue_4490_deposit_stamp', '', true);
    -- #4490 08-O4 fix 2 (O4-B3): the deposit is off an open check, so the
    -- booking is not being served on it: back to the status it had before
    -- the Till seated it, and the check lets go of it. Its own refund rules
    -- apply again (a seated booking is never refunded automatically).
    IF EXISTS (SELECT 1 FROM public.venue_till_sales s WHERE s.id = NEW.sale_id AND s.state IN ('open', 'paying'))
       AND EXISTS (SELECT 1 FROM public.reservations r WHERE r.id = NEW.reservation_id AND r.status = 'seated') THEN
      SELECT a.before->>'status' INTO v_from FROM public.audit_log a
      WHERE a.target_type = 'reservation' AND a.target_id = NEW.reservation_id::text
        AND a.action = 'venue_reservation.transition' AND a.after->>'status' = 'seated'
        AND a.after->>'till_sale_id' = NEW.sale_id::text
      ORDER BY a.created_at DESC LIMIT 1;
      v_from := CASE WHEN v_from IN ('requested', 'confirmed') THEN v_from ELSE 'confirmed' END;
      UPDATE public.reservations SET status = v_from, updated_at = now()
      WHERE id = NEW.reservation_id AND status = 'seated'
      RETURNING brand_id INTO v_brand;
      INSERT INTO public.audit_log (user_id, brand_id, action, target_type, target_id, before, after)
      VALUES (NEW.voided_by_user_id, v_brand, 'venue_reservation.transition', 'reservation', NEW.reservation_id::text,
        jsonb_build_object('status', 'seated'),
        jsonb_build_object('status', v_from, 'reason', 'deposit taken off the bill at the Till', 'till_sale_id', NEW.sale_id));
      UPDATE public.venue_order_sessions SET reservation_id = NULL
      WHERE id = (SELECT s.session_id FROM public.venue_till_sales s WHERE s.id = NEW.sale_id)
        AND reservation_id = NEW.reservation_id;
      UPDATE public.venue_till_sales SET reservation_id = NULL
      WHERE id = NEW.sale_id AND reservation_id = NEW.reservation_id;
    END IF;
  ELSIF NEW.kind = 'by_the_hour' THEN$new$);

-- ===========================================================================
-- O4-B2: an unpaid even split does not make the check "even only".
-- ===========================================================================
SELECT pg_temp.issue_4490_o4f2_patch(
  'public.issue_4490_till_sale_extras(uuid)'::regprocedure,
  $old$OR EXISTS (SELECT 1 FROM public.venue_till_shares sh WHERE sh.sale_id = p_sale_id AND sh.mode = 'even')$old$,
  $new$OR EXISTS (SELECT 1 FROM public.venue_till_shares sh WHERE sh.sale_id = p_sale_id AND sh.mode = 'even'
                          AND sh.state <> 'unpaid')$new$);

COMMIT;
