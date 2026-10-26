// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 3 — the 1:1 chat's ⋯ menu and FriendActionsSheet render ONE
// ordered list. Report and Block are always last (Report first), mute flips to
// Unmute, the paired row shows only for a paired friend, and the reserved
// "Start a collab" slot stays hidden until Wave 5.
//
// FAILS-ON-REVERT: reorder FRIEND_MENU_ORDER, drop the mute→unmute swap, show
// the paired row for an unpaired friend, or turn DM_COLLAB_MENU_ENABLED on
// without Wave 5 and these cases fail.

import { buildFriendMenu, DM_COLLAB_MENU_ENABLED } from "../chatMenuModel.ts";

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

Deno.test("one menu: the collab slot is reserved but hidden until Wave 5", () => {
  assertEquals(DM_COLLAB_MENU_ENABLED, false, "flag stays off in Wave 3");
  assertEquals(buildFriendMenu({ ...chat, dmCollabEnabled: true })[0].id, "startCollab", "slot is first when enabled");
});

Deno.test("one menu: a blocked or unfriended person keeps only the safe rows", () => {
  assertEquals(
    buildFriendMenu({ ...chat, isFriend: false, canViewProfile: false }).map((item) => item.id),
    ["media", "shareCard", "mute", "report", "block"],
    "no add-to-session or remove for a non-friend",
  );
});
