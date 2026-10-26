// #4111 Wave A — enquiry notification categories reach the dispatcher's
// allow-lists: deep links, provider-safe payloads and copy.
// FAILS-ON-REVERT: dropping the #4111 branches from notifyV2 /
// notifyTemplates leaves the deep link invalid and the guest name in the
// push provider payload.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { providerSafePayload } from "../notifyV2.ts";
import { renderCategoryMessage } from "../notifyTemplates.ts";
import {
  issue4111DeepLinkValid,
  issue4111EmailCta,
} from "../issue4111EnquiryNotifications.ts";

const CONV = "4c2d7a3e-1b2c-4d3e-8f40-5a6b7c8d9e0f";
const ENQ = "5d3e8b4f-2c3d-4e4f-9a51-6b7c8d9e0f1a";

const teamPayload = {
  enquiry_id: ENQ,
  conversation_id: CONV,
  message_id: "6e4f9c5a-3d4e-4f5a-8b62-7c8d9e0f1a2b",
  brand_id: "7f5a0d6b-4e5f-4a6b-9c73-8d9e0f1a2b3c",
  brand_name: "Lantern Room",
  guest_name: "Gabi",
  topic_label: "Refund or cancel",
  body: "Can I get a refund?",
  deep_link: `mingla-business://messages/${CONV}`,
};

Deno.test("#4111 deep links must name the payload's own thread", () => {
  assert(issue4111DeepLinkValid("business.brand_enquiry_new", `mingla-business://messages/${CONV}`, teamPayload));
  assert(!issue4111DeepLinkValid("business.brand_enquiry_new", `mingla-business://messages/${ENQ}`, teamPayload));
  assert(!issue4111DeepLinkValid("business.brand_enquiry_new", "https://evil.example", teamPayload));
  const explorer = { ...teamPayload, deep_link: `mingla://chat/${CONV}?type=brand_enquiry&enquiryId=${ENQ}` };
  assert(issue4111DeepLinkValid("explorer.brand_enquiry_reply", explorer.deep_link, explorer));
  assert(!issue4111DeepLinkValid("explorer.brand_enquiry_reply", `mingla://chat/${CONV}`, explorer));
});

Deno.test("#4111 the push provider only ever sees opaque ids", () => {
  for (const category of [
    "business.brand_enquiry_new",
    "business.brand_enquiry_message",
    "business.brand_enquiry_nudge",
    "explorer.brand_enquiry_reply",
  ]) {
    const safe = providerSafePayload(category, teamPayload);
    assertEquals(Object.keys(safe).sort(), ["brand_id", "conversation_id", "enquiry_id", "message_id"]);
  }
});

Deno.test("#4111 copy renders for every category", () => {
  assertEquals(renderCategoryMessage("business.brand_enquiry_new", teamPayload).push, {
    title: "New enquiry for Lantern Room",
    body: "Gabi · Refund or cancel: Can I get a refund?",
  });
  assertEquals(
    renderCategoryMessage("business.brand_enquiry_nudge", teamPayload).email.subject,
    "Gabi is waiting for a reply from Lantern Room",
  );
  assertEquals(
    renderCategoryMessage("explorer.brand_enquiry_reply", { ...teamPayload, sender_name: "Mina at Lantern Room", body: "Yes!" }).push,
    { title: "Mina at Lantern Room", body: "Yes!" },
  );
  assertEquals(issue4111EmailCta("business.brand_enquiry_nudge", teamPayload)?.url, `https://host.usemingla.com/messages/${CONV}`);
  assertEquals(issue4111EmailCta("business.brand_enquiry_new", teamPayload), undefined);
});

Deno.test("#4111 the subscribe confirm text renders with the link the dispatcher was handed", () => {
  const rendered = renderCategoryMessage("web.brand_subscribe_confirm", {
    brand_name: "Lantern Room",
    confirm_url: "https://example.test/functions/v1/public-brand-subscribe-confirm/TOKEN",
  });
  assertEquals(
    rendered.sms,
    "Confirm texts from Lantern Room via Mingla: https://example.test/functions/v1/public-brand-subscribe-confirm/TOKEN",
  );
});
