-- Issue #4238 Wave 4 (M-3) — native app purchases go to AppsFlyer, not to the
-- ad networks as website events.
--
-- Spec: #4238 tracking-fix spec v2.4, section 9 (W4-1, D20) and section 12.
--
-- What this adds:
--   ticket_checkout_sessions.checkout_surface — which surface created the
--   session: 'web' (buyer web), 'mobile-web' or 'native' (an app checkout).
--   ticket-checkout-create already computes it; it now persists it in its own
--   fail-open write. The finalize-time conversion (adConversionFire.ts) reads
--   it: a 'native' order is skipped on Meta, TikTok, Snap, Reddit and Google
--   (native_surface) and posted to AppsFlyer as af_purchase once.
--   NULL = a session created before this column (treated as web, unchanged).
--
-- Static SQL only. No backfill, no data rewrite, no new grant. Do NOT
-- auto-apply — reviewed path post-merge. Apply BEFORE the edge functions.

BEGIN;

ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN IF NOT EXISTS checkout_surface text NULL;

ALTER TABLE public.ticket_checkout_sessions
  DROP CONSTRAINT IF EXISTS ticket_checkout_sessions_checkout_surface_check;
ALTER TABLE public.ticket_checkout_sessions
  ADD CONSTRAINT ticket_checkout_sessions_checkout_surface_check
  CHECK (
    checkout_surface IS NULL
    OR checkout_surface IN ('web', 'mobile-web', 'native')
  );

COMMENT ON COLUMN public.ticket_checkout_sessions.checkout_surface IS
  'Issue #4238: the surface that created this checkout (web | mobile-web | native). native orders go to AppsFlyer (af_purchase), never to ad networks as website events. NULL = pre-#4238 session.';

COMMIT;
