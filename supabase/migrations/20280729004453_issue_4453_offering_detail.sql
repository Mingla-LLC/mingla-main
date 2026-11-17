-- #4453 milestone 9 (spec v2.1 §1.2, decision N1) — offering detail pages on a
-- brand's website: what a trip, event, experience or room page shows beyond its
-- live feed row.
--
-- brand_site_offering_detail(p_site_id, p_kind, p_slug):
--   * is static SQL (no EXECUTE, no dynamic identifiers), STABLE, SECURITY
--     DEFINER with an explicit search_path, and SERVICE ROLE ONLY (the
--     brand-site-runtime-resolve edge function is the one caller; the site id
--     comes from the signed envelope the runtime resolved for the request host);
--   * finds the offering THROUGH the site's own live feed
--     (brand_site_offerings_feed), so a detail page exists only for an offering
--     the site may already list: public, not deleted, this brand's, the same
--     readiness rules. A cancelled offering, one not in the feed, or another
--     brand's answers NULL. Every extra read is ALSO bound to the site's brand
--     (defence in depth: a feed row naming another brand's id still reads NULL);
--   * returns only public fields: a trip's days (title and summary, at most 14)
--     and what is included (at most 12); a room's guest limits, amenities and
--     accessibility features (at most 12 each) and its own ready photos (at most
--     8, Mingla's public cover storage paths only). No prices, counts or dates
--     here: those stay on the feed row, so nothing on the page comes from
--     anywhere else (SC-DP2). No guest, buyer or staff data, ever.
--
-- SITES_DETAIL_PAGES (feature_flags, OFF) gates OFFERING detail pages: while it
-- is off this read answers NULL and the runtime draws no detail route (cards
-- link to Mingla exactly as before, #2829). Rendering a stored page is never
-- flagged; a detail page is not a stored page.
--
-- Needs 20280726004453 (brand_site_booking_brand) and 20280726014453 (the feed
-- with stays). Forward-only. Applied by Seth's chat before the matching Core
-- deploy.

BEGIN;

SET LOCAL lock_timeout = '10s';

INSERT INTO public.feature_flags (flag_key, is_enabled, description)
SELECT 'SITES_DETAIL_PAGES', false,
  '#4453 milestone 9 — each trip, event, experience and room gets its own page on the brand''s Mingla website (live Mingla data, Book goes to Mingla). Off: no detail routes, cards link to Mingla.'
WHERE NOT EXISTS (SELECT 1 FROM public.feature_flags WHERE flag_key = 'SITES_DETAIL_PAGES');

CREATE OR REPLACE FUNCTION public.brand_site_detail_pages_enabled()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE((SELECT is_enabled FROM public.feature_flags
    WHERE flag_key = 'SITES_DETAIL_PAGES' LIMIT 1), false);
$function$;

CREATE OR REPLACE FUNCTION public.brand_site_offering_detail(p_site_id uuid, p_kind text, p_slug text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand record;
  v_row jsonb;
  v_id uuid;
  v_days jsonb := '[]'::jsonb;
  v_included jsonb := '[]'::jsonb;
  v_stay jsonb := NULL;
  v_photos jsonb := '[]'::jsonb;
BEGIN
  IF p_site_id IS NULL OR p_kind IS NULL OR p_slug IS NULL
     OR p_kind NOT IN ('trip', 'event', 'experience', 'stay')
     OR char_length(p_slug) NOT BETWEEN 1 AND 200 THEN
    RETURN NULL;
  END IF;
  IF NOT public.brand_site_detail_pages_enabled() THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_brand FROM public.brand_site_booking_brand(p_site_id);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- The offering exactly as the site's own feed lists it (never cancelled).
  SELECT o INTO v_row
  FROM jsonb_array_elements(COALESCE(public.brand_site_offerings_feed(p_site_id)->'offerings', '[]'::jsonb)) AS o
  WHERE o->>'kind' = p_kind AND o->>'slug' = p_slug AND o->>'status' <> 'cancelled'
  LIMIT 1;
  IF v_row IS NULL OR COALESCE(v_row->>'id', '') !~ '^[0-9a-fA-F-]{36}$' THEN
    RETURN NULL;
  END IF;
  v_id := (v_row->>'id')::uuid;

  IF p_kind = 'stay' THEN
    SELECT jsonb_build_object(
        'kind', o.kind,
        'max_guests', o.max_guests,
        'max_adults', o.max_adults,
        'max_children', o.max_children,
        'amenities', COALESCE((
          SELECT jsonb_agg(a.item ORDER BY a.ord)
          FROM (
            SELECT left(btrim(x.item), 80) AS item, x.ord
            FROM unnest(o.amenities) WITH ORDINALITY AS x(item, ord)
            WHERE btrim(COALESCE(x.item, '')) <> ''
            ORDER BY x.ord LIMIT 12
          ) a), '[]'::jsonb),
        'accessibility', COALESCE((
          SELECT jsonb_agg(a.item ORDER BY a.ord)
          FROM (
            SELECT left(btrim(x.item), 80) AS item, x.ord
            FROM unnest(o.accessibility_features) WITH ORDINALITY AS x(item, ord)
            WHERE btrim(COALESCE(x.item, '')) <> ''
            ORDER BY x.ord LIMIT 12
          ) a), '[]'::jsonb)
      )
      INTO v_stay
    FROM public.stay_offerings o
    WHERE o.id = v_id AND o.brand_id = v_brand.brand_id
      AND o.status = 'live' AND o.archived_at IS NULL;
    IF v_stay IS NULL THEN
      RETURN NULL;
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'path', 'brand_covers/' || m.storage_object_name,
        'alt', NULLIF(left(btrim(COALESCE(m.alt_text, '')), 300), '')
      ) ORDER BY m.is_cover DESC, m.sort_order ASC), '[]'::jsonb)
      INTO v_photos
    FROM (
      SELECT sm.storage_object_name, sm.alt_text, sm.is_cover, sm.sort_order
      FROM public.stay_offering_media sm
      WHERE sm.offering_id = v_id AND sm.brand_id = v_brand.brand_id
        AND sm.status = 'ready' AND sm.storage_bucket_id = 'brand_covers'
        AND sm.storage_object_name ~ '^[A-Za-z0-9._/-]+$' AND char_length(sm.storage_object_name) <= 900
        AND position('..' in sm.storage_object_name) = 0
      ORDER BY sm.is_cover DESC, sm.sort_order ASC
      LIMIT 8
    ) m;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = v_id AND e.brand_id = v_brand.brand_id AND e.deleted_at IS NULL
    ) THEN
      RETURN NULL;
    END IF;
    IF p_kind = 'trip' THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'day', d.ordinal,
          'title', left(btrim(d.title), 120),
          'summary', NULLIF(left(btrim(regexp_replace(COALESCE(d.narrative, ''), '\s+', ' ', 'g')), 600), '')
        ) ORDER BY d.ordinal), '[]'::jsonb)
        INTO v_days
      FROM (
        SELECT td.ordinal, td.title, td.narrative
        FROM public.trip_days td
        WHERE td.event_id = v_id AND btrim(td.title) <> ''
        ORDER BY td.ordinal
        LIMIT 14
      ) d;
      SELECT COALESCE(jsonb_agg(i.item ORDER BY i.ordinal, i.created_at), '[]'::jsonb)
        INTO v_included
      FROM (
        SELECT left(btrim(ti.item), 200) AS item, ti.ordinal, ti.created_at
        FROM public.trip_inclusions ti
        WHERE ti.event_id = v_id AND ti.kind = 'included' AND btrim(ti.item) <> ''
        ORDER BY ti.ordinal, ti.created_at
        LIMIT 12
      ) i;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'offering_id', v_id,
    'kind', p_kind,
    'days', v_days,
    'included', v_included,
    'stay', v_stay,
    'photos', v_photos
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.brand_site_detail_pages_enabled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_detail_pages_enabled() TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_offering_detail(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_offering_detail(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.brand_site_detail_pages_enabled() IS
  '#4453 M9 — SITES_DETAIL_PAGES: may Mingla websites offer offering detail pages? Service role only.';
COMMENT ON FUNCTION public.brand_site_offering_detail(uuid, text, text) IS
  '#4453 M9 — the public extras of one offering''s website detail page (trip days and inclusions, room facts and photos), found through the site''s own live feed and bound to the site''s brand; NULL when the flag is off, the offering is cancelled, not in the feed or another brand''s. Service role only.';

COMMIT;
