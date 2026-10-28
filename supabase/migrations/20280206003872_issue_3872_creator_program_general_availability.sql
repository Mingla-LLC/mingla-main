BEGIN;
SET LOCAL lock_timeout = '10s';

-- #3872 general availability: every current and future nondeleted brand may
-- use Discounts, Referrals and Creator gigs. An explicit dark row remains a
-- deliberate hold and is never promoted by this rollout.
--
-- The five global switches are intentionally not changed here. #4130 makes
-- admin_set_feature_flag the audited authority for flag changes; release
-- operations turn them on through Mingla Admin after this migration applies.
-- Mingla Locals is global plus city-scoped, so this migration never creates or
-- opens a city program, assigns seats, or creates a budget.
-- invariant: I-PROPOSED-3872-11 (DRAFT) — missing rollout state defaults to GA
-- for a nondeleted brand, pilots become GA, and an explicit dark row wins.

LOCK TABLE public.brands,
  public.program_brand_rollouts,
  public.feature_flags
IN SHARE ROW EXCLUSIVE MODE;

DO $prerequisites$
DECLARE
  v_flag_count integer;
BEGIN
  SELECT count(*) INTO v_flag_count
  FROM public.feature_flags
  WHERE flag_key IN (
    'discounts_enabled',
    'referrals_enabled',
    'creator_gigs_enabled',
    'creator_media_uploads_enabled',
    'mingla_locals_enabled'
  );

  IF v_flag_count <> 5 THEN
    RAISE EXCEPTION 'issue_3872_ga_missing_feature_flags:%', v_flag_count;
  END IF;
END;
$prerequisites$;

CREATE OR REPLACE FUNCTION public.issue_3872_discounts_on(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT flag.is_enabled
    FROM public.feature_flags flag
    WHERE flag.flag_key = 'discounts_enabled'
  ), false)
  AND EXISTS (
    SELECT 1 FROM public.brands brand
    WHERE brand.id = p_brand_id AND brand.deleted_at IS NULL
  )
  AND COALESCE((
    SELECT rollout.phase <> 'dark'
    FROM public.program_brand_rollouts rollout
    WHERE rollout.brand_id = p_brand_id AND rollout.program = 'discounts'
  ), true)
$function$;
REVOKE ALL ON FUNCTION public.issue_3872_discounts_on(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_discounts_on(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_referrals_on(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT flag.is_enabled
    FROM public.feature_flags flag
    WHERE flag.flag_key = 'referrals_enabled'
  ), false)
  AND EXISTS (
    SELECT 1 FROM public.brands brand
    WHERE brand.id = p_brand_id AND brand.deleted_at IS NULL
  )
  AND COALESCE((
    SELECT rollout.phase <> 'dark'
    FROM public.program_brand_rollouts rollout
    WHERE rollout.brand_id = p_brand_id AND rollout.program = 'referrals'
  ), true)
$function$;
REVOKE ALL ON FUNCTION public.issue_3872_referrals_on(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_referrals_on(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_3872_creator_gigs_on(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT flag.is_enabled
    FROM public.feature_flags flag
    WHERE flag.flag_key = 'creator_gigs_enabled'
  ), false)
  AND EXISTS (
    SELECT 1 FROM public.brands brand
    WHERE brand.id = p_brand_id AND brand.deleted_at IS NULL
  )
  AND COALESCE((
    SELECT rollout.phase <> 'dark'
    FROM public.program_brand_rollouts rollout
    WHERE rollout.brand_id = p_brand_id AND rollout.program = 'creator_gigs'
  ), true)
$function$;
REVOKE ALL ON FUNCTION public.issue_3872_creator_gigs_on(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3872_creator_gigs_on(uuid) TO service_role;

INSERT INTO public.program_brand_rollouts(brand_id, program, phase)
SELECT brand.id, program, 'ga'
FROM public.brands brand
CROSS JOIN unnest(ARRAY['discounts', 'referrals', 'creator_gigs']) AS program
WHERE brand.deleted_at IS NULL
ON CONFLICT (brand_id, program) DO UPDATE
SET phase = 'ga', updated_at = clock_timestamp()
WHERE public.program_brand_rollouts.phase = 'pilot';

COMMIT;
