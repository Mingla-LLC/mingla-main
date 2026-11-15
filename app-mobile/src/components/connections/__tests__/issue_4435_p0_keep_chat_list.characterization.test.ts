// @ts-nocheck — Deno-runtime suite; app-mobile's broad tsc sweep includes
// Deno suites that are not configured for that command.
//
// #4435 Phase 0 characterization (KEEP). Frozen for the whole #4435 build:
// if one of these fails after a build wave, the wave is wrong, not this file.
// Pins the chat list behaviour the build must not change.
import { chatListKeys } from "../../../hooks/queryKeys.ts";
import { buildFriendMenu, FRIEND_MENU_ORDER } from "../../../utils/chatMenuModel.ts";

const root = new URL("../../../../", import.meta.url);
const read = (p: string): string => Deno.readTextFileSync(new URL(p, root));
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function equals(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
/** The body of `const <name> = useCallback(` up to the next top-level hook. */
function callbackBody(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = useCallback(`);
  assert(start >= 0, `${name} exists`);
  const end = source.indexOf("\n  }, [", start);
  assert(end > start, `${name} has a dependency list`);
  return source.slice(start, end);
}

const page = read("src/components/ConnectionsPage.tsx");

Deno.test("#4435 P0 KEEP removing a 1:1 chat hides it for me and drops the row", () => {
  const body = callbackBody(page, "handleDeleteChat");
  assert(/runLifecycle\(conversationId, 'hide'\)/.test(body), "1:1 remove calls set_conversation_lifecycle('hide') through runLifecycle");
  assert(/setConversations\(prev => prev\.filter\(c => c\.id !== conversationId\)\)/.test(body), "the removed row leaves the list");
  assert(/messagingService\.leaveGroupConversation\(conversationId/.test(body), "a group remove leaves the group");
  const run = callbackBody(page, "runLifecycle");
  assert(/messagingService\.setConversationLifecycle\(conversationId, action\)/.test(run), "lifecycle goes through messagingService");
});

Deno.test("#4435 P0 KEEP the list keeps only rows the access RPC returns", () => {
  const service = read("src/services/messagingService.ts");
  assert(service.includes("supabase.rpc('list_connection_conversation_access')"), "the list reads the access RPC");
  const load = read("src/components/connections/chatListLoad.ts");
  assert(/access/i.test(load), "chatListLoad filters by access");
});

Deno.test("#4435 P0 KEEP chatListKeys shape", () => {
  equals(chatListKeys.all, ["chatList"], "all");
  equals(chatListKeys.list("u1"), ["chatList", "list", "u1"], "list(userId)");
});

Deno.test("#4435 P0 KEEP unread anti-join select is unchanged", () => {
  const service = read("src/services/messagingService.ts");
  assert(service.includes("supabase.from('messages').select(UNREAD_MESSAGES_SELECT)"), "unread query uses UNREAD_MESSAGES_SELECT");
  assert(/applyUnreadFilters\(/.test(service), "unread filters applied server-side");
});

Deno.test("#4435 P0 KEEP pin, mark unread, mute and archive actions are wired", () => {
  for (const marker of ["handleArchiveChat", "set_conversation_list_state", "mark_unread"]) {
    assert(page.includes(marker) || read("src/services/messagingService.ts").includes(marker), `${marker} is wired`);
  }
  assert(/runLifecycle\(conversationId, 'archive'\)/.test(page), "archive goes through runLifecycle");
  assert(/mutedUserIds/.test(page), "mute state is read by the chat actions");
});

Deno.test("#4435 P0 KEEP the 1:1 chat menu items today are a stable prefix", () => {
  const today = [
    "startCollab", "endCollab", "viewProfile", "media", "shareCard", "addToSession", "mute",
    "pairedView", "sendPair", "pairPending", "unpair", "removeFriend", "report", "block",
  ];
  equals(FRIEND_MENU_ORDER.slice(0, today.length), today, "menu order prefix");
  const items = buildFriendMenu({
    surface: "chat", isFriend: true, pairState: "none", canOpenPairedView: false, canUnpair: false,
    canViewProfile: true, hasConversation: true, isMuted: false, canStartCollab: true,
  }).map((item) => item.id);
  equals(items.slice(0, 8), ["startCollab", "viewProfile", "media", "shareCard", "addToSession", "mute", "removeFriend", "report"], "1:1 menu items (prefix)");
  assert(items.includes("block"), "block stays");
});
