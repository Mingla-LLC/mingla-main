/**
 * issue #3341 — naira prices must read "₦25,000", never "NGN 25,000".
 *
 * Found filming Scene 04 (2026-09-14): the public event page ticket box and
 * iPhone price displays printed the ISO code. Intl prints "NGN" for naira in
 * most locales, and Hermes can do the same even for en-NG, so the fix swaps
 * the code for the glyph after formatting (one shared rule,
 * packages/offering-rendering/currencyGlyph.ts).
 *
 * Fails on revert:
 *   - drop the glyph swap from EventOfferingBody → the ticket box test prints "NGN"
 *   - drop it from offeringCta → the floating "From …" test prints "NGN"
 *   - drop it from utils/currency → the engine-without-en-NG tests print "NGN"
 *   - drop it from TicketTierEditSheet → the price label reads "Price (NGN)"
 *
 * Every other currency must format exactly as before.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";
import { EventTicketBox } from "../../../../../packages/offering-rendering/EventOfferingBody";
import { resolveOfferingCta } from "../../../../../packages/offering-rendering/offeringCta";
import { createThemePalette } from "../../../../../packages/offering-rendering/themePalette";
import { resolveTheme } from "../../../../../packages/offering-rendering/themeResolver";
import type { PublicTicketProps } from "../../../../../packages/offering-rendering/types";
import type { TicketStub } from "../../../store/draftEventStore";
import {
  formatCurrency,
  formatCurrencyRound,
  formatMoney,
} from "../../../utils/currency";

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
jest.mock("@react-native-community/datetimepicker", () => ({
  __esModule: true,
  default: (): null => null,
}));
jest.mock("../../../hooks/useEventWaitlist", () => ({
  useEventWaitlist: () => ({ data: [] }),
}));
jest.mock("../../../wrappers/SmartScrollView", () => ({
  ScrollView: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
    visible ? React.createElement("MockSheet", null, children) : null,
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) => React.createElement("MockButton", props),
}));

// eslint-disable-next-line import/first
import { TicketTierEditSheet } from "../TicketTierEditSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Tree = {
  root: {
    findAll: (predicate: (node: { props: Record<string, unknown>; children?: unknown }) => boolean) => {
      props: Record<string, unknown>;
    }[];
  };
  toJSON: () => unknown;
  unmount: () => void;
};
// The repo intentionally carries no react-test-renderer declarations.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Tree;
  act: (fn: () => void | Promise<void>) => Promise<void>;
};

const nairaTicket = (overrides: Partial<PublicTicketProps> = {}): PublicTicketProps =>
  ({
    id: "tier-3341",
    name: "Harmattan Club entry",
    description: null,
    priceGbp: 25000,
    priceAllInGbp: 25000,
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

/**
 * Stand-in for an engine with no en-NG currency data (Hermes on iOS, some
 * browsers): every locale formats like en-US, which prints the ISO code.
 */
const RealNumberFormat = Intl.NumberFormat;
const forceEngineWithoutNairaSymbol = (): void => {
  const Fallback = function (
    _locale?: string | string[],
    options?: Intl.NumberFormatOptions,
  ) {
    return new RealNumberFormat("en-US", options);
  } as unknown as typeof Intl.NumberFormat;
  Object.defineProperty(Intl, "NumberFormat", {
    configurable: true,
    writable: true,
    value: Fallback,
  });
};

describe("#3341 the shared glyph rule", () => {
  test.each([
    ["NGN 25,000", "NGN", "₦25,000"],
    ["NGN 25,000.00", "NGN", "₦25,000.00"],
    ["-NGN 5,000", "NGN", "-₦5,000"],
    ["25 000,00 NGN", "NGN", "25 000,00 ₦"],
    ["₦25,000", "NGN", "₦25,000"],
    ["NGN 5,000", " ngn ", "₦5,000"],
    ["$25", "USD", "$25"],
    ["£25", "GBP", "£25"],
    ["NGN 25", null, "NGN 25"],
    ["NGN 25", "", "NGN 25"],
  ])("withCurrencyGlyph(%p, %p) → %p", (formatted, code, expected) => {
    expect(withCurrencyGlyph(formatted, code)).toBe(expected);
  });
});

describe("#3341 Business money formatter on an engine without en-NG data", () => {
  beforeEach(forceEngineWithoutNairaSymbol);
  afterEach(() => {
    Object.defineProperty(Intl, "NumberFormat", {
      configurable: true,
      writable: true,
      value: RealNumberFormat,
    });
  });

  test("the stand-in engine really prints the ISO code (the bug's precondition)", () => {
    expect(
      new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(25000),
    ).toContain("NGN");
  });

  test("ticket card, checkout and forecast amounts read ₦", () => {
    expect(formatCurrencyRound(25000, "NGN")).toBe("₦25,000");
    expect(formatCurrency(25000, "NGN")).toBe("₦25,000.00");
    expect(formatCurrency(2500000, "NGN", true)).toBe("₦25,000.00");
    expect(formatMoney({ amount: 5000, currency: "ngn" }, { rounded: true })).toBe("₦5,000");
  });

  test("other currencies are untouched", () => {
    expect(formatCurrencyRound(35, "USD")).toBe("$35");
    expect(formatCurrency(156.2, "GBP")).toBe("£156.20");
    expect(formatCurrency(8420, "EUR")).toBe("€8,420.00");
  });
});

describe("#3341 public event page", () => {
  test("the floating button price reads ₦ for one tier and for several", () => {
    const one = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [nairaTicket({ priceGbp: 5000, priceAllInGbp: 5000 })],
      currency: "NGN",
    });
    expect(one).toEqual(expect.objectContaining({ kind: "buy", price: "₦5,000" }));

    const several = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [
        nairaTicket({ id: "a", priceGbp: 5000, priceAllInGbp: 5000 }),
        nairaTicket({ id: "b", priceGbp: 25000, priceAllInGbp: 25000 }),
      ],
      currency: "NGN",
    });
    expect(several).toEqual(expect.objectContaining({ kind: "buy", price: "From ₦5,000" }));
  });

  test("a dollar event's floating button is unchanged", () => {
    const usd = resolveOfferingCta({
      variant: "published",
      bookable: true,
      tickets: [nairaTicket({ currency: "USD", priceGbp: 35, priceAllInGbp: 35 })],
      currency: "USD",
    });
    expect(usd).toEqual(expect.objectContaining({ kind: "buy", price: "$35" }));
  });

  test("the ticket box shows ₦25,000 per ticket and in the total, never NGN", async () => {
    const theme = resolveTheme(null, null);
    const ticket = nairaTicket();
    let tree!: Tree;
    await TestRenderer.act(() => {
      tree = TestRenderer.create(
        <EventTicketBox
          event={{
            id: "event-3341",
            name: "Harmattan Club",
            currency: "NGN",
            tickets: [ticket],
          } as never}
          bookable
          palette={createThemePalette(theme)}
          theme={theme}
          variant={"published" as never}
          ticketQuantities={{ [ticket.id]: 1 }}
          onChangeTicketQuantity={() => undefined}
          onProceedToCart={() => undefined}
        />,
      );
    });
    const shown = visibleStrings(tree.toJSON());
    expect(shown).toContain("₦25,000");
    expect(shown).toContain("Buy ticket · ₦25,000");
    expect(shown.filter((value) => value.includes("NGN"))).toEqual([]);
    await TestRenderer.act(() => tree.unmount());
  });
});

describe("#3341 Business ticket sheet", () => {
  test("the price field is labelled with ₦, not NGN", async () => {
    const initial = {
      id: "ticket-3341",
      name: "Harmattan Club entry",
      priceGbp: 25000,
      capacity: 200,
      isFree: false,
      isUnlimited: false,
      visibility: "public",
      displayOrder: 0,
      approvalRequired: false,
      passwordProtected: false,
      password: null,
      passwordConfigured: false,
      waitlistEnabled: false,
      minPurchaseQty: 1,
      maxPurchaseQty: null,
      allowTransfers: true,
      description: null,
      saleStartAt: null,
      saleEndAt: null,
      availableAt: "both",
    } as TicketStub;
    let tree!: Tree;
    await TestRenderer.act(() => {
      tree = TestRenderer.create(
        <TicketTierEditSheet
          visible
          initial={initial}
          nextOrder={0}
          onClose={() => undefined}
          onSave={() => undefined}
          eventCurrency="NGN"
        />,
      );
    });
    const shown = visibleStrings(tree.toJSON());
    expect(shown).toContain("Price (₦)");
    expect(shown).not.toContain("Price (NGN)");
    await TestRenderer.act(() => tree.unmount());
  });
});
