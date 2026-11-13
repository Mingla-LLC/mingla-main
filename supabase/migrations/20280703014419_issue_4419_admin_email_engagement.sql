-- #4419 Part B — what happened to an Admin email after it left us.
-- Invariant I-4419-ADMIN-EVENTS-LINKED-ONCE is declared in its test,
-- __tests__/issue_4419_admin_email_engagement.implementor.pg17.test.sql.
--
-- Resend already tells resend-webhook about every email (sent, delivered,
-- delivery delayed, bounced, marked as spam, opened, clicked) and
-- mkt_ingest_email_event files each event in marketing_email_events, but only
-- host marketing messages were ever matched. Admin deliveries store the same
-- provider id (admin_email_recipient_deliveries.provider_message_id), so this
-- links each event to its Admin delivery: on ingest, late (when the delivery
-- gets its provider id after the event arrived) and once for history.
--
-- Admin campaigns now send from campaigns.usemingla.com (Seth, 13 Nov), so
-- their events are flagged is_campaign_event by the #2714 ingest. An event
-- that belongs to an Admin delivery is not a host-campaign event: it is
-- un-flagged once linked, so the #2714 health check and the webhook's
-- "campaign_unmatched" retry never treat it as a lost host-campaign event.
-- Admin linking can never break host-marketing ingest: it runs inside its own
-- exception block.
--
-- No provider setting changes here. Open tracking already works on
-- campaigns.usemingla.com; click tracking is a Seth-owned switch, and Admin
-- shows "Click tracking is off" until a click event exists.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_email_delivery_events (
  svix_id text PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES public.admin_email_recipient_deliveries(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced',
    'email.complained', 'email.opened', 'email.clicked'
  )),
  occurred_at timestamptz NOT NULL,
  link_url text CHECK (link_url IS NULL OR octet_length(link_url) <= 2048),
  bounce_type text
);

COMMENT ON TABLE public.admin_email_delivery_events IS
  '#4419 provider events (from marketing_email_events) linked to Admin email deliveries. Append-only, one row per Svix event.';

CREATE INDEX IF NOT EXISTS issue_4419_admin_email_events_campaign
  ON public.admin_email_delivery_events (campaign_id, event_type);
CREATE INDEX IF NOT EXISTS issue_4419_admin_email_events_delivery
  ON public.admin_email_delivery_events (delivery_id);
CREATE INDEX IF NOT EXISTS issue_4419_admin_email_events_any_click
  ON public.admin_email_delivery_events (occurred_at)
  WHERE event_type = 'email.clicked';
CREATE INDEX IF NOT EXISTS issue_4419_admin_email_deliveries_provider_id
  ON public.admin_email_recipient_deliveries (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
-- Late linking looks events up by provider id; nothing indexed that before.
CREATE INDEX IF NOT EXISTS issue_4419_email_events_provider_id
  ON public.marketing_email_events (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

ALTER TABLE public.admin_email_delivery_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_read_email_delivery_events ON public.admin_email_delivery_events;
CREATE POLICY admin_read_email_delivery_events
  ON public.admin_email_delivery_events
  FOR SELECT TO authenticated
  USING (public.is_admin_user());
REVOKE ALL ON public.admin_email_delivery_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_email_delivery_events TO authenticated;
GRANT ALL ON public.admin_email_delivery_events TO service_role;

-- A provider timestamp, or the time we received it when that is unreadable.
CREATE OR REPLACE FUNCTION public.issue_4419_event_time(p_value text, p_fallback timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NULLIF(btrim(COALESCE(p_value, '')), '') IS NULL THEN
    RETURN p_fallback;
  END IF;
  RETURN p_value::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN p_fallback;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4419_event_time(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4419_event_time(text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4419_apply_admin_email_event(p_svix_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event public.marketing_email_events%ROWTYPE;
  v_delivery_id uuid;
  v_campaign_id uuid;
BEGIN
  SELECT * INTO v_event FROM public.marketing_email_events WHERE svix_id = p_svix_id;
  IF NOT FOUND OR v_event.provider_message_id IS NULL OR v_event.event_type NOT IN (
    'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced',
    'email.complained', 'email.opened', 'email.clicked'
  ) THEN
    RETURN false;
  END IF;

  SELECT d.id, d.campaign_id INTO v_delivery_id, v_campaign_id
    FROM public.admin_email_recipient_deliveries d
   WHERE d.provider_message_id = v_event.provider_message_id
   ORDER BY d.created_at, d.id
   LIMIT 1;
  IF v_delivery_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.admin_email_delivery_events
    (svix_id, delivery_id, campaign_id, event_type, occurred_at, link_url, bounce_type)
  VALUES (
    v_event.svix_id,
    v_delivery_id,
    v_campaign_id,
    v_event.event_type,
    public.issue_4419_event_time(v_event.payload->>'created_at', v_event.received_at),
    left(v_event.payload->'data'->'click'->>'link', 2048),
    v_event.payload->'data'->'bounce'->>'type'
  )
  ON CONFLICT (svix_id) DO NOTHING;

  UPDATE public.marketing_email_events
     SET is_campaign_event = false
   WHERE svix_id = p_svix_id
     AND is_campaign_event;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4419_apply_admin_email_event(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4419_apply_admin_email_event(text) TO service_role;

-- The #2714 ingest, unchanged for host marketing, then Admin linking for an
-- event no host message claimed. Returns 'admin_delivery' when it linked, so
-- resend-webhook answers 200 (not the campaign_unmatched retry).
CREATE OR REPLACE FUNCTION public.mkt_ingest_email_event(
  p_svix_id text,
  p_event_type text,
  p_provider_message_id text,
  p_payload jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_from text := lower(COALESCE(p_payload->'data'->>'from',''));
  v_result text;
BEGIN
  INSERT INTO public.marketing_email_events
    (svix_id, event_type, provider_message_id, payload, is_campaign_event)
  VALUES (
    p_svix_id,
    p_event_type,
    p_provider_message_id,
    p_payload,
    v_from ~ '(^|<)[^<>@[:space:]]+@campaigns[.]usemingla[.]com>?[[:space:]]*$'
  )
  ON CONFLICT (svix_id) DO NOTHING;

  v_result := public.mkt_reconcile_email_event(p_svix_id);

  IF v_result IN ('unmatched', 'campaign_unmatched', 'campaign_unmatched_stale') THEN
    BEGIN
      IF public.issue_4419_apply_admin_email_event(p_svix_id) THEN
        v_result := 'admin_delivery';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'issue_4419_admin_email_event_link_failed: % (%)', SQLERRM, SQLSTATE;
    END;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.mkt_ingest_email_event(text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_ingest_email_event(text,text,text,jsonb)
  TO service_role;

-- Late binding: an event can arrive before the delivery row stores the
-- provider id. When the id lands, link whatever already arrived.
CREATE OR REPLACE FUNCTION public.issue_4419_link_admin_delivery_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_event record;
BEGIN
  IF NEW.provider_message_id IS NULL THEN
    RETURN NEW;
  END IF;
  FOR v_event IN
    SELECT svix_id
      FROM public.marketing_email_events
     WHERE provider_message_id = NEW.provider_message_id
       AND message_id IS NULL
     ORDER BY received_at, svix_id
  LOOP
    BEGIN
      PERFORM public.issue_4419_apply_admin_email_event(v_event.svix_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'issue_4419_admin_email_event_late_link_failed: % (%)', SQLERRM, SQLSTATE;
    END;
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4419_link_admin_delivery_events() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4419_link_admin_delivery_events ON public.admin_email_recipient_deliveries;
CREATE TRIGGER issue_4419_link_admin_delivery_events
AFTER INSERT OR UPDATE OF provider_message_id ON public.admin_email_recipient_deliveries
FOR EACH ROW
WHEN (NEW.provider_message_id IS NOT NULL)
EXECUTE FUNCTION public.issue_4419_link_admin_delivery_events();

-- One campaign's engagement. Opens are approximate (Apple Mail loads every
-- image); the page says so. clicks_seen_anywhere is false until any Admin
-- email has a click event: that is when Admin stops saying click tracking is off.
CREATE OR REPLACE FUNCTION public.issue_4419_admin_email_engagement(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH e AS (
    SELECT delivery_id, event_type, link_url, bounce_type
    FROM public.admin_email_delivery_events
    WHERE campaign_id = p_campaign_id
  )
  SELECT jsonb_build_object(
    'accepted', (SELECT count(*) FROM public.admin_email_recipient_deliveries
                  WHERE campaign_id = p_campaign_id AND status = 'accepted'),
    'events', (SELECT count(*) FROM e),
    'delivered', (SELECT count(DISTINCT delivery_id) FROM e WHERE event_type = 'email.delivered'),
    'bounced', jsonb_build_object(
      'hard', (SELECT count(DISTINCT delivery_id) FROM e
                WHERE event_type = 'email.bounced' AND bounce_type = 'Permanent'),
      'soft', (SELECT count(DISTINCT delivery_id) FROM e
                WHERE event_type = 'email.bounced' AND COALESCE(bounce_type, '') <> 'Permanent')
    ),
    'complained', (SELECT count(DISTINCT delivery_id) FROM e WHERE event_type = 'email.complained'),
    'opened_unique', (SELECT count(DISTINCT delivery_id) FROM e WHERE event_type = 'email.opened'),
    'opened_total', (SELECT count(*) FROM e WHERE event_type = 'email.opened'),
    'clicked_unique', (SELECT count(DISTINCT delivery_id) FROM e WHERE event_type = 'email.clicked'),
    'clicked_total', (SELECT count(*) FROM e WHERE event_type = 'email.clicked'),
    'top_links', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('url', l.link_url, 'unique', l.u, 'total', l.t)
                       ORDER BY l.u DESC, l.t DESC, l.link_url)
      FROM (
        SELECT link_url, count(DISTINCT delivery_id) AS u, count(*) AS t
        FROM e
        WHERE event_type = 'email.clicked' AND link_url IS NOT NULL
        GROUP BY link_url
        ORDER BY count(DISTINCT delivery_id) DESC, count(*) DESC, link_url
        LIMIT 5
      ) l
    ), '[]'::jsonb),
    'tracking', jsonb_build_object(
      'opens_seen', EXISTS (SELECT 1 FROM e WHERE event_type = 'email.opened'),
      'clicks_seen', EXISTS (SELECT 1 FROM e WHERE event_type = 'email.clicked'),
      'clicks_seen_anywhere', EXISTS (
        SELECT 1 FROM public.admin_email_delivery_events WHERE event_type = 'email.clicked'
      )
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.issue_4419_admin_email_engagement(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4419_admin_email_engagement(uuid) TO service_role;

-- Delivered and unique opens for the rows on one page of the Emails list.
CREATE OR REPLACE FUNCTION public.issue_4419_admin_email_engagement_counts(p_campaign_ids uuid[])
RETURNS TABLE (campaign_id uuid, delivered bigint, opened_unique bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT e.campaign_id,
         count(DISTINCT e.delivery_id) FILTER (WHERE e.event_type = 'email.delivered'),
         count(DISTINCT e.delivery_id) FILTER (WHERE e.event_type = 'email.opened')
  FROM public.admin_email_delivery_events e
  WHERE e.campaign_id = ANY (COALESCE(p_campaign_ids, ARRAY[]::uuid[]))
  GROUP BY e.campaign_id;
$function$;

REVOKE ALL ON FUNCTION public.issue_4419_admin_email_engagement_counts(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4419_admin_email_engagement_counts(uuid[]) TO service_role;

-- History: every event already received for an Admin delivery. A function so
-- the pg17 suite runs the very statement this migration runs.
CREATE OR REPLACE FUNCTION public.issue_4419_backfill_admin_email_events()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_count bigint;
BEGIN
  INSERT INTO public.admin_email_delivery_events
    (svix_id, delivery_id, campaign_id, event_type, occurred_at, link_url, bounce_type)
  SELECT DISTINCT ON (ev.svix_id)
    ev.svix_id,
    d.id,
    d.campaign_id,
    ev.event_type,
    public.issue_4419_event_time(ev.payload->>'created_at', ev.received_at),
    left(ev.payload->'data'->'click'->>'link', 2048),
    ev.payload->'data'->'bounce'->>'type'
  FROM public.marketing_email_events ev
  JOIN public.admin_email_recipient_deliveries d
    ON d.provider_message_id = ev.provider_message_id
  WHERE ev.provider_message_id IS NOT NULL
    AND ev.event_type IN (
      'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced',
      'email.complained', 'email.opened', 'email.clicked'
    )
  ORDER BY ev.svix_id, d.created_at, d.id
  ON CONFLICT (svix_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4419_backfill_admin_email_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4419_backfill_admin_email_events() TO service_role;

DO $backfill$
DECLARE
  v_linked bigint := public.issue_4419_backfill_admin_email_events();
BEGIN
  RAISE NOTICE 'issue-4419: linked % existing provider events to Admin email deliveries', v_linked;
END;
$backfill$;

COMMIT;
