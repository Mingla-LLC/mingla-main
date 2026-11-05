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
}
const renderer = jest.requireActual("react-test-renderer") as {
  create: (element: React.ReactElement) => ReactTestRenderer;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};
const { act } = renderer;

let mockQuote: Record<string, unknown> = {};
const mockQuoteArgs: Array<Record<string, unknown>> = [];
let mockSales: unknown[] = [];

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ id: "event-1", saleId: "sale-1", code: "K7Q2M9XA" }),
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
  useTapToPayAvailability: () => ({ available: false, needsSetup: false }),
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
  return {
    DoorPayCodeError,
    createDoorCodeCheckout: jest.fn(),
    viewDoorPayCode: jest.fn().mockResolvedValue({
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
    }),
  };
});

// eslint-disable-next-line import/first
import { DoorSaleNewSheet } from "../DoorSaleNewSheet";
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

const tier = {
  id: "tier-1",
  name: "General",
  isFree: false,
  priceGbp: 15,
  currency: "GBP",
  visibility: "public",
  availableAt: "both",
  displayOrder: 0,
  validDayIds: null,
};

const sheet = (): React.ReactElement => (
  <DoorSaleNewSheet
    visible
    event={{ id: "event-1", currency: "GBP", tickets: [tier] } as never}
    onClose={jest.fn()}
    onSuccess={jest.fn()}
    initialLines={[{ ticketTypeId: "tier-1", quantity: 2 }]}
    brand={null}
  />
);

describe("#4271 sale sheet, pay code total", () => {
  beforeEach(() => {
    mockQuoteArgs.length = 0;
  });

  test("the server's total incl. fees, once quoted", () => {
    mockQuote = {
      data: { totalCents: 3135, subtotalCents: 3000, feeCents: 135, currency: "GBP" },
      isLoading: false,
    };
    const text = textOf(mount(sheet()).root);
    expect(text).toContain("Total incl. fees");
    expect(text).toContain("£31.35");
    expect(mockQuoteArgs[mockQuoteArgs.length - 1]).toMatchObject({
      eventId: "event-1",
      enabled: true,
    });
  });

  test.each([
    ["loading", { data: undefined, isLoading: true }],
    ["offline", { data: undefined, isLoading: false, isError: true }],
  ])("%s: only the tickets' subtotal, never a made-up fee", (_label, query) => {
    mockQuote = query;
    const text = textOf(mount(sheet()).root);
    expect(text).not.toContain("Total incl. fees");
    expect(text).toContain("Tickets");
    expect(text).toContain("£30.00");
    expect(text).not.toContain("£31.35");
  });
});

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
