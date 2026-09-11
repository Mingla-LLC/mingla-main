-- Issue #3193 adversarial contract (PostgreSQL 17).
--
-- #3193 changes WHICH ROW the #2986 brand visibility predicate is evaluated
-- against. It must not change the predicate, and nothing that was hidden may
-- become reachable. This suite attacks exactly that boundary: every enumerated
-- path into `draft` is re-asserted against the shipped function, the ordering's
-- key precedence is attacked directly, and the ACL posture is re-checked.
--
-- One transaction + ROLLBACK: no fixture survives.

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
VALUES
  ('31931000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','live-owner-i3193adv@example.test','x',now(),now()),
  ('31931000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','dead-owner-i3193adv@example.test','x',now(),now());
INSERT INTO public.creator_accounts(id,deleted_at) VALUES
  ('31931000-0000-4000-8000-000000000001',NULL),
  ('31931000-0000-4000-8000-000000000002',now()-interval '1 day');

-- D1: every row under the slug is soft-deleted. There is no live row to prefer,
-- so the total order must still land on a tombstone and still yield `draft`.
INSERT INTO public.brands(
  id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,
  created_at,updated_at,deleted_at)
VALUES
  ('31931000-0000-4000-8000-000000000010','31931000-0000-4000-8000-000000000001',
   'Issue 3193 All Dead One','i3193alldead','Soft-deleted brand that must stay off the public web.',
   'popup','none','USD','usd',now()-interval '5 hour',now()-interval '5 hour',now()-interval '4 hour'),
  ('31931000-0000-4000-8000-000000000011','31931000-0000-4000-8000-000000000001',
   'Issue 3193 All Dead Two','i3193alldead','Second soft-deleted brand that must stay off the public web.',
   'popup','none','USD','usd',now()-interval '3 hour',now()-interval '3 hour',now()-interval '2 hour');

-- D2: the brand row is live but its owning creator account is soft-deleted.
INSERT INTO public.brands(
  id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency)
VALUES (
  '31931000-0000-4000-8000-000000000020','31931000-0000-4000-8000-000000000002',
  'Issue 3193 Orphan Brand','i3193deadaccount',
  'A live brand whose owning account was closed; it must not be publicly reachable.',
  'popup','none','USD','usd');

-- D3: an unverified physical brand with nothing published. `brands.kind` is
-- decommissioned as a gating mechanism and no product code writes 'physical'
-- any more, so this disjunct is dead in production -- which is precisely why it
-- needs a fixture. If the column is ever dropped, this assertion is the first
-- thing that fails, in CI, instead of every public Host page 503ing.
INSERT INTO public.brands(
  id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency)
VALUES (
  '31931000-0000-4000-8000-000000000030','31931000-0000-4000-8000-000000000001',
  'Issue 3193 Unclaimed Venue Brand','i3193physical',
  'An unverified physical brand with nothing published, which must stay in draft.',
  'physical','none','USD','usd');

-- The ordering's key precedence, attacked. The tombstone here was created AFTER
-- the live row, so `created_at DESC` on its own would serve the tombstone and the
-- page would 404; only `(deleted_at IS NULL) DESC` ranking FIRST saves it. The
-- tombstone is also inserted FIRST, so the pre-#3193 unordered `LIMIT 1` under a
-- sequential scan reaches it before the live row -- the ambiguity is real, not a
-- fixture that happens to be unambiguous (asserted in A6).
INSERT INTO public.brands(
  id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,
  created_at,updated_at,deleted_at)
VALUES
  ('31931000-0000-4000-8000-000000000041','31931000-0000-4000-8000-000000000001',
   'Issue 3193 Newer Tombstone','i3193newertomb','A soft-deleted brand created after the live one.',
   'popup','none','USD','usd',now()-interval '1 hour',now()-interval '1 hour',now()-interval '30 minute'),
  ('31931000-0000-4000-8000-000000000040','31931000-0000-4000-8000-000000000001',
   'Issue 3193 Older Live Brand','i3193newertomb',
   'The live brand, created before the tombstone that shares its slug, with a real public description.',
   'popup','none','USD','usd',now()-interval '6 hour',now()-interval '6 hour',NULL);

-- A1: D1, D2, D3 and D4 all still reach `draft` with no facts leaked.
DO $a1$
DECLARE r record; v jsonb;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('/b/i3193alldead','D1 all rows soft-deleted'),
      ('/b/i3193deadaccount','D2 owning account soft-deleted'),
      ('/b/i3193physical','D3 unverified physical brand with nothing published'),
      ('/b/i3193nope','D4 unknown slug')
    ) AS t(path,label) LOOP
    SET LOCAL ROLE anon;
    PERFORM set_config('request.jwt.claim.role','anon',true);
    EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO v USING r.path;
    RESET ROLE;
    IF v->>'state'<>'draft' THEN
      RAISE EXCEPTION 'ISSUE-3193 A1 FAIL: % resolved % instead of draft: %',r.label,v->>'state',v;
    END IF;
    IF v->'facts' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'ISSUE-3193 A1 FAIL: % leaked facts on a draft document: %',r.label,v;
    END IF;
  END LOOP;
END
$a1$;

-- A2: the live-row key ranks ahead of recency. A tombstone created after the
-- live brand must not win.
DO $a2$
DECLARE v jsonb;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO v USING '/b/i3193newertomb';
  RESET ROLE;
  IF v->'facts'->>'id'='31931000-0000-4000-8000-000000000041' THEN
    RAISE EXCEPTION 'ISSUE-3193 A2 FAIL: a NEWER tombstone outranked the live row -- the (deleted_at IS NULL) key is not ordered first: %',v;
  END IF;
  IF v->>'state'<>'public_noindex' OR v->'facts'->>'id'<>'31931000-0000-4000-8000-000000000040' THEN
    RAISE EXCEPTION 'ISSUE-3193 A2 FAIL: the live row did not win against a newer tombstone: %',v;
  END IF;
END
$a2$;

-- A3: D5 -- a path whose family does not match the requested kind is `invalid`
-- at the source and `draft` at the resolver. Called directly as service_role,
-- which is the only role holding EXECUTE.
DO $a3$
DECLARE v jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  v := public.public_search_source_facts('/b/i3193newertomb','event');
  RESET ROLE;
  IF v->>'sourceState'<>'invalid' OR v->'facts' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'ISSUE-3193 A3 FAIL: path/kind mismatch is no longer invalid: %',v;
  END IF;
END
$a3$;

-- A4: no widening. Across every brand slug in this fixture set, the resolver's
-- answer equals the #2986 predicate evaluated on the live-preferring pick, and
-- the count of reachable slugs is exactly the two that carry a live row on a
-- live account with a non-physical kind. A predicate change would move this.
DO $a4$
DECLARE r record; v jsonb; v_expected text; v_public int := 0;
BEGIN
  FOR r IN SELECT DISTINCT slug FROM public.brands WHERE slug LIKE 'i3193%' ORDER BY slug LOOP
    SELECT CASE WHEN b.deleted_at IS NULL AND ca.deleted_at IS NULL AND (
             b.kind IS DISTINCT FROM 'physical' OR b.claim_status='verified' OR EXISTS (
               SELECT 1 FROM public.events e WHERE e.brand_id=b.id
                 AND e.status IN ('scheduled','live','ended','cancelled')
                 AND public.pg_offering_visibility_gate(e.visibility,e.deleted_at,'direct')))
           THEN 'public_noindex' ELSE 'draft' END
    INTO v_expected
    FROM public.brands b JOIN public.creator_accounts ca ON ca.id=b.account_id
    WHERE b.slug=r.slug
    ORDER BY (b.deleted_at IS NULL) DESC, b.created_at DESC, b.id
    LIMIT 1;
    EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO v USING '/b/'||r.slug;
    IF v->>'state' IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'ISSUE-3193 A4 FAIL: % resolved % but the #2986 predicate on the live pick says %',
        r.slug,v->>'state',v_expected;
    END IF;
    IF v->>'state'='public_noindex' THEN v_public := v_public+1; END IF;
  END LOOP;
  IF v_public<>1 THEN
    RAISE EXCEPTION 'ISSUE-3193 A4 FAIL: expected exactly one reachable adversarial slug, got %',v_public;
  END IF;
END
$a4$;

-- A5: the ACL posture #2986 shipped is intact. #3193 re-emits the function, so a
-- dropped REVOKE would silently hand anon a direct reader of source facts.
DO $a5$
BEGIN
  IF has_function_privilege('anon','public.public_search_source_facts(text,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.public_search_source_facts(text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'ISSUE-3193 A5 FAIL: public_search_source_facts became directly executable';
  END IF;
  IF NOT has_function_privilege('service_role','public.public_search_source_facts(text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'ISSUE-3193 A5 FAIL: service_role lost EXECUTE';
  END IF;
  IF NOT has_function_privilege('anon','public.resolve_public_search_document(text)','EXECUTE') THEN
    RAISE EXCEPTION 'ISSUE-3193 A5 FAIL: the anonymous resolver lost anon EXECUTE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='public_search_source_facts'
      AND (NOT p.prosecdef OR p.provolatile<>'s'
           OR array_to_string(p.proconfig,',') NOT LIKE '%search_path=public, pg_temp%')) THEN
    RAISE EXCEPTION 'ISSUE-3193 A5 FAIL: SECURITY DEFINER / STABLE / search_path posture drifted';
  END IF;
  IF has_table_privilege('anon','public.public_search_documents','SELECT') THEN
    RAISE EXCEPTION 'ISSUE-3193 A5 FAIL: the #2986 overlay table became anon-readable';
  END IF;
END
$a5$;

-- A6: anti-vacuity, swept across planner configurations. An unordered `LIMIT 1`
-- returns whatever row the chosen plan emits first, so one call proves nothing
-- either way. The shipped total order must return the LIVE row under every
-- configuration, and the pre-#3193 unordered selection must return the TOMBSTONE
-- under at least one -- otherwise this fixture is trivially unambiguous and A2
-- passing would mean nothing.
CREATE FUNCTION pg_temp.i3193adv_plan_cfg(p_cfg text) RETURNS void LANGUAGE plpgsql AS $cfg$
BEGIN
  IF p_cfg='seq-nestloop' THEN
    SET LOCAL enable_indexscan=off; SET LOCAL enable_bitmapscan=off; SET LOCAL enable_indexonlyscan=off;
    SET LOCAL enable_seqscan=on; SET LOCAL enable_hashjoin=off; SET LOCAL enable_mergejoin=off;
  ELSIF p_cfg='seq-hash' THEN
    SET LOCAL enable_indexscan=off; SET LOCAL enable_bitmapscan=off; SET LOCAL enable_indexonlyscan=off;
    SET LOCAL enable_seqscan=on; SET LOCAL enable_hashjoin=on; SET LOCAL enable_mergejoin=off;
  ELSIF p_cfg='seq-merge' THEN
    SET LOCAL enable_indexscan=off; SET LOCAL enable_bitmapscan=off; SET LOCAL enable_indexonlyscan=off;
    SET LOCAL enable_seqscan=on; SET LOCAL enable_hashjoin=off; SET LOCAL enable_mergejoin=on;
  ELSIF p_cfg='index-scans' THEN
    SET LOCAL enable_indexscan=on; SET LOCAL enable_bitmapscan=on; SET LOCAL enable_indexonlyscan=on;
    SET LOCAL enable_seqscan=off; SET LOCAL enable_hashjoin=on; SET LOCAL enable_mergejoin=on;
  ELSIF p_cfg='planner-default' THEN
    RESET enable_indexscan; RESET enable_bitmapscan; RESET enable_indexonlyscan;
    RESET enable_seqscan; RESET enable_hashjoin; RESET enable_mergejoin;
  ELSE
    RAISE EXCEPTION 'ISSUE-3193 unknown plan configuration %',p_cfg;
  END IF;
END
$cfg$;

DO $a6$
DECLARE cfg text; v_unordered uuid; v_ordered uuid; v_tombstone_seen int := 0;
BEGIN
  FOREACH cfg IN ARRAY ARRAY['seq-nestloop','seq-hash','seq-merge','index-scans','planner-default'] LOOP
    PERFORM pg_temp.i3193adv_plan_cfg(cfg);
    EXECUTE $q$
      SELECT b.id FROM public.brands b
      JOIN public.creator_accounts ca ON ca.id=b.account_id
      WHERE b.slug='i3193newertomb' LIMIT 1 $q$ INTO v_unordered;
    EXECUTE $q$
      SELECT b.id FROM public.brands b
      JOIN public.creator_accounts ca ON ca.id=b.account_id
      WHERE b.slug='i3193newertomb'
      ORDER BY (b.deleted_at IS NULL) DESC, b.created_at DESC, b.id LIMIT 1 $q$ INTO v_ordered;
    IF v_ordered<>'31931000-0000-4000-8000-000000000040' THEN
      RAISE EXCEPTION 'ISSUE-3193 A6 FAIL: plan % ordered pick is not the live row: %',cfg,v_ordered;
    END IF;
    IF v_unordered='31931000-0000-4000-8000-000000000041' THEN
      v_tombstone_seen := v_tombstone_seen+1;
    END IF;
  END LOOP;
  PERFORM pg_temp.i3193adv_plan_cfg('planner-default');
  IF v_tombstone_seen=0 THEN
    RAISE EXCEPTION 'ISSUE-3193 A6 FAIL: no planner configuration made the unordered selection read the tombstone, so this fixture does not reproduce the defect';
  END IF;
END
$a6$;

-- =============================================================================
-- Event / trip / experience and venue branches (#3193, OQ-1 folded in).
-- Slugs here use the `k3193` prefix so no earlier loop over `i3193%` can see them.
--
-- The event branch's FIRST sort key is the non-obvious one, and these blocks
-- exist to prove it is load-bearing. `resolve_public_search_document` returns
-- `draft` for a `draft` source BEFORE it consults the ledger, but lets a
-- `missing` source carry `gone`/`redirected` history. So an ordering that simply
-- preferred the live brand would pick a live twin that has no such entity, turn
-- `draft` into `missing`, and let an admin-written ledger row apply to a path
-- whose only real entity sits under a tombstone. The ledger row is written here
-- through the REAL `upsert_public_search_document` RPC as service_role — the
-- `gone` validation trigger checks only the canonical path, so this is reachable.
-- =============================================================================

INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at)
VALUES ('31931000-0000-4000-8000-000000000009','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','k3193-owner@example.test','x',now(),now());
INSERT INTO public.creator_accounts(id) VALUES ('31931000-0000-4000-8000-000000000009');

-- k3193fence: the tombstone carries the ONLY `talk` (ended, past-dated); the
-- recreated live brand has none. Created the way production allows: brand live,
-- event created and already ended, brand soft-deleted, brand recreated.
INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,created_at,updated_at) VALUES
  ('31931000-0000-4000-8000-000000000710','31931000-0000-4000-8000-000000000009','K3193 Fence Old','k3193fence','Deleted brand.','popup','none','USD','usd',now()-interval '3 hour',now()-interval '3 hour'),
  ('31931000-0000-4000-8000-000000000810','31931000-0000-4000-8000-000000000009','K3193 Kind Old','k3193kind','Deleted brand.','popup','none','USD','usd',now()-interval '3 hour',now()-interval '3 hour');
INSERT INTO public.events(id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,is_online,city,theme,published_at,destination_text) VALUES
  ('31931000-0000-4000-8000-000000007100','31931000-0000-4000-8000-000000000710','31931000-0000-4000-8000-000000000009','K3193 Old Talk','Ended.','talk','event','public','ended','UTC',false,'Lagos','{}',now(),NULL),
  ('31931000-0000-4000-8000-000000008100','31931000-0000-4000-8000-000000000810','31931000-0000-4000-8000-000000000009','K3193 Old Trip X','Ended.','x','trip','public','ended','UTC',false,'Lagos','{}',now(),'Lekki');
INSERT INTO public.event_dates(event_id,start_at,end_at,is_master,timezone) VALUES
  ('31931000-0000-4000-8000-000000007100',now()-interval '10 day',now()-interval '10 day'+interval '2 hour',true,'UTC'),
  ('31931000-0000-4000-8000-000000008100',now()-interval '10 day',now()-interval '10 day'+interval '2 hour',true,'UTC');
UPDATE public.brands SET deleted_at=now()-interval '2 hour'
WHERE id IN ('31931000-0000-4000-8000-000000000710','31931000-0000-4000-8000-000000000810');
INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,created_at,updated_at) VALUES
  ('31931000-0000-4000-8000-000000000712','31931000-0000-4000-8000-000000000009','K3193 Fence New','k3193fence','Recreated brand, no talk.','popup','none','USD','usd',now()-interval '1 hour',now()-interval '1 hour'),
  ('31931000-0000-4000-8000-000000000812','31931000-0000-4000-8000-000000000009','K3193 Kind New','k3193kind','Recreated brand.','popup','none','USD','usd',now()-interval '1 hour',now()-interval '1 hour');
-- k3193kind: the recreated brand carries an EVENT `x`, while the only TRIP `x`
-- is the tombstone's. `/t/k3193kind/x` is the path that separates key 1 from key 2.
INSERT INTO public.events(id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,is_online,city,theme,published_at) VALUES
  ('31931000-0000-4000-8000-000000008120','31931000-0000-4000-8000-000000000812','31931000-0000-4000-8000-000000000009','K3193 New Event X','A live event, not a trip.','x','event','public','scheduled','UTC',false,'Lagos','{}',now());

CREATE TEMP TABLE k3193_defs(name text PRIMARY KEY, def text NOT NULL);
CREATE FUNCTION pg_temp.k3193_install_without(p_remove text) RETURNS void LANGUAGE plpgsql AS $inst$
DECLARE v_now text; v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_now
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='public_search_source_facts'
    AND pg_get_function_identity_arguments(p.oid)='p_path text, p_kind text';
  INSERT INTO k3193_defs VALUES ('shipped',v_now) ON CONFLICT (name) DO NOTHING;
  v_new := replace(v_now, p_remove, E'    ORDER BY ');
  IF v_new = v_now THEN
    RAISE EXCEPTION 'ISSUE-3193 control FAIL: the key to remove is absent, so this control proves nothing';
  END IF;
  EXECUTE v_new;
END
$inst$;
CREATE FUNCTION pg_temp.k3193_restore() RETURNS void LANGUAGE plpgsql AS $rst$
BEGIN EXECUTE (SELECT def FROM k3193_defs WHERE name='shipped'); END
$rst$;
CREATE FUNCTION pg_temp.k3193_state(p_path text) RETURNS jsonb LANGUAGE plpgsql AS $st$
DECLARE v jsonb;
BEGIN
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.role','anon',true);
  EXECUTE 'SELECT public.resolve_public_search_document($1)' INTO v USING p_path;
  RESET ROLE;
  RETURN v;
END
$st$;

-- A7: the fail-closed fence holds for an entity that exists only under a
-- tombstone — with no ledger row, and then with an admin-written `gone` row.
DO $a7$
DECLARE v jsonb; v_row jsonb;
BEGIN
  v := pg_temp.k3193_state('/e/k3193fence/talk');
  IF v->>'state'<>'draft' OR v->'facts' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'ISSUE-3193 A7 FAIL: a tombstone-only event is reachable without any ledger row: %',v;
  END IF;
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  v_row := public.upsert_public_search_document('event','31931000-0000-4000-8000-000000007100',
    '/e/k3193fence/talk','gone',NULL,'{}'::jsonb,now(),NULL,NULL,
    'Issue 3193 fence: the old URL of a deleted brand','issue_3193_pg_adversarial',false);
  RESET ROLE;
  IF v_row->>'lifecycle_state'<>'gone' THEN
    RAISE EXCEPTION 'ISSUE-3193 A7 FAIL: the gone overlay was not written, so the fence test is vacuous: %',v_row;
  END IF;
  v := pg_temp.k3193_state('/e/k3193fence/talk');
  IF v->>'state'<>'draft' OR v->'facts' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'ISSUE-3193 A7 FAIL: a ledger overlay applied to an existing-but-ineligible source (expected draft/404): %',v;
  END IF;
END
$a7$;

-- A7b: control — remove keys 1 AND 2, which is exactly the live-brand-first shape
-- #3193's SPEC originally proposed for this branch. The same path must now let
-- the overlay through (`gone`, HTTP 410): proof that the keys are load-bearing
-- and that the fixture really exercises the fence. Then restore.
SELECT pg_temp.k3193_install_without(E'    ORDER BY (e.id IS NOT NULL AND ((p_kind=''event'' AND e.event_type IN (''event'',''rsvp'')) OR e.event_type=p_kind)) DESC,\n      (e.id IS NOT NULL) DESC,\n');
DO $a7b$
DECLARE v jsonb;
BEGIN
  v := pg_temp.k3193_state('/e/k3193fence/talk');
  IF v->>'state'<>'gone' THEN
    RAISE EXCEPTION 'ISSUE-3193 A7b FAIL: without keys 1-2 the overlay should apply, so this fixture does not exercise the fence: %',v;
  END IF;
END
$a7b$;
SELECT pg_temp.k3193_restore();

-- A8: key 1 SPECIFICALLY, not just "prefer any row with an event". The tombstone
-- owns the only TRIP `x`; the live brand owns an EVENT `x`. For `/t/k3193kind/x`
-- both rows carry an event, so key 2 cannot tell them apart — only the kind
-- expression in key 1 keeps the tombstone's trip, and with it the fence.
DO $a8$
DECLARE v jsonb; v_row jsonb;
BEGIN
  SET LOCAL ROLE service_role;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  v_row := public.upsert_public_search_document('trip','31931000-0000-4000-8000-000000008100',
    '/t/k3193kind/x','gone',NULL,'{}'::jsonb,now(),NULL,NULL,
    'Issue 3193 kind key','issue_3193_pg_adversarial',false);
  RESET ROLE;
  IF v_row->>'lifecycle_state'<>'gone' THEN
    RAISE EXCEPTION 'ISSUE-3193 A8 FAIL: overlay not written, test is vacuous: %',v_row;
  END IF;
  v := pg_temp.k3193_state('/t/k3193kind/x');
  IF v->>'state'<>'draft' OR v->'facts' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'ISSUE-3193 A8 FAIL: a live brand''s EVENT displaced the tombstone''s TRIP and lifted the fence: %',v;
  END IF;
END
$a8$;
SELECT pg_temp.k3193_install_without(E'    ORDER BY (e.id IS NOT NULL AND ((p_kind=''event'' AND e.event_type IN (''event'',''rsvp'')) OR e.event_type=p_kind)) DESC,\n');
DO $a8b$
DECLARE v jsonb;
BEGIN
  v := pg_temp.k3193_state('/t/k3193kind/x');
  IF v->>'state'<>'gone' THEN
    RAISE EXCEPTION 'ISSUE-3193 A8b FAIL: without key 1 alone the overlay should apply, so key 1 is not proven load-bearing: %',v;
  END IF;
END
$a8b$;
SELECT pg_temp.k3193_restore();

-- A9: no widening in the event family. A published tombstone twin must never
-- reveal a live entity that is itself hidden.
INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency) VALUES
  ('31931000-0000-4000-8000-000000000912','31931000-0000-4000-8000-000000000009','K3193 PrivTwin','k3193privtwin','One live brand.','popup','none','USD','usd'),
  ('31931000-0000-4000-8000-000000000922','31931000-0000-4000-8000-000000000009','K3193 DeadOnly','k3193deadonly','One live brand.','popup','none','USD','usd');
INSERT INTO public.events(id,brand_id,created_by,title,description,slug,event_type,visibility,status,timezone,is_online,city,theme,published_at,deleted_at) VALUES
  -- published, public, soft-deleted twin with the EARLIER date ...
  ('31931000-0000-4000-8000-000000009100','31931000-0000-4000-8000-000000000912','31931000-0000-4000-8000-000000000009','K3193 Published Twin','Soft-deleted.','y','event','public','scheduled','UTC',false,'Lagos','{}',now(),now()-interval '1 hour'),
  -- ... and the live event, which is an unpublished draft
  ('31931000-0000-4000-8000-000000009120','31931000-0000-4000-8000-000000000912','31931000-0000-4000-8000-000000000009','K3193 Draft Y','Not published.','y','event','draft','draft','UTC',false,'Lagos','{}',NULL,NULL),
  -- the only `z` is soft-deleted
  ('31931000-0000-4000-8000-000000009220','31931000-0000-4000-8000-000000000922','31931000-0000-4000-8000-000000000009','K3193 Deleted Z','Soft-deleted.','z','event','public','scheduled','UTC',false,'Lagos','{}',now(),now()-interval '1 hour');
INSERT INTO public.event_dates(event_id,start_at,end_at,is_master,timezone) VALUES
  ('31931000-0000-4000-8000-000000009100',now()+interval '5 day',now()+interval '5 day 2 hour',true,'UTC'),
  ('31931000-0000-4000-8000-000000009120',now()+interval '30 day',now()+interval '30 day 2 hour',true,'UTC'),
  ('31931000-0000-4000-8000-000000009220',now()+interval '5 day',now()+interval '5 day 2 hour',true,'UTC');

-- A10: no widening in the venue branch. A verified tombstone venue must never
-- lend its verification to the live brand's unverified one.
INSERT INTO public.brands(id,account_id,name,slug,description,kind,claim_status,default_currency,pricing_currency,created_at,updated_at,deleted_at) VALUES
  ('31931000-0000-4000-8000-000000001010','31931000-0000-4000-8000-000000000009','K3193 VUnver Dead','k3193vunver','Deleted.','popup','none','USD','usd',now()-interval '3 hour',now()-interval '3 hour',now()-interval '2 hour'),
  ('31931000-0000-4000-8000-000000001012','31931000-0000-4000-8000-000000000009','K3193 VUnver Live','k3193vunver','Live.','popup','none','USD','usd',now()-interval '1 hour',now()-interval '1 hour',NULL),
  ('31931000-0000-4000-8000-000000001020','31931000-0000-4000-8000-000000000009','K3193 VDead Only','k3193vdead','Deleted, no twin.','popup','none','USD','usd',now()-interval '3 hour',now()-interval '3 hour',now()-interval '2 hour');
INSERT INTO public.venue_listings(id,brand_id,slug,name,city,country_code,lat,lng,venue_category,claim_status,created_at) VALUES
  ('31931000-0000-4000-8000-000000010100','31931000-0000-4000-8000-000000001010','roof','K3193 Verified Dead Roof','Lagos','NG',6.45,3.39,'restaurant','verified',now()-interval '3 hour'),
  ('31931000-0000-4000-8000-000000010120','31931000-0000-4000-8000-000000001012','roof','K3193 Unverified Live Roof','Lagos','NG',6.45,3.39,'restaurant','none',now()-interval '1 hour'),
  ('31931000-0000-4000-8000-000000010200','31931000-0000-4000-8000-000000001020','roof','K3193 Orphan Roof','Lagos','NG',6.45,3.39,'restaurant','verified',now()-interval '3 hour');

DO $a9a10$
DECLARE r record; v jsonb; v_checked int := 0;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('/e/k3193privtwin/y','A9 a live DRAFT event with a published soft-deleted twin'),
      ('/e/k3193deadonly/z','A9 a live brand whose only matching event is soft-deleted'),
      ('/b/k3193vunver/v/roof','A10 an unverified live venue with a verified tombstone twin'),
      ('/b/k3193vdead/v/roof','A10 a verified venue under a tombstone with no live twin')
    ) AS t(path,label) LOOP
    v := pg_temp.k3193_state(r.path);
    IF v->>'state'<>'draft' OR v->'facts' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'ISSUE-3193 % FAIL: resolved % instead of draft: %',r.label,v->>'state',v;
    END IF;
    v_checked := v_checked+1;
  END LOOP;
  IF v_checked<>4 THEN
    RAISE EXCEPTION 'ISSUE-3193 A9/A10 FAIL: checked % paths, expected 4',v_checked;
  END IF;
END
$a9a10$;

-- A11: after every control above restored the shipped body, the function is
-- byte-identical to what the migration shipped — no control leaked a mutation.
DO $a11$
DECLARE v_now text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_now
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='public_search_source_facts'
    AND pg_get_function_identity_arguments(p.oid)='p_path text, p_kind text';
  IF v_now IS DISTINCT FROM (SELECT def FROM k3193_defs WHERE name='shipped') THEN
    RAISE EXCEPTION 'ISSUE-3193 A11 FAIL: a control left the resolver mutated';
  END IF;
END
$a11$;

ROLLBACK;
SELECT 'issue_3193_public_search_live_brand_row tester adversarial: PASS' AS result;
