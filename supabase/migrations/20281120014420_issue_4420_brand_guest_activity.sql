-- #4420 (decision 2, approved by Seth 19 Nov): the guest side's unread count
-- and last line for the Host app's one-row-per-brand Messages inbox and the
-- Team | Guests switcher.
--
-- A new, additive, read-only function (no existing issue_4459_* function is
-- redefined). SECURITY DEFINER with a pinned search_path; it only ever returns
-- the Guest chats of brands the caller is on the accepted team of (the same
-- rule as issue_4459_list_my_brand_guest_chats), so nobody else's counts or
-- messages leak.
--
-- Unread = messages in the Guest chat after the caller's own read marker
-- (conversation_participants.last_read_at, which the Host app moves when the
-- Guests side is open; falls back to joined_at), not deleted, not system
-- lines, not brand posts (the team's own posts as the brand) and not the
-- caller's own.
--
-- INVARIANT issue-4420-guest-activity-team-only: issue_4420_brand_guest_activity
-- returns rows only for brands where auth.uid() is an accepted, not removed
-- brand team member; it writes nothing.
-- Static SQL, no data change.

CREATE OR REPLACE FUNCTION public.issue_4420_brand_guest_activity()
RETURNS TABLE(conversation_id uuid, unread_count integer, last_message_preview text,
              last_message_from_brand boolean, last_message_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
  SELECT c.id,
    (SELECT count(*)::integer FROM public.messages m
      WHERE m.conversation_id = c.id
        AND m.deleted_at IS NULL
        AND m.message_type IS DISTINCT FROM 'system'
        AND m.sender_kind IS DISTINCT FROM 'brand'
        AND m.sender_id IS DISTINCT FROM auth.uid()
        AND m.created_at > COALESCE(me.last_read_at, me.joined_at, '-infinity'::timestamptz)),
    CASE
      WHEN last_msg.id IS NULL THEN NULL
      WHEN last_msg.message_type = 'image' AND btrim(COALESCE(last_msg.content, '')) = '' THEN 'Photo'
      WHEN last_msg.message_type = 'video' AND btrim(COALESCE(last_msg.content, '')) = '' THEN 'Video'
      ELSE left(regexp_replace(COALESCE(last_msg.content, ''), '\s+', ' ', 'g'), 140)
    END,
    COALESCE(last_msg.sender_kind = 'brand', false),
    last_msg.created_at
    FROM public.conversations c
    JOIN public.brands b ON b.id = c.brand_id AND b.deleted_at IS NULL
    LEFT JOIN public.conversation_participants me
      ON me.conversation_id = c.id AND me.user_id = auth.uid()
    LEFT JOIN LATERAL (
      SELECT m.id, m.content, m.sender_kind, m.message_type, m.created_at
        FROM public.messages m
       WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
         AND m.message_type IS DISTINCT FROM 'system'
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 1
    ) last_msg ON true
   WHERE c.linked_entity_type = 'brand_guests' AND c.is_enabled IS TRUE
     AND public.issue_4459_is_brand_team(c.brand_id, auth.uid());
$function$;

REVOKE ALL ON FUNCTION public.issue_4420_brand_guest_activity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4420_brand_guest_activity() TO authenticated;

DO $self_check$
DECLARE r record;
BEGIN
  SELECT p.prosecdef, p.proconfig, p.provolatile INTO r FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.issue_4420_brand_guest_activity()'::regprocedure;
  IF NOT r.prosecdef OR NOT (r.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']) OR r.provolatile <> 's' THEN
    RAISE EXCEPTION 'issue 4420 self-check: issue_4420_brand_guest_activity is not a pinned, stable definer read';
  END IF;
  IF has_function_privilege('anon', 'public.issue_4420_brand_guest_activity()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.issue_4420_brand_guest_activity()', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue 4420 self-check: issue_4420_brand_guest_activity has the wrong grants';
  END IF;
END
$self_check$;
