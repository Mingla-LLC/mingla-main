/**
 * #948 Wave 2 — independent adversarial bank-route proof.
 *
 * This suite attacks failure, hostile-navigation, duplicate-submit, canonical
 * brand precedence, and native-compatibility boundaries. It deliberately does
 * not repeat the implementor's happy-path sequence assertion.
 */

/* eslint-disable @typescript-eslint/no-require-imports, import/first */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import React from "react";

import {
  isSameOriginConnectOnboardingUrl,
  startStripeWebBankConnect,
} from "../bankConnectFunnel";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const BRAND_ID = "2b7c8f6a-1111-4a22-8333-123456789abc";
const USER_ID = "79f45786-2222-4b33-8444-123456789abc";
const ORIGIN = "https://host.usemingla.com";
const ONBOARDING_URL =
  `${ORIGIN}/connect-onboarding?session=acct_session_secret&brand_id=${BRAND_ID}`;

interface BrandSeed {
  id: string;
  displayName: string;
  countryCode: string | null;
  paymentProvider: "stripe" | "paystack";
}

interface BrandQuerySeed {
  data: BrandSeed | null;
  isError: boolean;
  isFetched: boolean;
  isLoading: boolean;
  refetch: jest.Mock;
}

let params: { id?: string; provider?: string };
let userSeed: { id: string } | null;
let brandQuerySeed: BrandQuerySeed;
let acceptTerms: jest.Mock;
let mintOnboarding: jest.Mock;
let assignLocation: jest.Mock;

const router = {
  back: jest.fn(),
  canGoBack: jest.fn(() => false),
  replace: jest.fn(),
};

jest.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) =>
    React.createElement("redirect", { href }),
  useLocalSearchParams: () => params,
  useRouter: () => router,
}));

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: userSeed }),
}));

jest.mock("../../hooks/useBrands", () => ({
  useBrand: () => brandQuerySeed,
}));

jest.mock("../../hooks/useMinglaToSAcceptance", () => ({
  CURRENT_MINGLA_TOS_VERSION: "v3-pre-launch-placeholder",
  useAcceptMinglaToS: () => ({
    isPending: false,
    mutateAsync: acceptTerms,
  }),
}));

jest.mock("@tanstack/react-query", () => ({
  useMutation: () => ({
    isPending: false,
    mutateAsync: mintOnboarding,
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
    }) => visible ? React.createElement(View, null, children) : null,
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
    }) =>
      React.createElement(
        Pressable,
        {
          accessibilityLabel,
          accessibilityRole: "button",
          disabled,
          onPress,
          testID,
        },
        React.createElement(Text, null, label),
      ),
  };
});

jest.mock("../../components/ui/GlassCard", () => {
  const { View } = require("react-native");
  return {
    GlassCard: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(View, null, children),
  };
});

jest.mock("../../components/ui/Icon", () => {
  const { View } = require("react-native");
  return {
    Icon: ({ name }: { name: string }) =>
      React.createElement(View, { testID: `icon-${name}` }),
  };
});

jest.mock("../../components/ui/Spinner", () => {
  const { View } = require("react-native");
  return {
    Spinner: () => React.createElement(View, { testID: "spinner" }),
  };
});

jest.mock("../../components/brand/BrandPaystackOnboardView", () => {
  const { Text, View } = require("react-native");
  return {
    BrandPaystackOnboardView: ({
      brandId,
    }: {
      brandId: string;
    }) =>
      React.createElement(
        View,
        { testID: "tester-paystack-view" },
        React.createElement(Text, null, `Paystack form for ${brandId}`),
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
    tree = TestRenderer.create(
      React.createElement(BrandBankConnectWebRoute),
    );
  });
  await flush();
  if (tree === null) throw new Error("Route did not mount.");
  return tree;
}

describe("#948 W2 tester — hostile onboarding navigation", () => {
  test.each([
    "http://host.usemingla.com/connect-onboarding?session=x",
    "https://evil.example/connect-onboarding?session=x",
    "https://host.usemingla.com.evil.example/connect-onboarding?session=x",
    "https://host.usemingla.com/connect-onboarding-evil?session=x",
    "https://host.usemingla.com/connect-onboarding",
    "https://host.usemingla.com/connect-onboarding?session=%20%20",
    "not a URL",
  ])("rejects %p before browser assignment", async (onboardingUrl) => {
    const assign = jest.fn();
    const accept = jest.fn(async () => ({ accepted: true }));
    const mint = jest.fn(async () => ({ onboarding_url: onboardingUrl }));

    await expect(
      startStripeWebBankConnect({
        brandId: BRAND_ID,
        userId: USER_ID,
        country: "GB",
        origin: ORIGIN,
        tosVersion: "v3-pre-launch-placeholder",
        acceptTerms: accept,
        mintOnboarding: mint,
        assign,
      }),
    ).rejects.toThrow("unexpected bank setup link");

    expect(accept).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  test("allows only the exact same-origin HTTPS Connect form", () => {
    expect(
      isSameOriginConnectOnboardingUrl(ONBOARDING_URL, ORIGIN),
    ).toBe(true);
    expect(
      isSameOriginConnectOnboardingUrl(
        `${ORIGIN}:444/connect-onboarding?session=x`,
        ORIGIN,
      ),
    ).toBe(false);
  });
});

describe("#948 W2 tester — rendered route failures and races", () => {
  let tree: TestTree | null = null;

  beforeEach(() => {
    params = { id: BRAND_ID };
    userSeed = { id: USER_ID };
    brandQuerySeed = {
      data: {
        id: BRAND_ID,
        displayName: "Adversarial Brand",
        countryCode: "US",
        paymentProvider: "stripe",
      },
      isError: false,
      isFetched: true,
      isLoading: false,
      refetch: jest.fn(async () => undefined),
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

  test("a Terms failure prevents minting and renders an honest alert", async () => {
    acceptTerms.mockRejectedValueOnce(new Error("Terms service unavailable"));
    tree = await mountRoute();
    const cta = tree.root.findByProps({ testID: "bank-connect-primary" });

    await TestRenderer.act(async () => {
      await (cta.props.onPress as () => Promise<void>)();
    });

    expect(mintOnboarding).not.toHaveBeenCalled();
    expect(assignLocation).not.toHaveBeenCalled();
    const alert = tree.root.findByProps({ testID: "bank-connect-error" });
    expect(alert.props.accessibilityRole).toBe("alert");
    expect(renderedText(alert)).toContain("Terms service unavailable");
  });

  test("a mint failure never navigates and surfaces the provider error", async () => {
    mintOnboarding.mockRejectedValueOnce(
      new Error("Secure bank setup is temporarily unavailable"),
    );
    tree = await mountRoute();
    const cta = tree.root.findByProps({ testID: "bank-connect-primary" });

    await TestRenderer.act(async () => {
      await (cta.props.onPress as () => Promise<void>)();
    });

    expect(acceptTerms).toHaveBeenCalledTimes(1);
    expect(mintOnboarding).toHaveBeenCalledTimes(1);
    expect(assignLocation).not.toHaveBeenCalled();
    expect(
      renderedText(
        tree.root.findByProps({ testID: "bank-connect-error" }),
      ),
    ).toContain("Secure bank setup is temporarily unavailable");
  });

  test("two rapid presses produce only one Terms write, mint, and navigation", async () => {
    let releaseTerms: (() => void) | null = null;
    acceptTerms.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseTerms = () => resolve({ accepted: true });
        }),
    );
    tree = await mountRoute();
    const cta = tree.root.findByProps({ testID: "bank-connect-primary" });
    let first: Promise<void> | null = null;
    let second: Promise<void> | null = null;

    await TestRenderer.act(async () => {
      first = (cta.props.onPress as () => Promise<void>)();
      second = (cta.props.onPress as () => Promise<void>)();
      await Promise.resolve();
    });

    expect(acceptTerms).toHaveBeenCalledTimes(1);
    expect(mintOnboarding).not.toHaveBeenCalled();
    expect(releaseTerms).not.toBeNull();

    await TestRenderer.act(async () => {
      releaseTerms?.();
      await Promise.all([first, second]);
    });

    expect(mintOnboarding).toHaveBeenCalledTimes(1);
    expect(assignLocation).toHaveBeenCalledTimes(1);
  });

  test("loaded canonical brand rail outranks a conflicting query hint", async () => {
    params = { id: BRAND_ID, provider: "paystack" };
    tree = await mountRoute();

    expect(renderedText(tree.root)).toContain("United States · USD");
    expect(
      tree.root.findByProps({ testID: "bank-connect-primary" }),
    ).toBeTruthy();
    expect(() =>
      tree?.root.findByProps({ testID: "tester-paystack-view" })
    ).toThrow();
  });

  test("load error, not-found, and signed-out states are explicit and actionable", async () => {
    brandQuerySeed = {
      ...brandQuerySeed,
      data: null,
      isError: true,
    };
    tree = await mountRoute();
    expect(renderedText(tree.root)).toContain("load this brand");
    const retry = tree.root.findByProps({
      accessibilityLabel: "Retry loading bank setup",
    });
    await TestRenderer.act(async () => {
      await (retry.props.onPress as () => Promise<void>)();
    });
    expect(brandQuerySeed.refetch).toHaveBeenCalledTimes(1);
    TestRenderer.act(() => tree?.unmount());

    brandQuerySeed = {
      ...brandQuerySeed,
      data: null,
      isError: false,
    };
    tree = await mountRoute();
    expect(renderedText(tree.root)).toContain("Brand not found");
    TestRenderer.act(() => tree?.unmount());

    brandQuerySeed = {
      ...brandQuerySeed,
      data: {
        id: BRAND_ID,
        displayName: "Adversarial Brand",
        countryCode: "US",
        paymentProvider: "stripe",
      },
    };
    userSeed = null;
    tree = await mountRoute();
    expect(renderedText(tree.root)).toContain("Sign in to add your bank");
    expect(renderedText(tree.root)).toContain("Bank setup is private");
    expect(renderedText(tree.root)).toContain("team. Sign in");
  });

  test("the legal link is accessible and the primary CTA has an explicit label", async () => {
    tree = await mountRoute();
    expect(
      tree.root.findByProps({
        accessibilityLabel: "Open Mingla Host Terms",
      }).props.accessibilityRole,
    ).toBe("link");
    expect(
      tree.root.findByProps({
        accessibilityLabel:
          "Add bank details and continue to secure Stripe setup",
        accessibilityRole: "button",
        testID: "bank-connect-primary",
      }),
    ).toBeTruthy();
  });
});

describe("#948 W2 tester — native W4 boundary remains intact", () => {
  const nativeRouteSource = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "app",
      "brand",
      "[id]",
      "connect.tsx",
    ),
    "utf8",
  );
  const existingOnboardSource = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "components",
      "brand",
      "BrandOnboardView.tsx",
    ),
    "utf8",
  );

  test("native route safely redirects to the legacy onboard owner until Wave 4", async () => {
    const NativeBankConnectAlias =
      require("../../../app/brand/[id]/connect.tsx").default as
        React.ComponentType;

    params = { id: "brand/with hostile path bytes" };
    let nativeTree: TestTree;
    await TestRenderer.act(async () => {
      nativeTree = TestRenderer.create(
        React.createElement(NativeBankConnectAlias),
      );
    });
    expect(
      nativeTree!.root.findByProps({
        href:
          "/brand/brand%2Fwith%20hostile%20path%20bytes/payments/onboard",
      }),
    ).toBeTruthy();
    await TestRenderer.act(async () => {
      nativeTree!.unmount();
    });

    params = {};
    await TestRenderer.act(async () => {
      nativeTree = TestRenderer.create(
        React.createElement(NativeBankConnectAlias),
      );
    });
    expect(
      nativeTree!.root.findByProps({ href: "/(tabs)/account" }),
    ).toBeTruthy();
    await TestRenderer.act(async () => {
      nativeTree!.unmount();
    });

    expect(nativeRouteSource).toContain("Redirect");
    expect(nativeRouteSource).not.toContain(
      'export { default } from "./payments/onboard";',
    );
    expect(nativeRouteSource).not.toContain("startStripeWebBankConnect");
  });

  test("native keeps auth-session/deep-link while web owns same-tab assignment", () => {
    expect(existingOnboardSource).toContain('Platform.OS === "web"');
    expect(existingOnboardSource).toContain(
      "window.location.assign(result.onboarding_url)",
    );
    expect(existingOnboardSource).toMatch(
      /WebBrowser\.openAuthSessionAsync\(\s*result\.onboarding_url,\s*RETURN_DEEP_LINK,\s*\)/,
    );
    expect(existingOnboardSource).toContain(
      'const RETURN_DEEP_LINK = "mingla-business://onboarding-complete"',
    );
  });
});
