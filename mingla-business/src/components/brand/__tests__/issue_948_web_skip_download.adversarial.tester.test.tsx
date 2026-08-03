/**
 * #948 W4 [web-skip-download] — TESTER ADVERSARIAL render-proof (ORCH-1401).
 *
 * A DIFFERENT ANGLE than the implementor's happy-path render suite
 * (issue_948_web_skip_download.render.tester.test.tsx), which only ever seeds a
 * Stripe brand and only exercises the substring rejections `dashboard`/`invitee`.
 * This suite attacks four blind spots the implementor never touched:
 *
 *   A. PAYSTACK invite path — the Skip affordance sits AFTER the provider branch,
 *      so it must render for a Nigeria/Paystack brand too (not only Stripe). If a
 *      future edit tucks the Skip block inside the Stripe-only branch, the
 *      Paystack partner silently loses the escape. Implementor never rendered
 *      the Paystack branch at all.
 *
 *   B. EXACT-MATCH reader hardening (the airtight no-regression). The spec makes
 *      the exact-match load-bearing. This pins that `INVITE` (case), `invite `
 *      and ` invite` (whitespace), and `invite,dashboard` (CSV single string)
 *      are ALL treated as NON-invite → Back present, no Skip. A "helpful" future
 *      `.toLowerCase()`/`.trim()`/`.includes()` on the reader flips these.
 *
 *   C. ARRAY first-value semantics — `["invite"]` is invite; `["INVITE"]` and
 *      `["dashboard","invite"]` (first element wins, exact) are NOT.
 *
 *   D. PRE-CONTENT states are SIGNAL-IMMUNE — with `?from=invite` present, the
 *      loading / brand-error / brand-not-found / signed-out states render NO Skip
 *      affordance and NO populated top-bar Back (`bank-connect-back`). The signal
 *      must not leak the Skip UI into a non-populated screen.
 *
 * FAILS ON REVERT (cited in the QA report): loosening `isInviteFunnelValue` to a
 * case-insensitive compare makes case B's `INVITE` assertion
 * (`count("bank-connect-skip-link") === 0`, `count("bank-connect-back") === 1`)
 * go red, while the implementor's suite stays green — proving the added angle.
 */

/* eslint-disable @typescript-eslint/no-require-imports, import/first */

import React from "react";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const BRAND_ID = "9c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const USER_ID = "11112222-3333-4444-5555-666677778888";
const ORIGIN = "https://business.usemingla.com";

interface BrandSeed {
  id: string;
  displayName: string;
  countryCode: string | null;
  paymentProvider: string | null;
}

// Mutable harness state — read live by the mocks below so a single suite can
// drive both entry modes, both providers, and every pre-content state.
let params: { id?: string | string[]; provider?: string; from?: string | string[] };
let brandQueryState: {
  data: BrandSeed | null;
  isError: boolean;
  isFetched: boolean;
  isLoading: boolean;
};
let authUser: { id: string } | null;

const router = {
  back: jest.fn(),
  canGoBack: jest.fn(() => false),
  replace: jest.fn(),
};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => params,
  useRouter: () => router,
}));

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: authUser }),
}));

jest.mock("../../../hooks/useBrands", () => ({
  useBrand: () => ({
    data: brandQueryState.data,
    isError: brandQueryState.isError,
    isFetched: brandQueryState.isFetched,
    isLoading: brandQueryState.isLoading,
    refetch: jest.fn(),
  }),
}));

jest.mock("../../../hooks/useMinglaToSAcceptance", () => ({
  CURRENT_MINGLA_TOS_VERSION: "v3-pre-launch-placeholder",
  useAcceptMinglaToS: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

jest.mock("../../../services/brandStripeService", () => ({
  startBrandStripeOnboarding: jest.fn(),
}));

jest.mock("../../../utils/bankConnectFunnel", () => ({
  startStripeWebBankConnect: jest.fn(),
}));

jest.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

// Stub the Supabase service boundary. The component reaches it transitively via
// useBrandStripeStatus → services/supabase, whose top-level createClient()
// instantiates a RealtimeClient that THROWS on CI Node 20 (no native WebSocket).
// The component only consumes the pure `brandStripeStatusKeys` factory, never the
// client, so a bare named stub is sufficient. Infra-only; no assertion changes.
jest.mock("../../../services/supabase", () => ({
  supabase: {
    from: jest.fn(),
    channel: jest.fn(() => ({ on: jest.fn().mockReturnThis(), subscribe: jest.fn() })),
    removeChannel: jest.fn(),
    functions: { invoke: jest.fn(async () => ({ data: null, error: null })) },
    auth: {},
  },
}));

// Spy the external opener; keep the URL builder REAL so any Download assertion
// binds to the shipped OneLink, not a re-derived literal.
jest.mock("../../../services/guestFunnelLink", () => {
  const actual = jest.requireActual("../../../services/guestFunnelLink");
  return { __esModule: true, ...actual, openExternal: jest.fn() };
});

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

jest.mock("../BrandStripeCountryPicker", () => {
  const { View } = require("react-native");
  return { BrandStripeCountryPicker: () => <View testID="country-picker" /> };
});

// The REAL Paystack view is heavy; a marker proves the PROVIDER BRANCH rendered
// (i.e. selectedProvider resolved to "paystack"), which is the point of angle A.
jest.mock("../BrandPaystackOnboardView", () => {
  const { View } = require("react-native");
  return { BrandPaystackOnboardView: () => <View testID="paystack-view" /> };
});

import BrandBankConnectBody from "../BrandBankConnectBody.web";

interface TestInstance {
  type: unknown;
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
      await Promise.resolve();
    }
  });
}

async function mountBody(): Promise<TestTree> {
  let tree: TestTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<BrandBankConnectBody />);
  });
  await flush();
  if (tree === null) throw new Error("Bank-connect body did not mount.");
  return tree;
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

async function pressOnly(
  tree: TestTree,
  matcher: Record<string, unknown>,
): Promise<void> {
  const hosts = hostsMatching(tree, matcher);
  if (hosts.length !== 1) {
    throw new Error(
      `expected exactly 1 host for ${JSON.stringify(matcher)}, got ${hosts.length}`,
    );
  }
  await TestRenderer.act(async () => {
    await (hosts[0].props.onPress as () => void | Promise<void>)();
  });
}

function seedStripeBrand(): BrandSeed {
  return {
    id: BRAND_ID,
    displayName: "Adversarial Stripe Brand",
    countryCode: "US",
    paymentProvider: "stripe",
  };
}

function seedPaystackBrand(): BrandSeed {
  return {
    id: BRAND_ID,
    displayName: "Adversarial Naija Brand",
    // orch-strict-grep-allow stripe-country-out-of-scope — Nigeria uses Paystack.
    countryCode: "NG",
    paymentProvider: "paystack",
  };
}

beforeEach(() => {
  params = { id: BRAND_ID, from: "invite" };
  brandQueryState = {
    data: seedStripeBrand(),
    isError: false,
    isFetched: true,
    isLoading: false,
  };
  authUser = { id: USER_ID };
  router.back.mockClear();
  router.replace.mockClear();
  router.canGoBack.mockReturnValue(false);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { assign: jest.fn(), origin: ORIGIN } },
    writable: true,
  });
});

describe("#948 W4 ADVERSARIAL — Paystack Skip, exact-match hardening, signal-immune states", () => {
  let tree: TestTree | null = null;
  afterEach(() => {
    if (tree !== null) {
      TestRenderer.act(() => tree?.unmount());
      tree = null;
    }
  });

  // ─── Angle A — the PAYSTACK invite path ALSO shows Skip ────────────────────
  test("A: Paystack (NG) invite entry hides Back, hides the Stripe primary, and STILL offers Skip → {Download app | Continue on web}", async () => {
    brandQueryState.data = seedPaystackBrand();
    params = { id: BRAND_ID, from: "invite" };
    tree = await mountBody();

    // Provider branch resolved to Paystack — the Stripe primary is not rendered.
    expect(count(tree, "paystack-view")).toBe(1);
    expect(count(tree, "bank-connect-primary")).toBe(0);

    // Invite phase still governs: Back hidden, Skip link present.
    expect(count(tree, "bank-connect-back")).toBe(0);
    expect(count(tree, "bank-connect-skip-link")).toBe(1);

    // The escape works on the Paystack path too.
    await pressOnly(tree, { testID: "bank-connect-skip-link" });
    expect(count(tree, "bank-connect-skip-choices")).toBe(1);
    expect(count(tree, "bank-connect-skip-download")).toBe(1);
    expect(count(tree, "bank-connect-skip-continue-web")).toBe(1);

    // Continue on web → top-level web-app home (`/(tabs)/home`) on the Paystack
    // path too. ORCH-1401 [continue-web-home].
    await pressOnly(tree, { testID: "bank-connect-skip-continue-web" });
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/(tabs)/home");
  });

  // ─── Angle B — exact-match reader hardening (THE fails-on-revert anchor) ────
  test.each([
    ["INVITE (uppercase)", "INVITE"],
    ["Invite (mixed case)", "Invite"],
    ["trailing space", "invite "],
    ["leading space", " invite"],
    ["CSV single string", "invite,dashboard"],
    ["invitee substring", "invitee"],
    ["empty string", ""],
  ])(
    "B: from=%s is NON-invite → Back present, no Skip (exact-match, not loose)",
    async (_label, fromValue) => {
      params = { id: BRAND_ID, from: fromValue };
      tree = await mountBody();

      // These two assertions flip red if the reader is loosened to
      // lowercase/trim/substring — the airtight no-regression guard.
      expect(count(tree, "bank-connect-skip-link")).toBe(0);
      expect(count(tree, "bank-connect-back")).toBe(1);
      expect(count(tree, "bank-connect-skip-choices")).toBe(0);
      expect(count(tree, "bank-connect-skip-download")).toBe(0);
    },
  );

  test("B-positive: exact `invite` still triggers the funnel (guards against over-tightening)", async () => {
    params = { id: BRAND_ID, from: "invite" };
    tree = await mountBody();
    expect(count(tree, "bank-connect-back")).toBe(0);
    expect(count(tree, "bank-connect-skip-link")).toBe(1);
  });

  // ─── Angle C — array first-value semantics ─────────────────────────────────
  test("C1: from=['invite'] (repeated-param array, first exact) → invite phase", async () => {
    params = { id: BRAND_ID, from: ["invite"] };
    tree = await mountBody();
    expect(count(tree, "bank-connect-back")).toBe(0);
    expect(count(tree, "bank-connect-skip-link")).toBe(1);
  });

  test("C2: from=['INVITE'] and from=['dashboard','invite'] → NON-invite (Back present, no Skip)", async () => {
    for (const from of [["INVITE"], ["dashboard", "invite"]] as string[][]) {
      params = { id: BRAND_ID, from };
      tree = await mountBody();
      expect(count(tree, "bank-connect-back")).toBe(1);
      expect(count(tree, "bank-connect-skip-link")).toBe(0);
      TestRenderer.act(() => tree?.unmount());
      tree = null;
    }
  });

  // ─── Angle D — pre-content states are SIGNAL-IMMUNE (from=invite present) ───
  test("D: loading / brand-error / brand-not-found / signed-out states render NO Skip and NO populated Back, even with from=invite", async () => {
    const states: Array<() => void> = [
      // loading
      () => {
        brandQueryState = {
          data: null,
          isError: false,
          isFetched: false,
          isLoading: true,
        };
        authUser = { id: USER_ID };
      },
      // brand query error
      () => {
        brandQueryState = {
          data: null,
          isError: true,
          isFetched: true,
          isLoading: false,
        };
        authUser = { id: USER_ID };
      },
      // brand not found (fetched, null data)
      () => {
        brandQueryState = {
          data: null,
          isError: false,
          isFetched: true,
          isLoading: false,
        };
        authUser = { id: USER_ID };
      },
      // signed out (brand present, no user)
      () => {
        brandQueryState = {
          data: seedStripeBrand(),
          isError: false,
          isFetched: true,
          isLoading: false,
        };
        authUser = null;
      },
    ];

    for (const applyState of states) {
      params = { id: BRAND_ID, from: "invite" };
      applyState();
      tree = await mountBody();

      // The invite signal must not leak the Skip UI into a non-populated screen…
      expect(count(tree, "bank-connect-skip-link")).toBe(0);
      expect(count(tree, "bank-connect-skip-choices")).toBe(0);
      expect(count(tree, "bank-connect-skip-download")).toBe(0);
      // …and the populated top-bar Back (the only one carrying this testID) is
      // absent because the populated screen never rendered.
      expect(count(tree, "bank-connect-back")).toBe(0);

      TestRenderer.act(() => tree?.unmount());
      tree = null;
    }
  });
});
