// Issue #4114 rework 2, tester adversarial — DM push keys on retry.
//
// Angles the implementor suite does not cover:
//   * a retry whose message id comes back with surrounding whitespace or in
//     upper case still lands on the first attempt's key (one push);
//   * old app builds that send no message id (or a null / non-string one) keep
//     a per-call key, so each of their sends still pushes;
//   * a message id cannot be used to inject key segments or collide with
//     another conversation's or another recipient's key;
//   * group keys are byte-for-byte what they were before the rework, whether
//     or not a message id is sent, so group pushes are unchanged;
//   * the client sends messageId on the DM fan-out, and the 23505 recovery path
//     reuses the stored row (same id), so the retry key matches the original.
//
// FAILS-ON-REVERT: drop the UUID check or the trim/lower-case in
// unifiedMessageIdempotencyKey, add the message id to the group key, or drop
// messageId from the client's direct_message invoke.

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
const CONV2 = "a2a2a2a2-1111-4111-8111-111111111111";
const SENDER = "b2b2b2b2-2222-4222-8222-222222222222";
const FRIEND = "c3c3c3c3-3333-4333-8333-333333333333";
const FRIEND2 = "c4c4c4c4-3333-4333-8333-333333333333";
const MSG = "d4d4d4d4-4444-4444-8444-444444444444";

function dm(messageId: unknown, nowMs: number, conversationId = CONV, recipientId = FRIEND): string {
  return unifiedMessageIdempotencyKey({
    isGroup: false, conversationId, senderId: SENDER, recipientId,
    messageId: messageId as string | undefined, nowMs,
  });
}

/** notify-dispatch's rule: a key that already exists is not pushed again. */
function pushes(keys: string[]): number {
  return new Set(keys).size;
}

Deno.test("#4114 adversarial: a retry with a padded or upper-case id still pushes once", () => {
  assertEquals(pushes([dm(MSG, 1), dm(` ${MSG.toUpperCase()}\n`, 9_999_999)]), 1, "one push");
});

Deno.test("#4114 adversarial: old clients (no usable id) push on every send", () => {
  for (const missing of [undefined, null, "", 123, {}, "   "]) {
    assertEquals(pushes([dm(missing, 1000), dm(missing, 1001)]), 2, `two sends push twice (${JSON.stringify(missing)})`);
    assert(dm(missing, 1000).startsWith(`dm:${SENDER}:${CONV}:`), "legacy key shape");
  }
});

Deno.test("#4114 adversarial: a message id cannot inject key segments or collide across chats/recipients", () => {
  for (const evil of [`${MSG}:${FRIEND2}`, `${MSG}\u0000`, `${MSG} x`, `x${MSG}`, `${MSG}`.replace(/-/g, ":")]) {
    assert(dm(evil, 7).startsWith("dm:"), `untrusted id falls back to the legacy key: ${JSON.stringify(evil)}`);
  }
  const keys = [dm(MSG, 1, CONV, FRIEND), dm(MSG, 1, CONV, FRIEND2), dm(MSG, 1, CONV2, FRIEND)];
  assertEquals(pushes(keys), 3, "conversation and recipient are both in the key");
});

Deno.test("#4114 adversarial: group keys are unchanged with or without a message id", () => {
  const now = 1_700_000_123_456;
  const legacy = `group_msg:${CONV}:${Math.floor(now / (5 * 60 * 1000))}:${FRIEND}`;
  for (const messageId of [undefined, MSG, "junk"]) {
    const key = unifiedMessageIdempotencyKey({
      isGroup: true, conversationId: CONV, senderId: SENDER, recipientId: FRIEND, messageId, nowMs: now,
    });
    assertEquals(key, legacy, `group key with messageId=${messageId}`);
  }
});

Deno.test("#4114 adversarial: the client names the stored message id on DM pushes and retries reuse the row", () => {
  const service = Deno.readTextFileSync(new URL("../../../../app-mobile/src/services/messagingService.ts", import.meta.url));
  const dmAt = service.indexOf("private async sendMessageNotifications(");
  const dmBlock = service.slice(dmAt, service.indexOf("\n  }\n", service.indexOf("supabase.functions.invoke('notify-message'", dmAt)));
  assert(/type: 'direct_message',[\s\S]*?messageId: message\.id,/.test(dmBlock), "direct_message invoke carries messageId");
  const sendAt = service.indexOf("error.code === '23505'");
  const recovery = service.slice(sendAt, service.indexOf("const enrichedMessage", sendAt));
  assert(/data = existing\.data;/.test(recovery), "the recovered row (with its server id) is what gets notified");
  assert(/\.eq\('client_id', clientId\)/.test(recovery) && /\.eq\('sender_id', senderId\)/.test(recovery),
    "recovery is scoped to this sender's client id");
});
