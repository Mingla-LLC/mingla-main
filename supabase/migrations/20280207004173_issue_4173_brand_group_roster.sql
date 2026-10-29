-- #4173 — Access-gated Brand-group roster for the Host people sheet/rail.
-- INVARIANT: {"id":"I-4173-BRAND-GROUP-ROSTER-PRIVACY","rule":"Brand-group roster names, emails and roles are returned only to an authenticated caller who can access that exact Brand-group conversation, and only for active accepted teammates."}

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_4173_list_brand_group_members(
  p_conversation_id uuid
) RETURNS TABLE(
  user_id uuid,
  display_name text,
  email text,
  role text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_brand_id uuid;
BEGIN
  IF v_actor IS NULL
     OR NOT public.issue_3720_brand_group_can_access(p_conversation_id, v_actor) THEN
    RAISE EXCEPTION 'conversation_unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT conversation.brand_id INTO STRICT v_brand_id
  FROM public.conversations conversation
  WHERE conversation.id = p_conversation_id
    AND conversation.linked_entity_type = 'brand'
    AND conversation.is_enabled IS TRUE;

  RETURN QUERY
  SELECT roster.user_id, roster.display_name, roster.email, roster.role
  FROM (
    SELECT
      member.user_id,
      COALESCE(
        NULLIF(btrim(profile.display_name), ''),
        NULLIF(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
        NULLIF(btrim(profile.username), ''),
        NULLIF(btrim(identity.raw_user_meta_data->>'full_name'), ''),
        NULLIF(btrim(identity.raw_user_meta_data->>'name'), ''),
        split_part(identity.email, '@', 1),
        'Brand teammate'
      )::text AS display_name,
      identity.email::text AS email,
      member.role::text AS role,
      CASE member.role
        WHEN 'brand_owner' THEN 0
        WHEN 'brand_admin' THEN 1
        WHEN 'event_manager' THEN 2
        WHEN 'finance_manager' THEN 3
        WHEN 'marketing_manager' THEN 4
        ELSE 5
      END AS role_order
    FROM public.brand_team_members member
    JOIN auth.users identity ON identity.id = member.user_id
    LEFT JOIN public.profiles profile ON profile.id = member.user_id
    WHERE member.brand_id = v_brand_id
      AND member.accepted_at IS NOT NULL
      AND member.removed_at IS NULL
  ) roster
  ORDER BY roster.role_order, lower(roster.display_name), roster.user_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4173_list_brand_group_members(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4173_list_brand_group_members(uuid)
  TO authenticated, service_role;

COMMIT;
