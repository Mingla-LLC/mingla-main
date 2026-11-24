-- Issue #4490, spec 07 G: by-request memberships and desks held for a member.
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.venue_membership_plans
  ADD COLUMN join_mode text NOT NULL DEFAULT 'instant'
    CHECK (join_mode IN ('instant', 'request')),
  ADD COLUMN desk_space_ids uuid[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(desk_space_ids) <= 500);

CREATE OR REPLACE FUNCTION public.issue_4490_validate_plan_desks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue uuid;
BEGIN
  SELECT o.venue_id INTO v_venue
  FROM public.stay_offerings o
  WHERE o.id = NEW.offering_id;
  IF cardinality(NEW.desk_space_ids) <> (
       SELECT count(DISTINCT space_id) FROM unnest(NEW.desk_space_ids) space_id)
     OR EXISTS (
       SELECT 1 FROM unnest(NEW.desk_space_ids) chosen(space_id)
       LEFT JOIN public.venue_spaces s ON s.id = chosen.space_id
       WHERE s.id IS NULL OR s.venue_id IS DISTINCT FROM v_venue OR NOT s.is_active
     ) THEN
    RAISE EXCEPTION 'plan_desks_invalid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.venue_membership_subscriptions sub
    WHERE sub.plan_id = NEW.id AND sub.assigned_space_id IS NOT NULL
      AND sub.status IN ('active', 'payment_due', 'grace')
      AND NOT (sub.assigned_space_id = ANY(NEW.desk_space_ids))
  ) THEN
    RAISE EXCEPTION 'plan_desks_in_use' USING ERRCODE = 'PT409';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER issue_4490_validate_plan_desks
  BEFORE INSERT OR UPDATE OF offering_id, desk_space_ids
  ON public.venue_membership_plans
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_validate_plan_desks();

ALTER TABLE public.venue_membership_subscriptions
  ADD COLUMN assigned_space_id uuid NULL REFERENCES public.venue_spaces(id) ON DELETE RESTRICT,
  ADD COLUMN decided_at timestamptz NULL,
  ADD COLUMN decline_reason text NULL CHECK (decline_reason IS NULL OR char_length(decline_reason) <= 300),
  DROP CONSTRAINT venue_membership_subscriptions_status_check,
  ADD CONSTRAINT venue_membership_subscriptions_status_check CHECK (
    status IN ('pending', 'active', 'payment_due', 'grace', 'lapsed', 'paused', 'requested', 'declined', 'cancelled')
  ),
  DROP CONSTRAINT venue_membership_subscriptions_paid_shape,
  ADD CONSTRAINT venue_membership_subscriptions_paid_shape CHECK (
    status IN ('pending', 'cancelled', 'requested', 'declined') OR current_period_end IS NOT NULL
  );

ALTER TABLE public.venue_space_claims
  ADD COLUMN subscription_id uuid NULL REFERENCES public.venue_membership_subscriptions(id) ON DELETE RESTRICT,
  DROP CONSTRAINT venue_space_claims_source_check,
  ADD CONSTRAINT venue_space_claims_source_check CHECK (source IN ('booking', 'event', 'block', 'member')),
  ADD CONSTRAINT venue_space_claims_member_shape CHECK ((source = 'member') = (subscription_id IS NOT NULL));

CREATE UNIQUE INDEX venue_space_claims_member_active_uniq
  ON public.venue_space_claims (subscription_id)
  WHERE source = 'member' AND state IN ('held', 'committed');
CREATE INDEX venue_space_claims_subscription_idx
  ON public.venue_space_claims (subscription_id) WHERE subscription_id IS NOT NULL;

COMMENT ON COLUMN public.venue_membership_plans.desk_space_ids IS
  '#4490 G: venue spaces a host may assign as a dedicated member desk.';
COMMENT ON COLUMN public.venue_membership_plans.join_mode IS
  '#4490 G: instant takes the first payment; request waits for host approval.';

-- The subscription row owns desk lifetime. Any function that pays, pauses,
-- lapses, resumes, schedules leave or ends a member automatically reaches the
-- same exclusion-constraint path through this trigger.
CREATE OR REPLACE FUNCTION public.issue_4490_sync_member_desk()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_plan public.venue_membership_plans%ROWTYPE;
  v_name text;
  v_start timestamptz;
  v_wanted_end timestamptz;
  v_end timestamptz;
  v_conflict timestamptz;
  v_claim public.venue_space_claims%ROWTYPE;
BEGIN
  -- A changed desk releases the old row first. The transaction rolls it back
  -- if the replacement is refused.
  IF TG_OP = 'UPDATE' AND OLD.assigned_space_id IS DISTINCT FROM NEW.assigned_space_id THEN
    UPDATE public.venue_space_claims
    SET state = 'released', released_at = now(), release_reason = 'member_desk_changed', updated_at = now()
    WHERE subscription_id = NEW.id AND source = 'member' AND state IN ('held', 'committed');
  END IF;

  IF NEW.assigned_space_id IS NULL
     OR NEW.status NOT IN ('active', 'payment_due', 'grace')
     OR NEW.current_period_end IS NULL THEN
    UPDATE public.venue_space_claims
    SET state = 'released', released_at = now(),
        release_reason = CASE WHEN NEW.assigned_space_id IS NULL THEN 'member_desk_unassigned'
                              ELSE 'member_not_active' END,
        updated_at = now()
    WHERE subscription_id = NEW.id AND source = 'member' AND state IN ('held', 'committed');
    IF NEW.assigned_space_id IS NOT NULL AND NEW.status NOT IN ('active', 'payment_due', 'grace') THEN
      UPDATE public.venue_membership_subscriptions
      SET assigned_space_id = NULL, updated_at = now()
      WHERE id = NEW.id AND assigned_space_id IS NOT NULL;
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v_plan FROM public.venue_membership_plans WHERE id = NEW.plan_id;
  IF NOT (NEW.assigned_space_id = ANY(v_plan.desk_space_ids)) THEN
    RAISE EXCEPTION 'member_desk_not_allowed' USING ERRCODE = '22023';
  END IF;
  SELECT s.name INTO v_name FROM public.venue_spaces s
  WHERE s.id = NEW.assigned_space_id AND s.is_active
    AND s.venue_id = public.issue_4490_plan_venue(NEW.plan_id);
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'member_desk_not_allowed' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_claim
  FROM public.venue_space_claims c
  WHERE c.subscription_id = NEW.id AND c.source = 'member' AND c.state IN ('held', 'committed')
  FOR UPDATE;
  v_start := COALESCE(lower(v_claim.claim_range), date_trunc('minute', now()));
  v_wanted_end := COALESCE(NEW.cancel_at, NEW.current_period_end + interval '731 days');
  IF v_wanted_end <= v_start THEN
    v_wanted_end := v_start + interval '1 minute';
  END IF;

  SELECT min(lower(c.claim_range)) INTO v_conflict
  FROM public.venue_space_claims c
  WHERE c.space_id = NEW.assigned_space_id
    AND c.state IN ('held', 'committed')
    AND c.subscription_id IS DISTINCT FROM NEW.id
    AND c.claim_range && tstzrange(v_start, v_wanted_end, '[)');
  IF v_conflict IS NOT NULL AND v_conflict <= now() THEN
    RAISE EXCEPTION 'desk_taken' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('spaceId', NEW.assigned_space_id, 'spaceName', v_name,
        'bookedFrom', v_conflict)::text;
  END IF;
  v_end := LEAST(v_wanted_end, COALESCE(v_conflict, v_wanted_end));

  IF v_claim.id IS NULL THEN
    INSERT INTO public.venue_space_claims (
      space_id, source, subscription_id, booked_range, claim_range, state, created_by
    ) VALUES (
      NEW.assigned_space_id, 'member', NEW.id,
      tstzrange(v_start, v_end, '[)'), tstzrange(v_start, v_end, '[)'), 'committed', auth.uid()
    );
  ELSE
    UPDATE public.venue_space_claims
    SET space_id = NEW.assigned_space_id,
        booked_range = tstzrange(v_start, v_end, '[)'),
        claim_range = tstzrange(v_start, v_end, '[)'),
        updated_at = now()
    WHERE id = v_claim.id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER issue_4490_sync_member_desk
  AFTER INSERT OR UPDATE OF assigned_space_id, status, current_period_end, cancel_at
  ON public.venue_membership_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_sync_member_desk();

-- Checked patches preserve all cumulative membership fixes and accept the
-- already-patched form on an idempotence check.
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
    RAISE EXCEPTION 'issue_4490 coworking patch precondition failed for %: old %, new %',
      p_sig, v_old_count, v_new_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- Host plan projection and editor choices.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_membership_plan_projection(uuid)'::regprocedure,
  $old$    'renewalNoticeDays', p.renewal_notice_days,
    'status', p.status,$old$,
  $new$    'renewalNoticeDays', p.renewal_notice_days,
    'joinMode', p.join_mode,
    'deskSpaceIds', to_jsonb(p.desk_space_ids),
    'deskSpaces', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
                            FROM public.venue_spaces s WHERE s.id = ANY(p.desk_space_ids)), '[]'::jsonb),
    'status', p.status,$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_membership_plans(uuid)'::regprocedure,
  $old$    'hourOffers', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) ORDER BY o.sort_order, o.created_at)
                            FROM public.stay_offerings o WHERE o.venue_id = p_venue_id AND o.kind = 'by_the_hour'
                              AND o.status <> 'archived'), '[]'::jsonb),
    'plans',$old$,
  $new$    'hourOffers', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) ORDER BY o.sort_order, o.created_at)
                            FROM public.stay_offerings o WHERE o.venue_id = p_venue_id AND o.kind = 'by_the_hour'
                              AND o.status <> 'archived'), '[]'::jsonb),
    'spaces', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.sort_order, s.name)
                        FROM public.venue_spaces s WHERE s.venue_id = p_venue_id AND s.is_active), '[]'::jsonb),
    'plans',$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_assert_plan_payload(uuid,jsonb,boolean)'::regprocedure,
  $old$  IF p_payload ? 'maxMembers' AND p_payload->'maxMembers' <> 'null'::jsonb AND ($old$,
  $new$  IF p_payload ? 'joinMode' AND COALESCE(p_payload->>'joinMode', '') NOT IN ('instant', 'request') THEN
    RAISE EXCEPTION 'plan_join_mode_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'deskSpaceIds' AND (
       jsonb_typeof(p_payload->'deskSpaceIds') <> 'array'
       OR jsonb_array_length(p_payload->'deskSpaceIds') > 500
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_payload->'deskSpaceIds') x
                  WHERE x !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR NOT EXISTS (
                    SELECT 1 FROM public.venue_spaces s
                    WHERE s.id::text = x AND s.venue_id = p_venue_id AND s.is_active))) THEN
    RAISE EXCEPTION 'plan_desks_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_payload ? 'maxMembers' AND p_payload->'maxMembers' <> 'null'::jsonb AND ($new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_membership_plan(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$      discount_bps, discount_kinds, max_members, min_months, notice_days, grace_days, renewal_notice_days,
      sort_order, created_by, updated_by$old$,
  $new$      discount_bps, discount_kinds, max_members, min_months, notice_days, grace_days, renewal_notice_days,
      join_mode, desk_space_ids, sort_order, created_by, updated_by$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_membership_plan(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$      COALESCE((p_payload->>'renewalNoticeDays')::smallint, 7),
      COALESCE((p_payload->>'sortOrder')::integer, 0), v_uid, v_uid$old$,
  $new$      COALESCE((p_payload->>'renewalNoticeDays')::smallint, 7),
      COALESCE(NULLIF(p_payload->>'joinMode', ''), 'instant'),
      COALESCE((SELECT array_agg(DISTINCT x::uuid) FROM jsonb_array_elements_text(COALESCE(p_payload->'deskSpaceIds', '[]'::jsonb)) x), '{}'),
      COALESCE((p_payload->>'sortOrder')::integer, 0), v_uid, v_uid$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_membership_plan(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$        renewal_notice_days = COALESCE((p_payload->>'renewalNoticeDays')::smallint, p.renewal_notice_days),
        sort_order = COALESCE((p_payload->>'sortOrder')::integer, p.sort_order),$old$,
  $new$        renewal_notice_days = COALESCE((p_payload->>'renewalNoticeDays')::smallint, p.renewal_notice_days),
        join_mode = COALESCE(NULLIF(p_payload->>'joinMode', ''), p.join_mode),
        desk_space_ids = CASE WHEN p_payload ? 'deskSpaceIds'
                              THEN COALESCE((SELECT array_agg(DISTINCT x::uuid) FROM jsonb_array_elements_text(p_payload->'deskSpaceIds') x), '{}')
                              ELSE p.desk_space_ids END,
        sort_order = COALESCE((p_payload->>'sortOrder')::integer, p.sort_order),$new$
);

-- Public plan facts are safe: only whether a desk may be assigned, never the
-- private list of desk ids.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_public_memberships(uuid,text[])'::regprocedure,
  $old$          'renewalNoticeDays', p.renewal_notice_days,
          'full',$old$,
  $new$          'renewalNoticeDays', p.renewal_notice_days,
          'joinMode', p.join_mode,
          'assignedDeskAvailable', cardinality(p.desk_space_ids) > 0,
          'full',$new$
);

-- A request holds no member slot and creates no payment period.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_membership_join(uuid,uuid,jsonb,date,text,uuid,bytea,text)'::regprocedure,
  $old$  IF v_plan.max_members IS NOT NULL THEN$old$,
  $new$  IF v_plan.max_members IS NOT NULL AND v_plan.join_mode = 'instant' THEN$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_membership_join(uuid,uuid,jsonb,date,text,uuid,bytea,text)'::regprocedure,
  $old$       WHERE s.plan_id = v_plan.id AND s.user_id = p_user_id AND s.status IN ('active', 'payment_due', 'grace', 'paused')) THEN$old$,
  $new$       WHERE s.plan_id = v_plan.id AND s.user_id = p_user_id AND s.status IN ('requested', 'pending', 'active', 'payment_due', 'grace', 'paused')) THEN$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_membership_join(uuid,uuid,jsonb,date,text,uuid,bytea,text)'::regprocedure,
  $old$  v_start_at := v_start::timestamp AT TIME ZONE v_tz;
  INSERT INTO public.venue_membership_subscriptions ($old$,
  $new$  v_start_at := v_start::timestamp AT TIME ZONE v_tz;
  IF v_plan.join_mode = 'request' THEN
    INSERT INTO public.venue_membership_subscriptions (
      id, plan_id, brand_id, user_id, member_name, member_email, member_phone, member_token_hash, qr_token_hash,
      status, start_on, terms, actor_key_hash, idempotency_key, request_hash
    ) VALUES (
      p_subscription_id, v_plan.id, v_plan.brand_id, p_user_id, btrim(p_member->>'name'), v_email, v_phone,
      p_member_token_hash, encode(pg_catalog.sha256(extensions.gen_random_bytes(32)), 'hex'),
      'requested', v_start,
      jsonb_build_object('priceMinor', v_plan.price_minor, 'currencyCode', v_plan.currency_code,
        'minMonths', v_plan.min_months, 'noticeDays', v_plan.notice_days, 'graceDays', v_plan.grace_days,
        'renewalNoticeDays', v_plan.renewal_notice_days, 'entryIncluded', v_plan.entry_included,
        'roomHours', v_plan.room_hours_per_period, 'guestPasses', v_plan.guest_passes_per_period,
        'discountBps', v_plan.discount_bps, 'period', v_plan.period),
      p_actor_key, btrim(p_idempotency_key), v_hash
    );
    PERFORM public.issue_4490_member_event(p_subscription_id, NULL, 'member_requested', 'member', p_user_id,
      jsonb_build_object('plan', v_plan.name, 'startOn', v_start), 'request:' || p_subscription_id);
    RETURN public.issue_4490_member_projection(p_subscription_id, 'guest', NULL)
      || jsonb_build_object('replayed', false);
  END IF;
  INSERT INTO public.venue_membership_subscriptions ($new$
);

-- Member projections: request state, assigned desk, and the plan's allowed
-- desk choices for the Host panel.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_member_projection(uuid,text,text)'::regprocedure,
  $old$      'hourOfferingIds', to_jsonb(v_plan.hour_offering_ids), 'entryOfferingId', v_plan.entry_offering_id),$old$,
  $new$      'hourOfferingIds', to_jsonb(v_plan.hour_offering_ids), 'entryOfferingId', v_plan.entry_offering_id,
      'interval', v_plan.period, 'joinMode', v_plan.join_mode,
      'deskSpaces', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
                              FROM public.venue_spaces s WHERE s.id = ANY(v_plan.desk_space_ids)
                                AND NOT EXISTS (SELECT 1 FROM public.venue_space_claims c
                                  WHERE c.space_id = s.id AND c.state IN ('held', 'committed')
                                    AND c.claim_range @> now() AND c.subscription_id IS DISTINCT FROM v_sub.id)), '[]'::jsonb)),$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_member_projection(uuid,text,text)'::regprocedure,
  $old$    'canCheckIn', v_can_enter,
    'paymentDue',$old$,
  $new$    'canCheckIn', v_can_enter,
    'assignedSpace', CASE WHEN v_sub.assigned_space_id IS NULL THEN NULL ELSE
      (SELECT jsonb_build_object('id', s.id, 'name', s.name) FROM public.venue_spaces s WHERE s.id = v_sub.assigned_space_id) END,
    'deskBookedFrom', (SELECT CASE
        WHEN c.id IS NULL OR upper(c.claim_range) >= COALESCE(v_sub.cancel_at, v_sub.current_period_end + interval '731 days') THEN NULL
        ELSE upper(c.claim_range) END
      FROM public.venue_space_claims c
      WHERE c.subscription_id = v_sub.id AND c.source = 'member' AND c.state IN ('held', 'committed') LIMIT 1),
    'requestReplyBy', CASE WHEN v_sub.status = 'requested' THEN v_sub.created_at + make_interval(hours =>
      COALESCE((SELECT bs.request_response_hours FROM public.venue_booking_settings bs WHERE bs.venue_id = v_venue.id), 48)) END,
    'paymentDue',$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_member_projection(uuid,text,text)'::regprocedure,
  $old$  IF p_view = 'guest' AND p_qr_pepper IS NOT NULL AND v_sub.status <> 'cancelled' THEN$old$,
  $new$  IF p_view = 'guest' AND p_qr_pepper IS NOT NULL
     AND v_sub.status NOT IN ('cancelled', 'requested', 'declined') THEN$new$
);

-- Host list: Requests is its own filter and assigned desks are visible.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_venue_members(uuid,text)'::regprocedure,
  $old$  IF COALESCE(p_filter, 'all') NOT IN ('all', 'active', 'payment_due', 'paused', 'ended', 'pending') THEN$old$,
  $new$  IF COALESCE(p_filter, 'all') NOT IN ('all', 'active', 'payment_due', 'paused', 'ended', 'pending', 'requests') THEN$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_venue_members(uuid,text)'::regprocedure,
  $old$          'amountDueMinor', (SELECT pe.amount_minor FROM public.venue_membership_periods pe
                             WHERE pe.id = public.issue_4490_member_open_period(m.id)),
          'version',$old$,
  $new$          'amountDueMinor', (SELECT pe.amount_minor FROM public.venue_membership_periods pe
                             WHERE pe.id = public.issue_4490_member_open_period(m.id)),
          'assignedSpaceName', (SELECT s.name FROM public.venue_spaces s WHERE s.id = m.assigned_space_id),
          'version',$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_venue_members(uuid,text)'::regprocedure,
  $old$          WHEN 'all' THEN m.status <> 'cancelled' AND NOT (m.status = 'pending' AND m.created_at < now() - interval '2 days')
          WHEN 'active'$old$,
  $new$          WHEN 'all' THEN m.status NOT IN ('cancelled', 'declined') AND NOT (m.status = 'pending' AND m.created_at < now() - interval '2 days')
          WHEN 'requests' THEN m.status = 'requested'
          WHEN 'active'$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_venue_members(uuid,text)'::regprocedure,
  $old$          ELSE m.status = 'cancelled' END), '[]'::jsonb)));$old$,
  $new$          ELSE m.status IN ('cancelled', 'declined') END), '[]'::jsonb)));$new$
);

-- Staff request decisions and desk assignment share the existing versioned,
-- idempotent member action rail.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_member(uuid,text,jsonb,bigint,text)'::regprocedure,
  $old$  IF p_action IS NULL OR p_action NOT IN ('pause', 'resume', 'cancel', 'undo_cancel', 'send_link', 'mark_paid') THEN$old$,
  $new$  IF p_action IS NULL OR p_action NOT IN ('pause', 'resume', 'cancel', 'undo_cancel', 'send_link', 'mark_paid',
      'approve_request', 'decline_request', 'assign_desk', 'unassign_desk') THEN$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_member(uuid,text,jsonb,bigint,text)'::regprocedure,
  $old$  IF p_action = 'cancel' THEN$old$,
  $new$  IF p_action = 'approve_request' THEN
    IF v_sub.status <> 'requested' THEN
      RAISE EXCEPTION 'member_request_not_open' USING ERRCODE = 'PT409';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.venue_membership_plans p
      WHERE p.id = v_sub.plan_id AND p.max_members IS NOT NULL
        AND (SELECT count(*) FROM public.venue_membership_subscriptions s
             WHERE s.plan_id = p.id AND s.status IN ('pending','active','payment_due','grace','lapsed','paused')) >= p.max_members
    ) THEN
      RAISE EXCEPTION 'member_request_plan_full' USING ERRCODE = 'PT409';
    END IF;
    INSERT INTO public.venue_membership_periods (
      subscription_id, sequence, period_start, period_end, amount_minor, currency_code, due_at, status
    )
    SELECT v_sub.id, 1,
      v_sub.start_on::timestamp AT TIME ZONE public.issue_4490_venue_timezone(v_venue),
      public.issue_4490_month_after(v_sub.start_on::timestamp AT TIME ZONE public.issue_4490_venue_timezone(v_venue),
        public.issue_4490_venue_timezone(v_venue)),
      p.price_minor, p.currency_code, now() + interval '3 days', 'link_sent'
    FROM public.venue_membership_plans p WHERE p.id = v_sub.plan_id
    RETURNING * INTO v_period;
    UPDATE public.venue_membership_subscriptions
    SET status = 'pending', decided_at = now(), decline_reason = NULL,
        version = version + 1, updated_at = now()
    WHERE id = v_sub.id;
    PERFORM public.issue_4490_member_event(v_sub.id, v_period.id, 'member_request_approved', 'staff', v_uid,
      jsonb_build_object('dueAt', v_period.due_at), 'request-approved:' || v_sub.id);
    PERFORM public.issue_4490_member_enqueue(v_sub.id, v_period.id, 'venue_membership_renewal', 'approval');
    v_result := public.issue_4490_member_projection(v_sub.id, 'host', NULL);
  ELSIF p_action = 'decline_request' THEN
    IF v_sub.status <> 'requested' THEN
      RAISE EXCEPTION 'member_request_not_open' USING ERRCODE = 'PT409';
    END IF;
    UPDATE public.venue_membership_subscriptions
    SET status = 'declined', decided_at = now(),
        decline_reason = NULLIF(btrim(COALESCE(v_payload->>'reason', '')), ''),
        version = version + 1, updated_at = now()
    WHERE id = v_sub.id;
    PERFORM public.issue_4490_member_event(v_sub.id, NULL, 'member_request_declined', 'staff', v_uid,
      jsonb_build_object('reason', NULLIF(btrim(COALESCE(v_payload->>'reason', '')), '')),
      'request-declined:' || v_sub.id);
    PERFORM public.issue_4490_member_enqueue(v_sub.id, NULL, 'venue_membership_ended', 'declined');
    v_result := public.issue_4490_member_projection(v_sub.id, 'host', NULL);
  ELSIF p_action = 'assign_desk' THEN
    IF v_sub.status NOT IN ('active', 'payment_due', 'grace') THEN
      RAISE EXCEPTION 'member_desk_not_assignable' USING ERRCODE = 'PT409';
    END IF;
    IF COALESCE(v_payload->>'spaceId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR NOT EXISTS (SELECT 1 FROM public.venue_membership_plans p
                      WHERE p.id = v_sub.plan_id AND (v_payload->>'spaceId')::uuid = ANY(p.desk_space_ids)) THEN
      RAISE EXCEPTION 'member_desk_not_allowed' USING ERRCODE = '22023';
    END IF;
    UPDATE public.venue_membership_subscriptions
    SET assigned_space_id = (v_payload->>'spaceId')::uuid,
        version = version + 1, updated_at = now()
    WHERE id = v_sub.id;
    PERFORM public.issue_4490_member_event(v_sub.id, NULL, 'member_desk_assigned', 'staff', v_uid,
      jsonb_build_object('spaceId', v_payload->>'spaceId'), 'desk-assigned:' || p_idempotency_key);
    v_result := public.issue_4490_member_projection(v_sub.id, 'host', NULL);
  ELSIF p_action = 'unassign_desk' THEN
    UPDATE public.venue_membership_subscriptions
    SET assigned_space_id = NULL, version = version + 1, updated_at = now()
    WHERE id = v_sub.id;
    PERFORM public.issue_4490_member_event(v_sub.id, NULL, 'member_desk_unassigned', 'staff', v_uid,
      '{}'::jsonb, 'desk-unassigned:' || p_idempotency_key);
    v_result := public.issue_4490_member_projection(v_sub.id, 'host', NULL);
  ELSIF p_action = 'cancel' THEN$new$
);

-- Requests expire on the venue's existing response clock.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_membership_billing_run(timestamptz,integer)'::regprocedure,
  $old$  v_unpaid_joins integer := 0;
  v_expired integer := 0;$old$,
  $new$  v_unpaid_joins integer := 0;
  v_requests_expired integer := 0;
  v_expired integer := 0;$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_membership_billing_run(timestamptz,integer)'::regprocedure,
  $old$  -- a. Members who left: ended at their end date.$old$,
  $new$  -- Requests that receive no answer close on the venue's reply clock.
  FOR v_row IN
    SELECT s.id
    FROM public.venue_membership_subscriptions s
    JOIN public.venue_membership_plans p ON p.id = s.plan_id
    JOIN public.stay_offerings o ON o.id = p.offering_id
    LEFT JOIN public.venue_booking_settings bs ON bs.venue_id = o.venue_id
    WHERE s.status = 'requested'
      AND s.created_at + make_interval(hours => COALESCE(bs.request_response_hours, 48)) <= v_now
    ORDER BY s.created_at LIMIT v_limit FOR UPDATE OF s SKIP LOCKED
  LOOP
    UPDATE public.venue_membership_subscriptions
    SET status = 'declined', decided_at = v_now, decline_reason = 'expired',
        version = version + 1, updated_at = now()
    WHERE id = v_row.id;
    PERFORM public.issue_4490_member_event(v_row.id, NULL, 'member_request_expired', 'system', NULL,
      '{}'::jsonb, 'request-expired:' || v_row.id);
    PERFORM public.issue_4490_member_enqueue(v_row.id, NULL, 'venue_membership_ended', 'declined');
    v_requests_expired := v_requests_expired + 1;
  END LOOP;

  -- a. Members who left: ended at their end date.$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_membership_billing_run(timestamptz,integer)'::regprocedure,
  $old$    'creditsExpired', v_expired);$old$,
  $new$    'requestsExpired', v_requests_expired, 'creditsExpired', v_expired);$new$
);

DROP FUNCTION pg_temp.issue_4490_patch(regprocedure, text, text);

COMMIT;
