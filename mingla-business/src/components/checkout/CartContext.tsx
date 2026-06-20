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
  /**
   * ORCH-1147 — server fee-grossed ALL-IN per unit (major units in `currency`),
   * seeded from the tier's server-computed `priceAllInGbp`
   * (`pg_public_event_tier_allin`). This is the SINGLE display authority for the
   * headline Total — the client performs ZERO fee/tax math beyond Σ(allIn×qty).
   * Optional: a free tier, or a checkout path that has not plumbed the all-in
   * yet, falls back to `unitPrice` (base) and contributes 0 to fees/tax — never
   * undefined, never NaN. NEVER fabricate (Constitution #9): when the server has
   * no all-in for a tier the seed uses the base, it does not invent a markup.
   * I-PROPOSED-1147-CART-TOTAL-IS-SERVER-ALLIN (DRAFT).
   */
  unitPriceAllIn?: number;
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
  /**
   * META-ORCH-1161 Sub-A.2 (DEC-186) — the single bundled-mandatory consent
   * gate. TRUE means the buyer checked "I agree to all terms and conditions",
   * which (per DEC-186 bundling) also constitutes the marketing grant. The Pay
   * button is disabled until this is true AND fields are valid. When set true,
   * the buyer surface ALSO sets `marketingOptIn=true` (the bundled grant) so the
   * downstream payment payload carries it. Default false (affirmative act).
   */
  termsAccepted?: boolean;
  address?: {
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postal: string;
    country: string;
  };
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
  | "card_reader" // [TRANSITIONAL] B-cycle Stripe Terminal SDK — disabled in J-D3 picker
  | "nfc" // [TRANSITIONAL] B-cycle platform NFC — disabled in J-D3 picker
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
    /** ORCH-0932 — server-rendered PNG data URI; carousel renders this via
     * <Image> on web (client-side react-native-qrcode-svg failed on Expo
     * SDK 54 web export; see ORCH-0930). Optional for legacy/cached
     * responses; carousel skips QR render when absent. */
    qrImageDataUrl?: string;
    status: string;
  }>;
}

/**
 * ORCH-1130 [public trip page payment-structure + installments UX] — the
 * buyer's pay-full-vs-installments choice, picked on the public trip page and
 * carried through the (now 2-step) checkout funnel so the Review & pay step
 * pre-fills it and the edge call forwards it. Default `"full"` (deliberate,
 * non-surprising; pay-in-full is always allowed). Reset to `"full"` on cart
 * RESET. Only meaningful for plan trips; ignored for no-plan trips (the
 * payment.tsx forwarding gate stays `isPlanActive`).
 */
export type TripPaymentPlanChoice = "full" | "installments";

export interface CartState {
  lines: CartLine[];
  buyer: BuyerDetails;
  /** Populated by Cycle 8b after stub Stripe / free-skip path. */
  result: OrderResult | null;
  /** ORCH-1130 — pay-full vs pay-over-time, carried public page → Review. */
  paymentPlanChoice: TripPaymentPlanChoice;
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
  /**
   * ORCH-1138 Leg 3 — the chosen experience occurrence's event_dates.id, carried
   * public page → checkout when the buyer picked a slot from the adaptive Reserve
   * picker (recurring/multi-date/open-daily). null for single/no-date experiences
   * (and all events/trips) → the checkout request stays byte-identical to today.
   * Forwarded as the already-supported optional `eventDateId` on the
   * ticket-checkout-create request only when non-null.
   */
  eventDateId: string | null;
}

// ---- Reducer --------------------------------------------------------

type CartAction =
  | {
    type: "SET_LINE_QUANTITY";
    ticketTypeId: string;
    ticketName: string;
    unitPrice: number;
    unitPriceGbp?: number;
    // ORCH-1147 — server fee-grossed all-in per unit (see CartLine.unitPriceAllIn).
    unitPriceAllIn?: number;
    currency: string;
    isFree: boolean;
    quantity: number;
  }
  | { type: "SET_BUYER"; patch: Partial<BuyerDetails> }
  | { type: "RECORD_RESULT"; result: OrderResult }
  | { type: "SET_INTAKE_TIER"; ticketTypeId: string; data: unknown }
  | { type: "CLEAR_INTAKE_TIER"; ticketTypeId: string }
  | { type: "SET_PAYMENT_PLAN_CHOICE"; choice: TripPaymentPlanChoice }
  // ORCH-1138 Leg 3 — set/clear the chosen experience occurrence.
  | { type: "SET_EVENT_DATE_ID"; eventDateId: string | null }
  | { type: "RESET" };

const EMPTY_BUYER: BuyerDetails = {
  name: "",
  email: "",
  phone: "",
  marketingOptIn: false,
  termsAccepted: false,
  address: {
    line1: "",
    city: "",
    state: "",
    postal: "",
    country: "US",
  },
};

const INITIAL_STATE: CartState = {
  lines: [],
  buyer: EMPTY_BUYER,
  result: null,
  intakeFormData: {},
  // ORCH-1130 — default to pay-in-full (deliberate non-surprising default).
  paymentPlanChoice: "full",
  // ORCH-1138 Leg 3 — no occurrence chosen by default (single/no-date path).
  eventDateId: null,
};

const reducer = (state: CartState, action: CartAction): CartState => {
  switch (action.type) {
    case "SET_LINE_QUANTITY": {
      const {
        ticketTypeId,
        ticketName,
        unitPrice,
        unitPriceGbp,
        unitPriceAllIn,
        currency,
        isFree,
        quantity,
      } = action;
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
              // ORCH-1147 — store the server fee-grossed all-in; fall back to the
              // base when the path has not plumbed it (never undefined/NaN, never
              // fabricated — see CartLine.unitPriceAllIn).
              unitPriceAllIn: unitPriceAllIn ?? unitPrice,
              currency: normalizedCurrency,
              isFree,
            },
          ],
        };
      }
      // ORCH-1147 — on a quantity update, re-write unitPriceAllIn too so a
      // re-seed carrying a freshly-resolved all-in is not stranded on the
      // existing line (the seed always passes the latest server figure).
      return {
        ...state,
        lines: state.lines.map((l) =>
          l.ticketTypeId === ticketTypeId
            ? {
              ...l,
              quantity,
              unitPriceAllIn: unitPriceAllIn ?? l.unitPriceAllIn ?? l.unitPrice,
            }
            : l
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
    case "SET_PAYMENT_PLAN_CHOICE":
      return { ...state, paymentPlanChoice: action.choice };
    case "SET_EVENT_DATE_ID":
      return { ...state, eventDateId: action.eventDateId };
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
    // ORCH-1147 — server fee-grossed all-in per unit (see CartLine.unitPriceAllIn).
    unitPriceAllIn?: number;
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
  /**
   * ORCH-1130 — set the pay-full vs pay-over-time choice. Called by the
   * public-page seed-from-route-param effect (checkout index) and by the
   * Review & pay segmented toggle (payment.tsx) as the last-chance editor.
   */
  setPaymentPlanChoice: (choice: TripPaymentPlanChoice) => void;
  /**
   * ORCH-1138 Leg 3 — set/clear the chosen experience occurrence. Called by the
   * checkout-experience index's seed-from-route-param effect (the `eventDateId`
   * param the public /exp/ page threads when the buyer picked a slot). null on
   * the single/no-date path → request byte-identical.
   */
  setEventDateId: (eventDateId: string | null) => void;
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
      // ORCH-1147 — server fee-grossed all-in per unit (see CartLine.unitPriceAllIn).
      unitPriceAllIn?: number;
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

  // ORCH-1130 — pay-full vs pay-over-time setter.
  const setPaymentPlanChoice = useCallback(
    (choice: TripPaymentPlanChoice): void => {
      dispatch({ type: "SET_PAYMENT_PLAN_CHOICE", choice });
    },
    [],
  );

  // ORCH-1138 Leg 3 — chosen experience occurrence setter.
  const setEventDateId = useCallback((eventDateId: string | null): void => {
    dispatch({ type: "SET_EVENT_DATE_ID", eventDateId });
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
      setPaymentPlanChoice,
      setEventDateId,
      reset,
    }),
    [
      state,
      setLineQuantity,
      setBuyer,
      recordResult,
      setIntakeTierData,
      clearIntakeTierData,
      setPaymentPlanChoice,
      setEventDateId,
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
  /**
   * BASE ticket subtotal (Σ unitPrice×qty), major units. UNCHANGED MEANING
   * (ORCH-1147 DO-NOT-REPURPOSE): `subtotal`/`total` remain the per-line
   * "Tickets" recap basis; the headline Total is sourced from `allInTotal`.
   */
  subtotal: number;
  total: number;
  /**
   * ORCH-1147 — server fee-grossed ALL-IN (Σ unitPriceAllIn×qty), major units.
   * This is the headline Total floor (synchronous, web + native). The client
   * never re-derives it — it sums the server per-tier all-in.
   * I-PROPOSED-1147-CART-TOTAL-IS-SERVER-ALLIN (DRAFT).
   */
  allInTotal: number;
  /**
   * ORCH-1147 — the combined fees+tax delta (allInTotal − subtotal) in MINOR
   * units, GREATEST(0,…). Rendered as the SINGLE combined "Fees & tax" line
   * (feedback_cart_combined_fees_tax_line — never split service-fee + VAT).
   */
  feesTaxCents: number;
  /** ORCH-1147 — true iff feesTaxCents > 0 (gates the "Fees & tax" line). */
  hasFeesTaxDelta: boolean;
  currency: string;
  totalQuantity: number;
  isFree: boolean;
  isEmpty: boolean;
}

export const useCartTotals = (): CartTotals => {
  const { lines } = useCart();
  return useMemo<CartTotals>((): CartTotals => {
    let subtotal = 0;
    // ORCH-1147 — accumulate the server fee-grossed all-in alongside the base.
    // Each line falls back to its base when no all-in was plumbed (never NaN,
    // never fabricated). All math in major units; convert the delta to cents
    // once at the end (mirrors the consumer reference TicketCartSheet.tsx).
    let allInTotal = 0;
    let totalQuantity = 0;
    let currency = "";
    for (const line of lines) {
      subtotal += line.unitPrice * line.quantity;
      allInTotal += (line.unitPriceAllIn ?? line.unitPrice) * line.quantity;
      totalQuantity += line.quantity;
      currency = line.currency;
    }
    const isEmpty = totalQuantity === 0;
    const isFree = !isEmpty && subtotal === 0;
    // ORCH-1147 — combined fees+tax delta in MINOR units, GREATEST(0,…).
    const feesTaxCents = Math.max(0, Math.round((allInTotal - subtotal) * 100));
    return {
      subtotalGbp: subtotal,
      totalGbp: subtotal,
      subtotal,
      total: subtotal,
      allInTotal,
      feesTaxCents,
      hasFeesTaxDelta: feesTaxCents > 0,
      currency,
      totalQuantity,
      isFree,
      isEmpty,
    };
  }, [lines]);
};
