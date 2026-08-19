-- =====================================================================
-- issue #2353 — executable coverage for format truth and the edit grant
-- that #2089's revoke outran. IMPLEMENTOR HAPPY-PATH SUITE.
--
-- Contract: the BINDING SPEC on issue #2353 (S0..S5, SC-1..SC-18,
-- T-1..T-20), reading on top of the INVESTIGATION comment above it.
--
-- Per #2113, EVERY assertion below EXECUTES a real object against real
-- rows, or reads the live catalogue (pg_proc.proacl). Nothing here
-- asserts on migration text or on pg_get_functiondef output. A
-- source-text assertion satisfies NO criterion in this file.
--
-- T-20 (the S0 apply-order guard) is deliberately NOT in this file and
-- cannot be: it requires applying 20270429002353 to a database where
-- 20270422001972 has NOT been applied, which is a different database
-- than the one this suite runs against. It is executed by the CI lane
-- `.github/workflows/issue-2353-format-truth-and-edit-grant.yml`, which
-- applies the REAL migration file to a virgin database and asserts both
-- the raise and that nothing was committed. T-1..T-19 live here.
--
-- Harness: supabase/postgres:17.4.1.075 with the full migration set
-- applied in timestamp order — which places 20270422001972 before
-- 20270429002353 and therefore satisfies S0. Production differs only in
-- that its applied head is drifted higher, so the orchestrator applies
-- 20270422001972 surgically first; S0 is what makes that order
-- mandatory rather than hopeful.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f <this file>
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

-- ---------------------------------------------------------------------
-- 0. Harness.
-- ---------------------------------------------------------------------
DROP SCHEMA IF EXISTS i2353t CASCADE;

DO $preclean$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.events
            WHERE brand_id IN ('00000000-2353-4000-8000-0000000000b1',
                               '00000000-2353-4000-8000-0000000000b2')
  LOOP
    DELETE FROM public.audit_log     WHERE event_id = r.id;
    DELETE FROM public.event_dates   WHERE event_id = r.id;
    DELETE FROM public.ticket_types  WHERE event_id = r.id;
    UPDATE public.agent_pending_actions SET related_event_id = NULL
      WHERE related_event_id = r.id;
    DELETE FROM public.events        WHERE id = r.id;
  END LOOP;
  DELETE FROM public.agent_operation_receipts
    WHERE operation_id IN (SELECT id FROM public.agent_pending_actions
                            WHERE user_id IN ('00000000-2353-4000-8000-0000000000a1',
                                              '00000000-2353-4000-8000-0000000000a2',
                                              '00000000-2353-4000-8000-0000000000a3',
                                              '00000000-2353-4000-8000-0000000000a4'));
  DELETE FROM public.agent_pending_actions
    WHERE user_id IN ('00000000-2353-4000-8000-0000000000a1',
                      '00000000-2353-4000-8000-0000000000a2',
                      '00000000-2353-4000-8000-0000000000a3',
                      '00000000-2353-4000-8000-0000000000a4');
  DELETE FROM public.agent_conversations
    WHERE user_id IN ('00000000-2353-4000-8000-0000000000a1',
                      '00000000-2353-4000-8000-0000000000a2',
                      '00000000-2353-4000-8000-0000000000a3',
                      '00000000-2353-4000-8000-0000000000a4');
  DELETE FROM public.brand_team_members
    WHERE brand_id IN ('00000000-2353-4000-8000-0000000000b1',
                       '00000000-2353-4000-8000-0000000000b2');
  DELETE FROM public.brands
    WHERE id IN ('00000000-2353-4000-8000-0000000000b1',
                 '00000000-2353-4000-8000-0000000000b2');
  DELETE FROM public.profiles
    WHERE id IN ('00000000-2353-4000-8000-0000000000a1',
                 '00000000-2353-4000-8000-0000000000a2',
                 '00000000-2353-4000-8000-0000000000a3',
                 '00000000-2353-4000-8000-0000000000a4');
  DELETE FROM public.creator_accounts
    WHERE id IN ('00000000-2353-4000-8000-0000000000a1',
                 '00000000-2353-4000-8000-0000000000a2',
                 '00000000-2353-4000-8000-0000000000a3',
                 '00000000-2353-4000-8000-0000000000a4');
  DELETE FROM auth.users
    WHERE id IN ('00000000-2353-4000-8000-0000000000a1',
                 '00000000-2353-4000-8000-0000000000a2',
                 '00000000-2353-4000-8000-0000000000a3',
                 '00000000-2353-4000-8000-0000000000a4');
END $preclean$;

CREATE SCHEMA i2353t;

CREATE TABLE i2353t.result(
  id serial primary key,
  criterion text not null,
  name      text not null,
  outcome   text not null,      -- PASS | FAIL
  detail    text
);

CREATE FUNCTION i2353t.assert(
  p_criterion text, p_name text, p_ok boolean, p_detail text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO i2353t.result(criterion, name, outcome, detail)
  VALUES (p_criterion, p_name, CASE WHEN p_ok THEN 'PASS' ELSE 'FAIL' END, p_detail);
END $$;

-- Become a given signed-in user for the duration of the current transaction.
CREATE FUNCTION i2353t.act_as(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_user IS NULL THEN '{"role":"anon"}'
         ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
END $$;

-- Execute arbitrary SQL as a given database ROLE and a given signed-in user,
-- returning 'OK' or the raised SQLSTATE:SQLERRM. The role is what the ACL sees;
-- the JWT claim is what auth.uid() sees. Both matter and they are not the same
-- thing — that distinction IS defect D1.
CREATE FUNCTION i2353t.exec_as(p_role text, p_user uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM i2353t.act_as(p_user);
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql;
    EXECUTE 'RESET ROLE';
    RETURN 'OK';
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RETURN SQLSTATE || ':' || SQLERRM;
  END;
END $$;

-- Same, but as the current (superuser) role — used where the object under test
-- is a service-role-only leaf reached through a SECURITY DEFINER owner.
CREATE FUNCTION i2353t.try_sql(p_user uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM i2353t.act_as(p_user);
  BEGIN
    EXECUTE p_sql;
    RETURN 'OK';
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ':' || SQLERRM;
  END;
END $$;

-- ---------------------------------------------------------------------
-- 1. Fixtures.
--    brand b1 : owned by `owner`, with `manager` (event_manager) and
--               `scanner` (below rank) accepted on the team.
--    brand b2 : owned by `stranger` — the foreign-brand target.
-- ---------------------------------------------------------------------
CREATE TABLE i2353t.ids(k text primary key, v uuid);
INSERT INTO i2353t.ids VALUES
  ('owner'   ,'00000000-2353-4000-8000-0000000000a1'),
  ('manager' ,'00000000-2353-4000-8000-0000000000a2'),
  ('scanner' ,'00000000-2353-4000-8000-0000000000a3'),
  ('stranger','00000000-2353-4000-8000-0000000000a4'),
  ('b1'      ,'00000000-2353-4000-8000-0000000000b1'),
  ('b2'      ,'00000000-2353-4000-8000-0000000000b2');

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
SELECT v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       k||'@i2353t.test','x',now(),now()
FROM i2353t.ids WHERE k IN ('owner','manager','scanner','stranger')
ON CONFLICT DO NOTHING;

INSERT INTO public.creator_accounts(id)
SELECT v FROM i2353t.ids WHERE k IN ('owner','manager','scanner','stranger')
ON CONFLICT DO NOTHING;

INSERT INTO public.brands(id,account_id,name,slug,claim_status,pricing_currency,default_currency)
VALUES
 ((SELECT v FROM i2353t.ids WHERE k='b1'),(SELECT v FROM i2353t.ids WHERE k='owner'),
  'I2353T Brand One','i2353t-brand-one','verified','usd','USD'),
 ((SELECT v FROM i2353t.ids WHERE k='b2'),(SELECT v FROM i2353t.ids WHERE k='stranger'),
  'I2353T Brand Two','i2353t-brand-two','verified','usd','USD');

INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at)
VALUES
 ((SELECT v FROM i2353t.ids WHERE k='b1'),(SELECT v FROM i2353t.ids WHERE k='manager'),'event_manager',now()),
 ((SELECT v FROM i2353t.ids WHERE k='b1'),(SELECT v FROM i2353t.ids WHERE k='scanner'),'scanner',now());

CREATE TABLE i2353t.fx(key text primary key, event_id uuid);

-- Published (scheduled) business events. `theme.business_event` is the shape
-- the publish RPC leaves behind: the draft namespace stripped, `format`
-- carried through (it is not in the strip list), `requestedVisibility` kept.
DO $fx$
DECLARE r record; v_ev uuid; v_b1 uuid; v_b2 uuid; v_theme jsonb;
BEGIN
  SELECT v INTO v_b1 FROM i2353t.ids WHERE k='b1';
  SELECT v INTO v_b2 FROM i2353t.ids WHERE k='b2';
  FOR r IN
    SELECT * FROM (VALUES
      -- key                  brand  stored format   is_online
      ('read_hybrid'         ,'b1', 'hybrid'   , true ),
      ('read_online'         ,'b1', 'online'   , true ),
      ('read_in_person'      ,'b1', 'in_person', false),
      ('read_nofmt_online'   ,'b1', NULL       , true ),
      ('read_nofmt_offline'  ,'b1', NULL       , false),
      ('dup_hybrid'          ,'b1', 'hybrid'   , true ),
      ('unpub_hybrid'        ,'b1', 'hybrid'   , true ),
      ('write_hybrid'        ,'b1', 'in_person', false),
      ('write_in_person'     ,'b1', 'hybrid'   , true ),
      ('write_online'        ,'b1', 'in_person', false),
      ('write_failclosed'    ,'b1', 'hybrid'   , true ),
      ('roundtrip'           ,'b1', 'hybrid'   , true ),
      ('tax_target'          ,'b1', 'in_person', false),
      ('atomic_target'       ,'b1', 'in_person', false),
      ('ari_live_hybrid'     ,'b1', 'in_person', false),
      ('foreign_target'      ,'b2', 'in_person', false)
    ) AS t(key,brand,fmt,online)
  LOOP
    v_ev := gen_random_uuid();
    v_theme := jsonb_build_object(
      'coverHue', 25,
      'business_event', jsonb_build_object(
        'schemaVersion', 1,
        'requestedVisibility', 'public',
        'clientRevision', 0,
        'settings', jsonb_build_object('requireApproval', false, 'allowTransfers', true))
    );
    IF r.fmt IS NOT NULL THEN
      v_theme := jsonb_set(v_theme, '{business_event,format}', to_jsonb(r.fmt), true);
    END IF;
    INSERT INTO public.events(
      id,brand_id,created_by,title,slug,event_type,visibility,status,timezone,
      published_at,currency,is_online,theme,city,party_types,vibe_tags,music_genres)
      VALUES (v_ev, CASE r.brand WHEN 'b1' THEN v_b1 ELSE v_b2 END,
              CASE r.brand WHEN 'b1' THEN (SELECT v FROM i2353t.ids WHERE k='owner')
                                     ELSE (SELECT v FROM i2353t.ids WHERE k='stranger') END,
              'I2353T '||r.key, 'i2353t-'||replace(r.key,'_','-'),
              'event','public','scheduled','UTC', now(), 'USD', r.online, v_theme,
              'London', ARRAY['club-night']::text[], ARRAY['energetic']::text[],
              ARRAY['pop']::text[]);
    INSERT INTO public.event_dates(event_id,start_at,end_at,is_master,timezone)
      VALUES (v_ev, now()+interval '10 day', now()+interval '10 day 3 hour', true, 'UTC');
    INSERT INTO i2353t.fx VALUES (r.key, v_ev);
  END LOOP;
END $fx$;

-- Draft business events for the publish-visibility guard (S5 / T-17..T-19).
DO $fxd$
DECLARE r record; v_ev uuid; v_b1 uuid; v_theme jsonb;
BEGIN
  SELECT v INTO v_b1 FROM i2353t.ids WHERE k='b1';
  FOR r IN
    SELECT * FROM (VALUES
      -- key                 what theme.business_event.requestedVisibility holds
      ('guard_key_match'    ,'public'),
      ('guard_key_mismatch' ,'private'),
      ('guard_key_absent'   ,'<absent>'),
      ('guard_key_jsonnull' ,'<jsonnull>')
    ) AS t(key,mode)
  LOOP
    v_ev := gen_random_uuid();
    -- Every fixture carries the business_draft NAMESPACE, which is what puts
    -- it inside the trigger's four-way scope test. What differs is the KEY.
    v_theme := jsonb_build_object(
      'coverHue', 25,
      'business_draft', jsonb_build_object(
        'schemaVersion', 1, 'clientRevision', 0,
        'requestedVisibility', 'public',
        'format', 'hybrid'));
    IF r.mode = 'public' OR r.mode = 'private' THEN
      v_theme := jsonb_set(v_theme, '{business_event}',
        jsonb_build_object('requestedVisibility', r.mode), true);
    ELSIF r.mode = '<jsonnull>' THEN
      v_theme := jsonb_set(v_theme, '{business_event}',
        jsonb_build_object('requestedVisibility', NULL::text), true);
    END IF;
    INSERT INTO public.events(
      id,brand_id,created_by,title,slug,event_type,visibility,status,timezone,
      currency,is_online,theme,city)
      VALUES (v_ev, v_b1, (SELECT v FROM i2353t.ids WHERE k='owner'),
              'I2353T '||r.key, 'i2353t-'||replace(r.key,'_','-'),
              'event','draft','draft','UTC','USD', true, v_theme, 'London');
    INSERT INTO public.event_dates(event_id,start_at,end_at,is_master,timezone)
      VALUES (v_ev, now()+interval '20 day', now()+interval '20 day 3 hour', true, 'UTC');
    INSERT INTO i2353t.fx VALUES (r.key, v_ev);
  END LOOP;
END $fxd$;

-- Fixture self-check: a suite that seeded the wrong shape proves nothing.
DO $fxcheck$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM i2353t.fx;
  IF v_n <> 20 THEN RAISE EXCEPTION 'i2353t fixture count is % (expected 20)', v_n; END IF;
  IF (SELECT theme#>>'{business_event,format}' FROM public.events
       WHERE id=(SELECT event_id FROM i2353t.fx WHERE key='read_hybrid')) <> 'hybrid' THEN
    RAISE EXCEPTION 'i2353t fixture read_hybrid did not seed a stored hybrid format';
  END IF;
  IF (SELECT theme#>'{business_event,format}' FROM public.events
       WHERE id=(SELECT event_id FROM i2353t.fx WHERE key='read_nofmt_online')) IS NOT NULL THEN
    RAISE EXCEPTION 'i2353t fixture read_nofmt_online wrongly carries a stored format';
  END IF;
  IF (SELECT jsonb_typeof(theme#>'{business_event,requestedVisibility}') FROM public.events
       WHERE id=(SELECT event_id FROM i2353t.fx WHERE key='guard_key_jsonnull')) <> 'null' THEN
    RAISE EXCEPTION 'i2353t fixture guard_key_jsonnull is not a JSON null';
  END IF;
  IF (SELECT theme#>'{business_event,requestedVisibility}' FROM public.events
       WHERE id=(SELECT event_id FROM i2353t.fx WHERE key='guard_key_absent')) IS NOT NULL THEN
    RAISE EXCEPTION 'i2353t fixture guard_key_absent wrongly carries the key';
  END IF;
END $fxcheck$;

-- ---------------------------------------------------------------------
-- 2. S1 — the grant. T-1, T-4. SC-1.
--    Read from the live catalogue, never from migration text.
-- ---------------------------------------------------------------------
DO $t1$
DECLARE v_tax_acl text; v_when_acl text;
BEGIN
  SELECT array_to_string(p.proacl,' | ') INTO v_tax_acl FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='business_patch_event_taxonomy';
  SELECT array_to_string(p.proacl,' | ') INTO v_when_acl FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='business_patch_event_when';

  PERFORM i2353t.assert('T-1/SC-1','authenticated holds EXECUTE on business_patch_event_taxonomy',
    has_function_privilege('authenticated',
      'public.business_patch_event_taxonomy(uuid,text,text[],text[],text[],numeric,numeric,text,text)',
      'EXECUTE'), v_tax_acl);
  PERFORM i2353t.assert('T-1/SC-1','authenticated holds EXECUTE on business_patch_event_when',
    has_function_privilege('authenticated',
      'public.business_patch_event_when(uuid,jsonb,text,integer)','EXECUTE'), v_when_acl);
  PERFORM i2353t.assert('T-1/SC-1','anon holds EXECUTE on NEITHER patch leaf',
    NOT has_function_privilege('anon',
      'public.business_patch_event_taxonomy(uuid,text,text[],text[],text[],numeric,numeric,text,text)','EXECUTE')
    AND NOT has_function_privilege('anon',
      'public.business_patch_event_when(uuid,jsonb,text,integer)','EXECUTE'),
    v_tax_acl || ' || ' || v_when_acl);
  PERFORM i2353t.assert('T-1','the stray anon=X grant on business_patch_event_when did NOT come back',
    v_when_acl NOT LIKE '%anon=%', v_when_acl);
  -- S1 must not have widened anything else: the demoted leaf stays server-only.
  PERFORM i2353t.assert('T-1/SC-1','business_update_live_event stays revoked from authenticated',
    NOT has_function_privilege('authenticated',
      'public.business_update_live_event(uuid,jsonb,text,integer)','EXECUTE'));
END $t1$;

-- T-2 / T-3 / T-4 — the grant restores REACH, not AUTHORITY. Proven by
-- executing the leaf as a real database role with a real JWT subject.
DO $t2$
DECLARE
  v_ev uuid; v_res text; v_foreign uuid;
BEGIN
  SELECT event_id INTO v_ev FROM i2353t.fx WHERE key='tax_target';
  SELECT event_id INTO v_foreign FROM i2353t.fx WHERE key='foreign_target';

  -- T-2: authenticated + event_manager on the brand -> succeeds.
  v_res := i2353t.exec_as('authenticated',(SELECT v FROM i2353t.ids WHERE k='manager'),
    format($q$SELECT public.business_patch_event_taxonomy(%L::uuid,'Manchester',
      ARRAY['club-night']::text[],ARRAY['energetic']::text[],ARRAY['pop']::text[])$q$, v_ev));
  PERFORM i2353t.assert('T-2/SC-2','authenticated event_manager reaches business_patch_event_taxonomy',
    v_res = 'OK', v_res);
  PERFORM i2353t.assert('T-2/SC-2','...and the call really wrote through',
    (SELECT city FROM public.events WHERE id=v_ev) = 'Manchester',
    (SELECT city FROM public.events WHERE id=v_ev));

  -- T-3: authenticated but BELOW event_manager -> refused INSIDE the body.
  v_res := i2353t.exec_as('authenticated',(SELECT v FROM i2353t.ids WHERE k='scanner'),
    format($q$SELECT public.business_patch_event_taxonomy(%L::uuid,'Leeds',
      ARRAY['club-night']::text[],ARRAY['energetic']::text[],ARRAY['pop']::text[])$q$, v_ev));
  PERFORM i2353t.assert('T-3/SC-2','a scanner is refused with insufficient_event_permission',
    v_res LIKE '%insufficient_event_permission%', v_res);

  -- T-3b: authenticated on a DIFFERENT brand -> refused inside the body too.
  v_res := i2353t.exec_as('authenticated',(SELECT v FROM i2353t.ids WHERE k='manager'),
    format($q$SELECT public.business_patch_event_taxonomy(%L::uuid,'Leeds',
      ARRAY['club-night']::text[],ARRAY['energetic']::text[],ARRAY['pop']::text[])$q$, v_foreign));
  PERFORM i2353t.assert('T-3/SC-2','a manager on another brand is refused',
    v_res LIKE '%insufficient_event_permission%', v_res);

  -- T-4: anon is denied at the ACL, before any body runs.
  v_res := i2353t.exec_as('anon', NULL,
    format($q$SELECT public.business_patch_event_taxonomy(%L::uuid,'Leeds',
      ARRAY['club-night']::text[],ARRAY['energetic']::text[],ARRAY['pop']::text[])$q$, v_ev));
  PERFORM i2353t.assert('T-4/SC-2','anon is denied at the ACL on business_patch_event_taxonomy',
    v_res LIKE '%permission denied%', v_res);
  v_res := i2353t.exec_as('anon', NULL,
    format($q$SELECT public.business_patch_event_when(%L::uuid,'{}'::jsonb,'a reason long enough',1)$q$, v_ev));
  PERFORM i2353t.assert('T-4/SC-2','anon is denied at the ACL on business_patch_event_when',
    v_res LIKE '%permission denied%', v_res);
  -- The city is unchanged by all three refusals — a refusal writes nothing.
  PERFORM i2353t.assert('T-3/T-4','no refused call wrote anything',
    (SELECT city FROM public.events WHERE id=v_ev) = 'Manchester',
    (SELECT city FROM public.events WHERE id=v_ev));
END $t2$;

-- T-5 — the new atomic owner is untouched by S1 and still works for
-- `authenticated`. SC-3.
DO $t5$
DECLARE v_ev uuid; v_res text;
BEGIN
  SELECT event_id INTO v_ev FROM i2353t.fx WHERE key='atomic_target';
  v_res := i2353t.exec_as('authenticated',(SELECT v FROM i2353t.ids WHERE k='manager'),
    format($q$SELECT public.business_update_live_event_atomic(%L::uuid,
      '{"core":{"name":"I2353T atomic renamed"}}'::jsonb,
      'Renaming the event for the atomic-owner regression probe',1)$q$, v_ev));
  PERFORM i2353t.assert('T-5/SC-3','authenticated still reaches business_update_live_event_atomic',
    v_res = 'OK', v_res);
  PERFORM i2353t.assert('T-5/SC-3','...and the atomic edit committed',
    (SELECT title FROM public.events WHERE id=v_ev) = 'I2353T atomic renamed',
    (SELECT title FROM public.events WHERE id=v_ev));
END $t5$;

-- ---------------------------------------------------------------------
-- 3. S2 — the read. T-6, T-7, T-8. SC-4, SC-5.
-- ---------------------------------------------------------------------
DO $t6$
DECLARE r record; v_payload jsonb; v_fmt text;
BEGIN
  PERFORM i2353t.act_as((SELECT v FROM i2353t.ids WHERE k='manager'));
  FOR r IN
    SELECT * FROM (VALUES
      ('read_hybrid'       ,'hybrid'   ,'T-6'),
      ('read_online'       ,'online'   ,'T-7'),
      ('read_in_person'    ,'in_person','T-7'),
      ('read_nofmt_online' ,'online'   ,'T-8'),
      ('read_nofmt_offline','in_person','T-8')
    ) AS t(key,expected,tno)
  LOOP
    v_payload := public.business_event_draft_payload_from_graph(
      (SELECT event_id FROM i2353t.fx WHERE key=r.key));
    v_fmt := v_payload#>>'{theme,business_draft,format}';
    PERFORM i2353t.assert(r.tno||'/SC-4/SC-5',
      'payload_from_graph on '||r.key||' returns '||r.expected,
      v_fmt = r.expected, coalesce(v_fmt,'<null>'));
    IF r.tno = 'T-8' THEN
      PERFORM i2353t.assert('T-8/SC-5',
        'the is_online fallback on '||r.key||' NEVER produces hybrid',
        v_fmt <> 'hybrid', coalesce(v_fmt,'<null>'));
    END IF;
  END LOOP;
END $t6$;

-- ---------------------------------------------------------------------
-- 4. The blast path. T-9 duplicate, T-10 unpublish. SC-6, SC-7.
-- ---------------------------------------------------------------------
DO $t9$
DECLARE v_src uuid; v_res jsonb; v_new uuid; v_row public.events%ROWTYPE;
BEGIN
  SELECT event_id INTO v_src FROM i2353t.fx WHERE key='dup_hybrid';
  PERFORM i2353t.act_as((SELECT v FROM i2353t.ids WHERE k='manager'));
  v_res := public.business_duplicate_event_as_draft(v_src);
  v_new := (v_res#>>'{event,id}')::uuid;
  INSERT INTO i2353t.fx VALUES ('dup_hybrid_copy', v_new);
  SELECT * INTO v_row FROM public.events WHERE id=v_new;
  PERFORM i2353t.assert('T-9/SC-6','duplicating a hybrid event yields a hybrid draft',
    v_row.theme#>>'{business_draft,format}' = 'hybrid',
    coalesce(v_row.theme#>>'{business_draft,format}','<null>'));
  PERFORM i2353t.assert('T-9/SC-6','...and the duplicate keeps is_online true',
    v_row.is_online, v_row.is_online::text);
  PERFORM i2353t.assert('T-9/SC-6','the pre-fix value `online` does not appear in the copy',
    v_row.theme#>>'{business_draft,format}' IS DISTINCT FROM 'online');
END $t9$;

DO $t10$
DECLARE v_ev uuid; v_row public.events%ROWTYPE;
BEGIN
  SELECT event_id INTO v_ev FROM i2353t.fx WHERE key='unpub_hybrid';
  PERFORM i2353t.act_as((SELECT v FROM i2353t.ids WHERE k='manager'));
  PERFORM public.business_unpublish_event_to_draft(v_ev);
  SELECT * INTO v_row FROM public.events WHERE id=v_ev;
  PERFORM i2353t.assert('T-10/SC-7','unpublishing a hybrid event leaves format hybrid',
    v_row.theme#>>'{business_draft,format}' = 'hybrid',
    coalesce(v_row.theme#>>'{business_draft,format}','<null>'));
  PERFORM i2353t.assert('T-10/SC-7','the pre-fix value `online` is absent after the wholesale theme replace',
    v_row.theme#>>'{business_draft,format}' IS DISTINCT FROM 'online');
  PERFORM i2353t.assert('T-10/SC-7','the unpublished row really is a draft again',
    v_row.status='draft' AND v_row.visibility='draft', v_row.status);
END $t10$;

-- ---------------------------------------------------------------------
-- 5. S3 — the write, both halves. T-11, T-12, T-13. SC-8..SC-11.
-- ---------------------------------------------------------------------
DO $t11$
DECLARE r record; v_ev uuid; v_row public.events%ROWTYPE;
BEGIN
  PERFORM i2353t.act_as((SELECT v FROM i2353t.ids WHERE k='manager'));
  FOR r IN
    SELECT * FROM (VALUES
      ('write_hybrid'   ,'hybrid'   , true , 'T-11/SC-8'),
      ('write_in_person','in_person', false, 'T-11/SC-9'),
      ('write_online'   ,'online'   , true , 'T-11/SC-9')
    ) AS t(key,fmt,expect_online,tno)
  LOOP
    SELECT event_id INTO v_ev FROM i2353t.fx WHERE key=r.key;
    PERFORM public.business_update_live_event(
      v_ev, jsonb_build_object('format', r.fmt),
      'Changing the event format for the S3 write probe', 1);
    SELECT * INTO v_row FROM public.events WHERE id=v_ev;
    PERFORM i2353t.assert(r.tno,
      'business_update_live_event('||r.fmt||') PERSISTS theme.business_event.format',
      v_row.theme#>>'{business_event,format}' = r.fmt,
      coalesce(v_row.theme#>>'{business_event,format}','<null>'));
    PERFORM i2353t.assert(r.tno,
      'business_update_live_event('||r.fmt||') projects is_online = '||r.expect_online::text,
      v_row.is_online = r.expect_online, v_row.is_online::text);
  END LOOP;
END $t11$;

-- T-12 — fail closed on every unrecognised shape, on BOTH columns.
-- The revision counter still advances (that is the owner's contract and is
-- not what this test is about), so the assertion is scoped to is_online and
-- theme.business_event.format, exactly as SC-10 specifies.
DO $t12$
DECLARE
  r record; v_ev uuid; v_rev int := 0; v_res text;
  v_fmt0 text; v_online0 boolean; v_row public.events%ROWTYPE;
BEGIN
  SELECT event_id INTO v_ev FROM i2353t.fx WHERE key='write_failclosed';
  SELECT theme#>>'{business_event,format}', is_online INTO v_fmt0, v_online0
    FROM public.events WHERE id=v_ev;
  PERFORM i2353t.act_as((SELECT v FROM i2353t.ids WHERE k='manager'));
  FOR r IN
    SELECT * FROM (VALUES
      ('uppercase'   ,'{"format":"HYBRID"}'),
      ('padded'      ,'{"format":" hybrid "}'),
      ('empty string','{"format":""}'),
      ('json null'   ,'{"format":null}'),
      ('number'      ,'{"format":5}'),
      ('array'       ,'{"format":[]}')
    ) AS t(label,patch)
  LOOP
    -- Read the stored revision fresh rather than counting calls: a REFUSED
    -- call rolls its subtransaction back and does not advance the counter, so
    -- a counted revision would turn one real failure into a cascade of
    -- stale_client_revision and hide which shape actually broke.
    SELECT COALESCE((theme#>>'{business_event,clientRevision}')::integer,0)+1
      INTO v_rev FROM public.events WHERE id=v_ev;
    v_res := i2353t.try_sql((SELECT v FROM i2353t.ids WHERE k='manager'),
      format($q$SELECT public.business_update_live_event(%L::uuid,%L::jsonb,
        'Probing the fail-closed format boundary for issue 2353',%s)$q$,
        v_ev, r.patch, v_rev));
    PERFORM i2353t.assert('T-12/SC-10','the '||r.label||' patch is accepted by the owner (it is not a crash)',
      v_res = 'OK', v_res);
    SELECT * INTO v_row FROM public.events WHERE id=v_ev;
    PERFORM i2353t.assert('T-12/SC-10','the '||r.label||' patch leaves theme.business_event.format unchanged',
      v_row.theme#>>'{business_event,format}' IS NOT DISTINCT FROM v_fmt0,
      coalesce(v_row.theme#>>'{business_event,format}','<null>'));
    PERFORM i2353t.assert('T-12/SC-10','the '||r.label||' patch leaves is_online unchanged',
      v_row.is_online IS NOT DISTINCT FROM v_online0, v_row.is_online::text);
  END LOOP;

  -- ...and a patch with NO format key at all is equally inert on both columns.
  SELECT COALESCE((theme#>>'{business_event,clientRevision}')::integer,0)+1
    INTO v_rev FROM public.events WHERE id=v_ev;
  v_res := i2353t.try_sql((SELECT v FROM i2353t.ids WHERE k='manager'),
    format($q$SELECT public.business_update_live_event(%L::uuid,
      '{"name":"I2353T untouched"}'::jsonb,
      'A core patch that carries no format key at all here',%s)$q$, v_ev, v_rev));
  PERFORM i2353t.assert('T-12/SC-10','a core patch with no format key is accepted',
    v_res = 'OK', v_res);
  SELECT * INTO v_row FROM public.events WHERE id=v_ev;
  PERFORM i2353t.assert('T-12/SC-10','a patch with no format key leaves both columns unchanged',
    v_row.theme#>>'{business_event,format}' IS NOT DISTINCT FROM v_fmt0
    AND v_row.is_online IS NOT DISTINCT FROM v_online0,
    coalesce(v_row.theme#>>'{business_event,format}','<null>')||'/'||v_row.is_online::text);
END $t12$;

-- T-13 — the round trip. This is the test that separates S3(b) from S3(a):
-- with S3(b) deleted, is_online still flips (S3(a) alone) but the stored
-- format goes stale, and the unpublish reinstalls the STALE value.
DO $t13$
DECLARE v_ev uuid; v_row public.events%ROWTYPE;
BEGIN
  SELECT event_id INTO v_ev FROM i2353t.fx WHERE key='roundtrip';
  PERFORM i2353t.act_as((SELECT v FROM i2353t.ids WHERE k='manager'));

  -- The event starts published and hybrid.
  SELECT * INTO v_row FROM public.events WHERE id=v_ev;
  PERFORM i2353t.assert('T-13/SC-11','round trip starts on a published hybrid event',
    v_row.theme#>>'{business_event,format}' = 'hybrid' AND v_row.is_online,
    coalesce(v_row.theme#>>'{business_event,format}','<null>'));

  -- Hop 1 — a live edit to in_person.
  PERFORM public.business_update_live_event(v_ev, '{"format":"in_person"}'::jsonb,
    'Moving the round-trip event from hybrid to in person', 1);
  SELECT * INTO v_row FROM public.events WHERE id=v_ev;
  PERFORM i2353t.assert('T-13/SC-11','after the live edit the STORED format is in_person',
    v_row.theme#>>'{business_event,format}' = 'in_person',
    coalesce(v_row.theme#>>'{business_event,format}','<null>'));
  PERFORM i2353t.assert('T-13/SC-11','after the live edit is_online is false',
    NOT v_row.is_online, v_row.is_online::text);

  -- Hop 2 — unpublish. The theme is REPLACED wholesale with the read payload.
  PERFORM public.business_unpublish_event_to_draft(v_ev);
  SELECT * INTO v_row FROM public.events WHERE id=v_ev;
  PERFORM i2353t.assert('T-13/SC-11','the unpublished draft reads in_person, not the stale hybrid',
    v_row.theme#>>'{business_event,format}' IS NULL
    AND v_row.theme#>>'{business_draft,format}' = 'in_person',
    coalesce(v_row.theme#>>'{business_draft,format}','<null>'));
  PERFORM i2353t.assert('T-13/SC-11','the unpublished draft keeps is_online false',
    NOT v_row.is_online, v_row.is_online::text);
  PERFORM i2353t.assert('T-13/SC-11','the pre-edit value hybrid did not survive anywhere in the theme',
    v_row.theme#>>'{business_draft,format}' IS DISTINCT FROM 'hybrid');
END $t13$;

-- ---------------------------------------------------------------------
-- 6. S4 — Ari. T-14, T-15, T-16. SC-12, SC-13, SC-14.
-- ---------------------------------------------------------------------
CREATE FUNCTION i2353t.ari(p_user uuid, p_tool text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_op uuid := gen_random_uuid(); v_conv uuid;
BEGIN
  SELECT id INTO v_conv FROM public.agent_conversations WHERE user_id = p_user LIMIT 1;
  IF v_conv IS NULL THEN
    v_conv := gen_random_uuid();
    INSERT INTO public.agent_conversations(id,user_id) VALUES (v_conv,p_user);
  END IF;
  INSERT INTO public.agent_pending_actions(
    id,user_id,conversation_id,tool_name,tool_args,status,source,
    server_proposed_at,execution_attested_at)
  VALUES (v_op,p_user,v_conv,p_tool,p_args,'executing','ari',now(),now());
  PERFORM i2353t.act_as(p_user);
  RETURN public.ari_execute_event_operation(v_op,p_tool,p_args);
END $$;

DO $t14$
DECLARE
  v_manager uuid; v_b1 uuid; v_args jsonb; v_res jsonb; v_ev uuid;
  v_row public.events%ROWTYPE;
BEGIN
  SELECT v INTO v_manager FROM i2353t.ids WHERE k='manager';
  SELECT v INTO v_b1 FROM i2353t.ids WHERE k='b1';

  -- T-14 / SC-12 — an explicit hybrid create.
  v_args := jsonb_build_object(
    'brand_id', v_b1::text, 'title','I2353T ari hybrid',
    'visibility','public','timezone','UTC','when_mode','single',
    'start_at', to_char(now()+interval '30 day','YYYY-MM-DD"T"HH24:MI:SSOF'),
    'currency','USD','city','London','format','hybrid');
  v_res := i2353t.ari(v_manager,'create_event',v_args);
  v_ev := (v_res#>>'{event,id}')::uuid;
  INSERT INTO i2353t.fx VALUES ('ari_hybrid', v_ev);
  SELECT * INTO v_row FROM public.events WHERE id=v_ev;
  PERFORM i2353t.assert('T-14/SC-12','Ari create_event with format=hybrid stores hybrid',
    v_row.theme#>>'{business_draft,format}' = 'hybrid',
    coalesce(v_row.theme#>>'{business_draft,format}','<null>'));
  PERFORM i2353t.assert('T-14/SC-12','...and its is_online agrees with hybrid (true)',
    v_row.is_online, v_row.is_online::text);

  -- T-15 / SC-13 — legacy args only. Must reproduce the pre-fix output.
  v_args := jsonb_build_object(
    'brand_id', v_b1::text, 'title','I2353T ari legacy online',
    'visibility','public','timezone','UTC','when_mode','single',
    'start_at', to_char(now()+interval '31 day','YYYY-MM-DD"T"HH24:MI:SSOF'),
    'currency','USD','city','London','is_online', true);
  v_res := i2353t.ari(v_manager,'create_event',v_args);
  v_ev := (v_res#>>'{event,id}')::uuid;
  INSERT INTO i2353t.fx VALUES ('ari_legacy_online', v_ev);
  SELECT * INTO v_row FROM public.events WHERE id=v_ev;
  PERFORM i2353t.assert('T-15/SC-13','Ari legacy is_online=true still yields online',
    v_row.theme#>>'{business_draft,format}' = 'online',
    coalesce(v_row.theme#>>'{business_draft,format}','<null>'));
  PERFORM i2353t.assert('T-15/SC-13','...and is_online stays true',
    v_row.is_online, v_row.is_online::text);

  v_args := jsonb_build_object(
    'brand_id', v_b1::text, 'title','I2353T ari legacy absent',
    'visibility','public','timezone','UTC','when_mode','single',
    'start_at', to_char(now()+interval '32 day','YYYY-MM-DD"T"HH24:MI:SSOF'),
    'currency','USD','city','London');
  v_res := i2353t.ari(v_manager,'create_event',v_args);
  v_ev := (v_res#>>'{event,id}')::uuid;
  INSERT INTO i2353t.fx VALUES ('ari_legacy_absent', v_ev);
  SELECT * INTO v_row FROM public.events WHERE id=v_ev;
  PERFORM i2353t.assert('T-15/SC-13','Ari with no is_online and no format yields in_person',
    v_row.theme#>>'{business_draft,format}' = 'in_person',
    coalesce(v_row.theme#>>'{business_draft,format}','<null>'));
  PERFORM i2353t.assert('T-15/SC-13','...and is_online stays false',
    NOT v_row.is_online, v_row.is_online::text);

  -- An unrecognised format falls back to the legacy derivation, never hybrid.
  v_args := jsonb_build_object(
    'brand_id', v_b1::text, 'title','I2353T ari bogus format',
    'visibility','public','timezone','UTC','when_mode','single',
    'start_at', to_char(now()+interval '33 day','YYYY-MM-DD"T"HH24:MI:SSOF'),
    'currency','USD','city','London','format','HYBRID','is_online', true);
  v_res := i2353t.ari(v_manager,'create_event',v_args);
  v_ev := (v_res#>>'{event,id}')::uuid;
  INSERT INTO i2353t.fx VALUES ('ari_bogus_format', v_ev);
  SELECT * INTO v_row FROM public.events WHERE id=v_ev;
  PERFORM i2353t.assert('T-15/SC-13','an unrecognised Ari format falls back to the is_online derivation',
    v_row.theme#>>'{business_draft,format}' = 'online',
    coalesce(v_row.theme#>>'{business_draft,format}','<null>'));
END $t14$;

-- T-16 / SC-14 — the live branch. Composes S4(c) with S3, so it proves the
-- two together and neither alone.
DO $t16$
DECLARE v_ev uuid; v_manager uuid; v_row public.events%ROWTYPE;
BEGIN
  SELECT event_id INTO v_ev FROM i2353t.fx WHERE key='ari_live_hybrid';
  SELECT v INTO v_manager FROM i2353t.ids WHERE k='manager';
  PERFORM i2353t.ari(v_manager,'update_event', jsonb_build_object(
    'event_id', v_ev::text, 'format','hybrid',
    'reason','Ari is switching this live event to hybrid now',
    'client_revision', 1));
  SELECT * INTO v_row FROM public.events WHERE id=v_ev;
  PERFORM i2353t.assert('T-16/SC-14','Ari update_event(format=hybrid) persists theme.business_event.format',
    v_row.theme#>>'{business_event,format}' = 'hybrid',
    coalesce(v_row.theme#>>'{business_event,format}','<null>'));
  PERFORM i2353t.assert('T-16/SC-14','...and is_online becomes true',
    v_row.is_online, v_row.is_online::text);
END $t16$;

-- ---------------------------------------------------------------------
-- 7. S5 — the publish-visibility guard. T-17, T-18, T-19. SC-15..SC-17.
--    Driven by a real draft -> scheduled UPDATE, which is the statement
--    class the trigger binds to.
-- ---------------------------------------------------------------------
DO $t17$
DECLARE r record; v_ev uuid; v_res text; v_row public.events%ROWTYPE;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- key                 target visibility  expect     T#
      ('guard_key_match'    ,'public' ,'ok'    ,'T-17c'),
      ('guard_key_mismatch' ,'public' ,'raise' ,'T-17'),
      ('guard_key_absent'   ,'public' ,'ok'    ,'T-18'),
      ('guard_key_jsonnull' ,'public' ,'raise' ,'T-19')
    ) AS t(key,vis,expect,tno)
  LOOP
    SELECT event_id INTO v_ev FROM i2353t.fx WHERE key=r.key;
    v_res := i2353t.try_sql((SELECT v FROM i2353t.ids WHERE k='owner'),
      format($q$UPDATE public.events SET status='scheduled', visibility=%L,
        published_at=now() WHERE id=%L::uuid$q$, r.vis, v_ev));
    SELECT * INTO v_row FROM public.events WHERE id=v_ev;
    IF r.expect = 'ok' THEN
      PERFORM i2353t.assert(r.tno||'/SC-15/SC-16','publishing '||r.key||' succeeds',
        v_res = 'OK', v_res);
      PERFORM i2353t.assert(r.tno||'/SC-15/SC-16','...and the row really is scheduled',
        v_row.status = 'scheduled', v_row.status);
    ELSE
      PERFORM i2353t.assert(r.tno||'/SC-15/SC-17','publishing '||r.key||' raises event_visibility_invalid',
        v_res LIKE '%event_visibility_invalid%', v_res);
      PERFORM i2353t.assert(r.tno||'/SC-15/SC-17','...and the row stayed a draft',
        v_row.status = 'draft', v_row.status);
    END IF;
  END LOOP;
END $t17$;

-- ---------------------------------------------------------------------
-- 8. Verdict. Non-vacuity: the suite must have run a minimum number of
--    assertions, must have observed at least one hybrid value that
--    SURVIVED a real mutation, and must have observed at least one real
--    refusal — or it proves nothing.
-- ---------------------------------------------------------------------
DO $verdict$
DECLARE v_fail int; v_total int; r record; v_hybrid int; v_drafts int;
BEGIN
  SELECT count(*) FILTER (WHERE outcome='FAIL'), count(*) INTO v_fail, v_total FROM i2353t.result;
  FOR r IN SELECT * FROM i2353t.result ORDER BY id LOOP
    RAISE NOTICE '% [%] % %', r.outcome, r.criterion, r.name,
      CASE WHEN r.detail IS NULL THEN '' ELSE '(' || r.detail || ')' END;
  END LOOP;
  IF v_total < 50 THEN
    RAISE EXCEPTION 'issue #2353 suite is vacuous: only % assertions ran', v_total;
  END IF;
  SELECT count(*) INTO v_hybrid FROM public.events
   WHERE id IN (SELECT event_id FROM i2353t.fx)
     AND COALESCE(theme#>>'{business_event,format}',theme#>>'{business_draft,format}') = 'hybrid';
  IF v_hybrid = 0 THEN
    RAISE EXCEPTION 'issue #2353 suite is vacuous: not one hybrid value survived a real mutation';
  END IF;
  SELECT count(*) INTO v_drafts FROM public.events
   WHERE id IN (SELECT event_id FROM i2353t.fx WHERE key IN ('guard_key_mismatch','guard_key_jsonnull'))
     AND status='draft';
  IF v_drafts <> 2 THEN
    RAISE EXCEPTION 'issue #2353 suite is vacuous: the guard refused nothing';
  END IF;
  IF v_fail > 0 THEN
    RAISE EXCEPTION 'issue #2353 executable suite FAILED: % of % assertions', v_fail, v_total;
  END IF;
  RAISE NOTICE '=== issue #2353: % of % assertions PASS ===', v_total, v_total;
END $verdict$;

-- ---------------------------------------------------------------------
-- 9. Teardown — the suite is idempotent and leaves no fixture behind.
-- ---------------------------------------------------------------------
DO $teardown$
DECLARE r record;
BEGIN
  DELETE FROM public.agent_operation_receipts
    WHERE operation_id IN (SELECT id FROM public.agent_pending_actions
                            WHERE user_id IN (SELECT v FROM i2353t.ids
                                               WHERE k IN ('owner','manager','scanner','stranger')));
  DELETE FROM public.agent_pending_actions
    WHERE user_id IN (SELECT v FROM i2353t.ids WHERE k IN ('owner','manager','scanner','stranger'));
  DELETE FROM public.agent_conversations
    WHERE user_id IN (SELECT v FROM i2353t.ids WHERE k IN ('owner','manager','scanner','stranger'));
  FOR r IN SELECT event_id AS id FROM i2353t.fx LOOP
    DELETE FROM public.audit_log    WHERE event_id = r.id;
    DELETE FROM public.event_dates  WHERE event_id = r.id;
    DELETE FROM public.ticket_types WHERE event_id = r.id;
    DELETE FROM public.events       WHERE id = r.id;
  END LOOP;
  DELETE FROM public.brand_team_members
    WHERE brand_id IN (SELECT v FROM i2353t.ids WHERE k IN ('b1','b2'));
  DELETE FROM public.brands WHERE id IN (SELECT v FROM i2353t.ids WHERE k IN ('b1','b2'));
  DELETE FROM public.profiles
    WHERE id IN (SELECT v FROM i2353t.ids WHERE k IN ('owner','manager','scanner','stranger'));
  DELETE FROM public.creator_accounts
    WHERE id IN (SELECT v FROM i2353t.ids WHERE k IN ('owner','manager','scanner','stranger'));
  DELETE FROM auth.users
    WHERE id IN (SELECT v FROM i2353t.ids WHERE k IN ('owner','manager','scanner','stranger'));
END $teardown$;

DROP SCHEMA i2353t CASCADE;
