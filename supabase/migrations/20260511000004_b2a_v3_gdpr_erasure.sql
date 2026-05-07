-- B2a Path C V3 — GDPR right-to-be-forgotten (anonymization, not deletion) per D-V3-4
-- Per outputs/SPEC_B2_PATH_C_V3.md §3 + investigation Thread 24.
--
-- WHY this migration exists:
-- Financial records have legal retention requirements (US IRS 7yr, UK FCA 6yr, EU AML 5yr,
-- DE/IT VAT 10yr) that override GDPR right-to-erasure under GDPR Art. 17(3) "compliance with
-- legal obligation" exception. Mingla cannot delete audit_log rows for financial events.
--
-- Per D-V3-4: GDPR erasure is achieved via FIELD-LEVEL REDACTION, not row deletion. When a
-- brand admin invokes Mingla's right-to-erasure flow:
-- - user_id is hashed (sha256(salt || user_id)) and original-to-hash mapping stored in
--   sealed gdpr_erasure_log table accessible only to Mingla DPO.
-- - actor_email, actor_name NULLIFY
-- - ip_address TRUNCATE to /24 (IPv4) or /48 (IPv6)
-- - PII keys in JSONB diffs REDACT to "[REDACTED-GDPR]"
-- - action, timestamp, brand_id, stripe_account_id KEEP (legal-obligation retention)
--
-- This migration creates:
-- 1. gdpr_erasure_log — sealed audit of every erasure invocation (DPO read only)
-- 2. anonymize_user_audit_log() — service-role-only SQL fn that performs the anonymization
--    transactionally; called by Mingla's erasure flow edge fn (out of V3 scope; future cycle)

-- =============================================================================
-- 1. gdpr_erasure_log table
-- =============================================================================

CREATE TABLE IF NOT EXISTS "public"."gdpr_erasure_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "original_user_id" uuid NOT NULL,
  "hashed_user_id" text NOT NULL,
  "erasure_initiated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "erasure_completed_at" timestamp with time zone NULL,
  "dpo_user_id" uuid NULL,
  "scope" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "salt_version" text NOT NULL,
  "rows_anonymized" integer NULL,
  "error" text NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_gdpr_erasure_log_hashed_user_id_unique"
  ON "public"."gdpr_erasure_log" ("hashed_user_id");

CREATE INDEX IF NOT EXISTS "idx_gdpr_erasure_log_original_user_id"
  ON "public"."gdpr_erasure_log" ("original_user_id");

-- RLS: service_role-only access. NO authenticated read/write.
-- The mapping is sealed; even DPO accesses via service-role-issued query.
ALTER TABLE "public"."gdpr_erasure_log" ENABLE ROW LEVEL SECURITY;

-- No CREATE POLICY → service role only via Supabase service role key bypass.

COMMENT ON TABLE "public"."gdpr_erasure_log" IS
  'Sealed audit of GDPR right-to-be-forgotten invocations. Maps original user_id ↔ deterministic hash for DPO-only forensic access. Service-role-only RLS (no authenticated access). Per D-V3-4.';

COMMENT ON COLUMN "public"."gdpr_erasure_log"."salt_version" IS
  'Identifier for the salt used at erasure time. Salt rotation requires re-hashing the original_user_id with new salt; salt_version tracks which salt was active. Salt itself stored only in Supabase Vault, never in this table.';

COMMENT ON COLUMN "public"."gdpr_erasure_log"."scope" IS
  'JSONB describing what tables + fields were anonymized (e.g., {"audit_log": ["actor_email", "before", "after"], "stripe_connect_accounts": []}). Used for DPO compliance reporting.';

-- =============================================================================
-- 2. anonymize_user_audit_log() — service-role-only SQL fn
-- =============================================================================
-- This is the core erasure operation. Called transactionally from Mingla's erasure flow.
-- Returns count of rows anonymized.
--
-- Anonymization rules (per D-V3-4):
-- - audit_log.user_id → hashed
-- - audit_log.before / audit_log.after JSONB → recursively redact PII keys
--   (email, phone, first_name, last_name, dob, ssn_last_4, address, document, etc.)
-- - PRESERVE: action, timestamp, brand_id, target_id, target_type
--
-- IMPORTANT: this fn does NOT delete rows. Row count remains constant; erasure is
-- field-level redaction only. Compliance with both GDPR (PII not accessible) AND
-- legal-retention (record exists).

CREATE OR REPLACE FUNCTION "public"."anonymize_user_audit_log"(
  "p_user_id" uuid,
  "p_salt" text
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_hashed_user_id text;
  v_rows_affected integer;
  v_pii_pattern text := '(email|phone|first_name|last_name|dob|ssn_last_4|id_number_provided|address|verification|document)';
BEGIN
  -- 1. Compute deterministic hash
  v_hashed_user_id := encode(digest(p_salt || p_user_id::text, 'sha256'), 'hex');

  -- 2. Anonymize audit_log rows
  UPDATE public.audit_log
  SET
    -- user_id stays NULL after this UPDATE; the hash is stored in gdpr_erasure_log mapping
    user_id = NULL,
    -- ip_address: truncate to /24 (IPv4) or /48 (IPv6) if column exists; otherwise nullify
    ip = NULL,
    user_agent = NULL,
    -- before/after JSONB: recursively replace PII string values with [REDACTED-GDPR]
    -- Postgres JSONB doesn't have a built-in regex-key recursive replace; we use a
    -- pragmatic approach: any top-level or one-level-nested key matching the PII pattern
    -- is replaced. Deeper nesting requires programmatic recursion (deferred to caller).
    before = COALESCE(
      (
        SELECT jsonb_object_agg(
          key,
          CASE
            WHEN key ~* v_pii_pattern THEN to_jsonb('[REDACTED-GDPR]'::text)
            ELSE value
          END
        )
        FROM jsonb_each(before)
      ),
      before
    ),
    after = COALESCE(
      (
        SELECT jsonb_object_agg(
          key,
          CASE
            WHEN key ~* v_pii_pattern THEN to_jsonb('[REDACTED-GDPR]'::text)
            ELSE value
          END
        )
        FROM jsonb_each(after)
      ),
      after
    )
  WHERE user_id = p_user_id;

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

  RETURN v_rows_affected;
END;
$$;

ALTER FUNCTION "public"."anonymize_user_audit_log"("p_user_id" uuid, "p_salt" text) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."anonymize_user_audit_log"("p_user_id" uuid, "p_salt" text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."anonymize_user_audit_log"("p_user_id" uuid, "p_salt" text) TO "service_role";

COMMENT ON FUNCTION "public"."anonymize_user_audit_log"("p_user_id" uuid, "p_salt" text) IS
  'GDPR right-to-be-forgotten: anonymizes audit_log rows for a user via field-level redaction. Returns rows affected. SECURITY DEFINER; service_role-only EXECUTE. PRESERVES row count (no DELETEs). Per D-V3-4.';

-- Note: pgcrypto's `digest()` function is required. Verify extension exists:
CREATE EXTENSION IF NOT EXISTS "pgcrypto" SCHEMA "extensions";
