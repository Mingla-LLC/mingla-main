-- ORCH-1051 [Scanner invite + brand-scoped scanner] — META-ORCH-1048 sub-C.
--
-- Wires the scanner-team invite flow end-to-end (replaces the [TRANSITIONAL]
-- local-Zustand-only flow at mingla-business/src/store/scannerInvitationsStore.ts)
-- AND extends the scan-ticket permission gate to honor BOTH:
--   - event_scanners (event-scoped; today's path, preserved verbatim) AND
--   - brand_team_members.role='scanner' (brand-scoped; new path)
--
-- Pre-state probed via Management API on 2026-06-02:
--   - event_scanners: id, event_id, user_id, permissions, assigned_by,
--     assigned_at, removed_at. PK=id. FKs to auth.users(id) on user_id and
--     assigned_by, events(id) ON DELETE CASCADE on event_id. No unique
--     constraint on (event_id, user_id) (so the accept RPC uses a guarded
--     EXISTS/UPDATE pattern, not ON CONFLICT).
--   - brand_team_members: id, brand_id, user_id, role, invited_at,
--     accepted_at, removed_at, permissions_override, mingla_tos_*.
--     role CHECK includes 'scanner'. No unique on (brand_id, user_id) either.
--   - creator_accounts.id IS auth.users.id (no separate user_id column;
--     count of mismatched rows = 0). Mirror the ORCH-1050 pattern: use the
--     accepting account_id as both the auth user and the creator_accounts FK.
--   - audit_log: user_id, brand_id, event_id, action, target_type,
--     target_id, before, after, ip, user_agent, created_at.
--   - biz_brand_effective_rank(brand_id, user_id) is the canonical predicate;
--     rank 40 = event_manager (MANAGE_SCANNERS gate).
--   - biz_ticket_scan body lives in 20260528000000_orch_0793_*. Existing
--     permission check is event_scanners-only.
--
-- Migration is idempotent + data-preserving. Per [[feedback-rls-returning-owner-gap]]
-- every RLS predicate is INLINE EXISTS, no SECURITY DEFINER helpers inside USING/WITH CHECK.

-- =============================================================
-- §1. scanner_invitations table
-- =============================================================
CREATE TABLE IF NOT EXISTS public.scanner_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  scope text NOT NULL,
  email text NOT NULL,
  invitee_name text,
  permissions jsonb NOT NULL DEFAULT '{"canScan":true,"canAcceptPayments":false}'::jsonb,
  invited_by uuid NOT NULL REFERENCES public.creator_accounts(id),
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  accepted_at timestamptz,
  accepted_by_account_id uuid REFERENCES public.creator_accounts(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotent CHECK constraints (DROP IF EXISTS → ADD).
ALTER TABLE public.scanner_invitations
  DROP CONSTRAINT IF EXISTS scanner_invitations_scope_check;
ALTER TABLE public.scanner_invitations
  ADD CONSTRAINT scanner_invitations_scope_check
  CHECK (scope IN ('event', 'brand'));

ALTER TABLE public.scanner_invitations
  DROP CONSTRAINT IF EXISTS scanner_invitations_status_check;
ALTER TABLE public.scanner_invitations
  ADD CONSTRAINT scanner_invitations_status_check
  CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'));

-- scope='event' MUST have event_id; scope='brand' MUST NOT.
ALTER TABLE public.scanner_invitations
  DROP CONSTRAINT IF EXISTS scanner_invitations_scope_event_id_check;
ALTER TABLE public.scanner_invitations
  ADD CONSTRAINT scanner_invitations_scope_event_id_check
  CHECK (
    (scope = 'event' AND event_id IS NOT NULL)
    OR (scope = 'brand' AND event_id IS NULL)
  );

ALTER TABLE public.scanner_invitations
  DROP CONSTRAINT IF EXISTS scanner_invitations_token_hash_nonempty;
ALTER TABLE public.scanner_invitations
  ADD CONSTRAINT scanner_invitations_token_hash_nonempty
  CHECK (length(trim(token_hash)) > 0);

-- Lowercased email at write-time (trigger; cheaper than CHECK + safer than
-- expecting every caller to lower()).
CREATE OR REPLACE FUNCTION public.biz_scanner_invitations_lower_email()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.email IS NOT NULL THEN
    NEW.email := lower(trim(NEW.email));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS biz_scanner_invitations_lower_email_trg ON public.scanner_invitations;
CREATE TRIGGER biz_scanner_invitations_lower_email_trg
  BEFORE INSERT OR UPDATE OF email ON public.scanner_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.biz_scanner_invitations_lower_email();

-- =============================================================
-- §2. Indexes
-- =============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_scanner_invitations_token_hash
  ON public.scanner_invitations(token_hash);

CREATE INDEX IF NOT EXISTS idx_scanner_invitations_brand_status
  ON public.scanner_invitations(brand_id, status);

CREATE INDEX IF NOT EXISTS idx_scanner_invitations_event
  ON public.scanner_invitations(event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scanner_invitations_email
  ON public.scanner_invitations(email);

-- =============================================================
-- §3. RLS — inline EXISTS predicates per [[feedback-rls-returning-owner-gap]]
-- =============================================================
ALTER TABLE public.scanner_invitations ENABLE ROW LEVEL SECURITY;

-- Drop any prior names so re-apply is safe.
DROP POLICY IF EXISTS "scanner_invitations_select_event_manager_plus" ON public.scanner_invitations;
DROP POLICY IF EXISTS "scanner_invitations_insert_event_manager_plus" ON public.scanner_invitations;
DROP POLICY IF EXISTS "scanner_invitations_update_event_manager_plus" ON public.scanner_invitations;

-- SELECT: event_manager+ (rank ≥ 40) on the invitation's brand can read.
CREATE POLICY "scanner_invitations_select_event_manager_plus"
  ON public.scanner_invitations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brand_team_members m
      INNER JOIN public.brands b ON b.id = m.brand_id
      WHERE m.brand_id = scanner_invitations.brand_id
        AND m.user_id = auth.uid()
        AND m.removed_at IS NULL
        AND m.accepted_at IS NOT NULL
        AND b.deleted_at IS NULL
        AND m.role IN ('brand_owner', 'brand_admin', 'event_manager')
    )
    OR EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = scanner_invitations.brand_id
        AND b.account_id = auth.uid()
        AND b.deleted_at IS NULL
    )
  );

-- INSERT: same gate, plus invited_by must equal auth.uid().
CREATE POLICY "scanner_invitations_insert_event_manager_plus"
  ON public.scanner_invitations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    invited_by = auth.uid()
    AND (
      EXISTS (
        SELECT 1
        FROM public.brand_team_members m
        INNER JOIN public.brands b ON b.id = m.brand_id
        WHERE m.brand_id = scanner_invitations.brand_id
          AND m.user_id = auth.uid()
          AND m.removed_at IS NULL
          AND m.accepted_at IS NOT NULL
          AND b.deleted_at IS NULL
          AND m.role IN ('brand_owner', 'brand_admin', 'event_manager')
      )
      OR EXISTS (
        SELECT 1
        FROM public.brands b
        WHERE b.id = scanner_invitations.brand_id
          AND b.account_id = auth.uid()
          AND b.deleted_at IS NULL
      )
    )
  );

-- UPDATE: event_manager+ may revoke. Accept-flow runs via SECURITY DEFINER
-- RPC under service role — RLS doesn't need to model the accept path.
CREATE POLICY "scanner_invitations_update_event_manager_plus"
  ON public.scanner_invitations
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brand_team_members m
      INNER JOIN public.brands b ON b.id = m.brand_id
      WHERE m.brand_id = scanner_invitations.brand_id
        AND m.user_id = auth.uid()
        AND m.removed_at IS NULL
        AND m.accepted_at IS NOT NULL
        AND b.deleted_at IS NULL
        AND m.role IN ('brand_owner', 'brand_admin', 'event_manager')
    )
    OR EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = scanner_invitations.brand_id
        AND b.account_id = auth.uid()
        AND b.deleted_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.brand_team_members m
      INNER JOIN public.brands b ON b.id = m.brand_id
      WHERE m.brand_id = scanner_invitations.brand_id
        AND m.user_id = auth.uid()
        AND m.removed_at IS NULL
        AND m.accepted_at IS NOT NULL
        AND b.deleted_at IS NULL
        AND m.role IN ('brand_owner', 'brand_admin', 'event_manager')
    )
    OR EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = scanner_invitations.brand_id
        AND b.account_id = auth.uid()
        AND b.deleted_at IS NULL
    )
  );

-- DELETE: forbidden (audit trail preserved). No CREATE POLICY → deny by default.

-- =============================================================
-- §4. RPC: accept_scanner_invitation
--
-- SECURITY DEFINER atomic accept. Single transaction. FOR UPDATE on the
-- invitation row defeats double-accept races.
--
-- Error contracts (distinct ERRCODEs for clean HTTP mapping):
--   P0001  invite_not_found
--   P0002  invite_already_used
--   P0003  invite_expired
--   P0004  invite_email_mismatch
--   P0005  invite_revoked
--
-- Branches on scope:
--   scope='event' → upsert event_scanners (brand+event-scoped scanner)
--   scope='brand' → upsert brand_team_members(role='scanner') (brand-wide)
-- =============================================================
CREATE OR REPLACE FUNCTION public.accept_scanner_invitation(
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
  v_existing_es_id uuid;
  v_existing_btm_id uuid;
BEGIN
  -- Resolve accepting user. creator_accounts.id IS auth.users.id (probed).
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
  FROM public.scanner_invitations
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

  -- Branch on scope.
  IF v_invitation.scope = 'event' THEN
    -- Upsert event_scanners. No unique on (event_id, user_id) so we do a
    -- guarded EXISTS/UPDATE pattern (mirrors ORCH-1050's brand_team_members
    -- handling).
    SELECT es.id INTO v_existing_es_id
    FROM public.event_scanners es
    WHERE es.event_id = v_invitation.event_id
      AND es.user_id = v_acceptor_user_id
    LIMIT 1;

    IF v_existing_es_id IS NOT NULL THEN
      UPDATE public.event_scanners
      SET removed_at = NULL,
          permissions = v_invitation.permissions,
          assigned_by = v_invitation.invited_by,
          assigned_at = COALESCE(assigned_at, now())
      WHERE id = v_existing_es_id;
    ELSE
      INSERT INTO public.event_scanners
        (event_id, user_id, permissions, assigned_by, assigned_at, removed_at)
      VALUES
        (v_invitation.event_id, v_acceptor_user_id, v_invitation.permissions,
         v_invitation.invited_by, now(), NULL);
    END IF;
  ELSE
    -- scope = 'brand': upsert brand_team_members with role='scanner'.
    SELECT m.id INTO v_existing_btm_id
    FROM public.brand_team_members m
    WHERE m.brand_id = v_invitation.brand_id
      AND m.user_id = v_acceptor_user_id
    LIMIT 1;

    IF v_existing_btm_id IS NOT NULL THEN
      UPDATE public.brand_team_members
      SET role = 'scanner',
          accepted_at = now(),
          removed_at = NULL
      WHERE id = v_existing_btm_id;
    ELSE
      INSERT INTO public.brand_team_members
        (brand_id, user_id, role, invited_at, accepted_at, removed_at)
      VALUES
        (v_invitation.brand_id, v_acceptor_user_id, 'scanner',
         v_invitation.expires_at - interval '7 days', now(), NULL);
    END IF;
  END IF;

  -- Mark the invitation accepted.
  UPDATE public.scanner_invitations
  SET status = 'accepted',
      accepted_at = now(),
      accepted_by_account_id = p_accepting_account_id
  WHERE id = v_invitation.id;

  -- Best-effort audit row. audit_log is the canonical surface (probed).
  BEGIN
    INSERT INTO public.audit_log
      (user_id, brand_id, event_id, action, target_type, target_id, after)
    VALUES (
      v_acceptor_user_id,
      v_invitation.brand_id,
      v_invitation.event_id,
      'scanner_invitation_accepted',
      'scanner_invitation',
      v_invitation.id::text,
      jsonb_build_object(
        'scope', v_invitation.scope,
        'invitation_email', v_invitation.email,
        'permissions', v_invitation.permissions
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'scope', v_invitation.scope,
    'brand_id', v_invitation.brand_id,
    'event_id', v_invitation.event_id,
    'user_id', v_acceptor_user_id
  );
END;
$$;

ALTER FUNCTION public.accept_scanner_invitation(text, uuid) OWNER TO postgres;

COMMENT ON FUNCTION public.accept_scanner_invitation(text, uuid) IS
  'ORCH-1051: atomically accept a scanner_invitations row, branching on scope to upsert either event_scanners (scope=event) or brand_team_members.role=scanner (scope=brand). SECURITY DEFINER; locks the invitation FOR UPDATE so concurrent accepts serialize. Errors raise distinct ERRCODEs P0001..P0005 for clean HTTP mapping.';

REVOKE ALL ON FUNCTION public.accept_scanner_invitation(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_scanner_invitation(text, uuid)
  TO service_role;

-- =============================================================
-- §5. EXTEND biz_ticket_scan: permission gate accepts BOTH event_scanners
-- and brand_team_members.role='scanner'. Everything else in the body is
-- preserved byte-for-byte from 20260528000000_orch_0793_*.
-- =============================================================
CREATE OR REPLACE FUNCTION public.biz_ticket_scan(
  p_event_id uuid,
  p_qr_payload text,
  p_scanner_user_id uuid,
  p_qr_token_pepper text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  -- Grace constants — SPEC §3.1 Decision-1. Tuning outside [60min, 24h]
  -- requires SPEC review.
  c_grace_before constant interval := interval '120 minutes';
  c_grace_after  constant interval := interval '360 minutes';

  v_match text[];
  v_ticket_id uuid;
  v_token text;
  v_ticket record;
  v_scan_result text;
  v_scan_id uuid;
  v_qr_token_pepper text;
  v_scan_event_id uuid;
  v_has_event_dates boolean;
  v_in_window boolean;
  v_next_start timestamptz;
  v_last_end timestamptz;
BEGIN
  v_qr_token_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);

  -- ORCH-1051: permission gate now honors EITHER event-scoped scanner
  -- (event_scanners; preserved verbatim) OR brand-scoped scanner
  -- (brand_team_members.role='scanner', accepted, not removed) on the
  -- event's brand. Inline predicates per [[feedback-rls-returning-owner-gap]].
  IF NOT (
    EXISTS (
      SELECT 1
        FROM public.event_scanners es
       WHERE es.event_id = p_event_id
         AND es.user_id = p_scanner_user_id
         AND es.removed_at IS NULL
         AND COALESCE((es.permissions ->> 'scan')::boolean, true)
    )
    OR EXISTS (
      SELECT 1
        FROM public.events e
        INNER JOIN public.brand_team_members m ON m.brand_id = e.brand_id
       WHERE e.id = p_event_id
         AND m.user_id = p_scanner_user_id
         AND m.role = 'scanner'
         AND m.removed_at IS NULL
         AND m.accepted_at IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'scanner_not_authorized';
  END IF;

  v_match := regexp_match(
    p_qr_payload,
    '^mingla:v1:ticket:([0-9a-fA-F-]{36}):sig:([a-f0-9]{64})$'
  );

  IF v_match IS NULL THEN
    v_scan_result := 'not_found';
  ELSE
    v_ticket_id := v_match[1]::uuid;
    v_token := v_match[2];

    SELECT t.*, o.buyer_name, o.payment_status, tt.name AS ticket_name
      INTO v_ticket
      FROM public.tickets t
      JOIN public.orders o ON o.id = t.order_id
      JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
     WHERE t.id = v_ticket_id
     FOR UPDATE OF t;

    IF NOT FOUND OR p_qr_payload IS DISTINCT FROM public.biz_ticket_checkout_qr_payload(v_ticket_id, v_ticket.qr_token_hash, v_qr_token_pepper) THEN
      v_scan_result := 'not_found';
    ELSIF v_ticket.event_id <> p_event_id THEN
      v_scan_result := 'wrong_event';
    ELSIF v_ticket.payment_status <> 'paid' THEN
      v_scan_result := 'void';
    ELSIF v_ticket.status = 'used' THEN
      v_scan_result := 'duplicate';
    ELSIF v_ticket.status <> 'valid' THEN
      v_scan_result := 'void';
    ELSE
      -- ORCH-0793 — event time-window check. Reads event_dates per
      -- I-PROPOSED-AY EVENT_DATES_SOLE_DATE_AUTHORITY. Multi-date events
      -- succeed if now() lies in ANY date row's grace-extended window
      -- (most-permissive policy — SPEC §3.1 Decision-2).
      SELECT EXISTS (
        SELECT 1 FROM public.event_dates ed
         WHERE ed.event_id = p_event_id
      ) INTO v_has_event_dates;

      IF NOT v_has_event_dates THEN
        v_scan_result := 'success';
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.event_dates ed
           WHERE ed.event_id = p_event_id
             AND now() BETWEEN (ed.start_at - c_grace_before)
                            AND (ed.end_at   + c_grace_after)
        ) INTO v_in_window;

        IF v_in_window THEN
          v_scan_result := 'success';
        ELSE
          SELECT MIN(ed.start_at) INTO v_next_start
            FROM public.event_dates ed
           WHERE ed.event_id = p_event_id
             AND ed.start_at - c_grace_before > now();

          IF v_next_start IS NOT NULL THEN
            v_scan_result := 'not_yet_open';
          ELSE
            v_scan_result := 'event_ended';
            SELECT MAX(ed.end_at) INTO v_last_end
              FROM public.event_dates ed
             WHERE ed.event_id = p_event_id;
          END IF;
        END IF;
      END IF;

      IF v_scan_result = 'success' THEN
        UPDATE public.tickets
           SET status = 'used',
               used_at = now(),
               used_by_scanner_id = p_scanner_user_id
         WHERE id = v_ticket.id;
      END IF;
    END IF;
  END IF;

  IF v_ticket_id IS NOT NULL THEN
    v_scan_event_id := CASE
      WHEN v_scan_result = 'wrong_event' THEN v_ticket.event_id
      ELSE p_event_id
    END;

    INSERT INTO public.scan_events (
      ticket_id, event_id, scanner_user_id, scan_result, client_offline,
      synced_at, metadata
    ) VALUES (
      v_ticket_id, v_scan_event_id, p_scanner_user_id, v_scan_result, false, now(),
      jsonb_build_object(
        'source', 'scan-ticket',
        'requestedEventId', p_event_id,
        'buyerName', COALESCE(v_ticket.buyer_name, ''),
        'ticketName', COALESCE(v_ticket.ticket_name, ''),
        'nextStartAt', v_next_start,
        'lastEndAt', v_last_end
      )
    )
    RETURNING id INTO v_scan_id;
  END IF;

  RETURN jsonb_build_object(
    'result', v_scan_result,
    'scanId', v_scan_id,
    'ticketId', v_ticket_id,
    'orderId', v_ticket.order_id,
    'buyerName', v_ticket.buyer_name,
    'ticketName', v_ticket.ticket_name,
    'nextStartAt', v_next_start,
    'lastEndAt', v_last_end
  );
END;
$$;

REVOKE ALL ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) TO service_role;

COMMENT ON FUNCTION public.biz_ticket_scan(uuid, text, uuid, text) IS
  'ORCH-1051 + ORCH-0793 — scanner RPC. Validates scanner auth (event_scanners OR brand_team_members.role=scanner — ORCH-1051), QR signature, payment, ticket status, event match, and time-window membership against event_dates [start_at - 120min, end_at + 360min]. Invariants I-PROPOSED-BB SCAN_TIME_WINDOW_ENFORCED + I-PROPOSED-BC SCANNER_AUTH_HONORS_BRAND_TEAM_MEMBERS_SCANNER.';

-- =============================================================
-- §6. Verification probes — fail loudly if state drifted.
-- =============================================================
DO $$
DECLARE
  v_body text;
BEGIN
  -- Probe 1: table exists with expected shape
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='scanner_invitations'
  ) THEN
    RAISE EXCEPTION 'ORCH-1051 probe failed: scanner_invitations missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='scanner_invitations'
      AND column_name='scope'
  ) THEN
    RAISE EXCEPTION 'ORCH-1051 probe failed: scanner_invitations.scope missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='scanner_invitations'
      AND column_name='token_hash'
  ) THEN
    RAISE EXCEPTION 'ORCH-1051 probe failed: scanner_invitations.token_hash missing';
  END IF;

  -- Probe 2: accept RPC registered
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='accept_scanner_invitation'
  ) THEN
    RAISE EXCEPTION 'ORCH-1051 probe failed: accept_scanner_invitation RPC not registered';
  END IF;

  -- Probe 3: biz_ticket_scan body references brand_team_members + role='scanner'
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'biz_ticket_scan';

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'ORCH-1051 probe failed: biz_ticket_scan function not found post-migration';
  END IF;
  IF v_body NOT LIKE '%brand_team_members%' THEN
    RAISE EXCEPTION 'ORCH-1051 probe failed: biz_ticket_scan body lacks brand_team_members reference';
  END IF;
  IF v_body NOT LIKE '%event_dates%' THEN
    RAISE EXCEPTION 'ORCH-1051 probe failed: biz_ticket_scan body lost event_dates reference (ORCH-0793 regression)';
  END IF;
  IF v_body NOT LIKE '%event_scanners%' THEN
    RAISE EXCEPTION 'ORCH-1051 probe failed: biz_ticket_scan body lost event_scanners reference (must honor BOTH paths)';
  END IF;
END$$;
