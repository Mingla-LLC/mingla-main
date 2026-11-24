-- Issue #4490, spec 08 O5 part C (file number 615490; the spec's 544490 is
-- stale): a simple stock count per menu item that sells out by itself on the
-- staff screens and on the guest menu, and the way out when a guest's order
-- sells out after they paid.
--
-- NULL MEANS NOT TRACKED. menu_items.stock_count is NULL for every item until
-- someone sets a count, and a NULL count changes nothing anywhere: the
-- orderable rule, both guest menu reads, the Till send and the guest payment
-- finalizer behave exactly as before this file for an untracked item (proved
-- by the live-path comparison and the pg17 suite).
--
-- THE ONE ORDERABLE RULE (rule 13): an item can be ordered when
--   is_available AND (stock_count IS NULL OR stock_count > 0)
-- issue_4490_menu_item_orderable() is that rule; public_menus_view (the guest
-- and Explorer menu read), public_menu_sold_out_view (the sold-out pills on
-- the guest page) and every stock function use it; the edge's
-- loadMenuSnapshot applies the same expression (menuItemOrderable in
-- venueOrderCore.ts) and the pg17 suite pins both to one truth table. Sold
-- out never flips is_available.
--
-- WHEN STOCK IS TAKEN (decided, spec 08 §9 item 6): a Till round when it is
-- SENT (issue_4490_till_send; paying sends held rounds first, so a sold-out
-- held round refuses the payment and moves no money); a guest QR or page
-- order when it is PAID (pg_venue_order_finalize_payment), never at checkout
-- start. One transaction; the items are updated in menu_item id order with
-- one guarded statement each (stock_count >= quantity), so the count can
-- never go below zero (I-4490-STOCK-NEVER-NEGATIVE). A send that finds too
-- little raises PT409 item_sold_out and nothing of that send happens. A paid
-- guest order that finds too little takes what is left (the count goes to 0)
-- and is flagged metadata.sold_out_after_payment: the guest has paid, so the
-- order is never refused and never silently dropped; staff swap the line
-- (same station, same price or less, any difference refunded) or refund it
-- (issue_4490_order_sold_out_resolve), exactly once.
--
-- WHO CHANGES A COUNT: only these functions. A BEFORE INSERT OR UPDATE
-- trigger refuses any change of the stock columns unless the transaction-
-- local setting mingla.issue_4490_stock names the row AND the statement does
-- not run as a client role (anon, authenticated), so the Host's direct
-- menu_items writes (useMenus) and the REST API cannot change a count.
-- PostgREST cannot set a mingla.* setting; every function that sets it is
-- EXECUTE-revoked from anon and authenticated.
--
-- Rights: Menu counts (issue_4490_stock_set) = menu manage rights (brand
-- rank >= event_manager, the menu_items write policy, or the venue grant
-- restaurant.manage_menu); "Sold out" from the station board =
-- issue_4490_can_kitchen (T15); a swap = kitchen or sell; a refund = the
-- staff refund floor of biz_venue_order_refund_decision (rank >=
-- event_manager). Every change is audited through issue_4490_floor_audit.
--
-- No new venue_id column (the #2099 seal is unchanged). Static SQL;
-- conflicts raise PT409. Every new function is SECURITY DEFINER with
-- search_path '' (the guard trigger is SECURITY INVOKER on purpose: it must
-- see the caller's role) and internal (service role only) except the pure
-- orderable rule, which the two anon views call.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_o5c_patch(p_sig regprocedure, p_old text, p_new text, p_count integer DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> p_count THEN
    RAISE EXCEPTION 'issue_4490 O5C patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ===========================================================================
-- 1. Columns.
-- ===========================================================================
ALTER TABLE public.menu_items
  ADD COLUMN stock_count integer NULL CHECK (stock_count IS NULL OR stock_count >= 0),
  ADD COLUMN stock_warn_at integer NULL CHECK (stock_warn_at IS NULL OR stock_warn_at >= 0),
  -- When the count last reached 0 by a sale or a mark (the "Sold out at 19:58").
  ADD COLUMN stock_out_at timestamptz NULL,
  -- Who set the count from Menu, and when (the "last set by Chioma at 17:00").
  ADD COLUMN stock_set_at timestamptz NULL,
  ADD COLUMN stock_set_by_user_id uuid NULL,
  -- A kitchen "Sold out" mark (T15 / A8): the count before the mark (NULL =
  -- the item was not tracked), when and by whom. "Back on" restores it.
  ADD COLUMN stock_station_marked_at timestamptz NULL,
  ADD COLUMN stock_station_marked_by_user_id uuid NULL,
  ADD COLUMN stock_station_prev integer NULL,
  ADD CONSTRAINT menu_items_stock_mark_shape CHECK (
    (stock_station_marked_at IS NULL) = (stock_station_marked_by_user_id IS NULL)
    AND (stock_station_marked_at IS NOT NULL OR stock_station_prev IS NULL));

COMMENT ON COLUMN public.menu_items.stock_count IS
  '#4490 spec 08 O5: units left. NULL = not tracked (changes nothing). Written only by the #4490 stock '
  'functions (guard trigger issue_4490_menu_item_stock_guard). Orderable = is_available AND '
  '(stock_count IS NULL OR stock_count > 0) (issue_4490_menu_item_orderable); sold out never flips is_available.';
COMMENT ON COLUMN public.menu_items.stock_warn_at IS
  '#4490 spec 08 O5: "Warn me at": the Till and Menu show the count in the warning tone at or below this.';

ALTER TABLE public.venue_order_items
  -- Units this line took from the count (NULL = the item was not tracked or
  -- the line never took stock: a held Till round, an unpaid guest checkout).
  ADD COLUMN stock_taken integer NULL CHECK (stock_taken IS NULL OR stock_taken >= 0),
  -- A guest line the count could not cover when the order was paid.
  ADD COLUMN sold_out_at timestamptz NULL,
  ADD COLUMN sold_out_resolution text NULL CHECK (sold_out_resolution IS NULL OR sold_out_resolution IN ('swap', 'refund')),
  ADD COLUMN sold_out_resolved_at timestamptz NULL,
  ADD COLUMN sold_out_resolved_by_user_id uuid NULL,
  ADD COLUMN sold_out_refund_minor bigint NULL CHECK (sold_out_refund_minor IS NULL OR sold_out_refund_minor >= 0),
  ADD COLUMN swapped_to_item_id uuid NULL REFERENCES public.venue_order_items(id) ON DELETE SET NULL,
  ADD COLUMN swapped_from_item_id uuid NULL REFERENCES public.venue_order_items(id) ON DELETE SET NULL,
  ADD CONSTRAINT venue_order_items_sold_out_shape CHECK (
    (sold_out_resolution IS NULL) = (sold_out_resolved_at IS NULL)
    AND (sold_out_resolution IS NULL OR sold_out_at IS NOT NULL)
    AND (sold_out_resolution IS NULL OR prep_state = 'voided')
    AND (sold_out_resolution IS DISTINCT FROM 'swap' OR swapped_to_item_id IS NOT NULL));

CREATE INDEX venue_order_items_sold_out_open_idx ON public.venue_order_items (venue_order_id)
  WHERE sold_out_at IS NOT NULL AND sold_out_resolution IS NULL;

-- The refund kind of a sold-out line (one per order: the source_refunds
-- unique key holds one row per order and kind).
ALTER TABLE public.source_refunds DROP CONSTRAINT source_refunds_refund_kind_check;
ALTER TABLE public.source_refunds ADD CONSTRAINT source_refunds_refund_kind_check CHECK (refund_kind = ANY (ARRAY[
  'venue_eligible_cancel'::text, 'rsvp_discretionary'::text, 'event_cancel'::text, 'stay_cancellation'::text,
  'venue_order_guest_cancel'::text, 'venue_order_venue_approved'::text, 'late_payment_no_value'::text,
  'checkout_provider_reference_unresolved'::text, 'venue_staff_cancel'::text, 'venue_till_refund'::text,
  'venue_deposit_excess'::text, 'venue_order_line_refund'::text]));

-- The guest is told (T16): Purchases, transactional, text + email.
INSERT INTO public.notification_categories
  (key, section, is_transactional, urgency, default_channels, reach_mode, active)
VALUES (
  'buyer_venue_order_sold_out', 'Purchases', true, 'high',
  ARRAY['sms', 'email'], 'reach_once', true
)
ON CONFLICT (key) DO UPDATE SET
  section = EXCLUDED.section,
  is_transactional = EXCLUDED.is_transactional,
  urgency = EXCLUDED.urgency,
  default_channels = EXCLUDED.default_channels,
  reach_mode = EXCLUDED.reach_mode,
  active = true;

-- ===========================================================================
-- 2. The one orderable rule, and who may set counts.
-- ===========================================================================
CREATE FUNCTION public.issue_4490_menu_item_orderable(p_is_available boolean, p_stock_count integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT COALESCE(p_is_available, false) AND (p_stock_count IS NULL OR p_stock_count > 0);
$function$;

COMMENT ON FUNCTION public.issue_4490_menu_item_orderable(boolean, integer) IS
  '#4490 spec 08 O5 (rule 13): THE orderable rule. is_available AND (stock_count IS NULL OR stock_count > 0). '
  'public_menus_view, public_menu_sold_out_view and every stock function use it; the edge loadMenuSnapshot '
  'applies the same expression (menuItemOrderable).';

-- Menu manage rights for a named user (service-role RPCs): the menu_items
-- write policies (brand rank >= event_manager, or the venue grant
-- restaurant.manage_menu at the item's venue).
CREATE FUNCTION public.issue_4490_can_manage_menu(p_venue_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.venue_listings venue
    WHERE venue.id = p_venue_id
      AND (
        public.biz_brand_effective_rank(venue.brand_id, p_user_id) >= public.biz_role_rank('event_manager')
        OR EXISTS (
          SELECT 1
          FROM public.brand_team_members member
          JOIN public.brand_team_member_venue_grants grant_row ON grant_row.member_id = member.id
          WHERE member.user_id = p_user_id
            AND member.brand_id = venue.brand_id
            AND member.role = 'venue_staff'
            AND member.accepted_at IS NOT NULL
            AND member.removed_at IS NULL
            AND grant_row.venue_id = venue.id
            AND 'restaurant.manage_menu' = ANY (grant_row.capabilities))
      )
  );
$function$;

-- ===========================================================================
-- 3. The guard: counts change only through the stock functions.
-- ===========================================================================
CREATE FUNCTION public.issue_4490_menu_item_stock_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stock_count IS NULL AND NEW.stock_warn_at IS NULL AND NEW.stock_out_at IS NULL
       AND NEW.stock_set_at IS NULL AND NEW.stock_set_by_user_id IS NULL
       AND NEW.stock_station_marked_at IS NULL AND NEW.stock_station_marked_by_user_id IS NULL
       AND NEW.stock_station_prev IS NULL THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.stock_count IS NOT DISTINCT FROM OLD.stock_count
     AND NEW.stock_warn_at IS NOT DISTINCT FROM OLD.stock_warn_at
     AND NEW.stock_out_at IS NOT DISTINCT FROM OLD.stock_out_at
     AND NEW.stock_set_at IS NOT DISTINCT FROM OLD.stock_set_at
     AND NEW.stock_set_by_user_id IS NOT DISTINCT FROM OLD.stock_set_by_user_id
     AND NEW.stock_station_marked_at IS NOT DISTINCT FROM OLD.stock_station_marked_at
     AND NEW.stock_station_marked_by_user_id IS NOT DISTINCT FROM OLD.stock_station_marked_by_user_id
     AND NEW.stock_station_prev IS NOT DISTINCT FROM OLD.stock_station_prev THEN
    RETURN NEW;
  END IF;
  IF current_user IN ('anon', 'authenticated')
     OR COALESCE(current_setting('mingla.issue_4490_stock', true), '') IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'stock_write_refused' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER issue_4490_menu_item_stock_guard
  BEFORE INSERT OR UPDATE ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_menu_item_stock_guard();

-- ===========================================================================
-- 4. What a count looks like to staff.
-- ===========================================================================
CREATE FUNCTION public.issue_4490_stock_projection(p_item_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'menuItemId', mi.id,
    'name', mi.name,
    'tracked', mi.stock_count IS NOT NULL,
    'stockLeft', mi.stock_count,
    'warnAt', mi.stock_warn_at,
    'soldOut', mi.stock_count = 0,
    'orderable', public.issue_4490_menu_item_orderable(mi.is_available, mi.stock_count),
    'available', mi.is_available,
    'outAt', mi.stock_out_at,
    'setAt', mi.stock_set_at,
    'setBy', CASE WHEN mi.stock_set_by_user_id IS NULL THEN NULL
                  ELSE public.issue_4490_floor_person_name(mi.stock_set_by_user_id, m.venue_id) END,
    'markedAt', mi.stock_station_marked_at,
    'markedBy', CASE WHEN mi.stock_station_marked_by_user_id IS NULL THEN NULL
                     ELSE public.issue_4490_floor_person_name(mi.stock_station_marked_by_user_id, m.venue_id) END)
  FROM public.menu_items mi
  JOIN public.menus m ON m.id = mi.menu_id
  WHERE mi.id = p_item_id;
$function$;

-- The item's venue, locked (every stock write locks the one row it changes).
CREATE FUNCTION public.issue_4490_stock_item_venue(p_item_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT m.venue_id FROM public.menu_items mi JOIN public.menus m ON m.id = mi.menu_id WHERE mi.id = p_item_id;
$function$;

-- ===========================================================================
-- 5. Menu: set, restock or stop tracking (menu manage rights).
-- ===========================================================================
-- p_count NULL stops tracking (always allowed, so a venue whose Till was
-- switched off can still clear a count); a number needs the Till released at
-- the venue (the Host shows the stock fields only there). p_warn_at NULL = no
-- warning. Clears any kitchen mark (the count is now the manager's).
CREATE FUNCTION public.issue_4490_stock_set(
  p_item_id uuid,
  p_count integer,
  p_warn_at integer,
  p_actor uuid,
  p_device_user uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_item public.menu_items%ROWTYPE;
  v_venue uuid;
  v_brand uuid;
BEGIN
  IF p_item_id IS NULL OR (p_count IS NOT NULL AND (p_count < 0 OR p_count > 99999))
     OR (p_warn_at IS NOT NULL AND (p_warn_at < 0 OR p_warn_at > 99999))
     OR (p_count IS NULL AND p_warn_at IS NOT NULL) THEN
    RAISE EXCEPTION 'stock_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_item FROM public.menu_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stock_item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT m.venue_id, m.brand_id INTO v_venue, v_brand FROM public.menus m WHERE m.id = v_item.menu_id;
  IF v_venue IS NULL THEN
    RAISE EXCEPTION 'stock_item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_can_manage_menu(v_venue, p_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.issue_4490_pin_actor_assert(v_venue, p_actor, p_device_user);
  IF p_count IS NOT NULL AND NOT public.issue_4490_till_enabled(v_venue) THEN
    RAISE EXCEPTION 'till_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('mingla.issue_4490_stock', v_item.id::text, true);
  UPDATE public.menu_items SET
    stock_count = p_count,
    stock_warn_at = p_warn_at,
    stock_out_at = CASE WHEN p_count = 0 THEN COALESCE(CASE WHEN v_item.stock_count = 0 THEN v_item.stock_out_at END, now())
                        ELSE NULL END,
    stock_set_at = now(),
    stock_set_by_user_id = p_actor,
    stock_station_marked_at = NULL,
    stock_station_marked_by_user_id = NULL,
    stock_station_prev = NULL,
    updated_at = now()
  WHERE id = v_item.id;
  PERFORM set_config('mingla.issue_4490_stock', '', true);
  PERFORM public.issue_4490_floor_audit(v_brand, p_actor, p_device_user, 'stock.set', 'menu_item', v_item.id::text,
    jsonb_build_object('venue_id', v_venue, 'via', 'menu', 'before', v_item.stock_count, 'after', p_count,
                       'warn_at', p_warn_at));
  RETURN public.issue_4490_stock_projection(v_item.id);
END;
$function$;

-- ===========================================================================
-- 6. T15: "Sold out" from the station board, and "Back on".
-- ===========================================================================
-- On: the count goes to 0 (the earlier count, or NULL when untracked, is
-- kept). Off: only a kitchen mark made on the venue's current service day,
-- with nothing changed since, is undone: the earlier count comes back.
-- Rights issue_4490_can_kitchen; a Till device acts as itself (station
-- action). The station gate (VENUE_TILL and the venue's kitchen_screens).
CREATE FUNCTION public.issue_4490_station_sold_out(
  p_item_id uuid,
  p_on boolean,
  p_actor uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_item public.menu_items%ROWTYPE;
  v_venue uuid;
  v_brand uuid;
BEGIN
  IF p_item_id IS NULL OR p_on IS NULL THEN
    RAISE EXCEPTION 'station_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_item FROM public.menu_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stock_item_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT m.venue_id, m.brand_id INTO v_venue, v_brand FROM public.menus m WHERE m.id = v_item.menu_id;
  IF v_venue IS NULL THEN
    RAISE EXCEPTION 'stock_item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_stations_enabled(v_venue) THEN
    RAISE EXCEPTION 'stations_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.issue_4490_can_kitchen(v_venue, p_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_on THEN
    IF v_item.stock_count = 0 THEN
      -- Already sold out (by sales, a count of 0, or an earlier mark).
      RETURN public.issue_4490_stock_projection(v_item.id) || jsonb_build_object('already', true);
    END IF;
    PERFORM set_config('mingla.issue_4490_stock', v_item.id::text, true);
    UPDATE public.menu_items SET
      stock_station_prev = v_item.stock_count,
      stock_count = 0,
      stock_out_at = now(),
      stock_station_marked_at = now(),
      stock_station_marked_by_user_id = p_actor,
      updated_at = now()
    WHERE id = v_item.id;
    PERFORM set_config('mingla.issue_4490_stock', '', true);
  ELSE
    IF v_item.stock_station_marked_at IS NULL OR v_item.stock_count IS DISTINCT FROM 0
       OR public.issue_4490_venue_service_date(v_venue, v_item.stock_station_marked_at)
          <> public.issue_4490_venue_service_date(v_venue, now()) THEN
      RAISE EXCEPTION 'stock_not_kitchen_mark' USING ERRCODE = 'PT409';
    END IF;
    PERFORM set_config('mingla.issue_4490_stock', v_item.id::text, true);
    UPDATE public.menu_items SET
      stock_count = v_item.stock_station_prev,
      stock_out_at = NULL,
      stock_station_marked_at = NULL,
      stock_station_marked_by_user_id = NULL,
      stock_station_prev = NULL,
      updated_at = now()
    WHERE id = v_item.id;
    PERFORM set_config('mingla.issue_4490_stock', '', true);
  END IF;
  PERFORM public.issue_4490_floor_audit(v_brand, p_actor, NULL, 'stock.set', 'menu_item', v_item.id::text,
    jsonb_build_object('venue_id', v_venue, 'via', 'station', 'on', p_on,
                       'before', v_item.stock_count,
                       'after', CASE WHEN p_on THEN 0 ELSE v_item.stock_station_prev END));
  RETURN public.issue_4490_stock_projection(v_item.id) || jsonb_build_object('already', false);
END;
$function$;

-- The station's "Mark sold out" list: the venue's items on active menus that
-- go to this station (or every station for 'all'), with their count, the
-- kitchen mark and how many live tickets carry them.
CREATE FUNCTION public.issue_4490_station_stock(p_venue_id uuid, p_station text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_today date;
BEGIN
  IF p_station NOT IN ('kitchen', 'bar', 'all') THEN
    RAISE EXCEPTION 'station_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_listings v WHERE v.id = p_venue_id) THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_stations_enabled(p_venue_id) THEN
    RAISE EXCEPTION 'stations_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.issue_4490_can_kitchen(p_venue_id, p_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_today := public.issue_4490_venue_service_date(p_venue_id, now());
  RETURN COALESCE((
    SELECT jsonb_agg(public.issue_4490_stock_projection(x.id) || jsonb_build_object(
        'station', x.station,
        'canUndo', x.stock_station_marked_at IS NOT NULL AND x.stock_count = 0
                   AND public.issue_4490_venue_service_date(p_venue_id, x.stock_station_marked_at) = v_today,
        'openTickets', (SELECT count(DISTINCT i.venue_order_id) FROM public.venue_order_items i
                        JOIN public.venue_orders o ON o.id = i.venue_order_id
                        WHERE i.menu_item_id = x.id AND i.prep_state IN ('pending', 'fired')
                          AND o.venue_id = p_venue_id
                          AND o.fulfillment_status IN ('placed', 'acknowledged', 'in_progress')))
      ORDER BY x.menu_sort, x.item_sort, x.name, x.id)
    FROM (
      SELECT mi.id, mi.name, mi.stock_count, mi.stock_station_marked_at,
             m.sort_order AS menu_sort, mi.sort_order AS item_sort,
             public.issue_4490_item_station(mi.id, p_venue_id) AS station
      FROM public.menu_items mi
      JOIN public.menus m ON m.id = mi.menu_id AND m.is_active = true AND m.venue_id = p_venue_id
      WHERE mi.is_available = true
    ) x
    WHERE p_station = 'all' OR x.station = p_station), '[]'::jsonb);
END;
$function$;

-- ===========================================================================
-- 7. Taking stock: one guarded statement per line, in menu_item id order.
-- ===========================================================================
-- p_mode 'send' (a Till round): too little raises PT409 item_sold_out with
-- the item and what is left, and the caller's whole transaction (the send,
-- or the payment that sends first) rolls back. p_mode 'paid' (a guest order
-- the guest has paid): too little takes what is left (0), marks the line
-- sold_out_at and returns the line ids; the caller flags the order. A line
-- that already took stock (stock_taken set) is never taken twice. An
-- untracked item (NULL count) is read without a lock and skipped.
CREATE FUNCTION public.issue_4490_stock_take(p_order_ids uuid[], p_mode text, p_only_item_id uuid DEFAULT NULL)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  r record;
  v_count integer;
  v_left integer;
  v_short uuid[] := '{}'::uuid[];
BEGIN
  IF p_mode NOT IN ('send', 'paid') THEN
    RAISE EXCEPTION 'stock_invalid' USING ERRCODE = '22023';
  END IF;
  FOR r IN
    SELECT i.id, i.menu_item_id, i.quantity, i.item_name_at_order
    FROM public.venue_order_items i
    WHERE i.venue_order_id = ANY (COALESCE(p_order_ids, '{}'::uuid[]))
      AND i.prep_state <> 'voided' AND i.stock_taken IS NULL
      AND (p_only_item_id IS NULL OR i.id = p_only_item_id)
    ORDER BY i.menu_item_id, i.id
  LOOP
    SELECT mi.stock_count INTO v_count FROM public.menu_items mi WHERE mi.id = r.menu_item_id;
    CONTINUE WHEN v_count IS NULL;
    PERFORM set_config('mingla.issue_4490_stock', r.menu_item_id::text, true);
    UPDATE public.menu_items
    SET stock_count = stock_count - r.quantity,
        stock_out_at = CASE WHEN stock_count - r.quantity = 0 THEN now() ELSE stock_out_at END
    WHERE id = r.menu_item_id AND stock_count IS NOT NULL AND stock_count >= r.quantity;
    IF FOUND THEN
      PERFORM set_config('mingla.issue_4490_stock', '', true);
      UPDATE public.venue_order_items SET stock_taken = r.quantity WHERE id = r.id;
      CONTINUE;
    END IF;
    -- Too little (or tracking stopped a moment ago): read again, locked.
    SELECT mi.stock_count INTO v_left FROM public.menu_items mi WHERE mi.id = r.menu_item_id FOR UPDATE;
    IF v_left IS NULL THEN
      PERFORM set_config('mingla.issue_4490_stock', '', true);
      CONTINUE;
    END IF;
    IF v_left >= r.quantity THEN
      -- Restocked between the two reads: take it now.
      UPDATE public.menu_items
      SET stock_count = stock_count - r.quantity,
          stock_out_at = CASE WHEN stock_count - r.quantity = 0 THEN now() ELSE stock_out_at END
      WHERE id = r.menu_item_id;
      PERFORM set_config('mingla.issue_4490_stock', '', true);
      UPDATE public.venue_order_items SET stock_taken = r.quantity WHERE id = r.id;
      CONTINUE;
    END IF;
    IF p_mode = 'send' THEN
      PERFORM set_config('mingla.issue_4490_stock', '', true);
      RAISE EXCEPTION 'item_sold_out' USING ERRCODE = 'PT409',
        DETAIL = jsonb_build_object('itemName', r.item_name_at_order, 'left', v_left,
                                    'menuItemId', r.menu_item_id)::text;
    END IF;
    UPDATE public.menu_items
    SET stock_count = 0, stock_out_at = COALESCE(CASE WHEN stock_count = 0 THEN stock_out_at END, now())
    WHERE id = r.menu_item_id;
    PERFORM set_config('mingla.issue_4490_stock', '', true);
    UPDATE public.venue_order_items SET stock_taken = v_left, sold_out_at = now() WHERE id = r.id;
    v_short := v_short || r.id;
  END LOOP;
  RETURN v_short;
END;
$function$;

-- Units a line took come back (a void of an unprepared line, or a sold-out
-- line that was swapped or refunded and never made). Untracked items stay
-- untracked; a line gives back at most once.
CREATE FUNCTION public.issue_4490_stock_give_back(p_order_item_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_item public.venue_order_items%ROWTYPE;
  v_n integer;
BEGIN
  SELECT * INTO v_item FROM public.venue_order_items WHERE id = p_order_item_id FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_item.stock_taken, 0) = 0 THEN
    RETURN 0;
  END IF;
  PERFORM set_config('mingla.issue_4490_stock', v_item.menu_item_id::text, true);
  UPDATE public.menu_items
  SET stock_count = stock_count + v_item.stock_taken,
      stock_out_at = NULL
  WHERE id = v_item.menu_item_id AND stock_count IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('mingla.issue_4490_stock', '', true);
  UPDATE public.venue_order_items SET stock_taken = 0 WHERE id = v_item.id;
  RETURN CASE WHEN v_n > 0 THEN v_item.stock_taken ELSE 0 END;
END;
$function$;

-- ===========================================================================
-- 8. The Till's send takes stock first (re-emitted from its only body,
--    20281203584490; the stock step is the only change).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_till_send(p_sale_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_sent uuid[];
  v_screens text[];
  v_order uuid;
  v_held uuid[];
BEGIN
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, NULL);
  IF v_sale.state NOT IN ('open', 'paying') THEN
    RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
  END IF;
  -- #4490 08-O5C: stock is taken for every held round of this check, in one
  -- statement per line (menu_item id order); too little raises PT409
  -- item_sold_out and nothing of this send happens (I-4490-STOCK-NEVER-NEGATIVE).
  SELECT COALESCE(array_agg(o.id ORDER BY o.id), '{}'::uuid[]) INTO v_held
  FROM public.venue_orders o
  JOIN public.venue_till_lines l ON l.venue_order_id = o.id
  WHERE l.sale_id = v_sale.id AND l.kind = 'menu_round' AND o.fulfillment_status = 'held';
  IF cardinality(v_held) > 0 THEN
    PERFORM public.issue_4490_stock_take(v_held, 'send');
  END IF;
  WITH sent AS (
    UPDATE public.venue_orders o
    SET fulfillment_status = 'placed', sent_at = now(), updated_at = now()
    FROM public.venue_till_lines l
    WHERE l.sale_id = v_sale.id AND l.kind = 'menu_round' AND l.venue_order_id = o.id
      AND o.fulfillment_status = 'held'
    RETURNING o.id
  )
  SELECT COALESCE(array_agg(id ORDER BY id), '{}'::uuid[]) INTO v_sent FROM sent;
  IF cardinality(v_sent) > 0 THEN
    v_screens := CASE WHEN public.issue_4490_venue_feature_on(v_sale.venue_id, 'kitchen_screens')
      THEN COALESCE((SELECT s.screen_stations FROM public.venue_till_settings s WHERE s.venue_id = v_sale.venue_id),
                    ARRAY['kitchen', 'bar']::text[])
      ELSE '{}'::text[] END;
    FOREACH v_order IN ARRAY v_sent LOOP
      INSERT INTO public.venue_station_tickets (
        venue_order_id, station, accepted_at, accepted_by_user_id, ready_at, ready_by_user_id,
        picked_up_at, picked_up_by_user_id)
      SELECT DISTINCT v_order, i.station, now(), p_actor, now(), p_actor, now(), p_actor
      FROM public.venue_order_items i
      WHERE i.venue_order_id = v_order AND i.prep_state <> 'voided' AND i.station IS NOT NULL
        AND NOT (i.station = ANY (v_screens))
      ON CONFLICT (venue_order_id, station) DO NOTHING;
      UPDATE public.venue_order_items i
      SET prep_state = 'served', fired_at = now(), ready_at = now(), ready_by_user_id = p_actor
      WHERE i.venue_order_id = v_order AND i.prep_state = 'pending' AND i.station IS NOT NULL
        AND NOT (i.station = ANY (v_screens));
      IF NOT EXISTS (SELECT 1 FROM public.venue_order_items i
                     WHERE i.venue_order_id = v_order AND i.prep_state <> 'voided'
                       AND i.station = ANY (v_screens)) THEN
        UPDATE public.venue_orders o SET
          fulfillment_status = 'delivered',
          acknowledged_at = now(), acknowledged_by_user_id = p_actor,
          in_progress_at = now(), ready_at = now(), delivered_at = now(),
          station_rev = o.station_rev + 1, updated_at = now()
        WHERE o.id = v_order;
      END IF;
    END LOOP;
    UPDATE public.venue_till_sales SET version = version + 1, updated_at = now() WHERE id = v_sale.id;
  END IF;
  RETURN public.issue_4490_till_sale_projection(v_sale.id)
    || jsonb_build_object('sentOrderIds', to_jsonb(v_sent));
END;
$function$;

-- ===========================================================================
-- 9. A void of an unprepared sent line gives its stock back when asked
--    (default on in the Till; a checked patch of the live body).
-- ===========================================================================
SELECT pg_temp.issue_4490_o5c_patch(
  'public.issue_4490_till_void(uuid,uuid,uuid,uuid,text,boolean,integer)'::regprocedure,
  $old$  -- p_restock is the O5 stock seam: nothing is tracked until stock ships.
  PERFORM public.issue_4490_till_reprice(v_sale.id);$old$,
  $new$  -- #4490 08-O5C: p_restock gives back what each line voided by THIS call
  -- took from the count, when it was never started at a station (fired_at
  -- NULL). A held round never took stock; a refund never restocks.
  IF p_restock IS TRUE THEN
    PERFORM public.issue_4490_stock_give_back(i.id)
    FROM public.venue_order_items i
    JOIN public.venue_orders o ON o.id = i.venue_order_id
    WHERE o.session_id = v_sale.session_id AND i.prep_state = 'voided'
      AND i.voided_at = now() AND i.voided_by_user_id = p_actor
      AND i.fired_at IS NULL AND COALESCE(i.stock_taken, 0) > 0
      AND (p_order_item_id IS NULL OR i.id = p_order_item_id)
      AND (p_line_id IS NULL OR i.venue_order_id = v_line.venue_order_id);
  END IF;
  PERFORM public.issue_4490_till_reprice(v_sale.id);$new$
);

-- ===========================================================================
-- 10. pg_venue_order_finalize_payment: a paid guest order takes its stock
--     (re-emitted from its latest body, 20281203564490; one additive block,
--     signature, header and grants unchanged). An order with no tracked item
--     reads each item's count once (no lock, no write) and continues exactly
--     as before; the returned object only gains soldOutAfterPayment when a
--     line was short.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.pg_venue_order_finalize_payment(
  p_order_id uuid, p_provider text, p_paid_amount_cents integer, p_currency text,
  p_payment_intent_id text DEFAULT NULL::text, p_charge_id text DEFAULT NULL::text,
  p_provider_fee_cents integer DEFAULT NULL::integer, p_provider_balance_transaction_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.venue_orders%ROWTYPE;
  v_session public.venue_order_sessions%ROWTYPE;
  v_is_settlement boolean;
  v_till jsonb;
  v_channel text;
  v_short uuid[];
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_provider NOT IN ('stripe','paystack') THEN
    RAISE EXCEPTION 'invalid_provider' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.venue_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false, 'status', 'not_found');
  END IF;

  -- N147 (#4490): the provider evidence must belong to THIS order. A Paystack
  -- reference is the order's own paystack_reference; a Stripe payment intent,
  -- once recorded, must match. Refused before any write (no caller sends a
  -- foreign reference today: webhook and return both look the order up by it).
  IF p_provider = 'paystack'
     AND (p_payment_intent_id IS NULL OR v_order.paystack_reference IS DISTINCT FROM p_payment_intent_id) THEN
    RETURN jsonb_build_object('matched', false, 'status', 'reference_mismatch');
  END IF;
  IF p_provider = 'stripe' AND p_payment_intent_id IS NOT NULL
     AND v_order.stripe_payment_intent_id IS NOT NULL
     AND v_order.stripe_payment_intent_id <> p_payment_intent_id THEN
    RETURN jsonb_build_object('matched', false, 'status', 'reference_mismatch');
  END IF;

  -- A venue-collected order has no provider and never reaches this path.
  IF v_order.money_path <> 'mingla' THEN
    RETURN jsonb_build_object('matched', false, 'status', 'not_a_mingla_order');
  END IF;

  IF v_order.payment_status = 'paid' THEN
    RETURN jsonb_build_object(
      'matched', true, 'status', 'replayed', 'orderId', v_order.id,
      'brandId', v_order.brand_id);
  END IF;

  IF p_paid_amount_cents IS DISTINCT FROM v_order.total_cents
     OR upper(coalesce(p_currency,'')) <> v_order.currency THEN
    UPDATE public.venue_orders
       SET payment_status = 'failed', failed_at = now()
     WHERE id = p_order_id;
    RETURN jsonb_build_object(
      'matched', true, 'status', 'amount_or_currency_mismatch',
      'orderId', v_order.id, 'brandId', v_order.brand_id);
  END IF;

  UPDATE public.venue_orders
     SET payment_status = 'paid',
         confirmed_at = coalesce(confirmed_at, now()),
         provider = p_provider,
         stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id),
         stripe_charge_id = coalesce(stripe_charge_id, p_charge_id)
   WHERE id = p_order_id;

  -- The snapshot the sweep INNER JOINs — written ONLY when the provider told us
  -- the REAL fee (Paystack returns `fees` on verify). A NULL fee writes NOTHING:
  -- per-charge provider fees are immutable ledger inputs and a zero placeholder
  -- would over-release the venue by exactly the processing cost. The order then
  -- WAITS, and `list_missing_payout_source_fees` (extended below) hands it to
  -- the shipped payout-release-sweep fee-capture loop, which resolves the true
  -- balance-transaction fee from the provider. Money is never released on a
  -- guess (P-49.3).
  IF p_provider_fee_cents IS NOT NULL THEN
    INSERT INTO public.payout_source_fee_snapshots (
      source_type, source_id, provider_fee_cents, provider_balance_transaction_id
    ) VALUES (
      'venue_menu_order', p_order_id, greatest(0, p_provider_fee_cents),
      p_provider_balance_transaction_id
    )
    ON CONFLICT (source_type, source_id) DO NOTHING;
  END IF;

  -- #4490 spec 08 O5 (stock, decided timing): a paid guest QR or page order
  -- takes its stock now (never at checkout start). The guest has paid, so it
  -- is never refused: a line the count cannot cover takes what is left (the
  -- count goes to 0) and the order is flagged for staff to swap or refund it
  -- (issue_4490_order_sold_out_resolve). Untracked items: one read, no write.
  IF v_order.till_payment_id IS NULL AND v_order.source IN ('guest_qr', 'guest_page') THEN
    v_short := public.issue_4490_stock_take(ARRAY[v_order.id], 'paid');
    IF cardinality(v_short) > 0 THEN
      UPDATE public.venue_orders
         SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
               'sold_out_after_payment', true,
               'sold_out_at', now()),
             station_rev = station_rev + 1
       WHERE id = p_order_id;
    END IF;
  END IF;

  -- #4490 spec 08 O2: a Till carrier pays its Till payment. The channel is the
  -- provider's (Stripe is always a card; Paystack's verified `channel` was put
  -- on the carrier by the webhook or the return check). Late money (the
  -- payment was cancelled or its code expired) is recorded, never refused:
  -- issue_4490_till_apply_payment marks it paid_late into overpaid_minor.
  IF v_order.till_payment_id IS NOT NULL THEN
    v_channel := CASE WHEN p_provider = 'stripe' THEN 'card'
                      ELSE NULLIF(v_order.metadata->>'provider_channel', '') END;
    IF v_channel IS NOT NULL AND v_channel NOT IN ('card', 'bank_transfer', 'ussd', 'bank') THEN
      v_channel := NULL;
    END IF;
    UPDATE public.venue_till_payments
       SET provider_channel = COALESCE(provider_channel, v_channel), updated_at = now()
     WHERE id = v_order.till_payment_id;
    UPDATE public.venue_till_pay_codes
       SET status = 'paid', closed_at = COALESCE(closed_at, now()), updated_at = now()
     WHERE payment_id = v_order.till_payment_id AND status IN ('open', 'opened');
    v_till := public.issue_4490_till_apply_payment(v_order.till_payment_id);
    RETURN jsonb_build_object(
      'matched', true, 'status', 'finalized', 'orderId', v_order.id,
      'brandId', v_order.brand_id, 'tabClosed', false,
      'tillPaymentId', v_order.till_payment_id,
      'tillPaidLate', COALESCE((v_till->>'paidLate')::boolean, false));
  END IF;

  -- P-2a — a paid TAB SETTLEMENT order closes its tab and settles its children.
  -- `closed_by_user_id` is the settlement order's taken_by_user_id: the staff
  -- member who actually closed the tab. The webhook has no user of its own, and
  -- inventing one would make the close-shape CHECK a lie.
  v_is_settlement := coalesce(v_order.metadata->>'tab_settlement','') = 'true';
  IF v_is_settlement AND v_order.taken_by_user_id IS NOT NULL THEN
    SELECT * INTO v_session FROM public.venue_order_sessions
     WHERE id = v_order.session_id FOR UPDATE;
    IF FOUND AND v_session.tab_state = 'settling' THEN
      UPDATE public.venue_orders
         SET payment_status = 'paid',
             confirmed_at = coalesce(confirmed_at, now()),
             metadata = metadata || jsonb_build_object(
               'settled_by_venue_order_id', p_order_id::text)
       WHERE session_id = v_session.id
         AND money_path = 'venue_collected'
         AND payment_status = 'pending';
      UPDATE public.venue_order_sessions
         SET tab_state = 'closed', closed_at = now(),
             closed_by_user_id = v_order.taken_by_user_id
       WHERE id = v_session.id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'matched', true, 'status', 'finalized', 'orderId', v_order.id,
    'brandId', v_order.brand_id, 'tabClosed', v_is_settlement)
    || CASE WHEN cardinality(v_short) > 0
            THEN jsonb_build_object('soldOutAfterPayment', true) ELSE '{}'::jsonb END;
END;
$function$;
REVOKE ALL ON FUNCTION public.pg_venue_order_finalize_payment(uuid, text, integer, text, text, text, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_venue_order_finalize_payment(uuid, text, integer, text, text, text, integer, text)
  TO service_role;

-- ===========================================================================
-- 11. The amount-aware twin of pg_venue_order_mint_refund (T16): one
--     sold-out line refund per order (kind venue_order_line_refund; the
--     source_refunds unique key), fee reversal pro rata as the Till's card
--     refund, the same in-flight guard. The rail then runs as for any
--     venue order refund.
-- ===========================================================================
CREATE FUNCTION public.issue_4490_venue_order_mint_partial_refund(
  p_order_id uuid,
  p_amount_minor bigint,
  p_actor uuid,
  p_reason text,
  p_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.venue_orders%ROWTYPE;
  v_refund public.source_refunds%ROWTYPE;
  v_amount bigint := COALESCE(p_amount_minor, 0);
  v_in_flight bigint;
  v_fee bigint;
  v_reason text := left(btrim(COALESCE(p_reason, '')), 480);
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_amount <= 0 OR p_key IS NULL THEN
    RAISE EXCEPTION 'sold_out_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_order FROM public.venue_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.money_path <> 'mingla' OR v_order.payment_status NOT IN ('paid', 'partial_refund')
     OR v_order.total_cents <= 0 THEN
    RAISE EXCEPTION 'already_refunded' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_refund FROM public.source_refunds
  WHERE source_type = 'venue_menu_order' AND source_id = v_order.id AND refund_kind = 'venue_order_line_refund';
  IF FOUND THEN
    RAISE EXCEPTION 'sold_out_refund_once' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (SELECT 1 FROM public.source_refunds sr
             WHERE sr.source_type = 'venue_menu_order' AND sr.source_id = v_order.id
               AND sr.buyer_state NOT IN ('failed_terminal', 'processed')) THEN
    RAISE EXCEPTION 'already_refunded' USING ERRCODE = 'PT409';
  END IF;
  SELECT COALESCE(sum(sr.buyer_refund_requested_cents - sr.buyer_refund_processed_cents), 0) INTO v_in_flight
  FROM public.source_refunds sr
  WHERE sr.source_type = 'venue_menu_order' AND sr.source_id = v_order.id
    AND sr.buyer_state NOT IN ('failed_terminal', 'processed');
  IF v_amount > v_order.total_cents - COALESCE(v_order.refunded_amount_cents, 0) - v_in_flight THEN
    RAISE EXCEPTION 'already_refunded' USING ERRCODE = 'PT409';
  END IF;
  v_fee := LEAST(v_amount, floor((COALESCE(v_order.mingla_fee_cents, 0)::numeric * v_amount)
                               / v_order.total_cents + 0.5)::bigint);
  IF length(v_reason) < 3 THEN
    v_reason := 'Sold out after payment';
  END IF;

  INSERT INTO public.source_refunds(
    source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
    requested_by_type, requested_by_user_id, reason, provider, currency,
    original_charge_cents, buyer_refund_requested_cents,
    original_application_fee_cents, fee_reversal_required_cents,
    fee_state, fee_leg_kind, financial_state,
    organizer_refund_liability_cents, platform_fee_absorption_cents,
    provider_payment_reference, provider_account_reference, idempotency_key
  ) VALUES (
    'venue_menu_order', v_order.id, v_order.id, v_order.brand_id, v_order.venue_id,
    'venue_order_line_refund', 'brand_staff', p_actor, v_reason,
    COALESCE(v_order.provider, 'stripe'), upper(v_order.currency),
    v_order.total_cents, v_amount,
    v_order.mingla_fee_cents, v_fee,
    CASE WHEN v_fee = 0 THEN 'not_required' ELSE 'queued' END,
    CASE WHEN v_fee = 0 THEN 'not_required'
         WHEN COALESCE(v_order.provider, 'stripe') = 'stripe' THEN 'stripe_application_fee_refund'
         ELSE 'paystack_ledger_allocation' END,
    'pending',
    v_amount - v_fee, v_fee,
    COALESCE(v_order.stripe_charge_id, v_order.stripe_payment_intent_id,
             v_order.paystack_reference, 'venue_order:' || v_order.id::text),
    v_order.stripe_account_id,
    'venue_order_line_refund:' || v_order.id::text
  ) RETURNING * INTO v_refund;

  INSERT INTO public.source_refund_ledger_allocations(
    refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
  ) VALUES (
    v_refund.id, 'buyer_refund', v_refund.buyer_refund_requested_cents,
    v_refund.currency, v_refund.provider, 'prepared',
    'source-refund-allocation:buyer:' || v_refund.id);
  IF v_refund.organizer_refund_liability_cents > 0 THEN
    INSERT INTO public.source_refund_ledger_allocations(
      refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
    ) VALUES (
      v_refund.id, 'organizer_refund_liability', v_refund.organizer_refund_liability_cents,
      v_refund.currency, v_refund.provider, 'prepared',
      'source-refund-allocation:organizer:' || v_refund.id);
  END IF;
  IF v_refund.platform_fee_absorption_cents > 0 THEN
    INSERT INTO public.source_refund_ledger_allocations(
      refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
    ) VALUES (
      v_refund.id, 'platform_application_fee_reversal', v_refund.platform_fee_absorption_cents,
      v_refund.currency, v_refund.provider, 'prepared',
      'source-refund-allocation:platform:' || v_refund.id);
  END IF;
  INSERT INTO public.source_refund_events(
    refund_id, event_key, event_type, to_state, actor_type, safe_reason_code
  ) VALUES (
    v_refund.id, 'requested:' || v_refund.id, 'requested', 'queued', 'operator', 'venue_order_line_refund');

  RETURN jsonb_build_object('refundId', v_refund.id, 'amountMinor', v_amount, 'feeReversalMinor', v_fee);
END;
$function$;

-- ===========================================================================
-- 12. The floor audit records sold-out resolutions too (re-emitted whole
--     from 20281203704490; only the action list grew).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_floor_audit(
  p_brand_id uuid,
  p_actor uuid,
  p_device_user uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_after jsonb
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_action NOT IN ('till.pay', 'till.void', 'till.refund', 'till.close', 'till.reopen',
                      'pin.set', 'pin.reset', 'pin.locked', 'stock.set',
                      -- #4490 08-O5B: the drawer and Move to tomorrow.
                      'till.cash_movement', 'till.carry_over',
                      -- #4490 08-O5C: a guest line that sold out after payment.
                      'order.sold_out_resolve') THEN
    RAISE EXCEPTION 'floor_audit_action_invalid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.audit_log (user_id, brand_id, action, target_type, target_id, after)
  VALUES (p_actor, p_brand_id, p_action, p_target_type, p_target_id,
    COALESCE(p_after, '{}'::jsonb) - 'pin' - 'token' - 'pin_hash' - 'token_hash'
      || jsonb_build_object('device_user_id', COALESCE(p_device_user, p_actor)));
END;
$function$;

-- ===========================================================================
-- 13. T16: sold out after payment has a way out.
-- ===========================================================================
-- p_resolution 'swap': rights kitchen OR sell. The swap item is orderable
-- (the one rule) on an active menu of the order's venue, goes to the same
-- station and costs the same or less for the same quantity; a new line is
-- inserted at the swap item's price, the old line is voided
-- (void_reason sold_out_after_payment), stock is taken for the swap item
-- (too little: PT409 item_sold_out, nothing changes) and any difference is
-- refunded. p_resolution 'refund': the staff refund floor (rank >=
-- event_manager, as biz_venue_order_refund_decision); the chosen lines and
-- their share of the service charge are refunded. Either way the units the
-- old line took come back (it was never made), and the guest is told by text
-- and email. Refund amounts follow what the guest paid for those lines: a
-- discounted order refunds the discounted share; the tip stays.
--
-- ONE RESOLUTION, AT MOST ONE REFUND: the order row is locked; a line is
-- resolved once (a second call with the same key replays the first answer,
-- any other key is refused sold_out_already_resolved); the money goes through
-- issue_4490_venue_order_mint_partial_refund, one per order.
CREATE FUNCTION public.issue_4490_order_sold_out_resolve(
  p_order_id uuid,
  p_item_ids uuid[],
  p_resolution text,
  p_swap_item_id uuid,
  p_actor uuid,
  p_device_user uuid,
  p_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.venue_orders%ROWTYPE;
  v_line public.venue_order_items%ROWTYPE;
  v_swap public.menu_items%ROWTYPE;
  v_swap_menu public.menus%ROWTYPE;
  v_ids uuid[];
  v_new_id uuid;
  v_next_line integer;
  v_line_paid bigint;
  v_lines_paid bigint := 0;
  v_new_paid bigint := 0;
  v_diff bigint := 0;
  v_sc_share bigint := 0;
  v_refund_total bigint := 0;
  v_refund jsonb := NULL;
  v_station text;
  v_names text[] := '{}'::text[];
  v_swap_station text;
  v_key text := btrim(COALESCE(p_key, ''));
  v_n integer;
  v_venue_name text;
  v_payload jsonb;
BEGIN
  IF p_order_id IS NULL OR p_resolution NOT IN ('swap', 'refund')
     OR COALESCE(cardinality(p_item_ids), 0) NOT BETWEEN 1 AND 50
     OR (p_resolution = 'swap') <> (p_swap_item_id IS NOT NULL)
     OR v_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$' THEN
    RAISE EXCEPTION 'sold_out_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_order FROM public.venue_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_resolution = 'swap' THEN
    IF NOT (public.issue_4490_can_kitchen(v_order.venue_id, p_actor)
            OR public.issue_4490_can_sell(v_order.venue_id, p_actor)) THEN
      RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
    END IF;
  ELSIF public.biz_brand_effective_rank(v_order.brand_id, p_actor) < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.issue_4490_pin_actor_assert(v_order.venue_id, p_actor, p_device_user);

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids FROM unnest(p_item_ids) x;
  -- A replay of the same request answers what it did.
  IF NOT EXISTS (SELECT 1 FROM unnest(v_ids) x
                 WHERE NOT EXISTS (SELECT 1 FROM public.venue_order_items i
                                   WHERE i.id = x AND i.venue_order_id = v_order.id
                                     AND i.sold_out_resolution IS NOT NULL))
     AND v_order.metadata->'sold_out_resolutions' ? v_key THEN
    RETURN (v_order.metadata->'sold_out_resolutions'->v_key) || jsonb_build_object('replayed', true);
  END IF;
  IF v_order.money_path <> 'mingla' OR v_order.payment_status NOT IN ('paid', 'partial_refund') THEN
    RAISE EXCEPTION 'already_refunded' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_ids) x
             WHERE NOT EXISTS (SELECT 1 FROM public.venue_order_items i
                               WHERE i.id = x AND i.venue_order_id = v_order.id AND i.sold_out_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'sold_out_line_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.venue_order_items i
             WHERE i.id = ANY (v_ids) AND i.sold_out_resolution IS NOT NULL) THEN
    RAISE EXCEPTION 'sold_out_already_resolved' USING ERRCODE = 'PT409';
  END IF;

  IF p_resolution = 'swap' THEN
    SELECT * INTO v_swap FROM public.menu_items WHERE id = p_swap_item_id;
    SELECT * INTO v_swap_menu FROM public.menus WHERE id = v_swap.menu_id;
    IF v_swap.id IS NULL OR v_swap_menu.id IS NULL OR v_swap_menu.venue_id IS DISTINCT FROM v_order.venue_id
       OR v_swap_menu.is_active IS NOT TRUE OR v_swap.brand_id <> v_order.brand_id
       OR NOT public.issue_4490_menu_item_orderable(v_swap.is_available, v_swap.stock_count)
       OR v_swap.price_cents IS NULL OR upper(v_swap.currency) <> v_order.currency
       OR v_swap.id = ANY (SELECT i.menu_item_id FROM public.venue_order_items i WHERE i.id = ANY (v_ids)) THEN
      RAISE EXCEPTION 'sold_out_swap_not_orderable' USING ERRCODE = 'PT409';
    END IF;
    v_swap_station := public.issue_4490_item_station(v_swap.id, v_order.venue_id);
  END IF;

  SELECT COALESCE(max(i.line_no), 0) INTO v_next_line FROM public.venue_order_items i WHERE i.venue_order_id = v_order.id;
  FOR v_line IN SELECT * FROM public.venue_order_items i WHERE i.id = ANY (v_ids) ORDER BY i.line_no FOR UPDATE LOOP
    -- What the guest paid for this line (a discount shrinks every line alike).
    v_line_paid := CASE WHEN COALESCE(v_order.list_subtotal_cents, 0) > 0
                             AND v_order.list_subtotal_cents <> v_order.subtotal_cents
                        THEN floor(v_line.line_total_cents::numeric * v_order.subtotal_cents
                                   / v_order.list_subtotal_cents + 0.5)::bigint
                        ELSE v_line.line_total_cents::bigint END;
    v_lines_paid := v_lines_paid + v_line_paid;
    v_names := v_names || v_line.item_name_at_order;
    IF p_resolution = 'swap' THEN
      IF v_swap_station IS DISTINCT FROM v_line.station THEN
        RAISE EXCEPTION 'sold_out_swap_other_station' USING ERRCODE = 'PT409';
      END IF;
      IF v_swap.price_cents::bigint * v_line.quantity > v_line.line_total_cents THEN
        RAISE EXCEPTION 'sold_out_swap_dearer' USING ERRCODE = 'PT409';
      END IF;
      v_next_line := v_next_line + 1;
      INSERT INTO public.venue_order_items (
        venue_order_id, menu_item_id, line_no, item_name_at_order, unit_price_cents, currency,
        quantity, modifiers_total_cents, line_total_cents, notes, station, swapped_from_item_id)
      VALUES (v_order.id, v_swap.id, v_next_line, v_swap.name, v_swap.price_cents, v_order.currency,
        v_line.quantity, 0, v_swap.price_cents * v_line.quantity, v_line.notes, v_line.station, v_line.id)
      RETURNING id INTO v_new_id;
      v_new_paid := v_new_paid + CASE WHEN COALESCE(v_order.list_subtotal_cents, 0) > 0
                                           AND v_order.list_subtotal_cents <> v_order.subtotal_cents
                                      THEN floor((v_swap.price_cents::numeric * v_line.quantity) * v_order.subtotal_cents
                                                 / v_order.list_subtotal_cents + 0.5)::bigint
                                      ELSE v_swap.price_cents::bigint * v_line.quantity END;
      -- The swap item's stock, for the new line only (too little: PT409
      -- item_sold_out naming the swap item; nothing of this call happens).
      PERFORM public.issue_4490_stock_take(ARRAY[v_order.id], 'send', v_new_id);
      PERFORM public.issue_4490_stock_give_back(v_line.id);
      UPDATE public.venue_order_items SET
        prep_state = 'voided', voided_at = now(), voided_by_user_id = p_actor,
        void_reason = 'sold_out_after_payment',
        sold_out_resolution = 'swap', sold_out_resolved_at = now(), sold_out_resolved_by_user_id = p_actor,
        swapped_to_item_id = v_new_id
      WHERE id = v_line.id;
    ELSE
      PERFORM public.issue_4490_stock_give_back(v_line.id);
      UPDATE public.venue_order_items SET
        prep_state = 'voided', voided_at = now(), voided_by_user_id = p_actor,
        void_reason = 'sold_out_after_payment',
        sold_out_resolution = 'refund', sold_out_resolved_at = now(), sold_out_resolved_by_user_id = p_actor,
        sold_out_refund_minor = v_line_paid
      WHERE id = v_line.id;
    END IF;
  END LOOP;

  -- The money back: the lines' difference (swap) or the lines (refund), plus
  -- their share of the service charge (half up).
  v_diff := CASE WHEN p_resolution = 'swap' THEN v_lines_paid - v_new_paid ELSE v_lines_paid END;
  IF v_diff > 0 AND COALESCE(v_order.subtotal_cents, 0) > 0 THEN
    v_sc_share := floor(COALESCE(v_order.service_charge_cents, 0)::numeric * v_diff / v_order.subtotal_cents + 0.5)::bigint;
  END IF;
  v_refund_total := GREATEST(v_diff, 0) + v_sc_share;
  IF v_refund_total > 0 THEN
    v_refund := public.issue_4490_venue_order_mint_partial_refund(
      v_order.id, v_refund_total, p_actor,
      'Sold out after payment: ' || array_to_string(v_names, ', '), v_key);
    IF p_resolution = 'swap' THEN
      UPDATE public.venue_order_items SET sold_out_refund_minor = 0 WHERE id = ANY (v_ids);
      UPDATE public.venue_order_items SET sold_out_refund_minor = v_refund_total
      WHERE id = (SELECT min(x::text)::uuid FROM unnest(v_ids) x);
    ELSIF v_sc_share > 0 THEN
      -- The service charge share rides on the first line.
      UPDATE public.venue_order_items SET sold_out_refund_minor = sold_out_refund_minor + v_sc_share
      WHERE id = (SELECT i.id FROM public.venue_order_items i WHERE i.id = ANY (v_ids) ORDER BY i.line_no LIMIT 1);
    END IF;
  END IF;

  -- The guest is told: text and email, once per resolution.
  SELECT count(*) INTO v_n FROM jsonb_object_keys(COALESCE(v_order.metadata->'sold_out_resolutions', '{}'::jsonb));
  v_n := v_n + 1;
  SELECT v.name INTO v_venue_name FROM public.venue_listings v WHERE v.id = v_order.venue_id;
  v_payload := jsonb_build_object(
    'venue_order_id', v_order.id,
    'venue_id', v_order.venue_id,
    'venue_name', COALESCE(NULLIF(btrim(v_venue_name), ''), 'the venue'),
    'item_name', array_to_string(v_names, ', '),
    'outcome', p_resolution,
    'swap_name', CASE WHEN p_resolution = 'swap' THEN v_swap.name END,
    'refund_minor', v_refund_total,
    'currency', v_order.currency);
  IF v_order.buyer_phone_e164 IS NOT NULL THEN
    INSERT INTO public.notification_outbox (
      category_key, user_id, contact, brand_id, payload, idempotency_key, country_code, status
    ) VALUES (
      'buyer_venue_order_sold_out', NULL, v_order.buyer_phone_e164, v_order.brand_id,
      v_payload || jsonb_build_object('channel_hint', 'sms'),
      'buyer_venue_order_sold_out:' || v_order.id::text || ':' || v_n::text || ':sms',
      public.mingla_e164_country(v_order.buyer_phone_e164), 'pending'
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  IF v_order.buyer_email IS NOT NULL THEN
    INSERT INTO public.notification_outbox (
      category_key, user_id, contact, brand_id, payload, idempotency_key, country_code, status
    ) VALUES (
      'buyer_venue_order_sold_out', NULL, v_order.buyer_email, v_order.brand_id,
      v_payload || jsonb_build_object('channel_hint', 'email'),
      'buyer_venue_order_sold_out:' || v_order.id::text || ':' || v_n::text || ':email',
      NULL, 'pending'
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  v_payload := jsonb_build_object(
    'orderId', v_order.id, 'resolution', p_resolution, 'orderItemIds', to_jsonb(v_ids),
    'swapName', CASE WHEN p_resolution = 'swap' THEN v_swap.name END,
    'refundMinor', v_refund_total,
    'refundId', v_refund->>'refundId',
    'unresolved', (SELECT count(*) FROM public.venue_order_items i
                   WHERE i.venue_order_id = v_order.id AND i.sold_out_at IS NOT NULL
                     AND i.sold_out_resolution IS NULL));
  UPDATE public.venue_orders SET
    metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{sold_out_resolutions}',
                         COALESCE(metadata->'sold_out_resolutions', '{}'::jsonb)
                           || jsonb_build_object(v_key, v_payload), true),
    station_rev = station_rev + 1,
    updated_at = now()
  WHERE id = v_order.id;
  PERFORM public.issue_4490_floor_audit(v_order.brand_id, p_actor, p_device_user, 'order.sold_out_resolve',
    'venue_order', v_order.id::text,
    jsonb_build_object('venue_id', v_order.venue_id, 'resolution', p_resolution, 'order_item_ids', to_jsonb(v_ids),
                       'swap_menu_item_id', p_swap_item_id, 'refund_minor', v_refund_total));
  RETURN v_payload || jsonb_build_object('replayed', false);
END;
$function$;

-- The staff view of one order's sold-out lines (the Orders card).
CREATE FUNCTION public.issue_4490_order_sold_out(p_order_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.venue_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.venue_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.issue_4490_can_kitchen(v_order.venue_id, p_actor)
          OR public.issue_4490_can_sell(v_order.venue_id, p_actor)
          OR public.biz_brand_effective_rank(v_order.brand_id, p_actor) >= public.biz_role_rank('event_manager')) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'orderId', v_order.id,
    'currency', v_order.currency,
    'canRefund', public.biz_brand_effective_rank(v_order.brand_id, p_actor) >= public.biz_role_rank('event_manager'),
    'canSwap', public.issue_4490_can_kitchen(v_order.venue_id, p_actor) OR public.issue_4490_can_sell(v_order.venue_id, p_actor),
    'refundUsed', EXISTS (SELECT 1 FROM public.source_refunds sr
                          WHERE sr.source_type = 'venue_menu_order' AND sr.source_id = v_order.id
                            AND sr.refund_kind = 'venue_order_line_refund'),
    'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'orderItemId', i.id, 'menuItemId', i.menu_item_id, 'name', i.item_name_at_order,
        'quantity', i.quantity, 'lineTotalMinor', i.line_total_cents, 'station', i.station,
        -- What a refund of this line returns: what was paid for it (a discount
        -- shrinks every line alike) and its share of the service charge, half
        -- up, the formula issue_4490_order_sold_out_resolve uses.
        'refundPreviewMinor', paid.v + CASE WHEN COALESCE(v_order.subtotal_cents, 0) > 0
          THEN floor(COALESCE(v_order.service_charge_cents, 0)::numeric * paid.v / v_order.subtotal_cents + 0.5)::bigint
          ELSE 0 END,
        'soldOutAt', i.sold_out_at, 'resolution', i.sold_out_resolution,
        'swappedToName', (SELECT s.item_name_at_order FROM public.venue_order_items s WHERE s.id = i.swapped_to_item_id),
        'refundedMinor', i.sold_out_refund_minor) ORDER BY i.line_no)
      FROM public.venue_order_items i
      CROSS JOIN LATERAL (SELECT CASE WHEN COALESCE(v_order.list_subtotal_cents, 0) > 0
                                           AND v_order.list_subtotal_cents <> v_order.subtotal_cents
                                      THEN floor(i.line_total_cents::numeric * v_order.subtotal_cents
                                                 / v_order.list_subtotal_cents + 0.5)::bigint
                                      ELSE i.line_total_cents::bigint END AS v) paid
      WHERE i.venue_order_id = v_order.id AND i.sold_out_at IS NOT NULL), '[]'::jsonb),
    -- What a swap may offer per line: orderable, same station, same or lower price.
    'swapOptions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'menuItemId', mi.id, 'name', mi.name, 'priceMinor', mi.price_cents,
        'station', public.issue_4490_item_station(mi.id, v_order.venue_id),
        'stockLeft', mi.stock_count) ORDER BY mi.price_cents DESC, mi.name)
      FROM public.menu_items mi
      JOIN public.menus m ON m.id = mi.menu_id AND m.is_active = true AND m.venue_id = v_order.venue_id
      WHERE mi.brand_id = v_order.brand_id AND mi.price_cents IS NOT NULL
        AND upper(mi.currency) = v_order.currency
        AND public.issue_4490_menu_item_orderable(mi.is_available, mi.stock_count)), '[]'::jsonb));
END;
$function$;

-- Every guest order at a venue still waiting for a swap or refund (Close the
-- day lists them; they never block the close).
CREATE FUNCTION public.issue_4490_sold_out_open(p_venue_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'orderId', o.id,
      'destination', COALESCE(o.spot_label_at_order, o.pickup_code),
      'items', (SELECT jsonb_agg(i.item_name_at_order ORDER BY i.line_no) FROM public.venue_order_items i
                WHERE i.venue_order_id = o.id AND i.sold_out_at IS NOT NULL AND i.sold_out_resolution IS NULL))
    ORDER BY o.created_at), '[]'::jsonb)
  FROM public.venue_orders o
  WHERE o.venue_id = p_venue_id
    AND o.metadata->>'sold_out_after_payment' = 'true'
    AND EXISTS (SELECT 1 FROM public.venue_order_items i
                WHERE i.venue_order_id = o.id AND i.sold_out_at IS NOT NULL AND i.sold_out_resolution IS NULL);
$function$;

-- T16: an order still not swapped or refunded 10 minutes after it was flagged
-- reaches rung 1 once (its own scan beside pg_venue_order_escalation_scan,
-- which stays as it was: its own idempotency and words, never a refund).
CREATE FUNCTION public.issue_4490_sold_out_escalation_scan(p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 50)
RETURNS TABLE (
  order_id uuid,
  brand_id uuid,
  venue_id uuid,
  venue_name text,
  spot_label text,
  pickup_code text,
  buyer_name text,
  item_names text,
  flagged_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH due AS (
    SELECT o.id, (o.metadata->>'sold_out_at')::timestamptz AS flagged_at
    FROM public.venue_orders o
    WHERE o.metadata->>'sold_out_after_payment' = 'true'
      AND NOT (o.metadata ? 'sold_out_escalated_at')
      AND (o.metadata->>'sold_out_at')::timestamptz <= p_now - interval '10 minutes'
      AND (o.metadata->>'sold_out_at')::timestamptz > p_now - interval '6 hours'
      AND EXISTS (SELECT 1 FROM public.venue_order_items i
                  WHERE i.venue_order_id = o.id AND i.sold_out_at IS NOT NULL AND i.sold_out_resolution IS NULL)
    ORDER BY (o.metadata->>'sold_out_at')::timestamptz
    LIMIT greatest(1, coalesce(p_limit, 50))
    FOR UPDATE OF o SKIP LOCKED
  ), claimed AS (
    UPDATE public.venue_orders o
       SET metadata = o.metadata || jsonb_build_object('sold_out_escalated_at', p_now)
      FROM due
     WHERE o.id = due.id
    RETURNING o.id, o.brand_id, o.venue_id, o.spot_label_at_order, o.pickup_code, o.buyer_name, due.flagged_at
  )
  SELECT c.id, c.brand_id, c.venue_id, COALESCE(v.name, 'your venue')::text,
         c.spot_label_at_order, c.pickup_code, c.buyer_name,
         (SELECT string_agg(i.item_name_at_order, ', ' ORDER BY i.line_no) FROM public.venue_order_items i
          WHERE i.venue_order_id = c.id AND i.sold_out_at IS NOT NULL AND i.sold_out_resolution IS NULL),
         extract(epoch FROM (p_now - c.flagged_at))::int
  FROM claimed c
  LEFT JOIN public.venue_listings v ON v.id = c.venue_id
  ORDER BY c.flagged_at;
END;
$function$;

-- Close the day shows the unresolved ones (a checked patch of the live body).
SELECT pg_temp.issue_4490_o5c_patch(
  'public.issue_4490_day_summary(uuid,date,uuid,uuid)'::regprocedure,
  $old$    'canClose', COALESCE(v_row.state, 'open') <> 'closed' AND v_blocking = 0
  );$old$,
  $new$    'canClose', COALESCE(v_row.state, 'open') <> 'closed' AND v_blocking = 0,
    -- #4490 08-O5C (T16): guest orders still waiting for a swap or refund.
    'soldOutAfterPayment', public.issue_4490_sold_out_open(v_venue.id)
  );$new$
);

-- ===========================================================================
-- 14. The guest menu reads (rule 13). public_menus_view re-emitted from its
--     latest definition (20270305001789 §6a): the one orderable rule replaces
--     `mi.is_available = true` (identical rows for an untracked item) and
--     stock_left is appended at the END (NULL when untracked; a sold-out item
--     is not in this view). public_menu_sold_out_view lists the items that are
--     on but sold out, with the same columns, for the guest page's "Sold out"
--     pills. Neither exposes stock_warn_at, cost or anything else new.
-- ===========================================================================
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
         m.venue_id,
         v.slug                AS venue_slug,
         -- Issue #1789 additive tail (SPEC #1788 P-14).
         mi.id                 AS item_id,
         mi.allows_notes,
         mi.photo_url,
         m.service_window_start,
         m.service_window_end,
         m.service_days,
         -- #4490 spec 08 O5 additive tail.
         mi.stock_count        AS stock_left
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
  WHERE public.issue_4490_menu_item_orderable(mi.is_available, mi.stock_count);

ALTER VIEW public.public_menus_view SET (security_invoker = false);
GRANT SELECT ON public.public_menus_view TO anon, authenticated;

COMMENT ON VIEW public.public_menus_view IS
  'Issue #1365 + #1789 + #4490 O5: anon menu rows for one exact verified venue, ORDERABLE items only '
  '(issue_4490_menu_item_orderable: is_available and not sold out). Unassigned and sibling-venue menus are '
  'never exposed. #1789 appends item_id, allows_notes, photo_url and the service window; #4490 appends '
  'stock_left (NULL when untracked). cost_cents, prep_station and stock_warn_at are deliberately absent.';

CREATE VIEW public.public_menu_sold_out_view AS
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
         m.venue_id,
         v.slug                AS venue_slug,
         mi.id                 AS item_id,
         mi.allows_notes,
         mi.photo_url,
         m.service_window_start,
         m.service_window_end,
         m.service_days,
         mi.stock_count        AS stock_left
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
  WHERE mi.is_available = true
    AND NOT public.issue_4490_menu_item_orderable(mi.is_available, mi.stock_count);

ALTER VIEW public.public_menu_sold_out_view SET (security_invoker = false);
REVOKE ALL ON public.public_menu_sold_out_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_menu_sold_out_view TO anon, authenticated;

COMMENT ON VIEW public.public_menu_sold_out_view IS
  '#4490 spec 08 O5: the items of public_menus_view''s venues that are switched on but SOLD OUT '
  '(NOT issue_4490_menu_item_orderable), same columns, for the guest page''s Sold out pills. Never orderable.';

-- ===========================================================================
-- 15. Grants. The orderable rule is pure and public (the anon views call it);
--     everything else is internal (service role only). The guard trigger
--     function needs no EXECUTE grant to fire.
-- ===========================================================================
REVOKE ALL ON FUNCTION public.issue_4490_menu_item_orderable(boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_4490_menu_item_orderable(boolean, integer) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.issue_4490_can_manage_menu(uuid, uuid),
  public.issue_4490_menu_item_stock_guard(),
  public.issue_4490_stock_projection(uuid),
  public.issue_4490_stock_item_venue(uuid),
  public.issue_4490_stock_set(uuid, integer, integer, uuid, uuid),
  public.issue_4490_station_sold_out(uuid, boolean, uuid),
  public.issue_4490_station_stock(uuid, text, uuid),
  public.issue_4490_stock_take(uuid[], text, uuid),
  public.issue_4490_stock_give_back(uuid),
  public.issue_4490_till_send(uuid, uuid),
  public.issue_4490_venue_order_mint_partial_refund(uuid, bigint, uuid, text, text),
  public.issue_4490_floor_audit(uuid, uuid, uuid, text, text, text, jsonb),
  public.issue_4490_order_sold_out_resolve(uuid, uuid[], text, uuid, uuid, uuid, text),
  public.issue_4490_order_sold_out(uuid, uuid),
  public.issue_4490_sold_out_open(uuid),
  public.issue_4490_sold_out_escalation_scan(timestamptz, integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_can_manage_menu(uuid, uuid),
  public.issue_4490_stock_projection(uuid),
  public.issue_4490_stock_item_venue(uuid),
  public.issue_4490_stock_set(uuid, integer, integer, uuid, uuid),
  public.issue_4490_station_sold_out(uuid, boolean, uuid),
  public.issue_4490_station_stock(uuid, text, uuid),
  public.issue_4490_stock_take(uuid[], text, uuid),
  public.issue_4490_stock_give_back(uuid),
  public.issue_4490_till_send(uuid, uuid),
  public.issue_4490_venue_order_mint_partial_refund(uuid, bigint, uuid, text, text),
  public.issue_4490_floor_audit(uuid, uuid, uuid, text, text, text, jsonb),
  public.issue_4490_order_sold_out_resolve(uuid, uuid[], text, uuid, uuid, uuid, text),
  public.issue_4490_order_sold_out(uuid, uuid),
  public.issue_4490_sold_out_open(uuid),
  public.issue_4490_sold_out_escalation_scan(timestamptz, integer)
TO service_role;

COMMIT;
