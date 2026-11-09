\set ON_ERROR_STOP on
-- #4339 §5: the website-description draft store, executable PostgreSQL 17 proof.
--
-- T  the table: RLS on; anon and authenticated can neither read nor write it.
-- C  site_prompt_draft_create: service_role only; validates the 12..1000
--    character body and the hash shape; returns only {status, id}; the id is a
--    random uuid; expires 24 hours after creation; purges expired drafts; caps a
--    visitor at 20 per 24 hours.
-- K  claim_site_prompt_draft: authenticated only (anon refused, no user
--    refused); claims once and binds the draft to the caller; a second claim
--    (same or another user), an expired draft and an unknown id all answer
--    {status:'unavailable'} with no body.
-- Runs after the full migration replay; every fixture rolls back.
BEGIN;

CREATE FUNCTION pg_temp.issue_4339_act(p_user uuid) RETURNS void LANGUAGE sql AS $function$
  SELECT set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true),
         set_config(
           'request.jwt.claims',
           CASE WHEN p_user IS NULL THEN '' ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END,
           true
         );
$function$;
GRANT EXECUTE ON FUNCTION pg_temp.issue_4339_act(uuid) TO anon, authenticated;

INSERT INTO auth.users (id, email) VALUES
  ('43390000-0000-4000-a000-000000000001', 'issue4339-host-a@test.local'),
  ('43390000-0000-4000-a000-000000000002', 'issue4339-host-b@test.local');

CREATE TEMP TABLE issue_4339_ids (label text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON issue_4339_ids TO anon, authenticated;
GRANT SELECT, INSERT ON issue_4339_ids TO service_role;

-- ═══ T: the table ═════════════════════════════════════════════════════════
DO $test$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.site_prompt_drafts'::regclass) THEN
    RAISE EXCEPTION 'T: RLS is off on site_prompt_drafts';
  END IF;
  IF has_table_privilege('anon', 'public.site_prompt_drafts', 'SELECT')
     OR has_table_privilege('anon', 'public.site_prompt_drafts', 'INSERT')
     OR has_table_privilege('authenticated', 'public.site_prompt_drafts', 'SELECT')
     OR has_table_privilege('authenticated', 'public.site_prompt_drafts', 'UPDATE') THEN
    RAISE EXCEPTION 'T: anon or authenticated holds a table privilege';
  END IF;
  IF has_function_privilege('anon', 'public.site_prompt_draft_create(text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.site_prompt_draft_create(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T: the create function is callable outside service_role';
  END IF;
  IF has_function_privilege('anon', 'public.claim_site_prompt_draft(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T: anon may execute the claim';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.claim_site_prompt_draft(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'T: authenticated may not execute the claim';
  END IF;
END
$test$;

-- ═══ C: create (as service_role) ══════════════════════════════════════════
SET LOCAL ROLE service_role;
DO $test$
DECLARE
  v_hash text := repeat('a', 64);
  v_result jsonb;
  v_row public.site_prompt_drafts%ROWTYPE;
  v_case record;
BEGIN
  v_result := public.site_prompt_draft_create('  A rooftop cafe in Lekki with live acoustic sets on Fridays.  ', v_hash);
  IF v_result->>'status' IS DISTINCT FROM 'created' OR (v_result ? 'body')
     OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_result) k) IS DISTINCT FROM ARRAY['id', 'status'] THEN
    RAISE EXCEPTION 'C: create answered %', v_result;
  END IF;
  SELECT * INTO v_row FROM public.site_prompt_drafts WHERE id = (v_result->>'id')::uuid;
  IF v_row.body IS DISTINCT FROM 'A rooftop cafe in Lekki with live acoustic sets on Fridays.' THEN
    RAISE EXCEPTION 'C: body not stored trimmed: %', v_row.body;
  END IF;
  IF v_row.expires_at IS DISTINCT FROM v_row.created_at + interval '24 hours' THEN
    RAISE EXCEPTION 'C: expiry is not 24 hours: % → %', v_row.created_at, v_row.expires_at;
  END IF;
  IF v_row.claimed_by IS NOT NULL OR v_row.claimed_at IS NOT NULL OR v_row.ip_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'C: new draft shape wrong: %', to_jsonb(v_row);
  END IF;
  IF substr(v_row.id::text, 15, 1) <> '4' THEN
    RAISE EXCEPTION 'C: id is not a random (v4) uuid: %', v_row.id;
  END IF;
  INSERT INTO issue_4339_ids VALUES ('a', v_row.id);

  -- Validation: too short, too long, blank, bad hash.
  FOR v_case IN
    SELECT * FROM (VALUES
      ('short', 'Too short', v_hash),
      ('blank', '              ', v_hash),
      ('long', repeat('x', 1001), v_hash),
      ('null', NULL, v_hash),
      ('hash', 'A perfectly fine description of a place.', 'not-a-hash')
    ) AS t(label, body, hash)
  LOOP
    v_result := public.site_prompt_draft_create(v_case.body, v_case.hash);
    IF v_result->>'status' IS DISTINCT FROM 'invalid' THEN
      RAISE EXCEPTION 'C: % case answered %', v_case.label, v_result;
    END IF;
  END LOOP;
  -- Exactly 1000 characters is allowed; no client address is allowed.
  v_result := public.site_prompt_draft_create(repeat('y', 1000), NULL);
  IF v_result->>'status' IS DISTINCT FROM 'created' THEN
    RAISE EXCEPTION 'C: 1000 characters refused: %', v_result;
  END IF;
  INSERT INTO issue_4339_ids VALUES ('b', (v_result->>'id')::uuid);

  -- Per-visitor ceiling: 20 in 24 hours; the 21st is refused, another visitor is not.
  FOR i IN 2..20 LOOP
    v_result := public.site_prompt_draft_create('Visitor flood description ' || i, v_hash);
    IF v_result->>'status' IS DISTINCT FROM 'created' THEN
      RAISE EXCEPTION 'C: draft % of 20 refused: %', i, v_result;
    END IF;
  END LOOP;
  v_result := public.site_prompt_draft_create('The twenty-first description', v_hash);
  IF v_result->>'status' IS DISTINCT FROM 'rate_limited' THEN
    RAISE EXCEPTION 'C: the 21st draft from one visitor answered %', v_result;
  END IF;
  v_result := public.site_prompt_draft_create('Another visitor entirely', repeat('b', 64));
  IF v_result->>'status' IS DISTINCT FROM 'created' THEN
    RAISE EXCEPTION 'C: a second visitor was limited: %', v_result;
  END IF;
END
$test$;
RESET ROLE;

-- An expired draft (and the expired drafts the next create purges).
INSERT INTO public.site_prompt_drafts (id, body, created_at, expires_at) VALUES
  ('43390000-0000-4000-d000-000000000001', 'An expired description of a bar', now() - interval '25 hours', now() - interval '1 hour'),
  ('43390000-0000-4000-d000-000000000002', 'Another expired description here', now() - interval '30 hours', now() - interval '6 hours');
INSERT INTO issue_4339_ids VALUES ('expired', '43390000-0000-4000-d000-000000000001');

-- ═══ K: claim ═════════════════════════════════════════════════════════════
SET LOCAL ROLE anon;
DO $test$
BEGIN
  PERFORM public.claim_site_prompt_draft((SELECT id FROM issue_4339_ids WHERE label = 'a'));
  RAISE EXCEPTION 'K: anon claimed a draft';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END
$test$;
DO $test$
BEGIN
  PERFORM 1 FROM public.site_prompt_drafts;
  RAISE EXCEPTION 'K: anon read the table';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
-- No signed-in user: refused, nothing claimed.
SELECT pg_temp.issue_4339_act(NULL);
DO $test$
DECLARE
  v_message text;
BEGIN
  PERFORM public.claim_site_prompt_draft((SELECT id FROM issue_4339_ids WHERE label = 'a'));
  RAISE EXCEPTION 'K: a claim without a user ran';
EXCEPTION WHEN insufficient_privilege THEN
  GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
  IF v_message <> 'site_prompt_draft_auth_required' THEN RAISE; END IF;
END
$test$;

SELECT pg_temp.issue_4339_act('43390000-0000-4000-a000-000000000001');
DO $test$
DECLARE
  v_result jsonb;
BEGIN
  -- Direct table access stays closed to a signed-in user.
  BEGIN
    PERFORM 1 FROM public.site_prompt_drafts;
    RAISE EXCEPTION 'K: authenticated read the table';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.site_prompt_drafts SET claimed_at = NULL;
    RAISE EXCEPTION 'K: authenticated wrote the table';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  v_result := public.claim_site_prompt_draft((SELECT id FROM issue_4339_ids WHERE label = 'a'));
  IF v_result IS DISTINCT FROM jsonb_build_object(
       'status', 'claimed',
       'body', 'A rooftop cafe in Lekki with live acoustic sets on Fridays.') THEN
    RAISE EXCEPTION 'K: first claim answered %', v_result;
  END IF;

  -- Claim once: the same user again gets nothing.
  v_result := public.claim_site_prompt_draft((SELECT id FROM issue_4339_ids WHERE label = 'a'));
  IF v_result IS DISTINCT FROM '{"status": "unavailable"}'::jsonb THEN
    RAISE EXCEPTION 'K: a repeat claim answered %', v_result;
  END IF;

  -- Expired and unknown look exactly like claimed.
  v_result := public.claim_site_prompt_draft((SELECT id FROM issue_4339_ids WHERE label = 'expired'));
  IF v_result IS DISTINCT FROM '{"status": "unavailable"}'::jsonb THEN
    RAISE EXCEPTION 'K: an expired draft answered %', v_result;
  END IF;
  v_result := public.claim_site_prompt_draft('43390000-0000-4000-d000-0000000000ff');
  IF v_result IS DISTINCT FROM '{"status": "unavailable"}'::jsonb THEN
    RAISE EXCEPTION 'K: an unknown id answered %', v_result;
  END IF;
END
$test$;

-- Another user cannot take a claimed draft, but can claim an unclaimed one.
SELECT pg_temp.issue_4339_act('43390000-0000-4000-a000-000000000002');
DO $test$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.claim_site_prompt_draft((SELECT id FROM issue_4339_ids WHERE label = 'a'));
  IF v_result IS DISTINCT FROM '{"status": "unavailable"}'::jsonb THEN
    RAISE EXCEPTION 'K: user B took user A''s draft: %', v_result;
  END IF;
  v_result := public.claim_site_prompt_draft((SELECT id FROM issue_4339_ids WHERE label = 'b'));
  IF v_result->>'status' IS DISTINCT FROM 'claimed' OR v_result->>'body' IS DISTINCT FROM repeat('y', 1000) THEN
    RAISE EXCEPTION 'K: user B could not claim draft b: %', v_result;
  END IF;
END
$test$;
RESET ROLE;

-- Bindings are on the rows: A owns a, B owns b, the expired draft is untouched.
DO $test$
BEGIN
  IF (SELECT claimed_by FROM public.site_prompt_drafts WHERE id = (SELECT id FROM issue_4339_ids WHERE label = 'a'))
       IS DISTINCT FROM '43390000-0000-4000-a000-000000000001'::uuid
     OR (SELECT claimed_by FROM public.site_prompt_drafts WHERE id = (SELECT id FROM issue_4339_ids WHERE label = 'b'))
       IS DISTINCT FROM '43390000-0000-4000-a000-000000000002'::uuid
     OR (SELECT claimed_at FROM public.site_prompt_drafts WHERE id = '43390000-0000-4000-d000-000000000001') IS NOT NULL THEN
    RAISE EXCEPTION 'K: claim bindings wrong';
  END IF;
END
$test$;

-- The next create purges every expired draft.
SET LOCAL ROLE service_role;
SELECT public.site_prompt_draft_create('A new description that triggers the purge', NULL);
RESET ROLE;
DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM public.site_prompt_drafts WHERE expires_at <= now()) THEN
    RAISE EXCEPTION 'C: expired drafts survived a create';
  END IF;
END
$test$;

ROLLBACK;
\echo 'issue_4339_site_prompt_drafts.implementor.pg17: PASS'
