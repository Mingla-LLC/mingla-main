-- Issue #3645 — repair the admin guard on the paid-without-ticket finder.
-- The original function called public.is_admin(), which does not exist in the
-- canonical schema. Re-emit it with the established full-admin authority.

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $preflight$
BEGIN
  IF to_regprocedure('public.is_admin_user()') IS NULL THEN
    RAISE EXCEPTION 'issue_3645_is_admin_user_missing';
  END IF;
  IF to_regclass('public.ticket_checkout_sessions') IS NULL THEN
    RAISE EXCEPTION 'issue_3645_ticket_checkout_sessions_missing';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.admin_list_paid_without_ticket(
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  checkout_session_id uuid,
  status text,
  provider_reference text,
  brand_id uuid,
  buyer_email text,
  expires_at timestamptz,
  created_at timestamptz,
  total_cents int,
  currency text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit int := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.status::text,
    s.stripe_payment_intent_id,
    s.brand_id,
    s.buyer_email,
    s.expires_at,
    s.created_at,
    s.total_cents,
    s.currency::text
  FROM public.ticket_checkout_sessions s
  WHERE s.order_id IS NULL
    AND s.status IN (
      'processing_payment',
      'awaiting_web_redirect',
      'requires_payment',
      'pending_free'
    )
    AND s.stripe_payment_intent_id IS NOT NULL
    AND s.stripe_payment_intent_id LIKE 'mingla_%'
    AND s.expires_at < now()
  ORDER BY s.created_at ASC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_paid_without_ticket(int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_paid_without_ticket(int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_paid_without_ticket(int) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_list_paid_without_ticket(int) IS
  '#3645 — admin finder for past-expiry Paystack (mingla_*) checkouts with no order.';

DO $postflight$
DECLARE
  v_source text;
BEGIN
  SELECT p.prosrc INTO v_source
    FROM pg_proc p
   WHERE p.oid = 'public.admin_list_paid_without_ticket(int)'::regprocedure;

  IF v_source !~ 'public\.is_admin_user\(\)'
     OR v_source ~ 'public\.is_admin\(\)' THEN
    RAISE EXCEPTION 'issue_3645_admin_guard_invalid';
  END IF;
  IF has_function_privilege('anon', 'public.admin_list_paid_without_ticket(int)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.admin_list_paid_without_ticket(int)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.admin_list_paid_without_ticket(int)', 'EXECUTE') THEN
    RAISE EXCEPTION 'issue_3645_admin_list_acl_invalid';
  END IF;
END;
$postflight$;

NOTIFY pgrst, 'reload schema';
COMMIT;
