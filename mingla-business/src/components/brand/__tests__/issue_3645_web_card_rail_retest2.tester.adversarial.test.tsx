/**
 * #3645 RETEST 2 — TESTER adversarial suite for Host WEB payout setup after
 * the rework at 1ae2e69ed: a brand with a card-rail account is never switched
 * on open, and "Continue with Nigeria" is the explicit way in when nothing is
 * switched automatically. Different angles from
 * issue_3645_web_card_rail_no_auto_switch.implementor.test.tsx: StrictMode and
 * re-renders for the card-rail brand, what "Add bank details" then sends, the
 * confirm button's exclusivity, a same-tick double tap, both failure kinds,
 * and leaving while the confirm is in flight.
 *
 * FAILS ON REVERT (restore BrandBankConnectBody.web.tsx from 036b3d1cf):
 * Y1-Y5 fail — the card-rail brand is switched on mount and no confirm
 * control exists.
 *
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/issue_3645_web_card_rail_retest2.tester.adversarial.test.tsx --runInBand
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

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => params,
  useRouter: () => router,
}));

const mockUser: { id: string } | null = { id: USER_ID };

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


describe("#3645 retest 2 — tester adversarial: card-rail brands and the explicit Nigeria confirm on web", () => {
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

  async function press(target: TestTree, testID: string): Promise<void> {
    await TestRenderer.act(async () => {
      (only(target, testID).props.onPress as () => void)();
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
    stripeStatus: "not_connected",
  });

  const sent = (): string[] =>
    mockInvoke.mock.calls
      .filter(([name]) => name === "brand-paystack-onboard")
      .map(([, options]) => String(options.body.action));

  const pickerValue = (target: TestTree): string =>
    (only(target, "country-picker").props.accessibilityValue as { text: string })
      .text;

  /** The three things that must never be on screen together. */
  const offered = (target: TestTree): Record<string, number> => ({
    nigeriaBankForm: count(target, "paystack-view"),
    cardBankButton: count(target, "bank-connect-primary"),
    confirmNigeria: count(target, "bank-connect-confirm-nigeria"),
  });

  beforeEach(() => {
    params = { id: BRAND_ID };
    brandSeed = nigeriaByAddress();
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
    "Y1: a brand whose card-rail account is %s is never switched by opening the screen — StrictMode, re-renders and all",
    async (stripeStatus) => {
      brandSeed = { ...nigeriaByAddress(), stripeStatus };
      tree = await mountBody(true);
      for (let index = 0; index < 3; index += 1) {
        brandSeed = { ...nigeriaByAddress(), stripeStatus };
        await rerender(tree, true);
      }

      expect(mockInvoke).not.toHaveBeenCalled();
      expect(offered(tree)).toEqual({
        nigeriaBankForm: 0,
        cardBankButton: 1,
        confirmNigeria: 0,
      });
      expect(count(tree, "bank-connect-rail-switching")).toBe(0);
      // Nigeria is not shown as the chosen country for a card-rail brand.
      expect(pickerValue(tree)).not.toBe("NG");

      // Its card-rail button starts card-rail setup and still switches nothing.
      await press(tree, "bank-connect-primary");
      expect(mockStartCard).toHaveBeenCalledTimes(1);
      expect(mockStartCard.mock.calls[0]![0].country).not.toBe("NG");
      expect(mockInvoke).not.toHaveBeenCalled();
    },
  );

  test("Y2: a card-rail brand viewed by someone who is not its owner also sends nothing", async () => {
    brandSeed = {
      ...nigeriaByAddress(),
      stripeStatus: "active",
      accountId: OTHER_USER_ID,
    };
    tree = await mountBody();
    await rerender(tree);

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(offered(tree)).toEqual({
      nigeriaBankForm: 0,
      cardBankButton: 1,
      confirmNigeria: 0,
    });
  });

  test("Y3: 'Continue with Nigeria' stands alone, a same-tick double tap sends one request, and a refusal leaves no card button behind", async () => {
    // Nigerian address, no card account, viewer is not the owner: no
    // automatic switch, so the explicit confirm is offered.
    brandSeed = { ...nigeriaByAddress(), accountId: OTHER_USER_ID };
    tree = await mountBody();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(offered(tree)).toEqual({
      nigeriaBankForm: 0,
      cardBankButton: 0,
      confirmNigeria: 1,
    });
    expect(pickerValue(tree)).toBe("NG");

    const pending = deferred();
    mockInvoke.mockReturnValueOnce(pending.promise);
    const confirm = only(tree, "bank-connect-confirm-nigeria");
    await TestRenderer.act(async () => {
      (confirm.props.onPress as () => void)();
      (confirm.props.onPress as () => void)();
    });
    await flush();
    expect(sent()).toEqual(["select_provider"]);
    expect(count(tree, "bank-connect-rail-switching")).toBe(1);
    expect(offered(tree)).toEqual({
      nigeriaBankForm: 0,
      cardBankButton: 0,
      confirmNigeria: 0,
    });

    await TestRenderer.act(async () => {
      pending.resolve(
        edgeFailure({ error: "forbidden", detail: "permission_denied" }),
      );
    });
    await flush();
    const message = textOf(only(tree, "bank-connect-rail-error"));
    expect(message).not.toMatch(/connection|try again|stripe|paystack|forbidden/i);
    expect(count(tree, "bank-connect-rail-retry")).toBe(0);
    // A refused Nigeria switch must not fall through to card-rail setup.
    expect(offered(tree)).toEqual({
      nigeriaBankForm: 0,
      cardBankButton: 0,
      confirmNigeria: 0,
    });
    expect(count(tree, "bank-connect-back")).toBe(1);
  });

  test("Y4: a confirm that fails for a passing reason offers Try again, and that reaches the bank form", async () => {
    brandSeed = { ...nigeriaByAddress(), accountId: OTHER_USER_ID };
    tree = await mountBody();
    mockInvoke.mockResolvedValueOnce(
      edgeFailure({
        error: "stamp_failed",
        detail: "paystack_provider_select_stamp_retryable",
      }),
    );

    await press(tree, "bank-connect-confirm-nigeria");
    expect(count(tree, "bank-connect-rail-error")).toBe(1);
    expect(offered(tree)).toEqual({
      nigeriaBankForm: 0,
      cardBankButton: 0,
      confirmNigeria: 0,
    });

    await press(tree, "bank-connect-rail-retry");
    expect(sent()).toEqual(["select_provider", "select_provider"]);
    expect(offered(tree)).toEqual({
      nigeriaBankForm: 1,
      cardBankButton: 0,
      confirmNigeria: 0,
    });
  });

  test("Y5: Back while the confirm is in flight leaves at once and sends nothing else", async () => {
    brandSeed = { ...nigeriaByAddress(), accountId: OTHER_USER_ID };
    tree = await mountBody();
    const pending = deferred();
    mockInvoke.mockReturnValueOnce(pending.promise);
    await press(tree, "bank-connect-confirm-nigeria");
    expect(count(tree, "bank-connect-rail-switching")).toBe(1);

    await press(tree, "bank-connect-back");
    expect(router.replace).toHaveBeenCalledWith(`/brand/${BRAND_ID}/payments`);

    await TestRenderer.act(async () => {
      tree?.unmount();
    });
    tree = null;
    await TestRenderer.act(async () => {
      pending.resolve({ data: {}, error: null });
    });
    await flush();
    expect(sent()).toEqual(["select_provider"]);
  });
});
