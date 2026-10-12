\set ON_ERROR_STOP on

-- Issue #3801 — implementor proof that a trip's dates have ONE owner while it
-- is a draft: the master `event_dates` row. Run after the full migration chain
-- on PostgreSQL 17.
--
-- THE BUG. No trip could be published. The wizard saves its dates as startAt /
-- endAt inside `event.business_trip` and never sends an `event_dates` group.
-- The draft-graph command wrote those dates to the theme only; the publish
-- command read them from the master `event_dates` row, found none, replaced the
-- theme's dates with null and the publish owner answered `trip_dates_required`.
--
-- WHY THIS FILE EXISTS ALONGSIDE THE #1971 HAPPY PATH. That suite gives its
-- draft a date through an explicit `event_dates` group (its section F). No
-- shipped client does that, which is exactly how this defect stayed green. Every
-- patch below is shaped the way `tripsService.ts` shapes it:
--   * `updateTripBasics`      -> { event: { title, business_trip: {...} } }
--   * `upsertTripDays`        -> { days: [...] }
--   * `publishTrip`           -> { event: {...} } then `biz_publish_trip_command`
-- Dates are ISO-8601 UTC strings, the shape `Date#toISOString()` produces.
--
-- NULL-safety: every comparison whose left side can be NULL uses
-- `IS DISTINCT FROM`; `count(*)` comparisons cannot be NULL.

BEGIN;

SELECT set_config('request.jwt.claim.sub', '38010000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO auth.users(id) VALUES ('38010000-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id) VALUES ('38010000-0000-4000-8000-000000000001');

-- A brand with NO bank and NO payment provider: a free trip must publish from
-- it, which is the exact case reproduced on the issue.
INSERT INTO public.brands(id, account_id, name, slug, default_currency)
VALUES (
  '38010000-0000-4000-8000-000000000010',
  '38010000-0000-4000-8000-000000000001',
  'Issue 3801',
  'issue-3801',
  'GBP'
);

-- The dates every section uses, as the client sends them.
CREATE TEMP TABLE t3801_dates AS
SELECT
  date_trunc('second', now() + interval '60 days') AS start_at,
  date_trunc('second', now() + interval '63 days') AS end_at,
  date_trunc('second', now() + interval '90 days') AS other_start_at,
  date_trunc('second', now() + interval '95 days') AS other_end_at;

CREATE FUNCTION pg_temp.iso(p timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"')
$$;

CREATE FUNCTION pg_temp.rev(p_event uuid) RETURNS timestamptz
LANGUAGE sql AS $$ SELECT updated_at FROM public.events WHERE id = p_event $$;

-- ---------------------------------------------------------------------------
-- A. The real journey: create, save basics the way the wizard does, publish.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t3801_a AS
SELECT (public.biz_create_trip_draft(
  '38010000-0000-4000-8000-000000000010',
  jsonb_build_object('title', 'Untitled trip'),
  '38010000-0000-4000-8000-0000000000a1'
)#>>'{event,id}')::uuid AS event_id;

DO $$
DECLARE
  v_event uuid;
  v_start timestamptz; v_end timestamptz;
  v_count integer; v_row public.event_dates%ROWTYPE;
  v_result jsonb; v_status text; v_tz text;
BEGIN
  SELECT event_id INTO v_event FROM t3801_a;
  SELECT start_at, end_at INTO v_start, v_end FROM t3801_dates;
  IF v_event IS NULL THEN RAISE EXCEPTION 'A-00 create returned no event'; END IF;

  SELECT count(*) INTO v_count FROM public.event_dates WHERE event_id = v_event;
  IF v_count <> 0 THEN RAISE EXCEPTION 'A-01 a new draft already has % date row(s)', v_count; END IF;

  -- Step 1 Continue: `updateTripBasics`. No `event_dates` key, ever.
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('event', jsonb_build_object(
      'title', 'Lisbon long weekend',
      'cover_media_url', NULL,
      'cover_media_type', NULL,
      'cover_media_gallery', '[]'::jsonb,
      'business_trip', jsonb_build_object(
        'startAt', pg_temp.iso(v_start),
        'endAt', pg_temp.iso(v_end),
        'destinationPlaceId', 'place.lisbon',
        'destinationLocationText', 'Lisbon, Portugal',
        'destinationLat', 38.72,
        'destinationLng', -9.14,
        'departurePlaceId', NULL,
        'departureLocationText', NULL,
        'departureLat', NULL,
        'departureLng', NULL))),
    pg_temp.rev(v_event),
    '38010000-0000-4000-8000-0000000000a2');

  -- THE SAVE ITSELF now owns the master row. This is what makes the wizard
  -- reopen with its dates filled, before publish is ever pressed.
  SELECT count(*) INTO v_count FROM public.event_dates WHERE event_id = v_event;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'A-02 saving dates the way the wizard does left % event_dates row(s), expected 1', v_count;
  END IF;
  SELECT * INTO v_row FROM public.event_dates WHERE event_id = v_event;
  IF v_row.is_master IS DISTINCT FROM true THEN RAISE EXCEPTION 'A-03 the saved date row is not the master row'; END IF;
  IF v_row.start_at IS DISTINCT FROM v_start THEN RAISE EXCEPTION 'A-04 master start % is not the saved start %', v_row.start_at, v_start; END IF;
  IF v_row.end_at IS DISTINCT FROM v_end THEN RAISE EXCEPTION 'A-05 master end % is not the saved end %', v_row.end_at, v_end; END IF;
  SELECT timezone INTO v_tz FROM public.events WHERE id = v_event;
  IF v_row.timezone IS DISTINCT FROM v_tz THEN RAISE EXCEPTION 'A-06 master timezone % is not the trip timezone %', v_row.timezone, v_tz; END IF;

  -- The theme still carries the same dates: the two are written together.
  IF ((SELECT theme#>>'{business_trip,startAt}' FROM public.events WHERE id = v_event))::timestamptz
       IS DISTINCT FROM v_start THEN
    RAISE EXCEPTION 'A-07 the theme start drifted from the master row';
  END IF;

  -- Step 2 Continue: `upsertTripDays`. A patch with no `event` group must not
  -- disturb the dates.
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('days', jsonb_build_array(
      jsonb_build_object('ordinal', 1, 'title', 'Arrival'))),
    pg_temp.rev(v_event),
    '38010000-0000-4000-8000-0000000000a3');
  SELECT count(*) INTO v_count FROM public.event_dates
   WHERE event_id = v_event AND is_master = true AND start_at = v_start AND end_at = v_end;
  IF v_count <> 1 THEN RAISE EXCEPTION 'A-08 a days-only save disturbed the master date row'; END IF;

  -- Publish, exactly as `publishTrip` does: commit the pending Step-1 state
  -- (same shape, dates included), then the command with a fresh revision.
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('event', jsonb_build_object(
      'title', 'Lisbon long weekend',
      'timezone', v_tz,
      'cover_media_gallery', '[]'::jsonb,
      'business_trip', jsonb_build_object(
        'startAt', pg_temp.iso(v_start),
        'endAt', pg_temp.iso(v_end),
        'destinationPlaceId', 'place.lisbon',
        'destinationLocationText', 'Lisbon, Portugal',
        'destinationLat', 38.72,
        'destinationLng', -9.14))),
    pg_temp.rev(v_event),
    '38010000-0000-4000-8000-0000000000a4');

  v_result := public.biz_publish_trip_command(
    v_event, pg_temp.rev(v_event), '38010000-0000-4000-8000-0000000000a5');

  IF NOT COALESCE((v_result->>'ok')::boolean, true) THEN
    RAISE EXCEPTION 'A-09 publish was refused: %', v_result;
  END IF;
  SELECT status INTO v_status FROM public.events WHERE id = v_event;
  IF v_status IS NULL OR v_status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'A-10 a trip saved the way the wizard saves it did not publish, status=% result=%', v_status, v_result;
  END IF;

  SELECT count(*) INTO v_count FROM public.event_dates WHERE event_id = v_event AND is_master = true;
  IF v_count <> 1 THEN RAISE EXCEPTION 'A-11 the published trip has % master date row(s), expected exactly 1', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.event_dates WHERE event_id = v_event;
  IF v_count <> 1 THEN RAISE EXCEPTION 'A-12 the published trip has % date row(s), expected exactly 1', v_count; END IF;
  SELECT * INTO v_row FROM public.event_dates WHERE event_id = v_event AND is_master = true;
  IF v_row.start_at IS DISTINCT FROM v_start OR v_row.end_at IS DISTINCT FROM v_end THEN
    RAISE EXCEPTION 'A-13 the published dates (% to %) are not the dates entered (% to %)',
      v_row.start_at, v_row.end_at, v_start, v_end;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- B. A draft in the shape every draft had BEFORE this fix — dates in the theme,
--    no master row — publishes without the organiser re-entering anything.
--    The row is removed by hand to reproduce that shape exactly.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t3801_b AS
SELECT (public.biz_create_trip_draft(
  '38010000-0000-4000-8000-000000000010',
  jsonb_build_object('title', 'Untitled trip'),
  '38010000-0000-4000-8000-0000000000b1'
)#>>'{event,id}')::uuid AS event_id;

DO $$
DECLARE
  v_event uuid;
  v_start timestamptz; v_end timestamptz;
  v_count integer; v_row public.event_dates%ROWTYPE;
  v_result jsonb; v_status text;
BEGIN
  SELECT event_id INTO v_event FROM t3801_b;
  SELECT start_at, end_at INTO v_start, v_end FROM t3801_dates;

  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object(
      'event', jsonb_build_object(
        'title', 'Porto in spring',
        'business_trip', jsonb_build_object(
          'startAt', pg_temp.iso(v_start),
          'endAt', pg_temp.iso(v_end),
          'destinationLocationText', 'Porto, Portugal')),
      'days', jsonb_build_array(jsonb_build_object('ordinal', 1, 'title', 'Arrival'))),
    pg_temp.rev(v_event),
    '38010000-0000-4000-8000-0000000000b2');

  DELETE FROM public.event_dates WHERE event_id = v_event;
  SELECT count(*) INTO v_count FROM public.event_dates WHERE event_id = v_event;
  IF v_count <> 0 THEN RAISE EXCEPTION 'B-00 could not reproduce the pre-fix draft shape'; END IF;
  IF (SELECT theme#>>'{business_trip,startAt}' FROM public.events WHERE id = v_event) IS NULL THEN
    RAISE EXCEPTION 'B-01 the pre-fix draft shape lost its theme dates';
  END IF;

  -- The command alone, with no preceding save: the fallback is what is tested.
  v_result := public.biz_publish_trip_command(
    v_event, pg_temp.rev(v_event), '38010000-0000-4000-8000-0000000000b3');

  IF NOT COALESCE((v_result->>'ok')::boolean, true) THEN
    RAISE EXCEPTION 'B-02 publish of a pre-fix draft was refused: %', v_result;
  END IF;
  SELECT status INTO v_status FROM public.events WHERE id = v_event;
  IF v_status IS NULL OR v_status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'B-03 a pre-fix draft did not publish, status=% result=%', v_status, v_result;
  END IF;
  SELECT count(*) INTO v_count FROM public.event_dates WHERE event_id = v_event;
  IF v_count <> 1 THEN RAISE EXCEPTION 'B-04 the published pre-fix draft has % date row(s), expected 1', v_count; END IF;
  SELECT * INTO v_row FROM public.event_dates WHERE event_id = v_event;
  IF v_row.is_master IS DISTINCT FROM true
     OR v_row.start_at IS DISTINCT FROM v_start OR v_row.end_at IS DISTINCT FROM v_end THEN
    RAISE EXCEPTION 'B-05 the published pre-fix draft carries the wrong dates (% to %, master=%)',
      v_row.start_at, v_row.end_at, v_row.is_master;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- C. The owner follows every edit: healed, changed, cleared, out of order,
--    unreadable — and an explicit `event_dates` group still wins.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE t3801_c AS
SELECT (public.biz_create_trip_draft(
  '38010000-0000-4000-8000-000000000010',
  jsonb_build_object('title', 'Untitled trip'),
  '38010000-0000-4000-8000-0000000000c1'
)#>>'{event,id}')::uuid AS event_id;

DO $$
DECLARE
  v_event uuid;
  v_start timestamptz; v_end timestamptz;
  v_other_start timestamptz; v_other_end timestamptz;
  v_count integer; v_row public.event_dates%ROWTYPE;
  v_status text; v_result jsonb;
BEGIN
  SELECT event_id INTO v_event FROM t3801_c;
  SELECT start_at, end_at, other_start_at, other_end_at
    INTO v_start, v_end, v_other_start, v_other_end FROM t3801_dates;

  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
      'startAt', pg_temp.iso(v_start), 'endAt', pg_temp.iso(v_end),
      'destinationLocationText', 'Faro, Portugal'))),
    pg_temp.rev(v_event), '38010000-0000-4000-8000-0000000000c2');

  -- C-1 HEAL. Pre-fix shape again; a basics save that does NOT mention the
  -- dates (the wizard's description-only edit) restores the master row.
  DELETE FROM public.event_dates WHERE event_id = v_event;
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('event', jsonb_build_object('description', 'Four days on the coast')),
    pg_temp.rev(v_event), '38010000-0000-4000-8000-0000000000c3');
  SELECT count(*) INTO v_count FROM public.event_dates
   WHERE event_id = v_event AND is_master = true AND start_at = v_start AND end_at = v_end;
  IF v_count <> 1 THEN RAISE EXCEPTION 'C-01 a pre-fix draft was not healed by its next basics save'; END IF;

  -- C-2 CHANGE. New dates replace the row; there is still exactly one.
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
      'startAt', pg_temp.iso(v_other_start), 'endAt', pg_temp.iso(v_other_end)))),
    pg_temp.rev(v_event), '38010000-0000-4000-8000-0000000000c4');
  SELECT count(*) INTO v_count FROM public.event_dates WHERE event_id = v_event;
  IF v_count <> 1 THEN RAISE EXCEPTION 'C-02 changing the dates left % row(s), expected 1', v_count; END IF;
  SELECT * INTO v_row FROM public.event_dates WHERE event_id = v_event;
  IF v_row.start_at IS DISTINCT FROM v_other_start OR v_row.end_at IS DISTINCT FROM v_other_end THEN
    RAISE EXCEPTION 'C-03 the master row kept the old dates after a change';
  END IF;

  -- C-3 EXPLICIT GROUP WINS. Both shapes in one patch: the `event_dates`
  -- group keeps its existing behaviour and is what is stored.
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object(
      'event', jsonb_build_object('business_trip', jsonb_build_object(
        'startAt', pg_temp.iso(v_other_start), 'endAt', pg_temp.iso(v_other_end))),
      'event_dates', jsonb_build_array(jsonb_build_object(
        'start_at', v_start::text, 'end_at', v_end::text, 'is_master', true))),
    pg_temp.rev(v_event), '38010000-0000-4000-8000-0000000000c5');
  SELECT count(*) INTO v_count FROM public.event_dates
   WHERE event_id = v_event AND is_master = true AND start_at = v_start AND end_at = v_end;
  IF v_count <> 1 THEN RAISE EXCEPTION 'C-04 an explicit event_dates group did not win'; END IF;
  SELECT count(*) INTO v_count FROM public.event_dates WHERE event_id = v_event;
  IF v_count <> 1 THEN RAISE EXCEPTION 'C-05 an explicit event_dates group left % row(s), expected 1', v_count; END IF;

  -- C-4 HANDS OFF. A basics save that does not mention the dates leaves a row
  -- written through the explicit group exactly as it is, even though the
  -- theme now holds a different pair.
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('event', jsonb_build_object('description', 'Five days on the coast')),
    pg_temp.rev(v_event), '38010000-0000-4000-8000-0000000000c6');
  SELECT count(*) INTO v_count FROM public.event_dates
   WHERE event_id = v_event AND is_master = true AND start_at = v_start AND end_at = v_end;
  IF v_count <> 1 THEN RAISE EXCEPTION 'C-06 an unrelated basics save overwrote an explicitly written master row'; END IF;

  -- C-5 UNREADABLE. A date that is not a date is refused, and changes nothing.
  BEGIN
    PERFORM public.biz_apply_trip_draft_graph(
      v_event,
      jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
        'startAt', 'next tuesday-ish', 'endAt', pg_temp.iso(v_end)))),
      pg_temp.rev(v_event), '38010000-0000-4000-8000-0000000000c7');
    RAISE EXCEPTION 'C-07 an unreadable start date was accepted';
  EXCEPTION WHEN sqlstate '22023' THEN
    IF SQLERRM <> 'trip_dates_invalid' THEN RAISE EXCEPTION 'C-08 unreadable date raised %, expected trip_dates_invalid', SQLERRM; END IF;
  END;
  SELECT count(*) INTO v_count FROM public.event_dates
   WHERE event_id = v_event AND is_master = true AND start_at = v_start AND end_at = v_end;
  IF v_count <> 1 THEN RAISE EXCEPTION 'C-09 a refused save still changed the master row'; END IF;

  -- C-6 OUT OF ORDER. End before start: the save is kept (the wizard may be
  -- mid-edit) but no master row survives to be published by mistake.
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
      'startAt', pg_temp.iso(v_end), 'endAt', pg_temp.iso(v_start)))),
    pg_temp.rev(v_event), '38010000-0000-4000-8000-0000000000c8');
  SELECT count(*) INTO v_count FROM public.event_dates WHERE event_id = v_event;
  IF v_count <> 0 THEN RAISE EXCEPTION 'C-10 out-of-order dates left % date row(s), expected 0', v_count; END IF;

  -- C-7 CLEARED. Put a good pair back, then clear it the way the wizard does
  -- (JSON null): the master row goes with it.
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
      'startAt', pg_temp.iso(v_start), 'endAt', pg_temp.iso(v_end)))),
    pg_temp.rev(v_event), '38010000-0000-4000-8000-0000000000c9');
  SELECT count(*) INTO v_count FROM public.event_dates WHERE event_id = v_event AND is_master = true;
  IF v_count <> 1 THEN RAISE EXCEPTION 'C-11 a good pair after a bad one did not restore the master row'; END IF;

  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('event', jsonb_build_object('business_trip', jsonb_build_object(
      'startAt', NULL, 'endAt', NULL))),
    pg_temp.rev(v_event), '38010000-0000-4000-8000-0000000000ca');
  SELECT count(*) INTO v_count FROM public.event_dates WHERE event_id = v_event;
  IF v_count <> 0 THEN RAISE EXCEPTION 'C-12 clearing the dates left % date row(s), expected 0', v_count; END IF;

  -- C-8 STILL GUARDED. With no dates anywhere, publish is still refused and
  -- the trip stays a draft: the fallback did not weaken the existing rule.
  PERFORM public.biz_apply_trip_draft_graph(
    v_event,
    jsonb_build_object('days', jsonb_build_array(jsonb_build_object('ordinal', 1, 'title', 'Arrival'))),
    pg_temp.rev(v_event), '38010000-0000-4000-8000-0000000000cb');
  BEGIN
    v_result := public.biz_publish_trip_command(
      v_event, pg_temp.rev(v_event), '38010000-0000-4000-8000-0000000000cc');
    IF COALESCE((v_result->>'ok')::boolean, true) THEN
      RAISE EXCEPTION 'C-13 an undated trip published';
    END IF;
  EXCEPTION WHEN sqlstate 'P0001' THEN
    IF SQLERRM <> 'trip_dates_required' THEN
      RAISE EXCEPTION 'C-14 an undated trip was refused with %, expected trip_dates_required', SQLERRM;
    END IF;
  END;
  SELECT status INTO v_status FROM public.events WHERE id = v_event;
  IF v_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'C-15 a refused publish moved the trip to %', v_status; END IF;
END $$;

ROLLBACK;
