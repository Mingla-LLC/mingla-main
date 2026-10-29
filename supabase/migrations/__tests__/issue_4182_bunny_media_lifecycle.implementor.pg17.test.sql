\set ON_ERROR_STOP on

-- #4182: Bunny media can only be reaped after the server-owned lifecycle
-- permits it. The test uses evidence media for the positive case because its
-- lifecycle is intentionally independent of a delivery payout; delivery and
-- Local rows without their required authorities must fail closed.

BEGIN;

DO $test$
DECLARE
  v_owner uuid := '41820000-0000-4000-8000-000000000001';
  v_evidence uuid := '41820000-0000-4000-8000-000000000002';
  v_held uuid := '41820000-0000-4000-8000-000000000003';
  v_delivery uuid := '41820000-0000-4000-8000-000000000004';
  v_local uuid := '41820000-0000-4000-8000-000000000005';
  v_abandoned uuid := '41820000-0000-4000-8000-000000000006';
  v_held_abandoned uuid := '41820000-0000-4000-8000-000000000009';
  v_contract uuid := '41820000-0000-4000-8000-000000000007';
  v_month uuid := '41820000-0000-4000-8000-000000000008';
  v_now timestamptz := '2030-01-01 00:00:00+00';
BEGIN
  INSERT INTO auth.users(id,email)
  VALUES(v_owner,'issue-4182-media@test.local');

  INSERT INTO public.creator_media_jobs(
    id,client_operation_id,owner_kind,owner_id,purpose,contract_id,
    bunny_video_id,status,ready_at,delete_after,created_at
  ) VALUES
    (v_evidence,gen_random_uuid(),'creator',v_owner,'dispute_evidence',v_contract,
      '4182-evidence','ready',v_now-interval '121 days',v_now-interval '1 second',v_now-interval '130 days'),
    (v_held,gen_random_uuid(),'creator',v_owner,'dispute_evidence',v_contract,
      '4182-held','ready',v_now-interval '121 days',v_now-interval '1 second',v_now-interval '130 days'),
    (v_delivery,gen_random_uuid(),'creator',v_owner,'delivery',v_contract,
      '4182-delivery','ready',v_now-interval '121 days',v_now-interval '1 second',v_now-interval '130 days');

  UPDATE public.creator_media_jobs
  SET retention_hold_at=v_now-interval '2 days',retention_hold_reason='Open legal hold'
  WHERE id=v_held;

  INSERT INTO public.creator_media_jobs(
    id,client_operation_id,owner_kind,owner_id,purpose,local_month_id,
    bunny_video_id,status,ready_at,delete_after,created_at
  ) VALUES(
    v_local,gen_random_uuid(),'local',v_owner,'local_review',v_month,
    '4182-local','ready',v_now-interval '31 days',v_now-interval '1 second',v_now-interval '40 days'
  );

  INSERT INTO public.creator_media_jobs(
    id,client_operation_id,owner_kind,owner_id,purpose,bunny_video_id,status,created_at
  ) VALUES(
    v_abandoned,gen_random_uuid(),'creator',v_owner,'showcase',
    '4182-abandoned','awaiting_upload',v_now-interval '25 hours'
  ),(
    v_held_abandoned,gen_random_uuid(),'creator',v_owner,'showcase',
    '4182-held-abandoned','awaiting_upload',v_now-interval '25 hours'
  );

  UPDATE public.creator_media_jobs
  SET retention_hold_at=v_now-interval '2 days',retention_hold_reason='Preserve pending upload'
  WHERE id=v_held_abandoned;

  IF NOT EXISTS(
    SELECT 1 FROM public.issue_4182_creator_media_reap_candidates(v_now,500)
    WHERE id=v_evidence AND reap_reason='evidence_retention_complete'
  ) THEN
    RAISE EXCEPTION '#4182 expired dispute evidence was not eligible for cleanup';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.issue_4182_creator_media_reap_candidates(v_now,500)
    WHERE id=v_abandoned AND reap_reason='abandoned_upload'
  ) THEN
    RAISE EXCEPTION '#4182 abandoned upload was not eligible after 24 hours';
  END IF;

  IF EXISTS(
    SELECT 1 FROM public.issue_4182_creator_media_reap_candidates(v_now,500)
    WHERE id IN (v_held,v_held_abandoned,v_delivery,v_local)
  ) THEN
    RAISE EXCEPTION '#4182 hold or missing lifecycle authority did not fail closed';
  END IF;

  BEGIN
    UPDATE public.creator_media_jobs
    SET retention_hold_at=v_now,retention_hold_reason=NULL
    WHERE id=v_evidence;
    RAISE EXCEPTION '#4182 malformed retention hold unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  IF has_function_privilege('authenticated',
      'public.issue_4182_creator_media_reap_candidates(timestamptz,integer)','EXECUTE')
     OR NOT has_function_privilege('service_role',
      'public.issue_4182_creator_media_reap_candidates(timestamptz,integer)','EXECUTE') THEN
    RAISE EXCEPTION '#4182 reap authority is not service-role only';
  END IF;
END
$test$;

DO $agreement$
DECLARE
  v_admin uuid := '41820000-0000-4000-8000-000000000101';
  v_applicant uuid := '41820000-0000-4000-8000-000000000102';
  v_expired_applicant uuid := '41820000-0000-4000-8000-000000000103';
  v_city uuid := '41820000-0000-4000-8000-000000000104';
  v_application uuid := '41820000-0000-4000-8000-000000000105';
  v_expired_application uuid := '41820000-0000-4000-8000-000000000106';
  v_acceptance uuid;
  v_answer jsonb;
  v_failed boolean;
BEGIN
  INSERT INTO auth.users(id,email) VALUES
    (v_admin,'issue-4182-admin@test.local'),
    (v_applicant,'issue-4182-local@test.local'),
    (v_expired_applicant,'issue-4182-expired@test.local');
  INSERT INTO public.admin_users(email,role,status,accepted_at)
  VALUES('issue-4182-admin@test.local','admin','active',now());
  INSERT INTO public.seeding_cities(
    id,google_place_id,name,country,country_code,center_lat,center_lng,
    bbox_sw_lat,bbox_sw_lng,bbox_ne_lat,bbox_ne_lng
  ) VALUES(
    v_city,'issue-4182-lagos','Lagos agreement test','Nigeria','NG',
    6.5,3.4,6.4,3.3,6.6,3.5
  );
  INSERT INTO public.local_city_programs(
    city_id,seats,is_open,monthly_usd_minor,monthly_rate_minor,payout_currency,updated_by
  ) VALUES(v_city,2,true,15000,15000,'USD',v_admin);
  INSERT INTO public.local_agreement_versions(
    version,document_url,document_sha256,effective_at,is_current,created_by
  ) VALUES(
    'local-4182-v1','https://mingla.example/legal/local-4182-v1',repeat('a',64),
    now()-interval '1 day',true,v_admin
  );
  INSERT INTO public.local_applications(
    id,user_id,city_id,handles,sample_links,why
  ) VALUES(
    v_application,v_applicant,v_city,'{"instagram":"issue4182"}'::jsonb,
    '[]'::jsonb,'I know this city and write useful local reviews.'
  ),(
    v_expired_application,v_expired_applicant,v_city,'{"tiktok":"issue4182expired"}'::jsonb,
    '[]'::jsonb,'I also know this city and write useful local reviews.'
  );

  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object(
    'sub',v_admin,'email','issue-4182-admin@test.local','role','authenticated'
  )::text,true);

  v_failed:=false;
  BEGIN
    PERFORM public.local_application_decide(v_application,'accepted',NULL);
  EXCEPTION WHEN OTHERS THEN
    v_failed:=SQLERRM='local_signature_required';
  END;
  IF NOT v_failed OR EXISTS(SELECT 1 FROM public.locals WHERE user_id=v_applicant) THEN
    RAISE EXCEPTION '#4182 Admin activated a Local without the applicant signature';
  END IF;

  v_failed:=false;
  BEGIN
    PERFORM public.local_application_decide(v_application,'agreement_pending','admin-typed-version');
  EXCEPTION WHEN OTHERS THEN
    v_failed:=SQLERRM='agreement_version_is_server_owned';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '#4182 Admin supplied an application-specific agreement version';
  END IF;

  v_answer:=public.local_application_decide(v_application,'agreement_pending',NULL);
  IF v_answer->>'agreement_version'<>'local-4182-v1'
    OR (SELECT status FROM public.local_applications WHERE id=v_application)<>'agreement_pending'
    OR (SELECT agreement_due_at FROM public.local_applications WHERE id=v_application)<=now() THEN
    RAISE EXCEPTION '#4182 signing invitation did not reserve the current agreement: %',v_answer;
  END IF;

  v_answer:=public.local_city_program_save(
    v_city,0,true,p_monthly_rate_minor=>15000,p_payout_currency=>'USD'
  );
  IF v_answer->>'error'<>'seats_below_active_locals'
    OR (v_answer->>'reserved')::integer<>1 THEN
    RAISE EXCEPTION '#4182 Admin could shrink capacity below a live reservation: %',v_answer;
  END IF;

  -- Pausing new applications does not revoke a seat already reserved for a
  -- specific applicant.
  v_answer:=public.local_city_program_save(
    v_city,2,false,p_monthly_rate_minor=>15000,p_payout_currency=>'USD'
  );
  IF (v_answer->>'ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION '#4182 could not pause new applications: %',v_answer;
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_applicant::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object(
    'sub',v_applicant,'email','issue-4182-local@test.local','role','authenticated'
  )::text,true);
  v_answer:=public.local_landing();
  IF v_answer->'agreement'->>'version'<>'local-4182-v1'
    OR v_answer->'applications'->0->>'status'<>'agreement_pending' THEN
    RAISE EXCEPTION '#4182 applicant could not read the assigned agreement: %',v_answer;
  END IF;
  v_answer:=public.local_agreement_sign(v_application,'local-4182-v1','Amina Applicant');
  IF v_answer->>'status'<>'accepted' THEN
    RAISE EXCEPTION '#4182 applicant signature did not activate the seat: %',v_answer;
  END IF;
  SELECT agreement_acceptance_id INTO v_acceptance
  FROM public.locals WHERE user_id=v_applicant AND status='active';
  IF v_acceptance IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.local_agreement_acceptances a
    WHERE a.id=v_acceptance AND a.application_id=v_application
      AND a.user_id=v_applicant AND a.agreement_version='local-4182-v1'
      AND a.document_url='https://mingla.example/legal/local-4182-v1'
      AND a.document_sha256=repeat('a',64)
      AND a.signature_name='Amina Applicant' AND a.accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION '#4182 exact applicant signature evidence was not retained';
  END IF;

  -- Replay is idempotent and never creates a second acceptance.
  PERFORM public.local_agreement_sign(v_application,'local-4182-v1','Amina Applicant');
  IF (SELECT count(*) FROM public.local_agreement_acceptances WHERE application_id=v_application)<>1 THEN
    RAISE EXCEPTION '#4182 signature replay duplicated acceptance evidence';
  END IF;

  v_failed:=false;
  BEGIN
    UPDATE public.local_agreement_acceptances SET signature_name='Admin Rewrite'
    WHERE id=v_acceptance;
  EXCEPTION WHEN OTHERS THEN
    v_failed:=SQLERRM='local_agreement_acceptance_immutable';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '#4182 signed acceptance evidence was mutable';
  END IF;

  v_failed:=false;
  BEGIN
    UPDATE public.local_agreement_versions
    SET document_url='https://mingla.example/legal/rewritten'
    WHERE version='local-4182-v1';
  EXCEPTION WHEN OTHERS THEN
    v_failed:=SQLERRM='local_agreement_version_immutable';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION '#4182 published agreement content was mutable';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object(
    'sub',v_admin,'email','issue-4182-admin@test.local','role','authenticated'
  )::text,true);
  UPDATE public.local_city_programs SET is_open=true WHERE city_id=v_city;
  PERFORM public.local_application_decide(v_expired_application,'agreement_pending',NULL);
  UPDATE public.local_applications SET agreement_due_at=now()-interval '1 second'
  WHERE id=v_expired_application;
  PERFORM public.local_application_decide(v_expired_application,'agreement_pending',NULL);
  IF (SELECT count(*) FROM public.notification_outbox
      WHERE user_id=v_expired_applicant
        AND idempotency_key LIKE 'consumer.local.application_update:%:agreement_pending:%')<>2 THEN
    RAISE EXCEPTION '#4182 a renewed signing window did not notify the applicant';
  END IF;
  UPDATE public.local_applications SET agreement_due_at=now()-interval '1 second'
  WHERE id=v_expired_application;
  PERFORM set_config('request.jwt.claim.sub',v_expired_applicant::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object(
    'sub',v_expired_applicant,'email','issue-4182-expired@test.local','role','authenticated'
  )::text,true);
  v_failed:=false;
  BEGIN
    PERFORM public.local_agreement_sign(
      v_expired_application,'local-4182-v1','Expired Applicant'
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed:=SQLERRM='local_agreement_invitation_expired';
  END;
  IF NOT v_failed OR EXISTS(
    SELECT 1 FROM public.locals WHERE user_id=v_expired_applicant
  ) THEN
    RAISE EXCEPTION '#4182 an expired invitation activated a Local seat';
  END IF;

  IF NOT has_function_privilege(
    'authenticated','public.local_agreement_sign(uuid,text,text)','EXECUTE'
  ) OR has_function_privilege(
    'anon','public.local_agreement_sign(uuid,text,text)','EXECUTE'
  ) THEN
    RAISE EXCEPTION '#4182 Local signing authority is not applicant-only';
  END IF;
END
$agreement$;

ROLLBACK;

\echo 'issue_4182_bunny_media_lifecycle.implementor.pg17: PASS'
