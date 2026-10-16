-- #3645 Ilashe P0 — admin finder for Paystack paid-without-ticket candidates.
-- Lists in-flight ticket checkout sessions with a mingla_* reference past expiry
-- and no order_id. Ops use this alongside reconcile-stuck-checkouts verify arm.

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
  IF NOT public.is_admin() THEN
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
