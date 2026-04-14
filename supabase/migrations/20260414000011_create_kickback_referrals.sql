CREATE TABLE IF NOT EXISTS public.kickback_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  referrer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_code text NOT NULL UNIQUE,
  commission_pct numeric(4,2) NOT NULL,
  clicks integer NOT NULL DEFAULT 0,
  conversions integer NOT NULL DEFAULT 0,
  total_earned numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, referrer_user_id)
);

CREATE INDEX IF NOT EXISTS idx_kr_event ON public.kickback_referrals (event_id);
CREATE INDEX IF NOT EXISTS idx_kr_referrer ON public.kickback_referrals (referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_kr_code ON public.kickback_referrals (referral_code);

ALTER TABLE public.kickback_referrals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "kr_referrer_read" ON public.kickback_referrals FOR SELECT TO authenticated
    USING (auth.uid() = referrer_user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "kr_creator_read" ON public.kickback_referrals FOR SELECT TO authenticated
    USING (event_id IN (SELECT id FROM public.events WHERE creator_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "kr_service_role" ON public.kickback_referrals FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
