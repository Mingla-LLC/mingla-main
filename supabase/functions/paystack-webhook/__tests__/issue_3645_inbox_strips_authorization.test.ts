// Issue #3645 — the webhook inbox keeps only the masked card reference.
// Fails on revert: storing `payload: event` again keeps the saved-card value.
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { inboxPayloadForPaystackEvent } from "../inboxPayload.ts";

const event = {
  event: "charge.success",
  data: {
    reference: "mingla_x",
    amount: 270625,
    customer: { email: "payer@example.test" },
    authorization: { authorization_code: "AUTH_secret01", last4: "4081", brand: "visa", bank: "TEST BANK", reusable: true },
  },
};

Deno.test("#3645 inbox payload drops the saved-card value and keeps the masked reference", () => {
  const stored = inboxPayloadForPaystackEvent(event) as typeof event;
  assert(!JSON.stringify(stored).includes("AUTH_secret01"));
  assertEquals(stored.data.authorization.last4, "4081");
  assertEquals(stored.data.authorization.brand, "visa");
  assertEquals(stored.data.reference, "mingla_x");
  // The original event (handed to the handlers) is untouched.
  assertEquals(event.data.authorization.authorization_code, "AUTH_secret01");
});

Deno.test("#3645 events without a card pass through unchanged", () => {
  const transfer = { event: "transfer.success", data: { reference: "t1" } };
  assertEquals(inboxPayloadForPaystackEvent(transfer), transfer);
  assertEquals(inboxPayloadForPaystackEvent(null), null);
});

Deno.test("#3645 the webhook stores the stripped payload, never the raw event", async () => {
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assert(src.includes("payload: inboxPayloadForPaystackEvent(event)"));
  assert(!/payload:\s*event\s*,/.test(src));
});
