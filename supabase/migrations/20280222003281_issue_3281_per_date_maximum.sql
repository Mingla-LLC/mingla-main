-- issue #3281 — a ticket's maximum applies to each date of a by-date cart.
--
-- issue_3872_ticket_line_price checked the cart's total against the maximum, so
-- 6 + 6 was refused under "Up to 10 per date". Every other rule is unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_3872_ticket_line_price(
  p_event_id uuid,p_ticket_type_id uuid,p_qty_raw integer,p_ctx jsonb,
  p_expires_at timestamptz,p_booked_party_size integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp AS $fn$
DECLARE v_event record; v_tt record; v_qty integer; v_unit bigint; v_admits integer:=1;
  v_basis text; v_blocks integer; v_day_count integer; v_mode text; v_value_scale integer:=1; v_count_scale integer:=1;
  v_start timestamptz; v_end timestamptz;
BEGIN
  IF COALESCE(p_qty_raw,0)<=0 THEN RAISE EXCEPTION 'ticket_quantity_invalid'; END IF;
  SELECT e.event_type,e.discounts_allowed INTO v_event FROM public.events e
    WHERE e.id=p_event_id AND e.deleted_at IS NULL;
  SELECT * INTO v_tt FROM public.ticket_types t
    WHERE t.id=p_ticket_type_id AND t.event_id=p_event_id AND t.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'ticket_type_not_found'; END IF;
  IF (v_tt.is_hidden AND NOT public.issue_3827_link_unlocks_tier(v_tt.id))
     OR v_tt.is_disabled OR NOT v_tt.available_online THEN RAISE EXCEPTION 'ticket_type_unavailable'; END IF;
  IF v_tt.sale_start_at IS NOT NULL AND v_tt.sale_start_at>now() AND NOT (
    p_expires_at='infinity'::timestamptz AND EXISTS(SELECT 1 FROM public.ticket_queue_arming a
      WHERE a.ticket_type_id=v_tt.id AND a.disarmed_at IS NULL)) THEN
    RAISE EXCEPTION 'ticket_sales_not_started';
  END IF;
  IF v_tt.sale_end_at IS NOT NULL AND v_tt.sale_end_at<=now() THEN RAISE EXCEPTION 'ticket_sales_ended'; END IF;
  IF p_qty_raw<v_tt.min_purchase_qty THEN RAISE EXCEPTION 'ticket_quantity_below_min'; END IF;
  -- A by-date line over several dates arrives as its total with no day
  -- multiplier, a shape no uniform cart has. create-session checks each date.
  IF v_tt.max_purchase_qty IS NOT NULL AND p_qty_raw>v_tt.max_purchase_qty
     AND NOT (COALESCE(p_ctx->>'pricingMode','per_day')='per_day'
       AND COALESCE((p_ctx->>'dayCount')::integer,0)>1
       AND COALESCE((p_ctx->>'dayMultiplier')::integer,1)=1) THEN
    RAISE EXCEPTION 'ticket_quantity_above_max';
  END IF;

  v_day_count:=COALESCE((p_ctx->>'dayCount')::integer,0);
  v_mode:=COALESCE(p_ctx->>'pricingMode','per_day');
  v_qty:=p_qty_raw*COALESCE((p_ctx->>'dayMultiplier')::integer,1);
  v_unit:=v_tt.price_cents; v_basis:=COALESCE(v_tt.price_basis,'person');
  v_start:=NULLIF(p_ctx->>'bookedStart','')::timestamptz; v_end:=NULLIF(p_ctx->>'bookedEnd','')::timestamptz;
  IF v_event.event_type='experience' AND v_basis='group' THEN
    IF p_booked_party_size IS NULL OR p_booked_party_size<1 OR v_tt.group_max IS NULL
       OR p_booked_party_size>v_tt.group_max THEN RAISE EXCEPTION 'booked_party_invalid'; END IF;
    v_admits:=v_tt.group_max;
  ELSIF v_event.event_type='experience' AND v_basis='block' THEN
    IF v_start IS NULL OR v_end IS NULL OR v_tt.block_minutes IS NULL OR v_end<=v_start THEN
      RAISE EXCEPTION 'booked_length_invalid';
    END IF;
    v_blocks:=(extract(epoch FROM (v_end-v_start))/(v_tt.block_minutes::numeric*60.0))::integer;
    IF v_blocks<COALESCE(v_tt.min_blocks,1) OR v_blocks>COALESCE(v_tt.max_blocks,v_blocks) THEN
      RAISE EXCEPTION 'booked_length_invalid';
    END IF;
    v_unit:=v_tt.price_cents*v_blocks; v_value_scale:=v_blocks; v_count_scale:=v_blocks;
  ELSIF v_mode='all_days' AND v_day_count>0 THEN v_count_scale:=v_day_count;
  END IF;
  RETURN jsonb_build_object('ticketTypeId',v_tt.id,'ticketName',v_tt.name,
    'rawQuantity',p_qty_raw,'quantity',v_qty,'unitPriceCents',v_unit,'totalCents',v_unit*v_qty,
    'admitsCount',v_admits,'priceBasis',v_basis,'blocks',v_blocks,'currency',v_tt.currency,
    'isFree',COALESCE(v_tt.is_free,false) OR COALESCE(v_tt.price_cents,0)=0,
    'discountsAllowed',COALESCE(v_event.discounts_allowed,true) AND COALESCE(v_tt.discounts_allowed,true),
    'valueScale',v_value_scale,'countScale',v_count_scale);
END;
$fn$;

DO $verify$
BEGIN
  IF position('dayMultiplier'')::integer,1)=1' IN pg_get_functiondef(
    'public.issue_3872_ticket_line_price(uuid, uuid, integer, jsonb, timestamptz, integer)'::regprocedure
  )) = 0 THEN
    RAISE EXCEPTION 'issue_3281_per_date_maximum: line price is not terminal';
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
