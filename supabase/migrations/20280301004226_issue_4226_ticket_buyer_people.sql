-- Issue #4226 — Ticket buyers in Mingla Admin (People, Email, Data room).
--
-- Today People, the Email tab and the Data room all start from `profiles`, so
-- the people who bought or were given a ticket on the web checkout without
-- ever making an account are invisible. This migration adds ONE list of people
-- that every admin surface reads:
--
--   1. admin_country_from_e164(text) — country (ISO 3166-1 alpha-2) from a
--      phone number's calling code, for people without a profile country.
--   2. admin_people_app_status() — the People classifier with its parts
--      (explorer? host? staff/test?). admin_people_classified() now delegates
--      to it, so People, Email and the Data room share one definition.
--   3. admin_people_directory_rows() — one row per person: every non-seed
--      profile, plus every ticket person with no account, keyed by the
--      normalised email lower(btrim(email)). Ticket people come from paid
--      orders (buyer_email, buyer_user_id) and from the non-void tickets on
--      paid orders (holder_user_id, holder_email, else attendee_email, else
--      the buyer). A ticket email that belongs to an account (profile email
--      first, then sign-in email) is folded into that account's row, so a
--      buyer who later signs up appears once.
--      admin_people_directory() — the same rows behind the admin guard
--      (an admin signed in, or the service role used by admin-send-email).
--   4. admin_people_segments() / admin_list_people(...) gain the segment
--      'ticket_buyer_no_app' and ticket facts on every row.
--   5. analytics_dr_users() gains the ticket-buyer block for the Data room.
--   6. admin_email_log gains no_consent_count and internal_excluded_count so
--      a campaign's history shows who was left out and why.
--
-- The ticket-buyer segment (Seth, 2026-11-01, issue #4226):
--   has a paid ticket (bought, comp'd or held / transferred to them)
--   AND has not finished Explorer onboarding (no account, or
--       profiles.has_completed_onboarding is not true, or the Explorer
--       profile was deleted)
--   AND is not staff or test.
-- Staff or test means: an account that admin_account_is_internal() calls
-- internal, or (no account) an email that admin_internal_email_rule() matches.
-- A brand's internal flag (admin_brand_is_internal) is NEVER used here: We Go
-- Again Exhibition is a real brand whose owner account is staff, and its
-- buyers are real people.
--
-- Double counting (decision recorded on #4226): an account holder who got a
-- ticket but never finished Explorer onboarding keeps their People segment
-- (incomplete, or host when they host) AND appears in the ticket-buyer tab.
-- The tabs are views, not a partition: 'people' still counts accounts only,
-- and the ticket-buyer count is reported separately, never added to it.
--
-- Marketing consent per person ('yes' | 'no' | 'unsubscribed'):
--   'unsubscribed' when any of their emails is in channel_suppressions
--     (channel email, scope marketing or all, any brand) or in
--     marketing_unsubscribes, or a channel_suppressions row names their
--     account — the same lists admin-send-email suppresses on;
--   else the latest signal wins between consent_records (scope marketing,
--     channel email; granted / revoked) and paid orders'
--     metadata->>'marketing_opt_in' ('true' / 'false'): 'yes' when it is a
--     grant, otherwise 'no'.
--
-- Invariant (declared in the pg17 test): I-4226-TICKET-PEOPLE-ONE-LIST | issue #4226 | People, the Email audiences and the Data room read one admin-only list of people (profiles plus ticket people with no account, one row per normalised email); the ticket-buyer segment excludes staff and test only by account or email, never by brand.

BEGIN;

--------------------------------------------------------------------------------
-- 1. Country from a phone number's calling code.
--------------------------------------------------------------------------------
-- E.164 calling codes are prefix-free, so checking three digits, then two,
-- then one is unambiguous. +1 is shared by the US, Canada and the Caribbean;
-- it reads as US. Anything not listed is NULL ("Not known"), never a guess.
CREATE OR REPLACE FUNCTION public.admin_country_from_e164(p_phone text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN v !~ '^\+[1-9][0-9]{5,14}$' THEN NULL
    -- three-digit codes
    WHEN v LIKE '+234%' THEN 'NG'
    WHEN v LIKE '+233%' THEN 'GH'
    WHEN v LIKE '+254%' THEN 'KE'
    WHEN v LIKE '+255%' THEN 'TZ'
    WHEN v LIKE '+256%' THEN 'UG'
    WHEN v LIKE '+250%' THEN 'RW'
    WHEN v LIKE '+237%' THEN 'CM'
    WHEN v LIKE '+225%' THEN 'CI'
    WHEN v LIKE '+221%' THEN 'SN'
    WHEN v LIKE '+353%' THEN 'IE'
    WHEN v LIKE '+971%' THEN 'AE'
    -- two-digit codes
    WHEN v LIKE '+27%' THEN 'ZA'
    WHEN v LIKE '+44%' THEN 'GB'
    WHEN v LIKE '+32%' THEN 'BE'
    WHEN v LIKE '+33%' THEN 'FR'
    WHEN v LIKE '+49%' THEN 'DE'
    WHEN v LIKE '+31%' THEN 'NL'
    WHEN v LIKE '+34%' THEN 'ES'
    WHEN v LIKE '+39%' THEN 'IT'
    WHEN v LIKE '+91%' THEN 'IN'
    WHEN v LIKE '+61%' THEN 'AU'
    -- one-digit code
    WHEN v LIKE '+1%' THEN 'US'
    ELSE NULL
  END
  FROM (
    SELECT regexp_replace(
             regexp_replace(btrim(COALESCE(p_phone, '')), '^00', '+'),
             '[\s().-]', '', 'g') AS v
  ) x
$$;
COMMENT ON FUNCTION public.admin_country_from_e164(text) IS
  'Issue #4226: ISO country from an E.164 phone calling code (NG, US, GB, GH, ZA, KE and a few more); NULL when unknown.';
REVOKE ALL ON FUNCTION public.admin_country_from_e164(text) FROM PUBLIC, anon, authenticated;

--------------------------------------------------------------------------------
-- 2. The People classifier, with its parts.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_people_app_status()
RETURNS TABLE (user_id uuid, segment text, app_status text, has_explorer boolean,
               is_host boolean, is_internal boolean)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p.id,
    CASE
      WHEN i.is_internal THEN 'internal'
      WHEN h.is_host AND x.is_explorer THEN 'both'
      WHEN h.is_host THEN 'host'
      WHEN x.is_explorer THEN 'explorer'
      ELSE 'incomplete'
    END,
    CASE
      WHEN h.is_host AND x.is_explorer THEN 'both'
      WHEN h.is_host THEN 'host'
      WHEN x.is_explorer THEN 'explorer'
      ELSE 'incomplete'
    END,
    x.is_explorer,
    h.is_host,
    i.is_internal
  FROM public.profiles p
  CROSS JOIN LATERAL (
    SELECT (COALESCE(p.has_completed_onboarding, false) AND p.explorer_deleted_at IS NULL) AS is_explorer
  ) x
  CROSS JOIN LATERAL (
    SELECT (
      EXISTS (SELECT 1 FROM public.creator_accounts ca WHERE ca.id = p.id AND ca.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.brand_team_members m
                  WHERE m.user_id = p.id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL)
    ) AS is_host
  ) h
  CROSS JOIN LATERAL (SELECT public.admin_account_is_internal(p.id) AS is_internal) i
  WHERE COALESCE(p.is_seed, false) = false
$$;
REVOKE ALL ON FUNCTION public.admin_people_app_status() FROM PUBLIC, anon, authenticated;

-- Same signature and answers as #4130; now one owner.
CREATE OR REPLACE FUNCTION public.admin_people_classified()
RETURNS TABLE (user_id uuid, segment text)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT s.user_id, s.segment FROM public.admin_people_app_status() s
$$;
REVOKE ALL ON FUNCTION public.admin_people_classified() FROM PUBLIC, anon, authenticated;

--------------------------------------------------------------------------------
-- 3. One row per person.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_people_directory_rows()
RETURNS TABLE (
  person_key               text,
  user_id                  uuid,
  email                    text,
  name                     text,
  first_name               text,
  display_name             text,
  username                 text,
  phone_e164               text,
  segment                  text,
  app_status               text,
  is_internal              boolean,
  has_explorer             boolean,
  is_ticket_holder         boolean,
  in_ticket_buyer_segment  boolean,
  tickets_count            integer,
  orders_count             integer,
  spent                    jsonb,
  last_spent_cents         bigint,
  last_currency            text,
  first_purchase_at        timestamptz,
  last_purchase_at         timestamptz,
  last_event_city          text,
  event_cities             text[],
  country                  text,
  marketing_consent        text,
  brand_ids                uuid[],
  brands                   jsonb,
  created_at               timestamptz,
  preferred_language       text,
  has_completed_onboarding boolean,
  email_verified           boolean,
  active                   boolean,
  is_beta_tester           boolean
)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  WITH
  -- Every email that belongs to an account with a profile: the profile email
  -- first, then the sign-in email.
  acct_email AS MATERIALIZED (
    SELECT DISTINCT ON (x.email) x.email, x.user_id
      FROM (
        SELECT lower(btrim(p.email)) AS email, p.id AS user_id, 0 AS pri, p.created_at
          FROM public.profiles p
         WHERE NULLIF(btrim(p.email), '') IS NOT NULL
        UNION ALL
        SELECT lower(btrim(u.email)), u.id, 1, u.created_at
          FROM auth.users u
         WHERE NULLIF(btrim(u.email), '') IS NOT NULL
           AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
      ) x
     ORDER BY x.email, x.pri, x.created_at
  ),
  paid AS MATERIALIZED (
    SELECT o.id, o.event_id, o.created_at, upper(btrim(o.currency)) AS currency,
           COALESCE(o.buyer_total_cents, o.total_cents, 0) - COALESCE(o.refunded_amount_cents, 0) AS spent_cents,
           NULLIF(lower(btrim(o.buyer_email)), '') AS buyer_email,
           o.buyer_user_id, o.buyer_name, o.buyer_phone_e164,
           o.metadata ->> 'marketing_opt_in' AS opt_in
      FROM public.orders o
     WHERE o.payment_status = 'paid'
  ),
  -- One row per (order, role): the buyer of each paid order, and the holder
  -- of each live ticket on it (a ticket with no holder email is the buyer's).
  contacts AS MATERIALIZED (
    SELECT pd.id AS order_id, 'buyer'::text AS role, NULL::uuid AS ticket_id,
           pd.buyer_user_id AS raw_uid, pd.buyer_email AS email,
           pd.buyer_name AS name, pd.buyer_phone_e164 AS phone, pd.created_at AS at
      FROM paid pd
    UNION ALL
    SELECT t.order_id, 'holder', t.id,
           COALESCE(t.holder_user_id, CASE WHEN h.email IS NULL THEN pd.buyer_user_id END),
           COALESCE(h.email, pd.buyer_email),
           COALESCE(NULLIF(btrim(t.holder_name), ''), NULLIF(btrim(t.attendee_name), ''),
                    CASE WHEN h.email IS NULL THEN pd.buyer_name END),
           COALESCE(NULLIF(btrim(t.holder_phone_e164), ''), CASE WHEN h.email IS NULL THEN pd.buyer_phone_e164 END),
           pd.created_at
      FROM public.tickets t
      JOIN paid pd ON pd.id = t.order_id
      CROSS JOIN LATERAL (
        SELECT NULLIF(lower(btrim(COALESCE(NULLIF(btrim(t.holder_email), ''), t.attendee_email))), '') AS email
      ) h
     WHERE t.status <> 'void'
  ),
  keyed AS MATERIALIZED (
    SELECT r.*,
           CASE WHEN r.user_id IS NOT NULL THEN 'u:' || r.user_id::text ELSE 'e:' || r.email END AS person_key
      FROM (
        SELECT c.*,
               COALESCE(
                 (SELECT pr.id FROM public.profiles pr WHERE pr.id = c.raw_uid),
                 (SELECT ae.user_id FROM acct_email ae WHERE ae.email = c.email)) AS user_id
          FROM contacts c
      ) r
     WHERE r.user_id IS NOT NULL OR r.email IS NOT NULL
  ),
  ticket_agg AS (
    SELECT k.person_key,
           (array_agg(k.user_id) FILTER (WHERE k.user_id IS NOT NULL))[1] AS user_id,
           (array_agg(k.email ORDER BY k.at DESC) FILTER (WHERE k.email IS NOT NULL))[1] AS email,
           (array_agg(btrim(k.name) ORDER BY k.at DESC) FILTER (WHERE NULLIF(btrim(k.name), '') IS NOT NULL))[1] AS name,
           (array_agg(btrim(k.phone) ORDER BY k.at DESC) FILTER (WHERE NULLIF(btrim(k.phone), '') IS NOT NULL))[1] AS phone,
           count(DISTINCT k.ticket_id)::integer AS tickets_count,
           count(DISTINCT k.order_id) FILTER (WHERE k.role = 'buyer')::integer AS orders_count,
           min(k.at) AS first_at,
           max(k.at) AS last_at
      FROM keyed k
     GROUP BY k.person_key
  ),
  spend AS (
    SELECT s.person_key, jsonb_object_agg(s.currency, s.cents ORDER BY s.currency) AS spent
      FROM (
        SELECT k.person_key, pd.currency, sum(pd.spent_cents)::bigint AS cents
          FROM (SELECT DISTINCT person_key, order_id FROM keyed WHERE role = 'buyer') k
          JOIN paid pd ON pd.id = k.order_id
         WHERE pd.currency IS NOT NULL AND pd.spent_cents > 0
         GROUP BY 1, 2
      ) s
     GROUP BY s.person_key
  ),
  last_spend AS (
    SELECT DISTINCT ON (k.person_key) k.person_key, pd.spent_cents::bigint AS cents, pd.currency
      FROM (SELECT DISTINCT person_key, order_id FROM keyed WHERE role = 'buyer') k
      JOIN paid pd ON pd.id = k.order_id
     WHERE pd.currency IS NOT NULL AND pd.spent_cents > 0
     ORDER BY k.person_key, pd.created_at DESC
  ),
  event_agg AS (
    SELECT k.person_key,
           (array_agg(ev.city ORDER BY pd.created_at DESC) FILTER (WHERE ev.city IS NOT NULL))[1] AS last_event_city,
           array_agg(DISTINCT ev.city) FILTER (WHERE ev.city IS NOT NULL) AS event_cities,
           array_agg(DISTINCT e.brand_id) FILTER (WHERE e.brand_id IS NOT NULL) AS brand_ids
      FROM (SELECT DISTINCT person_key, order_id FROM keyed) k
      JOIN paid pd ON pd.id = k.order_id
      LEFT JOIN public.events e ON e.id = pd.event_id
      CROSS JOIN LATERAL (
        SELECT COALESCE(NULLIF(btrim(e.city), ''), NULLIF(btrim(e.destination_city), ''),
                        NULLIF(btrim(e.departure_city), '')) AS city
      ) ev
     GROUP BY k.person_key
  ),
  accounts AS (
    SELECT s.user_id, s.segment, s.app_status, s.has_explorer, s.is_internal,
           p.email AS profile_email, p.first_name, p.display_name, p.username, p.phone,
           p.country AS profile_country, p.created_at, p.preferred_language,
           p.has_completed_onboarding, p.email_verified, p.active, p.is_beta_tester,
           u.email AS auth_email,
           COALESCE(
             NULLIF(btrim(p.display_name), ''),
             NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
             NULLIF(btrim(ca.display_name), ''),
             NULLIF(btrim(ca.business_name), ''),
             NULLIF(btrim(p.username), '')
           ) AS account_name
      FROM public.admin_people_app_status() s
      JOIN public.profiles p ON p.id = s.user_id
      LEFT JOIN auth.users u ON u.id = s.user_id
      LEFT JOIN public.creator_accounts ca ON ca.id = s.user_id
  ),
  universe AS (
    SELECT 'u:' || a.user_id::text AS person_key, a.user_id,
           COALESCE(NULLIF(lower(btrim(a.profile_email)), ''), NULLIF(lower(btrim(a.auth_email)), ''), t.email) AS email,
           COALESCE(a.account_name, t.name) AS name,
           a.first_name, a.display_name, a.username,
           COALESCE(NULLIF(btrim(a.phone), ''), t.phone) AS phone_e164,
           a.segment, a.app_status, a.is_internal, a.has_explorer,
           NULLIF(btrim(a.profile_country), '') AS profile_country,
           a.created_at, a.preferred_language, a.has_completed_onboarding,
           a.email_verified, a.active, a.is_beta_tester
      FROM accounts a
      LEFT JOIN ticket_agg t ON t.person_key = 'u:' || a.user_id::text
    UNION ALL
    SELECT t.person_key, NULL::uuid, t.email, t.name,
           NULL::text, NULL::text, NULL::text,
           t.phone,
           CASE WHEN public.admin_internal_email_rule(t.email) THEN 'internal' ELSE 'ticket_buyer_no_app' END,
           'ticket_buyer_no_app',
           public.admin_internal_email_rule(t.email),
           false,
           NULL::text,
           NULL::timestamptz, NULL::text, NULL::boolean, NULL::boolean, NULL::boolean, NULL::boolean
      FROM ticket_agg t
     WHERE t.user_id IS NULL
  ),
  -- Every email a person is known by, for consent and suppression.
  person_emails AS (
    SELECT DISTINCT x.person_key, x.email
      FROM (
        SELECT un.person_key, un.email FROM universe un
        UNION ALL
        SELECT k.person_key, k.email FROM keyed k
        UNION ALL
        SELECT 'u:' || a.user_id::text, lower(btrim(a.auth_email)) FROM accounts a
      ) x
     WHERE NULLIF(x.email, '') IS NOT NULL
  ),
  suppressed AS (
    SELECT DISTINCT pe.person_key
      FROM person_emails pe
     WHERE EXISTS (SELECT 1 FROM public.channel_suppressions cs
                    WHERE cs.channel = 'email' AND cs.scope IN ('marketing', 'all')
                      AND lower(btrim(cs.contact)) = pe.email)
        OR EXISTS (SELECT 1 FROM public.marketing_unsubscribes mu
                    WHERE lower(btrim(mu.contact_email)) = pe.email)
    UNION
    SELECT 'u:' || cs.user_id::text
      FROM public.channel_suppressions cs
     WHERE cs.user_id IS NOT NULL AND cs.channel = 'email' AND cs.scope IN ('marketing', 'all')
  ),
  consent_latest AS (
    SELECT DISTINCT ON (sig.person_key) sig.person_key, sig.granted
      FROM (
        SELECT pe.person_key, cr.created_at AS at, (cr.action = 'granted') AS granted
          FROM person_emails pe
          JOIN public.consent_records cr
            ON cr.scope = 'marketing' AND cr.channel = 'email' AND lower(btrim(cr.contact)) = pe.email
        UNION ALL
        SELECT 'u:' || cr.user_id::text, cr.created_at, (cr.action = 'granted')
          FROM public.consent_records cr
         WHERE cr.user_id IS NOT NULL AND cr.scope = 'marketing' AND cr.channel = 'email'
        UNION ALL
        SELECT k.person_key, pd.created_at, (pd.opt_in = 'true')
          FROM keyed k
          JOIN paid pd ON pd.id = k.order_id
         WHERE k.role = 'buyer' AND pd.opt_in IN ('true', 'false')
      ) sig
     ORDER BY sig.person_key, sig.at DESC, sig.granted ASC
  )
  SELECT
    un.person_key,
    un.user_id,
    un.email,
    un.name,
    un.first_name,
    un.display_name,
    un.username,
    un.phone_e164,
    un.segment,
    un.app_status,
    un.is_internal,
    un.has_explorer,
    (t.person_key IS NOT NULL) AS is_ticket_holder,
    (t.person_key IS NOT NULL AND NOT un.is_internal AND NOT un.has_explorer) AS in_ticket_buyer_segment,
    COALESCE(t.tickets_count, 0),
    COALESCE(t.orders_count, 0),
    COALESCE(sp.spent, '{}'::jsonb),
    ls.cents,
    ls.currency,
    t.first_at,
    t.last_at,
    ea.last_event_city,
    COALESCE(ea.event_cities, '{}'::text[]),
    COALESCE(un.profile_country, public.admin_country_from_e164(un.phone_e164)),
    CASE
      WHEN su.person_key IS NOT NULL THEN 'unsubscribed'
      WHEN cl.granted THEN 'yes'
      ELSE 'no'
    END,
    COALESCE(ea.brand_ids, '{}'::uuid[]),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) ORDER BY b.name)
        FROM public.brands b WHERE b.id = ANY (ea.brand_ids)), '[]'::jsonb),
    un.created_at,
    un.preferred_language,
    un.has_completed_onboarding,
    un.email_verified,
    un.active,
    un.is_beta_tester
  FROM universe un
  LEFT JOIN ticket_agg t ON t.person_key = un.person_key
  LEFT JOIN spend sp ON sp.person_key = un.person_key
  LEFT JOIN last_spend ls ON ls.person_key = un.person_key
  LEFT JOIN event_agg ea ON ea.person_key = un.person_key
  LEFT JOIN suppressed su ON su.person_key = un.person_key
  LEFT JOIN consent_latest cl ON cl.person_key = un.person_key
$$;
COMMENT ON FUNCTION public.admin_people_directory_rows() IS
  'Issue #4226: one row per person (non-seed profiles plus ticket people with no account, by normalised email) with app status, ticket facts, country and marketing consent. Helper: read only through admin RPCs.';
REVOKE ALL ON FUNCTION public.admin_people_directory_rows() FROM PUBLIC, anon, authenticated;

-- The same rows behind the guard: a signed-in admin, or the service role that
-- admin-send-email uses after its own admin check.
CREATE OR REPLACE FUNCTION public.admin_people_directory()
RETURNS TABLE (
  person_key               text,
  user_id                  uuid,
  email                    text,
  name                     text,
  first_name               text,
  display_name             text,
  username                 text,
  phone_e164               text,
  segment                  text,
  app_status               text,
  is_internal              boolean,
  has_explorer             boolean,
  is_ticket_holder         boolean,
  in_ticket_buyer_segment  boolean,
  tickets_count            integer,
  orders_count             integer,
  spent                    jsonb,
  last_spent_cents         bigint,
  last_currency            text,
  first_purchase_at        timestamptz,
  last_purchase_at         timestamptz,
  last_event_city          text,
  event_cities             text[],
  country                  text,
  marketing_consent        text,
  brand_ids                uuid[],
  brands                   jsonb,
  created_at               timestamptz,
  preferred_language       text,
  has_completed_onboarding boolean,
  email_verified           boolean,
  active                   boolean,
  is_beta_tester           boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.is_admin_user() OR COALESCE(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  RETURN QUERY SELECT * FROM public.admin_people_directory_rows();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_people_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_people_directory() TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 4. People: counts and lists.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_people_segments()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;

  WITH d AS MATERIALIZED (SELECT * FROM public.admin_people_directory_rows())
  SELECT jsonb_build_object(
    'explorer',   count(*) FILTER (WHERE d.user_id IS NOT NULL AND d.segment = 'explorer'),
    'host',       count(*) FILTER (WHERE d.user_id IS NOT NULL AND d.segment = 'host'),
    'both',       count(*) FILTER (WHERE d.user_id IS NOT NULL AND d.segment = 'both'),
    'incomplete', count(*) FILTER (WHERE d.user_id IS NOT NULL AND d.segment = 'incomplete'),
    'internal',   count(*) FILTER (WHERE d.user_id IS NOT NULL AND d.segment = 'internal'),
    'people',     count(*) FILTER (WHERE d.user_id IS NOT NULL AND d.segment <> 'internal'),
    -- #4226: views, not a partition (see the header): never add to 'people'.
    'ticket_buyer_no_app', count(*) FILTER (WHERE d.in_ticket_buyer_segment),
    'ticket_people',       count(*) FILTER (WHERE d.is_ticket_holder AND NOT d.is_internal),
    'ticket_people_no_account', count(*) FILTER (WHERE d.is_ticket_holder AND NOT d.is_internal AND d.user_id IS NULL),
    'countries',  COALESCE((
      SELECT jsonb_agg(DISTINCT d2.country ORDER BY d2.country)
        FROM d d2
       WHERE NULLIF(btrim(d2.country), '') IS NOT NULL
         AND (d2.user_id IS NOT NULL OR d2.in_ticket_buyer_segment)), '[]'::jsonb),
    'as_of',      now()
  ) INTO v_out
  FROM d;

  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_people_segments() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_people_segments() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_people(
  p_segment      text        DEFAULT 'explorer',
  p_search       text        DEFAULT NULL,
  p_country      text        DEFAULT NULL,
  p_joined_since timestamptz DEFAULT NULL,
  p_limit        integer     DEFAULT 25,
  p_offset       integer     DEFAULT 0,
  p_sort         text        DEFAULT 'joined_desc'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit  integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 1000);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_sort   text;
  v_total  bigint;
  v_rows   jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_segment IS NULL OR p_segment NOT IN ('explorer', 'host', 'both', 'incomplete', 'internal', 'ticket_buyer_no_app') THEN
    RAISE EXCEPTION 'invalid_segment';
  END IF;
  v_sort := CASE lower(COALESCE(p_sort, 'joined_desc'))
              WHEN 'joined_asc'       THEN 'joined_asc'
              WHEN 'name_asc'         THEN 'name_asc'
              WHEN 'name_desc'        THEN 'name_desc'
              WHEN 'last_active_desc' THEN 'last_active_desc'
              WHEN 'last_active_asc'  THEN 'last_active_asc'
              ELSE 'joined_desc'
            END;

  ------------------------------------------------------------------------------
  -- #4226: ticket buyers with no Explorer app. "Joined" is when they got their
  -- first ticket; "last active" is their latest ticket.
  ------------------------------------------------------------------------------
  IF p_segment = 'ticket_buyer_no_app' THEN
    WITH base AS (
      SELECT d.*
        FROM public.admin_people_directory_rows() d
       WHERE d.in_ticket_buyer_segment
         AND (p_country IS NULL OR d.country = p_country)
         AND (p_joined_since IS NULL OR d.first_purchase_at >= p_joined_since)
         AND (
           v_search IS NULL
           OR d.name ILIKE '%' || v_search || '%'
           OR d.email ILIKE '%' || v_search || '%'
           OR d.phone_e164 ILIKE '%' || v_search || '%'
           OR d.last_event_city ILIKE '%' || v_search || '%'
         )
    ),
    ranked AS (
      SELECT b.*, row_number() OVER (
        ORDER BY
          (CASE WHEN v_sort = 'joined_asc'       THEN b.first_purchase_at END) ASC NULLS LAST,
          (CASE WHEN v_sort = 'joined_desc'      THEN b.first_purchase_at END) DESC NULLS LAST,
          (CASE WHEN v_sort = 'name_asc'         THEN lower(b.name) END) ASC NULLS LAST,
          (CASE WHEN v_sort = 'name_desc'        THEN lower(b.name) END) DESC NULLS LAST,
          (CASE WHEN v_sort = 'last_active_asc'  THEN b.last_purchase_at END) ASC NULLS LAST,
          (CASE WHEN v_sort = 'last_active_desc' THEN b.last_purchase_at END) DESC NULLS LAST,
          b.last_purchase_at DESC NULLS LAST, b.person_key
      ) AS rn
      FROM base b
    )
    SELECT
      (SELECT count(*) FROM base),
      COALESCE(jsonb_agg(jsonb_build_object(
        'id',                r.user_id,
        'person_key',        r.person_key,
        'name',              r.name,
        'email',             r.email,
        'phone',             r.phone_e164,
        'country',           r.country,
        'joined_at',         r.created_at,
        'segment',           'ticket_buyer_no_app',
        'app_status',        r.app_status,
        'has_account',       (r.user_id IS NOT NULL),
        'event_city',        r.last_event_city,
        'tickets',           r.tickets_count,
        'orders',            r.orders_count,
        'spent',             r.spent,
        'last_spent_cents',  r.last_spent_cents,
        'last_currency',     r.last_currency,
        'first_purchase_at', r.first_purchase_at,
        'last_purchase_at',  r.last_purchase_at,
        'marketing_consent', r.marketing_consent,
        'brands_bought',     r.brands
      ) ORDER BY r.rn), '[]'::jsonb)
    INTO v_total, v_rows
    FROM ranked r
    WHERE r.rn > v_offset AND r.rn <= v_offset + v_limit;

    RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0));
  END IF;

  ------------------------------------------------------------------------------
  -- Account segments (#4130), now with ticket facts on every row.
  ------------------------------------------------------------------------------
  WITH dir AS MATERIALIZED (
    SELECT d.* FROM public.admin_people_directory_rows() d WHERE d.user_id IS NOT NULL
  ),
  base AS (
    SELECT p.id, p.email, p.phone, p.username, p.country, p.created_at, p.active,
           p.is_beta_tester, p.onboarding_step,
           COALESCE(
             NULLIF(btrim(p.display_name), ''),
             NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
             NULLIF(btrim(ca.display_name), ''),
             NULLIF(btrim(ca.business_name), ''),
             NULLIF(btrim(p.username), '')
           ) AS name,
           d.segment, d.app_status, d.is_ticket_holder, d.in_ticket_buyer_segment,
           d.tickets_count AS tickets_held, d.orders_count, d.spent, d.last_spent_cents,
           d.last_currency, d.last_purchase_at, d.last_event_city, d.marketing_consent
      FROM dir d
      JOIN public.profiles p ON p.id = d.user_id
      LEFT JOIN public.creator_accounts ca ON ca.id = p.id
     WHERE d.segment = p_segment
       AND (p_country IS NULL OR p.country = p_country)
       AND (p_joined_since IS NULL OR p.created_at >= p_joined_since)
       AND (
         v_search IS NULL
         OR p.display_name ILIKE '%' || v_search || '%'
         OR concat_ws(' ', p.first_name, p.last_name) ILIKE '%' || v_search || '%'
         OR p.username ILIKE '%' || v_search || '%'
         OR p.email ILIKE '%' || v_search || '%'
         OR p.phone ILIKE '%' || v_search || '%'
         OR ca.business_name ILIKE '%' || v_search || '%'
       )
  ),
  enriched AS (
    SELECT b.*,
      u.raw_app_meta_data ->> 'provider' AS sign_in_method,
      NULLIF(GREATEST(
        COALESCE(u.last_sign_in_at, '-infinity'::timestamptz),
        COALESCE((SELECT max(a.created_at) FROM public.user_activity a WHERE a.user_id = b.id), '-infinity'::timestamptz)
      ), '-infinity'::timestamptz) AS last_active
      FROM base b
      LEFT JOIN auth.users u ON u.id = b.id
  ),
  ranked AS (
    SELECT e.*, row_number() OVER (
      ORDER BY
        (CASE WHEN v_sort = 'joined_asc'       THEN e.created_at END) ASC NULLS LAST,
        (CASE WHEN v_sort = 'joined_desc'      THEN e.created_at END) DESC NULLS LAST,
        (CASE WHEN v_sort = 'name_asc'         THEN lower(e.name) END) ASC NULLS LAST,
        (CASE WHEN v_sort = 'name_desc'        THEN lower(e.name) END) DESC NULLS LAST,
        (CASE WHEN v_sort = 'last_active_asc'  THEN e.last_active END) ASC NULLS LAST,
        (CASE WHEN v_sort = 'last_active_desc' THEN e.last_active END) DESC NULLS LAST,
        e.created_at DESC, e.id
    ) AS rn
    FROM enriched e
  )
  SELECT
    (SELECT count(*) FROM base),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id',             r.id,
      'name',           r.name,
      'email',          r.email,
      'phone',          r.phone,
      'country',        NULLIF(btrim(r.country), ''),
      'joined_at',      r.created_at,
      'last_active_at', r.last_active,
      'sign_in_method', r.sign_in_method,
      'banned',         (r.active = false),
      'is_beta_tester', COALESCE(r.is_beta_tester, false),
      'segment',        r.segment,
      'app_status',     r.app_status,
      'onboarding_step', r.onboarding_step,
      'closed_business_account', EXISTS (
        SELECT 1 FROM public.creator_accounts ca2 WHERE ca2.id = r.id AND ca2.deleted_at IS NOT NULL),
      'saves',   (SELECT count(*) FROM public.saved_card s WHERE s.profile_id = r.id),
      'tickets', (SELECT count(*) FROM public.tickets t JOIN public.orders o ON o.id = t.order_id
                   WHERE o.buyer_user_id = r.id AND o.payment_status = 'paid' AND t.status <> 'void'),
      -- #4226 ticket facts (held tickets include ones given or transferred to them).
      'is_ticket_holder',        r.is_ticket_holder,
      'in_ticket_buyer_segment', r.in_ticket_buyer_segment,
      'tickets_held',            r.tickets_held,
      'orders',                  r.orders_count,
      'spent',                   r.spent,
      'last_spent_cents',        r.last_spent_cents,
      'last_currency',           r.last_currency,
      'last_purchase_at',        r.last_purchase_at,
      'event_city',              r.last_event_city,
      'marketing_consent',       r.marketing_consent,
      'friends', (SELECT count(*) FROM public.friends f
                   WHERE f.user_id = r.id AND f.status = 'accepted' AND f.deleted_at IS NULL),
      'brands', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', x.id, 'name', x.name, 'role', x.role,
                 'payment_readiness', public.admin_brand_payment_readiness_w3(x.id))
                 ORDER BY x.role_rank, x.name)
          FROM (
            SELECT b.id, b.name, 'brand_owner'::text AS role, 0 AS role_rank
              FROM public.brands b
             WHERE b.account_id = r.id AND b.deleted_at IS NULL
            UNION
            SELECT b.id, b.name, m.role, 1
              FROM public.brand_team_members m
              JOIN public.brands b ON b.id = m.brand_id
             WHERE m.user_id = r.id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
               AND b.deleted_at IS NULL AND b.account_id IS DISTINCT FROM r.id
          ) x), '[]'::jsonb),
      'live_offerings', (
        SELECT count(*) FROM public.events e
          LEFT JOIN public.event_dates d ON d.event_id = e.id AND d.is_master
         WHERE e.deleted_at IS NULL
           AND public.admin_offering_is_current(e.status, d.start_at)
           AND e.brand_id IN (
             SELECT b.id FROM public.brands b WHERE b.account_id = r.id AND b.deleted_at IS NULL
             UNION
             SELECT m.brand_id FROM public.brand_team_members m
              WHERE m.user_id = r.id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL)),
      'internal', (SELECT jsonb_build_object('reason', ia.reason, 'marked_by', ia.marked_by, 'marked_at', ia.marked_at)
                     FROM public.admin_internal_accounts ia WHERE ia.user_id = r.id AND ia.is_internal)
    ) ORDER BY r.rn), '[]'::jsonb)
  INTO v_total, v_rows
  FROM ranked r
  WHERE r.rn > v_offset AND r.rn <= v_offset + v_limit;

  RETURN jsonb_build_object('rows', v_rows, 'total', COALESCE(v_total, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_people(text, text, text, timestamptz, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_people(text, text, text, timestamptz, integer, integer, text) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 5. Data room: ticket buyers beside the account segments.
--------------------------------------------------------------------------------
-- 'ticket_buyers':
--   buyers            people with a paid ticket (staff and test left out);
--   with_app          of those, people who have the Explorer or Host app;
--   no_app            of those, the People "Ticket buyers, no app" tab count;
--   no_account        of those, people with no Mingla account at all;
--   bought_before_account  buyers whose first ticket came before they had an
--                     account (or who still have none) — bought on the web;
--   converted         of those, people who now have the Explorer or Host app;
--   conversion_rate   converted / bought_before_account (NULL with none).
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
  ), tb AS MATERIALIZED (
    SELECT d.user_id, d.app_status, d.in_ticket_buyer_segment,
           (d.user_id IS NULL OR d.first_purchase_at < d.created_at) AS bought_before_account,
           (d.app_status IN ('explorer', 'host', 'both')) AS has_app
      FROM public.admin_people_directory_rows() d
     WHERE d.is_ticket_holder AND NOT d.is_internal
  )
  SELECT jsonb_build_object(
    'segments', jsonb_build_object(
      'explorer',   (SELECT count(*) FROM r WHERE segment = 'explorer'),
      'host',       (SELECT count(*) FROM r WHERE segment = 'host'),
      'both',       (SELECT count(*) FROM r WHERE segment = 'both'),
      'incomplete', (SELECT count(*) FROM r WHERE segment = 'incomplete')),
    'total',             (SELECT count(*) FROM r),
    'internal_left_out', (SELECT count(*) FROM c WHERE segment = 'internal'),
    'ticket_buyers', (
      SELECT jsonb_build_object(
        'buyers',                count(*),
        'with_app',              count(*) FILTER (WHERE tb.has_app),
        'no_app',                count(*) FILTER (WHERE tb.in_ticket_buyer_segment),
        'no_account',            count(*) FILTER (WHERE tb.user_id IS NULL),
        'bought_before_account', count(*) FILTER (WHERE tb.bought_before_account),
        'converted',             count(*) FILTER (WHERE tb.bought_before_account AND tb.has_app),
        'conversion_rate',       CASE WHEN count(*) FILTER (WHERE tb.bought_before_account) = 0 THEN NULL
                                      ELSE round(
                                        (count(*) FILTER (WHERE tb.bought_before_account AND tb.has_app))::numeric
                                        / (count(*) FILTER (WHERE tb.bought_before_account)), 4) END)
        FROM tb),
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

--------------------------------------------------------------------------------
-- 6. Campaign history: who was left out and why.
--------------------------------------------------------------------------------
ALTER TABLE public.admin_email_log
  ADD COLUMN IF NOT EXISTS no_consent_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS internal_excluded_count integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.admin_email_log.no_consent_count IS
  'Issue #4226: matched people left out of a marketing send because they never agreed to marketing email.';
COMMENT ON COLUMN public.admin_email_log.internal_excluded_count IS
  'Issue #4226: matched staff and test people left out of a bulk send.';

COMMIT;
