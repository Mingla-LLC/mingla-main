# INVESTIGATION — ORCH-0898 [Consumer collab session → Friends-tab group chat (shared thread, auto-roster, harmonized with ORCH-0897 trip group chat)]

**Skill:** Claude `mingla-forensics` — INVESTIGATE mode
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0898_COLLAB_GROUP_CHAT.md`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Date:** 2026-05-20
**Confidence:** HIGH (source-only — this is a code-audit / schema investigation, exempt from Prime Directive 7 live-fire requirement per dispatch §5; behaviour claims rest on read-and-cite of services, hooks, components, migrations, RLS policies, and edge functions in the shared checkout)

---

## §0 Phase 0 ingestion

| Source | One-line summary |
|---|---|
| `Mingla_Artifacts/milestones/Tr6_DISCUSSION_BOARD.md` | Operator-locked Tr6 milestone for **business-side** per-trip group chat — proposes NEW `event_threads` + `event_thread_messages` + `has_thread_access` SECURITY DEFINER helper + `trip_documents` storage bucket. Status "locked, not started". §10 names RLS as the highest-risk piece. |
| `~/.claude/projects/.../memory/feedback_rls_returning_owner_gap.md` | Pair every owner-callable mutation policy with a direct-predicate owner-SELECT. SECURITY DEFINER helpers fail in INSERT...RETURNING + soft-delete WITH CHECK contexts. ACTIVE post-ORCH-0734. |
| `~/.claude/projects/.../memory/feedback_solo_collab_parity.md` | Always fix solo + collab together. In this ORCH "solo" = DM, "collab" = group chat — both surfaces sit on the recommended substrate, both need parity. |
| `~/.claude/projects/.../memory/feedback_zustand_persist_no_server_snapshots.md` | I-PROPOSED-J ACTIVE — chat roster + messages are server state; must live in React Query, NOT persisted Zustand. |
| `Mingla_Artifacts/WORLD_MAP.md` lines 3–7 | ORCH-0898 + ORCH-0899 + ORCH-0897 INTAKE entries — confirms locked decisions: same-thread-two-views chat model (NOT mirrored copies), Model A re-openable session for ORCH-0899, no fourth substrate, harmonization across all three ORCHs is the central forensics question. |
| `supabase/migrations/20260505000000_baseline_squash_orch_0729.sql` | **The only migration touching `board_messages`, `conversations`, `conversation_participants`, `conversation_presence`, `collaboration_sessions`, `session_participants`** — confirmed via `grep -rln`. Migration-chain rule is satisfied trivially: there is nothing later to supersede. This file IS authoritative truth for the substrate. |
| `supabase/functions/notify-message/index.ts` | Unified push dispatcher for `direct_message` + `board_message` + `board_mention` + `board_card_message` + `direct_card_message` — fan-out via `session_participants` for board types. Already substrate-aware via a `type` discriminator. |
| Prior reports / specs / IA artifacts | **None.** `grep` on `reports/` and `specs/` for chat/messag/conv/discuss/collab/friend returned only `ORCH-0763F_SHARE_PREVIEW_POLISH_AND_DUPLICATE_IMESSAGE` (unrelated — share-preview link routing). This is greenfield from a forensics-artifact perspective. |

No prior investigation contradicts current findings. No previously-decommissioned table is referenced. No memory flags a stale assumption in the dispatch scope.

---

## §1 Operator symptom + locked decisions

Operator's words (from INTAKE 2026-05-20): "When a collaboration session is created, a group chat is also created in the friends tab, which is basically a copy of the discussions tab in a collaboration session, but works like the chats in the friends tab only its a group chat… When a new person joins they get added to the group chat."

Locked decisions in scope:
- **Chat model:** ONE substrate, TWO views (same thread surfaced both inside Session view and in Friends-tab list). NOT mirrored copies. NOT collapse-Discussions-into-Friends-only.
- **Persistence (cross-link to ORCH-0899):** Chat thread is **session-scoped**, NOT round-scoped — must outlive completion of any individual outing and span all future re-openable rounds.
- **No fourth substrate.** Recommend ONE substrate spanning collab-session group chat + Friends DMs + (per ORCH-0897 cross-link) trip-buyer group chat — or explicitly justify why three remain.

Not in scope for this report (recommend only, do not over-spec):
- Concrete migration SQL (SPEC owns this)
- Final RLS policy text (SPEC owns this, this report enumerates predicates)
- UI component changes (SPEC owns; this report names the seams)
- Attachments-in-v1 (recommend OUT of scope; see §12)

---

## §2 Substrate audit

The dispatch named "three chat substrates" — that framing is a simplification. The actual messaging surface area in the production schema is **15+ tables across 4 families**:

### §2.1 Family A — `board_*` (collab-session Discussions tab) — SHIPPED

Parent: `collaboration_sessions` (line 7951). Roster: `session_participants` (line 9658). Messaging:

| Table | Line | Purpose |
|---|---|---|
| `board_messages` | 7584 | Main session chat — `session_id`, `user_id` (nullable), `content`, `mentions` jsonb, `reply_to_id`, `image_url` (single image), `deleted_at` (soft-delete), `updated_at` |
| `board_message_reactions` | 7561 | `message_id` + `user_id` + `emoji` |
| `board_message_reads` | 7573 | `message_id` + `user_id` + `read_at` |
| `board_participant_presence` | 7601 | `session_id` + `user_id` + `is_online` + `last_seen_at` |
| `board_typing_indicators` | 7650 | `session_id` + `user_id` + optional `saved_card_id` + `is_typing` |
| `board_card_messages` | 7503 | **Per-card** discussion (cards in the swipe deck have their own message thread) — `session_id` + `saved_card_id` + `content` + `mentions` + `reply_to_id` + `deleted_at` |
| `board_card_message_reads` | 7492 | Reads for per-card messages |
| `board_threads` | 7635 | Reply threads — note `board_id` (NOT `session_id`), with optional `card_id` + `parent_id` — see §13 Discovery for the dormant-feature flag |

RLS pattern: `is_session_participant(session_id, auth.uid())` SECURITY DEFINER helper (line 5553) queries `session_participants`. INSERT WITH CHECK pairs `user_id = auth.uid() AND is_session_participant(session_id, auth.uid())`. SELECT USING pairs `deleted_at IS NULL AND is_session_participant(session_id, auth.uid())`. UPDATE / DELETE USING `user_id = auth.uid()` direct-predicate. **Helper-based SELECT in RETURNING context is a documented RLS-RETURNING-OWNER-GAP risk** — see §11.

### §2.2 Family B — `conversations` + `messages` (Friends-tab DMs) — SHIPPED

Parent: `conversations` (line 8006). Roster: `conversation_participants` (line 7981). Messaging:

| Table | Line | Purpose |
|---|---|---|
| `conversations` | 8006 | Parent — `type` varchar(20) DEFAULT `'direct'` with **CHECK `type IN ('direct', 'group')`** (line 8013), `created_by`, `last_message_at`. **The `'group'` enum value is already in the schema — pre-installed for groups but no production code reads or writes it today.** |
| `conversation_participants` | 7981 | `conversation_id` + `user_id` + `joined_at` + `last_read_at`. Simple two-column roster. |
| `conversation_presence` | 7993 | Online flags per (conversation_id, user_id) |
| `messages` | 8421 | Main DM table — `conversation_id`, `sender_id` (nullable), `content`, `message_type` varchar with CHECK `IN ('text', 'image', 'video', 'file', 'card')`, `file_url` + `file_name` + `file_size` (attachment metadata), `is_read` + `read_at`, `reply_to_id`, `card_payload` jsonb (ORCH-0667 shared-card), `deleted_at` |
| `message_reads` | 8410 | Per-recipient read tracking (independent of `is_read` flag — supports group reads naturally) |
| `direct_message_reactions` | 8115 | `message_id` + `user_id` + `emoji`. **Name says "direct" but schema is generic — would apply to group messages on the same table.** |

RLS pattern: `is_conversation_participant(conv_id, u_id)` SECURITY DEFINER helper (line 5494) queries `conversation_participants`. Policies inline the EXISTS subquery on participants directly for INSERT/SELECT (lines 14541, 14559, 14842, 14972, 14999) — NOT helper-based. UPDATE / DELETE on messages use `auth.uid() = sender_id` direct-predicate. **This pattern is structurally safer than Family A's helper-in-SELECT for RETURNING.**

### §2.3 Family C — `event_threads` + `event_thread_messages` (Tr6 trip group chat) — PROPOSED, NOT BUILT

From `Tr6_DISCUSSION_BOARD.md` §5:

| Table | Purpose |
|---|---|
| `event_threads` | One row per event/trip — `event_id` UNIQUE, `is_broadcast_only`, `is_enabled` |
| `event_thread_messages` | `thread_id` + `author_id` + `body` + `attachments` jsonb + `posted_at` + `edited_at` |

No reactions table. No reads table. No presence table. No typing indicators. No reply threading. No image_url. The Tr6 milestone is intentionally minimal — author + body + attachments + edit. RLS via new `has_thread_access(p_event_id)` SECURITY DEFINER helper checking `orders.status IN ('confirmed','paid','partially_paid')` OR `brand_team_members` (active: `accepted_at IS NOT NULL AND removed_at IS NULL`) of the event's brand. **[Correction 2026-05-21 per ORCH-0898 SPEC §1.4 + §10 #1: the actual table is `brand_team_members`, not `brand_members`. The original Tr6 milestone draft used the wrong name; this investigation inherited the error. ORCH-0898 SPEC §3.1 Step 6a/6b uses the correct name + active-membership predicate.]**

### §2.4 Family D — Social fabric (orthogonal — context for roster sync)

`friends` + `friend_requests` + `pair_requests` + `pairings` + `muted_users` + `blocked_users` + `collaboration_invites`. Surfaced here because the auto-roster-sync recommendation in §5 depends on understanding how membership writes propagate today. Critical artifact: `accept_friend_request_atomic` RPC (line 174) does NOT auto-create a `conversations` row — DM conversations are created **lazily** by `messagingService.getOrCreateDirectConversation` on first tap. See §5.

### §2.5 Side-by-side feature matrix (the audit deliverable)

| Feature | `board_messages` (Family A) | `messages` (Family B) | `event_thread_messages` (Family C, proposed) |
|---|---|---|---|
| **Roster substrate** | `session_participants` | `conversation_participants` | RLS-only via `has_thread_access` (no explicit roster table — derived from `orders` + `brand_team_members` [SPEC §1.4 corrects: original draft said `brand_members`]) |
| **Parent table** | `collaboration_sessions` | `conversations` (`type='direct'\|'group'`) | `event_threads` |
| **Soft-delete** | ✓ `deleted_at` | ✓ `deleted_at` | ✗ (Tr6 §8 explicitly forbids delete in v1) |
| **Edit** | ✓ `updated_at` | ✓ `updated_at` | ✓ `edited_at` |
| **Reply threading** | ✓ `reply_to_id` | ✓ `reply_to_id` | ✗ (Tr6 §9 defers to polish) |
| **Reactions** | ✓ `board_message_reactions` | ⚠ `direct_message_reactions` (name says "direct" but generic schema) | ✗ (deferred) |
| **Read receipts** | ✓ `board_message_reads` (per-user-per-message) | ✓ `message_reads` + denormalized `is_read` flag | ✗ (deferred) |
| **Typing indicators** | ✓ `board_typing_indicators` (DB-backed) | ✓ via realtime broadcast on `useChatPresence` (`session:<id>` channel naming) | ✗ |
| **Presence** | ✓ `board_participant_presence` | ✓ `conversation_presence` | ✗ |
| **Mentions** | ✓ `mentions` jsonb on board_messages | ✗ (not in messages schema) | ✗ |
| **Attachments** | ⚠ `image_url` text (single image only; bucket `board-attachments` line 158 of boardDiscussionService) | ✓ `file_url` + `file_name` + `file_size` + `message_type` enum (`image\|video\|file`) | ✓ `attachments` jsonb (proposed, new `trip_documents` bucket) |
| **Card-share (ORCH-0667)** | ✗ | ✓ `message_type='card'` + `card_payload` jsonb | ✗ |
| **Per-user mute** | ✓ `session_participants.notifications_muted` (ORCH-0520) | ✗ (no equivalent column on `conversation_participants`) | ✗ |
| **Two-step membership (invited / accepted)** | ✓ `session_participants.has_accepted` | ✗ (participant row = membership) | N/A (derived from `orders.status`) |
| **Realtime delivery** | dual postgres_changes + broadcast (`realtimeService.ts` line 473+) | postgres_changes only (per `useSessionDiscussion.ts` pattern reuse for DMs is partial; full path is in `messagingService` enrich) | proposed: postgres_changes via OneSignal trigger |
| **Push fan-out** | `notify-message` type=`board_message` + `board_mention` via `session_participants` | `notify-message` type=`direct_message` + `direct_card_message` via `conversation_participants` | proposed: new edge fn `post-thread-message` |
| **`type='group'` already supported by schema?** | N/A — single type | **YES, but unused in production** | N/A — single type |
| **Total tables in family** | 7–8 (`board_messages`, reactions, reads, presence, typing, card_messages, card_message_reads; `board_threads` dormant) | 6 (`conversations`, participants, presence, `messages`, message_reads, reactions) | 2 (proposed) |
| **LoC in service layer** | ~1075 (`boardMessageService` 901 + `boardDiscussionService` 174) | ~1076 (`messagingService` class) | 0 (not built) |

Three families exist. Family A is the most feature-rich at the message-level (mentions, single-image, dual realtime). Family B is the most feature-rich at the type-level (5 message types, card_payload, file attachments). Family C is the proposed minimal baseline.

---

## §3 Substrate recommendation

### §3.1 The decision

**Recommendation: option (iii) — Hybrid.** Use **`conversations`** as the canonical parent + Friends-tab list row. **Migrate `board_messages` into `messages`** linked by `conversation_id`. Family B becomes the unified substrate; Family A's helper tables (`board_message_reactions`, `board_message_reads`, `board_participant_presence`, `board_typing_indicators`) either merge into Family B's equivalents or are renamed/retained as `messages`-keyed siblings. **`event_threads` proposed in ORCH-0897 is RETIRED in favor of `conversations` with `type='group'` + a new `linked_entity_type`/`linked_entity_id` discriminator** — see §10 for ORCH-0897 convergence detail.

Confidence: HIGH. Backed by six structural facts:

1. **`conversations.type` already enumerates `'group'`** (line 8013) — the schema was pre-designed for this case. No NEW parent table is needed. No new CHECK constraint is needed.
2. **Family B's RLS pattern is structurally safer** than Family A's — Family B inlines the participant-EXISTS subquery directly in policies (lines 14541, 14842, 14972), avoiding the RLS-RETURNING-OWNER-GAP risk that Family A inherits via the `is_session_participant` SECURITY DEFINER helper.
3. **Family B's `messages` has the richer feature surface** (5 message types, card_payload, file metadata triplet) — easier to ADD `mentions` jsonb than to ADD all of message_type + file_url + card_payload to `board_messages`.
4. **`notify-message` is already unified** across both substrates with a type discriminator (line 25). Migrating board_message → message simplifies notify-message: one fan-out path via `conversation_participants` regardless of group-vs-direct.
5. **Friends-tab list integration is automatic** — `conversations` is the parent row that today's `ConnectionsPage` already reads via `messagingService.getConversations` (line 520 of messagingService). A `type='group'` row appears in the list with zero new list-query plumbing; only the list-item render needs the multi-avatar treatment (see §9).
6. **ORCH-0897 convergence is non-disruptive** — the Tr6 milestone is "locked, not started" (zero shipped code). Promoting it onto `conversations`+`messages` BEFORE it ships avoids building a parallel third substrate.

### §3.2 Why not option (i) — full migration of board_messages → messages with `board_messages` table dropped

Considered and rejected for v1: too aggressive. The 901-line `boardMessageService.ts` + 174-line `boardDiscussionService.ts` + 189-line `useSessionDiscussion.ts` + 5 discussion components all read `board_messages` directly via `.from('board_messages')`. A hard cutover requires 100+ touched files in app-mobile alone. **Recommend deprecation path**: SPEC ships option (iii) as the v1 destination, retains `board_messages` as a backing table aliased into the unified read API for the migration window, with a follow-up ORCH to drop `board_messages` once dual-read confirms zero-row drift. The hybrid lets ORCH-0898 ship in 2–3 weeks instead of 8–12.

### §3.3 Why not option (ii) — keep `board_messages`, project a virtual conversation row

Considered and rejected: the cognitive overhead of two messages substrates persists permanently; ORCH-0897 still ships a third substrate; the Friends-tab list-item render diverges (two code paths — read from `messages` for DMs, read from `board_messages` for groups); reactions diverge (`direct_message_reactions` for DMs, `board_message_reactions` for groups); push fan-out keeps two type discriminators in `notify-message`. Long-term debt without the long-term ROI.

### §3.4 Migration cost estimate

| Layer | Cost | Notes |
|---|---|---|
| **DB schema** | Low | New columns on `conversations` (`session_id` nullable FK, `event_id` nullable FK, `linked_entity_type` enum), new RLS policies on `conversations` + `messages` keyed to both `conversation_participants` AND derived membership (session_participants OR orders/`brand_team_members` [SPEC §1.4 correction]). 1 migration. |
| **DB data migration** | Medium | For each existing `collaboration_sessions` row with ≥1 `board_messages` row, create a `conversations` row of `type='group'` with `session_id=<id>` and `created_at=<session.created_at>`. For each `session_participants` row of that session, create a `conversation_participants` row. For each `board_messages` row, create a `messages` row with `conversation_id=<new>` and copy content+mentions+reply_to_id+image_url→file_url+message_type=image-if-image-else-text+timestamps. Per-row idempotent + dry-run + row-count assertions. Backup snapshot table `_archive_orch_0898_board_messages_pre_migration`. |
| **Edge functions** | Low | `notify-message` simplified: drop board_message / board_mention type discriminators, route everything through `direct_message` (rename to `message`) with fan-out via `conversation_participants`. `notify-dispatch` unchanged. |
| **Service layer (app-mobile)** | Medium | Replace `boardDiscussionService` calls in `useSessionDiscussion` with `messagingService.sendMessage`-equivalent group-aware calls. Mark `boardMessageService` for deprecation. Add `messagingService.getOrCreateGroupConversationForSession(sessionId)` (mirrors existing `getOrCreateDirectConversation`). |
| **Hook layer (app-mobile)** | Low | `useSessionDiscussion` becomes a thin wrapper over the same hooks DMs use (`useMessages`-replacement in `messagingService` — see §13 Discovery #2). |
| **Component layer (app-mobile)** | Medium-Low | `components/discussion/` MessageBubble + EmojiReactionPicker + EmptyDiscussion + SuggestionPopup + TypingIndicator can be retired in favor of `components/chat/` equivalents (which are richer); OR retained for visual differentiation. **Recommend retire** — one bubble component, one reaction picker, one typing indicator across DM + group. |
| **Friends-tab list integration** | Low | `ConnectionsPage` + `ChatListItem` already render `conversations`; group rows get a multi-avatar header + session-name title. No new list-query. |
| **`board_card_messages` (per-card chat)** | Out of scope | Per-card discussion is a separate feature (cards in deck); leave Family A's `board_card_messages` alone for v1. Future ORCH can promote into `messages` with `card_payload.context.savedCardId`. |
| **ORCH-0897 retargeting** | Low-Medium | Tr6 milestone re-scoped: same `conversations`+`messages` substrate, new `event_id` FK + `linked_entity_type='trip'` + `is_broadcast_only` column. `trip_documents` storage bucket separate (this report's recommendation does NOT change the bucket choice). Critical security test "cross-trip read returns zero rows" satisfied by the same `is_conversation_participant(...)` pattern. |
| **Total** | Medium | 2–3 weeks for v1 ship (option iii); option (i) full cutover deferred to follow-up ORCH. |

### §3.5 Rollback story

**If a post-ship bug surfaces in the unified substrate within the 14-day window:**

1. Backup snapshot table `_archive_orch_0898_board_messages_pre_migration` is queryable for content recovery.
2. Re-enable read-path on `board_messages` via a feature flag the client checks at startup (`app_config.use_legacy_board_messages_read = true`). Mobile clients dual-read for one release cycle.
3. New writes still go to `messages` (so no split-brain on the write side); only reads fall back.
4. Cancel substrate promotion of ORCH-0897 — Tr6 can revert to building its own `event_threads` if necessary.

The rollback is read-path-only because writes are forward-flowing and a write-rollback would lose new group-chat content. This is acceptable risk profile for the ship.

---

## §4 Access-path enumeration with RLS predicates

For the recommended substrate (option iii — `conversations` + `messages` extended to support groups linked to sessions / trips), every access path MUST enforce the predicates below. These are the contracts the SPEC's CREATE POLICY statements will codify.

Notation: `cur := auth.uid()`. `conv := conversations.id`. `s := conversations.session_id` (NULL for direct/trip). `e := conversations.event_id` (NULL for direct/session). `t := conversations.linked_entity_type` (`'direct' | 'session' | 'trip'`).

### §4.1 SELECT (read history)

| Access path | Predicate |
|---|---|
| Member reads own conversation list | `cur IN (SELECT user_id FROM conversation_participants WHERE conversation_id = conv)` |
| Member reads conversation row | Same as above |
| Member reads messages in conversation | `messages.deleted_at IS NULL AND <participant check above>` |
| Non-member attempts read | Predicate fails → zero rows returned (RLS-correct; never throws) |
| Cross-session/cross-trip attempt | Same as non-member — different `conv` value, no participant row, zero rows |
| Mention-only access (user not in roster but `@mentioned`) | **Not granted** — mentions do not bypass roster. SPEC may add later via mention-driven invite. |
| Read after leaving session | If on session-leave we DELETE the `conversation_participants` row → no access. If we RETAIN the row with a `left_at` timestamp → still access until `left_at` filter is added. Open question Q1 — recommend DELETE the row (auto-leave default). |

### §4.2 INSERT (post message)

| Access path | Predicate |
|---|---|
| Member writes own message | `sender_id = cur AND cur IN (SELECT user_id FROM conversation_participants WHERE conversation_id = conv)` — same shape as `messages` INSERT policy line 14842 |
| Broadcast-only group (Tr6 case) | `sender_id = cur AND <participant check> AND (NOT conversations.is_broadcast_only OR cur IN (SELECT btm.user_id FROM brand_team_members btm JOIN events e ON e.brand_id = btm.brand_id WHERE e.id = conversations.event_id AND btm.accepted_at IS NOT NULL AND btm.removed_at IS NULL))` — branches on `t='trip'`. Trip-buyer writes in broadcast mode FAIL; trip-brand-team-member writes SUCCEED. [SPEC §1.4 correction: `brand_team_members`, not `brand_members`.] |
| Non-member attempts write | Predicate fails → RLS violation, error returned to client |
| Spoofed `sender_id` (write as another user) | `sender_id = cur` blocks |
| Write after leaving session | Same as read — participant row gone → predicate fails |

### §4.3 UPDATE (edit own message)

| Access path | Predicate |
|---|---|
| Member edits own message | `sender_id = cur` direct-predicate WITH CHECK `sender_id = cur` — mirrors existing `messages` policy line 14894 |
| Edit window | SPEC decision — recommend no DB enforcement, UI-only 15-min cutoff via `created_at + interval '15 minutes' > now()` client gate |

### §4.4 DELETE (soft-delete own message)

| Access path | Predicate |
|---|---|
| Member soft-deletes own message | `sender_id = cur` (existing `messages` DELETE policy line 14609 enforces this, deletes by `auth.uid() = sender_id`). Soft-delete via SET `deleted_at = now()` UPDATE (preferred — preserves audit trail). |
| For v1 of group chat | **Recommend forbid delete on group messages** (mirror Tr6 §8 hard guard) — operator decides in SPEC |

### §4.5 Roster-write paths

| Access path | Predicate |
|---|---|
| User adds self to conversation (existing direct-DM path) | `user_id = cur` — line 14541 |
| Trigger / RPC adds user on session-join | SECURITY DEFINER trigger fires on `session_participants` INSERT → INSERT into `conversation_participants` for the linked group conversation. SECURITY DEFINER bypasses RLS for the cascade. |
| User leaves conversation | UPDATE own `conversation_participants` row (line 14898) OR DELETE — direct-predicate `user_id = cur` |
| Removed by host (no host-remove power exists today) | TBD — recommend NO host-remove in v1; mirror absence of host-remove on `session_participants` |

### §4.6 Realtime read access

Supabase Realtime evaluates RLS for postgres_changes subscribers. The same SELECT predicate above gates realtime delivery. Broadcast channels (the `board_message`-event broadcast on line 488 of realtimeService) do NOT evaluate RLS — they fan out to anyone on the channel name. **The SPEC must ensure broadcast channel names are conversation-scoped (`conversation:<id>`) so non-members cannot subscribe by guessing channel names** — verify the broadcast topology in SPEC.

### §4.7 Critical security test (mirror Tr6 §7 / §10)

Independent test: sign in as User C who has NEVER been added to session S or conversation Conv. Attempt:
- `SELECT * FROM messages WHERE conversation_id = '<S>'` → expect zero rows
- `SELECT * FROM conversations WHERE id = '<S>'` → expect zero rows
- `INSERT INTO messages (conversation_id, sender_id, content) VALUES ('<S>', '<C>', 'X')` → expect RLS violation
- `INSERT INTO conversation_participants (conversation_id, user_id) VALUES ('<S>', '<C>')` — must FAIL because RLS line 14541 requires either `user_id = auth.uid()` (yes for self-add) OR an existing participant inviting. For self-add to a session-linked conversation, the additional check `conversations.type='group'` should NOT permit self-add — only session-join trigger should mint participant rows for groups. **SPEC must lock down: self-add to `type='group'` conversation is FORBIDDEN; roster sync is server-side trigger-driven only.**

---

## §5 Auto-roster sync mechanism

### §5.1 Current state — DMs

`conversation_participants` is written by `messagingService.getOrCreateDirectConversation` (line 281) on lazy first-tap. Flow: User A taps "Message" on User B's profile → service queries existing direct conversation between A+B → if absent, inserts `conversations` row + two `conversation_participants` rows (A, B). No trigger; pure service-layer.

`accept_friend_request_atomic` (line 174) does NOT create conversations. Friend acceptance gates messaging access but does not eagerly create rows.

### §5.2 Current state — collab sessions

`session_participants` is written by:
- Session creation (caller inserts self with `is_admin=true, has_accepted=true` — pattern in `collaboration_sessions` create flow, not traced fully but inferred from RLS `cs_insert` line 15654)
- `add_friend_to_session(p_session_id, p_friend_user_id)` SECURITY DEFINER RPC (line 367, ORCH-0666)
- `collaboration_invites` acceptance flow (not fully traced — `accept_session_invite`-like RPC likely exists)

There is NO trigger today that mirrors `session_participants` INSERT into `conversation_participants` — the two are completely independent.

### §5.3 Recommended sync mechanism (for SPEC)

**Trigger-based, SECURITY DEFINER:**

```sql
-- Schematic only — SPEC owns the SQL.
CREATE TRIGGER mirror_session_participant_to_conversation
  AFTER INSERT ON session_participants
  FOR EACH ROW
  WHEN (NEW.has_accepted = true)
  EXECUTE FUNCTION sync_session_member_to_conversation();

-- And on session creation, eager-create the group conversation:
CREATE TRIGGER ensure_group_conversation_on_session_create
  AFTER INSERT ON collaboration_sessions
  FOR EACH ROW
  EXECUTE FUNCTION create_group_conversation_for_session();
```

The trigger fires only when `has_accepted=true` flips — so invited-but-not-accepted users do NOT see chat. (See §13 Discovery #6 — the current `is_session_participant` helper DOES include not-yet-accepted, which is arguably a bug; the SPEC has a chance to tighten this in the new substrate without regressing the old.)

Pros: atomic with session-join, no app-layer dual-write, no race window.

Cons: SECURITY DEFINER triggers can be hard to debug. Mitigate with logging table + idempotency assertion (`ON CONFLICT DO NOTHING` on `conversation_participants`).

**Alternative considered and rejected:** app-layer dual-write from `add_friend_to_session` — fragile, doesn't cover `collaboration_invites.accept` paths, doesn't run for the session creator (who is added by a different code path).

### §5.4 Race-condition risk

A user joins session at T0 (writes `session_participants` row), and before the trigger fires + commits writes `conversation_participants`, the user writes a `messages` row at T0+ε. The RLS check on messages.INSERT calls `is_conversation_participant`, which evaluates STABLE snapshot at the start of the INSERT transaction. If the trigger ran in the same transaction as session-join (recommended), the snapshot includes the new participant row. If the trigger ran in a separate transaction, the message INSERT might see no participant row and reject with RLS violation.

**Mitigation:** make the trigger AFTER INSERT in the SAME transaction (default for triggers) — no separate transaction. Verified safe.

---

## §6 Realtime + push fan-out

### §6.1 Realtime

`realtimeService.ts` (line 473+) shows the existing collab pattern: per-session channel `discussion:<id>` (per `useSessionDiscussion.ts:44`) — both `postgres_changes` on `board_messages` filtered by `session_id` (line 479) AND `broadcast` event `board_message` (line 488) for instant delivery. Postgres_changes is reliable but ~500ms latency; broadcast is ~50ms but lossy. Dual-path with client-side dedup-by-id. Sophisticated pattern that MUST be preserved.

DM path uses the same `messagingService.enrichMessageRealtime` (line 964 of messagingService.ts) — fewer broadcast hooks but similar postgres_changes filter on `messages.conversation_id`.

**On the unified substrate:**
- Channel naming becomes `conversation:<conv_id>` uniformly (replaces `discussion:<session_id>` for groups).
- postgres_changes filter: `table=messages, filter=conversation_id=eq.<conv_id>` — works for both direct and group.
- broadcast: `messages` event on `conversation:<conv_id>` — same pattern as today's `board_message` broadcast.
- Subscription topology: each member opens ONE channel per conversation. For a member of N conversations: N channels. Same as today's DM behavior.

Known caveat (carried forward from `useSessionDiscussion.ts:58-60` comment): satellite tables (`board_message_reactions`, `board_message_reads`) lack a `session_id` column → realtime subscription gets ALL changes app-wide, invalidates ALL discussion queries per reaction across the entire app. The unified substrate's `direct_message_reactions` + `message_reads` have the same shape (only `message_id`, no `conversation_id`). **Hidden flaw documented for SPEC: consider denormalizing `conversation_id` onto reactions + reads tables to enable Supabase-level filtering.**

### §6.2 Push fan-out

`supabase/functions/notify-message/index.ts` already unifies push across the 5 message-types. Current type discriminator at line 25:
```
type: "direct_message" | "board_message" | "board_mention" | "board_card_message" | "direct_card_message"
```

Recipient list query at line 154 (`from("session_participants")`) for board types; `conversation_participants` for direct types. Per-user mute respected via `session_participants.notifications_muted` (ORCH-0520).

**On the unified substrate:**
- Discriminator collapses to: `message` (with `card_payload IS NOT NULL` derivation for "shared a card") + `message_mention`.
- Recipient list: ONE query — `SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != sender_id`.
- Mute: needs `conversation_participants.notifications_muted` BOOLEAN column added (mirrors `session_participants.notifications_muted` — preserves the existing UX of per-conversation mute via BoardSettingsDropdown).
- Push template: existing OneSignal template parameterized by `conversation.type` (direct uses sender name; group uses "<sender> in <session/trip name>"). Single template path, conditional copy.

### §6.3 Push storm risk

User in 10 active sessions + 5 active DMs = 15 conversations each potentially pushing. Existing mute is per-conversation (after addition above). Recommend SPEC adds a follow-up ORCH for "do not disturb" hours (out of v1).

---

## §7 Discussions-tab feature regression check

Every feature today's Discussions tab supports must continue to work after the migration. Status verdicts:

| Feature | Source | Preservation verdict | Notes |
|---|---|---|---|
| Text message send | `boardDiscussionService.sendMessage` line 67 | ✓ Preserved | `messages.message_type='text'` + `content` |
| Image attachment | `boardDiscussionService.uploadMessageImage` line 145 + `image_url` column | ✓ Preserved | Map `image_url` → `messages.file_url` + `message_type='image'`. `board-attachments` bucket retained or migrated to `chat-attachments`. |
| Mentions | `board_messages.mentions` jsonb | ⚠ Needs schema add | Add `mentions` jsonb column to `messages` (or store in `card_payload` style sibling column). SPEC owns. |
| Reply / quote | `board_messages.reply_to_id` | ✓ Preserved | `messages.reply_to_id` already exists |
| Edit own | RLS UPDATE | ✓ Preserved | `messages` UPDATE policy line 14894 |
| Soft-delete own | RLS DELETE + `deleted_at` | ✓ Preserved | `messages.deleted_at` exists |
| Reactions | `board_message_reactions` | ⚠ Migrate | Rename `direct_message_reactions` → `message_reactions` (generic) OR retain dual tables. Recommend rename + UNION view for v1, drop `direct_message_reactions` in follow-up ORCH. |
| Read receipts | `board_message_reads` (per-recipient) | ✓ Preserved | `message_reads` (line 8410) has same shape (`message_id` + `user_id` + `read_at`) |
| Typing indicators | `board_typing_indicators` + broadcast | ✓ Preserved | Switch to `useChatPresence({ conversationId: 'conv:<id>' })` — existing helper is already conversation-id-keyed (line 96 of useSessionDiscussion). |
| Online presence | `board_participant_presence` | ✓ Preserved | `conversation_presence` (line 7993) has same shape. |
| Push notifications | `notify-message` type=`board_message`/`board_mention` | ✓ Preserved | Unified to `message` type post-migration. |
| Per-user mute | `session_participants.notifications_muted` (ORCH-0520) | ⚠ Needs migration | Add `conversation_participants.notifications_muted` BOOLEAN DEFAULT false. Backfill from session_participants where `type='group'`. |
| Discussion tab UI | `BoardDiscussionTab` (referenced from SessionViewModal line 795) + `components/discussion/*` | ✓ Preserved | Tab now reads from `messages` via `messagingService` instead of `boardDiscussionService`. Components remain (or retire in favor of `components/chat/*` which are richer — operator decision). |
| Friends-tab DM features | `components/chat/*` + `messagingService` | ✓ Preserved (parity) | No regression — DMs unchanged in shape, just new sibling `type='group'` conversations appear in the list. |
| Empty state | `EmptyDiscussion.tsx` | ✓ Preserved | Render unchanged; container is the new group-conversation view. |
| Suggestion popup (auto-complete) | `SuggestionPopup.tsx` | ✓ Preserved | Component unchanged; consumed by the new container. |

**No feature regresses.** Adding `mentions` jsonb to `messages` (or storing in a sibling column) is the only schema gap; everything else has a structural counterpart in Family B.

---

## §8 Roster lifecycle edge cases

Recommendations the SPEC must lock:

| Edge case | Recommendation |
|---|---|
| User voluntarily leaves the collab session | DELETE `session_participants` row → trigger DELETEs `conversation_participants` row → user loses read + write immediately. NO retain-read-only-history mode for v1 (simpler, mirrors Slack default). |
| User removed by host (no host-remove today on `session_participants`) | Not in v1 scope — preserve current behavior (no host-remove). |
| User blocks another member | Existing `blocked_users` table. SPEC adds UI to hide their messages client-side. No DB hide (RLS would be expensive). |
| User deletes account | Existing `account_deletion_requests` table. Their `messages` rows get `sender_id` NULLed (existing nullable column); display as "(deleted user)" — mirror current behavior. |
| Last member leaves the session | session_participants empty → session becomes orphan. Recommend: conversation row retained for the host's history; `is_enabled=false` on session marks it inactive. SPEC decides. |
| Session cancelled (status='archived') | Chat retained — read-only for last members. UPDATE policy on `messages` adds `conversations.is_locked` gate. |
| Group chat with single member (host) | Allowed — host can see the empty chat with no other members. Mirrors creating a Slack channel and not inviting anyone. |
| Invited-but-not-accepted (`has_accepted=false`) | Recommend EXCLUDE from chat until accept. Trigger fires only WHEN `has_accepted=true`. Tightens vs current `is_session_participant` behavior — see §13 Discovery #6. |

---

## §9 Friends-tab chats list integration

### §9.1 Current Friends-tab list

`app-mobile/src/components/ConnectionsPage.tsx` line 31 imports `messagingService`. Line 405 holds `conversations: Conversation[]` state. Line 593: derives per-conversation pair status for star buttons. Line 633: sorts by most-recent message. Line 705: fetches via `messagingService.getConversations(userId)` with a hard 10-second timeout (line 693 comment cites the "4N sequential queries" known perf issue). Line 53 imports `ChatListItem` which is the row renderer.

### §9.2 Group conversation in the list

The list query already returns all conversations the user participates in. Adding `type='group'` conversations is automatic — they show up in the list with zero new query plumbing. The list-item shape needs:

| Slot | Direct DM render today | Group render (proposed) |
|---|---|---|
| Avatar | Single avatar (the other participant) | Multi-avatar stack (top 3 participants) |
| Title | Other participant's display name | `conversations.name` if set, else fall back to session name (`collaboration_sessions.name` JOIN), else "Group chat" |
| Subtitle / last message | Sender's name prefix + message preview | Same — `<senderName>: <preview>` |
| Unread badge | `is_read=false` count | Same — `message_reads` per-user-per-message |
| Timestamp | Last message timestamp | Same — `conversations.last_message_at` |
| Star (pair) | Existing pair-status star | Hidden for groups |

`ChatListItem.tsx` needs a `conversation.type` branch — Section 5 of the SPEC.

### §9.3 Sort order

Today: most-recent message first. Groups slot in naturally — `conversations.last_message_at` updates on every new message in any conversation, so group activity bubbles to the top alongside DMs. Recommend no change.

### §9.4 Empty state

Today: when zero conversations, ConnectionsPage shows an empty state. With groups, the empty state changes wording from "Start a chat with a friend" to "Start a chat with a friend or create a group". SPEC owns the copy.

---

## §10 ORCH-0897 + ORCH-0899 cross-link

### §10.1 ORCH-0897 [Tr6 Discussion Board / per-trip group chat] convergence

**Recommendation: RETIRE the `event_threads` + `event_thread_messages` substrate. Promote Tr6 onto the unified `conversations` + `messages` substrate** with the following deltas to the Tr6 milestone:

| Tr6 milestone item | Unified-substrate equivalent |
|---|---|
| `event_threads.event_id UNIQUE` | `conversations.event_id` nullable + UNIQUE partial index `WHERE linked_entity_type='trip'` |
| `event_threads.is_broadcast_only` | `conversations.is_broadcast_only` boolean |
| `event_threads.is_enabled` | `conversations.is_enabled` boolean (mirror) |
| `event_thread_messages.author_id, body, attachments, posted_at, edited_at` | `messages.sender_id, content, file_url+message_type+card_payload, created_at, updated_at` — direct mapping, NO new table |
| `has_thread_access(p_event_id)` SECURITY DEFINER helper | RLS predicate on `conversations` / `messages` checks: `cur IN (SELECT user_id FROM conversation_participants WHERE conversation_id = conv) OR EXISTS (SELECT 1 FROM brand_team_members btm JOIN events e ON e.brand_id = btm.brand_id WHERE e.id = conversations.event_id AND btm.user_id = cur AND btm.accepted_at IS NOT NULL AND btm.removed_at IS NULL)`. Brand-team-members are not in `conversation_participants` but get access via the OR-branch. [SPEC §1.4 correction: `brand_team_members`, not `brand_members`.] |
| Auto-create thread on first booking | Trigger on `orders` INSERT/UPDATE WHERE `status IN ('confirmed','paid','partially_paid')` → ensure conversation exists + INSERT conversation_participant for buyer |
| `trip_documents` storage bucket | UNCHANGED — orthogonal to substrate decision; documents are file metadata stored in `messages.card_payload` style sibling jsonb OR a separate `event_documents` table outside chat. Recommend separate table for cleaner separation between "chat attachment" and "official document" — but this is Tr6 scope, not ORCH-0898. |
| `event_thread_messages` UNIQUE constraint on `(thread_id, posted_at DESC)` | `messages` already has index by `(conversation_id, created_at DESC)` per existing migrations. |
| Tr6 §7 critical security test (cross-trip read → zero rows) | Satisfied by identical `is_conversation_participant` predicate pattern. SAME test passes for ORCH-0898 cross-session + Tr6 cross-trip. |
| Broadcast-only RLS branch | Encoded in INSERT WITH CHECK — see §4.2 broadcast-only row. |

**Critical justification:** Tr6 milestone is "locked, not started" — zero shipped code. Retargeting it onto the unified substrate BEFORE Tr6 ships is the lowest-friction moment to converge. If Tr6 ships first on `event_threads`, ORCH-0898 becomes the substrate-consolidator and must run a SECOND migration to fold `event_thread_messages` into `messages` later — strictly more work for the same end state.

**Recommend the orchestrator escalate this to the operator** before either ORCH-0897 SPEC or ORCH-0898 SPEC begins. If operator confirms the convergence, both ORCHs share the SPEC and a single migration. If operator rejects (e.g., timeline pressure to ship Tr6 with its locked schema), ORCH-0898 proceeds on the hybrid without Tr6 convergence and a follow-up cleanup ORCH gets queued.

### §10.2 ORCH-0899 [Plan another outing — re-openable rounds, Model A] cross-link

**Confirmation: chat persists across all rounds.** The unified substrate keys chat by `conversations.id` linked to `conversations.session_id` (the parent collaboration session id) — NOT by round id. When ORCH-0899 introduces a `collaboration_session_rounds` (or similar) table, rounds reference the parent session, but the conversation row stays linked to the session_id parent. Round transitions can post system messages to the chat (`messages` with `sender_id IS NULL` + a `message_type` like `'system'` or a `card_payload.kind='round_started'` payload — SPEC chooses).

This satisfies the locked decision "chat persists across the full session lifecycle including future rounds."

Implication for ORCH-0899 schema design: the round table inherits from the session, not the chat. The chat is round-agnostic — exactly the property the operator locked.

---

## §11 Risk register (top 10)

| # | Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|---|
| 1 | **Data migration corrupts existing collab conversations** (board_messages → messages mapping loses content, mentions, or reactions) | S1-high | Medium | Dry-run with `ROLLBACK` first. Backup snapshot table. Per-row idempotent. Row-count assertions BEFORE drop. Feature-flag rollout for 1 release cycle. |
| 2 | **RLS-RETURNING-OWNER-GAP recurrence** if the new RLS uses SECURITY DEFINER helpers in SELECT — INSERT...RETURNING fails per `feedback_rls_returning_owner_gap.md` | S1-high | Medium | Per memory: pair every owner-callable INSERT/UPDATE policy with a direct-predicate owner-SELECT. Inline the participant-EXISTS subquery (Family B pattern), NOT the SECURITY DEFINER helper. |
| 3 | **Realtime channel-name guessing** lets non-members eavesdrop via broadcast channels (broadcast doesn't evaluate RLS) | S0-critical (security) | Low | Channel names use UUIDs (`conversation:<uuid>`); UUIDs are unguessable. Verify Supabase broadcast doesn't allow channel-list enumeration by non-authenticated users. SPEC's security test must include broadcast-eavesdrop attempt. |
| 4 | **Roster sync race** — message INSERT runs before trigger commits the participant row → RLS rejects | S1-high | Low | Trigger runs in SAME transaction as session-join INSERT (AFTER INSERT default behavior). Transaction snapshot includes new participant row. Verified safe. |
| 5 | **Mention jsonb migration data loss** — `board_messages.mentions` not copied to a new `messages.mentions` column | S2-medium | Medium | Schema MUST add `mentions` jsonb to messages BEFORE the migration runs. Backfill in the same transaction. |
| 6 | **React 18 batching trap** in chat roster updates per `feedback_solo_collab_parity` discoveries — setState on `useState` for participant list races with realtime invalidate | S2-medium | Medium | Use `useRef` pattern for any in-flight roster mutation; rely on React Query as the single source of truth. No persisted Zustand snapshot (I-PROPOSED-J). |
| 7 | **Push fan-out doubles** — both old `board_message` type and new unified `message` type fire during migration window | S2-medium | High during window | Feature-flag the type discriminator in `notify-message`. Single source of truth via `conversations.type`. |
| 8 | **DM regression** — touching `messages` schema affects existing DM behavior (typing indicator, presence, read receipts) | S1-high | Medium | Solo+collab parity rule: every test must verify DM behavior didn't regress AFTER adding group-chat support. Tester writes adversarial tests on the DM happy paths. |
| 9 | **`is_conversation_participant` helper used in any new RLS** repeats the RLS-RETURNING-OWNER-GAP — same pattern as risk #2 but for the unified substrate | S1-high | Low if SPEC follows recommendation | SPEC explicitly forbids SECURITY DEFINER helper in SELECT policies on `messages` + `conversations` — inline the subquery (Family B current pattern). |
| 10 | **ORCH-0897 ships first on event_threads** before this report's substrate decision is operator-approved → two migrations needed | S2-medium | Medium | Orchestrator MUST escalate the convergence question to operator BEFORE either SPEC begins. Block both SPECs until operator decides. |

Bonus (P3): append-only test contract per ORCH-0840 [Regression-test enforcement + append-only CI] — any test modification needs `[TEST-MOD-APPROVED ORCH-0898]` commit-body token.

---

## §12 Open questions for SPEC (not blocking INTAKE)

| # | Question | Recommendation (for SPEC to confirm / override) |
|---|---|---|
| Q1 | On session-leave, does the user auto-leave chat or retain read-only history? | **Auto-leave** (DELETE conversation_participants). Simpler, mirrors Slack. Read-only-history is a v2 polish. |
| Q2 | Can non-members of a collab session be invited to its group chat (mixed-membership)? | **No.** Roster strictly mirrored to `session_participants`. v2 might add "guest" mode if requested. |
| Q3 | Does the session host have moderator powers in chat (remove member, edit anyone's message, pin)? | **No moderator powers in v1.** Host-remove from session is already absent today on `session_participants`; chat inherits absence. Pin is a v2 polish. |
| Q4 | Chat name: defaults to session name; is rename allowed, by whom? | **Default to `collaboration_sessions.name`.** Editable by host only via existing session-rename flow. SPEC adds `conversations.name` column (DM uses derived name from participants; group uses explicit `name`). |
| Q5 | Is message edit allowed for v1? Delete? | **Edit yes (15-min window UI-only).** **Delete NO for v1** (mirror Tr6 §8). Both retained in schema (`updated_at`, `deleted_at`) for v2. |
| Q6 | Attachments in v1? | **Images only** (preserve current Discussions-tab feature). **Files / videos / cards defer to v2.** Tr6's documents bucket is orthogonal — separate decision. |
| Q7 | What is `conversations.name` for direct conversations? | NULL — derived from participants. Recommend SPEC adds CHECK `(type='group' AND name IS NOT NULL) OR type='direct'`. |
| Q8 | OneSignal push template — same as DM or separate? | Same template, conditional copy: DM → "<sender>: <preview>"; group → "<sender> in <group name>: <preview>". One edge function path. |
| Q9 | What happens to `board_messages` table post-migration cutover? | Retain for 1 release cycle as backup snapshot. Drop in follow-up ORCH after dual-read verification. SPEC names the follow-up. |
| Q10 | Does ORCH-0899 round-start post a system message to chat? | **Yes** — `sender_id IS NULL` + `card_payload.kind='round_started'`. UI renders as system message ("[host] is planning another outing — tap to join"). |
| Q11 | Member roster lifecycle on session `status='completed'` vs `'archived'` | `completed`: chat stays active (round-aware — supports ORCH-0899). `archived`: chat read-only via `conversations.is_locked=true`. SPEC adds column. |
| Q12 | OneSignal payload for group chat needs different deep-link than DM? | Yes — DM deeplink: `mingla://chat/<conv>?type=direct`; group deeplink: `mingla://chat/<conv>?type=group&sessionId=<s>` (so the app can route to either Friends-tab list or in-session view). SPEC owns. |

---

## §13 Discoveries for orchestrator

Findings outside ORCH-0898 scope that the orchestrator should consider registering as separate ORCHs OR carrying as informal follow-ups:

1. **🟡 Two parallel collab-chat services (boardMessageService + boardDiscussionService).** `app-mobile/src/services/boardMessageService.ts` (901 LoC, class-based) and `app-mobile/src/services/boardDiscussionService.ts` (174 LoC, function-based) both write `board_messages`. Pre-existing duplication independent of ORCH-0898. The 901-line file appears to be the older / richer one; the 174-line file is the slimmer one consumed by `useSessionDiscussion`. **Recommend separate ORCH:** consolidate to one service post-substrate-migration (becomes trivial because both retire in favor of `messagingService`).

2. **🟡 `useMessages.ts` hook is documented dead code.** `app-mobile/src/hooks/useMessages.ts` line 1-14 carries an explicit `@deprecated` JSDoc saying "DO NOT CALL THIS HOOK FROM ANY COMPONENT" — `fetchMessages()` runs 60+ serial Supabase round-trips per render, would cause infinite spinner. The `Conversation` and `Message` TYPE exports are still imported by `ConnectionsPage.tsx` and `ChatListItem.tsx` pending a migration to `types/messaging.ts`. **Recommend separate ORCH:** extract types to `types/messaging.ts`, delete the hook body, ship in 1 PR.

3. **🟡 `messagingService.getConversations` has a known 4N sequential round-trips perf issue with a 10s hard timeout.** `ConnectionsPage.tsx` line 693 comment cites: "messagingService.getConversations runs 4N sequential ... [without timeout] block would never fire, leaving conversationsLoading stuck at true forever." Friends-tab DM list slow load is a pre-existing UX hazard. Adding group conversations to the same list will compound the cost (more rows → more queries). **Recommend follow-up ORCH BEFORE ORCH-0898 ships:** refactor `getConversations` to a single JOINed query with pre-aggregated last-message + unread-count. The 4N pattern is fixable in ~100 LoC.

4. **🟡 Satellite tables (reactions + reads) lack parent-id denormalization, causing app-wide realtime invalidation.** Per `useSessionDiscussion.ts:58-60` comment: "reactions and read_receipts subscriptions have no session_id filter because these tables lack a session_id column. At scale, consider denormalizing." Same applies to `message_reads` + `direct_message_reactions`. **Recommend:** SPEC for ORCH-0898 includes adding `conversation_id` denormalized column to the new unified `message_reactions` + `message_reads` so Supabase-level filtering works.

5. **🔵 `conversations.type='group'` has been pre-installed in the schema since the ORCH-0729 baseline squash** (2026-05-05) but no production code references it. Likely an artifact of an earlier design that was deprioritized. ORCH-0898 reactivates the pre-installed schema — clean re-use rather than new schema design.

6. **🟡 `is_session_participant` helper does NOT filter on `has_accepted=true`** (line 5553 — `SELECT EXISTS (SELECT 1 FROM session_participants WHERE session_id = $1 AND user_id = $2)`). So users invited-but-not-accepted CAN read board_messages today. This is either intentional (preview-mode for invitees) or a stealth bug. **Recommend:** orchestrator confirm with operator whether invitees should see the chat. If no, fix in this ORCH (SPEC tightens the new trigger predicate to `WHEN NEW.has_accepted = true`). If yes, document the invariant and replicate in the unified substrate.

7. **🔵 `notify-message` is already substrate-unified.** The dispatch worried about push fan-out being substrate-specific; in fact line 25's type discriminator + the dual-roster query (line 154 session_participants + parallel conversation_participants paths) already unify push. The unification post-ORCH-0898 actually SIMPLIFIES notify-message (one type, one roster). Less work, not more.

8. **🔵 Storage bucket `board-attachments` exists with 365-day signed URLs** (per `boardDiscussionService.ts:158-168`). Recommend renaming to `chat-attachments` post-migration to reflect the unified nature, OR retain as-is (no functional impact). SPEC chooses.

9. **🟡 `accept_friend_request_atomic` returns `revealed_invite_ids` for `collaboration_invites` that became visible** (line 220-242 of baseline migration). There's already mature plumbing for "friend acceptance unlocks pending collab invites". The reverse — "session join unlocks the group chat" — is the symmetric pattern this ORCH builds.

10. **🔵 `board_threads` table is dormant.** `board_messages` ALONE supports reply-via-`reply_to_id`. `board_threads` (line 7635) is a separate table keyed by `board_id` not `session_id`, with `parent_id` — likely a half-built per-card threaded discussion feature. The Discussion tab doesn't appear to read from it (no grep hit in `app-mobile/src/services/boardDiscussionService.ts` or `boardMessageService.ts`). **Recommend:** flag for separate ORCH to either complete the feature or drop the dormant table.

11. **🔵 `add_friend_to_session` RPC (line 367, ORCH-0666)** already provides atomic "add friend to my session" with bidirectional block-check. ORCH-0898 inherits its rigor — the new session-join trigger should call a SECURITY DEFINER function with similar idempotency + block-check semantics.

12. **🟡 Append-only test contract per ORCH-0840 [Regression-test enforcement + append-only CI]** applies — any test the SPEC requires modifying needs the `[TEST-MOD-APPROVED ORCH-0898]` commit-body token. SPEC must enumerate which existing tests get touched.

---

## §14 Confidence + verification

**Confidence: HIGH.**

Evidence basis:
- Every schema claim cites file path + line number in the baseline migration (the only migration touching these tables).
- Every service / hook / component claim cites a real consumer-app file inspected this session.
- Every RLS predicate claim cites a `CREATE POLICY` line number.
- Substrate decision is backed by 6 structural facts (§3.1) — not preference.

Verification path:
- The recommended substrate (option iii) can be sanity-checked by running the §4.7 critical security test in a Supabase SQL editor against a staging environment — independently verifiable.
- The migration cost estimate (§3.4) is verifiable by SPEC mechanically counting touched files when it writes its file manifest.

Source-only reasoning is appropriate here per dispatch §5 hard guard ("pure backend / SQL / migration / RLS investigation — exempt from Prime Directive 7"). No iOS simulator repro was required and none was performed. If the operator wants to verify the current Discussions tab feature set on the consumer-app sim before SPEC, that's a CONDITIONAL PASS-style pre-SPEC check — name it separately.

---

## §15 Layman summary of the report

- Today the consumer app has TWO complete chat systems running side-by-side: one for Friends-tab DMs (rich — supports text/image/video/file/cards), and one for the collab-session Discussions tab (different schema, slightly different feature set — supports mentions + single-image). Plus the business app is about to add a THIRD chat system (`event_threads`) for per-trip group chat (ORCH-0897 Tr6, locked but not yet built).
- This investigation recommends consolidating ALL THREE onto a single substrate built on the existing `conversations` + `messages` tables that the DM side already uses. The schema was actually pre-designed for group chat (the `conversations.type` column already includes `'group'` as a valid value — it just isn't used in production yet) so this is reusing existing infrastructure, not inventing new infrastructure.
- The net effect for users: collab sessions automatically spawn a group chat that appears in the Friends tab next to DMs, tapping it opens the same conversation as the in-session Discussions tab (one thread, two surfaces), and when ORCH-0897 ships its trip group chat it lands on the same code path — one unified chat experience across DMs, collab outings, and trips.
- The migration is medium-effort (2–3 weeks): one DB migration, ~5 service files touched, ~5 component files touched, plus a one-time data copy from `board_messages` → `messages`. Existing DM behavior does NOT regress.
- The biggest external dependency is the operator agreeing to retarget Tr6 (ORCH-0897) onto this unified substrate BEFORE Tr6 ships its own `event_threads` tables — otherwise ORCH-0898 has to run a second consolidation migration later. The orchestrator should surface that decision now.
- Three side discoveries worth registering as separate follow-up ORCHs: (1) two parallel collab-chat services in `app-mobile/src/services/` (pre-existing duplication independent of this ORCH); (2) `useMessages.ts` hook is documented dead code with a `@deprecated` "DO NOT CALL" header but its TYPE exports still leak into production components; (3) `messagingService.getConversations` has a known 4N-sequential-queries perf issue that will compound with group conversations.
- The Tr6 cross-trip RLS isolation security test (per Tr6 §7 — independent user attempts to read another trip's thread → must return zero rows) is satisfied by the recommended substrate using the exact same `is_conversation_participant` predicate pattern that the existing DM RLS uses today. Same test passes for ORCH-0898 cross-session attempts.
- Twelve SPEC-time open questions (mute UX, edit window, chat naming, broadcast-only mode, group-chat moderator powers, attachments-in-v1, system-message round-start cards for ORCH-0899, etc.) are enumerated in §12 with recommended defaults — none of them block the substrate decision; all of them get locked at SPEC time.

---

**Report path:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0898_COLLAB_GROUP_CHAT.md`
**Status:** Investigation complete. Awaiting orchestrator REVIEW + decision on operator-escalation of Tr6 convergence (§10.1).
