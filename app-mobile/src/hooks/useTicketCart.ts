/**
 * useTicketCart — local cart state for the consumer TicketCartSheet.
 *
 * Per ORCH-0847 Phase C SPEC §4.1.4 — uses `useReducer`, NOT Zustand
 * (per memory `feedback_zustand_persist_no_server_snapshots`: Zustand persist
 * must NEVER hold server-derived data). Cart lives only while the sheet is
 * open; `reset()` empties it on close.
 *
 * Totals derived from current line state. Currency is taken from the first
 * non-empty line (all tiers on one event share currency per DB constraint).
 *
 * Behavioral contract:
 *   - `setLineQuantity(id, n)` adds/updates/removes a line. n === 0 removes.
 *   - First add jumps to `minPurchaseQty`-aware quantity ONLY at the caller
 *     site (QuantityRow handles that clamp internally before calling back).
 *   - Multi-tier carts pack all lines with quantity > 0 into the outbound
 *     `lines[]` payload at checkout time.
 */

import { useReducer, useMemo, useCallback } from "react";

export interface CartLineSeed {
  ticketTypeId: string;
  ticketName: string;
  unitPriceCents: number;
  currency: string;
  isFree: boolean;
}

export interface CartLine extends CartLineSeed {
  quantity: number;
}

export interface CartTotals {
  totalCents: number;
  currency: string;
  itemCount: number;
  isEmpty: boolean;
  /** True when itemCount > 0 AND totalCents === 0 (free tickets only). */
  isFree: boolean;
}

export interface UseTicketCartResult {
  lines: CartLine[];
  totals: CartTotals;
  setLineQuantity: (seed: CartLineSeed, nextQuantity: number) => void;
  reset: () => void;
}

type CartAction =
  | { type: "SET_QTY"; seed: CartLineSeed; nextQuantity: number }
  | { type: "RESET" };

const cartReducer = (state: CartLine[], action: CartAction): CartLine[] => {
  switch (action.type) {
    case "RESET":
      return [];
    case "SET_QTY": {
      const { seed, nextQuantity } = action;
      const existing = state.find((l) => l.ticketTypeId === seed.ticketTypeId);
      if (nextQuantity <= 0) {
        // Remove the line entirely.
        return state.filter((l) => l.ticketTypeId !== seed.ticketTypeId);
      }
      if (existing === undefined) {
        return [...state, { ...seed, quantity: nextQuantity }];
      }
      return state.map((l) =>
        l.ticketTypeId === seed.ticketTypeId
          ? { ...l, ...seed, quantity: nextQuantity }
          : l,
      );
    }
    default: {
      const _exhaustive: never = action;
      return state;
    }
  }
};

const DEFAULT_CURRENCY = "GBP";

export const useTicketCart = (
  fallbackCurrency: string = DEFAULT_CURRENCY,
): UseTicketCartResult => {
  const [lines, dispatch] = useReducer(cartReducer, []);

  const totals = useMemo<CartTotals>(() => {
    const totalCents = lines.reduce(
      (sum, line) => sum + line.unitPriceCents * line.quantity,
      0,
    );
    const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
    const currency = lines[0]?.currency ?? fallbackCurrency;
    return {
      totalCents,
      currency,
      itemCount,
      isEmpty: itemCount === 0,
      isFree: itemCount > 0 && totalCents === 0,
    };
  }, [lines, fallbackCurrency]);

  const setLineQuantity = useCallback(
    (seed: CartLineSeed, nextQuantity: number): void => {
      dispatch({ type: "SET_QTY", seed, nextQuantity });
    },
    [],
  );

  const reset = useCallback((): void => {
    dispatch({ type: "RESET" });
  }, []);

  return { lines, totals, setLineQuantity, reset };
};
