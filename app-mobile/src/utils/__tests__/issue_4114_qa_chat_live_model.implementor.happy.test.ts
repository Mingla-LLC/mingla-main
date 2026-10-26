// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 simulator QA: reactions and view-once opens merge into the open
// chat live, without refetching the thread.
//
// FAILS-ON-REVERT: drop the optimistic-id pairing (duplicate pill), the
// delete-by-id (pill never leaves), the first-open keep, or the same-array
// return (a state write for every unrelated row) and the matching case fails.

import { applyChatLiveChange, applyMediaView, applyReactionDelete, applyReactionInsert } from "../chatLiveModel.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const eq = (a: unknown, b: unknown, m: string) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)}`);

Deno.test("QA4 another person's reaction is added once", () => {
  const rows = applyReactionInsert([], { id: "r1", user_id: "ben", emoji: "❤️" });
  eq(rows, [{ id: "r1", user_id: "ben", emoji: "❤️" }], "added");
  assert(applyReactionInsert(rows, { id: "r1", user_id: "ben", emoji: "❤️" }) === rows, "the same row twice is a no-op");
});

Deno.test("QA4 my optimistic reaction gets its id instead of a second pill", () => {
  const rows = applyReactionInsert([{ user_id: "me", emoji: "👍" }], { id: "r9", user_id: "me", emoji: "👍" });
  eq(rows, [{ user_id: "me", emoji: "👍", id: "r9" }], "paired");
});

Deno.test("QA4 a removed reaction leaves by id", () => {
  const rows = [{ id: "r1", user_id: "ben", emoji: "❤️" }, { id: "r2", user_id: "ada", emoji: "❤️" }];
  eq(applyReactionDelete(rows, "r1"), [{ id: "r2", user_id: "ada", emoji: "❤️" }], "removed");
  assert(applyReactionDelete(rows, "nope") === rows, "unknown id changes nothing");
});

Deno.test("QA2c an open turns the sender's bubble Opened, first open kept", () => {
  const views = applyMediaView(undefined, { user_id: "ada", viewed_at: "2026-10-26T10:00:00Z" });
  eq(views, [{ user_id: "ada", viewed_at: "2026-10-26T10:00:00Z" }], "added");
  assert(applyMediaView(views, { user_id: "ada", viewed_at: "2026-10-26T10:01:00Z" }) === views, "first open kept");
});

Deno.test("QA2c/QA4 a chat's messages patch in place; unrelated rows change nothing", () => {
  const messages = [{ id: "m1" }, { id: "m2", reactions: [{ id: "r1", user_id: "ben", emoji: "❤️" }] }];
  assert(applyChatLiveChange(messages, { kind: "reaction_insert", messageId: "elsewhere", row: { id: "r5", user_id: "x", emoji: "😂" } }) === messages,
    "a row for another chat changes nothing");
  assert(applyChatLiveChange(messages, { kind: "reaction_delete", reactionId: "elsewhere" }) === messages, "unknown delete changes nothing");
  const reacted = applyChatLiveChange(messages, { kind: "reaction_insert", messageId: "m1", row: { id: "r2", user_id: "ada", emoji: "😂" } });
  eq(reacted[0].reactions, [{ id: "r2", user_id: "ada", emoji: "😂" }], "m1 reacted");
  assert(reacted[1] === messages[1], "untouched message keeps its identity");
  const unreacted = applyChatLiveChange(messages, { kind: "reaction_delete", reactionId: "r1" });
  eq(unreacted[1].reactions, [], "m2 reaction removed");
  const opened = applyChatLiveChange(messages, { kind: "media_view", messageId: "m1", row: { user_id: "ada", viewed_at: "t" } });
  eq(opened[0].mediaViews, [{ user_id: "ada", viewed_at: "t" }], "m1 opened");
});
