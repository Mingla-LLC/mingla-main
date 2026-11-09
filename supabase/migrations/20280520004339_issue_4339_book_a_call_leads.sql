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
--      Inbound leads and admin_book_call_lead_get. Each call carries its
--      status (6).
--   6. (#4339 calendar sync, Seth approved 9 Nov) a booked call that is moved
--      or cancelled in Google Calendar updates on the admin Calendar. The
--      growth-tools-calendar-sync edge function, called by pg_cron every 5
--      minutes with the service role (the same vault bearer as every other
--      cron-to-edge job), reads the booking calendar's changes with a Google
--      syncToken and hands only the events that ARE bookings to
--      book_call_apply_calendar_changes: a new start time moves the call
--      (call_at changes, original_call_at keeps the booked time, status
--      moved), a cancelled event marks it cancelled, and the booker declining
--      the invite marks it declined. Status is derived from what Google says,
--      so applying the same change twice changes nothing. The sync's own state
--      (syncToken, page token, last run, last error) is one row in
--      public.book_call_calendar_sync, service role only. Each change is
--      emailed to the team once (notified_key, book_call_claim_change_notices).
--
-- The status columns (status, status_changed_at, original_call_at,
-- notified_key) are written by the service-role RPCs in section 6.
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
-- ROLLBACK (manual): unschedule the cron job
-- 'issue_4339_book_call_calendar_sync'; drop the section 6 functions and
-- public.book_call_calendar_sync; restore admin_inbound_leads from
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
  -- #4339 calendar sync: what Google Calendar says happened to the call since
  -- it was booked (growth-tools-calendar-sync, book_call_apply_calendar_changes).
  status            text NOT NULL DEFAULT 'booked',
  status_changed_at timestamptz,
  original_call_at  timestamptz,
  notified_key      text,
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
  CONSTRAINT book_call_leads_source_check CHECK (source IS NULL OR length(source) <= 40),
  CONSTRAINT book_call_leads_status_check CHECK (status IN ('booked', 'moved', 'cancelled', 'declined')),
  CONSTRAINT book_call_leads_notified_key_check CHECK (notified_key IS NULL OR length(notified_key) <= 80)
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
-- The calendar sync finds a booking by its Google Calendar event id.
CREATE INDEX IF NOT EXISTS idx_book_call_leads_calendar_event_id ON public.book_call_leads (calendar_event_id)
  WHERE calendar_event_id IS NOT NULL;
COMMENT ON COLUMN public.book_call_leads.status IS
  'Issue #4339 calendar sync: booked, moved (the event start changed; original_call_at keeps the booked time), cancelled (the event was cancelled or deleted) or declined (the booker declined the invite). Written only by book_call_apply_calendar_changes.';
COMMENT ON COLUMN public.book_call_leads.notified_key IS
  'Issue #4339 calendar sync: the change the team was last emailed about ("moved@<call_at>", "cancelled", "declined"), so each change is emailed once.';
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
             'status', k.status,
             'status_changed_at', k.status_changed_at,
             'original_call_at', k.original_call_at,
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
           'status', k.status, 'status_changed_at', k.status_changed_at, 'original_call_at', k.original_call_at,
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
-- Each row carries its calendar-sync status (booked, moved, cancelled or
-- declined), when that changed and, for a moved call, the booked time. A
-- cancelled or declined call is still returned, so the team sees it.
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
        'status', c.status,
        'status_changed_at', c.status_changed_at,
        'original_call_at', c.original_call_at)
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
  'Issue #4339: the admin Calendar''s calls layer. Every booked Book a call (Host, Creator, Local) in [p_from, p_to), at most 93 days: audience, name, call_at, city, ICP or what they make, social, Meet and calendar links, lead id, status (booked, moved, cancelled or declined), when it changed and the original time of a moved call. Owner/admin or the beta_leads area, guard first; never anon; never an email address.';
REVOKE ALL ON FUNCTION public.admin_calendar_calls(timestamptz, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_calendar_calls(timestamptz, timestamptz, boolean) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 6. Calendar sync: moved, cancelled and declined calls (#4339, Seth approved 9 Nov)
--------------------------------------------------------------------------------
-- growth-tools-calendar-sync (service role only) reads the booking calendar's
-- changed events with a Google syncToken. It never sends an unrelated event
-- here: it first asks book_call_calendar_bookings which event ids are
-- bookings, and only those reach book_call_apply_calendar_changes. Nothing in
-- this section is reachable by anon or a signed-in client.

-- 6a. The sync's state: one row, service role only (read for ops; every write
-- goes through the two functions below).
CREATE TABLE IF NOT EXISTS public.book_call_calendar_sync (
  id                boolean PRIMARY KEY DEFAULT true,
  calendar_id       text,
  sync_token        text,
  page_token        text,
  lease_until       timestamptz,
  last_run_at       timestamptz,
  last_success_at   timestamptz,
  last_full_sync_at timestamptz,
  last_error        text,
  last_result       jsonb,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT book_call_calendar_sync_singleton CHECK (id),
  CONSTRAINT book_call_calendar_sync_calendar_id_check CHECK (calendar_id IS NULL OR length(calendar_id) BETWEEN 1 AND 300),
  CONSTRAINT book_call_calendar_sync_sync_token_check CHECK (sync_token IS NULL OR length(sync_token) <= 2000),
  CONSTRAINT book_call_calendar_sync_page_token_check CHECK (page_token IS NULL OR length(page_token) <= 2000),
  CONSTRAINT book_call_calendar_sync_last_error_check CHECK (last_error IS NULL OR length(last_error) <= 300)
);
COMMENT ON TABLE public.book_call_calendar_sync IS
  'Issue #4339 calendar sync: the one state row of growth-tools-calendar-sync (Google syncToken, resume page token, run lease, last run, last success, last full sync, last error and counts). RLS on, no policies; the service role may read it, and writes go through book_call_calendar_sync_begin / _finish.';
ALTER TABLE public.book_call_calendar_sync ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.book_call_calendar_sync FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.book_call_calendar_sync TO service_role;

-- 6b. Start a run: take a short lease (an overlapping run is told it is busy)
-- and hand back the stored tokens. A different calendar id starts over with a
-- full sync, because another calendar's tokens mean nothing.
CREATE OR REPLACE FUNCTION public.book_call_calendar_sync_begin(
  p_calendar_id text,
  p_lease_seconds integer DEFAULT 240
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.book_call_calendar_sync%ROWTYPE;
  v_sync text;
  v_page text;
BEGIN
  IF p_calendar_id IS NULL OR length(btrim(p_calendar_id)) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'invalid_calendar';
  END IF;
  INSERT INTO public.book_call_calendar_sync (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO v_row FROM public.book_call_calendar_sync WHERE id FOR UPDATE;
  IF v_row.lease_until IS NOT NULL AND v_row.lease_until > now() THEN
    RETURN jsonb_build_object('busy', true);
  END IF;
  IF v_row.calendar_id IS NOT DISTINCT FROM p_calendar_id THEN
    v_sync := v_row.sync_token;
    v_page := v_row.page_token;
  END IF;
  UPDATE public.book_call_calendar_sync
     SET calendar_id = p_calendar_id,
         sync_token = v_sync,
         page_token = v_page,
         lease_until = now() + make_interval(secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 240), 30), 600)),
         last_run_at = now(),
         updated_at = now()
   WHERE id;
  RETURN jsonb_build_object('busy', false, 'sync_token', v_sync, 'page_token', v_page);
END;
$$;

-- 6c. End a run: store the tokens to resume from, the error (null on success)
-- and the counts, and release the lease.
CREATE OR REPLACE FUNCTION public.book_call_calendar_sync_finish(
  p_calendar_id text,
  p_sync_token text,
  p_page_token text,
  p_full_sync boolean,
  p_error text,
  p_result jsonb
)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.book_call_calendar_sync
     SET sync_token = NULLIF(left(p_sync_token, 2000), ''),
         page_token = NULLIF(left(p_page_token, 2000), ''),
         lease_until = NULL,
         last_error = left(NULLIF(btrim(p_error), ''), 300),
         last_success_at = CASE WHEN NULLIF(btrim(p_error), '') IS NULL THEN now() ELSE last_success_at END,
         last_full_sync_at = CASE WHEN NULLIF(btrim(p_error), '') IS NULL AND COALESCE(p_full_sync, false) THEN now() ELSE last_full_sync_at END,
         last_result = CASE WHEN jsonb_typeof(p_result) = 'object' THEN p_result ELSE NULL END,
         updated_at = now()
   WHERE id AND calendar_id IS NOT DISTINCT FROM p_calendar_id;
END;
$$;

-- 6d. Which of these event ids are bookings, with the booker's email (to read
-- the booker's own response on the invite). At most 2500 ids per call.
CREATE OR REPLACE FUNCTION public.book_call_calendar_bookings(p_event_ids text[])
RETURNS TABLE (calendar_event_id text, email text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT k.calendar_event_id, k.email
    FROM public.book_call_leads k
   WHERE k.calendar_event_id = ANY (COALESCE(p_event_ids[1:2500], ARRAY[]::text[]));
$$;

-- 6e. Apply what Google says about each booking's event:
--   {event_id, cancelled, start_at, booker_declined}
-- The status is DERIVED, never accumulated, so the same change applied twice
-- changes nothing: cancelled, else declined, else moved when call_at is not
-- the booked time, else booked. A new start moves call_at and keeps the
-- booked time in original_call_at (set once, on the first move). A cancelled
-- event keeps the last known call_at. status_changed_at is stamped whenever
-- the status or the time changes. Unknown event ids are ignored.
CREATE OR REPLACE FUNCTION public.book_call_apply_calendar_changes(p_changes jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_change    jsonb;
  v_event     text;
  v_cancelled boolean;
  v_declined  boolean;
  v_start     timestamptz;
  v_lead      public.book_call_leads%ROWTYPE;
  v_call_at   timestamptz;
  v_original  timestamptz;
  v_status    text;
  v_matched   integer := 0;
  v_updated   integer := 0;
BEGIN
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' THEN
    RAISE EXCEPTION 'invalid_changes';
  END IF;
  IF jsonb_array_length(p_changes) > 2500 THEN
    RAISE EXCEPTION 'too_many_changes';
  END IF;
  FOR v_change IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    CONTINUE WHEN jsonb_typeof(v_change) <> 'object';
    v_event := NULLIF(btrim(v_change ->> 'event_id'), '');
    CONTINUE WHEN v_event IS NULL;
    v_cancelled := COALESCE(v_change ->> 'cancelled' = 'true', false);
    v_declined := COALESCE(v_change ->> 'booker_declined' = 'true', false);
    v_start := CASE WHEN v_change ->> 'start_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$'
                    THEN (v_change ->> 'start_at')::timestamptz END;
    FOR v_lead IN
      SELECT * FROM public.book_call_leads WHERE calendar_event_id = v_event ORDER BY id FOR UPDATE
    LOOP
      v_matched := v_matched + 1;
      v_call_at := CASE WHEN NOT v_cancelled AND v_start IS NOT NULL THEN v_start ELSE v_lead.call_at END;
      v_original := CASE WHEN v_call_at IS DISTINCT FROM v_lead.call_at
                         THEN COALESCE(v_lead.original_call_at, v_lead.call_at)
                         ELSE v_lead.original_call_at END;
      v_status := CASE
        WHEN v_cancelled THEN 'cancelled'
        WHEN v_declined THEN 'declined'
        WHEN v_original IS NOT NULL AND v_call_at <> v_original THEN 'moved'
        ELSE 'booked' END;
      IF v_call_at IS DISTINCT FROM v_lead.call_at OR v_status IS DISTINCT FROM v_lead.status THEN
        UPDATE public.book_call_leads
           SET call_at = v_call_at,
               original_call_at = v_original,
               status = v_status,
               status_changed_at = now()
         WHERE id = v_lead.id;
        v_updated := v_updated + 1;
      END IF;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('matched', v_matched, 'updated', v_updated);
END;
$$;

-- 6f. The changes to email the team about, each once: a call moved (keyed by
-- its new time, so a second move is a new notice), cancelled or declined.
-- Claimed before sending (notified_key is set in the same statement, so a
-- second run never picks it up); a failed send gives the claim back through
-- book_call_release_change_notice. Calls more than a day past, and changes
-- older than a week (the first full sync after ship), are never emailed.
CREATE OR REPLACE FUNCTION public.book_call_claim_change_notices(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  WITH due AS (
    SELECT d.id, d.notice_key, d.previous_key
      FROM (
        SELECT k.id,
               CASE k.status
                 WHEN 'moved' THEN 'moved@' || to_char(k.call_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                 ELSE k.status END AS notice_key,
               k.notified_key AS previous_key
          FROM public.book_call_leads k
         WHERE k.status IN ('moved', 'cancelled', 'declined')
           AND k.status_changed_at > now() - interval '7 days'
           AND GREATEST(k.call_at, COALESCE(k.original_call_at, k.call_at)) > now() - interval '1 day'
      ) d
      JOIN public.book_call_leads l ON l.id = d.id
     WHERE l.notified_key IS DISTINCT FROM d.notice_key
     ORDER BY l.status_changed_at, l.id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
     FOR UPDATE OF l SKIP LOCKED
  ), claimed AS (
    UPDATE public.book_call_leads k
       SET notified_key = due.notice_key
      FROM due
     WHERE k.id = due.id
    RETURNING k.id, due.notice_key, due.previous_key, k.status, k.audience, k.name, k.venue,
              k.call_at, k.original_call_at, k.booker_time_zone, k.event_url
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id, 'notice_key', c.notice_key, 'previous_key', c.previous_key,
           'status', c.status, 'audience', c.audience, 'name', c.name, 'venue', c.venue,
           'call_at', c.call_at, 'original_call_at', c.original_call_at,
           'booker_time_zone', c.booker_time_zone, 'event_url', c.event_url)
           ORDER BY c.call_at, c.id), '[]'::jsonb)
    INTO v_out
    FROM claimed c;
  RETURN v_out;
END;
$$;

-- 6g. Give a claim back after a failed send, only while it is still that claim.
CREATE OR REPLACE FUNCTION public.book_call_release_change_notice(
  p_id uuid,
  p_notice_key text,
  p_previous_key text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.book_call_leads
     SET notified_key = NULLIF(p_previous_key, '')
   WHERE id = p_id AND notified_key = p_notice_key;
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.book_call_calendar_sync_begin(text, integer) IS
  'Issue #4339 calendar sync: start a growth-tools-calendar-sync run (lease, stored tokens; a new calendar id starts a full sync). Service role only.';
COMMENT ON FUNCTION public.book_call_calendar_sync_finish(text, text, text, boolean, text, jsonb) IS
  'Issue #4339 calendar sync: end a run (tokens to resume from, error, counts) and release the lease. Service role only.';
COMMENT ON FUNCTION public.book_call_calendar_bookings(text[]) IS
  'Issue #4339 calendar sync: which Google Calendar event ids are Book a call bookings, with the booker email. Service role only.';
COMMENT ON FUNCTION public.book_call_apply_calendar_changes(jsonb) IS
  'Issue #4339 calendar sync: apply Google Calendar changes to bookings (moved, cancelled, declined). Idempotent: the status is derived. Service role only.';
COMMENT ON FUNCTION public.book_call_claim_change_notices(integer) IS
  'Issue #4339 calendar sync: claim the moved / cancelled / declined changes not yet emailed, each once. Service role only.';
COMMENT ON FUNCTION public.book_call_release_change_notice(uuid, text, text) IS
  'Issue #4339 calendar sync: give back a notice claim after a failed send. Service role only.';

REVOKE ALL ON FUNCTION public.book_call_calendar_sync_begin(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.book_call_calendar_sync_finish(text, text, text, boolean, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.book_call_calendar_bookings(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.book_call_apply_calendar_changes(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.book_call_claim_change_notices(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.book_call_release_change_notice(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_call_calendar_sync_begin(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.book_call_calendar_sync_finish(text, text, text, boolean, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.book_call_calendar_bookings(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.book_call_apply_calendar_changes(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.book_call_claim_change_notices(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.book_call_release_change_notice(uuid, text, text) TO service_role;

-- 6h. Every 5 minutes, the same way every cron-invoked edge function is called
-- (#3872 payee-payout-sweep, #4271 door sweeps): pg_net POST with the vault's
-- service_role_key as the bearer. The function checks that bearer in code and
-- refuses any other caller. Skipped, loudly, where pg_cron, pg_net or the
-- vault rows are missing (a local replay).
DO $cron$
DECLARE
  v_job bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE NOTICE '#4339: pg_cron/pg_net unavailable; book call calendar sync not scheduled'; RETURN;
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL
    OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url')
    OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') THEN
    RAISE NOTICE '#4339: runtime vault rows unavailable; book call calendar sync not scheduled'; RETURN;
  END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'issue_4339_book_call_calendar_sync';
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
  PERFORM cron.schedule('issue_4339_book_call_calendar_sync', '*/5 * * * *', $job$SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/growth-tools-calendar-sync',
    headers := jsonb_build_object('content-type', 'application/json', 'authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000)$job$);
END;
$cron$;
