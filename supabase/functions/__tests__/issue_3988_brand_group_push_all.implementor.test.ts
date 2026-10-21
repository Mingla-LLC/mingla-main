// #3988 — Brand-group push delivery stacks every message under one thread key
// without collapse/replacement. Other categories remain byte-for-byte ungrouped.

import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dispatchV2, type MinimalClient } from "../_shared/notifyV2.ts";

type Json = Record<string, unknown>;

function client(category: string, notificationId: string): MinimalClient {
  return {
    // deno-lint-ignore no-explicit-any
    from(table: string): any {
      if (table === "notification_categories") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    key: category,
                    is_transactional: true,
                    urgency: "normal",
                    default_channels: ["inapp", "push"],
                    active: true,
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "notifications") {
        return {
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: notificationId }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc(name: string) {
      if (name === "issue_3720_claim_notification_channel") {
        return Promise.resolve({
          data: {
            outcome: "claimed",
            deliveryId: crypto.randomUUID(),
            status: "queued",
            providerMessageId: null,
          },
          error: null,
        });
      }
      if (name === "issue_3720_complete_notification_channel") {
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "can_send") {
        return Promise.resolve({ data: true, error: null });
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  } as unknown as MinimalClient;
}

Deno.test("#3988 Brand-group push gets a thread key and never a collapse key", async () => {
  const conversation = "39880000-0000-4000-bc00-000000000001";
  const user = "39880000-0000-4000-bc00-000000000002";
  const originalFetch = globalThis.fetch;
  const previousAppId = Deno.env.get("ONESIGNAL_BUSINESS_APP_ID");
  const previousKey = Deno.env.get("ONESIGNAL_BUSINESS_REST_API_KEY");
  const pushes: Json[] = [];
  Deno.env.set(
    "ONESIGNAL_BUSINESS_APP_ID",
    "39880000-0000-4000-bc00-000000000003",
  );
  Deno.env.set("ONESIGNAL_BUSINESS_REST_API_KEY", "issue-3988-test-key");
  globalThis.fetch = ((_input, init) => {
    pushes.push(JSON.parse(String(init?.body ?? "{}")) as Json);
    return Promise.resolve(
      new Response(JSON.stringify({ id: `push-${pushes.length}` }), {
        status: 200,
      }),
    );
  }) as typeof fetch;

  try {
    const brandResult = await dispatchV2(
      client(
        "business.brand_group_message",
        "39880000-0000-4000-bc00-000000000004",
      ),
      {
        user_id: user,
        category_key: "business.brand_group_message",
        payload: {
          conversation_id: conversation,
          message_id: "39880000-0000-4000-bc00-000000000005",
          brand_id: "39880000-0000-4000-bc00-000000000006",
          brand_name: "Threaded Brand",
          sender_name: "Amina",
          body: "First visible message",
        },
        idempotency_key: `business.brand_group_message:message-1:${user}`,
        deep_link: `mingla-business://messages/${conversation}`,
      },
    );
    assertEquals(brandResult.success, true);
    assertEquals(pushes[0]?.thread_id, `brand_group:${conversation}`);
    assertEquals(pushes[0]?.android_group, `brand_group:${conversation}`);
    assertFalse("collapse_id" in pushes[0]);

    const otherResult = await dispatchV2(
      client(
        "business.community_roadmap_updated",
        "39880000-0000-4000-bc00-000000000007",
      ),
      {
        user_id: user,
        category_key: "business.community_roadmap_updated",
        payload: { campaign_id: "campaign-3988" },
        idempotency_key:
          `business.community_roadmap_updated:campaign-3988:${user}`,
        deep_link: "mingla-business://community/roadmap",
      },
    );
    assertEquals(otherResult.success, true);
    assertFalse("thread_id" in pushes[1]);
    assertFalse("android_group" in pushes[1]);
    assertFalse("collapse_id" in pushes[1]);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousAppId === undefined) {
      Deno.env.delete("ONESIGNAL_BUSINESS_APP_ID");
    } else Deno.env.set("ONESIGNAL_BUSINESS_APP_ID", previousAppId);
    if (previousKey === undefined) {
      Deno.env.delete("ONESIGNAL_BUSINESS_REST_API_KEY");
    } else {
      Deno.env.set("ONESIGNAL_BUSINESS_REST_API_KEY", previousKey);
    }
  }
});
