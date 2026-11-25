/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4490 Explorer W3 fix round 4 — the Menu tab's order sheet (W3-N36), mounted
 * (react-test-renderer, #2774 lane). The real shared basket reducer drives a
 * fake ordering object; the sheet primitive is replaced by a recorder that
 * draws its children only while `visible` (what a native window does).
 *
 *   O-1  an empty basket at a counter-pickup venue shows NO order sheet, and an
 *        attempt to open the review with nothing in it changes nothing;
 *   O-2  with one item, View order opens the review; "Close" and "‹ Menu" each
 *        shut it (they were dead: the sheet had been dragged up while the
 *        state still said browse, so setting browse changed nothing);
 *   O-3  the sheet is its own native window (`wrapInRNModal`), never a shut
 *        sheet parked in the menu's scroll content that a swipe can drag up
 *        and the venue's docked bar is drawn over;
 *   O-4  ordering tells the page it owns the Menu tab's bottom edge while the
 *        guest can order (so "Buy entry" is not docked over the menu), and
 *        gives it back on unmount.
 *
 * FAILS-ON-REVERT: `visible = view === "review" || view === "status"` with the
 * reducer's empty-basket guard removed -> O-1; no `wrapInRNModal` -> O-3; no
 * `onBottomBarChange` from the surface -> O-4.
 */
import React from "react";

const { act, create } = require("react-test-renderer") as typeof import("react-test-renderer");

type SheetProps = { visible: boolean; wrapInRNModal?: boolean; children?: React.ReactNode };
const mockSheetProps: SheetProps[] = [];
jest.mock("../../ui/BaseBottomSheet", () => {
  const ReactInner = require("react") as typeof import("react");
  return {
    BaseBottomSheet: (props: SheetProps) => {
      mockSheetProps.push(props);
      return props.visible
        ? ReactInner.createElement(ReactInner.Fragment, null, props.children)
        : null;
    },
    BottomSheetTextInput: (props: Record<string, unknown>) =>
      ReactInner.createElement("input", props),
  };
});
jest.mock("../../venueOrdering/ConsumerVenueOrderPhoneField", () => ({
  ConsumerVenueOrderPhoneField: () => null,
}));
let mockOrderingHook: () => unknown = () => {
  throw new Error("set mockOrderingHook");
};
jest.mock("../../venueOrdering/useConsumerVenueOrdering", () => ({
  useConsumerVenueOrdering: () => mockOrderingHook(),
}));

const { useVenueOrderingCart } = require("@mingla/brand-rendering/venueOrdering/useVenueOrderingCart") as typeof import("@mingla/brand-rendering/venueOrdering/useVenueOrderingCart");
const { ConsumerVenueOrderingSurface } = require("../../venueOrdering/ConsumerVenueOrderingSlots") as typeof import("../../venueOrdering/ConsumerVenueOrderingSlots");

const palette = {
  page: "#000000", accent: "#eb7825", accentText: "#16110d", primaryText: "#ffffff", secondaryText: "#cccccc",
  tertiaryText: "#999999", panel: "#111111", panelStrong: "#222222", panelBorder: "#333333", card: "#0a0a0a",
  cutoutBorder: "#444444", glass: "#000000", glassTint: "dark", accentWash: "#1a1a1a",
};
// Gameland Lagos as the device saw it: ordering on, no table scanned,
// counter pickup allowed (the sheet's chip read "Collect from the counter").
const counterConfig = {
  state: "on", venueId: "venue-1", venueName: "Gameland Lagos", spotState: "none", spot: null,
  serviceChargeBps: 0, serviceChargeLabel: "Service", tipsEnabled: false, tipPresetsBps: null,
  counterPickupEnabled: true, tableServiceEnabled: true, orderMode: "both", prepTimeMinutes: null,
};

type Tree = ReturnType<typeof create>;
const byTestId = (tree: Tree, id: string) => tree.root.findAll((n) => n.props.testID === id)[0];
const texts = (tree: Tree): string[] =>
  tree.root.findAll((n) => typeof n.props.children === "string").map((n) => n.props.children as string);
let cartRef: ReturnType<typeof useVenueOrderingCart> | null = null;

function useFakeOrdering(): unknown {
  const cart = useVenueOrderingCart({ config: counterConfig as never, rememberedTip: null });
  cartRef = cart;
  return {
    config: counterConfig, configReady: true, scanned: false, modifiersByItemId: {}, cart,
    preview: null, previewStatus: cart.state.lines.length === 0 ? "idle" : "loading", previewError: null,
    submitting: false, submitError: null, submit: () => undefined, live: null, actionPending: false,
    actionError: null, cancelOrder: () => undefined, requestRefund: () => undefined,
    retryPayment: () => undefined, orderMore: () => undefined, askPartySize: false, tipRemembered: false,
    pickup: false, setPickup: () => undefined, hasCounterOrder: false, openCounterOrder: () => undefined,
  };
}

function mount(onBottomBarChange?: (owned: boolean) => void): Tree {
  mockOrderingHook = useFakeOrdering;
  let tree!: Tree;
  act(() => {
    tree = create(
      <ConsumerVenueOrderingSurface
        palette={palette as never}
        surface={{ card: {} } as never}
        theme={{} as never}
        brandSlug="harmattan-club-local"
        venueSlug="gamelandlagos"
        spotCode={null}
        entrySource={null}
        menu={[]}
        menuWindows={{}}
        timezone="Africa/Lagos"
        onBottomBarChange={onBottomBarChange}
      />,
    );
  });
  return tree;
}

const lastSheet = (): SheetProps => mockSheetProps[mockSheetProps.length - 1];
const line = { menuItemId: "jollof", itemName: "Jollof rice", modifierIds: [], modifierNames: [], notes: null };

beforeEach(() => {
  mockSheetProps.length = 0;
  cartRef = null;
});

describe("#4490 W3 fix 4 — the Menu tab's order sheet (W3-N36)", () => {
  test("O-1 an empty basket shows no order sheet, and cannot open the review", () => {
    const tree = mount();
    expect(lastSheet().visible).toBe(false);
    expect(texts(tree)).not.toContain("Your order");
    act(() => cartRef?.setView("review"));
    expect(cartRef?.state.view).toBe("browse");
    expect(lastSheet().visible).toBe(false);
    expect(texts(tree)).not.toContain("Your order");
  });

  test("O-2 with an item the review opens, and Close and ‹ Menu each shut it", () => {
    const tree = mount();
    act(() => cartRef?.add(line));
    for (const id of ["venue-order-close", "venue-order-back"]) {
      act(() => cartRef?.setView("review"));
      expect(lastSheet().visible).toBe(true);
      expect(texts(tree)).toContain("Your order");
      act(() => byTestId(tree, id).props.onPress());
      expect(cartRef?.state.view).toBe("browse");
      expect(lastSheet().visible).toBe(false);
      expect(texts(tree)).not.toContain("Your order");
    }
  });

  test("O-3 the order sheet is its own native window, above the page and its docked bar", () => {
    mount();
    expect(mockSheetProps.length > 0).toBe(true);
    expect(mockSheetProps.every((p) => p.wrapInRNModal === true)).toBe(true);
  });

  test("O-4 ordering owns the Menu tab's bottom edge while the guest can order, and gives it back", () => {
    const calls: boolean[] = [];
    const tree = mount((owned) => calls.push(owned));
    expect(calls[calls.length - 1]).toBe(true);
    act(() => tree.unmount());
    expect(calls[calls.length - 1]).toBe(false);
  });
});
