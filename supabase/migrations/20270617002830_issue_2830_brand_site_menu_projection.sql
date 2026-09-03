-- ===========================================================================
-- #2830 — brand_site_menu_projection: the ONE way a website learns a menu.
--
-- WHY THIS EXISTS. The Sites renderer only ever had `menu_link`, a button
-- pointing at a PDF, so a restaurant's actual menu could not appear on its own
-- website. Mingla already owns menus in public.menus / public.menu_items, and
-- #2829 is explicit that Mingla stays the authority for menus. So the website
-- must PROJECT Mingla's menu, never keep its own copy that a brand could edit
-- into disagreeing with the app.
--
-- Mirrors brand_site_commercial_projection exactly: SECURITY DEFINER, pinned
-- search_path, site-scoped, service_role only. It is NOT granted to anon —
-- public.public_menus_view already serves anon reads and is unchanged here.
--
-- WHAT IT DELIBERATELY DOES NOT DO:
--   * It does not invent a price. price_cents is nullable in menu_items and
--     NULL means "price on request" — a real thing on gogi's printed menu. It
--     is projected as NULL and the renderer shows no number.
--   * It does not default a currency. Currency travels per row, so a menu
--     priced before a brand changed its default keeps the currency it was
--     actually priced in (the de-GBP direction, and #962's hide-price rule).
--   * It does not include unavailable items or inactive menus, matching what
--     public_menus_view already exposes to anon. A website must not advertise
--     something the venue has switched off.
--
-- Applied via the Supabase Management API after REVIEW, per the #2830 protocol.
-- Do NOT run `supabase db push`.
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.brand_site_menu_projection(
  p_site_id uuid
) RETURNS TABLE (
  menu_id uuid,
  menu_name text,
  menu_description text,
  menu_sort_order int,
  item_id uuid,
  item_name text,
  item_description text,
  price_cents int,
  currency text,
  item_sort_order int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_brand_id uuid;
BEGIN
  -- STRICT: an unknown site raises rather than returning an empty menu. A
  -- silently empty menu would publish a restaurant page with no food on it.
  SELECT brand_id INTO STRICT v_brand_id
  FROM public.brand_sites WHERE id = p_site_id;

  RETURN QUERY
  SELECT m.id,
         m.name,
         m.description,
         m.sort_order,
         mi.id,
         mi.name,
         mi.description,
         mi.price_cents,
         mi.currency,
         mi.sort_order
  FROM public.menu_items mi
  JOIN public.menus m ON m.id = mi.menu_id
  WHERE m.brand_id = v_brand_id
    AND mi.brand_id = v_brand_id
    AND m.is_active = true
    AND mi.is_available = true
  ORDER BY m.sort_order, m.name, mi.sort_order, mi.name;
END;
$$;

REVOKE ALL ON FUNCTION public.brand_site_menu_projection(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_menu_projection(uuid) TO service_role;

COMMENT ON FUNCTION public.brand_site_menu_projection(uuid) IS
  'issue-2830: site-scoped menu projection for the Sites publication builder. '
  'Active menus and available items only. Price stays NULL when unpriced and '
  'currency travels per row; neither is ever defaulted.';

COMMIT;
