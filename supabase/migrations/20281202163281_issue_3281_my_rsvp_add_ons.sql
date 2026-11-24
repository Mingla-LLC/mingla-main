-- issue #3281 S6 (checkpoint 16) — the add-ons on a guest's own RSVP, for their
-- pass (Explorer RsvpPassSheet: "Add-ons · Reserved seat × 1").
--
-- One new read, nothing re-emitted, no table or data change.
-- issue_3281_my_rsvp_add_ons(p_rsvp_id) answers only the signed-in owner of the
-- RSVP (event_rsvps.user_id = auth.uid()), and only while it is going and not
-- denied, on an event that is neither deleted nor cancelled: the same owner rule
-- fetch_user_rsvp_party_passes uses for the primary pass. Anyone else gets '[]'.
-- Items are the door line's shape ({id, name, quantity}, issue_3281_rsvp_door_add_ons).
--
-- SECURITY DEFINER with a pinned search_path; EXECUTE for authenticated only.
BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE FUNCTION public.issue_3281_my_rsvp_add_ons(p_rsvp_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'quantity', ra.quantity)
                            ORDER BY a.sort_order, a.id), '[]'::jsonb)
    FROM public.event_rsvp_add_ons ra
    JOIN public.event_rsvps v ON v.id = ra.rsvp_id
    JOIN public.events e ON e.id = v.event_id
    JOIN public.ticket_add_ons a ON a.id = ra.add_on_id
   WHERE ra.rsvp_id = p_rsvp_id
     AND auth.uid() IS NOT NULL
     AND v.user_id = auth.uid()
     AND v.rsvp_status = 'going'
     AND v.approval_status <> 'denied'
     AND e.deleted_at IS NULL
     AND e.status <> 'cancelled';
$fn$;

REVOKE ALL ON FUNCTION public.issue_3281_my_rsvp_add_ons(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.issue_3281_my_rsvp_add_ons(uuid) TO authenticated;

COMMENT ON FUNCTION public.issue_3281_my_rsvp_add_ons(uuid) IS
  'issue #3281 S6: the add-ons on the signed-in owner''s own going RSVP ([{id,name,quantity}]); [] for anyone else.';

NOTIFY pgrst, 'reload schema';

COMMIT;
