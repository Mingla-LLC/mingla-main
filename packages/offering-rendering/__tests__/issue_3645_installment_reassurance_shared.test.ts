import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { installmentReassuranceText } from "../installmentReassurance.ts";

Deno.test("#3645 shared reassurance describes card and secure-link collection without provider names", () => {
  const copy = installmentReassuranceText({
    depositFormatted: "₦2,706.25",
    remainingFormatted: "₦8,118.75",
    collection: "auto_card_or_pay_link",
  });
  assert(copy.includes("charge the same card automatically"));
  assert(copy.includes("email you a secure link to pay"));
  assert(copy.includes("bank may ask you to approve"));
  assert(!/stripe|paystack/i.test(copy));
});

Deno.test("#3645 projected schedules say dates lock on payment", () => {
  const copy = installmentReassuranceText({
    depositFormatted: "25%",
    remainingFormatted: "75%",
    isProjection: true,
  });
  assert(copy.includes("Dates assume you book today; they lock when you pay."));
  assertEquals((copy.match(/You're paying/g) ?? []).length, 1);
});
