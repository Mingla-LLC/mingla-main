-- Issue #4339 round A (Seth approved, 8 Nov 2026) — every confirmed "Book a
-- call" booking (usemingla.com/schedule → growth-tools-book) shows up in Mingla
-- Admin's Inbound leads (#/inbound) as a third kind beside the beta form and
-- the web free tools, and "Add to Hosts" turns it into a host card.
--
--   1. public.book_call_leads — one row per confirmed booking. Written ONLY by
--      the growth-tools-book edge function with the service role, after the
--      calendar event exists. `booking_key` is unique ("gcal:<event id>"), so a
--      retried write of the same booking is a no-op (ON CONFLICT DO NOTHING
--      through PostgREST's on_conflict). RLS on with ZERO policies: anon and
--      signed-in clients can neither read nor write it.
--   2. admin_inbound_leads(p_show_test, p_limit) — the #4130 union gains a
--      `book_a_call` kind. Each row carries the business (the venue, else the
--      booker's name), the ICP, the social as its working profile link, the
--      website, the call time and the source. Seen by whoever sees beta leads
--      (owner/admin or the beta_leads area). Signature, return type and grants
--      are unchanged; still never returns an email address.
--   3. admin_book_call_lead_get(p_id) — the one booking's email and social for
--      "Add to Hosts" (the same role admin_tool_lead_get plays for tool
--      leads). Signed-in only, guard first: owner/admin or the beta_leads area.
--      Never executable by anon.
--
--   4. (#4339 Creators and Locals calls, Seth approved 9 Nov) every booking
--      carries its `audience`: host (the /schedule form, the default),
--      creator (/schedule/creators) or local (/schedule/locals). A Host call
--      has its ICP; a Creator call its city and what they make (video, photo
--      or both) and an optional work link; a Local call its city and an
--      optional first place. Every row may carry the booker's IANA time zone
--      and the Meet and calendar links. Inbound leads exposes the audience
--      (and only a Host call is matched to a host card), and
--   5. admin_calendar_calls(p_from, p_to, p_show_test) — the admin Calendar's
--      calls layer: every booked call (Host, Creator and Local) whose call_at
--      falls in the range, with what the panel shows. Same access rule as
--      Inbound leads and admin_book_call_lead_get. There is no cancel or move
--      path today (growth-tools-book only creates events, and nothing reads
--      Google Calendar changes back), so every call's status is 'booked'.
--
-- No dynamic SQL, no 40001: a conflict is the unique key, answered by DO
-- NOTHING. Additive: one table, one replaced function (same signature), two
-- new functions. NOT applied here.
--
-- Invariant (declared in the pg17 test): I-4339-BOOK-A-CALL-IS-AN-INBOUND-LEAD
-- | issue #4339 | a confirmed booking is listed once in Inbound leads as
-- book_a_call, with its ICP, social link, website and call time; clients can
-- never read the table directly.
--
-- ROLLBACK (manual): restore admin_inbound_leads from
-- 20280114004130_issue_4130_dashboard_outreach_inbound.sql, then
--   DROP FUNCTION IF EXISTS public.admin_calendar_calls(timestamptz, timestamptz, boolean);
--   DROP FUNCTION IF EXISTS public.admin_book_call_lead_get(uuid);
--   DROP TABLE IF EXISTS public.book_call_leads;

--------------------------------------------------------------------------------
-- 1. The bookings
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.book_call_leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_key       text NOT NULL,
  calendar_event_id text,
  audience          text NOT NULL DEFAULT 'host',
  name              text NOT NULL,
  email             text NOT NULL,
  venue             text,
  icp               text,
  city              text,
  creator_makes     text,
  work_url          text,
  first_place       text,
  social_platform   text NOT NULL,
  social_handle     text,
  social_url        text NOT NULL,
  website           text,
  call_at           timestamptz NOT NULL,
  booker_time_zone  text,
  meet_url          text,
  event_url         text,
  source            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT book_call_leads_booking_key_key UNIQUE (booking_key),
  CONSTRAINT book_call_leads_booking_key_check CHECK (length(booking_key) BETWEEN 3 AND 300),
  CONSTRAINT book_call_leads_name_check CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  CONSTRAINT book_call_leads_email_check CHECK (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' AND length(email) <= 254),
  CONSTRAINT book_call_leads_venue_check CHECK (venue IS NULL OR length(venue) <= 120),
  CONSTRAINT book_call_leads_audience_check CHECK (audience IN ('host', 'creator', 'local')),
  CONSTRAINT book_call_leads_icp_check CHECK (icp IN ('events', 'trips', 'experiences', 'restaurants', 'hotels', 'art', 'play', 'other')),
  -- A Host call has its ICP; a Creators or Locals call has a city and no ICP.
  CONSTRAINT book_call_leads_audience_fields_check CHECK (
    CASE audience
      WHEN 'host' THEN icp IS NOT NULL AND creator_makes IS NULL AND work_url IS NULL AND first_place IS NULL
      WHEN 'creator' THEN icp IS NULL AND city IS NOT NULL AND creator_makes IS NOT NULL AND first_place IS NULL
      ELSE icp IS NULL AND city IS NOT NULL AND creator_makes IS NULL AND work_url IS NULL
    END),
  CONSTRAINT book_call_leads_city_check CHECK (city IS NULL OR length(btrim(city)) BETWEEN 2 AND 80),
  CONSTRAINT book_call_leads_creator_makes_check CHECK (creator_makes IS NULL OR creator_makes IN ('video', 'photo', 'both')),
  CONSTRAINT book_call_leads_work_url_check CHECK (work_url IS NULL OR (work_url ~ '^https?://' AND length(work_url) <= 300)),
  CONSTRAINT book_call_leads_first_place_check CHECK (first_place IS NULL OR length(first_place) <= 120),
  CONSTRAINT book_call_leads_booker_time_zone_check CHECK (booker_time_zone IS NULL OR length(booker_time_zone) <= 64),
  CONSTRAINT book_call_leads_meet_url_check CHECK (meet_url IS NULL OR (meet_url ~ '^https://' AND length(meet_url) <= 500)),
  CONSTRAINT book_call_leads_event_url_check CHECK (event_url IS NULL OR (event_url ~ '^https://' AND length(event_url) <= 500)),
  CONSTRAINT book_call_leads_social_platform_check CHECK (social_platform IN ('instagram', 'tiktok', 'facebook', 'x', 'youtube', 'linkedin')),
  CONSTRAINT book_call_leads_social_url_check CHECK (social_url ~ '^https://' AND length(social_url) <= 300),
  CONSTRAINT book_call_leads_website_check CHECK (website IS NULL OR (website ~ '^https?://' AND length(website) <= 300)),
  CONSTRAINT book_call_leads_source_check CHECK (source IS NULL OR length(source) <= 40)
);
COMMENT ON TABLE public.book_call_leads IS
  'Issue #4339: one row per confirmed usemingla.com/schedule booking (growth-tools-book, service role, idempotent on booking_key). Listed in Inbound leads as book_a_call. RLS on, no policies: no client reads or writes it.';
COMMENT ON COLUMN public.book_call_leads.booking_key IS
  'Issue #4339: "gcal:<Google Calendar event id>" (else "slot:<start>:<email hash>"). Unique, so a retried write of one booking adds nothing.';

ALTER TABLE public.book_call_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.book_call_leads FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.book_call_leads TO service_role;

CREATE INDEX IF NOT EXISTS idx_book_call_leads_created_at ON public.book_call_leads (created_at DESC);
-- The Calendar reads calls by when they happen.
CREATE INDEX IF NOT EXISTS idx_book_call_leads_call_at ON public.book_call_leads (call_at);
COMMENT ON COLUMN public.book_call_leads.audience IS
  'Issue #4339: host (usemingla.com/schedule), creator (/schedule/creators) or local (/schedule/locals).';

--------------------------------------------------------------------------------
-- 2. Inbound leads: the #4130 union with a third kind
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_inbound_leads(
  p_show_test boolean DEFAULT false,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tools boolean;
  v_beta  boolean;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
  v_out   jsonb;
BEGIN
  IF NOT (public.is_admin_user() OR COALESCE(public.admin_team_can('beta_leads'), false)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  -- Each half only to whoever could open its old page; bookings go with beta.
  v_tools := public.is_admin_user();
  v_beta  := v_tools OR COALESCE(public.admin_team_can('beta_leads'), false);

  WITH leads AS MATERIALIZED (
    SELECT b.id, 'beta'::text AS source, b.created_at, NULLIF(btrim(b.brand_name), '') AS business,
           NULLIF(btrim(b.city), '') AS city, NULL::text AS tool,
           (NULLIF(btrim(b.email), '') IS NOT NULL) AS has_email,
           public.inbound_lead_is_test(b.email, b.brand_name) AS is_test,
           COALESCE(
             (SELECT jsonb_build_object('id', r.id, 'name', r.name, 'stage', r.stage)
                FROM public.crm_records r
               WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL AND r.beta_lead_id = b.id LIMIT 1),
             (SELECT jsonb_build_object('id', r.id, 'name', r.name, 'stage', r.stage)
                FROM public.crm_records r
               WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL
                 AND r.name_key = public.crm_name_key(b.brand_name) LIMIT 1)) AS host,
           NULL::jsonb AS booking
      FROM public.beta_access_leads b
     WHERE v_beta
    UNION ALL
    SELECT l.id, 'tool', l.created_at, NULLIF(btrim(l.input ->> 'name'), ''),
           NULLIF(btrim(l.input ->> 'city'), ''), l.tool,
           (NULLIF(btrim(l.email), '') IS NOT NULL),
           public.inbound_lead_is_test(l.email, l.input ->> 'name'),
           CASE WHEN NULLIF(btrim(l.input ->> 'name'), '') IS NULL THEN NULL ELSE
             (SELECT jsonb_build_object('id', r.id, 'name', r.name, 'stage', r.stage)
                FROM public.crm_records r
               WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL
                 AND r.name_key = public.crm_name_key(l.input ->> 'name') LIMIT 1) END,
           NULL::jsonb
      FROM public.tool_leads l
     WHERE v_tools AND l.lane = 'web'
    UNION ALL
    SELECT k.id, 'book_a_call', k.created_at, COALESCE(NULLIF(btrim(k.venue), ''), btrim(k.name)),
           NULLIF(btrim(k.city), ''), NULL::text,
           true,
           public.inbound_lead_is_test(k.email, COALESCE(NULLIF(btrim(k.venue), ''), k.name)),
           -- Only a Host call can already be a host card; a Creator or Local is not a host.
           CASE WHEN k.audience <> 'host' THEN NULL ELSE
           (SELECT jsonb_build_object('id', r.id, 'name', r.name, 'stage', r.stage)
              FROM public.crm_records r
             WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL
               AND r.name_key = public.crm_name_key(COALESCE(NULLIF(btrim(k.venue), ''), k.name)) LIMIT 1) END,
           jsonb_build_object(
             'audience', k.audience,
             'icp', k.icp,
             'city', k.city,
             'creator_makes', k.creator_makes,
             'work_url', k.work_url,
             'first_place', k.first_place,
             'social_platform', k.social_platform,
             'social_handle', k.social_handle,
             'social_url', k.social_url,
             'website', k.website,
             'call_at', k.call_at,
             'booker_time_zone', k.booker_time_zone,
             'meet_url', k.meet_url,
             'source', k.source)
      FROM public.book_call_leads k
     WHERE v_beta
  ), real AS (
    SELECT * FROM leads WHERE NOT is_test
  )
  SELECT jsonb_build_object(
    'can_see', jsonb_build_object('beta', v_beta, 'tools', v_tools, 'book_a_call', v_beta),
    'summary', jsonb_build_object(
      'total', (SELECT count(*) FROM real),
      'beta', (SELECT count(*) FROM real WHERE source = 'beta'),
      'tools', (SELECT count(*) FROM real WHERE source = 'tool'),
      'book_a_call', (SELECT count(*) FROM real WHERE source = 'book_a_call'),
      'with_email', (SELECT count(*) FROM real WHERE has_email),
      'in_hosts', (SELECT count(*) FROM real WHERE host IS NOT NULL),
      'last_30_days', (SELECT count(*) FROM real WHERE created_at >= now() - interval '30 days'),
      'last_lead_at', (SELECT max(created_at) FROM real),
      'test_hidden', (SELECT count(*) FROM leads WHERE is_test)),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', x.id, 'source', x.source, 'created_at', x.created_at, 'business', x.business,
        'city', x.city, 'tool', x.tool, 'has_email', x.has_email, 'is_test', x.is_test, 'host', x.host,
        'booking', x.booking)
        ORDER BY x.created_at DESC, x.id)
      FROM (SELECT * FROM leads WHERE p_show_test OR NOT is_test
             ORDER BY created_at DESC, id LIMIT v_limit) x), '[]'::jsonb),
    'truncated', (SELECT count(*) FROM leads WHERE p_show_test OR NOT is_test) > v_limit,
    'as_of', now()
  ) INTO v_out;

  RETURN v_out;
END;
$$;
COMMENT ON FUNCTION public.admin_inbound_leads(boolean, integer) IS
  'Issues #4130 + #4339: Inbound leads. Beta leads and Book a call bookings (owner/admin or the beta_leads area) and WEB tool leads (owner/admin only); app-lane tool runs are product usage and never appear. A booking row carries its audience (host, creator or local), ICP or city and program fields, social profile link, website, call time and source. Staff and test rows hidden unless asked for. Never returns an email address, only whether there is one.';
REVOKE ALL ON FUNCTION public.admin_inbound_leads(boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_inbound_leads(boolean, integer) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 3. One booking's contact details, for "Add to Hosts"
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_book_call_lead_get(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  -- Guard first: whoever can see bookings in Inbound leads.
  IF NOT (public.is_admin_user() OR COALESCE(public.admin_team_can('beta_leads'), false)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT jsonb_build_object(
           'id', k.id, 'audience', k.audience, 'name', k.name, 'email', k.email, 'venue', k.venue, 'icp', k.icp,
           'city', k.city, 'creator_makes', k.creator_makes, 'work_url', k.work_url, 'first_place', k.first_place,
           'social_platform', k.social_platform, 'social_handle', k.social_handle,
           'social_url', k.social_url, 'website', k.website, 'call_at', k.call_at,
           'booker_time_zone', k.booker_time_zone, 'meet_url', k.meet_url,
           'source', k.source, 'created_at', k.created_at)
    INTO v_out
    FROM public.book_call_leads k
   WHERE k.id = p_id;
  RETURN v_out;
END;
$$;
COMMENT ON FUNCTION public.admin_book_call_lead_get(uuid) IS
  'Issue #4339: one Book a call booking with its email and social, for Inbound leads "Add to Hosts". Owner/admin or the beta_leads area; null when there is no such booking. Never anon.';
REVOKE ALL ON FUNCTION public.admin_book_call_lead_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_book_call_lead_get(uuid) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 4. The admin Calendar's calls layer (#4339 Creators and Locals calls)
--------------------------------------------------------------------------------
-- Every booked call whose call_at falls in [p_from, p_to): Host, Creator and
-- Local. call_at is an instant; the Calendar draws it on the viewer's own day
-- and time. Called beside ops_calendar (#3980), which it does not change.
-- Staff/test bookings are left out unless asked for, like Inbound leads.
-- Status is 'booked' for every row: no cancel or move path exists today.
CREATE OR REPLACE FUNCTION public.admin_calendar_calls(
  p_from timestamptz,
  p_to timestamptz,
  p_show_test boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  -- Guard first: whoever can see bookings in Inbound leads.
  IF NOT (public.is_admin_user() OR COALESCE(public.admin_team_can('beta_leads'), false)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '93 days' THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  SELECT jsonb_build_object(
    'rows', COALESCE(jsonb_agg(jsonb_build_object(
        'id', c.id,
        'lead_id', c.id,
        'audience', c.audience,
        'name', c.name,
        'call_at', c.call_at,
        'city', c.city,
        'icp', c.icp,
        'makes', c.creator_makes,
        'first_place', c.first_place,
        'venue', c.venue,
        'social_platform', c.social_platform,
        'social_handle', c.social_handle,
        'social_url', c.social_url,
        'work_url', c.work_url,
        'website', c.website,
        'booker_time_zone', c.booker_time_zone,
        'meet_url', c.meet_url,
        'event_url', c.event_url,
        'is_test', c.is_test,
        'status', 'booked')
      ORDER BY c.call_at, c.id), '[]'::jsonb),
    'as_of', now())
    INTO v_out
    FROM (
      SELECT k.*, public.inbound_lead_is_test(k.email, COALESCE(NULLIF(btrim(k.venue), ''), k.name)) AS is_test
        FROM public.book_call_leads k
       WHERE k.call_at >= p_from AND k.call_at < p_to
       ORDER BY k.call_at, k.id
       LIMIT 1000
    ) c
   WHERE p_show_test OR NOT c.is_test;
  RETURN v_out;
END;
$$;
COMMENT ON FUNCTION public.admin_calendar_calls(timestamptz, timestamptz, boolean) IS
  'Issue #4339: the admin Calendar''s calls layer. Every booked Book a call (Host, Creator, Local) in [p_from, p_to), at most 93 days: audience, name, call_at, city, ICP or what they make, social, Meet and calendar links, lead id and status (always booked: there is no cancel path). Owner/admin or the beta_leads area, guard first; never anon; never an email address.';
REVOKE ALL ON FUNCTION public.admin_calendar_calls(timestamptz, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_calendar_calls(timestamptz, timestamptz, boolean) TO authenticated, service_role;
