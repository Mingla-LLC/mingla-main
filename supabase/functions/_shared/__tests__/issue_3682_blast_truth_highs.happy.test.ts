/**
 * #3682 Wave 1 Highs — receive-reason footer, empty event-token strip,
 * undeliverable domains (happy).
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderMarketingEmail } from "../marketingEmailRender.ts";
import {
  receiveReasonFooterSentence,
  receiveReasonFromAudienceKind,
} from "../marketingReceiveReason.ts";
import { isUndeliverableEmailDomain } from "../undeliverableEmail.ts";

const vars = {
  first_name: "Ada",
  event_name: "Night Market",
  event_date: "Fri Oct 10",
  event_date_short: "Fri Oct 10",
  event_time: null,
  doors_open: null,
  ends_at: null,
  brand_name: "Lantern Room",
  event_url: null,
  spots_left: null,
  previous_event_name: null,
  next_event_name: null,
  event_id: null,
};

Deno.test("#3682 footer reason follows for followers audience", () => {
  assertEquals(receiveReasonFromAudienceKind("brand_followers"), "follows");
  const rendered = renderMarketingEmail({
    body_html: "Hi {first_name}",
    variables: vars,
    embedded_events: [],
    unsubscribe_url: "https://usemingla.com/u/tok",
    subject: "Hello",
    brand_name: "Lantern Room",
    receive_reason: "follows",
  });
  // Apostrophe is HTML-escaped in the footer.
  assertStringIncludes(rendered.html, "you follow Lantern Room on Mingla");
  assertEquals(rendered.html.includes("bought tickets"), false);
});

Deno.test("#3682 friends-of-followers get friend_of_follower reason", () => {
  assertEquals(
    receiveReasonFromAudienceKind("brand_circle_extended"),
    "friend_of_follower",
  );
  const sentence = receiveReasonFooterSentence(
    "friend_of_follower",
    "Lantern Room",
  );
  assertStringIncludes(sentence, "a friend follows");
  assertEquals(sentence.includes("you follow"), false);
});

Deno.test("#3682 book audiences default to guest_book not added/follows", () => {
  assertEquals(receiveReasonFromAudienceKind("all_brand_people"), "guest_book");
  assertEquals(receiveReasonFromAudienceKind("manual_group"), "guest_book");
});

Deno.test("#3682 imported reason sentence", () => {
  assertEquals(
    receiveReasonFooterSentence("imported", "Lantern Room"),
    "You're receiving this because Lantern Room imported your contact on Mingla with permission.",
  );
});

Deno.test("#3682 rsvp and booking reasons are truthful", () => {
  assertStringIncludes(
    receiveReasonFooterSentence("rsvp", "Lantern Room"),
    "RSVP'd",
  );
  assertStringIncludes(
    receiveReasonFooterSentence("booking", "Lantern Room"),
    "reservation",
  );
  assertEquals(
    receiveReasonFooterSentence("rsvp", "Lantern Room").includes(
      "bought tickets",
    ),
    false,
  );
});

Deno.test("#3682 empty {{event:}} token is stripped after empty event_id", () => {
  const rendered = renderMarketingEmail({
    body_html: "See you there.{{event:}}\n\n— {brand_name}",
    variables: vars,
    embedded_events: [],
    unsubscribe_url: "https://usemingla.com/u/tok",
    subject: "Almost sold out — see you Fri Oct 10",
    brand_name: "Lantern Room",
    receive_reason: "bought",
  });
  assertEquals(rendered.html.includes("{{event:}}"), false);
});

Deno.test("#3682 example.com is undeliverable", () => {
  assertEquals(isUndeliverableEmailDomain("guest@example.com"), true);
  assertEquals(isUndeliverableEmailDomain("real@usemingla.com"), false);
});
