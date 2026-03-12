# Spec Amendment: Chat Experience Overhaul
**Date:** 2026-03-12
**Status:** MANDATORY — overrides corresponding sections in `FEATURE_CHAT_EXPERIENCE_OVERHAUL_SPEC.md`
**Reason:** Architectural review identified 8 integration-point issues that will cause bugs at runtime. This amendment patches only what needs patching. The original spec remains the authority for everything not mentioned here.

---

## Amendment 1: useInstantMessaging Must NOT Wrap useMessagingRealtime

**Original spec §6.1.3 says:**
> "Keep existing postgres_changes subscription (via useMessagingRealtime) as backup"

**Problem:** `messagingService.subscribeToConversation()` enforces one-subscription-per-channel-name. It unsubscribes the old channel before creating a new one (line 412-414 of messagingService.ts). If `useInstantMessaging` calls `useMessagingRealtime` → `messagingService.subscribeToConversation()`, it will **destroy** ConnectionsPage's existing `postgres_changes` subscription and replace its callbacks. ConnectionsPage's critical side effects — cache sync, unread count updates, conversation list updates, auto-mark-as-read — are silently killed. On unmount, `useMessagingRealtime` cleans up and now nobody is subscribed. Messages stop arriving entirely.

**Fix — replace §6.1.3 with this:**

```typescript
// hooks/useInstantMessaging.ts
//
// This hook subscribes to the BROADCAST channel ONLY.
// It does NOT call useMessagingRealtime or messagingService.subscribeToConversation().
// The existing postgres_changes subscription in ConnectionsPage remains untouched
// and continues to serve as the backup delivery path + side-effect handler.

import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { DirectMessage } from '../services/messagingService';
import { messagingService } from '../services/messagingService';

interface UseInstantMessagingOptions {
  conversationId: string | null;
  currentUserId: string | null;
  currentUserName: string | null;  // REQUIRED — for broadcast payload enrichment
  onBroadcastMessage: (message: DirectMessage) => void;
}

interface UseInstantMessagingReturn {
  sendInstantMessage: (
    content: string,
    type: 'text' | 'image' | 'video' | 'file',
    fileUrl?: string,
    fileName?: string,
    fileSize?: number
  ) => Promise<{ tempId: string; realId: string | null; error: string | null }>;
  seenMessageIds: React.MutableRefObject<Set<string>>;
}

export function useInstantMessaging({
  conversationId,
  currentUserId,
  currentUserName,
  onBroadcastMessage,
}: UseInstantMessagingOptions): UseInstantMessagingReturn {
  const seenMessageIds = useRef(new Set<string>());
  const onBroadcastMessageRef = useRef(onBroadcastMessage);
  onBroadcastMessageRef.current = onBroadcastMessage;

  // 1. Subscribe to broadcast channel `chat:{conversationId}` ONLY
  //    Channel name is intentionally different from postgres_changes channel
  //    (`conversation:{conversationId}`) — no collision.
  useEffect(() => {
    if (!conversationId || !currentUserId) return;

    const channelName = `chat:${conversationId}`;
    const channel = supabase
      .channel(channelName)
      .on('broadcast', { event: 'new_message' }, (payload) => {
        const msg = payload.payload as DirectMessage;

        // Skip own messages (already shown as optimistic)
        if (msg.sender_id === currentUserId) return;

        // Skip if already seen (dedup)
        if (seenMessageIds.current.has(msg.id)) return;

        // Mark as seen and deliver
        seenMessageIds.current.add(msg.id);
        onBroadcastMessageRef.current(msg);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, currentUserId]);

  // 2. sendInstantMessage:
  //    a. Generate optimistic message with temp-{timestamp}-{random} ID
  //    b. Caller renders it immediately via their own state management
  //    c. Call messagingService.sendMessage() to persist to DB
  //    d. On DB success: broadcast the enriched message to the channel
  //       (broadcast happens AFTER DB insert so the payload has a real ID)
  //    e. Add real ID to seenMessageIds so postgres_changes backup won't dupe
  //    f. Return { tempId, realId } so caller can replace optimistic → real
  //    g. If DB write fails: return { tempId, realId: null, error }
  const sendInstantMessage = useCallback(
    async (
      content: string,
      type: 'text' | 'image' | 'video' | 'file',
      fileUrl?: string,
      fileName?: string,
      fileSize?: number
    ) => {
      if (!conversationId || !currentUserId) {
        return { tempId: '', realId: null, error: 'Missing conversation or user' };
      }

      const tempId = `temp-${Date.now()}-${Math.random()}`;

      // Persist to DB
      const { message, error } = await messagingService.sendMessage(
        conversationId,
        currentUserId,
        content,
        type,
        fileUrl,
        fileName,
        fileSize
      );

      if (error || !message) {
        return { tempId, realId: null, error: error || 'Unknown error' };
      }

      // Add real ID to seen set BEFORE broadcast fires
      seenMessageIds.current.add(message.id);

      // Broadcast to other participants (they get it in <500ms)
      // Payload is already enriched because sendMessage returns enriched message
      const channelName = `chat:${conversationId}`;
      const broadcastChannel = supabase.channel(channelName);
      broadcastChannel.send({
        type: 'broadcast',
        event: 'new_message',
        payload: {
          ...message,
          sender_name: currentUserName || message.sender_name || 'Unknown',
        },
      });

      return { tempId, realId: message.id, error: null };
    },
    [conversationId, currentUserId, currentUserName]
  );

  return { sendInstantMessage, seenMessageIds };
}
```

**Key changes from original spec:**
- NO import of `useMessagingRealtime` — broadcast channel only
- Broadcast sending moved FROM `messagingService.sendMessage()` INTO `sendInstantMessage()` — keeps messagingService unchanged and puts broadcast responsibility in the hook that owns the channel
- `seenMessageIds` ref is EXPOSED so ConnectionsPage can check it in its postgres_changes callback
- `currentUserName` is required — eliminates async enrichment on the broadcast hot path
- Returns `{ tempId, realId }` so caller can directly update optimistic → real without relying on a subscription

---

## Amendment 2: Do NOT Modify messagingService.sendMessage()

**Original spec §6.2.3 says:**
> "After sendMessage() inserts into the DB, also broadcast the message to the conversation channel"

**Problem:** This couples broadcast responsibility to the service layer, which doesn't know whether a broadcast channel is currently subscribed. It also means every sendMessage call (including from ConnectionsPage's existing `handleSendMessage`) would broadcast — even when `useInstantMessaging` isn't mounted. The broadcast channel might not exist yet, creating an orphaned channel.

**Fix:** Do NOT modify `messagingService.sendMessage()`. The broadcast is sent by `useInstantMessaging.sendInstantMessage()` (see Amendment 1 above). `messagingService` remains a pure DB service.

**However, DO add this helper method to messagingService** (for the receiver side, if needed in the future):

```typescript
// In messagingService.ts — add this method:

subscribeToChatBroadcast(
  conversationId: string,
  onMessage: (message: DirectMessage) => void
): RealtimeChannel {
  const channelName = `chat:${conversationId}`;
  return supabase
    .channel(channelName)
    .on('broadcast', { event: 'new_message' }, (payload) => {
      onMessage(payload.payload as DirectMessage);
    })
    .subscribe();
}
```

This is a utility — `useInstantMessaging` may use it internally instead of raw `supabase.channel()`, but it's optional.

---

## Amendment 3: ConnectionsPage Dedup Integration with Broadcast

**Original spec §6.2.2 only says:**
> "Pass conversationId and currentUserId to MessageInterface when rendering it."

**Problem:** ConnectionsPage's `setupRealtimeSubscription` (lines 620-695) is the postgres_changes callback that handles message arrival, cache sync, conversation list updates, unread counts, and auto-mark-as-read. When `useInstantMessaging` delivers a message via broadcast, it calls `onBroadcastMessage` — but if this message also arrives via postgres_changes 1-3 seconds later, ConnectionsPage's callback will try to add it again. ConnectionsPage's existing dedup (line 625: `prev.some(msg => msg.id === transformedMsg.id)`) catches exact ID matches, so IF the broadcast message was already added with its real ID, the postgres_changes duplicate will be skipped. But this only works if:

1. The broadcast message was added to `messages` state with the real DB ID (not a temp ID)
2. The broadcast message was also added to `messagesCache`

**Fix — modify ConnectionsPage's `setupRealtimeSubscription` callback:**

```typescript
// In setupRealtimeSubscription's onMessage callback, add at the top:
onMessage: (newMessage: DirectMessage) => {
  // Check broadcast dedup set from useInstantMessaging
  // (passed down from MessageInterface via a ref or callback)
  if (instantMessagingSeenRef.current?.has(newMessage.id)) {
    // Already delivered via broadcast — skip adding to messages state.
    // BUT still run side effects: cache, conversation list, mark as read.
    // (These side effects must happen regardless of delivery path.)
  }

  // ... rest of existing logic unchanged ...
}
```

**Architecture for passing the seenMessageIds ref:**

```typescript
// ConnectionsPage adds a ref:
const instantMessagingSeenRef = useRef<Set<string>>(new Set());

// Pass a setter callback to MessageInterface:
<MessageInterface
  // ... existing props ...
  conversationId={currentConversationId}
  currentUserId={user.id}
  onSeenIdsReady={(seenRef: React.MutableRefObject<Set<string>>) => {
    instantMessagingSeenRef.current = seenRef.current;
  }}
/>

// Inside MessageInterface, after useInstantMessaging initializes:
const { sendInstantMessage, seenMessageIds } = useInstantMessaging({ ... });
useEffect(() => {
  onSeenIdsReady?.(seenMessageIds);
}, [seenMessageIds]);
```

**Alternative (simpler):** Make `seenMessageIds` a shared ref created in ConnectionsPage and passed down as a prop. MessageInterface's `useInstantMessaging` uses it instead of creating its own.

**Recommended approach — shared ref:**

```typescript
// ConnectionsPage:
const broadcastSeenIds = useRef(new Set<string>());

// Pass to MessageInterface as prop:
<MessageInterface
  // ... existing props ...
  conversationId={currentConversationId}
  currentUserId={user.id}
  currentUserName={user.name || user.email || 'Unknown'}
  broadcastSeenIds={broadcastSeenIds}
/>

// In setupRealtimeSubscription, check before processing:
onMessage: (newMessage: DirectMessage) => {
  // If broadcast already delivered this, skip UI update but keep side effects
  const alreadyDelivered = broadcastSeenIds.current.has(newMessage.id);

  if (!alreadyDelivered) {
    // Add to messages state (existing logic — lines 624-646)
    const transformedMsg = transformMessage(newMessage, userId);
    setMessages((prev) => {
      const exists = prev.some((msg) => msg.id === transformedMsg.id);
      if (exists) return prev;
      // ... optimistic match logic unchanged ...
      return [...prev, transformedMsg];
    });
  }

  // Cache update ALWAYS runs (even if broadcast already delivered to UI)
  setMessagesCache((prev) => { /* existing logic */ });

  // Conversation list update ALWAYS runs
  setConversations((prev) => { /* existing logic */ });

  // Auto-mark-as-read ALWAYS runs
  if (newMessage.sender_id !== userId) {
    messagingService.markAsRead([newMessage.id], userId).catch(console.error);
  }
}
```

---

## Amendment 4: Optimistic → Real ID Replacement for Sender's Own Messages

**Original spec §6.1.3 says:**
> "When DB responds with real ID, update optimistic message ID in dedup set"

**Problem:** This only updates the dedup set. The actual `messages` state in ConnectionsPage still has a message with `temp-{timestamp}` as its ID. The sender's own message never gets its real ID in the UI state. This causes:
- Read receipt tracking to fail (DB uses real ID, UI has temp ID)
- Message grouping edge cases (if grouping logic compares IDs)
- Stale optimistic messages if the user navigates away and back

**Fix — ConnectionsPage's `handleSendMessage` must update the optimistic ID after DB success:**

```typescript
// Modify ConnectionsPage.handleSendMessage:
const handleSendMessage = async (content, type, file) => {
  // ... existing block check, file upload logic unchanged ...

  const tempId = `temp-${Date.now()}-${Math.random()}`;
  const now = new Date().toISOString();

  // Optimistic message (existing logic — unchanged)
  const optimisticMsg: Message = {
    id: tempId,
    senderId: user.id,
    senderName: 'Me',
    content,
    timestamp: now,
    type,
    fileUrl,
    fileName,
    fileSize: fileSize?.toString(),
    isMe: true,
    unread: false,
  };
  setMessages((prev) => [...prev, optimisticMsg]);

  // Send via useInstantMessaging's sendInstantMessage (passed up as callback)
  // OR call messagingService.sendMessage directly — see note below.
  const { message, error } = await messagingService.sendMessage(
    currentConversationId, user.id, content, type, fileUrl, fileName, fileSize
  );

  if (error || !message) {
    // Mark optimistic message as failed
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === tempId ? { ...msg, failed: true } : msg
      )
    );
    return;
  }

  // CRITICAL: Replace temp ID with real ID in messages state
  setMessages((prev) =>
    prev.map((msg) =>
      msg.id === tempId ? { ...msg, id: message.id } : msg
    )
  );

  // Also replace in cache
  setMessagesCache((prev) => {
    const existing = prev[currentConversationId] || [];
    return {
      ...prev,
      [currentConversationId]: existing.map((msg) =>
        msg.id === tempId ? { ...msg, id: message.id } : msg
      ),
    };
  });

  // Add real ID to broadcast seen set so postgres_changes backup doesn't dupe
  broadcastSeenIds.current.add(message.id);

  // Broadcast to other participants (instant delivery)
  const channelName = `chat:${currentConversationId}`;
  const broadcastChannel = supabase.channel(channelName);
  broadcastChannel.send({
    type: 'broadcast',
    event: 'new_message',
    payload: {
      ...message,
      sender_name: user.name || user.email || 'Unknown',
    },
  });
};
```

**IMPORTANT DECISION — Where does `sendInstantMessage` live?**

Given that ConnectionsPage owns message state, optimistic updates, cache, and conversation list side effects — and `useInstantMessaging` was originally meant to encapsulate all of this — the cleanest architecture is:

**Option A (Recommended):** `handleSendMessage` stays in ConnectionsPage. It calls `messagingService.sendMessage()` directly (as it does today), then broadcasts via the shared broadcast channel. `useInstantMessaging` becomes `useBroadcastReceiver` — it ONLY subscribes to incoming broadcast messages for the receiver side. This is simpler, has fewer moving parts, and keeps message state ownership crystal clear.

**Option B:** `useInstantMessaging` exposes `sendInstantMessage`, and MessageInterface calls it. But then useInstantMessaging needs callbacks into ConnectionsPage's state (setMessages, setMessagesCache, setConversations), which creates a tangled dependency graph.

**Go with Option A.** Rename `useInstantMessaging` → `useBroadcastReceiver`. It only handles the receive path.

---

## Amendment 5: Stale Presence — Heartbeat + Server-Side Cleanup

**Original spec §6.1.1 / §6.1.2:**
> Presence upserts on mount/unmount and AppState changes.

**Problem:** If the app crashes, is force-killed, or loses network, no unmount runs. `is_online` stays `true` forever. Other users see a ghost "Online" status that never clears.

**Fix — two mechanisms:**

### 5a. Client-Side Heartbeat (in useChatPresence)

```typescript
// Inside useChatPresence, after initial presence upsert:
useEffect(() => {
  if (!conversationId || !currentUserId) return;

  // Heartbeat every 30 seconds
  const heartbeatInterval = setInterval(() => {
    upsertPresence(conversationId, currentUserId, true);
  }, 30_000);

  return () => clearInterval(heartbeatInterval);
}, [conversationId, currentUserId]);
```

### 5b. Database Migration — Add Cleanup Mechanism

Add to migration `20260312200001_chat_presence_and_typing.sql`:

```sql
-- Scheduled cleanup: mark stale presence as offline
-- Any user who hasn't heartbeated in 60 seconds is offline.
-- This runs via pg_cron or can be called manually.

CREATE OR REPLACE FUNCTION cleanup_stale_presence()
RETURNS void AS $$
BEGIN
  UPDATE public.conversation_presence
  SET is_online = false
  WHERE is_online = true
    AND updated_at < NOW() - INTERVAL '60 seconds';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- If pg_cron is available (Supabase Pro plan):
-- SELECT cron.schedule('cleanup-stale-presence', '*/1 * * * *', 'SELECT cleanup_stale_presence()');
--
-- If pg_cron is NOT available: the client-side heartbeat alone is sufficient for
-- most cases. Stale presence will self-correct when the user next opens the app
-- (upsertPresence overwrites the stale row).
```

### 5c. Fallback for Free Plan (No pg_cron)

If pg_cron is not available, the client must handle stale detection:

```typescript
// In useChatPresence, when reading other participants' presence:
// Treat updated_at > 60 seconds ago as offline, regardless of is_online value.
const isActuallyOnline = participant.is_online &&
  (Date.now() - new Date(participant.updated_at).getTime()) < 60_000;
```

---

## Amendment 6: Pull-to-Load-More — Use FlatList Inverted

**Original spec §6.2.1 item 9:**
> "Add onScroll handler to ScrollView that detects when scrolled to top and loads older messages."

**Problem:** React Native ScrollView cannot prepend content without a visible scroll jump. When older messages are inserted at index 0, the scroll position stays at the same offset — which means the user's viewport jumps down by the height of the new messages.

**Fix:** Replace ScrollView with `FlatList` using `inverted={true}`. This is the standard React Native chat pattern:

```typescript
// In MessageInterface.tsx — replace the messages ScrollView with:

<FlatList
  ref={flatListRef}
  data={groupedMessages}  // Already sorted newest-first (reversed)
  renderItem={({ item }) => (
    <MessageBubble
      message={item.message}
      isMe={item.message.isMe}
      groupPosition={item.groupPosition}
      showTimestamp={item.showTimestamp}
      isRead={item.message.isMe && item.isRead}
    />
  )}
  keyExtractor={(item) => item.message.id}
  inverted={true}
  keyboardShouldPersistTaps="handled"
  keyboardDismissMode="interactive"
  onEndReached={handleLoadMore}  // "End" is the top of the chat (because inverted)
  onEndReachedThreshold={0.3}
  ListFooterComponent={  // Footer = top of chat (because inverted)
    isLoadingMore ? <ActivityIndicator size="small" /> : null
  }
  // No maintainVisibleContentPosition needed — inverted handles it
/>
```

**Data ordering:** `groupMessages()` must return messages in **reverse chronological** order (newest first) when used with inverted FlatList. OR keep chronological order and let `inverted` handle the visual flip. The latter is simpler — `inverted={true}` renders the last item at the bottom (visible), which is the newest message. The implementor must NOT reverse the data array.

**Update to `groupMessages()` (§6.1.8):** No change needed — it already outputs chronological order. FlatList `inverted` flips the visual rendering.

---

## Amendment 7: Read Receipts — Explicit Implementation Steps

The original spec defines the DB schema (§4.2), the MessageBubble props (§6.1.5 — `isRead`), and the design (check marks). But the implementation plan and steps omit HOW read receipt state flows from DB to UI.

**Add this to the implementation plan:**

### Read Receipt Data Flow

1. **Sender side — "has the recipient read my message?"**
   - When postgres_changes fires an UPDATE on the messages table (the `sync_message_read_status` trigger sets `is_read = true`), ConnectionsPage's existing `onMessageUpdated` callback (if wired — currently only `onMessage` is used) should update the message in state.
   - The implementor must add `onMessageUpdated` to `setupRealtimeSubscription`:
   ```typescript
   // In setupRealtimeSubscription, add to the callbacks:
   onMessageUpdated: (updatedMessage: DirectMessage) => {
     const transformed = transformMessage(updatedMessage, userId);
     setMessages((prev) =>
       prev.map((msg) =>
         msg.id === transformed.id ? { ...msg, ...transformed } : msg
       )
     );
     setMessagesCache((prev) => {
       const existing = prev[conversationId] || [];
       return {
         ...prev,
         [conversationId]: existing.map((msg) =>
           msg.id === transformed.id ? { ...msg, ...transformed } : msg
         ),
       };
     });
   },
   ```

2. **Receiver side — "mark messages as read when I see them"**
   - Already handled: ConnectionsPage's `setupRealtimeSubscription` calls `messagingService.markAsRead()` on incoming messages (line 692-694).
   - The `markAsRead` inserts into `message_reads`, which fires the `sync_message_read_status` trigger, which sets `is_read = true` on the message, which fires a postgres_changes UPDATE, which the sender receives via `onMessageUpdated`.

3. **MessageBubble display logic:**
   - `isRead={false}` + `isMe={true}` → single gray check (sent)
   - Message exists in DB (not temp-) + `isRead={false}` + `isMe={true}` → double gray check (delivered)
   - `isRead={true}` + `isMe={true}` → double orange check (read)
   - `isMe={false}` → no check marks shown

4. **Add `failed` field to Message type:**
   ```typescript
   export interface Message {
     // ... existing fields ...
     failed?: boolean;  // true if sendMessage returned an error
   }
   ```
   When `failed` is true, show a red border + retry icon instead of check marks.

---

## Amendment 8: Corrected Implementation Order

The original spec §7 has the right steps but wrong order. Services must exist before hooks that depend on them. The broadcast mechanism must be wired before MessageInterface tries to use it.

**Replace §7 with:**

| Step | What | Files | Depends On |
|------|------|-------|------------|
| 1 | DB Migrations (2 files) | `supabase/migrations/` | Nothing |
| 2 | Design tokens — add `spacing.xxs: 2` + chat color aliases | `designSystem.ts` | Nothing |
| 3 | Utility: `messageGrouping.ts` | `utils/messageGrouping.ts` | Nothing |
| 4 | Service: `chatPresenceService.ts` | `services/chatPresenceService.ts` | Step 1 (table exists) |
| 5 | Components: TypingIndicator, ChatStatusLine, MessageBubble | `components/chat/*.tsx` | Steps 2, 3 |
| 6 | Hook: `useChatPresence.ts` (with heartbeat) | `hooks/useChatPresence.ts` | Step 4 |
| 7 | Hook: `useBroadcastReceiver.ts` (renamed from useInstantMessaging — receive only) | `hooks/useBroadcastReceiver.ts` | Nothing (pure Supabase channel) |
| 8 | Modify: `ConnectionsPage.tsx` — add broadcastSeenIds ref, pass new props to MessageInterface, add broadcast send to handleSendMessage, add onMessageUpdated to setupRealtimeSubscription, integrate dedup | `components/ConnectionsPage.tsx` | Steps 6, 7 |
| 9 | Modify: `MessageInterface.tsx` — replace ScrollView with inverted FlatList, integrate presence hook, integrate broadcast receiver, replace keyboard handling with useKeyboard, compact spacing, extracted MessageBubble | `components/MessageInterface.tsx` | Steps 5, 6, 7, 8 |
| 10 | Create: `FriendsModal.tsx` | `components/FriendsModal.tsx` | Nothing (uses existing useFriends) |
| 11 | Modify: `HomePage.tsx` — swap FriendRequestsModal → FriendsModal | `components/HomePage.tsx` | Step 10 |
| 12 | Integration test — full end-to-end | All | All |

**Parallelizable:** Steps 1-3 can run in parallel. Steps 4-5 can run in parallel (different layers). Step 10 is fully independent and can run in parallel with steps 8-9.

---

## Amendment 9: Spec Error Correction — §6.2.2 File Reference

**Original spec §6.2.2 says:** `components/ConnectionsPage.tsx` — "Replace FriendRequestsModal with FriendsModal"

**Correction:** FriendRequestsModal is imported and rendered in `components/HomePage.tsx` (lines 18, 482-485), NOT ConnectionsPage.tsx. ConnectionsPage has zero references to FriendRequestsModal.

Split §6.2.2 into two:

- **§6.2.2a — `components/ConnectionsPage.tsx`:** Pass `conversationId`, `currentUserId`, `currentUserName`, and `broadcastSeenIds` to MessageInterface. Add broadcast send logic to `handleSendMessage`. Add `onMessageUpdated` callback to `setupRealtimeSubscription`. Add dedup check against `broadcastSeenIds` in `onMessage` callback.

- **§6.2.2b — `components/HomePage.tsx`:** Replace `import FriendRequestsModal` with `import FriendsModal`. Replace `<FriendRequestsModal>` JSX with `<FriendsModal>`. Add `onMessageFriend` callback that navigates to the conversation.

---

## Amendment 10: Group Chat Presence UI Handling

**Original spec §6.1.6 (ChatStatusLine) only shows single-user status:**
> `isOnline`, `isTyping`, `lastSeenAt`, `typingUserName`

**Problem:** Success Criterion 11 requires group chat support. A group chat has N participants, each with their own presence. The current props don't support "Alex and Bob online" or "Alex and 2 others typing."

**Fix — extend ChatStatusLine props:**

```typescript
interface ChatStatusLineProps {
  // For DM (1:1) — simple mode:
  isOnline?: boolean;
  isTyping?: boolean;
  lastSeenAt?: string | null;

  // For group chats — multi-participant mode:
  onlineCount?: number;         // Number of participants currently online (excluding self)
  totalParticipants?: number;   // Total participants (excluding self)
  typingUserNames?: string[];   // Names of users currently typing (excluding self)

  // The component auto-detects mode:
  // If totalParticipants is set and > 1 → group mode
  // Otherwise → DM mode
}

// Group mode rendering:
// - 0 online: "No one online" in text.tertiary
// - 1 online: "Alex online" with green dot
// - 2 online: "Alex and Bob online" with green dot
// - 3+ online: "Alex and 2 others online" with green dot
// - 1 typing: "Alex is typing" with TypingIndicator
// - 2 typing: "Alex and Bob are typing" with TypingIndicator
// - 3+ typing: "Alex and 2 others are typing" with TypingIndicator
// - Typing takes visual priority over online (same as DM mode)
```

---

## Summary of All Amendments

| # | What Changed | Why |
|---|-------------|-----|
| 1 | `useInstantMessaging` → broadcast-only, no `useMessagingRealtime` | Prevents subscription hijacking |
| 2 | Do NOT modify `messagingService.sendMessage()` | Broadcast ownership stays in the hook/component |
| 3 | ConnectionsPage dedup via shared `broadcastSeenIds` ref | Prevents double-render from broadcast + postgres_changes |
| 4 | Optimistic → real ID replacement in ConnectionsPage state | Prevents stale temp IDs in state |
| 5 | Heartbeat + server-side cleanup for presence | Prevents ghost "Online" on crash/force-close |
| 6 | FlatList inverted instead of ScrollView | Prevents scroll jump on load-more |
| 7 | Read receipts — explicit data flow + `onMessageUpdated` | Missing from original implementation plan |
| 8 | Corrected implementation order | Services before hooks before components |
| 9 | FriendRequestsModal is in HomePage, not ConnectionsPage | Spec file reference error |
| 10 | ChatStatusLine group chat support | Success Criterion 11 compliance |

---

## Handoff

Implementor: apply these amendments on top of the original spec. Where an amendment says "replace," it overrides the original section entirely. Where it says "add," it supplements the original. The original spec remains authoritative for everything not mentioned in this document.

Execute in the order specified in Amendment 8. Do not skip amendments. If any amendment conflicts with the original spec, **this document wins**.
