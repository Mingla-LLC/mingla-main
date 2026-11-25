// #4490 Explorer W4 — `pay` with `channel: "app"` returns to the app's
// payment-return page `/paid/visit/<groupId>`; any other value (or none)
// keeps today's `/visit/<groupId>?paid=1`. The origin is always the server's
// own: a client URL, amount or mode sent beside the channel changes nothing.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createVenueOffersHandler,
  offerPayReturnUrl,
  resetVenueOffersRateLimitForTests,
  type ServiceClient,
} from "./index.ts";

const GROUP = "00000000-4490-4000-8000-0000000004a1";
const ATTEMPT = "00000000-4490-4000-8000-0000000004a2";
const TOKEN = "T".repeat(43);
const ENV: Record<string, string> = {
  SUPABASE_URL: "http://127.0.0.1:57521",
  BUSINESS_WEB_ORIGIN: "http://localhost:8491",
};

type Call = { name: string; params: Record<string, unknown> };

function client(calls: Call[]): () => ServiceClient {
  return () => ({
    rpc: (name, params) => {
      calls.push({ name, params });
      if (name === "issue_4490_prepare_offer_payment") {
        return Promise.resolve({
          data: {
            attemptId: ATTEMPT,
            provider: "paystack",
            amountMinor: 7525000,
            currencyCode: "NGN",
            stage: "deposit",
          },
          error: null,
        }) as Promise<{ data: unknown; error: null }>;
      }
      return Promise.resolve({ data: null, error: null }) as Promise<
        { data: unknown; error: null }
      >;
    },
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
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

async function payWith(extra: Record<string, unknown>): Promise<{
  status: number;
  callback: string;
  body: Record<string, unknown>;
  calls: Call[];
}> {
  resetVenueOffersRateLimitForTests();
  const calls: Call[] = [];
  let callback = "";
  const res = await createVenueOffersHandler({
    client: client(calls),
    env: (n) => ENV[n],
    createPaymentSession: (_p, _k, _d, options) => {
      callback = options?.callbackUrl ?? "";
      return Promise.resolve({
        kind: "requires_redirect",
        provider: "paystack",
        attemptId: ATTEMPT,
        providerPaymentRef: "mingla_stay_w4",
        authorizationUrl: "https://checkout.paystack.test/w4",
        amountMinor: 7525000,
        currencyCode: "NGN",
      } as never);
    },
  })(post({
    action: "pay",
    groupId: GROUP,
    token: TOKEN,
    idempotencyKey: "venue-app-pay-w4-0001",
    expectedVersion: 2,
    ...extra,
  }));
  const body = await res.json();
  return { status: res.status, callback, body, calls };
}

Deno.test("W4-S1 channel app: the return is the app's /paid/visit page on the server's origin", async () => {
  const { status, callback, body } = await payWith({ channel: "app" });
  assertEquals(status, 200);
  assertEquals(callback, `http://localhost:8491/paid/visit/${GROUP}`);
  assertEquals((body.data as Record<string, unknown>).returnUrl, callback);
  assert(!callback.includes(TOKEN), "the return carries no token");
});

Deno.test("W4-S2 no channel and channel web keep today's /visit/<id>?paid=1", async () => {
  for (const extra of [{}, { channel: "web" }]) {
    const { status, callback } = await payWith(extra);
    assertEquals(status, 200);
    assertEquals(callback, `http://localhost:8491/visit/${GROUP}?paid=1`);
  }
});

Deno.test("W4-S3 hostile channel values keep today's return (strict equality only)", async () => {
  const hostile: unknown[] = [
    "APP",
    " app",
    "app ",
    "app\u0000",
    "https://evil.example/steal",
    ["app"],
    { channel: "app" },
    1,
    true,
    null,
  ];
  for (const channel of hostile) {
    const { status, callback } = await payWith({ channel });
    assertEquals(status, 200, `channel ${JSON.stringify(channel)}`);
    assertEquals(
      callback,
      `http://localhost:8491/visit/${GROUP}?paid=1`,
      `channel ${JSON.stringify(channel)}`,
    );
  }
});

Deno.test("W4-S4 a client return URL, amount or origin sent beside channel app is ignored; the charge is unchanged", async () => {
  const { status, callback, calls } = await payWith({
    channel: "app",
    returnUrl: "https://evil.example/r",
    callbackUrl: "https://evil.example/c",
    origin: "https://evil.example",
    amountMinor: 1,
    totalMinor: 1,
  });
  assertEquals(status, 200);
  assertEquals(callback, `http://localhost:8491/paid/visit/${GROUP}`);
  const prepare = calls.find((c) =>
    c.name === "issue_4490_prepare_offer_payment"
  );
  assert(prepare, "prepare ran");
  // Exactly the parameters the web path sends: the channel adds none.
  assertEquals(Object.keys(prepare.params).sort(), [
    "p_expected_version",
    "p_group_id",
    "p_idempotency_key",
    "p_pay_mode",
    "p_token_hash",
    "p_user_id",
  ]);
});

Deno.test("W4-S5 the app channel never moves the origin off the server's own (production fallback)", () => {
  assertEquals(
    offerPayReturnUrl(() => undefined, GROUP, "app"),
    `https://host.usemingla.com/paid/visit/${GROUP}`,
  );
  assertEquals(
    offerPayReturnUrl(() => undefined, GROUP, undefined),
    `https://host.usemingla.com/visit/${GROUP}?paid=1`,
  );
  // A non-loopback, non-production origin in env is refused by the shared rule.
  assertEquals(
    offerPayReturnUrl(
      (n) =>
        ({
          BUSINESS_WEB_ORIGIN: "https://evil.example",
          SUPABASE_URL: "https://x.supabase.co",
        })[n],
      GROUP,
      "app",
    ),
    `https://host.usemingla.com/paid/visit/${GROUP}`,
  );
});
