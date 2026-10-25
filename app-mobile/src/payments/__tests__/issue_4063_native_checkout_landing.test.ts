import assert from "node:assert/strict";
import test from "node:test";

import { resolveNativeCheckoutLanding } from "../nativeCheckoutLanding.ts";

test("account-owned and legacy checkout results land on the purchase", () => {
  assert.deepEqual(resolveNativeCheckoutLanding("order-1", true, "Ada Buyer"), {
    kind: "purchase",
    href: "/purchases/order/order-1",
  });
  assert.deepEqual(resolveNativeCheckoutLanding("order-2", undefined), {
    kind: "purchase",
    href: "/purchases/order/order-2",
  });
});

test("unattached checkout results show sent confirmation without exposing a ticket route", () => {
  assert.deepEqual(resolveNativeCheckoutLanding("order-3", false, "  Tolu Ade  "), {
    kind: "sent",
    buyerFirstName: "Tolu",
  });
  assert.deepEqual(resolveNativeCheckoutLanding("order-4", false, ""), {
    kind: "sent",
    buyerFirstName: null,
  });
});
