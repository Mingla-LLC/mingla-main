/**
 * issue #3645 — a price never shows a single decimal digit (TESTER, adversarial).
 *
 * A different angle from the implementor's happy-path file: instead of a few
 * named prices, this sweeps every cent from 0 to 9999 and a ladder of large
 * naira amounts through the REAL Buy-button and trip-headline formatters, and
 * checks the printed digits against integer arithmetic (never against Intl), so
 * a displayed price can neither exceed nor undercut the amount charged. It then
 * attacks float noise, hostile numbers, hostile currency codes, zero-decimal
 * and three-decimal currencies, and a mounted ticket box.
 *
 * Fails on revert: restore `minimumFractionDigits: 0, maximumFractionDigits: 2`
 * in packages/offering-rendering/offeringCta.ts and the cent sweep prints
 * "$0.1"; restore `maximumFractionDigits: 0` in useTripOfferingState.ts and the
 * trip sweep prints a price 50 kobo above the charge.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

import { EventTicketBox } from "../../../../../packages/offering-rendering/EventOfferingBody";
import { resolveOfferingCta } from "../../../../../packages/offering-rendering/offeringCta";
import {
  priceDecimals,
  priceFallbackDecimals,
} from "../../../../../packages/offering-rendering/priceDecimals";
import { createThemePalette } from "../../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../../packages/offering-rendering/themeResolver";
import type { TripOfferingTier } from "../../../../../packages/offering-rendering/tripOfferingTypes";
import type { PublicTicketProps } from "../../../../../packages/offering-rendering/types";
import { tripTierPriceLabel } from "../../../../../packages/offering-rendering/useTripOfferingState";

jest.mock(
  "react-native-svg",
  () => ({
    __esModule: true,
    default: () => null,
    Circle: () => null,
    Path: () => null,
  }),
  { virtual: true },
);
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Tree = { toJSON: () => unknown; unmount: () => void };
// The repo intentionally carries no react-test-renderer declarations.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Tree;
  act: (fn: () => void | Promise<void>) => Promise<void>;
};

const ticket = (overrides: Partial<PublicTicketProps> = {}): PublicTicketProps =>
  ({
    id: "tier-adv",
    name: "General",
    description: null,
    priceGbp: 10,
    priceAllInGbp: 10.5,
    currency: "GBP",
    isFree: false,
    isUnlimited: true,
    capacity: null,
    visibility: "public",
    passwordProtected: false,
    password: null,
    saleStartAt: null,
    saleEndAt: null,
    approvalRequired: false,
    waitlistEnabled: false,
    availableAt: "online",
    displayOrder: 0,
    ...overrides,
  }) as PublicTicketProps;

/** The Buy-button price for one paid ticket, through the real resolver. */
const buyPrice = (
  overrides: Partial<PublicTicketProps>,
  eventCurrency: string | null = "GBP",
): string => {
  const cta = resolveOfferingCta({
    variant: "published",
    bookable: true,
    tickets: [ticket(overrides)],
    currency: eventCurrency,
  } as never) as { kind: string; price?: string };
  expect(cta.kind).toBe("buy");
  return String(cta.price);
};

const tier = (overrides: Partial<TripOfferingTier> = {}): TripOfferingTier => ({
  id: "trip-tier-adv",
  ticketTypeId: "tt-adv",
  tierName: "Shared room",
  priceCents: 100,
  priceAllInCents: 100,
  currency: "NGN",
  isFree: false,
  isUnlimited: true,
  ticketsRemaining: null,
  installmentSchedule: null,
  ...overrides,
});

/** Exactly one digit after a decimal separator, e.g. "772.5" or "0,5". */
const SINGLE_DECIMAL = /\d[.,]\d(?!\d)(?![.,]?\d)/;
const endsInOneDecimal = (shown: string): boolean => /[.,]\d$/.test(shown.trim());

/** "1234567" → "1,234,567" by string work only (no Intl, no floats). */
const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** The en-US price an integer number of minor units must print as. */
const expectedFromMinor = (minor: number, symbol: string): string => {
  const whole = Math.trunc(minor / 100);
  const rest = minor % 100;
  return rest === 0
    ? `${symbol}${group(String(whole))}`
    : `${symbol}${group(String(whole))}.${String(rest).padStart(2, "0")}`;
};

/** The minor units a printed price stands for, whatever the locale's grouping. */
const minorShown = (shown: string): number => {
  const fraction = /[.,](\d{2})$/.exec(shown.trim());
  const digits = shown.replace(/\D/g, "");
  return fraction === null ? Number(digits) * 100 : Number(digits);
};

/** Every string a rendered tree shows: text children and a11y labels. */
const visibleStrings = (node: unknown, out: string[] = []): string[] => {
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    node.forEach((child) => visibleStrings(child, out));
  } else if (node !== null && typeof node === "object") {
    const host = node as { props?: Record<string, unknown>; children?: unknown };
    const label = host.props?.accessibilityLabel;
    if (typeof label === "string") out.push(label);
    visibleStrings(host.children ?? null, out);
  }
  return out;
};

describe("#3645 tester — every cent on the Buy button", () => {
  test("cents 1..9999 print exactly, never one decimal, never a different amount", () => {
    const wrong: string[] = [];
    for (let cents = 1; cents <= 9999; cents += 1) {
      const shown = buyPrice({ currency: "USD", priceGbp: cents / 100, priceAllInGbp: cents / 100 });
      const expected = expectedFromMinor(cents, "$");
      if (shown !== expected || endsInOneDecimal(shown)) {
        wrong.push(`${cents}c → ${shown} (expected ${expected})`);
      }
    }
    expect(wrong.slice(0, 5)).toEqual([]);
  });

  test("a zero price is still 'Free', with or without the free flag", () => {
    expect(buyPrice({ priceGbp: 0, priceAllInGbp: 0 })).toBe("Free");
    expect(buyPrice({ priceGbp: 0, priceAllInGbp: null })).toBe("Free");
  });

  test("large naira amounts keep the glyph, the grouping and every kobo", () => {
    const wrong: string[] = [];
    // 97-kobo steps cover every kobo ending; the start is past a million naira.
    for (let kobo = 100_000_000; kobo <= 100_000_000 + 97 * 4000; kobo += 97) {
      const shown = buyPrice({ currency: "NGN", priceGbp: kobo / 100, priceAllInGbp: kobo / 100 }, "NGN");
      const expected = expectedFromMinor(kobo, "₦");
      if (shown !== expected) wrong.push(`${kobo} kobo → ${shown} (expected ${expected})`);
    }
    expect(wrong.slice(0, 5)).toEqual([]);
    expect(buyPrice({ currency: "NGN", priceAllInGbp: 9_999_999_999.99 }, "NGN")).toBe(
      "₦9,999,999,999.99",
    );
  });
});

describe("#3645 tester — the trip headline never differs from the charge", () => {
  test("every kobo ending on a large trip price prints the exact charge", () => {
    const wrong: string[] = [];
    for (let kobo = 151_577_200; kobo <= 151_577_399; kobo += 1) {
      const shown = tripTierPriceLabel(tier({ priceCents: 145_050_000, priceAllInCents: kobo }));
      if (!shown.startsWith("₦") || minorShown(shown) !== kobo || endsInOneDecimal(shown)) {
        wrong.push(`${kobo} kobo → ${shown}`);
      }
    }
    expect(wrong.slice(0, 5)).toEqual([]);
  });

  test("the reported price is not rounded up to the next naira", () => {
    const shown = tripTierPriceLabel(tier({ priceCents: 145_050_000, priceAllInCents: 151_577_250 }));
    expect(minorShown(shown)).toBe(151_577_250);
    expect(shown).not.toMatch(/1[,.\s  ]?515[,.\s  ]?773/);
  });

  test("cents 1..9999 in dollars print the exact charge", () => {
    const wrong: string[] = [];
    for (let cents = 1; cents <= 9999; cents += 1) {
      const shown = tripTierPriceLabel(
        tier({ priceCents: cents, priceAllInCents: cents, currency: "USD" }),
      );
      if (minorShown(shown) !== cents || endsInOneDecimal(shown)) wrong.push(`${cents}c → ${shown}`);
    }
    expect(wrong.slice(0, 5)).toEqual([]);
  });

  test("a free trip tier and a missing all-in are unchanged", () => {
    expect(tripTierPriceLabel(tier({ isFree: true }))).toBe("Free");
    expect(tripTierPriceLabel(tier({ priceCents: 0, priceAllInCents: 0 }))).toBe("Free");
    // No server all-in: the base price is shown, to the cent.
    const shown = tripTierPriceLabel(
      tier({ priceCents: 1050, priceAllInCents: null, currency: "USD" }),
    );
    expect(minorShown(shown)).toBe(1050);
  });

  test("a currency code Intl rejects falls back to plain text, never one decimal", () => {
    expect(tripTierPriceLabel(tier({ priceAllInCents: 151_577_250, currency: "NAIRA" }))).toBe(
      "1515772.50 NAIRA",
    );
    expect(tripTierPriceLabel(tier({ priceAllInCents: 500_000, currency: "NAIRA" }))).toBe(
      "5000 NAIRA",
    );
  });
});

describe("#3645 tester — float noise", () => {
  test("a value a hair under .50 prints .50, not .5 and not .49", () => {
    expect(buyPrice({ currency: "NGN", priceAllInGbp: 1515772.4999999998 }, "NGN")).toBe(
      "₦1,515,772.50",
    );
  });

  test("sums that binary floats cannot hold print two decimals", () => {
    expect(buyPrice({ currency: "USD", priceAllInGbp: 0.1 + 0.2 })).toBe("$0.30");
    expect(buyPrice({ currency: "USD", priceAllInGbp: 0.7 + 0.1 })).toBe("$0.80");
    expect(buyPrice({ currency: "GBP", priceAllInGbp: 1.1 * 3 })).toBe("£3.30");
    expect(buyPrice({ currency: "EUR", priceAllInGbp: 4.35 * 100 / 100 })).toBe("€4.35");
  });

  test("noise next to a whole amount never moves the price to another naira", () => {
    for (const noisy of [5000.000000001, 4999.999999999, 122.99999999999999, 249.00000000000003]) {
      const shown = buyPrice({ currency: "NGN", priceAllInGbp: noisy }, "NGN");
      expect(endsInOneDecimal(shown)).toBe(false);
      expect(minorShown(shown)).toBe(Math.round(noisy) * 100);
    }
  });
});

describe("#3645 tester — hostile numbers", () => {
  test.each([
    ["negative", -10.5, "-£10.50"],
    ["negative whole", -10, "-£10"],
    ["tiny", 0.01, "£0.01"],
    ["just under a penny rounds to pence, not to one digit", 0.049, "£0.05"],
    ["huge whole", 1e15, "£1,000,000,000,000,000"],
  ])("%s", (_name, amount, expected) => {
    const shown = buyPrice({ priceGbp: amount, priceAllInGbp: amount });
    expect(shown).toBe(expected);
    expect(shown).not.toMatch(SINGLE_DECIMAL);
  });

  test("NaN and Infinity do not throw and never read as a one-decimal price", () => {
    for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const shown = buyPrice({ priceGbp: amount, priceAllInGbp: amount });
      expect(typeof shown).toBe("string");
      expect(shown).not.toMatch(SINGLE_DECIMAL);
      expect(() => (amount as number).toFixed(priceFallbackDecimals(amount))).not.toThrow();
    }
  });
});

describe("#3645 tester — hostile currency codes", () => {
  test("no currency at all shows the bare amount with two decimals, no symbol", () => {
    expect(buyPrice({ currency: null }, null)).toBe("10.50");
  });

  test("the event's currency is used when the ticket carries none", () => {
    expect(buyPrice({ currency: null, priceAllInGbp: 1515772.5 }, "NGN")).toBe("₦1,515,772.50");
  });

  test("a lowercase code still shows the naira glyph and both kobo digits", () => {
    expect(buyPrice({ currency: "ngn" as never, priceAllInGbp: 1515772.5 }, "NGN")).toBe(
      "₦1,515,772.50",
    );
  });

  test("a well-formed but unknown code and a malformed code both keep two decimals", () => {
    expect(buyPrice({ currency: "XYZ" as never })).toBe("XYZ 10.50");
    expect(buyPrice({ currency: "NAIRA" as never })).toBe("NAIRA 10.50");
  });

  test("yen never gains decimals and dinar keeps all three", () => {
    expect(buyPrice({ currency: "JPY" as never, priceAllInGbp: 1200 })).toBe("¥1,200");
    expect(buyPrice({ currency: "JPY" as never, priceAllInGbp: 1200.4 })).toBe("¥1,200");
    expect(buyPrice({ currency: "KWD" as never, priceAllInGbp: 10.5 })).toBe("KWD 10.500");
    expect(buyPrice({ currency: "BHD" as never, priceAllInGbp: 10.125 })).toBe("BHD 10.125");
    expect(buyPrice({ currency: "BHD" as never, priceAllInGbp: 10 })).toBe("BHD 10");
    for (const code of ["JPY", "KWD", "BHD"]) {
      for (const amount of [0.5, 10.5, 1200.5, 99.9]) {
        expect(buyPrice({ currency: code as never, priceAllInGbp: amount })).not.toMatch(
          SINGLE_DECIMAL,
        );
      }
    }
  });
});

describe("#3645 tester — the helper itself", () => {
  test("it only ever speaks about fraction digits, and its results cannot be mutated", () => {
    for (const amount of [0, -0, 1, 1.5, -1.5, 1e21, Number.NaN, Number.POSITIVE_INFINITY]) {
      const options = priceDecimals(amount);
      expect(Object.isFrozen(options)).toBe(true);
      for (const key of Object.keys(options)) {
        expect(["minimumFractionDigits", "maximumFractionDigits"]).toContain(key);
      }
      // Spread last, it must not be able to change the style or the currency.
      const merged = { style: "currency", currency: "NGN", ...options } as Record<string, unknown>;
      expect(merged.style).toBe("currency");
      expect(merged.currency).toBe("NGN");
    }
    expect(priceDecimals(5000)).toEqual({ minimumFractionDigits: 0, maximumFractionDigits: 0 });
    expect(priceDecimals(1515772.5)).toEqual({});
  });

  test("the fallback is none or two, never one, for any number", () => {
    for (const amount of [0, 5000, 0.5, 1515772.5, -0.5, 1e-9, Number.NaN]) {
      expect([0, 2]).toContain(priceFallbackDecimals(amount));
    }
    expect((0.5).toFixed(priceFallbackDecimals(0.5))).toBe("0.50");
  });

  test("it is a leaf module: no imports, so the shared package pulls in no app code", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "..", "..", "..", "packages/offering-rendering/priceDecimals.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(/\bimport\b/);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });
});

describe("#3645 tester — a mounted ticket box", () => {
  const theme = resolveTheme(null, null);
  const mount = async (
    tickets: PublicTicketProps[],
    quantities: Record<string, number>,
    currency: string | null,
  ): Promise<string[]> => {
    let tree!: Tree;
    await TestRenderer.act(() => {
      tree = TestRenderer.create(
        <EventTicketBox
          event={{ id: "event-adv", name: "Harmattan Club", currency, tickets } as never}
          bookable
          palette={createThemePalette(theme)}
          theme={theme}
          variant={"published" as never}
          ticketQuantities={quantities}
          onChangeTicketQuantity={() => undefined}
          onProceedToCart={() => undefined}
        />,
      );
    });
    const shown = visibleStrings(tree.toJSON());
    await TestRenderer.act(() => tree.unmount());
    return shown;
  };

  test("the row, the total and the button all carry both pence digits", async () => {
    const shown = await mount([ticket()], { "tier-adv": 3 }, "GBP");
    expect(shown).toContain("£10.50");
    expect(shown).toContain("£31.50");
    expect(shown).toContain("Buy ticket · £31.50");
    expect(shown.filter((value) => SINGLE_DECIMAL.test(value))).toEqual([]);
  });

  test("two naira tiers with kobo: every figure on the box is a full price", async () => {
    const shown = await mount(
      [
        ticket({ id: "a", currency: "NGN", priceGbp: 1450500, priceAllInGbp: 1515772.5 }),
        ticket({ id: "b", currency: "NGN", priceGbp: 2000, priceAllInGbp: 2090.1 }),
      ],
      { a: 2, b: 1 },
      "NGN",
    );
    expect(shown).toContain("₦1,515,772.50");
    expect(shown).toContain("₦2,090.10");
    // 2 × 1,515,772.50 + 2,090.10
    expect(shown).toContain("₦3,033,635.10");
    expect(shown.filter((value) => SINGLE_DECIMAL.test(value))).toEqual([]);
    expect(shown.some((value) => value.includes("NGN"))).toBe(false);
  });

  test("a whole total still shows no decimals", async () => {
    const shown = await mount(
      [ticket({ currency: "NGN", priceGbp: 5000, priceAllInGbp: 5000 })],
      { "tier-adv": 4 },
      "NGN",
    );
    expect(shown).toContain("₦5,000");
    expect(shown).toContain("₦20,000");
    expect(shown.some((value) => /\.00\b/.test(value))).toBe(false);
  });

  test("a free ticket on an event with no currency still reads 'Free'", async () => {
    const shown = await mount(
      [ticket({ isFree: true, currency: null, priceGbp: 0, priceAllInGbp: null })],
      { "tier-adv": 1 },
      null,
    );
    expect(shown).toContain("Free");
    expect(shown.filter((value) => /\d[.,]\d/.test(value))).toEqual([]);
  });
});
