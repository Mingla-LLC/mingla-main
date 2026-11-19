-- #4490 fix round 2 — copy an offer as a draft (N5) and "Runs until" (N82).
--
-- 1. issue_4490_duplicate_offer(venue, offer, idempotency key): copies an
--    Entry, Group package, Private hire or By the hour offer of the venue as a
--    NEW DRAFT named "<name> (copy)": the offer row (rules, deposits, extras,
--    hire settings, the shared day pool), its active price options with their
--    current prices, the current refund/change policy, the current fees, the
--    active schedule rule (with a past start moved to today) and the spaces it
--    uses. Nothing sold, held or booked is copied; windows are made only when
--    the copy is published. Same authority as issue_4490_manage_offer
--    (venue.manage_offers); a membership plan's offer is refused.
-- 2. Saving a live offer's schedule keeps its unchanged sessions on sale
--    (see issue_4490_reopen_matching_windows below).
-- 3. A schedule rule cannot end before it starts (set_schedule's "endDate",
--    shown to hosts as "Runs until"): schedule_end_before_start (22023). The
--    window maker already stops at local_end_date.
--
-- Conflicts raise PT409 (never 40001). Static SQL. Local stack only.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.issue_4490_assert_schedule_dates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.local_end_date IS NOT NULL AND NEW.local_end_date < NEW.local_start_date THEN
    RAISE EXCEPTION 'schedule_end_before_start' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER issue_4490_schedule_dates_guard
  BEFORE INSERT OR UPDATE OF local_start_date, local_end_date ON public.stay_place_schedule_rules
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_schedule_dates();

-- Found while proving "Runs until": issue_4490_manage_offer('set_schedule') on
-- a LIVE offer stops every unsold future window and then re-makes the windows
-- with ON CONFLICT DO NOTHING, so any session whose time did not change stayed
-- stopped: saving the schedule (even unchanged, or only adding an end date)
-- took the whole offer off sale. The private hire and by-the-hour writers
-- already re-open matching windows after re-making them; this does the same
-- for Entry, Group package and every other full-day / repeating rule: when a
-- new active rule is written for a live offer, its future unsold windows that
-- the rule makes again (same start and end, a day the rule runs, inside its
-- dates) sell again and point at the new rule.
CREATE OR REPLACE FUNCTION public.issue_4490_reopen_matching_windows()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_span integer;
BEGIN
  IF NOT NEW.active OR NEW.mode NOT IN ('full_day', 'repeating_windows') THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.stay_offerings o WHERE o.id = NEW.offering_id AND o.status = 'live') THEN
    RETURN NEW;
  END IF;
  IF NEW.mode = 'full_day' THEN
    UPDATE public.stay_place_windows w
    SET stop_sell = false, schedule_rule_id = NEW.id, version = w.version + 1, updated_at = now()
    WHERE w.offering_id = NEW.offering_id AND w.stop_sell AND NOT w.booked_block AND w.starts_at > now()
      AND w.local_date >= NEW.local_start_date
      AND (NEW.local_end_date IS NULL OR w.local_date <= NEW.local_end_date)
      AND (extract(isodow FROM w.local_date)::integer - 1) = ANY(NEW.weekdays)
      AND w.starts_at = (w.local_date + NEW.full_day_start_time) AT TIME ZONE NEW.timezone
      AND w.ends_at = ((w.local_date + CASE WHEN NEW.full_day_end_time <= NEW.full_day_start_time THEN 1 ELSE 0 END)
                       + NEW.full_day_end_time) AT TIME ZONE NEW.timezone;
  ELSE
    v_span := (extract(epoch FROM (NEW.local_end_time - NEW.local_start_time))::integer / 60);
    IF v_span <= 0 THEN
      v_span := v_span + 1440;
    END IF;
    UPDATE public.stay_place_windows w
    SET stop_sell = false, schedule_rule_id = NEW.id, version = w.version + 1, updated_at = now()
    FROM generate_series(0, GREATEST((v_span - NEW.slot_duration_minutes) / NEW.slot_interval_minutes, -1)) k
    WHERE w.offering_id = NEW.offering_id AND w.stop_sell AND NOT w.booked_block AND w.starts_at > now()
      AND w.local_date >= NEW.local_start_date
      AND (NEW.local_end_date IS NULL OR w.local_date <= NEW.local_end_date)
      AND (extract(isodow FROM w.local_date)::integer - 1) = ANY(NEW.weekdays)
      AND w.starts_at = (w.local_date + NEW.local_start_time + make_interval(mins => k * NEW.slot_interval_minutes))
                        AT TIME ZONE NEW.timezone
      AND w.ends_at = (w.local_date + NEW.local_start_time
                       + make_interval(mins => k * NEW.slot_interval_minutes + NEW.slot_duration_minutes))
                      AT TIME ZONE NEW.timezone;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER issue_4490_schedule_reopen_windows
  AFTER INSERT ON public.stay_place_schedule_rules
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_reopen_matching_windows();

CREATE OR REPLACE FUNCTION public.issue_4490_duplicate_offer(
  p_venue_id uuid,
  p_offer_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
  v_src public.stay_offerings%ROWTYPE;
  v_new_id uuid := gen_random_uuid();
  v_hash text;
  v_replay jsonb;
  v_result jsonb;
  v_option record;
  v_new_option uuid;
  v_map jsonb := '{}'::jsonb;
  v_today date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_offer_id IS NULL OR p_venue_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_can_manage_venue(p_venue_id, 'venue.manage_offers') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'action', 'duplicate', 'venue', p_venue_id, 'offer', p_offer_id)::text, 'UTF8')), 'hex');
  v_replay := public.issue_4490_receipt_lookup('duplicate_offer:' || p_venue_id::text, p_idempotency_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;

  SELECT * INTO v_src FROM public.stay_offerings
  WHERE id = p_offer_id AND venue_id = p_venue_id
  FOR SHARE;
  IF NOT FOUND OR v_src.status = 'archived' THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_src.kind NOT IN ('entry', 'group_package', 'private_hire', 'by_the_hour') THEN
    RAISE EXCEPTION 'offer_kind_not_copyable' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.stay_offerings
  SELECT (jsonb_populate_record(NULL::public.stay_offerings, to_jsonb(v_src) || jsonb_build_object(
    'id', v_new_id,
    'name', left(v_src.name, 113) || ' (copy)',
    'status', 'draft',
    'version', 1,
    'created_by', v_uid,
    'updated_by', v_uid,
    'created_at', now(),
    'updated_at', now(),
    'archived_at', NULL,
    'sort_order', COALESCE((SELECT max(o.sort_order) + 1 FROM public.stay_offerings o WHERE o.venue_id = p_venue_id), 0)
  ))).*;

  -- Price options (active) and their current prices.
  FOR v_option IN
    SELECT * FROM public.venue_offer_price_options
    WHERE offering_id = v_src.id AND status = 'active'
    ORDER BY sort_order, created_at
  LOOP
    v_new_option := gen_random_uuid();
    v_map := v_map || jsonb_build_object(v_option.id::text, v_new_option);
    INSERT INTO public.venue_offer_price_options
    SELECT (jsonb_populate_record(NULL::public.venue_offer_price_options, to_jsonb(v_option) || jsonb_build_object(
      'id', v_new_option,
      'offering_id', v_new_id,
      'version', 1,
      'created_at', now(),
      'updated_at', now(),
      'updated_by', v_uid
    ))).*;
  END LOOP;

  INSERT INTO public.stay_price_versions
  SELECT (jsonb_populate_record(NULL::public.stay_price_versions, to_jsonb(p) || jsonb_build_object(
    'id', gen_random_uuid(),
    'offering_id', v_new_id,
    'version_number', row_number() OVER (ORDER BY p.created_at, p.id),
    'price_option_id', CASE WHEN p.price_option_id IS NULL THEN NULL ELSE v_map->>(p.price_option_id::text) END,
    'effective_from', now(),
    'effective_to', NULL,
    'reconciliation_id', NULL,
    'supersedes_version_id', NULL,
    'created_by', v_uid,
    'created_at', now()
  ))).*
  FROM public.stay_price_versions p
  WHERE p.offering_id = v_src.id AND p.effective_to IS NULL
    AND (p.price_option_id IS NULL OR v_map ? p.price_option_id::text);

  INSERT INTO public.stay_policy_versions
  SELECT (jsonb_populate_record(NULL::public.stay_policy_versions, to_jsonb(p) || jsonb_build_object(
    'id', gen_random_uuid(),
    'offering_id', v_new_id,
    'version_number', 1,
    'effective_from', now(),
    'effective_to', NULL,
    'created_by', v_uid,
    'created_at', now()
  ))).*
  FROM public.stay_policy_versions p
  WHERE p.offering_id = v_src.id AND p.effective_to IS NULL;

  INSERT INTO public.stay_fee_versions
  SELECT (jsonb_populate_record(NULL::public.stay_fee_versions, to_jsonb(f) || jsonb_build_object(
    'id', gen_random_uuid(),
    'offering_id', v_new_id,
    'version_number', 1,
    'effective_from', now(),
    'effective_to', NULL,
    'reconciliation_id', NULL,
    'supersedes_version_id', NULL,
    'created_by', v_uid,
    'created_at', now()
  ))).*
  FROM public.stay_fee_versions f
  WHERE f.offering_id = v_src.id AND f.effective_to IS NULL;

  -- The active schedule: a start already in the past starts today.
  v_today := (now() AT TIME ZONE public.issue_4490_venue_timezone(p_venue_id))::date;
  INSERT INTO public.stay_place_schedule_rules
  SELECT (jsonb_populate_record(NULL::public.stay_place_schedule_rules, to_jsonb(r) || jsonb_build_object(
    'id', gen_random_uuid(),
    'offering_id', v_new_id,
    'version', 1,
    'local_start_date', GREATEST(r.local_start_date, v_today),
    'local_end_date', CASE WHEN r.local_end_date IS NOT NULL AND r.local_end_date < v_today THEN NULL ELSE r.local_end_date END,
    'created_by', v_uid,
    'updated_by', v_uid,
    'created_at', now(),
    'updated_at', now()
  ))).*
  FROM public.stay_place_schedule_rules r
  WHERE r.offering_id = v_src.id AND r.active;

  INSERT INTO public.venue_offer_spaces (offering_id, space_id, venue_id, brand_id, combination_id)
  SELECT v_new_id, s.space_id, s.venue_id, s.brand_id, s.combination_id
  FROM public.venue_offer_spaces s
  WHERE s.offering_id = v_src.id;

  v_result := public.issue_4490_offer_projection(v_new_id)
    || jsonb_build_object('copiedFrom', v_src.id, 'windowsCreated', 0);
  PERFORM public.issue_4490_receipt_store('duplicate_offer:' || p_venue_id::text, p_idempotency_key, v_hash, v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4490_assert_schedule_dates() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_reopen_matching_windows() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_4490_duplicate_offer(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4490_duplicate_offer(uuid, uuid, text) TO authenticated;

COMMIT;

-- Reverse (local use only; forward-fix in production):
--   DROP FUNCTION public.issue_4490_duplicate_offer(uuid, uuid, text);
--   DROP TRIGGER issue_4490_schedule_reopen_windows ON public.stay_place_schedule_rules;
--   DROP FUNCTION public.issue_4490_reopen_matching_windows();
--   DROP TRIGGER issue_4490_schedule_dates_guard ON public.stay_place_schedule_rules;
--   DROP FUNCTION public.issue_4490_assert_schedule_dates();
