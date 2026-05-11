-- ORCH-0792 backfill — derive event_dates rows from theme JSON for legacy events.
--
-- Background: prior to ORCH-0792, business_publish_event_draft never wrote
-- event_dates rows. As of the audit on 2026-05-11, 100% of production events
-- (17/17 including 7 published-or-live and 3 with confirmed paid orders)
-- lacked event_dates rows. Date data lives in
-- `events.theme.business_event.when` (post-publish) or
-- `events.theme.business_draft.when` (drafts). This migration walks every
-- event without event_dates rows and inserts the corresponding row(s).
--
-- Properties:
--   • Idempotent — re-running inserts zero rows on subsequent runs.
--   • Strict pre-flight — aborts with a clear error if any event is
--     uncoverable (no parseable date in either theme path AND no
--     multiDates array). Operator must manually populate event_dates
--     for those events and re-run.
--   • Multi-date aware — events with theme.*.multiDates get one row per
--     entry; chronologically-first gets is_master=true.
--
-- See: Mingla_Artifacts/specs/SPEC_ORCH-0792_EVENTS_WITHOUT_DATES.md §4.2

DO $$
DECLARE
  v_uncoverable_count integer;
  v_event record;
  v_theme jsonb;
  v_when jsonb;
  v_multi jsonb;
  v_when_mode text;
  v_date_iso text;
  v_doors text;
  v_ends text;
  v_timezone text;
  v_start timestamptz;
  v_end timestamptz;
  v_entry jsonb;
  v_min_start timestamptz;
  v_inserted integer := 0;
  v_skipped_no_data integer := 0;
BEGIN
  -- Pre-flight: count events that have NO event_dates AND have no parseable
  -- date in either theme path. These are truly uncoverable — abort and let
  -- operator decide.
  --
  -- Scope rules:
  --   • `status = 'cancelled'` events are excluded — they don't need
  --     event_dates (the constraint trigger only fires on transitions INTO
  --     scheduled/live, and cancelled events won't render dates anywhere).
  --     If a cancelled event is ever resurrected to scheduled, operator
  --     will need to populate dates then; backfill can be re-run.
  --   • multiDates is checked via `jsonb_typeof = 'array'` rather than
  --     `IS NULL` because some legacy rows store the field as JSON literal
  --     `null` (a scalar). `IS NULL` only catches SQL NULL, not JSON null,
  --     and `jsonb_array_length` on a scalar throws SQLSTATE 22023.
  SELECT count(*) INTO v_uncoverable_count
  FROM public.events e
  WHERE NOT EXISTS (SELECT 1 FROM public.event_dates ed WHERE ed.event_id = e.id)
    AND e.deleted_at IS NULL
    AND e.status <> 'cancelled'
    AND COALESCE(
      NULLIF(e.theme->'business_event'->'when'->>'date', ''),
      NULLIF(e.theme->'business_draft'->'when'->>'date', '')
    ) IS NULL
    AND NOT (
      jsonb_typeof(e.theme->'business_event'->'multiDates') = 'array'
      AND jsonb_array_length(e.theme->'business_event'->'multiDates') > 0
    )
    AND NOT (
      jsonb_typeof(e.theme->'business_draft'->'multiDates') = 'array'
      AND jsonb_array_length(e.theme->'business_draft'->'multiDates') > 0
    );

  IF v_uncoverable_count > 0 THEN
    RAISE EXCEPTION
      'orch_0792_backfill_aborted: % non-cancelled event(s) lack a parseable date in either theme.business_event.when, theme.business_draft.when, or any multiDates array. Operator must manually populate event_dates rows for these events before re-running this migration. To list them: SELECT id, title, status FROM events WHERE NOT EXISTS (SELECT 1 FROM event_dates WHERE event_id = events.id) AND deleted_at IS NULL AND status <> ''cancelled'';',
      v_uncoverable_count;
  END IF;

  FOR v_event IN
    SELECT id, theme, timezone
    FROM public.events e
    WHERE NOT EXISTS (SELECT 1 FROM public.event_dates ed WHERE ed.event_id = e.id)
      AND e.deleted_at IS NULL
      AND e.status <> 'cancelled'
  LOOP
    v_theme := COALESCE(v_event.theme, '{}'::jsonb);
    -- Prefer business_event (post-publish); fall back to business_draft (drafts).
    v_when := COALESCE(v_theme->'business_event'->'when', v_theme->'business_draft'->'when');
    v_multi := COALESCE(v_theme->'business_event'->'multiDates', v_theme->'business_draft'->'multiDates');
    v_when_mode := COALESCE(
      NULLIF(v_theme->'business_event'->>'whenMode', ''),
      NULLIF(v_theme->'business_draft'->>'whenMode', ''),
      'single'
    );
    v_timezone := COALESCE(
      NULLIF(v_when->>'timezone', ''),
      v_event.timezone,
      'UTC'
    );

    -- Multi-date branch
    IF v_when_mode = 'multi_date'
      AND v_multi IS NOT NULL
      AND jsonb_typeof(v_multi) = 'array'
      AND jsonb_array_length(v_multi) > 0
    THEN
      v_min_start := NULL;
      SELECT min(
        (entry->>'date' || ' ' || COALESCE(NULLIF(entry->>'startTime', ''), '00:00') || ':00')::timestamp AT TIME ZONE v_timezone
      )
      INTO v_min_start
      FROM jsonb_array_elements(v_multi) entry
      WHERE NULLIF(entry->>'date', '') IS NOT NULL;

      IF v_min_start IS NULL THEN
        v_skipped_no_data := v_skipped_no_data + 1;
        CONTINUE;
      END IF;

      FOR v_entry IN SELECT value FROM jsonb_array_elements(v_multi)
      LOOP
        v_date_iso := NULLIF(v_entry->>'date', '');
        IF v_date_iso IS NULL THEN CONTINUE; END IF;
        v_doors := COALESCE(NULLIF(v_entry->>'startTime', ''), '00:00');
        v_ends := COALESCE(NULLIF(v_entry->>'endTime', ''), v_doors);
        v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
        v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
        IF v_end <= v_start THEN v_end := v_end + INTERVAL '1 day'; END IF;
        INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
        VALUES (v_event.id, v_start, v_end, v_timezone, v_start = v_min_start);
        v_inserted := v_inserted + 1;
      END LOOP;

    ELSE
      -- single or recurring: one master row from theme.*.when.date
      v_date_iso := NULLIF(v_when->>'date', '');
      IF v_date_iso IS NULL THEN
        v_skipped_no_data := v_skipped_no_data + 1;
        CONTINUE;
      END IF;
      v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
      v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
      v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
      v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
      IF v_end <= v_start THEN v_end := v_end + INTERVAL '1 day'; END IF;
      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (v_event.id, v_start, v_end, v_timezone, true);
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'ORCH-0792 backfill: inserted % event_dates row(s); skipped % event(s) (pre-flight should have caught these — investigate if non-zero).',
    v_inserted, v_skipped_no_data;
END $$;
