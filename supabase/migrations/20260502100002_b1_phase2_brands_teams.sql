-- Cycle B1 Phase 2 — Brands & teams (BUSINESS_PROJECT_PLAN §B.2).
-- Tables: brands, brand_team_members, brand_invitations + RLS helpers.

CREATE TABLE IF NOT EXISTS public.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.creator_accounts (id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  profile_photo_url text,
  contact_email text,
  contact_phone text,
  social_links jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  display_attendee_count boolean NOT NULL DEFAULT false,
  tax_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_currency char(3) NOT NULL DEFAULT 'GBP',
  stripe_connect_id text,
  stripe_payouts_enabled boolean NOT NULL DEFAULT false,
  stripe_charges_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT brands_slug_nonempty CHECK (length(trim(slug)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_slug_active
  ON public.brands (lower(slug))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_brands_account_id
  ON public.brands (account_id)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_brands_updated_at ON public.brands;
CREATE TRIGGER trg_brands_updated_at
  BEFORE UPDATE ON public.brands
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.biz_prevent_brand_account_id_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION 'brands.account_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_brands_immutable_account_id ON public.brands;
CREATE TRIGGER trg_brands_immutable_account_id
  BEFORE UPDATE ON public.brands
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_prevent_brand_account_id_change();

COMMENT ON TABLE public.brands IS 'Mingla Business organiser brand (B1 §B.2).';

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.brand_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL
    CONSTRAINT brand_team_members_role_check
      CHECK (
        role IN (
          'account_owner',
          'brand_admin',
          'event_manager',
          'finance_manager',
          'marketing_manager',
          'scanner'
        )
      ),
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  removed_at timestamptz,
  permissions_override jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT brand_team_members_accepted_removed_excl
    CHECK (removed_at IS NULL OR accepted_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_team_members_brand_user_active
  ON public.brand_team_members (brand_id, user_id)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_brand_team_members_user_id
  ON public.brand_team_members (user_id)
  WHERE removed_at IS NULL;

COMMENT ON TABLE public.brand_team_members IS 'Brand membership and roles (B1 §B.2).';

ALTER TABLE public.brand_team_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.brand_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL
    CONSTRAINT brand_invitations_role_check
      CHECK (
        role IN (
          'account_owner',
          'brand_admin',
          'event_manager',
          'finance_manager',
          'marketing_manager',
          'scanner'
        )
      ),
  invited_by uuid NOT NULL REFERENCES auth.users (id),
  token text NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  CONSTRAINT brand_invitations_email_nonempty CHECK (length(trim(email)) > 0),
  CONSTRAINT brand_invitations_token_nonempty CHECK (length(trim(token)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_invitations_token
  ON public.brand_invitations (token);

CREATE INDEX IF NOT EXISTS idx_brand_invitations_brand_id
  ON public.brand_invitations (brand_id);

COMMENT ON TABLE public.brand_invitations IS 'Pending brand team invites (B1 §B.2).';

ALTER TABLE public.brand_invitations ENABLE ROW LEVEL SECURITY;

-- Link creator default brand (nullable).
ALTER TABLE public.creator_accounts
  ADD COLUMN IF NOT EXISTS default_brand_id uuid REFERENCES public.brands (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_creator_accounts_default_brand_id
  ON public.creator_accounts (default_brand_id)
  WHERE default_brand_id IS NOT NULL;

COMMENT ON COLUMN public.creator_accounts.default_brand_id IS 'Optional default brand for UI (B1 §B.1).';

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER helpers (fixed search_path; no RLS recursion in policies).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.biz_brand_effective_rank(p_brand_id uuid, p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.brands b
        WHERE b.id = p_brand_id
          AND b.account_id = p_user_id
          AND b.deleted_at IS NULL
      )
      THEN public.biz_role_rank('account_owner'::text)
      ELSE 0
    END,
    COALESCE(
      (
        SELECT max(public.biz_role_rank(m.role))
        FROM public.brand_team_members m
        WHERE m.brand_id = p_brand_id
          AND m.user_id = p_user_id
          AND m.removed_at IS NULL
          AND m.accepted_at IS NOT NULL
      ),
      0
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.biz_is_brand_member_for_read(p_brand_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.biz_brand_effective_rank(p_brand_id, p_user_id) > 0;
$$;

CREATE OR REPLACE FUNCTION public.biz_is_brand_admin_plus(p_brand_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.biz_brand_effective_rank(p_brand_id, p_user_id)
    >= public.biz_role_rank('brand_admin'::text);
$$;

-- ---------------------------------------------------------------------------
-- RLS: brands
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Brand members can select brands" ON public.brands;
CREATE POLICY "Brand members can select brands"
  ON public.brands
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND public.biz_is_brand_member_for_read(id, auth.uid())
  );

DROP POLICY IF EXISTS "Account owner can insert brand" ON public.brands;
CREATE POLICY "Account owner can insert brand"
  ON public.brands
  FOR INSERT
  TO authenticated
  WITH CHECK (
    account_id = auth.uid()
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS "Brand admin plus can update brands" ON public.brands;
CREATE POLICY "Brand admin plus can update brands"
  ON public.brands
  FOR UPDATE
  TO authenticated
  USING (public.biz_is_brand_admin_plus(id, auth.uid()))
  WITH CHECK (public.biz_is_brand_admin_plus(id, auth.uid()));

DROP POLICY IF EXISTS "Brand admin plus can delete brands" ON public.brands;
CREATE POLICY "Brand admin plus can delete brands"
  ON public.brands
  FOR DELETE
  TO authenticated
  USING (public.biz_is_brand_admin_plus(id, auth.uid()));

-- ---------------------------------------------------------------------------
-- RLS: brand_team_members (admin manages; users see self)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Members and admins read brand_team_members" ON public.brand_team_members;
CREATE POLICY "Members and admins read brand_team_members"
  ON public.brand_team_members
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.biz_is_brand_admin_plus(brand_id, auth.uid())
  );

DROP POLICY IF EXISTS "Brand admin plus insert brand_team_members" ON public.brand_team_members;
CREATE POLICY "Brand admin plus insert brand_team_members"
  ON public.brand_team_members
  FOR INSERT
  TO authenticated
  WITH CHECK (public.biz_is_brand_admin_plus(brand_id, auth.uid()));

DROP POLICY IF EXISTS "Brand admin plus update brand_team_members" ON public.brand_team_members;
CREATE POLICY "Brand admin plus update brand_team_members"
  ON public.brand_team_members
  FOR UPDATE
  TO authenticated
  USING (public.biz_is_brand_admin_plus(brand_id, auth.uid()))
  WITH CHECK (public.biz_is_brand_admin_plus(brand_id, auth.uid()));

DROP POLICY IF EXISTS "Brand admin plus delete brand_team_members" ON public.brand_team_members;
CREATE POLICY "Brand admin plus delete brand_team_members"
  ON public.brand_team_members
  FOR DELETE
  TO authenticated
  USING (public.biz_is_brand_admin_plus(brand_id, auth.uid()));

-- ---------------------------------------------------------------------------
-- RLS: brand_invitations (brand admin only)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Brand admin plus select invitations" ON public.brand_invitations;
CREATE POLICY "Brand admin plus select invitations"
  ON public.brand_invitations
  FOR SELECT
  TO authenticated
  USING (public.biz_is_brand_admin_plus(brand_id, auth.uid()));

DROP POLICY IF EXISTS "Brand admin plus insert invitations" ON public.brand_invitations;
CREATE POLICY "Brand admin plus insert invitations"
  ON public.brand_invitations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.biz_is_brand_admin_plus(brand_id, auth.uid())
    AND invited_by = auth.uid()
  );

DROP POLICY IF EXISTS "Brand admin plus update invitations" ON public.brand_invitations;
CREATE POLICY "Brand admin plus update invitations"
  ON public.brand_invitations
  FOR UPDATE
  TO authenticated
  USING (public.biz_is_brand_admin_plus(brand_id, auth.uid()))
  WITH CHECK (public.biz_is_brand_admin_plus(brand_id, auth.uid()));

DROP POLICY IF EXISTS "Brand admin plus delete invitations" ON public.brand_invitations;
CREATE POLICY "Brand admin plus delete invitations"
  ON public.brand_invitations
  FOR DELETE
  TO authenticated
  USING (public.biz_is_brand_admin_plus(brand_id, auth.uid()));
