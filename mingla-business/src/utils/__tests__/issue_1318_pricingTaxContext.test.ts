import {
  configuredVatRateBps,
  NIGERIA_VAT_RATE_BPS,
  type PricingTaxContext,
  usesConfiguredVat,
} from "../pricingTaxContext";

const otherTaxContexts: PricingTaxContext[] = [
  { paymentProvider: "stripe", paymentCountry: "NG" },
  { paymentProvider: "paystack", paymentCountry: "GB" },
  { paymentProvider: "paystack", paymentCountry: null },
  {},
];

describe("#1318 configured VAT context", () => {
  test("only the Nigeria Paystack rail resolves configured 7.5% VAT", () => {
    expect(
      configuredVatRateBps({
        paymentProvider: "paystack",
        paymentCountry: "ng",
      }),
    ).toBe(NIGERIA_VAT_RATE_BPS);
    expect(
      usesConfiguredVat({
        paymentProvider: "paystack",
        paymentCountry: " NG ",
      }),
    ).toBe(true);
  });

  test.each(otherTaxContexts)(
    "keeps Stripe/other markets on their existing tax path: %o",
    (context) => {
      expect(configuredVatRateBps(context)).toBeNull();
    },
  );
});
