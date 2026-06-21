-- ===========================================================================
-- META-ORCH-1186 Leg 3 (ORCH-1186-C) — venue MENU builder + public menu schema.
-- ---------------------------------------------------------------------------
-- Two NEW persistent assets — `public.menus` (a named menu/category group) and
-- `public.menu_items` (priced items under a group) — for the DISPLAY-ONLY venue
-- menu. Distinct from the snap-menu Gemini parser (parse-restaurant-menu /
-- experience_stops): this menu is MANUALLY authored and never touches that path.
--
-- DISPLAY-ONLY (DEC-C): there is NO ordering/cart/checkout/payment surface in
-- this leg. The tables carry price + currency for DISPLAY; no order/line-item
-- table exists.
--
-- Additive-only. All objects guarded (CREATE TABLE IF NOT EXISTS / CREATE INDEX
-- IF NOT EXISTS / DROP POLICY IF EXISTS before CREATE POLICY / CREATE OR REPLACE
-- VIEW). RLS ENABLED with the proven brand-member-read + manager-plus-write
-- gates (mirrors 20261003000000_orch_1148_venue_tables.sql exactly:
-- biz_is_brand_member_for_read_for_caller / biz_brand_effective_rank_for_caller
-- >= biz_role_rank('event_manager')). $function$ dollar-tag closed before GRANT
-- per the safe-migration protocol.
--
-- Public anon read via a SECURITY-DEFINER view (security_invoker=false) gated on
-- claim_status='verified' AND deleted_at IS NULL, mirroring
-- claimed_venues_public_view (20260731000000_orch_0964). Anon never touches the
-- brands table directly.
--
-- MONOTONIC VERSION: 20261118000000 is strictly greater than the current max
-- migration prefix across anchor main + all sibling worktrees. Verified at
-- IMPLEMENT 2026-06-21: max prefixes in use were 20261116000000 (orch_1186_a
-- hours / orch_1187 reconcile-checkouts in anchor) and 20261117000000
-- (orch_1186b venue intelligence). 20261118000000 > all.
--
-- DO NOT run `supabase db push`. Applied via the Supabase Management API after
-- REVIEW (CLI drift-wedged; MCP read-only by default). Mirrors venue_tables.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Table: public.menus  (a named menu/category group, e.g. "Dinner", "Drinks").
-- Single grouping level (categories ARE menus rows — OQ-1 resolved single-level).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.menus (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) > 0 AND length(name) <= 120),
  description text NULL CHECK (description IS NULL OR length(description) <= 500),
  sort_order  int  NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS menus_brand_id_idx
  ON public.menus (brand_id);
CREATE INDEX IF NOT EXISTS menus_brand_active_idx
  ON public.menus (brand_id) WHERE is_active;

-- ---------------------------------------------------------------------------
-- Table: public.menu_items  (priced items under a menus group).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.menu_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id      uuid NOT NULL REFERENCES public.menus(id) ON DELETE CASCADE,
  -- brand_id denormalized (in addition to menu_id) so RLS + the public view can
  -- scope by brand without a join, and a brand-scoped cascade deletes cleanly.
  -- The service MUST set brand_id on insert to match the parent menu's brand_id
  -- (a CHECK cannot cross-reference; integrity enforced by the service + view join).
  brand_id     uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(btrim(name)) > 0 AND length(name) <= 160),
  description  text NULL CHECK (description IS NULL OR length(description) <= 600),
  -- Price in MINOR units (cents / kobo). NULL = "price on request" (no number).
  price_cents  int NULL CHECK (price_cents IS NULL OR (price_cents >= 0 AND price_cents <= 100000000)),
  -- 3-letter upper ISO; NEVER GBP-defaulted (de-GBP direction). Written as the
  -- brand's default_currency by the builder; stored per row so a historical
  -- price keeps its currency if the brand later changes default.
  currency     text NOT NULL CHECK (currency = upper(currency) AND length(currency) = 3),
  is_available boolean NOT NULL DEFAULT true,
  -- Seam only; no upload UI this leg (text-only items).
  photo_url    text NULL,
  sort_order   int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS menu_items_menu_id_idx
  ON public.menu_items (menu_id);
CREATE INDEX IF NOT EXISTS menu_items_brand_id_idx
  ON public.menu_items (brand_id);
CREATE INDEX IF NOT EXISTS menu_items_menu_sort_idx
  ON public.menu_items (menu_id, sort_order);

-- ---------------------------------------------------------------------------
-- updated_at triggers (per-table fn, mirrors tg_venue_tables_set_updated_at).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_menus_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS menus_set_updated_at ON public.menus;
CREATE TRIGGER menus_set_updated_at
  BEFORE UPDATE ON public.menus
  FOR EACH ROW EXECUTE FUNCTION public.tg_menus_set_updated_at();

CREATE OR REPLACE FUNCTION public.tg_menu_items_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS menu_items_set_updated_at ON public.menu_items;
CREATE TRIGGER menu_items_set_updated_at
  BEFORE UPDATE ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_menu_items_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — brand-member read + manager-plus write (mirrors venue_tables exactly).
-- ---------------------------------------------------------------------------
ALTER TABLE public.menus ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "menus brand member can read" ON public.menus;
CREATE POLICY "menus brand member can read" ON public.menus
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));

DROP POLICY IF EXISTS "menus manager plus can write" ON public.menus;
CREATE POLICY "menus manager plus can write" ON public.menus
  FOR ALL TO authenticated
  USING (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'))
  WITH CHECK (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.menus TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menus TO service_role;

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "menu_items brand member can read" ON public.menu_items;
CREATE POLICY "menu_items brand member can read" ON public.menu_items
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));

DROP POLICY IF EXISTS "menu_items manager plus can write" ON public.menu_items;
CREATE POLICY "menu_items manager plus can write" ON public.menu_items
  FOR ALL TO authenticated
  USING (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'))
  WITH CHECK (public.biz_brand_effective_rank_for_caller(brand_id) >= public.biz_role_rank('event_manager'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_items TO service_role;

-- ---------------------------------------------------------------------------
-- Public anon read — security-definer view (mirrors claimed_venues_public_view).
-- Exposes available items of active menus ONLY for verified, non-deleted venues.
-- I-PROPOSED-1186C-MENU-VERIFIED-VENUE-PUBLIC-ONLY.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.public_menus_view AS
  SELECT mi.id,
         mi.menu_id,
         mi.brand_id,
         b.slug                AS brand_slug,
         m.name                AS menu_name,
         m.description         AS menu_description,
         m.sort_order          AS menu_sort_order,
         mi.name               AS item_name,
         mi.description        AS item_description,
         mi.price_cents,
         mi.currency,
         mi.sort_order         AS item_sort_order
  FROM public.menu_items mi
  JOIN public.menus  m ON m.id = mi.menu_id AND m.is_active = true
  JOIN public.brands b ON b.id = mi.brand_id
  WHERE mi.is_available = true
    AND b.deleted_at IS NULL
    AND b.claim_status = 'verified';

-- DEFINER: anon never touches brands directly (brands holds sensitive columns).
ALTER VIEW public.public_menus_view SET (security_invoker = false);

GRANT SELECT ON public.public_menus_view TO anon, authenticated;

COMMENT ON VIEW public.public_menus_view IS
  'ORCH-1186-C: anon-readable display-only venue menu. Available items of active '
  'menus for verified, non-deleted venues only. No ordering/cart/payment. '
  'security_invoker=false so anon reads scoped output, never the brands table.';

COMMIT;
