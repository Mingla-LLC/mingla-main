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

Deno.test("R2 leaving from SessionViewModal deletes the others and the session at 2 or fewer", () => {
  const modal = read("src/components/SessionViewModal.tsx");
  assert(/const willAutoDelete = participantCount !== null && participantCount <= 2;/.test(modal), "auto-delete at <= 2");
  assert(/\.neq\('user_id', currentUserId\);/.test(modal), "the others are deleted");
  assert(/from\('collaboration_sessions'\)\s*\.delete\(\)\s*\.eq\('id', currentSessionId\)/.test(modal), "the session is deleted");
});

Deno.test("R4-group unfriend/block cleanup deletes any session with 2 or fewer members", () => {
  const cleanup = read("src/utils/sharedSessionCleanup.ts");
  assert(/if \(count !== null && count <= 2\) \{/.test(cleanup), "count <= 2 deletes, groups included");
  assert(!cleanup.includes("conversation_id"), "no 1:1-collab filter today");
});

Deno.test("R6-new handleCreateGroupChat inserts a pending session and loops per friend", () => {
  const index = read("app/index.tsx");
  const start = index.indexOf("logger.action('Create session pressed'");
  assert(start >= 0, "create handler");
  const body = index.slice(start, start + 9000);
  assert(/from\('collaboration_sessions'\)\s*\.insert\(/.test(body), "client inserts the session");
  assert(/status: 'pending'/.test(body), "status pending");
  assert(/for \(const friendUserId of/.test(body) || /for \(const friend/.test(body), "per-friend loop");
  assert(!body.includes("create_group_chat"), "no server create today");
});

Deno.test("R10 a pending creator collab opens the pending sheet", () => {
  const page = read("src/components/ConnectionsPage.tsx");
  assert(page.includes("setPendingCollabChat(conversationMeta.__pendingCollabChat)"), "pending sheet route");
  assert(page.includes("PendingCollabChatSheet"), "the sheet is rendered");
});

Deno.test("R23 remove and promote are direct table writes on the board screen", () => {
  const dropdown = read("src/components/board/BoardSettingsDropdown.tsx");
  assert(/from\("session_participants"\)\s*\.update\(\{ is_admin: true \}\)/.test(dropdown), "promote is a direct write");
  assert(/from\("session_participants"\)\s*\.update\(\{ is_admin: false \}\)/.test(dropdown), "demote is a direct write");
  assert(!dropdown.includes("remove_group_member") && !dropdown.includes("set_group_admin"), "no server functions today");
});

Deno.test("R24-filter the session list hides sessions with fewer than 2 members", () => {
  const hook = read("src/hooks/useSessionManagement.ts");
  assert(/if \(totalMembers < 2\) \{\s*return false;/.test(hook), "< 2 hidden");
});

Deno.test("R24-limbo creating a session deletes same-name limbo or ghost sessions", () => {
  const hook = read("src/hooks/useSessionManagement.ts");
  assert(/Limbo session \(creator only/.test(hook) && /\.from\('collaboration_sessions'\)\s*\.delete\(\)\s*\.eq\('id', match\.session_id\)/.test(hook), "useSessionManagement limbo delete");
  const index = read("app/index.tsx");
  assert(/ghostSessions/.test(index), "app/index ghost delete");
});

Deno.test("R30 the create sheet needs a name and at least one friend", () => {
  const sheet = read("src/components/connections/CreateGroupChatSheet.tsx");
  assert(sheet.includes("const canSubmit = name.trim().length > 0 && selectedIds.size > 0 && !isCreating;"), "name + 1 friend");
});
