-- Mingla Business: creator-facing app account row (1:1 with auth.users).
-- Consumer app uses public.profiles; creators get this table for business-specific fields.

CREATE TABLE IF NOT EXISTS public.creator_accounts (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text,
  display_name text,
  avatar_url text,
  business_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_creator_accounts_email_lower ON public.creator_accounts (lower(email));

ALTER TABLE public.creator_accounts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "Creators can read own account"
    ON public.creator_accounts
    FOR SELECT
    TO authenticated
    USING (auth.uid() = id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Creators can insert own account"
    ON public.creator_accounts
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "Creators can update own account"
    ON public.creator_accounts
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_creator_accounts_updated_at ON public.creator_accounts;
CREATE TRIGGER trg_creator_accounts_updated_at
  BEFORE UPDATE ON public.creator_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.creator_accounts IS 'Business/creator app profile; keyed by auth.users.id.';
