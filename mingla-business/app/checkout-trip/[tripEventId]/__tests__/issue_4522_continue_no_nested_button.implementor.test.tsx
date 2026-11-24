/**
 * issue #4522 W-11 — the trip checkout details step's Continue must not sit
 * inside another button (React on web: "<button> cannot contain a nested
 * <button>"). A disabled Continue still answers a tap: the hint tap is an
 * overlay SIBLING of the Button and shows "Please agree to continue.".
 *
 * Also (W-11 readable accent): the "Total due today" label and amount on this
 * step paint with the readable accent text token, never the orange fill token.
 *
 * Mounts the REAL details step (buyer.tsx) inside the REAL CartProvider with
 * the REAL Button; only the network, router, analytics, icons and animation
 * library are replaced.
 *
 * FAILS ON REVERT: wrap the Button in the hint Pressable again (main's shape),
 * drop the overlay, or paint dueTodayLabel / dueTodayValue with color.accent.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import React from "react";
import { StyleSheet } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

type Node = {
  type: unknown;
  props: Record<string, unknown>;
  parent: Node | null;
  children: Array<Node | string>;
  findAll: (p: (n: Node) => boolean) => Node[];
};
type Renderer = { root: Node; unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const TRIP_EVENT_ID = "45220000-0000-4000-8000-000000000001";
const TICKET_TYPE_ID = "45220000-0000-4000-8000-000000000002";

const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL: "https://host.usemingla.com" } } },
}));
jest.mock("expo-router", () => ({
  useRouter: () => router,
  useLocalSearchParams: () => ({ tripEventId: TRIP_EVENT_ID }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: {
    View: "AnimatedView",
    Text: "AnimatedText",
    createAnimatedComponent: (component: unknown) => component,
  },
  Easing: { out: () => () => 0, in: () => () => 0, inOut: () => () => 0, bezier: () => () => 0, cubic: () => 0, ease: () => 0 },
  interpolate: () => 0,
  interpolateColor: (_v: number, _i: number[], colours: string[]) => colours[0],
  runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
  useAnimatedProps: () => ({}),
  useAnimatedStyle: () => ({}),
  useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
  useReducedMotion: () => true,
  useSharedValue: (value: unknown) => ({ value }),
  withDelay: (_ms: number, value: unknown) => value,
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
}));
jest.mock("../../../../src/services/supabase", () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    functions: { invoke: jest.fn() },
  },
}));
jest.mock("../../../../src/hooks/usePublicTripById", () => ({
  usePublicTripById: () => ({
    data: {
      trip: {
        id: TRIP_EVENT_ID,
        title: "Lagos Weekend",
        slug: "lagos-weekend",
        brandSlug: "minglanigeria",
        currency: "USD",
        pricingTiers: [],
        businessTrip: { startAt: "2027-03-12T12:00:00.000Z", endAt: "2027-03-14T12:00:00.000Z" },
      },
    },
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));
jest.mock("../../../../src/hooks/useIntakeSchema", () => ({
  useTripIntakeSchemasByEvent: () => ({ data: new Map(), isLoading: false, isFetching: false, isError: false }),
}));
jest.mock("../../../../src/services/mixpanelService", () => ({ mixpanelService: { track: jest.fn() } }));
jest.mock("../../../../src/services/postHogService", () => ({ postHogService: { capture: jest.fn() } }));
jest.mock("../../../../src/components/ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../../src/components/checkout/CheckoutHeader", () => ({
  CheckoutHeader: () => null,
  CheckoutStatusBanner: ({ body }: { body: string }) => {
    const { Text } = jest.requireActual("react-native");
    const { createElement } = jest.requireActual("react");
    return createElement(Text, null, body);
  },
}));
jest.mock("@mingla/phone-input", () => ({
  PhoneInput: () => null,
  COUNTRIES: [{ code: "US", dialCode: "+1" }],
  getCountryByCode: (code: string) => ({ code, dialCode: "+1" }),
}));
jest.mock("react-native-keyboard-controller", () => {
  const { View } = jest.requireActual("react-native");
  return { KeyboardProvider: View, KeyboardToolbar: () => null, KeyboardAwareScrollView: View, useKeyboardHandler: () => undefined };
});
jest.mock("../../../../src/wrappers/SmartScrollView", () => ({ ScrollView: jest.requireActual("react-native").ScrollView }));
jest.mock("../../../../src/wrappers/useKeyboardIsVisible", () => ({ useKeyboardIsVisible: () => false }));
jest.mock("../../../../src/components/ui/Spinner", () => ({ Spinner: () => null }));
jest.mock("../../../../src/utils/hapticFeedback", () => ({
  HapticFeedback: { buttonPress: () => undefined, selection: () => undefined },
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CartProvider, useCart } from "../../../../src/components/checkout/CartContext";
import { color } from "../../../../src/components/checkout/checkoutTheme";
import { Button } from "../../../../src/components/ui/Button";
import { ticketQuoteFromLines } from "../../../../src/components/checkout/__tests__/ticketQuoteFixture";
import BuyerScreen from "../buyer";

/** Seeds the cart as the funnel does: one paid line, a ready quote, valid details. */
const SeedCart: React.FC<{ termsAccepted: boolean; depositCents: number | null }> = ({
  termsAccepted,
  depositCents,
}) => {
  const { setLineQuantity, setBuyer, setQuoteState } = useCart();
  React.useEffect(() => {
    const line = {
      ticketTypeId: TICKET_TYPE_ID,
      ticketName: "Shared room",
      unitPrice: 1200,
      unitPriceAllIn: 1200,
      currency: "USD",
      isFree: false,
      quantity: 1,
    };
    setLineQuantity(line);
    const quote = ticketQuoteFromLines([line]);
    setQuoteState(
      quote === null || depositCents === null ? quote : { ...quote, dueTodayNetCents: depositCents },
      "ready",
    );
    setBuyer({
      name: "Ada Guest",
      email: "ada@example.test",
      phone: "+14155550123",
      termsAccepted,
      marketingOptIn: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};

const mounted: Renderer[] = [];
afterEach(async () => {
  while (mounted.length > 0) {
    const tree = mounted.pop();
    if (tree !== undefined) await act(async () => tree.unmount());
  }
});

const mount = async (termsAccepted: boolean, depositCents: number | null = null): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    tree = TestRenderer.create(
      <QueryClientProvider client={client}>
        <CartProvider>
          <SeedCart termsAccepted={termsAccepted} depositCents={depositCents} />
          <BuyerScreen />
        </CartProvider>
      </QueryClientProvider>,
    );
  });
  // auth readiness resolves on a microtask after mount
  await act(async () => undefined);
  mounted.push(tree);
  return tree;
};

const textOf = (node: Node): string =>
  node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
const continueButton = (tree: Renderer): Node => {
  const found = tree.root.findAll((n) => n.type === Button && n.props.label === "Continue to payment");
  if (found.length !== 1) throw new Error(`expected one Continue button, found ${found.length}`);
  return found[0];
};
const isPressable = (n: Node): boolean =>
  n.type === "Pressable" || (n.type as { displayName?: string } | null)?.displayName === "Pressable";
const ancestors = (n: Node): Node[] => {
  const out: Node[] = [];
  for (let p = n.parent; p !== null; p = p.parent) out.push(p);
  return out;
};
const shows = (tree: Renderer, text: string): boolean =>
  tree.root.findAll((n) => n.type === "Text").some((n) => textOf(n) === text);

describe("trip checkout details step — Continue", () => {
  test("no Pressable wraps the Continue Button (disabled and enabled)", async () => {
    for (const termsAccepted of [false, true]) {
      const button = continueButton(await mount(termsAccepted));
      expect(button.props.disabled).toBe(!termsAccepted);
      expect(ancestors(button).filter(isPressable).length).toBe(0);
    }
  });

  test("a disabled Continue answers a tap through an overlay sibling that shows the consent hint", async () => {
    const tree = await mount(false);
    const button = continueButton(tree);
    const hint = tree.root.findAll(
      (n) => n.type === "Pressable" && n.props.testID === "checkout-trip-continue-disabled-hint",
    );
    expect(hint.length).toBe(1);
    // the overlay is the Button's sibling, not its ancestor
    expect(ancestors(button).includes(hint[0])).toBe(false);
    expect(StyleSheet.flatten(hint[0].props.style as never)).toEqual(StyleSheet.absoluteFill);
    expect(shows(tree, "Please agree to continue.")).toBe(false);
    await act(async () => (hint[0].props.onPress as () => void)());
    expect(shows(tree, "Please agree to continue.")).toBe(true);
  });

  test("an enabled Continue has no overlay", async () => {
    const tree = await mount(true);
    expect(
      tree.root.findAll((n) => n.props.testID === "checkout-trip-continue-disabled-hint").length,
    ).toBe(0);
  });
});

describe("trip checkout details step — Total due today is readable", () => {
  test("label and amount paint with the readable accent text token, not the orange fill", async () => {
    const tree = await mount(true, 30000);
    const label = tree.root.findAll((n) => n.type === "Text" && textOf(n) === "Total due today");
    expect(label.length).toBe(1);
    let row = label[0].parent as Node;
    while (row.type !== "View") row = row.parent as Node;
    const texts = row.findAll((n) => n.type === "Text");
    expect(texts.length).toBe(2);
    expect(textOf(texts[1])).toContain("300");
    expect(color.accentText).not.toBe(color.accent);
    for (const t of texts) {
      expect(StyleSheet.flatten(t.props.style as never)).toMatchObject({ color: color.accentText });
    }
  });
});
