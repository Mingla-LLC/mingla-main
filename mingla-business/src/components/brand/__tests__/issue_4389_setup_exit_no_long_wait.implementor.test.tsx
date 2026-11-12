/**
 * #4389 (iPhone 15 recording 22:59–23:00; local log 03:59:41Z–04:00:18Z) —
 * after the secure setup said "Account onboarded" the host sat ~37 s on
 * "Checking your payout status…" with only Cancel. Right after submitting,
 * the account reads "restricted / requirements.pending_verification"; the exit
 * ran the 15-attempt status settle (it keeps polling on pending verification:
 * 15 brand-stripe-refresh-status calls 2.5 s apart in the log) BEFORE the one
 * refresh_status read that decides F4 vs K1.
 *
 *   W1 native exit from brand setup → refresh_status decides at once; the status
 *      settle is not run (≤ 1 status read), F4 follows;
 *   W2 while it reads, the screen says what is happening and for how long;
 *   W3 a refresh_status read that hangs is cut at the timeout and falls back to
 *      ONE status read (never a blank wait);
 *   W4 the browser sheet return follows the same rule.
 *
 * FAILS ON REVERT: settleOutcome before decideSetupExit → W1/W4 count 15 status
 * reads (and onExit never comes within the test's flush); old copy → W2.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */

import React from "react";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BRAND_ID = "2b7c8f6a-1111-4a22-8333-123456789abd";
const USER_ID = "79f45786-2222-4b33-8444-123456789abd";
let mockNative = false;
let mockNativeOnExit: (() => void) | null = null;
const mockRefresh = jest.fn(async (_id: string) => ({ state: "action_needed" as "submitted" | "action_needed" | "not_started", due: ["individual.dob.day"] }));

let mockTermsAccepted = true;
const mockStart = jest.fn(async (_input: Record<string, unknown>) => ({
  onboarding_url: "https://connect.example/onboard",
  client_secret: "secret_test",
}));
const mockRefetch = jest.fn(async () => ({
  data: { status: "restricted", requirements: { disabled_reason: "requirements.pending_verification", currently_due: [], past_due: [] } },
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
  useNativeConnectOnboardingRelease: () => ({ flagLive: mockNative, devForce: false }),
}));
jest.mock("../../../services/brandSetupService", () => ({
  ...(jest.requireActual("../../../services/brandSetupService") as object),
  refreshStripeSetupStatus: (id: string) => mockRefresh(id),
}));
jest.mock("../../../hooks/useBrandStripeStatus", () => ({
  brandStripeStatusKeys: { detail: (id: string) => ["brand-stripe-status", id] as const },
  useBrandStripeStatus: () => ({
    data: { status: "not_connected", stripe_account_id: null, country: null },
    isLoading: false,
    isFetched: true,
    isError: false,
    error: null,
    // Right after submitting: restricted, pending verification (the settle keeps polling).
    refetch: (...args: unknown[]) => mockRefetch(...(args as [])),
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
  ConnectOnboardingNative: (p: { onExit: () => void }): null => {
    mockNativeOnExit = p.onExit;
    return null;
  },
  isNativeConnectModuleAvailable: (): boolean => mockNative,
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
import type { Brand } from "../../../store/currentBrandStore";

const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => Promise<void> | void) => Promise<void> | void;
  create: (element: React.ReactElement) => { unmount: () => void };
};

const brand = {
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
} as unknown as Brand;

const flush = async (): Promise<void> => {
  await TestRenderer.act(async () => {
    for (let i = 0; i < 8; i += 1) await new Promise<void>((r) => setTimeout(r, 0));
  });
};

describe("#4389 — leaving the secure setup never waits on the long status settle", () => {
  let tree: { unmount: () => void; root?: unknown } | null = null;
  let queryClient: QueryClient;
  const onExit = jest.fn();

  async function open(): Promise<void> {
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <QueryClientProvider client={queryClient}>
          <BrandOnboardView brand={brand} onCancel={jest.fn()} onAfterDone={jest.fn()} fromSetup onNativeExit={onExit} />
        </QueryClientProvider>,
      );
    });
    await flush();
  }
  const text = (): string => JSON.stringify((tree as unknown as { toJSON: () => unknown }).toJSON());

  beforeAll(() => {
    Object.defineProperty(require("react-native").Platform, "OS", { configurable: true, get: () => "ios" });
  });
  beforeEach(() => {
    mockTermsAccepted = true;
    mockNative = true;
    mockNativeOnExit = null;
    mockRefresh.mockReset();
    mockRefetch.mockClear();
    onExit.mockClear();
    mockOpenAuthSession.mockClear();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => {
    jest.useRealTimers();
    if (tree !== null) TestRenderer.act(() => tree?.unmount());
    tree = null;
    queryClient.clear();
  });

  test("W1: native exit after submitting → F4 at once, no status settle", async () => {
    mockRefresh.mockImplementation(async () => ({ state: "submitted", due: [] }));
    await open();
    await TestRenderer.act(async () => mockNativeOnExit?.());
    await flush();
    expect(onExit).toHaveBeenCalledWith("finished");
    expect(mockRefetch.mock.calls.length).toBeLessThanOrEqual(1);
  });

  test("W2: while it reads, the screen says what is happening and how long", async () => {
    let release: (v: { state: "submitted"; due: string[] }) => void = () => undefined;
    mockRefresh.mockImplementation(() => new Promise((r) => { release = r; }));
    await open();
    await TestRenderer.act(async () => { mockNativeOnExit?.(); });
    await flush();
    expect(text()).toContain("Checking your details with our payment partner");
    expect(text()).toContain("This usually takes under a minute.");
    expect(text()).not.toContain("Checking your payout status");
    await TestRenderer.act(async () => release({ state: "submitted", due: [] }));
    await flush();
    expect(onExit).toHaveBeenCalledWith("finished");
  });

  test("W3: a hanging refresh_status is cut at the timeout and falls back to one status read", async () => {
    const { decideBrandSetupExit } = require("../../stripe/nativeConnectOnboarding") as typeof import("../../stripe/nativeConnectOnboarding");
    jest.useFakeTimers();
    const readStatusOnce = jest.fn(async () => "complete-verifying" as const);
    const p = decideBrandSetupExit({ readLive: () => new Promise(() => undefined), readStatusOnce, timeoutMs: 20000 });
    await jest.advanceTimersByTimeAsync(20001);
    await expect(p).resolves.toBe("finished");
    expect(readStatusOnce).toHaveBeenCalledTimes(1);
    const both = decideBrandSetupExit({
      readLive: async () => { throw new Error("down"); },
      readStatusOnce: async () => { throw new Error("down"); },
    });
    await expect(both).resolves.toBe("finished");
  });

  test("W4: browser sheet return follows the same rule (no settle first)", async () => {
    mockNative = false;
    mockRefresh.mockImplementation(async () => ({ state: "submitted", due: [] }));
    await open();
    expect(mockOpenAuthSession).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith("finished");
    expect(mockRefetch.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
