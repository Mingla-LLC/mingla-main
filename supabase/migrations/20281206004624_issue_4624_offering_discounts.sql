-- Issue #4624 — Hosts can limit a discount to one or more whole offerings.
--
-- Function replacements and one new read RPC only: no table, column, policy or
-- data change, so the file can be re-run safely.
--   2a. issue_3872_target_guard: a 'listings' discount only holds whole-offering
--       targets (event, venue_menu, venue_deposit). Raises listings_target_invalid.
--   2b. brand_discount_offerings(uuid): the picker's events, experiences and trips.
--   2c. brand_discount_preview(uuid,jsonb): an offering-scoped draft previews only
--       the chosen offerings' tickets; every row names its offering (listingName).
--   2d. brand_prices_overview(uuid) (D2): tickets of draft, scheduled and live
--       offerings are listed (the old e.status='published' matched no row, because
--       events_status_check allows only draft/scheduled/live/ended/cancelled), and
--       each menu item joins its own venue through menus.venue_id, so a brand with
--       two venues no longer lists every menu item twice.
-- Quote and checkout are unchanged: the engine already resolves an 'event'
-- target from each line's listingId at quote time (spec F-1..F-3).

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 2a. Target guard (body of 20271216003872 lines 103-140, plus the scope check).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_3872_target_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE
  v_discount public.brand_discounts%ROWTYPE;
BEGIN
  SELECT * INTO v_discount FROM public.brand_discounts WHERE id = NEW.discount_id;
  -- #4624: an offering-scoped discount covers whole offerings only.
  IF v_discount.scope_kind = 'listings'
     AND NEW.target_kind NOT IN ('event','venue_menu','venue_deposit') THEN
    RAISE EXCEPTION 'listings_target_invalid';
  END IF;

  IF v_discount.value_type = 'set_price' OR v_discount.kind = 'sale_price' THEN
    IF NEW.target_kind NOT IN ('ticket_type','menu_item','venue_deposit') THEN
      RAISE EXCEPTION 'set_price_needs_one_item';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.brand_discount_targets
      WHERE discount_id = NEW.discount_id AND id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'set_price_needs_one_item';
    END IF;
  END IF;

  IF v_discount.kind = 'sale_price' AND EXISTS (
    SELECT 1
    FROM public.brand_discount_targets t
    JOIN public.brand_discounts d ON d.id = t.discount_id
    WHERE t.discount_id <> NEW.discount_id
      AND t.target_kind = NEW.target_kind
      AND t.target_id = NEW.target_id
      AND t.orphaned_at IS NULL
      AND d.brand_id = v_discount.brand_id
      AND d.kind = 'sale_price'
      AND d.status IN ('active','paused')
      AND d.deleted_at IS NULL
      AND tstzrange(d.starts_at, d.ends_at, '[)') &&
          tstzrange(v_discount.starts_at, v_discount.ends_at, '[)')
  ) THEN
    RAISE EXCEPTION 'sale_price_overlap';
  END IF;
  RETURN NEW;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 2b. The offerings a Host can pick for a 'listings' discount.
-- nextStartAt: the earliest date that has not ended (null when none);
-- lastEndAt: the last date's end, for "Ended · {date}" / "Cancelled · {date}".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.brand_discount_offerings(p_brand_id uuid)
RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp
AS $fn$
  WITH allowed AS (
    SELECT COALESCE(public.biz_brand_effective_rank(p_brand_id,auth.uid()),0)>=20 ok
  )
  SELECT jsonb_build_object(
    'id',e.id,
    'offeringKind',e.event_type,
    'title',e.title,
    'status',e.status,
    'discountsAllowed',e.discounts_allowed,
    'paidTicketCount',(
      SELECT count(*) FROM public.ticket_types tt
      WHERE tt.event_id=e.id AND tt.deleted_at IS NULL
        AND NOT COALESCE(tt.is_free,false) AND tt.price_cents>0
    ),
    'nextStartAt',(
      SELECT min(d.start_at) FROM public.event_dates d
      WHERE d.event_id=e.id AND d.end_at>now()
    ),
    'lastEndAt',(
      SELECT max(d.end_at) FROM public.event_dates d WHERE d.event_id=e.id
    )
  )
  FROM public.events e,allowed
  WHERE allowed.ok AND e.brand_id=p_brand_id AND e.deleted_at IS NULL
    AND e.event_type IN ('event','experience','trip')
  ORDER BY e.event_type,e.title,e.id;
$fn$;
REVOKE ALL ON FUNCTION public.brand_discount_offerings(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brand_discount_offerings(uuid) TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 2c. Preview (body of 20271216003872 lines 1065-1085). Only the line choice
-- changes for scope 'listings'; every row now also carries listingName.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.brand_discount_preview(p_brand_id uuid,p_draft jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $fn$
DECLARE v_rank integer; v_lines jsonb; v_def jsonb; v_quote jsonb; v_listings boolean; v_event_ids uuid[];
BEGIN
  v_rank:=COALESCE(public.biz_brand_effective_rank(p_brand_id,auth.uid()),0);
  IF v_rank<20 AND COALESCE(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'insufficient_permission'; END IF;
  v_listings:=COALESCE(p_draft->>'scopeKind','')='listings';
  IF v_listings THEN
    SELECT COALESCE(array_agg((t->>'targetId')::uuid),'{}'::uuid[]) INTO v_event_ids
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_draft->'targets')='array' THEN p_draft->'targets' ELSE '[]'::jsonb END) t
    WHERE t->>'targetKind'='event'
      AND t->>'targetId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  END IF;
  SELECT COALESCE(jsonb_agg(line ORDER BY line->>'lineRef'),'[]'::jsonb) INTO v_lines FROM (
    SELECT jsonb_build_object('lineRef',tt.id::text,'itemKind','ticket_type','itemId',tt.id,'listingId',e.id,
      'listingKind',e.event_type,'listUnitMinor',tt.price_cents,'qty',1,'valueScale',1,'countScale',1,
      'allowed',e.discounts_allowed AND tt.discounts_allowed AND NOT COALESCE(tt.is_free,false),'tz',COALESCE(e.timezone,'UTC')) line
    FROM public.ticket_types tt JOIN public.events e ON e.id=tt.event_id
    WHERE e.brand_id=p_brand_id AND e.deleted_at IS NULL AND tt.deleted_at IS NULL AND tt.price_cents>0
      AND (NOT v_listings OR e.id=ANY(v_event_ids))
    ORDER BY tt.created_at LIMIT 5
  ) q;
  v_def:=p_draft||jsonb_build_object('id',COALESCE(p_draft->>'id',gen_random_uuid()::text),'createdAt',now(),'status','active','deletedAt',NULL,'needsAttention',NULL,'limited',false,'remainingUnits',NULL,'remainingTotalUses',NULL,'remainingBuyerUses',NULL);
  v_quote:=public.issue_3872_discount_apply(jsonb_build_object('currency',upper((SELECT pricing_currency FROM public.brands WHERE id=p_brand_id)),
    'at',now(),'queued',false,'lines',v_lines,'automatics',CASE WHEN v_def->>'kind'='code' THEN '[]'::jsonb ELSE jsonb_build_array(v_def) END,
    'code',CASE WHEN v_def->>'kind'='code' THEN v_def ELSE NULL END,'codeLookup',CASE WHEN v_def->>'kind'='code' THEN 'found' ELSE 'none' END));
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('itemName',tt.name,'listingName',e.title,'listUnitMinor',(l->>'listUnitMinor')::integer,'netUnitMinor',(l->>'netUnitMinor')::integer,
    'allInListCents',public.compute_all_in_cents((l->>'listUnitMinor')::integer,COALESCE(e.pass_mingla_fee,b.default_pass_mingla_fee),COALESCE(e.pass_service_fee,b.default_pass_service_fee),(SELECT effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id))),
    'allInNetCents',public.compute_all_in_cents((l->>'netUnitMinor')::integer,COALESCE(e.pass_mingla_fee,b.default_pass_mingla_fee),COALESCE(e.pass_service_fee,b.default_pass_service_fee),(SELECT effective_take_rate_bps FROM public.resolve_effective_take_rate_bps(b.id)))
  )),'[]'::jsonb) FROM jsonb_array_elements(v_quote->'lines') l JOIN public.ticket_types tt ON tt.id=(l->>'lineRef')::uuid JOIN public.events e ON e.id=tt.event_id JOIN public.brands b ON b.id=e.brand_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.brand_discount_preview(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brand_discount_preview(uuid,jsonb) TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 2d (D2). Prices overview (body of 20271216043872 lines 556-597), two fixes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.brand_prices_overview(p_brand_id uuid)
RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp
AS $fn$
  WITH allowed AS (
    SELECT COALESCE(public.biz_brand_effective_rank(p_brand_id,auth.uid()),0)>=20 ok
  ), rows AS (
    SELECT 'ticket_type'::text kind,tt.id,e.title listing_name,tt.name item_name,
      tt.price_cents list_unit_cents,tt.discounts_allowed AND e.discounts_allowed discounts_allowed,
      '/event/'||e.id::text owner_route
    FROM public.ticket_types tt JOIN public.events e ON e.id=tt.event_id,allowed
    WHERE allowed.ok AND e.brand_id=p_brand_id AND e.status IN ('draft','scheduled','live')
      AND e.event_type<>'rsvp' AND e.deleted_at IS NULL AND tt.deleted_at IS NULL
      AND NOT tt.is_free
    UNION ALL
    SELECT 'menu_item',mi.id,COALESCE(m.name,'Menu'),mi.name,mi.price_cents,
      mi.discounts_allowed,'/venue/'||COALESCE(vl.id,mi.menu_id)::text||'?module=menu'
    FROM public.menu_items mi JOIN public.menus m ON m.id=mi.menu_id
    LEFT JOIN public.venue_listings vl ON vl.id=m.venue_id,allowed
    WHERE allowed.ok AND mi.brand_id=p_brand_id
    UNION ALL
    SELECT 'venue_deposit',s.venue_id,'Reservation deposit','Deposit',s.fee_amount_cents,
      s.discounts_allowed,'/venue/'||s.venue_id::text||'?module=settings'
    FROM public.venue_reservation_settings s,allowed
    WHERE allowed.ok AND s.brand_id=p_brand_id AND s.fee_enabled AND s.fee_amount_cents>0
  )
  SELECT jsonb_build_object(
    'kind',r.kind,'id',r.id,'listingName',r.listing_name,'itemName',r.item_name,
    'listUnitCents',r.list_unit_cents,'currentSaleCents',sale.value_minor,
    'saleEndsAt',sale.ends_at,'discountsAllowed',r.discounts_allowed,'ownerRoute',r.owner_route
  )
  FROM rows r
  LEFT JOIN LATERAL (
    SELECT d.value_minor,d.ends_at FROM public.brand_discount_targets t
    JOIN public.brand_discounts d ON d.id=t.discount_id
    WHERE t.target_kind=r.kind AND t.target_id=r.id AND t.orphaned_at IS NULL
      AND d.kind='sale_price' AND d.status='active' AND d.deleted_at IS NULL
      AND d.starts_at<=now() AND (d.ends_at IS NULL OR d.ends_at>now())
    ORDER BY d.starts_at DESC,d.id LIMIT 1
  ) sale ON true
  ORDER BY r.listing_name,r.item_name,r.id;
$fn$;
REVOKE ALL ON FUNCTION public.brand_prices_overview(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brand_prices_overview(uuid) TO authenticated,service_role;

COMMIT;
