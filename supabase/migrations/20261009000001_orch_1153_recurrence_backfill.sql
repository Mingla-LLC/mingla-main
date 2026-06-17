-- ORCH-1153 [experience-reserve-checkout-integrity] — WS1 one-shot BACKFILL (P0).
--
-- Repairs every scheduled/published recurring experience that was published
-- BEFORE the 2026-06-16 materializer wiring (20261005000000) applied, so it
-- carries only its single (now-past) master date and reads sold-out/unavailable
-- on every surface. The live casualty is "Raleigh Wine and Dine Crawl"
-- (b8bd995b-fde9-452f-a7f9-0dffec359259): scheduled, daily/never, 1 date, 0
-- future, 0/20 sold.
--
-- Per row (idempotent, clear-then-expand → deterministic final state):
--   1. resolve the master row (skip + NOTICE if absent — never fabricate).
--   2. when the master start_at <= now(), RE-ANCHOR it forward to the next future
--      occurrence at the master's local wall-clock + duration + timezone (using
--      the rule's preset to find the next matching day). The expander only emits
--      FROM the master forward, so a far-past master must move forward first.
--   3. DELETE all non-master rows (clears stale past + any to-be-recreated future)
--      so the re-expand produces no duplicates.
--   4. re-expand via pg_expand_experience_recurrence from the (re-anchored) master.
--
-- Selector: ONLY rows with zero future dates → a healthy experience (e.g. the QA
-- fixture 44444444-1138-… with 51 future) is never touched. Running twice yields
-- the same final state (deterministic), so re-apply is safe (--include-all if the
-- pipeline flags an out-of-order DML migration; it is intentionally a DML repair).
--
-- Reuses pg_expand_experience_recurrence (20261005000000) verbatim — preset math,
-- 52-cap, count/until/never termination all unchanged.

DO $backfill$
DECLARE
  v_now           timestamptz := now();
  v_e             record;
  v_master        record;
  v_local_time    time;
  v_duration      interval;
  v_tz            text;
  v_preset        text;
  v_byday         text;
  v_bymonthday    integer;
  v_bysetpos      integer;
  v_cursor        date;
  v_safety        integer;
  v_new_start     timestamptz;
  v_new_end       timestamptz;
  v_match         boolean;
  v_emitted       integer;
  v_future_after  integer;
  v_repaired      integer := 0;
BEGIN
  FOR v_e IN
    SELECT e.id, e.recurrence_rules, e.timezone, e.slug
    FROM public.events e
    WHERE e.event_type = 'experience'
      AND e.is_recurring = true
      AND e.status IN ('scheduled','published')
      AND e.recurrence_rules IS NOT NULL
      AND e.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.event_dates ed
        WHERE ed.event_id = e.id AND ed.start_at > v_now
      )
  LOOP
    -- 1. master row
    SELECT ed.id, ed.start_at, ed.end_at, ed.timezone
    INTO v_master
    FROM public.event_dates ed
    WHERE ed.event_id = v_e.id AND ed.is_master = true
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE NOTICE 'ORCH-1153 backfill: event % (%) has no master event_date — skipping (data anomaly)', v_e.id, v_e.slug;
      CONTINUE;
    END IF;

    v_tz         := COALESCE(NULLIF(v_master.timezone, ''), NULLIF(v_e.timezone, ''), 'UTC');
    v_local_time := (v_master.start_at AT TIME ZONE v_tz)::time;
    v_duration   := COALESCE(v_master.end_at - v_master.start_at, INTERVAL '0');

    v_preset     := NULLIF(v_e.recurrence_rules->>'preset', '');
    v_byday      := NULLIF(v_e.recurrence_rules->>'byDay', '');
    v_bymonthday := NULLIF(v_e.recurrence_rules->>'byMonthDay', '')::integer;
    v_bysetpos   := NULLIF(v_e.recurrence_rules->>'bySetPos', '')::integer;

    -- 2. re-anchor the master forward when it is in the past.
    IF v_master.start_at <= v_now THEN
      IF v_preset IS NULL THEN
        RAISE NOTICE 'ORCH-1153 backfill: event % (%) recurrence has no preset — skipping', v_e.id, v_e.slug;
        CONTINUE;
      END IF;
      -- Walk forward from today (local) to the next preset-matching day, mirroring
      -- pg_expand_experience_recurrence's matchesPreset walk. Cap at 5 years.
      v_cursor := (v_now AT TIME ZONE v_tz)::date;
      v_safety := 365 * 5;
      v_new_start := NULL;
      WHILE v_safety > 0 LOOP
        v_safety := v_safety - 1;
        v_match :=
          CASE v_preset
            WHEN 'daily' THEN true
            WHEN 'weekly' THEN
              v_byday IS NOT NULL
              AND EXTRACT(dow FROM v_cursor)::int = public._pg_weekday_to_dow(v_byday)
            WHEN 'biweekly' THEN
              v_byday IS NOT NULL
              AND EXTRACT(dow FROM v_cursor)::int = public._pg_weekday_to_dow(v_byday)
            WHEN 'monthly_dom' THEN
              v_bymonthday IS NOT NULL
              AND EXTRACT(day FROM v_cursor)::int = v_bymonthday
            WHEN 'monthly_dow' THEN
              v_byday IS NOT NULL AND v_bysetpos IS NOT NULL
              AND EXTRACT(dow FROM v_cursor)::int = public._pg_weekday_to_dow(v_byday)
              AND (
                CASE
                  WHEN v_bysetpos = -1 THEN
                    EXTRACT(month FROM (v_cursor + 7))::int <> EXTRACT(month FROM v_cursor)::int
                  ELSE
                    CEIL(EXTRACT(day FROM v_cursor)::numeric / 7.0)::int = v_bysetpos
                END
              )
            ELSE false
          END;
        -- candidate start at the master's local clock time on this day
        v_new_start := (v_cursor + v_local_time) AT TIME ZONE v_tz;
        IF v_match AND v_new_start > v_now THEN
          EXIT;
        END IF;
        v_cursor := v_cursor + 1;
        v_new_start := NULL;
      END LOOP;

      IF v_new_start IS NULL THEN
        RAISE NOTICE 'ORCH-1153 backfill: event % (%) found no future preset match within 5y — skipping', v_e.id, v_e.slug;
        CONTINUE;
      END IF;

      v_new_end := v_new_start + v_duration;
      UPDATE public.event_dates
      SET start_at = v_new_start, end_at = v_new_end, timezone = v_tz
      WHERE id = v_master.id;
      v_master.start_at := v_new_start;
      v_master.end_at   := v_new_end;
    END IF;

    -- 3. drop all non-master rows (clears stale past + future before re-expand →
    --    no duplicates; deterministic on re-run).
    DELETE FROM public.event_dates
    WHERE event_id = v_e.id AND is_master = false;

    -- 4. re-expand 2nd..Nth from the (re-anchored) master.
    v_emitted := public.pg_expand_experience_recurrence(
      v_e.id, v_master.start_at, v_master.end_at, v_e.recurrence_rules, v_tz
    );

    -- keep events.theme.next_occurrence_at in sync (mirrors the publish RPC).
    UPDATE public.events
    SET theme = jsonb_set(
          COALESCE(theme, '{}'::jsonb),
          '{experience_meta,next_occurrence_at}',
          to_jsonb(to_char(v_master.start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
          true
        ),
        updated_at = v_now
    WHERE id = v_e.id;

    SELECT count(*) INTO v_future_after
    FROM public.event_dates ed
    WHERE ed.event_id = v_e.id AND ed.start_at > v_now;

    v_repaired := v_repaired + 1;
    RAISE NOTICE 'ORCH-1153 backfill: repaired event % (%) — master re-anchored to %, +% expanded, % future now',
      v_e.id, v_e.slug, v_master.start_at, v_emitted, v_future_after;
  END LOOP;

  RAISE NOTICE 'ORCH-1153 backfill: % recurring experience(s) repaired', v_repaired;
END;
$backfill$;
