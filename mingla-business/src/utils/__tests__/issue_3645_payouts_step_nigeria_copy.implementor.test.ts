/**
 * issue #3645 — on the brand-creation Payouts step, the moment a host picks
 * Nigeria the card reads "You can start selling now. Your money waits until
 * you add a bank."
 *
 * Live, 2026-10-14: straight after picking Nigeria the card still read "You can
 * keep building and publish free offerings. Connect a bank before collecting
 * money…". The step chose the line from the brand object alone, and the object
 * it holds at that moment (handed over by the country field after the server
 * accepted the pick) does not carry the server's sell-before-bank stamp.
 *
 * The first test uses that exact object. It fails on the old decision
 * (`brandSellsBeforeBank(brand)`), which is asserted alongside so the miss is
 * on the page.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

import { brandSellsBeforeBank, payoutStepSellsBeforeBank } from "../brandPayout";
import { resolveBankConnectRailForCountry } from "../bankConnectRail";

const NIGERIA = resolveBankConnectRailForCountry("NG");
const UNITED_KINGDOM = resolveBankConnectRailForCountry("GB");

/** What BrandPayoutCountryField hands the step after the server accepts Nigeria. */
const brandJustAfterPickingNigeria = {
  paymentProvider: "paystack" as const,
  paymentCountry: "NG",
  defaultCurrency: "NGN",
  // Not on the object yet: payoutHoldCutoverAt, paystackSubaccountCode.
};

describe("#3645 — the Payouts step follows the country just picked", () => {
  test("the rails used here are the real ones", () => {
    expect(NIGERIA).toMatchObject({ provider: "paystack", countryCode: "NG", currency: "NGN" });
    expect(UNITED_KINGDOM).toMatchObject({ provider: "stripe", countryCode: "GB" });
  });

  test("Nigeria just picked, brand object not stamped yet: sells before bank", () => {
    expect(payoutStepSellsBeforeBank(NIGERIA, brandJustAfterPickingNigeria)).toBe(true);
    // The decision the step used to make, on the same object: the live miss.
    expect(brandSellsBeforeBank(brandJustAfterPickingNigeria)).toBe(false);
  });

  test("Nigeria just picked while the brand object still reads as the card rail", () => {
    expect(
      payoutStepSellsBeforeBank(NIGERIA, { paymentProvider: "stripe", stripeStatus: "not_connected" }),
    ).toBe(true);
    expect(payoutStepSellsBeforeBank(NIGERIA, null)).toBe(true);
  });

  test("Nigeria picked and a bank is already connected: money is not waiting", () => {
    expect(
      payoutStepSellsBeforeBank(NIGERIA, { paymentProvider: "paystack", paystackSubaccountCode: "ACCT_x" }),
    ).toBe(false);
    expect(
      payoutStepSellsBeforeBank(NIGERIA, { paymentProvider: "paystack", hasPaystackRecipient: true }),
    ).toBe(false);
  });

  test("another country just picked: never, even if the object still reads Nigerian", () => {
    expect(
      payoutStepSellsBeforeBank(UNITED_KINGDOM, {
        paymentProvider: "paystack",
        payoutHoldCutoverAt: "2026-10-13T05:40:00Z",
      }),
    ).toBe(false);
    expect(payoutStepSellsBeforeBank(UNITED_KINGDOM, { paymentProvider: "stripe" })).toBe(false);
  });

  test("nothing picked in this session: the saved brand decides, as before", () => {
    const stamped = { paymentProvider: "paystack" as const, payoutHoldCutoverAt: "2026-10-13T05:40:00Z" };
    expect(payoutStepSellsBeforeBank(null, stamped)).toBe(true);
    expect(payoutStepSellsBeforeBank(undefined, stamped)).toBe(true);
    expect(payoutStepSellsBeforeBank(null, { paymentProvider: "paystack" })).toBe(false);
    expect(payoutStepSellsBeforeBank(null, { paymentProvider: "stripe", stripeStatus: "active" })).toBe(false);
    expect(payoutStepSellsBeforeBank(null, null)).toBe(false);
  });

  test("the step asks with the country it was just told about, and shows the approved line", () => {
    const flow = readFileSync(
      join(__dirname, "..", "..", "components", "brand", "BrandCreationFlow.tsx"),
      "utf8",
    );
    // The country field reports the pick only after the server accepted it.
    expect(flow).toContain("onCountryChosen={setPickedPayoutRail}");
    const ask = flow.indexOf("{payoutStepSellsBeforeBank(");
    expect(ask).toBeGreaterThan(-1);
    const decision = flow.slice(ask, ask + 320).replace(/\s+/g, " ");
    expect(decision).toContain(
      "{payoutStepSellsBeforeBank( pickedPayoutRail, payoutCanonicalBrand, ) ? BRAND_CREATION_COPY.step4.consequenceSellBeforeBank : BRAND_CREATION_COPY.step4.consequence}",
    );
    expect(flow).not.toContain("brandSellsBeforeBank(payoutCanonicalBrand)");
    expect(flow).toContain(
      'consequenceSellBeforeBank: "You can start selling now. Your money waits until you add a bank.",',
    );
  });

  test("the country field reports a pick only after the server call succeeded", () => {
    const field = readFileSync(
      join(__dirname, "..", "..", "components", "brand", "BrandPayoutCountryField.tsx"),
      "utf8",
    );
    const call = field.indexOf("await selectPaystackProvider(brand.id);");
    const report = field.indexOf("onCountryChosen?.(rail);");
    const failure = field.indexOf("} catch (error) {", call);
    expect(call).toBeGreaterThan(-1);
    expect(report).toBeGreaterThan(call);
    expect(failure).toBeGreaterThan(report);
  });
});
