-- ORCH-1081 [Partner workflow polish] — partner_brand_links + brands.partner_setup.
--
-- Adds:
--   1. brands.partner_setup boolean (default false) — flag set when a brand is
--      created in "client mode" by a Mingla partner (see BrandCreationFlow
--      Step 0). Persisted at insert; never changes after.
--   2. public.partner_brand_links — link rows recording every partner-initiated
--      brand setup + invite. Tracks the lifecycle from invite-sent →
--      owner-accepted → owner-stripe-connected → first-split. Drives the new
--      /partner/brands list screen + the empty-state in /partner/earnings.
--   3. public.partner_brand_link_status(row) — derived status accessor so
--      clients can SELECT status without re-implementing the case tree.
--   4. Trigger after partner_splits status='transferred' to set
--      first_split_at on the matching partner_brand_links row (idempotent).
--   5. Trigger after stripe_connect_accounts.charges_enabled flips to true to
--      set owner_stripe_connected_at on matching partner_brand_links rows.
--
-- Note on accept-flow: the accepted_at column is set by an extension of the
-- accept_invite_and_transfer_brand_ownership RPC (see CREATE OR REPLACE
-- below). Keeping the column-set logic in the RPC keeps it in the same
-- transaction as the invite acceptance.
--
-- Backfill: NONE (clean-slate; ORCH-1081 launches this surface).
--
-- Invariants:
--   - Inline EXISTS / direct equality in every RLS predicate
--     ([[feedback-rls-returning-owner-gap]]).
--   - Triggers are SECURITY DEFINER, search_path locked.
--   - Idempotent: re-runnable end-to-end without side effects.

BEGIN;

-- =============================================================
-- 1. brands.partner_setup
-- =============================================================
ALTER TABLE public.brands
  ADD COLUMN IF NOT EXISTS partner_setup boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.brands.partner_setup IS
  'ORCH-1081: true when this brand was created by a Mingla partner setting it up for an external owner. Flipped at brand insert; not editable after.';

-- =============================================================
-- 2. partner_brand_links
-- =============================================================
CREATE TABLE IF NOT EXISTS public.partner_brand_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_account_id uuid NOT NULL
    REFERENCES public.creator_accounts(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL
    REFERENCES public.brands(id) ON DELETE CASCADE,
  invited_owner_email text NOT NULL,
  personal_note text,
  invited_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  owner_stripe_connected_at timestamptz,
  first_split_at timestamptz,
  cancelled_at timestamptz
);

-- One ACTIVE link per (partner, brand). Cancelled rows aren't subject to the
-- uniqueness so a partner can cancel and re-link the same brand if needed.
CREATE UNIQUE INDEX IF NOT EXISTS partner_brand_links_partner_brand_active_idx
  ON public.partner_brand_links (partner_account_id, brand_id)
  WHERE cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS partner_brand_links_partner_idx
  ON public.partner_brand_links (partner_account_id, invited_at DESC);

CREATE INDEX IF NOT EXISTS partner_brand_links_brand_idx
  ON public.partner_brand_links (brand_id);

CREATE INDEX IF NOT EXISTS partner_brand_links_email_idx
  ON public.partner_brand_links (lower(invited_owner_email));

COMMENT ON TABLE public.partner_brand_links IS
  'ORCH-1081: per-brand link recording a partner-initiated setup + invite. Drives /partner/brands list + earnings nudge.';

-- =============================================================
-- 3. RLS — partner reads own; service role writes.
-- =============================================================
ALTER TABLE public.partner_brand_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_brand_links_self_select ON public.partner_brand_links;
CREATE POLICY partner_brand_links_self_select
  ON public.partner_brand_links
  FOR SELECT
  TO authenticated
  USING (partner_account_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies → service role only.

-- =============================================================
-- 4. partner_brand_link_status — derived status column-function.
-- =============================================================
CREATE OR REPLACE FUNCTION public.partner_brand_link_status(
  row public.partner_brand_links
)
RETURNS text
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN row.cancelled_at IS NOT NULL THEN 'cancelled'
    WHEN row.first_split_at IS NOT NULL THEN 'active'
    WHEN row.owner_stripe_connected_at IS NOT NULL THEN 'active'
    WHEN row.accepted_at IS NOT NULL THEN 'awaiting_stripe'
    ELSE 'awaiting_owner'
  END;
$function$;

COMMENT ON FUNCTION public.partner_brand_link_status(public.partner_brand_links) IS
  'ORCH-1081: derived link status. Clients select via partner_brand_links.partner_brand_link_status (column-syntax). Pure case tree, no IO.';

-- =============================================================
-- 5. Trigger — first_split_at on partner_splits status flip to transferred.
-- =============================================================
CREATE OR REPLACE FUNCTION public.partner_brand_links_mark_first_split()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Only fire when a row moves into 'transferred'. Idempotent: COALESCE keeps
  -- the earliest first_split_at if multiple transferred rows land later.
  IF NEW.status = 'transferred'
     AND (OLD.status IS DISTINCT FROM 'transferred')
  THEN
    UPDATE public.partner_brand_links
       SET first_split_at = COALESCE(first_split_at, now())
     WHERE partner_account_id = NEW.partner_account_id
       AND brand_id           = NEW.brand_id
       AND cancelled_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS partner_brand_links_first_split_trigger
  ON public.partner_splits;
CREATE TRIGGER partner_brand_links_first_split_trigger
  AFTER UPDATE OF status ON public.partner_splits
  FOR EACH ROW
  EXECUTE FUNCTION public.partner_brand_links_mark_first_split();

-- Also fire on INSERT in case the very first row is created already at
-- 'transferred' (defensive — current flow inserts 'pending', but webhook
-- replay or schema-future-proofing). NEW.status check covers it.
CREATE OR REPLACE FUNCTION public.partner_brand_links_mark_first_split_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status = 'transferred' THEN
    UPDATE public.partner_brand_links
       SET first_split_at = COALESCE(first_split_at, now())
     WHERE partner_account_id = NEW.partner_account_id
       AND brand_id           = NEW.brand_id
       AND cancelled_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS partner_brand_links_first_split_insert_trigger
  ON public.partner_splits;
CREATE TRIGGER partner_brand_links_first_split_insert_trigger
  AFTER INSERT ON public.partner_splits
  FOR EACH ROW
  EXECUTE FUNCTION public.partner_brand_links_mark_first_split_insert();

-- =============================================================
-- 6. Trigger — owner_stripe_connected_at on brand stripe_connect_accounts
--    charges_enabled flip to true.
--
--    The brand's Stripe Connect mirror table is public.stripe_connect_accounts
--    (per the baseline). When charges_enabled becomes true AND the matching
--    brand has an active partner_brand_links row, stamp owner_stripe_connected_at.
-- =============================================================
CREATE OR REPLACE FUNCTION public.partner_brand_links_mark_stripe_connected()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.charges_enabled = true
     AND (OLD.charges_enabled IS DISTINCT FROM true)
     AND NEW.brand_id IS NOT NULL
  THEN
    UPDATE public.partner_brand_links
       SET owner_stripe_connected_at = COALESCE(owner_stripe_connected_at, now())
     WHERE brand_id = NEW.brand_id
       AND cancelled_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS partner_brand_links_stripe_connected_trigger
  ON public.stripe_connect_accounts;
CREATE TRIGGER partner_brand_links_stripe_connected_trigger
  AFTER UPDATE OF charges_enabled ON public.stripe_connect_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.partner_brand_links_mark_stripe_connected();

-- =============================================================
-- 7. accept_invite_and_transfer_brand_ownership — extend to stamp
--    partner_brand_links.accepted_at when a matching row exists.
--
--    Re-create the function adding a single UPDATE at the end of the SUCCESS
--    branch (before COMMIT). Everything else is byte-for-byte equivalent to
--    the ORCH-1050 definition; we keep the original docs/invariants.
-- =============================================================
CREATE OR REPLACE FUNCTION public.accept_invite_and_transfer_brand_ownership(
  p_token_hash text,
  p_accepting_account_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invitation record;
  v_acceptor_email text;
  v_acceptor_user_id uuid;
  v_prior_owner_account_id uuid;
  v_brand_record record;
  v_transferred boolean := false;
BEGIN
  SELECT a.id INTO v_acceptor_user_id
  FROM public.creator_accounts a
  WHERE a.id = p_accepting_account_id;

  IF v_acceptor_user_id IS NULL THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT u.email INTO v_acceptor_email
  FROM auth.users u
  WHERE u.id = v_acceptor_user_id;

  SELECT * INTO v_invitation
  FROM public.brand_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_invitation.status = 'accepted' THEN
    RAISE EXCEPTION 'invite_already_used' USING ERRCODE = 'P0002';
  END IF;

  IF v_invitation.status = 'revoked' THEN
    RAISE EXCEPTION 'invite_revoked' USING ERRCODE = 'P0005';
  END IF;

  IF v_invitation.expires_at <= now() THEN
    RAISE EXCEPTION 'invite_expired' USING ERRCODE = 'P0003';
  END IF;

  IF v_acceptor_email IS NULL
     OR lower(v_acceptor_email) <> lower(v_invitation.email) THEN
    RAISE EXCEPTION 'invite_email_mismatch' USING ERRCODE = 'P0004';
  END IF;

  IF v_invitation.role = 'brand_owner' THEN
    SELECT * INTO v_brand_record
    FROM public.brands
    WHERE id = v_invitation.brand_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0001';
    END IF;

    v_prior_owner_account_id := v_brand_record.account_id;

    UPDATE public.brand_team_members
    SET role = 'brand_admin'
    WHERE brand_id = v_invitation.brand_id
      AND role = 'brand_owner'
      AND removed_at IS NULL;

    UPDATE public.brands
    SET account_id = p_accepting_account_id
    WHERE id = v_invitation.brand_id;

    INSERT INTO public.brand_team_members
      (brand_id, user_id, role, invited_at, accepted_at, removed_at)
    VALUES
      (v_invitation.brand_id, v_acceptor_user_id, 'brand_owner',
       v_invitation.expires_at - interval '7 days', now(), NULL)
    ON CONFLICT DO NOTHING;

    UPDATE public.brand_team_members
    SET role = 'brand_owner',
        accepted_at = now(),
        removed_at = NULL
    WHERE brand_id = v_invitation.brand_id
      AND user_id = v_acceptor_user_id
      AND role <> 'brand_owner';

    v_transferred := true;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.brand_team_members
      WHERE brand_id = v_invitation.brand_id
        AND user_id = v_acceptor_user_id
    ) THEN
      UPDATE public.brand_team_members
      SET role = v_invitation.role,
          accepted_at = now(),
          removed_at = NULL
      WHERE brand_id = v_invitation.brand_id
        AND user_id = v_acceptor_user_id;
    ELSE
      INSERT INTO public.brand_team_members
        (brand_id, user_id, role, invited_at, accepted_at, removed_at)
      VALUES
        (v_invitation.brand_id, v_acceptor_user_id, v_invitation.role,
         v_invitation.expires_at - interval '7 days', now(), NULL);
    END IF;
  END IF;

  UPDATE public.brand_invitations
  SET status = 'accepted',
      accepted_at = now(),
      accepted_by_account_id = p_accepting_account_id
  WHERE id = v_invitation.id;

  -- ORCH-1081: stamp accepted_at on the matching partner_brand_links row
  -- (matched by brand_id + invitee email). Best-effort same-tx update.
  UPDATE public.partner_brand_links
     SET accepted_at = COALESCE(accepted_at, now())
   WHERE brand_id = v_invitation.brand_id
     AND lower(invited_owner_email) = lower(v_invitation.email)
     AND cancelled_at IS NULL;

  BEGIN
    INSERT INTO public.audit_log
      (user_id, brand_id, action, target_type, target_id, after)
    VALUES (
      v_acceptor_user_id,
      v_invitation.brand_id,
      CASE WHEN v_transferred
        THEN 'brand_ownership_transferred'
        ELSE 'brand_team_invitation_accepted'
      END,
      'brand_invitation',
      v_invitation.id::text,
      jsonb_build_object(
        'role', v_invitation.role,
        'transferred', v_transferred,
        'previous_owner_account_id', v_prior_owner_account_id,
        'new_owner_account_id', p_accepting_account_id,
        'invitation_email', v_invitation.email
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'brand_id', v_invitation.brand_id,
    'role', v_invitation.role,
    'transferred', v_transferred,
    'previous_owner_account_id', v_prior_owner_account_id,
    'new_owner_account_id',
      CASE WHEN v_transferred THEN p_accepting_account_id ELSE NULL END,
    -- ORCH-1081: surface partner attribution to the accept-flow client so the
    -- celebration screen can render the "Seth has built it out for you" copy.
    'partner_setup', (SELECT b.partner_setup FROM public.brands b WHERE b.id = v_invitation.brand_id)
  );
END;
$function$;

ALTER FUNCTION public.accept_invite_and_transfer_brand_ownership(text, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.accept_invite_and_transfer_brand_ownership(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_invite_and_transfer_brand_ownership(text, uuid)
  TO service_role;

-- =============================================================
-- 8. Probes — verify schema landed.
-- =============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='brands'
      AND column_name='partner_setup'
  ) THEN
    RAISE EXCEPTION 'ORCH-1081 probe failed: brands.partner_setup missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='partner_brand_links'
  ) THEN
    RAISE EXCEPTION 'ORCH-1081 probe failed: partner_brand_links table missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='partner_brand_link_status'
  ) THEN
    RAISE EXCEPTION 'ORCH-1081 probe failed: partner_brand_link_status fn missing';
  END IF;
END$$;

COMMIT;
