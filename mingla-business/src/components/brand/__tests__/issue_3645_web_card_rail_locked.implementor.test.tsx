/**
 * #3645 rework 3 (PR #3805 retest 2) — Host WEB payout setup.
 *
 * Regression introduced by this PR: a brand with a card-rail account
 * (`stripeStatus` onboarding / restricted / active) could be moved to the
 * Nigerian rail and naira by ONE tap on "Nigeria" in the country row, and
 * tapping back cleared its currency. On main the web pick was local only.
 *
 * Now, for such a brand: Nigeria is not offered in the country sheet, one
 * plain line says why, and a Nigeria pick sends nothing. A brand with no card
 * account is unchanged. The auto-switch decision is taken once, from the first
 * brand row the mount resolved, so a row flipping to "not_connected" while the
 * screen is open starts nothing.
 *
 * FAILS ON REVERT (restore BrandBankConnectBody.web.tsx from e965df38d):
 *  L1 sees select_provider (and clear_provider on the way back); L2 sees
 *  Nigeria still offered and no explanation; L4 sees a switch mid-visit.
 *
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/issue_3645_web_card_rail_locked.implementor.test.tsx --runInBand
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
      data: brandSeed,
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
      helperText?: string | null;
      extraOptions?: readonly { code: string }[];
    }) => (
      <View
        testID="country-picker"
        accessibilityHint={props.helperText ?? ""}
        accessibilityActions={(props.extraOptions ?? []).map((option) => ({
          name: option.code,
        }))}
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

describe("#3645 web rework 3 — a brand with a card-rail account cannot change rails from this screen", () => {
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

  const brandOf = (patch: Partial<BrandSeed> = {}): BrandSeed => ({
    id: BRAND_ID,
    displayName: "Lagos Supper Club",
    countryCode: null,
    paymentProvider: "stripe",
    accountId: USER_ID,
    stripeStatus: "not_connected",
    ...patch,
  });

  // orch-strict-grep-allow stripe-country-out-of-scope — Nigeria is the Paystack rail, deliberately outside the Stripe allowlist.
  const NIGERIAN_ADDRESS = { countryCode: "NG" } as const;

  const picker = (target: TestTree): TestInstance => only(target, "country-picker");
  const pickerValue = (target: TestTree): unknown =>
    (picker(target).props.accessibilityValue as { text: string }).text;
  const offeredExtras = (target: TestTree): string[] =>
    (picker(target).props.accessibilityActions as { name: string }[]).map(
      (action) => action.name,
    );

  beforeEach(() => {
    params = { id: BRAND_ID };
    brandSeed = brandOf();
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
    "L1: a brand with a %s card-rail account picking Nigeria sends nothing and stays on its card screen",
    async (stripeStatus) => {
      brandSeed = brandOf({ stripeStatus });
      tree = await mountBody();
      expect(count(tree, "bank-connect-primary")).toBe(1);

      await pickCountry(tree, "NG");
      await pickCountry(tree, "NG");

      expect(mockInvoke).not.toHaveBeenCalled();
      expect(count(tree, "bank-connect-primary")).toBe(1);
      expect(count(tree, "paystack-view")).toBe(0);
      expect(count(tree, "bank-connect-confirm-nigeria")).toBe(0);
      expect(count(tree, "bank-connect-rail-switching")).toBe(0);
      expect(count(tree, "bank-connect-rail-error")).toBe(0);
      expect(pickerValue(tree)).toBe("GB");

      // Card-rail countries still work, locally, and still send nothing.
      await pickCountry(tree, "US");
      await pickCountry(tree, "GB");
      expect(mockInvoke).not.toHaveBeenCalled();
      expect(count(tree, "bank-connect-primary")).toBe(1);
    },
  );

  test("L2: for a card-rail brand Nigeria is not offered and one plain line says why; a no-account brand still sees it", async () => {
    brandSeed = brandOf({ stripeStatus: "active" });
    tree = await mountBody();

    expect(offeredExtras(tree)).toEqual([]);
    const why = picker(tree).props.accessibilityHint as string;
    expect(why).toBe(
      "This brand already has a payment account. Contact support to change country.",
    );
    expect(why).not.toMatch(/stripe|paystack/i);

    tree.unmount();
    brandSeed = brandOf();
    tree = await mountBody();
    expect(offeredExtras(tree)).toEqual(["NG"]);
    expect(picker(tree).props.accessibilityHint).toBe("");
  });

  test("L3: a brand with NO card account is unchanged — a manual Nigeria pick sends exactly one switch", async () => {
    tree = await mountBody();
    expect(mockInvoke).not.toHaveBeenCalled();

    await pickCountry(tree, "NG");

    expect(requestsFor("select_provider")).toEqual([
      { action: "select_provider", brand_id: BRAND_ID },
    ]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(count(tree, "paystack-view")).toBe(1);
  });

  test("L4: a row that flips from a card-rail status to not_connected mid-visit starts nothing, automatically or by a tap", async () => {
    brandSeed = brandOf({ ...NIGERIAN_ADDRESS, stripeStatus: "active" });
    tree = await mountBody();
    expect(mockInvoke).not.toHaveBeenCalled();

    brandSeed = brandOf({ ...NIGERIAN_ADDRESS, stripeStatus: "not_connected" });
    await rerender(tree);
    await rerender(tree);

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "bank-connect-rail-switching")).toBe(0);
    expect(count(tree, "bank-connect-primary")).toBe(1);

    await pickCountry(tree, "NG");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test("L5: a brand already on the Nigerian rail is not locked out of its own form or of leaving it", async () => {
    brandSeed = brandOf({ ...NIGERIAN_ADDRESS, paymentProvider: "paystack", stripeStatus: "active" });
    tree = await mountBody();
    expect(count(tree, "paystack-view")).toBe(1);
    expect(offeredExtras(tree)).toEqual(["NG"]);

    await pickCountry(tree, "GB");

    expect(requestsFor("clear_provider")).toHaveLength(1);
  });
});
