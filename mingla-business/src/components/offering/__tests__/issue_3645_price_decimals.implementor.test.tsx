/**
 * issue #3645 — a price never shows a single decimal digit.
 *
 * Found in host onboarding (2026-10-13): a ₦1,450,500 ticket with both fees
 * passed on is charged ₦1,515,772.50, and the public event page and the Buy
 * button printed "₦1,515,772.5". The formatters asked Intl for "0 to 2"
 * decimals so a whole price reads "₦5,000"; the same options drop the trailing
 * zero of ".50". The trip headline asked for 0 decimals, so the same price was
 * rounded UP and read higher than the charge.
 *
 * One shared rule (packages/offering-rendering/priceDecimals.ts): a whole
 * amount shows no decimals, anything else shows the currency's full decimals.
 *
 * Fails on revert (delete the `...priceDecimals(...)` line and restore the old
 * options at a site): the Buy button test and the ticket row test print
 * "₦1,515,772.5"; the trip test prints "₦1,515,773".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

import { withCurrencyGlyph } from "../../../../../packages/offering-rendering/currencyGlyph";
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
    id: "tier-3645",
    name: "Table for ten",
    description: null,
    priceGbp: 1450500,
    priceAllInGbp: 1515772.5,
    currency: "NGN",
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

/** A price with exactly one digit after the decimal point, e.g. "772.5". */
const SINGLE_DECIMAL = /\d\.\d(?!\d)/;

describe("#3645 the shared decimals rule", () => {
  test.each([
    [1515772.5, "NGN", "₦1,515,772.50"],
    [5000, "NGN", "₦5,000"],
    [10.5, "GBP", "£10.50"],
    [12.1, "USD", "$12.10"],
    [35, "USD", "$35"],
    [0.5, "EUR", "€0.50"],
    [19.99, "USD", "$19.99"],
    // Zero-decimal currency: never decimals, whole or not.
    [1200, "JPY", "¥1,200"],
    [1200.5, "JPY", "¥1,201"],
    // Three-decimal currency keeps all three, never one (Intl puts a no-break
    // space after the code).
    [10.5, "KWD", "KWD\u00a010.500"],
    [10, "KWD", "KWD\u00a010"],
  ])("%p %s shows %p", (amount, currency, expected) => {
    const shown = show(amount, currency);
    expect(shown).toBe(expected);
    expect(shown).not.toMatch(SINGLE_DECIMAL);
  });

  test("the plain-text fallback is never one decimal either", () => {
    expect((1515772.5).toFixed(priceFallbackDecimals(1515772.5))).toBe("1515772.50");
    expect((5000).toFixed(priceFallbackDecimals(5000))).toBe("5000");
  });
});

describe("#3645 public event page", () => {
  test("the Buy button shows the full charge for one tier and for several", () => {
    const one = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [ticket()],
      currency: "NGN",
    });
    expect(one).toEqual(expect.objectContaining({ kind: "buy", price: "₦1,515,772.50" }));

    const several = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [
        ticket({ id: "a", currency: "GBP", priceGbp: 10, priceAllInGbp: 10.5 }),
        ticket({ id: "b", currency: "GBP", priceGbp: 40, priceAllInGbp: 42 }),
      ],
      currency: "GBP",
    });
    expect(several).toEqual(expect.objectContaining({ kind: "buy", price: "From £10.50" }));
  });

  test("a whole price on the Buy button still drops the zeros", () => {
    const whole = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [ticket({ priceGbp: 5000, priceAllInGbp: 5000 })],
      currency: "NGN",
    });
    expect(whole).toEqual(expect.objectContaining({ kind: "buy", price: "₦5,000" }));

    const usd = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [ticket({ currency: "USD", priceGbp: 12, priceAllInGbp: 12.1 })],
      currency: "USD",
    });
    expect(usd).toEqual(expect.objectContaining({ kind: "buy", price: "$12.10" }));
  });

  test("the ticket row and the ticket box button show ₦1,515,772.50", async () => {
    const theme = resolveTheme(null, null);
    const row = ticket();
    let tree!: Tree;
    await TestRenderer.act(() => {
      tree = TestRenderer.create(
        <EventTicketBox
          event={{
            id: "event-3645",
            name: "Harmattan Club",
            currency: "NGN",
            tickets: [row],
          } as never}
          bookable
          palette={createThemePalette(theme)}
          theme={theme}
          variant={"published" as never}
          ticketQuantities={{ [row.id]: 1 }}
          onChangeTicketQuantity={() => undefined}
          onProceedToCart={() => undefined}
        />,
      );
    });
    const shown = visibleStrings(tree.toJSON());
    expect(shown).toContain("₦1,515,772.50");
    expect(shown).toContain("Buy ticket · ₦1,515,772.50");
    expect(shown.filter((value) => SINGLE_DECIMAL.test(value))).toEqual([]);
    await TestRenderer.act(() => tree.unmount());
  });
});

describe("#3645 trip headline", () => {
  const tier = (overrides: Partial<TripOfferingTier> = {}): TripOfferingTier => ({
    id: "tier-trip-3645",
    ticketTypeId: "tt-3645",
    tierName: "Shared room",
    priceCents: 145050000,
    priceAllInCents: 151577250,
    currency: "NGN",
    isFree: false,
    isUnlimited: true,
    ticketsRemaining: null,
    installmentSchedule: null,
    ...overrides,
  });

  test("a price ending in .50 is shown exactly, never rounded up past the charge", () => {
    expect(tripTierPriceLabel(tier())).toBe("₦1,515,772.50");
  });

  test("a whole trip price still shows no decimals", () => {
    expect(
      tripTierPriceLabel(tier({ priceCents: 120000, priceAllInCents: 120000, currency: "USD" })),
    ).toBe("$1,200");
  });
});

// The legacy event page's ticket row and the two route bars sit inside files no
// unit test can mount, so their wiring is held structurally (comments ignored).
describe("#3645 sites that cannot be mounted use the shared rule", () => {
  const REPO = join(__dirname, "..", "..", "..", "..", "..");
  const code = (rel: string): string =>
    readFileSync(join(REPO, rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  test.each([
    ["packages/offering-rendering/PublicEventPage.tsx", "price"],
    ["packages/offering-rendering/EventOfferingBody.tsx", "amount"],
    ["packages/offering-rendering/offeringCta.ts", "price"],
    ["packages/offering-rendering/useTripOfferingState.ts", "priceCents / 100"],
    ["mingla-business/app/t/[brandSlug]/[tripSlug].tsx", "priceCents / 100"],
    ["mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx", "priceCents / 100"],
  ])("%s", (rel, amount) => {
    const src = code(rel);
    expect(src).toContain(`...priceDecimals(${amount}),`);
    // The two option shapes that caused the bug are gone from the file.
    expect(src).not.toMatch(/minimumFractionDigits:\s*0,\s*maximumFractionDigits:\s*2/);
    expect(src).not.toMatch(/maximumFractionDigits:\s*0,\s*\}\)\.format\(priceCents \/ 100\)/);
  });
});
