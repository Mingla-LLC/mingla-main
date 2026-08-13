-- issue #2010 — restore lossless poster hydration for published-event editing.
--
-- Re-publishes the latest business_management_events_view definition from
-- issue #868 with one additive delta: cover_media_poster_url is appended LAST.
-- Existing column order, security_invoker mode, grants, filters, joins, and the
-- public/Explorer/share read surfaces remain unchanged.

BEGIN;

CREATE OR REPLACE VIEW public.business_management_events_view
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.brand_id,
  e.created_by,
  b.slug AS brand_slug,
  b.name AS brand_name,
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
  (e.theme - 'business_draft') AS management_theme,
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
  e.location_geo,
  e.theme_color_override,
  e.theme_font_override,
  e.theme_animation_override,
  e.cover_media_gallery,
  e.cover_media_poster_url
FROM public.events e
JOIN public.brands b ON b.id = e.brand_id
LEFT JOIN public.event_dates ed
  ON ed.event_id = e.id AND ed.is_master = true
WHERE e.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND e.status IN ('scheduled', 'live', 'ended', 'cancelled');

GRANT SELECT ON public.business_management_events_view TO authenticated, service_role;
REVOKE SELECT ON public.business_management_events_view FROM anon;

COMMENT ON VIEW public.business_management_events_view IS
  'issue-2010: lossless management hydration for the authoritative event poster. Additive over issue #868; no existing column removed or reordered.';

NOTIFY pgrst, 'reload schema';

COMMIT;
