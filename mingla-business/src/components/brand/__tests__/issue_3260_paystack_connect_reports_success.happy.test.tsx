/**
 * #3260 [paystack-connect-false-negative] — implementor happy-path regression.
 *
 * Live on 2026-09-12 (prod, Paystack LIVE, brand Harmattan Club) a Nigerian
 * bank connect returned HTTP 200 twice, wrote brand_paystack_recipients
 * (RCP_3aa1lhtjwpff3oj, is_active=true) and flipped brands to
 * payment_provider=paystack with paystack_subaccount_code=ACCT_xi4hh048jj7axma
 * — and the wizard bounced the user back to step 4 saying
 * "Payout setup wasn't finished. Your brand is safe."
 *
 * Cause: BrandCreationFlow derived payout state from `brand ?? query.data`.
 * `brand` is a component-local snapshot captured ONCE by the resume-hydration
 * effect, so the canonical refetch that landed 321ms after the connect could
 * never reach the UI.
 *
 * The load-bearing assertion is the SECOND render pass: once the canonical
 * query holds a connected brand, the surface must render the connected state
 * and must NOT render the "wasn't finished" copy. Reverting
 * `payoutCanonicalBrand` to `brand ?? resumeBrandQuery.data` fails it, because
 * the frozen pre-connect snapshot wins forever.
 */

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import { BrandCreationFlow } from "../BrandCreationFlow";
import {
  PARTIAL_CONNECT_MESSAGE,
  describePaystackConnectError,
} from "../paystackConnectMessages";
import { deriveBrandCreationPayoutState } from "../../../utils/brandCreationPayoutState";
import type { Brand } from "../../../types/brand";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BRAND_ID = "e79fdb72-c6d6-4a4e-b3b3-4c75580a2b0a";
const SUBACCOUNT_CODE = "ACCT_xi4hh048jj7axma";

/** The pre-connect row: Nigeria rail chosen, no bank attached yet. */
const PRE_CONNECT_BRAND: Brand = {
  id: BRAND_ID,
  displayName: "Harmattan Club",
  slug: "harmattanclub",
  address: null,
  coverHue: 25,
  accountId: "account-3260",
  role: "owner",
  stats: { events: 0, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
  currentLiveEvent: null,
  countryCode: "NG",
  paymentProvider: "paystack",
  defaultCurrency: "NGN",
  stripeStatus: "not_connected",
};

/** The row the server actually held 321ms after the connect returned 200. */
const CONNECTED_BRAND: Brand = {
  ...PRE_CONNECT_BRAND,
  paystackSubaccountCode: SUBACCOUNT_CODE,
};

const WASNT_FINISHED = "Payout setup wasn't finished. Your brand is safe.";
const NOT_CONNECTED_NOTICE = "Payouts aren’t connected";

// Mutable canonical-query state: the whole point of this issue is that the
// component must follow this value, not a snapshot it took of it earlier.
let brandRow: Brand | null = PRE_CONNECT_BRAND;

// The shared __manual_mocks__/react-native.js stub predates the payout-ready
// announcement and carries no AccessibilityInfo. Extend it locally rather than
// widening a surface every other suite in the repo shares.
jest.mock("react-native", () => ({
  ...(jest.requireActual("react-native") as Record<string, unknown>),
  AccessibilityInfo: {
    announceForAccessibility: jest.fn(),
    isReduceMotionEnabled: jest.fn(() => Promise.resolve(false)),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => false,
  }),
  useLocalSearchParams: () => ({ resume_brand: BRAND_ID }),
}));

jest.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Medium: "Medium" },
  impactAsync: jest.fn(),
}));

jest.mock("../../../hooks/usePartnerStripe", () => ({
  usePartnerStripeStatus: () => ({ data: { partner_enabled: false } }),
}));

jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "account-3260" },
    isAuthReady: true,
    loading: false,
    session: { access_token: "test" },
  }),
}));

jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (
    selector: (state: { setCurrentBrand: () => void }) => unknown,
  ) => selector({ setCurrentBrand: jest.fn() }),
}));

jest.mock("../../../hooks/useCreatorAccount", () => ({
  useUpdateCreatorAccount: () => ({
    mutateAsync: jest.fn(() => Promise.resolve(undefined)),
  }),
}));

jest.mock("../../../hooks/useBrands", () => ({
  SlugCollisionError: class SlugCollisionError extends Error {},
  useBrand: () => ({
    data: brandRow,
    isFetched: true,
    isError: false,
    refetch: jest.fn(),
  }),
  useCreateBrand: () => ({
    mutateAsync: jest.fn(),
    isPending: false,
  }),
  useUpdateBrand: () => ({
    mutateAsync: jest.fn(),
    isPending: false,
  }),
}));

// A Paystack brand has no Stripe account; the Stripe status query resolving to
// "not_connected" is exactly the shipped production shape for this rail.
jest.mock("../../../hooks/useBrandStripeStatus", () => ({
  useBrandStripeStatus: () => ({
    data: { status: "not_connected" },
    isFetched: true,
    isError: false,
    error: null,
    refetch: jest.fn(),
  }),
}));

jest.mock("../../../hooks/useCanManageBrandPayments", () => ({
  useCanManageBrandPayments: () => ({
    allowed: true,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({
    role: "brand_owner",
    rank: 100,
    permissionsOverride: {},
    accepted: true,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

jest.mock("../../../lib/netinfoSafe", () => ({ useNetInfoSafe: () => null }));

jest.mock("../../../diagnostics/sentry", () => ({ captureException: jest.fn() }));
jest.mock("../../../wrappers/useKeyboardIsVisible", () => ({
  useKeyboardIsVisible: () => false,
}));
jest.mock("../../../services/brandInvitationsService", () => ({
  inviteBrandMember: jest.fn(),
}));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    React.createElement("Button", {
      ...props,
      accessibilityRole: "button",
      accessibilityLabel: props.accessibilityLabel ?? props.label,
    }),
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children, ...props }: { children?: React.ReactNode }) =>
    React.createElement("GlassCard", props, children),
}));
jest.mock("../../ui/Icon", () => ({
  Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
}));
jest.mock("../../ui/Input", () => ({
  Input: (props: Record<string, unknown>) => React.createElement("Input", props),
}));
jest.mock("../../ui/Stepper", () => ({
  Stepper: (props: Record<string, unknown>) =>
    React.createElement("Stepper", props),
}));
jest.mock("../../ui/Toast", () => ({
  Toast: (props: Record<string, unknown>) => React.createElement("Toast", props),
}));
jest.mock("../../ui/CoverPickerSheet", () => ({
  CoverPickerSheet: (props: Record<string, unknown>) =>
    React.createElement("CoverPickerSheet", props),
}));
jest.mock("../../location/MapboxAddressInput", () => ({
  MapboxAddressInput: (props: Record<string, unknown>) =>
    React.createElement("MapboxAddressInput", props),
}));
jest.mock("../../ui/EventCoverMedia", () => ({
  EventCoverMedia: (props: Record<string, unknown>) =>
    React.createElement("EventCoverMedia", props),
}));

interface TestNode {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
}

interface Renderer {
  root: TestNode;
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}

// react-test-renderer is installed in the required full-suite CI lane.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Renderer;
  act: (callback: () => Promise<void> | void) => Promise<void> | void;
};

/**
 * Match rendered copy wherever it sits — `children` may be the string itself or
 * a single-element array of it, depending on how the <Text> was authored.
 */
const hasText = (root: TestNode, text: string): boolean =>
  root.findAll((node) => {
    const children = node.props.children;
    if (children === text) return true;
    return Array.isArray(children) && children.length === 1 &&
      children[0] === text;
  }).length > 0;

const byTestId = (root: TestNode, testID: string): TestNode[] =>
  root.findAll((node) => node.props.testID === testID);

describe("#3260 a successful Paystack connect reports success", () => {
  beforeEach(() => {
    brandRow = PRE_CONNECT_BRAND;
  });

  test("the connected canonical row replaces the pre-connect snapshot the wizard hydrated from", async () => {
    let tree!: Renderer;

    // Pass 1 — resume with the PRE-CONNECT row. This is the snapshot the
    // hydration effect captures into local `brand` state, exactly as it did in
    // production when the wizard remounted while the refetch was in flight.
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <BrandCreationFlow onComplete={jest.fn()} onCancel={jest.fn()} />,
      );
    });
    expect(hasText(tree.root, WASNT_FINISHED)).toBe(true);

    // Pass 2 — the canonical brand row now carries the subaccount code, which
    // is what the server actually held. Nothing else changes.
    brandRow = CONNECTED_BRAND;
    await TestRenderer.act(async () => {
      tree.update(
        <BrandCreationFlow onComplete={jest.fn()} onCancel={jest.fn()} />,
      );
    });

    // FAILS ON REVERT: with `brand ?? resumeBrandQuery.data` the frozen
    // pre-connect snapshot still wins and this copy is still on screen.
    expect(hasText(tree.root, WASNT_FINISHED)).toBe(false);

    // And the connected state is what renders instead: the offering chooser,
    // with no "payouts aren't connected" notice on it.
    expect(byTestId(tree.root, "offering-chooser-event").length).toBeGreaterThan(
      0,
    );
    expect(hasText(tree.root, NOT_CONNECTED_NOTICE)).toBe(false);

    await TestRenderer.act(async () => tree.unmount());
  });

  test("an active recipient plus a flipped brand row derives as ready, never not-connected", () => {
    expect(
      deriveBrandCreationPayoutState({
        permission: "allowed",
        online: true,
        statusResolved: true,
        statusError: false,
        stripeStatus: "not_connected",
        paystackSubaccountCode: SUBACCOUNT_CODE,
      }),
    ).toBe("ready");
  });

  test("an unresolved brand query on the resume path reads as loading, not as a verdict", () => {
    // The Stripe status query resolving cannot on its own prove the Paystack
    // rail's readiness — the brand row is the truth there.
    expect(
      deriveBrandCreationPayoutState({
        permission: "allowed",
        online: true,
        statusResolved: false,
        statusError: false,
        stripeStatus: undefined,
        paystackSubaccountCode: undefined,
      }),
    ).toBe("loading");
  });

  test("a half-written connect is named as a half-write, not as a blanket failure", () => {
    const err = new Error(
      "createPaystackSubaccount: subaccount_create_failed (upstream 502)",
    );

    // Recipient committed, brand row did not — the only reachable half-state.
    expect(describePaystackConnectError(err, false, true)).toBe(
      PARTIAL_CONNECT_MESSAGE,
    );
    expect(PARTIAL_CONNECT_MESSAGE).toContain("Your details are safe");
    expect(PARTIAL_CONNECT_MESSAGE).toContain("again to finish");

    // Nothing committed — the honest message is still the blanket retry line.
    expect(describePaystackConnectError(err, false, false)).not.toBe(
      PARTIAL_CONNECT_MESSAGE,
    );

    // A terminal cause outranks the half-state note: tapping again cannot fix
    // a permission problem, so we must not tell the operator to try.
    expect(
      describePaystackConnectError(new Error("forbidden"), false, true),
    ).toContain("Ask a brand owner");
  });
});
