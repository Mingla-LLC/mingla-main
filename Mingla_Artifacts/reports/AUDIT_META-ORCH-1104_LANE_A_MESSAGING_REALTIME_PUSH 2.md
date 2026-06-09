# AUDIT — META-ORCH-1104 LANE A: Messaging / Realtime / Push Substrate

**Lane:** A (the messaging/realtime/push substrate support will ride on)
**Mode:** Forensic INVESTIGATE/AUDIT — document what exists with proof; do NOT design the feature.
**Date:** 2026-06-08
**Method:** Live read-only DB introspection (Supabase MCP, linked project) + source read of the canonical service/edge files.
**Scope guard:** This report documents contracts and reuse surfaces. It does not propose schema or UX. The SPEC is written from here.

> Cross-correction note: where this audit's live evidence contradicts the PROPOSAL §6.5 Evidence Addendum, the SQL/source here is authoritative. Two material corrections are flagged inline (F1.4 and F5.6).

---

## 1. CONVERSATIONS / MESSAGES CONTRACT

### F1.1 — `conversations` columns (live `information_schema`)
| column | type | nullable | default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| type | varchar | YES | `'direct'` |
| created_by | uuid | YES | — (FK auth.users, ON DELETE SET NULL) |
| created_at / updated_at | timestamptz | YES | now() |
| last_message_at | timestamptz | YES | — |
| session_id | uuid | YES | FK collaboration_sessions ON DELETE CASCADE |
| event_id | uuid | YES | FK events ON DELETE CASCADE |
| linked_entity_type | **text** | **NO** | `'direct'` |
| is_broadcast_only | boolean | NO | false |
| is_enabled | boolean | NO | true |
| name | text | YES | — |

### F1.2 — `messages` columns (live)
`id, conversation_id (NOT NULL, FK ON DELETE CASCADE), sender_id (NULLABLE, FK auth.users ON DELETE SET NULL), content (text NOT NULL), message_type (varchar default 'text'), file_url, file_name, file_size (bigint), created_at, updated_at, deleted_at, is_read (bool NOT NULL false), read_at, reply_to_id (FK messages ON DELETE SET NULL), card_payload (jsonb), mentions (jsonb NOT NULL '[]'), card_tags (jsonb NOT NULL '[]'), marketing_campaign_id (FK marketing_campaigns ON DELETE SET NULL).`
Note `sender_id` is **nullable** — NULL sender = system message (used by collab banners; enrichMessage isSystem rule at `messagingService.ts:1438,1454`).

### F1.3 — Enum CHECK constraints (live `pg_constraint`)
- **`conversations_type_check`**: `type IN ('direct','group')`.
- **`conversations_linked_entity_type_check`**: `linked_entity_type IN ('direct','session','trip','event')`.
- **`conversations_linked_entity_coherent`**: a per-value coherence CHECK — `direct`⇒session_id NULL & event_id NULL; `session`⇒session_id NOT NULL & event_id NULL; `trip`⇒event_id NOT NULL & session_id NULL; `event`⇒event_id NOT NULL & session_id NULL.
- **`conversations_group_requires_name`**: `(type='direct' AND name IS NULL) OR (type='group' AND name trimmed length>0)`.
- **`messages_message_type_check`**: `message_type IN ('text','image','video','file','card','system')`.
- **`messages_card_requires_payload`**: `message_type<>'card' OR card_payload IS NOT NULL`.

### F1.4 — ⚠️ CORRECTION to PROPOSAL §6.5 E2: adding `'support'` is NOT free — it requires THREE constraint changes
The proposal calls `linked_entity_type='support'` "a natural extension." Evidence says it is **enum-constrained, not free-text**, and is entangled with two more CHECKs:
1. `conversations_linked_entity_type_check` must be dropped/widened to add `'support'`. (file:line proof of code assuming the closed set: `messagingService.ts:396` `linked_entity_type?: 'direct' | 'session' | 'trip' | 'event'`.)
2. `conversations_linked_entity_coherent` must gain a `'support'` branch — and a support thread has **neither** session_id nor event_id, so the new branch must assert both are NULL (shape identical to the `'direct'` branch). Without this branch, every support-conversation INSERT fails the coherence CHECK.
3. `conversations_group_requires_name` forces a decision: if support conversations are `type='group'` they MUST carry a non-empty `name`; if `type='direct'` they MUST have `name IS NULL`. A support case with a subject line maps cleanly to `type='group'` + name=subject, but then it inherits the group-name requirement.

Migration-baseline hazard (memory `feedback_edge_deploy_and_migration_apply_hazards.md`): widening a CHECK = DROP CONSTRAINT then ADD CONSTRAINT in the same migration. The live volume is tiny — `conversations.type`: 11 direct / 142 group; `linked_entity_type`: 11 direct / 11 session / 45 trip / 86 event; `messages.message_type`: 89 text / 14 card / 2 system / 1 image — so the rewrite is cheap, but it is a real DDL change, not a no-op.

### F1.5 — `message_type` needs NO change for support
Support messages are plain `'text'` (and `'image'/'file'` for attachments), all already allowed. `'system'` is available for "case assigned"/"case resolved" banners with `sender_id=NULL`. No new message_type value is required.

---

## 2. MESSAGING SERVICE — canonical send/subscribe API

File: `app-mobile/src/services/messagingService.ts` (singleton export `messagingService`, line 1604).

### F2.1 — Create a conversation
- **Direct, atomic (preferred):** `ensureConversation(userId1, userId2) → { conversationId, error }` (`:582`) → RPC `get_or_create_direct_conversation(p_user1_id uuid, p_user2_id uuid) RETURNS uuid` (confirmed live). Includes a block check (`:588`). **Gated to DM semantics only** (creates `type='direct'`).
- **Direct + first message:** `sendFirstMessage(senderId, recipientId, content, messageType='text', fileUrl?, fileName?, fileSize?, replyToId?)` (`:610`).
- **Low-level (private):** `createNewConversation` (`:547`) inserts `{ type:'direct', created_by }` then two `conversation_participants` rows. **There is NO public method to create a `type='group'` / arbitrary-`linked_entity_type` conversation from the client.** Group conversations today are created **server-side by DB triggers** (`getOrCreateGroupConversationForSession` `:1026` and `getOrCreateGroupConversationForEvent` `:1070` are *lookup-only*; comments confirm "The database owns creation").
- **Implication for support:** there is no existing client API to mint a support conversation. A new path is required — either a new RPC (mirroring `get_or_create_direct_conversation`) or a DB trigger on the new support-case table that mints the conversation + seeds participants. The RLS INSERT policy `Users can create conversations` (`with_check: created_by = auth.uid()`) lets a requester create their own conversation row, but participant-seeding of the *staffer* cannot be done by the requester (see F2.2 + §6).

### F2.2 — Add participants
- No public "addParticipant" method exists. Participant INSERT RLS is `conversation_participants_direct_self_add` with `with_check: (user_id = auth.uid()) AND is_direct_conversation(conversation_id)` — i.e. **a user can only add THEMSELVES, and only to a DIRECT conversation.** For group/trip/event conversations participants are seeded by triggers/edge functions with the service role.
- `leaveGroupConversation(conversationId, userId)` (`:1159`) deletes own participant row (RLS `Users can update their own participation` covers own-row only; brand-team delete exists separately).
- **Implication for support:** seeding the assigned staffer as a participant must run with elevated rights (RPC `SECURITY DEFINER` or service-role edge fn). A requester cannot add a staffer; a staffer cannot self-add to a support conversation under current policies.

### F2.3 — Send a message
`sendMessage(conversationId, senderId, content, messageType='text', fileUrl?, fileName?, fileSize?, replyToId?, mentions=[], cardTags=[]) → { message, error }` (`:887`). Inserts into `messages`; on 42501 disambiguates block vs broadcast-only via `translateInsertRlsError` (`:959`). Fires `sendPartitionedMessageNotifications` non-blocking (`:937`). Card variant: `sendCardMessage` (`:1184`).

### F2.4 — Fetch a thread
- `getMessages(conversationId, userId, limit=50) → { messages, error }` (`:832`) — newest-50, `deleted_at IS NULL`, reversed to ascending, enriched with sender name + read.
- `getConversation(conversationId, userId)` (`:639`); `getConversations(userId)` (`:704`, 2-round-trip RLS-filtered list); `getMessageById` (`:859`).

### F2.5 — Subscribe to new messages
`subscribeToConversation(conversationId, userId, { onMessage, onMessageUpdated, onMessageDeleted }) → RealtimeChannel` (`:1312`). Channel name **`conversation:${conversationId}`** (`:1321`). Three `postgres_changes` bindings (INSERT/UPDATE/DELETE) on `public.messages` filtered `conversation_id=eq.${id}`. Teardown: `unsubscribeFromConversation(conversationId)` (`:1381`). Channels held in an instance `Map` (`:413`).

### F2.6 — What a caller needs to start a conversation programmatically
For a DM: just `ensureConversation` (or `sendFirstMessage`). For ANYTHING non-direct (which support is): there is **no client primitive** — the DB owns creation + participant seeding. Support must add its own server-side mint path. The send/subscribe halves (F2.3, F2.5) are fully reusable as-is once the conversation + participants exist.

---

## 3. REALTIME — channel conventions & lifecycle

File: `app-mobile/src/services/realtimeService.ts` (singleton `realtimeService`, `:1200`). Distinct from `messagingService`'s own channel map.

### F3.1 — Channel naming conventions (observed)
| channel name | owner | purpose |
|---|---|---|
| `conversation:{conversationId}` | messagingService `:1321` **and** business `useEventGroupChat:58` | per-thread message INSERT/UPDATE/DELETE |
| `presence:{conversationId}` | chatPresenceService `:107` + useChatPresence `:90` | typing broadcast + presence postgres_changes |
| `session:{sessionId}` | realtimeService `:91` | collab session participants/updates + broadcast `message` |
| `board:{boardId}` | realtimeService `:161` | board updates + broadcast |
| `board_session:{sessionId}` | realtimeService `:375` | the rich collab channel (RLS-private, `config:{private:true}` `:415`) |
| `business-notifications-{userId}-{ts}-{rand}` | business useBusinessNotifications `:81` | per-user notifications inbox |

Convention = **`{entity}:{id}`**, lower-case, colon-delimited. A support channel consistent with this is **`support:case:{id}`** (or reuse `conversation:{conversationId}` directly, since support rides a real conversation row — see F3.4).

### F3.2 — postgres_changes vs broadcast usage
- **postgres_changes** = source-of-truth data delivery (messages, participants, presence rows, votes/RSVPs). Used everywhere the row is the truth.
- **broadcast** = ephemeral/instant signals: typing (`typing_start`/`typing_stop`), board message instant path (`board_message`), swipe/save optimistic events, and the ORCH-0931 `session_updated` cache-invalidation signal. Broadcast is also used where PK-filter postgres_changes is known-dead (ORCH-0931 note `:709-726`).
- **Known footgun (documented in-code):** supabase-realtime **silently drops postgres_changes bindings that filter on a primary-key column** (`id=eq.{id}`). See `:746` TODO and `:709-726`. Support must filter message subscriptions on `conversation_id` (a non-PK FK) — which is exactly what `subscribeToConversation` already does (`:1336`). Safe.

### F3.3 — subscribe/unsubscribe lifecycle
- Channels are memoized in a `Map`; re-subscribe removes the prior channel first (`:1324`, `:396`).
- RLS-private channels (`board_session:`,`session:`,`board:`) require `supabase.realtime.setAuth(accessToken)` before subscribe (`:387`) and `config:{private:true}` (`:415`); `rebindAuthenticatedChannels` (`:315`) re-auths on token refresh. Plain `conversation:` and `presence:` channels are **not** marked private and rely on table RLS for read-gating.
- Teardown via `supabase.removeChannel(channel)` + Map delete (`:283`); `unsubscribeAll` on sign-out (`:348`).

### F3.4 — How a support channel plugs in
Because a support case OWNS a `conversations` row (the recommended model), the **existing `conversation:{conversationId}` channel + `subscribeToConversation` already deliver live support messages with zero new realtime code** — both the requester (app-mobile) and the staffer (business app, which uses the identical `conversation:{id}` channel, F6.2) get INSERTs. A separate `support:case:{id}` broadcast channel would only be needed for support-specific ephemeral signals (e.g. "staffer is viewing", queue claim events, agent presence) that are NOT message rows. If added, follow §F3.1 naming and the F3.2 broadcast pattern, and gate reads via table RLS or `config:{private:true}` + `setAuth`.

---

## 4. PRESENCE — live online/typing

Files: `app-mobile/src/services/chatPresenceService.ts` (121 ln), `app-mobile/src/hooks/useChatPresence.ts` (235 ln), table `conversation_presence`.

### F4.1 — Table contract
`conversation_presence(id, conversation_id (FK ON DELETE CASCADE), user_id (FK auth.users ON DELETE CASCADE), is_online bool NOT NULL false, last_seen_at timestamptz NOT NULL now(), updated_at timestamptz NOT NULL now())`. UNIQUE `(conversation_id, user_id)`. In `supabase_realtime` publication (confirmed). RLS: read = participant-only (`EXISTS conversation_participants … user_id=auth.uid()`); INSERT/UPDATE = own row only (`auth.uid()=user_id`).

### F4.2 — How presence works today
- **Online state = a persisted row** upserted on conflict `(conversation_id,user_id)` via `upsertPresence` (`chatPresenceService.ts:18`). Heartbeat every 30s (`useChatPresence.ts:44,195`); AppState background → `markAllConversationsOffline` (`:48`, `:161`). Client-side stale guard: `is_online && now-updated_at < 60s` (`:75,138`).
- **Typing = broadcast only, NO DB write** via channel `presence:{conversationId}` events `typing_start`/`typing_stop` (`chatPresenceService.ts:101`; consumed `useChatPresence.ts:93,114`). Auto-expire 4s (`:42`).
- **Live wiring:** the hook subscribes the `presence:{id}` channel for both broadcast (typing) and `postgres_changes` on `conversation_presence` filtered `conversation_id=eq.{id}` (`:126`). Returns `{ participants, typingUsers, startTyping, stopTyping }`.

### F4.3 — Reusable for live support chat?
**Yes, as-is, IF support rides a real `conversations` row.** `useChatPresence({ conversationId, currentUserId })` is conversation-id-keyed and provider-agnostic — drop it into both the requester chat screen and the staffer chat screen and online/typing "just works," because the RLS read-gate is participant-membership (which the staffer will have once seeded, §2.2). Caveat: presence read RLS requires the viewer be a `conversation_participants` row — so the staffer must be a participant BEFORE presence is visible (same dependency as F2.2). No new presence table/code is needed for v1 live chat.

---

## 5. PUSH — exact fan-out

Files: `supabase/functions/notify-message/index.ts` (556), `notify-dispatch/index.ts` (567), `_shared/push-utils.ts` (240).

### F5.1 — Trigger
A message send calls `messagingService.sendPartitionedMessageNotifications` (`messagingService.ts:937,1483`), which invokes the **`notify-message`** edge fn (`:1497` for mentions, `:1549` `type:'direct_message'` for the rest). notify-message resolves recipients then calls **`notify-dispatch`** once per recipient (`callNotifyDispatch`, notify-message:78). notify-dispatch inserts the in-app `notifications` row AND sends the OneSignal push.

### F5.2 — Recipient resolution (notify-message)
`handleUnifiedMessage` (`notify-message:112`): loads the conversation row (`:122`, selects type/name/linked_entity_type/session_id/event_id), then queries `conversation_participants` `WHERE conversation_id=… AND user_id<>sender AND notifications_muted=false` (`:134-139`). So **`conversation_participants.notifications_muted=true` suppresses BOTH the push and the in-app row** for that recipient (they're filtered out before dispatch). Title/deeplink branch on group vs direct + linked_entity_type (`:146-154`). Deep link shape: `mingla://chat/{conv}?type=...` (consumer-app deep-link contract).

### F5.3 — notify-dispatch gating chain (in order)
1. Auth = Bearer service-role only (`:221`).
2. **Idempotency** — existing `notifications.idempotency_key` ⇒ short-circuit (`:264`).
3. **Rate limit** — >10 rows of same `type` for user in 5 min ⇒ skip (`:283`).
4. **Insert in-app `notifications` row** (`:329`). ⚠️ deep-link contract: caller MUST pass TOP-LEVEL `deepLink` or it is nulled (`:312-319`).
5. `skipPush` / no userId ⇒ stop after in-app row (`:382`).
6. **`notification_preferences` check** (`:393-426`) — see F5.5 (this is effectively dead against the live schema).
7. **Session mute** for `SESSION_SCOPED_TYPES` (`:437`) — looks up `session_participants.notifications_muted`. Not relevant to support (no session).
8. **Quiet hours** — 22:00–08:00 in user tz ⇒ skip push (`:471`). (DM bypass column was removed — `:472` comment.)
9. **Send push** via `sendPush` with `app: resolveOneSignalApp(type)` (`:500`).

### F5.4 — OneSignal call (`push-utils.ts`)
`sendPush` (`:95`) POSTs `https://api.onesignal.com/notifications` with `include_aliases.external_id=[targetUserId]` (= `auth.users.id`), `Authorization: Key {restKey}`. **Dual-app routing** (`resolveOneSignalApp`, `:52`): `type` starting `business.` or `stripe.` → **business** OneSignal app (`ONESIGNAL_BUSINESS_APP_ID`/`..._REST_API_KEY`); everything else → **consumer** app. **No cross-app fallback** — missing creds for the selected app ⇒ warn + return false (`:105`, SC-A2). Returns true only on a valid notification id with no errors.

### F5.5 — ⚠️ EXACT `notification_preferences` columns + the dead-gate contradiction (confirms & extends PROPOSAL §6.5 E3)
Live columns (boolean, one row per user, UNIQUE(user_id)): **`push_enabled, email_enabled, friend_requests, link_requests, messages, collaboration_invites, marketing, dm_bypass_quiet_hours, reminders`** (+ id, user_id, created_at, updated_at). Defaults: marketing=false, dm_bypass_quiet_hours=false, rest=true. **It is boolean-column-per-category, NOT per-(channel,type) rows** — §6.5 E3 confirmed.

**New forensic finding (F5.5b):** `notify-dispatch` reads this table as if it were **row-per-type** — it does `prefs.some(row => row.channel==='push' && row.type==='*' && row.opt_in===false)` (`:400`) and `row.type===type || row.type===prefKey` (`:413`). The live table has **no `channel`, `type`, or `opt_in` columns**. Therefore `row.channel`/`row.type`/`row.opt_in` are all `undefined`, every `.some()` predicate is `false`, and **the entire type-preference gate is a silent no-op today** — push delivery is currently gated only by idempotency + rate-limit + session-mute + quiet-hours + `conversation_participants.notifications_muted` (the F5.2 filter), NOT by `notification_preferences.messages`. This is a pre-existing latent bug, flagged for the SPEC: a "support_replies" preference would have to be wired into whichever model the SPEC chooses, because the current column-based table is not actually consulted by the dispatcher. The honest control that DOES work is the per-conversation `notifications_muted` flag (F5.2) and `push_enabled` is likewise not consulted by the dispatcher.

### F5.6 — Minimal change to push a "new support message"
- **To the requester (consumer app):** reuse the existing `type:'direct_message'`/`'message'` path verbatim — it already fans out to all non-muted `conversation_participants` minus sender (F5.2) and routes to the **consumer** OneSignal app (non-`business.`/`stripe.` type). If the requester is a participant of the support conversation, they already get the push. **Zero new push code** beyond the conversation existing.
- **To the assigned staffer ON THE BUSINESS APP:** the push MUST carry a `business.*` type (e.g. `business.support_message`) so `resolveOneSignalApp` routes it to the **business** OneSignal app (push-utils:52) AND so the business inbox's `type.like 'stripe.%' OR 'business.%'` filter renders it (F6.3). A consumer-typed message push would be delivered to the consumer app and be invisible to a staffer working the business console. So: add a `business.support_message` (and `business.support_new_case`) producer path. Because notify-message's existing handlers hard-code consumer types (`direct_message_received`/`board_message_received`), the cleanest minimal change is a **new branch/type in notify-message** (or a small dedicated `notify-support` producer) that emits `business.*` types for staffer recipients and the consumer type for the requester. The `notify-dispatch` + `push-utils` layers need **no change** — they already route by type prefix.
- Deep-link: staffer push needs a business-app route; `businessNotificationRouting.ts` switch (`:137`) has no support case → today falls to `ACCOUNT_FALLBACK` (`:160` default). Add a `business.support_*` case there.

---

## 6. BUSINESS APP messaging — shared or separate?

### F6.1 — Separate service layer, shared tables
The business app does **not** import app-mobile's `messagingService`/`realtimeService`. It has its own thin service `mingla-business/src/services/groupChatService.ts` (261 ln) reading/writing the **same** `conversations`/`messages`/`conversation_participants` tables directly: `getEventGroupChat` (`:50`), `postPlannerMessage` (`:82`, inserts into `messages`), `listMessages` (`:151`), `listParticipants` (`:168`), `setBroadcastOnly` (`:206`), `removeParticipant` (`:226`), `deleteMessage` (`:244`). So the business app **can already send into and read a conversation** with a few lines, gated by RLS.

### F6.2 — Business realtime = identical channel convention
`mingla-business/src/hooks/useEventGroupChat.ts:57` subscribes `supabase.channel('conversation:${conversation.id}')` with a `postgres_changes` INSERT binding on `messages` — **the exact same channel name and binding shape as app-mobile `subscribeToConversation`**. A staffer subscribed to a support conversation's `conversation:{id}` channel receives requester messages live with no new realtime infra. Other business realtime hooks: `useBusinessNotifications.ts` (notifications inbox channel), `useOrderRealtimeSubscription.ts`, `useEventWaitlist.ts`, `useBrandStripeStatus.ts` — all use the same `supabase.channel(...postgres_changes...)` pattern.

### F6.3 — Business notifications inbox is type-prefix-gated
`useBusinessNotifications.ts` reads `public.notifications` with `.or("type.like.stripe.%,type.like.business.%")` (`:137,263`) and subscribes a per-user `notifications` channel (`:82`). Strict-grep gate **I-PROPOSED-W** locks this filter (`:12`). Consequence (ties to F5.6): a support notification will only appear in the business inbox if its `type` is `business.*` (or `stripe.*`). The inbox isType-driven, single shared `notifications` table; the client prefix-filters at read time.

### F6.4 — Push identity parity
Both apps `OneSignal.login(userId)` with `auth.users.id` as external_id (consumer side + business `oneSignalService.ts:95 loginToOneSignal` + `optIn()`). So `sendPush(include_aliases.external_id=[userId])` resolves to whichever app(s) that user has installed — the **type prefix** (not a separate identity) decides which app receives it. A staffer who has the business app installed and logged in is reachable by a `business.support_message` push today, with no new device/token plumbing.

### F6.5 — RLS gap for staffer participation (the one real backend blocker)
Current conversation/message/participant RLS gates membership two ways only: (a) `is_conversation_participant(id, auth.uid())`, and (b) `is_conversation_brand_team_member(conversation_id, auth.uid())` — the latter resolves brand-team membership via `event_id → events.brand_id → brand_team_members` (see `conversations_brand_team_member_read` policy, scoped to `linked_entity_type IN ('trip','event') AND event_id IS NOT NULL`). **A support conversation has no event_id and no brand**, so the brand-team path does NOT apply. The staffer can therefore only read/write a support conversation if they are a `conversation_participants` row (path a). That row can only be created with elevated rights (F2.2: self-add is direct-only; brand-team-delete exists but no brand-team-add insert policy for arbitrary convs). **Net:** support needs a server-side (SECURITY DEFINER RPC or service-role edge fn) participant-seeding step that adds the assigned staffer; once seeded, send/subscribe/presence/push all work through the existing substrate unchanged.

---

## 7. WHAT SUPPORT CAN REUSE vs WHAT MUST BE ADDED

| Capability | Reuse as-is? | Evidence | What must be added |
|---|---|---|---|
| Message storage (`messages`) | ✅ Yes | F1.2, F1.5 — `text`/`image`/`file`/`system` all allowed | Nothing |
| Conversation row as the support thread | ⚠️ Partial | F1.4 — enum-constrained | DROP+ADD 3 CHECKs to admit `linked_entity_type='support'` (+ coherence branch w/ session_id & event_id NULL; + name rule decision) |
| Send a message | ✅ Yes | `sendMessage` F2.3 (app-mobile) / `postPlannerMessage` F6.1 (business) | Nothing |
| Subscribe to thread (realtime) | ✅ Yes | `subscribeToConversation` `conversation:{id}` F2.5; business identical F6.2 | Nothing (non-PK filter is safe, F3.2) |
| Create the conversation programmatically | ❌ No | F2.1 — only DM has a client mint path; groups are DB-owned | New RPC/trigger to mint the support conversation (`type='group'`+name OR `type='direct'`) |
| Seed the staffer as participant | ❌ No | F2.2 + F6.5 — self-add is direct-only; no insert policy for staffer | SECURITY DEFINER RPC / service-role fn to add assigned staffer; RLS to let staffer read/write support convs |
| Presence (online) | ✅ Yes | F4.1–F4.3 — `conversation_presence` + `useChatPresence`, participant-gated | Nothing (depends on staffer being a participant) |
| Typing indicator | ✅ Yes | F4.2 — `presence:{id}` broadcast, no DB | Nothing |
| Push to requester | ✅ Yes | F5.6 — existing consumer `message` path | Nothing (once requester is a participant) |
| Push to staffer (business app) | ⚠️ Partial | F5.6, F6.3, F6.4 — dual-app routing by type prefix | New `business.support_message`/`business.support_new_case` producer types; business router case (`businessNotificationRouting.ts`) |
| notify-dispatch / push-utils plumbing | ✅ Yes | F5.3–F5.4 — routes by type prefix, no change | Nothing |
| Per-recipient mute | ✅ Yes (the working one) | F5.2 — `conversation_participants.notifications_muted` | Nothing |
| `notification_preferences` opt-out | ❌ Broken today | F5.5b — dispatcher reads non-existent `channel/type/opt_in` columns; gate is a no-op | If a "support_replies" opt-out is wanted, FIRST fix/repoint the dispatcher to the boolean-column schema (pre-existing bug), then add the column/logic |
| In-app notification row | ✅ Yes | F5.3 step 4 — `notifications` table | Nothing (business inbox needs `business.*` type, F6.3) |

### Headline contradictions surfaced for the SPEC
1. **F1.4** — `linked_entity_type='support'` is NOT a free extension; it's a 3-CHECK DDL change. PROPOSAL §6.5 E2 understated this.
2. **F5.5b** — the `notification_preferences` push gate in `notify-dispatch` is **dead code** against the live boolean-column schema; any support opt-out must reckon with this pre-existing bug, not assume the table is consulted.
3. **F6.5** — the only real backend blocker is **staffer participant-seeding + RLS**; everything downstream (send/subscribe/presence/push) is reusable once the staffer is a participant. There is no existing self-serve or brand-team path to add a staffer to a brand-less support conversation.
