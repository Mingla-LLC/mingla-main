BEGIN;
SET LOCAL lock_timeout = '10s';

-- #2829 R1 P12 — one quiet weekly nudge for an unfinished website plan.
-- The plan is already the source of truth for its next unfinished part; this
-- sweep only fans that fact out to owners and brand admins. It never advances
-- a plan, creates a site, or publishes anything.
INSERT INTO public.notification_categories (
  key, section, is_transactional, urgency, default_channels, reach_mode, active
) VALUES (
  'business.site_plan_reminder', 'business', true, 'normal',
  ARRAY['inapp', 'push']::text[], 'reach_once', true
)
ON CONFLICT (key) DO NOTHING;

-- MINGLA-INVARIANT: I-PROPOSED-2829-14 | issue #2829 | An unfinished website plan may remind only the brand owner and active rank-50+ teammates, at most once per recipient per brand in any rolling seven-day window; the sweep never mutates the plan or site.
CREATE OR REPLACE FUNCTION public.brand_site_plan_reminder_sweep()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_inserted integer;
BEGIN
  WITH unfinished AS (
    SELECT
      plan.brand_id,
      brand.name AS brand_name,
      status.result->>'next_part' AS next_part
    FROM public.brand_site_plans plan
    JOIN public.brands brand
      ON brand.id = plan.brand_id
     AND brand.deleted_at IS NULL
    JOIN public.brand_site_entitlements entitlement
      ON entitlement.brand_id = plan.brand_id
     AND entitlement.status = 'granted'
    LEFT JOIN public.brand_sites site ON site.brand_id = plan.brand_id
    CROSS JOIN LATERAL (
      SELECT public.brand_site_plan_status_internal(plan.brand_id) AS result
    ) status
    WHERE plan.updated_at <= now() - interval '7 days'
      AND status.result->>'next_part' IS NOT NULL
      AND COALESCE(site.status, 'draft') <> 'suspended'
  ), recipients AS (
    SELECT DISTINCT unfinished.brand_id, unfinished.brand_name,
      unfinished.next_part, candidate.user_id
    FROM unfinished
    CROSS JOIN LATERAL (
      SELECT brand.account_id AS user_id
      FROM public.brands brand
      WHERE brand.id = unfinished.brand_id
      UNION
      SELECT member.user_id
      FROM public.brand_team_members member
      WHERE member.brand_id = unfinished.brand_id
        AND member.accepted_at IS NOT NULL
        AND member.removed_at IS NULL
    ) candidate
    WHERE candidate.user_id IS NOT NULL
      AND public.biz_brand_effective_rank(
        unfinished.brand_id, candidate.user_id
      ) >= 50
  )
  INSERT INTO public.notification_outbox(
    category_key, user_id, brand_id, payload, idempotency_key
  )
  SELECT
    'business.site_plan_reminder',
    recipient.user_id,
    recipient.brand_id,
    jsonb_build_object(
      'title', 'Finish your website',
      'body', COALESCE(NULLIF(btrim(recipient.brand_name), ''), 'Your brand') ||
        ': continue with Ari at ' ||
        CASE recipient.next_part
          WHEN 'offer' THEN 'what you will offer'
          WHEN 'brand' THEN 'your brand'
          WHEN 'look' THEN 'your look'
          WHEN 'story' THEN 'your story'
          WHEN 'approve' THEN 'review your plan'
          WHEN 'build' THEN 'create your draft'
          WHEN 'first_offering' THEN 'your first offering'
          WHEN 'publish' THEN 'publish'
          ELSE 'your website plan'
        END || '.',
      'brand_id', recipient.brand_id,
      'section', 'plan',
      'deep_link', 'mingla-business://brand/' || recipient.brand_id ||
        '/website/plan'
    ),
    'site-plan-reminder:' || recipient.brand_id || ':' || recipient.user_id ||
      ':' || to_char(now() AT TIME ZONE 'UTC', 'IYYY-IW')
  FROM recipients recipient
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.notification_outbox prior
    WHERE prior.category_key = 'business.site_plan_reminder'
      AND prior.brand_id = recipient.brand_id
      AND prior.user_id = recipient.user_id
      AND prior.created_at > now() - interval '7 days'
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_reminder_sweep()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_reminder_sweep()
  TO service_role;

DO $cron_replace$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'brand-site-plan-reminders'
  ) THEN
    PERFORM cron.unschedule('brand-site-plan-reminders');
  END IF;
END
$cron_replace$;

SELECT cron.schedule(
  'brand-site-plan-reminders',
  '37 14 * * *',
  $cron$SELECT public.brand_site_plan_reminder_sweep();$cron$
);

COMMIT;
