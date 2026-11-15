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

Deno.test("F3-no-insert a send to a chat missing from the list refreshes nothing (only a brand-new chat refetches)", () => {
  const incoming = between(page, "const addIncomingMessageToUI = useCallback(", "[transformMessage, writeConversationMessages]");
  assert(!incoming.includes("refreshChatListAfterConversationChange"), "an incoming message never refreshes the list");
  assert(/prev\.map\(\(conv\)/.test(incoming), "the list is only mapped, never inserted into");
  assert(!page.includes("refreshChatListAfterConversationChange"), "ConnectionsPage never calls the list refresh after a send");
  assert(/if \(isNewChat\) fetchConversations\(user\.id\);/.test(page), "only a brand-new chat refetches");
});

Deno.test("F4-listener useSocialRealtime binds messages on a receiver_id filter", () => {
  const hook = read("src/hooks/useSocialRealtime.ts");
  assert(/table: "messages",\s*filter: `receiver_id=eq\.\$\{userId\}`/.test(hook), "messages bound on receiver_id");
  assert(!hook.includes("conversation_participant_lifecycle"), "no lifecycle listener today");
});

Deno.test("R10 a creator-only pending session row is a pending creator collab", () => {
  const load = read("src/components/connections/chatListLoad.ts");
  assert(/const isPendingCreatorCollab =\s*conv\.type === "group" &&/.test(load), "isPendingCreatorCollab is derived");
  assert(/sessionMeta\?\.created_by === userId &&\s*!hasAcceptedCollaborator/.test(load), "creator with no accepted collaborator");
  assert(/conversationMeta\.isPendingCreatorCollab && conversationMeta\.__pendingCollabChat/.test(page), "the row opens the pending sheet");
});
