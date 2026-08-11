/**
 * #1863 [error-toast-covers-bank-field] — the implementor's happy-path proof.
 *
 * A REAL @testing-library/react-native mount of the three production ROUTE
 * components that own the brand payments surface:
 *
 *   app/brand/[id]/payments/index.tsx      → BrandPaymentsView
 *   app/brand/[id]/payments/onboard.tsx    → BrandOnboardView
 *   app/brand/[id]/payments/reports.tsx    → BrandFinanceReportsView
 *
 * MOUNTING THE ROUTES, NOT THE VIEWS, IS THE POINT. The gate lives at the route
 * because both views return early for the Paystack rail before any Stripe state
 * is consulted; a view-only mount would go green with all three routes
 * unwrapped, which is exactly the shipped defect.
 *
 * What is REAL here: BrandPaymentsPermissionGate, canManageBrandPayments,
 * useCanManageBrandPayments, both views, BrandPaystackOnboardView,
 * useBrandStripeStatus, useBrandStripeBalances, brandStripeService,
 * brandStripeBalancesService, edgeFunctionErrors, brandStripeUiState, and
 * @tanstack/react-query itself. Only the BOUNDARY is mocked: expo-router, the
 * supabase client, useCurrentBrandRole (the role source), useBrand (the brand
 * source), and native modules with no jest bindings.
 *
 * The invocation assertions count REAL `supabase.functions.invoke` calls made
 * by REAL queryFns through a REAL QueryClient — not calls to a mocked hook.
 *
 * ANTI-VACUITY (§9.1), enforced in this file:
 *   1. every control matcher used to assert ABSENCE for a denied role is
 *      asserted PRESENT for an allowed role in the same file (test 1), so a
 *      typo'd or stale matcher fails the allowed leg instead of silently
 *      passing the denied leg;
 *   2. every iterated list carries a literal non-emptiness floor, so deleting
 *      entries fails before a loop can run zero times and report green;
 *   3. no `it.skip` / `describe.skip` / `xit` / `test.todo` anywhere — the
 *      class-A gate greps this file for them (#1627 shipped a SKIP that
 *      reported a tick);
 *   4. both rails (Stripe and Paystack) and all three routes are covered, not
 *      one convenient path (#1834 went green on web while iOS shipped broken).
 *
 * THE VACUITY TRAP THIS SUITE DELIBERATELY AVOIDS. With the route gate in
 * place a denied role never mounts BrandOnboardView, so "proving" the
 * `permission-denied` ViewState by rendering a denied role would assert
 * nothing and pass forever. Test 7 therefore constructs the only state in
 * which that ViewState is genuinely reachable: client gate ALLOW (brand_owner)
 * and server 403 — the 30-second role-cache staleness window after a demotion.
 *
 * Run: npx jest --config jest.issue1863.render.cjs --runInBand
 */

import React from "react";

// ── module mocks (BOUNDARY ONLY) ────────────────────────────────────────────

jest.mock("react-native-keyboard-controller", () => {
  const RN = require("react-native");
  const ReactLocal = require("react");
  const KeyboardAwareScrollView = ReactLocal.forwardRef(
    function KeyboardAwareScrollView(
      props: { children?: React.ReactNode },
      ref: unknown,
    ) {
      return ReactLocal.createElement(RN.View, { ...props, ref }, props.children);
    },
  );
  return {
    KeyboardAwareScrollView,
    KeyboardAvoidingView: RN.View,
    KeyboardProvider: RN.View,
    KeyboardToolbar: RN.View,
    KeyboardStickyView: RN.View,
    useKeyboardState: () => ({ isVisible: false, height: 0 }),
    KeyboardController: { dismiss: jest.fn() },
  };
});

jest.mock("expo-blur", () => {
  const { View: V } = require("react-native");
  return { BlurView: V };
});

jest.mock("react-native-reanimated", () => {
  const { View: V } = require("react-native");
  const passthrough = (c: unknown) => c;
  return {
    __esModule: true,
    default: { View: V, createAnimatedComponent: passthrough },
    View: V,
    createAnimatedComponent: passthrough,
    useSharedValue: (v: unknown) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withTiming: (v: unknown) => v,
    withSpring: (v: unknown) => v,
    useReducedMotion: () => true,
    Easing: { bezier: () => (t: number) => t, out: (f: unknown) => f },
  };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => children,
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
  usePathname: () => "/",
  useLocalSearchParams: () => ({ id: "brand-1863" }),
  Redirect: () => null,
}));

jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: jest.fn(),
  openBrowserAsync: jest.fn(),
}));

jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  NotificationFeedbackType: { Success: "s", Warning: "w", Error: "e" },
  ImpactFeedbackStyle: { Light: "l", Medium: "m", Heavy: "h" },
}));

jest.mock("../../ui/Icon", () => {
  const { View: V } = require("react-native");
  return { Icon: ({ name }: { name: string }) => <V testID={`icon-${name}`} /> };
});

// ui/Spinner drives react-native-reanimated's Easing/withRepeat and
// react-native-svg, neither of which has jest bindings under the RN preset. It
// is a chrome primitive with no bearing on the gate decision; the "Checking
// your access…" TEXT beside it is real and is what test 9 reads.
jest.mock("../../ui/Spinner", () => {
  const { View: V } = require("react-native");
  return { Spinner: () => <V testID="spinner" /> };
});

jest.mock("../../ui/Sheet", () => {
  const { View: V } = require("react-native");
  return {
    Sheet: (p: { children?: React.ReactNode }) => <V>{p.children}</V>,
    default: V,
  };
});

// TopBar reaches the supabase client through useCurrentBrand → useBrands, which
// constructs AsyncStorage + expo-constants at import time. It is fixed chrome;
// the title is all this suite reads from it.
jest.mock("../../ui/TopBar", () => {
  const { Text: T } = require("react-native");
  return { TopBar: ({ title }: { title?: string }) => <T>{title}</T> };
});

jest.mock("../../ui/Toast", () => {
  const { View: V } = require("react-native");
  return { Toast: () => <V testID="toast" /> };
});

// ── the supabase client: the ONLY thing that counts edge invocations ─────────

const mockInvoke = jest.fn();

jest.mock("../../../services/supabase", () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
    },
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    channel: jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn(),
    })),
    removeChannel: jest.fn(),
  },
}));

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({
    isAuthReady: true,
    loading: false,
    user: { id: "user-1863", email: "member@example.com" },
    session: { access_token: "token" },
  }),
}));

// ── the role source (the per-case input) ────────────────────────────────────

interface RoleState {
  role: string | null;
  accepted: boolean;
  isLoading: boolean;
  isError: boolean;
}

const mockRoleState: { current: RoleState } = {
  current: { role: "brand_owner", accepted: true, isLoading: false, isError: false },
};

jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({
    ...mockRoleState.current,
    rank: 0,
    permissionsOverride: {},
    refetch: jest.fn(async () => undefined),
  }),
  brandRoleKeys: {
    all: ["brand-role"],
    byBrand: (b: string, u: string) => ["brand-role", b, u],
    allForBrand: (b: string) => ["brand-role", b],
  },
}));

// ── the brand source ────────────────────────────────────────────────────────

const mockBrandState: { current: Record<string, unknown> | null } = {
  current: null,
};

jest.mock("../../../hooks/useBrands", () => ({
  useBrand: () => ({
    data: mockBrandState.current,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  brandKeys: {
    all: ["brands"],
    lists: () => ["brands", "list"],
    detail: (id: string) => ["brands", "detail", id],
  },
}));

jest.mock("../../../store/currentBrandStore", () => ({
  useBrandList: () => (mockBrandState.current === null ? [] : [mockBrandState.current]),
}));

// ── sheet/ledger siblings with no bearing on the gate decision ──────────────

const mockIdleMutation = {
  mutate: jest.fn(),
  mutateAsync: jest.fn(),
  isPending: false,
  isSuccess: false,
  isError: false,
  reset: jest.fn(),
};

jest.mock("../../../hooks/useStartBrandStripeOnboarding", () => ({
  useStartBrandStripeOnboarding: () => mockIdleMutation,
}));
jest.mock("../../../hooks/useBrandStripeTaxAccountSession", () => ({
  useBrandStripeTaxAccountSession: () => mockIdleMutation,
}));
jest.mock("../../../hooks/useBrandStripeAccountSession", () => ({
  useBrandStripeAccountSession: () => mockIdleMutation,
}));

jest.mock("../../../hooks/useBrandPaystack", () => {
  const idle = {
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    reset: jest.fn(),
  };
  return {
    useBrandBanks: () => ({
      data: [{ name: "GTBank", code: "058" }],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    }),
    useBrandPaystackStatus: () => ({
      data: { connected: false },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    }),
    useResolvePaystackAccount: () => idle,
    useCreatePaystackSubaccount: () => idle,
    useUpdatePaystackSubaccount: () => idle,
    useCreatePaystackRecipient: () => idle,
    useUpdatePaystackRecipient: () => idle,
    useDisconnectPaystack: () => idle,
    useClearPaystackProvider: () => idle,
  };
});

jest.mock("../BrandStripeCountryPicker", () => {
  const { View: V } = require("react-native");
  return { BrandStripeCountryPicker: () => <V testID="country-picker" /> };
});
jest.mock("../../onboarding/MinglaToSAcceptanceGate", () => {
  const { View: V } = require("react-native");
  return { MinglaToSAcceptanceGate: () => <V testID="tos-gate" /> };
});
jest.mock("../BrandStripeDetachConfirmSheet", () => {
  const { View: V } = require("react-native");
  return { BrandStripeDetachConfirmSheet: () => <V testID="detach-sheet" /> };
});
jest.mock("../BrandStripeBankSection", () => {
  const { View: V } = require("react-native");
  return { BrandStripeBankSection: () => <V testID="bank-section" /> };
});
jest.mock("../BrandStripeKycRemediationCard", () => {
  const { View: V } = require("react-native");
  return { BrandStripeKycRemediationCard: () => <V testID="kyc-card" /> };
});
jest.mock("../BrandStripeOrphanedRefundsSection", () => {
  const { View: V } = require("react-native");
  return { BrandStripeOrphanedRefundsSection: () => <V testID="orphaned-refunds" /> };
});
jest.mock("../BrandStripeDeadlineBanner", () => {
  const { View: V } = require("react-native");
  return { BrandStripeDeadlineBanner: () => <V testID="deadline-banner" /> };
});
jest.mock("../BrandPayoutBreakdown", () => {
  const { View: V } = require("react-native");
  return { BrandPayoutBreakdown: () => <V testID="payout-breakdown" /> };
});
jest.mock("../BrandPayoutTimelineExplainer", () => {
  const { View: V } = require("react-native");
  return { BrandPayoutTimelineExplainer: () => <V testID="payout-explainer" /> };
});

// ── imports (after the mocks) ───────────────────────────────────────────────

import { render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import BrandPaymentsRoute from "../../../../app/brand/[id]/payments/index";
import BrandOnboardRoute from "../../../../app/brand/[id]/payments/onboard";
import BrandFinanceReportsRoute from "../../../../app/brand/[id]/payments/reports";
// The SHIPPED copy constants, imported — never re-typed here, so a wording
// change moves this suite with it instead of leaving it asserting a dead string.
import {
  BRAND_PAYMENTS_DENIED_BODY,
  BRAND_PAYMENTS_DENIED_TITLE,
} from "../../../utils/brandPaymentsPermission";

/**
 * DERIVED from the real `render`, never imported by name: v13 of
 * @testing-library/react-native exports a `RenderAPI` type and v14 does not,
 * and CI resolves whichever version npm's peer resolution picks. A typed-out
 * name would compile locally and fail there — the exact portability defect that
 * made #1834 pass locally and go red on CI.
 */
type Mounted = Awaited<ReturnType<typeof render>>;

const BRAND_ID = "brand-1863";
const NG_ACCOUNT_FIELD_LABEL = "Bank account number";

// ── fixtures ────────────────────────────────────────────────────────────────

const stripeActiveBrand: Record<string, unknown> = {
  id: BRAND_ID,
  displayName: "Smoke & Rhythm",
  slug: "smoke-and-rhythm",
  address: null,
  coverHue: 25,
  role: "owner",
  stats: { events: 0, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
  currentLiveEvent: null,
  paymentProvider: "stripe",
  stripeStatus: "active",
  defaultCurrency: "USD",
  events: [],
};

const stripeNotConnectedBrand: Record<string, unknown> = {
  ...stripeActiveBrand,
  stripeStatus: "not_connected",
};

const paystackBrand: Record<string, unknown> = {
  ...stripeActiveBrand,
  displayName: "Lagos Nights",
  countryCode: "NG",
  paymentProvider: "paystack",
  paystackSubaccountCode: null,
  defaultCurrency: "NGN",
  stripeStatus: "not_connected",
};

const ACTIVE_STATUS_PAYLOAD = {
  status: "active",
  charges_enabled: true,
  payouts_enabled: true,
  requirements: {},
  detached_at: null,
};

const BALANCES_PAYLOAD = {
  currency: "USD",
  available_minor: 125000,
  pending_minor: 4200,
  retrieved_at: "2026-08-11T07:41:30.000Z",
};

/**
 * A genuine Supabase `FunctionsHttpError` shape: the status lives on `context`,
 * and the body is only readable through `context.clone()`. This is the object
 * `supabase.functions.invoke` actually hands back on a 403 — reproducing it
 * (rather than throwing a hand-built `Error`) is what makes the classification
 * assertions mean something.
 */
function functionsHttpError(status: number, payload: unknown): Error {
  const err = new Error("Edge Function returned a non-2xx status code");
  err.name = "FunctionsHttpError";
  (err as Error & { context: unknown }).context = {
    status,
    clone: () => ({
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    }),
  };
  return err;
}

function respondOk(): void {
  mockInvoke.mockImplementation(async (fnName: string) => {
    if (fnName === "brand-stripe-balances") {
      return { data: BALANCES_PAYLOAD, error: null };
    }
    return { data: ACTIVE_STATUS_PAYLOAD, error: null };
  });
}

function respondForbidden(): void {
  mockInvoke.mockImplementation(async () => ({
    data: null,
    error: functionsHttpError(403, {
      error: "forbidden",
      detail: "permission_denied",
    }),
  }));
}

// ── control matchers ────────────────────────────────────────────────────────

/**
 * Every payments control enumerated in the SPEC's §4.4 table that renders text.
 * Used to assert ABSENCE for a denied role. Test 1 proves each one is live in
 * at least one ALLOWED state, so a stale matcher cannot produce a green denied
 * leg — the single most important anti-vacuity rule here.
 */
const PAYMENT_CONTROL_MATCHERS: readonly RegExp[] = [
  /DANGER ZONE/,
  /Disconnect Stripe/,
  /Manage payouts & tax/,
  /Tax & registrations/,
  /Export finance report/,
  /^AVAILABLE$/,
  /^PENDING$/,
  /^LAST PAYOUT$/,
  /Connect your bank to get paid/,
  /^Connect bank$/,
];

/** Live when the brand's Stripe account is active. */
const LIVE_WHEN_ACTIVE: readonly RegExp[] = [
  /DANGER ZONE/,
  /Disconnect Stripe/,
  /Manage payouts & tax/,
  /Tax & registrations/,
  /Export finance report/,
  /^AVAILABLE$/,
  /^PENDING$/,
  /^LAST PAYOUT$/,
];

/** Live when the brand has not connected Stripe yet. */
const LIVE_WHEN_NOT_CONNECTED: readonly RegExp[] = [
  /Connect your bank to get paid/,
  /^Connect bank$/,
  /Export finance report/,
  /^AVAILABLE$/,
  /^PENDING$/,
  /^LAST PAYOUT$/,
];

/**
 * The §4.4 controls that render no text of their own — asserted by testID so the
 * eleven-item enumeration is COMPLETE rather than "the ones that happened to
 * have a string". `BrandStripeDetachConfirmSheet` is the load-bearing one: the
 * SPEC requires it to be NOT MOUNTED AT ALL, because an unmounted sheet cannot
 * be opened by a stale ref.
 */
const PAYMENT_CONTROL_TEST_IDS: readonly string[] = [
  "payout-breakdown",
  "detach-sheet",
  "bank-section",
  "kyc-card",
  "deadline-banner",
  "orphaned-refunds",
];

const DENIED_ROLES: readonly string[] = [
  "event_manager",
  "marketing_manager",
  "scanner",
];

const ALLOWED_ROLES: readonly string[] = [
  "brand_owner",
  "brand_admin",
  "finance_manager",
];

// ── harness ─────────────────────────────────────────────────────────────────

function present(tree: Mounted, matcher: RegExp): boolean {
  return tree.queryAllByText(matcher).length > 0;
}

let activeClients: QueryClient[] = [];

async function mount(Route: React.ComponentType): Promise<Mounted> {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchInterval: false },
      mutations: { retry: 0 },
    },
  });
  activeClients.push(client);
  // `await` on purpose: @testing-library/react-native v14's `render` is async
  // (its element tree comes from the new `test-renderer`), while v13's is
  // synchronous. Awaiting a non-promise is a no-op, so this suite runs on the
  // version CI resolves AND the one installed locally — the exact portability
  // defect that made #1834 pass locally and fail every assertion on CI.
  return await render(
    <QueryClientProvider client={client}>
      <Route />
    </QueryClientProvider>,
  );
}

/** Lets React Query's real effects settle so a zero-count is a real zero. */
async function settle(): Promise<void> {
  await waitFor(() => {
    expect(true).toBe(true);
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  mockInvoke.mockReset();
  respondOk();
  mockRoleState.current = {
    role: "brand_owner",
    accepted: true,
    isLoading: false,
    isError: false,
  };
  mockBrandState.current = stripeActiveBrand;
});

afterEach(() => {
  for (const c of activeClients) c.clear();
  activeClients = [];
});

// ── assertions ──────────────────────────────────────────────────────────────

describe("#1863 — the brand payments routes are gated on the server's role predicate", () => {
  it("0. the matcher and role tables are non-empty and cover the SPEC's enumeration", () => {
    // Anti-vacuity floor: deleting entries fails HERE, before any loop below
    // can run zero times and report a green tick.
    expect(PAYMENT_CONTROL_MATCHERS.length).toBeGreaterThanOrEqual(8);
    expect(PAYMENT_CONTROL_TEST_IDS.length).toBeGreaterThanOrEqual(6);
    expect(DENIED_ROLES).toHaveLength(3);
    expect(ALLOWED_ROLES).toHaveLength(3);
  });

  it("1. every absence matcher is proven LIVE in at least one allowed state", () => {
    // Rule 4 of §9.1: a matcher that matches nothing anywhere would make every
    // denied-leg absence assertion below unfalsifiable. Each one must be
    // claimed by a state that tests 2 and 3 actually render.
    const covered = new Set(
      [...LIVE_WHEN_ACTIVE, ...LIVE_WHEN_NOT_CONNECTED].map(String),
    );
    const orphans = PAYMENT_CONTROL_MATCHERS.filter(
      (m) => !covered.has(String(m)),
    ).map(String);
    expect(orphans).toEqual([]);
  });

  it("2. an ALLOWED role on an active brand sees every control, and the query fires", async () => {
    mockRoleState.current = {
      role: "brand_owner",
      accepted: true,
      isLoading: false,
      isError: false,
    };
    mockBrandState.current = stripeActiveBrand;
    const tree = await mount(BrandPaymentsRoute);

    await waitFor(() => {
      expect(
        mockInvoke.mock.calls.some((c) => c[0] === "brand-stripe-refresh-status"),
      ).toBe(true);
    });

    for (const matcher of LIVE_WHEN_ACTIVE) {
      await waitFor(() => {
        expect({ matcher: String(matcher), found: present(tree, matcher) })
          .toEqual({ matcher: String(matcher), found: true });
      });
    }
    expect(present(tree, new RegExp(BRAND_PAYMENTS_DENIED_TITLE))).toBe(false);
    // Rule 4 again, for the text-less controls: each testID asserted ABSENT for
    // a denied role must be PRESENT for an allowed one, or the absence proves
    // nothing. `bank-section` and `detach-sheet` are live on an active brand;
    // `kyc-card`/`deadline-banner`/`orphaned-refunds` are status-conditional and
    // are covered by the not-connected and stale-role legs.
    for (const id of ["payout-breakdown", "detach-sheet", "bank-section"]) {
      await waitFor(() => {
        expect({ id, found: tree.queryAllByTestId(id).length > 0 })
          .toEqual({ id, found: true });
      });
    }
  });

  it("3. an ALLOWED role on a not-connected brand sees the connect journey", async () => {
    mockBrandState.current = stripeNotConnectedBrand;
    mockInvoke.mockImplementation(async () => ({
      data: { ...ACTIVE_STATUS_PAYLOAD, status: "not_connected" },
      error: null,
    }));
    const tree = await mount(BrandPaymentsRoute);

    for (const matcher of LIVE_WHEN_NOT_CONNECTED) {
      await waitFor(() => {
        expect({ matcher: String(matcher), found: present(tree, matcher) })
          .toEqual({ matcher: String(matcher), found: true });
      });
    }
  });

  it.each(ALLOWED_ROLES)(
    "4. %s is allowed — the full surface renders (SC-3, the over-tight-gate guard)",
    async (role) => {
      mockRoleState.current = {
        role,
        accepted: true,
        isLoading: false,
        isError: false,
      };
      const tree = await mount(BrandPaymentsRoute);
      await waitFor(() => {
        expect(present(tree, /DANGER ZONE/)).toBe(true);
      });
      expect(present(tree, new RegExp(BRAND_PAYMENTS_DENIED_TITLE))).toBe(false);
    },
  );

  it.each(DENIED_ROLES)(
    "5. %s sees the explanation card, ZERO controls and fires ZERO requests",
    async (role) => {
      mockRoleState.current = {
        role,
        accepted: true,
        isLoading: false,
        isError: false,
      };
      const tree = await mount(BrandPaymentsRoute);

      await waitFor(() => {
        expect(tree.queryAllByText(BRAND_PAYMENTS_DENIED_TITLE).length)
          .toBeGreaterThan(0);
      });
      expect(tree.queryAllByText(BRAND_PAYMENTS_DENIED_BODY).length)
        .toBeGreaterThan(0);

      for (const matcher of PAYMENT_CONTROL_MATCHERS) {
        expect({ role, matcher: String(matcher), found: present(tree, matcher) })
          .toEqual({ role, matcher: String(matcher), found: false });
      }
      // The controls that render no text of their own, incl. the detach sheet,
      // which must not be MOUNTED at all.
      for (const id of PAYMENT_CONTROL_TEST_IDS) {
        expect({ role, id, found: tree.queryAllByTestId(id).length > 0 })
          .toEqual({ role, id, found: false });
      }

      // SC-2 — the whole point. Real queryFns through a real QueryClient; a
      // zero here is a zero because the hooks never became `enabled`.
      await settle();
      expect(mockInvoke).toHaveBeenCalledTimes(0);
    },
  );

  it("6. a PENDING brand_admin (accepted_at IS NULL) is denied — mirrors the server", async () => {
    mockRoleState.current = {
      role: "brand_admin",
      accepted: false,
      isLoading: false,
      isError: false,
    };
    const tree = await mount(BrandPaymentsRoute);
    await waitFor(() => {
      expect(tree.queryAllByText(BRAND_PAYMENTS_DENIED_TITLE).length)
        .toBeGreaterThan(0);
    });
    await settle();
    expect(mockInvoke).toHaveBeenCalledTimes(0);
  });

  it("7. THE STALE-ROLE RACE: client gate ALLOW + server 403 → permission-denied, not a network lie", async () => {
    // This is the ONLY state in which the `permission-denied` ViewState is
    // genuinely reachable once the route gate exists: `useCurrentBrandRole`
    // caches for 30s, so a member demoted mid-session passes the client gate
    // and receives a server 403 inside that window.
    //
    // Rendering a DENIED role here would prove nothing at all — the route gate
    // stops them before the view mounts, so the assertion would hold forever
    // regardless of whether the ViewState was ever wired. That is the specific
    // vacuity trap this issue's SPEC named in advance.
    mockRoleState.current = {
      role: "brand_owner",
      accepted: true,
      isLoading: false,
      isError: false,
    };
    respondForbidden();
    const tree = await mount(BrandOnboardRoute);

    await waitFor(() => {
      expect(tree.queryAllByText(BRAND_PAYMENTS_DENIED_BODY).length)
        .toBeGreaterThan(0);
    });
    // The lie that used to render instead: "Check your connection and try
    // again" on a caller whose connection was fine.
    expect(present(tree, /Check your connection/)).toBe(false);
    expect(present(tree, /Couldn’t reach Stripe|Couldn't reach Stripe/)).toBe(
      false,
    );
    // No escape back into the bank-connect journey — there is nothing to retry.
    expect(present(tree, /^Try again$/)).toBe(false);
  });

  it("8. THE STALE-ROLE RACE on the payments dashboard: no 'Couldn’t refresh' cards, no Danger Zone", async () => {
    mockRoleState.current = {
      role: "brand_owner",
      accepted: true,
      isLoading: false,
      isError: false,
    };
    respondForbidden();
    const tree = await mount(BrandPaymentsRoute);

    await waitFor(() => {
      expect(tree.queryAllByText(BRAND_PAYMENTS_DENIED_TITLE).length)
        .toBeGreaterThan(0);
    });
    expect(present(tree, /Couldn’t refresh Stripe status/)).toBe(false);
    expect(present(tree, /Couldn’t refresh Stripe balance/)).toBe(false);
    expect(present(tree, /DANGER ZONE/)).toBe(false);
  });

  it("9. while the role query is in flight only 'Checking your access…' renders", async () => {
    mockRoleState.current = {
      role: null,
      accepted: false,
      isLoading: true,
      isError: false,
    };
    const tree = await mount(BrandPaymentsRoute);
    await waitFor(() => {
      expect(present(tree, /Checking your access/)).toBe(true);
    });
    // Neither the surface nor the denial may flash.
    expect(present(tree, new RegExp(BRAND_PAYMENTS_DENIED_TITLE))).toBe(false);
    for (const matcher of PAYMENT_CONTROL_MATCHERS) {
      expect({ matcher: String(matcher), found: present(tree, matcher) })
        .toEqual({ matcher: String(matcher), found: false });
    }
    await settle();
    expect(mockInvoke).toHaveBeenCalledTimes(0);
  });

  it("10. when the role query ERRORS the user is told that, never that they lack permission", async () => {
    mockRoleState.current = {
      role: null,
      accepted: false,
      isLoading: false,
      isError: true,
    };
    const tree = await mount(BrandPaymentsRoute);
    await waitFor(() => {
      expect(present(tree, /Couldn’t check your access/)).toBe(true);
    });
    // Default-closed must not become dishonest: a network blip must never tell
    // a brand owner they lack permission.
    expect(present(tree, new RegExp(BRAND_PAYMENTS_DENIED_TITLE))).toBe(false);
    expect(present(tree, /^Try again$/)).toBe(true);
  });

  it("11. PAYSTACK rail — a denied role gets the card, NOT the Nigerian bank form", async () => {
    mockBrandState.current = paystackBrand;
    mockRoleState.current = {
      role: "event_manager",
      accepted: true,
      isLoading: false,
      isError: false,
    };
    const tree = await mount(BrandPaymentsRoute);
    await waitFor(() => {
      expect(tree.queryAllByText(BRAND_PAYMENTS_DENIED_TITLE).length)
        .toBeGreaterThan(0);
    });
    // Proves the gate sits ABOVE the `isPaystackBrand` early return.
    expect(tree.queryByLabelText(NG_ACCOUNT_FIELD_LABEL)).toBeNull();
    await settle();
    expect(mockInvoke).toHaveBeenCalledTimes(0);
  });

  it("12. PAYSTACK rail — an allowed role still gets the Nigerian bank form, unchanged", async () => {
    mockBrandState.current = paystackBrand;
    mockRoleState.current = {
      role: "brand_admin",
      accepted: true,
      isLoading: false,
      isError: false,
    };
    const tree = await mount(BrandPaymentsRoute);
    await waitFor(() => {
      expect(tree.queryByLabelText(NG_ACCOUNT_FIELD_LABEL)).not.toBeNull();
    });
    expect(present(tree, new RegExp(BRAND_PAYMENTS_DENIED_TITLE))).toBe(false);
  });

  it("13. the ONBOARD route is gated: denied → card, allowed → the real onboarding shell", async () => {
    mockBrandState.current = stripeNotConnectedBrand;
    mockRoleState.current = {
      role: "scanner",
      accepted: true,
      isLoading: false,
      isError: false,
    };
    const denied = await mount(BrandOnboardRoute);
    await waitFor(() => {
      expect(denied.queryAllByText(BRAND_PAYMENTS_DENIED_TITLE).length)
        .toBeGreaterThan(0);
    });
    await settle();
    expect(mockInvoke).toHaveBeenCalledTimes(0);

    mockRoleState.current = {
      role: "finance_manager",
      accepted: true,
      isLoading: false,
      isError: false,
    };
    const allowed = await mount(BrandOnboardRoute);
    await waitFor(() => {
      expect(present(allowed, /Set up payments/)).toBe(true);
    });
    expect(present(allowed, new RegExp(BRAND_PAYMENTS_DENIED_TITLE))).toBe(false);
  });

  it("14. the REPORTS route is gated: denied → card, not a zeros report", async () => {
    mockRoleState.current = {
      role: "event_manager",
      accepted: true,
      isLoading: false,
      isError: false,
    };
    const denied = await mount(BrandFinanceReportsRoute);
    await waitFor(() => {
      expect(denied.queryAllByText(BRAND_PAYMENTS_DENIED_TITLE).length)
        .toBeGreaterThan(0);
    });
    expect(present(denied, /Payout reports/)).toBe(true);

    mockRoleState.current = {
      role: "brand_owner",
      accepted: true,
      isLoading: false,
      isError: false,
    };
    const allowed = await mount(BrandFinanceReportsRoute);
    await waitFor(() => {
      expect(allowed.queryAllByText(BRAND_PAYMENTS_DENIED_TITLE).length).toBe(0);
    });
  });
});
