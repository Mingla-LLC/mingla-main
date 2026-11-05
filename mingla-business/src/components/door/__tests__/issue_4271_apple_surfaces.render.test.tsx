/**
 * #4271 phase 2 — Tap to Pay on iPhone surfaces, rendered. Pure rules live in
 * src/services/terminal/__tests__/issue_4271_apple_requirements.implementor.test.ts.
 * Every test here fails when its change is reverted (recorded on the issue).
 */
import React from "react";
import { Linking, Platform } from "react-native";

// react-test-renderer ships no types in this app.
interface ReactTestInstance {
  type: unknown;
  props: Record<string, any>;
  children: (ReactTestInstance | string)[];
  findAll: (predicate: (node: ReactTestInstance) => boolean) => ReactTestInstance[];
}
interface ReactTestRenderer {
  root: ReactTestInstance;
  toJSON: () => unknown;
}
const renderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => ReactTestRenderer;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};
const { act } = renderer;

jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
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
jest.mock("../../../hooks/useBrands", () => ({
  useBrand: () => ({ data: { displayName: "Door Brand" } }),
}));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandId: () => mockBrandId,
}));
let mockRole: { rank: number; isLoading: boolean } = { rank: 60, isLoading: false };
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => mockRole,
}));
const mockReplace = jest.fn();
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
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
  Stack: () => null,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("../../ui/IconChrome", () => ({ IconChrome: () => null }));
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
import AsyncStorage from "@react-native-async-storage/async-storage";
// eslint-disable-next-line import/first
import { resetTapToPayWarmHintForTests } from "../../../services/terminal/tapToPaySetupStore";
// eslint-disable-next-line import/first
import { TapToPayTerminalHost } from "../tap/TapToPayTerminalHost";
// eslint-disable-next-line import/first
import { TapConfiguringView } from "../tap/TapConfiguringView";
// eslint-disable-next-line import/first
import { TapUpdateIos } from "../tap/TapUpdateIos";
// eslint-disable-next-line import/first
import { TapToPaySaleScreen } from "../tap/TapToPaySaleScreen";
// eslint-disable-next-line import/first
import { encodeTapToPayDraft } from "../../../services/terminal/tapToPayDraft";
// eslint-disable-next-line import/first
import { TapToPaySetupScreen } from "../tap/TapToPaySetupScreen";
// eslint-disable-next-line import/first
import {
  getTapToPaySession,
  resetTapToPaySessionForTests,
  updateTapToPaySession,
} from "../../../services/terminal/tapToPaySession";

Object.defineProperty(Platform, "Version", { value: "18.1", configurable: true });

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

const mount = (element: React.ReactElement): ReactTestRenderer => {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = renderer.create(element);
  });
  return tree as ReactTestRenderer;
};

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join(" ");

const byTestId = (root: ReactTestInstance, id: string): ReactTestInstance =>
  root.findAll((n) => n.props.testID === id && typeof n.props.onPress === "function")[0] as ReactTestInstance;

describe("B2 iOS update screen", () => {
  test("says what to do, opens Settings and keeps the pay code", () => {
    const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    const onUsePayCode = jest.fn();
    const { root } = mount(<TapUpdateIos onUsePayCode={onUsePayCode} />);
    const text = textOf(root);
    expect(text).toContain("Update iOS to use Tap to Pay on iPhone");
    expect(text).toContain("Tap to Pay on iPhone needs iOS 17.6 or later.");
    act(() => {
      byTestId(root, "tap-update-open-settings").props.onPress();
    });
    expect(openSettings).toHaveBeenCalledTimes(1);
    act(() => {
      byTestId(root, "tap-update-pay-code").props.onPress();
    });
    expect(onUsePayCode).toHaveBeenCalledTimes(1);
  });
});

describe("B3 root Terminal host", () => {
  beforeEach(() => {
    resetTapToPaySessionForTests();
    mockInitialize.mockClear();
    mockProviderMounts.mockClear();
    mockBrandId = "brand-1";
  });

  test("not live: nothing renders, Stripe Terminal never starts, screens read unavailable", async () => {
    mockLive = false;
    const tree = mount(<TapToPayTerminalHost />);
    await flush();
    expect(tree.toJSON()).toBeNull();
    expect(mockProviderMounts).not.toHaveBeenCalled();
    expect(mockInitialize).not.toHaveBeenCalled();
    expect(getTapToPaySession().status).toBe("unavailable");
  });

  test("no brand: nothing renders even when the flags are on", async () => {
    mockLive = true;
    mockBrandId = null;
    mount(<TapToPayTerminalHost />);
    await flush();
    expect(mockProviderMounts).not.toHaveBeenCalled();
  });

  test("live: starts at the root with no screen open and publishes a ready client", async () => {
    mockLive = true;
    mount(<TapToPayTerminalHost />);
    await flush();
    await flush();
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(getTapToPaySession().status).toBe("ready");
    expect(getTapToPaySession().client).not.toBeNull();
  });
});

describe("B5 only admins accept Apple's terms", () => {
  const readyClient = (error?: Record<string, unknown>) => {
    const ensureReaderConnected = jest.fn(async () => (error === undefined ? {} : { error }));
    updateTapToPaySession({
      status: "ready",
      client: {
        ensureReaderConnected,
        checkDeviceSupport: async () => ({ supported: true }),
      } as never,
    });
    return ensureReaderConnected;
  };
  const setup = async (): Promise<ReactTestRenderer> => {
    const tree = mount(<TapToPaySetupScreen eventId="event-1" rawDraft={null} />);
    await flush();
    await flush();
    await flush();
    return tree;
  };

  beforeEach(() => {
    resetTapToPaySessionForTests();
    mockAvailability = { available: true, needsSetup: true, reason: "ok" };
    mockReplace.mockClear();
  });

  test("a scanner never gets the setup button, sees who to ask, and Apple is asked without terms", async () => {
    mockRole = { rank: 10, isLoading: false };
    const connect = readyClient({ nativeErrorCode: "3930" });
    const { root } = await setup();
    expect(connect).toHaveBeenCalledWith("tml_1", { mayAcceptTerms: false });
    const text = textOf(root);
    expect(text).toContain("Ask an admin to turn this on");
    expect(root.findAll((n) => n.props.testID === "tap-setup-start")).toHaveLength(0);
  });

  test("an event manager is treated the same: rank below brand admin", async () => {
    mockRole = { rank: 40, isLoading: false };
    const connect = readyClient({ nativeErrorCode: "3930" });
    const { root } = await setup();
    expect(connect).toHaveBeenCalledWith("tml_1", { mayAcceptTerms: false });
    expect(root.findAll((n) => n.props.testID === "tap-setup-start")).toHaveLength(0);
  });

  test("while the role loads nothing is offered and Apple is not asked", async () => {
    mockRole = { rank: 0, isLoading: true };
    const connect = readyClient();
    const { root } = await setup();
    expect(connect).not.toHaveBeenCalled();
    expect(root.findAll((n) => n.props.testID === "tap-setup-start")).toHaveLength(0);
  });

  test("a scanner whose admin already accepted just finishes setup", async () => {
    mockRole = { rank: 10, isLoading: false };
    const connect = readyClient();
    await setup();
    expect(connect).toHaveBeenCalledWith("tml_1", { mayAcceptTerms: false });
    expect(mockReplace).toHaveBeenCalled();
  });

  test("an admin may accept, and only by pressing the button", async () => {
    mockRole = { rank: 50, isLoading: false };
    const connect = readyClient();
    const { root } = await setup();
    expect(connect).not.toHaveBeenCalled();
    expect(textOf(root)).toContain("Accept Apple's terms and set up");
    await act(async () => {
      byTestId(root, "tap-setup-start").props.onPress();
      await Promise.resolve();
    });
    await flush();
    await flush();
    expect(connect).toHaveBeenCalledWith("tml_1", { mayAcceptTerms: true });
  });
});

describe("B6 warm-up through the real host", () => {
  beforeEach(() => {
    resetTapToPaySessionForTests();
    resetTapToPayWarmHintForTests();
    mockEasyConnect.mockClear();
    mockBrandId = "brand-1";
  });
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) await flush();
  };

  test("launch with a hint connects without allowing terms, and the sale finds it ready", async () => {
    mockLive = true;
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce("1");
    mount(<TapToPayTerminalHost />);
    await settle();
    expect(mockEasyConnect).toHaveBeenCalledTimes(1);
    expect(mockEasyConnect.mock.calls[0]?.[0]).toMatchObject({ tosAcceptancePermitted: false });
    expect(getTapToPaySession().readerReady).toBe(true);
  });

  test("launch without a hint never connects, and nor does a brand that isn't live", async () => {
    mockLive = true;
    mount(<TapToPayTerminalHost />);
    await settle();
    expect(mockEasyConnect).not.toHaveBeenCalled();
    mockLive = false;
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce("1");
    mount(<TapToPayTerminalHost />);
    await settle();
    expect(mockEasyConnect).not.toHaveBeenCalled();
  });
});

const DRAFT = encodeTapToPayDraft({
  lines: [{ ticketTypeId: "tier-1", quantity: 2 }],
  eventDateId: null,
  buyerPhone: null,
  phoneCountryIso: null,
} as never);
const saleScreen = (): React.ReactElement => (
  <TapToPaySaleScreen eventId="event-1" saleId="new" rawDraft={DRAFT} />
);
const settleSale = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await flush();
};

describe("B7 configuring and progress", () => {
  beforeEach(() => {
    resetTapToPaySessionForTests();
    mockAvailability = { available: true, needsSetup: false, reason: "ok" };
  });

  test("known progress shows the percent, the bar value and the not-ready sentence", () => {
    const { root } = mount(<TapConfiguringView progress={0.4} />);
    const text = textOf(root);
    expect(text).toContain("40%");
    expect(text).toContain("You can't take a tap until it's finished.");
    expect(text).toContain("Getting Tap to Pay on iPhone ready");
    const bar = root.findAll((n) => n.props.testID === "tap-configuring-bar")[0] as ReactTestInstance;
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 40 });
  });

  test("no progress shows a spinner and the same sentence", () => {
    const { root } = mount(<TapConfiguringView progress={null} />);
    expect(textOf(root)).toContain("You can't take a tap until it's finished.");
    expect(root.findAll((n) => n.props.testID === "tap-configuring-bar")).toHaveLength(0);
  });

  test("the sale says it can't take a tap yet while the terminal starts", async () => {
    updateTapToPaySession({ status: "initializing", client: null });
    const { root } = mount(saleScreen());
    await flush();
    expect(textOf(root)).toContain("You can't take a tap until it's finished.");
  });

  test("the sale shows live install progress", async () => {
    updateTapToPaySession({ status: "initializing", client: null, config: { installing: true, progress: 0.25 } });
    const { root } = mount(saleScreen());
    await flush();
    expect(textOf(root)).toContain("25%");
  });

  test("B2: below iOS 17.6 a device-class failure shows the update screen, on 17.6 it does not", async () => {
    const failing = {
      ensureReaderConnected: async () => ({ error: { code: "TAP_TO_PAY_UNSUPPORTED_DEVICE" } }),
    } as never;
    Object.defineProperty(Platform, "Version", { value: "17.5", configurable: true });
    updateTapToPaySession({ status: "ready", client: failing });
    const old = mount(saleScreen());
    await settleSale();
    expect(textOf(old.root)).toContain("Update iOS to use Tap to Pay on iPhone");
    Object.defineProperty(Platform, "Version", { value: "18.1", configurable: true });
    const current = mount(saleScreen());
    await settleSale();
    expect(textOf(current.root)).toContain("This phone can't take taps");
  });
});
