-- #2829 W4 — the trip guide that lives on the trip, and the live offerings
-- feed a brand's website reads.
--
-- 1. `trip_guides` — highlights, what to prepare, good to know, FAQs, group
--    minimum and activity level, stored ON THE TRIP in Mingla (one row per
--    trip, a sidecar like trip_days / trip_inclusions). Every surface that
--    draws the Mingla trip page shows it (consumer, Business, buyer web)
--    through the shared trip body. Missing sections are simply absent; nothing
--    is ever filled in for the host.
--      - writes only through `biz_upsert_trip_guide` (event manager or above on
--        the trip's brand; a published trip's edit is logged like any other);
--      - the editor reads through `biz_get_trip_guide` (same rank);
--      - anyone reads a PUBLIC trip's guide through `pg_public_trip_guide`.
--    The table is RLS-forced with no grants: there is no direct path in.
--
-- 2. `brand_site_offerings_feed(site)` — what a brand's website shows about its
--    trips, events and experiences, read live per request by the Sites runtime
--    (service role only, through the signed runtime gateway) and frozen into
--    each publication as the fallback snapshot. It composes the SAME public
--    readers Mingla's own public pages use (pg_public_trips_by_brand,
--    business_public_events_view + pg_public_event_display_prices +
--    pg_public_ticket_types_remaining, pg_public_experiences_by_brand), so a
--    site shows exactly what Mingla shows: only public, non-deleted offerings
--    of the site's own brand. Ended and cancelled ones are included with their
--    status, so "past trips" work and a cancelled trip can say so.
--
--    Per #2829 amendment A1.2 every card links to the existing Mingla public
--    page (`public_url`), which runs the existing checkout unchanged; the feed
--    carries no checkout or site-theming data.
--
-- Forward-only.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Trip guide
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trip_guide_highlights_valid(p_items text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p_items IS NULL OR (
    cardinality(p_items) <= 12
    AND array_position(p_items, NULL) IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM unnest(p_items) AS item
      WHERE char_length(btrim(item)) NOT BETWEEN 1 AND 140
    )
  )
$fn$;

CREATE OR REPLACE FUNCTION public.trip_guide_faqs_valid(p_faqs jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p_faqs IS NULL OR (
    jsonb_typeof(p_faqs) = 'array'
    AND jsonb_array_length(p_faqs) <= 20
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_faqs) AS faq
      WHERE jsonb_typeof(faq) <> 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(faq)) <> 2
        OR jsonb_typeof(faq->'question') IS DISTINCT FROM 'string'
        OR jsonb_typeof(faq->'answer') IS DISTINCT FROM 'string'
        OR char_length(btrim(faq->>'question')) NOT BETWEEN 1 AND 200
        OR char_length(btrim(faq->>'answer')) NOT BETWEEN 1 AND 2000
    )
  )
$fn$;

CREATE TABLE IF NOT EXISTS public.trip_guides (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  highlights text[] NOT NULL DEFAULT '{}'::text[],
  what_to_prepare text,
  good_to_know text,
  faqs jsonb NOT NULL DEFAULT '[]'::jsonb,
  group_minimum integer,
  activity_level text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT trip_guides_highlights_ck CHECK (public.trip_guide_highlights_valid(highlights)),
  CONSTRAINT trip_guides_prepare_ck CHECK (what_to_prepare IS NULL OR char_length(what_to_prepare) BETWEEN 1 AND 4000),
  CONSTRAINT trip_guides_good_to_know_ck CHECK (good_to_know IS NULL OR char_length(good_to_know) BETWEEN 1 AND 4000),
  CONSTRAINT trip_guides_faqs_ck CHECK (public.trip_guide_faqs_valid(faqs)),
  CONSTRAINT trip_guides_group_minimum_ck CHECK (group_minimum IS NULL OR group_minimum BETWEEN 1 AND 1000),
  CONSTRAINT trip_guides_activity_level_ck CHECK (
    activity_level IS NULL OR activity_level IN ('easy','moderate','active','challenging')
  )
);

ALTER TABLE public.trip_guides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_guides FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.trip_guides FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.trip_guides IS
  '#2829 W4 — the trip guide (highlights, what to prepare, good to know, FAQs, group minimum, activity level), one row per trip. RPC-only: biz_upsert_trip_guide / biz_get_trip_guide (event manager+), pg_public_trip_guide (public trips). Missing sections are absent, never defaulted.';

-- The stored guide as the surfaces read it (camel-free snake_case JSON).
CREATE OR REPLACE FUNCTION public.trip_guide_json(p_row public.trip_guides)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'highlights', to_jsonb(COALESCE(p_row.highlights, '{}'::text[])),
    'what_to_prepare', p_row.what_to_prepare,
    'good_to_know', p_row.good_to_know,
    'faqs', COALESCE(p_row.faqs, '[]'::jsonb),
    'group_minimum', p_row.group_minimum,
    'activity_level', p_row.activity_level,
    'updated_at', p_row.updated_at
  )
$fn$;
REVOKE ALL ON FUNCTION public.trip_guide_json(public.trip_guides) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.biz_get_trip_guide(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user_id uuid := auth.uid();
  v_event record;
  v_row public.trip_guides;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  SELECT e.id, e.brand_id, e.event_type INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id AND e.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip_not_found';
  END IF;
  IF v_event.event_type <> 'trip' THEN
    RAISE EXCEPTION 'event_not_a_trip';
  END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  SELECT * INTO v_row FROM public.trip_guides WHERE event_id = p_event_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN public.trip_guide_json(v_row);
END;
$fn$;

REVOKE ALL ON FUNCTION public.biz_get_trip_guide(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_get_trip_guide(uuid) TO authenticated, service_role;

-- Full replacement of a trip's guide. An all-empty guide removes the row, so
-- "clear everything" leaves the trip page exactly as it was before a guide.
CREATE OR REPLACE FUNCTION public.biz_upsert_trip_guide(p_event_id uuid, p_guide jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_user_id uuid := auth.uid();
  v_event record;
  v_key text;
  v_highlights text[] := '{}'::text[];
  v_prepare text;
  v_good text;
  v_faqs jsonb := '[]'::jsonb;
  v_min integer;
  v_level text;
  v_row public.trip_guides;
  v_existed boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_guide IS NULL OR jsonb_typeof(p_guide) <> 'object' THEN
    RAISE EXCEPTION 'trip_guide_invalid';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_guide) LOOP
    IF v_key NOT IN ('highlights','what_to_prepare','good_to_know','faqs','group_minimum','activity_level') THEN
      RAISE EXCEPTION 'trip_guide_invalid';
    END IF;
  END LOOP;

  SELECT e.id, e.brand_id, e.event_type, e.status INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id AND e.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip_not_found';
  END IF;
  IF v_event.event_type <> 'trip' THEN
    RAISE EXCEPTION 'event_not_a_trip';
  END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
  IF v_event.status NOT IN ('draft','scheduled','live') THEN
    RAISE EXCEPTION 'trip_not_editable_status';
  END IF;

  -- Normalise: trimmed text, blanks dropped (never stored as empty strings).
  IF p_guide ? 'highlights' AND jsonb_typeof(p_guide->'highlights') <> 'null' THEN
    IF jsonb_typeof(p_guide->'highlights') <> 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_guide->'highlights') h WHERE jsonb_typeof(h) <> 'string') THEN
      RAISE EXCEPTION 'trip_guide_invalid';
    END IF;
    SELECT COALESCE(array_agg(btrim(h) ORDER BY ord), '{}'::text[]) INTO v_highlights
    FROM jsonb_array_elements_text(p_guide->'highlights') WITH ORDINALITY AS t(h, ord)
    WHERE btrim(h) <> '';
  END IF;
  IF p_guide ? 'what_to_prepare' AND jsonb_typeof(p_guide->'what_to_prepare') NOT IN ('string','null') THEN
    RAISE EXCEPTION 'trip_guide_invalid';
  END IF;
  IF p_guide ? 'good_to_know' AND jsonb_typeof(p_guide->'good_to_know') NOT IN ('string','null') THEN
    RAISE EXCEPTION 'trip_guide_invalid';
  END IF;
  v_prepare := NULLIF(btrim(p_guide->>'what_to_prepare'), '');
  v_good := NULLIF(btrim(p_guide->>'good_to_know'), '');
  IF p_guide ? 'faqs' AND jsonb_typeof(p_guide->'faqs') <> 'null' THEN
    IF jsonb_typeof(p_guide->'faqs') <> 'array' THEN
      RAISE EXCEPTION 'trip_guide_invalid';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_guide->'faqs') f
      WHERE jsonb_typeof(f) <> 'object'
        OR EXISTS (SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN ('question','answer'))
        OR jsonb_typeof(f->'question') NOT IN ('string','null')
        OR jsonb_typeof(f->'answer') NOT IN ('string','null')
    ) THEN
      RAISE EXCEPTION 'trip_guide_invalid';
    END IF;
    -- A half-filled FAQ (question without answer, or the reverse) is refused,
    -- never published half-empty; a fully blank row is dropped.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_guide->'faqs') f
      WHERE (COALESCE(btrim(f->>'question'), '') = '') <> (COALESCE(btrim(f->>'answer'), '') = '')
    ) THEN
      RAISE EXCEPTION 'trip_guide_invalid';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('question', btrim(f->>'question'), 'answer', btrim(f->>'answer')) ORDER BY ord), '[]'::jsonb)
      INTO v_faqs
    FROM jsonb_array_elements(p_guide->'faqs') WITH ORDINALITY AS t(f, ord)
    WHERE COALESCE(btrim(f->>'question'), '') <> '';
  END IF;
  IF p_guide ? 'group_minimum' AND jsonb_typeof(p_guide->'group_minimum') <> 'null' THEN
    IF jsonb_typeof(p_guide->'group_minimum') <> 'number'
       OR (p_guide->>'group_minimum') !~ '^[0-9]{1,4}$' THEN
      RAISE EXCEPTION 'trip_guide_invalid';
    END IF;
    v_min := (p_guide->>'group_minimum')::integer;
  END IF;
  IF p_guide ? 'activity_level' AND jsonb_typeof(p_guide->'activity_level') NOT IN ('string','null') THEN
    RAISE EXCEPTION 'trip_guide_invalid';
  END IF;
  v_level := NULLIF(btrim(p_guide->>'activity_level'), '');

  IF NOT public.trip_guide_highlights_valid(v_highlights)
     OR NOT public.trip_guide_faqs_valid(v_faqs)
     OR (v_prepare IS NOT NULL AND char_length(v_prepare) > 4000)
     OR (v_good IS NOT NULL AND char_length(v_good) > 4000)
     OR (v_min IS NOT NULL AND v_min NOT BETWEEN 1 AND 1000)
     OR (v_level IS NOT NULL AND v_level NOT IN ('easy','moderate','active','challenging')) THEN
    RAISE EXCEPTION 'trip_guide_invalid';
  END IF;

  v_existed := EXISTS (SELECT 1 FROM public.trip_guides WHERE event_id = p_event_id);
  IF cardinality(v_highlights) = 0 AND v_prepare IS NULL AND v_good IS NULL
     AND jsonb_array_length(v_faqs) = 0 AND v_min IS NULL AND v_level IS NULL THEN
    DELETE FROM public.trip_guides WHERE event_id = p_event_id;
    v_row := NULL;
  ELSE
    INSERT INTO public.trip_guides AS g (event_id, highlights, what_to_prepare, good_to_know,
      faqs, group_minimum, activity_level, updated_at, updated_by)
    VALUES (p_event_id, v_highlights, v_prepare, v_good, v_faqs, v_min, v_level, now(), v_user_id)
    ON CONFLICT (event_id) DO UPDATE SET
      highlights = EXCLUDED.highlights,
      what_to_prepare = EXCLUDED.what_to_prepare,
      good_to_know = EXCLUDED.good_to_know,
      faqs = EXCLUDED.faqs,
      group_minimum = EXCLUDED.group_minimum,
      activity_level = EXCLUDED.activity_level,
      updated_at = now(),
      updated_by = v_user_id
    RETURNING * INTO v_row;
  END IF;

  -- A published trip's guide change is logged like every other published-trip
  -- edit (additive: it adds information, it changes nothing a buyer paid for).
  IF v_event.status IN ('scheduled','live') AND (v_existed OR v_row.event_id IS NOT NULL) THEN
    INSERT INTO public.trip_edit_log
      (event_id, brand_id, edited_by, reason, severity, changed_field_keys, diff_summary)
    VALUES (
      p_event_id, v_event.brand_id, v_user_id, 'Trip guide updated', 'additive',
      ARRAY['guide'],
      jsonb_build_object('guide', jsonb_build_object('present', v_row.event_id IS NOT NULL))
    );
  END IF;

  RETURN CASE WHEN v_row.event_id IS NULL THEN NULL ELSE public.trip_guide_json(v_row) END;
END;
$fn$;

REVOKE ALL ON FUNCTION public.biz_upsert_trip_guide(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_upsert_trip_guide(uuid, jsonb) TO authenticated, service_role;

-- A public trip's guide, for every surface that draws the public trip page.
-- Same visibility predicate as the public offering read model
-- (business_public_events_view): public, not deleted (trip or brand), a
-- public status, and not behind the private-event gate.
CREATE OR REPLACE FUNCTION public.pg_public_trip_guide(p_trip_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.trip_guide_json(g)
  FROM public.trip_guides g
  JOIN public.events e ON e.id = g.event_id
  JOIN public.brands b ON b.id = e.brand_id
  WHERE g.event_id = p_trip_id
    AND e.event_type = 'trip'
    AND e.visibility = 'public'
    AND e.deleted_at IS NULL
    AND b.deleted_at IS NULL
    AND e.status IN ('scheduled','live','ended','cancelled')
    AND NOT public.issue_1931_event_ordinary_read_blocked(e.id)
$fn$;

REVOKE ALL ON FUNCTION public.pg_public_trip_guide(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pg_public_trip_guide(uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The offerings feed a site reads
-- ---------------------------------------------------------------------------

-- A cover the Sites runtime may serve: an IMAGE stored in Mingla's own public
-- cover buckets. Returned as `<bucket>/<key>` (never a URL, never signed); the
-- runtime serves it through its token-bound /om route. Anything else (video,
-- a third-party URL, an odd path) has no site cover.
CREATE OR REPLACE FUNCTION public.brand_site_offering_cover_path(p_url text, p_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_url IS NULL OR COALESCE(p_type, 'image') <> 'image' THEN NULL
    WHEN position('..' IN p_url) > 0 OR char_length(p_url) > 1000 THEN NULL
    ELSE substring(p_url FROM '/storage/v1/object/public/((?:event_covers|brand_covers)/[A-Za-z0-9._/-]+)$')
  END
$fn$;

CREATE OR REPLACE FUNCTION public.brand_site_offerings_feed(p_site_id uuid)
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
      'https://host.usemingla.com/t/' || t.brand_slug || '/' || t.trip_slug AS public_url
    FROM public.pg_public_trips_by_brand(v_brand.slug) t
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
      'https://host.usemingla.com/e/' || er.brand_slug || '/' || er.slug AS public_url
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
      'https://host.usemingla.com/exp/' || x.brand_slug || '/' || x.experience_slug AS public_url
    FROM public.pg_public_experiences_by_brand(v_brand.slug) x
    JOIN public.events e ON e.id = x.experience_id
    WHERE e.status IN ('scheduled','live','ended','cancelled')
  ),
  all_rows AS (
    SELECT * FROM trips
    UNION ALL SELECT * FROM events
    UNION ALL SELECT * FROM experiences
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
      'cover', CASE WHEN public.brand_site_offering_cover_path(l.cover_media_url, l.cover_media_type) IS NULL THEN NULL
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

REVOKE ALL ON FUNCTION public.brand_site_offerings_feed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_offerings_feed(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_offering_cover_path(text, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.brand_site_offerings_feed(uuid) IS
  '#2829 W4 — the live offerings a brand''s website shows: only public, non-deleted trips/events/experiences of the site''s own brand, composed from Mingla''s public readers; ended and cancelled included with their status; upcoming soonest first, then past newest first; max 200. Cards link to the existing Mingla public page (public_url). Service role only.';

COMMIT;
