// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 simulator QA (evidence 27/28): iOS put the just-sent text back in
// the composer after Send and a second tap re-sent it.
//
// FAILS-ON-REVERT: let an echo of the sent text (or its autocorrected last
// word) through inside the window, or refuse real typing after it, and the
// matching case fails.

import {
  isComposerSendEcho,
  isDuplicateSend,
  SEND_ECHO_WINDOW_MS,
} from "../composerSendGuard.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const sent = { text: "Clear check number", at: 1_000 };

Deno.test("QA1 the exact sent text arriving inside the window is an echo", () => {
  assert(isComposerSendEcho(sent, "Clear check number", 1_100), "exact echo dropped");
  assert(isComposerSendEcho(sent, "Clear check number ", 1_100), "trailing space echo dropped");
});

Deno.test("QA1 an autocorrect or predictive swap of the last word is an echo", () => {
  assert(isComposerSendEcho(sent, "Clear check number one", 1_200), "predictive suffix dropped");
  assert(isComposerSendEcho(sent, "Clear check numbers", 1_200), "autocorrected last word dropped");
  assert(isComposerSendEcho({ text: "teh", at: 0 }, "the", 10), "single autocorrected word dropped");
});

Deno.test("QA1 real typing is never swallowed", () => {
  assert(!isComposerSendEcho(sent, "Clear check number", 1_000 + SEND_ECHO_WINDOW_MS + 1), "after the window it is typing");
  assert(!isComposerSendEcho(sent, "Something new", 1_100), "different text is typing");
  assert(!isComposerSendEcho(sent, "", 1_100), "the clear itself passes through");
  assert(!isComposerSendEcho(null, "Clear check number", 1_100), "no send yet");
});

Deno.test("QA1 a second Send of the same text inside the window is refused", () => {
  assert(isDuplicateSend(sent, "Clear check number", 1_050), "double tap refused");
  assert(!isDuplicateSend(sent, "Clear check number", 2_000), "sending it again later is allowed");
});
