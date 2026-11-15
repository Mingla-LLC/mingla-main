// @ts-nocheck — Deno-runtime suite; app-mobile's broad tsc sweep includes
// Deno suites that are not configured for that command.
//
// #4435 Clear chat (for me only), the removed-chat copy and the deck's
// group-of-one state.
import { buildFriendMenu } from "../../../utils/chatMenuModel.ts";

const root = new URL("../../../../", import.meta.url);
const read = (p: string): string => Deno.readTextFileSync(new URL(p, root));
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const chatCtx = {
  surface: "chat", isFriend: true, pairState: "none", canOpenPairedView: false, canUnpair: false,
  canViewProfile: true, hasConversation: true, isMuted: false,
};

Deno.test("#4435 Clear chat is the last item of the 1:1 menu, only with a conversation", () => {
  const ids = buildFriendMenu(chatCtx).map((item) => item.id);
  assert(ids[ids.length - 1] === "clearChat", "last item");
  assert(!buildFriendMenu({ ...chatCtx, hasConversation: false }).some((item) => item.id === "clearChat"), "no conversation, no clear");
  assert(!buildFriendMenu({ ...chatCtx, surface: "friendSheet" }).some((item) => item.id === "clearChat"), "not on the friends sheet");
});

Deno.test("#4435 Clear chat calls set_conversation_lifecycle('clear') and empties the local copy", () => {
  const service = read("src/services/messagingService.ts");
  assert(/async clearConversation\(conversationId: string\)[\s\S]{0,300}p_action: 'clear'/.test(service), "clear action");
  assert(/from\('conversation_participant_lifecycle'\)\s*\.select\('cleared_at'\)/.test(service), "the thread reads my own cutoff");
  const page = read("src/components/ConnectionsPage.tsx");
  const start = page.indexOf("const handleClearChat = useCallback(");
  assert(start > 0, "page handler");
  const body = page.slice(start, page.indexOf("\n  }, [", start));
  assert(/AsyncStorage\.removeItem\(getMessagesCacheKey\(conversationId\)\)/.test(body), "the saved copy is removed so cleared messages never come back from cache");
  assert(/mergeMessages\(EMPTY_MESSAGES, EMPTY_MESSAGES\)/.test(body), "the store restarts empty");
  assert(/showToast\(\{ message: t\('chat:clear_failed'\), type: 'error' \}\)/.test(body), "a failure shows the red toast and changes nothing");
  assert(/return false;[\s\S]*AsyncStorage/.test(body), "nothing local changes before the server cleared it");
  assert(page.includes("onClearChat={handleClearChat}"), "wired to the thread");
});

Deno.test("#4435 the thread confirms, shows Clearing... and the quiet cleared row; group info has the row", () => {
  const thread = read("src/components/MessageInterface.tsx");
  assert(thread.includes('case "clearChat":'), "menu case");
  assert(/t\("chat:clear_confirm_body_dm", \{ name: otherName \}\)/.test(thread) && thread.includes('t("chat:clear_confirm_body_group")'), "1:1 and group confirm copy");
  assert(thread.includes('t("chat:clearing")') && thread.includes('t("chat:cleared_notice")'), "loading and cleared rows");
  const info = read("src/components/chat/GroupInfoSheet.tsx");
  assert(/onPress=\{onClearChat\}/.test(info) && info.includes('t("chat:menuClearChat")'), "group info row");
});

Deno.test("#4435 copy: removed chats come back when either of you writes; every locale has the new keys", () => {
  const en = JSON.parse(read("src/i18n/locales/en/connections.json"));
  assert(en.remove_chat_body === "Removes it from your list. It comes back when either of you sends a message.", "remove copy");
  const keys = ["menuClearChat", "clear_confirm_title", "clear_confirm_body_dm", "clear_confirm_body_group", "clear_action",
    "clearing", "cleared_notice", "clear_failed", "group_full_toast", "group_creator_protected", "group_last_admin",
    "group_not_allowed", "group_action_failed"];
  for (const entry of Deno.readDirSync(new URL("src/i18n/locales/", root))) {
    if (!entry.isDirectory) continue;
    const chat = JSON.parse(read(`src/i18n/locales/${entry.name}/chat.json`));
    for (const key of keys) assert(typeof chat[key] === "string" && chat[key].length > 0, `${entry.name} chat.${key}`);
    assert(chat.clear_confirm_body_dm.includes("{{name}}"), `${entry.name} keeps {{name}}`);
    const cards = JSON.parse(read(`src/i18n/locales/${entry.name}/cards.json`));
    for (const key of ["swipeable.solo_title", "swipeable.solo_share_link", "swipeable.solo_add_people"]) {
      assert(typeof cards[key] === "string" && cards[key].length > 0, `${entry.name} cards.${key}`);
    }
  }
});

Deno.test("#4435 a group of one: the deck says add a friend, with Share link and Add people", () => {
  const deck = read("src/components/SwipeableCards.tsx");
  const start = deck.indexOf("case 'WAITING_FOR_PARTICIPANTS':");
  const body = deck.slice(start, deck.indexOf("case 'EMPTY_POOL':", start));
  assert(body.includes("t('cards:swipeable.solo_title')"), "title");
  assert(/onShareGroupLink \?/.test(body) && /onAddGroupPeople \?/.test(body), "both buttons when the host passes them");
  assert(!body.includes("Waiting for friends to join"), "old copy gone");
  const host = read("src/components/MessageInterface.tsx");
  assert(/onShareGroupLink=\{conversationId \?/.test(host) && /onAddGroupPeople=\{friend\.sessionId \?/.test(host), "the chat deck host wires both");
});
