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
    easyConnect: jest.fn(async () => ({})),
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
jest.mock("../../../services/terminal/doorTapEdge", () => ({
  fetchDoorTapLocation: jest.fn(async () => "tml_1"),
  fetchTerminalConnectionToken: jest.fn(async () => "pst"),
  createDoorPayCodeForLines: jest.fn(async () => ({ codeId: "code-1" })),
  DoorTapError: class DoorTapError extends Error {},
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
import { TapToPayTerminalHost } from "../tap/TapToPayTerminalHost";
// eslint-disable-next-line import/first
import { TapUpdateIos } from "../tap/TapUpdateIos";
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
