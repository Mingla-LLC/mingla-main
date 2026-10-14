import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { classifyStripeCheckoutConfirmationStatus } from "../ticketCheckoutConfirmationStatus.ts";

Deno.test("#3859 Stripe confirmation keeps every money-in-flight state pending", () => {
  for (const status of ["processing", "requires_action", "requires_capture"]) {
    assertEquals(classifyStripeCheckoutConfirmationStatus(status), "pending");
  }
});

Deno.test("#3859 Stripe confirmation succeeds only on provider success", () => {
  assertEquals(classifyStripeCheckoutConfirmationStatus("succeeded"), "paid");
  for (const status of ["canceled", "requires_payment_method", "requires_confirmation", ""]) {
    assertEquals(classifyStripeCheckoutConfirmationStatus(status), "failed");
  }
});
