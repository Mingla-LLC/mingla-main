// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4261 Wave H: every #4261 action that posts a chat line or changes who
// is in a chat marks #4265's Chats list (useChatList → chatListKeys) stale, so
// the list preview follows. Source-shape: each listed mutation's success path
// invalidates `chatListKeys.all` (directly, through useChatPlans'
// refreshChatList helper, or through chatListRefresh's
// refreshChatListAfterConversationChange), and nothing writes a literal
// ['chatList'] key.
//
// FAILS-ON-REVERT: delete any one listed invalidation and its case fails.
//
// Own-action false unread: delete the open-chat effect, the badge filter, the
// back-handler read or markConversationRead's NULL-sender filter, or make
// openChatRowTurnedUnread fire on open, and the matching case below fails.
import { chatListKeys } from "../queryKeys.ts";
import { openChatRowTurnedUnread } from "../../utils/threadModel.ts";
import { applyUnreadFilters } from "../../components/connections/chatListLoad.ts";

const SRC = new URL("../../", import.meta.url);
const read = (p: string) => Deno.readTextFile(new URL(p, SRC));

function assert(condition: unknown, label: string): void {
  if (!condition) throw new Error(label);
}

const DIRECT = "invalidateQueries({ queryKey: chatListKeys.all })";
const PLAN_HELPER = "refreshChatList(queryClient)";
const SERVICE_HELPER = "refreshChatListAfterConversationChange()";

/** The source of `export (async )?function <name>(` up to the next top-level export. */
function exportedBody(source: string, name: string): string {
  const match = new RegExp(`export (async )?function ${name}\\(`).exec(source);
  assert(match, `${name} not found`);
  const start = match!.index;
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

/** The `onSuccess` handler text of a useMutation body (up to the next handler key). */
function onSuccessOf(body: string, name: string): string {
  const at = body.indexOf("onSuccess:");
  assert(at >= 0, `${name}: no onSuccess`);
  const rest = body.slice(at);
  const end = rest.search(/\n {4}(onError|onSettled|onMutate):/);
  return end === -1 ? rest : rest.slice(0, end);
}

Deno.test("#4261 H: chatListKeys.all is the #4265 list root", () => {
  assert(JSON.stringify(chatListKeys.all) === JSON.stringify(["chatList"]), "chatListKeys.all");
});

Deno.test("#4261 H: useChatPlans' helper invalidates the factory key", async () => {
  const src = await read("hooks/useChatPlans.ts");
  const helper = /function refreshChatList\(queryClient: QueryClient\): void \{([\s\S]*?)\n\}/.exec(src);
  assert(helper && helper[1].includes(DIRECT), "refreshChatList must invalidate chatListKeys.all");
});

for (const name of ["useCreatePlan", "useAddPlanTime", "useAddPlanPlace", "useLockPlan", "useUpdatePlan", "useCancelPlan"]) {
  Deno.test(`#4261 H: ${name} refreshes the Chats list on success`, async () => {
    const src = await read("hooks/useChatPlans.ts");
    const success = onSuccessOf(exportedBody(src, name), name);
    assert(success.includes(PLAN_HELPER), `${name}: onSuccess must call refreshChatList(queryClient)`);
  });
}

for (const name of ["useDecideJoinRequest", "useAddGroupMembers"]) {
  Deno.test(`#4261 H: ${name} refreshes the Chats list on success`, async () => {
    const src = await read("hooks/useGroupLink.ts");
    const success = onSuccessOf(exportedBody(src, name), name);
    assert(success.includes(DIRECT), `${name}: onSuccess must invalidate chatListKeys.all`);
  });
}

Deno.test("#4261 H: join-by-link refreshes the Chats list after a valid answer", async () => {
  const body = exportedBody(await read("services/groupLinkService.ts"), "joinGroupByLink");
  const call = body.indexOf(SERVICE_HELPER);
  assert(call > body.indexOf('throw new Error("invalid_response")'), "joinGroupByLink must refresh after validating the answer");
});

Deno.test("#4261 H: a claimed friend-share link refreshes the Chats list", async () => {
  const body = exportedBody(await read("services/pendingFriendInvite.ts"), "claimPendingFriendInvite");
  const share = body.slice(body.indexOf('if (kind === "share")'), body.indexOf("TERMINAL_REFUSALS"));
  assert(share.includes(SERVICE_HELPER), "the share-claim success path must refresh the Chats list");
});

Deno.test("#4261 H: chatListRefresh invalidates the factory key", async () => {
  const src = await read("services/chatListRefresh.ts");
  assert(src.includes(DIRECT), "chatListRefresh must invalidate chatListKeys.all");
});

Deno.test("#4261 H: a sent plan comment refreshes the Chats list", async () => {
  const src = await read("components/ConnectionsPage.tsx");
  assert(src.includes(`if (current.planId) void queryClient.${DIRECT};`), "plan comment send must invalidate chatListKeys.all");
});

Deno.test("#4261 H: no literal chatList key in the #4261 hooks", async () => {
  for (const file of ["hooks/useChatPlans.ts", "hooks/useGroupLink.ts", "hooks/useFriendShareLink.ts"]) {
    const src = await read(file);
    assert(!/\[\s*['"]chatList['"]/.test(src), `${file}: literal chatList key`);
  }
});

// ── A line I caused never reads as unread for me ─────────────────────────

const row = (conversationId: string | null, unread: number) => ({ conversationId, unread });

Deno.test("#4261 H own action: an open chat's clear row turning unread needs a read", () => {
  assert(openChatRowTurnedUnread(row("c1", 0), row("c1", 1)), "the refresh that beat the read receipt");
  assert(openChatRowTurnedUnread(row("c1", 0), row("c1", 3)), "any count");
});

Deno.test("#4261 H own action (adversarial): only that transition qualifies", () => {
  // Another member (or me, chat closed) keeps the unread count.
  assert(!openChatRowTurnedUnread(row(null, 0), row(null, 0)), "no chat open");
  assert(!openChatRowTurnedUnread(row("c1", 0), row(null, 0)), "chat just closed");
  // Opening a chat with unread keeps its own read flow and new-messages divider.
  assert(!openChatRowTurnedUnread(row(null, 0), row("c1", 2)), "opened an unread chat");
  assert(!openChatRowTurnedUnread(row("c1", 0), row("c2", 2)), "switched to an unread chat");
  // Not a loop: the same answer twice, or the row being cleared, does nothing.
  assert(!openChatRowTurnedUnread(row("c1", 1), row("c1", 1)), "same answer");
  assert(!openChatRowTurnedUnread(row("c1", 1), row("c1", 0)), "row cleared");
});

Deno.test("#4261 H own action (adversarial): the unread rule still counts system lines for everyone", () => {
  const calls: string[] = [];
  applyUnreadFilters("q", "me", {
    or: (q, filters) => (calls.push(`or:${filters}`), q),
    isNull: (q, column) => (calls.push(`isNull:${column}`), q),
    eq: (q, column, value) => (calls.push(`eq:${column}=${value}`), q),
  });
  assert(calls.includes("or:sender_id.neq.me,sender_id.is.null"), `another member still sees the line: ${calls}`);
});

Deno.test("#4261 H own action: mark-read covers system lines and only the chat it was given", async () => {
  const src = await read("services/messagingService.ts");
  const start = src.indexOf("async markConversationRead(");
  const body = src.slice(start, src.indexOf("subscribeToConversation(", start));
  assert(body.includes(".or(`sender_id.neq.${userId},sender_id.is.null`)"), "a bare neq skips NULL senders");
  assert(body.includes(".eq('conversation_id', conversationId)"), "scoped to this chat");
});

Deno.test("#4261 H own action: ConnectionsPage clears the open row without a list read", async () => {
  const src = await read("components/ConnectionsPage.tsx");
  const start = src.indexOf("const openChatRowRef = useRef(");
  assert(start >= 0, "open chat row tracking");
  const effect = src.slice(start, src.indexOf("// ── Auto-persist messagesCache", start));
  assert(effect.includes("openChatRowTurnedUnread(previous, next)"), "uses the rule");
  assert(/if \(turnedUnread && currentConversationId && user\?\.id\) \{\s*markConversationAsRead\(currentConversationId, user\.id, EMPTY_MESSAGES\);/.test(effect), "clears through the one mark-read path");
  assert(!/invalidateQueries|refetchQueries|fetchConversations/.test(effect), "no refetch storm: nothing here reads the list");
});

Deno.test("#4261 H own action: the tab badge leaves out the chat on screen, only that one", async () => {
  const src = await read("components/ConnectionsPage.tsx");
  assert(src.includes("conversations.filter((conv) => conv.id !== currentConversationId) as ChatListItemConversation[]"), "badge total");
});

Deno.test("#4261 H own action: leaving saves a pending read before the list refresh", async () => {
  const src = await read("components/ConnectionsPage.tsx");
  const start = src.indexOf("const handleBackFromMessage = useCallback(");
  const body = src.slice(start, src.indexOf("const handleGroupSessionNameUpdated", start));
  assert(body.includes("markConversationRead(currentConversationId, userId).then(() => fetchConversations(userId))"), "read, then refresh");
  assert(body.includes("queryClient.isFetching({ queryKey: chatListKeyRef.current }) > 0"), "bounded to a refresh in flight");
  assert(body.includes("openChatRowRef.current.turnedUnread"), "or a read this visit already started");
});
