-- ORCH-0824 HOTFIX — Surface new taxonomy + city columns through the
-- two management/public views that mingla-business consumes for the
-- event-list and edit screens.
--
-- Background: the original ORCH-0792 views (business_management_events_view
-- and business_public_events_view) explicitly enumerate columns from
-- `events` rather than `SELECT events.*`. When ORCH-0824 added `city`,
-- `party_types`, `vibe_tags`, `music_genres` as new top-level columns,
-- the views did not auto-pick them up — so the edit-existing-event flow
-- loaded a LiveEvent missing the new fields and crashed the wizard
-- validator on `partyTypes.length`.
--
-- Fix: append the 4 new columns to both views. No removed columns; this
-- is purely additive and idempotent (CREATE OR REPLACE).
--
-- Sister event (business_public_events_view) needs the same so the buyer
-- /e/{brandSlug}/{eventSlug} page can surface the taxonomy too (future
-- buyer-page UX work, ORCH-0824-B+).
--
-- See: Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER_v2.md
--      Operator-reported crash 2026-05-13 in EditPublishedScreen.

BEGIN;

-- Rebuild business_management_events_view with the four ORCH-0824 columns
-- appended. Column order preserved through the brand JOIN; new columns
-- at the end so positional consumers (if any) keep working.
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
  -- ORCH-0824 additions
  e.city,
  e.party_types,
  e.vibe_tags,
  e.music_genres,
  e.location_geo
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
  'ORCH-0824 hotfix: replaces ORCH-0792 definition. Adds city, party_types, vibe_tags, music_genres, location_geo columns to the management view so the edit-event flow reads structured taxonomy + city back from the DB without round-trip data loss.';

-- Rebuild business_public_events_view with the same additions. Anon
-- consumers (buyer page) can read these — RLS at table level already
-- restricts to visibility='public' AND status IN ('scheduled','live'),
-- which the WHERE clause re-asserts as defense-in-depth.
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
  (e.theme - 'business_draft') AS public_theme,
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
  -- ORCH-0824 additions
  e.city,
  e.party_types,
  e.vibe_tags,
  e.music_genres,
  e.location_geo
FROM public.events e
JOIN public.brands b ON b.id = e.brand_id
LEFT JOIN public.event_dates ed
  ON ed.event_id = e.id AND ed.is_master = true
WHERE e.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND e.visibility = 'public'
  AND e.status IN ('scheduled', 'live', 'ended', 'cancelled');

GRANT SELECT ON public.business_public_events_view TO anon, authenticated, service_role;

COMMENT ON VIEW public.business_public_events_view IS
  'ORCH-0824 hotfix: replaces ORCH-0792 definition. Adds city + taxonomy + location_geo columns to the public buyer-page view.';

COMMIT;

NOTIFY pgrst, 'reload schema';
