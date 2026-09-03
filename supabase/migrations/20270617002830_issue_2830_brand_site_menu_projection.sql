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

-- ---------------------------------------------------------------------------
-- brand_site_orderable_venue — WHICH kitchen receives a website order.
--
-- Ordering runs on Mingla's existing venue-order rail, which is scoped to a
-- venue_listings row, not a brand. Menus are brand-scoped, so the website has
-- to resolve one from the other, and the answer is deliberately conservative:
--
--   exactly one verified venue  -> that venue, ordering is on
--   none                        -> NULL, the menu is display-only
--   more than one               -> NULL, ordering stays OFF until a human says
--                                  which kitchen serves the website
--
-- Guessing between two verified venues would send a customer's dinner to the
-- wrong kitchen. A menu you cannot order from is a disappointment; an order
-- cooked in the wrong building is a refund and a bad night for someone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.brand_site_orderable_venue(
  p_site_id uuid
) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_brand_id uuid;
  v_venue_id uuid;
  v_count int;
BEGIN
  SELECT brand_id INTO STRICT v_brand_id
  FROM public.brand_sites WHERE id = p_site_id;

  SELECT count(*), min(vl.id)
    INTO v_count, v_venue_id
  FROM public.venue_listings vl
  WHERE vl.brand_id = v_brand_id
    AND vl.claim_status = 'verified';

  IF v_count = 1 THEN
    RETURN v_venue_id;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.brand_site_orderable_venue(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_orderable_venue(uuid) TO service_role;

COMMENT ON FUNCTION public.brand_site_orderable_venue(uuid) IS
  'issue-2830: the single verified venue that serves website orders for a site, '
  'or NULL when there is none or more than one. Never guesses between venues.';

-- ---------------------------------------------------------------------------
-- The republish signal.
--
-- The published website carries a BAKED copy of the menu, which is what makes
-- it fast and immutable. The cost is that a price changed in Mingla does not
-- reach the site until someone republishes. Rather than leave that to be
-- noticed, the workspace tells the brand.
--
-- `brand_site_menu_fingerprint` digests exactly what the website renders — the
-- items, their names, prices, currency and order — so the comparison is
-- meaningful. It deliberately covers AVAILABILITY too: an item switched off in
-- the app is a change the website is now wrong about.
--
-- The fingerprint at publish time is recorded on the publication row, so
-- "changed since publish" is a comparison of two facts rather than a guess
-- from timestamps.
-- ---------------------------------------------------------------------------
ALTER TABLE public.brand_site_publications
  ADD COLUMN IF NOT EXISTS menu_fingerprint text
    CHECK (menu_fingerprint IS NULL OR menu_fingerprint ~ '^[0-9a-f]{64}$');

COMMENT ON COLUMN public.brand_site_publications.menu_fingerprint IS
  'issue-2830: digest of the Mingla menu AS PUBLISHED. NULL for publications '
  'made before this column existed, and for sites with no menu block.';

CREATE OR REPLACE FUNCTION public.brand_site_menu_fingerprint(
  p_site_id uuid
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_brand_id uuid;
  v_payload text;
BEGIN
  SELECT brand_id INTO STRICT v_brand_id
  FROM public.brand_sites WHERE id = p_site_id;

  SELECT coalesce(
    string_agg(
      concat_ws(
        '|',
        mi.id::text, mi.name, coalesce(mi.description, ''),
        coalesce(mi.price_cents::text, 'null'), mi.currency,
        mi.is_available::text, mi.sort_order::text,
        m.id::text, m.name, m.sort_order::text, m.is_active::text
      ),
      E'\n' ORDER BY m.sort_order, m.id, mi.sort_order, mi.id
    ),
    ''
  ) INTO v_payload
  FROM public.menu_items mi
  JOIN public.menus m ON m.id = mi.menu_id
  WHERE m.brand_id = v_brand_id AND mi.brand_id = v_brand_id;

  RETURN encode(extensions.digest(v_payload, 'sha256'), 'hex');
END;
$$;

REVOKE ALL ON FUNCTION public.brand_site_menu_fingerprint(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_site_menu_fingerprint(uuid)
  TO service_role;

COMMENT ON FUNCTION public.brand_site_menu_fingerprint(uuid) IS
  'issue-2830: digest of a brand''s menu including availability, so the Website '
  'workspace can tell a brand when the published site is behind Mingla.';

COMMIT;
