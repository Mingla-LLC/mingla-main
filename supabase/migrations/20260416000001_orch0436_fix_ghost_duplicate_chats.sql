-- ORCH-0436: Fix ghost and duplicate conversations
-- 1A. Delete ghost conversations (0 messages)
-- 1B. Merge duplicate conversations (same user pair)
-- 1C. Create atomic find-or-create RPC

-- ═══════════════════════════════════════════════════════════
-- 1A: Delete ghost conversations (conversations with 0 messages)
-- ═══════════════════════════════════════════════════════════

DELETE FROM conversations
WHERE id IN (
  SELECT c.id
  FROM conversations c
  LEFT JOIN messages m ON m.conversation_id = c.id
  WHERE c.type = 'direct'
  GROUP BY c.id
  HAVING COUNT(m.id) = 0
);
-- ON DELETE CASCADE on conversation_participants auto-cleans participant rows.

-- ═══════════════════════════════════════════════════════════
-- 1B: Merge duplicate conversations (same pair of users)
-- For each duplicate set: keep the one with the most messages,
-- move messages from others to the keeper, then delete others.
-- ═══════════════════════════════════════════════════════════

DO $$
DECLARE
  dup RECORD;
  keeper_id UUID;
  dupe_id UUID;
  dupe_ids UUID[];
BEGIN
  -- Find all duplicate direct conversation pairs
  FOR dup IN
    WITH conv_pairs AS (
      SELECT c.id as conversation_id,
             array_agg(cp.user_id ORDER BY cp.user_id) as participants,
             (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as msg_count,
             c.created_at
      FROM conversations c
      JOIN conversation_participants cp ON cp.conversation_id = c.id
      WHERE c.type = 'direct'
      GROUP BY c.id
    ),
    grouped AS (
      SELECT participants,
             array_agg(conversation_id ORDER BY msg_count DESC, created_at ASC) as conv_ids
      FROM conv_pairs
      GROUP BY participants
      HAVING COUNT(*) > 1
    )
    SELECT participants, conv_ids FROM grouped
  LOOP
    -- First in array has the most messages — that's the keeper
    keeper_id := dup.conv_ids[1];
    dupe_ids := dup.conv_ids[2:array_length(dup.conv_ids, 1)];

    -- Move messages from duplicates to keeper
    FOREACH dupe_id IN ARRAY dupe_ids
    LOOP
      UPDATE messages SET conversation_id = keeper_id
      WHERE conversation_id = dupe_id;
    END LOOP;

    -- Delete duplicate conversations (CASCADE handles participants + message_reads)
    DELETE FROM conversations WHERE id = ANY(dupe_ids);
  END LOOP;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 1C: Atomic find-or-create RPC for direct conversations
-- Runs as a single transaction — prevents race condition duplicates.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(
  p_user1_id UUID,
  p_user2_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_conversation_id UUID;
  v_ordered_a UUID;
  v_ordered_b UUID;
BEGIN
  -- Normalize order (smaller UUID first) for consistent lookups
  IF p_user1_id < p_user2_id THEN
    v_ordered_a := p_user1_id;
    v_ordered_b := p_user2_id;
  ELSE
    v_ordered_a := p_user2_id;
    v_ordered_b := p_user1_id;
  END IF;

  -- Try to find existing direct conversation between these two users
  SELECT cp1.conversation_id INTO v_conversation_id
  FROM conversation_participants cp1
  JOIN conversation_participants cp2 ON cp2.conversation_id = cp1.conversation_id
  JOIN conversations c ON c.id = cp1.conversation_id
  WHERE cp1.user_id = v_ordered_a
    AND cp2.user_id = v_ordered_b
    AND c.type = 'direct'
  LIMIT 1;

  IF v_conversation_id IS NOT NULL THEN
    RETURN v_conversation_id;
  END IF;

  -- Create new conversation atomically
  INSERT INTO conversations (type, created_by)
  VALUES ('direct', p_user1_id)
  RETURNING id INTO v_conversation_id;

  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES (v_conversation_id, v_ordered_a),
         (v_conversation_id, v_ordered_b);

  RETURN v_conversation_id;
END;
$$;
