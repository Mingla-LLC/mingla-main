-- Issue #1365 — make the existing display-only menu explicitly venue-owned.
-- Ambiguous multi-venue legacy menus stay unassigned and therefore private
-- until a manager selects their venue. New clients name a venue explicitly;
-- the temporary single-venue write seam below protects installed old clients.

BEGIN;

ALTER TABLE public.menus
  ADD COLUMN IF NOT EXISTS venue_id uuid NULL
  REFERENCES public.venue_listings(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS menus_venue_id_idx
  ON public.menus (venue_id);
CREATE INDEX IF NOT EXISTS menus_venue_active_idx
  ON public.menus (venue_id) WHERE is_active;

-- Prefer the one verified/public venue even when non-public sibling rows exist.
-- If none are verified, exactly one total venue is still unambiguous for a
-- pre-verification brand. Every other shape remains unassigned and private.
WITH venue_resolution AS (
  SELECT brand_id,
         count(*) AS total_count,
         count(*) FILTER (WHERE claim_status = 'verified') AS verified_count,
         (array_agg(id ORDER BY created_at, id))[1] AS only_venue_id,
         (array_agg(id ORDER BY created_at, id)
           FILTER (WHERE claim_status = 'verified'))[1] AS verified_venue_id
  FROM public.venue_listings
  GROUP BY brand_id
),
resolved_venue AS (
  SELECT brand_id,
         CASE
           WHEN verified_count = 1 THEN verified_venue_id
           WHEN verified_count = 0 AND total_count = 1 THEN only_venue_id
         END AS venue_id
  FROM venue_resolution
)
UPDATE public.menus m
SET venue_id = rv.venue_id
FROM resolved_venue rv
WHERE m.brand_id = rv.brand_id
  AND rv.venue_id IS NOT NULL
  AND m.venue_id IS NULL;

DROP TRIGGER IF EXISTS menus_venue_brand_match ON public.menus;
CREATE TRIGGER menus_venue_brand_match
  BEFORE INSERT OR UPDATE OF brand_id, venue_id ON public.menus
  FOR EACH ROW EXECUTE FUNCTION public._orch1255_venue_belongs_to_brand();

CREATE OR REPLACE FUNCTION public.tg_issue_1365_menu_requires_venue()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_total_count integer;
  v_verified_count integer;
  v_only_venue_id uuid;
  v_verified_venue_id uuid;
BEGIN
  -- [TRANSITIONAL] Installed pre-#1365 Business clients omit venue_id. During
  -- OTA propagation, preserve their save path only where venue ownership is
  -- mathematically unambiguous. Exit after the minimum supported Business
  -- build always sends venue_id.
  IF NEW.venue_id IS NULL THEN
    SELECT count(*),
           count(*) FILTER (WHERE v.claim_status = 'verified'),
           (array_agg(v.id ORDER BY v.created_at, v.id))[1],
           (array_agg(v.id ORDER BY v.created_at, v.id)
             FILTER (WHERE v.claim_status = 'verified'))[1]
      INTO v_total_count, v_verified_count,
           v_only_venue_id, v_verified_venue_id
      FROM public.venue_listings v
     WHERE v.brand_id = NEW.brand_id;

    IF v_verified_count = 1 THEN
      NEW.venue_id := v_verified_venue_id;
    ELSIF v_verified_count > 1 THEN
      RAISE EXCEPTION 'menu_venue_ambiguous';
    ELSIF v_total_count = 1 THEN
      NEW.venue_id := v_only_venue_id;
    ELSIF v_total_count = 0 THEN
      RAISE EXCEPTION 'menu_venue_required';
    ELSE
      RAISE EXCEPTION 'menu_venue_ambiguous';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_issue_1365_menu_requires_venue() IS
  '[TRANSITIONAL] #1365 rollout seam: legacy menu writes without venue_id are '
  'assigned to exactly one verified venue, or to exactly one total venue when '
  'none are verified. Zero venues raise menu_venue_required; multiple verified '
  'or otherwise ambiguous venues raise menu_venue_ambiguous. Public exposure '
  'remains verified-only.';

DROP TRIGGER IF EXISTS menus_require_venue_on_write ON public.menus;
CREATE TRIGGER menus_require_venue_on_write
  BEFORE INSERT OR UPDATE ON public.menus
  FOR EACH ROW EXECUTE FUNCTION public.tg_issue_1365_menu_requires_venue();

-- The public contract is now keyed by the exact verified venue. Legacy
-- unassigned menus are intentionally absent instead of appearing at siblings.
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
         mi.sort_order         AS item_sort_order,
         -- Additive columns stay at the end so CREATE OR REPLACE preserves
         -- existing dependent objects and the prior column contract.
         m.venue_id,
         v.slug                AS venue_slug
  FROM public.menu_items mi
  JOIN public.menus m
    ON m.id = mi.menu_id
   AND m.brand_id = mi.brand_id
   AND m.is_active = true
  JOIN public.venue_listings v
    ON v.id = m.venue_id
   AND v.brand_id = m.brand_id
   AND v.claim_status = 'verified'
  JOIN public.brands b
    ON b.id = m.brand_id
   AND b.deleted_at IS NULL
  WHERE mi.is_available = true;

ALTER VIEW public.public_menus_view SET (security_invoker = false);
GRANT SELECT ON public.public_menus_view TO anon, authenticated;

COMMENT ON COLUMN public.menus.venue_id IS
  'Issue #1365: exact venue owner. NULL is legacy ambiguity only and is never public.';
COMMENT ON VIEW public.public_menus_view IS
  'Issue #1365: anon display-only menu rows for one exact verified venue. '
  'Unassigned and sibling-venue menus are never exposed.';

COMMIT;

NOTIFY pgrst, 'reload schema';
