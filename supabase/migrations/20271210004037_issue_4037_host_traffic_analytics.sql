-- ISSUE #4037 — host page traffic and "What Mingla brought you". FORWARD-ONLY.
--
-- Implements the database half of the host-traffic contract (#3697 comment
-- 6310998065, amended by the no-consent decision 6311010228 and by Seth's
-- seven decisions on #4037 comment 6325156309):
--
--   * offering_engagement_events       raw, cookieless, aggregate-only events.
--                                       Purged at 35 days.
--   * offering_engagement_salts        one random salt per brand per brand-local
--                                       day (decision 2). Deleted after 48h.
--   * offering_engagement_visitor_marks per-day dedupe marks (brand visit, page
--                                       visit, app impression). Purged after
--                                       3 days: only the current brand-day needs
--                                       them.
--   * offering_engagement_daily        per (brand, page, brand-day, source)
--                                       counts. Kept forever.
--   * offering_engagement_brand_daily  per (brand, brand-day, source) visitors,
--                                       each visitor counted once per brand-day
--                                       under the source of their first visit
--                                       that day (decision 6). Kept forever.
--   * offering_engagement_capture_config capture_started_at (window honesty).
--
--   * offering_traffic_brand_timezone(brand)   decision 1 — server-side zone.
--   * claim_offering_engagement_salt(...)      service_role only.
--   * capture_offering_engagement_event(...)   service_role only. Classifies the
--                                              source (§2), dedupes, rate-limits,
--                                              buckets the brand-day at write time.
--   * brand_traffic_rollup(brand, range)       members/admins.
--   * entity_traffic_rollup(brand, type, id, range)  decision 4 — brand_id is
--                                              required; every non-brand page must
--                                              belong to that brand.
--   * cleanup_offering_engagement(limit)       hourly pg_cron purge.
--
-- Engagement vs conversion (decision 5): every tap is a cta_click (engagement),
-- including view_brand / view_venue / view_offering. Bookings, customers and
-- value come ONLY from completed orders, reservations and RSVPs (the same spine
-- brand_mingla_drove_rollup counts), with source from the existing
-- ad_conversions -> ad_attribution_touches mapping; no touch = direct_unknown.
--
-- NOT in this migration (tracked on #4037): the brand_mingla_drove_rollup /
-- entity_conversion_rollup by_source relabel (installed native clients reject
-- the six-bucket shape until the Business OTA ships), and checkout-session
-- source capture (checkout paths belong to PR #4036).
BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR to_regnamespace('cron') IS NULL THEN
    RAISE EXCEPTION 'issue_4037_pg_cron_required';
  END IF;
  IF to_regprocedure('public.derive_venue_iana_timezone(double precision,double precision,text)') IS NULL THEN
    RAISE EXCEPTION 'issue_4037_timezone_deriver_required';
  END IF;
END
$guard$;

-- ── 1. Tables ───────────────────────────────────────────────────────────────

CREATE TABLE public.offering_engagement_capture_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  capture_started_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.offering_engagement_capture_config(singleton) VALUES (true);

CREATE TABLE public.offering_engagement_salts (
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  local_day date NOT NULL,
  timezone text NOT NULL,
  salt text NOT NULL CHECK (salt ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand_id, local_day)
);

CREATE TABLE public.offering_engagement_events (
  id uuid PRIMARY KEY,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  entity_type text NOT NULL
    CHECK (entity_type IN ('event','brand','trip','experience','venue')),
  entity_id uuid NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'page_view','cta_click','checkout_start','app_impression','app_open'
  )),
  cta_type text NULL CHECK (cta_type IS NULL OR cta_type IN (
    'buy','book','rsvp','share','save','directions','website','call',
    'view_brand','view_venue','view_offering'
  )),
  source text NOT NULL CHECK (source IN (
    'mingla_app','mingla_ads','search','social','own_links','direct_unknown'
  )),
  surface text NOT NULL
    CHECK (surface IN ('buyer_web','consumer_ios','consumer_android')),
  visitor_key text NOT NULL CHECK (visitor_key ~ '^[0-9a-f]{64}$'),
  checkout_session_id uuid NULL,
  brand_day date NOT NULL,
  timezone text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((entity_type = 'brand') = (entity_id IS NULL)),
  CHECK ((event_type = 'cta_click') = (cta_type IS NOT NULL)),
  CHECK ((event_type = 'checkout_start') = (checkout_session_id IS NOT NULL))
);

CREATE TABLE public.offering_engagement_visitor_marks (
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  mark text NOT NULL CHECK (mark IN ('brand_visit','page_visit','app_impression')),
  entity_key uuid NOT NULL,
  brand_day date NOT NULL,
  visitor_key text NOT NULL CHECK (visitor_key ~ '^[0-9a-f]{64}$'),
  source text NOT NULL CHECK (source IN (
    'mingla_app','mingla_ads','search','social','own_links','direct_unknown'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand_id, mark, entity_key, brand_day, visitor_key)
);

CREATE TABLE public.offering_engagement_daily (
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  entity_type text NOT NULL
    CHECK (entity_type IN ('event','brand','trip','experience','venue')),
  entity_id uuid NULL,
  day date NOT NULL,
  source text NOT NULL CHECK (source IN (
    'mingla_app','mingla_ads','search','social','own_links','direct_unknown'
  )),
  page_views bigint NOT NULL DEFAULT 0 CHECK (page_views >= 0),
  visitors bigint NOT NULL DEFAULT 0 CHECK (visitors >= 0),
  cta_buy bigint NOT NULL DEFAULT 0 CHECK (cta_buy >= 0),
  cta_book bigint NOT NULL DEFAULT 0 CHECK (cta_book >= 0),
  cta_rsvp bigint NOT NULL DEFAULT 0 CHECK (cta_rsvp >= 0),
  cta_share bigint NOT NULL DEFAULT 0 CHECK (cta_share >= 0),
  cta_save bigint NOT NULL DEFAULT 0 CHECK (cta_save >= 0),
  cta_directions bigint NOT NULL DEFAULT 0 CHECK (cta_directions >= 0),
  cta_website bigint NOT NULL DEFAULT 0 CHECK (cta_website >= 0),
  cta_call bigint NOT NULL DEFAULT 0 CHECK (cta_call >= 0),
  cta_view_brand bigint NOT NULL DEFAULT 0 CHECK (cta_view_brand >= 0),
  cta_view_venue bigint NOT NULL DEFAULT 0 CHECK (cta_view_venue >= 0),
  cta_view_offering bigint NOT NULL DEFAULT 0 CHECK (cta_view_offering >= 0),
  checkout_starts bigint NOT NULL DEFAULT 0 CHECK (checkout_starts >= 0),
  app_impressions bigint NOT NULL DEFAULT 0 CHECK (app_impressions >= 0),
  app_opens bigint NOT NULL DEFAULT 0 CHECK (app_opens >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((entity_type = 'brand') = (entity_id IS NULL)),
  CONSTRAINT offering_engagement_daily_bucket_key
    UNIQUE NULLS NOT DISTINCT (brand_id, entity_type, entity_id, day, source)
);

CREATE TABLE public.offering_engagement_brand_daily (
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  day date NOT NULL,
  source text NOT NULL CHECK (source IN (
    'mingla_app','mingla_ads','search','social','own_links','direct_unknown'
  )),
  visitors bigint NOT NULL DEFAULT 0 CHECK (visitors >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand_id, day, source)
);

CREATE INDEX offering_engagement_events_visitor_time_idx
  ON public.offering_engagement_events(visitor_key, occurred_at DESC);
CREATE INDEX offering_engagement_events_brand_time_idx
  ON public.offering_engagement_events(brand_id, occurred_at DESC);
CREATE INDEX offering_engagement_events_occurred_idx
  ON public.offering_engagement_events(occurred_at);
CREATE UNIQUE INDEX offering_engagement_events_checkout_once_idx
  ON public.offering_engagement_events(checkout_session_id)
  WHERE event_type = 'checkout_start';
CREATE INDEX offering_engagement_daily_brand_day_idx
  ON public.offering_engagement_daily(brand_id, day);
CREATE INDEX offering_engagement_visitor_marks_created_idx
  ON public.offering_engagement_visitor_marks(created_at);
CREATE INDEX offering_engagement_salts_created_idx
  ON public.offering_engagement_salts(created_at);

ALTER TABLE public.offering_engagement_capture_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offering_engagement_capture_config FORCE ROW LEVEL SECURITY;
ALTER TABLE public.offering_engagement_salts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offering_engagement_salts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.offering_engagement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offering_engagement_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.offering_engagement_visitor_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offering_engagement_visitor_marks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.offering_engagement_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offering_engagement_daily FORCE ROW LEVEL SECURITY;
ALTER TABLE public.offering_engagement_brand_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offering_engagement_brand_daily FORCE ROW LEVEL SECURITY;

-- No policies: no client role may read or write these tables directly. Hosts
-- read aggregates only through the two SECURITY DEFINER rollups below.
REVOKE ALL ON public.offering_engagement_capture_config FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.offering_engagement_salts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.offering_engagement_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.offering_engagement_visitor_marks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.offering_engagement_daily FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.offering_engagement_brand_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.offering_engagement_capture_config TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offering_engagement_salts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offering_engagement_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offering_engagement_visitor_marks TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offering_engagement_daily TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offering_engagement_brand_daily TO service_role;

COMMENT ON TABLE public.offering_engagement_events IS
  'Issue #4037: raw cookieless page/tap events for host traffic. visitor_key is sha256(per-brand per-brand-day salt, IP, user agent) computed in the edge function; raw IP and user agent are never stored. brand_day is fixed at write time in the brand timezone. Purged at 35 days by cleanup_offering_engagement.';
COMMENT ON TABLE public.offering_engagement_salts IS
  'Issue #4037: one random salt per brand per brand-local day (decision 2: rotates at the brand''s local midnight). Deleted 48h after creation.';
COMMENT ON TABLE public.offering_engagement_visitor_marks IS
  'Issue #4037: same-day dedupe marks (brand_visit = first visit of the brand-day with its source; page_visit = first visit of a page that day; app_impression = once per visitor, offering and day). Purged after 3 days.';
COMMENT ON TABLE public.offering_engagement_daily IS
  'Issue #4037: per (brand, page, brand-day, source) aggregate counts, kept forever. visitors credits each visitor once per page-day under their first source. Every cta_* column is engagement, never a conversion (decision 5).';
COMMENT ON TABLE public.offering_engagement_brand_daily IS
  'Issue #4037: brand-wide visitors, each visitor counted once per brand-day under the source of their first visit that day (decision 6). Kept forever.';

-- ── 2. Brand timezone (decision 1) ──────────────────────────────────────────
-- The payout country is the country of the brand's live payout account: the
-- connected Stripe account's country, else the Paystack payment country. The
-- host's picker choice on brands is display-only (#3645 A-02 forbids any
-- routine reading it), so it is deliberately not an input here.
-- Payout country -> its zone when the country has one zone. Countries with
-- several zones (any rectangle row in venue_timezone_regions, plus the large
-- multi-zone countries the table carries as one row) and unknown countries go
-- to the brand address, then the main venue, then the brand's own events, then
-- UTC. Never the viewer's device.
CREATE FUNCTION public.offering_traffic_brand_timezone(p_brand_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_brand record;
  v_country text;
  v_zone text;
  v_multi boolean;
BEGIN
  SELECT b.payment_country, b.country_code, b.lat, b.lng
    INTO v_brand
  FROM public.brands b
  WHERE b.id = p_brand_id;
  IF NOT FOUND THEN
    RETURN 'UTC';
  END IF;

  v_country := upper(btrim(COALESCE(
    (SELECT account.country::text FROM public.stripe_connect_accounts account
      WHERE account.brand_id = p_brand_id AND account.detached_at IS NULL
      LIMIT 1),
    v_brand.payment_country,
    ''
  )));
  IF v_country !~ '^[A-Z]{2}$' THEN
    v_country := NULL;
  END IF;

  IF v_country IS NOT NULL THEN
    v_multi := v_country IN ('BR','RU','KZ','CL','CD','MN','KI','FM','PF')
      OR EXISTS (
        SELECT 1 FROM public.venue_timezone_regions region
        WHERE region.country_code = v_country AND region.min_lat IS NOT NULL
      );
    IF NOT v_multi THEN
      SELECT region.zone_name INTO v_zone
      FROM public.venue_timezone_regions region
      JOIN pg_catalog.pg_timezone_names zone ON zone.name = region.zone_name
      WHERE region.country_code = v_country AND region.min_lat IS NULL
      ORDER BY region.priority, region.id
      LIMIT 1;
      IF v_zone IS NOT NULL THEN
        RETURN v_zone;
      END IF;
    END IF;
  END IF;

  -- The brand's own address.
  v_zone := public.derive_venue_iana_timezone(
    v_brand.lat, v_brand.lng, COALESCE(v_brand.country_code, v_country)
  );
  IF v_zone IS NOT NULL THEN
    RETURN v_zone;
  END IF;

  -- The main venue: its set zone, else derived from its location.
  SELECT COALESCE(
      CASE WHEN availability.iana_timezone_source <> 'default'
        THEN availability.iana_timezone END,
      public.derive_venue_iana_timezone(
        venue.lat, venue.lng, COALESCE(venue.country_code, v_country)
      )
    )
    INTO v_zone
  FROM public.venue_listings venue
  LEFT JOIN public.venue_availability_config availability
    ON availability.venue_id = venue.id
  WHERE venue.brand_id = p_brand_id
  ORDER BY venue.created_at, venue.id
  LIMIT 1;
  IF v_zone IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names zone WHERE zone.name = v_zone) THEN
    RETURN v_zone;
  END IF;

  -- The brand's own events (most recently published first). 'UTC' is the
  -- column default, so it carries no information and is skipped.
  SELECT event.timezone INTO v_zone
  FROM public.events event
  JOIN pg_catalog.pg_timezone_names zone ON zone.name = event.timezone
  WHERE event.brand_id = p_brand_id
    AND event.deleted_at IS NULL
    AND event.timezone <> 'UTC'
  ORDER BY event.published_at DESC NULLS LAST, event.created_at DESC
  LIMIT 1;
  IF v_zone IS NOT NULL THEN
    RETURN v_zone;
  END IF;

  RETURN 'UTC';
END
$function$;

REVOKE ALL ON FUNCTION public.offering_traffic_brand_timezone(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.offering_traffic_brand_timezone(uuid) TO service_role;

-- ── 3. Source rules (§2) ────────────────────────────────────────────────────
-- One classifier for page events. First match wins.
CREATE FUNCTION public.offering_traffic_event_source(
  p_brand_id uuid,
  p_surface text,
  p_mc_id text,
  p_referrer_host text,
  p_referrer_path text,
  p_has_mingla_share boolean,
  p_has_non_mingla_utm boolean
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_host text := lower(btrim(COALESCE(p_referrer_host, '')));
  v_path text := lower(COALESCE(p_referrer_path, ''));
  v_website text;
BEGIN
  v_host := regexp_replace(regexp_replace(v_host, '^www\.', ''), '\.$', '');

  -- 1. A Mingla-run (or host-via-Mingla) campaign.
  IF NULLIF(btrim(COALESCE(p_mc_id, '')), '') IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.ad_campaigns campaign
    WHERE campaign.external_campaign_id = btrim(p_mc_id)
       OR campaign.id::text = lower(btrim(p_mc_id))
  ) THEN
    RETURN 'mingla_ads';
  END IF;

  -- 2. The Mingla app, a Mingla discovery page or a Mingla share link.
  IF p_surface IN ('consumer_ios','consumer_android')
     OR COALESCE(p_has_mingla_share, false)
     OR (v_host = 'usemingla.com' AND (
          v_path LIKE '/explore%' OR v_path LIKE '/discover%' OR v_path LIKE '/share%'
        )) THEN
    RETURN 'mingla_app';
  END IF;

  -- 3. Search engines.
  IF v_host ~ '(^|\.)(google|bing|duckduckgo|yahoo|yandex|ecosia)\.' THEN
    RETURN 'search';
  END IF;

  -- 4. Social (including a host's own link-in-bio and a host's own ads run
  --    outside Mingla — no resolvable mc_id).
  IF v_host ~ '(^|\.)(instagram\.com|facebook\.com|fb\.me|fb\.com|tiktok\.com|x\.com|twitter\.com|t\.co|snapchat\.com|whatsapp\.com|wa\.me|linkedin\.com|lnkd\.in|youtube\.com|youtu\.be|threads\.net|threads\.com)$'
     OR v_host LIKE 'l.facebook.%' OR v_host LIKE 'lm.facebook.%' THEN
    RETURN 'social';
  END IF;

  -- 5. The host's own links: non-Mingla UTM tags, the brand's own website, or
  --    the brand's own Mingla Site.
  IF COALESCE(p_has_non_mingla_utm, false) THEN
    RETURN 'own_links';
  END IF;
  IF v_host <> '' THEN
    SELECT lower(substring(b.social_links ->> 'website'
             FROM '^(?:[a-zA-Z][a-zA-Z0-9+.-]*://)?(?:www\.)?([^/:?#]+)'))
      INTO v_website
    FROM public.brands b WHERE b.id = p_brand_id;
    IF v_website IS NOT NULL AND v_website = v_host THEN
      RETURN 'own_links';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.brand_site_hosts site_host
      JOIN public.brand_sites site ON site.id = site_host.site_id
      WHERE site.brand_id = p_brand_id
        AND site_host.hostname = v_host
        AND site_host.status = 'active'
    ) THEN
      RETURN 'own_links';
    END IF;
  END IF;

  -- 6. Anything else, including no referrer.
  RETURN 'direct_unknown';
END
$function$;

REVOKE ALL ON FUNCTION public.offering_traffic_event_source(uuid, text, text, text, text, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.offering_traffic_event_source(uuid, text, text, text, text, boolean, boolean)
  TO service_role;

-- Sales source (§2, bookings made before checkout-session source capture):
-- the existing ad_conversions -> ad_attribution_touches mapping, relabelled.
-- No conversion row = direct_unknown, never "organic".
CREATE FUNCTION public.offering_traffic_sale_source(
  p_has_conversion boolean,
  p_entry_source text,
  p_click_id text,
  p_touch_id uuid,
  p_campaign_id uuid
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN NOT COALESCE(p_has_conversion, false) THEN 'direct_unknown'
    WHEN p_entry_source = 'ad' THEN 'mingla_ads'
    WHEN p_entry_source = 'search' THEN 'search'
    WHEN p_entry_source = 'social' THEN 'social'
    WHEN p_entry_source = 'organic' THEN 'mingla_app'
    WHEN p_entry_source IN ('direct','unknown') THEN 'direct_unknown'
    WHEN p_click_id IS NOT NULL OR p_touch_id IS NOT NULL OR p_campaign_id IS NOT NULL
      THEN 'mingla_ads'
    ELSE 'direct_unknown'
  END;
$function$;

REVOKE ALL ON FUNCTION public.offering_traffic_sale_source(boolean, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.offering_traffic_sale_source(boolean, text, text, uuid, uuid)
  TO service_role;

-- ── 4. Salt (decision 2) ────────────────────────────────────────────────────
CREATE FUNCTION public.offering_engagement_claim_salt_at(
  p_brand_id uuid,
  p_candidate text,
  p_now timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tz text;
  v_day date;
  v_salt text;
BEGIN
  IF p_brand_id IS NULL OR p_candidate IS NULL OR p_candidate !~ '^[0-9a-f]{64}$' THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = p_brand_id AND b.deleted_at IS NULL) THEN
    RETURN NULL;
  END IF;
  v_tz := public.offering_traffic_brand_timezone(p_brand_id);
  v_day := (COALESCE(p_now, now()) AT TIME ZONE v_tz)::date;

  INSERT INTO public.offering_engagement_salts(brand_id, local_day, timezone, salt)
  VALUES (p_brand_id, v_day, v_tz, p_candidate)
  ON CONFLICT (brand_id, local_day) DO NOTHING;

  SELECT salt.salt INTO v_salt
  FROM public.offering_engagement_salts salt
  WHERE salt.brand_id = p_brand_id AND salt.local_day = v_day;
  RETURN v_salt;
END
$function$;

REVOKE ALL ON FUNCTION public.offering_engagement_claim_salt_at(uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.offering_engagement_claim_salt_at(uuid, text, timestamptz)
  TO service_role;

-- The edge function's entry point. The day is the brand's local day, so the
-- salt rotates at the brand's local midnight (decision 2).
CREATE FUNCTION public.claim_offering_engagement_salt(
  p_brand_id uuid,
  p_candidate text
)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT public.offering_engagement_claim_salt_at(p_brand_id, p_candidate, now());
$function$;

REVOKE ALL ON FUNCTION public.claim_offering_engagement_salt(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_offering_engagement_salt(uuid, text) TO service_role;

-- ── 5. Capture ──────────────────────────────────────────────────────────────
-- Returns the outcome for tests and logs; the edge function always answers 204.
CREATE FUNCTION public.offering_engagement_capture_at(
  p_event_id uuid,
  p_brand_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_event_type text,
  p_cta_type text,
  p_surface text,
  p_visitor_key text,
  p_checkout_session_id uuid,
  p_mc_id text,
  p_referrer_host text,
  p_referrer_path text,
  p_has_mingla_share boolean,
  p_has_non_mingla_utm boolean,
  p_now timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_now timestamptz := COALESCE(p_now, now());
  v_tz text;
  v_day date;
  v_source text;
  v_entity_key uuid;
  v_first_source text;
  v_inserted integer;
  v_is_visit boolean;
  v_page_views integer := 0;
  v_visitors integer := 0;
  v_impressions integer := 0;
  v_opens integer := 0;
  v_checkouts integer := 0;
BEGIN
  -- Shape (the table CHECKs repeat these; refuse before touching anything).
  IF p_event_id IS NULL OR p_brand_id IS NULL
     OR p_entity_type IS NULL
     OR p_entity_type NOT IN ('event','brand','trip','experience','venue')
     OR p_event_type IS NULL
     OR p_event_type NOT IN ('page_view','cta_click','checkout_start','app_impression','app_open')
     OR p_surface IS NULL
     OR p_surface NOT IN ('buyer_web','consumer_ios','consumer_android')
     OR p_visitor_key IS NULL OR p_visitor_key !~ '^[0-9a-f]{64}$'
     OR (p_entity_type = 'brand') <> (p_entity_id IS NULL)
     OR (p_event_type = 'cta_click') <> (p_cta_type IS NOT NULL)
     OR (p_cta_type IS NOT NULL AND p_cta_type NOT IN (
          'buy','book','rsvp','share','save','directions','website','call',
          'view_brand','view_venue','view_offering'))
     OR (p_event_type = 'checkout_start') <> (p_checkout_session_id IS NOT NULL) THEN
    RETURN 'invalid';
  END IF;

  -- The page must exist and belong to the brand the caller named.
  IF NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.id = p_brand_id AND b.deleted_at IS NULL) THEN
    RETURN 'unknown_page';
  END IF;
  IF p_entity_type = 'venue' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.venue_listings venue
      WHERE venue.id = p_entity_id AND venue.brand_id = p_brand_id
    ) THEN
      RETURN 'unknown_page';
    END IF;
  ELSIF p_entity_type IN ('event','trip','experience') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.events event
      WHERE event.id = p_entity_id
        AND event.brand_id = p_brand_id
        AND event.deleted_at IS NULL
        AND CASE p_entity_type
              WHEN 'event' THEN event.event_type IN ('event','rsvp')
              ELSE event.event_type = p_entity_type
            END
    ) THEN
      RETURN 'unknown_page';
    END IF;
  END IF;

  -- One visitor at a time: dedupe and the rate limit must not race.
  PERFORM pg_advisory_xact_lock(hashtextextended('issue_4037:' || p_visitor_key, 0));

  IF EXISTS (SELECT 1 FROM public.offering_engagement_events e WHERE e.id = p_event_id) THEN
    RETURN 'duplicate_event';
  END IF;

  -- Abuse: 120 recorded events per visitor_key per hour; the excess is dropped.
  IF (
    SELECT count(*) FROM public.offering_engagement_events e
    WHERE e.visitor_key = p_visitor_key AND e.occurred_at > v_now - interval '1 hour'
  ) >= 120 THEN
    RETURN 'rate_limited';
  END IF;

  -- Dedupe.
  IF p_event_type = 'page_view' AND EXISTS (
    SELECT 1 FROM public.offering_engagement_events e
    WHERE e.visitor_key = p_visitor_key
      AND e.brand_id = p_brand_id
      AND e.entity_type = p_entity_type
      AND e.entity_id IS NOT DISTINCT FROM p_entity_id
      AND e.event_type = 'page_view'
      AND e.occurred_at > v_now - interval '30 minutes'
  ) THEN
    RETURN 'duplicate_page_view';
  END IF;
  IF p_event_type = 'checkout_start' AND EXISTS (
    SELECT 1 FROM public.offering_engagement_events e
    WHERE e.event_type = 'checkout_start' AND e.checkout_session_id = p_checkout_session_id
  ) THEN
    RETURN 'duplicate_checkout';
  END IF;

  v_tz := public.offering_traffic_brand_timezone(p_brand_id);
  v_day := (v_now AT TIME ZONE v_tz)::date;
  v_entity_key := COALESCE(p_entity_id, p_brand_id);
  v_source := public.offering_traffic_event_source(
    p_brand_id, p_surface, p_mc_id, p_referrer_host, p_referrer_path,
    p_has_mingla_share, p_has_non_mingla_utm
  );

  IF p_event_type = 'app_impression' THEN
    INSERT INTO public.offering_engagement_visitor_marks(
      brand_id, mark, entity_key, brand_day, visitor_key, source
    ) VALUES (p_brand_id, 'app_impression', v_entity_key, v_day, p_visitor_key, v_source)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 0 THEN
      RETURN 'duplicate_impression';
    END IF;
    v_impressions := 1;
  END IF;

  INSERT INTO public.offering_engagement_events(
    id, brand_id, entity_type, entity_id, event_type, cta_type, source, surface,
    visitor_key, checkout_session_id, brand_day, timezone, occurred_at
  ) VALUES (
    p_event_id, p_brand_id, p_entity_type, p_entity_id, p_event_type, p_cta_type,
    v_source, p_surface, p_visitor_key, p_checkout_session_id, v_day, v_tz, v_now
  );

  -- A visit is a page view (buyer web) or an open (consumer app).
  v_is_visit := p_event_type IN ('page_view','app_open');
  v_page_views := CASE WHEN p_event_type = 'page_view' THEN 1 ELSE 0 END;
  v_opens := CASE WHEN p_event_type = 'app_open' THEN 1 ELSE 0 END;
  v_checkouts := CASE WHEN p_event_type = 'checkout_start' THEN 1 ELSE 0 END;

  IF v_is_visit THEN
    -- Page-level: each visitor once per page-day, under their first source.
    INSERT INTO public.offering_engagement_visitor_marks(
      brand_id, mark, entity_key, brand_day, visitor_key, source
    ) VALUES (p_brand_id, 'page_visit', v_entity_key, v_day, p_visitor_key, v_source)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_visitors := v_inserted;

    -- Brand-level (decision 6): once per brand-day, first-touch source.
    INSERT INTO public.offering_engagement_visitor_marks(
      brand_id, mark, entity_key, brand_day, visitor_key, source
    ) VALUES (p_brand_id, 'brand_visit', p_brand_id, v_day, p_visitor_key, v_source)
    ON CONFLICT DO NOTHING
    RETURNING source INTO v_first_source;
    IF v_first_source IS NOT NULL THEN
      INSERT INTO public.offering_engagement_brand_daily(brand_id, day, source, visitors)
      VALUES (p_brand_id, v_day, v_first_source, 1)
      ON CONFLICT (brand_id, day, source)
      DO UPDATE SET visitors = offering_engagement_brand_daily.visitors + 1,
                    updated_at = v_now;
    END IF;
  END IF;

  INSERT INTO public.offering_engagement_daily AS daily (
    brand_id, entity_type, entity_id, day, source,
    page_views, visitors,
    cta_buy, cta_book, cta_rsvp, cta_share, cta_save, cta_directions,
    cta_website, cta_call, cta_view_brand, cta_view_venue, cta_view_offering,
    checkout_starts, app_impressions, app_opens, updated_at
  ) VALUES (
    p_brand_id, p_entity_type, p_entity_id, v_day, v_source,
    v_page_views, v_visitors,
    (p_cta_type IS NOT DISTINCT FROM 'buy')::int, (p_cta_type IS NOT DISTINCT FROM 'book')::int,
    (p_cta_type IS NOT DISTINCT FROM 'rsvp')::int, (p_cta_type IS NOT DISTINCT FROM 'share')::int,
    (p_cta_type IS NOT DISTINCT FROM 'save')::int, (p_cta_type IS NOT DISTINCT FROM 'directions')::int,
    (p_cta_type IS NOT DISTINCT FROM 'website')::int, (p_cta_type IS NOT DISTINCT FROM 'call')::int,
    (p_cta_type IS NOT DISTINCT FROM 'view_brand')::int, (p_cta_type IS NOT DISTINCT FROM 'view_venue')::int,
    (p_cta_type IS NOT DISTINCT FROM 'view_offering')::int,
    v_checkouts, v_impressions, v_opens, v_now
  )
  ON CONFLICT ON CONSTRAINT offering_engagement_daily_bucket_key
  DO UPDATE SET
    page_views = daily.page_views + EXCLUDED.page_views,
    visitors = daily.visitors + EXCLUDED.visitors,
    cta_buy = daily.cta_buy + EXCLUDED.cta_buy,
    cta_book = daily.cta_book + EXCLUDED.cta_book,
    cta_rsvp = daily.cta_rsvp + EXCLUDED.cta_rsvp,
    cta_share = daily.cta_share + EXCLUDED.cta_share,
    cta_save = daily.cta_save + EXCLUDED.cta_save,
    cta_directions = daily.cta_directions + EXCLUDED.cta_directions,
    cta_website = daily.cta_website + EXCLUDED.cta_website,
    cta_call = daily.cta_call + EXCLUDED.cta_call,
    cta_view_brand = daily.cta_view_brand + EXCLUDED.cta_view_brand,
    cta_view_venue = daily.cta_view_venue + EXCLUDED.cta_view_venue,
    cta_view_offering = daily.cta_view_offering + EXCLUDED.cta_view_offering,
    checkout_starts = daily.checkout_starts + EXCLUDED.checkout_starts,
    app_impressions = daily.app_impressions + EXCLUDED.app_impressions,
    app_opens = daily.app_opens + EXCLUDED.app_opens,
    updated_at = v_now;

  RETURN 'counted';
END
$function$;

REVOKE ALL ON FUNCTION public.offering_engagement_capture_at(
  uuid, uuid, text, uuid, text, text, text, text, uuid, text, text, text, boolean, boolean, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.offering_engagement_capture_at(
  uuid, uuid, text, uuid, text, text, text, text, uuid, text, text, text, boolean, boolean, timestamptz
) TO service_role;

-- The edge function's entry point: the same capture at the database clock.
CREATE FUNCTION public.capture_offering_engagement_event(
  p_event_id uuid,
  p_brand_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_event_type text,
  p_cta_type text,
  p_surface text,
  p_visitor_key text,
  p_checkout_session_id uuid,
  p_mc_id text,
  p_referrer_host text,
  p_referrer_path text,
  p_has_mingla_share boolean,
  p_has_non_mingla_utm boolean
)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT public.offering_engagement_capture_at(
    p_event_id, p_brand_id, p_entity_type, p_entity_id, p_event_type, p_cta_type,
    p_surface, p_visitor_key, p_checkout_session_id, p_mc_id, p_referrer_host,
    p_referrer_path, p_has_mingla_share, p_has_non_mingla_utm, now()
  );
$function$;

REVOKE ALL ON FUNCTION public.capture_offering_engagement_event(
  uuid, uuid, text, uuid, text, text, text, text, uuid, text, text, text, boolean, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_offering_engagement_event(
  uuid, uuid, text, uuid, text, text, text, text, uuid, text, text, text, boolean, boolean
) TO service_role;

-- ── 6. Rollups ──────────────────────────────────────────────────────────────
-- Internal: one period of totals/sources/ctas/daily (and pages for brand scope)
-- for either the whole brand (p_entity_type IS NULL) or one page.
CREATE FUNCTION public.offering_traffic_period(
  p_brand_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_from date,
  p_to date,
  p_tz text,
  p_default_ccy text,
  p_with_pages boolean
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
  v_brand_scope boolean := p_entity_type IS NULL;
BEGIN
  WITH traffic AS MATERIALIZED (
    SELECT daily.*,
      daily.cta_buy + daily.cta_book + daily.cta_rsvp + daily.cta_share
        + daily.cta_save + daily.cta_directions + daily.cta_website
        + daily.cta_call + daily.cta_view_brand + daily.cta_view_venue
        + daily.cta_view_offering AS cta_total
    FROM public.offering_engagement_daily daily
    WHERE daily.brand_id = p_brand_id
      AND (p_from IS NULL OR daily.day >= p_from)
      AND daily.day <= p_to
      AND (v_brand_scope OR (
        daily.entity_type = p_entity_type
        AND daily.entity_id IS NOT DISTINCT FROM p_entity_id
      ))
  ),
  brand_visitors AS (
    SELECT bd.source, sum(bd.visitors)::bigint AS visitors
    FROM public.offering_engagement_brand_daily bd
    WHERE v_brand_scope
      AND bd.brand_id = p_brand_id
      AND (p_from IS NULL OR bd.day >= p_from)
      AND bd.day <= p_to
    GROUP BY bd.source
  ),
  source_visitors AS (
    SELECT source, visitors FROM brand_visitors WHERE v_brand_scope
    UNION ALL
    SELECT traffic.source, sum(traffic.visitors)::bigint
    FROM traffic WHERE NOT v_brand_scope GROUP BY traffic.source
  ),
  spine_raw AS (
    -- Paid or partly refunded online-checkout orders (events, trips, experiences).
    SELECT
      CASE e.event_type WHEN 'trip' THEN 'trip' WHEN 'experience' THEN 'experience'
        ELSE 'event' END AS entity_type,
      e.id AS entity_id,
      COALESCE(NULLIF(lower(btrim(o.buyer_email)), ''), o.buyer_phone_e164, 'o:' || o.id::text) AS customer_key,
      (COALESCE(o.confirmed_at, o.created_at) AT TIME ZONE p_tz)::date AS local_day,
      COALESCE(NULLIF(btrim(upper(o.currency)), ''), p_default_ccy) AS ccy,
      GREATEST(o.total_cents - COALESCE(o.refunded_amount_cents, 0), 0)::bigint AS value_cents,
      public.offering_traffic_sale_source(conv.id IS NOT NULL, conv.entry_source,
        conv.click_id, conv.touch_id, conv.campaign_id) AS source
    FROM public.orders o
    JOIN public.events e
      ON e.id = o.event_id AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT c.id, c.click_id, c.touch_id, c.campaign_id, t.entry_source
      FROM public.ad_conversions c
      LEFT JOIN public.ad_attribution_touches t ON t.id = c.touch_id
      WHERE c.order_id = o.id
      ORDER BY c.created_at DESC
      LIMIT 1
    ) conv ON true
    WHERE o.payment_status IN ('paid', 'partial_refund')
      AND o.source = 'online_checkout'

    UNION ALL

    -- Mingla venue reservations that are not cancelled.
    SELECT
      'venue', r.venue_id,
      COALESCE(NULLIF(lower(btrim(r.guest_email)), ''), r.guest_phone_e164, 'r:' || r.id::text),
      (r.created_at AT TIME ZONE p_tz)::date,
      COALESCE(NULLIF(btrim(upper(r.fee_currency::text)), ''), p_default_ccy),
      (CASE WHEN r.payment_status = 'paid' THEN COALESCE(r.fee_cents, 0) ELSE 0 END)::bigint,
      public.offering_traffic_sale_source(conv.id IS NOT NULL, conv.entry_source,
        conv.click_id, conv.touch_id, conv.campaign_id)
    FROM public.reservations r
    LEFT JOIN LATERAL (
      SELECT c.id, c.click_id, c.touch_id, c.campaign_id, t.entry_source
      FROM public.ad_conversions c
      LEFT JOIN public.ad_attribution_touches t ON t.id = c.touch_id
      WHERE c.event_id = r.id::text
      ORDER BY c.created_at DESC
      LIMIT 1
    ) conv ON true
    WHERE r.brand_id = p_brand_id
      AND r.source = 'mingla'
      AND r.status NOT IN ('cancelled_by_guest', 'cancelled_by_venue')

    UNION ALL

    -- Going and approved RSVPs (free, count only).
    SELECT
      'event', e.id,
      COALESCE(NULLIF(lower(btrim(er.guest_email)), ''), er.guest_phone, 'e:' || er.id::text),
      (er.created_at AT TIME ZONE p_tz)::date,
      p_default_ccy,
      0::bigint,
      public.offering_traffic_sale_source(conv.id IS NOT NULL, conv.entry_source,
        conv.click_id, conv.touch_id, conv.campaign_id)
    FROM public.event_rsvps er
    JOIN public.events e
      ON e.id = er.event_id AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
     AND e.event_type = 'rsvp'
    LEFT JOIN LATERAL (
      SELECT c.id, c.click_id, c.touch_id, c.campaign_id, t.entry_source
      FROM public.ad_conversions c
      LEFT JOIN public.ad_attribution_touches t ON t.id = c.touch_id
      WHERE c.event_id = er.id::text
      ORDER BY c.created_at DESC
      LIMIT 1
    ) conv ON true
    WHERE er.rsvp_status = 'going' AND er.approval_status = 'approved'
  ),
  spine AS MATERIALIZED (
    SELECT * FROM spine_raw s
    WHERE (p_from IS NULL OR s.local_day >= p_from)
      AND s.local_day <= p_to
      AND (v_brand_scope OR (
        s.entity_type = p_entity_type AND s.entity_id IS NOT DISTINCT FROM p_entity_id
      ))
  ),
  all_value AS (
    SELECT ccy, sum(value_cents)::bigint AS cents
    FROM spine GROUP BY ccy HAVING sum(value_cents) > 0
  ),
  mingla_value AS (
    SELECT ccy, sum(value_cents)::bigint AS cents
    FROM spine WHERE source IN ('mingla_app','mingla_ads','search')
    GROUP BY ccy HAVING sum(value_cents) > 0
  ),
  source_value AS (
    SELECT source, ccy, sum(value_cents)::bigint AS cents
    FROM spine GROUP BY source, ccy HAVING sum(value_cents) > 0
  ),
  sources AS (
    SELECT s.ord, s.source,
      COALESCE((SELECT sv.visitors FROM source_visitors sv WHERE sv.source = s.source), 0) AS visitors,
      (SELECT count(*) FROM spine WHERE spine.source = s.source)::bigint AS bookings,
      COALESCE((SELECT jsonb_object_agg(v.ccy, v.cents ORDER BY v.ccy)
        FROM source_value v WHERE v.source = s.source), '{}'::jsonb) AS value_by_currency
    FROM (VALUES (1,'mingla_app'),(2,'mingla_ads'),(3,'search'),
                 (4,'social'),(5,'own_links'),(6,'direct_unknown')) AS s(ord, source)
  ),
  cta_sums AS (
    SELECT
      COALESCE(sum(cta_buy),0)::bigint AS buy, COALESCE(sum(cta_book),0)::bigint AS book,
      COALESCE(sum(cta_rsvp),0)::bigint AS rsvp, COALESCE(sum(cta_share),0)::bigint AS share,
      COALESCE(sum(cta_save),0)::bigint AS save, COALESCE(sum(cta_directions),0)::bigint AS directions,
      COALESCE(sum(cta_website),0)::bigint AS website, COALESCE(sum(cta_call),0)::bigint AS call,
      COALESCE(sum(cta_view_brand),0)::bigint AS view_brand,
      COALESCE(sum(cta_view_venue),0)::bigint AS view_venue,
      COALESCE(sum(cta_view_offering),0)::bigint AS view_offering,
      COALESCE(sum(page_views),0)::bigint AS page_views,
      COALESCE(sum(cta_total),0)::bigint AS button_taps,
      COALESCE(sum(checkout_starts),0)::bigint AS checkout_starts
    FROM traffic
  ),
  days AS (
    -- Every day of the range; "All time" starts the day capture started.
    SELECT gs::date AS day
    FROM generate_series(
      LEAST(
        COALESCE(p_from, (
          SELECT (config.capture_started_at AT TIME ZONE p_tz)::date
          FROM public.offering_engagement_capture_config config
          WHERE config.singleton
        ), p_to),
        COALESCE((SELECT min(day) FROM traffic), p_to),
        p_to),
      p_to, interval '1 day') gs
  ),
  daily_series AS (
    SELECT days.day, COALESCE(sum(traffic.page_views), 0)::bigint AS page_views
    FROM days LEFT JOIN traffic ON traffic.day = days.day
    GROUP BY days.day
  ),
  pages AS (
    SELECT keys.entity_type, keys.entity_id,
      CASE keys.entity_type
        WHEN 'brand' THEN (SELECT b.name FROM public.brands b WHERE b.id = p_brand_id)
        WHEN 'venue' THEN (SELECT v.name FROM public.venue_listings v WHERE v.id = keys.entity_id)
        ELSE (SELECT e.title FROM public.events e WHERE e.id = keys.entity_id)
      END AS title,
      COALESCE((SELECT sum(t.page_views) FROM traffic t
        WHERE t.entity_type = keys.entity_type
          AND t.entity_id IS NOT DISTINCT FROM keys.entity_id), 0)::bigint AS page_views,
      COALESCE((SELECT sum(t.visitors) FROM traffic t
        WHERE t.entity_type = keys.entity_type
          AND t.entity_id IS NOT DISTINCT FROM keys.entity_id), 0)::bigint AS visitors,
      COALESCE((SELECT sum(t.cta_total) FROM traffic t
        WHERE t.entity_type = keys.entity_type
          AND t.entity_id IS NOT DISTINCT FROM keys.entity_id), 0)::bigint AS cta_total,
      COALESCE((SELECT sum(t.checkout_starts) FROM traffic t
        WHERE t.entity_type = keys.entity_type
          AND t.entity_id IS NOT DISTINCT FROM keys.entity_id), 0)::bigint AS checkout_starts,
      (SELECT count(*) FROM spine s
        WHERE s.entity_type = keys.entity_type AND s.entity_id = keys.entity_id)::bigint AS bookings,
      COALESCE((SELECT jsonb_object_agg(pv.ccy, pv.cents ORDER BY pv.ccy) FROM (
        SELECT s.ccy, sum(s.value_cents)::bigint AS cents FROM spine s
        WHERE s.entity_type = keys.entity_type AND s.entity_id = keys.entity_id
        GROUP BY s.ccy HAVING sum(s.value_cents) > 0) pv), '{}'::jsonb) AS value_by_currency
    FROM (
      SELECT 'brand'::text AS entity_type, NULL::uuid AS entity_id
      UNION
      SELECT t.entity_type, t.entity_id FROM traffic t WHERE t.entity_type <> 'brand'
      UNION
      SELECT s.entity_type, s.entity_id FROM spine s WHERE s.entity_id IS NOT NULL
    ) keys
    WHERE p_with_pages
  )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'page_views', cta_sums.page_views,
      'visitors', (SELECT COALESCE(sum(visitors), 0)::bigint FROM source_visitors),
      'button_taps', cta_sums.button_taps,
      'checkout_starts', cta_sums.checkout_starts,
      'bookings', (SELECT count(*)::bigint FROM spine),
      'customers', (SELECT count(DISTINCT customer_key)::bigint FROM spine),
      'mingla_customers', (SELECT count(DISTINCT customer_key)::bigint FROM spine
        WHERE source IN ('mingla_app','mingla_ads','search')),
      'mingla_visitors', (SELECT COALESCE(sum(visitors), 0)::bigint FROM source_visitors
        WHERE source IN ('mingla_app','mingla_ads','search')),
      'booking_value', COALESCE((SELECT jsonb_object_agg(ccy, cents ORDER BY ccy) FROM all_value), '{}'::jsonb),
      'value_mingla_brought', COALESCE((SELECT jsonb_object_agg(ccy, cents ORDER BY ccy) FROM mingla_value), '{}'::jsonb),
      'primary_currency', COALESCE(
        (SELECT ccy FROM all_value ORDER BY cents DESC, ccy LIMIT 1), p_default_ccy)
    ),
    'daily', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'day', to_char(ds.day, 'YYYY-MM-DD'), 'page_views', ds.page_views) ORDER BY ds.day)
      FROM daily_series ds), '[]'::jsonb),
    'sources', (SELECT jsonb_agg(jsonb_build_object(
        'source', s.source, 'visitors', s.visitors, 'bookings', s.bookings,
        'value_by_currency', s.value_by_currency) ORDER BY s.ord) FROM sources s),
    'ctas', jsonb_build_array(
      jsonb_build_object('type','buy','count',cta_sums.buy),
      jsonb_build_object('type','book','count',cta_sums.book),
      jsonb_build_object('type','rsvp','count',cta_sums.rsvp),
      jsonb_build_object('type','share','count',cta_sums.share),
      jsonb_build_object('type','save','count',cta_sums.save),
      jsonb_build_object('type','directions','count',cta_sums.directions),
      jsonb_build_object('type','website','count',cta_sums.website),
      jsonb_build_object('type','call','count',cta_sums.call),
      jsonb_build_object('type','view_brand','count',cta_sums.view_brand),
      jsonb_build_object('type','view_venue','count',cta_sums.view_venue),
      jsonb_build_object('type','view_offering','count',cta_sums.view_offering)
    ),
    'pages', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'entity_type', p.entity_type, 'entity_id', p.entity_id, 'title', btrim(p.title),
        'page_views', p.page_views, 'visitors', p.visitors, 'cta_total', p.cta_total,
        'checkout_starts', p.checkout_starts, 'bookings', p.bookings,
        'value_by_currency', p.value_by_currency)
      ORDER BY p.page_views DESC, p.bookings DESC, p.entity_type = 'brand' DESC,
               lower(btrim(p.title)), p.entity_id)
      FROM pages p WHERE NULLIF(btrim(p.title), '') IS NOT NULL), '[]'::jsonb)
  )
  INTO v_result
  FROM cta_sums;

  RETURN v_result;
END
$function$;

REVOKE ALL ON FUNCTION public.offering_traffic_period(uuid, text, uuid, date, date, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.offering_traffic_period(uuid, text, uuid, date, date, text, text, boolean)
  TO service_role;

-- Internal: the shared envelope for both public rollups.
CREATE FUNCTION public.offering_traffic_rollup_envelope(
  p_brand_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_range text,
  p_authorized boolean
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tz text;
  v_today date;
  v_days integer;
  v_from date;
  v_prior_from date;
  v_prior_to date;
  v_capture timestamptz;
  v_default_ccy text;
  v_current jsonb;
  v_prior jsonb;
  v_empty_totals jsonb := jsonb_build_object(
    'page_views', 0, 'visitors', 0, 'button_taps', 0, 'checkout_starts', 0,
    'bookings', 0, 'customers', 0, 'mingla_customers', 0, 'mingla_visitors', 0,
    'booking_value', '{}'::jsonb, 'value_mingla_brought', '{}'::jsonb,
    'primary_currency', NULL
  );
BEGIN
  v_days := CASE p_range WHEN '7d' THEN 7 WHEN '30d' THEN 30 WHEN '90d' THEN 90
    WHEN 'all' THEN 0 ELSE NULL END;
  IF v_days IS NULL THEN
    RAISE EXCEPTION 'issue_4037_invalid_range' USING ERRCODE = '22023';
  END IF;

  IF NOT p_authorized THEN
    RETURN jsonb_build_object(
      'authorized', false, 'range', p_range,
      'totals', v_empty_totals, 'prior', v_empty_totals,
      'daily', '[]'::jsonb, 'sources', '[]'::jsonb, 'ctas', '[]'::jsonb,
      'pages', '[]'::jsonb,
      'capture_started_at', NULL, 'window_complete', false
    );
  END IF;

  v_tz := public.offering_traffic_brand_timezone(p_brand_id);
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT config.capture_started_at INTO v_capture
  FROM public.offering_engagement_capture_config config WHERE config.singleton;
  SELECT COALESCE(NULLIF(btrim(upper(b.default_currency)), ''), 'GBP') INTO v_default_ccy
  FROM public.brands b WHERE b.id = p_brand_id;
  v_default_ccy := COALESCE(v_default_ccy, 'GBP');

  IF v_days = 0 THEN
    v_from := NULL;
  ELSE
    v_from := v_today - (v_days - 1);
    v_prior_to := v_from - 1;
    v_prior_from := v_from - v_days;
  END IF;

  v_current := public.offering_traffic_period(
    p_brand_id, p_entity_type, p_entity_id, v_from, v_today, v_tz, v_default_ccy,
    p_entity_type IS NULL
  );
  IF v_days = 0 THEN
    v_prior := jsonb_build_object('totals',
      v_empty_totals || jsonb_build_object('primary_currency', v_default_ccy));
  ELSE
    v_prior := public.offering_traffic_period(
      p_brand_id, p_entity_type, p_entity_id, v_prior_from, v_prior_to, v_tz,
      v_default_ccy, false
    );
  END IF;

  RETURN jsonb_build_object(
    'authorized', true,
    'range', p_range,
    'totals', v_current -> 'totals',
    'prior', v_prior -> 'totals',
    'daily', v_current -> 'daily',
    'sources', v_current -> 'sources',
    'ctas', v_current -> 'ctas',
    'pages', v_current -> 'pages',
    'capture_started_at', v_capture,
    'window_complete', v_days = 0
      OR (v_capture AT TIME ZONE v_tz)::date <= v_from,
    'timezone', v_tz
  );
END
$function$;

REVOKE ALL ON FUNCTION public.offering_traffic_rollup_envelope(uuid, text, uuid, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.offering_traffic_rollup_envelope(uuid, text, uuid, text, boolean)
  TO service_role;

CREATE FUNCTION public.brand_traffic_rollup(p_brand_id uuid, p_range text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_authorized boolean;
BEGIN
  IF p_brand_id IS NULL THEN
    RAISE EXCEPTION 'issue_4037_brand_required' USING ERRCODE = '22023';
  END IF;
  v_authorized := EXISTS (SELECT 1 FROM public.brands b WHERE b.id = p_brand_id AND b.deleted_at IS NULL)
    AND (public.is_admin_user() OR public.biz_is_brand_member_for_read_for_caller(p_brand_id));
  RETURN jsonb_build_object('brand_id', p_brand_id)
    || public.offering_traffic_rollup_envelope(p_brand_id, NULL, NULL, p_range, v_authorized);
END
$function$;

REVOKE ALL ON FUNCTION public.brand_traffic_rollup(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_traffic_rollup(uuid, text) TO authenticated, service_role;

-- Decision 4: brand_id is part of every page request. A non-brand page must
-- belong to that brand, and the caller must be an admin or a brand member.
CREATE FUNCTION public.entity_traffic_rollup(
  p_brand_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_range text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_belongs boolean;
  v_authorized boolean;
  v_envelope jsonb;
BEGIN
  IF p_brand_id IS NULL
     OR p_entity_type IS NULL
     OR p_entity_type NOT IN ('event','brand','trip','experience','venue')
     OR (p_entity_type = 'brand') <> (p_entity_id IS NULL) THEN
    RAISE EXCEPTION 'issue_4037_invalid_page' USING ERRCODE = '22023';
  END IF;

  v_belongs := EXISTS (SELECT 1 FROM public.brands b WHERE b.id = p_brand_id AND b.deleted_at IS NULL)
    AND CASE p_entity_type
      WHEN 'brand' THEN true
      WHEN 'venue' THEN EXISTS (
        SELECT 1 FROM public.venue_listings venue
        WHERE venue.id = p_entity_id AND venue.brand_id = p_brand_id)
      ELSE EXISTS (
        SELECT 1 FROM public.events event
        WHERE event.id = p_entity_id AND event.brand_id = p_brand_id
          AND CASE p_entity_type
                WHEN 'event' THEN event.event_type IN ('event','rsvp')
                ELSE event.event_type = p_entity_type
              END)
    END;
  v_authorized := v_belongs
    AND (public.is_admin_user() OR public.biz_is_brand_member_for_read_for_caller(p_brand_id));

  v_envelope := public.offering_traffic_rollup_envelope(
    p_brand_id, p_entity_type, p_entity_id, p_range, v_authorized
  ) - 'pages';
  RETURN jsonb_build_object(
    'brand_id', p_brand_id,
    'entity_type', p_entity_type,
    'entity_id', p_entity_id
  ) || v_envelope;
END
$function$;

REVOKE ALL ON FUNCTION public.entity_traffic_rollup(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entity_traffic_rollup(uuid, text, uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.brand_traffic_rollup(uuid, text) IS
  'Issue #4037: brand-wide host traffic for 7d/30d/90d/all in the brand timezone. Visitors are deduped once per brand-day with first-touch source credit (decision 6). Bookings, customers and value come only from completed orders, reservations and RSVPs (decision 5). Admin or brand member; otherwise an honest authorized:false empty result.';
COMMENT ON FUNCTION public.entity_traffic_rollup(uuid, text, uuid, text) IS
  'Issue #4037: one page''s traffic (brand page included, entity_id NULL). p_brand_id is required; a non-brand page must belong to that brand and the caller must be an admin or brand member (decision 4), otherwise an honest authorized:false empty result.';

-- ── 7. Retention ────────────────────────────────────────────────────────────
CREATE FUNCTION public.cleanup_offering_engagement(p_limit integer DEFAULT 5000)
RETURNS TABLE(events_deleted bigint, marks_deleted bigint, salts_deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_events bigint := 0;
  v_marks bigint := 0;
  v_salts bigint := 0;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 20000);
BEGIN
  WITH doomed AS (
    SELECT id FROM public.offering_engagement_events
    WHERE occurred_at < now() - interval '35 days'
    ORDER BY occurred_at LIMIT v_limit
  )
  DELETE FROM public.offering_engagement_events event
  USING doomed WHERE event.id = doomed.id;
  GET DIAGNOSTICS v_events = ROW_COUNT;

  WITH doomed AS (
    SELECT brand_id, mark, entity_key, brand_day, visitor_key
    FROM public.offering_engagement_visitor_marks
    WHERE created_at < now() - interval '3 days'
    ORDER BY created_at LIMIT v_limit
  )
  DELETE FROM public.offering_engagement_visitor_marks mark
  USING doomed
  WHERE mark.brand_id = doomed.brand_id AND mark.mark = doomed.mark
    AND mark.entity_key = doomed.entity_key AND mark.brand_day = doomed.brand_day
    AND mark.visitor_key = doomed.visitor_key;
  GET DIAGNOSTICS v_marks = ROW_COUNT;

  DELETE FROM public.offering_engagement_salts
  WHERE created_at < now() - interval '48 hours';
  GET DIAGNOSTICS v_salts = ROW_COUNT;

  RETURN QUERY SELECT v_events, v_marks, v_salts;
END
$function$;

REVOKE ALL ON FUNCTION public.cleanup_offering_engagement(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_offering_engagement(integer) TO service_role;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'issue_4037_offering_engagement_retention') THEN
    PERFORM cron.unschedule('issue_4037_offering_engagement_retention');
  END IF;
END
$cron$;
SELECT cron.schedule(
  'issue_4037_offering_engagement_retention',
  '23 * * * *',
  $job$SELECT public.cleanup_offering_engagement(20000);$job$
);

DO $assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'issue_4037_offering_engagement_retention'
      AND active
      AND schedule = '23 * * * *'
      AND command = 'SELECT public.cleanup_offering_engagement(20000);'
  ) THEN
    RAISE EXCEPTION 'issue_4037_retention_schedule_invalid';
  END IF;
END
$assert$;

COMMIT;
