// Issue #4422 — independent tester adversarial proof for the RSVP messages.
//
// A different angle from the implementor's suites: it does NOT trust the
// module's own septet counter (finalSmsLength). Every composed text is checked
// against an independent GSM 03.38 table, with hostile event names (57 and 200
// characters, curly quotes, emoji, Yoruba tone marks, em dashes, a year-bearing
// date) and the real formatMessageTime output (which can carry U+202F).
// It also attacks the change-notice path: the EMAIL row of a live-edit notice
// must still render when the event's public link is long, because that row
// never mints a short link (eventUpdate.ts is called with links = null).
//
// MINGLA-INVARIANT: I-4422-CHANGE-EMAIL-NEVER-BLOCKED-BY-SMS | issue #4422 | The text body built for a change notice can never stop the email (or any channel) of that notice from rendering: a long event link falls back to a text without a link, it never throws sms_template_overflow.
//
// fails-on-revert: put back a 10-character-date assumption, drop the GSM-7
// normalisation of the date slot, or remove the overflow fallback.
//
// Run: deno test --allow-env --allow-net --allow-read --no-check <this file>

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { composeSmsBody } from "../../_shared/adapters/smsAdapter.ts";
import {
  renderBuyerSms,
  type SmsTemplateKey,
} from "../../_shared/sms/buyerSms.ts";
import { formatMessageTime } from "../../_shared/messageTime.ts";
import { buildRsvpPassMessage } from "../../_shared/rsvpPassMessage.ts";
import {
  eventLinkExpiry,
  resolveBuyerLink,
} from "../../_shared/messageLinks.ts";
import { nextNgGenericWindowOpen } from "../../_shared/ngSmsEmbargo.ts";
import { copyFor, type RsvpTemplateKey } from "../copy.ts";
import {
  buildEventUpdateDispatch,
  type NoticeContext,
} from "../eventUpdate.ts";

// --- an independent GSM 03.38 counter (not the module's) ------------------
const BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const EXTENDED = "\f^{}\\[~]|€";
function septets(text: string): number {
  let n = 0;
  for (const ch of text) {
    if (EXTENDED.includes(ch)) n += 2;
    else if (BASIC.includes(ch)) n += 1;
    else {throw new Error(
        `not GSM-7: U+${ch.codePointAt(0)!.toString(16)} in ${
          JSON.stringify(text)
        }`,
      );}
  }
  return n;
}
function assertOneSegment(label: string, body: string): string {
  const final = composeSmsBody(body);
  const n = septets(final);
  assert(n <= 160, `${label}: ${n} septets: ${final}`);
  assertEquals(
    final.match(/Reply STOP to opt out\./g)?.length,
    1,
    `${label} footer`,
  );
  assert(final.startsWith("Mingla: "), `${label} sender: ${final}`);
  assert(!/\brsvp\b/.test(final), `${label} lower-case rsvp: ${final}`);
  assert(!/\bmaybe\b/.test(final), `${label} lower-case maybe: ${final}`);
  return final;
}

const TITLES: Record<string, string> = {
  t57: "The Lagos Rooftop Sunday Sessions with DJ Kolade and Frie",
  t120: "A".repeat(40) +
    " Night of Afrobeats, Amapiano and Highlife at the Old Marina Warehouse in Lagos Island "
      .slice(0, 80),
  t200: "Owambe ".repeat(29),
  curly: "Tobi’s “Big” 30th — Detty December Rooftop Party at Eko Atlantic",
  emoji:
    "\u{1F389}\u{1F525} Afro House Sundays \u{1F1F3}\u{1F1EC} with Friends \u{1F57A}\u{1F483}",
  yoruba: "Ọjọ́ Ìbí Adébáyọ̀ ni Èkó — Òṣùn Festival",
  emojiOnly: "\u{1F389}\u{1F389}\u{1F389}",
};
const LINK = "usemingla.com/c/8KQ2ABCD7Z";
// Real formatter output: next year (year-bearing date) and this year.
const NOW = new Date("2026-11-13T12:00:00Z");
const WHEN = [
  formatMessageTime("2027-09-29T21:30:00Z", "Africa/Lagos", NOW)!,
  formatMessageTime("2026-11-29T18:00:00Z", "Africa/Lagos", NOW)!,
];

const KEYS: SmsTemplateKey[] = [
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

Deno.test("T-01 every RSVP SMS key is one real GSM-7 segment for hostile names and real dates", () => {
  for (const [name, title] of Object.entries(TITLES)) {
    for (const when of WHEN) {
      for (const key of KEYS) {
        assertOneSegment(
          `${key}/${name}/${when.date}`,
          renderBuyerSms(key, {
            title,
            lead: "Ṣade \u{1F451} Adéṣínà-Ogunlesi Jnr",
            date: when.date,
            time: when.time,
            link: LINK,
            noun: "pass",
            stateWord: "Got it, you can't go to",
          }),
        );
      }
    }
  }
});

Deno.test("T-02 every copyFor fallback is one real GSM-7 segment with a short link", () => {
  const templates: RsvpTemplateKey[] = [
    "rsvp_pass",
    "rsvp_acknowledgement",
    "rsvp_event_updated",
    "buyer_event_updated",
    "rsvp_waitlist_promoted",
    "rsvp_approved",
    "rsvp_denied",
    "rsvp_removed",
  ];
  const states = [
    { status: "maybe" },
    { status: "waitlisted" },
    { status: "going", approvalStatus: "pending" },
    { status: "not_going" },
    { status: "going", approvalStatus: "approved" },
  ];
  for (const [name, title] of Object.entries(TITLES)) {
    for (const template of templates) {
      for (const state of template === "rsvp_acknowledgement" ? states : [{}]) {
        const copy = copyFor(
          template,
          { eventName: title, brandName: "Lagos \u{1F378} Rooftop", ...state },
          `https://${LINK}`,
          LINK,
        );
        assertOneSegment(
          `${template}/${name}/${JSON.stringify(state)}`,
          copy.sms,
        );
        assert(
          !/\bmaybe\b|\brsvp\b/.test(copy.title + " " + copy.body),
          `${template} title/body case: ${copy.title} | ${copy.body}`,
        );
      }
    }
  }
});

Deno.test("T-03 the approved pass copy, exactly, after composeSmsBody", () => {
  const base = {
    guest: false,
    title: "Sunday Sessions",
    brandName: "Lagos Rooftop",
    recipientName: "Ada",
    recipientEmail: "ada@example.invalid",
    recipientPhoneLast4: null,
    leadName: null,
    claimed: false,
    buttonUrl: `https://${LINK}`,
    smsLink: LINK,
    date: "Sun 29 Nov",
    time: "7:00 PM",
    when: "Sun 29 Nov, 7:00 PM",
    place: null,
  };
  const exact: Record<string, string> = {
    going:
      `Mingla: You RSVP'd to Sunday Sessions, Sun 29 Nov. Here's your pass: ${LINK} Reply STOP to opt out.`,
    approved:
      `Mingla: The host approved your RSVP to Sunday Sessions, Sun 29 Nov. Here's your pass: ${LINK} Reply STOP to opt out.`,
    spot_opened:
      `Mingla: A spot opened at Sunday Sessions, Sun 29 Nov, so your RSVP is in. Here's your pass: ${LINK} Reply STOP to opt out.`,
  };
  for (const reason of ["going", "approved", "spot_opened"] as const) {
    // deno-lint-ignore no-explicit-any
    const msg = buildRsvpPassMessage({ ...base, reason } as any);
    assertEquals(composeSmsBody(msg.sms), exact[reason]);
  }
  // A plus-one keeps the lead's wording even if the reason says approved.
  // deno-lint-ignore no-explicit-any
  const guest = buildRsvpPassMessage(
    { ...base, guest: true, leadName: "Ada", reason: "approved" } as any,
  );
  assert(
    guest.sms.startsWith(
      "Mingla: Ada added you to the list for Sunday Sessions",
    ),
    guest.sms,
  );
});

Deno.test("T-04 the Nigerian embargo reopens at 08:00 WAT for a text created at 20:05, 23:00 and 04:30", () => {
  const cases: Array<[string, string]> = [
    ["2026-11-12T19:05:00Z", "2026-11-13T07:00:00.000Z"], // 20:05 WAT
    ["2026-11-12T22:00:00Z", "2026-11-13T07:00:00.000Z"], // 23:00 WAT
    ["2026-11-13T03:30:00Z", "2026-11-13T07:00:00.000Z"], // 04:30 WAT
  ];
  for (const [at, open] of cases) {
    assertEquals(nextNgGenericWindowOpen(new Date(at)).toISOString(), open, at);
  }
});

Deno.test("T-05 the event short link falls back to the page itself when minting fails, and its expiry stays inside the database bounds", async () => {
  const failing = {
    rpc: () =>
      Promise.resolve({
        data: null,
        error: { message: "redirect_invalid", code: "22023" },
      }),
  };
  const target = "https://host.usemingla.com/e/lagos-rooftop/sunday-sessions";
  // deno-lint-ignore no-explicit-any
  const link = await resolveBuyerLink(failing as any, {
    kind: "event_page",
    sourceId: "11111111-1111-4111-8111-111111111111",
    targetUrl: target,
    expiresAt: eventLinkExpiry({ startAt: "2026-11-29T18:00:00Z" }, NOW),
  });
  assertEquals(link.fallback, true);
  assertEquals(link.url, target);
  assertEquals(
    link.display,
    "host.usemingla.com/e/lagos-rooftop/sunday-sessions",
  );
  const day = 86_400_000;
  for (
    const times of [{}, { startAt: "2020-01-01T00:00:00Z" }, {
      lastEndAt: "2030-01-01T00:00:00Z",
    }, { endAt: "garbage" }]
  ) {
    const exp = Date.parse(eventLinkExpiry(times, NOW));
    assert(
      exp > NOW.getTime() && exp < NOW.getTime() + 400 * day,
      `expiry ${JSON.stringify(times)}`,
    );
  }
});

// --- the change notice: email rows never mint, so the SMS body falls back to
// --- the full page link; a long link must not stop the EMAIL from rendering.
function context(eventUrl: string, field: "dates" | "venue"): NoticeContext {
  return {
    noticeId: "33333333-3333-4333-8333-333333333333",
    kind: "rsvp",
    eventName: "Sunday Sessions",
    brandName: "Lagos Rooftop",
    brandContactEmail: null,
    timezone: "Africa/Lagos",
    changes: field === "dates"
      ? [{
        field: "dates",
        old: [{ s: "2026-11-29T18:00:00Z", e: "2026-11-29T22:00:00Z" }],
        new: [{ s: "2026-12-16T18:30:00Z", e: "2026-12-16T22:00:00Z" }],
      }]
      : [{ field: "venue", old: "Waterside", new: "The Deck at Landmark" }],
    reason: null,
    venueName: "The Deck at Landmark",
    eventUrl,
    eventId: "11111111-1111-4111-8111-111111111111",
    lastEndAt: null,
  };
}

Deno.test("T-06 a change notice still renders (email and text) when the event link is long", async () => {
  const previous = Deno.env.get;
  Deno.env.get = (name: string) =>
    name === "MINGLA_FOOTER_ADDRESS"
      ? "1 Fixture Street"
      : previous.call(Deno.env, name);
  try {
    // 11 of 56 live production events have a host link longer than 71 characters
    // (read-only count, 13 Nov 2026); the longest is 89.
    const url =
      "https://host.usemingla.com/e/lagos-rooftop-collective/the-sunday-sessions-rooftop-edition-december";
    for (const field of ["dates", "venue"] as const) {
      const dispatch = await buildEventUpdateDispatch(
        context(url, field),
        {},
        null,
      );
      assert(dispatch.emailOverride.rendered, `${field}: the email renders`);
      assertOneSegment(`change/${field}`, dispatch.sms);
    }
  } finally {
    Deno.env.get = previous;
  }
});
