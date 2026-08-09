-- issue #1586 [timezone-backfill] — the venue's clock, proven against a REAL
-- Postgres with every migration applied in order.
--
-- WHY THIS FILE EXISTS. The jest suite can read the migration as TEXT; it
-- cannot execute a rectangle lookup, cannot see a column ordinal, cannot prove
-- that an operator's choice survives a re-derivation, and cannot prove that a
-- `pending_review` venue stays invisible. This runs inside the same "Migrations
-- apply cleanly from baseline" job that already guards #1564, so the derivation
-- is re-proven on every push rather than rehearsed once on a laptop.
--
-- EVERY ASSERTION IS FALSIFIABLE AND EVERY LOOKUP IS VACUITY-GUARDED. A
-- backfill test over zero rows passes trivially, so T-0 asserts the seed size
-- and the fixture row count BEFORE anything reads a derived value, and each
-- negative ("this abstains") is paired with a positive control on the same
-- shape ("this does not").
--
-- What it pins:
--   T-0   The seed is real: 200+ region rows, and the fixtures actually exist.
--   T-1   THE HEADLINE. A restaurant at Raleigh's coordinates derives
--         America/New_York, not UTC, and the anon view publishes it.
--   T-2   Zone NAMES only, never offsets — every seeded and every derived
--         value satisfies #1562's isIanaZoneName rule.
--   T-3   An OPERATOR choice survives a re-derivation untouched.
--   T-4   Unusable coordinates stay SILENT: source 'default', view NULL.
--   T-5   'UTC' left on the column default publishes NULL, so the page claims
--         nothing — the whole reason `iana_timezone_source` exists.
--   T-6   A NEW venue's config row derives its zone on INSERT, unavoidably.
--   T-7   Offsets, Etc/GMT+5 and the legacy aliases are REFUSED at write time.
--   T-8   A bare UPDATE of the zone is recorded as an operator choice.
--   T-9   The view keeps iana_timezone at 29 and appends the poster at 30.
--   T-10  pending_review stays invisible on the anon view.
--   T-11  A grid of real cities derives the right zone, and the known-ambiguous
--         regions abstain instead of guessing.
--   T-12  Re-running the derivation is idempotent.
--
-- Transactional: BEGIN … ROLLBACK, so it writes nothing that survives.
\set ON_ERROR_STOP on
BEGIN;

-- ── T-0 — the seed is real ─────────────────────────────────────────────────
DO $t0$
DECLARE
  v_regions integer;
  v_us integer;
  v_named integer;
BEGIN
  SELECT count(*) INTO v_regions FROM public.venue_timezone_regions;
  IF v_regions < 200 THEN
    RAISE EXCEPTION 'issue_1586_T0_seed_too_small: % region rows', v_regions;
  END IF;
  SELECT count(*) INTO v_us FROM public.venue_timezone_regions WHERE country_code = 'US';
  IF v_us < 20 THEN
    RAISE EXCEPTION 'issue_1586_T0_us_regions_missing: % US rows', v_us;
  END IF;
  SELECT count(*) INTO v_named FROM public.venue_timezone_regions WHERE zone_name IS NOT NULL;
  IF v_named < 180 THEN
    RAISE EXCEPTION 'issue_1586_T0_named_zones_missing: % named rows', v_named;
  END IF;
END
$t0$;

-- Fixtures. Coordinates are real places; the zone each must produce is stated
-- in the venue name so a failure reads as a sentence.
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES ('00000000-1586-4000-8000-000000000001',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'owner-1586@example.test', now(), now());

INSERT INTO public.creator_accounts (id, created_at)
VALUES ('00000000-1586-4000-8000-000000000001', now());

INSERT INTO public.brands (id, account_id, name, slug, default_currency)
VALUES ('00000000-1586-4000-8000-000000000011',
        '00000000-1586-4000-8000-000000000001',
        'Issue 1586 Group', 'issue-1586-group', 'USD');

INSERT INTO public.venue_listings
  (id, brand_id, slug, name, lat, lng, country_code, city, venue_category, claim_status)
VALUES
  -- THE ISSUE'S OWN VENUE. Academy Street Bistro's production coordinates.
  ('00000000-1586-4000-8000-000000000021', '00000000-1586-4000-8000-000000000011',
   'raleigh', 'Raleigh restaurant', 35.7863889, -78.7813889, 'US', 'Raleigh', 'restaurant', 'verified'),
  -- Lagos: a single-zone country, resolved without a rectangle at all.
  ('00000000-1586-4000-8000-000000000022', '00000000-1586-4000-8000-000000000011',
   'lagos', 'Lagos venue', 6.5244, 3.3792, 'NG', 'Lagos', 'restaurant', 'verified'),
  -- London: genuinely on UTC for half the year, and the reason 'UTC' can never
  -- be read as "unset".
  ('00000000-1586-4000-8000-000000000023', '00000000-1586-4000-8000-000000000011',
   'london', 'London venue', 51.5072, -0.1276, 'GB', 'London', 'restaurant', 'verified'),
  -- NULL ISLAND. lat/lng are NOT NULL on this table, so "unknown location" is
  -- written as a zero pair. It must stay silent.
  ('00000000-1586-4000-8000-000000000024', '00000000-1586-4000-8000-000000000011',
   'nowhere', 'Venue with no usable coordinates', 0, 0, 'US', NULL, 'restaurant', 'verified'),
  -- No country code at all — the rectangles are country-scoped, so silence.
  ('00000000-1586-4000-8000-000000000025', '00000000-1586-4000-8000-000000000011',
   'nocountry', 'Venue with no country code', 35.7863889, -78.7813889, NULL, NULL, 'restaurant', 'verified'),
  -- The operator has chosen a zone by hand. Nothing may overwrite it.
  ('00000000-1586-4000-8000-000000000026', '00000000-1586-4000-8000-000000000011',
   'operatorset', 'Operator chose the zone', 35.7863889, -78.7813889, 'US', 'Raleigh', 'restaurant', 'verified'),
  -- Not approved. Must remain invisible on the anon view whatever its clock.
  ('00000000-1586-4000-8000-000000000027', '00000000-1586-4000-8000-000000000011',
   'unapproved', 'Not approved yet', 35.7863889, -78.7813889, 'US', 'Raleigh', 'restaurant', 'pending_review'),
  -- A known-ambiguous point: the Indiana north-west corner, where the state is
  -- Central and the rest of it is Eastern.
  ('00000000-1586-4000-8000-000000000028', '00000000-1586-4000-8000-000000000011',
   'garyindiana', 'Gary, Indiana — ambiguous', 41.5934, -87.3464, 'US', 'Gary', 'restaurant', 'verified');

DO $fixtures$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.venue_listings
  WHERE brand_id = '00000000-1586-4000-8000-000000000011';
  IF v_n <> 8 THEN
    RAISE EXCEPTION 'issue_1586_fixture_count: expected 8 venues, got %', v_n;
  END IF;
END
$fixtures$;

-- Config rows. Inserted at the column default so the write-time derivation is
-- what has to do the work — exactly the path a newly provisioned venue takes.
INSERT INTO public.venue_availability_config (brand_id, venue_id)
SELECT '00000000-1586-4000-8000-000000000011', v.id
FROM public.venue_listings v
WHERE v.brand_id = '00000000-1586-4000-8000-000000000011'
  AND v.slug <> 'operatorset';

-- The operator's venue: an explicit human choice, stated as such.
INSERT INTO public.venue_availability_config (brand_id, venue_id, iana_timezone, iana_timezone_source)
VALUES ('00000000-1586-4000-8000-000000000011',
        '00000000-1586-4000-8000-000000000026', 'Asia/Tokyo', 'operator');

-- ── T-1 — THE HEADLINE ─────────────────────────────────────────────────────
DO $t1$
DECLARE
  v_tz text; v_src text; v_view_tz text;
BEGIN
  SELECT c.iana_timezone, c.iana_timezone_source INTO v_tz, v_src
  FROM public.venue_availability_config c
  JOIN public.venue_listings v ON v.id = c.venue_id
  WHERE v.slug = 'raleigh';
  IF v_tz IS DISTINCT FROM 'America/New_York' THEN
    RAISE EXCEPTION 'issue_1586_T1_raleigh_wrong_zone: got %, expected America/New_York', coalesce(v_tz, '<null>');
  END IF;
  IF v_src IS DISTINCT FROM 'derived' THEN
    RAISE EXCEPTION 'issue_1586_T1_raleigh_wrong_source: got %', coalesce(v_src, '<null>');
  END IF;
  -- …and the anon page can actually see it. A correct row nobody can read is
  -- the same blank page as a wrong one.
  SELECT iana_timezone INTO v_view_tz FROM public.venue_public_view WHERE slug = 'raleigh';
  IF v_view_tz IS DISTINCT FROM 'America/New_York' THEN
    RAISE EXCEPTION 'issue_1586_T1_raleigh_view_wrong: got %', coalesce(v_view_tz, '<null>');
  END IF;
  -- Positive control on the OTHER markets, so "America/New_York everywhere"
  -- cannot pass this file.
  SELECT iana_timezone INTO v_view_tz FROM public.venue_public_view WHERE slug = 'lagos';
  IF v_view_tz IS DISTINCT FROM 'Africa/Lagos' THEN
    RAISE EXCEPTION 'issue_1586_T1_lagos_wrong: got %', coalesce(v_view_tz, '<null>');
  END IF;
  SELECT iana_timezone INTO v_view_tz FROM public.venue_public_view WHERE slug = 'london';
  IF v_view_tz IS DISTINCT FROM 'Europe/London' THEN
    RAISE EXCEPTION 'issue_1586_T1_london_wrong: got %', coalesce(v_view_tz, '<null>');
  END IF;
END
$t1$;

-- ── T-2 — zone NAMES only, never offsets ───────────────────────────────────
DO $t2$
DECLARE
  v_bad text;
  v_checked integer;
BEGIN
  -- The seed.
  SELECT count(*) INTO v_checked FROM public.venue_timezone_regions WHERE zone_name IS NOT NULL;
  IF v_checked < 180 THEN
    RAISE EXCEPTION 'issue_1586_T2_vacuous_seed_check: only % named zones', v_checked;
  END IF;
  SELECT string_agg(DISTINCT zone_name, ', ') INTO v_bad
  FROM public.venue_timezone_regions
  WHERE zone_name IS NOT NULL
    AND (zone_name LIKE 'Etc/%'
         OR (zone_name NOT IN ('UTC','GMT')
             AND zone_name !~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z][A-Za-z0-9_+-]*)+$'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'issue_1586_T2_seed_has_non_iana_names: %', v_bad;
  END IF;
  -- Every seeded name is a zone this server recognises.
  SELECT string_agg(DISTINCT r.zone_name, ', ') INTO v_bad
  FROM public.venue_timezone_regions r
  WHERE r.zone_name IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_timezone_names n WHERE n.name = r.zone_name);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'issue_1586_T2_seed_has_unknown_zones: %', v_bad;
  END IF;
  -- And what actually landed on the rows.
  SELECT count(*) INTO v_checked FROM public.venue_availability_config;
  IF v_checked < 8 THEN
    RAISE EXCEPTION 'issue_1586_T2_vacuous_row_check: only % config rows', v_checked;
  END IF;
  SELECT string_agg(DISTINCT iana_timezone, ', ') INTO v_bad
  FROM public.venue_availability_config
  WHERE iana_timezone NOT IN ('UTC','GMT')
    AND iana_timezone !~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z][A-Za-z0-9_+-]*)+$';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'issue_1586_T2_stored_non_iana: %', v_bad;
  END IF;
  -- The rule is not simply "true for everything": an offset must NOT match it.
  IF '-05:00' ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z][A-Za-z0-9_+-]*)+$' THEN
    RAISE EXCEPTION 'issue_1586_T2_rule_is_vacuous: the name pattern accepted an offset';
  END IF;
END
$t2$;

-- ── T-3 — an operator's choice survives ────────────────────────────────────
DO $t3$
DECLARE v_tz text; v_src text;
BEGIN
  SELECT c.iana_timezone, c.iana_timezone_source INTO v_tz, v_src
  FROM public.venue_availability_config c
  JOIN public.venue_listings v ON v.id = c.venue_id
  WHERE v.slug = 'operatorset';
  IF v_tz IS DISTINCT FROM 'Asia/Tokyo' OR v_src IS DISTINCT FROM 'operator' THEN
    RAISE EXCEPTION 'issue_1586_T3_operator_choice_lost_on_insert: % / %', coalesce(v_tz,'<null>'), coalesce(v_src,'<null>');
  END IF;

  -- Re-run the exact backfill statement the migration ships. The venue sits at
  -- Raleigh's coordinates, so a backfill that ignored provenance would rewrite
  -- Asia/Tokyo to America/New_York right here.
  UPDATE public.venue_availability_config c
  SET iana_timezone = d.tz, iana_timezone_source = 'derived', updated_at = now()
  FROM (
    SELECT c2.id AS cfg_id,
           public.derive_venue_iana_timezone(v.lat, v.lng, v.country_code) AS tz
    FROM public.venue_availability_config c2
    JOIN public.venue_listings v ON v.id = c2.venue_id
    WHERE c2.iana_timezone_source <> 'operator'
  ) d
  WHERE c.id = d.cfg_id AND d.tz IS NOT NULL;

  SELECT c.iana_timezone, c.iana_timezone_source INTO v_tz, v_src
  FROM public.venue_availability_config c
  JOIN public.venue_listings v ON v.id = c.venue_id
  WHERE v.slug = 'operatorset';
  IF v_tz IS DISTINCT FROM 'Asia/Tokyo' OR v_src IS DISTINCT FROM 'operator' THEN
    RAISE EXCEPTION 'issue_1586_T3_backfill_clobbered_operator: % / %', coalesce(v_tz,'<null>'), coalesce(v_src,'<null>');
  END IF;
  -- Vacuity guard: that same backfill DID reach the derived rows, so the pass
  -- above is not "the statement matched nothing".
  SELECT c.iana_timezone INTO v_tz
  FROM public.venue_availability_config c
  JOIN public.venue_listings v ON v.id = c.venue_id
  WHERE v.slug = 'raleigh';
  IF v_tz IS DISTINCT FROM 'America/New_York' THEN
    RAISE EXCEPTION 'issue_1586_T3_backfill_was_a_noop: raleigh is %', coalesce(v_tz,'<null>');
  END IF;
END
$t3$;

-- ── T-4/T-5 — silence, and why 'UTC' cannot be read as "unset" ─────────────
DO $t4$
DECLARE v_tz text; v_src text; v_view_tz text; v_n integer;
BEGIN
  FOR v_tz, v_src, v_view_tz IN
    SELECT c.iana_timezone, c.iana_timezone_source,
           (SELECT pv.iana_timezone FROM public.venue_public_view pv WHERE pv.id = v.id)
    FROM public.venue_availability_config c
    JOIN public.venue_listings v ON v.id = c.venue_id
    WHERE v.slug IN ('nowhere', 'nocountry', 'garyindiana')
  LOOP
    -- The stored value is still the column's own default…
    IF v_tz IS DISTINCT FROM 'UTC' OR v_src IS DISTINCT FROM 'default' THEN
      RAISE EXCEPTION 'issue_1586_T4_undrivable_row_was_guessed: % / %', coalesce(v_tz,'<null>'), coalesce(v_src,'<null>');
    END IF;
    -- …and the anon page is told NOTHING, which is what makes #1562 render no
    -- time cell rather than an open-now computed in UTC.
    IF v_view_tz IS NOT NULL THEN
      RAISE EXCEPTION 'issue_1586_T5_default_row_leaked_utc_to_the_page: %', v_view_tz;
    END IF;
  END LOOP;
  -- Vacuity guard: the loop above must have run three times.
  SELECT count(*) INTO v_n
  FROM public.venue_availability_config c
  JOIN public.venue_listings v ON v.id = c.venue_id
  WHERE v.slug IN ('nowhere', 'nocountry', 'garyindiana');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'issue_1586_T4_vacuous_loop: % rows', v_n;
  END IF;
  -- And the control that makes the gate meaningful: a venue on a DERIVED
  -- 'UTC'-legal zone is published. Silence is about provenance, not the value.
  SELECT iana_timezone INTO v_view_tz FROM public.venue_public_view WHERE slug = 'london';
  IF v_view_tz IS NULL THEN
    RAISE EXCEPTION 'issue_1586_T5_gate_is_too_wide: an established zone was suppressed';
  END IF;
END
$t4$;

-- ── T-6 — a NEW venue derives its clock on INSERT, unavoidably ─────────────
DO $t6$
DECLARE v_tz text; v_src text;
BEGIN
  INSERT INTO public.venue_listings
    (id, brand_id, slug, name, lat, lng, country_code, venue_category, claim_status)
  VALUES ('00000000-1586-4000-8000-000000000031', '00000000-1586-4000-8000-000000000011',
          'newmiami', 'Brand new Miami venue', 25.7763688, -80.13249884, 'US', 'restaurant', 'verified');
  -- The provisioning path: brand + venue only, nothing about a clock.
  INSERT INTO public.venue_availability_config (brand_id, venue_id)
  VALUES ('00000000-1586-4000-8000-000000000011', '00000000-1586-4000-8000-000000000031');

  SELECT iana_timezone, iana_timezone_source INTO v_tz, v_src
  FROM public.venue_availability_config WHERE venue_id = '00000000-1586-4000-8000-000000000031';
  IF v_tz IS DISTINCT FROM 'America/New_York' OR v_src IS DISTINCT FROM 'derived' THEN
    RAISE EXCEPTION 'issue_1586_T6_new_venue_not_derived: % / %', coalesce(v_tz,'<null>'), coalesce(v_src,'<null>');
  END IF;
END
$t6$;

-- ── T-7 — offsets and DST-blind aliases are REFUSED at write time ──────────
DO $t7$
DECLARE v_ok boolean;
BEGIN
  FOR v_ok IN SELECT unnest(ARRAY[true]) LOOP NULL; END LOOP;

  BEGIN
    UPDATE public.venue_availability_config SET iana_timezone = 'Etc/GMT+5'
    WHERE venue_id = '00000000-1586-4000-8000-000000000021';
    RAISE EXCEPTION 'issue_1586_T7_etc_gmt_accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.venue_availability_config SET iana_timezone = 'EST'
    WHERE venue_id = '00000000-1586-4000-8000-000000000021';
    RAISE EXCEPTION 'issue_1586_T7_legacy_alias_accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.venue_availability_config SET iana_timezone = '-05:00'
    WHERE venue_id = '00000000-1586-4000-8000-000000000021';
    RAISE EXCEPTION 'issue_1586_T7_offset_accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Positive control: a REAL zone name goes through, so the three refusals
  -- above are not "every write fails".
  UPDATE public.venue_availability_config SET iana_timezone = 'America/Chicago'
  WHERE venue_id = '00000000-1586-4000-8000-000000000021';
  IF (SELECT iana_timezone FROM public.venue_availability_config
      WHERE venue_id = '00000000-1586-4000-8000-000000000021') <> 'America/Chicago' THEN
    RAISE EXCEPTION 'issue_1586_T7_valid_zone_was_refused';
  END IF;
END
$t7$;

-- ── T-8 — a bare zone UPDATE is recorded as an operator choice ─────────────
DO $t8$
DECLARE v_src text;
BEGIN
  -- T-7 just did exactly that: it set America/Chicago and said nothing about
  -- provenance. That is a human editing the field.
  SELECT iana_timezone_source INTO v_src
  FROM public.venue_availability_config WHERE venue_id = '00000000-1586-4000-8000-000000000021';
  IF v_src IS DISTINCT FROM 'operator' THEN
    RAISE EXCEPTION 'issue_1586_T8_bare_update_not_marked_operator: %', coalesce(v_src,'<null>');
  END IF;
  -- …and it is now protected from the backfill, which would otherwise put it
  -- back to America/New_York.
  UPDATE public.venue_availability_config c
  SET iana_timezone = d.tz, iana_timezone_source = 'derived'
  FROM (
    SELECT c2.id AS cfg_id,
           public.derive_venue_iana_timezone(v.lat, v.lng, v.country_code) AS tz
    FROM public.venue_availability_config c2
    JOIN public.venue_listings v ON v.id = c2.venue_id
    WHERE c2.iana_timezone_source <> 'operator'
  ) d
  WHERE c.id = d.cfg_id AND d.tz IS NOT NULL;
  IF (SELECT iana_timezone FROM public.venue_availability_config
      WHERE venue_id = '00000000-1586-4000-8000-000000000021') <> 'America/Chicago' THEN
    RAISE EXCEPTION 'issue_1586_T8_operator_edit_was_reverted_by_backfill';
  END IF;
END
$t8$;

-- [TEST-MOD-APPROVED #1719] The unified media contract deliberately appends
-- cover_media_poster_url without moving #1586's timezone or #1564's theme
-- axes. Ratchet both the old ordinals and the new final column.
-- ── T-9 — timezone stays at 29; poster is appended at 30 ───────────────────
DO $t9$
DECLARE v_n integer; v_ord integer; v_type text; v_poster_ord integer; v_poster_type text;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'venue_public_view';
  IF v_n <> 30 THEN
    RAISE EXCEPTION 'issue_1586_T9_view_column_count_changed: %', v_n;
  END IF;
  SELECT ordinal_position, data_type INTO v_ord, v_type FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'venue_public_view'
    AND column_name = 'iana_timezone';
  IF v_ord IS DISTINCT FROM 29 OR v_type IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'issue_1586_T9_iana_timezone_moved: ordinal %, type %', coalesce(v_ord, -1), coalesce(v_type,'<null>');
  END IF;
  SELECT ordinal_position, data_type INTO v_poster_ord, v_poster_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'venue_public_view'
    AND column_name = 'cover_media_poster_url';
  IF v_poster_ord IS DISTINCT FROM 30 OR v_poster_type IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'issue_1719_T9_cover_poster_moved: ordinal %, type %',
      coalesce(v_poster_ord, -1), coalesce(v_poster_type, '<null>');
  END IF;
  -- The theme axes #1564 pinned are still where it left them.
  IF (SELECT ordinal_position FROM information_schema.columns
      WHERE table_schema='public' AND table_name='venue_public_view' AND column_name='theme_color') <> 19 THEN
    RAISE EXCEPTION 'issue_1586_T9_theme_color_ordinal_moved';
  END IF;
END
$t9$;

-- ── T-10 — pending_review stays invisible ──────────────────────────────────
DO $t10$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.venue_public_view WHERE slug = 'unapproved';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'issue_1586_T10_pending_review_visible';
  END IF;
  -- Vacuity guard: the view is not simply empty.
  SELECT count(*) INTO v_n FROM public.venue_public_view
  WHERE brand_id = '00000000-1586-4000-8000-000000000011';
  IF v_n < 5 THEN
    RAISE EXCEPTION 'issue_1586_T10_view_is_empty: % rows', v_n;
  END IF;
END
$t10$;

-- ── T-11 — the rectangles, against real cities ─────────────────────────────
-- Each row is a place and the zone it must produce. A NULL expectation is a
-- KNOWN-AMBIGUOUS point where abstaining is the required answer, and those are
-- interleaved with resolving ones so "always NULL" cannot pass.
DO $t11$
DECLARE
  r record;
  v_got text;
  v_checked integer := 0;
  v_resolved integer := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- United States, Eastern
      ('US', 35.7863889, -78.7813889, 'America/New_York', 'Raleigh NC'),
      ('US', 40.7128,    -74.0060,    'America/New_York', 'New York NY'),
      ('US', 25.7617,    -80.1918,    'America/New_York', 'Miami FL'),
      ('US', 33.7490,    -84.3880,    'America/New_York', 'Atlanta GA'),
      ('US', 42.3314,    -83.0458,    'America/New_York', 'Detroit MI'),
      ('US', 39.7684,    -86.1581,    'America/New_York', 'Indianapolis IN'),
      ('US', 39.1031,    -84.5120,    'America/New_York', 'Cincinnati OH'),
      ('US', 38.0406,    -84.5037,    'America/New_York', 'Lexington KY'),
      ('US', 35.9606,    -83.9207,    'America/New_York', 'Knoxville TN'),
      ('US', 42.3601,    -71.0589,    'America/New_York', 'Boston MA'),
      ('US', 24.5551,    -81.7800,    'America/New_York', 'Key West FL'),
      -- United States, Central
      ('US', 41.8781,    -87.6298,    'America/Chicago',  'Chicago IL'),
      ('US', 36.1627,    -86.7816,    'America/Chicago',  'Nashville TN'),
      ('US', 33.5186,    -86.8104,    'America/Chicago',  'Birmingham AL'),
      ('US', 29.9511,    -90.0715,    'America/Chicago',  'New Orleans LA'),
      ('US', 29.7604,    -95.3698,    'America/Chicago',  'Houston TX'),
      ('US', 35.2220,   -101.8313,    'America/Chicago',  'Amarillo TX'),
      ('US', 31.9973,   -102.0779,    'America/Chicago',  'Midland TX'),
      ('US', 44.9778,    -93.2650,    'America/Chicago',  'Minneapolis MN'),
      ('US', 46.8083,   -100.7837,    'America/Chicago',  'Bismarck ND'),
      ('US', 30.4213,    -87.2169,    'America/Chicago',  'Pensacola FL'),
      -- United States, Mountain / Arizona
      ('US', 39.7392,   -104.9903,    'America/Denver',   'Denver CO'),
      ('US', 38.2544,   -104.6091,    'America/Denver',   'Pueblo CO'),
      ('US', 41.1400,   -104.8202,    'America/Denver',   'Cheyenne WY'),
      ('US', 45.7833,   -108.5007,    'America/Denver',   'Billings MT'),
      ('US', 35.6870,  -105.9378,     'America/Denver',   'Santa Fe NM'),
      ('US', 31.7619,  -106.4850,     'America/Denver',   'El Paso TX'),
      ('US', 40.7608,  -111.8910,     'America/Denver',   'Salt Lake City UT'),
      ('US', 33.4484,  -112.0740,     'America/Phoenix',  'Phoenix AZ'),
      ('US', 32.2226,  -110.9747,     'America/Phoenix',  'Tucson AZ'),
      -- United States, Pacific / non-contiguous
      ('US', 34.0522,  -118.2437,     'America/Los_Angeles', 'Los Angeles CA'),
      ('US', 47.6062,  -122.3321,     'America/Los_Angeles', 'Seattle WA'),
      ('US', 45.5152,  -122.6784,     'America/Los_Angeles', 'Portland OR'),
      ('US', 36.1699,  -115.1398,     'America/Los_Angeles', 'Las Vegas NV'),
      ('US', 61.2181,  -149.9003,     'America/Anchorage',   'Anchorage AK'),
      ('US', 58.3019,  -134.4197,     'America/Anchorage',   'Juneau AK'),
      ('US', 21.3069,  -157.8583,     'Pacific/Honolulu',    'Honolulu HI'),
      ('US', 18.4655,   -66.1057,     'America/Puerto_Rico', 'San Juan PR'),
      -- United States, KNOWN-AMBIGUOUS — must abstain
      ('US', 41.5934,   -87.3464,     NULL, 'Gary IN (Central corner of an Eastern state)'),
      ('US', 37.9716,   -87.5711,     NULL, 'Evansville IN (Central corner of an Eastern state)'),
      ('US', 36.9685,   -86.4808,     NULL, 'Bowling Green KY (Eastern/Central corridor)'),
      ('US', 35.0456,   -85.3097,     NULL, 'Chattanooga TN (Eastern/Central corridor)'),
      ('US', 30.1588,   -85.6602,     NULL, 'Panama City FL (panhandle line)'),
      ('US', 43.6150,  -116.2023,     NULL, 'Boise ID (state split along a river)'),
      ('US', 44.0805,  -103.2310,     NULL, 'Rapid City SD (plains corridor)'),
      ('US', 35.1983,  -111.6513,     NULL, 'Flagstaff AZ (beside the Navajo Nation)'),
      ('US', 46.5436,   -87.3954,     NULL, 'Marquette MI (Upper Peninsula corridor)'),
      -- Single-zone countries, incl. both live non-US markets
      ('NG',  6.5244,     3.3792,     'Africa/Lagos',     'Lagos NG'),
      ('GB', 51.5072,    -0.1276,     'Europe/London',    'London GB'),
      ('GB', 55.9533,    -3.1883,     'Europe/London',    'Edinburgh GB'),
      ('GH',  5.6037,    -0.1870,     'Africa/Accra',     'Accra GH'),
      ('ZA', -26.2041,   28.0473,     'Africa/Johannesburg', 'Johannesburg ZA'),
      ('AE', 25.2048,    55.2708,     'Asia/Dubai',       'Dubai AE'),
      ('JP', 35.6762,   139.6503,     'Asia/Tokyo',       'Tokyo JP'),
      ('IN', 19.0760,    72.8777,     'Asia/Kolkata',     'Mumbai IN'),
      ('FR', 48.8566,     2.3522,     'Europe/Paris',     'Paris FR'),
      ('DE', 52.5200,    13.4050,     'Europe/Berlin',    'Berlin DE'),
      ('IE', 53.3498,    -6.2603,     'Europe/Dublin',    'Dublin IE'),
      ('AR',-34.6037,   -58.3816,     'America/Argentina/Buenos_Aires', 'Buenos Aires AR'),
      -- Multi-zone countries with rectangles
      ('CA', 43.6532,   -79.3832,     'America/Toronto',  'Toronto CA'),
      ('CA', 45.5019,   -73.5674,     'America/Toronto',  'Montreal CA'),
      ('CA', 49.2827,  -123.1207,     'America/Vancouver','Vancouver CA'),
      ('CA', 51.0447,  -114.0719,     'America/Edmonton', 'Calgary CA'),
      ('CA', 50.4452,  -104.6189,     'America/Regina',   'Regina CA'),
      ('CA', 49.8951,   -97.1384,     'America/Winnipeg', 'Winnipeg CA'),
      ('CA', 44.6488,   -63.5752,     'America/Halifax',  'Halifax CA'),
      ('CA', 47.5615,   -52.7126,     'America/St_Johns', 'St John''s CA'),
      ('MX', 19.4326,   -99.1332,     'America/Mexico_City', 'Mexico City MX'),
      ('MX', 32.5149,  -117.0382,     'America/Tijuana',  'Tijuana MX'),
      ('MX', 29.0729,  -110.9559,     'America/Hermosillo','Hermosillo MX'),
      ('MX', 21.1619,   -86.8515,     'America/Cancun',   'Cancun MX'),
      ('BR',-23.5505,   -46.6333,     'America/Sao_Paulo','Sao Paulo BR'),
      ('BR',-15.7939,   -47.8828,     'America/Sao_Paulo','Brasilia BR'),
      ('BR', -3.1190,   -60.0217,     NULL,               'Manaus BR (west of the seeded band)'),
      ('ES', 40.4168,    -3.7038,     'Europe/Madrid',    'Madrid ES'),
      ('ES', 28.1235,   -15.4363,     'Atlantic/Canary',  'Las Palmas ES'),
      ('PT', 38.7223,    -9.1393,     'Europe/Lisbon',    'Lisbon PT'),
      ('PT', 37.7412,   -25.6756,     'Atlantic/Azores',  'Ponta Delgada PT'),
      ('AU',-33.8688,   151.2093,     'Australia/Sydney', 'Sydney AU'),
      ('AU',-37.8136,   144.9631,     'Australia/Sydney', 'Melbourne AU'),
      ('AU',-27.4698,   153.0251,     'Australia/Brisbane','Brisbane AU'),
      ('AU',-31.9523,   115.8613,     'Australia/Perth',  'Perth AU'),
      ('AU',-34.9285,   138.6007,     'Australia/Adelaide','Adelaide AU'),
      ('AU',-42.8821,   147.3272,     'Australia/Hobart', 'Hobart AU'),
      ('AU',-12.4634,   130.8456,     'Australia/Darwin', 'Darwin AU'),
      ('NZ',-36.8485,   174.7633,     'Pacific/Auckland', 'Auckland NZ'),
      ('ID', -6.2088,   106.8456,     'Asia/Jakarta',     'Jakarta ID'),
      ('ID', -5.1477,   119.4327,     'Asia/Makassar',    'Makassar ID'),
      ('EC', -2.1894,   -79.8891,     'America/Guayaquil','Guayaquil EC'),
      -- Countries deliberately NOT seeded — abstention, not a guess
      ('RU', 55.7558,    37.6173,     NULL, 'Moscow RU (multi-zone, unseeded)'),
      ('CL',-33.4489,   -70.6693,     NULL, 'Santiago CL (multi-zone, unseeded)'),
      ('KZ', 43.2220,    76.8512,     NULL, 'Almaty KZ (multi-zone, unseeded)'),
      -- Unusable input
      ('US',  0.0,         0.0,       NULL, 'Null Island'),
      ('US', 91.0,        10.0,       NULL, 'latitude out of range'),
      ('US', 10.0,       181.0,       NULL, 'longitude out of range'),
      ('ZZ', 35.7863889, -78.7813889, NULL, 'unknown country code'),
      (NULL, 35.7863889, -78.7813889, NULL, 'no country code')
    ) AS t(cc, lat, lng, expected, label)
  LOOP
    v_checked := v_checked + 1;
    v_got := public.derive_venue_iana_timezone(r.lat::double precision, r.lng::double precision, r.cc);
    IF v_got IS NOT NULL THEN v_resolved := v_resolved + 1; END IF;
    IF v_got IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'issue_1586_T11_wrong_zone for % : got %, expected %',
        r.label, coalesce(v_got, '<null>'), coalesce(r.expected, '<null>');
    END IF;
  END LOOP;
  -- Vacuity guards. The table must actually have been walked, and the resolver
  -- must actually be resolving — a function that returned NULL for everything
  -- would satisfy every NULL row above.
  IF v_checked < 90 THEN
    RAISE EXCEPTION 'issue_1586_T11_vacuous_grid: only % cases', v_checked;
  END IF;
  IF v_resolved < 70 THEN
    RAISE EXCEPTION 'issue_1586_T11_resolver_is_mostly_silent: only % of % resolved', v_resolved, v_checked;
  END IF;
END
$t11$;

-- ── T-12 — the derivation is idempotent ────────────────────────────────────
DO $t12$
DECLARE v_before text; v_after text; v_i integer;
BEGIN
  SELECT string_agg(c.venue_id::text || '=' || c.iana_timezone || '/' || c.iana_timezone_source, ',' ORDER BY c.venue_id)
  INTO v_before FROM public.venue_availability_config c;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'issue_1586_T12_vacuous: no config rows to compare';
  END IF;
  FOR v_i IN 1..2 LOOP
    UPDATE public.venue_availability_config c
    SET iana_timezone = d.tz, iana_timezone_source = 'derived'
    FROM (
      SELECT c2.id AS cfg_id,
             public.derive_venue_iana_timezone(v.lat, v.lng, v.country_code) AS tz
      FROM public.venue_availability_config c2
      JOIN public.venue_listings v ON v.id = c2.venue_id
      WHERE c2.iana_timezone_source <> 'operator'
    ) d
    WHERE c.id = d.cfg_id AND d.tz IS NOT NULL;
  END LOOP;
  SELECT string_agg(c.venue_id::text || '=' || c.iana_timezone || '/' || c.iana_timezone_source, ',' ORDER BY c.venue_id)
  INTO v_after FROM public.venue_availability_config c;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'issue_1586_T12_not_idempotent';
  END IF;
END
$t12$;

-- ── T-13 — the grant, pinned; and the callers, proven still working ────────
-- I-PROPOSED-1392-NO-UNALLOWLISTED-ANON-DEFINER. The repo-level CI gate
-- (`scripts/ci/security_definer_anon_gate.sh`) catches a re-widened grant by
-- probing the live ACL, but it runs once over the whole schema and names no
-- reason. This is the LOCAL guard, next to the function, and it also does the
-- half the gate cannot: prove the REVOKE did not break what it protects.
DO $t13$
DECLARE
  v_oid oid;
  v_role text;
  v_can boolean;
  v_tz text;
  v_src text;
  v_probe_can boolean;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'derive_venue_iana_timezone';
  -- Vacuity guard: a renamed or dropped function would make every privilege
  -- assertion below pass by returning NULL.
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'issue_1586_T13_function_missing: public.derive_venue_iana_timezone not found';
  END IF;

  -- It is SECURITY DEFINER, which is WHY the grant matters at all.
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'issue_1586_T13_not_security_definer';
  END IF;

  -- THE SETTLED GRANT. anon and authenticated: NO. service_role: YES.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      RAISE EXCEPTION 'issue_1586_T13_role_missing: % — the checks below would be vacuous', v_role;
    END IF;
    SELECT has_function_privilege(v_role, v_oid, 'EXECUTE') INTO v_can;
    IF v_can THEN
      RAISE EXCEPTION 'issue_1586_T13_execute_regranted_to_%: an internal resolver is reachable by a role that has no reason to call it', v_role;
    END IF;
  END LOOP;
  -- Positive control: the check is not "nobody can execute anything", which
  -- would pass even if the function had been revoked into uselessness.
  SELECT has_function_privilege('service_role', v_oid, 'EXECUTE') INTO v_can;
  IF NOT v_can THEN
    RAISE EXCEPTION 'issue_1586_T13_service_role_lost_execute';
  END IF;

  -- THE OTHER HALF: the REVOKE must not break the thing it protects.
  -- A role that holds table access and explicitly NO execute on the resolver
  -- must STILL get a derived zone, because the write path reaches the resolver
  -- through the SECURITY DEFINER trigger rather than directly.
  CREATE ROLE issue_1586_no_exec_probe BYPASSRLS;
  -- `SET ROLE` needs the session user to be a MEMBER of the target role. The
  -- `postgres` role in the Supabase image is not a superuser, so membership is
  -- granted explicitly rather than assumed. (All of this is inside the
  -- transaction and disappears on ROLLBACK.)
  EXECUTE format('GRANT issue_1586_no_exec_probe TO %I', current_user);
  GRANT USAGE ON SCHEMA public TO issue_1586_no_exec_probe;
  GRANT SELECT, INSERT, UPDATE ON public.venue_availability_config TO issue_1586_no_exec_probe;
  GRANT SELECT ON public.venue_listings TO issue_1586_no_exec_probe;
  REVOKE ALL ON FUNCTION public.derive_venue_iana_timezone(double precision, double precision, text)
    FROM issue_1586_no_exec_probe;
  SELECT has_function_privilege('issue_1586_no_exec_probe', v_oid, 'EXECUTE') INTO v_probe_can;
  IF v_probe_can THEN
    RAISE EXCEPTION 'issue_1586_T13_probe_role_can_execute: the proof below would be meaningless';
  END IF;

  INSERT INTO public.venue_listings
    (id, brand_id, slug, name, lat, lng, country_code, venue_category, claim_status)
  VALUES ('00000000-1586-4000-8000-000000000041', '00000000-1586-4000-8000-000000000011',
          'noexecprobe', 'Chicago venue written by a role with no EXECUTE',
          41.8781, -87.6298, 'US', 'restaurant', 'verified');

  SET LOCAL ROLE issue_1586_no_exec_probe;
  INSERT INTO public.venue_availability_config (brand_id, venue_id)
  VALUES ('00000000-1586-4000-8000-000000000011', '00000000-1586-4000-8000-000000000041');
  RESET ROLE;

  SELECT iana_timezone, iana_timezone_source INTO v_tz, v_src
  FROM public.venue_availability_config
  WHERE venue_id = '00000000-1586-4000-8000-000000000041';
  IF v_tz IS DISTINCT FROM 'America/Chicago' OR v_src IS DISTINCT FROM 'derived' THEN
    RAISE EXCEPTION 'issue_1586_T13_revoke_broke_the_write_path: got % / %',
      coalesce(v_tz, '<null>'), coalesce(v_src, '<null>');
  END IF;

  -- And the operator correction path, from the same grant-less role: setting
  -- the zone must still land and must still be recorded as a human choice.
  SET LOCAL ROLE issue_1586_no_exec_probe;
  UPDATE public.venue_availability_config
  SET iana_timezone = 'America/Los_Angeles', iana_timezone_source = 'operator'
  WHERE venue_id = '00000000-1586-4000-8000-000000000041';
  RESET ROLE;

  SELECT iana_timezone, iana_timezone_source INTO v_tz, v_src
  FROM public.venue_availability_config
  WHERE venue_id = '00000000-1586-4000-8000-000000000041';
  IF v_tz IS DISTINCT FROM 'America/Los_Angeles' OR v_src IS DISTINCT FROM 'operator' THEN
    RAISE EXCEPTION 'issue_1586_T13_revoke_broke_the_operator_path: got % / %',
      coalesce(v_tz, '<null>'), coalesce(v_src, '<null>');
  END IF;
END
$t13$;

-- The reference table is not readable by a client either — it is derivation
-- input, reached only through the SECURITY DEFINER resolver.
DO $t13b$
DECLARE v_role text; v_can boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.venue_timezone_regions'::regclass) THEN
    RAISE EXCEPTION 'issue_1586_T13b_regions_table_missing';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.venue_timezone_regions'::regclass) THEN
    RAISE EXCEPTION 'issue_1586_T13b_rls_disabled_on_regions';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    SELECT has_table_privilege(v_role, 'public.venue_timezone_regions', 'SELECT') INTO v_can;
    IF v_can THEN
      RAISE EXCEPTION 'issue_1586_T13b_regions_readable_by_%', v_role;
    END IF;
  END LOOP;
  -- Positive control: the table IS readable by its owner, so the two negatives
  -- above are not "this table is unreadable by everyone including the engine".
  SELECT has_table_privilege('postgres', 'public.venue_timezone_regions', 'SELECT') INTO v_can;
  IF NOT v_can THEN
    RAISE EXCEPTION 'issue_1586_T13b_owner_lost_select';
  END IF;
END
$t13b$;

ROLLBACK;
