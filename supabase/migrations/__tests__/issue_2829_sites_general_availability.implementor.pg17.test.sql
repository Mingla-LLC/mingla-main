-- #2829 Sites general availability (PostgreSQL 17).
-- Proves current-brand backfill, future-brand defaults, restore behavior,
-- explicit-revoke precedence, audit evidence, and replay idempotency.

\set ON_ERROR_STOP on

CREATE TEMP TABLE i2829_ga_fixture(
  owner_id uuid NOT NULL,
  backfill_brand_id uuid NOT NULL,
  future_brand_id uuid NOT NULL,
  restored_brand_id uuid NOT NULL,
  revoked_brand_id uuid NOT NULL
) ON COMMIT PRESERVE ROWS;

BEGIN;
INSERT INTO i2829_ga_fixture VALUES (
  '28290000-0000-4000-8000-000000000201',
  '28290000-0000-4000-8100-000000000201',
  '28290000-0000-4000-8100-000000000202',
  '28290000-0000-4000-8100-000000000203',
  '28290000-0000-4000-8100-000000000204'
);
INSERT INTO auth.users(id, email)
SELECT owner_id, 'sites-ga-2829@example.test' FROM i2829_ga_fixture;
INSERT INTO public.creator_accounts(id, email)
SELECT owner_id, 'sites-ga-2829@example.test' FROM i2829_ga_fixture;

-- Simulate a current brand that existed before the rollout migration.
SET LOCAL session_replication_role = replica;
INSERT INTO public.brands(id, account_id, name, slug)
SELECT backfill_brand_id, owner_id, 'Sites GA Backfill', 'sites-ga-backfill'
FROM i2829_ga_fixture;
SET LOCAL session_replication_role = origin;
COMMIT;

DO $before$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.brand_site_entitlements entitlement
    JOIN i2829_ga_fixture fixture
      ON fixture.backfill_brand_id = entitlement.brand_id
  ) THEN
    RAISE EXCEPTION 'pre-rollout fixture unexpectedly has an entitlement';
  END IF;
END;
$before$;

\ir ../20280206002829_issue_2829_sites_general_availability.sql

BEGIN;
INSERT INTO public.brands(id, account_id, name, slug)
SELECT future_brand_id, owner_id, 'Sites GA Future', 'sites-ga-future'
FROM i2829_ga_fixture;

INSERT INTO public.brands(id, account_id, name, slug, deleted_at)
SELECT restored_brand_id, owner_id, 'Sites GA Restored', 'sites-ga-restored', now()
FROM i2829_ga_fixture;

INSERT INTO public.brands(id, account_id, name, slug)
SELECT revoked_brand_id, owner_id, 'Sites GA Revoked', 'sites-ga-revoked'
FROM i2829_ga_fixture;

UPDATE public.brand_site_entitlements entitlement
SET status = 'revoked', source = 'admin', revoked_at = clock_timestamp(),
  reason_code = 'abuse', note = 'fixture safety hold'
FROM i2829_ga_fixture fixture
WHERE entitlement.brand_id = fixture.revoked_brand_id;

UPDATE public.brands brand
SET deleted_at = clock_timestamp()
FROM i2829_ga_fixture fixture
WHERE brand.id = fixture.revoked_brand_id;
UPDATE public.brands brand
SET deleted_at = NULL
FROM i2829_ga_fixture fixture
WHERE brand.id = fixture.revoked_brand_id;

UPDATE public.brands brand
SET deleted_at = NULL
FROM i2829_ga_fixture fixture
WHERE brand.id = fixture.restored_brand_id;
COMMIT;

DO $behavior$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.brand_site_entitlements entitlement
  JOIN i2829_ga_fixture fixture ON entitlement.brand_id IN (
    fixture.backfill_brand_id,
    fixture.future_brand_id,
    fixture.restored_brand_id
  )
  WHERE entitlement.status = 'granted'
    AND entitlement.source = 'rule'
    AND entitlement.reason_code = 'rollout';
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'expected three default grants, got %', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.brand_site_entitlements entitlement
    JOIN i2829_ga_fixture fixture
      ON fixture.revoked_brand_id = entitlement.brand_id
    WHERE entitlement.status = 'revoked'
      AND entitlement.reason_code = 'abuse'
      AND entitlement.note = 'fixture safety hold'
  ) THEN
    RAISE EXCEPTION 'explicit revoked entitlement was overwritten';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.brand_site_audit_log audit
  JOIN i2829_ga_fixture fixture ON audit.brand_id IN (
    fixture.backfill_brand_id,
    fixture.future_brand_id,
    fixture.restored_brand_id,
    fixture.revoked_brand_id
  )
  WHERE audit.action = 'entitlement.granted'
    AND audit.actor_kind = 'system'
    AND audit.metadata = jsonb_build_object(
      'reason_code', 'rollout', 'status', 'granted'
    );
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'expected four auditable default grants, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.brand_sites site
  JOIN i2829_ga_fixture fixture ON site.brand_id IN (
    fixture.backfill_brand_id,
    fixture.future_brand_id,
    fixture.restored_brand_id,
    fixture.revoked_brand_id
  );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'general availability auto-created % site rows', v_count;
  END IF;
END;
$behavior$;

\ir ../20280206002829_issue_2829_sites_general_availability.sql

DO $idempotent$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.brand_site_audit_log audit
  JOIN i2829_ga_fixture fixture ON audit.brand_id IN (
    fixture.backfill_brand_id,
    fixture.future_brand_id,
    fixture.restored_brand_id,
    fixture.revoked_brand_id
  )
  WHERE audit.action = 'entitlement.granted'
    AND audit.actor_kind = 'system';
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'migration replay duplicated grant audit rows: %', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.brand_site_entitlements entitlement
    JOIN i2829_ga_fixture fixture
      ON fixture.revoked_brand_id = entitlement.brand_id
    WHERE entitlement.status = 'revoked'
      AND entitlement.reason_code = 'abuse'
  ) THEN
    RAISE EXCEPTION 'migration replay overwrote an explicit revoke';
  END IF;
END;
$idempotent$;

BEGIN;
DELETE FROM public.brand_site_audit_log audit
USING i2829_ga_fixture fixture
WHERE audit.brand_id IN (
  fixture.backfill_brand_id,
  fixture.future_brand_id,
  fixture.restored_brand_id,
  fixture.revoked_brand_id
);
DELETE FROM public.brand_site_entitlements entitlement
USING i2829_ga_fixture fixture
WHERE entitlement.brand_id IN (
  fixture.backfill_brand_id,
  fixture.future_brand_id,
  fixture.restored_brand_id,
  fixture.revoked_brand_id
);
DELETE FROM public.brands brand
USING i2829_ga_fixture fixture
WHERE brand.id IN (
  fixture.backfill_brand_id,
  fixture.future_brand_id,
  fixture.restored_brand_id,
  fixture.revoked_brand_id
);
DELETE FROM public.creator_accounts account
USING i2829_ga_fixture fixture
WHERE account.id = fixture.owner_id;
DELETE FROM auth.users user_row
USING i2829_ga_fixture fixture
WHERE user_row.id = fixture.owner_id;
COMMIT;

DROP TABLE i2829_ga_fixture;
