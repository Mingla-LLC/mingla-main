/**
 * #3645 RETEST — TESTER adversarial suite for the native payout screen
 * (BrandOnboardView) after the rework at 8a8ab456c. Different angles from
 * issue_3645_native_back_and_auto_switch.implementor.test.tsx: Back while the
 * automatic switch is still in flight, Back after it succeeded, the whole
 * failed-switch recovery path (failed clear, Back, successful clear), and
 * repeated re-renders with a fresh brand object each time.
 *
 * FAILS ON REVERT (restore BrandOnboardView.tsx from 0fbf04adf): M1-M4 fail —
 * no automatic switch is sent, and Back sends clear_provider instead of
 * leaving.
 *
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/issue_3645_native_auto_switch_retest.tester.adversarial.test.tsx --runInBand
 */

/* eslint-disable @typescript-eslint/no-require-imports, import/first */

import React from "react";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const BRAND_ID = "2b7c8f6a-1111-4a22-8333-123456789abc";
const USER_ID = "79f45786-2222-4b33-8444-123456789abc";

interface InvokeResult {
  data: unknown;
  error: unknown;
}

const mockInvoke = jest.fn<Promise<InvokeResult>, [string, { body: Record<string, unknown> }]>();
let mockStripeStatus: { data: Record<string, unknown> | undefined } = { data: undefined };

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: jest.fn(),
  dismissBrowser: jest.fn(),
}));

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(),
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: "s", Warning: "w", Error: "e" },
}));

jest.mock("../../../wrappers/SmartScrollView", () => {
  const { View } = require("react-native");
  return {
    ScrollView: ({ children }: { children?: React.ReactNode }) => (
      <View testID="scroll">{children}</View>
    ),
  };
});

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: USER_ID } }),
}));

jest.mock("../../../hooks/useSwitchAccount", () => ({
  useSwitchAccount: () => ({ signedInEmail: null, onSwitchAccount: jest.fn() }),
}));

jest.mock("../../../hooks/useStartBrandStripeOnboarding", () => ({
  useStartBrandStripeOnboarding: () => ({
    isPending: false,
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
  }),
}));

jest.mock("../../../hooks/useBrandStripeStatus", () => ({
  brandStripeStatusKeys: {
    detail: (id: string) => ["brand-stripe-status", id] as const,
  },
  useBrandStripeStatus: () => ({
    data: mockStripeStatus.data,
    isLoading: false,
    isFetched: true,
    isError: false,
    error: null,
    refetch: jest.fn(),
  }),
}));

jest.mock("../../../hooks/useBrands", () => {
  const { brandKeys } = jest.requireActual("../../../hooks/brandKeys");
  return { brandKeys };
});

jest.mock("../../../services/supabase", () => ({
  supabase: {
    from: jest.fn(),
    functions: {
      invoke: (name: string, options: { body: Record<string, unknown> }) =>
        mockInvoke(name, options),
    },
    auth: {},
  },
}));

jest.mock("../../ui/Button", () => {
  const { Pressable, Text } = require("react-native");
  return {
    Button: ({
      label,
      onPress,
      testID,
    }: {
      label: string;
      onPress: () => void;
      testID?: string;
    }) => (
      <Pressable accessibilityLabel={label} onPress={onPress} testID={testID}>
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});

jest.mock("../../ui/GlassCard", () => {
  const { View } = require("react-native");
  return {
    GlassCard: ({ children }: { children?: React.ReactNode }) => <View>{children}</View>,
  };
});

jest.mock("../../ui/Icon", () => {
  const { View } = require("react-native");
  return { Icon: () => <View /> };
});

jest.mock("../../ui/Spinner", () => {
  const { View } = require("react-native");
  return { Spinner: () => <View testID="spinner" /> };
});

jest.mock("../../onboarding/MinglaToSAcceptanceGate", () => ({
  MinglaToSAcceptanceGate: (): null => null,
}));

jest.mock("../../auth/SignedInNotFoundNotice", () => ({
  SignedInNotFoundNotice: (): null => null,
}));

jest.mock("../BrandStripeCountryPicker", () => {
  const { View } = require("react-native");
  return {
    BrandStripeCountryPicker: (props: {
      value: string | null;
      onChange: (countryCode: string) => void;
    }) => (
      <View
        testID="country-picker"
        accessibilityValue={{ text: props.value ?? "" }}
        onChange={props.onChange}
      />
    ),
  };
});

jest.mock("../BrandPaystackOnboardView", () => {
  const { View } = require("react-native");
  return {
    BrandPaystackOnboardView: (props: { onCancel?: () => void }) => (
      <View testID="paystack-view" onCancel={props.onCancel} />
    ),
  };
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { BrandOnboardView } from "../BrandOnboardView";
import type { Brand } from "../../../store/currentBrandStore";

interface TestInstance {
  type: unknown;
  children: (TestInstance | string)[];
  props: Record<string, unknown>;
  findAllByProps: (props: Record<string, unknown>) => TestInstance[];
}

interface TestTree {
  root: TestInstance;
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}

const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => Promise<void> | void) => Promise<void> | void;
  create: (element: React.ReactElement) => TestTree;
};

async function flush(): Promise<void> {
  await TestRenderer.act(async () => {
    for (let index = 0; index < 5; index += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  });
}

function hostsMatching(
  tree: TestTree,
  matcher: Record<string, unknown>,
): TestInstance[] {
  return tree.root
    .findAllByProps(matcher)
    .filter((node) => typeof node.type === "string");
}

function count(tree: TestTree, testID: string): number {
  return hostsMatching(tree, { testID }).length;
}

function only(tree: TestTree, testID: string): TestInstance {
  const hosts = hostsMatching(tree, { testID });
  if (hosts.length !== 1) {
    throw new Error(`expected exactly 1 host for ${testID}, got ${hosts.length}`);
  }
  return hosts[0];
}

function textOf(node: TestInstance | string): string {
  if (typeof node === "string") return node;
  return node.children.map(textOf).join("");
}

/** Supabase's FunctionsHttpError shape: the JSON body rides on `context`. */
function edgeFailure(body: Record<string, unknown>): InvokeResult {
  const error = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    context: { json: async () => body },
  });
  return { data: null, error };
}

function deferred(): {
  promise: Promise<InvokeResult>;
  resolve: (value: InvokeResult) => void;
} {
  let resolve!: (value: InvokeResult) => void;
  const promise = new Promise<InvokeResult>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const brandOf = (patch: Partial<Brand>): Brand =>
  ({
    id: BRAND_ID,
    displayName: "Lagos Supper Club",
    slug: "lagossupperclub",
    address: null,
    coverHue: 25,
    accountId: USER_ID,
    role: "owner",
    stats: { events: 0, rev: 0, rev7d: 0, attendees: 0 },
    currentLiveEvent: null,
    paymentProvider: "stripe",
    stripeStatus: "not_connected",
    ...patch,
  }) as Brand;

// orch-strict-grep-allow stripe-country-out-of-scope — Nigeria is the Paystack rail, deliberately outside the Stripe allowlist.
const NIGERIA = { countryCode: "NG" } as const;

describe("#3645 retest — tester adversarial: native Back and the automatic Nigeria switch", () => {
  let tree: TestTree | null = null;
  let queryClient: QueryClient;
  const onCancel = jest.fn();
  const onAfterDone = jest.fn();

  const element = (brand: Brand, strict = false): React.ReactElement => {
    const body = (
      <QueryClientProvider client={queryClient}>
        <BrandOnboardView brand={brand} onCancel={onCancel} onAfterDone={onAfterDone} />
      </QueryClientProvider>
    );
    return strict ? <React.StrictMode>{body}</React.StrictMode> : body;
  };

  async function mount(brand: Brand, strict = false): Promise<TestTree> {
    let mounted: TestTree | null = null;
    await TestRenderer.act(async () => {
      mounted = TestRenderer.create(element(brand, strict));
    });
    await flush();
    if (mounted === null) throw new Error("BrandOnboardView did not mount.");
    return mounted;
  }

  async function pressLabel(target: TestTree, label: string): Promise<void> {
    const hosts = hostsMatching(target, { accessibilityLabel: label });
    if (hosts.length !== 1) {
      throw new Error(`expected exactly 1 "${label}" control, got ${hosts.length}`);
    }
    await TestRenderer.act(async () => {
      (hosts[0].props.onPress as () => void)();
    });
    await flush();
  }

  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    mockStripeStatus = { data: undefined };
    onCancel.mockClear();
    onAfterDone.mockClear();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  afterEach(() => {
    if (tree !== null) {
      TestRenderer.act(() => tree?.unmount());
      tree = null;
    }
    queryClient.clear();
  });


  const sent = (): string[] =>
    mockInvoke.mock.calls
      .filter(([name]) => name === "brand-paystack-onboard")
      .map(([, options]) => String(options.body.action));

  async function pressId(target: TestTree, testID: string): Promise<void> {
    await TestRenderer.act(async () => {
      (only(target, testID).props.onPress as () => void)();
    });
    await flush();
  }

  test("M1: a fresh brand object on every render does not repeat the automatic switch", async () => {
    tree = await mount(brandOf({ ...NIGERIA }));
    for (let index = 0; index < 4; index += 1) {
      await TestRenderer.act(async () => {
        (tree as TestTree).update(element(brandOf({ ...NIGERIA })));
      });
      await flush();
    }
    expect(sent()).toEqual(["select_provider"]);
    expect(count(tree, "paystack-view")).toBe(1);
  });

  test("M2: Back while the automatic switch is in flight leaves at once and sends nothing else", async () => {
    const pending = deferred();
    mockInvoke.mockReturnValueOnce(pending.promise);
    tree = await mount(brandOf({ ...NIGERIA }));
    expect(count(tree, "onboard-rail-switching")).toBe(1);
    expect(count(tree, "paystack-view")).toBe(0);

    await pressLabel(tree, "Back");
    expect(onCancel).toHaveBeenCalledTimes(1);

    await TestRenderer.act(async () => {
      pending.resolve({ data: {}, error: null });
    });
    await flush();
    expect(sent()).toEqual(["select_provider"]);
  });

  test("M3: Back after the automatic switch succeeded keeps the brand on the Nigerian rail", async () => {
    tree = await mount(brandOf({ ...NIGERIA }));
    expect(count(tree, "paystack-view")).toBe(1);

    await pressLabel(tree, "Back");
    await pressLabel(tree, "Back");

    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(sent()).toEqual(["select_provider"]);
  });

  test("M4: after a failed automatic switch nothing is a dead end — a failed reversal shows, Back still leaves, and a later reversal returns the picker", async () => {
    mockInvoke.mockResolvedValueOnce(
      edgeFailure({
        error: "stamp_failed",
        detail: "paystack_provider_select_stamp_retryable",
      }),
    );
    tree = await mount(brandOf({ ...NIGERIA }));
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "onboard-rail-switch-error")).toBe(1);
    expect(count(tree, "onboard-rail-retry")).toBe(1);

    mockInvoke.mockResolvedValueOnce(
      edgeFailure({ error: "internal_error", detail: "brand_update_failed" }),
    );
    await pressId(tree, "onboard-rail-choose-country");
    expect(sent()).toEqual(["select_provider", "clear_provider"]);
    const message = textOf(only(tree, "onboard-rail-switch-error"));
    expect(message).not.toMatch(/stripe|paystack|internal_error|brand_update/i);
    expect(count(tree, "country-picker")).toBe(0);

    await pressLabel(tree, "Back");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual(["select_provider", "clear_provider"]);

    await pressId(tree, "onboard-rail-choose-country");
    expect(sent()).toEqual([
      "select_provider",
      "clear_provider",
      "clear_provider",
    ]);
    expect(count(tree, "country-picker")).toBe(1);
    expect(count(tree, "onboard-rail-switch-error")).toBe(0);
  });
});
