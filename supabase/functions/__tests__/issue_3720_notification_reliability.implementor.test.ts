import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  communityMarkdownToPlainText,
  renderCategoryMessage,
} from "../_shared/notifyTemplates.ts";
import {
  dispatchV2,
  issue3720DenialReason,
  type MinimalClient,
  providerSafePayload,
} from "../_shared/notifyV2.ts";
import {
  dispatchEnvelopeIsTerminal,
  resolveIssue3720Contact,
} from "../notify-outbox-drain/index.ts";
import { resolveOneSignalApp } from "../_shared/push-utils.ts";

Deno.test("#3720 all Community/support categories target only the Host app", () => {
  for (
    const category of [
      "business.community_announcement",
      "business.community_roadmap_updated",
      "business.support_new_ticket",
    ]
  ) {
    assertEquals(resolveOneSignalApp(category), "business");
  }
});

Deno.test("#3720 Community templates remove authoring syntax and keep approved copy", () => {
  const announcement = renderCategoryMessage(
    "business.community_announcement",
    {
      title: "**A clearer update**",
      body_md:
        "### Hello\nUse `Mingla Host` and read the [guide](https://usemingla.com).",
    },
  );
  assertEquals(announcement.push.title, "A clearer update");
  assertEquals(
    announcement.push.body,
    "Hello Use Mingla Host and read the guide.",
  );
  assertEquals(
    communityMarkdownToPlainText("### **Bold** and `code`"),
    "Bold and code",
  );

  const roadmap = renderCategoryMessage(
    "business.community_roadmap_updated",
    {},
  );
  assertEquals(roadmap.push.title, "Mingla roadmap updated");
  assertEquals(roadmap.push.body, "See what’s new in Now, Next and Later.");

  const support = renderCategoryMessage("business.support_new_ticket", {
    subject: "Private guest details",
  });
  assertEquals(support.push.title, "New support request");
  assertEquals(support.push.body, "A new support ticket needs attention.");
  assert(!support.push.body.includes("Private guest details"));
  assertStringIncludes(support.email.body, "Subject: Private guest details");
});

Deno.test("#3720 drain accepts only truthful terminal delivery envelopes", () => {
  assertEquals(
    dispatchEnvelopeIsTerminal({
      success: true,
      deliveries: [
        { channel: "inapp", status: "delivered" },
        { channel: "push", status: "sent" },
        { channel: "email", status: "suppressed" },
      ],
    }),
    true,
  );
  assertEquals(
    dispatchEnvelopeIsTerminal({
      success: true,
      deliveries: [{ channel: "push", status: "failed" }],
    }),
    false,
  );
  assertEquals(
    dispatchEnvelopeIsTerminal({ success: true, deliveries: [] }),
    false,
  );
});

Deno.test("#3720 provider push data excludes support and announcement free text", () => {
  assertEquals(
    providerSafePayload("business.support_new_ticket", {
      ticket_id: "ticket-1",
      subject: "Private booking problem",
      requester_email: "private@example.com",
    }),
    { ticket_id: "ticket-1" },
  );
  assertEquals(
    providerSafePayload("business.community_announcement", {
      campaign_id: "campaign-1",
      announcement_id: "announcement-1",
      body_md: "full announcement body",
    }),
    { campaign_id: "campaign-1", announcement_id: "announcement-1" },
  );
});

Deno.test("#3720 drain resolves operational email without persisting it in outbox", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, ...args });
      return Promise.resolve({ data: "HOST@EXAMPLE.COM", error: null });
    },
  };
  const contact = await resolveIssue3720Contact(admin, {
    category_key: "business.support_new_ticket",
    user_id: "user-1",
    contact: null,
  });
  assertEquals(contact, "host@example.com");
  assertEquals(calls, [{
    name: "issue_3720_notification_email",
    p_user_id: "user-1",
  }]);
});

Deno.test("#3720 policy denials retain a bounded, truthful reason", async () => {
  const client = {
    rpc: (name: string) => {
      assertEquals(name, "issue_3720_notification_denial_reason");
      return Promise.resolve({ data: "hard_bounce", error: null });
    },
  } as unknown as MinimalClient;
  assertEquals(
    await issue3720DenialReason(
      client,
      {
        user_id: "37200000-0000-4000-8000-000000000003",
        category_key: "business.support_new_ticket",
      },
      "email",
      "host@example.com",
    ),
    "hard_bounce",
  );
});

Deno.test("#3720 missing trusted email is terminal and explicit", async () => {
  const completed: Array<Record<string, unknown>> = [];
  const client = {
    // deno-lint-ignore no-explicit-any
    from(table: string): any {
      if (table === "notification_categories") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    key: "business.community_announcement",
                    is_transactional: true,
                    urgency: "normal",
                    default_channels: ["inapp", "email"],
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
                Promise.resolve({
                  data: { id: "37200000-0000-4000-8000-000000000010" },
                  error: null,
                }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc(name: string, args: Record<string, unknown>) {
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
        completed.push(args);
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "can_send") {
        return Promise.resolve({ data: true, error: null });
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  } as unknown as MinimalClient;

  const result = await dispatchV2(client, {
    user_id: "37200000-0000-4000-8000-000000000003",
    category_key: "business.community_announcement",
    payload: {
      announcement_id: "37200000-0000-4000-8000-000000000011",
      title: "Update",
      body_md: "Body",
    },
    idempotency_key: "announcement:no-email",
    deep_link:
      "mingla-business://community/announcement/37200000-0000-4000-8000-000000000011",
  });
  assertEquals(result.success, true);
  assertEquals(
    result.deliveries?.find((item) => item.channel === "email")?.status,
    "skipped",
  );
  assertEquals(
    completed.find((item) => item.p_status === "skipped")?.p_failed_reason,
    "no_confirmed_email",
  );
});

Deno.test("#3720 roadmap dispatch pairs bell + business push with one destination", async () => {
  const notificationId = "37200000-0000-4000-8000-000000000001";
  const completed: Array<Record<string, unknown>> = [];
  const inserted: { value: Record<string, unknown> | null } = { value: null };
  const providerBody: { value: Record<string, unknown> | null } = {
    value: null,
  };

  const client = {
    // deno-lint-ignore no-explicit-any
    from(table: string): any {
      if (table === "notification_categories") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    key: "business.community_roadmap_updated",
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
          insert: (row: Record<string, unknown>) => {
            inserted.value = row;
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: { id: notificationId },
                    error: null,
                  }),
              }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc(name: string, args: Record<string, unknown>) {
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
        completed.push(args);
        return Promise.resolve({ data: true, error: null });
      }
      if (name === "can_send") {
        return Promise.resolve({ data: true, error: null });
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  } as unknown as MinimalClient;

  const oldFetch = globalThis.fetch;
  const oldAppId = Deno.env.get("ONESIGNAL_BUSINESS_APP_ID");
  const oldKey = Deno.env.get("ONESIGNAL_BUSINESS_REST_API_KEY");
  Deno.env.set(
    "ONESIGNAL_BUSINESS_APP_ID",
    "37200000-0000-4000-8000-000000000002",
  );
  Deno.env.set("ONESIGNAL_BUSINESS_REST_API_KEY", "test-key");
  globalThis.fetch = (async (_input, init) => {
    providerBody.value = JSON.parse(String(init?.body)) as Record<
      string,
      unknown
    >;
    return new Response(JSON.stringify({ id: "onesignal-message-1" }), {
      status: 200,
    });
  }) as typeof fetch;

  try {
    const result = await dispatchV2(client, {
      user_id: "37200000-0000-4000-8000-000000000003",
      category_key: "business.community_roadmap_updated",
      payload: { campaign_id: "campaign-1" },
      idempotency_key: "roadmap:campaign-1:user-1",
      deep_link: "mingla-business://community/roadmap",
    });
    assertEquals(result.success, true);
    assertEquals(
      result.deliveries?.map((item) => [item.channel, item.status]).sort(),
      [["inapp", "delivered"], ["push", "sent"]],
    );
    assertEquals(
      inserted.value?.deep_link,
      "mingla-business://community/roadmap",
    );
    assertEquals(
      (inserted.value?.data as Record<string, unknown>).deepLink,
      "mingla-business://community/roadmap",
    );
    assertEquals(providerBody.value?.idempotency_key, notificationId);
    assertEquals(
      (providerBody.value?.data as Record<string, unknown>).deepLink,
      "mingla-business://community/roadmap",
    );
    assertEquals(completed.length, 2);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldAppId === undefined) Deno.env.delete("ONESIGNAL_BUSINESS_APP_ID");
    else Deno.env.set("ONESIGNAL_BUSINESS_APP_ID", oldAppId);
    if (oldKey === undefined) {
      Deno.env.delete("ONESIGNAL_BUSINESS_REST_API_KEY");
    } else Deno.env.set("ONESIGNAL_BUSINESS_REST_API_KEY", oldKey);
  }
});

Deno.test("#3720 rejects a mismatched Community destination before insert", async () => {
  let inserted = false;
  const client = {
    // deno-lint-ignore no-explicit-any
    from(table: string): any {
      if (table === "notification_categories") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    key: "business.community_roadmap_updated",
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
        return { insert: () => (inserted = true) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  } as unknown as MinimalClient;
  const result = await dispatchV2(client, {
    user_id: "37200000-0000-4000-8000-000000000003",
    category_key: "business.community_roadmap_updated",
    payload: {},
    idempotency_key: "bad-destination",
    deep_link: "mingla-business://payments",
  });
  assertEquals(result, { success: false, reason: "deep_link_invalid" });
  assertEquals(inserted, false);
});
