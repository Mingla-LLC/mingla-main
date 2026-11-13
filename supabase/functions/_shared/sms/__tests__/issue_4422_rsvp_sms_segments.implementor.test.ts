// Issue #4422 — every RSVP text is one GSM-7 segment.
//
// MINGLA-INVARIANT: I-4422-RSVP-SMS-ONE-SEGMENT | issue #4422 | Every RSVP text (the pass, approved, spot-opened, plus-one, Maybe, waitlisted, pending, can't-go and change texts, and every plain fallback text) fits one 160-septet GSM-7 segment, including " Reply STOP to opt out.", for a 57-character event name, a 30-character lead name and a 26-character short link; it starts with "Mingla:" and carries the opt-out line exactly once.
//
// fails-on-revert: lengthen any template past one segment, drop the title
// shortening from copy.ts, or put back a lower-cased label ("maybe", "rsvp").

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { composeSmsBody } from "../../adapters/smsAdapter.ts";
import {
  finalSmsLength,
  renderBuyerSms,
  type SmsTemplateKey,
} from "../buyerSms.ts";
import { copyFor, type RsvpTemplateKey } from "../../../rsvp-notify/copy.ts";

const TITLE_57 = "The Lagos Rooftop Sunday Sessions with DJ Kolade and Frie";
const LEAD_30 = "Adaeze Chukwuemeka-Okonkwo Jnr";
const LINK_26 = "usemingla.com/c/8KQ2ABCD7Z";
const DATE = "Wed 30 Sep";
const TIME = "10:30 PM";

assertEquals(TITLE_57.length, 57);
assertEquals(LEAD_30.length, 30);
assertEquals(LINK_26.length, 26);

const RSVP_KEYS: SmsTemplateKey[] = [
  "S4",
  "S4A",
  "S4P",
  "S4G",
  "S4M",
  "S4W",
  "S4R",
  "S4N",
  "S4L",
  "S20",
  "S20V",
  "S20D",
];

function assertOneSegment(label: string, body: string): void {
  const final = composeSmsBody(body);
  assert(
    finalSmsLength(body) <= 160,
    `${label} is ${finalSmsLength(body)} septets: ${final}`,
  );
  assert(
    body.startsWith("Mingla: "),
    `${label} must start with Mingla: ${body}`,
  );
  assertEquals(
    final.match(/Reply STOP to opt out\./g)?.length,
    1,
    `${label} footer count`,
  );
}

Deno.test("#4422 every RSVP template is one segment at the design's worst case", () => {
  for (const key of RSVP_KEYS) {
    assertOneSegment(
      key,
      renderBuyerSms(key, {
        title: TITLE_57,
        lead: LEAD_30,
        date: DATE,
        time: TIME,
        link: LINK_26,
        noun: "pass",
        stateWord: "Got it, you can't go to",
      }),
    );
  }
});

Deno.test("#4422 the Going text keeps a 57-character event name whole", () => {
  const body = renderBuyerSms("S4", {
    title: TITLE_57,
    date: DATE,
    link: LINK_26,
  });
  assertEquals(
    body,
    `Mingla: You RSVP'd to ${TITLE_57}, ${DATE}. Here's your pass: ${LINK_26}`,
  );
});

Deno.test("#4422 Seth's three pass texts, exactly", () => {
  const slots = {
    title: "Sunday Sessions",
    date: "Sun 29 Nov",
    link: LINK_26,
  };
  assertEquals(
    composeSmsBody(renderBuyerSms("S4", slots)),
    `Mingla: You RSVP'd to Sunday Sessions, Sun 29 Nov. Here's your pass: ${LINK_26} Reply STOP to opt out.`,
  );
  assertEquals(
    composeSmsBody(renderBuyerSms("S4A", slots)),
    `Mingla: The host approved your RSVP to Sunday Sessions, Sun 29 Nov. Here's your pass: ${LINK_26} Reply STOP to opt out.`,
  );
  assertEquals(
    composeSmsBody(renderBuyerSms("S4P", slots)),
    `Mingla: A spot opened at Sunday Sessions, Sun 29 Nov, so your RSVP is in. Here's your pass: ${LINK_26} Reply STOP to opt out.`,
  );
  // The plus-one keeps the built wording: they took no action.
  assertEquals(
    renderBuyerSms("S4G", { ...slots, lead: "Ada", noun: "pass" }),
    `Mingla: Ada added you to the list for Sunday Sessions, Sun 29 Nov. Get your pass using this number: ${LINK_26}`,
  );
});

Deno.test("#4422 every plain fallback text is one segment, with Mingla: and real capitals", () => {
  const templates: RsvpTemplateKey[] = [
    "rsvp_acknowledgement",
    "rsvp_pass",
    "rsvp_event_updated",
    "buyer_event_updated",
    "rsvp_waitlist_promoted",
    "rsvp_approved",
    "rsvp_denied",
    "rsvp_removed",
  ];
  const states: Array<Record<string, unknown>> = [
    { status: "going", approvalStatus: "approved" },
    { status: "maybe", approvalStatus: "approved" },
    { status: "waitlisted", approvalStatus: "approved" },
    { status: "going", approvalStatus: "pending" },
    { status: "not_going", approvalStatus: "approved" },
  ];
  for (const template of templates) {
    for (const state of template === "rsvp_acknowledgement" ? states : [{}]) {
      const p = { eventName: TITLE_57, brandName: "Lagos Rooftop", ...state };
      const copy = copyFor(template, p, `https://${LINK_26}`, LINK_26);
      const label = `${template} ${JSON.stringify(state)}`;
      assertOneSegment(label, copy.sms);
      if (template === "rsvp_acknowledgement") {
        assert(
          !/\brsvp\b/.test(copy.sms),
          `${label}: lower-cased rsvp: ${copy.sms}`,
        );
        assert(
          !/\bmaybe\b/.test(copy.sms),
          `${label}: lower-cased maybe: ${copy.sms}`,
        );
      }
    }
  }
  const labels = states.map((state) =>
    copyFor(
      "rsvp_acknowledgement",
      { eventName: "Sunday Sessions", ...state },
      LINK_26,
    ).sms
  );
  assertEquals(labels, [
    `Mingla: You're going: Sunday Sessions. ${LINK_26}`,
    `Mingla: Maybe saved: Sunday Sessions. ${LINK_26}`,
    `Mingla: Waitlisted: Sunday Sessions. ${LINK_26}`,
    `Mingla: Request sent: Sunday Sessions. ${LINK_26}`,
    `Mingla: RSVP updated: Sunday Sessions. ${LINK_26}`,
  ]);
});
