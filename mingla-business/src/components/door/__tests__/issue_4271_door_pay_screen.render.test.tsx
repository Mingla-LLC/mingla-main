/**
 * #4271 rework — the host's Scan to pay screen, rendered: the Guest row and the
 * end-state money copy come from the server, and "Show a new code" closes the
 * old code. Hooks are mocked at the query boundary; the screen itself is real.
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
const renderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => ReactTestRenderer;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};
const { act } = renderer;

const mockReplace = jest.fn();
const mockMutateAsync = jest.fn();
const mockRefetch = jest.fn();
let mockRow: Record<string, unknown> | null = null;
let mockLate: Record<string, unknown> = {};
let mockGuest: Record<string, unknown> = {};
const mockLateArgs: unknown[][] = [];
const mockGuestArgs: unknown[][] = [];

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  useLocalSearchParams: () => ({ id: "event-1", codeId: "code-1" }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../../../constants/publicUrls", () => ({
  BUSINESS_PUBLIC_ORIGIN: "https://host.usemingla.com",
}));
jest.mock("../DoorPayQr", () => ({ DoorPayQr: () => null }));
jest.mock("../../ui/IconChrome", () => ({ IconChrome: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Sheet", () => ({ Sheet: () => null }));
jest.mock("../../ui/PhoneField", () => ({
  PhoneField: () => null,
  usePhoneEntry: () => ({ reset: jest.fn(), e164: null, countryIso: "GB", isEmpty: true }),
}));
jest.mock("../../ui/Button", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    Button: ({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) => (
      <Text onPress={onPress} testID={testID}>
        {label}
      </Text>
    ),
  };
});
jest.mock("../../../utils/hapticFeedback", () => ({ HapticFeedback: { success: jest.fn() } }));
jest.mock("../../../hooks/useManagedEventRoute", () => ({
  useManagedEventRoute: () => ({ event: { name: "Afrobeats Night", tickets: [] } }),
}));
jest.mock("../../../services/doorPayCodeService", () => {
  class DoorPayCodeError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return { DoorPayCodeError };
});
jest.mock("../../../hooks/useEventDoorSales", () => ({
  useDoorPayCode: () => ({
    data: mockRow,
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
  }),
  useCreatedDoorPayCode: () => null,
  useCancelDoorPayCode: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useCreateDoorPayCode: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
  useTextDoorPayLink: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDoorPayLatePayment: (...args: unknown[]) => {
    mockLateArgs.push(args);
    return mockLate;
  },
  useDoorPayGuestName: (...args: unknown[]) => {
    mockGuestArgs.push(args);
    return mockGuest;
  },
}));

// eslint-disable-next-line import/first
import DoorPayCodeRoute from "../../../../app/event/[id]/door/pay/[codeId]";

const row = (status: string): Record<string, unknown> => ({
  id: "code-1",
  code: "K7Q2M9XA",
  status,
  lines: [{ ticketTypeId: "tier-1", quantity: 2 }],
  currency: "GBP",
  totalCents: 3135,
  expiresAt: new Date(Date.now() + (status === "expired" ? -60_000 : 600_000)).toISOString(),
  openedAt: null,
  eventDateId: null,
  orderId: status === "paid" ? "order-1" : null,
});

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");

const mount = (): ReactTestRenderer => {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = renderer.create(<DoorPayCodeRoute />);
  });
  return tree as ReactTestRenderer;
};

const screenText = (tree: ReactTestRenderer): string => textOf(tree.root);

describe("#4271 host Scan to pay screen", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockReplace.mockReset();
    mockMutateAsync.mockReset();
    mockRefetch.mockReset();
    mockLateArgs.length = 0;
    mockGuestArgs.length = 0;
    mockLate = { isSuccess: true, isError: false, data: null };
    mockGuest = { isSuccess: false, isError: false, data: undefined };
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("paid: Guest row shows the server's name", () => {
    mockRow = row("paid");
    mockGuest = { isSuccess: true, isError: false, data: "Ada Okafor" };
    const text = screenText(mount());
    expect(text).toContain("Guest");
    expect(text).toContain("Ada Okafor");
    expect(mockGuestArgs[0]).toEqual(["code-1", true]);
  });

  test("paid: no name from the server reads Walk-up", () => {
    mockRow = row("paid");
    mockGuest = { isSuccess: true, isError: false, data: null };
    expect(screenText(mount())).toContain("Walk-up");
  });

  test("paid: never Walk-up while the name is loading or failed", () => {
    mockRow = row("paid");
    mockGuest = { isSuccess: false, isError: false, data: undefined };
    expect(screenText(mount())).not.toContain("Walk-up");
    mockGuest = { isSuccess: false, isError: true, data: undefined };
    expect(screenText(mount())).not.toContain("Walk-up");
  });

  test.each(["expired", "cancelled"])("%s: nothing charged only when the server says so", (status) => {
    mockRow = row(status);
    mockLate = { isSuccess: true, isError: false, data: null };
    expect(screenText(mount())).toContain("Nothing was charged.");
    expect(mockLateArgs[0]).toEqual(["code-1", true]);

    mockLate = { isSuccess: false, isError: false, data: undefined };
    expect(screenText(mount())).not.toContain("Nothing was charged.");

    mockLate = { isSuccess: false, isError: true, data: undefined };
    expect(screenText(mount())).not.toContain("Nothing was charged.");
  });

  test.each(["expired", "cancelled"])("%s: a late payment is named with its refund", (status) => {
    mockRow = row(status);
    mockLate = {
      isSuccess: true,
      isError: false,
      data: { state: "refunding", amountCents: 3135, currency: "GBP" },
    };
    let text = screenText(mount());
    expect(text).not.toContain("Nothing was charged.");
    expect(text).toContain("We're refunding £31.35");

    mockLate = {
      isSuccess: true,
      isError: false,
      data: { state: "refunded", amountCents: 3135, currency: "GBP" },
    };
    text = screenText(mount());
    expect(text).not.toContain("Nothing was charged.");
    expect(text).toContain("£31.35 was refunded");
  });

  test("Show a new code closes the old code on the server", async () => {
    mockRow = row("expired");
    mockMutateAsync.mockResolvedValue({ codeId: "code-2" });
    const tree = mount();
    const button = tree.root.findAll(
      (n) => typeof n.props.onPress === "function" && textOf(n) === "Show a new code",
    )[0];
    await act(async () => {
      await button.props.onPress();
    });
    expect(mockMutateAsync).toHaveBeenCalledWith({
      eventId: "event-1",
      eventDateId: null,
      lines: [{ ticketTypeId: "tier-1", quantity: 2 }],
      replacesCodeId: "code-1",
    });
    expect(mockReplace).toHaveBeenCalledWith("/event/event-1/door/pay/code-2");
  });
});
