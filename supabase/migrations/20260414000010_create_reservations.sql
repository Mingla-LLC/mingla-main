CREATE TABLE IF NOT EXISTS public.reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_profile_id uuid NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  party_size integer NOT NULL,
  date date NOT NULL,
  time time NOT NULL,
  special_requests text,
  dietary_needs jsonb NOT NULL DEFAULT '[]',
  pre_order_items jsonb NOT NULL DEFAULT '[]',
  deposit_amount numeric(10,2) NOT NULL DEFAULT 0,
  stripe_payment_intent_id text,
  confirmation_code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservations_business ON public.reservations (business_profile_id);
CREATE INDEX IF NOT EXISTS idx_reservations_user ON public.reservations (user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_date ON public.reservations (business_profile_id, date);

ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "res_user_all" ON public.reservations FOR ALL TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "res_business_read" ON public.reservations FOR SELECT TO authenticated
    USING (business_profile_id IN (SELECT id FROM public.business_profiles WHERE creator_account_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "res_service_role" ON public.reservations FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
