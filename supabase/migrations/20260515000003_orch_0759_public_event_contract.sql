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
  (e.theme - 'business_draft') AS public_theme
FROM public.events e
JOIN public.brands b ON b.id = e.brand_id
WHERE
  e.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND e.visibility = 'public'
  AND e.status IN ('scheduled', 'live');

GRANT SELECT ON public.business_public_events_view TO anon, authenticated, service_role;

COMMENT ON VIEW public.business_public_events_view IS
  'ORCH-0759: public buyer-facing event read model. Excludes theme.business_draft and organiser-private draft metadata.';
