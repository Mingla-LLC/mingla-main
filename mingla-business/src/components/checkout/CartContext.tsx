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
  /** Major units in `currency`. */
  unitPrice: number;
  /** Legacy compatibility only. New code writes `unitPrice`. */
  unitPriceGbp?: number;
  /** ISO 4217 event currency. */
  currency: string;
  isFree: boolean;
}

export interface BuyerDetails {
  name: string;
  email: string;
  /** Required for production checkout. Edge functions normalise to E.164. */
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
  checkoutSessionId?: string;
  paidAt: string;
  paymentMethod: CheckoutPaymentMethod;
  /** Legacy compatibility only. New code writes `total`. */
  totalGbp?: number;
  total: number;
  totalCents?: number;
  currency: string;
  /** ORCH-0804 — Stripe Tax amount in major units (e.g. £20.00 → 20). 0 when
   * no tax collected (brand not registered in buyer jurisdiction, free
   * ticket, or door sale). UI renders a tax line only when > 0. */
  tax?: number;
  /** ORCH-0804 — raw tax in cents from orders.tax_amount_cents. Source of
   * truth for any math; `tax` above is the display-friendly major-units
   * version. 0 on no-tax orders. */
  taxAmountCents?: number;
  paymentStatus?: "paid";
  notificationStatus?: "queued" | "sent" | "partial" | "failed" | string;
  tickets: Array<{
    ticketId: string;
    ticketTypeId?: string;
    ticketName: string;
    qrPayload: string;
    status: string;
  }>;
}

export interface CartState {
  lines: CartLine[];
  buyer: BuyerDetails;
  /** Populated by Cycle 8b after stub Stripe / free-skip path. */
  result: OrderResult | null;
  /**
   * ORCH-0880 [Tr5 Traveler Intake Forms] — per-tier intake answers keyed by
   * `ticket_type_id`. Populated by the intake route between buyer and
   * payment when the trip has intake schemas. Each entry persists
   * `{ ticket_type_id, schema_version_id, answers }` per
   * `intakeSchemaService.IntakeFormData`. Stored as a plain Record so the
   * value is JSON-serialisable (multi-tier carts can hold one entry per
   * tier). Cleared by RESET; otherwise lives for the cart lifetime.
   */
  intakeFormData: Record<string, unknown>;
}

// ---- Reducer --------------------------------------------------------

type CartAction =
  | {
      type: "SET_LINE_QUANTITY";
      ticketTypeId: string;
      ticketName: string;
      unitPrice: number;
      unitPriceGbp?: number;
      currency: string;
      isFree: boolean;
      quantity: number;
    }
  | { type: "SET_BUYER"; patch: Partial<BuyerDetails> }
  | { type: "RECORD_RESULT"; result: OrderResult }
  | { type: "SET_INTAKE_TIER"; ticketTypeId: string; data: unknown }
  | { type: "CLEAR_INTAKE_TIER"; ticketTypeId: string }
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
  intakeFormData: {},
};

const reducer = (state: CartState, action: CartAction): CartState => {
  switch (action.type) {
    case "SET_LINE_QUANTITY": {
      const { ticketTypeId, ticketName, unitPrice, unitPriceGbp, currency, isFree, quantity } =
        action;
      const normalizedCurrency = currency.toUpperCase();
      const existingCurrency = state.lines[0]?.currency;
      if (
        existingCurrency !== undefined &&
        existingCurrency !== normalizedCurrency &&
        quantity > 0
      ) {
        throw new Error("Cart cannot mix currencies.");
      }
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
            {
              ticketTypeId,
              ticketName,
              quantity,
              unitPrice,
              unitPriceGbp: unitPriceGbp ?? unitPrice,
              currency: normalizedCurrency,
              isFree,
            },
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
    case "SET_INTAKE_TIER":
      return {
        ...state,
        intakeFormData: {
          ...state.intakeFormData,
          [action.ticketTypeId]: action.data,
        },
      };
    case "CLEAR_INTAKE_TIER": {
      const next = { ...state.intakeFormData };
      delete next[action.ticketTypeId];
      return { ...state, intakeFormData: next };
    }
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
    unitPrice: number;
    unitPriceGbp?: number;
    currency: string;
    isFree: boolean;
    quantity: number;
  }) => void;
  setBuyer: (patch: Partial<BuyerDetails>) => void;
  recordResult: (result: OrderResult) => void;
  /**
   * ORCH-0880 [Tr5 Traveler Intake Forms] — save/replace one tier's intake
   * form payload. `data` should be an `IntakeFormData` per
   * intakeSchemaService (typed as `unknown` here to avoid a circular
   * import; consumers should pass the typed value).
   */
  setIntakeTierData: (ticketTypeId: string, data: unknown) => void;
  clearIntakeTierData: (ticketTypeId: string) => void;
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
      unitPrice: number;
      unitPriceGbp?: number;
      currency: string;
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

  // ORCH-0880 [Tr5 Traveler Intake Forms] — per-tier intake answer setters.
  const setIntakeTierData = useCallback(
    (ticketTypeId: string, data: unknown): void => {
      dispatch({ type: "SET_INTAKE_TIER", ticketTypeId, data });
    },
    [],
  );
  const clearIntakeTierData = useCallback((ticketTypeId: string): void => {
    dispatch({ type: "CLEAR_INTAKE_TIER", ticketTypeId });
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
      setIntakeTierData,
      clearIntakeTierData,
      reset,
    }),
    [
      state,
      setLineQuantity,
      setBuyer,
      recordResult,
      setIntakeTierData,
      clearIntakeTierData,
      reset,
    ],
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
  /** Legacy compatibility only. Same value as subtotal. */
  subtotalGbp: number;
  /** Legacy compatibility only. Same value as total. */
  totalGbp: number;
  subtotal: number;
  total: number;
  currency: string;
  totalQuantity: number;
  isFree: boolean;
  isEmpty: boolean;
}

export const useCartTotals = (): CartTotals => {
  const { lines } = useCart();
  return useMemo<CartTotals>((): CartTotals => {
    let subtotal = 0;
    let totalQuantity = 0;
    let currency = "";
    for (const line of lines) {
      subtotal += line.unitPrice * line.quantity;
      totalQuantity += line.quantity;
      currency = line.currency;
    }
    const isEmpty = totalQuantity === 0;
    const isFree = !isEmpty && subtotal === 0;
    return {
      subtotalGbp: subtotal,
      totalGbp: subtotal,
      subtotal,
      total: subtotal,
      currency,
      totalQuantity,
      isFree,
      isEmpty,
    };
  }, [lines]);
};
