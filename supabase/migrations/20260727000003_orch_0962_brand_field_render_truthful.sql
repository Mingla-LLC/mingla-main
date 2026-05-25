-- ORCH-0962 [Brand-edit -> public-brand field rendering truthful bundle].
-- Restores public read truth for contact fields, brand-in-event identity, and
-- verified-venue attendee-count mapping inputs. No edge functions in scope.

BEGIN;

-- Postgres cannot insert view columns in the middle with CREATE OR REPLACE.
-- Remote dependency probe found no dependent views, so drop/recreate preserves
-- the SPEC's logical SELECT order and restores grants below in the same txn.
DROP VIEW IF EXISTS public.business_public_events_view;
DROP VIEW IF EXISTS public.claimed_venues_public_view;
DROP VIEW IF EXISTS public.business_public_brands_view;

CREATE OR REPLACE VIEW public.business_public_brands_view AS
SELECT
  id,
  slug,
  name,
  description,
  profile_photo_url,
  contact_email,
  contact_phone,
  social_links,
  custom_links,
  display_attendee_count,
  kind,
  address,
  cover_hue,
  cover_media_url,
  cover_media_type,
  profile_photo_type,
  created_at,
  updated_at
FROM public.brands b
WHERE deleted_at IS NULL
  AND (
    (kind = ANY (ARRAY['popup'::text, 'trip_planner'::text]))
    OR (kind = 'physical'::text AND claim_status = 'verified'::text)
  );

COMMENT ON VIEW public.business_public_brands_view IS
  'ORCH-0962: public brand read model includes contact_email/contact_phone for truthful /b/{brandSlug} rendering; physical brands only when claim_status=verified.';

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
  b.kind,
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
  AND b.kind = 'physical'::text
  AND b.claim_status = 'verified'::text;

COMMENT ON VIEW public.claimed_venues_public_view IS
  'ORCH-0962: verified-venue public read model includes contact fields and display_attendee_count for truthful public mapping.';

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
  b.kind AS brand_kind,
  b.address AS brand_address,
  b.cover_media_url AS brand_cover_media_url,
  e.title,
  e.description,
  e.slug,
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
  'ORCH-0962: public buyer-page view preserves ORCH-0824 columns and adds truthful brand kind/address/cover fields for event-detail brand context.';

GRANT SELECT ON public.business_public_brands_view TO anon, authenticated, service_role;
GRANT SELECT ON public.claimed_venues_public_view TO anon, authenticated, service_role;
GRANT SELECT ON public.business_public_events_view TO anon, authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
