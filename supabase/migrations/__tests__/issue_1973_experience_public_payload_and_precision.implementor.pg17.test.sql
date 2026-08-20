\set ON_ERROR_STOP on

-- #1973 implementor round-four proof. This executes the registered public
-- update/manage-stops shapes through the immutable receipt boundary and proves
-- create round-trips exact, approximate, and null stop precision atomically.
BEGIN;

INSERT INTO auth.users(id,email)
VALUES ('19730000-0000-4000-8000-000000000701','issue1973-r4-owner@example.com');

INSERT INTO public.creator_accounts(id,email,display_name)
VALUES (
  '19730000-0000-4000-8000-000000000701',
  'issue1973-r4-owner@example.com',
  'Issue 1973 round-four owner'
);

INSERT INTO public.brands(
  id,account_id,name,slug,kind,has_physical_location,default_currency
) VALUES (
  '19730000-0000-4000-8000-000000000702',
  '19730000-0000-4000-8000-000000000701',
  'Issue 1973 Public Payload',
  'issue-1973-public-payload',
  'physical',
  true,
  'USD'
);

SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','19730000-0000-4000-8000-000000000701',true);
SET LOCAL ROLE authenticated;

SELECT public.business_create_experience_graph(
  '19730000-0000-4000-8000-000000000702',
  '{
    "title":"Precision round trip",
    "description":"Every canonical stop precision survives create",
    "currency":"USD",
    "is_free":true,
    "location_mode":"per_stop",
    "pricing_mode":"per_stop",
    "experience_intents":["adventurous"],
    "stops":[
      {"stop_order":0,"place_name":"Exact stop","address":"","coordinate_precision":"exact","price_cents":0},
      {"stop_order":1,"place_name":"Approximate stop","address":"","coordinate_precision":"approximate","price_cents":0},
      {"stop_order":2,"place_name":"Unknown stop","address":"","coordinate_precision":null,"price_cents":0}
    ]
  }'::jsonb
);

DO $proof$
DECLARE
  v_event_id uuid;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title='Precision round trip';
  IF (SELECT coordinate_precision FROM public.experience_stops
      WHERE event_id=v_event_id AND stop_order=0) IS DISTINCT FROM 'exact' THEN
    RAISE EXCEPTION '#1973 exact precision was lost during create';
  END IF;
  IF (SELECT coordinate_precision FROM public.experience_stops
      WHERE event_id=v_event_id AND stop_order=1) IS DISTINCT FROM 'approximate' THEN
    RAISE EXCEPTION '#1973 approximate precision was lost during create';
  END IF;
  IF (SELECT coordinate_precision FROM public.experience_stops
      WHERE event_id=v_event_id AND stop_order=2) IS NOT NULL THEN
    RAISE EXCEPTION '#1973 null precision was fabricated during create';
  END IF;
END;
$proof$;

DO $atomic_invalid$
BEGIN
  BEGIN
    PERFORM public.business_create_experience_graph(
      '19730000-0000-4000-8000-000000000702',
      '{"title":"Invalid precision must roll back","currency":"USD","is_free":true,"stops":[{"place_name":"Bad stop","coordinate_precision":"street-level"}]}'::jsonb
    );
    RAISE EXCEPTION '#1973 invalid precision was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '#1973 invalid precision was accepted%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%experience_coordinate_precision_invalid%' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.events WHERE title='Invalid precision must roll back') THEN
    RAISE EXCEPTION '#1973 invalid precision left a partial graph';
  END IF;
END;
$atomic_invalid$;

RESET ROLE;

INSERT INTO public.agent_pending_actions(
  id,user_id,tool_name,tool_args,status,source,related_brand_id,
  server_proposed_at,execution_attested_at
)
SELECT
  '19730000-0000-4000-8000-000000000704',
  '19730000-0000-4000-8000-000000000701',
  'update_experience',
  jsonb_build_object(
    'event_id',e.id,
    'expected_revision',e.updated_at,
    'title','Updated from public shape',
    'description','The receipt consumed the exact registered update payload'
  ),
  'executing','hub_experience',e.brand_id,now(),now()
FROM public.events e WHERE e.title='Precision round trip';

SET LOCAL ROLE authenticated;

SELECT public.ari_execute_experience_operation(
  '19730000-0000-4000-8000-000000000704',
  'update_experience',
  (SELECT tool_args FROM public.agent_pending_actions
   WHERE id='19730000-0000-4000-8000-000000000704')
);

RESET ROLE;

INSERT INTO public.agent_pending_actions(
  id,user_id,tool_name,tool_args,status,source,related_brand_id,
  server_proposed_at,execution_attested_at
)
SELECT
  '19730000-0000-4000-8000-000000000705',
  '19730000-0000-4000-8000-000000000701',
  'manage_experience_stops',
  jsonb_build_object(
    'event_id',e.id,
    'expected_revision',e.updated_at,
    'experience_intents',jsonb_build_array('group-fun'),
    'stops',jsonb_build_array(
      jsonb_build_object('stop_order',0,'place_name','Managed exact stop','address','','coordinate_precision','exact','price_cents',0),
      jsonb_build_object('stop_order',1,'place_name','Managed unknown stop','address','','coordinate_precision',NULL,'price_cents',0)
    )
  ),
  'executing','hub_experience',e.brand_id,now(),now()
FROM public.events e WHERE e.title='Updated from public shape';

SET LOCAL ROLE authenticated;

SELECT public.ari_execute_experience_operation(
  '19730000-0000-4000-8000-000000000705',
  'manage_experience_stops',
  (SELECT tool_args FROM public.agent_pending_actions
   WHERE id='19730000-0000-4000-8000-000000000705')
);

RESET ROLE;

DO $proof$
DECLARE
  v_event_id uuid;
BEGIN
  SELECT id INTO v_event_id FROM public.events WHERE title='Updated from public shape';
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION '#1973 public update shape did not mutate the domain row';
  END IF;
  IF (SELECT timezone FROM public.events WHERE id=v_event_id) IS NOT NULL
     OR (SELECT theme#>>'{experience_meta,when_draft,timezone}'
         FROM public.events WHERE id=v_event_id) IS NOT NULL THEN
    RAISE EXCEPTION '#1973 partial public update fabricated a timezone';
  END IF;
  IF (SELECT experience_intents FROM public.events WHERE id=v_event_id)
     IS DISTINCT FROM ARRAY['group-fun']::text[] THEN
    RAISE EXCEPTION '#1973 public manage-stops shape did not persist intents';
  END IF;
  IF (SELECT count(*) FROM public.experience_stops WHERE event_id=v_event_id) <> 2
     OR (SELECT coordinate_precision FROM public.experience_stops
         WHERE event_id=v_event_id AND stop_order=0) IS DISTINCT FROM 'exact'
     OR (SELECT coordinate_precision FROM public.experience_stops
         WHERE event_id=v_event_id AND stop_order=1) IS NOT NULL THEN
    RAISE EXCEPTION '#1973 public manage-stops shape lost canonical precision';
  END IF;
  IF (SELECT count(*) FROM public.agent_operation_receipts
      WHERE operation_id IN (
        '19730000-0000-4000-8000-000000000704',
        '19730000-0000-4000-8000-000000000705'
      )) <> 2 THEN
    RAISE EXCEPTION '#1973 public execution payload did not create both receipts';
  END IF;
END;
$proof$;

ROLLBACK;
