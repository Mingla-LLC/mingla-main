-- ============================================================================
-- ORCH-0908 [Collab session lifecycle: Lock-In → Schedule → V_{n+1} Recycle]
-- Migration: 3 new RPCs + one-line amendment to ORCH-0902 trigger function
-- ============================================================================
--
-- Implements the SPEC at
-- `Mingla_Artifacts/specs/SPEC_ORCH-0908_COLLAB_SESSION_LIFECYCLE_LOCKIN_SCHEDULE_RECYCLE.md`
-- on top of the brutal corrected investigation at
-- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0908_v2_BRUTAL_CORRECTED.md`.
--
-- Hard dependency: ORCH-0902 [collab deck deterministic rewrite] must be live.
--   Verified 2026-05-21: session_deck_versions, pg_aggregate_collab_prefs,
--   query_servable_places_by_signal_union, recompute_deck_version_after_prefs_change,
--   collaboration_sessions.deck_version, collaboration_sessions.deck_params_hash
--   all confirmed live on project gqnoajqerqhnvulmnyvv.
--
-- What this migration adds:
--   1. rpc_admin_lock_card(session_id, saved_card_id) — admin/creator
--      unilateral lock; bypasses gang-consensus RSVP. Writes is_locked=true
--      with locked_by_consensus=false, transitions session.status='locked',
--      INSERTs a system message into the session group chat.
--   2. rpc_admin_schedule_locked_card(session_id, saved_card_id,
--      scheduled_at, duration_minutes) — admin updates all participants'
--      calendar_entries.scheduled_at in one transaction, calls
--      rpc_force_deck_recycle to mint V_{n+1} with the locked card excluded,
--      transitions session back to 'active', INSERTs schedule system message.
--   3. rpc_force_deck_recycle(session_id, exclude_place_ids[]) — increments
--      deck_version, augments the previous session_deck_versions params with
--      a merged exclude_place_ids array, computes a hash that DIFFERS from
--      the previous one (so V_{n+1} fetches fresh cards), and writes the
--      new history row. Uses a transaction-local GUC to suppress the
--      ORCH-0902 auto-recompute trigger from overwriting the excludes.
--   4. Amendment to ORCH-0902's recompute_deck_version_after_prefs_change:
--      one-line GUC check at top of function body so it returns NULL when
--      rpc_force_deck_recycle is the originator. No other behavior change.
--
-- All four ratify these DRAFT invariants:
--   I-PROPOSED-COLLAB-LOCK-ADMIN-OR-CONSENSUS
--   I-PROPOSED-COLLAB-SCHEDULE-ADMIN-ONLY
--   I-PROPOSED-COLLAB-CYCLE-EXCLUDES-MERGED
--   I-PROPOSED-COLLAB-SYSTEM-MESSAGE-ON-LIFECYCLE-EVENT
--
-- Existing downstream cascade reused unchanged:
--   - create_calendar_entries_on_lock trigger (baseline:4213-4267)
--   - check_card_lock_in trigger (baseline:3600-3658) — STAYS as second
--     lock path per Q-A operator decision
--   - realtime onCardLocked dispatch (realtimeService.ts:602-619)
--   - "Plan Locked In!" prompt modal (SessionViewModal.tsx:889-913)
--
-- Rollback strategy: single `git revert` of this migration's SQL. The new
-- RPCs are additive; the ORCH-0902 trigger amendment is one early-return
-- branch that becomes inert without the GUC.
-- ============================================================================

-- ============================================================================
-- 1. FUNCTION — rpc_admin_lock_card
-- ============================================================================
-- [ORCH-0908] [I-PROPOSED-COLLAB-LOCK-ADMIN-OR-CONSENSUS]
--
-- Auth: caller must be session creator OR session_participants.is_admin=true.
-- Idempotent: returns {status: 'already_locked'} on a card already locked
-- without re-firing downstream triggers.
--
-- Downstream cascade (reused from baseline):
--   board_saved_cards UPDATE is_locked=true
--     → create_calendar_entries_on_lock trigger fires
--       → inserts calendar_entries row per accepted participant
--         (scheduled_at is a placeholder; rpc_admin_schedule_locked_card
--          will overwrite it).
--     → realtimeService dispatches onCardLocked to all subscribers.
--   collaboration_sessions UPDATE status='locked'
--     → realtimeService dispatches onSessionUpdated.

CREATE OR REPLACE FUNCTION public.rpc_admin_lock_card(
  p_session_id uuid,
  p_saved_card_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_already_locked boolean;
  v_card_title text;
  v_session_conversation_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ORCH-0908: authentication required';
  END IF;

  -- Auth gate: creator OR session_participants.is_admin=true
  SELECT (cs.created_by = v_uid OR COALESCE(sp.is_admin, false) = true)
    INTO v_is_admin
    FROM public.collaboration_sessions cs
    LEFT JOIN public.session_participants sp
      ON sp.session_id = cs.id AND sp.user_id = v_uid
    WHERE cs.id = p_session_id;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'ORCH-0908: not authorized (creator or session admin required)';
  END IF;

  -- Verify card belongs to this session
  SELECT is_locked, card_data->>'title'
    INTO v_already_locked, v_card_title
    FROM public.board_saved_cards
    WHERE id = p_saved_card_id AND session_id = p_session_id;

  IF v_already_locked IS NULL THEN
    RAISE EXCEPTION 'ORCH-0908: card not found in this session';
  END IF;

  -- Idempotent: already locked
  IF v_already_locked = true THEN
    RETURN jsonb_build_object(
      'status', 'already_locked',
      'saved_card_id', p_saved_card_id,
      'session_id', p_session_id
    );
  END IF;

  -- The lock cascade. Both UPDATEs fire downstream triggers.
  UPDATE public.board_saved_cards
    SET is_locked = true,
        locked_at = NOW(),
        locked_by_consensus = false  -- admin/creator lock (NOT gang-consensus)
    WHERE id = p_saved_card_id;

  UPDATE public.collaboration_sessions
    SET status = 'locked',
        updated_at = NOW()
    WHERE id = p_session_id
      AND status IN ('pending', 'active', 'voting');

  -- Insert system message into the session's group conversation (ORCH-0898 substrate).
  -- sender_id=NULL marks it as a system message; client renders centered+muted
  -- per MessageBubble.tsx:156-163 when sender_id is null.
  SELECT id INTO v_session_conversation_id
    FROM public.conversations
    WHERE session_id = p_session_id
      AND linked_entity_type = 'session'
    LIMIT 1;

  IF v_session_conversation_id IS NOT NULL THEN
    INSERT INTO public.messages (
      conversation_id, sender_id, content, message_type, card_payload
    ) VALUES (
      v_session_conversation_id,
      NULL,
      '📌 Plan locked in: ' || COALESCE(v_card_title, 'a card'),
      'text',
      jsonb_build_object(
        'event', 'card_locked',
        'saved_card_id', p_saved_card_id,
        'locked_by_user_id', v_uid
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'locked',
    'saved_card_id', p_saved_card_id,
    'session_id', p_session_id,
    'locked_at', NOW()
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_admin_lock_card(uuid, uuid) IS
  'ORCH-0908: admin/creator unilateral lock of a matched card. Bypasses the gang-consensus RSVP path (check_card_lock_in trigger stays as second lock path). Writes is_locked=true with locked_by_consensus=false to distinguish from gang-lock for audit. Downstream create_calendar_entries_on_lock + realtime onCardLocked fire unchanged. Inserts a system message into the session group conversation via ORCH-0898 substrate. Idempotent on already-locked cards.';

GRANT EXECUTE ON FUNCTION public.rpc_admin_lock_card(uuid, uuid) TO authenticated;

-- ============================================================================
-- 2. FUNCTION — rpc_force_deck_recycle
-- ============================================================================
-- [ORCH-0908] [I-PROPOSED-COLLAB-CYCLE-EXCLUDES-MERGED]
--
-- Increments collaboration_sessions.deck_version and writes a new history row
-- in session_deck_versions whose aggregated_params include a merged
-- exclude_place_ids array. The merged array is monotonically non-decreasing
-- across cycles — once a place is excluded (because its card was locked in
-- a prior round), it stays excluded forever.
--
-- Trigger interaction: the ORCH-0902 recompute_deck_version_after_prefs_change
-- trigger fires on UPDATE OF participant_prefs, updated_at. This RPC UPDATEs
-- updated_at, so the trigger WILL fire — but the amendment in §4 below
-- short-circuits the trigger when the GUC orch_0908.force_recycle is 'true'.
-- We set the GUC with set_config(name, value, is_local=true) so it lives
-- exactly for the current transaction.

CREATE OR REPLACE FUNCTION public.rpc_force_deck_recycle(
  p_session_id uuid,
  p_exclude_place_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_current_version int;
  v_current_aggregated jsonb;
  v_previous_excludes jsonb;
  v_merged_excludes jsonb;
  v_new_aggregated jsonb;
  v_new_hash text;
  v_new_version int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ORCH-0908: authentication required';
  END IF;

  -- Auth gate
  SELECT (cs.created_by = v_uid OR COALESCE(sp.is_admin, false) = true)
    INTO v_is_admin
    FROM public.collaboration_sessions cs
    LEFT JOIN public.session_participants sp
      ON sp.session_id = cs.id AND sp.user_id = v_uid
    WHERE cs.id = p_session_id;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'ORCH-0908: not authorized (creator or session admin required)';
  END IF;

  -- Read current aggregation from current session state
  v_current_aggregated := public.pg_aggregate_collab_prefs(p_session_id);

  -- Read previous excludes from most recent session_deck_versions row, if any
  SELECT COALESCE(aggregated_params->'exclude_place_ids', '[]'::jsonb)
    INTO v_previous_excludes
    FROM public.session_deck_versions
    WHERE session_id = p_session_id
    ORDER BY deck_version DESC
    LIMIT 1;

  -- Merge previous + new excludes (deduplicated, sorted for deterministic hash)
  WITH all_ids AS (
    SELECT elem FROM jsonb_array_elements(COALESCE(v_previous_excludes, '[]'::jsonb)) AS elem
    UNION
    SELECT to_jsonb(uid::text) AS elem FROM unnest(COALESCE(p_exclude_place_ids, '{}'::uuid[])) AS uid
  )
  SELECT COALESCE(jsonb_agg(elem ORDER BY elem), '[]'::jsonb)
    INTO v_merged_excludes
    FROM (SELECT DISTINCT elem FROM all_ids) deduped;

  -- Augment aggregation with exclude list. This makes the hash differ from
  -- the previous version, forcing V_{n+1} mint (deterministically: same
  -- aggregation + same excludes → same hash → idempotent).
  v_new_aggregated := v_current_aggregated || jsonb_build_object(
    'exclude_place_ids', v_merged_excludes
  );

  v_new_hash := encode(
    extensions.digest(v_new_aggregated::text, 'sha256'::text),
    'hex'
  );

  -- Read current deck_version (used as old version for increment)
  SELECT COALESCE(deck_version, 0)
    INTO v_current_version
    FROM public.collaboration_sessions
    WHERE id = p_session_id;

  v_new_version := v_current_version + 1;

  -- Write the per-version params history row FIRST (matches ORCH-0902 ordering)
  INSERT INTO public.session_deck_versions (
    session_id, deck_version, params_hash, aggregated_params
  ) VALUES (
    p_session_id, v_new_version, v_new_hash, v_new_aggregated
  )
  ON CONFLICT (session_id, deck_version) DO NOTHING;

  -- Set transaction-local GUC so the ORCH-0902 trigger short-circuits.
  -- Third arg is_local=true makes the setting transaction-scoped (auto-resets
  -- at COMMIT/ROLLBACK; never leaks to other sessions or transactions).
  PERFORM set_config('orch_0908.force_recycle', 'true', true);

  -- Bump parent row with the recycle-aware hash. The ORCH-0902 trigger
  -- fires but returns NULL early because of the GUC check.
  UPDATE public.collaboration_sessions
    SET deck_version = v_new_version,
        deck_params_hash = v_new_hash,
        updated_at = NOW()
    WHERE id = p_session_id;

  RETURN v_new_version;
END;
$$;

COMMENT ON FUNCTION public.rpc_force_deck_recycle(uuid, uuid[]) IS
  'ORCH-0908 helper: forces a new deck_version for a session with a merged exclude_place_ids array. Called by rpc_admin_schedule_locked_card after a card is locked + scheduled to mint V_{n+1} with the locked card excluded forever. Uses transaction-local GUC orch_0908.force_recycle=true to suppress the ORCH-0902 recompute trigger from overwriting the recycle-aware hash. Excludes are monotonically non-decreasing across cycles (I-PROPOSED-COLLAB-CYCLE-EXCLUDES-MERGED).';

GRANT EXECUTE ON FUNCTION public.rpc_force_deck_recycle(uuid, uuid[]) TO authenticated;

-- ============================================================================
-- 3. FUNCTION — rpc_admin_schedule_locked_card
-- ============================================================================
-- [ORCH-0908] [I-PROPOSED-COLLAB-SCHEDULE-ADMIN-ONLY]
-- [I-PROPOSED-COLLAB-SYSTEM-MESSAGE-ON-LIFECYCLE-EVENT]
--
-- Updates ALL accepted participants' calendar_entries.scheduled_at for a
-- locked card in one statement (bypasses the per-user UPDATE that
-- CalendarService.updateEntry uses). Then calls rpc_force_deck_recycle
-- with the locked card's place_id as the exclusion, transitions the
-- session back to 'active' for the next round, and inserts a schedule
-- system message into the group conversation.

CREATE OR REPLACE FUNCTION public.rpc_admin_schedule_locked_card(
  p_session_id uuid,
  p_saved_card_id uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes int DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  v_is_locked boolean;
  v_card_title text;
  v_card_place_id uuid;
  v_session_conversation_id uuid;
  v_new_deck_version int;
  v_updated_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ORCH-0908: authentication required';
  END IF;

  -- Auth gate (same predicate as lock + recycle)
  SELECT (cs.created_by = v_uid OR COALESCE(sp.is_admin, false) = true)
    INTO v_is_admin
    FROM public.collaboration_sessions cs
    LEFT JOIN public.session_participants sp
      ON sp.session_id = cs.id AND sp.user_id = v_uid
    WHERE cs.id = p_session_id;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'ORCH-0908: not authorized (creator or session admin required)';
  END IF;

  -- Verify card is locked
  SELECT is_locked, card_data->>'title'
    INTO v_is_locked, v_card_title
    FROM public.board_saved_cards
    WHERE id = p_saved_card_id AND session_id = p_session_id;

  IF v_is_locked IS NULL THEN
    RAISE EXCEPTION 'ORCH-0908: card not found in this session';
  END IF;

  IF v_is_locked = false THEN
    RAISE EXCEPTION 'ORCH-0908: card must be locked before scheduling (call rpc_admin_lock_card first)';
  END IF;

  -- Input validation: scheduled_at must be 1 minute to 1 year in the future
  IF p_scheduled_at <= NOW() THEN
    RAISE EXCEPTION 'ORCH-0908: scheduled_at must be in the future';
  END IF;
  IF p_scheduled_at > NOW() + INTERVAL '1 year' THEN
    RAISE EXCEPTION 'ORCH-0908: scheduled_at cannot be more than 1 year out';
  END IF;
  IF p_duration_minutes IS NULL OR p_duration_minutes < 15 OR p_duration_minutes > 1440 THEN
    RAISE EXCEPTION 'ORCH-0908: duration_minutes must be between 15 and 1440';
  END IF;

  -- Update ALL accepted participants' calendar_entries rows for this card.
  -- The create_calendar_entries_on_lock trigger already inserted these rows
  -- with placeholder scheduled_at; we now overwrite with the user-picked value.
  UPDATE public.calendar_entries
    SET scheduled_at = p_scheduled_at,
        duration_minutes = p_duration_minutes,
        updated_at = NOW()
    WHERE board_card_id = p_saved_card_id
      AND source = 'collaboration';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  -- Resolve locked card → place_pool.id via google_place_id join
  -- (board_saved_cards.experience_id is the Google Place ID per
  --  baseline:7631 comment on the experience_id column).
  SELECT pp.id
    INTO v_card_place_id
    FROM public.place_pool pp
    JOIN public.board_saved_cards bsc ON bsc.experience_id = pp.google_place_id
    WHERE bsc.id = p_saved_card_id
    LIMIT 1;

  -- Recycle: mint V_{n+1} with the locked card's place_id added to exclude list.
  -- If we couldn't resolve a place_id (e.g., card is from a non-place source
  -- like an event), pass an empty exclude array — the recycle still mints
  -- a new deck_version because the hash will differ from the prior excludes
  -- (the merge is idempotent on identical input).
  IF v_card_place_id IS NULL THEN
    v_new_deck_version := public.rpc_force_deck_recycle(p_session_id, '{}'::uuid[]);
  ELSE
    v_new_deck_version := public.rpc_force_deck_recycle(p_session_id, ARRAY[v_card_place_id]::uuid[]);
  END IF;

  -- Transition session back to 'active' for the next round (cycle restart).
  -- The recycle UPDATE above already set the GUC; we set it again here in
  -- case the trigger fires on this UPDATE too (status is not in the trigger's
  -- watched columns, but updated_at is, so the trigger could re-fire).
  PERFORM set_config('orch_0908.force_recycle', 'true', true);

  UPDATE public.collaboration_sessions
    SET status = 'active',
        updated_at = NOW()
    WHERE id = p_session_id;

  -- Schedule system message into the group conversation
  SELECT id INTO v_session_conversation_id
    FROM public.conversations
    WHERE session_id = p_session_id
      AND linked_entity_type = 'session'
    LIMIT 1;

  IF v_session_conversation_id IS NOT NULL THEN
    INSERT INTO public.messages (
      conversation_id, sender_id, content, message_type, card_payload
    ) VALUES (
      v_session_conversation_id,
      NULL,
      '📅 Scheduled for ' || to_char(p_scheduled_at AT TIME ZONE 'UTC', 'Mon DD, HH24:MI') || ' UTC',
      'text',
      jsonb_build_object(
        'event', 'plan_scheduled',
        'saved_card_id', p_saved_card_id,
        'scheduled_at', p_scheduled_at,
        'duration_minutes', p_duration_minutes,
        'scheduled_by_user_id', v_uid
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'scheduled',
    'saved_card_id', p_saved_card_id,
    'session_id', p_session_id,
    'scheduled_at', p_scheduled_at,
    'duration_minutes', p_duration_minutes,
    'updated_participant_count', v_updated_count,
    'new_deck_version', v_new_deck_version
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_admin_schedule_locked_card(uuid, uuid, timestamptz, int) IS
  'ORCH-0908: admin/creator schedules a locked card for a specific date/time. Updates all accepted participants calendar_entries in one transaction, mints V_{n+1} with the locked card excluded (via rpc_force_deck_recycle), transitions session.status back to active (cycle restart), and inserts a system message into the session group conversation. Validates scheduled_at is 1 minute to 1 year in the future and duration is 15..1440 minutes. Returns updated_participant_count and new_deck_version for client cache invalidation.';

GRANT EXECUTE ON FUNCTION public.rpc_admin_schedule_locked_card(uuid, uuid, timestamptz, int) TO authenticated;

-- ============================================================================
-- 4. AMENDMENT — recompute_deck_version_after_prefs_change (ORCH-0902 trigger)
-- ============================================================================
-- [ORCH-0908] amendment to [ORCH-0902]
--
-- Original function at migration 20260625000000:525-579 recomputes the deck
-- version on participant_prefs / updated_at changes. ORCH-0908's
-- rpc_force_deck_recycle needs to UPDATE collaboration_sessions to commit
-- the recycle-aware hash (which includes exclude_place_ids), but that UPDATE
-- triggers this function — which would overwrite the hash with one that does
-- NOT include excludes.
--
-- Mitigation: this amended version checks a transaction-local GUC
-- 'orch_0908.force_recycle'. When the GUC is 'true' (set by
-- rpc_force_deck_recycle before its UPDATE), the trigger returns NULL early
-- and does not interfere. The GUC is auto-cleared at transaction COMMIT.
--
-- All other behavior is preserved verbatim from the ORCH-0902 original.

CREATE OR REPLACE FUNCTION public.recompute_deck_version_after_prefs_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_new_hash text;
  v_aggregated jsonb;
  v_old_version int;
  v_new_version int;
BEGIN
  -- [ORCH-0908] suppress when rpc_force_deck_recycle is the originator.
  -- The recycle RPC computes its own hash (which includes exclude_place_ids)
  -- and commits it directly; this trigger must NOT overwrite that.
  IF current_setting('orch_0908.force_recycle', true) = 'true' THEN
    RETURN NULL;
  END IF;

  -- Prevent recursion: this trigger issues a self-UPDATE below. Skip on recursive fire.
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  -- Aggregate from current row state (post-commit of the UPDATE).
  v_aggregated := public.pg_aggregate_collab_prefs(NEW.id);
  v_new_hash := encode(
    extensions.digest(v_aggregated::text, 'sha256'::text),
    'hex'
  );

  v_old_version := COALESCE(NEW.deck_version, 0);

  -- Hash unchanged → nothing to do
  IF v_new_hash IS NOT DISTINCT FROM NEW.deck_params_hash THEN
    RETURN NULL;
  END IF;

  v_new_version := v_old_version + 1;

  -- Write per-version history first (CR-4 resume support)
  INSERT INTO public.session_deck_versions (
    session_id, deck_version, params_hash, aggregated_params
  ) VALUES (
    NEW.id, v_new_version, v_new_hash, v_aggregated
  )
  ON CONFLICT (session_id, deck_version) DO NOTHING;

  -- Bump version + hash on the parent row. Re-fires this trigger but
  -- pg_trigger_depth() > 1 short-circuits the recursion.
  UPDATE public.collaboration_sessions
    SET deck_version = v_new_version,
        deck_params_hash = v_new_hash
    WHERE id = NEW.id;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.recompute_deck_version_after_prefs_change() IS
  'ORCH-0902 CR-3+CR-5: AFTER UPDATE trigger on collaboration_sessions. Recomputes pg_aggregate_collab_prefs from current state, hashes it, and if hash differs, bumps deck_version + inserts session_deck_versions row. ORCH-0908 amendment: early-returns when orch_0908.force_recycle GUC is true so rpc_force_deck_recycle can commit a recycle-aware hash (including exclude_place_ids) without being overwritten.';

-- ============================================================================
-- ORCH-0908 migration complete.
--
-- Operator: run `supabase db push --linked` to apply.
--
-- Post-push verification probe (orchestrator or operator runs):
--   SELECT
--     EXISTS (SELECT 1 FROM pg_proc WHERE proname='rpc_admin_lock_card') AS lock_rpc,
--     EXISTS (SELECT 1 FROM pg_proc WHERE proname='rpc_admin_schedule_locked_card') AS schedule_rpc,
--     EXISTS (SELECT 1 FROM pg_proc WHERE proname='rpc_force_deck_recycle') AS recycle_rpc;
--   -- All three should be true.
--
-- Then orchestrator deploys edge function changes per Standing Deploy Split.
-- ============================================================================
