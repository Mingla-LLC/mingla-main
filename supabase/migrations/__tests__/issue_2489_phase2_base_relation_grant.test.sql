-- Why this exists: phase 1 gated nine derived read paths and an unauthenticated caller
-- could still read the withheld values straight off the base relation — and could still
-- recover them WITHOUT selecting them, by filtering on them. This suite proves the base
-- relation is closed to `anon` against BOTH vectors, through direct reads, through
-- `SELECT *`, and through an embedded read off a child table; and it proves, with equal
-- weight, that anonymous browsing still works, because a revoke that closes the hole by
-- closing the product is an outage, not a fix.
--
-- #2489 phase 2 implementor behavioral fixture. PostgreSQL 17 replay target.
--
-- Executes against a database that has replayed EVERY migration including
-- 20270528002489_issue_2489_phase2_base_relation_grant.sql. Every row is created inside
-- one transaction and ROLLBACKed; nothing here writes durable state.
--
-- BEHAVIORAL, not textual. No assertion is satisfied by source text: each one performs a
-- real read as the `anon` role against the applied schema and reports what that role
-- actually got — a value, or a permission error.
--
-- THE ASSERTION THIS FILE EXISTS FOR is NC-2. The form of this fix that was specified
-- first — a column-level REVOKE — is a NO-OP while the role holds a table-level grant,
-- and it is a no-op silently: it applies, exits zero, and changes nothing. NC-2 stages
-- exactly that mistake inside a savepoint and proves the read still succeeds. Without it
-- this whole suite could pass against a schema that leaks, on some future day when
-- someone "restores" a table-level grant for an unrelated reason.
\set ON_ERROR_STOP on

BEGIN;

-- =====================================================================================
-- EXECUTED-ASSERTION LEDGER. Same device as the phase 1 fixture, for the same reason: a
-- privacy suite can be silenced without deleting a line — a constant and an early return
-- leave every assertion in the file, reviewable and unreachable, and an append-only gate
-- sees no removal. Each block records itself HERE on its last line, after its assertions
-- have run, and the final check compares the recorded set against the declared set in
-- both directions. A scenario that stopped executing is a failure, not a silence.
-- =====================================================================================
CREATE TEMP TABLE i2489p2_executed (scenario text PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE i2489p2_ids (label text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;

-- =====================================================================================
-- SEED — one published, public, scheduled offering with a real pin, a real combined
-- address string and a real gated theme, plus a child row on `event_dates` so the
-- embedded-read vector has something to travel through. Visible to `anon` through the
-- public read policy, which is what makes every refusal below attributable to the GRANT
-- and not to row visibility.
-- =====================================================================================
DO $seed$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_id    uuid := gen_random_uuid();
  v_geo   point := point(-0.1276, 51.5072);
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug, default_currency)
    VALUES (v_brand, v_user, 'i2489p2 brand',
            'i2489p2-brand-' || replace(gen_random_uuid()::text, '-', ''), 'GBP');

  INSERT INTO public.events (
    id, brand_id, title, slug, event_type, status, visibility, timezone,
    currency, published_at, city, show_on_discover, rsvp_discoverable,
    location_text, location_geo, theme
  ) VALUES (
    v_id, v_brand, 'i2489p2 gated', 'i2489p2-gated-' || replace(v_id::text, '-', ''),
    'event', 'scheduled', 'public', 'UTC', 'GBP', now(), 'i2489p2 City', true, false,
    'i2489p2 Venue · 221B Baker Street', v_geo,
    jsonb_build_object('business_event', jsonb_build_object(
      'hideAddressUntilTicket', true,
      'location', jsonb_build_object('venueName','i2489p2 Venue','address','221B Baker Street')))
  );
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (v_id, now() + interval '30 days', now() + interval '30 days 4 hours', 'UTC', true);

  INSERT INTO i2489p2_ids(label, id) VALUES ('brand', v_brand), ('host', v_user), ('gated', v_id);
  RAISE NOTICE 'SEED OK — one anon-visible gated offering with a pin, an address string and a child date';
END $seed$;

-- =====================================================================================
-- P2-1 — THE GRANT SHAPE ITSELF. anon holds NO table-level SELECT on the base relation.
--
-- This is first because every other refusal in this file depends on it, and because it
-- is the single assertion that distinguishes the fix that works from the fix that was
-- specified. A column-level revoke leaves this TRUE and changes nothing.
-- =====================================================================================
DO $t$
BEGIN
  IF has_table_privilege('anon', 'public.events', 'SELECT') THEN
    RAISE EXCEPTION 'P2-1: anon holds TABLE-level SELECT on public.events. While that is true every column-level revoke on this relation is a silent no-op and every refusal this suite claims to prove is unreachable.';
  END IF;
  IF has_column_privilege('anon', 'public.events', 'location_geo', 'SELECT') THEN
    RAISE EXCEPTION 'P2-1: anon can select public.events.location_geo';
  END IF;
  IF has_column_privilege('anon', 'public.events', 'location_text', 'SELECT') THEN
    RAISE EXCEPTION 'P2-1: anon can select public.events.location_text';
  END IF;
  RAISE NOTICE 'P2-1 PASS — no table-level grant; neither withheld column is reachable';
  INSERT INTO i2489p2_executed(scenario) VALUES ('P2-1');
END $t$;

-- =====================================================================================
-- P2-2 — PROJECTION. An anonymous caller asking for either withheld column is refused.
-- =====================================================================================
DO $t$
DECLARE
  v_id   uuid := (SELECT id FROM i2489p2_ids WHERE label = 'gated');
  v_sink text;
  v_got  boolean;
  v_err  text;
BEGIN
  SET LOCAL ROLE anon;

  v_got := false;
  BEGIN
    EXECUTE 'SELECT location_geo::text FROM public.events WHERE id = $1' INTO v_sink
      USING v_id;
    v_got := true;
  EXCEPTION WHEN insufficient_privilege THEN v_err := SQLERRM;
  END;
  IF v_err IS NOT NULL AND position('events' in v_err) = 0 THEN
    RAISE EXCEPTION 'FIXTURE FAULT: the read was refused, but for something other than the relation under test (%). A refusal that is not about public.events proves nothing.', v_err;
  END IF;
  v_err := NULL;
  IF v_got THEN
    RAISE EXCEPTION 'P2-2: anon read the exact pin directly off public.events';
  END IF;

  v_got := false;
  BEGIN
    EXECUTE 'SELECT location_text FROM public.events WHERE id = $1' INTO v_sink
      USING v_id;
    v_got := true;
  EXCEPTION WHEN insufficient_privilege THEN v_err := SQLERRM;
  END;
  IF v_err IS NOT NULL AND position('events' in v_err) = 0 THEN
    RAISE EXCEPTION 'FIXTURE FAULT: the read was refused, but for something other than the relation under test (%). A refusal that is not about public.events proves nothing.', v_err;
  END IF;
  v_err := NULL;
  IF v_got THEN
    RAISE EXCEPTION 'P2-2: anon read the combined address string directly off public.events';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'P2-2 PASS — projecting either withheld column is refused';
  INSERT INTO i2489p2_executed(scenario) VALUES ('P2-2');
END $t$;

-- =====================================================================================
-- P2-3 — THE FILTER ORACLE. The half people forget.
--
-- A caller who may SELECT a column may also REFERENCE it — in a WHERE clause, in an
-- ORDER BY, in a GROUP BY. So a projection gate leaves the value recoverable by
-- bisection: ask "how many rows have location_geo in this box", halve, repeat. Postgres
-- requires the column privilege to reference the column at all, not merely to output it,
-- which is why withdrawing the grant closes the oracle and nulling a projection does not.
--
-- Four reference shapes, because closing only the one people test is how this reopens.
-- =====================================================================================
DO $t$
DECLARE
  v_sink text;
  v_open text[] := ARRAY[]::text[];
  v_shape text;
  v_sql   text;
BEGIN
  SET LOCAL ROLE anon;
  FOR v_shape, v_sql IN
    SELECT * FROM (VALUES
      ('WHERE IS NOT NULL',  'SELECT count(*)::text FROM public.events WHERE location_geo IS NOT NULL'),
      ('WHERE bisecting',    'SELECT count(*)::text FROM public.events WHERE location_geo[0] BETWEEN -1 AND 1'),
      ('WHERE on the string','SELECT count(*)::text FROM public.events WHERE location_text LIKE ''%Baker%'''),
      ('ORDER BY',           'SELECT id::text FROM public.events ORDER BY location_text LIMIT 1')
    ) AS s(shape, sql)
  LOOP
    BEGIN
      EXECUTE v_sql INTO v_sink;
      v_open := array_append(v_open, v_shape);
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  RESET ROLE;

  IF cardinality(v_open) > 0 THEN
    RAISE EXCEPTION 'P2-3: the filter oracle is OPEN. anon can still reference a withheld column without projecting it, and can therefore bisect its value. Reachable shapes: %', array_to_string(v_open, '; ');
  END IF;

  RAISE NOTICE 'P2-3 PASS — all four reference shapes refused; the value cannot be recovered by filtering';
  INSERT INTO i2489p2_executed(scenario) VALUES ('P2-3');
END $t$;

-- =====================================================================================
-- P2-4 — `SELECT *`. Every star-select against this relation now fails for anon. That is
-- the intended, deliberate consequence of the grant shape and the reason the two
-- anonymous buyer-web resolvers were narrowed to explicit column lists in phase 1 BEFORE
-- this grant changed. Pinned so nobody "restores" a star-select and takes a live route
-- down.
-- =====================================================================================
DO $t$
DECLARE
  v_id   uuid := (SELECT id FROM i2489p2_ids WHERE label = 'gated');
  v_sink jsonb;
  v_got  boolean := false;
  v_err  text;
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    EXECUTE 'SELECT to_jsonb(e) FROM public.events e WHERE e.id = $1' INTO v_sink
      USING v_id;
    v_got := true;
  EXCEPTION WHEN insufficient_privilege THEN v_err := SQLERRM;
  END;
  IF v_err IS NOT NULL AND position('events' in v_err) = 0 THEN
    RAISE EXCEPTION 'FIXTURE FAULT: the read was refused, but for something other than the relation under test (%). A refusal that is not about public.events proves nothing.', v_err;
  END IF;
  v_err := NULL;
  RESET ROLE;

  IF v_got THEN
    RAISE EXCEPTION 'P2-4: anon completed a whole-row read of public.events, which carries both withheld columns';
  END IF;
  RAISE NOTICE 'P2-4 PASS — a whole-row read is refused';
  INSERT INTO i2489p2_executed(scenario) VALUES ('P2-4');
END $t$;

-- =====================================================================================
-- P2-5 — EMBEDDING, AND ITS ANTI-VACUITY TWIN.
--
-- Many anon-readable child tables carry a foreign key to this relation, and PostgREST
-- resource embedding turns each of them into another door to the parent's columns. The
-- SQL that PostgREST emits for an embed is a join, so this asserts on the join.
--
-- The twin matters as much as the refusal: an embed that reaches a PERMITTED column must
-- still work, or every child-table read on the public site has just broken.
-- =====================================================================================
DO $t$
DECLARE
  v_id   uuid := (SELECT id FROM i2489p2_ids WHERE label = 'gated');
  v_sink text;
  v_got  boolean := false;
  v_err  text;
BEGIN
  SET LOCAL ROLE anon;

  BEGIN
    EXECUTE 'SELECT e.location_text FROM public.event_dates d JOIN public.events e ON e.id = d.event_id WHERE d.event_id = $1' INTO v_sink
      USING v_id;
    v_got := true;
  EXCEPTION WHEN insufficient_privilege THEN v_err := SQLERRM;
  END;
  IF v_err IS NOT NULL AND position('events' in v_err) = 0 THEN
    RAISE EXCEPTION 'FIXTURE FAULT: the read was refused, but for something other than the relation under test (%). A refusal that is not about public.events proves nothing.', v_err;
  END IF;
  v_err := NULL;
  IF v_got THEN
    RAISE EXCEPTION 'P2-5: an anonymous embedded read off a child table reached a withheld column on the parent';
  END IF;

  -- Twin. This one MUST succeed.
  EXECUTE 'SELECT e.title FROM public.event_dates d JOIN public.events e ON e.id = d.event_id WHERE d.event_id = $1' INTO v_sink
    USING v_id;
  RESET ROLE;

  IF v_sink IS DISTINCT FROM 'i2489p2 gated' THEN
    RAISE EXCEPTION 'P2-5 twin: an anonymous embedded read of a PERMITTED parent column returned % — every child-table read on the public site depends on this working', COALESCE(v_sink, '<null>');
  END IF;

  RAISE NOTICE 'P2-5 PASS — the embedding door is closed to withheld columns and open to permitted ones';
  INSERT INTO i2489p2_executed(scenario) VALUES ('P2-5');
END $t$;

-- =====================================================================================
-- P2-6 — ANTI-VACUITY: THE TRIP RESOLVER.
--
-- The exact column list the live anonymous buyer-web trip resolver sends
-- (mingla-business/src/services/publicEventsService.ts). If this fails, the trip detail
-- and trip checkout routes are returning permission errors to every anonymous visitor.
-- This is the assertion that decides whether the grant set is right, and it is the reason
-- `theme` is NOT withheld.
-- =====================================================================================
DO $t$
DECLARE
  v_id   uuid := (SELECT id FROM i2489p2_ids WHERE label = 'gated');
  v_sink jsonb;
BEGIN
  SET LOCAL ROLE anon;
  EXECUTE 'SELECT to_jsonb(x) FROM (SELECT id,brand_id,title,description,slug,status,visibility,timezone,theme,'
       || 'cover_media_url,cover_media_type,published_at,created_at,updated_at,'
       || 'refund_policy,booking_deadline,bookings_closed,bookings_closed_at '
       || 'FROM public.events WHERE id = $1) x' INTO v_sink
    USING v_id;
  RESET ROLE;

  IF v_sink IS NULL OR v_sink ->> 'title' IS DISTINCT FROM 'i2489p2 gated' THEN
    RAISE EXCEPTION 'P2-6: the anonymous trip resolver''s column list did not return its row';
  END IF;
  RAISE NOTICE 'P2-6 PASS — the anonymous trip resolver still reads every column it sends';
  INSERT INTO i2489p2_executed(scenario) VALUES ('P2-6');
END $t$;

-- =====================================================================================
-- P2-7 — ANTI-VACUITY: THE EXPERIENCE RESOLVER, INCLUDING ITS EMBEDDED BRAND READ.
--
-- The exact column list the live anonymous experience resolver sends
-- (mingla-business/src/services/publicExperienceService.ts), embedded brand join and all.
-- =====================================================================================
DO $t$
DECLARE
  v_id   uuid := (SELECT id FROM i2489p2_ids WHERE label = 'gated');
  v_sink jsonb;
BEGIN
  SET LOCAL ROLE anon;
  EXECUTE 'SELECT to_jsonb(x) FROM (SELECT e.id,e.brand_id,e.title,e.description,e.slug,e.status,e.visibility,'
       || 'e.timezone,e.theme,e.theme_color_override,e.theme_font_override,e.theme_animation_override,'
       || 'e.cover_media_url,e.cover_media_type,e.is_recurring,e.is_multi_date,e.recurrence_rules,'
       || 'e.experience_intents,b.id AS b_id,b.slug AS b_slug,b.name AS b_name,b.description AS b_description,'
       || 'b.cover_media_url AS b_cover,b.cover_media_type AS b_cover_type,b.cover_hue AS b_hue '
       || 'FROM public.events e JOIN public.brands b ON b.id = e.brand_id WHERE e.id = $1) x' INTO v_sink
    USING v_id;
  RESET ROLE;

  IF v_sink IS NULL OR v_sink ->> 'b_name' IS DISTINCT FROM 'i2489p2 brand' THEN
    RAISE EXCEPTION 'P2-7: the anonymous experience resolver''s column list and embedded brand read did not return their row';
  END IF;
  RAISE NOTICE 'P2-7 PASS — the anonymous experience resolver still reads every column it sends';
  INSERT INTO i2489p2_executed(scenario) VALUES ('P2-7');
END $t$;

-- =====================================================================================
-- P2-8 — ANTI-VACUITY: ORDINARY ANONYMOUS BROWSING.
--
-- Counting, filtering and ordering on PERMITTED columns must all still work. This is the
-- assertion that separates "the hole is closed" from "the table is closed".
-- =====================================================================================
DO $t$
DECLARE v_count integer; v_title text;
BEGIN
  SET LOCAL ROLE anon;
  EXECUTE 'SELECT count(*) FROM public.events' INTO v_count;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'P2-8: an anonymous caller can no longer count the published offerings';
  END IF;
  EXECUTE 'SELECT title FROM public.events WHERE status = $1 AND visibility = $2 AND city = $3 ORDER BY published_at DESC LIMIT 1' INTO v_title
    USING 'scheduled', 'public', 'i2489p2 City';
  RESET ROLE;

  IF v_title IS DISTINCT FROM 'i2489p2 gated' THEN
    RAISE EXCEPTION 'P2-8: an anonymous filter+order over permitted columns returned % — public browsing is broken', COALESCE(v_title, '<null>');
  END IF;
  RAISE NOTICE 'P2-8 PASS — anonymous browsing still counts, filters and orders';
  INSERT INTO i2489p2_executed(scenario) VALUES ('P2-8');
END $t$;

-- =====================================================================================
-- P2-9 — THE OWNER-RIGHTS VIEWS ARE STILL READABLE, AND STILL GATED.
--
-- A view on OWNER rights does not consult the caller's column privileges, so the grant
-- change cannot break it — and cannot help it either. Both halves are asserted: the read
-- succeeds (or the buyer web, the brand pages and every social preview are down), and it
-- still withholds (or the view is now the hole).
-- =====================================================================================
DO $t$
DECLARE
  v_id    uuid := (SELECT id FROM i2489p2_ids WHERE label = 'gated');
  v_geo   point;
  v_txt   text;
  v_theme jsonb;
  v_title text;
BEGIN
  SET LOCAL ROLE anon;
  SELECT location_geo, location_text, public_theme, title
    INTO v_geo, v_txt, v_theme, v_title
    FROM public.business_public_events_view
   WHERE id = v_id;
  RESET ROLE;

  IF v_title IS DISTINCT FROM 'i2489p2 gated' THEN
    RAISE EXCEPTION 'P2-9: anon can no longer read business_public_events_view — the buyer web, the brand pages and every social preview read this relation';
  END IF;
  IF v_geo IS NOT NULL
     OR NULLIF(v_txt, '') IS NOT NULL
     OR NULLIF(v_theme #>> '{business_event,location,address}', '') IS NOT NULL THEN
    RAISE EXCEPTION 'P2-9: business_public_events_view is readable but no longer withholding — phase 1''s gate was lost';
  END IF;
  RAISE NOTICE 'P2-9 PASS — the primary anon read model still serves, and still withholds';
  INSERT INTO i2489p2_executed(scenario) VALUES ('P2-9');
END $t$;

-- =====================================================================================
-- P2-10 — events_public_view SURVIVED THE OWNER-RIGHTS FLIP.
--
-- On caller rights this view raises permission denied for every anonymous reader, because
-- its BODY references the withheld columns — even when the caller's own query does not.
-- That is the specific failure mode the flip in section 1a of the migration exists to
-- prevent, and it is asserted here rather than assumed. Both halves again: it reads, and
-- it still withholds.
-- =====================================================================================
DO $t$
DECLARE
  v_id    uuid := (SELECT id FROM i2489p2_ids WHERE label = 'gated');
  v_title text;
  v_geo   point;
  v_txt   text;
  v_theme jsonb;
BEGIN
  SET LOCAL ROLE anon;
  SELECT title, location_geo, location_text, theme
    INTO v_title, v_geo, v_txt, v_theme
    FROM public.events_public_view
   WHERE id = v_id;
  RESET ROLE;

  IF v_title IS DISTINCT FROM 'i2489p2 gated' THEN
    RAISE EXCEPTION 'P2-10: anon cannot read events_public_view. On caller rights this view fails for every anonymous reader once the base grant narrows; it must be on owner rights.';
  END IF;
  IF v_geo IS NOT NULL
     OR NULLIF(v_txt, '') IS NOT NULL
     OR NULLIF(v_theme #>> '{business_event,location,address}', '') IS NOT NULL THEN
    RAISE EXCEPTION 'P2-10: events_public_view is on owner rights and NOT withholding — owner rights without the gate is a leak, not a fix';
  END IF;
  RAISE NOTICE 'P2-10 PASS — events_public_view reads on owner rights and still withholds';
  INSERT INTO i2489p2_executed(scenario) VALUES ('P2-10');
END $t$;

-- =====================================================================================
-- P2-11 — events_with_master_date_view IS NO LONGER AN ANONYMOUS READ SURFACE.
--
-- It has no WHERE clause and no privacy gate: it projects the pin, the address string and
-- the raw theme to whoever its grants allow. Its anonymous grant was a default-privilege
-- artefact with no anonymous caller. Both the grant and a real read are checked — a
-- catalog assertion alone proves a switch is flipped, not that anything is refused.
-- =====================================================================================
DO $t$
DECLARE
  v_id   uuid := (SELECT id FROM i2489p2_ids WHERE label = 'gated');
  v_sink text;
  v_got  boolean := false;
  v_err  text;
BEGIN
  IF has_table_privilege('anon', 'public.events_with_master_date_view', 'SELECT') THEN
    RAISE EXCEPTION 'P2-11: anon still holds SELECT on events_with_master_date_view — an ungated, WHERE-less projection of the base relation';
  END IF;

  SET LOCAL ROLE anon;
  BEGIN
    EXECUTE 'SELECT location_text FROM public.events_with_master_date_view WHERE id = $1' INTO v_sink
      USING v_id;
    v_got := true;
  EXCEPTION WHEN insufficient_privilege THEN v_err := SQLERRM;
  END;
  IF v_err IS NOT NULL AND position('events' in v_err) = 0 THEN
    RAISE EXCEPTION 'FIXTURE FAULT: the read was refused, but for something other than the relation under test (%). A refusal that is not about public.events proves nothing.', v_err;
  END IF;
  v_err := NULL;
  RESET ROLE;

  IF v_got THEN
    RAISE EXCEPTION 'P2-11: the grant is gone from the catalog but an anonymous read still succeeded';
  END IF;
  RAISE NOTICE 'P2-11 PASS — the ungated master-date view refuses anonymous readers';
  INSERT INTO i2489p2_executed(scenario) VALUES ('P2-11');
END $t$;

-- =====================================================================================
-- P2-12 — ANTI-VACUITY: THE OTHER TWO CALLER-RIGHTS VIEWS STILL WORK.
--
-- brands_public_view and organisers_public_view are on caller rights over this relation
-- too. They survive only because their bodies touch none of the withheld columns. That is
-- a property of the current view definitions, not a guarantee — so it is pinned. If a
-- later change adds a location column to either body, this fails instead of the brand
-- directory going dark in production.
-- =====================================================================================
DO $t$
DECLARE v_brands integer; v_organisers integer;
BEGIN
  SET LOCAL ROLE anon;
  EXECUTE 'SELECT count(*) FROM public.brands_public_view' INTO v_brands;
  EXECUTE 'SELECT count(*) FROM public.organisers_public_view' INTO v_organisers;
  RESET ROLE;
  RAISE NOTICE 'P2-12 PASS — brands_public_view (% rows) and organisers_public_view (% rows) still serve anon', v_brands, v_organisers;
  INSERT INTO i2489p2_executed(scenario) VALUES ('P2-12');
END $t$;

-- =====================================================================================
-- P2-13 — THE SCOPE LIMIT, ASSERTED RATHER THAN ONLY WRITTEN DOWN.
--
-- This change closes the ANONYMOUS disclosure and nothing more. `authenticated` is how a
-- host reads and edits their own offering, so its grants are deliberately untouched — and
-- that means anyone with a free account can still read these columns off the base
-- relation. Asserting it here keeps #2489 from being read as "address privacy enforced":
-- if this assertion ever starts failing, someone has closed the residual, and the
-- invariant's scope limit needs rewriting on purpose rather than drifting.
-- =====================================================================================
DO $t$
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.events', 'SELECT') THEN
    RAISE EXCEPTION 'P2-13: authenticated lost SELECT on public.events. Hosts author their own offerings through that role — this migration is scoped to anon and must not have touched it.';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.events', 'location_geo', 'SELECT') THEN
    RAISE EXCEPTION 'P2-13: authenticated lost location_geo — a host can no longer see their own venue pin';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.events', 'SELECT') THEN
    RAISE EXCEPTION 'P2-13: service_role lost SELECT on public.events';
  END IF;
  RAISE NOTICE 'P2-13 PASS — authenticated and service_role untouched; the residual for signed-in non-members is still open and still tracked';
  INSERT INTO i2489p2_executed(scenario) VALUES ('P2-13');
END $t$;

-- =====================================================================================
-- P2-14 — A COLUMN ADDED LATER FAILS CLOSED.
--
-- With no table-level grant, a column added by a future migration is not reachable by
-- anon until someone grants it. That is the correct default for a relation carrying
-- location data, and it is a real behavioural change worth knowing before you add a
-- column — so it is proven here rather than described.
-- =====================================================================================
DO $t$
DECLARE
  v_sink text;
  v_got  boolean := false;
  v_err  text;
BEGIN
  ALTER TABLE public.events ADD COLUMN i2489p2_probe_col text DEFAULT 'probe';
  SET LOCAL ROLE anon;
  BEGIN
    EXECUTE 'SELECT i2489p2_probe_col FROM public.events LIMIT 1' INTO v_sink;
    v_got := true;
  EXCEPTION WHEN insufficient_privilege THEN v_err := SQLERRM;
  END;
  IF v_err IS NOT NULL AND position('events' in v_err) = 0 THEN
    RAISE EXCEPTION 'FIXTURE FAULT: the read was refused, but for something other than the relation under test (%). A refusal that is not about public.events proves nothing.', v_err;
  END IF;
  v_err := NULL;
  RESET ROLE;
  ALTER TABLE public.events DROP COLUMN i2489p2_probe_col;

  IF v_got THEN
    RAISE EXCEPTION 'P2-14: a newly added column was immediately readable by anon — the grant is wider than a column list';
  END IF;
  RAISE NOTICE 'P2-14 PASS — a new column is not anonymously readable until deliberately granted';
  INSERT INTO i2489p2_executed(scenario) VALUES ('P2-14');
END $t$;

-- =====================================================================================
-- NC-1 — NEGATIVE CONTROL. A REAL LEAK, WHICH THIS SUITE MUST CATCH.
--
-- Restore the table-level grant — the state this migration removed — and re-run the two
-- vectors. Both must come back. A suite that cannot see the hole reopen is not evidence
-- that the hole is closed; every green assertion above would be uninformative.
-- =====================================================================================
SAVEPOINT i2489p2_nc;

DO $t$
DECLARE
  v_id     uuid := (SELECT id FROM i2489p2_ids WHERE label = 'gated');
  v_geo    text;
  v_count  text;
  v_seen   text[] := ARRAY[]::text[];
BEGIN
  GRANT SELECT ON public.events TO anon;

  SET LOCAL ROLE anon;
  BEGIN
    EXECUTE 'SELECT location_geo::text FROM public.events WHERE id = $1' INTO v_geo
      USING v_id;
    IF v_geo IS NOT NULL THEN v_seen := array_append(v_seen, 'projection of location_geo'); END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'SELECT count(*)::text FROM public.events WHERE location_text LIKE ''%Baker%''' INTO v_count;
    IF v_count IS NOT NULL AND v_count <> '0' THEN v_seen := array_append(v_seen, 'filter oracle on location_text'); END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;

  IF cardinality(v_seen) < 2 THEN
    RAISE EXCEPTION 'NC-1: the table-level grant was restored, an unauthenticated caller read a withheld offering, and this suite detected only [%]. Every assertion above is therefore uninformative — they are not reading what they claim to read.', array_to_string(v_seen, ', ');
  END IF;
  RAISE NOTICE 'NC-1 PASS — with the table-level grant restored the suite sees both vectors return: %', array_to_string(v_seen, ', ');
END $t$;

ROLLBACK TO SAVEPOINT i2489p2_nc;
INSERT INTO i2489p2_executed(scenario) VALUES ('NC-1');

-- =====================================================================================
-- NC-2 — THE ASSERTION THIS FILE EXISTS FOR.
--
-- The form of this fix that was specified first was a column-level REVOKE. This stages
-- exactly that, inside a savepoint: restore the table-level grant, then revoke the two
-- columns the way the original specification wrote it — and prove the anonymous read
-- STILL SUCCEEDS.
--
-- Shipped as written, that statement would have applied cleanly, exited zero, passed
-- every test in the phase 1 suite, and left the hole exactly where it was. This block is
-- the standing proof of why the migration has the shape it has, and the reason nobody
-- should "simplify" it back.
-- =====================================================================================
SAVEPOINT i2489p2_nc2;

DO $t$
DECLARE
  v_id    uuid := (SELECT id FROM i2489p2_ids WHERE label = 'gated');
  v_geo   text;
  v_count text;
BEGIN
  GRANT SELECT ON public.events TO anon;
  REVOKE SELECT (location_geo, location_text) ON public.events FROM anon;

  SET LOCAL ROLE anon;
  EXECUTE 'SELECT location_geo::text FROM public.events WHERE id = $1' INTO v_geo
    USING v_id;
  EXECUTE 'SELECT count(*)::text FROM public.events WHERE location_text LIKE ''%Baker%''' INTO v_count;
  RESET ROLE;

  IF v_geo IS NULL THEN
    RAISE EXCEPTION 'NC-2: a column-level REVOKE actually withheld the pin while a table-level grant was held. That contradicts the premise this migration is built on — re-derive the grant shape before trusting it.';
  END IF;
  IF v_count IS NULL OR v_count = '0' THEN
    RAISE EXCEPTION 'NC-2: a column-level REVOKE closed the filter oracle while a table-level grant was held — same contradiction, same instruction.';
  END IF;

  RAISE NOTICE 'NC-2 PASS — with a table-level grant held, a column-level REVOKE withholds NOTHING: the pin still reads and the oracle still answers %. This is why the migration revokes the table-level grant and grants columns back.', v_count;
END $t$;

ROLLBACK TO SAVEPOINT i2489p2_nc2;
INSERT INTO i2489p2_executed(scenario) VALUES ('NC-2');

-- =====================================================================================
-- LEDGER CHECK — every scenario this file declares actually ran, in both directions.
-- =====================================================================================
DO $t$
DECLARE
  v_expected text[] := ARRAY[
    'P2-1','P2-2','P2-3','P2-4','P2-5','P2-6','P2-7','P2-8','P2-9','P2-10','P2-11',
    'P2-12','P2-13','P2-14','NC-1','NC-2'];
  v_ran    text[];
  v_silent text[];
  v_extra  text[];
BEGIN
  SELECT array_agg(scenario ORDER BY scenario) INTO v_ran FROM i2489p2_executed;
  SELECT array_agg(x ORDER BY x) INTO v_silent
  FROM unnest(v_expected) x WHERE x <> ALL (COALESCE(v_ran, ARRAY[]::text[]));
  SELECT array_agg(x ORDER BY x) INTO v_extra
  FROM unnest(COALESCE(v_ran, ARRAY[]::text[])) x WHERE x <> ALL (v_expected);

  IF v_silent IS NOT NULL THEN
    RAISE EXCEPTION 'LEDGER: declared but did not execute to completion — an assertion that cannot run cannot certify anything: %', array_to_string(v_silent, ', ');
  END IF;
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'LEDGER: scenarios ran that this file does not declare: %', array_to_string(v_extra, ', ');
  END IF;
  RAISE NOTICE 'LEDGER PASS — all % declared scenarios executed to completion', cardinality(v_expected);
END $t$;

ROLLBACK;
