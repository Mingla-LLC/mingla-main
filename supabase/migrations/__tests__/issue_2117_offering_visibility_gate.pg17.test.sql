-- =====================================================================
-- issue #2117 -- executable coverage for the Offering Visibility Gate.
--
-- Contract: BINDING SPEC (#issuecomment-5310185921) + AMENDMENT 1
-- (#issuecomment-5310364586) + AMENDMENT 2 (#issuecomment-5310590806),
-- AMENDMENT 2 CONTROLLING. §8 step-0 evidence: #issuecomment-5310742144.
--
-- EVERY assertion below EXECUTES an object against real rows. Per #2113,
-- and because several guards in exactly this area have proven satisfiable
-- by source text alone, NOTHING here asserts on migration text, on
-- pg_get_functiondef output, or on any other source representation. A
-- source-text assertion satisfies NO criterion in this file.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f <this file>
-- after applying every migration in timestamp order to
-- supabase/postgres:17.4.1.075.
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

DO $suite$
DECLARE
  v_fail_count int := 0;
  v_assert_count int := 0;
  v_allow_seen  int := 0;
  v_deny_seen   int := 0;
BEGIN
  RAISE NOTICE '=== issue #2117 Offering Visibility Gate -- executable suite ===';
END $suite$;

-- ---------------------------------------------------------------------
-- 0. Harness: results table, assertion helper, fixture builder.
-- ---------------------------------------------------------------------
DROP SCHEMA IF EXISTS i2117t CASCADE;

-- Idempotent pre-clean: a previous aborted run may have left fixture rows
-- and a probe role behind. Children first -- cascading a brand delete fires
-- sale-revocation triggers.
DO $preclean$
BEGIN
  CREATE TEMP TABLE i2117t_pre AS
    SELECT id FROM public.events WHERE brand_id = '00000000-2117-4000-8000-0000000000bb';
  DELETE FROM public.tickets          WHERE event_id IN (SELECT id FROM i2117t_pre);
  DELETE FROM public.order_line_items WHERE order_id IN
    (SELECT id FROM public.orders WHERE event_id IN (SELECT id FROM i2117t_pre));
  DELETE FROM public.orders           WHERE event_id IN (SELECT id FROM i2117t_pre);
  DELETE FROM public.ticket_types     WHERE event_id IN (SELECT id FROM i2117t_pre);
  DELETE FROM public.event_dates      WHERE event_id IN (SELECT id FROM i2117t_pre);
  DELETE FROM public.events           WHERE id       IN (SELECT id FROM i2117t_pre);
  DROP TABLE i2117t_pre;
  DELETE FROM public.brands WHERE slug = 'i2117t-brand';
  DELETE FROM public.creator_accounts
    WHERE id IN ('00000000-2117-4000-8000-0000000000a1','00000000-2117-4000-8000-0000000000a2');
  DELETE FROM auth.users
    WHERE id IN ('00000000-2117-4000-8000-0000000000a1','00000000-2117-4000-8000-0000000000a2');
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'i2117t_zero') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA public FROM i2117t_zero';
    EXECUTE 'REVOKE ALL ON FUNCTION public.pg_offering_visibility_gate(text,timestamptz,text) FROM i2117t_zero';
    EXECUTE 'REVOKE ALL ON FUNCTION public.pg_offering_passes_visibility_gate(uuid,text) FROM i2117t_zero';
    EXECUTE 'DROP ROLE i2117t_zero';
  END IF;
END $preclean$;

CREATE SCHEMA i2117t;

CREATE TABLE i2117t.result(
  id serial primary key,
  criterion text not null,
  name      text not null,
  outcome   text not null,          -- PASS | FAIL
  detail    text,
  verdict   text                    -- ALLOW | DENY | NA  (drives A-SC-10)
);

CREATE FUNCTION i2117t.assert(
  p_criterion text, p_name text, p_ok boolean, p_detail text, p_verdict text DEFAULT 'NA'
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO i2117t.result(criterion, name, outcome, detail, verdict)
  VALUES (p_criterion, p_name, CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END, p_detail, p_verdict);
END $$;

-- Fixture matrix: every offering type x every visibility state, plus
-- status fixtures so A-SC-4 and A-SC-10 are STATUS-COMPLETE and not merely
-- visibility-complete. A single publicly-visible fixture cannot see a
-- status-driven widening, which is the defect A-4.2 exists to prevent.
CREATE TABLE i2117t.ids(k text primary key, v uuid);
INSERT INTO i2117t.ids VALUES
  ('organiser','00000000-2117-4000-8000-0000000000a1'),
  ('stranger' ,'00000000-2117-4000-8000-0000000000a2'),
  ('brand'    ,'00000000-2117-4000-8000-0000000000bb');

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
SELECT v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',k||'@i2117t.test','x',now(),now()
FROM i2117t.ids WHERE k IN ('organiser','stranger') ON CONFLICT DO NOTHING;
INSERT INTO public.creator_accounts(id) SELECT v FROM i2117t.ids WHERE k IN ('organiser','stranger') ON CONFLICT DO NOTHING;
INSERT INTO public.brands(id,account_id,name,slug,claim_status,pricing_currency,default_currency)
SELECT (SELECT v FROM i2117t.ids WHERE k='brand'),(SELECT v FROM i2117t.ids WHERE k='organiser'),
       'I2117T Brand','i2117t-brand','verified','usd','USD';

CREATE TABLE i2117t.offering(
  key text primary key, event_id uuid, tier_id uuid, order_id uuid,
  etype text, visibility text, status text, slug text);

DO $fx$
DECLARE r record; v_ev uuid; v_tt uuid; v_or uuid; v_brand uuid;
BEGIN
  SELECT v INTO v_brand FROM i2117t.ids WHERE k='brand';
  FOR r IN
    -- every type x every visibility, at a live status
    SELECT t.etype, v.vis, 'live'::text AS st, t.etype||'_'||v.vis||'_live' AS key
    FROM (VALUES ('trip'),('experience'),('event')) t(etype)
    CROSS JOIN (VALUES ('public'),('discover'),('private'),('hidden'),('draft')) v(vis)
    UNION ALL
    -- STATUS COMPLETENESS: publicly-visible fixtures at every status value
    -- in the union of the change set's declared status sets (A-SC-10.5).
    SELECT t.etype,'public', s.st, t.etype||'_public_'||s.st
    FROM (VALUES ('trip'),('experience')) t(etype)
    CROSS JOIN (VALUES ('scheduled'),('ended'),('cancelled')) s(st)
  LOOP
    v_ev := gen_random_uuid(); v_tt := gen_random_uuid(); v_or := gen_random_uuid();
    INSERT INTO public.events(id,brand_id,title,slug,event_type,visibility,status,timezone,published_at,currency)
      VALUES (v_ev,v_brand,'I2117T '||r.key, replace(r.key,'_','-'), r.etype, r.vis, r.st,'UTC',now(),'usd');
    INSERT INTO public.event_dates(event_id,start_at,end_at,is_master,timezone)
      VALUES (v_ev, now()+interval '10 day', now()+interval '10 day 3 hour', true,'UTC');
    INSERT INTO public.ticket_types(id,event_id,name,price_cents,currency,quantity_total,is_unlimited,is_free)
      VALUES (v_tt,v_ev,'GA',5000,'usd',100,false,false);
    INSERT INTO public.orders(id,event_id,payment_status,payment_method,source,total_cents,currency,buyer_phone_e164)
      VALUES (v_or,v_ev,'paid','apple_pay','online_checkout',10000,'usd','+12015550199');
    INSERT INTO public.order_line_items(order_id,ticket_type_id,quantity,unit_price_cents)
      VALUES (v_or,v_tt,2,5000);
    INSERT INTO public.tickets(order_id,ticket_type_id,event_id,qr_code,status)
      VALUES (v_or,v_tt,v_ev,'i2117t-'||r.key||'-1','valid'),
             (v_or,v_tt,v_ev,'i2117t-'||r.key||'-2','valid');
    INSERT INTO i2117t.offering VALUES (r.key,v_ev,v_tt,v_or,r.etype,r.vis,r.st, replace(r.key,'_','-'));
  END LOOP;
END $fx$;

GRANT USAGE ON SCHEMA i2117t TO anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA i2117t TO anon, authenticated;

-- ---------------------------------------------------------------------
-- SC-1 -- the scalar gate exists, is pure, and answers correctly from a
-- role holding ZERO privileges on the offering relation, without raising.
-- Revert mutation: make Form A read the offering table. MUST RED, because
-- the zero-privilege role then gets `permission denied for table events`.
-- ---------------------------------------------------------------------
CREATE ROLE i2117t_zero;
GRANT USAGE ON SCHEMA public, i2117t TO i2117t_zero;
GRANT SELECT ON ALL TABLES IN SCHEMA i2117t TO i2117t_zero;
REVOKE ALL ON public.events FROM i2117t_zero;
GRANT EXECUTE ON FUNCTION public.pg_offering_visibility_gate(text,timestamptz,text) TO i2117t_zero;
GRANT EXECUTE ON FUNCTION public.pg_offering_passes_visibility_gate(uuid,text) TO i2117t_zero;
DO $g$ BEGIN EXECUTE format('GRANT i2117t_zero TO %I', current_user); END $g$;

DO $sc1$
DECLARE v_direct_read_raised boolean := false; v boolean; ok boolean := true; d text := '';
BEGIN
  SET LOCAL ROLE i2117t_zero;
  -- the #1931 Amendment 3 condition must actually hold for this to prove anything
  BEGIN
    PERFORM count(*) FROM public.events;
  EXCEPTION WHEN insufficient_privilege THEN v_direct_read_raised := true;
  END;
  -- Form A answers correctly for every (visibility x audience) pair
  FOR v IN
    SELECT public.pg_offering_visibility_gate(x.vis, NULL, x.aud) = x.expected
    FROM (VALUES
      ('public','listing',true),  ('discover','listing',false),
      ('private','listing',false),('hidden','listing',false), ('draft','listing',false),
      ('public','direct',true),   ('discover','direct',false),
      ('private','direct',false), ('hidden','direct',true),    ('draft','direct',false)
    ) x(vis,aud,expected)
  LOOP ok := ok AND v; END LOOP;
  -- total and fail-closed on every degenerate input; never NULL, never raise
  ok := ok
    AND public.pg_offering_visibility_gate('public', now(), 'listing') = false   -- soft-deleted
    AND public.pg_offering_visibility_gate(NULL, NULL, 'listing')      = false   -- null visibility
    AND public.pg_offering_visibility_gate('public', NULL, 'bogus')    = false   -- out-of-set audience
    AND public.pg_offering_visibility_gate('public', NULL, NULL)       = false   -- null audience
    AND public.pg_offering_visibility_gate(NULL, NULL, NULL)           = false;
  RESET ROLE;
  d := format('direct_read_raised=%s (must be true, else the immunity claim is vacuous)', v_direct_read_raised);
  PERFORM i2117t.assert('SC-1','scalar gate pure + correct from zero-privilege role',
    ok AND v_direct_read_raised, d, 'NA');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM i2117t.assert('SC-1','scalar gate pure + correct from zero-privilege role', false,
    'RAISED: '||SQLERRM, 'NA');
END $sc1$;

-- ---------------------------------------------------------------------
-- SC-2 -- the identifier gate is privilege-independent.
-- Revert mutation: drop SECURITY DEFINER from Form B. MUST RED -- it then
-- inherits the caller's missing privilege and raises.
-- ---------------------------------------------------------------------
DO $sc2$
DECLARE ok boolean := true; r record;
BEGIN
  SET LOCAL ROLE i2117t_zero;
  FOR r IN SELECT * FROM i2117t.offering WHERE etype='trip' AND status='live' LOOP
    ok := ok
      AND public.pg_offering_passes_visibility_gate(r.event_id,'listing') = (r.visibility = 'public')
      AND public.pg_offering_passes_visibility_gate(r.event_id,'direct')  = (r.visibility IN ('public','hidden'));
  END LOOP;
  -- unresolvable / NULL identifier: false, never NULL, never a raise
  ok := ok
    AND public.pg_offering_passes_visibility_gate('00000000-0000-0000-0000-0000deadbeef','listing') = false
    AND public.pg_offering_passes_visibility_gate(NULL,'listing') = false
    AND public.pg_offering_passes_visibility_gate('00000000-0000-0000-0000-0000deadbeef','bogus') = false;
  RESET ROLE;
  PERFORM i2117t.assert('SC-2','identifier gate correct + never raises from zero-privilege role',
    ok, 'all five states + unresolvable + NULL id + out-of-set audience', 'NA');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM i2117t.assert('SC-2','identifier gate correct + never raises from zero-privilege role',
    false, 'RAISED: '||SQLERRM, 'NA');
END $sc2$;

-- ---------------------------------------------------------------------
-- A-SC-3 (replaces SC-3) -- NO changed object's result varies with the
-- caller's ROLE. Asserts the PROPERTY, not a list of banned mechanisms:
-- the named-mechanism form was independently forged twice during review
-- and both forgeries PASS the mechanism ban while leaking.
--
-- Per the approving reviewer's note 1: hold the caller's IDENTITY claim
-- CONSTANT and vary the ROLE together with the ROLE CLAIM. Under the other
-- reading (freeze the entire claim payload) a role-claim-branching forgery
-- greens -- A-SC-14 below catches it either way, but the criteria compose
-- and neither may be weakened.
--
-- Revert mutation: add a role check to either gate form, or make any
-- changed object branch on the role GUC. MUST RED.
--
-- The no-SET-ROLE probe is RETAINED as an additional requirement (it is
-- what catches the named mechanism, which raises `role "none" does not
-- exist`), but is no longer sufficient on its own.
-- ---------------------------------------------------------------------
CREATE FUNCTION i2117t.crossrole(p_role text, p_roleclaim text)
RETURNS TABLE(obj text, okey text, val text) LANGUAGE plpgsql AS $$
DECLARE r record; v_org uuid; v_out text;
BEGIN
  SELECT ids.v INTO v_org FROM i2117t.ids ids WHERE ids.k='organiser';
  FOR r IN SELECT * FROM i2117t.offering ORDER BY key LOOP
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    PERFORM set_config('request.jwt.claim.sub', v_org::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub',v_org,'role',p_roleclaim)::text, true);
    PERFORM set_config('request.jwt.claim.role', p_roleclaim, true);
    BEGIN EXECUTE 'SELECT count(*)::text FROM public.pg_public_event_tier_allin($1)' INTO v_out USING r.event_id;
    EXCEPTION WHEN OTHERS THEN v_out := 'ERR:'||SQLERRM; END;
    obj:='tier_allin'; okey:=r.key; val:=v_out; RETURN NEXT;
    BEGIN EXECUTE 'SELECT count(*)::text FROM public.pg_public_ticket_types_remaining($1)' INTO v_out USING r.event_id;
    EXCEPTION WHEN OTHERS THEN v_out := 'ERR:'||SQLERRM; END;
    obj:='remaining'; okey:=r.key; val:=v_out; RETURN NEXT;
    BEGIN EXECUTE 'SELECT public.biz_experience_sold_count($1)::text' INTO v_out USING r.event_id;
    EXCEPTION WHEN OTHERS THEN v_out := 'ERR:'||SQLERRM; END;
    obj:='exp_sold'; okey:=r.key; val:=v_out; RETURN NEXT;
    BEGIN EXECUTE 'SELECT public.biz_trip_tickets_sold_by_tier($1)::text' INTO v_out USING r.event_id;
    EXCEPTION WHEN OTHERS THEN v_out := 'ERR:'||SQLERRM; END;
    obj:='tickets_by_tier'; okey:=r.key; val:=v_out; RETURN NEXT;
    BEGIN EXECUTE 'SELECT public.biz_trip_has_web_purchases($1)::text' INTO v_out USING r.event_id;
    EXCEPTION WHEN OTHERS THEN v_out := 'ERR:'||SQLERRM; END;
    obj:='has_web_purch'; okey:=r.key; val:=v_out; RETURN NEXT;
    BEGIN EXECUTE 'SELECT (public.pg_public_trip_by_slug($1,$2) IS NOT NULL)::text' INTO v_out
      USING 'i2117t-brand', r.slug;
    EXCEPTION WHEN OTHERS THEN v_out := 'ERR:'||SQLERRM; END;
    obj:='trip_by_slug'; okey:=r.key; val:=v_out; RETURN NEXT;
    BEGIN EXECUTE 'SELECT (public.pg_public_experience_by_slug($1,$2) IS NOT NULL)::text' INTO v_out
      USING 'i2117t-brand', r.slug;
    EXCEPTION WHEN OTHERS THEN v_out := 'ERR:'||SQLERRM; END;
    obj:='exp_by_slug'; okey:=r.key; val:=v_out; RETURN NEXT;
    RESET ROLE;
  END LOOP;
END $$;

DO $asc3$
DECLARE v_diff int; v_total int; v_noraise boolean := true;
BEGIN
  WITH a AS (SELECT * FROM i2117t.crossrole('anon','anon')),
       b AS (SELECT * FROM i2117t.crossrole('authenticated','authenticated'))
  SELECT count(*) FILTER (WHERE a.val IS DISTINCT FROM b.val), count(*)
    INTO v_diff, v_total
  FROM a FULL JOIN b USING (obj, okey);

  PERFORM i2117t.assert('A-SC-3',
    'no changed object''s result varies with the caller''s role',
    v_diff = 0 AND v_total > 0,
    format('role_dependent_cells=%s of %s compared', v_diff, v_total), 'NA');
END $asc3$;

-- A-SC-3 retained clause: every changed object answers in a session that
-- has NEVER issued SET ROLE, and none raises. The named role-introspecting
-- mechanism raises `role "none" does not exist` here.
DO $asc3b$
DECLARE r record; ok boolean := true; d text := '';
BEGIN
  SELECT * INTO r FROM i2117t.offering WHERE key='trip_public_live';
  BEGIN
    PERFORM count(*) FROM public.pg_public_event_tier_allin(r.event_id);
    PERFORM count(*) FROM public.pg_public_ticket_types_remaining(r.event_id);
    PERFORM public.pg_public_trip_by_slug('i2117t-brand', r.slug);
    PERFORM public.pg_public_experience_by_slug('i2117t-brand', r.slug);
    PERFORM public.biz_experience_sold_count(r.event_id);
    PERFORM public.biz_trip_tickets_sold_by_tier(r.event_id);
    PERFORM public.biz_trip_has_web_purchases(r.event_id);
    PERFORM public.pg_offering_passes_visibility_gate(r.event_id,'listing');
  EXCEPTION WHEN OTHERS THEN ok := false; d := 'RAISED: '||SQLERRM;
  END;
  PERFORM i2117t.assert('A-SC-3','every changed object answers with no SET ROLE ever issued',
    ok, COALESCE(NULLIF(d,''),'all objects answered, none raised'), 'NA');
END $asc3b$;

-- ---------------------------------------------------------------------
-- A-SC-4 (amends SC-4) -- publicly visible offerings behave IDENTICALLY,
-- and the measurement is STATUS-COMPLETE: it runs for every
-- (offering type x status) pair in the reader's declared status set, not
-- for "a publicly visible fixture". A single public fixture cannot see a
-- status-driven widening.
--
-- The pre-change expectation is encoded from the MEASURED pre-change
-- behaviour at origin/main f4d1df0a:
--   * the trip render reader admits {scheduled, live} -- so a publicly
--     visible ENDED or CANCELLED trip was denied BEFORE and must stay
--     denied AFTER;
--   * the experience render reader admits {scheduled, live, ended,
--     cancelled} -- so a publicly visible ENDED experience was served
--     BEFORE and must stay served AFTER.
-- Folding status into the audience flips one of those. That is the
-- widening A-4.2 exists to prevent and SC-4 was blind to.
--
-- Revert mutation: change an audience from 'direct' to 'listing' on a
-- reader whose derivation says 'direct', or fold status into the audience.
-- MUST RED.
-- ---------------------------------------------------------------------
DO $asc4$
DECLARE r record; ok boolean := true; d text := ''; v_served boolean; v_expected boolean;
BEGIN
  FOR r IN SELECT * FROM i2117t.offering WHERE visibility='public' ORDER BY key LOOP
    IF r.etype = 'trip' THEN
      v_expected := r.status IN ('scheduled','live');
      v_served := public.pg_public_trip_by_slug('i2117t-brand', r.slug) IS NOT NULL;
      IF v_served <> v_expected THEN
        ok := false; d := d || format(' trip/%s served=%s expected=%s;', r.status, v_served, v_expected);
      END IF;
    ELSIF r.etype = 'experience' THEN
      v_expected := r.status IN ('scheduled','live','ended','cancelled');
      v_served := public.pg_public_experience_by_slug('i2117t-brand', r.slug) IS NOT NULL;
      IF v_served <> v_expected THEN
        ok := false; d := d || format(' experience/%s served=%s expected=%s;', r.status, v_served, v_expected);
      END IF;
    END IF;
    -- the event-keyed readers carry no status predicate; a publicly
    -- visible offering must return its rows at EVERY status.
    IF (SELECT count(*) FROM public.pg_public_event_tier_allin(r.event_id)) = 0 THEN
      ok := false; d := d || format(' tier_allin public/%s/%s returned 0 rows;', r.etype, r.status);
    END IF;
    IF (SELECT count(*) FROM public.pg_public_ticket_types_remaining(r.event_id)) = 0 THEN
      ok := false; d := d || format(' remaining public/%s/%s returned 0 rows;', r.etype, r.status);
    END IF;
  END LOOP;
  PERFORM i2117t.assert('A-SC-4','public path status-complete and unchanged',
    ok, COALESCE(NULLIF(d,''),'every public (type x status) pair matches the pre-change behaviour'), 'ALLOW');
END $asc4$;

-- ---------------------------------------------------------------------
-- SC-5 -- non-public offerings are DENIED to an unauthorised caller,
-- executed as anon AND again as a signed-in stranger, and the reader
-- returns its DOCUMENTED EMPTY VALUE without raising. A raise would be an
-- observable behavioural change and is out of contract.
-- Revert mutation: delete the gate conjunct from a reader. MUST RED.
-- ---------------------------------------------------------------------
DO $sc5$
DECLARE r record; role_name text; ok boolean := true; d text := ''; n int; j json;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOR r IN SELECT * FROM i2117t.offering WHERE status='live' AND visibility <> 'public' ORDER BY key LOOP
      EXECUTE format('SET LOCAL ROLE %I', role_name);
      PERFORM set_config('request.jwt.claim.role', role_name, true);
      -- 'listing' readers deny every non-public state including hidden
      IF r.etype='trip' THEN
        EXECUTE 'SELECT public.pg_public_trip_by_slug($1,$2)' INTO j USING 'i2117t-brand', r.slug;
        IF j IS NOT NULL THEN ok := false; d := d||format(' trip_by_slug/%s/%s SERVED;', role_name, r.visibility); END IF;
      END IF;
      IF r.etype='experience' THEN
        EXECUTE 'SELECT public.pg_public_experience_by_slug($1,$2)' INTO j USING 'i2117t-brand', r.slug;
        IF j IS NOT NULL THEN ok := false; d := d||format(' exp_by_slug/%s/%s SERVED;', role_name, r.visibility); END IF;
      END IF;
      -- 'direct' readers deny discover / private / draft (hidden is the
      -- deliberate unlisted acquisition contract -- see SC-6)
      IF r.visibility IN ('discover','private','draft') THEN
        EXECUTE 'SELECT count(*)::int FROM public.pg_public_event_tier_allin($1)' INTO n USING r.event_id;
        IF n <> 0 THEN ok := false; d := d||format(' tier_allin/%s/%s returned %s rows;', role_name, r.visibility, n); END IF;
        EXECUTE 'SELECT count(*)::int FROM public.pg_public_ticket_types_remaining($1)' INTO n USING r.event_id;
        IF n <> 0 THEN ok := false; d := d||format(' remaining/%s/%s returned %s rows;', role_name, r.visibility, n); END IF;
      END IF;
      RESET ROLE;
    END LOOP;
  END LOOP;
  PERFORM i2117t.assert('SC-5','non-public denied to anon AND to a signed-in stranger',
    ok, COALESCE(NULLIF(d,''),'all excluded states return the documented empty value, no raise'), 'DENY');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM i2117t.assert('SC-5','non-public denied to anon AND to a signed-in stranger', false,
    'RAISED (out of contract): '||SQLERRM, 'DENY');
END $sc5$;

-- ---------------------------------------------------------------------
-- SC-6 -- the UNLISTED contract is preserved. Every reader on the
-- acquisition path still returns FULL data for an unlisted fixture, to
-- anon. SC-5 and SC-6 MUST BE GREEN SIMULTANEOUSLY: a change that
-- satisfies one by breaking the other FAILS.
-- Revert mutation: change an acquisition-path reader's audience to
-- 'listing'. MUST RED.
-- ---------------------------------------------------------------------
DO $sc6$
DECLARE r record; ok boolean := true; d text := ''; n int;
BEGIN
  FOR r IN SELECT * FROM i2117t.offering WHERE visibility='hidden' AND status='live' ORDER BY key LOOP
    SET LOCAL ROLE anon;
    EXECUTE 'SELECT count(*)::int FROM public.pg_public_event_tier_allin($1)' INTO n USING r.event_id;
    IF n = 0 THEN ok := false; d := d||format(' tier_allin lost the unlisted %s;', r.etype); END IF;
    EXECUTE 'SELECT count(*)::int FROM public.pg_public_ticket_types_remaining($1)' INTO n USING r.event_id;
    IF n = 0 THEN ok := false; d := d||format(' remaining lost the unlisted %s;', r.etype); END IF;
    RESET ROLE;
  END LOOP;
  PERFORM i2117t.assert('SC-6','unlisted exact-link acquisition contract preserved',
    ok, COALESCE(NULLIF(d,''),'acquisition-path readers still serve the unlisted state to anon'), 'ALLOW');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM i2117t.assert('SC-6','unlisted exact-link acquisition contract preserved', false,
    'RAISED: '||SQLERRM, 'ALLOW');
END $sc6$;

-- ---------------------------------------------------------------------
-- SC-7 -- the ORGANISER path does not regress. Each authorisation-arm
-- object returns its FULL value for a caller authorised on the offering's
-- brand at EVERY visibility state including draft and private, and its
-- documented empty value for an unauthorised caller.
-- Revert mutation: replace the authorisation predicate with the visibility
-- gate. MUST RED -- the organiser case flips to empty at four of five.
-- ---------------------------------------------------------------------
DO $sc7$
DECLARE r record; v_org uuid; v_str uuid; ok boolean := true; d text := '';
        a int; b jsonb; c boolean;
BEGIN
  SELECT v INTO v_org FROM i2117t.ids WHERE k='organiser';
  SELECT v INTO v_str FROM i2117t.ids WHERE k='stranger';
  FOR r IN SELECT * FROM i2117t.offering WHERE status='live' ORDER BY key LOOP
    -- authorised organiser: FULL value at EVERY visibility state
    PERFORM set_config('request.jwt.claim.sub', v_org::text, true);
    a := public.biz_experience_sold_count(r.event_id);
    b := public.biz_trip_tickets_sold_by_tier(r.event_id);
    c := public.biz_trip_has_web_purchases(r.event_id);
    IF a <> 2 THEN ok := false; d := d||format(' organiser exp_sold %s/%s = %s (want 2);', r.etype, r.visibility, a); END IF;
    IF b = '{}'::jsonb THEN ok := false; d := d||format(' organiser tickets_by_tier %s/%s empty;', r.etype, r.visibility); END IF;
    IF c <> true THEN ok := false; d := d||format(' organiser has_web_purch %s/%s false;', r.etype, r.visibility); END IF;
    -- unauthorised stranger: documented empty value
    PERFORM set_config('request.jwt.claim.sub', v_str::text, true);
    a := public.biz_experience_sold_count(r.event_id);
    b := public.biz_trip_tickets_sold_by_tier(r.event_id);
    c := public.biz_trip_has_web_purchases(r.event_id);
    IF a <> 0 THEN ok := false; d := d||format(' STRANGER exp_sold %s/%s = %s (want 0);', r.etype, r.visibility, a); END IF;
    IF b <> '{}'::jsonb THEN ok := false; d := d||format(' STRANGER tickets_by_tier %s/%s leaked;', r.etype, r.visibility); END IF;
    IF c <> false THEN ok := false; d := d||format(' STRANGER has_web_purch %s/%s leaked;', r.etype, r.visibility); END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM i2117t.assert('SC-7','organiser full value at every state; stranger empty',
    ok, COALESCE(NULLIF(d,''),'authorisation arm preserves the organiser at all five states'),
    CASE WHEN ok THEN 'ALLOW' ELSE 'NA' END);
END $sc7$;

-- ---------------------------------------------------------------------
-- A-SC-8 (replaces SC-8's model) -- privileged consumers measured on their
-- OBSERVABLE OUTPUT, not on an error branch. The measured failure produces
-- NO ERROR: the narrowed reader returns zero rows, the consumer's error
-- branch is never taken, and it computes capacity 0 / remaining 0 and
-- emits a false sold-out notification. Asserting on the error branch
-- satisfies NOTHING.
--
-- Here we assert the property the consumers depend on: each privileged
-- sibling returns, at EVERY visibility state its consumer reaches, exactly
-- what the pre-change reader returned -- i.e. it is NOT gated.
-- Revert mutation: repoint a privileged consumer at the narrowed
-- signature, or add a gate conjunct to a sibling. MUST RED.
-- ---------------------------------------------------------------------
DO $asc8$
DECLARE r record; ok boolean := true; d text := ''; n_sib int; n_pub int;
BEGIN
  FOR r IN SELECT * FROM i2117t.offering ORDER BY key LOOP
    SELECT count(*) INTO n_sib FROM public.pg_privileged_ticket_types_remaining(r.event_id);
    IF n_sib = 0 THEN
      ok := false; d := d||format(' remaining-sibling empty at %s/%s;', r.etype, r.visibility);
    END IF;
    SELECT count(*) INTO n_sib FROM public.pg_privileged_event_tier_allin(r.event_id);
    IF n_sib = 0 THEN
      ok := false; d := d||format(' tier-allin-sibling empty at %s/%s;', r.etype, r.visibility);
    END IF;
  END LOOP;
  -- and the narrowed public readers DO deny the state the share-preview
  -- consumer needs, which is exactly why the siblings must exist
  SELECT count(*) INTO n_pub FROM public.pg_public_ticket_types_remaining(
    (SELECT event_id FROM i2117t.offering WHERE key='event_discover_live'));
  IF n_pub <> 0 THEN
    ok := false; d := d||' narrowed reader still serves the discover state -- sibling rationale invalid;';
  END IF;
  PERFORM i2117t.assert('A-SC-8','privileged siblings ungated at every state consumers reach',
    ok, COALESCE(NULLIF(d,''),'both siblings return data at all states; narrowed readers deny discover'), 'ALLOW');
END $asc8$;

-- ---------------------------------------------------------------------
-- A-SC-9 -- a SET DIFFERENCE, not a count (Amendment 3, approved at
-- #issuecomment-5310929665; two recorded reasons corrected by Amendment 4
-- at #issuecomment-5310959026).
--
-- WHY A COUNT CANNOT WORK, AND WHY THIS IS NOT A THIRD ATTEMPT AT ONE.
-- Three times on this issue's family a criterion has redded correct code,
-- and every time it was the same criterion asserting a property of the
-- WHOLE CATALOG as a SCALAR: first a hardcoded literal that drifted with
-- unrelated merges; then a count that could not accommodate a grant
-- correction the contract itself required; then a count and a
-- warning-total that the ladder's own R-2 rung necessarily moves. The
-- defect is not the numbers. A scalar summarising a whole catalog CANNOT
-- DISTINGUISH A CONTRACTED CHANGE FROM AN UNCONTRACTED ONE, so it must
-- either forbid all movement -- and red correct code the moment the
-- contract legitimately moves it -- or permit movement by magnitude, and
-- go green on any change of the same size. Both failure modes are
-- guaranteed by the SHAPE of the assertion, and both were demonstrated on
-- this issue by execution.
--
-- The general fix, adopted here: ASSERT OVER MEMBERSHIP, NOT MAGNITUDE,
-- AND VALIDATE THE REFERENCE SET INDEPENDENTLY OF THE PARTY BEING CHECKED.
--
-- The forgery this replaces a count with: an unrelated allowlisted reader
-- silently LOSING the governed audience's EXECUTE (an availability
-- regression nobody enumerated) plus an allowlisted-but-unreachable object
-- silently REGAINING it (a re-exposure, which also makes one pre-existing
-- stale warning vanish). Those two cancel on both scalars -- probe
-- 187 -> 184 and stale 5 -> 8, identical to a correct run -- and the
-- forward gate still exits 0. The set form reds it three ways.
--
-- Clause 1 (zero allowlist lines added or removed) is UNCHANGED and still
-- binding; it is enforced against the exact base commit by this issue's
-- workflow, because it is a property of the FILE rather than the catalog.
-- ---------------------------------------------------------------------

-- The reference set for clause (b): the objects recorded at rung R-2 in the
-- §8 step-0 evidence (#issuecomment-5310742144), which A-4.0 requires to be
-- derived from the catalog and recorded on the issue BEFORE the migration
-- is written.
--
-- CORRECTION 1 (Amendment 4) -- READ THIS BEFORE WEAKENING ANYTHING BELOW.
-- It is NOT clause (c) that stops this list being widened to absorb an
-- unexplained departure. That was the superseded reason and it is FALSE:
-- a rogue departure's post-change access list is BYTE-IDENTICAL to a
-- genuine R-2 narrowing -- owner and the privileged service role, neither
-- governed-audience role -- and it is already allowlisted, so BOTH of (c)'s
-- tests pass on it. Widening this list would green (b), (c) and (d)
-- together.
--
-- The actual guard is CLAUSE (b) READ TOGETHER WITH A-4.0's CHANGE-SET
-- CONSTRAINT: an object outside the change set has no step-0 rung evidence
-- to widen, so this list is by construction a subset of a set fixed in
-- advance and derived independently of the implementor. That makes the
-- step-0 recording LOAD-BEARING rather than documentary -- it is the
-- reference set of a merge-gating criterion. A set assertion whose
-- reference list the implementor can edit is a scalar again, in better
-- clothes.
CREATE TABLE i2117t.recorded_r2(sig text primary key);
INSERT INTO i2117t.recorded_r2(sig) VALUES
  ('pg_recurrence_is_terminated(p_rule jsonb, p_event_id uuid, p_now timestamp with time zone)'),
  ('biz_trip_sold_count_by_tier(p_event_id uuid)'),
  ('resolve_event_pricing_inputs(p_event_id uuid)');

-- Non-vacuity gate for the whole criterion: without a genuine BEFORE
-- snapshot every set difference is vacuously satisfiable, so a skipped
-- capture must be a LOUD failure and never a silent pass.
DO $asc9_guard$
DECLARE v int;
BEGIN
  IF to_regclass('i2117_asc9.probe_before') IS NULL THEN
    RAISE EXCEPTION 'A-SC-9 CANNOT BE EVALUATED: the baseline snapshot i2117_asc9.probe_before is absent. Run supabase/migrations/__tests__/issue_2117_asc9_baseline_capture.sql after the rest of the chain and BEFORE the #2117 migration. A criterion that cannot be evaluated is not a criterion that passed.';
  END IF;
  EXECUTE 'SELECT count(*) FROM i2117_asc9.probe_before' INTO v;
  IF v = 0 THEN
    RAISE EXCEPTION 'A-SC-9 CANNOT BE EVALUATED: the baseline probe snapshot is EMPTY, which would make every set difference vacuously green.';
  END IF;
END $asc9_guard$;

DO $asc9_set$
DECLARE
  v_arrived    text[];
  v_departed   text[];
  v_recorded   text[];
  v_stale_gone text[];
  v_stale_new  text[];
  v_badshape   text[];
  v_unallow    text[];
BEGIN
  SELECT COALESCE(array_agg(sig ORDER BY sig), '{}') INTO v_arrived
  FROM (SELECT sig FROM i2117_asc9.probe_now EXCEPT SELECT sig FROM i2117_asc9.probe_before) x;

  SELECT COALESCE(array_agg(sig ORDER BY sig), '{}') INTO v_departed
  FROM (SELECT sig FROM i2117_asc9.probe_before EXCEPT SELECT sig FROM i2117_asc9.probe_now) x;

  SELECT COALESCE(array_agg(sig ORDER BY sig), '{}') INTO v_recorded
  FROM (SELECT sig FROM i2117t.recorded_r2) x;

  -- (a) NOTHING ENTERS. Unconditional -- no allowance, no exceptions.
  --     Revert mutation: grant EXECUTE on a gate form or a privileged
  --     sibling to the governed audience. MUST RED.
  PERFORM i2117t.assert('A-SC-9(a)','nothing enters the governed audience',
    cardinality(v_arrived) = 0,
    format('arrived=%s (must be empty)', v_arrived), 'DENY');

  -- (b) WHAT LEAVES IS EXACTLY WHAT WAS CONTRACTED TO LEAVE -- the SET,
  --     not its cardinality, compared against the step-0 R-2 record.
  --     This is the clause that catches movement on objects NOBODY
  --     enumerated, and it is the only clause that fires on A-SC-14's
  --     mutation. Revert mutations: quietly restore the governed
  --     audience's EXECUTE on an R-2 object (departed set short a member),
  --     or narrow an object nobody recorded (departed set gains one).
  --     MUST RED.
  PERFORM i2117t.assert('A-SC-9(b)','departed set equals the recorded R-2 set exactly',
    v_departed = v_recorded,
    format('departed=%s recorded_R2=%s', v_departed, v_recorded), 'DENY');

  -- (c) EVERY DEPARTURE IS SHAPE-VALID AGAINST THE LIVE CATALOG: it is
  --     allowlisted, and its post-change access list grants EXECUTE to the
  --     privileged service role and to NEITHER governed-audience role.
  --
  --     CORRECTION 1: this validates the SHAPE of a departure ONLY. It
  --     catches a departure whose post-state is not a narrowing at all --
  --     an object dropped, renamed, or stripped of the service role too.
  --     It does NOT and CANNOT prove a departure was contracted, because
  --     every deliberate narrowing produces this same shape. Do not lean
  --     on it for anything else.
  SELECT COALESCE(array_agg(d.sig ORDER BY d.sig), '{}') INTO v_badshape
  FROM unnest(v_departed) AS d(sig)
  WHERE NOT EXISTS (SELECT 1 FROM i2117_asc9.allowlist a WHERE a.sig = d.sig)
     OR NOT EXISTS (
          SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = d.sig
            AND has_function_privilege('service_role', p.oid, 'EXECUTE')
            AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
            AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  PERFORM i2117t.assert('A-SC-9(c)','every departure is shape-valid against the live catalog',
    cardinality(v_badshape) = 0,
    format('shape-invalid departures=%s (must be empty)', v_badshape), 'DENY');

  -- (d) NO STALE WARNING MAY DISAPPEAR, and the stale warnings GAINED equal
  --     exactly the DEPARTED set.
  --
  --     CORRECTION 2: (d) is REDUNDANT and is kept for defence in depth and
  --     for a far clearer failure message than a bare set difference --
  --     it is NOT an independent guarantee. d1 is strictly implied by (a)
  --     under clause 1: a stale warning is an allowlist entry absent from
  --     the probe, so with the allowlist unmodified
  --     stale_before \ stale_after = allowlist INTERSECT arrived. d1
  --     therefore fires only on an ALLOWLISTED arrival, while (a) fires on
  --     ANY arrival -- (a) is strictly stronger in both directions. d2 is a
  --     tautology given (c), which already requires every departed
  --     signature to be allowlisted.
  --
  --     Implemented as the amendment PUBLISHES it -- gained stale compared
  --     against the ACTUAL departed set, not against the recorded R-2 set.
  --     Under the other reading d2 duplicates (b) and reds on A-SC-14's
  --     mutation; Amendment 3's harness took that reading and it is what
  --     produced a wrong table row. On A-SC-14's mutation the correct
  --     measured result is (a) green, (b) RED, (c) green, (d) green,
  --     (e) green -- only (b) fires.
  SELECT COALESCE(array_agg(sig ORDER BY sig), '{}') INTO v_stale_gone
  FROM (SELECT sig FROM i2117_asc9.stale_before
        EXCEPT
        SELECT a.sig FROM i2117_asc9.allowlist a
        WHERE a.sig NOT IN (SELECT sig FROM i2117_asc9.probe_now)) x;

  SELECT COALESCE(array_agg(sig ORDER BY sig), '{}') INTO v_stale_new
  FROM (SELECT a.sig FROM i2117_asc9.allowlist a
        WHERE a.sig NOT IN (SELECT sig FROM i2117_asc9.probe_now)
        EXCEPT
        SELECT sig FROM i2117_asc9.stale_before) x;

  PERFORM i2117t.assert('A-SC-9(d)','no stale warning vanished; gained stale equals the departed set',
    cardinality(v_stale_gone) = 0 AND v_stale_new = v_departed,
    format('vanished=%s gained=%s departed=%s', v_stale_gone, v_stale_new, v_departed), 'DENY');

  -- (e) THE SHIPPED FORWARD GATE STILL PASSES: zero anon-executable definer
  --     functions outside the allowlist. The workflow additionally runs the
  --     real shipped script, so this is asserted twice by two independent
  --     implementations. Revert mutation: grant EXECUTE on a gate form to
  --     the governed audience. MUST RED.
  SELECT COALESCE(array_agg(sig ORDER BY sig), '{}') INTO v_unallow
  FROM (SELECT sig FROM i2117_asc9.probe_now
        EXCEPT SELECT sig FROM i2117_asc9.allowlist) x;
  PERFORM i2117t.assert('A-SC-9(e)','forward gate: no unallowlisted anon-executable definer',
    cardinality(v_unallow) = 0,
    format('unallowlisted=%s (must be empty)', v_unallow), 'DENY');
END $asc9_set$;

-- ---------------------------------------------------------------------
-- The implementor's three interim properties, RETAINED VERBATIM as
-- additional required assertions (Amendment 3 §3, reaffirmed by
-- Amendment 4). They are green on the forgery above -- each is scoped to
-- objects already enumerated, and the departed-set clauses are what catch
-- movement on objects nobody enumerated -- so they are ADDITIONS, never a
-- replacement. They say something (a)-(e) do not: that the rung achieved
-- its PURPOSE rather than merely moving the right names.
-- Revert mutation: grant EXECUTE on either gate form, or on either
-- privileged sibling, to anon. MUST RED.
-- ---------------------------------------------------------------------
DO $asc9$
DECLARE v_violations int; v_new_in_probe int;
BEGIN
  -- the shipped gate's own probe expression, re-executed here
  SELECT count(*) INTO v_new_in_probe
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosecdef AND n.nspname='public'
    AND p.prorettype <> 'pg_catalog.trigger'::regtype
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
    AND p.proname IN ('pg_offering_visibility_gate','pg_offering_passes_visibility_gate',
                      'pg_privileged_event_tier_allin','pg_privileged_ticket_types_remaining');
  PERFORM i2117t.assert('A-SC-9','no object created by this migration is anon-executable',
    v_new_in_probe = 0,
    format('objects created here that are anon-EXECUTE-able: %s (must be 0)', v_new_in_probe), 'NA');

  -- the R-2 rung necessarily REMOVES objects from the probe; assert that
  -- the three narrowed objects are genuinely gone from the governed audience
  SELECT count(*) INTO v_violations
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('pg_recurrence_is_terminated','biz_trip_sold_count_by_tier','resolve_event_pricing_inputs')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  PERFORM i2117t.assert('A-SC-9','R-2 narrowed objects are unreachable by the governed audience',
    v_violations = 0,
    format('narrowed objects still reachable by anon/authenticated: %s (must be 0)', v_violations), 'DENY');

  -- ...and still reachable by service_role, or the R-2 rung broke its consumers
  SELECT count(*) INTO v_violations
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('pg_recurrence_is_terminated','biz_trip_sold_count_by_tier','resolve_event_pricing_inputs')
    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE');
  PERFORM i2117t.assert('A-SC-9','R-2 narrowed objects remain service_role-executable',
    v_violations = 0, format('narrowed objects lost service_role EXECUTE: %s (must be 0)', v_violations), 'ALLOW');
END $asc9$;

-- ---------------------------------------------------------------------
-- A-SC-11 -- CONSUMER-SET INVARIANCE. This is the criterion that closes
-- the blocker: for every object changed by this migration, every
-- enumerated consumer is exercised with a caller AUTHORISED on the
-- offering's brand, at EVERY visibility state, on the READ path AND the
-- WRITE path -- comparing the AFFECTED ROW COUNT, because the failure it
-- exists to catch is a SILENT ZERO-ROW WRITE, not a denial and not a
-- raise. No read-side assertion can see it.
--
-- The two identity resolvers are at rung R-4 (unchanged), so their
-- consumers -- five policies across four tables, three policies across two
-- tables, and a write-path trigger -- must be IDENTICAL to control.
-- Revert mutation: adopt the visibility gate on either identity resolver.
-- MUST RED: readable rows 2 -> 0, effective rank 60 -> 0, manager
-- predicate true -> false, and the organiser's own UPDATE 2 rows -> 0 rows
-- silently.
-- ---------------------------------------------------------------------
DO $asc11$
DECLARE r record; v_org uuid; ok boolean := true; d text := '';
        n int; rk int; mp boolean; u int;
BEGIN
  SELECT v INTO v_org FROM i2117t.ids WHERE k='organiser';
  FOR r IN SELECT * FROM i2117t.offering WHERE status='live' ORDER BY key LOOP
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_org::text, true);
    PERFORM set_config('request.jwt.claim.role','authenticated', true);
    -- READ path through the policies that consume the identity resolvers
    EXECUTE 'SELECT count(*)::int FROM public.tickets WHERE event_id=$1' INTO n USING r.event_id;
    EXECUTE 'SELECT public.biz_brand_effective_rank(public.biz_event_brand_id($1), $2)' INTO rk USING r.event_id, v_org;
    EXECUTE 'SELECT public.biz_is_event_manager_plus($1,$2)' INTO mp USING r.event_id, v_org;
    -- WRITE path: affected row count is the comparison that matters
    EXECUTE 'UPDATE public.tickets SET attendee_name=$2 WHERE event_id=$1' USING r.event_id, 'i2117t-probe';
    GET DIAGNOSTICS u = ROW_COUNT;
    RESET ROLE;
    IF n <> 2 OR rk <> 60 OR mp IS NOT TRUE OR u <> 2 THEN
      ok := false;
      d := d || format(' %s/%s read=%s rank=%s mgr=%s WRITE=%s (want 2/60/t/2);',
                       r.etype, r.visibility, n, rk, mp, u);
    END IF;
  END LOOP;
  PERFORM i2117t.assert('A-SC-11','consumer-set invariance, read AND write, every visibility state',
    ok, COALESCE(NULLIF(d,''),'all consumers of the R-4 objects identical at all five states, writes affect 2 rows'),
    'ALLOW');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM i2117t.assert('A-SC-11','consumer-set invariance, read AND write, every visibility state',
    false, 'RAISED: '||SQLERRM, 'NA');
END $asc11$;

-- ---------------------------------------------------------------------
-- A-SC-12 -- the EMPTY VALUE IS NEUTRAL, demonstrated per consumer. Each
-- adopted object's consumer must observe the ABSENCE of something, never a
-- CHANGED DECISION. A consumer that raises, skips work it previously did,
-- performs work it previously skipped, or emits a notification it
-- previously did not, FAILS.
--
-- The organiser's capacity guard is the decisive consumer: under the
-- visibility gate the count it reads collapses to zero and the guard is
-- DEFEATED at four of five states -- capacity could be set BELOW units
-- already sold. Under the authorisation arm it fires at all five.
-- Revert mutation: replace the authorisation arm with the visibility gate
-- on the sold-count object. MUST RED.
-- ---------------------------------------------------------------------
DO $asc12$
DECLARE r record; v_org uuid; ok boolean := true; d text := ''; res jsonb;
BEGIN
  SELECT v INTO v_org FROM i2117t.ids WHERE k='organiser';
  FOR r IN SELECT * FROM i2117t.offering WHERE etype='experience' AND status='live' ORDER BY visibility LOOP
    PERFORM set_config('request.jwt.claim.sub', v_org::text, true);
    BEGIN
      res := public.biz_update_live_experience(
        r.event_id,
        jsonb_build_object(
          'title','I2117T capacity probe',
          'description','A sufficiently long description for the capacity guard probe.',
          'capacity', 1,                     -- BELOW the 2 already sold
          'experience_intent','romantic',
          'stops', jsonb_build_array(
             jsonb_build_object('place_name','Stop One'),
             jsonb_build_object('place_name','Stop Two'))),
        'i2117t capacity guard probe reason');
    EXCEPTION WHEN OTHERS THEN
      res := jsonb_build_object('reason','RAISED: '||SQLERRM);
    END;
    IF COALESCE(res->>'reason','') <> 'capacity_below_sold' THEN
      ok := false;
      d := d || format(' capacity guard NOT fired at %s: %s;', r.visibility, COALESCE(res->>'reason','(none)'));
    END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM i2117t.assert('A-SC-12','organiser capacity guard fires at every visibility state',
    ok, COALESCE(NULLIF(d,''),'guard fires at all five states -- the empty value never changed a decision'),
    'ALLOW');
END $asc12$;

-- ---------------------------------------------------------------------
-- A-SC-13 -- recorded exceptions are TRUE, verified by a LIVE CATALOG
-- ACCESS-LIST PROBE in the same run, and the criterion reds in BOTH
-- directions: an E-4 record whose object IS reachable by the governed
-- audience reds, and so does an E-1/E-2/E-3 whose object is NOT.
-- ---------------------------------------------------------------------
DO $asc13$
DECLARE v_bad int;
BEGIN
  -- E-4 direction: the objects narrowed to service_role must NOT be
  -- reachable by the governed audience. (Measured access list, not an
  -- assertion in a comment.)
  SELECT count(*) INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('pg_offering_visibility_gate','pg_offering_passes_visibility_gate',
                      'pg_privileged_event_tier_allin','pg_privileged_ticket_types_remaining',
                      'pg_recurrence_is_terminated','biz_trip_sold_count_by_tier',
                      'resolve_event_pricing_inputs')
    AND (has_function_privilege('anon', p.oid,'EXECUTE')
      OR has_function_privilege('authenticated', p.oid,'EXECUTE'));
  PERFORM i2117t.assert('A-SC-13','E-4 records true: narrowed/new objects unreachable by governed audience',
    v_bad = 0, format('reachable-but-recorded-closed: %s (must be 0)', v_bad), 'DENY');

  -- reverse direction: objects that MUST remain caller-executable (they
  -- carry a real client call site and took the authorisation arm) must
  -- still be reachable, or the arm silently became a narrowing.
  SELECT count(*) INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('biz_experience_sold_count','biz_trip_tickets_sold_by_tier',
                      'biz_trip_has_web_purchases','pg_public_event_tier_allin',
                      'pg_public_ticket_types_remaining','pg_public_trip_by_slug',
                      'pg_public_experience_by_slug')
    AND NOT has_function_privilege('authenticated', p.oid,'EXECUTE');
  PERFORM i2117t.assert('A-SC-13','objects with real client calls remain caller-executable',
    v_bad = 0, format('unexpectedly narrowed: %s (must be 0)', v_bad), 'ALLOW');
END $asc13$;

-- ---------------------------------------------------------------------
-- A-SC-14 -- NO SILENT RESIDUAL. For every object in the change set,
-- executed as an unauthenticated caller AND as a signed-in stranger, at
-- every visibility state the object's audience or authorisation excludes,
-- each object satisfies EXACTLY ONE of:
--   (1) it returns its documented empty value, or is not executable by the
--       governed audience at all; or
--   (2) it is recorded under R-4 with a MEASURED residual exposure and a
--       linked follow-up issue.
-- An object that is neither remedied nor recorded REDS. So does an R-4
-- record whose stated residual does not match what the probe returns, IN
-- EITHER DIRECTION -- so the record cannot be written from belief.
--
-- Per the approving reviewer's note 3, the state enumeration reads as
-- empty for an R-4 object on a literal reading; the object-level
-- obligation carries regardless and is treated as binding, so all five
-- states are enumerated explicitly below.
-- ---------------------------------------------------------------------
DO $asc14$
DECLARE r record; role_name text; ok boolean := true; d text := '';
        n int; b jsonb; c boolean; a int; refused boolean;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOR r IN SELECT * FROM i2117t.offering WHERE status='live' ORDER BY key LOOP
      EXECUTE format('SET LOCAL ROLE %I', role_name);
      PERFORM set_config('request.jwt.claim.role', role_name, true);
      PERFORM set_config('request.jwt.claim.sub', '', true);

      -- clause (1): authorisation-arm objects return the documented empty value
      EXECUTE 'SELECT public.biz_experience_sold_count($1)' INTO a USING r.event_id;
      IF a <> 0 THEN ok := false; d := d||format(' exp_sold leaked %s at %s/%s/%s;', a, role_name, r.etype, r.visibility); END IF;
      EXECUTE 'SELECT public.biz_trip_tickets_sold_by_tier($1)' INTO b USING r.event_id;
      IF b <> '{}'::jsonb THEN ok := false; d := d||format(' tickets_by_tier leaked at %s/%s/%s;', role_name, r.etype, r.visibility); END IF;
      EXECUTE 'SELECT public.biz_trip_has_web_purchases($1)' INTO c USING r.event_id;
      IF c <> false THEN ok := false; d := d||format(' has_web_purch leaked at %s/%s/%s;', role_name, r.etype, r.visibility); END IF;

      -- clause (1): R-2 objects are not executable by the governed audience at all
      refused := false;
      BEGIN EXECUTE 'SELECT public.biz_trip_sold_count_by_tier($1)' INTO b USING r.event_id;
      EXCEPTION WHEN insufficient_privilege THEN refused := true; END;
      IF NOT refused THEN ok := false; d := d||format(' R-2 sold_count_by_tier STILL REACHABLE at %s;', role_name); END IF;

      refused := false;
      BEGIN EXECUTE 'SELECT count(*)::int FROM public.resolve_event_pricing_inputs($1)' INTO n USING r.event_id;
      EXCEPTION WHEN insufficient_privilege THEN refused := true; END;
      IF NOT refused THEN ok := false; d := d||format(' R-2 pricing_inputs STILL REACHABLE at %s;', role_name); END IF;

      refused := false;
      BEGIN EXECUTE 'SELECT public.pg_recurrence_is_terminated($1,$2)' INTO c
        USING '{"termination":{"kind":"count","count":1}}'::jsonb, r.event_id;
      EXCEPTION WHEN insufficient_privilege THEN refused := true; END;
      IF NOT refused THEN ok := false; d := d||format(' R-2 recurrence oracle STILL REACHABLE at %s;', role_name); END IF;

      RESET ROLE;
    END LOOP;
  END LOOP;
  PERFORM i2117t.assert('A-SC-14','no silent residual: every change-set object remedied or recorded',
    ok, COALESCE(NULLIF(d,''),'every object returns its empty value or refuses, to both unauthorised callers, at every state'),
    'DENY');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM i2117t.assert('A-SC-14','no silent residual', false, 'RAISED: '||SQLERRM, 'NA');
END $asc14$;

-- A-SC-14 clause (2): the R-4 residual is asserted to be EXACTLY what was
-- recorded on the issue and in the migration -- an unauthorised caller
-- still obtains the opaque identifier, at every visibility state, and
-- nothing more. This reds in BOTH directions: if the residual disappears
-- (someone quietly remedied the object without updating the record) OR if
-- it grows (offering content becomes reachable).
DO $asc14b$
DECLARE r record; role_name text; ok boolean := true; d text := '';
        v_id uuid; v_got int := 0;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOR r IN SELECT * FROM i2117t.offering WHERE status='live' ORDER BY key LOOP
      EXECUTE format('SET LOCAL ROLE %I', role_name);
      PERFORM set_config('request.jwt.claim.role', role_name, true);
      -- recorded residual: the identity resolvers still answer. If they
      -- stopped answering, the record on #2117 and #2126 is now false and
      -- must be updated -- so this reds.
      EXECUTE 'SELECT public.biz_event_brand_id($1)' INTO v_id USING r.event_id;
      IF v_id IS NULL THEN
        ok := false; d := d||format(' recorded R-4 residual ABSENT (event resolver) at %s/%s;', role_name, r.visibility);
      ELSE v_got := v_got + 1; END IF;
      EXECUTE 'SELECT public.biz_order_brand_id($1)' INTO v_id USING r.order_id;
      IF v_id IS NULL THEN
        ok := false; d := d||format(' recorded R-4 residual ABSENT (order resolver) at %s/%s;', role_name, r.visibility);
      ELSE v_got := v_got + 1; END IF;
      RESET ROLE;
    END LOOP;
  END LOOP;
  PERFORM i2117t.assert('A-SC-14','R-4 residual matches the record on #2117 / #2126 exactly',
    ok AND v_got > 0,
    COALESCE(NULLIF(d,''), format('residual reproduced %s times, exactly as recorded (opaque identifier only)', v_got)),
    'ALLOW');
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  PERFORM i2117t.assert('A-SC-14','R-4 residual matches the record', false, 'RAISED: '||SQLERRM, 'NA');
END $asc14b$;

-- ---------------------------------------------------------------------
-- A-SC-10 -- NON-VACUITY. The suite FAILS, with a DISTINCT and EXPLICIT
-- message, if:
--   1. the fixture set is empty, or lacks an offering at EACH of the five
--      visibility states, or lacks one of EACH offering type served;
--   2. any reader under test produced NO ALLOW outcome across the run;
--   3. any reader under test produced NO DENY outcome across the run;
--   4. any assertion was skipped, or any object in the change set has no
--      assertion.
--   5. (A-SC-10.5) the fixture set lacks an offering at EACH status value
--      in the union of the change set's declared status sets.
--
-- A suite in which every case denies is a FAILING suite. A suite in which
-- every case allows is a FAILING suite. This clause is itself covered:
-- deleting all fixtures must produce a RED run, not a green one.
-- ---------------------------------------------------------------------
DO $asc10$
DECLARE v_vis int; v_types int; v_status int; v_allow int; v_deny int; v_asserts int;
BEGIN
  SELECT count(DISTINCT visibility) INTO v_vis    FROM i2117t.offering;
  SELECT count(DISTINCT etype)      INTO v_types  FROM i2117t.offering;
  SELECT count(DISTINCT status)     INTO v_status FROM i2117t.offering;
  SELECT count(*) INTO v_asserts FROM i2117t.result;
  SELECT count(*) INTO v_allow FROM i2117t.result WHERE verdict='ALLOW' AND outcome='PASS';
  SELECT count(*) INTO v_deny  FROM i2117t.result WHERE verdict='DENY'  AND outcome='PASS';

  IF v_vis < 5 THEN
    RAISE EXCEPTION 'A-SC-10 NON-VACUITY FAILURE (clause 1): fixture set covers only % of 5 visibility states', v_vis;
  END IF;
  IF v_types < 3 THEN
    RAISE EXCEPTION 'A-SC-10 NON-VACUITY FAILURE (clause 1): fixture set covers only % offering types', v_types;
  END IF;
  IF v_status < 4 THEN
    RAISE EXCEPTION 'A-SC-10 NON-VACUITY FAILURE (clause 5): fixture set covers only % status values; the union of the change set''s declared status sets requires scheduled, live, ended and cancelled', v_status;
  END IF;
  -- 18 criterion assertions + A-SC-9's five set clauses (a)-(e).
  IF v_asserts < 23 THEN
    RAISE EXCEPTION 'A-SC-10 NON-VACUITY FAILURE (clause 4): only % assertions ran; every criterion must assert, including A-SC-9 clauses (a)-(e)', v_asserts;
  END IF;
  IF v_allow = 0 THEN
    RAISE EXCEPTION 'A-SC-10 NON-VACUITY FAILURE (clause 2): NO ALLOW outcome anywhere in the run -- a suite in which every case denies is a failing suite';
  END IF;
  IF v_deny = 0 THEN
    RAISE EXCEPTION 'A-SC-10 NON-VACUITY FAILURE (clause 3): NO DENY outcome anywhere in the run -- a suite in which every case allows is a failing suite';
  END IF;

  RAISE NOTICE 'A-SC-10 non-vacuity: % visibility states, % offering types, % status values, % assertions, % allow, % deny',
    v_vis, v_types, v_status, v_asserts, v_allow, v_deny;
END $asc10$;

-- ---------------------------------------------------------------------
-- Verdict.
-- ---------------------------------------------------------------------
\echo ''
\echo '================ issue #2117 -- results ================'
SELECT criterion, name, outcome, detail FROM i2117t.result ORDER BY id;

DO $verdict$
DECLARE v_fail int; v_pass int; v_detail text;
BEGIN
  SELECT count(*) FILTER (WHERE outcome='FAIL'), count(*) FILTER (WHERE outcome='PASS')
    INTO v_fail, v_pass FROM i2117t.result;
  IF v_fail > 0 THEN
    SELECT string_agg(format('%s: %s -- %s', criterion, name, detail), E'\n  ')
      INTO v_detail FROM i2117t.result WHERE outcome='FAIL';
    RAISE EXCEPTION E'issue #2117 SUITE FAILED -- % failing assertion(s):\n  %', v_fail, v_detail;
  END IF;
  RAISE NOTICE 'issue #2117 SUITE PASSED -- % assertions, 0 failures', v_pass;
END $verdict$;

-- teardown (leave the cluster clean for any subsequent suite)
-- children first: cascading a brand delete fires sale-revocation triggers.
CREATE TEMP TABLE i2117t_ev AS
  SELECT id FROM public.events WHERE brand_id = '00000000-2117-4000-8000-0000000000bb';
DELETE FROM public.tickets          WHERE event_id IN (SELECT id FROM i2117t_ev);
DELETE FROM public.order_line_items WHERE order_id IN
  (SELECT id FROM public.orders WHERE event_id IN (SELECT id FROM i2117t_ev));
DELETE FROM public.orders           WHERE event_id IN (SELECT id FROM i2117t_ev);
DELETE FROM public.ticket_types     WHERE event_id IN (SELECT id FROM i2117t_ev);
DELETE FROM public.event_dates      WHERE event_id IN (SELECT id FROM i2117t_ev);
DELETE FROM public.events           WHERE id       IN (SELECT id FROM i2117t_ev);
DROP TABLE i2117t_ev;
DROP SCHEMA i2117t CASCADE;
DELETE FROM public.brands WHERE slug = 'i2117t-brand';
DELETE FROM public.creator_accounts
  WHERE id IN ('00000000-2117-4000-8000-0000000000a1','00000000-2117-4000-8000-0000000000a2');
DELETE FROM auth.users
  WHERE id IN ('00000000-2117-4000-8000-0000000000a1','00000000-2117-4000-8000-0000000000a2');
REVOKE ALL ON SCHEMA public FROM i2117t_zero;
REVOKE ALL ON FUNCTION public.pg_offering_visibility_gate(text,timestamptz,text) FROM i2117t_zero;
REVOKE ALL ON FUNCTION public.pg_offering_passes_visibility_gate(uuid,text) FROM i2117t_zero;
DROP ROLE IF EXISTS i2117t_zero;
