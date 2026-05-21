# INVESTIGATION — ORCH-0908 (bundled scope: chat @-mention + #-tag cards)

**Sub-scope label:** Chat @-mention users + #-tag cards
**Bundle parent:** ORCH-0908 [Collab session lifecycle: Lock-In → Schedule → V_{n+1} Recycle]
**Dispatch source:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0908_CHAT_MENTION_AND_CARD_TAG.md`
**Skill:** Claude `mingla-forensics` (INVESTIGATE mode)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Date:** 2026-05-21
**Confidence:** High (proven on Code + Schema layers; Runtime/Data verified via mcp execute_sql earlier this session for the live `messages` table; Docs cross-checked against ORCH-0898 SPEC).

---

## Layman summary

Mingla already shipped 80% of what's needed to support `@` mentions and `#`
card-tags in the unified chat — the database column (`messages.mentions
jsonb`), the push-notification pipeline (`notify-message` with type
`message_mention`), and the visual chip render component (`MentionChip`) all
exist from ORCH-0898 [Consumer collab session → Friends-tab group chat]. The
legacy `BoardDiscussionTab` (the older per-session board discussion, separate
from today's unified chat) even has a working @-mention popover +
#-card-tag popover wired end-to-end. The gap is that the **unified chat
screen the operator actually uses (`MessageInterface.tsx`) has none of this
plumbing** — its TextInput is plain, sendMessage doesn't pass `mentions`, and
the bubble's regex-based render reads `@Name` text patterns rather than the
structured `mentions[]` array. We also have ONE genuinely hard technical
question: React Native `<TextInput>` cannot host inline `<View>` chips inside
editable text, so the operator-requested "render as a chip, not a slug" in
the INPUT is constrained — the workable path is styled-inline-`<Text>`
children of TextInput (orange background, white text, rounded look),
NOT a true View-based chip.

---

## Symptom Summary

- **Expected behaviour (per operator brief 2026-05-21):**
  1. Typing `@` in any chat (collab session OR friends DM) opens an inline
     autocomplete picker scoped to that conversation's participants.
     Selecting a user inserts a **rendered chip** (visual pill — not raw
     text) inline in the input. Backspace on the chip deletes the chip + its
     `@` trigger atomically.
  2. Typing `#` in a session chat opens a card picker scoped to the
     session's deck + saved + locked cards; in a DM, scoped to the user's own
     saved cards. Selecting a card inserts an inline card chip (thumb +
     title). Tapping the chip on the receiving side opens
     `ExpandedCardModal` via the ORCH-0667 / ORCH-0908 CardPayload path.
  3. @-mentioning a user fires a separate push notification with title
     `"{{ActorName}} mentioned you"` (per-user-mutable).
  4. Mention chip + card chip render with full visual fidelity in both the
     input and the bubble.

- **Actual behaviour today:**
  1. Chat input (`MessageInterface.tsx:1521`) has no `@` or `#` detection.
     Typing `@Seth` just stores raw text. The send path
     (`messagingService.sendMessage`) passes only `(conversationId,
     senderId, content, messageType, ...)` — no mentions array, no card
     tags.
  2. The bubble (`MessageBubble.tsx:50-105`) regex-parses `@\w+` and
     renders `MentionChip` for visual chip-look, but this is text-based
     pattern matching — does not use the structured `messages.mentions
     jsonb` column that ORCH-0898 added. Tapping the chip does nothing
     (no `onPress` wired; line 82-88 instantiates `MentionChip` without
     handlers).
  3. No `#` detection or card picker in the unified chat. Card-share
     today is via an explicit attachment button → `showSavedCardPicker`
     (`MessageInterface.tsx:1570+`), not inline `#`.
  4. `notify-message` with type `message_mention` is DEPLOYED and works
     (`supabase/functions/notify-message/index.ts:195-245`), but
     MessageInterface never calls it because mentions are never extracted.

- **Reproduction:** any chat conversation today (DM or session). Type
  `@anything` in the input, send. The bubble shows the text as a chip-styled
  span (via regex), but no notification fires, no participant lookup occurs,
  and tapping the chip does nothing.

- **When it started:** never built for the unified chat. Predecessor
  (`BoardDiscussionTab`) shipped the pattern for the per-card discussion
  surface but was never ported to `MessageInterface`.

---

## Investigation Manifest

| # | File | Layer | Why read |
|---|------|-------|----------|
| 1 | `app-mobile/src/components/MessageInterface.tsx` | Component | The unified chat screen — TextInput owner + sendMessage caller |
| 2 | `app-mobile/src/components/chat/MessageBubble.tsx` | Component | Per-message render — where chips + card-tags display in bubbles |
| 3 | `app-mobile/src/services/messagingService.ts` | Service | sendMessage path + CardPayload + notification dispatch |
| 4 | `app-mobile/src/services/cardPayloadAdapter.ts` | Service | CardPayload → ExpandedCardData converter (card-chip tap reuses) |
| 5 | `app-mobile/src/hooks/useMessages.ts` | Hook | Server-state query for chat messages |
| 6 | `app-mobile/src/hooks/useSessionDiscussion.ts` | Hook | Session-specific chat hook |
| 7 | `app-mobile/src/services/connectionsService.ts` | Service | DM thread shape |
| 8 | `supabase/migrations/20260624000000_orch_0898_unified_chat_substrate.sql` | Schema | `messages.mentions jsonb` + `conversation_participants` |
| 9 | `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` | Schema | Baseline `messages` + `conversations` shapes |
| 10 | `supabase/functions/notify-message/index.ts` | Edge function | `message_mention` handler — already deployed |
| 11 | `supabase/functions/notify-dispatch/index.ts` | Edge function | Downstream dispatcher used by notify-message |
| 12 | `app-mobile/src/components/board/BoardDiscussionTab.tsx` | Component | LEGACY predecessor with working @-mention + #-card-tag UI |
| 13 | `app-mobile/src/components/board/MentionPopover.tsx` | Component | Existing participant picker — reusable |
| 14 | `app-mobile/src/components/board/CardTagPopover.tsx` | Component | Existing card picker — reusable |
| 15 | `app-mobile/src/components/chat/MentionChip.tsx` | Component | Visual chip — reusable in both input + bubble |
| 16 | `app-mobile/src/components/chat/CardPreview.tsx` | Component | Card chip render — reusable |
| 17 | `app-mobile/src/services/boardMessageService.ts` | Service | LEGACY sendBoardMessage(mentions: string[]) signature |
| 18 | `Mingla_Artifacts/specs/SPEC_ORCH-0898_COLLAB_GROUP_CHAT.md` | Spec | What ORCH-0898 promised + delivered |
| 19 | `app-mobile/src/components/chat/CardPreview.tsx` | Component | Existing card-inline render pattern |
| 20 | `supabase/functions/_shared/push-translations.ts` | Edge function | `board_message_mention` push title/body templates |

Phase 0 confirmed: prior reports for ORCH-0898 read at
`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0898_COLLAB_GROUP_CHAT.md` +
`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0898_COLLAB_GROUP_CHAT.md`
(both confirm mentions column shipped, unified-chat substrate is canonical
for both DMs + collab session chats).

---

## Required Findings (per dispatch — 10 items)

### F-1. Chat input component — what owns the TextInput? Any inline-token detection today? Mention libraries in package.json?

- **Owner:** `app-mobile/src/components/MessageInterface.tsx:1521` — the
  `<TextInput ref={inputRef}>` mounted inside the input capsule. Used by
  BOTH session group chats AND DMs (ORCH-0898 unified both paths).
- **Inline-token detection:** NONE. The `onChangeText` at line 1524 only
  calls `setNewMessage(text)` + `startTyping()` / `stopTyping()`. No `@`,
  no `#`, no autocomplete, no popover mount.
- **`multiline={false}` + `maxLength={1000}`** (line 1538-1539). Operator
  intent for mentions across multi-line input may require `multiline={true}`
  — flag for spec.
- **Mention libraries:**
  ```bash
  grep mention app-mobile/package.json  # (no results)
  ```
  None installed. No `react-native-controlled-mentions`, no
  `react-native-mentions`, no draft.js, no Slate, no TipTap. Zero.

**Verdict:** PARTIAL — TextInput exists but is plain. No library to lean on.

### F-2. Existing chip-render patterns to reuse

- **`MentionChip` (`app-mobile/src/components/chat/MentionChip.tsx:17-42`)** —
  solid orange pill (#eb7825 bg, white text), variants `sent` / `received`,
  accepts `onPress`. **Reusable as-is for both input + bubble.**
- **`CardPreview` (`app-mobile/src/components/chat/CardPreview.tsx`)** —
  97-line inline card render with image + title + category. Used by
  `BoardDiscussionTab` for `#`-tagged cards in messages. **Reusable for the
  card-chip render.**
- **`MentionPopover` (`app-mobile/src/components/board/MentionPopover.tsx`,
  188 lines)** — vertical participant list with search filter, avatar +
  display name, onSelect callback returning user_id. **Reusable for the
  unified-chat picker — needs adaptation to accept a different participant
  source (conversation_participants instead of session participants).**
- **`CardTagPopover` (`app-mobile/src/components/board/CardTagPopover.tsx`,
  220 lines)** — card list with search, thumb + title, onSelect callback.
  **Reusable — same adaptation: needs to accept different card pools (session
  cards vs own saved cards) based on conversation type.**

**Verdict:** BUILT — all four reusable components exist and are battle-tested
in `BoardDiscussionTab`.

### F-3. Conversation participants — canonical query

Two distinct queries depending on conversation type:

**(a) Collab session chat (`conversations.linked_entity_type = 'session'`):**
```sql
SELECT p.user_id, pr.display_name, pr.username, pr.avatar_url
FROM public.session_participants p
JOIN public.profiles pr ON pr.id = p.user_id
WHERE p.session_id = <conversations.session_id>
  AND p.has_accepted = true
  AND p.user_id != <current_user_id>;
```
Source: `BoardDiscussionTab.tsx:60` accepts `participants: Participant[]`
prop pre-fetched by the parent. Migration
`20260624000000_orch_0898_unified_chat_substrate.sql:190-225` confirms
`conversation_participants` is mirrored from `session_participants` via
trigger — so we could also query `conversation_participants` directly.

**(b) DM chat (`conversations.type = 'direct'`):**
```sql
SELECT cp.user_id, pr.display_name, pr.username, pr.avatar_url
FROM public.conversation_participants cp
JOIN public.profiles pr ON pr.id = cp.user_id
WHERE cp.conversation_id = <conversations.id>
  AND cp.user_id != <current_user_id>;
```
RLS on `conversation_participants` (ORCH-0898 migration step 6, line
306+) restricts SELECT to rows where the requester is a participant of
that conversation — gate is built in.

**Recommendation for spec:** ONE query — always query
`conversation_participants` directly. The trigger keeps it in sync with
`session_participants` for session chats, and it's the only valid source
for DMs. Single code path. ORCH-0898 already guarantees the trigger.

**Verdict:** BUILT (schema + RLS); query path needs to be written in a new
hook.

### F-4. Card-pool queries for `#`-tag

**For session chats (operator decision D-2 part 1: session-scoped):**
Three sub-pools (deck + saved + locked). Pragmatically the operator's
useful set is **saved + locked** — the live deck is mid-swipe and inserting
a card-tag for a card the recipient hasn't seen yet is confusing. Open
question for operator/spec; recommendation below.

- **Saved cards in session:** existing
  `useSavedSessionCards(sessionId)` hook (verify in
  `app-mobile/src/hooks/useSavedCards.ts` siblings — `BoardDiscussionTab`
  receives `savedCards: SavedCard[]` as prop, pre-fetched by parent).
- **Locked cards in session:** subset of saved where `is_locked = true`
  (`board_saved_cards.is_locked = true AND session_id = X`). Already
  surfaced in ORCH-0908 work.
- **Active deck cards:** out of scope recommendation — too volatile,
  user-relative (each participant sees a different deck position).

**For DM chats (operator decision D-2 part 2: own saved cards only):**
```sql
SELECT * FROM public.saved_card
WHERE profile_id = auth.uid()
ORDER BY created_at DESC LIMIT 100;
```
Existing `useSavedCards()` hook (`app-mobile/src/hooks/useSavedCards.ts`).
RLS already restricts to `profile_id = auth.uid()`. Single query.

**Verdict:** BUILT (hooks exist); the picker needs to switch source based
on `conversations.type`.

### F-5. Message schema — where do mentions + card-tags live?

**Mentions:** ALREADY HAS A COLUMN.
- `messages.mentions jsonb NOT NULL DEFAULT '[]'::jsonb` shipped by
  migration `20260624000000_orch_0898_unified_chat_substrate.sql:107`.
- Shape currently used (per ORCH-0898 SPEC §3.1 Step 2 + the legacy
  `board_messages.mentions` predecessor): `[user_uuid, user_uuid, ...]` —
  a flat jsonb array of user UUIDs. No position offsets, no display name
  snapshot.
- Live DB verified via `mcp__supabase__execute_sql` earlier this session:
  column present, default `'[]'::jsonb`, NOT NULL.

**Card-tags:** NO COLUMN EXISTS. Three candidates:
- **(a) New column `messages.card_tags jsonb NOT NULL DEFAULT '[]'`** with
  shape `[{savedCardId, cardPayload}, ...]`. Mirrors `mentions` pattern.
  Adds one column.
- **(b) Reuse `card_payload jsonb` (currently single-card-share-only)** by
  extending it to support arrays. **REJECTED** — breaks ORCH-0667 +
  ORCH-0908 contract that `card_payload` is a single CardPayload object.
- **(c) Inline marker tokens in `content` text** (e.g., `[[card:UUID]]`)
  parsed by renderer. **REJECTED** — fragile, no foreign-key integrity, no
  way to embed full CardPayload, breaks if content is edited.

**Recommendation:** **(a) NEW column `card_tags jsonb`** with shape per
card-tag entry: `{ savedCardId: uuid, cardPayload: CardPayload }`. RLS on
`messages` already covers it (no per-column policy needed; row-level access
unchanged). NOT NULL DEFAULT `'[]'` so existing rows + new rows without
tags work uniformly.

**Mention shape upgrade (RECOMMENDED for spec):** keep `messages.mentions`
column but **extend the in-row shape** from `[user_uuid]` to
`[{ userId, displayName, startOffset, endOffset }]` so the bubble renderer
can render chips at exact text positions instead of regex-guessing. This
is a BACKWARD-COMPATIBLE shape upgrade — any code reading
`mentions.map(m => typeof m === 'string' ? m : m.userId)` handles both
shapes. No migration needed; per-row evolution.

**Verdict:** Mentions BUILT, shape upgrade RECOMMENDED. Card-tags column
NET-NEW (single ADD COLUMN in new migration).

### F-6. Notification dispatch — `notify-dispatch` + `notify-message` payload

**`notify-message` already handles `message_mention`** (file:
`supabase/functions/notify-message/index.ts:195-245`). Request shape:
```ts
{
  type: 'message_mention',
  senderId: string,
  conversationId: string,
  messageId: string,
  mentionedUserIds: string[],
  messagePreview?: string,
}
```
Handler fans out one `notify-dispatch` call per mentioned user with:
```ts
{
  type: 'board_message_mention',
  title: `${senderName} mentioned you`,
  body: `in "${convName}": ${preview.slice(0,100)}`,
  data: { deepLink: 'mingla://chat/<id>?type=group&messageId=<msgid>' },
  idempotencyKey: `mention:${messageId}:${mentionedUserId}`,
  pushOverrides: { androidChannelId: 'messages' },
}
```
- Title format per operator D-3: `"{{ActorName}} mentioned you in
  {{ConversationName}}"` — current code produces `"X mentioned you"` and
  the convName is in the BODY. Spec must either accept this or amend
  notify-message to put convName in title.
- **Per-user mute:** `conversation_participants.notifications_muted boolean`
  (migration 20260624000000 step 3, line 116). Today this is checked by
  notify-message for `type='message'`. **The `message_mention` handler at
  lines 195-245 does NOT check the mute flag** — meaning today, a muted
  participant who gets mentioned would still receive the mention push.
  Confirm in spec whether this is desired (operator D-3 says "per-user
  mute control" — so yes, the handler must be patched to check
  conversation_participants.notifications_muted).
- **Collapse / dedup with `new_message` push:** today, when sendMessage
  fires, MessageInterface calls `notify-message` with `type='message'`
  which fans out a push to all non-muted participants. If the same message
  also has mentions, a separate `notify-message` call with
  `type='message_mention'` would deliver a SECOND push to mentioned users.
  Operator D-3 recommendation: "mention overrides regular per-message
  dedup so the user never gets two pushes for the same message." Spec must
  define: either (a) send mention notification INSTEAD of regular when a
  user is both a recipient and mentioned, or (b) suppress regular for
  mentioned users at the dispatch layer. Recommendation: **(a)** — at the
  service layer, partition recipients into mentioned + non-mentioned;
  mentioned get `message_mention`, others get `message`.

**Per-user mute UI:** the toggle for `conversations.notifications_muted`
lives in `app-mobile/src/components/connections/ConversationSettingsScreen.tsx`
(verify in spec). For ADD `chat_mention` mute toggle: either (i) reuse the
existing conversation-level mute (a muted conversation suppresses both
regular + mention pushes — simpler, may be too coarse), or (ii) add
per-mention-type toggle to user-preferences. Operator D-3 says "per-user
mute" — interpret as conversation-level (existing) is sufficient if mentions
respect it. Recommendation: spec patches `message_mention` handler to
respect `conversation_participants.notifications_muted` (the existing
toggle); no new prefs UI needed.

**Verdict:** BUILT (handler + push templates + idempotency); needs (a)
title-format alignment per D-3, (b) mute-flag check in the handler, (c)
collapse logic at messagingService.

### F-7. Card chip → ExpandedCardModal render parity

- `cardPayloadToExpandedCardData` at
  `app-mobile/src/services/cardPayloadAdapter.ts:22+` is the canonical
  converter (post-ORCH-0908 legacy-tolerant version).
- Current call site:
  `MessageInterface.tsx:1219` — when the shared-card bubble (the
  attach-button card share) is tapped:
  ```ts
  setExpandedCardFromChat(cardPayloadToExpandedCardData(payload));
  ```
- **For #-tag card chips:** spec must wire the chip's `onPress` to the
  SAME `setExpandedCardFromChat(cardPayloadToExpandedCardData(card_payload))`
  call. Each entry in `messages.card_tags[]` carries the full
  `cardPayload` so the modal opens without an extra fetch (matches the
  ORCH-0908 flat-CardPayload contract).
- **Constraint:** the `card_tags[i].cardPayload` MUST be built via the
  same `trimCardPayload(card)` function used by sendCardMessage
  (`messagingService.ts:863`) so the <5KB-per-card budget is honored
  cumulatively. Spec must define a cumulative budget for card_tags (e.g.
  max 5 card tags × 5KB = 25KB per message — already under PostgreSQL's
  jsonb practical limits).

**Verdict:** BUILT (adapter is reusable). Spec must enforce trimCardPayload
on insert + max-5 cap.

### F-8. Inline-chip-in-TextInput technical challenge (HIGHEST RISK)

**RN `<TextInput>` does NOT support inline `<View>` elements as children.**
The only children TextInput accepts are `<Text>` (and nested `<Text>`).
This is a hard React Native limitation, not a Mingla constraint.

**Three options + verdict:**

- **(A) Third-party library.** Candidates:
  - `react-native-controlled-mentions` (last meaningful update 2023, RN
    0.72+ compat unverified for Expo SDK 54 / RN 0.76). NOT in
    package.json.
  - `@flyerhq/react-native-chat-ui` (full chat UI — overkill, would
    replace MessageInterface). NOT in package.json.
  - `react-native-mentions` (abandoned 2020). Reject.
  - Verdict: a library install adds risk + maintenance burden. The closest
    fit (`controlled-mentions`) is half-maintained. **Not recommended
    without an explicit operator decision to accept the dependency.**

- **(B) Custom component replacing TextInput.** Build a `Pressable` +
  `Text` overlay that mimics editable text + intercepts every keystroke.
  Heavy lift (>2 weeks), error-prone, breaks IME/autocorrect/dictation/
  hardware-keyboard. **Reject for this scope.**

- **(C) Styled-inline-`<Text>` children of TextInput.** RN TextInput
  accepts `<Text>` children with per-substring styles:
  ```jsx
  <TextInput value={undefined}>
    <Text>Hey </Text>
    <Text style={{ backgroundColor: '#eb7825', color: 'white', borderRadius: 4 }}>
      @Seth
    </Text>
    <Text> what do you think</Text>
  </TextInput>
  ```
  **iOS:** works — chip-look text renders with the orange background.
  **Android:** PARTIAL — Android's TextInput child-Text style support is
  flaky for `borderRadius` (no rounded corners on the highlighted span on
  some Android versions), but `backgroundColor` + `color` work
  consistently. The chip will look like a rectangular orange highlight on
  Android, rounded pill on iOS. Acceptable as a v1 — operator can decide
  whether to budget a library install for perfect parity.
  **Atomic backspace:** combine with `onKeyPress={({ nativeEvent: { key } })
  => ...}` — when `key === 'Backspace'` AND cursor is immediately after a
  mention span, delete the whole `@Name ` token. Caveat: Android soft
  keyboards do NOT reliably fire `onKeyPress` for backspace (Gboard /
  SwiftKey strip the event). Workaround: detect deletion via diffing
  successive `onChangeText` values — if the previous chip range is now
  partial, remove the rest. Documented in spec.

**Recommendation: (C) — styled-inline-`<Text>` children + diff-based
backspace.** Honors operator D-4 visually ("render as a chip not a slug" —
chip = styled span with orange bg + white text + rounded on iOS).
Documents the Android `borderRadius` partial-fidelity as a known v1
trade-off with a forward path (library option later).

**Verdict:** NOT-BUILT, single feasible RN-native path identified.

### F-9. Backspace-deletes-whole-chip behavior

Per F-8, two-pronged approach:
1. **iOS + Android hardware keyboard:** `onKeyPress` fires reliably for
   Backspace. Handler checks cursor position via `onSelectionChange`; if
   the cursor sits immediately after a tracked chip range, prevent default
   single-char delete + replace the chip range + trigger char with empty
   string. Re-emit `onChangeText`.
2. **Android soft keyboard fallback:** diff `prev` and `next` text in
   `onChangeText`. If a tracked chip range was partially modified (any
   character deleted from inside the chip's range), treat as "chip
   deleted" and remove the rest of the chip range + the leading `@`.
   Update `pendingMentions` Map accordingly.

Spec must specify the diff algorithm precisely (compare lengths,
identify deletion offset, find which chip range contains it). Tester
will write adversarial tests: delete from middle of chip, paste over
chip, autocorrect-replaces-chip, etc.

**Verdict:** NOT-BUILT; clear mechanism documented for spec.

### F-10. Five-truth-layer cross-check

| Layer | Finding |
|-------|---------|
| **Docs** | ORCH-0898 SPEC §3.1 Step 2 promised `messages.mentions jsonb` for "mention-driven push notifications fan out via notify-message type=message_mention" — delivered. Did NOT spec UI input chip pickers in MessageInterface (those were in `BoardDiscussionTab`, which ORCH-0898 was intended to replace but did not migrate the input UX). |
| **Schema** | Migration 20260624000000 lines 107-110 confirms column exists, NOT NULL DEFAULT `'[]'::jsonb`. Live DB verified via `mcp__supabase__execute_sql` earlier this session: 0 errors on `SELECT mentions FROM messages LIMIT 1`. |
| **Code** | MessageInterface input has zero `@` or `#` detection. sendMessage at `messagingService.ts:718-815` does not accept or forward a mentions array. notify-message dispatcher at `messagingService.ts:1150-1200` only sends `type='message'`. The `message_mention` type at the edge function is reachable but never called from the unified chat. |
| **Runtime** | Confirmed earlier this session by direct query: recent `messages` rows have `mentions: []` for every row written via MessageInterface today. Zero rows in the last 30 days have non-empty `mentions[]` — meaning the column is shipped but unused since ORCH-0898 close. |
| **Data** | Confirmed: 0 messages with `mentions != '[]'::jsonb`. The notification table likewise has 0 rows of type `board_message_mention` from `messages` (not `board_messages`) origin. |

**Contradictions:** none — all five layers agree the column is shipped +
unused. This is a "build-the-UI" task, not a "fix-broken-behavior" task.

---

## Findings classification

| ID | Finding | Class |
|----|---------|-------|
| F-1 | MessageInterface TextInput has zero mention/tag plumbing | 🟠 Contributing Factor (gap) |
| F-2 | MentionChip, MentionPopover, CardTagPopover, CardPreview already exist | 🔵 Observation (reusable) |
| F-3 | conversation_participants is the canonical participant source for both DM + session chats | 🔵 Observation |
| F-4 | useSavedCards / useSavedSessionCards exist; new card-tag query reuses | 🔵 Observation |
| F-5 | `messages.mentions jsonb` shipped; `card_tags` is net-new column | 🟠 Contributing Factor (one missing column) |
| F-6 | notify-message `message_mention` handler exists but ignores mute flag + lacks collapse logic vs `type='message'` | 🟡 Hidden Flaw — must be addressed in this work or muted users will get unsolicited mention pushes |
| F-7 | cardPayloadToExpandedCardData is reusable; need trimCardPayload + 5-tag cap | 🔵 Observation |
| F-8 | RN TextInput cannot host View chips; styled-inline-Text is the only RN-native path | 🟠 Contributing Factor (technical constraint) |
| F-9 | Atomic backspace needs onKeyPress + onChangeText diffing for Android soft-kbd fallback | 🟠 Contributing Factor (RN platform quirk) |
| F-10 | Five layers agree: substrate shipped, UI unused since ORCH-0898 | 🔵 Observation |
| F-11 | MessageBubble's current regex-based mention render does not use structured `mentions[]` — works coincidentally for `@Name` text in content, fails for any other mention encoding | 🟡 Hidden Flaw — upgrade render to read structured `mentions[]` array (positions + display name snapshot) |

No 🔴 Root Causes in this investigation — the work is greenfield-on-substrate, not a broken-state diagnosis.

---

## Blast Radius

- **Unified chat (MessageInterface):** target surface. Both DM + session
  variants share this component → fix once, both paths covered.
- **`BoardDiscussionTab`:** legacy per-card discussion — separate component,
  has its own working @/# UI, no regression risk from this work UNLESS we
  share `MentionPopover` / `CardTagPopover` components and break their
  external API. Spec must preserve current signatures or version the props.
- **MessageBubble:** render path changes affect EVERY chat message ever
  shown. Spec must guarantee the upgraded mention/card-tag render is
  backward-compatible with all existing rows (mentions: [] / no card_tags /
  legacy `@Name` text in content).
- **notify-message:** edge function changes affect every chat push
  notification — `type='message'` AND `type='message_mention'`. Tester
  must verify mute-flag respected + dedup correct on both paths.
- **Notifications feed UI:** `app-mobile/src/components/NotificationsModal.tsx:84`
  already maps `board_message_mention` → at-outline icon (#eb7825). No
  change needed.
- **Backward compatibility:** all `messages` rows pre-this-work have
  `mentions: []` + no `card_tags` column. Renderer must default-handle
  both. New column added with `DEFAULT '[]'` so historical rows behave
  uniformly.

---

## Invariant Violations + Constitutional Risks

- **Constitution #3 (no silent failures):** if `notify-message` fails to
  dispatch a `message_mention`, the mentioned user gets no push but the
  sender thinks "they were notified." Spec must require structured
  console.warn + retry path (`notify-message` already has Promise.allSettled
  — works).
- **Constitution #9 (no fabricated data):** if a mentioned user's profile
  is deleted between message-send and render, the bubble must NOT show
  `@Deleted User` as a chip — either suppress the chip + fall back to
  raw `@username` text, or show a greyed `@Unknown` chip with no tap.
  Spec must specify.
- **Constitution #2 (one owner per truth):** mention data lives in
  `messages.mentions` (server) — must NOT be cached separately in
  Zustand. React Query is the cache. Per CLAUDE memory rule.
- **I-CHAT-CARDPAYLOAD-NO-RECIPIENT-RELATIVE-FIELDS (CI-gated, post-ORCH-0685):**
  `card_tags[i].cardPayload` MUST be built via `trimCardPayload()` which
  enforces NO `travelTime / distance` fields (recipient-relative — would
  fabricate). Spec must explicitly reference this invariant.
- **NEW invariant proposed for ORCH-0908 close:** `I-PROPOSED-CHAT-MENTION-MUTE-RESPECTED`
  — `notify-message message_mention` handler MUST check
  `conversation_participants.notifications_muted` before dispatching.
  CI-enforceable: grep `notify-message/index.ts` for "notifications_muted"
  in the `handleUnifiedMention` body.

---

## Fix Strategy (direction only — spec writes the contract)

1. **Add `messages.card_tags jsonb NOT NULL DEFAULT '[]'`** in a new
   migration prefix `20260701000000` (monotonic — current head is
   `20260630000000`).
2. **Upgrade `messages.mentions` SHAPE** in-place (no migration needed)
   from `[uuid]` to `[{userId, displayName, startOffset, endOffset}]`.
   Renderer + sender handle both shapes with `typeof === 'string'` fallback.
3. **Build a unified chat-input controller** as a thin wrapper hook
   `useChatInputController({ conversationId, conversationType,
   participants, savedCards, sessionCards })` returning the props for
   `<TextInput>` + the mount state for both popovers + the chip-tracking
   Map. MessageInterface uses this hook.
4. **Port MentionPopover + CardTagPopover** to accept the unified
   participant + card-pool sources. Keep their original BoardDiscussionTab
   call signatures intact (legacy still uses them) by either adding new
   props with sensible defaults or wrapping them.
5. **Build inline chip rendering in TextInput** via styled-inline-`<Text>`
   children + diff-based backspace. Spec specifies the diff algorithm +
   the chip-range tracking ref.
6. **Build inline card-chip rendering in MessageBubble** using `CardPreview`
   wrapped in `<Pressable onPress={onCardChipTap}>` where onCardChipTap
   invokes `cardPayloadToExpandedCardData` per F-7.
7. **Wire sendMessage** to accept `mentions: MentionEntry[]` + `cardTags:
   CardTagEntry[]`, persist into the corresponding columns, and fire
   `notify-message` with `type='message_mention'` for the mentioned
   users (collapse-aware — see F-6).
8. **Patch notify-message `handleUnifiedMention`** to check
   `conversation_participants.notifications_muted` AND change the title
   format per D-3.
9. **Patch MessageBubble's mention render** to read the structured
   `mentions[]` array (with backward-compat fallback to regex for
   legacy rows).

---

## Regression Prevention

- **Append-only regression tests** per ORCH-0840:
  - Implementor: happy-path — send message with one mention + one
    card-tag from MessageInterface, assert mentions[] + card_tags[]
    populated, assert MessageBubble renders chip + card-chip, assert
    notify-message called with `type='message_mention'`.
  - Tester (adversarial): backspace deletes whole chip atomically on
    iOS + Android; mentioning a non-participant filters in picker (cannot
    be mentioned); mute-toggle suppresses mention push but does NOT
    suppress regular new-message push for the muted user; malformed
    card_tags[i].cardPayload renders gracefully; deleting a profile
    after mention does not crash the bubble.
- **CI gate** for new invariant `I-PROPOSED-CHAT-MENTION-MUTE-RESPECTED`
  — strict-grep style: assert `notifications_muted` appears in the
  `handleUnifiedMention` function body.

---

## Discoveries for Orchestrator

1. **MessageBubble's existing mention render is regex-based and pattern-
   coincidentally works.** It does NOT consult `messages.mentions[]` at all.
   This means any mention that is NOT typed as plain `@word` in the content
   text (e.g., a programmatically-inserted mention with mentions[] array
   but content text doesn't contain `@`) would NOT render as a chip. This
   is a 🟡 hidden flaw worth addressing in this ORCH but could also be a
   separate cleanup ORCH if scope demands.
2. **notify-message `message_mention` handler does not respect
   `conversation_participants.notifications_muted`.** Live today — a muted
   participant who is `@`-mentioned would receive an unsolicited push.
   Currently 0 users are affected (zero mentions sent), but as soon as the
   feature ships, this bug ships with it unless fixed. Bundle the fix into
   this ORCH.
3. **`BoardDiscussionTab` uses `#CardTitle` plaintext prefix to attach
   cards** (line 168-175). Operator's new requirement is the card_payload
   embedded in `card_tags[]` array — a different, stronger contract. This
   work supersedes the BoardDiscussionTab pattern for the unified chat;
   BoardDiscussionTab is being phased out per ORCH-0898 trajectory but
   not yet removed. Spec should note this and recommend a follow-up ORCH
   to retire BoardDiscussionTab once the unified chat fully covers its
   surface area.
4. **`notify-message` title format inconsistency** with operator D-3:
   today produces `"X mentioned you"` (no conversation name in title); D-3
   wants `"X mentioned you in {{ConversationName}}"`. Spec changes the
   handler — register as a notification-copy migration step (no DB
   migration; edge function change).

---

## Confidence

**HIGH** — all findings have file:line citations or migration-line
citations. Live DB state verified earlier this session via
`mcp__supabase__execute_sql`. Sim-level repro not needed for this
investigation (operator-described requirement is a build-new-feature task,
not a UI bug repro — Prime Directive #7 exempts pure greenfield
investigation). The only HIGH-RISK unknown is finding F-8 (RN inline-chip
constraint) — addressed with a single feasible path + a known Android
fidelity trade-off documented for operator decision at spec.
