-- #4490 P3 follow-up — money fixes found by the P3 UI build:
--   1. A gate sale paid in cash or by transfer (payment_collection 'property')
--      counts as paid: issue_4490_booking_money no longer reports its whole
--      total as still owed, so check-in never offers to take it again.
--   2. Moving a booking's day moves its balance due date by the same amount.
--   3. (edge notify-outbox-drain) a balance reminder is not sent when the
--      balance was paid before it went out; the sweep already enqueues only
--      bookings with a balance.
--   4. Refund policy wording: "Full refund if you cancel at least 24 hours
--      before.", proper plurals, "before the start" (new policy versions;
--      bookings keep their snapshot text).
-- Static SQL. Local stack only until Seth says otherwise.
-- Reverse (local only): restore the three functions from 20281203144490 /
-- 20281203174490 / 20281203074490.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- money: gate sales paid at the venue count as paid (from 20281203144490_issue_4490_p3_packages_deposits.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_booking_money(p_group_id uuid)
RETURNS TABLE (
  total_due bigint,
  paid_online bigint,
  paid_offline bigint,
  change_refunds bigint,
  net_paid bigint,
  refunded bigint,
  balance bigint,
  changes_minor bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH g AS (
    SELECT g.id, g.total_minor, g.state, g.payment_collection FROM public.stay_reservation_groups g
    WHERE g.id = p_group_id AND g.offer_kind IS NOT NULL
  ), m AS (
    SELECT
      g.total_minor,
      g.state,
      COALESCE((SELECT sum(a.price_delta_minor + a.fee_delta_minor + a.tax_delta_minor + a.policy_fee_minor)
                FROM public.venue_booking_amendments a WHERE a.group_id = g.id AND a.state = 'applied'), 0)::bigint AS changes,
      COALESCE((SELECT sum(p.amount_minor) FROM public.stay_payment_attempts p
                WHERE p.group_id = g.id AND p.state = 'succeeded'), 0)::bigint AS online,
      (COALESCE((SELECT sum(o.amount_minor) FROM public.venue_offline_payments o WHERE o.group_id = g.id), 0)
       -- #4490 P3 fix: a gate sale paid in cash or by transfer was paid in full at the gate.
       + CASE WHEN g.payment_collection = 'property' THEN g.total_minor ELSE 0 END)::bigint AS offline,
      COALESCE((SELECT sum(r.amount_minor) FROM public.stay_refunds r
                WHERE r.group_id = g.id AND r.idempotency_key LIKE 'offer-change-refund:%'
                  AND r.state IN ('submitted', 'processing', 'succeeded', 'manual_reconciliation')), 0)::bigint AS change_refunds,
      COALESCE((SELECT sum(r.amount_minor) FROM public.stay_refunds r
                WHERE r.group_id = g.id
                  AND r.state IN ('submitted', 'processing', 'succeeded', 'manual_reconciliation')), 0)::bigint AS refunded
    FROM g
  )
  SELECT
    m.total_minor + m.changes,
    m.online,
    m.offline,
    m.change_refunds,
    m.online + m.offline - m.change_refunds,
    m.refunded,
    CASE WHEN m.state IN ('confirmed', 'partially_cancelled')
         THEN GREATEST(m.total_minor + m.changes - (m.online + m.offline - m.change_refunds), 0)
         ELSE 0 END,
    m.changes
  FROM m;
$function$;


-- booking change: the balance due date follows a move (from 20281203174490_issue_4490_p4_hire_followups.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_change_booking_internal(
  p_group_id uuid,
  p_action text,
  p_payload jsonb,
  p_preview boolean,
  p_actor_type text,
  p_actor_user uuid,
  p_token_hash bytea,
  p_expected_version bigint,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_line public.stay_reservation_lines%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_option public.venue_offer_price_options%ROWTYPE;
  v_cur_window public.stay_place_windows%ROWTYPE;
  v_new_window public.stay_place_windows%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_existing public.venue_booking_amendments%ROWTYPE;
  v_money record;
  v_usage record;
  v_rules jsonb;
  v_request_hash text;
  v_line_count integer;
  v_cur_guests integer;
  v_new_guests integer;
  v_party integer;
  v_admitted integer;
  v_needed integer := 0;
  v_left integer;
  v_delta_base bigint := 0;
  v_tax_delta bigint := 0;
  v_policy_fee bigint := 0;
  v_delta_total bigint;
  v_vat_bps integer;
  v_vat_included boolean;
  v_refund_bps integer;
  v_new_total bigint;
  v_refundable bigint;
  v_refund bigint := 0;
  v_extras jsonb := '[]'::jsonb;
  v_summary jsonb;
  v_amend_id uuid;
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_l record;
  v_reason text;
  v_claim_r record;
  v_claim_spaces uuid[];
  v_claim_state record;
BEGIN
  IF p_group_id IS NULL OR p_action NOT IN ('change_guests', 'move_date', 'add_extras')
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR p_actor_type NOT IN ('guest', 'staff')
     OR (NOT p_preview AND (char_length(v_key) NOT BETWEEN 8 AND 200 OR p_expected_version IS NULL)) THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF p_preview THEN
    SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id;
  ELSE
    SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id FOR UPDATE;
  END IF;
  IF NOT FOUND OR v_group.offer_kind IS NULL THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_request_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'action', p_action, 'payload', p_payload, 'actor', p_actor_type, 'expected', p_expected_version)::text, 'UTF8')), 'hex');
  IF NOT p_preview THEN
    SELECT * INTO v_existing FROM public.venue_booking_amendments
    WHERE group_id = p_group_id AND idempotency_key = v_key;
    IF FOUND THEN
      IF v_existing.request_hash <> v_request_hash THEN
        RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
      END IF;
      RETURN v_existing.summary || jsonb_build_object('changeId', v_existing.id, 'replayed', true,
        'groupVersion', v_group.version);
    END IF;
    IF v_group.version <> p_expected_version THEN
      RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  IF v_group.state <> 'confirmed' THEN
    RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
  END IF;

  SELECT count(*) INTO v_line_count FROM public.stay_reservation_lines WHERE group_id = v_group.id AND state = 'confirmed';
  SELECT * INTO v_line FROM public.stay_reservation_lines
  WHERE group_id = v_group.id AND state = 'confirmed'
    AND (NULLIF(p_payload->>'lineId', '') IS NULL OR id = NULLIF(p_payload->>'lineId', '')::uuid)
  ORDER BY created_at, id LIMIT 1;
  IF NOT FOUND OR (p_action = 'change_guests' AND v_line_count > 1 AND NULLIF(p_payload->>'lineId', '') IS NULL) THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = v_line.offering_id;
  SELECT * INTO v_cur_window FROM public.stay_place_windows WHERE id = public.issue_4490_line_window_id(v_line.id);
  v_settings := public.issue_4490_ensure_booking_settings(v_group.venue_id);
  v_rules := public.issue_4490_change_rules(v_group.id);
  v_admitted := COALESCE((SELECT p.admitted_count FROM public.venue_passes p WHERE p.group_id = v_group.id), 0);
  v_cur_guests := public.issue_4490_line_guests(v_line.id);
  SELECT COALESCE(sum(public.issue_4490_line_guests(l.id)), 0) INTO v_party
  FROM public.stay_reservation_lines l WHERE l.group_id = v_group.id AND l.state = 'confirmed';

  -- Who may change what, and until when.
  IF p_actor_type = 'guest' THEN
    IF p_action = 'move_date' AND NOT COALESCE((v_rules->>'canMove')::boolean, false) THEN
      RAISE EXCEPTION '%', CASE
        WHEN v_rules->>'moveUntil' IS NULL OR v_admitted > 0
             OR ((v_rules->>'maxChanges') IS NOT NULL AND (v_rules->>'changesUsed')::integer >= (v_rules->>'maxChanges')::integer)
        THEN 'offer_change_not_allowed' ELSE 'offer_change_too_late' END USING ERRCODE = 'P0001';
    END IF;
    IF p_action IN ('change_guests', 'add_extras') AND NOT COALESCE((v_rules->>'canChangeGuests')::boolean, false) THEN
      RAISE EXCEPTION '%', CASE WHEN v_rules->>'guestChangeUntil' IS NULL THEN 'offer_change_not_allowed'
                                ELSE 'offer_change_too_late' END USING ERRCODE = 'P0001';
    END IF;
  ELSIF now() >= v_cur_window.ends_at THEN
    RAISE EXCEPTION 'offer_change_too_late' USING ERRCODE = 'P0001';
  END IF;

  -- VAT on the line (added = on top; included = inside the price).
  SELECT (fee.snapshot->>'basis_points')::integer, fee.included_in_base INTO v_vat_bps, v_vat_included
  FROM public.stay_quote_fee_lines fee
  WHERE fee.quote_line_id = v_line.quote_line_id AND fee.fee_kind = 'tax'
  ORDER BY fee.id LIMIT 1;

  IF p_action = 'change_guests' THEN
    IF COALESCE(p_payload->>'guests', '') !~ '^[0-9]{1,4}$' THEN
      RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
    END IF;
    v_new_guests := (p_payload->>'guests')::integer;
    SELECT * INTO v_option FROM public.venue_offer_price_options WHERE id = v_line.price_option_id;
    IF v_new_guests = v_cur_guests THEN
      RAISE EXCEPTION 'offer_change_nothing' USING ERRCODE = '22023';
    END IF;
    -- #4490 P4 follow-up: a hire may grow up to its place's capacity when the
    -- venue sells extra guests.
    IF v_new_guests < GREATEST(COALESCE(v_option.guest_min, 1), 1)
       OR v_new_guests > public.issue_4490_change_guest_max(v_offer.id, v_option.id) THEN
      RAISE EXCEPTION 'offer_guests_out_of_range' USING ERRCODE = '22023';
    END IF;
    IF v_party - v_cur_guests + v_new_guests < v_admitted THEN
      RAISE EXCEPTION 'offer_already_checked_in' USING ERRCODE = 'PT409';
    END IF;
    v_delta_base := (v_new_guests - v_cur_guests) * (
      CASE WHEN v_line.price_snapshot->>'unit' = 'guest' THEN COALESCE((v_line.price_snapshot->>'unitPriceMinor')::bigint, 0) ELSE 0 END
      + COALESCE((SELECT sum((x->>'unitPriceMinor')::bigint) FROM jsonb_array_elements(COALESCE(v_line.price_snapshot->'extras', '[]'::jsonb)) x
                  WHERE x->>'per' = 'guest'), 0));
    v_needed := GREATEST(v_new_guests - v_cur_guests, 0);
    -- #4490 P4 follow-up: a hire charges the row's per-guest price up to the
    -- row's largest group and the extra-guest price above it.
    IF v_offer.kind = 'private_hire' THEN
      v_cur_guests := COALESCE((SELECT a.to_guests FROM public.venue_booking_amendments a
                                WHERE a.group_id = v_group.id AND a.kind = 'change_guests'
                                ORDER BY a.created_at DESC LIMIT 1),
                               (v_line.price_snapshot->>'guests')::integer, v_cur_guests);
      IF v_new_guests = v_cur_guests THEN
        RAISE EXCEPTION 'offer_change_nothing' USING ERRCODE = '22023';
      END IF;
      v_delta_base :=
        (LEAST(v_new_guests, v_option.guest_max) - LEAST(v_cur_guests, v_option.guest_max))
          * CASE WHEN v_line.price_snapshot->>'unit' = 'guest'
                 THEN COALESCE((v_line.price_snapshot->>'unitPriceMinor')::bigint, 0) ELSE 0 END
        + (GREATEST(v_new_guests - v_option.guest_max, 0) - GREATEST(v_cur_guests - v_option.guest_max, 0))
          * COALESCE(v_offer.extra_guest_minor, 0)
        + (v_new_guests - v_cur_guests)
          * COALESCE((SELECT sum((x->>'unitPriceMinor')::bigint)
                      FROM jsonb_array_elements(COALESCE(v_line.price_snapshot->'extras', '[]'::jsonb)) x
                      WHERE x->>'per' = 'guest'), 0);
    END IF;
    v_new_window := v_cur_window;
  ELSIF p_action = 'move_date' THEN
    SELECT * INTO v_new_window FROM public.stay_place_windows
    WHERE id = NULLIF(p_payload->>'windowId', '')::uuid AND offering_id = v_offer.id;
    IF NOT FOUND OR v_new_window.stop_sell OR v_new_window.id = v_cur_window.id THEN
      RAISE EXCEPTION 'offer_window_unavailable' USING ERRCODE = 'PT409';
    END IF;
    IF now() >= public.issue_4490_window_cutoff(v_offer.id, v_new_window.id) THEN
      RAISE EXCEPTION 'offer_too_soon' USING ERRCODE = 'PT409';
    END IF;
    IF v_new_window.local_date > (now() AT TIME ZONE v_settings.timezone)::date
         + LEAST(v_settings.booking_horizon_days, COALESCE(v_offer.max_advance_days, 730)) THEN
      RAISE EXCEPTION 'offer_too_far' USING ERRCODE = 'PT409';
    END IF;
    FOR v_l IN
      SELECT l.* FROM public.stay_reservation_lines l WHERE l.group_id = v_group.id AND l.state = 'confirmed'
    LOOP
      v_reason := public.issue_4490_option_window_reason(v_l.price_option_id, v_new_window.id);
      IF v_reason IN ('wrong_weekday', 'wrong_time') THEN
        RAISE EXCEPTION 'offer_%', v_reason USING ERRCODE = 'PT409';
      END IF;
      -- The booked price stands unless the new day is priced differently
      -- (weekday or busy-time price), then the difference applies.
      v_delta_base := v_delta_base
        + (COALESCE(public.issue_4490_option_price_at(v_l.price_option_id, v_new_window.id), 0)
           - COALESCE(public.issue_4490_option_price_at(v_l.price_option_id, v_cur_window.id), 0))
          * CASE WHEN v_l.price_snapshot->>'unit' = 'guest' THEN public.issue_4490_line_guests(v_l.id) ELSE 1 END;
    END LOOP;
    v_needed := v_party;
    -- #4490 P4 follow-up: a hire or a by-the-hour booking moves its space
    -- claims: the same place must be free on the new day (setup and cleanup
    -- included, its own claims ignored).
    IF v_offer.kind IN ('private_hire', 'by_the_hour') THEN
      v_claim_spaces := CASE WHEN v_offer.kind = 'private_hire'
        THEN public.issue_4490_option_spaces(v_line.price_option_id)
        ELSE (SELECT array_agg(DISTINCT c.space_id) FROM public.venue_space_claims c
              WHERE c.group_id = v_group.id AND c.state IN ('held', 'committed')) END;
      SELECT * INTO v_claim_r FROM public.issue_4490_hire_ranges(v_offer.id, v_new_window.id,
        COALESCE((v_line.price_snapshot->>'overtimeHours')::integer, 0) * 60);
      SELECT * INTO v_claim_state FROM public.issue_4490_spaces_status(v_claim_spaces, v_claim_r.claim, v_group.id);
      IF v_claim_spaces IS NULL OR v_claim_state.status <> 'free' THEN
        RAISE EXCEPTION 'offer_space_taken' USING ERRCODE = 'PT409';
      END IF;
    END IF;
  ELSE -- add_extras
    IF jsonb_typeof(p_payload->'extras') <> 'array' OR jsonb_array_length(p_payload->'extras') NOT BETWEEN 1 AND 20
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'extras') e
                  WHERE jsonb_typeof(e) <> 'object'
                     OR (e ? 'qty' AND (COALESCE(e->>'qty', '') !~ '^[0-9]{1,3}$' OR (e->>'qty')::integer NOT BETWEEN 1 AND 100)))
       OR (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(p_payload->'extras') e) <> jsonb_array_length(p_payload->'extras') THEN
      RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'extras') e
               WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_offer.extras) x WHERE x->>'id' = e->>'id')) THEN
      RAISE EXCEPTION 'offer_extra_unavailable' USING ERRCODE = 'P0002';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', x->>'id', 'name', x->>'name', 'per', x->>'per',
             'unitPriceMinor', (x->>'price_minor')::bigint,
             'qty', CASE WHEN x->>'per' = 'guest' THEN v_party ELSE COALESCE((e->>'qty')::integer, 1) END,
             'amountMinor', (x->>'price_minor')::bigint
               * CASE WHEN x->>'per' = 'guest' THEN v_party ELSE COALESCE((e->>'qty')::integer, 1) END)
             ORDER BY x->>'name'), '[]'::jsonb)
    INTO v_extras
    FROM jsonb_array_elements(p_payload->'extras') e
    JOIN jsonb_array_elements(v_offer.extras) x ON x->>'id' = e->>'id';
    SELECT COALESCE(sum((x->>'amountMinor')::bigint), 0) INTO v_delta_base FROM jsonb_array_elements(v_extras) x;
    v_new_window := v_cur_window;
  END IF;

  v_tax_delta := CASE WHEN v_vat_bps IS NOT NULL AND NOT COALESCE(v_vat_included, false)
                      THEN round(v_delta_base::numeric * v_vat_bps / 10000)::bigint ELSE 0 END;
  v_delta_total := v_delta_base + v_tax_delta;
  SELECT * INTO v_money FROM public.issue_4490_booking_money(v_group.id);
  IF v_delta_total < 0 THEN
    -- Less to pay: the guest keeps the ladder's share; the venue keeps the rest.
    v_refund_bps := public.issue_4490_line_refund_bps(v_line.id, p_actor_type);
    v_policy_fee := ((-v_delta_total) * (10000 - COALESCE(v_refund_bps, 0)) + 5000) / 10000;
  ELSIF p_action = 'move_date' AND p_actor_type = 'guest' THEN
    v_policy_fee := (v_money.total_due * COALESCE((v_rules->>'feeBps')::integer, 0) + 5000) / 10000;
  END IF;
  v_new_total := v_money.total_due + v_delta_total + v_policy_fee;
  SELECT COALESCE(sum(GREATEST(0, a.charged_minor - a.refunded_minor - COALESCE((
      SELECT sum(ra.amount_minor) FROM public.stay_refund_allocations ra
      JOIN public.stay_refunds rr ON rr.id = ra.refund_id
      WHERE ra.payment_allocation_id = a.id AND rr.state IN ('submitted', 'processing', 'manual_reconciliation')), 0))), 0)
  INTO v_refundable
  FROM public.stay_payment_allocations a
  JOIN public.stay_payment_attempts p ON p.id = a.payment_attempt_id
  WHERE p.group_id = v_group.id AND p.state = 'succeeded';
  v_refund := LEAST(GREATEST(v_money.net_paid - v_new_total, 0), v_refundable);

  -- Room on the day (under the pool lock when applying). Offers with no day
  -- limit (hire, by the hour) have no pool to check.
  IF v_needed > 0 AND v_offer.capacity_pool_id IS NOT NULL THEN
    IF NOT p_preview AND v_offer.capacity_pool_id IS NOT NULL THEN
      PERFORM 1 FROM public.venue_capacity_pools WHERE id = v_offer.capacity_pool_id FOR UPDATE;
      PERFORM 1 FROM public.venue_capacity_overrides
      WHERE pool_id = v_offer.capacity_pool_id AND local_date = v_new_window.local_date FOR UPDATE;
    END IF;
    SELECT * INTO v_usage FROM public.issue_4490_pool_day_usage(v_offer.capacity_pool_id, v_new_window.local_date);
    IF COALESCE(v_usage.closed, true) THEN
      RAISE EXCEPTION 'offer_day_closed' USING ERRCODE = 'PT409';
    END IF;
    v_left := CASE WHEN p_actor_type = 'staff' THEN v_usage.gate_left ELSE v_usage.online_left END;
    IF v_offer.entry_style = 'timed_session' THEN
      v_left := LEAST(v_left, GREATEST(v_new_window.sellable_capacity - public.issue_4490_window_used(v_new_window.id), 0));
    END IF;
    IF v_needed > v_left THEN
      RAISE EXCEPTION 'offer_sold_out' USING ERRCODE = 'PT409',
        DETAIL = jsonb_build_object('remaining', v_left)::text;
    END IF;
  END IF;

  v_summary := jsonb_strip_nulls(jsonb_build_object(
    'action', p_action,
    'lineId', v_line.id,
    'fromGuests', CASE WHEN p_action = 'change_guests' THEN v_cur_guests END,
    'toGuests', CASE WHEN p_action = 'change_guests' THEN v_new_guests END,
    'fromDate', CASE WHEN p_action = 'move_date' THEN v_cur_window.local_date END,
    'toDate', CASE WHEN p_action = 'move_date' THEN v_new_window.local_date END,
    'toStartsAt', CASE WHEN p_action = 'move_date' THEN v_new_window.starts_at END,
    'extras', CASE WHEN p_action = 'add_extras' THEN v_extras END)) || jsonb_build_object(
    'priceDeltaMinor', v_delta_base,
    'taxDeltaMinor', v_tax_delta,
    'feeMinor', v_policy_fee,
    'amountMinor', v_delta_total + v_policy_fee,
    'totalDueBeforeMinor', v_money.total_due,
    'totalDueAfterMinor', v_new_total,
    'paidMinor', v_money.net_paid,
    'refundMinor', v_refund,
    'balanceAfterMinor', GREATEST(v_new_total - (v_money.net_paid - v_refund), 0),
    'currencyCode', v_group.currency_code,
    'by', p_actor_type);
  IF p_preview THEN
    RETURN v_summary || jsonb_build_object('preview', true, 'groupVersion', v_group.version);
  END IF;

  -- Apply.
  PERFORM set_config('mingla.issue_4490_booking_change', v_group.id::text, true);
  IF p_action = 'change_guests' THEN
    UPDATE public.stay_inventory_commitments SET quantity = v_new_guests
    WHERE reservation_line_id = v_line.id AND state = 'active';
  ELSIF p_action = 'move_date' THEN
    UPDATE public.stay_inventory_commitments SET place_window_id = v_new_window.id
    WHERE group_id = v_group.id AND state = 'active' AND resource_type = 'place_window';
    -- #4490 P3 fix: the balance due date moves with the day.
    UPDATE public.stay_reservation_groups
    SET balance_due_at = balance_due_at + (v_new_window.starts_at - v_cur_window.starts_at)
    WHERE id = v_group.id AND balance_due_at IS NOT NULL;
    UPDATE public.venue_passes p
    SET valid_local_date = v.valid_local_date, valid_from = v.valid_from, valid_to = v.valid_to,
        version = p.version + 1, updated_at = now()
    FROM public.issue_4490_pass_validity(v_offer.id, v_new_window.id) v
    WHERE p.group_id = v_group.id;
    -- #4490 P4 follow-up: the space claims move with the booking (release the
    -- old, claim the new in one transaction; the exclusion constraint decides).
    IF v_offer.kind IN ('private_hire', 'by_the_hour') THEN
      UPDATE public.venue_space_claims
      SET state = 'released', held_until = NULL, released_at = now(), release_reason = 'moved', updated_at = now()
      WHERE group_id = v_group.id AND state IN ('held', 'committed');
      PERFORM public.issue_4490_claim_spaces(v_group.id, v_line.id,
        (SELECT h.id FROM public.stay_inventory_holds h WHERE h.group_id = v_group.id ORDER BY h.created_at DESC LIMIT 1),
        v_claim_spaces, (v_line.price_snapshot->>'combinationId')::uuid, v_claim_r.booked, v_claim_r.claim, NULL);
      IF v_offer.kind = 'private_hire' THEN
        PERFORM public.issue_4490_assert_hire_capacity(v_group.venue_id, v_claim_spaces, v_claim_r.booked);
      END IF;
    END IF;
  END IF;
  IF p_action = 'change_guests' THEN
    UPDATE public.venue_passes p
    SET admits = totals.admits,
        id_check_count = LEAST(totals.id_count, totals.admits),
        version = p.version + 1, updated_at = now()
    FROM (
      SELECT sum(public.issue_4490_line_guests(l.id))::integer AS admits,
             COALESCE(sum(public.issue_4490_line_guests(l.id)) FILTER (WHERE l.price_snapshot->>'idCheckLabel' IS NOT NULL), 0)::integer AS id_count
      FROM public.stay_reservation_lines l WHERE l.group_id = v_group.id AND l.state = 'confirmed'
    ) totals
    WHERE p.group_id = v_group.id;
  END IF;
  INSERT INTO public.venue_booking_amendments (
    group_id, reservation_line_id, kind, from_guests, to_guests, from_window_id, to_window_id, extras,
    price_delta_minor, tax_delta_minor, policy_fee_minor, refund_minor, actor_type, actor_user_id,
    idempotency_key, request_hash, summary
  ) VALUES (
    v_group.id, CASE WHEN p_action = 'change_guests' THEN v_line.id END,
    p_action,
    CASE WHEN p_action = 'change_guests' THEN v_cur_guests END,
    CASE WHEN p_action = 'change_guests' THEN v_new_guests END,
    CASE WHEN p_action = 'move_date' THEN v_cur_window.id END,
    CASE WHEN p_action = 'move_date' THEN v_new_window.id END,
    v_extras, v_delta_base, v_tax_delta, v_policy_fee, v_refund, p_actor_type, p_actor_user,
    v_key, v_request_hash, v_summary
  ) RETURNING id INTO v_amend_id;
  IF v_refund > 0 THEN
    v_refund := public.issue_4490_refund_amount_internal(v_group.id, v_refund, p_actor_type, p_actor_user,
      p_token_hash, 'Booking changed: ' || replace(p_action, '_', ' '), v_key);
  END IF;
  UPDATE public.stay_reservation_groups SET version = version + 1, updated_at = now()
  WHERE id = v_group.id RETURNING * INTO v_group;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    v_group.id, 'stay_offer_changed', p_actor_type, p_actor_user, 'offer-change:' || v_key,
    jsonb_build_object('changeId', v_amend_id, 'action', p_action,
      'amountMinor', (v_summary->>'balanceAfterMinor'), 'currencyCode', v_group.currency_code,
      'refundMinor', v_refund::text)
  );
  RETURN v_summary || jsonb_build_object('changeId', v_amend_id, 'replayed', false,
    'refundMinor', v_refund, 'groupVersion', v_group.version);
END;
$function$;


-- policy wording (from 20281203074490_issue_4490_p2_offer_engine.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_policy_text(p_ladder jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN jsonb_array_length(p_ladder) = 0 THEN 'No refunds.'
    ELSE (
      SELECT string_agg(
        CASE
          WHEN (r->>'refund_bps')::integer = 0 THEN 'No refund'
          WHEN (r->>'refund_bps')::integer = 10000 THEN 'Full refund'
          ELSE ((r->>'refund_bps')::integer / 100)::text || '% refund'
        END
        -- #4490 P3 fix: plain words and proper plurals ("24 hours", "2 days").
        || CASE
          WHEN (r->>'min_minutes_before')::integer = 0 THEN ' if you cancel before the start.'
          WHEN (r->>'min_minutes_before')::integer % 1440 = 0 AND (r->>'min_minutes_before')::integer > 1440
            THEN ' if you cancel at least ' || ((r->>'min_minutes_before')::integer / 1440)::text || ' days before.'
          WHEN (r->>'min_minutes_before')::integer % 60 = 0
            THEN ' if you cancel at least ' || ((r->>'min_minutes_before')::integer / 60)::text
                 || CASE WHEN (r->>'min_minutes_before')::integer = 60 THEN ' hour' ELSE ' hours' END || ' before.'
          ELSE ' if you cancel at least ' || (r->>'min_minutes_before') || ' minutes before.'
        END, ' ' ORDER BY ord)
      FROM jsonb_array_elements(p_ladder) WITH ORDINALITY AS l(r, ord)
    )
  END;
$function$;


COMMIT;
