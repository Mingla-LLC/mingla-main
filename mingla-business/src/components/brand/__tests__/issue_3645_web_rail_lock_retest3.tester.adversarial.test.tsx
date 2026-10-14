/**
 * #3645 RETEST 3 — TESTER adversarial suite for the Host WEB payout-rail lock
 * added at 4cbc3f8c6 (a brand with a card-rail account cannot change rail from
 * this screen). Different angles from
 * issue_3645_web_card_rail_locked.implementor.test.tsx: the lock must not cost
 * a card-rail brand anything it could do before (move between card-rail
 * countries, start card-rail setup for the country shown, leave), a brand row
 * that is still loading must not decide the lock, a `?provider=` link cannot
 * get round it, and a brand that leaves the Nigerian rail while holding a
 * card-rail account becomes locked once its row catches up.
 *
 * FAILS ON REVERT (restore BrandBankConnectBody.web.tsx from e965df38d):
 * K1-K4 fail — a Nigeria pick sends select_provider and no lock line shows.
 *
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/issue_3645_web_rail_lock_retest3.tester.adversarial.test.tsx --runInBand
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

let brandSeed: BrandSeed | null;
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

const mockStartCard = jest.fn<Promise<void>, [Record<string, unknown>]>(async () => undefined);

jest.mock("../../../utils/bankConnectFunnel", () => ({
  startStripeWebBankConnect: (input: Record<string, unknown>) => mockStartCard(input),
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

async function pickCountry(tree: TestTree, countryCode: string): Promise<void> {
  const picker = only(tree, "country-picker");
  await TestRenderer.act(async () => {
    (picker.props.onChange as (code: string) => void)(countryCode);
  });
  await flush();
}

/** Supabase's FunctionsHttpError shape: the JSON body rides on `context`. */
function edgeFailure(body: Record<string, unknown>): InvokeResult {
  const error = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    context: { json: async () => body },
  });
  return { data: null, error };
}


const LOCK_LINE =
  "This brand already has a payment account. Contact support to change country.";

describe("#3645 retest 3 — tester adversarial: the web payout-rail lock", () => {
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
      target.update(element());
    });
    await flush();
  }

  async function press(target: TestTree, testID: string): Promise<void> {
    await TestRenderer.act(async () => {
      (only(target, testID).props.onPress as () => void)();
    });
    await flush();
  }

  const seed = (patch: Partial<BrandSeed> = {}): BrandSeed => ({
    id: BRAND_ID,
    displayName: "Lagos Supper Club",
    // orch-strict-grep-allow stripe-country-out-of-scope — Nigeria is the Paystack rail, deliberately outside the Stripe allowlist.
    countryCode: "NG",
    paymentProvider: "stripe",
    accountId: USER_ID,
    stripeStatus: "not_connected",
    ...patch,
  });

  const sent = (): string[] =>
    mockInvoke.mock.calls
      .filter(([name]) => name === "brand-paystack-onboard")
      .map(([, options]) => String(options.body.action));

  const picker = (
    target: TestTree,
  ): { value: string; line: string; extras: string[] } => {
    const host = only(target, "country-picker");
    return {
      value: (host.props.accessibilityValue as { text: string }).text,
      line: String(host.props.accessibilityHint ?? ""),
      extras: (host.props.accessibilityActions as { name: string }[]).map(
        (action) => action.name,
      ),
    };
  };

  beforeEach(() => {
    params = { id: BRAND_ID };
    brandSeed = seed();
    mockStartCard.mockClear();
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
      value: {
        location: { assign: jest.fn(), origin: ORIGIN },
      },
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

  test("K1: a locked brand keeps its whole card-rail journey — Nigeria taps do nothing, card countries still change, setup starts for the country shown, Back leaves", async () => {
    brandSeed = seed({ stripeStatus: "active" });
    tree = await mountBody();
    expect(picker(tree)).toEqual({ value: "GB", line: LOCK_LINE, extras: [] });

    // However the pick arrives (the option is not offered, but a stale sheet
    // or assistive tech could still deliver it), nothing is sent or moved.
    await pickCountry(tree, "NG");
    await pickCountry(tree, " ng ");
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(picker(tree).value).toBe("GB");
    expect(count(tree, "bank-connect-primary")).toBe(1);
    expect(count(tree, "bank-connect-rail-error")).toBe(0);

    await pickCountry(tree, "US");
    expect(picker(tree).value).toBe("US");
    await pickCountry(tree, "FR");
    expect(picker(tree).value).toBe("FR");
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(count(tree, "bank-connect-primary")).toBe(1);

    await press(tree, "bank-connect-primary");
    expect(mockStartCard).toHaveBeenCalledTimes(1);
    expect(mockStartCard.mock.calls[0]![0].country).toBe("FR");

    await press(tree, "bank-connect-back");
    expect(router.replace).toHaveBeenCalledWith(`/brand/${BRAND_ID}/payments`);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test("K2: a brand row that is still loading does not decide the lock — the first row that ARRIVES does", async () => {
    brandSeed = null;
    tree = await mountBody();
    await rerender(tree);
    expect(mockInvoke).not.toHaveBeenCalled();

    brandSeed = seed({ stripeStatus: "restricted" });
    await rerender(tree);
    expect(picker(tree)).toEqual({ value: "GB", line: LOCK_LINE, extras: [] });

    await pickCountry(tree, "NG");
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "bank-connect-confirm-nigeria")).toBe(0);
  });

  test("K3: a `?provider=` link cannot get a locked brand onto the Nigerian rail, whatever its address", async () => {
    params = { id: BRAND_ID, provider: "paystack" };
    brandSeed = seed({ stripeStatus: "active", countryCode: "US" });
    tree = await mountBody();
    await rerender(tree);

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(picker(tree)).toEqual({ value: "US", line: LOCK_LINE, extras: [] });
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "bank-connect-confirm-nigeria")).toBe(0);
    expect(count(tree, "bank-connect-primary")).toBe(1);
  });

  test("K4: a brand on the Nigerian rail that also holds a card-rail account can leave Nigeria, and is locked once its row shows it has left", async () => {
    brandSeed = seed({ paymentProvider: "paystack", stripeStatus: "active" });
    tree = await mountBody();
    // On the Nigerian rail: not locked, its form is there, Nigeria is offered.
    expect(count(tree, "paystack-view")).toBe(1);
    expect(picker(tree)).toEqual({ value: "NG", line: "", extras: ["NG"] });

    await TestRenderer.act(async () => {
      (only(tree as TestTree, "paystack-view").props.onCancel as () => void)();
    });
    await flush();
    expect(sent()).toEqual(["clear_provider"]);
    expect(count(tree, "bank-connect-primary")).toBe(1);

    // The refetched row: back on the card rail, card account still there.
    brandSeed = seed({ paymentProvider: "stripe", stripeStatus: "active" });
    await rerender(tree);
    expect(picker(tree).line).toBe(LOCK_LINE);
    expect(picker(tree).extras).toEqual([]);

    await pickCountry(tree, "NG");
    expect(sent()).toEqual(["clear_provider"]);
    expect(count(tree, "paystack-view")).toBe(0);
  });

  test("K5: a brand on the Nigerian rail with a bank connected is told so when it tries to leave, and is not locked out of its form", async () => {
    brandSeed = seed({ paymentProvider: "paystack" });
    tree = await mountBody();
    mockInvoke.mockResolvedValueOnce(
      edgeFailure({ error: "conflict", detail: "disconnect_first" }),
    );

    await pickCountry(tree, "GB");
    expect(textOf(only(tree, "bank-connect-rail-error"))).toMatch(
      /already has a bank/i,
    );
    expect(count(tree, "bank-connect-rail-retry")).toBe(0);
    expect(picker(tree).line).toBe("");

    await pickCountry(tree, "NG");
    expect(sent()).toEqual(["clear_provider", "select_provider"]);
    expect(count(tree, "paystack-view")).toBe(1);
  });
});
