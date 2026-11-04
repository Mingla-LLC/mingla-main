// Issue #4261 Wave A — the "joined from your invite" push copy.
//
// The default accepted-request copy must stay byte-identical; the share_link
// variant gets its own title, body, data type and idempotency key; only the
// literal "share_link" selects it; and the handler really uses the module.
//
// FAILS-ON-REVERT: delete acceptedCopy.ts (import fails) or revert index.ts to
// the inline copy (the handler-wiring test fails).
//
// Run: deno test --no-check --allow-env --allow-net --allow-read \
//   supabase/functions/send-friend-accepted-notification/__tests__/issue_4261_share_link_copy.implementor.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { acceptedNotificationCopy, parseAcceptedSource } from "../acceptedCopy.ts";

Deno.test("default copy is unchanged", () => {
  const copy = acceptedNotificationCopy({
    accepterName: "Ada Obi",
    accepterId: "acc-1",
    senderId: "snd-1",
    requestId: "req-1",
  });
  assertEquals(copy.title, "Ada Obi accepted your request");
  assertEquals(copy.body, "You're now connected — start planning together!");
  assertEquals(copy.dataType, "friend_accepted");
  assertEquals(copy.idempotencyKey, "friend_request_accepted:acc-1:req-1");
});

Deno.test("default idempotency key falls back to the sender without a request id", () => {
  const copy = acceptedNotificationCopy({ accepterName: "Someone", accepterId: "a", senderId: "s" });
  assertEquals(copy.idempotencyKey, "friend_request_accepted:a:s");
});

Deno.test("share_link copy, data type and idempotency key", () => {
  const copy = acceptedNotificationCopy({
    accepterName: "Lola",
    accepterId: "acc-2",
    senderId: "snd-2",
    requestId: "req-2",
    source: "share_link",
  });
  assertEquals(copy.title, "Lola joined from your invite");
  assertEquals(copy.body, "You're friends now. Say hi.");
  assertEquals(copy.dataType, "friend_share_joined");
  assertEquals(copy.idempotencyKey, "friend_share_joined:acc-2:snd-2");
});

Deno.test("only the literal share_link selects the invite copy", () => {
  assertEquals(parseAcceptedSource("share_link"), "share_link");
  for (const value of [undefined, null, "", "SHARE_LINK", "app", 1, {}, ["share_link"]]) {
    assertEquals(parseAcceptedSource(value), undefined);
  }
});

Deno.test("the handler takes its copy from the module, not inline strings", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(source.includes('from "./acceptedCopy.ts"'), "index.ts must import acceptedCopy.ts");
  assert(source.includes("parseAcceptedSource(payload.source)"), "index.ts must parse the source field");
  for (const field of ["copy.title", "copy.body", "copy.dataType", "copy.idempotencyKey"]) {
    assert(source.includes(field), `index.ts must send ${field}`);
  }
  assert(!source.includes("accepted your request`"), "the default title must live only in acceptedCopy.ts");
  assert(source.includes('type: "friend_request_accepted"'), "the notify-dispatch type is unchanged (no new type mapping)");
});
