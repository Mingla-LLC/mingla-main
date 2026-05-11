import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  cancelPaymentIntentIfClientAvailable,
  classifyNotificationProviderFailure,
  classifyStripePaymentIntentCreateFailure,
  qrTokenPepper,
} from "../ticketCheckout.ts";

Deno.test("qrTokenPepper rejects missing, fallback, and short values", () => {
  const prior = Deno.env.get("app.qr_token_pepper");
  try {
    Deno.env.delete("app.qr_token_pepper");
    assertRejects(
      () => Promise.resolve().then(() => qrTokenPepper()),
      Error,
      "qr_token_pepper_missing",
    );

    Deno.env.set("app.qr_token_pepper", "local-ticket-pepper");
    assertRejects(
      () => Promise.resolve().then(() => qrTokenPepper()),
      Error,
      "qr_token_pepper_missing",
    );

    Deno.env.set("app.qr_token_pepper", "short");
    assertRejects(
      () => Promise.resolve().then(() => qrTokenPepper()),
      Error,
      "qr_token_pepper_missing",
    );
  } finally {
    if (prior === undefined) Deno.env.delete("app.qr_token_pepper");
    else Deno.env.set("app.qr_token_pepper", prior);
  }
});

Deno.test("qrTokenPepper returns a trimmed non-default secret without logging it", () => {
  const prior = Deno.env.get("app.qr_token_pepper");
  const value = "  12345678901234567890123456789012  ";
  try {
    Deno.env.set("app.qr_token_pepper", value);
    assertEquals(qrTokenPepper(), value.trim());
  } finally {
    if (prior === undefined) Deno.env.delete("app.qr_token_pepper");
    else Deno.env.set("app.qr_token_pepper", prior);
  }
});

Deno.test("notification provider failures classify auth/config errors as terminal without sensitive payloads", () => {
  const resend = classifyNotificationProviderFailure("resend", 403, {
    name: "validation_error",
    message: "domain not verified for recipient@example.test",
  });
  assertEquals(resend.retryable, false);
  assertEquals(resend.detail, "resend_send_failed:403:config:validation_error");

  const twilio = classifyNotificationProviderFailure("twilio", 500, {
    error_code: "20429",
    message: "transient provider issue",
  });
  assertEquals(twilio.retryable, true);
  assertEquals(twilio.detail, "twilio_send_failed:500:retryable:20429");
});

Deno.test("Stripe PaymentIntent create failures map to structured checkout errors", () => {
  const restrictedKey = classifyStripePaymentIntentCreateFailure({
    statusCode: 403,
    code: "permission_error",
    type: "StripePermissionError",
    message: "secret text must not be surfaced",
  });
  assertEquals(restrictedKey.httpStatus, 502);
  assertEquals(
    restrictedKey.detail,
    "stripe_payment_intent_create_failed:403:stripe_key_or_capability_config:permission_error:StripePermissionError",
  );

  const accountShape = classifyStripePaymentIntentCreateFailure({
    statusCode: 400,
    code: "parameter_invalid_empty",
  });
  assertEquals(accountShape.httpStatus, 409);
  assertEquals(
    accountShape.detail,
    "stripe_payment_intent_create_failed:400:stripe_request_or_account_config:parameter_invalid_empty",
  );
});

Deno.test("paid checkout persist failure cancel uses the provided nullable Stripe client", async () => {
  const canceledPaymentIntentIds: string[] = [];
  const idempotencyKeys: string[] = [];
  const stripe = {
    paymentIntents: {
      cancel: (paymentIntentId: string, options: { idempotencyKey: string }) => {
        canceledPaymentIntentIds.push(paymentIntentId);
        idempotencyKeys.push(options.idempotencyKey);
        return Promise.resolve({ id: paymentIntentId });
      },
    },
  };

  assertEquals(
    await cancelPaymentIntentIfClientAvailable(stripe, "pi_persist_failure_test"),
    true,
  );
  assertEquals(canceledPaymentIntentIds, ["pi_persist_failure_test"]);
  assertEquals(idempotencyKeys, ["ticket_checkout_cancel:pi_persist_failure_test"]);
  assertEquals(
    await cancelPaymentIntentIfClientAvailable(null, "pi_not_created"),
    false,
  );
  assertEquals(canceledPaymentIntentIds, ["pi_persist_failure_test"]);
  assertEquals(idempotencyKeys, ["ticket_checkout_cancel:pi_persist_failure_test"]);
});
