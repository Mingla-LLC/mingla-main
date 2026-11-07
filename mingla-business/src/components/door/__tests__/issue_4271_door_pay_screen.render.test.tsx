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

const mockReplace = jest.fn();
const mockMutateAsync = jest.fn();
const mockCancel = jest.fn();
const mockSettle = jest.fn();
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
const mockAwake = jest.fn();
jest.mock("../../../hooks/useDoorScreenAwake", () => ({
  useDoorScreenAwake: (active: boolean) => mockAwake(active),
}));
jest.mock("../../../utils/hapticFeedback", () => ({ HapticFeedback: { success: jest.fn() } }));
jest.mock("../../../hooks/useManagedEventRoute", () => ({
  useManagedEventRoute: () => ({ event: { name: "Afrobeats Night", tickets: [] } }),
}));
jest.mock("../../../services/doorPayCodeService", () => {
  class DoorPayCodeError extends Error {
    code: string;
    status: number | null;
    codeStatus: string | null;
    constructor(code: string, status: number | null = null, codeStatus: string | null = null) {
      super(code);
      this.code = code;
      this.status = status;
      this.codeStatus = codeStatus;
    }
  }
  return { DoorPayCodeError };
});
jest.mock("../../../hooks/useEventDoorSales", () => ({
  useCreateDoorPayCode: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));
jest.mock("../../../hooks/useDoorPayCodes", () => ({
  useDoorPayCode: () => ({
    data: mockRow,
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
  }),
  useCreatedDoorPayCode: () => null,
  useCancelDoorPayCode: () => ({ mutateAsync: mockCancel, isPending: false }),
  useSettleDoorPayCode: () => ({ mutateAsync: mockSettle, isPending: false }),
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
  provider: "stripe",
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
    mockCancel.mockReset();
    mockSettle.mockReset();
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
    // T15: the refund may be queued and not sent, so the copy never says it's done.
    expect(text).toContain("£31.35 is queued to go back to the guest");
    expect(text).not.toContain("was refunded");

    mockLate = {
      isSuccess: true,
      isError: false,
      data: { state: "refunded", amountCents: 3135, currency: "GBP" },
    };
    text = screenText(mount());
    expect(text).not.toContain("Nothing was charged.");
    expect(text).toContain("£31.35 was refunded");
  });

  test("T10: awake only while a code is showing", () => {
    mockRow = row("opened");
    mount();
    expect(mockAwake).toHaveBeenLastCalledWith(true);
    mockRow = row("paid");
    mount();
    expect(mockAwake).toHaveBeenLastCalledWith(false);
  });

  test("T12: a declined card is named with the code still open", () => {
    mockRow = { ...row("opened"), failureReason: "card_declined" };
    const text = screenText(mount());
    expect(text).toContain("Guest's card was declined. They can try again.");
    expect(text).toContain("Guest is paying");
  });

  test("Paystack: closed with no payment does not claim nothing can land", () => {
    mockRow = { ...row("cancelled"), provider: "paystack" };
    mockLate = { isSuccess: true, isError: false, data: null };
    const text = screenText(mount());
    expect(text).not.toContain("Nothing was charged.");
    expect(text).toContain("If one still lands, it's refunded in full.");
  });

  test("T4: the phone's clock alone never says expired or nothing charged", async () => {
    mockRow = { ...row("opened"), expiresAt: new Date(Date.now() - 1_000).toISOString() };
    mockLate = { isSuccess: true, isError: false, data: null };
    let resolveSettle: (status: string) => void = () => undefined;
    mockSettle.mockImplementation(() => new Promise((resolve) => { resolveSettle = resolve; }));
    const tree = mount();
    let text = screenText(tree);
    expect(text).toContain("Checking…");
    expect(text).not.toContain("This code expired");
    expect(text).not.toContain("Nothing was charged.");
    expect(mockSettle).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSettle("payment_landing");
    });
    text = screenText(tree);
    expect(text).toContain("Their payment went through");
    expect(text).not.toContain("Nothing was charged.");
    // Only the row turning expired on the server ends the code.
    mockRow = { ...row("expired") };
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(screenText(tree)).toContain("Nothing was charged.");
  });

  test("T4: a phone clock ahead of the server keeps showing the live code", async () => {
    mockRow = { ...row("opened"), expiresAt: new Date(Date.now() - 1_000).toISOString() };
    mockSettle.mockResolvedValue("opened");
    const tree = mount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screenText(tree)).toContain("Guest is paying");
  });

  const pressByLabel = async (tree: ReactTestRenderer, label: string): Promise<void> => {
    const button = tree.root.findAll(
      (n) => typeof n.props.onPress === "function" && textOf(n) === label,
    )[0];
    await act(async () => {
      await button.props.onPress();
    });
  };

  test("T4: Cancel sale on a payment going through shows it instead of cancelling", async () => {
    mockRow = row("opened");
    mockCancel.mockResolvedValue("payment_landing");
    const tree = mount();
    await pressByLabel(tree, "Cancel sale");
    expect(screenText(tree)).toContain("Their payment went through");
    expect(screenText(tree)).toContain("don't take cash");
  });

  test("T4: Take cash instead on a confirmed-closed code opens the cash sheet without a cancel", async () => {
    mockRow = row("expired");
    const tree = mount();
    await pressByLabel(tree, "Take cash instead");
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(String(mockReplace.mock.calls[0][0])).toContain("sellAnother=1");
  });

  test("T4: Show a new code answered payment landing never opens a second sale", async () => {
    const { DoorPayCodeError } = jest.requireMock("../../../services/doorPayCodeService") as {
      DoorPayCodeError: new (code: string, status: number, codeStatus: string) => Error;
    };
    mockRow = { ...row("opened"), expiresAt: new Date(Date.now() + 600_000).toISOString() };
    mockSettle.mockResolvedValue("payment_landing");
    mockMutateAsync.mockRejectedValue(new DoorPayCodeError("door_code_unavailable", 409, "payment_landing"));
    mockRow = row("expired");
    const tree = mount();
    await pressByLabel(tree, "Show a new code");
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockRefetch).toHaveBeenCalled();
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

// #4271 door polish (design item 6): amount first, one status pill, door tones.
describe("#4271 door polish: the host pay code screen", () => {
  beforeEach(() => {
    mockLate = { isSuccess: true, isError: false, data: null };
    mockGuest = { isSuccess: true, isError: false, data: "Ada Obi" };
    mockSettle.mockReset().mockImplementation(() => new Promise(() => undefined));
  });

  test("waiting: the amount comes before the code, the countdown sits in the pill", () => {
    mockRow = row("open");
    const tree = mount();
    const text = screenText(tree);
    expect(text.indexOf("£31.35")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("£31.35")).toBeLessThan(text.indexOf("K7Q2-M9XA"));
    expect(text).toMatch(/Point your camera here · \d+:\d\d/);
    expect(text).not.toContain("Code expires in");
    expect(text).not.toContain("Ask them to point");
    const pill = tree.root.findAll((n) => n.props.testID === "door-pay-status-pill" && typeof n.type === "string")[0];
    expect(String(pill.props.accessibilityLabel)).toMatch(/Code expires in \d+ minutes?/);
    // Ten minutes left: the dot is not urgent yet.
    expect(tree.root.findAll((n) => n.props.testID === "door-pay-status-pill-dot")).not.toHaveLength(0);
  });

  test("under a minute the dot turns warning", () => {
    mockRow = { ...row("open"), expiresAt: new Date(Date.now() + 45_000).toISOString() };
    const tree = mount();
    expect(tree.root.findAll((n) => n.props.testID === "door-pay-status-pill-dot-urgent")).not.toHaveLength(0);
  });

  test("opened: the pill says the guest is paying", () => {
    mockRow = { ...row("opened"), openedAt: new Date(Date.now() - 12_000).toISOString() };
    const text = screenText(mount());
    expect(text).toContain("Guest is paying…");
    expect(text).toContain("Keep this screen open.");
  });

  test.each([
    ["expired", "neutral"],
    ["cancelled", "neutral"],
    ["failed", "bad"],
    ["paid", "ok"],
  ])("%s ends on the %s ring", (status, tone) => {
    mockRow = row(status);
    const tree = mount();
    expect(tree.root.findAll((n) => n.props.testID === `door-pay-tone-${tone}`).length).toBeGreaterThan(0);
    for (const other of ["ok", "neutral", "caution", "bad"].filter((t) => t !== tone)) {
      expect(tree.root.findAll((n) => n.props.testID === `door-pay-tone-${other}`)).toHaveLength(0);
    }
  });

  test("paid reads Paid on their phone", () => {
    mockRow = row("paid");
    const text = screenText(mount());
    expect(text).toContain("Paid on their phone");
    expect(text).not.toContain("Buyer's phone");
  });

  test("checking is amber, not red", () => {
    mockRow = { ...row("opened"), expiresAt: new Date(Date.now() - 1_000).toISOString() };
    const tree = mount();
    expect(screenText(tree)).toContain("Checking…");
    expect(tree.root.findAll((n) => n.props.testID === "door-pay-tone-caution").length).toBeGreaterThan(0);
  });
});
