-- #4549 (Hosts are not getting push notifications on the Mingla Host app),
-- build step 1: per-device push health for the Host app (database).
--
-- Additive only. What this file adds:
--   1. public.host_push_devices: one row per (account, provider push record).
--      The Host app reports what it can see about its own push setup through
--      report_host_push_device(); the host-push-reconcile function writes what
--      the push provider says about the same record. RLS on, no client policy:
--      clients reach it only through the RPC.
--   2. public.host_push_reconcile_state: one row of reconciler bookkeeping
--      (last ops alert set and time, provider back-off). Service role only.
--   3. public.report_host_push_device(): the app's one write path. It upserts
--      the caller's own row only and answers {"action":"reregister"} once per
--      repair request the reconciler queued.
--   4. public.host_push_reconcile_candidates(): which accounts the reconciler
--      checks next (Host pushes in the last 48 hours, or a Host app report in
--      the last 7 days), oldest check first, at most 40.
--   5. issue_3720_complete_notification_channel(): body unchanged, plus a
--      completed push (`sent`) now sets notifications.push_sent / push_sent_at.
--      No backfill: older rows keep their value.
--   6. The every-30-minutes cron job that calls host-push-reconcile, declared
--      the way 20270421002218 declares sms-delivery-reconcile.
--
-- No existing row changes meaning. No existing migration is edited.

-- ---------------------------------------------------------------------------
-- 1. host_push_devices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.host_push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_subscription_id text NOT NULL
    CHECK (char_length(provider_subscription_id) BETWEEN 1 AND 128),
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  app_build text CHECK (app_build IS NULL OR char_length(app_build) <= 64),
  device_permission text
    CHECK (device_permission IN ('granted', 'denied', 'not_determined')),
  device_opted_in boolean,
  device_token_present boolean,
  device_linked boolean,
  last_reported_at timestamptz NOT NULL,
  last_report_reason text
    CHECK (last_report_reason IS NULL
      OR last_report_reason IN ('launch', 'sign_in', 'foreground')),
  provider_state text NOT NULL DEFAULT 'unknown' CHECK (provider_state IN (
    'unknown', 'subscribed', 'refused_token', 'refused_config',
    'permission_off', 'never_prompted', 'unsubscribed', 'missing'
  )),
  provider_status_code integer,
  provider_environment integer,
  provider_checked_at timestamptz,
  repair_state text NOT NULL DEFAULT 'none' CHECK (repair_state IN (
    'none', 'requested', 'provider_deleted', 'repaired', 'gave_up'
  )),
  repair_requests integer NOT NULL DEFAULT 0 CHECK (repair_requests BETWEEN 0 AND 3),
  repair_window_started_at timestamptz,
  provider_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT host_push_devices_user_subscription_key
    UNIQUE (user_id, provider_subscription_id)
);

CREATE INDEX IF NOT EXISTS host_push_devices_checked_idx
  ON public.host_push_devices (provider_checked_at NULLS FIRST);
CREATE INDEX IF NOT EXISTS host_push_devices_reported_idx
  ON public.host_push_devices (last_reported_at);

ALTER TABLE public.host_push_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.host_push_devices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.host_push_devices TO service_role;

COMMENT ON TABLE public.host_push_devices IS
  '#4549 Host app push health, one row per account and provider push record. '
  'Device fields come from report_host_push_device (the app); provider fields '
  'and the repair ladder come from host-push-reconcile. No client policy: '
  'clients write only through the RPC and never read it.';

-- ---------------------------------------------------------------------------
-- 2. host_push_reconcile_state (one row)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.host_push_reconcile_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_alert_fingerprint text,
  last_alert_at timestamptz,
  provider_backoff_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.host_push_reconcile_state (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.host_push_reconcile_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.host_push_reconcile_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.host_push_reconcile_state TO service_role;

COMMENT ON TABLE public.host_push_reconcile_state IS
  '#4549 host-push-reconcile bookkeeping: the last ops-alert set (a hash) and '
  'time, so one email goes out per 6 hours while nothing changes, and the '
  'provider back-off after a rate-limit answer. Service role only.';

-- ---------------------------------------------------------------------------
-- 3. report_host_push_device
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_host_push_device(
  p_subscription_id text,
  p_platform text,
  p_app_build text,
  p_permission text,
  p_opted_in boolean,
  p_token_present boolean,
  p_linked boolean,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.host_push_devices%ROWTYPE;
  v_action text := 'none';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'PT401';
  END IF;
  IF p_subscription_id IS NULL
     OR p_subscription_id !~ '^[0-9A-Za-z-]{1,128}$' THEN
    RAISE EXCEPTION 'invalid_subscription_id' USING ERRCODE = '22023';
  END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'invalid_platform' USING ERRCODE = '22023';
  END IF;
  IF p_permission IS NULL
     OR p_permission NOT IN ('granted', 'denied', 'not_determined') THEN
    RAISE EXCEPTION 'invalid_permission' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('launch', 'sign_in', 'foreground') THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;
  IF p_app_build IS NOT NULL AND char_length(p_app_build) > 64 THEN
    RAISE EXCEPTION 'invalid_app_build' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.host_push_devices AS d (
    user_id, provider_subscription_id, platform, app_build,
    device_permission, device_opted_in, device_token_present, device_linked,
    last_reported_at, last_report_reason
  ) VALUES (
    v_uid, p_subscription_id, p_platform, p_app_build,
    p_permission, p_opted_in, p_token_present, p_linked,
    now(), p_reason
  )
  ON CONFLICT ON CONSTRAINT host_push_devices_user_subscription_key DO UPDATE
  SET platform = EXCLUDED.platform,
      app_build = EXCLUDED.app_build,
      device_permission = EXCLUDED.device_permission,
      device_opted_in = EXCLUDED.device_opted_in,
      device_token_present = EXCLUDED.device_token_present,
      device_linked = EXCLUDED.device_linked,
      last_reported_at = EXCLUDED.last_reported_at,
      last_report_reason = EXCLUDED.last_report_reason,
      updated_at = now()
  RETURNING d.* INTO v_row;

  -- A queued repair is handed to the app exactly once: the request moves back
  -- to 'none' and is counted. The reconciler queues at most 3 per window, so a
  -- refused device is never asked forever.
  IF v_row.repair_state = 'requested' THEN
    UPDATE public.host_push_devices
       SET repair_state = 'none',
           repair_requests = LEAST(repair_requests + 1, 3),
           updated_at = now()
     WHERE id = v_row.id
       AND repair_state = 'requested';
    -- A concurrent report that already took the request gets 'none': the
    -- request is delivered at most once, and losing that race is not an error.
    IF FOUND THEN
      v_action := 'reregister';
    END IF;
  END IF;

  RETURN jsonb_build_object('action', v_action);
END;
$function$;

REVOKE ALL ON FUNCTION public.report_host_push_device(text, text, text, text, boolean, boolean, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_host_push_device(text, text, text, text, boolean, boolean, boolean, text)
  TO authenticated;

COMMENT ON FUNCTION public.report_host_push_device(text, text, text, text, boolean, boolean, boolean, text) IS
  '#4549 the Host app reports its own push setup for the signed-in account. '
  'Writes only the caller''s row; returns {"action":"reregister"} once per '
  'repair the reconciler queued, else {"action":"none"}.';

-- ---------------------------------------------------------------------------
-- 4. host_push_reconcile_candidates
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.host_push_reconcile_candidates(p_limit integer)
RETURNS TABLE (user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH active AS (
    SELECT n.user_id
      FROM public.notification_deliveries d
      JOIN public.notifications n ON n.id = d.notification_id
     WHERE d.channel = 'push'
       AND d.attempt_at > now() - interval '48 hours'
       AND (n.type LIKE 'business.%' OR n.type LIKE 'stripe.%' OR n.type LIKE 'admin.%')
    UNION
    SELECT h.user_id
      FROM public.host_push_devices h
     WHERE h.last_report_reason IS NOT NULL
       AND h.last_reported_at > now() - interval '7 days'
  )
  SELECT a.user_id
    FROM (SELECT DISTINCT active.user_id FROM active) a
    JOIN auth.users u ON u.id = a.user_id
    LEFT JOIN LATERAL (
      SELECT min(h2.provider_checked_at) AS checked_at,
             bool_or(h2.provider_checked_at IS NULL) AS has_unchecked
        FROM public.host_push_devices h2
       WHERE h2.user_id = a.user_id
    ) c ON true
   ORDER BY CASE WHEN c.checked_at IS NULL OR c.has_unchecked THEN 0 ELSE 1 END,
            c.checked_at ASC NULLS FIRST,
            a.user_id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 40);
$function$;

REVOKE ALL ON FUNCTION public.host_push_reconcile_candidates(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.host_push_reconcile_candidates(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. issue_3720_complete_notification_channel: body from
--    20271020003720_issue_3720_notification_reliability.sql unchanged, plus
--    push_sent on a completed push.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3720_complete_notification_channel(
  p_delivery_id uuid,
  p_status text,
  p_provider text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_failed_reason text DEFAULT NULL,
  p_segments integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
  v_channel text;
  v_notification_id uuid;
BEGIN
  IF p_delivery_id IS NULL OR p_status NOT IN (
    'queued', 'sent', 'delivered', 'undelivered', 'failed', 'suppressed', 'skipped'
  ) THEN
    RAISE EXCEPTION 'invalid_delivery_completion' USING ERRCODE = '22023';
  END IF;

  UPDATE public.notification_deliveries
  SET status = p_status,
      provider = COALESCE(p_provider, provider),
      provider_message_id = p_provider_message_id,
      failed_reason = p_failed_reason,
      segments = p_segments,
      delivered_at = CASE WHEN p_status = 'delivered' THEN now() ELSE delivered_at END,
      attempt_at = now()
  WHERE id = p_delivery_id
    AND status = 'queued'
  RETURNING channel, notification_id INTO v_channel, v_notification_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- #4549 S3: the current send path never set push_sent (only the legacy
  -- notify-dispatch did). A provider-accepted push now marks its notification.
  IF v_count = 1 AND v_channel = 'push' AND p_status = 'sent' THEN
    UPDATE public.notifications
       SET push_sent = true,
           push_sent_at = COALESCE(push_sent_at, now())
     WHERE id = v_notification_id;
  END IF;

  RETURN v_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_3720_complete_notification_channel(uuid, text, text, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3720_complete_notification_channel(uuid, text, text, text, text, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Schedule: every 30 minutes. Invocation copies
--    issue_2218_sms_delivery_reconcile exactly: net.http_post with the URL and
--    the service-role key read from the vault at execution time, so this file
--    holds no URL and no key. Re-running this file replaces the job, never
--    duplicates it.
-- ---------------------------------------------------------------------------
select cron.unschedule('issue_4549_host_push_reconcile')
 where exists (select 1 from cron.job
                where jobname = 'issue_4549_host_push_reconcile');

select cron.schedule(
  'issue_4549_host_push_reconcile',
  '*/30 * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
             where name = 'supabase_url' limit 1)
           || '/functions/v1/host-push-reconcile',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret
                                      from vault.decrypted_secrets
                                     where name = 'service_role_key' limit 1)),
    body := '{}'::jsonb);
  $cron$);
