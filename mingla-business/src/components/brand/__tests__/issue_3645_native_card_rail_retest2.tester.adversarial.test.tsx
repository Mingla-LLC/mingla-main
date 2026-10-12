/**
 * #3645 RETEST 2 — TESTER adversarial suite for the native payout screen
 * (BrandOnboardView) after the rework at 1ae2e69ed. Different angles from
 * issue_3645_native_card_rail_no_auto_switch.implementor.test.tsx: what the
 * organiser can DO while the card-rail status is unknown (confirm, double tap,
 * pick another country), the status arriving while a confirm is in flight, a
 * status that errors and later recovers, and a refused confirm.
 *
 * FAILS ON REVERT (restore BrandOnboardView.tsx from 036b3d1cf): Z1-Z6 fail —
 * the switch is sent while the status is still loading and no confirm control
 * exists.
 *
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/issue_3645_native_card_rail_retest2.tester.adversarial.test.tsx --runInBand
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
    // orch-strict-grep-allow stripe-country-out-of-scope — Nigeria is the Paystack rail, deliberately outside the Stripe allowlist.
    countryCode: "NG",
    ...patch,
  }) as Brand;

describe("#3645 retest 2 — tester adversarial: native card-rail brands and the explicit Nigeria confirm", () => {
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


  const sent = (): string[] =>
    mockInvoke.mock.calls
      .filter(([name]) => name === "brand-paystack-onboard")
      .map(([, options]) => String(options.body.action));

  const nigerian = (patch: Partial<Brand> = {}): Brand =>
    // orch-strict-grep-allow stripe-country-out-of-scope — Nigeria is the Paystack rail, deliberately outside the Stripe allowlist.
    brandOf({ countryCode: "NG", ...patch } as Partial<Brand>);

  const labelled = (target: TestTree, label: string): number =>
    hostsMatching(target, { accessibilityLabel: label }).length;

  const pickerValue = (target: TestTree): string =>
    (only(target, "country-picker").props.accessibilityValue as { text: string })
      .text;

  test("Z1: a brand row that says 'card account active' sends nothing while the status loads and nothing once it has, and is never offered Nigeria", async () => {
    mockStripeStatus = STATUS_LOADING;
    const brand = nigerian({ stripeStatus: "active" } as Partial<Brand>);
    tree = await mount(brand);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(count(tree, "onboard-confirm-nigeria")).toBe(0);
    expect(count(tree, "paystack-view")).toBe(0);

    mockStripeStatus = STATUS_LIVE_ACCOUNT;
    await rerender(tree, brand);
    await rerender(tree, brand);

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(count(tree, "onboard-confirm-nigeria")).toBe(0);
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "onboard-rail-switching")).toBe(0);
  });

  test("Z2: while the status is unknown the confirm replaces 'Set up payments'; a double tap sends one request and the status arriving mid-flight adds none", async () => {
    mockStripeStatus = STATUS_LOADING;
    tree = await mount(nigerian());
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(count(tree, "onboard-confirm-nigeria")).toBe(1);
    // Card-rail setup must never be startable with Nigeria in the country row.
    expect(labelled(tree, "Set up payments")).toBe(0);
    expect(count(tree, "paystack-view")).toBe(0);

    const pending = deferred();
    mockInvoke.mockReturnValueOnce(pending.promise);
    const confirm = only(tree, "onboard-confirm-nigeria");
    await TestRenderer.act(async () => {
      (confirm.props.onPress as () => void)();
      (confirm.props.onPress as () => void)();
    });
    await flush();
    expect(sent()).toEqual(["select_provider"]);
    expect(count(tree, "onboard-rail-switching")).toBe(1);

    // The status query now reports "no account": the automatic switch must
    // not pile a second request on top of the organiser's own.
    mockStripeStatus = STATUS_NO_ACCOUNT;
    await rerender(tree, nigerian());
    expect(sent()).toEqual(["select_provider"]);

    await TestRenderer.act(async () => {
      pending.resolve({ data: {}, error: null });
    });
    await flush();
    expect(sent()).toEqual(["select_provider"]);
    expect(count(tree, "paystack-view")).toBe(1);
    expect(count(tree, "onboard-rail-switching")).toBe(0);
  });

  test("Z3: a status query that errored sends nothing however often it re-renders; when it later succeeds with no account exactly one switch follows", async () => {
    mockStripeStatus = STATUS_ERRORED;
    tree = await mount(nigerian());
    await rerender(tree, nigerian());
    await rerender(tree, nigerian());
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(count(tree, "paystack-view")).toBe(0);

    mockStripeStatus = STATUS_NO_ACCOUNT;
    await rerender(tree, nigerian());
    await rerender(tree, nigerian());
    expect(sent()).toEqual(["select_provider"]);
    expect(count(tree, "paystack-view")).toBe(1);
  });

  test("Z4: an organiser who picked another country while the status was loading is not switched when it resolves", async () => {
    mockStripeStatus = STATUS_LOADING;
    tree = await mount(nigerian());
    await TestRenderer.act(async () => {
      (only(tree as TestTree, "country-picker").props.onChange as (c: string) => void)(
        "GB",
      );
    });
    await flush();

    mockStripeStatus = STATUS_NO_ACCOUNT;
    await rerender(tree, nigerian());
    await rerender(tree, nigerian());

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(pickerValue(tree)).toBe("GB");
    expect(labelled(tree, "Set up payments")).toBe(1);
    expect(count(tree, "onboard-confirm-nigeria")).toBe(0);
  });

  test("Z5: a stale 'not connected' row is overruled by a status that reports a live account — nothing is sent and the card country shows", async () => {
    mockStripeStatus = STATUS_LOADING;
    tree = await mount(nigerian());
    expect(count(tree, "onboard-confirm-nigeria")).toBe(1);

    mockStripeStatus = {
      ...STATUS_LIVE_ACCOUNT,
      data: {
        ...STATUS_LIVE_ACCOUNT.data,
        status: "onboarding",
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
      },
    };
    await rerender(tree, nigerian());
    await rerender(tree, nigerian());

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "onboard-confirm-nigeria")).toBe(0);
    expect(pickerValue(tree)).toBe("GB");
    expect(labelled(tree, "Set up payments")).toBe(1);
  });

  test("Z6: a refused confirm says so plainly, offers no Try again, and both ways out still work", async () => {
    mockStripeStatus = STATUS_ERRORED;
    tree = await mount(nigerian());
    mockInvoke.mockResolvedValueOnce(
      edgeFailure({ error: "forbidden", detail: "permission_denied" }),
    );
    await TestRenderer.act(async () => {
      (only(tree as TestTree, "onboard-confirm-nigeria").props.onPress as () => void)();
    });
    await flush();

    const message = textOf(only(tree, "onboard-rail-switch-error"));
    expect(message).not.toMatch(/connection|try again|stripe|paystack|forbidden/i);
    expect(count(tree, "onboard-rail-retry")).toBe(0);
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "onboard-rail-choose-country")).toBe(1);

    await TestRenderer.act(async () => {
      (hostsMatching(tree as TestTree, { accessibilityLabel: "Back" })[0].props
        .onPress as () => void)();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual(["select_provider"]);
  });
});
