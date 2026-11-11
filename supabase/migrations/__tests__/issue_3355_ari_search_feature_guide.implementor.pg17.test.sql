-- MINGLA-INVARIANT: I-ARI-KNOWLEDGE-FROM-GUIDE | issue #3355 | ari_search_feature_guide (migration 20280623043355) is the only way Ari reads the Feature Guide: signed-in callers only, full-text over title, outcome, how_to and limitations, public entry text plus the guide's own effective status (Live only with current evidence), no evidence rows, no staff-only entries, at most 5 results (edge half: supabase/functions/_shared/__tests__/issue_3355_wave_b_guide.implementor.test.ts).
--
-- Issue #3355 Wave B (B1). Reverting the function or its grants makes a
-- block below raise.

\set ON_ERROR_STOP on
BEGIN;

DO $i3355guide_setup$
BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
    ('33550000-0000-4000-8000-0000000008a1','host-3355guide@example.invalid','{"full_name":"Guide Host"}');
  INSERT INTO public.product_capabilities(
    capability_key, title, outcome_summary, who_can_use, surfaces, how_to,
    limitations, support_wording, claimed_status, required_evidence_kinds)
  VALUES
    ('zz-3355-guide-host-codes', 'Zebra promo codes for hosts',
     'Hosts make zebra promo codes that buyers enter at checkout.',
     ARRAY['Brand owner'], ARRAY['Mingla Host iOS'],
     'In Mingla Host, open a brand, then Zebra codes. Make a code and publish it.',
     'Zebra codes only.', 'Hosts can make zebra promo codes for their events.',
     'planned', ARRAY['source']),
    ('zz-3355-guide-staff-codes', 'Zebra promo codes for staff',
     'Staff review zebra promo codes in Mingla Admin before they go live.',
     ARRAY['Mingla staff'], ARRAY['Mingla Admin (admin.usemingla.com)'],
     'In Mingla Admin, open Pipeline > Zebra codes and review each code.',
     'Staff only.', 'Staff review zebra promo codes in Mingla Admin.',
     'planned', ARRAY['source']);
END;
$i3355guide_setup$;

-- Grants: authenticated may call it; anon may not; the table stays closed.
DO $i3355guide_acl$
BEGIN
  IF has_function_privilege('anon', 'public.ari_search_feature_guide(text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not search the Feature Guide';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.ari_search_feature_guide(text,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'signed-in callers must be able to search the Feature Guide';
  END IF;
  IF has_table_privilege('authenticated', 'public.product_capabilities', 'SELECT') THEN
    RAISE EXCEPTION 'product_capabilities must stay closed to authenticated';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.ari_search_feature_guide(text,integer)'::regprocedure) IS NOT TRUE THEN
    RAISE EXCEPTION 'ari_search_feature_guide must be SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'product_capabilities'
       AND indexname = 'product_capabilities_ari_search_idx'
       AND indexdef ILIKE '%USING gin%'
  ) THEN
    RAISE EXCEPTION 'the guide search needs its GIN index';
  END IF;
END;
$i3355guide_acl$;

-- No signed-in user: refused.
DO $i3355guide_anon$
DECLARE
  v_failed boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM * FROM public.ari_search_feature_guide('zebra codes', 3);
  EXCEPTION WHEN SQLSTATE '42501' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a caller with no user must be refused'; END IF;
END;
$i3355guide_anon$;

SELECT set_config('request.jwt.claims',
  '{"sub":"33550000-0000-4000-8000-0000000008a1","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '33550000-0000-4000-8000-0000000008a1', true);
SET LOCAL ROLE authenticated;

DO $i3355guide_search$
DECLARE
  v_row record;
  v_count integer;
  v_failed boolean;
BEGIN
  -- A host's question finds the host entry, with the guide's status.
  SELECT * INTO v_row
    FROM public.ari_search_feature_guide('How do I make a zebra code?', 3)
   WHERE capability_key = 'zz-3355-guide-host-codes';
  IF v_row.capability_key IS NULL THEN
    RAISE EXCEPTION 'the host entry must be found by its how_to words';
  END IF;
  IF v_row.guide_status <> 'Planned' OR v_row.evidence_current THEN
    RAISE EXCEPTION 'status must come from the Feature Guide rule, got % / %',
      v_row.guide_status, v_row.evidence_current;
  END IF;
  IF v_row.how_to NOT LIKE '%then Zebra codes%' OR v_row.support_wording IS NULL THEN
    RAISE EXCEPTION 'the public entry text must be returned';
  END IF;

  -- Staff-only entries never reach a host.
  IF EXISTS (
    SELECT 1 FROM public.ari_search_feature_guide('zebra promo codes review', 5)
     WHERE capability_key = 'zz-3355-guide-staff-codes'
  ) THEN
    RAISE EXCEPTION 'a staff-only (Mingla Admin) entry must not be returned';
  END IF;

  -- At most 5 results, whatever is asked.
  SELECT count(*) INTO v_count FROM public.ari_search_feature_guide('ticket event code brand payout', 99);
  IF v_count > 5 THEN RAISE EXCEPTION 'limit must clamp to 5, got %', v_count; END IF;

  -- The seeded guide is searchable too.
  IF NOT EXISTS (
    SELECT 1 FROM public.ari_search_feature_guide('discount codes', 5)
     WHERE capability_key = 'events-discount-codes'
  ) THEN
    RAISE EXCEPTION 'events-discount-codes must be found for "discount codes"';
  END IF;

  -- The two production asks find their entries first.
  IF (SELECT capability_key FROM public.ari_search_feature_guide('How do I make a discount code?', 1))
     IS DISTINCT FROM 'events-discount-codes' THEN
    RAISE EXCEPTION '"How do I make a discount code?" must find events-discount-codes first';
  END IF;
  IF (SELECT capability_key FROM public.ari_search_feature_guide('I want to upload my customer list', 1))
     IS DISTINCT FROM 'marketing-contact-import' THEN
    RAISE EXCEPTION '"I want to upload my customer list" must find marketing-contact-import first';
  END IF;
  SELECT count(*) INTO v_count FROM public.ari_search_feature_guide('I want you to help', 3);
  IF v_count <> 0 THEN RAISE EXCEPTION 'filler words alone match nothing'; END IF;

  -- Query syntax in the host's words is just words.
  PERFORM * FROM public.ari_search_feature_guide($q$'; drop table x; -- & | ! :*$q$, 3);
  SELECT count(*) INTO v_count FROM public.ari_search_feature_guide('the and of', 3);
  IF v_count <> 0 THEN RAISE EXCEPTION 'stop words alone match nothing'; END IF;

  v_failed := false;
  BEGIN
    PERFORM * FROM public.ari_search_feature_guide('   ', 3);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'an empty query must be refused'; END IF;
  v_failed := false;
  BEGIN
    PERFORM * FROM public.ari_search_feature_guide(repeat('zebra ', 60), 3);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'a query over 300 characters must be refused'; END IF;
END;
$i3355guide_search$;

RESET ROLE;
ROLLBACK;
