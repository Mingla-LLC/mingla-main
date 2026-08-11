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
 * Identity is read through @testing-library/react-native's PUBLIC element tree
 * (`type` / `props` / `parent`), which is the same on RTL v13 and v14, and is
 * re-anchored to the real modules by test 7. It is deliberately NOT read off
 * React's private `unstable_fiber`, which exists only on v14+ and made this
 * suite pass locally while failing every assertion on CI.
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
//
// That distinct identity is published as a testID on the HOST View the stub
// renders (`KAS_HOST_MARKER` below — the literal is repeated here because a
// jest.mock factory is hoisted above every module-scope binding and may not
// close over one). Nothing else in this file or in the app stamps that value,
// so a node carrying it can only have been rendered by THIS component; test 7
// re-proves that link on every run and fails if the two literals ever drift.
// Publishing identity as a host prop is what makes the walk below readable
// through @testing-library/react-native's PUBLIC element tree on both v13
// (react-test-renderer) and v14 (test-renderer) — see the walk's header.
jest.mock("react-native-keyboard-controller", () => {
  const RN = require("react-native");
  const ReactLocal = require("react");
  const KeyboardAwareScrollView = ReactLocal.forwardRef(
    function KeyboardAwareScrollView(
      props: { children?: React.ReactNode },
      ref: unknown,
    ) {
      return ReactLocal.createElement(
        RN.View,
        { ...props, testID: "issue1834-keyboard-aware-scroll-host", ref },
        props.children,
      );
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
import { ScrollView as RNScrollView, Text as RNText } from "react-native";
// The SAME module object the wrapper renders. Under the stub above this is the
// stub; in production it is the library component. Test 7 renders THIS export
// and react-native's own ScrollView and re-derives both identity markers from
// what they actually put in the tree, so the walk is anchored to the real
// modules rather than to a name this test typed out for itself.
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

/** Label used only by test 7's two single-component identity fixtures. */
const IDENTITY_PROBE_LABEL = "issue1834 identity probe";

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
 * The marker the mocked KeyboardAwareScrollView stamps on the HOST View it
 * renders. Kept in sync with the literal inside the jest.mock factory above by
 * test 7, which renders the module's own export and asserts the marker comes
 * back — so the two cannot drift into a silently-unmatchable pair.
 */
const KAS_HOST_MARKER = "issue1834-keyboard-aware-scroll-host";

/**
 * react-native's ScrollView renders this HOST component. Pinned to the real
 * module by test 7 rather than trusted as a typed-out string, so a react-native
 * rename turns test 7 red instead of quietly making assertion 3 unfalsifiable.
 */
const RN_SCROLL_HOST_TYPE = "RCTScrollView";

/**
 * A node in @testing-library/react-native's PUBLIC element tree.
 *
 * WHY PUBLIC, AND WHY HOST NODES (#1834 CI repair): this walk previously read
 * component identity off React's private fiber via `instance.unstable_fiber`.
 * That property does not exist on RTL v13, whose element tree comes from
 * `react-test-renderer`; it exists only on v14+, whose tree comes from the new
 * `test-renderer` package. The workflow installed `@testing-library/react-native`
 * UNPINNED, and npm's peer resolution picks v13.3.3 whenever `test-renderer`'s
 * `react-reconciler@~0.33` (peer `react@^19.2.0`) cannot be satisfied against
 * this app's pinned `react@19.1.0` — which is exactly what happens on CI. The
 * suite therefore passed locally and failed every assertion on CI through its
 * own vacuity guard. A private, explicitly-unstable API was the wrong thing to
 * hang component identity on.
 *
 * `type`, `props` and `parent` are public on BOTH trees, and HOST elements
 * appear in both (v14 exposes only hosts; v13 exposes hosts plus composites).
 * So identity is published as a host prop by the mock and read back here, and
 * the assertions are exactly as strong: matching `KAS_HOST_MARKER` still means
 * "this node was rendered by react-native-keyboard-controller's
 * KeyboardAwareScrollView", and matching `RN_SCROLL_HOST_TYPE` still means
 * "this node was rendered by react-native's ScrollView" — both re-proved from
 * the real modules by test 7 on every run.
 */
interface TreeNode {
  type: unknown;
  props: Record<string, unknown> | null;
  parent: TreeNode | null;
}

/**
 * Walks UP from an element through the public tree.
 *
 * Vacuity guard: if the element does not expose a `parent` chain at all — the
 * shape this walk depends on — that is a silent-skip hazard of exactly the kind
 * the fiber read turned out to be, so it THROWS and names the screen rather
 * than returning an empty chain that every `.find` below would read as "not
 * found".
 */
function ancestorChainOf(field: unknown, screenName: string): TreeNode[] {
  if (typeof field !== "object" || field === null || !("parent" in field)) {
    throw new Error(
      `[#1834 vacuity guard] ${screenName}: the account-number field exposes no ancestor chain, so the ` +
        `scroll host that owns it could not be read. This suite must FAIL rather than silently skip its ` +
        `only real assertion.`,
    );
  }
  const chain: TreeNode[] = [];
  let cursor: TreeNode | null = (field as TreeNode).parent;
  while (cursor != null) {
    chain.push(cursor);
    cursor = cursor.parent;
  }
  return chain;
}

function isKeyboardAwareScrollHost(node: TreeNode): boolean {
  return node.props?.testID === KAS_HOST_MARKER;
}

function isBareRnScrollHost(node: TreeNode): boolean {
  return node.type === RN_SCROLL_HOST_TYPE;
}

interface ScrollHostFacts {
  /** The nearest scroll host above the account-number field. */
  host: TreeNode;
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

  const chain = ancestorChainOf(field, screenName);
  if (chain.length === 0) {
    throw new Error(
      `[#1834 vacuity guard] ${screenName}: the account-number field has no ancestors — the tree is degenerate.`,
    );
  }

  const host = chain.find(
    (n) => isKeyboardAwareScrollHost(n) || isBareRnScrollHost(n),
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
    bareRnScrollViewsOnPath: chain.filter(isBareRnScrollHost).length,
    ancestorsWalked: chain.length,
  };
}

function hostLabel(host: TreeNode): string {
  if (isKeyboardAwareScrollHost(host)) return "KeyboardAwareScrollView";
  if (isBareRnScrollHost(host)) return "react-native ScrollView";
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
      const bottomOffset: unknown = facts.host.props?.bottomOffset;
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
      const bottomOffset = facts.host.props?.bottomOffset as number;
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
    //
    // The fixture is a real scroll container with NO bank field, not an empty
    // fragment: `render(<></>)` leaves @testing-library/react-native v13 with
    // an unmounted renderer and throws "Can't access .root" before the guard is
    // ever reached, and a fixture that only works on one RTL version is exactly
    // the portability defect this repair exists to remove. A tree that HAS a
    // scroll host but no field is also the stronger probe: it proves the guard
    // keys on the FIELD, not on the absence of a container.
    const noCard = await render(<RNScrollView />);
    expect(() => scrollHostFactsFor("no-bank-card tree", noCard)).toThrow(
      /vacuity guard[\s\S]*no "Bank account number" field/,
    );
  });

  it("7. both identity markers are re-derived from the REAL modules, not typed-out names", async () => {
    // Assertions 2-5 read component identity off PUBLIC host props rather than
    // off React's private fiber (see the TreeNode header for why). That is only
    // as strong as the link between each marker and the component it stands
    // for, so the link is re-proved here from the real module objects on every
    // run: render each component alone and check that the walk classifies it,
    // and ONLY it. If the mock's marker literal drifts from KAS_HOST_MARKER, or
    // react-native renames its ScrollView host, this fails loudly instead of
    // quietly leaving the walk unable to match anything — which would otherwise
    // surface as the "no scroll host of ANY kind" guard on a correct app.
    const kas = await render(
      <KeyboardAwareScrollView>
        <RNText accessibilityLabel={IDENTITY_PROBE_LABEL}>probe</RNText>
      </KeyboardAwareScrollView>,
    );
    const kasChain = ancestorChainOf(
      kas.getByLabelText(IDENTITY_PROBE_LABEL),
      "KeyboardAwareScrollView identity probe",
    );
    expect({
      keyboardAware: kasChain.some(isKeyboardAwareScrollHost),
      bareRnScrollView: kasChain.some(isBareRnScrollHost),
    }).toEqual({ keyboardAware: true, bareRnScrollView: false });

    const rn = await render(
      <RNScrollView>
        <RNText accessibilityLabel={IDENTITY_PROBE_LABEL}>probe</RNText>
      </RNScrollView>,
    );
    const rnChain = ancestorChainOf(
      rn.getByLabelText(IDENTITY_PROBE_LABEL),
      "react-native ScrollView identity probe",
    );
    expect({
      keyboardAware: rnChain.some(isKeyboardAwareScrollHost),
      bareRnScrollView: rnChain.some(isBareRnScrollHost),
    }).toEqual({ keyboardAware: false, bareRnScrollView: true });
  });
});
