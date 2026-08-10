-- #1770 real two-session PostgreSQL 17 regression for invite/channel ordinals.
-- Apply the #1770 migration first. Fixtures use an isolated UUID namespace.
\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS dblink;

INSERT INTO auth.users(id) VALUES('17700000-0000-4000-8000-000000000102');
INSERT INTO public.brands(id,account_id,name,slug,default_currency,created_at,updated_at)
VALUES('17700000-0000-4000-8000-000000000101','17700000-0000-4000-8000-000000000102','Ordinal Brand','ordinal-brand','USD',now(),now());
INSERT INTO public.events(id,brand_id,created_by,event_type,title,slug,status,visibility,currency,timezone,party_types,rsvp_approval_mode,rsvp_discoverable,theme,created_at,updated_at)
VALUES('17700000-0000-4000-8000-000000000103','17700000-0000-4000-8000-000000000101','17700000-0000-4000-8000-000000000102','rsvp','Ordinal Event','ordinal-event','scheduled','public','USD','UTC','{}','auto',false,'{}',now(),now());
INSERT INTO public.brand_people(id,brand_id,display_name)
VALUES('17700000-0000-4000-8000-000000000104','17700000-0000-4000-8000-000000000101','Ordinal Person');
INSERT INTO public.brand_person_contact_methods(id,brand_id,brand_person_id,channel,normalized_value,provenance_scope,is_exportable,suppression_eligible,is_primary)
VALUES('17700000-0000-4000-8000-000000000105','17700000-0000-4000-8000-000000000101','17700000-0000-4000-8000-000000000104','email','ordinal@example.test','brand_owned',true,true,true);
INSERT INTO public.brand_offering_invites(id,brand_id,event_id,brand_person_id,status,origin,invited_at,created_by)
VALUES('17700000-0000-4000-8000-000000000106','17700000-0000-4000-8000-000000000101','17700000-0000-4000-8000-000000000103','17700000-0000-4000-8000-000000000104','active','attached_blast',now(),'17700000-0000-4000-8000-000000000102');
INSERT INTO public.marketing_send_groups(id,event_id,brand_id,purpose,client_request_id,channels,eligibility_hash,quote_hash,quoted_at,execution_snapshot_hash,created_by)
VALUES
('17700000-0000-4000-8000-000000000107','17700000-0000-4000-8000-000000000103','17700000-0000-4000-8000-000000000101','invitation','17700000-0000-4000-8000-000000000109',ARRAY['email'],repeat('0',64),repeat('1',64),now(),repeat('2',64),'17700000-0000-4000-8000-000000000102'),
('17700000-0000-4000-8000-000000000108','17700000-0000-4000-8000-000000000103','17700000-0000-4000-8000-000000000101','invitation','17700000-0000-4000-8000-000000000110',ARRAY['email'],repeat('3',64),repeat('4',64),now(),repeat('5',64),'17700000-0000-4000-8000-000000000102');

DO $concurrency$
DECLARE
  v_conn text:=format('dbname=%L user=%L host=%L port=%L',current_database(),current_user,current_setting('unix_socket_directories'),current_setting('port'));
  v_a smallint;
  v_b smallint;
  v_held boolean;
BEGIN
  PERFORM dblink_connect('issue1770_a',v_conn);
  PERFORM dblink_connect('issue1770_b',v_conn);
  PERFORM dblink_send_query('issue1770_a',$q$
    WITH inserted AS (
      INSERT INTO public.brand_offering_invite_delivery_attempts(invite_id,send_group_id,contact_method_id,channel,attempt_kind,attempt_ordinal,status)
      SELECT '17700000-0000-4000-8000-000000000106','17700000-0000-4000-8000-000000000107','17700000-0000-4000-8000-000000000105','email','initial',
        public.issue_1770_next_attempt_ordinal('17700000-0000-4000-8000-000000000106','email'),'queued'
      RETURNING attempt_ordinal
    ) SELECT attempt_ordinal,(pg_sleep(1) IS NULL) FROM inserted
  $q$);
  PERFORM pg_sleep(0.15);
  PERFORM dblink_send_query('issue1770_b',$q$
    INSERT INTO public.brand_offering_invite_delivery_attempts(invite_id,send_group_id,contact_method_id,channel,attempt_kind,attempt_ordinal,status)
    SELECT '17700000-0000-4000-8000-000000000106','17700000-0000-4000-8000-000000000108','17700000-0000-4000-8000-000000000105','email','initial',
      public.issue_1770_next_attempt_ordinal('17700000-0000-4000-8000-000000000106','email'),'queued'
    RETURNING attempt_ordinal
  $q$);
  PERFORM pg_sleep(0.15);
  IF dblink_is_busy('issue1770_b')<>1 THEN RAISE EXCEPTION 'T-1770-10 FAIL: second allocator did not wait'; END IF;
  SELECT ordinal,held INTO v_a,v_held FROM dblink_get_result('issue1770_a') AS t(ordinal smallint,held boolean);
  SELECT ordinal INTO v_b FROM dblink_get_result('issue1770_b') AS t(ordinal smallint);
  PERFORM dblink_disconnect('issue1770_a');
  PERFORM dblink_disconnect('issue1770_b');
  IF (v_a,v_b) IS DISTINCT FROM (1::smallint,2::smallint)
     OR (SELECT array_agg(attempt_ordinal ORDER BY attempt_ordinal) FROM public.brand_offering_invite_delivery_attempts WHERE invite_id='17700000-0000-4000-8000-000000000106' AND channel='email')<>ARRAY[1,2]::smallint[] THEN
    RAISE EXCEPTION 'T-1770-10 FAIL: concurrent ordinals were %/%',v_a,v_b;
  END IF;
  RAISE NOTICE 'T-1770-10 PASS: two sessions committed distinct ordinals 1 and 2';
END;
$concurrency$;

DELETE FROM public.brand_offering_invite_delivery_attempts WHERE invite_id='17700000-0000-4000-8000-000000000106';
DELETE FROM public.marketing_send_groups WHERE id IN ('17700000-0000-4000-8000-000000000107','17700000-0000-4000-8000-000000000108');
DELETE FROM public.brand_offering_invites WHERE id='17700000-0000-4000-8000-000000000106';
DELETE FROM public.brand_person_contact_methods WHERE id='17700000-0000-4000-8000-000000000105';
DELETE FROM public.brand_people WHERE id='17700000-0000-4000-8000-000000000104';
DELETE FROM public.events WHERE id='17700000-0000-4000-8000-000000000103';
DELETE FROM public.brands WHERE id='17700000-0000-4000-8000-000000000101';
DELETE FROM auth.users WHERE id='17700000-0000-4000-8000-000000000102';
\echo 'issue #1770 concurrent ordinal path passed (T-1770-10)'
