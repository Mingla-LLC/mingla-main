-- =====================================================================================
-- #2489 — INDEPENDENT TESTER ADVERSARIAL FIXTURE.
--
-- Companion to, and deliberately a DIFFERENT ANGLE from,
-- `issue_2489_address_privacy_server_gate.test.sql`. That file proves the four gated
-- objects withhold for a gated offering and still publish for an opted-out one. This one
-- does not repeat that. It attacks the three things that file does not test:
--
--   TA-1  The predicate's TOTALITY, across twenty-two adversarial value shapes at the
--         flag rather than the single non-boolean string the implementor fixture uses.
--         A privacy predicate that raises is a site-wide outage; a privacy predicate
--         that coerces a truthy-looking string to FALSE is a silent leak. Neither is
--         allowed, and neither is visible from a test that only feeds it `true`,
--         `false`, an absent key and one string.
--
--   TA-2  That exactly ONE of those twenty-two shapes reveals. TA-1 alone is satisfied
--         by a predicate hard-wired to TRUE — which would withhold from everybody and
--         turn a privacy fix into a product outage. TA-1 and TA-2 can only both pass if
--         the predicate actually discriminates.
--
--   TA-3  That the WITHHOLD BRANCH is as total as the predicate that guards it. The
--         predicate is now proven not to raise on a malformed theme; the expression it
--         gates is a separate piece of code with its own failure modes, and a gate whose
--         guard cannot raise but whose body can is not a fail-closed gate — it is a
--         fail-LOUD one. `theme` is `jsonb NOT NULL DEFAULT '{}'` with no constraint of
--         any kind requiring it to be a JSON OBJECT, and an authenticated brand event
--         manager holds UPDATE on that column, so a theme that is a JSON array or a JSON
--         scalar is a shape the schema permits today. The blast radius is not the one
--         offering: the two list paths return a whole market and a whole brand, so a
--         single malformed row takes out every other host's rows in the same response.
--
--   TA-4  Cross-object simultaneity. The implementor fixture asserts each object in its
--         own block. This asserts all four against the SAME pair of offerings inside one
--         transaction, so an object that drifts away from the shared predicate cannot
--         hide behind a differently-seeded neighbour.
--
--   TA-5  Backward compatibility, as `anon`, at runtime rather than on paper. Deployed
--         app builds already in the field keep calling these relations with `select("*")`
--         and cannot be patched. `SELECT *` must still succeed for that role, and the
--         three gated columns must keep their exact names, types and ordinal positions.
--
-- BEHAVIORAL, not textual. Nothing here inspects source text: every assertion performs a
-- real read or a real call as the `anon` role against the applied schema. Everything runs
-- inside one transaction and is ROLLBACKed; no durable state is written.
--
-- Executes against a database that has replayed EVERY migration including
-- 20270523002489_issue_2489_address_privacy_server_gate.sql.
-- =====================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- =====================================================================================
-- TA-1 — PREDICATE TOTALITY.
--
-- Twenty-two shapes. Twenty-one must WITHHOLD; the literal JSON boolean `false` is the
-- only one that may reveal (asserted separately in TA-2). None may raise — the whole
-- battery is evaluated in a single statement, so one raise fails the block.
--
-- The string cases are the ones that matter most. `"true"`, `"TRUE"` and `"1"` are what a
-- form post, a URL query parameter or a loosely-typed client writes when it means TRUE;
-- a predicate that reached for a plain `::boolean` cast would ACCEPT all three and
-- withhold, then raise on `"yes"`. A predicate that reached for a truthiness test would
-- treat `"false"` as truthy and withhold. The rule this file pins is stricter and simpler
-- than either: nothing but a real JSON boolean is ever believed, and everything else
-- fails closed.
-- =====================================================================================
DO $ta1$
DECLARE
  v_leaks text;
  v_count integer;
BEGIN
  SET LOCAL ROLE anon;

  WITH shapes(label, theme) AS (
    VALUES
      ('json boolean true',            '{"business_event":{"hideAddressUntilTicket":true}}'::jsonb),
      ('string "true"',                '{"business_event":{"hideAddressUntilTicket":"true"}}'::jsonb),
      ('string "TRUE"',                '{"business_event":{"hideAddressUntilTicket":"TRUE"}}'::jsonb),
      ('string "1"',                   '{"business_event":{"hideAddressUntilTicket":"1"}}'::jsonb),
      ('string "false"',               '{"business_event":{"hideAddressUntilTicket":"false"}}'::jsonb),
      ('string "no"',                  '{"business_event":{"hideAddressUntilTicket":"no"}}'::jsonb),
      ('string empty',                 '{"business_event":{"hideAddressUntilTicket":""}}'::jsonb),
      ('number 1',                     '{"business_event":{"hideAddressUntilTicket":1}}'::jsonb),
      ('number 0',                     '{"business_event":{"hideAddressUntilTicket":0}}'::jsonb),
      ('number -1',                    '{"business_event":{"hideAddressUntilTicket":-1}}'::jsonb),
      ('json null at the key',         '{"business_event":{"hideAddressUntilTicket":null}}'::jsonb),
      ('object at the key',            '{"business_event":{"hideAddressUntilTicket":{"value":false}}}'::jsonb),
      ('array at the key',             '{"business_event":{"hideAddressUntilTicket":[false]}}'::jsonb),
      ('empty object at the key',      '{"business_event":{"hideAddressUntilTicket":{}}}'::jsonb),
      ('business_event is an array',   '{"business_event":[{"hideAddressUntilTicket":false}]}'::jsonb),
      ('business_event is a string',   '{"business_event":"hideAddressUntilTicket"}'::jsonb),
      ('key absent',                   '{"business_event":{"location":{"venueName":"V"}}}'::jsonb),
      ('key present at wrong depth',   '{"hideAddressUntilTicket":false}'::jsonb),
      ('key in the wrong case',        '{"business_event":{"HideAddressUntilTicket":false}}'::jsonb),
      ('theme is an empty object',     '{}'::jsonb),
      ('theme is a JSON array',        '[{"hideAddressUntilTicket":false}]'::jsonb),
      ('theme is a JSON scalar',       '"hideAddressUntilTicket"'::jsonb)
  )
  SELECT string_agg(s.label, ', ' ORDER BY s.label), count(*)
    INTO v_leaks, v_count
  FROM shapes s
  WHERE public.issue_2489_address_withheld(s.theme) IS DISTINCT FROM true;

  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'TA-1: the address-privacy predicate failed OPEN for % adversarial theme shape(s): %',
      v_count, v_leaks;
  END IF;

  -- SQL NULL is a separate code path from every JSON shape above: the argument never
  -- reaches the JSON operators at all. Four objects call this predicate and nothing in
  -- the schema guarantees a future fifth caller passes a non-NULL theme.
  IF public.issue_2489_address_withheld(NULL) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TA-1: the address-privacy predicate failed OPEN for a SQL NULL theme';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'TA-1 PASS — 22 adversarial theme shapes and a SQL NULL all withhold, and none raises';
END $ta1$;

-- =====================================================================================
-- TA-2 — THE PREDICATE MUST DISCRIMINATE.
--
-- Anti-vacuity for TA-1. A predicate defined as `SELECT true` passes every assertion in
-- TA-1 and destroys the product: every host who never touched the setting, and every host
-- who deliberately turned it OFF, would have their venue withheld from the public page,
-- the discover feed and the brand feed. A fix that withholds from everyone is an outage,
-- not a privacy fix.
--
-- Exactly one input in this file's vocabulary may reveal: the literal JSON boolean
-- `false`. Not `"false"`, not `0`, not a missing key.
-- =====================================================================================
DO $ta2$
DECLARE
  v_revealed integer;
BEGIN
  SET LOCAL ROLE anon;

  IF public.issue_2489_address_withheld(
       '{"business_event":{"hideAddressUntilTicket":false}}'::jsonb) IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'TA-2: a host who deliberately turned the setting OFF is still being withheld — the predicate is withholding unconditionally';
  END IF;

  -- And nothing that merely LOOKS false is allowed to join it.
  SELECT count(*) INTO v_revealed
  FROM (VALUES
    ('{"business_event":{"hideAddressUntilTicket":"false"}}'::jsonb),
    ('{"business_event":{"hideAddressUntilTicket":0}}'::jsonb),
    ('{"business_event":{"hideAddressUntilTicket":null}}'::jsonb),
    ('{}'::jsonb)
  ) AS lookalikes(theme)
  WHERE public.issue_2489_address_withheld(lookalikes.theme) = false;

  IF v_revealed <> 0 THEN
    RAISE EXCEPTION
      'TA-2: % false-LOOKING but non-boolean value(s) were treated as an opt-out — the predicate is coercing rather than type-checking',
      v_revealed;
  END IF;

  RESET ROLE;
  RAISE NOTICE 'TA-2 PASS — the JSON boolean false is the only input that reveals';
END $ta2$;

-- =====================================================================================
-- TA-3 — THE WITHHOLD BRANCH MUST BE AS TOTAL AS THE PREDICATE.
--
-- The predicate is now proven (TA-1) never to raise. The expression it guards is separate
-- code. On the withhold branch each gated object removes a nested key from the theme, and
-- that removal is only defined when the theme is a JSON OBJECT whose `business_event`, if
-- present, is also an object. `theme` is `jsonb NOT NULL DEFAULT '{}'` with no CHECK, no
-- domain and no trigger constraining its shape, and `authenticated` holds UPDATE on the
-- column behind an RLS policy that admits any brand event manager — so a theme that is a
-- JSON array, or a JSON scalar, is a value the schema accepts today.
--
-- Two offerings, both malformed in that way, both with the gate ENGAGED (neither carries
-- the flag, and an absent flag withholds). Every one of the four anon-reachable objects
-- must return them without raising. A NULL address is an honest answer; an error is not,
-- and on the two LIST paths it is not even confined to the offending row — those calls
-- return a whole market and a whole brand, so one malformed row answers every other
-- host's rows in the same response with an exception.
--
-- This is a robustness assertion, not a privacy one: reaching the state needs an
-- authenticated write, and no address is disclosed either way.
-- =====================================================================================
DO $ta3$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_brand  uuid := gen_random_uuid();
  v_bslug  text := 'ta2489-' || replace(gen_random_uuid()::text, '-', '');
  v_city   text := 'TA2489 City ' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_label  text;
  v_theme  jsonb;
  v_id     uuid;
  v_ids    uuid[] := '{}';
  v_sink   jsonb;
  v_rows   integer;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'ta2489 brand', v_bslug, 'GBP');

  FOR v_label, v_theme IN
    SELECT * FROM (VALUES
      ('array_theme',  '[{"hideAddressUntilTicket":false}]'::jsonb),
      ('scalar_theme', '"a theme that is not an object"'::jsonb)
    ) AS t(label, theme)
  LOOP
    v_id := gen_random_uuid();
    INSERT INTO public.events (
      id, brand_id, title, slug, event_type, status, visibility, timezone,
      currency, published_at, city, show_on_discover,
      location_text, location_geo, theme
    ) VALUES (
      v_id, v_brand, 'ta2489 ' || v_label,
      'ta2489-' || v_label || '-' || replace(v_id::text, '-', ''),
      'event', 'scheduled', 'public', 'UTC',
      'GBP', now(), v_city, true,
      'ta2489 Venue', point(-0.1276, 51.5072), '{}'::jsonb
    );
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (v_id, now() + interval '30 days', now() + interval '30 days 4 hours', 'UTC', true);
    -- Written after the insert so any INSERT-time shape expectation elsewhere in the
    -- schema is not what is under test here; the UPDATE path is the one a host reaches.
    UPDATE public.events SET theme = v_theme WHERE id = v_id;
    v_ids := v_ids || v_id;
  END LOOP;

  SET LOCAL ROLE anon;

  BEGIN
    SELECT jsonb_agg(to_jsonb(v)) INTO v_sink
    FROM public.business_public_events_view v
    WHERE v.id = ANY (v_ids);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION
      'TA-3: business_public_events_view RAISED for anon on an offering whose theme is not a JSON object (SQLSTATE %, %) — the gate is fail-loud, not fail-closed',
      SQLSTATE, SQLERRM;
  END;

  BEGIN
    SELECT jsonb_agg(to_jsonb(v)) INTO v_sink
    FROM public.events_public_view v
    WHERE v.id = ANY (v_ids);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION
      'TA-3: events_public_view RAISED for anon on an offering whose theme is not a JSON object (SQLSTATE %, %) — the gate is fail-loud, not fail-closed',
      SQLSTATE, SQLERRM;
  END;

  BEGIN
    SELECT public.pg_discover_business_events(ARRAY[v_city], now() - interval '1 day')
      INTO v_sink;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION
      'TA-3: pg_discover_business_events RAISED for anon and returned NO rows AT ALL for the whole market because one offering''s theme is not a JSON object (SQLSTATE %, %)',
      SQLSTATE, SQLERRM;
  END;

  BEGIN
    SELECT count(*) INTO v_rows
    FROM public.pg_public_brand_upcoming(v_bslug, now() - interval '1 day', 30);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION
      'TA-3: pg_public_brand_upcoming RAISED for anon and returned NO rows AT ALL for the whole brand because one offering''s theme is not a JSON object (SQLSTATE %, %)',
      SQLSTATE, SQLERRM;
  END;

  RESET ROLE;
  RAISE NOTICE 'TA-3 PASS — a theme that is not a JSON object withholds honestly on all four anon paths instead of raising';
END $ta3$;

-- =====================================================================================
-- TA-4 — CROSS-OBJECT SIMULTANEITY.
--
-- One gated offering and one opted-out offering, same brand, same market, same
-- transaction, read as `anon` through all four objects. For the gated one all three
-- vectors must be absent everywhere AND the three values that must SURVIVE (the venue
-- name, the flag itself, and the privacy-safe city centroid) must still be there — a fix
-- that withholds the venue name too breaks the venue card, and one that withholds the
-- flag leaves every client unable to explain the blank to the buyer. For the opted-out
-- one all three vectors must be present everywhere.
--
-- Asserting both offerings against all four objects in one transaction is what the
-- per-object blocks in the implementor fixture cannot do: an object that quietly stopped
-- referencing the shared predicate and re-implemented the rule its own way still passes a
-- block that seeds its own row, and fails here the moment its answer differs from its
-- three siblings' for the same offering.
-- =====================================================================================
DO $ta4$
DECLARE
  v_user     uuid := gen_random_uuid();
  v_brand    uuid := gen_random_uuid();
  v_bslug    text := 'ta2489b-' || replace(gen_random_uuid()::text, '-', '');
  v_city     text := 'TA2489 Market ' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  v_gated    uuid := gen_random_uuid();
  v_open     uuid := gen_random_uuid();
  v_label    text;
  v_id       uuid;
  v_theme    jsonb;
  v_street   text := '221B Baker Street';
  v_feed     jsonb;
  v_r        record;
  v_j        jsonb;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'ta2489 brand b', v_bslug, 'GBP');

  FOR v_label, v_id, v_theme IN
    SELECT * FROM (VALUES
      ('gated', v_gated, jsonb_build_object('business_event', jsonb_build_object(
         'hideAddressUntilTicket', true,
         'location', jsonb_build_object('venueName', 'TA2489 Venue', 'address', v_street)))),
      ('open',  v_open,  jsonb_build_object('business_event', jsonb_build_object(
         'hideAddressUntilTicket', false,
         'location', jsonb_build_object('venueName', 'TA2489 Venue', 'address', v_street))))
    ) AS t(label, id, theme)
  LOOP
    INSERT INTO public.events (
      id, brand_id, title, slug, event_type, status, visibility, timezone,
      currency, published_at, city, show_on_discover,
      location_text, location_geo, city_geo, theme
    ) VALUES (
      v_id, v_brand, 'ta2489 ' || v_label,
      'ta2489b-' || v_label || '-' || replace(v_id::text, '-', ''),
      'event', 'scheduled', 'public', 'UTC',
      'GBP', now(), v_city, true,
      'TA2489 Venue · ' || v_street, point(-0.1276, 51.5072),
      public.ST_SetSRID(public.ST_MakePoint(-0.1, 51.5), 4326), v_theme
    );
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (v_id, now() + interval '30 days', now() + interval '30 days 4 hours', 'UTC', true);
  END LOOP;

  SET LOCAL ROLE anon;

  ---------------------------------------------------------------------------- object 1
  SELECT location_text, location_geo, public_theme, city_geo INTO v_r
  FROM public.business_public_events_view WHERE id = v_gated;
  IF v_r.location_geo IS NOT NULL OR v_r.location_text IS NOT NULL
     OR (v_r.public_theme #>> '{business_event,location,address}') IS NOT NULL THEN
    RAISE EXCEPTION 'TA-4: business_public_events_view still emits a withheld vector to anon for the gated offering';
  END IF;
  IF (v_r.public_theme #>> '{business_event,location,venueName}') IS NULL THEN
    RAISE EXCEPTION 'TA-4: business_public_events_view withheld the VENUE NAME — the venue card cannot render';
  END IF;
  IF (v_r.public_theme #>> '{business_event,hideAddressUntilTicket}') IS NULL THEN
    RAISE EXCEPTION 'TA-4: business_public_events_view withheld the flag itself — no client can explain the blank';
  END IF;
  IF v_r.city_geo IS NULL THEN
    RAISE EXCEPTION 'TA-4: business_public_events_view withheld the privacy-safe city centroid, which is exempt by design';
  END IF;

  SELECT location_text, location_geo, public_theme INTO v_r
  FROM public.business_public_events_view WHERE id = v_open;
  IF v_r.location_geo IS NULL OR v_r.location_text IS NULL
     OR (v_r.public_theme #>> '{business_event,location,address}') IS DISTINCT FROM v_street THEN
    RAISE EXCEPTION 'TA-4: business_public_events_view withheld from an offering whose host opted OUT — this is a product outage, not a privacy fix';
  END IF;

  ---------------------------------------------------------------------------- object 2
  SELECT location_text, location_geo, theme INTO v_r
  FROM public.events_public_view WHERE id = v_gated;
  IF v_r.location_geo IS NOT NULL OR v_r.location_text IS NOT NULL
     OR (v_r.theme #>> '{business_event,location,address}') IS NOT NULL THEN
    RAISE EXCEPTION 'TA-4: events_public_view still emits a withheld vector to anon for the gated offering';
  END IF;
  IF (v_r.theme #>> '{business_event,location,venueName}') IS NULL THEN
    RAISE EXCEPTION 'TA-4: events_public_view withheld the VENUE NAME';
  END IF;

  SELECT location_text, location_geo, theme INTO v_r
  FROM public.events_public_view WHERE id = v_open;
  IF v_r.location_geo IS NULL OR v_r.location_text IS NULL
     OR (v_r.theme #>> '{business_event,location,address}') IS DISTINCT FROM v_street THEN
    RAISE EXCEPTION 'TA-4: events_public_view withheld from an offering whose host opted OUT';
  END IF;

  ---------------------------------------------------------------------------- object 3
  SELECT public.pg_discover_business_events(ARRAY[v_city], now() - interval '1 day') INTO v_feed;

  SELECT r INTO v_j FROM jsonb_array_elements(v_feed -> 'rows') r
   WHERE (r ->> 'id') = v_gated::text;
  IF v_j IS NULL THEN
    RAISE EXCEPTION 'TA-4: the gated offering vanished from the discover feed — suppressing the ROW is a discovery regression, not an address gate';
  END IF;
  IF v_j -> 'location_geo' <> 'null'::jsonb OR v_j -> 'location_text' <> 'null'::jsonb
     OR (v_j #>> '{theme,business_event,location,address}') IS NOT NULL THEN
    RAISE EXCEPTION 'TA-4: pg_discover_business_events still emits a withheld vector to anon for the gated offering';
  END IF;
  IF (v_j #>> '{theme,business_event,location,venueName}') IS NULL THEN
    RAISE EXCEPTION 'TA-4: pg_discover_business_events withheld the VENUE NAME';
  END IF;

  SELECT r INTO v_j FROM jsonb_array_elements(v_feed -> 'rows') r
   WHERE (r ->> 'id') = v_open::text;
  IF v_j IS NULL
     OR v_j -> 'location_geo' = 'null'::jsonb
     OR (v_j #>> '{theme,business_event,location,address}') IS DISTINCT FROM v_street THEN
    RAISE EXCEPTION 'TA-4: pg_discover_business_events withheld from an offering whose host opted OUT, in the same response as a gated one';
  END IF;

  ---------------------------------------------------------------------------- object 4
  SELECT theme INTO v_j FROM public.pg_public_brand_upcoming(v_bslug, now() - interval '1 day', 30)
   WHERE offering_id = v_gated;
  IF v_j IS NULL THEN
    RAISE EXCEPTION 'TA-4: the gated offering vanished from the brand feed';
  END IF;
  IF (v_j #>> '{business_event,location,address}') IS NOT NULL THEN
    RAISE EXCEPTION 'TA-4: pg_public_brand_upcoming still hands anon the structured street address of the gated offering';
  END IF;
  IF (v_j #>> '{business_event,location,venueName}') IS NULL THEN
    RAISE EXCEPTION 'TA-4: pg_public_brand_upcoming withheld the VENUE NAME';
  END IF;

  SELECT theme INTO v_j FROM public.pg_public_brand_upcoming(v_bslug, now() - interval '1 day', 30)
   WHERE offering_id = v_open;
  IF v_j IS NULL OR (v_j #>> '{business_event,location,address}') IS DISTINCT FROM v_street THEN
    RAISE EXCEPTION 'TA-4: pg_public_brand_upcoming withheld from an offering whose host opted OUT';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'TA-4 PASS — all four objects agree on the same two offerings: gated withholds, opted-out publishes, venue name and centroid survive';
END $ta4$;

-- =====================================================================================
-- TA-5 — BACKWARD COMPATIBILITY, AS `anon`, AT RUNTIME.
--
-- App builds already on phones cannot be patched and keep reading these relations with
-- `select("*")`. Two things would break them silently: a column-level REVOKE (a `SELECT *`
-- against a relation with a revoked column raises permission denied rather than omitting
-- it), and a rename / retype / reorder of the gated columns.
--
-- So: `SELECT *` must SUCCEED for `anon` on both views for a gated offering, and the
-- gated columns must still be at the names, types and ordinal positions the shipped
-- clients were compiled against. Only the three gated columns are pinned by ordinal — a
-- later migration appending a new column at the end is legitimate and must not fail here.
-- =====================================================================================
DO $ta5$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_brand  uuid := gen_random_uuid();
  v_id     uuid := gen_random_uuid();
  v_sink   jsonb;
  v_bad    text;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'ta2489 brand c', 'ta2489c-' || replace(v_id::text, '-', ''), 'GBP');
  INSERT INTO public.events (
    id, brand_id, title, slug, event_type, status, visibility, timezone,
    currency, published_at, city, show_on_discover, location_text, location_geo, theme
  ) VALUES (
    v_id, v_brand, 'ta2489 compat', 'ta2489c-' || replace(v_id::text, '-', ''),
    'event', 'scheduled', 'public', 'UTC', 'GBP', now(), 'TA2489 Compat City', true,
    'TA2489 Venue · 221B Baker Street', point(-0.1276, 51.5072),
    '{"business_event":{"hideAddressUntilTicket":true,"location":{"venueName":"TA2489 Venue","address":"221B Baker Street"}}}'::jsonb
  );
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (v_id, now() + interval '30 days', now() + interval '30 days 4 hours', 'UTC', true);

  SET LOCAL ROLE anon;

  BEGIN
    SELECT to_jsonb(v) INTO v_sink FROM public.business_public_events_view v WHERE v.id = v_id;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION
      'TA-5: a shipped client''s select("*") on business_public_events_view now RAISES for anon (SQLSTATE %, %) — a withheld value must degrade to NULL, never to an error',
      SQLSTATE, SQLERRM;
  END;
  IF v_sink IS NULL THEN
    RAISE EXCEPTION 'TA-5: select("*") on business_public_events_view returned no row for a published public offering';
  END IF;
  IF NOT (v_sink ? 'location_text' AND v_sink ? 'location_geo' AND v_sink ? 'public_theme' AND v_sink ? 'city_geo') THEN
    RAISE EXCEPTION 'TA-5: business_public_events_view DROPPED a column a shipped client reads — omitting a column is not the same as withholding its value';
  END IF;

  BEGIN
    SELECT to_jsonb(v) INTO v_sink FROM public.events_public_view v WHERE v.id = v_id;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION
      'TA-5: a shipped client''s select("*") on events_public_view now RAISES for anon (SQLSTATE %, %)',
      SQLSTATE, SQLERRM;
  END;
  IF v_sink IS NULL OR NOT (v_sink ? 'location_text' AND v_sink ? 'location_geo' AND v_sink ? 'theme') THEN
    RAISE EXCEPTION 'TA-5: events_public_view dropped a column a shipped client reads, or returned no row';
  END IF;

  RESET ROLE;

  -- Names, types and ordinal positions of the three gated columns, as the shipped clients
  -- were compiled against them.
  SELECT string_agg(format('%s.%s expected attnum %s type %s', e.rel, e.col, e.num, e.typ), '; ')
    INTO v_bad
  FROM (VALUES
    ('business_public_events_view', 'location_text', 17, 'text'),
    ('business_public_events_view', 'public_theme',  32, 'jsonb'),
    ('business_public_events_view', 'location_geo',  50, 'point'),
    ('business_public_events_view', 'city_geo',      65, 'geometry(Point,4326)'),
    ('events_public_view',          'location_text',  6, 'text'),
    ('events_public_view',          'location_geo',   7, 'point'),
    ('events_public_view',          'theme',         15, 'jsonb')
  ) AS e(rel, col, num, typ)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = e.rel
      AND a.attname = e.col
      AND a.attnum = e.num
      AND format_type(a.atttypid, a.atttypmod) = e.typ
      AND NOT a.attisdropped
  );

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'TA-5: a gated column was renamed, retyped or reordered — app builds already in the field decode these relations positionally-compatibly and cannot be patched: %',
      v_bad;
  END IF;

  RAISE NOTICE 'TA-5 PASS — anon select("*") still succeeds on both views and the gated columns kept their names, types and ordinals';
END $ta5$;

ROLLBACK;
