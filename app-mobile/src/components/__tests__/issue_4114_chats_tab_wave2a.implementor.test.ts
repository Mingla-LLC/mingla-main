// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 2a — the Chats tab: label and icon, row anatomy, the
// pencil's New message sheet, pull-to-refresh reloading chats, the Archived
// row opening the archived list, the 3-pin limit and the muted grey badge.
// Behaviour of the list model is covered in
// connections/__tests__/issue_4114_chat_list_model.implementor.happy.test.ts;
// this suite pins the wiring so a revert of any call site fails CI.
//
// FAILS-ON-REVERT: `tabs.friends` / `people-outline` back in the tab bar; a
// Pair/Unpair/Pending button or the "Broadcast" label back in ChatListItem;
// handleRefresh without fetchConversations; the Archived row not opening the
// archived list; handleTogglePin without the canPinChat check; the badge hidden
// when muted.

const root = new URL("../../", import.meta.url);
const repo = new URL("../../../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function functionBody(source: string, signature: RegExp): string {
  const match = signature.exec(source);
  assert(match, `missing ${signature}`);
  const start = source.indexOf("{", match.index + match[0].length - 1);
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated body for ${signature}`);
}

const LOCALES = ["ar", "bin", "bn", "de", "el", "en", "es", "fr", "ha", "he", "hi", "id", "ig", "it", "ja", "ko", "ms", "nl", "pl", "pt", "ro", "ru", "sv", "th", "tr", "uk", "vi", "yo", "zh"];

Deno.test("#4114 tab: the Chats tab reads Chats with a chat icon; the page id stays connections", async () => {
  const index = stripComments(await Deno.readTextFile(new URL("app-mobile/app/index.tsx", repo)));
  assert(/connections: t\('navigation:tabs\.chats'\)/.test(index), "tab label uses navigation:tabs.chats");
  assert(!/navigation:tabs\.friends/.test(index), "the Friends tab label is gone");
  const nav = stripComments(await read("components/GlassBottomNav.tsx"));
  assert(/connections: 'chatbubbles-outline'/.test(nav), "tab icon is chatbubbles-outline");
  const en = JSON.parse(await read("i18n/locales/en/connections.json"));
  assert(en.title === "Chats", "English page title is Chats");
  const steps = await read("constants/coachMarkSteps.ts");
  assert(/Friends, requests and blocks live here\./.test(steps), "coachmark step 6 copy");
  assert(/Tap ✎ to start a chat or a group\./.test(steps), "coachmark step 7 points at the pencil");
});

Deno.test("#4114 row anatomy: flat row, no Pair button, no Broadcast label, grey badge when muted", async () => {
  const row = stripComments(await read("components/connections/ChatListItem.tsx"));
  assert(!/onPairPress|onUnpairPress|pairStatus|pairBtn|unpairBtn|pendingPairBadge/.test(row), "no Pair/Unpair/Pending control in a row");
  assert(!/"Broadcast"|'Broadcast'/.test(row), "no false Broadcast label");
  assert(!/Collab session/.test(row), "no Collab session pill");
  assert(!/marginVertical|borderRadius: 18|minHeight: 100/.test(row.slice(row.indexOf("const styles"))), "no card chrome");
  assert(/height: CHAT_ROW_HEIGHT/.test(row), "rows use the shared 72pt height");
  assert(/unreadBadge\(conversation, isMuted\)/.test(row), "badge state comes from the model with the mute flag");
  assert(/badge\.tone === 'muted' \? styles\.badgeMuted : styles\.badgeAccent/.test(row), "muted chats get the grey badge");
  assert(!/hasUnread = unreadCount > 0 && !isMuted/.test(row), "the old hide-when-muted rule stays deleted");
  assert(/from "react-native-gesture-handler\/ReanimatedSwipeable"/.test(row), "swipes use the Reanimated swipeable");
  // Wave 6: a brand channel row (several chats) offers no pin / mark-unread
  // swipe, except Unpin while one of its chats is pinned (#4114 rework).
  assert(/renderLeftActions=\{isBrandChannel && !isPinned \? undefined : renderLeftActions\}/.test(row) && /renderRightActions=\{renderRightActions\}/.test(row), "both swipe directions");
  assert(/canToggleUnread && !isBrandChannel \? \(/.test(row), "a brand row never offers mark unread");
  assert(/export const ChatListItem = React\.memo\(/.test(row), "rows are memoised");
  const page = stripComments(await read("components/ConnectionsPage.tsx"));
  assert(!/is_online: false/.test(page), "no hard-coded presence");
  assert(/getItemLayout=\{getItemLayout\}/.test(page), "the list uses getItemLayout");
});

Deno.test("#4114 header: people + pencil; the pencil opens New message; the + chooser and pills are gone", async () => {
  const page = stripComments(await read("components/ConnectionsPage.tsx"));
  assert(/ref=\{coachPlusButton\.targetRef[^}]*\}[\s\S]{0,120}onPress=\{openNewMessage\}/.test(page), "coach step 7 sits on the pencil, which opens New message");
  assert(/setShowNewMessageSheet\(true\)/.test(functionBody(page, /const openNewMessage = useCallback\(\(\) =>/)), "openNewMessage shows the sheet");
  assert(!/<FriendsActionChooserSheet\b/.test(page), "the + chooser is not mounted");
  assert(!/GlassPairedPill|pairControlsRow|activePairedPeople/.test(page), "the paired-pills strip left the screen");
  assert(!/<FriendPickerSheet\b/.test(page), "the never-opened FriendPickerSheet mount is gone");
  assert((page.match(/<BlockUserModal\b/g) ?? []).length === 1 && (page.match(/<ReportUserModal\b/g) ?? []).length === 1,
    "Block and Report modals mount once");
  assert(/usePairingPills\(/.test(page) && /useIncomingPairRequests\(/.test(page), "pairing data hooks stay alive for Wave 2b");
  const sheet = stripComments(await read("components/connections/NewMessageSheet.tsx"));
  assert(/createGroupChatDisabled\) onNewGroupPaywall\(\)/.test(sheet), "New group opens the paywall when gated");
  assert(/connections:plus_badge/.test(sheet), "New group shows the PLUS badge when gated");
  assert(/<NewMessageSheet[\s\S]{0,900}createGroupChatDisabled=\{!canCreateSession && !isUnlimited\}/.test(page), "same gate as the old chooser");
  assert(/onPickFriend=\{\(friend\) => \{[\s\S]{0,120}handlePickFriend\(friend\)/.test(page), "tapping a friend opens the 1:1 chat");
});

Deno.test("#4114 pull-to-refresh reloads chats and friends", async () => {
  const page = stripComments(await read("components/ConnectionsPage.tsx"));
  const refresh = functionBody(page, /const handleRefresh = useCallback\(async \(\) =>/);
  assert(/fetchConversations\(user\.id\)/.test(refresh), "refresh reloads chats");
  assert(/await fetchFriends\(\)/.test(refresh), "refresh reloads friends");
  assert(/onRefresh=\{handleRefresh\}/.test(page), "the list's RefreshControl uses it");
});

Deno.test("#4114 archived: one row at the end opens the full archived list", async () => {
  const page = stripComments(await read("components/ConnectionsPage.tsx"));
  assert(/case "archived":[\s\S]{0,400}setShowArchivedList\(true\)/.test(page), "the Archived row opens the archived list");
  assert(/else if \(showArchivedList\) \{[\s\S]{0,1600}data=\{archivedConversations\}/.test(page), "the archived view lists archived chats");
  assert(/onArchive=\{onRowUnarchive\}[\s\S]{0,200}isArchived/.test(page), "archived rows unarchive");
  assert(!/styles\.archivedSection\b|Archived \(\{archivedConversations\.length\}\)/.test(page), "the light block above the list is gone");
});

Deno.test("#4114 pins: the client checks the 3-pin limit before calling the server", async () => {
  const page = stripComments(await read("components/ConnectionsPage.tsx"));
  const toggle = functionBody(page, /const handleTogglePin = useCallback\(async \(conversation: ChatListItemConversation\) =>/);
  assert(/if \(pinning && !canPinChat\(/.test(toggle), "pinning a 4th chat is refused on the phone");
  assert(toggle.indexOf("canPinChat(") < toggle.indexOf("setConversationListState("), "the check runs before the server call");
  assert(/pinLimitReached/.test(toggle), "the server's pin_limit_reached is explained, not swallowed");
  const service = stripComments(await read("services/messagingService.ts"));
  assert(/rpc\('set_conversation_list_state'/.test(service), "pins write through the RPC");
  assert(/pinned_at: listStateByConversation\.get\(conv\.id\)\?\.pinned_at/.test(service), "pins arrive with the access read");
  const migration = await Deno.readTextFile(new URL("supabase/migrations/20271230014114_issue_4114_conversation_pins.sql", repo));
  assert(/IF v_pinned>=3 THEN/.test(migration) && /CREATE TRIGGER conversation_pin_limit/.test(migration), "the server trigger holds the limit too");
});

Deno.test("#4114 states: skeleton rows in lockstep with the tab scaffold, inline error, offline bar", async () => {
  const page = stripComments(await read("components/ConnectionsPage.tsx"));
  assert(/<ChatListSkeleton \/>/.test(page), "loading uses the 72pt row skeleton");
  assert(!/ActivityIndicator size="large"/.test(page), "no big spinner");
  assert(/connections:error_inline/.test(page) && /ListHeaderComponent=\{errorRow\}/.test(page), "inline error row above cached chats");
  assert(!/if \(error && conversations\.length === 0/.test(page), "no separate light error screen");
  assert(/connections:offline_bar/.test(page), "offline bar");
  const scaffold = stripComments(await read("components/navigation/TabSwitchScaffold.tsx"));
  assert(/<ChatListSkeleton rows=\{7\} \/>/.test(scaffold), "the tab scaffold renders the same skeleton component");
});

Deno.test("#4114 wave 2a copy exists in all 29 locales", async () => {
  const keys = ["people_button_a11y", "people_button_a11y_badge", "new_message_title", "new_group", "add_friend_row", "filter_all", "filter_unread",
    "filter_groups", "filter_events", "section_invites", "time_yesterday", "tag_event", "action_pin", "action_mark_unread", "action_mute",
    "action_archive", "pin_limit", "archived_row", "error_inline", "offline_bar", "invite_join", "empty_subtitle"];
  for (const locale of LOCALES) {
    const copy = JSON.parse(await read(`i18n/locales/${locale}/connections.json`));
    for (const key of keys) {
      assert(typeof copy[key] === "string" && copy[key].trim().length > 0, `${locale}/connections.json missing ${key}`);
    }
    assert(!/compose button/i.test(copy.empty_subtitle), `${locale} empty state no longer points at a compose button`);
  }
});
