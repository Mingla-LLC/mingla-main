-- META-ORCH-1290 M1 (D-6 public page) — expose the owner-authored pitch on the
-- anon public venue page. The pitch reuses place_pool.generative_summary (D-4,
-- no new column). venue_public_view is the ONLY anon read path for venue data
-- (I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE); it is verified-only + SECURITY
-- DEFINER, so adding generative_summary (owner-authored public-directory prose)
-- is within the anon-safe envelope — no new grant, no non-verified exposure.
--
-- A view whose SELECT list changes must be dropped + recreated (a plain
-- CREATE OR REPLACE VIEW can only add trailing columns AFTER the existing ones
-- and cannot reorder; DROP+CREATE keeps this unambiguous). The SELECT list below
-- is COPIED VERBATIM from 20261130000003_orch_1255_claim_rpcs_public_views.sql
-- (:990-1009) with exactly one addition: `pp.generative_summary AS pitch`,
-- sourced from the already-joined LEFT JOIN public.place_pool pp.
--
-- META-ORCH-1290 D-2 note: business signal scores are computed at APPROVE, never
-- at authoring — reverting the pitch surfacing hides the owner-authored pitch.

DROP VIEW IF EXISTS public.venue_public_view;

CREATE VIEW public.venue_public_view AS
SELECT
  v.id, v.brand_id, b.slug AS brand_slug, b.name AS brand_name,
  v.slug, v.name, v.address, v.city, v.country_code, v.lat, v.lng,
  v.venue_category, v.google_place_id, v.contact_email, v.contact_phone,
  v.cover_media_url, v.cover_media_type, v.place_pool_id,
  b.theme_color, b.theme_font, b.theme_animation, b.cover_hue,
  b.default_currency,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'weekday', bh.weekday,
      'open_time', to_char(bh.open_time::interval, 'HH24:MI'),
      'close_time', to_char(bh.close_time::interval, 'HH24:MI'),
      'is_closed', bh.is_closed) ORDER BY bh.weekday), '[]'::jsonb)
     FROM public.brand_hours bh WHERE bh.venue_id = v.id) AS hours,
  pp.stored_photo_urls AS pool_photo_urls,
  -- META-ORCH-1290 M1 (D-6): the owner-authored pitch (generative_summary),
  -- anon-safe public-directory text on the already verified-only view.
  pp.generative_summary AS pitch,
  v.created_at, v.updated_at
FROM public.venue_listings v
JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
LEFT JOIN public.place_pool pp ON pp.id = v.place_pool_id
WHERE v.claim_status = 'verified';

-- security_invoker stays FALSE (definer) per the 20260731000000 ruling —
-- explicit so a future default change cannot flip it.
ALTER VIEW public.venue_public_view SET (security_invoker = false);

GRANT SELECT ON public.venue_public_view TO anon, authenticated;

COMMENT ON VIEW public.venue_public_view IS
  'META-ORCH-1255 M4 (D-2): the ONLY anon read path for venue data '
  '(I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE). SECURITY DEFINER (20260731000000 '
  'ruling); WHERE claim_status=''verified'' + non-deleted brand scope the rows. '
  'pending_review/rejected/suspended/revoked venues are INVISIBLE here; no '
  'Stripe/account columns cross the view. Serves /b/{brandSlug}/v/{venueSlug}. '
  'META-ORCH-1290: + pitch (generative_summary), anon-safe public-directory text.';
