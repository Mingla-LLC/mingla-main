// Issue #3645 — the Admin order bundle must show the provider-tagged ledger
// truth, and payment-plan visibility refusals must be bounded human copy.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const ordersPage = fs.readFileSync(
  new URL("../pages/BusinessOrdersPage.jsx", import.meta.url),
  "utf8",
);
const offeringsService = fs.readFileSync(
  new URL("../services/offeringsService.js", import.meta.url),
  "utf8",
);

test("#3645 Admin order installments show provider, collection method, and all-in amount", () => {
  for (const sourceContract of [
    "PROVIDER_NAME[inst.provider]",
    "INSTALLMENT_METHOD_NAME[inst.collection_method]",
    "inst.buyer_total_cents ?? inst.amount_cents",
  ]) {
    assert.ok(ordersPage.includes(sourceContract), sourceContract);
  }
});

test("#3645 Admin maps capability refusal to the approved bounded copy", () => {
  assert.ok(offeringsService.includes('msg.includes("installment_capability_unavailable")'));
  assert.ok(offeringsService.includes(
    "This trip's payment plan can't be offered with this host's payment setup. Hide the trip or remove the plan first.",
  ));
});
