/**
 * #3355 P6 — Seth's decision 6 at the Host ticket price field.
 *
 * Happy path: a new paid ticket typed below the payment provider's minimum
 * shows the minimum message and cannot be saved; the exact minimum is fine.
 * Edges: an unchanged older below-minimum price is not blocked (the server
 * keeps it valid too); free tickets, locked prices and currencies with no
 * verified minimum are never blocked. The words match Ari's exactly (the Deno
 * parity test compares this file's table and messages to the edge mirror).
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, test } from "@jest/globals";

import {
  providerMinimumChargeMinor,
  ticketPriceBelowMinimum,
  ticketPriceMinimumMessage,
} from "../../constants/providerMinimumCharges";
import { ticketPriceEntryMinimumMessage } from "../ticketPriceMinimum";

const base = {
  isFree: false,
  currency: "GBP",
  initialIsFree: null,
  initialPriceMajor: null,
  isPriceLocked: false,
};

describe("#3355 P6 ticket price minimum (Host form)", () => {
  test("a new 20p ticket shows the provider minimum message", () => {
    const message = ticketPriceEntryMinimumMessage({
      ...base,
      priceText: "0.20",
    });
    expect(message).toBe(
      "Paid tickets must be at least £0.30. That's the smallest amount the payment provider can charge.",
    );
  });

  test("the exact minimum and anything above it is fine", () => {
    expect(
      ticketPriceEntryMinimumMessage({ ...base, priceText: "0.30" }),
    ).toBeNull();
    expect(
      ticketPriceEntryMinimumMessage({ ...base, priceText: "35" }),
    ).toBeNull();
  });

  test("an unchanged older below-minimum price is not blocked", () => {
    expect(
      ticketPriceEntryMinimumMessage({
        ...base,
        priceText: "0.20",
        initialIsFree: false,
        initialPriceMajor: 0.2,
      }),
    ).toBeNull();
    // Changing it to another below-minimum price is.
    expect(
      ticketPriceEntryMinimumMessage({
        ...base,
        priceText: "0.25",
        initialIsFree: false,
        initialPriceMajor: 0.2,
      }),
    ).not.toBeNull();
  });

  test("free, locked, empty and unknown-minimum entries are never blocked", () => {
    expect(
      ticketPriceEntryMinimumMessage({
        ...base,
        isFree: true,
        priceText: "0.10",
      }),
    ).toBeNull();
    expect(
      ticketPriceEntryMinimumMessage({
        ...base,
        isPriceLocked: true,
        priceText: "0.10",
      }),
    ).toBeNull();
    expect(
      ticketPriceEntryMinimumMessage({ ...base, priceText: "" }),
    ).toBeNull();
    expect(
      ticketPriceEntryMinimumMessage({
        ...base,
        currency: "ISK",
        priceText: "1",
      }),
    ).toBeNull();
  });

  test("Nigeria's minimum is ₦100 (Seth's decision, 2026-11-01) and reads in naira", () => {
    const words =
      "Paid tickets must be at least ₦100.00. That's the smallest amount the payment provider can charge.";
    expect(providerMinimumChargeMinor("NGN")).toBe(10000);
    expect(ticketPriceMinimumMessage("NGN")).toBe(words);
    expect(
      ticketPriceEntryMinimumMessage({
        ...base,
        currency: "NGN",
        priceText: "99",
      }),
    ).toBe(words);
    expect(
      ticketPriceEntryMinimumMessage({
        ...base,
        currency: "NGN",
        priceText: "100",
      }),
    ).toBeNull();
  });

  test("the table covers the currencies Mingla prices in that Stripe lists", () => {
    expect(providerMinimumChargeMinor("usd")).toBe(50);
    expect(providerMinimumChargeMinor("HUF")).toBe(17500);
    expect(providerMinimumChargeMinor("BGN")).toBeNull();
    expect(ticketPriceBelowMinimum(14.99, "CZK")).toBe(
      ticketPriceMinimumMessage("CZK"),
    );
    expect(ticketPriceBelowMinimum(15, "CZK")).toBeNull();
  });

  test("the ticket sheet blocks Save and shows the message under the price", () => {
    const sheet = readFileSync(
      join(__dirname, "../../components/event/TicketTierEditSheet.tsx"),
      "utf8",
    );
    expect(sheet).toContain("ticketPriceEntryMinimumMessage({");
    expect(sheet).toMatch(/priceMinimumMessage === null &&\s*!capacityInvalid/);
    expect(sheet).toContain(
      "if (priceMinimumMessage !== null) block(priceMinimumMessage);",
    );
    expect(sheet).toContain(
      "<Text style={styles.helperError}>{priceMinimumMessage}</Text>",
    );
  });
});
