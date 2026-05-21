# SPEC — ORCH-0908 (bundled scope: chat @-mention + #-tag cards)

**Sub-scope label:** Chat @-mention users + #-tag cards
**Bundle parent:** ORCH-0908 [Collab session lifecycle: Lock-In → Schedule → V_{n+1} Recycle]
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0908_CHAT_MENTION_AND_CARD_TAG.md`
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0908_CHAT_MENTION_AND_CARD_TAG.md`
**Skill:** Claude `mingla-forensics` (SPEC mode)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Date:** 2026-05-21

---

## §1 Layman summary

Add `@` mentions of conversation participants and `#` card-tags to the
unified chat (both DM and collab-session group chats). The mention chip in
the message bubble is already shipped; this work wires up the input UI,
the structured-data persistence, the picker overlays for both `@` and `#`,
the card-chip render in bubbles, the push-notification dispatch on
mention, and a mute-flag honor in the existing notify-message edge
function. Bundled into ORCH-0908 so a single PR ships the operator's
lock-and-schedule fix + expanded chat expressiveness together.

---

## §2 Scope, non-goals, assumptions

### §2.1 Scope (exhaustive)

1. New `messages.card_tags jsonb NOT NULL DEFAULT '[]'::jsonb` column in
   migration `20260701000000_orch_0908_chat_card_tags.sql`.
2. In-place shape upgrade of `messages.mentions jsonb` from
   `[user_uuid]` → `[{userId, displayName, startOffset, endOffset}]`.
   Backward-compatible — renderer + sender handle both shapes.
3. `MessageInterface.tsx` TextInput rewrite to:
   - Detect `@` and `#` triggers in onChangeText.
   - Mount `MentionPopover` (existing) and `CardTagPopover` (existing)
     scoped per conversation type.
   - Render selected mentions + card-tags as **styled inline `<Text>`
     chips inside the TextInput** (orange bg, white text, rounded on
     iOS, square highlight on Android — documented platform parity
     trade-off per Investigation F-8).
   - Atomic backspace via `onKeyPress` (hardware kbd) + `onChangeText`
     diffing (Android soft-kbd fallback).
4. `messagingService.sendMessage` extended to accept + persist `mentions`
   + `cardTags` and to fan out `notify-message` with `type='message_mention'`
   for mentioned users (collapse-aware vs the regular `type='message'`).
5. `MessageBubble.tsx` upgraded to read structured `mentions[]` and
   `card_tags[]` arrays for chip + card-chip render. Backward-compat
   fallback to existing regex for legacy `mentions: [user_uuid]` rows.
6. New small components: `ChatInputChipsLayer` (the styled-inline chip
   render inside TextInput), `ChatCardChip` (wrapper around `CardPreview`
   with onPress wired to `cardPayloadToExpandedCardData`).
7. New hook: `useChatInputController({ conversationId, conversationType,
   participants, savedCardsSource })` — encapsulates the input state
   machine (popover visibility, chip tracking Map, send-time serialization).
8. New hooks (small, reusable):
   - `useConversationParticipants(conversationId)` — wraps the canonical
     `conversation_participants → profiles` query.
   - `useChatCardTagSource({ conversationId, conversationType, sessionId? })`
     — returns the right card pool based on conversation type.
9. Patch `notify-message/index.ts handleUnifiedMention`:
   - Title format → `"{{ActorName}} mentioned you in {{ConversationName}}"`.
     For DMs where `conv.name` is NULL, derive name from "the other
     participant's display_name" (or "your conversation" if multiple).
   - Check `conversation_participants.notifications_muted` before
     dispatching to a mentioned user (suppress push if muted; in-app
     notification row still inserted).
   - **DEPLOY** required after migration push (orchestrator owns the
     `supabase functions deploy notify-message` per the carve-out).

### §2.2 Non-goals (explicit exclusions)

- **App-wide user search.** Mentions are conversation-participants only.
- **Mentioning a participant who has not accepted yet** (session_participants
  with `has_accepted=false`). They're not in `conversation_participants` by
  ORCH-0898's trigger contract.
- **`@everyone` / `@here` group mentions.** Out of scope.
- **Edit-message-with-mention-changes.** Existing edit path is unchanged;
  edited content is re-parsed via regex fallback. Editing mentions is
  deferred to a future ORCH if needed.
- **Mention/tag suggestions while typing in the middle of a chip.** Picker
  triggers only on new `@` or `#` at end of current text or after a space.
- **Card-tag autosuggest based on context** (e.g., suggest a recently-viewed
  card). v1 lists by recency; smart-rank deferred.
- **Retiring `BoardDiscussionTab`** (the per-card discussion legacy
  surface). Out of scope; a follow-up ORCH should retire it once the unified
  chat fully covers its use cases.
- **Native Android `borderRadius` perfect parity** on chip-in-input. v1
  ships with rectangular highlight on Android. Library upgrade for
  parity = future ORCH if operator decides.

### §2.3 Assumptions (must hold at implementation start)

| # | Assumption | Verification path |
|---|------------|--------------------|
| A1 | Migration `20260630000000_orch_0908_card_payload_flatten.sql` is pushed to remote BEFORE this work's migration is applied. | Operator confirmation in CLOSE flow. |
| A2 | `messages.mentions jsonb` column exists and accepts arbitrary jsonb arrays. | Verified by mcp `execute_sql` earlier this session. |
| A3 | `conversation_participants` is populated for both session chats (via ORCH-0898 trigger) and DMs (via existing DM creation flow). | ORCH-0898 SPEC §3.1 Step 5. |
| A4 | `notify-message` edge function is callable from app-mobile via `supabase.functions.invoke('notify-message', ...)`. | Already used by `messagingService.ts:1188`. |
| A5 | `cardPayloadToExpandedCardData` post-ORCH-0908 legacy-tolerant adapter is in place. | Verified by direct read of `cardPayloadAdapter.ts` this session. |
| A6 | Latest migration prefix in `supabase/migrations/` is `20260630000000`. New migration uses `20260701000000` (monotonic). | Verified by `ls supabase/migrations/` this session. |
| A7 | `trimCardPayload` in `messagingService.ts:115` enforces NO travelTime/distance (Constitution #9 + I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS). | Verified by direct read. |
| A8 | `MentionChip`, `MentionPopover`, `CardTagPopover`, `CardPreview` components exist as documented in Investigation F-2. | Verified by direct file size + read. |

---

## §2.5 Cross-Surface Impact (MANDATORY per Phase 2.5)

| # | Surface | In scope? | User-visible behaviour | File paths touched | Parity |
|---|---------|-----------|------------------------|---------------------|--------|
| 1 | **Consumer iOS** | YES | Type `@` → participant picker → tap user → orange rounded chip inline in input. Type `#` → card picker → tap card → inline card chip. Backspace on chip deletes chip + `@`/`#` atomically. Mentioned user gets a push titled "{{Actor}} mentioned you in {{ConvName}}". Bubble shows chips + tappable card chips that open `ExpandedCardModal`. | `app-mobile/src/components/MessageInterface.tsx`, `app-mobile/src/components/chat/MessageBubble.tsx`, `app-mobile/src/components/chat/ChatInputChipsLayer.tsx` (new), `app-mobile/src/components/chat/ChatCardChip.tsx` (new), `app-mobile/src/hooks/useChatInputController.ts` (new), `app-mobile/src/hooks/useConversationParticipants.ts` (new), `app-mobile/src/hooks/useChatCardTagSource.ts` (new), `app-mobile/src/services/messagingService.ts`, `app-mobile/src/services/cardPayloadAdapter.ts` (no change to adapter for this scope), `supabase/functions/notify-message/index.ts`, `supabase/migrations/20260701000000_orch_0908_chat_card_tags.sql` | Automatic (shared code with Android) |
| 2 | **Consumer Android** | YES | Same as iOS EXCEPT: input chip-look is a rectangular orange highlight (no rounded corners on the inline `<Text>` background on Android RN soft-keyboard). Atomic backspace falls back to `onChangeText` diffing where `onKeyPress` doesn't fire (Gboard, SwiftKey). | Same paths as iOS — shared `app-mobile/` code. | Automatic (shared code) with platform-specific behaviour documented + tested per SC-N-Android criteria below |
| 3 | **Buyer/anonymous Web** | NO | No chat surface on `/checkout/{eventId}` / `/e/...` / `/b/...` (anonymous buyer flow). |  |  |
| 4 | **Business iOS** | NO | `mingla-business/` has no consumer chat. Brand-buyer messaging is a separate Marketing-Hub channel (blast / email / SMS), out of scope here. |  |  |
| 5 | **Business Android** | NO | Same as Business iOS. |  |  |
| 6 | **Admin Web** | NO | `mingla-admin/` has no chat. Admin oversight of chat (moderation) is not in scope. |  |  |
| 7 | **Business Web preview** | NO | No consumer chat on business-web-preview. |  |  |

**Parity stance:** Mobile-only feature; iOS + Android consume identical code.
Where platform behaviour diverges (Android chip-corner rendering; Android
soft-kbd backspace), that's called out in SC criteria as separate per-
platform gates so tester verifies BOTH.

---

## §3 Operator-locked decisions (binding — restated from dispatch)

| ID | Decision |
|----|----------|
| D-1 | @-mention scope = current conversation's participants only (no app-wide search). Query: `conversation_participants` JOIN `profiles` WHERE `conversation_id = X AND user_id != current`. |
| D-2 | #-tag card scope = (session chats) session-saved + session-locked cards from `board_saved_cards WHERE session_id = X`; (DMs) own `saved_card WHERE profile_id = current`. NO active-deck cards. NO cross-session cards in DMs. |
| D-3 | @-mention triggers a separate push with title `"{{ActorName}} mentioned you in {{ConversationName}}"`, type `board_message_mention` (notification icon already mapped at `NotificationsModal.tsx:84`), per-user mute via existing `conversation_participants.notifications_muted` toggle. |
| D-4 | Mention render = chip in input AND in bubble. NEVER a raw `@username` slug visible to the user. (Implementation: styled inline `<Text>` chip in TextInput per F-8; `MentionChip` View in bubble. iOS rounds; Android squared — known v1 trade-off.) |
| D-5 | Backspace on a chip = atomic delete of chip + leading trigger char in ONE keystroke. iOS + Android both required. |
| D-6 | Card chip render = thumb + title (via existing `CardPreview`); tap = `setExpandedCardFromChat(cardPayloadToExpandedCardData(cardTag.cardPayload))`. Same modal, same adapter, same flat-CardPayload contract (with ORCH-0908 legacy-tolerant fallback). |

---

## §4 Resolved open questions (forensics chosen — operator may override at REVIEW)

| Q | Resolution |
|---|-----------|
| Q1: Mentions in-row shape | `[{ userId: string, displayName: string, startOffset: int, endOffset: int }]` (objects). Bubble renders chips at exact text positions. Send path generates this from chip-tracking Map at send-time. **Backward compat:** if `mentions[i]` is a string, fall back to legacy treatment. |
| Q2: Card-tags shape | NEW column `card_tags jsonb NOT NULL DEFAULT '[]'`. Shape: `[{ savedCardId: string, cardPayload: CardPayload }]`. Cap: 5 entries per message. Each `cardPayload` is `trimCardPayload(card)` enforced. |
| Q3: Inline chip rendering | Option C from F-8: styled-inline `<Text>` children of `<TextInput>`. Confirmed iOS shows rounded; Android shows highlighted-not-rounded. iOS chip uses `borderRadius: 6` + `backgroundColor: #eb7825` + `color: white`; Android same minus borderRadius effect. |
| Q4: Atomic backspace | `onKeyPress` (hardware kbd path) + `onChangeText` diff-based fallback (Android soft kbd). Spec algorithm: track each chip's `[startOffset, endOffset]` in `useChatInputController` ref Map; on every change, compare lengths — if delta is `-1` AND deletion offset is within a chip's range, replace the entire chip range with empty string + remove `@`/`#` trigger immediately before it. Update tracking Map. |
| Q5: Notification collapse vs new_message | Partition recipients at the messagingService layer. For a message with mentions: mentioned users get `type='message_mention'`; non-mentioned users get `type='message'`. No user gets two pushes. Implemented as a single Promise.allSettled with two notify-message invocations (one per type) where the recipient lists are disjoint sets. |
| Q6: Title format for DM | When `conversations.type='direct' AND conversations.name IS NULL`, derive `ConversationName` from "the other participant's display_name". For multi-DM (>2 participants — rare), use `"your conversation"`. |
| Q7: Mention same user twice in one message | Dedup at send: `[...new Set(mentionedUserIds)]` before notify-message call. Receive: one push max per recipient per message (already enforced by `idempotencyKey: mention:${messageId}:${mentionedUserId}` — verified at `notify-message/index.ts:236`). |
| Q8: Max mentions per message | 10. Enforced in `useChatInputController` (refuse new selection past 10). |
| Q9: Max card-tags per message | 5. Enforced in `useChatInputController` (refuse new selection past 5). |
| Q10: Deleted profile mention render | When the renderer encounters a mention whose `userId` no longer resolves (profile soft-deleted or row missing), render the chip as `displayName` (snapshot from `mentions[i].displayName`). Do NOT show "@Deleted user". Constitution #9 ok because we have the snapshot. Tap is no-op (no profile sheet). |

---

## §5 Open questions — RESOLVED 2026-05-21 by operator

All four OQs answered + OQ-2 forensics-adopted. Binding for IMPLEMENT.

| ID | Resolution | Source |
|----|-----------|--------|
| OQ-1 | Title format = `{{ActorName}} mentioned you in "{{ConvName}}"` (conv name wrapped in straight double-quotes). ConvName fallbacks: `your chat` for unnamed direct (incl. 2-person), `your group chat` for unnamed group, `conv.name` otherwise. Examples: `Seth mentioned you in "Friday Plans"` / `Seth mentioned you in "your chat"`. Overrides forensics recommendation. | Operator (incl. 2026-05-21 minor correction adding the quotes) |
| OQ-2 | Picker EXCLUDES self. No self-mention. Forensics pre-adopted; operator did not override. | Forensics + operator silence |
| OQ-3 | Reuse existing per-conversation mute (`conversation_participants.notifications_muted`). No new UI, no new column. Mention handler patched to honor this flag (suppress push; in-app row still inserted). | Operator |
| OQ-4 | `#`-picker scope in session chats = **saved cards only** (`board_saved_cards WHERE session_id = X`). NO active-deck cards. Locked cards are a subset of saved, so included automatically. Rationale (operator-verbatim): "no use discussing a card that was not liked by >1 person." | Operator |

**Chip rendering approach (Investigation F-8) — RESOLVED:** Option C — styled-inline `<Text>` children of `<TextInput>`. iOS rounded pills; Android rectangular highlight (documented v1 partial-fidelity per SC-06-Android). No new dependencies. | Operator |

---

## §6 Layer-by-layer specifications

### §6.1 Database layer

**New migration:** `supabase/migrations/20260701000000_orch_0908_chat_card_tags.sql`

```sql
-- ORCH-0908 (bundled scope): add card_tags column to messages for #-tag chat feature.
-- Mirrors mentions column pattern. Default '[]' so existing rows + writes without tags work.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS card_tags jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.messages.card_tags IS
  'ORCH-0908: array of {savedCardId, cardPayload} objects for #-tagged cards. cardPayload built via trimCardPayload (ORCH-0667/0685 contract). Cap 5 per message enforced at app layer. Per-message embed; tap renders ExpandedCardModal via cardPayloadToExpandedCardData. NULL-tolerant render: missing cardPayload → chip falls back to title-only.';

-- No RLS change needed: messages.card_tags is per-row data, RLS already covers row access.

NOTIFY pgrst, 'reload schema';
```

**No shape migration for mentions** — handled at app layer with
backward-compat reader (strings AND objects).

### §6.2 Edge function layer

**Patch:** `supabase/functions/notify-message/index.ts`

1. Inside `handleUnifiedMention` (line 198+):
   - **BEFORE** the `dispatches = mentionedUserIds.map(...)` block, fetch
     mute state for ALL mentioned users in one query:
     ```ts
     const { data: muteRows } = await adminClient
       .from('conversation_participants')
       .select('user_id, notifications_muted')
       .eq('conversation_id', conversationId)
       .in('user_id', mentionedUserIds);
     const mutedSet = new Set((muteRows ?? []).filter(r => r.notifications_muted).map(r => r.user_id));
     ```
   - Filter `mentionedUserIds` to exclude muted: `const recipients =
     mentionedUserIds.filter(uid => !mutedSet.has(uid));` — dispatch only
     to recipients.
   - **In-app notification row is STILL INSERTED for muted users** (the
     existing `notify-dispatch` behaviour: in-app row always inserted, push
     gated by per-user pref). To honor this, for muted users dispatch
     with `pushOverrides: { suppressPush: true }` rather than skipping
     entirely. If notify-dispatch does not yet support
     `suppressPush`, add it (mirroring existing per-user mute checks
     elsewhere — verify at impl time).
2. Title format (per OQ-1 operator resolution 2026-05-21 — conv name wrapped in straight double-quotes):
   ```ts
   // OLD: title: `${senderName} mentioned you`,
   // NEW:
   const titleConvName =
     conv?.name && conv.name !== ''
       ? conv.name
       : conv?.type === 'group'
         ? 'your group chat'
         : 'your chat'; // covers unnamed 2-person AND multi DMs
   const title = `${senderName} mentioned you in "${titleConvName}"`;
   // Example outputs:
   //   Named group  : Seth mentioned you in "Friday Plans"
   //   Unnamed group: Seth mentioned you in "your group chat"
   //   Unnamed DM   : Seth mentioned you in "your chat"
   ```

**Deploy:** orchestrator runs `supabase functions deploy notify-message
--project-ref gqnoajqerqhnvulmnyvv` after operator confirms migration is on
remote.

### §6.3 Service layer

**Extend:** `app-mobile/src/services/messagingService.ts`

1. Extend `DirectMessage` interface:
   ```ts
   export interface MentionEntry {
     userId: string;
     displayName: string;
     startOffset: number;
     endOffset: number;
   }
   export interface CardTagEntry {
     savedCardId: string;
     cardPayload: CardPayload;
   }
   export interface DirectMessage {
     // ... existing fields ...
     mentions?: Array<MentionEntry | string>;  // backward-compat union
     card_tags?: CardTagEntry[];
   }
   ```

2. Extend `sendMessage` signature:
   ```ts
   async sendMessage(
     conversationId: string,
     senderId: string,
     content: string,
     messageType: 'text' | 'image' | 'video' | 'file' | 'card' = 'text',
     fileMetadata?: { ... },
     replyToId?: string | null,
     mentions?: MentionEntry[],     // NEW
     cardTags?: CardTagEntry[],     // NEW
   ): Promise<{ message: DirectMessage | null; error: any }>
   ```
   - On INSERT, persist `mentions` (default `[]`) + `card_tags` (default `[]`).
   - **Validation:** mentions.length ≤ 10; cardTags.length ≤ 5; each
     cardTag's `cardPayload` must have `id` + `title` (essentials); each
     mention must have `userId` + `displayName` + non-negative offsets.
     Reject (throw) on validation failure — service layer does not silently
     truncate.
   - **`trimCardPayload` enforcement:** for each cardTag entry, re-run
     `trimCardPayload(cardTag.cardPayload)` before persist to guarantee
     I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS.

3. Post-insert notification fan-out — replace `sendMessageNotifications`
   call with collapse-aware split:
   ```ts
   const mentionedSet = new Set((mentions ?? []).map(m => m.userId));
   const allRecipients = await fetchConversationParticipantsExcluding(senderId, conversationId);
   const mentionedRecipients = allRecipients.filter(uid => mentionedSet.has(uid));
   const regularRecipients = allRecipients.filter(uid => !mentionedSet.has(uid));

   if (mentionedRecipients.length > 0) {
     supabase.functions.invoke('notify-message', {
       body: {
         type: 'message_mention',
         senderId,
         conversationId,
         messageId: enrichedMessage.id,
         mentionedUserIds: mentionedRecipients,
         messagePreview: content.slice(0, 100),
       },
     }).catch(err => console.warn('[messagingService] message_mention fan-out failed', err));
   }
   if (regularRecipients.length > 0) {
     this.sendMessageNotifications(conversationId, senderId, enrichedMessage, regularRecipients).catch(...);
   }
   ```
   - Existing `sendMessageNotifications` (line 1150) currently does NOT
     accept an explicit recipient list; extend its signature to accept an
     optional `restrictToUserIds: string[]` filter.

### §6.4 Hook layer

**New:** `app-mobile/src/hooks/useConversationParticipants.ts`

```ts
export interface ChatParticipant {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
}

export function useConversationParticipants(conversationId: string | null) {
  return useQuery<ChatParticipant[]>({
    queryKey: chatKeys.participants(conversationId),
    enabled: !!conversationId,
    staleTime: 30_000,
    queryFn: async () => {
      if (!conversationId) return [];
      const { data, error } = await supabase
        .from('conversation_participants')
        .select('user_id, profiles!inner(id, display_name, username, avatar_url)')
        .eq('conversation_id', conversationId);
      if (error) throw error;
      return (data ?? []).map(r => ({
        userId: r.user_id,
        displayName: r.profiles.display_name ?? '',
        username: r.profiles.username,
        avatarUrl: r.profiles.avatar_url,
      }));
    },
  });
}
```

Query key factory addition: `chatKeys.participants(conversationId)` =
`['chat', 'participants', conversationId]`.

**New:** `app-mobile/src/hooks/useChatCardTagSource.ts`

```ts
export function useChatCardTagSource(args: {
  conversationType: 'direct' | 'group';
  sessionId: string | null;
  currentUserId: string;
}) {
  // For session chats, return session-saved + session-locked.
  // For DMs, return own saved.
  // Reuses useSavedSessionCards / useSavedCards under the hood.
}
```

**New:** `app-mobile/src/hooks/useChatInputController.ts`

The state machine for the input:

```ts
export interface ChipRange { type: '@' | '#'; refId: string; displayLabel: string; start: number; end: number; }

export function useChatInputController(args: {
  conversationId: string;
  conversationType: 'direct' | 'group';
  participants: ChatParticipant[];
  cardTagSource: SavedCard[];
}) {
  const [text, setText] = useState('');
  const [chipRanges, setChipRanges] = useState<ChipRange[]>([]);
  const [activePopover, setActivePopover] = useState<{type: '@' | '#', searchText: string, trigger Index: number} | null>(null);

  function onChangeText(next: string) {
    // 1. Diff prev vs next to detect chip-range modifications → atomic delete.
    // 2. Detect trailing @ or # → open popover with search text.
    // 3. Update chipRanges offsets if text inserted before existing chips.
  }

  function onKeyPress(e: NativeSyntheticEvent<TextInputKeyPressEventData>) {
    // If key === 'Backspace' AND cursor at chip range end → delete whole range + trigger char.
  }

  function onSelectMention(participant: ChatParticipant) {
    // Replace @search → @DisplayName chip token; add to chipRanges; close popover.
    // Refuse if chipRanges.filter(t === '@').length >= 10.
  }

  function onSelectCardTag(card: SavedCard) {
    // Replace #search → #Card Title chip token; add to chipRanges; close popover.
    // Refuse if chipRanges.filter(t === '#').length >= 5.
  }

  function serializeForSend(): {
    content: string;
    mentions: MentionEntry[];
    cardTags: CardTagEntry[];
  } {
    // Build mentions[] + cardTags[] arrays from chipRanges + cardTagSource.
  }

  return { text, chipRanges, activePopover, onChangeText, onKeyPress, onSelectMention, onSelectCardTag, serializeForSend, /* render helpers */ };
}
```

### §6.5 Component layer

**Modify:** `app-mobile/src/components/MessageInterface.tsx`

- Replace the bare `<TextInput value={newMessage} onChangeText={setNewMessage}>`
  at line 1521 with `<TextInput {...controller.textInputProps}>{controller.renderInputChildren()}</TextInput>`.
- Mount `<MentionPopover>` and `<CardTagPopover>` conditionally on
  `controller.activePopover`.
- `handleSendMessage` (line 472) calls `controller.serializeForSend()` and
  passes `mentions` + `cardTags` to the `onSendMessage` prop (which routes
  to `messagingService.sendMessage` via the existing service plumbing).
- `multiline={false}` → `multiline={true}` so multi-line drafts with
  chips work as expected.

**Modify:** `app-mobile/src/components/chat/MessageBubble.tsx`

- Replace `renderContentWithMentions` (line 56-105) with a structured
  renderer that consumes `message.mentions[]` + `message.card_tags[]`:

```tsx
function renderContent(message: MessageData, isMe: boolean, onMentionTap: (userId: string) => void, onCardTagTap: (payload: CardPayload) => void): React.ReactElement {
  const mentions = Array.isArray(message.mentions) ? message.mentions : [];
  const cardTags = Array.isArray(message.cardTags) ? message.cardTags : [];

  if (mentions.length === 0 && cardTags.length === 0) {
    return <Text style={...}>{message.content}</Text>;
  }

  // Build segments from mention offsets (object form) OR fall back to regex (legacy string form).
  // For each cardTag, append a CardChip block AFTER the text content.
  // ...
}
```

- Card-tag chip below text content uses `<ChatCardChip cardTag={t} variant={isMe ? 'sent' : 'received'} />`.

**New:** `app-mobile/src/components/chat/ChatInputChipsLayer.tsx`

Renders the styled-inline `<Text>` children for the TextInput. Each chip
range becomes a `<Text>` with `{backgroundColor: '#eb7825', color: '#fff',
borderRadius: 6, paddingHorizontal: 4, paddingVertical: 2}`. Surrounding
text becomes plain `<Text>` children. iOS shows rounded chips; Android
shows highlighted rectangles.

**New:** `app-mobile/src/components/chat/ChatCardChip.tsx`

Wraps `<CardPreview>` in `<Pressable onPress={onPress}>` that calls
`cardPayloadToExpandedCardData(cardTag.cardPayload)` and passes the result
to the existing `setExpandedCardFromChat` path.

### §6.6 Realtime

No new realtime channels. Existing `messages` table realtime (used by
`useMessages`) carries the new `mentions` + `card_tags` columns
automatically — Supabase realtime fires INSERT events with full row
payload. Renderer picks up new columns without a hook change.

---

## §7 Success Criteria

Each criterion is observable + testable + unambiguous. Per-surface gates
are split (iOS/Android) where platform behaviour differs.

| ID | Criterion | Layer | Verification |
|----|-----------|-------|--------------|
| SC-01 | New migration `20260701000000_orch_0908_chat_card_tags.sql` exists; column `messages.card_tags jsonb NOT NULL DEFAULT '[]'` present on remote post-push. | Schema | mcp execute_sql: `SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name='messages' AND column_name='card_tags'` returns `'[]'::jsonb` + `NO`. |
| SC-02 | `notify-message` deployed with patched `handleUnifiedMention`; respects `conversation_participants.notifications_muted`. | Edge fn | Source diff check + post-deploy: send a mention to a muted participant, assert NO push delivered, assert `user_notifications` row still inserted. |
| SC-03 | `notify-message` title format = `{{ActorName}} mentioned you in "{{ConvName}}"` (conv name wrapped in straight double-quotes) consistently across all conversation types. ConvName falls back to `your chat` for unnamed direct (incl. 2-person DMs) and `your group chat` for unnamed group. Per OQ-1 operator resolution + 2026-05-21 quote-wrap correction. | Edge fn | Send mention in 2-person DM + 3-person group + named group; inspect `user_notifications.title` row for each — assert literal double-quote chars wrap the conv name (e.g. `Seth mentioned you in "Friday Plans"`). |
| SC-04 | `messagingService.sendMessage` accepts + persists `mentions: MentionEntry[]` and `cardTags: CardTagEntry[]` (validation: max 10 mentions, max 5 card tags, trimCardPayload enforced). | Service | Unit test: send with 11 mentions → throws; send with 5 cardTags including travelTime field → trimmed out. |
| SC-05 | `messagingService.sendMessage` partitions recipients into mentioned (via `message_mention`) and regular (via `message`). No recipient gets two pushes. | Service + Edge | Send mention to subset of 3-person group, assert mentioned user gets ONE `board_message_mention` push, others get ONE `message_new` push, sender gets zero. |
| SC-06-iOS | `MessageInterface` TextInput on iOS sim: typing `@` opens MentionPopover scoped to conversation participants (excludes self); tapping a participant inserts an inline orange ROUNDED chip with white text; subsequent text appears after the chip. | UI iOS | Maestro flow on iPhone 17 sim; screenshot before/after. |
| SC-06-Android | Same as SC-06-iOS on Android emulator EXCEPT chip appears as a rectangular highlight (no rounded corners). | UI Android | Maestro flow on Android emu; screenshot. |
| SC-07-iOS | Backspace immediately after a chip deletes the entire chip + leading `@` atomically. iOS hardware keyboard via `onKeyPress`. | UI iOS | Maestro: pre-state with chip, press Backspace, assert text now ends 1 char before chip's start. |
| SC-07-Android | Same atomic delete on Android — works via `onChangeText` diff fallback when `onKeyPress` doesn't fire on Gboard. | UI Android | Maestro on Android emu. |
| SC-08 | Typing `#` opens CardTagPopover scoped: session chats show session-saved + locked cards; DMs show only own saved cards. | UI both | Maestro flows in each conversation type; verify card list source. |
| SC-09 | Selecting a card from CardTagPopover inserts an inline `#Card Title` chip in the input AND attaches a `CardTagEntry` (with trimmed cardPayload) to be sent. | UI both | Maestro select; assert chipRanges grows + serialized cardTags[] has one entry. |
| SC-10 | Bubble renders mention chips at correct offsets from structured `mentions[]` array (not regex). Backward-compat: legacy `mentions: [uuid]` rows still render via fallback regex. | UI both | Test 1: send a new mention, assert chip position matches mentions[0].startOffset. Test 2: insert legacy row directly via SQL, assert it still renders as a chip via regex fallback. |
| SC-11 | Bubble renders card-tag chips below content; tap opens ExpandedCardModal via cardPayloadToExpandedCardData. | UI both | Maestro: tap chip, assert modal opens with the correct card title + image. |
| SC-12 | Mention picker refuses to add an 11th mention; card-tag picker refuses to add a 6th. | Hook | Unit test on useChatInputController. |
| SC-13 | Mentioning a deleted/missing-profile user renders the chip with the snapshot displayName from mentions[i].displayName; tap is no-op (no profile sheet). | Render + cleanup-safety | Test: insert mention with non-existent userId, render — chip shows displayName, tap does nothing. |
| SC-14 | No regression in shared-card-bubble path (ORCH-0667 + ORCH-0908) — the explicit attach-button card share still works identically. | UI both | Maestro: share card via attach button, verify card bubble renders + tap opens modal. |
| SC-15 | `chatKeys.participants` query key in factory + cache invalidates when conversation_participants changes (new member added to session). | Cache | Add participant via session_participants insert, assert useConversationParticipants refetches within 5s. |

---

## §8 Invariants

**Preserved:**

| ID | How preserved |
|----|---------------|
| Constitution #2 (one owner per truth) | mentions + cardTags read from `messages` server-side via React Query; never cached in Zustand. |
| Constitution #3 (no silent failures) | `messagingService.sendMessage` throws on validation failure; `notify-message` failures logged via console.warn (existing pattern). |
| Constitution #9 (no fabricated data) | Deleted-user mention falls back to snapshot displayName; if no snapshot, render chip as `@unknown` (no false data). |
| I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS | `trimCardPayload` enforced on every cardTags entry at sendMessage. |
| ORCH-0908 flat-CardPayload contract | Card chip tap uses `cardPayloadToExpandedCardData` (post-ORCH-0908 legacy-tolerant version). |
| ORCH-0898 message_mention canonical | This work uses the existing `notify-message` `type='message_mention'` (does NOT introduce a parallel pathway). |

**NEW invariant established:**

- **I-PROPOSED-CHAT-MENTION-MUTE-RESPECTED** —
  `notify-message handleUnifiedMention` MUST check
  `conversation_participants.notifications_muted` before dispatching push.
  In-app notification row still inserted; only the push is suppressed.
  CI gate: grep `notify-message/index.ts` for `notifications_muted` inside
  the `handleUnifiedMention` function body.

---

## §9 Test Cases (forensics-suggested; tester writes adversarial)

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Happy path: send mention + card-tag | Group chat, type `@Seth `, pick from popover, type `#`, pick saved card, send | messages row has mentions=`[{userId, displayName, startOffset, endOffset}]` + card_tags=`[{savedCardId, cardPayload}]`; bubble renders chip + card chip; mentioned user gets `board_message_mention` push | Full stack |
| T-02 | Atomic backspace iOS hw kbd | Chip in input, press Backspace | Chip + `@` removed in one keystroke; remaining text + cursor pos correct | Component iOS |
| T-03 | Atomic backspace Android soft kbd | Chip in input on Android, Gboard backspace | Same atomic delete via onChangeText diff fallback | Component Android |
| T-04 | Mention non-participant | Picker filters to participants only; manual typing `@RandomUser` is NOT included in mentions[] on send | mentions[] empty; no push fired | Service + UI |
| T-05 | Mute toggle | User A toggles `conversation_participants.notifications_muted=true`; User B mentions A | A gets NO push; in-app notification row still inserted | Edge fn |
| T-06 | Collapse: mention subset of recipients | 3-person group, mention 1 user | Mentioned user gets `message_mention` only; non-mentioned 1 user gets `message` only; sender 0 | Service + Edge fn |
| T-07 | Self-mention | Picker excludes self; manual `@<self>` typing doesn't appear in popover | Self never in mentions[] | UI |
| T-08 | Limit enforcement | Try to add 11th mention via picker | Picker refuses; toast/feedback | Hook |
| T-09 | Card-tag from DM scope | DM with friend; `#` shows ONLY current user's saved_card rows | Picker source = saved_card.profile_id = current | Hook |
| T-10 | Card-tag from session scope | Session chat; `#` shows session_saved + session_locked | Picker source = board_saved_cards WHERE session_id = current | Hook |
| T-11 | Bubble render with legacy `mentions: [uuid]` | Direct SQL insert with old shape | Chip still renders via regex fallback | Component |
| T-12 | Card chip tap → ExpandedCardModal | Tap card chip in bubble | Modal opens with cardPayload data, NO additional fetch | Component + Adapter |
| T-13 | Send shared-card via attach button (regression) | Original ORCH-0667 flow unchanged | Shared-card bubble works identically | Regression |
| T-14 | Deleted-profile mention | Insert mention with userId of deleted profile | Chip shows snapshot displayName; tap is no-op | Render |
| T-15 | trimCardPayload enforcement | Send cardTag with travelTime + distance fields | Persisted card_payload has neither (I-CHAT-... enforced) | Service |

---

## §10 Implementation Order

1. **Migration first.** Write + operator-push `20260701000000_orch_0908_chat_card_tags.sql`.
2. **Edge function patch.** Update `notify-message/index.ts handleUnifiedMention`. Orchestrator deploys after migration confirmed.
3. **Service layer.** Extend `messagingService.ts` (interfaces, sendMessage signature, validation, collapse-aware notification fan-out).
4. **Hooks.** Add `useConversationParticipants`, `useChatCardTagSource`, `useChatInputController`. Add `chatKeys.participants` factory entry.
5. **Bubble render.** Upgrade `MessageBubble.tsx` to structured mention + card-tag rendering with regex fallback.
6. **New components.** `ChatInputChipsLayer.tsx`, `ChatCardChip.tsx`.
7. **MessageInterface integration.** Replace bare TextInput with controller-driven input; mount popovers; wire sendMessage.
8. **Regression test.** Implementor's happy-path test + fails-on-revert verification.
9. **Implementor report + handoff to TEST.**

---

## §11 Regression Prevention

- **Append-only regression tests** (per ORCH-0840) — implementor's
  happy-path covers T-01; fails-on-revert demonstrated by reverting the
  sendMessage mentions parameter or the schema column.
- **Tester's adversarial test angles** (forensics suggests; tester writes):
  T-02 (atomic backspace iOS), T-03 (Android fallback), T-05 (mute
  enforcement), T-08 (limit refusal), T-14 (deleted profile safety).
- **CI gate for I-PROPOSED-CHAT-MENTION-MUTE-RESPECTED** — add to
  `.github/workflows/strict-grep-mingla.yml` (or the existing
  strict-grep workflow): assert `notifications_muted` appears in
  `supabase/functions/notify-message/index.ts` inside the
  `handleUnifiedMention` function definition. One-line shell check.

---

## §12 CLOSE notes

This spec ships as part of the ORCH-0908 PR. CLOSE banner must cite:
- Lock-and-schedule fix (the parent ORCH-0908 work)
- Card-payload flatten (migration `20260630000000`)
- Chat @-mention + #-tag (THIS spec)

Single PR title: `Close ORCH-0908: Collab lifecycle lock+schedule+recycle + chat @-mention + #-tag cards`

Cumulative regression suite for the PR:
- `app-mobile/scripts/ci/orch-0908-combined-regression-check.mjs` (existing)
- `app-mobile/scripts/ci/orch-0908-card-render-parity-check.mjs` (existing)
- NEW: `app-mobile/scripts/ci/orch-0908-chat-mention-card-tag-check.mjs` (implementor writes)

Decommissioning extension trigger: NO — this work adds; it does not
deprecate any column, table, RPC, or feature.

---

## §13 Discoveries for orchestrator (carry forward to CLOSE)

1. `BoardDiscussionTab` (the per-card discussion legacy surface) has its
   own @-mention + #-card-tag working UI. This SPEC explicitly does NOT
   touch it (no regression risk by isolating to `MessageInterface`).
   Recommendation: open a follow-up ORCH `ORCH-XXXX [Retire
   BoardDiscussionTab once unified chat covers its surface area]` after
   ORCH-0908 closes.
2. `MessageBubble` regex-based mention render today works coincidentally —
   structured upgrade addressed in this spec.
3. ORCH-0898 SPEC §3.1 Step 2 promised `messages.mentions` for
   mention-driven push notifications. This work fulfills that promise on
   the unified chat surface (the OG SPEC delivered the column + edge
   function but not the input UI in the unified component).
