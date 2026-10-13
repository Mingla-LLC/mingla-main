/**
 * #3645 rework (PR #3805 tester P1-1 + P1-2) — NATIVE payout setup
 * (BrandOnboardView), behavioural proof.
 *
 *  P1-1  The top-bar Back on the Nigeria bank form used to call
 *        clear_provider, moving a Nigerian brand with no bank back to the card
 *        rail (the opposite of sell-before-bank) and trapping the organiser if
 *        the clear failed. Back now leaves the screen and sends NOTHING; only
 *        the form's explicit "choose a different country" clears.
 *  P1-2  A brand whose address says Nigeria but which is not yet on the
 *        Nigerian rail gets the switch automatically, once, before the form.
 *
 * Mounts the PRODUCTION BrandOnboardView with the REAL useBrandPaystack hooks,
 * the REAL brandPaystackService and a REAL QueryClient; only the Supabase
 * client is stubbed, so each assertion is about the request that would leave
 * the device. Stock node/ts-jest Business gate (react-test-renderer).
 *
 * FAILS ON REVERT (restore BrandOnboardView.tsx from 0fbf04adf):
 *  N1 sees a clear_provider request on Back; N3 is trapped (onCancel never
 *  called); N4/N6 see zero select_provider and the form on first paint.
 *
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/issue_3645_native_back_and_auto_switch.implementor.test.tsx --runInBand
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

function requestsFor(action: string): Record<string, unknown>[] {
  return mockInvoke.mock.calls
    .filter(([name, options]) =>
      name === "brand-paystack-onboard" && options.body.action === action)
    .map(([, options]) => options.body);
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
    stats: { events: 0, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
    currentLiveEvent: null,
    paymentProvider: "stripe",
    stripeStatus: "not_connected",
    ...patch,
  }) as Brand;

// orch-strict-grep-allow stripe-country-out-of-scope — Nigeria is the Paystack rail, deliberately outside the Stripe allowlist.
const NIGERIA = { countryCode: "NG" } as const;

describe("#3645 native rework — Back leaves, only the explicit choice clears, address-Nigeria switches once", () => {
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

  async function cancelForm(target: TestTree): Promise<void> {
    await TestRenderer.act(async () => {
      (only(target, "paystack-view").props.onCancel as () => void)();
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

  test("N1: Back on the Nigeria form leaves the screen and sends no clear_provider", async () => {
    tree = await mount(brandOf({ ...NIGERIA, paymentProvider: "paystack" }));
    expect(count(tree, "paystack-view")).toBe(1);
    // Already on the Nigerian rail: nothing to switch.
    expect(mockInvoke).not.toHaveBeenCalled();

    await pressLabel(tree, "Back");

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(requestsFor("clear_provider")).toEqual([]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test("N2: the form's 'choose a different country' is what clears, then the picker returns", async () => {
    tree = await mount(brandOf({ ...NIGERIA, paymentProvider: "paystack" }));

    await cancelForm(tree);

    expect(requestsFor("clear_provider")).toEqual([
      { action: "clear_provider", brand_id: BRAND_ID },
    ]);
    expect(onCancel).not.toHaveBeenCalled();
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "country-picker")).toBe(1);
  });

  test.each([
    ["offline", { data: null, error: new TypeError("Network request failed") }],
    [
      "a bank is already connected (409)",
      edgeFailure({ error: "conflict", detail: "disconnect_first" }),
    ],
  ] as [string, InvokeResult][])(
    "N3: when the clear fails (%s) the error shows and Back still leaves",
    async (_label, failure) => {
      tree = await mount(brandOf({ ...NIGERIA, paymentProvider: "paystack" }));
      mockInvoke.mockResolvedValueOnce(failure);

      await cancelForm(tree);

      const message = textOf(only(tree, "onboard-rail-switch-error"));
      expect(message.trim().length).toBeGreaterThan(20);
      expect(message).not.toMatch(/stripe|paystack|clear_?provider|disconnect_first/i);
      // Still on the form, not silently on the other rail.
      expect(count(tree, "paystack-view")).toBe(1);

      await pressLabel(tree, "Back");

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(requestsFor("clear_provider")).toHaveLength(1);
    },
  );

  test("N4: a Nigeria-by-address brand on the card rail sends exactly one select_provider on mount, form only after success", async () => {
    const pending = deferred();
    mockInvoke.mockReturnValueOnce(pending.promise);

    tree = await mount(brandOf({ ...NIGERIA }));

    expect(requestsFor("select_provider")).toEqual([
      { action: "select_provider", brand_id: BRAND_ID },
    ]);
    expect(count(tree, "onboard-rail-switching")).toBe(1);
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "country-picker")).toBe(0);

    await TestRenderer.act(async () => {
      pending.resolve({ data: {}, error: null });
    });
    await flush();

    expect(count(tree, "paystack-view")).toBe(1);
    expect(count(tree, "onboard-rail-switching")).toBe(0);

    // The refetched brand row and further renders never repeat it.
    await TestRenderer.act(async () => {
      (tree as TestTree).update(
        element(brandOf({ ...NIGERIA, paymentProvider: "paystack" })),
      );
    });
    await flush();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  test("N5: a brand that already has a card-rail payout account is not auto-switched", async () => {
    mockStripeStatus = { data: { stripe_account_id: "acct_test", country: "GB" } };

    tree = await mount(brandOf({ ...NIGERIA }));

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test("N6: a failed automatic switch withholds the form; Try again recovers, and a permission refusal offers no Try again", async () => {
    mockInvoke.mockResolvedValueOnce(
      edgeFailure({
        error: "stamp_failed",
        detail: "paystack_provider_select_stamp_retryable",
      }),
    );
    tree = await mount(brandOf({ ...NIGERIA }));

    expect(requestsFor("select_provider")).toHaveLength(1);
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "onboard-rail-switch-error")).toBe(1);
    expect(count(tree, "onboard-rail-retry")).toBe(1);

    await TestRenderer.act(async () => {
      (only(tree as TestTree, "onboard-rail-retry").props.onPress as () => void)();
    });
    await flush();
    expect(requestsFor("select_provider")).toHaveLength(2);
    expect(count(tree, "paystack-view")).toBe(1);

    tree.unmount();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValueOnce(
      edgeFailure({ error: "forbidden", detail: "permission_denied" }),
    );
    tree = await mount(brandOf({ ...NIGERIA }));

    const message = textOf(only(tree, "onboard-rail-switch-error"));
    expect(message).toMatch(/only the brand owner/i);
    expect(message).not.toMatch(/connection|try again|forbidden/i);
    expect(count(tree, "onboard-rail-retry")).toBe(0);
    expect(count(tree, "paystack-view")).toBe(0);
    // Never trapped: Back leaves, sending nothing more.
    await pressLabel(tree, "Back");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  test("N7: two Nigeria picks in the same tick send one select_provider", async () => {
    tree = await mount(brandOf({}));
    expect(mockInvoke).not.toHaveBeenCalled();
    const onChange = only(tree, "country-picker").props.onChange as (
      code: string,
    ) => void;

    await TestRenderer.act(async () => {
      onChange("NG");
      onChange("NG");
    });
    await flush();

    expect(requestsFor("select_provider")).toHaveLength(1);
    expect(count(tree, "paystack-view")).toBe(1);
  });
});
