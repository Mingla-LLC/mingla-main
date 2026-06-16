-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.1b — D-2 fix: partial-index-safe global opt-out write
-- ---------------------------------------------------------------------------
-- The send-venue-sms edge fn's defensive Twilio-21610 (blacklisted) write used
--   .upsert({ phone_e164, brand_id: null, ... }, { onConflict: "phone_e164" })
-- which emits INSERT ... ON CONFLICT (phone_e164) DO NOTHING. But venue_sms_opt_out
-- has ONLY PARTIAL unique indexes:
--   venue_sms_opt_out_phone_global_uniq  ON (phone_e164)            WHERE brand_id IS NULL
--   venue_sms_opt_out_phone_brand_uniq   ON (phone_e164, brand_id)  WHERE brand_id IS NOT NULL
-- There is NO plain UNIQUE(phone_e164), so ON CONFLICT (phone_e164) errors at
-- runtime: "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification". The Supabase JS .upsert() API cannot express a partial-index
-- predicate, so the defensive global opt-out NEVER persisted (PROVEN LIVE by the
-- tester, TEST_META-ORCH-1148_SUBB_2_1B.md D-2).
--
-- FIX (option c): a SECURITY DEFINER RPC that runs the CORRECT, partial-index-safe
-- arbiter — ON CONFLICT (phone_e164) WHERE brand_id IS NULL DO NOTHING — which
-- matches the GLOBAL partial unique index exactly and is idempotent (a repeat
-- 21610 for the same number is a no-op, never a duplicate-key crash). The edge fn
-- (service role) calls this instead of the broken .upsert(). The per-brand opt-out
-- rows are PRESERVED (no plain UNIQUE added), so the existing partial-index
-- semantics are untouched.
--
-- GRANT EXECUTE to service_role ONLY (the edge fn runs service role; this is an
-- internal persistence helper, never operator/anon-callable). The Supabase
-- auto-GRANT-to-PUBLIC/anon gotcha is handled: REVOKE PUBLIC + anon explicitly.
--
-- I-PROPOSED-1148-SMS-21610-OPTOUT-PERSISTS: a simulated Twilio 21610 defensive
-- global opt-out PERSISTS (one row, brand_id IS NULL) without throwing, and is
-- idempotent on repeat. A revert to the .upsert(onConflict:"phone_e164") path
-- throws "no unique or exclusion constraint matching the ON CONFLICT spec".
--
-- Additive-only. $function$ closed BEFORE each GRANT. MONOTONIC VERSION
-- 20261011000001 (immediately above the D-1 fix 20261011000000). Apply via the
-- Supabase Management API after REVIEW. NOT applied to prod by the implementor.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- biz_sms_record_global_opt_out — partial-index-safe, idempotent global opt-out.
-- Writes a brand_id-NULL (GLOBAL) opt-out row for the phone if one does not
-- already exist. Used by send-venue-sms on a Twilio 21610 (blacklist) response.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_sms_record_global_opt_out(
  p_phone_e164 text,
  p_reason text DEFAULT 'twilio_blacklist'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  -- Defensive: only the three allowed reasons (CHECK on the table mirrors this).
  IF p_reason NOT IN ('stop_keyword','manual','twilio_blacklist') THEN
    p_reason := 'twilio_blacklist';
  END IF;

  -- ON CONFLICT targets the GLOBAL partial unique index's predicate exactly, so
  -- the arbiter resolves and a repeat is a no-op (idempotent, never a 23505 crash).
  INSERT INTO public.venue_sms_opt_out (phone_e164, brand_id, reason)
  VALUES (p_phone_e164, NULL, p_reason)
  ON CONFLICT (phone_e164) WHERE brand_id IS NULL
  DO NOTHING;
END;
$function$;

-- service_role only (the edge fn runs service role); never operator/anon-callable.
REVOKE ALL ON FUNCTION public.biz_sms_record_global_opt_out(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_sms_record_global_opt_out(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.biz_sms_record_global_opt_out(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.biz_sms_record_global_opt_out(text, text) TO service_role;

COMMIT;
