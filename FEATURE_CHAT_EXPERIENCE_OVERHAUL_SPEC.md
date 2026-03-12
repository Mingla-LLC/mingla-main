# Feature: Chat Experience Overhaul & Friends Modal
**Date:** 2026-03-12
**Status:** Planned
**Requested by:** "I want to improve the chats page — friends modal with tabs, instant messages, online/typing/last seen, compact spacing, luxurious experience."
**Design Spec:** `DESIGN_CHAT_EXPERIENCE_OVERHAUL_SPEC.md` (companion document — all visual decisions live there)

---

## 1. Summary

This feature transforms the chat experience across five axes: (1) replaces `FriendRequestsModal` with a tabbed `FriendsModal` containing Friends + Requests tabs with full friend management actions, (2) adds real-time presence (online/offline/last seen) to DM and group conversations using Supabase Realtime presence channels, (3) adds typing indicators to DM and group conversations using Supabase broadcast, (4) achieves sub-second message delivery by switching from `postgres_changes` (INSERT event) to Supabase broadcast for instant delivery with parallel DB persistence, and (5) compacts the chat UI — tighter bubble spacing, grouped consecutive messages, keyboard-hugging input bar.

No end-to-end encryption. Transport security remains HTTPS + Supabase RLS.

---

## 2. User Story

As a Mingla user, I want to see when my friends are online, know when they're typing, receive messages instantly, and manage my friends from a single modal — so that chatting on Mingla feels as fast and premium as iMessage or Telegram.

---

## 3. Success Criteria

1. When User A sends a text message, User B sees it in the conversation within 500ms (measured from send tap to bubble render on User B's device, on WiFi).
2. When User A opens a DM conversation with User B who has the app open, the header shows a green dot and "Online" within 2 seconds of the screen rendering.
3. When User B closes the app or backgrounds it, User A's header updates to "Last seen [time]" within 5 seconds.
4. When User A starts typing in a DM, User B sees "typing..." with animated dots in the header within 1 second.
5. When User A stops typing for 3 seconds, the typing indicator disappears from User B's screen.
6. The Friends Modal opens with the Friends tab by default, showing all accepted friends with online status, and switches to the Requests tab when tapped.
7. From the Friends tab, the user can swipe left on a friend to reveal Mute, Block, Report, and Remove actions — each action works correctly and updates the list.
8. Consecutive messages from the same sender within 2 minutes are visually grouped with 2px vertical spacing (not 16px).
9. The gap between the message input bar and the keyboard is ≤8px on both iOS and Android.
10. Timestamps appear only between message clusters separated by >5 minutes, centered in a pill.
11. All presence, typing, and instant messaging features work in group conversations (not just DMs).
12. Pull-to-load at the top of the message list loads older messages without losing scroll position.

---

## 4. Database Changes

### 4.1 New Tables

```sql
-- Migration: 20260312200001_chat_presence_and_typing.sql
-- Description: Adds DM/group conversation presence tracking table.
-- Typing indicators use broadcast only (no DB storage) — same pattern as board typing.

-- Conversation presence — tracks who is online in which conversation
CREATE TABLE public.conversation_presence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_online BOOLEAN NOT NULL DEFAULT false,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(conversation_id, user_id)
);

-- Index for fast lookup by conversation
CREATE INDEX idx_conversation_presence_conv_id ON public.conversation_presence(conversation_id);
-- Index for fast lookup by user (to mark all conversations offline on disconnect)
CREATE INDEX idx_conversation_presence_user_id ON public.conversation_presence(user_id);

-- RLS
ALTER TABLE public.conversation_presence ENABLE ROW LEVEL SECURITY;

-- Users can read presence for conversations they participate in
CREATE POLICY "Participants can read conversation presence"
  ON public.conversation_presence FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversation_presence.conversation_id
      AND cp.user_id = auth.uid()
    )
  );

-- Users can upsert their own presence
CREATE POLICY "Users can upsert own presence"
  ON public.conversation_presence FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own presence"
  ON public.conversation_presence FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add to realtime publication for postgres_changes subscriptions
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_presence;

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION update_conversation_presence_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_conversation_presence_timestamp
  BEFORE UPDATE ON public.conversation_presence
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_presence_timestamp();
```

### 4.2 Modified Tables

```sql
-- Migration: 20260312200002_add_message_read_status_columns.sql
-- Description: Add is_read shortcut to messages table for efficient read receipt display.
-- The message_reads table already exists for detailed tracking.
-- This column is a denormalized shortcut so the client doesn't need to JOIN on every message render.

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- Update existing messages: mark as read if they have a corresponding message_reads entry
UPDATE public.messages m
SET is_read = true, read_at = mr.read_at
FROM public.message_reads mr
WHERE mr.message_id = m.id;

-- Trigger: when a message_reads row is inserted, update the message's is_read flag
CREATE OR REPLACE FUNCTION sync_message_read_status()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.messages
  SET is_read = true, read_at = NEW.read_at
  WHERE id = NEW.message_id AND is_read = false;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_sync_message_read_status
  AFTER INSERT ON public.message_reads
  FOR EACH ROW
  EXECUTE FUNCTION sync_message_read_status();
```

### 4.3 RLS Policy Summary

| Table | Policy Name | Operation | Rule |
|-------|-------------|-----------|------|
| conversation_presence | Participants can read | SELECT | User is a participant of the conversation |
| conversation_presence | Users can upsert own | INSERT | auth.uid() = user_id |
| conversation_presence | Users can update own | UPDATE | auth.uid() = user_id |
| messages | (existing policies) | — | No RLS changes — is_read and read_at inherit existing message policies |

---

## 5. Edge Functions

No new edge functions required. All new functionality uses:
- Supabase Realtime broadcast (client-side, no server function needed)
- Supabase Realtime presence (client-side)
- Direct Supabase client queries (for conversation_presence upserts)

The existing `send-message-email` edge function continues to handle push notifications for messages. No changes needed.

---

## 6. Mobile Implementation

### 6.1 New Files to Create

#### 6.1.1 `services/chatPresenceService.ts`

**Purpose:** Manages conversation presence (online/offline, last seen) and typing indicator broadcast.
**Exports:** Named functions.

```typescript
import { supabase } from './supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

// --- Presence ---

export async function upsertPresence(
  conversationId: string,
  userId: string,
  isOnline: boolean
): Promise<void> {
  // Upsert into conversation_presence with onConflict: 'conversation_id,user_id'
  // Set is_online, last_seen_at: new Date().toISOString()
  // On error: console.error, do not throw (presence is non-critical)
}

export async function markAllConversationsOffline(userId: string): Promise<void> {
  // UPDATE conversation_presence SET is_online = false, last_seen_at = NOW()
  // WHERE user_id = userId AND is_online = true
  // Fire-and-forget — called on app background/close
}

export async function getConversationPresence(
  conversationId: string
): Promise<ConversationPresenceRecord[]> {
  // SELECT * FROM conversation_presence WHERE conversation_id = conversationId
  // Returns array of { user_id, is_online, last_seen_at }
}

// --- Typing ---

export function broadcastTyping(
  channel: RealtimeChannel,
  userId: string,
  isTyping: boolean
): void {
  // channel.send({ type: 'broadcast', event: isTyping ? 'typing_start' : 'typing_stop',
  //   payload: { userId, timestamp: new Date().toISOString() } })
  // No DB write — typing is ephemeral, broadcast-only
}

// --- Types ---

export interface ConversationPresenceRecord {
  user_id: string;
  is_online: boolean;
  last_seen_at: string;
}
```

#### 6.1.2 `hooks/useChatPresence.ts`

**Purpose:** Hook that subscribes to presence updates for a single conversation and exposes online/typing state for each participant.
**Exports:** Named export `useChatPresence`.

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '../services/supabase';
import {
  upsertPresence,
  markAllConversationsOffline,
  getConversationPresence,
  broadcastTyping,
  ConversationPresenceRecord,
} from '../services/chatPresenceService';

interface ChatPresenceState {
  /** Map of userId → { isOnline, lastSeenAt } */
  participants: Record<string, { isOnline: boolean; lastSeenAt: string | null }>;
  /** Set of userIds currently typing */
  typingUsers: Set<string>;
}

interface UseChatPresenceOptions {
  conversationId: string | null;
  currentUserId: string | null;
}

interface UseChatPresenceReturn {
  participants: ChatPresenceState['participants'];
  typingUsers: string[];
  startTyping: () => void;
  stopTyping: () => void;
}

export function useChatPresence({
  conversationId,
  currentUserId,
}: UseChatPresenceOptions): UseChatPresenceReturn {
  // 1. On mount (when conversationId is set):
  //    a. Fetch initial presence via getConversationPresence()
  //    b. Upsert own presence as online
  //    c. Subscribe to Supabase Realtime channel `conversation_presence:{conversationId}`
  //       - Listen for broadcast events: 'typing_start', 'typing_stop'
  //       - Listen for postgres_changes on conversation_presence table filtered by conversation_id
  //    d. Listen to AppState changes — mark offline on background, online on foreground
  //
  // 2. Typing management:
  //    - startTyping(): broadcast typing_start, set 3-second timeout
  //    - stopTyping(): broadcast typing_stop, clear timeout
  //    - On receiving typing_start from other user: add to typingUsers set
  //    - On receiving typing_stop OR 4-second timeout: remove from typingUsers set
  //
  // 3. On unmount:
  //    - Upsert own presence as offline
  //    - Unsubscribe from channel
  //
  // 4. Return:
  //    - participants: Record of userId → presence state
  //    - typingUsers: array of userIds currently typing (excludes self)
  //    - startTyping / stopTyping: functions to call from input onChange / onBlur
}
```

**staleTime justification:** N/A — this is a real-time subscription, not a React Query cache.

**Cache invalidation strategy:** Presence state is local (useState) and updated via real-time subscription. No React Query cache involved.

#### 6.1.3 `hooks/useInstantMessaging.ts`

**Purpose:** Wraps the existing `useMessagingRealtime` hook to add broadcast-based instant delivery. Messages arrive via broadcast (instant) and are also persisted to DB. The hook deduplicates so the same message doesn't appear twice.
**Exports:** Named export `useInstantMessaging`.

```typescript
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { messagingService } from '../services/messagingService';
import { DirectMessage } from '../types/messaging'; // or wherever DirectMessage is defined

interface UseInstantMessagingOptions {
  conversationId: string | null;
  currentUserId: string | null;
  onNewMessage?: (message: DirectMessage) => void;
}

interface UseInstantMessagingReturn {
  sendInstantMessage: (content: string, type: 'text' | 'image' | 'video' | 'file', fileUrl?: string, fileName?: string, fileSize?: number) => Promise<void>;
}

export function useInstantMessaging({
  conversationId,
  currentUserId,
  onNewMessage,
}: UseInstantMessagingOptions): UseInstantMessagingReturn {
  // Deduplication set: Set<string> of message IDs already rendered
  // (includes both temp- optimistic IDs and real DB IDs)

  // 1. Subscribe to broadcast channel `chat:{conversationId}`
  //    - On 'new_message' broadcast:
  //      a. If message.senderId === currentUserId, skip (already shown as optimistic)
  //      b. If message.id is in dedup set, skip
  //      c. Add to dedup set, call onNewMessage(message)

  // 2. Keep existing postgres_changes subscription (via useMessagingRealtime) as backup
  //    - On postgres_changes INSERT:
  //      a. If message.id is in dedup set, skip (already received via broadcast)
  //      b. Otherwise add to dedup set and call onNewMessage (handles case where broadcast was missed)

  // 3. sendInstantMessage():
  //    a. Generate optimistic message with temp-{timestamp} ID
  //    b. Call onNewMessage with optimistic message immediately (renders in <50ms)
  //    c. Broadcast message to channel (received by other participants in <500ms)
  //    d. Call messagingService.sendMessage() to persist to DB (async, non-blocking)
  //    e. When DB responds with real ID, update optimistic message ID in dedup set
  //    f. If DB write fails: mark message as failed (red border + retry)

  // 4. On unmount: unsubscribe from broadcast channel
}
```

#### 6.1.4 `components/FriendsModal.tsx`

**Purpose:** Tabbed modal replacing `FriendRequestsModal`. Tab 1: Friends list with swipe actions. Tab 2: Friend requests with accept/decline.
**Exports:** Default export.

```typescript
interface FriendsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMessageFriend: (friendUserId: string) => void;
}

// Implementation:
// - Reuse useFriends() hook for all data (friends, friendRequests, blockFriend, etc.)
// - Tab state: 'friends' | 'requests' (default: 'friends')
// - Friends tab:
//   - Search filter (local, filters friends array by name)
//   - FlatList of friend rows with Animated.View for swipe-to-reveal
//   - Each row: avatar + online dot, name, status text
//   - Swipe reveals: Mute, Block, Report, Remove buttons
//   - Tap row: calls onMessageFriend(friend.friend_user_id)
// - Requests tab:
//   - Reuses existing FriendRequestsModal logic (accept/decline/processed state)
//   - Visual refinements per design spec
// - Badge on Requests tab shows count of pending incoming requests
// - Modal shell: same as current FriendRequestsModal (height, radius, shadow, drag handle)
```

#### 6.1.5 `components/chat/MessageBubble.tsx`

**Purpose:** Extracted message bubble component with grouping support, compact spacing, and read receipts.
**Exports:** Named export `MessageBubble`.

```typescript
interface MessageBubbleProps {
  message: Message;
  isMe: boolean;
  groupPosition: 'solo' | 'first' | 'middle' | 'last';
  showTimestamp: boolean;
  isRead: boolean;
}

// Implementation:
// - Border radius varies by groupPosition (see design spec §4.3)
// - Margin bottom: 2px for grouped messages, 12px between different sender groups
// - Timestamp pill shown when showTimestamp=true (centered, gray pill)
// - Read receipt: shown below last sent message in group
//   - Single check = sent, double check gray = delivered, double check orange = read
// - Image/video: edge-to-edge within bubble with 3px padding
// - Styles use design system tokens from constants/designSystem.ts
```

#### 6.1.6 `components/chat/ChatStatusLine.tsx`

**Purpose:** Renders online/typing/last seen status in the chat header.
**Exports:** Named export `ChatStatusLine`.

```typescript
interface ChatStatusLineProps {
  isOnline: boolean;
  isTyping: boolean;
  lastSeenAt: string | null;
  typingUserName?: string; // For group chats
}

// Implementation:
// - isTyping takes priority over isOnline (if typing, show "typing..." not "Online")
// - isOnline shows green 6px dot + "Online" text in success.600
// - Typing shows animated 3 bouncing dots + "typing" text in primary.500
// - Offline shows "Last seen [formatLastSeen(lastSeenAt)]" in text.tertiary
// - formatLastSeen(): < 1 min → "just now", < 60 min → "Xm ago",
//   today → "today at 2:34 PM", yesterday → "yesterday at 2:34 PM",
//   else → "Mar 10 at 2:34 PM"
```

#### 6.1.7 `components/chat/TypingIndicator.tsx`

**Purpose:** Animated three-dot typing indicator.
**Exports:** Named export `TypingIndicator`.

```typescript
interface TypingIndicatorProps {
  isVisible: boolean;
  label?: string; // e.g., "typing" or "Alex is typing"
}

// Implementation:
// - 3 Animated.View dots, each 3x3px, radius.full, colors.primary[500]
// - Sequential bounce animation:
//   Dot 1: translateY cycles 0→-3→0 over 400ms, delay 0ms
//   Dot 2: same, delay 133ms
//   Dot 3: same, delay 266ms
// - Loop: infinite, Easing.inOut(Easing.ease)
// - Entry/exit: opacity 0→1 / 1→0, 150ms
// - useNativeDriver: true (translateY + opacity)
```

#### 6.1.8 `utils/messageGrouping.ts`

**Purpose:** Pure function that takes a sorted messages array and returns grouped messages with metadata for rendering.
**Exports:** Named function `groupMessages`.

```typescript
interface GroupedMessage {
  message: Message;
  groupPosition: 'solo' | 'first' | 'middle' | 'last';
  showTimestamp: boolean; // true if >5 min gap before this message
}

export function groupMessages(messages: Message[]): GroupedMessage[] {
  // Algorithm:
  // 1. Iterate messages in chronological order
  // 2. For each message, check:
  //    a. Same sender as previous? (senderId match)
  //    b. Within 2 minutes of previous? (timestamp diff < 120000ms)
  //    If both true: part of same group
  //    If either false: start new group
  // 3. Assign groupPosition:
  //    - Group of 1 message: 'solo'
  //    - First in group of 2+: 'first'
  //    - Last in group of 2+: 'last'
  //    - Middle: 'middle'
  // 4. showTimestamp: true if gap between this message and previous > 5 minutes (300000ms)
  //    Always true for the first message in the conversation
}
```

### 6.2 Files to Modify

#### 6.2.1 `components/MessageInterface.tsx`

**What to change:** Integrate presence, typing, instant messaging, compact spacing, and extracted MessageBubble.

**Changes (in order):**

1. **Replace keyboard handling** — Remove the manual `Keyboard.addListener` useEffect (lines 130-161). Replace with the existing `useKeyboard` hook from `hooks/useKeyboard.ts`.

2. **Fix input area spacing** — In the `inputArea` style (line 1546):
   ```typescript
   // OLD:
   inputArea: {
     borderTopWidth: 1,
     borderTopColor: "#e5e7eb",
     paddingHorizontal: 16,
     paddingTop: 12,
     paddingBottom: 12,
     backgroundColor: "white",
   }
   // NEW:
   inputArea: {
     borderTopWidth: 0.5,
     borderTopColor: colors.gray[200],
     paddingHorizontal: 8,
     paddingTop: 6,
     paddingBottom: 6,  // Will be overridden by safe area when keyboard is closed
     backgroundColor: colors.background.primary,
   }
   ```

3. **Fix keyboard height interpolation** — Remove the dead zone. Currently (conceptually):
   ```typescript
   // OLD: marginBottom with inputRange [0, 16, 400] outputRange [0, 0, 384]
   // NEW: marginBottom equals exactly keyboardHeight (no interpolation needed)
   // Just use: marginBottom: keyboardHeight
   // On iOS, subtract the bottom safe area inset from the keyboard height
   // (keyboard height includes safe area, so subtract to avoid double-counting)
   ```

4. **Replace inline renderMessage** — Remove the `renderMessage` function (lines 461-630+). Replace with:
   ```typescript
   import { MessageBubble } from './chat/MessageBubble';
   import { groupMessages } from '../utils/messageGrouping';

   // In render:
   const groupedMessages = groupMessages(messages);
   // Map groupedMessages to <MessageBubble ... /> components
   ```

5. **Add presence hook** — Import and use `useChatPresence`:
   ```typescript
   import { useChatPresence } from '../hooks/useChatPresence';

   // Inside component:
   const { participants, typingUsers, startTyping, stopTyping } = useChatPresence({
     conversationId: currentConversationId, // need to add this prop or derive it
     currentUserId: currentUserId, // need to add this prop
   });
   ```

6. **Add instant messaging hook** — Import and use `useInstantMessaging`:
   ```typescript
   import { useInstantMessaging } from '../hooks/useInstantMessaging';

   // Replace the current onSendMessage prop usage with sendInstantMessage
   const { sendInstantMessage } = useInstantMessaging({
     conversationId: currentConversationId,
     currentUserId: currentUserId,
     onNewMessage: (msg) => { /* append to messages state */ },
   });
   ```

7. **Update header** — Replace the current header section with ChatStatusLine:
   ```typescript
   import { ChatStatusLine } from './chat/ChatStatusLine';

   // In header, below the friend name:
   <ChatStatusLine
     isOnline={otherParticipantPresence?.isOnline ?? false}
     isTyping={typingUsers.includes(friend.id)}
     lastSeenAt={otherParticipantPresence?.lastSeenAt ?? null}
   />
   ```

8. **Wire typing to input** — On TextInput `onChangeText`, call `startTyping()`. On `onBlur` or after 3 seconds of no input, call `stopTyping()`.

9. **Add pull-to-load-more** — Add `onScroll` handler to ScrollView that detects when scrolled to top and loads older messages.

10. **Compact message container spacing** — Change `messageContainer` style:
    ```typescript
    // OLD: messageContainer: { marginBottom: 16 }
    // NEW: spacing is handled by MessageBubble based on groupPosition
    ```

11. **Add conversationId and currentUserId props** — MessageInterface needs to receive the actual conversation ID (not just friend data) to subscribe to presence and broadcast channels:
    ```typescript
    interface MessageInterfaceProps {
      // ... existing props ...
      conversationId: string;  // ADD
      currentUserId: string;   // ADD
    }
    ```

#### 6.2.2 `components/ConnectionsPage.tsx`

**What to change:** Replace `FriendRequestsModal` with `FriendsModal`.

1. Replace import:
   ```typescript
   // OLD: import FriendRequestsModal from './FriendRequestsModal';
   // NEW: import FriendsModal from './FriendsModal';
   ```

2. Replace component usage — same props pattern (isOpen, onClose), add onMessageFriend callback that navigates to the conversation with the selected friend.

3. Pass `conversationId` and `currentUserId` to `MessageInterface` when rendering it.

#### 6.2.3 `services/messagingService.ts`

**What to change:** Add broadcast sending alongside DB persistence.

1. After `sendMessage()` inserts into the DB, also broadcast the message to the conversation channel:
   ```typescript
   // After successful DB insert:
   const channel = supabase.channel(`chat:${conversationId}`);
   channel.send({
     type: 'broadcast',
     event: 'new_message',
     payload: {
       id: insertedMessage.id,
       conversation_id: conversationId,
       sender_id: senderId,
       content,
       message_type: type,
       file_url: fileUrl,
       file_name: fileName,
       file_size: fileSize,
       created_at: insertedMessage.created_at,
     },
   });
   ```

   **Important:** The broadcast must happen AFTER the DB insert succeeds (not before) to ensure the message ID is real. The instant delivery on the sender side comes from the optimistic update in `useInstantMessaging`, not from the broadcast. The broadcast is what makes it instant for the RECEIVER.

2. Add a method to subscribe to the broadcast channel:
   ```typescript
   export function subscribeToChatBroadcast(
     conversationId: string,
     onMessage: (message: DirectMessage) => void
   ): RealtimeChannel {
     return supabase
       .channel(`chat:${conversationId}`)
       .on('broadcast', { event: 'new_message' }, (payload) => {
         onMessage(payload.payload as DirectMessage);
       })
       .subscribe();
   }
   ```

#### 6.2.4 `hooks/useMessagingRealtime.ts`

**What to change:** No changes needed. This hook continues to work as a backup for postgres_changes events. The `useInstantMessaging` hook wraps it and adds broadcast-based delivery on top.

#### 6.2.5 `services/realtimeService.ts`

**What to change:** No changes needed. The new `chatPresenceService.ts` handles DM/group presence separately from board presence. The existing board presence system (`board_participant_presence`) is unaffected.

### 6.3 State Changes

**Zustand:** No Zustand changes. All new state is local (useState in hooks) or real-time (subscriptions).

**React Query keys affected:**
- No new React Query keys. Presence and typing are real-time subscription state, not cached query state.
- Existing message query keys are unaffected — messages are still loaded from DB on conversation open, but instant updates come via broadcast subscription.

---

## 7. Implementation Order

**Step 1: Run the database migrations.**
Create migration files at:
- `supabase/migrations/20260312200001_chat_presence_and_typing.sql` (§4.1)
- `supabase/migrations/20260312200002_add_message_read_status_columns.sql` (§4.2)

Execute both in the Supabase SQL editor. Verify:
- `SELECT * FROM conversation_presence LIMIT 1` returns zero rows with correct columns.
- `SELECT is_read, read_at FROM messages LIMIT 1` returns the new columns.
- RLS: unauthenticated query on conversation_presence returns permission denied.

**Step 2: Create the utility — `utils/messageGrouping.ts`.**
Implement `groupMessages()` per §6.1.8. This is a pure function with no dependencies — easy to test in isolation. Verify: write a quick test with 5 messages (3 from same sender within 1 min, then 2 from different sender) and confirm group positions are correct.

**Step 3: Create the presence service — `services/chatPresenceService.ts`.**
Implement per §6.1.1. Verify: call `upsertPresence()` with a test conversation ID and user ID, confirm the row appears in the DB.

**Step 4: Create the typing indicator component — `components/chat/TypingIndicator.tsx`.**
Implement per §6.1.7. Verify: render in a test screen with `isVisible={true}` and confirm dots animate.

**Step 5: Create the status line component — `components/chat/ChatStatusLine.tsx`.**
Implement per §6.1.6. Verify: render with `isOnline={true}`, `isTyping={true}`, and offline state to confirm all three renders.

**Step 6: Create the message bubble component — `components/chat/MessageBubble.tsx`.**
Implement per §6.1.5, using design spec §4.3 for exact styles. Verify: render 4 bubbles with different `groupPosition` values and confirm radius/spacing changes.

**Step 7: Create the presence hook — `hooks/useChatPresence.ts`.**
Implement per §6.1.2. Verify: open two simulator instances on the same conversation, confirm one sees the other as "Online." Close one, confirm the other updates to "Last seen."

**Step 8: Create the instant messaging hook — `hooks/useInstantMessaging.ts`.**
Implement per §6.1.3. Verify: send a message from Device A, confirm Device B receives it via broadcast in <500ms.

**Step 9: Modify `MessageInterface.tsx`.**
Apply all changes from §6.2.1 in order. This is the largest change. Verify:
- Keyboard gap is ≤8px on iOS and Android
- Messages are grouped with 2px spacing
- Typing indicator shows in header
- Online status shows in header
- Pull-to-load works at top of scroll
- Messages arrive instantly via broadcast

**Step 10: Create `FriendsModal.tsx`.**
Implement per §6.1.4. Verify:
- Opens with Friends tab by default
- Shows all friends with online status
- Swipe-to-reveal shows Mute/Block/Report/Remove
- Requests tab shows pending requests with accept/decline
- Tab badge shows correct count

**Step 11: Modify `ConnectionsPage.tsx`.**
Replace `FriendRequestsModal` with `FriendsModal` per §6.2.2. Verify: the same button that opened friend requests now opens the new tabbed modal. Tapping a friend navigates to their chat.

**Step 12: Modify `messagingService.ts`.**
Add broadcast sending per §6.2.3. Verify: sending a message now broadcasts AND persists. Receiving side gets message via broadcast (fast path) and postgres_changes (backup path) without duplication.

**Step 13: Integration test.**
Full end-to-end flow:
1. Open Friends Modal → see friends list with online status
2. Tap a friend → navigate to chat
3. See their online/offline status in header
4. Type a message → other user sees "typing..." in their header
5. Send message → appears on both devices in <500ms
6. See grouped messages with compact spacing
7. Verify keyboard hugs input bar with minimal gap
8. Swipe on a friend → mute/block/report/remove works
9. Accept a friend request → request animates out

---

## 8. Test Cases

| # | Test | Input | Expected Output | Layer |
|---|------|-------|-----------------|-------|
| 1 | Presence upsert | `upsertPresence(convId, userId, true)` | Row in conversation_presence with is_online=true | DB |
| 2 | Presence RLS — participant | Authenticated user who IS a participant queries conversation_presence | Returns presence rows for that conversation | DB |
| 3 | Presence RLS — non-participant | Authenticated user who is NOT a participant queries conversation_presence | Returns 0 rows | DB |
| 4 | Message grouping — same sender <2min | 3 messages from user A, 30s apart | `['first', 'middle', 'last']` | Utility |
| 5 | Message grouping — different senders | Message from A, then message from B | Both `'solo'` | Utility |
| 6 | Message grouping — same sender >2min gap | 2 messages from A, 3 min apart | Both `'solo'` | Utility |
| 7 | Timestamp display — >5min gap | Messages at 2:00 PM and 2:06 PM | `showTimestamp=true` on second cluster | Utility |
| 8 | Timestamp display — <5min gap | Messages at 2:00 PM and 2:03 PM | `showTimestamp=false` on second message | Utility |
| 9 | Broadcast instant delivery | User A sends message to User B | User B receives via broadcast in <500ms | Hook |
| 10 | Deduplication | Same message arrives via broadcast then postgres_changes | Message renders only once | Hook |
| 11 | Typing indicator shows | User A types in input → broadcastTyping(channel, userId, true) | User B sees "typing..." in header | Component |
| 12 | Typing indicator hides after 3s | User A stops typing | User B's typing indicator disappears after 3s | Component |
| 13 | Online status shows | User B opens conversation | User A sees green dot + "Online" in header | Component |
| 14 | Last seen shows | User B backgrounds app | User A sees "Last seen [time]" in header | Component |
| 15 | Friends modal — friends tab | Open modal, user has 5 friends | Shows 5 friend rows with online status | Component |
| 16 | Friends modal — swipe mute | Swipe left on friend, tap Mute | Friend is muted, muteService.muteUser called | Component |
| 17 | Friends modal — swipe block | Swipe left on friend, tap Block | Friend is blocked, blockService.blockUser called, friend removed from list | Component |
| 18 | Friends modal — requests tab | Switch to Requests tab, 2 pending | Shows 2 request rows with Accept/Decline | Component |
| 19 | Friends modal — accept request | Tap Accept on request | Request accepted, row animates out, friend appears in Friends tab | Component |
| 20 | Compact spacing | Render 3 grouped messages | Vertical gap between them is 2px, not 16px | Component |
| 21 | Input bar keyboard gap — iOS | Open keyboard | Gap between input bar and keyboard ≤8px | Component |
| 22 | Input bar keyboard gap — Android | Open keyboard | Gap between input bar and keyboard ≤8px | Component |
| 23 | Pull to load more | Scroll to top, pull down | Older messages loaded, scroll position maintained | Component |
| 24 | Read receipt display | Send message, recipient reads | Sender sees orange double-check on last message | Component |
| 25 | Optimistic message | Send message on slow connection | Message appears instantly with sending state, updates when confirmed | Hook |
| 26 | Failed message | Send message with no internet | Message shows red border + retry icon after timeout | Hook |
| 27 | Group chat typing | 2 users typing in group | Header shows "Alex and 1 other typing" | Component |
| 28 | is_read sync trigger | Insert into message_reads | Corresponding messages.is_read becomes true | DB |

---

## 9. Common Mistakes to Avoid

1. **Double-rendering messages from broadcast + postgres_changes:** The broadcast arrives in <500ms, the postgres_changes event arrives in 1-3s. Without deduplication, the same message renders twice. **Correct approach:** Maintain a `Set<string>` of rendered message IDs. Check before adding any message from either source.

2. **Keyboard height includes safe area on iOS:** On iPhone X+, `event.endCoordinates.height` includes the home indicator area (~34px). If you also add `paddingBottom: insets.bottom`, you get a ~34px gap. **Correct approach:** When keyboard is visible, set `paddingBottom: 6` (the minimum), not `insets.bottom`. The keyboard height already accounts for the safe area.

3. **Presence upsert race on conversation open:** When a user opens a conversation, the presence upsert and the presence fetch can race — the fetch might return before the upsert completes, missing the user's own online status. **Correct approach:** Don't fetch own presence from DB. Set own status to online locally immediately. Only fetch OTHER participants' presence from DB.

4. **Typing indicator not clearing on send:** If the user is typing and hits send, the typing indicator should clear immediately — not wait for the 3-second timeout. **Correct approach:** Call `stopTyping()` in `handleSendMessage()` before sending.

5. **Message grouping recalculated on every render:** The `groupMessages()` utility iterates the entire messages array. If called on every render, it's O(n) on every keystroke. **Correct approach:** Memoize with `useMemo`, keyed on `messages.length` and the last message's ID.

---

## 10. Handoff to Implementor

Implementor: this document is your single source of truth. Execute it top to bottom, in the exact order specified in §7. Do not skip steps. Do not reorder steps. Do not add features, refactor adjacent code, or "improve" anything outside the scope of this spec.

Every file path, function signature, type definition, SQL statement, and validation rule in this document is intentional and exact — copy them precisely. The companion `DESIGN_CHAT_EXPERIENCE_OVERHAUL_SPEC.md` contains all visual specifications (colors, spacing, animations, states) — reference it for every pixel decision.

If something in this spec is unclear or seems wrong, stop and ask before improvising. When you are finished, produce your `IMPLEMENTATION_REPORT.md` referencing each section of this spec to confirm compliance, then hand the implementation to the tester. Your work is not done until the tester's report comes back green.
