/**
 * #4389 P2 — K1 on an early close. Closing the secure setup before the payment
 * details were submitted never showed K1 "Only free events for now?": the exit
 * rule counted "needs information" (details still due) as finished, and the
 * browser-sheet return ignored brand setup altogether.
 *
 * Fix: from brand setup, after the native screen's onExit OR the browser
 * sheet's return, refresh_status (the live read F4 uses) decides: submitted or
 * pending verification → F4 ("finished"); anything still due or nothing
 * started → Get paid with K1 ("closed-early").
 *
 * FAILS ON REVERT: classify by the settled outcome alone (drop decideSetupExit)
 * → N1/B1 report "finished"; drop the browser-sheet brand-setup branch → B1/B2
 * never call onNativeExit.
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
    // The settled read answers at once (restricted, details due).
    refetch: jest.fn(async () => ({ data: { status: "restricted", requirements: { currently_due: ["individual.dob.day"] } } })),
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

describe("#4389 P2 — closing the secure setup early from brand setup shows K1", () => {
  let tree: { unmount: () => void } | null = null;
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

  beforeAll(() => {
    Object.defineProperty(require("react-native").Platform, "OS", { configurable: true, get: () => "ios" });
  });
  beforeEach(() => {
    mockTermsAccepted = true;
    mockNative = false;
    mockNativeOnExit = null;
    mockRefresh.mockClear();
    onExit.mockClear();
    mockOpenAuthSession.mockClear();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => {
    if (tree !== null) TestRenderer.act(() => tree?.unmount());
    tree = null;
    queryClient.clear();
  });

  test("N1: native screen closed with details still due → refresh_status → closed-early (K1)", async () => {
    mockNative = true;
    await open();
    expect(mockNativeOnExit).not.toBeNull();
    await TestRenderer.act(async () => mockNativeOnExit?.());
    await flush();
    expect(mockRefresh).toHaveBeenCalledWith(BRAND_ID);
    expect(onExit).toHaveBeenCalledWith("closed-early");
  });

  test("N2: native screen closed after submitting → finished (F4)", async () => {
    mockNative = true;
    mockRefresh.mockImplementationOnce(async () => ({ state: "submitted", due: [] }));
    await open();
    await TestRenderer.act(async () => mockNativeOnExit?.());
    await flush();
    expect(onExit).toHaveBeenCalledWith("finished");
  });

  test("B1: browser sheet dismissed with nothing submitted → closed-early (K1)", async () => {
    mockRefresh.mockImplementationOnce(async () => ({ state: "not_started", due: [] }));
    await open();
    expect(mockOpenAuthSession).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledWith(BRAND_ID);
    expect(onExit).toHaveBeenCalledWith("closed-early");
  });

  test("B2: browser sheet returned after submitting → finished (F4)", async () => {
    mockRefresh.mockImplementationOnce(async () => ({ state: "submitted", due: [] }));
    await open();
    expect(onExit).toHaveBeenCalledWith("finished");
  });
});
