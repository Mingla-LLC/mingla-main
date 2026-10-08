/**
 * #3682 Wave 1 Highs — adversarial pins.
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderMarketingEmail } from "../marketingEmailRender.ts";
import { receiveReasonFromAudienceKind } from "../marketingReceiveReason.ts";
import { isUndeliverableEmailDomain } from "../undeliverableEmail.ts";

Deno.test("#3682 buyer audiences still default to bought", () => {
  assertEquals(receiveReasonFromAudienceKind("brand_buyers"), "bought");
  assertEquals(receiveReasonFromAudienceKind("event_buyers"), "bought");
});

Deno.test("#3682 reserved domains cover exact + suffixes", () => {
  for (const email of [
    "a@example.org",
    "a@example.net",
    "a@localhost",
    "a@invalid",
    "guest@sub.example.com",
    "guest@foo.invalid",
    "guest@foo.example.com",
    "not-an-email",
  ]) {
    assertEquals(isUndeliverableEmailDomain(email), true, email);
  }
});

Deno.test("#3682 added reason never claims bought tickets", () => {
  const rendered = renderMarketingEmail({
    body_html: "Hello",
    variables: {
      first_name: "there",
      event_name: null,
      event_date: null,
      event_date_short: null,
      event_time: null,
      doors_open: null,
      ends_at: null,
      brand_name: "Lantern Room",
      event_url: null,
      spots_left: null,
      previous_event_name: null,
      next_event_name: null,
      event_id: null,
    },
    embedded_events: [],
    unsubscribe_url: "https://usemingla.com/u/tok",
    subject: "Hi",
    brand_name: "Lantern Room",
    receive_reason: "added",
  });
  assertStringIncludes(rendered.html, "added you to their guest book");
  assertEquals(rendered.html.includes("bought tickets"), false);
});

Deno.test("#3682 Last call starter migration drops unsupported tokens", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../../migrations/20270806003682_issue_3682_blast_truth_highs.sql",
      import.meta.url,
    ),
  );
  assertEquals(sql.includes("{{event:{event_id}}}"), false);
  assertStringIncludes(sql, "Almost sold out — see you {event_date}");
  assertStringIncludes(sql, "split_part(btrim(COALESCE(p.display_name");
  assertStringIncludes(sql, "receive_reason");
  assertStringIncludes(sql, "biz_marketing_circle_send_audience_v1");
  assertStringIncludes(sql, "friend_of_follower");
  assertStringIncludes(sql, "WHEN 'event_rsvp' THEN 'rsvp'");
  assertEquals(sql.includes("WHEN 'event_rsvp' THEN 'bought'"), false);
});
