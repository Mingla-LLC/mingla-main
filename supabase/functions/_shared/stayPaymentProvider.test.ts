import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createStayPaymentSession } from "./stayPaymentProvider.ts";

const prepared = {
  attemptId: "00000000-1389-4000-8000-000000000201",
  groupId: "00000000-1389-4000-8000-000000000202",
  provider: "stripe" as const,
  connectedAccountRef: "acct_stay",
  amountMinor: "25000",
  currencyCode: "USD",
  applicationFeeMinor: "2500",
  buyerEmail: "guest@example.test",
  state: "created",
};

Deno.test("Stripe Stay provider creates a direct charge with exact metadata and app fee", async () => {
  const captured: Array<Record<string, unknown>> = [];
  const result = await createStayPaymentSession(prepared, "provider-key-1389", {
    createStripe: () => ({
      paymentIntents: {
        create: (
          body: Record<string, unknown>,
          options: Record<string, unknown>,
        ) => {
          captured.push(body, options);
          return Promise.resolve({
            id: "pi_stay",
            client_secret: "pi_stay_secret",
          });
        },
      },
    }) as never,
    publishableKey: () => "pk_test_stay",
  });
  assertEquals(captured[0].amount, 25000);
  assertEquals(captured[0].application_fee_amount, 2500);
  assertEquals(
    (captured[0].metadata as Record<string, unknown>).mingla_purpose,
    "stay_reservation",
  );
  assertEquals(captured[1].stripeAccount, "acct_stay");
  assertEquals(result.kind, "requires_payment");
});

Deno.test("Paystack Stay provider never sends legacy split fields", async () => {
  let initialize: Record<string, unknown> | null = null;
  const result = await createStayPaymentSession({
    ...prepared,
    provider: "paystack",
    connectedAccountRef: "ACCT_brand",
    currencyCode: "NGN",
  }, "provider-key-1389", {
    initializePaystack: (params) => {
      initialize = params as unknown as Record<string, unknown>;
      return Promise.resolve({
        authorization_url: "https://paystack.test/stay",
        access_code: "access",
        reference: "mingla_stay_reference",
      });
    },
  });
  assertEquals("subaccount" in (initialize ?? {}), false);
  assertEquals("transactionChargeSubunits" in (initialize ?? {}), false);
  assertEquals(result.kind, "requires_redirect");
});

Deno.test("provider amount outside shared integer rail is rejected before I/O", async () => {
  await assertRejects(
    () =>
      createStayPaymentSession({
        ...prepared,
        amountMinor: "2147483648",
      }, "provider-key-1389"),
    Error,
    "stay_invalid_provider_amount",
  );
});
