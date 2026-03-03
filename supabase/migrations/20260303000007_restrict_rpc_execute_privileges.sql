-- Restrict record_card_impressions RPC to service_role only.
-- Without this, any authenticated user can call it with another user's UUID
-- and pollute their impressions data.

REVOKE EXECUTE ON FUNCTION public.record_card_impressions(UUID, UUID[], INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_card_impressions(UUID, UUID[], INTEGER) TO service_role;
