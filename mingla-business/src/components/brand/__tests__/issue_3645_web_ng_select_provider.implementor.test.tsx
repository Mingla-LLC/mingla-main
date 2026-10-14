/**
 * #3645 — Host WEB payout setup: picking Nigeria must put the brand on the
 * Nigerian payout rail straight away (edge `brand-paystack-onboard`, action
 * `select_provider`) so it can sell before a bank exists.
 *
 * Mounts the PRODUCTION BrandBankConnectBody.web with the REAL
 * useSelectPaystackProvider / useClearPaystackProvider hooks, the REAL
 * brandPaystackService and a REAL QueryClient. Only the Supabase client is
 * stubbed, so each test asserts the request that would leave the browser.
 * Runs under the stock node/ts-jest Business gate, same harness as
 * issue_948_web_skip_download.render.tester.test.tsx.
 *
 * FAILS ON REVERT:
 *  - T1: restore the old handleCountryChange (local state only) → no
 *    `select_provider` request is ever sent.
 *  - T2: show the bank form without waiting for the switch → the form renders
 *    on a failed switch and no error is visible.
 *  - T3/T4: drop the clear on a non-Nigeria pick / form cancel → no
 *    `clear_provider` request.
 *  - T5: swallow a clear failure → no error is visible.
 *
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/issue_3645_web_ng_select_provider.implementor.test.tsx --runInBand
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
import { brandKeys } from "../../../hooks/brandKeys";

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

describe("#3645 web — picking Nigeria switches the brand's payout rail", () => {
  let tree: TestTree | null = null;
  let queryClient: QueryClient;
  let invalidateSpy: jest.SpyInstance;

  async function mountBody(): Promise<TestTree> {
    let mounted: TestTree | null = null;
    await TestRenderer.act(async () => {
      mounted = TestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <BrandBankConnectBody />
        </QueryClientProvider>,
      );
    });
    await flush();
    if (mounted === null) throw new Error("Bank-connect body did not mount.");
    return mounted;
  }

  beforeEach(() => {
    params = { id: BRAND_ID };
    brandSeed = {
      id: BRAND_ID,
      displayName: "Lagos Supper Club",
      countryCode: null,
      paymentProvider: "stripe",
    };
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    router.back.mockClear();
    router.replace.mockClear();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
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

  test("T1: picking Nigeria sends select_provider, then shows the bank form and refreshes the brand", async () => {
    tree = await mountBody();
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "bank-connect-primary")).toBe(1);
    expect(mockInvoke).not.toHaveBeenCalled();

    await pickCountry(tree, "NG");

    expect(requestsFor("select_provider")).toEqual([
      { action: "select_provider", brand_id: BRAND_ID },
    ]);
    expect(requestsFor("clear_provider")).toEqual([]);
    expect(count(tree, "paystack-view")).toBe(1);
    expect(count(tree, "bank-connect-primary")).toBe(0);
    expect(count(tree, "bank-connect-rail-error")).toBe(0);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: brandKeys.detail(BRAND_ID),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: brandKeys.lists() });
  });

  test("T2: a failed switch is shown, and neither the bank form nor the card-rail CTA appears", async () => {
    mockInvoke.mockResolvedValue(
      edgeFailure({
        error: "stamp_failed",
        detail: "paystack_provider_select_stamp_retryable",
      }),
    );
    tree = await mountBody();

    await pickCountry(tree, "NG");

    expect(requestsFor("select_provider")).toHaveLength(1);
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "bank-connect-primary")).toBe(0);
    const message = textOf(only(tree, "bank-connect-rail-error"));
    expect(message.length).toBeGreaterThan(0);
    // Product decision 2026-10-12: organiser copy never names a provider, and
    // the raw service error (function + provider names) is never echoed.
    expect(message).not.toMatch(/stripe|paystack|select_?provider|stamp/i);

    // "Try again" re-sends the same switch; success then reveals the form.
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    await TestRenderer.act(async () => {
      (only(tree as TestTree, "bank-connect-rail-retry").props.onPress as () => void)();
    });
    await flush();
    expect(requestsFor("select_provider")).toHaveLength(2);
    expect(count(tree, "bank-connect-rail-error")).toBe(0);
    expect(count(tree, "paystack-view")).toBe(1);
  });

  test("T3: picking another country after Nigeria sends clear_provider and keeps that country", async () => {
    tree = await mountBody();
    await pickCountry(tree, "NG");
    expect(count(tree, "paystack-view")).toBe(1);

    await pickCountry(tree, "US");

    expect(requestsFor("clear_provider")).toEqual([
      { action: "clear_provider", brand_id: BRAND_ID },
    ]);
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "bank-connect-primary")).toBe(1);
    expect(only(tree, "country-picker").props.accessibilityValue).toEqual({
      text: "US",
    });
  });

  test("T4: the bank form's 'choose a different country' sends clear_provider", async () => {
    brandSeed = { ...brandSeed, paymentProvider: "paystack" };
    tree = await mountBody();
    // A brand already on the rail opens on the form without a new request.
    expect(count(tree, "paystack-view")).toBe(1);
    expect(mockInvoke).not.toHaveBeenCalled();

    await TestRenderer.act(async () => {
      (only(tree as TestTree, "paystack-view").props.onCancel as () => void)();
    });
    await flush();

    expect(requestsFor("clear_provider")).toEqual([
      { action: "clear_provider", brand_id: BRAND_ID },
    ]);
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "bank-connect-primary")).toBe(1);
  });

  test("T5: a failed clear is shown instead of silently presenting the other rail", async () => {
    brandSeed = { ...brandSeed, paymentProvider: "paystack" };
    mockInvoke.mockResolvedValue(
      edgeFailure({ error: "conflict", detail: "disconnect_first" }),
    );
    tree = await mountBody();

    await pickCountry(tree, "GB");

    expect(requestsFor("clear_provider")).toHaveLength(1);
    expect(count(tree, "bank-connect-primary")).toBe(0);
    const message = textOf(only(tree, "bank-connect-rail-error"));
    expect(message).toMatch(/bank connected/i);
    expect(message).not.toMatch(/stripe|paystack|disconnect_first/i);
  });

  test("T6: switching between two non-Nigeria countries sends nothing", async () => {
    tree = await mountBody();

    await pickCountry(tree, "US");

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(count(tree, "bank-connect-primary")).toBe(1);
    expect(count(tree, "bank-connect-rail-error")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #3645 (bank setup opens on the host's chosen country) — appended.
//
// The country row used to open on the brand's ADDRESS country, and on the
// United Kingdom when there was none; "Choose a different country" reset it to
// the United Kingdom. It now opens on the country the brand CHOSE (an explicit
// hint, else its remembered pick, else what its currency names) and on NOTHING
// otherwise; the primary button stays off until a country is picked.
// ---------------------------------------------------------------------------
describe("#3645 web — bank setup opens on the chosen country, never on a default", () => {
  let tree: TestTree | null = null;
  let queryClient: QueryClient;

  type ChosenSeed = BrandSeed & {
    defaultCurrency?: string | null;
    payoutCountry?: string | null;
  };
  const seedWith = (patch: Partial<ChosenSeed>): BrandSeed =>
    ({
      id: BRAND_ID,
      displayName: "Harbour Supper Club",
      countryCode: null,
      paymentProvider: "stripe",
      ...patch,
    }) as BrandSeed;

  async function mountBody(): Promise<TestTree> {
    let mounted: TestTree | null = null;
    await TestRenderer.act(async () => {
      mounted = TestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <BrandBankConnectBody />
        </QueryClientProvider>,
      );
    });
    await flush();
    if (mounted === null) throw new Error("Bank-connect body did not mount.");
    return mounted;
  }

  const pickerValue = (target: TestTree): string =>
    (only(target, "country-picker").props.accessibilityValue as { text: string })
      .text;
  const startCard = (): jest.Mock =>
    (jest.requireMock("../../../utils/bankConnectFunnel") as {
      startStripeWebBankConnect: jest.Mock;
    }).startStripeWebBankConnect;

  beforeEach(() => {
    params = { id: BRAND_ID };
    brandSeed = seedWith({});
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    startCard().mockReset();
    router.back.mockClear();
    router.replace.mockClear();
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

  test("S1: a brand that has chosen nothing opens on no country, and setup cannot start", async () => {
    tree = await mountBody();

    expect(pickerValue(tree)).toBe("");
    const primary = only(tree, "bank-connect-primary");
    expect(primary.props.disabled).toBe(true);
    expect(primary.props.accessibilityLabel).toBe(
      "Choose a country first, then add bank details",
    );
    // Even if the press arrives (assistive tech, a stale handler), nothing starts.
    await TestRenderer.act(async () => {
      await (primary.props.onPress as () => Promise<void> | void)();
    });
    expect(startCard()).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test.each(["FR", "US", "GB", "ZZ"])(
    "S2: an ADDRESS in %s is not a choice: the row stays empty",
    async (countryCode) => {
      brandSeed = seedWith({ countryCode });
      tree = await mountBody();
      expect(pickerValue(tree)).toBe("");
      expect(only(tree, "bank-connect-primary").props.disabled).toBe(true);
    },
  );

  test("S3: the remembered pick names the country a shared currency cannot", async () => {
    // A euro brand that picked Ireland is Ireland, whatever its address says.
    brandSeed = seedWith({
      countryCode: "DE",
      defaultCurrency: "EUR",
      payoutCountry: "IE",
    });
    tree = await mountBody();
    expect(pickerValue(tree)).toBe("IE");
    expect(only(tree, "bank-connect-primary").props.disabled).toBe(false);
  });

  test("S4: with no remembered pick the currency decides, and a currency one country uses names it", async () => {
    brandSeed = seedWith({ defaultCurrency: "USD" });
    tree = await mountBody();
    expect(pickerValue(tree)).toBe("US");
  });

  test("S5: a remembered pick that no longer matches the brand's currency is not believed", async () => {
    brandSeed = seedWith({ defaultCurrency: "USD", payoutCountry: "IE" });
    tree = await mountBody();
    expect(pickerValue(tree)).toBe("US");
  });

  test("S6: a remembered Nigeria never puts a card-rail brand on the Nigerian form", async () => {
    // Only the brand's provider does that; the remembered pick is display-only.
    brandSeed = seedWith({ defaultCurrency: "NGN", payoutCountry: "NG" });
    tree = await mountBody();
    expect(count(tree, "paystack-view")).toBe(0);
    expect(pickerValue(tree)).not.toBe("NG");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test("S7: an explicit country hint outranks the saved choice", async () => {
    params = { id: BRAND_ID, ...({ country: "CA" } as object) };
    brandSeed = seedWith({ defaultCurrency: "USD" });
    tree = await mountBody();
    expect(pickerValue(tree)).toBe("CA");
  });

  test("S8: 'Choose a different country' leaves Nigeria with NOTHING chosen, not the United Kingdom", async () => {
    brandSeed = seedWith({ paymentProvider: "paystack" });
    tree = await mountBody();
    expect(count(tree, "paystack-view")).toBe(1);

    await TestRenderer.act(async () => {
      (only(tree as TestTree, "paystack-view").props.onCancel as () => void)();
    });
    await flush();

    expect(requestsFor("clear_provider")).toEqual([
      { action: "clear_provider", brand_id: BRAND_ID },
    ]);
    expect(count(tree, "paystack-view")).toBe(0);
    expect(pickerValue(tree)).toBe("");
    expect(only(tree, "bank-connect-primary").props.disabled).toBe(true);

    // The host then picks; setup may start for exactly that country.
    await pickCountry(tree, "FR");
    expect(pickerValue(tree)).toBe("FR");
    expect(only(tree, "bank-connect-primary").props.disabled).toBe(false);
  });

  test("S9: a failed 'Choose a different country' is shown and its Try again repeats that action, not a move to another country", async () => {
    brandSeed = seedWith({ paymentProvider: "paystack" });
    mockInvoke.mockResolvedValueOnce(
      edgeFailure({ error: "upstream_unavailable" }),
    );
    tree = await mountBody();

    await TestRenderer.act(async () => {
      (only(tree as TestTree, "paystack-view").props.onCancel as () => void)();
    });
    await flush();
    expect(count(tree, "bank-connect-rail-error")).toBe(1);
    expect(requestsFor("clear_provider")).toHaveLength(1);

    expect(count(tree, "bank-connect-rail-retry")).toBe(1);
    await TestRenderer.act(async () => {
      (only(tree as TestTree, "bank-connect-rail-retry").props.onPress as () => void)();
    });
    await flush();
    expect(requestsFor("clear_provider")).toHaveLength(2);
    expect(requestsFor("select_provider")).toHaveLength(0);
    expect(count(tree, "bank-connect-rail-error")).toBe(0);
    expect(pickerValue(tree)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// #3645 review follow-up — appended.
//   * A brand that already has a card payment account is never asked to
//     "Choose a country": the account's own country is read and used.
//   * A "this account is in another country" reply moves the row to that
//     country instead of leaving the stale one selected.
//   * Remembering the pick never delays the move to hosted setup.
// ---------------------------------------------------------------------------
describe("#3645 web — a brand with a payment account is not asked to choose its country", () => {
  let tree: TestTree | null = null;
  let queryClient: QueryClient;

  type AccountSeed = BrandSeed & {
    stripeStatus?: string;
    defaultCurrency?: string | null;
    payoutCountry?: string | null;
  };
  const withAccount = (patch: Partial<AccountSeed> = {}): BrandSeed =>
    ({
      id: BRAND_ID,
      displayName: "Harbour Supper Club",
      countryCode: null,
      paymentProvider: "stripe",
      stripeStatus: "onboarding",
      ...patch,
    }) as BrandSeed;

  const supabaseFrom = (): jest.Mock =>
    (jest.requireMock("../../../services/supabase") as {
      supabase: { from: jest.Mock };
    }).supabase.from;
  const startCard = (): jest.Mock =>
    (jest.requireMock("../../../utils/bankConnectFunnel") as {
      startStripeWebBankConnect: jest.Mock;
    }).startStripeWebBankConnect;

  /** The account row read, and the remembered-country write, on one mock. */
  const writes: unknown[] = [];
  function accountRowAnswers(country: string | null): void {
    supabaseFrom().mockImplementation((table: string) => {
      if (table === "stripe_connect_accounts") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: country === null ? null : { country, detached_at: null },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {
        update: (values: unknown) => {
          writes.push(values);
          return { eq: () => ({ is: () => ({ select: async () => ({ data: [{ id: BRAND_ID }], error: null }) }) }) };
        },
      };
    });
  }

  async function mountBody(): Promise<TestTree> {
    let mounted: TestTree | null = null;
    await TestRenderer.act(async () => {
      mounted = TestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <BrandBankConnectBody />
        </QueryClientProvider>,
      );
    });
    await flush();
    if (mounted === null) throw new Error("Bank-connect body did not mount.");
    return mounted;
  }

  const pickerValue = (target: TestTree): string =>
    (only(target, "country-picker").props.accessibilityValue as { text: string })
      .text;

  beforeEach(() => {
    params = { id: BRAND_ID };
    writes.length = 0;
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    startCard().mockReset();
    supabaseFrom().mockReset();
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
    supabaseFrom().mockReset();
  });

  test("W1: the account's own country is shown and usable; the host is never asked to choose", async () => {
    // A euro brand: the currency alone cannot name the country.
    brandSeed = withAccount({ defaultCurrency: "EUR" });
    accountRowAnswers("FR");
    tree = await mountBody();

    expect(pickerValue(tree)).toBe("FR");
    expect(only(tree, "bank-connect-primary").props.disabled).toBe(false);
    expect(count(tree, "bank-connect-account-country-unknown")).toBe(0);
    // The remembered pick is corrected to the real account's country.
    expect(writes).toEqual([{ payout_country: "FR" }]);
  });

  test("W2: a stale remembered pick does not outrank the real account", async () => {
    brandSeed = withAccount({ defaultCurrency: "EUR", payoutCountry: "IE" });
    accountRowAnswers("DE");
    tree = await mountBody();
    expect(pickerValue(tree)).toBe("DE");
    expect(writes).toEqual([{ payout_country: "DE" }]);
  });

  test("W3: when the account's country cannot be read, nothing is guessed and nothing is asked", async () => {
    brandSeed = withAccount({ defaultCurrency: "EUR" });
    accountRowAnswers(null);
    tree = await mountBody();

    // No "Choose a country" row, no button gated on a pick: a plain message.
    expect(count(tree, "country-picker")).toBe(0);
    expect(count(tree, "bank-connect-primary")).toBe(0);
    const message = textOf(only(tree, "bank-connect-account-country-unknown"));
    expect(message).toContain("load this brand");
    expect(message).not.toMatch(/stripe|paystack|choose a country/i);
    expect(startCard()).not.toHaveBeenCalled();

    // Try again reads it again.
    accountRowAnswers("FR");
    await TestRenderer.act(async () => {
      (only(tree as TestTree, "bank-connect-account-country-retry").props.onPress as () => void)();
    });
    await flush();
    expect(pickerValue(tree)).toBe("FR");
    expect(only(tree, "bank-connect-primary").props.disabled).toBe(false);
  });

  test("W4: a brand with NO payment account still chooses for itself (the read is not even made)", async () => {
    brandSeed = withAccount({ stripeStatus: "not_connected" });
    accountRowAnswers("FR");
    tree = await mountBody();
    expect(pickerValue(tree)).toBe("");
    expect(supabaseFrom()).not.toHaveBeenCalledWith("stripe_connect_accounts");
  });

  test("W5: 'this account is in another country' shows the sentence and moves the row to the account's country", async () => {
    brandSeed = withAccount({ stripeStatus: "not_connected", defaultCurrency: "USD" });
    accountRowAnswers(null);
    startCard().mockRejectedValueOnce(
      Object.assign(
        new Error(
          "A payment account is already set up for ES. To use a different country or currency, create a new brand.",
        ),
        { code: "country_locked", existingCountry: "ES" },
      ),
    );
    // (Spain: the correction is written once per brand and country per page,
    // and an earlier test already corrected this brand to France.)
    tree = await mountBody();
    expect(pickerValue(tree)).toBe("US");

    await TestRenderer.act(async () => {
      await (only(tree as TestTree, "bank-connect-primary").props.onPress as () => Promise<void>)();
    });
    await flush();

    expect(textOf(only(tree, "bank-connect-error"))).toContain(
      "A payment account is already set up for ES",
    );
    expect(pickerValue(tree)).toBe("ES");
    expect(writes).toEqual([{ payout_country: "ES" }]);
  });

  test("W6: remembering the pick never delays the move to hosted setup", async () => {
    brandSeed = withAccount({ stripeStatus: "not_connected", defaultCurrency: "USD" });
    // The remembered-country write never answers.
    supabaseFrom().mockImplementation(() => ({
      update: () => ({ eq: () => ({ is: () => ({ select: () => new Promise(() => undefined) }) }) }),
    }));
    (jest.requireMock("../../../services/brandStripeService") as {
      startBrandStripeOnboarding: jest.Mock;
    }).startBrandStripeOnboarding.mockResolvedValue({ onboarding_url: `${ORIGIN}/connect-onboarding?session=s` });
    let minted: unknown = null;
    startCard().mockImplementation(
      async (input: { mintOnboarding: (i: unknown) => Promise<unknown> }) => {
        minted = await input.mintOnboarding({
          brandId: BRAND_ID,
          returnUrl: `${ORIGIN}/brand/${BRAND_ID}/payments`,
          country: "US",
        });
      },
    );
    tree = await mountBody();

    await TestRenderer.act(async () => {
      await (only(tree as TestTree, "bank-connect-primary").props.onPress as () => Promise<void>)();
    });
    await flush();

    expect(minted).toEqual({ onboarding_url: `${ORIGIN}/connect-onboarding?session=s` });
  });
});
