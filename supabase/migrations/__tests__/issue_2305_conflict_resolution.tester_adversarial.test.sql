-- #2305 — TESTER ADVERSARIAL regression proof. Independent of, and attacking a
-- different angle than, the implementor's happy-path suite
-- (`issue_2305_conflict_resolution.test.sql`).
--
-- The implementor's suite proves the feature WORKS. This one proves it cannot be
-- worked AROUND, and that a half-applied group is impossible. Four angles the
-- happy-path suite does not touch:
--
--   ADV-1  The rank boundary under the REAL `authenticated` role. The happy-path
--          suite asserts the gate while connected as the table OWNER with only a
--          JWT GUC set; RLS does not apply to a table owner and these tables
--          carry ZERO policies, so that arrangement proves the in-function rank
--          check and nothing about client reachability. This block SETs ROLE
--          authenticated and proves (a) rank 20 and rank 40 are refused on BOTH
--          resolutions, including when the conflictIds array is passed directly
--          rather than through the sheet, and (b) there is no way around the RPC
--          — the client role cannot touch any of the five underlying tables.
--
--   ADV-2  I-PROPOSED-2305-RESOLUTION-MUST-LINK-THE-SOURCE, asserted as a
--          BRAND-WIDE SWEEP over both outcomes rather than per-fixture. A
--          conflict may leave `open` only while its source is unlinked; the
--          instant it leaves `open` its source must be attached to exactly one
--          ACTIVE person. This is the field that separates a fix from a UI that
--          marks the flag resolved and leaves the buyer just as gone.
--
--   ADV-3  The all-or-nothing group under a REAL partial failure. The group is
--          the unit of decision, so a group that is no longer wholly open must
--          write NOTHING — not the link for the still-open member, not a new
--          person, not a separation row, not a merge event. Two ways in: a
--          concurrent caller closed one member, and a candidate stopped being
--          active between the read and the write.
--
--   ADV-4  A double-submit cannot double-apply. Two `separate` submissions for
--          the same group must leave exactly ONE new person, whether the second
--          carries the same clientRequestId or a fresh one.
--
-- Fixtures are transaction-bound and leave no rows behind. Apply the full
-- migration chain first.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id) VALUES
  ('23052305-0000-4000-8000-000000000001'),  -- brand owner        rank 60
  ('23052305-0000-4000-8000-000000000002'),  -- marketing_manager  rank 20
  ('23052305-0000-4000-8000-000000000003'),  -- event_manager      rank 40
  ('23052305-0000-4000-8000-000000000004');  -- stranger, no membership
INSERT INTO public.creator_accounts(id) VALUES('23052305-0000-4000-8000-000000000001');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
VALUES('23052305-0000-4000-8000-000000000010','23052305-0000-4000-8000-000000000001',
       'Issue 2305 Adversarial','issue-2305-adversarial','USD',now(),now());
INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at) VALUES
  ('23052305-0000-4000-8000-000000000010','23052305-0000-4000-8000-000000000002','marketing_manager',now()),
  ('23052305-0000-4000-8000-000000000010','23052305-0000-4000-8000-000000000003','event_manager',now());
INSERT INTO public.events(
  id,brand_id,created_by,event_type,title,slug,description,status,visibility,
  currency,timezone,party_types,rsvp_approval_mode,rsvp_discoverable,created_at,updated_at,theme
) VALUES(
  '23052305-0000-4000-8000-000000000020','23052305-0000-4000-8000-000000000010',
  '23052305-0000-4000-8000-000000000001','event','Issue 2305 Adversarial Event',
  'issue-2305-adversarial-event','fixture','scheduled','public','USD','UTC',
  ARRAY['house-party'],'auto',false,now(),now(),'{}'::jsonb);

-- The buyer already in the book, and one order that conflicts with them.
INSERT INTO public.brand_people(id,brand_id,display_name)
VALUES('23052305-0000-4000-8000-000000000040','23052305-0000-4000-8000-000000000010','Adaeze');
INSERT INTO public.brand_person_names(brand_person_id,display_name,normalized_name,name_kind)
VALUES('23052305-0000-4000-8000-000000000040','Adaeze','adaeze','primary');
INSERT INTO public.brand_person_contact_methods(
  brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
VALUES('23052305-0000-4000-8000-000000000010','23052305-0000-4000-8000-000000000040',
       'phone','+2348162646500','brand_owned',true,true);
INSERT INTO public.orders(
  id,event_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
  payment_status,confirmed_at,created_at,currency,total_cents)
VALUES('23052305-0000-4000-8000-000000000030','23052305-0000-4000-8000-000000000020',NULL,
       'Adaeze Okonkwo','adaeze@example.test','+2348162646500','paid',now(),now(),'USD',1500);
SELECT public.biz_resolve_brand_person_source_derived(
  'order','23052305-0000-4000-8000-000000000030') AS adv_seed \gset

-- ===========================================================================
-- ADV-1 — the rank boundary, exercised as the real `authenticated` client role.
-- ===========================================================================
-- Everything in this block runs with `SET LOCAL ROLE authenticated`, so the
-- session has exactly the privileges a signed-in operator's PostgREST request
-- has: the two granted RPCs and nothing else.
DO $adv_role_setup$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.brand_person_identity_conflicts
                WHERE brand_id='23052305-0000-4000-8000-000000000010' AND status='open') THEN
    RAISE EXCEPTION 'ADV-2305-1 FAIL: fixture did not produce a conflict to attack';
  END IF;
END;
$adv_role_setup$;

SET LOCAL ROLE authenticated;

-- rank 20 may READ the queue (that is the point of the split) ...
SET LOCAL request.jwt.claims = '{"sub":"23052305-0000-4000-8000-000000000002","role":"authenticated"}';
DO $adv_rank20_read$
DECLARE v_listing jsonb; v_row jsonb;
BEGIN
  v_listing := public.biz_list_brand_person_conflicts('23052305-0000-4000-8000-000000000010',50);
  IF (v_listing->>'openCount')::bigint <> 1 THEN
    RAISE EXCEPTION 'ADV-2305-1 FAIL: rank 20 could not read the queue as `authenticated`: %', v_listing;
  END IF;
  v_row := v_listing->'rows'->0;
  -- ... and must be told, in the payload itself, that it may not resolve. A UI
  -- that renders resolve controls off a stale assumption would still be refused
  -- by the RPC, but the operator would be shown a control that cannot work.
  IF (v_row->>'canResolve')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'ADV-2305-1 FAIL: rank 20 was told canResolve=%', v_row->>'canResolve';
  END IF;
END;
$adv_rank20_read$;

DO $adv_rank_gate$
DECLARE
  v_brand uuid := '23052305-0000-4000-8000-000000000010';
  v_winner uuid := '23052305-0000-4000-8000-000000000040';
  v_ids uuid[];
  v_actor text;
  v_res text;
  v_caught text;
BEGIN
  -- The ids come out of the LIST response, which is all a rank-20 operator has.
  -- This is the forge path exactly: read the queue you are allowed to read, then
  -- replay its conflictIds straight into the endpoint you are not.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"23052305-0000-4000-8000-000000000002","role":"authenticated"}', true);
  SELECT array_agg((x)::uuid) INTO v_ids
    FROM jsonb_array_elements_text(
      (public.biz_list_brand_person_conflicts(v_brand,50))->'rows'->0->'conflictIds') AS x;
  IF v_ids IS NULL OR cardinality(v_ids)=0 THEN
    RAISE EXCEPTION 'ADV-2305-1 FAIL: the list gave a rank-20 caller no conflictIds to forge with';
  END IF;

  -- Every sub-rank-50 actor, on every resolution, passing the conflictIds array
  -- DIRECTLY — i.e. exactly the request a rank-20 operator could forge by
  -- replaying the list response into the resolve endpoint.
  FOREACH v_actor IN ARRAY ARRAY[
    '23052305-0000-4000-8000-000000000002',  -- marketing_manager, rank 20
    '23052305-0000-4000-8000-000000000003',  -- event_manager,     rank 40
    '23052305-0000-4000-8000-000000000004'   -- stranger,          no membership
  ] LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub',v_actor,'role','authenticated')::text, true);
    FOREACH v_res IN ARRAY ARRAY['merge','separate'] LOOP
      BEGIN
        PERFORM public.biz_resolve_brand_person_conflict(
          v_brand, v_ids, v_res,
          CASE WHEN v_res='merge' THEN v_winner ELSE NULL END,
          gen_random_uuid());
        RAISE EXCEPTION 'ADV-2305-1 FAIL: actor % resolved (%) below rank 50', v_actor, v_res;
      EXCEPTION WHEN insufficient_privilege THEN
        GET STACKED DIAGNOSTICS v_caught = MESSAGE_TEXT;
        IF v_caught <> 'people_forbidden' THEN
          RAISE EXCEPTION 'ADV-2305-1 FAIL: actor %/% got % instead of people_forbidden',
            v_actor, v_res, v_caught;
        END IF;
      END;
    END LOOP;
  END LOOP;

  -- Nothing was written by any of those six attempts: the queue the rank-20
  -- caller can still read is byte-for-byte the queue they started with.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"23052305-0000-4000-8000-000000000002","role":"authenticated"}', true);
  IF (public.biz_list_brand_person_conflicts(v_brand,50))->'rows'->0->'conflictIds'
     IS DISTINCT FROM to_jsonb(v_ids) THEN
    RAISE EXCEPTION 'ADV-2305-1 FAIL: a sub-rank-50 attempt changed the queue: % -> %',
      to_jsonb(v_ids), (public.biz_list_brand_person_conflicts(v_brand,50))->'rows'->0->'conflictIds';
  END IF;
END;
$adv_rank_gate$;

-- The RPC is the ONLY path. A client role that cannot resolve through the gate
-- must not be able to reach around it and write the tables directly.
DO $adv_no_direct_write$
DECLARE
  v_tbl text;
  v_ok  boolean;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"23052305-0000-4000-8000-000000000002","role":"authenticated"}', true);
  FOREACH v_tbl IN ARRAY ARRAY[
    'brand_person_identity_conflicts',
    'brand_person_identity_separations',
    'brand_person_source_links',
    'brand_people',
    'brand_person_merge_events'
  ] LOOP
    IF has_table_privilege('authenticated','public.'||v_tbl,'SELECT')
       OR has_table_privilege('authenticated','public.'||v_tbl,'INSERT')
       OR has_table_privilege('authenticated','public.'||v_tbl,'UPDATE')
       OR has_table_privilege('authenticated','public.'||v_tbl,'DELETE') THEN
      RAISE EXCEPTION 'ADV-2305-1 FAIL: `authenticated` holds a direct grant on %', v_tbl;
    END IF;
  END LOOP;

  -- And prove it at runtime, not only in the catalogue.
  v_ok := false;
  BEGIN
    UPDATE public.brand_person_identity_conflicts
       SET status='resolved_merge', resolved_at=now()
     WHERE brand_id='23052305-0000-4000-8000-000000000010';
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'ADV-2305-1 FAIL: `authenticated` UPDATEd the conflict table directly';
  END IF;

  -- The two merge primitives are the shortcut this feature must never take.
  IF has_function_privilege('authenticated','public.biz_merge_brand_people(uuid,uuid,text,uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.biz_reverse_brand_person_merge(uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.biz_brand_person_conflict_subject(text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'ADV-2305-1 FAIL: an unauthorized primitive is reachable by `authenticated`';
  END IF;
  RAISE NOTICE 'ADV-2305-1 PASS: rank 50 cannot be reached from below, and the RPC is the only door';
END;
$adv_no_direct_write$;

RESET ROLE;

-- ===========================================================================
-- ADV-3 — the group is all-or-nothing under a REAL partial failure.
-- ===========================================================================
-- One human, three sources, one card. Something closes one of them behind the
-- operator's back. The group must then write NOTHING.
DO $adv_group_atomicity$
DECLARE
  v_brand uuid := '23052305-0000-4000-8000-000000000010';
  v_event uuid := '23052305-0000-4000-8000-000000000020';
  v_owner uuid := '23052305-0000-4000-8000-000000000001';
  v_existing uuid;
  v_o1 uuid := '23052305-0000-4000-8000-000000000051';
  v_o2 uuid := '23052305-0000-4000-8000-000000000052';
  v_o3 uuid := '23052305-0000-4000-8000-000000000053';
  v_c1 uuid; v_c2 uuid; v_c3 uuid;
  v_people_before bigint; v_links_before bigint; v_seps_before bigint; v_merges_before bigint;
  v_caught text;
BEGIN
  INSERT INTO public.brand_people(brand_id,display_name) VALUES(v_brand,'Chidi') RETURNING id INTO v_existing;
  INSERT INTO public.brand_person_names(brand_person_id,display_name,normalized_name,name_kind)
    VALUES(v_existing,'Chidi','chidi','primary');
  INSERT INTO public.brand_person_contact_methods(
    brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
    VALUES(v_brand,v_existing,'email','chidi@example.test','brand_owned',true,true);

  INSERT INTO public.orders(id,event_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
    payment_status,confirmed_at,created_at,currency,total_cents) VALUES
    (v_o1,v_event,NULL,'Chidi Nwosu','chidi@example.test','+2348162646501','paid',now(),now(),'USD',1000),
    (v_o2,v_event,NULL,'Chidi Nwosu','chidi@example.test','+2348162646501','paid',now(),now(),'USD',2000),
    (v_o3,v_event,NULL,'Chidi Nwosu','chidi@example.test','+2348162646501','paid',now(),now(),'USD',3000);
  v_c1 := (public.biz_resolve_brand_person_source_derived('order',v_o1)->>'conflictId')::uuid;
  v_c2 := (public.biz_resolve_brand_person_source_derived('order',v_o2)->>'conflictId')::uuid;
  v_c3 := (public.biz_resolve_brand_person_source_derived('order',v_o3)->>'conflictId')::uuid;
  IF v_c1 IS NULL OR v_c2 IS NULL OR v_c3 IS NULL THEN
    RAISE EXCEPTION 'ADV-2305-3 FAIL: fixture needs three conflicts for one human, got % % %', v_c1,v_c2,v_c3;
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);

  -- The list must present them as ONE card, or "the group" is not what the
  -- operator was shown and atomicity over it means nothing.
  IF jsonb_array_length((public.biz_list_brand_person_conflicts(v_brand,50))->'rows') <> 2 THEN
    RAISE EXCEPTION 'ADV-2305-3 FAIL: three sources for one human did not collapse into one card';
  END IF;

  -- A concurrent operator closes ONE member of the group.
  PERFORM public.biz_resolve_brand_person_conflict(v_brand,ARRAY[v_c1],'merge',v_existing,gen_random_uuid());

  SELECT count(*) INTO v_people_before FROM public.brand_people WHERE brand_id=v_brand;
  SELECT count(*) INTO v_links_before  FROM public.brand_person_source_links WHERE brand_id=v_brand AND detached_at IS NULL;
  SELECT count(*) INTO v_seps_before   FROM public.brand_person_identity_separations WHERE brand_id=v_brand;
  SELECT count(*) INTO v_merges_before FROM public.brand_person_merge_events WHERE brand_id=v_brand;

  -- Now the first operator confirms the card they were shown. The group is no
  -- longer wholly open, so it must be refused WHOLE — on BOTH branches of the
  -- "already resolved" question.
  --
  -- (a) The already-closed member carries the SAME resolution the operator is
  --     now confirming. This is the branch that a validation loop keyed only on
  --     `status <> requested` waves straight through: the group would proceed
  --     and quietly file the two still-open sources, which is a half-applied
  --     group even though every row ends up reading `resolved_merge`.
  BEGIN
    PERFORM public.biz_resolve_brand_person_conflict(
      v_brand, ARRAY[v_c1,v_c2,v_c3], 'merge', v_existing, gen_random_uuid());
    RAISE EXCEPTION 'ADV-2305-3 FAIL: a group with an already-closed member was half-applied';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_caught = MESSAGE_TEXT;
    IF v_caught <> 'people_conflict_already_resolved' THEN
      RAISE EXCEPTION 'ADV-2305-3 FAIL: expected people_conflict_already_resolved, got %', v_caught;
    END IF;
  END;
  IF (SELECT count(*) FROM public.brand_person_identity_conflicts
       WHERE id IN (v_c2,v_c3) AND status='open') <> 2 THEN
    RAISE EXCEPTION 'ADV-2305-3 FAIL: a same-resolution partial group still advanced its open members';
  END IF;

  -- (b) The already-closed member carries the OTHER resolution.
  BEGIN
    PERFORM public.biz_resolve_brand_person_conflict(
      v_brand, ARRAY[v_c1,v_c2,v_c3], 'separate', NULL, gen_random_uuid());
    RAISE EXCEPTION 'ADV-2305-3 FAIL: a group with a differently-resolved member was half-applied';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_caught = MESSAGE_TEXT;
    IF v_caught <> 'people_conflict_already_resolved' THEN
      RAISE EXCEPTION 'ADV-2305-3 FAIL: expected people_conflict_already_resolved, got %', v_caught;
    END IF;
  END;

  IF (SELECT count(*) FROM public.brand_people WHERE brand_id=v_brand) <> v_people_before THEN
    RAISE EXCEPTION 'ADV-2305-3 FAIL: the refused group still created a person';
  END IF;
  IF (SELECT count(*) FROM public.brand_person_source_links WHERE brand_id=v_brand AND detached_at IS NULL) <> v_links_before THEN
    RAISE EXCEPTION 'ADV-2305-3 FAIL: the refused group still linked a source';
  END IF;
  IF (SELECT count(*) FROM public.brand_person_identity_separations WHERE brand_id=v_brand) <> v_seps_before THEN
    RAISE EXCEPTION 'ADV-2305-3 FAIL: the refused group still wrote a separation';
  END IF;
  IF (SELECT count(*) FROM public.brand_person_merge_events WHERE brand_id=v_brand) <> v_merges_before THEN
    RAISE EXCEPTION 'ADV-2305-3 FAIL: the refused group still wrote a merge event';
  END IF;
  IF (SELECT count(*) FROM public.brand_person_identity_conflicts
       WHERE id IN (v_c2,v_c3) AND status='open') <> 2 THEN
    RAISE EXCEPTION 'ADV-2305-3 FAIL: the refused group advanced its still-open members';
  END IF;

  -- Second way in: the winner stops being active between the read and the write.
  UPDATE public.brand_people SET record_status='deleted', deleted_at=now() WHERE id=v_existing;
  BEGIN
    PERFORM public.biz_resolve_brand_person_conflict(
      v_brand, ARRAY[v_c2,v_c3], 'merge', v_existing, gen_random_uuid());
    RAISE EXCEPTION 'ADV-2305-3 FAIL: a group merged into a candidate that is no longer active';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_caught = MESSAGE_TEXT;
    IF v_caught <> 'people_conflict_candidate_invalid' THEN
      RAISE EXCEPTION 'ADV-2305-3 FAIL: expected people_conflict_candidate_invalid, got %', v_caught;
    END IF;
  END;
  IF (SELECT count(*) FROM public.brand_person_source_links WHERE brand_id=v_brand AND detached_at IS NULL) <> v_links_before THEN
    RAISE EXCEPTION 'ADV-2305-3 FAIL: a rejected merge still linked a source';
  END IF;
  IF (SELECT count(*) FROM public.brand_person_identity_conflicts
       WHERE id IN (v_c2,v_c3) AND status='open') <> 2 THEN
    RAISE EXCEPTION 'ADV-2305-3 FAIL: a rejected merge still advanced the group';
  END IF;
  UPDATE public.brand_people SET record_status='active', deleted_at=NULL WHERE id=v_existing;

  -- ADV-4: a double submit cannot double-apply. Resolve the remaining pair as
  -- `separate` twice — once replaying the same clientRequestId, once with a
  -- fresh one — and exactly ONE new person may exist afterwards.
  DECLARE
    v_req uuid := gen_random_uuid();
    v_first jsonb; v_replay jsonb; v_fresh jsonb;
  BEGIN
    SELECT count(*) INTO v_people_before FROM public.brand_people WHERE brand_id=v_brand;
    v_first  := public.biz_resolve_brand_person_conflict(v_brand,ARRAY[v_c2,v_c3],'separate',NULL,v_req);
    v_replay := public.biz_resolve_brand_person_conflict(v_brand,ARRAY[v_c2,v_c3],'separate',NULL,v_req);
    v_fresh  := public.biz_resolve_brand_person_conflict(v_brand,ARRAY[v_c2,v_c3],'separate',NULL,gen_random_uuid());
    IF (SELECT count(*) FROM public.brand_people WHERE brand_id=v_brand) <> v_people_before + 1 THEN
      RAISE EXCEPTION 'ADV-2305-4 FAIL: a double submit created % people, expected 1',
        (SELECT count(*) FROM public.brand_people WHERE brand_id=v_brand) - v_people_before;
    END IF;
    IF (v_replay->>'personId')::uuid IS DISTINCT FROM (v_first->>'personId')::uuid
       OR (v_fresh->>'personId')::uuid IS DISTINCT FROM (v_first->>'personId')::uuid THEN
      RAISE EXCEPTION 'ADV-2305-4 FAIL: a replay answered with a different person: % / % / %',
        v_first->>'personId', v_replay->>'personId', v_fresh->>'personId';
    END IF;
    IF NOT COALESCE((v_replay->>'replayed')::boolean,false)
       OR NOT COALESCE((v_fresh->>'replayed')::boolean,false) THEN
      RAISE EXCEPTION 'ADV-2305-4 FAIL: a replay did not identify itself as one';
    END IF;
    -- One source link per source, never two.
    IF EXISTS(SELECT source_kind,source_id FROM public.brand_person_source_links
               WHERE brand_id=v_brand AND detached_at IS NULL
               GROUP BY source_kind,source_id HAVING count(*) > 1) THEN
      RAISE EXCEPTION 'ADV-2305-4 FAIL: a source ended up linked twice';
    END IF;
  END;

  RAISE NOTICE 'ADV-2305-3/4 PASS: the group is all-or-nothing, and a double submit cannot double-apply';
END;
$adv_group_atomicity$;

-- ===========================================================================
-- ADV-2 — I-PROPOSED-2305-RESOLUTION-MUST-LINK-THE-SOURCE, swept brand-wide.
-- ===========================================================================
-- By this point the fixture brand carries both outcomes. Every conflict that has
-- LEFT `open` must have its source attached to exactly one ACTIVE person, and
-- that person must be reachable in the brand's own contact book. A conflict that
-- reads `resolved_*` with an orphaned source is a false resolution: the queue
-- empties, the operator believes the buyer is filed, and the buyer is still gone.
DO $adv_link_invariant$
DECLARE
  v_brand uuid := '23052305-0000-4000-8000-000000000010';
  v_bad text;
  v_resolved bigint;
BEGIN
  SELECT count(*) INTO v_resolved FROM public.brand_person_identity_conflicts
   WHERE brand_id=v_brand AND status <> 'open';
  IF v_resolved < 2 THEN
    RAISE EXCEPTION 'ADV-2305-2 FAIL: the sweep needs both outcomes present, found % resolved', v_resolved;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.brand_person_identity_conflicts
                 WHERE brand_id=v_brand AND status='resolved_merge')
     OR NOT EXISTS(SELECT 1 FROM public.brand_person_identity_conflicts
                 WHERE brand_id=v_brand AND status='resolved_separate') THEN
    RAISE EXCEPTION 'ADV-2305-2 FAIL: the sweep must cover BOTH outcomes';
  END IF;

  SELECT string_agg(format('%s/%s status=%s links=%s', c.source_kind, c.source_id, c.status, l.n), '; ')
    INTO v_bad
  FROM public.brand_person_identity_conflicts c
  CROSS JOIN LATERAL (
    SELECT count(*) AS n FROM public.brand_person_source_links sl
     JOIN public.brand_people p ON p.id = sl.brand_person_id AND p.record_status='active'
    WHERE sl.source_kind=c.source_kind AND sl.source_id=c.source_id AND sl.detached_at IS NULL
  ) l
  WHERE c.brand_id=v_brand AND c.status <> 'open' AND l.n <> 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ADV-2305-2 FAIL: resolved conflicts left their source orphaned or ambiguous: %', v_bad;
  END IF;

  -- ... and every resolved conflict records WHO decided it. A resolution with no
  -- actor is not auditable and cannot be reversed against a human.
  IF EXISTS(SELECT 1 FROM public.brand_person_identity_conflicts
             WHERE brand_id=v_brand AND status <> 'open'
               AND (resolved_at IS NULL OR resolved_by IS NULL)) THEN
    RAISE EXCEPTION 'ADV-2305-2 FAIL: a resolved conflict carries no resolved_at/resolved_by';
  END IF;

  -- ... and the person the source landed on is really in the book the operator
  -- reads, not an orphan record only this feature can see.
  IF EXISTS(
    SELECT 1 FROM public.brand_person_identity_conflicts c
     JOIN public.brand_person_source_links sl
       ON sl.source_kind=c.source_kind AND sl.source_id=c.source_id AND sl.detached_at IS NULL
     LEFT JOIN public.brand_person_contact_methods cm
       ON cm.brand_person_id=sl.brand_person_id AND cm.record_state='active'
      AND cm.provenance_scope='brand_owned'
    WHERE c.brand_id=v_brand AND c.status <> 'open' AND cm.id IS NULL) THEN
    RAISE EXCEPTION 'ADV-2305-2 FAIL: a resolved buyer carries no exportable contact — not in the book';
  END IF;

  RAISE NOTICE 'ADV-2305-2 PASS: every resolved conflict leaves its source on exactly one active person, on BOTH outcomes';
END;
$adv_link_invariant$;

ROLLBACK;
