// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 x #4111 (merge of PR #4131): a guest's brand enquiry is its own
// row kind ("enquiry") in the Wave 2a Chats list. It is never folded into
// that brand's channel, never shown under the Events filter, found by brand
// name in search (in the Chats section), and rendered by EnquiryChatListRow,
// whose tap opens app/enquiry/[enquiryId]. Enquiries come from their own query
// after the Explorer guest-only rule (D19) and the brand fold, so neither can
// hide them.
//
// FAILS-ON-REVERT: drop the "enquiry" item kind (conversationItem → always
// "chat"), let enquiries into the Events filter, render them with
// ChatListItem, or feed them through the brand fold / D19, and a case fails.

import { buildBrowseItems, buildSearchItems, chatListItemHeight, CHAT_ROW_HEIGHT } from "../chatListModel.ts";
import { foldBrandChannels } from "../brandChannelModel.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}
const read = (rel: string) => Deno.readTextFile(new URL(rel, import.meta.url));
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const BRAND = "brand-lantern";
// The two Lantern Room event chats a guest has (they fold into one channel).
const eventChat = (id: string, at: string) => ({
  id,
  created_at: at,
  type: "group",
  name: `Event ${id}`,
  linked_entity_type: "event",
  event_id: `evt-${id}`,
  eventBrandId: BRAND,
  eventBrandName: "Lantern Room",
  participants: [{ id: "me" }, { id: "host" }],
  last_message: { content: "See you there", created_at: at },
  unread_count: 0,
});
// The shape toEnquiryConversation (#4111) produces.
const enquiry = (id: string, at: string, unread = 0) => ({
  id: `conv-${id}`,
  name: "Lantern Room",
  linked_entity_type: "brand_enquiry",
  created_at: at,
  participants: [],
  unread_count: unread,
  last_message: { content: "Yes, ramp at the side door.", created_at: at },
  isEnquiry: true,
  chatKind: "enquiry",
  enquiry: { enquiryId: id, brandId: BRAND, brandName: "Lantern Room", topicLabel: "Access needs" },
});
const dm = { id: "dm-1", created_at: "2026-10-20T09:00:00Z", type: "direct", participants: [{ id: "me" }, { id: "ana" }] };

Deno.test("an enquiry to a brand stays its own row next to that brand's folded channel", () => {
  const fold = foldBrandChannels([eventChat("a", "2026-10-20T08:00:00Z"), eventChat("b", "2026-10-20T07:00:00Z"), dm], null);
  const active = [...fold.rows, enquiry("e1", "2026-10-20T11:00:00Z", 1)];
  const items = buildBrowseItems({ active, archivedCount: 0, filter: "all" });
  assertEquals(items.map((item) => item.kind), ["enquiry", "chat", "chat"], "enquiry first by recency, then DM and channel");
  const enquiryItem = items[0];
  assertEquals(enquiryItem.conversation.id, "conv-e1", "the enquiry row is the enquiry");
  assert(items.filter((item) => item.kind === "chat").some((item) => item.conversation.__brandChannel), "the brand channel row is there");
  const channel = items.find((item) => item.conversation?.__brandChannel)?.conversation.__brandChannel;
  assertEquals(channel.events.map((event) => event.conversationId).sort(), ["a", "b"], "the channel holds only the event chats");
  // Even fed through the fold, an enquiry is never a channel member.
  const refold = foldBrandChannels([eventChat("a", "2026-10-20T08:00:00Z"), enquiry("e1", "2026-10-20T11:00:00Z")], null);
  assert(refold.rows.some((row) => row.id === "conv-e1" && !row.__brandChannel), "the enquiry survives the fold as itself");
  assertEquals(chatListItemHeight("enquiry"), CHAT_ROW_HEIGHT, "same 72pt row geometry");
});

Deno.test("two enquiries to the same brand are two rows", () => {
  const items = buildBrowseItems({
    active: [enquiry("e1", "2026-10-20T11:00:00Z"), enquiry("e2", "2026-10-19T11:00:00Z")],
    archivedCount: 0,
    filter: "all",
  });
  assertEquals(items.map((item) => `${item.kind}:${item.conversation.id}`), ["enquiry:conv-e1", "enquiry:conv-e2"], "never merged");
});

Deno.test("filters: Events and Groups never show enquiries; Unread shows an unread one", () => {
  const active = [eventChat("a", "2026-10-20T08:00:00Z"), enquiry("e1", "2026-10-20T11:00:00Z", 2)];
  assertEquals(buildBrowseItems({ active, archivedCount: 0, filter: "events" }).map((i) => i.kind), ["chat"], "events");
  assertEquals(buildBrowseItems({ active, archivedCount: 0, filter: "groups" }).length, 0, "groups");
  assertEquals(buildBrowseItems({ active, archivedCount: 0, filter: "unread" }).map((i) => i.kind), ["enquiry"], "unread");
});

Deno.test("search lists a matched enquiry under Chats as an enquiry row, not under Events", () => {
  const items = buildSearchItems({
    matchedChats: [eventChat("a", "2026-10-20T08:00:00Z"), enquiry("e1", "2026-10-20T11:00:00Z")],
    friends: [],
    allConversations: [],
    currentUserId: "me",
    query: "lantern",
  });
  assertEquals(
    items.map((item) => (item.kind === "section" ? `section:${item.section}` : item.kind)),
    ["section:chats", "enquiry", "section:events", "chat"],
    "enquiry in Chats, event chat in Events",
  );
});

Deno.test("the page renders enquiry rows with EnquiryChatListRow, fed after D19 and the fold, refreshed on pull", async () => {
  const page = stripComments(await read("../../ConnectionsPage.tsx"));
  assert(
    /case "enquiry": \{[\s\S]{0,200}?<EnquiryChatListRow\s+conversation=\{item\.conversation\}\s+onPress=\{enquiryRows\.open\}/.test(page),
    "the enquiry case renders EnquiryChatListRow and opens the enquiry route",
  );
  assert(
    /mergeEnquiryConversations\(listConversations, enquiryRows\.conversations, ""\)/.test(page) &&
      /active: browseConversations/.test(page),
    "browse merges enquiries after the brand fold (listConversations = brandFold.rows)",
  );
  assert(
    /mergeEnquiryConversations\(filteredConversations, enquiryRows\.conversations, searchQuery\)/.test(page) &&
      /matchedChats: visibleConversations/.test(page),
    "search finds enquiries",
  );
  assert(!/explorerConversations\([^)]*enquiry/i.test(page) && !/foldBrandChannels\([^)]*enquiry/i.test(page), "never through D19 or the fold");
  assert(
    /const handleRefresh = useCallback\(async \(\) => \{[\s\S]{0,400}?await fetchFriends\(\);\s*await enquiryRows\.refetch\(\);\s*await chats;/.test(page),
    "pull to refresh: chats, friends (awaited), then enquiries",
  );
  const row = stripComments(await read("../../brandEnquiry/EnquiryChatListRow.tsx"));
  assert(/height: CHAT_ROW_HEIGHT/.test(row) && /size=\{CHAT_AVATAR_SIZE\}/.test(row), "72pt row, 52pt avatar");
  assert(/<EnquiryBrandAvatar/.test(row) && /<EnquiryTag/.test(row), "their avatar and tag");
  const hook = stripComments(await read("../../brandEnquiry/useEnquiryChatRows.ts"));
  assert(/router\.push\(`\/enquiry\/\$\{encodeURIComponent\(conversation\.enquiry\.enquiryId\)\}`/.test(hook), "tap opens app/enquiry/[enquiryId]");
});
