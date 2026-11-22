/**
 * issue #3281 — an experience offers its add-ons in its cart, through
 * the same picker and cart line (`lines[].addOns`) as the event cart. The
 * picker loads on use (its chunk is fetched only when the add-ons flag is on
 * and the ticket carries add-ons), so nothing shows while the flag is off.
 *
 * Mounts the REAL experience cart screen inside the REAL CartProvider, with a ticket
 * whose reader payload carries one add-on. Once a guest holds a spot, the
 * add-on shows under it, and tapping "+" puts it on that line.
 *
 * Checkpoint 15, end to end: the checkout reads the experience by id from its
 * tables, which carry no add-ons; getPublicExperienceById takes each ticket's
 * `extras` from the public reader call it already makes for the stops. The
 * last case runs that REAL service on a reader payload, mounts the screen on
 * its result, picks the add-on, and sends the REAL quote: the request's line
 * carries `addOns`.
 *
 * FAILS-ON-REVERT: drop `buyerExtras: ticket.buyerExtras` from `ticketToStub`
 * (or the <CartTicketExtras> under the spot row) in
 * `app/checkout-experience/[experienceEventId]/index.tsx` -> red; drop
 * `buyerExtras: input.addOnsById?.[row.id]` (or the reader's addOnsById) in
 * publicExperienceService -> the end-to-end case reds.
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
// A chainable stand-in for the anon reads getPublicExperienceById makes: each
// table answers with its fixture rows, each RPC with its fixture payload.
const tableRows: Record<string, unknown> = {};
const rpcData: Record<string, unknown> = {};
const chain = (table: string): unknown => {
  const result = { data: tableRows[table] ?? null, error: null };
  const self: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(ok, bad),
  };
  for (const m of ["select", "eq", "in", "is", "order", "limit", "neq"]) self[m] = () => self;
  self.maybeSingle = () => Promise.resolve(result);
  self.single = () => Promise.resolve(result);
  return self;
};
jest.mock("../../../../src/services/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    from: (table: string) => chain(table),
    rpc: (name: string) => Promise.resolve({ data: rpcData[name] ?? null, error: null }),
  },
}));
const mockExperience: { current: unknown } = { current: null };
jest.mock("../../../../src/hooks/usePublicExperience", () => ({
  usePublicExperienceById: () => ({
    data: mockExperience.current ?? { experience: EXPERIENCE_FIXTURE, brand: { theme: null, name: "Mingla" } },
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

import {
  CartProvider,
  useCart,
  type CartContextValue,
} from "../../../../src/components/checkout/CartContext";
import ExperienceCartScreen from "../index";
import { getPublicExperienceById } from "../../../../src/services/publicExperienceService";
import { quoteTicketCheckout } from "../../../../src/services/ticketQuoteService";

let cart: CartContextValue | null = null;
const Probe: React.FC = () => {
  cart = useCart();
  return null;
};

describe("#3281 — the experience cart offers its add-ons", () => {
  afterEach(() => {
    mockFlags.extras = true;
    mockExperience.current = null;
    invoke.mockReset();
  });

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
    await flushLazy();
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

  test("with the add-ons flag off nothing shows", async () => {
    mockFlags.extras = false;
    let tree!: Renderer;
    await act(async () => {
      tree = TestRenderer.create(
        <CartProvider>
          <Probe />
          <ExperienceCartScreen />
        </CartProvider>,
      );
    });
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
    await flushLazy();
    expect(tree.root.findAllByProps({ testID: `issue-3281-cart-extras-${TICKET_ID}` })).toHaveLength(0);
    tree.unmount();
  });

  test("end to end: reader payload -> service -> picker -> cart line -> quote request", async () => {
    tableRows.events = {
      id: EXPERIENCE_EVENT_ID,
      brand_id: "b-1",
      title: "Sunset sail",
      slug: "sunset-sail",
      status: "published",
      visibility: "public",
      timezone: "UTC",
      theme: null,
      brands: { id: "b-1", slug: "minglanigeria", name: "Mingla" },
    };
    tableRows.ticket_types = [
      { id: TICKET_ID, name: "Spot", price_cents: 0, currency: "USD", is_unlimited: true, is_free: true, display_order: 0 },
    ];
    tableRows.event_dates = [];
    rpcData.pg_public_experience_by_slug = {
      stops: [],
      ticket: {
        ticketTypeId: TICKET_ID,
        name: "Spot",
        extras: [{ id: TASTING_ID, name: "Wine tasting", priceCents: 1500, maxPerTicket: 1, isUnlimited: true }],
      },
    };
    const payload = await getPublicExperienceById(EXPERIENCE_EVENT_ID);
    expect(payload?.experience.ticket?.buyerExtras).toEqual([
      { id: TASTING_ID, name: "Wine tasting", priceCents: 1500, maxPerTicket: 1, isUnlimited: true },
    ]);
    mockExperience.current = payload;

    let tree!: Renderer;
    await act(async () => {
      tree = TestRenderer.create(
        <CartProvider>
          <Probe />
          <ExperienceCartScreen />
        </CartProvider>,
      );
    });
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
    await flushLazy();
    const add = tree.root.findAllByProps({ accessibilityLabel: "Add one Wine tasting to Spot" });
    expect(add.length).toBeGreaterThan(0);
    await act(async () => (add[0].props.onPress as () => void)());
    const line = cart!.lines.find((l) => l.ticketTypeId === TICKET_ID);
    expect(line?.addOns).toEqual([{ addOnId: TASTING_ID, quantity: 1 }]);

    invoke.mockReset();
    invoke.mockResolvedValue({ data: { totalCents: 1500 }, error: null });
    await quoteTicketCheckout({
      eventId: EXPERIENCE_EVENT_ID,
      buyer: cart!.buyer,
      lines: cart!.lines,
      surface: "web",
    });
    const quoteCall = invoke.mock.calls.find((c) => c[0] === "ticket-checkout-create");
    const body = (quoteCall?.[1] as { body: { mode: string; lines: Array<Record<string, unknown>> } }).body;
    expect(body.mode).toBe("quote");
    expect(body.lines).toEqual([
      expect.objectContaining({ ticketTypeId: TICKET_ID, quantity: 1, addOns: [{ addOnId: TASTING_ID, quantity: 1 }] }),
    ]);
    tree.unmount();
  });
});
