// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 3 — the 1:1 chat's ⋯ menu and FriendActionsSheet render ONE
// ordered list. Report and Block are always last (Report first), mute flips to
// Unmute, the paired row shows only for a paired friend, and "Start a collab"
// is first only when the chat can start one (Wave 5 replaced the reserved
// DM_COLLAB_MENU_ENABLED flag with canStartCollab; the full Wave 5 rules are in
// components/chat/__tests__/issue_4114_dm_collab_model...).
//
// FAILS-ON-REVERT: reorder FRIEND_MENU_ORDER, drop the mute→unmute swap, show
// the paired row for an unpaired friend, or offer "Start a collab" without
// canStartCollab and these cases fail.
// MINGLA-INVARIANT: I-4114-ONE-FRIEND-MENU | issue #4114 | The 1:1 chat menu and FriendActionsSheet render the same ordered list from buildFriendMenu; Report and Block are always last.

import { buildFriendMenu } from "../chatMenuModel.ts";

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`);
}

const chat = {
  surface: "chat",
  isFriend: true,
  pairState: "none",
  canOpenPairedView: true,
  canUnpair: false,
  canViewProfile: true,
  hasConversation: true,
  isMuted: false,
};

Deno.test("one menu: the 1:1 chat order, Report then Block last", () => {
  assertEquals(
    buildFriendMenu(chat).map((item) => item.id),
    ["viewProfile", "media", "shareCard", "addToSession", "mute", "removeFriend", "report", "block"],
    "chat menu order",
  );
});

Deno.test("one menu: a paired friend gets Birthday, holidays and saves after Mute", () => {
  const ids = buildFriendMenu({ ...chat, pairState: "paired" }).map((item) => item.id);
  assertEquals(ids.slice(4, 6), ["mute", "pairedView"], "paired row follows mute");
  assertEquals(ids.slice(-2), ["report", "block"], "destructive rows stay last");
});

Deno.test("one menu: muted reads Unmute", () => {
  const mute = buildFriendMenu({ ...chat, isMuted: true }).find((item) => item.id === "mute");
  assertEquals(mute?.labelKey, "chat:menuUnmute", "label flips");
});

Deno.test("one menu: the friends sheet shares the list and keeps its pairing rows", () => {
  const sheet = { ...chat, surface: "friendSheet", hasConversation: false };
  assertEquals(
    buildFriendMenu({ ...sheet, pairState: "paired", canUnpair: true }).map((item) => item.id),
    ["viewProfile", "addToSession", "mute", "pairedView", "unpair", "removeFriend", "report", "block"],
    "friend sheet order (paired)",
  );
  assertEquals(
    buildFriendMenu(sheet).map((item) => item.id).includes("sendPair"),
    true,
    "unpaired friend can send a pair request",
  );
});

Deno.test("one menu: the collab slot is first, and only when the chat can start one", () => {
  assertEquals(buildFriendMenu(chat).some((item) => item.id === "startCollab"), false, "hidden without canStartCollab");
  assertEquals(buildFriendMenu({ ...chat, canStartCollab: true })[0].id, "startCollab", "slot is first when it can start");
});

Deno.test("one menu: a blocked or unfriended person keeps only the safe rows", () => {
  assertEquals(
    buildFriendMenu({ ...chat, isFriend: false, canViewProfile: false }).map((item) => item.id),
    ["media", "shareCard", "mute", "report", "block"],
    "no add-to-session or remove for a non-friend",
  );
});
