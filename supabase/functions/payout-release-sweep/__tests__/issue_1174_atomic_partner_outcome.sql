\set ON_ERROR_STOP on

-- Implementor-owned PostgreSQL regression for issue #1174's binding atomic
-- provider-sale-outcome amendment.

BEGIN;

INSERT INTO auth.users (id) VALUES
  ('1174a000-0000-4000-8000-000000000001'),
  ('1174a000-0000-4000-8000-000000000002'),
  ('1174a000-0000-4000-8000-000000000003');

INSERT INTO public.creator_accounts (id, email, partner_enabled) VALUES
  (
    '1174a000-0000-4000-8000-000000000001',
    'issue-1174-atomic-owner@example.test',
    false
  ),
  (
    '1174a000-0000-4000-8000-000000000002',
    'issue-1174-atomic-partner@example.test',
    true
  ),
  (
    '1174a000-0000-4000-8000-000000000003',
    'issue-1174-atomic-other@example.test',
    true
  );

INSERT INTO public.brands (
  id,
  account_id,
  name,
  slug,
  default_currency,
  payment_provider,
  payout_hold_cutover_at
) VALUES
  (
    '1174a000-0000-4000-8000-000000000010',
    '1174a000-0000-4000-8000-000000000001',
    'Issue 1174 Atomic Brand',
    'issue-1174-atomic-brand',
    'NGN',
    'paystack',
    '2026-07-24T00:00:00Z'
  ),
  (
    '1174a000-0000-4000-8000-000000000011',
    '1174a000-0000-4000-8000-000000000003',
    'Issue 1174 Other Brand',
    'issue-1174-other-brand',
    'NGN',
    'paystack',
    '2026-07-24T00:00:00Z'
  );

INSERT INTO public.events (
  id,
  brand_id,
  title,
  slug,
  currency,
  status,
  visibility
) VALUES
  (
    '1174a000-0000-4000-8000-000000000020',
    '1174a000-0000-4000-8000-000000000010',
    'Issue 1174 Atomic Event',
    'issue-1174-atomic-event',
    'NGN',
    'scheduled',
    'private'
  ),
  (
    '1174a000-0000-4000-8000-000000000021',
    '1174a000-0000-4000-8000-000000000011',
    'Issue 1174 Other Event',
    'issue-1174-other-event',
    'NGN',
    'scheduled',
    'private'
  );

INSERT INTO public.orders (
  id,
  event_id,
  total_cents,
  currency,
  payment_status,
  stripe_application_fee_amount_cents,
  buyer_phone_e164,
  created_at
) VALUES
  (
    '1174a000-0000-4000-8000-000000000030',
    '1174a000-0000-4000-8000-000000000020',
    1000000,
    'NGN',
    'paid',
    100000,
    '+15555551001',
    '2026-07-25T00:00:00Z'
  ),
  (
    '1174a000-0000-4000-8000-000000000031',
    '1174a000-0000-4000-8000-000000000020',
    1000000,
    'NGN',
    'paid',
    100000,
    '+15555551002',
    '2026-07-25T00:01:00Z'
  ),
  (
    '1174a000-0000-4000-8000-000000000032',
    '1174a000-0000-4000-8000-000000000020',
    1000000,
    'NGN',
    'paid',
    100000,
    '+15555551003',
    '2026-07-25T00:02:00Z'
  ),
  (
    '1174a000-0000-4000-8000-000000000033',
    '1174a000-0000-4000-8000-000000000020',
    1000000,
    'NGN',
    'paid',
    100000,
    '+15555551004',
    '2026-07-25T00:03:00Z'
  ),
  (
    '1174a000-0000-4000-8000-000000000034',
    '1174a000-0000-4000-8000-000000000020',
    1000000,
    'NGN',
    'paid',
    100000,
    '+15555551005',
    '2026-07-25T00:04:00Z'
  ),
  (
    '1174a000-0000-4000-8000-000000000035',
    '1174a000-0000-4000-8000-000000000020',
    1000000,
    'NGN',
    'paid',
    100000,
    '+15555551006',
    '2026-07-25T00:05:00Z'
  );

-- One complete partner outcome and two exact replays remain 1 attribution /
-- 1 held obligation.
SELECT public.record_payout_partner_outcome(
  'paystack:issue-1174-atomic',
  '1174a000-0000-4000-8000-000000000030',
  '1174a000-0000-4000-8000-000000000010',
  '1174a000-0000-4000-8000-000000000002',
  '2026-07-25T01:00:00Z',
  100000,
  10000,
  'ngn',
  'paystack'
);
SELECT public.record_payout_partner_outcome(
  'paystack:issue-1174-atomic',
  '1174a000-0000-4000-8000-000000000030',
  '1174a000-0000-4000-8000-000000000010',
  '1174a000-0000-4000-8000-000000000002',
  '2026-07-25T01:00:00Z',
  100000,
  10000,
  'NGN',
  'paystack'
);

DO $$
DECLARE
  v_attributions integer;
  v_splits integer;
BEGIN
  SELECT count(*)::integer INTO v_attributions
  FROM public.payout_partner_attributions
  WHERE order_id = '1174a000-0000-4000-8000-000000000030';

  SELECT count(*)::integer INTO v_splits
  FROM public.partner_splits
  WHERE stripe_application_fee_id = 'paystack:issue-1174-atomic';

  IF v_attributions <> 1 OR v_splits <> 1 THEN
    RAISE EXCEPTION
      'atomic exact replay duplicated rows: attributions %, splits %',
      v_attributions,
      v_splits;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.expect_partner_outcome_mismatch(
  p_key text,
  p_order_id uuid,
  p_brand_id uuid,
  p_partner_account_id uuid,
  p_provider_sale_at timestamptz,
  p_mingla_fee_cents integer,
  p_partner_share_cents integer,
  p_currency text,
  p_provider text
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  BEGIN
    PERFORM public.record_payout_partner_outcome(
      p_key,
      p_order_id,
      p_brand_id,
      p_partner_account_id,
      p_provider_sale_at,
      p_mingla_fee_cents,
      p_partner_share_cents,
      p_currency,
      p_provider
    );
    RAISE EXCEPTION 'expected_partner_attribution_replay_mismatch';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%partner_attribution_replay_mismatch%' THEN
        RAISE;
      END IF;
  END;
END;
$function$;

-- Every canonical field mismatch fails closed without mutating either row.
SELECT pg_temp.expect_partner_outcome_mismatch(
  'paystack:issue-1174-changed-key',
  '1174a000-0000-4000-8000-000000000030',
  '1174a000-0000-4000-8000-000000000010',
  '1174a000-0000-4000-8000-000000000002',
  '2026-07-25T01:00:00Z', 100000, 10000, 'ngn', 'paystack'
);
SELECT pg_temp.expect_partner_outcome_mismatch(
  'paystack:issue-1174-atomic',
  '1174a000-0000-4000-8000-000000000031',
  '1174a000-0000-4000-8000-000000000010',
  '1174a000-0000-4000-8000-000000000002',
  '2026-07-25T01:00:00Z', 100000, 10000, 'ngn', 'paystack'
);
SELECT pg_temp.expect_partner_outcome_mismatch(
  'paystack:issue-1174-atomic',
  '1174a000-0000-4000-8000-000000000030',
  '1174a000-0000-4000-8000-000000000011',
  '1174a000-0000-4000-8000-000000000002',
  '2026-07-25T01:00:00Z', 100000, 10000, 'ngn', 'paystack'
);
SELECT pg_temp.expect_partner_outcome_mismatch(
  'paystack:issue-1174-atomic',
  '1174a000-0000-4000-8000-000000000030',
  '1174a000-0000-4000-8000-000000000010',
  '1174a000-0000-4000-8000-000000000003',
  '2026-07-25T01:00:00Z', 100000, 10000, 'ngn', 'paystack'
);
SELECT pg_temp.expect_partner_outcome_mismatch(
  'paystack:issue-1174-atomic',
  '1174a000-0000-4000-8000-000000000030',
  '1174a000-0000-4000-8000-000000000010',
  '1174a000-0000-4000-8000-000000000002',
  '2026-07-25T01:00:01Z', 100000, 10000, 'ngn', 'paystack'
);
SELECT pg_temp.expect_partner_outcome_mismatch(
  'paystack:issue-1174-atomic',
  '1174a000-0000-4000-8000-000000000030',
  '1174a000-0000-4000-8000-000000000010',
  '1174a000-0000-4000-8000-000000000002',
  '2026-07-25T01:00:00Z', 110000, 10000, 'ngn', 'paystack'
);
SELECT pg_temp.expect_partner_outcome_mismatch(
  'paystack:issue-1174-atomic',
  '1174a000-0000-4000-8000-000000000030',
  '1174a000-0000-4000-8000-000000000010',
  '1174a000-0000-4000-8000-000000000002',
  '2026-07-25T01:00:00Z', 100000, 11000, 'ngn', 'paystack'
);
SELECT pg_temp.expect_partner_outcome_mismatch(
  'paystack:issue-1174-atomic',
  '1174a000-0000-4000-8000-000000000030',
  '1174a000-0000-4000-8000-000000000010',
  '1174a000-0000-4000-8000-000000000002',
  '2026-07-25T01:00:00Z', 100000, 10000, 'usd', 'paystack'
);
SELECT pg_temp.expect_partner_outcome_mismatch(
  'paystack:issue-1174-atomic',
  '1174a000-0000-4000-8000-000000000030',
  '1174a000-0000-4000-8000-000000000010',
  '1174a000-0000-4000-8000-000000000002',
  '2026-07-25T01:00:00Z', 100000, 10000, 'ngn', 'stripe'
);

DO $$
DECLARE
  v_attributions integer;
  v_splits integer;
BEGIN
  SELECT count(*)::integer INTO v_attributions
  FROM public.payout_partner_attributions;
  SELECT count(*)::integer INTO v_splits
  FROM public.partner_splits;
  IF v_attributions <> 1 OR v_splits <> 1 THEN
    RAISE EXCEPTION
      'mismatch attempts mutated truth: attributions %, splits %',
      v_attributions,
      v_splits;
  END IF;
END;
$$;

-- no_partner is a complete immutable outcome: replay remains 1/0 and a later
-- partner claim fails closed.
SELECT public.record_payout_partner_outcome(
  'paystack:issue-1174-no-partner-atomic',
  '1174a000-0000-4000-8000-000000000032',
  '1174a000-0000-4000-8000-000000000010',
  NULL,
  '2026-07-25T02:00:00Z',
  100000,
  0,
  'ngn',
  'paystack'
);
SELECT public.record_payout_partner_outcome(
  'paystack:issue-1174-no-partner-atomic',
  '1174a000-0000-4000-8000-000000000032',
  '1174a000-0000-4000-8000-000000000010',
  NULL,
  '2026-07-25T02:00:00Z',
  100000,
  0,
  'NGN',
  'paystack'
);
SELECT pg_temp.expect_partner_outcome_mismatch(
  'paystack:issue-1174-no-partner-atomic',
  '1174a000-0000-4000-8000-000000000032',
  '1174a000-0000-4000-8000-000000000010',
  '1174a000-0000-4000-8000-000000000002',
  '2026-07-25T02:00:00Z', 100000, 10000, 'ngn', 'paystack'
);

DO $$
DECLARE
  v_attributions integer;
  v_splits integer;
BEGIN
  SELECT count(*)::integer INTO v_attributions
  FROM public.payout_partner_attributions
  WHERE order_id = '1174a000-0000-4000-8000-000000000032';
  SELECT count(*)::integer INTO v_splits
  FROM public.partner_splits
  WHERE order_id = '1174a000-0000-4000-8000-000000000032';
  IF v_attributions <> 1 OR v_splits <> 0 THEN
    RAISE EXCEPTION
      'no-partner replay changed shape: attributions %, splits %',
      v_attributions,
      v_splits;
  END IF;
END;
$$;

-- Force the held-split conflict path to reject mismatched canonical data.
-- The attribution inserted earlier in the same function statement must roll
-- back with that failure.
INSERT INTO public.partner_splits (
  order_id,
  brand_id,
  partner_account_id,
  mingla_fee_cents,
  partner_share_cents,
  transfer_currency,
  stripe_application_fee_id,
  status,
  provider
) VALUES (
  '1174a000-0000-4000-8000-000000000031',
  '1174a000-0000-4000-8000-000000000010',
  '1174a000-0000-4000-8000-000000000003',
  100000,
  10000,
  'ngn',
  'paystack:issue-1174-rollback',
  'held',
  'paystack'
);

DO $$
BEGIN
  BEGIN
    PERFORM public.record_payout_partner_outcome(
      'paystack:issue-1174-rollback',
      '1174a000-0000-4000-8000-000000000033',
      '1174a000-0000-4000-8000-000000000010',
      '1174a000-0000-4000-8000-000000000002',
      '2026-07-25T03:00:00Z',
      100000,
      10000,
      'ngn',
      'paystack'
    );
    RAISE EXCEPTION 'expected_held_split_replay_mismatch';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%held_split_replay_mismatch%' THEN
        RAISE;
      END IF;
  END;

  IF EXISTS (
    SELECT 1
    FROM public.payout_partner_attributions
    WHERE order_id = '1174a000-0000-4000-8000-000000000033'
  ) THEN
    RAISE EXCEPTION 'held failure did not roll back attribution';
  END IF;
END;
$$;

-- service_role may use only the canonical write boundary.
SET LOCAL ROLE service_role;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.payout_partner_attributions (
      order_id,
      brand_id,
      provider,
      provider_key,
      provider_sale_at,
      partner_account_id,
      outcome,
      mingla_fee_cents,
      partner_share_cents,
      currency
    ) VALUES (
      '1174a000-0000-4000-8000-000000000034',
      '1174a000-0000-4000-8000-000000000010',
      'paystack',
      'paystack:issue-1174-direct-insert',
      '2026-07-25T04:00:00Z',
      NULL,
      'no_partner',
      100000,
      0,
      'ngn'
    );
    RAISE EXCEPTION 'direct_attribution_insert_was_not_denied';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.record_payout_partner_attribution(
      'paystack:issue-1174-direct-rpc',
      '1174a000-0000-4000-8000-000000000034',
      '1174a000-0000-4000-8000-000000000010',
      NULL,
      '2026-07-25T04:00:00Z',
      100000,
      0,
      'ngn',
      'paystack'
    );
    RAISE EXCEPTION 'direct_attribution_rpc_was_not_denied';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.record_held_partner_split(
      'paystack:issue-1174-direct-held',
      '1174a000-0000-4000-8000-000000000034',
      '1174a000-0000-4000-8000-000000000010',
      '1174a000-0000-4000-8000-000000000002',
      100000,
      10000,
      'ngn',
      'paystack',
      '2026-07-25T04:00:00Z'
    );
    RAISE EXCEPTION 'direct_held_rpc_was_not_denied';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

SELECT public.record_payout_partner_outcome(
  'paystack:issue-1174-service-role',
  '1174a000-0000-4000-8000-000000000035',
  '1174a000-0000-4000-8000-000000000010',
  '1174a000-0000-4000-8000-000000000002',
  '2026-07-25T05:00:00Z',
  100000,
  10000,
  'ngn',
  'paystack'
);

RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.payout_partner_attributions a
    JOIN public.partner_splits ps
      ON ps.order_id = a.order_id
     AND ps.stripe_application_fee_id = a.provider_key
    WHERE a.order_id = '1174a000-0000-4000-8000-000000000035'
      AND a.outcome = 'partner'
      AND ps.status = 'held'
  ) THEN
    RAISE EXCEPTION 'canonical service-role RPC did not write both rows';
  END IF;
END;
$$;

ROLLBACK;
