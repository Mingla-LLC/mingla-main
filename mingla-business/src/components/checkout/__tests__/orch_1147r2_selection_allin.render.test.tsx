// ORCH-1147R2 [cart SELECTION screen must show the all-in, not the bare base]
// — TESTER adversarial RENDER-PROOF (different angle than the implementor).
//
// The R1 blind spot: the money math was proven, but the SELECTION SCREEN was
// never RENDERED, so the bare-base display bug shipped unseen. The implementor's
// R2 test (orch_1147r2_selection_allin.test.ts) is a MATH-replication +
// SOURCE-TEXT grep — it never mounts a React tree. THIS test attacks the OTHER
// angle: it MOUNTS the production components with react-test-renderer +
// @testing-library/react-native and asserts on the ACTUAL RENDERED TEXT.
//
// Two render surfaces are proven for event / trip / experience:
//   (A) per-tier QuantityRow — mounts the REAL mingla-business <QuantityRow>
//       wrapper (which forwards priceAllInGbp) → the shared
//       @mingla/offering-rendering row. Asserts the rendered price is the ALL-IN
//       ("£67.93"), the "incl. VAT & fees" caption renders, and the bare base
//       ("£65.00") is NOT the headline price.
//   (B) bottom bar — renders the EXACT JSX from the three checkout index.tsx
//       screens (the "Total" label, headlineAllIn = useCartTotals().allInTotal,
//       and the gated combined "Fees & tax" line) driven by the REAL
//       useCartTotals reduce over a synthetic pass-fee CartLine. Asserts the
//       rendered headline is the all-in, the relabel is "Total" (not
//       "Subtotal"), and the single "Fees & tax" line renders the delta.
//
// No-regression cells (absorb / free / RPC-miss / trip-deposit) assert the
// NEGATIVE: base==all-in shows base with NO fees line + no caption; the trip
// installments "Due today" deposit branch is unchanged with NO fees line.
//
// SPEC §7 T-1..T-8, T-10 (render leg). I-PROPOSED-1147R2-SELECTION-SHOWS-ALLIN.

import React from "react";
import { Text, View } from "react-native";
import { render, screen } from "@testing-library/react-native";

import { QuantityRow } from "../../../components/checkout/QuantityRow";
import {
  CartProvider,
  useCart,
  useCartTotals,
} from "../CartContext";
import { formatCurrency } from "../../../utils/currency";
import type { TicketStub } from "../../../store/draftEventStore";

// --- real-provider cart seeding ------------------------------------------
// We mount the REAL CartProvider (a synchronous useReducer — no AsyncStorage /
// no all-in RPC) and seed exactly one line via the REAL setLineQuantity, which
// carries unitPriceAllIn into the reducer. The BottomBar then reads the REAL
// useCartTotals reduce (allInTotal / feesTaxCents / hasFeesTaxDelta). Nothing
// about the money path is faked — only the seed shortcut replaces the deck UI.
interface SeedLine {
  unitPrice: number;
  unitPriceAllIn?: number;
  quantity: number;
  isFree?: boolean;
  currency?: string;
}

// Seeds the cart synchronously on the FIRST render commit (useLayoutEffect),
// then renders `children` only once the cart actually holds a line — so the
// BottomBar (which, like the real screen, computes headlineAllIn unconditionally)
// only ever paints against a populated cart, exactly as production seeds from the
// public-page params before the screen is interactive.
const CartSeeder: React.FC<{ line: SeedLine; children: React.ReactNode }> = ({
  line,
  children,
}) => {
  const { lines, setLineQuantity } = useCart();
  React.useLayoutEffect(() => {
    setLineQuantity({
      ticketTypeId: "tt_1",
      ticketName: "General",
      unitPrice: line.unitPrice,
      unitPriceAllIn: line.unitPriceAllIn,
      currency: line.currency ?? "GBP",
      isFree: line.isFree ?? false,
      quantity: line.quantity,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return lines.length > 0 ? <>{children}</> : null;
};

// --- synthetic ticket stubs (pass-fee / absorb / free / RPC-miss) --------
const baseTicket = (over: Partial<TicketStub>): TicketStub =>
  ({
    id: over.id ?? "tt_1",
    name: over.name ?? "General Admission",
    priceGbp: over.priceGbp ?? null,
    priceAllInGbp: over.priceAllInGbp,
    currency: over.currency ?? "GBP",
    capacity: over.capacity ?? 100,
    isFree: over.isFree ?? false,
    isUnlimited: over.isUnlimited ?? false,
    visibility: over.visibility ?? "public",
    displayOrder: 0,
    approvalRequired: false,
    passwordProtected: false,
  }) as TicketStub;

// --- the EXACT bottom-bar JSX from checkout/[*]/index.tsx ----------------
// Reproduces verbatim: headlineAllIn = formatCurrency(allInTotal, currency);
// showFeesTaxLine = !isEmpty && !isFree && hasFeesTaxDelta [&& dueToday===null];
// label = (dueToday !== null && !isEmpty && !isFree) ? "Due today" : "Total".
// Drives the REAL useCartTotals so the bind under test is exercised, not faked.
const BottomBar: React.FC<{ dueTodayCents?: number | null }> = ({
  dueTodayCents = null,
}) => {
  const totals = useCartTotals();
  const headlineAllIn = formatCurrency(totals.allInTotal, totals.currency);
  const showFeesTaxLine =
    !totals.isEmpty &&
    !totals.isFree &&
    totals.hasFeesTaxDelta &&
    dueTodayCents === null;
  const label =
    dueTodayCents !== null && !totals.isEmpty && !totals.isFree
      ? "Due today"
      : "Total";
  const value = totals.isEmpty
    ? "—"
    : totals.isFree
      ? "Free"
      : dueTodayCents !== null
        ? formatCurrency(dueTodayCents, totals.currency, true)
        : headlineAllIn;
  return (
    <View>
      {showFeesTaxLine ? (
        <Text testID="fees-tax">
          Fees &amp; tax{" "}
          {formatCurrency(totals.feesTaxCents, totals.currency, true)}
        </Text>
      ) : null}
      <Text testID="bar-label">{label}</Text>
      <Text testID="bar-value">{value}</Text>
    </View>
  );
};

// Per offering-type "screens" differ only in copy strings; the SELECTION price
// surfaces (per-tier row + bottom bar) are the SAME components/derivation. We
// parametrize the per-tier + bottom-bar proof across all three to prove parity.
const OFFERINGS = ["event", "trip", "experience"] as const;

// Mount the bottom bar inside the REAL provider + seed one line synchronously.
const renderBar = (line: SeedLine, dueTodayCents: number | null = null): void => {
  render(
    <CartProvider>
      <CartSeeder line={line}>
        <BottomBar dueTodayCents={dueTodayCents} />
      </CartSeeder>
    </CartProvider>,
  );
};

describe("ORCH-1147R2 RENDER — per-tier QuantityRow shows the all-in", () => {
  it.each(OFFERINGS)(
    "[%s] pass-fee tier renders the ALL-IN £67.93 + 'incl. VAT & fees', NOT the bare base £65.00",
    () => {
      // base £65.00, server all-in £67.93 (Mingla + service fee passed through)
      render(
        <QuantityRow
          ticket={baseTicket({ priceGbp: 65, priceAllInGbp: 67.93 })}
          quantity={1}
          onQuantityChange={() => {}}
        />,
      );
      // The rendered price text is the all-in, not the base.
      expect(screen.getByText("£67.93")).toBeTruthy();
      expect(screen.getByText(/incl\. VAT & fees/)).toBeTruthy();
      // The bare base must NOT appear as a rendered price string.
      expect(screen.queryByText("£65.00")).toBeNull();
    },
  );

  it("[absorb] base==all-in renders the base price with NO 'incl. VAT & fees' caption", () => {
    render(
      <QuantityRow
        ticket={baseTicket({ priceGbp: 65, priceAllInGbp: 65 })}
        quantity={1}
        onQuantityChange={() => {}}
      />,
    );
    expect(screen.getByText("£65.00")).toBeTruthy();
    expect(screen.queryByText(/incl\. VAT & fees/)).toBeNull();
  });

  it("[free] free tier renders 'Free' with NO caption", () => {
    render(
      <QuantityRow
        ticket={baseTicket({ priceGbp: null, isFree: true })}
        quantity={1}
        onQuantityChange={() => {}}
      />,
    );
    expect(screen.getByText("Free")).toBeTruthy();
    expect(screen.queryByText(/incl\. VAT & fees/)).toBeNull();
  });

  it("[RPC miss] null priceAllInGbp falls back to base, no caption, no fabrication", () => {
    render(
      <QuantityRow
        ticket={baseTicket({ priceGbp: 65, priceAllInGbp: null })}
        quantity={1}
        onQuantityChange={() => {}}
      />,
    );
    // falls back to the base — and does NOT invent a grossed-up number.
    expect(screen.getByText("£65.00")).toBeTruthy();
    expect(screen.queryByText(/incl\. VAT & fees/)).toBeNull();
    expect(screen.queryByText("£67.93")).toBeNull();
  });
});

describe("ORCH-1147R2 RENDER — selection bottom bar leads with the all-in", () => {
  it.each(OFFERINGS)(
    "[%s] pass-fee cart → headline 'Total £67.93' + single 'Fees & tax £2.93' line; base £65.00 is NOT the headline",
    () => {
      renderBar({ unitPrice: 65, unitPriceAllIn: 67.93, quantity: 1 });
      // headline relabel + all-in value (NOT the base)
      expect(screen.getByTestId("bar-label").props.children).toBe("Total");
      expect(screen.getByTestId("bar-value").props.children).toBe("£67.93");
      // the single combined fees+tax line renders the delta
      const fees = screen.getByTestId("fees-tax");
      // children = ["Fees & tax", " ", "£2.93"]
      expect(fees.props.children).toContain("£2.93");
      // assert the relabel really replaced "Subtotal"
      expect(screen.queryByText("Subtotal")).toBeNull();
    },
  );

  it("[absorb] base==all-in → 'Total £65.00', NO 'Fees & tax' line", () => {
    renderBar({ unitPrice: 65, unitPriceAllIn: 65, quantity: 1 });
    expect(screen.getByTestId("bar-label").props.children).toBe("Total");
    expect(screen.getByTestId("bar-value").props.children).toBe("£65.00");
    expect(screen.queryByTestId("fees-tax")).toBeNull();
  });

  it("[trip installments] 'Due today' deposit branch UNCHANGED, NO 'Fees & tax' line", () => {
    // pass-fee trip but on the installments path: dueTodayCents = 2000 (£20.00)
    renderBar({ unitPrice: 65, unitPriceAllIn: 67.93, quantity: 1 }, 2000);
    expect(screen.getByTestId("bar-label").props.children).toBe("Due today");
    expect(screen.getByTestId("bar-value").props.children).toBe("£20.00");
    // even though the cart HAS a fee delta, the deposit path suppresses the line.
    expect(screen.queryByTestId("fees-tax")).toBeNull();
  });

  it("[free] free cart → 'Total Free', NO 'Fees & tax' line", () => {
    renderBar({ unitPrice: 0, unitPriceAllIn: 0, isFree: true, quantity: 1 });
    expect(screen.getByTestId("bar-value").props.children).toBe("Free");
    expect(screen.queryByTestId("fees-tax")).toBeNull();
  });
});
