/**
 * issue #3281 — trip packages offer their add-ons in the trip cart, through
 * the same picker and cart line (`lines[].addOns`) as the event cart. The
 * picker loads on use (its chunk is fetched only when the add-ons flag is on
 * and a package carries add-ons), so nothing shows while the flag is off.
 *
 * Mounts the REAL trip cart screen inside the REAL CartProvider, with a package
 * whose reader payload carries one add-on. Once a traveler holds the package,
 * the add-on shows under it, and tapping "+" puts it on that package's line.
 * A package with no add-ons shows no picker.
 *
 * Checkpoint 15: the trip-by-id read the checkout uses carries no add-ons, so
 * they come from the public trip reader (useTripCheckoutAddOns): seeded from
 * the trip page's cached payload when there is one, otherwise read once.
 *
 * FAILS-ON-REVERT: drop `buyerExtras: tier.buyerExtras` from `tierToTicketStub`
 * (or the <CartTicketExtras> under the package row, or the flag in
 * `showAddOnPicker`) in `app/checkout-trip/[tripEventId]/index.tsx` -> red;
 * drop the reader overlay (`addOns?.[tier.ticketTypeId]`) or the trip page
 * cache seed in useTripCheckoutAddOns -> the reader cases red.
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

const TRIP_EVENT_ID = "32810000-0000-4000-8000-000000000001";
const PACKAGE_ID = "32810000-0000-4000-8000-000000000002";
const PLAIN_PACKAGE_ID = "32810000-0000-4000-8000-000000000003";
const TRANSFER_ID = "32810000-0000-4000-8000-000000000004";

const BRAND_SLUG = "minglanigeria";
const TRIP_SLUG = "lagos-long-weekend";
const TRANSFER = {
  id: TRANSFER_ID,
  name: "Airport transfer",
  priceCents: 2500,
  priceAllInCents: 2600,
  maxPerTicket: 2,
  isUnlimited: true,
};

const router = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};
const invoke = jest.fn();
const rpc = jest.fn();

const tier = (ticketTypeId: string, name: string, extras?: unknown) => ({
  id: `tier-${ticketTypeId}`,
  eventId: TRIP_EVENT_ID,
  ticketTypeId,
  tierName: name,
  tierMetadata: {},
  priceCents: 50000,
  currency: "USD",
  quantityTotal: 10,
  ticketsRemaining: 10,
  isUnlimited: false,
  installmentSchedule: null,
  description: null,
  priceAllInGbp: null,
  ...(extras !== undefined ? { buyerExtras: extras } : {}),
});

const tripFixture = (withExtras: boolean) => ({
  id: TRIP_EVENT_ID,
  title: "Lagos long weekend",
  slug: TRIP_SLUG,
  brandSlug: BRAND_SLUG,
  currency: "USD",
  pricingTiers: [
    tier(PACKAGE_ID, "Shared room", withExtras ? [TRANSFER] : undefined),
    tier(PLAIN_PACKAGE_ID, "Private room"),
  ],
  businessTrip: { startAt: "2027-03-01T00:00:00.000Z", endAt: "2027-03-04T23:59:59.000Z" },
});
// The trip-by-id read: with extras (older fixture) or, as in production, without.
const mockTrip = { withExtras: true };

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
  useLocalSearchParams: () => ({ tripEventId: TRIP_EVENT_ID }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("../../../../src/services/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));
jest.mock("../../../../src/hooks/usePublicTripById", () => ({
  usePublicTripById: () => ({
    data: { trip: tripFixture(mockTrip.withExtras) },
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));
jest.mock("../../../../src/hooks/useIntakeSchema", () => ({
  useTripIntakeSchemasByEvent: () => ({
    // tripIntakeState expects a Map (ticketTypeId → schema), not an array.
    data: new Map(),
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
jest.mock("../../../../src/components/trip/TripPaymentChoice", () => ({
  TripPaymentChoice: () => null,
}));

jest.mock("../../../../src/components/buyer/BuyerConnectionNotice", () => ({
  BuyerConnectionNotice: () => null,
  preloadBuyerConnectionNotice: () => undefined,
}));
jest.mock("../../../../src/components/checkout/DiscountCodeField", () => ({
  CheckoutDiscountCodeField: () => null,
}));

// #3281 — the picker is behind the add-ons flag; tests flip it per case.
const mockFlags = { extras: true };
jest.mock("../../../../src/config/featureFlags", () => {
  const actual = jest.requireActual("../../../../src/config/featureFlags");
  return {
    ...actual,
    featureFlags: new Proxy(actual.featureFlags, {
      get: (target: Record<string, unknown>, key: string) =>
        key === "extras" ? mockFlags.extras : target[key],
    }),
  };
});

/** The picker loads on use (React.lazy): let its chunk resolve. */
const flushLazy = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { tripKeys } from "../../../../src/hooks/tripKeys";
import {
  CartProvider,
  useCart,
  type CartContextValue,
} from "../../../../src/components/checkout/CartContext";
import TripCartScreen from "../index";

let cart: CartContextValue | null = null;
const Probe: React.FC = () => {
  cart = useCart();
  return null;
};

const holdPackage = (ticketTypeId: string, ticketName: string) =>
  cart!.setLineQuantity({
    ticketTypeId,
    ticketName,
    unitPrice: 500,
    currency: "USD",
    isFree: false,
    quantity: 1,
    paymentPlanChoice: "full",
  });

const mount = async (client: QueryClient = new QueryClient()): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <QueryClientProvider client={client}>
        <CartProvider>
          <Probe />
          <TripCartScreen />
        </CartProvider>
      </QueryClientProvider>,
    );
  });
  return tree;
};

describe("#3281 — the trip cart offers each package's add-ons", () => {
  afterEach(() => {
    cart = null;
    mockFlags.extras = true;
    mockTrip.withExtras = true;
    rpc.mockReset();
  });

  test("a held package shows its add-on, and + puts it on that package's line", async () => {
    const tree = await mount();
    expect(tree.root.findAllByProps({ testID: `issue-3281-cart-extras-${PACKAGE_ID}` })).toHaveLength(0);
    await act(async () => holdPackage(PACKAGE_ID, "Shared room"));
    await flushLazy();
    expect(
      tree.root.findAllByProps({ testID: `issue-3281-cart-extras-${PACKAGE_ID}` }).length,
    ).toBeGreaterThan(0);
    const add = tree.root.findAllByProps({
      accessibilityLabel: "Add one Airport transfer to Shared room",
    });
    expect(add.length).toBeGreaterThan(0);
    await act(async () => (add[0].props.onPress as () => void)());
    const line = cart!.lines.find((l) => l.ticketTypeId === PACKAGE_ID);
    expect(line?.addOns).toEqual([{ addOnId: TRANSFER_ID, quantity: 1 }]);
    tree.unmount();
  });

  test("a package with no add-ons shows no picker", async () => {
    const tree = await mount();
    await act(async () => holdPackage(PLAIN_PACKAGE_ID, "Private room"));
    expect(
      tree.root.findAllByProps({ testID: `issue-3281-cart-extras-${PLAIN_PACKAGE_ID}` }),
    ).toHaveLength(0);
    expect(cart!.lines.find((l) => l.ticketTypeId === PLAIN_PACKAGE_ID)?.addOns).toBeUndefined();
    tree.unmount();
  });

  test("with the add-ons flag off nothing shows, even for a package with add-ons", async () => {
    mockFlags.extras = false;
    const tree = await mount();
    await act(async () => holdPackage(PACKAGE_ID, "Shared room"));
    await flushLazy();
    expect(tree.root.findAllByProps({ testID: `issue-3281-cart-extras-${PACKAGE_ID}` })).toHaveLength(0);
    expect(
      tree.root.findAllByProps({ accessibilityLabel: "Add one Airport transfer to Shared room" }),
    ).toHaveLength(0);
    tree.unmount();
  });

  test("the trip-by-id read has none: the public trip reader supplies them, and + puts the add-on on the line", async () => {
    mockTrip.withExtras = false;
    rpc.mockResolvedValue({
      data: { tiers: [{ ticketTypeId: PACKAGE_ID, extras: [TRANSFER] }, { ticketTypeId: PLAIN_PACKAGE_ID }] },
      error: null,
    });
    const tree = await mount();
    await act(async () => holdPackage(PACKAGE_ID, "Shared room"));
    await flushLazy();
    expect(rpc).toHaveBeenCalledWith("pg_public_trip_by_slug", {
      p_brand_slug: BRAND_SLUG,
      p_event_slug: TRIP_SLUG,
    });
    const add = tree.root.findAllByProps({ accessibilityLabel: "Add one Airport transfer to Shared room" });
    expect(add.length).toBeGreaterThan(0);
    await act(async () => (add[0].props.onPress as () => void)());
    expect(cart!.lines.find((l) => l.ticketTypeId === PACKAGE_ID)?.addOns).toEqual([
      { addOnId: TRANSFER_ID, quantity: 1 },
    ]);
    tree.unmount();
  });

  test("coming from the trip page, its cached payload supplies them without a second read", async () => {
    mockTrip.withExtras = false;
    const client = new QueryClient();
    client.setQueryData(tripKeys.publicBySlug(BRAND_SLUG, TRIP_SLUG), {
      trip: { pricingTiers: [{ ticketTypeId: PACKAGE_ID, buyerExtras: [TRANSFER] }] },
    });
    const tree = await mount(client);
    await act(async () => holdPackage(PACKAGE_ID, "Shared room"));
    await flushLazy();
    expect(rpc).not.toHaveBeenCalled();
    expect(
      tree.root.findAllByProps({ accessibilityLabel: "Add one Airport transfer to Shared room" }).length,
    ).toBeGreaterThan(0);
    tree.unmount();
  });

  test("a failed reader read shows no add-ons and still sells the package", async () => {
    mockTrip.withExtras = false;
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const tree = await mount(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    await act(async () => holdPackage(PACKAGE_ID, "Shared room"));
    await flushLazy();
    expect(tree.root.findAllByProps({ testID: `issue-3281-cart-extras-${PACKAGE_ID}` })).toHaveLength(0);
    expect(cart!.lines.find((l) => l.ticketTypeId === PACKAGE_ID)?.quantity).toBe(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    tree.unmount();
  });

  test("with the add-ons flag off the reader is never called", async () => {
    mockFlags.extras = false;
    mockTrip.withExtras = false;
    const tree = await mount();
    await act(async () => holdPackage(PACKAGE_ID, "Shared room"));
    await flushLazy();
    expect(rpc).not.toHaveBeenCalled();
    tree.unmount();
  });
});
