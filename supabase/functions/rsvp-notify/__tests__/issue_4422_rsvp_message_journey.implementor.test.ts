// Issue #4422 — the REAL rsvp-notify worker renders every RSVP message of the
// version 4 design: the pass (claim button, date line and calendar file; no
// QR PDF: Seth, 13 Nov, everything goes through the app), the approved and spot-opened passes, and the Maybe, waitlisted,
// pending and can't-go messages with a short link to the live event page.
//
// Runs the actual handler (std serve() driven in memory by _stdServeHarness),
// the real dispatcher, the real email and SMS adapters and the real PDF
// builder. Only the network and Deno.env are replaced; any request the
// fixture does not recognise fails the test.
//
// fails-on-revert:
//   - a QR PDF added to the enriched pass          -> J-01 sees two attachments
//   - passReason ignored                           -> J-02/J-03 see S4
//   - the acknowledgement branch removed           -> J-04/J-05 see legacy copy
//   - the no-link variant removed                  -> J-06 overflows to retry
//
// Set ISSUE_4422_RENDER_DIR (and --allow-write) to save each rendered message.
//
// Run: deno test --allow-env --allow-net --allow-read --no-check <this file>
import {
  importWithStdServe,
  invokeStdServe,
} from "../../_shared/__tests__/_stdServeHarness.ts";

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new Error(message);
};
const same = (actual: unknown, expected: unknown, message: string): void =>
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${
      JSON.stringify(actual)
    }`,
  );

const realEnv = (name: string): string | undefined => {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
};
const RENDER_DIR = realEnv("ISSUE_4422_RENDER_DIR");

const ORIGIN = "https://fixture.invalid";
const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const RSVP_ID = "22222222-2222-4222-8222-222222222222";
const EVENT_URL = "https://host.usemingla.com/e/lagos-rooftop/sunday-sessions";
const PASS_CODE = "PASS4422AB";
const EVENT_CODE = "EVNT4422CD";

const fixtureEnv: Record<string, string> = {
  SUPABASE_URL: ORIGIN,
  SUPABASE_SERVICE_ROLE_KEY: "fixture-service-only",
  RESEND_API_KEY: "fixture-resend-only",
  DENO_TESTING: "1",
  "app.qr_token_pepper": "fixture-pepper-4422-not-a-real-secret-123456789",
  SMS_LIVE_ENABLED_US: "true",
  TWILIO_ACCOUNT_SID: "ACfixture",
  TWILIO_AUTH_TOKEN: "fixture-only",
  TWILIO_MESSAGING_SERVICE_SID: "MGfixture",
};

interface World {
  claims: unknown[];
  redirect: "ok" | "fail";
}
interface Seen {
  emails: Array<Record<string, unknown>>;
  texts: string[];
  finishes: Array<Record<string, unknown>>;
  mints: Array<Record<string, unknown>>;
  logs: string[];
  rejected: string[];
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const enriched = {
  rsvpId: RSVP_ID,
  rsvp_id: RSVP_ID,
  event_id: EVENT_ID,
  entityId: RSVP_ID,
  role: "primary",
  recipientEmail: "ada@example.invalid",
  recipientPhone: "+15551234567",
  recipientName: "Ada Obi",
  eventName: "Sunday Sessions",
  brandName: "Lagos Rooftop",
  brandContactEmail: "host@example.invalid",
  eventStartAt: "2026-11-29T18:00:00+00:00",
  eventEndAt: "2026-11-29T22:00:00+00:00",
  eventLastEndAt: "2026-11-29T22:00:00+00:00",
  eventTimezone: "Africa/Lagos",
  venueLine: "12 Marina Road",
  eventUrl: EVENT_URL,
  qrCode: "mingla-rsvp:4422-fixture",
  passReason: "going",
};

function claim(
  template: string,
  channel: "email" | "sms",
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    delivery_id: `delivery-${template}-${channel}`,
    notification_id: `notification-${template}`,
    channel,
    attempt_count: 1,
    lease_id: "fixture-lease",
    template_key: template,
    idempotency_key: `fixture-${template}-${channel}`,
    payload,
  };
}

function install(world: World, seen: Seen): () => void {
  const previousFetch = globalThis.fetch;
  const previousGet = Deno.env.get;
  const previousInfo = console.info;
  Deno.env.get = (name: string) => fixtureEnv[name];
  console.info = (...args: unknown[]) => {
    seen.logs.push(args.map(String).join(" "));
  };
  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.origin === ORIGIN) {
      const leaf = url.pathname.split("/").at(-1) ?? "";
      const body = req.method === "GET" ? {} : await req.json();
      if (url.pathname.includes("/rpc/")) {
        if (leaf === "claim_rsvp_notification_deliveries") {
          return json(world.claims);
        }
        if (leaf === "finish_rsvp_notification_delivery") {
          seen.finishes.push(body);
          return json(true);
        }
        if (leaf === "mint_claim_link") {
          return json({ code: PASS_CODE, claimed: false });
        }
        if (leaf === "mint_redirect_link") {
          seen.mints.push(body);
          return world.redirect === "ok"
            ? json({ code: EVENT_CODE, expiresAt: body.p_expires_at })
            : json({ message: "redirect_invalid", code: "22023" }, 400);
        }
        if (leaf === "issue_4422_claim_unreached_guest_alerts") return json([]);
        if (
          leaf === "can_send" ||
          leaf === "mark_rsvp_notification_provider_io" ||
          leaf === "event_edit_notice_fanout"
        ) return json(true);
      }
      if (leaf === "notification_categories") {
        return json({
          key: "rsvp_pass",
          active: true,
          default_channels: ["inapp", "push", "email", "sms"],
        });
      }
      if (leaf === "events" && req.method === "GET") {
        return json({
          status: "scheduled",
          visibility: "public",
          deleted_at: null,
          event_type: "rsvp",
          brands: { deleted_at: null, contact_email: "host@example.invalid" },
        });
      }
      if (leaf === "event_rsvps") {
        if (req.method === "PATCH") return json(null);
        return json({
          event_id: EVENT_ID,
          rsvp_status: "going",
          approval_status: "approved",
          pass_recovery_token_hash: null,
          pass_recovery_token_created_at: "2026-11-01T00:00:00.000Z",
        });
      }
    }
    if (url.href === "https://api.resend.com/emails") {
      seen.emails.push(await req.json());
      return json({ id: "fixture-email" });
    }
    if (
      url.href ===
        "https://api.twilio.com/2010-04-01/Accounts/ACfixture/Messages.json"
    ) {
      seen.texts.push(
        String(new URLSearchParams(await req.text()).get("Body") ?? ""),
      );
      return json({ sid: "fixture-sms" });
    }
    seen.rejected.push(`${req.method} ${url.origin}${url.pathname}`);
    throw new Error("Unexpected external request blocked");
  };
  return () => {
    globalThis.fetch = previousFetch;
    Deno.env.get = previousGet;
    console.info = previousInfo;
  };
}

let loaded = false;
async function run(
  world: World,
  claims: unknown[],
  redirect: World["redirect"] = "ok",
): Promise<Seen> {
  const seen: Seen = {
    emails: [],
    texts: [],
    finishes: [],
    mints: [],
    logs: [],
    rejected: [],
  };
  world.claims = claims;
  world.redirect = redirect;
  const restore = install(world, seen);
  try {
    if (!loaded) {
      loaded = true;
      await importWithStdServe(new URL("../index.ts", import.meta.url).href);
    }
    const response = await invokeStdServe(
      new Request("http://localhost/rsvp-notify", {
        method: "POST",
        headers: {
          Authorization: "Bearer fixture-service-only",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ notificationId: "fixture" }),
      }),
    );
    assert(response.status === 200, `worker answered ${response.status}`);
    await response.body?.cancel();
  } finally {
    restore();
  }
  same(seen.rejected, [], "no unrecognised outbound request");
  return seen;
}

/** Visible HTML text: tags removed, entities kept. */
const visibleText = (html: string): string =>
  html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");

async function save(name: string, content: string): Promise<void> {
  if (!RENDER_DIR) return;
  await Deno.mkdir(RENDER_DIR, { recursive: true });
  await Deno.writeTextFile(`${RENDER_DIR}/${name}`, content);
}

const world: World = { claims: [], redirect: "ok" };
const opts = { sanitizeOps: false, sanitizeResources: false };

Deno.test({
  ...opts,
  name:
    "J-01 the Going pass: claim button, date and calendar file, no QR PDF; text S4",
  fn: async () => {
    const seen = await run(world, [
      claim("rsvp_pass", "email", enriched),
      claim("rsvp_pass", "sms", enriched),
    ]);
    same(seen.emails.length, 1, "one pass email");
    const email = seen.emails[0];
    const attachments = email.attachments as Array<
      { filename: string; content: string }
    >;
    // Seth, 13 Nov: everything goes through the app. No QR PDF on the
    // enriched pass; the claim button and the calendar file carry it.
    same(
      attachments.map((a) => a.filename.split(".").at(-1)),
      ["ics"],
      "the calendar file only, no QR PDF",
    );
    assert(
      !attachments.some((a) => atob(a.content).startsWith("%PDF-")),
      "no PDF attachment on the enriched pass",
    );
    const html = String(email.html);
    assert(
      html.includes(`https://usemingla.com/c/${PASS_CODE}`),
      "the claim button",
    );
    assert(html.includes("Get my pass"), "the button label");
    assert(html.includes("Sun 29 Nov, 7:00 PM"), "the date and time line");
    assert(
      !/https?:\/\//.test(visibleText(html)),
      `raw URL in pass HTML: ${visibleText(html)}`,
    );
    same(
      email.reply_to ?? email.replyTo,
      "host@example.invalid",
      "replies to the host",
    );
    same(
      seen.texts,
      [`Mingla: You RSVP'd to Sunday Sessions, Sun 29 Nov. Here's your pass: usemingla.com/c/${PASS_CODE} Reply STOP to opt out.`],
      "the Going pass text",
    );
    same(seen.finishes.map((f) => f.p_status), ["sent", "sent"], "both sent");
    await save("pass.email.html", html);
    await save("pass.email.txt", String(email.text));
    await save("pass.sms.txt", seen.texts[0]);
  },
});

Deno.test({
  ...opts,
  name: "J-02 a pass on a manual-mode event is the host's approval: S4A",
  fn: async () => {
    const seen = await run(world, [
      claim("rsvp_pass", "sms", { ...enriched, passReason: "approved" }),
    ]);
    same(
      seen.texts,
      [`Mingla: The host approved your RSVP to Sunday Sessions, Sun 29 Nov. Here's your pass: usemingla.com/c/${PASS_CODE} Reply STOP to opt out.`],
      "the approved pass text",
    );
    await save("approved.sms.txt", seen.texts[0]);
  },
});

Deno.test({
  ...opts,
  name:
    "J-03 a promoted guest with no QR: S4P, the email still goes with the calendar file only",
  fn: async () => {
    const promoted = {
      ...enriched,
      passReason: "spot_opened",
      qrCode: undefined,
    };
    const seen = await run(world, [
      claim("rsvp_waitlist_promoted", "email", promoted),
      claim("rsvp_waitlist_promoted", "sms", promoted),
    ]);
    same(
      seen.texts,
      [`Mingla: A spot opened at Sunday Sessions, Sun 29 Nov, so your RSVP is in. Here's your pass: usemingla.com/c/${PASS_CODE} Reply STOP to opt out.`],
      "the spot-opened text",
    );
    const attachments = seen.emails[0].attachments as Array<
      { filename: string }
    >;
    same(
      attachments.map((a) => a.filename.split(".").at(-1)),
      ["ics"],
      "calendar file only",
    );
    assert(
      !seen.logs.some((line) => line.includes("ada@example.invalid")),
      "the log names ids only",
    );
    same(seen.finishes.map((f) => f.p_status), ["sent", "sent"], "both sent");
    await save("spot-opened.sms.txt", seen.texts[0]);
    await save("spot-opened.email.html", String(seen.emails[0].html));
  },
});

Deno.test({
  ...opts,
  name:
    "J-04 Maybe: 'See the event' to host.usemingla.com, the app line, no raw URL in the visible HTML",
  fn: async () => {
    const maybe = { ...enriched, status: "maybe", approvalStatus: "approved" };
    const seen = await run(world, [
      claim("rsvp_acknowledgement", "email", maybe),
      claim("rsvp_acknowledgement", "sms", maybe),
    ]);
    const html = String(seen.emails[0].html);
    assert(
      html.includes(`href="${EVENT_URL}"`),
      "the button links the host event page",
    );
    assert(html.includes("See the event"), "the button label");
    assert(
      html.includes('href="https://usemingla.com/download"'),
      "the app link",
    );
    assert(html.includes("get the Mingla app"), "the app line, on words");
    assert(
      !/https?:\/\//.test(visibleText(html)),
      `raw URL in Maybe HTML: ${visibleText(html)}`,
    );
    same(
      seen.emails[0].subject,
      "We saved your Maybe: Sunday Sessions",
      "subject",
    );
    same(
      seen.texts,
      [`Mingla: Maybe saved: Sunday Sessions, Sun 29 Nov. Change it any time: usemingla.com/c/${EVENT_CODE} Reply STOP to opt out.`],
      "the Maybe text",
    );
    same(seen.mints.length, 1, "one short event link, for the text only");
    same(
      [
        seen.mints[0].p_subject_kind,
        seen.mints[0].p_subject_id,
        seen.mints[0].p_target_url,
      ],
      ["event_page", EVENT_ID, EVENT_URL],
      "the short link points at the event page",
    );
    assert(
      Date.parse(String(seen.mints[0].p_expires_at)) >=
        Date.parse("2026-12-29T22:00:00Z"),
      "the link lives until 30 days after the event ends",
    );
    await save("maybe.email.html", html);
    await save("maybe.email.txt", String(seen.emails[0].text));
    await save("maybe.sms.txt", seen.texts[0]);
  },
});

Deno.test({
  ...opts,
  name:
    "J-05 waitlisted, pending and can't go: one text each with the event link",
  fn: async () => {
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [
        { status: "waitlisted", approvalStatus: "approved" },
        `Mingla: Waitlisted: Sunday Sessions, Sun 29 Nov. We'll text you if a spot opens: usemingla.com/c/${EVENT_CODE} Reply STOP to opt out.`,
        "waitlisted",
      ],
      [
        { status: "going", approvalStatus: "pending" },
        `Mingla: Request sent for Sunday Sessions, Sun 29 Nov. We'll text you when the host says yes: usemingla.com/c/${EVENT_CODE} Reply STOP to opt out.`,
        "pending",
      ],
      [
        { status: "not_going", approvalStatus: "approved" },
        `Mingla: Got it, you can't go to Sunday Sessions, Sun 29 Nov. See the event: usemingla.com/c/${EVENT_CODE} Reply STOP to opt out.`,
        "not-going",
      ],
    ];
    for (const [state, expected, name] of cases) {
      const seen = await run(world, [
        claim("rsvp_acknowledgement", "email", { ...enriched, ...state }),
        claim("rsvp_acknowledgement", "sms", { ...enriched, ...state }),
      ]);
      same(seen.texts, [expected], `${name} text`);
      const html = String(seen.emails[0].html);
      assert(
        html.includes("See the event") && html.includes(`href="${EVENT_URL}"`),
        `${name} email button`,
      );
      assert(
        !html.includes("get the Mingla app"),
        `${name}: the app line is Maybe only`,
      );
      assert(
        !/https?:\/\//.test(visibleText(html)),
        `${name}: raw URL in visible HTML`,
      );
      await save(`${name}.sms.txt`, seen.texts[0]);
      await save(`${name}.email.html`, html);
    }
  },
});

Deno.test({
  ...opts,
  name:
    "J-06 the short link cannot be minted: the full page link, then the no-link text when that overflows",
  fn: async () => {
    const maybe = { ...enriched, status: "maybe", approvalStatus: "approved" };
    const short = await run(world, [
      claim("rsvp_acknowledgement", "sms", maybe),
    ], "fail");
    assert(
      short.texts[0].includes(
        "host.usemingla.com/e/lagos-rooftop/sunday-sessions",
      ) &&
        !short.texts[0].includes("https://"),
      `fallback shows the page link without the scheme: ${short.texts[0]}`,
    );
    const longUrl = `https://host.usemingla.com/e/${"b".repeat(60)}/${
      "s".repeat(60)
    }`;
    const long = await run(
      world,
      [claim("rsvp_acknowledgement", "sms", { ...maybe, eventUrl: longUrl })],
      "fail",
    );
    same(
      long.texts,
      ["Mingla: Maybe saved: Sunday Sessions, Sun 29 Nov. Check your email for the event link. Reply STOP to opt out."],
      "the no-link variant",
    );
    assert(
      long.logs.some((line) => line.includes("rsvp_sms_link_omitted")),
      "the omitted link is logged",
    );
    same(long.finishes.map((f) => f.p_status), ["sent"], "still sent");
  },
});

Deno.test({
  ...opts,
  name:
    "J-07 a legacy pass row (no enrichment): Mingla: sender, no Connect line in either channel",
  fn: async () => {
    const legacy = {
      rsvpId: RSVP_ID,
      entityId: RSVP_ID,
      role: "primary",
      recipientEmail: "ada@example.invalid",
      recipientPhone: "+15551234567",
      eventName: "Sunday Sessions",
      brandName: "Lagos Rooftop",
      qrCode: "mingla-rsvp:4422-legacy",
    };
    const seen = await run(world, [
      claim("rsvp_pass", "email", legacy),
      claim("rsvp_pass", "sms", legacy),
    ]);
    assert(
      seen.texts[0].startsWith(
        "Mingla: Your RSVP for Sunday Sessions is confirmed.",
      ),
      seen.texts[0],
    );
    const all = `${seen.texts[0]}\n${seen.emails[0].text}\n${
      seen.emails[0].html
    }`;
    assert(!all.includes("Connect"), "no Connect line");
    assert(!all.includes("/attendance/claim"), "no attendance link");
    const attachments = seen.emails[0].attachments as Array<
      { filename: string }
    >;
    same(
      attachments.map((a) => a.filename),
      ["rsvp-pass.pdf"],
      "the legacy PDF is kept",
    );
  },
});
