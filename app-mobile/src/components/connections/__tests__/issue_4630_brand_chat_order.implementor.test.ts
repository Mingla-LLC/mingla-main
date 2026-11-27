// INVARIANT issue-4630-brand-chat-never-sorted-by-created-at: a brand Guest chat row is ordered by max(my brand activity, its last message) (last message only when the activity read failed, else 0); never by the chat's created_at.
// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// #4630 — Explorer brand chats: the Chats list order, the row copy and the
// locale keys.
//
// FAILS-ON-REVERT: put `|| conversation.created_at` back into the brand branch
// of chatActivityTime and the SC-1 / SC-5 cases fail; drop the activity read
// from loadChatList and the load case fails; give the row back its
// "<Brand> Guests" name or the Guests tag and the row guard fails; restore a
// deleted key in any locale and the locale case fails.
import {
  buildBrowseItems,
  buildSearchItems,
  chatActivityTime,
  chatListTimeIso,
  sortChatList,
} from "../chatListModel.ts";
import { brandActivityAt, loadChatList, parseBrandChatActivityRows } from "../chatListLoad.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function eq(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n  expected ${b}\n  actual   ${a}`);
}
const root = new URL("../../../", import.meta.url);
const read = (rel: string) => Deno.readTextFileSync(new URL(rel, root));

const NOW = Date.parse("2026-11-26T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();
// Every brand's chat was created the day #4475 was applied (the root cause).
const CHAT_CREATED = daysAgo(1);

const brand = (id: string, extra = {}) => ({
  id, created_at: CHAT_CREATED, type: "group", linked_entity_type: "brand_guests", brand_id: `b-${id}`,
  name: `Brand ${id}`, participants: [{ id: "me" }], unread_count: 0, last_message: null,
  brand_activity_known: true, brand_activity_at: null, ...extra,
});
const dm = (id: string, lastAt: string, extra = {}) => ({
  id, created_at: daysAgo(400), type: "direct", participants: [{ id: "me" }, { id: `p-${id}` }], unread_count: 0,
  last_message: { content: "hi", created_at: lastAt, sender_id: `p-${id}` }, ...extra,
});

Deno.test("#4630 SC-1 an empty brand chat sits by my last booking, not by the chat's creation", () => {
  const b = brand("empty", { brand_activity_at: daysAgo(10) });
  const recent = dm("recent", daysAgo(2));
  const old = dm("old", daysAgo(20));
  eq(sortChatList([b, old, recent]).map((c) => c.id), ["recent", "empty", "old"], "below a DM from 2 days ago, above one from 20 days ago");
  eq(chatActivityTime(b), NOW - 10 * 86400000, "ordered by the booking 10 days ago");
  eq(chatListTimeIso(b), daysAgo(10), "the time label shows the same 10 days ago");
});

Deno.test("#4630 SC-2 / SC-3 any message (brand post, another guest, mine) moves the row (Q2)", () => {
  const b = brand("live", { brand_activity_at: daysAgo(10) });
  const recent = dm("recent", daysAgo(2));
  eq(sortChatList([recent, b]).map((c) => c.id), ["recent", "live"], "before the message");
  // Realtime and optimistic sends write last_message through the one list write path.
  for (const sender of [{ sender_kind: "brand", sender_id: null }, { sender_kind: "guest", sender_id: "other" }, { sender_id: "me" }]) {
    const moved = { ...b, last_message: { content: "x", created_at: new Date(NOW).toISOString(), ...sender } };
    eq(sortChatList([recent, moved]).map((c) => c.id), ["live", "recent"], `moves to the top (${JSON.stringify(sender)})`);
    eq(chatListTimeIso(moved), new Date(NOW).toISOString(), "and shows the message time");
  }
});

Deno.test("#4630 SC-5 a failed activity read: last message only, an empty brand row sinks (never on top)", () => {
  const unknownEmpty = brand("unknown", { brand_activity_known: false, brand_activity_at: null });
  const unknownWithPost = brand("posted", { brand_activity_known: false, last_message: { content: "x", created_at: daysAgo(5), sender_kind: "brand" } });
  const old = dm("old", daysAgo(300));
  eq(sortChatList([unknownEmpty, unknownWithPost, old]).map((c) => c.id), ["posted", "old", "unknown"], "the empty one is last");
  eq(chatActivityTime(unknownEmpty), 0, "0, never created_at");
  eq(chatListTimeIso(unknownEmpty), null, "no time label rather than a made-up one");
  // Known but no booking and no message either: still never created_at.
  eq(chatActivityTime(brand("none")), 0, "known with nothing: 0");
});

Deno.test("#4630 pins stay first; a Removed row keeps its removal time; other kinds are unchanged", () => {
  const pinnedBrand = brand("pinned", { pinned_at: daysAgo(1), brand_activity_at: daysAgo(100) });
  const recent = dm("recent", daysAgo(0.1));
  eq(sortChatList([recent, pinnedBrand]).map((c) => c.id), ["pinned", "recent"], "a user pin leads");
  const removed = brand("removed-brand-guests:b9", { __removedBrandGuests: { brandId: "b9" }, created_at: daysAgo(3), brand_activity_known: false });
  eq(chatActivityTime(removed), NOW - 3 * 86400000, "removedAt (its created_at)");
  const group = { id: "g", created_at: daysAgo(4), type: "group", linked_entity_type: "session", participants: [], unread_count: 0 };
  eq(chatActivityTime(group), NOW - 4 * 86400000, "an empty group still uses its created_at");
  eq(chatListTimeIso(dm("x", daysAgo(2))), daysAgo(2), "a DM label is its last message");
});

Deno.test("#4630 browse, search and the archived list share the one activity time (F-8)", () => {
  const b = brand("b", { brand_activity_at: daysAgo(10) });
  const recent = dm("recent", daysAgo(2));
  const old = dm("old", daysAgo(20));
  eq(buildBrowseItems({ active: sortChatList([old, b, recent]), archivedCount: 0, filter: "all" }).map((i) => i.key),
    ["recent", "b", "old"], "browse");
  const search = buildSearchItems({ matchedChats: [old, b, recent], friends: [], allConversations: [old, b, recent], currentUserId: "me", query: "b" });
  const brandsSection = search.filter((i) => i.kind !== "section").map((i) => i.key);
  assert(brandsSection.includes("b"), "search lists the brand row");
  const page = read("components/ConnectionsPage.tsx");
  const at = page.indexOf("const archivedConversations = useMemo(");
  const body = page.slice(at, at + 400);
  assert(body.includes("chatActivityTime(b as ChatListItemConversation) - chatActivityTime(a as ChatListItemConversation)"),
    "the archived list sorts by chatActivityTime");
  assert(!body.includes("a.last_message?.created_at || a.created_at"), "no second copy of the activity rule");
});

Deno.test("#4630 the list load reads my brand activity in wave 1 and tags every Guest chat row", async () => {
  const order: string[] = [];
  const deps = {
    getConversations: async () => {
      order.push("conversations");
      return {
        error: null,
        conversations: [
          { id: "bg1", type: "group", linked_entity_type: "brand_guests", brand_id: "b1", name: "B1", created_at: CHAT_CREATED, participants: [{ user_id: "me" }] },
          { id: "bg2", type: "group", linked_entity_type: "brand_guests", brand_id: "b2", name: "B2", created_at: CHAT_CREATED, participants: [{ user_id: "me" }] },
          { id: "d1", type: "direct", created_at: daysAgo(30), participants: [{ user_id: "me" }, { user_id: "you" }] },
        ],
      };
    },
    fetchBrandChatActivity: async () => {
      order.push("activity");
      return parseBrandChatActivityRows([
        { conversation_id: "bg1", brand_id: "b1", my_last_booking_at: daysAgo(10), last_visible_message_at: daysAgo(12), next_booking_title: "Night", next_booking_starts_at: daysAgo(-3) },
        { conversation_id: "bg2", brand_id: "b2", my_last_booking_at: null, last_visible_message_at: daysAgo(1), next_booking_title: null, next_booking_starts_at: null },
        { conversation_id: 7 },
      ]);
    },
    fetchPendingInvites: async () => [],
    fetchTeamBrandIds: async () => [],
    fetchSessions: async () => [],
    fetchEventMeta: async () => new Map(),
    fetchBrandMeta: async () => new Map(),
    fetchRemovedBrandGuestChats: async () => [],
    fetchProfiles: async (ids) => ids.map((id) => ({ id })),
    displayName: () => "Someone",
    eventPublicUrl: () => null,
    warn: () => {},
    setTimer: () => 0,
    clearTimer: () => {},
  };
  const data = await loadChatList("me", deps);
  eq(order, ["conversations", "activity"], "both start in wave 1 (the activity read does not wait for ids)");
  const bg1 = data.conversations.find((c) => c.id === "bg1");
  const bg2 = data.conversations.find((c) => c.id === "bg2");
  const d1 = data.conversations.find((c) => c.id === "d1");
  eq([bg1.brand_activity_at, bg1.brand_activity_known, bg1.next_booking_title], [daysAgo(10), true, "Night"], "the later of booking and message");
  eq(bg2.brand_activity_at, daysAgo(1), "a message after no booking");
  assert(!("brand_activity_known" in d1), "other kinds carry no brand fields");

  const warnings: string[] = [];
  const failed = await loadChatList("me", {
    ...deps,
    fetchBrandChatActivity: async () => { throw new Error("rpc down"); },
    warn: (message) => warnings.push(message),
  });
  eq(failed.conversations.length, 3, "SC-5 the list still loads");
  assert(warnings.some((w) => w.includes("brand chat activity read failed")), "and the failure is logged");
  eq(failed.conversations.find((c) => c.id === "bg1").brand_activity_known, false, "rows are marked unknown");
  eq(chatActivityTime(failed.conversations.find((c) => c.id === "bg1")), 0, "an empty brand row sinks");

  const { fetchBrandChatActivity: _drop, ...older } = deps;
  const withoutDep = await loadChatList("me", { ...older, warn: (m) => warnings.push(m) });
  eq(withoutDep.conversations.length, 3, "a caller without the dep still loads (logged, unknown)");

  eq(brandActivityAt(undefined), null, "no row: null");
  eq(brandActivityAt({ conversationId: "x", myLastBookingAt: null, lastVisibleMessageAt: null }), null, "no times: null");
});

Deno.test("#4630 the page wires the activity read and the brand-chat copy", () => {
  const page = read("components/ConnectionsPage.tsx");
  assert(page.includes("const { rows, error } = await messagingService.listMyBrandChatActivity();"), "the dep calls the service");
  assert(page.includes("t('connections:brand_chat_leave_title', { brand: brandName })"), "the leave dialog title");
  assert(page.includes("t('connections:brand_chat_left_toast', { brand: brandName })"), "the left toast");
  assert(page.includes("t('chat:brandChatTextOnly')"), "the text-only toast");
  assert(page.includes("filter === 'unread' && unreadChatCount > 0"), "D11 the Unread chip count");
  const service = read("services/messagingService.ts");
  assert(service.includes("supabase.rpc('issue_4630_my_brand_chat_activity')"), "the activity RPC");
  assert(service.includes("supabase.rpc('issue_4630_my_brand_chat_summary'"), "the summary RPC");
});

Deno.test("#4630 the row: brand name + Brand pill, label = order time, Next booking preview, no Guests", () => {
  const row = read("components/connections/ChatListItem.tsx");
  assert(!row.includes("brand_guests_row_name") && !row.includes("tag_brand"), "no <Brand> Guests name and no Guests tag");
  assert(row.includes("t('connections:brand_chat_pill')"), "the Brand pill (Q1)");
  assert(row.includes("chatListTimeIso(conversation)"), "the time label reads the ordering time (F-4)");
  assert(row.includes("t('connections:brand_chat_preview_next'") && row.includes("t('connections:brand_chat_preview_empty')"), "the empty row previews");
  assert(row.includes('name="ticket-outline"'), "D10 the ticket glyph");
  assert(row.includes("t('connections:brand_chat_a11y_kind')"), "the a11y label names it a brand chat");
  assert(/time: \{[^}]*color: tk\.dim/.test(row), "D8 the time label is white 56%");
  const chat = read("components/MessageInterface.tsx");
  assert(!chat.includes("chat:brandGuestsTitle") && !chat.includes("brandGuestsWelcome"), "the header and empty state say no Guests");
  assert(chat.includes("t('chat:brandChatWelcomeTitle', { brand: brandGuest.brandName })"), "the welcome title");
  const booking = read("components/purchases/BrandGuestChatBookingAction.tsx");
  assert(booking.includes('t("chat:brandChatOpen", { brand: brandName })') && booking.includes('t("chat:brandChatRejoin", { brand: brandName })')
    && booking.includes('t("chat:brandChatRejoinFailed")'), "the booking card labels");
});

Deno.test("#4630 SC-7 the empty state keeps 24 pt sides and a centred 320 pt column", () => {
  const chat = read("components/MessageInterface.tsx");
  const styles = chat.slice(chat.indexOf("  emptyState: {"), chat.indexOf("  emptyStateText: {") + 200);
  assert(/emptyState: \{[^}]*paddingHorizontal: spacing\.lg/.test(styles), "paddingHorizontal spacing.lg (24)");
  assert(/emptyStateColumn: \{[^}]*maxWidth: 320,[^}]*width: "100%"/.test(styles), "a 320 pt column");
  assert(/emptyStateTitle: \{[^}]*textAlign: "center"/.test(styles), "the title is centred");
  assert(/emptyStateIcon: \{[^}]*backgroundColor: chatTokens\.accentSoft/.test(styles), "the disc uses the chat tokens");
  assert(!styles.includes("#fef3e2"), "no cream disc on the dark screen");
  assert(chat.includes("<View style={styles.emptyStateColumn}>"), "the column wraps the copy");
});

const CONNECTIONS_ADDED = ["brand_chat_pill", "brand_chat_preview_next", "brand_chat_preview_empty", "brand_chat_a11y_kind", "brand_chat_leave_title", "brand_chat_left_toast"];
const CONNECTIONS_DELETED = ["brand_guests_row_name", "tag_brand", "brand_guests_left_toast"];
const CHAT_ADDED = ["brandChatWelcomeTitle", "brandChatWelcomeBody", "brandChatTextOnly", "brandChatOpen", "brandChatRejoin", "brandChatRejoinFailed",
  "brandChatBannerToday", "brandChatBannerNextFrom", "brandChatYourTicket", "brandChatGetTickets", "brandChatRsvp", "brandChatBook",
  "brandChatNothingUpcoming", "brandChatViewBrand", "brandChatBannerError"];
const CHAT_PLURALS = ["brandChatYourTickets", "brandChatMoreBookingsA11y"];
const CHAT_DELETED = ["brandGuestsTitle", "brandGuestsWelcomeTitle", "brandGuestsWelcomeBody", "brandGuestsTextOnly", "brandGuestsOpenChat", "brandGuestsRejoin", "brandGuestsRejoinFailed"];
const placeholders = (value: string) => [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join("|");

Deno.test("#4630 SC-6 every locale has the new keys (same placeholders) and none of the deleted ones", () => {
  const locales = [...Deno.readDirSync(new URL("i18n/locales/", root))].filter((e) => e.isDirectory).map((e) => e.name).sort();
  eq(locales.length, 29, "29 locales");
  const enConnections = JSON.parse(read("i18n/locales/en/connections.json"));
  const enChat = JSON.parse(read("i18n/locales/en/chat.json"));
  for (const locale of locales) {
    const connections = JSON.parse(read(`i18n/locales/${locale}/connections.json`));
    const chat = JSON.parse(read(`i18n/locales/${locale}/chat.json`));
    for (const key of CONNECTIONS_ADDED) {
      assert(typeof connections[key] === "string" && connections[key].trim(), `${locale} connections has ${key}`);
      eq(placeholders(connections[key]), placeholders(enConnections[key]), `${locale} ${key} placeholders`);
    }
    for (const key of CONNECTIONS_DELETED) assert(!(key in connections), `${locale} connections no longer has ${key}`);
    for (const key of CHAT_ADDED) {
      assert(typeof chat[key] === "string" && chat[key].trim(), `${locale} chat has ${key}`);
      eq(placeholders(chat[key]), placeholders(enChat[key]), `${locale} ${key} placeholders`);
    }
    const suffixes = Object.keys(chat).filter((k) => k.startsWith("nextUpInDays_")).map((k) => k.slice("nextUpInDays_".length)).sort();
    for (const stem of CHAT_PLURALS) {
      for (const suffix of suffixes) {
        const value = chat[`${stem}_${suffix}`];
        assert(typeof value === "string" && value.includes("{{count}}"), `${locale} chat has ${stem}_${suffix} with {{count}}`);
      }
    }
    for (const key of CHAT_DELETED) assert(!(key in chat), `${locale} chat no longer has ${key}`);
    // The one kept key (GroupInfoSheet, do-not-touch) is reworded with the new title.
    eq(connections.brand_guests_leave_title, connections.brand_chat_leave_title, `${locale} the kept leave title matches the new one`);
    if (locale === "en") {
      const visible = [...CONNECTIONS_ADDED.map((k) => connections[k]), connections.filter_empty_brands, connections.host_chat_in_business_app,
        connections.brand_guests_leave_title, ...CHAT_ADDED.map((k) => chat[k])];
      assert(!visible.some((v) => /Guest/.test(v)), "en: no Guests in the brand chat copy");
    }
  }
});
