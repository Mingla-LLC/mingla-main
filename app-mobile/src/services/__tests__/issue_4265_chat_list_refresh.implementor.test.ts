// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4265 — conversations created, joined or left OUTSIDE the Chats tab
// mark the cached Chats list (chatListKeys.all) stale, so the next Chats visit
// shows the change instead of a list that stays fresh for minutes.
//
// The RN call sites cannot mount here, so they are pinned as source structure
// (the pattern the chat-list wiring suite beside ConnectionsPage uses).
//
// FAILS-ON-REVERT: delete any of the invalidation calls below — the event
// guest-list DM start, the session group chat resolve, accepting a
// collaboration invite, creating a session, or leaving / deleting one — or
// point the helper at another key, and this suite fails.

const root = new URL("../../../", import.meta.url);
const read = (path: string) => Deno.readTextFileSync(new URL(path, root));
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const count = (source: string, needle: string) => source.split(needle).length - 1;

Deno.test("#4265 the chat-list refresh helper invalidates the one Chats list key", () => {
  const helper = strip(read("src/services/chatListRefresh.ts"));
  assert(helper.includes("await queryClient.invalidateQueries({ queryKey: chatListKeys.all });"),
    "the helper must mark every cached Chats list stale");
  assert(helper.includes("import('../config/queryClient')"), "services use the app's one QueryClient, loaded lazily");
  assert(/\.catch\(\(error: unknown\) => \{\s*console\.warn\(/.test(helper), "a failure is logged, never swallowed");
  const keys = strip(read("src/hooks/queryKeys.ts"));
  assert(keys.includes("all: ['chatList'] as const,"), "chatListKeys.all is the prefix useChatList's key starts with");
});

Deno.test("#4265 a DM started from the event guest list refreshes the Chats list", () => {
  const sheet = strip(read("src/components/EventGuestListSheet.tsx"));
  const start = sheet.indexOf("await messagingService.ensureConversation(viewerId, profileId);");
  const success = sheet.indexOf("void invalidateChatListWith(queryClient);", start);
  const navigate = sheet.indexOf("onOpenConversation(conversationId);", start);
  assert(start !== -1 && success > start && success < navigate,
    "after a successful ensureConversation and before opening the thread");
});

Deno.test("#4265 resolving a session's group chat refreshes the Chats list", () => {
  const hook = strip(read("src/hooks/useSessionDiscussion.ts"));
  assert(/setConversationId\(conversation\.id\);\s*void invalidateChatListWith\(queryClient\);/.test(hook));
  assert(hook.includes("}, [sessionId, queryClient]);"));
});

Deno.test("#4265 accepting, creating and leaving a session refresh the Chats list", () => {
  const invite = strip(read("src/services/collaborationInviteService.ts"));
  const accept = invite.slice(invite.indexOf("export async function acceptCollaborationInvite"), invite.indexOf("export async function declineCollaborationInvite"));
  assert(/refreshChatListAfterConversationChange\(\);\s*return \{\s*success: true,/.test(accept),
    "every accept path (chat row, notifications, session hook) goes through this service");

  const sessions = strip(read("src/hooks/useSessionManagement.ts"));
  assert(/await loadUserSessions\(\);\s*refreshChatListAfterConversationChange\(\);\s*return sessionData\.id;/.test(sessions),
    "creating a session");
  const cancel = sessions.slice(sessions.indexOf("const cancelSession = useCallback"));
  assert(count(cancel.slice(0, cancel.indexOf("Error handling session cancellation")), "refreshChatListAfterConversationChange();") === 2,
    "leaving the active session and deleting / leaving any other session");
});
