// #4490 spec 06 W4 fix 1 (W4-N3): one live payment page per booking.
//
//   F1-1 the database hands back the open attempt (`reused`) → the SAME page
//        is returned; the provider is never asked for a second one
//   F1-2 a new page is remembered for its attempt after it is bound
//   F1-3 two `pay` calls for one booking with different keys, in parallel,
//        against a stub that keeps the SQL rule (one booking, one payment at
//        a time; an open payment of the same stage and amount answers with
//        its page; a fresh one still talking to the provider is "in
//        progress"): ONE provider page, ONE pending attempt
//   F1-4 a different stage at the same time → 409 offer_payment_mode_conflict
//   F1-5 a reused answer that is not a Paystack page is never returned
//
// FAILS-ON-REVERT: drop the `reusedPaymentPage` early return in `pay` and F1-1
// and F1-3 fail (the provider is asked again); drop `rememberPaymentPage` and
// F1-2 fails; drop "offer_payment_mode_conflict" from SAFE_CODES and F1-4
// fails (it becomes offer_request_failed, 500).
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createVenueOffersHandler,
  resetVenueOffersRateLimitForTests,
  type ServiceClient,
} from "./index.ts";
import { reusedPaymentPage } from "../_shared/venueOfferPaymentPage.ts";

const GROUP = "00000000-4490-4000-8000-0000000014a1";
const TOKEN = "T".repeat(43);
const PAGE = "https://checkout.paystack.com/w4fix1page";
const ENV: Record<string, string> = {
  SUPABASE_URL: "http://127.0.0.1:57521",
  BUSINESS_WEB_ORIGIN: "http://localhost:8491",
};

type Attempt = {
  id: string;
  stage: string;
  amount: string;
  state: "created" | "pending";
  ref: string | null;
  page: string | null;
};

/** An in-memory booking that keeps the SQL rule of 20281203484490. */
function booking() {
  const attempts: Attempt[] = [];
  const calls: string[] = [];
  let lock: Promise<void> = Promise.resolve();
  const serial = <T>(fn: () => T): Promise<T> => {
    const run = lock.then(fn);
    lock = run.then(() => undefined, () => undefined);
    return run;
  };
  const client = (): ServiceClient => ({
    rpc: (name, params) => {
      calls.push(name);
      if (name === "issue_4490_prepare_offer_payment") {
        return serial(() => {
          const stage = params.p_pay_mode === "deposit" ? "deposit" : "full";
          const amount = stage === "deposit" ? "2687500" : "5375000";
          const live = attempts.find((a) =>
            a.state === "pending" || a.state === "created"
          );
          if (live) {
            if (live.stage !== stage || live.amount !== amount) {
              return {
                data: null,
                error: {
                  code: "PT409",
                  message: "offer_payment_mode_conflict",
                },
              };
            }
            if (live.state === "pending" && live.page !== null) {
              return {
                data: {
                  attemptId: live.id,
                  groupId: GROUP,
                  provider: "paystack",
                  state: "pending",
                  amountMinor: live.amount,
                  currencyCode: "NGN",
                  providerPaymentRef: live.ref,
                  stage,
                  reused: true,
                  checkoutUrl: live.page,
                },
                error: null,
              };
            }
            return {
              data: null,
              error: {
                code: "PT409",
                message: "offer_payment_already_pending",
              },
            };
          }
          const a: Attempt = {
            id: `00000000-4490-4000-8000-0000000015${
              String(attempts.length).padStart(2, "0")
            }`,
            stage,
            amount,
            state: "created",
            ref: null,
            page: null,
          };
          attempts.push(a);
          return {
            data: {
              attemptId: a.id,
              groupId: GROUP,
              provider: "paystack",
              state: "created",
              amountMinor: amount,
              currencyCode: "NGN",
              stage,
            },
            error: null,
          };
        }) as Promise<{ data: unknown; error: null }>;
      }
      if (name === "issue_1389_bind_payment_attempt") {
        const a = attempts.find((x) => x.id === params.p_attempt_id);
        if (a) {
          a.state = "pending";
          a.ref = String(params.p_provider_payment_ref);
        }
      }
      if (name === "issue_4490_record_payment_page") {
        const a = attempts.find((x) => x.id === params.p_attempt_id);
        if (a && a.state === "pending") a.page = String(params.p_checkout_url);
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
  return { attempts, calls, client };
}

function payRequest(key: string, payMode: string | null = null): Request {
  return new Request("http://local/venue-offers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "pay",
      groupId: GROUP,
      token: TOKEN,
      idempotencyKey: key,
      expectedVersion: 2,
      channel: "app",
      ...(payMode ? { payMode } : {}),
    }),
  });
}

function handler(
  b: ReturnType<typeof booking>,
  pages: string[],
  providerDelayMs = 0,
) {
  return createVenueOffersHandler({
    client: b.client,
    env: (n) => ENV[n],
    createPaymentSession: async (prepared) => {
      pages.push(String(prepared.attemptId));
      if (providerDelayMs > 0) {
        await new Promise((r) => setTimeout(r, providerDelayMs));
      }
      return {
        kind: "requires_redirect",
        provider: "paystack",
        attemptId: prepared.attemptId,
        providerPaymentRef: `mingla_stay_${
          prepared.attemptId.replaceAll("-", "")
        }`,
        authorizationUrl: PAGE,
        amountMinor: prepared.amountMinor,
        currencyCode: "NGN",
      };
    },
  });
}

Deno.test("F1-1 an open payment of the same stage and amount: its own page again, no second provider page", async () => {
  resetVenueOffersRateLimitForTests();
  const b = booking();
  const pages: string[] = [];
  const h = handler(b, pages);
  const first = await h(payRequest("venue-app-pay-fix1-0001"));
  assertEquals(first.status, 200);
  const second = await h(payRequest("venue-web-pay-fix1-0002"));
  assertEquals(second.status, 200);
  const a = (await first.json()).data;
  const c = (await second.json()).data;
  assertEquals(c.authorizationUrl, a.authorizationUrl);
  assertEquals(c.providerPaymentRef, a.providerPaymentRef);
  assertEquals(c.attemptId, a.attemptId);
  assertEquals(pages.length, 1, "the provider is asked for one page only");
  assertEquals(b.attempts.length, 1);
});

Deno.test("F1-2 a new page is remembered for its attempt after it is bound", async () => {
  resetVenueOffersRateLimitForTests();
  const b = booking();
  const res = await handler(b, [])(payRequest("venue-app-pay-fix1-0003"));
  assertEquals(res.status, 200);
  const bind = b.calls.indexOf("issue_1389_bind_payment_attempt");
  const remember = b.calls.indexOf("issue_4490_record_payment_page");
  assert(bind >= 0 && remember > bind, "remembered after the bind");
  assertEquals(b.attempts[0].page, PAGE);
});

Deno.test("F1-3 two parallel pay calls (different keys): one provider page, one pending attempt", async () => {
  resetVenueOffersRateLimitForTests();
  const b = booking();
  const pages: string[] = [];
  const h = handler(b, pages, 30);
  const [r1, r2] = await Promise.all([
    h(payRequest("venue-app-pay-fix1-0004")),
    h(payRequest("venue-web-pay-fix1-0005")),
  ]);
  const statuses = [r1.status, r2.status].sort();
  const bodies = [await r1.json(), await r2.json()];
  assertEquals(pages.length, 1, "exactly one provider page");
  assertEquals(
    b.attempts.filter((a) => a.state === "pending").length,
    1,
    "one pending attempt",
  );
  assertEquals(b.attempts.length, 1);
  // The second caller arrived while the first was still talking to the
  // provider: it is told a payment is in progress (it never gets a page of its own).
  assertEquals(statuses, [200, 409]);
  assert(bodies.some((x) => x.code === "offer_payment_already_pending"));
  // A moment later the same second device gets the first page.
  const again = await h(payRequest("venue-web-pay-fix1-0006"));
  assertEquals(again.status, 200);
  assertEquals((await again.json()).data.authorizationUrl, PAGE);
  assertEquals(pages.length, 1);
});

Deno.test("F1-4 Half now on one device while All now is open on another: refused in a plain code", async () => {
  resetVenueOffersRateLimitForTests();
  const b = booking();
  const h = handler(b, []);
  assertEquals(
    (await h(payRequest("venue-app-pay-fix1-0007", "full"))).status,
    200,
  );
  const other = await h(payRequest("venue-web-pay-fix1-0008", "deposit"));
  assertEquals(other.status, 409);
  assertEquals((await other.json()).code, "offer_payment_mode_conflict");
  assertEquals(b.attempts.length, 1);
});

Deno.test("F1-5 only a remembered Paystack page is ever handed back", () => {
  const base = {
    reused: true,
    provider: "paystack",
    state: "pending",
    attemptId: "a",
    providerPaymentRef: "ref",
    amountMinor: "100",
    currencyCode: "NGN",
  };
  assert(reusedPaymentPage({ ...base, checkoutUrl: PAGE }) !== null);
  for (
    const bad of [
      { ...base, checkoutUrl: "https://evil.example/pay" },
      { ...base, checkoutUrl: "http://checkout.paystack.com/x" },
      { ...base, checkoutUrl: PAGE, provider: "stripe" },
      { ...base, checkoutUrl: PAGE, state: "created" },
      { ...base, checkoutUrl: PAGE, reused: false },
      { ...base, checkoutUrl: PAGE, providerPaymentRef: null },
    ]
  ) {
    assertEquals(reusedPaymentPage(bad), null, JSON.stringify(bad));
  }
});
