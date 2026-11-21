// #4490 P2-2 — venue-offers edge function: guest token path, user path,
// return address, confirm on return, safe error codes.
import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createVenueOffersHandler,
  resetVenueOffersRateLimitForTests,
  resolveReturnOrigin,
  safeCode,
  type ServiceClient,
  statusFor,
} from "./index.ts";
import {
  deriveVenueOfferBookingToken,
  rederiveVenueOfferBookingToken,
  venueOfferTokenHashHex,
} from "../_shared/venueOfferBookingToken.ts";

const GROUP = "00000000-4490-4000-8000-000000000001";
const OFFER = "00000000-4490-4000-8000-000000000002";
const WINDOW = "00000000-4490-4000-8000-000000000003";
const QUOTE = "00000000-4490-4000-8000-000000000004";
const ATTEMPT = "00000000-4490-4000-8000-000000000005";
const OPTION = "00000000-4490-4000-8000-000000000006";
const USER = "00000000-4490-4000-8000-0000000000aa";
const CART = "C".repeat(43);
const TOKEN = "T".repeat(43);

type Call = { name: string; params: Record<string, unknown> };

function fakeClient(
  calls: Call[],
  responses: Record<
    string,
    (params: Record<string, unknown>) => { data: unknown; error: unknown }
  >,
  opts: {
    user?: string | null;
    attempt?: Record<string, unknown> | null;
    groupHash?: string;
  } = {},
): () => ServiceClient {
  return () => ({
    rpc: (name, params) => {
      calls.push({ name, params });
      const fn = responses[name];
      return Promise.resolve(
        (fn ? fn(params) : { data: null, error: null }) as {
          data: unknown;
          error: null;
        },
      );
    },
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () =>
          Promise.resolve({
            data: table === "stay_payment_attempts"
              ? opts.attempt ?? null
              : { buyer_token_hash: opts.groupHash ?? null },
            error: null,
          }),
      };
      return chain;
    },
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: opts.user ? { id: opts.user } : null },
          error: opts.user ? null : new Error("no user"),
        }),
    },
  });
}

function req(body: Record<string, unknown>, jwt?: string): Request {
  return new Request("http://local/venue-offers", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

// A JWT whose payload says role=authenticated (signature is checked by getUser).
const USER_JWT = `x.${
  btoa(JSON.stringify({ role: "authenticated", sub: USER })).replace(/=+$/, "")
}.y`;
const ANON_JWT = `x.${
  btoa(JSON.stringify({ role: "anon" })).replace(/=+$/, "")
}.y`;

const env = (values: Record<string, string>) => (name: string) => values[name];

Deno.test("return address: production by default, loopback only on a local stack", () => {
  assertEquals(resolveReturnOrigin(env({})), "https://host.usemingla.com");
  assertEquals(
    resolveReturnOrigin(
      env({
        BUSINESS_WEB_ORIGIN: "http://127.0.0.1:8491",
        SUPABASE_URL: "http://kong:8000",
      }),
    ),
    "http://127.0.0.1:8491",
  );
  assertEquals(
    resolveReturnOrigin(
      env({
        BUSINESS_WEB_ORIGIN: "http://127.0.0.1:8491",
        SUPABASE_URL: "https://abc.supabase.co",
      }),
    ),
    "https://host.usemingla.com",
  );
  assertEquals(
    resolveReturnOrigin(
      env({
        BUSINESS_WEB_ORIGIN: "https://evil.example",
        SUPABASE_URL: "http://kong:8000",
      }),
    ),
    "https://host.usemingla.com",
  );
});

Deno.test("error codes are whitelisted and mapped to HTTP statuses", () => {
  assertEquals(safeCode({ message: "offer_sold_out" }), "offer_sold_out");
  assertEquals(
    safeCode({ message: "offer_amount_too_large" }),
    "offer_amount_too_large",
  );
  assertEquals(
    safeCode({ message: "duplicate key value violates something secret" }),
    "offer_request_failed",
  );
  assertEquals(statusFor({ code: "PT409" }), 409);
  assertEquals(statusFor({ code: "P0002" }), 404);
  assertEquals(statusFor({ code: "P0001" }), 422);
});

Deno.test("a signed-out guest quotes and holds with the cart key, and gets a booking token once", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handler = createVenueOffersHandler({
    env: env({}),
    client: fakeClient(calls, {
      issue_4490_quote_offer: () => ({
        data: { quoteId: QUOTE, totalMinor: 1505000 },
        error: null,
      }),
      issue_4490_create_offer_group: (p) => ({
        data: {
          groupId: p.p_group_id,
          reference: "VB-1",
          state: "instant_payment_pending",
          version: 1,
        },
        error: null,
      }),
    }),
    newGroupId: () => GROUP,
    issueToken: () => Promise.resolve({ token: TOKEN, derived: true }),
  });
  const quote = await handler(req({
    action: "quote",
    offeringId: OFFER,
    windowId: WINDOW,
    cartKey: CART,
    lines: [{ priceOptionId: OPTION, guests: 2 }],
    idempotencyKey: "quote-key-1",
  }, ANON_JWT));
  assertEquals(quote.status, 200);
  const hold = await handler(req({
    action: "hold",
    quoteId: QUOTE,
    cartKey: CART,
    idempotencyKey: "hold-key-1",
    guest: { name: "Ada", email: "ada@example.test" },
  }, ANON_JWT));
  const body = await hold.json();
  assertEquals(hold.status, 200);
  assertEquals(body.data.bookingToken, TOKEN);
  assertEquals(body.data.visitPath, `/visit/${GROUP}`);
  const quoteCall = calls.find((c) => c.name === "issue_4490_quote_offer")!;
  const holdCall = calls.find((c) =>
    c.name === "issue_4490_create_offer_group"
  )!;
  assertEquals(quoteCall.params.p_user_id, null);
  assertEquals(quoteCall.params.p_actor_key, holdCall.params.p_actor_key);
  assert(/^[a-f0-9]{64}$/.test(String(quoteCall.params.p_actor_key)));
  assertEquals(
    holdCall.params.p_buyer_token_hash,
    `\\x${await venueOfferTokenHashHex(TOKEN)}`,
  );
  assertFalse(
    JSON.stringify(calls).includes(TOKEN),
    "the plaintext token never reaches the database",
  );
});

Deno.test("a signed-in buyer's actor key comes from the verified user, not the cart", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handler = createVenueOffersHandler({
    env: env({}),
    client: fakeClient(calls, {
      issue_4490_quote_offer: () => ({ data: { quoteId: QUOTE }, error: null }),
    }, { user: USER }),
  });
  const res = await handler(req({
    action: "quote",
    offeringId: OFFER,
    windowId: WINDOW,
    lines: [{ priceOptionId: OPTION, guests: 1 }],
    idempotencyKey: "quote-key-2",
  }, USER_JWT));
  assertEquals(res.status, 200);
  assertEquals(calls[0].params.p_user_id, USER);
});

Deno.test("a forged user JWT is refused, a missing cart key is refused", async () => {
  resetVenueOffersRateLimitForTests();
  const handler = createVenueOffersHandler({
    env: env({}),
    client: fakeClient([], {}, { user: null }),
  });
  const forged = await handler(
    req({ action: "get", groupId: GROUP, token: TOKEN }, USER_JWT),
  );
  assertEquals(forged.status, 401);
  const noCart = await handler(req({
    action: "quote",
    offeringId: OFFER,
    windowId: WINDOW,
    lines: [],
    idempotencyKey: "quote-key-3",
  }, ANON_JWT));
  assertEquals(noCart.status, 400);
  const noToken = await handler(
    req({ action: "get", groupId: GROUP }, ANON_JWT),
  );
  assertEquals(noToken.status, 401);
});

Deno.test("pay sends the guest back to the configured origin and binds the provider reference", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  let callbackUrl = "";
  const handler = createVenueOffersHandler({
    env: env({
      BUSINESS_WEB_ORIGIN: "http://127.0.0.1:8491",
      SUPABASE_URL: "http://kong:8000",
    }),
    client: fakeClient(calls, {
      issue_4490_prepare_offer_payment: () => ({
        data: {
          attemptId: ATTEMPT,
          groupId: GROUP,
          provider: "paystack",
          amountMinor: "1505000",
          currencyCode: "NGN",
          applicationFeeMinor: "22575",
          buyerEmail: "ada@example.test",
          connectedAccountRef: null,
          state: "created",
        },
        error: null,
      }),
      issue_1389_bind_payment_attempt: () => ({ data: {}, error: null }),
    }),
    createPaymentSession: (prepared, _key, _deps, options) => {
      callbackUrl = options?.callbackUrl ?? "";
      return Promise.resolve({
        kind: "requires_redirect",
        provider: "paystack",
        attemptId: prepared.attemptId,
        providerPaymentRef: "mingla_stay_x",
        authorizationUrl: "https://checkout.paystack.com/x",
        amountMinor: prepared.amountMinor,
        currencyCode: prepared.currencyCode,
      });
    },
  });
  const res = await handler(req({
    action: "pay",
    groupId: GROUP,
    token: TOKEN,
    idempotencyKey: "pay-key-1",
    expectedVersion: 1,
  }, ANON_JWT));
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(callbackUrl, `http://127.0.0.1:8491/visit/${GROUP}?paid=1`);
  assertFalse(
    callbackUrl.includes(TOKEN),
    "the booking token is never put in a URL sent to the provider",
  );
  assertEquals(body.data.authorizationUrl, "https://checkout.paystack.com/x");
  const prep = calls.find((c) =>
    c.name === "issue_4490_prepare_offer_payment"
  )!;
  assertEquals(
    prep.params.p_token_hash,
    `\\x${await venueOfferTokenHashHex(TOKEN)}`,
  );
  assert(
    calls.some((c) =>
      c.name === "issue_1389_bind_payment_attempt" &&
      c.params.p_provider_payment_ref === "mingla_stay_x"
    ),
  );
});

Deno.test("the cap refusal reaches the guest as a plain code", async () => {
  resetVenueOffersRateLimitForTests();
  const handler = createVenueOffersHandler({
    env: env({}),
    client: fakeClient([], {
      issue_4490_prepare_offer_payment: () => ({
        data: null,
        error: { code: "P0001", message: "offer_amount_too_large" },
      }),
    }),
  });
  const res = await handler(req({
    action: "pay",
    groupId: GROUP,
    token: TOKEN,
    idempotencyKey: "pay-key-2",
    expectedVersion: 1,
  }, ANON_JWT));
  assertEquals(res.status, 422);
  assertEquals((await res.json()).code, "offer_amount_too_large");
});

Deno.test("confirm_return verifies our own pending Paystack reference and confirms through the webhook path", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const verified: string[] = [];
  const confirmed: string[] = [];
  const handler = createVenueOffersHandler({
    env: env({}),
    client: fakeClient(calls, {
      issue_4490_get_offer_booking: () => ({
        data: { groupId: GROUP, state: "confirmed" },
        error: null,
      }),
    }, {
      attempt: {
        id: ATTEMPT,
        provider: "paystack",
        provider_payment_ref: "mingla_stay_abc",
        state: "pending",
      },
    }),
    verifyPaystack: (ref) => {
      verified.push(ref);
      return Promise.resolve({
        status: "success",
        amount: 1505000,
        currency: "NGN",
      });
    },
    confirmPaystack: (_client, data, eventId) => {
      confirmed.push(`${String(data.reference)}|${eventId}`);
      return Promise.resolve(null);
    },
  });
  const res = await handler(
    req({
      action: "confirm_return",
      groupId: GROUP,
      token: TOKEN,
      reference: "attacker_ref",
    }, ANON_JWT),
  );
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.data.outcome, "confirmed");
  assertEquals(verified, ["mingla_stay_abc"], "the URL's reference is ignored");
  assertEquals(confirmed, ["mingla_stay_abc|return:mingla_stay_abc"]);
});

// TEST-MOD-APPROVED #4490: P3 closes a payment page left unpaid, so
// "abandoned" now reads "not_paid" (pay again at once); "failed" stays failed.
Deno.test("confirm_return keeps polling while Paystack is still in flight, and says not paid when abandoned", async () => {
  for (
    const [status, outcome] of [
      ["ongoing", "pending"],
      ["abandoned", "not_paid"],
      ["failed", "failed"],
    ]
  ) {
    resetVenueOffersRateLimitForTests();
    const handler = createVenueOffersHandler({
      env: env({}),
      client: fakeClient([], {
        issue_4490_get_offer_booking: () => ({
          data: { groupId: GROUP, state: "instant_payment_pending" },
          error: null,
        }),
      }, {
        attempt: {
          id: ATTEMPT,
          provider: "paystack",
          provider_payment_ref: "mingla_stay_abc",
          state: "pending",
        },
      }),
      verifyPaystack: () => Promise.resolve({ status }),
      confirmPaystack: () => {
        throw new Error("must not confirm");
      },
    });
    const res = await handler(
      req({ action: "confirm_return", groupId: GROUP, token: TOKEN }, ANON_JWT),
    );
    assertEquals((await res.json()).data.outcome, outcome);
  }
});

Deno.test("cancel passes the preview set and the token hash", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handler = createVenueOffersHandler({
    env: env({}),
    client: fakeClient(calls, {
      issue_4490_cancel: () => ({
        data: { state: "cancelled", refundMinor: 1075000 },
        error: null,
      }),
    }),
  });
  const res = await handler(req({
    action: "cancel",
    groupId: GROUP,
    token: TOKEN,
    previewIds: [ATTEMPT],
    previewHash: "a".repeat(64),
    idempotencyKey: "cancel-key-1",
  }, ANON_JWT));
  assertEquals(res.status, 200);
  assertEquals(calls[0].params.p_preview_ids, [ATTEMPT]);
  assertEquals(calls[0].params.p_reason, "Cancelled by the guest");
});

Deno.test("booking tokens are re-derivable from the booking id at send time (current or previous key)", async () => {
  const key = { kid: "k1", key: new Uint8Array(32).fill(7) };
  const old = { kid: "k0", key: new Uint8Array(32).fill(3) };
  const token = await deriveVenueOfferBookingToken({
    groupId: GROUP,
    key: old,
  });
  const stored = await venueOfferTokenHashHex(token);
  const again = await rederiveVenueOfferBookingToken({
    groupId: GROUP,
    storedHashHex: `\\x${stored}`,
    ring: { ok: true, current: key, previous: old },
  });
  assertEquals(again, token);
  const none = await rederiveVenueOfferBookingToken({
    groupId: GROUP,
    storedHashHex: stored,
    ring: { ok: true, current: key, previous: null },
  });
  assertEquals(
    none,
    null,
    "a rotated-out key yields no link rather than a broken one",
  );
  assert(/^k0\.[A-Za-z0-9_-]{43}$/.test(token));
});

Deno.test("a provider refusal (4xx) is a plain failure, not an ambiguous payment", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const handler = createVenueOffersHandler({
    env: env({}),
    client: fakeClient(calls, {
      issue_4490_prepare_offer_payment: () => ({
        data: {
          attemptId: ATTEMPT,
          groupId: GROUP,
          provider: "paystack",
          amountMinor: "1505000",
          currencyCode: "NGN",
          applicationFeeMinor: "0",
          buyerEmail: "x@local.invalid",
          connectedAccountRef: null,
          state: "created",
        },
        error: null,
      }),
    }),
    createPaymentSession: () =>
      Promise.reject(
        new Error(
          'Paystack initialize failed (400): "email" must be a valid email',
        ),
      ),
  });
  const res = await handler(
    req({
      action: "pay",
      groupId: GROUP,
      token: TOKEN,
      idempotencyKey: "pay-key-9",
      expectedVersion: 1,
    }, ANON_JWT),
  );
  assertEquals(res.status, 422);
  assertEquals((await res.json()).code, "offer_payment_details_rejected");
  const failure = calls.find((c) =>
    c.name === "issue_1389_record_payment_create_failure"
  )!;
  assertEquals(failure.params.p_ambiguous, false);
  assertEquals(failure.params.p_failure_code, "provider_create_refused");
});

Deno.test("offer: answers only for an offer the public venue page lists, and only its public fields", async () => {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  const page = {
    currencyCode: "NGN",
    minorUnitExponent: 2,
    vat: { mode: "added", ratePct: 7.5 },
    venue: {
      id: "v",
      name: "Gameland QA",
      slug: "gamelandqa",
      brand_slug: "qa",
      iana_timezone: "Africa/Lagos",
    },
    offers: [{ id: OFFER, kind: "entry" }],
  };
  const handler = createVenueOffersHandler({
    env: env({}),
    client: fakeClient(calls, {
      pg_public_venue_page: () => ({ data: page, error: null }),
      issue_4490_offer_projection: () => ({
        data: {
          id: OFFER,
          kind: "entry",
          status: "live",
          name: "Entry",
          pool: { dailyLimit: 400 },
          readiness: [],
          options: [{
            id: OPTION,
            name: "Walk-in",
            unit: "guest",
            guestMin: 1,
            guestMax: 20,
            priceMinor: 500000,
            passDays: 3,
            passWindowDays: 3,
            priceVersionId: "secret-version",
            eligibility: { label: "Student ID", checkAtGate: true },
          }],
          policy: {
            cancellationPolicy: "Full refund up to 1 day(s) before.",
            refundLadder: [{ minMinutesBefore: 1440, refundBps: 10000 }],
            operatorCancelRefundBps: 10000,
          },
        },
        error: null,
      }),
    }),
  });
  const ok = await handler(req({
    action: "offer",
    offeringId: OFFER,
    brandSlug: "qa",
    venueSlug: "gamelandqa",
  }, ANON_JWT));
  assertEquals(ok.status, 200);
  const body = await ok.json();
  assertEquals(body.data.options[0].name, "Walk-in");
  assertEquals(body.data.options[0].eligibility, { label: "Student ID" });
  assertEquals(body.data.options[0].passDays, 3);
  assertEquals(body.data.options[0].passWindowDays, 3);
  assertEquals(body.data.venue.timezone, "Africa/Lagos");
  assertEquals(body.data.vat.mode, "added");
  const text = JSON.stringify(body);
  assertFalse(text.includes("secret-version"), "no price version ids");
  assertFalse(text.includes("dailyLimit"), "no pool");
  assertFalse(text.includes("operatorCancelRefundBps"), "no operator rate");
  assertFalse(text.includes("readiness"), "no host readiness");

  const unlisted = await handler(req({
    action: "offer",
    offeringId: GROUP,
    brandSlug: "qa",
    venueSlug: "gamelandqa",
  }, ANON_JWT));
  assertEquals(unlisted.status, 404);
  assertEquals((await unlisted.json()).code, "offer_not_found");
  assertFalse(
    calls.some((c) =>
      c.name === "issue_4490_offer_projection" &&
      c.params.p_offering_id === GROUP
    ),
    "an offer the page does not list is never projected",
  );
  const bad = await handler(req({
    action: "offer",
    offeringId: OFFER,
    brandSlug: "../x",
    venueSlug: "gamelandqa",
  }, ANON_JWT));
  assertEquals(bad.status, 400);
});
