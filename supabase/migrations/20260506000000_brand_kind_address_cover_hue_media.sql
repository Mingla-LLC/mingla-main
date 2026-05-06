-- Cycle 17e-A — adds 6 brand columns enabling persistent CRUD wiring + 17e-B Tier 2 schema pre-load.
--
-- Closes brandMapping.ts:184-191 TRANSITIONAL marker (Cycle 7 v10 + Cycle 7 FX2 v11 carry-forward).
-- Pre-loads 17e-B Tier 2 schema (cover_media_url + cover_media_type + profile_photo_type) so
-- the future Giphy/Pexels/upload picker UI cycle is UI-only.
--
-- Mirrors the events table cover_media shape (events.cover_media_url + events.cover_media_type
-- with CHECK ('image','video','gif') exactly).
--
-- No backfill required — existing rows (if any) get safe defaults at migration time.
-- No new RLS policies — existing INSERT/UPDATE/DELETE/SELECT policies cover new columns implicitly.
-- No new indexes — existing idx_brands_account_id + idx_brands_slug_active sufficient.
--
-- SPEC anchor: Mingla_Artifacts/specs/SPEC_BIZ_CYCLE_17E_A_BRAND_CRUD_WIRING.md §3.1.1
-- Forensics anchor: Mingla_Artifacts/reports/INVESTIGATION_BIZ_CYCLE_17E_A_BRAND_CRUD_WIRING.md F-C

ALTER TABLE public.brands
  ADD COLUMN kind text NOT NULL DEFAULT 'popup'
    CHECK (kind IN ('physical', 'popup')),
  ADD COLUMN address text,
  ADD COLUMN cover_hue integer NOT NULL DEFAULT 25
    CHECK (cover_hue >= 0 AND cover_hue < 360),
  ADD COLUMN cover_media_url text,
  ADD COLUMN cover_media_type text
    CHECK (cover_media_type IS NULL OR cover_media_type IN ('image','video','gif')),
  ADD COLUMN profile_photo_type text
    CHECK (profile_photo_type IS NULL OR profile_photo_type IN ('image','video','gif'));

COMMENT ON COLUMN public.brands.kind IS
  'Cycle 7 v10 — physical brand owns/leases venue (renders address); popup operates across multiple venues. Default popup (safer, no fake address shown).';
COMMENT ON COLUMN public.brands.address IS
  'Cycle 7 v10 — public-facing address for physical brands. Free-form. NULL when popup OR not yet shared.';
COMMENT ON COLUMN public.brands.cover_hue IS
  'Cycle 7 FX2 v11 — gradient hue for public brand page hero (0-359). Defaults to 25 (warm orange = accent.warm). Fallback when cover_media_url IS NULL.';
COMMENT ON COLUMN public.brands.cover_media_url IS
  'Cycle 17e-A schema pre-load for 17e-B Tier 2 — Supabase storage URL OR Giphy/Pexels URL. NULL falls back to cover_hue gradient.';
COMMENT ON COLUMN public.brands.cover_media_type IS
  'Cycle 17e-A schema pre-load — image/video/gif. NULL when cover_media_url IS NULL.';
COMMENT ON COLUMN public.brands.profile_photo_type IS
  'Cycle 17e-A schema pre-load (Q1=B amendment) — image/video/gif. NULL allowed. Existing profile_photo_url defaults to image semantics when type IS NULL.';
