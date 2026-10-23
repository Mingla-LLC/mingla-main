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
    stats: { events: 0, rev: 0, rev7d: 0, attendees: 0 },
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
      // [TEST-MOD-APPROVED #3645] was `text: "GB"`: with nothing chosen the
      // row fell back to the United Kingdom. There is no default country any
      // more. Card-rail screen with NO country chosen, never Nigeria and never
      // the Nigeria confirm.
      expect(only(tree, "country-picker").props.accessibilityValue).toEqual({
        text: "",
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

// ---------------------------------------------------------------------------
// #3645 (bank setup opens on the host's chosen country; "Add bank" leads
// somewhere a bank can be added) — appended.
// ---------------------------------------------------------------------------
describe("#3645 native — the country row opens on the brand's choice, and a host who asked for a different country is not sent back to Nigeria", () => {
  let tree: TestTree | null = null;
  let queryClient: QueryClient;
  const onCancel = jest.fn();
  const onAfterDone = jest.fn();

  async function mount(
    brand: Brand,
    props: { countryChoiceRequested?: boolean; initialCountry?: string | null } = {},
  ): Promise<TestTree> {
    let mounted: TestTree | null = null;
    await TestRenderer.act(async () => {
      mounted = TestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <BrandOnboardView
            brand={brand}
            onCancel={onCancel}
            onAfterDone={onAfterDone}
            {...props}
          />
        </QueryClientProvider>,
      );
    });
    await flush();
    if (mounted === null) throw new Error("BrandOnboardView did not mount.");
    return mounted;
  }

  const pickerText = (target: TestTree): string =>
    (only(target, "country-picker").props.accessibilityValue as { text: string })
      .text;
  const allText = (target: TestTree): string => textOf(target.root);

  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    mockStripeStatus = STATUS_NO_ACCOUNT;
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

  test("N1: nothing chosen and no Nigerian address: the row is empty, never the United Kingdom", async () => {
    tree = await mount(brandOf({ countryCode: undefined }));
    expect(pickerText(tree)).toBe("");
    expect(count(tree, "paystack-view")).toBe(0);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test.each(["GB", "FR", "US"])(
    "N2: an ADDRESS in %s is not a choice: the row stays empty",
    async (countryCode) => {
      tree = await mount(brandOf({ countryCode }));
      expect(pickerText(tree)).toBe("");
    },
  );

  test("N3: the remembered pick is shown (a euro brand that picked Ireland), and outranks the address", async () => {
    tree = await mount(
      brandOf({ countryCode: "DE", defaultCurrency: "EUR", payoutCountry: "IE" }),
    );
    expect(pickerText(tree)).toBe("IE");
  });

  test("N4: a Nigerian address does NOT move a brand that already chose a country and currency", async () => {
    // Before: opening bank setup switched this brand to the Nigerian rail and
    // naira (its address), discarding the dollars it had chosen.
    tree = await mount(brandOf({ defaultCurrency: "USD" }));
    expect(requestsFor("select_provider")).toHaveLength(0);
    expect(count(tree, "paystack-view")).toBe(0);
    expect(pickerText(tree)).toBe("US");
  });

  test("N5: a brand that chose nothing and has a Nigerian address is still switched once (#3805 unchanged)", async () => {
    tree = await mount(brandOf({}));
    expect(requestsFor("select_provider")).toHaveLength(1);
    expect(count(tree, "paystack-view")).toBe(1);
  });

  test("N6: a host who came to choose a DIFFERENT country is not switched back to Nigeria; the row is empty", async () => {
    tree = await mount(brandOf({}), { countryChoiceRequested: true });
    expect(requestsFor("select_provider")).toHaveLength(0);
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "onboard-confirm-nigeria")).toBe(0);
    expect(pickerText(tree)).toBe("");
  });

  test("N7: 'Choose a different country' on the Nigerian form leaves NOTHING chosen, not the United Kingdom", async () => {
    tree = await mount(brandOf({ paymentProvider: "paystack" }));
    expect(count(tree, "paystack-view")).toBe(1);

    await TestRenderer.act(async () => {
      (only(tree as TestTree, "paystack-view").props.onCancel as () => void)();
    });
    await flush();

    expect(requestsFor("clear_provider")).toHaveLength(1);
    expect(count(tree, "paystack-view")).toBe(0);
    expect(pickerText(tree)).toBe("");
  });

  test("N8: an explicit card-rail country hint seeds the row ahead of everything saved", async () => {
    tree = await mount(brandOf({ countryCode: "FR", defaultCurrency: "USD" }), {
      initialCountry: "CA",
    });
    expect(pickerText(tree)).toBe("CA");
  });

  test("N9: no host-facing sentence on the setup screen names the payment provider", async () => {
    tree = await mount(brandOf({ countryCode: undefined }));
    const text = allText(tree);
    expect(text).toContain("Connect your bank to start getting paid");
    expect(text).toContain("our payment partner");
    expect(text).not.toMatch(/stripe|paystack/i);
  });

  test("N10: a brand that can sell but has no bank yet is asked to ADD ONE, not told it is all set", async () => {
    mockStripeStatus = {
      ...STATUS_LIVE_ACCOUNT,
      data: { ...STATUS_LIVE_ACCOUNT.data, payouts_enabled: false },
    };
    tree = await mount(brandOf({ countryCode: "GB", stripeStatus: "active" }));

    expect(count(tree, "onboard-add-bank")).toBe(1);
    const text = allText(tree);
    expect(text).toContain("Add your bank to get paid");
    expect(text).not.toContain("all set");
    expect(text).not.toMatch(/stripe|paystack/i);

    // The button opens payout account management (where a bank is entered),
    // not the screen that just said there was nothing left to do.
    await TestRenderer.act(async () => {
      await (only(tree as TestTree, "onboard-add-bank-cta").props.onPress as () =>
        Promise<void> | void)();
    });
    await flush();
    const sessionCalls = mockInvoke.mock.calls.filter(
      ([name]) => name === "brand-stripe-account-session",
    );
    expect(sessionCalls).toHaveLength(1);
    expect(sessionCalls[0]![1].body).toMatchObject({
      brand_id: BRAND_ID,
      surface: "account_management",
    });
  });

  test("N11: a brand whose payouts ARE enabled still gets the plain 'all set'", async () => {
    mockStripeStatus = STATUS_LIVE_ACCOUNT;
    tree = await mount(brandOf({ countryCode: "GB", stripeStatus: "active" }));
    expect(count(tree, "onboard-add-bank")).toBe(0);
    expect(allText(tree)).toContain("all set");
  });
});

// #3645 — BrandOnboardView restates the two "add a bank" strings instead of
// importing them (importing them moves the payout modules into the start-up
// chunk). This pins the restated copy to its owner so the two cannot drift.
describe("#3645 native — the add-bank state says exactly what the Payments card says", () => {
  test("N12: the sentence and the button label are the Payments card's own", async () => {
    const owner = jest.requireActual("../../../utils/brandPayoutVisibility") as {
      SELLING_ADD_BANK_CTA: string;
      SELLING_ADD_BANK_SUB: string;
    };
    mockStripeStatus = {
      ...STATUS_LIVE_ACCOUNT,
      data: { ...STATUS_LIVE_ACCOUNT.data, payouts_enabled: false },
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    let mounted: TestTree | null = null;
    await TestRenderer.act(async () => {
      mounted = TestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <BrandOnboardView
            brand={brandOf({ countryCode: "GB", stripeStatus: "active" })}
            onCancel={jest.fn()}
            onAfterDone={jest.fn()}
          />
        </QueryClientProvider>,
      );
    });
    await flush();
    const tree = mounted as unknown as TestTree;
    expect(textOf(tree.root)).toContain(owner.SELLING_ADD_BANK_SUB);
    expect(only(tree, "onboard-add-bank-cta").props.accessibilityLabel).toBe(
      owner.SELLING_ADD_BANK_CTA,
    );
    TestRenderer.act(() => tree.unmount());
    queryClient.clear();
  });
});

// ---------------------------------------------------------------------------
// #3645 review follow-up — appended.
// ---------------------------------------------------------------------------
describe("#3645 native — review follow-up: lock-aware country list, and an Add bank that never fails silently", () => {
  let tree: TestTree | null = null;
  let queryClient: QueryClient;

  async function mount(
    brand: Brand,
    props: { countryChoiceRequested?: boolean } = {},
  ): Promise<TestTree> {
    let mounted: TestTree | null = null;
    await TestRenderer.act(async () => {
      mounted = TestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <BrandOnboardView
            brand={brand}
            onCancel={jest.fn()}
            onAfterDone={jest.fn()}
            {...props}
          />
        </QueryClientProvider>,
      );
    });
    await flush();
    if (mounted === null) throw new Error("BrandOnboardView did not mount.");
    return mounted;
  }

  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ data: {}, error: null });
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

  test("F1: a host who came to choose a country is not shown the list until the lock state is known", async () => {
    mockStripeStatus = STATUS_LOADING;
    tree = await mount(brandOf({ countryCode: undefined }), {
      countryChoiceRequested: true,
    });
    // Still reading: the normal loading state, no country row to open.
    expect(count(tree, "onboard-awaiting-lock-state")).toBe(1);
    expect(count(tree, "country-picker")).toBe(0);
    expect(textOf(tree.root)).toContain("Checking your payout status");
  });

  test("F2: once the status is known the row appears; opened by an ordinary visit it never waited", async () => {
    mockStripeStatus = STATUS_NO_ACCOUNT;
    tree = await mount(brandOf({ countryCode: undefined }), {
      countryChoiceRequested: true,
    });
    expect(count(tree, "onboard-awaiting-lock-state")).toBe(0);
    expect(count(tree, "country-picker")).toBe(1);
    TestRenderer.act(() => tree?.unmount());

    // An ordinary visit (no request to choose) shows the row while loading,
    // exactly as before.
    mockStripeStatus = STATUS_LOADING;
    tree = await mount(brandOf({ countryCode: undefined }));
    expect(count(tree, "onboard-awaiting-lock-state")).toBe(0);
    expect(count(tree, "country-picker")).toBe(1);
  });

  test("F3: when Add bank cannot open, the host is told so in plain words and can try again", async () => {
    mockStripeStatus = {
      ...STATUS_LIVE_ACCOUNT,
      data: { ...STATUS_LIVE_ACCOUNT.data, payouts_enabled: false },
    };
    // The request answers with nothing usable (the same path a refused
    // browser window takes: the open throws and is caught).
    const quiet = jest.spyOn(console, "error").mockImplementation(() => undefined);
    tree = await mount(brandOf({ countryCode: "GB", stripeStatus: "active" }));
    expect(count(tree, "onboard-add-bank-error")).toBe(0);

    await TestRenderer.act(async () => {
      await (only(tree as TestTree, "onboard-add-bank-cta").props.onPress as () =>
        Promise<void> | void)();
    });
    await flush();

    const error = only(tree, "onboard-add-bank-error");
    expect(textOf(error)).toBe("We couldn't open bank setup. Try again.");
    expect(error.props.accessibilityRole).toBe("alert");
    // Still on the add-bank state, with its button, not "all set".
    expect(count(tree, "onboard-add-bank-cta")).toBe(1);
    expect(textOf(tree.root)).not.toContain("all set");
    quiet.mockRestore();
  });

  test("F4: a browser that refuses to open the window is a visible failure too", async () => {
    mockStripeStatus = {
      ...STATUS_LIVE_ACCOUNT,
      data: { ...STATUS_LIVE_ACCOUNT.data, payouts_enabled: false },
    };
    mockInvoke.mockResolvedValue({
      data: {
        client_secret: "cs_test",
        account_id: "acct_test",
        target_url: "https://host.usemingla.com/connect-account-management?x=1",
      },
      error: null,
    });
    const browser = jest.requireMock("expo-web-browser") as {
      openAuthSessionAsync: jest.Mock;
    };
    browser.openAuthSessionAsync.mockRejectedValueOnce(
      Object.assign(new Error("Popup window was blocked by the browser"), {
        code: "ERR_WEB_BROWSER_BLOCKED",
      }),
    );
    tree = await mount(brandOf({ countryCode: "GB", stripeStatus: "active" }));

    await TestRenderer.act(async () => {
      await (only(tree as TestTree, "onboard-add-bank-cta").props.onPress as () =>
        Promise<void> | void)();
    });
    await flush();

    expect(browser.openAuthSessionAsync).toHaveBeenCalledTimes(1);
    expect(textOf(only(tree, "onboard-add-bank-error"))).toBe(
      "We couldn't open bank setup. Try again.",
    );
  });
});
