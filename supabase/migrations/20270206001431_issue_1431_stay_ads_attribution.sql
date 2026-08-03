-- Issue #1431: Stay destinations and booking attribution for the existing
-- five-platform ad engine. All objects are additive and remain dark while the
-- existing Stay public/reserve flags are disabled.

BEGIN;

ALTER TABLE public.ad_campaigns
  ADD COLUMN IF NOT EXISTS dest_venue_id uuid
    REFERENCES public.venue_listings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_dest_venue_id
  ON public.ad_campaigns (dest_venue_id) WHERE dest_venue_id IS NOT NULL;

ALTER TABLE public.ad_conversions
  ADD COLUMN IF NOT EXISTS stay_group_id uuid
    REFERENCES public.stay_reservation_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ad_conversions_stay_group_id
  ON public.ad_conversions (stay_group_id) WHERE stay_group_id IS NOT NULL;

ALTER TABLE public.stay_reservation_groups
  ADD COLUMN IF NOT EXISTS attribution_click_id text
    REFERENCES public.ad_attribution_touches(click_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_stay_groups_attribution_click
  ON public.stay_reservation_groups (attribution_click_id)
  WHERE attribution_click_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.issue_1431_guard_stay_attribution_click()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF OLD.attribution_click_id IS NOT NULL
     AND NEW.attribution_click_id IS DISTINCT FROM OLD.attribution_click_id THEN
    RAISE EXCEPTION 'stay_attribution_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS issue_1431_stay_attribution_immutable
  ON public.stay_reservation_groups;
CREATE TRIGGER issue_1431_stay_attribution_immutable
  BEFORE UPDATE OF attribution_click_id ON public.stay_reservation_groups
  FOR EACH ROW EXECUTE FUNCTION public.issue_1431_guard_stay_attribution_click();

CREATE TABLE public.stay_ad_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_event_id text NOT NULL UNIQUE,
  source_event_id uuid NOT NULL UNIQUE
    REFERENCES public.stay_reservation_events(id) ON DELETE CASCADE,
  group_id uuid NOT NULL
    REFERENCES public.stay_reservation_groups(id) ON DELETE CASCADE,
  touch_id uuid NOT NULL
    REFERENCES public.ad_attribution_touches(id) ON DELETE CASCADE,
  click_id text NOT NULL,
  campaign_id uuid NOT NULL
    REFERENCES public.ad_campaigns(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES public.ad_connections(id) ON DELETE SET NULL,
  platform text CHECK (
    platform IS NULL OR platform IN ('meta','tiktok','snapchat','google','reddit')
  ),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN (
    'reservation_submitted','request_approved','booking_confirmed',
    'booking_cancelled','refund_succeeded'
  )),
  gross_value_minor bigint CHECK (
    gross_value_minor IS NULL OR gross_value_minor >= 0
  ),
  refund_value_minor bigint CHECK (
    refund_value_minor IS NULL OR refund_value_minor >= 0
  ),
  currency_code character(3) NOT NULL
    REFERENCES public.supported_brand_currencies(code),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stay_ad_lifecycle_money_shape CHECK (
    (outcome = 'booking_confirmed' AND gross_value_minor IS NOT NULL
      AND refund_value_minor IS NULL)
    OR (outcome = 'refund_succeeded' AND refund_value_minor IS NOT NULL
      AND gross_value_minor IS NULL)
    OR (outcome NOT IN ('booking_confirmed','refund_succeeded')
      AND gross_value_minor IS NULL AND refund_value_minor IS NULL)
  )
);

CREATE INDEX stay_ad_lifecycle_campaign_created_idx
  ON public.stay_ad_lifecycle_events (campaign_id, created_at DESC);
CREATE INDEX stay_ad_lifecycle_group_idx
  ON public.stay_ad_lifecycle_events (group_id, created_at, id);

ALTER TABLE public.stay_ad_lifecycle_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stay ad lifecycle admin can read"
  ON public.stay_ad_lifecycle_events FOR SELECT
  USING (public.is_admin_user());
-- The baseline grants new public tables to anon/authenticated by default.
-- Remove that ambient access before assigning this private ledger's narrow ACLs.
REVOKE ALL ON public.stay_ad_lifecycle_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.stay_ad_lifecycle_events TO authenticated;
GRANT ALL ON public.stay_ad_lifecycle_events TO service_role;

CREATE OR REPLACE VIEW public.ad_public_stay_destinations_view AS
SELECT
  venue.id,
  venue.brand_id,
  venue.brand_slug,
  venue.brand_name,
  venue.slug,
  venue.name AS title,
  venue.city,
  venue.country_code,
  venue.cover_media_url,
  venue.default_currency
FROM public.venue_public_view venue
JOIN public.stay_settings settings
  ON settings.venue_id = venue.id
 AND settings.brand_id = venue.brand_id
 AND settings.booking_state = 'active'
WHERE venue.venue_category = 'stay'
  AND venue.brand_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  AND char_length(venue.brand_slug) <= 160
  AND venue.slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  AND char_length(venue.slug) <= 200
  AND venue.default_currency IS NOT NULL
  AND public.pg_brand_can_collect(venue.brand_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.brand_currency_reconciliations rec
    WHERE rec.brand_id = venue.brand_id AND rec.status = 'pending'
  )
  AND COALESCE((
    SELECT flag.is_enabled FROM public.feature_flags flag
    WHERE flag.flag_key = 'STAY_PUBLIC_PAGES'
  ), false)
  AND COALESCE((
    SELECT flag.is_enabled FROM public.feature_flags flag
    WHERE flag.flag_key = 'STAY_RESERVE_WRITES'
  ), false)
  AND EXISTS (
    SELECT 1
    FROM public.stay_offerings offering
    JOIN public.stay_price_versions price
      ON price.offering_id = offering.id
     AND price.brand_id = offering.brand_id
     AND price.venue_id = offering.venue_id
     AND price.effective_to IS NULL
     AND price.currency_code::text = venue.default_currency
    JOIN public.stay_policy_versions policy
      ON policy.offering_id = offering.id
     AND policy.brand_id = offering.brand_id
     AND policy.venue_id = offering.venue_id
     AND policy.effective_to IS NULL
    WHERE offering.venue_id = venue.id
      AND offering.brand_id = venue.brand_id
      AND offering.status = 'live'
  );

ALTER VIEW public.ad_public_stay_destinations_view SET (security_invoker = false);
GRANT SELECT ON public.ad_public_stay_destinations_view TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_1431_project_stay_ad_event(
  p_event_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_event public.stay_reservation_events%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_touch public.ad_attribution_touches%ROWTYPE;
  v_outcome text;
  v_refund_id uuid;
  v_refund_minor bigint;
  v_stable_event_id text;
BEGIN
  SELECT * INTO v_event FROM public.stay_reservation_events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups
    WHERE id = v_event.group_id AND attribution_click_id IS NOT NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO v_touch FROM public.ad_attribution_touches
    WHERE click_id = v_group.attribution_click_id AND campaign_id IS NOT NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ad_campaigns campaign
    WHERE campaign.id = v_touch.campaign_id
      AND campaign.dest_page_type = 'venue'
      AND campaign.dest_venue_id = v_group.venue_id
      AND campaign.dest_brand_slug = (
        SELECT brand.slug FROM public.brands brand WHERE brand.id = v_group.brand_id
      )
  ) THEN RETURN false; END IF;

  v_outcome := CASE v_event.event_type
    WHEN 'stay_request_submitted' THEN 'reservation_submitted'
    WHEN 'stay_request_approved' THEN 'request_approved'
    WHEN 'stay_reservation_confirmed' THEN 'booking_confirmed'
    WHEN 'stay_reservation_cancelled' THEN 'booking_cancelled'
    WHEN 'stay_refund_succeeded' THEN 'refund_succeeded'
    ELSE NULL
  END;
  IF v_outcome IS NULL THEN RETURN false; END IF;

  IF v_outcome IN ('booking_cancelled','refund_succeeded') THEN
    BEGIN
      v_refund_id := NULLIF(v_event.safe_metadata->>'refundId', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN false;
    END;
    IF v_refund_id IS NULL THEN RETURN false; END IF;
  END IF;
  IF v_outcome = 'refund_succeeded' THEN
    SELECT amount_minor INTO v_refund_minor FROM public.stay_refunds
      WHERE id = v_refund_id AND group_id = v_group.id AND state = 'succeeded';
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;

  v_stable_event_id := CASE v_outcome
    WHEN 'reservation_submitted' THEN 'stay:' || v_group.id || ':submitted'
    WHEN 'request_approved' THEN 'stay:' || v_group.id || ':approved'
    WHEN 'booking_confirmed' THEN 'stay:' || v_group.id || ':confirmed'
    WHEN 'booking_cancelled' THEN 'stay:' || v_group.id || ':cancel:' || v_refund_id
    WHEN 'refund_succeeded' THEN 'stay:' || v_group.id || ':refund:' || v_refund_id
  END;

  INSERT INTO public.stay_ad_lifecycle_events (
    stable_event_id, source_event_id, group_id, touch_id, click_id,
    campaign_id, connection_id, platform, brand_id, venue_id, outcome,
    gross_value_minor, refund_value_minor, currency_code, created_at
  ) VALUES (
    v_stable_event_id, v_event.id, v_group.id, v_touch.id, v_touch.click_id,
    v_touch.campaign_id, v_touch.connection_id,
    CASE WHEN v_touch.network IN ('meta','tiktok','snapchat','google','reddit')
      THEN v_touch.network ELSE NULL END,
    v_group.brand_id, v_group.venue_id, v_outcome,
    CASE WHEN v_outcome = 'booking_confirmed' THEN v_group.total_minor END,
    CASE WHEN v_outcome = 'refund_succeeded' THEN v_refund_minor END,
    v_group.currency_code, v_event.created_at
  ) ON CONFLICT (source_event_id) DO NOTHING;

  IF FOUND AND v_outcome = 'refund_succeeded' THEN
    UPDATE public.ad_conversions
    SET value_cents = GREATEST(0, COALESCE(value_cents, 0) - v_refund_minor),
        updated_at = now()
    WHERE stay_group_id = v_group.id;
  END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1431_project_stay_ad_event_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.issue_1431_project_stay_ad_event(NEW.id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS issue_1431_project_stay_ad_event
  ON public.stay_reservation_events;
CREATE TRIGGER issue_1431_project_stay_ad_event
  AFTER INSERT ON public.stay_reservation_events
  FOR EACH ROW EXECUTE FUNCTION public.issue_1431_project_stay_ad_event_trigger();

CREATE OR REPLACE FUNCTION public.issue_1431_attach_stay_attribution(
  p_group_id uuid,
  p_click_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_touch public.ad_attribution_touches%ROWTYPE;
  v_event record;
BEGIN
  IF p_group_id IS NULL OR p_click_id IS NULL
     OR char_length(pg_catalog.btrim(p_click_id)) NOT BETWEEN 8 AND 200 THEN
    RETURN false;
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id;
  IF NOT FOUND OR v_group.user_id IS DISTINCT FROM auth.uid() THEN RETURN false; END IF;
  IF v_group.attribution_click_id IS NOT NULL THEN
    RETURN v_group.attribution_click_id = pg_catalog.btrim(p_click_id);
  END IF;
  SELECT * INTO v_touch FROM public.ad_attribution_touches
    WHERE click_id = pg_catalog.btrim(p_click_id)
      AND created_at >= now() - interval '28 days';
  IF NOT FOUND OR v_touch.campaign_id IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ad_campaigns campaign
    JOIN public.brands brand ON brand.slug = campaign.dest_brand_slug
    WHERE campaign.id = v_touch.campaign_id
      AND campaign.dest_page_type = 'venue'
      AND campaign.dest_venue_id = v_group.venue_id
      AND brand.id = v_group.brand_id
  ) THEN RETURN false; END IF;

  UPDATE public.stay_reservation_groups
  SET attribution_click_id = v_touch.click_id
  WHERE id = v_group.id AND attribution_click_id IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  FOR v_event IN SELECT id FROM public.stay_reservation_events
    WHERE group_id = v_group.id ORDER BY created_at, id
  LOOP
    PERFORM public.issue_1431_project_stay_ad_event(v_event.id);
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[issue_1431] stay attribution attach absorbed: %', SQLERRM;
  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_manage_stay_reservation(
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_expected_version bigint DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_action text := lower(pg_catalog.btrim(COALESCE(p_action, '')));
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_payload, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF p_request_id IS NOT NULL THEN
    PERFORM set_config('mingla.request_id', p_request_id::text, true);
  END IF;
  IF v_action = 'quote' THEN
    RETURN public.issue_1388_quote_stay_cart(
      (p_payload->>'venueId')::uuid, p_payload->'lines',
      p_payload->>'idempotencyKey', p_request_id
    );
  ELSIF v_action = 'create_group' THEN
    v_result := public.issue_1388_create_stay_group(
      (p_payload->>'quoteId')::uuid, p_payload->>'idempotencyKey',
      p_payload->'guest', p_expected_version, p_request_id
    );
    IF NULLIF(pg_catalog.btrim(p_payload->>'attributionClickId'), '') IS NOT NULL THEN
      PERFORM public.issue_1431_attach_stay_attribution(
        (v_result->>'groupId')::uuid,
        p_payload->>'attributionClickId'
      );
    END IF;
    RETURN v_result;
  ELSIF v_action IN ('approve_request', 'decline_request') THEN
    RETURN public.issue_1388_manage_request(
      v_action, (p_payload->>'groupId')::uuid, p_expected_version,
      p_payload->>'idempotencyKey', p_request_id
    );
  ELSIF v_action = 'get_group' THEN
    RETURN public.issue_1388_group_projection((p_payload->>'groupId')::uuid);
  END IF;
  RAISE EXCEPTION 'stay_invalid_action' USING ERRCODE = '22023';
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_stay_ad_campaign_rollup(
  p_campaign_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_campaign public.ad_campaigns%ROWTYPE;
  v_result jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_campaign FROM public.ad_campaigns
    WHERE id = p_campaign_id AND dest_page_type = 'venue';
  IF NOT FOUND THEN RAISE EXCEPTION 'stay_campaign_not_found' USING ERRCODE = 'P0002'; END IF;

  WITH funnel AS (
    SELECT
      count(DISTINCT group_id) FILTER (WHERE outcome = 'reservation_submitted') AS submitted,
      count(DISTINCT group_id) FILTER (WHERE outcome = 'request_approved') AS approved,
      count(DISTINCT group_id) FILTER (WHERE outcome = 'booking_confirmed') AS confirmed,
      count(DISTINCT group_id) FILTER (WHERE outcome = 'booking_cancelled') AS cancelled
    FROM public.stay_ad_lifecycle_events WHERE campaign_id = p_campaign_id
  ), money AS (
    SELECT currency_code::text AS currency,
      sum(COALESCE(gross_value_minor, 0)) AS gross,
      sum(COALESCE(refund_value_minor, 0)) AS refunds
    FROM public.stay_ad_lifecycle_events
    WHERE campaign_id = p_campaign_id
    GROUP BY currency_code
  ), maps AS (
    SELECT
      COALESCE(jsonb_object_agg(currency, gross), '{}'::jsonb) AS gross,
      COALESCE(jsonb_object_agg(currency, refunds), '{}'::jsonb) AS refunds,
      COALESCE(jsonb_object_agg(currency, GREATEST(0, gross - refunds)), '{}'::jsonb) AS net
    FROM money
  )
  SELECT jsonb_build_object(
    'campaignId', v_campaign.id,
    'pageType', v_campaign.dest_page_type,
    'brandSlug', v_campaign.dest_brand_slug,
    'entitySlug', v_campaign.dest_entity_slug,
    'venueId', v_campaign.dest_venue_id,
    'visits', (SELECT count(DISTINCT touch.click_id) FROM public.ad_attribution_touches touch WHERE touch.campaign_id = p_campaign_id),
    'reservationRequests', funnel.submitted,
    'approvedRequests', funnel.approved,
    'confirmedBookings', funnel.confirmed,
    'cancellations', funnel.cancelled,
    'grossByCurrency', maps.gross,
    'refundsByCurrency', maps.refunds,
    'netByCurrency', maps.net
  ) INTO v_result FROM funnel CROSS JOIN maps;
  RETURN v_result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.issue_1431_guard_stay_attribution_click()
  FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.issue_1431_project_stay_ad_event(uuid)
  FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.issue_1431_project_stay_ad_event_trigger()
  FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.issue_1431_attach_stay_attribution(uuid, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1431_attach_stay_attribution(uuid, text)
  TO service_role;
REVOKE EXECUTE ON FUNCTION public.admin_stay_ad_campaign_rollup(uuid)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_stay_ad_campaign_rollup(uuid)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
