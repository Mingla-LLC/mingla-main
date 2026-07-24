\set ON_ERROR_STOP on

BEGIN;

SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id)
VALUES ('11720000-0000-0000-0000-000000000104');

INSERT INTO public.brands (id, account_id, name, slug)
VALUES (
  '11720000-0000-0000-0000-000000000101',
  '11720000-0000-0000-0000-000000000102',
  'Issue 1172 rework',
  'issue-1172-rework'
);

INSERT INTO public.events (id, brand_id, created_by, title, slug, status)
VALUES
(
  '11720000-0000-0000-0000-000000000103',
  '11720000-0000-0000-0000-000000000101',
  '11720000-0000-0000-0000-000000000104',
  'Cancellation race',
  'cancellation-race',
  'ended'
),
(
  '11720000-0000-0000-0000-000000000105',
  '11720000-0000-0000-0000-000000000101',
  '11720000-0000-0000-0000-000000000104',
  'Postponement race',
  'postponement-race',
  'ended'
);

INSERT INTO public.event_dates (id, event_id, start_at, end_at)
VALUES
(
  '11720000-0000-0000-0000-000000000106',
  '11720000-0000-0000-0000-000000000103',
  '2027-01-01 17:00:00+00',
  '2027-01-01 20:00:00+00'
),
(
  '11720000-0000-0000-0000-000000000107',
  '11720000-0000-0000-0000-000000000105',
  '2027-01-01 17:00:00+00',
  '2027-01-01 20:00:00+00'
);

INSERT INTO public.stripe_connect_accounts (
  id, brand_id, stripe_account_id, country, default_currency, payouts_enabled
) VALUES (
  '11720000-0000-0000-0000-000000000108',
  '11720000-0000-0000-0000-000000000101',
  'acct_issue1172_rework',
  'US',
  'USD',
  true
);

INSERT INTO public.brand_payout_releases (
  id, brand_id, event_id, event_date_id, occurrence_key, surface, provider,
  currency, anchor_end_at, releasable_at, gross_cents, net_release_cents,
  attempt_count
) VALUES
(
  '11720000-0000-0000-0000-000000000109',
  '11720000-0000-0000-0000-000000000101',
  '11720000-0000-0000-0000-000000000103',
  '11720000-0000-0000-0000-000000000106',
  'cancel-race',
  'order',
  'stripe',
  'usd',
  '2027-01-01 20:00:00+00',
  '2027-01-04 20:00:00+00',
  10000,
  9000,
  9
),
(
  '11720000-0000-0000-0000-000000000110',
  '11720000-0000-0000-0000-000000000101',
  '11720000-0000-0000-0000-000000000105',
  '11720000-0000-0000-0000-000000000107',
  'postpone-race',
  'order',
  'stripe',
  'usd',
  '2027-01-01 20:00:00+00',
  '2027-01-04 20:00:00+00',
  10000,
  9000,
  9
);

SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE issue_1172_rework_claims AS
SELECT *
FROM public.claim_stripe_payout_releases(
  20,
  '2027-01-10 00:00:00+00'
);

UPDATE public.events
SET status='cancelled'
WHERE id='11720000-0000-0000-0000-000000000103';

DO $test$
DECLARE
  v_claim_id uuid;
  v_authorized boolean;
  v_release public.brand_payout_releases;
BEGIN
  SELECT claim_id INTO STRICT v_claim_id
  FROM issue_1172_rework_claims
  WHERE release_id='11720000-0000-0000-0000-000000000109';
  v_authorized:=public.authorize_stripe_payout_execution(
    '11720000-0000-0000-0000-000000000109',
    v_claim_id,
    9000,
    '2027-01-10 00:00:01+00'
  );
  SELECT * INTO STRICT v_release FROM public.brand_payout_releases
  WHERE id='11720000-0000-0000-0000-000000000109';
  IF v_authorized OR v_release.status<>'cancelled_event'
     OR v_release.attempt_count<>9
     OR v_release.stripe_execution_claim_id IS NOT NULL THEN
    RAISE EXCEPTION 'cancellation pre-execute authorization did not fail safely';
  END IF;
END;
$test$;

UPDATE public.event_dates
SET end_at='2027-02-01 20:00:00+00'
WHERE id='11720000-0000-0000-0000-000000000107';

DO $test$
DECLARE
  v_claim_id uuid;
  v_authorized boolean;
  v_release public.brand_payout_releases;
BEGIN
  SELECT claim_id INTO STRICT v_claim_id
  FROM issue_1172_rework_claims
  WHERE release_id='11720000-0000-0000-0000-000000000110';
  v_authorized:=public.authorize_stripe_payout_execution(
    '11720000-0000-0000-0000-000000000110',
    v_claim_id,
    9000,
    '2027-01-10 00:00:01+00'
  );
  SELECT * INTO STRICT v_release FROM public.brand_payout_releases
  WHERE id='11720000-0000-0000-0000-000000000110';
  IF v_authorized OR v_release.status<>'pending'
     OR v_release.releasable_at<>'2027-02-04 20:00:00+00'
     OR v_release.attempt_count<>9
     OR v_release.stripe_execution_claim_id IS NOT NULL THEN
    RAISE EXCEPTION 'postponement pre-execute authorization did not re-anchor safely';
  END IF;
END;
$test$;

UPDATE public.event_dates
SET end_at='2027-01-01 20:00:00+00'
WHERE id='11720000-0000-0000-0000-000000000107';
UPDATE public.brand_payout_releases
SET anchor_end_at='2027-01-01 20:00:00+00',
    releasable_at='2027-01-04 20:00:00+00',
    status='pending',
    error_message=NULL
WHERE id='11720000-0000-0000-0000-000000000110';

CREATE TEMP TABLE issue_1172_retry_claim AS
SELECT *
FROM public.claim_stripe_payout_releases(
  20,
  '2027-01-10 00:01:00+00'
)
WHERE release_id='11720000-0000-0000-0000-000000000110';

DO $test$
DECLARE
  v_claim_id uuid;
  v_result text;
  v_release public.brand_payout_releases;
BEGIN
  SELECT claim_id INTO STRICT v_claim_id FROM issue_1172_retry_claim;
  v_result:=public.record_stripe_payout_execution(
    '11720000-0000-0000-0000-000000000110',
    v_claim_id,
    'blocked_balance',
    NULL,
    9000,
    'ceiling below ledger amount',
    '2027-01-10 00:01:01+00'
  );
  SELECT * INTO STRICT v_release FROM public.brand_payout_releases
  WHERE id='11720000-0000-0000-0000-000000000110';
  IF v_result<>'blocked_balance' OR v_release.attempt_count<>9 THEN
    RAISE EXCEPTION 'balance-only block consumed provider attempt';
  END IF;
END;
$test$;

UPDATE public.brand_payout_releases
SET status='pending'
WHERE id='11720000-0000-0000-0000-000000000110';

CREATE TEMP TABLE issue_1172_cap_claim AS
SELECT *
FROM public.claim_stripe_payout_releases(
  20,
  '2027-01-10 00:02:00+00'
)
WHERE release_id='11720000-0000-0000-0000-000000000110';

DO $test$
DECLARE
  v_claim_id uuid;
  v_result text;
  v_release public.brand_payout_releases;
BEGIN
  SELECT claim_id INTO STRICT v_claim_id FROM issue_1172_cap_claim;
  v_result:=public.record_stripe_payout_execution(
    '11720000-0000-0000-0000-000000000110',
    v_claim_id,
    'definitive_error',
    NULL,
    9000,
    'definitive malformed payout request',
    '2027-01-10 00:02:01+00'
  );
  SELECT * INTO STRICT v_release FROM public.brand_payout_releases
  WHERE id='11720000-0000-0000-0000-000000000110';
  IF v_result<>'failed' OR v_release.attempt_count<>10 THEN
    RAISE EXCEPTION 'definitive provider failure did not exhaust attempt cap';
  END IF;
END;
$test$;

DO $test$
DECLARE
  v_alert public.payout_release_alert_outbox;
BEGIN
  SELECT * INTO STRICT v_alert
  FROM public.payout_release_alert_outbox
  WHERE release_id='11720000-0000-0000-0000-000000000110'
    AND alert_kind='stripe_attempt_cap';
  IF v_alert.status<>'pending'
     OR v_alert.delivery_attempt_count<>0
     OR v_alert.idempotency_key<>
       'ops.stripe_payout_release_attempt_cap:11720000-0000-0000-0000-000000000110' THEN
    RAISE EXCEPTION 'attempt-cap transition did not atomically persist alert intent';
  END IF;
END;
$test$;

CREATE TEMP TABLE issue_1172_alert_claim_one AS
SELECT *
FROM public.claim_payout_release_alerts(
  20,
  '2027-01-10 00:02:02+00'
);

DO $test$
DECLARE
  v_alert_id uuid;
  v_claim_id uuid;
  v_result text;
  v_alert public.payout_release_alert_outbox;
BEGIN
  SELECT alert_id,claim_id INTO STRICT v_alert_id,v_claim_id
  FROM issue_1172_alert_claim_one
  WHERE release_id='11720000-0000-0000-0000-000000000110';
  v_result:=public.record_payout_release_alert_delivery(
    v_alert_id,
    v_claim_id,
    'retryable',
    'notification transport unavailable',
    '2027-01-10 00:02:03+00'
  );
  SELECT * INTO STRICT v_alert
  FROM public.payout_release_alert_outbox
  WHERE id=v_alert_id;
  IF v_result<>'pending'
     OR v_alert.status<>'pending'
     OR v_alert.delivery_attempt_count<>1
     OR v_alert.last_delivery_error<>'notification transport unavailable'
     OR v_alert.dispatch_claim_id IS NOT NULL THEN
    RAISE EXCEPTION 'failed alert delivery was not retained for retry';
  END IF;
END;
$test$;

CREATE TEMP TABLE issue_1172_alert_claim_two AS
SELECT *
FROM public.claim_payout_release_alerts(
  20,
  '2027-01-10 00:02:04+00'
);

DO $test$
DECLARE
  v_alert_id uuid;
  v_claim_id uuid;
  v_result text;
  v_alert public.payout_release_alert_outbox;
  v_payout_claim_count integer;
BEGIN
  SELECT alert_id,claim_id INTO STRICT v_alert_id,v_claim_id
  FROM issue_1172_alert_claim_two
  WHERE release_id='11720000-0000-0000-0000-000000000110';
  v_result:=public.record_payout_release_alert_delivery(
    v_alert_id,
    v_claim_id,
    'provider_accepted',
    NULL,
    '2027-01-10 00:02:05+00'
  );
  SELECT * INTO STRICT v_alert
  FROM public.payout_release_alert_outbox
  WHERE id=v_alert_id;
  SELECT count(*) INTO v_payout_claim_count
  FROM public.claim_stripe_payout_releases(
    20,
    '2027-01-10 00:02:06+00'
  )
  WHERE release_id='11720000-0000-0000-0000-000000000110';
  IF v_result<>'provider_accepted'
     OR v_alert.status<>'provider_accepted'
     OR v_alert.delivery_attempt_count<>2
     OR v_alert.provider_accepted_at IS NULL
     OR v_payout_claim_count<>0 THEN
    RAISE EXCEPTION 'alert retry did not deliver exactly once without payout retry';
  END IF;
END;
$test$;

INSERT INTO public.brand_payout_releases (
  id, brand_id, event_id, event_date_id, occurrence_key, surface, provider,
  currency, anchor_end_at, releasable_at, gross_cents, net_release_cents,
  status, stripe_payout_id, attempt_count, organiser_cash_delivered_cents,
  released_at
) VALUES (
  '11720000-0000-0000-0000-000000000111',
  '11720000-0000-0000-0000-000000000101',
  '11720000-0000-0000-0000-000000000105',
  '11720000-0000-0000-0000-000000000107',
  'async-failure',
  'rsvp_contribution',
  'stripe',
  'usd',
  '2027-01-01 20:00:00+00',
  '2027-01-04 20:00:00+00',
  10000,
  9000,
  'released',
  'po_issue1172_async_failed',
  8,
  9000,
  '2027-01-10 00:03:00+00'
);

INSERT INTO public.payouts (
  brand_id, stripe_payout_id, amount_cents, currency, status, initiated_by,
  release_id
) VALUES (
  '11720000-0000-0000-0000-000000000101',
  'po_issue1172_async_failed',
  9000,
  'usd',
  'failed',
  'mingla_release',
  '11720000-0000-0000-0000-000000000111'
);

DO $test$
DECLARE
  v_first jsonb;
  v_replay jsonb;
  v_release public.brand_payout_releases;
BEGIN
  v_first:=public.record_stripe_payout_webhook_failure(
    'po_issue1172_async_failed',
    true,
    'account_closed:bank account closed',
    '2027-01-10 00:03:01+00'
  );
  v_replay:=public.record_stripe_payout_webhook_failure(
    'po_issue1172_async_failed',
    true,
    'account_closed:bank account closed',
    '2027-01-10 00:03:02+00'
  );
  SELECT * INTO STRICT v_release FROM public.brand_payout_releases
  WHERE id='11720000-0000-0000-0000-000000000111';
  IF v_first->>'status'<>'blocked_kyc'
     OR (v_first->>'mutated')::boolean IS DISTINCT FROM true
     OR (v_replay->>'mutated')::boolean IS DISTINCT FROM false
     OR v_release.status<>'blocked_kyc'
     OR v_release.attempt_count<>8
     OR v_release.stripe_payout_id IS NOT NULL THEN
    RAISE EXCEPTION 'async payout.failed did not reopen exactly once for safe retry';
  END IF;
END;
$test$;

ROLLBACK;
