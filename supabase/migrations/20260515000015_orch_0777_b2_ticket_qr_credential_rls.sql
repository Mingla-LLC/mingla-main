-- ORCH-0777 B2: scanner-valid ticket QR credentials must not be readable
-- through broad brand-team ticket SELECT access. Buyer display, confirmation
-- dispatch, and scanner validation continue through service-role paths.

REVOKE SELECT ON TABLE public.tickets FROM anon;
REVOKE SELECT ON TABLE public.tickets FROM authenticated;

GRANT SELECT (
  id,
  order_id,
  ticket_type_id,
  event_id,
  attendee_name,
  attendee_email,
  attendee_phone,
  status,
  transferred_to_email,
  transferred_at,
  approval_status,
  approval_decided_by,
  approval_decided_at,
  created_at,
  used_at,
  used_by_scanner_id,
  qr_version,
  issued_at
) ON TABLE public.tickets TO anon;

GRANT SELECT (
  id,
  order_id,
  ticket_type_id,
  event_id,
  attendee_name,
  attendee_email,
  attendee_phone,
  status,
  transferred_to_email,
  transferred_at,
  approval_status,
  approval_decided_by,
  approval_decided_at,
  created_at,
  used_at,
  used_by_scanner_id,
  qr_version,
  issued_at
) ON TABLE public.tickets TO authenticated;

REVOKE EXECUTE ON FUNCTION public.biz_ticket_checkout_qr_payload(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_ticket_checkout_qr_payload(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.biz_ticket_checkout_qr_payload(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_qr_payload(uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.biz_ticket_checkout_token_hash(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.biz_ticket_checkout_token_hash(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.biz_ticket_checkout_token_hash(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_token_hash(text) TO service_role;
