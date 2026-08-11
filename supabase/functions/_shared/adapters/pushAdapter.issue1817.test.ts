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

type Expected = {
  outcome: string;
  status: "sent" | "sending" | "failed";
  safeCode: string | null;
  retryable: boolean;
};

Deno.test("#1817 canonical OneSignal acceptance is Sent, never Delivered", async () => {
  Deno.env.set("ONESIGNAL_APP_ID", appId);
  Deno.env.set("ONESIGNAL_REST_API_KEY", "rest-secret");
  const original = globalThis.fetch;
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = (_url, init) => {
    requestBody = JSON.parse(
      String((init as { body?: BodyInit } | undefined)?.body),
    );
    return Promise.resolve(
      new Response(JSON.stringify({ id: messageId }), { status: 200 }),
    );
  };
  try {
    const result = await pushAdapter.send(input());
    assertEquals(result, {
      outcome: "accepted",
      ok: true,
      status: "sent",
      provider: "onesignal",
      providerAppId: appId,
      providerMessageId: messageId,
      safeCode: null,
      retryable: false,
    });
    const captured = requestBody as unknown as Record<string, unknown>;
    assertEquals(captured.idempotency_key, attemptId);
    assertEquals("internalProviderClaimKey" in captured, false);
    assertEquals("delivered" in result, false);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("#1817 every non-accepted OneSignal observation keeps the #1770 matrix", async () => {
  Deno.env.set("ONESIGNAL_APP_ID", appId);
  Deno.env.set("ONESIGNAL_REST_API_KEY", "rest-secret");
  const original = globalThis.fetch;
  const cases: Array<[Response, Expected]> = [
    [
      new Response(JSON.stringify({ errors: ["no subscription"] }), {
        status: 200,
      }),
      {
        outcome: "definitive_unsent_terminal",
        status: "failed",
        safeCode: "provider_no_valid_subscription",
        retryable: false,
      },
    ],
    [
      new Response(JSON.stringify({}), { status: 200 }),
      {
        outcome: "definitive_unsent_terminal",
        status: "failed",
        safeCode: "provider_no_valid_subscription",
        retryable: false,
      },
    ],
    [
      new Response("{", { status: 200 }),
      {
        outcome: "ambiguous",
        status: "sending",
        safeCode: "provider_outcome_unknown",
        retryable: false,
      },
    ],
    [
      new Response(JSON.stringify({ id: "not-a-uuid" }), { status: 200 }),
      {
        outcome: "ambiguous",
        status: "sending",
        safeCode: "provider_outcome_unknown",
        retryable: false,
      },
    ],
    [
      new Response("", { status: 429, headers: { "retry-after": "17" } }),
      {
        outcome: "definitive_unsent_retryable",
        status: "failed",
        safeCode: "provider_rate_limited",
        retryable: true,
      },
    ],
    [
      new Response("", { status: 400 }),
      {
        outcome: "definitive_unsent_terminal",
        status: "failed",
        safeCode: "provider_request_invalid",
        retryable: false,
      },
    ],
    [
      new Response("", { status: 401 }),
      {
        outcome: "definitive_unsent_terminal",
        status: "failed",
        safeCode: "provider_config_rejected",
        retryable: false,
      },
    ],
    [
      new Response("", { status: 403 }),
      {
        outcome: "definitive_unsent_terminal",
        status: "failed",
        safeCode: "provider_config_rejected",
        retryable: false,
      },
    ],
    [
      new Response("", { status: 418 }),
      {
        outcome: "definitive_unsent_terminal",
        status: "failed",
        safeCode: "provider_request_rejected",
        retryable: false,
      },
    ],
    [
      new Response("", { status: 408 }),
      {
        outcome: "ambiguous",
        status: "sending",
        safeCode: "provider_outcome_unknown",
        retryable: false,
      },
    ],
    [
      new Response("", { status: 500 }),
      {
        outcome: "ambiguous",
        status: "sending",
        safeCode: "provider_outcome_unknown",
        retryable: false,
      },
    ],
  ];

  try {
    for (const [response, expected] of cases) {
      globalThis.fetch = () => Promise.resolve(response.clone());
      const result = await pushAdapter.send(input());
      assertEquals(result.outcome, expected.outcome);
      assertEquals(result.status, expected.status);
      assertEquals(result.safeCode, expected.safeCode);
      assertEquals(result.retryable, expected.retryable);
      assertEquals(result.providerAppId, null);
      assertEquals(result.providerMessageId, null);
    }

    globalThis.fetch = () => Promise.reject(new Error("network down"));
    const network = await pushAdapter.send(input());
    assertEquals(network.outcome, "ambiguous");
    assertEquals(network.status, "sending");
    assertEquals(network.safeCode, "provider_outcome_unknown");
    assertEquals(network.retryable, false);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("#1817 missing provider authority remains definitively unsent", async () => {
  Deno.env.delete("ONESIGNAL_APP_ID");
  Deno.env.delete("ONESIGNAL_REST_API_KEY");
  const result = await pushAdapter.send(input());
  assertEquals(result.outcome, "definitive_unsent_retryable");
  assertEquals(result.status, "failed");
  assertEquals(result.safeCode, "provider_config_missing");
  assertEquals(result.retryable, true);
});
