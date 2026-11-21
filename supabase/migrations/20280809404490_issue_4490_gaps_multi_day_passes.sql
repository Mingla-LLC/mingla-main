-- Issue #4490, spec 07 F: multi-day entry passes.
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.venue_offer_price_options
  ADD COLUMN pass_days smallint,
  ADD COLUMN pass_window_days smallint,
  ADD CONSTRAINT venue_offer_price_options_pass_days_check CHECK (
    (pass_days IS NULL AND pass_window_days IS NULL)
    OR (pass_days BETWEEN 2 AND 60 AND pass_window_days BETWEEN pass_days AND 365)
  );

ALTER TABLE public.venue_passes
  ADD COLUMN days_allowed smallint NOT NULL DEFAULT 1 CHECK (days_allowed BETWEEN 1 AND 60),
  ADD COLUMN valid_until_local_date date,
  ADD CONSTRAINT venue_passes_multi_day_shape CHECK (
    (days_allowed = 1 AND valid_until_local_date IS NULL)
    OR (days_allowed > 1 AND valid_until_local_date >= valid_local_date)
  );

CREATE TABLE public.venue_pass_days (
  pass_id uuid NOT NULL REFERENCES public.venue_passes(id) ON DELETE RESTRICT,
  local_date date NOT NULL,
  admitted_count integer NOT NULL DEFAULT 0 CHECK (admitted_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pass_id, local_date)
);
CREATE INDEX venue_pass_days_local_date_idx ON public.venue_pass_days (local_date, pass_id);
ALTER TABLE public.venue_pass_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_pass_days FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.venue_pass_days TO service_role;
-- Deliberately no authenticated policy: reads go through scoped projections.

-- The option row is the durable authority. Membership's hidden option and
-- timed sessions cannot accidentally become flex passes through a direct SQL
-- writer that bypasses the Host editor.
CREATE OR REPLACE FUNCTION public.issue_4490_assert_multi_day_option()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_kind text;
  v_style text;
BEGIN
  IF NEW.pass_days IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT o.kind, o.entry_style INTO v_kind, v_style
  FROM public.stay_offerings o WHERE o.id = NEW.offering_id;
  IF v_kind <> 'entry' OR v_style NOT IN ('walk_in', 'day_pass') OR NEW.unit <> 'guest' THEN
    RAISE EXCEPTION 'multi_day_pass_not_allowed' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER issue_4490_multi_day_option_scope
  BEFORE INSERT OR UPDATE OF offering_id, unit, pass_days, pass_window_days
  ON public.venue_offer_price_options
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_multi_day_option();

CREATE OR REPLACE FUNCTION public.issue_4490_assert_multi_day_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF (NEW.kind <> 'entry' OR NEW.entry_style NOT IN ('walk_in', 'day_pass'))
     AND EXISTS (
       SELECT 1 FROM public.venue_offer_price_options p
       WHERE p.offering_id = OLD.id AND p.pass_days IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'multi_day_pass_not_allowed' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER issue_4490_multi_day_offer_scope
  BEFORE UPDATE OF kind, entry_style ON public.stay_offerings
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_multi_day_offer();

-- A multi-day pass never uses venue_passes.admitted_count. The day row is the
-- single source of truth, including the venue's past-midnight service day.
CREATE OR REPLACE FUNCTION public.issue_4490_pass_admitted_on(p_pass_id uuid, p_local_date date)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN p.days_allowed = 1 THEN p.admitted_count
              ELSE COALESCE((SELECT d.admitted_count FROM public.venue_pass_days d
                             WHERE d.pass_id = p.id AND d.local_date = p_local_date), 0) END
  FROM public.venue_passes p WHERE p.id = p_pass_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_pass_days_used(p_pass_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN p.days_allowed = 1 THEN CASE WHEN p.admitted_count > 0 THEN 1 ELSE 0 END
              ELSE (SELECT count(*)::integer FROM public.venue_pass_days d
                    WHERE d.pass_id = p.id AND d.admitted_count > 0) END
  FROM public.venue_passes p WHERE p.id = p_pass_id;
$function$;

REVOKE ALL ON FUNCTION public.issue_4490_pass_admitted_on(uuid, date),
  public.issue_4490_pass_days_used(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_pass_admitted_on(uuid, date),
  public.issue_4490_pass_days_used(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.issue_4490_assert_multi_day_option(),
  public.issue_4490_assert_multi_day_offer() FROM PUBLIC, anon, authenticated;

-- A zero-value offer never visits a payment provider. Convert its inventory
-- hold and confirm it in the same transaction that creates the booking, so
-- the ordinary confirmed-state trigger issues the pass and the confirmation
-- event follows the same notification path as a paid booking.
CREATE OR REPLACE FUNCTION public.issue_4490_confirm_free_offer(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_hold public.stay_inventory_holds%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups
  WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND OR v_group.total_minor <> 0
     OR v_group.state <> 'instant_payment_pending'
     OR v_group.payment_collection <> 'mingla' THEN
    RETURN;
  END IF;
  SELECT * INTO v_hold FROM public.stay_inventory_holds
  WHERE group_id = p_group_id FOR UPDATE;
  IF NOT FOUND OR v_hold.state <> 'active' OR v_hold.expires_at <= now() THEN
    RAISE EXCEPTION 'offer_hold_expired' USING ERRCODE = 'PT409';
  END IF;

  UPDATE public.stay_reservation_groups
  SET state = 'finalizing', version = version + 1, updated_at = now()
  WHERE id = p_group_id;
  INSERT INTO public.stay_inventory_commitments (
    group_id, reservation_line_id, resource_type, offering_id,
    room_date, place_window_id, quantity, exclusive_unit_id
  )
  SELECT p_group_id, s.reservation_line_id, s.resource_type, s.offering_id,
         s.room_date, s.place_window_id, s.quantity, s.exclusive_unit_id
  FROM public.stay_inventory_hold_slices s
  WHERE s.hold_id = v_hold.id
  ORDER BY s.resource_type, s.offering_id, s.room_date,
           s.place_window_id, s.exclusive_unit_id
  ON CONFLICT DO NOTHING;
  IF (SELECT count(*) FROM public.stay_inventory_commitments c
      WHERE c.group_id = p_group_id)
     <> (SELECT count(*) FROM public.stay_inventory_hold_slices s
         WHERE s.hold_id = v_hold.id) THEN
    RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.stay_inventory_holds
  SET state = 'converted', reason = 'free_offer', version = version + 1,
      updated_at = now()
  WHERE id = v_hold.id;
  UPDATE public.stay_reservation_lines
  SET state = 'confirmed', version = version + 1, updated_at = now()
  WHERE group_id = p_group_id AND state = 'payment_pending';
  UPDATE public.stay_reservation_groups
  SET state = 'confirmed', version = version + 1, updated_at = now()
  WHERE id = p_group_id;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, 'stay_reservation_confirmed', 'guest',
    'free-offer:' || p_group_id,
    jsonb_build_object('amountMinor', '0', 'freeOffer', true)
  ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
END;
$function$;
REVOKE ALL ON FUNCTION public.issue_4490_confirm_free_offer(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_confirm_free_offer(uuid)
  TO service_role;

-- Checked patches refuse a changed predecessor instead of silently leaving a
-- partially wired contract.
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
    RAISE EXCEPTION 'issue_4490 multi-day patch precondition failed for %: old %, new %',
      p_sig, v_old_count, v_new_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- Host writes: validate the pair, persist it, and clear it before changing an
-- existing offer to a timed session so the parent trigger sees a valid state.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_offer(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$    IF v_offer.kind = 'entry' AND p_payload->>'unit' <> 'guest' THEN
      RAISE EXCEPTION 'option_unit_invalid' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(p_payload->>'guestMin', '')$old$,
  $new$    IF v_offer.kind = 'entry' AND p_payload->>'unit' <> 'guest' THEN
      RAISE EXCEPTION 'option_unit_invalid' USING ERRCODE = '22023';
    END IF;
    IF (p_payload ? 'passDays') <> (p_payload ? 'passWindowDays')
       OR (p_payload ? 'passDays' AND (
         (p_payload->'passDays' = 'null'::jsonb) <> (p_payload->'passWindowDays' = 'null'::jsonb)
         OR (p_payload->'passDays' <> 'null'::jsonb AND (
           COALESCE(p_payload->>'passDays', '') !~ '^[0-9]{1,2}$'
           OR COALESCE(p_payload->>'passWindowDays', '') !~ '^[0-9]{1,3}$'
           OR (p_payload->>'passDays')::integer NOT BETWEEN 2 AND 60
           OR (p_payload->>'passWindowDays')::integer NOT BETWEEN (p_payload->>'passDays')::integer AND 365
           OR v_offer.kind <> 'entry' OR v_offer.entry_style NOT IN ('walk_in', 'day_pass')
         ))
       )) THEN
      RAISE EXCEPTION 'multi_day_pass_invalid' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(p_payload->>'guestMin', '')$new$
);

-- Free prices have no payment provider return to finalize them. The P6
-- member-credit path may already have confirmed a zero-total booking; this
-- helper is deliberately a no-op in that state.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_create_offer_group(uuid,uuid,jsonb,text,uuid,bytea,text)'::regprocedure,
  $old$  PERFORM public.issue_4490_member_spend(v_id);
  RETURN public.issue_4490_booking_projection(v_id, NULL);$old$,
  $new$  PERFORM public.issue_4490_member_spend(v_id);
  PERFORM public.issue_4490_confirm_free_offer(v_id);
  RETURN public.issue_4490_booking_projection(v_id, NULL);$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_offer(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$    UPDATE public.stay_offerings
    SET name = CASE WHEN p_payload ? 'name' THEN btrim(p_payload->>'name') ELSE name END,$old$,
  $new$    IF p_payload->>'entryStyle' = 'timed_session' THEN
      UPDATE public.venue_offer_price_options
      SET pass_days = NULL, pass_window_days = NULL, version = version + 1,
          updated_at = now(), updated_by = v_uid
      WHERE offering_id = v_offer.id AND pass_days IS NOT NULL;
    END IF;
    UPDATE public.stay_offerings
    SET name = CASE WHEN p_payload ? 'name' THEN btrim(p_payload->>'name') ELSE name END,$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_offer(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$        local_start_time, local_end_time, eligibility, busy_rules, sort_order, updated_by
      ) VALUES ($old$,
  $new$        local_start_time, local_end_time, eligibility, busy_rules, pass_days, pass_window_days,
        sort_order, updated_by
      ) VALUES ($new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_offer(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$        COALESCE(p_payload->'busyRules', '[]'::jsonb),
        COALESCE((p_payload->>'sortOrder')::integer,$old$,
  $new$        COALESCE(p_payload->'busyRules', '[]'::jsonb),
        NULLIF(p_payload->>'passDays', '')::smallint,
        NULLIF(p_payload->>'passWindowDays', '')::smallint,
        COALESCE((p_payload->>'sortOrder')::integer,$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_offer(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$          busy_rules = COALESCE(p_payload->'busyRules', '[]'::jsonb),
          sort_order = COALESCE((p_payload->>'sortOrder')::integer, sort_order),$old$,
  $new$          busy_rules = COALESCE(p_payload->'busyRules', '[]'::jsonb),
          pass_days = NULLIF(p_payload->>'passDays', '')::smallint,
          pass_window_days = NULLIF(p_payload->>'passWindowDays', '')::smallint,
          sort_order = COALESCE((p_payload->>'sortOrder')::integer, sort_order),$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_offer_projection(uuid)'::regprocedure,
  $old$        'priceVersionId', price.id,
        -- #4490 P4: a hire price row sits on a space or a combination.$old$,
  $new$        'priceVersionId', price.id,
        'passDays', opt.pass_days,
        'passWindowDays', opt.pass_window_days,
        -- #4490 P4: a hire price row sits on a space or a combination.$new$
);

-- One checkout cannot combine two different pass lengths: the one group has
-- one pass and therefore one immutable validity contract.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_quote_offer_internal(uuid,uuid,jsonb,text,uuid,text,boolean,jsonb,jsonb)'::regprocedure,
  $old$  IF NOT (v_offer.kind = ANY(public.issue_4490_built_offer_kinds())) THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_window$old$,
  $new$  IF NOT (v_offer.kind = ANY(public.issue_4490_built_offer_kinds())) THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF (SELECT count(*) FROM (
        SELECT opt.pass_days, opt.pass_window_days
        FROM jsonb_array_elements(p_lines) item
        JOIN public.venue_offer_price_options opt ON opt.id = (item->>'priceOptionId')::uuid
          AND opt.offering_id = v_offer.id AND opt.status = 'active'
        GROUP BY opt.pass_days, opt.pass_window_days
      ) pass_shapes) > 1 THEN
    RAISE EXCEPTION 'offer_pass_days_mismatch' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_window$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_quote_offer_internal(uuid,uuid,jsonb,text,uuid,text,boolean,jsonb,jsonb)'::regprocedure,
  $old$        'eligibilityLabel', v_option.eligibility->>'label',
        'packageMinor',$old$,
  $new$        'eligibilityLabel', v_option.eligibility->>'label',
        'passDays', v_option.pass_days,
        'passWindowDays', v_option.pass_window_days,
        'packageMinor',$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_quote_projection(uuid)'::regprocedure,
  $old$        'idCheckLabel', l.price_snapshot->>'idCheckLabel',
        'packageMinor',$old$,
  $new$        'idCheckLabel', l.price_snapshot->>'idCheckLabel',
        'passDays', (l.price_snapshot->>'passDays')::smallint,
        'passWindowDays', (l.price_snapshot->>'passWindowDays')::smallint,
        'packageMinor',$new$
);

-- The check-in log's local date is also the undo authority. When a venue is
-- still serving the night-before window after midnight, keep the service date
-- supplied by the admission path instead of the wall-clock calendar date.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_log_check_in(public.venue_listings,uuid,uuid,uuid,text,integer,text,uuid,jsonb,uuid)'::regprocedure,
  $old$    p_undoes, p_scanner, public.issue_4490_venue_local_date(p_venue.id), COALESCE(p_detail, '{}'::jsonb)$old$,
  $new$    p_undoes, p_scanner,
    COALESCE((p_detail->>'serviceDate')::date, public.issue_4490_venue_local_date(p_venue.id)),
    COALESCE(p_detail, '{}'::jsonb)$new$
);

-- Confirmation snapshots the selected length. The final instant follows the
-- last day's own full-day schedule (including a close after midnight).
CREATE OR REPLACE FUNCTION public.issue_4490_issue_offer_pass(p_group_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_line public.stay_reservation_lines%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_rule public.stay_place_schedule_rules%ROWTYPE;
  v_tz text;
  v_from timestamptz;
  v_to timestamptz;
  v_admits integer;
  v_id_label text;
  v_id_count integer;
  v_days smallint := 1;
  v_window_days smallint;
  v_until date;
  v_pass_id uuid;
BEGIN
  SELECT id INTO v_pass_id FROM public.venue_passes WHERE group_id = p_group_id;
  IF FOUND THEN
    RETURN v_pass_id;
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id;
  SELECT * INTO v_line FROM public.stay_reservation_lines
  WHERE group_id = p_group_id ORDER BY created_at, id LIMIT 1;
  SELECT * INTO v_window FROM public.stay_place_windows WHERE id = public.issue_4490_line_window_id(v_line.id);
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = v_line.offering_id;
  v_tz := public.issue_4490_venue_timezone(v_group.venue_id);
  IF v_offer.entry_style = 'timed_session' THEN
    v_from := v_window.starts_at - interval '30 minutes';
    v_to := v_window.starts_at + interval '30 minutes';
  ELSIF v_offer.kind = 'entry' THEN
    v_from := v_window.local_date::timestamp AT TIME ZONE v_tz;
    v_to := GREATEST(v_window.ends_at, (v_window.local_date + 1)::timestamp AT TIME ZONE v_tz);
  ELSE
    v_from := v_window.starts_at - make_interval(mins => v_offer.buffer_before_minutes);
    v_to := v_window.ends_at;
  END IF;

  SELECT COALESCE(max((l.price_snapshot->>'passDays')::smallint), 1),
         max((l.price_snapshot->>'passWindowDays')::smallint),
         sum(public.issue_4490_line_guests(l.id)),
         string_agg(DISTINCT l.price_snapshot->>'idCheckLabel', ' · ')
           FILTER (WHERE l.price_snapshot->>'idCheckLabel' IS NOT NULL),
         COALESCE(sum(public.issue_4490_line_guests(l.id))
           FILTER (WHERE l.price_snapshot->>'idCheckLabel' IS NOT NULL), 0)
  INTO v_days, v_window_days, v_admits, v_id_label, v_id_count
  FROM public.stay_reservation_lines l WHERE l.group_id = p_group_id;

  IF v_days > 1 THEN
    IF v_window_days IS NULL OR v_window_days < v_days THEN
      RAISE EXCEPTION 'offer_pass_days_mismatch' USING ERRCODE = '23514';
    END IF;
    v_until := v_window.local_date + v_window_days - 1;
    SELECT * INTO v_rule FROM public.stay_place_schedule_rules WHERE id = v_window.schedule_rule_id;
    IF FOUND AND v_rule.mode = 'full_day' THEN
      v_to := GREATEST(v_to,
        ((v_until + CASE WHEN v_rule.full_day_end_time <= v_rule.full_day_start_time THEN 1 ELSE 0 END)
          + v_rule.full_day_end_time) AT TIME ZONE v_rule.timezone);
    ELSE
      v_to := GREATEST(v_to, (v_until + 1)::timestamp AT TIME ZONE v_tz);
    END IF;
  END IF;

  INSERT INTO public.venue_passes (
    venue_id, brand_id, group_id, reservation_line_id, offering_id, price_option_id,
    valid_local_date, valid_from, valid_to, admits, holder_name, qr_token_hash,
    id_check_label, id_check_count, source, days_allowed, valid_until_local_date
  ) VALUES (
    v_group.venue_id, v_group.brand_id, v_group.id, v_line.id, v_line.offering_id,
    CASE WHEN (SELECT count(*) FROM public.stay_reservation_lines WHERE group_id = p_group_id) = 1
         THEN v_line.price_option_id END,
    v_window.local_date, v_from, v_to, v_admits,
    left(COALESCE(NULLIF(btrim(v_group.guest_snapshot->>'name'), ''), 'Guest'), 120),
    encode(pg_catalog.sha256(extensions.gen_random_bytes(32)), 'hex'),
    left(v_id_label, 200), v_id_count,
    CASE v_group.booking_source WHEN 'walk_in' THEN 'gate' WHEN 'guest' THEN 'online' ELSE 'staff' END,
    v_days, v_until
  ) RETURNING id INTO v_pass_id;
  RETURN v_pass_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_pass_view_on(p_pass_id uuid, p_local_date date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'passId', p.id,
    'groupId', p.group_id,
    'reference', g.public_reference,
    'holderName', p.holder_name,
    'offerName', o.name,
    'offerKind', o.kind,
    'admits', p.admits,
    'admittedCount', facts.admitted_on,
    'remaining', p.admits - facts.admitted_on,
    'validLocalDate', p.valid_local_date,
    'validUntilLocalDate', p.valid_until_local_date,
    'validFrom', p.valid_from,
    'validTo', p.valid_to,
    'daysAllowed', p.days_allowed,
    'daysUsed', facts.days_used,
    'dayNumber', CASE WHEN p.days_allowed = 1 THEN 1
                      WHEN facts.admitted_on > 0 THEN facts.days_used
                      ELSE LEAST(p.days_allowed, facts.days_used + 1) END,
    'allDaysUsed', facts.days_used >= p.days_allowed,
    'dayLabel', CASE WHEN p.days_allowed = 1 THEN to_char(p.valid_local_date, 'FMDay DD Mon')
                     ELSE 'Valid ' || to_char(p.valid_local_date, 'FMDD Mon') || '–'
                          || to_char(p.valid_until_local_date, 'FMDD Mon') END,
    'idCheckLabel', p.id_check_label,
    'idCheckCount', p.id_check_count,
    'idCheckedAt', p.id_checked_at,
    'firstAdmittedAt', p.first_admitted_at,
    'lastAdmittedAt', p.last_admitted_at,
    'status', p.status,
    'source', p.source,
    'balanceDueMinor', (SELECT m.balance FROM public.issue_4490_booking_money(p.group_id) m),
    'totalDueMinor', (SELECT m.total_due FROM public.issue_4490_booking_money(p.group_id) m),
    'currencyCode', g.currency_code,
    'canTakePayment', g.state IN ('confirmed', 'partially_cancelled'),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', l.price_snapshot->>'optionName', 'guests', public.issue_4490_line_guests(l.id),
        'idCheckLabel', l.price_snapshot->>'idCheckLabel')
        ORDER BY COALESCE((l.price_snapshot->>'sortOrder')::integer, 0), l.created_at, l.id)
      FROM public.stay_reservation_lines l WHERE l.group_id = p.group_id AND l.state <> 'cancelled'), '[]'::jsonb)
  )
  FROM public.venue_passes p
  JOIN public.stay_reservation_groups g ON g.id = p.group_id
  JOIN public.stay_offerings o ON o.id = p.offering_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(public.issue_4490_pass_admitted_on(p.id, p_local_date), 0) AS admitted_on,
           COALESCE(public.issue_4490_pass_days_used(p.id), 0) AS days_used
  ) facts
  WHERE p.id = p_pass_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_pass_view(p_pass_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT public.issue_4490_pass_view_on(
    p.id, public.issue_4490_venue_service_date(p.venue_id, now()))
  FROM public.venue_passes p WHERE p.id = p_pass_id;
$function$;

REVOKE ALL ON FUNCTION public.issue_4490_pass_view_on(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4490_pass_view_on(uuid, date) TO service_role;

ALTER TABLE public.venue_check_in_log
  DROP CONSTRAINT venue_check_in_log_result_check,
  ADD CONSTRAINT venue_check_in_log_result_check CHECK (result IN (
    'admitted', 'already_used', 'wrong_day', 'not_yet', 'void', 'not_found',
    'wrong_venue', 'id_required', 'id_refused', 'days_used', 'day_full', 'undone'
  ));

CREATE OR REPLACE FUNCTION public.issue_4490_admit_pass(
  p_venue public.venue_listings,
  p_pass_id uuid,
  p_admit_count integer,
  p_id_checked boolean,
  p_scanner uuid,
  p_method text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_pass public.venue_passes%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_result text;
  v_count integer;
  v_log uuid;
  v_today date := public.issue_4490_venue_service_date(p_venue.id, now());
  v_admitted integer := 0;
  v_days_used integer := 0;
  v_pool uuid;
  v_usage record;
BEGIN
  SELECT * INTO v_pass FROM public.venue_passes WHERE id = p_pass_id FOR UPDATE;
  IF NOT FOUND THEN
    v_log := public.issue_4490_log_check_in(p_venue, NULL, NULL, NULL, 'not_found', 0, p_method, p_scanner, '{}'::jsonb);
    RETURN jsonb_build_object('result', 'not_found', 'logId', v_log);
  END IF;
  IF v_pass.venue_id <> p_venue.id THEN
    v_log := public.issue_4490_log_check_in(p_venue, NULL, NULL, NULL, 'wrong_venue', 0, p_method, p_scanner,
      jsonb_build_object('passVenueId', v_pass.venue_id));
    RETURN jsonb_build_object('result', 'wrong_venue', 'logId', v_log,
      'venueName', (SELECT v.name FROM public.venue_listings v WHERE v.id = v_pass.venue_id));
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = v_pass.group_id;
  v_admitted := COALESCE(public.issue_4490_pass_admitted_on(v_pass.id, v_today), 0);
  v_days_used := COALESCE(public.issue_4490_pass_days_used(v_pass.id), 0);

  IF v_pass.status <> 'valid' OR v_group.state NOT IN ('confirmed', 'partially_cancelled') THEN
    v_result := 'void';
  ELSIF v_pass.days_allowed > 1 AND v_today < v_pass.valid_local_date THEN
    v_result := 'not_yet';
  ELSIF v_pass.days_allowed > 1 AND (v_today > v_pass.valid_until_local_date OR now() >= v_pass.valid_to) THEN
    v_result := 'wrong_day';
  ELSIF v_pass.days_allowed = 1 AND (
      now() >= v_pass.valid_to OR (now() < v_pass.valid_from AND v_today <> v_pass.valid_local_date)) THEN
    v_result := 'wrong_day';
  ELSIF v_pass.days_allowed = 1 AND now() < v_pass.valid_from THEN
    v_result := 'not_yet';
  ELSIF v_admitted >= v_pass.admits THEN
    v_result := 'already_used';
  ELSIF v_pass.days_allowed > 1 AND v_admitted = 0 AND v_days_used >= v_pass.days_allowed THEN
    v_result := 'days_used';
  ELSIF v_pass.id_check_label IS NOT NULL AND v_pass.id_checked_at IS NULL AND NOT COALESCE(p_id_checked, false) THEN
    v_result := 'id_required';
  END IF;

  IF v_result IS NULL AND v_pass.days_allowed > 1 AND v_admitted = 0
     AND v_today <> v_pass.valid_local_date THEN
    SELECT o.capacity_pool_id INTO v_pool FROM public.stay_offerings o WHERE o.id = v_pass.offering_id;
    PERFORM 1 FROM public.venue_capacity_pools p WHERE p.id = v_pool FOR UPDATE;
    SELECT * INTO v_usage FROM public.issue_4490_pool_day_usage(v_pool, v_today);
    IF v_pool IS NULL OR COALESCE(v_usage.closed, true) OR COALESCE(v_usage.gate_left, 0) < v_pass.admits THEN
      v_result := 'day_full';
    END IF;
  END IF;

  IF v_result IS NOT NULL THEN
    v_log := public.issue_4490_log_check_in(p_venue, v_pass.id, NULL, NULL, v_result, 0, p_method, p_scanner,
      jsonb_build_object('serviceDate', v_today));
    RETURN jsonb_build_object('result', v_result, 'logId', v_log,
      'pass', public.issue_4490_pass_view_on(v_pass.id, v_today));
  END IF;

  v_count := COALESCE(p_admit_count, v_pass.admits - v_admitted);
  IF v_count < 1 OR v_count > v_pass.admits - v_admitted THEN
    RAISE EXCEPTION 'admit_count_invalid' USING ERRCODE = '22023',
      DETAIL = jsonb_build_object('remaining', v_pass.admits - v_admitted)::text;
  END IF;

  IF v_pass.days_allowed = 1 THEN
    UPDATE public.venue_passes
    SET admitted_count = admitted_count + v_count,
        id_checked_at = CASE WHEN id_check_label IS NOT NULL AND COALESCE(p_id_checked, false)
                             THEN COALESCE(id_checked_at, now()) ELSE id_checked_at END,
        first_admitted_at = COALESCE(first_admitted_at, now()),
        last_admitted_at = now(), version = version + 1, updated_at = now()
    WHERE id = v_pass.id AND admitted_count + v_count <= admits
    RETURNING * INTO v_pass;
    IF NOT FOUND THEN
      v_log := public.issue_4490_log_check_in(p_venue, p_pass_id, NULL, NULL, 'already_used', 0, p_method, p_scanner, '{}'::jsonb);
      RETURN jsonb_build_object('result', 'already_used', 'logId', v_log,
        'pass', public.issue_4490_pass_view_on(p_pass_id, v_today));
    END IF;
  ELSE
    INSERT INTO public.venue_pass_days (pass_id, local_date, admitted_count)
    VALUES (v_pass.id, v_today, v_count)
    ON CONFLICT (pass_id, local_date) DO UPDATE
      SET admitted_count = public.venue_pass_days.admitted_count + EXCLUDED.admitted_count,
          updated_at = now()
      WHERE public.venue_pass_days.admitted_count + EXCLUDED.admitted_count <= v_pass.admits;
    IF NOT FOUND THEN
      v_log := public.issue_4490_log_check_in(p_venue, p_pass_id, NULL, NULL, 'already_used', 0, p_method, p_scanner, '{}'::jsonb);
      RETURN jsonb_build_object('result', 'already_used', 'logId', v_log,
        'pass', public.issue_4490_pass_view_on(p_pass_id, v_today));
    END IF;
    UPDATE public.venue_passes
    SET id_checked_at = CASE WHEN id_check_label IS NOT NULL AND COALESCE(p_id_checked, false)
                             THEN COALESCE(id_checked_at, now()) ELSE id_checked_at END,
        first_admitted_at = COALESCE(first_admitted_at, now()),
        last_admitted_at = now(), version = version + 1, updated_at = now()
    WHERE id = v_pass.id RETURNING * INTO v_pass;
  END IF;

  v_log := public.issue_4490_log_check_in(p_venue, v_pass.id, NULL, NULL, 'admitted', v_count, p_method, p_scanner,
    jsonb_build_object('idChecked', COALESCE(p_id_checked, false), 'serviceDate', v_today));
  RETURN jsonb_build_object('result', 'admitted', 'admitted', v_count, 'logId', v_log,
    'balanceDueMinor', (SELECT m.balance FROM public.issue_4490_booking_money(v_pass.group_id) m),
    'pass', public.issue_4490_pass_view_on(v_pass.id, v_today));
END;
$function$;

-- Later-day admission draws capacity once for the whole party. Day one is
-- already represented by its checkout commitment and must not be counted twice.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_pool_day_usage(uuid,date)'::regprocedure,
  $old$    UNION ALL
    SELECT (1 + visit.guests)::integer, true
    FROM public.venue_member_visits visit
    WHERE visit.pool_id = p_pool_id
      AND visit.local_date = p_local_date
      AND visit.undone_at IS NULL
  ) usage_rows;$old$,
  $new$    UNION ALL
    SELECT (1 + visit.guests)::integer, true
    FROM public.venue_member_visits visit
    WHERE visit.pool_id = p_pool_id
      AND visit.local_date = p_local_date
      AND visit.undone_at IS NULL
    UNION ALL
    SELECT pass.admits, true
    FROM public.venue_passes pass
    JOIN public.stay_offerings offering ON offering.id = pass.offering_id
    JOIN public.stay_reservation_groups group_row ON group_row.id = pass.group_id
    WHERE offering.capacity_pool_id = p_pool_id
      AND p_local_date <> pass.valid_local_date
      AND public.issue_4490_pass_admitted_on(pass.id, p_local_date) > 0
      AND pass.status = 'valid'
      AND group_row.state IN ('confirmed', 'partially_cancelled')
  ) usage_rows;$new$
);

CREATE OR REPLACE FUNCTION public.issue_4490_check_in_undo(
  p_venue_id uuid,
  p_log_id uuid,
  p_scanner_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_log public.venue_check_in_log%ROWTYPE;
  v_pass public.venue_passes%ROWTYPE;
  v_day public.venue_pass_days%ROWTYPE;
  v_new uuid;
BEGIN
  v_venue := public.issue_4490_assert_check_in(p_venue_id, p_scanner_user_id);
  SELECT * INTO v_log FROM public.venue_check_in_log WHERE id = p_log_id;
  IF NOT FOUND OR v_log.venue_id <> v_venue.id THEN
    RAISE EXCEPTION 'check_in_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_log.subscription_id IS NOT NULL THEN
    IF v_log.result <> 'admitted' OR v_log.admitted_delta < 1 THEN
      RAISE EXCEPTION 'check_in_not_undoable' USING ERRCODE = 'PT409';
    END IF;
    IF v_log.created_at < now() - interval '10 minutes' THEN
      RAISE EXCEPTION 'check_in_undo_too_late' USING ERRCODE = 'PT409';
    END IF;
    IF EXISTS (SELECT 1 FROM public.venue_check_in_log u WHERE u.undoes_log_id = v_log.id) THEN
      RAISE EXCEPTION 'check_in_already_undone' USING ERRCODE = 'PT409';
    END IF;
    UPDATE public.venue_member_visits SET undone_at = now() WHERE log_id = v_log.id AND undone_at IS NULL;
    INSERT INTO public.venue_credit_ledger (subscription_id, period_id, credit, entry, amount, visit_id, expires_at, idempotency_key)
    SELECT l.subscription_id, l.period_id, l.credit, 'return', -l.amount, l.visit_id, l.expires_at, 'return:' || l.id
    FROM public.venue_credit_ledger l
    JOIN public.venue_member_visits x ON x.id = l.visit_id
    WHERE x.log_id = v_log.id AND l.entry = 'spend'
    ON CONFLICT (idempotency_key) DO NOTHING;
    INSERT INTO public.venue_check_in_log (venue_id, brand_id, subscription_id, result, admitted_delta, method,
      undoes_log_id, scanner_user_id, local_date, detail)
    VALUES (v_venue.id, v_venue.brand_id, v_log.subscription_id, 'undone', -v_log.admitted_delta, 'undo',
      v_log.id, p_scanner_user_id, public.issue_4490_venue_local_date(v_venue.id), '{"kind":"member"}'::jsonb)
    RETURNING id INTO v_new;
    RETURN jsonb_build_object('result', 'undone', 'logId', v_new, 'undid', v_log.admitted_delta, 'kind', 'member',
      'member', public.issue_4490_member_projection(v_log.subscription_id, 'check_in', NULL));
  END IF;
  IF v_log.result <> 'admitted' OR v_log.pass_id IS NULL OR v_log.admitted_delta < 1 THEN
    RAISE EXCEPTION 'check_in_not_undoable' USING ERRCODE = 'PT409';
  END IF;
  IF v_log.created_at < now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'check_in_undo_too_late' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (SELECT 1 FROM public.venue_check_in_log u WHERE u.undoes_log_id = v_log.id) THEN
    RAISE EXCEPTION 'check_in_already_undone' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_pass FROM public.venue_passes WHERE id = v_log.pass_id FOR UPDATE;
  IF v_pass.days_allowed > 1 THEN
    SELECT * INTO v_day FROM public.venue_pass_days
    WHERE pass_id = v_pass.id AND local_date = v_log.local_date FOR UPDATE;
    IF NOT FOUND OR v_day.admitted_count < v_log.admitted_delta THEN
      RAISE EXCEPTION 'check_in_not_undoable' USING ERRCODE = 'PT409';
    END IF;
    UPDATE public.venue_pass_days
    SET admitted_count = admitted_count - v_log.admitted_delta, updated_at = now()
    WHERE pass_id = v_pass.id AND local_date = v_log.local_date;
    DELETE FROM public.venue_pass_days
    WHERE pass_id = v_pass.id AND local_date = v_log.local_date AND admitted_count = 0;
    UPDATE public.venue_passes
    SET first_admitted_at = CASE WHEN EXISTS (SELECT 1 FROM public.venue_pass_days d WHERE d.pass_id = v_pass.id)
                                 THEN first_admitted_at ELSE NULL END,
        last_admitted_at = CASE WHEN EXISTS (SELECT 1 FROM public.venue_pass_days d WHERE d.pass_id = v_pass.id)
                                THEN last_admitted_at ELSE NULL END,
        version = version + 1, updated_at = now()
    WHERE id = v_pass.id RETURNING * INTO v_pass;
  ELSE
    IF v_pass.admitted_count < v_log.admitted_delta THEN
      RAISE EXCEPTION 'check_in_not_undoable' USING ERRCODE = 'PT409';
    END IF;
    UPDATE public.venue_passes
    SET admitted_count = admitted_count - v_log.admitted_delta,
        first_admitted_at = CASE WHEN admitted_count - v_log.admitted_delta = 0 THEN NULL ELSE first_admitted_at END,
        last_admitted_at = CASE WHEN admitted_count - v_log.admitted_delta = 0 THEN NULL ELSE last_admitted_at END,
        version = version + 1, updated_at = now()
    WHERE id = v_pass.id RETURNING * INTO v_pass;
  END IF;
  v_new := public.issue_4490_log_check_in(v_venue, v_pass.id, NULL, NULL, 'undone', -v_log.admitted_delta, 'undo',
    p_scanner_user_id, jsonb_build_object('serviceDate', v_log.local_date), v_log.id);
  RETURN jsonb_build_object('result', 'undone', 'logId', v_new, 'undid', v_log.admitted_delta,
    'pass', public.issue_4490_pass_view_on(v_pass.id, v_log.local_date));
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_check_in_list(
  p_venue_id uuid,
  p_local_date date,
  p_scanner_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_tz text;
  v_date date;
BEGIN
  v_venue := public.issue_4490_assert_check_in(p_venue_id, p_scanner_user_id);
  v_tz := public.issue_4490_venue_timezone(p_venue_id);
  v_date := COALESCE(p_local_date, public.issue_4490_venue_local_date(p_venue_id));
  RETURN jsonb_build_object(
    'venueId', p_venue_id,
    'localDate', v_date,
    'timezone', v_tz,
    'passes', COALESCE((
      SELECT jsonb_agg(public.issue_4490_pass_view_on(p.id, v_date) || jsonb_build_object(
          'kind', 'pass',
          'time', CASE WHEN p.days_allowed > 1 THEN v_date::timestamp AT TIME ZONE v_tz ELSE w.starts_at END,
          'endsAt', CASE WHEN p.days_allowed > 1 THEN NULL ELSE w.ends_at END)
        ORDER BY w.starts_at, p.holder_name, p.id)
      FROM public.venue_passes p
      JOIN public.stay_reservation_lines l ON l.id = p.reservation_line_id
      JOIN public.stay_place_windows w ON w.id = public.issue_4490_line_window_id(l.id)
      WHERE p.venue_id = p_venue_id AND (
        (p.days_allowed = 1 AND p.valid_local_date = v_date)
        OR (p.days_allowed > 1 AND v_date BETWEEN p.valid_local_date AND p.valid_until_local_date
          AND (public.issue_4490_pass_admitted_on(p.id, v_date) > 0
            OR public.issue_4490_pass_days_used(p.id) < p.days_allowed))
      )), '[]'::jsonb),
    'tickets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'kind', 'event_ticket', 'ticketId', t.id, 'eventId', e.id, 'eventTitle', e.title,
          'holderName', COALESCE(t.holder_name, t.attendee_name, orders.buyer_name),
          'ticketName', tt.name, 'admits', COALESCE(t.admits_count, 1),
          'admittedCount', CASE WHEN t.status = 'used' OR t.used_at IS NOT NULL THEN COALESCE(t.admits_count, 1) ELSE 0 END,
          'status', t.status, 'time', d.start_at)
        ORDER BY d.start_at, t.id)
      FROM public.events e
      JOIN public.event_dates d ON d.event_id = e.id
        AND (d.start_at AT TIME ZONE v_tz)::date = v_date
        AND COALESCE(d.status, 'scheduled') <> 'cancelled'
      JOIN public.tickets t ON t.event_id = e.id AND t.status IN ('valid', 'used')
      JOIN public.orders orders ON orders.id = t.order_id
      LEFT JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
      WHERE e.venue_id = p_venue_id AND e.deleted_at IS NULL), '[]'::jsonb),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'kind', 'member', 'subscriptionId', s.id, 'holderName', s.member_name,
          'planName', plan.name, 'planPeriod', COALESCE(s.terms->>'period', plan.period),
          'status', s.status, 'paymentDue', s.status IN ('payment_due', 'grace'),
          'guestPassesLeft', public.issue_4490_member_credit_left(s.id, 'guest_passes', now()),
          'inToday', visit.id IS NOT NULL, 'guests', COALESCE(visit.guests, 0),
          'logId', visit.log_id, 'checkedInAt', visit.created_at)
        ORDER BY visit.created_at NULLS LAST, s.member_name, s.id)
      FROM public.venue_membership_subscriptions s
      JOIN public.venue_membership_plans plan ON plan.id = s.plan_id
      JOIN public.stay_offerings o ON o.id = plan.offering_id AND o.venue_id = p_venue_id
      LEFT JOIN public.venue_member_visits visit ON visit.subscription_id = s.id
        AND visit.local_date = v_date AND visit.undone_at IS NULL
      WHERE (s.status IN ('active', 'payment_due', 'grace') AND s.start_on <= v_date) OR visit.id IS NOT NULL), '[]'::jsonb),
    'totals', (
      SELECT jsonb_build_object(
        'passes', count(*),
        'admits', COALESCE(sum(p.admits) FILTER (WHERE p.status = 'valid'), 0),
        'admitted', COALESCE(sum(public.issue_4490_pass_admitted_on(p.id, v_date)), 0))
      FROM public.venue_passes p WHERE p.venue_id = p_venue_id AND (
        (p.days_allowed = 1 AND p.valid_local_date = v_date)
        OR (p.days_allowed > 1 AND v_date BETWEEN p.valid_local_date AND p.valid_until_local_date
          AND (public.issue_4490_pass_admitted_on(p.id, v_date) > 0
            OR public.issue_4490_pass_days_used(p.id) < p.days_allowed))
      ))
  );
END;
$function$;

-- Guest booking and quote reads carry immutable pass facts. A multi-day pass
-- exposes today's service-day progress, not the deliberately unused legacy
-- aggregate column.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_booking_projection(uuid,text)'::regprocedure,
  $old$        'idCheckLabel', l.price_snapshot->>'idCheckLabel')$old$,
  $new$        'idCheckLabel', l.price_snapshot->>'idCheckLabel',
        'passDays', (l.price_snapshot->>'passDays')::smallint,
        'passWindowDays', (l.price_snapshot->>'passWindowDays')::smallint)$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_booking_projection(uuid,text)'::regprocedure,
  $old$        'passId', p.id, 'status', p.status, 'admits', p.admits, 'admittedCount', p.admitted_count,
        'validLocalDate', p.valid_local_date, 'validFrom', p.valid_from, 'validTo', p.valid_to,$old$,
  $new$        'passId', p.id, 'status', p.status, 'admits', p.admits,
        'admittedCount', public.issue_4490_pass_admitted_on(
          p.id, public.issue_4490_venue_service_date(p.venue_id, now())),
        'daysAllowed', p.days_allowed, 'daysUsed', public.issue_4490_pass_days_used(p.id),
        'validLocalDate', p.valid_local_date, 'validUntilLocalDate', p.valid_until_local_date,
        'validFrom', p.valid_from, 'validTo', p.valid_to,$new$
);

-- Once any day was used, a guest cannot cancel, move the start, or change the
-- party by exploiting the intentionally-zero aggregate admitted_count.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_cancel_preview(uuid,bytea,uuid)'::regprocedure,
  $old$  IF EXISTS (SELECT 1 FROM public.venue_passes p WHERE p.group_id = v_group.id AND p.admitted_count > 0)
     AND v_actor = 'guest' THEN$old$,
  $new$  IF EXISTS (SELECT 1 FROM public.venue_passes p WHERE p.group_id = v_group.id
                    AND public.issue_4490_pass_days_used(p.id) > 0)
     AND v_actor = 'guest' THEN$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_change_rules(uuid)'::regprocedure,
  $old$      COALESCE((SELECT p.admitted_count FROM public.venue_passes p WHERE p.group_id = g.id), 0) AS admitted,$old$,
  $new$      COALESCE((SELECT public.issue_4490_pass_days_used(p.id)
                       FROM public.venue_passes p WHERE p.group_id = g.id), 0) AS admitted,$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_change_booking_internal(uuid,text,jsonb,boolean,text,uuid,bytea,bigint,text)'::regprocedure,
  $old$  v_admitted := COALESCE((SELECT p.admitted_count FROM public.venue_passes p WHERE p.group_id = v_group.id), 0);$old$,
  $new$  v_admitted := COALESCE((SELECT public.issue_4490_pass_days_used(p.id)
                                 FROM public.venue_passes p WHERE p.group_id = v_group.id), 0);$new$
);

-- A single-day pass belongs to its own service date. Its lifetime counter is
-- admissions on valid_local_date only, so another date of the same pool never
-- reads it as used (otherwise one gate sale today fills every future day).
-- Readers that show a single-day pass's own progress ask for that date, so a
-- scan after midnight (service date or wall date past valid_local_date, still
-- before valid_to) keeps counting against the pass's own day.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_pass_admitted_on(uuid,date)'::regprocedure,
  $old$  SELECT CASE WHEN p.days_allowed = 1 THEN p.admitted_count$old$,
  $new$  SELECT CASE WHEN p.days_allowed = 1 THEN
                CASE WHEN p_local_date = p.valid_local_date THEN p.admitted_count ELSE 0 END$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_admit_pass(public.venue_listings,uuid,integer,boolean,uuid,text)'::regprocedure,
  $old$  v_admitted := COALESCE(public.issue_4490_pass_admitted_on(v_pass.id, v_today), 0);$old$,
  $new$  v_admitted := COALESCE(public.issue_4490_pass_admitted_on(v_pass.id,
    CASE WHEN v_pass.days_allowed = 1 THEN v_pass.valid_local_date ELSE v_today END), 0);$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_pass_view_on(uuid,date)'::regprocedure,
  $old$    SELECT COALESCE(public.issue_4490_pass_admitted_on(p.id, p_local_date), 0) AS admitted_on,$old$,
  $new$    SELECT COALESCE(public.issue_4490_pass_admitted_on(p.id,
             CASE WHEN p.days_allowed = 1 THEN p.valid_local_date ELSE p_local_date END), 0) AS admitted_on,$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_booking_projection(uuid,text)'::regprocedure,
  $old$        'admittedCount', public.issue_4490_pass_admitted_on(
          p.id, public.issue_4490_venue_service_date(p.venue_id, now())),$old$,
  $new$        'admittedCount', public.issue_4490_pass_admitted_on(
          p.id, CASE WHEN p.days_allowed = 1 THEN p.valid_local_date
                     ELSE public.issue_4490_venue_service_date(p.venue_id, now()) END),$new$
);

DROP FUNCTION pg_temp.issue_4490_patch(regprocedure, text, text);

COMMIT;
