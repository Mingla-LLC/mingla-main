-- ─────────────────────────────────────────────────────────────────────────────
-- ORCH-1068 [business-authored venues render on the consumer deck]
-- Backfill: rewrite array-shaped business hours → canonical Google Places v1
-- {periods,…} object so the consumer deck's open-hours filter includes them.
--
-- WHY: the business authoring pipeline persisted place_pool.opening_hours as a
-- top-level array [{weekday(0=Mon),isClosed,openTime,closeTime}] (BrandHourEntry).
-- The consumer deck (discover-cards filterByDateTime) reads the Google OBJECT
-- shape {periods:[{open:{day,hour,minute},close:{…}}], openNow, …} where day is
-- 0=Sunday. An array satisfies neither → "no hours" → venue excluded.
-- INVESTIGATION F-1/F-2 (ORCH-1068). This is the one-shot backfill; new/edited
-- rows are normalized at write by run-business-place-authoring-pipeline.
--
-- WEEKDAY TRANSLATION (LOCKED, F-2): business weekday 0=Monday…6=Sunday →
-- Google day 0=Sunday…6=Saturday. day = (weekday + 1) % 7.
--   Mon(0)->1 Tue(1)->2 Wed(2)->3 Thu(3)->4 Fri(4)->5 Sat(5)->6 Sun(6)->0.
-- Overnight (close <= open) → close.day = (google_day + 1) % 7. Same-day →
-- close.day = google_day. isClosed/unparseable rows contribute NO period.
-- openNow is always null (computed downstream per the user's tz; never baked).
--
-- IDEMPOTENT + SCOPED: WHERE business_author_brand_id IS NOT NULL AND
-- jsonb_typeof(opening_hours) = 'array'. After the first run those rows are
-- jsonb_typeof='object' so a re-run matches 0 rows. Google-seeded rows
-- (business_author_brand_id IS NULL) are never touched (80k+ rows safe).
--
-- External docs (COMMS-0003):
--  - Google Places v1 OpeningHours / periods / Point.day (0=Sunday):
--    https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#openinghours
--    https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places#point
--  - PostgreSQL jsonb / jsonb_typeof (idempotency guard):
--    https://www.postgresql.org/docs/current/functions-json.html
--  - Supabase migrations (timestamped, forward-only; applied via `supabase db push`,
--    NOT MCP apply_migration which would create remote-only timestamp drift):
--    https://supabase.com/docs/guides/deployment/database-migrations
--
-- COMMS-0002: this migration + supabase/functions/_shared/businessHoursToGoogle.ts
-- (+ its Deno test) are added to ORCH_1068_BACKEND_ALLOWLIST in
-- .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs in THIS SAME
-- commit so the C7 no-new-backend-files gate passes.
--
-- Version 20260905000000 is strictly greater than the remote max 20260904000000
-- (orch_1066_deck_score_tuner) and free across all sibling worktrees (verified).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Pure-SQL converter mirroring _shared/businessHoursToGoogle.ts.
-- Returns the Google v1 opening-hours object for one array-shaped row, or
-- {"openNow":null,"periods":[],"weekdayDescriptions":[…]} when all rows are
-- closed/unparseable.
CREATE OR REPLACE FUNCTION pg_temp.orch_1068_business_hours_to_google(p_arr jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  v_row          jsonb;
  v_weekday      int;
  v_google_day   int;
  v_close_day    int;
  v_open_txt     text;
  v_close_txt    text;
  v_open_h       int;
  v_open_m       int;
  v_close_h      int;
  v_close_m      int;
  v_periods      jsonb := '[]'::jsonb;
  v_labels       text[] := ARRAY['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  v_descs        text[] := ARRAY['Monday: Closed','Tuesday: Closed','Wednesday: Closed','Thursday: Closed','Friday: Closed','Saturday: Closed','Sunday: Closed'];
  v_open_label   text;
  v_close_label  text;
  v_overnight    boolean;
BEGIN
  IF p_arr IS NULL OR jsonb_typeof(p_arr) <> 'array' THEN
    RETURN NULL;
  END IF;

  FOR v_row IN SELECT jsonb_array_elements(p_arr)
  LOOP
    -- Tolerate non-object / missing weekday.
    IF jsonb_typeof(v_row) <> 'object' OR (v_row->>'weekday') IS NULL THEN
      CONTINUE;
    END IF;

    v_weekday := ((floor((v_row->>'weekday')::numeric)::int % 7) + 7) % 7; -- clamp 0..6 (Mon..Sun)

    -- isClosed → no period; description stays "Closed".
    IF COALESCE((v_row->>'isClosed')::boolean, false) THEN
      CONTINUE;
    END IF;

    v_open_txt  := v_row->>'openTime';
    v_close_txt := v_row->>'closeTime';

    -- Parse "HH:MM" or "HH:MM:SS". Skip the period if either is unparseable.
    IF v_open_txt  !~ '^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$' THEN CONTINUE; END IF;
    IF v_close_txt !~ '^[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?$' THEN CONTINUE; END IF;

    v_open_h  := split_part(v_open_txt,  ':', 1)::int;
    v_open_m  := split_part(v_open_txt,  ':', 2)::int;
    v_close_h := split_part(v_close_txt, ':', 1)::int;
    v_close_m := split_part(v_close_txt, ':', 2)::int;

    IF v_open_h  < 0 OR v_open_h  > 23 OR v_open_m  < 0 OR v_open_m  > 59 THEN CONTINUE; END IF;
    IF v_close_h < 0 OR v_close_h > 23 OR v_close_m < 0 OR v_close_m > 59 THEN CONTINUE; END IF;

    v_google_day := (v_weekday + 1) % 7;                 -- F-2 translation
    v_overnight  := (v_close_h * 60 + v_close_m) <= (v_open_h * 60 + v_open_m);
    v_close_day  := CASE WHEN v_overnight THEN (v_google_day + 1) % 7 ELSE v_google_day END;

    v_periods := v_periods || jsonb_build_object(
      'open',  jsonb_build_object('day', v_google_day, 'hour', v_open_h,  'minute', v_open_m),
      'close', jsonb_build_object('day', v_close_day,  'hour', v_close_h, 'minute', v_close_m)
    );

    -- Human description (12h, 2-digit minutes), matching the TS formatHm12 (display-only).
    v_open_label := to_char(make_time(v_open_h, v_open_m, 0), 'FMHH12') || ':'
      || to_char(v_open_m, 'FM00') || (CASE WHEN v_open_h < 12 THEN ' AM' ELSE ' PM' END);
    v_close_label := to_char(make_time(v_close_h, v_close_m, 0), 'FMHH12') || ':'
      || to_char(v_close_m, 'FM00') || (CASE WHEN v_close_h < 12 THEN ' AM' ELSE ' PM' END);
    v_descs[v_weekday + 1] := v_labels[v_weekday + 1] || ': ' || v_open_label || ' – ' || v_close_label;
  END LOOP;

  RETURN jsonb_build_object(
    'openNow', NULL,
    'periods', v_periods,
    'weekdayDescriptions', to_jsonb(v_descs)
  );
END;
$fn$;

-- Apply the backfill, scoped + idempotent.
DO $do$
DECLARE
  v_count int;
BEGIN
  WITH updated AS (
    UPDATE place_pool
    SET opening_hours = pg_temp.orch_1068_business_hours_to_google(opening_hours)
    WHERE business_author_brand_id IS NOT NULL
      AND jsonb_typeof(opening_hours) = 'array'
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM updated;

  RAISE NOTICE 'ORCH-1068 backfill: normalized % business-authored opening_hours array row(s) to Google {periods} shape.', v_count;
END;
$do$;

COMMIT;
