import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderCategoryMessage } from "../notifyTemplates.ts";

Deno.test("#3720 Brand group push renders the actual sender and Brand", () => {
  const rendered = renderCategoryMessage("business.brand_group_message", {
    sender_name: "Simone",
    brand_name: "Acme Social",
    body: "The date is confirmed.",
  });
  assertEquals(rendered.push.title, "Simone in Acme Social");
  assertEquals(rendered.push.body, "The date is confirmed.");
  assertEquals(rendered.email.subject, "Simone in Acme Social");
});

Deno.test("#3988 direct Brand group mention is explicit in the notification", () => {
  const rendered = renderCategoryMessage("business.brand_group_message", {
    sender_name: "Simone",
    brand_name: "Acme Social",
    body: "Can you confirm this?",
    mentioned: true,
  });
  assertEquals(rendered.push.title, "Simone mentioned you in Acme Social");
  assertEquals(rendered.email.subject, "Simone mentioned you in Acme Social");
});

Deno.test("#3720 Brand-group notification destination is validated and routed", () => {
  const notifyV2 = Deno.readTextFileSync(
    new URL("../notifyV2.ts", import.meta.url),
  );
  const drain = Deno.readTextFileSync(
    new URL("../../notify-outbox-drain/index.ts", import.meta.url),
  );
  assertStringIncludes(notifyV2, 'category === "business.brand_group_message"');
  assertStringIncludes(
    notifyV2,
    'deepLink?.replace("mingla-business://messages/", "")',
  );
  assertStringIncludes(notifyV2, "UUID.test(id)");
  assertStringIncludes(drain, '"business.brand_group_message"');
});
