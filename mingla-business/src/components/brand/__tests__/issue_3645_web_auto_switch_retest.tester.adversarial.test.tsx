/**
 * #3645 RETEST — TESTER adversarial suite for the automatic Nigeria switch on
 * Host WEB payout setup (BrandBankConnectBody.web), added by the rework at
 * 8a8ab456c. Different angles from
 * issue_3645_web_ng_auto_switch.implementor.test.tsx: a brand row that is
 * still loading, a signed-out visitor, a remount, re-renders against a brand
 * row that never catches up, leaving while the switch is in flight, recovering
 * from a failed automatic switch by picking another country, a three-pick
 * same-tick burst, the invite funnel, and a URL hint that must not switch.
 *
 * FAILS ON REVERT (restore BrandBankConnectBody.web.tsx from 0fbf04adf):
 * X1, X2, X3, X4, X5, X6, X7 and X8 fail — no automatic switch is ever sent
 * and a same-tick burst sends more than one request.
 *
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/issue_3645_web_auto_switch_retest.tester.adversarial.test.tsx --runInBand
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

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => params,
  useRouter: () => router,
}));

let mockUser: { id: string } | null = { id: USER_ID };

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser }),
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

/** Supabase's FunctionsHttpError shape: the JSON body rides on `context`. */
function edgeFailure(body: Record<string, unknown>): InvokeResult {
  const error = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    context: { json: async () => body },
  });
  return { data: null, error };
}

const OTHER_USER_ID = "11111111-2222-4b33-8444-123456789abc";

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


describe("#3645 retest — tester adversarial: the automatic Nigeria switch on web", () => {
  let tree: TestTree | null = null;
  let queryClient: QueryClient;

  const element = (strict = false): React.ReactElement => {
    const body = (
      <QueryClientProvider client={queryClient}>
        <BrandBankConnectBody />
      </QueryClientProvider>
    );
    return strict ? <React.StrictMode>{body}</React.StrictMode> : body;
  };

  async function mountBody(strict = false): Promise<TestTree> {
    let mounted: TestTree | null = null;
    await TestRenderer.act(async () => {
      mounted = TestRenderer.create(element(strict));
    });
    await flush();
    if (mounted === null) throw new Error("Bank-connect body did not mount.");
    return mounted;
  }

  async function rerender(target: TestTree, strict = false): Promise<void> {
    await TestRenderer.act(async () => {
      target.update(element(strict));
    });
    await flush();
  }

  async function unmountCurrent(): Promise<void> {
    await TestRenderer.act(async () => {
      tree?.unmount();
    });
    tree = null;
  }

  const nigeriaByAddress = (): BrandSeed => ({
    id: BRAND_ID,
    displayName: "Lagos Supper Club",
    // orch-strict-grep-allow stripe-country-out-of-scope — Nigeria is the Paystack rail, deliberately outside the Stripe allowlist.
    countryCode: "NG",
    paymentProvider: "stripe",
    accountId: USER_ID,
  });

  const sent = (): string[] =>
    mockInvoke.mock.calls
      .filter(([name]) => name === "brand-paystack-onboard")
      .map(([, options]) => String(options.body.action));

  const pickerValue = (target: TestTree): string =>
    (only(target, "country-picker").props.accessibilityValue as { text: string })
      .text;

  const pick = (target: TestTree, code: string): void =>
    (only(target, "country-picker").props.onChange as (c: string) => void)(code);

  beforeEach(() => {
    params = { id: BRAND_ID };
    brandSeed = nigeriaByAddress();
    mockUser = { id: USER_ID };
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

  test("X1: nothing is sent while the brand row is loading; once it arrives exactly one switch is sent and the form follows", async () => {
    brandSeed = null;
    tree = await mountBody();
    await rerender(tree);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(count(tree, "paystack-view")).toBe(0);

    const pending = deferred();
    mockInvoke.mockReturnValueOnce(pending.promise);
    brandSeed = nigeriaByAddress();
    await rerender(tree);

    expect(sent()).toEqual(["select_provider"]);
    // In flight: neither rail's form, and the picker cannot start a second switch.
    expect(count(tree, "bank-connect-rail-switching")).toBe(1);
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "bank-connect-primary")).toBe(0);
    expect(only(tree, "country-picker").props.accessibilityState).toEqual({
      disabled: true,
    });

    await TestRenderer.act(async () => {
      pending.resolve({ data: {}, error: null });
    });
    await flush();
    expect(count(tree, "paystack-view")).toBe(1);
    expect(sent()).toEqual(["select_provider"]);
  });

  test("X2: a signed-out visitor sends nothing; signing in as the owner then sends exactly one", async () => {
    mockUser = null;
    tree = await mountBody();
    await rerender(tree);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(count(tree, "paystack-view")).toBe(0);

    mockUser = { id: USER_ID };
    await rerender(tree);
    await rerender(tree);
    expect(sent()).toEqual(["select_provider"]);
  });

  test("X3: re-renders against a brand row that never catches up do not repeat the switch", async () => {
    tree = await mountBody();
    // The refetch after success keeps returning the stale card-rail row.
    for (let index = 0; index < 4; index += 1) {
      brandSeed = nigeriaByAddress();
      await rerender(tree);
    }
    expect(sent()).toEqual(["select_provider"]);
    expect(count(tree, "paystack-view")).toBe(1);
    expect(count(tree, "bank-connect-rail-switching")).toBe(0);
  });

  test("X4: coming back to the screen once the brand is on the Nigerian rail sends nothing more", async () => {
    tree = await mountBody();
    expect(sent()).toEqual(["select_provider"]);
    await unmountCurrent();

    brandSeed = { ...nigeriaByAddress(), paymentProvider: "paystack" };
    tree = await mountBody();
    await rerender(tree);

    expect(sent()).toEqual(["select_provider"]);
    expect(count(tree, "paystack-view")).toBe(1);
  });

  test("X5: a failed automatic switch is not retried behind the organiser's back, and picking another country gets them out", async () => {
    mockInvoke.mockResolvedValueOnce(
      edgeFailure({
        error: "stamp_failed",
        detail: "paystack_provider_select_stamp_retryable",
      }),
    );
    tree = await mountBody();
    expect(count(tree, "bank-connect-rail-error")).toBe(1);
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "bank-connect-primary")).toBe(0);

    // Re-renders and a brand refetch must not silently fire it again.
    await rerender(tree);
    brandSeed = nigeriaByAddress();
    await rerender(tree);
    expect(sent()).toEqual(["select_provider"]);
    expect(count(tree, "bank-connect-rail-error")).toBe(1);

    // The picker is usable, and because the server may have moved the brand
    // before failing, leaving Nigeria reverses it.
    expect(only(tree, "country-picker").props.accessibilityState).toEqual({
      disabled: false,
    });
    await TestRenderer.act(async () => {
      pick(tree as TestTree, "US");
    });
    await flush();
    expect(sent()).toEqual(["select_provider", "clear_provider"]);
    expect(count(tree, "bank-connect-rail-error")).toBe(0);
    expect(count(tree, "bank-connect-primary")).toBe(1);
    expect(pickerValue(tree)).toBe("US");
  });

  test("X6: Back while the automatic switch is in flight leaves at once and never undoes it", async () => {
    const pending = deferred();
    mockInvoke.mockReturnValueOnce(pending.promise);
    tree = await mountBody();
    expect(count(tree, "bank-connect-rail-switching")).toBe(1);

    await TestRenderer.act(async () => {
      (only(tree as TestTree, "bank-connect-back").props.onPress as () => void)();
    });
    expect(router.replace).toHaveBeenCalledWith(`/brand/${BRAND_ID}/payments`);
    await unmountCurrent();

    await TestRenderer.act(async () => {
      pending.resolve({ data: {}, error: null });
    });
    await flush();
    expect(sent()).toEqual(["select_provider"]);
  });

  test("X7: three picks in one tick (Nigeria, United Kingdom, Nigeria) send one request and the screen ends where the request went", async () => {
    brandSeed = { ...nigeriaByAddress(), countryCode: null };
    const pending = deferred();
    mockInvoke.mockReturnValueOnce(pending.promise);
    tree = await mountBody();
    expect(mockInvoke).not.toHaveBeenCalled();

    await TestRenderer.act(async () => {
      pick(tree as TestTree, "NG");
      pick(tree as TestTree, "GB");
      pick(tree as TestTree, "NG");
    });
    await flush();
    expect(sent()).toEqual(["select_provider"]);
    expect(pickerValue(tree)).toBe("NG");

    await TestRenderer.act(async () => {
      pending.resolve({ data: {}, error: null });
    });
    await flush();
    expect(sent()).toEqual(["select_provider"]);
    expect(count(tree, "paystack-view")).toBe(1);
    expect(count(tree, "bank-connect-primary")).toBe(0);
    expect(pickerValue(tree)).toBe("NG");
  });

  test("X8: in the invite funnel a failed automatic switch still leaves Skip, and StrictMode sends one request", async () => {
    params = { id: BRAND_ID, from: "invite" };
    mockInvoke.mockResolvedValue(
      edgeFailure({ error: "forbidden", detail: "permission_denied" }),
    );
    tree = await mountBody(true);

    expect(sent()).toEqual(["select_provider"]);
    const message = textOf(only(tree, "bank-connect-rail-error"));
    expect(message).not.toMatch(/connection|try again|stripe|paystack|forbidden/i);
    expect(count(tree, "bank-connect-rail-retry")).toBe(0);
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "bank-connect-primary")).toBe(0);
    expect(count(tree, "bank-connect-skip-link")).toBe(1);
  });

  test("X9: a `?provider=` link cannot switch a card-rail brand that has no Nigerian address", async () => {
    params = { id: BRAND_ID, provider: "paystack" };
    brandSeed = { ...nigeriaByAddress(), countryCode: null };
    tree = await mountBody();
    await rerender(tree);

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(count(tree, "bank-connect-primary")).toBe(1);
    expect(pickerValue(tree)).toBe("GB");
  });

  test("X10: someone who is not the brand's owner never triggers it, on mount or on re-render", async () => {
    brandSeed = { ...nigeriaByAddress(), accountId: OTHER_USER_ID };
    tree = await mountBody(true);
    await rerender(tree, true);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(count(tree, "bank-connect-rail-switching")).toBe(0);
  });
});
