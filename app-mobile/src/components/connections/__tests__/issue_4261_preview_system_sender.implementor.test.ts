// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4261 amendment 1 (B-3) — the chat list never prefixes a system row
// with a sender name ("Deleted User: Seth locked in …" came from a plan system
// row with no sender).
//
// FAILS-ON-REVERT: drop chatPreviewLine (or its system-row rule) and the
// "Deleted User" case fails; put the old inline composition back in
// ChatListItem and the static case fails.
// MINGLA-INVARIANT: I-4261-PREVIEW-NO-SYSTEM-SENDER | issue #4261 | The chat list never prefixes a system row (message_type system or no sender) with a sender name or "You:".

import { chatPreviewLine, chatPreviewText } from "../chatListModel.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`);
}

const EN: Record<string, string> = { "connections:preview_you": "You: {{text}}" };
const t = (key: string, params: Record<string, unknown> = {}) =>
  (EN[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name) => String(params[name] ?? ""));
const base = { isGroup: true, isEvent: false, isBrandChannel: false, currentUserId: "me", t };

Deno.test("a plan system row in a group has no sender prefix", () => {
  const message = { message_type: "system", sender_id: null, sender_name: "Deleted User", content: "Seth locked in Rooftop drinks", card_payload: { kind: "plan_event", event: "locked" } };
  assertEquals(chatPreviewLine({ ...base, message, text: chatPreviewText(message, t) }), "Seth locked in Rooftop drinks", "no Deleted User:");
  const nullSender = { message_type: "text", sender_id: null, sender_name: "Deleted User" };
  assertEquals(chatPreviewLine({ ...base, message: nullSender, text: "Ada joined" }), "Ada joined", "no sender id is a system row");
  const placeAdded = { message_type: "system", sender_id: null, sender_name: "Deleted User", content: "Ada suggested Skyline Terrace for Rooftop drinks", card_payload: { kind: "plan_event", event: "place_added" } };
  assertEquals(chatPreviewLine({ ...base, message: placeAdded, text: chatPreviewText(placeAdded, t) }), "Ada suggested Skyline Terrace for Rooftop drinks", "place_added previews its content");
});

Deno.test("people's messages keep today's rules", () => {
  assertEquals(chatPreviewLine({ ...base, message: { message_type: "text", sender_id: "ada", sender_name: "Ada" }, text: "hi" }), "Ada: hi", "group text");
  assertEquals(chatPreviewLine({ ...base, message: { message_type: "text", sender_id: "me", sender_name: "Me" }, text: "hi" }), "You: hi", "own message");
  assertEquals(chatPreviewLine({ ...base, isGroup: false, message: { message_type: "text", sender_id: "ada", sender_name: "Ada" }, text: "hi" }), "hi", "direct chat");
  assertEquals(
    chatPreviewLine({ ...base, isEvent: true, eventBrandName: "Club X", message: { message_type: "text", sender_id: "b", sender_name: "Bo", marketing_campaign_id: "c1" }, text: "Doors at 9" }),
    "Club X: Doors at 9",
    "brand message in an event chat",
  );
  assertEquals(
    chatPreviewLine({ ...base, isBrandChannel: true, eventTitle: "Friday Rave", message: { message_type: "text", sender_id: "me", sender_name: "Me" }, text: "see you" }),
    "Friday Rave · You: see you",
    "brand channel line unchanged",
  );
  assertEquals(
    chatPreviewLine({ ...base, isBrandChannel: true, eventTitle: "Friday Rave", message: { message_type: "system", sender_id: null, sender_name: "Deleted User" }, text: "Ada joined" }),
    "Friday Rave · Ada joined",
    "brand channel system row",
  );
});

Deno.test("ChatListItem composes the line through chatPreviewLine", async () => {
  const item = await Deno.readTextFile(new URL("../ChatListItem.tsx", import.meta.url));
  assert(/chatPreviewLine\(\{/.test(item), "ChatListItem calls chatPreviewLine");
  assert(!/lastMessage\.sender_name\}: \$\{text\}|: lastMessage\.sender_name\}/.test(item), "no inline sender prefix left");
});
