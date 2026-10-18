-- toward #3697: one currency-safe, server-derived Admin Ads operations view.
-- This is evidence, not a claim that an external scheduler is configured.

BEGIN;

CREATE OR REPLACE FUNCTION public.ad_admin_operations_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_campaigns jsonb;
  v_queues jsonb;
  v_spend jsonb;
  v_results jsonb;
  v_connections jsonb;
  v_delivery jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'total', count(*),
    'live', count(*) FILTER (WHERE c.status = 'ACTIVE'),
    'paused', count(*) FILTER (WHERE c.status = 'PAUSED'),
    'ended', count(*) FILTER (WHERE c.status IN ('ARCHIVED', 'DELETED')),
    'needs_attention', count(*) FILTER (WHERE
      c.currency_status IS DISTINCT FROM 'aligned'
      OR upper(coalesce(c.delivery_status, '')) IN (
        'ERROR', 'FAILED', 'REJECTED', 'DISAPPROVED', 'WITH_ISSUES',
        'ACCOUNT_DISABLED', 'PENDING_BILLING_INFO'
      )
      OR (c.status = 'ACTIVE' AND (
        c.status_synced_at IS NULL OR c.status_synced_at < now() - interval '2 hours'
      ))
    )
  )
  INTO v_campaigns
  FROM public.ad_campaigns c;

  SELECT jsonb_build_object(
    'staff_review', count(*) FILTER (WHERE p.state = 'staff_review_required'),
    'mingla_recovery', count(*) FILTER (WHERE
      p.owner_kind = 'mingla' AND p.state IN (
        'ready_for_funding', 'funded_held', 'creating_paused_objects',
        'creation_failed_retryable', 'creation_failed_terminal'
      )
    ),
    'settlement_attention', (
      SELECT count(*) FROM public.ad_campaign_settlements s
      WHERE s.state = 'attention_required'
    )
  )
  INTO v_queues
  FROM public.ad_plans p;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'currency', rollup.currency,
      'spend_cents', rollup.spend_cents,
      'impressions', rollup.impressions,
      'clicks', rollup.clicks
    ) ORDER BY rollup.currency
  ), '[]'::jsonb)
  INTO v_spend
  FROM (
    SELECT upper(s.currency) AS currency,
      sum(s.spend_cents)::bigint AS spend_cents,
      sum(s.impressions)::bigint AS impressions,
      sum(s.clicks)::bigint AS clicks
    FROM public.ad_spend_daily s
    WHERE s.currency ~ '^[A-Za-z]{3}$'
    GROUP BY upper(s.currency)
  ) rollup;

  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM public.ad_conversions),
    'by_type', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object('event_type', typed.event_type, 'count', typed.total)
        ORDER BY typed.event_type
      )
      FROM (
        SELECT c.event_type, count(*)::bigint AS total
        FROM public.ad_conversions c
        GROUP BY c.event_type
      ) typed
    ), '[]'::jsonb),
    'value_by_currency', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object('currency', valued.currency, 'value_cents', valued.value_cents)
        ORDER BY valued.currency
      )
      FROM (
        SELECT upper(c.currency) AS currency,
          sum(c.value_cents)::bigint AS value_cents
        FROM public.ad_conversions c
        WHERE c.value_cents IS NOT NULL
          AND c.currency ~ '^[A-Za-z]{3}$'
        GROUP BY upper(c.currency)
      ) valued
    ), '[]'::jsonb)
  )
  INTO v_results;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'platform', c.platform,
      'lane', c.lane,
      'display_name', c.display_name,
      'connected', c.connected,
      'status', c.status,
      'currency', c.currency,
      'account_status', c.account_status,
      'token_last_verified_at', c.token_last_verified_at,
      'verification_state', CASE
        WHEN c.connected IS NOT TRUE OR c.status <> 'connected' THEN 'needs_attention'
        WHEN c.token_last_verified_at IS NULL THEN 'verification_due'
        WHEN c.token_last_verified_at < now() - interval '6 hours' THEN 'verification_due'
        ELSE 'verified'
      END
    ) ORDER BY c.platform, c.lane
  ), '[]'::jsonb)
  INTO v_connections
  FROM public.ad_connections c
  WHERE c.lane = 'consumer';

  WITH active AS (
    SELECT c.id, c.status_synced_at,
      (SELECT max(s.synced_at) FROM public.ad_spend_daily s WHERE s.campaign_id = c.id)
        AS latest_spend_synced_at
    FROM public.ad_campaigns c
    WHERE c.status = 'ACTIVE'
  ), evidence AS (
    SELECT count(*)::bigint AS active_campaigns,
      count(*) FILTER (WHERE latest_spend_synced_at IS NULL)::bigint AS missing_spend_campaigns,
      count(*) FILTER (WHERE
        status_synced_at IS NULL OR status_synced_at < now() - interval '2 hours'
        OR latest_spend_synced_at IS NULL
        OR latest_spend_synced_at < now() - interval '2 hours'
      )::bigint AS stale_campaigns,
      max(status_synced_at) AS latest_status_synced_at,
      max(latest_spend_synced_at) AS latest_spend_synced_at
    FROM active
  )
  SELECT jsonb_build_object(
    'active_campaigns', e.active_campaigns,
    'missing_spend_campaigns', e.missing_spend_campaigns,
    'stale_campaigns', e.stale_campaigns,
    'latest_status_synced_at', e.latest_status_synced_at,
    'latest_spend_synced_at', e.latest_spend_synced_at,
    'evidence_state', CASE
      WHEN e.active_campaigns = 0 THEN 'not_required'
      WHEN e.missing_spend_campaigns > 0 THEN 'missing'
      WHEN e.stale_campaigns > 0 THEN 'stale'
      ELSE 'current'
    END
  )
  INTO v_delivery
  FROM evidence e;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'campaigns', v_campaigns,
    'queues', v_queues,
    'spend_by_currency', v_spend,
    'results', v_results,
    'connections', v_connections,
    'delivery_evidence', v_delivery,
    'scheduler_configuration_proven', false
  );
END;
$function$;

COMMENT ON FUNCTION public.ad_admin_operations_overview() IS
  'Issue #3697: Admin-only currency-separated Ads operations summary. Delivery health is inferred from recorded status/spend observations and never claims that scheduler configuration was inspected.';

REVOKE ALL ON FUNCTION public.ad_admin_operations_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ad_admin_operations_overview() TO authenticated, service_role;

COMMIT;
