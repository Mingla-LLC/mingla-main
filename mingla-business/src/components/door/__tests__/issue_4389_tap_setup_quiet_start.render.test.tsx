/**
 * #4389 (iPhone 15 recording 23:04, F4 → Set up Tap to Pay on iPhone) — the
 * setup screen showed "Couldn't start Tap to Pay on iPhone. Check your
 * connection and try again." the moment it opened, before any tap. The cause:
 * Stripe Terminal starts in the background for the current brand; for a brand
 * just created (no payment account yet) terminal-connection-token refuses
 * (stripe_account_not_ready) and that background failure stayed in the shared
 * session. The host then needed two taps: one restarted Terminal, the next ran
 * setup.
 *
 *   Q1 a background start failure is retried quietly on arrival, with no red text;
 *   Q2 one tap on "Accept Apple's terms and set up" restarts Terminal AND carries
 *      on into setup once it is ready;
 *   Q3 a failure after the host's own tap is shown, with Get help;
 *   Q4 "On for this brand" (Settings) has a primary Done back to where the host came from.
 *
 * FAILS ON REVERT: the quiet retry / hostAttempted gate removed → Q1; the
 * pending-setup carry-on removed → Q2; the Done bar removed → Q4.
 */
import React from "react";
import { Platform } from "react-native";

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
  toJSON: () => unknown;
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

const mockIconNames: string[] = [];
jest.mock("../../ui/Icon", () => ({
  Icon: ({ name }: { name: string }) => {
    mockIconNames.push(name);
    return null;
  },
}));
jest.mock("../../ui/Button", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  const ReactLocal = jest.requireActual("react");
  return {
    Button: (props: { label: string; onPress: () => void; disabled?: boolean; testID?: string }) =>
      ReactLocal.createElement(
        Pressable,
        { onPress: props.onPress, disabled: props.disabled, testID: props.testID },
        ReactLocal.createElement(Text, null, props.label),
      ),
  };
});

let mockLive = false;
let mockBrandId: string | null = "brand-1";
const mockInitialize = jest.fn(async () => ({}));
const mockEasyConnect = jest.fn(async (_params: Record<string, unknown>) => ({}));
const mockProviderMounts = jest.fn();
const mockSdk = {
  StripeTerminalProvider: ({ children }: { children: React.ReactNode }) => {
    mockProviderMounts();
    return children;
  },
  useStripeTerminal: () => ({
    initialize: mockInitialize,
    disconnectReader: jest.fn(async () => ({})),
    clearCachedCredentials: jest.fn(async () => ({})),
    getConnectedReader: jest.fn(async () => null),
    easyConnect: mockEasyConnect,
    supportsReadersOfType: jest.fn(async () => ({ readerSupportResult: true })),
  }),
  requestNeededAndroidPermissions: jest.fn(async () => ({})),
};
jest.mock("../../../services/terminal/terminalSdk", () => ({
  loadTerminalSdk: () => mockSdk,
  isTerminalNativeModulePresent: () => true,
}));
jest.mock("../../../hooks/useTapToPayRelease", () => ({
  useTapToPayRelease: () => ({ live: mockLive }),
  tapToPayLive: () => mockLive,
}));
// #4389 — a brand whose payments are set up (Get started opens Tap to Pay
// setup); the #4389 case below flips it to a brand still in setup.
let mockBrandData: Record<string, unknown> = { id: "brand-1", displayName: "Door Brand", paymentProvider: "stripe", defaultCurrency: "GBP", stripeStatus: "active", chargesEnabled: true };
jest.mock("../../../hooks/useBrands", () => ({
  useBrand: () => ({ data: mockBrandData }),
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, isAuthReady: true }),
}));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandId: () => mockBrandId,
}));
let mockRole: { rank: number; isLoading: boolean } = { rank: 60, isLoading: false };
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => mockRole,
}));
const mockReplace = jest.fn();
const mockPush = jest.fn();
let mockAvailability: Record<string, unknown> = { available: true, needsSetup: true, reason: "ok" };
jest.mock("../../../hooks/useTapToPayAvailability", () => ({
  ...jest.requireActual("../../../hooks/useTapToPayAvailability"),
  useTapToPayAvailability: () => mockAvailability,
}));
jest.mock("../../../hooks/useManagedEventRoute", () => ({
  useManagedEventRoute: () => ({
    brand: { id: "brand-1", displayName: "Door Brand", defaultCurrency: "GBP" },
    event: { id: "event-1", brandId: "brand-1", currency: "GBP", tickets: [] },
  }),
}));
// #4389 — the splash auto-shows only on Home with brand setup complete.
let mockPathname = "/home";
let mockSetupComplete = true;
jest.mock("../../../hooks/useBrandSetupChecklist", () => ({
  useBrandSetupChecklist: () => ({ data: { facts: { complete: mockSetupComplete } } }),
}));
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ replace: mockReplace, push: mockPush, back: mockBack, canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
  Stack: () => null,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../../ui/IconChrome", () => {
  const mocked: { lastOnPress?: () => void; IconChrome?: unknown } = {};
  mocked.IconChrome = ({ onPress }: { onPress: () => void }) => {
    mocked.lastOnPress = onPress;
    return null;
  };
  return mocked;
});
jest.mock("../../ui/Spinner", () => ({ Spinner: () => null }));
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock("../../../hooks/useEventDoorSales", () => ({
  doorSaleKeys: { byEvent: () => ["door-sales"] },
}));
jest.mock("../../../utils/hapticFeedback", () => ({ HapticFeedback: { success: jest.fn() } }));
jest.mock("../../../services/postHogService", () => ({ postHogService: { capture: jest.fn() } }));
jest.mock("../../../services/terminal/doorTapEdge", () => ({
  fetchDoorTapLocation: jest.fn(async () => "tml_1"),
  fetchTerminalConnectionToken: jest.fn(async () => "pst"),
  createDoorPayCodeForLines: jest.fn(async () => ({ codeId: "code-1" })),
  createDoorTapIntent: jest.fn(async () => ({
    paymentIntentId: "pi_1",
    clientSecret: "pi_1_secret",
    totalCents: 3135,
    currency: "GBP",
    stripeAccountId: "acct_1",
    locationId: "tml_1",
    feeCents: 135,
    subtotalCents: 3000,
  })),
  completeDoorTapIntent: jest.fn(async () => ({ orderId: "o1", ticketIds: ["t1"], receiptQueued: false, replayed: false })),
  cancelDoorTapIntent: jest.fn(async () => undefined),
  markDoorTapOutcomeSeen: jest.fn(async () => undefined),
  DoorTapError: class DoorTapError extends Error {
    code: string;
    detail: string | null;
    constructor(code: string, detail: string | null = null) {
      super(code);
      this.code = code;
      this.detail = detail;
    }
  },
}));
jest.mock("../../../diagnostics/reportNonFatal", () => ({ reportNonFatal: jest.fn() }));
jest.mock("../../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() }, rpc: jest.fn() },
}));
jest.mock("../../../services/terminal/howToTap", () => ({
  isTapToPayIphoneEntitled: () => true,
  showHowToTapEducation: jest.fn(async () => "shown"),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));


// eslint-disable-next-line import/first
import { TapToPaySetupScreen } from "../tap/TapToPaySetupScreen";
// eslint-disable-next-line import/first
import { resetTapToPaySessionForTests, updateTapToPaySession } from "../../../services/terminal/tapToPaySession";

jest.setTimeout(60_000);

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await flush();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join(" ");
const pressables = (root: ReactTestInstance, id: string): ReactTestInstance[] =>
  root.findAll((n) => n.props.testID === id && typeof n.props.onPress === "function");

const START_FAILED = "Couldn't start Tap to Pay on iPhone. Check your connection and try again.";
const client = () => ({
  ensureReaderConnected: jest.fn(async () => ({})),
  checkDeviceSupport: async () => ({ supported: true }),
  retrievePaymentIntent: async () => ({}),
  collectPaymentMethod: async () => ({}),
  confirmPaymentIntent: async () => ({}),
  cancelCollectPaymentMethod: async () => ({}),
});

const mountSetup = async (eventId: string | null): Promise<ReactTestRenderer> => {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = renderer.create(<TapToPaySetupScreen brandId="brand-1" eventId={eventId} rawDraft={null} />);
  });
  await settle();
  return tree as ReactTestRenderer;
};

beforeEach(() => {
  Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
  Object.defineProperty(Platform, "Version", { value: "18.1", configurable: true });
  mockRole = { rank: 60, isLoading: false };
  mockAvailability = { available: true, needsSetup: true, reason: "ok" };
  resetTapToPaySessionForTests();
});

describe("#4389 — Tap to Pay setup never shows a background start failure", () => {
  test("Q1: a stale background failure is retried quietly; no red text on arrival", async () => {
    const retry = jest.fn();
    updateTapToPaySession({ status: "error", client: null, errorMessage: START_FAILED, retryInitialize: retry } as never);
    const tree = await mountSetup("event-1");
    expect(retry).toHaveBeenCalledTimes(1);
    expect(textOf(tree.root)).not.toContain("Couldn't start");
    expect(pressables(tree.root, "tap-get-help")).toHaveLength(0);
  });

  test("Q2: one tap restarts Terminal and carries on into setup when it is ready", async () => {
    const c = client();
    const retry = jest.fn();
    updateTapToPaySession({ status: "error", client: null, errorMessage: START_FAILED, retryInitialize: retry } as never);
    const tree = await mountSetup("event-1");
    const start = pressables(tree.root, "tap-setup-start")[0] as ReactTestInstance;
    act(() => {
      start.props.onPress();
    });
    expect(retry).toHaveBeenCalledTimes(2);
    expect(c.ensureReaderConnected).not.toHaveBeenCalled();
    act(() => {
      updateTapToPaySession({ status: "ready", client: c, errorMessage: null } as never);
    });
    await settle();
    expect(c.ensureReaderConnected).toHaveBeenCalledTimes(1);
    expect(c.ensureReaderConnected).toHaveBeenCalledWith("tml_1", { mayAcceptTerms: true });
  });

  test("Q3: a failure after the host's own tap is shown, with Get help", async () => {
    updateTapToPaySession({ status: "error", client: null, errorMessage: START_FAILED, retryInitialize: jest.fn() } as never);
    const tree = await mountSetup("event-1");
    act(() => {
      (pressables(tree.root, "tap-setup-start")[0] as ReactTestInstance).props.onPress();
    });
    await settle();
    expect(textOf(tree.root)).toContain(START_FAILED);
    expect(pressables(tree.root, "tap-get-help")).toHaveLength(1);
  });

  test("Q4: On for this brand (from Settings / F4) has a Done back to where the host came from", async () => {
    mockAvailability = { available: true, needsSetup: false, reason: "ok" };
    updateTapToPaySession({ status: "ready", client: client(), errorMessage: null } as never);
    const tree = await mountSetup(null);
    expect(textOf(tree.root)).toContain("On for this brand");
    const done = pressables(tree.root, "tap-on-done");
    expect(done.length).toBeGreaterThan(0);
    expect(textOf(done[0] as ReactTestInstance)).toContain("Done");
    act(() => {
      (done[0] as ReactTestInstance).props.onPress();
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
