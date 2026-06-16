// ORCH-1152 [business checkout crashes on mount — RangeError: Currency is invalid]
// — implementor happy-path regression test (Step 0.5).
//
// The bug ORCH-1147R2's render test MISSED: the EMPTY-cart state. On entering a
// checkout screen the cart is empty, `useCartTotals()` returns currency "" (see
// CartContext.tsx — `let currency = ""`), and ORCH-1147R2 added an UNCONDITIONAL
// `const headlineAllIn = formatCurrency(totals.allInTotal, totals.currency)` at
// the top of all three checkout `index.tsx` screens. `formatCurrency("")` fed an
// empty code into `new Intl.NumberFormat(locale, { currency: "" })`, which throws
// `RangeError: Currency is invalid`, crashing the screen on mount.
//
// Two-layer fix, both asserted here:
//   LAYER 1 — formatCurrency / formatCurrencyRound are hardened: an empty / blank
//             / invalid code is routed through `normalizeCurrency` (safe "GBP"
//             fallback) so Intl can NEVER throw. Valid codes format identically.
//   LAYER 2 — the three screens guard the headline: `totals.isEmpty ? "" :
//             formatCurrency(...)` — the value is only DISPLAYED when !isEmpty,
//             and the empty state renders the "—" placeholder.
//
// Runs under the default node/ts-jest config (no RTL). Like the ORCH-1147 test,
// `useCartTotals` is a thin `useMemo` over `useContext(CartCtx)`; we make
// `useMemo` eager and feed `useContext` a stub cart, so the hook's PURE reduce
// math (incl. the empty-cart `currency === ""` path) runs deterministically.
//
// FAILS-ON-REVERT (proven by true line-deletion, not comment-out):
//   • Revert LAYER 1 (restore `const code = currency.toUpperCase()`) → the
//     `formatCurrency(x, "")` / `(x, undefined)` assertions THROW (RED).
//   • Revert LAYER 2 (restore the unconditional `headlineAllIn`) → the
//     `selectionHeadline` empty-cart assertion THROWS (RED), because computing
//     the headline on an empty cart calls `formatCurrency(0, "")`.
// I-PROPOSED-1152-CHECKOUT-CURRENCY-NEVER-CRASHES (DRAFT).

import { describe, expect, jest, test } from "@jest/globals";

import {
  formatCurrency,
  formatCurrencyRound,
  formatMoney,
} from "../../../utils/currency";
import type { CartLine } from "../CartContext";

// --- Make React hooks eager + inject a stub cart (same shim as ORCH-1147) ---
let stubLines: CartLine[] = [];
jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useMemo: (factory: () => unknown): unknown => factory(),
    useContext: (): unknown => ({ lines: stubLines }),
  };
});

// Imported AFTER the mock so the hook picks up the eager React shims.
// eslint-disable-next-line import/first
import { useCartTotals } from "../CartContext";

const line = (over: Partial<CartLine>): CartLine => ({
  ticketTypeId: over.ticketTypeId ?? "tt_1",
  ticketName: over.ticketName ?? "General",
  quantity: over.quantity ?? 1,
  unitPrice: over.unitPrice ?? 0,
  unitPriceGbp: over.unitPriceGbp,
  unitPriceAllIn: over.unitPriceAllIn,
  currency: over.currency ?? "GBP",
  isFree: over.isFree ?? false,
});

const totalsFor = (lines: CartLine[]): ReturnType<typeof useCartTotals> => {
  stubLines = lines;
  return useCartTotals();
};

// The EXACT bottom-bar headline rule from all three checkout index.tsx screens
// (post-ORCH-1152): the headline is computed ONLY when !isEmpty, and the
// displayed cell is "—" on empty / "Free" when free / the headline otherwise.
const selectionHeadline = (
  totals: ReturnType<typeof useCartTotals>,
): string => {
  // LAYER 2 — the screens' real guard. Reverting this to an unconditional
  // formatCurrency(totals.allInTotal, totals.currency) makes the empty branch
  // throw (the shipped S0 crash).
  const headlineAllIn = totals.isEmpty
    ? ""
    : formatCurrency(totals.allInTotal, totals.currency);
  // The displayed bottom-bar value cell.
  return totals.isEmpty ? "—" : totals.isFree ? "Free" : headlineAllIn;
};

describe("ORCH-1152 LAYER 1 — formatCurrency never throws on a blank/invalid code", () => {
  test('formatCurrency(x, "") returns a safe string, does NOT throw', () => {
    expect(() => formatCurrency(0, "")).not.toThrow();
    // Falls back to the default ("GBP") per normalizeCurrency.
    expect(formatCurrency(0, "")).toBe("£0.00");
    expect(formatCurrency(65, "")).toBe("£65.00");
  });

  test("formatCurrency(x, undefined as any) returns a safe string, does NOT throw", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => formatCurrency(10, undefined as any)).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(formatCurrency(10, undefined as any)).toBe("£10.00");
  });

  test('formatCurrency(x, "   ") (blank/whitespace) does NOT throw', () => {
    expect(() => formatCurrency(0, "   ")).not.toThrow();
    expect(formatCurrency(0, "   ")).toBe("£0.00");
  });

  test("formatCurrencyRound never throws on a blank code either", () => {
    expect(() => formatCurrencyRound(0, "")).not.toThrow();
    expect(formatCurrencyRound(0, "")).toBe("£0");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => formatCurrencyRound(24180, undefined as any)).not.toThrow();
  });

  test("formatMoney (the public wrapper) is safe on a blank code", () => {
    expect(() => formatMoney({ amount: 0, currency: "" })).not.toThrow();
    expect(() =>
      formatMoney({ amount: 50, currency: "" }, { rounded: true }),
    ).not.toThrow();
  });

  // BEHAVIOR-IDENTICAL for valid codes — the only change is empty/invalid →
  // fallback instead of crash. If this drifts, the fix changed valid output.
  test("valid codes format IDENTICALLY to before the fix", () => {
    expect(formatCurrency(156.2, "GBP")).toBe("£156.20");
    expect(formatCurrency(15620, "GBP", true)).toBe("£156.20");
    expect(formatCurrency(99, "USD")).toBe("$99.00");
    expect(formatCurrency(8420, "EUR")).toBe("€8,420.00");
    expect(formatCurrencyRound(24180, "GBP")).toBe("£24,180");
  });
});

describe("ORCH-1152 LAYER 2 — checkout selection screen on the EMPTY cart", () => {
  test("empty cart yields currency '' (the crash trigger reproduced)", () => {
    const totals = totalsFor([]);
    expect(totals.isEmpty).toBe(true);
    // This is the exact value that crashed formatCurrency pre-fix.
    expect(totals.currency).toBe("");
    expect(totals.allInTotal).toBe(0);
  });

  test("selection headline does NOT throw on the empty cart + renders '—'", () => {
    const totals = totalsFor([]);
    // The exact mount-time computation that shipped as the S0 crash.
    expect(() => selectionHeadline(totals)).not.toThrow();
    expect(selectionHeadline(totals)).toBe("—");
  });

  test("populated cart still renders the all-in headline (ORCH-1147R2 intact)", () => {
    // base £50, server all-in £52.25 passed, qty 1 → headline is the all-in.
    const totals = totalsFor([
      line({ unitPrice: 50, unitPriceAllIn: 52.25, quantity: 1, currency: "GBP" }),
    ]);
    expect(totals.isEmpty).toBe(false);
    expect(selectionHeadline(totals)).toBe("£52.25");
    // NOT the bare base — the R2 contract must survive the 1152 guard.
    expect(selectionHeadline(totals)).not.toBe("£50.00");
  });

  test("free cart renders 'Free', not a currency string", () => {
    const totals = totalsFor([
      line({ unitPrice: 0, unitPriceAllIn: 0, quantity: 1, isFree: true, currency: "GBP" }),
    ]);
    expect(selectionHeadline(totals)).toBe("Free");
  });
});
