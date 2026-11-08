-- Issue #4270 (Wave 7) — Admin › Community › Brand groups, the staff inbox.
--
--   1. issue_4270_brand_group_inbox: one row per active Brand group with the
--      facts the staff inbox needs and the group list cannot give:
--      waiting_since (the first brand-side message after the last Mingla
--      Support reply; NULL when nobody waits), last_staff_reply_at, and, for
--      staff with Hosts and Creators access only, the brand's host card
--      (name, stage, ICP, region, next action, owners, "mine") with the next
--      plan item and how many plan items fall between today and Sunday.
--      Plan lines (system), enquiry cards and lines without a sender never
--      make a group wait. p_with_plan = false skips the plan reads, for the
--      light refresh after a realtime message.
--   2. issue_4270_brand_group_people: the brand team of a Brand group by
--      display name and role, never by address, for the People tab.
--
-- Builds on #4304 (20280426004304: list columns, reactions policies,
-- issue_4304_list_brand_group_read_state); the self-check refuses to apply
-- without it.
--
-- Static SQL only (no EXECUTE of built strings). Reads only: no write, so no
-- conflict path; never raise 40001 (PT409 is the write-conflict code and is
-- not used here). Release through the governed migration lane, after
-- 20280426004304 (#4304) and 20280427024270. Do not auto-apply.
--
-- INVARIANT: {"id":"I-4270-W7-INBOX-STAFF-ONLY","rule":"issue_4270_brand_group_inbox answers only Mingla Support or admins; host card, owner and plan facts only to staff with Hosts and Creators access."}
-- INVARIANT: {"id":"I-4270-W7-PEOPLE-NO-EMAIL","rule":"The staff Brand group people list names teammates by display name and role, never by email."}

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The staff inbox facts.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4270_brand_group_inbox(p_today date DEFAULT NULL, p_with_plan boolean DEFAULT true)
RETURNS TABLE(conversation_id uuid, waiting_since timestamptz, last_staff_reply_at timestamptz, host jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_crm boolean;
  v_me text;
  v_today date;
  v_sunday date;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_support_staff(auth.uid()) OR public.is_admin_user()) THEN
    RAISE EXCEPTION 'forbidden: Brand groups here are for Mingla Support.' USING ERRCODE = '42501';
  END IF;
  v_crm := COALESCE(public.admin_team_can('crm'), false);
  v_today := public.ops_today(p_today);
  v_sunday := public.ops_monday(v_today) + 6;
  SELECT lower(btrim(u.email)) INTO v_me FROM auth.users u WHERE u.id = v_uid;

  RETURN QUERY
  SELECT c.id,
    waiting.since,
    staff.last_reply_at,
    CASE WHEN rec.id IS NULL THEN NULL ELSE jsonb_build_object(
      'record_id', rec.id,
      'name', rec.name,
      'stage', rec.stage,
      'icp', rec.icp,
      'region_id', rec.region_id,
      'next_action', rec.next_action,
      'due_on', rec.due_on,
      'owners', COALESCE((SELECT jsonb_agg(jsonb_build_object('email', o.owner_email, 'name', public.ops_name(o.owner_email))
                                           ORDER BY o.added_at, o.owner_email)
                            FROM public.crm_record_owners o WHERE o.record_id = rec.id), '[]'::jsonb),
      'mine', EXISTS (SELECT 1 FROM public.crm_record_owners o
                       WHERE o.record_id = rec.id AND v_me IS NOT NULL AND lower(btrim(o.owner_email)) = v_me),
      'plan', CASE WHEN plan.items IS NULL THEN NULL ELSE jsonb_build_object(
        'next', (SELECT jsonb_build_object('kind', i.j->>'kind', 'id', i.j->'id', 'title', i.j->>'title', 'on', i.j->>'on',
                                           'state', i.j->>'state', 'state_words', i.j->>'state_words')
                   FROM jsonb_array_elements(plan.items) WITH ORDINALITY AS i(j, n)
                  WHERE (i.j->>'on')::date >= v_today
                  ORDER BY i.n LIMIT 1),
        'this_week', (SELECT count(*) FROM jsonb_array_elements(plan.items) AS i(j)
                       WHERE (i.j->>'on')::date BETWEEN v_today AND v_sunday)) END) END
  FROM public.conversations c
  JOIN public.brands b ON b.id = c.brand_id AND b.deleted_at IS NULL
  -- The last reply from Mingla Support (p_actor_mode = 'support' sets the
  -- snapshot; a staff member posting as a brand teammate does not).
  LEFT JOIN LATERAL (
    SELECT max(m.created_at) AS last_reply_at
      FROM public.messages m
     WHERE m.conversation_id = c.id AND m.deleted_at IS NULL AND m.sender_role_snapshot = 'Mingla Support'
  ) staff ON true
  -- The first brand-side message after it: a person wrote it, it is not a
  -- quiet plan or system line and not an enquiry card.
  LEFT JOIN LATERAL (
    SELECT min(m.created_at) AS since
      FROM public.messages m
     WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
       AND m.sender_id IS NOT NULL
       AND m.sender_role_snapshot IS DISTINCT FROM 'Mingla Support'
       AND m.message_type::text NOT IN ('system', 'brand_enquiry_card')
       AND m.created_at > COALESCE(staff.last_reply_at, '-infinity'::timestamptz)
  ) waiting ON true
  -- The brand's first host card (the ops_brand_host_record rule), only for
  -- staff with Hosts and Creators access.
  LEFT JOIN LATERAL (
    SELECT r.id, r.name, r.stage, r.icp, r.region_id, r.next_action, r.due_on
      FROM public.crm_records r
     WHERE v_crm AND r.pipeline = 'hosts' AND r.deleted_at IS NULL AND r.brand_id = b.id
     ORDER BY r.created_at, r.id LIMIT 1
  ) rec ON true
  LEFT JOIN LATERAL (
    SELECT CASE WHEN p_with_plan IS NOT FALSE AND rec.id IS NOT NULL
                THEN public.ops_brand_plan(rec.id, v_today, v_today + 27, v_today)->'items' END AS items
  ) plan ON true
  WHERE c.linked_entity_type = 'brand' AND c.is_enabled IS TRUE
  ORDER BY c.last_message_at DESC NULLS LAST, lower(b.name), b.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4270_brand_group_inbox(date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4270_brand_group_inbox(date, boolean) TO authenticated, service_role;
COMMENT ON FUNCTION public.issue_4270_brand_group_inbox(date, boolean) IS
  'Issue #4270 W7. The staff Brand group inbox: who waits on Mingla Support and since when, and (Hosts and Creators access only) the brand''s host card, owners and plan. Mingla Support and admins only.';

-- ---------------------------------------------------------------------------
-- 2. The brand team of a Brand group, by name and role.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4270_brand_group_people(p_conversation_id uuid)
RETURNS TABLE(user_id uuid, display_name text, role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL
     OR NOT (public.is_support_staff(auth.uid()) OR public.is_admin_user())
     OR NOT public.issue_3720_brand_group_can_access(p_conversation_id, auth.uid()) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT m.user_id,
    COALESCE(CASE WHEN position('@' IN COALESCE(p.display_name, '')) = 0 THEN NULLIF(btrim(p.display_name), '') END,
             CASE WHEN position('@' IN concat_ws(' ', p.first_name, p.last_name)) = 0 THEN NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '') END,
             'A teammate')::text,
    m.role::text
  FROM public.conversations c
  JOIN public.brand_team_members m
    ON m.brand_id = c.brand_id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE c.id = p_conversation_id AND c.linked_entity_type = 'brand'
  ORDER BY array_position(ARRAY['brand_owner','brand_admin','event_manager','finance_manager','marketing_manager','scanner','venue_staff'], m.role::text),
    m.accepted_at, m.user_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4270_brand_group_people(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4270_brand_group_people(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.issue_4270_brand_group_people(uuid) IS
  'Issue #4270 W7. The brand team of a Brand group by display name and role (never an address), for Mingla Support and admins who can open the group.';

-- ---------------------------------------------------------------------------
-- Self-check.
-- ---------------------------------------------------------------------------
DO $check4270w7$
DECLARE v_inbox text; v_people text;
BEGIN
  IF to_regprocedure('public.issue_4304_list_brand_group_read_state(uuid)') IS NULL THEN
    RAISE EXCEPTION 'issue 4270 wave 7 self-check: apply #4304 (20280426004304) first';
  END IF;
  IF to_regprocedure('public.issue_4270_brand_group_inbox(date,boolean)') IS NULL
     OR to_regprocedure('public.issue_4270_brand_group_people(uuid)') IS NULL THEN
    RAISE EXCEPTION 'issue 4270 wave 7 self-check: a function is missing';
  END IF;
  IF NOT (SELECT bool_and(p.prosecdef) FROM pg_catalog.pg_proc p
           WHERE p.oid IN ('public.issue_4270_brand_group_inbox(date,boolean)'::regprocedure,
                           'public.issue_4270_brand_group_people(uuid)'::regprocedure)) THEN
    RAISE EXCEPTION 'issue 4270 wave 7 self-check: both functions must be SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.issue_4270_brand_group_inbox(date,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.issue_4270_brand_group_people(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.issue_4270_brand_group_inbox(date,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.issue_4270_brand_group_people(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue 4270 wave 7 self-check: grants are wrong';
  END IF;
  v_inbox := pg_catalog.pg_get_functiondef('public.issue_4270_brand_group_inbox(date,boolean)'::regprocedure);
  v_people := pg_catalog.pg_get_functiondef('public.issue_4270_brand_group_people(uuid)'::regprocedure);
  IF v_inbox NOT LIKE '%is_support_staff%' OR v_inbox NOT LIKE '%admin_team_can(''crm'')%' OR v_inbox NOT LIKE '%''Mingla Support''%' THEN
    RAISE EXCEPTION 'issue 4270 wave 7 self-check: the inbox lost its gates';
  END IF;
  IF v_people NOT LIKE '%issue_3720_brand_group_can_access%' OR v_people LIKE '%email%' THEN
    RAISE EXCEPTION 'issue 4270 wave 7 self-check: the people list lost its gate or reads an address';
  END IF;
END;
$check4270w7$;

COMMIT;
