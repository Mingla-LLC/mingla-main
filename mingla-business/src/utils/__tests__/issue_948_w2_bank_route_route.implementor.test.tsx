/**
 * #948 Wave 2 — real route render/fire proof.
 *
 * Mounts the production app/brand/[id]/connect.web route, presses its primary
 * CTA, and observes the mocked hook boundaries and browser navigation. Child
 * primitives are reduced to inert host elements so this test stays runnable in
 * the required default Business Jest gate; the route state/effects/callbacks
 * and the real BrandStripeCountryPicker confirmation row remain production
 * code.
 */

/* eslint-disable @typescript-eslint/no-require-imports, import/first */

import React from "react";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const BRAND_ID = "2b7c8f6a-1111-4a22-8333-123456789abc";
const USER_ID = "79f45786-2222-4b33-8444-123456789abc";
const ORIGIN = "https://business.usemingla.com";
const ONBOARDING_URL =
  `${ORIGIN}/connect-onboarding?session=acct_session_secret&brand_id=${BRAND_ID}`;

interface BrandSeed {
  id: string;
  displayName: string;
  countryCode: string | null;
  paymentProvider: string | null;
}

let brandSeed: BrandSeed;
let params: { id: string; provider?: string };
let acceptTerms: jest.Mock;
let mintOnboarding: jest.Mock;
let assignLocation: jest.Mock;

const router = {
  back: jest.fn(),
  canGoBack: jest.fn(() => false),
  replace: jest.fn(),
};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => params,
  useRouter: () => router,
}));

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: USER_ID } }),
}));

jest.mock("../../hooks/useBrands", () => ({
  useBrand: () => ({
    data: brandSeed,
    isError: false,
    isFetched: true,
    isLoading: false,
    refetch: jest.fn(),
  }),
}));

jest.mock("../../hooks/useMinglaToSAcceptance", () => ({
  CURRENT_MINGLA_TOS_VERSION: "v3-pre-launch-placeholder",
  useAcceptMinglaToS: () => ({
    isPending: false,
    mutateAsync: acceptTerms,
  }),
}));

jest.mock("../../hooks/useStartBrandStripeOnboarding", () => ({
  useStartBrandStripeOnboarding: () => ({
    isPending: false,
    mutateAsync: mintOnboarding,
  }),
}));

jest.mock("../../services/brandStripeService", () => ({
  startBrandStripeOnboarding: (
    brandId: string,
    returnUrl: string,
    country?: string,
  ) => mintOnboarding({ brandId, returnUrl, country }),
}));

jest.mock("@tanstack/react-query", () => ({
  useMutation: ({
    mutationFn,
    onError,
    onSuccess,
  }: {
    mutationFn: (input: {
      brandId: string;
      country?: string;
      returnUrl: string;
    }) => Promise<unknown>;
    onError?: (
      error: Error,
      input: { brandId: string; country?: string; returnUrl: string },
    ) => void;
    onSuccess?: (
      data: unknown,
      input: { brandId: string; country?: string; returnUrl: string },
    ) => void;
  }) => ({
    isPending: false,
    mutateAsync: async (input: {
      brandId: string;
      country?: string;
      returnUrl: string;
    }) => {
      try {
        const data = await mutationFn(input);
        onSuccess?.(data, input);
        return data;
      } catch (error) {
        onError?.(error as Error, input);
        throw error;
      }
    },
  }),
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
  }),
}));

jest.mock("../../hooks/useBrandStripeCountries", () => ({
  useBrandStripeCountries: () => ({
    data: [],
    isError: false,
    isLoading: false,
    refetch: jest.fn(),
  }),
}));

jest.mock("expo-haptics", () => ({
  NotificationFeedbackType: { Success: "success" },
  notificationAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
}));

jest.mock("../../wrappers/SmartScrollView", () => {
  const { ScrollView } = require("react-native");
  return { ScrollView };
});

jest.mock("../../components/ui/Sheet", () => {
  const { View } = require("react-native");
  return {
    Sheet: ({
      children,
      visible,
    }: {
      children?: React.ReactNode;
      visible: boolean;
    }) => visible ? <View>{children}</View> : null,
  };
});

jest.mock("../../components/ui/Button", () => {
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

jest.mock("../../components/ui/GlassCard", () => {
  const { View } = require("react-native");
  return {
    GlassCard: ({ children }: { children?: React.ReactNode }) => (
      <View>{children}</View>
    ),
  };
});

jest.mock("../../components/ui/Icon", () => {
  const { View } = require("react-native");
  return {
    Icon: ({ name }: { name: string }) => <View testID={`icon-${name}`} />,
  };
});

jest.mock("../../components/ui/Spinner", () => {
  const { View } = require("react-native");
  return {
    Spinner: () => <View testID="spinner" />,
  };
});

jest.mock("../../components/brand/BrandPaystackOnboardView", () => {
  const { Text, View } = require("react-native");
  return {
    BrandPaystackOnboardView: ({
      brandId,
    }: {
      brandId: string;
    }) => (
      <View testID="real-route-paystack-view">
        <Text>{`Paystack form for ${brandId}`}</Text>
      </View>
    ),
  };
});

import BrandBankConnectWebRoute from "../../../app/brand/[id]/connect.web";

interface TestInstance {
  children: (TestInstance | string)[];
  findByProps: (props: Record<string, unknown>) => TestInstance;
  props: Record<string, unknown>;
}

interface TestTree {
  root: TestInstance;
  unmount: () => void;
}

// react-test-renderer has no bundled types in this repo.
const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => Promise<void> | void) => Promise<void> | void;
  create: (element: React.ReactElement) => TestTree;
};

function renderedText(node: TestInstance | string): string {
  if (typeof node === "string") return node;
  return node.children.map(renderedText).join(" ");
}

async function flush(): Promise<void> {
  await TestRenderer.act(async () => {
    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve();
    }
  });
}

async function mountRoute(): Promise<TestTree> {
  let tree: TestTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<BrandBankConnectWebRoute />);
  });
  await flush();
  if (tree === null) throw new Error("Route did not mount.");
  return tree;
}

describe("#948 W2 implementor — production connect route render/fire", () => {
  let tree: TestTree | null = null;

  beforeEach(() => {
    params = { id: BRAND_ID };
    brandSeed = {
      id: BRAND_ID,
      displayName: "Route Proof Brand",
      countryCode: "US",
      paymentProvider: "stripe",
    };
    acceptTerms = jest.fn(async () => ({ accepted: true }));
    mintOnboarding = jest.fn(async () => ({
      onboarding_url: ONBOARDING_URL,
    }));
    assignLocation = jest.fn();
    router.back.mockClear();
    router.replace.mockClear();
    router.canGoBack.mockReturnValue(false);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          assign: assignLocation,
          origin: ORIGIN,
        },
      },
      writable: true,
    });
  });

  afterEach(() => {
    if (tree !== null) {
      TestRenderer.act(() => tree?.unmount());
      tree = null;
    }
  });

  test("pressing the real route CTA records Terms before mint and same-tab form navigation", async () => {
    const calls: string[] = [];
    acceptTerms.mockImplementation(async () => {
      calls.push("terms");
      return { accepted: true };
    });
    mintOnboarding.mockImplementation(async () => {
      calls.push("mint");
      return { onboarding_url: ONBOARDING_URL };
    });
    assignLocation.mockImplementation(() => {
      calls.push("assign");
    });

    tree = await mountRoute();
    const cta = tree.root.findByProps({ testID: "bank-connect-primary" });
    await TestRenderer.act(async () => {
      await (cta.props.onPress as () => Promise<void>)();
    });

    expect(calls).toEqual(["terms", "mint", "assign"]);
    expect(acceptTerms).toHaveBeenCalledWith({
      brandId: BRAND_ID,
      userId: USER_ID,
      version: "v3-pre-launch-placeholder",
    });
    expect(mintOnboarding).toHaveBeenCalledWith({
      brandId: BRAND_ID,
      country: "US",
      returnUrl: `${ORIGIN}/brand/${BRAND_ID}/payments`,
    });
    expect(assignLocation).toHaveBeenCalledWith(ONBOARDING_URL);
  });

  test("US brand renders the real payout confirmation row with USD and quiet Change", async () => {
    tree = await mountRoute();
    const text = renderedText(tree.root);
    expect(text).toContain("PAYOUTS IN");
    expect(text).toContain("United States · USD");
    expect(text).toContain("Change");
    expect(tree.root.findByProps({
      accessibilityLabel: "Payout country: United States, tap to change",
    })).toBeTruthy();
  });

  test("NG brand renders the Paystack form directly without a Stripe CTA", async () => {
    brandSeed = {
      ...brandSeed,
      countryCode: "NG",
      paymentProvider: "paystack",
    };
    tree = await mountRoute();
    expect(
      tree.root.findByProps({ testID: "real-route-paystack-view" }),
    ).toBeTruthy();
    expect(renderedText(tree.root)).toContain("Nigeria · NGN");
    expect(() =>
      tree?.root.findByProps({ testID: "bank-connect-primary" })
    ).toThrow();
  });

  test.each([null, "ZZ"])(
    "brand country %p renders the safe GB/GBP fallback",
    async (countryCode) => {
      brandSeed = {
        ...brandSeed,
        countryCode,
        paymentProvider: "stripe",
      };
      tree = await mountRoute();
      expect(renderedText(tree.root)).toContain("United Kingdom · GBP");
    },
  );
});
