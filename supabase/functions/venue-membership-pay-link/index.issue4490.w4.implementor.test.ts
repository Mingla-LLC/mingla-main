// #4490 Explorer W4 — `pay` with `channel: "app"` returns to the app's
// payment-return page `/paid/plan/<subscriptionId>`; any other value (or
// none) keeps today's `/visit/plan/<id>?paid=1`. The origin is the server's
// own; nothing a client sends beside the channel changes the charge.
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

const SUB = "00000000-4490-4000-8000-0000000004d6";
const GROUP = "00000000-4490-4000-8000-0000000004a7";
const ATTEMPT = "00000000-4490-4000-8000-0000000004b7";
const USER = "00000000-4490-4000-8000-0000000004aa";
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

type Call = { name: string; params: Record<string, unknown> };

function fake(calls: Call[]): () => PayLinkClient {
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
        return Promise.resolve({
          data: {
            attemptId: ATTEMPT,
            groupId: GROUP,
            periodId: "00000000-4490-4000-8000-0000000004c7",
            amountMinor: 2500000,
            currencyCode: "NGN",
            provider: "paystack",
          },
          error: null,
        });
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

async function payWith(extra: Record<string, unknown>) {
  resetPayLinkRateLimitForTests();
  const calls: Call[] = [];
  let callback = "";
  const res = await createPayLinkHandler({
    client: fake(calls),
    env: (n) => ENV[n],
    createPaymentSession: (_p, _k, _d, options) => {
      callback = options?.callbackUrl ?? "";
      return Promise.resolve({
        attemptId: ATTEMPT,
        provider: "paystack",
        providerPaymentRef: "ref-w4",
        authorizationUrl: "https://checkout.example/pay",
      } as never);
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
        idempotencyKey: "venue-app-plan-w4-0001",
        ...extra,
      }),
    }),
  );
  const body = await res.json();
  return { status: res.status, callback, body, calls };
}

Deno.test("W4-M1 channel app (signed-in member): the return is /paid/plan/<id> on the server's origin", async () => {
  const { status, callback, body, calls } = await payWith({ channel: "app" });
  assertEquals(status, 200);
  assertEquals(callback, `http://localhost:8491/paid/plan/${SUB}`);
  assertEquals(body.data.returnUrl, callback);
  // The owner path: the user id, never a token.
  assertEquals(calls[0].name, "issue_4490_membership_prepare_payment");
  assertEquals(calls[0].params.p_user_id, USER);
  assertEquals(calls[0].params.p_token_hash, null);
  // The amount is the server's.
  assertEquals(body.data.amountMinor, 2500000);
});

Deno.test("W4-M2 no channel, web and hostile values keep today's /visit/plan/<id>?paid=1", async () => {
  const values: unknown[] = [
    undefined,
    "web",
    "APP",
    " app",
    "https://evil.example",
    ["app"],
    { x: 1 },
    0,
    null,
  ];
  for (const channel of values) {
    const { status, callback } = await payWith(
      channel === undefined ? {} : { channel },
    );
    assertEquals(status, 200, `channel ${JSON.stringify(channel)}`);
    assertEquals(
      callback,
      `http://localhost:8491/visit/plan/${SUB}?paid=1`,
      `channel ${JSON.stringify(channel)}`,
    );
  }
});

Deno.test("W4-M3 a client return URL or amount beside channel app is ignored", async () => {
  const { callback, calls } = await payWith({
    channel: "app",
    returnUrl: "https://evil.example/r",
    callbackUrl: "https://evil.example/c",
    amountMinor: 1,
  });
  assertEquals(callback, `http://localhost:8491/paid/plan/${SUB}`);
  assertEquals(Object.keys(calls[0].params).sort(), [
    "p_idempotency_key",
    "p_subscription_id",
    "p_token_hash",
    "p_user_id",
  ]);
});

Deno.test("W4-M4 memberReturnUrl: production fallback off a local stack, both channels", () => {
  const env = (n: string) =>
    ({
      BUSINESS_WEB_ORIGIN: "http://localhost:8491",
      SUPABASE_URL: "https://x.supabase.co",
    })[n];
  assertEquals(
    memberReturnUrl(env, SUB, "app"),
    `https://host.usemingla.com/paid/plan/${SUB}`,
  );
  assertEquals(
    memberReturnUrl(env, SUB),
    `https://host.usemingla.com/visit/plan/${SUB}?paid=1`,
  );
  assert(!memberReturnUrl(env, SUB, "app").includes("?"));
});
