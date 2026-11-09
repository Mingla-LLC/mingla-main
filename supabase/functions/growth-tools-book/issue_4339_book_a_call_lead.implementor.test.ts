// #4339 round A — implementor regression suite: every confirmed /schedule
// booking becomes an Inbound lead (public.book_call_leads → admin_inbound_leads
// source `book_a_call`).
//
// The REAL booking handler in index.ts runs with Google, Resend and PostgREST
// replaced by a stubbed `fetch` that records every request. No network.
//
// Pins:
//   - after the calendar event exists, ONE lead row is POSTed to
//     /rest/v1/book_call_leads?on_conflict=booking_key with the service role and
//     `Prefer: resolution=ignore-duplicates` (idempotent per calendar event id);
//   - the row carries the business (venue), the ICP, the social as a working
//     https profile link, the website, the call time and the source;
//   - a refused booking (validation, slot taken) writes no lead;
//   - a failed lead write (500, a thrown fetch, missing credentials) never
//     fails the booking: the guest still gets 200 {ok:true}, and the failure is
//     logged loudly with the booking key and without the email.
//
// Run: deno test --allow-read --allow-env supabase/functions/growth-tools-book/issue_4339_book_a_call_lead.implementor.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { bookingKey, buildBookingLead } from "./bookingLead.ts";
import { parseBookingContext } from "./bookingContext.ts";

Deno.env.set("GOOGLE_CALENDAR_KEYS", "client-id|client-secret|refresh-token");
Deno.env.set("RESEND_API_KEY", "re_test_key");
const { handler } = await import("./index.ts");

const SUPABASE = "https://stub-project.supabase.co";
const SERVICE = "service-role-test-key";

interface Recorded {
  url: string;
  body: string;
  headers: Headers;
  method: string;
}

type LeadMode = "ok" | "500" | "throw";

async function withStub(
  opts: { lead?: LeadMode; slotTaken?: boolean; eventId?: string | null },
  run: (calls: Recorded[], errors: string[]) => Promise<void>,
): Promise<void> {
  const calls: Recorded[] = [];
  const errors: string[] = [];
  const original = globalThis.fetch;
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
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
    calls.push({
      url,
      body,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
    });
    const ok = (payload: unknown, status = 200) =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return ok({ access_token: "stub-token" });
    }
    if (url.startsWith("https://www.googleapis.com/calendar/v3/freeBusy")) {
      return ok({
        calendars: {
          primary: {
            busy: opts.slotTaken
              ? [{ start: "2000-01-01T00:00:00Z", end: "2100-01-01T00:00:00Z" }]
              : [],
          },
        },
      });
    }
    if (url.includes("/calendar/v3/calendars/")) {
      return ok({
        ...(opts.eventId === null
          ? {}
          : { id: opts.eventId ?? "evt_4339_abc" }),
        htmlLink: "https://calendar.example/event",
        hangoutLink: "https://meet.example/abc",
      });
    }
    if (url.startsWith("https://api.resend.com/emails")) {
      return ok({ id: "email-1" });
    }
    if (url.startsWith(`${SUPABASE}/rest/v1/book_call_leads`)) {
      if (opts.lead === "throw") {
        return Promise.reject(new Error("network down"));
      }
      if (opts.lead === "500") {
        return Promise.resolve(
          new Response('{"message":"boom"}', { status: 500 }),
        );
      }
      return Promise.resolve(new Response(null, { status: 201 }));
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  try {
    await run(calls, errors);
  } finally {
    globalThis.fetch = original;
    console.error = originalError;
  }
}

const START = (() => {
  const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  start.setUTCMinutes(0, 0, 0);
  return start.toISOString();
})();

function bookingRequest(extra: Record<string, unknown> = {}): Request {
  return new Request("https://fn.example/growth-tools-book", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "book",
      start: START,
      name: "Ada Lovelace",
      email: "ada@bluenote.com",
      source: "venue_grader",
      icp: "restaurants",
      social_platform: "instagram",
      social_handle: "@bluenote",
      website: "bluenote.com",
      venue: "Blue Note",
      ...extra,
    }),
  });
}

const leadCalls = (calls: Recorded[]) =>
  calls.filter((c) => c.url.startsWith(`${SUPABASE}/rest/v1/book_call_leads`));

function withCredentials(on: boolean): void {
  if (on) {
    Deno.env.set("SUPABASE_URL", SUPABASE);
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE);
  } else {
    Deno.env.delete("SUPABASE_URL");
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
}

Deno.test("#4339 A a confirmed booking writes ONE Inbound lead, idempotent on the calendar event id", async () => {
  withCredentials(true);
  await withStub({ lead: "ok" }, async (calls) => {
    const res = await handler(bookingRequest());
    assertEquals(res.status, 200);
    assertEquals((await res.json()).ok, true);
    const writes = leadCalls(calls);
    assertEquals(writes.length, 1, "one lead write per booking");
    const [w] = writes;
    assertEquals(w.method, "POST");
    assertEquals(
      w.url,
      `${SUPABASE}/rest/v1/book_call_leads?on_conflict=booking_key`,
    );
    assertEquals(w.headers.get("Authorization"), `Bearer ${SERVICE}`);
    assertEquals(w.headers.get("apikey"), SERVICE);
    assertEquals(
      w.headers.get("Prefer"),
      "resolution=ignore-duplicates,return=minimal",
    );
    const eventIndex = calls.findIndex((c) =>
      c.url.includes("/calendar/v3/calendars/")
    );
    assert(
      calls.indexOf(w) > eventIndex,
      "the lead is written after the calendar event exists",
    );
    // #4339 calls: a Host booking is audience host with no program fields;
    // the Meet and calendar links and the booker's zone ride along.
    assertEquals(JSON.parse(w.body), {
      booking_key: "gcal:evt_4339_abc",
      calendar_event_id: "evt_4339_abc",
      audience: "host",
      name: "Ada Lovelace",
      email: "ada@bluenote.com",
      venue: "Blue Note",
      icp: "restaurants",
      city: null,
      creator_makes: null,
      work_url: null,
      first_place: null,
      social_platform: "instagram",
      social_handle: "@bluenote",
      social_url: "https://instagram.com/bluenote",
      website: "https://bluenote.com",
      call_at: START,
      booker_time_zone: null,
      meet_url: "https://meet.example/abc",
      event_url: "https://calendar.example/event",
      source: "venue_grader",
    });
  });
});

Deno.test("#4339 A a refused booking writes no lead", async () => {
  withCredentials(true);
  await withStub({ lead: "ok" }, async (calls) => {
    const noSocial = await handler(bookingRequest({ social_handle: "" }));
    assertEquals(noSocial.status, 400);
    assertEquals(leadCalls(calls).length, 0, "validation failure: no lead");
  });
  await withStub({ lead: "ok", slotTaken: true }, async (calls) => {
    const taken = await handler(bookingRequest());
    assertEquals(taken.status, 409);
    assertEquals(leadCalls(calls).length, 0, "slot taken: no lead");
  });
});

Deno.test("#4339 A a failed lead write never fails the booking, and is logged loudly without the email", async () => {
  for (const mode of ["500", "throw"] as const) {
    withCredentials(true);
    await withStub({ lead: mode }, async (calls, errors) => {
      const res = await handler(bookingRequest());
      assertEquals(res.status, 200, `lead ${mode}: the booking still succeeds`);
      assertEquals((await res.json()).ok, true);
      assertEquals(leadCalls(calls).length, 1);
      assert(
        calls.some((c) => c.url.startsWith("https://api.resend.com/emails")),
        `lead ${mode}: the emails still go`,
      );
      const loud = errors.filter((e) => e.includes("LEAD WRITE FAILED"));
      assertEquals(loud.length, 1, `lead ${mode}: one loud log line`);
      assert(
        loud[0].includes("gcal:evt_4339_abc"),
        "the log names the booking",
      );
      assert(!loud[0].includes("ada@bluenote.com"), "the log holds no email");
    });
  }
  withCredentials(false);
  await withStub({ lead: "ok" }, async (calls, errors) => {
    const res = await handler(bookingRequest());
    assertEquals(res.status, 200, "no credentials: the booking still succeeds");
    assertEquals(leadCalls(calls).length, 0);
    assert(
      errors.some((e) =>
        e.includes("LEAD WRITE FAILED") && e.includes("not set")
      ),
      "missing credentials are logged loudly",
    );
  });
});

Deno.test("#4339 A the key: the calendar event id, else the slot and a hash of the email (never the email)", () => {
  assertEquals(bookingKey("evt1", 0, "a@b.co"), "gcal:evt1");
  const slot = bookingKey(null, Date.parse(START), "Ada@BlueNote.com");
  assert(slot.startsWith(`slot:${START}:`));
  assert(!slot.includes("@"), "no email in the key");
  assertEquals(
    slot,
    bookingKey("  ", Date.parse(START), "ada@bluenote.com"),
    "the same booking, the same key",
  );
  // A pasted http profile link is stored as https (the table only takes https).
  const parsed = parseBookingContext({
    icp: "art",
    social_platform: "instagram",
    social_handle: "http://instagram.com/gallery",
    website: "",
  });
  assert(parsed.ok);
  const row = buildBookingLead({
    eventId: null,
    startMs: Date.parse(START),
    name: "Grace",
    email: "g@x.co",
    venue: " ",
    source: "",
    context: parsed.context,
  });
  assertEquals(row.social_url, "https://instagram.com/gallery");
  assertEquals(row.venue, null);
  assertEquals(row.source, null);
  assertEquals(row.website, null);
});
