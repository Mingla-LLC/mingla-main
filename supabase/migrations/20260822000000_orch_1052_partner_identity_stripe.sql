-- ORCH-1052 [partner identity + account-level Stripe Connect + currency-match
-- invite gate]. META-ORCH-1048 sub-D.
--
-- Adds account-level partner identity (creator_accounts.partner_enabled +
-- partner_country), a partner-scoped Stripe Connect mirror table
-- (partner_stripe_connect_accounts), and the currency-match invite gate RPC
-- (partner_can_accept_brand) called by accept_invite_and_transfer_brand_ownership.
--
-- IDEMPOTENCY: every object is gated on IF [NOT] EXISTS / OR REPLACE; the
-- migration is safe to re-apply.
--
-- Hard guards:
--   * creator_accounts.id IS auth.users.id (no separate user_id column) — RLS
--     policies use account_id = auth.uid() directly.
--   * Inline EXISTS in RLS predicates per
--     feedback_rls_returning_owner_gap.md (no SECURITY DEFINER helpers).
--   * partner_can_accept_brand is SECURITY DEFINER (read-only, lookups only);
--     it never writes and never bypasses RLS for the caller.
--   * accept_invite_and_transfer_brand_ownership is CREATE OR REPLACE'd
--     end-to-end (the prior body is preserved verbatim; we only PREPEND the
--     partner currency-match preflight). See `prior_def_capture` comment.

BEGIN;

--------------------------------------------------------------------------------
-- 1. creator_accounts: add partner_enabled + partner_country.
--------------------------------------------------------------------------------

ALTER TABLE public.creator_accounts
  ADD COLUMN IF NOT EXISTS partner_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.creator_accounts
  ADD COLUMN IF NOT EXISTS partner_country text;

COMMENT ON COLUMN public.creator_accounts.partner_enabled IS
  'ORCH-1052: account is a flagged Mingla partner (admin-toggled). Gates partner Stripe onboarding + revenue-split eligibility.';
COMMENT ON COLUMN public.creator_accounts.partner_country IS
  'ORCH-1052: ISO-3166-1 alpha-2 country chosen at partner-Stripe onboarding. Mirrors partner_stripe_connect_accounts.country.';

-- Partial index for fast "is this account a partner?" lookups.
CREATE INDEX IF NOT EXISTS creator_accounts_partner_enabled_idx
  ON public.creator_accounts (id)
  WHERE partner_enabled = true;

--------------------------------------------------------------------------------
-- 2. partner_stripe_connect_accounts — mirrors stripe_connect_accounts shape
--    but keyed on creator_accounts.id (the partner identity) instead of brand_id.
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.partner_stripe_connect_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL
    REFERENCES public.creator_accounts(id) ON DELETE CASCADE,
  stripe_account_id text NOT NULL,
  country text NOT NULL,
  charges_enabled boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  controller_dashboard_type text,
  capabilities jsonb,
  -- external_account_currencies: lowercase 3-letter ISO codes the partner's
  -- connected Stripe account can SETTLE in. Populated by ORCH-1054 via the
  -- account.updated webhook. For ORCH-1052 it starts as an empty array, which
  -- means the currency-match gate denies by default — intentional; ORCH-1054
  -- ships the data hookup.
  external_account_currencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  detached_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- account_id is UNIQUE: one partner Stripe account per creator account.
ALTER TABLE public.partner_stripe_connect_accounts
  DROP CONSTRAINT IF EXISTS partner_stripe_connect_accounts_account_id_key;
ALTER TABLE public.partner_stripe_connect_accounts
  ADD CONSTRAINT partner_stripe_connect_accounts_account_id_key
  UNIQUE (account_id);

-- stripe_account_id is UNIQUE: Stripe ids never collide.
ALTER TABLE public.partner_stripe_connect_accounts
  DROP CONSTRAINT IF EXISTS partner_stripe_connect_accounts_stripe_account_id_key;
ALTER TABLE public.partner_stripe_connect_accounts
  ADD CONSTRAINT partner_stripe_connect_accounts_stripe_account_id_key
  UNIQUE (stripe_account_id);

CREATE INDEX IF NOT EXISTS partner_stripe_connect_accounts_account_id_idx
  ON public.partner_stripe_connect_accounts (account_id);

COMMENT ON TABLE public.partner_stripe_connect_accounts IS
  'ORCH-1052: per-partner Stripe Connect mirror. Mirrors the brand-scoped stripe_connect_accounts shape but keyed on creator_accounts.id. external_account_currencies populated by ORCH-1054 via the account.updated webhook.';

--------------------------------------------------------------------------------
-- 3. RLS on partner_stripe_connect_accounts.
--    SELECT: self-read only (account_id = auth.uid()) OR superadmin.
--    INSERT/UPDATE/DELETE: service role only (edge fns mediate).
--    Inline EXISTS predicates per feedback_rls_returning_owner_gap.md.
--------------------------------------------------------------------------------

ALTER TABLE public.partner_stripe_connect_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_stripe_connect_accounts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_stripe_self_select
  ON public.partner_stripe_connect_accounts;
CREATE POLICY partner_stripe_self_select
  ON public.partner_stripe_connect_accounts
  FOR SELECT
  USING (
    account_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid()
         AND p.account_type = 'admin'
    )
  );

-- INSERT / UPDATE / DELETE intentionally have NO permissive policies. Edge fns
-- write via the service role (which bypasses RLS); no client surface can mutate
-- this table directly.

--------------------------------------------------------------------------------
-- 4. partner_can_accept_brand — currency-match invite gate RPC.
--
--    Called from accept_invite_and_transfer_brand_ownership BEFORE the standard
--    accept logic. Returns jsonb:
--      { ok: true, reason: 'not_a_partner' }          when the accepting
--        account is not a flagged partner (gate skipped).
--      { ok: false, reason: 'partner_stripe_not_connected',
--        required_currency: <brand-currency> }        when partner has no row
--        in partner_stripe_connect_accounts.
--      { ok: false, reason: 'currency_mismatch',
--        brand_currency, partner_currencies }          when the partner is
--        connected but their external_account_currencies array doesn't include
--        the brand's default_currency. For ORCH-1052 the array starts empty —
--        ORCH-1054 wires the account.updated webhook to populate it; until then
--        flagged partners will always hit this branch (intentional).
--      { ok: true }                                    otherwise.
--
--    SECURITY DEFINER: read-only against creator_accounts /
--    partner_stripe_connect_accounts / brands. Search path locked.
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.partner_can_accept_brand(
  p_brand_id uuid,
  p_partner_account_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_partner_enabled boolean;
  v_brand_currency text;
  v_stripe_row record;
  v_partner_currencies jsonb;
BEGIN
  -- Gate 1: is the accepting account a Mingla partner?
  SELECT a.partner_enabled INTO v_partner_enabled
  FROM public.creator_accounts a
  WHERE a.id = p_partner_account_id;

  IF v_partner_enabled IS NULL OR v_partner_enabled = false THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'not_a_partner');
  END IF;

  -- Resolve brand currency (lowercased per Stripe convention).
  SELECT lower(b.default_currency) INTO v_brand_currency
  FROM public.brands b
  WHERE b.id = p_brand_id;

  IF v_brand_currency IS NULL OR length(v_brand_currency) = 0 THEN
    -- Defensive: brand without default_currency cannot money-flow; let the
    -- standard accept flow surface this via its own validation.
    RETURN jsonb_build_object('ok', true, 'reason', 'brand_has_no_currency');
  END IF;

  -- Gate 2: partner Stripe connected?
  SELECT psca.stripe_account_id, psca.external_account_currencies, psca.detached_at
    INTO v_stripe_row
  FROM public.partner_stripe_connect_accounts psca
  WHERE psca.account_id = p_partner_account_id;

  IF v_stripe_row.stripe_account_id IS NULL OR v_stripe_row.detached_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'partner_stripe_not_connected',
      'required_currency', v_brand_currency
    );
  END IF;

  -- Gate 3: currency match against external_account_currencies (lowercase).
  v_partner_currencies := COALESCE(v_stripe_row.external_account_currencies, '[]'::jsonb);

  IF jsonb_typeof(v_partner_currencies) <> 'array'
     OR jsonb_array_length(v_partner_currencies) = 0
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(v_partner_currencies) AS c
        WHERE lower(c) = v_brand_currency
     ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'currency_mismatch',
      'brand_currency', v_brand_currency,
      'partner_currencies', v_partner_currencies
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.partner_can_accept_brand(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_can_accept_brand(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_can_accept_brand(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.partner_can_accept_brand(uuid, uuid) IS
  'ORCH-1052: currency-match invite gate. Returns ok=true when the accepting account is not a flagged partner OR the partner Stripe settlement currency includes the brand default_currency. Otherwise returns ok=false with reason in {partner_stripe_not_connected, currency_mismatch}.';

--------------------------------------------------------------------------------
-- 5. accept_invite_and_transfer_brand_ownership — prepend the partner gate.
--
--    The body below is the ORCH-1050 definition (captured via pg_get_functiondef
--    at ORCH-1052 SPEC time) verbatim, with a single block inserted at the top:
--    after the invitation lock & email check, BEFORE the role branch, we call
--    partner_can_accept_brand. If the gate denies (ok=false AND reason !=
--    'not_a_partner'), we RAISE with ERRCODE P0006 'invite_currency_mismatch'
--    so the edge function can map it to a clean HTTP response.
--------------------------------------------------------------------------------

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
  v_partner_gate jsonb;
  v_partner_gate_reason text;
BEGIN
  -- Resolve the accepting user's auth user_id from creator_accounts.
  -- NOTE: creator_accounts.id IS the auth.users.id (no separate user_id col).
  SELECT a.id INTO v_acceptor_user_id
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

  -- ORCH-1052 partner currency-match gate. Runs AFTER email match (so
  -- non-invitees never learn whether the accept would have been currency-
  -- blocked) and BEFORE the role branch (so an ownership-transfer accept that
  -- would land the partner on a wrong-currency brand is blocked before
  -- repointing brands.account_id).
  v_partner_gate := public.partner_can_accept_brand(
    v_invitation.brand_id,
    p_accepting_account_id
  );
  v_partner_gate_reason := v_partner_gate->>'reason';

  IF (v_partner_gate->>'ok')::boolean = false
     AND COALESCE(v_partner_gate_reason, '') <> 'not_a_partner' THEN
    RAISE EXCEPTION 'invite_currency_mismatch' USING
      ERRCODE = 'P0006',
      DETAIL = v_partner_gate::text;
  END IF;

  -- Branch on role: ownership transfer vs standard membership.
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
        'invitation_email', v_invitation.email,
        'partner_gate', v_partner_gate
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
    'partner_gate', v_partner_gate
  );
END;
$function$;

--------------------------------------------------------------------------------
-- 6. admin_toggle_partner — admin-only RPC to flip
--    creator_accounts.partner_enabled. Mirrors the admin pattern: check the
--    profiles.account_type='admin' gate inside the function (SECURITY DEFINER)
--    and write an audit_log row.
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_toggle_partner(
  p_account_id uuid,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_admin boolean;
  v_prior boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid()
       AND p.account_type = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT partner_enabled INTO v_prior
  FROM public.creator_accounts
  WHERE id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.creator_accounts
  SET partner_enabled = p_enabled
  WHERE id = p_account_id;

  BEGIN
    INSERT INTO public.audit_log
      (user_id, brand_id, action, target_type, target_id, before, after)
    VALUES (
      auth.uid(),
      NULL,
      'admin.partner_enabled_toggle',
      'creator_account',
      p_account_id::text,
      jsonb_build_object('partner_enabled', v_prior),
      jsonb_build_object('partner_enabled', p_enabled)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'account_id', p_account_id,
    'partner_enabled', p_enabled
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_toggle_partner(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_toggle_partner(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_toggle_partner(uuid, boolean) TO service_role;

COMMENT ON FUNCTION public.admin_toggle_partner(uuid, boolean) IS
  'ORCH-1052: admin-only toggle for creator_accounts.partner_enabled. Self-checks profiles.account_type=admin via auth.uid().';

COMMIT;
