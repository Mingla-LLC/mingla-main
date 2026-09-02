BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.issue2979_a17_uuid(seed text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  SELECT (substr(md5('issue2979-a17:'||seed),1,8)||'-'||substr(md5('issue2979-a17:'||seed),9,4)||'-4'||substr(md5('issue2979-a17:'||seed),14,3)||'-8'||substr(md5('issue2979-a17:'||seed),18,3)||'-'||substr(md5('issue2979-a17:'||seed),21,12))::uuid
$$;

SET session_replication_role = replica;
INSERT INTO auth.users(id) VALUES
  (pg_temp.issue2979_a17_uuid('creator')),
  (pg_temp.issue2979_a17_uuid('claimant'));
INSERT INTO public.creator_accounts(id,email)
VALUES(
  pg_temp.issue2979_a17_uuid('creator'),
  'issue2979-a17-creator@example.test'
);
INSERT INTO public.brands(id,account_id,name,slug)
VALUES(
  pg_temp.issue2979_a17_uuid('brand'),
  pg_temp.issue2979_a17_uuid('creator'),
  'Issue 2979 A17',
  'issue-2979-a17'
);
INSERT INTO public.events(
  id,brand_id,created_by,title,slug,event_type,status,visibility,timezone,theme
) VALUES (
  pg_temp.issue2979_a17_uuid('event'),
  pg_temp.issue2979_a17_uuid('brand'),
  pg_temp.issue2979_a17_uuid('creator'),
  'Issue 2979 A17 Event',
  'issue-2979-a17-event',
  'event','scheduled','public','UTC','{}'::jsonb
);
INSERT INTO public.ticket_types(
  id,event_id,name,price_cents,currency,quantity_total
) VALUES (
  pg_temp.issue2979_a17_uuid('tier'),
  pg_temp.issue2979_a17_uuid('event'),
  'General',1000,'USD',10
);
INSERT INTO public.orders(
  id,event_id,buyer_email,buyer_name,total_cents,currency,payment_status,source,
  attendance_claim_token_digest,attendance_claim_token_generation,
  attendance_claim_token_created_at,attendance_claim_legacy_token_digest,
  attendance_claim_legacy_token_created_at
) VALUES (
  pg_temp.issue2979_a17_uuid('order'),
  pg_temp.issue2979_a17_uuid('event'),
  'issue2979-a17-buyer@example.test','A17 Buyer',1000,'USD','paid','legacy',
  decode(repeat('a7',32),'hex'),'legacy_v1',now(),NULL,NULL
);
INSERT INTO public.tickets(
  id,order_id,ticket_type_id,event_id,qr_code,status,approval_status
) VALUES (
  pg_temp.issue2979_a17_uuid('ticket'),
  pg_temp.issue2979_a17_uuid('order'),
  pg_temp.issue2979_a17_uuid('tier'),
  pg_temp.issue2979_a17_uuid('event'),
  'issue-2979-a17-ticket','valid','auto'
);
SET session_replication_role = origin;

DO $a17$
DECLARE
  v_result jsonb;
BEGIN
  -- The governed/current candidate is deliberately different. An untouched
  -- legacy_v1 proof lives only in the active column and must be checked against
  -- the legacy candidate supplied by the dual-reader Edge function.
  v_result := public.claim_attendance_internal_v2(
    pg_temp.issue2979_a17_uuid('claimant'),
    'order',
    pg_temp.issue2979_a17_uuid('event'),
    pg_temp.issue2979_a17_uuid('order'),
    decode(repeat('b7',32),'hex'),
    decode(repeat('a7',32),'hex')
  );
  IF v_result->>'result' <> 'claimed' THEN
    RAISE EXCEPTION 'A17 valid legacy active proof was rejected: %', v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
     WHERE id = pg_temp.issue2979_a17_uuid('order')
       AND buyer_user_id = pg_temp.issue2979_a17_uuid('claimant')
       AND attendance_claim_token_digest IS NULL
       AND attendance_claim_token_generation IS NULL
       AND attendance_claim_legacy_token_digest IS NULL
       AND attendance_claim_token_consumed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A17 claim did not atomically consume the legacy proof';
  END IF;

  v_result := public.claim_attendance_internal_v2(
    pg_temp.issue2979_a17_uuid('claimant'),
    'order',
    pg_temp.issue2979_a17_uuid('event'),
    pg_temp.issue2979_a17_uuid('order'),
    decode(repeat('b7',32),'hex'),
    decode(repeat('a7',32),'hex')
  );
  IF v_result->>'result' <> 'invalid' THEN
    RAISE EXCEPTION 'A17 consumed proof replay was accepted: %', v_result;
  END IF;
END;
$a17$;

ROLLBACK;
