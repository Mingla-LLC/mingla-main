-- #2305 REWORK — implementor proof for the tester's FAIL findings.
-- Apply the full chain first. Fixtures are transaction-bound and roll back.
--
-- The spine here is P1-1: the tester's exact sequence. After a `separate`, the
-- ORIGINAL buyer's next order must link straight back to the ORIGINAL person —
-- no conflict, no third record, no merge.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id) VALUES
  ('23059000-0000-4000-8000-000000000001'),
  ('23059000-0000-4000-8000-000000000004');
INSERT INTO public.creator_accounts(id) VALUES('23059000-0000-4000-8000-000000000001');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
VALUES('23059000-0000-4000-8000-000000000010','23059000-0000-4000-8000-000000000001',
       'Issue 2305 Rework','issue-2305-rework','USD',now(),now());
INSERT INTO public.events(
  id,brand_id,created_by,event_type,title,slug,description,status,visibility,
  currency,timezone,party_types,rsvp_approval_mode,rsvp_discoverable,created_at,updated_at,theme
) VALUES(
  '23059000-0000-4000-8000-000000000020','23059000-0000-4000-8000-000000000010',
  '23059000-0000-4000-8000-000000000001','event','Rework Event','issue-2305-rework-event','fixture',
  'scheduled','public','USD','UTC',ARRAY['house-party'],'auto',false,now(),now(),'{}'::jsonb);

-- ------------------------------------------------------------------- P1-1 ---
-- The tester's sequence, verbatim: A on the shared store-review demo phone, a
-- genuinely different human B conflicts on it and is resolved SEPARATE, then
-- A's OWN next order arrives. Before the fix that order re-conflicted and both
-- buttons were wrong.
DO $p1_1$
DECLARE
  v_brand uuid := '23059000-0000-4000-8000-000000000010';
  v_event uuid := '23059000-0000-4000-8000-000000000020';
  v_owner uuid := '23059000-0000-4000-8000-000000000001';
  v_a uuid; v_b uuid; v_r jsonb; v_conflict uuid; v_res jsonb;
  v_merges_before integer; v_people_before integer; v_people_after integer;
BEGIN
  INSERT INTO public.brand_people(brand_id,display_name) VALUES(v_brand,'Free Proof 2136') RETURNING id INTO v_a;
  INSERT INTO public.brand_person_names(brand_person_id,display_name,normalized_name,name_kind)
  VALUES(v_a,'Free Proof 2136','free proof 2136','primary');
  INSERT INTO public.brand_person_contact_methods(
    brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
  VALUES(v_brand,v_a,'phone','+12015550199','brand_owned',true,true);

  -- B's order conflicts and is resolved SEPARATE.
  INSERT INTO public.orders(id,event_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
    payment_status,confirmed_at,created_at,currency,total_cents)
  VALUES('23059000-0000-4000-8000-000000000030',v_event,NULL,'Paystack Handoff Test',
         'paystacktest@example.test','+12015550199','paid',now(),now(),'USD',1000);
  v_r := public.biz_resolve_brand_person_source_derived('order','23059000-0000-4000-8000-000000000030');
  IF v_r->>'linkOutcome'<>'conflict' THEN RAISE EXCEPTION 'P1-1 setup: expected conflict, got %',v_r; END IF;
  v_conflict := (v_r->>'conflictId')::uuid;

  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_res := public.biz_resolve_brand_person_conflict(
    v_brand,ARRAY[v_conflict],'separate',NULL,'23059000-0000-4000-8000-0000000000a1');
  v_b := (v_res->>'personId')::uuid;

  -- BOTH directions of the separation must exist. The reverse is what was missing.
  IF NOT EXISTS(SELECT 1 FROM public.brand_person_identity_separations
                WHERE brand_id=v_brand AND person_id=v_a AND normalized_name='paystack handoff test') THEN
    RAISE EXCEPTION 'P1-1 FAIL: forward separation missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.brand_person_identity_separations
                WHERE brand_id=v_brand AND person_id=v_b AND normalized_name='free proof 2136') THEN
    RAISE EXCEPTION 'P1-1 FAIL: REVERSE separation missing — A''s own next order will re-conflict';
  END IF;

  SELECT count(*) INTO v_merges_before FROM public.brand_person_merge_events WHERE brand_id=v_brand;
  SELECT count(*) INTO v_people_before FROM public.brand_people WHERE brand_id=v_brand AND record_status='active';

  -- THE MOMENT OF TRUTH: A's own next order, under A's own name, on the shared phone.
  INSERT INTO public.orders(id,event_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
    payment_status,confirmed_at,created_at,currency,total_cents)
  VALUES('23059000-0000-4000-8000-000000000031',v_event,NULL,'Free Proof 2136',
         'freeproof@example.test','+12015550199','paid',now(),now(),'USD',2000);
  v_r := public.biz_resolve_brand_person_source_derived('order','23059000-0000-4000-8000-000000000031');

  IF v_r->>'linkOutcome'<>'linked' THEN
    RAISE EXCEPTION 'P1-1 FAIL: the ORIGINAL buyer re-conflicted after a separate: %',v_r;
  END IF;
  IF (v_r->>'personId')::uuid <> v_a THEN
    RAISE EXCEPTION 'P1-1 FAIL: A''s own order went to % instead of A',(v_r->>'personId');
  END IF;
  SELECT count(*) INTO v_people_after FROM public.brand_people WHERE brand_id=v_brand AND record_status='active';
  IF v_people_after <> v_people_before THEN
    RAISE EXCEPTION 'P1-1 FAIL: a THIRD person was created (% -> %)',v_people_before,v_people_after;
  END IF;
  IF (SELECT count(*) FROM public.brand_person_merge_events WHERE brand_id=v_brand) <> v_merges_before THEN
    RAISE EXCEPTION 'P1-1 FAIL: the separated pair was merged back together';
  END IF;
  IF (SELECT record_status FROM public.brand_people WHERE id=v_b) <> 'active' THEN
    RAISE EXCEPTION 'P1-1 FAIL: B was collapsed';
  END IF;
  RAISE NOTICE 'P1-1 PASS: after a separate, the ORIGINAL buyer links straight back to themselves — no conflict, no third record, no merge';
END;
$p1_1$;

-- ----------------------------------------------------------------- P1-1(b) --
-- The automatic chain-merge must refuse a separated pair even if both somehow
-- match the incoming name. No human stands behind that loop, so it fails safe.
DO $p1_1b$
DECLARE
  v_brand uuid := '23059000-0000-4000-8000-000000000010';
  v_event uuid := '23059000-0000-4000-8000-000000000020';
  v_x uuid; v_y uuid; v_r jsonb; v_merges integer;
BEGIN
  INSERT INTO public.brand_people(brand_id,display_name) VALUES(v_brand,'Same Name') RETURNING id INTO v_x;
  INSERT INTO public.brand_people(brand_id,display_name) VALUES(v_brand,'Same Name') RETURNING id INTO v_y;
  INSERT INTO public.brand_person_contact_methods(
    brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
  VALUES(v_brand,v_x,'phone','+15105550144','brand_owned',true,true),
         (v_brand,v_y,'phone','+15105550144','brand_owned',true,true);
  -- A human has already declared these two different people.
  INSERT INTO public.brand_person_identity_separations(
    brand_id,person_id,normalized_name,separated_person_id,origin_conflict_id,decided_by)
  SELECT v_brand,v_x,'same name',v_y,c.id,NULL FROM public.brand_person_identity_conflicts c LIMIT 1;

  SELECT count(*) INTO v_merges FROM public.brand_person_merge_events WHERE brand_id=v_brand;
  INSERT INTO public.orders(id,event_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
    payment_status,confirmed_at,created_at,currency,total_cents)
  VALUES('23059000-0000-4000-8000-000000000040',v_event,NULL,'Same Name',
         'samename@example.test','+15105550144','paid',now(),now(),'USD',1000);
  v_r := public.biz_resolve_brand_person_source_derived('order','23059000-0000-4000-8000-000000000040');
  IF (SELECT count(*) FROM public.brand_person_merge_events WHERE brand_id=v_brand) <> v_merges THEN
    RAISE EXCEPTION 'P1-1(b) FAIL: the automatic chain-merge collapsed a separated pair: %',v_r;
  END IF;
  IF (SELECT record_status FROM public.brand_people WHERE id=v_y) <> 'active' THEN
    RAISE EXCEPTION 'P1-1(b) FAIL: the separated person was merged away';
  END IF;
  RAISE NOTICE 'P1-1(b) PASS: the automatic chain-merge never collapses a pair the ledger says are different people';
END;
$p1_1b$;

-- ------------------------------------------------------------------- P1-2 ---
-- The vanished-source close must COMMIT. The tester's retest, verbatim: seed a
-- conflict, delete its source, resolve, then list — openCount must reach 0.
DO $p1_2$
DECLARE
  v_brand uuid := '23059000-0000-4000-8000-000000000010';
  v_event uuid := '23059000-0000-4000-8000-000000000020';
  v_owner uuid := '23059000-0000-4000-8000-000000000001';
  v_p uuid; v_r jsonb; v_conflict uuid; v_res jsonb; v_before bigint; v_row jsonb;
BEGIN
  INSERT INTO public.brand_people(brand_id,display_name) VALUES(v_brand,'Vanish Existing') RETURNING id INTO v_p;
  INSERT INTO public.brand_person_contact_methods(
    brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
  VALUES(v_brand,v_p,'phone','+15105550155','brand_owned',true,true);
  INSERT INTO public.orders(id,event_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
    payment_status,confirmed_at,created_at,currency,total_cents)
  VALUES('23059000-0000-4000-8000-000000000050',v_event,NULL,'Vanishing Buyer',
         'vanish@example.test','+15105550155','paid',now(),now(),'USD',1000);
  v_r := public.biz_resolve_brand_person_source_derived('order','23059000-0000-4000-8000-000000000050');
  IF v_r->>'linkOutcome'<>'conflict' THEN RAISE EXCEPTION 'P1-2 setup: %',v_r; END IF;
  v_conflict := (v_r->>'conflictId')::uuid;

  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_before := (public.biz_list_brand_person_conflicts(v_brand,50)->>'openCount')::bigint;

  DELETE FROM public.orders WHERE id='23059000-0000-4000-8000-000000000050';

  -- The list must now mark it dismissible, with a PROVEN reason.
  SELECT r INTO v_row FROM jsonb_array_elements(
    public.biz_list_brand_person_conflicts(v_brand,50)->'rows') r
  WHERE (r->'conflictIds')->>0 = v_conflict::text;
  IF v_row->>'dismissibleReason' <> 'source_row_absent' THEN
    RAISE EXCEPTION 'P1-2 FAIL: vanished source not reported dismissible: %',v_row;
  END IF;
  IF NOT (v_row->>'canDismiss')::boolean THEN
    RAISE EXCEPTION 'P1-2 FAIL: rank 60 cannot dismiss a provably absent source';
  END IF;

  v_res := public.biz_resolve_brand_person_conflict(
    v_brand,ARRAY[v_conflict],'dismiss',NULL,'23059000-0000-4000-8000-0000000000b1');
  IF v_res->>'dismissedReason' <> 'source_row_absent' THEN
    RAISE EXCEPTION 'P1-2 FAIL: dismiss did not report its reason: %',v_res;
  END IF;

  -- THE WHOLE POINT: the write COMMITTED. Before the fix the RAISE rolled it back.
  IF (SELECT status FROM public.brand_person_identity_conflicts WHERE id=v_conflict) <> 'resolved_dismissed' THEN
    RAISE EXCEPTION 'P1-2 FAIL: the dismissing UPDATE rolled itself back — status is still %',
      (SELECT status FROM public.brand_person_identity_conflicts WHERE id=v_conflict);
  END IF;
  IF (SELECT resolved_at FROM public.brand_person_identity_conflicts WHERE id=v_conflict) IS NULL
     OR (SELECT resolved_by FROM public.brand_person_identity_conflicts WHERE id=v_conflict) <> v_owner THEN
    RAISE EXCEPTION 'P1-2 FAIL: dismissed row does not satisfy the resolution shape';
  END IF;
  -- It links nothing, because there was nothing to link.
  IF EXISTS(SELECT 1 FROM public.brand_person_source_links
            WHERE source_kind='order' AND source_id='23059000-0000-4000-8000-000000000050'
              AND detached_at IS NULL) THEN
    RAISE EXCEPTION 'P1-2 FAIL: dismiss invented a link';
  END IF;
  IF (public.biz_list_brand_person_conflicts(v_brand,50)->>'openCount')::bigint <> v_before - 1 THEN
    RAISE EXCEPTION 'P1-2 FAIL: the badge cannot reach zero';
  END IF;
  RAISE NOTICE 'P1-2 PASS: a vanished source dismisses, the write COMMITS, it links nothing, and the badge clears';
END;
$p1_2$;

-- ---------------------------------------- absence is PROVEN, never inferred --
-- The rule that keeps `dismiss` from becoming silent data loss: a row that is
-- merely filtered out of the subject derivation is PRESENT, and must not be
-- dismissable.
DO $absence$
DECLARE
  v_brand uuid := '23059000-0000-4000-8000-000000000010';
  v_event uuid := '23059000-0000-4000-8000-000000000020';
  v_owner uuid := '23059000-0000-4000-8000-000000000001';
  v_p uuid; v_r jsonb; v_conflict uuid; v_caught text;
BEGIN
  INSERT INTO public.brand_people(brand_id,display_name) VALUES(v_brand,'Filtered Existing') RETURNING id INTO v_p;
  INSERT INTO public.brand_person_contact_methods(
    brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
  VALUES(v_brand,v_p,'phone','+15105550166','brand_owned',true,true);
  INSERT INTO public.orders(id,event_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
    payment_status,confirmed_at,created_at,currency,total_cents)
  VALUES('23059000-0000-4000-8000-000000000060',v_event,NULL,'Filtered Buyer',
         'filtered@example.test','+15105550166','paid',now(),now(),'USD',1000);
  v_r := public.biz_resolve_brand_person_source_derived('order','23059000-0000-4000-8000-000000000060');
  v_conflict := (v_r->>'conflictId')::uuid;

  -- The order still EXISTS; it has merely left the payment-status filter, so
  -- the subject derivation returns nothing. That is NOT absence.
  UPDATE public.orders SET payment_status='pending' WHERE id='23059000-0000-4000-8000-000000000060';
  IF public.biz_brand_person_conflict_subject('order','23059000-0000-4000-8000-000000000060') IS NOT NULL THEN
    RAISE EXCEPTION 'absence setup: expected an underivable subject';
  END IF;
  IF public.biz_brand_person_conflict_absence('order','23059000-0000-4000-8000-000000000060') IS NOT NULL THEN
    RAISE EXCEPTION 'ABSENCE FAIL: a PRESENT row was reported absent — that is silent data loss';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  BEGIN
    PERFORM public.biz_resolve_brand_person_conflict(
      v_brand,ARRAY[v_conflict],'dismiss',NULL,gen_random_uuid());
    RAISE EXCEPTION 'ABSENCE FAIL: a present-but-unfilterable buyer was dismissed';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_caught = MESSAGE_TEXT;
    IF v_caught <> 'people_conflict_not_dismissable' THEN
      RAISE EXCEPTION 'ABSENCE FAIL: expected people_conflict_not_dismissable, got %',v_caught;
    END IF;
  END;
  IF (SELECT status FROM public.brand_person_identity_conflicts WHERE id=v_conflict) <> 'open' THEN
    RAISE EXCEPTION 'ABSENCE FAIL: the refused dismiss still changed the row';
  END IF;
  RAISE NOTICE 'ABSENCE PASS: a present row is never dismissable, so a lookup miss can never become data loss';
END;
$absence$;

-- ------------------------------------------------------------------- P2-1 ---
DO $p2_1$
DECLARE
  v_brand uuid := '23059000-0000-4000-8000-000000000010';
  v_event uuid := '23059000-0000-4000-8000-000000000020';
  v_owner uuid := '23059000-0000-4000-8000-000000000001';
  v_user uuid := '23059000-0000-4000-8000-000000000004';
  v_p uuid; v_r jsonb; v_conflict uuid; v_res jsonb; v_new uuid;
BEGIN
  INSERT INTO public.brand_people(brand_id,display_name,linked_user_id)
  VALUES(v_brand,'Household One',v_user) RETURNING id INTO v_p;
  INSERT INTO public.brand_person_contact_methods(
    brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
  VALUES(v_brand,v_p,'phone','+15105550177','brand_owned',true,true);
  INSERT INTO public.orders(id,event_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
    payment_status,confirmed_at,created_at,currency,total_cents)
  VALUES('23059000-0000-4000-8000-000000000070',v_event,v_user,'Household Two',
         'household2@example.test','+15105550177','paid',now(),now(),'USD',1000);
  v_r := public.biz_resolve_brand_person_source_derived('order','23059000-0000-4000-8000-000000000070');
  IF v_r->>'linkOutcome'<>'conflict' THEN RAISE EXCEPTION 'P2-1 setup: %',v_r; END IF;
  v_conflict := (v_r->>'conflictId')::uuid;

  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  -- SPEC 4.4 separate step 1: DEGRADE to NULL, do not raise. Before the fix the
  -- only action the system permitted on a shared household phone was the collapse.
  v_res := public.biz_resolve_brand_person_conflict(
    v_brand,ARRAY[v_conflict],'separate',NULL,'23059000-0000-4000-8000-0000000000c1');
  v_new := (v_res->>'personId')::uuid;
  IF v_new IS NULL OR v_new = v_p THEN RAISE EXCEPTION 'P2-1 FAIL: separate did not create a person: %',v_res; END IF;
  IF (SELECT linked_user_id FROM public.brand_people WHERE id=v_new) IS NOT NULL THEN
    RAISE EXCEPTION 'P2-1 FAIL: the colliding user was attached to the new person anyway';
  END IF;
  IF (SELECT linked_user_id FROM public.brand_people WHERE id=v_p) <> v_user THEN
    RAISE EXCEPTION 'P2-1 FAIL: the original holder lost its linked_user_id';
  END IF;
  RAISE NOTICE 'P2-1 PASS: separate degrades linked_user_id to NULL on collision instead of forcing the collapse';
END;
$p2_1$;

-- ------------------------------------------------------------- P2-4 / P3-1 --
DO $p2_4$
DECLARE
  v_brand uuid := '23059000-0000-4000-8000-000000000010';
  v_event uuid := '23059000-0000-4000-8000-000000000020';
  v_owner uuid := '23059000-0000-4000-8000-000000000001';
  v_p uuid; v_other uuid; v_r jsonb; v_ids uuid[]; v_res jsonb; v_row jsonb; v_methods text[];
BEGIN
  INSERT INTO public.brand_people(brand_id,display_name) VALUES(v_brand,'Prov Existing') RETURNING id INTO v_p;
  INSERT INTO public.brand_person_names(brand_person_id,display_name,normalized_name,name_kind)
  VALUES(v_p,'Prov Existing','prov existing','primary');
  INSERT INTO public.brand_people(brand_id,display_name) VALUES(v_brand,'Prov Second') RETURNING id INTO v_other;
  INSERT INTO public.brand_person_contact_methods(
    brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,is_primary)
  VALUES(v_brand,v_p,'email','prov@example.test','brand_owned',true,true),
         (v_brand,v_other,'email','prov@example.test','brand_owned',true,true);

  INSERT INTO public.orders(id,event_id,buyer_user_id,buyer_name,buyer_email,buyer_phone_e164,
    payment_status,confirmed_at,created_at,currency,total_cents)
  VALUES('23059000-0000-4000-8000-000000000080',v_event,NULL,'Prov Buyer',
         'prov@example.test','+15105550188','paid',now(),now(),'USD',1000);
  INSERT INTO public.ticket_types(id,event_id,name)
  VALUES('23059000-0000-4000-8000-000000000082',v_event,'Rework Tier');
  INSERT INTO public.tickets(id,event_id,order_id,ticket_type_id,qr_code,created_at)
  VALUES('23059000-0000-4000-8000-000000000081',v_event,'23059000-0000-4000-8000-000000000080',
         '23059000-0000-4000-8000-000000000082','rework-qr',now());
  PERFORM public.biz_resolve_brand_person_source_derived('order','23059000-0000-4000-8000-000000000080');
  PERFORM public.biz_resolve_brand_person_source_derived('ticket_holder','23059000-0000-4000-8000-000000000081');

  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  SELECT r INTO v_row FROM jsonb_array_elements(
    public.biz_list_brand_person_conflicts(v_brand,50)->'rows') r
  WHERE r->'incoming'->>'displayName'='Prov Buyer';
  SELECT array_agg(value::uuid) INTO v_ids FROM jsonb_array_elements_text(v_row->'conflictIds');

  v_res := public.biz_resolve_brand_person_conflict(
    v_brand,v_ids,'merge',v_p,'23059000-0000-4000-8000-0000000000d1');

  -- P3-1: mergedPersonIds must name the person that was COLLAPSED, not the survivor.
  IF NOT (v_res->'mergedPersonIds' @> to_jsonb(ARRAY[v_other::text])) THEN
    RAISE EXCEPTION 'P3-1 FAIL: mergedPersonIds should name the loser %, got %',v_other,v_res->'mergedPersonIds';
  END IF;
  IF v_res->'mergedPersonIds' @> to_jsonb(ARRAY[v_p::text]) THEN
    RAISE EXCEPTION 'P3-1 FAIL: mergedPersonIds names the SURVIVOR';
  END IF;

  -- P2-4: re-ingest both sources; BOTH links keep manual_resolution.
  PERFORM public.biz_resolve_brand_person_source_derived('order','23059000-0000-4000-8000-000000000080');
  PERFORM public.biz_resolve_brand_person_source_derived('ticket_holder','23059000-0000-4000-8000-000000000081');
  SELECT array_agg(link_method ORDER BY source_kind) INTO v_methods
  FROM public.brand_person_source_links
  WHERE detached_at IS NULL
    AND ((source_kind='order' AND source_id='23059000-0000-4000-8000-000000000080')
      OR (source_kind='ticket_holder' AND source_id='23059000-0000-4000-8000-000000000081'));
  IF v_methods <> ARRAY['manual_resolution','manual_resolution'] THEN
    RAISE EXCEPTION 'P2-4 FAIL: a re-ingest erased the human decision — link methods are %',v_methods;
  END IF;
  RAISE NOTICE 'P2-4 / P3-1 PASS: every source of a group keeps manual_resolution across re-ingest, and the receipt names the collapsed person';
END;
$p2_4$;

-- --------------------------------------------------------- dismiss replay --
-- SC-12 / exact-head TEST FAIL 5353482286. Dismiss intentionally writes no
-- source link, so replay must not use the merge/separate link reconstruction
-- query. Both an exact request-id retry and a fresh request-id retry are the
-- same durable success. A different requested outcome remains a typed conflict.
DO $dismiss_replay$
DECLARE
  v_brand uuid := '23059000-0000-4000-8000-000000000010';
  v_owner uuid := '23059000-0000-4000-8000-000000000001';
  v_conflict uuid;
  v_same jsonb;
  v_fresh jsonb;
  v_caught text;
BEGIN
  SELECT id INTO STRICT v_conflict
  FROM public.brand_person_identity_conflicts
  WHERE brand_id=v_brand
    AND source_kind='order'
    AND source_id='23059000-0000-4000-8000-000000000050'
    AND status='resolved_dismissed';

  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  v_same := public.biz_resolve_brand_person_conflict(
    v_brand,ARRAY[v_conflict],'dismiss',NULL,'23059000-0000-4000-8000-0000000000b1');
  v_fresh := public.biz_resolve_brand_person_conflict(
    v_brand,ARRAY[v_conflict],'dismiss',NULL,'23059000-0000-4000-8000-0000000000b2');

  IF v_same->>'resolution'<>'dismiss'
     OR v_same->'personId'<>'null'::jsonb
     OR v_same->'links'<>'[]'::jsonb
     OR v_same->'mergedPersonIds'<>'[]'::jsonb
     OR v_same->>'replayed'<>'true' THEN
    RAISE EXCEPTION 'DISMISS-REPLAY FAIL: same request id returned %',v_same;
  END IF;
  IF v_fresh->>'resolution'<>'dismiss'
     OR v_fresh->'personId'<>'null'::jsonb
     OR v_fresh->'links'<>'[]'::jsonb
     OR v_fresh->'mergedPersonIds'<>'[]'::jsonb
     OR v_fresh->>'replayed'<>'true' THEN
    RAISE EXCEPTION 'DISMISS-REPLAY FAIL: fresh request id returned %',v_fresh;
  END IF;
  IF v_same <> v_fresh THEN
    RAISE EXCEPTION 'DISMISS-REPLAY FAIL: request-id choice changed durable replay: same %, fresh %',v_same,v_fresh;
  END IF;

  BEGIN
    PERFORM public.biz_resolve_brand_person_conflict(
      v_brand,ARRAY[v_conflict],'separate',NULL,'23059000-0000-4000-8000-0000000000b3');
    RAISE EXCEPTION 'DISMISS-REPLAY FAIL: different outcome was accepted';
  EXCEPTION WHEN SQLSTATE '23505' THEN
    GET STACKED DIAGNOSTICS v_caught = MESSAGE_TEXT;
    IF v_caught <> 'people_conflict_already_resolved' THEN
      RAISE EXCEPTION 'DISMISS-REPLAY FAIL: expected typed already-resolved error, got %',v_caught;
    END IF;
  END;
  RAISE NOTICE 'DISMISS-REPLAY PASS: same/fresh request ids return deterministic empty arrays; different outcome stays typed';
END;
$dismiss_replay$;

ROLLBACK;
