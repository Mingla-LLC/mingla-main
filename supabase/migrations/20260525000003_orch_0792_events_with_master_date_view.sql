-- ORCH-0792: surface master event_dates timing on the views consumed by the
-- organiser app (business_management_events_view) and the public buyer page
-- (business_public_events_view).
--
-- Both views are LEFT JOINed to event_dates filtered to is_master=true so
-- pre-publish drafts (no event_dates row) still surface with NULL master_*.
-- The partial unique index event_dates_master_unique guarantees the LEFT
-- JOIN produces at most one master row per event.
--
-- Also creates a lower-level `events_with_master_date_view` for any future
-- consumer that wants the raw events row plus master_* columns without the
-- business_*_view brand JOIN.
--
-- Post-ORCH-0792, organiser app + public page reads stop sourcing dates
-- from theme.business_event.when JSON (the prior workaround) and start
-- sourcing from the master_* columns. CI gate
-- orch-0792-no-published-event-theme-reads enforces this.
--
-- See: Mingla_Artifacts/specs/SPEC_ORCH-0792_EVENTS_WITHOUT_DATES.md §4.4

BEGIN;

-- Low-level view for any future consumer.
CREATE OR REPLACE VIEW public.events_with_master_date_view
WITH (security_invoker = true) AS
SELECT
  e.*,
  ed.start_at AS master_start_at,
  ed.end_at AS master_end_at,
  ed.timezone AS master_timezone,
  ed.id AS master_event_date_id
FROM public.events e
LEFT JOIN public.event_dates ed
  ON ed.event_id = e.id AND ed.is_master = true;

COMMENT ON VIEW public.events_with_master_date_view IS
  'ORCH-0792: events left-joined with their master event_dates row. Use this for post-publish date reads. Promotes I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY.';

-- Rebuild business_management_events_view (supersedes ORCH-0783 definition)
-- with master_* columns appended. Column order preserved through the brand
-- JOIN; new columns added at the end so existing column-positional consumers
-- (if any) continue to work.
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
  -- ORCH-0792 additions
  ed.start_at AS master_start_at,
  ed.end_at AS master_end_at,
  ed.timezone AS master_timezone,
  ed.id AS master_event_date_id
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
  'ORCH-0792: management view with master_* event date columns. Replaces ORCH-0783 definition.';

-- Rebuild business_public_events_view with master_* columns appended.
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
  -- ORCH-0792 additions
  ed.start_at AS master_start_at,
  ed.end_at AS master_end_at,
  ed.timezone AS master_timezone,
  ed.id AS master_event_date_id
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
  'ORCH-0792: public buyer-page view with master_* event date columns. Replaces ORCH-0783 definition.';

COMMIT;

NOTIFY pgrst, 'reload schema';
