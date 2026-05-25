import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const read = (path: string): string =>
  Deno.readTextFileSync(`${Deno.cwd()}/${path}`);
const exists = (path: string): boolean => {
  try {
    Deno.statSync(`${Deno.cwd()}/${path}`);
    return true;
  } catch {
    return false;
  }
};

Deno.test("T-IH-01 ticket-checkout-create calculates tax before native PI", () => {
  const src = read("supabase/functions/ticket-checkout-create/index.ts");
  assert(
    src.indexOf("tax.calculations.create(") <
      src.indexOf("paymentIntents.create("),
  );
  assertStringIncludes(src, "amount: taxCalculation.amount_total");
  assertStringIncludes(src, 'tax_code: "txcd_50010001"');
  assertStringIncludes(src, "applicationFeeAmountCents = Math.round");
});

Deno.test("T-IH-02 preview mode returns preview shape without creating a PI", () => {
  const src = read("supabase/functions/ticket-checkout-create/index.ts");
  assertStringIncludes(src, 'mode === "preview"');
  assertStringIncludes(src, 'kind: "preview"');
  assert(
    src.indexOf('if (mode === "preview")') <
      src.indexOf("paymentIntents.create("),
  );
});

Deno.test("T-IH-03 webhook commits Stripe Tax transaction on PI success", () => {
  const src = read("supabase/functions/_shared/stripeWebhookRouter.ts");
  assertStringIncludes(src, "mingla_tax_calculation_id");
  assert(/tax\.transactions\s*\.\s*createFromCalculation\s*\(/.test(src));
  assertStringIncludes(src, "idempotencyKey: paymentIntentId");
  assertStringIncludes(src, "stripe_tax_transaction_id");
});

Deno.test("T-IH-04 refund-order reverses tax for full refunds", () => {
  const src = read("supabase/functions/refund-order/index.ts");
  assertStringIncludes(src, "tax.transactions.createReversal(");
  assertStringIncludes(src, 'mode: isFullRefund ? "full" : "partial"');
  assertStringIncludes(src, "p_stripe_tax_transaction_id");
});

Deno.test("T-IH-05 refund-order builds partial reversal line items", () => {
  const src = read("supabase/functions/refund-order/index.ts");
  assertStringIncludes(src, "line_items: lines.map");
  assertStringIncludes(src, "amount: -line.amount_cents");
  assertStringIncludes(src, "reference: `line:${line.order_line_item_id}`");
});

Deno.test("T-IH-06 migration adds tax columns and RPC amendments", () => {
  const src = read(
    "supabase/migrations/20260727000000_orch_0955_native_stripe_tax.sql",
  );
  for (
    const token of [
      "orders.stripe_tax_transaction_id",
      "orders.tax_breakdown",
      "refunds.stripe_tax_transaction_id",
      "ticket_checkout_sessions.tax_amount_cents",
      "ticket_checkout_sessions.tax_calculation_id",
      "lineItems",
      "p_stripe_tax_transaction_id text DEFAULT NULL",
    ]
  ) {
    assertStringIncludes(src, token);
  }
});

Deno.test("T-IH-07 account-session edge function mints embedded Tax client secret", () => {
  const src = read(
    "supabase/functions/brand-stripe-tax-account-session/index.ts",
  );
  assertStringIncludes(src, "accountSessions.create");
  assertStringIncludes(src, "tax_registrations: { enabled: true }");
  assertStringIncludes(src, "tax_settings: { enabled: true }");
  assertStringIncludes(src, "stripe_tax.account_session_minted");
});

Deno.test("T-IH-08 email receipt renders Tax before Total", () => {
  const src = read("supabase/functions/_shared/email/ticketBody.ts");
  assertStringIncludes(src, "taxAmountCents");
  assert(src.indexOf("${taxRow}") < src.indexOf(">Total</td>"));
  assertStringIncludes(src, "Tax:");
});

Deno.test("T-IH-09 consumer CartTaxPreview invokes preview and renders tax", () => {
  const src = read("app-mobile/src/components/checkout/CartTaxPreview.tsx");
  assertStringIncludes(src, 'mode: "preview"');
  assertStringIncludes(src, "Calculate tax");
  assertStringIncludes(src, "Tax");
});

Deno.test("T-IH-10 business CartTaxPreview mirrors consumer preview contract", () => {
  const src = read(
    "mingla-business/src/components/checkout/CartTaxPreview.tsx",
  );
  assertStringIncludes(src, 'mode: "preview"');
  assertStringIncludes(src, "Calculate tax");
  assertStringIncludes(src, "Tax");
});

Deno.test("T-IH-11 BrandPaymentsView opens hosted embedded Tax route", () => {
  const hook = read(
    "mingla-business/src/hooks/useBrandStripeTaxAccountSession.ts",
  );
  const view = read(
    "mingla-business/src/components/brand/BrandPaymentsView.tsx",
  );
  assertStringIncludes(hook, "openAuthSessionAsync");
  assertStringIncludes(hook, "/connect-tax-registrations?");
  assertStringIncludes(view, "useBrandStripeTaxAccountSession");
});

Deno.test("T-IH-12 ORCH-0955 strict-grep gates exist", () => {
  for (
    const file of [
      "orch-0955-native-tax-coverage.mjs",
      "orch-0955-tax-commit-on-success.mjs",
      "orch-0955-tax-reversal-on-refund.mjs",
      "orch-0955-embedded-tax-ui.mjs",
      "orch-0955-region-gate-deleted.mjs",
    ]
  ) {
    assert(exists(`.github/scripts/strict-grep/${file}`));
  }
});

Deno.test("T-IH-13 ORCH-0863 C7 allowlist includes ORCH-0955 backend files", () => {
  const src = read(
    ".github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs",
  );
  assertStringIncludes(src, "ORCH_0955_BACKEND_ALLOWLIST");
  assertStringIncludes(
    src,
    "supabase/functions/brand-stripe-tax-account-session/index.ts",
  );
  assertStringIncludes(
    src,
    "supabase/migrations/20260727000000_orch_0955_native_stripe_tax.sql",
  );
});

Deno.test("ORCH-0955 legacy region gate and dashboard function are removed", () => {
  assertEquals(exists("supabase/functions/_shared/stripeTax.ts"), false);
  const legacyTaxFn = ["brand", "stripe", "tax", "dashboard", "link"].join("-");
  assertEquals(exists(`supabase/functions/${legacyTaxFn}/index.ts`), false);
});
