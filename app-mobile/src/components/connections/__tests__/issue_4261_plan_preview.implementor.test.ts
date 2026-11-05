// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4261 Wave B2 — the chat list's preview of a plan and of plan / group
// system rows (spec 5.4).
//
// FAILS-ON-REVERT: drop the `plan` case from chatPreviewText and a plan's
// preview reads the raw "Ada added a plan: ..." content; the plan case fails.

import { chatPreviewText } from "../chatListModel.ts";

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`);
}

const EN: Record<string, string> = {
  "chat:photoPreview": "Photo",
  "chat:filePreview": "File",
  "chat:videoPreview": "Video",
  "chat:plan_preview": "Plan: {{title}}",
  "chat:plan_chip": "Plan",
};
const t = (key: string, params: Record<string, unknown> = {}) =>
  (EN[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name) => String(params[name] ?? ""));

Deno.test("a plan previews as Plan: {title}", () => {
  assertEquals(
    chatPreviewText({ message_type: "plan", content: "Ada added a plan: Rooftop drinks", card_payload: { kind: "plan", planId: "p" } }, t),
    "Plan: Rooftop drinks",
    "plan preview",
  );
  assertEquals(chatPreviewText({ message_type: "plan", content: "" }, t), "Plan", "a plan with no content");
});

Deno.test("plan and group system rows preview with their content", () => {
  assertEquals(
    chatPreviewText({ message_type: "system", content: "Tobi locked in Movie night", card_payload: { kind: "plan_event", event: "locked" } }, t),
    "Tobi locked in Movie night",
    "plan_event",
  );
  assertEquals(
    chatPreviewText({ message_type: "system", content: "Dami  joined\nwith the group link", card_payload: { kind: "group_event" } }, t),
    "Dami joined with the group link",
    "group_event on one line",
  );
});

Deno.test("other kinds keep their labels", () => {
  assertEquals(chatPreviewText({ message_type: "image", content: "" }, t), "Photo", "photo");
  assertEquals(chatPreviewText({ message_type: "video", content: "" }, t), "Video", "video");
  assertEquals(chatPreviewText({ message_type: "file", content: "x.pdf" }, t), "File", "file");
  assertEquals(chatPreviewText({ message_type: "text", content: " hi  there " }, t), "hi there", "text");
  assertEquals(chatPreviewText(null, t), "", "no message");
});
