// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 2a — the Chats list model: pins (max 3, pinned first), the
// muted grey badge, the Archived row at the END of the list, filters, the
// time label and search grouping.
//
// FAILS-ON-REVERT: delete the `pinnedCount(...) < MAX_PINNED_CHATS` check in
// canPinChat and a 4th pin is allowed; make unreadBadge hide muted chats
// (`visible: !isMuted`) and the muted case fails; push the archived row first
// and the end-of-list case fails.

import {
  CHAT_ARCHIVED_ROW_HEIGHT,
  CHAT_ROW_HEIGHT,
  CHAT_SECTION_LABEL_HEIGHT,
  CHAT_SEPARATOR_INSET,
  MAX_PINNED_CHATS,
  buildBrowseItems,
  buildSearchItems,
  canPinChat,
  chatKind,
  chatListLayouts,
  formatChatListTime,
  matchesChatFilter,
  sortChatList,
  unreadBadge,
} from "../chatListModel.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}

const ME = "me";
function chat(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    created_at: "2026-10-01T10:00:00.000Z",
    type: "direct",
    participants: [{ id: ME }, { id: `friend-${id}` }],
    last_message: { content: "hi", created_at: "2026-10-20T10:00:00.000Z" },
    unread_count: 0,
    pinned_at: null,
    ...extra,
  };
}

Deno.test("#4114 pins: at most 3, re-pinning a pinned chat is allowed, pinned sort first in pin order", () => {
  assertEquals(MAX_PINNED_CHATS, 3, "the limit is 3");
  const list = [
    chat("a", { pinned_at: "2026-10-20T09:00:00.000Z" }),
    chat("b", { pinned_at: "2026-10-20T08:00:00.000Z" }),
    chat("c", { pinned_at: "2026-10-20T10:00:00.000Z" }),
    chat("d", { last_message: { content: "new", created_at: "2026-10-25T10:00:00.000Z" } }),
  ];
  assert(!canPinChat(list, "d"), "a 4th pin must be refused");
  assert(canPinChat(list, "a"), "an already pinned chat can be re-pinned / unpinned");
  assert(canPinChat(list.slice(1), "d"), "with 2 pins a 3rd is allowed");
  assertEquals(sortChatList(list).map((c) => c.id), ["b", "a", "c", "d"],
    "pinned chats come first in the order they were pinned, then the newest activity");
});

Deno.test("#4114 badge: orange when unread, grey (not hidden) when muted, empty for marked unread", () => {
  assertEquals(unreadBadge(chat("x", { unread_count: 2 }), false), { visible: true, tone: "accent", label: "2" }, "unread");
  assertEquals(unreadBadge(chat("x", { unread_count: 2 }), true), { visible: true, tone: "muted", label: "2" },
    "a muted chat still shows its count, in grey");
  assertEquals(unreadBadge(chat("x", { unread_count: 120 }), false).label, "99+", "caps at 99+");
  assertEquals(unreadBadge(chat("x", { marked_unread_at: "2026-10-25T10:00:00.000Z" }), false),
    { visible: true, tone: "accent", label: "" }, "marked unread shows an empty badge, never a made-up count");
  assertEquals(unreadBadge(chat("x"), true).visible, false, "nothing unread, no badge");
});

Deno.test("#4114 browse list: Invites section first, chats, and one Archived row at the END", () => {
  const invite = chat("pending-invite-1", { type: "group", __pendingInvite: { inviteId: "1" } });
  const items = buildBrowseItems({ active: [chat("a"), invite, chat("b")], archivedCount: 2, filter: "all" });
  assertEquals(items.map((i) => i.kind), ["section", "invite", "section", "chat", "chat", "archived"],
    "invites under their label, then chats, then the archived row last");
  assertEquals(items[items.length - 1], { kind: "archived", key: "archived", count: 2 }, "archived row carries the count");
  const noArchive = buildBrowseItems({ active: [chat("a")], archivedCount: 0, filter: "all" });
  assert(!noArchive.some((i) => i.kind === "archived"), "no archived row when nothing is archived");
  const layouts = chatListLayouts(items);
  assertEquals(layouts.map((l) => l.length),
    [CHAT_SECTION_LABEL_HEIGHT, CHAT_ROW_HEIGHT, CHAT_SECTION_LABEL_HEIGHT, CHAT_ROW_HEIGHT, CHAT_ROW_HEIGHT, CHAT_ARCHIVED_ROW_HEIGHT],
    "fixed heights for getItemLayout");
  assertEquals(layouts[3].offset, CHAT_SECTION_LABEL_HEIGHT * 2 + CHAT_ROW_HEIGHT, "offsets are prefix sums");
  assertEquals(CHAT_ROW_HEIGHT, 72, "rows are 72pt");
  assertEquals(CHAT_SEPARATOR_INSET, 78, "the hairline starts at the text edge (14 + 52 + 12)");
});

Deno.test("#4114 filters: All / Unread / Groups / Events", () => {
  const group = chat("g", { type: "group", linked_entity_type: "session" });
  const event = chat("e", { type: "group", linked_entity_type: "event" });
  const trip = chat("t", { type: "group", linked_entity_type: "trip" });
  const unread = chat("u", { unread_count: 1 });
  const marked = chat("m", { marked_unread_at: "2026-10-25T10:00:00.000Z" });
  assertEquals(chatKind(group), "group", "session groups are collab groups");
  assertEquals(chatKind(trip), "event", "trip chats are event chats");
  assertEquals(chatKind(chat("d")), "direct", "direct chat");
  const all = [group, event, trip, unread, marked, chat("plain")];
  assertEquals(all.filter((c) => matchesChatFilter(c, "unread")).map((c) => c.id), ["u", "m"], "unread includes marked unread");
  assertEquals(all.filter((c) => matchesChatFilter(c, "groups")).map((c) => c.id), ["g"], "groups");
  assertEquals(all.filter((c) => matchesChatFilter(c, "events")).map((c) => c.id), ["e", "t"], "events and trips");
  const filtered = buildBrowseItems({ active: all, archivedCount: 3, filter: "groups" });
  assert(!filtered.some((i) => i.kind === "archived"), "the archived row belongs to All only");
});

Deno.test("#4114 time label: 9:38, Yesterday, weekday, then date", () => {
  const now = new Date(2026, 9, 25, 15, 0, 0);
  assert(/9[:.]38/.test(formatChatListTime(new Date(2026, 9, 25, 9, 38).toISOString(), now, "en-GB", "Yesterday")), "same day shows the time");
  assertEquals(formatChatListTime(new Date(2026, 9, 24, 23, 0).toISOString(), now, "en-GB", "Yesterday"), "Yesterday", "yesterday");
  assertEquals(formatChatListTime(new Date(2026, 9, 21, 12, 0).toISOString(), now, "en-GB", "Yesterday"), "Wed", "within a week shows the weekday");
  assert(/^12 Sep/.test(formatChatListTime(new Date(2026, 8, 12, 12, 0).toISOString(), now, "en-GB", "Yesterday")), "older shows the date");
  assertEquals(formatChatListTime(null, now, "en-GB", "Yesterday"), "", "no message, no time");
});

Deno.test("#4114 search: Chats, Friends not chatted yet, then event chats", () => {
  const direct = chat("a", { participants: [{ id: ME }, { id: "ada" }] });
  const event = chat("e", { type: "group", linked_entity_type: "event", participants: [{ id: ME }] });
  const friends = [
    { id: "f1", user_id: ME, friend_user_id: "ada", display_name: "Ada Okafor" },
    { id: "f2", user_id: "bisi", friend_user_id: ME, display_name: "Bisi Adeyemi" },
  ];
  const items = buildSearchItems({ matchedChats: [direct, event], friends, allConversations: [direct, event], currentUserId: ME, query: "a" });
  assertEquals(items.map((i) => i.key), ["section:chats", "a", "section:friends", "friend:f2", "section:events", "e"],
    "Ada already has a chat so only Bisi is offered under Friends; event chats get their own section");
});
