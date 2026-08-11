-- #1770 regression: linked accounts are not email/SMS delivery targets, and
-- expected stale snapshots must return a non-retryable validation SQLSTATE.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_actor uuid := '63835860-56bc-4ac9-a643-630558e111b5';
  v_brand uuid := '18210000-0000-4000-8000-000000000301';
  v_event uuid := '18210000-0000-4000-8000-000000000302';
  v_person uuid := '18210000-0000-4000-8000-000000000303';
  v_contact uuid := '18210000-0000-4000-8000-000000000304';
  v_selection jsonb := '{"kind":"all_brand_people"}';
  v_snapshot jsonb;
  v_stale jsonb;
  v_state text;
BEGIN
  INSERT INTO auth.users(id) VALUES(v_actor) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
    VALUES(v_brand,v_actor,'Linked Account Brand','linked-account-brand','USD',now(),now());
  INSERT INTO public.events(
    id,brand_id,created_by,event_type,title,slug,status,visibility,currency,
    timezone,party_types,rsvp_approval_mode,rsvp_discoverable,theme,created_at,updated_at
  ) VALUES(
    v_event,v_brand,v_actor,'rsvp','Linked Account Event','linked-account-event',
    'scheduled','private','USD','UTC','{}','auto',false,'{}',now(),now()
  );
  INSERT INTO public.brand_people(id,brand_id,linked_user_id,display_name)
    VALUES(v_person,v_brand,v_actor,'Linked Email Guest');
  INSERT INTO public.brand_person_contact_methods(
    id,brand_id,brand_person_id,channel,normalized_value,provenance_scope,
    is_exportable,is_primary,record_state
  ) VALUES(
    v_contact,v_brand,v_person,'email','linked@example.test','brand_owned',
    true,true,'active'
  );

  v_snapshot := jsonb_set(
    $snapshot${
      "schemaVersion":1,
      "eventId":"18210000-0000-4000-8000-000000000302",
      "brandId":"18210000-0000-4000-8000-000000000301",
      "purpose":"invitation",
      "channels":["email"],
      "selectionHash":"0aab0215306062746291cbf9522fbad30fcf73d09f35e674d86919503a3624ad",
      "eligibilityHash":"39112dd2ae5d6e4c6eb8ebf220b2f13784e4f1ceaaba29b094f7560e25c9b016",
      "quotedAt":"2026-08-11T03:48:25.717000Z",
      "quote":{"quoteHash":"a6b7fd284a92ce5aa554672aec791eed2e0bd1722f36f11907ae0e25c2361760","smsSegments":0,"estimatedCostMinor":0,"currency":null,"rateIds":[]},
      "campaigns":{"email":{"payloadVersion":1,"payloadHash":"e0df80dc6f5e32a66fa35a7145006ec8466124ff6968d02c4580c74d63bb46da","subject":"Mingla QA invitation","bodyHtml":"Controlled runtime verification — no response needed.<p><a href=\"__MINGLA_OFFERING_INVITE_URL_V1__\">Open event</a></p>","bodyText":"Controlled runtime verification — no response needed.\n\n__MINGLA_OFFERING_INVITE_URL_V1__","embeddedEventIds":["18210000-0000-4000-8000-000000000302"],"volatileLinkMarker":"__MINGLA_OFFERING_INVITE_URL_V1__"},"sms":null,"push":null},
      "candidates":[{"candidateKey":"18210000-0000-4000-8000-000000000303:email:18210000-0000-4000-8000-000000000304","brandPersonId":"18210000-0000-4000-8000-000000000303","inviteId":null,"predecessorAttemptId":null,"channel":"email","contactMethodId":"18210000-0000-4000-8000-000000000304","recipientUserId":null,"outcome":"queued","safeReasonCode":null,"attemptKind":"initial","smsQuote":null}],
      "executionSnapshotHash":"f5e7efcbf67a84b642851f528afe5b3db160676d418e732679fd340b1d742bf7"
    }$snapshot$::jsonb,
    '{quotedAt}',to_jsonb(to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  );

  IF public.biz_seal_offering_execution_snapshot(v_actor,v_selection,v_snapshot)
      ->>'executionSnapshotHash' IS DISTINCT FROM v_snapshot->>'executionSnapshotHash' THEN
    RAISE EXCEPTION 'T-1770-SEAL-01 FAIL: linked user incorrectly changed email identity';
  END IF;
  RAISE NOTICE 'T-1770-SEAL-01 PASS: linked user is ignored for email target comparison';

  UPDATE public.brand_person_contact_methods SET record_state='retired',retired_at=now()
    WHERE id=v_contact;
  BEGIN
    PERFORM public.biz_seal_offering_execution_snapshot(v_actor,v_selection,v_snapshot);
    RAISE EXCEPTION 'T-1770-SEAL-02 FAIL: actual contact drift was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF SQLERRM NOT LIKE '%offering_execution_snapshot_stale%' OR v_state <> '22023' THEN
      RAISE EXCEPTION 'T-1770-SEAL-02 FAIL: stale contact returned state %, error %',v_state,SQLERRM;
    END IF;
  END;
  UPDATE public.brand_person_contact_methods SET record_state='active',retired_at=NULL
    WHERE id=v_contact;
  RAISE NOTICE 'T-1770-SEAL-02 PASS: real target drift fails promptly with non-retryable 22023';

  v_stale := jsonb_set(
    v_snapshot,'{quotedAt}',
    to_jsonb(to_char((clock_timestamp()-interval '10 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  );
  BEGIN
    PERFORM public.biz_execute_offering_send_group(
      v_actor,v_event,'invitation',v_selection,ARRAY['email'],gen_random_uuid(),v_stale
    );
    RAISE EXCEPTION 'T-1770-SEAL-03 FAIL: expired quote was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
    IF SQLERRM NOT LIKE '%offering_execution_snapshot_stale%' OR v_state <> '22023' THEN
      RAISE EXCEPTION 'T-1770-SEAL-03 FAIL: expired quote returned state %, error %',v_state,SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'T-1770-SEAL-03 PASS: execute stale quote is non-retryable';
END;
$test$;

ROLLBACK;
