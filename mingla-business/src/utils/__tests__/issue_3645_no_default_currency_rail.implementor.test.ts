/**
 * #3645 — a brand has no currency until its organiser picks a payout country.
 *
 * Before: brand creation wrote `brands.default_currency` from
 * `resolveBankConnectRail`, whose fallback for a brand with no address is the
 * United Kingdom, so brands were saved in pounds before anyone chose anything.
 *
 * These pin the helpers the fix is built on: a pick has NO fallback, the
 * address alone is never a choice, and the chosen country reaches the bank
 * screens.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

import {
  NIGERIA_BANK_CONNECT_RAIL,
  resolveBankConnectRail,
  resolveBankConnectRailForCountry,
  resolveSavedPayoutCountry,
} from "../bankConnectRail";
import {
  PAYOUT_COUNTRY_BANK_ALREADY_CONNECTED_COPY,
  PAYOUT_COUNTRY_PAYMENT_ACCOUNT_LOCKED_COPY,
  PAYOUT_COUNTRY_SWITCH_FAILED_COPY,
} from "../payoutCountrySwitchCopy";

const NIGERIA = NIGERIA_BANK_CONNECT_RAIL.countryCode;
const read = (...parts: string[]): string =>
  readFileSync(join(__dirname, "..", "..", "..", ...parts), "utf8");

describe("#3645 a picked payout country has no fallback", () => {
  test("nothing picked resolves to no rail and no currency", () => {
    expect(resolveBankConnectRailForCountry(null)).toBeNull();
    expect(resolveBankConnectRailForCountry(undefined)).toBeNull();
    expect(resolveBankConnectRailForCountry("")).toBeNull();
    expect(resolveBankConnectRailForCountry("  ")).toBeNull();
  });

  test("an unsupported country resolves to nothing, never to the United Kingdom", () => {
    expect(resolveBankConnectRailForCountry("BR")).toBeNull();
    expect(resolveBankConnectRailForCountry("ZZ")).toBeNull();
    expect(resolveBankConnectRailForCountry("GBR")).toBeNull();
    // The legacy resolver still falls back; that is why it must not decide a
    // brand's currency.
    expect(resolveBankConnectRail({ countryCode: null }).currency).toBe("GBP");
  });

  test("a supported pick resolves to that country's own currency", () => {
    expect(resolveBankConnectRailForCountry("fr")).toEqual({
      provider: "stripe",
      countryCode: "FR",
      displayName: "France",
      currency: "EUR",
    });
    expect(resolveBankConnectRailForCountry("US")?.currency).toBe("USD");
    expect(resolveBankConnectRailForCountry(NIGERIA)).toEqual(
      NIGERIA_BANK_CONNECT_RAIL,
    );
    expect(NIGERIA_BANK_CONNECT_RAIL.currency).toBe("NGN");
    expect(NIGERIA_BANK_CONNECT_RAIL.provider).toBe("paystack");
  });

});

describe("#3645 what counts as a payout country already chosen", () => {
  test("a brand with nothing saved has chosen nothing", () => {
    expect(resolveSavedPayoutCountry({})).toBeNull();
    expect(
      resolveSavedPayoutCountry({
        paymentProvider: null,
        cardAccountCountry: null,
        defaultCurrency: null,
        addressCountryCode: null,
      }),
    ).toBeNull();
  });

  test("an address alone is never a choice", () => {
    for (const addressCountryCode of ["GB", "US", "FR", NIGERIA]) {
      expect(resolveSavedPayoutCountry({ addressCountryCode })).toBeNull();
      expect(
        resolveSavedPayoutCountry({ addressCountryCode, defaultCurrency: "  " }),
      ).toBeNull();
    }
  });

  test("a brand on the Nigerian rail has chosen Nigeria", () => {
    expect(resolveSavedPayoutCountry({ paymentProvider: "paystack" })).toEqual(
      NIGERIA_BANK_CONNECT_RAIL,
    );
    expect(
      resolveSavedPayoutCountry({
        paymentProvider: " Paystack ",
        addressCountryCode: "GB",
        defaultCurrency: "GBP",
      }),
    ).toEqual(NIGERIA_BANK_CONNECT_RAIL);
  });

  test("a card payment account's country is the choice", () => {
    expect(
      resolveSavedPayoutCountry({
        paymentProvider: "stripe",
        cardAccountCountry: "de",
        addressCountryCode: "FR",
      })?.countryCode,
    ).toBe("DE");
  });

  test("a saved currency names a country only when it is unambiguous", () => {
    expect(resolveSavedPayoutCountry({ defaultCurrency: "gbp" })?.countryCode)
      .toBe("GB");
    expect(resolveSavedPayoutCountry({ defaultCurrency: "USD" })?.countryCode)
      .toBe("US");
    // The euro is shared: no country is claimed for the organiser.
    expect(resolveSavedPayoutCountry({ defaultCurrency: "EUR" })).toBeNull();
    // ...unless the address country uses it.
    expect(
      resolveSavedPayoutCountry({
        defaultCurrency: "EUR",
        addressCountryCode: "IE",
      })?.countryCode,
    ).toBe("IE");
    // An address whose currency differs does not override the saved currency.
    expect(
      resolveSavedPayoutCountry({
        defaultCurrency: "GBP",
        addressCountryCode: "FR",
      })?.countryCode,
    ).toBe("GB");
    // Naira without the Nigerian rail is not a saved pick.
    expect(
      resolveSavedPayoutCountry({
        defaultCurrency: "NGN",
        addressCountryCode: NIGERIA,
      }),
    ).toBeNull();
  });
});

describe("#3645 organiser-facing copy on the new surfaces names no provider", () => {
  const PROVIDER = /stripe|paystack/i;

  test("the shared payout-country sentences", () => {
    for (const copy of [
      PAYOUT_COUNTRY_PAYMENT_ACCOUNT_LOCKED_COPY,
      PAYOUT_COUNTRY_BANK_ALREADY_CONNECTED_COPY,
      PAYOUT_COUNTRY_SWITCH_FAILED_COPY,
    ]) {
      expect(copy).not.toMatch(PROVIDER);
    }
    expect(PAYOUT_COUNTRY_PAYMENT_ACCOUNT_LOCKED_COPY).toBe(
      "This brand already has a payment account. Contact support to change country.",
    );
  });

  test("the web bank screen reuses the one locked sentence instead of restating it", () => {
    const web = read("src", "components", "brand", "BrandBankConnectBody.web.tsx");
    expect(web).toContain(
      "const PAYMENT_ACCOUNT_LOCKED_COPY = PAYOUT_COUNTRY_PAYMENT_ACCOUNT_LOCKED_COPY;",
    );
    expect(web).not.toContain("Contact support to change country.");
  });

  test("every string literal in the new field, prompt and trigger row", () => {
    for (const file of [
      "BrandPayoutCountryField.tsx",
      "PayoutCountryInlinePrompt.tsx",
      "PayoutCountryTriggerRow.tsx",
    ]) {
      const source = read("src", "components", "brand", file)
        // comments may name the rails; rendered strings may not
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((line) => line.replace(/\/\/.*$/, ""))
        .join("\n");
      const literals = source.match(/"[^"\n]*"|`[^`]*`/g) ?? [];
      const rendered = literals.filter(
        (literal) => !literal.includes("/") && !literal.includes("paystack\""),
      );
      for (const literal of rendered) {
        if (literal === "\"paystack\"" || literal === "\"stripe\"") continue;
        expect(literal).not.toMatch(/Stripe|Paystack/);
      }
    }
  });

  test("the country sheet and both bank screens no longer name a provider in the row", () => {
    const picker = read("src", "components", "brand", "BrandStripeCountryPicker.tsx");
    expect(picker).not.toContain("Stripe payouts route");
    expect(picker).toContain("Payouts go to a bank");
    for (const file of ["BrandBankConnectBody.web.tsx", "BrandOnboardView.tsx"]) {
      expect(read("src", "components", "brand", file)).not.toContain(
        "Bank transfer via Paystack",
      );
    }
  });
});

describe("#3645 the chosen country reaches the bank screens on web and native", () => {
  test("web bank screen seeds from the chosen country ahead of the address", () => {
    const web = read("src", "components", "brand", "BrandBankConnectBody.web.tsx");
    expect(web).toContain("countryCode: chosenCountryHint ?? brand?.countryCode");
  });

  test("the native alias forwards it and the native screen seeds from it", () => {
    const alias = read("app", "brand", "[id]", "connect.tsx");
    expect(alias).toContain("payments/onboard?from=brand-create${countryQuery}");
    const route = read("app", "brand", "[id]", "payments", "onboard.tsx");
    expect(route).toContain("initialCountry=");
    const native = read("src", "components", "brand", "BrandOnboardView.tsx");
    expect(native).toContain("countryCode: chosenCountryHint ?? brand?.countryCode");
  });
});

describe("#3645 a price on a brand with no currency asks for the country in place", () => {
  test.each([
    ["src/components/event/CreatorStep5Tickets.tsx"],
    ["src/components/trip/TripCreatorStep4Pricing.tsx"],
    ["src/components/experience/ExperienceCreatorWizard.tsx"],
    ["src/components/rsvp/RsvpStep5Setup.tsx"],
  ])("%s renders the inline payout-country prompt", (path) => {
    expect(read(...path.split("/"))).toContain("<PayoutCountryInlinePrompt");
  });
});
