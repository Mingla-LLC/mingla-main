// MINGLA-INVARIANT: I-4456-PUSH-SKIPS-UNSENT | issue #4456 | notify-message pushes nothing for a message removed before the push goes out, and every chat push it dispatches names its message (data.messageId) so an unsend can quiet the in-app row
//
// FAILS-ON-REVERT: drop the unsentBeforePush calls in index.ts, or go back to
// `data: { deepLink }`, and the source checks fail; break the helpers and the
// unit checks fail.
import { messagePushData, pushMessageId, unsentBeforePush } from "../messageKeys.ts";

const MESSAGE = "8f0c4c1e-6a51-4d2f-9a4e-0b6f3c2d1e00";

function equals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: expected ${e}, got ${a}`);
}

Deno.test("#4456 push data names the message, normalized", () => {
  equals(messagePushData("mingla://chat/c", MESSAGE.toUpperCase()), { deepLink: "mingla://chat/c", messageId: MESSAGE }, "uuid kept");
  equals(messagePushData("mingla://chat/c", undefined), { deepLink: "mingla://chat/c" }, "no id from old builds");
  equals(messagePushData("mingla://chat/c", "not-a-uuid"), { deepLink: "mingla://chat/c" }, "junk dropped");
  equals(pushMessageId(` ${MESSAGE} `), MESSAGE, "trimmed");
});

Deno.test("#4456 a message removed before the push pushes nothing", async () => {
  const lookups: string[] = [];
  const removed = await unsentBeforePush(MESSAGE, async (id) => {
    lookups.push(id);
    return { deletedAt: "2026-11-16T10:00:00Z", found: true, error: false };
  });
  equals(removed, true, "removed message skipped");
  equals(lookups, [MESSAGE], "looked up by id");
  equals(await unsentBeforePush(MESSAGE, async () => ({ deletedAt: null, found: true, error: false })), false, "live message pushes");
  equals(await unsentBeforePush(MESSAGE, async () => ({ deletedAt: null, found: false, error: false })), false, "unknown id pushes (not yet visible)");
  equals(await unsentBeforePush(MESSAGE, async () => ({ deletedAt: null, found: false, error: true })), false, "a failed lookup never blocks the push");
  let called = false;
  equals(await unsentBeforePush(undefined, async () => {
    called = true;
    return { deletedAt: "x", found: true, error: false };
  }), false, "no id, no lookup");
  equals(called, false, "no lookup without an id");
});

Deno.test("#4456 notify-message wires both chat handlers and the card share", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const skips = source.match(/unsentBeforePush\(messageId, messageRowLookup\(adminClient\)\)/g) ?? [];
  equals(skips.length, 3, "message, mention and card share check before pushing");
  equals((source.match(/data: messagePushData\(deepLink, messageId\)/g) ?? []).length, 2, "message and mention data carry the id");
  equals(/data: \{ deepLink \},/.test(source), false, "no chat push data without the id");
  equals(/\.select\("id, deleted_at"\)/.test(source), true, "the lookup reads no content");
});
