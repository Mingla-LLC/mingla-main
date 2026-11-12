/**
 * #4389 (device r4, Nigeria F3) — opening the keyboard in the bank picker
 * pushed its "Search banks" header up into the status bar: the raw Modal's
 * avoiding view padded the root by the keyboard height while the sheet kept a
 * fixed height (64% of the window). The picker root now starts under the top
 * safe area (+ a gap) and the sheet's height is only its preferred size
 * (flexShrink), so it shrinks into the room left instead.
 *
 * Render test (the #2418 bank picker harness): the picker is opened for real
 * and the mounted root and sheet carry the inset and the shrink; T2 keeps the
 * iOS avoiding-view behaviour, which a renderer cannot exercise.
 * FAILS ON REVERT: drop the root's top inset or the sheet's flexShrink → T1.
 */
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


import * as fs from "fs";
import * as path from "path";
import { StyleSheet } from "react-native";
import { spacing } from "../../../constants/designSystem";

const SAFE_TOP = 47; // the safe-area mock above

function flatStyle(node: TestInstance): Record<string, unknown> {
  return (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
}

describe("#4389 — the bank picker stays under the top safe area with the keyboard up", () => {
  beforeEach(() => {
    mockAuthReady = true;
    mockRefetch.mockReset();
    mockBanksQuery = baseQuery({ isSuccess: true, data: [] });
  });

  test("T1: the open picker's root is padded by the top inset; its sheet shrinks instead of overflowing", () => {
    const mounted = openPicker();
    const roots = mounted.root.findAll(
      (node) => node.props.keyboardVerticalOffset !== undefined && flatStyle(node).paddingTop !== undefined,
    );
    expect(roots.length).toBeGreaterThan(0);
    expect(flatStyle(roots[0]).paddingTop).toBe(SAFE_TOP + spacing.sm);
    const sheets = mounted.root.findAll(
      (node) => node.props.role === "dialog" && node.props.accessibilityLabel === "Choose your bank",
    );
    expect(sheets.length).toBeGreaterThan(0);
    expect(flatStyle(sheets[0])).toMatchObject({ flexShrink: 1, minHeight: 0 });
    unmount(mounted);
  });

  test("T2: the avoiding view still lifts the sheet with the keyboard on iOS", () => {
    const src = fs.readFileSync(path.join(__dirname, "../BrandPaystackOnboardView.tsx"), "utf8");
    expect(src).toMatch(/behavior=\{Platform\.OS === "ios" \? "padding" : undefined\}/);
  });
});
