BEGIN;

INSERT INTO auth.users (id) VALUES ('27940000-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts (id)
VALUES ('27940000-0000-4000-8000-000000000001');
INSERT INTO public.brands (id, account_id, name, slug, default_currency)
VALUES ('27940000-0000-4000-8000-000000000010', '27940000-0000-4000-8000-000000000001', 'Recent Test', 'recent-test', 'USD');
INSERT INTO public.events (id, brand_id, created_by, title, slug, status, visibility, event_type)
SELECT ('2794' || lpad(to_hex(g), 4, '0') || '-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
       '27940000-0000-4000-8000-000000000010',
       '27940000-0000-4000-8000-000000000001',
       'Recent ' || g, 'recent-' || g, 'live', 'public', 'event'
  FROM generate_series(1, 202) g;
UPDATE public.events
   SET status = 'ended', updated_at = '2027-06-09 12:00:00+00'
 WHERE id = '279400ca-0000-4000-8000-000000000202';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '27940000-0000-4000-8000-000000000001', true);

DO $test$
DECLARE
  v jsonb;
  v_advanced jsonb;
  v_stale jsonb;
  v_before timestamptz;
  v_after timestamptz;
  i integer;
  v_first uuid := '27940001-0000-4000-8000-000000000001';
BEGIN
  v_before := clock_timestamp();
  v := public.biz_record_recent_entity_open(
    '27940000-0000-4000-8000-000000000010', 'event', v_first,
    now() + interval '1 day', '27940000-0000-4000-8001-000000000001');
  v_after := clock_timestamp();
  IF (v->>'acceptedOpenedAt')::timestamptz < v_before
     OR (v->>'acceptedOpenedAt')::timestamptz > v_after THEN
    RAISE EXCEPTION 'future timestamp was not clamped to server receipt time';
  END IF;
  IF public.biz_record_recent_entity_open(
    '27940000-0000-4000-8000-000000000010', 'event', v_first,
    now() - interval '1 day', '27940000-0000-4000-8001-000000000001') <> v THEN
    RAISE EXCEPTION 'idempotent replay changed acknowledgement';
  END IF;
  v_advanced := public.biz_record_recent_entity_open(
    '27940000-0000-4000-8000-000000000010', 'event', v_first,
    now() - interval '2 days', '27940000-0000-4000-8001-000000000099');
  IF v_advanced->>'acceptedOpenedAt' <> v->>'acceptedOpenedAt' THEN
    RAISE EXCEPTION 'older open moved the pointer backward';
  END IF;
  FOR i IN 2..201 LOOP
    PERFORM public.biz_record_recent_entity_open(
      '27940000-0000-4000-8000-000000000010', 'event',
      ('2794' || lpad(to_hex(i), 4, '0') || '-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
      now() + i * interval '1 millisecond',
      ('2794' || lpad(to_hex(i), 4, '0') || '-0000-4000-8001-' || lpad(i::text, 12, '0'))::uuid);
  END LOOP;
  IF (SELECT count(*) FROM public.biz_list_recent_entity_index('27940000-0000-4000-8000-000000000010')) <> 200 THEN
    RAISE EXCEPTION 'retention was not bounded at 200';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.biz_list_recent_entity_index('27940000-0000-4000-8000-000000000010')
     WHERE entity_id = '279400ca-0000-4000-8000-000000000202'
       AND raw_status = 'ended'
       AND ended_at = '2027-06-09 12:00:00+00'::timestamptz
  ) THEN
    RAISE EXCEPTION 'ended lifecycle timestamp did not follow canonical event status/update truth';
  END IF;
  v := public.biz_record_recent_entity_open(
    '27940000-0000-4000-8000-000000000010', 'event', v_first,
    now(), '27940000-0000-4000-8001-000000000001');
  v_advanced := public.biz_record_recent_entity_open(
    '27940000-0000-4000-8000-000000000010', 'event',
    '27940002-0000-4000-8000-000000000002', now(),
    '27940002-0000-4000-8001-000000000002');
  IF (v->>'retained')::boolean AND (v_advanced->>'retained')::boolean THEN
    RAISE EXCEPTION 'replay of a subsequently pruned operation claimed retained=true';
  END IF;
  v_stale := public.biz_record_recent_entity_open(
    '27940000-0000-4000-8000-000000000010', 'event',
    '279400ca-0000-4000-8000-000000000202', now() - interval '30 days',
    '279400ca-0000-4000-8001-000000000202');
  IF (v_stale->>'retained')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION '201st stale pointer did not self-prune with retained=false';
  END IF;
  IF public.biz_record_recent_entity_open(
    '27940000-0000-4000-8000-000000000010', 'event',
    '279400ca-0000-4000-8000-000000000202', now(),
    '279400ca-0000-4000-8001-000000000202') <> v_stale THEN
    RAISE EXCEPTION 'stale self-prune operation replay changed acknowledgement';
  END IF;
  BEGIN
    PERFORM public.biz_record_recent_entity_open(
      '27940000-0000-4000-8000-000000000010', 'event',
      '279400c9-0000-4000-8000-000000000201', now(),
      '279400ca-0000-4000-8001-000000000202');
    RAISE EXCEPTION 'operation mismatch was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'recent_operation_mismatch' THEN RAISE; END IF;
  END;
  PERFORM public.biz_record_recent_entity_open(
    '27940000-0000-4000-8000-000000000010', 'event', v_first, now(),
    '27940000-0000-4000-8001-000000000100');
  IF NOT EXISTS (SELECT 1 FROM public.biz_list_recent_entity_index('27940000-0000-4000-8000-000000000010') WHERE entity_id = v_first)
     OR (SELECT count(*) FROM public.biz_list_recent_entity_index('27940000-0000-4000-8000-000000000010')) <> 200 THEN
    RAISE EXCEPTION 'pruned pointer did not reopen within the bound';
  END IF;
  v := public.biz_hydrate_recent_entities(
    '27940000-0000-4000-8000-000000000010',
    jsonb_build_array(
      jsonb_build_object('entityType','event','entityId','279400c9-0000-4000-8000-000000000201'),
      jsonb_build_object('entityType','event','entityId','279400c8-0000-4000-8000-000000000200')));
  IF jsonb_array_length(v->'items') <> 2
     OR v->'items'->0->>'entityId' <> '279400c9-0000-4000-8000-000000000201'
     OR v->'items'->1->>'entityId' <> '279400c8-0000-4000-8000-000000000200' THEN
    RAISE EXCEPTION 'authorized hydration did not preserve requested order';
  END IF;
END;
$test$;

RESET ROLE;
UPDATE public.events SET deleted_at = now()
 WHERE id = '279400c9-0000-4000-8000-000000000201';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '27940000-0000-4000-8000-000000000001', true);
DO $omission$
DECLARE v jsonb;
BEGIN
  v := public.biz_hydrate_recent_entities(
    '27940000-0000-4000-8000-000000000010',
    jsonb_build_array(jsonb_build_object(
      'entityType','event','entityId','279400c9-0000-4000-8000-000000000201')));
  IF jsonb_array_length(v->'items') <> 0
     OR jsonb_array_length(v->'omitted') <> 1 THEN
    RAISE EXCEPTION 'deleted retained pointer was not safely omitted';
  END IF;
END;
$omission$;

DO $terminal$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.biz_record_recent_entity_open(uuid,text,uuid,timestamptz,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_2794_terminal_execute_grant';
  END IF;
END;
$terminal$;

ROLLBACK;
