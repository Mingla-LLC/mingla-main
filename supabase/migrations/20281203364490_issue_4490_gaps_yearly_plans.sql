-- Issue #4490, spec 07 K: monthly and yearly membership plans.
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.venue_membership_plans
  DROP CONSTRAINT IF EXISTS venue_membership_plans_period_check,
  DROP CONSTRAINT IF EXISTS venue_membership_plans_room_hours_per_period_check,
  DROP CONSTRAINT IF EXISTS venue_membership_plans_guest_passes_per_period_check,
  DROP CONSTRAINT IF EXISTS venue_membership_plans_min_months_check,
  DROP CONSTRAINT IF EXISTS venue_membership_plans_renewal_notice_days_check,
  ADD CONSTRAINT venue_membership_plans_period_check CHECK (period IN ('month', 'year')),
  ADD CONSTRAINT venue_membership_plans_room_hours_per_period_check CHECK (
    room_hours_per_period BETWEEN 0 AND CASE WHEN period = 'year' THEN 8784 ELSE 744 END
    AND room_hours_per_period * 4 = trunc(room_hours_per_period * 4)
  ),
  ADD CONSTRAINT venue_membership_plans_guest_passes_per_period_check CHECK (
    guest_passes_per_period BETWEEN 0 AND CASE WHEN period = 'year' THEN 1200 ELSE 100 END
  ),
  ADD CONSTRAINT venue_membership_plans_min_months_check CHECK (
    (period = 'year' AND min_months = 12) OR (period = 'month' AND min_months BETWEEN 1 AND 36)
  ),
  ADD CONSTRAINT venue_membership_plans_renewal_notice_days_check CHECK (
    (period = 'year' AND renewal_notice_days BETWEEN 7 AND 60)
    OR (period = 'month' AND renewal_notice_days BETWEEN 1 AND 14)
  );

UPDATE public.venue_membership_subscriptions
SET terms = jsonb_set(terms, '{period}', '"month"'::jsonb, true), updated_at = now()
WHERE NOT (terms ? 'period');

-- The same local clock time one calendar billing period later in the venue's
-- zone. This retains wall-clock time across daylight-saving transitions.
CREATE OR REPLACE FUNCTION public.issue_4490_period_after(
  p_at timestamptz,
  p_tz text,
  p_period text
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
BEGIN
  IF p_period NOT IN ('month', 'year') THEN
    RAISE EXCEPTION 'plan_period_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN ((p_at AT TIME ZONE p_tz) +
    CASE WHEN p_period = 'year' THEN interval '1 year' ELSE interval '1 month' END) AT TIME ZONE p_tz;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4490_period_after(timestamptz, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_4490_period_after(timestamptz, text, text) TO service_role;

-- A member or request has accepted the interval, so changing it would alter
-- a deal already made. Other plan fields remain editable for future periods.
CREATE OR REPLACE FUNCTION public.issue_4490_lock_plan_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.period IS DISTINCT FROM OLD.period AND EXISTS (
    SELECT 1 FROM public.venue_membership_subscriptions s WHERE s.plan_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'plan_period_locked' USING ERRCODE = 'PT409';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS issue_4490_lock_plan_period ON public.venue_membership_plans;
CREATE TRIGGER issue_4490_lock_plan_period
  BEFORE UPDATE OF period ON public.venue_membership_plans
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_lock_plan_period();

-- Checked patches preserve all cumulative membership fixes and refuse a
-- changed predecessor instead of silently producing a partial migration.
CREATE FUNCTION pg_temp.issue_4490_patch(
  p_sig regprocedure,
  p_old text,
  p_new text
)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
  v_new_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  v_new_count := (length(v_def) - length(replace(v_def, p_new, ''))) / length(p_new);
  IF v_new_count = 1 AND v_old_count = 0 THEN RETURN; END IF;
  IF v_old_count <> 1 OR v_new_count <> 0 THEN
    RAISE EXCEPTION 'issue_4490 yearly patch precondition failed for %: old %, new %',
      p_sig, v_old_count, v_new_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- Host projection: the editor disables its interval once anyone has joined
-- or requested the plan.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_membership_plan_projection(uuid)'::regprocedure,
  $old$    'status', p.status,$old$,
  $new$    'periodLocked', EXISTS (SELECT 1 FROM public.venue_membership_subscriptions locked WHERE locked.plan_id = p.id),
    'status', p.status,$new$
);

-- Validate the effective interval for both complete creates and partial
-- updates. Yearly allowances are per year, not divided into months.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_assert_plan_payload(uuid,jsonb,boolean)'::regprocedure,
  $old$  v_int text := '^[0-9]{1,9}$';
BEGIN$old$,
  $new$  v_int text := '^[0-9]{1,9}$';
  v_period text;
BEGIN
  SELECT COALESCE(NULLIF(p_payload->>'period', ''), p.period, 'month') INTO v_period
  FROM (SELECT 1) seed
  LEFT JOIN public.venue_membership_plans p
    ON p.id = CASE WHEN COALESCE(p_payload->>'planId', '') ~ '^[0-9a-f-]{36}$'
                   THEN (p_payload->>'planId')::uuid END;
  v_period := COALESCE(v_period, NULLIF(p_payload->>'period', ''), 'month');
  IF v_period NOT IN ('month', 'year') THEN
    RAISE EXCEPTION 'plan_period_invalid' USING ERRCODE = '22023';
  END IF;$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_assert_plan_payload(uuid,jsonb,boolean)'::regprocedure,
  $old$  IF p_payload ? 'roomHours' AND (
       jsonb_typeof(p_payload->'roomHours') <> 'number' OR (p_payload->>'roomHours')::numeric NOT BETWEEN 0 AND 744
       OR (p_payload->>'roomHours')::numeric * 4 <> trunc((p_payload->>'roomHours')::numeric * 4)) THEN$old$,
  $new$  IF p_payload ? 'roomHours' AND (
       jsonb_typeof(p_payload->'roomHours') <> 'number'
       OR (p_payload->>'roomHours')::numeric NOT BETWEEN 0 AND CASE WHEN v_period = 'year' THEN 8784 ELSE 744 END
       OR (p_payload->>'roomHours')::numeric * 4 <> trunc((p_payload->>'roomHours')::numeric * 4)) THEN$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_assert_plan_payload(uuid,jsonb,boolean)'::regprocedure,
  $old$  IF p_payload ? 'guestPasses' AND (COALESCE(p_payload->>'guestPasses', '') !~ '^[0-9]{1,3}$'
       OR (p_payload->>'guestPasses')::integer > 100) THEN$old$,
  $new$  IF p_payload ? 'guestPasses' AND (COALESCE(p_payload->>'guestPasses', '') !~ '^[0-9]{1,4}$'
       OR (p_payload->>'guestPasses')::integer > CASE WHEN v_period = 'year' THEN 1200 ELSE 100 END) THEN$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_assert_plan_payload(uuid,jsonb,boolean)'::regprocedure,
  $old$  IF (p_payload ? 'minMonths' AND (COALESCE(p_payload->>'minMonths', '') !~ v_int OR (p_payload->>'minMonths')::integer NOT BETWEEN 1 AND 36))
     OR (p_payload ? 'noticeDays' AND (COALESCE(p_payload->>'noticeDays', '') !~ v_int OR (p_payload->>'noticeDays')::integer > 90))
     OR (p_payload ? 'graceDays' AND (COALESCE(p_payload->>'graceDays', '') !~ v_int OR (p_payload->>'graceDays')::integer > 30))
     OR (p_payload ? 'renewalNoticeDays' AND (COALESCE(p_payload->>'renewalNoticeDays', '') !~ v_int
         OR (p_payload->>'renewalNoticeDays')::integer NOT BETWEEN 1 AND 14)) THEN$old$,
  $new$  IF (p_payload ? 'minMonths' AND (COALESCE(p_payload->>'minMonths', '') !~ v_int
         OR (v_period = 'year' AND (p_payload->>'minMonths')::integer <> 12)
         OR (v_period = 'month' AND (p_payload->>'minMonths')::integer NOT BETWEEN 1 AND 36)))
     OR (p_payload ? 'noticeDays' AND (COALESCE(p_payload->>'noticeDays', '') !~ v_int OR (p_payload->>'noticeDays')::integer > 90))
     OR (p_payload ? 'graceDays' AND (COALESCE(p_payload->>'graceDays', '') !~ v_int OR (p_payload->>'graceDays')::integer > 30))
     OR (p_payload ? 'renewalNoticeDays' AND (COALESCE(p_payload->>'renewalNoticeDays', '') !~ v_int
         OR (v_period = 'year' AND (p_payload->>'renewalNoticeDays')::integer NOT BETWEEN 7 AND 60)
         OR (v_period = 'month' AND (p_payload->>'renewalNoticeDays')::integer NOT BETWEEN 1 AND 14))) THEN$new$
);

-- Create and update the hidden offer and plan with the selected interval.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_membership_plan(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$      v_offer.id, p_venue_id, v_venue.brand_id, 'Monthly', 'booking',$old$,
  $new$      v_offer.id, p_venue_id, v_venue.brand_id,
      CASE WHEN COALESCE(p_payload->>'period', 'month') = 'year' THEN 'Yearly' ELSE 'Monthly' END, 'booking',$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_membership_plan(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$      'A paid month is not refunded. Leave any time; your membership ends at the end of the month you paid for.',$old$,
  $new$      CASE WHEN COALESCE(p_payload->>'period', 'month') = 'year'
        THEN 'A paid year is not refunded. Your membership ends at the end of the year you paid for.'
        ELSE 'A paid month is not refunded. Leave any time; your membership ends at the end of the month you paid for.' END,$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_membership_plan(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$      offering_id, price_option_id, brand_id, name, summary, inclusions, price_minor, currency_code,
      entry_included,$old$,
  $new$      offering_id, price_option_id, brand_id, name, summary, inclusions, price_minor, currency_code, period,
      entry_included,$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_membership_plan(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$      (p_payload->>'priceMinor')::bigint, v_currency,
      COALESCE((p_payload->>'entryIncluded')::boolean, false),$old$,
  $new$      (p_payload->>'priceMinor')::bigint, v_currency, COALESCE(NULLIF(p_payload->>'period', ''), 'month'),
      COALESCE((p_payload->>'entryIncluded')::boolean, false),$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_membership_plan(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$      COALESCE((p_payload->>'minMonths')::smallint, 1),
      COALESCE((p_payload->>'noticeDays')::smallint, 0),
      COALESCE((p_payload->>'graceDays')::smallint, 7),
      COALESCE((p_payload->>'renewalNoticeDays')::smallint, 7),$old$,
  $new$      CASE WHEN COALESCE(p_payload->>'period', 'month') = 'year' THEN 12
           ELSE COALESCE((p_payload->>'minMonths')::smallint, 1) END,
      COALESCE((p_payload->>'noticeDays')::smallint, 0),
      COALESCE((p_payload->>'graceDays')::smallint, 7),
      COALESCE((p_payload->>'renewalNoticeDays')::smallint,
        CASE WHEN COALESCE(p_payload->>'period', 'month') = 'year' THEN 30 ELSE 7 END),$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_membership_plan(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$        price_minor = COALESCE((p_payload->>'priceMinor')::bigint, p.price_minor),
        entry_included =$old$,
  $new$        price_minor = COALESCE((p_payload->>'priceMinor')::bigint, p.price_minor),
        period = COALESCE(NULLIF(p_payload->>'period', ''), p.period),
        entry_included =$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_membership_plan(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$        min_months = COALESCE((p_payload->>'minMonths')::smallint, p.min_months),
        notice_days = COALESCE((p_payload->>'noticeDays')::smallint, p.notice_days),
        grace_days = COALESCE((p_payload->>'graceDays')::smallint, p.grace_days),
        renewal_notice_days = COALESCE((p_payload->>'renewalNoticeDays')::smallint, p.renewal_notice_days),$old$,
  $new$        min_months = CASE WHEN COALESCE(NULLIF(p_payload->>'period', ''), p.period) = 'year' THEN 12
                          ELSE COALESCE((p_payload->>'minMonths')::smallint, p.min_months) END,
        notice_days = COALESCE((p_payload->>'noticeDays')::smallint, p.notice_days),
        grace_days = COALESCE((p_payload->>'graceDays')::smallint, p.grace_days),
        renewal_notice_days = CASE
          WHEN p_payload ? 'renewalNoticeDays' THEN (p_payload->>'renewalNoticeDays')::smallint
          WHEN p_payload ? 'period' AND NULLIF(p_payload->>'period', '') IS DISTINCT FROM p.period
            THEN CASE WHEN p_payload->>'period' = 'year' THEN 30 ELSE 7 END
          ELSE p.renewal_notice_days END,$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_membership_plan(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$    UPDATE public.stay_offerings SET name = v_plan.name, version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id;$old$,
  $new$    UPDATE public.stay_offerings SET name = v_plan.name, version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id;
    UPDATE public.venue_offer_price_options
    SET name = CASE WHEN v_plan.period = 'year' THEN 'Yearly' ELSE 'Monthly' END,
        version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_plan.price_option_id;$new$
);

-- The public summary interval follows the lowest-priced plan, matching its
-- fromMinor figure. Every plan also carries its own interval.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_public_memberships(uuid,text[])'::regprocedure,
  $old$        'interval', 'month',$old$,
  $new$        'interval', (array_agg(p.period ORDER BY p.price_minor, p.sort_order, p.created_at))[1],$new$
);

-- Snapshot the selected period into instant joins just as request joins do.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_membership_join(uuid,uuid,jsonb,date,text,uuid,bytea,text)'::regprocedure,
  $old$    'pending', v_start,
    jsonb_build_object('priceMinor', v_plan.price_minor, 'currencyCode', v_plan.currency_code,
      'minMonths', v_plan.min_months, 'noticeDays', v_plan.notice_days, 'graceDays', v_plan.grace_days,
      'renewalNoticeDays', v_plan.renewal_notice_days, 'entryIncluded', v_plan.entry_included,
      'roomHours', v_plan.room_hours_per_period, 'guestPasses', v_plan.guest_passes_per_period,
      'discountBps', v_plan.discount_bps),$old$,
  $new$    'pending', v_start,
    jsonb_build_object('priceMinor', v_plan.price_minor, 'currencyCode', v_plan.currency_code,
      'minMonths', v_plan.min_months, 'noticeDays', v_plan.notice_days, 'graceDays', v_plan.grace_days,
      'renewalNoticeDays', v_plan.renewal_notice_days, 'entryIncluded', v_plan.entry_included,
      'roomHours', v_plan.room_hours_per_period, 'guestPasses', v_plan.guest_passes_per_period,
      'discountBps', v_plan.discount_bps, 'period', v_plan.period),$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_membership_join(uuid,uuid,jsonb,date,text,uuid,bytea,text)'::regprocedure,
  $old$    p_subscription_id, 1, v_start_at, public.issue_4490_month_after(v_start_at, v_tz),$old$,
  $new$    p_subscription_id, 1, v_start_at, public.issue_4490_period_after(v_start_at, v_tz, v_plan.period),$new$
);

-- Every later period uses the member's immutable snapshot, not a mutable plan.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_member_leave_at(uuid,boolean)'::regprocedure,
  $old$    v_end := public.issue_4490_month_after(v_end, v_tz);$old$,
  $new$    v_end := public.issue_4490_period_after(v_end, v_tz, COALESCE(v_sub.terms->>'period', 'month'));$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_member_change(uuid,text,text,uuid,jsonb,text,text)'::regprocedure,
  $old$          v_sub.id, v_seq, v_start, public.issue_4490_month_after(v_start, v_tz), v_plan.price_minor,$old$,
  $new$          v_sub.id, v_seq, v_start, public.issue_4490_period_after(v_start, v_tz, COALESCE(v_sub.terms->>'period', v_plan.period)), v_plan.price_minor,$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_membership_period_paid(uuid,uuid,text,text,text,uuid)'::regprocedure,
  $old$    v_end := public.issue_4490_month_after(v_start, v_tz);$old$,
  $new$    v_end := public.issue_4490_period_after(v_start, v_tz, COALESCE(v_sub.terms->>'period', 'month'));$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_membership_billing_run(timestamptz,integer)'::regprocedure,
  $old$      v_row.id, v_seq, v_row.current_period_end, public.issue_4490_month_after(v_row.current_period_end, v_tz),$old$,
  $new$      v_row.id, v_seq, v_row.current_period_end,
      public.issue_4490_period_after(v_row.current_period_end, v_tz, COALESCE(v_row.terms->>'period', 'month')),$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_member(uuid,text,jsonb,bigint,text)'::regprocedure,
  $old$      public.issue_4490_month_after(v_sub.start_on::timestamp AT TIME ZONE public.issue_4490_venue_timezone(v_venue),
        public.issue_4490_venue_timezone(v_venue)),$old$,
  $new$      public.issue_4490_period_after(v_sub.start_on::timestamp AT TIME ZONE public.issue_4490_venue_timezone(v_venue),
        public.issue_4490_venue_timezone(v_venue), p.period),$new$
);

-- The renderer must know whether its plain-language noun is month or year.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_member_enqueue(uuid,uuid,text,text)'::regprocedure,
  $old$      'plan_name', v_plan.name,
      'step', p_step,$old$,
  $new$      'plan_name', v_plan.name,
      'period', COALESCE(v_sub.terms->>'period', v_plan.period),
      'step', p_step,$new$
);

-- Member-priced quotes keep the allowance period in both the durable line
-- snapshot and the immediate response, so yearly hours are never called
-- "this month" at checkout.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_member_quote(uuid,uuid,bytea,uuid,text,boolean)'::regprocedure,
  $old$    v_snap := jsonb_build_object('subscriptionId', v_sub.id, 'planName', v_plan.name,
      'listBaseMinor',$old$,
  $new$    v_snap := jsonb_build_object('subscriptionId', v_sub.id, 'planName', v_plan.name,
      'period', COALESCE(v_sub.terms->>'period', v_plan.period),
      'listBaseMinor',$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_member_quote(uuid,uuid,bytea,uuid,text,boolean)'::regprocedure,
  $old$    'applied', true, 'subscriptionId', v_sub.id, 'planName', v_plan.name,
    'includedMinor',$old$,
  $new$    'applied', true, 'subscriptionId', v_sub.id, 'planName', v_plan.name,
    'period', COALESCE(v_sub.terms->>'period', v_plan.period),
    'includedMinor',$new$
);

-- Admin receives display labels as well as stable machine values.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_admin_memberships(uuid)'::regprocedure,
  $old$'plans', COALESCE((SELECT jsonb_agg(public.issue_4490_membership_plan_projection(p.id) ORDER BY p.sort_order, p.created_at)$old$,
  $new$'plans', COALESCE((SELECT jsonb_agg(
                         public.issue_4490_membership_plan_projection(p.id)
                         || jsonb_build_object('periodLabel', CASE WHEN p.period = 'year' THEN 'Yearly' ELSE 'Monthly' END)
                         ORDER BY p.sort_order, p.created_at)$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_admin_memberships(uuid)'::regprocedure,
  $old$        'subscriptionId', s.id, 'name', s.member_name, 'planName', p.name, 'status', s.status,
        'activeUntil',$old$,
  $new$        'subscriptionId', s.id, 'name', s.member_name, 'planName', p.name, 'status', s.status,
        'statusLabel', CASE s.status
          WHEN 'requested' THEN 'Requested' WHEN 'declined' THEN 'Declined' WHEN 'pending' THEN 'Joining'
          WHEN 'active' THEN 'Active' WHEN 'payment_due' THEN 'Payment due' WHEN 'grace' THEN 'In grace'
          WHEN 'lapsed' THEN 'Lapsed' WHEN 'paused' THEN 'Paused' ELSE 'Ended' END,
        'activeUntil',$new$
);

-- Host member and door projections carry the snapshotted billing noun so a
-- yearly member is never described as owing or using allowances "this month".
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_venue_members(uuid,text)'::regprocedure,
  $old$      SELECT s.*, p.name AS plan_name, p.max_members$old$,
  $new$      SELECT s.*, p.name AS plan_name, p.period AS plan_period, p.max_members$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_venue_members(uuid,text)'::regprocedure,
  $old$          'planId', m.plan_id, 'planName', m.plan_name, 'status', m.status,$old$,
  $new$          'planId', m.plan_id, 'planName', m.plan_name, 'planPeriod', m.plan_period, 'status', m.status,$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_check_in_list(uuid,date,uuid)'::regprocedure,
  $old$          'planName', p.name,
          'status', s.status,$old$,
  $new$          'planName', p.name,
          'planPeriod', COALESCE(s.terms->>'period', p.period),
          'status', s.status,$new$
);

-- Yearly memberships get the initial configurable renewal email (30 days by
-- default) and one additional reminder seven days before the paid year ends.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_membership_billing_run(timestamptz,integer)'::regprocedure,
  $old$  v_created integer := 0;
  v_due integer := 0;$old$,
  $new$  v_created integer := 0;
  v_year_reminders integer := 0;
  v_due integer := 0;$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_membership_billing_run(timestamptz,integer)'::regprocedure,
  $old$  -- e. The clock on an unpaid month: due (renewal day), grace (3 days after,$old$,
  $new$  -- Yearly members receive one extra reminder seven days before renewal.
  FOR v_row IN
    SELECT s.id AS sub_id, x.id AS period_id
    FROM public.venue_membership_subscriptions s
    JOIN public.venue_membership_periods x ON x.subscription_id = s.id
      AND x.period_start = s.current_period_end AND x.status = 'link_sent'
    WHERE s.status IN ('active', 'payment_due', 'grace')
      AND COALESCE(s.terms->>'period', 'month') = 'year'
      AND s.current_period_end - interval '7 days' <= v_now
      AND NOT ('year_reminder' = ANY(x.reminder_steps))
    ORDER BY s.current_period_end LIMIT v_limit FOR UPDATE OF x SKIP LOCKED
  LOOP
    UPDATE public.venue_membership_periods
    SET reminder_steps = array_append(reminder_steps, 'year_reminder'), version = version + 1, updated_at = now()
    WHERE id = v_row.period_id AND NOT ('year_reminder' = ANY(reminder_steps));
    IF FOUND THEN
      PERFORM public.issue_4490_member_event(v_row.sub_id, v_row.period_id, 'member_reminder_sent', 'system', NULL,
        jsonb_build_object('at', v_now, 'kind', 'year'), 'year-reminder:' || v_row.period_id);
      PERFORM public.issue_4490_member_enqueue(v_row.sub_id, v_row.period_id, 'venue_membership_renewal', 'year_reminder');
      v_year_reminders := v_year_reminders + 1;
    END IF;
  END LOOP;

  -- e. The clock on an unpaid period: due (renewal day), grace (3 days after,$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_membership_billing_run(timestamptz,integer)'::regprocedure,
  $old$  RETURN jsonb_build_object('at', v_now, 'renewalsSent', v_created, 'paymentDue', v_due,$old$,
  $new$  RETURN jsonb_build_object('at', v_now, 'renewalsSent', v_created, 'yearReminders', v_year_reminders, 'paymentDue', v_due,$new$
);

DROP FUNCTION pg_temp.issue_4490_patch(regprocedure, text, text);

COMMIT;
