-- [TEST-MOD-APPROVED #1780]
-- Independent adversarial proof for binding SPEC §§10/19: the two JSON
-- publisher owners must reject every raw invite selector/dispatch tail before
-- any offering or outbox mutation, including the same keys nested in a payload.
-- RSVP and Trip use strict SQL function signatures and are catalog-checked here;
-- an unknown named argument therefore cannot be silently ignored by PostgREST.
\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.issue_1780_no_outbox_for(p_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $fn$
DECLARE v_count bigint;
BEGIN
  IF to_regclass('private.brand_offering_invite_outbox') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM private.brand_offering_invite_outbox WHERE event_id=$1'
      INTO v_count USING p_event_id;
  ELSIF to_regclass('private.brand_offering_invite_publish_outbox') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM private.brand_offering_invite_publish_outbox WHERE event_id=$1'
      INTO v_count USING p_event_id;
  ELSE
    RAISE EXCEPTION 'T-1780-TAIL-00 FAIL: no canonical wizard invite outbox exists';
  END IF;
  RETURN v_count=0;
END;
$fn$;

DO $catalog$
DECLARE
  v_args text;
BEGIN
  SELECT pg_get_function_identity_arguments(p.oid) INTO v_args
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='business_publish_rsvp_graph'
    AND p.pronargs=4;
  IF v_args IS NULL
     OR v_args<>'p_event_id uuid, p_client_request_id uuid, p_invite_selection_revision bigint, p_invite_selection_confirmed boolean' THEN
    RAISE EXCEPTION 'T-1780-TAIL-00 FAIL: RSVP publisher does not expose one strict receipt-only signature: %',v_args;
  END IF;

  SELECT pg_get_function_identity_arguments(p.oid) INTO v_args
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='biz_publish_trip_command'
    AND p.pronargs=5;
  IF v_args IS NULL
     OR v_args<>'p_event_id uuid, p_expected_updated_at timestamp with time zone, p_operation_id uuid, p_invite_selection_revision bigint, p_invite_selection_confirmed boolean' THEN
    RAISE EXCEPTION 'T-1780-TAIL-00 FAIL: Trip publisher does not expose one strict receipt-only signature: %',v_args;
  END IF;
END;
$catalog$;

INSERT INTO auth.users(id,email)
VALUES('00000000-1780-4000-8000-000000000901','tail-1780@example.test');
INSERT INTO public.creator_accounts(id,email,display_name)
VALUES(
  '00000000-1780-4000-8000-000000000901',
  'tail-1780@example.test','Issue 1780 Tail Tester'
);
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
VALUES(
  '00000000-1780-4000-8000-000000000902',
  '00000000-1780-4000-8000-000000000901',
  'Issue 1780 Tail Brand','issue-1780-tail-brand','USD',now(),now()
);
INSERT INTO public.events(
  id,brand_id,created_by,event_type,title,slug,status,visibility,currency,
  timezone,party_types,rsvp_approval_mode,rsvp_discoverable,theme,created_at,updated_at
) VALUES
(
  '00000000-1780-4000-8000-000000000903',
  '00000000-1780-4000-8000-000000000902',
  '00000000-1780-4000-8000-000000000901',
  'event','Tail Event','issue-1780-tail-event','draft','draft','USD','UTC',
  '{}','auto',false,
  '{"business_draft":{"requestedVisibility":"public","clientRevision":0}}',now(),now()
),
(
  '00000000-1780-4000-8000-000000000904',
  '00000000-1780-4000-8000-000000000902',
  '00000000-1780-4000-8000-000000000901',
  'experience','Tail Experience','issue-1780-tail-experience','draft','draft','USD','UTC',
  '{}','auto',false,
  '{"business_draft":{"requestedVisibility":"public","clientRevision":0}}',now(),now()
);

SELECT set_config(
  'request.jwt.claim.sub','00000000-1780-4000-8000-000000000901',true
);
SET LOCAL ROLE authenticated;

DO $json_publishers$
DECLARE
  v_key text;
  v_depth text;
  v_publisher text;
  v_event_id uuid;
  v_payload jsonb;
  v_error text;
  v_before_event jsonb;
  v_after_event jsonb;
BEGIN
  FOREACH v_publisher IN ARRAY ARRAY['event','experience'] LOOP
    v_event_id:=CASE v_publisher
      WHEN 'event' THEN '00000000-1780-4000-8000-000000000903'::uuid
      ELSE '00000000-1780-4000-8000-000000000904'::uuid
    END;
    FOREACH v_depth IN ARRAY ARRAY['top-level','nested'] LOOP
      FOREACH v_key IN ARRAY ARRAY[
        'inviteeIds','personIds','brandPersonIds','groupIds','resolvedPeople',
        'channels','destinations','origin','message','cost','selector'
      ] LOOP
        SELECT to_jsonb(e) INTO v_before_event
        FROM public.events e WHERE e.id=v_event_id;
        v_payload:=jsonb_build_object(
          'title',CASE v_publisher WHEN 'event' THEN 'Tail Event' ELSE 'Tail Experience' END,
          'timezone','UTC',
          'theme',jsonb_build_object('business_draft',jsonb_build_object(
            'requestedVisibility','public','clientRevision',0
          ))
        );
        IF v_depth='top-level' THEN
          v_payload:=v_payload||jsonb_build_object(
            v_key,jsonb_build_array('00000000-1780-4000-8000-000000000999')
          );
        ELSE
          v_payload:=jsonb_set(
            v_payload,'{theme,business_draft,inviteTail}',jsonb_build_object(
              v_key,jsonb_build_array('00000000-1780-4000-8000-000000000999')
            ),true
          );
        END IF;

        BEGIN
          IF v_publisher='event' THEN
            PERFORM public.issue_1719_publish_event_with_poster(
              v_event_id,v_payload,0
            );
          ELSE
            PERFORM public.issue_1719_publish_experience_with_poster(
              v_event_id,v_payload,true
            );
          END IF;
          RAISE EXCEPTION 'T-1780-TAIL-01 accepted % % key %',
            v_depth,v_publisher,v_key;
        EXCEPTION WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
          IF v_error LIKE 'T-1780-TAIL-01 accepted%' THEN RAISE; END IF;
          IF v_error NOT LIKE '%wizard_invite_payload_forbidden%' THEN
            RAISE EXCEPTION 'T-1780-TAIL-01 FAIL: % % key % reached another path: %',
              v_depth,v_publisher,v_key,v_error;
          END IF;
        END;

        SELECT to_jsonb(e) INTO v_after_event
        FROM public.events e WHERE e.id=v_event_id;
        IF v_after_event IS DISTINCT FROM v_before_event
           OR NOT pg_temp.issue_1780_no_outbox_for(v_event_id) THEN
          RAISE EXCEPTION 'T-1780-TAIL-02 FAIL: rejected % % key % left publish/outbox state',
            v_depth,v_publisher,v_key;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$json_publishers$;

ROLLBACK;
