// MINGLA-INVARIANT: I-4389-ONBOARD-FROM-SETUP-NO-INTRO | issue #4389 | Arriving at bank setup from brand setup (from=brand-create) with a saved bank country and accepted Organiser Terms opens the secure setup by itself: no country picker, no terms gate, no have-ready card. Terms not accepted shows the terms gate alone. The intro copy never says "publish your offerings" or "business" and never names the provider.
/**
 * Seth (2026-11-11): "Continue to secure setup" at F3 landed on an intro that
 * repeated the country picker, the terms and the have-ready card.
 *
 * FAILS-ON-REVERT: delete the auto-start effect in BrandOnboardView (the
 * `if (!autoStartPending || !tosPassed …) … handleStart()` block) and S1 fails
 * (no start, the intro shows); drop the `!fromSetup` have-ready guard and
 * S2 fails; restore the old intro text and C1 fails.
 *
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/issue_4389_onboard_from_setup.implementor.test.tsx
 */

/* eslint-disable @typescript-eslint/no-require-imports, import/first */

import React from "react";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const BRAND_ID = "2b7c8f6a-1111-4a22-8333-123456789abc";
const USER_ID = "79f45786-2222-4b33-8444-123456789abc";

let mockTermsAccepted = true;
const mockStart = jest.fn(async (_input: Record<string, unknown>) => ({
  onboarding_url: "https://connect.example/onboard",
  client_secret: "secret_test",
}));
const mockOpenAuthSession = jest.fn(async () => ({ type: "cancel" }));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSession(...(args as [])),
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
    ScrollView: ({ children }: { children?: React.ReactNode }) => <View>{children}</View>,
  };
});
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: USER_ID } }),
}));
jest.mock("../../../hooks/useSwitchAccount", () => ({
  useSwitchAccount: () => ({ signedInEmail: null, onSwitchAccount: jest.fn() }),
}));
jest.mock("../../../hooks/useStartBrandStripeOnboarding", () => ({
  useStartBrandStripeOnboarding: () => ({ isPending: false, mutate: jest.fn(), mutateAsync: (input: Record<string, unknown>) => mockStart(input) }),
}));
jest.mock("../../../hooks/useNativeConnectOnboardingRelease", () => ({
  useNativeConnectOnboardingRelease: () => ({ flagLive: false, devForce: false }),
}));
jest.mock("../../../hooks/useBrandStripeStatus", () => ({
  brandStripeStatusKeys: { detail: (id: string) => ["brand-stripe-status", id] as const },
  useBrandStripeStatus: () => ({
    data: { status: "not_connected", stripe_account_id: null, country: null },
    isLoading: false,
    isFetched: true,
    isError: false,
    error: null,
    refetch: jest.fn(async () => ({ data: { status: "not_connected" } })),
  }),
}));
jest.mock("../../../hooks/useBrandStripeAccountSession", () => ({
  useBrandStripeAccountSession: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));
jest.mock("../../../hooks/useBrandPaystack", () => ({
  useSelectPaystackProvider: () => ({ mutateAsync: jest.fn() }),
  useClearPaystackProvider: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock("../../../services/brandPayoutCountryService", () => ({
  rememberBrandPayoutCountry: jest.fn(async () => undefined),
  healRememberedPayoutCountry: jest.fn(),
}));
jest.mock("../../../services/supabase", () => ({
  supabase: { from: jest.fn(), rpc: jest.fn(), functions: { invoke: jest.fn() }, auth: {} },
}));
jest.mock("../../ui/Button", () => {
  const { Pressable, Text } = require("react-native");
  return {
    Button: ({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) => (
      <Pressable accessibilityLabel={label} onPress={onPress} testID={testID}>
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});
jest.mock("../../ui/GlassCard", () => {
  const { View } = require("react-native");
  return {
    GlassCard: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => (
      <View testID={testID}>{children}</View>
    ),
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
jest.mock("../../door/tap/TapToPayOnboardingCard", () => ({ TapToPayOnboardingCard: (): null => null }));
jest.mock("../../stripe/ConnectOnboardingNative", () => ({
  ConnectOnboardingNative: (): null => null,
  isNativeConnectModuleAvailable: (): boolean => false,
}));
jest.mock("../../onboarding/MinglaToSAcceptanceGate", () => {
  const ReactActual = jest.requireActual("react") as typeof React;
  const { View } = require("react-native");
  return {
    MinglaToSAcceptanceGate: ({ onPassed, onShown }: { onPassed: () => void; onShown?: () => void }) => {
      ReactActual.useEffect(() => {
        if (mockTermsAccepted) onPassed();
        else onShown?.();
      }, [onPassed, onShown]);
      return mockTermsAccepted ? null : <View testID="tos-gate" />;
    },
  };
});
jest.mock("../../auth/SignedInNotFoundNotice", () => ({ SignedInNotFoundNotice: (): null => null }));
jest.mock("../BrandStripeCountryPicker", () => {
  const { View } = require("react-native");
  return { BrandStripeCountryPicker: () => <View testID="country-picker" /> };
});
jest.mock("../BrandPaystackOnboardView", () => {
  const { View } = require("react-native");
  return {
    BrandPaystackOnboardView: (props: { onCancel?: () => void; hideIntro?: boolean }) => (
      <View testID="paystack-view" accessibilityHint={`hideIntro:${props.hideIntro === true}`} />
    ),
  };
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { BrandOnboardView } from "../BrandOnboardView";
import { BRAND_SETUP_BANNED_WORDS } from "../brandSetupCopy";
import type { Brand } from "../../../store/currentBrandStore";

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

const count = (tree: TestTree, testID: string): number =>
  tree.root.findAllByProps({ testID }).filter((n) => typeof n.type === "string").length;
const textOf = (node: TestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");

const brandOf = (patch: Partial<Brand>): Brand =>
  ({
    id: BRAND_ID,
    displayName: "Tester US Brand",
    slug: "testerus",
    address: null,
    coverHue: 25,
    accountId: USER_ID,
    role: "owner",
    stats: { events: 0, rev: 0, rev7d: 0, attendees: 0 },
    currentLiveEvent: null,
    paymentProvider: "stripe",
    stripeStatus: "not_connected",
    countryCode: "US",
    defaultCurrency: "USD",
    payoutCountry: "US",
    ...patch,
  }) as Brand;

describe("#4389 — bank setup from brand setup skips the intro", () => {
  let tree: TestTree | null = null;
  let queryClient: QueryClient;

  async function mount(brand: Brand, fromSetup: boolean): Promise<TestTree> {
    let mounted: TestTree | null = null;
    await TestRenderer.act(async () => {
      mounted = TestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <BrandOnboardView brand={brand} onCancel={jest.fn()} onAfterDone={jest.fn()} fromSetup={fromSetup} />
        </QueryClientProvider>,
      );
    });
    await TestRenderer.act(async () => {
      for (let i = 0; i < 5; i += 1) await new Promise<void>((r) => setTimeout(r, 0));
    });
    if (mounted === null) throw new Error("did not mount");
    return mounted;
  }

  // The default jest config resolves react-native to its web build; this
  // screen's native path (the phone the host is on) is the one under test.
  beforeAll(() => {
    Object.defineProperty(require("react-native").Platform, "OS", { configurable: true, get: () => "ios" });
  });

  beforeEach(() => {
    mockTermsAccepted = true;
    mockStart.mockClear();
    mockOpenAuthSession.mockClear();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => {
    if (tree !== null) TestRenderer.act(() => tree?.unmount());
    tree = null;
    queryClient.clear();
  });

  test("S1: country saved + terms accepted: the secure setup starts by itself; no picker, no terms gate, no have-ready card", async () => {
    tree = await mount(brandOf({}), true);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart.mock.calls[0]![0]).toMatchObject({ brandId: BRAND_ID, country: "US" });
    expect(mockOpenAuthSession).toHaveBeenCalledTimes(1);
    expect(count(tree, "country-picker")).toBe(0);
    expect(count(tree, "tos-gate")).toBe(0);
    expect(count(tree, "onboard-have-ready")).toBe(0);
    expect(textOf(tree.root)).not.toContain("Connect your bank");
  });

  test("S2: terms not accepted: the terms gate alone, nothing started, no loading line, no intro", async () => {
    mockTermsAccepted = false;
    tree = await mount(brandOf({}), true);
    expect(mockStart).not.toHaveBeenCalled();
    expect(count(tree, "tos-gate")).toBe(1);
    expect(count(tree, "onboard-opening-secure-setup")).toBe(0);
    expect(count(tree, "country-picker")).toBe(0);
    expect(count(tree, "onboard-have-ready")).toBe(0);
  });

  test("S3: Nigeria from setup: the bank form straight away, no intro and no country switch on it", async () => {
    tree = await mount(brandOf({ paymentProvider: "paystack", payoutCountry: "NG", countryCode: "NG", defaultCurrency: "NGN" }), true);
    const form = tree.root.findAllByProps({ testID: "paystack-view" }).filter((n) => typeof n.type === "string");
    expect(form).toHaveLength(1);
    expect(form[0]!.props.accessibilityHint).toBe("hideIntro:true");
    expect(mockStart).not.toHaveBeenCalled();
  });

  test("S4: from Payments (not setup), a saved country shows the read-only summary and the trimmed have-ready card; nothing starts by itself", async () => {
    tree = await mount(brandOf({}), false);
    expect(mockStart).not.toHaveBeenCalled();
    expect(count(tree, "country-picker")).toBe(0);
    expect(textOf(tree.root.findAllByProps({ testID: "onboard-country-summary" })[0]!)).toContain("United States · USD");
    const ready = textOf(tree.root.findAllByProps({ testID: "onboard-have-ready" })[0]!);
    expect(ready).toContain("Photo ID");
    expect(ready).toContain("Bank account in United States");
    expect(ready).toContain("Tax ID (registered companies only)");
  });

  test("C1: the intro copy is one title + one line; never 'publish your offerings', 'business' or the provider", async () => {
    tree = await mount(brandOf({ payoutCountry: null }), false);
    const text = textOf(tree.root);
    expect(text).toContain("Connect your bank");
    expect(text).toContain("About 5 minutes. Your bank details go straight to our payment partner.");
    expect(count(tree, "country-picker")).toBe(1);
    expect(text).not.toMatch(/publish your offerings/i);
    for (const banned of BRAND_SETUP_BANNED_WORDS) expect(text).not.toMatch(banned);
  });
});
