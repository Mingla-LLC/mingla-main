/**
 * issue #3281 W-8 — with the free-parent switch off the server refuses a paid
 * add-on on a free ticket. After that answer the cart stops offering paid add-ons
 * on free tickets and takes the paid ones off.
 *
 * The rule's own helpers are called directly, and the REAL event checkout cart
 * step (app/checkout/[eventId]/index.tsx, harness from the #4420 / #2338 suites)
 * is mounted inside the REAL CartProvider with the server's refusal in the cart
 * state; the add-on picker is replaced by a recorder of the ticket it is handed.
 *
 * FAILS ON REVERT: stop passing `offerable(ticket)` to the picker, or drop the
 * effect that calls `withoutPaidAddOnsOnFreeLines` on the refusal.
 */
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Renderer = {
  root: unknown;
  toJSON: () => unknown;
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const EVENT_ID = "3281aaaa-0000-4000-8000-000000000001";

const CHECKOUT_TERMINAL_SOURCE = {
  kind: "occurrences" as const,
  value: [
    {
      id: "lifecycle-3281",
      startAt: "2099-09-12T19:00:00+00:00",
      endAt: "2099-09-12T22:00:00+00:00",
      timezone: "Africa/Lagos",
      isMaster: true,
    },
  ],
};
const checkoutTerminalSource = CHECKOUT_TERMINAL_SOURCE;
let publicEventData: unknown = null;
const routeParams: Record<string, string> = { eventId: EVENT_ID };
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const mockOfferedExtras = new Map<string, unknown>();

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: { EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL: "https://host.usemingla.com" },
    },
  },
}));
jest.mock("expo-router", () => ({
  useRouter: () => router,
  useLocalSearchParams: () => routeParams,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock(
  "react-native-svg",
  () => ({ __esModule: true, default: () => null, Path: () => null, Circle: () => null }),
  { virtual: true },
);
jest.mock("../../../hooks/usePublicEvents", () => ({
  usePublicEventById: () => ({
    data:
      publicEventData === null
        ? null
        : {
            ...(publicEventData as Record<string, unknown>),
            terminalSource: checkoutTerminalSource,
          },
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));
jest.mock("../../../analytics/webAnalytics", () => ({
  captureWeb: jest.fn(),
  gaEvent: jest.fn(),
}));
jest.mock("@mingla/offering-rendering", () => ({
  ...jest.requireActual("../../../../__manual_mocks__/offering-rendering.js"),
  ...jest.requireActual(
    "../../../../../packages/offering-rendering/eventAcquisitionLifecycle",
  ),
}));
jest.mock("../../../components/ui/EventCoverMedia", () => {
  const ReactLocal = require("react");
  return {
    EventCoverMedia: (props: Record<string, unknown>) =>
      ReactLocal.createElement("MockEventCoverMedia", props),
  };
});
jest.mock("../../ui/EmptyState", () => ({ EmptyState: () => null }));
jest.mock("../../../components/ui/Button", () => {
  const { Pressable } = require("react-native");
  return {
    Button: (props: { label: string; onPress?: () => void }) => (
      <Pressable accessibilityLabel={props.label} onPress={props.onPress} />
    ),
  };
});
jest.mock("../../../components/checkout/CheckoutHeader", () => ({
  CheckoutHeader: () => null,
}));
jest.mock("../../../components/checkout/QuantityRow", () => ({
  QuantityRow: () => null,
}));
jest.mock("../../../components/waitlist/JoinWaitlistSheet", () => ({
  JoinWaitlistSheet: () => null,
}));
jest.mock("../CartTicketExtras", () => ({
  CartTicketExtras: (props: { ticket: { id: string; buyerExtras?: unknown } }) => {
    mockOfferedExtras.set(props.ticket.id, props.ticket.buyerExtras);
    return null;
  },
}));

/* eslint-disable import/first */
import { parsePublicTicketExtras } from "@mingla/offering-rendering/ticketExtrasCart";
import {
  extrasOfferableOnTicket,
  FREE_PARENT_REFUSAL,
  withoutPaidAddOnsOnFreeLines,
} from "../freeParentAddOnsNote";
import { CartProvider, useCart, type CartLine } from "../CartContext";
import CartScreen from "../../../../app/checkout/[eventId]/index";
/* eslint-enable import/first */

const raw = (id: string, priceCents: number) => ({
  id,
  name: id,
  description: null,
  priceCents,
  priceAllInCents: priceCents,
  maxPerTicket: 2,
  isUnlimited: true,
  validOccurrenceIds: null,
  remaining: null,
});
const extras = [raw("free-snack", 0), raw("paid-drink", 800)];

describe("issue #3281 W-8 — paid add-on on a free ticket", () => {
  test("before a refusal everything is offered", () => {
    expect(extrasOfferableOnTicket(extras, true, false)).toBe(extras);
  });
  test("after the refusal a free ticket offers only the free add-on", () => {
    const out = extrasOfferableOnTicket(extras, true, true) as unknown[];
    expect(out).toHaveLength(1);
    expect((out[0] as { id: string }).id).toBe("free-snack");
  });
  test("a paid ticket keeps its paid add-ons after the refusal", () => {
    expect(extrasOfferableOnTicket(extras, false, true)).toBe(extras);
  });
  test("the paid add-on comes off the free line, the free one stays", () => {
    const lines = [
      {
        ticketTypeId: "t1",
        isFree: true,
        addOns: [
          { addOnId: "free-snack", quantity: 1 },
          { addOnId: "paid-drink", quantity: 1 },
        ],
      },
      { ticketTypeId: "t2", isFree: false, addOns: [{ addOnId: "paid-drink", quantity: 1 }] },
    ];
    const byTicket = new Map([
      ["t1", parsePublicTicketExtras(extras)],
      ["t2", parsePublicTicketExtras(extras)],
    ]);
    const next = withoutPaidAddOnsOnFreeLines(lines, byTicket);
    expect(next).not.toBeNull();
    expect(next![0].addOns).toEqual([{ addOnId: "free-snack", quantity: 1 }]);
    expect(next![1]).toBe(lines[1]);
  });
  test("nothing to take off -> null (no loop)", () => {
    const lines = [{ ticketTypeId: "t1", isFree: true, addOns: [{ addOnId: "free-snack", quantity: 1 }] }];
    expect(
      withoutPaidAddOnsOnFreeLines(lines, new Map([["t1", parsePublicTicketExtras(extras)]])),
    ).toBeNull();
  });
  test("the refusal code is the one the server sends", () => {
    expect(FREE_PARENT_REFUSAL).toBe("extras_need_paid_ticket");
  });
});

// ---- the REAL event checkout cart step -------------------------------------

const FREE_TICKET = {
  id: "tt-free",
  name: "Free Entry",
  priceGbp: null,
  currency: "USD",
  capacity: null,
  isFree: true,
  isUnlimited: true,
  visibility: "public",
  displayOrder: 0,
  availableAt: "online",
  saleStartAt: null,
  saleEndAt: null,
  waitlistEnabled: false,
  buyerExtras: extras,
};
const EVENT = {
  id: EVENT_ID,
  name: "Lagos One Night",
  brandSlug: "minglanigeria",
  eventSlug: "lagos-one-night",
  currency: "USD",
  themeOverrides: null,
  tickets: [FREE_TICKET],
  coverHue: 24,
  coverMediaUrl: null,
  coverMediaType: null,
  status: "scheduled",
  endedAt: null,
  cancelledAt: null,
  whenMode: "single",
  date: "2099-09-12",
  doorsOpen: "20:00",
  endsAt: "23:00",
  masterStartAtUtc: null,
  masterEndAtUtc: null,
  timezone: "Africa/Lagos",
  recurrenceRule: null,
  multiDates: null,
};

let mockLines: readonly CartLine[] = [];
/** Puts a free line carrying a free and a paid add-on in the cart, then has the server refuse it. */
const SeedCart: React.FC<{ refusal: string | null }> = ({ refusal }) => {
  const cart = useCart();
  mockLines = cart.lines;
  const { setLineQuantity, setQuoteState } = cart;
  React.useEffect(() => {
    setLineQuantity({
      ticketTypeId: "tt-free",
      ticketName: "Free Entry",
      unitPrice: 0,
      unitPriceAllIn: 0,
      currency: "USD",
      isFree: true,
      quantity: 1,
      addOns: [
        { addOnId: "free-snack", quantity: 1 },
        { addOnId: "paid-drink", quantity: 1 },
      ],
    } as never);
    if (refusal !== null) setQuoteState(null, "error", refusal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};

const mountCart = async (refusal: string | null): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <CartProvider>
        <SeedCart refusal={refusal} />
        <CartScreen />
      </CartProvider>,
    );
  });
  // the add-on picker is loaded on use (React.lazy)
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  return tree;
};

const offeredIds = (): string[] =>
  ((mockOfferedExtras.get("tt-free") as Array<{ id: string }> | undefined) ?? []).map((e) => e.id);
const lineAddOnIds = (): string[] =>
  (mockLines.find((l) => l.ticketTypeId === "tt-free")?.addOns ?? []).map((a) => a.addOnId);

describe("issue #3281 W-8 — the event checkout acts on the refusal", () => {
  beforeEach(() => {
    mockOfferedExtras.clear();
    mockLines = [];
    publicEventData = {
      event: EVENT,
      brand: { displayName: "Capture Co", theme: null },
      occurrences: [],
      multiDatePricingMode: "per_day",
    };
  });

  test("before any refusal the free ticket offers both add-ons and keeps both", async () => {
    const tree = await mountCart(null);
    expect(offeredIds()).toEqual(["free-snack", "paid-drink"]);
    expect(lineAddOnIds()).toEqual(["free-snack", "paid-drink"]);
    await act(async () => tree.unmount());
  });

  test("after the server's refusal the picker offers only the free add-on", async () => {
    const tree = await mountCart("extras_need_paid_ticket");
    expect(offeredIds()).toEqual(["free-snack"]);
    await act(async () => tree.unmount());
  });

  test("after the server's refusal the paid add-on comes off the cart line, the free one stays", async () => {
    const tree = await mountCart("extras_need_paid_ticket");
    expect(lineAddOnIds()).toEqual(["free-snack"]);
    await act(async () => tree.unmount());
  });
});
