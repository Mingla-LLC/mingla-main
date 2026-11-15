// @ts-nocheck — Deno-runtime suite; app-mobile's broad tsc sweep includes
// Deno suites that are not configured for that command.
//
// #4435 Phase 0 characterization (CHANGE). Today's session rules the #4435
// build changes on purpose. Each test is named by its rule tag; the build may
// change only a tagged test, only in the wave that implements that rule, and
// the commit message names the tag.
const root = new URL("../../../", import.meta.url);
const read = (p: string): string => Deno.readTextFileSync(new URL(p, root));
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("R2 [#4435 W3] leaving from SessionViewModal deletes only my own row", () => {
  const modal = read("src/components/SessionViewModal.tsx");
  assert(!/willAutoDelete/.test(modal), "no client auto-delete");
  assert(!/\.neq\('user_id', currentUserId\);/.test(modal), "the others are never deleted");
  assert(!/from\('collaboration_sessions'\)\s*\.delete\(\)\s*\.eq\('id', currentSessionId\)/.test(modal), "the session is never deleted by the client");
  assert(/from\("session_participants"\)\s*\.delete\(\)\s*\.eq\("session_id", currentSessionId\)\s*\.eq\("user_id", currentUserId\)/.test(modal), "my row is deleted");
});

Deno.test("R4-group [#4435 W3] unfriend/block cleanup touches only 1:1 collab sessions", () => {
  const cleanup = read("src/utils/sharedSessionCleanup.ts");
  assert(/\.not\("conversation_id", "is", null\)/.test(cleanup), "only sessions started in a 1:1 chat");
  const page = read("src/components/ConnectionsPage.tsx");
  assert(!/if \(count !== null && count <= 2\) \{/.test(page), "no second inline copy in ConnectionsPage");
  assert(page.includes("cleanupSharedSessionsShared(user.id, otherUserId)"), "ConnectionsPage uses the shared cleanup");
});

Deno.test("R6-new [#4435 W3] handleCreateGroupChat makes one create_group_chat call", () => {
  const index = read("app/index.tsx");
  const start = index.indexOf("logger.action('Create session pressed'");
  assert(start >= 0, "create handler");
  const body = index.slice(start, index.indexOf("const handleAcceptInvite", start));
  assert(/createGroupChat\(sessionName, selectedFriends\.map\(\(friend\) => friend\.id\)\)/.test(body), "one server call with every friend");
  assert(!/from\('collaboration_sessions'\)\s*\.insert\(/.test(body), "no client session insert");
  assert(!/for \(const friend/.test(body), "no per-friend loop");
  assert(/createPendingSessionInvite\(createdSessionId/.test(body), "phone invitees still tie to the new session");
  const service = read("src/services/groupChatService.ts");
  assert(/supabase\.rpc\("create_group_chat"/.test(service), "the service calls create_group_chat");
});

Deno.test("R10 a pending creator collab opens the pending sheet", () => {
  const page = read("src/components/ConnectionsPage.tsx");
  assert(page.includes("setPendingCollabChat(conversationMeta.__pendingCollabChat)"), "pending sheet route");
  assert(page.includes("PendingCollabChatSheet"), "the sheet is rendered");
});

Deno.test("R23 [#4435 W3] remove and promote on the board screen go through the server functions", () => {
  const dropdown = read("src/components/board/BoardSettingsDropdown.tsx");
  assert(!/update\(\{ is_admin: (true|false) \}\)/.test(dropdown), "no direct admin write");
  assert(/await setGroupAdmin\(groupConversationId, memberUserId, true\)/.test(dropdown), "promote via set_group_admin");
  assert(/await setGroupAdmin\(groupConversationId, memberUserId, false\)/.test(dropdown), "demote via set_group_admin");
  assert(/await removeGroupMember\(groupConversationId, memberUserId\)/.test(dropdown), "remove via remove_group_member");
  const inline = read("src/components/board/InlineInviteFriendsList.tsx");
  assert(/addGroupMembers\(groupConversationId, selectedFriends\.map/.test(inline), "one add_group_members call");
});

Deno.test("R24-filter [#4435 W3] the session list keeps groups with 1+ member", () => {
  const hook = read("src/hooks/useSessionManagement.ts");
  assert(/if \(totalMembers < 1\) \{\s*return false;/.test(hook), "< 1 hidden only");
  assert(!/if \(totalMembers < 2\)/.test(hook), "a group of one is listed");
});

Deno.test("R24-limbo [#4435 W3] creating never deletes a same-name or ghost session", () => {
  const hook = read("src/hooks/useSessionManagement.ts");
  assert(!/Limbo session \(creator only/.test(hook), "no limbo branch");
  assert(!/\.delete\(\)\s*\.eq\('id', match\.session_id\)/.test(hook), "no same-name delete");
  assert(/if \(matchingParticipations\.length > 0\) \{\s*throw new Error\('A collaboration session already exists with that name\.'\);/.test(hook), "a same-name group is a duplicate error");
  const index = read("app/index.tsx");
  assert(!/ghostSessions/.test(index), "no ghost delete in app/index");
});

Deno.test("R30 the create sheet needs a name and at least one friend", () => {
  const sheet = read("src/components/connections/CreateGroupChatSheet.tsx");
  assert(sheet.includes("const canSubmit = name.trim().length > 0 && selectedIds.size > 0 && !isCreating;"), "name + 1 friend");
});
