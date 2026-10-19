-- #3720 Admin -> Community & Support -> Team failed with
-- `column reference "user_id" is ambiguous`.
--
-- issue_3720_admin_team_roster() is a plpgsql RETURNS TABLE function whose
-- first output column is `user_id`. Output columns are plpgsql variables, so
-- the unqualified `SELECT user_id FROM public.community_staff` and
-- `SELECT user_id FROM public.support_staff` branches of the `people` CTE
-- collided with that variable and every call raised 42702.
--
-- Behind that error sat a second one: auth.users.email is varchar(255) while
-- the declared output column is text, so RETURN QUERY would then raise 42804
-- `structure of query does not match function result type`. The email is now
-- cast to text.
--
-- This replaces the function with table-qualified column references. The
-- signature, volatility, SECURITY DEFINER, search_path, is_admin_user() guard,
-- result shape and grants are unchanged.
--
-- The other plpgsql RETURNS TABLE functions added by the Wave 8 migrations
-- (20271108063720, 20271108073720, 20271108083720, 20271110013720) were
-- checked: issue_3720_community_submit_post, issue_3720_admin_list_posts,
-- issue_3720_admin_moderation_workspace,
-- issue_3720_admin_announcement_deliveries and
-- issue_3720_admin_list_roadmap_cards qualify every column reference that
-- shares a name with an output column, so they need no change.
--
-- MINGLA-INVARIANT: I-3720-ADMIN-TEAM-ROSTER-LOADS | issue #3720 | The Admin Team roster RPC returns rows for an admin when Community and Support staff exist; every column reference that shares a name with an output column is table-qualified. Enforced by supabase/migrations/__tests__/issue_3720_team_roster.implementor.pg17.test.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_3720_admin_team_roster()
RETURNS TABLE(
  user_id uuid,display_name text,email text,community_role text,support_role text,
  available boolean,last_active timestamptz,enabled boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  WITH people AS (
    SELECT u0.id FROM auth.users u0 JOIN public.admin_users a0 ON lower(a0.email)=lower(u0.email) WHERE a0.status='active'
    UNION SELECT cs0.user_id FROM public.community_staff cs0 WHERE cs0.enabled
    UNION SELECT ss0.user_id FROM public.support_staff ss0 WHERE ss0.enabled
  )
  SELECT u.id,
    COALESCE(NULLIF(btrim(p.display_name),''),NULLIF(btrim(cs.display_name),''),NULLIF(btrim(ss.display_name),''),split_part(u.email,'@',1)),
    u.email::text,
    CASE WHEN a.status='active' THEN 'admin' ELSE cs.role END,
    ss.role,COALESCE(ss.available,false),GREATEST(u.last_sign_in_at,cs.updated_at,ss.updated_at),
    COALESCE(cs.enabled,ss.enabled,a.status='active',false)
  FROM people x JOIN auth.users u ON u.id=x.id
  LEFT JOIN public.profiles p ON p.id=u.id
  LEFT JOIN public.admin_users a ON lower(a.email)=lower(u.email)
  LEFT JOIN public.community_staff cs ON cs.user_id=u.id
  LEFT JOIN public.support_staff ss ON ss.user_id=u.id
  ORDER BY lower(COALESCE(NULLIF(btrim(p.display_name),''),u.email));
END;
$$;
REVOKE ALL ON FUNCTION public.issue_3720_admin_team_roster() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_3720_admin_team_roster() TO authenticated;

COMMIT;
