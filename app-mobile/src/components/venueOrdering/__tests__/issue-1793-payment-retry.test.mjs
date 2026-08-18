// Issue #1793 rework — structural proof for the native cancellation seam.
// PaymentSheet cancellation leaves the basket/key intact; the next Pay accepts
// the server's `resumed` continuation and does not overwrite its saved tokens.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { presentVenueOrderPayment } from "../venueOrderPaymentPresentation.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..", "..", "..", "..");
const read = (relative) => fs.readFileSync(path.join(repo, relative), "utf8");

test("T-1793-R8 — native cancel keeps the stable basket key and accepts the resumed PaymentIntent", () => {
  const hook = read(
    "app-mobile/src/components/venueOrdering/useConsumerVenueOrdering.ts",
  );
  const service = read("app-mobile/src/services/venueOrderingService.ts");

  assert.match(hook, /presentation\.status === "failed"/);
  assert.match(hook, /idempotencyKeyFor\(priceSignature\)/);
  assert.match(
    hook,
    /created\.kind === "free_completed" \|\| !created\.resumed/,
  );
  assert.match(hook, /sitting\?\.buyerStatusToken \?\? ""/);
  assert.match(service, /resumed: data\.resumed === true/);
});

test("T-1793-R9 — closing Paystack can reopen the same transaction from status", () => {
  const hook = read(
    "app-mobile/src/components/venueOrdering/useConsumerVenueOrdering.ts",
  );
  const service = read("app-mobile/src/services/venueOrderingService.ts");
  const slots = read(
    "app-mobile/src/components/venueOrdering/ConsumerVenueOrderingSlots.tsx",
  );

  assert.match(service, /includePaymentContinuation: true/);
  assert.match(service, /value\.kind === "requires_paystack_redirect"/);
  assert.match(hook, /resumeVenueOrderPayment\(orderId, token\)/);
  // #2227 [TEST-MOD-APPROVED #2227]: the NG hand-off moved off
  // openAuthSessionAsync — an https redirect argument made iOS >= 17.4 destroy
  // the session before it presented. The reopen behaviour this test guards is
  // unchanged; only the primitive it names moved.
  assert.match(hook, /openBrowserAsync\([\s\S]*authorizationUrl/);
  assert.doesNotMatch(hook, /openAuthSessionAsync\s*\(/);
  assert.match(slots, /onRetryPayment=\{ordering\.retryPayment\}/);
});

test("T-1793-R11 — first PaymentSheet cancel then second Pay presents the same order and PaymentIntent", async () => {
  const identity = { orderId: "order_same", paymentIntentId: "pi_same" };
  let presentations = 0;
  const present = async () => {
    presentations++;
    return presentations === 1 ? { error: { code: "Canceled" } } : {};
  };

  const first = await presentVenueOrderPayment({ ...identity, present });
  const second = await presentVenueOrderPayment({ ...identity, present });

  assert.equal(first.status, "cancelled");
  assert.equal(second.status, "completed");
  assert.equal(presentations, 2);
  assert.deepEqual(
    [first.orderId, first.paymentIntentId],
    [second.orderId, second.paymentIntentId],
  );
  assert.deepEqual(
    [second.orderId, second.paymentIntentId],
    ["order_same", "pi_same"],
  );
});
