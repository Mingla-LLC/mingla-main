import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pushAdapter } from "./pushAdapter.ts";

const appId = "11111111-1111-4111-8111-111111111111";
const attemptId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const messageId = "44444444-4444-4444-8444-444444444444";
const eventId = "55555555-5555-4555-8555-555555555555";
const internalKey = `offering:${attemptId}:push:v1`;
const persisted = {
  payloadVersion: 1 as const,
  payloadHash: "a".repeat(64),
  title: "Invitation",
  body: "Open Mingla",
  eventId,
};

function input() {
  return {
    userId,
    title: persisted.title,
    body: persisted.body,
    routingType: "offering_invitation" as const,
    data: {
      event_id: eventId,
      category_key: "offering_invitation",
      offering_attempt_id: attemptId,
    },
    offeringAttemptId: attemptId,
    internalProviderClaimKey: internalKey,
    oneSignalIdempotencyKey: attemptId,
    persistedPushPayload: persisted,
    beforeProviderIo: async () => ({
      attemptId,
      recipientUserId: userId,
      internalProviderClaimKey: internalKey,
      pushPayload: persisted,
    }),
  };
}

Deno.test("#1770 offering push has exact result matrix and distinct provider keys", async () => {
  Deno.env.set("ONESIGNAL_APP_ID", appId);
  Deno.env.set("ONESIGNAL_REST_API_KEY", "rest-secret");
  const original = globalThis.fetch;
  try {
    const cases: Array<[Response, string, boolean]> = [
      [
        new Response(JSON.stringify({ id: messageId }), { status: 200 }),
        "accepted",
        false,
      ],
      [
        new Response(JSON.stringify({ errors: ["none"] }), { status: 200 }),
        "definitive_unsent_terminal",
        false,
      ],
      [new Response("{", { status: 200 }), "ambiguous", false],
      [
        new Response("", { status: 429, headers: { "retry-after": "17" } }),
        "definitive_unsent_retryable",
        true,
      ],
      [new Response("", { status: 400 }), "definitive_unsent_terminal", false],
      [new Response("", { status: 401 }), "definitive_unsent_terminal", false],
      [new Response("", { status: 403 }), "definitive_unsent_terminal", false],
      [new Response("", { status: 408 }), "ambiguous", false],
      [new Response("", { status: 500 }), "ambiguous", false],
    ];
    for (const [response, outcome, retryable] of cases) {
      let requestBody: Record<string, unknown> | null = null;
      globalThis.fetch = (_url, init) => {
        requestBody = JSON.parse(
          String((init as { body?: BodyInit } | undefined)?.body),
        );
        return Promise.resolve(response.clone());
      };
      const result = await pushAdapter.send(input());
      assertEquals(result.outcome, outcome);
      assertEquals(result.retryable, retryable);
      assertEquals(
        result.providerAppId,
        outcome === "accepted" ? appId : null,
      );
      const captured = requestBody as Record<string, unknown> | null;
      assertEquals(captured?.idempotency_key, attemptId);
      assertEquals("internalProviderClaimKey" in (captured ?? {}), false);
    }
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("#1770 rejected claim performs zero OneSignal I/O", async () => {
  Deno.env.set("ONESIGNAL_APP_ID", appId);
  Deno.env.set("ONESIGNAL_REST_API_KEY", "rest-secret");
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    return Promise.resolve(new Response("{}"));
  };
  try {
    const value = input();
    value.beforeProviderIo = () => Promise.reject(new Error("db unavailable"));
    let rejected = false;
    try {
      await pushAdapter.send(value);
    } catch {
      rejected = true;
    }
    assertEquals(rejected, true);
    assertEquals(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("#1770 synchronous pre-fetch failure is definitively unsent", async () => {
  Deno.env.set("ONESIGNAL_APP_ID", appId);
  Deno.env.set("ONESIGNAL_REST_API_KEY", "rest-secret");
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("sync construction failure");
  }) as typeof fetch;
  try {
    const result = await pushAdapter.send(input());
    assertEquals(result.outcome, "definitive_unsent_retryable");
    assertEquals(result.safeCode, "local_before_provider_io_failed");
  } finally {
    globalThis.fetch = original;
  }
});
