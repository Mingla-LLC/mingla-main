// MINGLA-INVARIANT: I-4389-WEB-CONNECT-FROM-SETUP | issue #4389 | Host web /brand/{id}/connect from brand setup (from=brand-create) with a saved payout_country and accepted Organiser Terms starts the embedded secure setup at once (no intro, no have-ready card); terms not on record shows the screen without starting anything. Elsewhere the intro is "Connect your bank" + one line with the 3-line have-ready card; never "business", never the provider.
/**
 * FAILS-ON-REVERT: delete the auto-start effect in BrandBankConnectBody.web.tsx
 * (`if (!autoStartReady) return; … handleStartStripe()`) and W1 fails; restore
 * the old "Add your bank" intro / "Business name and tax ID" card and W3 fails.
 *
 *   cd mingla-business && npx jest \
 *     src/components/brand/__tests__/issue_4389_web_connect_from_setup.implementor.test.tsx
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import React from "react";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BRAND_ID = "2b7c8f6a-1111-4a22-8333-123456789abc";
const USER_ID = "79f45786-2222-4b33-8444-123456789abc";

let mockParams: Record<string, string> = {};
let mockAccepted = true;
const mockStart = jest.fn(async (_input: Record<string, unknown>) => undefined);
const mockBrand = {
  id: BRAND_ID,
  displayName: "Tester US Brand",
  countryCode: "US",
  paymentProvider: "stripe",
  defaultCurrency: "USD",
  payoutCountry: "US",
  accountId: USER_ID,
  stripeStatus: "not_connected",
};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ back: jest.fn(), canGoBack: () => false, replace: jest.fn() }),
}));
jest.mock("../../../context/AuthContext", () => ({ useAuth: () => ({ user: { id: USER_ID } }) }));
jest.mock("../../../hooks/useBrands", () => {
  const { brandKeys } = jest.requireActual("../../../hooks/brandKeys");
  return {
    brandKeys,
    useBrand: () => ({ data: mockBrand, isError: false, isFetched: true, isLoading: false, refetch: jest.fn() }),
  };
});
jest.mock("../../../hooks/useMinglaToSAcceptance", () => ({
  CURRENT_MINGLA_TOS_VERSION: "1.0",
  ORGANISER_TERMS_URL: "https://usemingla.com/organiser-terms",
  useAcceptMinglaToS: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useMinglaToSAcceptance: (brandId: string | null) => ({
    data: brandId === null ? undefined : { accepted: mockAccepted },
    isLoading: false,
  }),
  isCurrentMinglaToSAccepted: (data: { accepted?: boolean } | undefined) => data?.accepted === true,
}));
jest.mock("expo-haptics", () => ({ selectionAsync: jest.fn(), notificationAsync: jest.fn(), NotificationFeedbackType: { Success: "s" } }));
jest.mock("../../../utils/bankConnectFunnel", () => ({
  startStripeWebBankConnect: (input: Record<string, unknown>) => mockStart(input),
}));
jest.mock("../../../services/brandPayoutCountryService", () => ({
  rememberBrandPayoutCountry: jest.fn(async () => undefined),
  healRememberedPayoutCountry: jest.fn(),
  fetchBrandCardAccountCountry: jest.fn(async () => null),
}));
jest.mock("../../../services/supabase", () => ({
  supabase: { from: jest.fn(), rpc: jest.fn(), functions: { invoke: jest.fn() }, auth: {} },
}));
jest.mock("../../ui/Button", () => {
  const { Pressable, Text } = require("react-native");
  return {
    Button: ({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) => (
      <Pressable accessibilityLabel={label} onPress={onPress} testID={testID}><Text>{label}</Text></Pressable>
    ),
  };
});
jest.mock("../../ui/GlassCard", () => {
  const { View } = require("react-native");
  return { GlassCard: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => <View testID={testID}>{children}</View> };
});
jest.mock("../../ui/Icon", () => {
  const { View } = require("react-native");
  return { Icon: () => <View /> };
});
jest.mock("../../ui/Spinner", () => {
  const { View } = require("react-native");
  return { Spinner: () => <View testID="spinner" /> };
});
jest.mock("../../invite/BusinessAppDownloadCta", () => ({ BusinessAppDownloadCta: (): null => null }));
jest.mock("../BrandStripeCountryPicker", () => {
  const { View } = require("react-native");
  return { BrandStripeCountryPicker: () => <View testID="country-picker" /> };
});
jest.mock("../BrandPaystackOnboardView", () => ({ BrandPaystackOnboardView: (): null => null }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import BrandBankConnectBody from "../BrandBankConnectBody.web";
import { BRAND_SETUP_BANNED_WORDS } from "../brandSetupCopy";

interface Node { type: unknown; props: Record<string, unknown>; children: (Node | string)[] }
interface Tree { root: Node & { findAllByProps: (p: Record<string, unknown>) => Node[] }; unmount: () => void }
const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => Promise<void> | void) => Promise<void> | void;
  create: (el: React.ReactElement) => Tree;
};
const textOf = (n: Node | string): string => (typeof n === "string" ? n : n.children.map(textOf).join(""));
const count = (t: Tree, testID: string): number => t.root.findAllByProps({ testID }).filter((n) => typeof n.type === "string").length;

describe("#4389 web /connect from brand setup", () => {
  let tree: Tree | null = null;
  const origLocation = (globalThis as { window?: unknown }).window;

  beforeAll(() => {
    (globalThis as { window?: unknown }).window = { location: { origin: "https://host.usemingla.com", assign: jest.fn() } };
  });
  afterAll(() => {
    (globalThis as { window?: unknown }).window = origLocation;
  });
  beforeEach(() => {
    mockStart.mockClear();
    mockAccepted = true;
  });
  afterEach(() => {
    if (tree !== null) TestRenderer.act(() => tree?.unmount());
    tree = null;
  });

  async function mount(params: Record<string, string>): Promise<Tree> {
    mockParams = { id: BRAND_ID, ...params };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let t: Tree | null = null;
    await TestRenderer.act(async () => {
      t = TestRenderer.create(<QueryClientProvider client={qc}><BrandBankConnectBody /></QueryClientProvider>);
    });
    await TestRenderer.act(async () => {
      for (let i = 0; i < 5; i += 1) await new Promise<void>((r) => setTimeout(r, 0));
    });
    return t as unknown as Tree;
  }

  test("W1: from setup, country saved, terms accepted: the secure setup starts at once; no intro, no picker, no have-ready card", async () => {
    tree = await mount({ from: "brand-create" });
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart.mock.calls[0]![0]).toMatchObject({ brandId: BRAND_ID, country: "US", destination: "brand-create" });
    expect(count(tree, "bank-connect-opening-secure-setup")).toBe(1);
    expect(count(tree, "country-picker")).toBe(0);
    expect(count(tree, "bank-connect-have-ready")).toBe(0);
    expect(textOf(tree.root)).not.toContain("Connect your bank");
  });

  test("W2: from setup without accepted terms: nothing starts by itself", async () => {
    mockAccepted = false;
    tree = await mount({ from: "brand-create" });
    expect(mockStart).not.toHaveBeenCalled();
    expect(count(tree, "bank-connect-opening-secure-setup")).toBe(0);
    expect(count(tree, "bank-connect-have-ready")).toBe(0);
  });

  test("W3: elsewhere: 'Connect your bank' + one line and the 3-line have-ready card; no 'business', no provider", async () => {
    tree = await mount({});
    expect(mockStart).not.toHaveBeenCalled();
    const text = textOf(tree.root);
    expect(text).toContain("Connect your bank");
    expect(text).toContain("About 5 minutes. Your bank details go straight to our payment partner.");
    const ready = textOf(tree.root.findAllByProps({ testID: "bank-connect-have-ready" }).filter((n) => typeof n.type === "string")[0]!);
    expect(ready).toContain("Photo ID");
    expect(ready).toContain("Bank account in United States");
    expect(ready).toContain("Tax ID (registered companies only)");
    for (const banned of BRAND_SETUP_BANNED_WORDS) expect(text).not.toMatch(banned);
  });
});
