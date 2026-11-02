/**
 * #3682 Wave 1 Highs — receive-reason footer, empty event-token strip,
 * undeliverable domains (happy).
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderMarketingEmail } from "../marketingEmailRender.ts";
import { EMAIL_FOOTER_LINE } from "../../../../packages/brand-rendering/emailFooter.ts";
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

// #4226 (Seth, 2026-11-02): the per-reason footer sentences were replaced by
// ONE line every email carries; a blast never claims a reason it can't prove.
Deno.test("#3682/#4226 a blast footer carries the one footer line, once, and claims no purchase", () => {
  const rendered = renderMarketingEmail({
    body_html: "Hi {first_name}",
    variables: vars,
    embedded_events: [],
    unsubscribe_url: "https://usemingla.com/u/tok",
    subject: "Hello",
    brand_name: "Lantern Room",
  });
  assertEquals(rendered.html.split(EMAIL_FOOTER_LINE).length - 1, 1);
  assertStringIncludes(rendered.html, "Mingla honours this for Lantern Room");
  assertEquals(rendered.html.includes("bought tickets"), false);
  assertEquals(rendered.html.includes("purchased tickets"), false);
});

Deno.test("#3682 empty {{event:}} token is stripped after empty event_id", () => {
  const rendered = renderMarketingEmail({
    body_html: "See you there.{{event:}}\n\n— {brand_name}",
    variables: vars,
    embedded_events: [],
    unsubscribe_url: "https://usemingla.com/u/tok",
    subject: "Almost sold out — see you Fri Oct 10",
    brand_name: "Lantern Room",
  });
  assertEquals(rendered.html.includes("{{event:}}"), false);
});

Deno.test("#3682 example.com is undeliverable", () => {
  assertEquals(isUndeliverableEmailDomain("guest@example.com"), true);
  assertEquals(isUndeliverableEmailDomain("real@usemingla.com"), false);
});
