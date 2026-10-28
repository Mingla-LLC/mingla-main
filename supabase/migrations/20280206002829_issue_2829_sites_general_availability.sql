BEGIN;
SET LOCAL lock_timeout = '10s';

-- #2829 general availability: every current and future nondeleted brand may
-- create a Mingla-hosted site. Publishing and custom-domain cutover remain
-- separate owner actions. Existing entitlement rows are authoritative, so a
-- deliberate revoke is never overwritten by this rollout.
-- invariant: I-PROPOSED-2829-08 (DRAFT) — a missing entitlement defaults to
-- granted for a nondeleted brand; an existing granted or revoked row wins.

LOCK TABLE public.brands,
  public.brand_site_entitlements,
  public.brand_site_audit_log
IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.issue_2829_grant_default_site_entitlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.brand_site_entitlements(
    brand_id, status, source, granted_at, reason_code
  ) VALUES (
    NEW.id, 'granted', 'rule', clock_timestamp(), 'rollout'
  )
  ON CONFLICT (brand_id) DO NOTHING;

  IF FOUND THEN
    INSERT INTO public.brand_site_audit_log(
      site_id, brand_id, actor_kind, action, resource_kind, resource_id,
      metadata
    ) VALUES (
      NULL, NEW.id, 'system', 'entitlement.granted', 'entitlement',
      NEW.id::text,
      jsonb_build_object('reason_code', 'rollout', 'status', 'granted')
    );
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_2829_grant_default_site_entitlement()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_2829_default_site_entitlement ON public.brands;
CREATE TRIGGER issue_2829_default_site_entitlement
AFTER INSERT OR UPDATE OF deleted_at ON public.brands
FOR EACH ROW
WHEN (NEW.deleted_at IS NULL)
EXECUTE FUNCTION public.issue_2829_grant_default_site_entitlement();

WITH newly_granted AS (
  INSERT INTO public.brand_site_entitlements(
    brand_id, status, source, granted_at, reason_code
  )
  SELECT brand.id, 'granted', 'rule', clock_timestamp(), 'rollout'
  FROM public.brands brand
  WHERE brand.deleted_at IS NULL
  ON CONFLICT (brand_id) DO NOTHING
  RETURNING brand_id
)
INSERT INTO public.brand_site_audit_log(
  site_id, brand_id, actor_kind, action, resource_kind, resource_id, metadata
)
SELECT
  NULL,
  newly_granted.brand_id,
  'system',
  'entitlement.granted',
  'entitlement',
  newly_granted.brand_id::text,
  jsonb_build_object('reason_code', 'rollout', 'status', 'granted')
FROM newly_granted;

COMMIT;
