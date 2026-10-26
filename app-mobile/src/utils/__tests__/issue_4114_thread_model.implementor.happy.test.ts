// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 3 — the rules inside a chat: reaction pills, the sender name
// only on the first bubble of a group block, the new-messages divider, typing
// re-broadcast inside the 4s expiry, the composer growing to 5 lines, the
// long-press actions, and Android back closing open layers before the thread.
//
// FAILS-ON-REVERT: aggregate per row instead of per emoji, show the sender on
// every bubble or in 1:1 chats, re-broadcast typing only once, cap the composer
// at one line, offer Copy on a card, or let back leave the thread while a sheet
// is open and the matching case fails.

import {
  aggregateReactions,
  COMPOSER_INPUT_MAX_HEIGHT,
  COMPOSER_MAX_LINES,
  COMPOSER_MIN_HEIGHT,
  dayLabelKind,
  firstUnreadMessageId,
  messageActions,
  resolveChatBack,
  shouldRebroadcastTyping,
  shouldShowSenderName,
  toggleReactionRows,
  TYPING_EXPIRY_MS,
  TYPING_REBROADCAST_MS,
  typingLabel,
} from "../threadModel.ts";

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`);
}

Deno.test("reactions render as one pill per emoji with a count and whether you reacted", () => {
  const rows = [
    { user_id: "ada", emoji: "❤️" },
    { user_id: "me", emoji: "❤️" },
    { user_id: "ada", emoji: "😂" },
  ];
  assertEquals(
    aggregateReactions(rows, "me"),
    [{ emoji: "❤️", count: 2, mine: true }, { emoji: "😂", count: 1, mine: false }],
    "aggregated pills",
  );
  assertEquals(aggregateReactions(undefined, "me"), [], "no rows, no pills");
});

Deno.test("toggling your reaction adds it, then removes only yours", () => {
  const added = toggleReactionRows([{ user_id: "ada", emoji: "👍" }], "me", "👍");
  assertEquals(added.length, 2, "added");
  assertEquals(toggleReactionRows(added, "me", "👍"), [{ user_id: "ada", emoji: "👍" }], "removed only mine");
});

Deno.test("sender name: groups only, first bubble of a block, never your own", () => {
  assertEquals(shouldShowSenderName({ isGroupChat: true, isMe: false, groupPosition: "first" }), true, "first in a group block");
  assertEquals(shouldShowSenderName({ isGroupChat: true, isMe: false, groupPosition: "solo" }), true, "solo in a group");
  assertEquals(shouldShowSenderName({ isGroupChat: true, isMe: false, groupPosition: "middle" }), false, "not on the middle bubble");
  assertEquals(shouldShowSenderName({ isGroupChat: true, isMe: false, groupPosition: "last" }), false, "not on the last bubble");
  assertEquals(shouldShowSenderName({ isGroupChat: false, isMe: false, groupPosition: "first" }), false, "never in a 1:1 chat");
  assertEquals(shouldShowSenderName({ isGroupChat: true, isMe: true, groupPosition: "first" }), false, "never on your own");
});

Deno.test("new-messages divider goes above the oldest unread incoming message", () => {
  assertEquals(
    firstUnreadMessageId([
      { id: "1", isMe: false, unread: false },
      { id: "2", isMe: true, unread: false },
      { id: "3", isMe: false, unread: true },
      { id: "4", isMe: false, unread: true },
    ]),
    "3",
    "oldest unread",
  );
  assertEquals(firstUnreadMessageId([{ id: "1", isMe: true, unread: true }]), null, "your own never count");
});

Deno.test("day labels follow the calendar day", () => {
  const now = new Date(2026, 9, 26, 9, 0);
  assertEquals(dayLabelKind(new Date(2026, 9, 26, 0, 5).toISOString(), now), "today", "today");
  assertEquals(dayLabelKind(new Date(2026, 9, 25, 23, 50).toISOString(), now), "yesterday", "yesterday");
  assertEquals(dayLabelKind(new Date(2026, 9, 20, 12).toISOString(), now), "date", "older");
});

Deno.test("typing re-broadcasts every ~2.5s, inside the receiver's 4s expiry", () => {
  assertEquals(TYPING_REBROADCAST_MS < TYPING_EXPIRY_MS, true, "re-broadcast beats the expiry");
  assertEquals(shouldRebroadcastTyping(null, 1000), true, "first keystroke broadcasts");
  assertEquals(shouldRebroadcastTyping(1000, 2000), false, "not on every keystroke");
  assertEquals(shouldRebroadcastTyping(1000, 1000 + TYPING_REBROADCAST_MS), true, "again while still typing");
  assertEquals(typingLabel(["Kemi", "Dayo"]), { key: "chat:twoTyping", params: { name1: "Kemi", name2: "Dayo" } }, "group label");
});

Deno.test("composer grows to 5 lines, then stops", () => {
  assertEquals(COMPOSER_MAX_LINES, 5, "five lines");
  assertEquals(COMPOSER_INPUT_MAX_HEIGHT, 100, "5 x 20pt lines");
  assertEquals(COMPOSER_MIN_HEIGHT, 56, "a single line is the 56pt capsule");
});

Deno.test("long-press actions: Copy only on text, Unsend your own, Report others'", () => {
  assertEquals(messageActions({ isOwnMessage: true, type: "text", isSent: true, canUnsend: true, canReport: true }), ["reply", "copy", "unsend"], "own text");
  assertEquals(messageActions({ isOwnMessage: false, type: "card", isSent: true, canUnsend: true, canReport: true }), ["reply", "report"], "someone's card: no Copy");
  assertEquals(messageActions({ isOwnMessage: true, type: "text", isSent: false, canUnsend: true, canReport: true }), ["reply", "copy"], "a pending send cannot be unsent");
});

Deno.test("Android back closes the top-most open layer before the thread", () => {
  assertEquals(resolveChatBack({}), "leaveThread", "nothing open: leave");
  assertEquals(resolveChatBack({ moreMenu: true }), "moreMenu", "menu first");
  assertEquals(resolveChatBack({ moreMenu: true, contextMenu: true }), "contextMenu", "top-most wins");
  assertEquals(resolveChatBack({ collabPlans: true }), "collabPlans", "collab sheets too");
});
