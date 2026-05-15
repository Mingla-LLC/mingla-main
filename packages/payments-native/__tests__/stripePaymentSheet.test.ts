// ORCH-0789: verify the wrapper preserves Stripe's PaymentSheetError code
// discriminator (Canceled / Failed / Timeout) so callers can distinguish
// user-cancel from card-decline. Direct unit test against the exported
// normalize function — no useStripe / RN runtime required.
//
// Migrated to @mingla/payments-native per META-ORCH-0827 Pass 2.

import { describe, expect, test } from "@jest/globals";

import { normalizePaymentSheetResult as normalize } from "../normalizePaymentSheetResult";

describe("stripePaymentSheet wrapper — normalize", () => {
  test("returns empty object when Stripe returns no error", () => {
    expect(normalize({})).toEqual({});
  });

  test("preserves Canceled code (T-01)", () => {
    const result = normalize({
      error: { code: "Canceled", message: "The payment has been canceled" },
    });
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe("Canceled");
    expect(result.error?.message).toBe("The payment has been canceled");
  });

  test("preserves Failed code + declineCode (T-02)", () => {
    const result = normalize({
      error: {
        code: "Failed",
        message: "Card declined",
        declineCode: "insufficient_funds",
        localizedMessage: "Your card was declined.",
      },
    });
    expect(result.error?.code).toBe("Failed");
    expect(result.error?.declineCode).toBe("insufficient_funds");
    expect(result.error?.localizedMessage).toBe("Your card was declined.");
  });

  test("preserves Timeout code", () => {
    const result = normalize({
      error: { code: "Timeout", message: "Stripe took too long" },
    });
    expect(result.error?.code).toBe("Timeout");
  });

  test("coerces unknown Stripe code to Failed (T-03 — conservative default)", () => {
    const result = normalize({
      error: { code: "SomeWeirdCode", message: "?" },
    });
    expect(result.error?.code).toBe("Failed");
    expect(result.error?.message).toBe("?");
  });

  test("supplies a fallback message when Stripe omits one", () => {
    const result = normalize({ error: { code: "Failed" } });
    expect(result.error?.message).toBe("Payment failed");
  });

  test("does not include optional fields when Stripe omits them", () => {
    const result = normalize({
      error: { code: "Canceled", message: "x" },
    });
    expect(result.error?.declineCode).toBeUndefined();
    expect(result.error?.localizedMessage).toBeUndefined();
    expect(result.error?.stripeErrorCode).toBeUndefined();
  });
});
