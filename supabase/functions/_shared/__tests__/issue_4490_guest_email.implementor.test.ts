// N139 (#4490): reserved test domains are refused before the payment call, and
// a provider refusal about the email gets words, never a raw error.
// Fails-on-revert: removing the reserved-domain check lets example.test through.
import { assertEquals } from "jsr:@std/assert@1";

import {
  paystackRefusedEmail,
  VENUE_ORDER_ERRORS,
  venueOrderEmailUndeliverable,
} from "../venueOrderPricing.ts";

Deno.test("N139 reserved domains are undeliverable", () => {
  for (const e of ["bola@example.test", "a@x.invalid", "a@site.example", "a@localhost", "a@box.local"]) {
    assertEquals(venueOrderEmailUndeliverable(e), true, e);
  }
});

Deno.test("N139 ordinary addresses are fine", () => {
  for (const e of ["tester-4490@example.com", "ada@gmail.com", "chef@palmandpepper.ng", "a@testing.co"]) {
    assertEquals(venueOrderEmailUndeliverable(e), false, e);
  }
});

Deno.test("N139 a provider email refusal maps to words", () => {
  assertEquals(paystackRefusedEmail("Paystack initialize failed (400): Invalid Email Address Passed"), true);
  assertEquals(paystackRefusedEmail("Paystack initialize failed (500): unknown error"), false);
  assertEquals(VENUE_ORDER_ERRORS.buyer_email_undeliverable.guest.includes("receipts"), true);
});
