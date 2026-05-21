#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0898 [Consumer collab session → Friends-tab group chat (shared thread, auto-roster,
 * harmonized with ORCH-0897 trip group chat)] regression check (happy-path, structural).
 *
 * Per SPEC §6.1 — adapts T-01..T-10 to the app-mobile .mjs structural-check pattern
 * proven by ORCH-0854 [Consumer ticket status live-flip] + ORCH-0901 [getConversations
 * 4N-query perf fix]. Each check verifies a SPEC §3.1-§3.5 contract is present in the
 * source — grep + AST-style inspection of the shipped files.
 *
 * Anti-regression rationale: a chat-substrate migration of this size is fundamentally
 * structural — "the migration creates X columns, the service has Y method, the hook reads
 * from Z, the component branches on type". Source-level structural checks are the
 * strongest available enforcement in this codebase (app-mobile does NOT use jest); they
 * cannot be bypassed by mock-spy gymnastics and TypeScript strict + runtime sim-smoke
 * cover the behavior-correctness layer above.
 *
 * The check labeled "FAILS-ON-REVERT KEY" is the canonical anchor — reverting the
 * implementation flips it to FAIL with exit 1.
 *
 * Exit 1 on any FAIL.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(root, "..");

const read = (relFromRepoRoot) => {
  const abs = path.join(repoRoot, relFromRepoRoot);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
};

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

const migrationSrc = read("supabase/migrations/20260624000000_orch_0898_unified_chat_substrate.sql");
const notifyMessageSrc = read("supabase/functions/notify-message/index.ts");
const messagingServiceSrc = read("app-mobile/src/services/messagingService.ts");
const boardDiscussionServiceSrc = read("app-mobile/src/services/boardDiscussionService.ts");
const boardMessageServiceSrc = read("app-mobile/src/services/boardMessageService.ts");
const useSessionDiscussionSrc = read("app-mobile/src/hooks/useSessionDiscussion.ts");
const chatListItemSrc = read("app-mobile/src/components/connections/ChatListItem.tsx");
const connectionsPageSrc = read("app-mobile/src/components/ConnectionsPage.tsx");
const messageInterfaceSrc = read("app-mobile/src/components/MessageInterface.tsx");
const discussionMessageBubbleSrc = read("app-mobile/src/components/discussion/MessageBubble.tsx");
const chatMessageBubbleSrc = read("app-mobile/src/components/chat/MessageBubble.tsx");

// ─── T-01 (SC-01/02/03): Migration contains all 3 triggers + new columns + RLS policies ─

check(
  "T-01 [FAILS-ON-REVERT KEY] Migration file 20260624000000_orch_0898_unified_chat_substrate.sql exists" +
    " and contains the 6 new conversations columns + mentions on messages + notifications_muted on conversation_participants",
  migrationSrc !== null &&
    /ADD COLUMN IF NOT EXISTS session_id uuid/.test(migrationSrc) &&
    /ADD COLUMN IF NOT EXISTS event_id uuid/.test(migrationSrc) &&
    /ADD COLUMN IF NOT EXISTS linked_entity_type text/.test(migrationSrc) &&
    /ADD COLUMN IF NOT EXISTS is_broadcast_only boolean/.test(migrationSrc) &&
    /ADD COLUMN IF NOT EXISTS is_enabled boolean/.test(migrationSrc) &&
    /ADD COLUMN IF NOT EXISTS name text NULL/.test(migrationSrc) &&
    /ALTER TABLE public\.messages[\s\S]*?ADD COLUMN IF NOT EXISTS mentions jsonb/.test(migrationSrc) &&
    /ALTER TABLE public\.conversation_participants[\s\S]*?ADD COLUMN IF NOT EXISTS notifications_muted boolean/.test(migrationSrc),
  "Migration MUST add the 6 new conversations columns (session_id, event_id, linked_entity_type," +
    " is_broadcast_only, is_enabled, name) + mentions jsonb on messages + notifications_muted on" +
    " conversation_participants per SPEC §3.1 Steps 1-3. Each ADD COLUMN uses IF NOT EXISTS for" +
    " idempotency. Reverting the migration flips this check to FAIL (canonical fails-on-revert anchor).",
);

check(
  "T-02 (SC-01/02) Migration defines both creation triggers with correct WHEN guards",
  migrationSrc !== null &&
    /CREATE TRIGGER ensure_group_conversation_on_session_create\s+AFTER INSERT ON public\.collaboration_sessions/.test(migrationSrc) &&
    /CREATE TRIGGER mirror_session_participant_to_conversation\s+AFTER INSERT OR UPDATE OF has_accepted ON public\.session_participants[\s\S]*?WHEN \(NEW\.has_accepted = true\)/.test(migrationSrc),
  "Two creation triggers MUST exist: (a) ensure_group_conversation_on_session_create AFTER INSERT" +
    " on collaboration_sessions; (b) mirror_session_participant_to_conversation AFTER INSERT OR UPDATE" +
    " OF has_accepted on session_participants WITH a WHEN (NEW.has_accepted = true) clause to prevent" +
    " mirroring of invited-but-not-accepted users. SPEC §3.1 Step 4 + Step 5.",
);

check(
  "T-03 (SC-03) Migration defines removal trigger for session-leave auto-leave",
  migrationSrc !== null &&
    /CREATE TRIGGER remove_session_participant_from_conversation\s+AFTER DELETE ON public\.session_participants/.test(migrationSrc),
  "Removal trigger MUST exist: remove_session_participant_from_conversation AFTER DELETE on" +
    " session_participants — auto-leaves the user from the linked group conversation per locked Q1" +
    " default (no read-only history in v1). SPEC §3.1 Step 5 extension.",
);

check(
  "T-04 (SC-07/14/15) RLS policies use inline EXISTS subqueries (NOT SECURITY DEFINER helpers in SELECT)",
  migrationSrc !== null && (() => {
    // 3 new policies should exist
    const hasBrandTeamMemberRead = /CREATE POLICY conversations_brand_team_member_read[\s\S]*?FOR SELECT[\s\S]*?EXISTS \(\s*SELECT 1\s+FROM public\.brand_team_members/.test(migrationSrc);
    const hasMessagesBrandTeamMemberRead = /CREATE POLICY messages_brand_team_member_read[\s\S]*?FOR SELECT[\s\S]*?EXISTS/.test(migrationSrc);
    const hasBroadcastOnlyEnforcement = /CREATE POLICY messages_broadcast_only_enforcement[\s\S]*?AS RESTRICTIVE[\s\S]*?FOR INSERT/.test(migrationSrc);
    // No SECURITY DEFINER call in any SELECT policy body (helper functions are fine for triggers).
    const policyBlocks = migrationSrc.match(/CREATE POLICY[\s\S]*?(?:\n\s*;|\);)/g) || [];
    const selectPolicyHelpersFree = policyBlocks.every((block) => {
      if (!/FOR SELECT/i.test(block)) return true;
      // SELECT policies must not call has_thread_access, has_session_invite, is_session_participant style helpers
      return !/has_thread_access|has_session_invite|is_session_participant|is_conversation_participant/i.test(block);
    });
    return hasBrandTeamMemberRead && hasMessagesBrandTeamMemberRead && hasBroadcastOnlyEnforcement && selectPolicyHelpersFree;
  })(),
  "Three new RLS policies must exist: conversations_brand_team_member_read (FOR SELECT, inline EXISTS" +
    " on brand_team_members), messages_brand_team_member_read (FOR SELECT, inline EXISTS), and" +
    " messages_broadcast_only_enforcement (AS RESTRICTIVE FOR INSERT). NO SECURITY DEFINER helper" +
    " (has_thread_access etc.) may appear in any SELECT policy body per RLS-RETURNING-OWNER-GAP" +
    " discipline. SPEC §3.1 Step 6a/6b/6c + Phase 1 implementor SPEC interpretation note (AS RESTRICTIVE).",
);

check(
  "T-05 (SC-12) Self-add policy on conversation_participants tightened to type='direct' only",
  migrationSrc !== null &&
    /DROP POLICY IF EXISTS "Users can add themselves to conversations" ON public\.conversation_participants/.test(migrationSrc) &&
    /CREATE POLICY conversation_participants_direct_self_add[\s\S]*?WITH CHECK \([\s\S]*?c\.type = 'direct'[\s\S]*?\)/.test(migrationSrc),
  "Legacy 'Users can add themselves to conversations' policy must be DROPPED + replaced with" +
    " conversation_participants_direct_self_add which restricts self-add to type='direct'. Group-" +
    " conversation roster writes flow through the SECURITY DEFINER triggers only. SPEC §3.1 Step 6d.",
);

// ─── T-06 (SC-04/05) Service layer: messagingService.getOrCreateGroupConversationForSession ─

check(
  "T-06 messagingService.ts exports getOrCreateGroupConversationForSession + leaveGroupConversation",
  messagingServiceSrc !== null &&
    /async getOrCreateGroupConversationForSession\(\s*sessionId: string,\s*\)/.test(messagingServiceSrc) &&
    /\.eq\('session_id', sessionId\)[\s\S]*?\.eq\('linked_entity_type', 'session'\)/.test(messagingServiceSrc) &&
    /async leaveGroupConversation\(\s*conversationId: string,\s*userId: string,\s*\)/.test(messagingServiceSrc),
  "messagingService MUST export getOrCreateGroupConversationForSession(sessionId) using the new" +
    " conversations.session_id + linked_entity_type='session' columns to look up the session's group" +
    " conversation, plus leaveGroupConversation(conversationId, userId) for the Friends-tab swipe-leave" +
    " action. SPEC §3.3.",
);

// ─── T-07 (SC-05/06) useSessionDiscussion reads from messages via messagingService ─

check(
  "T-07 useSessionDiscussion.ts reads from messages via messagingService — NOT from board_messages via boardDiscussionService",
  useSessionDiscussionSrc !== null &&
    /import { messagingService, DirectMessage } from '\.\.\/services\/messagingService'/.test(useSessionDiscussionSrc) &&
    !/from '\.\.\/services\/boardDiscussionService'/.test(useSessionDiscussionSrc) &&
    /messagingService\.getOrCreateGroupConversationForSession\(sessionId\)/.test(useSessionDiscussionSrc) &&
    /messagingService\.getMessages\(/.test(useSessionDiscussionSrc),
  "useSessionDiscussion MUST import from messagingService (not boardDiscussionService); resolve the" +
    " session's conversation_id via getOrCreateGroupConversationForSession; read messages via" +
    " messagingService.getMessages. Realtime channel renamed from discussion:${sessionId} →" +
    " conversation:${conversationId}. SPEC §3.4.",
);

check(
  "T-07b useSessionDiscussion realtime subscription uses conversation:<id> channel (not discussion:<id>)",
  useSessionDiscussionSrc !== null &&
    /supabase\s*\.\s*channel\(`conversation:\$\{conversationId\}`\)/.test(useSessionDiscussionSrc) &&
    !/supabase\s*\.\s*channel\(`discussion:\$\{sessionId\}`\)/.test(useSessionDiscussionSrc) &&
    /table: 'messages'/.test(useSessionDiscussionSrc) &&
    /filter: `conversation_id=eq\.\$\{conversationId\}`/.test(useSessionDiscussionSrc),
  "Realtime channel name MUST be `conversation:${conversationId}` (not `discussion:${sessionId}`)." +
    " postgres_changes subscription MUST filter on table=messages with conversation_id eq filter." +
    " SPEC §3.4 realtime layer.",
);

// ─── T-08 (SC-04) ChatListItem type='group' branch ─

check(
  "T-08 ChatListItem.tsx has conversation.type === 'group' branch + multi-avatar render",
  chatListItemSrc !== null &&
    /export type ChatListItemConversation = Conversation & \{[\s\S]*?type\?: 'direct' \| 'group'/.test(chatListItemSrc) &&
    /const isGroup = conversation\.type === 'group'/.test(chatListItemSrc) &&
    /groupAvatarParticipants[\s\S]*?\.slice\(0, 3\)/.test(chatListItemSrc),
  "ChatListItem MUST define ChatListItemConversation type with optional type/name/session_id fields" +
    " and branch on conversation.type === 'group' to render a multi-avatar stack of up to 3" +
    " participants. SPEC §3.5.1.",
);

// ─── T-09 (SC-09) Both MessageBubble files have system-message render branches ─

check(
  "T-09 discussion/MessageBubble.tsx renders system-message row for sender NULL",
  discussionMessageBubbleSrc !== null &&
    /message\.user_id === null \|\| message\.user_id === undefined/.test(discussionMessageBubbleSrc) &&
    /systemRowStyles\.systemMessageRow/.test(discussionMessageBubbleSrc),
  "discussion/MessageBubble must detect NULL sender (message.user_id === null) and render a centered" +
    " muted system-message row early-return. The ORCH-0901 NULL-sender unread fix (commit bb74655b)" +
    " already counts these toward unread badges. SPEC §3.5.3 + investigation §13 #10.",
);

check(
  "T-09b chat/MessageBubble.tsx has isSystem field + render branch",
  chatMessageBubbleSrc !== null &&
    /isSystem\?: boolean/.test(chatMessageBubbleSrc) &&
    /message\.isSystem/.test(chatMessageBubbleSrc) &&
    /chatSystemRowStyles/.test(chatMessageBubbleSrc),
  "chat/MessageBubble must declare isSystem?: boolean on MessageData interface and add early-return" +
    " render branch for system messages. SPEC §3.5.3 — applies to both discussion and chat folders.",
);

// ─── T-10 (I-PROPOSED-CHAT-SUBSTRATE-UNIFIED) No new chat-message tables introduced ─

check(
  "T-10 No new _messages or _threads or event_threads / event_thread_messages tables introduced",
  migrationSrc !== null && (() => {
    // Allowed: the _archive_orch_0898_board_messages_pre_migration backup snapshot table.
    // Forbidden: any other CREATE TABLE matching _messages or _threads or event_thread* patterns.
    const createTableMatches = migrationSrc.match(/CREATE TABLE[\s\S]*?\.(\w+)/g) || [];
    for (const m of createTableMatches) {
      const tableName = m.match(/CREATE TABLE[\s\S]*?\.(\w+)/)?.[1] ?? "";
      // Allowed: the backup snapshot table
      if (tableName === "_archive_orch_0898_board_messages_pre_migration") continue;
      // Allowed: temp tables (no _messages/_threads suffix matters)
      if (tableName.startsWith("_orch_0898_")) continue;
      // Forbidden patterns:
      if (/_messages$|_threads$|event_thread|event_threads/.test(tableName)) {
        return false;
      }
    }
    return true;
  })(),
  "Migration MUST NOT introduce new chat-message-style tables. The only allowed CREATE TABLE is" +
    " _archive_orch_0898_board_messages_pre_migration (backup snapshot) + temp tables. Tr6's" +
    " event_threads + event_thread_messages are SUPERSEDED by the unified substrate (operator" +
    " D3 + SPEC §1.3). I-PROPOSED-CHAT-SUBSTRATE-UNIFIED.",
);

// ─── T-11 (notify-message) Edge function has canonical 'message' and 'message_mention' types ─

check(
  "T-11 notify-message edge function declares canonical 'message' + 'message_mention' types + legacy aliases",
  notifyMessageSrc !== null &&
    /\| "message"[\s\S]*?\| "message_mention"/.test(notifyMessageSrc) &&
    /handleUnifiedMessage/.test(notifyMessageSrc) &&
    /handleUnifiedMention/.test(notifyMessageSrc) &&
    // Backward-compat: legacy types still in the discriminator union
    /\| "direct_message"[\s\S]*?\| "board_message"[\s\S]*?\| "board_mention"/.test(notifyMessageSrc) &&
    /console\.warn[\s\S]*?DEPRECATED type=direct_message/.test(notifyMessageSrc),
  "notify-message edge function MUST declare the canonical 'message' + 'message_mention' type" +
    " discriminators + handleUnifiedMessage / handleUnifiedMention helpers. Legacy types" +
    " (direct_message, board_message, board_mention) MUST be retained as deprecated aliases" +
    " routing through the unified handlers with console.warn deprecation notices. SPEC §3.2.",
);

// ─── T-12 (legacy services) board* services have @deprecated markers + writes BLOCKED ─

check(
  "T-12 boardDiscussionService write methods (sendMessage/toggleReaction/markMessagesAsRead/uploadMessageImage) throw [TRANSITIONAL] ORCH-0898 errors",
  boardDiscussionServiceSrc !== null &&
    /\[TRANSITIONAL\] ORCH-0898 dual-read window:[\s\S]*?sendMessage is BLOCKED/.test(boardDiscussionServiceSrc) &&
    /\[TRANSITIONAL\] ORCH-0898 dual-read window:[\s\S]*?toggleReaction is BLOCKED/.test(boardDiscussionServiceSrc) &&
    /\[TRANSITIONAL\] ORCH-0898 dual-read window:[\s\S]*?markMessagesAsRead is BLOCKED/.test(boardDiscussionServiceSrc) &&
    /\[TRANSITIONAL\] ORCH-0898 dual-read window:[\s\S]*?uploadMessageImage is BLOCKED/.test(boardDiscussionServiceSrc),
  "boardDiscussionService.ts MUST have @deprecated header + all 4 write methods (sendMessage," +
    " toggleReaction, markMessagesAsRead, uploadMessageImage) BLOCKED via [TRANSITIONAL] ORCH-0898" +
    " throws. Reads can still pass through during the dual-read window. SPEC §3.3.",
);

check(
  "T-12b boardMessageService.ts has @deprecated header pointing at ORCH-0902 retirement",
  boardMessageServiceSrc !== null &&
    /@deprecated ORCH-0898/.test(boardMessageServiceSrc) &&
    /ORCH-0902 \[board\* services consolidation\] CLOSES/.test(boardMessageServiceSrc),
  "boardMessageService.ts MUST have @deprecated JSDoc header citing ORCH-0898 migration + the" +
    " ORCH-0902 retirement exit condition. SPEC §3.3.",
);

// ─── T-13 (SC-04) ConnectionsPage transform passes type+name+session_id ─

check(
  "T-13 ConnectionsPage.tsx transform passes type+name+session_id through to ChatListItem",
  connectionsPageSrc !== null &&
    /type: conv\.type/.test(connectionsPageSrc) &&
    /name:[\s\S]*?conv[\s\S]*?\.name/.test(connectionsPageSrc) &&
    /session_id:[\s\S]*?conv[\s\S]*?\.session_id/.test(connectionsPageSrc),
  "ConnectionsPage.fetchConversations transform MUST pass conv.type + conv.name + conv.session_id" +
    " through to the transformed Conversation objects so ChatListItem's type-branch can render" +
    " group vs direct. SPEC §3.5.5.",
);

// ─── T-14 (SC-13) ORCH-0901 perf invariant intact in messagingService.getConversations ─

check(
  "T-14 (SC-13) messagingService.getConversations still has the ORCH-0901 single-JOIN shape + no type filter (group-ready)",
  messagingServiceSrc !== null && (() => {
    // Extract the getConversations function body
    const m = messagingServiceSrc.match(/async getConversations\([\s\S]*?\n  \}\s*$/m);
    if (!m) return false;
    const body = m[0];
    return (
      /Promise\.all\(\s*\[\s*conversationsPromise/.test(body) &&
      /\.or\(`sender_id\.neq\.\$\{userId\},sender_id\.is\.null`\)/.test(body) &&
      !/\.eq\(\s*['"`]type['"`]\s*,\s*['"`]direct['"`]\s*\)/.test(body) &&
      !/\.eq\(\s*['"`]type['"`]\s*,\s*['"`]group['"`]\s*\)/.test(body)
    );
  })(),
  "ORCH-0901 [getConversations 4N-query perf fix] perf invariants MUST hold post-ORCH-0898: the" +
    " function still uses Promise.all + the NULL-sender .or() predicate + no type filter (group" +
    " conversations appear in the list automatically). SPEC §4 SC-13 + I-FRIENDS-TAB-COLD-LOAD-UNDER-2S.",
);

// ─── T-15 (SC-04 follow-up) Friends-tab open path preserves group metadata into chat header ─

check(
  "T-15 ConnectionsPage opens group conversations with session name + participant metadata, not DM fallback",
  connectionsPageSrc !== null &&
    /CONNECTIONS_CACHE_VERSION = "v2-orch-0898-group-metadata"/.test(connectionsPageSrc) &&
    /\.from\("collaboration_sessions"\)[\s\S]*?\.select\("id, name"\)/.test(connectionsPageSrc) &&
    /const sessionNameMap = new Map/.test(connectionsPageSrc) &&
    /sessionNameMap\.get\(sessionId\)\?\.trim\(\)/.test(connectionsPageSrc) &&
    /const isGroupConversation = conversationMeta\.type === 'group'/.test(connectionsPageSrc) &&
    /conversationMeta\.name\?\.trim\(\) \|\| ''/.test(connectionsPageSrc) &&
    /\.from\('collaboration_sessions'\)[\s\S]*?\.select\('name'\)/.test(connectionsPageSrc) &&
    /rawName = session\?\.name\?\.trim\(\) \|\| ''/.test(connectionsPageSrc) &&
    /conversationType: isGroupConversation \? 'group' : 'direct'/.test(connectionsPageSrc) &&
    /participantCount: isGroupConversation \? conversation\.participants\.length : undefined/.test(connectionsPageSrc) &&
    /participants: isGroupConversation[\s\S]*?conversation\.participants\.map/.test(connectionsPageSrc) &&
    /if \(!isGroupConversation\) \{[\s\S]*?blockService\.hasBlockBetween/.test(connectionsPageSrc),
  "Selecting a group conversation from the Friends tab MUST carry the group conversation shape into" +
    " MessageInterface: session/conversation name as activeChat.name, conversationType='group'," +
    " participantCount, participant profiles for the avatar stack, a cache version that invalidates" +
    " pre-ORCH-0898 rows, collaboration_sessions.name fallback for null conversations.name, and no" +
    " DM block/friendship/profile checks against a fake other participant. This is the fails-on-revert" +
    " guard for the on-the-fly ORCH-0898 header fix.",
);

check(
  "T-16 MessageInterface renders group chat header with title, avatar stack, and people count",
  messageInterfaceSrc !== null &&
    /const isGroupChat = friend\.conversationType === "group"/.test(messageInterfaceSrc) &&
    /const headerTitle = cleanName\(friend\.name\)/.test(messageInterfaceSrc) &&
    /const headerParticipantCount = friend\.participantCount \?\? headerParticipants\.length/.test(messageInterfaceSrc) &&
    /styles\.groupHeaderAvatarStack/.test(messageInterfaceSrc) &&
    /styles\.groupParticipantCount/.test(messageInterfaceSrc) &&
    /headerParticipantCount === 1 \? "person" : "people"/.test(messageInterfaceSrc) &&
    /useEffect\(\(\) => \{[\s\S]*?if \(isGroupChat\)[\s\S]*?setShowMoreOptionsMenu\(false\)/.test(messageInterfaceSrc) &&
    /visible=\{!isGroupChat && showMoreOptionsMenu\}/.test(messageInterfaceSrc) &&
    /!\s*isGroupChat && \(\s*<TouchableOpacity[\s\S]*?setShowMoreOptionsMenu/.test(messageInterfaceSrc),
  "MessageInterface MUST branch on friend.conversationType === 'group' and render the group header" +
    " as the collaboration/session name + stacked participant avatars + `N people in chat`, while" +
    " hiding and hard-disabling the one-on-one friend action menu for group chats.",
);

check(
  "T-17 ChatListItem group preview prefixes the last sender name",
  chatListItemSrc !== null &&
    /if \(isGroup && messagePreview && lastMessage\?\.sender_name\)/.test(chatListItemSrc) &&
    /messagePreview = `\$\{lastMessage\.sender_name\}: \$\{messagePreview\}`/.test(chatListItemSrc),
  "Friends-tab group rows MUST keep the session-name title and show sender-prefixed previews so" +
    " group chats remain scannable next to direct messages.",
);

// ─── Report ────────────────────────────────────────────────────────────────────

console.log("\nORCH-0898 regression check (happy-path, structural)\n");
let failed = 0;
for (const c of checks) {
  const tag = c.pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${c.name}`);
  if (!c.pass) {
    console.log(`         ${c.detail}`);
    failed += 1;
  }
}
console.log(
  `\nSummary: ${checks.length - failed}/${checks.length} PASS${
    failed > 0 ? ` (${failed} FAIL)` : ""
  }\n`,
);
process.exit(failed > 0 ? 1 : 0);
