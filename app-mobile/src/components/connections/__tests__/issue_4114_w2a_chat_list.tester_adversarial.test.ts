// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 2a — tester adversarial suite for the Chats list model and
// the 3-pin rule. The implementor suite proves the happy layout; this one
// attacks the edges:
//   * the pin limit at exactly 3, re-pinning a pinned chat, and the server's
//     race guard (advisory lock + count that excludes the row being written,
//     and an RPC whose ON CONFLICT always names pinned_at so the trigger runs);
//   * the Archived row never appears with 0, and never under a filter chip;
//   * a filter chip never leaks into search results, and brand channels and
//     event chats land in the Events section while invites stay invites;
//   * "marked unread" with real unread messages is not a double badge.
//
// FAILS-ON-REVERT: change `< MAX_PINNED_CHATS` to `<=` in canPinChat, drop the
// `archivedCount > 0` guard in buildBrowseItems, or remove pg_advisory_xact_lock
// from tg_conversation_pin_limit and this suite fails.

import {
  buildBrowseItems,
  buildSearchItems,
  canPinChat,
  isMarkedUnread,
  matchesChatFilter,
  MAX_PINNED_CHATS,
  pinnedCount,
  sortChatList,
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
const conv = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  created_at: "2026-10-01T00:00:00.000Z",
  type: "direct",
  linked_entity_type: "direct",
  participants: [{ id: ME }, { id: `friend-${id}` }],
  ...extra,
});

Deno.test("#4114 W2a adversarial: the pin limit is exactly 3 and re-pinning a pinned chat never counts twice", () => {
  assertEquals(MAX_PINNED_CHATS, 3, "D-decision: three pins");
  const list = [
    conv("a", { pinned_at: "2026-10-01T00:00:01.000Z" }),
    conv("b", { pinned_at: "2026-10-01T00:00:02.000Z" }),
    conv("c", { pinned_at: "2026-10-01T00:00:03.000Z" }),
    conv("d"),
  ];
  assert(!canPinChat(list, "d"), "a 4th pin is refused on the phone");
  assert(canPinChat(list, "a"), "an already pinned chat can always be toggled (unpin)");
  assertEquals(pinnedCount(list, "a"), 2, "the target is excluded from its own count");
  assert(canPinChat(list.slice(0, 2).concat([conv("d")]), "d"), "two pins leave room for a third");
  assert(!canPinChat(list, "not-in-list"), "an unknown id is never a free pin slot");
  assertEquals(sortChatList(list).map((c) => c.id), ["a", "b", "c", "d"], "pins first, in pin order");
});

Deno.test("#4114 W2a adversarial: the server pin trigger serializes concurrent pins and runs on every RPC write", async () => {
  const sql = await Deno.readTextFile(
    new URL("../../../../../supabase/migrations/20271230014114_issue_4114_conversation_pins.sql", import.meta.url),
  );
  const trigger = sql.slice(sql.indexOf("FUNCTION public.tg_conversation_pin_limit"), sql.indexOf("CREATE TRIGGER conversation_pin_limit"));
  assert(/pg_advisory_xact_lock\(/.test(trigger), "two pins at once must serialize on a per-user lock");
  assert(trigger.indexOf("pg_advisory_xact_lock") < trigger.indexOf("SELECT count(*)"), "the lock is taken BEFORE the count");
  assert(/conversation_id<>NEW\.conversation_id/.test(trigger.replace(/\s+/g, "")), "the count excludes the row being written");
  assert(/v_pinned>=3/.test(trigger.replace(/\s+/g, "")), "the server limit is 3, same as the phone");
  assert(/BEFORE INSERT OR UPDATE OF pinned_at/.test(sql), "the trigger fires on insert and on pinned_at updates");
  const rpc = sql.slice(sql.indexOf("FUNCTION public.set_conversation_list_state"), sql.indexOf("REVOKE ALL ON FUNCTION public.set_conversation_list_state"));
  assert(/DO UPDATE\s+SET pinned_at=/.test(rpc), "ON CONFLICT names pinned_at, so the UPDATE OF pinned_at trigger runs");
  assert(/SECURITY DEFINER/.test(rpc) && /auth\.uid\(\)/.test(rpc), "the RPC writes only the caller's own row");
  assert(!/GRANT EXECUTE ON FUNCTION public\.set_conversation_list_state[^;]*anon/.test(sql), "anon never gets the pin RPC");
});

Deno.test("#4114 W2a adversarial: no Archived row at 0, and none under a filter chip", () => {
  const active = [conv("a"), conv("b", { unread_count: 2 })];
  const zero = buildBrowseItems({ active, archivedCount: 0, filter: "all" });
  assert(!zero.some((item) => item.kind === "archived"), "Archived 0 must never render");
  const negative = buildBrowseItems({ active, archivedCount: -1, filter: "all" });
  assert(!negative.some((item) => item.kind === "archived"), "a bad negative count never renders a row");
  const some = buildBrowseItems({ active, archivedCount: 4, filter: "all" });
  assertEquals(some[some.length - 1], { kind: "archived", key: "archived", count: 4 }, "Archived N is the last row");
  for (const filter of ["unread", "groups", "events"]) {
    const filtered = buildBrowseItems({ active, archivedCount: 4, filter });
    assert(!filtered.some((item) => item.kind === "archived"), `no Archived row under the ${filter} chip`);
  }
  const empty = buildBrowseItems({ active: [], archivedCount: 0, filter: "all" });
  assertEquals(empty, [], "an empty list is empty (the empty state renders, not a stray section label)");
});

Deno.test("#4114 W2a adversarial: an Invites header never shows without chats under a filter, and invites never leak into Unread", () => {
  const invite = conv("inv", { __pendingInvite: { id: "x" } });
  const items = buildBrowseItems({ active: [invite], archivedCount: 0, filter: "all" });
  assert(!items.some((item) => item.kind === "section" && item.section === "chats"), "no empty Chats header after invites");
  const unread = buildBrowseItems({ active: [invite], archivedCount: 0, filter: "unread" });
  assert(!unread.some((item) => item.kind === "invite"), "invites belong to the All view only");
});

Deno.test("#4114 W2a adversarial: search ignores the chip and sorts every kind into its own section", () => {
  const brandRow = conv("brand-channel:b1", { type: "group", linked_entity_type: "event", __brandChannel: { id: "brand-channel:b1" } });
  const eventChat = conv("ev", { type: "group", linked_entity_type: "trip" });
  const group = conv("grp", { type: "group", linked_entity_type: "session" });
  const invite = conv("inv", { __pendingInvite: { id: "x" } });
  const items = buildSearchItems({
    matchedChats: [brandRow, eventChat, group, invite],
    friends: [],
    allConversations: [brandRow, eventChat, group, invite],
    currentUserId: ME,
    query: "x",
  });
  const sections = items.filter((item) => item.kind === "section").map((item) => item.section);
  assertEquals(sections, ["chats", "events"], "chats then events, the empty Friends section left out");
  const eventKeys = items.slice(items.findIndex((item) => item.kind === "section" && item.section === "events") + 1).map((item) => item.key);
  assertEquals(eventKeys.sort(), ["brand-channel:b1", "ev"].sort(), "brand channels and event chats are Events");
  assert(items.some((item) => item.kind === "invite" && item.key === "inv"), "an invite found by search stays an invite row");
});

Deno.test("#4114 W2a adversarial: marked unread with real unread messages is one state, and the Unread chip catches both", () => {
  const both = conv("a", { unread_count: 3, marked_unread_at: "2026-10-02T00:00:00.000Z" });
  assert(!isMarkedUnread(both), "the private flag never stacks on a real count");
  assert(matchesChatFilter(both, "unread"), "the Unread chip shows it");
  const flagOnly = conv("b", { unread_count: 0, marked_unread_at: "2026-10-02T00:00:00.000Z" });
  assert(isMarkedUnread(flagOnly) && matchesChatFilter(flagOnly, "unread"), "a flagged chat with 0 unread is unread");
  assert(!matchesChatFilter(conv("c", { unread_count: 0 }), "unread"), "a read chat is not");
});
