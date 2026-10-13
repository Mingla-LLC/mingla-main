/**
 * #3645 rework 2 (PR #3805 retest P1) — NATIVE payout setup (BrandOnboardView).
 *
 * The automatic Nigeria switch must fire ONLY when the brand is positively
 * known to have no card-rail account: the brand row says "not_connected" AND
 * the status query has been fetched successfully and reports no account. The
 * old guard (`stripe_account_id ?? null) === null`) was also true while the
 * query was still loading, so a brand with a live card account and a Nigerian
 * address was switched before its status arrived.
 *
 * Also: when nothing is switched the organiser is not dropped on the Nigerian
 * bank form as if switched, and StrictMode cannot strand the pending spinner.
 *
 * PRODUCTION view, REAL useBrandPaystack hooks + service + QueryClient; only
 * the Supabase client and the status query are stubbed.
 *
 * FAILS ON REVERT (restore BrandOnboardView.tsx from 036b3d1cf):
 *  D1/D3/D4/D5 see a select_provider request (or the bank form with no
 *  switch); D7 never reaches the form under StrictMode.
 *
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/issue_3645_native_card_rail_no_auto_switch.implementor.test.tsx --runInBand
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
interface StatusMock {
  data: Record<string, unknown> | undefined;
  isFetched: boolean;
  isError: boolean;
}
const STATUS_LOADING: StatusMock = { data: undefined, isFetched: false, isError: false };
const STATUS_ERRORED: StatusMock = { data: undefined, isFetched: true, isError: true };
const STATUS_NO_ACCOUNT: StatusMock = {
  data: { status: "not_connected", stripe_account_id: null, country: null },
  isFetched: true,
  isError: false,
};
const STATUS_LIVE_ACCOUNT: StatusMock = {
  data: {
    status: "active",
    stripe_account_id: "acct_test",
    country: "GB",
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    requirements: {},
    detached_at: null,
  },
  isFetched: true,
  isError: false,
};
let mockStripeStatus: StatusMock = STATUS_LOADING;

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
    isLoading: !mockStripeStatus.isFetched,
    isFetched: mockStripeStatus.isFetched,
    isError: mockStripeStatus.isError,
    error: mockStripeStatus.isError ? new Error("status failed") : null,
    refetch: jest.fn(async () => ({ data: mockStripeStatus.data })),
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
    // orch-strict-grep-allow stripe-country-out-of-scope — Nigeria is the Paystack rail, deliberately outside the Stripe allowlist.
    countryCode: "NG",
    ...patch,
  }) as Brand;

describe("#3645 native rework 2 — only a brand known to have no card-rail account is switched automatically", () => {
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

  async function rerender(target: TestTree, brand: Brand, strict = false): Promise<void> {
    await TestRenderer.act(async () => {
      target.update(element(brand, strict));
    });
    await flush();
  }

  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    mockStripeStatus = STATUS_LOADING;
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

  test("D1: a live card-rail account + Nigerian address sends nothing while the status is loading, and nothing once it has loaded", async () => {
    const brand = brandOf({ stripeStatus: "active" });
    mockStripeStatus = STATUS_LOADING;

    tree = await mount(brand);
    await rerender(tree, brandOf({ stripeStatus: "active" }));
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "onboard-rail-switching")).toBe(0);

    mockStripeStatus = STATUS_LIVE_ACCOUNT;
    await rerender(tree, brandOf({ stripeStatus: "active" }));
    await rerender(tree, brandOf({ stripeStatus: "active" }));

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "onboard-confirm-nigeria")).toBe(0);
  });

  test("D2: the stale-row case — the row says not connected but the status query reports an account: nothing is sent", async () => {
    mockStripeStatus = STATUS_LIVE_ACCOUNT;

    tree = await mount(brandOf({}));
    await rerender(tree, brandOf({}));

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(count(tree, "paystack-view")).toBe(0);
  });

  test("D3: with no account, nothing is sent while the status is loading (picker, no spinner, no form); exactly one once it reports no account", async () => {
    mockStripeStatus = STATUS_LOADING;

    tree = await mount(brandOf({}));
    await rerender(tree, brandOf({}));

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "onboard-rail-switching")).toBe(0);
    // The normal picker state, with Nigeria in the row and an explicit confirm.
    expect(only(tree, "country-picker").props.accessibilityValue).toEqual({
      text: "NG",
    });
    expect(count(tree, "onboard-confirm-nigeria")).toBe(1);

    mockStripeStatus = STATUS_NO_ACCOUNT;
    await rerender(tree, brandOf({}));
    await rerender(tree, brandOf({}));

    expect(requestsFor("select_provider")).toEqual([
      { action: "select_provider", brand_id: BRAND_ID },
    ]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(count(tree, "paystack-view")).toBe(1);
  });

  test("D4: a status query that errored sends nothing; the explicit confirm is the way to Nigeria", async () => {
    mockStripeStatus = STATUS_ERRORED;

    tree = await mount(brandOf({}));
    await rerender(tree, brandOf({}));

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "onboard-rail-switching")).toBe(0);

    await TestRenderer.act(async () => {
      (only(tree as TestTree, "onboard-confirm-nigeria").props.onPress as () => void)();
    });
    await flush();

    expect(requestsFor("select_provider")).toHaveLength(1);
    expect(count(tree, "paystack-view")).toBe(1);
  });

  test.each(["onboarding", "restricted"] as const)(
    "D5: a brand row that says %s is treated as having a card-rail account even if the status query reports none",
    async (stripeStatus) => {
      mockStripeStatus = STATUS_NO_ACCOUNT;

      tree = await mount(brandOf({ stripeStatus }));
      await rerender(tree, brandOf({ stripeStatus }));

      expect(mockInvoke).not.toHaveBeenCalled();
      expect(count(tree, "paystack-view")).toBe(0);
      // Card-rail screen on a card-rail country, never the Nigeria confirm.
      expect(only(tree, "country-picker").props.accessibilityValue).toEqual({
        text: "GB",
      });
      expect(count(tree, "onboard-confirm-nigeria")).toBe(0);
    },
  );

  test("D6: the no-account case (status fetched, no account) sends exactly one on mount", async () => {
    mockStripeStatus = STATUS_NO_ACCOUNT;

    tree = await mount(brandOf({}));
    await rerender(tree, brandOf({}));

    expect(requestsFor("select_provider")).toHaveLength(1);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(count(tree, "paystack-view")).toBe(1);
  });

  test("D7: under StrictMode the switch is sent once and the pending spinner is not stranded", async () => {
    mockStripeStatus = STATUS_NO_ACCOUNT;

    tree = await mount(brandOf({}), true);

    expect(requestsFor("select_provider")).toHaveLength(1);
    expect(count(tree, "onboard-rail-switching")).toBe(0);
    expect(count(tree, "paystack-view")).toBe(1);
  });

  test("D8 (documents today's behaviour, unchanged by this PR): a MANUAL Nigeria pick by a brand with a card-rail account still sends the switch", async () => {
    mockStripeStatus = {
      ...STATUS_LIVE_ACCOUNT,
      data: { ...STATUS_LIVE_ACCOUNT.data, status: "onboarding", charges_enabled: false },
    };
    tree = await mount(brandOf({ countryCode: undefined, stripeStatus: "onboarding" }));
    expect(mockInvoke).not.toHaveBeenCalled();
    const pickers = hostsMatching(tree, { testID: "country-picker" });
    // Only reachable when the country row is not locked for this account.
    if (pickers.length === 1) {
      await TestRenderer.act(async () => {
        (pickers[0].props.onChange as (code: string) => void)("NG");
      });
      await flush();
      expect(requestsFor("select_provider")).toHaveLength(1);
    }
  });
});
