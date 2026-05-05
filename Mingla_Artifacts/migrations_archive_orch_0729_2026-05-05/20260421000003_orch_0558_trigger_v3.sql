-- ORCH-0558 Step 3 — check_mutual_like v3 (bulletproof).
--
-- Changes from v2 (20260420000007_fix_mutual_like_trigger.sql):
--   (A) Advisory lock `pg_advisory_xact_lock(hashtextextended(session_id||'|'||experience_id, 0))`
--       at trigger entry — serializes concurrent triggers per
--       (session_id, experience_id) pair and closes the READ COMMITTED
--       race (RC-3 in INVESTIGATION_ORCH-0558).
--   (B) Idempotency guard — skip if TG_OP='UPDATE' AND OLD.swipe_state='swiped_right'.
--       Prevents re-firing quorum logic on redundant upserts (deck
--       regen, retry) — HF-7.
--   (C) ON CONFLICT (session_id, experience_id) DO NOTHING on promotion
--       INSERT — uses the unique constraint from migration 000002 as
--       belt. If lock is ever bypassed, unique constraint catches the
--       race; losing Tx attaches vote to winner instead of failing.
--   (D) After ORCH-0558 cleanup, existing-card shortcut uses experience_id
--       column ONLY (no `card_data->>'id'` fallback needed — ghosts are gone
--       and experience_id is NOT NULL). Simpler, faster, no dual-key
--       source-of-truth risk.
--   (E) Writes match_telemetry_events rows for every decision path
--       (observability, I-COLLAB-MATCH-OBSERVABLE).
--   (F) Dropped the pre-v3 redundant "double-check" block — lock +
--       unique constraint make it unnecessary.
--
-- Depends on: 20260421000002 (unique constraint must exist),
--             20260421000004 (telemetry table must exist — but we guard
--             the INSERT in case push order differs).
--
-- Enforces I-MATCH-PROMOTION-DETERMINISTIC.
--
-- Rollback: re-apply 20260420000007_fix_mutual_like_trigger.sql, OR drop
-- the unique index + NOT NULL first (see migration 000002 rollback).

CREATE OR REPLACE FUNCTION public.check_mutual_like()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_right_swipe_count INTEGER;
  v_existing_saved_card_id UUID;
  v_new_saved_card_id UUID;
  v_card_json JSONB;
  v_swiper RECORD;
  v_lock_key BIGINT;
  v_telemetry_available BOOLEAN;
BEGIN
  -- Only process right swipes
  IF NEW.swipe_state != 'swiped_right' THEN
    RETURN NEW;
  END IF;

  -- Idempotency guard (ORCH-0558 HF-7): if this row was already
  -- 'swiped_right' and is just being re-upserted (deck regen, client
  -- retry), skip quorum logic. Prevents double-counted votes.
  IF TG_OP = 'UPDATE' AND OLD.swipe_state = 'swiped_right' THEN
    RETURN NEW;
  END IF;

  -- Check if telemetry table exists (defensive — in case migration
  -- ordering ever flips). Kept as a cached flag per trigger invocation.
  v_telemetry_available := EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'match_telemetry_events'
  );

  -- Advisory lock (ORCH-0558 RC-3 fix): serialize any concurrent triggers
  -- for the same (session_id, experience_id) pair. Held until Tx
  -- commit/rollback. Canonical key ordering ensures deadlock-free because
  -- all triggers acquire locks in identical (session_id, experience_id)
  -- order.
  v_lock_key := hashtextextended(
    NEW.session_id::TEXT || '|' || NEW.experience_id::TEXT, 0
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- After lock, check if the card is already saved (post-0558 cleanup:
  -- experience_id is NOT NULL, so single-column match is authoritative).
  SELECT id INTO v_existing_saved_card_id
  FROM public.board_saved_cards
  WHERE session_id = NEW.session_id
    AND experience_id = NEW.experience_id
  LIMIT 1;

  -- If already saved, attach vote
  IF v_existing_saved_card_id IS NOT NULL THEN
    INSERT INTO public.board_votes (session_id, saved_card_id, user_id, vote_type)
    VALUES (NEW.session_id, v_existing_saved_card_id, NEW.user_id, 'up')
    ON CONFLICT (session_id, saved_card_id, user_id) DO NOTHING;

    IF v_telemetry_available THEN
      INSERT INTO public.match_telemetry_events (
        event_type, session_id, experience_id, user_id, saved_card_id, reason
      )
      VALUES (
        'collab_match_promotion_skipped', NEW.session_id, NEW.experience_id,
        NEW.user_id, v_existing_saved_card_id, 'existing_row_votes_attached'
      );
    END IF;

    RETURN NEW;
  END IF;

  -- Count right-swipes (lock is held, so count is consistent with concurrent Txs)
  SELECT COUNT(*) INTO v_right_swipe_count
  FROM public.board_user_swipe_states
  WHERE session_id = NEW.session_id
    AND experience_id = NEW.experience_id
    AND swipe_state = 'swiped_right';

  -- Threshold: 2+ right-swipes = match
  IF v_right_swipe_count < 2 THEN
    IF v_telemetry_available THEN
      INSERT INTO public.match_telemetry_events (
        event_type, session_id, experience_id, user_id, reason, quorum_count
      )
      VALUES (
        'collab_match_promotion_skipped', NEW.session_id, NEW.experience_id,
        NEW.user_id, 'quorum_not_met', v_right_swipe_count
      );
    END IF;
    RETURN NEW;
  END IF;

  -- Retrieve card_data from any swipe-state row for this (session, experience)
  SELECT card_data INTO v_card_json
  FROM public.board_user_swipe_states
  WHERE session_id = NEW.session_id
    AND experience_id = NEW.experience_id
    AND card_data IS NOT NULL
  ORDER BY swiped_at DESC
  LIMIT 1;

  -- Fallback stub (rare: pre-0556 clients with no card_data)
  IF v_card_json IS NULL THEN
    v_card_json := jsonb_build_object(
      'id', NEW.experience_id,
      'title', 'Matched experience'
    );
  END IF;

  -- Promote with ON CONFLICT safety net. Unique index
  -- `board_saved_cards_session_experience_unique` (migration 000002)
  -- catches any lock escape. Loser falls into attach-vote branch below.
  INSERT INTO public.board_saved_cards (
    session_id, experience_id, card_data, saved_by
  ) VALUES (
    NEW.session_id, NEW.experience_id, v_card_json, NEW.user_id
  )
  ON CONFLICT (session_id, experience_id) DO NOTHING
  RETURNING id INTO v_new_saved_card_id;

  -- If ON CONFLICT hit, another trigger in a sibling Tx beat us.
  IF v_new_saved_card_id IS NULL THEN
    SELECT id INTO v_new_saved_card_id
    FROM public.board_saved_cards
    WHERE session_id = NEW.session_id AND experience_id = NEW.experience_id
    LIMIT 1;

    INSERT INTO public.board_votes (session_id, saved_card_id, user_id, vote_type)
    VALUES (NEW.session_id, v_new_saved_card_id, NEW.user_id, 'up')
    ON CONFLICT (session_id, saved_card_id, user_id) DO NOTHING;

    IF v_telemetry_available THEN
      INSERT INTO public.match_telemetry_events (
        event_type, session_id, experience_id, user_id, saved_card_id, reason
      )
      VALUES (
        'collab_match_promotion_skipped', NEW.session_id, NEW.experience_id,
        NEW.user_id, v_new_saved_card_id, 'concurrency_conflict_attached_to_existing'
      );
    END IF;

    RETURN NEW;
  END IF;

  -- Fresh promotion succeeded. Insert votes for ALL right-swipers.
  FOR v_swiper IN
    SELECT user_id
    FROM public.board_user_swipe_states
    WHERE session_id = NEW.session_id
      AND experience_id = NEW.experience_id
      AND swipe_state = 'swiped_right'
  LOOP
    INSERT INTO public.board_votes (session_id, saved_card_id, user_id, vote_type)
    VALUES (NEW.session_id, v_new_saved_card_id, v_swiper.user_id, 'up')
    ON CONFLICT (session_id, saved_card_id, user_id) DO NOTHING;
  END LOOP;

  IF v_telemetry_available THEN
    INSERT INTO public.match_telemetry_events (
      event_type, session_id, experience_id, user_id, saved_card_id, reason, quorum_count
    )
    VALUES (
      'collab_match_promotion_success', NEW.session_id, NEW.experience_id,
      NEW.user_id, v_new_saved_card_id, 'promoted', v_right_swipe_count
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.check_mutual_like() IS
  'ORCH-0558 v3: Bulletproof collab match trigger. Acquires advisory lock on '
  '(session_id, experience_id) to serialize concurrent triggers. Uses '
  'unique constraint (session_id, experience_id) + ON CONFLICT DO NOTHING '
  'as belt. Idempotency gate on UPDATE with OLD.swipe_state=swiped_right. '
  'Emits match_telemetry_events rows for every decision path. See '
  'Mingla_Artifacts/outputs/INVESTIGATION_ORCH-0558_BULLETPROOF_COLLAB_MATCH.md.';

-- Trigger definition unchanged — AFTER INSERT OR UPDATE on
-- board_user_swipe_states. CREATE OR REPLACE FUNCTION replaces the body
-- in place; no DROP/CREATE TRIGGER needed.
