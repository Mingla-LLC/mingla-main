import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { checkoutIdempotencyKey } from "../../_shared/ticketCheckout.ts";
import { canonicalCheckoutV2FingerprintInput } from "../../../../packages/offering-rendering/ticketCheckoutServerContract.ts";

const EVENT = "3872a000-0000-4000-8400-000000000001";
const ATTEMPT = "3872a000-0000-4000-8400-000000000002";
const TIER = "3872a000-0000-4000-8400-000000000003";
const legacyInput = {
  eventId: EVENT,
  buyerEmail: "buyer@example.com",
  buyerPhoneE164: "+447700900123",
  lines: [{ ticketTypeId: TIER, quantity: 2 }],
};

Deno.test("#3872 v1 code-less idempotency stays byte-identical", () => {
  const before = [
    "ticket_checkout",
    EVENT,
    "buyer@example.com",
    "+447700900123",
    `${TIER}:2`,
  ].join(":");
  assertEquals(checkoutIdempotencyKey(legacyInput), before);
  assertEquals(
    checkoutIdempotencyKey({ ...legacyInput, discountCode: null }),
    before,
  );
  assertEquals(
    checkoutIdempotencyKey({ ...legacyInput, discountCode: "SAVE10" }),
    `${before}:code:SAVE10`,
  );
});

const fingerprintInput = {
  eventId: EVENT,
  checkoutAttemptId: ATTEMPT,
  purchaseTermsAccepted: true,
  buyer: {
    userId: null,
    name: "Buyer",
    email: "buyer@example.com",
    phoneE164: "+447700900123",
    marketingOptIn: false,
  },
  providerInput: { surface: "web" as const },
  lines: [{
    ticketTypeId: TIER,
    quantity: 2,
    unitPriceCents: 2_250,
    totalCents: 4_500,
    paymentPlanChoice: "full" as const,
  }],
  eventDateId: null,
  eventDateIds: [],
  intakeFormData: [],
  quote: {
    currency: "GBP",
    fullPriceCents: 4_500,
    dueTodayCents: 4_500,
    installmentSchedule: null,
  },
};

Deno.test("#3872 v2 fingerprint changes only when a code is present", () => {
  const without = canonicalCheckoutV2FingerprintInput(fingerprintInput);
  assertEquals(
    canonicalCheckoutV2FingerprintInput({
      ...fingerprintInput,
      discountCode: null,
    }),
    without,
  );
  assertNotEquals(
    canonicalCheckoutV2FingerprintInput({
      ...fingerprintInput,
      discountCode: "SAVE10",
    }),
    without,
  );
});
