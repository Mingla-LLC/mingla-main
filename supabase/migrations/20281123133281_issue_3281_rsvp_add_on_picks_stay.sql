-- issue #3281 S6 (checkpoint 15, gap E) — a guest's free RSVP add-on picks
-- outlive their add-on.
--
-- 20281123123281 created event_rsvp_add_ons.add_on_id with ON DELETE CASCADE,
-- so deleting an add-on silently dropped every guest's pick of it (and the door
-- line with it). The spec's rule for an add-on that has been sold or picked is
-- that it stops selling ("Stop selling" / an unlisted add-on is deactivated by
-- biz_offering_add_ons_save) and its rows stay. Order lines already hold their
-- add-on with ON DELETE RESTRICT; picks now hold it the same way, as NO ACTION
-- (checked at the end of the statement), so a statement that removes the picks
-- too (deleting the RSVP, or an offering through its cascades) still works.
--
-- No function, grant or data changes. The guard below refuses to run unless the
-- constraint is exactly the one 20281123123281 created.
BEGIN;
SET LOCAL lock_timeout = '10s';

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = 'public.event_rsvp_add_ons'::regclass
       AND c.conname = 'event_rsvp_add_ons_add_on_id_fkey'
       AND c.contype = 'f'
       AND c.confrelid = 'public.ticket_add_ons'::regclass
       AND c.confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION 'issue #3281 gap E drift: event_rsvp_add_ons_add_on_id_fkey is not the ON DELETE CASCADE key 20281123123281 created';
  END IF;
END;
$guard$;

ALTER TABLE public.event_rsvp_add_ons
  DROP CONSTRAINT event_rsvp_add_ons_add_on_id_fkey;
ALTER TABLE public.event_rsvp_add_ons
  ADD CONSTRAINT event_rsvp_add_ons_add_on_id_fkey
  FOREIGN KEY (add_on_id) REFERENCES public.ticket_add_ons(id) ON DELETE NO ACTION;

COMMENT ON CONSTRAINT event_rsvp_add_ons_add_on_id_fkey ON public.event_rsvp_add_ons IS
  'issue #3281: a picked add-on cannot be deleted out from under its guests; it stops selling instead (is_active = false) and the picks stay.';

COMMIT;
