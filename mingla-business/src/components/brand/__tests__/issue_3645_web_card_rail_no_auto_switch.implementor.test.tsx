/**
 * #3645 rework 2 (PR #3805 retest P1) — Host WEB payout setup.
 *
 * The automatic Nigeria switch must fire ONLY for a brand positively known to
 * have no card-rail account. Opening payout setup used to send select_provider
 * for a brand with a Nigerian address and a LIVE card account, moving it onto
 * the Nigerian rail and naira.
 *
 * This screen has no status query (adding one breaks the pinned #948 suites),
 * so the evidence is the brand row's `stripeStatus` as useBrand returns it:
 * anything other than "not_connected" means a card-rail account exists.
 *
 * FAILS ON REVERT (restore BrandBankConnectBody.web.tsx from 036b3d1cf):
 *  C1/C2 see a select_provider request on mount; C4 sees the Nigerian bank
 *  form with no switch and no confirm control.
 *
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/issue_3645_web_card_rail_no_auto_switch.implementor.test.tsx --runInBand
 */

/* eslint-disable @typescript-eslint/no-require-imports, import/first */

import React from "react";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const BRAND_ID = "2b7c8f6a-1111-4a22-8333-123456789abc";
const USER_ID = "79f45786-2222-4b33-8444-123456789abc";
const ORIGIN = "https://host.usemingla.com";

interface BrandSeed {
  id: string;
  displayName: string;
  countryCode: string | null;
  paymentProvider: string | null;
  accountId?: string;
  stripeStatus?: "not_connected" | "onboarding" | "active" | "restricted";
}

let brandSeed: BrandSeed;
let params: { id: string; provider?: string; from?: string };

const router = {
  back: jest.fn(),
  canGoBack: jest.fn(() => false),
  replace: jest.fn(),
};

interface InvokeResult {
  data: unknown;
  error: unknown;
}

const mockInvoke = jest.fn<Promise<InvokeResult>, [string, { body: Record<string, unknown> }]>();

// [TEST-MOD-APPROVED #3645] Bank setup no longer opens on the United Kingdom by
// default, nor on the brand's ADDRESS country. It opens on the country the
// brand CHOSE, which for a brand with a card-rail account is the country of
// that account's currency, and on nothing at all when nothing was chosen.
// The fixtures below describe brands WITH a card-rail account but gave them no
// currency, which no real brand with an account has. The row handed to the
// screen is completed here, so every assertion keeps its meaning: such a brand
// stays on its own card-rail country and is never moved to Nigeria.
const mockAccountCurrencyRows = new WeakMap<object, object>();
function mockWithAccountCurrency<
  T extends {
    countryCode: string | null;
    stripeStatus?: string;
    defaultCurrency?: string | null;
  },
>(seed: T | null): T | null {
  if (seed === null) return null;
  const hasCardAccount =
    seed.stripeStatus !== undefined && seed.stripeStatus !== "not_connected";
  if (!hasCardAccount || seed.defaultCurrency !== undefined) return seed;
  const known = mockAccountCurrencyRows.get(seed);
  if (known !== undefined) return known as T;
  const completed = {
    ...seed,
    defaultCurrency: seed.countryCode === "US" ? "USD" : "GBP",
  };
  mockAccountCurrencyRows.set(seed, completed);
  return completed;
}

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => params,
  useRouter: () => router,
}));

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: USER_ID } }),
}));

// useBrandPaystack reads `brandKeys` off hooks/useBrands; the screen reads the
// same factory off hooks/brandKeys. Hand both the ONE real factory so the
// invalidation assertion below is against the shipped keys.
jest.mock("../../../hooks/useBrands", () => {
  const { brandKeys } = jest.requireActual("../../../hooks/brandKeys");
  return {
    brandKeys,
    useBrand: () => ({
      data: mockWithAccountCurrency(brandSeed),
      isError: false,
      isFetched: true,
      isLoading: false,
      refetch: jest.fn(),
    }),
  };
});

jest.mock("../../../hooks/useMinglaToSAcceptance", () => ({
  CURRENT_MINGLA_TOS_VERSION: "1.0",
  ORGANISER_TERMS_URL: "https://usemingla.com/organiser-terms",
  useAcceptMinglaToS: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(),
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: "success" },
}));

jest.mock("../../../services/brandStripeService", () => ({
  startBrandStripeOnboarding: jest.fn(),
}));

jest.mock("../../../utils/bankConnectFunnel", () => ({
  startStripeWebBankConnect: jest.fn(),
}));

jest.mock("../../../services/supabase", () => ({
  supabase: {
    from: jest.fn(),
    channel: jest.fn(() => ({ on: jest.fn().mockReturnThis(), subscribe: jest.fn() })),
    removeChannel: jest.fn(),
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
      accessibilityLabel,
      disabled,
      label,
      onPress,
      testID,
    }: {
      accessibilityLabel?: string;
      disabled?: boolean;
      label: string;
      onPress: () => void | Promise<void>;
      testID?: string;
    }) => (
      <Pressable
        accessibilityLabel={accessibilityLabel}
        disabled={disabled}
        onPress={onPress}
        testID={testID}
      >
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});

jest.mock("../../ui/GlassCard", () => {
  const { View } = require("react-native");
  return {
    GlassCard: ({
      children,
      testID,
    }: {
      children?: React.ReactNode;
      testID?: string;
    }) => <View testID={testID}>{children}</View>,
  };
});

jest.mock("../../ui/Icon", () => {
  const { View } = require("react-native");
  return { Icon: ({ name }: { name: string }) => <View testID={`icon-${name}`} /> };
});

jest.mock("../../ui/Spinner", () => {
  const { View } = require("react-native");
  return { Spinner: () => <View testID="spinner" /> };
});

jest.mock("../../invite/BusinessAppDownloadCta", () => {
  const { View } = require("react-native");
  return { BusinessAppDownloadCta: () => <View testID="download-cta" /> };
});

// The picker and the Nigerian bank form are reduced to inert hosts that keep
// the two callbacks the screen wires: the picker's onChange and the form's
// onCancel ("Choose a different country").
jest.mock("../BrandStripeCountryPicker", () => {
  const { View } = require("react-native");
  return {
    BrandStripeCountryPicker: (props: {
      value: string | null;
      onChange: (countryCode: string) => void;
      disabled?: boolean;
    }) => (
      <View
        testID="country-picker"
        accessibilityValue={{ text: props.value ?? "" }}
        accessibilityState={{ disabled: props.disabled === true }}
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

import BrandBankConnectBody from "../BrandBankConnectBody.web";

interface TestInstance {
  type: unknown;
  children: (TestInstance | string)[];
  props: Record<string, unknown>;
  findAllByProps: (props: Record<string, unknown>) => TestInstance[];
}

interface TestTree {
  root: TestInstance;
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

async function pickCountry(tree: TestTree, countryCode: string): Promise<void> {
  const picker = only(tree, "country-picker");
  await TestRenderer.act(async () => {
    (picker.props.onChange as (code: string) => void)(countryCode);
  });
  await flush();
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

const OTHER_USER_ID = "11111111-2222-4b33-8444-123456789abc";

describe("#3645 web rework 2 — a brand with a card-rail account is never switched by opening payout setup", () => {
  let tree: TestTree | null = null;
  let queryClient: QueryClient;

  const element = (): React.ReactElement => (
    <QueryClientProvider client={queryClient}>
      <BrandBankConnectBody />
    </QueryClientProvider>
  );

  async function mountBody(): Promise<TestTree> {
    let mounted: TestTree | null = null;
    await TestRenderer.act(async () => {
      mounted = TestRenderer.create(element());
    });
    await flush();
    if (mounted === null) throw new Error("Bank-connect body did not mount.");
    return mounted;
  }

  async function rerender(target: TestTree): Promise<void> {
    await TestRenderer.act(async () => {
      (target as TestTree & { update: (el: React.ReactElement) => void }).update(
        element(),
      );
    });
    await flush();
  }

  const nigerianAddress = (patch: Partial<BrandSeed> = {}): BrandSeed => ({
    id: BRAND_ID,
    displayName: "Lagos Supper Club",
    // orch-strict-grep-allow stripe-country-out-of-scope — Nigeria is the Paystack rail, deliberately outside the Stripe allowlist.
    countryCode: "NG",
    paymentProvider: "stripe",
    accountId: USER_ID,
    stripeStatus: "not_connected",
    ...patch,
  });

  const pickerValue = (target: TestTree): unknown =>
    (only(target, "country-picker").props.accessibilityValue as { text: string })
      .text;

  beforeEach(() => {
    params = { id: BRAND_ID };
    brandSeed = nigerianAddress();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    router.back.mockClear();
    router.replace.mockClear();
    router.canGoBack.mockReturnValue(false);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { assign: jest.fn(), origin: ORIGIN } },
      writable: true,
    });
  });

  afterEach(() => {
    if (tree !== null) {
      TestRenderer.act(() => tree?.unmount());
      tree = null;
    }
    queryClient.clear();
  });

  test.each(["active", "onboarding", "restricted"] as const)(
    "C1/C2: a %s card-rail account with a Nigerian address sends nothing and lands on the card-rail screen",
    async (stripeStatus) => {
      brandSeed = nigerianAddress({ stripeStatus });

      tree = await mountBody();
      await rerender(tree);
      await rerender(tree);

      expect(mockInvoke).not.toHaveBeenCalled();
      expect(count(tree, "bank-connect-rail-switching")).toBe(0);
      expect(count(tree, "paystack-view")).toBe(0);
      expect(count(tree, "bank-connect-confirm-nigeria")).toBe(0);
      // Its existing card-rail screen, on a card-rail country.
      expect(count(tree, "bank-connect-primary")).toBe(1);
      expect(pickerValue(tree)).toBe("GB");
    },
  );

  test("C3: the owner of a brand with NO card-rail account still gets exactly one switch", async () => {
    tree = await mountBody();
    await rerender(tree);

    expect(requestsFor("select_provider")).toEqual([
      { action: "select_provider", brand_id: BRAND_ID },
    ]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(count(tree, "paystack-view")).toBe(1);
  });

  test("C4: when nothing is switched automatically the bank form is NOT shown; Nigeria needs an explicit confirm", async () => {
    brandSeed = nigerianAddress({ accountId: OTHER_USER_ID });

    tree = await mountBody();

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(count(tree, "paystack-view")).toBe(0);
    // Never the card-rail setup for Nigeria either.
    expect(count(tree, "bank-connect-primary")).toBe(0);
    expect(pickerValue(tree)).toBe("NG");
    expect(count(tree, "bank-connect-confirm-nigeria")).toBe(1);

    await TestRenderer.act(async () => {
      (only(tree as TestTree, "bank-connect-confirm-nigeria").props.onPress as () => void)();
    });
    await flush();

    expect(requestsFor("select_provider")).toHaveLength(1);
    expect(count(tree, "paystack-view")).toBe(1);
  });

  // Rework 3: this used to document that a MANUAL Nigeria pick by a card-rail
  // brand sent the switch. That was the regression; it now sends nothing. The
  // full proof is issue_3645_web_card_rail_locked.implementor.test.tsx.
  test("C5: a MANUAL Nigeria pick by a card-rail brand sends nothing", async () => {
    brandSeed = nigerianAddress({ countryCode: null, stripeStatus: "active" });
    tree = await mountBody();
    expect(mockInvoke).not.toHaveBeenCalled();

    await pickCountry(tree, "NG");

    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
