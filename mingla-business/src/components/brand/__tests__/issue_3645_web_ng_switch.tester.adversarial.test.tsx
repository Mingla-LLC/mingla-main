/**
 * #3645 — TESTER adversarial suite for the Host WEB payout-country switch
 * (BrandBankConnectBody.web). Attacks the angles the implementor suite
 * (issue_3645_web_ng_select_provider.implementor.test.tsx) does not: the
 * in-flight window, pick sequences, a switch that failed AFTER the server
 * moved the brand, brand-row refetches racing the organiser's pick, refusals
 * that are not transient, transport failures with no JSON body, and the
 * invite / brand-create funnels.
 *
 * Same harness as the implementor suite: PRODUCTION screen, REAL hooks and
 * service, REAL QueryClient; only the Supabase client is stubbed.
 *
 * FAILS ON REVERT (restore BrandBankConnectBody.web.tsx from origin/main):
 * all thirteen tests fail — no select_provider / clear_provider request is
 * ever sent, no rail-switch state exists, and a brand-row refetch overwrites
 * the organiser's pick.
 *
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/issue_3645_web_ng_switch.tester.adversarial.test.tsx --runInBand
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


interface Deferred {
  promise: Promise<InvokeResult>;
  resolve: (value: InvokeResult) => void;
}

function deferred(): Deferred {
  let resolve!: (value: InvokeResult) => void;
  const promise = new Promise<InvokeResult>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function actionsSent(): string[] {
  return mockInvoke.mock.calls
    .filter(([name]) => name === "brand-paystack-onboard")
    .map(([, options]) => String(options.body.action));
}

const PROVIDER_OR_INTERNAL =
  /stripe|paystack|select_?provider|clear_?provider|stamp|forbidden|permission_denied|disconnect_first|non-2xx|edge function|failed to fetch|\[object/i;

describe("#3645 web — tester adversarial: payout-country switch", () => {
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

  const pickerValue = (target: TestTree): unknown =>
    (only(target, "country-picker").props.accessibilityValue as { text: string })
      .text;

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

  test("A1: while the switch is in flight neither rail's form is offered, the picker is locked, and a second pick is ignored", async () => {
    const pending = deferred();
    mockInvoke.mockReturnValueOnce(pending.promise);
    tree = await mountBody();

    await pickCountry(tree, "NG");

    // In limbo: the brand is on neither rail as far as the screen knows.
    expect(count(tree, "bank-connect-rail-switching")).toBe(1);
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "bank-connect-primary")).toBe(0);
    expect(only(tree, "country-picker").props.accessibilityState).toEqual({
      disabled: true,
    });

    // A pick that lands while the request is in flight must not start a
    // second, competing switch (out-of-order resolution).
    await pickCountry(tree, "US");
    await pickCountry(tree, "NG");
    expect(actionsSent()).toEqual(["select_provider"]);
    expect(pickerValue(tree)).toBe("NG");
    expect(count(tree, "bank-connect-primary")).toBe(0);

    await TestRenderer.act(async () => {
      pending.resolve({ data: {}, error: null });
    });
    await flush();

    expect(count(tree, "bank-connect-rail-switching")).toBe(0);
    expect(count(tree, "paystack-view")).toBe(1);
    expect(only(tree, "country-picker").props.accessibilityState).toEqual({
      disabled: false,
    });
  });

  test("A2: Nigeria → United Kingdom → Nigeria sends select, clear, select in that order and ends on the bank form", async () => {
    tree = await mountBody();

    await pickCountry(tree, "NG");
    await pickCountry(tree, "GB");
    expect(count(tree, "bank-connect-primary")).toBe(1);
    await pickCountry(tree, "NG");

    expect(actionsSent()).toEqual([
      "select_provider",
      "clear_provider",
      "select_provider",
    ]);
    expect(count(tree, "paystack-view")).toBe(1);
    expect(count(tree, "bank-connect-primary")).toBe(0);
    expect(pickerValue(tree)).toBe("NG");

    // And once cleared, hopping between two card-rail countries stays silent.
    await pickCountry(tree, "GB");
    await pickCountry(tree, "US");
    expect(actionsSent()).toEqual([
      "select_provider",
      "clear_provider",
      "select_provider",
      "clear_provider",
    ]);
  });

  test("A3: a Nigeria switch that FAILED still gets reversed when the organiser picks another country", async () => {
    // The edge function writes the brand row first and can fail afterwards
    // (503 stamp_failed), so a failed switch may have moved the brand.
    mockInvoke.mockResolvedValueOnce(
      edgeFailure({
        error: "stamp_failed",
        detail: "paystack_provider_select_stamp_retryable",
      }),
    );
    tree = await mountBody();
    await pickCountry(tree, "NG");
    expect(count(tree, "bank-connect-rail-error")).toBe(1);

    await pickCountry(tree, "US");

    expect(actionsSent()).toEqual(["select_provider", "clear_provider"]);
    expect(count(tree, "bank-connect-rail-error")).toBe(0);
    expect(count(tree, "bank-connect-primary")).toBe(1);
    expect(count(tree, "paystack-view")).toBe(0);
    expect(pickerValue(tree)).toBe("US");
  });

  test("A4: a brand-row refetch never overwrites the country the organiser picked, but does seed an untouched picker", async () => {
    tree = await mountBody();
    expect(pickerValue(tree)).toBe("GB");

    // Untouched: the saved brand row is the truth.
    brandSeed = { ...brandSeed, countryCode: "FR" };
    await rerender(tree);
    expect(pickerValue(tree)).toBe("FR");

    await pickCountry(tree, "US");
    brandSeed = { ...brandSeed, countryCode: "DE" };
    await rerender(tree);

    expect(pickerValue(tree)).toBe("US");
    expect(count(tree, "bank-connect-primary")).toBe(1);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test("A5: after a failed switch, a refetched brand row that says 'Nigerian rail' does not swap the error for the bank form", async () => {
    mockInvoke.mockResolvedValueOnce(
      edgeFailure({
        error: "stamp_outcome_unknown",
        detail: "paystack_provider_select_stamp_retryable",
      }),
    );
    tree = await mountBody();
    await pickCountry(tree, "NG");

    // The server moved the row before failing; a later refetch shows it.
    brandSeed = { ...brandSeed, countryCode: null, paymentProvider: "paystack" };
    await rerender(tree);

    expect(count(tree, "bank-connect-rail-error")).toBe(1);
    expect(count(tree, "bank-connect-rail-retry")).toBe(1);
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "bank-connect-primary")).toBe(0);
  });

  test.each([
    [
      "a permission refusal (403)",
      (): Promise<InvokeResult> =>
        Promise.resolve(
          edgeFailure({ error: "forbidden", detail: "permission_denied" }),
        ),
    ],
    [
      "a transport error with no JSON body",
      (): Promise<InvokeResult> =>
        Promise.resolve({
          data: null,
          error: new TypeError("Failed to fetch"),
        }),
    ],
    [
      "a bare-object error (not an Error)",
      (): Promise<InvokeResult> =>
        Promise.resolve({
          data: null,
          error: { name: "FunctionsRelayError", status: 502 },
        }),
    ],
    [
      "an invoke that throws",
      (): Promise<InvokeResult> =>
        Promise.reject(new Error("selectPaystackProvider exploded: paystack")),
    ],
  ])(
    "A6: %s is shown in plain words, with no provider or internal name and no form",
    async (_label, respond) => {
      mockInvoke.mockImplementationOnce(respond);
      tree = await mountBody();

      await pickCountry(tree, "NG");

      const message = textOf(only(tree, "bank-connect-rail-error"));
      expect(message.trim().length).toBeGreaterThan(20);
      expect(message).not.toMatch(PROVIDER_OR_INTERNAL);
      expect(count(tree, "paystack-view")).toBe(0);
      expect(count(tree, "bank-connect-primary")).toBe(0);
      // Never trapped: the picker is usable again and Back is still there.
      expect(only(tree, "country-picker").props.accessibilityState).toEqual({
        disabled: false,
      });
      expect(count(tree, "bank-connect-back")).toBe(1);
    },
  );

  test("A7: a failed reversal keeps retrying the country the organiser asked for, and recovers", async () => {
    tree = await mountBody();
    await pickCountry(tree, "NG");
    mockInvoke.mockResolvedValueOnce(
      edgeFailure({ error: "internal_error", detail: "brand_update_failed" }),
    );

    await pickCountry(tree, "US");

    expect(count(tree, "bank-connect-rail-error")).toBe(1);
    // Not on the card rail yet: the reversal did not happen.
    expect(count(tree, "bank-connect-primary")).toBe(0);

    await press(tree, "bank-connect-rail-retry");

    expect(actionsSent()).toEqual([
      "select_provider",
      "clear_provider",
      "clear_provider",
    ]);
    expect(count(tree, "bank-connect-rail-error")).toBe(0);
    expect(count(tree, "bank-connect-primary")).toBe(1);
    expect(pickerValue(tree)).toBe("US");
  });

  test("A8: a brand that already has a bank is told so, and can get back to its bank form by re-picking Nigeria", async () => {
    brandSeed = { ...brandSeed, paymentProvider: "paystack" };
    tree = await mountBody();
    mockInvoke.mockResolvedValueOnce(
      edgeFailure({ error: "conflict", detail: "disconnect_first" }),
    );

    await TestRenderer.act(async () => {
      (only(tree as TestTree, "paystack-view").props.onCancel as () => void)();
    });
    await flush();

    const message = textOf(only(tree, "bank-connect-rail-error"));
    expect(message).toMatch(/already has a bank/i);
    expect(message).not.toMatch(PROVIDER_OR_INTERNAL);
    expect(count(tree, "bank-connect-primary")).toBe(0);

    // The way out that works: pick Nigeria again.
    await pickCountry(tree, "NG");
    expect(actionsSent()).toEqual(["clear_provider", "select_provider"]);
    expect(count(tree, "bank-connect-rail-error")).toBe(0);
    expect(count(tree, "paystack-view")).toBe(1);
  });

  test("A9: the invite funnel keeps its Skip affordance and hidden Back through every switch state", async () => {
    params = { id: BRAND_ID, from: "invite" };
    const pending = deferred();
    mockInvoke.mockReturnValueOnce(pending.promise);
    tree = await mountBody();
    expect(count(tree, "bank-connect-back")).toBe(0);
    expect(count(tree, "bank-connect-skip-link")).toBe(1);

    await pickCountry(tree, "NG");
    expect(count(tree, "bank-connect-rail-switching")).toBe(1);
    expect(count(tree, "bank-connect-skip-link")).toBe(1);

    await TestRenderer.act(async () => {
      pending.resolve(
        edgeFailure({ error: "internal_error", detail: "brand_update_failed" }),
      );
    });
    await flush();
    expect(count(tree, "bank-connect-rail-error")).toBe(1);
    expect(count(tree, "bank-connect-back")).toBe(0);

    await press(tree, "bank-connect-skip-link");
    expect(count(tree, "bank-connect-skip-choices")).toBe(1);
    await press(tree, "bank-connect-skip-continue-web");
    expect(router.replace).toHaveBeenCalledWith("/(tabs)/home");
  });

  test("A10: in the brand-create funnel, Back after a Nigeria switch returns to the brand flow and does not undo the switch", async () => {
    params = { id: BRAND_ID, from: "brand-create" };
    tree = await mountBody();
    await pickCountry(tree, "NG");
    expect(count(tree, "paystack-view")).toBe(1);

    await press(tree, "bank-connect-back");

    expect(router.replace).toHaveBeenCalledWith(
      `/brand/new?resume_brand=${encodeURIComponent(BRAND_ID)}`,
    );
    // Leaving the screen is not "choose a different country": the brand
    // stays able to sell before a bank is added.
    expect(actionsSent()).toEqual(["select_provider"]);
  });
});
