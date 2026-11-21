// #4490 P4 — venue-offers private hire: the places for one session (public),
// withdraw a request (booking token or the booking's own buyer only:
// adversarial), and the guest's hire detail never shows setup / cleanup time.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createVenueOffersHandler,
  publicHireDetail,
  resetVenueOffersRateLimitForTests,
  type ServiceClient,
} from "./index.ts";
import { venueOfferTokenHashHex } from "../_shared/venueOfferBookingToken.ts";

const OFFER = "00000000-4490-4000-8000-0000000000a9";
const WINDOW = "00000000-4490-4000-8000-0000000000b9";
const OPTION = "00000000-4490-4000-8000-0000000000d9";
const GROUP = "00000000-4490-4000-8000-0000000000c9";
const STRANGER = "00000000-4490-4000-8000-0000000000e5";
const TOKEN = "H".repeat(43);
const ANON = `x.${btoa(JSON.stringify({ role: "anon" })).replace(/=+$/, "")}.y`;
const jwtFor = (sub: string) =>
  `x.${
    btoa(JSON.stringify({ role: "authenticated", sub })).replace(/=+$/, "")
  }.y`;

type Call = { name: string; params: Record<string, unknown> };

function fake(
  calls: Call[],
  userId: string | null,
  group: Record<string, unknown> | null,
  quoteError: { message: string; code: string; details: string } | null = null,
): () => ServiceClient {
  return () => ({
    rpc: (name, params) => {
      calls.push({ name, params });
      return Promise.resolve({
        data: name === "pg_venue_hire_options"
          ? [{
            price_option_id: "o1",
            place_name: "The Lounge Side",
            status: "held",
            blocked_by: "The Lounge Side",
          }]
          : { groupId: GROUP, state: "request_expired" },
        error: name === "issue_4490_quote_offer" ? quoteError : null,
      });
    },
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: group, error: null }),
      };
      return chain;
    },
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: userId ? { id: userId } : null },
          error: null,
        }),
    },
  });
}

function post(body: Record<string, unknown>, jwt: string): Request {
  return new Request("http://local/venue-offers", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });
}

Deno.test("hire_options lists the places for one session without any identity", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({ client: fake(calls, null, null) });
  const res = await handle(
    post({
      action: "hire_options",
      offeringId: OFFER,
      windowId: WINDOW,
      guests: 300,
    }, ANON),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.options[0].blocked_by, "The Lounge Side");
  assertEquals(calls[0].name, "pg_venue_hire_options");
  assertEquals(calls[0].params, {
    p_offering_id: OFFER,
    p_window_id: WINDOW,
    p_guests: 300,
  });
  const bad = await handle(
    post({ action: "hire_options", offeringId: "x", windowId: WINDOW }, ANON),
  );
  assertEquals(bad.status, 400);
});

// [TEST-MOD-APPROVED #4490] Spec 07-C: the existing quote edge is the guest's
// only path from HireRequest to the private-hire extras priced by PostgreSQL.
Deno.test("a private-hire quote forwards every chosen extra to the database", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({ client: fake(calls, null, null) });
  const extras = [{ id: "projector" }, { id: "welcome-drink" }];
  const res = await handle(
    post({
      action: "quote",
      offeringId: OFFER,
      windowId: WINDOW,
      lines: [{
        priceOptionId: "00000000-4490-4000-8000-0000000000d9",
        guests: 10,
      }],
      extras,
      answers: { occasion: "Team day" },
      cartKey: "c".repeat(32),
      idempotencyKey: "hire-extras-quote",
    }, ANON),
  );
  assertEquals(res.status, 200);
  const quote = calls.find((call) => call.name === "issue_4490_quote_offer");
  assertEquals(quote?.params.p_extras, extras);
  assertEquals(quote?.params.p_answers, { occasion: "Team day" });
});

// [TEST-MOD-APPROVED #4490] Spec 07-H keeps the exact layout-capacity refusal
// across the edge boundary without exposing any internal database detail.
Deno.test("a layout-capacity refusal exposes only the guest-safe detail", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({
    client: fake(calls, null, null, {
      message: "offer_group_too_big",
      code: "22023",
      details: JSON.stringify({
        placeName: "The Main Hall",
        capacity: 120,
        layout: "banquet",
        internalSpaceIds: ["must-not-leak"],
      }),
    }),
  });
  const res = await handle(
    post({
      action: "quote",
      offeringId: OFFER,
      windowId: WINDOW,
      lines: [{
        priceOptionId: "00000000-4490-4000-8000-0000000000d9",
        guests: 121,
        layout: "banquet",
      }],
      cartKey: "d".repeat(32),
      idempotencyKey: "hire-layout-refusal",
    }, ANON),
  );
  assertEquals(res.status, 400);
  assertEquals(await res.json(), {
    code: "offer_group_too_big",
    detail: { placeName: "The Main Hall", capacity: 120, layout: "banquet" },
  });
});

Deno.test("a malformed layout-capacity refusal never exposes database detail", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({
    client: fake(calls, null, null, {
      message: "offer_group_too_big",
      code: "22023",
      details: JSON.stringify({ placeName: "The Main Hall", capacity: 0, layout: "banquet", internal: "must-not-leak" }),
    }),
  });
  const res = await handle(
    post({
      action: "quote",
      offeringId: OFFER,
      windowId: WINDOW,
      lines: [{ priceOptionId: OPTION, guests: 121, layout: "banquet" }],
      cartKey: "e".repeat(32),
      idempotencyKey: "hire-layout-malformed-refusal",
    }, ANON),
  );
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { code: "offer_group_too_big" });
});

Deno.test("withdraw needs the booking token when signed out", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({ client: fake(calls, null, null) });
  const res = await handle(post({ action: "withdraw", groupId: GROUP }, ANON));
  assertEquals(res.status, 401);
  assertEquals((await res.json()).code, "booking_token_required");
  assertEquals(calls.length, 0);
  const ok = await handle(
    post({ action: "withdraw", groupId: GROUP, token: TOKEN }, ANON),
  );
  assertEquals(ok.status, 200);
  assertEquals(calls[0].name, "issue_4490_withdraw_request");
  assertEquals(
    calls[0].params.p_token_hash,
    `\\x${await venueOfferTokenHashHex(TOKEN)}`,
  );
});

Deno.test("a signed-in stranger cannot withdraw someone's signed-out request (adversarial)", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  // The booking was made signed out: no user on it.
  const handle = createVenueOffersHandler({
    client: fake(calls, STRANGER, {
      user_id: null,
      booked_by_user_id: null,
      offer_kind: "private_hire",
    }),
  });
  const res = await handle(
    post({ action: "withdraw", groupId: GROUP }, jwtFor(STRANGER)),
  );
  assertEquals(res.status, 404);
  assertEquals((await res.json()).code, "offer_booking_not_found");
  assert(
    !calls.some((c) => c.name === "issue_4490_withdraw_request"),
    "never reached the database",
  );
});

Deno.test("the guest's hire detail keeps setup / cleanup minutes and the pay timer private", () => {
  const detail = publicHireDetail({
    charge: "hire_fee",
    bookingMode: "request",
    requestResponseHours: 48,
    approvedPaymentMinutes: 4320,
    setupMinutes: 180,
    cleanupMinutes: 120,
    damageDepositMinor: 0,
    layouts: ["banquet"],
    spaces: [{ id: "s1", name: "The Lounge Side", capacity: 200 }],
    combinations: [],
    rows: [{
      optionId: "o1",
      name: "The Lounge Side",
      unit: "booking",
      guestMin: 60,
      guestMax: 150,
      layoutCapacities: { banquet: 120 },
      priceMinor: 700000000,
    }],
    sessions: [{
      label: "Evening",
      startTime: "18:00",
      endTime: "23:00",
      ruleId: "r1",
    }],
  });
  assert(detail);
  const text = JSON.stringify(detail);
  assert(
    !text.includes("setupMinutes") && !text.includes("cleanupMinutes") &&
      !text.includes("approvedPaymentMinutes"),
  );
  assert(!text.includes("ruleId"));
  assertEquals(
    (detail.rows as Array<Record<string, unknown>>)[0].priceMinor,
    700000000,
  );
  assertEquals(detail.requestResponseHours, 48);
  assertEquals(detail.layouts, ["banquet"]);
  assertEquals(
    (detail.rows as Array<Record<string, unknown>>)[0].layoutCapacities,
    { banquet: 120 },
  );
  assertEquals(publicHireDetail(null), null);
});
