/**
 * #1834 [keyboard-blocks-bank-field] — the implementor's happy-path proof.
 *
 * A REAL @testing-library/react-native mount of the two production screens that
 * own the Nigerian Paystack bank card, asserted on the MOUNTED TREE rather than
 * on the source text:
 *
 *   R1  BrandOnboardView on its Nigeria branch  (/brand/[id]/payments/onboard)
 *   R2  BrandPaymentsView on its paystackEditing branch (Payments → change bank)
 *
 * Both used to wrap the card in react-native's plain ScrollView, which
 * subscribes to no keyboard frames — focusing the 10-digit account-number Input
 * produced ZERO scroll and the field sat under the keyboard plus the ORCH-1165
 * Done bar. Every assertion below is about the scroll HOST that actually owns
 * that field at runtime:
 *
 *   A-1  the mount reaches the field (getByLabelText("Bank account number")),
 *        so an error boundary or a wrong branch can never be read as a pass;
 *   A-2  walking UP from the field, the nearest scroll host is the wrapper's
 *        KeyboardAwareScrollView — and no bare react-native ScrollView appears
 *        anywhere between the screen root and the field;
 *   A-3  that host's resolved bottomOffset === DEFAULT_BOTTOM_OFFSET imported
 *        from the real wrapper module (so moving the constant moves this test
 *        instead of being re-typed here), and the DERIVED arithmetic that makes
 *        it correct holds:
 *          bottomOffset === DONE_BAR_OCCUPIED
 *                         + INPUT_CHROME_BELOW_TEXT_FRAME
 *                         + MIN_VISIBLE_CLEARANCE
 *        with a real visible gap left over.
 *
 * NO NUMERIC LITERAL IS PINNED HERE. #1834 AMENDMENT 2 withdrew the literal 54:
 * measured on glass it left -12.5pt of clearance on iOS 26+ (the Done bar
 * occupies 53pt there, not 42, and the library aligns the inner text frame
 * rather than the Input's bordered box) and +8.89dp where 12 was contracted on
 * Android. A test that re-types a number can only ever pin whatever number the
 * wrapper happened to have.
 *
 * Every walk carries an explicit vacuity guard: a scan that matches nothing
 * FAILS and names the screen. An empty tree is never a pass.
 *
 * Run: npx jest --config jest.issue1834.render.cjs --runInBand
 */

import React from "react";

// ── module mocks ────────────────────────────────────────────────────────────

// react-native-keyboard-controller's index touches its native bindings at
// import time and throws "doesn't seem to be linked" under jest, so the
// components must be stubbed. The library ships its own jest mock — it is
// NOT used here, on purpose: it aliases KeyboardAwareScrollView to
// react-native's ScrollView, which would erase the exact distinction this
// suite exists to measure (pre-fix the scroll host IS an RN ScrollView;
// post-fix it is the wrapper's KeyboardAwareScrollView). The stub below keeps
// a DISTINCT identity and renders a plain View, so an RN ScrollView appearing
// on the path to the field can only have come from the screen's own source.
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

// expo-blur pulls expo-modules-core's native EventEmitter (absent under jest's
// RN preset); GlassChrome (via GlassCard) imports it.
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

// ui/TopBar imports expo-router, which ships untransformed ESM through
// @react-navigation/native. Only the router hook is reached at render time.
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  usePathname: () => "/",
  useLocalSearchParams: () => ({}),
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

jest.mock("../../ui/Spinner", () => {
  const { View: V } = require("react-native");
  return { Spinner: () => <V testID="spinner" /> };
});

// ui/Sheet → SheetMobile → react-native-gesture-handler, whose TurboModule is
// absent under jest. ui/Input imports Sheet for its picker variants; the
// account-number field is variant="number" and never opens one. Same stub as
// PartnerPaystackOnboardForm.orch1331.render.test.tsx.
jest.mock("../../ui/Sheet", () => {
  const { View: V } = require("react-native");
  return { Sheet: (p: { children?: React.ReactNode }) => <V>{p.children}</V>, default: V };
});

// ui/TopBar reaches the supabase client through useCurrentBrand → useBrands,
// which constructs AsyncStorage + expo-constants at import time (both native
// modules are absent under jest). It is fixed chrome that renders OUTSIDE the
// body scroll on both screens, so it is not on the path this suite measures.
jest.mock("../../ui/TopBar", () => {
  const { Text: T } = require("react-native");
  return { TopBar: ({ title }: { title?: string }) => <T>{title}</T> };
});

// The Stripe-side siblings of the Nigeria branch (BrandStripeBankSection,
// BrandStripeKycRemediationCard, …) are imported at module scope and reach the
// supabase client, which constructs AsyncStorage + expo-constants at import
// time — both native modules are absent under jest. None of them renders on a
// Paystack brand. Stubbing the client at the root of that chain keeps every
// component real.
jest.mock("../../../services/supabase", () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: { getSession: jest.fn(), onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })) },
    functions: { invoke: jest.fn() },
    channel: jest.fn(() => ({ on: jest.fn().mockReturnThis(), subscribe: jest.fn() })),
    removeChannel: jest.fn(),
  },
}));

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn(), setQueryData: jest.fn() }),
}));

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", email: "ng@example.com" } }),
}));

const mockIdleQuery = { data: undefined, isLoading: false, isError: false, refetch: jest.fn() };
const mockIdleMutation = {
  mutate: jest.fn(),
  mutateAsync: jest.fn(),
  isPending: false,
  isSuccess: false,
  isError: false,
  reset: jest.fn(),
};

jest.mock("../../../hooks/useBrandStripeStatus", () => ({
  useBrandStripeStatus: () => mockIdleQuery,
}));
jest.mock("../../../hooks/useStartBrandStripeOnboarding", () => ({
  useStartBrandStripeOnboarding: () => mockIdleMutation,
}));
jest.mock("../../../hooks/useBrandStripeBalances", () => ({
  useBrandStripeBalances: () => mockIdleQuery,
}));
jest.mock("../../../hooks/useBrandStripeTaxAccountSession", () => ({
  useBrandStripeTaxAccountSession: () => mockIdleMutation,
}));
jest.mock("../../../hooks/useBrandStripeAccountSession", () => ({
  useBrandStripeAccountSession: () => mockIdleMutation,
}));

// The NG bank form's own data layer. The bank list is irrelevant to the scroll
// host — what matters is that the account-number Input renders.
jest.mock("../../../hooks/useBrandPaystack", () => ({
  useBrandBanks: () => ({
    data: [{ name: "GTBank", code: "058" }],
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useBrandPaystackStatus: () => ({
    data: { connected: true, account_number_masked: "******6789", is_verified: true },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useResolvePaystackAccount: () => mockIdleMutation,
  useCreatePaystackSubaccount: () => mockIdleMutation,
  useUpdatePaystackSubaccount: () => mockIdleMutation,
  useCreatePaystackRecipient: () => mockIdleMutation,
  useUpdatePaystackRecipient: () => mockIdleMutation,
  useDisconnectPaystack: () => mockIdleMutation,
  useClearPaystackProvider: () => mockIdleMutation,
}));

// Sheet-based siblings. None of them renders on the Nigeria branch, but they
// are imported at module scope and drag in react-native-gesture-handler, whose
// TurboModule is absent under jest. Stubbing the component keeps the mount
// honest about the branch under test while avoiding an unrelated native dep.
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

jest.mock("../BrandPayoutBreakdown", () => {
  const { View: V } = require("react-native");
  return { BrandPayoutBreakdown: () => <V testID="payout-breakdown" /> };
});
jest.mock("../BrandPayoutTimelineExplainer", () => {
  const { View: V } = require("react-native");
  return { BrandPayoutTimelineExplainer: () => <V testID="payout-explainer" /> };
});


import { fireEvent, render } from "@testing-library/react-native";
import { ScrollView as RNScrollView } from "react-native";
// The SAME module object the wrapper renders. Under the stub above this is the
// stub; in production it is the library component. Either way the identity
// comparison below is against whatever `SmartScrollView.native` actually
// renders, never against a name this test typed out for itself.
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { BrandOnboardView } from "../BrandOnboardView";
import { BrandPaymentsView } from "../BrandPaymentsView";
import type { Brand } from "../../../types/brand";
// REAL module imports, not re-typed literals: the wrapper owns the clearance
// budget, so if any term of it moves this suite moves with it instead of
// silently pinning a stale number. DONE_BAR_OCCUPIED is itself derived inside
// the wrapper from the keyboard library's own KEYBOARD_TOOLBAR_HEIGHT and
// OPENED_OFFSET rule (53 on iOS 26+, 42 elsewhere), which is exactly the fact
// the pre-rework literal 54 got wrong.
import {
  DEFAULT_BOTTOM_OFFSET,
  DONE_BAR_OCCUPIED,
  INPUT_CHROME_BELOW_TEXT_FRAME,
  KEYBOARD_TOOLBAR_HEIGHT,
  MIN_VISIBLE_CLEARANCE,
} from "../../../wrappers/SmartScrollView.native";

const ACCOUNT_FIELD_LABEL = "Bank account number";

const ngBrand: Brand = {
  id: "brand-ng-1",
  displayName: "Lagos Nights",
  slug: "lagos-nights",
  address: null,
  coverHue: 25,
  role: "owner",
  stats: { events: 0, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
  currentLiveEvent: null,
  countryCode: "NG",
  paymentProvider: "paystack",
  paystackSubaccountCode: "ACCT_test",
  defaultCurrency: "NGN",
};

type Mounted = Awaited<ReturnType<typeof render>>;

/**
 * A React Fiber node, structurally. @testing-library/react-native v14 exposes
 * only HOST elements on its TestInstance tree (`type` is a string), so a
 * composite identity like "is this scroll host the wrapper's
 * KeyboardAwareScrollView or react-native's ScrollView?" is invisible there.
 * The fiber IS the mounted tree and carries the real component reference, so
 * the walk below runs on it.
 */
interface FiberNode {
  type: unknown;
  memoizedProps: Record<string, unknown> | null;
  return: FiberNode | null;
}

/** Reads the fiber off a TestInstance, failing loudly if it is unavailable. */
function fiberOf(node: unknown, screenName: string): FiberNode {
  const fiber = (node as { unstable_fiber?: FiberNode | null }).unstable_fiber;
  if (fiber == null) {
    throw new Error(
      `[#1834 vacuity guard] ${screenName}: the account-number field exposes no fiber, so component ` +
        `identity could not be read. This suite must FAIL rather than silently skip its only real assertion.`,
    );
  }
  return fiber;
}

function isKeyboardAwareScrollView(fiber: FiberNode): boolean {
  return fiber.type === (KeyboardAwareScrollView as unknown);
}

function isBareRnScrollView(fiber: FiberNode): boolean {
  return fiber.type === (RNScrollView as unknown);
}

interface ScrollHostFacts {
  /** The nearest scroll host above the account-number field. */
  host: FiberNode;
  /** Bare react-native ScrollViews between the screen root and the field. */
  bareRnScrollViewsOnPath: number;
  /** How many ancestors were walked — proof the scan was not empty. */
  ancestorsWalked: number;
}

/**
 * Finds the NG account-number Input in a mounted tree and reports the scroll
 * host that actually owns it.
 *
 * Vacuity guard: every failure mode below THROWS and names the screen. A screen
 * that renders nothing, lands on the wrong branch, or renders no scroll host at
 * all can never be read as a pass.
 */
function scrollHostFactsFor(screenName: string, tree: Mounted): ScrollHostFacts {
  const field = tree.queryByLabelText(ACCOUNT_FIELD_LABEL);
  if (field === null) {
    throw new Error(
      `[#1834 vacuity guard] ${screenName}: the mounted tree has no "${ACCOUNT_FIELD_LABEL}" field. ` +
        `The mount never reached the Nigerian bank card, so nothing about its scroll host was measured.`,
    );
  }

  const chain: FiberNode[] = [];
  let cursor: FiberNode | null = fiberOf(field, screenName).return;
  while (cursor != null) {
    chain.push(cursor);
    cursor = cursor.return;
  }
  if (chain.length === 0) {
    throw new Error(
      `[#1834 vacuity guard] ${screenName}: the account-number field has no ancestors — the tree is degenerate.`,
    );
  }

  const host = chain.find(
    (n) => isKeyboardAwareScrollView(n) || isBareRnScrollView(n),
  );
  if (host === undefined) {
    throw new Error(
      `[#1834 vacuity guard] ${screenName}: no scroll host of ANY kind was found between the ` +
        `account-number field and the screen root (${chain.length} ancestors walked). ` +
        `The field is not inside a scroll container at all.`,
    );
  }

  return {
    host,
    bareRnScrollViewsOnPath: chain.filter(isBareRnScrollView).length,
    ancestorsWalked: chain.length,
  };
}

function hostLabel(host: FiberNode): string {
  if (isKeyboardAwareScrollView(host)) return "KeyboardAwareScrollView";
  if (isBareRnScrollView(host)) return "react-native ScrollView";
  return "unknown";
}

/** R1 — /brand/[id]/payments/onboard, Nigeria branch (mode="create"). */
async function mountOnboard(): Promise<Mounted> {
  return await render(
    <BrandOnboardView brand={ngBrand} onCancel={jest.fn()} onAfterDone={jest.fn()} />,
  );
}

/**
 * R2 — Payments → "Change bank account", i.e. the paystackEditing branch
 * (mode="update"). Driven through the real CTA rather than a prop, so the
 * branch under test is the one a person actually reaches — and "update" is the
 * mode the runtime matrix never measured.
 */
async function mountPaymentsEditing(): Promise<Mounted> {
  const tree = await render(
    <BrandPaymentsView
      brand={ngBrand}
      onBack={jest.fn()}
      onOpenOnboard={jest.fn()}
      onOpenReports={jest.fn()}
    />,
  );
  await fireEvent.press(tree.getByText("Change bank account"));
  return tree;
}

const SCREENS: Array<[string, () => Promise<Mounted>]> = [
  ["BrandOnboardView (R1, Nigeria branch)", mountOnboard],
  ["BrandPaymentsView (R2, paystackEditing branch)", mountPaymentsEditing],
];

// ── assertions ──────────────────────────────────────────────────────────────

describe("#1834 — the NG account-number field is owned by a keyboard-aware scroll host", () => {
  it("0. the screen table is non-empty and covers BOTH migrated screens", () => {
    // Guards the loops below: a table someone empties must not turn this suite
    // into a green no-op.
    expect(SCREENS).toHaveLength(2);
  });

  it.each(SCREENS)(
    "1. %s mounts and actually reaches the account-number field",
    async (_name, mount) => {
      const tree = await mount();
      expect(tree.getByLabelText(ACCOUNT_FIELD_LABEL)).toBeTruthy();
    },
  );

  it.each(SCREENS)(
    "2. %s — the nearest scroll host above the field is the wrapper's KeyboardAwareScrollView",
    async (name, mount) => {
      const facts = scrollHostFactsFor(name, await mount());
      // Pre-fix this reads "react-native ScrollView" and the failure names it.
      expect({ screen: name, host: hostLabel(facts.host) }).toEqual({
        screen: name,
        host: "KeyboardAwareScrollView",
      });
      expect(facts.ancestorsWalked).toBeGreaterThan(0);
    },
  );

  it.each(SCREENS)(
    "3. %s — no bare react-native ScrollView sits between the screen root and the field",
    async (name, mount) => {
      const facts = scrollHostFactsFor(name, await mount());
      expect(facts.bareRnScrollViewsOnPath).toBe(0);
    },
  );

  it.each(SCREENS)(
    "4. %s — the host's resolved bottomOffset is the inherited DEFAULT_BOTTOM_OFFSET",
    async (name, mount) => {
      const facts = scrollHostFactsFor(name, await mount());
      const bottomOffset: unknown = facts.host.memoizedProps?.bottomOffset;
      expect(typeof bottomOffset).toBe("number");
      // Tied to the real module AND to the arithmetic that produces it, so
      // neither can drift away from the other unnoticed — and no literal is
      // re-typed here, per #1834 AMENDMENT 2.
      expect(bottomOffset).toBe(DEFAULT_BOTTOM_OFFSET);
      expect(bottomOffset).toBe(
        DONE_BAR_OCCUPIED +
          INPUT_CHROME_BELOW_TEXT_FRAME +
          MIN_VISIBLE_CLEARANCE,
      );
    },
  );

  it.each(SCREENS)(
    "5. %s — the resolved offset clears the ORCH-1165 Done bar with >= 12 visible",
    async (name, mount) => {
      const facts = scrollHostFactsFor(name, await mount());
      const bottomOffset = facts.host.memoizedProps?.bottomOffset as number;
      // The arithmetic that makes the offset the RIGHT number, term by term:
      // DONE_BAR_OCCUPIED of it is spent on the Done bar (53 on iOS 26+, 42
      // elsewhere — derived from the library's own OPENED_OFFSET rule),
      // INPUT_CHROME_BELOW_TEXT_FRAME of it covers the gap between the
      // library's scroll target (the inner text frame) and the Input's visible
      // bottom border, and what is LEFT must still be a real visible gap.
      // Clearing the keyboard is not the criterion — clearing the bar is.
      expect(
        bottomOffset - DONE_BAR_OCCUPIED - INPUT_CHROME_BELOW_TEXT_FRAME,
      ).toBeGreaterThanOrEqual(MIN_VISIBLE_CLEARANCE);
      // I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE — the ORCH-1165 floor, unchanged
      // and not regressed by the #1834 rework.
      expect(bottomOffset).toBeGreaterThanOrEqual(KEYBOARD_TOOLBAR_HEIGHT);
    },
  );

  it("6. the vacuity guard is real — a tree with no bank card FAILS instead of passing", async () => {
    // If the guard itself ever regressed into a silent skip, every assertion
    // above would become unfalsifiable. Prove it throws.
    const empty = await render(<></>);
    expect(() => scrollHostFactsFor("empty tree", empty)).toThrow(
      /vacuity guard[\s\S]*no "Bank account number" field/,
    );
  });
});
