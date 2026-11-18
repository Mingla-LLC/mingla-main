-- #4490 P2 migration 3 (P2-3) — check-in at the venue.
--
-- One check-in for the venue's day: venue passes (from migration 2) and event
-- tickets for events held at the venue.
--   issue_4490_check_in_list   the day's list (passes + event tickets)
--   issue_4490_check_in_scan   a pass QR (mingla:v1:vpass:<id>:sig:<hex>) or an
--                              event ticket QR (delegated to biz_ticket_scan)
--   issue_4490_check_in_admit  the same rules without a QR (from the list)
--   issue_4490_check_in_undo   undo an admit within 10 minutes (same venue)
--   issue_4490_gate_sale       sell at the gate (cash, transfer, pay-by-code);
--                              draws the kept-for-walk-ins seats first
--   issue_4490_venue_day       the Host's Today numbers for one venue day
-- Every scan / admit / undo appends to venue_check_in_log (append-only).
--
-- Result codes: admitted, already_used, wrong_day, not_yet, void, not_found,
-- wrong_venue, id_required (no admit until the ID is confirmed), plus
-- id_refused and undone in the log. Admitted results carry balance_due_minor
-- (always 0 until P3 brings deposits).
--
-- The check-in RPCs are service-role only: edge function `venue-check-in`
-- verifies the caller's JWT and passes the scanner's user id; authority is
-- venue.check_in or brand rank >= scanner.
--
-- Static SQL. Local stack only until Seth says otherwise.
-- Reverse (local only): drop the functions and venue_check_in_log.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.venue_check_in_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  pass_id uuid REFERENCES public.venue_passes(id) ON DELETE RESTRICT,
  ticket_id uuid,
  event_id uuid,
  result text NOT NULL CHECK (result IN (
    'admitted', 'already_used', 'wrong_day', 'not_yet', 'void', 'not_found',
    'wrong_venue', 'id_required', 'id_refused', 'undone'
  )),
  admitted_delta integer NOT NULL DEFAULT 0 CHECK (admitted_delta BETWEEN -100000 AND 100000),
  method text NOT NULL CHECK (method IN ('scan', 'manual', 'gate_sale', 'undo')),
  undoes_log_id uuid REFERENCES public.venue_check_in_log(id) ON DELETE RESTRICT,
  scanner_user_id uuid,
  local_date date NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_check_in_log_undo_shape CHECK (
    (result = 'undone') = (undoes_log_id IS NOT NULL)
  )
);
CREATE INDEX venue_check_in_log_venue_day_idx ON public.venue_check_in_log (venue_id, local_date, created_at);
CREATE INDEX venue_check_in_log_pass_idx ON public.venue_check_in_log (pass_id) WHERE pass_id IS NOT NULL;
CREATE UNIQUE INDEX venue_check_in_log_one_undo ON public.venue_check_in_log (undoes_log_id)
  WHERE undoes_log_id IS NOT NULL;

ALTER TABLE public.venue_check_in_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_check_in_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.venue_check_in_log TO authenticated;
GRANT ALL ON public.venue_check_in_log TO service_role;
CREATE POLICY "venue check-in log readable by venue viewers"
  ON public.venue_check_in_log FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_venue(venue_id));
CREATE TRIGGER issue_4490_venue_check_in_log_brand
  BEFORE INSERT OR UPDATE OF venue_id, brand_id ON public.venue_check_in_log
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_assert_venue_brand();

CREATE OR REPLACE FUNCTION public.issue_4490_guard_check_in_log()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'check_in_log_append_only' USING ERRCODE = '55000';
END;
$function$;
CREATE TRIGGER issue_4490_venue_check_in_log_append_only
  BEFORE UPDATE OR DELETE ON public.venue_check_in_log
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_guard_check_in_log();

-- ---------------------------------------------------------------------------
-- Helpers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_assert_check_in(p_venue_id uuid, p_user_id uuid)
RETURNS public.venue_listings
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_can_check_in(p_venue_id, p_user_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN v_venue;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_venue_local_date(p_venue_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT (now() AT TIME ZONE public.issue_4490_venue_timezone(p_venue_id))::date;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_pass_view(p_pass_id uuid)
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
    'admittedCount', p.admitted_count,
    'remaining', p.admits - p.admitted_count,
    'validLocalDate', p.valid_local_date,
    'validFrom', p.valid_from,
    'validTo', p.valid_to,
    'dayLabel', to_char(p.valid_local_date, 'FMDay DD Mon'),
    'idCheckLabel', p.id_check_label,
    'idCheckCount', p.id_check_count,
    'idCheckedAt', p.id_checked_at,
    'firstAdmittedAt', p.first_admitted_at,
    'lastAdmittedAt', p.last_admitted_at,
    'status', p.status,
    'source', p.source,
    'balanceDueMinor', 0,
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', l.price_snapshot->>'optionName', 'guests', l.place_guests,
        'idCheckLabel', l.price_snapshot->>'idCheckLabel') ORDER BY l.created_at, l.id)
      FROM public.stay_reservation_lines l WHERE l.group_id = p.group_id AND l.state <> 'cancelled'), '[]'::jsonb)
  )
  FROM public.venue_passes p
  JOIN public.stay_reservation_groups g ON g.id = p.group_id
  JOIN public.stay_offerings o ON o.id = p.offering_id
  WHERE p.id = p_pass_id;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_log_check_in(
  p_venue public.venue_listings,
  p_pass_id uuid,
  p_ticket_id uuid,
  p_event_id uuid,
  p_result text,
  p_delta integer,
  p_method text,
  p_scanner uuid,
  p_detail jsonb,
  p_undoes uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.venue_check_in_log (
    venue_id, brand_id, pass_id, ticket_id, event_id, result, admitted_delta, method,
    undoes_log_id, scanner_user_id, local_date, detail
  ) VALUES (
    p_venue.id, p_venue.brand_id, p_pass_id, p_ticket_id, p_event_id, p_result, COALESCE(p_delta, 0), p_method,
    p_undoes, p_scanner, public.issue_4490_venue_local_date(p_venue.id), COALESCE(p_detail, '{}'::jsonb)
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- Core admit for a pass (scan and manual share it).
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
  v_today date := public.issue_4490_venue_local_date(p_venue.id);
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
  IF v_pass.status <> 'valid' OR v_group.state NOT IN ('confirmed', 'partially_cancelled') THEN
    v_result := 'void';
  ELSIF now() >= v_pass.valid_to
     OR (now() < v_pass.valid_from AND v_today <> v_pass.valid_local_date) THEN
    v_result := 'wrong_day';
  ELSIF now() < v_pass.valid_from THEN
    v_result := 'not_yet';
  ELSIF v_pass.admitted_count >= v_pass.admits THEN
    v_result := 'already_used';
  ELSIF v_pass.id_check_label IS NOT NULL AND v_pass.id_checked_at IS NULL AND NOT COALESCE(p_id_checked, false) THEN
    v_result := 'id_required';
  END IF;
  IF v_result IS NOT NULL THEN
    v_log := public.issue_4490_log_check_in(p_venue, v_pass.id, NULL, NULL, v_result, 0, p_method, p_scanner, '{}'::jsonb);
    RETURN jsonb_build_object('result', v_result, 'logId', v_log) || jsonb_build_object('pass', public.issue_4490_pass_view(v_pass.id));
  END IF;
  v_count := COALESCE(p_admit_count, v_pass.admits - v_pass.admitted_count);
  IF v_count < 1 OR v_count > v_pass.admits - v_pass.admitted_count THEN
    RAISE EXCEPTION 'admit_count_invalid' USING ERRCODE = '22023',
      DETAIL = jsonb_build_object('remaining', v_pass.admits - v_pass.admitted_count)::text;
  END IF;
  UPDATE public.venue_passes
  SET admitted_count = admitted_count + v_count,
      id_checked_at = CASE WHEN id_check_label IS NOT NULL AND COALESCE(p_id_checked, false)
                           THEN COALESCE(id_checked_at, now()) ELSE id_checked_at END,
      first_admitted_at = COALESCE(first_admitted_at, now()),
      last_admitted_at = now(),
      version = version + 1, updated_at = now()
  WHERE id = v_pass.id AND admitted_count + v_count <= admits
  RETURNING * INTO v_pass;
  IF NOT FOUND THEN
    v_log := public.issue_4490_log_check_in(p_venue, p_pass_id, NULL, NULL, 'already_used', 0, p_method, p_scanner, '{}'::jsonb);
    RETURN jsonb_build_object('result', 'already_used', 'logId', v_log, 'pass', public.issue_4490_pass_view(p_pass_id));
  END IF;
  v_log := public.issue_4490_log_check_in(p_venue, v_pass.id, NULL, NULL, 'admitted', v_count, p_method, p_scanner,
    jsonb_build_object('idChecked', COALESCE(p_id_checked, false)));
  RETURN jsonb_build_object('result', 'admitted', 'admitted', v_count, 'logId', v_log, 'balanceDueMinor', 0,
    'pass', public.issue_4490_pass_view(v_pass.id));
END;
$function$;

-- ---------------------------------------------------------------------------
-- Scan, admit, undo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_check_in_scan(
  p_venue_id uuid,
  p_qr_payload text,
  p_admit_count integer,
  p_id_checked boolean,
  p_scanner_user_id uuid,
  p_qr_pepper text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_match text[];
  v_pass public.venue_passes%ROWTYPE;
  v_pepper text;
  v_ticket_id uuid;
  v_event_id uuid;
  v_event_venue uuid;
  v_scan jsonb;
  v_result text;
  v_log uuid;
BEGIN
  v_venue := public.issue_4490_assert_check_in(p_venue_id, p_scanner_user_id);
  v_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_pepper);
  IF p_admit_count IS NOT NULL AND p_admit_count NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'admit_count_invalid' USING ERRCODE = '22023';
  END IF;
  v_match := regexp_match(COALESCE(btrim(p_qr_payload), ''),
    '^mingla:v1:vpass:([0-9a-f-]{36}):sig:([a-f0-9]{64})$');
  IF v_match IS NOT NULL THEN
    SELECT * INTO v_pass FROM public.venue_passes WHERE id = v_match[1]::uuid;
    IF NOT FOUND OR btrim(p_qr_payload) <> public.issue_4490_pass_qr_payload(v_pass.id, v_pass.qr_token_hash, v_pepper) THEN
      v_log := public.issue_4490_log_check_in(v_venue, NULL, NULL, NULL, 'not_found', 0, 'scan', p_scanner_user_id, '{}'::jsonb);
      RETURN jsonb_build_object('result', 'not_found', 'logId', v_log);
    END IF;
    RETURN public.issue_4490_admit_pass(v_venue, v_pass.id, p_admit_count, p_id_checked, p_scanner_user_id, 'scan');
  END IF;

  v_match := regexp_match(COALESCE(btrim(p_qr_payload), ''),
    '^mingla:v1:ticket:([0-9a-fA-F-]{36}):sig:([a-f0-9]{64})$');
  IF v_match IS NULL THEN
    v_log := public.issue_4490_log_check_in(v_venue, NULL, NULL, NULL, 'not_found', 0, 'scan', p_scanner_user_id, '{}'::jsonb);
    RETURN jsonb_build_object('result', 'not_found', 'logId', v_log);
  END IF;
  v_ticket_id := v_match[1]::uuid;
  SELECT t.event_id, e.venue_id INTO v_event_id, v_event_venue
  FROM public.tickets t JOIN public.events e ON e.id = t.event_id
  WHERE t.id = v_ticket_id;
  IF v_event_id IS NULL THEN
    v_log := public.issue_4490_log_check_in(v_venue, NULL, v_ticket_id, NULL, 'not_found', 0, 'scan', p_scanner_user_id, '{}'::jsonb);
    RETURN jsonb_build_object('result', 'not_found', 'logId', v_log);
  END IF;
  IF v_event_venue IS DISTINCT FROM v_venue.id THEN
    v_log := public.issue_4490_log_check_in(v_venue, NULL, v_ticket_id, v_event_id, 'wrong_venue', 0, 'scan', p_scanner_user_id, '{}'::jsonb);
    RETURN jsonb_build_object('result', 'wrong_venue', 'logId', v_log, 'kind', 'event_ticket');
  END IF;
  BEGIN
    v_scan := public.biz_ticket_scan(v_event_id, btrim(p_qr_payload), p_scanner_user_id, v_pepper);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'scanner_not_authorized' THEN
      RAISE EXCEPTION 'event_scan_not_allowed' USING ERRCODE = '42501';
    END IF;
    RAISE;
  END;
  v_result := CASE v_scan->>'result'
    WHEN 'success' THEN 'admitted'
    WHEN 'duplicate' THEN 'already_used'
    WHEN 'void' THEN 'void'
    WHEN 'wrong_event' THEN 'wrong_venue'
    WHEN 'not_yet_open' THEN 'not_yet'
    WHEN 'event_ended' THEN 'wrong_day'
    ELSE 'not_found' END;
  v_log := public.issue_4490_log_check_in(v_venue, NULL, v_ticket_id, v_event_id, v_result,
    CASE WHEN v_result = 'admitted' THEN 1 ELSE 0 END, 'scan', p_scanner_user_id,
    jsonb_build_object('ticketResult', v_scan->>'result'));
  RETURN jsonb_build_object(
    'result', v_result, 'logId', v_log, 'kind', 'event_ticket', 'balanceDueMinor', 0,
    'ticket', jsonb_build_object(
      'ticketId', v_ticket_id, 'eventId', v_event_id,
      'holderName', v_scan->>'buyerName', 'ticketName', v_scan->>'ticketName',
      'nextStartAt', v_scan->'nextStartAt', 'lastEndAt', v_scan->'lastEndAt', 'scanId', v_scan->'scanId'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_check_in_admit(
  p_venue_id uuid,
  p_pass_id uuid,
  p_count integer,
  p_id_checked boolean,
  p_scanner_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
BEGIN
  v_venue := public.issue_4490_assert_check_in(p_venue_id, p_scanner_user_id);
  IF p_pass_id IS NULL OR (p_count IS NOT NULL AND p_count NOT BETWEEN 1 AND 100000) THEN
    RAISE EXCEPTION 'admit_count_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN public.issue_4490_admit_pass(v_venue, p_pass_id, p_count, p_id_checked, p_scanner_user_id, 'manual');
END;
$function$;

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
  v_new uuid;
BEGIN
  v_venue := public.issue_4490_assert_check_in(p_venue_id, p_scanner_user_id);
  SELECT * INTO v_log FROM public.venue_check_in_log WHERE id = p_log_id;
  IF NOT FOUND OR v_log.venue_id <> v_venue.id THEN
    RAISE EXCEPTION 'check_in_not_found' USING ERRCODE = 'P0002';
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
  IF v_pass.admitted_count < v_log.admitted_delta THEN
    RAISE EXCEPTION 'check_in_not_undoable' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.venue_passes
  SET admitted_count = admitted_count - v_log.admitted_delta,
      first_admitted_at = CASE WHEN admitted_count - v_log.admitted_delta = 0 THEN NULL ELSE first_admitted_at END,
      last_admitted_at = CASE WHEN admitted_count - v_log.admitted_delta = 0 THEN NULL ELSE last_admitted_at END,
      version = version + 1, updated_at = now()
  WHERE id = v_pass.id
  RETURNING * INTO v_pass;
  v_new := public.issue_4490_log_check_in(v_venue, v_pass.id, NULL, NULL, 'undone', -v_log.admitted_delta, 'undo',
    p_scanner_user_id, '{}'::jsonb, v_log.id);
  RETURN jsonb_build_object('result', 'undone', 'logId', v_new, 'undid', v_log.admitted_delta,
    'pass', public.issue_4490_pass_view(v_pass.id));
END;
$function$;

-- ---------------------------------------------------------------------------
-- The day's list.
-- ---------------------------------------------------------------------------
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
  v_date := COALESCE(p_local_date, (now() AT TIME ZONE v_tz)::date);
  RETURN jsonb_build_object(
    'venueId', p_venue_id,
    'localDate', v_date,
    'timezone', v_tz,
    'passes', COALESCE((
      SELECT jsonb_agg(public.issue_4490_pass_view(p.id) || jsonb_build_object(
          'kind', 'pass', 'time', w.starts_at, 'endsAt', w.ends_at)
        ORDER BY w.starts_at, p.holder_name, p.id)
      FROM public.venue_passes p
      JOIN public.stay_reservation_lines l ON l.id = p.reservation_line_id
      JOIN public.stay_place_windows w ON w.id = l.place_window_id
      WHERE p.venue_id = p_venue_id AND p.valid_local_date = v_date), '[]'::jsonb),
    'tickets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'kind', 'event_ticket',
          'ticketId', t.id,
          'eventId', e.id,
          'eventTitle', e.title,
          'holderName', COALESCE(t.holder_name, t.attendee_name, o.buyer_name),
          'ticketName', tt.name,
          'admits', COALESCE(t.admits_count, 1),
          'admittedCount', CASE WHEN t.status = 'used' OR t.used_at IS NOT NULL THEN COALESCE(t.admits_count, 1) ELSE 0 END,
          'status', t.status,
          'time', d.start_at)
        ORDER BY d.start_at, t.id)
      FROM public.events e
      JOIN public.event_dates d ON d.event_id = e.id
        AND (d.start_at AT TIME ZONE v_tz)::date = v_date
        AND COALESCE(d.status, 'scheduled') <> 'cancelled'
      JOIN public.tickets t ON t.event_id = e.id AND t.status IN ('valid', 'used')
      JOIN public.orders o ON o.id = t.order_id
      LEFT JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
      WHERE e.venue_id = p_venue_id AND e.deleted_at IS NULL), '[]'::jsonb),
    'totals', (
      SELECT jsonb_build_object(
        'passes', count(*),
        'admits', COALESCE(sum(p.admits) FILTER (WHERE p.status = 'valid'), 0),
        'admitted', COALESCE(sum(p.admitted_count), 0))
      FROM public.venue_passes p WHERE p.venue_id = p_venue_id AND p.valid_local_date = v_date)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- Sell at the gate. Cash / transfer: confirmed now, money collected by the
-- venue (no provider payment row, as #4188 property bookings), pass admitted.
-- Pay-by-code: a held booking the guest pays on their phone through the
-- booking link (same pay path as online), using the kept-for-walk-ins seats.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_gate_sale(
  p_venue_id uuid,
  p_offering_id uuid,
  p_lines jsonb,
  p_method text,
  p_buyer jsonb,
  p_idempotency_key text,
  p_scanner_user_id uuid,
  p_group_id uuid DEFAULT NULL,
  p_buyer_token_hash bytea DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_today date;
  v_actor text;
  v_quote jsonb;
  v_group_id uuid;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_hold public.stay_inventory_holds%ROWTYPE;
  v_pass uuid;
  v_admit jsonb;
  v_buyer jsonb;
BEGIN
  v_venue := public.issue_4490_assert_check_in(p_venue_id, p_scanner_user_id);
  IF p_method NOT IN ('cash', 'transfer', 'pay_link')
     OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF p_method = 'pay_link' AND (p_group_id IS NULL OR p_buyer_token_hash IS NULL) THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  v_actor := encode(pg_catalog.sha256(convert_to('gate:' || p_scanner_user_id::text, 'UTF8')), 'hex');
  -- Replay: the same key returns the booking it made.
  SELECT * INTO v_group FROM public.stay_reservation_groups
  WHERE actor_key_hash = v_actor AND idempotency_key = btrim(p_idempotency_key);
  IF FOUND THEN
    RETURN jsonb_build_object('replayed', true, 'method', p_method,
      'booking', public.issue_4490_booking_projection(v_group.id, NULL),
      'passId', (SELECT p.id FROM public.venue_passes p WHERE p.group_id = v_group.id));
  END IF;
  SELECT * INTO v_offer FROM public.stay_offerings
  WHERE id = p_offering_id AND venue_id = p_venue_id AND kind IN ('entry', 'group_package') AND status = 'live';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_today := public.issue_4490_venue_local_date(p_venue_id);
  SELECT * INTO v_window FROM public.stay_place_windows w
  WHERE w.offering_id = v_offer.id AND w.local_date = v_today AND NOT w.stop_sell
    AND now() < public.issue_4490_window_cutoff(v_offer.id, w.id)
  ORDER BY w.starts_at LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_window_unavailable' USING ERRCODE = 'PT409';
  END IF;
  v_buyer := COALESCE(p_buyer, '{}'::jsonb);
  IF NOT (v_buyer ? 'name') OR char_length(btrim(COALESCE(v_buyer->>'name', ''))) = 0 THEN
    v_buyer := v_buyer || jsonb_build_object('name', 'Walk-in');
  END IF;
  v_quote := public.issue_4490_quote_offer_internal(
    v_offer.id, v_window.id, p_lines, v_actor, NULL, 'gate-quote:' || btrim(p_idempotency_key), true);
  v_group_id := public.issue_4490_hold_offer_internal(
    COALESCE(p_group_id, gen_random_uuid()), (v_quote->>'quoteId')::uuid, v_buyer, v_actor, NULL,
    CASE WHEN p_method = 'pay_link' THEN p_buyer_token_hash END,
    p_idempotency_key, true, p_scanner_user_id,
    CASE WHEN p_method = 'pay_link' THEN 'mingla' ELSE 'property' END);

  IF p_method = 'pay_link' THEN
    IF NULLIF(btrim(COALESCE(v_buyer->>'email', '')), '') IS NULL THEN
      RAISE EXCEPTION 'offer_guest_email_required' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('replayed', false, 'method', p_method,
      'booking', public.issue_4490_booking_projection(v_group_id, NULL));
  END IF;

  -- Cash / transfer: the venue holds the money; confirm now.
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = v_group_id FOR UPDATE;
  SELECT * INTO v_hold FROM public.stay_inventory_holds WHERE group_id = v_group_id FOR UPDATE;
  UPDATE public.stay_reservation_groups SET state = 'finalizing', version = version + 1, updated_at = now()
  WHERE id = v_group_id;
  INSERT INTO public.stay_inventory_commitments (
    group_id, reservation_line_id, resource_type, offering_id, place_window_id, quantity
  )
  SELECT v_group_id, s.reservation_line_id, s.resource_type, s.offering_id, s.place_window_id, s.quantity
  FROM public.stay_inventory_hold_slices s WHERE s.hold_id = v_hold.id ORDER BY s.id;
  UPDATE public.stay_inventory_holds SET state = 'converted', reason = 'gate_paid', version = version + 1, updated_at = now()
  WHERE id = v_hold.id;
  UPDATE public.stay_reservation_lines SET state = 'confirmed', version = version + 1, updated_at = now()
  WHERE group_id = v_group_id AND state = 'payment_pending';
  UPDATE public.stay_reservation_groups SET state = 'confirmed', version = version + 1, updated_at = now()
  WHERE id = v_group_id;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    v_group_id, 'stay_offer_gate_paid', 'staff', p_scanner_user_id, 'gate-paid:' || v_group_id,
    jsonb_build_object('method', p_method, 'amountMinor', v_group.total_minor::text,
      'currencyCode', v_group.currency_code)
  );
  SELECT id INTO v_pass FROM public.venue_passes WHERE group_id = v_group_id;
  v_admit := public.issue_4490_admit_pass(v_venue, v_pass, NULL, true, p_scanner_user_id, 'gate_sale');
  RETURN jsonb_build_object('replayed', false, 'method', p_method, 'passId', v_pass,
    'admit', v_admit, 'booking', public.issue_4490_booking_projection(v_group_id, NULL));
END;
$function$;

-- ---------------------------------------------------------------------------
-- Host Today: one venue day.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_venue_day(p_venue_id uuid, p_local_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tz text;
  v_date date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.issue_4490_can_view_venue(p_venue_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_tz := public.issue_4490_venue_timezone(p_venue_id);
  v_date := COALESCE(p_local_date, (now() AT TIME ZONE v_tz)::date);
  RETURN jsonb_build_object(
    'venueId', p_venue_id,
    'localDate', v_date,
    'timezone', v_tz,
    'closed', public.issue_4490_day_closed(p_venue_id, v_date),
    'pools', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'poolId', p.id, 'name', p.name,
          'dailyLimit', u.limit_effective, 'keptForWalkIns', u.kept,
          'used', u.used, 'soldOnline', u.used_online, 'soldAtGate', u.used_gate,
          'onlineLeft', u.online_left, 'walkInLeft', u.kept_left, 'gateLeft', u.gate_left,
          'closed', u.closed,
          'override', (SELECT jsonb_build_object('dailyLimit', ov.daily_limit, 'keptForWalkIns', ov.kept_for_walk_ins,
                         'closed', ov.closed, 'version', ov.version)
                       FROM public.venue_capacity_overrides ov WHERE ov.pool_id = p.id AND ov.local_date = v_date))
        ORDER BY p.created_at)
      FROM public.venue_capacity_pools p
      CROSS JOIN LATERAL public.issue_4490_pool_day_usage(p.id, v_date) u
      WHERE p.venue_id = p_venue_id AND p.archived_at IS NULL), '[]'::jsonb),
    'offers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'offerId', o.id, 'name', o.name, 'kind', o.kind, 'entryStyle', o.entry_style, 'status', o.status,
          'poolId', o.capacity_pool_id,
          'sold', COALESCE((
            SELECT sum(c.quantity) FROM public.stay_inventory_commitments c
            JOIN public.stay_place_windows w ON w.id = c.place_window_id
            WHERE c.offering_id = o.id AND c.state = 'active' AND w.local_date = v_date), 0),
          'held', COALESCE((
            SELECT sum(s.quantity) FROM public.stay_inventory_hold_slices s
            JOIN public.stay_inventory_holds h ON h.id = s.hold_id
            JOIN public.stay_place_windows w ON w.id = s.place_window_id
            WHERE s.offering_id = o.id AND w.local_date = v_date
              AND h.state = 'active' AND h.expires_at > now()), 0))
        ORDER BY o.sort_order, o.created_at)
      FROM public.stay_offerings o
      WHERE o.venue_id = p_venue_id AND o.kind NOT IN ('room', 'place') AND o.status IN ('live', 'paused')), '[]'::jsonb),
    'checkIn', (
      SELECT jsonb_build_object(
        'passes', count(*),
        'expected', COALESCE(sum(p.admits) FILTER (WHERE p.status = 'valid'), 0),
        'admitted', COALESCE(sum(p.admitted_count), 0))
      FROM public.venue_passes p WHERE p.venue_id = p_venue_id AND p.valid_local_date = v_date),
    'bookings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'groupId', g.id, 'reference', g.public_reference, 'state', g.state,
          'guestName', g.guest_snapshot->>'name', 'guests', (SELECT sum(l.place_guests)
            FROM public.stay_reservation_lines l WHERE l.group_id = g.id),
          'totalMinor', g.total_minor, 'currencyCode', g.currency_code,
          'source', g.booking_source, 'paymentCollection', g.payment_collection,
          'admittedCount', (SELECT p.admitted_count FROM public.venue_passes p WHERE p.group_id = g.id),
          'createdAt', g.created_at)
        ORDER BY g.created_at DESC)
      FROM public.stay_reservation_groups g
      WHERE g.venue_id = p_venue_id AND g.offer_kind IS NOT NULL
        AND g.state IN ('confirmed', 'partially_cancelled', 'cancelled', 'reconciliation_required', 'instant_payment_pending')
        AND (g.payment_plan_snapshot->>'localDate')::date = v_date), '[]'::jsonb)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.issue_4490_guard_check_in_log(),
  public.issue_4490_assert_check_in(uuid, uuid),
  public.issue_4490_venue_local_date(uuid),
  public.issue_4490_pass_view(uuid),
  public.issue_4490_log_check_in(public.venue_listings, uuid, uuid, uuid, text, integer, text, uuid, jsonb, uuid),
  public.issue_4490_admit_pass(public.venue_listings, uuid, integer, boolean, uuid, text),
  public.issue_4490_check_in_scan(uuid, text, integer, boolean, uuid, text),
  public.issue_4490_check_in_admit(uuid, uuid, integer, boolean, uuid),
  public.issue_4490_check_in_undo(uuid, uuid, uuid),
  public.issue_4490_check_in_list(uuid, date, uuid),
  public.issue_4490_gate_sale(uuid, uuid, jsonb, text, jsonb, text, uuid, uuid, bytea),
  public.issue_4490_venue_day(uuid, date)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_check_in_scan(uuid, text, integer, boolean, uuid, text),
  public.issue_4490_check_in_admit(uuid, uuid, integer, boolean, uuid),
  public.issue_4490_check_in_undo(uuid, uuid, uuid),
  public.issue_4490_check_in_list(uuid, date, uuid),
  public.issue_4490_gate_sale(uuid, uuid, jsonb, text, jsonb, text, uuid, uuid, bytea),
  public.issue_4490_venue_local_date(uuid),
  public.issue_4490_pass_view(uuid)
TO service_role;
GRANT EXECUTE ON FUNCTION public.issue_4490_venue_day(uuid, date) TO authenticated, service_role;

COMMIT;
