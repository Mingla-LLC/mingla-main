import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createOneSignalEventStreamHandler } from "./index.ts";

const token = "C".repeat(43);
const appId = "11111111-1111-4111-8111-111111111111";
const canonical = {
  schemaVersion: 1,
  categoryKey: "offering_invitation",
  eventId: "22222222-2222-4222-8222-222222222222",
  eventKind: "message.push.received",
  occurredAt: "2026-08-10T18:00:00Z",
  appId,
  messageId: "33333333-3333-4333-8333-333333333333",
  externalId: "44444444-4444-4444-8444-444444444444",
  attemptId: "55555555-5555-4555-8555-555555555555",
};
const request = (body: unknown, authorization = `Bearer ${token}`) =>
  new Request("http://local/onesignal-event-stream", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

Deno.test("#1770 unrelated blank events are 204 with zero SQL; offering event reconciles", async () => {
  Deno.env.set(
    "AD_CONVERSION_TOKENS",
    JSON.stringify({ ONESIGNAL_EVENT_STREAM_TOKEN_CURRENT: token }),
  );
  Deno.env.set("ONESIGNAL_APP_ID", appId);
  Deno.env.set("ONESIGNAL_REST_API_KEY", "rest");
  let calls = 0;
  let args: Record<string, unknown> | null = null;
  const handler = createOneSignalEventStreamHandler({
    rpc: (_name, value) => {
      calls++;
      args = value;
      return Promise.resolve({ data: {}, error: null });
    },
  });
  assertEquals(
    (await handler(request({ schemaVersion: 1, categoryKey: "", eventId: "" })))
      .status,
    204,
  );
  assertEquals(calls, 0);
  assertEquals(
    (await handler(
      request({ ...canonical, appId: "66666666-6666-4666-8666-666666666666" }),
    )).status,
    204,
  );
  assertEquals(calls, 0);
  const accepted = await handler(request(canonical));
  assertEquals(accepted.status, 204);
  assertEquals(await accepted.text(), "");
  assertEquals(calls, 1);
  assertEquals(
    (args as Record<string, unknown> | null)?.p_attempt_id,
    canonical.attemptId,
  );
  assertEquals((await handler(request(canonical, "Bearer wrong"))).status, 401);
});

Deno.test("#1770 transport errors are bounded and DB failures retry", async () => {
  Deno.env.set(
    "AD_CONVERSION_TOKENS",
    JSON.stringify({ ONESIGNAL_EVENT_STREAM_TOKEN_CURRENT: token }),
  );
  Deno.env.set("ONESIGNAL_APP_ID", appId);
  Deno.env.set("ONESIGNAL_REST_API_KEY", "rest");
  const handler = createOneSignalEventStreamHandler({
    rpc: () => Promise.resolve({ data: null, error: { message: "transient" } }),
  });
  assertEquals(
    (await handler(
      new Request("http://local", {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      }),
    )).status,
    405,
  );
  assertEquals((await handler(request(canonical))).status, 503);
  assertEquals(
    (await handler(request({ ...canonical, eventId: "bad" }))).status,
    400,
  );
});
