import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  paystackInitializeTransaction,
  paystackVerifyTransaction,
  resolvePaystackSecretKeyForMode,
} from "../paystack.ts";
import { chargePaystackTestAuthorization } from "../installments/chargePaystackInstallment.ts";

const ORIGINAL = {
  mode: Deno.env.get("PAYSTACK_MODE"),
  test: Deno.env.get("PAYSTACK_SECRET_KEY_TEST"),
  live: Deno.env.get("PAYSTACK_SECRET_KEY_LIVE"),
};

function restoreEnv() {
  for (
    const [name, value] of [
      ["PAYSTACK_MODE", ORIGINAL.mode],
      ["PAYSTACK_SECRET_KEY_TEST", ORIGINAL.test],
      ["PAYSTACK_SECRET_KEY_LIVE", ORIGINAL.live],
    ] as const
  ) {
    if (value === undefined) Deno.env.delete(name);
    else Deno.env.set(name, value);
  }
}

Deno.test({
  name: "#3645 explicit TEST mode never inherits a live runtime",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    try {
      Deno.env.set("PAYSTACK_MODE", "live");
      Deno.env.set("PAYSTACK_SECRET_KEY_TEST", "sk_test_issue3645");
      Deno.env.set("PAYSTACK_SECRET_KEY_LIVE", "sk_live_issue3645");
      assertEquals(
        resolvePaystackSecretKeyForMode("test"),
        "sk_test_issue3645",
      );

      const authorizations: string[] = [];
      const fetchImpl: typeof fetch = (input, init) => {
        authorizations.push(
          new Headers(init?.headers).get("Authorization") ?? "",
        );
        const url = String(input);
        if (url.endsWith("/transaction/initialize")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                status: true,
                data: {
                  authorization_url: "https://checkout.paystack.com/test",
                  access_code: "test_access",
                  reference: "mingla_test_checkout_1",
                },
              }),
              { status: 200 },
            ),
          );
        }
        if (url.includes("/transaction/verify/")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                status: true,
                data: {
                  status: "success",
                  reference: "mingla_test_checkout_1",
                },
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: true,
              data: { status: "success", id: 42, amount: 50_000, fees: 750 },
            }),
            { status: 200 },
          ),
        );
      };

      await paystackInitializeTransaction({
        email: "test-buyer@usemingla.com",
        amountSubunits: 100_000,
        reference: "mingla_test_checkout_1",
      }, { mode: "test", fetchImpl });
      await paystackVerifyTransaction("mingla_test_checkout_1", {
        mode: "test",
        fetchImpl,
      });
      // [TEST-MOD-APPROVED #3645] Exercise the reviewed harness seam instead
      // of bypassing the sole Paystack installment rail owner.
      await chargePaystackTestAuthorization(
        {
          authorizationCode: "AUTH_test",
          email: "test-buyer@usemingla.com",
          amountSubunits: 50_000,
          reference: "mingla_test_installment_1",
        },
        fetchImpl,
      );

      assertEquals(authorizations.length, 3);
      for (const authorization of authorizations) {
        assertStringIncludes(authorization, "sk_test_issue3645");
        if (authorization.includes("sk_live_")) {
          throw new Error("explicit TEST request used the live secret");
        }
      }
    } finally {
      restoreEnv();
    }
  },
});

Deno.test("#3645 explicit mode rejects a mismatched key prefix", () => {
  try {
    Deno.env.set("PAYSTACK_SECRET_KEY_TEST", "sk_live_wrong_mode");
    let message = "";
    try {
      resolvePaystackSecretKeyForMode("test");
    } catch (error) {
      message = String((error as Error).message);
    }
    assertStringIncludes(message, 'expected "sk_test_..."');
  } finally {
    restoreEnv();
  }
});
