\set ON_ERROR_STOP on
BEGIN;

-- Independent round-four adversarial coverage for #1972. The round-three
-- guard proved that a valid stored visibility survives reconstruction. This
-- guard attacks the other side of that trust boundary: authenticated draft
-- writers must not persist an invalid value that the publish owner can later
-- coerce to public.
DO $test$
DECLARE
  v_user constant uuid := '1972eeee-0000-4000-8000-000000000001';
  v_brand constant uuid := '1972eeee-0000-4000-8000-000000000002';
  v_event_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_payload jsonb;
  v_failures text[] := ARRAY[]::text[];
BEGIN
  INSERT INTO auth.users(id,aud,role,email)
  VALUES(v_user,'authenticated','authenticated','issue1972-round4-tester@example.invalid');
  INSERT INTO public.creator_accounts(id,email,display_name)
  VALUES(v_user,'issue1972-round4-tester@example.invalid','Issue 1972 Round 4 Tester');
  INSERT INTO public.brands(id,account_id,name,slug,default_currency)
  VALUES(v_brand,v_user,'Issue 1972 Round 4 Tester Events','issue-1972-round4-tester-events','USD');
  PERFORM set_config('request.jwt.claim.sub',v_user::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);

  v_payload:=jsonb_build_object(
    'title','Visibility trust boundary',
    'timezone','Africa/Lagos',
    'currency','USD',
    'theme',jsonb_build_object('business_draft',jsonb_build_object(
      'requestedVisibility','not-a-real-visibility',
      'clientRevision',0
    ))
  );

  BEGIN
    PERFORM public.business_create_event_draft(v_brand,v_payload);
    v_failures:=array_append(v_failures,
      'authenticated draft create accepted an invalid requested visibility');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'event_visibility_invalid' THEN
      v_failures:=array_append(v_failures,
        'draft create used an unstable invalid-visibility error: '||SQLERRM);
    END IF;
  END;
  IF EXISTS(
    SELECT 1 FROM public.events
    WHERE brand_id=v_brand AND title='Visibility trust boundary'
  ) THEN
    v_failures:=array_append(v_failures,
      'rejected draft create left a durable event row');
  END IF;

  v_payload:=jsonb_set(
    v_payload,
    '{theme,business_draft,requestedVisibility}',
    '"private"'::jsonb,
    true
  );
  v_event_id:=((public.business_create_event_draft(v_brand,v_payload))#>>'{event,id}')::uuid;
  SELECT to_jsonb(e) INTO v_before FROM public.events e WHERE id=v_event_id;

  v_payload:=jsonb_set(
    v_payload,
    '{theme,business_draft,requestedVisibility}',
    'null'::jsonb,
    true
  );
  v_payload:=jsonb_set(
    v_payload,
    '{theme,business_draft,clientRevision}',
    '1'::jsonb,
    true
  );
  BEGIN
    PERFORM public.business_update_event_draft(v_event_id,v_payload,1);
    v_failures:=array_append(v_failures,
      'authenticated draft update accepted null requested visibility');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'event_visibility_invalid' THEN
      v_failures:=array_append(v_failures,
        'draft update used an unstable invalid-visibility error: '||SQLERRM);
    END IF;
  END;
  SELECT to_jsonb(e) INTO v_after FROM public.events e WHERE id=v_event_id;
  IF v_after IS DISTINCT FROM v_before THEN
    v_failures:=array_append(v_failures,
      'rejected draft update changed the event graph or revision');
  END IF;

  IF cardinality(v_failures)>0 THEN
    RAISE EXCEPTION '#1972 round-4 tester failures: %',
      array_to_string(v_failures,'; ');
  END IF;
END;
$test$;

ROLLBACK;
