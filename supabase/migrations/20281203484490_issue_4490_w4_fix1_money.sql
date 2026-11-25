-- #4490 spec 06 W4 fix round 1 (06-W4 fix 1): what a plan's payment really costs, and one live
-- payment page per booking.
--
-- W4-N2. A plan's first payment (and every renewal) is charged with the plan offering's fee
--   versions (VAT added at 7.5% on the local QA venue): issue_4490_membership_period_group
--   priced it, but every READER showed the period's base amount (`amount_minor`, the plan
--   price before VAT): the join answer's paymentDue.amountMinor said 5,000,000 while the page
--   charged 5,375,000; the email worked VAT out again on its own (taxes only, no fixed fees);
--   buyer web added VAT in the browser. One owner now: issue_4490_member_fee_lines (the fee
--   rule the period's payment uses) -> issue_4490_member_charge (base, fees, VAT, total, VAT
--   mode and rate, in minor units) -> issue_4490_member_period_charge (an open period: the live
--   payment's own total while one is held). The period group, the member read (paymentDue,
--   plan.charge), the public plan read (plans[].charge), the Host members list and the member
--   emails all read it. `amount_minor` keeps meaning the plan price (the base).
--
-- W4-N3. Two `pay` calls for one booking with different keys both opened a payment page: the
--   first attempt is 'created' until the provider answers, and only 'pending' / 'ambiguous'
--   counted as in flight. issue_4490_prepare_offer_payment now serialises on the booking
--   (advisory lock on the group, then its row lock), counts a fresh 'created' attempt as in
--   flight, and while an attempt for the same stage and amount is pending with its page
--   remembered (issue_4490_payment_pages, written by the edge after the provider answers) it
--   returns THAT attempt and page instead of a second one; a different stage or amount at the
--   same time is refused (offer_payment_mode_conflict). The membership pay path keeps using a
--   period's held group while a payment on it is in flight. Backstop: a second successful
--   initial payment for a venue booking or plan period that is already paid is recorded as
--   refund due (the existing refund queue, issue_1389_queue_late_success_refund, refunds it)
--   and no longer moves the paid booking to reconciliation.
--
-- Local only. Every function below is in the privilege matrix suite; tested in
-- __tests__/issue_4490_w4_fix1_money.implementor.pg17.test.sql.

-- ---------------------------------------------------------------------------
-- 1. One owner for a plan payment's money.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_member_fee_lines(p_offering_id uuid, p_base bigint)
RETURNS TABLE (
  fee_version_id uuid,
  name text,
  fee_kind text,
  amount_minor bigint,
  included_in_base boolean,
  refund_treatment text,
  basis_points integer,
  calculation text,
  snapshot jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT f.id, f.label, f.fee_kind,
    CASE
      WHEN f.calculation = 'percentage_of_line_base' AND f.display_mode = 'included'
        THEN round(p_base::numeric * f.basis_points / (10000 + f.basis_points))::bigint
      WHEN f.calculation = 'percentage_of_line_base'
        THEN round(p_base::numeric * f.basis_points / 10000)::bigint
      WHEN f.calculation IN ('fixed_per_place_booking', 'fixed_per_place_guest') THEN f.amount_minor
      ELSE 0 END,
    f.display_mode = 'included', f.refund_treatment, f.basis_points, f.calculation, to_jsonb(f)
  FROM public.stay_fee_versions f
  WHERE f.offering_id = p_offering_id AND f.effective_to IS NULL
  ORDER BY f.fee_key, f.id;
$function$;

-- {unit, baseMinor, feeMinor, taxMinor, totalMinor, vatMode, vatRatePct}: totalMinor is what the
-- payment page is asked for (base + fees and VAT not already in the base); taxMinor is the VAT
-- (added on top, or the part of the base that is VAT when vatMode = 'included').
CREATE OR REPLACE FUNCTION public.issue_4490_member_charge(p_offering_id uuid, p_base bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'unit', 'minor',
    'baseMinor', p_base,
    'feeMinor', COALESCE(sum(l.amount_minor) FILTER (WHERE l.fee_kind = 'mandatory_fee' AND NOT l.included_in_base), 0),
    'taxMinor', COALESCE(sum(l.amount_minor) FILTER (WHERE l.fee_kind = 'tax'), 0),
    'totalMinor', p_base
      + COALESCE(sum(l.amount_minor) FILTER (WHERE l.fee_kind = 'mandatory_fee' AND NOT l.included_in_base), 0)
      + COALESCE(sum(l.amount_minor) FILTER (WHERE l.fee_kind = 'tax' AND NOT l.included_in_base), 0),
    'vatMode', CASE
      WHEN count(*) FILTER (WHERE l.fee_kind = 'tax') = 0 THEN 'none'
      WHEN bool_or(l.included_in_base) FILTER (WHERE l.fee_kind = 'tax') THEN 'included'
      ELSE 'added' END,
    'vatRatePct', trim_scale(COALESCE(max(l.basis_points) FILTER (WHERE l.fee_kind = 'tax' AND l.calculation = 'percentage_of_line_base'), 0)::numeric / 100))
  FROM public.issue_4490_member_fee_lines(p_offering_id, p_base) l;
$function$;

-- An open period's charge: the live held payment's own total while one exists (that is what its
-- page asks for), else what a payment made now would be asked for.
CREATE OR REPLACE FUNCTION public.issue_4490_member_period_charge(p_period_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.issue_4490_member_charge(pl.offering_id, pe.amount_minor)
    || COALESCE((SELECT jsonb_build_object('totalMinor', g.total_minor)
                 FROM public.stay_reservation_groups g
                 JOIN public.stay_inventory_holds h ON h.group_id = g.id
                 WHERE g.id = pe.group_id AND g.state = 'instant_payment_pending'
                   AND h.state = 'active' AND h.expires_at > now()), '{}'::jsonb)
  FROM public.venue_membership_periods pe
  JOIN public.venue_membership_subscriptions s ON s.id = pe.subscription_id
  JOIN public.venue_membership_plans pl ON pl.id = s.plan_id
  WHERE pe.id = p_period_id;
$function$;

REVOKE ALL ON FUNCTION public.issue_4490_member_fee_lines(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_member_charge(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_member_period_charge(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_member_fee_lines(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_member_charge(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_member_period_charge(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. The period's payment is priced by the same fee lines (re-emitted from the live body:
--    the fee loop now reads issue_4490_member_fee_lines; nothing else changes).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_4490_membership_period_group(p_period_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_period public.venue_membership_periods%ROWTYPE;
  v_sub public.venue_membership_subscriptions%ROWTYPE;
  v_plan public.venue_membership_plans%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_price public.stay_price_versions%ROWTYPE;
  v_policy public.stay_policy_versions%ROWTYPE;
  v_rule uuid;
  v_window public.stay_place_windows%ROWTYPE;
  v_quote_id uuid := gen_random_uuid();
  v_line_id uuid := gen_random_uuid();
  v_group_id uuid := gen_random_uuid();
  v_hold_id uuid := gen_random_uuid();
  v_actor text;
  v_key text;
  v_n integer;
  v_base bigint;
  v_total bigint;
  v_tz text;
  v_hold_expires timestamptz;
BEGIN
  SELECT * INTO v_period FROM public.venue_membership_periods WHERE id = p_period_id FOR UPDATE;
  SELECT * INTO v_sub FROM public.venue_membership_subscriptions WHERE id = v_period.subscription_id;
  SELECT * INTO v_plan FROM public.venue_membership_plans WHERE id = v_sub.plan_id;
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = v_plan.offering_id;
  v_settings := public.issue_4490_ensure_booking_settings(v_offer.venue_id);
  v_tz := v_settings.timezone;
  SELECT * INTO v_price FROM public.stay_price_versions
  WHERE offering_id = v_offer.id AND price_option_id = v_plan.price_option_id AND effective_to IS NULL;
  SELECT * INTO v_policy FROM public.stay_policy_versions WHERE offering_id = v_offer.id AND effective_to IS NULL;
  SELECT r.id INTO v_rule FROM public.stay_place_schedule_rules r WHERE r.offering_id = v_offer.id ORDER BY r.created_at LIMIT 1;
  IF v_price.id IS NULL OR v_policy.id IS NULL OR v_rule IS NULL THEN
    RAISE EXCEPTION 'plan_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.stay_place_windows (
    offering_id, schedule_rule_id, brand_id, venue_id, local_date, starts_at, ends_at,
    sellable_units, sellable_capacity, dst_resolution, booked_block
  ) VALUES (
    v_offer.id, v_rule, v_offer.brand_id, v_offer.venue_id, (v_period.period_start AT TIME ZONE v_tz)::date,
    v_period.period_start, v_period.period_end, NULL, 100000, 'unambiguous', true
  ) ON CONFLICT (offering_id, starts_at, ends_at) DO NOTHING;
  SELECT * INTO v_window FROM public.stay_place_windows
  WHERE offering_id = v_offer.id AND starts_at = v_period.period_start AND ends_at = v_period.period_end;

  v_actor := encode(pg_catalog.sha256(convert_to('membership-period:' || v_period.id::text, 'UTF8')), 'hex');
  SELECT count(*) + 1 INTO v_n FROM public.stay_reservation_groups g WHERE g.actor_key_hash = v_actor;
  v_key := 'member-period:' || v_period.id || ':' || v_n;
  v_base := v_period.amount_minor;
  INSERT INTO public.stay_quotes (
    id, user_id, actor_key_hash, venue_id, brand_id, currency_code, mode, status,
    source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
    request_hash, price_revision_set_hash, inventory_revision_set_hash, policy_snapshot_hash,
    idempotency_key, expires_at, offer_kind
  ) VALUES (
    v_quote_id, v_sub.user_id, v_actor, v_offer.venue_id, v_offer.brand_id, v_period.currency_code,
    'instant', 'building', 0, 0, 0, 0,
    encode(pg_catalog.sha256(convert_to(v_key, 'UTF8')), 'hex'), repeat('0', 64), repeat('0', 64), repeat('0', 64),
    v_key, now() + interval '15 minutes', 'membership'
  );
  INSERT INTO public.stay_quote_lines (
    id, quote_id, offering_id, kind, confirmation_mode, place_window_id, place_guests,
    base_minor, fee_minor, tax_minor, total_minor, price_version_id, policy_version_id,
    offering_version, inventory_snapshot, offering_snapshot, price_snapshot, policy_snapshot, price_option_id
  ) VALUES (
    v_line_id, v_quote_id, v_offer.id, 'membership', 'instant', v_window.id, 1,
    v_base, 0, 0, v_base, v_price.id, v_policy.id, v_offer.version,
    jsonb_build_object('resources', jsonb_build_array(jsonb_build_object(
      'resourceType', 'place_window', 'windowId', v_window.id, 'version', v_window.version)),
      'localDate', v_window.local_date),
    jsonb_build_object('name', v_plan.name, 'kind', 'membership', 'venueId', v_offer.venue_id),
    jsonb_build_object('optionName', v_plan.name, 'unit', 'booking', 'unitPriceMinor', v_base,
      'listPriceMinor', v_price.amount_minor, 'currencyCode', v_period.currency_code, 'sortOrder', 0,
      'subscriptionId', v_sub.id, 'periodId', v_period.id,
      'periodStart', v_period.period_start, 'periodEnd', v_period.period_end, 'packageMinor', v_base),
    to_jsonb(v_policy) - 'created_by', v_plan.price_option_id
  );
  INSERT INTO public.stay_quote_fee_lines (
    quote_id, quote_line_id, fee_version_id, name, fee_kind, amount_minor, included_in_base, refund_treatment, snapshot
  )
  SELECT v_quote_id, v_line_id, l.fee_version_id, l.name, l.fee_kind, l.amount_minor,
         l.included_in_base, l.refund_treatment, l.snapshot
  FROM public.issue_4490_member_fee_lines(v_offer.id, v_base) l;
  UPDATE public.stay_quote_lines line
  SET fee_minor = totals.fee_minor, tax_minor = totals.tax_minor,
      total_minor = line.base_minor + totals.fee_minor + totals.tax_minor
  FROM (
    SELECT quote_line_id,
      COALESCE(sum(amount_minor) FILTER (WHERE fee_kind = 'mandatory_fee' AND NOT included_in_base), 0) AS fee_minor,
      COALESCE(sum(amount_minor) FILTER (WHERE fee_kind = 'tax' AND NOT included_in_base), 0) AS tax_minor
    FROM public.stay_quote_fee_lines WHERE quote_id = v_quote_id GROUP BY quote_line_id
  ) totals
  WHERE line.id = totals.quote_line_id;
  SELECT total_minor INTO v_total FROM public.stay_quote_lines WHERE id = v_line_id;
  IF v_total > 2147483647 THEN
    RAISE EXCEPTION 'offer_amount_too_large' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.stay_quotes q
  SET status = 'active',
      source_subtotal_minor = l.base_minor, fee_total_minor = l.fee_minor,
      tax_total_minor = l.tax_minor, total_minor = l.total_minor,
      price_revision_set_hash = encode(pg_catalog.sha256(convert_to(
        l.price_version_id::text || ':' || l.price_snapshot::text, 'UTF8')), 'hex'),
      inventory_revision_set_hash = encode(pg_catalog.sha256(convert_to(
        l.offering_id::text || ':' || l.offering_version::text || ':' || l.inventory_snapshot::text, 'UTF8')), 'hex'),
      policy_snapshot_hash = encode(pg_catalog.sha256(convert_to(
        l.policy_version_id::text || ':' || l.policy_snapshot::text, 'UTF8')), 'hex')
  FROM public.stay_quote_lines l
  WHERE q.id = v_quote_id AND l.id = v_line_id;

  v_hold_expires := now() + make_interval(mins => v_settings.instant_payment_hold_minutes);
  INSERT INTO public.stay_reservation_groups (
    id, public_reference, quote_id, user_id, actor_key_hash, venue_id, brand_id, currency_code,
    mode, state, guest_snapshot, source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
    idempotency_key, request_hash, offer_kind, buyer_token_hash, payment_plan_snapshot,
    booking_source, payment_collection
  )
  SELECT v_group_id, 'VB-' || upper(substr(replace(v_group_id::text, '-', ''), 1, 20)),
    q.id, v_sub.user_id, v_actor, q.venue_id, q.brand_id, q.currency_code,
    'instant', 'instant_payment_pending',
    jsonb_strip_nulls(jsonb_build_object('name', v_sub.member_name, 'email', v_sub.member_email, 'phone', v_sub.member_phone)),
    q.source_subtotal_minor, q.fee_total_minor, q.tax_total_minor, q.total_minor,
    v_key, q.request_hash, 'membership',
    pg_catalog.sha256(v_sub.member_token_hash || convert_to(v_group_id::text, 'UTF8')),
    jsonb_build_object('stagePlan', 'full', 'depositKind', 'none', 'depositValue', NULL, 'depositMinor', NULL,
      'balanceDueAt', NULL, 'payModes', jsonb_build_array('full'), 'currencyCode', q.currency_code,
      'vatMode', v_settings.vat_mode, 'refundLadder', '[]'::jsonb, 'dateChangeRule', '{}'::jsonb,
      'policyText', v_policy.cancellation_policy, 'operatorCancelRefundBps', 0, 'damageDepositMinor', 0,
      'minSpendMinor', 0, 'localDate', v_window.local_date,
      'membership', jsonb_build_object('subscriptionId', v_sub.id, 'periodId', v_period.id)),
    'guest', 'mingla'
  FROM public.stay_quotes q WHERE q.id = v_quote_id;
  INSERT INTO public.stay_reservation_lines (
    id, group_id, quote_line_id, offering_id, kind, state, place_window_id, place_guests,
    adults, children, base_minor, fee_minor, tax_minor, total_minor,
    offering_snapshot, price_snapshot, policy_snapshot, price_option_id
  )
  SELECT gen_random_uuid(), v_group_id, l.id, l.offering_id, l.kind, 'payment_pending', l.place_window_id, l.place_guests,
         0, 0, l.base_minor, l.fee_minor, l.tax_minor, l.total_minor,
         l.offering_snapshot, l.price_snapshot, l.policy_snapshot, l.price_option_id
  FROM public.stay_quote_lines l WHERE l.id = v_line_id;
  INSERT INTO public.stay_inventory_holds (id, group_id, state, expires_at, reason)
  VALUES (v_hold_id, v_group_id, 'active', v_hold_expires, 'instant_payment');
  INSERT INTO public.stay_inventory_hold_slices (hold_id, reservation_line_id, resource_type, offering_id, place_window_id, quantity)
  SELECT v_hold_id, r.id, 'place_window', r.offering_id, r.place_window_id, 1
  FROM public.stay_reservation_lines r WHERE r.group_id = v_group_id;
  UPDATE public.stay_quotes SET status = 'consumed', consumed_at = now(), version = version + 1 WHERE id = v_quote_id;
  INSERT INTO public.stay_reservation_events (group_id, event_type, actor_type, idempotency_key, safe_metadata)
  VALUES (v_group_id, 'stay_offer_hold_created', 'guest', 'offer-hold:' || v_key,
          jsonb_build_object('holdExpiresAt', v_hold_expires, 'membershipPeriodId', v_period.id));
  UPDATE public.venue_membership_periods SET group_id = v_group_id, version = version + 1, updated_at = now()
  WHERE id = v_period.id;
  RETURN v_group_id;
END;
$function$;


-- ---------------------------------------------------------------------------
-- 3. Readers: the member read (paymentDue = the charge; plan.charge), the public plan read
--    (plans[].charge), the Host members list, the member emails.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.issue_4490_member_projection(p_subscription_id uuid, p_view text, p_qr_pepper text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_sub public.venue_membership_subscriptions%ROWTYPE;
  v_plan public.venue_membership_plans%ROWTYPE;
  v_venue record;
  v_tz text;
  v_open public.venue_membership_periods%ROWTYPE;
  v_today date;
  v_result jsonb;
  v_can_enter boolean;
BEGIN
  SELECT * INTO v_sub FROM public.venue_membership_subscriptions WHERE id = p_subscription_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_plan FROM public.venue_membership_plans WHERE id = v_sub.plan_id;
  SELECT v.id, v.name, v.slug, b.slug AS brand_slug, b.name AS brand_name INTO v_venue
  FROM public.stay_offerings o JOIN public.venue_listings v ON v.id = o.venue_id
  JOIN public.brands b ON b.id = v.brand_id WHERE o.id = v_plan.offering_id;
  v_tz := public.issue_4490_venue_timezone(v_venue.id);
  v_today := (now() AT TIME ZONE v_tz)::date;
  SELECT * INTO v_open FROM public.venue_membership_periods
  WHERE id = public.issue_4490_member_open_period(v_sub.id);
  v_can_enter := v_sub.status IN ('active', 'payment_due', 'grace') AND v_sub.start_on <= v_today;
  v_result := jsonb_build_object(
    'subscriptionId', v_sub.id,
    'status', v_sub.status,
    'memberCode', v_sub.member_code,
    'memberName', v_sub.member_name,
    'plan', jsonb_build_object(
      'id', v_plan.id, 'name', v_plan.name, 'priceMinor', v_plan.price_minor, 'currencyCode', v_plan.currency_code,
      'interval', v_plan.period, 'inclusions', v_plan.inclusions, 'entryIncluded', v_plan.entry_included,
      'roomHours', v_plan.room_hours_per_period, 'guestPasses', v_plan.guest_passes_per_period,
      'discountBps', v_plan.discount_bps, 'discountKinds', to_jsonb(v_plan.discount_kinds),
      'hourOfferingIds', to_jsonb(v_plan.hour_offering_ids), 'entryOfferingId', v_plan.entry_offering_id,
      'interval', v_plan.period, 'joinMode', v_plan.join_mode,
      -- #4490 06-W4 fix 1 (W4-N2): one period's charge at the plan price (VAT and fees included).
      'charge', public.issue_4490_member_charge(v_plan.offering_id, v_plan.price_minor),
      'deskSpaces', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
                              FROM public.venue_spaces s WHERE s.id = ANY(v_plan.desk_space_ids)
                                AND NOT EXISTS (SELECT 1 FROM public.venue_space_claims c
                                  WHERE c.space_id = s.id AND c.state IN ('held', 'committed')
                                    AND c.claim_range @> now() AND c.subscription_id IS DISTINCT FROM v_sub.id)), '[]'::jsonb)),
    'terms', v_sub.terms,
    'venue', jsonb_build_object('id', v_venue.id, 'name', v_venue.name, 'slug', v_venue.slug,
      'brandSlug', v_venue.brand_slug, 'brandName', v_venue.brand_name, 'timezone', v_tz),
    'startOn', v_sub.start_on,
    'startedAt', v_sub.started_at,
    'activeUntil', v_sub.current_period_end,
    'currentPeriod', CASE WHEN v_sub.current_period_start IS NULL THEN NULL ELSE jsonb_build_object(
      'start', v_sub.current_period_start, 'end', v_sub.current_period_end) END,
    'renewsOn', CASE WHEN v_sub.status IN ('active', 'payment_due', 'grace', 'lapsed')
                      AND NOT v_sub.pause_at_period_end
                      AND (v_sub.cancel_at IS NULL OR v_sub.cancel_at > v_sub.current_period_end)
                     THEN v_sub.current_period_end END,
    'renewalEmailOn', CASE WHEN v_sub.status IN ('active') AND NOT v_sub.pause_at_period_end
                            AND (v_sub.cancel_at IS NULL OR v_sub.cancel_at > v_sub.current_period_end)
                           THEN v_sub.current_period_end - make_interval(days => v_plan.renewal_notice_days) END,
    'canCheckIn', v_can_enter,
    'assignedSpace', CASE WHEN v_sub.assigned_space_id IS NULL THEN NULL ELSE
      (SELECT jsonb_build_object('id', s.id, 'name', s.name) FROM public.venue_spaces s WHERE s.id = v_sub.assigned_space_id) END,
    'deskBookedFrom', (SELECT CASE
        WHEN c.id IS NULL OR upper(c.claim_range) >= COALESCE(v_sub.cancel_at, v_sub.current_period_end + interval '731 days') THEN NULL
        ELSE upper(c.claim_range) END
      FROM public.venue_space_claims c
      WHERE c.subscription_id = v_sub.id AND c.source = 'member' AND c.state IN ('held', 'committed') LIMIT 1),
    'requestReplyBy', CASE WHEN v_sub.status = 'requested' THEN v_sub.created_at + make_interval(hours =>
      COALESCE((SELECT bs.request_response_hours FROM public.venue_booking_settings bs WHERE bs.venue_id = v_venue.id), 48)) END,
    -- #4490 06-W4 fix 1 (W4-N2): amountMinor is what the payment page charges (VAT and fees
    -- included); baseMinor is the plan price; the breakdown comes from the one owner.
    'paymentDue', CASE WHEN v_open.id IS NULL THEN NULL ELSE public.issue_4490_member_period_charge(v_open.id) || jsonb_build_object(
      'periodId', v_open.id, 'amountMinor', (public.issue_4490_member_period_charge(v_open.id)->>'totalMinor')::bigint,
      'currencyCode', v_open.currency_code,
      'periodStart', v_open.period_start, 'periodEnd', v_open.period_end, 'dueAt', v_open.due_at,
      'status', v_open.status, 'graceEndsAt', v_open.due_at + make_interval(days => COALESCE((v_sub.terms->>'graceDays')::integer, 7)),
      'paying', EXISTS (SELECT 1 FROM public.stay_payment_attempts a WHERE a.group_id = v_open.group_id
                        AND a.state IN ('pending', 'ambiguous'))) END,
    'leaving', CASE WHEN v_sub.cancel_at IS NOT NULL AND v_sub.status <> 'cancelled'
                    THEN jsonb_build_object('endsAt', v_sub.cancel_at, 'by', v_sub.cancel_requested_by) END,
    'pausing', CASE WHEN v_sub.pause_at_period_end THEN jsonb_build_object('from', v_sub.current_period_end,
                    'by', v_sub.pause_requested_by) END,
    'paused', CASE WHEN v_sub.status = 'paused' THEN jsonb_build_object('since', v_sub.paused_since, 'by', v_sub.pause_reason) END,
    'endedAt', v_sub.cancelled_at,
    'endReason', v_sub.end_reason,
    'credits', jsonb_build_object(
      'roomHoursLeft', public.issue_4490_member_credit_left(v_sub.id, 'room_hours', now()),
      'roomHoursPerMonth', v_plan.room_hours_per_period,
      'guestPassesLeft', public.issue_4490_member_credit_left(v_sub.id, 'guest_passes', now()),
      'guestPassesPerMonth', v_plan.guest_passes_per_period),
    'inToday', EXISTS (SELECT 1 FROM public.venue_member_visits x WHERE x.subscription_id = v_sub.id
                       AND x.local_date = v_today AND x.undone_at IS NULL),
    'canLeave', v_sub.status IN ('pending', 'active', 'payment_due', 'grace', 'lapsed', 'paused') AND v_sub.cancel_at IS NULL,
    'canStay', v_sub.cancel_at IS NOT NULL AND v_sub.status <> 'cancelled' AND v_sub.cancel_requested_by = 'member',
    'canPause', v_sub.status IN ('active') AND NOT v_sub.pause_at_period_end AND v_sub.cancel_at IS NULL,
    'canResume', v_sub.status = 'paused' OR v_sub.pause_at_period_end,
    -- #4490 fix round 1 (B5): the months paid, newest first (the member, and
    -- staff who may see members; never a stranger: every caller checks first).
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'periodId', pp.id, 'start', pp.period_start, 'end', pp.period_end,
        'amountMinor', pp.amount_minor, 'currencyCode', pp.currency_code,
        'paidMinor', CASE WHEN pp.paid_via = 'online' THEN (SELECT NULLIF(sum(a.amount_minor), 0) FROM public.stay_payment_attempts a
                                                             WHERE a.group_id = pp.group_id AND a.state = 'succeeded') END,
        'paidAt', pp.paid_at, 'paidVia', pp.paid_via)
        ORDER BY pp.period_start DESC)
      FROM public.venue_membership_periods pp
      WHERE pp.subscription_id = v_sub.id AND pp.status = 'paid'), '[]'::jsonb),
    'memberPath', '/visit/plan/' || v_sub.id,
    'version', v_sub.version,
    -- #4490 explorer W1: the app-only pass switch (see the booking projection).
    'passInApp', public.issue_4490_flag_on('VENUE_PASS_APP_ONLY'),
    'createdAt', v_sub.created_at);
  IF p_view = 'guest' AND p_qr_pepper IS NOT NULL
     AND v_sub.status NOT IN ('cancelled', 'requested', 'declined') THEN
    v_result := v_result || jsonb_build_object('pass', jsonb_build_object(
      'qrPayload', public.issue_4490_member_qr_payload(v_sub.id, v_sub.qr_token_hash, p_qr_pepper),
      'valid', v_can_enter));
  END IF;
  -- #4490 fix 3 (N87): the member's own email, so a booking made as this
  -- member starts with their name and email filled in (the guest view is
  -- read only with the member's own token).
  IF p_view = 'guest' THEN
    v_result := v_result || jsonb_build_object('memberEmail', v_sub.member_email);
  END IF;
  IF p_view = 'host' THEN
    v_result := v_result || jsonb_build_object(
      'email', v_sub.member_email,
      'phone', v_sub.member_phone,
      'signedIn', v_sub.user_id IS NOT NULL,
      'periods', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'periodId', p.id, 'sequence', p.sequence, 'start', p.period_start, 'end', p.period_end,
          'amountMinor', p.amount_minor, 'currencyCode', p.currency_code, 'dueAt', p.due_at, 'status', p.status,
          'paidAt', p.paid_at, 'paidVia', p.paid_via, 'paidMethod', p.paid_method, 'remindersSent', to_jsonb(p.reminder_steps))
          ORDER BY p.period_start DESC)
        FROM public.venue_membership_periods p WHERE p.subscription_id = v_sub.id), '[]'::jsonb),
      'timeline', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'type', e.event_type, 'by', e.actor_type, 'at', e.created_at, 'periodId', e.period_id, 'detail', e.detail)
          ORDER BY e.created_at, e.id)
        FROM public.venue_membership_events e WHERE e.subscription_id = v_sub.id), '[]'::jsonb),
      'visits', COALESCE((SELECT jsonb_agg(jsonb_build_object('localDate', x.local_date, 'guests', x.guests,
          'at', x.created_at, 'undone', x.undone_at IS NOT NULL) ORDER BY x.created_at DESC)
        FROM (SELECT * FROM public.venue_member_visits WHERE subscription_id = v_sub.id ORDER BY created_at DESC LIMIT 20) x),
        '[]'::jsonb),
      'credits', (v_result->'credits') || jsonb_build_object(
        'ledger', COALESCE((SELECT jsonb_agg(jsonb_build_object('credit', l.credit, 'entry', l.entry, 'amount', l.amount,
            'at', l.created_at, 'groupId', l.group_id) ORDER BY l.created_at DESC)
          FROM (SELECT * FROM public.venue_credit_ledger WHERE subscription_id = v_sub.id ORDER BY created_at DESC LIMIT 40) l),
          '[]'::jsonb)),
      'canManage', public.issue_4490_user_can_manage_members(v_venue.id, auth.uid()),
      'canManageMoney', public.issue_4490_can_manage_money(v_venue.id, auth.uid()));
  END IF;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_public_memberships(p_venue_id uuid, p_features text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN NOT public.issue_4490_flag_on('VENUE_OFFERS_READS') OR NOT ('memberships' = ANY(p_features)) THEN NULL
    ELSE (
      SELECT CASE WHEN count(*) = 0 THEN NULL ELSE jsonb_build_object(
        'fromMinor', COALESCE(min(x.price_minor) FILTER (WHERE x.joinable), min(x.price_minor)),
        'interval', COALESCE(
          (array_agg(x.period ORDER BY x.price_minor, x.period, x.sort_order, x.created_at) FILTER (WHERE x.joinable))[1],
          (array_agg(x.period ORDER BY x.price_minor, x.period, x.sort_order, x.created_at))[1]),
        'fromJoinable', COALESCE(bool_or(x.joinable), false),
        'currencyCode', min(x.currency_code),
        'plans', jsonb_agg(jsonb_build_object(
          'id', x.id, 'name', x.name, 'summary', x.summary, 'inclusions', x.inclusions,
          'priceMinor', x.price_minor, 'interval', x.period,
          -- #4490 06-W4 fix 1 (W4-N2): what one period's payment charges (VAT and fees included).
          'charge', public.issue_4490_member_charge(x.offering_id, x.price_minor),
          'entryIncluded', x.entry_included, 'roomHours', x.room_hours_per_period,
          'guestPasses', x.guest_passes_per_period, 'discountBps', x.discount_bps,
          'discountKinds', to_jsonb(x.discount_kinds),
          'minMonths', x.min_months, 'noticeDays', x.notice_days, 'graceDays', x.grace_days,
          'renewalNoticeDays', x.renewal_notice_days,
          'joinMode', x.join_mode,
          'assignedDeskAvailable', cardinality(x.desk_space_ids) > 0,
          'full', x.full)
          ORDER BY x.sort_order, x.created_at)) END
      FROM (
        SELECT p.*, f.full, (p.join_mode = 'request' OR NOT f.full) AS joinable
        FROM public.venue_membership_plans p
        JOIN public.stay_offerings o ON o.id = p.offering_id
        CROSS JOIN LATERAL (
          SELECT COALESCE((public.issue_4490_membership_plan_projection(p.id)->>'full')::boolean, false) AS full
          OFFSET 0  -- the projection runs once per plan
        ) f
        WHERE o.venue_id = p_venue_id AND p.status = 'live'
      ) x)
    END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_venue_members(p_venue_id uuid, p_filter text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tz text;
  v_today date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.issue_4490_can_view_members(p_venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_filter, 'all') NOT IN ('all', 'active', 'payment_due', 'paused', 'ended', 'pending', 'requests') THEN
    RAISE EXCEPTION 'invalid_filter' USING ERRCODE = '22023';
  END IF;
  v_tz := public.issue_4490_venue_timezone(p_venue_id);
  v_today := (now() AT TIME ZONE v_tz)::date;
  RETURN (
    WITH members AS (
      SELECT s.*, p.name AS plan_name, p.period AS plan_period, p.max_members
      FROM public.venue_membership_subscriptions s
      JOIN public.venue_membership_plans p ON p.id = s.plan_id
      JOIN public.stay_offerings o ON o.id = p.offering_id
      WHERE o.venue_id = p_venue_id
    )
    SELECT jsonb_build_object(
      'venueId', p_venue_id,
      'localDate', v_today,
      'tiles', jsonb_build_object(
        'members', (SELECT count(*) FROM members WHERE status IN ('active', 'payment_due', 'grace', 'lapsed', 'paused')),
        'membersAllowed', (SELECT sum(pl.max_members) FROM public.venue_membership_plans pl
                           JOIN public.stay_offerings o ON o.id = pl.offering_id
                           WHERE o.venue_id = p_venue_id AND pl.status IN ('live', 'paused') AND pl.max_members IS NOT NULL),
        'inToday', (SELECT count(*) FROM public.venue_member_visits x JOIN members m ON m.id = x.subscription_id
                    WHERE x.local_date = v_today AND x.undone_at IS NULL),
        'paymentDue', (SELECT jsonb_build_object('count', count(DISTINCT m.id), 'amountMinor', COALESCE(sum((public.issue_4490_member_period_charge(pe.id)->>'totalMinor')::bigint), 0))
                       FROM members m JOIN public.venue_membership_periods pe ON pe.subscription_id = m.id
                       WHERE m.status IN ('payment_due', 'grace', 'lapsed') AND pe.status IN ('link_sent', 'overdue')
                         AND pe.due_at <= now()),
        'renewingThisWeek', (SELECT count(*) FROM members m WHERE m.status = 'active' AND NOT m.pause_at_period_end
                             AND m.cancel_at IS NULL AND m.current_period_end < now() + interval '7 days')),
      'members', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'subscriptionId', m.id, 'name', m.member_name, 'email', m.member_email, 'phone', m.member_phone,
          'planId', m.plan_id, 'planName', m.plan_name, 'planPeriod', m.plan_period, 'status', m.status,
          'activeUntil', m.current_period_end,
          'renewsOn', CASE WHEN m.status IN ('active', 'payment_due', 'grace') AND NOT m.pause_at_period_end
                            AND m.cancel_at IS NULL THEN m.current_period_end END,
          'leavingOn', CASE WHEN m.status <> 'cancelled' THEN m.cancel_at END,
          'pausingOn', CASE WHEN m.pause_at_period_end THEN m.current_period_end END,
          'roomHoursLeft', public.issue_4490_member_credit_left(m.id, 'room_hours', now()),
          'guestPassesLeft', public.issue_4490_member_credit_left(m.id, 'guest_passes', now()),
          'inToday', EXISTS (SELECT 1 FROM public.venue_member_visits x WHERE x.subscription_id = m.id
                             AND x.local_date = v_today AND x.undone_at IS NULL),
          -- #4490 06-W4 fix 1 (W4-N2): what the member's payment page charges.
          'amountDueMinor', (SELECT (public.issue_4490_member_period_charge(pe.id)->>'totalMinor')::bigint
                             FROM public.venue_membership_periods pe
                             WHERE pe.id = public.issue_4490_member_open_period(m.id)),
          'assignedSpaceName', (SELECT s.name FROM public.venue_spaces s WHERE s.id = m.assigned_space_id),
          'version', m.version, 'joinedAt', m.created_at)
          ORDER BY CASE m.status WHEN 'lapsed' THEN 0 WHEN 'grace' THEN 1 WHEN 'payment_due' THEN 2 WHEN 'active' THEN 3
                                 WHEN 'paused' THEN 4 WHEN 'pending' THEN 5 ELSE 6 END, m.member_name, m.id)
        FROM members m
        WHERE CASE COALESCE(p_filter, 'all')
          WHEN 'all' THEN m.status NOT IN ('cancelled', 'declined') AND NOT (m.status = 'pending' AND m.created_at < now() - interval '2 days')
          WHEN 'requests' THEN m.status = 'requested'
          WHEN 'active' THEN m.status IN ('active', 'payment_due', 'grace')
          WHEN 'payment_due' THEN m.status IN ('payment_due', 'grace', 'lapsed')
          WHEN 'paused' THEN m.status = 'paused'
          WHEN 'pending' THEN m.status = 'pending'
          ELSE m.status IN ('cancelled', 'declined') END), '[]'::jsonb)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_member_enqueue(p_subscription_id uuid, p_period_id uuid, p_category text, p_step text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_sub public.venue_membership_subscriptions%ROWTYPE;
  v_plan public.venue_membership_plans%ROWTYPE;
  v_period public.venue_membership_periods%ROWTYPE;
  v_venue record;
  v_tz text;
  v_vat bigint := 0;
  v_charge jsonb;
BEGIN
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RETURN;
  END IF;
  SELECT * INTO v_sub FROM public.venue_membership_subscriptions WHERE id = p_subscription_id;
  SELECT * INTO v_plan FROM public.venue_membership_plans WHERE id = v_sub.plan_id;
  IF p_period_id IS NOT NULL THEN
    SELECT * INTO v_period FROM public.venue_membership_periods WHERE id = p_period_id;
  END IF;
  SELECT v.id, v.name, v.slug, b.slug AS brand_slug INTO v_venue
  FROM public.stay_offerings o JOIN public.venue_listings v ON v.id = o.venue_id
  JOIN public.brands b ON b.id = v.brand_id WHERE o.id = v_plan.offering_id;
  v_tz := public.issue_4490_venue_timezone(v_venue.id);
  -- #4490 06-W4 fix 1 (W4-N2): the email's money lines come from the one owner (the charge the
  -- payment page asks for): VAT shown when it is added on top; the total is the charge.
  IF v_period.id IS NOT NULL THEN
    v_charge := public.issue_4490_member_period_charge(v_period.id);
    v_vat := CASE WHEN v_charge->>'vatMode' = 'added' THEN (v_charge->>'taxMinor')::bigint ELSE 0 END;
  END IF;
  INSERT INTO public.notification_outbox (
    category_key, user_id, contact, brand_id, payload, idempotency_key, country_code
  ) VALUES (
    p_category, v_sub.user_id, lower(v_sub.member_email), v_sub.brand_id,
    jsonb_strip_nulls(jsonb_build_object(
      'subscription_id', v_sub.id,
      'venue_id', v_venue.id,
      'venue_name', v_venue.name,
      'brand_slug', v_venue.brand_slug,
      'venue_slug', v_venue.slug,
      'member_name', v_sub.member_name,
      'member_code', v_sub.member_code,
      'plan_name', v_plan.name,
      'period', COALESCE(v_sub.terms->>'period', v_plan.period),
      'step', p_step,
      'amount_cents', v_period.amount_minor,
      'vat_cents', CASE WHEN v_period.id IS NOT NULL THEN v_vat END,
      'total_cents', CASE WHEN v_period.id IS NOT NULL THEN (v_charge->>'totalMinor')::bigint END,
      'currency', COALESCE(v_period.currency_code, v_plan.currency_code),
      'period_start_date', (v_period.period_start AT TIME ZONE v_tz)::date,
      'period_end_date', (v_period.period_end AT TIME ZONE v_tz)::date,
      'renews_on', (v_sub.current_period_end AT TIME ZONE v_tz)::date,
      'paid_through', (v_sub.current_period_end AT TIME ZONE v_tz)::date,
      'grace_ends_on', CASE WHEN v_period.id IS NOT NULL
                            THEN ((v_period.due_at + make_interval(days => COALESCE((v_sub.terms->>'graceDays')::integer, 7)))
                                  AT TIME ZONE v_tz)::date END,
      'ends_on', (v_sub.cancel_at AT TIME ZONE v_tz)::date,
      'first', CASE WHEN v_period.sequence = 1 THEN true END)),
    'venue-member:' || v_sub.id || ':' || COALESCE(p_period_id::text, 'none') || ':' || p_category || ':' || COALESCE(p_step, '-'),
    NULL
  ) ON CONFLICT (idempotency_key) DO NOTHING;
END;
$function$;


-- ---------------------------------------------------------------------------
-- 4. One live payment page per booking (W4-N3).
-- ---------------------------------------------------------------------------
-- The provider's page for an attempt, kept server side only so a second `pay` for the same
-- booking (another device, or app plus web) gets the SAME page instead of a second one. No
-- client reads this table; only the service role writes it (issue_4490_record_payment_page).
CREATE TABLE IF NOT EXISTS public.issue_4490_payment_pages (
  payment_attempt_id uuid PRIMARY KEY REFERENCES public.stay_payment_attempts(id) ON DELETE CASCADE,
  checkout_url text NOT NULL CHECK (checkout_url ~ '^https://checkout\.paystack\.com/[A-Za-z0-9_-]{1,120}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.issue_4490_payment_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.issue_4490_payment_pages FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.issue_4490_payment_pages TO service_role;

CREATE OR REPLACE FUNCTION public.issue_4490_record_payment_page(p_attempt_id uuid, p_checkout_url text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_attempt_id IS NULL
     OR COALESCE(p_checkout_url, '') !~ '^https://checkout\.paystack\.com/[A-Za-z0-9_-]{1,120}$' THEN
    RETURN false;
  END IF;
  INSERT INTO public.issue_4490_payment_pages (payment_attempt_id, checkout_url)
  SELECT a.id, p_checkout_url FROM public.stay_payment_attempts a
  WHERE a.id = p_attempt_id AND a.provider = 'paystack' AND a.state = 'pending'
  ON CONFLICT (payment_attempt_id) DO NOTHING;
  RETURN FOUND;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_record_payment_page(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_record_payment_page(uuid, text) TO service_role;


CREATE OR REPLACE FUNCTION public.issue_4490_prepare_offer_payment(p_group_id uuid, p_token_hash bytea, p_user_id uuid, p_idempotency_key text, p_expected_version bigint, p_pay_mode text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_hold public.stay_inventory_holds%ROWTYPE;
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_money record;
  v_provider text;
  v_account text;
  v_currency text;
  v_take_rate integer;
  v_app_fee bigint;
  v_ordinal integer;
  v_request_hash text;
  v_cutover timestamptz;
  v_readiness bigint;
  v_stage text;
  v_amount bigint;
  v_outstanding bigint;
  v_damage_out bigint;
  v_live public.stay_payment_attempts%ROWTYPE;
  v_page text;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_group_id IS NULL OR p_expected_version IS NULL
     OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200
     OR (p_pay_mode IS NOT NULL AND p_pay_mode NOT IN ('deposit', 'full')) THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('offer-payment:' || p_group_id::text || ':' || btrim(p_idempotency_key), 4490));
  -- #4490 06-W4 fix 1 (W4-N3): one payment at a time per booking, whatever the key.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('offer-payment-group:' || p_group_id::text, 4490));
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND OR NOT public.issue_4490_booking_actor_ok(v_group, p_token_hash, p_user_id) THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_attempt FROM public.stay_payment_attempts
  WHERE group_id = p_group_id AND idempotency_key = btrim(p_idempotency_key) FOR UPDATE;
  IF FOUND THEN
    IF v_attempt.request_hash <> encode(pg_catalog.sha256(convert_to(jsonb_build_object(
         'groupId', p_group_id, 'expectedVersion', p_expected_version, 'stage', v_attempt.stage,
         'amountMinor', v_attempt.amount_minor::text)::text, 'UTF8')), 'hex')
       AND v_attempt.request_hash <> encode(pg_catalog.sha256(convert_to(jsonb_build_object(
         'groupId', p_group_id, 'expectedVersion', p_expected_version, 'stage', v_attempt.stage)::text, 'UTF8')), 'hex') THEN
      RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_1389_attempt_projection(v_attempt.id) || jsonb_build_object('stage', v_attempt.stage);
  END IF;
  IF v_group.version <> p_expected_version THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_money FROM public.issue_4490_booking_money(p_group_id);

  IF v_group.state IN ('instant_payment_pending', 'approved_payment_required') THEN
    IF v_group.payment_collection <> 'mingla' THEN
      RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
    END IF;
    SELECT * INTO v_hold FROM public.stay_inventory_holds WHERE group_id = p_group_id FOR UPDATE;
    IF NOT FOUND OR v_hold.state <> 'active' OR v_hold.expires_at <= now() THEN
      RAISE EXCEPTION 'offer_hold_expired' USING ERRCODE = 'PT409';
    END IF;
    IF EXISTS (SELECT 1 FROM public.stay_payment_attempts a WHERE a.group_id = p_group_id AND a.state = 'succeeded') THEN
      RAISE EXCEPTION 'offer_payment_already_pending' USING ERRCODE = 'PT409';
    END IF;
    IF p_pay_mode = 'deposit' THEN
      IF v_group.deposit_minor IS NULL OR v_group.balance_due_at IS NULL OR v_group.balance_due_at <= now() THEN
        RAISE EXCEPTION 'offer_pay_mode_unavailable' USING ERRCODE = '22023';
      END IF;
      v_stage := 'deposit';
      v_amount := v_group.deposit_minor;
    ELSE
      v_stage := 'full';
      -- #4490 P4: the total owed (an approved hire's edited quote included).
      v_amount := COALESCE(v_money.total_due, v_group.total_minor);
    END IF;
  ELSIF v_group.state IN ('confirmed', 'partially_cancelled') THEN
    IF COALESCE(v_money.balance, 0) <= 0 THEN
      RAISE EXCEPTION 'offer_nothing_to_pay' USING ERRCODE = 'PT409';
    END IF;
    v_stage := 'balance';
    v_amount := v_money.balance;
  ELSE
    RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  -- #4490 06-W4 fix 1 (W4-N3): a payment already in flight for this booking (pending or
  -- ambiguous, or created in the last two minutes and still talking to the provider). The same
  -- stage and amount with its page remembered: that attempt and page again (one page, one
  -- charge). A different stage or amount at the same time: refused. Otherwise: in progress
  -- (the edge asks the provider about it first, as before).
  SELECT * INTO v_live FROM public.stay_payment_attempts a
  WHERE a.group_id = p_group_id
    AND (a.state IN ('pending', 'ambiguous')
         OR (a.state = 'created' AND a.created_at > now() - interval '2 minutes'))
  ORDER BY a.attempt_ordinal DESC
  LIMIT 1;
  IF FOUND THEN
    IF v_live.state IN ('pending', 'created') AND v_live.created_at > now() - interval '15 minutes'
       AND (v_live.stage IS DISTINCT FROM v_stage OR v_live.amount_minor <> v_amount) THEN
      RAISE EXCEPTION 'offer_payment_mode_conflict' USING ERRCODE = 'PT409';
    END IF;
    IF v_live.state = 'pending' AND v_live.provider = 'paystack'
       AND v_live.created_at > now() - interval '15 minutes' THEN
      SELECT pg.checkout_url INTO v_page FROM public.issue_4490_payment_pages pg
      WHERE pg.payment_attempt_id = v_live.id;
      IF v_page IS NOT NULL THEN
        RETURN public.issue_1389_attempt_projection(v_live.id)
          || jsonb_build_object('stage', v_live.stage, 'reused', true, 'checkoutUrl', v_page);
      END IF;
    END IF;
    RAISE EXCEPTION 'offer_payment_already_pending' USING ERRCODE = 'PT409';
  END IF;
  IF v_amount > 2147483647 THEN
    RAISE EXCEPTION 'offer_amount_too_large' USING ERRCODE = 'P0001';
  END IF;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  v_request_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'groupId', p_group_id, 'expectedVersion', p_expected_version, 'stage', v_stage,
    'amountMinor', v_amount::text)::text, 'UTF8')), 'hex');
  PERFORM 1 FROM public.brands WHERE id = v_group.brand_id FOR UPDATE;
  SELECT
    CASE WHEN pricing.payment_provider = 'paystack' THEN 'paystack' ELSE 'stripe' END,
    CASE WHEN pricing.payment_provider = 'paystack' THEN pricing.paystack_subaccount_code ELSE pricing.stripe_account_id END,
    upper(pricing.pricing_currency),
    pricing.effective_take_rate_bps
  INTO v_provider, v_account, v_currency, v_take_rate
  FROM public.resolve_brand_pricing_inputs(v_group.brand_id, v_group.venue_id) pricing
  LIMIT 1;
  SELECT b.payout_hold_cutover_at, b.discovery_currency_state_version INTO v_cutover, v_readiness
  FROM public.brands b WHERE b.id = v_group.brand_id;
  IF v_provider IS NULL
     OR v_currency IS DISTINCT FROM v_group.currency_code::text
     OR NOT public.pg_brand_can_collect(v_group.brand_id)
     OR v_cutover IS NULL
     OR (v_provider = 'stripe' AND v_account IS NULL)
     OR (v_provider = 'paystack' AND v_currency <> 'NGN')
     OR (v_provider = 'paystack' AND NULLIF(v_group.guest_snapshot->>'email', '') IS NULL) THEN
    RAISE EXCEPTION 'offer_bank_not_ready' USING ERRCODE = 'P0001';
  END IF;
  -- What can take this payment: a deposit never touches the damage deposit.
  SELECT COALESCE(sum(c.outstanding_minor) FILTER (
           WHERE NOT (v_stage = 'deposit' AND c.component = 'fee' AND c.snapshot->>'fee_key' = 'damage_deposit')), 0),
         COALESCE(sum(c.outstanding_minor) FILTER (
           WHERE c.component = 'fee' AND c.snapshot->>'fee_key' = 'damage_deposit'), 0)
  INTO v_outstanding, v_damage_out
  FROM public.issue_4490_payment_components(p_group_id) c;
  IF v_outstanding < v_amount THEN
    RAISE EXCEPTION 'offer_payment_allocation_mismatch' USING ERRCODE = '23514';
  END IF;
  v_app_fee := LEAST(v_amount, round(
    (v_amount - CASE WHEN v_stage = 'deposit' THEN 0 ELSE LEAST(v_damage_out, v_amount) END)::numeric
    * COALESCE(v_take_rate, 0) / 10000)::bigint);
  SELECT COALESCE(max(attempt_ordinal), 0) + 1 INTO v_ordinal
  FROM public.stay_payment_attempts WHERE group_id = p_group_id;
  PERFORM set_config('mingla.issue_4490_offer_rail', p_group_id::text, true);
  INSERT INTO public.stay_payment_attempts (
    group_id, provider, attempt_ordinal, connected_account_ref, amount_minor, currency_code,
    application_fee_minor, state, idempotency_key, request_hash, readiness_revision, stage
  ) VALUES (
    p_group_id, v_provider, v_ordinal, v_account, v_amount, v_group.currency_code,
    v_app_fee, 'created', btrim(p_idempotency_key), v_request_hash, COALESCE(v_readiness, 1), v_stage
  ) RETURNING * INTO v_attempt;
  WITH comp AS (
    SELECT * FROM public.issue_4490_payment_components(p_group_id) c
    WHERE c.outstanding_minor > 0
      AND NOT (v_stage = 'deposit' AND c.component = 'fee' AND c.snapshot->>'fee_key' = 'damage_deposit')
  ), tot AS (
    SELECT sum(outstanding_minor) AS s FROM comp
  ), fl AS (
    SELECT comp.*,
      floor(v_amount::numeric * comp.outstanding_minor / tot.s)::bigint AS f,
      (v_amount::numeric * comp.outstanding_minor)
        - floor(v_amount::numeric * comp.outstanding_minor / tot.s) * tot.s AS rem
    FROM comp, tot
  ), rk AS (
    SELECT fl.*,
      row_number() OVER (ORDER BY fl.rem DESC, fl.sort_key, fl.reservation_line_id, fl.component_ref) AS rn,
      v_amount - sum(fl.f) OVER () AS extra
    FROM fl
  )
  INSERT INTO public.stay_payment_allocations (
    payment_attempt_id, reservation_line_id, component, component_ref, charged_minor, refund_treatment, snapshot
  )
  SELECT v_attempt.id, rk.reservation_line_id, rk.component, rk.component_ref,
         rk.f + CASE WHEN rk.rn <= rk.extra THEN 1 ELSE 0 END,
         rk.refund_treatment, rk.snapshot || jsonb_build_object('stage', v_stage)
  FROM rk
  WHERE rk.f + CASE WHEN rk.rn <= rk.extra THEN 1 ELSE 0 END > 0
  ORDER BY rk.reservation_line_id, rk.sort_key, rk.component_ref;
  IF (SELECT COALESCE(sum(charged_minor), 0) FROM public.stay_payment_allocations
      WHERE payment_attempt_id = v_attempt.id) <> v_attempt.amount_minor THEN
    RAISE EXCEPTION 'offer_payment_allocation_mismatch' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, 'stay_payment_prepared', 'guest', p_user_id, 'payment-prepared:' || v_attempt.id,
    jsonb_build_object('attemptId', v_attempt.id, 'provider', v_provider,
      'amountMinor', v_attempt.amount_minor::text, 'currencyCode', v_attempt.currency_code, 'stage', v_stage)
  );
  RETURN public.issue_1389_attempt_projection(v_attempt.id) || jsonb_build_object('stage', v_stage);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_membership_prepare_payment(p_subscription_id uuid, p_token_hash bytea, p_user_id uuid, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_sub public.venue_membership_subscriptions%ROWTYPE;
  v_period public.venue_membership_periods%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_group_id uuid;
  v_prepared jsonb;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'membership_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_sub FROM public.venue_membership_subscriptions WHERE id = p_subscription_id FOR UPDATE;
  IF NOT FOUND OR NOT public.issue_4490_member_actor_ok(v_sub, p_token_hash, p_user_id) THEN
    RAISE EXCEPTION 'membership_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- Replay: the same key on a month already started returns that payment.
  SELECT g.* INTO v_group FROM public.stay_payment_attempts a
  JOIN public.stay_reservation_groups g ON g.id = a.group_id
  JOIN public.venue_membership_periods p ON p.group_id = g.id
  WHERE p.subscription_id = v_sub.id AND a.idempotency_key = btrim(p_idempotency_key)
  ORDER BY a.created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN public.issue_4490_prepare_offer_payment(v_group.id,
      pg_catalog.sha256(v_sub.member_token_hash || convert_to(v_group.id::text, 'UTF8')), NULL,
      p_idempotency_key, v_group.version, 'full')
      || jsonb_build_object('groupId', v_group.id, 'subscriptionId', v_sub.id,
           'periodId', (SELECT p.id FROM public.venue_membership_periods p WHERE p.group_id = v_group.id));
  END IF;
  IF v_sub.status = 'cancelled' THEN
    RAISE EXCEPTION 'membership_ended' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_period FROM public.venue_membership_periods
  WHERE id = public.issue_4490_member_open_period(v_sub.id) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'membership_nothing_to_pay' USING ERRCODE = 'PT409';
  END IF;
  IF v_period.group_id IS NOT NULL THEN
    SELECT g.* INTO v_group FROM public.stay_reservation_groups g
    JOIN public.stay_inventory_holds h ON h.group_id = g.id
    WHERE g.id = v_period.group_id AND g.state = 'instant_payment_pending'
      AND h.state = 'active'
      AND (h.expires_at > now() + interval '2 minutes'
           -- #4490 06-W4 fix 1 (W4-N3): a payment on it is in flight: keep that group, so a
           -- second device gets the same page (or is told it is in progress), never a second
           -- group with a second page.
           OR (h.expires_at > now() AND EXISTS (
                 SELECT 1 FROM public.stay_payment_attempts a
                 WHERE a.group_id = g.id
                   AND (a.state IN ('pending', 'ambiguous')
                        OR (a.state = 'created' AND a.created_at > now() - interval '2 minutes')))));
  END IF;
  v_group_id := CASE WHEN v_group.id IS NOT NULL THEN v_group.id
                     ELSE public.issue_4490_membership_period_group(v_period.id) END;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = v_group_id;
  v_prepared := public.issue_4490_prepare_offer_payment(v_group.id,
    pg_catalog.sha256(v_sub.member_token_hash || convert_to(v_group.id::text, 'UTF8')), NULL,
    p_idempotency_key, v_group.version, 'full');
  RETURN v_prepared || jsonb_build_object('groupId', v_group.id, 'subscriptionId', v_sub.id, 'periodId', v_period.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_1389_finalize_payment(p_provider text, p_provider_event_id text, p_provider_event_type text, p_provider_payment_ref text, p_provider_charge_ref text, p_amount_minor bigint, p_currency_code text, p_provider_fee_minor bigint DEFAULT NULL::bigint, p_event_fingerprint text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_hold public.stay_inventory_holds%ROWTYPE;
  v_event_id uuid;
  v_line public.stay_reservation_lines%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_provider NOT IN ('stripe', 'paystack')
     OR char_length(COALESCE(p_provider_event_id, '')) NOT BETWEEN 3 AND 240
     OR char_length(COALESCE(p_provider_payment_ref, '')) NOT BETWEEN 3 AND 200
     OR p_amount_minor <= 0
     OR upper(COALESCE(p_currency_code, '')) !~ '^[A-Z]{3}$'
     OR (
       p_provider_fee_minor IS NOT NULL
       AND p_provider_fee_minor < 0
     ) THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_attempt
  FROM public.stay_payment_attempts
  WHERE provider = p_provider
    AND provider_payment_ref = p_provider_payment_ref
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stay_payment_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.stay_provider_events (
    provider, provider_event_id, provider_event_type, payment_attempt_id,
    event_fingerprint, safe_payload
  ) VALUES (
    p_provider, p_provider_event_id, p_provider_event_type, v_attempt.id,
    COALESCE(
      NULLIF(p_event_fingerprint, ''),
      encode(extensions.digest(
        pg_catalog.convert_to(
          p_provider || ':' || p_provider_event_id || ':' ||
          p_provider_payment_ref,
          'UTF8'
        ),
        'sha256'
      ), 'hex')
    ),
    jsonb_build_object(
      'amountMinor', p_amount_minor::text,
      'currencyCode', upper(p_currency_code)
    )
  )
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;
  IF v_attempt.state = 'succeeded' THEN
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;
  -- #4490 P3: a venue booking's balance payment never touches the hold.
  IF v_attempt.stage IN ('balance', 'amendment') THEN
    RETURN public.issue_4490_finalize_followup_payment(
      v_attempt.id, p_provider_event_id, p_provider_payment_ref, p_provider_charge_ref,
      p_amount_minor, p_currency_code, p_provider_fee_minor);
  END IF;

  SELECT * INTO v_group
  FROM public.stay_reservation_groups
  WHERE id = v_attempt.group_id
  FOR UPDATE;
  SELECT * INTO v_hold
  FROM public.stay_inventory_holds
  WHERE group_id = v_attempt.group_id
  FOR UPDATE;

  IF v_attempt.amount_minor <> p_amount_minor
     OR v_attempt.currency_code <> upper(p_currency_code)::character(3)
     OR (
       v_attempt.provider_payment_ref IS DISTINCT FROM p_provider_payment_ref
     ) THEN
    UPDATE public.stay_payment_attempts
    SET state = 'ambiguous',
        failure_code = 'provider_evidence_mismatch',
        provider_event_ref = p_provider_event_id,
        version = version + 1,
        updated_at = now()
    WHERE id = v_attempt.id;
    UPDATE public.stay_reservation_groups
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE id = v_group.id
      AND state IN (
        'instant_payment_pending', 'approved_payment_required', 'finalizing'
      );
    UPDATE public.stay_inventory_holds
    SET state = 'reconciliation_required',
        reason = 'provider_evidence_mismatch',
        version = version + 1,
        updated_at = now()
    WHERE id = v_hold.id AND state = 'active';
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;

  -- #4490 06-W4 fix 1 (W4-N3): a second successful first payment (full or deposit) for a venue
  -- booking or plan period that another attempt already paid. Recorded as refund due (the
  -- refund queue trigger refunds it in full); the paid booking keeps its state (it used to fall
  -- into the late-success branch below and move to reconciliation).
  IF v_group.offer_kind IS NOT NULL
     AND v_attempt.stage IN ('full', 'deposit')
     AND EXISTS (SELECT 1 FROM public.stay_payment_attempts a
                 WHERE a.group_id = v_group.id AND a.id <> v_attempt.id
                   AND a.state = 'succeeded' AND a.stage IN ('full', 'deposit')) THEN
    UPDATE public.stay_payment_attempts
    SET state = 'refund_due',
        provider_event_ref = p_provider_event_id,
        provider_charge_ref = COALESCE(NULLIF(p_provider_charge_ref, ''), provider_charge_ref),
        failure_code = 'duplicate_payment',
        version = version + 1,
        updated_at = now()
    WHERE id = v_attempt.id;
    INSERT INTO public.stay_money_ledger (
      group_id, payment_attempt_id, entry_type, amount_minor, currency_code,
      provider_reference, idempotency_key, metadata
    ) VALUES (
      v_group.id, v_attempt.id, 'charge_succeeded',
      v_attempt.amount_minor, v_attempt.currency_code,
      p_provider_payment_ref,
      'stay:duplicate_charge_succeeded:' || v_attempt.id,
      jsonb_build_object('refundDue', true, 'duplicate', true)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, idempotency_key, safe_metadata
    ) VALUES (
      v_group.id, 'stay_payment_duplicate_refund_due', 'service',
      'duplicate-payment-refund-due:' || v_attempt.id,
      jsonb_build_object('attemptId', v_attempt.id)
    ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;

  IF v_hold.id IS NULL
     OR v_hold.state NOT IN ('active', 'reconciliation_required')
     OR (
       v_hold.state = 'active'
       AND v_hold.expires_at <= now()
     )
     OR v_group.state NOT IN (
       'instant_payment_pending',
       'approved_payment_required',
       'reconciliation_required'
     ) THEN
    UPDATE public.stay_payment_attempts
    SET state = 'refund_due',
        provider_event_ref = p_provider_event_id,
        provider_charge_ref = COALESCE(
          NULLIF(p_provider_charge_ref, ''),
          provider_charge_ref
        ),
        failure_code = 'late_success_inventory_unavailable',
        version = version + 1,
        updated_at = now()
    WHERE id = v_attempt.id;
    -- #4490 P3: a payment that arrives after the booking was already
    -- cancelled, declined or expired is recorded as refund due; the booking
    -- keeps its closed state (it used to fail the transition guard on every
    -- webhook retry).
    UPDATE public.stay_reservation_groups
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE id = v_group.id
      AND state IN (
        'instant_payment_pending', 'approved_payment_required', 'finalizing',
        'confirmed', 'partially_cancelled'
      );
    UPDATE public.stay_inventory_holds
    SET state = 'reconciliation_required',
        reason = 'late_success_refund_due',
        version = version + 1,
        updated_at = now()
    WHERE id = v_hold.id AND state = 'active';
    INSERT INTO public.stay_money_ledger (
      group_id, payment_attempt_id, entry_type, amount_minor, currency_code,
      provider_reference, idempotency_key, metadata
    ) VALUES (
      v_group.id, v_attempt.id, 'charge_succeeded',
      v_attempt.amount_minor, v_attempt.currency_code,
      p_provider_payment_ref,
      'stay:late_charge_succeeded:' || v_attempt.id,
      jsonb_build_object('refundDue', true)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, idempotency_key, safe_metadata
    ) VALUES (
      v_group.id, 'stay_payment_late_refund_due', 'service',
      'late-payment-refund-due:' || v_attempt.id,
      jsonb_build_object('attemptId', v_attempt.id)
    ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;

  IF NOT public.pg_brand_can_collect(v_group.brand_id)
     OR EXISTS (
       SELECT 1 FROM public.brand_currency_reconciliations reconciliation
       WHERE reconciliation.brand_id = v_group.brand_id
         AND reconciliation.status = 'pending'
     ) THEN
    UPDATE public.stay_payment_attempts
    SET state = 'refund_due',
        failure_code = 'readiness_changed_after_charge',
        provider_event_ref = p_provider_event_id,
        version = version + 1,
        updated_at = now()
    WHERE id = v_attempt.id;
    UPDATE public.stay_reservation_groups
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE id = v_group.id;
    UPDATE public.stay_inventory_holds
    SET state = 'reconciliation_required',
        reason = 'readiness_changed_after_charge',
        version = version + 1,
        updated_at = now()
    WHERE id = v_hold.id AND state = 'active';
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;

  UPDATE public.stay_reservation_groups
  SET state = 'finalizing', version = version + 1, updated_at = now()
  WHERE id = v_group.id;

  INSERT INTO public.stay_inventory_commitments (
    group_id, reservation_line_id, resource_type, offering_id,
    room_date, place_window_id, quantity, exclusive_unit_id
  )
  SELECT
    v_group.id, slice_row.reservation_line_id, slice_row.resource_type,
    slice_row.offering_id, slice_row.room_date, slice_row.place_window_id,
    slice_row.quantity, slice_row.exclusive_unit_id
  FROM public.stay_inventory_hold_slices slice_row
  WHERE slice_row.hold_id = v_hold.id
  ORDER BY
    slice_row.resource_type,
    slice_row.offering_id,
    slice_row.room_date,
    slice_row.place_window_id,
    slice_row.exclusive_unit_id
  ON CONFLICT DO NOTHING;

  IF (
    SELECT count(*)
    FROM public.stay_inventory_commitments commitment
    WHERE commitment.group_id = v_group.id
  ) <> (
    SELECT count(*)
    FROM public.stay_inventory_hold_slices slice_row
    WHERE slice_row.hold_id = v_hold.id
  ) THEN
    DELETE FROM public.stay_inventory_commitments
    WHERE group_id = v_group.id;
    UPDATE public.stay_payment_attempts
    SET state = 'refund_due',
        provider_event_ref = p_provider_event_id,
        provider_charge_ref = COALESCE(
          NULLIF(p_provider_charge_ref, ''),
          provider_charge_ref
        ),
        failure_code = 'commitment_conversion_failed',
        version = version + 1,
        updated_at = now()
    WHERE id = v_attempt.id;
    UPDATE public.stay_reservation_groups
    SET state = 'reconciliation_required',
        version = version + 1,
        updated_at = now()
    WHERE id = v_group.id;
    UPDATE public.stay_inventory_holds
    SET state = 'reconciliation_required',
        reason = 'commitment_conversion_failed',
        version = version + 1,
        updated_at = now()
    WHERE id = v_hold.id;
    RETURN public.issue_1389_attempt_projection(v_attempt.id);
  END IF;

  UPDATE public.stay_inventory_holds
  SET state = 'converted',
      reason = 'payment_succeeded',
      version = version + 1,
      updated_at = now()
  WHERE id = v_hold.id;
  UPDATE public.stay_reservation_lines
  SET state = 'confirmed', version = version + 1, updated_at = now()
  WHERE group_id = v_group.id
    AND state IN (
      'payment_pending', 'approved_payment_required', 'reconciliation_required'
    );
  UPDATE public.stay_reservation_groups
  SET state = 'confirmed', version = version + 1, updated_at = now()
  WHERE id = v_group.id;
  UPDATE public.stay_payment_attempts
  SET state = 'succeeded',
      provider_event_ref = p_provider_event_id,
      provider_charge_ref = COALESCE(
        NULLIF(p_provider_charge_ref, ''),
        provider_charge_ref
      ),
      provider_fee_minor = p_provider_fee_minor,
      failure_code = NULL,
      succeeded_at = now(),
      version = version + 1,
      updated_at = now()
  WHERE id = v_attempt.id
  RETURNING * INTO v_attempt;

  INSERT INTO public.stay_money_ledger (
    group_id, payment_attempt_id, entry_type, amount_minor, currency_code,
    provider_reference, idempotency_key, metadata
  ) VALUES (
    v_group.id, v_attempt.id, 'charge_succeeded',
    v_attempt.amount_minor, v_attempt.currency_code,
    p_provider_payment_ref,
    'stay:charge_succeeded:' || v_attempt.id,
    jsonb_build_object('providerEventId', p_provider_event_id)
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  FOR v_line IN
    SELECT * FROM public.stay_reservation_lines
    WHERE group_id = v_group.id
    ORDER BY id
  LOOP
    INSERT INTO public.stay_money_ledger (
      group_id, line_id, payment_attempt_id, entry_type,
      amount_minor, currency_code, provider_reference,
      idempotency_key, metadata
    ) VALUES (
      v_group.id, v_line.id, v_attempt.id, 'payout_eligible',
      v_line.total_minor, v_attempt.currency_code,
      p_provider_payment_ref,
      'stay:payout_eligible:' || v_line.id,
      jsonb_build_object('pendingReleaseAnchor', true)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END LOOP;

  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, idempotency_key, safe_metadata
  ) VALUES (
    v_group.id, 'stay_reservation_confirmed', 'service',
    'payment-confirmed:' || v_attempt.id,
    jsonb_build_object(
      'attemptId', v_attempt.id,
      'amountMinor', v_attempt.amount_minor::text,
      'currencyCode', v_attempt.currency_code
    )
  ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;

  RETURN public.issue_1389_attempt_projection(v_attempt.id);
END;
$function$;
