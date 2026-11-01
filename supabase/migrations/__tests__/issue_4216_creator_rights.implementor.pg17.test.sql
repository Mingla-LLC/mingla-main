\set ON_ERROR_STOP on

-- MINGLA-INVARIANT: I-4216-AGREEMENT-SERVER-AUTHORITY | issue #4216 | A Creator can accept only the current server-owned agreement and the acceptance freezes its URL and SHA-256 fingerprint.
-- MINGLA-INVARIANT: I-4216-RIGHTS-AFTER-FULL-RELEASE | issue #4216 | Perpetual marketing rights activate only after the full fixed Creator fee is released.
-- MINGLA-INVARIANT: I-4216-LICENSE-NOT-NEGOTIABLE | issue #4216 | New gigs carry the standard licence and no offer or proposal can remove or shorten it.

BEGIN;

DO $test$
DECLARE
  v_host uuid := '42160000-0000-4000-8000-000000000001';
  v_creator uuid := '42160000-0000-4000-8000-000000000002';
  v_brand uuid := '42160000-0000-4000-8000-000000000003';
  v_city uuid := '42160000-0000-4000-8000-000000000004';
  v_gig uuid := '42160000-0000-4000-8000-000000000005';
  v_gig_partial uuid := '42160000-0000-4000-8000-000000000006';
  v_interest uuid := '42160000-0000-4000-8000-000000000007';
  v_interest_partial uuid := '42160000-0000-4000-8000-000000000008';
  v_contract uuid;
  v_partial_contract uuid;
  v_acceptance uuid;
  v_media uuid := '42160000-0000-4000-8000-000000000009';
  v_answer jsonb;
  v_failed boolean;
BEGIN
  UPDATE public.feature_flags SET is_enabled=true
  WHERE flag_key='creator_gigs_enabled';

  INSERT INTO auth.users(id,email) VALUES
    (v_host,'issue-4216-host@test.local'),
    (v_creator,'issue-4216-creator@test.local');
  INSERT INTO public.creator_accounts(id,email,display_name) VALUES
    (v_host,'issue-4216-host@test.local','Rights Host'),
    (v_creator,'issue-4216-creator@test.local','Rights Creator');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES(v_brand,v_host,'Issue 4216 Rights Host','issue-4216-rights-host','USD');
  INSERT INTO public.seeding_cities(
    id,google_place_id,name,country,country_code,center_lat,center_lng,
    bbox_sw_lat,bbox_sw_lng,bbox_ne_lat,bbox_ne_lng
  ) VALUES(
    v_city,'issue-4216-city','Rights Test City','United States','US',
    35.7,-78.6,35.6,-78.7,35.8,-78.5
  );
  INSERT INTO public.creator_profiles(
    creator_account_id,display_name,home_city_id,usage_ads_opt_in
  ) VALUES(v_creator,'Rights Creator',v_city,true);

  INSERT INTO public.gigs(
    id,brand_id,listing_kind,listing_id,title_public,brief_public,
    format_key,deliverables,city_id,category,shoot_window_start,
    shoot_window_end,post_by,currency,status,created_by
  ) VALUES
    (v_gig,v_brand,'event',gen_random_uuid(),'Rights launch video',
      'Create a clear launch video showing the experience and its atmosphere.',
      'behind_the_scenes','[{"platform":"instagram","kind":"reel","count":1}]',
      v_city,'nightlife',current_date+2,current_date+3,current_date+7,
      'USD','open',v_host),
    (v_gig_partial,v_brand,'event',gen_random_uuid(),'Partial rights video',
      'Create another clear video used to test a partial settlement outcome.',
      'behind_the_scenes','[{"platform":"instagram","kind":"reel","count":1}]',
      v_city,'nightlife',current_date+2,current_date+3,current_date+7,
      'USD','open',v_host);

  IF EXISTS(
    SELECT 1 FROM public.gigs WHERE id IN (v_gig,v_gig_partial)
      AND (rights_model<>'creator_v1_perpetual'
        OR agreement_version<>'creator-v1'
        OR agreement_document_sha256<>'5f3a9bf9a3dd9a938b25730f7c2fa5c046ea8151dba5f3c63602c7aaacf23a96'
        OR usage_days<>90)
  ) THEN
    RAISE EXCEPTION '#4216 new gig did not freeze the current licence';
  END IF;

  v_failed:=false;
  BEGIN
    INSERT INTO public.gig_interest(
      id,gig_id,creator_account_id,quoted_minor
    ) VALUES(v_interest,v_gig,v_creator,10000);
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed:=SQLERRM='current_creator_agreement_required';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '#4216 Creator entered a new gig before re-consent';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_creator::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object(
    'sub',v_creator,'email','issue-4216-creator@test.local','role','authenticated'
  )::text,true);
  v_answer:=public.creator_current_agreement();
  IF v_answer->>'version'<>'creator-v1'
    OR (v_answer->>'accepted')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION '#4216 server agreement metadata was not authoritative: %',v_answer;
  END IF;
  v_answer:=public.creator_agreement_sign(DATE '1990-01-01');
  IF (v_answer->>'ok')::boolean IS DISTINCT FROM true
    OR v_answer->>'agreement_version'<>'creator-v1' THEN
    RAISE EXCEPTION '#4216 signing failed: %',v_answer;
  END IF;
  SELECT agreement_acceptance_id INTO v_acceptance
  FROM public.creator_profiles WHERE creator_account_id=v_creator;
  IF v_acceptance IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.creator_agreement_acceptances
    WHERE id=v_acceptance AND creator_account_id=v_creator
      AND agreement_version='creator-v1'
      AND document_url='https://usemingla.com/creator-agreement'
      AND document_sha256='5f3a9bf9a3dd9a938b25730f7c2fa5c046ea8151dba5f3c63602c7aaacf23a96'
  ) THEN
    RAISE EXCEPTION '#4216 exact agreement evidence was not retained';
  END IF;
  v_failed:=false;
  BEGIN
    UPDATE public.creator_agreement_acceptances
    SET document_url='https://example.com/rewritten' WHERE id=v_acceptance;
  EXCEPTION WHEN OTHERS THEN
    v_failed:=SQLERRM='creator_agreement_acceptance_immutable';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '#4216 acceptance evidence was mutable';
  END IF;

  INSERT INTO public.gig_interest(
    id,gig_id,creator_account_id,quoted_minor
  ) VALUES
    (v_interest,v_gig,v_creator,10000),
    (v_interest_partial,v_gig_partial,v_creator,10000);

  PERFORM set_config('request.jwt.claim.sub',v_host::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object(
    'sub',v_host,'email','issue-4216-host@test.local','role','authenticated'
  )::text,true);
  v_answer:=public.gig_offer_prepare(
    v_interest,'{"fee_minor":10000}'::jsonb,'4216-no-rights-acceptance'
  );
  IF v_answer->>'error'<>'creator_rights_acceptance_required' THEN
    RAISE EXCEPTION '#4216 Host could bypass the rights checkbox: %',v_answer;
  END IF;
  v_answer:=public.gig_offer_prepare(
    v_interest,'{"fee_minor":10000,"rights_accepted":true}'::jsonb,
    '4216-full-release-offer'
  );
  v_contract:=(v_answer->>'contract_id')::uuid;
  IF v_contract IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.gig_contracts
    WHERE id=v_contract AND rights_model='creator_v1_perpetual'
      AND agreement_version='creator-v1' AND host_rights_accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION '#4216 Host acceptance was not frozen: %',v_answer;
  END IF;
  v_answer:=public.gig_offer_prepare(
    v_interest_partial,'{"fee_minor":10000,"rights_accepted":true}'::jsonb,
    '4216-partial-offer'
  );
  v_partial_contract:=(v_answer->>'contract_id')::uuid;

  UPDATE public.gig_holds SET
    status='captured',provider_ref='pi_issue4216',captured_at=now()
  WHERE contract_id IN (v_contract,v_partial_contract);

  PERFORM set_config('request.jwt.claim.sub',v_creator::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object(
    'sub',v_creator,'email','issue-4216-creator@test.local','role','authenticated'
  )::text,true);
  PERFORM public.gig_transition(v_contract,'offered','accept','{}'::jsonb);
  PERFORM public.gig_transition(v_partial_contract,'offered','accept','{}'::jsonb);
  IF EXISTS(
    SELECT 1 FROM public.gig_contracts WHERE id IN (v_contract,v_partial_contract)
      AND (creator_agreement_acceptance_id IS NULL OR creator_rights_accepted_at IS NULL)
  ) THEN
    RAISE EXCEPTION '#4216 Creator acceptance was not frozen into the contract';
  END IF;
  IF public.gig_rights_status(v_contract)->>'status'<>'pending' THEN
    RAISE EXCEPTION '#4216 licence activated before full fee release';
  END IF;

  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  PERFORM set_config('issue3872.transition',v_contract::text,true);
  UPDATE public.gig_contracts SET state='posts_verified' WHERE id=v_contract;
  PERFORM public.gig_release_record(v_contract,'pi_issue4216');
  IF public.gig_rights_status(v_contract)->>'status'<>'active' THEN
    RAISE EXCEPTION '#4216 full fee release did not activate rights: %',
      public.gig_rights_status(v_contract);
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.gig_contracts
    WHERE id=v_contract AND rights_activated_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION '#4216 activation was not retained as an immutable fact';
  END IF;

  PERFORM set_config('issue3872.transition',v_partial_contract::text,true);
  UPDATE public.gig_contracts SET state='resolved_partial'
  WHERE id=v_partial_contract;
  UPDATE public.gig_holds SET status='partially_refunded',refunded_minor=5000
  WHERE contract_id=v_partial_contract;
  IF public.gig_rights_status(v_partial_contract)->>'status'<>'not_granted' THEN
    RAISE EXCEPTION '#4216 partial settlement incorrectly granted rights: %',
      public.gig_rights_status(v_partial_contract);
  END IF;

  -- Once validly granted, the licence is irrevocable. A later reversal may
  -- create a money claim, but it cannot erase the historical rights grant.
  UPDATE public.payee_shares SET
    reversed_minor=gross_minor,status='reversed'
  WHERE order_kind='gig' AND order_id=v_contract AND payee_kind='gig_fee';
  PERFORM set_config('issue3872.transition',v_contract::text,true);
  UPDATE public.gig_contracts SET state='resolved_refund' WHERE id=v_contract;
  IF public.gig_rights_status(v_contract)->>'status'<>'active' THEN
    RAISE EXCEPTION '#4216 an activated perpetual licence was later revoked: %',
      public.gig_rights_status(v_contract);
  END IF;

  v_failed:=false;
  BEGIN
    INSERT INTO public.gig_change_proposals(
      contract_id,from_version,proposed_by,changes,reason
    ) VALUES(v_contract,1,'host','{"usage_days":30}'::jsonb,'usage');
  EXCEPTION WHEN OTHERS THEN
    v_failed:=SQLERRM='creator_rights_not_negotiable';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '#4216 a proposal shortened the standard licence';
  END IF;

  INSERT INTO public.creator_media_jobs(
    id,client_operation_id,owner_kind,owner_id,purpose,contract_id,
    bunny_video_id,status,ready_at,delete_after,created_at
  ) VALUES(
    v_media,gen_random_uuid(),'creator',v_creator,'delivery',v_contract,
    '4216-active-rights-video','ready',now()-interval '130 days',
    now()-interval '1 day',now()-interval '140 days'
  );
  INSERT INTO public.gig_deliveries(
    contract_id,round,media_job_id,decision,decided_at
  ) VALUES(v_contract,1,v_media,'approved',now()-interval '125 days');
  IF EXISTS(
    SELECT 1 FROM public.issue_4182_creator_media_reap_candidates(now(),500)
    WHERE id=v_media
  ) THEN
    RAISE EXCEPTION '#4216 active licensed master was eligible for deletion';
  END IF;
END
$test$;

ROLLBACK;
