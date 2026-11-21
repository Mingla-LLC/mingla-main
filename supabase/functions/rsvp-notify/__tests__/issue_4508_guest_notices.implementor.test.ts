// Issue #4508 R5-2 — rsvp-notify's tick sends the notices the claim sweep and
// the anonymous-RSVP attach queue (rsvp_guest_notices), with the submit
// path's own builder: same type, words and idempotency key.
// FAILS-ON-REVERT: drop the sendGuestNotices call from the tick -> "the tick
// sends the queued notices" fails; send a different body -> "same words" fails.

import { noticeFromRow, sendGuestNotices } from "../guestNotices.ts";
import { guestNoticeDispatch } from "../../_shared/rsvpGuestNotice.ts";

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new Error(message);
};

type Invoked = { name: string; body: Record<string, unknown> };

function fakeAdmin(
  take: { data: unknown; error: { message: string } | null },
  sendError: (body: Record<string, unknown>) => { message: string } | null = () => null,
) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const invoked: Invoked[] = [];
  return {
    rpcCalls,
    invoked,
    client: {
      rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        return Promise.resolve(take);
      },
      functions: {
        invoke(name: string, options: { body: Record<string, unknown> }) {
          invoked.push({ name, body: options.body });
          return Promise.resolve({ error: sendError(options.body) });
        },
      },
    },
  };
}

const row = {
  notice_id: "n-1",
  kind: "guest_has_own_rsvp",
  user_id: "inviter-1",
  guest_id: "guest-1",
  event_id: "event-1",
  event_title: "Round Five Places",
  phone_last4: "9400",
};

Deno.test("#4508 R5-2: a queued notice goes out with the submit path's words", async () => {
  const fake = fakeAdmin({ data: [row], error: null });
  const run = await sendGuestNotices(fake.client, () => {});
  assert(fake.rpcCalls.length === 1 && fake.rpcCalls[0].name === "issue_4508_take_guest_notices",
    "the tick takes from the queue once");
  assert(run.taken === 1 && run.sent === 1 && fake.invoked.length === 1, "one notice sent");
  const sent = fake.invoked[0];
  assert(sent.name === "notify-dispatch", "through notify-dispatch");
  const expected = guestNoticeDispatch(noticeFromRow(row));
  assert(expected !== null, "the builder accepts the row");
  assert(JSON.stringify(sent.body) === JSON.stringify(expected),
    "same words, type and idempotency key as the submit path: " + JSON.stringify(sent.body));
  assert(sent.body.type === "rsvp_guest_released" && sent.body.skipPush === true
    && sent.body.idempotencyKey === "rsvp_guest_own_rsvp:guest-1"
    && sent.body.title === "Your guest's spot is free"
    && String(sent.body.body).includes("ending 9400")
    && String(sent.body.body).includes("Round Five Places"),
    "the inviter's in-app notice: " + JSON.stringify(sent.body));
});

Deno.test("#4508 R5-2: malformed rows and failed sends are logged, never thrown", async () => {
  const logs: string[] = [];
  const fake = fakeAdmin(
    { data: [{ ...row, user_id: null }, row, { ...row, guest_id: "guest-2" }], error: null },
    (body) => body.idempotencyKey === "rsvp_guest_own_rsvp:guest-2" ? { message: "down" } : null,
  );
  const run = await sendGuestNotices(fake.client, (m) => logs.push(m));
  assert(run.taken === 3 && run.skipped === 1 && run.sent === 1 && run.failed === 1,
    "one skipped, one sent, one failed: " + JSON.stringify(run));
  assert(logs.some((m) => m.includes("malformed")) && logs.some((m) => m.includes("send failed")),
    "both are logged");
});

Deno.test("#4508 R5-2: a take that fails sends nothing", async () => {
  const fake = fakeAdmin({ data: null, error: { message: "boom" } });
  const run = await sendGuestNotices(fake.client, () => {});
  assert(run.taken === 0 && fake.invoked.length === 0, "nothing sent");
});

Deno.test("#4508 R5-2: the tick sends the queued notices", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  const tick = source.slice(source.indexOf("if (!notificationId) {\n    await alertUnreachedGuests"));
  assert(tick.length > 0 && /await sendGuestNotices\(admin\);/.test(tick.slice(0, 600)),
    "the every-minute tick calls sendGuestNotices");
});
