-- #4453 milestone 7 (spec v2 §6.2-§6.6, §9 item 7; spec v2.1 §2.4) — Ari's
-- design pass: the two rollout flags, their brand allowlist, the Mingla facts
-- composer v2 needs, the owner's setup answers handed to Build, and the
-- look-alike fingerprints (a warning only, never a block).
--
--   1. SITES_ARI_DESIGN_PASS (off): Ari's design tools (brief, design pass,
--      chrome) and composer v2 on Build. SITES_STYLE_LIBRARY (off): which
--      designs the Business look picker and Ari offer (off: Atelier and
--      Voyage, exactly as before).
--   2. brand_site_flag_brands: a per-brand allowlist for those two flags
--      (service role only). Young and Stamped is listed first (by slug; a
--      no-op where that brand does not exist).
--   3. brand_site_flag_on(flag, brand): the flag is on, or the brand is listed.
--   4. brand_site_compose_facts(site): counts and booleans only (verified
--      venues per category, reservations on, a published menu, live stays,
--      the next event's public tiers, the Mingla review count). No names, no
--      prices, no guest data: the composer places a section only when its
--      source holds real content and writes no fact itself.
--   5. brand_site_live_fingerprints(format, brand) / brand_site_record_fingerprint
--      (site, fingerprint): the looks of OTHER brands' live sites of the same
--      format (no brand ids leave Core), and the fingerprint Studio computed
--      for this site's design pass.
--   6. brand_site_plan_authorize_compose re-issued from 20280807014453; the
--      only change is that Build also receives the owner's own Q5-Q8 answers
--      (value_points, faq, process_steps, quick_facts).
--
-- Every function is static SQL (no EXECUTE), SECURITY DEFINER with an
-- explicit search_path, and service role only except the re-issued compose
-- authorisation (unchanged grants). Forward-only. Applied by Seth's chat
-- before the matching Core deploy.

BEGIN;

SET LOCAL lock_timeout = '10s';

-- ── 1. Flags (off) ─────────────────────────────────────────────────────────
INSERT INTO public.feature_flags (flag_key, is_enabled, description)
SELECT 'SITES_ARI_DESIGN_PASS', false,
  '#4453 milestone 7 — Ari''s design pass on Mingla websites: the design brief, one automatic style-and-format pass per build (composer v2), and the header and phone bar card. Brands in brand_site_flag_brands get it while this is off.'
WHERE NOT EXISTS (SELECT 1 FROM public.feature_flags WHERE flag_key = 'SITES_ARI_DESIGN_PASS');

INSERT INTO public.feature_flags (flag_key, is_enabled, description)
SELECT 'SITES_STYLE_LIBRARY', false,
  '#4453 — offer the ten website styles (with fit labels) in the Business look picker and to Ari. Off: Atelier and Voyage only. Rendering stored designs is never flagged. Brands in brand_site_flag_brands get it while this is off.'
WHERE NOT EXISTS (SELECT 1 FROM public.feature_flags WHERE flag_key = 'SITES_STYLE_LIBRARY');

-- ── 2. The brand allowlist ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brand_site_flag_brands (
  flag_key text NOT NULL CHECK (flag_key IN ('SITES_ARI_DESIGN_PASS', 'SITES_STYLE_LIBRARY')),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flag_key, brand_id)
);
ALTER TABLE public.brand_site_flag_brands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.brand_site_flag_brands FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.brand_site_flag_brands TO service_role;
COMMENT ON TABLE public.brand_site_flag_brands IS
  '#4453 milestone 7 — brands that get SITES_ARI_DESIGN_PASS or SITES_STYLE_LIBRARY while the flag itself is off (rollout D10: Young and Stamped first). Service role only.';

INSERT INTO public.brand_site_flag_brands (flag_key, brand_id)
SELECT f.flag_key, b.id
FROM public.brands b
CROSS JOIN (VALUES ('SITES_ARI_DESIGN_PASS'), ('SITES_STYLE_LIBRARY')) AS f(flag_key)
WHERE b.slug = 'youngandstamped' AND b.deleted_at IS NULL
ON CONFLICT (flag_key, brand_id) DO NOTHING;

-- ── 3. The flag read ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.brand_site_flag_on(p_flag text, p_brand_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_flag IN ('SITES_ARI_DESIGN_PASS', 'SITES_STYLE_LIBRARY') AND (
    COALESCE((SELECT f.is_enabled FROM public.feature_flags f WHERE f.flag_key = p_flag LIMIT 1), false)
    OR EXISTS (SELECT 1 FROM public.brand_site_flag_brands l
               WHERE l.flag_key = p_flag AND l.brand_id = p_brand_id));
$function$;

-- ── 4. The Mingla facts composer v2 reads (counts and booleans only) ───────
CREATE OR REPLACE FUNCTION public.brand_site_compose_facts(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_brand record;
  v_venues jsonb;
  v_menu boolean;
  v_stays integer := 0;
  v_reviews bigint;
BEGIN
  IF p_site_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_brand FROM public.brand_site_booking_brand(p_site_id);
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Verified venues per category: the count, and the one venue's id and
  -- reservation switch only when there is exactly one (v2 §4.1 rule 3).
  SELECT COALESCE(jsonb_object_agg(c.category, jsonb_build_object(
      'count', c.n,
      'venue_id', CASE WHEN c.n = 1 THEN c.only_id END,
      'reservations_on', CASE WHEN c.n = 1 THEN c.only_reservations END)), '{}'::jsonb)
  INTO v_venues
  FROM (
    SELECT v.venue_category AS category, count(*) AS n,
      (array_agg(v.id ORDER BY v.id))[1] AS only_id,
      bool_or(COALESCE(r.reservations_enabled, false)) AS only_reservations
    FROM public.venue_listings v
    LEFT JOIN public.venue_reservation_settings r ON r.venue_id = v.id
    WHERE v.brand_id = v_brand.brand_id AND v.claim_status = 'verified'
      AND v.venue_category IN ('restaurant', 'play', 'creative_and_arts', 'stay')
    GROUP BY v.venue_category
  ) c;

  SELECT EXISTS (
    SELECT 1 FROM public.menus m JOIN public.menu_items i ON i.menu_id = m.id
    WHERE m.brand_id = v_brand.brand_id AND m.is_active)
  INTO v_menu;

  IF public.brand_site_stay_flags_on() THEN
    SELECT count(*) INTO v_stays
    FROM public.stay_offerings o
    WHERE o.brand_id = v_brand.brand_id AND o.status = 'live' AND o.archived_at IS NULL;
  END IF;

  SELECT count(*) INTO v_reviews
  FROM public.place_reviews pr
  WHERE pr.moderation_status = 'approved'
    AND pr.place_pool_id IN (
      SELECT v.place_pool_id FROM public.venue_listings v
      WHERE v.brand_id = v_brand.brand_id AND v.claim_status = 'verified' AND v.place_pool_id IS NOT NULL);

  RETURN jsonb_build_object(
    'venues', v_venues,
    'published_menu', COALESCE(v_menu, false),
    'live_stay_offerings', COALESCE(v_stays, 0),
    'mingla_reviews', COALESCE(v_reviews, 0));
END;
$function$;

-- ── 5. Look-alike fingerprints (§6.6; a warning only) ──────────────────────
CREATE OR REPLACE FUNCTION public.brand_site_live_fingerprints(p_format text, p_brand_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Allowlist on read too: only the six look keys, each of its own type, ever
  -- leave (never format, never any extra key a row might hold).
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'design', CASE WHEN jsonb_typeof(s.fp->'design') = 'string' THEN s.fp->'design' END,
      'header', CASE WHEN jsonb_typeof(s.fp->'header') = 'string' THEN s.fp->'header' END,
      'hero',   CASE WHEN jsonb_typeof(s.fp->'hero') = 'string' THEN s.fp->'hero' END,
      'home',   CASE WHEN jsonb_typeof(s.fp->'home') = 'array'
                       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s.fp->'home') h WHERE jsonb_typeof(h) <> 'string')
                     THEN s.fp->'home' END,
      'fonts',  CASE WHEN jsonb_typeof(s.fp->'fonts') = 'string' THEN s.fp->'fonts' END,
      'colors', CASE WHEN jsonb_typeof(s.fp->'colors') = 'string' THEN s.fp->'colors' END))
    ORDER BY s.id), '[]'::jsonb)
  FROM (
    SELECT bs.id, bs.design_fingerprint AS fp
    FROM public.brand_sites bs
    WHERE bs.design_fingerprint IS NOT NULL
      AND bs.last_successful_publication_id IS NOT NULL
      AND bs.brand_id IS DISTINCT FROM p_brand_id
      AND bs.design_fingerprint->>'format' = p_format
    ORDER BY bs.id
    LIMIT 500
  ) s;
$function$;

CREATE OR REPLACE FUNCTION public.brand_site_record_fingerprint(p_site_id uuid, p_fingerprint jsonb)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_site_id IS NULL OR p_fingerprint IS NULL OR jsonb_typeof(p_fingerprint) <> 'object'
     OR octet_length(p_fingerprint::text) > 4096
     -- IS DISTINCT FROM: a MISSING key (NULL typeof) is refused too, so '{}' never wipes the stored look.
     OR jsonb_typeof(p_fingerprint->'design') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_fingerprint->'format') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p_fingerprint->'home') IS DISTINCT FROM 'array'
     -- An allowlist, not a denylist: any key outside the seven is refused.
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_fingerprint) k
                WHERE k NOT IN ('design', 'format', 'header', 'hero', 'home', 'fonts', 'colors'))
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_fingerprint->'home') h WHERE jsonb_typeof(h) <> 'string')
     OR COALESCE(jsonb_typeof(p_fingerprint->'header'), 'null') NOT IN ('string', 'null')
     OR COALESCE(jsonb_typeof(p_fingerprint->'hero'), 'null') NOT IN ('string', 'null')
     OR COALESCE(jsonb_typeof(p_fingerprint->'fonts'), 'null') NOT IN ('string', 'null')
     OR COALESCE(jsonb_typeof(p_fingerprint->'colors'), 'null') NOT IN ('string', 'null') THEN
    RETURN false;
  END IF;
  -- Store only the allowed keys, rebuilt key by key (nulls dropped).
  UPDATE public.brand_sites SET design_fingerprint = jsonb_strip_nulls(jsonb_build_object(
      'design', p_fingerprint->'design', 'format', p_fingerprint->'format',
      'header', p_fingerprint->'header', 'hero', p_fingerprint->'hero',
      'home', p_fingerprint->'home', 'fonts', p_fingerprint->'fonts', 'colors', p_fingerprint->'colors'))
  WHERE id = p_site_id;
  RETURN FOUND;
END;
$function$;

-- ── 6. Build receives the owner's own Q5-Q8 answers ────────────────────────
-- Re-issued from 20280807014453; the only change is the four answer keys.
CREATE OR REPLACE FUNCTION public.brand_site_plan_authorize_compose(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_plan public.brand_site_plans%ROWTYPE;
  v_site public.brand_sites%ROWTYPE;
  v_brand public.brands%ROWTYPE;
  v_status jsonb;
BEGIN
  PERFORM public.brand_site_plan_gate(p_brand_id, 50);
  SELECT * INTO v_plan FROM public.brand_site_plans WHERE brand_id = p_brand_id FOR UPDATE;
  IF v_plan.brand_id IS NULL OR v_plan.approved_at IS NULL
    OR v_plan.offerings_selected IS NULL THEN RAISE EXCEPTION 'sites_plan_not_ready'; END IF;
  IF v_plan.lock_holder IS NOT NULL AND v_plan.lock_expires_at > now()
    AND v_plan.lock_holder <> v_actor THEN RAISE EXCEPTION 'sites_plan_locked'; END IF;
  v_status := public.brand_site_plan_status_internal(p_brand_id);
  IF EXISTS (
    -- #4453 — the required parts BY KEY (never by position): an optional
    -- part ('proof', 'first_offering') may sit anywhere and never blocks.
    SELECT 1 FROM unnest(public.brand_site_plan_build_required_parts()) AS required(key)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_status->'parts') AS p(value)
      WHERE p.value->>'key' = required.key AND COALESCE((p.value->>'done')::boolean,false)
    )
  ) OR COALESCE((public.brand_context_completeness_internal(p_brand_id)->>'context_complete')::boolean,false) = false
  THEN RAISE EXCEPTION 'sites_plan_not_ready'; END IF;
  SELECT * INTO v_site FROM public.brand_sites WHERE brand_id = p_brand_id;
  IF v_site.id IS NULL OR v_site.status IN ('provisioning','error') THEN
    RAISE EXCEPTION 'sites_invalid_state';
  END IF;
  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id;
  RETURN jsonb_build_object(
    'site_id',v_site.id,'brand_id',p_brand_id,'revision',v_plan.revision,
    'design_key',COALESCE(v_plan.design_key,v_site.design_key,'atelier'),
    'offerings_selected',to_jsonb(v_plan.offerings_selected),
    'venue_descriptor',v_plan.venue_descriptor,'story',v_plan.story,
    -- #4453 milestone 7 — the owner's own answers, verbatim (composer v2).
    'value_points',v_plan.value_points,'faq',v_plan.faq,
    'process_steps',v_plan.process_steps,'quick_facts',v_plan.quick_facts,
    'brand',jsonb_build_object(
      'name',v_brand.name,'description',v_brand.description,
      'contact_email',v_brand.contact_email,'contact_phone',v_brand.contact_phone,
      'city',v_brand.city,'country_code',v_brand.country_code,'address',v_brand.address,
      'social_links',v_brand.social_links,'profile_photo_url',v_brand.profile_photo_url,
      'cover_media_url',v_brand.cover_media_url,'cover_media_type',v_brand.cover_media_type,
      'cover_media_poster_url',v_brand.cover_media_poster_url));
END;
$function$;
REVOKE ALL ON FUNCTION public.brand_site_plan_authorize_compose(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_site_plan_authorize_compose(uuid)
  TO authenticated, service_role;

-- ── Grants: service role only ──────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.brand_site_flag_on(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_flag_on(text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_compose_facts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_compose_facts(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_live_fingerprints(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_live_fingerprints(text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.brand_site_record_fingerprint(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_record_fingerprint(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.brand_site_flag_on(text, uuid) IS
  '#4453 M7 — SITES_ARI_DESIGN_PASS / SITES_STYLE_LIBRARY: on globally, or the brand is in brand_site_flag_brands. Service role only.';
COMMENT ON FUNCTION public.brand_site_compose_facts(uuid) IS
  '#4453 M7 — counts and booleans composer v2 needs (verified venues per category, reservations, menu, live stays, Mingla review count). No names, prices or guest data. Service role only.';
COMMENT ON FUNCTION public.brand_site_live_fingerprints(text, uuid) IS
  '#4453 M7 — design fingerprints of OTHER brands'' live sites of one format (no brand ids). Look-alike warning only. Service role only.';
COMMENT ON FUNCTION public.brand_site_record_fingerprint(uuid, jsonb) IS
  '#4453 M7 — stores the design-pass fingerprint Studio computed for one site. Service role only.';

COMMIT;
