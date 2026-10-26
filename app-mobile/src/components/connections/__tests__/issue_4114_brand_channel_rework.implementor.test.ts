// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 rework — the brand channel fold when the team read is unknown,
// and a pin on a folded event chat stays removable.
//
//   * before the brand team is known (teamBrandIds null, nothing cached) nothing
//     is hidden and everything folds (Seth 2026-10-26: Explorer never shows a
//     per-event row; host chats only exist for team members, so a brief wrong
//     first frame is limited to the first launch after install);
//   * a brand row is pinned when any folded chat is; its Unpin unpins exactly
//     those chats (never chats of another brand, a team brand or a DM);
//   * the row, its swipe and its long-press menu offer Unpin while pinned and
//     never offer Pin.
//
// FAILS-ON-REVERT: delete `if (teamBrandIds === null) return false;` in
// isHostChatForUser → the unknown-team case throws on the null set; delete the brand-row
// branch of handleTogglePin or the Unpin entry of the brand row's actions →
// the wiring checks fail.

import { foldBrandChannels, foldsIntoBrandChannel, pinnedBrandChannelMemberIds } from "../brandChannelModel.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function eq(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n  expected ${b}\n  actual   ${a}`);
}

const root = new URL("../../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function eventChat(id: string, brandId: string, pinnedAt: string | null = null) {
  return {
    id,
    created_at: "2026-10-01T00:00:00Z",
    type: "group",
    linked_entity_type: "event",
    name: `Event ${id}`,
    event_id: `ev-${id}`,
    participants: [{ id: "me" }],
    unread_count: 0,
    eventBrandId: brandId,
    eventBrandName: `Brand ${brandId}`,
    pinned_at: pinnedAt,
  };
}
const dm = (id: string, pinnedAt: string | null) => ({
  id, created_at: "2026-10-01T00:00:00Z", type: "direct", participants: [{ id: "me" }, { id: "you" }], pinned_at: pinnedAt,
});

Deno.test("#4114 rework: an unknown brand team hides nothing and folds everything", () => {
  const chats = [eventChat("a", "b1"), eventChat("b", "b1"), eventChat("c", "b2")];
  eq(chats.map((chat) => foldsIntoBrandChannel(chat, null)), [true, true, true], "everything folds while the team is unknown");
  const folded = foldBrandChannels(chats, null);
  eq(folded.rows.map((row) => row.__brandChannel?.brandId), ["b1", "b2"], "one row per brand, nothing hidden");
  // Once known, a guest's chats fold and a team brand's are hidden.
  const known = foldBrandChannels(chats, new Set(["b2"]));
  assert(known.rows.length === 1 && known.rows[0].__brandChannel?.brandId === "b1", "a guest's chats fold");
  assert(!known.rows.some((row) => row.id === "c"), "the team brand's chat is hidden");
});

Deno.test("#4114 rework: a brand row's Unpin covers exactly its pinned folded chats", () => {
  const chats = [
    eventChat("a", "b1", "2026-10-02T00:00:00Z"),
    eventChat("b", "b1"),
    eventChat("c", "b1", "2026-10-03T00:00:00Z"),
    eventChat("d", "b2", "2026-10-04T00:00:00Z"),
    eventChat("e", "team", "2026-10-05T00:00:00Z"),
    dm("f", "2026-10-06T00:00:00Z"),
  ];
  const team = new Set(["team"]);
  const row = foldBrandChannels(chats, team).rows.find((candidate) => candidate.__brandChannel?.brandId === "b1");
  assert(row && row.pinned_at === "2026-10-02T00:00:00Z", "the brand row shows as pinned");
  eq(pinnedBrandChannelMemberIds(chats, "b1", team), ["a", "c"], "only b1's pinned folded chats");
  eq(pinnedBrandChannelMemberIds(chats, "team", team), [], "a team brand's chats are not folded, so not the row's");
  eq(pinnedBrandChannelMemberIds(chats, "b1", null), ["a", "c"], "everything folds while the team is unknown");
});

Deno.test("#4114 rework: the brand row offers Unpin (never Pin) and the page unpins its chats", async () => {
  const page = strip(await read("components/ConnectionsPage.tsx"));
  const toggle = page.slice(page.indexOf("const handleTogglePin = useCallback("), page.indexOf("const handleToggleUnread = useCallback("));
  assert(/if \(isBrandChannelRow\(conversation\)\) \{/.test(toggle), "the toggle handles a brand row");
  assert(/pinnedBrandChannelMemberIds\(\s*conversations as ChatListItemConversation\[\],\s*conversation\.__brandChannel\.brandId,\s*teamBrandIds,\s*\)/.test(toggle),
    "it unpins the row's pinned chats");
  assert(/if \(member\?\.pinned_at\) await handleTogglePin\(member\);/.test(toggle), "each through the one per-chat path (rollback + toast)");
  const actions = page.slice(page.indexOf("if (isBrandChannelRow(target)) {"), page.indexOf("const isGroup = target.type === \"group\";"));
  assert(/if \(target\.pinned_at\) \{[\s\S]*label: t\("connections:action_unpin"\)/.test(actions), "the long-press menu offers Unpin while pinned");
  assert(!/connections:action_pin"/.test(actions), "and never Pin");
  const item = strip(await read("components/connections/ChatListItem.tsx"));
  assert(/renderLeftActions=\{isBrandChannel && !isPinned \? undefined : renderLeftActions\}/.test(item), "the swipe offers Unpin only while pinned");
  assert(/\.\.\.\(isBrandChannel && !isPinned\s*\?\s*\[\]/.test(item), "so does the accessibility action");
});
