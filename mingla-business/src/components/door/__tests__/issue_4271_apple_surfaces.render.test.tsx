/**
 * #4271 phase 2 — Tap to Pay on iPhone surfaces, rendered. Pure rules live in
 * src/services/terminal/__tests__/issue_4271_apple_requirements.implementor.test.ts.
 * Every test here fails when its change is reverted (recorded on the issue).
 */
import React from "react";
import { AppState, Linking, PermissionsAndroid, Platform, Share, Text } from "react-native";

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
  useBrand: () => ({ data: { id: "brand-1", displayName: "Door Brand", paymentProvider: "stripe", defaultCurrency: "GBP" } }),
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
import { TapToPayAwarenessModal } from "../tap/TapToPayAwarenessModal";
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
  const ASSETS = { hero: 1, title: "Toolkit title", body: "Toolkit body" };
  beforeEach(() => {
    // Forget any one-shot answer a test before this one left unused.
    (AsyncStorage.getItem as jest.Mock).mockReset();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  test("the onboarding card shows when live and eligible, and opens setup", () => {
    mockLive = true;
    const { root } = mount(<TapToPayOnboardingCard brand={STRIPE} />);
    const text = textOf(root);
    expect(text).toContain("Take cards with Tap to Pay on iPhone");
    expect(text).toContain("Set up Tap to Pay on iPhone");
  });

  test("hidden when not live, on Paystack, or in another currency", () => {
    mockLive = false;
    expect(mount(<TapToPayOnboardingCard brand={STRIPE} />).toJSON()).toBeNull();
    mockLive = true;
    expect(mount(<TapToPayOnboardingCard brand={{ ...STRIPE, paymentProvider: "paystack" }} />).toJSON()).toBeNull();
    expect(mount(<TapToPayOnboardingCard brand={{ ...STRIPE, defaultCurrency: "EUR" }} />).toJSON()).toBeNull();
  });

  test("the modal never renders without Apple's assets, whatever the switch says", async () => {
    mockLive = true;
    mockRole = { rank: 60, isLoading: false };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    const tree = mount(<TapToPayAwarenessModal />);
    await settleSale();
    expect(tree.toJSON()).toBeNull();
  });

  test("with assets it shows once, then never again for this user", async () => {
    mockLive = true;
    mockRole = { rank: 60, isLoading: false };
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockClear();
    const { root } = mount(<TapToPayAwarenessModal assets={ASSETS} />);
    await settleSale();
    expect(textOf(root)).toContain("Toolkit title");
    act(() => {
      byTestId(root, "tap-awareness-not-now").props.onPress();
    });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith("mingla.tapToPay.awarenessSeen.v1.user-1", "1");
    expect(root.findAll((n) => n.props.testID === "tap-awareness-modal")).toHaveLength(0);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue("1");
    const again = mount(<TapToPayAwarenessModal assets={ASSETS} />);
    await settleSale();
    expect(again.root.findAll((n) => n.props.testID === "tap-awareness-modal")).toHaveLength(0);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  test("hidden from someone without door money rights, and when not live", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    mockLive = true;
    mockRole = { rank: 10, isLoading: false };
    const scanner = mount(<TapToPayAwarenessModal assets={ASSETS} />);
    await settleSale();
    expect(scanner.root.findAll((n) => n.props.testID === "tap-awareness-modal")).toHaveLength(0);
    mockLive = false;
    mockRole = { rank: 60, isLoading: false };
    const off = mount(<TapToPayAwarenessModal assets={ASSETS} />);
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
