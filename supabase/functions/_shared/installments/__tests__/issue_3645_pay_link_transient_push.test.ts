import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { defaultSendBuyerPush } from "../installmentPayLinks.ts";
import { sendPush } from "../../push-utils.ts";

const PAY_URL =
  "https://host.usemingla.com/pay/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789";

Deno.test("#3645 buyer pay-link push is transient and launches the exact URL", async () => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role");

  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return Promise.resolve(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
      }),
    );
  }) as typeof fetch;

  try {
    const sent = await defaultSendBuyerPush({
      userId: "buyer-1",
      brandId: "brand-1",
      type: "installment_pay_link",
      title: "Your next payment is due",
      body: "Tap to pay securely.",
      data: { installmentId: "installment-1", url: PAY_URL },
      relatedId: "installment-1",
      idempotencyKey: "installment_pay_link:installment-1:link-1",
      deepLink: PAY_URL,
    });

    assertEquals(sent, true);
    assertEquals(requests.length, 1);
    assertEquals(
      requests[0].url,
      "https://example.supabase.co/functions/v1/notify-dispatch",
    );
    assertEquals(requests[0].body.transientPayLinkPush, true);
    assertEquals(requests[0].body.deepLink, PAY_URL);
    assertEquals(
      typeof requests[0].body.oneSignalIdempotencyKey === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
          .test(
            requests[0].body.oneSignalIdempotencyKey,
          ),
      true,
    );
    assertStringIncludes(JSON.stringify(requests[0].body), PAY_URL);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("SUPABASE_URL");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});

Deno.test("#3645 notify-dispatch sends pay links without durable storage", async () => {
  const senderSource = await Deno.readTextFile(
    new URL("../installmentPayLinks.ts", import.meta.url),
  );
  const sender = senderSource.slice(
    senderSource.indexOf("export const defaultSendBuyerPush"),
    senderSource.indexOf("export function defaultNotifyHost"),
  );
  assertStringIncludes(sender, "/functions/v1/notify-dispatch");
  assertStringIncludes(sender, "transientPayLinkPush: true");

  const dispatchSource = await Deno.readTextFile(
    new URL("../../../notify-dispatch/index.ts", import.meta.url),
  );
  const branch = dispatchSource.slice(
    dispatchSource.indexOf("if (transientPayLinkPush === true)"),
    dispatchSource.indexOf(
      "const emailPayload",
      dispatchSource.indexOf("if (transientPayLinkPush === true)"),
    ),
  );
  assertStringIncludes(branch, "isExactServiceBearer");
  assertStringIncludes(branch, "launchUrl: deepLink");
  assertStringIncludes(branch, "sendPush({");
  assertEquals(branch.includes('.from("notifications")'), false);
  assertEquals(branch.includes("quiet_hours"), false);
});

Deno.test("#3645 transient provider push carries the launch URL and stable idempotency key", async () => {
  Deno.env.set("ONESIGNAL_APP_ID", "11111111-1111-1111-1111-111111111111");
  Deno.env.set("ONESIGNAL_REST_API_KEY", "test-rest-key");
  const requests: Record<string, unknown>[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    requests.push(
      JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    );
    return Promise.resolve(
      new Response(JSON.stringify({ id: "notification-accepted" }), {
        status: 200,
      }),
    );
  }) as typeof fetch;

  try {
    const idempotencyKey = "123e4567-e89b-52d3-a456-426614174000";
    const sent = await sendPush({
      targetUserId: "buyer-1",
      title: "Your next payment is due",
      body: "Tap to pay securely.",
      data: { url: PAY_URL, deepLink: PAY_URL },
      launchUrl: PAY_URL,
      oneSignalIdempotencyKey: idempotencyKey,
    });
    assertEquals(sent, true);
    assertEquals(requests.length, 1);
    assertEquals(requests[0].url, PAY_URL);
    assertEquals(requests[0].idempotency_key, idempotencyKey);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("ONESIGNAL_APP_ID");
    Deno.env.delete("ONESIGNAL_REST_API_KEY");
  }
});
