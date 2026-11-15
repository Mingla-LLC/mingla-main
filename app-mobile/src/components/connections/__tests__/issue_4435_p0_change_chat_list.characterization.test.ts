// @ts-nocheck — Deno-runtime suite; app-mobile's broad tsc sweep includes
// Deno suites that are not configured for that command.
//
// #4435 Phase 0 characterization (CHANGE). Today's chat list behaviour the
// #4435 build changes on purpose. Each test is named by its rule tag; the build
// may change only a tagged test, only in the wave that implements that rule,
// and the commit message names the tag.
const root = new URL("../../../../", import.meta.url);
const read = (p: string): string => Deno.readTextFileSync(new URL(p, root));
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function between(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert(start >= 0, `marker ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert(end > start, `marker ${to} after ${from}`);
  return source.slice(start, end);
}

const page = read("src/components/ConnectionsPage.tsx");

Deno.test("F3-no-insert [#4435 W3] a message in a chat missing from the list refetches the list (no hand-built row)", () => {
  const incoming = between(page, "const addIncomingMessageToUI = useCallback(", "[transformMessage, writeConversationMessages, refreshListIfMissing]");
  assert(incoming.includes("refreshListIfMissing(conversationId);"), "an incoming message into an unlisted chat refetches");
  assert(/prev\.map\(\(conv\)/.test(incoming), "the list is only mapped, never inserted into");
  assert(/if \(isNewChat\) fetchConversations\(user\.id\);\s*else refreshListIfMissing\(conversationId\);/.test(page), "a send to an unlisted chat refetches");
  assert(/if \(!listedConversationIdsRef\.current\.has\(conversationId\)\) refreshChatListAfterConversationChange\(\);/.test(page), "only when missing from the list");
});

Deno.test("F4-listener [#4435 W3] useSocialRealtime listens to my lifecycle rows, not messages.receiver_id", () => {
  const hook = read("src/hooks/useSocialRealtime.ts");
  assert(!/table: "messages"/.test(hook), "no messages binding");
  assert(/table: "conversation_participant_lifecycle",\s*filter: `user_id=eq\.\$\{userId\}`/.test(hook), "lifecycle rows filtered to me");
  assert(/invalidateQueries\(\{ queryKey: chatListKeys\.all \}\)/.test(hook), "the Chats list refetches");
});

Deno.test("R10 a creator-only pending session row is a pending creator collab", () => {
  const load = read("src/components/connections/chatListLoad.ts");
  assert(/const isPendingCreatorCollab =\s*conv\.type === "group" &&/.test(load), "isPendingCreatorCollab is derived");
  assert(/sessionMeta\?\.created_by === userId &&\s*!hasAcceptedCollaborator/.test(load), "creator with no accepted collaborator");
  assert(/conversationMeta\.isPendingCreatorCollab && conversationMeta\.__pendingCollabChat/.test(page), "the row opens the pending sheet");
});
