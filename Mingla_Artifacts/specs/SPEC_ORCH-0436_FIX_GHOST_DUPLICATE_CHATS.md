# SPEC — ORCH-0436: Fix Ghost & Duplicate Conversations

**Status:** Ready for Implementation
**Scope:** Prevent ghost conversations, clean up existing data, prevent duplicates
**Affected surfaces:** Mobile messaging + Supabase database

---

## Summary

Conversations are currently created the moment a chat screen opens — before any message
is sent. This leaves ghost conversations (0 messages) in the database. Additionally, a
race condition allows duplicate conversations between the same pair of users. This spec
defines a three-layer fix: database cleanup + constraint, deferred conversation creation
(only on first message), and atomic find-or-create to prevent duplicates.

---

## Scope & Non-Goals

**In scope:**
- Database migration: clean up ghosts, merge duplicates, add unique constraint
- Database RPC: atomic find-or-create conversation
- Service change: `sendMessage` handles "no conversation yet" state
- Component change: `handlePickFriend` opens chat UI without creating conversation
- Realtime subscription deferred until conversation exists

**Non-goals:**
- Changing MessageInterface UI layout
- Changing the Friends page (ORCH-0435)
- Group conversations (only direct affected)
- Message content/format changes

---

## Layer 1 — Database Migration

### Step 1A: Delete ghost conversations (0 messages)

```sql
-- Delete conversations that have zero messages
DELETE FROM conversations
WHERE id IN (
  SELECT c.id
  FROM conversations c
  LEFT JOIN messages m ON m.conversation_id = c.id
  WHERE c.type = 'direct'
  GROUP BY c.id
  HAVING COUNT(m.id) = 0
);
```

`ON DELETE CASCADE` on `conversation_participants` will auto-clean participant rows.

### Step 1B: Merge duplicate conversations

For each pair of users with multiple direct conversations, keep the one with the most
messages (or most recent if tied). Move messages from duplicates to the keeper, then
delete the duplicates.

```sql
-- Find duplicate pairs and merge
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
duplicates AS (
  SELECT participants,
         array_agg(conversation_id ORDER BY msg_count DESC, created_at ASC) as conv_ids
  FROM conv_pairs
  GROUP BY participants
  HAVING COUNT(*) > 1
)
SELECT * FROM duplicates;
-- For each duplicate set: keep conv_ids[1] (most messages), migrate messages from others, delete others
```

The implementor should write this as a DO block that:
1. For each duplicate set, picks the keeper (most messages)
2. Updates `messages.conversation_id` for messages in non-keeper conversations → keeper
3. Updates `message_reads` similarly
4. Deletes non-keeper conversations (CASCADE handles participants)

### Step 1C: Add atomic find-or-create RPC

```sql
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
```

This RPC runs as a single transaction — no race condition possible. The `SECURITY DEFINER`
allows it to bypass RLS for the atomic operation.

### Step 1D: Add unique constraint on participant pairs

After cleanup, add a constraint to prevent future duplicates. Since PostgreSQL doesn't
natively support multi-row unique constraints, use a unique index on a materialized
participant pair:

```sql
-- Add a helper column to conversations for the ordered participant pair
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS participant_pair TEXT;

-- Populate for existing conversations
UPDATE conversations c
SET participant_pair = (
  SELECT string_agg(cp.user_id::text, ',' ORDER BY cp.user_id)
  FROM conversation_participants cp
  WHERE cp.conversation_id = c.id
)
WHERE c.type = 'direct';

-- Add unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_unique_direct_pair
  ON conversations (participant_pair)
  WHERE type = 'direct' AND participant_pair IS NOT NULL;
```

Update the RPC to also set `participant_pair` on creation.

**Alternative (simpler):** Skip the column. Rely on the RPC being the ONLY way to create
conversations (remove direct INSERT permission from RLS). The RPC's single-transaction
guarantee prevents duplicates without a constraint.

**Recommendation:** Use the RPC-only approach (simpler, no schema change). Add a trigger
that rejects direct INSERTs into conversations as a safety net:

```sql
CREATE OR REPLACE FUNCTION public.reject_direct_conversation_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Allow the RPC (SECURITY DEFINER) but block direct inserts
  -- The RPC runs as the function owner, not the user
  IF current_setting('role') = 'authenticated' THEN
    RAISE EXCEPTION 'Direct conversation creation must use get_or_create_direct_conversation RPC';
  END IF;
  RETURN NEW;
END;
$$;
```

Actually this is complex. **Simplest approach:** just use the RPC and rely on code discipline.
The RPC prevents race conditions. If someone bypasses the RPC, the worst case is a duplicate
that the cleanup migration will catch on next deploy.

---

## Layer 2 — Service Layer

### File: `app-mobile/src/services/messagingService.ts`

### Change 2A: New `ensureConversation` method

Replace the current `getOrCreateDirectConversation` with an RPC-based version:

```typescript
async ensureConversation(userId1: string, userId2: string): Promise<{
  conversationId: string | null;
  error: string | null;
}> {
  // Block check
  const isBlocked = await blockService.hasBlockBetween(userId2);
  if (isBlocked) return { conversationId: null, error: 'Cannot message this user' };

  // Atomic find-or-create via RPC
  const { data, error } = await supabase.rpc('get_or_create_direct_conversation', {
    p_user1_id: userId1,
    p_user2_id: userId2,
  });

  if (error) return { conversationId: null, error: error.message };
  return { conversationId: data as string, error: null };
}
```

### Change 2B: New `sendFirstMessage` method

A convenience method that creates the conversation AND sends the message atomically:

```typescript
async sendFirstMessage(
  senderId: string,
  recipientId: string,
  content: string,
  messageType: 'text' | 'image' | 'video' | 'file' = 'text',
  fileUrl?: string,
  fileName?: string,
  fileSize?: number,
  replyToId?: string
): Promise<{
  conversationId: string | null;
  message: DirectMessage | null;
  error: string | null;
}> {
  const { conversationId, error: convError } = await this.ensureConversation(senderId, recipientId);
  if (convError || !conversationId) {
    return { conversationId: null, message: null, error: convError || 'Failed to create conversation' };
  }

  const { message, error: sendError } = await this.sendMessage(
    conversationId, senderId, content, messageType, fileUrl, fileName, fileSize, replyToId
  );

  return { conversationId, message, error: sendError };
}
```

### Change 2C: Keep existing `sendMessage` unchanged

`sendMessage` still requires `conversationId`. It's used for subsequent messages in
existing conversations. No change needed.

### Change 2D: Keep `findExistingDirectConversation` unchanged

Still used for the `openDirectMessageWithUserId` steps 1-3 (finding existing conversations
without creating). No change.

---

## Layer 3 — Component Layer

### File: `app-mobile/src/components/ConnectionsPage.tsx`

### Change 3A: `handlePickFriend` — open chat without creating conversation

Currently (line 1273): `getOrCreateDirectConversation()` called immediately.

**New behavior:**
1. Set `activeChat` + `showMessageInterface = true` (same as now)
2. Try to find existing conversation (via `findExistingDirectConversation`)
3. If found → set `currentConversationId`, load messages, setup Realtime (same as now)
4. If NOT found → set `currentConversationId = null`, show empty chat. **Do NOT create.**

The conversation will be created when the user sends the first message (Change 3B).

```typescript
// In handlePickFriend, replace:
// const { conversation, error } = await messagingService.getOrCreateDirectConversation(...)
// With:
const { conversation } = await messagingService.findExistingDirectConversation(currentUserId, friendUserId);

if (conversation) {
  // Existing conversation — business as usual
  setCurrentConversationId(conversation.id);
  loadMessagesInBackground(conversation.id);
  setupRealtimeSubscription(conversation.id, currentUserId);
} else {
  // No conversation yet — UI opens empty, no DB row created
  setCurrentConversationId(null);
  // Realtime subscription will be set up after first message
}
```

### Change 3B: `handleSendMessage` — create conversation on first send

Currently (line 1651): Guard clause `if (!currentConversationId) return;`

**New behavior:** If `currentConversationId` is null and `activeChat` exists, create the
conversation via `sendFirstMessage`, then continue:

```typescript
const handleSendMessage = async (content, type, file, replyToId) => {
  if (!activeChat || !user?.id) return;

  // If no conversation yet, create one with the first message
  if (!currentConversationId) {
    const { conversationId, message, error } = await messagingService.sendFirstMessage(
      user.id,
      activeChat.id,
      content,
      type,
      fileUrl, // handle file upload first
      fileName,
      fileSize,
      replyToId
    );

    if (error || !conversationId) {
      Alert.alert(t('connections:message_not_sent'), error || t('connections:message_failed'));
      return;
    }

    // Set conversation ID + start Realtime
    setCurrentConversationId(conversationId);
    setupRealtimeSubscription(conversationId, user.id);

    // Add the sent message to UI
    if (message) {
      const transformed = transformMessage(message, user.id);
      setMessages([transformed]);
      // Update conversations list
      // ...
    }
    return;
  }

  // Existing conversation — current flow unchanged
  // ...existing handleSendMessage logic...
};
```

### Change 3C: `openDirectMessageWithUserId` effect — remove step 4 "last resort"

Currently step 4 (line 1402): Creates conversation with synthetic friend.

**New behavior:** Remove step 4 entirely. If steps 1-3 find nothing, open the chat UI
with `currentConversationId = null` (same as Change 3A). The first message will create
the conversation.

```typescript
// Replace step 4 with:
// 4. No existing conversation — open empty chat UI
setActiveChat({
  id: targetId,
  name: displayName,
  username: 'user',
  status: 'offline',
  isOnline: false,
});
setShowMessageInterface(true);
setCurrentConversationId(null);
setMessages([]);
```

### Change 3D: File upload path adjustment

Currently file upload uses `messages/{conversationId}/{fileName}`. If `conversationId`
is null at upload time, the implementor must either:
- Upload to a temp path first, then move after conversation creation
- OR create the conversation first, then upload, then send

**Recommendation:** For the first message with a file, create the conversation first
(via `ensureConversation`), then upload, then send. This keeps the storage path consistent.

### Change 3E: Realtime subscription — deferred

Currently `setupRealtimeSubscription` is called in `handlePickFriend` immediately.

**New behavior:** Only call `setupRealtimeSubscription` after conversation is created
(either found existing or created on first message). When `currentConversationId` is null,
no Realtime subscription — the chat UI just shows an empty state.

---

## Layer 4 — Realtime

No changes to `useSocialRealtime` or `useChatPresence`. They already guard on
`conversationId` being truthy. When `conversationId` is null, they silently skip.

`useBroadcastReceiver` in MessageInterface also guards on `conversationId`. No change needed.

---

## Success Criteria

| # | Criterion | Testable? |
|---|-----------|-----------|
| SC-1 | Opening a chat with a new person does NOT create a conversation in the DB | Query DB after opening — 0 new rows |
| SC-2 | Sending the first message creates the conversation AND sends the message atomically | Query DB — conversation + message created |
| SC-3 | Subsequent messages use the existing conversationId (no new conversations created) | Send 5 messages — still 1 conversation |
| SC-4 | Both users sending first message simultaneously creates exactly 1 conversation | RPC's transaction isolation prevents duplicates |
| SC-5 | Existing conversations with messages are unaffected | Open existing chat — messages load normally |
| SC-6 | Migration deletes all conversations with 0 messages | Query DB after migration — 0 ghost conversations |
| SC-7 | Migration merges duplicate conversations (messages moved to keeper) | Query DB — no duplicate participant pairs |
| SC-8 | Chat list only shows conversations with messages | No ghost entries visible |
| SC-9 | Realtime works after first message (typing indicators, new messages) | Send message → Realtime subscription starts |
| SC-10 | File messages work for first message (upload path correct) | Send image as first message — uploads correctly |

---

## Invariants

| ID | Invariant | Preserved By |
|----|-----------|-------------|
| INV-1 | Every conversation has at least 1 message | Conversation only created at send time |
| INV-2 | No duplicate direct conversations between same pair | RPC atomic find-or-create |
| INV-3 | Realtime only subscribes to existing conversations | Guard on `conversationId !== null` |
| INV-4 | Message send always has a valid conversationId | `sendFirstMessage` creates before sending |
| INV-5 | File upload path always includes conversationId | Create conversation before upload |

**New invariant established:** INV-1 — a conversation without messages should never exist.

---

## Test Cases

| # | Scenario | Action | Expected | Layer |
|---|----------|--------|----------|-------|
| T-01 | Open new chat, don't send | Tap Message on friend, back out | 0 conversations created in DB | Component + DB |
| T-02 | Send first text message | Open new chat, type "hello", send | 1 conversation + 1 message created | Full stack |
| T-03 | Send first image message | Open new chat, send photo | 1 conversation + 1 message (image) created | Full stack |
| T-04 | Send to existing conversation | Open existing chat, send message | No new conversation, message added | Service |
| T-05 | Both users send simultaneously | User A and B both send first message at same time | Exactly 1 conversation, 2 messages | DB RPC |
| T-06 | Migration cleans ghosts | Run migration | All 0-message conversations deleted | DB |
| T-07 | Migration merges duplicates | Run migration | Duplicate pairs merged, messages preserved | DB |
| T-08 | Open chat, go offline, come back | Open new chat, lose network, reconnect, send | Message sends successfully after reconnect | Component |
| T-09 | Realtime after first message | Send first message, friend sends reply | Reply appears in real time | Realtime |
| T-10 | Chat list regression | Check chat list with existing conversations | All existing chats display normally | Component |

---

## Implementation Order

1. **Migration** — cleanup + RPC (deploy first, safe to run before code changes)
2. **Service** — add `ensureConversation` + `sendFirstMessage` methods
3. **Component** — update `handlePickFriend`, `handleSendMessage`, remove step 4 fallback
4. **Verify** — run against success criteria

---

## Regression Prevention

- The RPC `get_or_create_direct_conversation` is the single source of truth for conversation creation
- The guard `if (!currentConversationId)` in `handleSendMessage` now triggers creation instead of returning early
- INV-1 (no empty conversations) is enforced by architecture — conversations only created at send time
- A periodic cleanup query can be scheduled to catch any edge-case leaks (defensive)
