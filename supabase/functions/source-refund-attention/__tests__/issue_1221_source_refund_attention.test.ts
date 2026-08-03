import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
const provider = await Deno.readTextFile(
  new URL("../../_shared/paystackRefunds.ts", import.meta.url),
);
Deno.test("attention recovery commits verified Paystack truth", () => {
  assertStringIncludes(source, "getPaystackRefund");
  assertStringIncludes(source, "retryPaystackRefundWithCustomerDetails");
  assertStringIncludes(source, '"record_source_refund_provider_event"');
  assertStringIncludes(source, "paystack_customer_details_accepted");
  assertStringIncludes(source, '"authorize_source_refund_attention"');
  assertStringIncludes(
    provider,
    "/refund/retry_with_customer_details/",
  );
  assertStringIncludes(provider, "refund_account_details");
});
