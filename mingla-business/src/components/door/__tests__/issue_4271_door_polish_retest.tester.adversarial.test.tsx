/**
 * #4271 door polish retest — tester adversarial (rendered). Different angle
 * from the implementor's pill test, which updates a lone <DoorStatusPill/>:
 * this one drives the REAL host pay code screen from "waiting" to "guest is
 * paying" and counts what VoiceOver is told.
 *
 *   A1  iOS: the pay code screen's waiting -> paying change is announced once;
 *       the first render and the countdown ticks are not.
 *   A2  Android: nothing is announced through announceForAccessibility (the
 *       live region does that job there).
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
import { DoorPayCodeScreen as DoorPayCodeRoute } from "../DoorPayCodeScreen";

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


// eslint-disable-next-line import/first
import { AccessibilityInfo, Platform } from "react-native";

const screenText = (tree: ReactTestRenderer): string => textOf(tree.root);

const update = (tree: ReactTestRenderer): void => {
  act(() => {
    (tree as unknown as { update: (e: React.ReactElement) => void }).update(<DoorPayCodeRoute />);
  });
};

describe("#4271 retest: the pay code screen tells VoiceOver when the guest starts paying", () => {
  let announce: jest.SpyInstance;
  const originalOs = Platform.OS;
  beforeEach(() => {
    jest.useFakeTimers();
    mockLate = { isSuccess: true, isError: false, data: null };
    mockGuest = { isSuccess: true, isError: false, data: undefined };
    mockSettle.mockReset().mockImplementation(() => new Promise(() => undefined));
    announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    announce.mockClear();
  });
  afterEach(() => {
    announce.mockRestore();
    Object.defineProperty(Platform, "OS", { value: originalOs, configurable: true });
    jest.useRealTimers();
  });

  // Retest of 6981d7956e (P3, fixed): the paying pill sat inside a Fragment and
  // the waiting pill did not, so React mounted a NEW pill on the change; its ref
  // started at "Guest is paying" and nothing was announced.
  test("A1 iOS: waiting -> paying is announced once; mount and countdown ticks are silent", () => {
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
    mockRow = row("open");
    const tree = mount();
    expect(announce).not.toHaveBeenCalled();
    // Countdown ticks re-render the waiting pill with new text only.
    act(() => {
      jest.advanceTimersByTime(3_000);
    });
    update(tree);
    expect(announce).not.toHaveBeenCalled();
    // The guest opens the link: the host must hear it without looking.
    mockRow = { ...row("opened"), openedAt: new Date().toISOString() };
    update(tree);
    expect(screenText(tree)).toContain("Guest is paying");
    expect(announce.mock.calls.map((c) => c[0])).toEqual(["Guest is paying"]);
    // Staying in "paying" never repeats it.
    act(() => {
      jest.advanceTimersByTime(3_000);
    });
    update(tree);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  test("A2 Android: the change is left to the live region, never announced directly", () => {
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    mockRow = row("open");
    const tree = mount();
    mockRow = { ...row("opened"), openedAt: new Date().toISOString() };
    update(tree);
    expect(announce).not.toHaveBeenCalled();
  });
});
