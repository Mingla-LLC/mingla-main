-- Issue #3697 v1.4 — expose the canonical Host Ads capability matrix to Ari.
--
-- `ad_can_host_action` remains service-role-only because provider and control
-- plane functions must be able to check an explicit actor. Ari runs with the
-- caller JWT, so this narrow wrapper binds the actor to auth.uid() and never
-- accepts a user id from the client.
--
-- Do NOT auto-apply. Release only through the reviewed governed migration lane.

BEGIN;

CREATE OR REPLACE FUNCTION public.ad_can_host_action_for_caller(
  p_brand_id uuid,
  p_action text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND public.ad_can_host_action(p_brand_id, auth.uid(), p_action);
$function$;

REVOKE ALL ON FUNCTION public.ad_can_host_action_for_caller(uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ad_can_host_action_for_caller(uuid,text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.ad_can_host_action_for_caller(uuid,text) IS
  'Issue #3697 v1.4: caller-bound Ari/Host adapter for the independent Host Ads read, plan, fund, launch, pause and end capability matrix.';

COMMIT;
