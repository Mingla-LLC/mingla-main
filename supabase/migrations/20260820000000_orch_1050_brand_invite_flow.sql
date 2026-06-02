-- ORCH-1050 [Brand team invite + accept + ownership transfer]
-- META-ORCH-1048 sub-B. Wires the brand-team invite flow end-to-end:
-- adds the columns needed by invite/accept, hashes the token at rest,
-- tightens RLS, and ships a SECURITY DEFINER RPC that performs an atomic
-- accept + (when role='brand_owner') ownership transfer in a single
-- transaction with a row-level lock.
--
-- Pre-state probed via Management API on 2026-06-02:
--   - brand_invitations exists (id, brand_id, email, role, invited_by,
--     token, expires_at, accepted_at) with 0 rows in prod
--   - RLS enabled with brand_admin+ SELECT/INSERT/UPDATE/DELETE policies
--     using biz_is_brand_admin_plus_for_caller() helper
--   - role CHECK already references the renamed 'brand_owner' literal
--     (ORCH-1047 rename landed in prod)
--   - audit_log table exists and is the canonical audit surface
--
-- Migration is idempotent and data-preserving. Token rename is safe because
-- the table is empty in every known environment.
--
-- Invariants:
--   - [[feedback-rls-returning-owner-gap]] honored — every policy predicate
--     is an INLINE EXISTS / direct equality check; no SECURITY DEFINER
--     wrapper inside the predicate
--   - Atomic transfer — accept_invite_and_transfer_brand_ownership runs in
--     a single transaction with `FOR UPDATE` on brand_invitations + brands
--   - Auto-trigger `biz_brand_owner_team_member_after_insert` (AFTER
--     INSERT ON brands) DOES NOT fire here — transfer is an UPDATE on
--     brands, not an INSERT (verified by reading the trigger DDL).

-- =============================================================
-- Column additions
-- =============================================================

ALTER TABLE public.brand_invitations
  ADD COLUMN IF NOT EXISTS invitee_name text;

ALTER TABLE public.brand_invitations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.brand_invitations
  ADD COLUMN IF NOT EXISTS accepted_by_account_id uuid;

ALTER TABLE public.brand_invitations
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

-- Status CHECK — narrow to the four states the flow knows.
-- DROP-then-ADD pattern so re-running the migration is safe.
ALTER TABLE public.brand_invitations
  DROP CONSTRAINT IF EXISTS brand_invitations_status_check;
ALTER TABLE public.brand_invitations
  ADD CONSTRAINT brand_invitations_status_check
  CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'));

-- FK to creator_accounts on accepted_by_account_id.
ALTER TABLE public.brand_invitations
  DROP CONSTRAINT IF EXISTS brand_invitations_accepted_by_account_id_fkey;
ALTER TABLE public.brand_invitations
  ADD CONSTRAINT brand_invitations_accepted_by_account_id_fkey
  FOREIGN KEY (accepted_by_account_id)
  REFERENCES public.creator_accounts(id)
  ON DELETE SET NULL;

-- =============================================================
-- Token → token_hash rename (table is empty in prod; no data
-- migration required, but guard with an idempotent column-existence check).
-- =============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='brand_invitations'
      AND column_name='token'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='brand_invitations'
      AND column_name='token_hash'
  ) THEN
    -- Safe because the table holds 0 rows in every probed env.
    EXECUTE 'ALTER TABLE public.brand_invitations RENAME COLUMN token TO token_hash';
  END IF;
END$$;

-- Drop the legacy idx + nonempty check on the old name; re-add on the new name.
DROP INDEX IF EXISTS public.idx_brand_invitations_token;
ALTER TABLE public.brand_invitations
  DROP CONSTRAINT IF EXISTS brand_invitations_token_nonempty;
ALTER TABLE public.brand_invitations
  ADD CONSTRAINT brand_invitations_token_hash_nonempty
  CHECK (length(trim(token_hash)) > 0);

-- =============================================================
-- Indexes
-- =============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_invitations_token_hash
  ON public.brand_invitations(token_hash);

CREATE INDEX IF NOT EXISTS idx_brand_invitations_brand_status
  ON public.brand_invitations(brand_id, status);

CREATE INDEX IF NOT EXISTS idx_brand_invitations_email
  ON public.brand_invitations(lower(email));

-- =============================================================
-- RLS policies — replace existing with INLINE EXISTS predicates per
-- [[feedback-rls-returning-owner-gap]]. The prior policies wrapped a
-- SECURITY DEFINER helper which is OK for SELECT/UPDATE but per the
-- memory rule we prefer direct EXISTS predicates so they survive in
-- RETURNING + WITH CHECK contexts without surprise.
-- =============================================================
DROP POLICY IF EXISTS "Brand admin plus select invitations" ON public.brand_invitations;
DROP POLICY IF EXISTS "Brand admin plus insert invitations" ON public.brand_invitations;
DROP POLICY IF EXISTS "Brand admin plus update invitations" ON public.brand_invitations;
DROP POLICY IF EXISTS "Brand admin plus delete invitations" ON public.brand_invitations;
DROP POLICY IF EXISTS "brand_invitations_select_brand_admin_plus" ON public.brand_invitations;
DROP POLICY IF EXISTS "brand_invitations_insert_brand_admin_plus" ON public.brand_invitations;
DROP POLICY IF EXISTS "brand_invitations_update_brand_admin_plus" ON public.brand_invitations;

ALTER TABLE public.brand_invitations ENABLE ROW LEVEL SECURITY;

-- SELECT: any brand_admin+ (rank ≥ 50) on the invitation's brand can read.
-- Inline EXISTS predicate so RETURNING works without re-evaluating the
-- SECURITY DEFINER helper.
CREATE POLICY "brand_invitations_select_brand_admin_plus"
  ON public.brand_invitations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brand_team_members m
      INNER JOIN public.brands b ON b.id = m.brand_id
      WHERE m.brand_id = brand_invitations.brand_id
        AND m.user_id = auth.uid()
        AND m.removed_at IS NULL
        AND m.accepted_at IS NOT NULL
        AND b.deleted_at IS NULL
        AND m.role IN ('brand_owner', 'brand_admin')
    )
    OR EXISTS (
      -- Synthesized brand_owner via brand.account_id chain.
      SELECT 1
      FROM public.brands b
      INNER JOIN public.creator_accounts a ON a.id = b.account_id
      WHERE b.id = brand_invitations.brand_id
        AND a.user_id = auth.uid()
        AND b.deleted_at IS NULL
    )
  );

-- INSERT: brand_admin+ caller, invited_by must equal auth.uid().
CREATE POLICY "brand_invitations_insert_brand_admin_plus"
  ON public.brand_invitations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    invited_by = auth.uid()
    AND (
      EXISTS (
        SELECT 1
        FROM public.brand_team_members m
        INNER JOIN public.brands b ON b.id = m.brand_id
        WHERE m.brand_id = brand_invitations.brand_id
          AND m.user_id = auth.uid()
          AND m.removed_at IS NULL
          AND m.accepted_at IS NOT NULL
          AND b.deleted_at IS NULL
          AND m.role IN ('brand_owner', 'brand_admin')
      )
      OR EXISTS (
        SELECT 1
        FROM public.brands b
        INNER JOIN public.creator_accounts a ON a.id = b.account_id
        WHERE b.id = brand_invitations.brand_id
          AND a.user_id = auth.uid()
          AND b.deleted_at IS NULL
      )
    )
  );

-- UPDATE: brand_admin+ may revoke (set status='revoked'). The accept-flow
-- itself runs via the SECURITY DEFINER RPC under the service role, so RLS
-- does not need to model the accept path.
CREATE POLICY "brand_invitations_update_brand_admin_plus"
  ON public.brand_invitations
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brand_team_members m
      INNER JOIN public.brands b ON b.id = m.brand_id
      WHERE m.brand_id = brand_invitations.brand_id
        AND m.user_id = auth.uid()
        AND m.removed_at IS NULL
        AND m.accepted_at IS NOT NULL
        AND b.deleted_at IS NULL
        AND m.role IN ('brand_owner', 'brand_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.brands b
      INNER JOIN public.creator_accounts a ON a.id = b.account_id
      WHERE b.id = brand_invitations.brand_id
        AND a.user_id = auth.uid()
        AND b.deleted_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.brand_team_members m
      INNER JOIN public.brands b ON b.id = m.brand_id
      WHERE m.brand_id = brand_invitations.brand_id
        AND m.user_id = auth.uid()
        AND m.removed_at IS NULL
        AND m.accepted_at IS NOT NULL
        AND b.deleted_at IS NULL
        AND m.role IN ('brand_owner', 'brand_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.brands b
      INNER JOIN public.creator_accounts a ON a.id = b.account_id
      WHERE b.id = brand_invitations.brand_id
        AND a.user_id = auth.uid()
        AND b.deleted_at IS NULL
    )
  );

-- DELETE: forbidden (audit trail preserved). No CREATE POLICY → deny by default.

-- =============================================================
-- RPC: accept_invite_and_transfer_brand_ownership
--
-- SECURITY DEFINER atomic accept + (optionally) brand-ownership transfer.
-- A single transaction. FOR UPDATE row lock on the invitation defeats
-- concurrent double-accept races.
--
-- Error contracts (each RAISE EXCEPTION uses a distinct ERRCODE so the
-- edge fn can map cleanly to HTTP):
--   P0001  invite_not_found
--   P0002  invite_already_used
--   P0003  invite_expired
--   P0004  invite_email_mismatch
--   P0005  invite_revoked
-- =============================================================
CREATE OR REPLACE FUNCTION public.accept_invite_and_transfer_brand_ownership(
  p_token_hash text,
  p_accepting_account_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_invitation record;
  v_acceptor_email text;
  v_acceptor_user_id uuid;
  v_prior_owner_account_id uuid;
  v_brand_record record;
  v_transferred boolean := false;
BEGIN
  -- Resolve the accepting user's auth email + user_id from creator_accounts.
  SELECT a.user_id INTO v_acceptor_user_id
  FROM public.creator_accounts a
  WHERE a.id = p_accepting_account_id;

  IF v_acceptor_user_id IS NULL THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT u.email INTO v_acceptor_email
  FROM auth.users u
  WHERE u.id = v_acceptor_user_id;

  -- Lock the invitation row. FOR UPDATE so concurrent accepts serialize.
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

  -- Branch on role: ownership transfer vs standard membership.
  IF v_invitation.role = 'brand_owner' THEN
    -- Lock the brand row; we are about to repoint account_id.
    SELECT * INTO v_brand_record
    FROM public.brands
    WHERE id = v_invitation.brand_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'P0001';
    END IF;

    v_prior_owner_account_id := v_brand_record.account_id;

    -- Demote any active brand_owner team-member rows to brand_admin.
    UPDATE public.brand_team_members
    SET role = 'brand_admin'
    WHERE brand_id = v_invitation.brand_id
      AND role = 'brand_owner'
      AND removed_at IS NULL;

    -- Repoint the brand. AFTER INSERT trigger
    -- `biz_brand_owner_team_member_after_insert` listens for INSERT, not
    -- UPDATE, so it does NOT fire here — confirmed by trigger DDL.
    UPDATE public.brands
    SET account_id = p_accepting_account_id
    WHERE id = v_invitation.brand_id;

    -- Insert / refresh the new owner's team-member row.
    INSERT INTO public.brand_team_members
      (brand_id, user_id, role, invited_at, accepted_at, removed_at)
    VALUES
      (v_invitation.brand_id, v_acceptor_user_id, 'brand_owner',
       v_invitation.expires_at - interval '7 days', now(), NULL)
    ON CONFLICT DO NOTHING;

    -- If a prior row exists for this user (re-invite scenario), make sure
    -- it's active + role=brand_owner. No unique constraint on
    -- (brand_id,user_id) so we use a guarded UPDATE.
    UPDATE public.brand_team_members
    SET role = 'brand_owner',
        accepted_at = now(),
        removed_at = NULL
    WHERE brand_id = v_invitation.brand_id
      AND user_id = v_acceptor_user_id
      AND role <> 'brand_owner';

    v_transferred := true;
  ELSE
    -- Standard membership accept. Upsert by (brand_id, user_id):
    -- if a row already exists (e.g. previously removed) we reactivate it
    -- with the new role; otherwise we insert.
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

  -- Mark the invitation accepted.
  UPDATE public.brand_invitations
  SET status = 'accepted',
      accepted_at = now(),
      accepted_by_account_id = p_accepting_account_id
  WHERE id = v_invitation.id;

  -- Best-effort audit log row. audit_log is the canonical surface (probed).
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
    -- Audit failure must not block accept.
    NULL;
  END;

  RETURN jsonb_build_object(
    'brand_id', v_invitation.brand_id,
    'role', v_invitation.role,
    'transferred', v_transferred,
    'previous_owner_account_id', v_prior_owner_account_id,
    'new_owner_account_id',
      CASE WHEN v_transferred THEN p_accepting_account_id ELSE NULL END
  );
END;
$$;

ALTER FUNCTION public.accept_invite_and_transfer_brand_ownership(text, uuid)
  OWNER TO postgres;

COMMENT ON FUNCTION public.accept_invite_and_transfer_brand_ownership(text, uuid) IS
  'ORCH-1050: atomically accept a brand_invitations row + (when role=brand_owner) transfer brand ownership. SECURITY DEFINER; locks the invitation FOR UPDATE so concurrent accepts serialize. Errors raise distinct ERRCODEs P0001..P0005 for clean HTTP mapping.';

REVOKE ALL ON FUNCTION public.accept_invite_and_transfer_brand_ownership(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_invite_and_transfer_brand_ownership(text, uuid)
  TO service_role;

-- =============================================================
-- Verification probes (read-only)
-- =============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='brand_invitations'
      AND column_name='token_hash'
  ) THEN
    RAISE EXCEPTION 'ORCH-1050 probe failed: brand_invitations.token_hash missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='brand_invitations'
      AND column_name='status'
  ) THEN
    RAISE EXCEPTION 'ORCH-1050 probe failed: brand_invitations.status missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public'
      AND p.proname='accept_invite_and_transfer_brand_ownership'
  ) THEN
    RAISE EXCEPTION 'ORCH-1050 probe failed: accept RPC not registered';
  END IF;
END$$;
