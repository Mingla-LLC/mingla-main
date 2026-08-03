import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderCategoryMessage } from "./notifyTemplates.ts";

Deno.test("Stay refund copy formats the source currency without a dollar fallback", () => {
  const rendered = renderCategoryMessage("stay_refund_state", {
    amount_cents: 125000,
    currency: "NGN",
  });
  assertStringIncludes(rendered.email.body, "NGN");
  assertEquals(rendered.email.body.includes("$"), false);
});

Deno.test("Stay payment-required copy carries the server deadline", () => {
  const rendered = renderCategoryMessage("stay_payment_required", {
    payment_deadline: "2027-02-01T12:30:00+01:00",
  });
  assertStringIncludes(
    rendered.push.body,
    "2027-02-01T12:30:00+01:00",
  );
});
