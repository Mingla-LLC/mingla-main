/**
 * issue #3281 S4 — an experience offers its add-ons in its cart, through
 * the same picker and cart line (`lines[].addOns`) as the event cart.
 *
 * Mounts the REAL experience cart screen inside the REAL CartProvider, with a ticket
 * whose reader payload carries one add-on. Once a guest holds a spot, the
 * add-on shows under it, and tapping "+" puts it on that line.
 *
 * FAILS-ON-REVERT: drop `buyerExtras: ticket.buyerExtras` from `ticketToStub`
 * (or the <CartTicketExtras> under the spot row) in
 * `app/checkout-experience/[experienceEventId]/index.tsx` -> red.
 */

import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Node = { props: Record<string, unknown> };
type Renderer = {
  root: { findAllByProps: (props: Record<string, unknown>) => Node[] };
  unmount: () => void;
};
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const EXPERIENCE_EVENT_ID = "32810000-0000-4000-8000-000000000011";
const TICKET_ID = "32810000-0000-4000-8000-000000000012";
const TASTING_ID = "32810000-0000-4000-8000-000000000013";

const router = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};
const invoke = jest.fn();
const assign = jest.fn();

const EXPERIENCE_FIXTURE = {
  id: EXPERIENCE_EVENT_ID,
  title: "Sunset sail",
  slug: "sunset-sail",
  brandSlug: "minglanigeria",
  currency: "USD",
  coverMediaUrl: null,
  coverMediaType: null,
  venueText: null,
  dates: [],
  whenMode: "single",
  recurrenceRule: null,
  options: [],
  ticket: {
    ticketTypeId: TICKET_ID,
    name: "Spot",
    priceCents: 0,
    currency: "USD",
    quantityTotal: null,
    isUnlimited: true,
    isFree: true,
    ticketsRemaining: null,
    priceAllInGbp: null,
    buyerExtras: [
      { id: TASTING_ID, name: "Wine tasting", priceCents: 1500, maxPerTicket: 1, isUnlimited: true },
    ],
  },
};

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL: "https://host.usemingla.com",
      },
    },
  },
}));
jest.mock(
  "react-native-svg",
  () => ({
    __esModule: true,
    default: () => null,
    Path: () => null,
    Circle: () => null,
  }),
  { virtual: true },
);
jest.mock("expo-router", () => ({
  useRouter: () => router,
  useLocalSearchParams: () => ({ experienceEventId: EXPERIENCE_EVENT_ID }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("../../../../src/services/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
jest.mock("../../../../src/hooks/usePublicExperience", () => ({
  usePublicExperienceById: () => ({
    data: { experience: EXPERIENCE_FIXTURE, brand: { theme: null, name: "Mingla" } },
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));
jest.mock("../../../../src/services/mixpanelService", () => ({
  mixpanelService: { track: jest.fn() },
}));
jest.mock("../../../../src/services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));
jest.mock("../../../../src/components/ui/Button", () => {
  const { Pressable } = require("react-native");
  return {
    Button: (
      props: { label: string; onPress: () => void; disabled?: boolean },
    ) => (
      <Pressable
        testID={`btn-${props.label}`}
        accessibilityRole="button"
        accessibilityLabel={props.label}
        onPress={props.disabled === true ? undefined : props.onPress}
      />
    ),
  };
});
jest.mock("../../../../src/components/ui/GlassCard", () => {
  const { View } = require("react-native");
  return {
    GlassCard: ({ children }: { children: React.ReactNode }) => (
      <View>{children}</View>
    ),
  };
});
jest.mock("../../../../src/components/ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../../src/components/ui/Toast", () => ({ Toast: () => null }));
jest.mock("../../../../src/components/checkout/CheckoutHeader", () => ({
  CheckoutHeader: () => null,
  CheckoutStatusBanner: ({ body }: { body: string }) => {
    const { Text } = jest.requireActual("react-native");
    const { createElement } = jest.requireActual("react");
    return createElement(Text, null, body);
  },
}));

jest.mock("../../../../src/components/buyer/BuyerConnectionNotice", () => ({
  BuyerConnectionNotice: () => null,
  preloadBuyerConnectionNotice: () => undefined,
}));
jest.mock("../../../../src/components/checkout/DiscountCodeField", () => ({
  CheckoutDiscountCodeField: () => null,
}));

import {
  CartProvider,
  useCart,
  type CartContextValue,
} from "../../../../src/components/checkout/CartContext";
import ExperienceCartScreen from "../index";

let cart: CartContextValue | null = null;
const Probe: React.FC = () => {
  cart = useCart();
  return null;
};

describe("#3281 S4 — the experience cart offers its add-ons", () => {
  test("a held spot (free) shows its paid add-on, and + puts it on the line", async () => {
    let tree!: Renderer;
    await act(async () => {
      tree = TestRenderer.create(
        <CartProvider>
          <Probe />
          <ExperienceCartScreen />
        </CartProvider>,
      );
    });
    expect(tree.root.findAllByProps({ testID: `issue-3281-cart-extras-${TICKET_ID}` })).toHaveLength(0);
    await act(async () =>
      cart!.setLineQuantity({
        ticketTypeId: TICKET_ID,
        ticketName: "Spot",
        unitPrice: 0,
        currency: "USD",
        isFree: true,
        quantity: 1,
      }),
    );
    expect(
      tree.root.findAllByProps({ testID: `issue-3281-cart-extras-${TICKET_ID}` }).length,
    ).toBeGreaterThan(0);
    const add = tree.root.findAllByProps({ accessibilityLabel: "Add one Wine tasting to Spot" });
    expect(add.length).toBeGreaterThan(0);
    await act(async () => (add[0].props.onPress as () => void)());
    expect(cart!.lines.find((l) => l.ticketTypeId === TICKET_ID)?.addOns).toEqual([
      { addOnId: TASTING_ID, quantity: 1 },
    ]);
    tree.unmount();
  });
});
