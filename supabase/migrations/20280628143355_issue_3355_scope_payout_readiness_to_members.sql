-- Issue #3355 rework 6: scope the payout readiness check to brand members.
--
-- public.pg_brand_can_payout(uuid) is the canonical payout readiness
-- predicate. Its internal callers are SECURITY DEFINER functions owned by
-- postgres (the two trip instalment triggers and brand_readiness_internal),
-- so they keep running it after this migration. Signed-in callers reach the
-- answer through the new public.pg_brand_can_payout_for_caller(uuid), which
-- answers only for members of the brand (the owner or an accepted, not
-- removed team member of any role) and for the service role; anyone else
-- gets SQLSTATE 42501. The predicate's body is not changed.
--
-- Forward-only. Static SQL (no dynamic EXECUTE).

REVOKE ALL ON FUNCTION public.pg_brand_can_payout(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_brand_can_payout(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.pg_brand_can_payout_for_caller(p_brand_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_brand_id IS NULL THEN
    RAISE EXCEPTION 'brand_access_denied' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND COALESCE(public.biz_brand_effective_rank(p_brand_id, auth.uid()), 0) <= 0 THEN
    RAISE EXCEPTION 'brand_access_denied' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(public.pg_brand_can_payout(p_brand_id), false);
END
$function$;

COMMENT ON FUNCTION public.pg_brand_can_payout_for_caller(uuid) IS
  'Issue #3355: payout readiness (public.pg_brand_can_payout) for members of the brand and the service role; 42501 for anyone else.';

REVOKE ALL ON FUNCTION public.pg_brand_can_payout_for_caller(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pg_brand_can_payout_for_caller(uuid)
  TO authenticated, service_role;
