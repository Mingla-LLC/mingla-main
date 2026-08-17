-- =====================================================================
-- issue #2117 -- TESTER ADVERSARIAL suite.
--
-- Different angle from the implementor's happy-path suite. That suite
-- proves the RIGHT properties but compares the WRONG THINGS in three
-- places, each of which is independently demonstrable by execution:
--
--   * A-SC-3 contracts "identical results, CELL FOR CELL" across roles.
--     The shipped implementation compares count(*)::text for the two
--     event-keyed readers and IS NOT NULL for the two by-slug readers, so
--     a reader that quotes a DIFFERENT PRICE to an anonymous buyer than to
--     a signed-in one -- Amendment 1's own named forgery shape, branching
--     on the role GUC without a role-resolving function -- passes it.
--
--   * A-SC-4 contracts two-directional EXCEPT ALL equality of the public
--     path pre vs post. The shipped implementation asserts served /
--     not-served and count(*) <> 0, so a public payload silently stripped
--     of its pricing, inventory and itinerary passes it.
--
--   * A-SC-10 clauses 1 and 5 count DISTINCT visibility / status from the
--     suite's own bookkeeping table, which is populated from its hardcoded
--     VALUES list -- i.e. from what the suite INTENDED to build. A trigger
--     that silently rewrites every draft fixture to private leaves the
--     non-vacuity gate reporting five visibility states.
--
-- Every assertion below EXECUTES an object against real rows. Nothing
-- reads migration text, pg_get_functiondef, or any source representation.
--
-- THE PRE-CHANGE ORACLE. This file needs no captured baseline for the
-- event-keyed readers: #2117 §4.5 created two privileged siblings whose
-- bodies are the pre-#2117 readers VERBATIM. They are therefore an
-- executable, in-cluster oracle for "what this reader returned before the
-- change", and A2 differences the gated reader against them in BOTH
-- directions at every (type x status) pair on the public path.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f <this file>
-- after applying every migration in timestamp order to
-- supabase/postgres:17.4.1.075.
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

DROP SCHEMA IF EXISTS i2117adv CASCADE;

DO $preclean$
BEGIN
  CREATE TEMP TABLE i2117adv_pre AS
    SELECT id FROM public.events WHERE brand_id = '00000000-2117-4000-a000-0000000000bb';
  DELETE FROM public.tickets          WHERE event_id IN (SELECT id FROM i2117adv_pre);
  DELETE FROM public.order_line_items WHERE order_id IN
    (SELECT id FROM public.orders WHERE event_id IN (SELECT id FROM i2117adv_pre));
  DELETE FROM public.orders           WHERE event_id IN (SELECT id FROM i2117adv_pre);
  DELETE FROM public.trip_pricing_tiers WHERE event_id IN (SELECT id FROM i2117adv_pre);
  DELETE FROM public.ticket_types     WHERE event_id IN (SELECT id FROM i2117adv_pre);
  DELETE FROM public.event_dates      WHERE event_id IN (SELECT id FROM i2117adv_pre);
  DELETE FROM public.events           WHERE id       IN (SELECT id FROM i2117adv_pre);
  DROP TABLE i2117adv_pre;
  DELETE FROM public.brands WHERE slug = 'i2117adv-brand';
  DELETE FROM public.creator_accounts
    WHERE id IN ('00000000-2117-4000-a000-0000000000a1','00000000-2117-4000-a000-0000000000a2');
  DELETE FROM auth.users
    WHERE id IN ('00000000-2117-4000-a000-0000000000a1','00000000-2117-4000-a000-0000000000a2');
END $preclean$;

CREATE SCHEMA i2117adv;

CREATE TABLE i2117adv.result(
  id serial primary key, criterion text, name text, outcome text, detail text);

CREATE FUNCTION i2117adv.assert(p_criterion text, p_name text, p_ok boolean, p_detail text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO i2117adv.result(criterion,name,outcome,detail)
  VALUES (p_criterion,p_name,CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END,p_detail);
END $$;

CREATE TABLE i2117adv.ids(k text primary key, v uuid);
INSERT INTO i2117adv.ids VALUES
  ('organiser','00000000-2117-4000-a000-0000000000a1'),
  ('stranger' ,'00000000-2117-4000-a000-0000000000a2'),
  ('brand'    ,'00000000-2117-4000-a000-0000000000bb');

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
SELECT v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',k||'@i2117adv.test','x',now(),now()
FROM i2117adv.ids WHERE k IN ('organiser','stranger') ON CONFLICT DO NOTHING;
INSERT INTO public.creator_accounts(id) SELECT v FROM i2117adv.ids WHERE k IN ('organiser','stranger') ON CONFLICT DO NOTHING;
INSERT INTO public.brands(id,account_id,name,slug,claim_status,pricing_currency,default_currency)
SELECT (SELECT v FROM i2117adv.ids WHERE k='brand'),(SELECT v FROM i2117adv.ids WHERE k='organiser'),
       'I2117ADV Brand','i2117adv-brand','verified','usd','USD';

CREATE TABLE i2117adv.offering(
  key text primary key, event_id uuid, tier_id uuid, order_id uuid,
  etype text, visibility text, status text, slug text);

-- FULL cross product: 3 offering types x 5 visibility states x 4 status
-- values = 60 fixtures. The implementor's suite builds the visibility axis
-- at one status and the status axis at one visibility; the interaction
-- between the two is where A-4.2's widening lived.
DO $fx$
DECLARE r record; v_ev uuid; v_tt uuid; v_or uuid; v_brand uuid;
BEGIN
  SELECT v INTO v_brand FROM i2117adv.ids WHERE k='brand';
  FOR r IN
    SELECT t.etype, v.vis, s.st, t.etype||'|'||v.vis||'|'||s.st AS key
    FROM (VALUES ('trip'),('experience'),('event')) t(etype)
    CROSS JOIN (VALUES ('public'),('discover'),('private'),('hidden'),('draft')) v(vis)
    CROSS JOIN (VALUES ('scheduled'),('live'),('ended'),('cancelled')) s(st)
  LOOP
    v_ev := gen_random_uuid(); v_tt := gen_random_uuid(); v_or := gen_random_uuid();
    INSERT INTO public.events(id,brand_id,title,slug,event_type,visibility,status,timezone,published_at,currency)
      VALUES (v_ev,v_brand,'I2117ADV '||r.key, 'adv-'||replace(r.key,'|','-'), r.etype, r.vis, r.st,'UTC',now(),'usd');
    INSERT INTO public.event_dates(event_id,start_at,end_at,is_master,timezone)
      VALUES (v_ev, now()+interval '10 day', now()+interval '10 day 3 hour', true,'UTC');
    INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,quantity_total,is_unlimited,is_free)
      VALUES (v_tt,v_ev,'GA',5000,'usd',100,false,false);
    INSERT INTO public.orders(id,event_id,payment_status,payment_method,source,total_cents,currency,buyer_phone_e164)
      VALUES (v_or,v_ev,'paid','apple_pay','online_checkout',10000,'usd','+12015550177');
    INSERT INTO public.order_line_items(order_id,ticket_type_id,quantity,unit_price_cents)
      VALUES (v_or,v_tt,2,5000);
    INSERT INTO public.tickets(order_id,ticket_type_id,event_id,qr_code,status)
      VALUES (v_or,v_tt,v_ev,'i2117adv-'||replace(r.key,'|','-')||'-1','valid'),
             (v_or,v_tt,v_ev,'i2117adv-'||replace(r.key,'|','-')||'-2','valid');
    -- the trip render reader's tier block reads trip_pricing_tiers, NOT
    -- ticket_types directly. A fixture set without these rows leaves that
    -- block permanently empty, so any assertion over it is vacuous.
    IF r.etype = 'trip' THEN
      INSERT INTO public.trip_pricing_tiers(event_id,ticket_type_id,tier_name,tier_metadata)
        VALUES (v_ev, v_tt, 'Standard', '{}'::jsonb);
    END IF;
    INSERT INTO i2117adv.offering VALUES (r.key,v_ev,v_tt,v_or,r.etype,r.vis,r.st,'adv-'||replace(r.key,'|','-'));
  END LOOP;
END $fx$;

GRANT USAGE ON SCHEMA i2117adv TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA i2117adv TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- A3 (runs first, because everything else is vacuous without it) --
-- NON-VACUITY MEASURED FROM public.events, NOT from this file's own
-- bookkeeping table. The implementor's A-SC-10 counts DISTINCT visibility
-- from its fixture ledger, which is written from its hardcoded VALUES
-- list, so it asserts INTENT. A BEFORE INSERT trigger that silently
-- rewrites every draft fixture to private leaves it reporting five states.
-- This clause reads the rows that actually landed.
-- ---------------------------------------------------------------------
DO $a3$
DECLARE v_vis int; v_st int; v_ty int; v_rows int; v_mismatch int;
BEGIN
  SELECT count(DISTINCT e.visibility), count(DISTINCT e.status), count(DISTINCT e.event_type), count(*)
    INTO v_vis, v_st, v_ty, v_rows
  FROM public.events e JOIN i2117adv.offering o ON o.event_id = e.id;

  -- and every landed row must actually carry the state the ledger claims
  SELECT count(*) INTO v_mismatch
  FROM public.events e JOIN i2117adv.offering o ON o.event_id = e.id
  WHERE e.visibility IS DISTINCT FROM o.visibility
     OR e.status     IS DISTINCT FROM o.status
     OR e.event_type IS DISTINCT FROM o.etype;

  IF v_rows <> 60 THEN
    RAISE EXCEPTION 'A3 NON-VACUITY FAILURE: % of 60 fixtures actually landed in public.events', v_rows;
  END IF;
  IF v_vis < 5 OR v_st < 4 OR v_ty < 3 THEN
    RAISE EXCEPTION 'A3 NON-VACUITY FAILURE: landed rows cover % visibility states, % status values, % offering types (need 5/4/3)',
      v_vis, v_st, v_ty;
  END IF;
  IF v_mismatch > 0 THEN
    RAISE EXCEPTION 'A3 NON-VACUITY FAILURE: % landed fixture(s) do not carry the state the ledger claims -- every downstream assertion would be testing a different offering than it names', v_mismatch;
  END IF;
  PERFORM i2117adv.assert('A3','fixture matrix verified against public.events, not against intent',
    true, format('%s rows, %s visibility states, %s statuses, %s types, 0 ledger mismatches', v_rows, v_vis, v_st, v_ty));
END $a3$;

-- ---------------------------------------------------------------------
-- A1 -- CROSS-ROLE EQUALITY AT CELL LEVEL. A-SC-3 as the contract words
-- it: "identical results, CELL FOR CELL". Full payload digests, not row
-- counts and not IS NOT NULL. The caller's IDENTITY claim is held
-- constant and only the ROLE (and role claim) varies, so an
-- identity-branching authorisation arm is correctly NOT flagged.
--
-- Reds on: any changed object whose RESULT VALUE varies with the caller's
-- role, including the value-level forgery that the row-count comparison
-- cannot see.
-- ---------------------------------------------------------------------
CREATE FUNCTION i2117adv.cells(p_role text) RETURNS TABLE(obj text, okey text, val text)
LANGUAGE plpgsql AS $$
DECLARE r record; v_org uuid; v text;
BEGIN
  SELECT i.v INTO v_org FROM i2117adv.ids i WHERE i.k='organiser';
  FOR r IN SELECT * FROM i2117adv.offering ORDER BY key LOOP
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    PERFORM set_config('request.jwt.claim.sub', v_org::text, true);
    PERFORM set_config('request.jwt.claim.role', p_role, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub',v_org,'role',p_role)::text, true);

    BEGIN EXECUTE 'SELECT COALESCE(md5(string_agg(x::text, '','' ORDER BY x::text)),''-'') FROM public.pg_public_event_tier_allin($1) x'
      INTO v USING r.event_id; EXCEPTION WHEN OTHERS THEN v := 'ERR:'||SQLERRM; END;
    obj:='tier_allin'; okey:=r.key; val:=v; RETURN NEXT;

    BEGIN EXECUTE 'SELECT COALESCE(md5(string_agg(x::text, '','' ORDER BY x::text)),''-'') FROM public.pg_public_ticket_types_remaining($1) x'
      INTO v USING r.event_id; EXCEPTION WHEN OTHERS THEN v := 'ERR:'||SQLERRM; END;
    obj:='remaining'; okey:=r.key; val:=v; RETURN NEXT;

    BEGIN EXECUTE 'SELECT COALESCE(md5(public.pg_public_trip_by_slug($1,$2)::text),''-'')'
      INTO v USING 'i2117adv-brand', r.slug; EXCEPTION WHEN OTHERS THEN v := 'ERR:'||SQLERRM; END;
    obj:='trip_by_slug'; okey:=r.key; val:=v; RETURN NEXT;

    BEGIN EXECUTE 'SELECT COALESCE(md5(public.pg_public_experience_by_slug($1,$2)::text),''-'')'
      INTO v USING 'i2117adv-brand', r.slug; EXCEPTION WHEN OTHERS THEN v := 'ERR:'||SQLERRM; END;
    obj:='exp_by_slug'; okey:=r.key; val:=v; RETURN NEXT;

    BEGIN EXECUTE 'SELECT public.biz_experience_sold_count($1)::text' INTO v USING r.event_id;
    EXCEPTION WHEN OTHERS THEN v := 'ERR:'||SQLERRM; END;
    obj:='exp_sold'; okey:=r.key; val:=v; RETURN NEXT;

    BEGIN EXECUTE 'SELECT public.biz_trip_tickets_sold_by_tier($1)::text' INTO v USING r.event_id;
    EXCEPTION WHEN OTHERS THEN v := 'ERR:'||SQLERRM; END;
    obj:='sold_by_tier'; okey:=r.key; val:=v; RETURN NEXT;

    BEGIN EXECUTE 'SELECT public.biz_trip_has_web_purchases($1)::text' INTO v USING r.event_id;
    EXCEPTION WHEN OTHERS THEN v := 'ERR:'||SQLERRM; END;
    obj:='has_web_purch'; okey:=r.key; val:=v; RETURN NEXT;

    RESET ROLE;
  END LOOP;
END $$;

DO $a1$
DECLARE v_diff int; v_total int; v_detail text;
BEGIN
  CREATE TEMP TABLE i2117adv_a AS SELECT * FROM i2117adv.cells('anon');
  CREATE TEMP TABLE i2117adv_b AS SELECT * FROM i2117adv.cells('authenticated');
  SELECT count(*) FILTER (WHERE a.val IS DISTINCT FROM b.val), count(*)
    INTO v_diff, v_total
  FROM i2117adv_a a FULL JOIN i2117adv_b b USING (obj, okey);
  SELECT string_agg(DISTINCT a.obj, ',') INTO v_detail
  FROM i2117adv_a a FULL JOIN i2117adv_b b USING (obj, okey)
  WHERE a.val IS DISTINCT FROM b.val;
  PERFORM i2117adv.assert('A1','cross-role equality at CELL level (payload digests, not row counts)',
    v_diff = 0 AND v_total >= 420,
    format('role-dependent cells=%s of %s compared%s', v_diff, v_total,
           COALESCE(' on: '||v_detail, '')));
  DROP TABLE i2117adv_a; DROP TABLE i2117adv_b;
END $a1$;

-- ---------------------------------------------------------------------
-- A2 -- PUBLIC-PATH PAYLOAD EQUALITY AGAINST THE PRE-CHANGE ORACLE, in
-- BOTH DIRECTIONS, at EVERY (offering type x status) pair.
--
-- The §4.5 privileged siblings are the pre-#2117 reader bodies verbatim,
-- so for a PUBLICLY VISIBLE offering the gated reader and its sibling must
-- be EXCEPT ALL-equal each way. This is SC-4 as the SPEC actually words
-- it, and it reds on a payload change that a served/not-served assertion
-- cannot see.
-- ---------------------------------------------------------------------
DO $a2$
DECLARE r record; ok boolean := true; d text := ''; n1 int; n2 int; pairs int := 0;
BEGIN
  FOR r IN SELECT * FROM i2117adv.offering WHERE visibility='public' ORDER BY key LOOP
    pairs := pairs + 1;
    EXECUTE 'SELECT count(*) FROM ((SELECT * FROM public.pg_public_event_tier_allin($1))
             EXCEPT ALL (SELECT * FROM public.pg_privileged_event_tier_allin($1))) q'
      INTO n1 USING r.event_id;
    EXECUTE 'SELECT count(*) FROM ((SELECT * FROM public.pg_privileged_event_tier_allin($1))
             EXCEPT ALL (SELECT * FROM public.pg_public_event_tier_allin($1))) q'
      INTO n2 USING r.event_id;
    IF n1 <> 0 OR n2 <> 0 THEN
      ok := false; d := d || format(' tier_allin public/%s/%s differs from the pre-change oracle (%s,%s);', r.etype, r.status, n1, n2);
    END IF;

    EXECUTE 'SELECT count(*) FROM ((SELECT * FROM public.pg_public_ticket_types_remaining($1))
             EXCEPT ALL (SELECT * FROM public.pg_privileged_ticket_types_remaining($1))) q'
      INTO n1 USING r.event_id;
    EXECUTE 'SELECT count(*) FROM ((SELECT * FROM public.pg_privileged_ticket_types_remaining($1))
             EXCEPT ALL (SELECT * FROM public.pg_public_ticket_types_remaining($1))) q'
      INTO n2 USING r.event_id;
    IF n1 <> 0 OR n2 <> 0 THEN
      ok := false; d := d || format(' remaining public/%s/%s differs from the pre-change oracle (%s,%s);', r.etype, r.status, n1, n2);
    END IF;
  END LOOP;
  IF pairs < 12 THEN
    RAISE EXCEPTION 'A2 NON-VACUITY FAILURE: only % public (type x status) pairs measured; the interaction axis is not covered', pairs;
  END IF;
  PERFORM i2117adv.assert('A2','public path EXCEPT ALL-equal to the pre-change oracle, both directions, every (type x status)',
    ok, COALESCE(NULLIF(d,''), format('%s public pairs, zero rows in either direction', pairs)));
END $a2$;

-- ---------------------------------------------------------------------
-- A5 -- the by-slug readers have no sibling oracle, so assert PAYLOAD
-- COMPLETENESS instead of not-null-ness: a publicly visible offering's
-- payload must still carry the contracted keys, and its tier/ticket
-- pricing must agree with the independent all-in oracle. A silent field
-- strip reds here and is invisible to a served/not-served assertion.
--
-- RETEST FIX (#issuecomment-5313257745 §3). This assertion had the identical
-- LOWER-BOUND shape and the identical blind spot as the happy path's, and I
-- said so in the retest rather than grade another file by a standard my own
-- did not meet: it asserted "every recorded key is present", so a reader that
-- emitted an ADDITIONAL field to an unauthenticated caller stayed green.
-- Verified by execution: the same public reader made to emit an extra field
-- carrying organiser-side content was confirmed present in the anon payload
-- and this suite passed. Detecting REMOVALS guards availability; detecting
-- ADDITIONS guards DISCLOSURE, and #2117 is a disclosure issue. The
-- comparison is now SET EQUALITY against the recorded key set, both
-- directions, and the recorded set is the reader's COMPLETE emitted set
-- measured from the reader -- not the hand-picked subset it used to be.
--
-- THE PERMITTED DIRECTION OF EDIT, because equality reds both ways: A
-- RECORDED KEY SET MAY GAIN A KEY WHEN THE READER GAINS ONE, AND MAY NEVER
-- LOSE A KEY TO SILENCE A FAILURE. An UNRECORDED-key red means the reader
-- started emitting something new -- establish what it emits and to whom
-- before recording it. A MISSING-key red means the reader stopped emitting
-- something contracted; deleting the key to clear the red is the wrong
-- repair and is out of contract.
-- ---------------------------------------------------------------------
DO $a5$
DECLARE r record; ok boolean := true; d text := ''; j jsonb; n int;
        v_keys text[]; v_missing text[]; v_extra text[];
BEGIN
  FOR r IN SELECT * FROM i2117adv.offering
           WHERE visibility='public' AND etype='trip' AND status IN ('scheduled','live') ORDER BY key LOOP
    j := public.pg_public_trip_by_slug('i2117adv-brand', r.slug)::jsonb;
    IF j IS NULL THEN ok := false; d := d||format(' trip/%s not served;', r.status); CONTINUE; END IF;
    -- The reader's COMPLETE emitted key set, measured from the reader.
    v_keys := ARRAY['bookingDeadline','bookingsClosed','brand','brandId','brandSlug',
                    'coverGallery','coverMediaType','coverMediaUrl','currency','days',
                    'departureLat','departureLng','departureText','description',
                    'destinationLat','destinationLng','destinationText','endAt','id',
                    'inclusions','refundPolicy','startAt','status',
                    'themeAnimationOverride','themeColorOverride','themeFontOverride',
                    'tiers','timezone','title','tripSlug'];
    SELECT COALESCE(array_agg(x ORDER BY x), '{}') INTO v_missing
    FROM unnest(v_keys) AS x WHERE NOT (j ? x);
    SELECT COALESCE(array_agg(x ORDER BY x), '{}') INTO v_extra
    FROM jsonb_object_keys(j) AS x WHERE NOT (x = ANY (v_keys));
    IF cardinality(v_missing) > 0 THEN
      ok := false; d := d||format(' trip/%s payload LOST keys %s;', r.status, v_missing);
    END IF;
    IF cardinality(v_extra) > 0 THEN
      ok := false; d := d||format(' trip/%s payload GAINED unrecorded keys %s -- widened to the governed audience;', r.status, v_extra);
    END IF;
    -- Two empty sets agree with each other; the equality needs a floor.
    IF cardinality(v_keys) = 0 OR (SELECT count(*) FROM jsonb_object_keys(j)) = 0 THEN
      ok := false; d := d||format(' trip/%s KEY EQUALITY VACUOUS -- recorded=%s emitted=%s;',
                                  r.status, cardinality(v_keys), (SELECT count(*) FROM jsonb_object_keys(j)));
    END IF;
    IF jsonb_array_length(COALESCE(j->'tiers','[]'::jsonb)) = 0 THEN
      ok := false; d := d||format(' trip/%s payload carries zero tiers;', r.status);
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM i2117adv.offering
           WHERE visibility='public' AND etype='experience' ORDER BY key LOOP
    j := public.pg_public_experience_by_slug('i2117adv-brand', r.slug)::jsonb;
    IF j IS NULL THEN ok := false; d := d||format(' experience/%s not served;', r.status); CONTINUE; END IF;
    -- The reader's COMPLETE emitted key set, measured from the reader.
    v_keys := ARRAY['bookable','brand','brandId','brandSlug','coverGallery',
                    'coverMediaType','coverMediaUrl','currency','dates','description',
                    'experienceSlug','hideAddressUntilTicket','id','intents','isMultiDate',
                    'isRecurring','recurrenceRules','status','stops',
                    'themeAnimationOverride','themeColorOverride','themeFontOverride',
                    'ticket','timezone','title','venueText','visibility'];
    SELECT COALESCE(array_agg(x ORDER BY x), '{}') INTO v_missing
    FROM unnest(v_keys) AS x WHERE NOT (j ? x);
    SELECT COALESCE(array_agg(x ORDER BY x), '{}') INTO v_extra
    FROM jsonb_object_keys(j) AS x WHERE NOT (x = ANY (v_keys));
    IF cardinality(v_missing) > 0 THEN
      ok := false; d := d||format(' experience/%s payload LOST keys %s;', r.status, v_missing);
    END IF;
    IF cardinality(v_extra) > 0 THEN
      ok := false; d := d||format(' experience/%s payload GAINED unrecorded keys %s -- widened to the governed audience;', r.status, v_extra);
    END IF;
    IF cardinality(v_keys) = 0 OR (SELECT count(*) FROM jsonb_object_keys(j)) = 0 THEN
      ok := false; d := d||format(' experience/%s KEY EQUALITY VACUOUS -- recorded=%s emitted=%s;',
                                  r.status, cardinality(v_keys), (SELECT count(*) FROM jsonb_object_keys(j)));
    END IF;
    -- the emitted visibility value must be the publicly visible one, never leaked from another state
    IF (j->>'visibility') IS DISTINCT FROM 'public' THEN
      ok := false; d := d||format(' experience/%s emitted visibility=%s;', r.status, j->>'visibility');
    END IF;
    SELECT count(*) INTO n FROM public.pg_privileged_event_tier_allin(r.event_id);
    IF n > 0 AND (j->'ticket') IS NULL THEN
      ok := false; d := d||format(' experience/%s lost its ticket block while a tier exists;', r.status);
    END IF;
  END LOOP;

  PERFORM i2117adv.assert('A5','public by-slug payload key set EQUALS the recorded set, both directions',
    ok, COALESCE(NULLIF(d,''),'no key lost and no unrecorded key gained at any public status; emitted visibility correct'));
END $a5$;

-- ---------------------------------------------------------------------
-- A4 -- THE ORGANISER, UNDER THE REAL `authenticated` ROLE. The
-- implementor's SC-7 sets the identity claim but never leaves the
-- superuser session, so it cannot observe a row-level-security effect at
-- all. This runs read AND write as `authenticated`, at all five
-- visibility states and all four statuses, and compares the AFFECTED ROW
-- COUNT -- the failure this whole thread exists to catch is a silent
-- zero-row write, which no read-side assertion can see.
-- ---------------------------------------------------------------------
DO $a4$
DECLARE r record; v_org uuid; ok boolean := true; d text := '';
        n int; rk int; mp boolean; u int; ue int; a int; b jsonb; c boolean; seen int := 0;
BEGIN
  SELECT v INTO v_org FROM i2117adv.ids WHERE k='organiser';
  FOR r IN SELECT * FROM i2117adv.offering ORDER BY key LOOP
    seen := seen + 1;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_org::text, true);
    PERFORM set_config('request.jwt.claim.role','authenticated', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub',v_org,'role','authenticated')::text, true);

    EXECUTE 'SELECT count(*)::int FROM public.tickets WHERE event_id=$1' INTO n USING r.event_id;
    EXECUTE 'SELECT public.biz_brand_effective_rank(public.biz_event_brand_id($1),$2)' INTO rk USING r.event_id, v_org;
    EXECUTE 'SELECT public.biz_is_event_manager_plus($1,$2)' INTO mp USING r.event_id, v_org;
    EXECUTE 'SELECT public.biz_experience_sold_count($1)' INTO a USING r.event_id;
    EXECUTE 'SELECT public.biz_trip_tickets_sold_by_tier($1)' INTO b USING r.event_id;
    EXECUTE 'SELECT public.biz_trip_has_web_purchases($1)' INTO c USING r.event_id;

    EXECUTE 'UPDATE public.tickets SET attendee_name=$2 WHERE event_id=$1' USING r.event_id, 'i2117adv-probe';
    GET DIAGNOSTICS u = ROW_COUNT;
    EXECUTE 'UPDATE public.events SET title=title WHERE id=$1' USING r.event_id;
    GET DIAGNOSTICS ue = ROW_COUNT;
    RESET ROLE;

    IF n <> 2 OR rk <> 60 OR mp IS NOT TRUE OR u <> 2 OR ue <> 1
       OR a <> 2 OR b = '{}'::jsonb OR c IS NOT TRUE THEN
      ok := false;
      d := d || format(' %s/%s/%s read=%s rank=%s mgr=%s ticketWRITE=%s eventWRITE=%s sold=%s byTierEmpty=%s web=%s;',
                       r.etype, r.visibility, r.status, n, rk, mp, u, ue, a, (b='{}'::jsonb), c);
    END IF;
  END LOOP;
  IF seen <> 60 THEN
    RAISE EXCEPTION 'A4 NON-VACUITY FAILURE: only % fixtures exercised', seen;
  END IF;
  PERFORM i2117adv.assert('A4','organiser preserved under the real authenticated role: read AND write, 60 fixtures',
    ok, COALESCE(NULLIF(d,''),'read=2 rank=60 mgr=t ticketWRITE=2 rows eventWRITE=1 row at all five states and all four statuses'));
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM i2117adv.assert('A4','organiser preserved under the real authenticated role', false, 'RAISED: '||SQLERRM);
END $a4$;

-- ---------------------------------------------------------------------
-- A6 -- THE SIGNED-IN HALF OF THE GOVERNED AUDIENCE. A-SC-9's arrival,
-- departure and stale clauses are all computed from an anon-only probe,
-- while clause (c) checks `authenticated` -- so the criterion already
-- treats a signed-in stranger as part of the governed audience but cannot
-- see an arrival in that half. Assert directly that every object #2117
-- created or narrowed is closed to BOTH roles, and that every object it
-- deliberately left caller-executable is open to BOTH.
-- ---------------------------------------------------------------------
DO $a6$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('pg_offering_visibility_gate','pg_offering_passes_visibility_gate',
                      'pg_privileged_event_tier_allin','pg_privileged_ticket_types_remaining',
                      'pg_recurrence_is_terminated','biz_trip_sold_count_by_tier',
                      'resolve_event_pricing_inputs')
    AND (has_function_privilege('anon',p.oid,'EXECUTE')
      OR has_function_privilege('authenticated',p.oid,'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                 WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'));
  PERFORM i2117adv.assert('A6','closed objects are closed to anon AND authenticated AND PUBLIC',
    v_bad IS NULL, COALESCE('still reachable: '||v_bad, 'all seven closed to every governed role'));

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('pg_public_event_tier_allin','pg_public_ticket_types_remaining',
                      'pg_public_trip_by_slug','pg_public_experience_by_slug',
                      'biz_experience_sold_count','biz_trip_tickets_sold_by_tier',
                      'biz_trip_has_web_purchases')
    AND NOT (has_function_privilege('anon',p.oid,'EXECUTE')
         AND has_function_privilege('authenticated',p.oid,'EXECUTE'));
  PERFORM i2117adv.assert('A6','caller-executable objects stayed reachable by both governed roles',
    v_bad IS NULL, COALESCE('unexpectedly narrowed: '||v_bad, 'all seven still reachable by anon and authenticated'));
END $a6$;

-- ---------------------------------------------------------------------
-- Verdict.
-- ---------------------------------------------------------------------
\echo ''
\echo '========== issue #2117 -- TESTER ADVERSARIAL results =========='
SELECT criterion, name, outcome, detail FROM i2117adv.result ORDER BY id;

DO $verdict$
DECLARE v_fail int; v_pass int; v_detail text;
BEGIN
  SELECT count(*) FILTER (WHERE outcome='FAIL'), count(*) FILTER (WHERE outcome='PASS')
    INTO v_fail, v_pass FROM i2117adv.result;
  IF v_pass + v_fail < 7 THEN
    RAISE EXCEPTION 'ADVERSARIAL SUITE NON-VACUITY FAILURE: only % assertions ran (expected 7)', v_pass+v_fail;
  END IF;
  IF v_fail > 0 THEN
    SELECT string_agg(format('%s: %s -- %s', criterion, name, detail), E'\n  ')
      INTO v_detail FROM i2117adv.result WHERE outcome='FAIL';
    RAISE EXCEPTION E'issue #2117 ADVERSARIAL SUITE FAILED -- % failing assertion(s):\n  %', v_fail, v_detail;
  END IF;
  RAISE NOTICE 'issue #2117 ADVERSARIAL SUITE PASSED -- % assertions, 0 failures', v_pass;
END $verdict$;

-- teardown
CREATE TEMP TABLE i2117adv_ev AS
  SELECT id FROM public.events WHERE brand_id = '00000000-2117-4000-a000-0000000000bb';
DELETE FROM public.tickets          WHERE event_id IN (SELECT id FROM i2117adv_ev);
DELETE FROM public.order_line_items WHERE order_id IN
  (SELECT id FROM public.orders WHERE event_id IN (SELECT id FROM i2117adv_ev));
DELETE FROM public.orders           WHERE event_id IN (SELECT id FROM i2117adv_ev);
DELETE FROM public.trip_pricing_tiers WHERE event_id IN (SELECT id FROM i2117adv_ev);
DELETE FROM public.ticket_types     WHERE event_id IN (SELECT id FROM i2117adv_ev);
DELETE FROM public.event_dates      WHERE event_id IN (SELECT id FROM i2117adv_ev);
DELETE FROM public.events           WHERE id       IN (SELECT id FROM i2117adv_ev);
DROP TABLE i2117adv_ev;
DROP SCHEMA i2117adv CASCADE;
DELETE FROM public.brands WHERE slug = 'i2117adv-brand';
DELETE FROM public.creator_accounts
  WHERE id IN ('00000000-2117-4000-a000-0000000000a1','00000000-2117-4000-a000-0000000000a2');
DELETE FROM auth.users
  WHERE id IN ('00000000-2117-4000-a000-0000000000a1','00000000-2117-4000-a000-0000000000a2');
