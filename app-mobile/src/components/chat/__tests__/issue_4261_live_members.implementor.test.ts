// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4261 amendment 1 (B-4) — the header count and Group info follow the
// live participants query, not the snapshot taken when the chat opened.
//
// FAILS-ON-REVERT: drop liveGroupMembers (or return the snapshot) and the
// "count follows live" case fails; drop the MessageInterface wiring and the
// static case fails.

import { groupJoinEventKey, liveGroupMembers } from "../chatHeaderModel.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`);
}

const snapshot = [
  { id: "me", name: "Me", username: "me", avatar_url: undefined, is_online: true },
  { id: "ada", name: "Ada", username: "ada", is_online: false },
];

Deno.test("live undefined → the snapshot", () => {
  assertEquals(liveGroupMembers(snapshot, undefined, "me"), snapshot, "snapshot while loading");
});

Deno.test("live rows → me + the live members; the count follows live", () => {
  const live = [
    { userId: "ada", displayName: "Ada O", username: "ada", avatarUrl: null },
    { userId: "tobi", displayName: "Tobi", username: null, avatarUrl: "https://a/t.png" },
    { userId: "kemi", displayName: "Kemi", username: "kemi", avatarUrl: null },
  ];
  const members = liveGroupMembers(snapshot, live, "me");
  assertEquals(members.map((m) => m.id), ["me", "ada", "tobi", "kemi"], "me first, then live");
  assertEquals(members.length, 4, "4 people in chat after Add people");
  assertEquals(members[1], { id: "ada", name: "Ada O", username: "ada", avatar_url: undefined, is_online: false }, "mapped, online flag kept");
  assertEquals(members[2].avatar_url, "https://a/t.png", "avatar mapped");
  assertEquals(liveGroupMembers(snapshot, [], "me").map((m) => m.id), ["me"], "everyone else left");
  assertEquals(liveGroupMembers([], live.slice(0, 1), "me").map((m) => m.id), ["me", "ada"], "me even when the snapshot missed me");
});

Deno.test("a joined / added group row changes the refetch key", () => {
  const rows = [
    { id: "1", isSystem: true, cardPayload: { kind: "group_event", event: "joined_by_link" } },
    { id: "2", isSystem: true, cardPayload: { kind: "group_event", event: "join_request" } },
    { id: "3", isSystem: false, cardPayload: { kind: "group_event", event: "members_added" } },
    { id: "4", isSystem: true, cardPayload: { kind: "group_event", event: "members_added" } },
  ];
  assertEquals(groupJoinEventKey(rows), "1,4", "joins and adds only");
  assertEquals(groupJoinEventKey([]), "", "none");
});

Deno.test("MessageInterface feeds the live list to the header and Group info; mutations refresh it", async () => {
  const chat = await Deno.readTextFile(new URL("../../MessageInterface.tsx", import.meta.url));
  assert(/liveGroupMembers\(friend\.participants \?\? \[\], liveParticipants, currentUserId\)/.test(chat), "header uses liveGroupMembers");
  assert(/members=\{headerParticipants\}/.test(chat), "Group info reads the same list");
  assert(/groupJoinEventKey\(messages\)/.test(chat) && /chatKeys\.participants\(conversationId\)/.test(chat), "a join row refetches");
  const hooks = await Deno.readTextFile(new URL("../../../hooks/useGroupLink.ts", import.meta.url));
  assertEquals((hooks.match(/chatKeys\.participants\(conversationId\)/g) ?? []).length, 2, "add people + approve invalidate");
});
