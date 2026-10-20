// #3988 — a Host reply becomes outbox rows through one database call; the old
// push to the available roster only runs if that call cannot.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { enqueueReplyAlerts } from "./replyAlerts.ts";

const TICKET = "39880000-0000-4000-8000-0000000000a1";
const MESSAGE = "39880000-0000-4000-8000-0000000000b1";
const SENDER = "39880000-0000-4000-8000-000000000009";

type Call = { fn: string; args: Record<string, unknown> };

function client(result: { data: unknown; error: unknown } | Error, calls: Call[]) {
  return {
    rpc(fn: "issue_3988_enqueue_support_reply_alerts", args: Record<string, unknown>) {
      calls.push({ fn, args });
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result);
    },
  };
}

function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  return fn().finally(() => {
    console.error = original;
  });
}

Deno.test("a Host reply is enqueued once per message with the sender passed through", async () => {
  const calls: Call[] = [];
  const result = await enqueueReplyAlerts(client({ data: 5, error: null }, calls), {
    ticketId: TICKET,
    messageId: MESSAGE,
    senderUserId: SENDER,
  });
  assertEquals(result, { ok: true, count: 5 });
  assertEquals(calls, [{
    fn: "issue_3988_enqueue_support_reply_alerts",
    args: { p_ticket_id: TICKET, p_message_id: MESSAGE, p_sender_user_id: SENDER },
  }]);
});

Deno.test("no message id (an older caller) never calls the database and asks for the fallback", async () => {
  const calls: Call[] = [];
  for (const messageId of [null, "", "not-a-uuid"]) {
    assertEquals(
      await enqueueReplyAlerts(client({ data: 1, error: null }, calls), {
        ticketId: TICKET,
        messageId,
        senderUserId: SENDER,
      }),
      { ok: false, reason: "message_id_missing" },
    );
  }
  assertEquals(calls.length, 0);
});

Deno.test("a database error or a throw is reported, never treated as sent", async () => {
  const calls: Call[] = [];
  await quiet(async () => {
    assertEquals(
      await enqueueReplyAlerts(client({ data: null, error: { code: "42501" } }, calls), {
        ticketId: TICKET, messageId: MESSAGE, senderUserId: SENDER,
      }),
      { ok: false, reason: "enqueue_failed" },
    );
    assertEquals(
      await enqueueReplyAlerts(client(new Error("network"), calls), {
        ticketId: TICKET, messageId: MESSAGE, senderUserId: SENDER,
      }),
      { ok: false, reason: "enqueue_failed" },
    );
  });
});

Deno.test("support-send hands notify-support the message id; notify-support enqueues before any push", async () => {
  const send = await Deno.readTextFile(new URL("../support-send/index.ts", import.meta.url));
  assertEquals(/messageId: inserted\?\.id \?\? null/.test(send), true);
  const notify = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const enqueue = notify.indexOf("await enqueueReplyAlerts(admin,");
  const fallback = notify.indexOf("for (const id of await availableStaffIds(admin))");
  assertEquals(enqueue > 0 && fallback > enqueue, true);
  assertEquals(notify.includes("if (enqueued.ok) {"), true);
});
