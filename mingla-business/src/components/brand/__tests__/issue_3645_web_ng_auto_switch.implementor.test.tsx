/**
 * #3645 rework (PR #3805 tester P1-2 + follow-ups) — Host WEB payout setup.
 *
 *  - A brand whose ADDRESS says Nigeria but which is still on the card rail
 *    used to mount straight into the bank form and send NO select_provider, so
 *    it could not sell before adding a bank. The screen now performs the same
 *    switch a manual pick does, exactly once per mount: pending (neither
 *    form), then the bank form on success or the error card on failure.
 *  - It does NOT auto-switch a brand already on the Nigerian rail, or for
 *    someone who is not the brand's account owner.
 *  - Two picks in the same tick send one request.
 *  - A refusal that retrying cannot fix (403 permission, 409 bank already
 *    connected) shows plain copy with no "Try again".
 *  - Back never sends clear_provider.
 *
 * PRODUCTION screen, REAL hooks + service + QueryClient; only the Supabase
 * client is stubbed (same harness as the sibling implementor suite).
 *
 * FAILS ON REVERT (restore BrandBankConnectBody.web.tsx from 0fbf04adf):
 * R1/R4/R5 see zero select_provider and the form on first paint; R6 sees two
 * requests; R7/R8 see a "Try again" button.
 *
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/issue_3645_web_ng_auto_switch.implementor.test.tsx --runInBand
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

describe("#3645 web rework — a Nigeria-by-address brand is switched automatically, once", () => {
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

  // Same wrapper as the mount, or React would remount the screen.
  async function rerender(target: TestTree, strict = false): Promise<void> {
    await TestRenderer.act(async () => {
      (target as TestTree & { update: (el: React.ReactElement) => void }).update(
        element(strict),
      );
    });
    await flush();
  }

  const nigeriaByAddress = (): BrandSeed => ({
    id: BRAND_ID,
    displayName: "Lagos Supper Club",
    // orch-strict-grep-allow stripe-country-out-of-scope — Nigeria is the Paystack rail, deliberately outside the Stripe allowlist.
    countryCode: "NG",
    paymentProvider: "stripe",
    accountId: USER_ID,
  });

  beforeEach(() => {
    params = { id: BRAND_ID };
    brandSeed = nigeriaByAddress();
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

  test("R1: on mount it sends exactly one select_provider, shows neither form while pending, then the bank form", async () => {
    const pending = deferred();
    mockInvoke.mockReturnValueOnce(pending.promise);

    tree = await mountBody();

    expect(requestsFor("select_provider")).toEqual([
      { action: "select_provider", brand_id: BRAND_ID },
    ]);
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
    expect(count(tree, "bank-connect-rail-switching")).toBe(0);
    expect(count(tree, "bank-connect-primary")).toBe(0);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  test("R2: a brand already on the Nigerian rail opens on the bank form and sends nothing", async () => {
    brandSeed = { ...nigeriaByAddress(), paymentProvider: "paystack" };

    tree = await mountBody();

    expect(count(tree, "paystack-view")).toBe(1);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test("R3: someone who is not the brand's account owner triggers no automatic switch", async () => {
    brandSeed = { ...nigeriaByAddress(), accountId: OTHER_USER_ID };
    tree = await mountBody();
    expect(mockInvoke).not.toHaveBeenCalled();

    tree.unmount();
    const withoutOwner = nigeriaByAddress();
    delete withoutOwner.accountId;
    brandSeed = withoutOwner;
    tree = await mountBody();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test("R4: StrictMode's double mount and the brand refetch after success still send exactly one", async () => {
    tree = await mountBody(true);
    expect(requestsFor("select_provider")).toHaveLength(1);
    expect(count(tree, "paystack-view")).toBe(1);

    // The switch invalidates the brand; the refetched row is now on the rail.
    brandSeed = { ...nigeriaByAddress(), paymentProvider: "paystack" };
    await rerender(tree, true);
    // …and a later row that (wrongly) reads card-rail again must not re-fire.
    brandSeed = nigeriaByAddress();
    await rerender(tree, true);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(count(tree, "paystack-view")).toBe(1);
  });

  test("R5: a failed automatic switch shows the error with Try again, no form, and Try again recovers", async () => {
    mockInvoke.mockResolvedValueOnce(
      edgeFailure({
        error: "stamp_failed",
        detail: "paystack_provider_select_stamp_retryable",
      }),
    );

    tree = await mountBody();

    expect(requestsFor("select_provider")).toHaveLength(1);
    expect(count(tree, "bank-connect-rail-error")).toBe(1);
    expect(count(tree, "paystack-view")).toBe(0);
    expect(count(tree, "bank-connect-primary")).toBe(0);

    await TestRenderer.act(async () => {
      (only(tree as TestTree, "bank-connect-rail-retry").props.onPress as () => void)();
    });
    await flush();

    expect(requestsFor("select_provider")).toHaveLength(2);
    expect(count(tree, "paystack-view")).toBe(1);
  });

  test("R6: two picks in the same tick send one request and the screen follows the first", async () => {
    brandSeed = { ...nigeriaByAddress(), countryCode: null };
    tree = await mountBody();
    expect(mockInvoke).not.toHaveBeenCalled();
    const picker = only(tree, "country-picker");
    const onChange = picker.props.onChange as (code: string) => void;

    await TestRenderer.act(async () => {
      onChange("NG");
      onChange("NG");
    });
    await flush();
    expect(requestsFor("select_provider")).toHaveLength(1);
    expect(count(tree, "paystack-view")).toBe(1);

    tree.unmount();
    mockInvoke.mockClear();
    tree = await mountBody();
    const again = only(tree, "country-picker").props.onChange as (code: string) => void;
    await TestRenderer.act(async () => {
      again("NG");
      again("GB");
    });
    await flush();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(requestsFor("select_provider")).toHaveLength(1);
    expect(requestsFor("clear_provider")).toHaveLength(0);
    // The picker and the form agree: Nigeria, bank form.
    expect(only(tree, "country-picker").props.accessibilityValue).toEqual({
      text: "NG",
    });
    expect(count(tree, "paystack-view")).toBe(1);
  });

  test("R7: a permission refusal is said plainly, with no Try again and no 'check your connection'", async () => {
    mockInvoke.mockResolvedValueOnce(
      edgeFailure({ error: "forbidden", detail: "permission_denied" }),
    );

    tree = await mountBody();

    const message = textOf(only(tree, "bank-connect-rail-error"));
    expect(message).toMatch(/only the brand owner/i);
    expect(message).not.toMatch(/connection|try again|stripe|paystack|forbidden/i);
    expect(count(tree, "bank-connect-rail-retry")).toBe(0);
    expect(count(tree, "paystack-view")).toBe(0);
  });

  test("R8: 'a bank is already connected' has no Try again either", async () => {
    brandSeed = { ...nigeriaByAddress(), paymentProvider: "paystack" };
    tree = await mountBody();
    mockInvoke.mockResolvedValueOnce(
      edgeFailure({ error: "conflict", detail: "disconnect_first" }),
    );

    await pickCountry(tree, "GB");

    const message = textOf(only(tree, "bank-connect-rail-error"));
    expect(message).toMatch(/already has a bank/i);
    expect(message).not.toMatch(/connection|try again/i);
    expect(count(tree, "bank-connect-rail-retry")).toBe(0);
  });

  test("R9: Back from the Nigeria form leaves the screen and sends no clear_provider", async () => {
    tree = await mountBody();
    expect(count(tree, "paystack-view")).toBe(1);

    await TestRenderer.act(async () => {
      (only(tree as TestTree, "bank-connect-back").props.onPress as () => void)();
    });
    await flush();

    expect(router.replace).toHaveBeenCalledWith(`/brand/${BRAND_ID}/payments`);
    expect(requestsFor("clear_provider")).toEqual([]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});
