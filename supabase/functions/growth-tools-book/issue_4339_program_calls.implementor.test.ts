// #4339 Creators and Locals calls (Seth approved, 9 Nov) — implementor
// regression suite for `audience` on growth-tools-book.
//
// Two layers:
//   1. bookingContext.ts: per-audience validation against the shared fixture
//      table (mingla-marketing/lib/booking-social.fixtures.json `audiences`,
//      also asserted by the marketing page test);
//   2. the REAL handler in index.ts with Google, Resend and PostgREST replaced
//      by a stubbed `fetch` that records every request. No network.
//
// Pins:
//   - host stays the default and is unchanged (title "Mingla call — <venue>");
//   - creator needs city, social and makes ∈ {video, photo, both}, work_url
//     optional; local needs city and social, first_place optional; an unknown
//     audience is refused; a refused booking never reaches the calendar;
//   - the invite is titled "Mingla Creators call: <name>" / "Mingla Locals
//     call: <name>" and lists the city, what they make or their first place,
//     and the social as a working URL;
//   - RECIPIENTS ARE IDENTICAL FOR EVERY AUDIENCE: the same calendar, guests
//     = booker + info@, the "New Mingla call" email to BOOKING_NOTIFY_TO +
//     info@ (naming the audience), and the booker's confirmation;
//   - the lead row carries the audience, its fields and the booker's zone.
//
// FAILS-ON-REVERT: dropping the creator `makes` check fails the fixture and
// handler tests; titling every call "Mingla call" fails the title test;
// sending program calls to a different guest list fails the recipients test.
//
// Run: deno test --allow-read --allow-env supabase/functions/growth-tools-book/issue_4339_program_calls.implementor.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildContextLines,
  buildEventSummary,
  parseBookingContext,
  parseTimeZone,
} from "./bookingContext.ts";

const fixtures = JSON.parse(
  await Deno.readTextFile(
    new URL(
      "../../../mingla-marketing/lib/booking-social.fixtures.json",
      import.meta.url,
    ),
  ),
) as { audiences: Array<[string, Record<string, unknown>, string | null]> };

// ── 1. The validator ─────────────────────────────────────────────────────────

Deno.test("#4339 calls: every audience row in the shared table is accepted or refused on the same field", () => {
  assert(fixtures.audiences.length >= 16);
  for (const [audience, body, field] of fixtures.audiences) {
    const parsed = parseBookingContext({ audience, ...body });
    if (field === null) {
      assert(parsed.ok, `${audience} ${JSON.stringify(body)} should pass`);
      assertEquals(parsed.context.audience, audience);
    } else {
      assertEquals(
        parsed as unknown,
        { ok: false, field },
        JSON.stringify(body),
      );
    }
  }
});

Deno.test("#4339 calls: host is the default and an unknown audience is refused", () => {
  const host = parseBookingContext({
    icp: "events",
    social_platform: "instagram",
    social_handle: "bluenote",
  });
  assert(host.ok && host.context.audience === "host");
  assertEquals(
    parseBookingContext({ audience: "host", icp: "events" }),
    { ok: false, field: "social" },
  );
  assertEquals(parseBookingContext({ audience: "promoter" }), {
    ok: false,
    field: "audience",
  });
  assertEquals(parseBookingContext({ audience: 7 }), {
    ok: false,
    field: "audience",
  });
  // A creator never needs an ICP; a host always does.
  assertEquals(
    parseBookingContext({
      audience: "creator",
      city: "Lagos",
      social_platform: "tiktok",
      social_handle: "@ada",
      makes: "photo",
    }).ok,
    true,
  );
  assertEquals(parseBookingContext({ audience: "host", city: "Lagos" }), {
    ok: false,
    field: "icp",
  });
});

Deno.test("#4339 calls: the title and the invite lines name the audience and its facts", () => {
  const creator = parseBookingContext({
    audience: "creator",
    city: "Lagos",
    social_platform: "tiktok",
    social_handle: "@adashoots",
    makes: "both",
    work_url: "adashoots.com/reel",
  });
  assert(creator.ok);
  assertEquals(
    buildEventSummary(creator.context, "Ada Okafor", ""),
    "Mingla Creators call: Ada Okafor",
  );
  assertEquals(buildContextLines(creator.context), [
    "Social: https://tiktok.com/@adashoots (TikTok)",
    "City: Lagos",
    "Makes: Video and photos",
    "Best work: https://adashoots.com/reel",
  ]);
  const local = parseBookingContext({
    audience: "local",
    city: "Raleigh",
    social_platform: "instagram",
    social_handle: "tobieats",
    first_place: "  Bida   Manda ",
  });
  assert(local.ok);
  assertEquals(
    buildEventSummary(local.context, "Tobi Adeyemi", "ignored"),
    "Mingla Locals call: Tobi Adeyemi",
  );
  assertEquals(buildContextLines(local.context), [
    "Social: https://instagram.com/tobieats (Instagram)",
    "City: Raleigh",
    "First place: Bida Manda",
  ]);
  const host = parseBookingContext({
    icp: "events",
    social_platform: "x",
    social_handle: "bluenote",
  });
  assert(host.ok);
  assertEquals(
    buildEventSummary(host.context, "Ada", "Blue Note"),
    "Mingla call — Blue Note",
  );
  assertEquals(buildEventSummary(host.context, "Ada", ""), "Mingla call");
});

Deno.test("#4339 calls: the booker's time zone is kept only when real", () => {
  assertEquals(parseTimeZone("Africa/Lagos"), "Africa/Lagos");
  assertEquals(parseTimeZone("America/Los_Angeles"), "America/Los_Angeles");
  assertEquals(parseTimeZone("Mars/Olympus"), null);
  assertEquals(parseTimeZone("x\nInjected: line"), null);
  assertEquals(parseTimeZone(42), null);
  assertEquals(parseTimeZone(undefined), null);
});

// ── 2. The real handler ──────────────────────────────────────────────────────

Deno.env.set("GOOGLE_CALENDAR_KEYS", "client-id|client-secret|refresh-token");
Deno.env.set("RESEND_API_KEY", "re_test_key");
Deno.env.set("SUPABASE_URL", "https://stub-project.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
const { handler } = await import("./index.ts");

interface Recorded {
  url: string;
  body: string;
}

async function withStub(
  run: (calls: Recorded[]) => Promise<void>,
): Promise<void> {
  const calls: Recorded[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    calls.push({ url, body: typeof init?.body === "string" ? init.body : "" });
    const ok = (payload: unknown, status = 200) =>
      Promise.resolve(
        new Response(payload === null ? null : JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return ok({ access_token: "stub-token" });
    }
    if (url.startsWith("https://www.googleapis.com/calendar/v3/freeBusy")) {
      return ok({ calendars: { primary: { busy: [] } } });
    }
    if (url.includes("/calendar/v3/calendars/")) {
      return ok({
        id: "evt_calls",
        htmlLink: "https://calendar.google.com/event?eid=calls",
        hangoutLink: "https://meet.google.com/abc-defg-hij",
      });
    }
    if (url.startsWith("https://api.resend.com/emails")) {
      return ok({ id: "email-1" });
    }
    if (url.includes("/rest/v1/book_call_leads")) return ok(null, 201);
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const START = (() => {
  const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  start.setUTCMinutes(0, 0, 0);
  return start.toISOString();
})();

function request(fields: Record<string, unknown>): Request {
  return new Request("https://fn.example/growth-tools-book", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "book",
      start: START,
      name: "Ada Okafor",
      email: "ada@hey.com",
      source: "direct",
      ...fields,
    }),
  });
}

const HOST = {
  icp: "restaurants",
  social_platform: "instagram",
  social_handle: "@bluenote",
  website: "bluenote.com",
  venue: "Blue Note",
};
const CREATOR = {
  audience: "creator",
  city: "Lagos",
  social_platform: "tiktok",
  social_handle: "@adashoots",
  makes: "video",
  work_url: "https://www.tiktok.com/@adashoots/video/1",
  time_zone: "Africa/Lagos",
};
const LOCAL = {
  audience: "local",
  city: "Raleigh",
  social_platform: "instagram",
  social_handle: "@tobieats",
  first_place: "Bida Manda",
  time_zone: "America/New_York",
  // Host-only fields are ignored on a program call.
  venue: "Not a venue",
  report_url: "https://example.com/report",
};

interface Booked {
  status: number;
  event: {
    summary: string;
    description: string;
    attendees: Array<{ email: string }>;
    extendedProperties: { private: Record<string, string> };
  };
  calendarUrl: string;
  emails: Array<{ to: string[]; subject: string; html: string; text: string }>;
  lead: Record<string, unknown>;
}

async function book(fields: Record<string, unknown>): Promise<Booked> {
  let booked: Booked | null = null;
  await withStub(async (calls) => {
    const res = await handler(request(fields));
    const insert = calls.find((c) =>
      c.url.includes("/calendar/v3/calendars/")
    )!;
    booked = {
      status: res.status,
      event: JSON.parse(insert.body),
      calendarUrl: insert.url,
      emails: calls.filter((c) =>
        c.url.startsWith("https://api.resend.com/emails")
      ).map((c) => JSON.parse(c.body)),
      lead: JSON.parse(
        calls.find((c) => c.url.includes("/rest/v1/book_call_leads"))!.body,
      ),
    };
  });
  return booked!;
}

Deno.test("#4339 calls: a Creators call is titled for creators and lists city, what they make and the social link", async () => {
  const b = await book(CREATOR);
  assertEquals(b.status, 200);
  assertEquals(b.event.summary, "Mingla Creators call: Ada Okafor");
  const lines = b.event.description.split("\n");
  assertEquals(lines[0], "Social: https://tiktok.com/@adashoots (TikTok)");
  assertEquals(lines[1], "City: Lagos");
  assertEquals(lines[2], "Makes: Video");
  assertEquals(
    lines[3],
    "Best work: https://www.tiktok.com/@adashoots/video/1",
  );
  assertEquals(b.event.extendedProperties.private.mingla_audience, "creator");
  const owner = b.emails.find((e) => e.subject.startsWith("New Mingla call"))!;
  assertStringIncludes(owner.subject, "Creator call: Ada Okafor");
  assertStringIncludes(owner.html, "New Creator call booked");
  assertStringIncludes(owner.html, '<a href="https://tiktok.com/@adashoots"');
  assertStringIncludes(owner.html, ">Makes</td>");
  assertStringIncludes(owner.html, ">Their time</td>");
  assertEquals(b.lead.audience, "creator");
  assertEquals(b.lead.city, "Lagos");
  assertEquals(b.lead.creator_makes, "video");
  assertEquals(b.lead.work_url, "https://www.tiktok.com/@adashoots/video/1");
  assertEquals(b.lead.icp, null);
  assertEquals(b.lead.venue, null);
  assertEquals(b.lead.booker_time_zone, "Africa/Lagos");
  assertEquals(b.lead.meet_url, "https://meet.google.com/abc-defg-hij");
});

Deno.test("#4339 calls: a Locals call is titled for locals and lists city and first place; host-only fields are dropped", async () => {
  const b = await book(LOCAL);
  assertEquals(b.status, 200);
  assertEquals(b.event.summary, "Mingla Locals call: Ada Okafor");
  const lines = b.event.description.split("\n");
  assertEquals(lines[0], "Social: https://instagram.com/tobieats (Instagram)");
  assertEquals(lines[1], "City: Raleigh");
  assertEquals(lines[2], "First place: Bida Manda");
  assert(!b.event.description.includes("Not a venue"), "no venue line");
  assert(!b.event.description.includes("example.com/report"), "no report");
  const owner = b.emails.find((e) => e.subject.startsWith("New Mingla call"))!;
  assertStringIncludes(owner.subject, "Local call: Ada Okafor");
  assertStringIncludes(owner.text, "First place: Bida Manda");
  assertEquals(b.lead.audience, "local");
  assertEquals(b.lead.first_place, "Bida Manda");
  assertEquals(b.lead.venue, null);
  assertEquals(b.lead.creator_makes, null);
});

Deno.test("#4339 calls: a Host call keeps its title", async () => {
  const b = await book(HOST);
  assertEquals(b.status, 200);
  assertEquals(b.event.summary, "Mingla call — Blue Note");
  assertEquals(b.lead.audience, "host");
  assertEquals(
    b.emails.find((e) => e.subject.startsWith("New Mingla call"))!.subject
      .startsWith("New Mingla call — Blue Note ("),
    true,
  );
});

Deno.test("#4339 calls: recipients are identical for Host, Creator and Local calls", async () => {
  const shape = (b: Booked) => ({
    calendar: b.calendarUrl.split("?")[0],
    sendUpdates: new URL(b.calendarUrl).searchParams.get("sendUpdates"),
    guests: b.event.attendees.map((a) => a.email),
    notify: b.emails.find((e) => e.subject.startsWith("New Mingla call"))!.to,
    booker: b.emails.find((e) => !e.subject.startsWith("New Mingla call"))!.to,
    bookerSubject:
      b.emails.find((e) => !e.subject.startsWith("New Mingla call"))!.subject,
    count: b.emails.length,
  });
  const host = shape(await book(HOST));
  const creator = shape(await book(CREATOR));
  const local = shape(await book(LOCAL));
  assertEquals(host.guests, ["ada@hey.com", "info@usemingla.com"]);
  assertEquals(host.notify, ["seth@usemingla.com", "info@usemingla.com"]);
  assertEquals(host.booker, ["ada@hey.com"]);
  assertEquals(host.count, 2);
  assertEquals(creator, host, "a Creators call goes to the same people");
  assertEquals(local, host, "a Locals call goes to the same people");
});

Deno.test("#4339 calls: a refused program booking never reaches the calendar and writes no lead", async () => {
  await withStub(async (calls) => {
    for (
      const [bad, field] of [
        [{ ...CREATOR, makes: "audio" }, "makes"],
        [{ ...CREATOR, city: "" }, "city"],
        [{ ...LOCAL, social_handle: "" }, "social"],
        [{ ...CREATOR, audience: "promoter" }, "audience"],
      ] as const
    ) {
      const res = await handler(request(bad));
      assertEquals(res.status, 400);
      assertEquals(await res.json(), { error: "validation", field });
    }
    assert(!calls.some((c) => c.url.includes("/calendar/v3/calendars/")));
    assert(!calls.some((c) => c.url.includes("/rest/v1/book_call_leads")));
  });
});
