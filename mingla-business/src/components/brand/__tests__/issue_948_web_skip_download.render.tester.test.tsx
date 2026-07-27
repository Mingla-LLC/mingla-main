/**
 * #948 W4 [web-skip-download] — route-render proof for the invite bank screen
 * (SPEC §9). Mounts the PRODUCTION BrandBankConnectBody.web and drives it as the
 * two entry modes:
 *   - invite funnel (`?from=invite`): top Back HIDDEN, "Skip for now" present,
 *     the two choices hidden until pressed, then {Download app | Continue on web};
 *   - dashboard/direct/bookmark (absent or non-`invite`): top Back PRESENT,
 *     no Skip — the make-or-break no-regression.
 *
 * Child primitives are reduced to inert host elements so the suite runs under the
 * required stock node/ts-jest Business gate (react-test-renderer installed
 * --no-save), exactly like issue_948_w2_bank_route_route.implementor.test.tsx.
 * The REAL BusinessAppDownloadCta is rendered (not mocked) and `openExternal` is
 * spied, so T-b proves the Download choice fires the ONE attribution-safe OneLink.
 *
 * FAILS ON REVERT:
 *   - T-a: restoring an unconditional Back / removing the Skip block makes
 *     `bank-connect-back` present and the skip controls absent.
 *   - T-b: removing the Download choice → openExternal never fires.
 *   - T-c: an unconditional Back-hide (dropping the `isInviteFunnel` gate) makes
 *     the dashboard-entry Back disappear.
 */

/* eslint-disable @typescript-eslint/no-require-imports, import/first */

import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

const BRAND_ID = "2b7c8f6a-1111-4a22-8333-123456789abc";
const USER_ID = "79f45786-2222-4b33-8444-123456789abc";
const ORIGIN = "https://business.usemingla.com";
const BUSINESS_INVITE_CTA_URL =
  "https://biz.usemingla.com/ZSCW?pid=business_web&c=brand_invite_accept";

interface BrandSeed {
  id: string;
  displayName: string;
  countryCode: string | null;
  paymentProvider: string | null;
}

let brandSeed: BrandSeed;
let params: { id: string; provider?: string; from?: string };

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
  useAuth: () => ({ user: { id: USER_ID } }),
}));

jest.mock("../../../hooks/useBrands", () => ({
  useBrand: () => ({
    data: brandSeed,
    isError: false,
    isFetched: true,
    isLoading: false,
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
// client, so a bare named stub is sufficient and keeps the real client from ever
// booting. Established pattern (e.g. useBusinessNotificationsInbox.test.ts).
jest.mock("../../../services/supabase", () => ({
  supabase: {
    from: jest.fn(),
    channel: jest.fn(() => ({ on: jest.fn().mockReturnThis(), subscribe: jest.fn() })),
    removeChannel: jest.fn(),
    functions: { invoke: jest.fn(async () => ({ data: null, error: null })) },
    auth: {},
  },
}));

// The Download choice's opener is spied; the URL BUILDER stays REAL so T-b binds
// the screen to the exact shipped OneLink, never a re-derived literal.
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
  return {
    BrandStripeCountryPicker: () => <View testID="country-picker" />,
  };
});

jest.mock("../BrandPaystackOnboardView", () => {
  const { View } = require("react-native");
  return {
    BrandPaystackOnboardView: () => <View testID="paystack-view" />,
  };
});

import BrandBankConnectBody from "../BrandBankConnectBody.web";
import {
  buildBusinessInviteDownloadUrl,
  openExternal,
} from "../../../services/guestFunnelLink";

const mockedOpenExternal = openExternal as jest.Mock;

interface TestInstance {
  type: unknown;
  children: (TestInstance | string)[];
  props: Record<string, unknown>;
  findByProps: (props: Record<string, unknown>) => TestInstance;
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

// findAllByProps surfaces BOTH the composite instances and the host element for a
// single logical node (e.g. Button → Pressable → host:Pressable = 3). Filter to
// host instances (`typeof type === "string"`) so a match is counted exactly once.
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

describe("#948 W4 render — invite bank screen Skip + Back-hide", () => {
  let tree: TestTree | null = null;

  beforeEach(() => {
    params = { id: BRAND_ID, from: "invite" };
    brandSeed = {
      id: BRAND_ID,
      displayName: "Skip Proof Brand",
      countryCode: "US",
      paymentProvider: "stripe",
    };
    router.back.mockClear();
    router.replace.mockClear();
    router.canGoBack.mockReturnValue(false);
    mockedOpenExternal.mockClear();
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
  });

  // ─── T-a — happy path (fails on revert) ───────────────────────────────────
  test("T-a: invite phase hides Back, reveals the two choices only after Skip, and Continue-on-web routes to /brand/[id]", async () => {
    tree = await mountBody();

    // Back hidden; the primary CTA and Skip link are present.
    expect(count(tree, "bank-connect-back")).toBe(0);
    expect(count(tree, "bank-connect-primary")).toBe(1);
    expect(count(tree, "bank-connect-skip-link")).toBe(1);

    // Choices are hidden until Skip is pressed.
    expect(count(tree, "bank-connect-skip-choices")).toBe(0);
    expect(count(tree, "bank-connect-skip-download")).toBe(0);
    expect(count(tree, "bank-connect-skip-continue-web")).toBe(0);

    await pressOnly(tree, { testID: "bank-connect-skip-link" });

    // Both choices now render.
    expect(count(tree, "bank-connect-skip-choices")).toBe(1);
    expect(count(tree, "bank-connect-skip-download")).toBe(1);
    expect(count(tree, "bank-connect-skip-continue-web")).toBe(1);

    // Continue on web → brand dashboard home, via replace (not push).
    await pressOnly(tree, { testID: "bank-connect-skip-continue-web" });
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith(`/brand/${BRAND_ID}`);
  });

  // ─── T-b — Download choice fires the ONE attribution-safe OneLink ──────────
  test("T-b: Download choice opens exactly the single business OneLink, and the screen has NO store branching", async () => {
    tree = await mountBody();
    await pressOnly(tree, { testID: "bank-connect-skip-link" });

    // The reused CTA renders and, when fired, opens exactly the one OneLink.
    expect(count(tree, "bank-connect-skip-download")).toBe(1);
    await pressOnly(tree, {
      accessibilityLabel: "Download the Mingla Business app",
    });
    expect(mockedOpenExternal).toHaveBeenCalledTimes(1);
    expect(mockedOpenExternal).toHaveBeenCalledWith(BUSINESS_INVITE_CTA_URL);
    // The URL is the SHIPPED builder's output, not a re-derived literal.
    expect(buildBusinessInviteDownloadUrl()).toBe(BUSINESS_INVITE_CTA_URL);

    // The connect screen's OWN source must carry no store-URL / Platform.OS
    // branching — the OneLink's 301 is the only device-awareness (attribution).
    const raw = readFileSync(
      join(__dirname, "..", "BrandBankConnectBody.web.tsx"),
      "utf8",
    );
    const noComments = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(noComments).not.toContain("APP_STORE_URL");
    expect(noComments).not.toContain("PLAY_STORE_URL");
    expect(noComments).not.toContain("apps.apple.com");
    expect(noComments).not.toContain("play.google.com");
    expect(noComments).not.toContain("Platform.OS ===");
    expect(noComments).not.toContain("Platform.OS !==");
  });

  // ─── T-c — no-regression on the non-invite entry (KEY, exact-match) ────────
  test("T-c: absent / `dashboard` / `invitee` all keep Back present and render NO Skip", async () => {
    for (const from of [undefined, "dashboard", "invitee"] as const) {
      params = { id: BRAND_ID, ...(from === undefined ? {} : { from }) };
      tree = await mountBody();

      expect(count(tree, "bank-connect-back")).toBe(1);
      expect(count(tree, "bank-connect-skip-link")).toBe(0);
      expect(count(tree, "bank-connect-skip-choices")).toBe(0);
      expect(count(tree, "bank-connect-skip-download")).toBe(0);

      TestRenderer.act(() => tree?.unmount());
      tree = null;
    }
  });
});
