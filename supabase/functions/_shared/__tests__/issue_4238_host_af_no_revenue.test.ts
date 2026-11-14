// MINGLA-INVARIANT: I-4238-HOST-EVENTS-NO-REVENUE | issue #4238 | no Host-app AppsFlyer S2S event carries af_revenue: the first ticket sale is mingla_host_first_sale and payouts are plain minor/major values by the currency's own exponent.
/**
 * #4238 W6-2 (D26). Host first sale went as af_purchase with the buyer gross
 * as af_revenue, and the first payout carried the payout as af_revenue, so
 * Host iOS showed $161 + $31 of "revenue" that is the host's money.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hostMoneyEventValues } from "../appsFlyerS2S.ts";
import {
  notifyPaystackReleaseOutcome,
  type OrganiserNotifyDeps,
} from "../organiserPayoutNotify.ts";

Deno.test("#4238 W6-2 host money values: minor kept, major by exponent, JPY 1500 stays 1500", () => {
  assertEquals(hostMoneyEventValues("payout", 1500, "jpy"), {
    payout_minor: 1500,
    payout: 1500,
    currency: "JPY",
  });
  assertEquals(hostMoneyEventValues("ticket_gross", 16100, "usd"), {
    ticket_gross_minor: 16100,
    ticket_gross: 161,
    currency: "USD",
  });
  assertEquals(hostMoneyEventValues("payout", 450000, "NGN").payout, 4500);
});

function paystackRelease(currency: string, cents: number) {
  return {
    from: () => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: () =>
          Promise.resolve({
            data: {
              id: "rel-1",
              brand_id: "brand-1",
              status: "released",
              currency,
              organiser_cash_delivered_cents: cents,
              net_release_cents: cents,
            },
            error: null,
          }),
      };
      return b;
    },
  } as never;
}

Deno.test("#4238 W6-2 the Paystack first payout carries no af_revenue", async () => {
  const posts: Array<{ eventName: string; eventValues?: Record<string, unknown> }> = [];
  const deps: OrganiserNotifyDeps = {
    notifyBrandManagers: async () => {},
    claimMilestone: async () => true,
    resolveOwnerUserId: async () => "owner-1",
    postAppsFlyer: async (input) => {
      posts.push(input as never);
      return true;
    },
  };
  await notifyPaystackReleaseOutcome(paystackRelease("ngn", 3100), "rel-1", deps);
  assertEquals(posts.length, 1);
  assertEquals(posts[0].eventName, "mingla_first_payout");
  const values = posts[0].eventValues ?? {};
  assertEquals("af_revenue" in values, false);
  assertEquals("af_currency" in values, false);
  assertEquals(values.payout_minor, 3100);
  assertEquals(values.payout, 31);
  assertEquals(values.currency, "NGN");
});

Deno.test("#4238 W6-2 Stripe first sale is mingla_host_first_sale and no Host S2S body sets af_revenue", async () => {
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const read = (rel: string) => Deno.readTextFile(new URL(rel, import.meta.url)).then(strip);
  const router = await read("../stripeWebhookRouter.ts");
  assert(router.includes('eventName: "mingla_host_first_sale"'));
  assert(!router.includes('eventName: "af_purchase"'), "no af_purchase from the Host first sale");
  assert(router.includes('...hostMoneyEventValues("ticket_gross", amountCents, currency)'));
  assert(router.includes('...hostMoneyEventValues("payout", amountCents, currency)'));
  for (const rel of ["../stripeWebhookRouter.ts", "../organiserPayoutNotify.ts", "../stripeDisputeHandlers.ts"]) {
    assert(!(await read(rel)).includes("af_revenue"), `${rel} must not send af_revenue`);
  }
});
