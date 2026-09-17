-- issue #3426 — IMPLEMENTOR adversarial suite for the date-decided brand page
-- sections. A different angle from the happy path: what must NEVER come back,
-- and the edges of the contract.
--
--   A-1  cancelled offerings — every kind, before / during / after their dates —
--        are in NO section and not in pg_public_brand_upcoming. A cancelled
--        offering is never shown as Past as if it had happened.
--   A-2  every visibility guard holds on all three sections: private, hidden,
--        discover and draft visibility; unpublished; draft status; a
--        soft-deleted offering; a soft-deleted brand; a #1931 ordinary-read
--        block; another brand's offerings.
--   A-3  the paid-supply guard: a paid online offering of a brand that cannot
--        collect is hidden from every section, a free one is not, and the paid
--        one reappears once the brand can collect.
--   A-4  status is never trusted to keep anything current (#3422): a `scheduled`
--        offering whose dates are over is Past, `live` with past dates is Past,
--        `ended` with future dates is Upcoming.
--   A-5  a corrupt occurrence (end at/before start) fails CLOSED — the offering
--        is in no section and does not raise for the rest of the brand.
--   A-6  a malformed stored next_occurrence_at and a non-object theme never raise.
--   A-7  unknown, wrongly-cased, empty and NULL section names return nothing.
--   A-8  ties: identical ends_at / starts_at page one row at a time, each row
--        exactly once, in offering_id order; a cursor with a NULL id is strictly
--        after its timestamp.
--   A-9  the page size is clamped to 1..100 (+1 for has-more).
--   A-10 security posture: the classifier is SECURITY INVOKER and not executable
--        by anon/authenticated (a direct anon call is refused); the section
--        reader is SECURITY DEFINER with a pinned search_path and projects NO
--        theme column.
--
-- Self-contained: one transaction, ends in ROLLBACK.
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/migrations/__tests__/issue_3426_brand_offering_sections.implementor.adversarial.pg17.test.sql

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE i3426a_fx (
  label  text PRIMARY KEY,
  id     uuid NOT NULL UNIQUE,
  brand  text NOT NULL,
  expect text   -- NULL = must be in no section of any brand
) ON COMMIT DROP;

-- The corrupt-occurrence fixture needs the CHECK relaxed. Rolled back with
-- everything else.
ALTER TABLE public.event_dates DROP CONSTRAINT event_dates_end_after_start;

CREATE OR REPLACE FUNCTION pg_temp.i3426a_offering(
  p_brand uuid, p_account uuid, p_label text, p_kind text, p_status text,
  p_visibility text, p_published boolean, p_deleted boolean,
  p_start interval, p_end interval, p_theme jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql AS $fn$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.events (
    id, brand_id, created_by, event_type, title, slug, description, status, visibility,
    published_at, deleted_at, currency, timezone, theme, created_at, updated_at
  ) VALUES (
    v_id, p_brand, p_account, p_kind, p_label, 'i3426-a-' || replace(replace(p_label, '_', '-'), ':', '-'),
    'fixture', p_status, p_visibility,
    CASE WHEN p_published THEN now() - interval '30 days' END,
    CASE WHEN p_deleted THEN now() - interval '1 day' END,
    'USD', 'UTC', p_theme, now(), now()
  );
  IF p_start IS NOT NULL THEN
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (v_id, now() + p_start, now() + p_end, 'UTC', true);
  END IF;
  RETURN v_id;
END
$fn$;

DO $seed$
DECLARE
  v_account uuid := gen_random_uuid();
  v_brand   uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_gone    uuid := gen_random_uuid();
  v_clamp   uuid := gen_random_uuid();
  v_kind    text;
  v_pos     record;
  v_id      uuid;
  v_i       integer;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (v_account, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'issue3426-adv@example.test', now(), now());
  INSERT INTO public.creator_accounts (id, email, created_at)
  VALUES (v_account, 'issue3426-adv@example.test', now());
  INSERT INTO public.brands (id, account_id, slug, name, default_currency, created_at, updated_at) VALUES
    (v_brand, v_account, 'issue-3426-adv', 'Issue 3426 Adversarial', 'USD', now(), now()),
    (v_other, v_account, 'issue-3426-adv-other', 'Issue 3426 Other', 'USD', now(), now()),
    (v_clamp, v_account, 'issue-3426-adv-clamp', 'Issue 3426 Clamp', 'USD', now(), now()),
    -- Soft-deleted AFTER its offerings are seeded (an event insert needs a live
    -- brand for its currency, and #2063 refuses to soft-delete a brand with
    -- scheduled/live future events — so this brand's fixtures are `ended`, which
    -- the readers classify by date like any other).
    (v_gone, v_account, 'issue-3426-adv-gone', 'Issue 3426 Gone', 'USD', now(), now());

  FOR v_kind IN SELECT unnest(ARRAY['event', 'rsvp', 'trip', 'experience']) LOOP
    FOR v_pos IN
      SELECT * FROM (VALUES
        ('future',  interval '1 day',   interval '26 hours', 'upcoming'),
        ('running', interval '-1 hour', interval '1 hour',   'happening_now'),
        ('over',    interval '-2 days', interval '-46 hours', 'past')
      ) AS p(pos, s, e, section)
    LOOP
      -- A control that MUST show, so every exclusion below is measured against a
      -- reader that is demonstrably returning this kind in this position.
      v_id := pg_temp.i3426a_offering(v_brand, v_account, v_kind || ':control:' || v_pos.pos,
        v_kind, 'scheduled', 'public', true, false, v_pos.s, v_pos.e);
      INSERT INTO i3426a_fx VALUES (v_kind || ':control:' || v_pos.pos, v_id, 'issue-3426-adv', v_pos.section);

      -- A-1 cancelled.
      v_id := pg_temp.i3426a_offering(v_brand, v_account, v_kind || ':cancelled:' || v_pos.pos,
        v_kind, 'cancelled', 'public', true, false, v_pos.s, v_pos.e);
      INSERT INTO i3426a_fx VALUES (v_kind || ':cancelled:' || v_pos.pos, v_id, 'issue-3426-adv', NULL);

      -- A-2 visibility / publication / deletion.
      v_id := pg_temp.i3426a_offering(v_brand, v_account, v_kind || ':hidden:' || v_pos.pos,
        v_kind, 'scheduled', 'hidden', true, false, v_pos.s, v_pos.e);
      INSERT INTO i3426a_fx VALUES (v_kind || ':hidden:' || v_pos.pos, v_id, 'issue-3426-adv', NULL);
      v_id := pg_temp.i3426a_offering(v_brand, v_account, v_kind || ':private:' || v_pos.pos,
        v_kind, 'scheduled', 'private', true, false, v_pos.s, v_pos.e);
      INSERT INTO i3426a_fx VALUES (v_kind || ':private:' || v_pos.pos, v_id, 'issue-3426-adv', NULL);
      v_id := pg_temp.i3426a_offering(v_brand, v_account, v_kind || ':discover:' || v_pos.pos,
        v_kind, 'scheduled', 'discover', true, false, v_pos.s, v_pos.e);
      INSERT INTO i3426a_fx VALUES (v_kind || ':discover:' || v_pos.pos, v_id, 'issue-3426-adv', NULL);
      v_id := pg_temp.i3426a_offering(v_brand, v_account, v_kind || ':vis_draft:' || v_pos.pos,
        v_kind, 'scheduled', 'draft', true, false, v_pos.s, v_pos.e);
      INSERT INTO i3426a_fx VALUES (v_kind || ':vis_draft:' || v_pos.pos, v_id, 'issue-3426-adv', NULL);
      v_id := pg_temp.i3426a_offering(v_brand, v_account, v_kind || ':unpublished:' || v_pos.pos,
        v_kind, 'scheduled', 'public', false, false, v_pos.s, v_pos.e);
      INSERT INTO i3426a_fx VALUES (v_kind || ':unpublished:' || v_pos.pos, v_id, 'issue-3426-adv', NULL);
      v_id := pg_temp.i3426a_offering(v_brand, v_account, v_kind || ':status_draft:' || v_pos.pos,
        v_kind, 'draft', 'public', true, false, v_pos.s, v_pos.e);
      INSERT INTO i3426a_fx VALUES (v_kind || ':status_draft:' || v_pos.pos, v_id, 'issue-3426-adv', NULL);
      v_id := pg_temp.i3426a_offering(v_brand, v_account, v_kind || ':deleted:' || v_pos.pos,
        v_kind, 'scheduled', 'public', true, true, v_pos.s, v_pos.e);
      INSERT INTO i3426a_fx VALUES (v_kind || ':deleted:' || v_pos.pos, v_id, 'issue-3426-adv', NULL);

      -- A-2 #1931 ordinary-read block.
      v_id := pg_temp.i3426a_offering(v_brand, v_account, v_kind || ':read_blocked:' || v_pos.pos,
        v_kind, 'scheduled', 'public', true, false, v_pos.s, v_pos.e);
      INSERT INTO public.event_private_media_transition_jobs (
        transition_id, event_id, direction, target_visibility, state,
        ordinary_read_blocked_at, expected_event_updated_at, source_fingerprint)
      VALUES (gen_random_uuid(), v_id, 'enter_private', 'private', 'preparing',
              now(), now(), repeat('a', 64));
      INSERT INTO i3426a_fx VALUES (v_kind || ':read_blocked:' || v_pos.pos, v_id, 'issue-3426-adv', NULL);

      -- A-2 a soft-deleted brand's public offering.
      v_id := pg_temp.i3426a_offering(v_gone, v_account, v_kind || ':brand_gone:' || v_pos.pos,
        v_kind, 'ended', 'public', true, false, v_pos.s, v_pos.e);
      INSERT INTO i3426a_fx VALUES (v_kind || ':brand_gone:' || v_pos.pos, v_id, 'issue-3426-adv-gone', NULL);

      -- A-2 another brand's offering: visible on ITS page, never on this one.
      v_id := pg_temp.i3426a_offering(v_other, v_account, v_kind || ':other_brand:' || v_pos.pos,
        v_kind, 'scheduled', 'public', true, false, v_pos.s, v_pos.e);
      INSERT INTO i3426a_fx VALUES (v_kind || ':other_brand:' || v_pos.pos, v_id, 'issue-3426-adv-other', v_pos.section);

      -- A-3 paid online supply of a brand that cannot collect, and a free twin.
      v_id := pg_temp.i3426a_offering(v_brand, v_account, v_kind || ':paid:' || v_pos.pos,
        v_kind, 'scheduled', 'public', true, false, v_pos.s, v_pos.e);
      INSERT INTO public.ticket_types (event_id, name, price_cents, currency, is_unlimited, is_free,
        available_online, available_in_person, display_order)
      VALUES (v_id, 'Paid', 2500, 'USD', true, false, true, false, 0);
      INSERT INTO i3426a_fx VALUES (v_kind || ':paid:' || v_pos.pos, v_id, 'issue-3426-adv', NULL);
      v_id := pg_temp.i3426a_offering(v_brand, v_account, v_kind || ':free:' || v_pos.pos,
        v_kind, 'scheduled', 'public', true, false, v_pos.s, v_pos.e);
      INSERT INTO public.ticket_types (event_id, name, price_cents, currency, is_unlimited, is_free,
        available_online, available_in_person, display_order)
      VALUES (v_id, 'Free', 0, 'USD', true, true, true, false, 0);
      INSERT INTO i3426a_fx VALUES (v_kind || ':free:' || v_pos.pos, v_id, 'issue-3426-adv', v_pos.section);
    END LOOP;

    -- A-4 status is not trusted.
    v_id := pg_temp.i3426a_offering(v_brand, v_account, v_kind || ':live_but_over',
      v_kind, 'live', 'public', true, false, interval '-3 days', interval '-70 hours');
    INSERT INTO i3426a_fx VALUES (v_kind || ':live_but_over', v_id, 'issue-3426-adv', 'past');
    v_id := pg_temp.i3426a_offering(v_brand, v_account, v_kind || ':ended_but_future',
      v_kind, 'ended', 'public', true, false, interval '3 days', interval '74 hours');
    INSERT INTO i3426a_fx VALUES (v_kind || ':ended_but_future', v_id, 'issue-3426-adv', 'upcoming');

    -- A-5 corrupt occurrence: end BEFORE start, positioned so a naive reader would
    -- call it running (start in the future, end in the past).
    v_id := pg_temp.i3426a_offering(v_brand, v_account, v_kind || ':corrupt',
      v_kind, 'scheduled', 'public', true, false, interval '1 hour', interval '-1 hour');
    INSERT INTO i3426a_fx VALUES (v_kind || ':corrupt', v_id, 'issue-3426-adv', NULL);
    -- ... and one valid night beside a zero-length one.
    v_id := pg_temp.i3426a_offering(v_brand, v_account, v_kind || ':corrupt_mixed',
      v_kind, 'scheduled', 'public', true, false, interval '2 days', interval '50 hours');
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (v_id, now() + interval '5 days', now() + interval '5 days', 'UTC', false);
    INSERT INTO i3426a_fx VALUES (v_kind || ':corrupt_mixed', v_id, 'issue-3426-adv', NULL);
  END LOOP;

  -- A-6 malformed stored field / non-object theme on dateless experiences.
  v_id := pg_temp.i3426a_offering(v_brand, v_account, 'experience:stored_garbage',
    'experience', 'scheduled', 'public', true, false, NULL, NULL,
    '{"experience_meta":{"next_occurrence_at":"next tuesday-ish"}}'::jsonb);
  INSERT INTO i3426a_fx VALUES ('experience:stored_garbage', v_id, 'issue-3426-adv', NULL);
  v_id := pg_temp.i3426a_offering(v_brand, v_account, 'experience:theme_array',
    'experience', 'scheduled', 'public', true, false, NULL, NULL, '["not","an","object"]'::jsonb);
  INSERT INTO i3426a_fx VALUES ('experience:theme_array', v_id, 'issue-3426-adv', NULL);
  v_id := pg_temp.i3426a_offering(v_brand, v_account, 'experience:theme_scalar',
    'experience', 'scheduled', 'public', true, false, NULL, NULL, '"2099-01-01T00:00:00Z"'::jsonb);
  INSERT INTO i3426a_fx VALUES ('experience:theme_scalar', v_id, 'issue-3426-adv', NULL);

  -- A-8 ties: three past offerings ending at the SAME instant, three upcoming
  -- starting at the same instant.
  FOR v_i IN 1..3 LOOP
    v_id := pg_temp.i3426a_offering(v_brand, v_account, 'tie:past:' || v_i,
      'event', 'scheduled', 'public', true, false, interval '-10 days', interval '-9 days');
    INSERT INTO i3426a_fx VALUES ('tie:past:' || v_i, v_id, 'issue-3426-adv', 'past');
    v_id := pg_temp.i3426a_offering(v_brand, v_account, 'tie:upcoming:' || v_i,
      'rsvp', 'scheduled', 'public', true, false, interval '10 days', interval '11 days');
    INSERT INTO i3426a_fx VALUES ('tie:upcoming:' || v_i, v_id, 'issue-3426-adv', 'upcoming');
  END LOOP;

  -- A-9 clamp: 105 past offerings on their own brand.
  FOR v_i IN 1..105 LOOP
    PERFORM pg_temp.i3426a_offering(v_clamp, v_account, 'clamp:' || v_i,
      'event', 'scheduled', 'public', true, false,
      make_interval(days => -200 + v_i), make_interval(days => -199 + v_i));
  END LOOP;

  UPDATE public.brands SET deleted_at = now() - interval '1 minute' WHERE id = v_gone;
END
$seed$;

-- ---------------------------------------------------------------------------
-- A-1 .. A-6 — read every section of every fixture brand AS ANON and compare.
-- ---------------------------------------------------------------------------
DO $sections$
DECLARE
  v_bad text;
  v_n   integer;
BEGIN
  SET LOCAL ROLE anon;
  CREATE TEMP TABLE i3426a_got ON COMMIT DROP AS
    SELECT b.slug AS brand, s.section AS section_name, s.offering_id AS id
      FROM unnest(ARRAY['issue-3426-adv', 'issue-3426-adv-other', 'issue-3426-adv-gone']) AS b(slug)
     CROSS JOIN unnest(ARRAY['happening_now', 'upcoming', 'past']) AS sec(name)
     CROSS JOIN LATERAL public.pg_public_brand_offering_section(b.slug, sec.name, NULL, NULL, 100) s;
  CREATE TEMP TABLE i3426a_legacy ON COMMIT DROP AS
    SELECT b.slug AS brand, u.offering_id AS id
      FROM unnest(ARRAY['issue-3426-adv', 'issue-3426-adv-other', 'issue-3426-adv-gone']) AS b(slug)
     CROSS JOIN LATERAL public.pg_public_brand_upcoming(b.slug, NULL, 100) u;
  RESET ROLE;

  SELECT count(*) INTO v_n FROM i3426a_fx WHERE expect IS NOT NULL;
  IF v_n < 40 THEN
    RAISE EXCEPTION 'A-0 vacuity: only % visible controls seeded', v_n;
  END IF;

  -- Nothing that must be excluded comes back from ANY brand's page.
  SELECT string_agg(DISTINCT f.label, ', ') INTO v_bad
    FROM i3426a_fx f JOIN i3426a_got g ON g.id = f.id
   WHERE f.expect IS NULL;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'A-1/A-2/A-3/A-5/A-6: excluded offerings leaked into a section: %', v_bad;
  END IF;
  SELECT string_agg(DISTINCT f.label, ', ') INTO v_bad
    FROM i3426a_fx f JOIN i3426a_legacy g ON g.id = f.id
   WHERE f.expect IS NULL;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'A-1/A-2: excluded offerings leaked into pg_public_brand_upcoming: %', v_bad;
  END IF;

  -- Every visible control is in exactly one section, the expected one, on its
  -- own brand's page and no other.
  SELECT string_agg(f.label || '->' || COALESCE(
           (SELECT string_agg(g.brand || '/' || g.section_name, '+') FROM i3426a_got g WHERE g.id = f.id),
           'nothing'), '; ')
    INTO v_bad
    FROM i3426a_fx f
   WHERE f.expect IS NOT NULL
     AND (
       (SELECT count(*) FROM i3426a_got g WHERE g.id = f.id) <> 1
       OR NOT EXISTS (SELECT 1 FROM i3426a_got g
                       WHERE g.id = f.id AND g.brand = f.brand AND g.section_name = f.expect)
     );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'A-2/A-4: visible controls misplaced: %', v_bad;
  END IF;

  -- The status-lies fixtures in particular (A-4), named so a failure says which.
  PERFORM 1 FROM i3426a_fx f JOIN i3426a_got g ON g.id = f.id
   WHERE f.label = 'event:ended_but_future' AND g.section_name = 'upcoming';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A-4: an ended-status offering with future dates was not classified by its dates';
  END IF;

  -- The brand page never returns rows the fixture table does not know about.
  SELECT count(*) INTO v_n FROM i3426a_got g WHERE NOT EXISTS (SELECT 1 FROM i3426a_fx f WHERE f.id = g.id);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'A-2: % unexpected rows came back', v_n;
  END IF;

  RAISE NOTICE 'A-1..A-6 PASS — cancelled, hidden, private, discover, draft, unpublished, deleted, read-blocked, other-brand, deleted-brand, paid-not-ready, corrupt and malformed offerings never leak; status never keeps anything current';
END
$sections$;

-- ---------------------------------------------------------------------------
-- A-3 self-heal — once the brand can collect, the paid twins reappear, each in
-- its own section.
-- ---------------------------------------------------------------------------
DO $heal$
DECLARE
  v_bad text;
BEGIN
  UPDATE public.brands SET paystack_subaccount_code = 'ACCT_i3426adv'
   WHERE slug = 'issue-3426-adv';
  IF NOT public.pg_brand_can_collect((SELECT id FROM public.brands WHERE slug = 'issue-3426-adv')) THEN
    RAISE EXCEPTION 'A-3 setup: the brand still cannot collect';
  END IF;
  SET LOCAL ROLE anon;
  CREATE TEMP TABLE i3426a_healed ON COMMIT DROP AS
    SELECT sec.name AS section_name, s.offering_id AS id
      FROM unnest(ARRAY['happening_now', 'upcoming', 'past']) AS sec(name)
     CROSS JOIN LATERAL public.pg_public_brand_offering_section('issue-3426-adv', sec.name, NULL, NULL, 100) s;
  RESET ROLE;
  SELECT string_agg(f.label, ', ') INTO v_bad
    FROM i3426a_fx f
   WHERE f.label LIKE '%:paid:%'
     AND NOT EXISTS (
       SELECT 1 FROM i3426a_healed h WHERE h.id = f.id
          AND h.section_name = CASE split_part(f.label, ':', 3)
                                 WHEN 'future' THEN 'upcoming'
                                 WHEN 'running' THEN 'happening_now'
                                 ELSE 'past' END);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'A-3: paid offerings did not reappear in their sections once the brand could collect: %', v_bad;
  END IF;
  RAISE NOTICE 'A-3 PASS — the paid-supply guard hides, and releases, on all three sections';
END
$heal$;

-- ---------------------------------------------------------------------------
-- A-7 — section names are exact.
-- ---------------------------------------------------------------------------
DO $names$
DECLARE
  v_name text;
  v_n    integer;
BEGIN
  SET LOCAL ROLE anon;
  FOREACH v_name IN ARRAY ARRAY['PAST', 'Past', 'happening now', 'happening-now', '', 'bogus', 'upcoming '] LOOP
    SELECT count(*) INTO v_n FROM public.pg_public_brand_offering_section('issue-3426-adv', v_name, NULL, NULL, 100);
    IF v_n <> 0 THEN
      RAISE EXCEPTION 'A-7: section name % returned % rows', quote_literal(v_name), v_n;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM public.pg_public_brand_offering_section('issue-3426-adv', NULL, NULL, NULL, 100);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'A-7: a NULL section returned % rows', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.pg_public_brand_offering_section(NULL, 'past', NULL, NULL, 100);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'A-7: a NULL brand slug returned % rows', v_n;
  END IF;
  RESET ROLE;
  RAISE NOTICE 'A-7 PASS — unknown, mis-cased, empty and NULL names return nothing';
END
$names$;

-- ---------------------------------------------------------------------------
-- A-8 — ties page one row at a time without loss or repetition.
-- ---------------------------------------------------------------------------
DO $ties$
DECLARE
  v_section   text;
  v_prefix    text;
  v_expected  uuid[];
  v_seen      uuid[];
  v_at        timestamptz;
  v_id        uuid;
  v_row_at    timestamptz;
  v_rows      integer;
  v_guard     integer;
  v_first_at  timestamptz;
BEGIN
  FOREACH v_section IN ARRAY ARRAY['past', 'upcoming'] LOOP
    v_prefix := 'tie:' || v_section || ':%';
    IF v_section = 'past' THEN
      SELECT array_agg(id ORDER BY id DESC) INTO v_expected FROM i3426a_fx WHERE label LIKE v_prefix;
    ELSE
      SELECT array_agg(id ORDER BY id ASC) INTO v_expected FROM i3426a_fx WHERE label LIKE v_prefix;
    END IF;

    -- Start the walk AT the tie instant with a NULL id: strictly after the
    -- instant in the section's direction, so the three tied rows are EXCLUDED...
    SELECT CASE WHEN v_section = 'past' THEN s.ends_at ELSE s.starts_at END INTO v_first_at
      FROM public.pg_public_brand_offering_section('issue-3426-adv', v_section, NULL, NULL, 100) s
     WHERE s.offering_id = v_expected[1];
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_rows
      FROM public.pg_public_brand_offering_section('issue-3426-adv', v_section, v_first_at, NULL, 100) s
     WHERE s.offering_id = ANY (v_expected);
    RESET ROLE;
    IF v_rows <> 0 THEN
      RAISE EXCEPTION 'A-8: a cursor with a NULL id was not strictly after its instant for % (% tied rows returned)', v_section, v_rows;
    END IF;

    -- ... then walk one row at a time from just BEFORE the tie (in the section's
    -- direction) and collect only the tied rows.
    v_at := CASE WHEN v_section = 'past' THEN v_first_at + interval '1 microsecond'
                 ELSE v_first_at - interval '1 microsecond' END;
    v_id := NULL; v_seen := ARRAY[]::uuid[]; v_guard := 0;
    LOOP
      v_guard := v_guard + 1;
      IF v_guard > 10 THEN RAISE EXCEPTION 'A-8: % tie walk did not terminate', v_section; END IF;
      SET LOCAL ROLE anon;
      SELECT s.offering_id, CASE WHEN v_section = 'past' THEN s.ends_at ELSE s.starts_at END
        INTO v_id, v_row_at
        FROM public.pg_public_brand_offering_section('issue-3426-adv', v_section, v_at, v_id, 1) s
       LIMIT 1;
      RESET ROLE;
      EXIT WHEN v_id IS NULL OR v_row_at IS DISTINCT FROM v_first_at;
      v_seen := v_seen || v_id;
      v_at := v_row_at;
    END LOOP;
    IF v_seen IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'A-8: % tie walk returned %, expected %', v_section, v_seen, v_expected;
    END IF;
  END LOOP;
  RAISE NOTICE 'A-8 PASS — tied rows page one at a time, each exactly once, in id order';
END
$ties$;

-- ---------------------------------------------------------------------------
-- A-9 — page size is clamped.
-- ---------------------------------------------------------------------------
DO $clamp$
DECLARE
  v_n integer;
BEGIN
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.pg_public_brand_offering_section('issue-3426-adv-clamp', 'past', NULL, NULL, 1000);
  IF v_n <> 101 THEN RAISE EXCEPTION 'A-9: limit 1000 returned % rows, expected 100 + 1', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.pg_public_brand_offering_section('issue-3426-adv-clamp', 'past', NULL, NULL, 0);
  IF v_n <> 2 THEN RAISE EXCEPTION 'A-9: limit 0 returned % rows, expected 1 + 1', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.pg_public_brand_offering_section('issue-3426-adv-clamp', 'past', NULL, NULL, -5);
  IF v_n <> 2 THEN RAISE EXCEPTION 'A-9: limit -5 returned % rows, expected 1 + 1', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.pg_public_brand_offering_section('issue-3426-adv-clamp', 'past', NULL, NULL, NULL);
  IF v_n <> 31 THEN RAISE EXCEPTION 'A-9: limit NULL returned % rows, expected 30 + 1', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.pg_public_brand_offering_section('issue-3426-adv-clamp', 'past');
  IF v_n <> 31 THEN RAISE EXCEPTION 'A-9: the defaults returned % rows, expected 30 + 1', v_n; END IF;
  RESET ROLE;
  RAISE NOTICE 'A-9 PASS — the page size clamps to 1..100 with has-more';
END
$clamp$;

-- ---------------------------------------------------------------------------
-- A-10 — security posture, read from the catalog and by execution.
-- ---------------------------------------------------------------------------
DO $posture$
DECLARE
  v_denied boolean := false;
  v_cols   text[];
BEGIN
  IF has_function_privilege('anon', 'public.issue_3426_offering_schedule(uuid, text, jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.issue_3426_offering_schedule(uuid, text, jsonb)', 'EXECUTE')
     OR has_function_privilege('public', 'public.issue_3426_offering_schedule(uuid, text, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A-10: the classifier is executable by a public role';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.issue_3426_offering_schedule(uuid, text, jsonb)'::regprocedure) THEN
    RAISE EXCEPTION 'A-10: the classifier became SECURITY DEFINER';
  END IF;

  SET LOCAL ROLE anon;
  BEGIN
    PERFORM * FROM public.issue_3426_offering_schedule(gen_random_uuid(), 'event', NULL);
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  RESET ROLE;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'A-10: anon executed the classifier directly';
  END IF;

  IF NOT (SELECT prosecdef FROM pg_proc
           WHERE oid = 'public.pg_public_brand_offering_section(text, text, timestamptz, uuid, integer)'::regprocedure)
     OR NOT EXISTS (
       SELECT 1 FROM pg_proc p, unnest(p.proconfig) c
        WHERE p.oid = 'public.pg_public_brand_offering_section(text, text, timestamptz, uuid, integer)'::regprocedure
          AND c LIKE 'search_path=%'
     ) THEN
    RAISE EXCEPTION 'A-10: the section reader lost SECURITY DEFINER or its pinned search_path';
  END IF;

  SELECT array_agg(a) INTO v_cols
    FROM pg_proc p, unnest(p.proargnames) a
   WHERE p.oid = 'public.pg_public_brand_offering_section(text, text, timestamptz, uuid, integer)'::regprocedure;
  IF 'theme' = ANY (v_cols) THEN
    RAISE EXCEPTION 'A-10: the section reader projects a theme column — an unstripped address and draft vector';
  END IF;
  IF NOT ('ends_at' = ANY (v_cols)) OR NOT ('section' = ANY (v_cols)) THEN
    RAISE EXCEPTION 'A-10: the section reader lost ends_at or section: %', v_cols;
  END IF;

  RAISE NOTICE 'A-10 PASS — classifier invoker-only and unreachable by anon; reader definer, pinned path, no theme';
  RAISE NOTICE 'issue #3426 implementor adversarial suite PASS';
END
$posture$;

ROLLBACK;
