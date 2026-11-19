-- Issue #4226 Phase 2 — People journey intelligence and Email segmentation.
--
-- Spec: "Phase 2 spec" + addenda D10 and D11 on #4226 (Seth approved,
-- 2026-11-18). One build, one PR.
--
-- What this migration adds:
--   1. Tracking storage the Explorer and Host apps write through three
--      SECURITY DEFINER RPCs (a fixed contract the apps code against):
--        person_journey    ONE private table (RLS on, no policy, no client
--                          grants): signup_source(_detail), signup_surface,
--                          onboarding_furthest_step(_key, _at),
--                          brand_setup_furthest_step(_key, _at). Not columns of
--                          profiles / creator_accounts: those rows are readable
--                          by other signed-in people.
--        appsflyer_devices af_status, media_source, campaign, install_time,
--                          conversion_payload, attribution_received_at
--      record_journey_mark(kind, step, key)   monotonic, own row only
--      record_signup_source(source, detail, surface)  first write wins
--      record_install_attribution(appsflyer id, app, payload) -> boolean
--                                             own device row (created when
--                                             missing), first media source wins
--      A guard trigger keeps a signed-in client from writing the AppsFlyer
--      columns of appsflyer_devices directly (that table is client-writable),
--      so the RPC rules cannot be bypassed.
--   2. ONE People classifier for the journey, layered on the existing
--      directory (admin_people_directory_rows, migrations 20280301004226 and
--      20280302004226, unchanged):
--        admin_people_journey_rows()  every directory row plus stage, host
--                                     checklist, source (with confidence),
--                                     place (with source), activity, going
--                                     counts and host money facts.
--      admin_people_directory() now returns these rows (same guard; columns
--      appended, every existing column keeps its name, type and position).
--   3. ONE shared filter, used by People (list, counts, facets) and by
--      admin-send-email (estimate and send):
--        admin_people_filter_check(jsonb)      validates a filter, raises
--                                              invalid_filter:<key>
--        admin_people_row_matches(row, jsonb, skip)  the predicate
--        admin_people_filter(jsonb)            matching rows (admin or
--                                              service role)
--        admin_people_filter_counts(jsonb)     {name: count} for many filters
--        admin_people_facets(jsonb)            per filter key, the values that
--                                              exist with how many people each
--                                              would give
--   4. admin_person_journey(text): one person's dated milestones (accounts and
--      people with no account), admin only.
--   5. One owner: admin_get_person and the Support desk lookups read the
--      People classifier (admin_people_app_status), not derive_user_segment().
--      derive_user_segment() stays: non-admin support and notification code
--      still calls it for the signed-in user (20280613054382, 20271120003988,
--      20271020003720).
--
-- Stage rules (spec D1):
--   Explorer (app status explorer / both): regular = booked 2+ different
--   offerings; going = any ticket, RSVP or experience; connected = a friend, a
--   collab session or a chat; exploring = a save or a swipe; else onboarded.
--   App status incomplete = signing_up, with the furthest onboarding step.
--   Host checklist: host account -> brand created -> payout country set ->
--   offering drafted -> published -> bank connected -> first sale -> repeat
--   seller. host_next_step is the first unticked item; a host who owns no brand
--   but is on a brand team is 'team_member'.
--   Activity: active <= 7 days, cooling 8-30, dormant > 30, never.
-- Source precedence (spec D3, D10, with D11's tracking), strongest first:
--   1. a RECORDED strong source (friend / collab invite, ticket link, host
--      invite, referral link, web ticket first) is "known";
--   2. then strong evidence by match, "inferred": host contact added before the
--      account, web ticket before the account, friend invite, collab invite,
--      ticket link, beta or app lead;
--   3. then campaign evidence: paid ad (recorded, or AppsFlyer non-organic),
--      app store, website;
--   4. then organic (recorded, or AppsFlyer organic): a recorded "organic" or
--      "unknown" never masks a stronger inferred signal;
--   5. else unknown. People with no account: web_checkout / host_contact, known.
-- Place (spec D4): city = discovery city -> custom location -> latest event
--   city -> host city (contact) -> own brand city. Country = profile -> host
--   contact rules (no account) -> phone code -> payout country -> event
--   country. Every value says its source.
-- Staff/test stay out of every track except 'internal'; seed profiles stay
-- out (admin_people_app_status already drops them).
--
-- plpgsql for anything that reads tables: the CI replay checks a plpgsql body
-- when it runs, not at CREATE (see 20280302004226).
--
-- Invariant (declared in the pg17 test): I-4226-PEOPLE-ONE-FILTER | issue #4226 | People and the Email audience read one admin-only filter (admin_people_filter over admin_people_journey_rows); a filter's People count equals its Email matched count, and every facet option's count equals the filter count with that option chosen.

BEGIN;

--------------------------------------------------------------------------------
-- 1. Tracking storage.
--
-- The sign-up source and the onboarding / brand-setup steps live in ONE private
-- table, public.person_journey, that no client can read or write: row level
-- security is on with no policy and every table grant is revoked from anon and
-- authenticated, so only the SECURITY DEFINER functions below touch it. (They
-- are NOT columns of profiles or creator_accounts: a signed-in person can read
-- other people's profiles row, and these values are private to Mingla.)
-- The AppsFlyer conversion columns stay on appsflyer_devices, which each person
-- already owns row by row; a guard trigger keeps a client from forging them.
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.person_journey (
  user_id                       uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  signup_source                 text,
  signup_source_detail          jsonb,
  signup_surface                text,
  onboarding_furthest_step      smallint,
  onboarding_furthest_step_key  text,
  onboarding_furthest_step_at   timestamptz,
  brand_setup_furthest_step     smallint,
  brand_setup_furthest_step_key text,
  brand_setup_furthest_step_at  timestamptz,
  updated_at                    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.person_journey ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.person_journey FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.person_journey IS
  'Issue #4226: one private row per person: how they signed up and the furthest onboarding / brand-setup step they reached. RLS on with no policy and no client grants; written only by record_journey_mark / record_signup_source, read only by the admin People functions. Deleted with the auth user (ON DELETE CASCADE), the same path as every other per-person row.';

ALTER TABLE public.appsflyer_devices
  ADD COLUMN IF NOT EXISTS af_status text,
  ADD COLUMN IF NOT EXISTS media_source text,
  ADD COLUMN IF NOT EXISTS campaign text,
  ADD COLUMN IF NOT EXISTS install_time timestamptz,
  ADD COLUMN IF NOT EXISTS conversion_payload jsonb,
  ADD COLUMN IF NOT EXISTS attribution_received_at timestamptz;

COMMENT ON COLUMN public.appsflyer_devices.media_source IS
  'Issue #4226: the install media source from AppsFlyer conversion data (record_install_attribution, first wins).';

-- appsflyer_devices is client-writable (own-row RLS; the apps upsert their
-- device), so its attribution columns are refused to a signed-in client here
-- and written only by record_install_attribution (which runs as its owner).
CREATE OR REPLACE FUNCTION public.issue_4226_guard_journey_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.af_status IS NOT NULL OR NEW.media_source IS NOT NULL OR NEW.campaign IS NOT NULL
       OR NEW.install_time IS NOT NULL OR NEW.conversion_payload IS NOT NULL
       OR NEW.attribution_received_at IS NOT NULL THEN
      RAISE EXCEPTION 'journey_fields_server_owned';
    END IF;
  ELSIF NEW.af_status IS DISTINCT FROM OLD.af_status
     OR NEW.media_source IS DISTINCT FROM OLD.media_source
     OR NEW.campaign IS DISTINCT FROM OLD.campaign
     OR NEW.install_time IS DISTINCT FROM OLD.install_time
     OR NEW.conversion_payload IS DISTINCT FROM OLD.conversion_payload
     OR NEW.attribution_received_at IS DISTINCT FROM OLD.attribution_received_at THEN
    RAISE EXCEPTION 'journey_fields_server_owned';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4226_guard_journey_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4226_guard_journey_columns ON public.profiles;
DROP TRIGGER IF EXISTS issue_4226_guard_journey_columns ON public.creator_accounts;
DROP TRIGGER IF EXISTS issue_4226_guard_journey_columns ON public.appsflyer_devices;
CREATE TRIGGER issue_4226_guard_journey_columns
  BEFORE INSERT OR UPDATE ON public.appsflyer_devices
  FOR EACH ROW EXECUTE FUNCTION public.issue_4226_guard_journey_columns();

--------------------------------------------------------------------------------
-- 1b. The three tracking RPCs (fixed contract).
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_journey_mark(p_kind text, p_step smallint, p_step_key text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := left(NULLIF(btrim(COALESCE(p_step_key, '')), ''), 80);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('explorer_onboarding', 'host_brand_setup') THEN
    RAISE EXCEPTION 'invalid_kind';
  END IF;
  IF p_step IS NULL OR p_step < 0 THEN RAISE EXCEPTION 'invalid_step'; END IF;

  IF p_kind = 'explorer_onboarding' THEN
    -- Needs the person's profile; forward only (same step: only a changed key).
    INSERT INTO public.person_journey AS j (user_id, onboarding_furthest_step, onboarding_furthest_step_key,
                                            onboarding_furthest_step_at, updated_at)
    SELECT v_uid, p_step, v_key, now(), now()
     WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid)
    ON CONFLICT (user_id) DO UPDATE
       SET onboarding_furthest_step = EXCLUDED.onboarding_furthest_step,
           onboarding_furthest_step_key = EXCLUDED.onboarding_furthest_step_key,
           onboarding_furthest_step_at = EXCLUDED.onboarding_furthest_step_at,
           updated_at = EXCLUDED.updated_at
     WHERE j.onboarding_furthest_step IS NULL
        OR EXCLUDED.onboarding_furthest_step > j.onboarding_furthest_step
        OR (EXCLUDED.onboarding_furthest_step = j.onboarding_furthest_step
            AND EXCLUDED.onboarding_furthest_step_key IS DISTINCT FROM j.onboarding_furthest_step_key);
  ELSE
    -- Needs an open Host account; forward only.
    INSERT INTO public.person_journey AS j (user_id, brand_setup_furthest_step, brand_setup_furthest_step_key,
                                            brand_setup_furthest_step_at, updated_at)
    SELECT v_uid, p_step, v_key, now(), now()
     WHERE EXISTS (SELECT 1 FROM public.creator_accounts ca WHERE ca.id = v_uid AND ca.deleted_at IS NULL)
    ON CONFLICT (user_id) DO UPDATE
       SET brand_setup_furthest_step = EXCLUDED.brand_setup_furthest_step,
           brand_setup_furthest_step_key = EXCLUDED.brand_setup_furthest_step_key,
           brand_setup_furthest_step_at = EXCLUDED.brand_setup_furthest_step_at,
           updated_at = EXCLUDED.updated_at
     WHERE j.brand_setup_furthest_step IS NULL
        OR EXCLUDED.brand_setup_furthest_step > j.brand_setup_furthest_step
        OR (EXCLUDED.brand_setup_furthest_step = j.brand_setup_furthest_step
            AND EXCLUDED.brand_setup_furthest_step_key IS DISTINCT FROM j.brand_setup_furthest_step_key);
  END IF;
END;
$$;
COMMENT ON FUNCTION public.record_journey_mark(text, smallint, text) IS
  'Issue #4226: the signed-in person reached an onboarding (explorer_onboarding) or brand-setup (host_brand_setup) step. Monotonic; same step updates the key only when it changed; no profile / Host account is a no-op. Writes the private person_journey row.';
REVOKE ALL ON FUNCTION public.record_journey_mark(text, smallint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_journey_mark(text, smallint, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_signup_source(p_source text, p_detail jsonb, p_surface text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_source IS NULL OR p_source NOT IN (
       'friend_invite', 'collab_invite', 'ticket_link', 'host_invite', 'referral_link',
       'web_ticket_first', 'paid_ad', 'app_store', 'website', 'organic', 'unknown') THEN
    RAISE EXCEPTION 'invalid_source';
  END IF;
  IF p_surface IS NOT NULL AND p_surface NOT IN ('explorer_app', 'host_app', 'web') THEN
    RAISE EXCEPTION 'invalid_surface';
  END IF;
  IF p_detail IS NOT NULL AND (jsonb_typeof(p_detail) <> 'object' OR octet_length(p_detail::text) > 4096) THEN
    RAISE EXCEPTION 'invalid_detail';
  END IF;

  -- First write wins; needs the person's profile.
  INSERT INTO public.person_journey AS j (user_id, signup_source, signup_source_detail, signup_surface, updated_at)
  SELECT v_uid, p_source, p_detail, p_surface, now()
   WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid)
  ON CONFLICT (user_id) DO UPDATE
     SET signup_source = EXCLUDED.signup_source,
         signup_source_detail = EXCLUDED.signup_source_detail,
         signup_surface = EXCLUDED.signup_surface,
         updated_at = EXCLUDED.updated_at
   WHERE j.signup_source IS NULL;
END;
$$;
COMMENT ON FUNCTION public.record_signup_source(text, jsonb, text) IS
  'Issue #4226: how the signed-in person came to Mingla. First write wins; the source is checked against an allow-list. Writes the private person_journey row.';
REVOKE ALL ON FUNCTION public.record_signup_source(text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_signup_source(text, jsonb, text) TO authenticated;

-- Returns true when the person's device row was written or updated, false when
-- nothing was written (the first media source is already stored, or this
-- AppsFlyer id belongs to someone else's device or to the same person's other
-- app). The row is created when it does not exist yet, so the call does not
-- depend on the app having registered the device first; creating it needs the
-- payload to name the device's "platform" (ios | android) and "app_id".
DROP FUNCTION IF EXISTS public.record_install_attribution(text, text, jsonb);
CREATE FUNCTION public.record_install_attribution(p_appsflyer_id text, p_app text, p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_id       text := btrim(COALESCE(p_appsflyer_id, ''));
  v_status   text;
  v_media    text;
  v_camp     text;
  v_install  timestamptz;
  v_platform text;
  v_app_id   text;
  v_n        integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF v_id = '' THEN RAISE EXCEPTION 'invalid_appsflyer_id'; END IF;
  IF p_app IS NULL OR p_app NOT IN ('consumer', 'business') THEN RAISE EXCEPTION 'invalid_app'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR octet_length(p_payload::text) > 16384 THEN
    RAISE EXCEPTION 'invalid_payload';
  END IF;

  v_status := left(NULLIF(btrim(p_payload ->> 'af_status'), ''), 40);
  v_media  := left(NULLIF(btrim(p_payload ->> 'media_source'), ''), 200);
  v_camp   := left(NULLIF(btrim(p_payload ->> 'campaign'), ''), 300);
  BEGIN
    v_install := NULLIF(btrim(p_payload ->> 'install_time'), '')::timestamptz;
  EXCEPTION WHEN others THEN
    v_install := NULL;
  END;
  v_platform := lower(NULLIF(btrim(p_payload ->> 'platform'), ''));
  v_app_id   := left(NULLIF(btrim(p_payload ->> 'app_id'), ''), 200);

  IF NOT EXISTS (SELECT 1 FROM public.appsflyer_devices d
                  WHERE d.user_id = v_uid AND d.app = p_app AND d.appsflyer_uid = v_id) THEN
    -- A new device row: never for an AppsFlyer id that already belongs to
    -- another person's device, or to this person's other app.
    IF EXISTS (SELECT 1 FROM public.appsflyer_devices d
                WHERE d.appsflyer_uid = v_id AND (d.user_id <> v_uid OR d.app <> p_app)) THEN
      RETURN false;
    END IF;
    IF v_platform IS NULL OR v_platform NOT IN ('ios', 'android') THEN RAISE EXCEPTION 'invalid_platform'; END IF;
    IF v_app_id IS NULL THEN RAISE EXCEPTION 'invalid_app_id'; END IF;
  END IF;

  -- First media source wins: once one is stored the row is left alone. An
  -- organic first answer (no media source) may still be upgraded.
  INSERT INTO public.appsflyer_devices AS d
    (user_id, appsflyer_uid, platform, app_id, app, af_status, media_source, campaign,
     install_time, conversion_payload, attribution_received_at)
  VALUES
    (v_uid, v_id, COALESCE(v_platform, 'ios'), COALESCE(v_app_id, 'unknown'), p_app, v_status, v_media, v_camp,
     v_install, p_payload, now())
  ON CONFLICT (user_id, app, appsflyer_uid) DO UPDATE
     SET af_status = EXCLUDED.af_status,
         media_source = EXCLUDED.media_source,
         campaign = EXCLUDED.campaign,
         install_time = EXCLUDED.install_time,
         conversion_payload = EXCLUDED.conversion_payload,
         attribution_received_at = EXCLUDED.attribution_received_at
   WHERE d.media_source IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;
COMMENT ON FUNCTION public.record_install_attribution(text, text, jsonb) IS
  'Issue #4226: store AppsFlyer conversion data on the signed-in person''s own device row (user, app, AppsFlyer id), creating it when missing (payload carries platform and app_id). First media source wins. true = written or updated; false = nothing written (first write already happened, or the id is another device''s).';
REVOKE ALL ON FUNCTION public.record_install_attribution(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_install_attribution(text, text, jsonb) TO authenticated;

--------------------------------------------------------------------------------
-- 1c. The classifier and the directory as set-based queries.
--
-- admin_people_app_status() (20280301004226) ran four lookups per profile
-- (host account, brand team, staff/test rule) and the directory
-- (20280302004226) looked each ticket's email up in a materialised CTE once per
-- row and ran a per-person EXISTS over the suppression tables. At 6,000 people
-- and 20,000 orders, before ANALYZE, that made the People query take over two
-- minutes. Same functions, same columns, same rows; joins and hashed IN lists
-- instead, one pass each. The staff/test rule is admin_account_is_internal()'s
-- (an admin_internal_accounts row decides, else the email rule on the profile,
-- sign-in or business-account email); the pg17 suite pins the two equal for
-- every profile.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_people_app_status()
RETURNS TABLE (user_id uuid, segment text, app_status text, has_explorer boolean,
               is_host boolean, is_internal boolean)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
SET enable_nestloop = off
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
  LEFT JOIN public.creator_accounts ca ON ca.id = p.id
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN public.admin_internal_accounts ia ON ia.user_id = p.id
  LEFT JOIN (SELECT DISTINCT m.user_id FROM public.brand_team_members m
              WHERE m.accepted_at IS NOT NULL AND m.removed_at IS NULL) tm ON tm.user_id = p.id
  CROSS JOIN LATERAL (
    SELECT (COALESCE(p.has_completed_onboarding, false) AND p.explorer_deleted_at IS NULL) AS is_explorer
  ) x
  CROSS JOIN LATERAL (
    SELECT ((ca.id IS NOT NULL AND ca.deleted_at IS NULL) OR tm.user_id IS NOT NULL) AS is_host
  ) h
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      ia.is_internal,
      public.admin_internal_email_rule(p.email)
        OR public.admin_internal_email_rule(u.email)
        OR public.admin_internal_email_rule(ca.email),
      false) AS is_internal
  ) i
  WHERE COALESCE(p.is_seed, false) = false
$$;
REVOKE ALL ON FUNCTION public.admin_people_app_status() FROM PUBLIC, anon, authenticated;

--------------------------------------------------------------------------------
-- 1d. The directory (same function, same columns, same rows as 20280302004226)
-- with its contact keying and suppression lookups as joins and hashed IN lists.
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
  is_beta_tester           boolean,
  -- #4226 host contacts (appended).
  is_host_contact          boolean,
  host_brand_ids           uuid[],
  host_brands              jsonb,
  host_city                text,
  host_contact_added_at    timestamptz,
  consent_basis            text
)
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
SET enable_nestloop = off
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
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
        -- Joins, not a lookup per row: acct_email holds one row per email.
        SELECT c.*, COALESCE(pr.id, ae.user_id) AS user_id
          FROM contacts c
          LEFT JOIN public.profiles pr ON pr.id = c.raw_uid
          LEFT JOIN acct_email ae ON ae.email = c.email
      ) r
     WHERE r.user_id IS NOT NULL OR r.email IS NOT NULL
  ),
  keyed_by_email AS (
    SELECT k.email, max(k.person_key) AS person_key FROM keyed k WHERE k.email IS NOT NULL GROUP BY k.email
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
  -- #4226 host contacts: one row per (email, brand contact, source).
  hc_src AS MATERIALIZED (
    SELECT lower(btrim(cm.normalized_value)) AS email,
           cm.brand_id,
           cm.brand_person_id,
           NULLIF(btrim(bp.display_name), '') AS name,
           cms.provenance_kind AS source,
           COALESCE(sl.source_occurred_at, cms.created_at) AS added_at,
           ib.attestation_version,
           ib.id AS import_batch_id,
           NULLIF(btrim(br.city), '') AS brand_city,
           NULLIF(upper(btrim(br.country_code)), '') AS brand_country,
           br.name AS brand_name
      FROM public.brand_person_contact_methods cm
      JOIN public.brand_person_contact_method_sources cms
        ON cms.contact_method_id = cm.id
       AND cms.active AND cms.retired_at IS NULL
       AND cms.provenance_kind IN ('import', 'manual')
      JOIN public.brand_person_source_links sl
        ON sl.id = cms.source_link_id AND sl.detached_at IS NULL
      JOIN public.brand_people bp
        ON bp.id = cm.brand_person_id AND bp.record_status = 'active'
      JOIN public.brands br
        ON br.id = cm.brand_id AND br.deleted_at IS NULL
      LEFT JOIN public.brand_contact_import_rows ir
        ON cms.provenance_kind = 'import' AND ir.id = sl.source_id
      LEFT JOIN public.brand_contact_import_batches ib
        ON ib.id = ir.batch_id
     WHERE cm.channel = 'email'
       AND cm.record_state = 'active'
       AND cm.retired_at IS NULL
       AND NULLIF(btrim(cm.normalized_value), '') IS NOT NULL
  ),
  -- The brand contact's phone, and the country it carries.
  hc_phone AS (
    SELECT DISTINCT ON (pm.brand_person_id)
           pm.brand_person_id,
           pm.normalized_value AS phone,
           COALESCE(
             (SELECT max(ps.phone_country_iso) FROM public.brand_person_contact_method_sources ps
               WHERE ps.contact_method_id = pm.id AND ps.active AND ps.phone_country_iso IS NOT NULL),
             public.admin_country_from_e164(pm.normalized_value)) AS phone_country
      FROM public.brand_person_contact_methods pm
     WHERE pm.channel = 'phone' AND pm.record_state = 'active' AND pm.retired_at IS NULL
       AND pm.brand_person_id IN (SELECT hs.brand_person_id FROM hc_src hs)
     ORDER BY pm.brand_person_id, pm.is_primary DESC, pm.created_at DESC
  ),
  -- Which person a host-contact email belongs to: an account (profile email,
  -- then sign-in email), else a ticket person with that email, else a new
  -- person keyed by the email.
  hc_keyed AS MATERIALIZED (
    SELECT hs.*, ph.phone, ph.phone_country,
           COALESCE(
             'u:' || ae.user_id::text,
             -- An account key (u:) beats an email key (e:) when both exist.
             ke.person_key,
             'e:' || hs.email) AS person_key
      FROM hc_src hs
      LEFT JOIN hc_phone ph ON ph.brand_person_id = hs.brand_person_id
      LEFT JOIN acct_email ae ON ae.email = hs.email
      LEFT JOIN keyed_by_email ke ON ke.email = hs.email
  ),
  hc_agg AS (
    SELECT h.person_key,
           (array_agg(h.email ORDER BY h.added_at DESC))[1] AS email,
           (array_agg(h.name ORDER BY h.added_at DESC) FILTER (WHERE h.name IS NOT NULL))[1] AS name,
           (array_agg(h.phone ORDER BY h.added_at DESC) FILTER (WHERE h.phone IS NOT NULL))[1] AS phone,
           (array_agg(COALESCE(h.phone_country, h.brand_country) ORDER BY h.added_at DESC)
              FILTER (WHERE COALESCE(h.phone_country, h.brand_country) IS NOT NULL))[1] AS host_country,
           (array_agg(h.brand_city ORDER BY h.added_at DESC) FILTER (WHERE h.brand_city IS NOT NULL))[1] AS host_city,
           min(h.added_at) AS added_at,
           array_agg(DISTINCT h.brand_id) AS brand_ids,
           array_agg(DISTINCT h.brand_person_id) AS brand_person_ids,
           CASE WHEN bool_or(h.source = 'import') THEN 'host_import_attestation' ELSE 'host_manual_add' END AS basis
      FROM hc_keyed h
     GROUP BY h.person_key
  ),
  hc_brands AS (
    SELECT b.person_key,
           jsonb_agg(jsonb_build_object(
             'id', b.brand_id, 'name', b.brand_name, 'source', b.source, 'added_at', b.added_at,
             'attestation_version', b.attestation_version, 'import_batch_id', b.import_batch_id)
             ORDER BY b.brand_name, b.brand_id) AS brands
      FROM (
        SELECT DISTINCT ON (h.person_key, h.brand_id)
               h.person_key, h.brand_id, h.brand_name, h.source, h.added_at,
               h.attestation_version, h.import_batch_id
          FROM hc_keyed h
         ORDER BY h.person_key, h.brand_id, (h.source = 'import') DESC, h.added_at
      ) b
     GROUP BY b.person_key
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
    UNION ALL
    -- #4226: a host contact with no account and no ticket.
    SELECT h.person_key, NULL::uuid, h.email, h.name,
           NULL::text, NULL::text, NULL::text,
           h.phone,
           CASE WHEN public.admin_internal_email_rule(h.email) THEN 'internal' ELSE 'host_contact_no_app' END,
           'host_contact_no_app',
           public.admin_internal_email_rule(h.email),
           false,
           NULL::text,
           NULL::timestamptz, NULL::text, NULL::boolean, NULL::boolean, NULL::boolean, NULL::boolean
      FROM hc_agg h
     WHERE h.person_key LIKE 'e:%'
       AND NOT EXISTS (SELECT 1 FROM ticket_agg t WHERE t.person_key = h.person_key)
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
        UNION ALL
        SELECT h.person_key, h.email FROM hc_keyed h
      ) x
     WHERE NULLIF(x.email, '') IS NOT NULL
  ),
  suppressed AS (
    SELECT pe.person_key FROM person_emails pe
     WHERE pe.email IN (SELECT lower(btrim(cs.contact)) FROM public.channel_suppressions cs
                         WHERE cs.channel = 'email' AND cs.scope IN ('marketing', 'all'))
    UNION
    SELECT pe.person_key FROM person_emails pe
     WHERE pe.email IN (SELECT lower(btrim(mu.contact_email)) FROM public.marketing_unsubscribes mu)
    UNION
    SELECT 'u:' || cs.user_id::text
      FROM public.channel_suppressions cs
     WHERE cs.user_id IS NOT NULL AND cs.channel = 'email' AND cs.scope IN ('marketing', 'all')
    UNION
    -- #4226: suppressed by a brand that added them as a host contact.
    SELECT h.person_key
      FROM hc_keyed h
     WHERE h.brand_person_id IN (SELECT bs.brand_person_id FROM public.brand_person_channel_suppressions bs
                                  WHERE bs.channel = 'email' AND bs.scope IN ('marketing', 'all') AND bs.lifted_at IS NULL)
  ),
  consent_latest AS (
    SELECT DISTINCT ON (sig.person_key) sig.person_key, sig.granted, sig.basis
      FROM (
        SELECT pe.person_key, cr.created_at AS at, (cr.action = 'granted') AS granted, 'consent_record'::text AS basis
          FROM person_emails pe
          JOIN public.consent_records cr
            ON cr.scope = 'marketing' AND cr.channel = 'email' AND lower(btrim(cr.contact)) = pe.email
        UNION ALL
        SELECT 'u:' || cr.user_id::text, cr.created_at, (cr.action = 'granted'), 'consent_record'
          FROM public.consent_records cr
         WHERE cr.user_id IS NOT NULL AND cr.scope = 'marketing' AND cr.channel = 'email'
        UNION ALL
        SELECT k.person_key, pd.created_at, (pd.opt_in = 'true'), 'checkout'
          FROM keyed k
          JOIN paid pd ON pd.id = k.order_id
         WHERE k.role = 'buyer' AND pd.opt_in IN ('true', 'false')
      ) sig
     ORDER BY sig.person_key, sig.at DESC, sig.granted ASC
  ),
  joined AS (
    SELECT un.*,
           t.person_key  AS t_key, t.tickets_count, t.orders_count, t.first_at, t.last_at,
           sp.spent, ls.cents AS ls_cents, ls.currency AS ls_currency,
           ea.last_event_city, ea.event_cities, ea.brand_ids AS ea_brand_ids,
           (su.person_key IS NOT NULL) AS is_suppressed,
           cl.person_key AS cl_key, cl.granted AS cl_granted, cl.basis AS cl_basis,
           h.person_key  AS h_key, h.brand_ids AS h_brand_ids, h.host_city AS h_city,
           h.host_country AS h_country, h.added_at AS h_added_at, h.basis AS h_basis,
           hb.brands AS h_brands
      FROM universe un
      LEFT JOIN ticket_agg t ON t.person_key = un.person_key
      LEFT JOIN spend sp ON sp.person_key = un.person_key
      LEFT JOIN last_spend ls ON ls.person_key = un.person_key
      LEFT JOIN event_agg ea ON ea.person_key = un.person_key
      LEFT JOIN suppressed su ON su.person_key = un.person_key
      LEFT JOIN consent_latest cl ON cl.person_key = un.person_key
      LEFT JOIN hc_agg h ON h.person_key = un.person_key
      LEFT JOIN hc_brands hb ON hb.person_key = un.person_key
  ),
  graded AS (
    SELECT j.*,
           CASE
             WHEN j.is_suppressed THEN 'unsubscribed'
             WHEN j.cl_key IS NOT NULL THEN CASE WHEN j.cl_granted THEN 'yes' ELSE 'no' END
             WHEN j.h_key IS NOT NULL THEN 'yes'
             ELSE 'no'
           END AS consent,
           CASE
             WHEN j.is_suppressed THEN NULL
             WHEN j.cl_key IS NOT NULL THEN CASE WHEN j.cl_granted THEN j.cl_basis END
             WHEN j.h_key IS NOT NULL THEN j.h_basis
           END AS basis
      FROM joined j
  )
  SELECT
    g.person_key,
    g.user_id,
    g.email,
    g.name,
    g.first_name,
    g.display_name,
    g.username,
    g.phone_e164,
    g.segment,
    g.app_status,
    g.is_internal,
    g.has_explorer,
    (g.t_key IS NOT NULL) AS is_ticket_holder,
    (g.t_key IS NOT NULL AND NOT g.is_internal AND NOT g.has_explorer) AS in_ticket_buyer_segment,
    COALESCE(g.tickets_count, 0),
    COALESCE(g.orders_count, 0),
    COALESCE(g.spent, '{}'::jsonb),
    g.ls_cents,
    g.ls_currency,
    g.first_at,
    g.last_at,
    g.last_event_city,
    COALESCE(g.event_cities, '{}'::text[]),
    -- A host contact with no account and no ticket: the brand contact's phone
    -- country (phone_country_iso first), else the brand's country.
    COALESCE(g.profile_country,
             CASE WHEN g.user_id IS NULL AND g.t_key IS NULL THEN g.h_country END,
             public.admin_country_from_e164(g.phone_e164), g.h_country),
    g.consent,
    COALESCE(g.ea_brand_ids, '{}'::uuid[]),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) ORDER BY b.name)
        FROM public.brands b WHERE b.id = ANY (g.ea_brand_ids)), '[]'::jsonb),
    g.created_at,
    g.preferred_language,
    g.has_completed_onboarding,
    g.email_verified,
    g.active,
    g.is_beta_tester,
    (g.h_key IS NOT NULL) AS is_host_contact,
    COALESCE(g.h_brand_ids, '{}'::uuid[]),
    COALESCE(g.h_brands, '[]'::jsonb),
    g.h_city,
    g.h_added_at,
    g.basis
  FROM graded g;
END;
$$;

--------------------------------------------------------------------------------
-- 2. The journey row and its one owner.
--------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_people_directory();
DROP FUNCTION IF EXISTS public.admin_people_filter(jsonb);
DROP FUNCTION IF EXISTS public.admin_people_row_matches(public.admin_people_journey_row, jsonb, text);
DROP FUNCTION IF EXISTS public.admin_people_row_fails(public.admin_people_journey_row, jsonb);
DROP FUNCTION IF EXISTS public.admin_people_row_search_fails(public.admin_people_journey_row, text);
DROP FUNCTION IF EXISTS public.admin_people_row_fails_p(public.admin_people_journey_row, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.admin_people_journey_rows();
DROP TYPE IF EXISTS public.admin_people_journey_row;

CREATE TYPE public.admin_people_journey_row AS (
  -- The directory (20280302004226), same names, types and order.
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
  is_beta_tester           boolean,
  is_host_contact          boolean,
  host_brand_ids           uuid[],
  host_brands              jsonb,
  host_city                text,
  host_contact_added_at    timestamptz,
  consent_basis            text,
  -- Phase 2 (appended).
  joined_at                timestamptz,
  person_kind              text,
  explorer_stage           text,
  explorer_stopped_step    smallint,
  explorer_stopped_step_key text,
  host_checklist           jsonb,
  host_next_step           text,
  brand_setup_furthest_step smallint,
  brand_setup_furthest_step_key text,
  source                   text,
  source_confidence        text,
  source_detail            text,
  signup_surface           text,
  sign_in_method           text,
  city                     text,
  city_source              text,
  country_source           text,
  last_active_at           timestamptz,
  activity_status          text,
  rsvp_count               integer,
  experience_count         integer,
  ticket_count             integer,
  saves_count              integer,
  friends_count            integer,
  brand_count              integer,
  first_brand_at           timestamptz,
  published_count          integer,
  bank_connected           boolean,
  payout_countries         text[],
  first_sale_at            timestamptz,
  emails_ok                boolean
);
COMMENT ON TYPE public.admin_people_journey_row IS
  'Issue #4226: one People row with its journey (stage, host checklist, source, place, activity).';

CREATE FUNCTION public.admin_people_journey_rows()
RETURNS SETOF public.admin_people_journey_row
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
-- Whole-table passes: with no statistics yet (a fresh or just-restored
-- database) the planner mistakes the tables for tiny and picks nested loops
-- that re-scan them per row (minutes at 6,000 people). Hash and merge joins
-- are right for every pass here.
SET enable_nestloop = off
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH
  d AS MATERIALIZED (SELECT * FROM public.admin_people_directory_rows()),
  acct AS MATERIALIZED (SELECT d.user_id FROM d WHERE d.user_id IS NOT NULL),
  -- AppsFlyer conversion data: the first device that carried a media source,
  -- else the first that carried any answer.
  af AS (
    SELECT DISTINCT ON (x.user_id) x.user_id, x.af_status, x.media_source, x.campaign
      FROM public.appsflyer_devices x
     WHERE x.user_id IN (SELECT user_id FROM acct)
       AND (x.af_status IS NOT NULL OR x.media_source IS NOT NULL)
     ORDER BY x.user_id, (x.media_source IS NULL), x.attribution_received_at NULLS LAST, x.created_at
  ),
  saves AS (
    SELECT s.profile_id AS user_id, count(*)::integer AS n, min(s.created_at) AS first_at, max(s.created_at) AS last_at
      FROM public.saved_card s WHERE s.profile_id IN (SELECT user_id FROM acct) GROUP BY 1
  ),
  swipes AS (
    SELECT w.user_id, count(*)::integer AS n
      FROM public.board_user_swipe_states w WHERE w.user_id IN (SELECT user_id FROM acct) GROUP BY 1
  ),
  fr AS (
    SELECT x.user_id, count(DISTINCT x.other)::integer AS n, min(x.created_at) AS first_at
      FROM (
        SELECT f.user_id, f.friend_user_id AS other, f.created_at FROM public.friends f
         WHERE f.status = 'accepted' AND f.deleted_at IS NULL
        UNION ALL
        SELECT f.friend_user_id, f.user_id, f.created_at FROM public.friends f
         WHERE f.status = 'accepted' AND f.deleted_at IS NULL
      ) x
     WHERE x.user_id IN (SELECT user_id FROM acct)
     GROUP BY 1
  ),
  collab AS (
    SELECT sp.user_id, count(DISTINCT sp.session_id)::integer AS n, min(sp.created_at) AS first_at
      FROM public.session_participants sp WHERE sp.user_id IN (SELECT user_id FROM acct) GROUP BY 1
  ),
  chats AS (
    SELECT cp.user_id, count(DISTINCT cp.conversation_id)::integer AS n, min(cp.joined_at) AS first_at
      FROM public.conversation_participants cp
      JOIN public.conversations c ON c.id = cp.conversation_id
     WHERE cp.user_id IN (SELECT user_id FROM acct)
       AND (c.type = 'direct' OR c.session_id IS NOT NULL)
     GROUP BY 1
  ),
  -- Every email an account is known by (profile email first, then sign-in
  -- email), the same match the directory folds ticket people with.
  acct_email AS MATERIALIZED (
    SELECT DISTINCT ON (x.email) x.email, x.user_id
      FROM (
        SELECT lower(btrim(p.email)) AS email, p.id AS user_id, 0 AS pri
          FROM public.profiles p WHERE p.id IN (SELECT user_id FROM acct) AND NULLIF(btrim(p.email), '') IS NOT NULL
        UNION ALL
        SELECT lower(btrim(u.email)), u.id, 1
          FROM auth.users u WHERE u.id IN (SELECT user_id FROM acct) AND NULLIF(btrim(u.email), '') IS NOT NULL
      ) x
     ORDER BY x.email, x.pri
  ),
  -- Going: each paid, non-void ticket an account holds (the holder, else the
  -- buyer when no holder is named; by account or by email), by the
  -- offering's type; each RSVP; each confirmed stay. Every count is one grouped
  -- pass (never a lookup per person), so the cost grows with the rows, not
  -- with people times rows.
  held AS (
    SELECT COALESCE(
             t.holder_user_id,
             aeh.user_id,
             CASE WHEN NULLIF(btrim(COALESCE(t.holder_email, t.attendee_email, '')), '') IS NULL
                  THEN COALESCE(o.buyer_user_id, aeb.user_id) END
           ) AS user_id,
           t.id AS ticket_id, o.event_id, e.event_type, o.created_at
      FROM public.tickets t
      JOIN public.orders o ON o.id = t.order_id AND o.payment_status = 'paid'
      LEFT JOIN public.events e ON e.id = o.event_id
      LEFT JOIN acct_email aeh ON aeh.email = lower(btrim(COALESCE(NULLIF(btrim(t.holder_email), ''), t.attendee_email)))
      LEFT JOIN acct_email aeb ON aeb.email = lower(btrim(o.buyer_email))
     WHERE t.status <> 'void'
  ),
  rs AS (
    SELECT r.user_id, r.event_id, r.created_at
      FROM public.event_rsvps r
     WHERE r.user_id IS NOT NULL AND r.rsvp_status IN ('going', 'maybe')
       AND COALESCE(r.approval_status, '') <> 'denied'
  ),
  stays AS (
    SELECT COALESCE(g.user_id, g.booked_by_user_id) AS user_id, g.id, g.venue_id, g.created_at
      FROM public.stay_reservation_groups g
     WHERE g.state IN ('confirmed', 'partially_cancelled')
  ),
  held_agg AS (
    SELECT h.user_id,
           count(DISTINCT h.ticket_id) FILTER (WHERE COALESCE(h.event_type, 'event') NOT IN ('rsvp', 'experience', 'trip'))::integer AS tickets,
           count(DISTINCT h.ticket_id) FILTER (WHERE h.event_type = 'rsvp')::integer AS rsvp_tickets,
           count(DISTINCT h.ticket_id) FILTER (WHERE h.event_type IN ('experience', 'trip'))::integer AS experience_tickets,
           max(h.created_at) AS last_at
      FROM held h WHERE h.user_id IS NOT NULL GROUP BY h.user_id
  ),
  rs_agg AS (
    SELECT r.user_id, count(DISTINCT r.event_id)::integer AS n, max(r.created_at) AS last_at FROM rs r GROUP BY r.user_id
  ),
  stay_agg AS (
    SELECT s.user_id, count(*)::integer AS n, max(s.created_at) AS last_at FROM stays s WHERE s.user_id IS NOT NULL GROUP BY s.user_id
  ),
  off_agg AS (
    SELECT x.user_id, count(DISTINCT x.k)::integer AS n
      FROM (
        SELECT h.user_id, 'e:' || h.event_id::text AS k FROM held h WHERE h.user_id IS NOT NULL AND h.event_id IS NOT NULL
        UNION ALL SELECT r.user_id, 'e:' || r.event_id::text FROM rs r
        UNION ALL SELECT s.user_id, 'v:' || s.venue_id::text FROM stays s WHERE s.user_id IS NOT NULL
      ) x
     GROUP BY x.user_id
  ),
  going AS (
    SELECT a.user_id,
           COALESCE(ha.tickets, 0) AS tickets,
           (COALESCE(ha.rsvp_tickets, 0) + COALESCE(ra.n, 0))::integer AS rsvps,
           (COALESCE(ha.experience_tickets, 0) + COALESCE(sa.n, 0))::integer AS experiences,
           COALESCE(oa.n, 0) AS offerings,
           GREATEST(ha.last_at, ra.last_at, sa.last_at) AS last_at
      FROM acct a
      LEFT JOIN held_agg ha ON ha.user_id = a.user_id
      LEFT JOIN rs_agg ra ON ra.user_id = a.user_id
      LEFT JOIN stay_agg sa ON sa.user_id = a.user_id
      LEFT JOIN off_agg oa ON oa.user_id = a.user_id
  ),
  -- Host facts over the brands a person owns, each one grouped pass.
  owned AS (
    SELECT b.* FROM public.brands b
     WHERE b.deleted_at IS NULL AND b.account_id IN (SELECT user_id FROM acct)
  ),
  h_brand AS (
    SELECT b.account_id AS user_id, count(*)::integer AS brand_count, min(b.created_at) AS first_brand_at,
           array_agg(DISTINCT upper(btrim(b.payout_country)) ORDER BY upper(btrim(b.payout_country)))
             FILTER (WHERE NULLIF(btrim(b.payout_country), '') IS NOT NULL) AS payout_countries,
           (array_agg(b.city ORDER BY b.created_at DESC) FILTER (WHERE NULLIF(btrim(b.city), '') IS NOT NULL))[1] AS brand_city
      FROM owned b GROUP BY b.account_id
  ),
  h_event AS (
    SELECT b.account_id AS user_id, min(e.created_at) AS first_event_at,
           count(*) FILTER (WHERE e.published_at IS NOT NULL OR e.status IN ('scheduled', 'live'))::integer AS published_events,
           min(COALESCE(e.published_at, e.created_at)) FILTER (WHERE e.published_at IS NOT NULL OR e.status IN ('scheduled', 'live')) AS first_published_at
      FROM public.events e JOIN owned b ON b.id = e.brand_id
     WHERE e.deleted_at IS NULL GROUP BY b.account_id
  ),
  h_stay AS (
    SELECT b.account_id AS user_id, min(so.created_at) AS first_stay_at,
           count(*) FILTER (WHERE so.status = 'live')::integer AS live_stays
      FROM public.stay_offerings so JOIN owned b ON b.id = so.brand_id
     WHERE so.archived_at IS NULL GROUP BY b.account_id
  ),
  h_bank AS (
    SELECT b.account_id AS user_id,
           bool_or(COALESCE(b.stripe_payouts_enabled, false) OR s.id IS NOT NULL OR r.id IS NOT NULL) AS bank_connected,
           min(COALESCE(m.first_bank_added_at, s.created_at, r.created_at))
             FILTER (WHERE m.first_bank_added_at IS NOT NULL OR s.id IS NOT NULL OR r.id IS NOT NULL) AS bank_at
      FROM owned b
      LEFT JOIN public.brand_appsflyer_milestones m ON m.brand_id = b.id
      LEFT JOIN public.stripe_connect_accounts s ON s.brand_id = b.id AND s.detached_at IS NULL AND s.payouts_enabled
      LEFT JOIN public.brand_paystack_recipients r ON r.brand_id = b.id AND r.is_active
     GROUP BY b.account_id
  ),
  h_sales_rows AS (
    SELECT b.account_id AS user_id, o.event_id, o.created_at,
           first_value(o.event_id) OVER (PARTITION BY b.account_id ORDER BY o.created_at) AS first_event
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
      JOIN owned b ON b.id = e.brand_id
     WHERE o.payment_status = 'paid'
  ),
  h_sales AS (
    SELECT s.user_id, min(s.created_at) AS first_sale_at, count(DISTINCT s.event_id)::integer AS sold_offerings,
           min(s.created_at) FILTER (WHERE s.event_id <> s.first_event) AS repeat_at
      FROM h_sales_rows s GROUP BY s.user_id
  ),
  h_team AS (
    SELECT m.user_id, min(m.accepted_at) AS team_since
      FROM public.brand_team_members m
     WHERE m.user_id IN (SELECT user_id FROM acct) AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
     GROUP BY m.user_id
  ),
  h_team_brands AS (
    SELECT m.user_id, jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'role', m.role) ORDER BY b.name) AS team_brands
      FROM public.brand_team_members m JOIN public.brands b ON b.id = m.brand_id
     WHERE m.user_id IN (SELECT user_id FROM acct) AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
       AND b.deleted_at IS NULL AND b.account_id IS DISTINCT FROM m.user_id
     GROUP BY m.user_id
  ),
  host AS (
    SELECT a.user_id,
           COALESCE(hb.brand_count, 0) AS brand_count, hb.first_brand_at, hb.payout_countries, hb.brand_city,
           LEAST(he.first_event_at, hs.first_stay_at) AS first_draft_at,
           (COALESCE(he.published_events, 0) + COALESCE(hs.live_stays, 0))::integer AS published_count,
           he.first_published_at,
           COALESCE(hk.bank_connected, false) AS bank_connected, hk.bank_at,
           hsl.first_sale_at, COALESCE(hsl.sold_offerings, 0) AS sold_offerings, hsl.repeat_at,
           COALESCE(htb.team_brands, '[]'::jsonb) AS team_brands, ht.team_since
      FROM acct a
      LEFT JOIN h_brand hb ON hb.user_id = a.user_id
      LEFT JOIN h_event he ON he.user_id = a.user_id
      LEFT JOIN h_stay hs ON hs.user_id = a.user_id
      LEFT JOIN h_bank hk ON hk.user_id = a.user_id
      LEFT JOIN h_sales hsl ON hsl.user_id = a.user_id
      LEFT JOIN h_team ht ON ht.user_id = a.user_id
      LEFT JOIN h_team_brands htb ON htb.user_id = a.user_id
  ),
  -- The latest ticket an account holds, for an event country.
  ev_country AS (
    SELECT DISTINCT ON (h.user_id) h.user_id,
           upper(btrim(COALESCE(e.destination_country_code::text, b.country_code))) AS country
      FROM held h
      JOIN public.events e ON e.id = h.event_id
      LEFT JOIN public.brands b ON b.id = e.brand_id
     WHERE h.user_id IS NOT NULL
       AND NULLIF(btrim(COALESCE(e.destination_country_code::text, b.country_code)), '') IS NOT NULL
     ORDER BY h.user_id, h.created_at DESC
  ),
  -- Source evidence, one grouped pass each (never a lookup per person).
  s_friend AS (SELECT DISTINCT pi.converted_user_id AS user_id FROM public.pending_invites pi WHERE pi.converted_user_id IS NOT NULL),
  s_collab AS (
    SELECT DISTINCT ci.invited_user_id AS user_id
      FROM public.pending_session_invites psi
      JOIN public.collaboration_invites ci ON ci.id = psi.converted_invite_id
     WHERE ci.invited_user_id IS NOT NULL
  ),
  s_link_user AS (
    SELECT o.buyer_user_id AS user_id, min(o.created_at) AS first_at
      FROM public.orders o WHERE o.ticket_link_id IS NOT NULL AND o.buyer_user_id IS NOT NULL GROUP BY o.buyer_user_id
  ),
  s_link_email AS (
    SELECT lower(btrim(o.buyer_email)) AS email, min(o.created_at) AS first_at
      FROM public.orders o WHERE o.ticket_link_id IS NOT NULL AND NULLIF(btrim(o.buyer_email), '') IS NOT NULL GROUP BY 1
  ),
  s_beta AS (SELECT lower(btrim(l.email)) AS email, min(l.created_at) AS first_at FROM public.beta_access_leads l GROUP BY 1),
  s_applead AS (SELECT lower(btrim(l.email)) AS email, min(l.created_at) AS first_at FROM public.explorer_app_leads l GROUP BY 1),
  base AS (
    SELECT d.*,
           p.country AS p_country, pj.signup_source AS p_source, pj.signup_source_detail AS p_source_detail,
           pj.signup_surface AS p_surface, p.onboarding_step AS p_onb_step,
           pj.onboarding_furthest_step AS p_furthest, pj.onboarding_furthest_step_key AS p_furthest_key,
           ca.id AS ca_id, ca.created_at AS ca_created_at,
           CASE WHEN ca.id IS NOT NULL THEN pj.brand_setup_furthest_step END AS ca_step,
           CASE WHEN ca.id IS NOT NULL THEN pj.brand_setup_furthest_step_key END AS ca_step_key,
           u.created_at AS auth_created_at, u.last_sign_in_at, u.raw_app_meta_data ->> 'provider' AS provider,
           pr.discover_city_name, pr.custom_location,
           af.af_status, af.media_source, af.campaign,
           COALESCE(sv.n, 0) AS n_saves, sv.last_at AS saves_last_at,
           COALESCE(sw.n, 0) AS n_swipes,
           COALESCE(fr.n, 0) AS n_friends, COALESCE(cl.n, 0) AS n_collabs, COALESCE(ch.n, 0) AS n_chats,
           COALESCE(g.tickets, 0) AS n_tickets, COALESCE(g.rsvps, 0) AS n_rsvps,
           COALESCE(g.experiences, 0) AS n_experiences, COALESCE(g.offerings, 0) AS n_offerings, g.last_at AS going_last_at,
           h.brand_count, h.first_brand_at, h.payout_countries, h.brand_city, h.first_draft_at,
           h.published_count, h.first_published_at, h.bank_connected, h.bank_at, h.first_sale_at,
           h.sold_offerings, h.repeat_at, h.team_brands, h.team_since,
           ums.last_active_at AS map_last_active,
           (SELECT max(ua.created_at) FROM public.user_activity ua WHERE ua.user_id = d.user_id) AS ua_last,
           (sf.user_id IS NOT NULL) AS src_friend, (sc.user_id IS NOT NULL) AS src_collab,
           (slu.first_at <= d.created_at + interval '1 day' OR sle.first_at <= d.created_at + interval '1 day') AS src_link,
           (sb.first_at <= d.created_at) AS src_beta, (sa.first_at <= d.created_at) AS src_applead,
           ec.country AS event_country,
           (d.app_status IN ('host', 'both')) AS is_host
      FROM d
      LEFT JOIN public.profiles p ON p.id = d.user_id
      LEFT JOIN public.person_journey pj ON pj.user_id = d.user_id
      LEFT JOIN public.creator_accounts ca ON ca.id = d.user_id AND ca.deleted_at IS NULL
      LEFT JOIN auth.users u ON u.id = d.user_id
      LEFT JOIN public.preferences pr ON pr.profile_id = d.user_id
      LEFT JOIN af ON af.user_id = d.user_id
      LEFT JOIN saves sv ON sv.user_id = d.user_id
      LEFT JOIN swipes sw ON sw.user_id = d.user_id
      LEFT JOIN fr ON fr.user_id = d.user_id
      LEFT JOIN collab cl ON cl.user_id = d.user_id
      LEFT JOIN chats ch ON ch.user_id = d.user_id
      LEFT JOIN going g ON g.user_id = d.user_id
      LEFT JOIN host h ON h.user_id = d.user_id
      LEFT JOIN public.user_map_settings ums ON ums.user_id = d.user_id
      LEFT JOIN ev_country ec ON ec.user_id = d.user_id
      LEFT JOIN s_friend sf ON sf.user_id = d.user_id
      LEFT JOIN s_collab sc ON sc.user_id = d.user_id
      LEFT JOIN s_link_user slu ON slu.user_id = d.user_id
      LEFT JOIN s_link_email sle ON sle.email = d.email
      LEFT JOIN s_beta sb ON sb.email = d.email
      LEFT JOIN s_applead sa ON sa.email = d.email
  ),
  -- Source (spec D3, D10). Strongest first: a recorded strong source (known),
  -- then strong evidence by match (inferred), then campaign evidence, then
  -- organic, then unknown. A recorded organic / unknown never masks a
  -- stronger inferred signal.
  sourced AS MATERIALIZED (
    SELECT b.*,
      CASE
        WHEN b.user_id IS NULL AND b.app_status = 'ticket_buyer_no_app' THEN 'web_checkout|known|'
        WHEN b.user_id IS NULL THEN 'host_contact|known|'
        WHEN b.p_source IN ('friend_invite', 'collab_invite', 'ticket_link', 'host_invite', 'referral_link', 'web_ticket_first')
          THEN b.p_source || '|known|' || COALESCE(left(b.p_source_detail ->> 'label', 120), '')
        WHEN b.is_host_contact AND b.host_contact_added_at < b.created_at THEN 'host_contact|inferred|email match'
        WHEN b.first_purchase_at < b.created_at THEN 'web_ticket_first|inferred|email match'
        WHEN b.src_friend THEN 'friend_invite|inferred|invite match'
        WHEN b.src_collab THEN 'collab_invite|inferred|invite match'
        WHEN b.src_link THEN 'ticket_link|inferred|order match'
        WHEN b.src_beta THEN 'beta_lead|inferred|email match'
        WHEN b.src_applead THEN 'app_lead|inferred|email match'
        WHEN b.p_source = 'paid_ad'
          THEN 'paid_ad|known|' || COALESCE(left(b.p_source_detail ->> 'label', 120), '')
        WHEN lower(COALESCE(b.af_status, '')) = 'non-organic' AND b.media_source IS NOT NULL
          THEN 'paid_ad|known|' || b.media_source || COALESCE(' · ' || b.campaign, '')
        WHEN b.p_source IN ('app_store', 'website')
          THEN b.p_source || '|known|' || COALESCE(left(b.p_source_detail ->> 'label', 120), '')
        WHEN b.p_source = 'organic' THEN 'organic|known|'
        WHEN lower(COALESCE(b.af_status, '')) = 'organic' THEN 'organic|known|install data'
        ELSE 'unknown|unknown|'
      END AS src
      FROM base b
  ),
  placed AS (
    SELECT s.*,
      upper(NULLIF(btrim(s.p_country), '')) AS c_profile,
      public.admin_country_from_e164(s.phone_e164) AS c_phone,
      upper(NULLIF(btrim(s.country), '')) AS c_dir,
      s.payout_countries[1] AS c_payout,
      CASE
        WHEN NULLIF(btrim(s.discover_city_name), '') IS NOT NULL THEN btrim(s.discover_city_name) || '|discovery_city'
        WHEN NULLIF(btrim(s.custom_location), '') IS NOT NULL THEN btrim(s.custom_location) || '|custom_location'
        WHEN NULLIF(btrim(s.last_event_city), '') IS NOT NULL THEN btrim(s.last_event_city) || '|event_city'
        WHEN NULLIF(btrim(s.host_city), '') IS NOT NULL THEN btrim(s.host_city) || '|host_city'
        WHEN NULLIF(btrim(s.brand_city), '') IS NOT NULL THEN btrim(s.brand_city) || '|brand_city'
      END AS cty,
      NULLIF(GREATEST(
        COALESCE(s.last_sign_in_at, '-infinity'::timestamptz),
        COALESCE(s.map_last_active, '-infinity'::timestamptz),
        COALESCE(s.ua_last, '-infinity'::timestamptz),
        COALESCE(s.going_last_at, '-infinity'::timestamptz),
        COALESCE(s.saves_last_at, '-infinity'::timestamptz)), '-infinity'::timestamptz) AS last_active
      FROM sourced s
  ),
  staged AS (
    SELECT pl.*,
      CASE
        WHEN pl.user_id IS NULL THEN NULL
        WHEN pl.app_status = 'incomplete' THEN 'signing_up'
        WHEN pl.app_status IN ('explorer', 'both') THEN
          CASE
            WHEN pl.n_offerings >= 2 THEN 'regular'
            WHEN pl.n_tickets + pl.n_rsvps + pl.n_experiences > 0 THEN 'going'
            WHEN pl.n_friends + pl.n_collabs + pl.n_chats > 0 THEN 'connected'
            WHEN pl.n_saves + pl.n_swipes > 0 THEN 'exploring'
            ELSE 'onboarded'
          END
      END AS ex_stage,
      -- The host checklist, in order; NULL for a person who is not a host.
      CASE WHEN pl.is_host THEN jsonb_build_array(
        jsonb_build_object('key', 'host_account', 'done', true, 'at', COALESCE(pl.ca_created_at, pl.team_since)),
        jsonb_build_object('key', 'brand_created', 'done', COALESCE(pl.brand_count, 0) > 0, 'at', pl.first_brand_at),
        jsonb_build_object('key', 'payout_country', 'done', pl.payout_countries IS NOT NULL, 'at', NULL),
        jsonb_build_object('key', 'offering_drafted', 'done', pl.first_draft_at IS NOT NULL, 'at', pl.first_draft_at),
        jsonb_build_object('key', 'published', 'done', COALESCE(pl.published_count, 0) > 0, 'at', pl.first_published_at),
        jsonb_build_object('key', 'bank_connected', 'done', COALESCE(pl.bank_connected, false), 'at', pl.bank_at),
        jsonb_build_object('key', 'first_sale', 'done', pl.first_sale_at IS NOT NULL, 'at', pl.first_sale_at),
        jsonb_build_object('key', 'repeat_seller', 'done', COALESCE(pl.sold_offerings, 0) >= 2, 'at', pl.repeat_at))
      END AS checklist
      FROM placed pl
  )
  SELECT
    st.person_key, st.user_id, st.email, st.name, st.first_name, st.display_name, st.username,
    st.phone_e164, st.segment, st.app_status, st.is_internal, st.has_explorer, st.is_ticket_holder,
    st.in_ticket_buyer_segment, st.tickets_count, st.orders_count, st.spent, st.last_spent_cents,
    st.last_currency, st.first_purchase_at, st.last_purchase_at, st.last_event_city, st.event_cities,
    -- Country with its source (spec D4).
    CASE
      WHEN st.user_id IS NULL THEN COALESCE(st.c_dir, st.c_phone)
      ELSE COALESCE(st.c_profile, st.c_phone, st.c_dir, st.c_payout, st.event_country)
    END,
    st.marketing_consent, st.brand_ids, st.brands, st.created_at, st.preferred_language,
    st.has_completed_onboarding, st.email_verified, st.active, st.is_beta_tester, st.is_host_contact,
    st.host_brand_ids, st.host_brands, st.host_city, st.host_contact_added_at, st.consent_basis,
    -- joined_at: when the account signed up (the auth sign-up, the same date the
    -- journey's "Signed up" milestone shows), else the profile, else the first
    -- ticket, else when a host added them.
    COALESCE(st.auth_created_at, st.created_at, st.first_purchase_at, st.host_contact_added_at),
    CASE
      WHEN st.is_internal THEN 'internal'
      WHEN st.app_status = 'explorer' THEN 'explorer'
      WHEN st.app_status = 'host' THEN 'host'
      WHEN st.app_status = 'both' THEN 'both'
      WHEN st.app_status = 'incomplete' THEN 'signing_up'
      WHEN st.app_status = 'ticket_buyer_no_app' THEN 'no_account_buyer'
      WHEN st.app_status = 'host_contact_no_app' THEN 'no_account_contact'
    END,
    st.ex_stage,
    CASE WHEN st.ex_stage = 'signing_up'
         THEN COALESCE(st.p_furthest,
                       CASE WHEN st.p_onb_step IS NOT NULL THEN LEAST(GREATEST(st.p_onb_step, 0), 32767)::smallint END) END,
    CASE WHEN st.ex_stage = 'signing_up' THEN st.p_furthest_key END,
    CASE WHEN st.is_host THEN jsonb_build_object('items', st.checklist, 'team_brands', st.team_brands) END,
    CASE
      WHEN NOT st.is_host THEN NULL
      WHEN COALESCE(st.brand_count, 0) = 0 AND jsonb_array_length(st.team_brands) > 0 THEN 'team_member'
      WHEN COALESCE(st.brand_count, 0) = 0 THEN 'create_brand'
      WHEN st.payout_countries IS NULL THEN 'set_payout_country'
      WHEN st.first_draft_at IS NULL THEN 'draft_offering'
      WHEN COALESCE(st.published_count, 0) = 0 THEN 'publish'
      WHEN NOT COALESCE(st.bank_connected, false) THEN 'connect_bank'
      WHEN st.first_sale_at IS NULL THEN 'first_sale'
      WHEN COALESCE(st.sold_offerings, 0) < 2 THEN 'repeat_sale'
      ELSE 'repeat_seller'
    END,
    st.ca_step, st.ca_step_key,
    split_part(st.src, '|', 1),
    split_part(st.src, '|', 2),
    NULLIF(split_part(st.src, '|', 3), ''),
    st.p_surface,
    st.provider,
    NULLIF(split_part(COALESCE(st.cty, ''), '|', 1), ''),
    NULLIF(split_part(COALESCE(st.cty, ''), '|', 2), ''),
    CASE
      WHEN st.user_id IS NULL THEN CASE WHEN st.c_dir IS NOT NULL THEN CASE WHEN st.is_host_contact AND NOT st.is_ticket_holder THEN 'host_contact' ELSE 'phone' END
                                        WHEN st.c_phone IS NOT NULL THEN 'phone' END
      WHEN st.c_profile IS NOT NULL THEN 'profile'
      WHEN st.c_phone IS NOT NULL THEN 'phone'
      WHEN st.c_dir IS NOT NULL THEN 'host_contact'
      WHEN st.c_payout IS NOT NULL THEN 'payout_country'
      WHEN st.event_country IS NOT NULL THEN 'event'
    END,
    st.last_active,
    CASE
      WHEN st.user_id IS NULL THEN NULL
      WHEN st.last_active IS NULL THEN 'never'
      WHEN st.last_active >= now() - interval '7 days' THEN 'active'
      WHEN st.last_active >= now() - interval '30 days' THEN 'cooling'
      ELSE 'dormant'
    END,
    st.n_rsvps, st.n_experiences, st.n_tickets, st.n_saves, st.n_friends,
    COALESCE(st.brand_count, 0), st.first_brand_at, COALESCE(st.published_count, 0),
    COALESCE(st.bank_connected, false), COALESCE(st.payout_countries, '{}'::text[]), st.first_sale_at,
    -- Emails OK: a bulk send would reach them (same rules as admin-send-email).
    (NULLIF(btrim(COALESCE(st.email, '')), '') IS NOT NULL
      AND NOT st.is_internal
      AND st.marketing_consent <> 'unsubscribed'
      AND (st.user_id IS NOT NULL OR st.marketing_consent = 'yes'))
  FROM staged st;
END;
$$;
COMMENT ON FUNCTION public.admin_people_journey_rows() IS
  'Issue #4226: every People row with its journey (stage, host checklist, source, place, activity). Helper: read only through admin RPCs.';
REVOKE ALL ON FUNCTION public.admin_people_journey_rows() FROM PUBLIC, anon, authenticated;

--------------------------------------------------------------------------------
-- 2b. admin_people_directory(): the journey rows behind the guard.
--------------------------------------------------------------------------------
CREATE FUNCTION public.admin_people_directory()
RETURNS TABLE (
  person_key text, user_id uuid, email text, name text, first_name text, display_name text,
  username text, phone_e164 text, segment text, app_status text, is_internal boolean,
  has_explorer boolean, is_ticket_holder boolean, in_ticket_buyer_segment boolean,
  tickets_count integer, orders_count integer, spent jsonb, last_spent_cents bigint,
  last_currency text, first_purchase_at timestamptz, last_purchase_at timestamptz,
  last_event_city text, event_cities text[], country text, marketing_consent text,
  brand_ids uuid[], brands jsonb, created_at timestamptz, preferred_language text,
  has_completed_onboarding boolean, email_verified boolean, active boolean, is_beta_tester boolean,
  is_host_contact boolean, host_brand_ids uuid[], host_brands jsonb, host_city text,
  host_contact_added_at timestamptz, consent_basis text,
  joined_at timestamptz, person_kind text, explorer_stage text, explorer_stopped_step smallint,
  explorer_stopped_step_key text, host_checklist jsonb, host_next_step text,
  brand_setup_furthest_step smallint, brand_setup_furthest_step_key text, source text,
  source_confidence text, source_detail text, signup_surface text, sign_in_method text, city text,
  city_source text, country_source text, last_active_at timestamptz, activity_status text,
  rsvp_count integer, experience_count integer, ticket_count integer, saves_count integer,
  friends_count integer, brand_count integer, first_brand_at timestamptz, published_count integer,
  bank_connected boolean, payout_countries text[], first_sale_at timestamptz, emails_ok boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.is_admin_user() OR COALESCE(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  RETURN QUERY SELECT * FROM public.admin_people_journey_rows();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_people_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_people_directory() TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 3. One shared filter.
--------------------------------------------------------------------------------
-- Keys (any may be absent, '' or 'all'):
--   track            explorers | hosts | both | signing_up | no_account |
--                    no_account_buyers | no_account_contacts | internal
--                    (absent: everyone except staff/test)
--   explorer_stage   signing_up | onboarded | exploring | connected | going | regular
--   host_next_step   team_member | create_brand | set_payout_country |
--                    draft_offering | publish | connect_bank | first_sale |
--                    repeat_sale | repeat_seller
--   stopped_step     an onboarding step number, or 'none' (not recorded)
--   source           a source value (see admin_people_journey_rows)
--   activity_status  active | cooling | dormant | never
--   country          ISO code, any case
--   city             any case
--   payout_country   ISO code, any case
--   bank_connected   yes | no
--   joined_window    7d | 30d | 90d
--   joined_from / joined_to  YYYY-MM-DD
--   brand_id         uuid: added them as a contact or sold them a ticket
--   emails_ok        yes | no
--   search           name, email, phone, username or a brand name
CREATE OR REPLACE FUNCTION public.admin_people_filter_check(p_filters jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text;
  v_val text;
BEGIN
  IF p_filters IS NULL THEN RETURN '{}'::jsonb; END IF;
  IF jsonb_typeof(p_filters) <> 'object' THEN RAISE EXCEPTION 'invalid_filter:shape'; END IF;
  FOR v_key, v_val IN SELECT key, CASE WHEN jsonb_typeof(value) = 'null' THEN NULL ELSE value #>> '{}' END
                        FROM jsonb_each(p_filters) LOOP
    IF v_val IS NULL OR btrim(v_val) IN ('', 'all') THEN CONTINUE; END IF;
    IF v_key = 'track' AND v_val NOT IN ('explorers', 'hosts', 'both', 'signing_up', 'no_account',
                                        'no_account_buyers', 'no_account_contacts', 'internal') THEN
      RAISE EXCEPTION 'invalid_filter:track';
    ELSIF v_key = 'explorer_stage' AND v_val NOT IN ('signing_up', 'onboarded', 'exploring', 'connected', 'going', 'regular') THEN
      RAISE EXCEPTION 'invalid_filter:explorer_stage';
    ELSIF v_key = 'host_next_step' AND v_val NOT IN ('team_member', 'create_brand', 'set_payout_country', 'draft_offering',
                                                    'publish', 'connect_bank', 'first_sale', 'repeat_sale', 'repeat_seller') THEN
      RAISE EXCEPTION 'invalid_filter:host_next_step';
    ELSIF v_key = 'stopped_step' AND v_val !~ '^([0-9]{1,4}|none)$' THEN
      RAISE EXCEPTION 'invalid_filter:stopped_step';
    ELSIF v_key = 'activity_status' AND v_val NOT IN ('active', 'cooling', 'dormant', 'never') THEN
      RAISE EXCEPTION 'invalid_filter:activity_status';
    ELSIF v_key IN ('bank_connected', 'emails_ok') AND v_val NOT IN ('yes', 'no') THEN
      RAISE EXCEPTION 'invalid_filter:%', v_key;
    ELSIF v_key = 'joined_window' AND v_val NOT IN ('7d', '30d', '90d') THEN
      RAISE EXCEPTION 'invalid_filter:joined_window';
    ELSIF v_key IN ('joined_from', 'joined_to') AND v_val !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'invalid_filter:%', v_key;
    ELSIF v_key = 'brand_id' AND v_val !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'invalid_filter:brand_id';
    ELSIF v_key IN ('source', 'country', 'city', 'payout_country', 'search') AND length(v_val) > 200 THEN
      RAISE EXCEPTION 'invalid_filter:%', v_key;
    ELSIF v_key NOT IN ('track', 'explorer_stage', 'host_next_step', 'stopped_step', 'source', 'activity_status',
                        'country', 'city', 'payout_country', 'bank_connected', 'joined_window', 'joined_from',
                        'joined_to', 'brand_id', 'emails_ok', 'search') THEN
      RAISE EXCEPTION 'invalid_filter:%', v_key;
    END IF;
  END LOOP;
  RETURN p_filters;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_people_filter_check(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_people_filter_check(jsonb) TO authenticated, service_role;

-- One filter value, blanks and 'all' meaning "not set". A plain immutable SQL
-- function, so the planner inlines it: the predicate below reads each key
-- straight off the filter instead of building a lookup per person.
CREATE OR REPLACE FUNCTION public.admin_people_fv(f jsonb, k text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT NULLIF(NULLIF(btrim(f ->> k), ''), 'all') $$;
REVOKE ALL ON FUNCTION public.admin_people_fv(jsonb, text) FROM PUBLIC, anon, authenticated;

-- The one predicate, as the set of filters a row FAILS (a bit mask; 0 = the row
-- matches every filter). One evaluation per person gives every facet its
-- answer ("every filter except this one") without re-testing the row once per
-- facet. Bits: 1 track, 2 explorer_stage, 4 host_next_step, 8 stopped_step,
-- 16 source, 32 activity_status, 64 country, 128 city, 256 payout_country,
-- 512 bank_connected, 1024 joined window / from / to, 2048 brand_id,
-- 4096 emails_ok, 8192 search. Staff/test only on the internal track.
-- No SET search_path on purpose: a plain SQL function is inlined into the
-- calling query (one with a SET clause is not), so each test is a direct column
-- read. Every name in it is schema-qualified.
CREATE FUNCTION public.admin_people_row_fails_p(
  r public.admin_people_journey_row,
  p_track text, p_stage text, p_next text, p_stopped text, p_source text, p_activity text, p_country text,
  p_city text, p_payout text, p_bank text, p_jwin text, p_jfrom text, p_jto text, p_brand text, p_emails text)
RETURNS integer
LANGUAGE sql STABLE
AS $$
  SELECT
    -- 1  track
    (CASE WHEN (CASE p_track
       WHEN 'internal'            THEN r.is_internal
       WHEN 'explorers'           THEN NOT r.is_internal AND r.app_status IN ('explorer', 'both')
       WHEN 'hosts'               THEN NOT r.is_internal AND r.app_status IN ('host', 'both')
       WHEN 'both'                THEN NOT r.is_internal AND r.app_status = 'both'
       WHEN 'signing_up'          THEN NOT r.is_internal AND r.app_status = 'incomplete'
       WHEN 'no_account'          THEN NOT r.is_internal AND r.user_id IS NULL
       WHEN 'no_account_buyers'   THEN NOT r.is_internal AND r.app_status = 'ticket_buyer_no_app'
       WHEN 'no_account_contacts' THEN NOT r.is_internal AND r.app_status = 'host_contact_no_app'
       ELSE NOT r.is_internal
     END) THEN 0 ELSE 1 END) |
    -- 2  explorer_stage
    (CASE WHEN (p_stage IS NULL OR r.explorer_stage = p_stage) THEN 0 ELSE 2 END) |
    -- 4  host_next_step
    (CASE WHEN (p_next IS NULL OR r.host_next_step = p_next) THEN 0 ELSE 4 END) |
    -- 8  stopped_step
    (CASE WHEN (p_stopped IS NULL
         OR (p_stopped = 'none' AND r.explorer_stage = 'signing_up' AND r.explorer_stopped_step IS NULL)
         OR r.explorer_stopped_step::text = p_stopped) THEN 0 ELSE 8 END) |
    -- 16  source
    (CASE WHEN (p_source IS NULL OR r.source = p_source) THEN 0 ELSE 16 END) |
    -- 32  activity_status
    (CASE WHEN (p_activity IS NULL OR r.activity_status = p_activity) THEN 0 ELSE 32 END) |
    -- 64  country
    (CASE WHEN (p_country IS NULL OR upper(btrim(r.country)) = upper(p_country)) THEN 0 ELSE 64 END) |
    -- 128  city
    (CASE WHEN (p_city IS NULL OR lower(btrim(r.city)) = lower(p_city)) THEN 0 ELSE 128 END) |
    -- 256  payout_country
    (CASE WHEN (p_payout IS NULL
         OR upper(p_payout) = ANY (r.payout_countries)) THEN 0 ELSE 256 END) |
    -- 512  bank_connected
    (CASE WHEN (p_bank IS NULL
         OR (p_bank = 'yes' AND r.bank_connected)
         OR (p_bank = 'no' AND r.app_status IN ('host', 'both') AND NOT r.bank_connected)) THEN 0 ELSE 512 END) |
    -- 1024  joined (window, from, to)
    (CASE WHEN ((p_jwin IS NULL
          OR r.joined_at >= now() - (CASE p_jwin WHEN '7d' THEN 7 WHEN '30d' THEN 30 ELSE 90 END) * interval '1 day')
         AND (p_jfrom IS NULL OR r.joined_at >= (p_jfrom)::date)
         AND (p_jto IS NULL OR r.joined_at < (p_jto)::date + 1)) THEN 0 ELSE 1024 END) |
    -- 2048  brand_id
    (CASE WHEN (p_brand IS NULL
         OR (p_brand)::uuid = ANY (r.host_brand_ids)
         OR (p_brand)::uuid = ANY (r.brand_ids)) THEN 0 ELSE 2048 END) |
    -- 4096  emails_ok
    (CASE WHEN (p_emails IS NULL
         OR (p_emails = 'yes') = r.emails_ok) THEN 0 ELSE 4096 END)
$$;
REVOKE ALL ON FUNCTION public.admin_people_row_fails_p(public.admin_people_journey_row, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;

-- The search filter (bit 8192): the name, email, phone or username, or the name
-- of a brand they own or were added by. A sub-select, so this one is not
-- inlined; callers run it only when a search is set.
CREATE FUNCTION public.admin_people_row_search_fails(r public.admin_people_journey_row, p_search text)
RETURNS integer
LANGUAGE sql STABLE
AS $$
  SELECT CASE WHEN p_search IS NULL
         OR r.name ILIKE '%' || p_search || '%'
         OR r.email ILIKE '%' || p_search || '%'
         OR r.phone_e164 ILIKE '%' || p_search || '%'
         OR r.username ILIKE '%' || p_search || '%'
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.host_brands, '[]'::jsonb) || COALESCE(r.brands, '[]'::jsonb)) b
                     WHERE b ->> 'name' ILIKE '%' || p_search || '%')
       THEN 0 ELSE 8192 END
$$;
REVOKE ALL ON FUNCTION public.admin_people_row_search_fails(public.admin_people_journey_row, text) FROM PUBLIC, anon, authenticated;

-- The same, reading a filter object. Callers that test one filter against many
-- people parse it once into columns and call the _p form (reading the keys off
-- the jsonb per person is what costs).
CREATE FUNCTION public.admin_people_row_fails(r public.admin_people_journey_row, f jsonb)
RETURNS integer
LANGUAGE sql STABLE
AS $$
  SELECT public.admin_people_row_fails_p(r,
    public.admin_people_fv(f, 'track'), public.admin_people_fv(f, 'explorer_stage'),
    public.admin_people_fv(f, 'host_next_step'), public.admin_people_fv(f, 'stopped_step'),
    public.admin_people_fv(f, 'source'), public.admin_people_fv(f, 'activity_status'),
    public.admin_people_fv(f, 'country'), public.admin_people_fv(f, 'city'),
    public.admin_people_fv(f, 'payout_country'), public.admin_people_fv(f, 'bank_connected'),
    public.admin_people_fv(f, 'joined_window'), public.admin_people_fv(f, 'joined_from'),
    public.admin_people_fv(f, 'joined_to'), public.admin_people_fv(f, 'brand_id'),
    public.admin_people_fv(f, 'emails_ok'))
    | public.admin_people_row_search_fails(r, public.admin_people_fv(f, 'search'))
$$;
REVOKE ALL ON FUNCTION public.admin_people_row_fails(public.admin_people_journey_row, jsonb) FROM PUBLIC, anon, authenticated;

-- p_skip names a filter to ignore (a facet's own key). The track and the search
-- are never skipped.
CREATE FUNCTION public.admin_people_row_matches(r public.admin_people_journey_row, f jsonb, p_skip text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT (public.admin_people_row_fails(r, f) & ~(CASE p_skip
            WHEN 'explorer_stage' THEN 2 WHEN 'host_next_step' THEN 4 WHEN 'stopped_step' THEN 8
            WHEN 'source' THEN 16 WHEN 'activity_status' THEN 32 WHEN 'country' THEN 64 WHEN 'city' THEN 128
            WHEN 'payout_country' THEN 256 WHEN 'bank_connected' THEN 512 WHEN 'joined' THEN 1024
            WHEN 'brand_id' THEN 2048 WHEN 'emails_ok' THEN 4096 ELSE 0 END)) = 0
$$;
REVOKE ALL ON FUNCTION public.admin_people_row_matches(public.admin_people_journey_row, jsonb, text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.admin_people_filter(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  person_key text, user_id uuid, email text, name text, first_name text, display_name text,
  username text, phone_e164 text, segment text, app_status text, is_internal boolean,
  has_explorer boolean, is_ticket_holder boolean, in_ticket_buyer_segment boolean,
  tickets_count integer, orders_count integer, spent jsonb, last_spent_cents bigint,
  last_currency text, first_purchase_at timestamptz, last_purchase_at timestamptz,
  last_event_city text, event_cities text[], country text, marketing_consent text,
  brand_ids uuid[], brands jsonb, created_at timestamptz, preferred_language text,
  has_completed_onboarding boolean, email_verified boolean, active boolean, is_beta_tester boolean,
  is_host_contact boolean, host_brand_ids uuid[], host_brands jsonb, host_city text,
  host_contact_added_at timestamptz, consent_basis text,
  joined_at timestamptz, person_kind text, explorer_stage text, explorer_stopped_step smallint,
  explorer_stopped_step_key text, host_checklist jsonb, host_next_step text,
  brand_setup_furthest_step smallint, brand_setup_furthest_step_key text, source text,
  source_confidence text, source_detail text, signup_surface text, sign_in_method text, city text,
  city_source text, country_source text, last_active_at timestamptz, activity_status text,
  rsvp_count integer, experience_count integer, ticket_count integer, saves_count integer,
  friends_count integer, brand_count integer, first_brand_at timestamptz, published_count integer,
  bank_connected boolean, payout_countries text[], first_sale_at timestamptz, emails_ok boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_f jsonb;
BEGIN
  IF NOT (public.is_admin_user() OR COALESCE(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  v_f := public.admin_people_filter_check(COALESCE(p_filters, '{}'::jsonb));
  RETURN QUERY
    SELECT j.* FROM public.admin_people_journey_rows() j
     WHERE public.admin_people_row_matches(j, v_f, NULL);
END;
$$;
COMMENT ON FUNCTION public.admin_people_filter(jsonb) IS
  'Issue #4226: the People rows a filter matches. People and admin-send-email both read this, so their counts are equal.';
REVOKE ALL ON FUNCTION public.admin_people_filter(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_people_filter(jsonb) TO authenticated, service_role;

-- Many counts in one pass: {"name": filter, ...} -> {"name": count, ...}.
CREATE OR REPLACE FUNCTION public.admin_people_filter_counts(p_named jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_name text;
  v_f jsonb;
BEGIN
  IF NOT (public.is_admin_user() OR COALESCE(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_named IS NULL OR jsonb_typeof(p_named) <> 'object' THEN RAISE EXCEPTION 'invalid_filter:shape'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_named)) > 50 THEN RAISE EXCEPTION 'invalid_filter:too_many'; END IF;
  FOR v_name, v_f IN SELECT key, value FROM jsonb_each(p_named) LOOP
    PERFORM public.admin_people_filter_check(v_f);
  END LOOP;

  -- One pass over the people; each named filter is tested per person.
  SELECT COALESCE(jsonb_object_agg(n.key, COALESCE(c.n, 0)), '{}'::jsonb)
    INTO v_out
    FROM jsonb_each(p_named) n
    LEFT JOIN (
      SELECT f.key, count(*) AS n
        FROM public.admin_people_journey_rows() r
        CROSS JOIN (SELECT n2.key, public.admin_people_fv(n2.value, 'track') AS a1, public.admin_people_fv(n2.value, 'explorer_stage') AS a2, public.admin_people_fv(n2.value, 'host_next_step') AS a3, public.admin_people_fv(n2.value, 'stopped_step') AS a4, public.admin_people_fv(n2.value, 'source') AS a5, public.admin_people_fv(n2.value, 'activity_status') AS a6, public.admin_people_fv(n2.value, 'country') AS a7, public.admin_people_fv(n2.value, 'city') AS a8, public.admin_people_fv(n2.value, 'payout_country') AS a9, public.admin_people_fv(n2.value, 'bank_connected') AS a10, public.admin_people_fv(n2.value, 'joined_window') AS a11, public.admin_people_fv(n2.value, 'joined_from') AS a12, public.admin_people_fv(n2.value, 'joined_to') AS a13, public.admin_people_fv(n2.value, 'brand_id') AS a14, public.admin_people_fv(n2.value, 'emails_ok') AS a15, public.admin_people_fv(n2.value, 'search') AS a16
                      FROM jsonb_each(p_named) n2) f
       WHERE (public.admin_people_row_fails_p(r, f.a1, f.a2, f.a3, f.a4, f.a5, f.a6, f.a7, f.a8, f.a9, f.a10, f.a11, f.a12, f.a13, f.a14, f.a15)
              | public.admin_people_row_search_fails(r, f.a16)) = 0
       GROUP BY f.key
    ) c ON c.key = n.key;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_people_filter_counts(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_people_filter_counts(jsonb) TO authenticated, service_role;

-- Facets: for each filter key, the values people in this track actually have,
-- each with the count the filter would give if that value were chosen (every
-- other filter kept). An option with no one is never offered.
CREATE OR REPLACE FUNCTION public.admin_people_facets(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_f   jsonb;
  v_out jsonb;
BEGIN
  IF NOT (public.is_admin_user() OR COALESCE(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  v_f := public.admin_people_filter_check(COALESCE(p_filters, '{}'::jsonb));

  -- One pass: each person's failed-filter mask is computed once; a facet then
  -- keeps the people who fail nothing except its own filter.
  WITH j AS MATERIALIZED (
    SELECT (public.admin_people_row_fails_p(r, pf.a1, pf.a2, pf.a3, pf.a4, pf.a5, pf.a6, pf.a7, pf.a8, pf.a9, pf.a10, pf.a11, pf.a12, pf.a13, pf.a14, pf.a15)
             | public.admin_people_row_search_fails(r, pf.a16)) AS fails,
           r.person_key, r.app_status, r.explorer_stage, r.host_next_step, r.explorer_stopped_step,
           r.source, r.activity_status, r.country, r.city, r.payout_countries, r.bank_connected,
           r.emails_ok, r.host_brands, r.brands
      FROM public.admin_people_journey_rows() r
     CROSS JOIN (SELECT public.admin_people_fv(v_f, 'track') AS a1, public.admin_people_fv(v_f, 'explorer_stage') AS a2, public.admin_people_fv(v_f, 'host_next_step') AS a3, public.admin_people_fv(v_f, 'stopped_step') AS a4, public.admin_people_fv(v_f, 'source') AS a5, public.admin_people_fv(v_f, 'activity_status') AS a6, public.admin_people_fv(v_f, 'country') AS a7, public.admin_people_fv(v_f, 'city') AS a8, public.admin_people_fv(v_f, 'payout_country') AS a9, public.admin_people_fv(v_f, 'bank_connected') AS a10, public.admin_people_fv(v_f, 'joined_window') AS a11, public.admin_people_fv(v_f, 'joined_from') AS a12, public.admin_people_fv(v_f, 'joined_to') AS a13, public.admin_people_fv(v_f, 'brand_id') AS a14, public.admin_people_fv(v_f, 'emails_ok') AS a15, public.admin_people_fv(v_f, 'search') AS a16) pf
  ),
  vals AS (
    SELECT 'explorer_stage'::text AS k, j.explorer_stage AS v, j.explorer_stage AS label
      FROM j WHERE (j.fails & ~2) = 0
    UNION ALL SELECT 'host_next_step', j.host_next_step, j.host_next_step
      FROM j WHERE (j.fails & ~4) = 0
    UNION ALL SELECT 'stopped_step',
           CASE WHEN j.explorer_stage = 'signing_up' THEN COALESCE(j.explorer_stopped_step::text, 'none') END,
           CASE WHEN j.explorer_stage = 'signing_up' THEN COALESCE(j.explorer_stopped_step::text, 'none') END
      FROM j WHERE (j.fails & ~8) = 0
    UNION ALL SELECT 'source', j.source, j.source
      FROM j WHERE (j.fails & ~16) = 0
    UNION ALL SELECT 'activity_status', j.activity_status, j.activity_status
      FROM j WHERE (j.fails & ~32) = 0
    UNION ALL SELECT 'country', upper(btrim(j.country)), upper(btrim(j.country))
      FROM j WHERE (j.fails & ~64) = 0
    UNION ALL SELECT 'city', lower(btrim(j.city)), btrim(j.city)
      FROM j WHERE (j.fails & ~128) = 0
    UNION ALL SELECT 'payout_country', pc, pc
      FROM j CROSS JOIN LATERAL unnest(j.payout_countries) pc
     WHERE (j.fails & ~256) = 0
    UNION ALL SELECT 'bank_connected', CASE WHEN j.bank_connected THEN 'yes' ELSE 'no' END,
           CASE WHEN j.bank_connected THEN 'yes' ELSE 'no' END
      FROM j WHERE j.app_status IN ('host', 'both') AND (j.fails & ~512) = 0
    UNION ALL SELECT 'emails_ok', CASE WHEN j.emails_ok THEN 'yes' ELSE 'no' END,
           CASE WHEN j.emails_ok THEN 'yes' ELSE 'no' END
      FROM j WHERE (j.fails & ~4096) = 0
    UNION ALL SELECT DISTINCT 'brand_id', j.person_key || '|' || (b ->> 'id'), b ->> 'name'
      FROM j CROSS JOIN LATERAL jsonb_array_elements(COALESCE(j.host_brands, '[]'::jsonb) || COALESCE(j.brands, '[]'::jsonb)) b
     WHERE b ->> 'id' IS NOT NULL AND (j.fails & ~2048) = 0
  ),
  -- A brand counts each person once (bought from and added by can both hold).
  norm AS (
    SELECT k, CASE WHEN k = 'brand_id' THEN split_part(v, '|', 2) ELSE v END AS v, label FROM vals WHERE v IS NOT NULL
  ),
  agg AS (
    SELECT k, v, min(label) AS label, count(*) AS n FROM norm GROUP BY k, v
  )
  SELECT jsonb_build_object(
           'total', (SELECT count(*) FROM j WHERE j.fails = 0),
           'facets', COALESCE((
             SELECT jsonb_object_agg(x.k, x.opts) FROM (
               SELECT a.k, jsonb_agg(jsonb_build_object('value', a.v, 'label', a.label, 'count', a.n)
                                     ORDER BY a.n DESC, a.label) AS opts
                 FROM agg a GROUP BY a.k) x), '{}'::jsonb),
           'as_of', now())
    INTO v_out;
  RETURN v_out;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_people_facets(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_people_facets(jsonb) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 4. One person's journey: dated milestones from database facts.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_person_journey(p_key text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row   public.admin_people_journey_row;
  v_uid   uuid;
  v_email text;
  v_ms    jsonb;
  v_brands jsonb;
  v_counts jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_key IS NULL OR length(p_key) > 330 OR p_key !~ '^(u:[0-9a-fA-F-]{36}|e:.{3,})$' THEN RAISE EXCEPTION 'invalid_key'; END IF;

  SELECT j.* INTO v_row FROM public.admin_people_journey_rows() j WHERE j.person_key = p_key;
  IF v_row.person_key IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  v_uid := v_row.user_id;
  v_email := v_row.email;

  WITH ms AS (
    -- Account and Explorer.
    SELECT u.created_at AS at, 'signed_up' AS kind, 'Signed up' AS label, 'account' AS track, NULL::text AS detail
      FROM auth.users u WHERE u.id = v_uid
    UNION ALL
    SELECT pj.onboarding_furthest_step_at, 'onboarding_step', 'Reached onboarding step ' || pj.onboarding_furthest_step,
           'explorer', pj.onboarding_furthest_step_key
      FROM public.person_journey pj WHERE pj.user_id = v_uid AND pj.onboarding_furthest_step_at IS NOT NULL
    UNION ALL
    SELECT min(s.created_at), 'first_save', 'First save', 'explorer', NULL
      FROM public.saved_card s WHERE s.profile_id = v_uid HAVING count(*) > 0
    UNION ALL
    SELECT min(f.created_at), 'first_friend', 'First friend added', 'explorer', NULL
      FROM public.friends f WHERE (f.user_id = v_uid OR f.friend_user_id = v_uid)
       AND f.status = 'accepted' AND f.deleted_at IS NULL HAVING count(*) > 0
    UNION ALL
    SELECT min(sp.created_at), 'first_collab', 'First collab session', 'explorer', NULL
      FROM public.session_participants sp WHERE sp.user_id = v_uid HAVING count(*) > 0
    UNION ALL
    SELECT r.created_at, 'rsvp', 'RSVP: ' || COALESCE(e.title, 'an event'), 'explorer', r.rsvp_status
      FROM public.event_rsvps r LEFT JOIN public.events e ON e.id = r.event_id
     WHERE r.user_id = v_uid AND r.rsvp_status IN ('going', 'maybe')
    UNION ALL
    -- Tickets: by account, or (no account) by email.
    SELECT o.created_at,
           CASE WHEN e.event_type IN ('experience', 'trip') THEN 'experience'
                WHEN e.event_type = 'rsvp' THEN 'rsvp' ELSE 'ticket' END,
           CASE WHEN e.event_type IN ('experience', 'trip') THEN 'Booked: '
                WHEN e.event_type = 'rsvp' THEN 'RSVP: ' ELSE 'Bought a ticket: ' END || COALESCE(e.title, 'an event'),
           CASE WHEN v_uid IS NULL THEN 'no_account' ELSE 'explorer' END,
           CASE WHEN v_uid IS NOT NULL AND v_row.first_purchase_at < v_row.created_at AND o.created_at < v_row.created_at
                THEN 'before sign-up' END
      FROM public.orders o LEFT JOIN public.events e ON e.id = o.event_id
     WHERE o.payment_status = 'paid'
       AND ((v_uid IS NOT NULL AND o.buyer_user_id = v_uid)
            OR (v_email IS NOT NULL AND lower(btrim(o.buyer_email)) = v_email))
    UNION ALL
    SELECT g.created_at, 'experience', 'Booked a stay', 'explorer', NULL
      FROM public.stay_reservation_groups g
     WHERE (g.user_id = v_uid OR g.booked_by_user_id = v_uid) AND g.state IN ('confirmed', 'partially_cancelled')
    UNION ALL
    -- Host contact.
    SELECT (hb ->> 'added_at')::timestamptz, 'host_contact', 'Added to contacts by ' || COALESCE(hb ->> 'name', 'a brand'),
           'contact', hb ->> 'source'
      FROM jsonb_array_elements(COALESCE(v_row.host_brands, '[]'::jsonb)) hb
    UNION ALL
    -- Host.
    SELECT ca.created_at, 'host_account', 'Created a Host account', 'host', NULL
      FROM public.creator_accounts ca WHERE ca.id = v_uid
    UNION ALL
    SELECT pj.brand_setup_furthest_step_at, 'brand_setup_step', 'Reached brand setup step ' || pj.brand_setup_furthest_step,
           'host', pj.brand_setup_furthest_step_key
      FROM public.person_journey pj
      JOIN public.creator_accounts ca ON ca.id = pj.user_id AND ca.deleted_at IS NULL
     WHERE pj.user_id = v_uid AND pj.brand_setup_furthest_step_at IS NOT NULL
    UNION ALL
    SELECT b.created_at, 'brand_created', 'Created brand ' || b.name, 'host',
           NULLIF(concat_ws(' · ', upper(b.payout_country), b.default_currency::text), '')
      FROM public.brands b WHERE b.account_id = v_uid AND b.deleted_at IS NULL
    UNION ALL
    SELECT m.accepted_at, 'team_member', 'Joined the team at ' || b.name, 'host', m.role
      FROM public.brand_team_members m JOIN public.brands b ON b.id = m.brand_id
     WHERE m.user_id = v_uid AND m.accepted_at IS NOT NULL AND b.account_id IS DISTINCT FROM v_uid
    UNION ALL
    SELECT min(e.created_at), 'offering_drafted', 'Drafted a first offering', 'host', NULL
      FROM public.events e JOIN public.brands b ON b.id = e.brand_id
     WHERE b.account_id = v_uid AND e.deleted_at IS NULL HAVING count(*) > 0
    UNION ALL
    SELECT e.published_at, 'published', 'Published ' || e.title, 'host', NULL
      FROM public.events e JOIN public.brands b ON b.id = e.brand_id
     WHERE b.account_id = v_uid AND e.deleted_at IS NULL AND e.published_at IS NOT NULL
    UNION ALL
    SELECT m.first_bank_added_at, 'bank_connected', 'Connected a bank for ' || b.name, 'host', NULL
      FROM public.brand_appsflyer_milestones m JOIN public.brands b ON b.id = m.brand_id
     WHERE b.account_id = v_uid AND m.first_bank_added_at IS NOT NULL
    UNION ALL
    SELECT min(o.created_at), 'first_sale', 'First sale', 'host', NULL
      FROM public.orders o JOIN public.events e ON e.id = o.event_id JOIN public.brands b ON b.id = e.brand_id
     WHERE b.account_id = v_uid AND o.payment_status = 'paid' HAVING count(*) > 0
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('at', x.at, 'kind', x.kind, 'label', x.label, 'track', x.track, 'detail', x.detail)
                            ORDER BY x.at DESC), '[]'::jsonb)
    INTO v_ms
    FROM (SELECT * FROM ms WHERE ms.at IS NOT NULL ORDER BY ms.at DESC LIMIT 200) x;

  -- The brands they own, each with its own money and progress facts.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', b.id, 'name', b.name, 'created_at', b.created_at,
           'payout_country', upper(NULLIF(btrim(b.payout_country), '')),
           'currency', b.default_currency, 'payment_provider', b.payment_provider,
           'payments_setup_started_at', b.payments_setup_started_at,
           'stripe_payouts_enabled', COALESCE(b.stripe_payouts_enabled, false)
                                     OR EXISTS (SELECT 1 FROM public.stripe_connect_accounts s
                                                 WHERE s.brand_id = b.id AND s.detached_at IS NULL AND s.payouts_enabled),
           'paystack_bank', EXISTS (SELECT 1 FROM public.brand_paystack_recipients r WHERE r.brand_id = b.id AND r.is_active),
           'bank_added_at', (SELECT m.first_bank_added_at FROM public.brand_appsflyer_milestones m WHERE m.brand_id = b.id),
           'drafts', (SELECT count(*) FROM public.events e WHERE e.brand_id = b.id AND e.deleted_at IS NULL
                         AND e.published_at IS NULL AND e.status = 'draft'),
           'published', (SELECT count(*) FROM public.events e WHERE e.brand_id = b.id AND e.deleted_at IS NULL
                            AND (e.published_at IS NOT NULL OR e.status IN ('scheduled', 'live'))),
           'first_sale_at', (SELECT min(o.created_at) FROM public.orders o JOIN public.events e ON e.id = o.event_id
                              WHERE e.brand_id = b.id AND o.payment_status = 'paid'))
           ORDER BY b.created_at), '[]'::jsonb)
    INTO v_brands
    FROM public.brands b
   WHERE v_uid IS NOT NULL AND b.account_id = v_uid AND b.deleted_at IS NULL;

  IF v_uid IS NOT NULL THEN
    v_counts := jsonb_build_object(
      'saves', v_row.saves_count,
      'friends', v_row.friends_count,
      'collab_sessions', (SELECT count(DISTINCT sp.session_id) FROM public.session_participants sp WHERE sp.user_id = v_uid),
      'chats', (SELECT count(DISTINCT cp.conversation_id) FROM public.conversation_participants cp
                  JOIN public.conversations c ON c.id = cp.conversation_id
                 WHERE cp.user_id = v_uid AND (c.type = 'direct' OR c.session_id IS NOT NULL)),
      'brands_followed', (SELECT count(*) FROM public.brand_follows bf WHERE bf.user_id = v_uid),
      'tickets', v_row.ticket_count,
      'rsvps', v_row.rsvp_count,
      'experiences', v_row.experience_count);
  END IF;

  RETURN jsonb_build_object('person', to_jsonb(v_row), 'milestones', v_ms, 'brands', v_brands, 'counts', v_counts);
END;
$$;
COMMENT ON FUNCTION public.admin_person_journey(text) IS
  'Issue #4226: one person (person_key u:<id> or e:<email>) with their journey row and dated milestones from database facts. Admin only.';
REVOKE ALL ON FUNCTION public.admin_person_journey(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_person_journey(text) TO authenticated;

--------------------------------------------------------------------------------
-- 5. One owner: the full record and the Support desk read the People
--    classifier, not derive_user_segment().
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_person(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_out jsonb; v_st RECORD;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;  -- (I-ADMIN-GATE-FIRST-STATEMENT)
  SELECT to_jsonb(p) INTO v_out FROM public.profiles p WHERE p.id = p_user_id;
  IF v_out IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  -- #4226: the People classifier (a seed profile has no People row: 'seed').
  SELECT s.segment, s.app_status, s.is_host, s.has_explorer, s.is_internal INTO v_st
    FROM public.admin_people_app_status() s WHERE s.user_id = p_user_id;
  v_out := jsonb_build_object(
    'person',  v_out || jsonb_build_object(
                  'segment', COALESCE(v_st.segment, 'seed'),
                  'app_status', v_st.app_status,
                  'is_host', COALESCE(v_st.is_host, false),
                  'has_explorer', COALESCE(v_st.has_explorer, false),
                  'is_internal', COALESCE(v_st.is_internal, false)),
    'account', (SELECT to_jsonb(a) FROM public.creator_accounts a WHERE a.id = p_user_id),
    'brands_owned', COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.created_at DESC)
                              FROM public.brands b WHERE b.account_id = p_user_id), '[]'::jsonb),
    'brands_member', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                 'brand_id', b.id, 'brand_name', b.name, 'brand_slug', b.slug,
                                 'role', m.role, 'accepted_at', m.accepted_at, 'removed_at', m.removed_at))
                              FROM public.brand_team_members m JOIN public.brands b ON b.id = m.brand_id
                              WHERE m.user_id = p_user_id), '[]'::jsonb),
    'subscription', jsonb_build_object(
        'effective_tier', public.get_effective_tier(p_user_id),
        'raw', (SELECT to_jsonb(s) FROM public.subscriptions s WHERE s.user_id = p_user_id)),
    'active_override', (SELECT to_jsonb(o) FROM public.admin_subscription_overrides o
                        WHERE o.user_id = p_user_id AND o.revoked_at IS NULL
                          AND o.starts_at <= now() AND o.expires_at > now()
                        ORDER BY o.expires_at DESC LIMIT 1),
    'tickets', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                            'id', t.id, 'subject', t.subject, 'status', t.status, 'priority', t.priority,
                            'brand_id', t.brand_id, 'created_at', t.created_at, 'last_message_at', t.last_message_at)
                            ORDER BY t.last_message_at DESC)
                         FROM public.support_tickets t WHERE t.requester_user_id = p_user_id), '[]'::jsonb));
  RETURN v_out;
END; $$;
REVOKE EXECUTE ON FUNCTION public.admin_get_person(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_get_person(uuid) TO authenticated;

-- Support desk: people by id or by a search, with the People classifier's
-- segment ('explorer' | 'host' | 'both' | 'incomplete' | 'internal').
CREATE OR REPLACE FUNCTION public.admin_people_lookup(p_user_ids uuid[] DEFAULT NULL, p_query text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_q   text := NULLIF(btrim(COALESCE(p_query, '')), '');
  v_out jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_user_ids IS NULL AND (v_q IS NULL OR length(v_q) < 2) THEN RETURN '[]'::jsonb; END IF;
  IF p_user_ids IS NOT NULL AND cardinality(p_user_ids) > 1000 THEN RAISE EXCEPTION 'too_many_ids'; END IF;
  v_q := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id, 'display_name', p.display_name, 'username', p.username, 'email', p.email,
           'avatar_url', p.avatar_url,
           'segment', COALESCE(s.segment, 'seed'), 'app_status', s.app_status)), '[]'::jsonb)
    INTO v_out
    FROM (
      SELECT p.* FROM public.profiles p
       WHERE (p_user_ids IS NOT NULL AND p.id = ANY (p_user_ids))
          OR (p_user_ids IS NULL AND (p.display_name ILIKE '%' || v_q || '%'
                                      OR p.username ILIKE '%' || v_q || '%'
                                      OR p.email ILIKE '%' || v_q || '%'))
       ORDER BY p.display_name NULLS LAST, p.id
       LIMIT CASE WHEN p_user_ids IS NULL THEN 8 ELSE 1000 END
    ) p
    LEFT JOIN public.admin_people_app_status() s ON s.user_id = p.id;
  RETURN v_out;
END;
$$;
COMMENT ON FUNCTION public.admin_people_lookup(uuid[], text) IS
  'Issue #4226: Support desk people (by ids or a search of at least 2 characters) with the People classifier''s segment. Admin only.';
REVOKE ALL ON FUNCTION public.admin_people_lookup(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_people_lookup(uuid[], text) TO authenticated;

COMMIT;
