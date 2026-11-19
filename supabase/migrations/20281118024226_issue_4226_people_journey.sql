-- Issue #4226 Phase 2 — People journey intelligence and Email segmentation.
--
-- Spec: "Phase 2 spec" + addenda D10 and D11 on #4226 (Seth approved,
-- 2026-11-18). One build, one PR.
--
-- What this migration adds:
--   1. Tracking columns the Explorer and Host apps write through three
--      SECURITY DEFINER RPCs (a fixed contract the apps code against):
--        profiles          signup_source, signup_source_detail, signup_surface,
--                          onboarding_furthest_step(_key, _at)
--        creator_accounts  brand_setup_furthest_step(_key, _at)
--        appsflyer_devices af_status, media_source, campaign, install_time,
--                          conversion_payload, attribution_received_at
--      record_journey_mark(kind, step, key)   monotonic, own row only
--      record_signup_source(source, detail, surface)  first write wins
--      record_install_attribution(appsflyer id, app, payload)
--                                             own device row, first media
--                                             source wins
--      A guard trigger keeps a signed-in client from writing these columns
--      directly (they have table grants on these tables), so the RPC rules
--      cannot be bypassed.
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
-- Source precedence (spec D3, with D11's tracking): a recorded signup source
--   (other than organic / unknown) and AppsFlyer non-organic install data are
--   "known" and outrank every inference; then host contact added before the
--   account, web ticket before the account, friend invite, collab invite,
--   ticket link, beta or app lead (all "inferred" by email or invite match);
--   else unknown. People with no account: web_checkout / host_contact, known.
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
-- 1. Tracking columns.
--------------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS signup_source text,
  ADD COLUMN IF NOT EXISTS signup_source_detail jsonb,
  ADD COLUMN IF NOT EXISTS signup_surface text,
  ADD COLUMN IF NOT EXISTS onboarding_furthest_step smallint,
  ADD COLUMN IF NOT EXISTS onboarding_furthest_step_key text,
  ADD COLUMN IF NOT EXISTS onboarding_furthest_step_at timestamptz;

ALTER TABLE public.creator_accounts
  ADD COLUMN IF NOT EXISTS brand_setup_furthest_step smallint,
  ADD COLUMN IF NOT EXISTS brand_setup_furthest_step_key text,
  ADD COLUMN IF NOT EXISTS brand_setup_furthest_step_at timestamptz;

ALTER TABLE public.appsflyer_devices
  ADD COLUMN IF NOT EXISTS af_status text,
  ADD COLUMN IF NOT EXISTS media_source text,
  ADD COLUMN IF NOT EXISTS campaign text,
  ADD COLUMN IF NOT EXISTS install_time timestamptz,
  ADD COLUMN IF NOT EXISTS conversion_payload jsonb,
  ADD COLUMN IF NOT EXISTS attribution_received_at timestamptz;

COMMENT ON COLUMN public.profiles.signup_source IS
  'Issue #4226: how this person came to Mingla, recorded once by the app (record_signup_source).';
COMMENT ON COLUMN public.profiles.onboarding_furthest_step IS
  'Issue #4226: the furthest Explorer onboarding step reached (record_journey_mark, monotonic).';
COMMENT ON COLUMN public.creator_accounts.brand_setup_furthest_step IS
  'Issue #4226: the furthest Host brand-setup step reached (record_journey_mark, monotonic).';
COMMENT ON COLUMN public.appsflyer_devices.media_source IS
  'Issue #4226: the install media source from AppsFlyer conversion data (record_install_attribution, first wins).';

-- Signed-in clients hold table grants on these tables; these columns are
-- written only through the RPCs below (which run as the function owner).
CREATE OR REPLACE FUNCTION public.issue_4226_guard_journey_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'profiles' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.signup_source IS NOT NULL OR NEW.signup_source_detail IS NOT NULL OR NEW.signup_surface IS NOT NULL
         OR NEW.onboarding_furthest_step IS NOT NULL OR NEW.onboarding_furthest_step_key IS NOT NULL
         OR NEW.onboarding_furthest_step_at IS NOT NULL THEN
        RAISE EXCEPTION 'journey_fields_server_owned';
      END IF;
    ELSIF NEW.signup_source IS DISTINCT FROM OLD.signup_source
       OR NEW.signup_source_detail IS DISTINCT FROM OLD.signup_source_detail
       OR NEW.signup_surface IS DISTINCT FROM OLD.signup_surface
       OR NEW.onboarding_furthest_step IS DISTINCT FROM OLD.onboarding_furthest_step
       OR NEW.onboarding_furthest_step_key IS DISTINCT FROM OLD.onboarding_furthest_step_key
       OR NEW.onboarding_furthest_step_at IS DISTINCT FROM OLD.onboarding_furthest_step_at THEN
      RAISE EXCEPTION 'journey_fields_server_owned';
    END IF;
  ELSIF TG_TABLE_NAME = 'creator_accounts' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.brand_setup_furthest_step IS NOT NULL OR NEW.brand_setup_furthest_step_key IS NOT NULL
         OR NEW.brand_setup_furthest_step_at IS NOT NULL THEN
        RAISE EXCEPTION 'journey_fields_server_owned';
      END IF;
    ELSIF NEW.brand_setup_furthest_step IS DISTINCT FROM OLD.brand_setup_furthest_step
       OR NEW.brand_setup_furthest_step_key IS DISTINCT FROM OLD.brand_setup_furthest_step_key
       OR NEW.brand_setup_furthest_step_at IS DISTINCT FROM OLD.brand_setup_furthest_step_at THEN
      RAISE EXCEPTION 'journey_fields_server_owned';
    END IF;
  ELSIF TG_TABLE_NAME = 'appsflyer_devices' THEN
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
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_4226_guard_journey_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS issue_4226_guard_journey_columns ON public.profiles;
CREATE TRIGGER issue_4226_guard_journey_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.issue_4226_guard_journey_columns();
DROP TRIGGER IF EXISTS issue_4226_guard_journey_columns ON public.creator_accounts;
CREATE TRIGGER issue_4226_guard_journey_columns
  BEFORE INSERT OR UPDATE ON public.creator_accounts
  FOR EACH ROW EXECUTE FUNCTION public.issue_4226_guard_journey_columns();
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
    UPDATE public.profiles p
       SET onboarding_furthest_step = p_step,
           onboarding_furthest_step_key = v_key,
           onboarding_furthest_step_at = now()
     WHERE p.id = v_uid
       AND (p.onboarding_furthest_step IS NULL
            OR p_step > p.onboarding_furthest_step
            OR (p_step = p.onboarding_furthest_step AND v_key IS DISTINCT FROM p.onboarding_furthest_step_key));
  ELSE
    UPDATE public.creator_accounts ca
       SET brand_setup_furthest_step = p_step,
           brand_setup_furthest_step_key = v_key,
           brand_setup_furthest_step_at = now()
     WHERE ca.id = v_uid
       AND ca.deleted_at IS NULL
       AND (ca.brand_setup_furthest_step IS NULL
            OR p_step > ca.brand_setup_furthest_step
            OR (p_step = ca.brand_setup_furthest_step AND v_key IS DISTINCT FROM ca.brand_setup_furthest_step_key));
  END IF;
END;
$$;
COMMENT ON FUNCTION public.record_journey_mark(text, smallint, text) IS
  'Issue #4226: the signed-in person reached an onboarding (explorer_onboarding) or brand-setup (host_brand_setup) step. Monotonic; same step updates the key only when it changed; no row is a no-op.';
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

  UPDATE public.profiles p
     SET signup_source = p_source,
         signup_source_detail = p_detail,
         signup_surface = p_surface
   WHERE p.id = v_uid
     AND p.signup_source IS NULL;
END;
$$;
COMMENT ON FUNCTION public.record_signup_source(text, jsonb, text) IS
  'Issue #4226: how the signed-in person came to Mingla. First write wins; the source is checked against an allow-list.';
REVOKE ALL ON FUNCTION public.record_signup_source(text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_signup_source(text, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_install_attribution(p_appsflyer_id text, p_app text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_status  text;
  v_media   text;
  v_camp    text;
  v_install timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NULLIF(btrim(COALESCE(p_appsflyer_id, '')), '') IS NULL THEN RAISE EXCEPTION 'invalid_appsflyer_id'; END IF;
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

  -- First media source wins: once one is stored the row is left alone. An
  -- organic first answer (no media source) may still be upgraded.
  UPDATE public.appsflyer_devices d
     SET af_status = v_status,
         media_source = v_media,
         campaign = v_camp,
         install_time = v_install,
         conversion_payload = p_payload,
         attribution_received_at = now()
   WHERE d.user_id = v_uid
     AND d.appsflyer_uid = btrim(p_appsflyer_id)
     AND d.app = p_app
     AND d.media_source IS NULL;
END;
$$;
COMMENT ON FUNCTION public.record_install_attribution(text, text, jsonb) IS
  'Issue #4226: store AppsFlyer conversion data on the signed-in person''s own device row (user, AppsFlyer id, app). First media source wins.';
REVOKE ALL ON FUNCTION public.record_install_attribution(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_install_attribution(text, text, jsonb) TO authenticated;

--------------------------------------------------------------------------------
-- 2. The journey row and its one owner.
--------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_people_directory();
DROP FUNCTION IF EXISTS public.admin_people_filter(jsonb);
DROP FUNCTION IF EXISTS public.admin_people_row_matches(public.admin_people_journey_row, jsonb, text);
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
  -- offering's type; each RSVP; each confirmed stay.
  held AS (
    SELECT COALESCE(
             t.holder_user_id,
             (SELECT ae.user_id FROM acct_email ae
               WHERE ae.email = lower(btrim(COALESCE(NULLIF(btrim(t.holder_email), ''), t.attendee_email)))),
             CASE WHEN NULLIF(btrim(COALESCE(t.holder_email, t.attendee_email, '')), '') IS NULL
                  THEN COALESCE(o.buyer_user_id,
                                (SELECT ae.user_id FROM acct_email ae WHERE ae.email = lower(btrim(o.buyer_email)))) END
           ) AS user_id,
           t.id AS ticket_id, o.event_id, e.event_type, o.created_at
      FROM public.tickets t
      JOIN public.orders o ON o.id = t.order_id AND o.payment_status = 'paid'
      LEFT JOIN public.events e ON e.id = o.event_id
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
  going AS (
    SELECT a.user_id,
           (SELECT count(DISTINCT h.ticket_id) FROM held h WHERE h.user_id = a.user_id
               AND COALESCE(h.event_type, 'event') NOT IN ('rsvp', 'experience', 'trip'))::integer AS tickets,
           ((SELECT count(DISTINCT h.ticket_id) FROM held h WHERE h.user_id = a.user_id AND h.event_type = 'rsvp')
            + (SELECT count(DISTINCT r.event_id) FROM rs r WHERE r.user_id = a.user_id))::integer AS rsvps,
           ((SELECT count(DISTINCT h.ticket_id) FROM held h WHERE h.user_id = a.user_id AND h.event_type IN ('experience', 'trip'))
            + (SELECT count(*) FROM stays s WHERE s.user_id = a.user_id))::integer AS experiences,
           ((SELECT count(DISTINCT x.k) FROM (
               SELECT 'e:' || h.event_id::text AS k FROM held h WHERE h.user_id = a.user_id AND h.event_id IS NOT NULL
               UNION SELECT 'e:' || r.event_id::text FROM rs r WHERE r.user_id = a.user_id
               UNION SELECT 'v:' || s.venue_id::text FROM stays s WHERE s.user_id = a.user_id) x))::integer AS offerings,
           GREATEST(
             (SELECT max(h.created_at) FROM held h WHERE h.user_id = a.user_id),
             (SELECT max(r.created_at) FROM rs r WHERE r.user_id = a.user_id),
             (SELECT max(s.created_at) FROM stays s WHERE s.user_id = a.user_id)) AS last_at
      FROM acct a
  ),
  -- Host facts over the brands a person owns.
  owned AS (
    SELECT b.* FROM public.brands b
     WHERE b.deleted_at IS NULL AND b.account_id IN (SELECT user_id FROM acct)
  ),
  host AS (
    SELECT a.user_id,
           (SELECT count(*) FROM owned b WHERE b.account_id = a.user_id)::integer AS brand_count,
           (SELECT min(b.created_at) FROM owned b WHERE b.account_id = a.user_id) AS first_brand_at,
           (SELECT array_agg(DISTINCT upper(btrim(b.payout_country)) ORDER BY upper(btrim(b.payout_country)))
              FROM owned b WHERE b.account_id = a.user_id AND NULLIF(btrim(b.payout_country), '') IS NOT NULL) AS payout_countries,
           (SELECT (array_agg(b.city ORDER BY b.created_at DESC) FILTER (WHERE NULLIF(btrim(b.city), '') IS NOT NULL))[1]
              FROM owned b WHERE b.account_id = a.user_id) AS brand_city,
           LEAST(
             (SELECT min(e.created_at) FROM public.events e JOIN owned b ON b.id = e.brand_id
               WHERE b.account_id = a.user_id AND e.deleted_at IS NULL),
             (SELECT min(so.created_at) FROM public.stay_offerings so JOIN owned b ON b.id = so.brand_id
               WHERE b.account_id = a.user_id AND so.archived_at IS NULL)) AS first_draft_at,
           ((SELECT count(*) FROM public.events e JOIN owned b ON b.id = e.brand_id
              WHERE b.account_id = a.user_id AND e.deleted_at IS NULL
                AND (e.published_at IS NOT NULL OR e.status IN ('scheduled', 'live')))
            + (SELECT count(*) FROM public.stay_offerings so JOIN owned b ON b.id = so.brand_id
              WHERE b.account_id = a.user_id AND so.archived_at IS NULL AND so.status = 'live'))::integer AS published_count,
           (SELECT min(COALESCE(e.published_at, e.created_at)) FROM public.events e JOIN owned b ON b.id = e.brand_id
              WHERE b.account_id = a.user_id AND e.deleted_at IS NULL
                AND (e.published_at IS NOT NULL OR e.status IN ('scheduled', 'live'))) AS first_published_at,
           EXISTS (
             SELECT 1 FROM owned b WHERE b.account_id = a.user_id AND (
               COALESCE(b.stripe_payouts_enabled, false)
               OR EXISTS (SELECT 1 FROM public.stripe_connect_accounts s
                           WHERE s.brand_id = b.id AND s.detached_at IS NULL AND s.payouts_enabled)
               OR EXISTS (SELECT 1 FROM public.brand_paystack_recipients r
                           WHERE r.brand_id = b.id AND r.is_active))) AS bank_connected,
           (SELECT min(COALESCE(m.first_bank_added_at, s.created_at, r.created_at))
              FROM owned b
              LEFT JOIN public.brand_appsflyer_milestones m ON m.brand_id = b.id
              LEFT JOIN public.stripe_connect_accounts s ON s.brand_id = b.id AND s.detached_at IS NULL AND s.payouts_enabled
              LEFT JOIN public.brand_paystack_recipients r ON r.brand_id = b.id AND r.is_active
             WHERE b.account_id = a.user_id
               AND (m.first_bank_added_at IS NOT NULL OR s.id IS NOT NULL OR r.id IS NOT NULL)) AS bank_at,
           (SELECT min(o.created_at) FROM public.orders o JOIN public.events e ON e.id = o.event_id
              JOIN owned b ON b.id = e.brand_id
             WHERE b.account_id = a.user_id AND o.payment_status = 'paid') AS first_sale_at,
           (SELECT count(DISTINCT o.event_id) FROM public.orders o JOIN public.events e ON e.id = o.event_id
              JOIN owned b ON b.id = e.brand_id
             WHERE b.account_id = a.user_id AND o.payment_status = 'paid')::integer AS sold_offerings,
           (SELECT min(o.created_at) FROM public.orders o JOIN public.events e ON e.id = o.event_id
              JOIN owned b ON b.id = e.brand_id
             WHERE b.account_id = a.user_id AND o.payment_status = 'paid'
               AND o.event_id <> (SELECT o2.event_id FROM public.orders o2 JOIN public.events e2 ON e2.id = o2.event_id
                                   JOIN owned b2 ON b2.id = e2.brand_id
                                  WHERE b2.account_id = a.user_id AND o2.payment_status = 'paid'
                                  ORDER BY o2.created_at LIMIT 1)) AS repeat_at,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'role', m.role) ORDER BY b.name)
               FROM public.brand_team_members m JOIN public.brands b ON b.id = m.brand_id
              WHERE m.user_id = a.user_id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
                AND b.deleted_at IS NULL AND b.account_id IS DISTINCT FROM a.user_id), '[]'::jsonb) AS team_brands,
           (SELECT min(m.accepted_at) FROM public.brand_team_members m
             WHERE m.user_id = a.user_id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL) AS team_since
      FROM acct a
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
  base AS (
    SELECT d.*,
           p.country AS p_country, p.signup_source AS p_source, p.signup_source_detail AS p_source_detail,
           p.signup_surface AS p_surface, p.onboarding_step AS p_onb_step,
           p.onboarding_furthest_step AS p_furthest, p.onboarding_furthest_step_key AS p_furthest_key,
           ca.id AS ca_id, ca.created_at AS ca_created_at,
           ca.brand_setup_furthest_step AS ca_step, ca.brand_setup_furthest_step_key AS ca_step_key,
           u.last_sign_in_at, u.raw_app_meta_data ->> 'provider' AS provider,
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
           ec.country AS event_country,
           (d.app_status IN ('host', 'both')) AS is_host
      FROM d
      LEFT JOIN public.profiles p ON p.id = d.user_id
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
  ),
  -- Source (spec D3). Inferred signals are evaluated only when nothing known.
  sourced AS (
    SELECT b.*,
      CASE
        WHEN b.user_id IS NULL AND b.app_status = 'ticket_buyer_no_app' THEN 'web_checkout|known|'
        WHEN b.user_id IS NULL THEN 'host_contact|known|'
        WHEN b.p_source IS NOT NULL AND b.p_source NOT IN ('unknown', 'organic', 'app_store')
          THEN b.p_source || '|known|' || COALESCE(left(b.p_source_detail ->> 'label', 120), '')
        WHEN lower(COALESCE(b.af_status, '')) = 'non-organic' AND b.media_source IS NOT NULL
          THEN 'paid_ad|known|' || b.media_source || COALESCE(' · ' || b.campaign, '')
        WHEN b.p_source IN ('organic', 'app_store') THEN b.p_source || '|known|'
        WHEN lower(COALESCE(b.af_status, '')) = 'organic' THEN 'organic|known|install data'
        WHEN b.is_host_contact AND b.host_contact_added_at < b.created_at THEN 'host_contact|inferred|email match'
        WHEN b.first_purchase_at < b.created_at THEN 'web_ticket_first|inferred|email match'
        WHEN EXISTS (SELECT 1 FROM public.pending_invites pi WHERE pi.converted_user_id = b.user_id)
          THEN 'friend_invite|inferred|invite match'
        WHEN EXISTS (SELECT 1 FROM public.pending_session_invites psi
                       JOIN public.collaboration_invites ci ON ci.id = psi.converted_invite_id
                      WHERE ci.invited_user_id = b.user_id)
          THEN 'collab_invite|inferred|invite match'
        WHEN EXISTS (SELECT 1 FROM public.orders o
                      WHERE o.ticket_link_id IS NOT NULL
                        AND (o.buyer_user_id = b.user_id OR lower(btrim(o.buyer_email)) = b.email)
                        AND o.created_at <= b.created_at + interval '1 day')
          THEN 'ticket_link|inferred|order match'
        WHEN EXISTS (SELECT 1 FROM public.beta_access_leads l
                      WHERE lower(btrim(l.email)) = b.email AND l.created_at <= b.created_at)
          THEN 'beta_lead|inferred|email match'
        WHEN EXISTS (SELECT 1 FROM public.explorer_app_leads l
                      WHERE lower(btrim(l.email)) = b.email AND l.created_at <= b.created_at)
          THEN 'app_lead|inferred|email match'
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
    -- joined_at: the account, else the first ticket, else when a host added them.
    COALESCE(st.created_at, st.first_purchase_at, st.host_contact_added_at),
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
         THEN COALESCE(st.p_furthest, LEAST(GREATEST(st.p_onb_step, 0), 32767)::smallint) END,
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

-- The one predicate. p_skip names a key to ignore (facet counts). The track is
-- never skipped.
CREATE FUNCTION public.admin_people_row_matches(r public.admin_people_journey_row, f jsonb, p_skip text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  WITH v AS (
    SELECT k, NULLIF(NULLIF(btrim(f ->> k), ''), 'all') AS val
      FROM unnest(ARRAY['track', 'explorer_stage', 'host_next_step', 'stopped_step', 'source',
                        'activity_status', 'country', 'city', 'payout_country', 'bank_connected',
                        'joined_window', 'joined_from', 'joined_to', 'brand_id', 'emails_ok', 'search']) k
  ), m AS (SELECT jsonb_object_agg(k, val) AS x FROM v)
  SELECT
    -- Track (never skipped). Staff/test only on the internal track.
    (CASE m.x ->> 'track'
       WHEN 'internal'            THEN r.is_internal
       WHEN 'explorers'           THEN NOT r.is_internal AND r.app_status IN ('explorer', 'both')
       WHEN 'hosts'               THEN NOT r.is_internal AND r.app_status IN ('host', 'both')
       WHEN 'both'                THEN NOT r.is_internal AND r.app_status = 'both'
       WHEN 'signing_up'          THEN NOT r.is_internal AND r.app_status = 'incomplete'
       WHEN 'no_account'          THEN NOT r.is_internal AND r.user_id IS NULL
       WHEN 'no_account_buyers'   THEN NOT r.is_internal AND r.app_status = 'ticket_buyer_no_app'
       WHEN 'no_account_contacts' THEN NOT r.is_internal AND r.app_status = 'host_contact_no_app'
       ELSE NOT r.is_internal
     END)
    AND (p_skip = 'explorer_stage' OR m.x ->> 'explorer_stage' IS NULL OR r.explorer_stage = m.x ->> 'explorer_stage')
    AND (p_skip = 'host_next_step' OR m.x ->> 'host_next_step' IS NULL OR r.host_next_step = m.x ->> 'host_next_step')
    AND (p_skip = 'stopped_step' OR m.x ->> 'stopped_step' IS NULL
         OR (m.x ->> 'stopped_step' = 'none' AND r.explorer_stage = 'signing_up' AND r.explorer_stopped_step IS NULL)
         OR r.explorer_stopped_step::text = m.x ->> 'stopped_step')
    AND (p_skip = 'source' OR m.x ->> 'source' IS NULL OR r.source = m.x ->> 'source')
    AND (p_skip = 'activity_status' OR m.x ->> 'activity_status' IS NULL OR r.activity_status = m.x ->> 'activity_status')
    -- Case-insensitive country (the old Email filter compared exact case).
    AND (p_skip = 'country' OR m.x ->> 'country' IS NULL OR upper(btrim(r.country)) = upper(m.x ->> 'country'))
    AND (p_skip = 'city' OR m.x ->> 'city' IS NULL OR lower(btrim(r.city)) = lower(m.x ->> 'city'))
    AND (p_skip = 'payout_country' OR m.x ->> 'payout_country' IS NULL
         OR upper(m.x ->> 'payout_country') = ANY (r.payout_countries))
    AND (p_skip = 'bank_connected' OR m.x ->> 'bank_connected' IS NULL
         OR (m.x ->> 'bank_connected' = 'yes' AND r.bank_connected)
         OR (m.x ->> 'bank_connected' = 'no' AND r.app_status IN ('host', 'both') AND NOT r.bank_connected))
    AND (p_skip = 'joined' OR m.x ->> 'joined_window' IS NULL
         OR r.joined_at >= now() - (CASE m.x ->> 'joined_window' WHEN '7d' THEN 7 WHEN '30d' THEN 30 ELSE 90 END) * interval '1 day')
    AND (p_skip = 'joined' OR m.x ->> 'joined_from' IS NULL OR r.joined_at >= (m.x ->> 'joined_from')::date)
    AND (p_skip = 'joined' OR m.x ->> 'joined_to' IS NULL OR r.joined_at < (m.x ->> 'joined_to')::date + 1)
    AND (p_skip = 'brand_id' OR m.x ->> 'brand_id' IS NULL
         OR (m.x ->> 'brand_id')::uuid = ANY (r.host_brand_ids)
         OR (m.x ->> 'brand_id')::uuid = ANY (r.brand_ids))
    AND (p_skip = 'emails_ok' OR m.x ->> 'emails_ok' IS NULL
         OR (m.x ->> 'emails_ok' = 'yes') = r.emails_ok)
    AND (m.x ->> 'search' IS NULL
         OR r.name ILIKE '%' || (m.x ->> 'search') || '%'
         OR r.email ILIKE '%' || (m.x ->> 'search') || '%'
         OR r.phone_e164 ILIKE '%' || (m.x ->> 'search') || '%'
         OR r.username ILIKE '%' || (m.x ->> 'search') || '%'
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.host_brands, '[]'::jsonb) || COALESCE(r.brands, '[]'::jsonb)) b
                     WHERE b ->> 'name' ILIKE '%' || (m.x ->> 'search') || '%'))
  FROM m
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
    SELECT (j).* FROM (SELECT j FROM public.admin_people_journey_rows() j) x
     WHERE public.admin_people_row_matches(x.j, v_f, NULL);
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

  WITH j AS MATERIALIZED (SELECT r FROM public.admin_people_journey_rows() r)
  SELECT COALESCE(jsonb_object_agg(n.key, (
           SELECT count(*) FROM j WHERE public.admin_people_row_matches(j.r, n.value, NULL))), '{}'::jsonb)
    INTO v_out
    FROM jsonb_each(p_named) n;
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

  WITH j AS MATERIALIZED (SELECT r FROM public.admin_people_journey_rows() r),
  vals AS (
    SELECT 'explorer_stage'::text AS k, (j.r).explorer_stage AS v, (j.r).explorer_stage AS label
      FROM j WHERE public.admin_people_row_matches(j.r, v_f, 'explorer_stage')
    UNION ALL SELECT 'host_next_step', (j.r).host_next_step, (j.r).host_next_step
      FROM j WHERE public.admin_people_row_matches(j.r, v_f, 'host_next_step')
    UNION ALL SELECT 'stopped_step',
           CASE WHEN (j.r).explorer_stage = 'signing_up' THEN COALESCE((j.r).explorer_stopped_step::text, 'none') END,
           CASE WHEN (j.r).explorer_stage = 'signing_up' THEN COALESCE((j.r).explorer_stopped_step::text, 'none') END
      FROM j WHERE public.admin_people_row_matches(j.r, v_f, 'stopped_step')
    UNION ALL SELECT 'source', (j.r).source, (j.r).source
      FROM j WHERE public.admin_people_row_matches(j.r, v_f, 'source')
    UNION ALL SELECT 'activity_status', (j.r).activity_status, (j.r).activity_status
      FROM j WHERE public.admin_people_row_matches(j.r, v_f, 'activity_status')
    UNION ALL SELECT 'country', upper(btrim((j.r).country)), upper(btrim((j.r).country))
      FROM j WHERE public.admin_people_row_matches(j.r, v_f, 'country')
    UNION ALL SELECT 'city', lower(btrim((j.r).city)), btrim((j.r).city)
      FROM j WHERE public.admin_people_row_matches(j.r, v_f, 'city')
    UNION ALL SELECT 'payout_country', pc, pc
      FROM j CROSS JOIN LATERAL unnest((j.r).payout_countries) pc
     WHERE public.admin_people_row_matches(j.r, v_f, 'payout_country')
    UNION ALL SELECT 'bank_connected', CASE WHEN (j.r).bank_connected THEN 'yes' ELSE 'no' END,
           CASE WHEN (j.r).bank_connected THEN 'yes' ELSE 'no' END
      FROM j WHERE (j.r).app_status IN ('host', 'both') AND public.admin_people_row_matches(j.r, v_f, 'bank_connected')
    UNION ALL SELECT 'emails_ok', CASE WHEN (j.r).emails_ok THEN 'yes' ELSE 'no' END,
           CASE WHEN (j.r).emails_ok THEN 'yes' ELSE 'no' END
      FROM j WHERE public.admin_people_row_matches(j.r, v_f, 'emails_ok')
    UNION ALL SELECT DISTINCT 'brand_id', (j.r).person_key || '|' || (b ->> 'id'), b ->> 'name'
      FROM j CROSS JOIN LATERAL jsonb_array_elements(COALESCE((j.r).host_brands, '[]'::jsonb) || COALESCE((j.r).brands, '[]'::jsonb)) b
     WHERE b ->> 'id' IS NOT NULL AND public.admin_people_row_matches(j.r, v_f, 'brand_id')
  ),
  -- A brand counts each person once (bought from and added by can both hold).
  norm AS (
    SELECT k, CASE WHEN k = 'brand_id' THEN split_part(v, '|', 2) ELSE v END AS v, label FROM vals WHERE v IS NOT NULL
  ),
  agg AS (
    SELECT k, v, min(label) AS label, count(*) AS n FROM norm GROUP BY k, v
  )
  SELECT jsonb_build_object(
           'total', (SELECT count(*) FROM j WHERE public.admin_people_row_matches(j.r, v_f, NULL)),
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
    SELECT p.created_at AS at, 'signed_up' AS kind, 'Signed up' AS label, 'account' AS track, NULL::text AS detail
      FROM public.profiles p WHERE p.id = v_uid
    UNION ALL
    SELECT p.onboarding_furthest_step_at, 'onboarding_step', 'Reached onboarding step ' || p.onboarding_furthest_step,
           'explorer', p.onboarding_furthest_step_key
      FROM public.profiles p WHERE p.id = v_uid AND p.onboarding_furthest_step_at IS NOT NULL
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
    SELECT ca.brand_setup_furthest_step_at, 'brand_setup_step', 'Reached brand setup step ' || ca.brand_setup_furthest_step,
           'host', ca.brand_setup_furthest_step_key
      FROM public.creator_accounts ca WHERE ca.id = v_uid AND ca.brand_setup_furthest_step_at IS NOT NULL
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
