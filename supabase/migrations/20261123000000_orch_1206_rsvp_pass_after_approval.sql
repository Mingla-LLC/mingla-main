-- ===========================================================================
-- ORCH-1206 — the RSVP QR pass is delivered ONLY after approval
-- ===========================================================================
-- SPEC: Mingla_Artifacts/specs/SPEC_ORCH-1206_RSVP_QR_PASS_ONLY_AFTER_APPROVAL.md
-- Follow-on to ORCH-1203 (20261122000000). Backend-only; no client/UI change.
--
-- Problem: for manual-approval RSVP events a "going" submission resolves to
-- going+pending, but the QR entry pass was delivered immediately (submit path)
-- and the host-approve RPCs sent only a no-QR `rsvp_approved` notice — so a
-- PENDING guest got their scannable pass before the host approved, and the pass
-- never rode the approval. The ORCH-1203 backfill likewise gated on going only.
--
-- Desired (I-1): the QR `rsvp_pass` is delivered to a recipient IFF
--   rsvp_status='going' AND approval_status='approved'.
--   • Auto-approve events  → going+approved at submit → pass immediate (the edge
--     submit path's C-1 gate; unchanged behaviour).
--   • Manual events        → going+pending at submit → NO pass; the host-approve
--     RPC enqueues the QR pass at approval time (I-2), promptly.
--
-- This migration:
--   (1) enqueue_rsvp_pass(p_rsvp_id) — the SINGLE-OWNER SQL routine (I-4) that
--       builds the rich rsvp_pass payload for primary + each guest, mints the qr
--       via the shared biz_rsvp_mint_qr (I-5) when null, and inserts one
--       rsvp_notifications row per recipient under the CANONICAL idempotency key
--       `rsvp_pass:<rsvpId>:<guestId|primary>` (I-3), ON CONFLICT DO NOTHING.
--       Used by BOTH host-approve RPCs AND the backfill.
--   (2) host_set_rsvp_status — byte-faithful to 20261004000000 EXCEPT: on a
--       transition INTO going+approved, enqueue the QR pass via (1) instead of
--       the no-QR `rsvp_approved` notice. rsvp_denied / rsvp_removed unchanged.
--   (3) host_bulk_approve_rsvps — same delta, per approved row.
--   (4) backfill_going_rsvp_qr_codes — add `AND approval_status='approved'` to
--       BOTH the primary and guest selects, and migrate its enqueue OFF the
--       second (ORCH-1203 backfill-only) keyspace ONTO the canonical rsvp_pass:
--       key (I-3) by delegating the enqueue to (1). One keyspace across submit/
--       approve/backfill → exactly-once per recipient.
--
-- Monotonicity: prefix 20261123000000 is strictly greater than every migration
-- on origin/main (max 20261122000000 = ORCH-1203) AND every active sibling
-- worktree (max head 20261122000000). Clear of 1122; headroom against in-flight.
--
-- Conventions: GRANT/REVOKE after the closing $$ ; ; no cron change (the
-- ORCH-1203 every-15-min backfill cron already drains; its edge-fn drain filter
-- was widened to the canonical keyspace in this PR).
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- (1) SINGLE-OWNER SQL enqueue routine (I-4). Builds the SAME rich rsvp_pass
--     payload shape the edge submit path (dispatchRsvpPasses) builds, for the
--     primary + each guest of an RSVP, mints the qr via the shared
--     biz_rsvp_mint_qr (I-5) if missing, and inserts ONE rsvp_notifications row
--     per recipient with the CANONICAL idempotency key
--     `rsvp_pass:<rsvpId>:<guestId|primary>` (I-3) — IDENTICAL to the TS submit
--     key form `rsvp_pass:${rsvpId}:${guestId ?? 'primary'}`. ON CONFLICT DO
--     NOTHING makes it exactly-once across submit / approve / backfill.
--
--     The pepper is PASSED IN (edge-fn env owns it post-ORCH-0777). When the
--     pepper is absent the qr cannot be minted — the routine STILL enqueues the
--     pass for any recipient that already has a non-null qr, and SKIPS any whose
--     qr is null (the ORCH-1203 backfill re-mints+enqueues those once the pepper
--     returns). Never RAISES on a missing pepper (callers must stay robust).
--
--     dateLine is NULL here (matching the ORCH-1203 backfill SQL precedent —
--     the human date line is only computed in the TS submit path; the email
--     body simply omits it, Constitution #9 no-fabrication). All other payload
--     keys mirror the TS shape exactly so handleRsvpPass reads them identically.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_rsvp_pass(
  p_rsvp_id         uuid,
  p_qr_token_pepper text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_rsvp        public.event_rsvps%ROWTYPE;
  v_event       public.events%ROWTYPE;
  v_brand_name  text;
  v_brand_slug  text;
  v_deep_link   text;
  v_pepper      text;
  v_enqueued    integer := 0;
  v_token_hash  text;
  v_primary_qr  text;
  v_guest       record;
  v_guest_qr    text;
BEGIN
  SELECT * INTO v_rsvp FROM public.event_rsvps WHERE id = p_rsvp_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  -- I-1 guard: only ever enqueue for a going+approved RSVP.
  IF v_rsvp.rsvp_status <> 'going' OR v_rsvp.approval_status <> 'approved' THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = v_rsvp.event_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Pepper pre-flight (never RAISE — absent pepper means qr-less recipients are
  -- skipped, re-minted later by the ORCH-1203 backfill).
  BEGIN
    v_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);
  EXCEPTION WHEN OTHERS THEN
    v_pepper := NULL;
  END;

  SELECT b.name, b.slug INTO v_brand_name, v_brand_slug
    FROM public.brands b WHERE b.id = v_event.brand_id;
  v_brand_name := COALESCE(v_brand_name, 'Mingla');
  v_deep_link := CASE
    WHEN v_brand_slug IS NOT NULL AND v_event.slug IS NOT NULL
      THEN 'https://usemingla.com/e/' || v_brand_slug || '/' || v_event.slug
    ELSE 'https://usemingla.com'
  END;

  -- ---- PRIMARY ----
  v_primary_qr := v_rsvp.qr_code;
  IF v_primary_qr IS NULL AND v_pepper IS NOT NULL THEN
    SELECT m.token_hash, m.qr_code INTO v_token_hash, v_primary_qr
      FROM public.biz_rsvp_mint_qr(p_rsvp_id, v_pepper) m;
    UPDATE public.event_rsvps
       SET qr_token_hash = v_token_hash, qr_code = v_primary_qr
     WHERE id = p_rsvp_id;
  END IF;

  IF v_primary_qr IS NOT NULL THEN
    INSERT INTO public.rsvp_notifications
      (event_id, rsvp_id, channel, recipient, status, template_key, payload,
       idempotency_key, attempt_count)
    VALUES (
      v_event.id, p_rsvp_id, NULL, v_rsvp.guest_email, 'pending', 'rsvp_pass',
      jsonb_build_object(
        'template_key',   'rsvp_pass',
        'rsvp_id',        p_rsvp_id,
        'event_id',       v_event.id,
        'recipientEmail', v_rsvp.guest_email,
        'recipientName',  v_rsvp.guest_name,
        'qrCode',         v_primary_qr,
        'matchedUserId',  NULL,
        'primaryUserId',  v_rsvp.user_id,
        'role',           'primary',
        'eventName',      COALESCE(v_event.title, 'your event'),
        'dateLine',       NULL,
        'venueLine',      v_event.location_text,
        'brandName',      v_brand_name,
        'brandId',        v_event.brand_id,
        'deepLink',       v_deep_link
      ),
      'rsvp_pass:' || p_rsvp_id::text || ':primary',
      0
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
    IF FOUND THEN
      v_enqueued := v_enqueued + 1;
    END IF;
  END IF;

  -- ---- GUESTS ----
  FOR v_guest IN
    SELECT id, name, email, qr_code, matched_user_id
      FROM public.event_rsvp_guests
     WHERE rsvp_id = p_rsvp_id
  LOOP
    v_guest_qr := v_guest.qr_code;
    IF v_guest_qr IS NULL AND v_pepper IS NOT NULL THEN
      SELECT m.token_hash, m.qr_code INTO v_token_hash, v_guest_qr
        FROM public.biz_rsvp_mint_qr(v_guest.id, v_pepper) m;
      UPDATE public.event_rsvp_guests
         SET qr_token_hash = v_token_hash, qr_code = v_guest_qr
       WHERE id = v_guest.id;
    END IF;

    IF v_guest_qr IS NOT NULL THEN
      INSERT INTO public.rsvp_notifications
        (event_id, rsvp_id, channel, recipient, status, template_key, payload,
         idempotency_key, attempt_count)
      VALUES (
        v_event.id, p_rsvp_id, NULL, v_guest.email, 'pending', 'rsvp_pass',
        jsonb_build_object(
          'template_key',   'rsvp_pass',
          'rsvp_id',        p_rsvp_id,
          'event_id',       v_event.id,
          'recipientEmail', v_guest.email,
          'recipientName',  v_guest.name,
          'qrCode',         v_guest_qr,
          'matchedUserId',  v_guest.matched_user_id,
          'primaryUserId',  NULL,
          'role',           'guest',
          'eventName',      COALESCE(v_event.title, 'your event'),
          'dateLine',       NULL,
          'venueLine',      v_event.location_text,
          'brandName',      v_brand_name,
          'brandId',        v_event.brand_id,
          'deepLink',       v_deep_link
        ),
        'rsvp_pass:' || p_rsvp_id::text || ':' || v_guest.id::text,
        0
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
      IF FOUND THEN
        v_enqueued := v_enqueued + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN v_enqueued;
END;
$$;

COMMENT ON FUNCTION public.enqueue_rsvp_pass(uuid, text) IS
  'ORCH-1206 — single-owner SQL enqueue (I-4) for the QR rsvp_pass. Builds the '
  'rich payload for primary + each guest of a going+approved RSVP, mints the qr '
  'via the shared biz_rsvp_mint_qr (I-5) when null, and inserts one '
  'rsvp_notifications row per recipient under the CANONICAL key '
  'rsvp_pass:<rsvpId>:<guestId|primary> (I-3), ON CONFLICT DO NOTHING. Used by '
  'host_set_rsvp_status, host_bulk_approve_rsvps, and backfill_going_rsvp_qr_codes. '
  'Returns the count of rows newly enqueued.';

-- ---------------------------------------------------------------------------
-- (2) host_set_rsvp_status — REDEFINE byte-faithful to 20261004000000 EXCEPT
--     the enqueue: a transition INTO going+approved now enqueues the QR pass
--     via enqueue_rsvp_pass (I-2/I-4) instead of the no-QR rsvp_approved notice
--     (don't send both — the QR pass IS the approval confirmation). The
--     rsvp_denied / rsvp_removed notices are UNCHANGED. The capacity gate,
--     waitlisted->going promotion, idempotent no-op, permission check, and the
--     pending/going count math are all verbatim.
--
--     SIGNATURE UNCHANGED — host_set_rsvp_status(uuid, text). The business app
--     calls this 2-arg from rsvpApprovals.ts; adding a param would create a
--     separate overload and leave the 2-arg call resolving to the OLD function.
--     The pepper is NOT needed here: submit_event_rsvp ALREADY mints the qr for
--     a going submission even when manual-pending (its mint gate is
--     `v_status='going' AND pepper`, and a manual going submit resolves to
--     going+pending) — so at approval time the qr is already present and
--     enqueue_rsvp_pass(rsvp_id, NULL) finds it and enqueues without minting.
--     The ORCH-1203 backfill (pepper-bearing) is the safety net for the rare
--     submit-without-pepper case (re-mints + re-delivers once the pepper returns).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.host_set_rsvp_status(
  p_rsvp_id uuid,
  p_status  text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id    uuid;
  v_rsvp       public.event_rsvps%ROWTYPE;
  v_event      public.events%ROWTYPE;
  v_source     text;
  v_confirmed  integer;
  v_was_removed boolean := false;
  v_template   text;
  v_pending    integer;
  v_going      integer;
  v_new_status text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_status NOT IN ('approved', 'denied') THEN
    RAISE EXCEPTION 'rsvp_status_invalid';
  END IF;

  SELECT * INTO v_rsvp FROM public.event_rsvps WHERE id = p_rsvp_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rsvp_not_found';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = v_rsvp.event_id FOR UPDATE;
  IF NOT FOUND OR v_event.event_type <> 'rsvp' THEN
    RAISE EXCEPTION 'event_not_an_rsvp';
  END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  v_source := v_rsvp.approval_status;

  -- Idempotent: re-applying current status is a no-op.
  IF v_source = p_status THEN
    SELECT count(*) FILTER (WHERE approval_status = 'pending') ,
           COALESCE(SUM(1 + plus_count) FILTER (WHERE rsvp_status = 'going' AND approval_status = 'approved'), 0)
      INTO v_pending, v_going
      FROM public.event_rsvps WHERE event_id = v_event.id;
    RETURN jsonb_build_object('ok', true, 'rsvpId', p_rsvp_id, 'approvalStatus', p_status,
      'wasRemoved', false, 'pendingCountRemaining', v_pending, 'goingCountRemaining', v_going);
  END IF;

  -- denied is terminal for a remove; a denied->approved re-admit is allowed
  -- (re-approve), but denied->denied handled above; otherwise valid transitions:
  -- pending->approved, pending->denied, approved->denied (remove), denied->approved.
  IF p_status = 'approved' THEN
    -- Capacity gate on approve.
    IF v_event.rsvp_capacity IS NOT NULL THEN
      SELECT COALESCE(SUM(1 + r.plus_count), 0) INTO v_confirmed
        FROM public.event_rsvps r
       WHERE r.event_id = v_event.id
         AND r.rsvp_status = 'going' AND r.approval_status = 'approved'
         AND r.id <> p_rsvp_id;
      IF (v_confirmed + 1 + v_rsvp.plus_count) > v_event.rsvp_capacity THEN
        RAISE EXCEPTION 'rsvp_capacity_full';
      END IF;
    END IF;
    UPDATE public.event_rsvps
       SET approval_status = 'approved',
           rsvp_status = CASE WHEN rsvp_status = 'waitlisted' THEN 'going' ELSE rsvp_status END
     WHERE id = p_rsvp_id;
    -- ORCH-1206 (I-2): the QR pass IS the approval confirmation. Enqueue it via
    -- the single-owner routine for going+approved recipients (primary + guests)
    -- under the canonical key (I-3); REPLACES the no-QR rsvp_approved notice.
    -- Read back the resolved attendance to confirm going (waitlisted->going).
    SELECT rsvp_status INTO v_new_status FROM public.event_rsvps WHERE id = p_rsvp_id;
    IF v_new_status = 'going' THEN
      PERFORM public.enqueue_rsvp_pass(p_rsvp_id, NULL);
    END IF;
    v_template := NULL;  -- no plain rsvp_approved notice; the QR pass covers it.
  ELSE
    -- denied. approved->denied = host remove.
    v_was_removed := (v_source = 'approved');
    UPDATE public.event_rsvps
       SET approval_status = 'denied'
     WHERE id = p_rsvp_id;
    v_template := CASE WHEN v_was_removed THEN 'rsvp_removed' ELSE 'rsvp_denied' END;
  END IF;

  -- rsvp_denied / rsvp_removed notices unchanged; the approve branch sets
  -- v_template := NULL (the QR pass is its own notification) and skips this.
  IF v_template IS NOT NULL THEN
    INSERT INTO public.rsvp_notifications
      (event_id, rsvp_id, channel, recipient, status, template_key, payload,
       idempotency_key, attempt_count)
    VALUES
      (v_event.id, p_rsvp_id, NULL, NULL, 'pending', v_template,
       jsonb_build_object('template_key', v_template, 'rsvp_id', p_rsvp_id, 'event_id', v_event.id),
       'rsvp_approval:' || p_rsvp_id::text || ':' || v_source || ':' || p_status,
       0)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  SELECT count(*) FILTER (WHERE approval_status = 'pending'),
         COALESCE(SUM(1 + plus_count) FILTER (WHERE rsvp_status = 'going' AND approval_status = 'approved'), 0)
    INTO v_pending, v_going
    FROM public.event_rsvps WHERE event_id = v_event.id;

  RETURN jsonb_build_object(
    'ok', true, 'rsvpId', p_rsvp_id, 'approvalStatus', p_status,
    'wasRemoved', v_was_removed,
    'pendingCountRemaining', v_pending, 'goingCountRemaining', v_going
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.host_set_rsvp_status(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- (3) host_bulk_approve_rsvps — REDEFINE byte-faithful to 20261004000000 EXCEPT
--     the per-row enqueue: each approved row now enqueues the QR pass via
--     enqueue_rsvp_pass (I-2/I-4) under the canonical key (I-3) instead of the
--     no-QR rsvp_approved notice. The capacity fan-out (free-seat accounting,
--     skip-for-capacity, waitlisted->going) is verbatim. SIGNATURE UNCHANGED
--     (uuid) — same overload-resolution + already-minted-qr reasoning as
--     host_set_rsvp_status; enqueue with a NULL pepper.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.host_bulk_approve_rsvps(
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id     uuid;
  v_event       public.events%ROWTYPE;
  v_confirmed   integer;
  v_free        integer;
  v_entry       record;
  v_approved    integer := 0;
  v_skipped     integer := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.event_type <> 'rsvp' THEN
    RAISE EXCEPTION 'event_not_an_rsvp';
  END IF;
  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT COALESCE(SUM(1 + plus_count), 0) INTO v_confirmed
    FROM public.event_rsvps
   WHERE event_id = p_event_id AND rsvp_status = 'going' AND approval_status = 'approved';
  v_free := CASE WHEN v_event.rsvp_capacity IS NULL THEN NULL ELSE v_event.rsvp_capacity - v_confirmed END;

  FOR v_entry IN
    SELECT id, plus_count FROM public.event_rsvps
     WHERE event_id = p_event_id AND approval_status = 'pending'
     ORDER BY created_at ASC
  LOOP
    IF v_free IS NOT NULL AND (1 + v_entry.plus_count) > v_free THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    UPDATE public.event_rsvps
       SET approval_status = 'approved',
           rsvp_status = CASE WHEN rsvp_status = 'waitlisted' THEN 'going' ELSE rsvp_status END
     WHERE id = v_entry.id;
    -- ORCH-1206 (I-2): enqueue the QR pass per approved row via the single-owner
    -- routine under the canonical key (I-3); REPLACES the no-QR rsvp_approved
    -- notice. enqueue_rsvp_pass self-gates on going+approved (waitlisted rows
    -- were just promoted to going above).
    PERFORM public.enqueue_rsvp_pass(v_entry.id, NULL);
    v_approved := v_approved + 1;
    IF v_free IS NOT NULL THEN
      v_free := v_free - (1 + v_entry.plus_count);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('approvedCount', v_approved, 'skippedForCapacity', v_skipped);
END;
$$;

GRANT EXECUTE ON FUNCTION public.host_bulk_approve_rsvps(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- (4) backfill_going_rsvp_qr_codes — REDEFINE (ORCH-1203, 20261122000000). Two
--     deltas, the rest verbatim:
--       (a) C-3 / I-1: add `AND r.approval_status = 'approved'` to BOTH the
--           primary and guest selects so a going+PENDING row never gets a pass.
--       (b) I-3: migrate the enqueue OFF the second (ORCH-1203 backfill-only)
--           keyspace ONTO the canonical rsvp_pass:<rsvpId>:<guestId|primary> by
--           delegating to enqueue_rsvp_pass (which mints+enqueues both primary
--           and guests). The backfill loop still gates each minted row but the
--           ENQUEUE is single-owner now. This means submit / approve / backfill
--           all share ONE keyspace → exactly-once per recipient.
--
--     Pepper still PASSED IN; no-op (returns 0) when absent. Returns the count
--     of newly-enqueued pass rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.backfill_going_rsvp_qr_codes(
  p_qr_token_pepper text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_pepper      text;
  v_enqueued    integer := 0;
  v_rsvp_id     uuid;
BEGIN
  -- (a) Pepper pre-flight — passed in by the caller (edge fn env; ORCH-0777
  --     removed the DB GUC). No-op (NOT raise) when absent / short / placeholder
  --     so the cron never errors mid-rotation.
  BEGIN
    v_pepper := public.biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper);
  EXCEPTION WHEN OTHERS THEN
    v_pepper := NULL;
  END;
  IF v_pepper IS NULL THEN
    RETURN 0;
  END IF;

  -- (b) Every going+APPROVED RSVP (I-1) with a NULL qr on the primary OR any
  --     guest. Delegate the MINT + canonical-key ENQUEUE to the single-owner
  --     enqueue_rsvp_pass (I-3/I-4) — it mints null qrs and enqueues primary +
  --     guests under rsvp_pass:<rsvpId>:<...> ON CONFLICT DO NOTHING. DISTINCT
  --     so each rsvp is processed once even when both primary and a guest are
  --     null. Pending/denied/waitlisted/maybe/not_going rows are excluded.
  FOR v_rsvp_id IN
    SELECT DISTINCT r.id
      FROM public.event_rsvps r
      JOIN public.events e ON e.id = r.event_id
      LEFT JOIN public.event_rsvp_guests g ON g.rsvp_id = r.id
     WHERE r.rsvp_status = 'going'
       AND r.approval_status = 'approved'
       AND e.event_type = 'rsvp'
       AND (r.qr_code IS NULL OR g.qr_code IS NULL)
  LOOP
    v_enqueued := v_enqueued + public.enqueue_rsvp_pass(v_rsvp_id, v_pepper);
  END LOOP;

  RETURN v_enqueued;
END;
$$;

COMMENT ON FUNCTION public.backfill_going_rsvp_qr_codes(text) IS
  'ORCH-1206 (was ORCH-1203 GAP-C1) — idempotently mints + delivers the QR '
  'rsvp_pass for any going+APPROVED RSVP/guest left with qr_code=NULL, via the '
  'single-owner enqueue_rsvp_pass (canonical key rsvp_pass:<rsvpId>:<guestId|'
  'primary>, I-3/I-4). Gates on approval_status=approved (I-1) so a pending pass '
  'is never sent. No-ops when the pepper is absent. Returns the count enqueued.';

COMMIT;

-- ===========================================================================
-- GRANTs / REVOKEs — service-role only; locked down from anon + PUBLIC.
-- (host_* RPCs are authenticated, granted inline above.)
-- ===========================================================================
REVOKE EXECUTE ON FUNCTION public.enqueue_rsvp_pass(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_rsvp_pass(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.enqueue_rsvp_pass(uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.backfill_going_rsvp_qr_codes(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backfill_going_rsvp_qr_codes(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.backfill_going_rsvp_qr_codes(text) TO service_role;
