// Issue #4389 — a Paystack brand with no VAT country is refused, never charged
// at 0% VAT (D3).
// MINGLA-INVARIANT: I-4389-NO-ZERO-VAT-FALLBACK | issue #4389 | ticket checkout and door sales refuse brand_setup_incomplete when resolve_event_pricing_inputs.vat_country_missing is true for a Paystack brand.
// FAILS-ON-REVERT: deleting the vat_country_missing check in computeDoorMoney
// fails test 2; deleting either guard call in ticket-checkout-create fails test 3.
import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { assertVatCountryResolved, vatCountryMissing } from "../vatCountryGuard.ts";
import { computeDoorMoney } from "../doorPay.ts";

const ROW = {
  pass_tax: true, pass_mingla_fee: true, pass_service_fee: true, pricing_region: "NG",
  pricing_currency: "NGN", effective_take_rate_bps: 450, take_rate_source: "platform_default",
  vat_rate_bps: null,
};

Deno.test("#4389 1 — vatCountryMissing only for Paystack with no country", () => {
  assert(vatCountryMissing({ vat_country_missing: true }, "paystack"));
  assert(vatCountryMissing({ payment_country: null }, "paystack"));
  assert(!vatCountryMissing({ payment_country: "NG", vat_country_missing: false }, "paystack"));
  assert(!vatCountryMissing({ payment_country: null, vat_country_missing: true }, "stripe"));
  assertThrows(() => assertVatCountryResolved({ vat_country_missing: true }, "paystack"), Error, "brand_setup_incomplete");
});

Deno.test("#4389 2 — a door sale never computes 0% VAT for a brand with no VAT country", () => {
  assertThrows(
    () => computeDoorMoney({ ...ROW, vat_country_missing: true }, "paystack", 10000),
    Error,
    "brand_setup_incomplete",
  );
  const ok = computeDoorMoney({ ...ROW, vat_rate_bps: 750, vat_country_missing: false }, "paystack", 10000);
  assert(ok.totalCents > 10000);
});

Deno.test("#4389 3 — ticket checkout guards both Paystack VAT paths", async () => {
  const src = await Deno.readTextFile(new URL("../../ticket-checkout-create/index.ts", import.meta.url));
  const quoteGuard = src.indexOf("assertVatCountryResolved(pricing, provider.provider)");
  const createGuard = src.indexOf('if (vatCountryMissing(pricing, "paystack"))');
  assert(quoteGuard > 0 && createGuard > 0, "a VAT guard is missing");
  const firstVat = src.indexOf("computeConfigVat(", quoteGuard);
  assert(firstVat > quoteGuard, "quote guard must run before VAT is computed");
  assertEquals(src.indexOf("BRAND_SETUP_INCOMPLETE }, 409)") > createGuard, true);
});
