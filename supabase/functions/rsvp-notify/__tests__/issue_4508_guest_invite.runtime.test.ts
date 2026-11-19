// Issue #4508 — a guest brought to an RSVP by number, through the REAL
// rsvp-notify worker (serve() captured by the import-map shim, the real
// dispatcher and SMS adapter). Only the network is replaced; any request the
// fixture does not recognise fails the test.
//
//   G-01 the invite text names the inviter, the event and the date, carries the
//        guest's /c/ claim link, says "in the Mingla app", and with the STOP
//        line stays one GSM-7 segment even for a very long event name.
//   G-02 a released guest ("This isn't me": the row is gone) is never texted;
//        the delivery is parked rsvp_guest_released.
//   G-03 the reminder is sent once to an unclaimed guest and parked, unsent,
//        for a guest who has claimed.
//   G-04 the copy helpers: inviter fallback, one segment, friend-going words.
//
// fails-on-revert: drop prepareGuestMessage -> G-01 (S4G "added you to the
// list" wording) and G-02 (the released guest is texted) red.
//
// Needs the serve() shim, so it runs with the import map (like the #3827 and
// unlisted-pass runtime suites); the CI-registered unit suite for the same
// decisions is issue_4508_guest_message.implementor.test.ts.
// Run: deno test --import-map=supabase/functions/rsvp-notify/__tests__/_importmap.test.json
//        --allow-read --allow-env --allow-net <this file>
import { getCapturedHandler } from "../../_shared/__tests__/_serveShim.ts";
import { finalSmsLength } from "../../_shared/sms/buyerSms.ts";
import {
  buildFriendGoingCopy,
  buildGuestInviteCopy,
  buildGuestReminderCopy,
  inviterForText,
} from "../guestInvite.ts";

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new Error(message);
};

const ORIGIN = "https://fixture.invalid";
const EVENT_ID = "45080000-1111-4111-8111-111111111111";
const RSVP_ID = "45080000-2222-4222-8222-222222222222";
const GUEST_ID = "45080000-3333-4333-8333-333333333333";
const CODE = "ABCDEFGHJK";

const fixtureEnv: Record<string, string> = {
  SUPABASE_URL: ORIGIN,
  SUPABASE_SERVICE_ROLE_KEY: "fixture-service-only",
  RESEND_API_KEY: "fixture-resend-only",
  DENO_TESTING: "1",
  "app.qr_token_pepper": "fixture-pepper-4508-not-a-real-secret-123456789",
  SMS_LIVE_ENABLED_US: "true",
  TWILIO_ACCOUNT_SID: "ACfixture",
  TWILIO_AUTH_TOKEN: "fixture-only",
  TWILIO_MESSAGING_SERVICE_SID: "MGfixture",
};

interface World {
  template: string;
  context: Record<string, unknown>;
  title: string;
}
const world: World = { template: "rsvp_pass", context: {}, title: "" };
const seen = {
  texts: [] as Array<Record<string, string>>,
  completions: [] as Array<Record<string, unknown>>,
  rejected: [] as string[],
};

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

Deno.env.get = (name: string) => fixtureEnv[name];
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  if (url.origin === ORIGIN) {
    const leaf = url.pathname.split("/").at(-1) ?? "";
    const body = req.method === "GET" ? null : await req.json();
    switch (leaf) {
      case "event_edit_notice_fanout":
        return jsonResponse({ notices: 0, rows: 0 });
      case "rsvp_enqueue_guest_reminders":
        return jsonResponse(0);
      case "issue_4508_take_friend_going_notices":
      case "issue_4422_claim_unreached_guest_alerts":
        return jsonResponse([]);
      case "claim_rsvp_notification_deliveries":
        return jsonResponse([{
          delivery_id: "delivery-4508",
          notification_id: "notification-4508",
          channel: "sms",
          attempt_count: 1,
          lease_id: "lease-4508",
          template_key: world.template,
          idempotency_key: `${world.template}:${RSVP_ID}:${GUEST_ID}`,
          payload: {
            template_key: world.template,
            rsvp_id: RSVP_ID,
            event_id: EVENT_ID,
            role: "guest",
            guestId: GUEST_ID,
            entityId: GUEST_ID,
            recipientPhone: "+15550104508",
            eventName: world.title,
            brandName: "Rooftop Host",
          },
        }]);
      case "rsvp_guest_message_context":
        if ((body as Record<string, unknown>)?.p_guest_id !== GUEST_ID) {
          seen.rejected.push("context read for the wrong guest");
        }
        return jsonResponse(world.context);
      case "mint_claim_link":
        if (
          (body as Record<string, unknown>)?.p_subject_kind !== "rsvp_guest" ||
          (body as Record<string, unknown>)?.p_subject_id !== GUEST_ID
        ) {
          seen.rejected.push("claim link minted for the wrong subject");
        }
        return jsonResponse({ code: CODE, expiresAt: "2027-01-01T00:00:00Z", claimed: false });
      case "event_rsvps":
        return jsonResponse({
          event_id: EVENT_ID,
          rsvp_status: "going",
          approval_status: "approved",
        });
      case "events":
        return jsonResponse({
          status: "scheduled",
          visibility: "public",
          deleted_at: null,
          event_type: "rsvp",
          brands: { deleted_at: null, contact_email: null },
        });
      case "can_send":
      case "mark_rsvp_notification_provider_io":
        return jsonResponse(true);
      case "notification_categories":
        return jsonResponse({
          key: "rsvp_pass",
          active: true,
          default_channels: ["email", "sms", "push", "inapp"],
        });
      case "finish_rsvp_notification_delivery":
        seen.completions.push(body as Record<string, unknown>);
        return jsonResponse(true);
    }
  }
  if (url.href === "https://api.twilio.com/2010-04-01/Accounts/ACfixture/Messages.json") {
    seen.texts.push(Object.fromEntries(new URLSearchParams(await req.text())));
    return jsonResponse({ sid: "fixture-sms" });
  }
  seen.rejected.push(`${req.method} ${url.origin}${url.pathname}`);
  throw new Error("Unexpected external request blocked");
};

await import("../index.ts");

async function tick(): Promise<void> {
  seen.texts.length = 0;
  seen.completions.length = 0;
  seen.rejected.length = 0;
  const handler = getCapturedHandler();
  assert(handler, "rsvp-notify must register its handler through serve()");
  const response = await handler(
    new Request("http://localhost/rsvp-notify", {
      method: "POST",
      headers: {
        Authorization: "Bearer fixture-service-only",
        "Content-Type": "application/json",
      },
      body: "{}",
    }),
  );
  assert(response.status === 200, `worker answered ${response.status}`);
  await response.body?.cancel();
  assert(
    seen.rejected.length === 0,
    `no unrecognised request: ${JSON.stringify(seen.rejected)}`,
  );
}

const liveContext = (overrides: Record<string, unknown> = {}) => ({
  exists: true,
  claimed: false,
  eligible: true,
  guestId: GUEST_ID,
  rsvpId: RSVP_ID,
  eventId: EVENT_ID,
  eventTitle: world.title,
  eventStartAt: "2026-12-05T23:00:00Z",
  eventTimezone: "America/New_York",
  inviterLabel: "Ada O.",
  ...overrides,
});

const test = (name: string, fn: () => Promise<void> | void): void =>
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });

test("G-01 the invite text names the inviter and fits one segment", async () => {
  for (
    const title of [
      "Rooftop Night",
      "An Extremely Long Event Name That Goes On And On Through The Whole Evening Edition",
    ]
  ) {
    world.template = "rsvp_pass";
    world.title = title;
    world.context = liveContext();
    await tick();
    assert(seen.texts.length === 1, `one text for "${title}"`);
    const body = seen.texts[0].Body ?? "";
    assert(body.startsWith("Mingla: Ada O. is bringing you to "), `names the inviter: ${body}`);
    assert(body.includes("Get your pass in the Mingla app: usemingla.com/c/" + CODE), `claim link: ${body}`);
    assert(/Dec 5|5 Dec/.test(body), `carries the date: ${body}`);
    assert(/STOP/i.test(body), `the adapter's STOP line is kept: ${body}`);
    assert(!body.includes("+1555"), "the number never appears in the text");
    assert(seen.completions[0]?.p_status === "sent", "completed as sent");
  }
  const long = buildGuestInviteCopy({
    inviter: "Ada O.",
    title: "An Extremely Long Event Name That Goes On And On Through The Whole Evening Edition",
    date: "Sat, Dec 5",
    link: "usemingla.com/c/" + CODE,
  });
  assert(finalSmsLength(long.sms) <= 160, `one segment with STOP: ${finalSmsLength(long.sms)}`);
});

test("G-02 a released guest is never texted", async () => {
  world.template = "rsvp_pass";
  world.title = "Rooftop Night";
  world.context = { exists: false };
  await tick();
  assert(seen.texts.length === 0, "no text to a released number");
  assert(
    seen.completions[0]?.p_status === "failed_terminal" &&
      seen.completions[0]?.p_safe_error_code === "rsvp_guest_released",
    `parked as released: ${JSON.stringify(seen.completions)}`,
  );
});

test("G-03 the reminder goes to an unclaimed guest only", async () => {
  world.template = "rsvp_guest_reminder";
  world.title = "Rooftop Night";
  world.context = liveContext();
  await tick();
  assert(seen.texts.length === 1, "one reminder");
  const body = seen.texts[0].Body ?? "";
  assert(
    body.startsWith("Mingla: your pass for Rooftop Night tomorrow is waiting. Ada O. saved you a spot: usemingla.com/c/" + CODE),
    `reminder wording: ${body}`,
  );
  world.context = liveContext({ claimed: true });
  await tick();
  assert((seen.texts as unknown[]).length === 0, "no reminder after a claim");
  assert(
    seen.completions[0]?.p_safe_error_code === "rsvp_guest_reminder_not_needed",
    "parked as not needed",
  );
});

test("G-04 copy helpers", () => {
  assert(inviterForText(null) === "A friend", "unknown inviter");
  assert(inviterForText("Zoë Ångström-Ndukwe Long") .length <= 24, "bounded inviter");
  const reminder = buildGuestReminderCopy({
    inviter: "Ada O.",
    title: "x".repeat(200),
    link: "usemingla.com/c/" + CODE,
  });
  assert(finalSmsLength(reminder.sms) <= 160, "reminder fits one segment");
  const going = buildFriendGoingCopy({ actorName: "Yas", eventTitle: "Rooftop Night" });
  assert(going.title === "Yas is going to Rooftop Night", going.title);
  assert(going.body === "Yas is going to Rooftop Night. Join them?", going.body);
});
