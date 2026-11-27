// #4571 W4 — implementor regression suite: a booking made from a host card's
// own scheduler link (usemingla.com/schedule?for=<token>) links itself.
//
// The REAL booking handler in index.ts runs with Google, Resend and PostgREST
// replaced by a stubbed `fetch` that records every request. No network.
//
// Pins:
//   F-1 a UUID `for` is passed to crm_demo_link_from_token with the service
//       role, after the booking row is written, with the booking key;
//   F-2 a `for` that is not a UUID (or is absent, or rides a Creators call) is
//       ignored: no link call, the booking books;
//   F-3 a link call that fails (500, a thrown fetch) or answers false never
//       fails the booking: 200 {ok:true}; the failure is logged with the
//       booking key only, never the email or the token;
//   F-4 a failed booking row write makes no link call (nothing to link yet).
//   F-5 (#4571 rework) a link call that hangs is abandoned after its short
//       timeout: "failed", logged, and the booking answer never waits on it.
//
// FAILS-ON-REVERT: without parseScheduleToken / linkDemoFromToken in
// bookingLead.ts and their call in index.ts, F-1 finds no link call.
//
// Run: deno test --allow-read --allow-env supabase/functions/growth-tools-book/issue_4571_for_token.implementor.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { linkDemoFromToken, parseScheduleToken } from "./bookingLead.ts";

Deno.env.set("GOOGLE_CALENDAR_KEYS", "client-id|client-secret|refresh-token");
Deno.env.set("RESEND_API_KEY", "re_test_key");
Deno.env.set("SUPABASE_URL", "https://stub-project.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
const { handler } = await import("./index.ts");

const SUPABASE = "https://stub-project.supabase.co";
const SERVICE = "service-role-test-key";
const TOKEN = "45710000-0000-4000-8000-000000000001";

interface Recorded {
  url: string;
  body: string;
  headers: Headers;
  method: string;
}

type LinkMode = "true" | "false" | "500" | "throw";

async function withStub(
  opts: { link?: LinkMode; lead?: "ok" | "500" },
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
    const body = typeof init?.body === "string" ? init.body : "";
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
      return ok({ calendars: { primary: { busy: [] } } });
    }
    if (url.includes("/calendar/v3/calendars/")) {
      return ok({
        id: "evt_4571_for",
        htmlLink: "https://calendar.example/event",
        hangoutLink: "https://meet.example/abc",
      });
    }
    if (url.startsWith("https://api.resend.com/emails")) {
      return ok({ id: "email-1" });
    }
    if (url.startsWith(`${SUPABASE}/rest/v1/rpc/crm_demo_link_from_token`)) {
      if (opts.link === "throw") {
        return Promise.reject(new Error("network down"));
      }
      if (opts.link === "500") {
        return Promise.resolve(
          new Response('{"message":"boom"}', { status: 500 }),
        );
      }
      return ok(opts.link === "false" ? false : true);
    }
    if (
      url.startsWith(`${SUPABASE}/rest/v1/book_call_leads`) &&
      (init?.method ?? "GET") === "POST"
    ) {
      if (opts.lead === "500") {
        return Promise.resolve(
          new Response('{"message":"boom"}', { status: 500 }),
        );
      }
      return Promise.resolve(new Response(null, { status: 201 }));
    }
    if (url.startsWith(`${SUPABASE}/`)) return ok([]);
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
      phone: "+2348012345678",
      source: "direct",
      icp: "restaurants",
      social_platform: "instagram",
      social_handle: "@bluenote",
      venue: "Blue Note",
      ...extra,
    }),
  });
}

const linkCalls = (calls: Recorded[]) =>
  calls.filter((c) => c.url.includes("/rest/v1/rpc/crm_demo_link_from_token"));

Deno.test("#4571 W4 parseScheduleToken keeps a UUID and drops anything else", () => {
  assertEquals(parseScheduleToken(TOKEN), TOKEN);
  assertEquals(parseScheduleToken(` ${TOKEN.toUpperCase()} `), TOKEN);
  for (
    const bad of [
      undefined,
      null,
      42,
      "",
      "not-a-token",
      `${TOKEN}x`,
      "'; drop table x; --",
      { id: TOKEN },
    ]
  ) {
    assertEquals(parseScheduleToken(bad), null, String(bad));
  }
});

Deno.test("#4571 W4 F-1 a UUID for links the booking with the service role, after the row is written", async () => {
  await withStub({ link: "true" }, async (calls) => {
    const res = await handler(bookingRequest({ for: TOKEN }));
    assertEquals(res.status, 200);
    assertEquals((await res.json()).ok, true);
    const links = linkCalls(calls);
    assertEquals(links.length, 1, "one link call");
    const [l] = links;
    assertEquals(l.method, "POST");
    assertEquals(l.headers.get("Authorization"), `Bearer ${SERVICE}`);
    assertEquals(l.headers.get("apikey"), SERVICE);
    assertEquals(JSON.parse(l.body), {
      p_booking_key: "gcal:evt_4571_for",
      p_token: TOKEN,
    });
    const write = calls.findIndex((c) =>
      c.url.startsWith(`${SUPABASE}/rest/v1/book_call_leads`) &&
      c.method === "POST"
    );
    assert(
      write >= 0 && calls.indexOf(l) > write,
      "the link is made after the booking row exists",
    );
  });
});

Deno.test("#4571 W4 F-2 a for that is not a UUID, or none, or on a Creators call, is ignored and the booking books", async () => {
  for (const extra of [{ for: "not-a-token" }, {}, { for: 12 }]) {
    await withStub({ link: "true" }, async (calls) => {
      const res = await handler(bookingRequest(extra));
      assertEquals(res.status, 200, JSON.stringify(extra));
      assertEquals(linkCalls(calls).length, 0, JSON.stringify(extra));
    });
  }
  await withStub({ link: "true" }, async (calls) => {
    const res = await handler(bookingRequest({
      for: TOKEN,
      audience: "creator",
      city: "Lagos",
      makes: "video",
      phone: "+2348012345678",
      icp: undefined,
      venue: undefined,
    }));
    assertEquals(res.status, 200);
    assertEquals(
      linkCalls(calls).length,
      0,
      "a Creators call never links to a host card",
    );
  });
});

Deno.test("#4571 W4 F-3 a failed or refused link never fails the booking, and logs no email or token", async () => {
  for (const link of ["500", "throw", "false"] as LinkMode[]) {
    await withStub({ link }, async (calls, errors) => {
      const res = await handler(bookingRequest({ for: TOKEN }));
      assertEquals(res.status, 200, link);
      assertEquals((await res.json()).ok, true, link);
      assertEquals(linkCalls(calls).length, 1, link);
      const logged = errors.filter((e) => e.includes("DEMO LINK FAILED"));
      if (link === "false") {
        assertEquals(
          logged.length,
          0,
          "a token that matches no card is not an error",
        );
      } else {
        assertEquals(logged.length, 1, link);
        assert(
          logged[0].includes("gcal:evt_4571_for"),
          "the booking key is logged",
        );
        assert(
          !logged[0].includes("ada@bluenote.com") && !logged[0].includes(TOKEN),
          "never the email or the token",
        );
      }
    });
  }
});

Deno.test("#4571 W4 F-4 no link call when the booking row could not be written", async () => {
  await withStub({ link: "true", lead: "500" }, async (calls) => {
    const res = await handler(bookingRequest({ for: TOKEN }));
    assertEquals(res.status, 200);
    assertEquals(linkCalls(calls).length, 0);
  });
});

Deno.test("#4571 rework F-5 a link call that hangs is abandoned after its timeout", async () => {
  const original = globalThis.fetch;
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  // A server that never answers: only the abort signal ends the request.
  globalThis.fetch =
    ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return; // no signal: hangs for ever (the guard below fails the test)
        signal.addEventListener("abort", () => reject(signal.reason));
      })) as typeof fetch;
  try {
    const started = Date.now();
    let guard: number | undefined;
    const result = await Promise.race([
      linkDemoFromToken("slot:hang", TOKEN, {
        supabaseUrl: SUPABASE,
        serviceKey: SERVICE,
      }, 50),
      new Promise<string>((resolve) => {
        guard = setTimeout(() => resolve("still waiting after 2 s"), 2000);
      }),
    ]);
    clearTimeout(guard);
    const took = Date.now() - started;
    assertEquals(result, "failed");
    assert(took < 2000, `the link call gave up in ${took} ms`);
    assert(
      errors.some((e) => String(e[0]).includes("DEMO LINK FAILED")),
      "the abandoned link is logged",
    );
    assert(
      !errors.flat().some((x) => String(x).includes(TOKEN)),
      "the token is never logged",
    );
  } finally {
    globalThis.fetch = original;
    console.error = originalError;
  }
});
