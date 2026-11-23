-- Issue #4490, spec 08 O4 fix round 1 (file number 608490). Four defects
-- from the independent O4 test, each fixed at its source:
--
-- O4-T1 (money paid twice). A paid table deposit used on a Till check could
--   also be refunded: the refund guard trusted reservations.deposit_applied_sale_id,
--   which any event manager could clear over REST, move the booking back to
--   confirmed and cancel it with a refund. Now
--   (a) the guard decides from the LIVE deposit_credit line (kind
--       deposit_credit, not voided, for that booking), and still refuses
--       while the stamp is set; it takes the booking's row lock first so a
--       seat or a void running at the same time is waited for;
--   (b) the stamp is server-owned: a BEFORE INSERT/UPDATE trigger on
--       reservations refuses any change to deposit_applied_sale_id that is
--       not made by the #4490 Till functions (a transaction-local marker the
--       seat and the void set for that one booking), except the foreign
--       key's own SET NULL when the check row is gone;
--   (c) while a booking's deposit is live on a check, its status can leave
--       'seated' only for 'completed'. Every other move (confirmed,
--       requested, waitlisted, cancelled_by_guest, cancelled_by_venue,
--       no_show), by any path, is refused with reservation_deposit_used.
--       Voiding the credit line (the only way a live deposit leaves a check)
--       lifts both rules: the deposit is refundable again, once, by the
--       booking's own rules.
--   With no deposit credit the three live cancel/refund RPCs behave exactly
--   as before (the guard and the trigger read nothing else and change
--   nothing).
--
-- O4-T3 ("Paid in today" wrong) is added below, then O4-T2 and O4-T4.
--
-- Re-emits functions from their latest bodies (607490 or later): patched in
-- place where the change is small (precondition-counted), replaced whole
-- otherwise. pg_venue_order_finalize_payment is NOT touched. No venue_id
-- column (the #2099 seal is unchanged). Static SQL. Local stack only until
-- Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_o4f1_patch(
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
    RAISE EXCEPTION 'issue_4490 O4 fix 1 patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ===========================================================================
-- O4-T1 (a): the refund guard reads the live credit line.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_reservation_deposit_refund_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- The booking's row lock first: a seat (which locks the booking before it
  -- puts the deposit on a check) or a void of the credit (which clears the
  -- stamp on the booking) running now is waited for, then read as committed.
  PERFORM 1 FROM public.reservations r WHERE r.id = NEW.subject_id FOR NO KEY UPDATE;
  IF EXISTS (SELECT 1 FROM public.venue_till_lines l
             WHERE l.reservation_id = NEW.subject_id AND l.kind = 'deposit_credit' AND l.state <> 'voided')
     OR EXISTS (SELECT 1 FROM public.reservations r
                WHERE r.id = NEW.subject_id AND r.deposit_applied_sale_id IS NOT NULL) THEN
    RAISE EXCEPTION 'reservation_deposit_used' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

-- ===========================================================================
-- O4-T1 (b) + (c): the stamp is server-owned; a booking whose deposit is on
-- a check stays seated (or completes).
-- ===========================================================================
CREATE FUNCTION public.issue_4490_reservation_deposit_owned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deposit_applied_sale_id IS NOT NULL THEN
      RAISE EXCEPTION 'reservation_deposit_server_owned' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.deposit_applied_sale_id IS DISTINCT FROM OLD.deposit_applied_sale_id
     AND current_setting('mingla.issue_4490_deposit_stamp', true) IS DISTINCT FROM NEW.id::text
     -- The foreign key's own ON DELETE SET NULL (the check row is gone).
     AND NOT (NEW.deposit_applied_sale_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.venue_till_sales s WHERE s.id = OLD.deposit_applied_sale_id)) THEN
    RAISE EXCEPTION 'reservation_deposit_server_owned' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'seated' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IS DISTINCT FROM 'completed'
     AND EXISTS (SELECT 1 FROM public.venue_till_lines l
                 WHERE l.reservation_id = NEW.id AND l.kind = 'deposit_credit' AND l.state <> 'voided') THEN
    RAISE EXCEPTION 'reservation_deposit_used' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER issue_4490_reservation_deposit_owned_ins
  BEFORE INSERT ON public.reservations
  FOR EACH ROW WHEN (NEW.deposit_applied_sale_id IS NOT NULL)
  EXECUTE FUNCTION public.issue_4490_reservation_deposit_owned();
CREATE TRIGGER issue_4490_reservation_deposit_owned_upd
  BEFORE UPDATE ON public.reservations
  FOR EACH ROW WHEN (NEW.deposit_applied_sale_id IS DISTINCT FROM OLD.deposit_applied_sale_id
                     OR (OLD.status = 'seated' AND NEW.status IS DISTINCT FROM OLD.status))
  EXECUTE FUNCTION public.issue_4490_reservation_deposit_owned();

-- The two Till paths that own the stamp say so, for that booking only.
SELECT pg_temp.issue_4490_o4f1_patch(
  'public.issue_4490_till_seat(uuid,uuid,uuid,integer,uuid,text,uuid,text)'::regprocedure,
  $old$      UPDATE public.reservations SET deposit_applied_sale_id = v_sale.id WHERE id = v_res.id;$old$,
  $new$      PERFORM set_config('mingla.issue_4490_deposit_stamp', v_res.id::text, true);
      UPDATE public.reservations SET deposit_applied_sale_id = v_sale.id WHERE id = v_res.id;
      PERFORM set_config('mingla.issue_4490_deposit_stamp', '', true);$new$);
SELECT pg_temp.issue_4490_o4f1_patch(
  'public.issue_4490_till_line_voided()'::regprocedure,
  $old$    UPDATE public.reservations SET deposit_applied_sale_id = NULL
    WHERE id = NEW.reservation_id AND deposit_applied_sale_id = NEW.sale_id;$old$,
  $new$    PERFORM set_config('mingla.issue_4490_deposit_stamp', NEW.reservation_id::text, true);
    UPDATE public.reservations SET deposit_applied_sale_id = NULL
    WHERE id = NEW.reservation_id AND deposit_applied_sale_id = NEW.sale_id;
    PERFORM set_config('mingla.issue_4490_deposit_stamp', '', true);$new$);

-- @@NEXT@@

-- ---------------------------------------------------------------------------
-- Privileges: every new function is internal (service role only).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.issue_4490_reservation_deposit_owned()
FROM PUBLIC, anon, authenticated;

COMMIT;
