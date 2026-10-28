import {
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

Deno.test("#3645 trip cancellation records instalment refunds against their own source", () => {
  const matches = source.match(
    /p_source_type: entry\.installment_id === null[\s\S]{0,80}\? "order"[\s\S]{0,40}: "order_installment"/g,
  ) ?? [];
  if (matches.length !== 2) {
    throw new Error(
      `expected both Paystack outcome writes, got ${matches.length}`,
    );
  }
  assertMatch(source, /p_source_id: entry\.installment_id \?\? orderId/g);
});

Deno.test("#3645 trip cancellation marks successful Paystack and Stripe instalment refunds", () => {
  const marks = source.match(/issue_3645_mark_installment_refunded/g) ?? [];
  if (marks.length !== 2) {
    throw new Error(`expected one mark on each rail, got ${marks.length}`);
  }
  assertStringIncludes(source, "p_installment_id: entry.installment_id");
  assertStringIncludes(source, "p_amount_cents: entry.refund_cents");
});
