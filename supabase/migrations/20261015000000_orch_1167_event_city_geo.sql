-- ORCH-1167 [event-page-canonical] — Migration 1: city-level privacy geo field.
--
-- Leg 1 of META-ORCH-1166 (public offering-page single source of truth).
--
-- WHAT: add `public.events.city_geo geometry(Point,4326)` — a CITY-LEVEL centroid
-- (privacy-safe location) distinct from the EXACT `location_geo point` venue pin.
-- The canonical standard-event public page renders a city-level map (no exact pin)
-- when the brand hides the street until ticket purchase; the exact pin renders only
-- when the address is public. See SPEC §4A.
--
-- SAFE-MIGRATION PROTOCOL:
--   • Additive, NULLable, DEFAULT NULL — 77/89 existing event rows stay NULL → the
--     map simply does not render (Constitution rule 9: missing is hidden, never
--     fabricated). No backfill (OQ-1: city centroid is derived at the publish /
--     address-write path going forward; existing rows render the text venue card).
--   • The `CREATE OR REPLACE VIEW` mirrors the existing view column list VERBATIM
--     and appends ONLY `e.city_geo` at the END (CREATE OR REPLACE VIEW requires new
--     columns last; existing columns keep name/type/order). No column is
--     dropped/reordered → no PostgREST contract break for existing readers.
--   • `security_invoker=false` preserved (anon reads run as the view owner).
--
-- DO NOT auto-apply. The orchestrator/Seth applies via the Supabase Management API
-- after review (migrations are spec-only in this leg — SPEC §13).

-- ── 1. additive column ──────────────────────────────────────────────────────
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS city_geo geometry(Point, 4326);

COMMENT ON COLUMN public.events.city_geo IS
  'ORCH-1167 — CITY-LEVEL centroid (privacy-safe). NULLable; distinct from the '
  'exact location_geo venue pin. Used by the canonical event public page to draw '
  'a city-level map (no exact pin) when hide_address_until_ticket is set and the '
  'viewer is anonymous. Derived at the publish/address-write path from the city '
  'centroid (NOT the street point); NULL when the city is unknown (rule 9).';

-- ── 2. expose city_geo on the anon-safe public read view ─────────────────────
-- Mirrors the ORCH-1150 view column list VERBATIM, appending ONLY e.city_geo
-- (right after e.location_geo) so the new pg_public_event_by_slug RPC + the
-- consumer theme/card reads can surface the city-level centroid.
BEGIN;

CREATE OR REPLACE VIEW public.business_public_events_view AS
  SELECT e.id,
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
    (e.theme - 'business_draft'::text) AS public_theme,
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
    e.location_geo,
    COALESCE(e.pass_tax,         b.default_pass_tax)         AS pass_tax,
    COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
    COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
    b.pricing_region   AS pricing_region,
    b.pricing_currency AS pricing_currency,
    (e.pricing_locked_at IS NOT NULL) AS pricing_locked,
    (
      SELECT public.compute_all_in_cents(
               MIN(tt.price_cents),
               COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee),
               COALESCE(e.pass_service_fee, b.default_pass_service_fee),
               (SELECT r.effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id) r)
             )
      FROM public.ticket_types tt
      WHERE tt.event_id = e.id
        AND tt.price_cents > 0
        AND tt.deleted_at IS NULL
    ) AS display_price_cents,
    -- ORCH-1150 RSVP host-control columns (inert for non-RSVP rows).
    e.rsvp_discoverable,
    e.rsvp_capacity,
    e.rsvp_allow_plus_ones,
    e.rsvp_plus_ones_max,
    e.rsvp_waitlist_enabled,
    e.rsvp_approval_mode,
    (
      SELECT COALESCE(SUM(1 + r.plus_count), 0)::integer
      FROM public.event_rsvps r
      WHERE r.event_id = e.id
        AND r.rsvp_status = 'going'
        AND r.approval_status = 'approved'
    ) AS rsvp_going_count,
    -- ORCH-1167 — city-level privacy centroid. Appended LAST: CREATE OR REPLACE VIEW
    -- requires new columns at the END of the column list (existing columns keep name,
    -- type AND order). location_geo (the exact pin) is unchanged at its position.
    e.city_geo
   FROM events e
     JOIN brands b ON b.id = e.brand_id
     LEFT JOIN event_dates ed ON ed.event_id = e.id AND ed.is_master = true
  WHERE e.deleted_at IS NULL
    AND b.deleted_at IS NULL
    AND e.visibility = 'public'::text
    AND (e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text]));

ALTER VIEW public.business_public_events_view SET (security_invoker = false);

COMMIT;

NOTIFY pgrst, 'reload schema';
