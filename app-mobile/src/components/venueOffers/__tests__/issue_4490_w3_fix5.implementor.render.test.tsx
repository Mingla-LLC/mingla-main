/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4490 Explorer W3 fix round 5 — the Menu tab's order bar and the order
 * sheet's fields, mounted (react-test-renderer, #2774 lane). The real shared
 * basket reducer drives a fake ordering object; the sheet primitive is a
 * recorder that draws its children only while `visible`.
 *
 *   M-1  with an empty basket nothing is reported to dock, and no bar is drawn
 *        inline either;
 *   M-2  with one item the surface reports the docked bar ("1 item · View
 *        order"), draws NO inline bar (one bar on screen), and the docked
 *        bar's press opens the review;
 *   M-3  while the review is open nothing is docked; closing it docks the bar
 *        again; unmounting (leaving the Menu pane) takes it away;
 *   M-4  a host that does not take the report keeps the inline bar (fallback);
 *   F-1  the note field is the SAME mounted input before and after a key
 *        (W3-N40: the row was re-keyed by every key, remounting the field);
 *   F-2  with the keyboard up the review ends with the Done-bar spacer, and
 *        without it there is none (W3-N38).
 *
 * FAILS-ON-REVERT: no `onOrderBarChange` report -> M-2/M-3; the inline bar
 * drawn regardless -> M-2; the row keyed by `line.key` -> F-1; the spacer
 * removed -> F-2.
 */
import React from "react";

const { act, create } = require("react-test-renderer") as typeof import("react-test-renderer");

type SheetProps = { visible: boolean; children?: React.ReactNode };
const mockSheetProps: SheetProps[] = [];
const mockInputMounts: string[] = [];
let mockKeyboardUp = false;
jest.mock("../../ui/BaseBottomSheet", () => {
  const ReactInner = require("react") as typeof import("react");
  return {
    BaseBottomSheet: (props: SheetProps) => {
      mockSheetProps.push(props);
      return props.visible
        ? ReactInner.createElement(ReactInner.Fragment, null, props.children)
        : null;
    },
    BottomSheetTextInput: (props: Record<string, unknown>) => {
      const label = String(props.accessibilityLabel ?? "");
      ReactInner.useEffect(() => {
        mockInputMounts.push(label);
      }, []);
      return ReactInner.createElement("input", props);
    },
  };
});
jest.mock("../../../wrappers/useKeyboardIsVisible", () => ({
  useKeyboardIsVisible: () => mockKeyboardUp,
}));
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
// Gameland Lagos as the device saw it: ordering on, no table, counter pickup.
const counterConfig = {
  state: "on", venueId: "venue-1", venueName: "Gameland Lagos", spotState: "none", spot: null,
  serviceChargeBps: 0, serviceChargeLabel: "Service", tipsEnabled: false, tipPresetsBps: null,
  counterPickupEnabled: true, tableServiceEnabled: true, orderMode: "both", prepTimeMinutes: null,
};

type Tree = ReturnType<typeof create>;
type DockBar = { title: string; subtitle: string | null; ctaLabel: string; enabled: boolean; onPress: () => void } | null;
const byTestId = (tree: Tree, id: string) => tree.root.findAll((n) => n.props.testID === id);
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

const MENU = [
  {
    menuId: "drinks", menuName: "Drinks", menuDescription: null,
    items: [{ id: "mocktail", name: "Mocktail", description: null, priceCents: 700000, currency: "NGN", allowsNotes: true }],
  },
];

function mount(onOrderBarChange?: (bar: DockBar) => void): Tree {
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
        menu={MENU as never}
        menuWindows={{}}
        timezone="Africa/Lagos"
        onBottomBarChange={() => undefined}
        onOrderBarChange={onOrderBarChange}
      />,
    );
  });
  return tree;
}

const line = { menuItemId: "mocktail", itemName: "Mocktail", modifierIds: [], modifierNames: [], notes: null };
const lastSheet = (): SheetProps => mockSheetProps[mockSheetProps.length - 1];

beforeEach(() => {
  mockSheetProps.length = 0;
  mockInputMounts.length = 0;
  mockKeyboardUp = false;
  cartRef = null;
});

describe("#4490 W3 fix 5 — the Menu tab's docked order bar (W3-N37)", () => {
  test("M-1 an empty basket reports nothing to dock and draws no bar", () => {
    const reports: DockBar[] = [];
    const tree = mount((bar) => reports.push(bar));
    expect(reports[reports.length - 1]).toBeNull();
    expect(byTestId(tree, "issue-4420-venue-order-bar")).toHaveLength(0);
  });

  test("M-2 one item docks the bar, nothing inline, and its press opens the review", () => {
    const reports: DockBar[] = [];
    const tree = mount((bar) => reports.push(bar));
    act(() => cartRef?.add(line));
    const bar = reports[reports.length - 1];
    expect(bar).not.toBeNull();
    expect(bar?.title).toBe("1 item");
    expect(bar?.subtitle).toBe("Pay on your phone");
    expect(bar?.ctaLabel).toBe("View order");
    expect(bar?.enabled).toBe(true);
    expect(byTestId(tree, "issue-4420-venue-order-bar")).toHaveLength(0);
    act(() => bar?.onPress());
    expect(cartRef?.state.view).toBe("review");
    expect(lastSheet().visible).toBe(true);
  });

  test("M-3 nothing docks under the open review; closing docks it again; leaving takes it away", () => {
    const reports: DockBar[] = [];
    const tree = mount((bar) => reports.push(bar));
    act(() => cartRef?.add(line));
    act(() => cartRef?.setView("review"));
    expect(reports[reports.length - 1]).toBeNull();
    act(() => byTestId(tree, "venue-order-close")[0].props.onPress());
    expect(reports[reports.length - 1]?.ctaLabel).toBe("View order");
    act(() => tree.unmount());
    expect(reports[reports.length - 1]).toBeNull();
  });

  test("M-4 a host that does not take the report keeps the inline bar", () => {
    const tree = mount(undefined);
    act(() => cartRef?.add(line));
    expect(byTestId(tree, "issue-4420-venue-order-bar").length > 0).toBe(true);
  });
});

describe("#4490 W3 fix 5 — the order sheet's fields (W3-N40, W3-N38)", () => {
  test("F-1 the note field stays the same mounted input while the guest types", () => {
    const tree = mount(() => undefined);
    act(() => cartRef?.add(line));
    act(() => cartRef?.setView("review"));
    const noteLabel = "A note for Mocktail";
    const note = () => tree.root.findAll((n) => n.type === "input" && n.props.accessibilityLabel === noteLabel)[0];
    expect(note()).toBeDefined();
    const mountsBefore = mockInputMounts.filter((l) => l === noteLabel).length;
    for (const value of ["N", "No", "No ice"]) {
      act(() => note().props.onChangeText(value));
      expect(note().props.value).toBe(value);
    }
    expect(mockInputMounts.filter((l) => l === noteLabel).length).toBe(mountsBefore);
    // The name field never remounts either.
    const nameMounts = mockInputMounts.filter((l) => l === "Your name").length;
    const name = () => tree.root.findAll((n) => n.type === "input" && n.props.accessibilityLabel === "Your name")[0];
    for (const value of ["T", "Te", "Tes"]) act(() => name().props.onChangeText(value));
    expect(name().props.value).toBe("Tes");
    expect(mockInputMounts.filter((l) => l === "Your name").length).toBe(nameMounts);
  });

  test("F-2 with the keyboard up the review ends with the Done-bar spacer", () => {
    mockKeyboardUp = true;
    const tree = mount(() => undefined);
    act(() => cartRef?.add(line));
    act(() => cartRef?.setView("review"));
    expect(byTestId(tree, "venue-order-keyboard-spacer")).toHaveLength(1);
    act(() => tree.unmount());
    mockKeyboardUp = false;
    const tree2 = mount(() => undefined);
    act(() => cartRef?.add(line));
    act(() => cartRef?.setView("review"));
    expect(byTestId(tree2, "venue-order-keyboard-spacer")).toHaveLength(0);
  });
});
