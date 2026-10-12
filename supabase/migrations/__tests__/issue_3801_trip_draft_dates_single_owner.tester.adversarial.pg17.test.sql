\set ON_ERROR_STOP on

-- Issue #3801 — independent tester attack on "a draft trip's dates have ONE
-- owner". Run after the full migration chain on PostgreSQL 17, from a checkout
-- of the repository (section H reads the migration file through git).
--
-- The implementor suite walks the journeys the wizard takes. This file does
-- not. It states the rule once, as a function, and then tries to break it:
--
--   pg_temp.disagreement(event) IS NULL  <=>
--     the theme holds a complete, readable, in-order pair of dates and there is
--     exactly ONE master event_dates row carrying those same two instants,
--     OR the theme holds no such pair and there is NO master row at all.
--
-- That must hold after ANY patch that names a date and carries no explicit
-- `event_dates` group, whatever the patch looks like. Sections:
--   A. partial patches — one key at a time, cleared, blank, equal, offsets
--   B. hostile values  — every one is either refused cleanly or obeys the rule
--   C. old unreadable text in a draft does not block an unrelated save, and
--      does not publish
--   D. the revision check and the operation-id replay still bind
--   E. another organiser and a signed-out caller change nothing; grants
--   F. a published trip is out of reach of the draft command
--   G. publish never prefers theme dates over a master row that exists, and
--      never publishes a half-set or out-of-order pair
--   H. the backfill, run from the migration's own text, touches only what it
--      says it touches
--
-- NULL-safety: comparisons whose left side can be NULL use IS DISTINCT FROM.

BEGIN;

SELECT set_config('request.jwt.claim.sub', '38011000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO auth.users(id) VALUES
  ('38011000-0000-4000-8000-000000000001'),
  ('38011000-0000-4000-8000-000000000002');
INSERT INTO public.creator_accounts(id) VALUES
  ('38011000-0000-4000-8000-000000000001'),
  ('38011000-0000-4000-8000-000000000002');

INSERT INTO public.brands(id, account_id, name, slug, default_currency)
VALUES (
  '38011000-0000-4000-8000-000000000010',
  '38011000-0000-4000-8000-000000000001',
  'Issue 3801 tester',
  'issue-3801-tester',
  'GBP'
);

CREATE FUNCTION pg_temp.iso(p timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"')
$$;

CREATE FUNCTION pg_temp.rev(p_event uuid) RETURNS timestamptz
LANGUAGE sql AS $$ SELECT updated_at FROM public.events WHERE id = p_event $$;

CREATE FUNCTION pg_temp.new_draft() RETURNS uuid
LANGUAGE sql AS $$
  SELECT (public.biz_create_trip_draft(
    '38011000-0000-4000-8000-000000000010',
    jsonb_build_object('title', 'Untitled trip'),
    gen_random_uuid())#>>'{event,id}')::uuid
$$;

-- A patch shaped the way `updateTripBasics` shapes it: an `event` group whose
-- only content is `business_trip`. Never an `event_dates` group.
CREATE FUNCTION pg_temp.patch_trip(p_event uuid, p_business_trip jsonb) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.biz_apply_trip_draft_graph(
    p_event,
    jsonb_build_object('event', jsonb_build_object('business_trip', p_business_trip)),
    pg_temp.rev(p_event),
    gen_random_uuid());
END $$;

-- THE RULE. NULL when the theme and the master row agree; otherwise a sentence
-- saying how they disagree.
CREATE FUNCTION pg_temp.disagreement(p_event uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_start_text text; v_end_text text;
  v_start timestamptz; v_end timestamptz;
  v_masters integer;
  v_row public.event_dates%ROWTYPE;
BEGIN
  SELECT NULLIF(btrim(theme#>>'{business_trip,startAt}'), ''),
         NULLIF(btrim(theme#>>'{business_trip,endAt}'), '')
    INTO v_start_text, v_end_text
    FROM public.events WHERE id = p_event;
  SELECT count(*) INTO v_masters
    FROM public.event_dates WHERE event_id = p_event AND is_master = true;
  BEGIN
    v_start := v_start_text::timestamptz;
    v_end := v_end_text::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    v_start := NULL; v_end := NULL;
  END;

  IF v_start IS NOT NULL AND v_end IS NOT NULL AND v_end > v_start THEN
    IF v_masters <> 1 THEN
      RETURN format('theme holds %s to %s but there are %s master rows',
        v_start_text, v_end_text, v_masters);
    END IF;
    SELECT * INTO v_row FROM public.event_dates
     WHERE event_id = p_event AND is_master = true;
    IF v_row.start_at IS DISTINCT FROM v_start OR v_row.end_at IS DISTINCT FROM v_end THEN
      RETURN format('theme holds %s to %s but the master row holds %s to %s',
        v_start, v_end, v_row.start_at, v_row.end_at);
    END IF;
    RETURN NULL;
  END IF;

  IF v_masters <> 0 THEN
    RETURN format('theme holds no publishable pair (%s to %s) but %s master row(s) remain',
      COALESCE(v_start_text, 'null'), COALESCE(v_end_text, 'null'), v_masters);
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION pg_temp.must_agree(p_event uuid, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_fault text := pg_temp.disagreement(p_event);
BEGIN
  IF v_fault IS NOT NULL THEN RAISE EXCEPTION '% %', p_label, v_fault; END IF;
END $$;

CREATE FUNCTION pg_temp.masters(p_event uuid) RETURNS integer
LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.event_dates WHERE event_id = p_event AND is_master = true
$$;

-- A fingerprint of everything a refused call must leave alone.
CREATE FUNCTION pg_temp.fingerprint(p_event uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT md5(
    (SELECT COALESCE(theme::text, '') || '|' || updated_at::text || '|' || status
            || '|' || timezone || '|' || COALESCE(title, '')
       FROM public.events WHERE id = p_event)
    || '|' ||
    COALESCE((SELECT string_agg(
        id::text || start_at::text || end_at::text || timezone || is_master::text, ','
        ORDER BY id)
       FROM public.event_dates WHERE event_id = p_event), 'none'))
$$;

CREATE TEMP TABLE t3801t_dates AS
SELECT
  date_trunc('day', now() + interval '60 days') AS start_at,
  date_trunc('day', now() + interval '63 days') + interval '23 hours 59 minutes 59 seconds' AS end_at,
  date_trunc('day', now() + interval '90 days') AS other_start_at,
  date_trunc('day', now() + interval '95 days') + interval '23 hours 59 minutes 59 seconds' AS other_end_at;

-- ---------------------------------------------------------------------------
-- A. Partial patches. The wizard sends both keys; nothing obliges a caller to.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid := pg_temp.new_draft();
  v_start timestamptz; v_end timestamptz; v_other_start timestamptz; v_other_end timestamptz;
  v_row public.event_dates%ROWTYPE;
BEGIN
  SELECT start_at, end_at, other_start_at, other_end_at
    INTO v_start, v_end, v_other_start, v_other_end FROM t3801t_dates;

  -- A-1 start only, on a draft with no dates at all: nothing to own yet.
  PERFORM pg_temp.patch_trip(v_event, jsonb_build_object('startAt', pg_temp.iso(v_start)));
  PERFORM pg_temp.must_agree(v_event, 'A-01');
  IF pg_temp.masters(v_event) <> 0 THEN RAISE EXCEPTION 'A-02 a start date alone produced a master row'; END IF;

  -- A-2 the end arrives in a SEPARATE patch: the pair is now complete in the
  -- merged theme, so the master row must appear although this patch named
  -- only one of the two dates. THE CORE CASE — fails on revert.
  PERFORM pg_temp.patch_trip(v_event, jsonb_build_object('endAt', pg_temp.iso(v_end)));
  PERFORM pg_temp.must_agree(v_event, 'A-03');
  IF pg_temp.masters(v_event) <> 1 THEN
    RAISE EXCEPTION 'A-04 completing the pair across two patches left % master row(s), expected 1', pg_temp.masters(v_event);
  END IF;

  -- A-3 move the start only; the stored end is kept and the row follows.
  PERFORM pg_temp.patch_trip(v_event, jsonb_build_object('startAt', pg_temp.iso(v_start + interval '1 day')));
  PERFORM pg_temp.must_agree(v_event, 'A-05');
  SELECT * INTO v_row FROM public.event_dates WHERE event_id = v_event AND is_master = true;
  IF v_row.start_at IS DISTINCT FROM v_start + interval '1 day' OR v_row.end_at IS DISTINCT FROM v_end THEN
    RAISE EXCEPTION 'A-06 a start-only change stored % to %', v_row.start_at, v_row.end_at;
  END IF;

  -- A-4 the same instant written with a non-UTC offset is the same instant.
  PERFORM pg_temp.patch_trip(v_event, jsonb_build_object(
    'startAt', to_char(v_start AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS') || '+05:30'));
  PERFORM pg_temp.must_agree(v_event, 'A-07');
  SELECT * INTO v_row FROM public.event_dates WHERE event_id = v_event AND is_master = true;
  IF v_row.start_at IS DISTINCT FROM v_start THEN
    RAISE EXCEPTION 'A-08 an offset-qualified start was stored as %, expected %', v_row.start_at, v_start;
  END IF;

  -- A-5 end moved ONTO the start (zero-length trip): not a publishable pair.
  PERFORM pg_temp.patch_trip(v_event, jsonb_build_object('endAt', pg_temp.iso(v_start)));
  PERFORM pg_temp.must_agree(v_event, 'A-09');
  IF pg_temp.masters(v_event) <> 0 THEN RAISE EXCEPTION 'A-10 a zero-length trip kept a master row'; END IF;

  -- A-6 put it back, then clear ONE side only, each way round, each spelling
  -- of "empty" a client can send: JSON null, empty string, whitespace.
  PERFORM pg_temp.patch_trip(v_event, jsonb_build_object('endAt', pg_temp.iso(v_end)));
  IF pg_temp.masters(v_event) <> 1 THEN RAISE EXCEPTION 'A-11 restoring the end did not restore the master row'; END IF;
  PERFORM pg_temp.patch_trip(v_event, jsonb_build_object('endAt', NULL));
  PERFORM pg_temp.must_agree(v_event, 'A-12');
  IF pg_temp.masters(v_event) <> 0 THEN RAISE EXCEPTION 'A-13 clearing only the end kept a master row'; END IF;

  PERFORM pg_temp.patch_trip(v_event, jsonb_build_object('endAt', pg_temp.iso(v_end)));
  PERFORM pg_temp.patch_trip(v_event, jsonb_build_object('startAt', ''));
  PERFORM pg_temp.must_agree(v_event, 'A-14');
  IF pg_temp.masters(v_event) <> 0 THEN RAISE EXCEPTION 'A-15 an empty-string start kept a master row'; END IF;

  PERFORM pg_temp.patch_trip(v_event, jsonb_build_object('startAt', pg_temp.iso(v_start)));
  PERFORM pg_temp.patch_trip(v_event, jsonb_build_object('endAt', '   '));
  PERFORM pg_temp.must_agree(v_event, 'A-16');
  IF pg_temp.masters(v_event) <> 0 THEN RAISE EXCEPTION 'A-17 a whitespace end kept a master row'; END IF;

  -- A-7 a patch naming a date key whose value is UNCHANGED still obeys the
  -- rule (the row is rewritten, never doubled).
  PERFORM pg_temp.patch_trip(v_event, jsonb_build_object('endAt', pg_temp.iso(v_end)));
  PERFORM pg_temp.patch_trip(v_event, jsonb_build_object(
    'startAt', pg_temp.iso(v_start), 'endAt', pg_temp.iso(v_end)));
  PERFORM pg_temp.patch_trip(v_event, jsonb_build_object(
    'startAt', pg_temp.iso(v_start), 'endAt', pg_temp.iso(v_end)));
  PERFORM pg_temp.must_agree(v_event, 'A-18');
  IF (SELECT count(*) FROM public.event_dates WHERE event_id = v_event) <> 1 THEN
    RAISE EXCEPTION 'A-19 repeating the same dates left % date row(s)',
      (SELECT count(*) FROM public.event_dates WHERE event_id = v_event);
  END IF;

  -- A-8 the trip's timezone changes IN THE SAME PATCH as its dates. The wizard
  -- stores UTC midnight / 23:59:59, so the instants must not move, and the row
  -- must be labelled with the NEW timezone, not the one read before the write.
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('event', jsonb_build_object(
      'timezone', 'Pacific/Kiritimati',
      'business_trip', jsonb_build_object(
        'startAt', pg_temp.iso(v_other_start), 'endAt', pg_temp.iso(v_other_end)))),
    pg_temp.rev(v_event), gen_random_uuid());
  PERFORM pg_temp.must_agree(v_event, 'A-20');
  SELECT * INTO v_row FROM public.event_dates WHERE event_id = v_event AND is_master = true;
  IF v_row.start_at IS DISTINCT FROM v_other_start OR v_row.end_at IS DISTINCT FROM v_other_end THEN
    RAISE EXCEPTION 'A-21 a timezone change moved the instants to % .. %', v_row.start_at, v_row.end_at;
  END IF;
  IF v_row.timezone IS DISTINCT FROM 'Pacific/Kiritimati' THEN
    RAISE EXCEPTION 'A-22 the master row is labelled %, expected the timezone saved in the same patch', v_row.timezone;
  END IF;

  -- A-9 a timezone-only save afterwards must not move or drop the instants.
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('event', jsonb_build_object('timezone', 'America/Adak')),
    pg_temp.rev(v_event), gen_random_uuid());
  PERFORM pg_temp.must_agree(v_event, 'A-23');
  SELECT * INTO v_row FROM public.event_dates WHERE event_id = v_event AND is_master = true;
  IF v_row.start_at IS DISTINCT FROM v_other_start OR v_row.end_at IS DISTINCT FROM v_other_end THEN
    RAISE EXCEPTION 'A-24 a timezone-only save moved the instants to % .. %', v_row.start_at, v_row.end_at;
  END IF;

  -- A-10 a non-master row written through the explicit group is not a master
  -- row and must not be counted, promoted or doubled by a later dates save.
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('event_dates', jsonb_build_array(
      jsonb_build_object('start_at', v_start::text, 'end_at', v_end::text, 'is_master', true),
      jsonb_build_object('start_at', v_other_start::text, 'end_at', v_other_end::text, 'is_master', false))),
    pg_temp.rev(v_event), gen_random_uuid());
  PERFORM pg_temp.patch_trip(v_event, jsonb_build_object(
    'startAt', pg_temp.iso(v_start + interval '2 days'), 'endAt', pg_temp.iso(v_end + interval '2 days')));
  PERFORM pg_temp.must_agree(v_event, 'A-25');
  IF pg_temp.masters(v_event) <> 1 THEN RAISE EXCEPTION 'A-26 % master rows after a dates save over a mixed set', pg_temp.masters(v_event); END IF;
END $$;

-- ---------------------------------------------------------------------------
-- B. Hostile values. Each is tried as the start and as the end. The only two
--    acceptable outcomes are: refused with 22023 `trip_dates_invalid` and
--    NOTHING changed, or accepted with the rule still holding. Any other
--    SQLSTATE means a raw cast error can reach the organiser.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid := pg_temp.new_draft();
  v_start timestamptz; v_end timestamptz;
  v_value jsonb; v_side text; v_before text;
  v_refused integer := 0; v_accepted integer := 0;
  v_state text; v_message text;
BEGIN
  SELECT start_at, end_at INTO v_start, v_end FROM t3801t_dates;
  PERFORM pg_temp.patch_trip(v_event, jsonb_build_object(
    'startAt', pg_temp.iso(v_start), 'endAt', pg_temp.iso(v_end)));
  PERFORM pg_temp.must_agree(v_event, 'B-00');

  FOR v_value IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
      'not-a-date', 'next tuesday-ish', '2027-13-45T00:00:00Z', '2027-02-30',
      '2027-06-01 24:00:01', '99999999-01-01', '294277-01-01T00:00:00Z',
      '4714-11-23 BC', '2027-01-01T00:00:00 Mars/Phobos', '0000-00-00',
      '2027-06-01T00:00:00Z; DROP TABLE public.events', repeat('9', 4000),
      repeat('2027-06-01T00:00:00Z ', 50), '１２３', 'J2451187',
      5, 20270601, -1, 1e40, true, false,
      jsonb_build_object('startAt', '2027-06-01'), jsonb_build_array('2027-06-01'),
      'infinity', '-infinity', 'epoch', '2027-06-01T00:00:00+14:00',
      '2027-06-01T00:00:00-12:00', E'\n2027-06-01T00:00:00Z\t'))
  LOOP
    FOREACH v_side IN ARRAY ARRAY['startAt', 'endAt'] LOOP
      -- Reset to a known good pair so each attempt starts from the same state.
      PERFORM pg_temp.patch_trip(v_event, jsonb_build_object(
        'startAt', pg_temp.iso(v_start), 'endAt', pg_temp.iso(v_end)));
      v_before := pg_temp.fingerprint(v_event);
      BEGIN
        PERFORM pg_temp.patch_trip(v_event, jsonb_build_object(v_side, v_value));
        v_accepted := v_accepted + 1;
        PERFORM pg_temp.must_agree(v_event, format('B-01 %s=%s was accepted and', v_side, left(v_value::text, 60)));
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
        IF v_state <> '22023' OR v_message <> 'trip_dates_invalid' THEN
          RAISE EXCEPTION 'B-02 %=% escaped as SQLSTATE % (%) instead of trip_dates_invalid',
            v_side, left(v_value::text, 60), v_state, v_message;
        END IF;
        v_refused := v_refused + 1;
        IF pg_temp.fingerprint(v_event) IS DISTINCT FROM v_before THEN
          RAISE EXCEPTION 'B-03 a refused %=% still changed the draft', v_side, left(v_value::text, 60);
        END IF;
      END;
    END LOOP;
  END LOOP;

  IF v_refused = 0 THEN RAISE EXCEPTION 'B-04 no hostile value was refused: the validation is not running'; END IF;
  RAISE NOTICE 'issue #3801 tester B: % hostile value(s) refused cleanly, % accepted with the rule intact',
    v_refused, v_accepted;
END $$;

-- ---------------------------------------------------------------------------
-- C. Unreadable text already sitting in an OLD draft. It is not this save's
--    fault: an unrelated save must go through, must not invent a master row,
--    and the trip must not publish.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid := pg_temp.new_draft();
  v_end timestamptz;
  v_published boolean := false; v_result jsonb; v_status text;
BEGIN
  SELECT end_at INTO v_end FROM t3801t_dates;
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object(
      'event', jsonb_build_object('title', 'Old draft',
        'business_trip', jsonb_build_object('destinationLocationText', 'Accra, Ghana')),
      'days', jsonb_build_array(jsonb_build_object('ordinal', 1, 'title', 'Arrival'))),
    pg_temp.rev(v_event), gen_random_uuid());
  UPDATE public.events
     SET theme = jsonb_set(jsonb_set(theme, '{business_trip,startAt}', '"sometime in June"'),
                           '{business_trip,endAt}', to_jsonb(pg_temp.iso(v_end)))
   WHERE id = v_event;

  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('event', jsonb_build_object('description', 'Edited after the fix')),
    pg_temp.rev(v_event), gen_random_uuid());
  IF (SELECT description FROM public.events WHERE id = v_event) IS DISTINCT FROM 'Edited after the fix' THEN
    RAISE EXCEPTION 'C-01 an unrelated save on a draft with old unreadable dates did not land';
  END IF;
  IF pg_temp.masters(v_event) <> 0 THEN RAISE EXCEPTION 'C-02 unreadable theme dates produced a master row'; END IF;
  IF (SELECT theme#>>'{business_trip,startAt}' FROM public.events WHERE id = v_event)
       IS DISTINCT FROM 'sometime in June' THEN
    RAISE EXCEPTION 'C-03 an unrelated save rewrote the stored start text';
  END IF;

  BEGIN
    v_result := public.biz_publish_trip_command(v_event, pg_temp.rev(v_event), gen_random_uuid());
    v_published := COALESCE((v_result->>'ok')::boolean, true);
  EXCEPTION WHEN OTHERS THEN
    v_published := false;
  END;
  SELECT status INTO v_status FROM public.events WHERE id = v_event;
  IF v_published OR v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'C-04 a draft with an unreadable start date published (status %)', v_status;
  END IF;
  IF (SELECT count(*) FROM public.event_dates WHERE event_id = v_event) <> 0 THEN
    RAISE EXCEPTION 'C-05 a refused publish left a date row behind';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- D. Race and replay. The revision check and the operation-id receipt are
--    older than this fix; the new writes sit behind both and must stay there.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid := pg_temp.new_draft();
  v_start timestamptz; v_end timestamptz; v_other_start timestamptz; v_other_end timestamptz;
  v_rev_a timestamptz; v_stale timestamptz; v_before text; v_first jsonb; v_replayed jsonb;
  v_op_a uuid := '38011000-0000-4000-8000-0000000000d1';
  v_row public.event_dates%ROWTYPE;
BEGIN
  SELECT start_at, end_at, other_start_at, other_end_at
    INTO v_start, v_end, v_other_start, v_other_end FROM t3801t_dates;

  -- Operation A writes the first pair, under a fixed operation id.
  -- This whole file is one transaction, so now() — and with it
  -- events.updated_at — does not advance between calls. A revision "from
  -- before" is therefore modelled as what it is to the server: a timestamp
  -- that is not the row's current one.
  v_rev_a := pg_temp.rev(v_event);
  v_stale := v_rev_a - interval '1 second';
  v_first := public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
      'startAt', pg_temp.iso(v_start), 'endAt', pg_temp.iso(v_end)))),
    v_rev_a, v_op_a);
  PERFORM pg_temp.must_agree(v_event, 'D-00');

  -- D-1 a second writer still holding the OLD revision loses, and the row the
  -- first writer produced is not replaced by the loser's dates.
  v_before := pg_temp.fingerprint(v_event);
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,
      jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
        'startAt', pg_temp.iso(v_other_start), 'endAt', pg_temp.iso(v_other_end)))),
      v_stale, gen_random_uuid());
    RAISE EXCEPTION 'D-01 a stale revision was allowed to rewrite the dates';
  EXCEPTION WHEN sqlstate '40001' THEN
    IF SQLERRM <> 'trip_revision_conflict' THEN RAISE EXCEPTION 'D-02 stale revision raised %', SQLERRM; END IF;
  END;
  IF pg_temp.fingerprint(v_event) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'D-03 a refused stale write still changed the draft';
  END IF;

  -- D-2 no revision at all is refused the same way.
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,
      jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
        'startAt', NULL, 'endAt', NULL))),
      NULL, gen_random_uuid());
    RAISE EXCEPTION 'D-04 a patch with no revision cleared the dates';
  EXCEPTION WHEN sqlstate '40001' THEN NULL;
  END;
  IF pg_temp.fingerprint(v_event) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'D-05 a refused revision-less write still changed the draft';
  END IF;

  -- D-3 operation B moves the dates on. Then operation A is REPLAYED (same id,
  -- same arguments — a retry after a lost response). It must answer with its
  -- stored result and must NOT put the old dates back.
  PERFORM pg_temp.patch_trip(v_event, jsonb_build_object(
    'startAt', pg_temp.iso(v_other_start), 'endAt', pg_temp.iso(v_other_end)));
  v_before := pg_temp.fingerprint(v_event);
  v_replayed := public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
      'startAt', pg_temp.iso(v_start), 'endAt', pg_temp.iso(v_end)))),
    v_rev_a, v_op_a);
  IF v_replayed IS DISTINCT FROM v_first THEN RAISE EXCEPTION 'D-06 a replay did not return the stored result'; END IF;
  IF pg_temp.fingerprint(v_event) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'D-07 replaying an old operation rewrote the draft';
  END IF;
  SELECT * INTO v_row FROM public.event_dates WHERE event_id = v_event AND is_master = true;
  IF v_row.start_at IS DISTINCT FROM v_other_start OR v_row.end_at IS DISTINCT FROM v_other_end THEN
    RAISE EXCEPTION 'D-08 a replay resurrected the old dates (% to %)', v_row.start_at, v_row.end_at;
  END IF;
  PERFORM pg_temp.must_agree(v_event, 'D-09');

  -- D-4 the same operation id with DIFFERENT dates is not a replay.
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,
      jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
        'startAt', pg_temp.iso(v_start + interval '1 day'), 'endAt', pg_temp.iso(v_end)))),
      v_rev_a, v_op_a);
    RAISE EXCEPTION 'D-10 a reused operation id with new dates was accepted';
  EXCEPTION WHEN sqlstate '23505' THEN
    IF SQLERRM <> 'idempotency_conflict' THEN RAISE EXCEPTION 'D-11 reused operation id raised %', SQLERRM; END IF;
  END;
  IF pg_temp.fingerprint(v_event) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'D-12 a refused operation-id reuse still changed the draft';
  END IF;

  -- D-5 publish with a stale revision is refused and the trip stays a draft
  -- with its dates intact.
  BEGIN
    PERFORM public.biz_publish_trip_command(v_event, v_stale, gen_random_uuid());
    RAISE EXCEPTION 'D-13 publish accepted a stale revision';
  EXCEPTION WHEN sqlstate '40001' THEN NULL;
  END;
  IF pg_temp.fingerprint(v_event) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'D-14 a refused stale publish still changed the draft';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- E. Who may write the owner row. Both functions are SECURITY DEFINER, so the
--    new INSERT / DELETE on event_dates runs with the definer's rights: the
--    only thing between a stranger and another brand's dates is the manager
--    check, which must still run BEFORE the new block.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid := pg_temp.new_draft();
  v_start timestamptz; v_end timestamptz; v_other_start timestamptz; v_other_end timestamptz;
  v_before text; v_rev timestamptz; v_sig text; v_config text[];
BEGIN
  SELECT start_at, end_at, other_start_at, other_end_at
    INTO v_start, v_end, v_other_start, v_other_end FROM t3801t_dates;
  PERFORM pg_temp.patch_trip(v_event, jsonb_build_object(
    'startAt', pg_temp.iso(v_start), 'endAt', pg_temp.iso(v_end)));
  v_before := pg_temp.fingerprint(v_event);
  v_rev := pg_temp.rev(v_event);

  -- E-1 a signed-in organiser of a DIFFERENT account.
  PERFORM set_config('request.jwt.claim.sub', '38011000-0000-4000-8000-000000000002', true);
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,
      jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
        'startAt', pg_temp.iso(v_other_start), 'endAt', pg_temp.iso(v_other_end)))),
      v_rev, gen_random_uuid());
    RAISE EXCEPTION 'E-01 another account rewrote this trip''s dates';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM <> 'insufficient_event_permission' THEN RAISE EXCEPTION 'E-02 stranger raised %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.biz_publish_trip_command(v_event, v_rev, gen_random_uuid());
    RAISE EXCEPTION 'E-03 another account published this trip';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM <> 'insufficient_event_permission' THEN RAISE EXCEPTION 'E-04 stranger publish raised %', SQLERRM; END IF;
  END;

  -- E-2 no signed-in user at all.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,
      jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
        'startAt', NULL, 'endAt', NULL))),
      v_rev, gen_random_uuid());
    RAISE EXCEPTION 'E-05 a signed-out caller cleared this trip''s dates';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM <> 'authentication_required' THEN RAISE EXCEPTION 'E-06 signed-out raised %', SQLERRM; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub', '38011000-0000-4000-8000-000000000001', true);

  IF pg_temp.fingerprint(v_event) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'E-07 a refused caller still changed the draft';
  END IF;

  -- E-3 grants and definer settings, read from the catalogue. `anon` and
  -- PUBLIC hold nothing; the pinned search_path is exactly what it was.
  FOREACH v_sig IN ARRAY ARRAY[
    'public.biz_apply_trip_draft_graph(uuid, jsonb, timestamptz, uuid)',
    'public.biz_publish_trip_command(uuid, timestamptz, uuid, bigint, boolean)',
    'public.biz_publish_trip_command(uuid, timestamptz, uuid)'] LOOP
    IF has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'E-08 anon may execute %', v_sig;
    END IF;
    IF NOT has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'E-09 authenticated lost EXECUTE on %', v_sig;
    END IF;
    IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'E-10 service_role lost EXECUTE on %', v_sig;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
       WHERE p.oid = v_sig::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'E-11 PUBLIC may execute %', v_sig;
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_sig::regprocedure) THEN
      RAISE EXCEPTION 'E-12 % is no longer SECURITY DEFINER', v_sig;
    END IF;
  END LOOP;

  SELECT proconfig INTO v_config FROM pg_proc
   WHERE oid = 'public.biz_apply_trip_draft_graph(uuid, jsonb, timestamptz, uuid)'::regprocedure;
  IF v_config IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
    RAISE EXCEPTION 'E-13 the draft command search_path is now %', v_config;
  END IF;
  SELECT proconfig INTO v_config FROM pg_proc
   WHERE oid = 'public.biz_publish_trip_command(uuid, timestamptz, uuid, bigint, boolean)'::regprocedure;
  IF v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog'] THEN
    RAISE EXCEPTION 'E-14 the publish command search_path is now %', v_config;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- F + G. Publish. A master row that exists always wins over the theme; a
--    half-set or out-of-order pair never publishes through the new fallback;
--    and once a trip is published the draft command cannot reach its dates.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.publishable_draft(p_title text) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_event uuid := pg_temp.new_draft();
BEGIN
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object(
      'event', jsonb_build_object('title', p_title,
        'business_trip', jsonb_build_object('destinationLocationText', 'Lagos, Nigeria')),
      'days', jsonb_build_array(jsonb_build_object('ordinal', 1, 'title', 'Arrival'))),
    pg_temp.rev(v_event), gen_random_uuid());
  RETURN v_event;
END $$;

DO $$
DECLARE
  v_event uuid;
  v_start timestamptz; v_end timestamptz; v_other_start timestamptz; v_other_end timestamptz;
  v_result jsonb; v_status text; v_published boolean; v_before text;
  v_row public.event_dates%ROWTYPE; v_op uuid := '38011000-0000-4000-8000-0000000000f1';
  v_rev timestamptz;
BEGIN
  SELECT start_at, end_at, other_start_at, other_end_at
    INTO v_start, v_end, v_other_start, v_other_end FROM t3801t_dates;

  -- G-1 HALF-SET. A start with no end, no master row: publish must refuse.
  v_event := pg_temp.publishable_draft('Half set');
  PERFORM pg_temp.patch_trip(v_event, jsonb_build_object('startAt', pg_temp.iso(v_start)));
  v_published := false;
  BEGIN
    v_result := public.biz_publish_trip_command(v_event, pg_temp.rev(v_event), gen_random_uuid());
    v_published := COALESCE((v_result->>'ok')::boolean, true);
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM <> 'trip_dates_required' THEN RAISE EXCEPTION 'G-01 half-set dates refused with %', SQLERRM; END IF;
  END;
  IF v_published OR (SELECT status FROM public.events WHERE id = v_event) <> 'draft' THEN
    RAISE EXCEPTION 'G-02 a trip with only a start date published';
  END IF;

  -- G-2 OUT OF ORDER. The save is kept, the master row is not; publish reads
  -- the theme through the new fallback and must still refuse.
  v_event := pg_temp.publishable_draft('Out of order');
  PERFORM pg_temp.patch_trip(v_event, jsonb_build_object(
    'startAt', pg_temp.iso(v_end), 'endAt', pg_temp.iso(v_start)));
  IF pg_temp.masters(v_event) <> 0 THEN RAISE EXCEPTION 'G-03 out-of-order dates kept a master row'; END IF;
  v_published := false;
  BEGIN
    v_result := public.biz_publish_trip_command(v_event, pg_temp.rev(v_event), gen_random_uuid());
    v_published := COALESCE((v_result->>'ok')::boolean, true);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'trip_end_before_start' THEN RAISE EXCEPTION 'G-04 out-of-order dates refused with %', SQLERRM; END IF;
  END;
  IF v_published OR (SELECT status FROM public.events WHERE id = v_event) <> 'draft' THEN
    RAISE EXCEPTION 'G-05 a trip whose end is before its start published';
  END IF;
  IF (SELECT count(*) FROM public.event_dates WHERE event_id = v_event) <> 0 THEN
    RAISE EXCEPTION 'G-06 a refused out-of-order publish left a date row';
  END IF;

  -- G-3 MASTER BEATS THEME. One patch stores pair X in the master row (explicit
  -- group) and a DIFFERENT pair Y in the theme. Publish must go out with X: the
  -- fallback is for a missing row only, never a second opinion.
  v_event := pg_temp.publishable_draft('Master wins');
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object(
      'event', jsonb_build_object('business_trip', jsonb_build_object(
        'startAt', pg_temp.iso(v_other_start), 'endAt', pg_temp.iso(v_other_end))),
      'event_dates', jsonb_build_array(jsonb_build_object(
        'start_at', v_start::text, 'end_at', v_end::text, 'is_master', true))),
    pg_temp.rev(v_event), gen_random_uuid());
  IF pg_temp.disagreement(v_event) IS NULL THEN
    RAISE EXCEPTION 'G-07 could not stage a theme that differs from its master row';
  END IF;
  v_rev := pg_temp.rev(v_event);
  v_result := public.biz_publish_trip_command(v_event, v_rev, v_op);
  IF NOT COALESCE((v_result->>'ok')::boolean, true) THEN RAISE EXCEPTION 'G-08 publish was refused: %', v_result; END IF;
  SELECT status INTO v_status FROM public.events WHERE id = v_event;
  IF v_status IS NULL OR v_status NOT IN ('scheduled', 'live') THEN RAISE EXCEPTION 'G-09 status after publish is %', v_status; END IF;
  IF (SELECT count(*) FROM public.event_dates WHERE event_id = v_event) <> 1 THEN
    RAISE EXCEPTION 'G-10 the published trip has % date rows', (SELECT count(*) FROM public.event_dates WHERE event_id = v_event);
  END IF;
  SELECT * INTO v_row FROM public.event_dates WHERE event_id = v_event AND is_master = true;
  IF v_row.start_at IS DISTINCT FROM v_start OR v_row.end_at IS DISTINCT FROM v_end THEN
    RAISE EXCEPTION 'G-11 publish used the theme dates (% to %) over the master row (% to %)',
      v_row.start_at, v_row.end_at, v_start, v_end;
  END IF;
  -- ... and the differing theme pair did not survive anywhere: the publish
  -- owner strips the dates out of the stored theme (ORCH-0950), so the row is
  -- the only copy left.
  IF (SELECT theme#>>'{business_trip,startAt}' FROM public.events WHERE id = v_event)::timestamptz
       IS NOT DISTINCT FROM v_other_start THEN
    RAISE EXCEPTION 'G-12 the published trip still stores the theme pair that lost';
  END IF;

  -- F-1 NOT A DRAFT ANY MORE. The draft command must refuse, whatever the
  -- patch says about dates, and leave the published row alone.
  v_before := pg_temp.fingerprint(v_event);
  BEGIN
    PERFORM pg_temp.patch_trip(v_event, jsonb_build_object('startAt', NULL, 'endAt', NULL));
    RAISE EXCEPTION 'F-01 the draft command cleared a published trip''s dates';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM <> 'trip_not_draft' THEN RAISE EXCEPTION 'F-02 published trip raised %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM pg_temp.patch_trip(v_event, jsonb_build_object(
      'startAt', pg_temp.iso(v_other_start), 'endAt', pg_temp.iso(v_other_end)));
    RAISE EXCEPTION 'F-03 the draft command moved a published trip''s dates';
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM <> 'trip_not_draft' THEN RAISE EXCEPTION 'F-04 published trip raised %', SQLERRM; END IF;
  END;
  IF pg_temp.fingerprint(v_event) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'F-05 a refused draft patch still changed a published trip';
  END IF;

  -- F-2 the publish itself, replayed (same operation id and revision), answers
  -- from its receipt and changes nothing.
  IF public.biz_publish_trip_command(v_event, v_rev, v_op) IS DISTINCT FROM v_result THEN
    RAISE EXCEPTION 'F-06 a replayed publish did not return its stored result';
  END IF;
  IF pg_temp.fingerprint(v_event) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'F-07 a replayed publish changed the published trip';
  END IF;

  -- F-3 a SECOND, fresh publish of an already-published trip does not re-run
  -- the date write (it is refused by the publish owner).
  v_published := false;
  BEGIN
    v_result := public.biz_publish_trip_command(v_event, pg_temp.rev(v_event), gen_random_uuid());
    v_published := COALESCE((v_result->>'ok')::boolean, true);
  EXCEPTION WHEN OTHERS THEN
    v_published := false;
  END;
  IF v_published THEN RAISE EXCEPTION 'F-08 an already-published trip published again'; END IF;
  IF pg_temp.fingerprint(v_event) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'F-09 a refused re-publish changed the published trip';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- H. The backfill — the migration's OWN text, extracted and run again here
--    over fixtures in every shape it must leave alone. A copy pasted into this
--    file would test the copy.
-- ---------------------------------------------------------------------------
\set issue_3801_backfill `sed -n '/^DO \$backfill\$$/,/^\$backfill\$;$/p' "$(git rev-parse --show-toplevel)/supabase/migrations/20270818003801_issue_3801_trip_draft_dates_single_owner.sql"`

CREATE FUNCTION pg_temp.must(p_ok boolean, p_message text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

-- Fail closed: an empty or truncated extraction must not read as "ran clean".
SELECT pg_temp.must(
  position('INSERT INTO public.event_dates' IN :'issue_3801_backfill') > 0
  AND position('issue #3801 backfill' IN :'issue_3801_backfill') > 0
  AND right(btrim(:'issue_3801_backfill', E' \n'), 11) = '$backfill$;',
  'H-00 the backfill block could not be read out of the migration file');

CREATE TEMP TABLE t3801t_fix(label text PRIMARY KEY, event_id uuid NOT NULL);

DO $$
DECLARE
  v_start timestamptz; v_end timestamptz; v_other_start timestamptz; v_other_end timestamptz;
  v_event uuid; v_label text; v_theme jsonb;
BEGIN
  SELECT start_at, end_at, other_start_at, other_end_at
    INTO v_start, v_end, v_other_start, v_other_end FROM t3801t_dates;

  -- Legacy drafts: theme written directly, exactly as the pre-fix command left
  -- it, with no master row.
  FOR v_label, v_theme IN VALUES
    ('good',        jsonb_build_object('startAt', pg_temp.iso(v_start), 'endAt', pg_temp.iso(v_end))),
    ('unreadable',  jsonb_build_object('startAt', 'sometime in June', 'endAt', pg_temp.iso(v_end))),
    ('overflow',    jsonb_build_object('startAt', '2027-13-45T00:00:00Z', 'endAt', pg_temp.iso(v_end))),
    ('badzone',     jsonb_build_object('startAt', '2027-01-01T00:00:00 Mars/Phobos', 'endAt', pg_temp.iso(v_end))),
    ('reversed',    jsonb_build_object('startAt', pg_temp.iso(v_end), 'endAt', pg_temp.iso(v_start))),
    ('equal',       jsonb_build_object('startAt', pg_temp.iso(v_start), 'endAt', pg_temp.iso(v_start))),
    ('half',        jsonb_build_object('startAt', pg_temp.iso(v_start), 'endAt', NULL)),
    ('blank',       jsonb_build_object('startAt', '  ', 'endAt', pg_temp.iso(v_end))),
    ('numeric',     jsonb_build_object('startAt', 7, 'endAt', true)),
    ('deleted',     jsonb_build_object('startAt', pg_temp.iso(v_start), 'endAt', pg_temp.iso(v_end))),
    ('has_master',  jsonb_build_object('startAt', pg_temp.iso(v_start), 'endAt', pg_temp.iso(v_end))),
    ('cancelled',   jsonb_build_object('startAt', pg_temp.iso(v_start), 'endAt', pg_temp.iso(v_end)))
  LOOP
    v_event := pg_temp.new_draft();
    UPDATE public.events
       SET theme = jsonb_set(COALESCE(theme, '{}'::jsonb), '{business_trip}',
                             COALESCE(theme->'business_trip', '{}'::jsonb) || v_theme, true),
           timezone = 'Africa/Lagos'
     WHERE id = v_event;
    DELETE FROM public.event_dates WHERE event_id = v_event;
    INSERT INTO t3801t_fix VALUES (v_label, v_event);
  END LOOP;

  UPDATE public.events SET deleted_at = now()
   WHERE id = (SELECT event_id FROM t3801t_fix WHERE label = 'deleted');
  -- A draft whose master row DIFFERS from its theme: the row is the owner and
  -- the backfill must not "correct" it.
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  SELECT event_id, v_other_start, v_other_end, 'UTC', true FROM t3801t_fix WHERE label = 'has_master';
  -- A trip that is no longer a draft and (unusually) has no master row.
  UPDATE public.events SET status = 'cancelled'
   WHERE id = (SELECT event_id FROM t3801t_fix WHERE label = 'cancelled');
END $$;

CREATE TEMP TABLE t3801t_events_before AS
  SELECT id, updated_at, theme, status, deleted_at, timezone FROM public.events;
CREATE TEMP TABLE t3801t_dates_before AS
  SELECT * FROM public.event_dates;

:issue_3801_backfill

DO $$
DECLARE
  v_start timestamptz; v_end timestamptz;
  v_good uuid; v_new integer; v_row public.event_dates%ROWTYPE; v_label text;
BEGIN
  SELECT start_at, end_at INTO v_start, v_end FROM t3801t_dates;
  SELECT event_id INTO v_good FROM t3801t_fix WHERE label = 'good';

  -- H-1 no events row anywhere was written: not updated_at, not the theme.
  IF EXISTS (
    (SELECT id, updated_at, theme, status, deleted_at, timezone FROM public.events
     EXCEPT SELECT * FROM t3801t_events_before)
    UNION ALL
    (SELECT * FROM t3801t_events_before
     EXCEPT SELECT id, updated_at, theme, status, deleted_at, timezone FROM public.events)
  ) THEN
    RAISE EXCEPTION 'H-01 the backfill changed an events row';
  END IF;

  -- H-2 no existing date row was changed or removed.
  IF EXISTS (SELECT * FROM t3801t_dates_before EXCEPT SELECT * FROM public.event_dates) THEN
    RAISE EXCEPTION 'H-02 the backfill changed or removed an existing date row';
  END IF;

  -- H-3 among the fixtures, exactly ONE gained a row: the good legacy draft.
  -- (Counted over this file's fixtures, not the whole table, so a row another
  -- suite legitimately left in a shared database cannot fail this one.)
  SELECT count(*), string_agg(f.label, ', ') INTO v_new, v_label
    FROM public.event_dates d JOIN t3801t_fix f ON f.event_id = d.event_id
   WHERE NOT EXISTS (SELECT 1 FROM t3801t_dates_before b WHERE b.id = d.id);
  IF v_new <> 1 OR v_label IS DISTINCT FROM 'good' THEN
    RAISE EXCEPTION 'H-03 the backfill gave a row to % fixture(s) [%], expected only [good]', v_new, COALESCE(v_label, 'none');
  END IF;
  -- ... and across the WHOLE table, every row it added obeys its own contract:
  -- a master row, for a live (not deleted) DRAFT TRIP that had no master row.
  IF EXISTS (
    SELECT 1 FROM public.event_dates d JOIN public.events e ON e.id = d.event_id
     WHERE NOT EXISTS (SELECT 1 FROM t3801t_dates_before b WHERE b.id = d.id)
       AND (d.is_master IS DISTINCT FROM true
            OR e.event_type IS DISTINCT FROM 'trip'
            OR e.status IS DISTINCT FROM 'draft'
            OR e.deleted_at IS NOT NULL
            OR EXISTS (SELECT 1 FROM t3801t_dates_before b
                        WHERE b.event_id = d.event_id AND b.is_master = true))
  ) THEN
    RAISE EXCEPTION 'H-03b the backfill added a row outside its contract';
  END IF;
  SELECT * INTO v_row FROM public.event_dates WHERE event_id = v_good;
  IF NOT FOUND THEN RAISE EXCEPTION 'H-04 the good legacy draft was not backfilled'; END IF;
  IF v_row.is_master IS DISTINCT FROM true OR v_row.start_at IS DISTINCT FROM v_start
     OR v_row.end_at IS DISTINCT FROM v_end OR v_row.timezone IS DISTINCT FROM 'Africa/Lagos' THEN
    RAISE EXCEPTION 'H-05 the backfilled row is wrong: % to % tz % master %',
      v_row.start_at, v_row.end_at, v_row.timezone, v_row.is_master;
  END IF;
  PERFORM pg_temp.must_agree(v_good, 'H-06');
END $$;

-- H-4 idempotent: a second run adds nothing and changes nothing.
CREATE TEMP TABLE t3801t_dates_after_first AS SELECT * FROM public.event_dates;

:issue_3801_backfill

DO $$
BEGIN
  IF EXISTS (
    (SELECT * FROM public.event_dates EXCEPT SELECT * FROM t3801t_dates_after_first)
    UNION ALL
    (SELECT * FROM t3801t_dates_after_first EXCEPT SELECT * FROM public.event_dates)
  ) THEN
    RAISE EXCEPTION 'H-07 a second backfill run changed the date rows';
  END IF;
  IF EXISTS (
    SELECT id, updated_at, theme, status, deleted_at, timezone FROM public.events
    EXCEPT SELECT * FROM t3801t_events_before
  ) THEN
    RAISE EXCEPTION 'H-08 a second backfill run changed an events row';
  END IF;
END $$;

ROLLBACK;
