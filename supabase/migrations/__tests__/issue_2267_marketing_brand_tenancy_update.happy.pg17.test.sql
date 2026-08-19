-- issue #2267 — `brand_id` is constrained on UPDATE the same way it is on
-- INSERT, on both `marketing_templates` and `marketing_campaigns`.
--
-- Run against a database that has the FULL migration chain applied (see
-- .github/workflows/issue-2267-marketing-tenancy.yml). Every case seeds its
-- fixtures as the migration superuser inside its own transaction and ROLLBACKs,
-- so nothing survives.
--
-- WHY THE ROLE SWITCH IS THE WHOLE TEST. RLS does not apply to the table owner,
-- so a case that seeds and asserts as superuser proves nothing about a policy
-- (the exact gap that let ORCH-1116 ship an RLS false-positive green). Each
-- assertion below runs the UPDATE under `SET LOCAL ROLE authenticated` with a
-- `request.jwt.claims` subject, which is what `auth.uid()` reads.
--
-- fails-on-revert: with the #2267 migration removed, the UPDATE policies do not
-- mention `brand_id` (templates) or let authorship alone satisfy the check
-- (campaigns), so G-02 and G-04 succeed where they must fail, and G-00's
-- catalogue assertions fail outright.
--
-- G-00  catalogue: both WITH CHECK clauses constrain brand_id; both USING
--       clauses are UNCHANGED (over-tightening USING is a defect too)
-- G-01  templates — a legitimate owner can still update their own row  (positive)
-- G-01b templates — an owner can still file a row under a brand they hold
-- G-02  templates — the resulting row cannot carry an unheld brand_id
-- G-03  campaigns — a legitimate owner can still update their own row  (positive)
-- G-03b campaigns — a team event_manager can still update a colleague's row
-- G-04  campaigns — the resulting row cannot carry an unheld brand_id
-- G-05  neither table lost DELETE or SELECT for its owner

\set ON_ERROR_STOP on

-- ─── G-00 — catalogue shape ────────────────────────────────────────────────
DO $g00$
DECLARE
  v_using text;
  v_check text;
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
    INTO v_using, v_check
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'marketing_templates'
     AND p.polname = 'marketing_templates_update';

  IF v_check IS NULL OR v_check NOT LIKE '%mkt_brand_min_rank%' THEN
    RAISE EXCEPTION 'G-00 FAIL: marketing_templates_update WITH CHECK does not constrain brand_id (got: %)', v_check;
  END IF;
  IF v_using IS NULL OR v_using LIKE '%mkt_brand_min_rank%' THEN
    RAISE EXCEPTION 'G-00 FAIL: marketing_templates_update USING changed — a rank requirement there locks an owner out of a row they already hold (got: %)', v_using;
  END IF;

  SELECT pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
    INTO v_using, v_check
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'marketing_campaigns'
     AND p.polname = 'marketing_campaigns_update';

  IF v_check IS NULL OR v_check NOT LIKE '%mkt_brand_min_rank%' OR v_check LIKE '%account_id%' THEN
    RAISE EXCEPTION 'G-00 FAIL: marketing_campaigns_update WITH CHECK does not require brand rank on the resulting row (got: %)', v_check;
  END IF;
  IF v_using IS NULL OR v_using NOT LIKE '%account_id = auth.uid()%' OR v_using NOT LIKE '%mkt_brand_min_rank%' THEN
    RAISE EXCEPTION 'G-00 FAIL: marketing_campaigns_update USING changed — team editing depends on it (got: %)', v_using;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'mkt_brand_min_rank' AND pronamespace = 'public'::regnamespace AND prosecdef
  ) THEN
    RAISE EXCEPTION 'G-00 FAIL: public.mkt_brand_min_rank became SECURITY DEFINER — every clause above would stop evaluating in the caller''s auth context';
  END IF;

  RAISE NOTICE 'G-00 PASS: both UPDATE policies constrain brand_id; both USING clauses unchanged';
END
$g00$;

-- ─── G-01 / G-01b / G-02 — marketing_templates ─────────────────────────────
BEGIN;
DO $g01$
DECLARE
  v_owner    uuid := gen_random_uuid();
  v_mine     uuid := gen_random_uuid();  -- brand the actor owns
  v_theirs   uuid := gen_random_uuid();  -- brand the actor has no rank on
  v_other    uuid := gen_random_uuid();  -- that brand's owner
  v_template uuid := gen_random_uuid();
  v_rows     integer;
  v_brand    uuid;
  v_name     text;
  v_denied   boolean := false;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_owner), (v_other);
  INSERT INTO public.creator_accounts (id) VALUES (v_owner), (v_other);
  INSERT INTO public.brands (id, account_id, name, slug)
  VALUES (v_mine,   v_owner, 'issue 2267 mine',   'issue-2267-mine'),
         (v_theirs, v_other, 'issue 2267 theirs', 'issue-2267-theirs');

  INSERT INTO public.marketing_templates
    (id, account_id, brand_id, name, channel, body_template, is_starter_pack)
  VALUES (v_template, v_owner, NULL, 'Draft', 'email', 'Hi {first_name}', false);

  -- Set the subject BEFORE dropping to `authenticated`. `auth.uid()` reads
  -- `request.jwt.claim.sub` on supabase/postgres and `request.jwt.claims`
  -- on the hosted platform, so both are set and this test says the same
  -- thing on either.
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- G-01 — the owner can still edit their own row. Guards against the
  -- over-tightening that would be the obvious way to close this gap.
  UPDATE public.marketing_templates SET name = 'Draft renamed' WHERE id = v_template;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'G-01 FAIL: the row''s own author could not rename it (% rows). The UPDATE policy is over-tightened.', v_rows;
  END IF;

  -- G-01b — and can file it under a brand they actually hold.
  UPDATE public.marketing_templates SET brand_id = v_mine WHERE id = v_template;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'G-01b FAIL: the author could not file their template under a brand they own (% rows).', v_rows;
  END IF;

  -- G-02 — THE CASE. The resulting row may not carry a brand the actor holds
  -- no rank on. `mkt_brand_min_rank` fails closed, so the policy rejects the
  -- statement rather than silently writing zero rows.
  BEGIN
    UPDATE public.marketing_templates SET brand_id = v_theirs WHERE id = v_template;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      RAISE EXCEPTION 'G-02 FAIL: % row(s) moved to a brand the actor holds no rank on. The UPDATE policy does not constrain brand_id.', v_rows;
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;

  RESET ROLE;

  SELECT brand_id, name INTO v_brand, v_name
    FROM public.marketing_templates WHERE id = v_template;
  IF v_brand IS DISTINCT FROM v_mine THEN
    RAISE EXCEPTION 'G-02 FAIL: brand_id is now % — the row left the actor''s own brand.', v_brand;
  END IF;
  IF v_name <> 'Draft renamed' THEN
    RAISE EXCEPTION 'G-01 FAIL: the legitimate rename did not persist (name = %).', v_name;
  END IF;

  RAISE NOTICE 'G-01/G-01b/G-02 PASS: templates — owner edits work, unheld brand_id refused (row-level denial: %)', v_denied;
END
$g01$;
ROLLBACK;

-- ─── G-03 / G-03b / G-04 — marketing_campaigns ─────────────────────────────
BEGIN;
DO $g03$
DECLARE
  v_owner    uuid := gen_random_uuid();
  v_manager  uuid := gen_random_uuid();  -- event_manager on the actor's brand
  v_other    uuid := gen_random_uuid();
  v_mine     uuid := gen_random_uuid();
  v_theirs   uuid := gen_random_uuid();
  v_audience uuid := gen_random_uuid();
  v_campaign uuid := gen_random_uuid();
  v_rows     integer;
  v_brand    uuid;
  v_name     text;
  v_denied   boolean := false;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_owner), (v_manager), (v_other);
  INSERT INTO public.creator_accounts (id) VALUES (v_owner), (v_manager), (v_other);
  INSERT INTO public.brands (id, account_id, name, slug)
  VALUES (v_mine,   v_owner, 'issue 2267 c-mine',   'issue-2267-c-mine'),
         (v_theirs, v_other, 'issue 2267 c-theirs', 'issue-2267-c-theirs');
  INSERT INTO public.brand_team_members (brand_id, user_id, role, accepted_at)
  VALUES (v_mine, v_manager, 'event_manager', clock_timestamp());

  INSERT INTO public.marketing_audiences
    (id, account_id, brand_id, name, query_definition, is_system_generated)
  VALUES (v_audience, v_owner, v_mine, 'Everyone',
          jsonb_build_object('kind', 'all_brand_people', 'brand_id', v_mine::text), true);
  INSERT INTO public.marketing_campaigns
    (id, account_id, brand_id, audience_id, name, channel, channel_payload, status)
  VALUES (v_campaign, v_owner, v_mine, v_audience, 'Launch', 'email',
          '{"kind":"email","subject":"Hi","body_html":"Hi","body_text":"Hi"}'::jsonb, 'draft');

  -- Set the subject BEFORE dropping to `authenticated`. `auth.uid()` reads
  -- `request.jwt.claim.sub` on supabase/postgres and `request.jwt.claims`
  -- on the hosted platform, so both are set and this test says the same
  -- thing on either.
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- G-03 — the author can still edit their own campaign.
  UPDATE public.marketing_campaigns SET name = 'Launch renamed' WHERE id = v_campaign;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'G-03 FAIL: the campaign''s own author could not rename it (% rows). The UPDATE policy is over-tightened.', v_rows;
  END IF;

  -- G-04 — THE CASE. The resulting row may not carry an unheld brand.
  BEGIN
    UPDATE public.marketing_campaigns SET brand_id = v_theirs WHERE id = v_campaign;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      RAISE EXCEPTION 'G-04 FAIL: % row(s) moved to a brand the actor holds no rank on. The UPDATE policy does not constrain brand_id.', v_rows;
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;

  RESET ROLE;

  -- G-03b — a team event_manager who did NOT author the row can still edit it.
  -- This is the behaviour `USING` carries, and it must survive the tightening.
  -- Set the subject BEFORE dropping to `authenticated`. `auth.uid()` reads
  -- `request.jwt.claim.sub` on supabase/postgres and `request.jwt.claims`
  -- on the hosted platform, so both are set and this test says the same
  -- thing on either.
  PERFORM set_config('request.jwt.claim.sub', v_manager::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_manager::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.marketing_campaigns SET name = 'Launch, edited by a teammate'
   WHERE id = v_campaign;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'G-03b FAIL: an event_manager on the brand could not edit a colleague''s campaign (% rows). Team editing regressed.', v_rows;
  END IF;
  RESET ROLE;

  SELECT brand_id, name INTO v_brand, v_name
    FROM public.marketing_campaigns WHERE id = v_campaign;
  IF v_brand IS DISTINCT FROM v_mine THEN
    RAISE EXCEPTION 'G-04 FAIL: brand_id is now % — the campaign left the actor''s own brand.', v_brand;
  END IF;
  IF v_name <> 'Launch, edited by a teammate' THEN
    RAISE EXCEPTION 'G-03/G-03b FAIL: legitimate edits did not persist (name = %).', v_name;
  END IF;

  RAISE NOTICE 'G-03/G-03b/G-04 PASS: campaigns — author and teammate edits work, unheld brand_id refused (row-level denial: %)', v_denied;
END
$g03$;
ROLLBACK;

-- ─── G-05 — nothing else on these tables was narrowed ──────────────────────
BEGIN;
DO $g05$
DECLARE
  v_owner    uuid := gen_random_uuid();
  v_brand    uuid := gen_random_uuid();
  v_template uuid := gen_random_uuid();
  v_seen     integer;
  v_rows     integer;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_owner);
  INSERT INTO public.creator_accounts (id) VALUES (v_owner);
  INSERT INTO public.brands (id, account_id, name, slug)
  VALUES (v_brand, v_owner, 'issue 2267 g05', 'issue-2267-g05');
  INSERT INTO public.marketing_templates
    (id, account_id, brand_id, name, channel, body_template, is_starter_pack)
  VALUES (v_template, v_owner, v_brand, 'Keeper', 'email', 'Hi', false);

  -- Set the subject BEFORE dropping to `authenticated`. `auth.uid()` reads
  -- `request.jwt.claim.sub` on supabase/postgres and `request.jwt.claims`
  -- on the hosted platform, so both are set and this test says the same
  -- thing on either.
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_seen FROM public.marketing_templates WHERE id = v_template;
  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'G-05 FAIL: the owner can no longer read their own template (% rows).', v_seen;
  END IF;

  DELETE FROM public.marketing_templates WHERE id = v_template;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'G-05 FAIL: the owner can no longer delete their own template (% rows).', v_rows;
  END IF;

  RESET ROLE;
  RAISE NOTICE 'G-05 PASS: SELECT and DELETE for the owner are unchanged';
END
$g05$;
ROLLBACK;
