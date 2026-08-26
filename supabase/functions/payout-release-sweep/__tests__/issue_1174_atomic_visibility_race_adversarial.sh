#!/usr/bin/env bash
set -euo pipefail

# Tester-owned adversarial guard for #1174.
#
# A test-only AFTER INSERT trigger pauses the canonical provider-sale outcome
# after its attribution row is inserted but before the function can insert the
# held split (or return a no_partner result). A second PostgreSQL session runs
# the real planner while the first statement is paused. READ COMMITTED must
# expose neither uncommitted row, and the edge-order simulation must perform
# zero organiser mutations until the atomic statement commits.

# [TEST-MOD-APPROVED #2591] — parameterise the database, and make the parameter
# not reaching this process DETECTABLE rather than silent.
#
# #2591 gives every contract suite its own database, copied from the migrated
# template with CREATE DATABASE ... TEMPLATE. This driver has to be told which
# one, so $2 is the database name.
#
# $2 defaults to "postgres" so every existing call site keeps working unchanged.
# That default is also the entire risk of this change, and it is a risk this file
# did not previously have: a caller that forgets the second argument runs THIS
# driver -- the one file of the twenty-three that commits durable, un-cleaned
# fixture rows and creates a TRIGGER on public.payout_partner_attributions --
# straight into the template that every other suite was copied from. Nothing
# would fail. Every assertion in this file would still pass, because they are all
# self-consistent within whatever database they are handed. The isolation the
# whole #2591 design rests on would be gone, green, and invisible. That is the
# same shape as the pg_dump restore that went green with 643 RLS policies
# collapsed to 2.
#
# So the default does not ship alone. The guard below asks the cluster itself
# whether per-suite databases exist, and refuses to run in the template when they
# do. It needs no new environment variable and no new flag to enable -- a switch
# that must be turned on is a switch nobody turns on (this repo has produced that
# defect three times). It self-configures:
#
#   * legacy cluster, no suite_* databases  -> nothing to be isolated from, passes
#     exactly as today;
#   * consolidated cluster, $2 supplied     -> running in suite_1174, passes;
#   * consolidated cluster, $2 FORGOTTEN    -> suite_* databases exist and this
#     session is in "postgres", RED with the database named.
#
# Clause A alone is not enough, and the second clause is the point of this guard.
# A database can carry the RIGHT NAME and the WRONG CONTENTS: `suite_1174` built
# from `template0` instead of from the migrated template passes every name check
# ever written while holding zero tables, zero policies and zero triggers. That
# is not hypothetical -- it is the shape a `pg_dump` restore produced in this repo
# while tables and columns matched and 643 RLS policies had collapsed to 2, exit
# code 0 throughout. So clause B asserts the SECURITY POSTURE of the specific
# tables this suite is about to mutate: they exist, ROW LEVEL SECURITY is on, and
# the objects that enforce append-only and per-brand isolation are present.
# Counting tables and columns is explicitly insufficient; that is the check that
# passed the disaster.
container_name="${1:-issue1174-postgres}"
database_name="${2:-postgres}"
psql_cmd=(docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$database_name")

"${psql_cmd[@]}" <<'SQL'
DO $issue_2591_isolation$
DECLARE
  v_suite_databases integer;
  v_broken text;
BEGIN
  -- Clause A — PLACEMENT. If this cluster has per-suite contract databases at
  -- all, then the #2591 design is in force and this session must be inside one
  -- of them. Self-configuring: a legacy cluster has none, so this is inert there
  -- and the file behaves exactly as it did before #2591.
  SELECT count(*) INTO v_suite_databases
  FROM pg_database
  WHERE datname LIKE 'suite\_%';

  IF v_suite_databases > 0 AND current_database() NOT LIKE 'suite\_%' THEN
    RAISE EXCEPTION
      '#2591 SUITE ISOLATION FAIL: % per-suite contract databases exist in this cluster, but this driver is executing in "%" — the migrated template every suite was copied from. The database argument did not reach this process, so this suite is about to commit durable fixtures and a trigger into the template.',
      v_suite_databases, current_database();
  END IF;

  -- Clause B — FIDELITY. The right name is not the right database.
  SELECT string_agg(probe.what, '; ' ORDER BY probe.what) INTO v_broken
  FROM (
    SELECT 'public.payout_partner_attributions is missing' AS what
     WHERE to_regclass('public.payout_partner_attributions') IS NULL
    UNION ALL
    SELECT 'public.partner_splits is missing'
     WHERE to_regclass('public.partner_splits') IS NULL
    UNION ALL
    SELECT 'public.payout_partner_attributions has ROW LEVEL SECURITY disabled'
     WHERE NOT COALESCE((SELECT c.relrowsecurity FROM pg_class c
       WHERE c.oid = to_regclass('public.payout_partner_attributions')), false)
    UNION ALL
    SELECT 'public.partner_splits has ROW LEVEL SECURITY disabled'
     WHERE NOT COALESCE((SELECT c.relrowsecurity FROM pg_class c
       WHERE c.oid = to_regclass('public.partner_splits')), false)
    UNION ALL
    SELECT 'public.payout_partner_attributions has lost its append-only trigger'
     WHERE NOT EXISTS (SELECT 1 FROM pg_trigger t
       WHERE t.tgrelid = to_regclass('public.payout_partner_attributions')
         AND NOT t.tgisinternal)
    UNION ALL
    SELECT 'public.partner_splits carries no RLS policy'
     WHERE NOT EXISTS (SELECT 1 FROM pg_policy p
       WHERE p.polrelid = to_regclass('public.partner_splits'))
  ) AS probe;

  IF v_broken IS NOT NULL THEN
    RAISE EXCEPTION
      '#2591 SUITE FIDELITY FAIL: database "%" is not a faithful copy of the migrated template — %. Tables and columns matching is NOT sufficient evidence: a pg_dump restore passed that check with 643 RLS policies collapsed to 2.',
      current_database(), v_broken;
  END IF;
END
$issue_2591_isolation$;
SQL

"${psql_cmd[@]}" <<'SQL'
INSERT INTO auth.users (id) VALUES
  ('1174b000-0000-4000-8000-000000000001'),
  ('1174b000-0000-4000-8000-000000000002');

INSERT INTO public.creator_accounts (id, email, partner_enabled) VALUES
  (
    '1174b000-0000-4000-8000-000000000001',
    'issue-1174-race-owner@example.test',
    false
  ),
  (
    '1174b000-0000-4000-8000-000000000002',
    'issue-1174-race-partner@example.test',
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
) VALUES (
  '1174b000-0000-4000-8000-000000000010',
  '1174b000-0000-4000-8000-000000000001',
  'Issue 1174 Atomic Visibility Brand',
  'issue-1174-atomic-visibility-brand',
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
) VALUES (
  '1174b000-0000-4000-8000-000000000020',
  '1174b000-0000-4000-8000-000000000010',
  'Issue 1174 Atomic Visibility Event',
  'issue-1174-atomic-visibility-event',
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
    '1174b000-0000-4000-8000-000000000031',
    '1174b000-0000-4000-8000-000000000020',
    1000000,
    'NGN',
    'paid',
    100000,
    '+15555551171',
    '2026-07-25T00:01:00Z'
  ),
  (
    '1174b000-0000-4000-8000-000000000032',
    '1174b000-0000-4000-8000-000000000020',
    1000000,
    'NGN',
    'paid',
    100000,
    '+15555551172',
    '2026-07-25T00:02:00Z'
  ),
  (
    '1174b000-0000-4000-8000-000000000033',
    '1174b000-0000-4000-8000-000000000020',
    1000000,
    'NGN',
    'paid',
    100000,
    '+15555551173',
    '2026-07-25T00:03:00Z'
  );

INSERT INTO public.brand_payout_releases (
  id,
  brand_id,
  event_id,
  occurrence_key,
  surface,
  provider,
  currency,
  anchor_end_at,
  releasable_at,
  gross_cents,
  mingla_fee_cents,
  partner_share_cents,
  provider_fee_cents,
  net_release_cents,
  status
) VALUES
  (
    '1174b000-0000-4000-8000-000000000041',
    '1174b000-0000-4000-8000-000000000010',
    '1174b000-0000-4000-8000-000000000020',
    'issue-1174-stripe-race',
    'order',
    'stripe',
    'ngn',
    '2026-07-20T00:00:00Z',
    '2026-07-23T00:00:00Z',
    1000000,
    100000,
    0,
    10000,
    890000,
    'pending'
  ),
  (
    '1174b000-0000-4000-8000-000000000042',
    '1174b000-0000-4000-8000-000000000010',
    '1174b000-0000-4000-8000-000000000020',
    'issue-1174-paystack-race',
    'order',
    'paystack',
    'ngn',
    '2026-07-20T00:00:00Z',
    '2026-07-23T00:00:00Z',
    1000000,
    100000,
    0,
    10000,
    890000,
    'pending'
  ),
  (
    '1174b000-0000-4000-8000-000000000043',
    '1174b000-0000-4000-8000-000000000010',
    '1174b000-0000-4000-8000-000000000020',
    'issue-1174-no-partner-race',
    'order',
    'paystack',
    'ngn',
    '2026-07-20T00:00:00Z',
    '2026-07-23T00:00:00Z',
    1000000,
    100000,
    0,
    10000,
    890000,
    'pending'
  );

INSERT INTO public.payout_release_items (
  release_id,
  source_type,
  source_id,
  gross_cents,
  mingla_fee_cents,
  partner_share_cents,
  provider_fee_cents,
  net_cents,
  source_finalized_at
) VALUES
  (
    '1174b000-0000-4000-8000-000000000041',
    'order',
    '1174b000-0000-4000-8000-000000000031',
    1000000,
    100000,
    0,
    10000,
    890000,
    '2026-07-25T00:01:00Z'
  ),
  (
    '1174b000-0000-4000-8000-000000000042',
    'order',
    '1174b000-0000-4000-8000-000000000032',
    1000000,
    100000,
    0,
    10000,
    890000,
    '2026-07-25T00:02:00Z'
  ),
  (
    '1174b000-0000-4000-8000-000000000043',
    'order',
    '1174b000-0000-4000-8000-000000000033',
    1000000,
    100000,
    0,
    10000,
    890000,
    '2026-07-25T00:03:00Z'
  );

CREATE OR REPLACE FUNCTION public.issue_1174_test_pause_atomic_outcome()
RETURNS trigger
LANGUAGE plpgsql
AS $test$
BEGIN
  IF NEW.provider_key LIKE 'race-1174:%' THEN
    PERFORM pg_advisory_xact_lock(
      CASE NEW.provider
        WHEN 'stripe' THEN 117401
        WHEN 'paystack' THEN
          CASE WHEN NEW.outcome = 'partner' THEN 117402 ELSE 117403 END
      END
    );
  END IF;
  RETURN NEW;
END;
$test$;

CREATE TRIGGER issue_1174_test_pause_atomic_outcome
  AFTER INSERT ON public.payout_partner_attributions
  FOR EACH ROW EXECUTE FUNCTION public.issue_1174_test_pause_atomic_outcome();
SQL

run_race() {
  local provider="$1"
  local outcome="$2"
  local lock_id="$3"
  local order_id="$4"
  local release_id="$5"
  local app_name="$6"
  local provider_key="$7"
  local sale_at="$8"
  local partner_id="NULL"
  local partner_share="0"

  if [[ "$outcome" == "partner" ]]; then
    partner_id="'1174b000-0000-4000-8000-000000000002'"
    partner_share="10000"
  fi

  local observer_sql
  local caller_sql
  observer_sql="$(mktemp)"
  caller_sql="$(mktemp)"
  trap 'rm -f "$observer_sql" "$caller_sql"' RETURN

  {
    printf '%s\n' '\set ON_ERROR_STOP on'
    printf '%s\n' 'BEGIN;'
    printf 'SELECT pg_advisory_lock(%s);\n' "$lock_id"
    printf '%s\n' 'SELECT pg_sleep(2);'
    cat <<SQL
DO \$test\$
DECLARE
  v_plan jsonb;
  v_claimed integer := 0;
  v_release public.brand_payout_releases%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_stat_activity
    WHERE application_name = '$app_name'
      AND wait_event_type = 'Lock'
      AND wait_event = 'advisory'
  ) THEN
    RAISE EXCEPTION 'atomic caller was not paused inside attribution insert';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payout_partner_attributions
    WHERE order_id = '$order_id'
  ) OR EXISTS (
    SELECT 1 FROM public.partner_splits
    WHERE order_id = '$order_id'
  ) THEN
    RAISE EXCEPTION
      'uncommitted atomic outcome leaked to concurrent planner';
  END IF;

  v_plan := public.plan_pending_payout_partner_legs(100);
  IF (v_plan->>'blocked_partner_attributions')::integer < 1 THEN
    RAISE EXCEPTION
      'planner did not fail closed on uncommitted outcome: %',
      v_plan;
  END IF;

  -- This mirrors the integrated edge order: a blocked plan never invokes C's
  -- organiser claim. The count must therefore remain zero.
  IF (v_plan->>'blocked_partner_attributions')::integer = 0 THEN
    SELECT count(*)::integer INTO v_claimed
    FROM public.claim_stripe_payout_releases(
      20,
      '2026-07-26T00:00:00Z'
    );
  END IF;
  IF v_claimed <> 0 THEN
    RAISE EXCEPTION 'organiser claim executed while outcome was uncommitted';
  END IF;

  SELECT * INTO STRICT v_release
  FROM public.brand_payout_releases
  WHERE id = '$release_id';
  IF v_release.status <> 'pending'
     OR v_release.attempt_count <> 0
     OR v_release.stripe_execution_claim_id IS NOT NULL
     OR v_release.stripe_payout_id IS NOT NULL
     OR v_release.organiser_cash_delivered_cents <> 0 THEN
    RAISE EXCEPTION
      'organiser release mutated before atomic outcome commit: %',
      row_to_json(v_release);
  END IF;
END;
\$test\$;
SELECT pg_advisory_unlock($lock_id);
COMMIT;
SQL
  } > "$observer_sql"

  cat > "$caller_sql" <<SQL
\set ON_ERROR_STOP on
SET application_name = '$app_name';
SELECT public.record_payout_partner_outcome(
  '$provider_key',
  '$order_id',
  '1174b000-0000-4000-8000-000000000010',
  $partner_id,
  '$sale_at',
  100000,
  $partner_share,
  'ngn',
  '$provider'
);
SQL

  "${psql_cmd[@]}" < "$observer_sql" > "${observer_sql}.out" 2>&1 &
  local observer_pid=$!
  sleep 0.5
  "${psql_cmd[@]}" < "$caller_sql" > "${caller_sql}.out" 2>&1 &
  local caller_pid=$!

  local observer_status=0
  local caller_status=0
  wait "$observer_pid" || observer_status=$?
  wait "$caller_pid" || caller_status=$?
  if (( observer_status != 0 || caller_status != 0 )); then
    cat "${observer_sql}.out" "${caller_sql}.out"
    return 1
  fi
  rm -f "${observer_sql}.out" "${caller_sql}.out"
}

run_race \
  stripe partner 117401 \
  1174b000-0000-4000-8000-000000000031 \
  1174b000-0000-4000-8000-000000000041 \
  issue1174-stripe-atomic-caller \
  race-1174:stripe:ch_atomic \
  2026-07-25T01:01:00Z

run_race \
  paystack partner 117402 \
  1174b000-0000-4000-8000-000000000032 \
  1174b000-0000-4000-8000-000000000042 \
  issue1174-paystack-atomic-caller \
  race-1174:paystack:paid-atomic \
  2026-07-25T01:02:00Z

run_race \
  paystack no_partner 117403 \
  1174b000-0000-4000-8000-000000000033 \
  1174b000-0000-4000-8000-000000000043 \
  issue1174-no-partner-atomic-caller \
  race-1174:paystack:no-partner-atomic \
  2026-07-25T01:03:00Z

"${psql_cmd[@]}" <<'SQL'
DROP TRIGGER issue_1174_test_pause_atomic_outcome
  ON public.payout_partner_attributions;
DROP FUNCTION public.issue_1174_test_pause_atomic_outcome();

SELECT public.plan_pending_payout_partner_legs(100);
SELECT public.plan_pending_payout_partner_legs(100);

DO $test$
DECLARE
  v_stripe public.brand_payout_releases%ROWTYPE;
  v_paystack public.brand_payout_releases%ROWTYPE;
  v_no_partner public.brand_payout_releases%ROWTYPE;
  v_count integer;
BEGIN
  SELECT * INTO STRICT v_stripe
  FROM public.brand_payout_releases
  WHERE id = '1174b000-0000-4000-8000-000000000041';
  SELECT * INTO STRICT v_paystack
  FROM public.brand_payout_releases
  WHERE id = '1174b000-0000-4000-8000-000000000042';
  SELECT * INTO STRICT v_no_partner
  FROM public.brand_payout_releases
  WHERE id = '1174b000-0000-4000-8000-000000000043';

  IF v_stripe.partner_share_cents <> 10000
     OR v_stripe.net_release_cents <> 880000 THEN
    RAISE EXCEPTION
      'Stripe committed outcome has wrong release math: share %, cash %',
      v_stripe.partner_share_cents,
      v_stripe.net_release_cents;
  END IF;

  -- Exact approved NG fixture:
  -- ₦10,000 gross - ₦1,000 Mingla fee - ₦100 partner principal
  -- - ₦100 processing fee - ₦10 partner movement fee = ₦8,790.
  IF v_paystack.partner_share_cents <> 10000
     OR v_paystack.net_release_cents <> 879000 THEN
    RAISE EXCEPTION
      'Paystack committed outcome expected 879000: share %, cash %',
      v_paystack.partner_share_cents,
      v_paystack.net_release_cents;
  END IF;

  IF v_no_partner.partner_share_cents <> 0
     OR v_no_partner.net_release_cents <> 890000 THEN
    RAISE EXCEPTION
      'no_partner created phantom deduction: share %, cash %',
      v_no_partner.partner_share_cents,
      v_no_partner.net_release_cents;
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.payout_ledger_adjustments
  WHERE release_id IN (
    '1174b000-0000-4000-8000-000000000041',
    '1174b000-0000-4000-8000-000000000042'
  )
    AND kind = 'partner_principal_correction';
  IF v_count <> 2 THEN
    RAISE EXCEPTION
      'partner corrections not exactly once across both rails: %',
      v_count;
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.payout_transfer_legs
  WHERE release_id IN (
    '1174b000-0000-4000-8000-000000000041',
    '1174b000-0000-4000-8000-000000000042'
  )
    AND kind = 'partner';
  IF v_count <> 2 THEN
    RAISE EXCEPTION
      'partner legs not exactly once across both rails: %',
      v_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payout_ledger_adjustments
    WHERE release_id = '1174b000-0000-4000-8000-000000000043'
      AND kind = 'partner_principal_correction'
  ) OR EXISTS (
    SELECT 1
    FROM public.payout_transfer_legs
    WHERE release_id = '1174b000-0000-4000-8000-000000000043'
      AND kind = 'partner'
  ) THEN
    RAISE EXCEPTION 'no_partner gained a correction or transfer leg';
  END IF;
END;
$test$;

-- Organiser release truth unlocks each held split once. Marking the returned
-- split transferred makes a repeated dispatch claim empty.
UPDATE public.brand_payout_releases
SET status = 'released',
    released_at = now()
WHERE id IN (
  '1174b000-0000-4000-8000-000000000041',
  '1174b000-0000-4000-8000-000000000042'
);

CREATE TEMP TABLE issue_1174_first_dispatch AS
SELECT *
FROM public.release_partner_splits_for_organiser_release(
  '1174b000-0000-4000-8000-000000000041'
)
UNION ALL
SELECT *
FROM public.release_partner_splits_for_organiser_release(
  '1174b000-0000-4000-8000-000000000042'
);

DO $test$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*)::integer INTO v_count
  FROM issue_1174_first_dispatch;
  IF v_count <> 2 THEN
    RAISE EXCEPTION
      'committed organiser releases did not permit one dispatch each: %',
      v_count;
  END IF;
END;
$test$;

UPDATE public.partner_splits
SET status = 'transferred',
    stripe_transfer_id = 'tester-accepted'
WHERE order_id IN (
  '1174b000-0000-4000-8000-000000000031',
  '1174b000-0000-4000-8000-000000000032'
);

DO $test$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*)::integer INTO v_count
  FROM (
    SELECT *
    FROM public.release_partner_splits_for_organiser_release(
      '1174b000-0000-4000-8000-000000000041'
    )
    UNION ALL
    SELECT *
    FROM public.release_partner_splits_for_organiser_release(
      '1174b000-0000-4000-8000-000000000042'
    )
  ) replay;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'completed partner dispatch replayed: %', v_count;
  END IF;
END;
$test$;
SQL

printf '%s\n' \
  'PASS: atomic outcome stayed invisible in-flight on Stripe, Paystack, and no_partner; post-commit accounting and dispatch were exact.'
