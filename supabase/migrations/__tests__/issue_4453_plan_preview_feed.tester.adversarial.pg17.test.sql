\set ON_ERROR_STOP on
-- #4453 milestone 10 — L3 tester adversarial proof of 20280807094453 (plan-preview feed).
-- BEGIN ... ROLLBACK: every fixture rolls back.
-- MINGLA-INVARIANT: I-SITES-PLAN-PREVIEW-WRITES-NOTHING | issue #4453 | the plan-preview reads (inputs, feed by brand, flag) write no row; only brand_site_plan_preview_take writes, and only to brand_site_plan_preview_requests (pg_stat_xact diff).
--
-- X-1 the re-issued site feed returns EXACTLY what the pre-M10 body (20280807054453, pinned verbatim below)
--     returned, on real rows (public / private / draft / cancelled / deleted / past events, RSVP, live and
--     draft rooms), with the stay flags off and on; a site of a deleted brand raises in both.
-- X-2 the feed by brand never leaks another brand's rows; a deleted brand raises sites_not_found.
-- X-3 inputs: anon has no EXECUTE; a signed-in stranger is sites_forbidden; the owner reads their own
--     brand's inputs; anon and authenticated cannot call the feed by brand, the counter or the flag read.
-- X-4 writes nothing: across inputs, feed by brand, flag read and the site feed, pg_stat_xact shows
--     zero inserts/updates/deletes in every table; take() writes only the counter table.
-- X-6 retest: brand twins of the fact reads are service-role only, brand-isolated, deleted brand NULL.
-- X-5 rate-limit boundaries: 3 rows 59 s old refuse the 4th; 20 rows 23 h 59 m old refuse the 21st;
--     a NULL brand is refused without a row.
--
-- FAILS-ON-REVERT: drop 20280807094453 -> X-2 (function missing); give feed(site) a drifted body
-- (e.g. drop the deleted_at check or a CTE) -> X-1; drop the plan gate -> X-3b; drop the minute
-- check -> X-5a.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.p_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $a$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN RAISE EXCEPTION 'issue #4453 m10 tester FAIL: %', p_label; END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$a$;

CREATE OR REPLACE FUNCTION pg_temp.raises(p_sql text, p_code text) RETURNS boolean LANGUAGE plpgsql AS $r$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM = p_code OR SQLSTATE = p_code;
END
$r$;

-- The pre-M10 site feed body, verbatim from 20280807054453 (only the name differs).
CREATE OR REPLACE FUNCTION pg_temp.m10t_old_feed(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_brand record;
  v_offerings jsonb;
BEGIN
  SELECT b.id, b.slug, b.default_currency, b.payment_provider::text AS payment_provider
    INTO v_brand
  FROM public.brand_sites s
  JOIN public.brands b ON b.id = s.brand_id
  WHERE s.id = p_site_id
    AND b.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sites_not_found';
  END IF;

  WITH trips AS (
    SELECT
      t.trip_id AS id, 'trip'::text AS kind, t.trip_slug AS slug, t.title,
      t.description, t.destination_text, t.cover_media_url, t.cover_media_type,
      t.start_at, t.end_at, t.timezone, t.status, COALESCE(t.bookings_closed, false) AS bookings_closed,
      t.total_capacity AS capacity, t.spots_left,
      t.min_price_cents::bigint AS min_price_minor, t.currency, COALESCE(t.has_free_tier, false) AS has_free_tier,
      false AS waitlist_enabled,
      public.pg_trip_installments_supported(t.trip_id) AS installments_available,
      'https://host.usemingla.com/t/' || t.brand_slug || '/' || t.trip_slug AS public_url,
      NULL::text AS cover_path
    FROM (
      SELECT r.trip_id, r.trip_slug, r.brand_slug, r.title, r.description, r.destination_text,
        r.cover_media_url, r.cover_media_type, r.start_at, r.end_at, r.timezone, r.status,
        r.bookings_closed, r.total_capacity, r.spots_left, r.min_price_cents, r.currency, r.has_free_tier
      FROM public.pg_public_trips_by_brand(v_brand.slug) r
      UNION ALL
      -- #2829 W7c (A13.5): an ENDED trip is shown even while the brand cannot
      -- take payments (nobody can book an ended trip). Exactly the rows the
      -- public reader's readiness gate held back; upcoming paid trips still
      -- need payments readiness.
      SELECT u.trip_id, u.trip_slug, u.brand_slug, u.title, u.description, u.destination_text,
        u.cover_media_url, u.cover_media_type, u.start_at, u.end_at, u.timezone, u.status,
        u.bookings_closed, u.total_capacity, u.spots_left, u.min_price_cents, u.currency, u.has_free_tier
      FROM public.brand_site_ended_trips_held_for_readiness(v_brand.id) u
    ) t
  ),
  event_rows AS (
    SELECT v.*
    FROM public.business_public_events_view v
    WHERE v.brand_id = v_brand.id
      AND v.event_type IN ('event','rsvp')
  ),
  event_remaining AS (
    SELECT er.id,
      bool_or(r.remaining IS NULL) AS any_unlimited,
      SUM(r.remaining)::int AS remaining,
      SUM(r.remaining + r.sold)::int AS capacity,
      count(r.ticket_type_id) AS tiers
    FROM event_rows er
    LEFT JOIN LATERAL public.pg_public_ticket_types_remaining(er.id) r ON true
    GROUP BY er.id
  ),
  event_free AS (
    SELECT er.id, EXISTS (
      SELECT 1 FROM public.ticket_types tt
      WHERE tt.event_id = er.id AND tt.deleted_at IS NULL
        AND COALESCE(tt.is_hidden, false) = false AND (tt.is_free OR tt.price_cents = 0)
    ) AS has_free
    FROM event_rows er
  ),
  events AS (
    SELECT
      er.id, 'event'::text AS kind, er.slug, er.title, er.description,
      er.location_text AS destination_text, er.cover_media_url, er.cover_media_type,
      er.master_start_at AS start_at, er.master_end_at AS end_at,
      COALESCE(er.master_timezone, er.timezone) AS timezone, er.status, false AS bookings_closed,
      CASE
        WHEN er.event_type = 'rsvp' THEN er.rsvp_capacity
        WHEN rem.tiers = 0 OR rem.any_unlimited THEN NULL
        ELSE rem.capacity
      END AS capacity,
      CASE
        WHEN er.event_type = 'rsvp' THEN
          CASE WHEN er.rsvp_capacity IS NULL OR er.rsvp_going_count IS NULL THEN NULL
               ELSE GREATEST(er.rsvp_capacity - er.rsvp_going_count, 0) END
        WHEN rem.tiers = 0 OR rem.any_unlimited THEN NULL
        ELSE rem.remaining
      END AS spots_left,
      NULLIF(er.display_price_cents, 0)::bigint AS min_price_minor, er.currency,
      COALESCE(fr.has_free, false) OR er.event_type = 'rsvp' AS has_free_tier,
      COALESCE(er.rsvp_waitlist_enabled, false) AND er.event_type = 'rsvp' AS waitlist_enabled,
      false AS installments_available,
      'https://host.usemingla.com/e/' || er.brand_slug || '/' || er.slug AS public_url,
      NULL::text AS cover_path
    FROM event_rows er
    LEFT JOIN event_remaining rem ON rem.id = er.id
    LEFT JOIN event_free fr ON fr.id = er.id
  ),
  experiences AS (
    SELECT
      x.experience_id AS id, 'experience'::text AS kind, x.experience_slug AS slug, x.title,
      x.description, x.venue_text AS destination_text, x.cover_media_url, x.cover_media_type,
      x.next_occurrence_at AS start_at, NULL::timestamptz AS end_at, e.timezone, e.status,
      false AS bookings_closed, NULL::integer AS capacity, NULL::integer AS spots_left,
      NULLIF(x.price_from_cents, 0)::bigint AS min_price_minor, x.currency,
      COALESCE(x.is_free, false) AS has_free_tier, false AS waitlist_enabled, false AS installments_available,
      'https://host.usemingla.com/exp/' || x.brand_slug || '/' || x.experience_slug AS public_url,
      NULL::text AS cover_path
    FROM public.pg_public_experiences_by_brand(v_brand.slug) x
    JOIN public.events e ON e.id = x.experience_id
    WHERE e.status IN ('scheduled','live','ended','cancelled')
  ),
  -- #4453 M5 (§6.5) — live rooms and places of the brand's verified stay
  -- venues, only while the stay flags are on. "From" is the lowest sellable
  -- night in the next 60 days (never a stay total). Links to the venue page's
  -- stay tab with the room picked.
  stays AS (
    SELECT
      o.id, 'stay'::text AS kind, o.id::text AS slug, o.name AS title,
      NULLIF(o.summary, '') AS description, v.name AS destination_text,
      NULL::text AS cover_media_url, NULL::text AS cover_media_type,
      NULL::timestamptz AS start_at, NULL::timestamptz AS end_at, NULL::text AS timezone,
      'scheduled'::text AS status, false AS bookings_closed,
      NULL::integer AS capacity, NULL::integer AS spots_left,
      night.price_minor AS min_price_minor, night.currency,
      false AS has_free_tier, false AS waitlist_enabled, false AS installments_available,
      'https://host.usemingla.com/b/' || v_brand.slug || '/v/' || v.slug || '?tab=stay&room=' || o.id::text AS public_url,
      (SELECT 'brand_covers/' || m.storage_object_name FROM public.stay_offering_media m
        WHERE m.offering_id = o.id AND m.status = 'ready' AND m.storage_bucket_id = 'brand_covers'
        ORDER BY m.is_cover DESC, m.sort_order ASC LIMIT 1) AS cover_path
    FROM public.stay_offerings o
    JOIN public.venue_listings v ON v.id = o.venue_id AND v.brand_id = o.brand_id
    LEFT JOIN public.stay_settings ss ON ss.venue_id = v.id
    LEFT JOIN LATERAL (
      SELECT COALESCE(n.price_override_minor, pv.amount_minor)::bigint AS price_minor,
             COALESCE(n.currency_code, pv.currency_code)::text AS currency
      FROM public.stay_room_nights n
      LEFT JOIN LATERAL (
        SELECT p.amount_minor, p.currency_code FROM public.stay_price_versions p
        WHERE p.offering_id = n.offering_id AND p.pricing_unit = 'room_night'
          AND p.effective_from <= now() AND (p.effective_to IS NULL OR p.effective_to > now())
        ORDER BY p.version_number DESC LIMIT 1
      ) pv ON true
      -- A night with a room LEFT (sellable less holds and bookings; 20280807044453).
      WHERE n.offering_id = o.id AND public.stay_room_night_available(n.offering_id, n.local_date) > 0
        AND n.local_date BETWEEN (now() AT TIME ZONE public.brand_site_zone_or_utc(ss.timezone))::date
                             AND (now() AT TIME ZONE public.brand_site_zone_or_utc(ss.timezone))::date + 60
        AND COALESCE(n.price_override_minor, pv.amount_minor) IS NOT NULL
      ORDER BY COALESCE(n.price_override_minor, pv.amount_minor) ASC
      LIMIT 1
    ) night ON true
    WHERE public.brand_site_stay_flags_on()
      AND o.brand_id = v_brand.id AND o.status = 'live' AND o.archived_at IS NULL
      AND v.claim_status = 'verified'
  ),
  all_rows AS (
    SELECT * FROM trips
    UNION ALL SELECT * FROM events
    UNION ALL SELECT * FROM experiences
    UNION ALL SELECT * FROM stays
  ),
  ranked AS (
    SELECT a.*,
      (a.status IN ('ended','cancelled') OR COALESCE(a.end_at, a.start_at) < now()) AS is_past
    FROM all_rows a
    WHERE a.slug IS NOT NULL AND a.title IS NOT NULL
  ),
  limited AS (
    SELECT r.* FROM ranked r
    ORDER BY r.is_past,
      CASE WHEN NOT r.is_past THEN r.start_at END ASC NULLS LAST,
      CASE WHEN r.is_past THEN r.start_at END DESC NULLS LAST,
      r.id
    LIMIT 200
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', l.id,
      'kind', l.kind,
      'slug', l.slug,
      'title', left(l.title, 200),
      'summary', NULLIF(left(btrim(regexp_replace(COALESCE(l.description, ''), '\s+', ' ', 'g')), 500), ''),
      'cover', CASE
                WHEN l.cover_path IS NOT NULL AND l.cover_path ~ '^brand_covers/[A-Za-z0-9._/-]+$' AND char_length(l.cover_path) <= 913 AND position('..' in l.cover_path) = 0
                  THEN jsonb_build_object('path', l.cover_path, 'type', 'image')
                WHEN public.brand_site_offering_cover_path(l.cover_media_url, l.cover_media_type) IS NULL THEN NULL
                ELSE jsonb_build_object('path', public.brand_site_offering_cover_path(l.cover_media_url, l.cover_media_type), 'type', 'image') END,
      'destination_text', NULLIF(left(btrim(COALESCE(l.destination_text, '')), 200), ''),
      'start_at', l.start_at,
      'end_at', l.end_at,
      'timezone', l.timezone,
      'status', l.status,
      'bookings_closed', l.bookings_closed,
      'capacity', l.capacity,
      'spots_left', l.spots_left,
      'group_minimum', CASE WHEN l.kind = 'trip' THEN (SELECT g.group_minimum FROM public.trip_guides g WHERE g.event_id = l.id) END,
      'min_price_minor', l.min_price_minor,
      'currency', CASE WHEN l.currency ~ '^[A-Z]{3}$' THEN l.currency END,
      'has_free_tier', l.has_free_tier,
      'public_url', l.public_url,
      'waitlist_enabled', l.waitlist_enabled,
      'installments_available', l.installments_available
    ) ORDER BY l.is_past,
      CASE WHEN NOT l.is_past THEN l.start_at END ASC NULLS LAST,
      CASE WHEN l.is_past THEN l.start_at END DESC NULLS LAST,
      l.id), '[]'::jsonb)
    INTO v_offerings
  FROM limited l;

  RETURN jsonb_build_object(
    'generated_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'brand', jsonb_build_object(
      'slug', v_brand.slug,
      'currency', v_brand.default_currency,
      'payment_rails', CASE WHEN v_brand.payment_provider = 'paystack' THEN 'paystack' ELSE 'stripe' END
    ),
    'offerings', v_offerings
  );
END;
$fn$;

CREATE TEMP TABLE m10t_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
DO $fixture$
DECLARE
  v_owner uuid := gen_random_uuid(); v_stranger uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_d uuid := gen_random_uuid();
  v_site_a uuid := gen_random_uuid(); v_site_d uuid := gen_random_uuid();
  v_venue uuid := gen_random_uuid(); v_e record; v_id uuid; v_r record;
BEGIN
  INSERT INTO m10t_ids VALUES ('owner', v_owner), ('stranger', v_stranger), ('a', v_a), ('b', v_b), ('d', v_d), ('site_a', v_site_a), ('site_d', v_site_d);
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'm10t-owner@4453.invalid'), (v_stranger, 'm10t-stranger@4453.invalid');
  INSERT INTO public.creator_accounts(id, created_at, updated_at) VALUES (v_owner, now(), now()), (v_stranger, now(), now());
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, contact_email) VALUES
    (v_a, v_owner, 'M10T Alpha', 'm10t-alpha', 'NGN', 'alpha@4453.invalid'),
    (v_b, v_owner, 'M10T Beta', 'm10t-beta', 'NGN', 'beta@4453.invalid'),
    (v_d, v_owner, 'M10T Gone', 'm10t-gone', 'NGN', 'gone@4453.invalid');
  INSERT INTO public.brand_sites(id, brand_id, status, created_by) VALUES
    (v_site_a, v_a, 'provisioning', v_owner), (v_site_d, v_d, 'provisioning', v_owner);
  FOR v_e IN SELECT * FROM (VALUES
      ('a', 'pub-a', 'event', 'public', 'scheduled', false, interval '5 days', 250000),
      ('a', 'free-a', 'event', 'public', 'scheduled', false, interval '9 days', 0),
      ('a', 'rsvp-a', 'rsvp', 'public', 'scheduled', false, interval '3 days', 0),
      ('a', 'past-a', 'event', 'public', 'scheduled', false, interval '-20 days', 150000),
      ('a', 'secret-a', 'event', 'private', 'scheduled', false, interval '5 days', 0),
      ('a', 'draft-a', 'event', 'public', 'draft', false, interval '5 days', 0),
      ('a', 'off-a', 'event', 'public', 'cancelled', false, interval '6 days', 0),
      ('a', 'gone-a', 'event', 'public', 'scheduled', true, interval '5 days', 0),
      ('b', 'pub-b', 'event', 'public', 'scheduled', false, interval '4 days', 150000)) AS x(brand, slug, etype, visibility, status, deleted, start_in, price)
  LOOP
    v_id := gen_random_uuid();
    INSERT INTO public.events(id, brand_id, title, slug, event_type, visibility, status, timezone, currency, deleted_at)
    VALUES (v_id, CASE v_e.brand WHEN 'a' THEN v_a WHEN 'b' THEN v_b ELSE v_d END, initcap(replace(v_e.slug, '-', ' ')),
      v_e.slug, v_e.etype, v_e.visibility, v_e.status, 'Africa/Lagos', 'NGN', CASE WHEN v_e.deleted THEN now() END);
    INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_id, now() + v_e.start_in, now() + v_e.start_in + interval '3 hours', 'Africa/Lagos', true);
    IF v_e.etype = 'event' THEN
      INSERT INTO public.ticket_types(event_id, name, price_cents, currency, is_free, quantity_total, display_order)
      VALUES (v_id, 'Tier', v_e.price, 'NGN', v_e.price = 0, 40, 0);
    END IF;
  END LOOP;
  INSERT INTO public.venue_listings(id, brand_id, slug, name, lat, lng, venue_category, claim_status) VALUES
    (v_venue, v_a, 'm10talphastay', 'Alpha Stay', 6.45, 3.47, 'stay', 'verified');
  INSERT INTO public.stay_settings(venue_id, brand_id, property_kind, timezone, default_booking_mode, booking_state) VALUES
    (v_venue, v_a, 'resort', 'Africa/Lagos', 'instant', 'active');
  FOR v_r IN SELECT * FROM (VALUES ('Garden Room', 'live'), ('Loft', 'live'), ('Hidden', 'draft')) AS x(name, status) LOOP
    INSERT INTO public.stay_offerings(venue_id, brand_id, kind, name, summary, status, confirmation_mode,
        inventory_basis, unit_naming_mode, quantity, min_guests, max_guests, max_adults, max_children, amenities, accessibility_features)
    VALUES (v_venue, v_a, 'room', v_r.name, 'A calm room', v_r.status, 'instant', 'pooled_units', 'interchangeable', 2, 1, 2, 2, 0, ARRAY['Wi-Fi'], '{}');
  END LOOP;
  UPDATE public.brands SET deleted_at = now() WHERE id = v_d;
END
$fixture$;

CREATE OR REPLACE FUNCTION pg_temp.id(p_k text) RETURNS uuid LANGUAGE sql AS $i$ SELECT v FROM m10t_ids WHERE k = p_k $i$;
GRANT SELECT ON m10t_ids TO anon, authenticated;

-- X-1 parity with the pre-M10 body on real rows, flags off then on
DO $x1$
DECLARE v_old jsonb; v_new jsonb; v_flags boolean;
BEGIN
  FOREACH v_flags IN ARRAY ARRAY[false, true] LOOP
    UPDATE public.feature_flags SET is_enabled = v_flags WHERE flag_key IN ('STAY_PUBLIC_PAGES', 'STAY_RESERVE_WRITES');
    v_old := pg_temp.m10t_old_feed(pg_temp.id('site_a')) - 'generated_at';
    v_new := public.brand_site_offerings_feed(pg_temp.id('site_a')) - 'generated_at';
    PERFORM pg_temp.p_assert(jsonb_array_length(v_new->'offerings') = CASE WHEN v_flags THEN 7 ELSE 5 END,
      format('X-1a non-trivial feed (stay flags %s): %s rows', v_flags, jsonb_array_length(v_new->'offerings')));
    -- [TEST-MOD-APPROVED #4572] Items 2/7a added cover_stream_poster (null for these image/no-cover
    -- rows), and the venue-feed work added price_cadence. These legacy rows are
    -- all "from" prices. Summary line breaks are kept too (none in this fixture).
    -- With those two approved additive keys set aside, this is still M10's body.
    PERFORM pg_temp.p_assert(v_old = jsonb_set(v_new, '{offerings}', COALESCE((
        SELECT jsonb_agg(o.value - 'cover_stream_poster' - 'price_cadence' ORDER BY o.ordinality)
        FROM jsonb_array_elements(v_new->'offerings') WITH ORDINALITY o), '[]'::jsonb))
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_new->'offerings') o
        WHERE o->'cover_stream_poster' <> 'null'::jsonb OR o->>'price_cadence' <> 'from'),
      format('X-1b site feed equals the pre-M10 body byte for byte, #4572 keys aside (stay flags %s)', v_flags));
    PERFORM pg_temp.p_assert((public.brand_site_offerings_feed_for_brand(pg_temp.id('a')) - 'generated_at') = v_new,
      format('X-1c feed by brand equals the site feed (stay flags %s)', v_flags));
  END LOOP;
  UPDATE public.feature_flags SET is_enabled = false WHERE flag_key IN ('STAY_PUBLIC_PAGES', 'STAY_RESERVE_WRITES');
  PERFORM pg_temp.p_assert(
    pg_temp.raises(format('SELECT pg_temp.m10t_old_feed(%L)', pg_temp.id('site_d')), 'sites_not_found')
    AND pg_temp.raises(format('SELECT public.brand_site_offerings_feed(%L)', pg_temp.id('site_d')), 'sites_not_found'),
    'X-1d a site of a deleted brand raises sites_not_found before and after');
END
$x1$;

-- X-2 isolation
SELECT pg_temp.p_assert(
  (SELECT array_agg(o->>'slug') FROM jsonb_array_elements(public.brand_site_offerings_feed_for_brand(pg_temp.id('b'))->'offerings') o) = ARRAY['pub-b'],
  'X-2a the brand with no site sees only its own public event');
SELECT pg_temp.p_assert(
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.brand_site_offerings_feed_for_brand(pg_temp.id('a'))->'offerings') o
    WHERE o->>'slug' IN ('pub-b', 'secret-a', 'draft-a', 'gone-a')),
  'X-2b brand A never shows brand B''s, private, draft or deleted rows');
SELECT pg_temp.p_assert(pg_temp.raises(format('SELECT public.brand_site_offerings_feed_for_brand(%L)', pg_temp.id('d')), 'sites_not_found'),
  'X-2c a deleted brand raises sites_not_found');

-- X-3 inputs gate
SET LOCAL ROLE anon;
SELECT pg_temp.p_assert(pg_temp.raises(format('SELECT public.brand_site_plan_preview_inputs(%L)', pg_temp.id('a')), '42501'),
  'X-3a anon has no EXECUTE on inputs');
SELECT pg_temp.p_assert(pg_temp.raises(format('SELECT public.brand_site_offerings_feed_for_brand(%L)', pg_temp.id('a')), '42501')
    AND pg_temp.raises(format('SELECT public.brand_site_plan_preview_take(%L)', pg_temp.id('a')), '42501'),
  'X-3a anon cannot read the feed by brand or take the counter');
RESET ROLE;
INSERT INTO public.brand_site_plans (brand_id, revision, offerings_selected, story, started_by, updated_by)
VALUES (pg_temp.id('a'), 3, ARRAY['events']::text[], '{"main_action":"Join the next event"}', pg_temp.id('owner'), pg_temp.id('owner'));
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.id('stranger'), 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', pg_temp.id('stranger')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.p_assert(pg_temp.raises(format('SELECT public.brand_site_plan_preview_inputs(%L)', pg_temp.id('a')), 'sites_forbidden'),
  'X-3b a signed-in stranger is refused (sites_forbidden)');
SELECT pg_temp.p_assert(pg_temp.raises(format('SELECT public.brand_site_offerings_feed_for_brand(%L)', pg_temp.id('a')), '42501')
    AND pg_temp.raises(format('SELECT public.brand_site_plan_preview_take(%L)', pg_temp.id('a')), '42501')
    AND pg_temp.raises(format('SELECT public.brand_site_plan_preview_on(%L)', pg_temp.id('a')), '42501'),
  'X-3c authenticated cannot call the feed by brand, the counter or the flag read');
RESET ROLE;
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.id('owner'), 'role', 'authenticated')::text, true);
SELECT set_config('request.jwt.claim.sub', pg_temp.id('owner')::text, true);

-- X-4 writes nothing (pg_stat_xact diff)
CREATE TEMP TABLE m10t_before ON COMMIT DROP AS
  SELECT relid, n_tup_ins, n_tup_upd, n_tup_del FROM pg_stat_xact_user_tables;
SET LOCAL ROLE authenticated;
SELECT pg_temp.p_assert(
  (public.brand_site_plan_preview_inputs(pg_temp.id('a'))->>'brand_id')::uuid = pg_temp.id('a')
  AND (public.brand_site_plan_preview_inputs(pg_temp.id('a'))->>'site_id')::uuid = pg_temp.id('site_a')
  AND (public.brand_site_plan_preview_inputs(pg_temp.id('a'))->>'revision')::int = 3,
  'X-3e the entitled owner reads the inputs of their own brand');
RESET ROLE;
SELECT public.brand_site_offerings_feed_for_brand(pg_temp.id('a')), public.brand_site_offerings_feed_for_brand(pg_temp.id('b')),
  public.brand_site_offerings_feed(pg_temp.id('site_a')), public.brand_site_plan_preview_on(pg_temp.id('a'));
SELECT pg_temp.p_assert(NOT EXISTS (
    SELECT 1 FROM pg_stat_xact_user_tables n LEFT JOIN m10t_before b USING (relid)
    WHERE (n.n_tup_ins, n.n_tup_upd, n.n_tup_del) IS DISTINCT FROM (COALESCE(b.n_tup_ins, 0), COALESCE(b.n_tup_upd, 0), COALESCE(b.n_tup_del, 0))
      AND n.relname NOT LIKE 'm10t_%'),
  'X-4a inputs, both feeds and the flag read write no row in any table');
TRUNCATE m10t_before;
INSERT INTO m10t_before SELECT relid, n_tup_ins, n_tup_upd, n_tup_del FROM pg_stat_xact_user_tables;
SELECT public.brand_site_plan_preview_take(pg_temp.id('a'));
SELECT pg_temp.p_assert((SELECT array_agg(n.schemaname || '.' || n.relname) FROM pg_stat_xact_user_tables n LEFT JOIN m10t_before b USING (relid)
    WHERE (n.n_tup_ins, n.n_tup_upd, n.n_tup_del) IS DISTINCT FROM (COALESCE(b.n_tup_ins, 0), COALESCE(b.n_tup_upd, 0), COALESCE(b.n_tup_del, 0))
      AND n.relname NOT LIKE 'm10t_%') = ARRAY['public.brand_site_plan_preview_requests'],
  'X-4b take() writes only the counter table');

-- X-5 rate-limit boundaries
DELETE FROM public.brand_site_plan_preview_requests WHERE brand_id = pg_temp.id('a');
INSERT INTO public.brand_site_plan_preview_requests (brand_id, created_at)
SELECT pg_temp.id('a'), now() - interval '59 seconds' FROM generate_series(1, 3);
SELECT pg_temp.p_assert(public.brand_site_plan_preview_take(pg_temp.id('a')) = '{"allowed": false, "reason": "minute"}'::jsonb,
  'X-5a three requests 59 s old refuse the 4th');
UPDATE public.brand_site_plan_preview_requests SET created_at = now() - interval '61 seconds' WHERE brand_id = pg_temp.id('a');
SELECT pg_temp.p_assert((public.brand_site_plan_preview_take(pg_temp.id('a'))->>'allowed')::boolean,
  'X-5b after the minute passes the next request is allowed');
DELETE FROM public.brand_site_plan_preview_requests WHERE brand_id = pg_temp.id('a');
INSERT INTO public.brand_site_plan_preview_requests (brand_id, created_at)
SELECT pg_temp.id('a'), now() - interval '23 hours 59 minutes' FROM generate_series(1, 20);
SELECT pg_temp.p_assert(public.brand_site_plan_preview_take(pg_temp.id('a')) = '{"allowed": false, "reason": "day"}'::jsonb,
  'X-5c twenty requests 23 h 59 m old refuse the 21st');
SELECT pg_temp.p_assert(public.brand_site_plan_preview_take(NULL) = '{"allowed": false, "reason": "invalid"}'::jsonb
    AND NOT EXISTS (SELECT 1 FROM public.brand_site_plan_preview_requests WHERE brand_id IS NULL),
  'X-5d a NULL brand is refused and writes nothing');

-- X-6 (retest) the brand twins of the fact reads and the brand lookup: closed to anon and to a signed-in
--     owner alike (Core calls them with the service role only); a twin never answers for another brand.
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.id('owner'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.p_assert(
  pg_temp.raises(format('SELECT public.brand_site_compose_facts_for_brand(%L)', pg_temp.id('a')), '42501')
  AND pg_temp.raises(format('SELECT public.brand_site_brand_by_id(%L)', pg_temp.id('a')), '42501')
  AND pg_temp.raises(format('SELECT public.brand_site_offering_dates_for_brand(%L, gen_random_uuid(), %L, 14)', pg_temp.id('a'), 'event_dates'), '42501')
  AND pg_temp.raises(format('SELECT public.brand_site_ticket_tiers_for_brand(%L, gen_random_uuid())', pg_temp.id('a')), '42501')
  AND pg_temp.raises(format('SELECT public.brand_site_venue_slots_for_brand(%L, gen_random_uuid(), 2, 7)', pg_temp.id('a')), '42501'),
  'X-6a a signed-in owner cannot call any brand twin or the brand lookup directly');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.p_assert(pg_temp.raises(format('SELECT public.brand_site_compose_facts_for_brand(%L)', pg_temp.id('a')), '42501'),
  'X-6b anon cannot call the brand twins');
RESET ROLE;
SELECT pg_temp.p_assert(
  public.brand_site_ticket_tiers_for_brand(pg_temp.id('b'), (SELECT id FROM public.events WHERE slug = 'pub-a' AND brand_id = pg_temp.id('a'))) IS NULL
  AND public.brand_site_offering_dates_for_brand(pg_temp.id('b'), (SELECT id FROM public.events WHERE slug = 'pub-a' AND brand_id = pg_temp.id('a')), 'event_dates', 14) IS NULL
  AND public.brand_site_ticket_tiers_for_brand(pg_temp.id('a'), (SELECT id FROM public.events WHERE slug = 'pub-a' AND brand_id = pg_temp.id('a'))) IS NOT NULL,
  'X-6c brand B''s twins answer NULL for brand A''s event; brand A''s own answer is real');
SELECT pg_temp.p_assert(public.brand_site_compose_facts_for_brand(pg_temp.id('d')) IS NULL,
  'X-6d a deleted brand reads NULL facts');
SELECT pg_temp.p_assert(
  (public.brand_site_compose_facts(pg_temp.id('site_a')) IS NOT DISTINCT FROM public.brand_site_compose_facts_for_brand(pg_temp.id('a'))),
  'X-6e compose facts by site equals by brand');

ROLLBACK;
