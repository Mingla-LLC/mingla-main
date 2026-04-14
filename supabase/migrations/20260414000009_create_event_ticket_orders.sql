CREATE TABLE IF NOT EXISTS public.event_ticket_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.event_tickets(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  guest_phone text,
  quantity integer NOT NULL,
  unit_price numeric(10,2) NOT NULL,
  total_amount numeric(10,2) NOT NULL,
  platform_fee numeric(10,2) NOT NULL,
  promo_code text,
  discount_amount numeric(10,2) NOT NULL DEFAULT 0,
  stripe_payment_intent_id text NOT NULL,
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'completed', 'failed', 'refunded')),
  qr_code text NOT NULL UNIQUE,
  checked_in boolean NOT NULL DEFAULT false,
  checked_in_at timestamptz,
  referral_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eto_event ON public.event_ticket_orders (event_id);
CREATE INDEX IF NOT EXISTS idx_eto_user ON public.event_ticket_orders (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_eto_stripe ON public.event_ticket_orders (stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_eto_qr ON public.event_ticket_orders (qr_code);

ALTER TABLE public.event_ticket_orders ENABLE ROW LEVEL SECURITY;

-- Buyer can read own orders
DO $$ BEGIN
  CREATE POLICY "eto_buyer_read" ON public.event_ticket_orders FOR SELECT TO authenticated
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Event creator can read all orders for their events
DO $$ BEGIN
  CREATE POLICY "eto_creator_read" ON public.event_ticket_orders FOR SELECT TO authenticated
    USING (event_id IN (SELECT id FROM public.events WHERE creator_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "eto_service_role" ON public.event_ticket_orders FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
