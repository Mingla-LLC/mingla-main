\set ON_ERROR_STOP on
-- MINGLA-INVARIANT: I-4548-GUEST-PACK-APP-ONLY | issue #4548 | public.event_guest_packs has no anon or authenticated privilege; only pg_my_event_guest_pack, biz_get_event_guest_pack, biz_set_event_guest_pack and event_guest_pack_exists reference it; no view reads it; no anon- or authenticated-reachable function, view or table returns its content to a non-holder; no edge function names it (second enforcer: supabase/functions/_shared/__tests__/issue_4548_guest_pack_email_pointer.implementor.test.ts).
-- #4548 Guest pack: adversarial proof after the full migration replay (a distinct angle from the
-- happy path: it never trusts the four functions, it sweeps everything else).
--
-- A-GRANT    the table has no client privilege; the internal helpers and the email check are
--            not client executable; the guest and team functions are not anon executable.
-- A-CATALOG  exactly the four allowlisted functions reference the table; no view does.
-- A-SWEEP    with a marker in the note and in one link: every non-volatile public function an
--            anon or authenticated caller can execute whose arguments are all uuid/text (fed the
--            pack's event id and slug), every listed public reader, and every public table and
--            view they can select, run as anon and as a signed-in non-holder and as another
--            brand's owner, never return the marker.
--
-- FAILS-ON-REVERT: granting SELECT on the table to authenticated, adding a view or reader that
-- projects the pack, or returning the pack from pg_my_event_guest_pack without the holder check
-- fails A-GRANT, A-CATALOG or A-SWEEP.

CREATE OR REPLACE FUNCTION pg_temp.ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4548 guest pack adversarial FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END;
$fn$;

BEGIN;

CREATE TEMP TABLE i4548a (k text PRIMARY KEY, id uuid);
GRANT ALL ON i4548a TO anon, authenticated;

DO $fixture$
DECLARE
  v_host uuid := '45480000-0000-4000-8000-0000000000a1';
  v_brand uuid := '45480000-0000-4000-8000-0000000000a2';
  v_event uuid := '45480000-0000-4000-8000-0000000000a3';
  v_stranger uuid := '45480000-0000-4000-8000-0000000000a4';
  v_other_owner uuid := '45480000-0000-4000-8000-0000000000a5';
  v_other_brand uuid := '45480000-0000-4000-8000-0000000000a6';
  v_tt uuid := '45480000-0000-4000-8000-0000000000a7';
  v_pending uuid := '45480000-0000-4000-8000-0000000000a8';
  v_refunded uuid := '45480000-0000-4000-8000-0000000000a9';
  v_unclaimed_web uuid := '45480000-0000-4000-8000-0000000000aa';
  v_rsvp_event uuid := '45480000-0000-4000-8000-0000000000ab';
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_host, 'i4548a-host@example.test'), (v_stranger, 'i4548a-stranger@example.test'),
    (v_other_owner, 'i4548a-other@example.test'), (v_pending, 'i4548a-pending@example.test'),
    (v_refunded, 'i4548a-refunded@example.test'), (v_unclaimed_web, 'i4548a-web@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES
    (v_host, 'i4548a-host@example.test'), (v_other_owner, 'i4548a-other@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, contact_email)
  VALUES
    (v_brand, v_host, 'Issue 4548A Brand', 'issue-4548a-brand', 'stripe', 'US', 'USD', 'USD',
     'i4548a-host@example.test'),
    (v_other_brand, v_other_owner, 'Issue 4548A Other', 'issue-4548a-other', 'stripe', 'US',
     'USD', 'USD', 'i4548a-other@example.test');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, published_at)
  VALUES (v_event, v_brand, v_host, 'Issue 4548A Night', 'issue-4548a-night', 'event',
    'scheduled', 'public', 'UTC', 'USD', now());
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, rsvp_capacity, rsvp_waitlist_enabled, rsvp_approval_mode,
    rsvp_allow_plus_ones, rsvp_plus_ones_max, rsvp_guests_can_bring, published_at)
  VALUES (v_rsvp_event, v_brand, v_host, 'Issue 4548A RSVP', 'issue-4548a-rsvp', 'rsvp',
    'scheduled', 'public', 'UTC', 'USD', NULL, false, 'manual', false, 0, false, now());
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
    (v_event, now() + interval '5 days', now() + interval '5 days 4 hours', 'UTC', true),
    (v_rsvp_event, now() + interval '5 days', now() + interval '5 days 4 hours', 'UTC', true);
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency)
  VALUES (v_tt, v_event, 'General', 50, 'USD');
  INSERT INTO public.account_claim_contacts(user_id, channel, value, verified_via) VALUES
    (v_refunded, 'email', 'i4548a-refunded@example.test', 'email_code'),
    (v_unclaimed_web, 'email', 'i4548a-web-buyer@example.test', 'email_code');
  -- A refunded buyer, and a web order whose buyer's account exists but the
  -- sweep has not run.
  INSERT INTO public.orders(event_id, buyer_user_id, buyer_email, buyer_phone_e164, total_cents,
    currency, payment_method, payment_status, source)
  VALUES
    (v_event, v_refunded, 'i4548a-refunded@example.test', '+12025554811', 50, 'USD',
     'online_card', 'refunded', 'online_checkout'),
    (v_event, NULL, 'i4548a-web-buyer@example.test', '+12025554812', 50, 'USD',
     'online_card', 'paid', 'online_checkout');
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status)
  VALUES (v_rsvp_event, v_pending, 'Pending Guest', 'going', 'pending');

  -- The marker sits in the note and in one link of both packs.
  INSERT INTO public.event_guest_packs(event_id, note, items, updated_by) VALUES
    (v_event, 'Door code QX4548MARKER',
     '[{"label":"Access QX4548MARKER","url":"https://example.test/QX4548MARKER.pdf"}]', v_host),
    (v_rsvp_event, 'Door code QX4548MARKER',
     '[{"label":"Access QX4548MARKER","url":"https://example.test/QX4548MARKER.pdf"}]', v_host);

  INSERT INTO i4548a VALUES
    ('host', v_host), ('event', v_event), ('rsvp_event', v_rsvp_event), ('stranger', v_stranger),
    ('other_owner', v_other_owner), ('pending', v_pending), ('refunded', v_refunded),
    ('unclaimed_web', v_unclaimed_web);
END;
$fixture$;

-- A-GRANT ----------------------------------------------------------------------
DO $test$
DECLARE
  v_role text;
  v_priv text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'public'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      PERFORM pg_temp.ok(NOT has_table_privilege(v_role, 'public.event_guest_packs', v_priv),
        format('A-GRANT %s has no %s on event_guest_packs', v_role, v_priv));
    END LOOP;
    PERFORM pg_temp.ok(NOT has_any_column_privilege(v_role, 'public.event_guest_packs', 'SELECT'),
      format('A-GRANT %s has no column SELECT on event_guest_packs', v_role));
  END LOOP;
  PERFORM pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.event_guest_packs'::regclass),
    'A-GRANT RLS is enabled on event_guest_packs');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'event_guest_packs'),
    'A-GRANT event_guest_packs has no RLS policy');
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    PERFORM pg_temp.ok(NOT has_function_privilege(v_role, 'public.event_guest_pack_exists(uuid)', 'EXECUTE')
      AND NOT has_function_privilege(v_role, 'public.issue_4548_caller_holds_event(uuid)', 'EXECUTE')
      AND NOT has_function_privilege(v_role, 'public.event_guest_pack_items_valid(jsonb)', 'EXECUTE'),
      'A-GRANT ' || v_role || ' cannot execute the email check or the internal helpers');
  END LOOP;
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'public.pg_my_event_guest_pack(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.biz_get_event_guest_pack(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.biz_set_event_guest_pack(uuid,text,jsonb)', 'EXECUTE'),
    'A-GRANT anon cannot execute the guest or team functions');
  PERFORM pg_temp.ok(has_function_privilege('service_role', 'public.event_guest_pack_exists(uuid)', 'EXECUTE'),
    'A-GRANT service_role executes the email check');
  PERFORM pg_temp.ok(NOT EXISTS (
      SELECT 1 FROM pg_proc p
       WHERE p.oid IN ('public.pg_my_event_guest_pack(uuid)'::regprocedure,
                       'public.biz_get_event_guest_pack(uuid)'::regprocedure,
                       'public.biz_set_event_guest_pack(uuid,text,jsonb)'::regprocedure,
                       'public.event_guest_pack_exists(uuid)'::regprocedure,
                       'public.issue_4548_caller_holds_event(uuid)'::regprocedure)
         AND (NOT p.prosecdef OR p.proconfig IS NULL OR NOT ('search_path=""' = ANY (p.proconfig)))),
    'A-GRANT every definer function pins an empty search_path');
END;
$test$;

-- A-CATALOG ------------------------------------------------------------------
DO $test$
DECLARE
  v_refs text[];
BEGIN
  SELECT array_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text) INTO v_refs
    FROM pg_proc p
   WHERE p.prosrc ILIKE '%event_guest_packs%';
  PERFORM pg_temp.ok(v_refs = ARRAY[
      'biz_get_event_guest_pack(uuid)',
      'biz_set_event_guest_pack(uuid,text,jsonb)',
      'event_guest_pack_exists(uuid)',
      'pg_my_event_guest_pack(uuid)'],
    'A-CATALOG only the four allowlisted functions reference the table: ' || COALESCE(v_refs::text, 'none'));
  PERFORM pg_temp.ok(NOT EXISTS (
      SELECT 1 FROM pg_views WHERE definition ILIKE '%event_guest_packs%'
      UNION ALL
      SELECT 1 FROM pg_matviews WHERE definition ILIKE '%event_guest_packs%'),
    'A-CATALOG no view or materialized view reads the table');
  PERFORM pg_temp.ok(NOT EXISTS (
      SELECT 1 FROM pg_depend d
        JOIN pg_rewrite rw ON rw.oid = d.objid
       WHERE d.classid = 'pg_rewrite'::regclass
         AND d.refobjid = 'public.event_guest_packs'::regclass
         AND rw.ev_class <> 'public.event_guest_packs'::regclass),
    'A-CATALOG no rewrite rule depends on the table');
END;
$test$;

-- A-SWEEP ----------------------------------------------------------------------
-- Callables: public, non-volatile, not aggregates/windows, executable by anon
-- or authenticated, every argument uuid or text (or none), and not returning
-- trigger / void / internal types.
CREATE TEMP TABLE i4548a_callables AS
SELECT p.oid::regprocedure::text AS sig,
       p.proname,
       p.proargtypes::oid[] AS argtypes,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_ok,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.prokind = 'f'
   AND p.provolatile IN ('s', 'i')
   AND p.prorettype NOT IN ('trigger'::regtype, 'void'::regtype, 'internal'::regtype,
                            'event_trigger'::regtype, 'language_handler'::regtype)
   AND NOT EXISTS (SELECT 1 FROM unnest(p.proargtypes::oid[]) t(oid)
                    WHERE t.oid NOT IN ('uuid'::regtype, 'text'::regtype))
   AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
GRANT SELECT ON i4548a_callables TO anon, authenticated;

CREATE TEMP TABLE i4548a_relations AS
SELECT format('%I.%I', n.nspname, c.relname) AS rel,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_ok,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_ok
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relkind IN ('r', 'p', 'v', 'm')
   AND (has_table_privilege('anon', c.oid, 'SELECT')
        OR has_table_privilege('authenticated', c.oid, 'SELECT'));
GRANT SELECT ON i4548a_relations TO anon, authenticated;

CREATE TEMP TABLE i4548a_hits (who text, what text, detail text);
CREATE TEMP TABLE i4548a_counts (who text PRIMARY KEY, functions int, function_errors int, relations int, relation_errors int);
GRANT ALL ON i4548a_hits, i4548a_counts TO anon, authenticated;

-- The sweep body, run once per caller below. Each call sits in its own
-- subtransaction so an erroring function cannot abort the sweep.
CREATE OR REPLACE FUNCTION pg_temp.sweep(p_who text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  r record;
  v_event uuid := (SELECT id FROM i4548a WHERE k = 'event');
  v_rsvp_event uuid := (SELECT id FROM i4548a WHERE k = 'rsvp_event');
  v_args text;
  v_out text;
  v_fn int := 0; v_fn_err int := 0; v_rel int := 0; v_rel_err int := 0;
  v_ev uuid;
BEGIN
  FOR r IN
    SELECT * FROM i4548a_callables
     WHERE (p_who = 'anon' AND anon_ok) OR (p_who <> 'anon' AND auth_ok)
     ORDER BY sig
  LOOP
    FOREACH v_ev IN ARRAY ARRAY[v_event, v_rsvp_event] LOOP
      SELECT string_agg(CASE WHEN t.oid = 'uuid'::regtype THEN quote_literal(v_ev) || '::uuid'
                             ELSE quote_literal(CASE WHEN v_ev = v_event THEN 'issue-4548a-night'
                                                     ELSE 'issue-4548a-rsvp' END) || '::text' END,
                        ', ' ORDER BY t.ord)
        INTO v_args
        FROM unnest(r.argtypes) WITH ORDINALITY t(oid, ord);
      BEGIN
        EXECUTE format('SELECT string_agg(x::text, %L) FROM public.%I(%s) AS x', '|', r.proname, COALESCE(v_args, ''))
          INTO v_out;
        v_fn := v_fn + 1;
        IF v_out ILIKE '%QX4548MARKER%' THEN
          INSERT INTO i4548a_hits VALUES (p_who, r.sig, left(v_out, 200));
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_fn_err := v_fn_err + 1;
      END;
    END LOOP;
  END LOOP;

  FOR r IN
    SELECT * FROM i4548a_relations
     WHERE (p_who = 'anon' AND anon_ok) OR (p_who <> 'anon' AND auth_ok)
     ORDER BY rel
  LOOP
    BEGIN
      EXECUTE format('SELECT count(*)::text FROM %s AS x WHERE x::text ILIKE %L', r.rel, '%QX4548MARKER%')
        INTO v_out;
      v_rel := v_rel + 1;
      IF v_out <> '0' THEN
        INSERT INTO i4548a_hits VALUES (p_who, r.rel, v_out || ' row(s)');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_rel_err := v_rel_err + 1;
    END;
  END LOOP;
  INSERT INTO i4548a_counts VALUES (p_who, v_fn, v_fn_err, v_rel, v_rel_err);
END;
$fn$;

-- As anon.
SELECT set_config('request.jwt.claim.sub', '', true),
       set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT pg_temp.sweep('anon');
RESET ROLE;

-- As a signed-in account that holds nothing.
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM i4548a WHERE k = 'stranger'), true),
       set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM i4548a WHERE k = 'stranger'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.sweep('non_holder');
RESET ROLE;

-- As another brand's owner.
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM i4548a WHERE k = 'other_owner'), true),
       set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM i4548a WHERE k = 'other_owner'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.sweep('other_brand');
RESET ROLE;

-- As a pending RSVP, a refunded buyer and an unclaimed web buyer's account.
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM i4548a WHERE k = 'pending'), true),
       set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM i4548a WHERE k = 'pending'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.sweep('pending_rsvp');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM i4548a WHERE k = 'refunded'), true),
       set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM i4548a WHERE k = 'refunded'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.sweep('refunded_buyer');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM i4548a WHERE k = 'unclaimed_web'), true),
       set_config('request.jwt.claims', json_build_object('sub', (SELECT id FROM i4548a WHERE k = 'unclaimed_web'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.sweep('unclaimed_web_buyer');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);

DO $test$
DECLARE
  r record;
  v_hits text;
BEGIN
  FOR r IN SELECT * FROM i4548a_counts ORDER BY who LOOP
    RAISE NOTICE 'sweep % : % function calls (% raised), % relations (% raised)',
      r.who, r.functions, r.function_errors, r.relations, r.relation_errors;
  END LOOP;
  PERFORM pg_temp.ok((SELECT count(*) FROM i4548a_counts) = 6, 'A-SWEEP ran for six callers');
  -- The sweep must actually exercise the surface, not error its way through.
  PERFORM pg_temp.ok((SELECT bool_and(functions >= 50 AND relations >= 20) FROM i4548a_counts),
    'A-SWEEP each caller completed at least 50 function calls and 20 relation reads');
  -- The known public readers are in the swept set.
  PERFORM pg_temp.ok((SELECT count(*) FROM i4548a_callables
                       WHERE proname IN ('pg_my_event_guest_pack', 'pg_public_event_by_slug',
                                         'pg_public_rsvp_by_slug')) >= 3,
    'A-SWEEP the guest read and the public slug readers were swept');
  SELECT string_agg(who || ' -> ' || what || ' : ' || detail, E'\n') INTO v_hits FROM i4548a_hits;
  PERFORM pg_temp.ok(v_hits IS NULL, 'A-SWEEP the marker never reached a non-holder' || COALESCE(E'\n' || v_hits, ''));
END;
$test$;

ROLLBACK;
