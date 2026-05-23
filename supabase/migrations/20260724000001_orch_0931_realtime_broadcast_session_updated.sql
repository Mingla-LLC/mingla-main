CREATE OR REPLACE FUNCTION public.notify_session_updated_via_broadcast()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_topic text;
  v_payload jsonb;
  v_should_broadcast boolean := false;
BEGIN
  -- Fire ONLY when fields relevant to participant decks change.
  -- This avoids broadcasting on noise like last_activity_at touches
  -- (which fire on every participant_prefs touch via the existing
  -- ORCH-0909 participant-change trigger).
  --
  -- A change in any one of these three fields means the deck output
  -- could differ for at least one participant:
  --   * deck_version - bumped by ORCH-0902 hash-recompute trigger
  --   * deck_params_hash - same trigger, identifies what aggregation produced
  --   * participant_prefs - the raw prefs blob; equality check is jsonb-aware
  IF NEW.deck_version IS DISTINCT FROM OLD.deck_version THEN
    v_should_broadcast := true;
  ELSIF NEW.deck_params_hash IS DISTINCT FROM OLD.deck_params_hash THEN
    v_should_broadcast := true;
  ELSIF NEW.participant_prefs IS DISTINCT FROM OLD.participant_prefs THEN
    v_should_broadcast := true;
  END IF;

  IF NOT v_should_broadcast THEN
    RETURN NEW;
  END IF;

  v_topic := 'board_session:' || NEW.id::text;

  -- Payload kept small: clients use it as a cache-invalidation signal,
  -- not as data delivery. The client will refetch via discover-cards anyway.
  -- Sending the deck_version + hash lets clients short-circuit if their
  -- local hash matches, for example when they triggered the change themselves.
  v_payload := jsonb_build_object(
    'session_id', NEW.id,
    'deck_version', NEW.deck_version,
    'deck_params_hash', NEW.deck_params_hash,
    'updated_at', extract(epoch from NEW.updated_at)::bigint
  );

  -- realtime.send writes into realtime.messages with extension='broadcast'.
  -- private=true means authorization is gated by RLS on realtime.messages.
  -- Exceptions inside realtime.send are swallowed as WARNING so a realtime
  -- outage does not block the underlying UPDATE.
  PERFORM realtime.send(
    v_payload,
    'session_updated',
    v_topic,
    true
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_collaboration_sessions_broadcast_session_updated
  ON public.collaboration_sessions;

CREATE TRIGGER tr_collaboration_sessions_broadcast_session_updated
  AFTER UPDATE OF deck_version, deck_params_hash, participant_prefs
  ON public.collaboration_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_session_updated_via_broadcast();

-- realtime.messages RLS + policy. Wrapped in a DO block with schema-existence
-- guard so this migration applies cleanly in CI/baseline environments that
-- run stock Postgres without the Supabase Realtime extension (the `realtime`
-- schema is provisioned by the Supabase Realtime Go server, not by a
-- Postgres extension). On production Supabase the table exists and the
-- block runs verbatim; on bare-metal Postgres the block is a no-op.
DO $orch0931$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'realtime' AND table_name = 'messages'
  ) THEN
    EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "session_participants_can_receive_board_session_broadcasts" ON realtime.messages';
    EXECUTE $policy$
      CREATE POLICY "session_participants_can_receive_board_session_broadcasts"
        ON realtime.messages
        FOR SELECT
        TO authenticated
        USING (
          extension = 'broadcast'
          AND topic LIKE 'board_session:%'
          AND public.is_session_participant(
            substring(topic FROM length('board_session:') + 1)::uuid,
            auth.uid()
          )
        )
    $policy$;
  ELSE
    RAISE NOTICE 'Skipping realtime.messages RLS + policy — realtime schema not present (CI/baseline env)';
  END IF;
END
$orch0931$;

COMMENT ON FUNCTION public.notify_session_updated_via_broadcast() IS
  'ORCH-0931: broadcasts a "session_updated" event to topic board_session:<id> when '
  'deck_version, deck_params_hash, or participant_prefs changes. Replaces the silently-'
  'dropped postgres_changes id=eq.<sessionId> binding (see INVESTIGATION_ORCH-0931). '
  'Private broadcast - gated by RLS on realtime.messages (participants only). Exceptions '
  'in realtime.send are swallowed by design (RAISE WARNING) so a realtime outage cannot '
  'block the underlying collaboration_sessions UPDATE.';

-- COMMENT ON POLICY guarded behind the same schema-existence check.
DO $orch0931_comment$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'realtime' AND table_name = 'messages'
  ) THEN
    EXECUTE $comment$
      COMMENT ON POLICY "session_participants_can_receive_board_session_broadcasts" ON realtime.messages IS
        'ORCH-0931: authorizes session participants to receive private broadcasts on '
        'topic board_session:<session_id>. Topic format MUST be "board_session:<UUID>". '
        'Non-participants and anon role are denied. INSERT/UPDATE/DELETE on '
        'realtime.messages remain default-denied - the trigger function is the only writer.'
    $comment$;
  END IF;
END
$orch0931_comment$;
