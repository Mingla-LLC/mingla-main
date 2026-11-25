// #4490 P6 — venue-membership-pay-link: a member pays their open month with
// the member token (or their own account), never anyone else's; the return
// address carries no token; a month already paid owes nothing; an earlier
// payment page left open is settled with the provider first.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createPayLinkHandler,
  memberReturnUrl,
  type PayLinkClient,
  resetPayLinkRateLimitForTests,
} from "./index.ts";
import { venueOfferTokenHashHex } from "../_shared/venueOfferBookingToken.ts";
import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "../_shared/businessWebOrigin.ts";

const SUB = "00000000-4490-4000-8000-0000000000d6";
const GROUP = "00000000-4490-4000-8000-0000000000a7";
const ATTEMPT = "00000000-4490-4000-8000-0000000000b7";
const USER = "00000000-4490-4000-8000-0000000000aa";
const TOKEN = "m".repeat(43);
const b64 = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(
    /\//g,
    "_",
  );
const ANON = `${b64({ alg: "HS256" })}.${b64({ role: "anon" })}.sig`;
const USER_JWT = `${b64({ alg: "HS256" })}.${
  b64({ role: "authenticated", sub: USER })
}.sig`;
const ENV: Record<string, string> = {
  SUPABASE_URL: "http://127.0.0.1:57521",
  BUSINESS_WEB_ORIGIN: "http://localhost:8491",
};

type Call = { name: string; params: Record<string, unknown> };

function fake(
  calls: Call[],
  result: (name: string) => { data: unknown; error: unknown },
  opts: { user?: string | null; attempt?: Record<string, unknown> | null } = {},
): () => PayLinkClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: opts.attempt ?? null, error: null }),
  };
  return () => ({
    rpc: (name, params) => {
      // TEST-MOD-APPROVED #4490 (Explorer W1): the #4490 rollout flag reads are not
      // part of what these cases pin; they are answered "off" and not recorded.
      if (name === "issue_4490_flag_on") {
        return Promise.resolve({ data: false, error: null });
      }
      calls.push({ name, params });
      return Promise.resolve(result(name) as { data: unknown; error: null });
    },
    from: () => chain,
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: opts.user ? { id: opts.user } : null },
          error: opts.user ? null : { message: "no" },
        }),
    },
  });
}

function post(body: Record<string, unknown>, auth = ANON): Request {
  return new Request("http://local/venue-membership-pay-link", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${auth}` },
    body: JSON.stringify(body),
  });
}

const PREPARED = {
  attemptId: ATTEMPT,
  groupId: GROUP,
  periodId: "00000000-4490-4000-8000-0000000000c7",
  amountMinor: 9137500,
  currencyCode: "NGN",
  provider: "paystack",
};

Deno.test("no token and no account: refused before the database", async () => {
  resetPayLinkRateLimitForTests();
  const calls: Call[] = [];
  const res = await createPayLinkHandler({
    client: fake(calls, () => ({ data: null, error: null })),
    env: (n) => ENV[n],
  })(post({ action: "pay", subscriptionId: SUB, idempotencyKey: "pay-key-0001" }));
  assertEquals(res.status, 401);
  assertEquals((await res.json()).code, "membership_token_required");
  assertEquals(calls.length, 0);
});

Deno.test("pay: the open month, the member token hash only, a return address with no token", async () => {
  resetPayLinkRateLimitForTests();
  const calls: Call[] = [];
  let callback = "";
  const res = await createPayLinkHandler({
    client: fake(calls, (name) =>
      name === "issue_4490_membership_prepare_payment"
        ? { data: PREPARED, error: null }
        : { data: null, error: null }),
    env: (n) => ENV[n],
    createPaymentSession: (_p, _k, _d, options) => {
      callback = options?.callbackUrl ?? "";
      return Promise.resolve({
        attemptId: ATTEMPT,
        provider: "paystack",
        providerPaymentRef: "ref-1",
        authorizationUrl: "https://checkout.example/pay",
      } as never);
    },
  })(post({ action: "pay", subscriptionId: SUB, token: TOKEN, idempotencyKey: "pay-key-0001" }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(calls[0].name, "issue_4490_membership_prepare_payment");
  assertEquals(calls[0].params.p_token_hash, `\\x${await venueOfferTokenHashHex(TOKEN)}`);
  assertEquals(calls[0].params.p_user_id, null);
  assertEquals(calls[1].name, "issue_1389_bind_payment_attempt");
  assertEquals(callback, `http://localhost:8491/visit/plan/${SUB}?paid=1`);
  assert(!callback.includes(TOKEN));
  assertEquals(body.data.amountMinor, 9137500);
  assertEquals(body.data.returnUrl, callback);
});

Deno.test("pay: a month already paid owes nothing (the same link twice is refused)", async () => {
  resetPayLinkRateLimitForTests();
  const res = await createPayLinkHandler({
    client: fake([], () => ({
      data: null,
      error: { code: "PT409", message: "membership_nothing_to_pay" },
    })),
    env: (n) => ENV[n],
  })(post({ action: "pay", subscriptionId: SUB, token: TOKEN, idempotencyKey: "pay-key-0002" }));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).code, "membership_nothing_to_pay");
});

Deno.test("pay: another member's token is not found", async () => {
  resetPayLinkRateLimitForTests();
  const res = await createPayLinkHandler({
    client: fake([], () => ({
      data: null,
      error: { code: "P0002", message: "membership_not_found" },
    })),
    env: (n) => ENV[n],
  })(post({ action: "pay", subscriptionId: SUB, token: "s".repeat(43), idempotencyKey: "pay-key-0003" }));
  assertEquals(res.status, 404);
  assertEquals((await res.json()).code, "membership_not_found");
});

Deno.test("pay: an earlier payment page that was paid is confirmed, not charged again", async () => {
  resetPayLinkRateLimitForTests();
  const calls: Call[] = [];
  let confirmed = 0;
  const res = await createPayLinkHandler({
    client: fake(calls, (name) =>
      name === "issue_4490_membership_prepare_payment"
        ? { data: null, error: { code: "PT409", message: "offer_payment_already_pending" } }
        : name === "issue_4490_membership_payment_group"
        ? { data: GROUP, error: null }
        : { data: null, error: null }, {
      attempt: { id: ATTEMPT, provider: "paystack", provider_payment_ref: "ref-0", state: "pending" },
    }),
    env: (n) => ENV[n],
    verifyPaystack: () => Promise.resolve({ status: "success" }),
    confirmPaystack: () => {
      confirmed += 1;
      return Promise.resolve(null);
    },
  })(post({ action: "pay", subscriptionId: SUB, token: TOKEN, idempotencyKey: "pay-key-0004" }));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).code, "offer_payment_already_paid");
  assertEquals(confirmed, 1);
});

Deno.test("a signed-in member pays their own month with their account", async () => {
  resetPayLinkRateLimitForTests();
  const calls: Call[] = [];
  const res = await createPayLinkHandler({
    client: fake(calls, () => ({ data: { status: "active" }, error: null }), { user: USER }),
    env: (n) => ENV[n],
  })(post({ action: "get", subscriptionId: SUB }, USER_JWT));
  assertEquals(res.status, 200);
  assertEquals(calls[0].params.p_user_id, USER);
  assertEquals(calls[0].params.p_token_hash, null);
});

Deno.test("confirm_return asks the provider and confirms through the webhook's finalize", async () => {
  resetPayLinkRateLimitForTests();
  const calls: Call[] = [];
  let confirmedRef = "";
  const res = await createPayLinkHandler({
    client: fake(calls, (name) =>
      name === "issue_4490_membership_payment_group"
        ? { data: GROUP, error: null }
        : { data: { status: "active" }, error: null }, {
      attempt: { id: ATTEMPT, provider: "paystack", provider_payment_ref: "ref-9", state: "pending" },
    }),
    env: (n) => ENV[n],
    verifyPaystack: () => Promise.resolve({ status: "success" }),
    confirmPaystack: (_c, envelope) => {
      confirmedRef = String((envelope as Record<string, unknown>).reference);
      return Promise.resolve(null);
    },
  })(post({ action: "confirm_return", subscriptionId: SUB, token: TOKEN }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.data.outcome, "confirmed");
  assertEquals(confirmedRef, "ref-9");
});

Deno.test("the return address falls back to production off a local stack", () => {
  assertEquals(
    memberReturnUrl((n) => ({ BUSINESS_WEB_ORIGIN: "http://localhost:8491", SUPABASE_URL: "https://x.supabase.co" })[n], SUB),
    `${PRODUCTION_BUSINESS_WEB_ORIGIN}/visit/plan/${SUB}?paid=1`,
  );
});
