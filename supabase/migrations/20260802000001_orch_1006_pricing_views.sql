-- ORCH-1006 [Universal all-in pricing engine] — public view exposure (WYSIWYP).
-- ===================================================================
-- Re-creates business_public_events_view to add the ORCH-1006 columns the client
-- needs for WYSIWYP, WITHOUT changing any existing column the consumers already
-- read. The body below is the LIVE view definition (captured from the linked
-- remote 2026-05-29) with ONLY these additions appended at the end of the SELECT:
--   - pass_tax / pass_mingla_fee / pass_service_fee (resolved switches)
--   - pricing_region / pricing_currency
--   - pricing_locked (boolean)
--   - display_price_cents (lowest-tier ALL-IN; engine SQL mirror)
-- The negotiated take-rate columns are NOT added (they are not in the base
-- select; the view already only flattens an explicit brand column list, so the
-- sensitive take-rate columns are never exposed — amendment §A.7 satisfied by
-- construction, no to_jsonb blob).
--
-- Collision-checked: prefix 20260802000001 > max(20260802000000 this ORCH,
-- 20260801000002 sibling worktrees).
BEGIN;

-- SQL mirror of the engine's SQL-computable all-in (no Stripe round-trip).
-- GB VAT is inclusive so it does NOT add to the headline number; only the
-- passed Mingla fee + passed service fee gross up the SQL display price.
-- Keep MINGLA_SERVICE_FEE_BPS_SQL (300) in lockstep with
-- _shared/allInPricingEngine.ts MINGLA_SERVICE_FEE_BPS.
CREATE OR REPLACE FUNCTION public.compute_all_in_cents(
  p_base_cents integer,
  p_pass_mingla_fee boolean,
  p_pass_service_fee boolean,
  p_effective_take_rate_bps integer,
  p_service_fee_bps integer DEFAULT 300
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(0, COALESCE(p_base_cents, 0))
    + CASE WHEN p_pass_mingla_fee
           THEN round(GREATEST(0, COALESCE(p_base_cents,0))::numeric * COALESCE(p_effective_take_rate_bps,0) / 10000)::integer
           ELSE 0 END
    + CASE WHEN p_pass_service_fee
           THEN round(GREATEST(0, COALESCE(p_base_cents,0))::numeric * COALESCE(p_service_fee_bps,300) / 10000)::integer
           ELSE 0 END;
$$;

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
    -- ORCH-1006 additions (resolved pass/absorb switches + region/currency).
    COALESCE(e.pass_tax,         b.default_pass_tax)         AS pass_tax,
    COALESCE(e.pass_mingla_fee,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
    COALESCE(e.pass_service_fee, b.default_pass_service_fee) AS pass_service_fee,
    b.pricing_region   AS pricing_region,
    b.pricing_currency AS pricing_currency,
    (e.pricing_locked_at IS NOT NULL) AS pricing_locked,
    -- ORCH-1006: lowest-tier ALL-IN display price (WYSIWYP). NULL when no active
    -- priced tier → client falls back to the bare price (legacy/free safe).
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
    ) AS display_price_cents
   FROM events e
     JOIN brands b ON b.id = e.brand_id
     LEFT JOIN event_dates ed ON ed.event_id = e.id AND ed.is_master = true
  WHERE e.deleted_at IS NULL
    AND b.deleted_at IS NULL
    AND e.visibility = 'public'::text
    AND (e.status = ANY (ARRAY['scheduled'::text, 'live'::text, 'ended'::text, 'cancelled'::text]));

-- Preserve the ORCH-0964 security-definer posture (COMMS-0009): anon reaches the
-- view without direct brands-table access. ALTER VIEW is idempotent / re-runnable.
ALTER VIEW public.business_public_events_view SET (security_invoker = false);

COMMIT;
