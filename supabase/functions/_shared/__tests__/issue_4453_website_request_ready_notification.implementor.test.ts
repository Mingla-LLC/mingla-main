// #4453 — "Ready for review" on a website change request: one new Host
// notification kind, registered through the #4382 support notification module.
// MINGLA-INVARIANT: I-4453-WEBSITE-READY-LINK-OWN-BRAND | issue #4453 | A business.website_request_ready notification is delivered only when its link is mingla-business://brand/<brand_id>/website?request=<ticket_id> for the payload's own brand and ticket ids; the push provider receives ids only.
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_4453_website_request_ready_notification.implementor.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isIssue4382SupportCategory,
  issue4382DeepLinkValid,
  issue4382EmailCta,
  ISSUE_4382_EMAIL_CATEGORIES,
  renderIssue4382Message,
} from "../issue4382SupportNotifications.ts";
import { providerSafePayload } from "../notifyV2.ts";
import { renderCategoryMessage } from "../notifyTemplates.ts";
import { resolveOneSignalApp } from "../push-utils.ts";

const KIND = "business.website_request_ready";
const TICKET = "44530000-0000-4000-8000-000000000101";
const BRAND = "44530000-0000-4000-8000-0000000000e1";
const LINK = `mingla-business://brand/${BRAND}/website?request=${TICKET}`;
const read = (relative: string) =>
  Deno.readTextFile(new URL(relative, import.meta.url));

Deno.test("the kind is a Host support category that also sends an email", () => {
  assert(isIssue4382SupportCategory(KIND));
  assertEquals(resolveOneSignalApp(KIND), "business");
  assertEquals([...ISSUE_4382_EMAIL_CATEGORIES], [KIND]);
});

Deno.test("the link opens this brand's website on this request, and nothing else", () => {
  const payload = { ticket_id: TICKET, brand_id: BRAND };
  assert(issue4382DeepLinkValid(KIND, LINK, payload));
  // The ordinary support link is not this kind's link.
  assert(!issue4382DeepLinkValid(KIND, `mingla-business://support/${TICKET}`, payload));
  // Another brand, another ticket, a missing id, extra text.
  const otherBrand = "44530000-0000-4000-8000-0000000000e2";
  assert(!issue4382DeepLinkValid(KIND, `mingla-business://brand/${otherBrand}/website?request=${TICKET}`, payload));
  assert(!issue4382DeepLinkValid(KIND, `mingla-business://brand/${BRAND}/website?request=${BRAND}`, payload));
  assert(!issue4382DeepLinkValid(KIND, LINK, { ticket_id: TICKET }));
  assert(!issue4382DeepLinkValid(KIND, LINK, { brand_id: BRAND }));
  assert(!issue4382DeepLinkValid(KIND, `${LINK}&next=https://evil.example`, payload));
  assert(!issue4382DeepLinkValid(KIND, `https://evil.example/brand/${BRAND}/website?request=${TICKET}`, payload));
  assert(!issue4382DeepLinkValid(KIND, null, payload));
  // The other support kinds keep their own link.
  assert(issue4382DeepLinkValid("business.support_status_changed", `mingla-business://support/${TICKET}`, payload));
  assert(!issue4382DeepLinkValid("business.support_status_changed", LINK, payload));
});

Deno.test("the push provider sees ids only", () => {
  const safe = providerSafePayload(KIND, {
    ticket_id: TICKET,
    brand_id: BRAND,
    ticket_number: 1042,
    subject: "Website change: add a video",
    what: "Add a video background",
    note: "It is a little dark",
    section_label: "Top of the page",
    deep_link: LINK,
  });
  assertEquals(safe, { ticket_id: TICKET });
});

Deno.test("copy says what is ready, where, and carries the team's note", () => {
  const message = renderCategoryMessage(KIND, {
    ticket_number: 1042,
    subject: "Website change: add a video",
    what: "Add a video background",
    section_label: "Top of the page",
    note: "It is a little dark.",
  });
  assertEquals(message.push.title, "Your website change is ready");
  assertStringIncludes(message.push.body, "Add a video background");
  assertStringIncludes(message.email.subject, "S-1042");
  assertStringIncludes(message.email.body, 'in "Top of the page"');
  assertStringIncludes(message.email.body, "Note from the team: It is a little dark.");
  // Without the optional parts it still reads as a sentence.
  const bare = renderIssue4382Message(KIND, { subject: "Website change: warmer colours" });
  assertEquals(
    bare.email.body,
    "The Mingla team finished the change you asked for: Website change: warmer colours",
  );
  assert(!bare.email.body.includes("undefined") && !bare.push.body.includes("undefined"));
  for (const text of [message.push.title, message.push.body, message.email.subject, message.email.body, message.sms]) {
    assert(!/\b(block|variant|token|revision)\b/i.test(text), text);
  }
});

Deno.test("the email button opens Host on the web for the same brand and request", () => {
  const cta = issue4382EmailCta(KIND, { ticket_id: TICKET, brand_id: BRAND });
  assertEquals(cta?.label, "Review the change");
  assertEquals(cta?.url, `https://host.usemingla.com/brand/${BRAND}/website?request=${TICKET}`);
  assertEquals(issue4382EmailCta(KIND, { ticket_id: TICKET, brand_id: "x/../y" }), undefined);
  assertEquals(issue4382EmailCta(KIND, { brand_id: BRAND }), undefined);
  assertEquals(issue4382EmailCta("business.support_status_changed", { ticket_id: TICKET, brand_id: BRAND }), undefined);
});

Deno.test("wired into the dispatcher, the drain, the legacy map and the database", async () => {
  const v2 = await read("../notifyV2.ts");
  const drain = await read("../../notify-outbox-drain/index.ts");
  const dispatch = await read("../../notify-dispatch/index.ts");
  const migration = await read(
    "../../../migrations/20281119004453_issue_4453_website_team_requests.sql",
  );
  assertStringIncludes(v2, "issue4382EmailCta(input.category_key, input.payload) ??");
  assertStringIncludes(v2, "ISSUE_4382_EMAIL_CATEGORIES.includes(input.category_key)");
  // The drain looks up the member's email for this kind.
  assertStringIncludes(drain, "...ISSUE_4382_EMAIL_CATEGORIES,");
  assertStringIncludes(dispatch, `"${KIND}": "messages",`);
  // The database queues exactly this kind with exactly this link shape.
  assertStringIncludes(migration, `('${KIND}', 'support', true, 'normal',`);
  assertStringIncludes(migration, "ARRAY['inapp', 'push', 'email']::text[]");
  assertStringIncludes(migration, "v_link := 'mingla-business://brand/' || v_request.brand_id::text");
  assertStringIncludes(migration, "|| '/website?request=' || v_ticket.id::text;");
});
