-- ===========================================================================
-- META-ORCH-1148 sub-ORCH 2.2a — reservation_checkout_sessions (thin FEE mirror)
-- ---------------------------------------------------------------------------
-- OQ-2 LOCKED (Seth 2026-06-17): fee reservations use a THIN NEW dedicated
-- table — NOT an overload of ticket_checkout_sessions (clean separation from
-- ticketing, mirroring how venue_waitlist deliberately did NOT overload
-- tickets). This table holds an IN-FLIGHT fee reservation between
-- venue-reservation-create (which charges UPFRONT via the shared all-in engine)
-- and venue-reservation-confirm (which verifies the charge succeeded and mints
-- the reservations row atomically via pg_create_guest_reservation).
--
-- THE ATOMICITY CONTRACT (I-PROPOSED-1148-CHARGE-AND-RESERVATION-ATOMIC):
--   No fee reservation is ever `confirmed`/`paid` without a verified successful
--   charge; no charge ever happens without a reservation record to flip. The
--   session row is the durable record that a charge is in flight: the
--   reservations row is created on payment success (status flips here to
--   'completed' + reservation_id linked). A charge with no session row, or a
--   completed session with no reservation_id, is an invariant violation.
--
-- Fee model = CHARGE UPFRONT, forfeit after cutoff (DECISIONS LOCKED): the fee
-- is charged at booking; cancel BEFORE cutoff → refund (reuse refund-order);
-- cancel AFTER cutoff / no-show → forfeit (already charged, no capture step).
-- The policy fields the cancel/refund seam needs (cancel_cutoff_hours,
-- fee_refundable) live on venue_reservation_settings + are copied onto the
-- reservations row at confirm; this session table carries the in-flight charge
-- ref + buyer contact + the guest_cancel_token to thread into the row.
--
-- RLS: ENABLED, NO authenticated policy (deny-by-default). The only access is
-- the service-role edge fns (venue-reservation-create / -confirm). A
-- buyer/guest never reads this table directly — the web confirm path is gated
-- by the buyer_status_token (sha256-hash-matched), mirroring
-- ticket_checkout_sessions' buyer_status_token_hash pattern.
--
-- Additive-only; per-table updated_at trigger; idempotent; BEGIN/COMMIT.
-- MONOTONIC VERSION 20261012000002. Apply via the Supabase Management API.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.reservation_checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  place_pool_id uuid NULL REFERENCES public.place_pool(id) ON DELETE SET NULL,
  -- the requested slot (re-validated against the engine at create AND confirm).
  reserved_for timestamptz NOT NULL,
  party_size int NOT NULL CHECK (party_size >= 1 AND party_size <= 100),
  -- buyer identity (the anon/guest contact carried onto the reservations row).
  buyer_name text NOT NULL,
  buyer_email text NOT NULL,
  buyer_phone_e164 text NOT NULL,
  -- optional extras threaded onto the reservation at confirm.
  occasion text NULL,
  guest_notes text NULL,
  marketing_opt_in boolean NOT NULL DEFAULT false,
  -- the all-in fee the buyer is charged (engine-computed; minor units).
  amount_cents int NOT NULL CHECK (amount_cents >= 0),
  currency char(3) NOT NULL,
  -- provider charge refs (Stripe PaymentIntent OR hosted Checkout Session id;
  -- Paystack reference falls out of the ticket-checkout-create reuse for NG).
  stripe_payment_intent_id text NULL,
  stripe_checkout_session_id text NULL,
  stripe_account_id text NULL,
  paystack_reference text NULL,
  -- which surface created it (drives the native-PaymentSheet vs hosted-redirect
  -- arm + the source on the final reservations row: native→'mingla', web→'website').
  created_via text NOT NULL CHECK (created_via IN ('app', 'web')),
  -- signed-in consumer (native sign-in-at-confirm) — NULL for anon web guest.
  consumer_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  -- opaque token minted for web rows → carried onto the reservation's
  -- guest_cancel_token for the cancel-from-link.
  guest_cancel_token text NULL,
  -- buyer status token HASH (sha256) — the web confirm path proves ownership by
  -- presenting the plaintext token, hash-matched here (NOT a Supabase JWT).
  buyer_status_token_hash text NULL,
  -- lifecycle: pending (charge in flight) → completed (paid + reservation
  -- minted) | expired (abandoned) | failed (charge failed).
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'expired', 'failed')),
  -- the reservation minted on payment success (the atomicity link).
  reservation_id uuid NULL REFERENCES public.reservations(id) ON DELETE SET NULL,
  failure_reason text NULL,
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- lookup by PI / checkout-session for the confirm/webhook flip.
CREATE INDEX IF NOT EXISTS reservation_checkout_sessions_pi_idx
  ON public.reservation_checkout_sessions (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reservation_checkout_sessions_cs_idx
  ON public.reservation_checkout_sessions (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reservation_checkout_sessions_paystack_idx
  ON public.reservation_checkout_sessions (paystack_reference)
  WHERE paystack_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS reservation_checkout_sessions_brand_status_idx
  ON public.reservation_checkout_sessions (brand_id, status);

CREATE OR REPLACE FUNCTION public.tg_reservation_checkout_sessions_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS reservation_checkout_sessions_set_updated_at ON public.reservation_checkout_sessions;
CREATE TRIGGER reservation_checkout_sessions_set_updated_at
  BEFORE UPDATE ON public.reservation_checkout_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_reservation_checkout_sessions_set_updated_at();

-- RLS ENABLED, NO authenticated/anon policy → deny-by-default. Only the
-- service-role edge fns touch this table; the buyer never reads it directly
-- (web confirm is gated by buyer_status_token_hash, not RLS).
ALTER TABLE public.reservation_checkout_sessions ENABLE ROW LEVEL SECURITY;

-- service_role bypasses RLS, but grant table privileges explicitly. anon +
-- authenticated get NOTHING (no GRANT, no policy).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reservation_checkout_sessions TO service_role;

COMMIT;
