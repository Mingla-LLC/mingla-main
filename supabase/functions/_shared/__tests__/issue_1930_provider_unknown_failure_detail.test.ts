import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(
  new URL("../../ticket-checkout-create/index.ts", import.meta.url),
);

const catchBlock = (marker: string, nextMarker: string): string => {
  const start = source.indexOf(marker);
  const end = source.indexOf(nextMarker, start);
  assert(start >= 0 && end > start);
  return source.slice(start, end);
};

Deno.test("#1930 ambiguous Stripe creates persist bounded detail but stay non-final", () => {
  const web = catchBlock(
    "[ticket-checkout-create] checkout session create failed",
    "if (!checkoutSession.url)",
  );
  const native = catchBlock(
    "[ticket-checkout-create] payment intent create failed",
    "const clientSecret =",
  );

  for (const block of [web, native]) {
    assert(block.includes("failure_reason: failure.detail"));
    assert(block.includes('.is("stripe_payment_intent_id", null)'));
    assertEquals(block.includes('status: "failed"'), false);
    assertEquals(block.includes("failed_at:"), false);
  }

  assert(
    source.includes(
      "idempotencyKey: `ticket_checkout_web:${checkoutSessionId}`",
    ),
  );
  assert(
    source.includes("idempotencyKey: `ticket_checkout:${checkoutSessionId}`"),
  );
});
