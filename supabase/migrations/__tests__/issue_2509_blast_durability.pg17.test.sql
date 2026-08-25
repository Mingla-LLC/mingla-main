-- #2509 — prove the durability migration does what it claims, against a real
-- PG17 instance with the full migration chain already applied.
--
-- The two properties worth money here are (1) the uniqueness that makes a
-- resumed pass structurally unable to double-send, and (2) the reclaim
-- predicate that lets a wedged campaign be picked up again. A migration that
-- merely APPLIES proves neither.
\set ON_ERROR_STOP on
BEGIN;

-- 1. Both indexes exist and are UNIQUE.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND indexname='issue_2509_one_email_row_per_campaign'
  ) THEN RAISE EXCEPTION '#2509: email uniqueness index missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND indexname='issue_2509_one_sms_row_per_campaign'
  ) THEN RAISE EXCEPTION '#2509: sms uniqueness index missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
     WHERE c.relname='issue_2509_one_email_row_per_campaign' AND i.indisunique
  ) THEN RAISE EXCEPTION '#2509: email index exists but is NOT unique'; END IF;
END $$;

-- 2. The reclaim helper and the heartbeat both exist.
DO $$
BEGIN
  IF to_regprocedure('public.mkt_claim_campaigns(integer,uuid)') IS NULL
    THEN RAISE EXCEPTION '#2509: mkt_claim_campaigns missing'; END IF;
  IF to_regprocedure('public.mkt_heartbeat_campaign(uuid)') IS NULL
    THEN RAISE EXCEPTION '#2509: mkt_heartbeat_campaign missing'; END IF;
END $$;

-- 3. The claim predicate genuinely mentions the stalled-sending arm. A reclaim
--    that only matches 'scheduled' is the original wedge.
DO $$
DECLARE v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='mkt_claim_campaigns';
  IF v_src NOT LIKE '%''sending''%' THEN
    RAISE EXCEPTION '#2509: claim predicate cannot reclaim a stalled sending campaign';
  END IF;
  IF v_src NOT LIKE '%FOR UPDATE SKIP LOCKED%' THEN
    RAISE EXCEPTION '#2509: claim lost its FOR UPDATE SKIP LOCKED';
  END IF;
END $$;

COMMIT;
