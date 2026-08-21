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
}

const TestRenderer: {
  act(callback: () => void | Promise<void>): void | Promise<void>;
  create(element: React.ReactElement): TestRenderer;
} = require("react-test-renderer");

const { act, create } = TestRenderer;

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let mockAuthReady = true;
const mockRefetch = jest.fn();
const mockReportNonFatal = jest.fn();
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
  const passthrough = (component: unknown) => component;
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: passthrough },
    View,
    createAnimatedComponent: passthrough,
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => true,
    withTiming: (value: unknown) => value,
    withRepeat: (value: unknown) => value,
    cancelAnimation: jest.fn(),
    Easing: {
      linear: (value: number) => value,
      ease: (value: number) => value,
      inOut: (fn: unknown) => fn,
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
  return {
    Icon: ({ name }: { name: string }) => <View testID={`icon-${name}`} />,
  };
});

jest.mock("../../ui/Spinner", () => {
  const { View } = require("react-native");
  return { Spinner: () => <View testID="bank-spinner" /> };
});

jest.mock("../../ui/Button", () => {
  const { Pressable, Text } = require("react-native");
  return {
    Button: ({
      accessibilityLabel,
      label,
      onPress,
    }: {
      accessibilityLabel?: string;
      label: string;
      onPress: () => void;
    }) => (
      <Pressable
        accessibilityLabel={accessibilityLabel ?? label}
        onPress={onPress}
      >
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});

jest.mock("../../ui/Sheet", () => {
  const { View } = require("react-native");
  return {
    Sheet: ({ children }: { children?: React.ReactNode }) => (
      <View>{children}</View>
    ),
  };
});

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: mockAuthReady }),
}));

jest.mock("../../../diagnostics/reportNonFatal", () => ({
  reportNonFatal: mockReportNonFatal,
}));

jest.mock("../../../services/brandPaystackService", () => {
  class PaystackBankListError extends Error {
    readonly code: string;
    readonly status: number | null;
    constructor(code: string, status: number | null) {
      super("safe bank list error");
      this.code = code;
      this.status = status;
    }
  }
  return { PaystackBankListError };
});

const mockIdleMutation = {
  mutate: jest.fn(),
  mutateAsync: jest.fn(),
  isPending: false,
  isSuccess: false,
  isError: false,
  reset: jest.fn(),
};

jest.mock("../../../hooks/useBrandPaystack", () => ({
  useBrandBanks: () => mockBanksQuery,
  useResolvePaystackAccount: () => mockIdleMutation,
  useCreatePaystackSubaccount: () => mockIdleMutation,
  useUpdatePaystackSubaccount: () => mockIdleMutation,
  useCreatePaystackRecipient: () => mockIdleMutation,
  useUpdatePaystackRecipient: () => mockIdleMutation,
}));

import { PaystackBankListError } from "../../../services/brandPaystackService";
import { BrandPaystackOnboardView } from "../BrandPaystackOnboardView";

function baseQuery(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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

function flattenText(children: Array<TestInstance | string>): string {
  return children
    .map((child) =>
      typeof child === "string" ? child : flattenText(child.children),
    )
    .join("");
}

function nodesWithLabel(mounted: TestRenderer, label: string): TestInstance[] {
  return mounted.root.findAll(
    (node) => node.props.accessibilityLabel === label,
  );
}

function hasExactText(mounted: TestRenderer, expected: string): boolean {
  return (
    mounted.root.findAll((node) => flattenText(node.children) === expected)
      .length > 0
  );
}

function hasMatchingText(mounted: TestRenderer, expected: RegExp): boolean {
  return (
    mounted.root.findAll((node) => expected.test(flattenText(node.children)))
      .length > 0
  );
}

function invokeProp(
  node: TestInstance,
  prop: "onPress" | "onChangeText",
  value?: string,
): void {
  const callback = node.props[prop];
  if (typeof callback !== "function") {
    throw new Error(`${prop} is not callable`);
  }
  callback(value);
}

function openPicker(): TestRenderer {
  let mounted: TestRenderer | null = null;
  act(() => {
    mounted = create(
      <BrandPaystackOnboardView brandId="brand-ng" brandName="Lagos Nights" />,
    );
  });
  if (mounted === null) throw new Error("picker did not mount");
  const opener = nodesWithLabel(mounted, "Choose your bank")[0];
  if (!opener) throw new Error("picker opener is missing");
  act(() => invokeProp(opener, "onPress"));
  return mounted;
}

function unmount(mounted: TestRenderer): void {
  act(() => mounted.unmount());
}

describe("#2418 truthful bank picker states", () => {
  beforeEach(() => {
    mockAuthReady = true;
    mockRefetch.mockReset();
    mockRefetch.mockResolvedValue({ data: undefined });
    mockReportNonFatal.mockClear();
    mockBanksQuery = baseQuery();
  });

  it("shows sign-in and loading states without empty copy", () => {
    mockAuthReady = false;
    let mounted = openPicker();
    expect(hasExactText(mounted, "Finishing sign-in…")).toBe(true);
    expect(hasMatchingText(mounted, /No banks/)).toBe(false);
    unmount(mounted);

    mockAuthReady = true;
    mockBanksQuery = baseQuery({ isLoading: true, isFetching: true });
    mounted = openPicker();
    expect(hasExactText(mounted, "Loading banks…")).toBe(true);
    expect(hasMatchingText(mounted, /No banks/)).toBe(false);
    unmount(mounted);
  });

  it("renders a terminal failure with one real retry and never search-empty copy", () => {
    mockBanksQuery = baseQuery({
      error: new PaystackBankListError("app_update_required", 426),
      errorUpdatedAt: 1,
      isError: true,
    });
    const mounted = openPicker();
    expect(hasExactText(mounted, "Couldn't load banks")).toBe(true);
    expect(hasExactText(mounted, "Banks are unavailable right now.")).toBe(
      true,
    );
    expect(hasMatchingText(mounted, /No banks match/)).toBe(false);
    const retry = nodesWithLabel(mounted, "Try loading banks again")[0];
    if (!retry) throw new Error("retry control is missing");
    act(() => invokeProp(retry, "onPress"));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(mockReportNonFatal).toHaveBeenCalledTimes(1);
    const diagnosticText = JSON.stringify(mockReportNonFatal.mock.calls[0]);
    expect(diagnosticText).not.toContain("account");
    expect(diagnosticText).not.toContain("token");
    unmount(mounted);
  });

  it("distinguishes provider-empty from a trimmed filtered-empty search", () => {
    mockBanksQuery = baseQuery({ data: [], isSuccess: true });
    let mounted = openPicker();
    expect(hasExactText(mounted, "No banks are available right now.")).toBe(
      true,
    );
    expect(hasMatchingText(mounted, /No banks match/)).toBe(false);
    expect(
      nodesWithLabel(mounted, "Try loading banks again").length,
    ).toBeGreaterThan(0);
    unmount(mounted);

    mockBanksQuery = baseQuery({
      data: [{ name: "Access Bank", code: "044" }],
      isSuccess: true,
    });
    mounted = openPicker();
    const search = nodesWithLabel(mounted, "Search banks")[0];
    if (!search) throw new Error("bank search is missing");
    act(() => invokeProp(search, "onChangeText", "  no-match  "));
    expect(hasExactText(mounted, "No banks match “no-match”.")).toBe(true);
    expect(nodesWithLabel(mounted, "Try loading banks again")).toHaveLength(0);
    unmount(mounted);
  });

  it("keeps cached rows usable after a background refresh failure", () => {
    mockBanksQuery = baseQuery({
      data: [{ name: "Access Bank", code: "044" }],
      error: new PaystackBankListError("unknown", 500),
      errorUpdatedAt: 2,
      isError: true,
    });
    const mounted = openPicker();
    expect(hasExactText(mounted, "Access Bank")).toBe(true);
    expect(hasExactText(mounted, "Couldn't refresh banks.")).toBe(true);
    expect(
      nodesWithLabel(mounted, "Try loading banks again").length,
    ).toBeGreaterThan(0);
    expect(hasExactText(mounted, "Couldn't load banks")).toBe(false);
    unmount(mounted);
  });
});

describe("#2418 bank retry mutex", () => {
  beforeEach(() => {
    mockAuthReady = true;
    mockRefetch.mockReset();
    mockReportNonFatal.mockClear();
  });

  it.each([
    [
      "terminal error",
      {
        error: new PaystackBankListError("unknown", 500),
        errorUpdatedAt: 3,
        isError: true,
      },
    ],
    ["provider empty", { data: [], isSuccess: true }],
    [
      "background refresh error",
      {
        data: [{ name: "Access Bank", code: "044" }],
        error: new PaystackBankListError("unknown", 500),
        errorUpdatedAt: 4,
        isError: true,
      },
    ],
  ])(
    "coalesces same-frame %s retry taps and unlocks after settle",
    async (_label, queryState) => {
      let settleFirstRetry: (() => void) | null = null;
      const firstRetry = new Promise<{ data: undefined }>((resolve) => {
        settleFirstRetry = () => resolve({ data: undefined });
      });
      mockRefetch
        .mockReturnValueOnce(firstRetry)
        .mockResolvedValueOnce({ data: undefined });
      mockBanksQuery = baseQuery(queryState);
      const mounted = openPicker();
      const retry = nodesWithLabel(mounted, "Try loading banks again")[0];
      if (!retry) throw new Error("retry control is missing");

      act(() => {
        invokeProp(retry, "onPress");
        invokeProp(retry, "onPress");
      });
      expect(mockRefetch).toHaveBeenCalledTimes(1);

      await act(async () => {
        settleFirstRetry?.();
        await firstRetry;
        await Promise.resolve();
      });

      act(() => invokeProp(retry, "onPress"));
      expect(mockRefetch).toHaveBeenCalledTimes(2);
      await act(async () => Promise.resolve());
      unmount(mounted);
    },
  );
});
