-- ORCH-1384 [partner brand-management verbs] — link lifecycle coherence.
-- Adds: cancelled_reason column; owner-read RLS; invitation-kill trigger;
-- partner_cancel_pending_link / partner_disconnect_link /
-- partner_reissue_brand_invitation RPCs.
-- I-PROPOSED-1331-LINK-COLUMNS-FROZEN: this migration ADDS a column and stamps
-- EXISTING columns; it renames nothing. Compatible by the invariant's own text.
BEGIN;

-- 1. cancelled_reason ------------------------------------------------------
ALTER TABLE public.partner_brand_links
  ADD COLUMN IF NOT EXISTS cancelled_reason text;
ALTER TABLE public.partner_brand_links
  DROP CONSTRAINT IF EXISTS partner_brand_links_cancelled_reason_check;
ALTER TABLE public.partner_brand_links
  ADD CONSTRAINT partner_brand_links_cancelled_reason_check CHECK (
    cancelled_reason IS NULL
    OR (cancelled_at IS NOT NULL AND cancelled_reason IN
        ('partner_cancelled','owner_declined','invitation_revoked',
         'partner_disconnected','owner_removed'))
  );
COMMENT ON COLUMN public.partner_brand_links.cancelled_reason IS
  'ORCH-1384: why the link terminated. NULL allowed (legacy stamps). Values: partner_cancelled | owner_declined | invitation_revoked | partner_disconnected | owner_removed.';

-- 2. Owner-read RLS (inline predicate per feedback_rls_returning_owner_gap) -
DROP POLICY IF EXISTS partner_brand_links_owner_select ON public.partner_brand_links;
CREATE POLICY partner_brand_links_owner_select
  ON public.partner_brand_links
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = partner_brand_links.brand_id
      AND b.account_id = auth.uid()
  ));

-- 3. Invitation-kill trigger (F-6 side door + D-3 decline) ------------------
-- ORCH-1384 fails-on-revert proof 3 (SPEC §9): dropping this trigger — or its
-- `accepted_at IS NULL` guard — turns T-3/T-3c red. The trigger makes link
-- lifecycle coherence a DB property for EVERY invitation writer, present and
-- future (I-PROPOSED-1384-LINK-LIFECYCLE-COHERENCE).
CREATE OR REPLACE FUNCTION public.partner_brand_links_stamp_on_invite_kill()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp' AS $function$
BEGIN
  IF NEW.role = 'brand_owner'
     AND OLD.status = 'pending'
     AND NEW.status IN ('revoked','declined') THEN
    UPDATE public.partner_brand_links
       SET cancelled_at = now(),
           cancelled_reason = CASE NEW.status
             WHEN 'revoked' THEN 'invitation_revoked'
             ELSE 'owner_declined' END
     WHERE brand_id = NEW.brand_id
       AND lower(invited_owner_email) = lower(NEW.email)
       AND cancelled_at IS NULL
       AND accepted_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS partner_brand_links_invite_kill_trigger
  ON public.brand_invitations;
CREATE TRIGGER partner_brand_links_invite_kill_trigger
  AFTER UPDATE OF status ON public.brand_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.partner_brand_links_stamp_on_invite_kill();

-- =============================================================
-- 4. RPC 1 — partner_cancel_pending_link(p_link_id uuid)
--
--    Atomic cancel-pending verb (ruling OQ-2 / SC-6): in ONE transaction the
--    link is stamped cancelled/partner_cancelled, the pending invitation is
--    revoked, the pre-accept brand is soft-deleted, and default_brand_id is
--    cleared. I-PROPOSED-1384-CANCEL-IS-MULTI-OBJECT: only this RPC may
--    perform the quad-outcome; no partial outcome is observable under any
--    failure (plpgsql exceptions roll back the whole tx).
--
--    ORCH-1384 fails-on-revert proof 6 (SPEC §9): removing the brand
--    soft-delete or the invitation revoke turns T-7 red.
--
--    STEP ORDER IS LOAD-BEARING (SPEC §4.1 RPC-1): the invitation is locked
--    FIRST (same lock order as the accept RPC — serializes the cancel-vs-
--    accept race with no deadlock), the link is re-checked AFTER acquiring
--    that lock (an in-flight accept that held it commits first and the
--    re-check refuses → the brand a new owner just received is NEVER
--    deleted, SC-15), and the link is stamped BEFORE the invitation revoke
--    so the §3 trigger no-ops on its `cancelled_at IS NULL` predicate and
--    the reason stays 'partner_cancelled'.
-- =============================================================
CREATE OR REPLACE FUNCTION public.partner_cancel_pending_link(p_link_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid;
  v_link record;
  v_invitation record;
  v_invitation_found boolean := false;
  v_upcoming integer := 0;
  v_brand_deleted integer := 0;
BEGIN
  -- 1. Caller identity.
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Plain SELECT of the link (no lock — lock order puts the invitation
  --    first, mirroring the accept RPC).
  SELECT * INTO v_link
  FROM public.partner_brand_links
  WHERE id = p_link_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_link.partner_account_id <> v_caller THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Lock the invitation FIRST (cancel-vs-accept serialization point).
  --    May be empty (expired/declined/revoked histories) — cancel still
  --    proceeds; there is just nothing to revoke.
  SELECT * INTO v_invitation
  FROM public.brand_invitations
  WHERE brand_id = v_link.brand_id
    AND lower(email) = lower(v_link.invited_owner_email)
    AND role = 'brand_owner'
    AND status = 'pending'
  ORDER BY expires_at DESC
  LIMIT 1
  FOR UPDATE;
  v_invitation_found := FOUND;

  -- 4. Re-read the link FOR UPDATE and re-verify it is still pending. If an
  --    in-flight accept held the invitation lock, step 3 blocked until it
  --    committed and this re-check now refuses — the brand a new owner just
  --    received is NEVER deleted (SC-15).
  SELECT * INTO v_link
  FROM public.partner_brand_links
  WHERE id = p_link_id
  FOR UPDATE;
  IF v_link.cancelled_at IS NOT NULL OR v_link.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'link_not_pending' USING ERRCODE = 'P0001';
  END IF;

  -- 5. Upcoming-events blocker (OQ-1384-A default; mirrors softDeleteBrand
  --    semantics incl. the date-aware ORCH-0862 filter). Blocking count rides
  --    the DETAIL field (SC-7).
  SELECT count(DISTINCT e.id) INTO v_upcoming
  FROM public.events e
  JOIN public.event_dates d ON d.event_id = e.id
  WHERE e.brand_id = v_link.brand_id
    AND e.status IN ('scheduled', 'live')
    AND e.deleted_at IS NULL
    AND d.end_at > now();
  IF v_upcoming > 0 THEN
    RAISE EXCEPTION 'has_upcoming_events'
      USING ERRCODE = 'P0001', DETAIL = v_upcoming::text;
  END IF;

  -- 6. Stamp the link BEFORE touching the invitation — the step-7 trigger
  --    fire then no-ops on its `cancelled_at IS NULL` predicate and the
  --    reason stays 'partner_cancelled'.
  UPDATE public.partner_brand_links
     SET cancelled_at = now(),
         cancelled_reason = 'partner_cancelled'
   WHERE id = p_link_id;

  -- 7. Revoke the pending invitation (owner's accept URL → 410 invite_revoked).
  IF v_invitation_found THEN
    UPDATE public.brand_invitations
       SET status = 'revoked',
           revoked_at = now()
     WHERE id = v_invitation.id
       AND status = 'pending';
  END IF;

  -- 8. Brand soft-delete (ruling OQ-2), defensively owner-guarded: only the
  --    pre-accept brand still owned by the partner is ever deleted.
  UPDATE public.brands
     SET deleted_at = now()
   WHERE id = v_link.brand_id
     AND deleted_at IS NULL
     AND account_id = v_link.partner_account_id;
  GET DIAGNOSTICS v_brand_deleted = ROW_COUNT;

  -- 9. Clear the partner's default-brand pointer (mirrors softDeleteBrand
  --    step 3).
  UPDATE public.creator_accounts
     SET default_brand_id = NULL
   WHERE id = v_link.partner_account_id
     AND default_brand_id = v_link.brand_id;

  -- 10. Best-effort audit (exception-swallowed like the accept RPC's block).
  BEGIN
    INSERT INTO public.audit_log
      (user_id, brand_id, action, target_type, target_id, after)
    VALUES (
      v_caller,
      v_link.brand_id,
      'partner_link_cancelled',
      'partner_brand_link',
      p_link_id::text,
      jsonb_build_object(
        'brand_deleted', v_brand_deleted > 0,
        'invitation_revoked', v_invitation_found,
        'invited_owner_email', v_link.invited_owner_email
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 11. Result.
  RETURN jsonb_build_object(
    'link_id', p_link_id,
    'brand_id', v_link.brand_id,
    'brand_deleted', v_brand_deleted > 0,
    'invitation_revoked', v_invitation_found
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.partner_cancel_pending_link(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_cancel_pending_link(uuid) TO authenticated;

COMMENT ON FUNCTION public.partner_cancel_pending_link(uuid) IS
  'ORCH-1384: atomic partner cancel-pending verb — link stamp + invitation revoke + pre-accept brand soft-delete + default-brand clear in ONE transaction (I-PROPOSED-1384-CANCEL-IS-MULTI-OBJECT). Blocks with has_upcoming_events (count in DETAIL) when the brand still has upcoming scheduled/live events (OQ-1384-A).';

-- =============================================================
-- 5. RPC 2 — partner_disconnect_link(p_link_id uuid)
--
--    Dual-stamp disconnect for awaiting_stripe/active links (SC-8/SC-9):
--    partner_brand_links.cancelled_at AND the partner's
--    brand_team_members.removed_at stamp in the SAME transaction
--    (I-PROPOSED-1384-DISCONNECT-STAMPS-BOTH). The time-pinned resolver
--    (`removed_at IS NULL OR removed_at > p_at`, sole definition ORCH-1054)
--    is the only money gate: charges with p_at before the stamp still split;
--    at/after do not.
--
--    NO partner_splits writes of ANY kind (ruling OQ-1;
--    I-PROPOSED-1384-INFLIGHT-SPLITS-PAY-OUT): pending/retrying split rows
--    pay out untouched.
--
--    ORCH-1384 fails-on-revert proof 5 (SPEC §9): removing the team stamp
--    turns T-8 red.
-- =============================================================
CREATE OR REPLACE FUNCTION public.partner_disconnect_link(p_link_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller uuid;
  v_link record;
  v_owner uuid;
  v_reason text;
BEGIN
  -- 1. Caller identity.
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Lock the link; must be an ACTIVE (accepted, uncancelled) link —
  --    pending links use the cancel verb.
  SELECT * INTO v_link
  FROM public.partner_brand_links
  WHERE id = p_link_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_link.cancelled_at IS NOT NULL OR v_link.accepted_at IS NULL THEN
    RAISE EXCEPTION 'link_not_active' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Resolve the caller's side: partner-initiated vs owner-initiated.
  SELECT account_id INTO v_owner
  FROM public.brands
  WHERE id = v_link.brand_id;
  IF v_caller = v_link.partner_account_id THEN
    v_reason := 'partner_disconnected';
  ELSIF v_caller = v_owner THEN
    v_reason := 'owner_removed';
  ELSE
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  -- 4. Fail-close guard: never strip a CURRENT owner's membership.
  --    Structurally impossible for accepted links (accept transferred
  --    ownership away from the partner) — guard anyway.
  IF v_link.partner_account_id = v_owner THEN
    RAISE EXCEPTION 'partner_is_owner' USING ERRCODE = 'P0001';
  END IF;

  -- 5. Stamp the link.
  UPDATE public.partner_brand_links
     SET cancelled_at = now(),
         cancelled_reason = v_reason
   WHERE id = p_link_id;

  -- 6. Money truth (F-5): stamp the partner's team membership in the SAME
  --    transaction (I-PROPOSED-1384-DISCONNECT-STAMPS-BOTH). role <>
  --    'brand_owner' backstops step 4.
  UPDATE public.brand_team_members
     SET removed_at = now()
   WHERE brand_id = v_link.brand_id
     AND user_id = v_link.partner_account_id
     AND removed_at IS NULL
     AND role <> 'brand_owner';

  -- 7. NO partner_splits writes of any kind (ruling OQ-1;
  --    I-PROPOSED-1384-INFLIGHT-SPLITS-PAY-OUT). The time-pinned resolver is
  --    the only money gate.

  -- 8. Best-effort audit (swallowed).
  BEGIN
    INSERT INTO public.audit_log
      (user_id, brand_id, action, target_type, target_id, after)
    VALUES (
      v_caller,
      v_link.brand_id,
      'partner_link_disconnected',
      'partner_brand_link',
      p_link_id::text,
      jsonb_build_object('reason', v_reason)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 9. Result.
  RETURN jsonb_build_object(
    'link_id', p_link_id,
    'reason', v_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.partner_disconnect_link(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_disconnect_link(uuid) TO authenticated;

COMMENT ON FUNCTION public.partner_disconnect_link(uuid) IS
  'ORCH-1384: dual-stamp disconnect — link cancelled_at + partner brand_team_members.removed_at in ONE transaction (I-PROPOSED-1384-DISCONNECT-STAMPS-BOTH). Partner-initiated → partner_disconnected; owner-initiated → owner_removed. NEVER writes partner_splits (I-PROPOSED-1384-INFLIGHT-SPLITS-PAY-OUT).';

-- =============================================================
-- 6. RPC 3 — partner_reissue_brand_invitation(...)
--
--    Reissue verb backing the partner-reissue-invitation edge fn (which owns
--    JWT auth — hence service_role-only grant). Kills old token(s) by
--    EXPIRE-NOW, never by revoke (I-PROPOSED-1384-REISSUE-EXPIRES-NEVER-
--    REVOKES): a 'revoked' transition would fire the §3 trigger and
--    terminally cancel the link being reissued. Old tokens then die via the
--    accept RPC's existing P0003 invite_expired; the invite-brand-member 409
--    duplicate guard (status='pending' AND expires_at > now()) is naturally
--    released; the team screen's pending filter (expires_at > now) naturally
--    drops the stale row.
--
--    The email VALUE update + invited_at refresh cures F-7 + D-8 on this
--    path (I-1331 freezes column NAMES, not values): the accept RPC's
--    lower(invited_owner_email) = lower(v_invitation.email) stamp can now
--    match the corrected owner.
--
--    ORCH-1384 fails-on-revert proof 4 (SPEC §9): changing expire-now to a
--    revoke turns T-4 red (status must stay 'pending'; the link must survive
--    un-cancelled).
-- =============================================================
CREATE OR REPLACE FUNCTION public.partner_reissue_brand_invitation(
  p_link_id uuid,
  p_partner_account_id uuid,
  p_new_email text,
  p_token_hash text,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_link record;
  v_old record;
  v_name text;
  v_new_id uuid;
BEGIN
  -- 1. Belt-and-braces validation (edge fn also validates format).
  IF p_new_email IS NULL OR length(trim(p_new_email)) = 0 THEN
    RAISE EXCEPTION 'validation' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Lock + verify the link is a live pending link owned by the caller.
  SELECT * INTO v_link
  FROM public.partner_brand_links
  WHERE id = p_link_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_link.partner_account_id <> p_partner_account_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;
  IF v_link.cancelled_at IS NOT NULL OR v_link.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'link_not_pending' USING ERRCODE = 'P0001';
  END IF;

  -- 3. Latest prior invitation for invitee-name reuse (SELECT INTO leaves
  --    NULL fields when no row matches — COALESCE covers it).
  SELECT * INTO v_old
  FROM public.brand_invitations
  WHERE brand_id = v_link.brand_id
    AND lower(email) = lower(v_link.invited_owner_email)
    AND role = 'brand_owner'
  ORDER BY expires_at DESC
  LIMIT 1
  FOR UPDATE;
  v_name := COALESCE(v_old.invitee_name, split_part(p_new_email, '@', 1));

  -- 4. Kill old token(s) by EXPIRE-NOW, never by revoke
  --    (I-PROPOSED-1384-REISSUE-EXPIRES-NEVER-REVOKES).
  UPDATE public.brand_invitations
     SET expires_at = now()
   WHERE brand_id = v_link.brand_id
     AND lower(email) = lower(v_link.invited_owner_email)
     AND role = 'brand_owner'
     AND status = 'pending'
     AND expires_at > now();

  -- 5. Fresh invitation row for the (possibly corrected) address.
  INSERT INTO public.brand_invitations
    (brand_id, email, invitee_name, role, invited_by, token_hash,
     expires_at, status)
  VALUES
    (v_link.brand_id, p_new_email, v_name, 'brand_owner',
     p_partner_account_id, p_token_hash, p_expires_at, 'pending')
  RETURNING id INTO v_new_id;

  -- 6. Email VALUE update + invited_at refresh on the link (F-7/D-8 cure;
  --    I-1331 freezes column NAMES, not values).
  UPDATE public.partner_brand_links
     SET invited_owner_email = p_new_email,
         invited_at = now()
   WHERE id = p_link_id;

  -- 7. Best-effort audit (swallowed).
  BEGIN
    INSERT INTO public.audit_log
      (user_id, brand_id, action, target_type, target_id, after)
    VALUES (
      p_partner_account_id,
      v_link.brand_id,
      'partner_invitation_reissued',
      'brand_invitation',
      v_new_id::text,
      jsonb_build_object(
        'old_email', v_link.invited_owner_email,
        'new_email', p_new_email
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 8. Result.
  RETURN jsonb_build_object(
    'invitation_id', v_new_id,
    'invitee_name', v_name
  );
END;
$function$;

-- P0-1 REWORK amendment: the original `REVOKE ALL ... FROM PUBLIC;` here was a
-- proven false-green (TEST §3 P0-1 / ORCH-1338 P2-1 class) — Supabase's default
-- per-ROLE ACL leaves anon+authenticated with EXECUTE, and a PUBLIC revoke does
-- not strip a per-role grant. Explicit per-role revoke below; environments that
-- already applied the original text are converged by 20270103000000.
REVOKE EXECUTE ON FUNCTION public.partner_reissue_brand_invitation(uuid, uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_reissue_brand_invitation(uuid, uuid, text, text, timestamptz) TO service_role;

COMMENT ON FUNCTION public.partner_reissue_brand_invitation(uuid, uuid, text, text, timestamptz) IS
  'ORCH-1384: reissue verb (service_role-only; called by partner-reissue-invitation edge fn). Expires old pending tokens (NEVER revokes — I-PROPOSED-1384-REISSUE-EXPIRES-NEVER-REVOKES), inserts a fresh invitation, and atomically updates the link email VALUE + refreshes invited_at (F-7/D-8 cure).';

-- =============================================================
-- 7. Post-apply probes (read-only asserts — ORCH-1081 §8 style).
-- =============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='partner_brand_links'
      AND column_name='cancelled_reason'
  ) THEN
    RAISE EXCEPTION 'ORCH-1384 probe failed: cancelled_reason column missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='partner_brand_links_cancelled_reason_check'
  ) THEN
    RAISE EXCEPTION 'ORCH-1384 probe failed: cancelled_reason CHECK missing';
  END IF;
  IF (
    SELECT count(*) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname IN
      ('partner_cancel_pending_link','partner_disconnect_link',
       'partner_reissue_brand_invitation')
  ) <> 3 THEN
    RAISE EXCEPTION 'ORCH-1384 probe failed: expected 3 new RPCs';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname='partner_brand_links_invite_kill_trigger'
  ) THEN
    RAISE EXCEPTION 'ORCH-1384 probe failed: invite-kill trigger missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='partner_brand_links'
      AND policyname='partner_brand_links_owner_select'
  ) THEN
    RAISE EXCEPTION 'ORCH-1384 probe failed: owner_select policy missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename='partner_brand_links'
      AND indexname='partner_brand_links_partner_brand_active_idx'
  ) THEN
    RAISE EXCEPTION 'ORCH-1384 probe failed: partial unique index missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='partner_brand_link_status'
  ) THEN
    RAISE EXCEPTION 'ORCH-1384 probe failed: partner_brand_link_status fn missing (frozen ORCH-1081 case tree must survive)';
  END IF;
END$$;

COMMIT;
