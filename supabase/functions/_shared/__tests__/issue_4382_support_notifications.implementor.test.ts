// #4382 — customer-facing support notifications: one module, registered in
// the dispatcher, the outbox drain and the templates; links open the ticket
// in the right app; nothing but ids reaches the push provider.
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_4382_support_notifications.implementor.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isIssue4382SupportCategory,
  issue4382DeepLinkValid,
  issue4382ProviderSafeKeys,
  ISSUE_4382_SUPPORT_CATEGORIES,
  renderIssue4382Message,
} from "../issue4382SupportNotifications.ts";
import { providerSafePayload } from "../notifyV2.ts";
import { renderCategoryMessage } from "../notifyTemplates.ts";
import { resolveOneSignalApp } from "../push-utils.ts";

const TICKET = "43820000-0000-4000-8000-000000000101";
const read = (relative: string) =>
  Deno.readTextFile(new URL(relative, import.meta.url));

Deno.test("five categories, each routed to the app it names", () => {
  assertEquals([...ISSUE_4382_SUPPORT_CATEGORIES].sort(), [
    "business.support_product_update",
    "business.support_status_changed",
    "explorer.support_product_update",
    "explorer.support_reply",
    "explorer.support_status_changed",
  ]);
  assertEquals(
    resolveOneSignalApp("business.support_status_changed"),
    "business",
  );
  assertEquals(resolveOneSignalApp("explorer.support_reply"), "consumer");
  assert(!isIssue4382SupportCategory("business.support_message"));
});

Deno.test("a link must open this ticket in the app the category belongs to", () => {
  const payload = { ticket_id: TICKET };
  assert(
    issue4382DeepLinkValid(
      "explorer.support_reply",
      `mingla://support/${TICKET}`,
      payload,
    ),
  );
  assert(
    !issue4382DeepLinkValid(
      "explorer.support_reply",
      `mingla-business://support/${TICKET}`,
      payload,
    ),
  );
  assert(
    issue4382DeepLinkValid(
      "business.support_status_changed",
      `mingla-business://support/${TICKET}`,
      payload,
    ),
  );
  assert(
    !issue4382DeepLinkValid(
      "business.support_status_changed",
      "mingla-business://support/other",
      payload,
    ),
  );
  assert(
    !issue4382DeepLinkValid(
      "explorer.support_reply",
      `mingla://support/${TICKET}`,
      {},
    ),
  );
});

Deno.test("the push provider sees ids only, never the subject or message", () => {
  assertEquals(issue4382ProviderSafeKeys(), [
    "ticket_id",
    "message_id",
    "update_kind",
    "status",
  ]);
  const safe = providerSafePayload("explorer.support_reply", {
    ticket_id: TICKET,
    message_id: "m1",
    subject: "My card was charged twice",
    ticket_number: 1042,
    deep_link: `mingla://support/${TICKET}`,
  });
  assertEquals(safe, { ticket_id: TICKET, message_id: "m1" });
});

Deno.test("copy names the request and what happened", () => {
  const reply = renderIssue4382Message("explorer.support_reply", {
    ticket_number: 1042,
    subject: "Map is blank",
  });
  assertEquals(reply.push.title, "Mingla replied");
  assertStringIncludes(reply.push.body, "S-1042");
  const resolved = renderIssue4382Message("business.support_status_changed", {
    ticket_number: 1043,
    subject: "Payout",
    status: "resolved",
    update_kind: "status",
  });
  assertEquals(resolved.push.title, "S-1043 is resolved");
  const live = renderCategoryMessage("explorer.support_product_update", {
    ticket_number: 1044,
    subject: "Map",
  });
  assertEquals(live.push.title, "It's live");
});

Deno.test("registered additively in the dispatcher, the drain, the templates and the legacy map", async () => {
  const v2 = await read("../notifyV2.ts");
  const templates = await read("../notifyTemplates.ts");
  const drain = await read("../../notify-outbox-drain/index.ts");
  const dispatch = await read("../../notify-dispatch/index.ts");
  assertStringIncludes(v2, "...ISSUE_4382_SUPPORT_CATEGORIES,");
  assertStringIncludes(
    v2,
    "return issue4382DeepLinkValid(category, deepLink, payload);",
  );
  assertStringIncludes(v2, "return pick(issue4382ProviderSafeKeys());");
  assertStringIncludes(
    templates,
    "return renderIssue4382Message(categoryKey, payload);",
  );
  assertStringIncludes(drain, "...ISSUE_4382_SUPPORT_CATEGORIES,");
  for (const key of ISSUE_4382_SUPPORT_CATEGORIES) {
    assertStringIncludes(dispatch, `"${key}": "messages",`);
  }
});

Deno.test("staff-ticket alerts open the ticket now that staff threads are tickets", async () => {
  const { issue3988DeepLinkValid, issue3988ProviderSafeKeys } = await import(
    "../issue3988SupportAlerts.ts"
  );
  const link =
    `https://admin.usemingla.com/#/community-support?tab=support&ticket=${TICKET}`;
  assert(issue3988DeepLinkValid("admin.support_staff_ticket", link));
  assert(issue3988DeepLinkValid("admin.support_assigned", link));
  assert(issue3988DeepLinkValid("admin.support_overdue", link));
  assert(
    issue3988ProviderSafeKeys("admin.support_assigned").includes("ticket_id"),
  );
});
