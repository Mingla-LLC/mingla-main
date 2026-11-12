/**
 * #4271 phase 2 — Tap to Pay on iPhone surfaces, rendered. Pure rules live in
 * src/services/terminal/__tests__/issue_4271_apple_requirements.implementor.test.ts.
 * Every test here fails when its change is reverted (recorded on the issue).
 */
import React from "react";
import { Alert, AppState, Linking, PermissionsAndroid, Platform, Share, Text } from "react-native";

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
jest.mock("../../../hooks/useBrands", () => ({
  useBrand: () => ({ data: { id: "brand-1", displayName: "Door Brand", paymentProvider: "stripe", defaultCurrency: "GBP", stripeStatus: "active", chargesEnabled: true } }),
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
jest.mock("../../../hooks/useBrandSetupChecklist", () => ({
  useBrandSetupChecklist: () => ({ data: { facts: { complete: true } } }),
}));
jest.mock("expo-router", () => ({
  usePathname: () => "/home",
  useRouter: () => ({ replace: mockReplace, push: mockPush, back: jest.fn(), canGoBack: () => true }),
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
import AsyncStorage from "@react-native-async-storage/async-storage";
// eslint-disable-next-line import/first
import { resetTapToPayWarmHintForTests } from "../../../services/terminal/tapToPaySetupStore";
// eslint-disable-next-line import/first
import { TapToPayTerminalHost } from "../tap/TapToPayTerminalHost";
// eslint-disable-next-line import/first
import { TapToPayOnboardingCard } from "../tap/TapToPayOnboardingCard";
// eslint-disable-next-line import/first
import { TapToPayAwarenessModal, openTapToPayAwareness } from "../tap/TapToPayAwarenessModal";
// eslint-disable-next-line import/first
import { TapNotOnThisPhone } from "../tap/TapNotOnThisPhone";
// eslint-disable-next-line import/first
import { TapToPayEducation } from "../tap/TapToPayEducation";
// eslint-disable-next-line import/first
import { useTapToPaySettingsEntry } from "../../../hooks/useTapToPaySettingsEntry";
// eslint-disable-next-line import/first
import { showHowToTapEducation } from "../../../services/terminal/howToTap";
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
import { fetchDoorTapLocation, DoorTapError } from "../../../services/terminal/doorTapEdge";
// eslint-disable-next-line import/first
import {
  getTapToPaySession,
  resetTapToPaySessionForTests,
  updateTapToPaySession,
} from "../../../services/terminal/tapToPaySession";

Object.defineProperty(Platform, "Version", { value: "18.1", configurable: true });

jest.setTimeout(60_000);

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

  test("final P3: a probe that fails for a network reason leaves the admin copy, with no error text", async () => {
    mockRole = { rank: 10, isLoading: false };
    readyClient({ code: "STRIPE_API_CONNECTION_ERROR", message: "network down" });
    const { root } = await setup();
    const text = textOf(root);
    expect(text).toContain("Ask an admin to turn this on");
    expect(text).toContain("A brand owner or admin needs to accept Apple's terms");
    expect(text).not.toContain("Check your connection");
    expect(text).not.toContain("network down");
  });

  test("final P3: a probe that throws leaves the admin copy, with no error text", async () => {
    mockRole = { rank: 10, isLoading: false };
    updateTapToPaySession({
      status: "ready",
      client: {
        ensureReaderConnected: jest.fn(async () => {
          throw new Error("socket closed");
        }),
        checkDeviceSupport: async () => ({ supported: true }),
      } as never,
    });
    const { root } = await setup();
    const text = textOf(root);
    expect(text).toContain("A brand owner or admin needs to accept Apple's terms");
    expect(text).not.toContain("Setup didn't finish");
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

  // Retest 2 P4-7: the probe stays quiet, but the user's own press always shows its failure.
  const pressSetup = async (root: ReactTestInstance): Promise<void> => {
    await act(async () => {
      byTestId(root, "tap-setup-start").props.onPress();
      await Promise.resolve();
    });
    await flush();
    await flush();
  };
  const SETUP_FAILED =
    /Couldn't finish setting up Tap to Pay on iPhone\. Accept Apple's terms when asked, then try again\.|Couldn't start Tap to Pay on this phone\. Try again\./;

  test("retest 2 P4-7: an admin's own press that fails for a network reason shows the error", async () => {
    mockRole = { rank: 50, isLoading: false };
    const connect = readyClient({ code: "STRIPE_API_CONNECTION_ERROR", message: "network down" });
    const { root } = await setup();
    expect(textOf(root)).not.toMatch(SETUP_FAILED);
    await pressSetup(root);
    expect(connect).toHaveBeenCalledWith("tml_1", { mayAcceptTerms: true });
    expect(textOf(root)).toMatch(SETUP_FAILED);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  test("retest 2 P4-7: an admin's own press that throws shows Setup didn't finish", async () => {
    mockRole = { rank: 50, isLoading: false };
    updateTapToPaySession({
      status: "ready",
      client: {
        ensureReaderConnected: jest.fn(async () => {
          throw new Error("socket closed");
        }),
        checkDeviceSupport: async () => ({ supported: true }),
      } as never,
    });
    const { root } = await setup();
    expect(textOf(root)).not.toContain("Setup didn't finish");
    await pressSetup(root);
    expect(textOf(root)).toContain("Setup didn't finish. Check your connection and try again.");
    expect(mockReplace).not.toHaveBeenCalled();
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

  describe("Android: the SDK's own location permission (coarse on every API level)", () => {
    const setOs = (os: string, version: number | string): void => {
      Object.defineProperty(Platform, "OS", { value: os, configurable: true });
      Object.defineProperty(Platform, "Version", { value: version, configurable: true });
    };
    afterEach(() => {
      setOs("ios", "18.1");
      jest.restoreAllMocks();
    });

    test("API 33 warm-up checks coarse location, not fine, and connects", async () => {
      setOs("android", 33);
      const check = jest.spyOn(PermissionsAndroid, "check").mockResolvedValue(true);
      mockLive = true;
      (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce("1");
      mount(<TapToPayTerminalHost />);
      await settle();
      expect(check.mock.calls.map((call) => call[0])).toEqual([PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION]);
      expect(mockEasyConnect).toHaveBeenCalledTimes(1);
      expect(getTapToPaySession().readerReady).toBe(true);
    });

    test("API 33 sale asks for coarse location only, no Bluetooth, then connects", async () => {
      setOs("android", 33);
      const request = jest.spyOn(PermissionsAndroid, "request").mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
      mockSdk.requestNeededAndroidPermissions.mockClear();
      mockLive = true;
      mount(<TapToPayTerminalHost />);
      await settle();
      const client = getTapToPaySession().client;
      expect(client).not.toBeNull();
      let result: { error?: unknown } = {};
      await act(async () => {
        result = (await client?.ensureReaderConnected("tml_1")) ?? {};
      });
      expect(result.error).toBeUndefined();
      expect(request.mock.calls.map((call) => call[0])).toEqual([PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION]);
      expect(mockSdk.requestNeededAndroidPermissions).not.toHaveBeenCalled();
      expect(mockEasyConnect).toHaveBeenCalledTimes(1);
    });

    test("API 33 sale with location refused never connects and says how to fix it", async () => {
      setOs("android", 33);
      jest.spyOn(PermissionsAndroid, "request").mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
      mockLive = true;
      mount(<TapToPayTerminalHost />);
      await settle();
      let result: { error?: { message?: string } } = {};
      await act(async () => {
        result = ((await getTapToPaySession().client?.ensureReaderConnected("tml_1")) ?? {}) as typeof result;
      });
      expect(result.error?.message).toBe("Allow location for Mingla Host in Settings to take card payments.");
      expect(mockEasyConnect).not.toHaveBeenCalled();
    });
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
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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

describe("B9 Settings entry and the guide", () => {
  const Entry = (): React.ReactElement => {
    const entry = useTapToPaySettingsEntry("brand-1");
    return <Text testID="entry">{entry?.label ?? "none"}</Text>;
  };
  const withOs = (os: string, version: string): void => {
    Object.defineProperty(Platform, "OS", { value: os, configurable: true });
    Object.defineProperty(Platform, "Version", { value: version, configurable: true });
  };
  afterEach(() => withOs("ios", "18.1"));

  test("the row is hidden when not live and present when live", () => {
    mockLive = false;
    expect(textOf(mount(<Entry />).root)).toContain("none");
    mockLive = true;
    expect(textOf(mount(<Entry />).root)).toContain("Tap to Pay on iPhone");
  });

  test("iOS 17: the guide's rows cover contactless, wallets and the fallback, with no Apple button", () => {
    withOs("ios", "17.6");
    const { root } = mount(<TapToPayEducation pinRow={false} />);
    const text = textOf(root);
    expect(text).toContain("Contactless cards");
    expect(text).toContain("Apple Pay and other wallets");
    expect(text).toContain("If a tap doesn't work");
    expect(text).not.toContain("PIN");
    expect(text).not.toContain("Show How to Tap");
  });

  test("iOS 18: the button calls Apple's guide; a failure says so", async () => {
    const { root } = mount(<TapToPayEducation pinRow />);
    expect(textOf(root)).toContain("Accessibility options are on that screen.");
    await act(async () => {
      byTestId(root, "tap-show-how-to-tap").props.onPress();
    });
    expect(showHowToTapEducation).toHaveBeenCalled();
    (showHowToTapEducation as jest.Mock).mockRejectedValueOnce(new Error("networkUnavailable"));
    await act(async () => {
      byTestId(root, "tap-show-how-to-tap").props.onPress();
    });
    expect(textOf(root)).toContain("Couldn't show Apple's How to Tap guide.");
  });

  test("Android: no screen says iPhone or Apple's terms", async () => {
    withOs("android", "34");
    const education = textOf(mount(<TapToPayEducation pinRow />).root);
    expect(education).not.toContain("iPhone");
    expect(education).toContain("on the back of the phone");
    expect(education).not.toContain("PIN");
    mockRole = { rank: 10, isLoading: false };
    resetTapToPaySessionForTests();
    updateTapToPaySession({ status: "ready", client: { checkDeviceSupport: async () => ({ supported: true }) } as never });
    mockAvailability = { available: true, needsSetup: true, reason: "ok" };
    const setupScreen = mount(<TapToPaySetupScreen eventId="event-1" rawDraft={null} />);
    await flush();
    const text = textOf(setupScreen.root);
    expect(text).not.toContain("iPhone");
    expect(text).not.toContain("Apple's terms");
    expect(text).not.toContain("Ask an admin");
    expect(setupScreen.root.findAll((n) => n.props.testID === "tap-setup-start").length).toBeGreaterThan(0);
    const not = mount(<TapNotOnThisPhone onUsePayCode={jest.fn()} />);
    expect(textOf(not.root)).not.toContain("iPhone");
  });

  test("Settings: on for this brand shows the guide and no setup", async () => {
    mockRole = { rank: 60, isLoading: false };
    resetTapToPaySessionForTests();
    updateTapToPaySession({ status: "ready", client: { checkDeviceSupport: async () => ({ supported: true }) } as never });
    mockAvailability = { available: true, needsSetup: false, reason: "ok" };
    const { root } = mount(<TapToPaySetupScreen brandId="brand-1" eventId={null} rawDraft={null} />);
    await flush();
    expect(textOf(root)).toContain("On for this brand");
    expect(textOf(root)).toContain("If a tap doesn't work");
    expect(root.findAll((n) => n.props.testID === "tap-setup-start")).toHaveLength(0);
  });

  test("Settings: not accepted and admin offers setup; not admin gets the message", async () => {
    mockAvailability = { available: true, needsSetup: true, reason: "ok" };
    resetTapToPaySessionForTests();
    const connect = jest.fn(async () => ({ error: { nativeErrorCode: "3930" } }));
    updateTapToPaySession({
      status: "ready",
      client: { ensureReaderConnected: connect, checkDeviceSupport: async () => ({ supported: true }) } as never,
    });
    mockRole = { rank: 60, isLoading: false };
    const admin = mount(<TapToPaySetupScreen brandId="brand-1" eventId={null} rawDraft={null} />);
    await flush();
    expect(admin.root.findAll((n) => n.props.testID === "tap-setup-start").length).toBeGreaterThan(0);
    mockRole = { rank: 10, isLoading: false };
    const scanner = mount(<TapToPaySetupScreen brandId="brand-1" eventId={null} rawDraft={null} />);
    for (let i = 0; i < 5; i += 1) await flush();
    expect(textOf(scanner.root)).toContain("Ask an admin to turn this on");
  });

  test("the card-needs-inserting screen tells the truth", async () => {
    mockAvailability = { available: true, needsSetup: false, reason: "ok" };
    resetTapToPaySessionForTests();
    updateTapToPaySession({
      status: "ready",
      client: {
        ensureReaderConnected: async () => ({}),
        retrievePaymentIntent: async () => ({ paymentIntent: { id: "pi_1" } }),
        collectPaymentMethod: async () => ({ error: { code: "x", message: "offline_pin_required" } }),
        cancelCollectPaymentMethod: async () => ({}),
      } as never,
    });
    const { root } = mount(saleScreen());
    await settleSale();
    const text = textOf(root);
    expect(text).toContain("This card can't be tapped");
    expect(text).toContain("This card needs to be inserted, and a phone can't do that.");
    expect(text).not.toContain("needs a PIN");
  });
});

describe("B10 onboarding and awareness", () => {
  const STRIPE = { id: "brand-1", paymentProvider: "stripe", defaultCurrency: "GBP" };
  beforeEach(() => {
    // Forget any one-shot answer a test before this one left unused.
    (AsyncStorage.getItem as jest.Mock).mockReset();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  test("the onboarding card shows when live and eligible, and opens setup", () => {
    mockLive = true;
    const onSetUp = jest.fn();
    const { root } = mount(<TapToPayOnboardingCard brand={STRIPE} onSetUp={onSetUp} />);
    const text = textOf(root);
    expect(text).toContain("Take cards with Tap to Pay on iPhone");
    expect(text).toContain("Set up Tap to Pay on iPhone");
    byTestId(root, "tap-onboarding-setup").props.onPress();
    expect(onSetUp).toHaveBeenCalledTimes(1);
  });

  test("hidden when not live, on Paystack, in another currency, or with nowhere to go", () => {
    const onSetUp = jest.fn();
    mockLive = false;
    expect(mount(<TapToPayOnboardingCard brand={STRIPE} onSetUp={onSetUp} />).toJSON()).toBeNull();
    mockLive = true;
    expect(
      mount(<TapToPayOnboardingCard brand={{ ...STRIPE, paymentProvider: "paystack" }} onSetUp={onSetUp} />).toJSON(),
    ).toBeNull();
    expect(
      mount(<TapToPayOnboardingCard brand={{ ...STRIPE, defaultCurrency: "EUR" }} onSetUp={onSetUp} />).toJSON(),
    ).toBeNull();
    expect(mount(<TapToPayOnboardingCard brand={STRIPE} />).toJSON()).toBeNull();
  });

  test("the modal never renders with Apple's assets switched off, whatever the switch says", async () => {
    mockLive = true;
    mockRole = { rank: 60, isLoading: false };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    const tree = mount(<TapToPayAwarenessModal assets={null} />);
    await settleSale();
    expect(tree.toJSON()).toBeNull();
  });

  test("with assets it shows once, then never again for this user", async () => {
    mockLive = true;
    mockRole = { rank: 60, isLoading: false };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockClear();
    const { root } = mount(<TapToPayAwarenessModal />);
    await settleSale();
    expect(root.findAll((n) => n.props.testID === "tap-awareness-art").length).toBeGreaterThan(0);
    act(() => {
      byTestId(root, "tap-awareness-not-now").props.onPress();
    });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith("mingla.tapToPay.awarenessSeen.v1.user-1", "1");
    expect(root.findAll((n) => n.props.testID === "tap-awareness-modal")).toHaveLength(0);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("1");
    const again = mount(<TapToPayAwarenessModal />);
    await settleSale();
    expect(again.root.findAll((n) => n.props.testID === "tap-awareness-modal")).toHaveLength(0);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  test("hidden from someone without door money rights, and when not live", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    mockLive = true;
    mockRole = { rank: 10, isLoading: false };
    const scanner = mount(<TapToPayAwarenessModal />);
    await settleSale();
    expect(scanner.root.findAll((n) => n.props.testID === "tap-awareness-modal")).toHaveLength(0);
    mockLive = false;
    mockRole = { rank: 60, isLoading: false };
    const off = mount(<TapToPayAwarenessModal />);
    await settleSale();
    expect(off.root.findAll((n) => n.props.testID === "tap-awareness-modal")).toHaveLength(0);
  });
});

describe("B11 no feature art on iPhone", () => {
  beforeEach(() => {
    mockIconNames.length = 0;
    resetTapToPaySessionForTests();
    mockRole = { rank: 60, isLoading: false };
    updateTapToPaySession({ status: "ready", client: { checkDeviceSupport: async () => ({ supported: true }) } as never });
  });
  const seen = (): string[] => mockIconNames.filter((name) => name === "tap" || name === "phone");

  test("iPhone: setup, not-on-this-phone and brand refusal draw neither glyph", async () => {
    mockAvailability = { available: true, needsSetup: true, reason: "ok" };
    mount(<TapToPaySetupScreen eventId="event-1" rawDraft={null} />);
    await flush();
    mount(<TapNotOnThisPhone onUsePayCode={jest.fn()} />);
    mockAvailability = { available: false, needsSetup: false, reason: "paystack" };
    mount(<TapToPaySetupScreen eventId="event-1" rawDraft={null} />);
    mount(saleScreen());
    await flush();
    expect(seen()).toEqual([]);
  });

  test("Android may keep its own glyph", async () => {
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    mockAvailability = { available: true, needsSetup: true, reason: "ok" };
    mount(<TapToPaySetupScreen eventId="event-1" rawDraft={null} />);
    await flush();
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
    expect(seen()).toContain("tap");
  });
});

describe("B12 outcomes", () => {
  const client = (overrides: Record<string, unknown> = {}) => ({
    ensureReaderConnected: async () => ({}),
    retrievePaymentIntent: async () => ({ paymentIntent: { id: "pi_1" } }),
    collectPaymentMethod: async () => ({ paymentIntent: { id: "pi_1", status: "requires_confirmation" } }),
    confirmPaymentIntent: async () => ({ paymentIntent: { id: "pi_1", status: "succeeded" } }),
    cancelCollectPaymentMethod: async () => ({}),
    ...overrides,
  });
  const sale = async (terminal: Record<string, unknown>): Promise<ReactTestRenderer> => {
    resetTapToPaySessionForTests();
    mockAvailability = { available: true, needsSetup: false, reason: "ok" };
    updateTapToPaySession({ status: "ready", client: terminal as never });
    const tree = mount(saleScreen());
    await settleSale();
    return tree;
  };

  test("a card read that timed out says so and still offers a pay code", async () => {
    const { root } = await sale(client({ collectPaymentMethod: async () => ({ error: { code: "CARD_READ_TIMED_OUT" } }) }));
    expect(textOf(root)).toContain("Payment timed out");
    expect(textOf(root)).toContain("No card was read. Nothing was charged.");
    expect(root.findAll((n) => n.props.testID === "tap-show-pay-code").length).toBeGreaterThan(0);
  });

  test("an unknown result offers no pay code, and retry confirms the same intent", async () => {
    const confirm = jest
      .fn<Promise<unknown>, unknown[]>()
      .mockResolvedValueOnce({ error: { code: "STRIPE_API_ERROR" } })
      .mockResolvedValue({ paymentIntent: { id: "pi_1", status: "succeeded" } });
    const { root } = await sale(client({ confirmPaymentIntent: confirm }));
    const text = textOf(root);
    expect(text).toContain("We don't know yet if this went through.");
    expect(text).not.toContain("Nothing was charged");
    expect(root.findAll((n) => n.props.testID === "tap-show-pay-code")).toHaveLength(0);
    await act(async () => {
      byTestId(root, "tap-unknown-retry").props.onPress();
    });
    await settleSale();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[1]?.[0]).toEqual(confirm.mock.calls[0]?.[0]);
    expect(textOf(root)).toContain("Paid");
  });

  test("Send receipt on a declined card opens the share sheet with no personal data", async () => {
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" } as never);
    const { root } = await sale(
      client({
        confirmPaymentIntent: async () => ({
          error: { code: "DECLINED_BY_STRIPE_API", paymentIntent: { id: "pi_1", status: "requires_payment_method" } },
        }),
      }),
    );
    expect(textOf(root)).toContain("Card declined");
    await act(async () => {
      byTestId(root, "tap-send-receipt").props.onPress();
    });
    expect(share).toHaveBeenCalledTimes(1);
    const message = (share.mock.calls[0]?.[0] as { message: string }).message;
    expect(message).toContain("Not approved. No money was taken.");
  });

  test("closing an open sale cancels the intent on the server", async () => {
    const edge = jest.requireMock("../../../services/terminal/doorTapEdge") as { cancelDoorTapIntent: jest.Mock };
    edge.cancelDoorTapIntent.mockClear();
    const { root } = await sale(client({ collectPaymentMethod: async () => ({ error: { code: "CARD_READ_TIMED_OUT" } }) }));
    const chromeClose = jest.requireMock("../../ui/IconChrome") as { lastOnPress?: () => void };
    expect(root).toBeTruthy();
    await act(async () => {
      chromeClose.lastOnPress?.();
    });
    await flush();
    expect(edge.cancelDoorTapIntent).toHaveBeenCalledTimes(1);
  });

  // Retest 4 P4: the real screen's wiring for the paid-after-close alert and reopen().
  test("closing a ready sale that Stripe says was already paid records it and alerts the host", async () => {
    const edge = jest.requireMock("../../../services/terminal/doorTapEdge") as {
      cancelDoorTapIntent: jest.Mock;
      completeDoorTapIntent: jest.Mock;
      DoorTapError: new (code: string, detail?: string | null) => Error;
    };
    edge.cancelDoorTapIntent.mockReset();
    edge.cancelDoorTapIntent.mockRejectedValueOnce(new edge.DoorTapError("payment_succeeded", "paid"));
    edge.completeDoorTapIntent.mockClear();
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    let pending: ((r: unknown) => void) | null = null;
    const { root } = await sale(
      client({
        collectPaymentMethod: () =>
          new Promise((resolve) => {
            pending = resolve;
          }),
        cancelCollectPaymentMethod: async () => {
          pending?.({ error: { code: "CANCELED" } });
          return {};
        },
      }),
    );
    expect(root.findAll((n) => n.props.testID === "tap-state-ready" || textOf(n).includes("£31.35")).length).toBeGreaterThan(0);
    const chromeClose = jest.requireMock("../../ui/IconChrome") as { lastOnPress?: () => void };
    await act(async () => {
      chromeClose.lastOnPress?.();
    });
    await settleSale();
    expect(edge.completeDoorTapIntent).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentId: "pi_1" }));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]?.[0]).toBe("A card payment went through");
    expect(alert.mock.calls[0]?.[1]).toContain("£31.35 was paid by card after you closed the sale. It's recorded as a sale.");
    alert.mockRestore();
    edge.cancelDoorTapIntent.mockImplementation(async () => undefined);
  });

  test("a pay code that couldn't be made leaves a working tap: Try another card starts a fresh intent", async () => {
    const edge = jest.requireMock("../../../services/terminal/doorTapEdge") as {
      createDoorPayCodeForLines: jest.Mock;
      createDoorTapIntent: jest.Mock;
      cancelDoorTapIntent: jest.Mock;
    };
    edge.createDoorTapIntent.mockClear();
    edge.cancelDoorTapIntent.mockClear();
    edge.createDoorPayCodeForLines.mockRejectedValueOnce(new Error("offline"));
    const collect = jest.fn(async () => ({
      error: { code: "DECLINED_BY_STRIPE_API", paymentIntent: { id: "pi_1", status: "requires_payment_method" } },
    }));
    const { root } = await sale(client({ collectPaymentMethod: collect }));
    expect(textOf(root)).toContain("Card declined");
    await act(async () => {
      byTestId(root, "tap-show-pay-code").props.onPress();
    });
    await settleSale();
    expect(edge.cancelDoorTapIntent).toHaveBeenCalledTimes(1);
    expect(textOf(root)).toContain("Couldn't make a pay code.");
    const another = root.findAll((n) => n.props.label === "Try another card" && typeof n.props.onPress === "function")[0];
    expect(another).toBeTruthy();
    await act(async () => {
      another.props.onPress();
    });
    await settleSale();
    expect(edge.createDoorTapIntent).toHaveBeenCalledTimes(2);
    const ids = edge.createDoorTapIntent.mock.calls.map((call) => (call[0] as { clientRequestId: string }).clientRequestId);
    expect(ids[1]).not.toBe(ids[0]);
    expect(collect).toHaveBeenCalledTimes(2);
  });
});

describe("B13 seen", () => {
  const declining = {
    ensureReaderConnected: async () => ({}),
    retrievePaymentIntent: async () => ({ paymentIntent: { id: "pi_1" } }),
    collectPaymentMethod: async () => ({ paymentIntent: { id: "pi_1" } }),
    confirmPaymentIntent: async () => ({
      error: { code: "DECLINED_BY_STRIPE_API", paymentIntent: { id: "pi_1", status: "requires_payment_method" } },
    }),
    cancelCollectPaymentMethod: async () => ({}),
  };
  const edge = jest.requireMock("../../../services/terminal/doorTapEdge") as { markDoorTapOutcomeSeen: jest.Mock };
  const run = async (appState: string): Promise<void> => {
    Object.defineProperty(AppState, "currentState", { value: appState, configurable: true });
    edge.markDoorTapOutcomeSeen.mockClear();
    resetTapToPaySessionForTests();
    mockAvailability = { available: true, needsSetup: false, reason: "ok" };
    updateTapToPaySession({ status: "ready", client: declining as never });
    mount(saleScreen());
    await settleSale();
  };
  afterEach(() => {
    Object.defineProperty(AppState, "currentState", { value: "active", configurable: true });
  });

  test("an end state on screen is reported", async () => {
    await run("active");
    expect(edge.markDoorTapOutcomeSeen).toHaveBeenCalledWith(
      expect.objectContaining({ paymentIntentId: "pi_1" }),
    );
  });

  test("not when the app is in the background", async () => {
    await run("background");
    expect(edge.markDoorTapOutcomeSeen).not.toHaveBeenCalled();
  });
});

// #4271 door polish (design items 1, 2, 10, 11): tones, labels and the receipt link, rendered.
describe("#4271 door polish: Tap to Pay states", () => {
  const client = (overrides: Record<string, unknown> = {}) => ({
    ensureReaderConnected: async () => ({}),
    retrievePaymentIntent: async () => ({ paymentIntent: { id: "pi_1" } }),
    collectPaymentMethod: async () => ({ paymentIntent: { id: "pi_1", status: "requires_confirmation" } }),
    confirmPaymentIntent: async () => ({ paymentIntent: { id: "pi_1", status: "succeeded" } }),
    cancelCollectPaymentMethod: async () => ({}),
    ...overrides,
  });
  const sale = async (terminal: Record<string, unknown>, rawDraft: string = DRAFT): Promise<ReactTestRenderer> => {
    resetTapToPaySessionForTests();
    mockAvailability = { available: true, needsSetup: false, reason: "ok" };
    updateTapToPaySession({ status: "ready", client: terminal as never });
    const tree = mount(<TapToPaySaleScreen eventId="event-1" saleId="new" rawDraft={rawDraft} />);
    await settleSale();
    return tree;
  };
  const tone = (root: ReactTestInstance): string | undefined =>
    root
      .findAll((n) => typeof n.props.testID === "string" && n.props.testID.startsWith("tap-tone-") && typeof n.type === "string")
      .map((n) => String(n.props.testID).replace("tap-tone-", ""))[0];
  const buttonLabels = (root: ReactTestInstance): string[] =>
    root.findAll((n) => typeof n.props.label === "string" && typeof n.props.onPress === "function").map((n) => n.props.label as string);

  beforeEach(() => {
    mockIconNames.length = 0;
  });

  test("the header names Tap to Pay the way Apple asks on iPhone", async () => {
    const { root } = await sale(client());
    expect(textOf(root)).toContain("Tap to Pay on iPhone");
  });

  test("paid: green, no Guest row without a typed name, Send receipt is a text link", async () => {
    const { root } = await sale(client());
    expect(tone(root)).toBe("ok");
    expect(textOf(root)).not.toContain("Walk-up");
    expect(root.findAll((n) => n.props.testID === "tap-guest-row")).toHaveLength(0);
    const receipt = byTestId(root, "tap-send-receipt");
    expect(receipt).toBeTruthy();
    expect(receipt.props.accessibilityLabel).toBe("Send receipt");
    expect(buttonLabels(root)).not.toContain("Send receipt");
  });

  test("paid: the Guest row shows the name the host typed", async () => {
    const named = encodeTapToPayDraft({
      lines: [{ ticketTypeId: "tier-1", quantity: 2 }],
      eventDateId: null,
      buyerPhone: null,
      phoneCountryIso: null,
      buyerName: "Ada Obi",
    });
    const { root } = await sale(client(), named);
    expect(root.findAll((n) => n.props.testID === "tap-guest-row").length).toBeGreaterThan(0);
    expect(textOf(root)).toContain("Ada Obi");
  });

  test("declined: red, Try another card first, pay code second, receipt still offered", async () => {
    const { root } = await sale(
      client({
        confirmPaymentIntent: async () => ({
          error: { code: "DECLINED_BY_STRIPE_API", paymentIntent: { id: "pi_1", status: "requires_payment_method" } },
        }),
      }),
    );
    expect(tone(root)).toBe("bad");
    expect(buttonLabels(root).slice(0, 2)).toEqual(["Try another card", "Show a pay code instead"]);
    expect(byTestId(root, "tap-send-receipt")).toBeTruthy();
  });

  test("timed out: grey, nothing charged, receipt still offered", async () => {
    const { root } = await sale(client({ collectPaymentMethod: async () => ({ error: { code: "CARD_READ_TIMED_OUT" } }) }));
    expect(tone(root)).toBe("neutral");
    expect(byTestId(root, "tap-send-receipt")).toBeTruthy();
  });

  test("unknown result: amber, Check again, and still no pay code", async () => {
    const { root } = await sale(client({ confirmPaymentIntent: async () => ({ error: { code: "STRIPE_API_ERROR" } }) }));
    expect(tone(root)).toBe("caution");
    expect(buttonLabels(root)).toEqual(["Check again"]);
    expect(root.findAll((n) => n.props.testID === "tap-show-pay-code")).toHaveLength(0);
  });

  // P3-3: the caution ring spins only while a re-check is actually running.
  test("unknown result, idle: the caution icon, no spinner; still none after a re-check that comes back unknown", async () => {
    const { ActivityIndicator } = jest.requireActual("react-native") as typeof import("react-native");
    const unsettled = async () => ({ error: { code: "STRIPE_API_ERROR" } });
    const { root } = await sale(client({ confirmPaymentIntent: unsettled }));
    const ring = (): ReactTestInstance =>
      root.findAll((n) => n.props.testID === "tap-tone-caution")[0] as ReactTestInstance;
    expect(ring().findAll((n) => n.type === ActivityIndicator)).toHaveLength(0);
    expect(mockIconNames).toContain("flag");
    await act(async () => {
      byTestId(root, "tap-unknown-retry").props.onPress();
    });
    await settleSale();
    expect(tone(root)).toBe("caution");
    expect(ring().findAll((n) => n.type === ActivityIndicator)).toHaveLength(0);
  });

  // P3-2: iOS ignores live regions, so caution and bad states are announced.
  test("iOS: entering a caution or bad state is announced once; a paid state is not", async () => {
    const { AccessibilityInfo } = jest.requireActual("react-native") as typeof import("react-native");
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    // The preset's AccessibilityInfo is a shared mock: start from no calls.
    announce.mockClear();
    try {
      await sale(client({ confirmPaymentIntent: async () => ({ error: { code: "STRIPE_API_ERROR" } }) }));
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce.mock.calls[0]?.[0]).toContain("Checking the payment");
      announce.mockClear();
      await sale(
        client({
          confirmPaymentIntent: async () => ({
            error: { code: "DECLINED_BY_STRIPE_API", paymentIntent: { id: "pi_1", status: "requires_payment_method" } },
          }),
        }),
      );
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce.mock.calls[0]?.[0]).toContain("Card declined");
      announce.mockClear();
      await sale(client());
      expect(announce).not.toHaveBeenCalled();
    } finally {
      announce.mockRestore();
    }
  });

  // P4-1: the next guest is someone else.
  test("Sell another keeps the tickets and drops this guest's name and phone", async () => {
    const named = encodeTapToPayDraft({
      lines: [{ ticketTypeId: "tier-1", quantity: 2 }],
      eventDateId: "date-1",
      buyerPhone: "+447700900123",
      phoneCountryIso: "GB",
      buyerName: "Ada Obi",
    });
    mockReplace.mockClear();
    const { root } = await sale(client(), named);
    act(() => {
      byTestId(root, "tap-sell-another").props.onPress();
    });
    const href = String(mockReplace.mock.calls[mockReplace.mock.calls.length - 1]?.[0]);
    expect(href).toContain("/door/sell?"); // #4389: Door mode, not the old sheet
    const raw = decodeURIComponent(href.split("draft=")[1] ?? "");
    const { parseTapToPayDraft } = jest.requireActual("../../../services/terminal/tapToPayDraft") as {
      parseTapToPayDraft: (value: string) => Record<string, unknown> | null;
    };
    const draft = parseTapToPayDraft(raw);
    expect(draft).toEqual({
      lines: [{ ticketTypeId: "tier-1", quantity: 2 }],
      eventDateId: "date-1",
      buyerPhone: null,
      phoneCountryIso: null,
    });
    expect(raw).not.toBe(named);
  });

  // Retest P2: tax added at checkout refuses a tap AND a pay code for this
  // event, so the failed screen offers only the way back (the Close's action).
  test("tax refusal: neutral, the tax copy, one Back to door sales that does what Close does", async () => {
    const edge = jest.requireMock("../../../services/terminal/doorTapEdge") as {
      createDoorTapIntent: jest.Mock;
      createDoorPayCodeForLines: jest.Mock;
      DoorTapError: new (code: string, detail?: string | null) => Error;
    };
    edge.createDoorTapIntent.mockRejectedValueOnce(new edge.DoorTapError("door_tax_added_at_checkout"));
    edge.createDoorPayCodeForLines.mockClear();
    const { root } = await sale(client());
    expect(tone(root)).toBe("neutral");
    expect(textOf(root)).toContain("tax is added at checkout");
    expect(buttonLabels(root)).toEqual(["Back to door sales"]);
    expect(root.findAll((n) => n.props.testID === "tap-show-pay-code")).toHaveLength(0);
    const back = byTestId(root, "tap-back-to-door");
    const close = root.findAll((n) => n.props.accessibilityLabel === "Close" && typeof n.props.onPress === "function")[0];
    expect(back.props.onPress).toBe(close?.props.onPress);
    expect(textOf(root)).not.toContain("Check your connection");
    expect(edge.createDoorPayCodeForLines).not.toHaveBeenCalled();
  });

  test("other start failures still offer Try again and a pay code", async () => {
    const edge = jest.requireMock("../../../services/terminal/doorTapEdge") as {
      createDoorTapIntent: jest.Mock;
      DoorTapError: new (code: string, detail?: string | null) => Error;
    };
    edge.createDoorTapIntent.mockRejectedValueOnce(new edge.DoorTapError("door_ticket_capacity_exceeded"));
    const { root } = await sale(client());
    expect(buttonLabels(root)).toEqual(["Try again", "Show a pay code instead"]);
  });

  test("a pay code refused for tax says the tax copy, never Check your connection", async () => {
    const edge = jest.requireMock("../../../services/terminal/doorTapEdge") as {
      createDoorPayCodeForLines: jest.Mock;
      DoorTapError: new (code: string, detail?: string | null) => Error;
    };
    edge.createDoorPayCodeForLines.mockRejectedValueOnce(new edge.DoorTapError("door_tax_added_at_checkout"));
    const { root } = await sale(
      client({
        confirmPaymentIntent: async () => ({
          error: { code: "DECLINED_BY_STRIPE_API", paymentIntent: { id: "pi_1", status: "requires_payment_method" } },
        }),
      }),
    );
    await act(async () => {
      byTestId(root, "tap-show-pay-code").props.onPress();
    });
    await settleSale();
    expect(textOf(root)).toContain("tax is added at checkout");
    expect(textOf(root)).not.toContain("Check your connection");
  });

  test("ready: the instruction sits in the shared status pill", async () => {
    let pending: ((r: unknown) => void) | null = null;
    const { root } = await sale(
      client({
        collectPaymentMethod: () =>
          new Promise((resolve) => {
            pending = resolve;
          }),
      }),
    );
    expect(pending).not.toBeNull();
    expect(root.findAll((n) => n.props.testID === "tap-status-pill").length).toBeGreaterThan(0);
    expect(textOf(root)).toContain("Hold the card near the top of the iPhone.");
  });
});

describe("#4271 door polish: setup limits are grey, the facts are one list", () => {
  beforeEach(() => {
    mockIconNames.length = 0;
    resetTapToPaySessionForTests();
    mockRole = { rank: 60, isLoading: false };
    updateTapToPaySession({ status: "ready", client: { checkDeviceSupport: async () => ({ supported: true }) } as never });
  });
  const tones = (root: ReactTestInstance): string[] =>
    root
      .findAll((n) => typeof n.props.testID === "string" && n.props.testID.startsWith("tap-tone-") && typeof n.type === "string")
      .map((n) => String(n.props.testID).replace("tap-tone-", ""));

  test("not on this phone and update iOS are neutral, never red", () => {
    expect(tones(mount(<TapNotOnThisPhone onUsePayCode={jest.fn()} />).root)).toEqual(["neutral"]);
    expect(tones(mount(<TapUpdateIos onUsePayCode={jest.fn()} />).root)).toEqual(["neutral"]);
  });

  test("a brand that can't take taps is neutral", async () => {
    mockAvailability = { available: false, needsSetup: false, reason: "paystack" };
    const tree = mount(<TapToPaySetupScreen eventId="event-1" rawDraft={null} />);
    await flush();
    expect(tones(tree.root)).toEqual(["neutral"]);
  });

  test("setup shows the three facts in one grouped list", async () => {
    mockAvailability = { available: true, needsSetup: true, reason: "ok" };
    mockRole = { rank: 100, isLoading: false };
    const tree = mount(<TapToPaySetupScreen eventId="event-1" rawDraft={null} />);
    await flush();
    const lists = tree.root.findAll((n) => n.props.testID === "tap-setup-facts" && typeof n.type === "string");
    expect(lists).toHaveLength(1);
    const text = textOf(lists[0]);
    expect(text).toContain("No card machine");
    expect(text).toContain("Same money as online");
    expect(text).toContain("Apple's terms");
  });

  test("the guide is one grouped list too", () => {
    const tree = mount(<TapToPayEducation pinRow={false} />);
    expect(tree.root.findAll((n) => n.props.testID === "tap-education-facts" && typeof n.type === "string")).toHaveLength(1);
  });
});

// eslint-disable-next-line import/first
import { DoorStatusPill } from "../DoorStatusPill";

describe("#4271 door polish: the status pill on iOS (P3-2)", () => {
  test("a state change is announced; the first render and countdown ticks are not", () => {
    const { AccessibilityInfo } = jest.requireActual("react-native") as typeof import("react-native");
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
    // The preset's AccessibilityInfo is a shared mock: start from no calls.
    announce.mockClear();
    try {
      const tree = mount(<DoorStatusPill text="Point your camera here · 9:42" variant="waiting" stateLabel="Waiting for the guest" />);
      expect(announce).not.toHaveBeenCalled();
      act(() => {
        (tree as unknown as { update: (e: React.ReactElement) => void }).update(
          <DoorStatusPill text="Point your camera here · 9:41" variant="waiting" stateLabel="Waiting for the guest" />,
        );
      });
      expect(announce).not.toHaveBeenCalled();
      act(() => {
        (tree as unknown as { update: (e: React.ReactElement) => void }).update(
          <DoorStatusPill text="Guest is paying…" variant="busy" stateLabel="Guest is paying" />,
        );
      });
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith("Guest is paying");
    } finally {
      announce.mockRestore();
    }
  });
});

describe("#4389 HT Home Get started opens Apple's splash first, then setup", () => {
  test("with no splash mounted the caller opens setup itself", () => {
    expect(openTapToPayAwareness("brand-1")).toBe(false);
  });
  test("asked from Home, the splash shows even after it was seen; Get started then opens setup", async () => {
    mockLive = true;
    mockRole = { rank: 60, isLoading: false };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("1");
    mockPush.mockClear();
    const { root } = mount(<TapToPayAwarenessModal />);
    await settleSale();
    expect(root.findAll((n) => n.props.testID === "tap-awareness-modal")).toHaveLength(0);
    let opened = false;
    act(() => {
      opened = openTapToPayAwareness("brand-1");
    });
    expect(opened).toBe(true);
    expect(root.findAll((n) => n.props.testID === "tap-awareness-modal").length).toBeGreaterThan(0);
    act(() => {
      byTestId(root, "tap-awareness-get-started").props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith("/account/tap-to-pay?brandId=brand-1");
    expect(root.findAll((n) => n.props.testID === "tap-awareness-modal")).toHaveLength(0);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });
  test("someone the splash is not for goes straight to setup (never a dead tap)", async () => {
    mockLive = true;
    mockRole = { rank: 10, isLoading: false };
    mockPush.mockClear();
    const { root } = mount(<TapToPayAwarenessModal />);
    await settleSale();
    act(() => {
      openTapToPayAwareness("brand-1");
    });
    expect(root.findAll((n) => n.props.testID === "tap-awareness-modal")).toHaveLength(0);
    expect(mockPush).toHaveBeenCalledWith("/account/tap-to-pay?brandId=brand-1");
    mockRole = { rank: 60, isLoading: false };
  });
});

describe("#4389 S-i the setup screen opens T1 when the server says address_missing", () => {
  test("TapAddressMissing shows and Add address opens /brand/{id}/tap-to-pay/address", async () => {
    resetTapToPaySessionForTests();
    mockAvailability = { available: true, needsSetup: true, reason: "ok" };
    mockRole = { rank: 60, isLoading: false };
    mockPush.mockClear();
    (fetchDoorTapLocation as jest.Mock).mockImplementationOnce(async () => {
      throw new (DoorTapError as unknown as new (code: string, detail: string | null) => Error)("tap_not_available", "address_missing");
    });
    updateTapToPaySession({
      status: "ready",
      client: {
        ensureReaderConnected: jest.fn(async () => ({})),
        checkDeviceSupport: async () => ({ supported: true }),
      } as never,
    });
    const { root } = mount(<TapToPaySetupScreen eventId="event-1" rawDraft={null} />);
    await settleSale();
    const start = byTestId(root, "tap-setup-start");
    if (start) {
      await act(async () => {
        start.props.onPress();
      });
      await settleSale();
    }
    expect(textOf(root)).toContain("Add the address where you'll take card payments");
    act(() => {
      byTestId(root, "tap-add-address").props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith("/brand/brand-1/tap-to-pay/address");
  });
});
