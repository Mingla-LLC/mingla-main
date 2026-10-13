/**
 * issue #3645 — a whole total shows no decimals despite float noise.
 *
 * The decimals rule decided "whole amount" on the raw float. A total summed in
 * floats is rarely a clean integer: 15 tickets at £8.20 is 122.99999999999999,
 * so the Total line and the Buy button read "£123.00" where they used to read
 * "£123", and 3 × £0.70 + £0.90 read "£3.00".
 *
 * The rule now decides after rounding to the currency's own minor unit (Intl
 * does the rounding): within half a penny of a whole number, the price asks
 * only for "no minimum decimals", so the zeros drop and nothing else changes.
 *
 * Fails on revert (delete the half-a-penny branch in
 * packages/offering-rendering/priceDecimals.ts so only exact integers are
 * whole): the two mounted totals print "£123.00" and "£3.00".
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

import { withCurrencyGlyph } from "../../../../../packages/offering-rendering/currencyGlyph";
import { EventTicketBox } from "../../../../../packages/offering-rendering/EventOfferingBody";
import {
  priceDecimals,
  priceFallbackDecimals,
} from "../../../../../packages/offering-rendering/priceDecimals";
import { createThemePalette } from "../../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../../packages/offering-rendering/themeResolver";
import type { PublicTicketProps } from "../../../../../packages/offering-rendering/types";

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

/** A displayed price as the offering pages build it (en-US, glyph rule on). */
const show = (amount: number, currency: string): string =>
  withCurrencyGlyph(
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      ...priceDecimals(amount),
    }).format(amount),
    currency,
  );

const ticket = (overrides: Partial<PublicTicketProps> = {}): PublicTicketProps =>
  ({
    id: "tier-whole",
    name: "General",
    description: null,
    priceGbp: 8.2,
    priceAllInGbp: 8.2,
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

const theme = resolveTheme(null, null);
const mount = async (
  tickets: PublicTicketProps[],
  quantities: Record<string, number>,
  currency: string,
): Promise<string[]> => {
  let tree!: Tree;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <EventTicketBox
        event={{ id: "event-whole", name: "Harmattan Club", currency, tickets } as never}
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

/** A price with exactly one digit after the decimal point, e.g. "772.5". */
const SINGLE_DECIMAL = /\d\.\d(?!\d)/;
const ZERO_DECIMALS = /\.0+(?!\d)/;

describe("#3645 a whole total shows no decimals despite float noise", () => {
  test("the sums really are noisy floats", () => {
    expect(15 * 8.2).not.toBe(123);
    expect(3 * 0.7 + 0.9).not.toBe(3);
  });

  test.each([
    ["15 x 8.20", 15 * 8.2, "GBP", "£123"],
    ["3 x 0.70 + 0.90", 3 * 0.7 + 0.9, "GBP", "£3"],
    ["a hair over a whole", 249.00000000000003, "USD", "$249"],
    ["just under half a penny below", 122.996, "GBP", "£123"],
    ["just over half a penny below", 122.994, "GBP", "£122.99"],
    ["a hair over a penny above", 123.011, "GBP", "£123.01"],
    ["half a penny rounds as Intl rounds it", 0.005, "GBP", "£0.01"],
    ["kobo are kept", 1515772.5, "NGN", "₦1,515,772.50"],
    ["noisy whole naira", 4999.999999999, "NGN", "₦5,000"],
    ["a clean whole", 5000, "NGN", "₦5,000"],
    ["ten pence is two digits", 122.1, "GBP", "£122.10"],
    // Zero-decimal currency: never decimals.
    ["noisy yen", 1199.9999999999998, "JPY", "¥1,200"],
    ["yen near a whole", 122.996, "JPY", "¥123"],
    ["yen and a half", 1200.5, "JPY", "¥1,201"],
    // Three-decimal currency: whole only within half of ITS smallest unit.
    ["noisy dinar", 122.99999999999999, "KWD", "KWD 123"],
    ["dinar rounds to whole", 122.9996, "KWD", "KWD 123"],
    ["dinar keeps its fils", 122.996, "KWD", "KWD 122.996"],
    ["dinar keeps four fils", 10.004, "BHD", "BHD 10.004"],
    ["dinar and a half", 10.5, "KWD", "KWD 10.500"],
  ])("%s (%p %s) shows %p", (_name, amount, currency, expected) => {
    const shown = show(amount, currency);
    expect(shown).toBe(expected);
    expect(shown).not.toMatch(SINGLE_DECIMAL);
  });

  test("the helper's results stay frozen and speak only about fraction digits", () => {
    for (const amount of [15 * 8.2, 3 * 0.7 + 0.9, 122.996, 122.994, 1515772.5, 5000]) {
      const options = priceDecimals(amount);
      expect(Object.isFrozen(options)).toBe(true);
      for (const key of Object.keys(options)) {
        expect(["minimumFractionDigits", "maximumFractionDigits"]).toContain(key);
      }
    }
  });

  test("the plain-text fallback drops the zeros of a noisy whole too", () => {
    const noisy = 15 * 8.2;
    expect(noisy.toFixed(priceFallbackDecimals(noisy))).toBe("123");
    expect((122.994).toFixed(priceFallbackDecimals(122.994))).toBe("122.99");
    expect((1515772.5).toFixed(priceFallbackDecimals(1515772.5))).toBe("1515772.50");
  });
});

describe("#3645 the mounted ticket box total", () => {
  test("15 tickets at £8.20: the Total and the Buy button read £123", async () => {
    const shown = await mount([ticket()], { "tier-whole": 15 }, "GBP");
    expect(shown).toContain("£8.20");
    expect(shown).toContain("£123");
    expect(shown).toContain("Buy ticket · £123");
    expect(shown.filter((value) => ZERO_DECIMALS.test(value))).toEqual([]);
    expect(shown.filter((value) => SINGLE_DECIMAL.test(value))).toEqual([]);
  });

  test("3 at £0.70 plus 1 at £0.90: the Total and the Buy button read £3", async () => {
    const shown = await mount(
      [
        ticket({ id: "a", priceGbp: 0.7, priceAllInGbp: 0.7 }),
        ticket({ id: "b", priceGbp: 0.9, priceAllInGbp: 0.9 }),
      ],
      { a: 3, b: 1 },
      "GBP",
    );
    expect(shown).toContain("£0.70");
    expect(shown).toContain("£0.90");
    expect(shown).toContain("£3");
    expect(shown).toContain("Buy ticket · £3");
    expect(shown.filter((value) => ZERO_DECIMALS.test(value))).toEqual([]);
    expect(shown.filter((value) => SINGLE_DECIMAL.test(value))).toEqual([]);
  });

  test("a naira total with kobo keeps both digits", async () => {
    const shown = await mount(
      [ticket({ currency: "NGN", priceGbp: 1450500, priceAllInGbp: 1515772.5 })],
      { "tier-whole": 1 },
      "NGN",
    );
    expect(shown).toContain("Buy ticket · ₦1,515,772.50");
  });
});
