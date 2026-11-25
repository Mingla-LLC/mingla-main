-- #4490 P3 (step 2) — can this venue take payments online right now?
--
-- `venue-offers` action `pay` refuses with `offer_bank_not_ready` ("this venue
-- cannot take payments online right now") when the brand has no ready payment
-- provider account. Until now nothing said so earlier: the host could publish,
-- and a guest filled the whole checkout before hearing it. One rule now
-- answers the question for every reader:
--
--   issue_4490_can_collect_online(brand, venue)   the same checks `pay` makes
--     (provider resolved, currency matches the brand's, the brand can collect,
--     payout cutover stamped, Stripe account present, Paystack only in NGN).
--
-- Readers:
--   * issue_4490_list_offers: top-level `canCollectOnline`.
--   * issue_4490_offer_projection: `warnings` (`online_payments_off`), which
--     never blocks publish (gate sales still work); `readiness` is unchanged.
--   * pg_public_venue_page offers[] (issue_4490_public_offers): per offer
--     `canCollectOnline`, so the guest page can say "at the gate only" before
--     the details form; the edge `offer` read passes it on.
--
-- Static SQL. Local stack only until Seth says otherwise.
-- Reverse (local only): restore the three functions from 20281203074490 /
-- 20281203084490 and drop issue_4490_can_collect_online.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.issue_4490_can_collect_online(p_brand_id uuid, p_venue_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_provider text;
  v_account text;
  v_currency text;
  v_brand_currency text;
  v_cutover timestamptz;
BEGIN
  IF p_brand_id IS NULL THEN
    RETURN false;
  END IF;
  SELECT upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')), b.payout_hold_cutover_at
    INTO v_brand_currency, v_cutover
  FROM public.brands b WHERE b.id = p_brand_id AND b.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  SELECT
    CASE WHEN pricing.payment_provider = 'paystack' THEN 'paystack' ELSE 'stripe' END,
    CASE WHEN pricing.payment_provider = 'paystack' THEN pricing.paystack_subaccount_code ELSE pricing.stripe_account_id END,
    upper(pricing.pricing_currency)
  INTO v_provider, v_account, v_currency
  FROM public.resolve_brand_pricing_inputs(p_brand_id, p_venue_id) pricing
  LIMIT 1;
  RETURN COALESCE(
    v_provider IS NOT NULL
    AND v_currency IS NOT DISTINCT FROM v_brand_currency
    AND public.pg_brand_can_collect(p_brand_id)
    AND v_cutover IS NOT NULL
    AND NOT (v_provider = 'stripe' AND v_account IS NULL)
    AND NOT (v_provider = 'paystack' AND v_currency <> 'NGN'),
    false);
END;
$function$;

-- Host: every offer says whether guests can pay online for it today.
CREATE OR REPLACE FUNCTION public.issue_4490_offer_projection(p_offering_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', o.id,
    'venueId', o.venue_id,
    'kind', o.kind,
    'entryStyle', o.entry_style,
    'name', o.name,
    'summary', NULLIF(o.summary, ''),
    'description', NULLIF(o.description, ''),
    'status', o.status,
    'version', o.version,
    'confirmationMode', COALESCE(o.confirmation_mode, 'instant'),
    'sessionCapacity', CASE WHEN o.entry_style = 'timed_session' THEN o.capacity ELSE NULL END,
    'minNoticeMinutes', o.min_notice_minutes,
    'maxAdvanceDays', o.max_advance_days,
    'sortOrder', o.sort_order,
    'pool', public.issue_4490_pool_projection(o.capacity_pool_id),
    'options', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', opt.id,
        'name', opt.name,
        'unit', opt.unit,
        'guestMin', opt.guest_min,
        'guestMax', opt.guest_max,
        'weekdays', to_jsonb(opt.weekdays),
        'startTime', to_char(opt.local_start_time, 'HH24:MI'),
        'endTime', to_char(opt.local_end_time, 'HH24:MI'),
        'eligibility', CASE WHEN opt.eligibility IS NULL THEN NULL ELSE jsonb_build_object(
          'label', opt.eligibility->>'label',
          'checkAtGate', (opt.eligibility->>'check_at_gate')::boolean) END,
        'busyRules', opt.busy_rules,
        'sortOrder', opt.sort_order,
        'status', opt.status,
        'version', opt.version,
        'priceMinor', price.amount_minor,
        'priceVersionId', price.id
      ) ORDER BY opt.sort_order, opt.created_at)
      FROM public.venue_offer_price_options opt
      LEFT JOIN public.stay_price_versions price
        ON price.price_option_id = opt.id AND price.offering_id = opt.offering_id AND price.effective_to IS NULL
      WHERE opt.offering_id = o.id AND opt.status = 'active'
    ), '[]'::jsonb),
    'policy', (
      SELECT jsonb_build_object(
        'versionId', p.id,
        'cancellationPolicy', p.cancellation_policy,
        'refundLadder', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'minMinutesBefore', (r->>'min_minutes_before')::integer,
            'refundBps', (r->>'refund_bps')::integer) ORDER BY ord)
          FROM jsonb_array_elements(p.refund_ladder) WITH ORDINALITY AS l(r, ord)
        ), '[]'::jsonb),
        'dateChangeRule', jsonb_strip_nulls(jsonb_build_object(
          'allowedUntilMinutesBefore', (p.date_change_rule->>'allowed_until_minutes_before')::integer,
          'feeBps', (p.date_change_rule->>'fee_bps')::integer,
          'maxChanges', (p.date_change_rule->>'max_changes')::integer)),
        'operatorCancelRefundBps', p.operator_cancel_refund_basis_points)
      FROM public.stay_policy_versions p
      WHERE p.offering_id = o.id AND p.effective_to IS NULL
    ),
    'schedule', (
      SELECT jsonb_build_object(
        'ruleId', r.id,
        'mode', CASE r.mode WHEN 'full_day' THEN 'full_day' ELSE 'sessions' END,
        'weekdays', to_jsonb(r.weekdays),
        'startTime', to_char(COALESCE(r.full_day_start_time, r.local_start_time), 'HH24:MI'),
        'endTime', to_char(COALESCE(r.full_day_end_time, r.local_end_time), 'HH24:MI'),
        'sessionMinutes', r.slot_duration_minutes,
        'sessionEveryMinutes', r.slot_interval_minutes,
        'startDate', r.local_start_date,
        'endDate', r.local_end_date,
        'timezone', r.timezone)
      FROM public.stay_place_schedule_rules r
      WHERE r.offering_id = o.id AND r.active
      ORDER BY r.created_at DESC
      LIMIT 1
    ),
    'readiness', to_jsonb(public.issue_4490_offer_readiness(o.id)),
    -- Warnings never block publish (the gate can still sell).
    'canCollectOnline', public.issue_4490_can_collect_online(o.brand_id, o.venue_id),
    'warnings', to_jsonb(CASE WHEN public.issue_4490_can_collect_online(o.brand_id, o.venue_id)
                              THEN '{}'::text[] ELSE ARRAY['online_payments_off']::text[] END),
    'createdAt', o.created_at,
    'updatedAt', o.updated_at
  )
  FROM public.stay_offerings o
  WHERE o.id = p_offering_id;
$function$;


-- Host: the venue's offers list carries the same answer once.
CREATE OR REPLACE FUNCTION public.issue_4490_list_offers(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.issue_4490_can_view_venue(p_venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'venueId', p_venue_id,
    'canCollectOnline', (SELECT public.issue_4490_can_collect_online(v.brand_id, v.id)
                         FROM public.venue_listings v WHERE v.id = p_venue_id),
    'flags', jsonb_build_object(
      'reads', public.issue_4490_flag_on('VENUE_OFFERS_READS'),
      'writes', public.issue_4490_flag_on('VENUE_OFFERS_WRITES')),
    'settings', (
      SELECT jsonb_build_object(
        'timezone', s.timezone, 'vatMode', s.vat_mode,
        'vatRateBps', (SELECT c.vat_rate_bps FROM public.venue_listings v
                       JOIN public.country_vat_config c ON c.country = upper(v.country_code)
                       WHERE v.id = p_venue_id),
        'instantPaymentHoldMinutes', s.instant_payment_hold_minutes,
        'bookingHorizonDays', s.booking_horizon_days,
        'bookingState', s.booking_state, 'version', s.version)
      FROM public.venue_booking_settings s WHERE s.venue_id = p_venue_id),
    'pools', COALESCE((
      SELECT jsonb_agg(public.issue_4490_pool_projection(p.id) ORDER BY p.created_at)
      FROM public.venue_capacity_pools p
      WHERE p.venue_id = p_venue_id AND p.archived_at IS NULL), '[]'::jsonb),
    'offers', COALESCE((
      SELECT jsonb_agg(public.issue_4490_offer_projection(o.id) ORDER BY o.sort_order, o.created_at)
      FROM public.stay_offerings o
      WHERE o.venue_id = p_venue_id AND o.kind NOT IN ('room', 'place') AND o.status <> 'archived'), '[]'::jsonb)
  );
END;
$function$;


-- Guest: each public offer says whether it can be paid online.
CREATE OR REPLACE FUNCTION public.issue_4490_public_offers(p_venue_id uuid, p_features text[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN NOT public.issue_4490_flag_on('VENUE_OFFERS_READS') THEN '[]'::jsonb ELSE COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', o.id,
      'kind', o.kind,
      'entryStyle', o.entry_style,
      'name', o.name,
      'summary', NULLIF(o.summary, ''),
      'fromMinor', (SELECT min(p.amount_minor) FROM public.venue_offer_price_options opt
                    JOIN public.stay_price_versions p ON p.price_option_id = opt.id AND p.effective_to IS NULL
                    WHERE opt.offering_id = o.id AND opt.status = 'active'),
      'unit', COALESCE((SELECT opt.unit FROM public.venue_offer_price_options opt
                        WHERE opt.offering_id = o.id AND opt.status = 'active'
                        ORDER BY opt.sort_order LIMIT 1), 'guest'),
      'guestMin', (SELECT min(opt.guest_min) FROM public.venue_offer_price_options opt
                   WHERE opt.offering_id = o.id AND opt.status = 'active'),
      'guestMax', (SELECT max(opt.guest_max) FROM public.venue_offer_price_options opt
                   WHERE opt.offering_id = o.id AND opt.status = 'active'),
      'confirmationMode', COALESCE(o.confirmation_mode, 'instant'),
      'spaceIds', (SELECT jsonb_agg(s.space_id ORDER BY s.space_id) FROM public.venue_offer_spaces s
                   WHERE s.offering_id = o.id),
      'sortOrder', o.sort_order,
      'canCollectOnline', public.issue_4490_can_collect_online(o.brand_id, o.venue_id)
    ) ORDER BY o.sort_order, o.created_at)
    FROM public.stay_offerings o
    WHERE o.venue_id = p_venue_id AND o.status = 'live'
      AND o.kind = ANY(public.issue_4490_built_offer_kinds())
      AND public.issue_4490_offer_kind_feature(o.kind) = ANY(p_features)
  ), '[]'::jsonb) END;
$function$;


REVOKE ALL ON FUNCTION public.issue_4490_can_collect_online(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_can_collect_online(uuid, uuid) TO service_role;

COMMIT;
