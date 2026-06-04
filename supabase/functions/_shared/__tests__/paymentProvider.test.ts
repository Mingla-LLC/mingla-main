// META-ORCH-1076 [Paystack Africa] Phase 1 — (provider, country) resolver.
//
// Proves default-stripe fail-safe routing + NG channel allowlist (never
// mobile_money). fails-on-revert: removing the `=== "paystack"` guard or the
// NG case changes these assertions; module-import failure on revert of
// paymentProvider.ts errors every test.
import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  paystackChannelsForCountry,
  resolveProviderRouting,
} from "../paymentProvider.ts";

Deno.test("default-stripe: null provider → stripe", () => {
  const r = resolveProviderRouting({
    payment_provider: null,
    payment_country: null,
    pricing_currency: null,
  });
  assertEquals(r.provider, "stripe");
});

Deno.test("explicit paystack → paystack, country + currency upper-cased", () => {
  const r = resolveProviderRouting({
    payment_provider: "paystack",
    payment_country: "ng",
    pricing_currency: "ngn",
  });
  assertEquals(r.provider, "paystack");
  assertEquals(r.country, "NG");
  assertEquals(r.currency, "NGN");
});

Deno.test("fail-safe: unknown provider value routes to stripe (never paystack)", () => {
  assertEquals(
    resolveProviderRouting({
      payment_provider: "wat",
      payment_country: "NG",
      pricing_currency: "NGN",
    }).provider,
    "stripe",
  );
});

Deno.test("NG channels = card|bank|ussd|bank_transfer and NEVER mobile_money", () => {
  const channels = paystackChannelsForCountry("NG");
  assertEquals(channels, ["card", "bank", "ussd", "bank_transfer"]);
  assertEquals(channels.includes("mobile_money"), false);
});

Deno.test("NG channels are case-insensitive on input", () => {
  assertEquals(paystackChannelsForCountry("ng").includes("mobile_money"), false);
});

Deno.test("unknown country safe default never includes mobile_money", () => {
  assertEquals(paystackChannelsForCountry("ZZ").includes("mobile_money"), false);
});
