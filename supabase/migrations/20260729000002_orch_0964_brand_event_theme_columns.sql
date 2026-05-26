-- ORCH-0964 [Public-page theme customization + consumer brand screen].
-- Adds typed theme columns to brands/events and exposes them through the
-- canonical public views. Theme data must never be stored in events.theme JSONB.

BEGIN;

ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS theme_color text,
  ADD COLUMN IF NOT EXISTS theme_font text,
  ADD COLUMN IF NOT EXISTS theme_animation text;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS theme_color_override text,
  ADD COLUMN IF NOT EXISTS theme_font_override text,
  ADD COLUMN IF NOT EXISTS theme_animation_override text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'brands_theme_color_hex_chk'
  ) THEN
    ALTER TABLE public.brands
      ADD CONSTRAINT brands_theme_color_hex_chk
      CHECK (theme_color IS NULL OR theme_color ~* '^#[0-9a-f]{6}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'brands_theme_font_whitelist_chk'
  ) THEN
    ALTER TABLE public.brands
      ADD CONSTRAINT brands_theme_font_whitelist_chk
      CHECK (theme_font IS NULL OR theme_font IN (
        'inter','poppins','space_grotesk','plus_jakarta_sans','manrope',
        'playfair_display','dm_serif_display','fraunces','lora',
        'bebas_neue','anton','unbounded','caveat','dancing_script'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'brands_theme_animation_whitelist_chk'
  ) THEN
    ALTER TABLE public.brands
      ADD CONSTRAINT brands_theme_animation_whitelist_chk
      CHECK (theme_animation IS NULL OR theme_animation IN (
        'none','confetti','fireworks','balloons','sparkles',
        'glitter_shower','snowfall','falling_petals','hearts','shimmer_reveal'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_theme_color_override_hex_chk'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_theme_color_override_hex_chk
      CHECK (theme_color_override IS NULL OR theme_color_override ~* '^#[0-9a-f]{6}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_theme_font_override_whitelist_chk'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_theme_font_override_whitelist_chk
      CHECK (theme_font_override IS NULL OR theme_font_override IN (
        'inter','poppins','space_grotesk','plus_jakarta_sans','manrope',
        'playfair_display','dm_serif_display','fraunces','lora',
        'bebas_neue','anton','unbounded','caveat','dancing_script'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_theme_animation_override_whitelist_chk'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_theme_animation_override_whitelist_chk
      CHECK (theme_animation_override IS NULL OR theme_animation_override IN (
        'none','confetti','fireworks','balloons','sparkles',
        'glitter_shower','snowfall','falling_petals','hearts','shimmer_reveal'
      ));
  END IF;
END $$;

-- Postgres cannot insert view columns in the middle with CREATE OR REPLACE.
-- Recreate the ORCH-0962/0963 public read-model views with additive theme fields.
DROP VIEW IF EXISTS public.business_public_events_view;
DROP VIEW IF EXISTS public.claimed_venues_public_view;
DROP VIEW IF EXISTS public.business_public_brands_view;

CREATE OR REPLACE VIEW public.business_public_brands_view AS
SELECT
  b.id,
  b.slug,
  b.name,
  b.description,
  b.profile_photo_url,
  b.contact_email,
  b.contact_phone,
  b.social_links,
  b.custom_links,
  b.display_attendee_count,
  b.claim_status,
  b.address,
  b.cover_hue,
  b.cover_media_url,
  b.cover_media_type,
  b.profile_photo_type,
  b.theme_color,
  b.theme_font,
  b.theme_animation,
  b.created_at,
  b.updated_at
FROM public.brands b
WHERE b.deleted_at IS NULL;

COMMENT ON VIEW public.business_public_brands_view IS
  'ORCH-0964: public brand read model includes typed theme columns for buyer-web and consumer brand screens.';

CREATE OR REPLACE VIEW public.claimed_venues_public_view
  WITH (security_invoker = true) AS
SELECT
  b.id,
  b.name,
  b.slug,
  b.description,
  b.profile_photo_url,
  b.profile_photo_type,
  b.contact_email,
  b.contact_phone,
  b.social_links,
  b.custom_links,
  b.display_attendee_count,
  b.default_currency,
  b.address,
  b.city,
  b.country_code,
  b.lat,
  b.lng,
  b.cover_hue,
  b.cover_media_url,
  b.cover_media_type,
  b.theme_color,
  b.theme_font,
  b.theme_animation,
  b.claim_status,
  b.venue_category,
  b.place_pool_id,
  b.google_place_id,
  b.created_at,
  b.updated_at,
  (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'weekday', bh.weekday,
          'open_time', to_char(bh.open_time::interval, 'HH24:MI'),
          'close_time', to_char(bh.close_time::interval, 'HH24:MI'),
          'is_closed', bh.is_closed
        )
        ORDER BY bh.weekday
      ),
      '[]'::jsonb
    )
    FROM public.brand_hours bh
    WHERE bh.brand_id = b.id
  ) AS hours,
  pp.stored_photo_urls AS pool_photo_urls
FROM public.brands b
LEFT JOIN public.place_pool pp ON pp.id = b.place_pool_id
WHERE b.deleted_at IS NULL
  AND b.claim_status = 'verified'::text;

COMMENT ON VIEW public.claimed_venues_public_view IS
  'ORCH-0964: verified-venue public read model includes typed theme columns.';

CREATE OR REPLACE VIEW public.business_public_events_view
  WITH (security_invoker = true) AS
SELECT
  e.id,
  e.brand_id,
  b.slug AS brand_slug,
  b.name AS brand_name,
  b.description AS brand_description,
  b.profile_photo_url AS brand_profile_photo_url,
  b.display_attendee_count AS brand_display_attendee_count,
  b.address AS brand_address,
  b.cover_media_url AS brand_cover_media_url,
  b.theme_color AS brand_theme_color,
  b.theme_font AS brand_theme_font,
  b.theme_animation AS brand_theme_animation,
  e.title,
  e.description,
  e.slug,
  e.event_type,
  e.location_text,
  e.online_url,
  e.is_online,
  e.is_recurring,
  e.is_multi_date,
  e.recurrence_rules,
  e.cover_media_url,
  e.cover_media_type,
  e.visibility,
  e.show_on_discover,
  e.status,
  e.published_at,
  e.timezone,
  e.created_at,
  e.updated_at,
  e.theme - 'business_draft'::text AS public_theme,
  e.theme_color_override,
  e.theme_font_override,
  e.theme_animation_override,
  e.currency,
  e.cover_media_provider,
  e.cover_media_source_url,
  e.cover_media_credit,
  e.cover_media_credit_url,
  e.cover_media_alt,
  ed.start_at AS master_start_at,
  ed.end_at AS master_end_at,
  ed.timezone AS master_timezone,
  ed.id AS master_event_date_id,
  e.city,
  e.party_types,
  e.vibe_tags,
  e.music_genres,
  e.location_geo
FROM public.events e
JOIN public.brands b ON b.id = e.brand_id
LEFT JOIN public.event_dates ed ON ed.event_id = e.id AND ed.is_master = true
WHERE e.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND e.visibility = 'public'::text
  AND (e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text]));

COMMENT ON VIEW public.business_public_events_view IS
  'ORCH-0964: public buyer-page event view exposes brand theme defaults and event-level theme override columns.';

GRANT SELECT ON public.business_public_brands_view TO anon, authenticated, service_role;
GRANT SELECT ON public.claimed_venues_public_view TO anon, authenticated, service_role;
GRANT SELECT ON public.business_public_events_view TO anon, authenticated, service_role;

COMMENT ON COLUMN public.brands.theme_color IS
  'ORCH-0964: nullable brand default theme color as 7-character hex.';
COMMENT ON COLUMN public.brands.theme_font IS
  'ORCH-0964: nullable brand default theme font slug from the approved whitelist.';
COMMENT ON COLUMN public.brands.theme_animation IS
  'ORCH-0964: nullable brand default entrance animation slug from the approved whitelist.';
COMMENT ON COLUMN public.events.theme_color_override IS
  'ORCH-0964: nullable per-event theme color override; NULL means inherit brand/default.';
COMMENT ON COLUMN public.events.theme_font_override IS
  'ORCH-0964: nullable per-event theme font override; NULL means inherit brand/default.';
COMMENT ON COLUMN public.events.theme_animation_override IS
  'ORCH-0964: nullable per-event theme animation override; NULL means inherit brand/default.';

COMMIT;

NOTIFY pgrst, 'reload schema';
