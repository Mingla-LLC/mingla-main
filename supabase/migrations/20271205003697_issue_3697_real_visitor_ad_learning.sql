-- toward #3697: durable browser match data, checkout-start dedup, and ad detail.

ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN IF NOT EXISTS fbp text,
  ADD COLUMN IF NOT EXISTS fbc text,
  ADD COLUMN IF NOT EXISTS scid text,
  ADD COLUMN IF NOT EXISTS client_ip text,
  ADD COLUMN IF NOT EXISTS client_user_agent text,
  ADD COLUMN IF NOT EXISTS ad_checkout_start_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS ad_checkout_start_provider_response jsonb;

ALTER TABLE public.ad_attribution_touches
  ADD COLUMN IF NOT EXISTS ad_set_id text,
  ADD COLUMN IF NOT EXISTS ad_id text;

COMMENT ON COLUMN public.ticket_checkout_sessions.fbp IS
  'toward #3697: consent-granted Meta browser id captured when checkout starts.';
COMMENT ON COLUMN public.ticket_checkout_sessions.fbc IS
  'toward #3697: consent-granted Meta click cookie captured when checkout starts.';
COMMENT ON COLUMN public.ticket_checkout_sessions.scid IS
  'toward #3697: consent-granted Snap _scid cookie captured when checkout starts.';
COMMENT ON COLUMN public.ticket_checkout_sessions.client_ip IS
  'toward #3697: request IP retained for server-side ad event matching.';
COMMENT ON COLUMN public.ticket_checkout_sessions.client_user_agent IS
  'toward #3697: checkout request user agent retained for server-side ad event matching.';
COMMENT ON COLUMN public.ticket_checkout_sessions.ad_checkout_start_sent_at IS
  'toward #3697: idempotency claim for server InitiateCheckout/START_CHECKOUT sends.';
COMMENT ON COLUMN public.ad_attribution_touches.ad_set_id IS
  'toward #3697: provider ad-set/ad-squad macro captured from the landing URL.';
COMMENT ON COLUMN public.ad_attribution_touches.ad_id IS
  'toward #3697: provider ad macro captured from the landing URL.';
