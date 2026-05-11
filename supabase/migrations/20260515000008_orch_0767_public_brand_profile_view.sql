-- ORCH-0767: public brand profile read model.
--
-- Public brand pages must render real, non-deleted brands even before the
-- brand has a public event. Keep event rows in business_public_events_view;
-- this view exposes only approved public profile fields.

CREATE OR REPLACE VIEW public.business_public_brands_view AS
SELECT
  b.id,
  b.slug,
  b.name,
  b.description,
  b.profile_photo_url,
  b.social_links,
  b.custom_links,
  b.display_attendee_count,
  b.kind,
  b.address,
  b.cover_hue,
  b.cover_media_url,
  b.cover_media_type,
  b.profile_photo_type,
  b.created_at,
  b.updated_at
FROM public.brands b
WHERE b.deleted_at IS NULL;

GRANT SELECT ON public.business_public_brands_view TO anon, authenticated, service_role;

COMMENT ON VIEW public.business_public_brands_view IS
  'ORCH-0767: field-limited public brand profile read model for /b/{brandSlug}; intentionally excludes account, contact, tax, Stripe, ownership, and deleted/internal fields.';
