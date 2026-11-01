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
  useRef,
} from "react";
import type { ReactNode } from "react";
import {
  createCheckoutAttemptId,
  createCheckoutAttemptTracker,
  type CheckoutLinePlanChoice,
} from "@mingla/offering-rendering/ticketCheckoutContract";
import {
  type TicketCheckoutReview,
  type TicketQuote,
} from "@mingla/offering-rendering/discountQuote";

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
  /**
   * #3859 — explicit checkout-v2 authority for this line. Optional only at the
   * legacy type boundary; every reducer-created runtime line stores `"full"`
   * when its caller omits the choice.
   */
  paymentPlanChoice?: CheckoutLinePlanChoice;
  /**
   * issue #3281 PR10 — optional per-date quantities when "Same tickets for
   * every date" is off. Absent means uniform quantity × chosen days.
   */
  byDate?: Readonly<Record<string, number>>;
}

export interface BuyerDetails {
  name: string;
  email: string;
  /** Required for production checkout. Edge functions normalise to E.164. */
  phone: string;
  marketingOptIn: boolean;
  /**
   * #3859 — required purchase acceptance. This gates checkout independently
   * from the optional `marketingOptIn` choice; changing one never changes the
   * other. Both default false and require their own affirmative acts.
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

export interface BuyerConfirmationContact {
  email: string | null;
  phoneLast4: string | null;
}

export interface BuyerConfirmationReceipt {
  lines: {
    qty: number;
    name: string;
    amountCents: number;
  }[];
  discountLines: {
    label: string;
    amountCents: number;
  }[];
  feesAndTaxCents: number;
  paidCents: number;
  currency: string;
  dateLine: string | null;
  /** First eight hex characters of the order UUID, upper case. */
  orderRef: string;
}

export interface BuyerConfirmationClaim {
  shortUrl: string | null;
  code: string | null;
}

export interface OrderResult {
  orderId: string;
  ticketIds: string[];
  checkoutSessionId?: string;
  /**
   * issue #2323 — the buyer-status possession proof that authorised THIS
   * checkout, carried onto the finalized order.
   *
   * Before this the token existed only inside the paid Stripe-return leg's
   * closure (and, on web only, in the #2150 sessionStorage resume payload), so
   * a FREE reservation — which holds the token in hand at `recordResult` time —
   * simply dropped it, and `useAttendanceClaimArm` had nothing to mint the
   * attendance claim with. Measured consequence: 9 of 9 free production orders
   * were never armed, so no installed app could ever find them.
   *
   * NOT a new authority. The server still verifies this token against
   * `ticket_checkout_sessions.buyer_status_token_hash`; holding it in the same
   * in-memory cart state that already holds the order and its QR payloads is
   * strictly less exposed than the sessionStorage copy that already existed.
   */
  buyerStatusToken?: string;
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
  /** #4063 — status-token-gated server truth used by confirmation UI. */
  buyerContact?: BuyerConfirmationContact;
  /** #4063 — immutable server receipt; the client performs no checkout math. */
  receipt?: BuyerConfirmationReceipt;
  /** #4063 — short claim link plus the code used to mint a desktop handoff. */
  claim?: BuyerConfirmationClaim;
  /** True when the ticket was attached to an existing Explorer account. */
  attachedToAccount?: boolean;
  /** True when an authenticated purchaser entered a different buyer contact. */
  boughtForSomeoneElse?: boolean;
  tickets: {
    ticketId: string;
    ticketTypeId: string | null;
    ticketName: string;
    status: string;
  }[];
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
export type TicketQuoteStatus = "idle" | "loading" | "ready" | "error";

export interface CartState {
  lines: CartLine[];
  buyer: BuyerDetails;
  /** #3872 — normalized code entered by the buyer; null means no code. */
  discountCode: string | null;
  /** #3872 — the only checkout-money authority rendered by the funnel. */
  quote: TicketQuote | null;
  quoteStatus: TicketQuoteStatus;
  quoteErrorCode: string | null;
  /** A create-time 409 that must be explicitly accepted before another create. */
  checkoutReview: TicketCheckoutReview | null;
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
  /**
   * issue #2160 [multi-day multi-select] — the SET of `event_dates.id`s the
   * guest chose on a multi-date EVENT.
   *
   * ADDED ALONGSIDE `eventDateId`, never replacing it. The single field is the
   * EXPERIENCE surface's contract (`checkout-experience/[experienceEventId]/*`)
   * and is frozen by the strict-grep gate
   * `orch-1138-experience-checkout-byte-identical.mjs`. The two never both
   * carry a value on one checkout: experiences use the single, multi-date
   * events use the set.
   *
   * Empty => the ticket-checkout-create request body is byte-identical to
   * today, which is every single-date event, trip, RSVP and experience.
   */
  eventDateIds: readonly string[];
  /**
   * issue #3281 Round 1 — open-daily booked start (ISO). null when the buyer
   * did not pick a time within the window. Forwarded as `bookedStartAt` on
   * ticket-checkout-create only when non-null.
   */
  bookedStartAt: string | null;
  /** issue #3281 R2 — block hire end (ISO). null when absent. */
  bookedEndAt: string | null;
  /** issue #3281 R2 — guest party size. null when absent. */
  partySize: number | null;
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
      paymentPlanChoice?: CheckoutLinePlanChoice;
      byDate?: Readonly<Record<string, number>>;
    }
  | { type: "SET_BUYER"; patch: Partial<BuyerDetails> }
  | { type: "SET_DISCOUNT_CODE"; code: string | null }
  | {
      type: "SET_QUOTE_STATE";
      quote: TicketQuote | null;
      status: TicketQuoteStatus;
      errorCode: string | null;
    }
  | { type: "SET_CHECKOUT_REVIEW"; review: TicketCheckoutReview | null }
  | { type: "RECORD_RESULT"; result: OrderResult }
  | { type: "SET_INTAKE_TIER"; ticketTypeId: string; data: unknown }
  | { type: "CLEAR_INTAKE_TIER"; ticketTypeId: string }
  | { type: "SET_PAYMENT_PLAN_CHOICE"; choice: TripPaymentPlanChoice }
  | {
      type: "SET_LINE_PAYMENT_PLAN_CHOICE";
      ticketTypeId: string;
      choice: CheckoutLinePlanChoice;
    }
  // ORCH-1138 Leg 3 — set/clear the chosen experience occurrence.
  | { type: "SET_EVENT_DATE_ID"; eventDateId: string | null }
  // issue #2160 — set/clear the chosen multi-date day SET.
  | { type: "SET_EVENT_DATE_IDS"; eventDateIds: readonly string[] }
  | { type: "SET_BOOKED_START_AT"; bookedStartAt: string | null }
  | { type: "SET_BOOKED_END_AT"; bookedEndAt: string | null }
  | { type: "SET_PARTY_SIZE"; partySize: number | null }
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
  discountCode: null,
  quote: null,
  quoteStatus: "idle",
  quoteErrorCode: null,
  checkoutReview: null,
  result: null,
  intakeFormData: {},
  // ORCH-1130 — default to pay-in-full (deliberate non-surprising default).
  paymentPlanChoice: "full",
  // ORCH-1138 Leg 3 — no occurrence chosen by default (single/no-date path).
  eventDateId: null,
  // issue #2160 — no days chosen by default. An explicit choice is required.
  eventDateIds: [],
  bookedStartAt: null,
  bookedEndAt: null,
  partySize: null,
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
        paymentPlanChoice,
        byDate,
      } = action;
      const normalizedCurrency = currency.toUpperCase();
      const existingCurrency = state.lines[0]?.currency;
      if (
        existingCurrency !== undefined &&
        existingCurrency !== normalizedCurrency &&
        quantity > 0
      ) {
        throw new Error("Cart currency mismatch.");
      }
      const hasExisting = state.lines.some(
        (l) => l.ticketTypeId === ticketTypeId,
      );
      if (quantity <= 0) {
        // Remove line if quantity drops to zero.
        if (!hasExisting) return state;
        return {
          ...state,
          lines: state.lines.filter((l) => l.ticketTypeId !== ticketTypeId),
        };
      }
      if (!hasExisting) {
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
              paymentPlanChoice: paymentPlanChoice ?? "full",
              byDate,
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
                unitPriceAllIn:
                  unitPriceAllIn ?? l.unitPriceAllIn ?? l.unitPrice,
                ...(paymentPlanChoice !== undefined
                  ? { paymentPlanChoice }
                  : {}),
                byDate,
              }
            : l,
        ),
      };
    }
    case "SET_BUYER":
      return { ...state, buyer: { ...state.buyer, ...action.patch } };
    case "SET_DISCOUNT_CODE":
      return {
        ...state,
        discountCode: action.code,
        quoteStatus: state.lines.length > 0 ? "loading" : "idle",
        checkoutReview: null,
      };
    case "SET_QUOTE_STATE":
      return {
        ...state,
        quote: action.quote,
        quoteStatus: action.status,
        quoteErrorCode: action.errorCode,
      };
    case "SET_CHECKOUT_REVIEW":
      return { ...state, checkoutReview: action.review };
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
    case "SET_LINE_PAYMENT_PLAN_CHOICE": {
      return {
        ...state,
        lines: state.lines.map((line) =>
          line.ticketTypeId === action.ticketTypeId
            ? { ...line, paymentPlanChoice: action.choice }
            : line,
        ),
      };
    }
    case "SET_EVENT_DATE_ID":
      return { ...state, eventDateId: action.eventDateId };
    case "SET_EVENT_DATE_IDS":
      return { ...state, eventDateIds: action.eventDateIds };
    case "SET_BOOKED_START_AT":
      return { ...state, bookedStartAt: action.bookedStartAt };
    case "SET_BOOKED_END_AT":
      return { ...state, bookedEndAt: action.bookedEndAt };
    case "SET_PARTY_SIZE":
      return { ...state, partySize: action.partySize };
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
    paymentPlanChoice?: CheckoutLinePlanChoice;
    byDate?: Readonly<Record<string, number>>;
  }) => void;
  setBuyer: (patch: Partial<BuyerDetails>) => void;
  setDiscountCode: (code: string | null) => void;
  setQuoteState: (
    quote: TicketQuote | null,
    status: TicketQuoteStatus,
    errorCode?: string | null,
  ) => void;
  setCheckoutReview: (review: TicketCheckoutReview | null) => void;
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
  setLinePaymentPlanChoice: (
    ticketTypeId: string,
    choice: CheckoutLinePlanChoice,
  ) => void;
  checkoutAttemptIdFor: (input: {
    eventId: string;
    surface: "web" | "mobile-web";
    ticketLinkToken?: string | null;
  }) => string;
  /** Clears only attempt identity; reserved for an explicit server review reset. */
  resetCheckoutAttempt: () => void;
  /** One private intake upload draft for this cart lifetime. */
  intakeUploadSessionId: string;
  /**
   * ORCH-1138 Leg 3 — set/clear the chosen experience occurrence. Called by the
   * checkout-experience index's seed-from-route-param effect (the `eventDateId`
   * param the public /exp/ page threads when the buyer picked a slot). null on
   * the single/no-date path → request byte-identical.
   */
  setEventDateId: (eventDateId: string | null) => void;
  /**
   * issue #2160 — seed the chosen day SET. Called by the cart step's
   * seed-from-route-param effect (`?eventDateIds=a,b`, with the legacy single
   * `?eventDateId=` accepted as a one-element set).
   */
  setEventDateIds: (eventDateIds: readonly string[]) => void;
  /** issue #3281 — set/clear the open-daily booked start from route params. */
  setBookedStartAt: (bookedStartAt: string | null) => void;
  /** issue #3281 R2 — set/clear block hire end from route params. */
  setBookedEndAt: (bookedEndAt: string | null) => void;
  /** issue #3281 R2 — set/clear party size from route params. */
  setPartySize: (partySize: number | null) => void;
  reset: () => void;
}

const CartCtx = createContext<CartContextValue | null>(null);

interface CartProviderProps {
  children: ReactNode;
}

export const CartProvider: React.FC<CartProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const checkoutAttemptTrackerRef = useRef(createCheckoutAttemptTracker());
  const intakeUploadSessionRef = useRef(createCheckoutAttemptId());

  const resetCheckoutAttempt = useCallback((): void => {
    checkoutAttemptTrackerRef.current.reset();
  }, []);

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
      paymentPlanChoice?: CheckoutLinePlanChoice;
      byDate?: Readonly<Record<string, number>>;
    }): void => {
      dispatch({ type: "SET_LINE_QUANTITY", ...params });
    },
    [],
  );

  const setBuyer = useCallback((patch: Partial<BuyerDetails>): void => {
    dispatch({ type: "SET_BUYER", patch });
  }, []);

  const setDiscountCode = useCallback(
    (code: string | null): void => {
      const normalized = code?.replace(/[\s-]+/g, "").toUpperCase() ?? "";
      resetCheckoutAttempt();
      dispatch({
        type: "SET_DISCOUNT_CODE",
        code: normalized.length > 0 ? normalized : null,
      });
    },
    [resetCheckoutAttempt],
  );

  const setQuoteState = useCallback(
    (
      quote: TicketQuote | null,
      status: TicketQuoteStatus,
      errorCode: string | null = null,
    ): void => {
      dispatch({ type: "SET_QUOTE_STATE", quote, status, errorCode });
    },
    [],
  );

  const setCheckoutReview = useCallback(
    (review: TicketCheckoutReview | null): void => {
      dispatch({ type: "SET_CHECKOUT_REVIEW", review });
    },
    [],
  );

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

  const setLinePaymentPlanChoice = useCallback(
    (ticketTypeId: string, choice: CheckoutLinePlanChoice): void => {
      dispatch({ type: "SET_LINE_PAYMENT_PLAN_CHOICE", ticketTypeId, choice });
    },
    [],
  );

  const checkoutAttemptIdFor = useCallback(
    (input: {
      eventId: string;
      surface: "web" | "mobile-web";
      ticketLinkToken?: string | null;
    }): string =>
      checkoutAttemptTrackerRef.current.idFor({
        eventId: input.eventId,
        ticketLinkToken: input.ticketLinkToken,
        purchaseTermsAccepted: state.buyer.termsAccepted === true,
        buyer: {
          name: state.buyer.name,
          email: state.buyer.email,
          phone: state.buyer.phone,
          marketingOptIn: state.buyer.marketingOptIn === true,
        },
        providerInput: { surface: input.surface },
        lines: state.lines.map((line) => ({
          ticketTypeId: line.ticketTypeId,
          quantity: line.quantity,
          paymentPlanChoice: line.paymentPlanChoice ?? "full",
        })),
        eventDateId: state.eventDateId,
        eventDateIds: state.eventDateIds,
        bookedStartAt: state.bookedStartAt,
        bookedEndAt: state.bookedEndAt,
        partySize: state.partySize,
        discountCode: state.discountCode,
        intakeFormData: Object.values(state.intakeFormData),
      }),
    [state],
  );

  // ORCH-1138 Leg 3 — chosen experience occurrence setter.
  const setEventDateId = useCallback((eventDateId: string | null): void => {
    dispatch({ type: "SET_EVENT_DATE_ID", eventDateId });
  }, []);

  // issue #2160 — chosen multi-date day set setter.
  const setEventDateIds = useCallback(
    (eventDateIds: readonly string[]): void => {
      dispatch({ type: "SET_EVENT_DATE_IDS", eventDateIds });
    },
    [],
  );

  const setBookedStartAt = useCallback((bookedStartAt: string | null): void => {
    dispatch({ type: "SET_BOOKED_START_AT", bookedStartAt });
  }, []);

  const setBookedEndAt = useCallback((bookedEndAt: string | null): void => {
    dispatch({ type: "SET_BOOKED_END_AT", bookedEndAt });
  }, []);

  const setPartySize = useCallback((partySize: number | null): void => {
    dispatch({ type: "SET_PARTY_SIZE", partySize });
  }, []);

  const reset = useCallback((): void => {
    resetCheckoutAttempt();
    intakeUploadSessionRef.current = createCheckoutAttemptId();
    dispatch({ type: "RESET" });
  }, [resetCheckoutAttempt]);

  const value = useMemo<CartContextValue>(
    () => ({
      ...state,
      setLineQuantity,
      setBuyer,
      setDiscountCode,
      setQuoteState,
      setCheckoutReview,
      recordResult,
      setIntakeTierData,
      clearIntakeTierData,
      setPaymentPlanChoice,
      setLinePaymentPlanChoice,
      checkoutAttemptIdFor,
      resetCheckoutAttempt,
      intakeUploadSessionId: intakeUploadSessionRef.current,
      setEventDateId,
      setEventDateIds,
      setBookedStartAt,
      setBookedEndAt,
      setPartySize,
      reset,
    }),
    [
      state,
      setLineQuantity,
      setBuyer,
      setDiscountCode,
      setQuoteState,
      setCheckoutReview,
      recordResult,
      setIntakeTierData,
      clearIntakeTierData,
      setPaymentPlanChoice,
      setLinePaymentPlanChoice,
      checkoutAttemptIdFor,
      resetCheckoutAttempt,
      setEventDateId,
      setEventDateIds,
      setBookedStartAt,
      setBookedEndAt,
      setPartySize,
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

export interface CartQuoteTotals {
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

export const useCartQuoteTotals = (): CartQuoteTotals => {
  const { lines, quote, quoteStatus } = useCart();
  return useMemo<CartQuoteTotals>((): CartQuoteTotals => {
    const totalQuantity = lines.reduce(
      (count, line) => count + line.quantity,
      0,
    );
    const isEmpty = totalQuantity === 0;
    const subtotal = quote === null ? 0 : quote.listSubtotalCents / 100;
    const total = quote === null ? 0 : quote.netSubtotalCents / 100;
    const allInTotal = quote === null ? 0 : quote.buyerTotalCents / 100;
    const feesTaxCents =
      quote === null
        ? 0
        : Math.max(0, quote.buyerTotalCents - quote.dueTodayNetCents);
    return {
      subtotalGbp: subtotal,
      totalGbp: total,
      subtotal,
      total,
      allInTotal,
      feesTaxCents,
      hasFeesTaxDelta: feesTaxCents > 0,
      currency: quote?.currency ?? lines[0]?.currency ?? "",
      totalQuantity,
      isFree:
        !isEmpty && quoteStatus === "ready" && quote?.buyerTotalCents === 0,
      isEmpty,
    };
  }, [lines, quote, quoteStatus]);
};
