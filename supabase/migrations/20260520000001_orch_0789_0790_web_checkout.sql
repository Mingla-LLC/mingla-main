-- ORCH-0790: Web buyer checkout via Stripe Checkout Sessions.
--
-- Adds a new `awaiting_web_redirect` status value to the
-- ticket_checkout_sessions status CHECK constraint, plus a
-- stripe_checkout_session_id column so the web flow can record the
-- hosted Checkout Session ID alongside the existing PaymentIntent ID.
--
-- Source of the current CHECK values: migration
-- 20260515000013_orch_0777_ticket_checkout_core.sql lines 94-102
-- ('pending_free','requires_payment','processing_payment',
-- 'paid_completed','free_completed','failed','expired'). No later
-- migration alters this constraint as of 2026-05-11.

BEGIN;

ALTER TABLE public.ticket_checkout_sessions
  DROP CONSTRAINT IF EXISTS ticket_checkout_sessions_status_check;

ALTER TABLE public.ticket_checkout_sessions
  ADD CONSTRAINT ticket_checkout_sessions_status_check
  CHECK (status = ANY (ARRAY[
    'pending_free'::text,
    'requires_payment'::text,
    'awaiting_web_redirect'::text,
    'processing_payment'::text,
    'paid_completed'::text,
    'free_completed'::text,
    'failed'::text,
    'expired'::text
  ]));

ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text;

CREATE INDEX IF NOT EXISTS idx_ticket_checkout_sessions_stripe_checkout_session_id
  ON public.ticket_checkout_sessions (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

COMMIT;
