// #4339 §6 — implementor regression suite for the /schedule booking context:
// what the booker runs (ICP), their main social as a working profile link, and
// their website.
//
// Two layers:
//   1. bookingContext.ts, the pure validator and builders (zero imports);
//   2. the REAL booking handler in index.ts, with Google and Resend replaced by a
//      stubbed `fetch` that records every request. No network is used.
//
// Pins:
//   - a booking with no ICP, no social, a handle that is not valid for its
//     platform, or a URL from another platform's domain is a 400 and never
//     reaches Google;
//   - the handle: a leading @ is stripped, no spaces, platform characters only;
//     a pasted full profile URL is kept as typed;
//   - the profile URL is built per platform (instagram.com/<h>, tiktok.com/@<h>,
//     facebook.com/<h>, x.com/<h>, youtube.com/@<h>, linkedin.com/in/<h>);
//   - the social link and the website are the FIRST lines of the calendar
//     description, the #3601 description follows unchanged, and the event
//     carries the facts as private extended properties;
//   - the "New Mingla call" notification shows the social as a link and the
//     website at the top, and the ICP as a row;
//   - `source` attribution (#3601) still reaches the invite.
//
// Run: deno test --allow-read --allow-env supabase/functions/growth-tools-book/issue_4339_booking_context.implementor.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildBookingDescription,
  buildContextLines,
  ICP_VALUES,
  parseBookingContext,
  parseIcp,
  parseSocial,
  parseWebsite,
} from "./bookingContext.ts";
import { SCHEDULER_BASE_LINE } from "./bookingDetails.ts";

// The shared fixture table: the marketing page validates with the same table
// (mingla-marketing/lib/__tests__/issue-4339-schedule.implementor.test.mjs), so
// the browser and the server cannot drift apart.
const fixtures = JSON.parse(
  await Deno.readTextFile(
    new URL(
      "../../../mingla-marketing/lib/booking-social.fixtures.json",
      import.meta.url,
    ),
  ),
) as {
  valid: Array<[string, string, string]>;
  invalid: Array<[string, string]>;
};

// ── 1. The pure validator ────────────────────────────────────────────────────

Deno.test("#4339 the eight ICPs are the only accepted values", () => {
  assertEquals([...ICP_VALUES], [
    "events",
    "trips",
    "experiences",
    "restaurants",
    "hotels",
    "art",
    "play",
    "other",
  ]);
  for (const v of ICP_VALUES) assertEquals(parseIcp(v), v);
  assertEquals(parseIcp(" Hotels "), "hotels");
  for (
    const bad of ["", "venue", "__proto__", "constructor", null, 3, undefined]
  ) {
    assertEquals(parseIcp(bad), null, String(bad));
  }
});

Deno.test("#4339 every valid handle and pasted URL in the shared table builds its working profile link", () => {
  assert(fixtures.valid.length >= 14);
  for (const [platform, input, url] of fixtures.valid) {
    const social = parseSocial(platform, input);
    assert(
      social !== null,
      `${platform} ${JSON.stringify(input)} should be valid`,
    );
    assertEquals(social.url, url, `${platform} ${JSON.stringify(input)}`);
  }
});

Deno.test("#4339 every invalid handle in the shared table is refused", () => {
  assert(fixtures.invalid.length >= 12);
  for (const [platform, input] of fixtures.invalid) {
    assertEquals(
      parseSocial(platform, input),
      null,
      `${platform} ${JSON.stringify(input)}`,
    );
  }
});

Deno.test("#4339 a leading @ is stripped and the handle is shown with one @", () => {
  assertEquals(parseSocial("instagram", "@blue.note_bar"), {
    platform: "instagram",
    display: "@blue.note_bar",
    url: "https://instagram.com/blue.note_bar",
  });
  assertEquals(parseSocial("instagram", "@@double"), null);
});

Deno.test("#4339 a pasted profile URL is kept as typed, only from that platform's domain", () => {
  const typed = "https://www.instagram.com/bluenote/?igsh=abc";
  assertEquals(parseSocial("instagram", typed)?.url, typed);
  assertEquals(
    parseSocial("instagram", "instagram.com/bluenote")?.url,
    "https://instagram.com/bluenote",
  );
  assertEquals(
    parseSocial("tiktok", "https://www.instagram.com/bluenote"),
    null,
  );
  assertEquals(
    parseSocial("instagram", "https://instagram.com.evil.example/bluenote"),
    null,
  );
  assertEquals(
    parseSocial("instagram", "https://user:pw@instagram.com/bluenote"),
    null,
  );
  assertEquals(parseSocial("instagram", "javascript:alert(1)"), null);
  assertEquals(
    parseSocial("instagram", "https://instagram.com/"),
    null,
    "the front page is not a profile",
  );
});

Deno.test("#4339 the website is optional, but a real public address when given", () => {
  assertEquals(parseWebsite(undefined), { ok: true, url: null });
  assertEquals(parseWebsite(""), { ok: true, url: null });
  assertEquals(parseWebsite("bluenote.com"), {
    ok: true,
    url: "https://bluenote.com",
  });
  assertEquals(parseWebsite("https://bluenote.com/menu"), {
    ok: true,
    url: "https://bluenote.com/menu",
  });
  for (
    const bad of [
      "not a site",
      "javascript:alert(1)",
      "localhost",
      "https://1.2.3.4",
      42,
      "ftp://x.com",
    ]
  ) {
    assertEquals(parseWebsite(bad).ok, false, String(bad));
  }
});

Deno.test("#4339 the booking context names the first missing field", () => {
  assertEquals(parseBookingContext({}), { ok: false, field: "icp" });
  assertEquals(parseBookingContext({ icp: "events" }), {
    ok: false,
    field: "social",
  });
  assertEquals(
    parseBookingContext({
      icp: "events",
      social_platform: "instagram",
      social_handle: "has space",
    }),
    { ok: false, field: "social" },
  );
  assertEquals(
    parseBookingContext({
      icp: "events",
      social_platform: "instagram",
      social_handle: "ok",
      website: "no way",
    }),
    { ok: false, field: "website" },
  );
});

Deno.test("#4339 the social link and the website are the first lines, the #3601 description follows unchanged", () => {
  const parsed = parseBookingContext({
    icp: "restaurants",
    social_platform: "tiktok",
    social_handle: "@bluenote",
    website: "bluenote.com",
  });
  assert(parsed.ok && parsed.context.audience === "host");
  const lines = buildBookingDescription(
    parsed.context,
    `${SCHEDULER_BASE_LINE}\nCame from: x`,
  ).split("\n");
  assertEquals(lines[0], "Social: https://tiktok.com/@bluenote (TikTok)");
  assertEquals(lines[1], "Website: https://bluenote.com");
  assertEquals(lines[2], "Runs: A restaurant, café or diner");
  assertEquals(lines[3], SCHEDULER_BASE_LINE);
  assertEquals(
    buildContextLines({ ...parsed.context, website: null })[1],
    "Website: none given",
  );
});

// ── 2. The real handler, Google and Resend stubbed ───────────────────────────

Deno.env.set("GOOGLE_CALENDAR_KEYS", "client-id|client-secret|refresh-token");
Deno.env.set("RESEND_API_KEY", "re_test_key");
const { handler } = await import("./index.ts");

interface Recorded {
  url: string;
  body: string;
}

async function withStubbedFetch(
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
    const body = typeof init?.body === "string"
      ? init.body
      : init?.body
      ? String(init.body)
      : "";
    calls.push({ url, body });
    const ok = (payload: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
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
        htmlLink: "https://calendar.example/event",
        hangoutLink: "https://meet.example/abc",
      });
    }
    if (url.startsWith("https://api.resend.com/emails")) {
      return ok({ id: "email-1" });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

function bookingRequest(extra: Record<string, unknown>): Request {
  const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  start.setUTCMinutes(0, 0, 0);
  return new Request("https://fn.example/growth-tools-book", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "book",
      start: start.toISOString(),
      name: "Ada Lovelace",
      email: "ada@bluenote.com",
      source: "venue_grader",
      ...extra,
    }),
  });
}

const VALID = {
  icp: "restaurants",
  social_platform: "instagram",
  social_handle: "@bluenote",
  website: "bluenote.com",
  venue: "Blue Note",
};

Deno.test("#4339 the handler refuses a booking with no ICP, and never reaches the calendar", async () => {
  await withStubbedFetch(async (calls) => {
    const { icp: _icp, ...noIcp } = VALID;
    const res = await handler(bookingRequest(noIcp));
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error: "validation", field: "icp" });
    assert(
      !calls.some((c) => c.url.includes("/calendar/v3/")),
      "no calendar call for an invalid booking",
    );
  });
});

Deno.test("#4339 the handler refuses a booking with no social, or a handle the platform does not allow", async () => {
  await withStubbedFetch(async (calls) => {
    for (
      const bad of [{ social_handle: "" }, { social_platform: "myspace" }, {
        social_handle: "blue note",
      }, {
        social_platform: "x",
        social_handle: "this.handle.is.not.x",
      }]
    ) {
      const res = await handler(bookingRequest({ ...VALID, ...bad }));
      assertEquals(res.status, 400, JSON.stringify(bad));
      assertEquals((await res.json()).field, "social");
    }
    assert(!calls.some((c) => c.url.includes("/calendar/v3/")));
  });
});

Deno.test("#4339 a valid booking puts the social link and website at the top of the invite and saves them on the event", async () => {
  await withStubbedFetch(async (calls) => {
    const res = await handler(bookingRequest(VALID));
    assertEquals(res.status, 200);
    const insert = calls.find((c) => c.url.includes("/calendar/v3/calendars/"));
    assert(insert, "the event was created");
    const event = JSON.parse(insert.body) as {
      summary: string;
      description: string;
      extendedProperties: { private: Record<string, string> };
    };
    const lines = event.description.split("\n");
    assertEquals(
      lines[0],
      "Social: https://instagram.com/bluenote (Instagram)",
    );
    assertEquals(lines[1], "Website: https://bluenote.com");
    assertEquals(lines[2], "Runs: A restaurant, café or diner");
    assertEquals(lines[3], SCHEDULER_BASE_LINE);
    assertEquals(
      lines[4],
      "Came from: Venue Website Grader",
      "#3601 source attribution still reaches the invite",
    );
    assertEquals(event.summary, "Mingla call — Blue Note");
    assertEquals(event.extendedProperties.private, {
      mingla_icp: "restaurants",
      mingla_social_platform: "instagram",
      mingla_social_url: "https://instagram.com/bluenote",
      mingla_website: "https://bluenote.com",
      mingla_source: "venue_grader",
    });

    // The "New Mingla call" notification (the team's record of the lead).
    const emails = calls.filter((c) =>
      c.url.startsWith("https://api.resend.com/emails")
    ).map((c) => JSON.parse(c.body));
    const owner = emails.find((e) =>
      String(e.subject).startsWith("New Mingla call")
    );
    assert(owner, "the team notification was sent");
    assertStringIncludes(
      owner.html,
      '<a href="https://instagram.com/bluenote"',
    );
    assertStringIncludes(owner.html, "Instagram: @bluenote");
    assertStringIncludes(owner.html, '<a href="https://bluenote.com"');
    assertStringIncludes(owner.html, ">Runs</td>");
    assert(
      owner.html.indexOf("instagram.com/bluenote") <
        owner.html.indexOf(">When</td>"),
      "the social link comes first",
    );
    const text = String(owner.text).split("\n");
    assertEquals(text[2], "Social: https://instagram.com/bluenote (Instagram)");
    assertEquals(text[3], "Website: https://bluenote.com");
    // The booker's own confirmation does not echo their social back.
    const booker = emails.find((e) =>
      !String(e.subject).startsWith("New Mingla call")
    );
    assert(booker && !String(booker.html).includes("instagram.com/bluenote"));
  });
});

Deno.test("#4339 a pasted profile URL reaches the invite exactly as typed", async () => {
  await withStubbedFetch(async (calls) => {
    const typed = "https://www.linkedin.com/in/ada-lovelace/";
    const res = await handler(
      bookingRequest({
        ...VALID,
        social_platform: "linkedin",
        social_handle: typed,
        website: "",
      }),
    );
    assertEquals(res.status, 200);
    const insert = calls.find((c) => c.url.includes("/calendar/v3/calendars/"));
    const event = JSON.parse(insert!.body) as { description: string };
    assertEquals(
      event.description.split("\n")[0],
      `Social: ${typed} (LinkedIn)`,
    );
    assertEquals(event.description.split("\n")[1], "Website: none given");
  });
});
