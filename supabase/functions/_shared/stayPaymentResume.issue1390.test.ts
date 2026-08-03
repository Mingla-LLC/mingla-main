import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createStayPaymentSession } from "./stayPaymentProvider.ts";

const pendingStripe = {
  attemptId: "00000000-1390-4000-8000-000000000201",
  groupId: "00000000-1390-4000-8000-000000000202",
  provider: "stripe" as const,
  providerPaymentRef: "pi_stay_existing",
  connectedAccountRef: "acct_stay",
  amountMinor: "25000",
  currencyCode: "USD",
  applicationFeeMinor: "2500",
  buyerEmail: "guest@example.test",
  state: "pending",
};

Deno.test("pending Stripe Stay attempt resumes its bound PaymentIntent without creating another", async () => {
  let created = false;
  const result = await createStayPaymentSession(
    pendingStripe,
    `stay:payment:${pendingStripe.groupId}`,
    {
      createStripe: () => ({
        paymentIntents: {
          create: () => {
            created = true;
            throw new Error("must not create");
          },
          retrieve: (
            paymentIntentId: string,
            _params: Record<string, unknown>,
            options: Record<string, unknown>,
          ) => {
            assertEquals(paymentIntentId, "pi_stay_existing");
            assertEquals(options.stripeAccount, "acct_stay");
            return Promise.resolve({
              id: "pi_stay_existing",
              client_secret: "pi_stay_existing_secret",
              amount: 25000,
              currency: "usd",
              status: "requires_payment_method",
              metadata: {
                mingla_purpose: "stay_reservation",
                stay_group_id: pendingStripe.groupId,
                stay_payment_attempt_id: pendingStripe.attemptId,
              },
            });
          },
        },
      }) as never,
      publishableKey: () => "pk_test_stay",
    },
  );

  assertEquals(created, false);
  assertEquals(result.kind, "requires_payment");
  assertEquals(result.providerPaymentRef, "pi_stay_existing");
});

Deno.test("pending Paystack Stay attempt is held instead of initialized twice", async () => {
  let initialized = false;
  await assertRejects(
    () =>
      createStayPaymentSession(
        {
          ...pendingStripe,
          provider: "paystack",
          providerPaymentRef: "mingla_stay_existing",
          connectedAccountRef: "ACCT_brand",
          currencyCode: "NGN",
        },
        `stay:payment:${pendingStripe.groupId}`,
        {
          initializePaystack: () => {
            initialized = true;
            throw new Error("must not initialize");
          },
        },
      ),
    Error,
    "stay_payment_already_pending",
  );
  assertEquals(initialized, false);
});

Deno.test("Stripe Stay resume refuses mismatched immutable metadata", async () => {
  await assertRejects(
    () =>
      createStayPaymentSession(
        pendingStripe,
        `stay:payment:${pendingStripe.groupId}`,
        {
          createStripe: () => ({
            paymentIntents: {
              retrieve: () =>
                Promise.resolve({
                  id: "pi_stay_existing",
                  client_secret: "pi_stay_existing_secret",
                  amount: 25000,
                  currency: "usd",
                  status: "requires_payment_method",
                  metadata: {
                    mingla_purpose: "stay_reservation",
                    stay_group_id: "00000000-1390-4000-8000-000000000999",
                    stay_payment_attempt_id: pendingStripe.attemptId,
                  },
                }),
            },
          }) as never,
        },
      ),
    Error,
    "stay_invalid_provider_preparation",
  );
});

Deno.test("both Stay clients derive the payment key from the reservation group", async () => {
  for (
    const [path, surface] of [
      ["mingla-business/src/services/stayGuestService.ts", "web"],
      ["app-mobile/src/services/stayGuestService.ts", "native"],
    ] as const
  ) {
    const source = await Deno.readTextFile(path);
    assertEquals(
      source.includes(
        "idempotencyKey: `stay:payment:${group.groupId}`",
      ),
      true,
      `${path} must reuse the same payment key after refresh or retry`,
    );
    assertEquals(
      source.includes('idempotencyKey: idempotencyKey("payment")'),
      false,
      `${path} must not mint a payment key per click`,
    );
    assertEquals(
      source.includes(`surface: "${surface}"`),
      true,
      `${path} must identify its validated payment presentation surface`,
    );
  }
});
