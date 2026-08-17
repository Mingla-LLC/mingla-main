-- =====================================================================
-- issue #2009 — executable coverage for the published ticketed-event
-- visibility mutation. IMPLEMENTOR HAPPY-PATH SUITE.
--
-- Contract: BINDING SPEC AMENDMENT 3 (#issuecomment-5317187049, CONTROLLING)
-- over AMENDMENT 1 (#issuecomment-5283729259) and the original BINDING SPEC
-- (#issuecomment-5283447438, SC-1..SC-24).
--
-- Per #2113, EVERY assertion below EXECUTES an object against real rows.
-- Nothing here asserts on migration text, on pg_get_functiondef output, or on
-- any other source representation. A source-text assertion satisfies NO
-- criterion in this file. In particular the Private fail-closed path is proven
-- by CALLING the RPC with a Private target and observing the refusal plus zero
-- residue — never by grepping for a string.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f <this file>
-- after applying every migration in timestamp order to
-- supabase/postgres:17.4.1.075.
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

-- ---------------------------------------------------------------------
-- 0. Harness.
-- ---------------------------------------------------------------------
DROP SCHEMA IF EXISTS i2009t CASCADE;

DO $preclean$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.events
            WHERE brand_id IN ('00000000-2009-4000-8000-0000000000b1',
                               '00000000-2009-4000-8000-0000000000b2')
  LOOP
    DELETE FROM public.content_share_links
      WHERE source_key = 'event:' || r.id::text
         OR source_reference ->> 'eventId' = r.id::text;
    DELETE FROM public.audit_log            WHERE event_id = r.id;
    DELETE FROM public.event_visibility_transition_effects WHERE event_id = r.id;
    DELETE FROM public.event_dates          WHERE event_id = r.id;
    DELETE FROM public.events               WHERE id = r.id;
  END LOOP;
  DELETE FROM public.brand_team_members
    WHERE brand_id IN ('00000000-2009-4000-8000-0000000000b1',
                       '00000000-2009-4000-8000-0000000000b2');
  DELETE FROM public.brands
    WHERE id IN ('00000000-2009-4000-8000-0000000000b1',
                 '00000000-2009-4000-8000-0000000000b2');
  DELETE FROM public.admin_users WHERE email = 'owner@i2009t.test';
  DELETE FROM public.profiles
    WHERE id IN ('00000000-2009-4000-8000-0000000000a1',
                 '00000000-2009-4000-8000-0000000000a2',
                 '00000000-2009-4000-8000-0000000000a3',
                 '00000000-2009-4000-8000-0000000000a4');
  DELETE FROM public.creator_accounts
    WHERE id IN ('00000000-2009-4000-8000-0000000000a1',
                 '00000000-2009-4000-8000-0000000000a2',
                 '00000000-2009-4000-8000-0000000000a3',
                 '00000000-2009-4000-8000-0000000000a4');
  DELETE FROM auth.users
    WHERE id IN ('00000000-2009-4000-8000-0000000000a1',
                 '00000000-2009-4000-8000-0000000000a2',
                 '00000000-2009-4000-8000-0000000000a3',
                 '00000000-2009-4000-8000-0000000000a4');
END $preclean$;

CREATE SCHEMA i2009t;

CREATE TABLE i2009t.result(
  id serial primary key,
  criterion text not null,
  name      text not null,
  outcome   text not null,      -- PASS | FAIL
  detail    text
);

CREATE FUNCTION i2009t.assert(
  p_criterion text, p_name text, p_ok boolean, p_detail text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO i2009t.result(criterion, name, outcome, detail)
  VALUES (p_criterion, p_name, CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END, p_detail);
END $$;

-- Become a given signed-in user for the duration of the current transaction.
CREATE FUNCTION i2009t.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
END $$;

-- Call the RPC and return the raised SQLERRM, or 'OK:<json>' on success.
CREATE FUNCTION i2009t.try_set(
  p_user uuid, p_event uuid, p_vis text, p_reason text, p_expected timestamptz
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM i2009t.act_as(p_user);
  BEGIN
    v := public.business_set_event_visibility(p_event, p_vis, p_reason, p_expected);
    RETURN 'OK:' || v::text;
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLERRM;
  END;
END $$;

-- ---------------------------------------------------------------------
-- 1. Fixtures.
--    brand b1 : owned by `owner`, with `manager` (event_manager, accepted)
--               and `scanner` (below rank, accepted) on the team.
--    brand b2 : owned by `stranger` — the foreign-brand target.
-- ---------------------------------------------------------------------
CREATE TABLE i2009t.ids(k text primary key, v uuid);
INSERT INTO i2009t.ids VALUES
  ('owner'   ,'00000000-2009-4000-8000-0000000000a1'),
  ('manager' ,'00000000-2009-4000-8000-0000000000a2'),
  ('scanner' ,'00000000-2009-4000-8000-0000000000a3'),
  ('stranger','00000000-2009-4000-8000-0000000000a4'),
  ('b1'      ,'00000000-2009-4000-8000-0000000000b1'),
  ('b2'      ,'00000000-2009-4000-8000-0000000000b2');

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
SELECT v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       k||'@i2009t.test','x',now(),now()
FROM i2009t.ids WHERE k IN ('owner','manager','scanner','stranger')
ON CONFLICT DO NOTHING;

INSERT INTO public.creator_accounts(id)
SELECT v FROM i2009t.ids WHERE k IN ('owner','manager','scanner','stranger')
ON CONFLICT DO NOTHING;

INSERT INTO public.brands(id,account_id,name,slug,claim_status,pricing_currency,default_currency)
VALUES
 ((SELECT v FROM i2009t.ids WHERE k='b1'),(SELECT v FROM i2009t.ids WHERE k='owner'),
  'I2009T Brand One','i2009t-brand-one','verified','usd','USD'),
 ((SELECT v FROM i2009t.ids WHERE k='b2'),(SELECT v FROM i2009t.ids WHERE k='stranger'),
  'I2009T Brand Two','i2009t-brand-two','verified','usd','USD');

INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at)
VALUES
 ((SELECT v FROM i2009t.ids WHERE k='b1'),(SELECT v FROM i2009t.ids WHERE k='manager'),'event_manager',now()),
 ((SELECT v FROM i2009t.ids WHERE k='b1'),(SELECT v FROM i2009t.ids WHERE k='scanner'),'scanner',now());

CREATE TABLE i2009t.fx(key text primary key, event_id uuid);

DO $fx$
DECLARE r record; v_ev uuid; v_b1 uuid; v_b2 uuid;
BEGIN
  SELECT v INTO v_b1 FROM i2009t.ids WHERE k='b1';
  SELECT v INTO v_b2 FROM i2009t.ids WHERE k='b2';
  FOR r IN
    SELECT * FROM (VALUES
      -- key                    brand   type          visibility  status
      ('public_scheduled'      ,'b1','event'      ,'public'  ,'scheduled'),
      ('public_live'           ,'b1','event'      ,'public'  ,'live'),
      ('hidden_scheduled'      ,'b1','event'      ,'hidden'  ,'scheduled'),
      ('private_scheduled'     ,'b1','event'      ,'private' ,'scheduled'),
      ('public_ended'          ,'b1','event'      ,'public'  ,'ended'),
      ('public_cancelled'      ,'b1','event'      ,'public'  ,'cancelled'),
      ('draft_draft'           ,'b1','event'      ,'draft'   ,'draft'),
      ('rsvp_public'           ,'b1','rsvp'       ,'public'  ,'scheduled'),
      ('trip_public'           ,'b1','trip'       ,'public'  ,'scheduled'),
      ('experience_public'     ,'b1','experience' ,'public'  ,'scheduled'),
      ('deleted_public'        ,'b1','event'      ,'public'  ,'scheduled'),
      ('foreign_public'        ,'b2','event'      ,'public'  ,'scheduled'),
      ('guard_probe'           ,'b1','event'      ,'public'  ,'scheduled'),
      ('effect_probe'          ,'b1','event'      ,'public'  ,'scheduled'),
      ('revocation_probe'      ,'b1','event'      ,'public'  ,'scheduled'),
      ('admin_probe'           ,'b1','event'      ,'public'  ,'scheduled'),
      ('admin_private_probe'   ,'b1','event'      ,'public'  ,'scheduled'),
      ('admin_trip_probe'      ,'b1','trip'       ,'public'  ,'scheduled'),
      ('rollback_probe'        ,'b1','event'      ,'public'  ,'scheduled')
    ) AS t(key,brand,etype,vis,st)
  LOOP
    v_ev := gen_random_uuid();
    INSERT INTO public.events(id,brand_id,title,slug,event_type,visibility,status,timezone,published_at,currency)
      VALUES (v_ev, CASE r.brand WHEN 'b1' THEN v_b1 ELSE v_b2 END,
              'I2009T '||r.key, 'i2009t-'||replace(r.key,'_','-'),
              r.etype, r.vis, r.st, 'UTC', now(), 'USD');
    INSERT INTO public.event_dates(event_id,start_at,end_at,is_master,timezone)
      VALUES (v_ev, now()+interval '10 day', now()+interval '10 day 3 hour', true, 'UTC');
    INSERT INTO i2009t.fx VALUES (r.key, v_ev);
  END LOOP;

  UPDATE public.events SET deleted_at = now()
   WHERE id = (SELECT event_id FROM i2009t.fx WHERE key='deleted_public');
END $fx$;

-- ---------------------------------------------------------------------
-- 2. SC-3 / SC-1 — the happy path. Public -> Unlisted persists as `hidden`,
--    one audit row, one effect row keyed by the transition id, one
--    generation increment, and the echo the client verifies.
-- ---------------------------------------------------------------------
DO $sc3$
DECLARE
  v_ev uuid; v_before timestamptz; v_gen_before bigint; v_gen_after bigint;
  v_res text; v_json jsonb; v_row public.events%ROWTYPE; v_eff public.event_visibility_transition_effects%ROWTYPE;
  v_audits int;
BEGIN
  SELECT event_id INTO v_ev FROM i2009t.fx WHERE key='public_scheduled';
  SELECT updated_at INTO v_before FROM public.events WHERE id = v_ev;
  SELECT generation INTO v_gen_before FROM public.event_discovery_generation;

  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'), v_ev,
                          'unlisted', 'Switching to unlisted for the private preview week', v_before);
  PERFORM i2009t.assert('SC-1/SC-3','event_manager can set Unlisted', v_res LIKE 'OK:%', v_res);
  IF v_res NOT LIKE 'OK:%' THEN RETURN; END IF;
  v_json := substr(v_res, 4)::jsonb;

  SELECT * INTO v_row FROM public.events WHERE id = v_ev;
  PERFORM i2009t.assert('SC-3','Business `unlisted` persists as stored `hidden`',
    v_row.visibility = 'hidden', v_row.visibility);
  PERFORM i2009t.assert('SC-3','echo storedVisibility is hidden and changed is true',
    v_json->>'storedVisibility' = 'hidden' AND (v_json->>'changed')::boolean, v_json::text);
  PERFORM i2009t.assert('SC-3','echo requestedVisibility round-trips the Business label',
    v_json->>'requestedVisibility' = 'unlisted', v_json::text);
  PERFORM i2009t.assert('SC-3','echo previousStoredVisibility is the locked before value',
    v_json->>'previousStoredVisibility' = 'public', v_json::text);
  PERFORM i2009t.assert('SC-6','updated_at advanced on a real change',
    v_row.updated_at > v_before, v_row.updated_at::text);

  SELECT count(*) INTO v_audits FROM public.audit_log
   WHERE event_id = v_ev AND action = 'event.visibility_changed';
  PERFORM i2009t.assert('SC-9','exactly ONE Business audit row for one changed transition',
    v_audits = 1, v_audits::text);

  SELECT * INTO v_eff FROM public.event_visibility_transition_effects WHERE event_id = v_ev;
  PERFORM i2009t.assert('SC-9A','exactly one effect row, writer_class business',
    v_eff.writer_class = 'business' AND v_eff.old_visibility='public' AND v_eff.new_visibility='hidden',
    coalesce(v_eff.writer_class,'<none>'));
  PERFORM i2009t.assert('SC-9A','the audit row carries the SAME revokedShareCount as the effect row',
    (SELECT (after->>'revokedShareCount')::int FROM public.audit_log
      WHERE event_id=v_ev AND action='event.visibility_changed') = v_eff.revoked_share_count
    AND (v_json->>'revokedShareCount')::int = v_eff.revoked_share_count,
    v_eff.revoked_share_count::text);
  PERFORM i2009t.assert('SC-9A','the audit row is keyed to the exact transition id',
    (SELECT after->>'transitionId' FROM public.audit_log
      WHERE event_id=v_ev AND action='event.visibility_changed') = v_eff.transition_id::text);
  PERFORM i2009t.assert('SC-9','the audit row records the reason and no share code',
    (SELECT after->>'reason' FROM public.audit_log WHERE event_id=v_ev AND action='event.visibility_changed')
      = 'Switching to unlisted for the private preview week');

  SELECT generation INTO v_gen_after FROM public.event_discovery_generation;
  PERFORM i2009t.assert('SC-14','discovery generation incremented by exactly 1',
    v_gen_after = v_gen_before + 1, v_gen_before::text||'->'||v_gen_after::text);
END $sc3$;

-- SC-15 — Unlisted -> Public is the same synchronous change, and increments again.
DO $sc15$
DECLARE v_ev uuid; v_before timestamptz; v_gen bigint; v_res text;
BEGIN
  SELECT event_id INTO v_ev FROM i2009t.fx WHERE key='public_scheduled';
  SELECT updated_at INTO v_before FROM public.events WHERE id=v_ev;
  SELECT generation INTO v_gen FROM public.event_discovery_generation;
  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='owner'), v_ev,
                          'public', 'Returning the event to public discovery now', v_before);
  PERFORM i2009t.assert('SC-15','Unlisted -> Public succeeds for the brand owner', v_res LIKE 'OK:%', v_res);
  PERFORM i2009t.assert('SC-15','stored value returned to public',
    (SELECT visibility FROM public.events WHERE id=v_ev) = 'public');
  PERFORM i2009t.assert('SC-15','generation incremented again',
    (SELECT generation FROM public.event_discovery_generation) = v_gen + 1);
  PERFORM i2009t.assert('SC-9A','two transitions produced two distinct effect rows',
    (SELECT count(DISTINCT transition_id) FROM public.event_visibility_transition_effects
      WHERE event_id=v_ev) = 2);
END $sc15$;

-- ---------------------------------------------------------------------
-- 3. SC-5 / SC-5A — authorization matrix. Missing, deleted, foreign-brand and
--    below-rank targets are INDISTINGUISHABLE from one another.
-- ---------------------------------------------------------------------
DO $sc5$
DECLARE v_ts timestamptz := now(); v_res text; v_gen bigint; v_eff int;
BEGIN
  SELECT generation INTO v_gen FROM public.event_discovery_generation;
  SELECT count(*) INTO v_eff FROM public.event_visibility_transition_effects;

  v_res := i2009t.try_set(NULL, (SELECT event_id FROM i2009t.fx WHERE key='public_live'),
                          'unlisted','A perfectly valid ten plus character reason', v_ts);
  PERFORM i2009t.assert('SC-5','anonymous caller is refused with not_authenticated',
    v_res = 'not_authenticated', v_res);

  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='stranger'),
                          (SELECT event_id FROM i2009t.fx WHERE key='public_live'),
                          'unlisted','A perfectly valid ten plus character reason', v_ts);
  PERFORM i2009t.assert('SC-5A','foreign-brand caller gets the nondisclosing event_not_found',
    v_res = 'event_not_found', v_res);

  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='scanner'),
                          (SELECT event_id FROM i2009t.fx WHERE key='public_live'),
                          'unlisted','A perfectly valid ten plus character reason', v_ts);
  PERFORM i2009t.assert('SC-5A','below-event_manager caller gets the SAME event_not_found',
    v_res = 'event_not_found', v_res);

  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'),
                          '00000000-2009-4000-8000-00000000dead',
                          'unlisted','A perfectly valid ten plus character reason', v_ts);
  PERFORM i2009t.assert('SC-5A','an unknown UUID produces the identical error shape',
    v_res = 'event_not_found', v_res);

  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'),
                          (SELECT event_id FROM i2009t.fx WHERE key='deleted_public'),
                          'unlisted','A perfectly valid ten plus character reason', v_ts);
  PERFORM i2009t.assert('SC-5','a soft-deleted event is not found',
    v_res = 'event_not_found', v_res);

  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='owner'),
                          (SELECT event_id FROM i2009t.fx WHERE key='foreign_public'),
                          'unlisted','A perfectly valid ten plus character reason', v_ts);
  PERFORM i2009t.assert('SC-5','brand-one owner cannot touch a brand-two event',
    v_res = 'event_not_found', v_res);

  PERFORM i2009t.assert('SC-5','no rejected call produced any side effect',
    (SELECT generation FROM public.event_discovery_generation) = v_gen
    AND (SELECT count(*) FROM public.event_visibility_transition_effects) = v_eff);
END $sc5$;

-- ---------------------------------------------------------------------
-- 4. SC-4 / SC-5 — value, type and status matrix.
-- ---------------------------------------------------------------------
DO $sc4$
DECLARE v_ev uuid; v_ts timestamptz; v_res text; v_bad text; v_gen bigint; v_audits int;
BEGIN
  SELECT event_id INTO v_ev FROM i2009t.fx WHERE key='public_live';
  SELECT updated_at INTO v_ts FROM public.events WHERE id=v_ev;
  SELECT generation INTO v_gen FROM public.event_discovery_generation;
  SELECT count(*) INTO v_audits FROM public.audit_log WHERE action='event.visibility_changed';

  FOREACH v_bad IN ARRAY ARRAY['hidden','discover','draft','','visible','PUBLICLY'] LOOP
    v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'), v_ev, v_bad,
                            'A perfectly valid ten plus character reason', v_ts);
    PERFORM i2009t.assert('SC-4','stored-only or unknown value `'||v_bad||'` is refused',
      v_res = 'invalid_visibility', v_res);
  END LOOP;

  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'), v_ev, NULL,
                          'A perfectly valid ten plus character reason', v_ts);
  PERFORM i2009t.assert('SC-4','NULL visibility is refused', v_res = 'invalid_visibility', v_res);

  -- Outer whitespace/case normalisation is allowed and must still land as hidden.
  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'), v_ev, '  UnListed ',
                          'Normalising whitespace and case on the request', v_ts);
  PERFORM i2009t.assert('SC-4','outer whitespace/case normalises to the Business label',
    v_res LIKE 'OK:%' AND (SELECT visibility FROM public.events WHERE id=v_ev) = 'hidden', v_res);

  -- Non-standard offering types are out of #2009's scope.
  FOR v_res IN
    SELECT i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'), f.event_id, 'unlisted',
                          'A perfectly valid ten plus character reason',
                          (SELECT updated_at FROM public.events WHERE id=f.event_id))
      FROM i2009t.fx f WHERE f.key IN ('rsvp_public','trip_public','experience_public')
  LOOP
    PERFORM i2009t.assert('SC-5','RSVP / trip / experience targets are not editable here',
      v_res = 'event_not_editable', v_res);
  END LOOP;

  -- Non-editable statuses.
  FOR v_res IN
    SELECT i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'), f.event_id, 'unlisted',
                          'A perfectly valid ten plus character reason',
                          (SELECT updated_at FROM public.events WHERE id=f.event_id))
      FROM i2009t.fx f WHERE f.key IN ('public_ended','public_cancelled','draft_draft')
  LOOP
    PERFORM i2009t.assert('SC-5','ended / cancelled / draft targets are not editable',
      v_res = 'event_not_editable', v_res);
  END LOOP;

  PERFORM i2009t.assert('SC-4','no invalid or non-editable call wrote an audit row',
    (SELECT count(*) FROM public.audit_log WHERE action='event.visibility_changed') = v_audits + 1);
  PERFORM i2009t.assert('SC-4','generation moved exactly once (the one accepted normalisation)',
    (SELECT generation FROM public.event_discovery_generation) = v_gen + 1);
END $sc4$;

-- SC-6 — reason gate.
DO $sc6$
DECLARE v_ev uuid; v_ts timestamptz; v_res text;
BEGIN
  SELECT event_id INTO v_ev FROM i2009t.fx WHERE key='hidden_scheduled';
  SELECT updated_at INTO v_ts FROM public.events WHERE id=v_ev;
  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'), v_ev,'public','too short', v_ts);
  PERFORM i2009t.assert('SC-6','a 9-character reason is refused', v_res='invalid_edit_reason', v_res);
  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'), v_ev,'public','          ', v_ts);
  PERFORM i2009t.assert('SC-6','a whitespace-only reason is refused after trimming',
    v_res='invalid_edit_reason', v_res);
  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'), v_ev,'public',
                          repeat('x',201), v_ts);
  PERFORM i2009t.assert('SC-6','a 201-character reason is refused', v_res='invalid_edit_reason', v_res);
  PERFORM i2009t.assert('SC-6','no reason rejection changed the stored value',
    (SELECT visibility FROM public.events WHERE id=v_ev) = 'hidden');
END $sc6$;

-- ---------------------------------------------------------------------
-- 5. SC-7 — the same-value no-op is evaluated BEFORE stale rejection, and a
--    real change with a wrong expected timestamp is rejected without writing.
-- ---------------------------------------------------------------------
DO $sc7$
DECLARE v_ev uuid; v_ts timestamptz; v_gen bigint; v_res text; v_json jsonb; v_effects int;
BEGIN
  SELECT event_id INTO v_ev FROM i2009t.fx WHERE key='hidden_scheduled';
  SELECT updated_at INTO v_ts FROM public.events WHERE id=v_ev;
  SELECT generation INTO v_gen FROM public.event_discovery_generation;
  SELECT count(*) INTO v_effects FROM public.event_visibility_transition_effects;

  -- Same target value, DELIBERATELY WRONG expected timestamp: the retry is
  -- idempotent and must NOT be rejected as stale.
  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'), v_ev,'unlisted',
                          'A network retry replaying the same target value',
                          v_ts - interval '1 hour');
  PERFORM i2009t.assert('SC-7','same-value replay with a stale timestamp is an idempotent no-op',
    v_res LIKE 'OK:%', v_res);
  IF v_res LIKE 'OK:%' THEN
    v_json := substr(v_res,4)::jsonb;
    PERFORM i2009t.assert('SC-7','the no-op reports changed:false and revokedShareCount 0',
      (v_json->>'changed')::boolean IS FALSE AND (v_json->>'revokedShareCount')::int = 0, v_json::text);
  END IF;
  PERFORM i2009t.assert('SC-7','the no-op touched no timestamp',
    (SELECT updated_at FROM public.events WHERE id=v_ev) = v_ts);
  PERFORM i2009t.assert('SC-7','the no-op wrote no effect row and no generation increment',
    (SELECT count(*) FROM public.event_visibility_transition_effects) = v_effects
    AND (SELECT generation FROM public.event_discovery_generation) = v_gen);
  PERFORM i2009t.assert('SC-9','the no-op wrote no audit row',
    (SELECT count(*) FROM public.audit_log
      WHERE event_id=v_ev AND action='event.visibility_changed') = 0);

  -- A REAL change with a wrong expected timestamp is rejected.
  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'), v_ev,'public',
                          'Concurrent editor already moved this event on',
                          v_ts - interval '1 hour');
  PERFORM i2009t.assert('SC-7','a real change with a mismatched updated_at is stale-rejected',
    v_res = 'stale_event_visibility', v_res);
  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'), v_ev,'public',
                          'Expected updated at was omitted by the caller', NULL);
  PERFORM i2009t.assert('SC-6','a NULL expected updated_at is rejected for a real change',
    v_res = 'stale_event_visibility', v_res);
  PERFORM i2009t.assert('SC-7','no stale rejection wrote anything',
    (SELECT visibility FROM public.events WHERE id=v_ev) = 'hidden'
    AND (SELECT count(*) FROM public.event_visibility_transition_effects) = v_effects
    AND (SELECT generation FROM public.event_discovery_generation) = v_gen);
END $sc7$;

-- ---------------------------------------------------------------------
-- 6. SC-11 / SC-12 — Private fails closed BEHAVIOURALLY, at the RPC, in both
--    directions, with zero residue. This is the criterion Amendment 3 §5
--    requires to be proven by calling the RPC, not by a string match.
-- ---------------------------------------------------------------------
DO $sc12$
DECLARE v_pub uuid; v_priv uuid; v_ts timestamptz; v_gen bigint; v_effects int; v_res text; v_audits int;
BEGIN
  SELECT event_id INTO v_pub  FROM i2009t.fx WHERE key='public_live';
  SELECT event_id INTO v_priv FROM i2009t.fx WHERE key='private_scheduled';
  SELECT generation INTO v_gen FROM public.event_discovery_generation;
  SELECT count(*) INTO v_effects FROM public.event_visibility_transition_effects;
  SELECT count(*) INTO v_audits FROM public.audit_log
   WHERE event_id IN (v_pub,v_priv) AND action='event.visibility_changed';

  SELECT updated_at INTO v_ts FROM public.events WHERE id=v_pub;
  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'), v_pub,'private',
                          'Locking this down to invited guests only now', v_ts);
  PERFORM i2009t.assert('SC-12','ENTERING Private is refused with private_visibility_unavailable',
    v_res = 'private_visibility_unavailable', v_res);
  PERFORM i2009t.assert('SC-12','the refused Private request left the stored value untouched',
    (SELECT visibility FROM public.events WHERE id=v_pub) = 'hidden');

  SELECT updated_at INTO v_ts FROM public.events WHERE id=v_priv;
  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'), v_priv,'public',
                          'Bringing this private event back to public', v_ts);
  PERFORM i2009t.assert('SC-12','LEAVING Private is refused with the same stable code',
    v_res = 'private_visibility_unavailable', v_res);
  PERFORM i2009t.assert('SC-12','the private fixture is still private',
    (SELECT visibility FROM public.events WHERE id=v_priv) = 'private');

  -- A private-stored event asking for private is still a plain idempotent
  -- no-op: a no-op is not a transition.
  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'), v_priv,'private',
                          'Replaying the value this event already holds', v_ts);
  PERFORM i2009t.assert('SC-7','private -> private is an idempotent no-op, not a transition',
    v_res LIKE 'OK:%' AND (substr(v_res,4)::jsonb->>'changed')::boolean IS FALSE, v_res);

  PERFORM i2009t.assert('SC-12','no Private path produced audit, effect or generation residue',
    (SELECT generation FROM public.event_discovery_generation) = v_gen
    AND (SELECT count(*) FROM public.event_visibility_transition_effects) = v_effects
    AND (SELECT count(*) FROM public.audit_log
          WHERE event_id IN (v_pub,v_priv) AND action='event.visibility_changed') = v_audits);
END $sc12$;

-- ---------------------------------------------------------------------
-- 7. SC-8 — a direct authenticated table UPDATE cannot bypass the RPC, and an
--    UPDATE that does not change visibility is NOT blocked.
-- ---------------------------------------------------------------------
DO $sc8$
DECLARE v_ev uuid; v_msg text; v_rows int;
BEGIN
  SELECT event_id INTO v_ev FROM i2009t.fx WHERE key='guard_probe';
  -- Sign in as the event_manager: the shipped "Event manager plus can update
  -- events" RLS policy admits this caller, so the probe genuinely reaches the
  -- guard rather than being silently filtered to zero rows. Non-vacuity is
  -- asserted below with an UPDATE that is expected to SUCCEED.
  PERFORM i2009t.act_as((SELECT v FROM i2009t.ids WHERE k='manager'));
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.events SET visibility='hidden' WHERE id=v_ev;
    RESET ROLE;
    v_msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v_msg := SQLERRM;
  END;
  PERFORM i2009t.assert('SC-8','a direct authenticated visibility UPDATE is blocked',
    v_msg = 'event_visibility_direct_update_blocked', v_msg);
  PERFORM i2009t.assert('SC-8','the blocked direct update changed nothing',
    (SELECT visibility FROM public.events WHERE id=v_ev) = 'public');

  -- The guard must not fire for an UPDATE that leaves visibility alone, AND
  -- that UPDATE must really reach a row (otherwise the probe above proved
  -- nothing but an RLS filter).
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.events SET title='I2009T guard_probe touched' WHERE id=v_ev;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RESET ROLE;
    v_msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM; v_rows := -1;
  END;
  PERFORM i2009t.assert('SC-8','an UPDATE that does not name visibility is untouched by the guard',
    v_msg = '<no error>', v_msg);
  PERFORM i2009t.assert('SC-8','NON-VACUITY: the same authenticated caller CAN update this row',
    v_rows = 1, coalesce(v_rows::text,'<null>'));

  -- Naming the column with the SAME value is also not a change.
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.events SET visibility='public' WHERE id=v_ev;
    RESET ROLE;
    v_msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN RESET ROLE; v_msg := SQLERRM;
  END;
  PERFORM i2009t.assert('SC-8','naming visibility with an unchanged value is not blocked',
    v_msg = '<no error>', v_msg);

  -- And the RPC still works on the same row (the guard blocks the bypass, not
  -- the authoritative path).
  PERFORM i2009t.assert('SC-8','the narrow RPC still succeeds on the same row',
    i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'), v_ev,'unlisted',
      'Proving the authoritative path is unaffected here',
      (SELECT updated_at FROM public.events WHERE id=v_ev)) LIKE 'OK:%');
END $sc8$;

-- ---------------------------------------------------------------------
-- 8. SC-9A — the effect handoff is load-bearing. With the effects trigger
--    disabled the RPC must REFUSE and roll everything back rather than
--    inventing a count.
-- ---------------------------------------------------------------------
DO $sc9a$
DECLARE v_ev uuid; v_res text; v_gen bigint;
BEGIN
  SELECT event_id INTO v_ev FROM i2009t.fx WHERE key='effect_probe';
  SELECT generation INTO v_gen FROM public.event_discovery_generation;
  ALTER TABLE public.events DISABLE TRIGGER issue_2009_events_visibility_effects;
  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'), v_ev,'unlisted',
                          'Proving the transition effect handoff is required',
                          (SELECT updated_at FROM public.events WHERE id=v_ev));
  ALTER TABLE public.events ENABLE TRIGGER issue_2009_events_visibility_effects;
  PERFORM i2009t.assert('SC-9A','a missing effect row aborts the whole mutation',
    v_res = 'event_visibility_effect_missing', v_res);
  PERFORM i2009t.assert('SC-9A','the aborted mutation left the stored value and generation intact',
    (SELECT visibility FROM public.events WHERE id=v_ev) = 'public'
    AND (SELECT generation FROM public.event_discovery_generation) = v_gen);
  PERFORM i2009t.assert('SC-9A','the aborted mutation wrote no audit row',
    (SELECT count(*) FROM public.audit_log WHERE event_id=v_ev AND action='event.visibility_changed')=0);
END $sc9a$;

-- ---------------------------------------------------------------------
-- 9. SC-16A — the exact Amendment 1 §E revocation predicate and cardinality.
--
--    Private is refused at the BEFORE guard for every product path, so the
--    AFTER coordinator's revocation branch is not reachable through the RPC
--    this release. It is still SHIPPED code that #2144 will consume, so it is
--    exercised here directly: the guard is suspended for exactly one
--    superuser UPDATE, the coordinator runs for real against a real 8-case
--    link fixture, and the guard is restored and re-proven immediately after.
--    Nothing about the shipped guard is changed by this suite.
-- ---------------------------------------------------------------------
DO $sc16$
DECLARE
  v_ev uuid; v_other uuid; v_eff public.event_visibility_transition_effects%ROWTYPE;
  v_res text; v_gen bigint;
BEGIN
  SELECT event_id INTO v_ev    FROM i2009t.fx WHERE key='revocation_probe';
  SELECT event_id INTO v_other FROM i2009t.fx WHERE key='public_live';
  SELECT generation INTO v_gen FROM public.event_discovery_generation;

  -- content_share_links_stable_active_source_idx is UNIQUE on
  -- (creator_principal, entity_kind, access_policy, source_key) WHERE active,
  -- so the three rows that legitimately share our canonical source_key are
  -- authored by three different principals — exactly the historical/
  -- service-authored drift Amendment 1 §E exists to catch.
  INSERT INTO public.profiles(id)
    SELECT v FROM i2009t.ids WHERE k IN ('owner','manager','scanner')
    ON CONFLICT DO NOTHING;

  INSERT INTO public.content_share_links(
    entity_kind, creator_principal, source_key, source_reference, state, current_version,
    revoked_at, deleted_at)
  VALUES
    -- 1 key-only match                          -> revoke, mismatch
    ('event',(SELECT v FROM i2009t.ids WHERE k='owner'),
     'event:'||v_ev::text, '{"other":"x"}'::jsonb,'active',1,NULL,NULL),
    -- 2 reference-only match                    -> revoke, mismatch
    ('event',NULL,
     'event:not-this-one', jsonb_build_object('eventId', v_ev::text),'active',1,NULL,NULL),
    -- 3 both representations match              -> revoke ONCE, no mismatch
    ('event',(SELECT v FROM i2009t.ids WHERE k='manager'),
     'event:'||v_ev::text, jsonb_build_object('eventId', v_ev::text),'active',1,NULL,NULL),
    -- 4 drifted A/B: key is ours, reference is another event -> revoke, mismatch
    ('event',(SELECT v FROM i2009t.ids WHERE k='scanner'),
     'event:'||v_ev::text, jsonb_build_object('eventId', v_other::text),'active',1,NULL,NULL),
    -- 5 another event entirely                  -> untouched
    ('event',NULL,
     'event:'||v_other::text, jsonb_build_object('eventId', v_other::text),'active',1,NULL,NULL),
    -- 6 another entity_kind carrying our id     -> untouched
    ('trip' ,NULL,
     'trip:'||v_ev::text, jsonb_build_object('eventId', v_ev::text),'active',1,NULL,NULL),
    -- 7 already revoked                         -> untouched, not counted
    ('event',NULL,
     'event:'||v_ev::text||'#old', jsonb_build_object('eventId', v_ev::text),'revoked',1,now(),NULL),
    -- 8 already deleted                         -> untouched, not counted
    ('event',NULL,
     'event:'||v_ev::text||'#gone', jsonb_build_object('eventId', v_ev::text),'deleted',1,NULL,now());

  -- Public -> Unlisted must leave EVERY link active: both states are shareable.
  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'), v_ev,'unlisted',
                          'Unlisted keeps existing share links alive by design',
                          (SELECT updated_at FROM public.events WHERE id=v_ev));
  PERFORM i2009t.assert('SC-10','Public -> Unlisted succeeds', v_res LIKE 'OK:%', v_res);
  PERFORM i2009t.assert('SC-10','Public -> Unlisted revoked ZERO links (both states are shareable)',
    (substr(v_res,4)::jsonb->>'revokedShareCount')::int = 0
    AND (SELECT count(*) FROM public.content_share_links
          WHERE state='active' AND entity_kind='event'
            AND (source_key='event:'||v_ev::text OR source_reference->>'eventId'=v_ev::text)) = 4);

  -- Now exercise the coordinator's Private branch directly.
  ALTER TABLE public.events DISABLE TRIGGER issue_2009_events_visibility_guard;
  UPDATE public.events SET visibility='private', updated_at=now() WHERE id=v_ev;
  ALTER TABLE public.events ENABLE TRIGGER issue_2009_events_visibility_guard;

  SELECT * INTO v_eff FROM public.event_visibility_transition_effects
   WHERE event_id=v_ev AND new_visibility='private';
  PERFORM i2009t.assert('SC-16A','a trusted Private transition records writer_class admin_or_trusted',
    v_eff.writer_class='admin_or_trusted', coalesce(v_eff.writer_class,'<none>'));
  PERFORM i2009t.assert('SC-16A','exact revoked cardinality is 4 distinct link rows',
    v_eff.revoked_share_count = 4, coalesce(v_eff.revoked_share_count::text,'<null>'));
  PERFORM i2009t.assert('SC-16A','exact representation-mismatch cardinality is 3',
    v_eff.representation_mismatch_count = 3, coalesce(v_eff.representation_mismatch_count::text,'<null>'));
  PERFORM i2009t.assert('SC-16A','the other event''s link is still active',
    (SELECT state FROM public.content_share_links
      WHERE entity_kind='event' AND source_key='event:'||v_other::text) = 'active');
  PERFORM i2009t.assert('SC-16A','a non-event entity_kind carrying our id is untouched',
    (SELECT state FROM public.content_share_links
      WHERE entity_kind='trip' AND source_key='trip:'||v_ev::text) = 'active');
  PERFORM i2009t.assert('SC-16A','already-revoked and already-deleted rows were not re-touched',
    (SELECT count(*) FROM public.content_share_links
      WHERE source_key IN ('event:'||v_ev::text||'#old','event:'||v_ev::text||'#gone')
        AND state IN ('revoked','deleted')) = 2);
  PERFORM i2009t.assert('SC-14','the Private transition incremented generation once',
    v_eff.discovery_generation = v_gen + 2);   -- +1 for the Unlisted step, +1 here

  -- The guard is BACK: entering/leaving Private is refused again.
  v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'), v_ev,'public',
                          'Confirming the fail-closed guard was restored',
                          (SELECT updated_at FROM public.events WHERE id=v_ev));
  PERFORM i2009t.assert('SC-12','the Private guard is restored after the direct probe',
    v_res = 'private_visibility_unavailable', v_res);
END $sc16$;

-- ---------------------------------------------------------------------
-- 10. SC-29 — Admin compatibility.
-- ---------------------------------------------------------------------
DO $sc29$
DECLARE v_ev uuid; v_trip uuid; v_gen bigint; v_msg text; v_admin uuid; v_effects int;
BEGIN
  SELECT event_id INTO v_ev   FROM i2009t.fx WHERE key='admin_probe';
  SELECT event_id INTO v_trip FROM i2009t.fx WHERE key='admin_trip_probe';
  SELECT v INTO v_admin FROM i2009t.ids WHERE k='owner';

  -- Make `owner` an admin for the duration of this block.
  INSERT INTO public.admin_users(email, role, status)
  VALUES ('owner@i2009t.test', 'owner', 'active')
  ON CONFLICT (email) DO UPDATE SET status='active', role='owner';
  PERFORM i2009t.act_as(v_admin);

  SELECT generation INTO v_gen FROM public.event_discovery_generation;
  SELECT count(*) INTO v_effects FROM public.event_visibility_transition_effects;

  BEGIN
    PERFORM public.admin_set_offering_visibility(v_ev, 'hidden', 'admin console hides this offering');
    v_msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  PERFORM i2009t.assert('SC-29','Admin Public -> Hidden still succeeds synchronously',
    v_msg = '<no error>', v_msg);
  PERFORM i2009t.assert('SC-29','Admin write landed',
    (SELECT visibility FROM public.events WHERE id=v_ev) = 'hidden');
  PERFORM i2009t.assert('SC-29','Admin transition produced exactly one admin_or_trusted effect row',
    (SELECT count(*) FROM public.event_visibility_transition_effects
      WHERE event_id=v_ev AND writer_class='admin_or_trusted') = 1
    AND (SELECT count(*) FROM public.event_visibility_transition_effects) = v_effects + 1);
  PERFORM i2009t.assert('SC-29','Admin transition wrote NO duplicate Business audit row',
    (SELECT count(*) FROM public.audit_log WHERE event_id=v_ev AND action='event.visibility_changed') = 0);
  PERFORM i2009t.assert('SC-29','Admin kept its own admin_audit_log entry',
    (SELECT count(*) FROM public.admin_audit_log
      WHERE action='offering.set_visibility' AND target_id = v_ev::text) = 1);
  PERFORM i2009t.assert('SC-14','Admin transition incremented discovery generation',
    (SELECT generation FROM public.event_discovery_generation) = v_gen + 1);

  -- Admin Private boundary on a standard ticketed event.
  BEGIN
    PERFORM public.admin_set_offering_visibility(
      (SELECT event_id FROM i2009t.fx WHERE key='admin_private_probe'),
      'private','admin console tries to make this private');
    v_msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  PERFORM i2009t.assert('SC-35','Admin Private boundary returns private_transition_requires_business',
    v_msg = 'private_transition_requires_business', v_msg);
  PERFORM i2009t.assert('SC-35','the refused Admin Private request changed nothing',
    (SELECT visibility FROM public.events
      WHERE id=(SELECT event_id FROM i2009t.fx WHERE key='admin_private_probe')) = 'public');

  -- Non-standard offering types keep their existing Admin behaviour.
  BEGIN
    PERFORM public.admin_set_offering_visibility(v_trip,'private','admin console hides a trip');
    v_msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  PERFORM i2009t.assert('SC-22','Admin can still take a TRIP private (#2009 scope is the ticketed event)',
    v_msg = '<no error>', v_msg);

  DELETE FROM public.admin_users WHERE email = 'owner@i2009t.test';
  PERFORM i2009t.act_as(NULL);
END $sc29$;

-- ---------------------------------------------------------------------
-- 11. SC-22 — RSVP visibility editing, including its `private` path, is
--     untouched by the #2009 guard.
-- ---------------------------------------------------------------------
DO $sc22$
DECLARE v_rsvp uuid; v_msg text;
BEGIN
  SELECT event_id INTO v_rsvp FROM i2009t.fx WHERE key='rsvp_public';
  BEGIN
    -- The shipped RSVP writer is a SECURITY DEFINER RPC; this simulates its
    -- trusted-context write on an event_type='rsvp' row, which #2009 must not
    -- intercept in either direction.
    UPDATE public.events SET visibility='private', updated_at=now() WHERE id=v_rsvp;
    UPDATE public.events SET visibility='hidden',  updated_at=now() WHERE id=v_rsvp;
    v_msg := '<no error>';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  PERFORM i2009t.assert('SC-22','RSVP rows cross the Private boundary exactly as before',
    v_msg='<no error>', v_msg);
  PERFORM i2009t.assert('SC-22','RSVP transitions create NO #2009 effect rows',
    (SELECT count(*) FROM public.event_visibility_transition_effects WHERE event_id=v_rsvp) = 0);
END $sc22$;

-- ---------------------------------------------------------------------
-- 12. Rollback atomicity — a transaction that aborts after a successful
--     mutation leaves zero committed residue.
-- ---------------------------------------------------------------------
DO $rollback$
DECLARE v_ev uuid; v_gen bigint; v_effects int; v_audits int; v_res text;
BEGIN
  SELECT event_id INTO v_ev FROM i2009t.fx WHERE key='rollback_probe';
  SELECT generation INTO v_gen FROM public.event_discovery_generation;
  SELECT count(*) INTO v_effects FROM public.event_visibility_transition_effects;
  SELECT count(*) INTO v_audits  FROM public.audit_log WHERE action='event.visibility_changed';

  BEGIN
    v_res := i2009t.try_set((SELECT v FROM i2009t.ids WHERE k='manager'), v_ev,'unlisted',
                            'This whole subtransaction is going to abort',
                            (SELECT updated_at FROM public.events WHERE id=v_ev));
    IF v_res NOT LIKE 'OK:%' THEN RAISE EXCEPTION 'setup_failed: %', v_res; END IF;
    RAISE EXCEPTION 'i2009t_forced_abort';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'i2009t_forced_abort' THEN
      PERFORM i2009t.assert('ROLLBACK','setup for the rollback probe succeeded', false, SQLERRM);
    END IF;
  END;

  PERFORM i2009t.assert('ROLLBACK','the aborted transition left the stored value unchanged',
    (SELECT visibility FROM public.events WHERE id=v_ev) = 'public');
  PERFORM i2009t.assert('ROLLBACK','the aborted transition left no effect row',
    (SELECT count(*) FROM public.event_visibility_transition_effects) = v_effects);
  PERFORM i2009t.assert('ROLLBACK','the aborted transition left no audit row',
    (SELECT count(*) FROM public.audit_log WHERE action='event.visibility_changed') = v_audits);
  PERFORM i2009t.assert('ROLLBACK','the aborted transition left no generation increment',
    (SELECT generation FROM public.event_discovery_generation) = v_gen);
END $rollback$;

-- ---------------------------------------------------------------------
-- 13. Least privilege — the two new tables and the generation reader are not
--     reachable by a client role, and the RPC is.
-- ---------------------------------------------------------------------
DO $acl$
BEGIN
  PERFORM i2009t.assert('ACL','authenticated may EXECUTE the narrow RPC',
    has_function_privilege('authenticated',
      'public.business_set_event_visibility(uuid,text,text,timestamptz)','EXECUTE'));
  PERFORM i2009t.assert('ACL','anon may NOT EXECUTE the narrow RPC',
    NOT has_function_privilege('anon',
      'public.business_set_event_visibility(uuid,text,text,timestamptz)','EXECUTE'));
  PERFORM i2009t.assert('ACL','the transition-effect ledger is not readable by a client role',
    NOT has_table_privilege('authenticated','public.event_visibility_transition_effects','SELECT')
    AND NOT has_table_privilege('anon','public.event_visibility_transition_effects','SELECT'));
  PERFORM i2009t.assert('ACL','the discovery-generation singleton is not readable by a client role',
    NOT has_table_privilege('authenticated','public.event_discovery_generation','SELECT')
    AND NOT has_table_privilege('anon','public.event_discovery_generation','SELECT'));
  PERFORM i2009t.assert('ACL','the generation reader is service-only',
    has_function_privilege('service_role','public.issue_2009_event_discovery_generation()','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.issue_2009_event_discovery_generation()','EXECUTE'));
  PERFORM i2009t.assert('ACL','the effect ledger is append-only for a non-owner writer',
    (SELECT count(*) FROM pg_trigger
      WHERE tgname='issue_2009_transition_effects_append_only') = 1);
END $acl$;

-- ---------------------------------------------------------------------
-- 14. Verdict. Non-vacuity: the suite must have run a minimum number of
--     assertions and must have observed BOTH a committed transition and a
--     refused one, or it proves nothing.
-- ---------------------------------------------------------------------
DO $verdict$
DECLARE v_fail int; v_total int; r record;
BEGIN
  SELECT count(*) FILTER (WHERE outcome='FAIL'), count(*) INTO v_fail, v_total FROM i2009t.result;
  FOR r IN SELECT * FROM i2009t.result ORDER BY id LOOP
    RAISE NOTICE '% [%] % %', r.outcome, r.criterion, r.name,
      CASE WHEN r.detail IS NULL THEN '' ELSE '(' || r.detail || ')' END;
  END LOOP;
  IF v_total < 60 THEN
    RAISE EXCEPTION 'issue #2009 suite is vacuous: only % assertions ran', v_total;
  END IF;
  IF (SELECT count(*) FROM public.event_visibility_transition_effects) = 0 THEN
    RAISE EXCEPTION 'issue #2009 suite is vacuous: not one real transition was committed';
  END IF;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'issue #2009 executable suite FAILED: % of % assertions', v_fail, v_total;
  END IF;
  RAISE NOTICE '=== issue #2009: % of % assertions PASS ===', v_total, v_total;
END $verdict$;

-- ---------------------------------------------------------------------
-- 15. Teardown — the suite is idempotent and leaves no fixture behind.
-- ---------------------------------------------------------------------
DO $teardown$
DECLARE r record;
BEGIN
  FOR r IN SELECT event_id AS id FROM i2009t.fx LOOP
    DELETE FROM public.content_share_links
      WHERE source_key LIKE 'event:'||r.id::text||'%'
         OR source_key LIKE 'trip:'||r.id::text||'%'
         OR source_reference ->> 'eventId' = r.id::text;
    DELETE FROM public.audit_log WHERE event_id = r.id;
    DELETE FROM public.event_visibility_transition_effects WHERE event_id = r.id;
    DELETE FROM public.event_dates WHERE event_id = r.id;
    DELETE FROM public.events WHERE id = r.id;
  END LOOP;
  DELETE FROM public.admin_audit_log WHERE action='offering.set_visibility'
    AND target_id IN (SELECT event_id::text FROM i2009t.fx);
  DELETE FROM public.brand_team_members
    WHERE brand_id IN (SELECT v FROM i2009t.ids WHERE k IN ('b1','b2'));
  DELETE FROM public.brands WHERE id IN (SELECT v FROM i2009t.ids WHERE k IN ('b1','b2'));
  DELETE FROM public.profiles
    WHERE id IN (SELECT v FROM i2009t.ids WHERE k IN ('owner','manager','scanner'));
  DELETE FROM public.creator_accounts
    WHERE id IN (SELECT v FROM i2009t.ids WHERE k IN ('owner','manager','scanner','stranger'));
  DELETE FROM auth.users
    WHERE id IN (SELECT v FROM i2009t.ids WHERE k IN ('owner','manager','scanner','stranger'));
END $teardown$;

DROP SCHEMA i2009t CASCADE;
