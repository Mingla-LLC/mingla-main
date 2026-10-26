// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 simulator QA. Run 1 (evidence 27/28): iOS put the just-sent text
// back in the composer after Send and a second tap re-sent it. Run 2 (evidence
// 01g): a fast type-then-send sent "Separate wor" and the late rest of the
// text was swallowed as an "echo".
//
// Rule change in run 2 (updated honestly): an echo is ONLY the exact sent text
// or the sent text with its final word swapped (same word count, not an
// extension of that word), inside the window, with no key pressed since Send.
// Run 1 also treated a predictive multi-word suffix ("number" -> "number one")
// as an echo; that case is now kept as typing, because it is indistinguishable
// from the rest of a fast message still arriving.
//
// FAILS-ON-REVERT: send from a render copy instead of the settled ref, let the
// guard drop an extension or a longer text, or drop a change after a key
// press, and the matching case fails.

import {
  createComposerSendCoordinator,
  isComposerSendEcho,
  isDuplicateSend,
  SEND_ECHO_WINDOW_MS,
} from "../composerSendGuard.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const sent = { text: "Clear check number", at: 1_000, typedSinceSend: false };

Deno.test("QA1 the exact sent text arriving inside the window is an echo", () => {
  assert(isComposerSendEcho(sent, "Clear check number", 1_100), "exact echo dropped");
  assert(isComposerSendEcho(sent, "Clear check number ", 1_100), "trailing space echo dropped");
});

Deno.test("QA1 an autocorrect swap of the last word is an echo", () => {
  assert(isComposerSendEcho(sent, "Clear check numbed", 1_200), "autocorrected last word dropped");
  assert(isComposerSendEcho({ text: "teh", at: 0, typedSinceSend: false }, "the", 10), "single autocorrected word dropped");
});

Deno.test("QA1 run 2: the rest of a fast message is never swallowed", () => {
  const stale = { text: "Separate wor", at: 1_000, typedSinceSend: false };
  assert(!isComposerSendEcho(stale, "Separate words here", 1_050), "longer text is typing");
  assert(!isComposerSendEcho(stale, "Separate words", 1_050), "an extended last word is typing");
  assert(!isComposerSendEcho(sent, "Clear check number one", 1_100), "a longer text is kept (rule change)");
  assert(!isComposerSendEcho({ text: "Recieve", at: 0, typedSinceSend: false }, "Receive this", 50), "more words is typing");
});

Deno.test("QA1 a key press after Send ends echo suppression", () => {
  const typed = { ...sent, typedSinceSend: true };
  assert(!isComposerSendEcho(typed, "Clear check number", 1_100), "typed after send is kept");
  assert(!isDuplicateSend(typed, "Clear check number", 1_100), "retyped text can be sent");
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
  assert(!isDuplicateSend(sent, "Clear check numbers", 1_050), "a different text is not a duplicate");
});

// A tiny composer model: the coordinator plus a synchronous text ref, the way
// MessageInterface wires it. `settle` is held so the test can deliver native
// events that land between the Send tap and the frame.
function harness() {
  let clock = 1_000;
  let pendingSettle: (() => void) | null = null;
  let latest = "";
  const sentTexts: string[] = [];
  const coordinator = createComposerSendCoordinator({
    settle: (run) => { pendingSettle = run; },
    now: () => clock,
  });
  const change = (text: string) => {
    if (coordinator.acceptChange(text)) latest = text;
  };
  const key = () => coordinator.noteKeystroke();
  const tapSend = () =>
    coordinator.requestSend({
      read: () => latest,
      send: (text) => { sentTexts.push(text); latest = ""; },
    });
  const frame = () => { const run = pendingSettle; pendingSettle = null; run?.(); };
  const tick = (ms: number) => { clock += ms; };
  return { change, key, tapSend, frame, tick, sentTexts, get box() { return latest; } };
}

Deno.test("QA1 run 2: fast type-then-send sends the full final text and nothing comes back", () => {
  const h = harness();
  h.change("Seperate");
  h.change("Separate wor");
  h.tapSend(); // tapped while the rest is still in flight
  h.tapSend(); // a double tap during the frame is one send
  h.change("Separate words");
  h.change("Separate words here");
  h.frame();
  assert(h.sentTexts.length === 1, `one send, got ${h.sentTexts.length}`);
  assert(h.sentTexts[0] === "Separate words here", `sent the full text, got "${h.sentTexts[0]}"`);
  assert(h.box === "", "box cleared");
  h.tick(40);
  h.change("Separate words here"); // iOS echo after the clear
  assert(h.box === "", `echo dropped, box is "${h.box}"`);
});

Deno.test("QA1 run 2: text typed right after Send is kept", () => {
  const h = harness();
  h.change("Receive this");
  h.tapSend();
  h.frame();
  assert(h.sentTexts[0] === "Receive this", "sent");
  h.tick(30);
  h.key();
  h.change("Receive this"); // the user really typed it again
  assert(h.box === "Receive this", "typing after send kept even when it matches");
  h.tick(10);
  h.key();
  h.change("Receive this!");
  assert(h.box === "Receive this!", "next keystroke kept");
});
