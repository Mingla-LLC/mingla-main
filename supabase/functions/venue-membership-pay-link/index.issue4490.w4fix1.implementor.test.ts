// #4490 spec 06 W4 fix 1 (W4-N3), plans: one live payment page per period.
//
//   F1-M1 the plan's open payment (same stage and amount) is handed back
//         (`reused`) → the SAME page, the provider is never asked again; the
//         answer still carries the period and the charged amount
//   F1-M2 a new plan page is remembered for its attempt after it is bound
//   F1-M3 another way of paying at the same time → 409 offer_payment_mode_conflict
//
// FAILS-ON-REVERT: drop the `reusedPaymentPage` early return in pay-link `pay`
// and F1-M1 fails; drop `rememberPaymentPage` and F1-M2 fails; drop the code
// from SAFE_CODES and F1-M3 fails.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createPayLinkHandler,
  type PayLinkClient,
  resetPayLinkRateLimitForTests,
} from "./index.ts";

const SUB = "00000000-4490-4000-8000-0000000014d6";
const GROUP = "00000000-4490-4000-8000-0000000014a7";
const ATTEMPT = "00000000-4490-4000-8000-0000000014b7";
const PERIOD = "00000000-4490-4000-8000-0000000014c7";
const USER = "00000000-4490-4000-8000-0000000014aa";
const PAGE = "https://checkout.paystack.com/w4fix1plan";
const b64 = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(
    /\//g,
    "_",
  );
const USER_JWT = `${b64({ alg: "HS256" })}.${
  b64({ role: "authenticated", sub: USER })
}.sig`;
const ENV: Record<string, string> = {
  SUPABASE_URL: "http://127.0.0.1:57521",
  BUSINESS_WEB_ORIGIN: "http://localhost:8491",
};

function fake(
  prepare: () => { data: unknown; error: unknown },
  calls: Array<{ name: string; params: Record<string, unknown> }>,
): () => PayLinkClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  return () => ({
    rpc: (name, params) => {
      if (name === "issue_4490_flag_on") {
        return Promise.resolve({ data: false, error: null });
      }
      calls.push({ name, params });
      if (name === "issue_4490_membership_prepare_payment") {
        return Promise.resolve(prepare() as { data: unknown; error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: () => chain,
    auth: {
      getUser: () =>
        Promise.resolve({ data: { user: { id: USER } }, error: null }),
    },
  });
}

async function pay(prepare: () => { data: unknown; error: unknown }) {
  resetPayLinkRateLimitForTests();
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const pages: string[] = [];
  const res = await createPayLinkHandler({
    client: fake(prepare, calls),
    env: (n) => ENV[n],
    createPaymentSession: (p) => {
      pages.push(String(p.attemptId));
      return Promise.resolve({
        kind: "requires_redirect",
        provider: "paystack",
        attemptId: ATTEMPT,
        providerPaymentRef: "mingla_stay_plan",
        authorizationUrl: PAGE,
        amountMinor: "5375000",
        currencyCode: "NGN",
      });
    },
  })(
    new Request("http://local/venue-membership-pay-link", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${USER_JWT}`,
      },
      body: JSON.stringify({
        action: "pay",
        subscriptionId: SUB,
        idempotencyKey: "venue-app-plan-fix1-0001",
        channel: "app",
      }),
    }),
  );
  return { status: res.status, body: await res.json(), calls, pages };
}

const prepared = (over: Record<string, unknown> = {}) => () => ({
  data: {
    attemptId: ATTEMPT,
    groupId: GROUP,
    subscriptionId: SUB,
    periodId: PERIOD,
    provider: "paystack",
    state: "created",
    amountMinor: "5375000",
    currencyCode: "NGN",
    stage: "full",
    ...over,
  },
  error: null,
});

Deno.test("F1-M1 the plan's open payment: the same page again, the provider is not asked", async () => {
  const { status, body, pages } = await pay(
    prepared({
      state: "pending",
      reused: true,
      checkoutUrl: PAGE,
      providerPaymentRef: "mingla_stay_plan",
    }),
  );
  assertEquals(status, 200);
  assertEquals(pages.length, 0);
  assertEquals(body.data.authorizationUrl, PAGE);
  assertEquals(body.data.periodId, PERIOD);
  assertEquals(body.data.amountMinor, "5375000");
});

Deno.test("F1-M2 a new plan page is remembered for its attempt", async () => {
  const { status, calls, pages } = await pay(prepared());
  assertEquals(status, 200);
  assertEquals(pages.length, 1);
  const remembered = calls.find((c) =>
    c.name === "issue_4490_record_payment_page"
  );
  assertEquals(remembered?.params, {
    p_attempt_id: ATTEMPT,
    p_checkout_url: PAGE,
  });
});

Deno.test("F1-M3 another way of paying at the same time is refused in a plain code", async () => {
  const { status, body, pages } = await pay(() => ({
    data: null,
    error: { code: "PT409", message: "offer_payment_mode_conflict" },
  }));
  assertEquals(status, 409);
  assertEquals(body.code, "offer_payment_mode_conflict");
  assertEquals(pages.length, 0);
});
