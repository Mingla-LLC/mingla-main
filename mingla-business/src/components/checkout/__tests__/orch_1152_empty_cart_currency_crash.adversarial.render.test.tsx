// ORCH-1152 [business checkout crashes on mount — RangeError: Currency is invalid]
// — TESTER adversarial RENDER-PROOF (different angle than the implementor).
//
// THE SHIPPED CRASH was on the EMPTY/initial cart: entering any of the three
// business checkout selection screens mounts with an EMPTY cart, so the REAL
// `useCartTotals()` returns `currency === ""`, and ORCH-1147R2's unconditional
// top-level `const headlineAllIn = formatCurrency(totals.allInTotal,
// totals.currency)` fed "" into `new Intl.NumberFormat({ currency: "" })` →
// `RangeError: Currency is invalid` → the screen crashed on mount before any
// JSX painted.
//
// The implementor's test (orch_1152_empty_cart_currency_crash.test.ts) is a
// MATH-replication + a hand-rolled `selectionHeadline()` STRING helper — it
// NEVER mounts a React tree, so it cannot prove the actual mount survives. The
// R2 render test mounts the bottom bar but ONLY ever against a POPULATED cart
// (its CartSeeder gates on `lines.length > 0`), so it deliberately never enters
// the empty-cart crash state.
//
// THIS test attacks the EXACT shipped angle the others avoid: it MOUNTS the
// REAL `CartProvider` in the EMPTY state (no seed) and renders a `BottomBar`
// that reproduces the REAL post-ORCH-1152 screen logic VERBATIM (the
// `totals.isEmpty ? "GBP" : totals.currency` Layer-2 guard + Layer-1 hardened
// `formatCurrency`), then asserts the tree RENDERS (does NOT throw) and shows
// the "—" placeholder. react-test-renderer THROWS synchronously from render()
// if any child throws during commit, so a passing mount IS the no-crash proof.
//
// Adversarial angles distinct from the implementor:
//   (1) REAL React MOUNT of the empty cart for all three offering types (event /
//       trip / experience) — the mandatory component-render no-crash proof.
//   (2) A loading→empty→populated→qty0→empty TRANSITION on a live mounted tree:
//       seed a line, then drop quantity to 0 (which the reducer removes, returning
//       the cart to currency===""), and assert the tree does NOT re-crash on the
//       way back to empty (the "remove the last ticket" regression path).
//   (3) A NON-GBP populated cart whose currency the user then removes (back to
//       empty) — proves the empty fallback is currency-independent, not a GBP
//       artifact.
//
// FAILS-ON-REVERT: reverting Layer 1 (`normalizeCurrency` → `currency.toUpperCase()`)
// makes the empty-cart mounts THROW `RangeError: Currency is invalid` from
// render(), reproducing the shipped S0 crash. (This render BottomBar reproduces
// the real screen's Layer-2 guard, so to fully reproduce the shipped crash from
// THIS test you revert Layer 1; the qty0-transition + non-GBP cases also go RED.)
// I-PROPOSED-1152-CHECKOUT-CURRENCY-NEVER-CRASHES (DRAFT).

import React from "react";
import { Text, View } from "react-native";
import { render, screen, act } from "@testing-library/react-native";

import {
  CartProvider,
  useCart,
  useCartTotals,
} from "../CartContext";
import { formatCurrency } from "../../../utils/currency";

// --- the bottom-bar JSX from the three checkout index.tsx screens, using the
// ORIGINAL pre-ORCH-1152 UNCONDITIONAL headline shape
// (`formatCurrency(totals.allInTotal, totals.currency)` — NO `isEmpty ?` guard).
// This is deliberate: it reproduces the EXACT screen code that SHIPPED the S0
// crash, so that reverting Layer 1 (the root-class `normalizeCurrency` hardening
// in currency.ts) makes this REAL React mount throw `RangeError: Currency is
// invalid` from render() on the empty cart — the precise shipped failure. With
// the fix in place, Layer 1 alone makes this unguarded shape safe (defense in
// depth: the screens ALSO carry the Layer-2 `isEmpty ? "GBP"` guard, but Layer 1
// is what protects this original shape). Drives the REAL useCartTotals so the
// empty-cart `currency === ""` path is exercised end-to-end, not faked.
const BottomBar: React.FC = () => {
  const totals = useCartTotals();
  const headlineAllIn = formatCurrency(totals.allInTotal, totals.currency);
  const showFeesTaxLine =
    !totals.isEmpty && !totals.isFree && totals.hasFeesTaxDelta;
  return (
    <View>
      {showFeesTaxLine ? (
        <Text testID="fees-tax">
          Fees &amp; tax{" "}
          {formatCurrency(totals.feesTaxCents, totals.currency, true)}
        </Text>
      ) : null}
      <Text testID="bar-label">Total</Text>
      <Text testID="bar-value">
        {totals.isEmpty ? "—" : totals.isFree ? "Free" : headlineAllIn}
      </Text>
    </View>
  );
};

// A test handle that exposes the REAL cart mutators so a test can drive a
// live mounted tree through state transitions (seed a line, drop to 0).
let cartApi: ReturnType<typeof useCart> | null = null;
const CartHandle: React.FC = () => {
  cartApi = useCart();
  return null;
};

const OFFERINGS = ["event", "trip", "experience"] as const;

const renderEmpty = (): void => {
  cartApi = null;
  render(
    <CartProvider>
      <CartHandle />
      <BottomBar />
    </CartProvider>,
  );
};

describe("ORCH-1152 RENDER (adversarial) — empty checkout cart mounts without crashing", () => {
  it.each(OFFERINGS)(
    "[%s] mounting the bottom bar on the EMPTY cart (currency '') does NOT throw and renders '—'",
    () => {
      // react-test-renderer's render() throws synchronously if the tree throws
      // during commit, so reaching the assertions IS the no-crash proof. This is
      // the exact state that shipped the RangeError.
      expect(() => renderEmpty()).not.toThrow();
      expect(screen.getByTestId("bar-value").props.children).toBe("—");
      // the empty cart shows neither a currency string nor a fees line.
      expect(screen.queryByTestId("fees-tax")).toBeNull();
      expect(screen.getByTestId("bar-label").props.children).toBe("Total");
    },
  );

  it("loading→empty→populated→qty0→back-to-empty never re-crashes (remove-last-ticket path)", () => {
    renderEmpty();
    // initial empty state
    expect(screen.getByTestId("bar-value").props.children).toBe("—");

    // populate: GBP pass-fee line → headline becomes the all-in
    act(() => {
      cartApi?.setLineQuantity({
        ticketTypeId: "tt_1",
        ticketName: "General",
        unitPrice: 65,
        unitPriceAllIn: 67.93,
        currency: "GBP",
        isFree: false,
        quantity: 1,
      });
    });
    expect(screen.getByTestId("bar-value").props.children).toBe("£67.93");

    // remove the last ticket (qty → 0): the reducer drops the line, returning
    // the cart to the empty / currency==="" state. This must NOT re-crash.
    expect(() => {
      act(() => {
        cartApi?.setLineQuantity({
          ticketTypeId: "tt_1",
          ticketName: "General",
          unitPrice: 65,
          unitPriceAllIn: 67.93,
          currency: "GBP",
          isFree: false,
          quantity: 0,
        });
      });
    }).not.toThrow();
    // back to the placeholder, not a stale price, not a crash.
    expect(screen.getByTestId("bar-value").props.children).toBe("—");
    expect(screen.queryByTestId("fees-tax")).toBeNull();
  });

  it("a NON-GBP (USD) cart emptied back out still renders '—' (fallback is currency-independent)", () => {
    renderEmpty();
    act(() => {
      cartApi?.setLineQuantity({
        ticketTypeId: "tt_usd",
        ticketName: "GA",
        unitPrice: 50,
        unitPriceAllIn: 52.25,
        currency: "USD",
        isFree: false,
        quantity: 1,
      });
    });
    // populated USD cart renders the USD all-in (proves it's a real non-GBP path)
    expect(screen.getByTestId("bar-value").props.children).toBe("$52.25");
    // empty it: currency drops back to "" → must render "—", never crash, never
    // leak a GBP/USD string.
    expect(() => {
      act(() => {
        cartApi?.setLineQuantity({
          ticketTypeId: "tt_usd",
          ticketName: "GA",
          unitPrice: 50,
          unitPriceAllIn: 52.25,
          currency: "USD",
          isFree: false,
          quantity: 0,
        });
      });
    }).not.toThrow();
    expect(screen.getByTestId("bar-value").props.children).toBe("—");
  });
});

// --- LAYER-1 direct hardening on junk/whitespace/lowercase codes through the
// REAL formatCurrency (a different blank-code surface than the implementor's
// "" / undefined / "   " set): lowercase + symbol + mixed-case codes must NOT
// throw, and a junk symbol must fall back rather than reaching Intl with "$".
describe("ORCH-1152 RENDER (adversarial) — formatCurrency hardening on odd codes", () => {
  it("lowercase 'gbp' normalises to upper and formats as £ (no throw)", () => {
    expect(() => formatCurrency(10, "gbp")).not.toThrow();
    expect(formatCurrency(10, "gbp")).toBe("£10.00");
  });

  it("mixed-case 'UsD' formats as $ (no throw)", () => {
    expect(() => formatCurrency(99, "UsD")).not.toThrow();
    expect(formatCurrency(99, "UsD")).toBe("$99.00");
  });

  it("DOCUMENTS the ORCH-1152 fix boundary: a junk ISO code '$' STILL throws (Discovery, not the shipped S0)", () => {
    // The ORCH-1152 fix routes the code through `normalizeCurrency`, which only
    // guards EMPTY / BLANK / undefined (a length check) — it does NOT validate
    // the code against ISO 4217. So a junk non-empty symbol like "$" still
    // reaches Intl and throws `RangeError: Invalid currency code`. This is
    // CORRECTLY out of scope: the shipped S0 crash was the empty-string ("")
    // case (a real cart state), whereas a cart currency always comes from a
    // valid DB ISO code and is never "$". Asserting the CURRENT real behavior
    // (not a wished-for one) so this test stays honest. Routed as a Discovery
    // for the orchestrator — a fully crash-proof formatter would try/catch and
    // fall back, but that is a separate, lower-priority hardening.
    expect(() => formatCurrency(5, "$")).toThrow(/Invalid currency code/);
  });

  it("a tab/newline-only code does NOT throw (whitespace beyond a single space)", () => {
    expect(() => formatCurrency(0, "\t\n")).not.toThrow();
    expect(formatCurrency(0, "\t\n")).toBe("£0.00");
  });
});
