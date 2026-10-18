// #3720 Completion Wave 6 — team mentions remain private and durable through
// the existing notification dispatcher rather than a parallel send path.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  issue3720DenialReason,
  type MinimalClient,
  providerSafePayload,
} from "../notifyV2.ts";
import { resolveIssue3720Contact } from "../../notify-outbox-drain/index.ts";

Deno.test("#3720 team mention provider payload excludes comment and teammate PII", () => {
  assertEquals(
    providerSafePayload("admin.team_mention", {
      mention_id: "mention-1",
      source_kind: "content_calendar_comment",
      source_id: "comment-1",
      title: "Alex mentioned you",
      body: "Private roadmap comment",
      deep_link: "https://admin.usemingla.com/private",
      actor_email: "alex@example.test",
    }),
    {
      mention_id: "mention-1",
      source_kind: "content_calendar_comment",
      source_id: "comment-1",
    },
  );
});

Deno.test("#3720 team mention email resolves at dispatch time and is never copied into outbox", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const contact = await resolveIssue3720Contact({
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, ...args });
      return Promise.resolve({ data: "TEAM@EXAMPLE.TEST", error: null });
    },
  }, {
    category_key: "admin.team_mention",
    user_id: "37200000-0000-4000-8000-000000000601",
    contact: null,
  });
  assertEquals(contact, "team@example.test");
  assertEquals(calls, [{
    name: "issue_3720_notification_email",
    p_user_id: "37200000-0000-4000-8000-000000000601",
  }]);
});

Deno.test("#3720 team mention opt-out keeps its bounded policy reason", async () => {
  const client = {
    rpc: (name: string) => {
      assertEquals(name, "issue_3720_notification_denial_reason");
      return Promise.resolve({ data: "preference_off", error: null });
    },
  } as unknown as MinimalClient;
  assertEquals(
    await issue3720DenialReason(
      client,
      {
        user_id: "37200000-0000-4000-8000-000000000601",
        category_key: "admin.team_mention",
      },
      "email",
      "team@example.test",
    ),
    "preference_off",
  );
});
