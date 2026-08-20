-- #2305 — the conflict review queue and the resolve path. Implementor happy-path
-- behavioural proof. Apply the full migration chain first.
--
-- T-3, T-5, T-6 and T-7 are the spine: they are the only cases that can tell a
-- real fix from a queue that refills. Everything else can pass while the buyer
-- stays exactly as gone as before.
--
-- Fixtures are transaction-bound and leave no rows behind.
\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------- catalogue --
DO $catalog$
DECLARE v_signature text;
BEGIN
  IF to_regclass('public.brand_person_identity_separations') IS NULL THEN
    RAISE EXCEPTION 'T-2305-00 FAIL: separations table absent';
  END IF;
  -- T-12: RLS on, zero policies, zero client grants — matching every sibling.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.brand_person_identity_separations'::regclass) THEN
    RAISE EXCEPTION 'T-2305-12 FAIL: separations RLS not enabled';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='brand_person_identity_separations') THEN
    RAISE EXCEPTION 'T-2305-12 FAIL: separations carries a policy';
  END IF;
  IF EXISTS(SELECT 1 FROM information_schema.role_table_grants
            WHERE table_schema='public' AND table_name='brand_person_identity_separations'
              AND grantee IN ('PUBLIC','anon','authenticated')) THEN
    RAISE EXCEPTION 'T-2305-12 FAIL: separations has a client grant';
  END IF;
  -- T-13(a): the merge primitives stay service_role-only. Granting either to
  -- `authenticated` is the privilege-escalation shortcut this fix routes around.
  FOREACH v_signature IN ARRAY ARRAY[
    'public.biz_merge_brand_people(uuid,uuid,text,uuid,uuid)',
    'public.biz_reverse_brand_person_merge(uuid,uuid)'
  ] LOOP
    IF has_function_privilege('authenticated',v_signature,'EXECUTE')
       OR has_function_privilege('anon',v_signature,'EXECUTE') THEN
      RAISE EXCEPTION 'T-2305-12 FAIL: % is reachable by a client role', v_signature;
    END IF;
  END LOOP;
  -- The two new RPCs are client-reachable and rank-gated in-function.
  FOREACH v_signature IN ARRAY ARRAY[
    'public.biz_list_brand_person_conflicts(uuid,integer)',
    'public.biz_resolve_brand_person_conflict(uuid,uuid[],text,uuid,uuid)'
  ] LOOP
    IF NOT has_function_privilege('authenticated',v_signature,'EXECUTE')
       OR has_function_privilege('anon',v_signature,'EXECUTE') THEN
      RAISE EXCEPTION 'T-2305-00 FAIL: % ACL drifted', v_signature;
    END IF;
  END LOOP;
  RAISE NOTICE 'T-2305-00/12 PASS: catalogue, RLS shape and grants hold';
END;
$catalog$;

-- ------------------------------------------------------------------ fixture --
INSERT INTO auth.users(id) VALUES
  ('23050000-0000-4000-8000-000000000001'),  -- brand owner (rank 60)
  ('23050000-0000-4000-8000-000000000002'),  -- marketing manager (rank 20)
  ('23050000-0000-4000-8000-000000000003'),  -- event manager (rank 40)
  ('23050000-0000-4000-8000-000000000004');  -- the authenticated buyer
INSERT INTO public.creator_accounts(id) VALUES('23050000-0000-4000-8000-000000000001');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
VALUES('23050000-0000-4000-8000-000000000010','23050000-0000-4000-8000-000000000001',
       'Issue 2305 Brand','issue-2305-brand','USD',now(),now());
INSERT INTO public.brand_team_members(brand_id,user_id,role,accepted_at)
VALUES('23050000-0000-4000-8000-000000000010','23050000-0000-4000-8000-000000000002','marketing_manager',now()),
       ('23050000-0000-4000-8000-000000000010','23050000-0000-4000-8000-000000000003','event_manager',now());
INSERT INTO public.events(
  id,brand_id,created_by,event_type,title,slug,description,status,visibility,
  currency,timezone,party_types,rsvp_approval_mode,rsvp_discoverable,created_at,updated_at,theme
) VALUES(
  '23050000-0000-4000-8000-000000000020','23050000-0000-4000-8000-000000000010',
  '23050000-0000-4000-8000-000000000001','event','Issue 2305 Event','issue-2305-event','fixture',
  'scheduled','public','USD','UTC',ARRAY['house-party'],'auto',false,now(),now(),'{}'::jsonb
);

-- ----------------------------------------------------- T-1 / T-3 / T-5 / T-4 --
-- The core loop: a returning buyer types a fuller name on an order that shares
-- their phone with an existing record. The system refuses to guess (correct),
-- a human resolves it as the same person, and the buyer must then STAY resolved.
DO $happy_merge$
DECLARE
  v_brand uuid := '23050000-0000-4000-8000-000000000010';
  v_event uuid := '23050000-0000-4000-8000-000000000020';
  v_owner uuid := '23050000-0000-4000-8000-000000000001';
  v_buyer uuid := '23050000-0000-4000-8000-000000000004';
  v_order uuid := '23050000-0000-4000-8000-000000000030';
  v_order2 uuid := '23050000-0000-4000-8000-000000000031';
  v_existing uuid;
  v_first jsonb; v_conflict uuid; v_result jsonb; v_replay jsonb;
  v_person uuid; v_link uuid; v_listing jsonb; v_row jsonb;
BEGIN
  -- The record already in the book: same phone, SHORTER name.
  INSERT INTO public.brand_people(brand_id,display_name) VALUES(v_brand,'Arifat')
    RETURNING id INTO v_existing;
  INSERT INTO public.brand_person_names(brand_person_id,display_name,normalized_name,name_kind)
  VALUES(v_existing,'Arifat','arifat','primary');
  INSERT INTO public.brand_person_contact_methods(
    brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
  VALUES(v_brand,v_existing,'phone','+14433147084','brand_owned',true,true);

  INSERT INTO public.orders(
    id,event_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
    payment_status,confirmed_at,created_at,currency,total_cents)
  VALUES(v_order,v_event,v_buyer,'Arifat Ola-Dauda','arifatd99@example.test','+14433147084',
         'paid',now(),now(),'USD',1000);

  -- 1. The refusal still fires, and it is CORRECT.
  v_first := public.biz_resolve_brand_person_source_derived('order',v_order);
  IF v_first->>'linkOutcome' <> 'conflict' THEN
    RAISE EXCEPTION 'T-2305-01 FAIL: expected a conflict, got %', v_first;
  END IF;
  v_conflict := (v_first->>'conflictId')::uuid;
  -- F-2: today the source is left belonging to NOBODY. That is the bug.
  IF EXISTS(SELECT 1 FROM public.brand_person_source_links
            WHERE source_kind='order' AND source_id=v_order AND detached_at IS NULL) THEN
    RAISE EXCEPTION 'T-2305-01 FAIL: conflict branch should not link';
  END IF;

  -- 2. The READER exists and groups per human. Rank 20 may read it.
  PERFORM set_config('request.jwt.claim.sub','23050000-0000-4000-8000-000000000002',true);
  v_listing := public.biz_list_brand_person_conflicts(v_brand,50);
  IF (v_listing->>'openCount')::bigint <> 1 THEN
    RAISE EXCEPTION 'T-2305-02 FAIL: openCount should be 1 group, got %', v_listing->>'openCount';
  END IF;
  v_row := v_listing->'rows'->0;
  IF v_row->'incoming'->>'displayName' <> 'Arifat Ola-Dauda'
     OR v_row->'incoming'->>'phone' <> '+14433147084' THEN
    RAISE EXCEPTION 'T-2305-02 FAIL: incoming identity wrong: %', v_row->'incoming';
  END IF;
  IF NOT (v_row->'matchedOn' @> '["phone"]'::jsonb) OR v_row->'matchedOn' @> '["email"]'::jsonb THEN
    RAISE EXCEPTION 'T-2305-02 FAIL: matchedOn should be phone only, got %', v_row->'matchedOn';
  END IF;
  -- T-8: rank 20 sees the queue but may not resolve it.
  IF (v_row->>'canResolve')::boolean THEN
    RAISE EXCEPTION 'T-2305-08 FAIL: rank 20 must not be told it can resolve';
  END IF;
  BEGIN
    PERFORM public.biz_resolve_brand_person_conflict(
      v_brand,ARRAY[v_conflict],'merge',v_existing,gen_random_uuid());
    RAISE EXCEPTION 'T-2305-08 FAIL: rank 20 resolved a conflict';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- T-8b: rank 40 is also below the bar.
  PERFORM set_config('request.jwt.claim.sub','23050000-0000-4000-8000-000000000003',true);
  BEGIN
    PERFORM public.biz_resolve_brand_person_conflict(
      v_brand,ARRAY[v_conflict],'merge',v_existing,gen_random_uuid());
    RAISE EXCEPTION 'T-2305-08 FAIL: rank 40 resolved a conflict';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- 3. T-1: the owner resolves it as the same person.
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_result := public.biz_resolve_brand_person_conflict(
    v_brand,ARRAY[v_conflict],'merge',v_existing,'23050000-0000-4000-8000-0000000000a1');
  v_person := (v_result->>'personId')::uuid;
  IF v_person <> v_existing THEN
    RAISE EXCEPTION 'T-2305-01 FAIL: winner should be the existing record: %', v_result;
  END IF;

  -- I-PROPOSED-2305-RESOLUTION-MUST-LINK-THE-SOURCE — the whole point.
  SELECT id INTO v_link FROM public.brand_person_source_links
    WHERE source_kind='order' AND source_id=v_order AND detached_at IS NULL;
  IF v_link IS NULL THEN
    RAISE EXCEPTION 'T-2305-01 FAIL: resolution left the source ORPHANED — false resolution';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.brand_person_source_links
                WHERE id=v_link AND brand_person_id=v_person AND link_method='manual_resolution') THEN
    RAISE EXCEPTION 'T-2305-01 FAIL: link is not manual_resolution on the winner';
  END IF;
  IF (SELECT status FROM public.brand_person_identity_conflicts WHERE id=v_conflict) <> 'resolved_merge'
     OR (SELECT resolved_at FROM public.brand_person_identity_conflicts WHERE id=v_conflict) IS NULL
     OR (SELECT resolved_by FROM public.brand_person_identity_conflicts WHERE id=v_conflict) <> v_owner THEN
    RAISE EXCEPTION 'T-2305-01 FAIL: conflict status/resolved_at/resolved_by wrong';
  END IF;
  -- The incoming name lands as an ALTERNATE; the primary is untouched (T-4).
  IF NOT EXISTS(SELECT 1 FROM public.brand_person_names
                WHERE brand_person_id=v_person AND active AND name_kind='alternate'
                  AND normalized_name='arifat ola-dauda') THEN
    RAISE EXCEPTION 'T-2305-04 FAIL: incoming name is not an active alternate';
  END IF;
  IF (SELECT display_name FROM public.brand_people WHERE id=v_person) <> 'Arifat' THEN
    RAISE EXCEPTION 'T-2305-04 FAIL: merge overwrote the existing display_name';
  END IF;
  -- Ring-1 provenance: brand_owned + exportable, with the edge bound to the link.
  IF NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods
                WHERE brand_person_id=v_person AND channel='email'
                  AND normalized_value='arifatd99@example.test'
                  AND provenance_scope='brand_owned' AND is_exportable AND record_state='active') THEN
    RAISE EXCEPTION 'T-2305-01 FAIL: incoming email not attached as exportable brand_owned';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.brand_person_contact_method_sources
                WHERE source_link_id=v_link AND active AND exportable AND provenance_kind='order') THEN
    RAISE EXCEPTION 'T-2305-01 FAIL: contact-method source edge missing for the new link';
  END IF;
  -- F-4: linked_user_id must be set, or the next re-ingest unlinks the buyer.
  IF (SELECT linked_user_id FROM public.brand_people WHERE id=v_person) IS DISTINCT FROM v_buyer THEN
    RAISE EXCEPTION 'T-2305-15 FAIL: linked_user_id not set on the winner';
  END IF;

  -- 4. T-3 — THE RECURRENCE GATE. Re-ingest the SAME source. It must be
  -- `already_linked`, never `conflict`, and the link must survive untouched.
  v_first := public.biz_resolve_brand_person_source_derived('order',v_order);
  IF v_first->>'linkOutcome' <> 'already_linked' THEN
    RAISE EXCEPTION 'T-2305-03 FAIL: re-ingest after merge returned % (queue refills)', v_first;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.brand_person_source_links
                WHERE id=v_link AND detached_at IS NULL AND brand_person_id=v_person) THEN
    RAISE EXCEPTION 'T-2305-03 FAIL: re-ingest detached the link we just wrote (F-3)';
  END IF;

  -- 5. T-5 — a NEW order from the same buyer with the same differing name must
  -- link straight through with NO new conflict. This is what A-1 buys.
  INSERT INTO public.orders(
    id,event_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
    payment_status,confirmed_at,created_at,currency,total_cents)
  VALUES(v_order2,v_event,v_buyer,'Arifat Ola-Dauda','arifatd99@example.test','+14433147084',
         'paid',now(),now(),'USD',2000);
  v_first := public.biz_resolve_brand_person_source_derived('order',v_order2);
  IF v_first->>'linkOutcome' <> 'linked' THEN
    RAISE EXCEPTION 'T-2305-05 FAIL: a new order from a resolved buyer returned % — the queue would never empty', v_first;
  END IF;
  IF EXISTS(SELECT 1 FROM public.brand_person_identity_conflicts
            WHERE source_kind='order' AND source_id=v_order2) THEN
    RAISE EXCEPTION 'T-2305-05 FAIL: a new order from a resolved buyer filed a fresh conflict';
  END IF;

  -- 6. T-7: the queue is empty and the buyer is in the book.
  IF (public.biz_list_brand_person_conflicts(v_brand,50)->>'openCount')::bigint <> 0 THEN
    RAISE EXCEPTION 'T-2305-07 FAIL: openCount did not fall to zero';
  END IF;

  -- 7. T-16: replaying the same resolution is a no-op that returns the original.
  v_replay := public.biz_resolve_brand_person_conflict(
    v_brand,ARRAY[v_conflict],'merge',v_existing,'23050000-0000-4000-8000-0000000000a1');
  IF NOT (v_replay->>'replayed')::boolean OR (v_replay->>'personId')::uuid <> v_person THEN
    RAISE EXCEPTION 'T-2305-16 FAIL: replay did not return the original result: %', v_replay;
  END IF;
  -- ...and asking for the OTHER outcome after the fact is refused.
  BEGIN
    PERFORM public.biz_resolve_brand_person_conflict(
      v_brand,ARRAY[v_conflict],'separate',NULL,gen_random_uuid());
    RAISE EXCEPTION 'T-2305-16 FAIL: a contradicting replay was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE NOTICE 'T-2305-01/03/04/05/07/08/15/16 PASS: merge links the source and STAYS resolved';
END;
$happy_merge$;

-- ------------------------------------------------------------- T-2 / T-6 -----
-- The other outcome. Two genuinely different humans on one shared phone: the
-- store-review demo number. `separate` must create a second person AND record
-- the decision durably, or the next ingest silently re-merges them.
DO $happy_separate$
DECLARE
  v_brand uuid := '23050000-0000-4000-8000-000000000010';
  v_event uuid := '23050000-0000-4000-8000-000000000020';
  v_owner uuid := '23050000-0000-4000-8000-000000000001';
  v_order uuid := '23050000-0000-4000-8000-000000000040';
  v_order2 uuid := '23050000-0000-4000-8000-000000000041';
  v_existing uuid; v_first jsonb; v_conflict uuid; v_result jsonb;
  v_person uuid; v_merges integer;
BEGIN
  INSERT INTO public.brand_people(brand_id,display_name) VALUES(v_brand,'Free Proof 2136')
    RETURNING id INTO v_existing;
  INSERT INTO public.brand_person_contact_methods(
    brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
  VALUES(v_brand,v_existing,'phone','+12015550199','brand_owned',true,true);

  INSERT INTO public.orders(
    id,event_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
    payment_status,confirmed_at,created_at,currency,total_cents)
  VALUES(v_order,v_event,NULL,'Paystack Handoff Test','paystacktest@example.test','+12015550199',
         'paid',now(),now(),'USD',1000);

  v_first := public.biz_resolve_brand_person_source_derived('order',v_order);
  IF v_first->>'linkOutcome' <> 'conflict' THEN
    RAISE EXCEPTION 'T-2305-02 FAIL: expected a conflict, got %', v_first;
  END IF;
  v_conflict := (v_first->>'conflictId')::uuid;

  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_result := public.biz_resolve_brand_person_conflict(
    v_brand,ARRAY[v_conflict],'separate',NULL,'23050000-0000-4000-8000-0000000000b1');
  v_person := (v_result->>'personId')::uuid;
  IF v_person IS NULL OR v_person = v_existing THEN
    RAISE EXCEPTION 'T-2305-02 FAIL: separate did not create a new person: %', v_result;
  END IF;
  IF (SELECT display_name FROM public.brand_people WHERE id=v_person) <> 'Paystack Handoff Test' THEN
    RAISE EXCEPTION 'T-2305-02 FAIL: new person carries the wrong name';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.brand_person_source_links
                WHERE source_kind='order' AND source_id=v_order
                  AND detached_at IS NULL AND brand_person_id=v_person) THEN
    RAISE EXCEPTION 'T-2305-02 FAIL: separate left the source orphaned';
  END IF;
  IF (SELECT status FROM public.brand_person_identity_conflicts WHERE id=v_conflict) <> 'resolved_separate' THEN
    RAISE EXCEPTION 'T-2305-02 FAIL: conflict not marked resolved_separate';
  END IF;
  -- The separation record — without it outcome B is a lie.
  IF NOT EXISTS(SELECT 1 FROM public.brand_person_identity_separations
                WHERE brand_id=v_brand AND person_id=v_existing
                  AND normalized_name='paystack handoff test'
                  AND separated_person_id=v_person AND origin_conflict_id=v_conflict
                  AND decided_by=v_owner) THEN
    RAISE EXCEPTION 'T-2305-06 FAIL: no separation record — the next ingest re-merges them';
  END IF;

  -- T-6: re-ingest must NOT merge them back.
  SELECT count(*) INTO v_merges FROM public.brand_person_merge_events WHERE brand_id=v_brand;
  v_first := public.biz_resolve_brand_person_source_derived('order',v_order);
  IF v_first->>'linkOutcome' <> 'already_linked' THEN
    RAISE EXCEPTION 'T-2305-06 FAIL: re-ingest after separate returned %', v_first;
  END IF;
  IF (SELECT count(*) FROM public.brand_person_merge_events WHERE brand_id=v_brand) <> v_merges THEN
    RAISE EXCEPTION 'T-2305-06 FAIL: re-ingest merged two people a human separated';
  END IF;
  IF (SELECT record_status FROM public.brand_people WHERE id=v_existing) <> 'active'
     OR (SELECT record_status FROM public.brand_people WHERE id=v_person) <> 'active' THEN
    RAISE EXCEPTION 'T-2305-06 FAIL: one of the separated people is no longer active';
  END IF;

  -- T-7: a NEW order on the same shared phone under the separated name must go
  -- to the separated person and must NOT re-conflict or chain-merge.
  INSERT INTO public.orders(
    id,event_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
    payment_status,confirmed_at,created_at,currency,total_cents)
  VALUES(v_order2,v_event,NULL,'Paystack Handoff Test','paystacktest@example.test','+12015550199',
         'paid',now(),now(),'USD',3000);
  v_first := public.biz_resolve_brand_person_source_derived('order',v_order2);
  IF v_first->>'linkOutcome' <> 'linked' THEN
    RAISE EXCEPTION 'T-2305-07 FAIL: a new order under a separated name returned %', v_first;
  END IF;
  IF (v_first->>'personId')::uuid <> v_person THEN
    RAISE EXCEPTION 'T-2305-07 FAIL: new order went to the wrong person';
  END IF;
  IF (SELECT count(*) FROM public.brand_person_merge_events WHERE brand_id=v_brand) <> v_merges THEN
    RAISE EXCEPTION 'T-2305-07 FAIL: the chain-merge re-joined a separated pair';
  END IF;

  RAISE NOTICE 'T-2305-02/06/07 PASS: separate is durable and survives re-ingest';
END;
$happy_separate$;

-- ---------------------------------------------------------------- F-3 proof --
-- The detach-before-conflict path. A source that IS linked, re-ingested after
-- the person's canonical name changes, must not be stripped out of the book.
-- This is the path the merge button arms, and before the fix it silently
-- removed a paying customer who was already filed.
DO $f3$
DECLARE
  v_brand uuid := '23050000-0000-4000-8000-000000000010';
  v_event uuid := '23050000-0000-4000-8000-000000000020';
  v_order uuid := '23050000-0000-4000-8000-000000000050';
  v_first jsonb; v_person uuid; v_link uuid;
BEGIN
  INSERT INTO public.orders(
    id,event_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
    payment_status,confirmed_at,created_at,currency,total_cents)
  VALUES(v_order,v_event,NULL,'Original Name','f3@example.test','+15105550133',
         'paid',now(),now(),'USD',1000);
  v_first := public.biz_resolve_brand_person_source_derived('order',v_order);
  IF v_first->>'linkOutcome' <> 'linked' THEN
    RAISE EXCEPTION 'F-3 setup FAIL: first ingest returned %', v_first;
  END IF;
  v_person := (v_first->>'personId')::uuid;
  v_link := (v_first->>'sourceLinkId')::uuid;

  -- Simulate what a merge does: the canonical display_name becomes the OTHER
  -- name, so this source's name is now a mismatch on the very next re-ingest.
  UPDATE public.brand_people SET display_name='A Completely Different Name' WHERE id=v_person;
  UPDATE public.brand_person_names SET active=false, retired_at=now()
    WHERE brand_person_id=v_person AND active;

  v_first := public.biz_resolve_brand_person_source_derived('order',v_order);
  IF v_first->>'linkOutcome' <> 'conflict' THEN
    RAISE EXCEPTION 'F-3 FAIL: expected the refusal to still fire, got %', v_first;
  END IF;
  -- THE FIX: the refusal is correct, but the existing link must SURVIVE it.
  IF NOT EXISTS(SELECT 1 FROM public.brand_person_source_links
                WHERE id=v_link AND detached_at IS NULL AND brand_person_id=v_person) THEN
    RAISE EXCEPTION 'F-3 FAIL: a conflicting re-ingest DETACHED a person already in the book';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.brand_person_contact_methods
                WHERE brand_person_id=v_person AND record_state='active'
                  AND normalized_value='f3@example.test') THEN
    RAISE EXCEPTION 'F-3 FAIL: a conflicting re-ingest RETIRED the contact methods';
  END IF;
  RAISE NOTICE 'F-3 PASS: a conflicting re-ingest cannot strip a person already in the book';
END;
$f3$;

-- --------------------------------------------------- grouping (decision 1) ---
-- One human, two rails (order + ticket_holder). The list must show ONE card and
-- the resolve must close BOTH conflicts in one transaction, all or none —
-- otherwise an operator can answer the identical identity question two
-- different ways and leave one human filed under an existing person AND
-- duplicated as a new one.
DO $grouping$
DECLARE
  v_brand uuid := '23050000-0000-4000-8000-000000000010';
  v_event uuid := '23050000-0000-4000-8000-000000000020';
  v_owner uuid := '23050000-0000-4000-8000-000000000001';
  v_order uuid := '23050000-0000-4000-8000-000000000060';
  v_ticket uuid := '23050000-0000-4000-8000-000000000061';
  v_existing uuid; v_a jsonb; v_b jsonb; v_listing jsonb; v_row jsonb;
  v_ids uuid[]; v_result jsonb; v_person uuid; v_before bigint;
BEGIN
  -- The F-3 block deliberately leaves an unresolved conflict behind, so this
  -- case measures the DELTA rather than an absolute count.
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_before := (public.biz_list_brand_person_conflicts(v_brand,50)->>'openCount')::bigint;
  INSERT INTO public.brand_people(brand_id,display_name) VALUES(v_brand,'Legal')
    RETURNING id INTO v_existing;
  INSERT INTO public.brand_person_contact_methods(
    brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
  VALUES(v_brand,v_existing,'email','legal@example.test','brand_owned',true,true);

  INSERT INTO public.orders(
    id,event_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
    payment_status,confirmed_at,created_at,currency,total_cents)
  VALUES(v_order,v_event,NULL,'Legal Department','legal@example.test','+15105550177',
         'paid',now(),now(),'USD',1000);
  INSERT INTO public.ticket_types(id,event_id,name)
  VALUES('23050000-0000-4000-8000-000000000062',v_event,'Issue 2305 Tier');
  INSERT INTO public.tickets(id,event_id,order_id,ticket_type_id,qr_code,created_at)
  VALUES(v_ticket,v_event,v_order,'23050000-0000-4000-8000-000000000062','issue-2305-qr',now());

  v_a := public.biz_resolve_brand_person_source_derived('order',v_order);
  v_b := public.biz_resolve_brand_person_source_derived('ticket_holder',v_ticket);
  IF v_a->>'linkOutcome' <> 'conflict' OR v_b->>'linkOutcome' <> 'conflict' THEN
    RAISE EXCEPTION 'GROUP setup FAIL: expected two conflicts, got % / %', v_a, v_b;
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_listing := public.biz_list_brand_person_conflicts(v_brand,50);
  IF (v_listing->>'openCount')::bigint <> v_before + 1 THEN
    RAISE EXCEPTION 'GROUP FAIL: two rails for ONE human must add ONE card, went % -> %',
      v_before, v_listing->>'openCount';
  END IF;
  SELECT r INTO v_row FROM jsonb_array_elements(v_listing->'rows') r
    WHERE r->'incoming'->>'displayName' = 'Legal Department';
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'GROUP FAIL: the grouped card is absent from the listing';
  END IF;
  IF jsonb_array_length(v_row->'conflictIds') <> 2 THEN
    RAISE EXCEPTION 'GROUP FAIL: the card must carry both conflict ids, got %', v_row->'conflictIds';
  END IF;
  IF jsonb_array_length(v_row->'sourceKinds') <> 2 THEN
    RAISE EXCEPTION 'GROUP FAIL: the card must name both rails, got %', v_row->'sourceKinds';
  END IF;
  SELECT array_agg(value::uuid) INTO v_ids
    FROM jsonb_array_elements_text(v_row->'conflictIds');

  v_result := public.biz_resolve_brand_person_conflict(
    v_brand,v_ids,'merge',v_existing,'23050000-0000-4000-8000-0000000000c1');
  v_person := (v_result->>'personId')::uuid;
  -- ONE decision closed BOTH, and BOTH sources are linked to the same human.
  IF (SELECT count(*) FROM public.brand_person_identity_conflicts
      WHERE id = ANY(v_ids) AND status='resolved_merge') <> 2 THEN
    RAISE EXCEPTION 'GROUP FAIL: one decision did not close the whole group';
  END IF;
  IF (SELECT count(*) FROM public.brand_person_source_links
      WHERE detached_at IS NULL AND brand_person_id=v_person
        AND ((source_kind='order' AND source_id=v_order)
          OR (source_kind='ticket_holder' AND source_id=v_ticket))) <> 2 THEN
    RAISE EXCEPTION 'GROUP FAIL: both sources must be linked to the one person';
  END IF;
  IF (public.biz_list_brand_person_conflicts(v_brand,50)->>'openCount')::bigint <> v_before THEN
    RAISE EXCEPTION 'GROUP FAIL: the group did not leave the queue';
  END IF;
  RAISE NOTICE 'GROUP PASS: one human = one card = one decision = one transaction';
END;
$grouping$;

-- ------------------------------------------------------------------ T-9 -----
-- Graph-only contacts must NEVER surface in the queue (#876 export boundary).
DO $graph_only$
DECLARE
  v_brand uuid := '23050000-0000-4000-8000-000000000010';
  v_event uuid := '23050000-0000-4000-8000-000000000020';
  v_owner uuid := '23050000-0000-4000-8000-000000000001';
  v_order uuid := '23050000-0000-4000-8000-000000000070';
  v_existing uuid; v_first jsonb; v_listing jsonb; v_dump text;
BEGIN
  INSERT INTO public.brand_people(brand_id,display_name) VALUES(v_brand,'Ring Two')
    RETURNING id INTO v_existing;
  INSERT INTO public.brand_person_contact_methods(
    brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
  VALUES(v_brand,v_existing,'phone','+15105550188','brand_owned',true,true);
  -- A graph_only address on the SAME person. It must not appear in the payload.
  INSERT INTO public.brand_person_contact_methods(
    brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
  VALUES(v_brand,v_existing,'email','graphonly@example.test','graph_only',false,false);

  INSERT INTO public.orders(
    id,event_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
    payment_status,confirmed_at,created_at,currency,total_cents)
  VALUES(v_order,v_event,NULL,'Ring Two Buyer','ringtwo@example.test','+15105550188',
         'paid',now(),now(),'USD',1000);
  v_first := public.biz_resolve_brand_person_source_derived('order',v_order);
  IF v_first->>'linkOutcome' <> 'conflict' THEN
    RAISE EXCEPTION 'T-2305-09 setup FAIL: %', v_first;
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_listing := public.biz_list_brand_person_conflicts(v_brand,50);
  v_dump := v_listing::text;
  IF position('graphonly@example.test' IN v_dump) > 0 THEN
    RAISE EXCEPTION 'T-2305-09 FAIL: a graph_only address leaked into the queue payload';
  END IF;
  RAISE NOTICE 'T-2305-09 PASS: graph-only data never surfaces in the queue';
END;
$graph_only$;

-- ----------------------------------------------------------------- T-10 -----
-- Every error path returns its typed code, never a raw PG error.
DO $errors$
DECLARE
  v_brand uuid := '23050000-0000-4000-8000-000000000010';
  v_owner uuid := '23050000-0000-4000-8000-000000000001';
  v_caught text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);

  BEGIN
    PERFORM public.biz_resolve_brand_person_conflict(v_brand,ARRAY[gen_random_uuid()],'merge',NULL,gen_random_uuid());
    RAISE EXCEPTION 'T-2305-10 FAIL: unknown conflict id was accepted';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    GET STACKED DIAGNOSTICS v_caught = MESSAGE_TEXT;
    IF v_caught <> 'people_conflict_not_found' THEN
      RAISE EXCEPTION 'T-2305-10 FAIL: expected people_conflict_not_found, got %', v_caught;
    END IF;
  END;

  BEGIN
    PERFORM public.biz_resolve_brand_person_conflict(v_brand,ARRAY[gen_random_uuid()],'sideways',NULL,gen_random_uuid());
    RAISE EXCEPTION 'T-2305-10 FAIL: an invalid resolution was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_caught = MESSAGE_TEXT;
    IF v_caught <> 'people_resolution_invalid' THEN
      RAISE EXCEPTION 'T-2305-10 FAIL: expected people_resolution_invalid, got %', v_caught;
    END IF;
  END;

  BEGIN
    PERFORM public.biz_resolve_brand_person_conflict(v_brand,ARRAY[]::uuid[],'merge',NULL,gen_random_uuid());
    RAISE EXCEPTION 'T-2305-10 FAIL: an empty conflict array was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_caught = MESSAGE_TEXT;
    IF v_caught <> 'people_conflict_candidate_invalid' THEN
      RAISE EXCEPTION 'T-2305-10 FAIL: expected people_conflict_candidate_invalid, got %', v_caught;
    END IF;
  END;

  BEGIN
    PERFORM public.biz_resolve_brand_person_conflict(v_brand,ARRAY[gen_random_uuid()],'merge',NULL,NULL);
    RAISE EXCEPTION 'T-2305-10 FAIL: a NULL client request id was accepted';
  EXCEPTION WHEN SQLSTATE '23505' THEN
    GET STACKED DIAGNOSTICS v_caught = MESSAGE_TEXT;
    IF v_caught <> 'people_idempotency_conflict' THEN
      RAISE EXCEPTION 'T-2305-10 FAIL: expected people_idempotency_conflict, got %', v_caught;
    END IF;
  END;

  BEGIN
    PERFORM public.biz_list_brand_person_conflicts(v_brand,0);
    RAISE EXCEPTION 'T-2305-10 FAIL: limit 0 was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_caught = MESSAGE_TEXT;
    IF v_caught <> 'people_limit_invalid' THEN
      RAISE EXCEPTION 'T-2305-10 FAIL: expected people_limit_invalid, got %', v_caught;
    END IF;
  END;

  -- A non-member sees people_forbidden, not data.
  PERFORM set_config('request.jwt.claim.sub','23050000-0000-4000-8000-00000000ffff',true);
  BEGIN
    PERFORM public.biz_list_brand_person_conflicts(v_brand,50);
    RAISE EXCEPTION 'T-2305-10 FAIL: a non-member read the queue';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'T-2305-10 PASS: every error path returns its typed code';
END;
$errors$;

-- ----------------------------------------------------------------- T-14 -----
-- Reversibility. Every merge this feature creates goes through
-- biz_merge_brand_people, which writes a manifest rich enough to un-merge.
-- NOTE: this proves the LEDGER is sound. It does NOT mean the product offers
-- Split — there is no UI and no client grant, which is exactly why no copy in
-- this feature may claim a decision can be undone.
DO $reversible$
DECLARE
  v_brand uuid := '23050000-0000-4000-8000-000000000010';
  v_event uuid := '23050000-0000-4000-8000-000000000020';
  v_owner uuid := '23050000-0000-4000-8000-000000000001';
  v_order uuid := '23050000-0000-4000-8000-000000000080';
  v_a uuid; v_b uuid; v_first jsonb; v_conflict uuid; v_result jsonb;
  v_merge uuid; v_reversal jsonb;
BEGIN
  -- Two records sharing the incoming phone => a 2-candidate (N-way) conflict.
  INSERT INTO public.brand_people(brand_id,display_name) VALUES(v_brand,'Nway One') RETURNING id INTO v_a;
  INSERT INTO public.brand_people(brand_id,display_name) VALUES(v_brand,'Nway Two') RETURNING id INTO v_b;
  INSERT INTO public.brand_person_contact_methods(
    brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
  VALUES(v_brand,v_a,'phone','+15105550199','brand_owned',true,true),
         (v_brand,v_b,'phone','+15105550199','brand_owned',true,true);

  INSERT INTO public.orders(
    id,event_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
    payment_status,confirmed_at,created_at,currency,total_cents)
  VALUES(v_order,v_event,NULL,'Nway Buyer','nway@example.test','+15105550199',
         'paid',now(),now(),'USD',1000);
  v_first := public.biz_resolve_brand_person_source_derived('order',v_order);
  IF v_first->>'linkOutcome' <> 'conflict' THEN
    RAISE EXCEPTION 'T-2305-14 setup FAIL: %', v_first;
  END IF;
  v_conflict := (v_first->>'conflictId')::uuid;

  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_result := public.biz_resolve_brand_person_conflict(
    v_brand,ARRAY[v_conflict],'merge',v_a,'23050000-0000-4000-8000-0000000000d1');
  -- The N-1 other candidates are collapsed, and the UI discloses that before
  -- the operator confirms.
  IF jsonb_array_length(v_result->'mergedPersonIds') <> 1 THEN
    RAISE EXCEPTION 'T-2305-14 FAIL: the chain-merge did not collapse the other candidate: %', v_result;
  END IF;
  SELECT id INTO v_merge FROM public.brand_person_merge_events
    WHERE brand_id=v_brand AND winner_person_id=v_a AND loser_person_id=v_b AND status='active';
  IF v_merge IS NULL THEN
    RAISE EXCEPTION 'T-2305-14 FAIL: no merge event was written';
  END IF;
  IF (SELECT acted_by FROM public.brand_person_merge_events WHERE id=v_merge) <> v_owner THEN
    RAISE EXCEPTION 'T-2305-14 FAIL: the merge is not attributed to the acting human';
  END IF;
  IF (SELECT reason FROM public.brand_person_merge_events WHERE id=v_merge) <> 'manual_resolution' THEN
    RAISE EXCEPTION 'T-2305-14 FAIL: merge reason should be manual_resolution';
  END IF;
  IF (SELECT evidence_source_link_id FROM public.brand_person_merge_events WHERE id=v_merge) IS NULL THEN
    RAISE EXCEPTION 'T-2305-14 FAIL: the merge carries no evidence link';
  END IF;

  v_reversal := public.biz_reverse_brand_person_merge(v_merge,v_owner);
  IF v_reversal->>'status' <> 'reversed' THEN
    RAISE EXCEPTION 'T-2305-14 FAIL: the merge could not be reversed: %', v_reversal;
  END IF;
  IF (SELECT record_status FROM public.brand_people WHERE id=v_b) <> 'active' THEN
    RAISE EXCEPTION 'T-2305-14 FAIL: the reversal did not restore the loser';
  END IF;
  RAISE NOTICE 'T-2305-14 PASS: merges are auditable and reversible in the ledger';
END;
$reversible$;

-- ------------------------------------------------------------------- G-3 ----
-- The live conflicts are the tester's evidence and resolution is a human act.
-- No migration may resolve them as data.
DO $no_data_migration$
BEGIN
  IF EXISTS(SELECT 1 FROM public.brand_person_identity_conflicts
            WHERE status <> 'open' AND resolved_by IS NULL) THEN
    RAISE EXCEPTION 'G-3 FAIL: a conflict was resolved with no acting human';
  END IF;
  RAISE NOTICE 'G-3 PASS: every resolved conflict carries the human who decided it';
END;
$no_data_migration$;

ROLLBACK;
