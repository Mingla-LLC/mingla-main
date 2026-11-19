// #4490 P3 — venue-offers: paying again after leaving the payment page,
// "at the gate only" on the offer read, pay modes and booking changes.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createVenueOffersHandler,
  resetVenueOffersRateLimitForTests,
  type ServiceClient,
} from "./index.ts";

const GROUP = "00000000-4490-4000-8000-0000000000f1";
const ATTEMPT = "00000000-4490-4000-8000-0000000000f2";
const OFFER = "00000000-4490-4000-8000-0000000000f3";
const WINDOW = "00000000-4490-4000-8000-0000000000f4";
const TOKEN = "T".repeat(43);

type Call = { name: string; params: Record<string, unknown> };
type Responder = (params: Record<string, unknown>, n: number) => {
  data: unknown;
  error: { message: string; code: string } | null;
};

function client(
  calls: Call[],
  responses: Record<string, Responder>,
  tables: Record<string, unknown> = {},
): () => ServiceClient {
  const counts: Record<string, number> = {};
  return () => ({
    rpc: (name, params) => {
      calls.push({ name, params });
      counts[name] = (counts[name] ?? 0) + 1;
      const fn = responses[name];
      return Promise.resolve(
        fn ? fn(params, counts[name]) : { data: null, error: null },
      ) as Promise<{ data: unknown; error: null }>;
    },
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () =>
          Promise.resolve({ data: tables[table] ?? null, error: null }),
      };
      return chain;
    },
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: null }, error: new Error("none") }),
    },
  });
}

function post(body: Record<string, unknown>): Request {
  return new Request("http://local/venue-offers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const PENDING = {
  id: ATTEMPT,
  provider: "paystack",
  provider_payment_ref: "mingla_stay_abc",
  state: "pending",
};
const PREPARED = {
  attemptId: "00000000-4490-4000-8000-0000000000f9",
  provider: "paystack",
  amountMinor: 7525000,
  currencyCode: "NGN",
  stage: "deposit",
};
const alreadyPending = {
  data: null,
  error: { message: "offer_payment_already_pending", code: "PT409" },
};
const payBody = {
  action: "pay",
  groupId: GROUP,
  token: TOKEN,
  idempotencyKey: "pay-again-12345",
  expectedVersion: 4,
};

Deno.test("pay again after leaving the payment page: the abandoned payment is closed and a new one starts", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({
    client: client(calls, {
      issue_4490_prepare_offer_payment: (_p, n) =>
        n === 1 ? alreadyPending : { data: PREPARED, error: null },
    }, { stay_payment_attempts: PENDING }),
    env: () => undefined,
    verifyPaystack: () => Promise.resolve({ status: "abandoned" }),
    createPaymentSession: () =>
      Promise.resolve({
        kind: "requires_redirect",
        provider: "paystack",
        attemptId: PREPARED.attemptId,
        providerPaymentRef: "mingla_stay_new",
        authorizationUrl: "https://checkout.paystack.test/x",
        amountMinor: PREPARED.amountMinor,
        currencyCode: "NGN",
      } as never),
  });
  const res = await handle(post(payBody));
  assertEquals(res.status, 200);
  const closed = calls.find((c) =>
    c.name === "issue_1389_record_payment_create_failure"
  );
  assert(closed, "the abandoned attempt is closed");
  assertEquals(closed.params.p_attempt_id, ATTEMPT);
  assertEquals(closed.params.p_failure_code, "provider_abandoned");
  assertEquals(closed.params.p_ambiguous, false);
  assertEquals(
    calls.filter((c) => c.name === "issue_4490_prepare_offer_payment").length,
    2,
  );
});

Deno.test("pay again while the provider says the first payment went through: confirm it, say already paid", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  let confirmed = false;
  const handle = createVenueOffersHandler({
    client: client(calls, {
      issue_4490_prepare_offer_payment: () => alreadyPending,
    }, { stay_payment_attempts: PENDING }),
    env: () => undefined,
    verifyPaystack: () =>
      Promise.resolve({ status: "success", amount: 7525000 }),
    confirmPaystack: (() => {
      confirmed = true;
      return Promise.resolve({ ok: true });
    }) as never,
  });
  const res = await handle(post(payBody));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).code, "offer_payment_already_paid");
  assert(confirmed);
  assertEquals(
    calls.filter((c) => c.name === "issue_1389_record_payment_create_failure")
      .length,
    0,
  );
});

Deno.test("pay again while the first payment is still in flight: nothing is closed", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({
    client: client(calls, {
      issue_4490_prepare_offer_payment: () => alreadyPending,
    }, { stay_payment_attempts: PENDING }),
    env: () => undefined,
    verifyPaystack: () => Promise.resolve({ status: "ongoing" }),
  });
  const res = await handle(post(payBody));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).code, "offer_payment_already_pending");
  assertEquals(
    calls.filter((c) => c.name === "issue_1389_record_payment_create_failure")
      .length,
    0,
  );
});

Deno.test("confirm_return after leaving the payment page unpaid says not_paid and frees the booking to pay again", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handle = createVenueOffersHandler({
    client: client(calls, {
      issue_4490_get_offer_booking: () => ({
        data: { groupId: GROUP, state: "instant_payment_pending" },
        error: null,
      }),
    }, { stay_payment_attempts: PENDING }),
    env: () => undefined,
    verifyPaystack: () => Promise.resolve({ status: "abandoned" }),
  });
  const res = await handle(
    post({ action: "confirm_return", groupId: GROUP, token: TOKEN }),
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).data.outcome, "not_paid");
  const closed = calls.find((c) =>
    c.name === "issue_1389_record_payment_create_failure"
  );
  assertEquals(closed?.params.p_failure_code, "provider_abandoned");
});

Deno.test("the offer read says whether it can be paid online (at the gate only otherwise)", async () => {
  for (const can of [true, false]) {
    resetVenueOffersRateLimitForTests();
    const calls: Call[] = [];
    const handle = createVenueOffersHandler({
      client: client(calls, {
        pg_public_venue_page: () => ({
          data: {
            venue: {},
            offers: [{ id: OFFER, canCollectOnline: can }],
            currencyCode: "NGN",
          },
          error: null,
        }),
        issue_4490_offer_projection: () => ({
          data: {
            id: OFFER,
            kind: "group_package",
            status: "live",
            name: "Squad",
            options: [],
          },
          error: null,
        }),
      }),
      env: () => undefined,
    });
    const res = await handle(
      post({
        action: "offer",
        offeringId: OFFER,
        brandSlug: "qa",
        venueSlug: "gameland",
      }),
    );
    assertEquals(res.status, 200);
    assertEquals((await res.json()).data.canCollectOnline, can);
  }
});

export { WINDOW };
