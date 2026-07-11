-- ORCH-1331 [partner program Nigeria/Paystack payout rail].
--
-- Builds the DB layer of the Paystack partner payout rail (SPEC §4.2):
--   1. partner_paystack_accounts — the Paystack twin of
--      partner_stripe_connect_accounts (Transfer Recipient mirror, one per
--      partner). PII rule: the full NUBAN is NEVER stored — last4 only.
--   2. partner_splits provider generalization (additive ONLY; no renames):
--      provider / payout_reference / attempt_count / reversal_owed_at columns,
--      widened status CHECK (+ 'blocked_no_paystack'), column-reuse COMMENTs.
--   3. mark_partner_split_failed learns 'blocked_no_paystack'; three NEW
--      service-role RPCs for the Paystack transfer lifecycle.
--   4. partner_brand_links lifecycle for Paystack owners: trigger stamps
--      owner_stripe_connected_at (COLUMN NOT RENAMED — deployed-client
--      contract, I-PROPOSED-1331-LINK-COLUMNS-FROZEN) when
--      brands.paystack_subaccount_code flips NULL→non-NULL. + backfill.
--   5. Retry-sweep cron (partner-paystack-split-retry, */30).
--   6. Probes.
--
-- INVARIANTS (DRAFT → ACTIVE on CLOSE):
--   I-PROPOSED-1331-PARTNER-SHARE-FROM-PLATFORM-FEE — partner share computed
--     only from Mingla's persisted platform fee; paid from Mingla's balance.
--   I-PROPOSED-1331-NUBAN-NEVER-PERSISTED — full bank account number never
--     lands in any Mingla table, log line, or audit payload. last4 only.
--   I-PROPOSED-1331-LINK-COLUMNS-FROZEN — partner_brand_links timestamp column
--     NAMES are frozen (client deriveLinkStatus contract); provider
--     generalization stamps the EXISTING columns, never renames.
--
-- IDEMPOTENCY: every object gated on IF [NOT] EXISTS / CREATE OR REPLACE /
-- guarded DO $$. Safe to re-run end-to-end.

BEGIN;

--------------------------------------------------------------------------------
-- 1. partner_paystack_accounts — Paystack payout identity per partner.
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.partner_paystack_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.creator_accounts(id) ON DELETE CASCADE,
  recipient_code text NOT NULL,            -- Paystack RCP_…
  bank_code text NOT NULL,
  bank_name text,
  account_number_last4 text NOT NULL,      -- NEVER the full NUBAN
  account_name text NOT NULL,              -- resolved holder name snapshot
  country text NOT NULL DEFAULT 'NG' CHECK (country = 'NG'),
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  detached_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One Paystack payout identity per partner (ORCH-1052 constraint pattern).
ALTER TABLE public.partner_paystack_accounts
  DROP CONSTRAINT IF EXISTS partner_paystack_accounts_account_id_key;
ALTER TABLE public.partner_paystack_accounts
  ADD CONSTRAINT partner_paystack_accounts_account_id_key
  UNIQUE (account_id);

-- Recipient codes never collide.
ALTER TABLE public.partner_paystack_accounts
  DROP CONSTRAINT IF EXISTS partner_paystack_accounts_recipient_code_key;
ALTER TABLE public.partner_paystack_accounts
  ADD CONSTRAINT partner_paystack_accounts_recipient_code_key
  UNIQUE (recipient_code);

CREATE INDEX IF NOT EXISTS partner_paystack_accounts_account_id_idx
  ON public.partner_paystack_accounts (account_id);

COMMENT ON TABLE public.partner_paystack_accounts IS
  'ORCH-1331: per-partner Paystack Transfer Recipient mirror (the Paystack twin of partner_stripe_connect_accounts). PII rule (I-PROPOSED-1331-NUBAN-NEVER-PERSISTED): the FULL bank account number is NEVER stored here or anywhere in Mingla — only account_number_last4. The full NUBAN lives only in Paystack (the recipient object).';
COMMENT ON COLUMN public.partner_paystack_accounts.account_number_last4 IS
  'ORCH-1331: last 4 digits ONLY. Never the full NUBAN (I-PROPOSED-1331-NUBAN-NEVER-PERSISTED).';
COMMENT ON COLUMN public.partner_paystack_accounts.recipient_code IS
  'ORCH-1331: Paystack Transfer Recipient code (RCP_…). Created via POST /transferrecipient.';

-- RLS: SELECT self OR is_admin_user() (mirrors partner_stripe_self_select as
-- reconciled by META-ORCH-1237/ORCH-1271 to public.is_admin_user()). Inline
-- predicate per feedback_rls_returning_owner_gap.md.
ALTER TABLE public.partner_paystack_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_paystack_accounts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_paystack_self_select
  ON public.partner_paystack_accounts;
CREATE POLICY partner_paystack_self_select
  ON public.partner_paystack_accounts
  FOR SELECT
  USING (
    account_id = auth.uid()
    OR public.is_admin_user()
  );

-- NO INSERT/UPDATE/DELETE policies — service role only (edge fn mediates).

--------------------------------------------------------------------------------
-- 2. partner_splits — provider generalization (additive ONLY; no renames).
--------------------------------------------------------------------------------

ALTER TABLE public.partner_splits
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe','paystack')),
  ADD COLUMN IF NOT EXISTS payout_reference text,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reversal_owed_at timestamptz;

COMMENT ON COLUMN public.partner_splits.provider IS
  'ORCH-1331: payout rail for this split — stripe (Transfer via Connect) or paystack (post-hoc Transfer from Mingla balance).';
COMMENT ON COLUMN public.partner_splits.payout_reference IS
  'ORCH-1331: Paystack transfer idempotency reference (psplit_<id>_a<attempt>). NULL on stripe rows.';
COMMENT ON COLUMN public.partner_splits.attempt_count IS
  'ORCH-1331: Paystack transfer attempts. Increments ONLY on definitive failure (transfer.failed webhook / unambiguous 4xx); ambiguous outcomes re-use the same reference so a duplicate can never pay twice.';
COMMENT ON COLUMN public.partner_splits.reversal_owed_at IS
  'ORCH-1331 (§4.5.6 honest no-claw-back marker): a refund landed AFTER the partner transfer completed. Paystack has no transfer-reversal API, so the money is owed back to Mingla — ops recovers manually (netting/off-platform). Status stays transferred; the ledger never lies.';

-- Column reuse (BINDING, SPEC §4.2.2): the Paystack rail rides the existing
-- UNIQUE text idempotency column + transfer-id slot.
COMMENT ON COLUMN public.partner_splits.stripe_application_fee_id IS
  'ORCH-1054: idempotency key. UNIQUE. Stripe rows: the charge application_fee id. ORCH-1331 Paystack rows: ''paystack:'' || <transaction reference> (the reference is unique per charge — persisted as ticket_checkout_sessions.stripe_payment_intent_id, UNIQUE).';
COMMENT ON COLUMN public.partner_splits.stripe_transfer_id IS
  'ORCH-1054: Stripe Transfer id on stripe rows. ORCH-1331: Paystack transfer_code (TRF_…) on paystack rows.';

-- Widen the status CHECK (drop by introspected name, re-add). Widen-only:
-- every existing row remains valid.
DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.partner_splits'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%status%'
       AND pg_get_constraintdef(oid) LIKE '%pending%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.partner_splits DROP CONSTRAINT %I',
      v_name
    );
  END LOOP;
END$$;

ALTER TABLE public.partner_splits
  ADD CONSTRAINT partner_splits_status_check
  CHECK (status IN (
    'pending',
    'transferred',
    'blocked_currency_mismatch',
    'blocked_no_stripe',
    'blocked_no_paystack',
    'failed',
    'reversed',
    'reversed_pending'
  ));

--------------------------------------------------------------------------------
-- 3a. mark_partner_split_failed — allowlist learns 'blocked_no_paystack'.
--     Same signature as ORCH-1054; latest definition wins.
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_partner_split_failed(
  p_application_fee_id text,
  p_reason text,
  p_error_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.partner_splits
  SET status = CASE
        WHEN p_reason IN (
          'blocked_currency_mismatch',
          'blocked_no_stripe',
          'blocked_no_paystack',
          'failed'
        ) THEN p_reason
        ELSE 'failed'
      END,
      error_message = p_error_message
  WHERE stripe_application_fee_id = p_application_fee_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_partner_split_failed(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_partner_split_failed(text, text, text) TO service_role;

--------------------------------------------------------------------------------
-- 3b. record_paystack_partner_split_attempt — INSERT a 'pending' paystack row
--     keyed by 'paystack:'||p_reference. Mirrors record_partner_split_attempt
--     (ORCH-1054 :179-233): ON CONFLICT DO NOTHING for webhook-replay
--     idempotency; returns the CURRENT row state.
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_paystack_partner_split_attempt(
  p_reference text,
  p_order_id uuid,
  p_brand_id uuid,
  p_partner_account_id uuid,
  p_mingla_fee_cents integer,
  p_partner_share_cents integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_key text;
BEGIN
  IF p_reference IS NULL OR length(p_reference) = 0 THEN
    RAISE EXCEPTION 'paystack_reference_required' USING ERRCODE = 'P0001';
  END IF;
  v_key := 'paystack:' || p_reference;

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
  )
  VALUES (
    p_order_id,
    p_brand_id,
    p_partner_account_id,
    p_mingla_fee_cents,
    p_partner_share_cents,
    'ngn',
    v_key,
    'pending',
    'paystack'
  )
  ON CONFLICT (stripe_application_fee_id) DO NOTHING;

  SELECT id, status, stripe_transfer_id, attempt_count, payout_reference, error_message
    INTO v_row
  FROM public.partner_splits
  WHERE stripe_application_fee_id = v_key;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'stripe_transfer_id', v_row.stripe_transfer_id,
    'attempt_count', v_row.attempt_count,
    'payout_reference', v_row.payout_reference,
    'error_message', v_row.error_message
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_paystack_partner_split_attempt(
  text, uuid, uuid, uuid, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_paystack_partner_split_attempt(
  text, uuid, uuid, uuid, integer, integer
) TO service_role;

COMMENT ON FUNCTION public.record_paystack_partner_split_attempt(
  text, uuid, uuid, uuid, integer, integer
) IS
  'ORCH-1331: insert a pending paystack partner_splits row keyed by ''paystack:''||reference. Idempotent (ON CONFLICT DO NOTHING). transfer_currency is always ngn (zero FX). Returns current row state incl. attempt_count.';

--------------------------------------------------------------------------------
-- 3c. mark_paystack_partner_split_attempted — a transfer was INITIATED
--     (Paystack answered "pending"): stamp payout_reference + transfer_code
--     while status stays 'pending' until transfer.success arrives.
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_paystack_partner_split_attempted(
  p_key text,
  p_payout_reference text,
  p_transfer_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.partner_splits
  SET payout_reference = p_payout_reference,
      stripe_transfer_id = p_transfer_code
  WHERE stripe_application_fee_id = p_key
    AND status = 'pending';
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_paystack_partner_split_attempted(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_paystack_partner_split_attempted(text, text, text) TO service_role;

COMMENT ON FUNCTION public.mark_paystack_partner_split_attempted(text, text, text) IS
  'ORCH-1331: transfer initiated (Paystack status "pending"): stamps payout_reference + stripe_transfer_id (transfer_code) while the row stays pending until transfer.success.';

--------------------------------------------------------------------------------
-- 3d. bump_paystack_partner_split_attempt — definitive failure: increment
--     attempt_count (so the next attempt uses a NEW reference) + record the
--     error. Status unchanged ('pending'; the sweep retries below the cap).
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bump_paystack_partner_split_attempt(
  p_key text,
  p_error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.partner_splits
  SET attempt_count = attempt_count + 1,
      error_message = p_error
  WHERE stripe_application_fee_id = p_key
    AND status = 'pending';
END;
$function$;

REVOKE ALL ON FUNCTION public.bump_paystack_partner_split_attempt(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_paystack_partner_split_attempt(text, text) TO service_role;

COMMENT ON FUNCTION public.bump_paystack_partner_split_attempt(text, text) IS
  'ORCH-1331: DEFINITIVE transfer failure (transfer.failed webhook / unambiguous 4xx): attempt_count+1 so the next attempt uses a NEW psplit reference. Ambiguous failures (timeout/5xx/429/insufficient balance) must NOT call this — same reference is re-used so a duplicate can never pay twice.';

--------------------------------------------------------------------------------
-- 4. partner_brand_links lifecycle for Paystack owners.
--    Stamps the SAME column (owner_stripe_connected_at) — NO RENAME.
--    I-PROPOSED-1331-LINK-COLUMNS-FROZEN: the deployed client deriveLinkStatus
--    reads owner_stripe_connected_at by name; renaming would break it.
--------------------------------------------------------------------------------

COMMENT ON COLUMN public.partner_brand_links.owner_stripe_connected_at IS
  'ORCH-1081 (generalized by ORCH-1331): the moment the brand OWNER connected a payout rail — Stripe charges_enabled flip OR Paystack subaccount attach. Column name frozen (client deriveLinkStatus contract, I-PROPOSED-1331-LINK-COLUMNS-FROZEN); semantics = "owner payout rail connected".';

CREATE OR REPLACE FUNCTION public.partner_brand_links_mark_paystack_connected()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
BEGIN
  IF NEW.paystack_subaccount_code IS NOT NULL
     AND (OLD.paystack_subaccount_code IS DISTINCT FROM NEW.paystack_subaccount_code)
     AND OLD.paystack_subaccount_code IS NULL
  THEN
    UPDATE public.partner_brand_links
       SET owner_stripe_connected_at = COALESCE(owner_stripe_connected_at, now())
     WHERE brand_id = NEW.id AND cancelled_at IS NULL;
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS partner_brand_links_paystack_connected_trigger ON public.brands;
CREATE TRIGGER partner_brand_links_paystack_connected_trigger
  AFTER UPDATE OF paystack_subaccount_code ON public.brands
  FOR EACH ROW EXECUTE FUNCTION public.partner_brand_links_mark_paystack_connected();

-- Backfill (defensive; expected 0 rows today): stamp active links whose brand
-- already has a Paystack subaccount attached.
UPDATE public.partner_brand_links pbl
   SET owner_stripe_connected_at = COALESCE(pbl.owner_stripe_connected_at, now())
  FROM public.brands b
 WHERE b.id = pbl.brand_id
   AND pbl.cancelled_at IS NULL
   AND b.paystack_subaccount_code IS NOT NULL
   AND pbl.owner_stripe_connected_at IS NULL;

-- first_split_at: NO CHANGE — the ORCH-1081 triggers fire on
-- partner_splits.status → 'transferred' regardless of provider.

--------------------------------------------------------------------------------
-- 5. Retry-sweep cron — partner-paystack-split-retry every 30 minutes.
--    Mirrors 20261116000000_orch_1187_reconcile_stuck_checkouts_cron.sql.
--------------------------------------------------------------------------------

-- §5.1 Vault dependency advisory (operator-owned secrets → NOTICE only).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url') THEN
    RAISE NOTICE 'ORCH-1331 advisory: vault.decrypted_secrets row "supabase_url" missing. The split-retry cron will register but http_post calls will fail at runtime until the operator creates it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') THEN
    RAISE NOTICE 'ORCH-1331 advisory: vault.decrypted_secrets row "service_role_key" missing. The split-retry cron will register but http_post calls will fail at runtime until the operator creates it.';
  END IF;
END$$;

-- §5.2 Idempotent re-schedule (unschedule if present, then schedule).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'orch_1331_partner_paystack_split_retry'
  ) THEN
    PERFORM cron.unschedule('orch_1331_partner_paystack_split_retry');
  END IF;
END$$;

-- §5.3 Schedule partner-paystack-split-retry every 30 minutes.
SELECT cron.schedule(
  'orch_1331_partner_paystack_split_retry',
  '*/30 * * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
          FROM vault.decrypted_secrets
         WHERE name = 'supabase_url'
         LIMIT 1
      ) || '/functions/v1/partner-paystack-split-retry',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret
            FROM vault.decrypted_secrets
           WHERE name = 'service_role_key'
           LIMIT 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);

--------------------------------------------------------------------------------
-- 6. Probes — RAISE EXCEPTION on any miss (this migration's own outputs).
--------------------------------------------------------------------------------

DO $$
DECLARE
  v_check_def text;
BEGIN
  -- 6.1 table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'partner_paystack_accounts'
  ) THEN
    RAISE EXCEPTION 'ORCH-1331 probe failed: partner_paystack_accounts missing';
  END IF;

  -- 6.2 partner_splits.provider column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'partner_splits'
       AND column_name = 'provider'
  ) THEN
    RAISE EXCEPTION 'ORCH-1331 probe failed: partner_splits.provider missing';
  END IF;

  -- 6.3 widened CHECK admits blocked_no_paystack
  SELECT pg_get_constraintdef(oid) INTO v_check_def
    FROM pg_constraint
   WHERE conrelid = 'public.partner_splits'::regclass
     AND conname = 'partner_splits_status_check';
  IF v_check_def IS NULL OR v_check_def NOT LIKE '%blocked_no_paystack%' THEN
    RAISE EXCEPTION 'ORCH-1331 probe failed: partner_splits_status_check does not admit blocked_no_paystack (def: %)', COALESCE(v_check_def, 'MISSING');
  END IF;

  -- 6.4 the new brands trigger + the existing first-split trigger both exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'partner_brand_links_paystack_connected_trigger'
       AND tgrelid = 'public.brands'::regclass
  ) THEN
    RAISE EXCEPTION 'ORCH-1331 probe failed: partner_brand_links_paystack_connected_trigger missing on brands';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'partner_brand_links_first_split_trigger'
       AND tgrelid = 'public.partner_splits'::regclass
  ) THEN
    RAISE EXCEPTION 'ORCH-1331 probe failed: partner_brand_links_first_split_trigger missing on partner_splits (ORCH-1081 dependency)';
  END IF;

  -- 6.5 cron row exists
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'orch_1331_partner_paystack_split_retry'
  ) THEN
    RAISE EXCEPTION 'ORCH-1331 probe failed: cron job orch_1331_partner_paystack_split_retry missing';
  END IF;
END$$;

COMMIT;
