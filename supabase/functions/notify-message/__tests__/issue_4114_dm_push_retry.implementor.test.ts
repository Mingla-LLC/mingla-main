// Issue #4114 rework — a send retry notifies again, and one message id still
// produces exactly one direct-message push.
//
// The app now always calls notify-message after a send, including a retry
// whose first attempt was already stored (its push may never have gone out).
// notify-message keys DM pushes on the message id, and notify-dispatch refuses a
// second notification with an existing idempotency_key, so the retry lands on
// the first attempt's key. The fake ledger below is that notify-dispatch rule.
//
// FAILS-ON-REVERT: key DMs on Date.now() again (or drop messageId from the
// handleUnifiedMessage calls) and the retry pushes twice.
// MINGLA-INVARIANT: I-4114-DM-PUSH-ONE-PER-MESSAGE | issue #4114 | A direct-message push for a named message id uses a key derived only from the conversation, the message id and the recipient, so retries of one message produce one push.

import { unifiedMessageIdempotencyKey } from "../messageKeys.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}

const CONV = "a1a1a1a1-1111-4111-8111-111111111111";
const SENDER = "b2b2b2b2-2222-4222-8222-222222222222";
const FRIEND = "c3c3c3c3-3333-4333-8333-333333333333";
const MSG = "d4d4d4d4-4444-4444-8444-444444444444";
const MSG2 = "e5e5e5e5-5555-4555-8555-555555555555";

/** notify-dispatch: a notification whose idempotency_key already exists is not sent again. */
function ledger() {
  const keys = new Set<string>();
  let pushes = 0;
  return {
    dispatch(key: string) {
      if (keys.has(key)) return;
      keys.add(key);
      pushes += 1;
    },
    get pushes() {
      return pushes;
    },
  };
}

function dmKey(messageId: string | undefined, nowMs: number): string {
  return unifiedMessageIdempotencyKey({
    isGroup: false, conversationId: CONV, senderId: SENDER, recipientId: FRIEND, messageId, nowMs,
  });
}

Deno.test("#4114 a DM send and its retry (seconds later) push exactly once", () => {
  const sent = ledger();
  sent.dispatch(dmKey(MSG, 1_700_000_000_000));
  sent.dispatch(dmKey(MSG, 1_700_000_007_321)); // the retry re-notifies
  assertEquals(sent.pushes, 1, "one push for one message id");
});

Deno.test("#4114 two different DMs still push twice", () => {
  const sent = ledger();
  sent.dispatch(dmKey(MSG, 1_700_000_000_000));
  sent.dispatch(dmKey(MSG2, 1_700_000_000_000));
  assertEquals(sent.pushes, 2, "each message pushes");
});

Deno.test("#4114 the DM key is the message id (case-normalised), and old callers keep the per-call key", () => {
  assertEquals(dmKey(MSG.toUpperCase(), 1), dmKey(MSG, 2), "case does not split one message");
  assertEquals(dmKey(undefined, 42), `dm:${SENDER}:${CONV}:42`, "no message id: legacy per-call key");
  assertEquals(dmKey("not-a-uuid", 42), `dm:${SENDER}:${CONV}:42`, "a malformed id is not trusted as a key");
});

Deno.test("#4114 group pushes keep the 5-minute bucket per recipient", () => {
  const key = (nowMs: number) => unifiedMessageIdempotencyKey({
    isGroup: true, conversationId: CONV, senderId: SENDER, recipientId: FRIEND, messageId: MSG, nowMs,
  });
  const bucket = Math.floor(1_700_000_000_000 / 300_000);
  assertEquals(key(1_700_000_000_000), `group_msg:${CONV}:${bucket}:${FRIEND}`, "unchanged group shape");
});

Deno.test("#4114 notify-message passes the message id into the DM fan-out", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url));
  assert(source.includes('import { unifiedMessageIdempotencyKey } from "./messageKeys.ts";'), "uses the shared key");
  assert(!/`dm:\$\{senderId\}:\$\{conversationId\}:\$\{messageTimestamp\}`/.test(source), "no inline per-call DM key");
  const fanOut = source.slice(source.indexOf("async function handleUnifiedMessage("), source.indexOf("async function handleUnifiedMention("));
  assert(/messageId\?: string,\s*\): Promise<\{ notified: number \}>/.test(fanOut), "the fan-out takes the message id");
  assert(/unifiedMessageIdempotencyKey\(\{[\s\S]*?messageId,[\s\S]*?\}\)/.test(fanOut), "and keys on it");
  for (const route of ['if (type === "message") {', 'if (type === "direct_message") {']) {
    const at = source.indexOf(route);
    const block = source.slice(at, source.indexOf("return jsonResponse({ success: true, notified });", at));
    assert(at > 0 && /const \{ conversationId, messagePreview, messageId \} = body;/.test(block), `${route} reads messageId`);
    assert(/messagePreview,\s*messageId,\s*\);/.test(block), `${route} forwards messageId`);
  }
});
