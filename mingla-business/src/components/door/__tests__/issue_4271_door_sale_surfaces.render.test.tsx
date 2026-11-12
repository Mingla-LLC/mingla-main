/**
 * #4271 rework — the other door surfaces, rendered: the sale sheet's pay-code
 * total, the guest page's phone field, the scanner invite copy and the sale
 * detail of a refunded card sale. Services are mocked; the screens are real.
 */
import React from "react";

// react-test-renderer ships no types in this app.
interface ReactTestInstance {
  type: unknown;
  props: Record<string, any>;
  children: (ReactTestInstance | string)[];
  findAll: (predicate: (node: ReactTestInstance) => boolean) => ReactTestInstance[];
}
interface ReactTestRenderer {
  root: ReactTestInstance;
  unmount: () => void;
}
const renderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => ReactTestRenderer;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};
const { act } = renderer;

// Every tree a test mounts is unmounted after it, so no screen keeps polling or
// ticking once Jest tears the environment down (the lane must exit 0).
const mountedTrees: ReactTestRenderer[] = [];
const createTree = renderer.create;
renderer.create = (element: React.ReactElement): ReactTestRenderer => {
  const created = createTree(element);
  mountedTrees.push(created);
  return created;
};
afterEach(() => {
  act(() => {
    for (let tree = mountedTrees.pop(); tree; tree = mountedTrees.pop()) tree.unmount();
  });
});

let mockQuote: Record<string, unknown> = {};
const mockQuoteArgs: Array<Record<string, unknown>> = [];
let mockSales: unknown[] = [];
let mockTapAvailable = false;
const mockPush = jest.fn();
let mockParams: Record<string, string> = { id: "event-1", saleId: "sale-1", code: "K7Q2M9XA" };

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: jest.fn(), push: mockPush, back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../../../constants/publicUrls", () => ({
  BUSINESS_PUBLIC_ORIGIN: "https://host.usemingla.com",
}));
jest.mock("react-native-keyboard-controller", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }): React.ReactNode => children ?? null;
  return {
    KeyboardProvider: Passthrough,
    KeyboardToolbar: Passthrough,
    KeyboardAwareScrollView: Passthrough,
    useReanimatedKeyboardAnimation: () => ({ height: { value: 0 }, progress: { value: 0 } }),
    useKeyboardState: () => ({ isVisible: false }),
  };
});
jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(),
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: {},
  NotificationFeedbackType: {},
}));
jest.mock("../../../utils/deferAfterDismiss", () => ({
  deferAfterDismiss: (fn: () => void) => fn(),
}));
jest.mock("../../ui/Pill", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    Pill: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
  };
});
jest.mock("../../ui/EmptyState", () => ({ EmptyState: () => null }));
jest.mock("../../../services/supabase", () => ({
  supabase: { from: jest.fn(), rpc: jest.fn(), functions: { invoke: jest.fn() } },
}));
jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
    visible ? children : null,
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../tap/TapToPayIcon", () => ({ TapToPayIcon: () => null }));
jest.mock("../../../services/terminal/tapToPaySession", () => ({ getTapToPaySession: () => ({ readerReady: false }) }));
jest.mock("../../ui/IconChrome", () => ({ IconChrome: () => null }));
jest.mock("../../ui/Toast", () => ({ Toast: () => null }));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../../ui/SafeScreen", () => ({
  SafeScreen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../../ui/Input", () => ({ Input: () => null }));
jest.mock("../../ui/Button", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Text onPress={onPress}>{label}</Text>
    ),
  };
});
jest.mock("../DoorRefundSheet", () => ({ DoorRefundSheet: () => null }));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const { View } = jest.requireActual("react-native");
  return { ScrollView: View };
});
jest.mock("../../../services/postHogService", () => ({ postHogService: { capture: jest.fn() } }));
jest.mock("../../../services/consentService", () => ({ recordConsent: jest.fn() }));
jest.mock("../../../hooks/useManagedEventRoute", () => ({
  useManagedEventRoute: () => ({ event: { id: "event-1", name: "Night", tickets: [] }, brand: null }),
}));
jest.mock("../../../hooks/useTapToPayAvailability", () => ({
  useTapToPayAvailability: () => ({ available: mockTapAvailable, needsSetup: false }),
}));
jest.mock("../../../hooks/useEventDateKeys", () => ({
  useEventDateKeys: () => ({ data: [], isLoading: false }),
}));
jest.mock("../../../hooks/useScannerInvitations", () => ({
  useInviteScanner: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock("../../../hooks/useEventDoorSales", () => ({
  useRecordDoorSale: () => ({ mutateAsync: jest.fn() }),
  useCreateDoorPayCode: () => ({ mutateAsync: jest.fn() }),
  useCanTakeDoorPayment: () => ({ data: true, isError: false }),
  useDoorPayCodeQuote: (input: Record<string, unknown>) => {
    mockQuoteArgs.push(input);
    return mockQuote;
  },
  useEventDoorSales: () => ({ data: mockSales, isLoading: false }),
}));
jest.mock("../../../services/doorPayCodeService", () => {
  class DoorPayCodeError extends Error {}
  // The default guest view is a Stripe code, the case the guest-copy probes were
  // written for. A view a test hands in without naming a provider is a Stripe
  // view too; a test that names one (paystack, null) keeps it.
  const viewDefaults = { provider: "stripe", latePayment: null };
  const viewDoorPayCode = jest.fn().mockResolvedValue({
    ...viewDefaults,
    status: "open",
    eventId: "event-1",
    eventName: "Night",
    eventStartsAt: null,
    venueLabel: null,
    brandName: "Brand",
    lines: [{ ticketTypeId: "tier-1", name: "General", quantity: 1, unitCents: 1500 }],
    subtotalCents: 1500,
    feeCents: 70,
    totalCents: 1570,
    currency: "GBP",
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  const resolveOnce = viewDoorPayCode.mockResolvedValueOnce.bind(viewDoorPayCode);
  viewDoorPayCode.mockResolvedValueOnce = (value: unknown) =>
    resolveOnce({ ...viewDefaults, ...(value as Record<string, unknown>) });
  return {
    DoorPayCodeError,
    createDoorCodeCheckout: jest.fn(),
    viewDoorPayCode,
  };
});

// eslint-disable-next-line import/first
import { InviteScannerSheet } from "../../scanners/InviteScannerSheet";
// eslint-disable-next-line import/first
import DoorPayGuestPage from "../../../../app/pay/door/[code]";
// eslint-disable-next-line import/first
import DoorSaleDetailRoute from "../../../../app/event/[id]/door/[saleId]";

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join(" ");

const mount = (element: React.ReactElement): ReactTestRenderer => {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = renderer.create(element);
  });
  return tree as ReactTestRenderer;
};



describe("#4271 scanner invite copy", () => {
  const invite = (paymentProvider: "stripe" | "paystack" | null): string =>
    textOf(
      mount(
        <InviteScannerSheet
          visible
          event={null}
          brandId="brand-1"
          paymentProvider={paymentProvider}
          operatorAccountId="a"
          brandOnly
          onClose={jest.fn()}
          onSuccess={jest.fn()}
        />,
      ).root,
    );

  test("Stripe brands are told about Tap to Pay", () => {
    expect(invite("stripe")).toContain("Cash, manual, pay codes and Tap to Pay.");
  });

  test.each(["paystack", null] as const)("%s: no Tap to Pay promise", (provider) => {
    const text = invite(provider);
    expect(text).toContain("Cash, manual and pay codes.");
    expect(text).not.toContain("Tap to Pay");
  });
});

describe("#4271 guest page phone field", () => {
  test("announces required exactly once", async () => {
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(<DoorPayGuestPage />);
    });
    const labels = (tree as ReactTestRenderer).root
      .findAll(
        (n) =>
          typeof n.type === "string" &&
          typeof n.props.accessibilityLabel === "string" &&
          n.props.accessibilityLabel.startsWith("Mobile number"),
      )
      .map((n) => n.props.accessibilityLabel as string);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.match(/required/g) ?? []).toHaveLength(1);
    }
  });
});

describe("#4271 sale detail", () => {
  test("a refunded card sale reads refunded and offers no second refund", () => {
    mockSales = [
      {
        id: "sale-1",
        eventId: "event-1",
        brandId: "brand-1",
        recordedBy: "",
        buyerName: "Ada",
        buyerEmail: "",
        buyerPhone: "",
        paymentMethod: "pay_code",
        lines: [],
        totalGbpAtSale: 31.35,
        totalAtSale: 31.35,
        currency: "GBP",
        notes: "",
        recordedAt: "2026-11-04T20:00:00.000Z",
        status: "refunded_full",
        refundedAmountGbp: 31.35,
        refundedAmount: 31.35,
        refunds: [],
        minglaFeeAmount: 1.41,
      },
    ];
    const text = textOf(mount(<DoorSaleDetailRoute />).root);
    expect(text).toContain("REFUNDED");
    expect(text).toMatch(/Refunded\s+−\s*£31\.35/);
    expect(text).not.toContain("Refund to card");
  });
});

// Retest (head 44989e9be0) — open defects, red until the rework lands.
describe("#4271 retest: every amount shown is the amount charged", () => {
  afterEach(() => {
    mockTapAvailable = false;
    mockParams = { id: "event-1", saleId: "sale-1", code: "K7Q2M9XA" };
  });

  test("DEFECT: a fully refunded sale whose Mingla fee came back does not read as a loss", () => {
    mockSales = [
      {
        id: "sale-1",
        eventId: "event-1",
        brandId: "brand-1",
        recordedBy: "",
        buyerName: "Ada",
        buyerEmail: "",
        buyerPhone: "",
        paymentMethod: "tap_to_pay",
        lines: [],
        totalGbpAtSale: 30,
        totalAtSale: 30,
        currency: "GBP",
        notes: "",
        recordedAt: "2026-11-04T20:00:00.000Z",
        status: "refunded_full",
        refundedAmountGbp: 30,
        refundedAmount: 30,
        refunds: [],
        minglaFeeAmount: 1.35,
      },
    ];
    const text = textOf(mount(<DoorSaleDetailRoute />).root);
    expect(text).toMatch(/Net\s+£0\.00/);
  });

  test("T11: sale detail shows brand and last 4 when the provider gave them", () => {
    const base = {
      id: "sale-1", eventId: "event-1", brandId: "brand-1", recordedBy: "", buyerName: "Ada",
      buyerEmail: "", buyerPhone: "", paymentMethod: "tap_to_pay", lines: [], totalGbpAtSale: 30,
      totalAtSale: 30, currency: "GBP", notes: "", recordedAt: "2026-11-04T20:00:00.000Z",
      status: "completed", refundedAmountGbp: 0, refundedAmount: 0, refunds: [], minglaFeeAmount: 1.35,
    };
    mockSales = [{ ...base, cardBrand: "visa", cardLast4: "4242" }];
    expect(textOf(mount(<DoorSaleDetailRoute />).root)).toContain("Visa ending 4242");
    mockSales = [{ ...base, cardBrand: null, cardLast4: null }];
    expect(textOf(mount(<DoorSaleDetailRoute />).root)).not.toContain("ending");
  });

  const guestView = (over: Record<string, unknown>): Record<string, unknown> => ({
    status: "cancelled",
    latePayment: null,
    eventId: "event-1",
    eventName: "Night",
    eventStartsAt: null,
    venueLabel: null,
    brandName: "Brand",
    lines: [],
    subtotalCents: 3000,
    feeCents: 135,
    totalCents: 3135,
    currency: "GBP",
    expiresAt: "2099-01-01T00:00:00.000Z",
    provider: "stripe",
    ...over,
  });

  test("T3: a returning guest whose payment landed late is told the refund, with the full amount", async () => {
    const service = jest.requireMock("../../../services/doorPayCodeService") as { viewDoorPayCode: jest.Mock };
    mockParams = { code: "K7Q2M9XA", paid: "1" };
    service.viewDoorPayCode.mockResolvedValueOnce(
      guestView({ latePayment: { state: "refunding", amountCents: 3135, currency: "GBP" } }),
    );
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(<DoorPayGuestPage />);
    });
    const text = textOf((tree as ReactTestRenderer).root);
    expect(text).toContain("£31.35 is queued to go back to you");
    expect(text).not.toContain("weren't charged");
  });

  test("T3: a guest who never paid sees a closed code as not charged", async () => {
    const service = jest.requireMock("../../../services/doorPayCodeService") as { viewDoorPayCode: jest.Mock };
    mockParams = { code: "K7Q2M9XA" };
    service.viewDoorPayCode.mockResolvedValueOnce(guestView({}));
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(<DoorPayGuestPage />);
    });
    expect(textOf((tree as ReactTestRenderer).root)).toContain("You weren't charged.");
  });

  test("DEFECT: a guest returning from a paid provider page is never told they weren't charged", async () => {
    const service = jest.requireMock("../../../services/doorPayCodeService") as {
      viewDoorPayCode: jest.Mock;
    };
    mockParams = { code: "K7Q2M9XA", paid: "1" };
    service.viewDoorPayCode.mockResolvedValueOnce({
      status: "cancelled",
      eventId: "event-1",
      eventName: "Night",
      eventStartsAt: null,
      venueLabel: null,
      brandName: "Brand",
      lines: [],
      subtotalCents: 3000,
      feeCents: 135,
      totalCents: 3135,
      currency: "GBP",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(<DoorPayGuestPage />);
    });
    expect(textOf((tree as ReactTestRenderer).root)).not.toContain("weren't charged");
  });

  test.each([
    ["expired", "This code has expired"],
    ["cancelled", "The door cancelled this sale"],
  ])("P2-1: a Paystack guest on a %s code is told a late payment is refunded in full, never not charged", async (status, title) => {
    const service = jest.requireMock("../../../services/doorPayCodeService") as { viewDoorPayCode: jest.Mock };
    mockParams = { code: "PSKP2345" };
    service.viewDoorPayCode.mockResolvedValueOnce(guestView({ status, provider: "paystack", currency: "NGN" }));
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(<DoorPayGuestPage />);
    });
    const text = textOf((tree as ReactTestRenderer).root);
    expect(text).toContain(title);
    expect(text).toContain("If one still lands, it's refunded to you in full.");
    expect(text).not.toContain("weren't charged");
  });

  test("P2-1: a closed code whose provider the server didn't name never says not charged", async () => {
    const service = jest.requireMock("../../../services/doorPayCodeService") as { viewDoorPayCode: jest.Mock };
    mockParams = { code: "K7Q2M9XA" };
    service.viewDoorPayCode.mockResolvedValueOnce(guestView({ status: "expired", provider: null }));
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(<DoorPayGuestPage />);
    });
    expect(textOf((tree as ReactTestRenderer).root)).not.toContain("weren't charged");
  });
});

// #4271 door polish (design items 3, 4, 5, 8, 9): the sale sheet and the guest page, rendered.
describe("#4271 door polish: the guest pay page", () => {
  test("eyebrow names the event, no asterisks, autofill hints, the button says the amount", async () => {
    let tree: ReactTestRenderer | undefined;
    mockParams = { code: "K7Q2M9XA" };
    await act(async () => {
      tree = renderer.create(<DoorPayGuestPage />);
    });
    const root = (tree as ReactTestRenderer).root;
    const text = textOf(root);
    expect(text).toContain("PAY AT THE DOOR · NIGHT");
    expect(text).toContain("Continue to pay £15.70");
    expect(text).not.toContain("Continue to payment");
    expect(text).not.toContain("*");
    expect(text).not.toContain("Brand");
    const inputs = root.findAll((n) => typeof n.props.autoComplete === "string" && typeof n.props.onChangeText === "function");
    expect([...new Set(inputs.map((n) => n.props.autoComplete as string))].sort()).toEqual(["email", "name", "tel"]);
  });

  test.each([
    ["expired", "neutral"],
    ["cancelled", "neutral"],
    ["failed", "bad"],
  ])("a %s code shows the %s tone", async (status, tone) => {
    const service = jest.requireMock("../../../services/doorPayCodeService") as { viewDoorPayCode: jest.Mock };
    mockParams = { code: "K7Q2M9XA" };
    service.viewDoorPayCode.mockResolvedValueOnce({
      status,
      eventId: "event-1",
      eventName: "Night",
      eventStartsAt: null,
      venueLabel: null,
      brandName: "Brand",
      lines: [],
      subtotalCents: 3000,
      feeCents: 135,
      totalCents: 3135,
      currency: "GBP",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = renderer.create(<DoorPayGuestPage />);
    });
    expect((tree as ReactTestRenderer).root.findAll((n) => n.props.testID === `door-pay-guest-tone-${tone}`).length).toBeGreaterThan(0);
  });
});
