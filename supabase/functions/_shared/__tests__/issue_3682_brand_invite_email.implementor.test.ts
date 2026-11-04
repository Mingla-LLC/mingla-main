/**
 * #3682 wave 3 (#1781) — a received invite email says why it came, right under
 * the invite, opens the offering with a button, and says truthfully how to
 * stop these. The reason never names a person (#876).
 * FAILS-ON-REVERT: dropping brandReachEmailCta from notifyV2, or moving the
 * reason back under the link, fails these.
 *
 *   deno test --allow-read supabase/functions/_shared/__tests__/issue_3682_brand_invite_email.implementor.test.ts
 */
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  brandReachEmailCta,
  renderBrandReachMessage,
} from "../brandReachMessages.ts";

const base = {
  brand_name: "Harmattan Club",
  event_title: "Rooftop Night",
  event_url: "https://host.usemingla.com/e/harmattanclub/rooftop-night",
};

Deno.test("#3682 invite email: reason directly under the invite, button opens it", () => {
  const friend = renderBrandReachMessage("brand_offering_invite", { ...base, reason: "extended" });
  assertEquals(friend.email.subject, "Harmattan Club invited you to Rooftop Night");
  assertEquals(
    friend.email.body,
    "You're invited to Rooftop Night.\n\nA friend of yours follows Harmattan Club.",
  );
  const cta = brandReachEmailCta("brand_offering_invite", { ...base, reason: "extended" });
  assertEquals(cta, {
    label: "See the invite",
    url: base.event_url,
    note: "You can switch off invites through friends in Mingla settings, under Privacy.",
  });
  const follower = brandReachEmailCta("brand_offering_invite", { ...base, reason: "follower" });
  assertEquals(
    follower?.note,
    "You can mute Harmattan Club or switch off its emails from its page in Mingla.",
  );
});

Deno.test("#3682 invite email without a safe link still says how to stop these", () => {
  const unsafe = { ...base, event_url: "javascript:alert(1)", reason: "book" };
  assertEquals(brandReachEmailCta("brand_offering_invite", unsafe), undefined);
  const rendered = renderBrandReachMessage("brand_offering_invite", unsafe);
  assertEquals(
    rendered.email.body,
    "You're invited to Rooftop Night.\n\nYou're on Harmattan Club's guest list.\n\n" +
      "You can mute Harmattan Club or switch off its emails from its page in Mingla.",
  );
  assert(!rendered.email.body.includes("javascript:"));
  assertEquals(brandReachEmailCta("brand_campaign_push", { ...base, reason: "follower" }), undefined);
});

Deno.test("#3682 notifyV2 attaches the invite button to the email channel", async () => {
  const src = await Deno.readTextFile(new URL("../notifyV2.ts", import.meta.url));
  assert(
    /issue4111EmailCta\(input\.category_key, input\.payload\) \?\?\s*brandReachEmailCta\(input\.category_key, input\.payload\);/
      .test(src),
    "the invite email must carry its button and manage note",
  );
});
