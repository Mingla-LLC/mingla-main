// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 — scrolled up in a thread, sending a message did not take you to
// it; the thread only followed when you were already at the bottom. Now your
// own send (text, card, media) always jumps to the latest, and someone else's
// message while you read higher up leaves you where you are and bumps the
// scroll-to-latest count.
//
// FAILS-ON-REVERT: gate the own-send jump on being at the bottom, scroll on an
// incoming message while scrolled up, treat a confirmed optimistic copy or a
// retry as a new send, or drop the hook / list wiring and the matching case
// fails.

import { newestArrivalAction } from "../threadModel.ts";

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const theirs = { id: "m-1", key: "m-1", isMine: false };
const mineSent = { id: "temp-2", key: "client-2", isMine: true };

Deno.test("own send jumps to the latest even when scrolled up", () => {
  assertEquals(newestArrivalAction(theirs, mineSent, true), "jumpToLatest", "scrolled up");
  assertEquals(newestArrivalAction(theirs, mineSent, false), "jumpToLatest", "at the bottom");
});

Deno.test("incoming message while scrolled up does not scroll; it counts", () => {
  const incoming = { id: "m-3", key: "m-3", isMine: false };
  assertEquals(newestArrivalAction(mineSent, incoming, true), "countUnseen", "scrolled up");
  assertEquals(newestArrivalAction(mineSent, incoming, false), "none", "at the bottom the list follows by itself");
});

Deno.test("the same message again is not a new arrival", () => {
  const confirmed = { id: "uuid-2", key: "client-2", isMine: true };
  assertEquals(newestArrivalAction(mineSent, confirmed, true), "none", "optimistic copy confirmed");
  const failedNoClient = { id: "temp-9", key: "temp-9", isMine: true };
  const retried = { id: "temp-9", key: "client-9", isMine: true };
  assertEquals(newestArrivalAction(failedNoClient, retried, true), "none", "retry of a failed send");
  assertEquals(newestArrivalAction(null, mineSent, true), "none", "first load");
  assertEquals(newestArrivalAction(theirs, null, true), "none", "thread emptied");
});

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

Deno.test("hook and thread list wire the own-send jump", async () => {
  const hook = strip(await read("hooks/useScrollToLatest.ts"));
  assert(/newestArrivalAction\(previousNewestRef\.current, next, awayRef\.current\)/.test(hook), "the hook asks the model");
  assert(/action === "jumpToLatest"[\s\S]*pendingJumpRef\.current = true/.test(hook), "an own send queues a jump");
  assert(/if \(pendingJumpRef\.current\) jumpToLatest\(\)/.test(hook), "the jump runs once the row has laid out");
  assert(/scrollToOffset\(\{ offset: 0, animated: true \}\)/.test(hook), "the jump is an animated scroll to the latest");
  assert(/setShowScrollToLatest\(false\)/.test(hook), "the jump hides the button");

  const chat = strip(await read("components/MessageInterface.tsx"));
  assert(/onContentSizeChange=\{handleContentSizeChange\}/.test(chat), "the thread list reports layout to the hook");
  assert(/onOwnSendJump: clearNewDivider/.test(chat), "an own send clears the new-messages divider");
  assert(/key: newestVisible\.clientId \?\? newestVisible\.id/.test(chat), "the newest message keys by client id");
});
