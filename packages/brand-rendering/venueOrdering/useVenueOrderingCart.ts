// ===========================================================================
// Issue #1793 — the guest's basket, as ONE reducer both surfaces share.
//
// SET-B: may sell, may never touch money. There is not a single arithmetic
// operation on a price in this file. It holds item ids, quantities, chosen
// option ids, notes, a tip CHOICE (not a tip amount), a party-size estimate and
// the contact triple — and hands them to the host, which posts them to
// `venue-order-create` and gets every number back.
//
// It lives in the shared package rather than in each app because the consumer
// app and buyer web must behave identically here: the same line identity, the
// same 99 ceiling, the same "the tip is remembered, not re-asked" rule. Two
// copies of that is how a table gets asked to tip twice on one surface and once
// on the other.
// ===========================================================================

// The package-local React bridge (see PublicVenueTabs.tsx): files under
// packages/ cannot discover the app's React peer, so importing "react"
// directly here would emit unresolved-peer diagnostics in both apps'
// isolated typecheck sandboxes. One bridge, reused by every shared renderer.
import { BrandRenderingReact as React } from "../PublicVenueTabs";

import type {
  VenueOrderBuyerDraft,
  VenueOrderCartLine,
  VenueOrderingConfig,
  VenueOrderingView,
  VenueOrderTipChoice,
} from "./venueOrderingTypes";
import {
  VENUE_ORDER_MAX_LINE_QUANTITY,
  type VenueOrderCartAction,
  venueOrderCartCount,
  venueOrderCartLineKey,
  venueOrderCartReducer,
  venueOrderInitialTip,
} from "./venueOrderingRules";
import {
  venueOrderNameAfterHydration,
  venueOrderTipAfterHydration,
} from "./venueOrderingSitting";

export interface VenueOrderingCartState {
  lines: VenueOrderCartLine[];
  view: VenueOrderingView;
  /** The one item whose options panel is expanded, if any. */
  openItemId: string | null;
  tip: VenueOrderTipChoice;
  /**
   * Has the GUEST touched the tip on this screen?
   *
   * Load-bearing for OQ-2. A sitting resolves from storage ASYNCHRONOUSLY (a
   * disk read on native), which is always at least one render AFTER the reducer
   * was initialised — so the remembered answer has to be applied later, and
   * "later" must never overwrite a choice the guest has meanwhile made with
   * their thumb. This flag is the difference between remembering an answer and
   * silently changing one.
   */
  tipTouched: boolean;
  partySize: number | null;
  buyer: VenueOrderBuyerDraft;
}

type State = VenueOrderingCartState;

type Action =
  | { type: "CART"; action: VenueOrderCartAction }
  | { type: "SET_NOTES"; key: string; notes: string | null }
  | { type: "VIEW"; view: VenueOrderingView }
  | { type: "OPEN_ITEM"; itemId: string | null }
  | { type: "TIP"; tip: VenueOrderTipChoice }
  | { type: "PARTY_SIZE"; value: number | null }
  | { type: "BUYER"; patch: Partial<VenueOrderBuyerDraft> }
  | {
    type: "HYDRATE_SITTING";
    tip: VenueOrderTipChoice | null;
    buyerName: string;
  }
  | { type: "ROUND_SETTLED" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "CART": {
      const lines = venueOrderCartReducer(state.lines, action.action);
      // Emptying the basket from the review step returns the guest to the menu
      // rather than leaving them staring at an empty receipt with a dead button.
      const view = state.view === "review" && lines.length === 0
        ? "browse"
        : state.view;
      return { ...state, lines, view };
    }
    case "SET_NOTES": {
      // A note is part of a line's IDENTITY (two burgers, one without onions,
      // are two lines), so changing it re-keys the line — and if that key
      // already exists the two collapse into one, which is what a guest means
      // when they make two lines identical.
      const target = state.lines.find((line) => line.key === action.key);
      if (target === undefined) return state;
      const nextKey = venueOrderCartLineKey({
        menuItemId: target.menuItemId,
        modifierIds: target.modifierIds,
        notes: action.notes,
      });
      const rest = state.lines.filter((line) => line.key !== action.key);
      const collision = rest.find((line) => line.key === nextKey);
      if (collision !== undefined) {
        return {
          ...state,
          lines: rest.map((line) =>
            line.key === nextKey
              ? {
                ...line,
                quantity: Math.min(
                  VENUE_ORDER_MAX_LINE_QUANTITY,
                  line.quantity + target.quantity,
                ),
              }
              : line
          ),
        };
      }
      return {
        ...state,
        lines: state.lines.map((line) =>
          line.key === action.key
            ? { ...line, key: nextKey, notes: action.notes }
            : line
        ),
      };
    }
    case "VIEW":
      return { ...state, view: action.view, openItemId: null };
    case "OPEN_ITEM":
      return { ...state, openItemId: action.itemId };
    case "TIP":
      return { ...state, tip: action.tip, tipTouched: true };
    case "HYDRATE_SITTING": {
      // The sitting arrived. Apply what it remembers to anything the guest has
      // not already answered here — and to nothing else.
      const tip = venueOrderTipAfterHydration({
        current: state.tip,
        touched: state.tipTouched,
        remembered: action.tip,
      });
      const name = venueOrderNameAfterHydration(state.buyer.name, action.buyerName);
      if (tip === state.tip && name === state.buyer.name) return state;
      return { ...state, tip, buyer: { ...state.buyer, name } };
    }
    case "PARTY_SIZE":
      return { ...state, partySize: action.value };
    case "BUYER":
      return { ...state, buyer: { ...state.buyer, ...action.patch } };
    case "ROUND_SETTLED":
      // The round is paid. The BASKET empties; the tip, the party size and the
      // contact triple stay, because the sitting remembers them and re-asking
      // is exactly what OQ-2 forbids.
      return { ...state, lines: [], view: "status", openItemId: null };
    default:
      return state;
  }
}

export interface VenueOrderingCartApi {
  state: VenueOrderingCartState;
  count: number;
  add: (line: Omit<VenueOrderCartLine, "key" | "quantity">) => void;
  setQuantity: (key: string, quantity: number) => void;
  setNotes: (key: string, notes: string | null) => void;
  clear: () => void;
  setView: (view: VenueOrderingView) => void;
  openItem: (itemId: string | null) => void;
  setTip: (tip: VenueOrderTipChoice) => void;
  setPartySize: (value: number | null) => void;
  patchBuyer: (patch: Partial<VenueOrderBuyerDraft>) => void;
  /** Apply a sitting that resolved after mount, without overwriting a guest. */
  hydrateSitting: (tip: VenueOrderTipChoice | null, buyerName: string) => void;
  roundSettled: () => void;
}

export function useVenueOrderingCart(input: {
  config: VenueOrderingConfig;
  /** The sitting's remembered tip, when this is not the first round (OQ-2). */
  rememberedTip: VenueOrderTipChoice | null;
  /** Prefill for a signed-in app user. Anon web guests start empty. */
  initialBuyer?: Partial<VenueOrderBuyerDraft>;
}): VenueOrderingCartApi {
  const [state, dispatch] = React.useReducer(
    reducer,
    { config: input.config, rememberedTip: input.rememberedTip },
    (seed: { config: VenueOrderingConfig; rememberedTip: VenueOrderTipChoice | null }): State => ({
      lines: [],
      view: "browse",
      openItemId: null,
      tip: venueOrderInitialTip(seed.config, seed.rememberedTip),
      tipTouched: false,
      partySize: null,
      buyer: {
        name: input.initialBuyer?.name ?? "",
        email: input.initialBuyer?.email ?? "",
        phone: input.initialBuyer?.phone ?? "",
      },
    }),
  );

  const add = React.useCallback(
    (line: Omit<VenueOrderCartLine, "key" | "quantity">): void =>
      dispatch({ type: "CART", action: { type: "ADD", line } }),
    [],
  );
  const setQuantity = React.useCallback(
    (key: string, quantity: number): void =>
      dispatch({ type: "CART", action: { type: "SET_QUANTITY", key, quantity } }),
    [],
  );
  const setNotes = React.useCallback(
    (key: string, notes: string | null): void =>
      dispatch({ type: "SET_NOTES", key, notes }),
    [],
  );
  const clear = React.useCallback(
    (): void => dispatch({ type: "CART", action: { type: "CLEAR" } }),
    [],
  );
  const setView = React.useCallback(
    (view: VenueOrderingView): void => dispatch({ type: "VIEW", view }),
    [],
  );
  const openItem = React.useCallback(
    (itemId: string | null): void => dispatch({ type: "OPEN_ITEM", itemId }),
    [],
  );
  const setTip = React.useCallback(
    (tip: VenueOrderTipChoice): void => dispatch({ type: "TIP", tip }),
    [],
  );
  const setPartySize = React.useCallback(
    (value: number | null): void => dispatch({ type: "PARTY_SIZE", value }),
    [],
  );
  const patchBuyer = React.useCallback(
    (patch: Partial<VenueOrderBuyerDraft>): void =>
      dispatch({ type: "BUYER", patch }),
    [],
  );
  const hydrateSitting = React.useCallback(
    (tip: VenueOrderTipChoice | null, buyerName: string): void =>
      dispatch({ type: "HYDRATE_SITTING", tip, buyerName }),
    [],
  );
  const roundSettled = React.useCallback(
    (): void => dispatch({ type: "ROUND_SETTLED" }),
    [],
  );

  const count = React.useMemo(() => venueOrderCartCount(state.lines), [state.lines]);

  return {
    state,
    count,
    add,
    setQuantity,
    setNotes,
    clear,
    setView,
    openItem,
    setTip,
    setPartySize,
    patchBuyer,
    hydrateSitting,
    roundSettled,
  };
}
