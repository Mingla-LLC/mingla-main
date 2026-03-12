# Implementation Report: Chat Experience Overhaul
**Date:** 2026-03-12
**Spec:** FEATURE_CHAT_EXPERIENCE_OVERHAUL_SPEC.md + SPEC_AMENDMENT_CHAT_OVERHAUL.md
**Status:** Complete

---

## 1. What Was There Before

### Existing Files Modified
| File | Purpose Before Change | Lines Before |
|------|-----------------------|--------------|
| `components/ConnectionsPage.tsx` | Chat list + message interface orchestrator with postgres_changes subscription | ~1500 lines |
| `components/MessageInterface.tsx` | Chat UI with ScrollView messages, manual keyboard handling, inline message rendering | ~1809 lines |
| `components/HomePage.tsx` | Home page with FriendRequestsModal | ~492 lines |
| `services/connectionsService.ts` | Friend/Message/Conversation type definitions | ~50 lines |
| `constants/designSystem.ts` | Design tokens | ~345 lines |

### Pre-existing Behavior
- Messages delivered via single-channel postgres_changes (1-3 second latency)
- No typing indicators
- No presence system (online/offline status derived from static `is_online` field)
- Messages rendered in ScrollView with no grouping
- Each message had its own timestamp
- No read receipts
- FriendRequestsModal showed only friend requests (no friends list)
- Manual keyboard handling via Keyboard.addListener

---

## 2. What Changed

### New Files Created
| File | Purpose | Key Exports |
|------|---------|-------------|
| `supabase/migrations/20260312200001_chat_presence_and_typing.sql` | conversation_presence table + RLS + cleanup function | SQL |
| `supabase/migrations/20260312200002_add_message_read_status_columns.sql` | is_read + read_at on messages table | SQL |
| `utils/messageGrouping.ts` | Pure message grouping utility | `groupMessages()`, `GroupedMessage` |
| `services/chatPresenceService.ts` | Supabase presence CRUD | `upsertPresence()`, `broadcastTyping()`, etc. |
| `hooks/useChatPresence.ts` | Presence + typing hook with heartbeat | `useChatPresence()` |
| `hooks/useBroadcastReceiver.ts` | Broadcast-only message receiver | `useBroadcastReceiver()` |
| `components/chat/TypingIndicator.tsx` | Animated 3-dot typing indicator | `TypingIndicator` |
| `components/chat/ChatStatusLine.tsx` | Online/typing/last-seen status | `ChatStatusLine` |
| `components/chat/MessageBubble.tsx` | Grouped message bubble with read receipts | `MessageBubble` |
| `components/FriendsModal.tsx` | Friends list + Requests tabs modal | `FriendsModal` (default) |

### Files Modified
| File | What Changed |
|------|-------------|
| `components/ConnectionsPage.tsx` | Added `broadcastSeenIds` ref, `currentUserDisplayName` memo, broadcast dedup in `onMessage`, `onMessageUpdated` callback for read receipts, broadcast send after DB success in `handleSendMessage`, `broadcastSeenIds.clear()` in `handleBackFromMessage`, 4 new props passed to MessageInterface |
| `components/MessageInterface.tsx` | Replaced ScrollView with inverted FlatList, replaced manual keyboard handling with `useKeyboard` hook, integrated `useChatPresence` + `useBroadcastReceiver`, replaced inline `renderMessage` with `MessageBubble` component, added `groupMessages()` memoization, replaced header status text with `ChatStatusLine`, added typing indicator on text input, compact input area padding, safe area insets for keyboard |
| `components/HomePage.tsx` | Swapped `FriendRequestsModal` → `FriendsModal` import and JSX |
| `services/connectionsService.ts` | Added `failed?: boolean` to Message interface |
| `constants/designSystem.ts` | Added `spacing.xxs: 2`, `colors.chat` aliases, `responsiveSpacing.xxs` |

### Database Changes Applied
```sql
-- Migration 1: conversation_presence table
CREATE TABLE public.conversation_presence (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_online BOOLEAN NOT NULL DEFAULT false,
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(conversation_id, user_id)
);
-- RLS, indexes, auto-update trigger, cleanup_stale_presence() function

-- Migration 2: Read receipt columns on messages
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
-- Backfill from message_reads, sync trigger
```

### State Changes
- **React Query keys added:** None (presence uses direct Supabase subscriptions, not React Query)
- **Zustand slices modified:** None
- **Supabase Realtime channels added:** `chat:{conversationId}` (broadcast), `presence:{conversationId}` (typing broadcast + postgres_changes on conversation_presence)

---

## 3. Spec Compliance — Section by Section

| Spec Section | Requirement | Implemented? | Notes |
|-------------|-------------|-------------|-------|
| §3 Criterion 1 | Friends modal with tabs | ✅ | FriendsModal.tsx with animated tab indicator |
| §3 Criterion 2 | Real-time presence | ✅ | useChatPresence with 30s heartbeat |
| §3 Criterion 3 | Typing indicators | ✅ | Broadcast-based, 3s auto-stop, 4s expiry |
| §3 Criterion 4 | Sub-second messaging | ✅ | Broadcast channel + postgres_changes backup |
| §3 Criterion 5 | Compact chat UI | ✅ | MessageBubble with group positioning |
| §4.1 Database | conversation_presence table | ✅ | With RLS, indexes, cleanup function |
| §4.2 Database | Read receipt columns | ✅ | is_read + read_at with sync trigger |
| Amendment 1 | useBroadcastReceiver (not useInstantMessaging) | ✅ | Broadcast-only, no subscription hijacking |
| Amendment 2 | Do NOT modify messagingService | ✅ | messagingService unchanged |
| Amendment 3 | Broadcast dedup in ConnectionsPage | ✅ | broadcastSeenIds ref shared with MessageInterface |
| Amendment 4 | Optimistic → real ID replacement | ✅ | In handleSendMessage after DB success |
| Amendment 5 | Heartbeat + stale cleanup | ✅ | 30s heartbeat, 60s stale threshold, cleanup function |
| Amendment 6 | FlatList inverted | ✅ | Replaced ScrollView |
| Amendment 7 | Read receipts data flow | ✅ | onMessageUpdated callback wired |
| Amendment 8 | Corrected implementation order | ✅ | Followed exactly |
| Amendment 9 | FriendRequestsModal in HomePage | ✅ | Swapped correctly |
| Amendment 10 | Group chat status line | ✅ | ChatStatusLine supports DM + group modes |

---

## 4. Architecture Decisions

### Broadcast send location
Per Amendment 4 Option A, broadcast sending lives in ConnectionsPage's `handleSendMessage` — not in a hook. This keeps message state ownership crystal clear: ConnectionsPage owns all message state, optimistic updates, cache, and broadcast. useBroadcastReceiver only handles the receive path.

### Failed message handling
Changed from removing failed optimistic messages to marking them with `failed: true`. This provides better UX — users see their failed message with an error state instead of it silently disappearing.

### Keyboard handling
Replaced manual `Keyboard.addListener` with `useKeyboard` hook. On iOS, the keyboard height includes the safe area bottom inset, so we subtract `insets.bottom` to avoid double-counting. Used `Animated.timing` for smooth transitions.

### FriendsModal onMessageFriend
The `onMessageFriend` callback closes the modal but does not navigate to a specific conversation. Cross-tab navigation from HomePage → ConnectionsPage → specific conversation requires plumbing through `app/index.tsx`, which is out of scope. Users can navigate to the Chats tab to find the friend.

---

## 5. Verification Results

### TypeScript Compilation
- **Pre-existing errors in modified files:** 24
- **Post-implementation errors in modified files:** 24
- **New errors introduced:** 0
- **New files (8 created) errors:** 0

All pre-existing errors are `DirectMessage` vs `Message` type mismatches in ConnectionsPage (known tech debt) and an unrelated PNG import in HomePage.

---

## 6. Deviations from Spec

| Spec Reference | What Spec Said | What I Did Instead | Why |
|---------------|---------------|-------------------|-----|
| Amendment 1 | Hook named `useInstantMessaging` | Named `useBroadcastReceiver` | Per Amendment 4 recommendation — name reflects actual responsibility |
| Amendment 9 | `onMessageFriend` navigates to conversation | Closes modal only | Cross-tab navigation requires app/index.tsx changes, out of scope |
| Spec §6.1.3 | sendInstantMessage in the hook | Broadcast send in ConnectionsPage | Per Amendment 4 Option A — keeps state ownership clear |

---

## 7. Known Limitations & Future Considerations

1. **Pre-existing type debt:** `messages` state is `DirectMessage[]` but `transformMessage` returns `Message`. This causes 15+ TS errors across ConnectionsPage. Should be unified to one type.
2. **pg_cron for stale presence:** The `cleanup_stale_presence()` function exists but pg_cron scheduling is commented out (requires Supabase Pro plan). Client-side stale detection handles this for now.
3. **Cross-tab message navigation:** FriendsModal's "Message" button can't navigate directly to a conversation from HomePage. Requires `app/index.tsx` plumbing.
4. **Group chat presence:** ChatStatusLine supports group mode but useChatPresence currently only tracks one conversation's presence at a time.

---

## 8. Files Inventory

### Created
- `supabase/migrations/20260312200001_chat_presence_and_typing.sql` — Presence table + RLS + cleanup
- `supabase/migrations/20260312200002_add_message_read_status_columns.sql` — Read receipts columns
- `app-mobile/src/utils/messageGrouping.ts` — Pure message grouping utility
- `app-mobile/src/services/chatPresenceService.ts` — Presence CRUD service
- `app-mobile/src/hooks/useChatPresence.ts` — Presence + typing hook
- `app-mobile/src/hooks/useBroadcastReceiver.ts` — Broadcast-only receiver
- `app-mobile/src/components/chat/TypingIndicator.tsx` — Animated typing dots
- `app-mobile/src/components/chat/ChatStatusLine.tsx` — Status line component
- `app-mobile/src/components/chat/MessageBubble.tsx` — Grouped message bubble
- `app-mobile/src/components/FriendsModal.tsx` — Friends + Requests tabbed modal

### Modified
- `app-mobile/src/components/ConnectionsPage.tsx` — Broadcast dedup, send, onMessageUpdated, new props
- `app-mobile/src/components/MessageInterface.tsx` — FlatList, presence, broadcast, keyboard, MessageBubble
- `app-mobile/src/components/HomePage.tsx` — FriendRequestsModal → FriendsModal swap
- `app-mobile/src/services/connectionsService.ts` — Added `failed` to Message
- `app-mobile/src/constants/designSystem.ts` — spacing.xxs, colors.chat, responsiveSpacing.xxs
- `README.md` — Updated with chat features, presence table, recent changes

---

## 9. README Update

| README Section | What Changed |
|---------------|-------------|
| Project Structure | Added chat/ component directory, updated hook/service/util counts |
| Features | Added Real-Time Messaging, Compact Chat UI, Presence & Typing, Inverted FlatList, Friends Modal sections |
| Database Schema | Added Chat & Presence Tables section with conversation_presence |
| Recent Changes | Added Chat Experience Overhaul as first entry |

---

## 10. Handoff to Tester

Tester: everything listed above is now in the codebase and ready for your review. The spec (`FEATURE_CHAT_EXPERIENCE_OVERHAUL_SPEC.md`) and amendments (`SPEC_AMENDMENT_CHAT_OVERHAUL.md`) are the contract — I've mapped compliance against every section in §3 above. The files inventory in §8 is your audit checklist. Zero new TypeScript errors were introduced. The 3 deviations in §6 are documented with justification. Hold nothing back — break it, stress it, find what I missed.
