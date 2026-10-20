-- #3281 repair: keep checkout and the booking quote server-only.
--
-- 20271121003281 dropped and recreated the two checkout session functions with
-- a new 15-argument signature, which reset their ACL to the default (anon and
-- authenticated could EXECUTE). It also granted pg_experience_booking_quote to
-- anon and authenticated. These are SECURITY DEFINER functions, and only the
-- ticket-checkout-create edge function (service_role) calls them. This restores
-- the posture production had before Round 2: postgres + service_role only.
--
-- Grants only. No function bodies change, so biz_ticket_checkout_finalize and
-- its issue_3872_copy_session_totals_to_order call are untouched.
-- Already applied to production on 2026-10-20 (see #3281); re-running is a no-op.

BEGIN;

REVOKE ALL ON FUNCTION public.biz_ticket_checkout_create_session(uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[], timestamptz, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_create_session(uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[], timestamptz, timestamptz, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.issue_1930_ticket_checkout_create_session_base(uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[], timestamptz, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1930_ticket_checkout_create_session_base(uuid, uuid, text, text, text, boolean, jsonb, text, timestamptz, integer, text, uuid[], timestamptz, timestamptz, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.pg_experience_booking_quote(uuid, uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_experience_booking_quote(uuid, uuid, integer, integer)
  TO service_role;

COMMIT;
