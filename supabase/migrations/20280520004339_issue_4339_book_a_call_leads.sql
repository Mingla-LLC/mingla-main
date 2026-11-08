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
-- No dynamic SQL, no 40001: a conflict is the unique key, answered by DO
-- NOTHING. Additive: one table, one replaced function (same signature), one
-- new function. NOT applied here.
--
-- Invariant (declared in the pg17 test): I-4339-BOOK-A-CALL-IS-AN-INBOUND-LEAD
-- | issue #4339 | a confirmed booking is listed once in Inbound leads as
-- book_a_call, with its ICP, social link, website and call time; clients can
-- never read the table directly.
--
-- ROLLBACK (manual): restore admin_inbound_leads from
-- 20280114004130_issue_4130_dashboard_outreach_inbound.sql, then
--   DROP FUNCTION IF EXISTS public.admin_book_call_lead_get(uuid);
--   DROP TABLE IF EXISTS public.book_call_leads;

--------------------------------------------------------------------------------
-- 1. The bookings
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.book_call_leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_key       text NOT NULL,
  calendar_event_id text,
  name              text NOT NULL,
  email             text NOT NULL,
  venue             text,
  icp               text NOT NULL,
  social_platform   text NOT NULL,
  social_handle     text,
  social_url        text NOT NULL,
  website           text,
  call_at           timestamptz NOT NULL,
  source            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT book_call_leads_booking_key_key UNIQUE (booking_key),
  CONSTRAINT book_call_leads_booking_key_check CHECK (length(booking_key) BETWEEN 3 AND 300),
  CONSTRAINT book_call_leads_name_check CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  CONSTRAINT book_call_leads_email_check CHECK (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' AND length(email) <= 254),
  CONSTRAINT book_call_leads_venue_check CHECK (venue IS NULL OR length(venue) <= 120),
  CONSTRAINT book_call_leads_icp_check CHECK (icp IN ('events', 'trips', 'experiences', 'restaurants', 'hotels', 'art', 'play', 'other')),
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
           NULL::text, NULL::text,
           true,
           public.inbound_lead_is_test(k.email, COALESCE(NULLIF(btrim(k.venue), ''), k.name)),
           (SELECT jsonb_build_object('id', r.id, 'name', r.name, 'stage', r.stage)
              FROM public.crm_records r
             WHERE r.pipeline = 'hosts' AND r.deleted_at IS NULL
               AND r.name_key = public.crm_name_key(COALESCE(NULLIF(btrim(k.venue), ''), k.name)) LIMIT 1),
           jsonb_build_object(
             'icp', k.icp,
             'social_platform', k.social_platform,
             'social_handle', k.social_handle,
             'social_url', k.social_url,
             'website', k.website,
             'call_at', k.call_at,
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
  'Issues #4130 + #4339: Inbound leads. Beta leads and Book a call bookings (owner/admin or the beta_leads area) and WEB tool leads (owner/admin only); app-lane tool runs are product usage and never appear. A booking row carries its ICP, social profile link, website, call time and source. Staff and test rows hidden unless asked for. Never returns an email address, only whether there is one.';
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
           'id', k.id, 'name', k.name, 'email', k.email, 'venue', k.venue, 'icp', k.icp,
           'social_platform', k.social_platform, 'social_handle', k.social_handle,
           'social_url', k.social_url, 'website', k.website, 'call_at', k.call_at,
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
