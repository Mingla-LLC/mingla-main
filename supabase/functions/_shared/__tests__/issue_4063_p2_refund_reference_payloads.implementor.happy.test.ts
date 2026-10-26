import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const refundOrder = await Deno.readTextFile(
  new URL("../../refund-order/index.ts", import.meta.url),
);
const stripeWebhook = await Deno.readTextFile(
  new URL("../stripeWebhookRouter.ts", import.meta.url),
);
const cancelTrip = await Deno.readTextFile(
  new URL("../../cancel-trip-booking/index.ts", import.meta.url),
);

Deno.test("#4063 ticket refund writers carry the durable local refund reference", () => {
  assert(
    /template_key:\s*"buyer_refund_issued"[\s\S]{0,700}refund_record_id:\s*refundId/.test(
      refundOrder,
    ),
    "refund-order must put its public.refunds id in the buyer payload",
  );

  const webhookPayloadWrites = stripeWebhook.match(
    /refund_record_id:\s*refundRecordId/g,
  ) ?? [];
  assertEquals(
    webhookPayloadWrites.length,
    2,
    "Stripe reconciliation must enrich both notify-dispatch and email payloads",
  );
  assert(
    /\.from\("refunds"\)[\s\S]{0,200}\.select\("id"\)[\s\S]{0,200}\.eq\("stripe_refund_id", refundId\)/.test(
      stripeWebhook,
    ),
    "Stripe reconciliation must resolve the provider refund to public.refunds.id",
  );

  assert(
    /const baseNotifPayload = \{[\s\S]{0,700}refund_record_id:\s*refundId/.test(
      cancelTrip,
    ),
    "trip cancellation payloads must carry the local refund row id",
  );
});
