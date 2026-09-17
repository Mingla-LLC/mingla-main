-- issue #3426 — IMPLEMENTOR happy path for the date-decided brand page sections.
--
-- Proves, by EXECUTING the readers as `anon` against real rows:
--   H-1  every one of the four kinds (event, rsvp, trip, experience) lands in
--        exactly ONE of happening_now / upcoming / past, and in the expected one,
--        at each boundary: just before start, AT start, mid-run, AT end, after
--        end, a multi-day run, between two nights, one night of several running,
--        and every night over;
--   H-2  the reported starts_at / ends_at are the right occurrence's;
--   H-3  nothing appears in two sections and nothing extra appears at all;
--   H-4  each kind appears in all three sections (non-vacuity);
--   H-5  experiences are dated from event_dates, NOT the never-advanced stored
--        next_occurrence_at; a dateless experience falls back to a FUTURE stored
--        value as Upcoming only;
--   H-6  pg_public_brand_upcoming returns exactly the upcoming section, with the
--        same starts_at, so the store builds already installed agree;
--   H-7  each section's order (upcoming starts ASC; happening_now ends ASC; past
--        ends DESC — most recent first) and keyset pagination that returns every
--        row exactly once across pages, with limit+1 has-more detection;
--   H-8  authenticated reads the same rows as anon.
--
-- `now()` is fixed for the whole transaction, so "AT start" and "AT end" below
-- are exact equalities with the clock the readers use, not approximations.
--
-- Self-contained: one transaction, ends in ROLLBACK, leaves nothing behind.
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/migrations/__tests__/issue_3426_brand_offering_sections.implementor.happy.pg17.test.sql

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE i3426_fx (
  label      text PRIMARY KEY,
  id         uuid NOT NULL UNIQUE,
  kind       text NOT NULL,
  expect     text,          -- NULL = must be in no section
  exp_start  timestamptz,
  exp_end    timestamptz
) ON COMMIT DROP;

CREATE TEMP TABLE i3426_got (
  reader     text NOT NULL,
  section    text,
  ord        integer NOT NULL,
  id         uuid NOT NULL,
  kind       text,
  starts_at  timestamptz,
  ends_at    timestamptz
) ON COMMIT DROP;
GRANT SELECT, INSERT, DELETE ON i3426_got TO anon, authenticated;

DO $seed$
DECLARE
  v_account uuid := gen_random_uuid();
  v_brand   uuid := gen_random_uuid();
  v_kind    text;
  v_case    record;
  v_id      uuid;
  v_dates   jsonb;
  v_d       jsonb;
  v_first   timestamptz;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (v_account, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'issue3426-happy@example.test', now(), now());
  INSERT INTO public.creator_accounts (id, email, created_at)
  VALUES (v_account, 'issue3426-happy@example.test', now());
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at)
  VALUES (v_brand, v_account, 'issue-3426-sections-happy', 'Issue 3426 Sections', 'USD', now(), now());

  -- Each case: an array of [start offset, end offset] occurrences (the FIRST is
  -- the master, as publish writes it), and the section + occurrence bounds the
  -- reader must report.
  FOR v_kind IN SELECT unnest(ARRAY['event', 'rsvp', 'trip', 'experience']) LOOP
    FOR v_case IN
      SELECT * FROM (VALUES
        ('before_start',
         '[["1 minute","2 hours"]]'::jsonb,
         'upcoming', interval '1 minute', interval '2 hours'),
        ('at_start',
         '[["0 seconds","2 hours"]]'::jsonb,
         'happening_now', interval '0 seconds', interval '2 hours'),
        ('mid_run',
         '[["-1 hour","1 hour"]]'::jsonb,
         'happening_now', interval '-1 hour', interval '1 hour'),
        ('at_end',
         '[["-2 hours","0 seconds"]]'::jsonb,
         'past', interval '-2 hours', interval '0 seconds'),
        ('after_end',
         '[["-3 hours","-1 minute"]]'::jsonb,
         'past', interval '-3 hours', interval '-1 minute'),
        ('multi_day',
         '[["-2 days","2 days"]]'::jsonb,
         'happening_now', interval '-2 days', interval '2 days'),
        ('between_nights',
         '[["-2 days","-46 hours"],["1 day","26 hours"]]'::jsonb,
         'upcoming', interval '1 day', interval '26 hours'),
        ('night_running',
         '[["-1 day","-22 hours"],["-30 minutes","30 minutes"],["7 days","170 hours"]]'::jsonb,
         'happening_now', interval '-30 minutes', interval '30 minutes'),
        ('all_nights_over',
         '[["-5 days","-118 hours"],["-3 days","-70 hours"]]'::jsonb,
         'past', interval '-3 days', interval '-70 hours')
      ) AS c(label, dates, expect, s_off, e_off)
    LOOP
      v_id := gen_random_uuid();
      v_dates := v_case.dates;
      v_first := now() + (v_dates->0->>0)::interval;
      INSERT INTO public.events (
        id, brand_id, created_by, event_type, title, slug, description, status,
        visibility, published_at, currency, timezone, theme, created_at, updated_at
      ) VALUES (
        v_id, v_brand, v_account, v_kind, v_kind || ' ' || v_case.label,
        'i3426-h-' || v_kind || '-' || replace(v_case.label, '_', '-'), 'fixture',
        'scheduled', 'public', now() - interval '30 days', 'USD', 'UTC',
        -- Experiences carry the publish-time stored field exactly as publish
        -- writes it: the FIRST date, never advanced. H-5 proves it is ignored.
        CASE WHEN v_kind = 'experience' THEN jsonb_build_object(
          'experience_meta', jsonb_build_object(
            'next_occurrence_at', to_char(v_first AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
        ELSE '{}'::jsonb END,
        now(), now()
      );
      FOR v_d IN SELECT value FROM jsonb_array_elements(v_dates) LOOP
        INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
        VALUES (v_id, now() + (v_d->>0)::interval, now() + (v_d->>1)::interval, 'UTC',
                (v_d->>0) = (v_dates->0->>0));
      END LOOP;
      INSERT INTO i3426_fx VALUES (
        v_kind || ':' || v_case.label, v_id, v_kind, v_case.expect,
        now() + v_case.s_off, now() + v_case.e_off);
    END LOOP;
  END LOOP;

  -- H-5 — experience-only shapes around the stored field.
  -- (a) dates all over, stored field says the future -> PAST (dates win).
  v_id := gen_random_uuid();
  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, published_at, currency, timezone, theme, created_at, updated_at)
  VALUES (v_id, v_brand, v_account, 'experience', 'stored future, dates over',
    'i3426-h-exp-stored-future-dates-over', 'fixture', 'scheduled', 'public',
    now() - interval '30 days', 'USD', 'UTC',
    jsonb_build_object('experience_meta', jsonb_build_object('next_occurrence_at',
      to_char((now() + interval '5 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
    now(), now());
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
  VALUES (v_id, now() - interval '3 hours', now() - interval '1 hour', 'UTC', true);
  INSERT INTO i3426_fx VALUES ('experience:stored_future_dates_over', v_id, 'experience',
    'past', now() - interval '3 hours', now() - interval '1 hour');

  -- (b) no dates, stored future -> UPCOMING at the stored value, no end.
  v_id := gen_random_uuid();
  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, published_at, currency, timezone, theme, created_at, updated_at)
  VALUES (v_id, v_brand, v_account, 'experience', 'stored only, future',
    'i3426-h-exp-stored-only-future', 'fixture', 'scheduled', 'public',
    now() - interval '30 days', 'USD', 'UTC',
    jsonb_build_object('experience_meta', jsonb_build_object('next_occurrence_at',
      to_char(date_trunc('second', now() + interval '4 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
    now(), now());
  INSERT INTO i3426_fx VALUES ('experience:stored_only_future', v_id, 'experience',
    'upcoming', date_trunc('second', now() + interval '4 days'), NULL);

  -- (c) no dates, stored past -> NO section (it cannot be proven over or running).
  v_id := gen_random_uuid();
  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, published_at, currency, timezone, theme, created_at, updated_at)
  VALUES (v_id, v_brand, v_account, 'experience', 'stored only, past',
    'i3426-h-exp-stored-only-past', 'fixture', 'scheduled', 'public',
    now() - interval '30 days', 'USD', 'UTC',
    jsonb_build_object('experience_meta', jsonb_build_object('next_occurrence_at',
      to_char((now() - interval '4 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
    now(), now());
  INSERT INTO i3426_fx VALUES ('experience:stored_only_past', v_id, 'experience', NULL, NULL, NULL);

  -- A dateless NON-experience is in no section either: the stored fallback is
  -- experience-only.
  v_id := gen_random_uuid();
  INSERT INTO public.events (id, brand_id, created_by, event_type, title, slug, description,
    status, visibility, published_at, currency, timezone, theme, created_at, updated_at)
  VALUES (v_id, v_brand, v_account, 'event', 'dateless event with a stored field',
    'i3426-h-event-dateless', 'fixture', 'scheduled', 'public',
    now() - interval '30 days', 'USD', 'UTC',
    jsonb_build_object('experience_meta', jsonb_build_object('next_occurrence_at',
      to_char((now() + interval '4 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
    now(), now());
  INSERT INTO i3426_fx VALUES ('event:dateless', v_id, 'event', NULL, NULL, NULL);
END
$seed$;

-- ---------------------------------------------------------------------------
-- Read every section and the legacy Upcoming reader AS ANON.
-- ---------------------------------------------------------------------------
DO $read$
DECLARE
  v_section text;
BEGIN
  SET LOCAL ROLE anon;
  FOREACH v_section IN ARRAY ARRAY['happening_now', 'upcoming', 'past'] LOOP
    INSERT INTO i3426_got (reader, section, ord, id, kind, starts_at, ends_at)
    SELECT 'section', s.section, row_number() OVER ()::int, s.offering_id, s.offering_type,
           s.starts_at, s.ends_at
      FROM public.pg_public_brand_offering_section(
             'issue-3426-sections-happy', v_section, NULL, NULL, 100) s;
  END LOOP;
  INSERT INTO i3426_got (reader, section, ord, id, kind, starts_at, ends_at)
  SELECT 'legacy_upcoming', NULL, row_number() OVER ()::int, u.offering_id, u.offering_type,
         u.starts_at, NULL
    FROM public.pg_public_brand_upcoming('issue-3426-sections-happy', NULL, 100) u;
  RESET ROLE;
END
$read$;

DO $assert$
DECLARE
  v_bad   text;
  v_n     integer;
  v_m     integer;
  v_kind  text;
  v_sec   text;
BEGIN
  -- Non-vacuity: the fixture matrix is the size this suite claims.
  SELECT count(*) INTO v_n FROM i3426_fx;
  IF v_n <> 40 THEN
    RAISE EXCEPTION 'H-0: expected 40 fixtures (4 kinds x 9 cases + 4 edge shapes), found %', v_n;
  END IF;

  -- H-1 / H-3 — exactly one section, the expected one.
  SELECT string_agg(format('%s expected %s got %s', f.label, f.expect,
           COALESCE((SELECT string_agg(g.section, '+' ORDER BY g.section)
                       FROM i3426_got g WHERE g.reader = 'section' AND g.id = f.id), 'nothing')),
         '; ')
    INTO v_bad
    FROM i3426_fx f
   WHERE f.expect IS NOT NULL
     AND (SELECT count(*) FROM i3426_got g WHERE g.reader = 'section' AND g.id = f.id) <> 1
      OR f.expect IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM i3426_got g
                      WHERE g.reader = 'section' AND g.id = f.id AND g.section = f.expect);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'H-1: section placement wrong: %', v_bad;
  END IF;

  SELECT string_agg(f.label, ', ') INTO v_bad
    FROM i3426_fx f
   WHERE f.expect IS NULL
     AND EXISTS (SELECT 1 FROM i3426_got g WHERE g.id = f.id);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'H-3: offerings that belong in no section were returned: %', v_bad;
  END IF;

  SELECT count(*) INTO v_n FROM i3426_got WHERE reader = 'section';
  SELECT count(*) INTO v_m FROM i3426_fx WHERE expect IS NOT NULL;
  IF v_n <> v_m THEN
    RAISE EXCEPTION 'H-3: the three sections returned % rows for % placeable fixtures', v_n, v_m;
  END IF;

  -- H-2 — the occurrence bounds are the right occurrence's.
  SELECT string_agg(format('%s start %s/%s end %s/%s', f.label, g.starts_at, f.exp_start,
                           g.ends_at, f.exp_end), '; ')
    INTO v_bad
    FROM i3426_fx f
    JOIN i3426_got g ON g.id = f.id AND g.reader = 'section'
   WHERE g.starts_at IS DISTINCT FROM f.exp_start
      OR g.ends_at IS DISTINCT FROM f.exp_end;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'H-2: occurrence bounds wrong: %', v_bad;
  END IF;

  -- H-4 — every kind in every section.
  FOREACH v_kind IN ARRAY ARRAY['event', 'rsvp', 'trip', 'experience'] LOOP
    FOREACH v_sec IN ARRAY ARRAY['happening_now', 'upcoming', 'past'] LOOP
      SELECT count(*) INTO v_n FROM i3426_got
       WHERE reader = 'section' AND section = v_sec AND kind = v_kind;
      IF v_n = 0 THEN
        RAISE EXCEPTION 'H-4: kind % never appears in section %', v_kind, v_sec;
      END IF;
    END LOOP;
  END LOOP;

  -- H-5 — the between-nights experience is Upcoming at its SECOND night although
  -- its stored field still names the first (past) night.
  PERFORM 1 FROM i3426_fx f JOIN i3426_got g ON g.id = f.id AND g.reader = 'section'
   WHERE f.label = 'experience:between_nights' AND g.section = 'upcoming'
     AND g.starts_at = now() + interval '1 day';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'H-5: an experience was dated from its stale stored field instead of event_dates';
  END IF;

  -- H-6 — the legacy reader is exactly the upcoming section.
  SELECT string_agg(COALESCE(a.id, b.id)::text, ', ') INTO v_bad
    FROM (SELECT id, starts_at FROM i3426_got WHERE reader = 'section' AND section = 'upcoming') a
    FULL JOIN (SELECT id, starts_at FROM i3426_got WHERE reader = 'legacy_upcoming') b
      ON a.id = b.id AND a.starts_at = b.starts_at
   WHERE a.id IS NULL OR b.id IS NULL;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'H-6: pg_public_brand_upcoming and the upcoming section disagree on: %', v_bad;
  END IF;

  -- H-7a — order within each section is the documented one.
  IF EXISTS (
    SELECT 1 FROM (
      SELECT ord, row_number() OVER (ORDER BY starts_at ASC, id ASC) AS want
        FROM i3426_got WHERE reader = 'section' AND section = 'upcoming'
    ) q WHERE q.ord <> q.want
  ) THEN
    RAISE EXCEPTION 'H-7: upcoming is not ordered by starts_at ASC, offering_id ASC';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT ord, row_number() OVER (ORDER BY ends_at ASC, id ASC) AS want
        FROM i3426_got WHERE reader = 'section' AND section = 'happening_now'
    ) q WHERE q.ord <> q.want
  ) THEN
    RAISE EXCEPTION 'H-7: happening_now is not ordered by ends_at ASC, offering_id ASC';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT ord, row_number() OVER (ORDER BY ends_at DESC, id DESC) AS want
        FROM i3426_got WHERE reader = 'section' AND section = 'past'
    ) q WHERE q.ord <> q.want
  ) THEN
    RAISE EXCEPTION 'H-7: past is not most-recent-first (ends_at DESC, offering_id DESC)';
  END IF;

  RAISE NOTICE 'H-1..H-7a PASS — 40 fixtures, four kinds, three sections, every boundary';
END
$assert$;

-- ---------------------------------------------------------------------------
-- H-7b — keyset pagination: pages of 5 (the reader returns up to 6 = limit+1)
-- walked to the end return every row of the section exactly once, in order.
-- ---------------------------------------------------------------------------
DO $page$
DECLARE
  v_section   text;
  v_cursor_at timestamptz;
  v_cursor_id uuid;
  v_page      integer;
  v_rows      integer;
  v_seen      uuid[];
  v_page_ids  uuid[];
  v_full      uuid[];
  v_last_at   timestamptz;
  v_last_id   uuid;
BEGIN
  FOREACH v_section IN ARRAY ARRAY['happening_now', 'upcoming', 'past'] LOOP
    SELECT array_agg(id ORDER BY ord) INTO v_full
      FROM i3426_got WHERE reader = 'section' AND section = v_section;
    v_cursor_at := NULL; v_cursor_id := NULL; v_seen := ARRAY[]::uuid[]; v_page := 0;
    LOOP
      v_page := v_page + 1;
      IF v_page > 20 THEN RAISE EXCEPTION 'H-7b: % pagination did not terminate', v_section; END IF;
      SET LOCAL ROLE anon;
      SELECT count(*), array_agg(q.offering_id ORDER BY q.rn) FILTER (WHERE q.rn <= 5)
        INTO v_rows, v_page_ids
        FROM (
          SELECT s.offering_id, row_number() OVER () AS rn
            FROM public.pg_public_brand_offering_section(
                   'issue-3426-sections-happy', v_section, v_cursor_at, v_cursor_id, 5) s
        ) q;
      RESET ROLE;
      IF v_rows > 6 THEN
        RAISE EXCEPTION 'H-7b: % page % returned % rows for limit 5 (limit+1 is 6)', v_section, v_page, v_rows;
      END IF;
      v_seen := v_seen || COALESCE(v_page_ids, ARRAY[]::uuid[]);
      EXIT WHEN v_rows <= 5;
      v_last_id := v_page_ids[5];
      SELECT CASE WHEN v_section = 'upcoming' THEN g.starts_at ELSE g.ends_at END
        INTO v_last_at FROM i3426_got g
       WHERE g.reader = 'section' AND g.id = v_last_id;
      v_cursor_at := v_last_at; v_cursor_id := v_last_id;
    END LOOP;
    IF v_seen IS DISTINCT FROM v_full THEN
      RAISE EXCEPTION 'H-7b: % pages %, full %', v_section, v_seen, v_full;
    END IF;
    IF cardinality(v_full) <= 5 THEN
      RAISE EXCEPTION 'H-7b is vacuous for %: only % rows, pagination never crossed a page', v_section, cardinality(v_full);
    END IF;
  END LOOP;
  RAISE NOTICE 'H-7b PASS — keyset pages return every row exactly once, in order, for all three sections';
END
$page$;

-- ---------------------------------------------------------------------------
-- H-8 — authenticated reads exactly what anon reads.
-- ---------------------------------------------------------------------------
DO $auth$
DECLARE
  v_anon uuid[];
  v_auth uuid[];
  v_section text;
BEGIN
  FOREACH v_section IN ARRAY ARRAY['happening_now', 'upcoming', 'past'] LOOP
    SELECT array_agg(id ORDER BY ord) INTO v_anon
      FROM i3426_got WHERE reader = 'section' AND section = v_section;
    SET LOCAL ROLE authenticated;
    SELECT array_agg(s.offering_id) INTO v_auth
      FROM public.pg_public_brand_offering_section('issue-3426-sections-happy', v_section, NULL, NULL, 100) s;
    RESET ROLE;
    IF v_auth IS DISTINCT FROM v_anon THEN
      RAISE EXCEPTION 'H-8: authenticated and anon disagree on %', v_section;
    END IF;
  END LOOP;
  RAISE NOTICE 'H-8 PASS — authenticated reads the same sections as anon';
  RAISE NOTICE 'issue #3426 implementor happy path PASS';
END
$auth$;

ROLLBACK;
