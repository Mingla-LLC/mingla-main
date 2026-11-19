// Issue #4508 — what rsvp-notify does with a brought guest's queue row
// (resolveGuestMessage), without the network.
//
// MINGLA-INVARIANT: I-4508-GUEST-TEXT-NAMES-INVITER | issue #4508 | a brought guest's invite text names the inviter ("Ada O. is bringing you to ..."), carries the guest's own /c/ claim link, says the pass is in the Mingla app, fits one GSM-7 segment with the STOP line, and is never sent to a released guest; the reminder is never sent after a claim.
//
// fails-on-revert: resolveGuestMessage returning not_guest_row for every row
// (the pre-#4508 behaviour) reds every case below.
import { finalSmsLength } from "../../_shared/sms/buyerSms.ts";
import {
  buildFriendGoingCopy,
  type GuestMessageContext,
  inviterForText,
  parseGuestMessageContext,
  resolveGuestMessage,
} from "../guestInvite.ts";

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new Error(message);
};

const GUEST_ID = "45080000-3333-4333-8333-333333333333";
const CODE = "ABCDEFGHJK";
const LONG =
  "An Extremely Long Event Name That Goes On And On Through The Whole Evening Edition";

function deps(ctx: GuestMessageContext | "unavailable", link = true) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      context: (id: string) => {
        calls.push(`context:${id}`);
        return Promise.resolve(ctx);
      },
      claimLink: (id: string) => {
        calls.push(`link:${id}`);
        return Promise.resolve(
          link
            ? {
              url: `https://usemingla.com/c/${CODE}`,
              display: `usemingla.com/c/${CODE}`,
            }
            : null,
        );
      },
    },
  };
}

const live = (
  over: Partial<GuestMessageContext> = {},
): GuestMessageContext => ({
  exists: true,
  claimed: false,
  eligible: true,
  guestId: GUEST_ID,
  eventTitle: "Rooftop Night",
  eventStartAt: "2026-12-05T23:00:00Z",
  eventTimezone: "America/New_York",
  inviterLabel: "Ada O.",
  ...over,
});

const guestRow = (template = "rsvp_pass") => ({
  template,
  channel: "sms",
  payload: { role: "guest", guestId: GUEST_ID, eventName: "Rooftop Night" },
});

Deno.test("invite text names the inviter, links the claim and fits one segment", async () => {
  for (const title of ["Rooftop Night", LONG]) {
    const { deps: d } = deps(live({ eventTitle: title }));
    const decision = await resolveGuestMessage(d, guestRow());
    assert(decision.kind === "message", JSON.stringify(decision));
    const sms = decision.copy.sms;
    assert(sms.startsWith("Mingla: Ada O. is bringing you to "), sms);
    assert(
      sms.endsWith(`Get your pass in the Mingla app: usemingla.com/c/${CODE}`),
      sms,
    );
    assert(/Dec 5|5 Dec/.test(sms), `date: ${sms}`);
    assert(
      finalSmsLength(sms) <= 160,
      `one segment with STOP: ${finalSmsLength(sms)}`,
    );
    assert(
      decision.link === `https://usemingla.com/c/${CODE}`,
      "push / in-app link",
    );
    assert(
      decision.copy.title === `Ada O. is bringing you to ${title}`,
      decision.copy.title,
    );
  }
});

Deno.test("the same rule for approval and spot-opened passes, not for primaries", async () => {
  for (const template of ["rsvp_approved", "rsvp_waitlist_promoted"]) {
    const decision = await resolveGuestMessage(
      deps(live()).deps,
      guestRow(template),
    );
    assert(decision.kind === "message", template);
  }
  const primary = await resolveGuestMessage(deps(live()).deps, {
    template: "rsvp_pass",
    channel: "sms",
    payload: { role: "primary" },
  });
  assert(primary.kind === "not_guest_row", "a primary row is unchanged");
  const email = await resolveGuestMessage(deps(live()).deps, {
    ...guestRow(),
    channel: "email",
  });
  assert(
    email.kind === "not_guest_row",
    "the invite email keeps the shared message",
  );
});

Deno.test("a released guest is never texted", async () => {
  const { deps: d, calls } = deps({ exists: false });
  const decision = await resolveGuestMessage(d, guestRow());
  assert(
    decision.kind === "finish" && decision.status === "failed_terminal" &&
      decision.code === "rsvp_guest_released",
    JSON.stringify(decision),
  );
  assert(
    !calls.some((c) => c.startsWith("link:")),
    "no link minted for a released guest",
  );
});

Deno.test("a failed read or link is retried, never sent wrong", async () => {
  const unread = await resolveGuestMessage(
    deps("unavailable").deps,
    guestRow(),
  );
  assert(
    unread.kind === "finish" && unread.status === "failed_retryable",
    "context",
  );
  const nolink = await resolveGuestMessage(
    deps(live(), false).deps,
    guestRow(),
  );
  assert(
    nolink.kind === "finish" && nolink.code === "rsvp_guest_link_unavailable",
    "link",
  );
});

Deno.test("the reminder goes only to an unclaimed, eligible guest", async () => {
  const sent = await resolveGuestMessage(
    deps(live()).deps,
    guestRow("rsvp_guest_reminder"),
  );
  assert(sent.kind === "message", "unclaimed");
  assert(
    sent.copy.sms ===
      `Mingla: your pass for Rooftop Night tomorrow is waiting. Ada O. saved you a spot: usemingla.com/c/${CODE}`,
    sent.copy.sms,
  );
  for (const over of [{ claimed: true }, { eligible: false }]) {
    const held = await resolveGuestMessage(
      deps(live(over)).deps,
      guestRow("rsvp_guest_reminder"),
    );
    assert(
      held.kind === "finish" && held.code === "rsvp_guest_reminder_not_needed",
      JSON.stringify(over),
    );
  }
  const long = await resolveGuestMessage(
    deps(live({ eventTitle: LONG })).deps,
    guestRow("rsvp_guest_reminder"),
  );
  assert(
    long.kind === "message" && finalSmsLength(long.copy.sms) <= 160,
    "reminder fits",
  );
});

Deno.test("copy helpers and context parsing", () => {
  assert(inviterForText(null) === "A friend", "unknown inviter");
  assert(
    inviterForText("Zoë Ångström-Ndukwe The Third").length <= 24,
    "bounded",
  );
  assert(
    parseGuestMessageContext({ exists: false })?.exists === false,
    "released",
  );
  assert(parseGuestMessageContext("nope") === null, "garbage");
  const going = buildFriendGoingCopy({
    actorName: "Yas",
    eventTitle: "Rooftop Night",
  });
  assert(going.title === "Yas is going to Rooftop Night", going.title);
  assert(
    going.body === "Yas is going to Rooftop Night. Join them?",
    going.body,
  );
});

// ---- Wave A rework -----------------------------------------------------------
Deno.test("P2-2: only letters reach a text as the inviter's name", () => {
  const exact: Array<[string, string]> = [
    ["Ada O.", "Ada O."],
    ["!!! 123 ???", "A friend"],
    ["Zoë D'Arcy-Lee K.", "Zoe D'Arcy-Lee K."], // GSM-7 folds the accent
    ["Call 0800 555 now", "Call now"],
  ];
  for (const [input, want] of exact) {
    const got = inviterForText(input);
    assert(got === want, `${input} -> ${got}`);
  }
  for (
    const input of [
      "Ann <a href=x.co>visit evil.co</a>",
      "https://evil.example/claim?x=1",
      "Win \u00a3500 at 07700 900123",
    ]
  ) {
    const got = inviterForText(input);
    assert(!/[0-9:/<>@.?=]/.test(got), `no digits, links or markup: ${got}`);
    assert(Array.from(got).length <= 24, `at most 24: ${got}`);
  }
});

Deno.test("a held guest (no number, or the number's daily limit) is never texted", async () => {
  for (const hold of ["no_phone", "number_limit"]) {
    const sms = await resolveGuestMessage(deps(live({ smsHold: hold })).deps, {
      template: "rsvp_pass",
      channel: "sms",
      payload: { role: "guest", guestId: GUEST_ID },
    });
    assert(
      sms.kind === "finish" && sms.status === "failed_terminal" &&
        sms.code === "rsvp_guest_sms_held",
      `${hold}: ${JSON.stringify(sms)}`,
    );
    const push = await resolveGuestMessage(deps(live({ smsHold: hold })).deps, {
      template: "rsvp_pass",
      channel: "push",
      payload: { role: "guest", guestId: GUEST_ID },
    });
    assert(
      push.kind === "message",
      `${hold}: push still goes: ${JSON.stringify(push)}`,
    );
  }
  assert(
    parseGuestMessageContext({ exists: true, smsHold: "number_limit" })
      ?.smsHold ===
      "number_limit",
    "the hold is read from the database context",
  );
});

Deno.test("S3: the reminder email to a guest with an email reads as a reminder with the claim link", async () => {
  const r = await resolveGuestMessage(deps(live()).deps, {
    template: "rsvp_guest_reminder",
    channel: "email",
    payload: { role: "guest", guestId: GUEST_ID },
  });
  assert(r.kind === "message", JSON.stringify(r));
  assert(
    r.kind === "message" &&
      r.copy.title === "Your pass for Rooftop Night is waiting" &&
      /saved you a spot/.test(r.copy.body) &&
      r.link === `https://usemingla.com/c/${CODE}`,
    `email copy and button: ${JSON.stringify(r)}`,
  );
  // The pass-message renderer (which would replace this copy) only runs for
  // pass templates, never for the reminder.
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(
    /const isPassTemplate = claim\.template_key === "rsvp_pass" \|\|\n\s+claim\.template_key === "rsvp_waitlist_promoted" \|\|\n\s+claim\.template_key === "rsvp_approved";/
      .test(src) && /const canRenderV2 = isPassTemplate &&/.test(src),
    "the reminder never takes the pass-message email",
  );
});

Deno.test("P3-5: rsvp-notify reports friend-going enqueue failures", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(
    /"issue_4508_take_friend_going_failures"/.test(src) &&
      /friend-going enqueue failed/.test(src),
    "each recorded failure is reported once",
  );
});
