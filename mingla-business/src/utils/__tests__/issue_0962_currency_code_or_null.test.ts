// issue #962 [pre-bank-currency-degbp] F1 — `currencyCodeOrNull` is the null-safe
// sibling of `normalizeCurrency` for the WRITE + DISPLAY-DECISION paths.
//
// A pre-bank brand genuinely has NO currency (brands.default_currency = NULL,
// migration 0769 "NULL means not set; do not imply GBP"). `normalizeCurrency`
// (the Intl crash-guard, ORCH-1152) returns "GBP" for blank input, which is
// correct for formatter safety but WRONG for persistence/display-gating.
// `currencyCodeOrNull` returns the trimmed upper-cased code, or null when blank.
//
// FAILS-ON-REVERT (true line-deletion): delete the `currencyCodeOrNull` export
// body → this suite fails to import / the null assertions fail. Append-only.

import { describe, expect, test } from "@jest/globals";

import { currencyCodeOrNull, normalizeCurrency } from "../currency";

describe("issue #962 currencyCodeOrNull", () => {
  test("returns null for unset / blank input (never fabricates GBP)", () => {
    expect(currencyCodeOrNull(undefined)).toBeNull();
    expect(currencyCodeOrNull(null)).toBeNull();
    expect(currencyCodeOrNull("")).toBeNull();
    expect(currencyCodeOrNull("   ")).toBeNull();
  });

  test("returns the trimmed, upper-cased ISO code when set", () => {
    expect(currencyCodeOrNull("usd")).toBe("USD");
    expect(currencyCodeOrNull("  gbp ")).toBe("GBP");
    expect(currencyCodeOrNull("EUR")).toBe("EUR");
    expect(currencyCodeOrNull("ngn")).toBe("NGN");
  });

  test("differs from normalizeCurrency ONLY on the blank case", () => {
    // Both coerce a real code identically...
    expect(currencyCodeOrNull("usd")).toBe(normalizeCurrency("usd"));
    // ...but normalizeCurrency manufactures GBP for blank while
    // currencyCodeOrNull honestly returns null.
    expect(normalizeCurrency("")).toBe("GBP");
    expect(currencyCodeOrNull("")).toBeNull();
    expect(currencyCodeOrNull("")).not.toBe("GBP");
  });
});
