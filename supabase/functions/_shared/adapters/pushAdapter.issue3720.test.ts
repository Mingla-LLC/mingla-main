// MINGLA-INVARIANT: I-3720-PUSH-NO-SUBSCRIPTION-TERMINAL | issue #3720 | A user lacking a valid Host push subscription is a terminal skipped channel; provider, configuration and network failures keep their retryable outcome.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pushAdapter } from "./pushAdapter.ts";

const appId = "11111111-1111-4111-8111-111111111111";
const userId = "33333333-3333-4333-8333-333333333333";
const notificationId = "44444444-4444-4444-8444-444444444444";

function input() {
  return {
    userId,
    title: "A Host update",
    body: "Open Community for the full announcement.",
    routingType: "business.community_announcement",
    idempotencyKey: notificationId,
  };
}

Deno.test("#3720 no active OneSignal subscription is skipped, not failed", async () => {
  Deno.env.set("ONESIGNAL_BUSINESS_APP_ID", appId);
  Deno.env.set("ONESIGNAL_BUSINESS_REST_API_KEY", "rest-secret");
  const original = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({ errors: ["No target subscriptions"] }),
        { status: 200 },
      ),
    );
  try {
    assertEquals(await pushAdapter.send(input()), {
      ok: false,
      status: "skipped",
      providerMessageId: null,
      error: "provider_no_valid_subscription",
    });
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("#3720 provider failures still fail for durable retry", async () => {
  Deno.env.set("ONESIGNAL_BUSINESS_APP_ID", appId);
  Deno.env.set("ONESIGNAL_BUSINESS_REST_API_KEY", "rest-secret");
  const original = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response("", { status: 503 }));
  try {
    assertEquals(await pushAdapter.send(input()), {
      ok: false,
      status: "failed",
      providerMessageId: null,
      error: "provider_outcome_unknown",
    });
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("#3720 accepted Host push remains sent", async () => {
  Deno.env.set("ONESIGNAL_BUSINESS_APP_ID", appId);
  Deno.env.set("ONESIGNAL_BUSINESS_REST_API_KEY", "rest-secret");
  const original = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({ id: "55555555-5555-4555-8555-555555555555" }),
        { status: 200 },
      ),
    );
  try {
    assertEquals(await pushAdapter.send(input()), {
      ok: true,
      status: "sent",
      providerMessageId: "55555555-5555-4555-8555-555555555555",
      error: undefined,
    });
  } finally {
    globalThis.fetch = original;
  }
});
