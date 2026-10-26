-- Issue #4130 (Wave 5) — Data room analytics.
--
-- What this adds (aggregate-only reads; no row about a single person leaves
-- the server, the only names returned are brand names in "top hosts"):
--
--   1. admin_data_room_allowed() — the Data room gate: an active owner, admin
--      or founding partner (the same roles admin-data-room and
--      issue_3720_team_my_permissions().data_room allow).
--   2. analytics_daily_snapshot — one row per day and section, filled each
--      night by pg_cron (job issue_4130_analytics_daily_snapshot, 00:20 UTC)
--      through analytics_daily_snapshot_refresh(). Re-running a night
--      replaces that night's rows (ON CONFLICT DO UPDATE), so the job is
--      idempotent. Investor numbers can be read "as of" any stored day.
--   3. Section builders analytics_dr_<section>() — users, overview,
--      explorers, hosts, funnels, retention, money. They reuse:
--        * Wave 3's admin_people_classified() for the explorer / host / both /
--          incomplete / internal split, so the Data room and People pages
--          always agree, and staff and test accounts are left out the same way;
--        * Wave 2a's mingla_money_lines() / fx_usd_minor_exact() for money, so
--          every figure agrees with Mingla money: per currency, never summed
--          across currencies, US dollars at each line's own-day rate rounded
--          once per currency and day, NULL ("not converted") when a rate is
--          missing.
--   4. admin_data_room_<section>(p_as_of date) — the page's reads. Gate first;
--      then the stored snapshot for p_as_of (an error when that day has none),
--      or, with no date, today's snapshot when tonight's job has run and a
--      live computation otherwise. Every answer says which (source) and when
--      (as_of).
--   5. admin_data_room_snapshot_dates() — the stored days, for the "as of"
--      picker.
--
-- Activity (first-party only; PostHog is not read here):
--   Explorer activity = a deck view, card open, save or review
--   (engagement_metrics), a saved or scheduled card (user_activity,
--   saved_card), a brand follow (brand_follows), or a ticket order as buyer.
--   Host activity = creating a brand, creating / publishing / last editing an
--   event they created (events keeps only the latest edit time), scanning a
--   ticket (scan_events), or a sale on a brand they own.
-- Retention Dn (n = 7, 30, 90) = the share of a sign-up cohort with any
--   activity of their side in days n to n+6 after they signed up (explorers:
--   profile created; hosts: business account created, else profile). A
--   person counts only once all of those seven days have passed; a cohort
--   cell is NULL ("too new") until every member's window has passed — never 0.
--
-- MINGLA-INVARIANT: I-4130-DATA-ROOM-ANALYTICS-GATED | issue #4130 | Data room analytics are aggregate-only reads gated to active owners, admins and founding partners; staff and test accounts are left out through Wave 3's classification; money never sums across currencies; a retention cell too new to measure is NULL, never 0.

BEGIN;

--------------------------------------------------------------------------------
-- 1. The gate.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_data_room_allowed()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(public.admin_team_role(), '') IN ('owner', 'admin', 'partner')
$$;
COMMENT ON FUNCTION public.admin_data_room_allowed() IS
  'Issue #4130: the Data room gate. True for an active owner, admin or founding partner (admin_team_role()), the roles admin-data-room allows.';
REVOKE ALL ON FUNCTION public.admin_data_room_allowed() FROM PUBLIC, anon, authenticated;

--------------------------------------------------------------------------------
-- 2. The nightly snapshot table.
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.analytics_daily_snapshot (
  snapshot_date date        NOT NULL,
  section       text        NOT NULL CHECK (section IN
                  ('users', 'overview', 'explorers', 'hosts', 'funnels', 'retention', 'money')),
  payload       jsonb       NOT NULL,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_date, section)
);
COMMENT ON TABLE public.analytics_daily_snapshot IS
  'Issue #4130: Data room aggregates, one row per UTC day and section, written nightly by analytics_daily_snapshot_refresh(). Aggregates only. Read through admin_data_room_* RPCs.';

-- No policies: nobody reads or writes this table from the browser.
ALTER TABLE public.analytics_daily_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.analytics_daily_snapshot FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.analytics_daily_snapshot TO service_role;

--------------------------------------------------------------------------------
-- 3. Shared building blocks.
--------------------------------------------------------------------------------
-- Every first-party activity moment, by side. See the header for the meaning.
CREATE OR REPLACE FUNCTION public.analytics_dr_activity()
RETURNS TABLE (user_id uuid, side text, at timestamptz)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT em.user_id, 'explorer'::text, em.created_at
    FROM public.engagement_metrics em
   WHERE em.user_id IS NOT NULL AND em.created_at IS NOT NULL
  UNION ALL
  SELECT ua.user_id, 'explorer', ua.created_at
    FROM public.user_activity ua
   WHERE ua.user_id IS NOT NULL AND ua.created_at IS NOT NULL
  UNION ALL
  SELECT sc.profile_id, 'explorer', sc.created_at
    FROM public.saved_card sc
   WHERE sc.profile_id IS NOT NULL AND sc.created_at IS NOT NULL
  UNION ALL
  SELECT bf.user_id, 'explorer', bf.created_at
    FROM public.brand_follows bf
   WHERE bf.user_id IS NOT NULL AND bf.created_at IS NOT NULL
  UNION ALL
  SELECT o.buyer_user_id, 'explorer', COALESCE(o.confirmed_at, o.created_at)
    FROM public.orders o
   WHERE o.buyer_user_id IS NOT NULL
     AND o.payment_status IN ('paid', 'partial_refund', 'refunded')
  UNION ALL
  SELECT b.account_id, 'host', b.created_at
    FROM public.brands b
   WHERE b.account_id IS NOT NULL AND b.created_at IS NOT NULL
  UNION ALL
  SELECT e.created_by, 'host', t.at
    FROM public.events e
   CROSS JOIN LATERAL (VALUES (e.created_at), (e.published_at), (e.updated_at)) AS t(at)
   WHERE e.created_by IS NOT NULL AND t.at IS NOT NULL
  UNION ALL
  SELECT s.scanner_user_id, 'host', s.scanned_at
    FROM public.scan_events s
   WHERE s.scanner_user_id IS NOT NULL AND s.scanned_at IS NOT NULL
  UNION ALL
  SELECT b.account_id, 'host', COALESCE(o.confirmed_at, o.created_at)
    FROM public.orders o
    JOIN public.events e ON e.id = o.event_id
    JOIN public.brands b ON b.id = e.brand_id
   WHERE b.account_id IS NOT NULL
     AND o.payment_status IN ('paid', 'partial_refund', 'refunded')
$$;
REVOKE ALL ON FUNCTION public.analytics_dr_activity() FROM PUBLIC, anon, authenticated;

-- A brand run by a staff or test account (the Brands page's rule).
CREATE OR REPLACE FUNCTION public.analytics_dr_brand_internal(p_account_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_account_id IS NOT NULL AND public.admin_account_is_internal(p_account_id)
$$;
REVOKE ALL ON FUNCTION public.analytics_dr_brand_internal(uuid) FROM PUBLIC, anon, authenticated;

-- Tickets that count: real orders (paid, or free and confirmed) bought by
-- someone who is not a staff or test account (account flag or email rule).
-- The buyer decides, not the brand: some real events are run from a staff
-- account, and their guests are real people. Host-side figures (top hosts,
-- events by state) leave staff and test brands out separately.
CREATE OR REPLACE FUNCTION public.analytics_dr_tickets()
RETURNS TABLE (ticket_id uuid, brand_id uuid, event_id uuid, at timestamptz,
               paid boolean, used boolean, event_started boolean)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT t.id, b.id, e.id, COALESCE(o.confirmed_at, o.created_at),
         (COALESCE(o.payment_method, '') <> 'free'
           AND COALESCE(o.buyer_total_cents, o.total_cents, 0) > 0),
         t.used_at IS NOT NULL,
         COALESCE(d.start_at < now(), false)
    FROM public.tickets t
    JOIN public.orders o ON o.id = t.order_id
    JOIN public.events e ON e.id = o.event_id
    JOIN public.brands b ON b.id = e.brand_id
    LEFT JOIN public.event_dates d ON d.event_id = e.id AND d.is_master
   WHERE COALESCE(t.status, '') <> 'void'
     AND o.payment_status IN ('paid', 'partial_refund')
     AND NOT (o.buyer_user_id IS NOT NULL AND public.admin_account_is_internal(o.buyer_user_id))
     AND NOT public.admin_internal_email_rule(o.buyer_email)
$$;
REVOKE ALL ON FUNCTION public.analytics_dr_tickets() FROM PUBLIC, anon, authenticated;

--------------------------------------------------------------------------------
-- 4. Section builders. Not callable by signed-in users; the gated RPCs below
--    and the nightly job call them.
--------------------------------------------------------------------------------

-- All users: segment totals (Wave 3's classification) and new people per
-- month by segment. Staff and test accounts are counted only as left out.
CREATE OR REPLACE FUNCTION public.analytics_dr_users()
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public, pg_temp
SET TimeZone = 'UTC'
AS $$
  WITH c AS MATERIALIZED (
    SELECT c.segment, p.created_at
      FROM public.admin_people_classified() c
      JOIN public.profiles p ON p.id = c.user_id
  ), r AS (
    SELECT * FROM c WHERE segment <> 'internal'
  ), months AS (
    SELECT generate_series(date_trunc('month', min(created_at)), date_trunc('month', now()),
                           interval '1 month') AS m
      FROM r
  )
  SELECT jsonb_build_object(
    'segments', jsonb_build_object(
      'explorer',   (SELECT count(*) FROM r WHERE segment = 'explorer'),
      'host',       (SELECT count(*) FROM r WHERE segment = 'host'),
      'both',       (SELECT count(*) FROM r WHERE segment = 'both'),
      'incomplete', (SELECT count(*) FROM r WHERE segment = 'incomplete')),
    'total',             (SELECT count(*) FROM r),
    'internal_left_out', (SELECT count(*) FROM c WHERE segment = 'internal'),
    'months', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'month', to_char(x.m, 'YYYY-MM'), 'explorer', x.e, 'host', x.h,
               'both', x.b, 'incomplete', x.i) ORDER BY x.m)
        FROM (
          SELECT months.m,
                 count(r.segment) FILTER (WHERE r.segment = 'explorer')   AS e,
                 count(r.segment) FILTER (WHERE r.segment = 'host')       AS h,
                 count(r.segment) FILTER (WHERE r.segment = 'both')       AS b,
                 count(r.segment) FILTER (WHERE r.segment = 'incomplete') AS i
            FROM months
            LEFT JOIN r ON date_trunc('month', r.created_at) = months.m
           GROUP BY months.m) x
    ), '[]'::jsonb)
  )
$$;
REVOKE ALL ON FUNCTION public.analytics_dr_users() FROM PUBLIC, anon, authenticated;

-- Overview: weekly active explorers and hosts, tickets per week, headline KPIs.
CREATE OR REPLACE FUNCTION public.analytics_dr_overview()
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public, pg_temp
SET TimeZone = 'UTC'
AS $$
  WITH cls AS MATERIALIZED (
    SELECT user_id, segment FROM public.admin_people_classified()
  ), act AS MATERIALIZED (
    SELECT a.user_id, a.side, a.at
      FROM public.analytics_dr_activity() a
      JOIN cls ON cls.user_id = a.user_id
     WHERE (a.side = 'explorer' AND cls.segment IN ('explorer', 'both'))
        OR (a.side = 'host' AND cls.segment IN ('host', 'both'))
  ), tix AS MATERIALIZED (
    SELECT * FROM public.analytics_dr_tickets()
  ), weeks AS (
    SELECT generate_series(date_trunc('week', now()) - interval '11 weeks',
                           date_trunc('week', now()), interval '1 week') AS wk
  )
  SELECT jsonb_build_object(
    'weekly', (SELECT jsonb_agg(jsonb_build_object(
        'week_start', to_char(w.wk, 'YYYY-MM-DD'),
        'active_explorers', (SELECT count(DISTINCT a.user_id) FROM act a
                              WHERE a.side = 'explorer' AND a.at >= w.wk AND a.at < w.wk + interval '7 days'),
        'active_hosts',     (SELECT count(DISTINCT a.user_id) FROM act a
                              WHERE a.side = 'host' AND a.at >= w.wk AND a.at < w.wk + interval '7 days'),
        'paid_tickets',     (SELECT count(*) FROM tix t
                              WHERE t.paid AND t.at >= w.wk AND t.at < w.wk + interval '7 days'),
        'free_tickets',     (SELECT count(*) FROM tix t
                              WHERE NOT t.paid AND t.at >= w.wk AND t.at < w.wk + interval '7 days'))
      ORDER BY w.wk) FROM weeks w),
    'kpis', jsonb_build_object(
      'explorers_signed_up', (SELECT count(*) FROM cls WHERE segment IN ('explorer', 'both')),
      'explorers_also_hosting', (SELECT count(*) FROM cls WHERE segment = 'both'),
      'active_explorers_7d', (SELECT count(DISTINCT user_id) FROM act
                               WHERE side = 'explorer' AND at >= now() - interval '7 days'),
      'active_explorers_prev_7d', (SELECT count(DISTINCT user_id) FROM act
                               WHERE side = 'explorer' AND at >= now() - interval '14 days'
                                 AND at < now() - interval '7 days'),
      -- Same rule as the Brands page "with a live public offering".
      'hosts_with_live_event', (SELECT count(*) FROM public.brands b
        WHERE b.deleted_at IS NULL AND NOT public.analytics_dr_brand_internal(b.account_id)
          AND EXISTS (
            SELECT 1 FROM public.events e
              LEFT JOIN public.event_dates d ON d.event_id = e.id AND d.is_master
             WHERE e.brand_id = b.id AND e.deleted_at IS NULL AND e.visibility = 'public'
               AND public.admin_offering_is_current(e.status, d.start_at))),
      'tickets_30d',      (SELECT count(*) FROM tix WHERE at >= now() - interval '30 days'),
      'paid_tickets_30d', (SELECT count(*) FROM tix WHERE paid AND at >= now() - interval '30 days'),
      'tickets_prev_30d', (SELECT count(*) FROM tix
                            WHERE at >= now() - interval '60 days' AND at < now() - interval '30 days'))
  )
$$;
REVOKE ALL ON FUNCTION public.analytics_dr_overview() FROM PUBLIC, anon, authenticated;

-- Explorers: sign-ups, onboarding, first-week saves, sign-ups by country,
-- and what active explorers did in the last 30 days.
CREATE OR REPLACE FUNCTION public.analytics_dr_explorers()
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public, pg_temp
SET TimeZone = 'UTC'
AS $$
  WITH real AS MATERIALIZED (
    SELECT p.id, p.created_at, COALESCE(p.has_completed_onboarding, false) AS onboarded,
           COALESCE(NULLIF(btrim(p.country), ''), 'Unknown') AS country, c.segment
      FROM public.admin_people_classified() c
      JOIN public.profiles p ON p.id = c.user_id
     WHERE c.segment <> 'internal' AND p.created_at IS NOT NULL
  ), weeks AS (
    SELECT generate_series(date_trunc('week', now()) - interval '11 weeks',
                           date_trunc('week', now()), interval '1 week') AS wk
  ), recent AS (
    SELECT r.*, date_trunc('week', r.created_at) AS wk
      FROM real r WHERE r.created_at >= date_trunc('week', now()) - interval '11 weeks'
  ), top_countries AS (
    SELECT country FROM recent WHERE country <> 'Unknown'
     GROUP BY country ORDER BY count(*) DESC, country LIMIT 3
  ), active AS MATERIALIZED (
    SELECT DISTINCT a.user_id
      FROM public.analytics_dr_activity() a
      JOIN real r ON r.id = a.user_id AND r.segment IN ('explorer', 'both')
     WHERE a.side = 'explorer' AND a.at >= now() - interval '30 days'
  ), week1 AS (
    SELECT r.id,
           EXISTS (SELECT 1 FROM public.saved_card sc
                    WHERE sc.profile_id = r.id
                      AND sc.created_at >= r.created_at
                      AND sc.created_at < r.created_at + interval '7 days') AS saved
      FROM real r
     WHERE r.created_at >= now() - interval '97 days'
       AND r.created_at <= now() - interval '7 days'
  )
  SELECT jsonb_build_object(
    'signups_30d',      (SELECT count(*) FROM real WHERE created_at >= now() - interval '30 days'),
    'signups_prev_30d', (SELECT count(*) FROM real WHERE created_at >= now() - interval '60 days'
                                                     AND created_at < now() - interval '30 days'),
    'onboarded_30d',      (SELECT count(*) FROM real WHERE onboarded AND created_at >= now() - interval '30 days'),
    'onboarded_prev_30d', (SELECT count(*) FROM real WHERE onboarded AND created_at >= now() - interval '60 days'
                                                       AND created_at < now() - interval '30 days'),
    'saved_week1', jsonb_build_object(
      'eligible', (SELECT count(*) FROM week1),
      'saved',    (SELECT count(*) FROM week1 WHERE saved)),
    'signups_by_week', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'week_start', to_char(x.wk, 'YYYY-MM-DD'), 'market', x.market, 'count', x.n)
        ORDER BY x.wk, x.market), '[]'::jsonb)
      FROM (
        SELECT w.wk,
               CASE WHEN rc.country IN (SELECT country FROM top_countries) THEN rc.country
                    WHEN rc.country = 'Unknown' THEN 'Unknown' ELSE 'Other' END AS market,
               count(*) AS n
          FROM weeks w JOIN recent rc ON rc.wk = w.wk
         GROUP BY 1, 2) x),
    'actions_30d', jsonb_build_object(
      'active', (SELECT count(*) FROM active),
      'saw_deck', (SELECT count(*) FROM active a WHERE EXISTS (
          SELECT 1 FROM public.engagement_metrics em WHERE em.user_id = a.user_id
             AND em.event_kind = 'seen_deck' AND em.created_at >= now() - interval '30 days')),
      'opened_card', (SELECT count(*) FROM active a WHERE EXISTS (
          SELECT 1 FROM public.engagement_metrics em WHERE em.user_id = a.user_id
             AND em.event_kind = 'seen_expand' AND em.created_at >= now() - interval '30 days')),
      'saved_card', (SELECT count(*) FROM active a WHERE EXISTS (
          SELECT 1 FROM public.saved_card sc WHERE sc.profile_id = a.user_id
             AND sc.created_at >= now() - interval '30 days')),
      'got_ticket', (SELECT count(*) FROM active a WHERE EXISTS (
          SELECT 1 FROM public.orders o WHERE o.buyer_user_id = a.user_id
             AND o.payment_status IN ('paid', 'partial_refund', 'refunded')
             AND COALESCE(o.confirmed_at, o.created_at) >= now() - interval '30 days')),
      'followed_host', (SELECT count(*) FROM active a WHERE EXISTS (
          SELECT 1 FROM public.brand_follows bf WHERE bf.user_id = a.user_id
             AND bf.created_at >= now() - interval '30 days')))
  )
$$;
REVOKE ALL ON FUNCTION public.analytics_dr_explorers() FROM PUBLIC, anon, authenticated;

-- Hosts: brands created, first sales, events by state, top hosts by tickets.
CREATE OR REPLACE FUNCTION public.analytics_dr_hosts()
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public, pg_temp
SET TimeZone = 'UTC'
AS $$
  WITH rb AS MATERIALIZED (
    SELECT b.id, b.name, b.created_at, b.account_id,
           COALESCE(ca.created_at, b.created_at) AS host_since
      FROM public.brands b
      LEFT JOIN public.creator_accounts ca ON ca.id = b.account_id
     WHERE b.deleted_at IS NULL AND NOT public.analytics_dr_brand_internal(b.account_id)
  ), first_sale AS (
    SELECT rb.id, rb.host_since, min(COALESCE(o.confirmed_at, o.created_at)) AS at
      FROM rb
      JOIN public.events e ON e.brand_id = rb.id
      JOIN public.orders o ON o.event_id = e.id
     WHERE o.payment_status IN ('paid', 'partial_refund', 'refunded')
       AND COALESCE(o.payment_method, '') <> 'free'
       AND COALESCE(o.buyer_total_cents, o.total_cents, 0) > 0
     GROUP BY rb.id, rb.host_since
  ), ev AS (
    SELECT e.status, d.start_at
      FROM public.events e
      JOIN rb ON rb.id = e.brand_id
      LEFT JOIN public.event_dates d ON d.event_id = e.id AND d.is_master
     WHERE e.deleted_at IS NULL
  ), tix AS MATERIALIZED (
    SELECT t.* FROM public.analytics_dr_tickets() t
     WHERE t.at >= now() - interval '30 days'
  ), top AS (
    SELECT rb.id, rb.name, count(*) AS tickets,
           count(*) FILTER (WHERE t.event_started) AS started,
           count(*) FILTER (WHERE t.event_started AND t.used) AS used
      FROM tix t JOIN rb ON rb.id = t.brand_id
     GROUP BY rb.id, rb.name
     ORDER BY count(*) DESC, rb.name
     LIMIT 10
  )
  SELECT jsonb_build_object(
    'brands_created_30d',      (SELECT count(*) FROM rb WHERE created_at >= now() - interval '30 days'),
    'brands_created_prev_30d', (SELECT count(*) FROM rb WHERE created_at >= now() - interval '60 days'
                                                          AND created_at < now() - interval '30 days'),
    'hosts_with_first_sale', (SELECT count(*) FROM first_sale),
    'median_days_to_first_sale', (SELECT round((percentile_cont(0.5) WITHIN GROUP (
        ORDER BY extract(epoch FROM (at - host_since)) / 86400.0))::numeric, 1)
        FROM first_sale WHERE at >= host_since),
    'events_by_state', jsonb_build_object(
      'draft',     (SELECT count(*) FROM ev WHERE status = 'draft'),
      'on_sale',   (SELECT count(*) FROM ev WHERE public.admin_offering_is_current(status, start_at)),
      'ended',     (SELECT count(*) FROM ev WHERE status IN ('scheduled', 'live', 'ended', 'completed')
                                           AND NOT public.admin_offering_is_current(status, start_at)),
      'cancelled', (SELECT count(*) FROM ev WHERE status = 'cancelled')),
    'top_hosts_30d', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'brand_id', top.id, 'name', top.name, 'tickets', top.tickets,
        'check_in_rate', CASE WHEN top.started > 0
                              THEN round(100.0 * top.used / top.started, 1) END,
        'paid_by_buyers', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('currency', m.cur, 'cents', m.cents) ORDER BY m.cur)
            FROM (SELECT upper(o.currency::text) AS cur,
                         sum(COALESCE(o.buyer_total_cents, o.total_cents))::bigint AS cents
                    FROM public.orders o JOIN public.events e ON e.id = o.event_id
                   WHERE e.brand_id = top.id
                     AND o.payment_status IN ('paid', 'partial_refund', 'refunded')
                     AND COALESCE(o.payment_method, '') <> 'free'
                     AND o.currency IS NOT NULL
                     AND COALESCE(o.buyer_total_cents, o.total_cents, 0) > 0
                     AND COALESCE(o.confirmed_at, o.created_at) >= now() - interval '30 days'
                   GROUP BY 1) m), '[]'::jsonb))
      ORDER BY top.tickets DESC, top.name) FROM top), '[]'::jsonb)
  )
$$;
REVOKE ALL ON FUNCTION public.analytics_dr_hosts() FROM PUBLIC, anon, authenticated;

-- Funnels since launch. Each step counts people (sessions, for checkout) who
-- reached it AND every step before it, so a funnel never widens.
CREATE OR REPLACE FUNCTION public.analytics_dr_funnels()
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public, pg_temp
SET TimeZone = 'UTC'
AS $$
  WITH cls AS MATERIALIZED (
    SELECT c.user_id, c.segment, COALESCE(p.has_completed_onboarding, false) AS onboarded
      FROM public.admin_people_classified() c
      JOIN public.profiles p ON p.id = c.user_id
     WHERE c.segment <> 'internal'
  ), ex AS (
    SELECT c.user_id, c.onboarded,
      EXISTS (SELECT 1 FROM public.engagement_metrics em
               WHERE em.user_id = c.user_id AND em.event_kind IN ('seen_deck', 'seen_expand')) AS saw_deck,
      (EXISTS (SELECT 1 FROM public.saved_card sc WHERE sc.profile_id = c.user_id)
        OR EXISTS (SELECT 1 FROM public.engagement_metrics em
                    WHERE em.user_id = c.user_id AND em.event_kind = 'saved')) AS saved,
      EXISTS (SELECT 1 FROM public.orders o
               WHERE o.buyer_user_id = c.user_id
                 AND o.payment_status IN ('paid', 'partial_refund', 'refunded')) AS ticket
      FROM cls c
  ), owned AS (
    SELECT c.user_id, b.id AS brand_id, b.stripe_connect_id, b.stripe_payouts_enabled
      FROM cls c
      JOIN public.brands b ON b.account_id = c.user_id AND b.deleted_at IS NULL
     WHERE c.segment IN ('host', 'both')
  ), ho AS (
    SELECT c.user_id,
      EXISTS (SELECT 1 FROM owned o WHERE o.user_id = c.user_id) AS brand,
      EXISTS (SELECT 1 FROM owned o WHERE o.user_id = c.user_id AND (
                o.stripe_connect_id IS NOT NULL
                OR EXISTS (SELECT 1 FROM public.brand_paystack_recipients r WHERE r.brand_id = o.brand_id)
                OR EXISTS (SELECT 1 FROM public.brand_appsflyer_milestones m
                            WHERE m.brand_id = o.brand_id AND m.first_bank_added_at IS NOT NULL))) AS bank,
      EXISTS (SELECT 1 FROM owned o JOIN public.events e ON e.brand_id = o.brand_id
               WHERE o.user_id = c.user_id AND e.published_at IS NOT NULL) AS published,
      EXISTS (SELECT 1 FROM owned o JOIN public.events e ON e.brand_id = o.brand_id
                JOIN public.orders ord ON ord.event_id = e.id
               WHERE o.user_id = c.user_id
                 AND ord.payment_status IN ('paid', 'partial_refund', 'refunded')
                 AND COALESCE(ord.payment_method, '') <> 'free'
                 AND COALESCE(ord.buyer_total_cents, ord.total_cents, 0) > 0) AS sold,
      EXISTS (SELECT 1 FROM owned o WHERE o.user_id = c.user_id AND (
                EXISTS (SELECT 1 FROM public.brand_payout_releases r
                         WHERE r.brand_id = o.brand_id AND r.status = 'released'
                           AND r.organiser_cash_delivered_cents > 0)
                OR EXISTS (SELECT 1 FROM public.payouts p
                            WHERE p.brand_id = o.brand_id AND p.status = 'paid'))) AS paid_out
      FROM cls c WHERE c.segment IN ('host', 'both')
  ), co AS (
    SELECT s.status,
      EXISTS (SELECT 1 FROM public.tickets t
               WHERE s.order_id IS NOT NULL AND t.order_id = s.order_id AND t.used_at IS NOT NULL) AS checked_in
      FROM public.ticket_checkout_sessions s
     -- Buyer decides, as for tickets (analytics_dr_tickets).
     WHERE NOT (s.buyer_user_id IS NOT NULL AND public.admin_account_is_internal(s.buyer_user_id))
       AND NOT public.admin_internal_email_rule(s.buyer_email)
  )
  SELECT jsonb_build_object(
    'explorer', jsonb_build_array(
      jsonb_build_object('key', 'signed_up',  'count', (SELECT count(*) FROM ex)),
      jsonb_build_object('key', 'onboarded',  'count', (SELECT count(*) FROM ex WHERE onboarded)),
      jsonb_build_object('key', 'saw_deck',   'count', (SELECT count(*) FROM ex WHERE onboarded AND saw_deck)),
      jsonb_build_object('key', 'saved_card', 'count', (SELECT count(*) FROM ex WHERE onboarded AND saw_deck AND saved)),
      jsonb_build_object('key', 'got_ticket', 'count', (SELECT count(*) FROM ex WHERE onboarded AND saw_deck AND saved AND ticket))),
    'host', jsonb_build_array(
      jsonb_build_object('key', 'became_host',   'count', (SELECT count(*) FROM ho)),
      jsonb_build_object('key', 'created_brand', 'count', (SELECT count(*) FROM ho WHERE brand)),
      jsonb_build_object('key', 'added_bank',    'count', (SELECT count(*) FROM ho WHERE brand AND bank)),
      jsonb_build_object('key', 'published',     'count', (SELECT count(*) FROM ho WHERE brand AND bank AND published)),
      jsonb_build_object('key', 'first_sale',    'count', (SELECT count(*) FROM ho WHERE brand AND bank AND published AND sold)),
      jsonb_build_object('key', 'first_payout',  'count', (SELECT count(*) FROM ho WHERE brand AND bank AND published AND sold AND paid_out))),
    'checkout', jsonb_build_array(
      jsonb_build_object('key', 'started',    'count', (SELECT count(*) FROM co)),
      jsonb_build_object('key', 'completed',  'count', (SELECT count(*) FROM co WHERE status IN ('paid_completed', 'free_completed'))),
      jsonb_build_object('key', 'checked_in', 'count', (SELECT count(*) FROM co WHERE status IN ('paid_completed', 'free_completed') AND checked_in)))
  )
$$;
REVOKE ALL ON FUNCTION public.analytics_dr_funnels() FROM PUBLIC, anon, authenticated;

-- Retention D7 / D30 / D90 by sign-up month (definition in the header).
CREATE OR REPLACE FUNCTION public.analytics_dr_retention()
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public, pg_temp
SET TimeZone = 'UTC'
AS $$
  WITH cls AS MATERIALIZED (
    SELECT user_id, segment FROM public.admin_people_classified()
  ), cohort AS MATERIALIZED (
    SELECT 'explorer'::text AS side, c.user_id, p.created_at AS started_at
      FROM cls c JOIN public.profiles p ON p.id = c.user_id
     WHERE c.segment IN ('explorer', 'both') AND p.created_at IS NOT NULL
    UNION ALL
    SELECT 'host', c.user_id, COALESCE(ca.created_at, p.created_at)
      FROM cls c JOIN public.profiles p ON p.id = c.user_id
      LEFT JOIN public.creator_accounts ca ON ca.id = c.user_id
     WHERE c.segment IN ('host', 'both') AND COALESCE(ca.created_at, p.created_at) IS NOT NULL
  ), act AS MATERIALIZED (
    SELECT a.user_id, a.side, a.at FROM public.analytics_dr_activity() a
     WHERE a.user_id IN (SELECT user_id FROM cohort)
  ), marks AS MATERIALIZED (
    SELECT co.side, co.user_id, date_trunc('month', co.started_at) AS cohort_month, n.n,
           co.started_at + make_interval(days => n.n + 7) <= now() AS eligible,
           EXISTS (SELECT 1 FROM act a
                    WHERE a.user_id = co.user_id AND a.side = co.side
                      AND a.at >= co.started_at + make_interval(days => n.n)
                      AND a.at <  co.started_at + make_interval(days => n.n + 7)) AS retained
      FROM cohort co CROSS JOIN (VALUES (7), (30), (90)) AS n(n)
  ), cells AS (
    SELECT side, cohort_month, n,
           count(*) AS people,
           CASE WHEN bool_and(eligible)
                THEN round(100.0 * count(*) FILTER (WHERE retained) / count(*), 1) END AS pct
      FROM marks GROUP BY side, cohort_month, n
  ), overall AS (
    SELECT side, n,
           count(*) FILTER (WHERE eligible) AS eligible,
           CASE WHEN count(*) FILTER (WHERE eligible) > 0
                THEN round(100.0 * count(*) FILTER (WHERE eligible AND retained)
                           / count(*) FILTER (WHERE eligible), 1) END AS pct
      FROM marks GROUP BY side, n
  )
  SELECT jsonb_build_object(
    'definition', 'Dn = share of a sign-up cohort active on any of days n to n+6 after signing up. NULL until every member''s window has passed.',
    'overall', COALESCE((SELECT jsonb_object_agg(side, v) FROM (
        SELECT side, jsonb_object_agg('d' || n, jsonb_build_object('pct', pct, 'eligible', eligible)) AS v
          FROM overall GROUP BY side) o), '{}'::jsonb),
    'cohorts', COALESCE((SELECT jsonb_object_agg(side, v) FROM (
        SELECT side, jsonb_agg(jsonb_build_object(
                 'month', to_char(cohort_month, 'YYYY-MM'), 'people', people,
                 'd7', d7, 'd30', d30, 'd90', d90) ORDER BY cohort_month) AS v
          FROM (
            SELECT side, cohort_month, max(people) AS people,
                   max(pct) FILTER (WHERE n = 7)  AS d7,
                   max(pct) FILTER (WHERE n = 30) AS d30,
                   max(pct) FILTER (WHERE n = 90) AS d90
              FROM cells GROUP BY side, cohort_month) m
         GROUP BY side) c), '{}'::jsonb)
  )
$$;
REVOKE ALL ON FUNCTION public.analytics_dr_retention() FROM PUBLIC, anon, authenticated;

-- Money per week and the last 30 days, from Wave 2a's money lines. Each
-- currency stays separate; usd_cents is rounded once per currency and day and
-- is NULL when any line in it has no stored rate.
CREATE OR REPLACE FUNCTION public.analytics_dr_money()
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public, pg_temp
SET TimeZone = 'UTC'
AS $$
  WITH ln AS MATERIALIZED (
    SELECT l.kind, l.cur, l.at, l.amount,
           public.fx_usd_minor_exact(l.amount, l.cur, l.at) AS usd_x,
           public.fx_rate_on(l.cur, l.at) IS NULL AS missing
      FROM public.mingla_money_lines(date_trunc('week', now()) - interval '25 weeks', now()) l
     WHERE l.kind IN ('buyers_paid', 'fee', 'profit')
  ), day_agg AS (
    SELECT kind, cur, date_trunc('day', at) AS d, sum(amount) AS amt,
           round(sum(usd_x)) AS usd, bool_or(missing) AS missing, count(*) AS n
      FROM ln GROUP BY 1, 2, 3
  ), wk AS (
    SELECT date_trunc('week', d) AS wk, cur,
           sum(amt) FILTER (WHERE kind = 'buyers_paid')::bigint AS paid,
           sum(amt) FILTER (WHERE kind = 'fee')::bigint AS fee,
           CASE WHEN bool_or(missing) FILTER (WHERE kind = 'buyers_paid') THEN NULL
                ELSE sum(usd) FILTER (WHERE kind = 'buyers_paid') END::bigint AS paid_usd,
           CASE WHEN bool_or(missing) FILTER (WHERE kind = 'fee') THEN NULL
                ELSE sum(usd) FILTER (WHERE kind = 'fee') END::bigint AS fee_usd,
           sum(n) FILTER (WHERE kind = 'buyers_paid')::int AS paid_orders
      FROM day_agg GROUP BY 1, 2
  ), m30 AS (
    SELECT kind, cur, sum(amt)::bigint AS cents,
           CASE WHEN bool_or(missing) THEN NULL ELSE sum(usd)::bigint END AS usd_cents
      FROM day_agg WHERE d >= date_trunc('day', now() - interval '30 days')
     GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'weekly', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'week_start', to_char(wk, 'YYYY-MM-DD'), 'currency', cur,
        'buyers_paid_cents', COALESCE(paid, 0), 'buyers_paid_usd_cents', paid_usd,
        'fee_cents', COALESCE(fee, 0), 'fee_usd_cents', fee_usd,
        'paid_orders', COALESCE(paid_orders, 0)) ORDER BY wk, cur) FROM wk), '[]'::jsonb),
    'last_30d', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'kind', kind, 'currency', cur, 'cents', cents, 'usd_cents', usd_cents)
        ORDER BY kind, cur) FROM m30), '[]'::jsonb),
    -- The only cross-currency figures: US dollar sums, NULL if any part is NULL.
    'last_30d_usd', jsonb_build_object(
      'buyers_paid', (SELECT CASE WHEN bool_or(usd_cents IS NULL) THEN NULL ELSE sum(usd_cents) END
                        FROM m30 WHERE kind = 'buyers_paid'),
      'fee',         (SELECT CASE WHEN bool_or(usd_cents IS NULL) THEN NULL ELSE sum(usd_cents) END
                        FROM m30 WHERE kind = 'fee'),
      'profit',      (SELECT CASE WHEN bool_or(usd_cents IS NULL) THEN NULL ELSE sum(usd_cents) END
                        FROM m30 WHERE kind = 'profit'))
  )
$$;
REVOKE ALL ON FUNCTION public.analytics_dr_money() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.analytics_dr_compute(p_section text)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN CASE p_section
    WHEN 'users'     THEN public.analytics_dr_users()
    WHEN 'overview'  THEN public.analytics_dr_overview()
    WHEN 'explorers' THEN public.analytics_dr_explorers()
    WHEN 'hosts'     THEN public.analytics_dr_hosts()
    WHEN 'funnels'   THEN public.analytics_dr_funnels()
    WHEN 'retention' THEN public.analytics_dr_retention()
    WHEN 'money'     THEN public.analytics_dr_money()
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.analytics_dr_compute(text) FROM PUBLIC, anon, authenticated;

--------------------------------------------------------------------------------
-- 5. Snapshot writer (nightly) and reader.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_daily_snapshot_refresh()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_date date := (now() AT TIME ZONE 'UTC')::date;
  v_section text;
  v_n integer := 0;
BEGIN
  -- One writer at a time; a second run the same day replaces the rows.
  PERFORM pg_advisory_xact_lock(hashtext('issue_4130_analytics_daily_snapshot'));
  FOREACH v_section IN ARRAY ARRAY['users', 'overview', 'explorers', 'hosts', 'funnels', 'retention', 'money'] LOOP
    INSERT INTO public.analytics_daily_snapshot (snapshot_date, section, payload, computed_at)
    VALUES (v_date, v_section, public.analytics_dr_compute(v_section), now())
    ON CONFLICT (snapshot_date, section) DO UPDATE
      SET payload = EXCLUDED.payload, computed_at = EXCLUDED.computed_at;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
COMMENT ON FUNCTION public.analytics_daily_snapshot_refresh() IS
  'Issue #4130: writes today''s (UTC) Data room snapshot, one row per section. Idempotent: a re-run replaces that day''s rows. Run nightly by pg_cron job issue_4130_analytics_daily_snapshot.';
REVOKE ALL ON FUNCTION public.analytics_daily_snapshot_refresh() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_daily_snapshot_refresh() TO service_role;

CREATE OR REPLACE FUNCTION public.analytics_dr_read(p_section text, p_as_of date)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.analytics_daily_snapshot%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  SELECT * INTO v_row FROM public.analytics_daily_snapshot
   WHERE section = p_section AND snapshot_date = COALESCE(p_as_of, v_today);
  IF FOUND THEN
    RETURN jsonb_build_object('section', p_section, 'source', 'snapshot',
      'snapshot_date', v_row.snapshot_date, 'as_of', v_row.computed_at, 'data', v_row.payload);
  END IF;
  IF p_as_of IS NOT NULL AND p_as_of <> v_today THEN
    RAISE EXCEPTION 'no_snapshot_for_day' USING ERRCODE = 'P0002';
  END IF;
  -- Live fallback for today, before tonight's job has run.
  RETURN jsonb_build_object('section', p_section, 'source', 'live',
    'snapshot_date', NULL, 'as_of', now(), 'data', public.analytics_dr_compute(p_section));
END;
$$;
REVOKE ALL ON FUNCTION public.analytics_dr_read(text, date) FROM PUBLIC, anon, authenticated;

--------------------------------------------------------------------------------
-- 6. The page's reads. Gate first, then the snapshot (or live for today).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_data_room_users(p_as_of date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.admin_data_room_allowed() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN public.analytics_dr_read('users', p_as_of);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_data_room_overview(p_as_of date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.admin_data_room_allowed() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN public.analytics_dr_read('overview', p_as_of);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_data_room_explorers(p_as_of date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.admin_data_room_allowed() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN public.analytics_dr_read('explorers', p_as_of);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_data_room_hosts(p_as_of date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.admin_data_room_allowed() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN public.analytics_dr_read('hosts', p_as_of);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_data_room_funnels(p_as_of date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.admin_data_room_allowed() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN public.analytics_dr_read('funnels', p_as_of);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_data_room_retention(p_as_of date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.admin_data_room_allowed() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN public.analytics_dr_read('retention', p_as_of);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_data_room_money(p_as_of date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.admin_data_room_allowed() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN public.analytics_dr_read('money', p_as_of);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_data_room_snapshot_dates()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.admin_data_room_allowed() THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(d ORDER BY d DESC) FROM (
      SELECT DISTINCT snapshot_date AS d FROM public.analytics_daily_snapshot
       ORDER BY snapshot_date DESC LIMIT 90) x), '[]'::jsonb);
END;
$$;

DO $grants$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_data_room_users(date)',
    'public.admin_data_room_overview(date)',
    'public.admin_data_room_explorers(date)',
    'public.admin_data_room_hosts(date)',
    'public.admin_data_room_funnels(date)',
    'public.admin_data_room_retention(date)',
    'public.admin_data_room_money(date)',
    'public.admin_data_room_snapshot_dates()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_fn);
  END LOOP;
END
$grants$;

--------------------------------------------------------------------------------
-- 7. The nightly job (00:20 UTC). Re-running this migration replaces it.
--------------------------------------------------------------------------------
DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'Issue #4130: pg_cron unavailable; Data room snapshot not scheduled (pages read live).';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'issue_4130_analytics_daily_snapshot') THEN
    PERFORM cron.unschedule('issue_4130_analytics_daily_snapshot');
  END IF;
  PERFORM cron.schedule('issue_4130_analytics_daily_snapshot', '20 0 * * *',
    $job$SELECT public.analytics_daily_snapshot_refresh();$job$);
END
$cron$;

COMMIT;
