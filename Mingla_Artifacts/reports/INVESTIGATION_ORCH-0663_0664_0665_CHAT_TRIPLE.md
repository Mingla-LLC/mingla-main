# INVESTIGATION REPORT — ORCH-0663 + ORCH-0664 + ORCH-0665 (Chat Triple)

**Date:** 2026-04-25
**Investigator:** mingla-forensics
**Mode:** INVESTIGATE (no fix proposed; no spec)
**Severity:** S1 (degrades primary social/communication flow)
**Confidence:** HIGH on all three root causes (six-field proven)

---

## Executive Summary (3 sentences)

Three independent symptoms, three independent root causes, all proven by reading the
actual source. They do **NOT** share infrastructure — discussion quote ribbon (0663),
DM realtime delivery (0664), and chat-row delete (0665) live in completely different
code paths and were each broken for different mechanical reasons. **Recommended dispatch:
three independent specs.** Each is small (50-150 LOC), each has a clean structural fix,
and combining them would only add risk.

---

## Symptom 1 — ORCH-0663 — Discussions tab quote ribbon does not propagate

### Behavior

- **Sender path (works):** User A taps Reply on message X, types Y, sends. Y appears
  in User A's chat with the quote ribbon for X above it.
- **Receiver path (broken):** Other session participants receive Y in real time but
  WITHOUT the quote ribbon. Just the bare message text.

### Root Cause 🔴 — RC-0663

| Field | Value |
|-------|-------|
| **File + line** | [BoardDiscussionTab.tsx:208-234](app-mobile/src/components/board/BoardDiscussionTab.tsx#L208-L234) (sender path) and [BoardDiscussionTab.tsx:531-586](app-mobile/src/components/board/BoardDiscussionTab.tsx#L531-L586) (receiver path) + [boardMessageService.ts:233-243](app-mobile/src/services/boardMessageService.ts#L233-L243) (broadcast payload) |
| **Exact code (sender)** | `const replyToSnapshot = replyingTo ? { id, content, user_id, image_url, deleted_at: null, profiles } : null;` … `const dataWithReply = replyToSnapshot ? { ...data, reply_to: replyToSnapshot } : data;` … `setMessages(prev => [...prev, dataWithReply])` |
| **Exact code (receiver)** | `onMessage: (message: any) => { setMessages(prev => [...prev, message as BoardMessage]) }` (no reply_to hydration) |
| **Exact code (broadcast payload)** | `realtimeService.sendBoardMessage(sessionId, { id, session_id, user_id, content, mentions, reply_to_id, created_at, updated_at })` (no `reply_to` object) |
| **What it does** | Sender constructs a `reply_to` snapshot client-side from local state and merges it into local messages. Receiver pulls the message from broadcast or postgres_changes — both payloads carry `reply_to_id` (FK string) but NOT a hydrated `reply_to` object — and appends the raw row. |
| **What it should do** | Both paths should produce a message object with the SAME shape, including a hydrated `reply_to` object whenever `reply_to_id` is set. Either the broadcast/postgres_changes payload must be enriched, or the receiver must hydrate `reply_to_id` → `reply_to` on receipt (lookup in local message list, fall back to fetch). |
| **Causal chain** | (1) User A taps Reply on X → `setReplyingTo(X)`. (2) User A types Y, sends → `BoardMessageService.sendBoardMessage` writes the row with `reply_to_id=X.id`. (3) The service ALSO calls `realtimeService.sendBoardMessage(sessionId, {...partial payload, reply_to_id})` — broadcast has only `reply_to_id`, no `reply_to`. (4) Sender's local code at L227-230 constructs `replyToSnapshot` from local `replyingTo` state, merges into message → User A's message Y has `reply_to: {...}`. (5) `MessageBubble.tsx:222` `{message.reply_to && <ReplyQuoteBlock>}` → TRUE for User A → ribbon renders. (6) On User B's device, broadcast fires → `realtimeService.subscribeToBoardSession.dispatch('onMessage', data)` → BoardDiscussionTab.tsx:535 callback runs → `setMessages(prev => [...prev, message])` — message has `reply_to_id` but NO `reply_to`. (7) `MessageBubble.tsx:222` `{message.reply_to && <ReplyQuoteBlock>}` → FALSY → ribbon NOT rendered. |
| **Evidence** | Read all four files end-to-end. The asymmetry is structural and visible: sender path explicitly builds a snapshot client-side (commented "Attach reply_to snapshot so ReplyQuoteBlock renders immediately"), receiver path has no equivalent. The broadcast envelope at boardMessageService.ts:234-243 is verbatim minimal — only DB columns, no joined fields. The postgres_changes payload (board_messages table) is the raw row by design — Postgres CDC has no JOIN. |
| **Verification step** | Send a quote-reply on Device 1, observe quote ribbon. On Device 2, observe message arrives WITHOUT ribbon. Force-close + reopen the discussion on Device 2 → `BoardMessageService.getBoardMessages` runs (lines 125-184) which DOES batch-fetch reply parents + joins them as `reply_to`, so on reload the ribbon DOES appear. The reload-fixes-it behavior is the smoking gun: load path hydrates, realtime path doesn't. |
| **Confidence** | **HIGH** |

### Hidden Flaws found while investigating

- **HF-0663-A** 🟡 — `MessageBubble.tsx:222` reads `message.reply_to` (object) without
  any guard or normalization. Same component is used by both the working `getBoardMessages`
  path (hydrated) and the broken realtime path (not hydrated). The bubble has no defensive
  fallback for "reply_to_id present but reply_to missing." This is the load-bearing line —
  it's why the ribbon vanishes on receivers.

- **HF-0663-B** 🟡 — Two separate services overlap: `boardMessageService.ts` (used by
  `BoardDiscussionTab` via `BoardMessageService.getBoardMessages` / `sendBoardMessage`)
  and `boardDiscussionService.ts` (used by `useSessionDiscussion`, an alternative hook).
  Both fetch the same table with different shapes. `boardMessageService.getBoardMessages`
  hydrates `reply_to`. `boardDiscussionService.fetchSessionMessages` does NOT. If anything
  ever re-points BoardDiscussionTab at `useSessionDiscussion`, the load-path hydration
  goes away too. This is a Constitution #2 violation (one owner per truth) waiting to bite.

- **HF-0663-C** 🟡 — `BoardDiscussionTab.tsx:538-549` "incomingIsRicher" merge logic
  checks for `profiles` and `reactions` enrichment but NOT `reply_to`. So even when the
  postgres_changes path arrives AFTER the broadcast (carrying the same un-hydrated row),
  no rehydration is attempted. The merge is incomplete by field.

### Blast radius

- **Card-level discussions** (`board_card_messages` table, used by `CardDiscussionModal`):
  same architecture. `BoardMessageService.sendCardMessage` at boardMessageService.ts:619-623
  broadcasts the same minimal envelope. **Same bug class — needs verification.**
- **Discussion fallback hook** (`useSessionDiscussion` + `BoardDiscussion.tsx`):
  `BoardDiscussion.tsx` is imported but `BoardDiscussionTab.tsx` appears to be the active
  surface. Verify which is wired into the user-visible Discussions tab today.

### Layer-by-layer reconcile

| Layer | Finding |
|-------|---------|
| Docs | No spec exists for cross-device reply-quote propagation. Reply UI was added by code only. |
| Schema | `board_messages.reply_to_id UUID REFERENCES board_messages(id)` (verified via [20260412300001_add_reply_to_id_to_messages.sql](supabase/migrations/20260412300001_add_reply_to_id_to_messages.sql)). RLS allows participants to SELECT messages in their sessions — receivers CAN read the parent if asked. |
| Code | Sender hydrates client-side; receiver does not. Asymmetric data shape. |
| Runtime | `realtimeService.sendBoardMessage` payload is verbatim minimal — confirmed by reading the broadcast envelope. |
| Data | DB row contains `reply_to_id` correctly (sender's INSERT writes it). The data exists, but the hydration path on receivers never runs. |

---

## Symptom 2 — ORCH-0664 — Direct message thread does not update in real time

### Behavior

- User A and User B are friends. Both are on the chat thread.
- User A types and sends a message Y.
- User A's screen shows Y immediately (optimistic update) and persists Y in the DB.
- **User B's screen does NOT add Y until User B closes and reopens the thread.**
- The DB DOES contain Y (closing/reopening triggers a fetch and Y is loaded from the server).

### Root Cause 🔴 — RC-0664

| Field | Value |
|-------|-------|
| **File + line** | [MessageInterface.tsx:235-248](app-mobile/src/components/MessageInterface.tsx#L235-L248) (no-op handler) + [useBroadcastReceiver.ts:41-53](app-mobile/src/hooks/useBroadcastReceiver.ts#L41-L53) (premature seen-set add) + [ConnectionsPage.tsx:1516-1545](app-mobile/src/components/ConnectionsPage.tsx#L1516-L1545) (postgres_changes skips when seen) |
| **Exact code (no-op)** | `const handleBroadcastMessage = useCallback((_msg: DirectMessage) => { /* ConnectionsPage owns all message state — broadcast messages are deduplicated there via broadcastSeenIds ref + postgres_changes backup delivery. */ }, []);` |
| **Exact code (seen-set add)** | `if (msg.sender_id === currentUserId) return; if (broadcastSeenIds.current.has(msg.id)) return; broadcastSeenIds.current.add(msg.id); onBroadcastMessageRef.current(msg);` |
| **Exact code (skip)** | `const alreadyDelivered = broadcastSeenIds.current.has(newMessage.id); if (!alreadyDelivered) { … setMessages(prev => […, transformedMsg]) }` |
| **What it does** | When the receiver's broadcast hook fires for an incoming message: (1) marks the message id as seen in `broadcastSeenIds` AT line 51 of useBroadcastReceiver, (2) calls the no-op handler at line 52, (3) ms later, postgres_changes fires for the same row, (4) ConnectionsPage's `onMessage` callback checks `broadcastSeenIds.current.has(...)` → TRUE because step (1) populated it, (5) `if (!alreadyDelivered)` → SKIPS the `setMessages` add, (6) only cache-update + conversation-list-update + auto-mark-as-read run — none of which add to the visible `messages` state. **The message is silently dropped from UI.** |
| **What it should do** | One of: (a) the broadcast handler in MessageInterface actually adds the message to ConnectionsPage's state via a passed-down callback; (b) the seen-set add is moved INSIDE the actual delivery so a no-op doesn't pre-mark it; (c) the broadcast subscription is removed and postgres_changes is the sole delivery (broadcast then becomes purely a sender-side latency optimization that's currently buying nothing). The current architecture's INTENT — "broadcast for instant UI, postgres_changes as backup" — is not actualized; instead it's "broadcast pre-marks-seen, postgres_changes skips-as-seen." |
| **Causal chain** | (1) User A sends → DB INSERT + broadcast send via `chat:${id}` channel. (2) User B's `useBroadcastReceiver` subscribes to `chat:${id}` (mounted via MessageInterface). (3) Broadcast delivers to User B → useBroadcastReceiver L48 checks seen → false → L51 ADDS id to broadcastSeenIds → L52 calls handler. (4) MessageInterface handler is the no-op at L235-241 (does nothing). (5) ~ms later, Supabase Realtime fires postgres_changes INSERT on User B's `conversation:${id}` channel. (6) ConnectionsPage subscribeToConversation.onMessage runs → L1516 alreadyDelivered=TRUE → L1518 `if (!alreadyDelivered)` skips the entire setMessages block at L1522-1544. (7) Side effects (cache, conversation list, mark-as-read) DO run, which is why the cache eventually has the message — but the in-memory `messages` array never sees it until full re-fetch. (8) When User B navigates away and back, `messages` resets to empty, then gets repopulated by `messagingService.getMessages` from the DB → message Y now appears. |
| **Evidence** | Read all four files end-to-end. The intent comment at MessageInterface.tsx:236-239 ("ConnectionsPage owns all message state — broadcast messages are deduplicated there via broadcastSeenIds ref + postgres_changes backup delivery") explicitly describes the architecture, but the dedup happens BEFORE delivery, not after. The architecture comment is correct in spirit but wrong in implementation order — the dedup gate should be after `setMessages` runs, not before. |
| **Verification step** | Two-device test: open the same DM thread on both. From device 1, send a message. Device 2's UI does NOT update. Wait. Still does not update. Press home, return to app. Press back, reopen the thread. Message appears. The "doesn't appear in real time + appears on reopen" pattern is the smoking gun — broadcast did fire (proven by the seen-set being populated, which only the broadcast path touches), but never made it to UI state. |
| **Confidence** | **HIGH** |

### Hidden Flaws found while investigating

- **HF-0664-A** 🟡 — Architecture comment at L1909-1912 of ConnectionsPage:
  "Broadcast to other participants (instant delivery <500ms) NOTE: This depends on
  MessageInterface's useBroadcastReceiver having already subscribed to this channel."
  This is the architectural justification for keeping the broadcast subscription alive
  — to make `supabase.channel(name)` return an existing subscribed channel for the
  sender's `.send()`. **This is a side-effect-as-load-bearing-coupling.** If anyone
  ever simplifies useBroadcastReceiver out, the SEND path breaks too. Constitution-grade
  hidden flaw.

- **HF-0664-B** 🟡 — `subscribeToConversation` filter is `conversation_id=eq.${conversationId}`
  — postgres_changes filter on Supabase Realtime DOES re-evaluate RLS for the receiver's
  JWT, but the receive-side RLS on `messages` (verified via
  [20250128000003_create_direct_messaging.sql:155-166](supabase/migrations/20250128000003_create_direct_messaging.sql#L155-L166))
  is `EXISTS (...participant)` — passes for both parties, NOT a delivery blocker.
  Confirmed `messages` IS in `supabase_realtime` publication via
  [20260310000002_create_user_push_tokens_and_realtime.sql:59](supabase/migrations/20260310000002_create_user_push_tokens_and_realtime.sql#L59).
  RLS + publication are CORRECT — disprove that hypothesis cleanly. The bug is purely
  in the client-side dedup logic.

- **HF-0664-C** 🟡 — `setupRealtimeSubscription` at ConnectionsPage:1501-1620 has no
  `.subscribe(status => …)` reconnect handling. If the channel disconnects (background,
  network blip), there's no auto-resubscribe except via the explicit
  online-after-offline path at L1476-1493. A Wi-Fi-to-cellular handoff that doesn't
  trip the offline flag could leave a dead channel. Out of scope for ORCH-0664 fix
  but worth flagging.

### Blast radius

- **All friend-to-friend DM threads** — every DM is broken for the receiver. This is
  every user, every chat, every message.
- Sender path is unaffected (sender's own optimistic insert always wins over realtime).
- Conversation list (`conversations` array) updates correctly via L1578-1589 — that's
  why "last message" preview on the chat list updates even when the thread doesn't.

### Layer-by-layer reconcile

| Layer | Finding |
|-------|---------|
| Docs | ORCH-0436 Ghost-conversation fix is the most recent documented change to this area; no spec for the broadcast/postgres_changes dedup architecture. |
| Schema | `messages` table + RLS healthy. In `supabase_realtime` publication. **No schema-side fault.** |
| Code | Receiver-side dedup is positioned BEFORE delivery, not after. Pre-mark-then-skip pattern. |
| Runtime | Broadcast delivers to client; client's hook adds to seen-set then calls a no-op; postgres_changes delivers next; client's onMessage sees "seen" and skips UI update. |
| Data | DB row written correctly. The DATA is healthy. The broken bit is the client's UI hydration. |

---

## Symptom 3 — ORCH-0665 — Swipe-to-delete chat reappears

### Behavior

- User swipes a chat row → red Delete reveal → tap Delete → confirmation Alert →
  tap Delete (destructive). Row animates out of the list.
- User navigates away (e.g., to Discover) and back to Connections.
- The chat row is back in the list, with all its messages intact.

### Root Cause 🔴 — RC-0665

| Field | Value |
|-------|-------|
| **File + line** | [ConnectionsPage.tsx:441-450](app-mobile/src/components/ConnectionsPage.tsx#L441-L450) |
| **Exact code** | `const handleDeleteChat = useCallback((conversationId: string) => { Alert.alert('Delete Chat', 'Are you sure you want to delete this chat?', [ { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { setConversations(prev => prev.filter(c => c.id !== conversationId)); } }, ]); }, []);` |
| **What it does** | Removes the conversation from local React state ONLY. No database call. No service call. No `messagingService.deleteConversation`. No write to AsyncStorage (unlike `handleArchiveChat` at L419-428 which at least persists locally). On the next `fetchConversations(user.id)` call (which re-runs on chat-back, network reconnect, app foreground, etc.), the deleted conversation is re-fetched from the DB and re-appears. |
| **What it should do** | The "Delete" intent for DMs should be one of three product behaviors (this is a product decision the spec must lock; see "Design Question" below). All three require an actual durable mutation — DB write, schema column, or RPC call. |
| **Causal chain** | (1) User swipes ChatListItem → red Delete tappable revealed (ChatListItem.tsx:158-165). (2) Tap Delete → `onDelete?.(conversation.id)` → ConnectionsPage's `handleDeleteChat` runs. (3) Alert.alert prompts "Delete Chat" → user taps Delete. (4) `setConversations(prev.filter(...))` removes from local state. (5) Row vanishes from list (UI feedback complete). (6) User navigates away → ConnectionsPage may unmount or stay mounted. (7) On chat-back at L1639-1643, `fetchConversations(user.id)` runs unconditionally. (8) `messagingService.getConversations` queries `conversation_participants` for user's conversations (no `hidden_at` / `deleted_at` filter — see "Schema" below). (9) Deleted conversation comes back — it was never actually deleted. |
| **Evidence** | Direct read of the function at lines 441-450. No DB call, no service call, no AsyncStorage call. Compare to `handleArchiveChat` at L419-428, which at least writes to `AsyncStorage` with key `mingla:archived_chats:${user.id}` (still client-only, but at least persists across navigation on the same device). Searched `messagingService.ts` for `deleteConversation`, `hideConversation`, `archiveConversation` — none exist. Searched all 293 migrations for `conversation_participants ADD COLUMN`, `hidden_at`, `deleted_at`, `archived_at` on conversation tables — **NONE FOUND**. The schema has no column to support per-user soft-delete. |
| **Verification step** | Open Connections. Swipe a chat → tap Delete → confirm. Watch row disappear. Pull to refresh OR navigate to Discover and back. Row reappears. Inspect DB row directly: `SELECT * FROM conversations WHERE id = '...'` → still exists. `SELECT * FROM conversation_participants WHERE conversation_id = '...'` → both participants still listed. **The data is untouched.** |
| **Confidence** | **HIGH** |

### Hidden Flaws found while investigating

- **HF-0665-A** 🟡 — `handleArchiveChat` at L419-428 has the same architectural smell:
  archive is AsyncStorage-only, per-device. If the user reinstalls the app or swaps devices,
  archives are lost. Acceptable for "hide on this device" behavior, but undocumented and
  subtly inconsistent — the user expects archive/delete to be durable.

- **HF-0665-B** 🟡 — `ChatListItem.tsx:34-36` declares both `onArchive` and `onDelete`
  as props. Both are wired (`ConnectionsPage.tsx:2557-2558`). UX treats them as
  symmetric destructive/non-destructive actions, but their persistence layer behavior is
  asymmetric (AsyncStorage vs nothing) — which compounds user confusion.

- **HF-0665-C** 🟡 — Schema has no `hidden_at` / `deleted_at` on `conversation_participants`.
  Whatever fix is chosen, this has to be added (or a new `conversation_states` table
  introduced). The current schema is INCOMPATIBLE with any soft-delete pattern.

### Constitutional violations

- **#3 (No silent failures)** — User taps "Delete" in a destructive alert; UI confirms
  by removing the row; server is never called; nothing fails — therefore nothing
  surfaces. This is the silent-fake-success variant of #3. The user is lied to.
- **#2 (One owner per truth)** — Two owners of "is this conversation in my list":
  the local `conversations` state (filtered), and the `conversation_participants` table
  (untouched). They disagree. The DB wins on the next fetch.

### Design question (spec-blocking, must answer before fix)

What does "Delete chat" mean for a Mingla DM?

| Option | Behavior | Pros | Cons |
|--------|----------|------|------|
| **A. Hard delete** | Destroy `conversations` + cascade `messages`, both users lose the thread. | Simple. | The OTHER PERSON also loses the thread without consent. Standard messaging apps DO NOT do this. Likely violates user expectation and possibly trust. |
| **B. Soft hide (per-user)** | Add `hidden_at TIMESTAMPTZ` to `conversation_participants`. `getConversations` filters `WHERE hidden_at IS NULL`. When the OTHER user sends a new message, a trigger or service path resets `hidden_at = NULL` for the receiving participant — the conversation resurfaces. | Matches iMessage / WhatsApp / Signal user expectation. Reversible (until next message). Other user is unaffected. | Requires schema migration + trigger + service-side filter + spec for "what counts as resurface." |
| **C. Per-user wipe** | Add `deleted_at` to `conversation_participants`; this user's UI never shows the conversation again, ever, even on new messages. | Hard delete from this user's POV without affecting the other user. | One-way (can't unhide). New message from the other user doesn't reach this user — surprise behavior. |

**Forensics recommendation: Option B (soft hide).** It matches user mental models, is
reversible, and respects the other party. It's also the pattern most extensible — Option
C can be implemented later as "Block" without rework. Option A burns bridges.

The spec writer should validate this with the user before committing. If the user wants
Option C, the schema + trigger work is similar; only the resurface behavior changes.

### Blast radius

- **Every DM chat row** — same bug for every user, every conversation.
- **Archive parity (HF-0665-A)** — same code class. Spec should consider whether
  archive should also be moved to the DB layer in the same migration, OR explicitly
  documented as device-local for now.
- **Realtime impact** — when conversations resurface (Option B), the `conversations`
  list realtime path needs to handle the "previously hidden, now visible" case. Currently
  the conversation list doesn't subscribe to its own changes via postgres_changes; it's
  refetch-based. Acceptable for now.

### Layer-by-layer reconcile

| Layer | Finding |
|-------|---------|
| Docs | No spec for chat-delete behavior. Not in any prior ORCH artifact. |
| Schema | **No `hidden_at` / `deleted_at` / `archived_at` on `conversation_participants`.** Schema does not currently support soft-delete. |
| Code | Local-state-filter only. No DB write. No AsyncStorage. |
| Runtime | Network has nothing to do with this — the call never happens. |
| Data | DB is unaffected by the user's "delete" action. |

---

## Cross-symptom observations

### Why three independent root causes, not one

The dispatch hypothesized possible shared infrastructure (realtime channels, message
hydration, list source-of-truth). Confirmed: **NO SHARED INFRASTRUCTURE.**

- 0663 lives in `BoardDiscussionTab` + `boardMessageService` + `realtimeService` for
  board (collaboration) sessions. Discussion realtime works fine — only the quote
  ribbon is missing. Bug is in payload shape asymmetry.
- 0664 lives in `ConnectionsPage` + `MessageInterface` + `useBroadcastReceiver` +
  `messagingService` for friend DMs. Different table (`messages`, not `board_messages`).
  Different channel name. Different dedup architecture. Bug is in dedup ordering.
- 0665 lives in `ConnectionsPage.handleDeleteChat`. Pure UI state filter, no realtime
  involvement at all. Bug is "no implementation."

### Solo / collab parity

- Discussion (collab): works for plain messages, broken for quoted messages (0663).
- DM (solo, friend-to-friend): broken for ALL messages on receiver side (0664).
- Delete chat: only applies to DMs (collab sessions don't surface in this list).

No solo/collab asymmetry to fix as a meta-pattern.

---

## Static analysis flags found while reading

| Location | Flag | Severity |
|----------|------|----------|
| `MessageInterface.tsx:235-241` | No-op callback used as critical path. | 🔴 (this IS RC-0664) |
| `useBroadcastReceiver.ts:51-52` | Side-effect (seen-set add) before delegation; mutation-before-call ordering. | 🔴 (load-bearing in RC-0664) |
| `boardDiscussionService.ts:46-50` | SELECT join missing for foreign-key-related field that the renderer expects. | 🟡 |
| `BoardDiscussionTab.tsx:222`, `MessageBubble.tsx:222` | `message.reply_to` accessed without normalization across hydration paths. | 🟡 |
| `ConnectionsPage.tsx:441-450` | Destructive Alert action with no real mutation. | 🔴 (this IS RC-0665) |
| `ConnectionsPage.tsx:419-428` | "Archive" persists to AsyncStorage only; multi-device drift. | 🟡 |
| Multiple sites in `messagingService.ts` | `catch (error: any)` then `return { ..., error: error.message }` — masks original error type / stack. | 🔵 (pattern, not actively broken) |

---

## Invariants (proposed for INVARIANT_REGISTRY.md, defer to spec phase)

- **I-REALTIME-PAYLOAD-SHAPE-PARITY** — broadcast payload + postgres_changes payload +
  initial-fetch payload for the SAME entity must produce the SAME shape consumed by the
  renderer. If any path needs hydration (joined fields, denormalized lookups), the
  hydration MUST happen at the receiver before state-set, OR the broadcast payload must
  pre-include the hydrated fields. ORCH-0663 is the violation that motivates this.

- **I-DEDUP-AFTER-DELIVERY** — dedup tracking sets (e.g., `broadcastSeenIds`) must be
  populated INSIDE the success path of the delivery, not BEFORE delegation. If the
  delegate is a no-op, the dedup state must still be coherent with what the user
  actually sees. ORCH-0664 is the violation that motivates this.

- **I-DESTRUCTIVE-UI-MEANS-DURABLE-MUTATION** — any UI affordance presented as a
  destructive action (red color, "Delete" copy, destructive Alert.alert option,
  Constitutional #3 user expectation) MUST trigger a durable server-side mutation
  with confirmable side effects. UI-state-only "delete" is a Constitutional #3
  violation. ORCH-0665 is the violation that motivates this.

---

## Discoveries for the orchestrator

- **0663.D-1** — Card-level discussions (`board_card_messages`) likely have the same
  reply-quote bug. Verify in spec scope; bundle into ORCH-0663 fix if confirmed.
- **0663.D-2** — Two parallel services (`boardMessageService.ts` + `boardDiscussionService.ts`)
  with overlapping concern. Constitution #2 candidate for cleanup. Out of scope for
  ORCH-0663 fix; file as separate ORCH for service consolidation.
- **0664.D-1** — `useMessages.ts` is deprecated per its own header but still present.
  Cleanup task; out of scope.
- **0664.D-2** — Realtime reconnect on background→foreground transition (HF-0664-C)
  needs a discrete look. Out of scope for ORCH-0664 fix.
- **0664.D-3** — `useBroadcastReceiver`'s subscription is load-bearing for the SENDER's
  send path (per the comment at ConnectionsPage:1909-1912). This is fragile. Future
  cleanup should consider moving the broadcast channel ownership to ConnectionsPage so
  send and receive aren't coupled to MessageInterface lifecycle.
- **0665.D-1** — `handleArchiveChat` (HF-0665-A) is also fake-ish (AsyncStorage-only).
  Decision: bundle archive into the same migration as delete (soft-hide via
  `hidden_at`, archive via `archived_at`), or leave archive as device-local. **Spec
  writer must answer.**

---

## Recommended dispatch path

**Three independent specs.** Rationale:

- 0663 fix: ~2 files, ~30 LOC change. Either enrich broadcast payload or hydrate on
  receive. Self-contained.
- 0664 fix: ~3 files, ~20 LOC change. Either remove the no-op handler and route
  broadcasts to ConnectionsPage's add-message logic, or move seen-set add inside the
  delegate, or eliminate the broadcast path. Self-contained.
- 0665 fix: ~1 migration + ~1 service method + ~3 UI sites. Schema-touching, has a
  product design question (Option A/B/C above), needs explicit user sign-off before spec.

Bundling them into one mega-spec adds review burden without sharing implementation work.
Three small specs ship cleaner.

Recommended sequence: **0664 first** (highest user impact: every receiver of every DM
is broken), then **0663**, then **0665** (after Option A/B/C product decision).

---

## Confidence

| RC | Confidence | What would raise it |
|----|-----------|--------------------|
| RC-0663 | HIGH | Already six-field proven by reading source. Two-device live-fire would lock to L0 verification but isn't required for spec. |
| RC-0664 | HIGH | Same — six-field proven. Two-device live-fire confirms. |
| RC-0665 | HIGH | Already six-field proven; the function body is 4 lines. Cannot be more proven. |

All three: **proven**, not "probable." Dispatch with confidence.
