// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4456 — the hold-down menu, the unsent line and reply quotes.
//
// MINGLA-INVARIANT: I-4456-MENU-MATRIX | issue #4456 | Unsend is offered on your own sent text, photo, video, file, card and view-once messages with no time limit; Remove for everyone only to a friend group admin on someone else's message (never view-once); Delete for me on every sent message, the unsent line and a failed bubble; nothing while a send is pending
// MINGLA-INVARIANT: I-4456-LIMIT-PARITY | issue #4456 | the phone's unsend limits (10 ids, the unsendable types) equal the server's unsend_messages rules
//
// FAILS-ON-REVERT: offer Unsend on a plan card, a system row or the unsent
// line, offer Remove in a 1:1 chat or on view-once, drop Delete for me, give a
// pending send a menu, or put the 2-day window back, and the matching case fails.

import {
  CHAT_BACK_LAYERS,
  messageActionGroups,
  messageActions,
  NEEDS_CONNECTION_ACTIONS,
  replyQuoteState,
  resolveChatBack,
  tombstoneLine,
  UNSEND_MAX_IDS,
  UNSENDABLE_MESSAGE_TYPES,
  unsentStateOf,
} from "../threadModel.ts";

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`);
}

const base = { isSent: true, canUnsend: true, canReport: true };

Deno.test("#4456 menu: your own messages", () => {
  assertEquals(messageActions({ ...base, isOwnMessage: true, type: "text" }), ["reply", "copy", "deleteForMe", "unsend"], "own text");
  for (const type of ["image", "video", "file", "card"]) {
    assertEquals(messageActions({ ...base, isOwnMessage: true, type }), ["reply", "deleteForMe", "unsend"], `own ${type}`);
  }
  assertEquals(messageActions({ ...base, isOwnMessage: true, type: "image", isViewOnce: true }), ["deleteForMe", "unsend"], "own view once");
  assertEquals(messageActions({ ...base, isOwnMessage: true, type: "plan" }), ["reply", "deleteForMe"], "a plan is never unsent");
  assertEquals(messageActions({ ...base, isOwnMessage: true, type: "system" }), ["reply", "deleteForMe"], "a system row is never unsent");
  assertEquals(messageActions({ ...base, isOwnMessage: true, type: "text", isGroupAdmin: true }), ["reply", "copy", "deleteForMe", "unsend"], "an admin's own message uses Unsend");
});

Deno.test("#4456 menu: someone else's messages, members and admins", () => {
  assertEquals(messageActions({ ...base, isOwnMessage: false, type: "text" }), ["reply", "copy", "report", "deleteForMe"], "member: text");
  assertEquals(messageActions({ ...base, isOwnMessage: false, type: "text", isGroupAdmin: true }), ["reply", "copy", "report", "deleteForMe", "removeForEveryone"], "admin: text");
  assertEquals(messageActions({ ...base, isOwnMessage: false, type: "card", isGroupAdmin: true }), ["reply", "report", "deleteForMe", "removeForEveryone"], "admin: card");
  assertEquals(messageActions({ ...base, isOwnMessage: false, type: "image", isViewOnce: true, isGroupAdmin: true }), ["report", "deleteForMe"], "admins cannot remove view once");
  assertEquals(messageActions({ ...base, isOwnMessage: false, type: "image", isViewOnce: true }), ["report", "deleteForMe"], "their view once");
  assertEquals(messageActions({ ...base, isOwnMessage: false, type: "text", isGroupAdmin: true, canUnsend: false }), ["reply", "copy", "report", "deleteForMe"], "no remove when the chat cannot unsend");
});

Deno.test("#4456 menu: the unsent line, a failed bubble, a pending send", () => {
  assertEquals(messageActions({ ...base, isOwnMessage: true, type: "text", isTombstone: true }), ["deleteForMe"], "unsent line (yours)");
  assertEquals(messageActions({ ...base, isOwnMessage: false, type: "text", isTombstone: true, isGroupAdmin: true }), ["deleteForMe"], "unsent line (theirs)");
  assertEquals(messageActions({ ...base, isOwnMessage: true, type: "text", isSent: false, isFailed: true }), ["deleteForMe"], "failed bubble");
  assertEquals(messageActions({ ...base, isOwnMessage: true, type: "text", isSent: false }), [], "pending send has no menu");
});

Deno.test("#4456 menu: no time limit on Unsend", () => {
  // No createdAt input exists; a message from last year is unsent like a new one.
  assertEquals(messageActions({ ...base, isOwnMessage: true, type: "text" }).includes("unsend"), true, "always offered");
});

Deno.test("#4456 menu groups and offline", () => {
  assertEquals(messageActionGroups(["reply", "copy", "report", "deleteForMe", "removeForEveryone"]), [["reply", "copy", "report"], ["deleteForMe", "removeForEveryone"]], "two groups");
  assertEquals(messageActionGroups(["deleteForMe"]), [["deleteForMe"]], "one group");
  assertEquals([...NEEDS_CONNECTION_ACTIONS].sort(), ["deleteForMe", "removeForEveryone", "unsend"], "the delete actions need a connection");
});

Deno.test("#4456 the unsent line", () => {
  const line = (kind, authorIsMe, actorIsMe) => tombstoneLine({ kind, authorIsMe, actorIsMe, authorName: "Ana", actorName: "Sam" });
  assertEquals(line("sender", true, true), { key: "chat:tombstoneYouUnsent", params: {} }, "you unsent");
  assertEquals(line("sender", false, false), { key: "chat:tombstoneTheyUnsent", params: { name: "Ana" } }, "Ana unsent");
  assertEquals(line("admin", false, true), { key: "chat:tombstoneYouRemoved", params: {} }, "you removed");
  assertEquals(line("admin", true, false), { key: "chat:tombstoneAdminRemovedYours", params: { name: "Sam" } }, "Sam removed yours");
  assertEquals(line("admin", false, false), { key: "chat:tombstoneAdminRemoved", params: { name: "Sam" } }, "Sam removed");
});

Deno.test("#4456 stored rows: placeholder vs hidden", () => {
  assertEquals(unsentStateOf({ deleted_at: null }), {}, "live");
  assertEquals(unsentStateOf({ deleted_at: "x", unsent_kind: "sender", unsent_by: "u1" }), { tombstone: { kind: "sender", byUserId: "u1" } }, "sender");
  assertEquals(unsentStateOf({ deleted_at: "x", unsent_kind: "admin", unsent_by: null }), { tombstone: { kind: "admin", byUserId: null } }, "admin, account gone");
  for (const kind of ["host", "server", "legacy", null, undefined]) {
    assertEquals(unsentStateOf({ deleted_at: "x", unsent_kind: kind }), { unsent: true }, `${kind} stays hidden`);
  }
});

Deno.test("#4456 reply quotes", () => {
  assertEquals(replyQuoteState(undefined), "unavailable", "not loaded");
  assertEquals(replyQuoteState({ unsent: true }), "unavailable", "deleted for me");
  assertEquals(replyQuoteState({ tombstone: { kind: "sender" } }), "unsent", "unsent");
  assertEquals(replyQuoteState({}), "live", "live");
});

Deno.test("#4456 Android back closes the confirm first, then the menu", () => {
  assertEquals(CHAT_BACK_LAYERS.indexOf("unsendConfirm") < CHAT_BACK_LAYERS.indexOf("contextMenu"), true, "order");
  assertEquals(resolveChatBack({ unsendConfirm: true, contextMenu: true }), "unsendConfirm", "confirm first");
});

Deno.test("#4456 the phone's limits match the server's", async () => {
  const sql = await Deno.readTextFile(new URL("../../../../supabase/migrations/20280721004456_issue_4456_unsend_and_delete_for_me.sql", import.meta.url));
  const max = /cardinality\(v_ids\) > (\d+)\s*\n\s*OR cardinality\(v_ids\) <> cardinality/.exec(sql);
  assertEquals(Number(max?.[1]), UNSEND_MAX_IDS, "unsend_messages takes up to 10 ids");
  const types = /issue_4456_is_unsendable_type[\s\S]*?IN \(([^)]*)\)/.exec(sql);
  const serverTypes = [...(types?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assertEquals(serverTypes, [...UNSENDABLE_MESSAGE_TYPES].sort(), "unsendable types");
  assertEquals(/interval '48 hours'|unsend_window/.test(sql), false, "no time limit on the server either");
});
