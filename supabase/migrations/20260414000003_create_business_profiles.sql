CREATE TABLE IF NOT EXISTS public.business_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_account_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  place_pool_id uuid UNIQUE REFERENCES public.place_pool(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending_review')),
  description text,
  hours_override jsonb,
  contact_email text,
  contact_phone text,
  subscription_tier text NOT NULL DEFAULT 'free' CHECK (subscription_tier IN ('free', 'growth', 'pro')),
  stripe_account_id text,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_profiles_creator
  ON public.business_profiles (creator_account_id);

ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "bp_owner_select" ON public.business_profiles
    FOR SELECT TO authenticated
    USING (auth.uid() = creator_account_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "bp_owner_insert" ON public.business_profiles
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = creator_account_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "bp_owner_update" ON public.business_profiles
    FOR UPDATE TO authenticated
    USING (auth.uid() = creator_account_id)
    WITH CHECK (auth.uid() = creator_account_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "bp_owner_delete" ON public.business_profiles
    FOR DELETE TO authenticated
    USING (auth.uid() = creator_account_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "bp_public_read" ON public.business_profiles
    FOR SELECT TO authenticated
    USING (status = 'active');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "bp_service_role" ON public.business_profiles
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS trg_business_profiles_updated_at ON public.business_profiles;
CREATE TRIGGER trg_business_profiles_updated_at
  BEFORE UPDATE ON public.business_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
