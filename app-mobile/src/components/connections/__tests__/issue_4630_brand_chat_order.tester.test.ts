// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// #4630 tester adversarial suite (a different angle from the implementor's):
// the brand row's ordering time must come ONLY from my last booking and the
// last visible message. A future "next booking" start, the chat's created_at,
// a broken timestamp or a Removed row's stale activity must never lift a row.
//
// FAILS-ON-REVERT: put `|| conversation.created_at` back into the brand branch
// of chatActivityTime (T-ORDER-1 fails), feed next_booking_starts_at into
// brandActivityAt (T-ORDER-2 fails), or order a Removed row by its activity
// (T-ORDER-3 fails).
import { chatActivityTime, chatListTimeIso, sortChatList } from "../chatListModel.ts";
import { brandActivityAt, loadChatList, parseBrandChatActivityRows } from "../chatListLoad.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function eq(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n  expected ${b}\n  actual   ${a}`);
}

const NOW = Date.parse("2026-11-26T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();

const brand = (id: string, extra = {}) => ({
  id, created_at: daysAgo(0), type: "group", linked_entity_type: "brand_guests", brand_id: `b-${id}`,
  name: `Brand ${id}`, participants: [{ id: "me" }], unread_count: 0, last_message: null,
  brand_activity_known: true, brand_activity_at: null, ...extra,
});
const dm = (id: string, lastAt: string) => ({
  id, created_at: daysAgo(900), type: "direct", participants: [{ id: "me" }, { id: `p-${id}` }], unread_count: 0,
  last_message: { content: "hi", created_at: lastAt, sender_id: `p-${id}` },
});

Deno.test("T-ORDER-1 a brand chat created a second ago with no activity sinks below a 300-day-old DM", () => {
  const fresh = brand("fresh"); // created_at = now (the #4475 apply-day bug, worst case)
  const ancient = dm("ancient", daysAgo(300));
  eq(sortChatList([fresh, ancient]).map((c) => c.id), ["ancient", "fresh"], "created_at never lifts a brand row");
  eq(chatListTimeIso(fresh), null, "no time label from created_at");
});

Deno.test("T-ORDER-2 a future next booking never lifts the row; only my last booking and messages do", () => {
  const rows = parseBrandChatActivityRows([
    { conversation_id: "c1", my_last_booking_at: null, last_visible_message_at: null,
      next_booking_title: "Future night", next_booking_starts_at: new Date(NOW + 3 * 86400000).toISOString() },
  ]);
  eq(brandActivityAt(rows[0]), null, "a future start is not activity");
  const futureOnly = brand("future", { brand_activity_at: brandActivityAt(rows[0]), next_booking_title: "Future night",
    next_booking_starts_at: rows[0].nextBookingStartsAt });
  eq(sortChatList([futureOnly, dm("d", daysAgo(50))]).map((c) => c.id), ["d", "future"], "it stays below real activity");
});

Deno.test("T-ORDER-3 a Removed row orders by its removal time even when stale activity says otherwise", () => {
  const removed = brand("removed-brand-guests:b9", {
    __removedBrandGuests: { brandId: "b9" }, created_at: daysAgo(30),
    brand_activity_known: true, brand_activity_at: daysAgo(0), last_message: null,
  });
  eq(chatActivityTime(removed), NOW - 30 * 86400000, "removedAt, not the activity");
  eq(sortChatList([removed, dm("d", daysAgo(5))]).map((c) => c.id), ["d", "removed-brand-guests:b9"], "below a newer DM");
});

Deno.test("T-ORDER-4 the label shows the booking when the booking is newer than the last message", () => {
  const b = brand("b", { brand_activity_at: daysAgo(1), last_message: { content: "old post", created_at: daysAgo(9), sender_kind: "brand" } });
  eq(chatListTimeIso(b), daysAgo(1), "label = the later of the two");
  eq(chatActivityTime(b), NOW - 86400000, "order = the same time");
});

Deno.test("T-ORDER-5 a broken timestamp never poisons the sort (NaN would scramble the comparator)", () => {
  const broken = brand("broken", { brand_activity_at: "not-a-date", last_message: { content: "x", created_at: "also-bad" } });
  eq(chatActivityTime(broken), 0, "broken times read as 0");
  const parsed = parseBrandChatActivityRows([{ conversation_id: "x", my_last_booking_at: "garbage", last_visible_message_at: "2026-13-45" }]);
  eq([parsed[0].myLastBookingAt, parsed[0].lastVisibleMessageAt], [null, null], "the parser drops unparseable times");
  const order = sortChatList([broken, dm("a", daysAgo(3)), dm("b", daysAgo(1))]).map((c) => c.id);
  eq(order, ["b", "a", "broken"], "valid rows keep their order; the broken one sinks");
});

Deno.test("T-ORDER-6 the activity read throwing synchronously, or naming a DM, never breaks or decorates the list", async () => {
  const base = {
    getConversations: async () => ({
      error: null,
      conversations: [
        { id: "bg", type: "group", linked_entity_type: "brand_guests", brand_id: "b1", name: "B1", created_at: daysAgo(0), participants: [{ user_id: "me" }] },
        { id: "dm", type: "direct", created_at: daysAgo(30), participants: [{ user_id: "me" }, { user_id: "you" }] },
      ],
    }),
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
  const warnings: string[] = [];
  const sync = await loadChatList("me", {
    ...base,
    fetchBrandChatActivity: () => { throw new Error("sync boom"); },
    warn: (m) => warnings.push(String(m)),
  });
  eq(sync.conversations.length, 2, "a synchronous throw still loads the list");
  assert(warnings.some((w) => w.includes("brand chat activity read failed")), "and it is logged");

  const crossed = await loadChatList("me", {
    ...base,
    fetchBrandChatActivity: async () => parseBrandChatActivityRows([
      { conversation_id: "dm", my_last_booking_at: daysAgo(0), last_visible_message_at: daysAgo(0) },
    ]),
  });
  const dmRow = crossed.conversations.find((c) => c.id === "dm");
  assert(!("brand_activity_at" in dmRow), "an activity row naming a DM never decorates the DM");
  const bg = crossed.conversations.find((c) => c.id === "bg");
  eq([bg.brand_activity_known, bg.brand_activity_at], [true, null], "the brand row with no activity row is known-empty");
  eq(chatActivityTime(bg), 0, "and sinks, though created today");
});
