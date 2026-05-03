/**
 * CartContext — Cycle 8 checkout cart state.
 *
 * Single source of truth for the 5 checkout screens (J-C1 Tickets,
 * J-C2 Buyer, J-C3 Payment, J-C4 3DS sheet, J-C5 Confirmation).
 *
 * In-memory React Context + useReducer. Per Q-C3 in the spec:
 *   - NO Zustand (cart is not persisted client state at the app level)
 *   - NO AsyncStorage (cart lifetime = single tab session)
 *   - Closing the tab abandons the cart, which is correct semantic
 *
 * Cart shape is forward-compatible with PR #59 backend schema (§B.4
 * Tickets & Orders). See SPEC §10 PR #59 forward-compat appendix for
 * the field-level mapping. The pence conversion happens at the live-
 * wire boundary in B3, NOT at the cart layer.
 *
 * [TRANSITIONAL] In Cycle 8a only `lines` + `buyer` are populated.
 * Cycle 8b populates `result` after stub Stripe completes (J-C3 → J-C5).
 *
 * Per Cycle 8 spec §4.3.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
} from "react";
import type { ReactNode } from "react";

// ---- Types ----------------------------------------------------------

export interface CartLine {
  ticketTypeId: string;
  /** Snapshot of name at selection time — display-stable if event is renamed mid-checkout. */
  ticketName: string;
  quantity: number;
  /** GBP whole-units. 0 for free tickets. */
  unitPriceGbp: number;
  isFree: boolean;
}

export interface BuyerDetails {
  name: string;
  email: string;
  /** Optional. Stored as buyer-typed string; B3 normalises to E.164. */
  phone: string;
  marketingOptIn: boolean;
}

export type CheckoutPaymentMethod =
  // Online (Cycle 8 — buyer route)
  | "card"
  | "apple_pay"
  | "google_pay"
  | "free"
  // Door (Cycle 12 — operator route, ds_xxx sales).
  // I-29: door payment methods MUST NOT appear in /checkout buyer flow.
  | "cash"
  | "card_reader"  // [TRANSITIONAL] B-cycle Stripe Terminal SDK — disabled in J-D3 picker
  | "nfc"          // [TRANSITIONAL] B-cycle platform NFC — disabled in J-D3 picker
  | "manual";

export interface OrderResult {
  orderId: string;
  ticketIds: string[];
  paidAt: string;
  paymentMethod: CheckoutPaymentMethod;
  totalGbp: number;
}

export interface CartState {
  lines: CartLine[];
  buyer: BuyerDetails;
  /** Populated by Cycle 8b after stub Stripe / free-skip path. */
  result: OrderResult | null;
}

// ---- Reducer --------------------------------------------------------

type CartAction =
  | {
      type: "SET_LINE_QUANTITY";
      ticketTypeId: string;
      ticketName: string;
      unitPriceGbp: number;
      isFree: boolean;
      quantity: number;
    }
  | { type: "SET_BUYER"; patch: Partial<BuyerDetails> }
  | { type: "RECORD_RESULT"; result: OrderResult }
  | { type: "RESET" };

const EMPTY_BUYER: BuyerDetails = {
  name: "",
  email: "",
  phone: "",
  marketingOptIn: false,
};

const INITIAL_STATE: CartState = {
  lines: [],
  buyer: EMPTY_BUYER,
  result: null,
};

const reducer = (state: CartState, action: CartAction): CartState => {
  switch (action.type) {
    case "SET_LINE_QUANTITY": {
      const { ticketTypeId, ticketName, unitPriceGbp, isFree, quantity } =
        action;
      const existing = state.lines.find((l) => l.ticketTypeId === ticketTypeId);
      if (quantity <= 0) {
        // Remove line if quantity drops to zero.
        if (existing === undefined) return state;
        return {
          ...state,
          lines: state.lines.filter((l) => l.ticketTypeId !== ticketTypeId),
        };
      }
      if (existing === undefined) {
        return {
          ...state,
          lines: [
            ...state.lines,
            { ticketTypeId, ticketName, quantity, unitPriceGbp, isFree },
          ],
        };
      }
      return {
        ...state,
        lines: state.lines.map((l) =>
          l.ticketTypeId === ticketTypeId ? { ...l, quantity } : l,
        ),
      };
    }
    case "SET_BUYER":
      return { ...state, buyer: { ...state.buyer, ...action.patch } };
    case "RECORD_RESULT":
      return { ...state, result: action.result };
    case "RESET":
      return INITIAL_STATE;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
};

// ---- Context --------------------------------------------------------

export interface CartContextValue extends CartState {
  setLineQuantity: (params: {
    ticketTypeId: string;
    ticketName: string;
    unitPriceGbp: number;
    isFree: boolean;
    quantity: number;
  }) => void;
  setBuyer: (patch: Partial<BuyerDetails>) => void;
  recordResult: (result: OrderResult) => void;
  reset: () => void;
}

const CartCtx = createContext<CartContextValue | null>(null);

interface CartProviderProps {
  children: ReactNode;
}

export const CartProvider: React.FC<CartProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  const setLineQuantity = useCallback(
    (params: {
      ticketTypeId: string;
      ticketName: string;
      unitPriceGbp: number;
      isFree: boolean;
      quantity: number;
    }): void => {
      dispatch({ type: "SET_LINE_QUANTITY", ...params });
    },
    [],
  );

  const setBuyer = useCallback((patch: Partial<BuyerDetails>): void => {
    dispatch({ type: "SET_BUYER", patch });
  }, []);

  const recordResult = useCallback((result: OrderResult): void => {
    dispatch({ type: "RECORD_RESULT", result });
  }, []);

  const reset = useCallback((): void => {
    dispatch({ type: "RESET" });
  }, []);

  const value = useMemo<CartContextValue>(
    () => ({
      ...state,
      setLineQuantity,
      setBuyer,
      recordResult,
      reset,
    }),
    [state, setLineQuantity, setBuyer, recordResult, reset],
  );

  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
};

// ---- Hooks ----------------------------------------------------------

export const useCart = (): CartContextValue => {
  const ctx = useContext(CartCtx);
  if (ctx === null) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return ctx;
};

export interface CartTotals {
  subtotalGbp: number;
  totalGbp: number;
  totalQuantity: number;
  isFree: boolean;
  isEmpty: boolean;
}

export const useCartTotals = (): CartTotals => {
  const { lines } = useCart();
  return useMemo<CartTotals>((): CartTotals => {
    let subtotalGbp = 0;
    let totalQuantity = 0;
    for (const line of lines) {
      subtotalGbp += line.unitPriceGbp * line.quantity;
      totalQuantity += line.quantity;
    }
    const isEmpty = totalQuantity === 0;
    const isFree = !isEmpty && subtotalGbp === 0;
    return {
      subtotalGbp,
      totalGbp: subtotalGbp,
      totalQuantity,
      isFree,
      isEmpty,
    };
  }, [lines]);
};
