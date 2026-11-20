-- #4420 decision 1 (approved by Seth 19 Nov; #4508 confirmed it does not
-- redefine this function): new brand Guest rooms start in Broadcast
-- (announcements only). Re-creates issue_4459_ensure_brand_guest_chat from its
-- latest writer (20280805004459_issue_4459_brand_guest_chat.sql), body copied
-- exactly; the ONLY change is the initial is_broadcast_only for a newly
-- inserted row (false -> true). The ON CONFLICT branch does not set
-- is_broadcast_only, so existing rooms keep their setting. No backfill.
-- Same signature, SECURITY DEFINER, search_path and grants (re-stated below);
-- the self-check fails the migration if any of them differ.
-- issue_4459_brand_guest_eligible and the membership triggers are untouched.
--
-- INVARIANT issue-4420-guest-room-starts-broadcast: a brand_guests room created
-- by issue_4459_ensure_brand_guest_chat starts with is_broadcast_only = true;
-- an existing room's is_broadcast_only is never changed by ensure.
-- Static SQL, no data change.

CREATE OR REPLACE FUNCTION public.issue_4459_ensure_brand_guest_chat(p_brand_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_brand public.brands%ROWTYPE;
  v_conversation_id uuid;
BEGIN
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  INSERT INTO public.conversations(
    type, linked_entity_type, brand_id, name, created_by, is_enabled, is_broadcast_only
  ) VALUES (
    'group', 'brand_guests', v_brand.id,
    COALESCE(NULLIF(btrim(v_brand.name), ''), 'Guests'),
    NULL, v_brand.deleted_at IS NULL, true
  )
  ON CONFLICT (brand_id) WHERE linked_entity_type = 'brand_guests'
  DO UPDATE SET
    name = EXCLUDED.name,
    is_enabled = EXCLUDED.is_enabled,
    updated_at = now()
  WHERE public.conversations.name IS DISTINCT FROM EXCLUDED.name
     OR public.conversations.is_enabled IS DISTINCT FROM EXCLUDED.is_enabled
  RETURNING id INTO v_conversation_id;

  IF v_conversation_id IS NULL THEN
    SELECT id INTO v_conversation_id FROM public.conversations
     WHERE brand_id = p_brand_id AND linked_entity_type = 'brand_guests';
  END IF;

  INSERT INTO public.conversation_participants(conversation_id, user_id)
  SELECT v_conversation_id, m.user_id
    FROM public.brand_team_members m
   WHERE m.brand_id = p_brand_id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
   ORDER BY m.user_id
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN v_conversation_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4459_ensure_brand_guest_chat(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4459_ensure_brand_guest_chat(uuid) TO service_role;

DO $self_check$
DECLARE r record;
BEGIN
  SELECT p.prosecdef, p.proconfig, p.prosrc, pg_catalog.pg_get_function_result(p.oid) AS result, p.prolang
    INTO r FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.issue_4459_ensure_brand_guest_chat(uuid)'::regprocedure;
  IF NOT r.prosecdef THEN
    RAISE EXCEPTION 'issue 4420 self-check: ensure_brand_guest_chat lost SECURITY DEFINER';
  END IF;
  IF NOT (r.proconfig @> ARRAY['search_path=public, pg_temp']) OR array_length(r.proconfig, 1) <> 1 THEN
    RAISE EXCEPTION 'issue 4420 self-check: ensure_brand_guest_chat search_path changed: %', r.proconfig;
  END IF;
  IF r.result <> 'uuid' THEN
    RAISE EXCEPTION 'issue 4420 self-check: ensure_brand_guest_chat return type changed';
  END IF;
  IF has_function_privilege('anon', 'public.issue_4459_ensure_brand_guest_chat(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_4459_ensure_brand_guest_chat(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.issue_4459_ensure_brand_guest_chat(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue 4420 self-check: ensure_brand_guest_chat grants changed';
  END IF;
  IF r.prosrc NOT LIKE '%NULL, v_brand.deleted_at IS NULL, true%'
     OR r.prosrc LIKE '%is_broadcast_only = %'
     OR r.prosrc NOT LIKE '%ON CONFLICT (brand_id) WHERE linked_entity_type = ''brand_guests''%DO UPDATE SET%name = EXCLUDED.name,%is_enabled = EXCLUDED.is_enabled,%' THEN
    RAISE EXCEPTION 'issue 4420 self-check: ensure_brand_guest_chat body is not the latest writer with only the Broadcast start changed';
  END IF;
END
$self_check$;
