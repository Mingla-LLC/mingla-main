-- Cycle B1 — Mingla Business schema + RLS (BUSINESS_PROJECT_PLAN §B.1–§B.8).
-- Single migration: accounts, brands, events, tickets, orders, scanners, audit, payments, public views.


-- =====================================================================
-- 20260502100000_b1_phase0_business_rls_foundation.sql
-- =====================================================================
-- Cycle B1 Phase 0 — Business schema RLS foundation (no business tables yet).
-- Pure helpers used by policies in later phases. IMMUTABLE rank for role checks.

CREATE OR REPLACE FUNCTION public.biz_role_rank(p_role text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE trim(lower(coalesce(p_role, '')))
    WHEN 'scanner' THEN 10
    WHEN 'marketing_manager' THEN 20
    WHEN 'finance_manager' THEN 30
    WHEN 'event_manager' THEN 40
    WHEN 'brand_admin' THEN 50
    WHEN 'account_owner' THEN 60
    ELSE 0
  END;
$$;

COMMENT ON FUNCTION public.biz_role_rank(text) IS
  'Cycle B1: numeric rank for brand_team_members.role comparisons (higher = more privilege).';

-- =====================================================================
-- 20260502100001_b1_phase1_accounts_identity.sql
-- =====================================================================
-- Cycle B1 Phase 1 — Accounts & identity (BUSINESS_PROJECT_PLAN §B.1).
-- Extends creator_accounts; adds account_deletion_requests (edge/service-role writes only).

ALTER TABLE public.creator_accounts
  ADD COLUMN IF NOT EXISTS phone_e164 text,
  ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.creator_accounts.phone_e164 IS 'E.164 phone for organiser contact (B1).';
COMMENT ON COLUMN public.creator_accounts.marketing_opt_in IS 'Marketing opt-in (B1).';
COMMENT ON COLUMN public.creator_accounts.deleted_at IS 'Soft-delete timestamp for creator account (B1).';

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  scheduled_hard_delete_at timestamptz,
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT account_deletion_requests_status_check
      CHECK (status IN ('pending', 'cancelled', 'completed')),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_user_id
  ON public.account_deletion_requests (user_id);

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_status
  ON public.account_deletion_requests (status);

COMMENT ON TABLE public.account_deletion_requests IS
  'Account deletion pipeline; rows inserted/updated by service role (edge) only (B1 §B.1).';

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

-- Owner can read own deletion requests; no direct client writes (service role bypasses RLS).
DROP POLICY IF EXISTS "Account owner can read own deletion requests"
  ON public.account_deletion_requests;

CREATE POLICY "Account owner can read own deletion requests"
  ON public.account_deletion_requests
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- =====================================================================
-- 20260502100002_b1_phase2_brands_teams.sql
-- =====================================================================
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

-- =====================================================================
-- 20260502100003_b1_phase3_events.sql
-- =====================================================================
-- Cycle B1 Phase 3 — Events (BUSINESS_PROJECT_PLAN §B.3).
-- Tables: events, event_dates. Distinct from consumer experiences.

CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users (id),
  title text NOT NULL,
  description text,
  slug text NOT NULL,
  location_text text,
  location_geo point,
  online_url text,
  is_online boolean NOT NULL DEFAULT false,
  is_recurring boolean NOT NULL DEFAULT false,
  is_multi_date boolean NOT NULL DEFAULT false,
  recurrence_rules jsonb,
  cover_media_url text,
  cover_media_type text
    CONSTRAINT events_cover_media_type_check
      CHECK (cover_media_type IS NULL OR cover_media_type IN ('image', 'video', 'gif')),
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  organiser_contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  visibility text NOT NULL DEFAULT 'draft'
    CONSTRAINT events_visibility_check
      CHECK (visibility IN ('public', 'discover', 'private', 'hidden', 'draft')),
  show_on_discover boolean NOT NULL DEFAULT false,
  show_in_swipeable_deck boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft'
    CONSTRAINT events_status_check
      CHECK (status IN ('draft', 'scheduled', 'live', 'ended', 'cancelled')),
  published_at timestamptz,
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT events_slug_nonempty CHECK (length(trim(slug)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_brand_slug_active
  ON public.events (brand_id, lower(slug))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_brand_id
  ON public.events (brand_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_brand_status
  ON public.events (brand_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_published_at
  ON public.events (published_at)
  WHERE deleted_at IS NULL AND published_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_events_updated_at ON public.events;
CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.biz_prevent_event_brand_id_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.brand_id IS DISTINCT FROM OLD.brand_id THEN
    RAISE EXCEPTION 'events.brand_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_immutable_brand_id ON public.events;
CREATE TRIGGER trg_events_immutable_brand_id
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_prevent_event_brand_id_change();

COMMENT ON TABLE public.events IS 'Mingla Business event (B1 §B.3). Not consumer experiences.';

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.event_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  is_master boolean NOT NULL DEFAULT false,
  override_title text,
  override_description text,
  override_location text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_dates_end_after_start CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS idx_event_dates_event_id ON public.event_dates (event_id);
CREATE INDEX IF NOT EXISTS idx_event_dates_start_at ON public.event_dates (start_at);

DROP TRIGGER IF EXISTS trg_event_dates_updated_at ON public.event_dates;
CREATE TRIGGER trg_event_dates_updated_at
  BEFORE UPDATE ON public.event_dates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.biz_prevent_event_dates_event_id_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
    RAISE EXCEPTION 'event_dates.event_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_dates_immutable_event_id ON public.event_dates;
CREATE TRIGGER trg_event_dates_immutable_event_id
  BEFORE UPDATE ON public.event_dates
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_prevent_event_dates_event_id_change();

COMMENT ON TABLE public.event_dates IS 'Per-date rows for multi-date / recurring events (B1 §B.3).';

ALTER TABLE public.event_dates ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER; avoid RLS recursion)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.biz_event_brand_id(p_event_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.brand_id
  FROM public.events e
  WHERE e.id = p_event_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.biz_is_event_manager_plus(p_event_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.biz_brand_effective_rank(public.biz_event_brand_id(p_event_id), p_user_id)
    >= public.biz_role_rank('event_manager'::text);
$$;

-- ---------------------------------------------------------------------------
-- RLS: events (team read; event_manager+ write)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Brand team can select events" ON public.events;
CREATE POLICY "Brand team can select events"
  ON public.events
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND public.biz_is_brand_member_for_read(brand_id, auth.uid())
  );

DROP POLICY IF EXISTS "Event manager plus can insert events" ON public.events;
CREATE POLICY "Event manager plus can insert events"
  ON public.events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    deleted_at IS NULL
    AND created_by = auth.uid()
    AND public.biz_brand_effective_rank(brand_id, auth.uid())
      >= public.biz_role_rank('event_manager'::text)
  );

DROP POLICY IF EXISTS "Event manager plus can update events" ON public.events;
CREATE POLICY "Event manager plus can update events"
  ON public.events
  FOR UPDATE
  TO authenticated
  USING (
    public.biz_brand_effective_rank(brand_id, auth.uid())
      >= public.biz_role_rank('event_manager'::text)
  )
  WITH CHECK (
    public.biz_brand_effective_rank(brand_id, auth.uid())
      >= public.biz_role_rank('event_manager'::text)
  );

DROP POLICY IF EXISTS "Event manager plus can delete events" ON public.events;
CREATE POLICY "Event manager plus can delete events"
  ON public.events
  FOR DELETE
  TO authenticated
  USING (
    public.biz_brand_effective_rank(brand_id, auth.uid())
      >= public.biz_role_rank('event_manager'::text)
  );

-- ---------------------------------------------------------------------------
-- RLS: event_dates (inherit event access)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Brand team can select event_dates" ON public.event_dates;
CREATE POLICY "Brand team can select event_dates"
  ON public.event_dates
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_dates.event_id
        AND e.deleted_at IS NULL
        AND public.biz_is_brand_member_for_read(e.brand_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Event manager plus can insert event_dates" ON public.event_dates;
CREATE POLICY "Event manager plus can insert event_dates"
  ON public.event_dates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.biz_is_event_manager_plus(event_id, auth.uid())
  );

DROP POLICY IF EXISTS "Event manager plus can update event_dates" ON public.event_dates;
CREATE POLICY "Event manager plus can update event_dates"
  ON public.event_dates
  FOR UPDATE
  TO authenticated
  USING (public.biz_is_event_manager_plus(event_id, auth.uid()))
  WITH CHECK (public.biz_is_event_manager_plus(event_id, auth.uid()));

DROP POLICY IF EXISTS "Event manager plus can delete event_dates" ON public.event_dates;
CREATE POLICY "Event manager plus can delete event_dates"
  ON public.event_dates
  FOR DELETE
  TO authenticated
  USING (public.biz_is_event_manager_plus(event_id, auth.uid()));

-- =====================================================================
-- 20260502100004_b1_phase4_ticket_types_waitlist.sql
-- =====================================================================
-- Cycle B1 Phase 4a — Ticket catalog + waitlist (BUSINESS_PROJECT_PLAN §B.4).
-- Ticket types + waitlist (issued tickets defined later in this migration).

CREATE TABLE IF NOT EXISTS public.ticket_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price_cents integer NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'GBP',
  quantity_total integer,
  is_unlimited boolean NOT NULL DEFAULT false,
  is_free boolean NOT NULL DEFAULT false,
  sale_start_at timestamptz,
  sale_end_at timestamptz,
  validity_start_at timestamptz,
  validity_end_at timestamptz,
  min_purchase_qty integer NOT NULL DEFAULT 1,
  max_purchase_qty integer,
  is_hidden boolean NOT NULL DEFAULT false,
  is_disabled boolean NOT NULL DEFAULT false,
  requires_approval boolean NOT NULL DEFAULT false,
  allow_transfers boolean NOT NULL DEFAULT false,
  password_protected boolean NOT NULL DEFAULT false,
  password_hash text,
  available_online boolean NOT NULL DEFAULT true,
  available_in_person boolean NOT NULL DEFAULT true,
  waitlist_enabled boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT ticket_types_name_nonempty CHECK (length(trim(name)) > 0),
  CONSTRAINT ticket_types_price_non_negative CHECK (price_cents >= 0),
  CONSTRAINT ticket_types_qty_positive CHECK (quantity_total IS NULL OR quantity_total > 0),
  CONSTRAINT ticket_types_min_max_qty CHECK (
    max_purchase_qty IS NULL OR max_purchase_qty >= min_purchase_qty
  )
);

CREATE INDEX IF NOT EXISTS idx_ticket_types_event_id
  ON public.ticket_types (event_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_types_event_display
  ON public.ticket_types (event_id, display_order)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_ticket_types_updated_at ON public.ticket_types;
CREATE TRIGGER trg_ticket_types_updated_at
  BEFORE UPDATE ON public.ticket_types
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.ticket_types IS 'Sellable ticket products for an event (B1 §B.4).';

ALTER TABLE public.ticket_types ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types (id) ON DELETE CASCADE,
  email text NOT NULL,
  phone text,
  name text,
  status text NOT NULL DEFAULT 'waiting'
    CONSTRAINT waitlist_entries_status_check
      CHECK (status IN ('waiting', 'invited', 'converted', 'expired')),
  invited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waitlist_entries_email_nonempty CHECK (length(trim(email)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_entries_event_id ON public.waitlist_entries (event_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_entries_ticket_type_id ON public.waitlist_entries (ticket_type_id);

COMMENT ON TABLE public.waitlist_entries IS 'Waitlist; client writes via service role only (B1 §B.4).';

ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;

-- RLS ticket_types: team read; finance_manager+ write
DROP POLICY IF EXISTS "Brand team can select ticket_types" ON public.ticket_types;
CREATE POLICY "Brand team can select ticket_types"
  ON public.ticket_types
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = ticket_types.event_id
        AND e.deleted_at IS NULL
        AND public.biz_is_brand_member_for_read(e.brand_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Finance or event manager can insert ticket_types" ON public.ticket_types;
DROP POLICY IF EXISTS "Brand finance_manager rank or above can insert ticket_types" ON public.ticket_types;
CREATE POLICY "Brand finance_manager rank or above can insert ticket_types"
  ON public.ticket_types
  FOR INSERT
  TO authenticated
  WITH CHECK (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = ticket_types.event_id
        AND e.deleted_at IS NULL
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
          >= public.biz_role_rank('finance_manager'::text)
    )
  );

DROP POLICY IF EXISTS "Finance or event manager can update ticket_types" ON public.ticket_types;
DROP POLICY IF EXISTS "Brand finance_manager rank or above can update ticket_types" ON public.ticket_types;
CREATE POLICY "Brand finance_manager rank or above can update ticket_types"
  ON public.ticket_types
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = ticket_types.event_id
        AND e.deleted_at IS NULL
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
          >= public.biz_role_rank('finance_manager'::text)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = ticket_types.event_id
        AND e.deleted_at IS NULL
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
          >= public.biz_role_rank('finance_manager'::text)
    )
  );

DROP POLICY IF EXISTS "Finance or event manager can delete ticket_types" ON public.ticket_types;
DROP POLICY IF EXISTS "Brand finance_manager rank or above can delete ticket_types" ON public.ticket_types;
CREATE POLICY "Brand finance_manager rank or above can delete ticket_types"
  ON public.ticket_types
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = ticket_types.event_id
        AND e.deleted_at IS NULL
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
          >= public.biz_role_rank('finance_manager'::text)
    )
  );

-- waitlist: brand team read only (writes = service role)
DROP POLICY IF EXISTS "Brand team can select waitlist_entries" ON public.waitlist_entries;
CREATE POLICY "Brand team can select waitlist_entries"
  ON public.waitlist_entries
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = waitlist_entries.event_id
        AND e.deleted_at IS NULL
        AND public.biz_is_brand_member_for_read(e.brand_id, auth.uid())
    )
  );

-- =====================================================================
-- 20260502100005_b1_phase5_orders.sql
-- =====================================================================
-- Cycle B1 Phase 5 — Orders + line items (BUSINESS_PROJECT_PLAN §B.4).
-- Orders + line items (tickets table follows event_scanners in this migration).

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  buyer_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  buyer_email text,
  buyer_name text,
  buyer_phone text,
  total_cents integer NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'GBP',
  payment_method text NOT NULL DEFAULT 'online_card'
    CONSTRAINT orders_payment_method_check
      CHECK (
        payment_method IN (
          'online_card',
          'nfc',
          'card_reader',
          'cash',
          'manual'
        )
      ),
  payment_status text NOT NULL DEFAULT 'pending'
    CONSTRAINT orders_payment_status_check
      CHECK (
        payment_status IN (
          'pending',
          'paid',
          'failed',
          'refunded',
          'partial_refund'
        )
      ),
  stripe_payment_intent_id text,
  stripe_charge_id text,
  is_door_sale boolean NOT NULL DEFAULT false,
  created_by_scanner_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_total_non_negative CHECK (total_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_orders_event_id ON public.orders (event_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_user_id ON public.orders (buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders (payment_status);

DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.orders IS 'Ticket / door orders (B1 §B.4).';
COMMENT ON COLUMN public.orders.created_by_scanner_id IS 'Scanner auth user who recorded a door sale (B1); FK to auth.users below.';

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.order_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types (id) ON DELETE RESTRICT,
  quantity integer NOT NULL DEFAULT 1,
  unit_price_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL DEFAULT 0,
  CONSTRAINT order_line_items_qty_positive CHECK (quantity > 0),
  CONSTRAINT order_line_items_prices_non_negative CHECK (
    unit_price_cents >= 0 AND total_cents >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_order_line_items_order_id ON public.order_line_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_line_items_ticket_type_id ON public.order_line_items (ticket_type_id);

COMMENT ON TABLE public.order_line_items IS 'Line items for an order (B1 §B.4).';

ALTER TABLE public.order_line_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.biz_can_read_order(p_order_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.events e ON e.id = o.event_id
    WHERE o.id = p_order_id
      AND e.deleted_at IS NULL
      AND (
        o.buyer_user_id IS NOT DISTINCT FROM p_user_id
        OR public.biz_is_brand_member_for_read(e.brand_id, p_user_id)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.biz_can_manage_orders_for_event(p_event_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.biz_brand_effective_rank(
    public.biz_event_brand_id(p_event_id),
    p_user_id
  ) >= public.biz_role_rank('finance_manager'::text);
$$;

-- orders RLS
DROP POLICY IF EXISTS "Buyer or brand team can select orders" ON public.orders;
CREATE POLICY "Buyer or brand team can select orders"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (public.biz_can_read_order(id, auth.uid()));

DROP POLICY IF EXISTS "Finance plus can insert orders" ON public.orders;
CREATE POLICY "Finance plus can insert orders"
  ON public.orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.biz_can_manage_orders_for_event(event_id, auth.uid())
  );

DROP POLICY IF EXISTS "Finance plus can update orders" ON public.orders;
CREATE POLICY "Finance plus can update orders"
  ON public.orders
  FOR UPDATE
  TO authenticated
  USING (public.biz_can_manage_orders_for_event(event_id, auth.uid()))
  WITH CHECK (public.biz_can_manage_orders_for_event(event_id, auth.uid()));

DROP POLICY IF EXISTS "Finance plus can delete orders" ON public.orders;
CREATE POLICY "Finance plus can delete orders"
  ON public.orders
  FOR DELETE
  TO authenticated
  USING (public.biz_can_manage_orders_for_event(event_id, auth.uid()));

-- order_line_items RLS (inherit order access)
DROP POLICY IF EXISTS "Order parties can select line items" ON public.order_line_items;
CREATE POLICY "Order parties can select line items"
  ON public.order_line_items
  FOR SELECT
  TO authenticated
  USING (public.biz_can_read_order(order_id, auth.uid()));

DROP POLICY IF EXISTS "Finance plus can insert line items" ON public.order_line_items;
CREATE POLICY "Finance plus can insert line items"
  ON public.order_line_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_line_items.order_id
        AND public.biz_can_manage_orders_for_event(o.event_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Finance plus can update line items" ON public.order_line_items;
CREATE POLICY "Finance plus can update line items"
  ON public.order_line_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_line_items.order_id
        AND public.biz_can_manage_orders_for_event(o.event_id, auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_line_items.order_id
        AND public.biz_can_manage_orders_for_event(o.event_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Finance plus can delete line items" ON public.order_line_items;
CREATE POLICY "Finance plus can delete line items"
  ON public.order_line_items
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_line_items.order_id
        AND public.biz_can_manage_orders_for_event(o.event_id, auth.uid())
    )
  );

-- =====================================================================
-- 20260502100006_b1_phase6_scanners_tickets.sql
-- =====================================================================
-- Cycle B1 Phase 6 — Scanners, scan audit, issued tickets (BUSINESS_PROJECT_PLAN §B.4–§B.5).

CREATE TABLE IF NOT EXISTS public.scanner_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  email text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '{"scan": true, "take_payments": false}'::jsonb,
  token text NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  CONSTRAINT scanner_invitations_email_nonempty CHECK (length(trim(email)) > 0),
  CONSTRAINT scanner_invitations_token_nonempty CHECK (length(trim(token)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scanner_invitations_token ON public.scanner_invitations (token);
CREATE INDEX IF NOT EXISTS idx_scanner_invitations_event_id ON public.scanner_invitations (event_id);

COMMENT ON TABLE public.scanner_invitations IS 'Invite flow for event scanners (B1 §B.5).';

ALTER TABLE public.scanner_invitations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.event_scanners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  permissions jsonb NOT NULL DEFAULT '{"scan": true, "take_payments": false}'::jsonb,
  assigned_by uuid NOT NULL REFERENCES auth.users (id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_scanners_event_user_active
  ON public.event_scanners (event_id, user_id)
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_event_scanners_user_id ON public.event_scanners (user_id);

COMMENT ON TABLE public.event_scanners IS 'Scanner role assignments per event (B1 §B.5).';

ALTER TABLE public.event_scanners ENABLE ROW LEVEL SECURITY;

-- Orders: optional link to scanner user who created a door sale.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_created_by_scanner_user_fkey;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_created_by_scanner_user_fkey
  FOREIGN KEY (created_by_scanner_id)
  REFERENCES auth.users (id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types (id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  attendee_name text,
  attendee_email text,
  attendee_phone text,
  qr_code text NOT NULL,
  status text NOT NULL DEFAULT 'valid'
    CONSTRAINT tickets_status_check
      CHECK (status IN ('valid', 'used', 'void', 'transferred', 'refunded')),
  transferred_to_email text,
  transferred_at timestamptz,
  approval_status text NOT NULL DEFAULT 'auto'
    CONSTRAINT tickets_approval_status_check
      CHECK (approval_status IN ('auto', 'pending', 'approved', 'rejected')),
  approval_decided_by uuid REFERENCES auth.users (id),
  approval_decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  used_by_scanner_id uuid REFERENCES auth.users (id),
  CONSTRAINT tickets_qr_nonempty CHECK (length(trim(qr_code)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_qr_code ON public.tickets (qr_code);
CREATE INDEX IF NOT EXISTS idx_tickets_order_id ON public.tickets (order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_event_id ON public.tickets (event_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON public.tickets (status);

COMMENT ON TABLE public.tickets IS 'Issued attendee tickets; issuance via service role (B1 §B.4).';

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.scan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets (id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  scanner_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  scan_result text NOT NULL
    CONSTRAINT scan_events_result_check
      CHECK (
        scan_result IN (
          'success',
          'duplicate',
          'not_found',
          'wrong_event',
          'void'
        )
      ),
  scanned_at timestamptz NOT NULL DEFAULT now(),
  client_offline boolean NOT NULL DEFAULT false,
  synced_at timestamptz,
  device_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_scan_events_ticket_id ON public.scan_events (ticket_id);
CREATE INDEX IF NOT EXISTS idx_scan_events_event_id ON public.scan_events (event_id);
CREATE INDEX IF NOT EXISTS idx_scan_events_scanned_at ON public.scan_events (scanned_at);

COMMENT ON TABLE public.scan_events IS 'Append-only scan audit trail (B1 §B.5).';

ALTER TABLE public.scan_events ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Trigger: scanners may only mutate check-in columns; finance+ bypasses.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.biz_tickets_enforce_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_brand uuid;
  v_is_team boolean;
  v_is_scanner boolean;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  v_brand := public.biz_event_brand_id(OLD.event_id);
  v_is_team :=
    public.biz_is_brand_member_for_read(v_brand, auth.uid())
    AND public.biz_brand_effective_rank(v_brand, auth.uid())
      >= public.biz_role_rank('finance_manager'::text);

  v_is_scanner := EXISTS (
    SELECT 1
    FROM public.event_scanners es
    WHERE es.event_id = OLD.event_id
      AND es.user_id = auth.uid()
      AND es.removed_at IS NULL
      AND COALESCE((es.permissions ->> 'scan')::boolean, true)
  );

  IF v_is_team THEN
    RETURN NEW;
  END IF;

  IF v_is_scanner THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.order_id IS DISTINCT FROM OLD.order_id
      OR NEW.ticket_type_id IS DISTINCT FROM OLD.ticket_type_id
      OR NEW.event_id IS DISTINCT FROM OLD.event_id
      OR NEW.attendee_name IS DISTINCT FROM OLD.attendee_name
      OR NEW.attendee_email IS DISTINCT FROM OLD.attendee_email
      OR NEW.attendee_phone IS DISTINCT FROM OLD.attendee_phone
      OR NEW.qr_code IS DISTINCT FROM OLD.qr_code
      OR NEW.transferred_to_email IS DISTINCT FROM OLD.transferred_to_email
      OR NEW.transferred_at IS DISTINCT FROM OLD.transferred_at
      OR NEW.approval_status IS DISTINCT FROM OLD.approval_status
      OR NEW.approval_decided_by IS DISTINCT FROM OLD.approval_decided_by
      OR NEW.approval_decided_at IS DISTINCT FROM OLD.approval_decided_at
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Scanners may only update check-in fields on tickets';
    END IF;

    -- Check-in: valid -> used — bind scanner identity and timestamp (Copilot review).
    IF OLD.status = 'valid' AND NEW.status = 'used' THEN
      IF NEW.used_by_scanner_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'used_by_scanner_id must equal the scanning user';
      END IF;
      IF NEW.used_at IS NULL THEN
        NEW.used_at := now();
      ELSIF NEW.used_at > now() + interval '2 minutes' THEN
        RAISE EXCEPTION 'used_at cannot be more than 2 minutes in the future';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
      OR NEW.used_at IS DISTINCT FROM OLD.used_at
      OR NEW.used_by_scanner_id IS DISTINCT FROM OLD.used_by_scanner_id
    THEN
      RAISE EXCEPTION 'Invalid ticket update for scanner role';
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Not authorized to update ticket';
END;
$$;

DROP TRIGGER IF EXISTS trg_tickets_enforce_update ON public.tickets;
CREATE TRIGGER trg_tickets_enforce_update
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_tickets_enforce_update();

CREATE OR REPLACE FUNCTION public.biz_scan_events_block_mutate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'scan_events is append-only for clients';
END;
$$;

DROP TRIGGER IF EXISTS trg_scan_events_block_update ON public.scan_events;
CREATE TRIGGER trg_scan_events_block_update
  BEFORE UPDATE OR DELETE ON public.scan_events
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_scan_events_block_mutate();

-- ---------------------------------------------------------------------------
-- RLS: scanner_invitations (event_manager+)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Event manager plus can manage scanner_invitations" ON public.scanner_invitations;
CREATE POLICY "Event manager plus can manage scanner_invitations"
  ON public.scanner_invitations
  FOR ALL
  TO authenticated
  USING (public.biz_is_event_manager_plus(event_id, auth.uid()))
  WITH CHECK (public.biz_is_event_manager_plus(event_id, auth.uid()));

-- ---------------------------------------------------------------------------
-- RLS: event_scanners
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Scanners and managers read event_scanners" ON public.event_scanners;
CREATE POLICY "Scanners and managers read event_scanners"
  ON public.event_scanners
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.biz_is_event_manager_plus(event_id, auth.uid())
  );

DROP POLICY IF EXISTS "Event manager plus insert event_scanners" ON public.event_scanners;
CREATE POLICY "Event manager plus insert event_scanners"
  ON public.event_scanners
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.biz_is_event_manager_plus(event_id, auth.uid())
    AND assigned_by = auth.uid()
  );

DROP POLICY IF EXISTS "Event manager plus update event_scanners" ON public.event_scanners;
CREATE POLICY "Event manager plus update event_scanners"
  ON public.event_scanners
  FOR UPDATE
  TO authenticated
  USING (public.biz_is_event_manager_plus(event_id, auth.uid()))
  WITH CHECK (public.biz_is_event_manager_plus(event_id, auth.uid()));

DROP POLICY IF EXISTS "Event manager plus delete event_scanners" ON public.event_scanners;
CREATE POLICY "Event manager plus delete event_scanners"
  ON public.event_scanners
  FOR DELETE
  TO authenticated
  USING (public.biz_is_event_manager_plus(event_id, auth.uid()));

-- ---------------------------------------------------------------------------
-- RLS: tickets
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Buyer or brand team can select tickets" ON public.tickets;
CREATE POLICY "Buyer or brand team can select tickets"
  ON public.tickets
  FOR SELECT
  TO authenticated
  USING (
    public.biz_is_brand_member_for_read(
      public.biz_event_brand_id(event_id),
      auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = tickets.order_id
        AND o.buyer_user_id IS NOT DISTINCT FROM auth.uid()
    )
  );

DROP POLICY IF EXISTS "Finance plus can update tickets" ON public.tickets;
CREATE POLICY "Finance plus can update tickets"
  ON public.tickets
  FOR UPDATE
  TO authenticated
  USING (
    public.biz_brand_effective_rank(
      public.biz_event_brand_id(event_id),
      auth.uid()
    ) >= public.biz_role_rank('finance_manager'::text)
  )
  WITH CHECK (
    public.biz_brand_effective_rank(
      public.biz_event_brand_id(event_id),
      auth.uid()
    ) >= public.biz_role_rank('finance_manager'::text)
  );

DROP POLICY IF EXISTS "Scanners can update tickets for check-in" ON public.tickets;
CREATE POLICY "Scanners can update tickets for check-in"
  ON public.tickets
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_scanners es
      WHERE es.event_id = tickets.event_id
        AND es.user_id = auth.uid()
        AND es.removed_at IS NULL
        AND COALESCE((es.permissions ->> 'scan')::boolean, true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.event_scanners es
      WHERE es.event_id = tickets.event_id
        AND es.user_id = auth.uid()
        AND es.removed_at IS NULL
        AND COALESCE((es.permissions ->> 'scan')::boolean, true)
    )
  );

-- ---------------------------------------------------------------------------
-- RLS: scan_events (team read; scanner inserts own rows)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Brand team can select scan_events" ON public.scan_events;
CREATE POLICY "Brand team can select scan_events"
  ON public.scan_events
  FOR SELECT
  TO authenticated
  USING (
    public.biz_is_brand_member_for_read(
      public.biz_event_brand_id(event_id),
      auth.uid()
    )
  );

DROP POLICY IF EXISTS "Scanners insert own scan_events" ON public.scan_events;
CREATE POLICY "Scanners insert own scan_events"
  ON public.scan_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    scanner_user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.event_scanners es
      WHERE es.event_id = scan_events.event_id
        AND es.user_id = auth.uid()
        AND es.removed_at IS NULL
        AND COALESCE((es.permissions ->> 'scan')::boolean, true)
    )
  );

-- =====================================================================
-- 20260502100007_b1_phase7_audit_permissions.sql
-- =====================================================================
-- Cycle B1 Phase 7 — Permissions matrix + audit log (BUSINESS_PROJECT_PLAN §B.7).

CREATE TABLE IF NOT EXISTS public.permissions_matrix (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL,
  action text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permissions_matrix_role_nonempty CHECK (length(trim(role)) > 0),
  CONSTRAINT permissions_matrix_action_nonempty CHECK (length(trim(action)) > 0),
  CONSTRAINT permissions_matrix_role_action_unique UNIQUE (role, action)
);

CREATE INDEX IF NOT EXISTS idx_permissions_matrix_role ON public.permissions_matrix (role);

COMMENT ON TABLE public.permissions_matrix IS
  'Static role→action map for server-side checks (B1 §B.7); optional client read.';

ALTER TABLE public.permissions_matrix ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read permissions_matrix" ON public.permissions_matrix;
CREATE POLICY "Authenticated can read permissions_matrix"
  ON public.permissions_matrix
  FOR SELECT
  TO authenticated
  USING (true);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  brand_id uuid REFERENCES public.brands (id) ON DELETE SET NULL,
  event_id uuid REFERENCES public.events (id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  before jsonb,
  after jsonb,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_log_action_nonempty CHECK (length(trim(action)) > 0),
  CONSTRAINT audit_log_target_type_nonempty CHECK (length(trim(target_type)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON public.audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_brand_id ON public.audit_log (brand_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.audit_log (action);

COMMENT ON TABLE public.audit_log IS
  'Append-only audit trail; inserts via service role only (B1 §B.7).';

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own audit_log rows" ON public.audit_log;
CREATE POLICY "Users can read own audit_log rows"
  ON public.audit_log
  FOR SELECT
  TO authenticated
  USING (user_id IS NOT NULL AND user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.biz_audit_log_block_mutate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'audit_log is append-only for clients';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_block_update ON public.audit_log;
CREATE TRIGGER trg_audit_log_block_update
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_audit_log_block_mutate();

INSERT INTO public.permissions_matrix (role, action, allowed)
VALUES
  ('scanner', 'ticket.scan', true),
  ('event_manager', 'event.write', true),
  ('finance_manager', 'order.refund', true),
  ('brand_admin', 'brand.invite', true),
  ('account_owner', 'brand.delete', true)
ON CONFLICT (role, action) DO NOTHING;

-- =====================================================================
-- 20260502100008_b1_phase8_payments.sql
-- =====================================================================
-- Cycle B1 Phase 8 — Payments ledger tables (BUSINESS_PROJECT_PLAN §B.6).
-- Schema + RLS only; live Stripe wiring is B2/B3.

CREATE TABLE IF NOT EXISTS public.stripe_connect_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  stripe_account_id text NOT NULL,
  account_type text NOT NULL DEFAULT 'express'
    CONSTRAINT stripe_connect_accounts_type_check
      CHECK (account_type IN ('standard', 'express', 'custom')),
  charges_enabled boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stripe_connect_accounts_stripe_id_nonempty
    CHECK (length(trim(stripe_account_id)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_connect_accounts_brand_id
  ON public.stripe_connect_accounts (brand_id);

CREATE INDEX IF NOT EXISTS idx_stripe_connect_accounts_stripe_account_id
  ON public.stripe_connect_accounts (stripe_account_id);

DROP TRIGGER IF EXISTS trg_stripe_connect_accounts_updated_at ON public.stripe_connect_accounts;
CREATE TRIGGER trg_stripe_connect_accounts_updated_at
  BEFORE UPDATE ON public.stripe_connect_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.stripe_connect_accounts IS 'Stripe Connect account per brand (B1 §B.6).';

ALTER TABLE public.stripe_connect_accounts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands (id) ON DELETE CASCADE,
  stripe_payout_id text NOT NULL,
  amount_cents integer NOT NULL,
  currency char(3) NOT NULL DEFAULT 'GBP',
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT payouts_status_check
      CHECK (status IN ('pending', 'paid', 'failed')),
  arrival_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payouts_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT payouts_stripe_id_nonempty CHECK (length(trim(stripe_payout_id)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_payouts_brand_id ON public.payouts (brand_id);

COMMENT ON TABLE public.payouts IS 'Stripe payouts mirror (B1 §B.6).';

ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  stripe_refund_id text,
  amount_cents integer NOT NULL,
  reason text,
  initiated_by uuid REFERENCES auth.users (id),
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refunds_amount_positive CHECK (amount_cents > 0)
);

CREATE INDEX IF NOT EXISTS idx_refunds_order_id ON public.refunds (order_id);

COMMENT ON TABLE public.refunds IS 'Refunds linked to orders (B1 §B.6).';

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.door_sales_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders (id) ON DELETE SET NULL,
  scanner_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  payment_method text NOT NULL,
  amount_cents integer NOT NULL,
  currency char(3) NOT NULL DEFAULT 'GBP',
  reconciled boolean NOT NULL DEFAULT false,
  reconciled_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT door_sales_ledger_amount_non_negative CHECK (amount_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_door_sales_ledger_event_id ON public.door_sales_ledger (event_id);
CREATE INDEX IF NOT EXISTS idx_door_sales_ledger_order_id ON public.door_sales_ledger (order_id);

COMMENT ON TABLE public.door_sales_ledger IS 'Append-only style door sales ledger (B1 §B.6).';

ALTER TABLE public.door_sales_ledger ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  processed boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_webhook_events_stripe_id_nonempty
    CHECK (length(trim(stripe_event_id)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_webhook_events_stripe_event_id
  ON public.payment_webhook_events (stripe_event_id);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_processed ON public.payment_webhook_events (processed);

COMMENT ON TABLE public.payment_webhook_events IS
  'Idempotent Stripe webhook inbox; service role only from clients (B1 §B.6).';

ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.biz_order_brand_id(p_order_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.brand_id
  FROM public.orders o
  JOIN public.events e ON e.id = o.event_id
  WHERE o.id = p_order_id
  LIMIT 1;
$$;

-- Brand admin / finance_manager only (not event_manager alone) per §B.6.
CREATE OR REPLACE FUNCTION public.biz_can_manage_payments_for_brand(p_brand_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.biz_is_brand_admin_plus(p_brand_id, p_user_id)
  OR EXISTS (
    SELECT 1
    FROM public.brand_team_members m
    WHERE m.brand_id = p_brand_id
      AND m.user_id = p_user_id
      AND m.removed_at IS NULL
      AND m.accepted_at IS NOT NULL
      AND m.role = 'finance_manager'
  );
$$;

-- stripe_connect_accounts
DROP POLICY IF EXISTS "Brand admin plus can manage stripe_connect_accounts" ON public.stripe_connect_accounts;
CREATE POLICY "Brand admin plus can manage stripe_connect_accounts"
  ON public.stripe_connect_accounts
  FOR ALL
  TO authenticated
  USING (public.biz_can_manage_payments_for_brand(brand_id, auth.uid()))
  WITH CHECK (public.biz_can_manage_payments_for_brand(brand_id, auth.uid()));

-- payouts
DROP POLICY IF EXISTS "Brand admin plus can manage payouts" ON public.payouts;
CREATE POLICY "Brand admin plus can manage payouts"
  ON public.payouts
  FOR ALL
  TO authenticated
  USING (public.biz_can_manage_payments_for_brand(brand_id, auth.uid()))
  WITH CHECK (public.biz_can_manage_payments_for_brand(brand_id, auth.uid()));

-- refunds (via order → brand)
DROP POLICY IF EXISTS "Brand admin plus can manage refunds" ON public.refunds;
CREATE POLICY "Brand admin plus can manage refunds"
  ON public.refunds
  FOR ALL
  TO authenticated
  USING (
    public.biz_can_manage_payments_for_brand(
      public.biz_order_brand_id(order_id),
      auth.uid()
    )
  )
  WITH CHECK (
    public.biz_can_manage_payments_for_brand(
      public.biz_order_brand_id(order_id),
      auth.uid()
    )
  );

-- door_sales_ledger
DROP POLICY IF EXISTS "Brand admin plus can manage door_sales_ledger" ON public.door_sales_ledger;
CREATE POLICY "Brand admin plus can manage door_sales_ledger"
  ON public.door_sales_ledger
  FOR ALL
  TO authenticated
  USING (
    public.biz_can_manage_payments_for_brand(
      public.biz_event_brand_id(event_id),
      auth.uid()
    )
  )
  WITH CHECK (
    public.biz_can_manage_payments_for_brand(
      public.biz_event_brand_id(event_id),
      auth.uid()
    )
  );

-- payment_webhook_events: no client access (service role bypasses RLS)

-- =====================================================================
-- 20260502100009_b1_phase9_public_views.sql
-- =====================================================================
-- Cycle B1 Phase 9 — Public reads (BUSINESS_PROJECT_PLAN §B.8) + grants.
-- security_invoker views: RLS on base tables applies. Policies below allow both
-- anon (logged-out share pages) and authenticated (logged-in attendee browsing)
-- to read the same published-public rows without brand membership.

DROP POLICY IF EXISTS "Anon can read published public events" ON public.events;
DROP POLICY IF EXISTS "Public can read published events (anon or authenticated)" ON public.events;
CREATE POLICY "Public can read published events (anon or authenticated)"
  ON public.events
  FOR SELECT
  TO anon, authenticated
  USING (
    deleted_at IS NULL
    AND visibility = 'public'
    AND status IN ('scheduled', 'live')
  );

DROP POLICY IF EXISTS "Anon can read brands with public events" ON public.brands;
DROP POLICY IF EXISTS "Public can read brands with public events (anon or authenticated)" ON public.brands;
CREATE POLICY "Public can read brands with public events (anon or authenticated)"
  ON public.brands
  FOR SELECT
  TO anon, authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.brand_id = brands.id
        AND e.deleted_at IS NULL
        AND e.visibility = 'public'
        AND e.status IN ('scheduled', 'live')
    )
  );

DROP POLICY IF EXISTS "Anon can read organiser public profiles" ON public.creator_accounts;
DROP POLICY IF EXISTS "Public can read organiser profiles for share pages (anon or authenticated)" ON public.creator_accounts;
CREATE POLICY "Public can read organiser profiles for share pages (anon or authenticated)"
  ON public.creator_accounts
  FOR SELECT
  TO anon, authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.account_id = creator_accounts.id
        AND b.deleted_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.events e
          WHERE e.brand_id = b.id
            AND e.deleted_at IS NULL
            AND e.visibility = 'public'
            AND e.status IN ('scheduled', 'live')
        )
    )
  );

DROP POLICY IF EXISTS "Anon can read dates for public events" ON public.event_dates;
DROP POLICY IF EXISTS "Public can read event dates for published events (anon or authenticated)" ON public.event_dates;
CREATE POLICY "Public can read event dates for published events (anon or authenticated)"
  ON public.event_dates
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_dates.event_id
        AND e.deleted_at IS NULL
        AND e.visibility = 'public'
        AND e.status IN ('scheduled', 'live')
    )
  );

DROP POLICY IF EXISTS "Anon can read ticket types for public events" ON public.ticket_types;
DROP POLICY IF EXISTS "Public can read ticket types for published events (anon or authenticated)" ON public.ticket_types;
CREATE POLICY "Public can read ticket types for published events (anon or authenticated)"
  ON public.ticket_types
  FOR SELECT
  TO anon, authenticated
  USING (
    deleted_at IS NULL
    AND is_hidden IS NOT TRUE
    AND is_disabled IS NOT TRUE
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = ticket_types.event_id
        AND e.deleted_at IS NULL
        AND e.visibility = 'public'
        AND e.status IN ('scheduled', 'live')
    )
  );

CREATE OR REPLACE VIEW public.events_public_view
WITH (security_invoker = true)
AS
SELECT
  id,
  brand_id,
  created_by,
  title,
  description,
  slug,
  location_text,
  location_geo,
  online_url,
  is_online,
  is_recurring,
  is_multi_date,
  recurrence_rules,
  cover_media_url,
  cover_media_type,
  theme,
  organiser_contact,
  visibility,
  show_on_discover,
  show_in_swipeable_deck,
  status,
  published_at,
  timezone,
  created_at,
  updated_at
FROM public.events
WHERE deleted_at IS NULL
  AND visibility = 'public'
  AND status IN ('scheduled', 'live');

CREATE OR REPLACE VIEW public.brands_public_view
WITH (security_invoker = true)
AS
SELECT
  b.id,
  b.account_id,
  b.name,
  b.slug,
  b.description,
  b.profile_photo_url,
  b.contact_email,
  b.contact_phone,
  b.social_links,
  b.custom_links,
  b.display_attendee_count,
  b.default_currency,
  b.created_at,
  b.updated_at
FROM public.brands b
WHERE b.deleted_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id = b.id
      AND e.deleted_at IS NULL
      AND e.visibility = 'public'
      AND e.status IN ('scheduled', 'live')
  );

CREATE OR REPLACE VIEW public.organisers_public_view
WITH (security_invoker = true)
AS
SELECT
  id,
  display_name,
  avatar_url,
  business_name,
  created_at
FROM public.creator_accounts
WHERE deleted_at IS NULL;

COMMENT ON VIEW public.events_public_view IS 'Public published events (B1 §B.8); RLS allows anon + authenticated for published rows.';
COMMENT ON VIEW public.brands_public_view IS 'Brands with at least one public live event (B1 §B.8); same RLS as base table.';
COMMENT ON VIEW public.organisers_public_view IS 'Organiser-facing columns; RLS limits to accounts with a public published brand event.';

GRANT SELECT ON public.events_public_view TO anon, authenticated;
GRANT SELECT ON public.brands_public_view TO anon, authenticated;
GRANT SELECT ON public.organisers_public_view TO anon, authenticated;
