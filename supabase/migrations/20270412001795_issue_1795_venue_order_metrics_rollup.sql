-- Issue #1795 — venue-exact standing order intelligence.
-- Additive, read-only RPC. No order, refund, payout, or provider writer changes.

BEGIN;

CREATE FUNCTION public.venue_order_metrics_rollup(
  p_brand_id uuid,
  p_venue_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_venue_brand_id uuid;
  v_place_pool_id uuid;
  v_authorized boolean;
  v_tz text;
  v_tz_confidence text;
  v_offset_min integer;
  v_local_today date;
  v_local_start date;
  v_capture_started date;
  v_result jsonb;
BEGIN
  IF p_brand_id IS NULL OR p_venue_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT venue.brand_id, venue.place_pool_id
    INTO v_venue_brand_id, v_place_pool_id
    FROM public.venue_listings venue
   WHERE venue.id = p_venue_id
     AND venue.brand_id = p_brand_id;

  v_authorized := v_venue_brand_id IS NOT NULL
    AND (
      public.is_admin_user()
      OR public.biz_is_brand_member_for_read_for_caller(v_venue_brand_id)
    );

  IF NOT v_authorized THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'brand_id', p_brand_id,
      'venue_id', p_venue_id,
      'authorized', false,
      'resolved_timezone', NULL,
      'tz_confidence', NULL,
      'window', jsonb_build_object(
        'days', 30,
        'local_start_date', NULL,
        'local_end_date', NULL,
        'capture_started_at', NULL,
        'window_complete', false,
        'service_days', 0,
        'state', 'unauthorized',
        'thin_label', NULL
      ),
      'orders_30d', 0,
      'channel_split', jsonb_build_object('qr',0,'page',0,'counter_pickup',0,'staff',0),
      'money_state_by_currency', '{}'::jsonb,
      'unallocated_refunds_by_currency', '{}'::jsonb,
      'sales_cents_30d', '{}'::jsonb,
      'tips_cents_30d', '{}'::jsonb,
      'spend_per_order', '{}'::jsonb,
      'spend_per_cover_tier_a', '{}'::jsonb,
      'tier_a_currency_conflict_reservations', 0,
      'attach_counts', jsonb_build_object(
        'state','not_applicable','ordered_reservations',0,
        'seated_reservations',0,'window_complete',false
      ),
      'placed_at_by_daypart', jsonb_build_array(
        jsonb_build_object('daypart','morning','orders',0),
        jsonb_build_object('daypart','afternoon','orders',0),
        jsonb_build_object('daypart','evening','orders',0),
        jsonb_build_object('daypart','late_night','orders',0)
      ),
      'placed_at_by_iso_weekday', (
        SELECT jsonb_agg(jsonb_build_object('iso_weekday',n,'orders',0) ORDER BY n)
          FROM generate_series(1,7) n
      ),
      'daily_30d', '[]'::jsonb,
      'items_by_velocity', '[]'::jsonb,
      'revenue_by_zone', '[]'::jsonb,
      'revenue_by_room', '[]'::jsonb,
      'data_completeness', jsonb_build_object(
        'active_tables_missing_zone',0,'sold_items_missing_cost',0,
        'tier_a_currency_conflict_reservations',0,
        'show_zone_todo',false,'show_item_cost_todo',false
      )
    );
  END IF;

  SELECT availability.iana_timezone
    INTO v_tz
    FROM public.venue_availability_config availability
    JOIN public.analytics_iana_timezones valid_timezone
      ON valid_timezone.name = availability.iana_timezone
   WHERE availability.brand_id = p_brand_id
     AND availability.venue_id = p_venue_id
   LIMIT 1;

  IF v_tz IS NOT NULL THEN
    v_tz_confidence := 'iana';
  ELSE
    SELECT place.utc_offset_minutes
      INTO v_offset_min
      FROM public.place_pool place
     WHERE place.id = v_place_pool_id
       AND place.utc_offset_minutes IS NOT NULL;
    IF v_offset_min IS NOT NULL THEN
      v_tz_confidence := 'offset';
    ELSE
      v_tz := 'UTC';
      v_tz_confidence := 'utc';
      v_offset_min := 0;
    END IF;
  END IF;

  v_local_today := CASE
    WHEN v_tz IS NOT NULL THEN (now() AT TIME ZONE v_tz)::date
    ELSE (now() + make_interval(mins => v_offset_min))::date
  END;
  v_local_start := v_local_today - 29;

  SELECT min(CASE
      WHEN v_tz IS NOT NULL THEN (o.created_at AT TIME ZONE v_tz)::date
      ELSE (o.created_at + make_interval(mins => v_offset_min))::date
    END)
    INTO v_capture_started
    FROM public.venue_orders o
   WHERE o.brand_id = p_brand_id
     AND o.venue_id = p_venue_id
     AND coalesce(o.metadata->>'tab_settlement','') <> 'true';

  WITH
  scoped_orders AS MATERIALIZED (
    SELECT
      o.*,
      CASE
        WHEN v_tz IS NOT NULL THEN o.created_at AT TIME ZONE v_tz
        ELSE (o.created_at + make_interval(mins => v_offset_min))::timestamp
      END AS local_placed_at
    FROM public.venue_orders o
    WHERE o.brand_id = p_brand_id
      AND o.venue_id = p_venue_id
      AND CASE
        WHEN v_tz IS NOT NULL THEN (o.created_at AT TIME ZONE v_tz)::date
        ELSE (o.created_at + make_interval(mins => v_offset_min))::date
      END > v_local_today - 30
  ),
  settlement_state AS MATERIALIZED (
    SELECT DISTINCT ON (o.session_id)
      o.session_id,
      o.currency,
      o.payment_status,
      o.refunded_amount_cents,
      o.id
    FROM scoped_orders o
    WHERE coalesce(o.metadata->>'tab_settlement','') = 'true'
    ORDER BY o.session_id, o.created_at DESC, o.id DESC
  ),
  eligible_orders AS MATERIALIZED (
    SELECT
      o.*,
      o.local_placed_at::date AS local_date,
      extract(isodow FROM o.local_placed_at)::int AS iso_weekday,
      CASE
        WHEN o.local_placed_at::time >= time '05:00' AND o.local_placed_at::time < time '12:00' THEN 'morning'
        WHEN o.local_placed_at::time >= time '12:00' AND o.local_placed_at::time < time '17:00' THEN 'afternoon'
        WHEN o.local_placed_at::time >= time '17:00' AND o.local_placed_at::time < time '21:00' THEN 'evening'
        ELSE 'late_night'
      END AS daypart
    FROM scoped_orders o
    LEFT JOIN settlement_state settlement ON settlement.session_id = o.session_id
    WHERE coalesce(o.metadata->>'tab_settlement','') <> 'true'
      AND o.payment_status IN ('paid','partial_refund')
      AND NOT coalesce((
        settlement.payment_status = 'refunded'
        OR (
          settlement.refunded_amount_cents >= o.total_cents
          AND settlement.payment_status <> 'partial_refund'
        )
      ), false)
  ),
  partial_sources AS MATERIALIZED (
    SELECT o.id, o.currency, o.refunded_amount_cents
      FROM eligible_orders o
     WHERE o.payment_status = 'partial_refund'
    UNION ALL
    SELECT settlement.id, settlement.currency, settlement.refunded_amount_cents
      FROM settlement_state settlement
     WHERE settlement.payment_status = 'partial_refund'
       AND EXISTS (
         SELECT 1 FROM eligible_orders child
          WHERE child.session_id = settlement.session_id
       )
  ),
  currencies AS (
    SELECT DISTINCT currency FROM eligible_orders
  ),
  money_state AS (
    SELECT currency,
      CASE WHEN EXISTS (
        SELECT 1 FROM partial_sources p WHERE p.currency = currencies.currency
      ) THEN 'partial_refund_unallocated' ELSE 'complete' END AS state
    FROM currencies
  ),
  complete_orders AS MATERIALIZED (
    SELECT o.*
      FROM eligible_orders o
      JOIN money_state money ON money.currency = o.currency
     WHERE money.state = 'complete'
  ),
  service_days AS (
    SELECT count(DISTINCT local_date)::int AS n FROM eligible_orders
  ),
  money_totals AS (
    SELECT currency,
      sum(fee_basis_cents)::bigint AS sales,
      sum(tip_cents)::bigint AS tips,
      count(*)::bigint AS orders
    FROM complete_orders
    GROUP BY currency
  ),
  partial_totals AS (
    SELECT currency, count(*)::bigint AS orders,
      sum(refunded_amount_cents)::bigint AS cents
    FROM partial_sources
    GROUP BY currency
  ),
  reservation_currency AS MATERIALIZED (
    SELECT
      s.reservation_id,
      count(DISTINCT o.currency)::int AS currencies,
      min(o.currency) AS currency,
      count(DISTINCT s.id)::bigint AS sessions,
      bool_and(money.state = 'complete') AS money_complete,
      sum(CASE WHEN money.state = 'complete' THEN o.fee_basis_cents ELSE 0 END)::bigint AS sales
    FROM eligible_orders o
    JOIN money_state money ON money.currency = o.currency
    JOIN public.venue_order_sessions s
      ON s.id = o.session_id
     AND s.brand_id = p_brand_id
     AND s.venue_id = p_venue_id
    JOIN public.reservations r
      ON r.id = s.reservation_id
     AND r.brand_id = p_brand_id
     AND r.venue_id = p_venue_id
     AND r.status IN ('seated','completed')
    WHERE s.reservation_id IS NOT NULL
      AND s.currency = o.currency
    GROUP BY s.reservation_id
  ),
  tier_a AS (
    SELECT rc.currency,
      count(*)::bigint AS reservations,
      sum(rc.sessions)::bigint AS sessions,
      sum(r.party_size)::bigint AS covers,
      sum(rc.sales)::bigint AS sales
    FROM reservation_currency rc
    JOIN public.reservations r ON r.id = rc.reservation_id
    WHERE rc.currencies = 1 AND rc.money_complete
    GROUP BY rc.currency
  ),
  tier_a_conflicts AS (
    SELECT count(*)::int AS n FROM reservation_currency WHERE currencies > 1
  ),
  reservations_window AS MATERIALIZED (
    SELECT r.id
    FROM public.reservations r
    WHERE r.brand_id = p_brand_id
      AND r.venue_id = p_venue_id
      AND r.status IN ('seated','completed')
      AND CASE
        WHEN v_tz IS NOT NULL THEN (r.reserved_for AT TIME ZONE v_tz)::date
        ELSE (r.reserved_for + make_interval(mins => v_offset_min))::date
      END > v_local_today - 30
  ),
  item_base AS MATERIALIZED (
    SELECT i.menu_item_id, i.item_name_at_order, i.quantity,
      i.line_total_cents, i.currency, i.venue_order_id,
      o.local_date, o.daypart, o.created_at
    FROM eligible_orders o
    JOIN public.venue_order_items i ON i.venue_order_id = o.id
  ),
  item_identity AS (
    SELECT DISTINCT ON (menu_item_id)
      menu_item_id, item_name_at_order
    FROM item_base
    ORDER BY menu_item_id, created_at DESC, venue_order_id DESC
  ),
  item_counts AS (
    SELECT menu_item_id,
      sum(quantity)::bigint AS quantity,
      count(DISTINCT venue_order_id)::bigint AS orders,
      count(DISTINCT local_date)::int AS service_days
    FROM item_base
    GROUP BY menu_item_id
  ),
  item_dayparts AS (
    SELECT menu_item_id, daypart, sum(quantity)::bigint AS quantity
    FROM item_base
    GROUP BY menu_item_id, daypart
  ),
  item_money AS (
    SELECT item.menu_item_id, item.currency,
      sum(item.line_total_cents)::bigint AS cents
    FROM item_base item
    JOIN money_state money ON money.currency = item.currency AND money.state = 'complete'
    GROUP BY item.menu_item_id, item.currency
  ),
  zone_counts AS (
    SELECT coalesce(nullif(btrim(zone_at_order),''),'Unzoned') AS zone,
      count(*)::bigint AS orders, count(DISTINCT session_id)::bigint AS sessions
    FROM eligible_orders GROUP BY 1
  ),
  zone_capacity AS (
    SELECT coalesce(nullif(btrim(zone),''),'Unzoned') AS zone,
      sum(capacity)::bigint AS seats
    FROM public.venue_tables
    WHERE brand_id = p_brand_id AND venue_id = p_venue_id AND is_active
    GROUP BY 1
  ),
  zone_money AS (
    SELECT coalesce(nullif(btrim(o.zone_at_order),''),'Unzoned') AS zone,
      o.currency, sum(o.fee_basis_cents)::bigint AS cents
    FROM complete_orders o GROUP BY 1, o.currency
  ),
  room_counts AS (
    SELECT stay_unit_id, count(*)::bigint AS orders,
      count(DISTINCT session_id)::bigint AS sessions
    FROM eligible_orders WHERE stay_unit_id IS NOT NULL GROUP BY stay_unit_id
  ),
  room_label AS (
    SELECT DISTINCT ON (stay_unit_id) stay_unit_id,
      coalesce(nullif(btrim(spot_label_at_order),''),'Room') AS label
    FROM eligible_orders
    WHERE stay_unit_id IS NOT NULL
    ORDER BY stay_unit_id,
      (nullif(btrim(spot_label_at_order),'') IS NOT NULL) DESC,
      created_at DESC, id DESC
  ),
  room_money AS (
    SELECT stay_unit_id, currency, sum(fee_basis_cents)::bigint AS cents
    FROM complete_orders WHERE stay_unit_id IS NOT NULL
    GROUP BY stay_unit_id, currency
  ),
  missing_cost AS (
    SELECT count(DISTINCT item.menu_item_id)::int AS n
    FROM item_base item
    JOIN public.menu_items current_item ON current_item.id = item.menu_item_id
    JOIN public.menus menu ON menu.id = current_item.menu_id
    WHERE menu.brand_id = p_brand_id
      AND menu.venue_id = p_venue_id
      AND current_item.cost_cents IS NULL
  ),
  missing_zone AS (
    SELECT count(*)::int AS n
    FROM public.venue_tables table_row
    WHERE table_row.brand_id = p_brand_id
      AND table_row.venue_id = p_venue_id
      AND table_row.is_active
      AND nullif(btrim(table_row.zone),'') IS NULL
  ),
  reservations_enabled AS (
    SELECT coalesce(bool_or(settings.reservations_enabled),false) AS enabled
    FROM public.venue_reservation_settings settings
    WHERE settings.brand_id = p_brand_id AND settings.venue_id = p_venue_id
  ),
  daily AS (
    SELECT day::date AS local_date FROM generate_series(
      v_local_start::timestamp, v_local_today::timestamp, interval '1 day'
    ) day
  )
  SELECT jsonb_build_object(
    'schema_version', 1,
    'brand_id', p_brand_id,
    'venue_id', p_venue_id,
    'authorized', true,
    'resolved_timezone', CASE WHEN v_tz_confidence = 'offset' THEN
      'UTC' || CASE WHEN v_offset_min >= 0 THEN '+' ELSE '-' END
      || lpad((abs(v_offset_min)/60)::text,2,'0') || ':'
      || lpad((abs(v_offset_min)%60)::text,2,'0')
      ELSE v_tz END,
    'tz_confidence', v_tz_confidence,
    'window', jsonb_build_object(
      'days',30,'local_start_date',v_local_start,'local_end_date',v_local_today,
      'capture_started_at',v_capture_started,
      'window_complete',coalesce(v_capture_started <= v_local_start,false),
      'service_days',(SELECT n FROM service_days),
      'state',CASE
        WHEN NOT EXISTS (SELECT 1 FROM eligible_orders) THEN 'none'
        WHEN (SELECT n FROM service_days) < 14 THEN 'early'
        WHEN NOT coalesce(v_capture_started <= v_local_start,false) THEN 'early'
        ELSE 'ready' END,
      'thin_label',CASE
        WHEN NOT EXISTS (SELECT 1 FROM eligible_orders) THEN 'No orders yet'
        WHEN (SELECT n FROM service_days) < 14 THEN
          'Early numbers - ' || (SELECT n FROM service_days) || ' days of orders'
        WHEN NOT coalesce(v_capture_started <= v_local_start,false) THEN
          'Building a full 30-day view'
        ELSE NULL END
    ),
    'orders_30d',(SELECT count(*) FROM eligible_orders),
    'channel_split',jsonb_build_object(
      'qr',(SELECT count(*) FROM eligible_orders WHERE source='guest_qr'),
      'page',(SELECT count(*) FROM eligible_orders WHERE source='guest_page' AND pickup_code IS NULL),
      'counter_pickup',(SELECT count(*) FROM eligible_orders WHERE source='guest_page' AND pickup_code IS NOT NULL),
      'staff',(SELECT count(*) FROM eligible_orders WHERE source='staff')
    ),
    'money_state_by_currency',coalesce((
      SELECT jsonb_object_agg(currency,state ORDER BY currency) FROM money_state
    ),'{}'::jsonb),
    'unallocated_refunds_by_currency',coalesce((
      SELECT jsonb_object_agg(currency,jsonb_build_object('orders',orders,'cents',cents) ORDER BY currency)
      FROM partial_totals
    ),'{}'::jsonb),
    'sales_cents_30d',coalesce((SELECT jsonb_object_agg(currency,sales ORDER BY currency) FROM money_totals),'{}'::jsonb),
    'tips_cents_30d',coalesce((SELECT jsonb_object_agg(currency,tips ORDER BY currency) FROM money_totals),'{}'::jsonb),
    'spend_per_order',coalesce((
      SELECT jsonb_object_agg(currency,jsonb_build_object(
        'sales_cents',sales,'orders',orders,
        'average_cents',round(sales::numeric/nullif(orders,0))::bigint
      ) ORDER BY currency) FROM money_totals
    ),'{}'::jsonb),
    'spend_per_cover_tier_a',coalesce((
      SELECT jsonb_object_agg(currency,jsonb_build_object(
        'sales_cents',sales,'reservations',reservations,'sessions',sessions,
        'covers',covers,
        'average_cents',CASE WHEN covers=0 THEN NULL ELSE round(sales::numeric/covers)::bigint END,
        'sample_state',CASE WHEN covers=0 THEN 'none' ELSE 'measured' END,
        'label','Measured on ' || covers || ' covers'
      ) ORDER BY currency) FROM tier_a
    ),'{}'::jsonb),
    'tier_a_currency_conflict_reservations',(SELECT n FROM tier_a_conflicts),
    'attach_counts',jsonb_build_object(
      'state',CASE WHEN (SELECT enabled FROM reservations_enabled) THEN 'counted' ELSE 'not_applicable' END,
      'ordered_reservations',CASE WHEN (SELECT enabled FROM reservations_enabled) THEN (
        SELECT count(DISTINCT r.id) FROM reservations_window r
        WHERE EXISTS (SELECT 1 FROM eligible_orders o WHERE o.reservation_id=r.id)
      ) ELSE 0 END,
      'seated_reservations',CASE WHEN (SELECT enabled FROM reservations_enabled) THEN
        (SELECT count(*) FROM reservations_window) ELSE 0 END,
      'window_complete',coalesce(v_capture_started <= v_local_start,false)
    ),
    'placed_at_by_daypart',(
      SELECT jsonb_agg(jsonb_build_object('daypart',d.daypart,'orders',(
        SELECT count(*) FROM eligible_orders o WHERE o.daypart=d.daypart
      )) ORDER BY d.ord)
      FROM (VALUES ('morning',1),('afternoon',2),('evening',3),('late_night',4)) d(daypart,ord)
    ),
    'placed_at_by_iso_weekday',(
      SELECT jsonb_agg(jsonb_build_object('iso_weekday',n,'orders',(
        SELECT count(*) FROM eligible_orders o WHERE o.iso_weekday=n
      )) ORDER BY n) FROM generate_series(1,7) n
    ),
    'daily_30d',(
      SELECT jsonb_agg(jsonb_build_object(
        'local_date',d.local_date,
        'orders',(SELECT count(*) FROM eligible_orders o WHERE o.local_date=d.local_date),
        'sales_cents',coalesce((SELECT jsonb_object_agg(x.currency,x.cents ORDER BY x.currency) FROM (
          SELECT o.currency,sum(o.fee_basis_cents)::bigint AS cents FROM complete_orders o
          WHERE o.local_date=d.local_date GROUP BY o.currency
        ) x),'{}'::jsonb),
        'tips_cents',coalesce((SELECT jsonb_object_agg(x.currency,x.cents ORDER BY x.currency) FROM (
          SELECT o.currency,sum(o.tip_cents)::bigint AS cents FROM complete_orders o
          WHERE o.local_date=d.local_date GROUP BY o.currency
        ) x),'{}'::jsonb),
        'money_state_by_currency',coalesce((SELECT jsonb_object_agg(currency,state ORDER BY currency) FROM money_state),'{}'::jsonb)
      ) ORDER BY d.local_date) FROM daily d
    ),
    'items_by_velocity',coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'menu_item_id',counts.menu_item_id,
        'item_name_snapshot',identity.item_name_at_order,
        'quantity',counts.quantity,'orders',counts.orders,
        'service_days',counts.service_days,
        'units_per_service_day',round(counts.quantity::numeric/nullif(counts.service_days,0),4),
        'by_daypart',(SELECT jsonb_agg(jsonb_build_object('daypart',d.daypart,'quantity',coalesce(parts.quantity,0)) ORDER BY d.ord)
          FROM (VALUES ('morning',1),('afternoon',2),('evening',3),('late_night',4)) d(daypart,ord)
          LEFT JOIN item_dayparts parts ON parts.menu_item_id=counts.menu_item_id AND parts.daypart=d.daypart),
        'sales_cents',coalesce((SELECT jsonb_object_agg(currency,cents ORDER BY currency) FROM item_money money WHERE money.menu_item_id=counts.menu_item_id),'{}'::jsonb),
        'money_state_by_currency',coalesce((SELECT jsonb_object_agg(state.currency,state.state ORDER BY state.currency)
          FROM money_state state WHERE EXISTS (SELECT 1 FROM item_base b WHERE b.menu_item_id=counts.menu_item_id AND b.currency=state.currency)),'{}'::jsonb)
      ) ORDER BY counts.quantity DESC, identity.item_name_at_order, counts.menu_item_id)
      FROM item_counts counts JOIN item_identity identity USING (menu_item_id)
    ),'[]'::jsonb),
    'revenue_by_zone',coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'zone',counts.zone,'orders',counts.orders,'sessions',counts.sessions,
        'current_seat_capacity',capacity.seats,
        'sales_cents',coalesce((SELECT jsonb_object_agg(currency,cents ORDER BY currency) FROM zone_money money WHERE money.zone=counts.zone),'{}'::jsonb),
        'sales_per_current_seat_cents',CASE WHEN coalesce(capacity.seats,0)=0 THEN '{}'::jsonb ELSE coalesce((
          SELECT jsonb_object_agg(currency,round(cents::numeric/capacity.seats)::bigint ORDER BY currency) FROM zone_money money WHERE money.zone=counts.zone
        ),'{}'::jsonb) END,
        'money_state_by_currency',coalesce((SELECT jsonb_object_agg(state.currency,state.state ORDER BY state.currency)
          FROM money_state state WHERE EXISTS (SELECT 1 FROM eligible_orders o WHERE coalesce(nullif(btrim(o.zone_at_order),''),'Unzoned')=counts.zone AND o.currency=state.currency)),'{}'::jsonb)
      ) ORDER BY counts.orders DESC, counts.zone)
      FROM zone_counts counts LEFT JOIN zone_capacity capacity USING (zone)
    ),'[]'::jsonb),
    'revenue_by_room',coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'stay_unit_id',counts.stay_unit_id,'spot_label_snapshot',label.label,
        'orders',counts.orders,'sessions',counts.sessions,
        'sales_cents',coalesce((SELECT jsonb_object_agg(currency,cents ORDER BY currency) FROM room_money money WHERE money.stay_unit_id=counts.stay_unit_id),'{}'::jsonb),
        'money_state_by_currency',coalesce((SELECT jsonb_object_agg(state.currency,state.state ORDER BY state.currency)
          FROM money_state state WHERE EXISTS (SELECT 1 FROM eligible_orders o WHERE o.stay_unit_id=counts.stay_unit_id AND o.currency=state.currency)),'{}'::jsonb)
      ) ORDER BY counts.orders DESC, label.label, counts.stay_unit_id)
      FROM room_counts counts JOIN room_label label USING (stay_unit_id)
    ),'[]'::jsonb),
    'data_completeness',jsonb_build_object(
      'active_tables_missing_zone',(SELECT n FROM missing_zone),
      'sold_items_missing_cost',(SELECT n FROM missing_cost),
      'tier_a_currency_conflict_reservations',(SELECT n FROM tier_a_conflicts),
      'show_zone_todo',(SELECT n FROM missing_zone)>0 AND EXISTS (SELECT 1 FROM eligible_orders),
      'show_item_cost_todo',(SELECT n FROM missing_cost)>0 AND EXISTS (SELECT 1 FROM eligible_orders)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.venue_order_metrics_rollup(uuid,uuid) IS
  'Issue #1795: venue-exact, per-currency standing order intelligence. One '
  'server-owned arithmetic spine excludes tab settlement instruments, withholds '
  'money for unallocatable partial refunds, and never infers covers or identity.';

REVOKE EXECUTE ON FUNCTION public.venue_order_metrics_rollup(uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venue_order_metrics_rollup(uuid,uuid)
  TO authenticated, service_role;

COMMIT;
