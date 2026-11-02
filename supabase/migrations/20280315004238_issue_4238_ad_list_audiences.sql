-- Issue #4238 wave 2 — customer-list and lookalike audiences, and the daily
-- series behind the ad results charts.
--
-- Seth's decisions (2 Nov 2026, on #4238):
--   * Hosts get audiences built only from their own brand's data; Admin gets
--     Mingla-wide audiences. No Mingla-wide fallback for Hosts.
--   * Everyone is included (app-only Explorer users, staff and test accounts)
--     except the platform-required exclusions below.
--
-- What this migration adds:
--   1. ad_list_audiences            definitions (stable audience_key)
--   2. ad_list_audience_members     membership snapshot: SHA-256 hex ONLY
--   3. ad_list_audience_platforms   per-platform sync state + provider id
--   4. ad_platform_audience_terms   provider terms / eligibility state
--   5. ad_list_audience_sync_runs   counts-only sync log (kept 90 days)
--   6. definer functions: normalisers, refresh, ensure_brand,
--      host_ad_audiences (the only Host read path), the mark-dirty trigger,
--      and ad_campaign_daily_series for the results charts
--   7. an hourly cron that posts {"action":"removals"} to admin-ad-audiences
--   8. removes the dead ad_buyer_list_sync_enabled flag (its readers are gone)
--
-- Privacy: identifiers are normalised and hashed INSIDE Postgres
-- (extensions.digest). No email or phone is ever written to an audience table
-- or returned by any function here; the CHECKs make storing one impossible.
-- Members are readable by service_role only; Admin sees counts, Hosts see
-- rounded sizes through host_ad_audiences().
--
-- Exclusions (applied to every source, matched on the normalised identifier):
--   E1 ad opt-out / GPC latch on any checkout session or stay group
--   E2 deleted or inactive accounts (profiles / auth.users)
--   E3 only active People and active contact methods are read
--   E4a unsubscribes and suppressions that are a person's choice exclude the
--       whole person everywhere
--   E4b a (hard) bounce drops only that one email hash
--   E5 known under-18s (profiles.birthday, creator_profiles.date_of_birth)
--
-- Static SQL only (no EXECUTE of built strings); conflicts raise PT409.
-- Do not auto-apply. Release through the governed migration lane only, BEFORE
-- the edge functions that call these RPCs.

BEGIN;

--------------------------------------------------------------------------------
-- 1. Tables
--------------------------------------------------------------------------------
CREATE TABLE public.ad_list_audiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience_key text NOT NULL UNIQUE CHECK (
    audience_key ~ '^(mingla:[a-z_]+:[a-z0-9_:-]+|brand:[0-9a-f-]{36}:[a-z_]+(:[A-Z]{2})?)$'
  ),
  owner_kind text NOT NULL CHECK (owner_kind IN ('mingla','host')),
  brand_id uuid NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('list','lookalike')),
  source text NOT NULL CHECK (source IN ('guests','contacts','seed','users','buyers','everyone')),
  filter jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(filter) = 'object'
    AND (filter - ARRAY['country','city','page_type']) = '{}'::jsonb
    AND (NOT filter ? 'country' OR (filter->>'country') ~ '^[A-Z]{2}$')
    AND (NOT filter ? 'city' OR (filter->>'city') ~ '^[a-z0-9 ._''-]{1,80}$')
    AND (NOT filter ? 'page_type' OR (filter->>'page_type') IN ('event','rsvp','trip','experience','venue'))
  ),
  seed_audience_id uuid NULL REFERENCES public.ad_list_audiences(id) ON DELETE CASCADE,
  lookalike_country text NULL CHECK (lookalike_country ~ '^[A-Z]{2}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  host_visible boolean NOT NULL DEFAULT true,
  member_count integer NOT NULL DEFAULT 0 CHECK (member_count >= 0),
  member_count_by_country jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(member_count_by_country) = 'object'),
  members_refreshed_at timestamptz NULL,
  requested_at timestamptz NULL,
  last_used_at timestamptz NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_list_audiences_owner_brand CHECK ((owner_kind = 'host') = (brand_id IS NOT NULL)),
  CONSTRAINT ad_list_audiences_lookalike_shape CHECK (
    (kind = 'lookalike') = (seed_audience_id IS NOT NULL AND lookalike_country IS NOT NULL)
  )
);
CREATE INDEX ad_list_audiences_brand_idx ON public.ad_list_audiences(brand_id, status);
CREATE INDEX ad_list_audiences_seed_idx ON public.ad_list_audiences(seed_audience_id)
  WHERE seed_audience_id IS NOT NULL;

CREATE TABLE public.ad_list_audience_members (
  audience_id uuid NOT NULL REFERENCES public.ad_list_audiences(id) ON DELETE CASCADE,
  member_key text NOT NULL CHECK (member_key ~ '^[0-9a-f]{64}$'),
  email_sha256 text NULL CHECK (email_sha256 ~ '^[0-9a-f]{64}$'),
  email_google_sha256 text NULL CHECK (email_google_sha256 ~ '^[0-9a-f]{64}$'),
  phone_sha256 text NULL CHECK (phone_sha256 ~ '^[0-9a-f]{64}$'),
  phone_e164_sha256 text NULL CHECK (phone_e164_sha256 ~ '^[0-9a-f]{64}$'),
  country text NULL CHECK (country ~ '^[A-Z]{2}$'),
  added_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz NULL,
  CONSTRAINT ad_list_audience_members_identifier CHECK (email_sha256 IS NOT NULL OR phone_sha256 IS NOT NULL),
  PRIMARY KEY (audience_id, member_key)
);
CREATE INDEX ad_list_audience_members_added_idx
  ON public.ad_list_audience_members(audience_id, added_at) WHERE removed_at IS NULL;
CREATE INDEX ad_list_audience_members_removed_idx
  ON public.ad_list_audience_members(audience_id, removed_at) WHERE removed_at IS NOT NULL;

CREATE TABLE public.ad_list_audience_platforms (
  audience_id uuid NOT NULL REFERENCES public.ad_list_audiences(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('meta','snapchat','tiktok','reddit','google')),
  connection_id uuid NOT NULL REFERENCES public.ad_connections(id),
  provider_audience_id text NULL CHECK (provider_audience_id IS NULL OR char_length(provider_audience_id) BETWEEN 1 AND 200),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN (
    'pending','below_minimum','syncing','ready','too_small','terms_required',
    'ineligible','unsupported','error','retired')),
  needed_count integer NULL CHECK (needed_count IS NULL OR needed_count >= 0),
  approx_size bigint NULL CHECK (approx_size IS NULL OR approx_size >= 0),
  synced_through timestamptz NULL,
  last_full_sync_at timestamptz NULL,
  last_synced_at timestamptz NULL,
  error_code text NULL CHECK (error_code IS NULL OR char_length(error_code) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (audience_id, platform)
);
CREATE UNIQUE INDEX ad_list_audience_platforms_provider_id_key
  ON public.ad_list_audience_platforms(platform, provider_audience_id)
  WHERE provider_audience_id IS NOT NULL;

CREATE TABLE public.ad_platform_audience_terms (
  connection_id uuid PRIMARY KEY REFERENCES public.ad_connections(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('meta','snapchat','tiktok','reddit','google')),
  state text NOT NULL DEFAULT 'unknown' CHECK (state IN ('unknown','accepted','not_accepted','not_applicable')),
  eligibility text NOT NULL DEFAULT 'unknown' CHECK (eligibility IN ('unknown','eligible','exclusion_only','ineligible')),
  checked_at timestamptz NULL,
  admin_confirmed_at timestamptz NULL,
  admin_confirmed_by uuid NULL,
  detail_code text NULL CHECK (detail_code IS NULL OR char_length(detail_code) <= 120),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ad_list_audience_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  kind text NOT NULL CHECK (kind IN ('daily','removals')),
  audiences_refreshed integer NOT NULL DEFAULT 0,
  adds integer NOT NULL DEFAULT 0,
  removes integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  more boolean NOT NULL DEFAULT false,
  cursor jsonb NULL CHECK (cursor IS NULL OR jsonb_typeof(cursor) = 'object')
);
CREATE INDEX ad_list_audience_sync_runs_started_idx ON public.ad_list_audience_sync_runs(started_at DESC);

--------------------------------------------------------------------------------
-- 2. RLS and grants. Members: service_role only, never Admin, never Hosts.
--------------------------------------------------------------------------------
ALTER TABLE public.ad_list_audiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_list_audience_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_list_audience_platforms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_platform_audience_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_list_audience_sync_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ad_list_audiences FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ad_list_audience_members FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ad_list_audience_platforms FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ad_platform_audience_terms FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ad_list_audience_sync_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ad_list_audiences TO service_role;
GRANT ALL ON public.ad_list_audience_members TO service_role;
GRANT ALL ON public.ad_list_audience_platforms TO service_role;
GRANT ALL ON public.ad_platform_audience_terms TO service_role;
GRANT ALL ON public.ad_list_audience_sync_runs TO service_role;

GRANT SELECT ON public.ad_list_audiences TO authenticated;
GRANT SELECT ON public.ad_list_audience_platforms TO authenticated;
GRANT SELECT ON public.ad_platform_audience_terms TO authenticated;
GRANT SELECT ON public.ad_list_audience_sync_runs TO authenticated;

CREATE POLICY ad_list_audiences_admin_read ON public.ad_list_audiences
  FOR SELECT TO authenticated USING (public.is_admin_user());
CREATE POLICY ad_list_audience_platforms_admin_read ON public.ad_list_audience_platforms
  FOR SELECT TO authenticated USING (public.is_admin_user());
CREATE POLICY ad_platform_audience_terms_admin_read ON public.ad_platform_audience_terms
  FOR SELECT TO authenticated USING (public.is_admin_user());
CREATE POLICY ad_list_audience_sync_runs_admin_read ON public.ad_list_audience_sync_runs
  FOR SELECT TO authenticated USING (public.is_admin_user());

--------------------------------------------------------------------------------
-- 3. Normalisers (service_role only)
--------------------------------------------------------------------------------
-- Meta / Snap / TikTok / Reddit email: trim, lower-case.
CREATE OR REPLACE FUNCTION public.ad_list_audience_normalize_email(p_email text)
RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
  SELECT CASE
    WHEN p_email IS NULL THEN NULL
    WHEN lower(btrim(p_email)) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN lower(btrim(p_email))
    ELSE NULL
  END;
$function$;

-- Google Customer Match: gmail.com / googlemail.com drop dots and +suffix.
CREATE OR REPLACE FUNCTION public.ad_list_audience_normalize_email_google(p_email text)
RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
  WITH e AS (SELECT public.ad_list_audience_normalize_email(p_email) AS v)
  SELECT CASE
    WHEN e.v IS NULL THEN NULL
    WHEN split_part(e.v, '@', 2) IN ('gmail.com','googlemail.com') THEN
      replace(split_part(split_part(e.v, '@', 1), '+', 1), '.', '') || '@' || split_part(e.v, '@', 2)
    ELSE e.v
  END
  FROM e;
$function$;

-- Phone: international form only ('+…' or '00…'), digits with the country
-- code and no '+' (Meta, Snap, TikTok). A local-format number is unusable for
-- matching and is dropped rather than guessed.
CREATE OR REPLACE FUNCTION public.ad_list_audience_normalize_phone(p_phone text)
RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
  WITH s AS (SELECT btrim(coalesce(p_phone, '')) AS v),
  d AS (
    SELECT CASE
      WHEN s.v LIKE '+%' THEN regexp_replace(s.v, '[^0-9]', '', 'g')
      WHEN s.v LIKE '00%' THEN regexp_replace(substr(s.v, 3), '[^0-9]', '', 'g')
      ELSE NULL
    END AS digits
    FROM s
  )
  SELECT CASE WHEN d.digits ~ '^[1-9][0-9]{7,14}$' THEN d.digits ELSE NULL END FROM d;
$function$;

CREATE OR REPLACE FUNCTION public.ad_list_audience_sha256(p_value text)
RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
  SELECT CASE WHEN p_value IS NULL THEN NULL
    ELSE encode(extensions.digest(p_value, 'sha256'), 'hex') END;
$function$;

-- Calling code → ISO-2 for the codes present in Mingla's data (fallback 3).
CREATE OR REPLACE FUNCTION public.ad_list_audience_phone_country(p_digits text)
RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
  SELECT c.iso FROM (VALUES
    ('234','NG'), ('233','GH'), ('254','KE'), ('353','IE'),
    ('27','ZA'), ('32','BE'), ('33','FR'), ('44','GB'), ('49','DE'), ('1','US')
  ) AS c(code, iso)
  WHERE p_digits IS NOT NULL AND p_digits LIKE c.code || '%'
  ORDER BY length(c.code) DESC
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.ad_list_audience_normalize_email(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ad_list_audience_normalize_email_google(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ad_list_audience_normalize_phone(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ad_list_audience_sha256(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ad_list_audience_phone_country(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_list_audience_normalize_email(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_list_audience_normalize_email_google(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_list_audience_normalize_phone(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_list_audience_sha256(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ad_list_audience_phone_country(text) TO service_role;

--------------------------------------------------------------------------------
-- 4. Membership refresh
--------------------------------------------------------------------------------
-- Candidate rows: (email normalised, phone digits, user id, country). One
-- statement per source family; the final statement applies the shared
-- exclusions, hashes, de-duplicates by member_key and writes the delta.
CREATE OR REPLACE FUNCTION public.ad_list_audience_refresh(p_audience_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_a public.ad_list_audiences%ROWTYPE;
  v_seed public.ad_list_audiences%ROWTYPE;
  v_country text;
  v_city text;
  v_page_type text;
  v_added integer := 0;
  v_removed integer := 0;
  v_count integer := 0;
  v_by_country jsonb := '{}'::jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('ad_list_audience:' || p_audience_id::text)) THEN
    RAISE EXCEPTION 'ad_list_audience_refresh_in_progress' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_a FROM public.ad_list_audiences WHERE id = p_audience_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ad_list_audience_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_a.kind = 'lookalike' THEN
    SELECT * INTO v_seed FROM public.ad_list_audiences WHERE id = v_a.seed_audience_id;
    v_count := COALESCE((v_seed.member_count_by_country ->> v_a.lookalike_country)::integer, 0);
    UPDATE public.ad_list_audiences
    SET member_count = v_count,
        member_count_by_country = jsonb_build_object(v_a.lookalike_country, v_count),
        members_refreshed_at = now(), updated_at = now()
    WHERE id = v_a.id;
    RETURN jsonb_build_object('member_count', v_count, 'added', 0, 'removed', 0);
  END IF;

  v_country := v_a.filter ->> 'country';
  v_city := v_a.filter ->> 'city';
  v_page_type := v_a.filter ->> 'page_type';

  CREATE TEMP TABLE IF NOT EXISTS ad_list_cand (
    email text, phone text, user_id uuid, country text
  ) ON COMMIT DROP;
  DELETE FROM pg_temp.ad_list_cand;

  IF v_a.status = 'retired' THEN
    NULL; -- no candidates: every member is marked removed below.
  ELSIF v_a.owner_kind = 'host' THEN
    -- guests: the brand's own buyers, ticket holders, RSVPs, plus-ones,
    -- reservations, venue orders, and People linked from those sources.
    IF v_a.source IN ('guests','seed') THEN
      INSERT INTO pg_temp.ad_list_cand(email, phone, user_id, country)
      SELECT public.ad_list_audience_normalize_email(o.buyer_email),
             public.ad_list_audience_normalize_phone(o.buyer_phone_e164),
             o.buyer_user_id,
             COALESCE(pr.country_iso, public.ad_list_audience_phone_country(public.ad_list_audience_normalize_phone(o.buyer_phone_e164)),
                      e.destination_country_code::text, b.country_code)
      FROM public.orders o
      JOIN public.events e ON e.id = o.event_id
      JOIN public.brands b ON b.id = e.brand_id
      LEFT JOIN LATERAL (
        SELECT upper(p.country) AS country_iso FROM public.profiles p
        WHERE p.id = o.buyer_user_id AND upper(p.country) ~ '^[A-Z]{2}$'
      ) pr ON true
      WHERE e.brand_id = v_a.brand_id
        AND o.payment_status IN ('paid','refunded','partial_refund');

      INSERT INTO pg_temp.ad_list_cand(email, phone, user_id, country)
      SELECT public.ad_list_audience_normalize_email(COALESCE(t.holder_email, t.attendee_email)),
             public.ad_list_audience_normalize_phone(t.holder_phone_e164),
             t.holder_user_id,
             COALESCE(public.ad_list_audience_phone_country(public.ad_list_audience_normalize_phone(t.holder_phone_e164)),
                      e.destination_country_code::text, b.country_code)
      FROM public.tickets t
      JOIN public.orders o ON o.id = t.order_id
      JOIN public.events e ON e.id = o.event_id
      JOIN public.brands b ON b.id = e.brand_id
      WHERE e.brand_id = v_a.brand_id
        AND o.payment_status IN ('paid','refunded','partial_refund')
        AND t.status IN ('valid','used');

      INSERT INTO pg_temp.ad_list_cand(email, phone, user_id, country)
      SELECT public.ad_list_audience_normalize_email(r.guest_email),
             public.ad_list_audience_normalize_phone(r.guest_phone),
             r.user_id,
             COALESCE(upper(r.guest_phone_country_iso),
                      public.ad_list_audience_phone_country(public.ad_list_audience_normalize_phone(r.guest_phone)),
                      e.destination_country_code::text, b.country_code)
      FROM public.event_rsvps r
      JOIN public.events e ON e.id = r.event_id
      JOIN public.brands b ON b.id = e.brand_id
      WHERE e.brand_id = v_a.brand_id AND r.rsvp_status = 'going';

      INSERT INTO pg_temp.ad_list_cand(email, phone, user_id, country)
      SELECT public.ad_list_audience_normalize_email(g.email),
             public.ad_list_audience_normalize_phone(g.phone),
             g.matched_user_id,
             COALESCE(upper(g.phone_country_iso),
                      public.ad_list_audience_phone_country(public.ad_list_audience_normalize_phone(g.phone)),
                      e.destination_country_code::text, b.country_code)
      FROM public.event_rsvp_guests g
      JOIN public.event_rsvps r ON r.id = g.rsvp_id
      JOIN public.events e ON e.id = r.event_id
      JOIN public.brands b ON b.id = e.brand_id
      WHERE e.brand_id = v_a.brand_id AND r.rsvp_status = 'going';

      INSERT INTO pg_temp.ad_list_cand(email, phone, user_id, country)
      SELECT public.ad_list_audience_normalize_email(rv.guest_email),
             public.ad_list_audience_normalize_phone(rv.guest_phone_e164),
             rv.consumer_user_id,
             COALESCE(upper(rv.guest_phone_country_iso),
                      public.ad_list_audience_phone_country(public.ad_list_audience_normalize_phone(rv.guest_phone_e164)),
                      b.country_code)
      FROM public.reservations rv
      JOIN public.brands b ON b.id = rv.brand_id
      WHERE rv.brand_id = v_a.brand_id AND rv.status IN ('confirmed','completed','seated');

      INSERT INTO pg_temp.ad_list_cand(email, phone, user_id, country)
      SELECT public.ad_list_audience_normalize_email(vo.buyer_email),
             public.ad_list_audience_normalize_phone(vo.buyer_phone_e164),
             vo.buyer_user_id,
             COALESCE(public.ad_list_audience_phone_country(public.ad_list_audience_normalize_phone(vo.buyer_phone_e164)),
                      b.country_code)
      FROM public.venue_orders vo
      JOIN public.brands b ON b.id = vo.brand_id
      WHERE vo.brand_id = v_a.brand_id AND vo.payment_status = 'paid';

      -- The brand's person graph (lags the sources; the union covers both).
      INSERT INTO pg_temp.ad_list_cand(email, phone, user_id, country)
      SELECT pm.email, pm.phone, p.linked_user_id,
             COALESCE(pm.phone_iso, public.ad_list_audience_phone_country(pm.phone), b.country_code)
      FROM public.brand_people p
      JOIN public.brands b ON b.id = p.brand_id
      CROSS JOIN LATERAL (
        SELECT
          (array_agg(public.ad_list_audience_normalize_email(m.normalized_value)
             ORDER BY m.is_primary DESC, m.created_at) FILTER (WHERE m.channel = 'email'))[1] AS email,
          (array_agg(public.ad_list_audience_normalize_phone(m.normalized_value)
             ORDER BY m.is_primary DESC, m.created_at) FILTER (WHERE m.channel = 'phone'))[1] AS phone,
          (array_agg(upper(s.phone_country_iso) ORDER BY m.is_primary DESC)
             FILTER (WHERE m.channel = 'phone' AND s.phone_country_iso IS NOT NULL))[1] AS phone_iso
        FROM public.brand_person_contact_methods m
        LEFT JOIN public.brand_person_contact_method_sources s
          ON s.contact_method_id = m.id AND s.active
        WHERE m.brand_person_id = p.id AND m.record_state = 'active' AND m.retired_at IS NULL
      ) pm
      WHERE p.brand_id = v_a.brand_id
        AND p.record_status = 'active'
        AND b.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM public.brand_person_source_links l
          WHERE l.brand_person_id = p.id AND l.detached_at IS NULL
            AND l.source_kind IN ('order','ticket_holder','event_rsvp','rsvp_plus_one','reservation')
        );
    END IF;

    -- contacts: the #4226 host-contact definition for this brand, people not
    -- linked to an account.
    IF v_a.source IN ('contacts','seed') THEN
      INSERT INTO pg_temp.ad_list_cand(email, phone, user_id, country)
      SELECT hc.email, hc.phone, NULL,
             COALESCE(hc.phone_iso, public.ad_list_audience_phone_country(hc.phone), b.country_code)
      FROM public.brand_people p
      JOIN public.brands b ON b.id = p.brand_id
      CROSS JOIN LATERAL (
        SELECT
          (array_agg(public.ad_list_audience_normalize_email(m.normalized_value)
             ORDER BY m.is_primary DESC, m.created_at) FILTER (WHERE m.channel = 'email'))[1] AS email,
          (array_agg(public.ad_list_audience_normalize_phone(m.normalized_value)
             ORDER BY m.is_primary DESC, m.created_at) FILTER (WHERE m.channel = 'phone'))[1] AS phone,
          (array_agg(upper(s.phone_country_iso) ORDER BY m.is_primary DESC)
             FILTER (WHERE m.channel = 'phone' AND s.phone_country_iso IS NOT NULL))[1] AS phone_iso
        FROM public.brand_person_contact_methods m
        JOIN public.brand_person_contact_method_sources s
          ON s.contact_method_id = m.id AND s.active AND s.provenance_kind IN ('import','manual')
        JOIN public.brand_person_source_links l
          ON l.id = s.source_link_id AND l.detached_at IS NULL
        WHERE m.brand_person_id = p.id AND m.record_state = 'active' AND m.retired_at IS NULL
      ) hc
      WHERE p.brand_id = v_a.brand_id
        AND p.record_status = 'active'
        AND p.linked_user_id IS NULL
        AND b.deleted_at IS NULL
        AND (hc.email IS NOT NULL OR hc.phone IS NOT NULL);
    END IF;
  ELSE
    -- Mingla-wide sources: the one de-duplicated People list (#4226).
    INSERT INTO pg_temp.ad_list_cand(email, phone, user_id, country)
    SELECT public.ad_list_audience_normalize_email(d.email),
           public.ad_list_audience_normalize_phone(d.phone_e164),
           d.user_id,
           CASE WHEN upper(d.country) ~ '^[A-Z]{2}$' THEN upper(d.country)
                ELSE public.ad_list_audience_phone_country(public.ad_list_audience_normalize_phone(d.phone_e164)) END
    FROM public.admin_people_directory_rows() d
    WHERE (v_a.source <> 'users' OR (d.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = d.user_id)))
      AND (v_a.source <> 'buyers' OR d.is_ticket_holder OR d.in_ticket_buyer_segment)
      AND (v_a.source <> 'contacts' OR (d.is_host_contact AND d.user_id IS NULL))
      AND (v_country IS NULL OR upper(d.country) = v_country)
      AND (v_city IS NULL OR lower(d.host_city) = v_city
           OR EXISTS (SELECT 1 FROM unnest(d.event_cities) c WHERE lower(c) = v_city))
      AND (v_page_type IS NULL OR (
        v_page_type = 'venue' AND EXISTS (
          SELECT 1 FROM public.venue_orders vo
          WHERE vo.payment_status = 'paid'
            AND public.ad_list_audience_normalize_email(vo.buyer_email) = public.ad_list_audience_normalize_email(d.email))
      ) OR (
        v_page_type <> 'venue' AND EXISTS (
          SELECT 1 FROM public.orders o JOIN public.events e ON e.id = o.event_id
          WHERE o.payment_status IN ('paid','refunded','partial_refund')
            AND e.event_type = v_page_type
            AND (o.buyer_user_id = d.user_id
                 OR public.ad_list_audience_normalize_email(o.buyer_email) = public.ad_list_audience_normalize_email(d.email)))
      ));
  END IF;

  WITH
  -- Accounts that are deleted, inactive or known under-18 (E2, E5).
  bad_user AS (
    SELECT p.id FROM public.profiles p
    WHERE p.explorer_deleted_at IS NOT NULL OR p.active = false
       OR p.birthday > (current_date - interval '18 years')
    -- auth.users.deleted_at exists in hosted Supabase but not in every local
    -- image; read it through to_jsonb so the body works on both.
    UNION SELECT u.id FROM auth.users u WHERE (to_jsonb(u) ->> 'deleted_at') IS NOT NULL
    UNION SELECT c.creator_account_id FROM public.creator_profiles c
    WHERE c.date_of_birth > (current_date - interval '18 years')
  ),
  -- E1: the ad opt-out / GPC latch, sticky per person.
  optout AS (
    SELECT public.ad_list_audience_normalize_email(s.buyer_email) AS email,
           public.ad_list_audience_normalize_phone(s.buyer_phone_e164) AS phone,
           s.buyer_user_id AS user_id
    FROM public.ticket_checkout_sessions s WHERE s.ad_tracking_opt_out
    UNION ALL
    SELECT public.ad_list_audience_normalize_email(s.buyer_email),
           public.ad_list_audience_normalize_phone(s.buyer_phone_e164), s.consumer_user_id
    FROM public.reservation_checkout_sessions s WHERE s.ad_tracking_opt_out
    UNION ALL
    SELECT public.ad_list_audience_normalize_email(g.guest_snapshot ->> 'email'),
           public.ad_list_audience_normalize_phone(g.guest_snapshot ->> 'phone'), g.user_id
    FROM public.stay_reservation_groups g WHERE g.ad_tracking_opt_out
  ),
  -- E4a: choices (unsubscribes, complaints, opt-outs of marketing).
  choice AS (
    SELECT public.ad_list_audience_normalize_email(mu.contact_email) AS email,
           public.ad_list_audience_normalize_phone(mu.contact_phone) AS phone,
           NULL::uuid AS user_id, NULL::uuid AS person_id
    FROM public.marketing_unsubscribes mu
    UNION ALL
    SELECT CASE WHEN cs.channel = 'email' THEN public.ad_list_audience_normalize_email(cs.contact) END,
           CASE WHEN cs.channel = 'sms' THEN public.ad_list_audience_normalize_phone(cs.contact) END,
           cs.user_id, NULL
    FROM public.channel_suppressions cs
    WHERE cs.scope IN ('marketing','all') AND cs.reason <> 'bounce'
    UNION ALL
    SELECT NULL, NULL, NULL, bs.brand_person_id
    FROM public.brand_person_channel_suppressions bs
    WHERE bs.lifted_at IS NULL AND bs.reason NOT IN ('hard_bounce','bounce')
  ),
  -- Seeds of whole-person exclusion, then widened to every identifier of the
  -- same account or the same brand person.
  seeds AS (
    SELECT email, phone, user_id FROM optout
    UNION ALL SELECT email, phone, user_id FROM choice
    UNION ALL SELECT NULL, NULL, id FROM bad_user
  ),
  x_user AS (
    SELECT s.user_id AS id FROM seeds s WHERE s.user_id IS NOT NULL
    UNION
    SELECT p.id FROM public.profiles p
    JOIN seeds s ON (s.email IS NOT NULL AND public.ad_list_audience_normalize_email(p.email) = s.email)
                 OR (s.phone IS NOT NULL AND public.ad_list_audience_normalize_phone(p.phone) = s.phone)
  ),
  x_person AS (
    SELECT c.person_id AS id FROM choice c WHERE c.person_id IS NOT NULL
    UNION
    SELECT m.brand_person_id FROM public.brand_person_contact_methods m
    JOIN seeds s ON (m.channel = 'email' AND s.email IS NOT NULL AND public.ad_list_audience_normalize_email(m.normalized_value) = s.email)
                 OR (m.channel = 'phone' AND s.phone IS NOT NULL AND public.ad_list_audience_normalize_phone(m.normalized_value) = s.phone)
    UNION
    SELECT bp.id FROM public.brand_people bp JOIN x_user xu ON xu.id = bp.linked_user_id
  ),
  x_ident AS (
    SELECT s.email, s.phone FROM seeds s
    UNION ALL
    SELECT public.ad_list_audience_normalize_email(p.email), public.ad_list_audience_normalize_phone(p.phone)
    FROM public.profiles p JOIN x_user xu ON xu.id = p.id
    UNION ALL
    SELECT CASE WHEN m.channel = 'email' THEN public.ad_list_audience_normalize_email(m.normalized_value) END,
           CASE WHEN m.channel = 'phone' THEN public.ad_list_audience_normalize_phone(m.normalized_value) END
    FROM public.brand_person_contact_methods m JOIN x_person xp ON xp.id = m.brand_person_id
  ),
  x_email AS (SELECT DISTINCT email FROM x_ident WHERE email IS NOT NULL),
  x_phone AS (SELECT DISTINCT phone FROM x_ident WHERE phone IS NOT NULL),
  -- E4b: a bounce drops only that email.
  bounced AS (
    SELECT DISTINCT public.ad_list_audience_normalize_email(m.normalized_value) AS email
    FROM public.brand_person_channel_suppressions bs
    JOIN public.brand_person_contact_methods m
      ON m.brand_person_id = bs.brand_person_id AND m.channel = 'email'
    WHERE bs.lifted_at IS NULL AND bs.channel = 'email' AND bs.reason IN ('hard_bounce','bounce')
    UNION
    SELECT public.ad_list_audience_normalize_email(cs.contact)
    FROM public.channel_suppressions cs
    WHERE cs.channel = 'email' AND cs.reason = 'bounce' AND cs.scope IN ('marketing','all')
  ),
  kept AS (
    SELECT CASE WHEN c.email IN (SELECT email FROM bounced WHERE email IS NOT NULL) THEN NULL ELSE c.email END AS email,
           c.phone,
           CASE WHEN upper(c.country) ~ '^[A-Z]{2}$' THEN upper(c.country) END AS country
    FROM pg_temp.ad_list_cand c
    WHERE (c.email IS NOT NULL OR c.phone IS NOT NULL)
      AND (c.user_id IS NULL OR c.user_id NOT IN (SELECT id FROM x_user WHERE id IS NOT NULL))
      AND (c.email IS NULL OR c.email NOT IN (SELECT email FROM x_email))
      AND (c.phone IS NULL OR c.phone NOT IN (SELECT phone FROM x_phone))
  ),
  hashed AS (
    SELECT
      public.ad_list_audience_sha256(COALESCE(k.email, k.phone)) AS member_key,
      public.ad_list_audience_sha256(k.email) AS email_sha256,
      CASE WHEN public.ad_list_audience_normalize_email_google(k.email) IS DISTINCT FROM k.email
           THEN public.ad_list_audience_sha256(public.ad_list_audience_normalize_email_google(k.email)) END AS email_google_sha256,
      public.ad_list_audience_sha256(k.phone) AS phone_sha256,
      public.ad_list_audience_sha256(CASE WHEN k.phone IS NOT NULL THEN '+' || k.phone END) AS phone_e164_sha256,
      k.country
    FROM kept k
    WHERE k.email IS NOT NULL OR k.phone IS NOT NULL
  ),
  final AS (
    SELECT h.member_key,
           min(h.email_sha256) AS email_sha256,
           min(h.email_google_sha256) AS email_google_sha256,
           min(h.phone_sha256) AS phone_sha256,
           min(h.phone_e164_sha256) AS phone_e164_sha256,
           min(h.country) AS country
    FROM hashed h GROUP BY h.member_key
  ),
  ins AS (
    INSERT INTO public.ad_list_audience_members AS m
      (audience_id, member_key, email_sha256, email_google_sha256, phone_sha256, phone_e164_sha256, country, added_at, removed_at)
    SELECT v_a.id, f.member_key, f.email_sha256, f.email_google_sha256, f.phone_sha256, f.phone_e164_sha256, f.country, now(), NULL
    FROM final f
    ON CONFLICT (audience_id, member_key) DO UPDATE
      SET added_at = CASE
            WHEN m.removed_at IS NOT NULL
              OR m.email_sha256 IS DISTINCT FROM EXCLUDED.email_sha256
              OR m.phone_sha256 IS DISTINCT FROM EXCLUDED.phone_sha256
              OR m.email_google_sha256 IS DISTINCT FROM EXCLUDED.email_google_sha256
            THEN now() ELSE m.added_at END,
          removed_at = NULL,
          email_sha256 = EXCLUDED.email_sha256,
          email_google_sha256 = EXCLUDED.email_google_sha256,
          phone_sha256 = EXCLUDED.phone_sha256,
          phone_e164_sha256 = EXCLUDED.phone_e164_sha256,
          country = EXCLUDED.country
    RETURNING (xmax = 0) AS inserted, m.added_at
  ),
  rem AS (
    UPDATE public.ad_list_audience_members m
    SET removed_at = now()
    WHERE m.audience_id = v_a.id AND m.removed_at IS NULL
      AND m.member_key NOT IN (SELECT member_key FROM final)
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM ins WHERE added_at = now()),
         (SELECT count(*) FROM rem),
         (SELECT count(*) FROM final),
         COALESCE((SELECT jsonb_object_agg(c.country, c.n) FROM (
           SELECT f.country, count(*) AS n FROM final f WHERE f.country IS NOT NULL GROUP BY f.country
         ) c), '{}'::jsonb)
  INTO v_added, v_removed, v_count, v_by_country;

  UPDATE public.ad_list_audiences
  SET member_count = v_count, member_count_by_country = v_by_country,
      members_refreshed_at = now(), updated_at = now()
  WHERE id = v_a.id;

  -- Keep lookalike counts in step with their seed.
  UPDATE public.ad_list_audiences l
  SET member_count = COALESCE((v_by_country ->> l.lookalike_country)::integer, 0),
      member_count_by_country = jsonb_build_object(l.lookalike_country, COALESCE((v_by_country ->> l.lookalike_country)::integer, 0)),
      members_refreshed_at = now(), updated_at = now()
  WHERE l.seed_audience_id = v_a.id;

  DELETE FROM pg_temp.ad_list_cand;
  RETURN jsonb_build_object('member_count', v_count, 'added', v_added, 'removed', v_removed);
END;
$function$;
REVOKE ALL ON FUNCTION public.ad_list_audience_refresh(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_list_audience_refresh(uuid) TO service_role;

--------------------------------------------------------------------------------
-- 5. A brand's three audiences, plus a lookalike per seed country
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ad_list_audience_ensure_brand(p_brand_id uuid)
RETURNS SETOF public.ad_list_audiences
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_seed public.ad_list_audiences%ROWTYPE;
  v_row public.ad_list_audiences%ROWTYPE;
  v_cc text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brands WHERE id = p_brand_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.ad_list_audiences(audience_key, owner_kind, brand_id, kind, source, display_name, host_visible)
  VALUES
    ('brand:' || p_brand_id || ':guests',   'host', p_brand_id, 'list', 'guests',   'Your past guests', true),
    ('brand:' || p_brand_id || ':contacts', 'host', p_brand_id, 'list', 'contacts', 'Your contacts', true),
    ('brand:' || p_brand_id || ':seed',     'host', p_brand_id, 'list', 'seed',     'Your guests and contacts', false)
  ON CONFLICT (audience_key) DO UPDATE SET display_name = EXCLUDED.display_name;

  -- First open (or dirty): build the snapshot now so the Host sees sizes.
  FOR v_row IN
    SELECT * FROM public.ad_list_audiences
    WHERE brand_id = p_brand_id AND kind = 'list' AND status = 'active'
      AND members_refreshed_at IS NULL
  LOOP
    BEGIN
      PERFORM public.ad_list_audience_refresh(v_row.id);
    EXCEPTION WHEN SQLSTATE 'PT409' THEN
      NULL; -- another refresh is running; its result is used next time.
    END;
  END LOOP;

  SELECT * INTO v_seed FROM public.ad_list_audiences
  WHERE audience_key = 'brand:' || p_brand_id || ':seed';
  FOR v_cc IN SELECT k FROM jsonb_object_keys(v_seed.member_count_by_country) AS k
    WHERE k ~ '^[A-Z]{2}$' AND (v_seed.member_count_by_country ->> k)::integer >= 1
  LOOP
    INSERT INTO public.ad_list_audiences(
      audience_key, owner_kind, brand_id, kind, source, seed_audience_id,
      lookalike_country, display_name, host_visible, member_count, member_count_by_country,
      members_refreshed_at)
    VALUES (
      'brand:' || p_brand_id || ':lookalike:' || v_cc, 'host', p_brand_id, 'lookalike', 'seed', v_seed.id,
      v_cc, 'People like your guests (' || v_cc || ')', true,
      (v_seed.member_count_by_country ->> v_cc)::integer,
      jsonb_build_object(v_cc, (v_seed.member_count_by_country ->> v_cc)::integer), now())
    ON CONFLICT (audience_key) DO UPDATE SET display_name = EXCLUDED.display_name;
  END LOOP;

  RETURN QUERY SELECT * FROM public.ad_list_audiences
  WHERE brand_id = p_brand_id ORDER BY kind, source, lookalike_country NULLS FIRST;
END;
$function$;
REVOKE ALL ON FUNCTION public.ad_list_audience_ensure_brand(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ad_list_audience_ensure_brand(uuid) TO service_role;

--------------------------------------------------------------------------------
-- 6. The Host read path: names and rounded sizes, never members or ids
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ad_list_audience_round_size(p_n integer)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT CASE
    WHEN p_n IS NULL OR p_n <= 0 THEN 0
    WHEN p_n < 100 THEN (round(p_n / 10.0) * 10)::integer
    WHEN p_n < 1000 THEN (round(p_n / 50.0) * 50)::integer
    ELSE (round(p_n / power(10, floor(log(p_n)) - 1)) * power(10, floor(log(p_n)) - 1))::integer
  END;
$function$;
GRANT EXECUTE ON FUNCTION public.ad_list_audience_round_size(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.host_ad_audiences(p_brand_id uuid)
RETURNS TABLE (
  audience_key text,
  display_name text,
  kind text,
  approx_size integer,
  lookalike_country text,
  platforms jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
BEGIN
  IF NOT (
    COALESCE(auth.role(), '') = 'service_role'
    OR public.is_admin_user()
    OR public.ad_can_host_action_for_caller(p_brand_id, 'read')
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.audience_key, a.display_name, a.kind,
         public.ad_list_audience_round_size(a.member_count),
         a.lookalike_country,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'platform', p.platform, 'state', p.state, 'needed_count', p.needed_count)
             ORDER BY p.platform)
           FROM public.ad_list_audience_platforms p WHERE p.audience_id = a.id
         ), '[]'::jsonb)
  FROM public.ad_list_audiences a
  WHERE a.brand_id = p_brand_id AND a.owner_kind = 'host'
    AND a.host_visible AND a.status = 'active'
  ORDER BY a.kind, a.source, a.lookalike_country NULLS FIRST;
END;
$function$;
REVOKE ALL ON FUNCTION public.host_ad_audiences(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.host_ad_audiences(uuid) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 7. Dirty marking: an exclusion change makes the hourly pass refresh.
--------------------------------------------------------------------------------
-- Row triggers with WHEN conditions, not statement triggers with transition
-- tables: PostgreSQL refuses transition tables on UPDATE OF <column> triggers,
-- and the WHEN clause keeps the function off the checkout path except for the
-- rare opt-out row. A person excluded by E1/E2/E4a/E5 leaves every list, so
-- those changes mark every active audience; a brand_people change marks only
-- that brand's audiences.
CREATE OR REPLACE FUNCTION public.ad_list_audience_mark_dirty()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
BEGIN
  -- Never fail the host transaction (a checkout, a profile save, an
  -- unsubscribe): the daily sync rebuilds every snapshot anyway, so a missed
  -- mark only delays a removal by at most a day.
  BEGIN
    IF TG_TABLE_NAME = 'brand_people' THEN
      UPDATE public.ad_list_audiences
      SET members_refreshed_at = NULL
      WHERE brand_id = NEW.brand_id AND status = 'active' AND members_refreshed_at IS NOT NULL;
    ELSE
      UPDATE public.ad_list_audiences
      SET members_refreshed_at = NULL
      WHERE status = 'active' AND members_refreshed_at IS NOT NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.ad_list_audience_mark_dirty() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER issue_4238_audience_dirty_profiles
  AFTER UPDATE OF explorer_deleted_at, active, birthday ON public.profiles
  FOR EACH ROW
  WHEN (OLD.explorer_deleted_at IS DISTINCT FROM NEW.explorer_deleted_at
        OR OLD.active IS DISTINCT FROM NEW.active
        OR OLD.birthday IS DISTINCT FROM NEW.birthday)
  EXECUTE FUNCTION public.ad_list_audience_mark_dirty();
CREATE TRIGGER issue_4238_audience_dirty_ticket_optout
  AFTER INSERT OR UPDATE OF ad_tracking_opt_out ON public.ticket_checkout_sessions
  FOR EACH ROW WHEN (NEW.ad_tracking_opt_out)
  EXECUTE FUNCTION public.ad_list_audience_mark_dirty();
CREATE TRIGGER issue_4238_audience_dirty_reservation_optout
  AFTER INSERT OR UPDATE OF ad_tracking_opt_out ON public.reservation_checkout_sessions
  FOR EACH ROW WHEN (NEW.ad_tracking_opt_out)
  EXECUTE FUNCTION public.ad_list_audience_mark_dirty();
CREATE TRIGGER issue_4238_audience_dirty_stay_optout
  AFTER INSERT OR UPDATE OF ad_tracking_opt_out ON public.stay_reservation_groups
  FOR EACH ROW WHEN (NEW.ad_tracking_opt_out)
  EXECUTE FUNCTION public.ad_list_audience_mark_dirty();
CREATE TRIGGER issue_4238_audience_dirty_brand_people
  AFTER UPDATE OF record_status ON public.brand_people
  FOR EACH ROW WHEN (OLD.record_status IS DISTINCT FROM NEW.record_status)
  EXECUTE FUNCTION public.ad_list_audience_mark_dirty();
CREATE TRIGGER issue_4238_audience_dirty_person_suppressions
  AFTER INSERT ON public.brand_person_channel_suppressions
  FOR EACH ROW EXECUTE FUNCTION public.ad_list_audience_mark_dirty();
CREATE TRIGGER issue_4238_audience_dirty_unsubscribes
  AFTER INSERT ON public.marketing_unsubscribes
  FOR EACH ROW EXECUTE FUNCTION public.ad_list_audience_mark_dirty();
CREATE TRIGGER issue_4238_audience_dirty_channel_suppressions
  AFTER INSERT ON public.channel_suppressions
  FOR EACH ROW EXECUTE FUNCTION public.ad_list_audience_mark_dirty();

--------------------------------------------------------------------------------
-- 8. Daily series for the ad results charts
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ad_campaign_daily_series(
  p_campaign_ids uuid[],
  p_time_zone text
)
RETURNS TABLE (
  day date,
  campaign_id uuid,
  platform text,
  spend_cents bigint,
  currency text,
  impressions bigint,
  clicks bigint,
  page_visits bigint,
  results bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_tz text := 'UTC';
BEGIN
  IF NOT (COALESCE(auth.role(), '') = 'service_role' OR public.is_admin_user()) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_time_zone IS NOT NULL AND EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_time_zone) THEN
    v_tz := p_time_zone;
  END IF;
  RETURN QUERY
  WITH ids AS (SELECT DISTINCT unnest(COALESCE(p_campaign_ids, ARRAY[]::uuid[])) AS id),
  spend AS (
    SELECT s.spend_date AS day, s.campaign_id, s.platform,
           sum(s.spend_cents)::bigint AS spend_cents, min(s.currency) AS currency,
           sum(s.impressions)::bigint AS impressions, sum(s.clicks)::bigint AS clicks
    FROM public.ad_spend_daily s JOIN ids ON ids.id = s.campaign_id
    GROUP BY 1, 2, 3
  ),
  visits AS (
    SELECT (t.created_at AT TIME ZONE v_tz)::date AS day, t.campaign_id,
           t.network AS platform, count(*)::bigint AS n
    FROM public.ad_attribution_touches t JOIN ids ON ids.id = t.campaign_id
    GROUP BY 1, 2, 3
  ),
  conv AS (
    SELECT (c.created_at AT TIME ZONE v_tz)::date AS day, c.campaign_id,
           c.platform, count(*)::bigint AS n
    FROM public.ad_conversions c JOIN ids ON ids.id = c.campaign_id
    GROUP BY 1, 2, 3
  ),
  keys AS (
    SELECT s.day, s.campaign_id FROM spend s
    UNION SELECT v.day, v.campaign_id FROM visits v
    UNION SELECT c.day, c.campaign_id FROM conv c
  )
  SELECT k.day, k.campaign_id,
         COALESCE((SELECT s.platform FROM spend s WHERE s.day = k.day AND s.campaign_id = k.campaign_id LIMIT 1),
                  (SELECT ac.platform FROM public.ad_campaigns ac WHERE ac.id = k.campaign_id)),
         (SELECT sum(s.spend_cents)::bigint FROM spend s WHERE s.day = k.day AND s.campaign_id = k.campaign_id),
         (SELECT min(s.currency) FROM spend s WHERE s.day = k.day AND s.campaign_id = k.campaign_id),
         (SELECT sum(s.impressions)::bigint FROM spend s WHERE s.day = k.day AND s.campaign_id = k.campaign_id),
         (SELECT sum(s.clicks)::bigint FROM spend s WHERE s.day = k.day AND s.campaign_id = k.campaign_id),
         COALESCE((SELECT sum(v.n)::bigint FROM visits v WHERE v.day = k.day AND v.campaign_id = k.campaign_id), 0),
         COALESCE((SELECT sum(c.n)::bigint FROM conv c WHERE c.day = k.day AND c.campaign_id = k.campaign_id), 0)
  FROM keys k
  ORDER BY k.day, k.campaign_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.ad_campaign_daily_series(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ad_campaign_daily_series(uuid[], text) TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 9. Flags: the dead buyer-list flag goes; the Reddit switch starts OFF.
--------------------------------------------------------------------------------
DELETE FROM public.feature_flags WHERE flag_key = 'ad_buyer_list_sync_enabled';
-- Reddit customer lists stay off until one real-API check (Seth, 2 Nov 2026).
-- Inserted OFF; nothing in this migration turns it on.
INSERT INTO public.feature_flags(flag_key, is_enabled, description)
VALUES ('ad_reddit_list_audiences_enabled', false,
        'Issue #4238: Reddit customer-list and lookalike audiences. Off until one real Reddit API check confirms the audience endpoints.')
ON CONFLICT (flag_key) DO NOTHING;

--------------------------------------------------------------------------------
-- 10. Hourly removals pass (the daily 03:47 sync is unchanged and now also
--     runs list sync through the same worker).
--------------------------------------------------------------------------------
DO $cron$
DECLARE v_job_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'Issue #4238: pg_cron/pg_net unavailable; audience removals not scheduled.';
    RETURN;
  END IF;
  SELECT jobid INTO v_job_id FROM cron.job
  WHERE jobname = 'issue_4238_ad_list_audience_removals_hourly' LIMIT 1;
  IF v_job_id IS NOT NULL THEN PERFORM cron.unschedule(v_job_id); END IF;
  PERFORM cron.schedule(
    'issue_4238_ad_list_audience_removals_hourly',
    '17 * * * *',
    $command$
      SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets
                WHERE name='supabase_url' LIMIT 1) || '/functions/v1/admin-ad-audiences',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer ' || (SELECT decrypted_secret
            FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)
        ),
        body := '{"action":"removals"}'::jsonb,
        timeout_milliseconds := 55000
      );
    $command$
  );
END
$cron$;

COMMENT ON TABLE public.ad_list_audiences IS
  'Issue #4238 customer-list and lookalike audience definitions. Host audiences use only that brand''s data. Admin read; service-role writes.';
COMMENT ON TABLE public.ad_list_audience_members IS
  'Issue #4238 membership snapshot: SHA-256 hex only, hashed inside Postgres. service_role only; no authenticated grant.';
COMMENT ON TABLE public.ad_list_audience_platforms IS
  'Issue #4238 per-platform sync state and provider audience id. Admin read; service-role writes.';
COMMENT ON TABLE public.ad_platform_audience_terms IS
  'Issue #4238 provider customer-list terms and eligibility. Recorded by checks and Admin confirmation; never accepted by code.';
COMMENT ON FUNCTION public.host_ad_audiences(uuid) IS
  'Issue #4238: the Host read path. Rounded sizes and per-platform states for one brand; never members or provider ids.';

COMMIT;
