-- #4490 spec 07 B (table deposit modes; 20281203304490): PostgreSQL 17 proof.
--
-- MINGLA-INVARIANT: I-4490-TABLE-HOLD-SERVER-TRUTH | issue #4490 | a table hold is computed from the table's one valid deposit mode by database helpers; joined tables take the maximum, never the sum, and an unpaid reservation cannot consume a table with a positive hold.
--
-- FAILS-ON-REVERT: changing the joined wrapper from max to sum makes T-4 fail;
-- restoring the writer's old hold_minor_per_guest gate makes T-7 fail for a
-- per-table hold; removing the legacy mapping makes T-6 fail.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION public.t4490b_ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'T4490B FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$f$;

CREATE FUNCTION public.t4490b_expect(p_sql text, p_state text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state OR (p_message IS NOT NULL AND SQLERRM <> p_message) THEN
      RAISE EXCEPTION 'T4490B FAIL: % (expected % %, got % %)',
        p_label, p_state, p_message, SQLSTATE, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  %', p_label;
    RETURN;
  END;
  RAISE EXCEPTION 'T4490B FAIL: % (expected % %, no error)',
    p_label, p_state, p_message;
END
$f$;

CREATE FUNCTION public.t4490b_as(p_user uuid)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END
$f$;

CREATE FUNCTION public.t4490b_reset()
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END
$f$;

GRANT EXECUTE ON FUNCTION
  public.t4490b_ok(boolean, text),
  public.t4490b_expect(text, text, text, text),
  public.t4490b_as(uuid),
  public.t4490b_reset()
TO PUBLIC;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES (
  '44903100-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'table-deposits-4490@example.test', now(), now()
);
INSERT INTO public.creator_accounts (id, created_at)
VALUES ('44903100-0000-4000-8000-000000000001', now());
INSERT INTO public.brands (
  id, account_id, name, slug, default_currency, payment_provider,
  payout_hold_cutover_at, created_at, updated_at
) VALUES (
  '44903100-0000-4000-9000-000000000010',
  '44903100-0000-4000-8000-000000000001',
  'Table Deposits 4490', 'table-deposits-4490', 'NGN', 'paystack',
  now() - interval '1 day', now(), now()
);
INSERT INTO public.venue_listings (
  id, brand_id, slug, name, lat, lng, venue_category, claim_status, country_code
) VALUES (
  '44903100-0000-4000-9000-0000000000a1',
  '44903100-0000-4000-9000-000000000010',
  'tabledeposits4490', 'Table Deposits', 6.45, 3.40,
  'restaurant', 'verified', 'NG'
);
INSERT INTO public.venue_availability_config (
  brand_id, venue_id, iana_timezone, service_periods, turn_times,
  slot_granularity_minutes, advance_window_days
) VALUES (
  '44903100-0000-4000-9000-000000000010',
  '44903100-0000-4000-9000-0000000000a1',
  'Africa/Lagos',
  '[{"start":"12:00","end":"23:00","days":[0,1,2,3,4,5,6]}]'::jsonb,
  '{"p1":90}'::jsonb, 30, 30
);
INSERT INTO public.venue_reservation_settings (brand_id, venue_id, reservations_enabled)
VALUES (
  '44903100-0000-4000-9000-000000000010',
  '44903100-0000-4000-9000-0000000000a1', true
);

CREATE TEMP TABLE t4490b_ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
GRANT ALL ON t4490b_ids TO PUBLIC;
CREATE FUNCTION public.t4490b_id(p_k text)
RETURNS uuid LANGUAGE sql AS $f$ SELECT v FROM t4490b_ids WHERE k = p_k $f$;
CREATE FUNCTION public.t4490b_day()
RETURNS date LANGUAGE sql AS $f$
  SELECT (now() AT TIME ZONE 'Africa/Lagos')::date + 3
$f$;
CREATE FUNCTION public.t4490b_at(p_hhmm text)
RETURNS timestamptz LANGUAGE sql AS $f$
  SELECT (public.t4490b_day() + p_hhmm::time) AT TIME ZONE 'Africa/Lagos'
$f$;
GRANT EXECUTE ON FUNCTION public.t4490b_id(text), public.t4490b_day(), public.t4490b_at(text) TO PUBLIC;

SELECT public.t4490b_as('44903100-0000-4000-8000-000000000001');
DO $setup$
DECLARE
  v_venue constant uuid := '44903100-0000-4000-9000-0000000000a1';
  v jsonb;
BEGIN
  v := public.issue_4490_manage_space(
    'create', v_venue,
    '{"name":"Dining room","setting":"indoor","capacity_seated":60}'::jsonb,
    NULL
  );
  INSERT INTO t4490b_ids VALUES ('space', (v->>'id')::uuid);
  PERFORM public.issue_4490_set_venue_feature(
    v_venue, 'pick_a_table', true, NULL, NULL, NULL, '4490b-pick-table', true
  );
  PERFORM public.issue_4490_set_venue_feature(
    v_venue, 'min_spend_tables', true, NULL, NULL, NULL, '4490b-min-spend'
  );
END
$setup$;

-- T-1: post-migration schema and the legacy-row backfill postcondition.
DO $t1$
BEGIN
  PERFORM public.t4490b_ok(
    EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.venue_tables'::regclass
        AND conname = 'venue_tables_deposit_shape'
    ),
    'T-1a one deposit-shape constraint is installed'
  );
  PERFORM public.t4490b_ok(
    NOT EXISTS (
      SELECT 1 FROM public.venue_tables
      WHERE deposit_minor_per_guest = 0
         OR (deposit_minor_per_guest > 0 AND deposit_mode <> 'per_guest')
    ),
    'T-1b legacy zero holds are null and positive holds are per_guest'
  );
END
$t1$;

-- T-2: create all four modes through the only Host writer.
DO $t2$
DECLARE
  v_venue constant uuid := '44903100-0000-4000-9000-0000000000a1';
  v jsonb;
BEGIN
  v := public.issue_4490_manage_table('create', v_venue, jsonb_build_object(
    'name', 'Usual', 'capacity', 4, 'spaceId', public.t4490b_id('space'),
    'combinable', true, 'depositMode', 'venue_rule'
  ), '4490b-usual');
  INSERT INTO t4490b_ids VALUES ('usual', (v->>'id')::uuid);

  v := public.issue_4490_manage_table('create', v_venue, jsonb_build_object(
    'name', 'Per guest', 'capacity', 4, 'spaceId', public.t4490b_id('space'),
    'combinable', true, 'depositMode', 'per_guest', 'depositPerGuestMinor', 500
  ), '4490b-per-guest');
  INSERT INTO t4490b_ids VALUES ('per_guest', (v->>'id')::uuid);

  v := public.issue_4490_manage_table('create', v_venue, jsonb_build_object(
    'name', 'Per table', 'capacity', 4, 'spaceId', public.t4490b_id('space'),
    'combinable', true, 'depositMode', 'per_table', 'depositFlatMinor', 1600
  ), '4490b-per-table');
  INSERT INTO t4490b_ids VALUES ('per_table', (v->>'id')::uuid);

  v := public.issue_4490_manage_table('create', v_venue, jsonb_build_object(
    'name', 'Share round down', 'capacity', 4, 'spaceId', public.t4490b_id('space'),
    'combinable', true, 'minSpendMinor', 1001,
    'depositMode', 'min_spend_share', 'depositShareBps', 2500
  ), '4490b-share-down');
  INSERT INTO t4490b_ids VALUES ('share_down', (v->>'id')::uuid);

  v := public.issue_4490_manage_table('create', v_venue, jsonb_build_object(
    'name', 'Share round up', 'capacity', 4, 'spaceId', public.t4490b_id('space'),
    'combinable', true, 'minSpendMinor', 1002,
    'depositMode', 'min_spend_share', 'depositShareBps', 2500
  ), '4490b-share-up');
  INSERT INTO t4490b_ids VALUES ('share_up', (v->>'id')::uuid);

  PERFORM public.t4490b_ok(
    v->>'depositMode' = 'min_spend_share'
      AND (v->>'depositShareBps')::integer = 2500
      AND v->'depositPerGuestMinor' = 'null'::jsonb
      AND v->'depositFlatMinor' = 'null'::jsonb,
    'T-2 projection returns the selected mode and only its amount'
  );
END
$t2$;

-- T-3: exact arithmetic, including integer round-half-up.
DO $t3$
BEGIN
  PERFORM public.t4490b_ok(
    public.issue_4490_table_hold_minor(public.t4490b_id('usual'), 4) IS NULL,
    'T-3a usual rule has no table-specific hold'
  );
  PERFORM public.t4490b_ok(
    public.issue_4490_table_hold_minor(public.t4490b_id('per_guest'), 4) = 2000,
    'T-3b per guest multiplies by the party'
  );
  PERFORM public.t4490b_ok(
    public.issue_4490_table_hold_minor(public.t4490b_id('per_table'), 4) = 1600,
    'T-3c per table stays flat'
  );
  PERFORM public.t4490b_ok(
    public.issue_4490_table_hold_minor(public.t4490b_id('share_down'), 4) = 250
      AND public.issue_4490_table_hold_minor(public.t4490b_id('share_up'), 4) = 251,
    'T-3d minimum-spend shares round half up to one minor unit'
  );
END
$t3$;

-- T-4: joined tables take max, not sum; mixed modes never pretend per-guest.
SELECT public.t4490b_reset();
DO $t4$
DECLARE
  v_terms jsonb;
BEGIN
  PERFORM public.t4490b_ok(
    public.issue_4490_table_hold_minor_for(
      ARRAY[public.t4490b_id('per_guest'), public.t4490b_id('per_table')], 4
    ) = 2000,
    'T-4a a joined pair takes the larger hold, never the sum'
  );
  v_terms := public.issue_4490_table_pick_terms(
    '44903100-0000-4000-9000-0000000000a1',
    ARRAY[public.t4490b_id('per_guest'), public.t4490b_id('per_table')], 4
  );
  PERFORM public.t4490b_ok(
    (v_terms->>'holdMinor')::bigint = 2000
      AND v_terms->'holdPerGuestMinor' = 'null'::jsonb
      AND v_terms->>'holdBasis' = 'per_guest',
    'T-4b mixed modes return the total and its winning basis, not a false per-guest rate'
  );
END
$t4$;

-- T-5: dependencies are explicit and the feature cannot strand share tables.
SELECT public.t4490b_as('44903100-0000-4000-8000-000000000001');
SELECT public.t4490b_expect(
  format(
    $q$SELECT public.issue_4490_manage_table('create', %L, jsonb_build_object(
      'name','Broken share','capacity',4,'spaceId',%L,
      'depositMode','min_spend_share','depositShareBps',2500
    ), '4490b-share-no-min')$q$,
    '44903100-0000-4000-9000-0000000000a1', public.t4490b_id('space')
  ),
  '22023', 'table_deposit_needs_min_spend',
  'T-5a share mode needs a minimum spend'
);
SELECT public.t4490b_expect(
  format(
    $q$SELECT public.issue_4490_manage_table('update', %L, jsonb_build_object(
      'tableId',%L,'minSpendMinor',0
    ), '4490b-clear-share-min')$q$,
    '44903100-0000-4000-9000-0000000000a1', public.t4490b_id('share_down')
  ),
  'P0001', 'table_deposit_uses_min_spend:1',
  'T-5b clearing a minimum spend in use is refused'
);
SELECT public.t4490b_expect(
  $q$SELECT public.issue_4490_set_venue_feature(
    '44903100-0000-4000-9000-0000000000a1', 'min_spend_tables', false,
    NULL, NULL, NULL, '4490b-min-spend-off'
  )$q$,
  'P0001', 'table_deposit_uses_min_spend:2',
  'T-5c Minimum-spend tables cannot be switched off while two tables use shares'
);

-- A different writer can still switch the feature off; the charge helper then
-- returns NULL, so the table safely falls back to the venue's usual rule.
SELECT public.t4490b_reset();
UPDATE public.venue_features
SET enabled = false
WHERE venue_id = '44903100-0000-4000-9000-0000000000a1'
  AND feature_key = 'min_spend_tables';
SELECT public.t4490b_ok(
  public.issue_4490_table_hold_minor(public.t4490b_id('share_up'), 4) IS NULL,
  'T-5d a non-RPC feature-off write makes share holds fall back to the usual rule'
);
UPDATE public.venue_features
SET enabled = true
WHERE venue_id = '44903100-0000-4000-9000-0000000000a1'
  AND feature_key = 'min_spend_tables';

-- T-6: installed clients that send only depositPerGuestMinor retain behavior.
SELECT public.t4490b_as('44903100-0000-4000-8000-000000000001');
DO $t6$
DECLARE
  v jsonb;
  v_id uuid;
BEGIN
  v := public.issue_4490_manage_table(
    'create', '44903100-0000-4000-9000-0000000000a1',
    jsonb_build_object(
      'name', 'Legacy app', 'capacity', 4, 'spaceId', public.t4490b_id('space'),
      'depositPerGuestMinor', 700
    ), '4490b-legacy-create'
  );
  v_id := (v->>'id')::uuid;
  PERFORM public.t4490b_ok(
    v->>'depositMode' = 'per_guest' AND (v->>'depositPerGuestMinor')::bigint = 700,
    'T-6a a legacy positive amount maps to per_guest'
  );
  v := public.issue_4490_manage_table(
    'update', '44903100-0000-4000-9000-0000000000a1',
    jsonb_build_object('tableId', v_id, 'depositPerGuestMinor', NULL),
    '4490b-legacy-clear'
  );
  PERFORM public.t4490b_ok(
    v->>'depositMode' = 'venue_rule'
      AND v->'depositPerGuestMinor' = 'null'::jsonb,
    'T-6b a legacy clear maps back to the venue rule'
  );
END
$t6$;

-- T-7: payment enforcement reads the total hold, not the old per-guest field.
SELECT public.t4490b_reset();
SELECT public.t4490b_expect(
  format(
    $q$SELECT public.pg_create_guest_reservation(
      %L, public.t4490b_at('18:00'), 2, 'website', 'guest', NULL,
      'Unpaid guest', NULL, 'unpaid-4490@example.test', NULL, 'NGN', NULL,
      'none', NULL, NULL, NULL, 'confirmed', NULL, ARRAY[%L]::uuid[], NULL
    )$q$,
    '44903100-0000-4000-9000-0000000000a1', public.t4490b_id('per_table')
  ),
  'P0001', 'deposit_required',
  'T-7a an unpaid per-table hold cannot consume availability'
);
DO $t7$
DECLARE
  v_res public.reservations;
BEGIN
  v_res := public.pg_create_guest_reservation(
    '44903100-0000-4000-9000-0000000000a1', public.t4490b_at('19:00'), 2,
    'website', 'guest', NULL, 'Usual guest', NULL, 'usual-4490@example.test',
    NULL, 'NGN', NULL, 'none', NULL, NULL, NULL, 'confirmed', NULL,
    ARRAY[public.t4490b_id('usual')], NULL
  );
  PERFORM public.t4490b_ok(
    v_res.table_id = public.t4490b_id('usual') AND v_res.payment_status = 'none',
    'T-7b the usual table rule remains free when the venue has no deposit rule'
  );
END
$t7$;

-- T-8: impossible mixed shapes and ACL drift are refused.
SELECT public.t4490b_reset();
SELECT public.t4490b_expect(
  format(
    $q$UPDATE public.venue_tables SET deposit_mode='per_table', deposit_flat_minor=100,
      deposit_minor_per_guest=50 WHERE id=%L$q$,
    public.t4490b_id('per_table')
  ),
  '23514', NULL,
  'T-8a a table cannot hold two deposit amounts at once'
);
SELECT public.t4490b_ok(
  has_function_privilege(
    'authenticated', 'public.issue_4490_table_hold_minor(uuid,integer)', 'EXECUTE'
  )
    AND has_function_privilege(
      'service_role', 'public.issue_4490_table_hold_minor_for(uuid[],integer)', 'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon', 'public.issue_4490_table_hold_minor(uuid,integer)', 'EXECUTE'
    ),
  'T-8b hold helpers keep the specified authenticated/service ACL'
);

ROLLBACK;
