import {
  assertEquals,
  assertExists,
  assertMatch,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  handlePaystackTestRequest,
  type PaystackTestHarnessDeps,
} from "../handler.ts";
import type {
  PaystackChargeAuthorizationParams,
  PaystackInitializeParams,
} from "../../_shared/paystack.ts";

function post(body: Record<string, unknown>) {
  return new Request("https://example.invalid/paystack-checkout-create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deps(
  overrides: Partial<PaystackTestHarnessDeps> = {},
): PaystackTestHarnessDeps {
  return {
    initialize: () => Promise.reject(new Error("unexpected initialize")),
    verify: () => Promise.reject(new Error("unexpected verify")),
    chargeAuthorization: () => Promise.reject(new Error("unexpected charge")),
    ...overrides,
  };
}

Deno.test("#3645 harness initialization is bounded, synthetic, card-only and PII-safe", async () => {
  let seen: PaystackInitializeParams | null = null;
  const response = await handlePaystackTestRequest(
    post({
      action: "initialize",
      amount: 1_250,
      email: "victim@example.com",
      currency: "USD",
      callback_url: "https://attacker.invalid",
      reference: "live-looking-ref",
      channels: ["bank"],
      metadata: { injected: true },
    }),
    deps({
      initialize: (params) => {
        seen = params;
        return Promise.resolve({
          authorization_url: "https://checkout.paystack.com/test-session",
          access_code: "must-not-leave-server",
          reference: String(params.reference),
        });
      },
    }),
  );

  assertEquals(response.status, 200);
  const initialized = seen as PaystackInitializeParams | null;
  assertExists(initialized);
  assertEquals(initialized.email, "test-buyer@usemingla.com");
  assertEquals(initialized.currency, "NGN");
  assertEquals(initialized.amountSubunits, 125_000);
  assertEquals(initialized.callbackUrl, "https://host.usemingla.com");
  assertEquals(initialized.channels, ["card"]);
  assertEquals(initialized.metadata, { source: "issue-3645-test-proof" });
  assertMatch(String(initialized.reference), /^mingla_test_checkout_/);
  const body = await response.json();
  assertEquals(body.mode, "test");
  assertEquals(body.access_code, undefined);
  assertEquals(JSON.stringify(body).includes("victim"), false);
});

Deno.test("#3645 harness refuses non-test references before provider access", async () => {
  let calls = 0;
  const response = await handlePaystackTestRequest(
    post({
      action: "verify",
      reference: "live_reference_123",
    }),
    deps({
      verify: () => {
        calls += 1;
        return Promise.resolve({});
      },
    }),
  );
  assertEquals(response.status, 400);
  assertEquals(calls, 0);
});

Deno.test("#3645 harness verifies and charges a reusable TEST authorization without leaking it", async () => {
  const sourceReference = "mingla_test_checkout_source123";
  let charged: PaystackChargeAuthorizationParams | null = null;
  const response = await handlePaystackTestRequest(
    post({
      action: "charge_authorization",
      source_reference: sourceReference,
      amount: 500,
    }),
    deps({
      verify: (reference) => {
        assertEquals(reference, sourceReference);
        return Promise.resolve({
          status: "success",
          authorization: {
            reusable: true,
            authorization_code: "AUTH_private_test_value",
            last4: "4081",
          },
          customer: { email: "test-buyer@usemingla.com" },
        });
      },
      chargeAuthorization: (params) => {
        charged = params;
        return Promise.resolve({
          kind: "response",
          httpStatus: 200,
          body: {
            status: true,
            data: { status: "success", id: 99, amount: 50_000, fees: 750 },
          },
        });
      },
    }),
  );

  assertEquals(response.status, 200);
  const chargedParams = charged as PaystackChargeAuthorizationParams | null;
  assertExists(chargedParams);
  assertEquals(chargedParams.authorizationCode, "AUTH_private_test_value");
  assertEquals(chargedParams.email, "test-buyer@usemingla.com");
  assertEquals(chargedParams.amountSubunits, 50_000);
  assertMatch(String(chargedParams.reference), /^mingla_test_installment_/);
  const bodyText = await response.text();
  assertEquals(bodyText.includes("AUTH_private_test_value"), false);
  assertEquals(bodyText.includes("test-buyer@usemingla.com"), false);
  assertEquals(bodyText.includes("4081"), false);
  assertEquals(JSON.parse(bodyText).outcome, "succeeded");
});

Deno.test("#3645 harness requires a successful reusable source and caps amounts", async () => {
  const tooLarge = await handlePaystackTestRequest(
    post({
      action: "initialize",
      amount: 10_001,
    }),
    deps(),
  );
  assertEquals(tooLarge.status, 400);

  let chargeCalls = 0;
  const unavailable = await handlePaystackTestRequest(
    post({
      action: "charge_authorization",
      source_reference: "mingla_test_checkout_not_reusable",
    }),
    deps({
      verify: () =>
        Promise.resolve({
          status: "success",
          authorization: { reusable: false, authorization_code: "AUTH_no" },
          customer: { email: "test-buyer@usemingla.com" },
        }),
      chargeAuthorization: () => {
        chargeCalls += 1;
        return Promise.resolve({
          kind: "network_error",
          message: "unexpected",
        });
      },
    }),
  );
  assertEquals(unavailable.status, 409);
  assertEquals(chargeCalls, 0);
});
