import React from "react";

interface TestInstance {
  children: Array<TestInstance | string>;
  props: Record<string, unknown>;
}

interface TestRenderer {
  root: TestInstance & {
    findAll(predicate: (node: TestInstance) => boolean): TestInstance[];
  };
  unmount(): void;
  update(element: React.ReactElement): void;
}

const TestRendererApi: {
  act(callback: () => void | Promise<void>): void | Promise<void>;
  create(element: React.ReactElement): TestRenderer;
} = require("react-test-renderer");

const { act, create } = TestRendererApi;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mockRefetch = jest.fn();
let mockBanksQuery: Record<string, unknown>;

jest.mock("react-native-keyboard-controller", () => {
  const { View } = require("react-native");
  return {
    KeyboardAvoidingView: View,
    KeyboardAwareScrollView: View,
    KeyboardProvider: View,
    KeyboardToolbar: View,
    KeyboardStickyView: View,
  };
});

jest.mock("react-native-reanimated", () => {
  const { View } = require("react-native");
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (value: unknown) => value },
    View,
    createAnimatedComponent: (value: unknown) => value,
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => true,
    withTiming: (value: unknown) => value,
    withRepeat: (value: unknown) => value,
    cancelAnimation: jest.fn(),
    Easing: {
      linear: (value: number) => value,
      ease: (value: number) => value,
      inOut: (value: unknown) => value,
    },
  };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: View };
});

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light" },
}));

jest.mock("../../ui/Icon", () => {
  const { View } = require("react-native");
  return { Icon: () => <View /> };
});

jest.mock("../../ui/Spinner", () => {
  const { View } = require("react-native");
  return { Spinner: () => <View testID="tester-bank-spinner" /> };
});

jest.mock("../../ui/Sheet", () => {
  const { View } = require("react-native");
  return {
    Sheet: ({ children }: { children?: React.ReactNode }) => (
      <View>{children}</View>
    ),
  };
});

jest.mock("../../ui/Button", () => {
  const { Pressable, Text } = require("react-native");
  return {
    Button: ({
      accessibilityLabel,
      disabled,
      label,
      loading,
      onPress,
    }: {
      accessibilityLabel?: string;
      disabled?: boolean;
      label: string;
      loading?: boolean;
      onPress: () => void;
    }) => (
      <Pressable
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled, busy: loading }}
        disabled={disabled || loading}
        onPress={disabled || loading ? undefined : onPress}
      >
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true }),
}));

jest.mock("../../../diagnostics/reportNonFatal", () => ({
  reportNonFatal: jest.fn(),
}));

jest.mock("../../../services/brandPaystackService", () => {
  class PaystackBankListError extends Error {
    readonly code: string;
    readonly status: number | null;
    constructor(code: string, status: number | null) {
      super("safe tester bank-list error");
      this.code = code;
      this.status = status;
    }
  }
  return { PaystackBankListError };
});

const idleMutation = {
  mutateAsync: jest.fn(),
  isPending: false,
};

jest.mock("../../../hooks/useBrandPaystack", () => ({
  useBrandBanks: () => mockBanksQuery,
  useResolvePaystackAccount: () => idleMutation,
  useCreatePaystackSubaccount: () => idleMutation,
  useUpdatePaystackSubaccount: () => idleMutation,
  useCreatePaystackRecipient: () => idleMutation,
  useUpdatePaystackRecipient: () => idleMutation,
}));

import { PaystackBankListError } from "../../../services/brandPaystackService";
import { BrandPaystackOnboardView } from "../BrandPaystackOnboardView";

function query(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    data: undefined,
    error: null,
    errorUpdatedAt: 0,
    isError: false,
    isFetching: false,
    isLoading: false,
    isSuccess: false,
    refetch: mockRefetch,
    ...overrides,
  };
}

function nodesWithLabel(mounted: TestRenderer, label: string): TestInstance[] {
  return mounted.root.findAll(
    (node) => node.props.accessibilityLabel === label,
  );
}

function press(node: TestInstance): void {
  const callback = node.props.onPress;
  if (typeof callback !== "function") throw new Error("control is not active");
  callback();
}

function renderPicker(): React.ReactElement {
  return (
    <BrandPaystackOnboardView brandId="brand-ng" brandName="Lagos Nights" />
  );
}

function openPicker(): TestRenderer {
  let mounted: TestRenderer | null = null;
  act(() => {
    mounted = create(renderPicker());
  });
  if (mounted === null) throw new Error("component did not mount");
  const opener = nodesWithLabel(mounted, "Choose your bank")[0];
  if (!opener) throw new Error("picker opener missing");
  act(() => press(opener));
  return mounted;
}

describe("#2418 tester adversarial retry ownership", () => {
  beforeEach(() => mockRefetch.mockReset());

  it.each([
    [
      "terminal error",
      query({
        error: new PaystackBankListError("unknown", 500),
        errorUpdatedAt: 71,
        isError: true,
      }),
    ],
    ["provider empty", query({ data: [], isSuccess: true })],
    [
      "background refresh error",
      query({
        data: [{ name: "Access Bank", code: "044" }],
        error: new PaystackBankListError("unknown", 500),
        errorUpdatedAt: 72,
        isError: true,
      }),
    ],
  ])(
    "keeps the synchronous lock across a stale isFetching=false rerender for %s",
    async (_label, state) => {
      let settle: (() => void) | null = null;
      const pending = new Promise<{ data: undefined }>((resolve) => {
        settle = () => resolve({ data: undefined });
      });
      mockRefetch
        .mockReturnValueOnce(pending)
        .mockResolvedValueOnce({ data: undefined });
      mockBanksQuery = state;
      const mounted = openPicker();

      const firstRetry = nodesWithLabel(mounted, "Try loading banks again")[0];
      if (!firstRetry) throw new Error("first retry missing");
      act(() => {
        press(firstRetry);
        press(firstRetry);
      });
      expect(mockRefetch).toHaveBeenCalledTimes(1);

      // Adversarial observer lag: force a new render while the supplied query
      // snapshot still says isFetching=false. Only the component-local lock can
      // reject this newly-created handler; a stale closure check cannot.
      act(() => mounted.update(renderPicker()));
      const rerenderedRetry = nodesWithLabel(
        mounted,
        "Try loading banks again",
      )[0];
      if (!rerenderedRetry) throw new Error("rerendered retry missing");
      act(() => press(rerenderedRetry));
      expect(mockRefetch).toHaveBeenCalledTimes(1);

      await act(async () => {
        settle?.();
        await pending;
        await Promise.resolve();
      });
      act(() => press(rerenderedRetry));
      expect(mockRefetch).toHaveBeenCalledTimes(2);

      if (_label === "background refresh error") {
        expect(nodesWithLabel(mounted, "Access Bank").length).toBeGreaterThan(
          0,
        );
      }
      act(() => mounted.unmount());
    },
  );
});
