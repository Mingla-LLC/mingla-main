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
import {
  getTapToPaySession,
  resetTapToPaySessionForTests,
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
