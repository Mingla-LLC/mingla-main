-- issue #1039 — Editor shows brand-default instead of a published offering's
-- saved theme colour (management-view read-back gap).
--
-- Root cause: ORCH-0964 (20260729000002_orch_0964_brand_event_theme_columns.sql)
-- added the three `theme_*_override` columns to the events table AND to
-- `business_public_events_view`, but left `business_management_events_view`
-- untouched. That management view is what the edit screen reads
-- (`fetchBusinessEventById` / `fetchBusinessEventsForBrand`,
-- BUSINESS_EVENT_SELECT = "*"), so the editor's seed reads `undefined` for the
-- three columns -> normalises to `null` -> the Theme control renders
-- brand-default even when the row holds a real override. The saved colour is
-- safe in the table and correct on the public buyer page; only the editor's
-- read-back was blind. This is the SAME bug class ORCH-0824 documented: the
-- views explicitly enumerate columns rather than `SELECT e.*`, so a later
-- column addition is not auto-picked-up.
--
-- Fix: reproduce the current (ORCH-0824) management-view SELECT VERBATIM and
-- append the three override columns after `e.location_geo` — mirroring the
-- ORCH-0964 public-view precedent exactly. Purely additive and idempotent
-- (CREATE OR REPLACE, no column removed or reordered; new columns at the end so
-- positional consumers keep working). No client change is required — the client
-- mapper (`eventFromRow -> themeOverridesFromColumns`) already reads these
-- columns and wakes up the moment the view returns them, on BOTH read paths.
--
-- Live def verified byte-for-byte against pg_get_viewdef('public.business_management_events_view')
-- on prod (gqnoajqerqhnvulmnyvv, 2026-07-21): 41 columns, ending at e.location_geo,
-- security_invoker=true, anon SELECT revoked.
--
-- DOES NOT TOUCH: business_public_events_view (already correct), any other
-- object, or any existing column.

BEGIN;

-- Rebuild business_management_events_view with the three issue-1039 theme
-- override columns appended. Column order preserved; new columns at the end.
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
  -- ORCH-0824 additions (retained verbatim)
  e.city,
  e.party_types,
  e.vibe_tags,
  e.music_genres,
  e.location_geo,
  -- issue #1039 additions (mirror the ORCH-0964 public-view precedent)
  e.theme_color_override,
  e.theme_font_override,
  e.theme_animation_override
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
  'issue-1039: ORCH-0824 def + theme_color/font/animation_override so the editor hydrates a published offering''s saved theme. Additive over ORCH-0824; no column removed or reordered.';

COMMIT;

NOTIFY pgrst, 'reload schema';
