// #4490 P5 — venue-offers by the hour: the public day line, and a quote by
// start + length (the booking window is made first, then quoted).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createVenueOffersHandler,
  resetVenueOffersRateLimitForTests,
  type ServiceClient,
} from "./index.ts";

const OFFER = "00000000-4490-4000-8000-0000000000a5";
const WINDOW = "00000000-4490-4000-8000-0000000000b5";
const ANON = `x.${btoa(JSON.stringify({ role: "anon" })).replace(/=+$/, "")}.y`;
const CART = "c".repeat(40);

type Call = { name: string; params: Record<string, unknown> };

function fake(
  calls: Call[],
  result: (name: string) => { data: unknown; error: unknown },
): () => ServiceClient {
  return () => ({
    rpc: (name, params) => {
      calls.push({ name, params });
      return Promise.resolve(
        result(name) as { data: unknown; error: null },
      );
    },
    from: () => ({}),
    auth: {
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
    },
  });
}

function post(body: Record<string, unknown>): Request {
  return new Request("http://local/venue-offers", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ANON}`,
    },
    body: JSON.stringify(body),
  });
}

Deno.test("hour_day reads the day line with no identity", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({
    client: fake(
      calls,
      () => ({ data: { status: "open", starts: [] }, error: null }),
    ),
  });
  const res = await handle(
    post({
      action: "hour_day",
      offeringId: OFFER,
      date: "2026-11-21",
      guests: 4,
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(calls[0], {
    name: "pg_venue_hour_day",
    params: {
      p_offering_id: OFFER,
      p_date: "2026-11-21",
      p_guests: 4,
      p_price_option_id: null,
    },
  });
  const missing = await createVenueOffersHandler({
    client: fake([], () => ({ data: null, error: null })),
  })(post({ action: "hour_day", offeringId: OFFER, date: "2026-11-21" }));
  assertEquals(missing.status, 404);
});

Deno.test("quote by start and length makes the booking window, then quotes it", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({
    client: fake(
      calls,
      (name) =>
        name === "issue_4490_flexible_window"
          ? { data: WINDOW, error: null }
          : { data: { quoteId: "q", totalMinor: 2580000 }, error: null },
    ),
  });
  const res = await handle(post({
    action: "quote",
    offeringId: OFFER,
    startsAt: "2026-11-21T13:00:00Z",
    minutes: 120,
    lines: [{ guests: 4 }],
    cartKey: CART,
    idempotencyKey: "quote-hour-1",
  }));
  assertEquals(res.status, 200);
  assertEquals(calls.map((c) => c.name), [
    "issue_4490_flexible_window",
    "issue_4490_quote_offer",
  ]);
  assertEquals(calls[0].params, {
    p_offering_id: OFFER,
    p_starts_at: "2026-11-21T13:00:00.000Z",
    p_minutes: 120,
  });
  assertEquals(calls[1].params.p_window_id, WINDOW);
});

Deno.test("a length off the steps or out of range is a plain code", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({
    client: fake(calls, () => ({
      data: null,
      error: { message: "offer_length_invalid", code: "22023" },
    })),
  });
  const res = await handle(post({
    action: "quote",
    offeringId: OFFER,
    startsAt: "2026-11-21T13:00:00Z",
    minutes: 150,
    lines: [{ guests: 4 }],
    cartKey: CART,
    idempotencyKey: "quote-hour-2",
  }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).code, "offer_length_invalid");
  const bad = await handle(post({
    action: "quote",
    offeringId: OFFER,
    startsAt: "not a time",
    minutes: 60,
    lines: [{ guests: 4 }],
    cartKey: CART,
    idempotencyKey: "quote-hour-3",
  }));
  assertEquals(bad.status, 400);
  assertEquals(calls.length, 1);
});
