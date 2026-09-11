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

ROLLBACK;
SELECT 'issue_3193_public_search_live_brand_row tester adversarial: PASS' AS result;
