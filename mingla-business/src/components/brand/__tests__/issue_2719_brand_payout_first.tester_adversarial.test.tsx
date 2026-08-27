import React from "react";
import { describe, expect, jest, test } from "@jest/globals";
import { StyleSheet } from "react-native";

import { BrandCreationFlow } from "../BrandCreationFlow";
import {
  OFFERING_OPTIONS,
  OfferingChooser,
  routeForOffering,
  type OfferingKind,
} from "../OfferingChooser";
import {
  deriveBrandCreationPayoutState,
  shouldResumeBrandCreationAtCreate,
  type BrandCreationPayoutState,
} from "../../../utils/brandCreationPayoutState";
import { buildBankConnectWebReturnUrl } from "../../../utils/bankConnectFunnel";
import type { Brand } from "../../../types/brand";

// Independent #2719 adversarial proof: currency is never payout readiness,
// free creators remain operable in every non-ready state, and hostile resume /
// return inputs cannot mutate or redirect outside the closed contract.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let searchParams: Record<string, string | string[] | undefined> = {};
let resumedBrand: Brand | null = null;
let resumeAccepted = false;
const routerPush = jest.fn();
const routerReplace = jest.fn();
const createBrand = jest.fn();
const updateBrand = jest.fn();
const haptic = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => routerPush(...args),
    replace: (...args: unknown[]) => routerReplace(...args),
    canGoBack: () => false,
    back: jest.fn(),
  }),
  useLocalSearchParams: () => searchParams,
}));

jest.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Medium: "Medium" },
  impactAsync: (...args: unknown[]) => haptic(...args),
}));

jest.mock("../../../hooks/usePartnerStripe", () => ({
  usePartnerStripeStatus: () => ({ data: { partner_enabled: false } }),
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "account-2719-tester" },
    isAuthReady: true,
    loading: false,
    session: { access_token: "test" },
  }),
}));
jest.mock("../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: (selector: (state: { setCurrentBrand: () => void }) => unknown) =>
    selector({ setCurrentBrand: jest.fn() }),
}));
jest.mock("../../../hooks/useCreatorAccount", () => ({
  useUpdateCreatorAccount: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock("../../../hooks/useBrands", () => ({
  SlugCollisionError: class SlugCollisionError extends Error {},
  useBrand: () => ({
    data: resumedBrand,
    isFetched: true,
    isError: false,
    refetch: jest.fn(async () => undefined),
  }),
  useCreateBrand: () => ({ mutateAsync: createBrand, isPending: false }),
  useUpdateBrand: () => ({ mutateAsync: updateBrand, isPending: false }),
}));
jest.mock("../../../hooks/useBrandStripeStatus", () => ({
  useBrandStripeStatus: () => ({
    data: { status: "not_connected" },
    isFetched: true,
    isError: false,
    error: null,
    refetch: jest.fn(async () => undefined),
  }),
}));
jest.mock("../../../hooks/useCanManageBrandPayments", () => ({
  useCanManageBrandPayments: () => ({
    allowed: true,
    isLoading: false,
    isError: false,
    refetch: jest.fn(async () => undefined),
  }),
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({
    role: resumeAccepted ? "brand_owner" : null,
    rank: resumeAccepted ? 4 : 0,
    permissionsOverride: {},
    accepted: resumeAccepted,
    isLoading: false,
    isError: false,
    refetch: jest.fn(async () => undefined),
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
  Stepper: (props: Record<string, unknown>) => React.createElement("Stepper", props),
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
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
}
interface Renderer {
  root: TestNode;
  unmount: () => void;
}

// react-test-renderer is provisioned in the required full-suite lane.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Renderer;
  act: (callback: () => Promise<void> | void) => Promise<void> | void;
};

const byTestId = (root: TestNode, testID: string): TestNode[] =>
  root.findAll((node) => node.props.testID === testID);
const byText = (root: TestNode, value: string): TestNode[] =>
  root.findAll((node) => node.props.children === value);
const flatStyle = (value: unknown): Record<string, unknown> =>
  StyleSheet.flatten(
    typeof value === "function"
      ? (value as (state: { pressed: boolean }) => unknown)({ pressed: false })
      : value,
  ) as Record<string, unknown>;
const press = (node: TestNode): void => {
  const onPress = node.props.onPress;
  if (typeof onPress !== "function") throw new Error("Expected onPress");
  onPress({});
};

describe("issue 2719 tester adversarial payout and creator boundaries", () => {
  test("currency is not an input and only canonical bank truth can become ready", () => {
    const base = {
      permission: "allowed" as const,
      online: true,
      statusResolved: true,
      statusError: false,
      stripeStatus: "not_connected" as const,
      paystackSubaccountCode: null,
    };
    expect(deriveBrandCreationPayoutState(base)).toBe("not-connected");
    expect(deriveBrandCreationPayoutState({ ...base, stripeStatus: "active" })).toBe("ready");
    expect(deriveBrandCreationPayoutState({ ...base, paystackSubaccountCode: "PS-2719" })).toBe("ready");
    expect(deriveBrandCreationPayoutState({ ...base, online: false, stripeStatus: "active" })).toBe("offline");
    expect(deriveBrandCreationPayoutState({ ...base, permission: "denied", stripeStatus: "active" })).toBe("permission-denied");
    expect(shouldResumeBrandCreationAtCreate("ready")).toBe(true);
    expect(shouldResumeBrandCreationAtCreate("pending")).toBe(true);
    expect(shouldResumeBrandCreationAtCreate("restricted")).toBe(true);
    expect(shouldResumeBrandCreationAtCreate("not-connected")).toBe(false);
  });

  test("all five free creators remain enabled, labelled, and duplicate-tap guarded across every non-ready state", async () => {
    const states: BrandCreationPayoutState[] = [
      "loading",
      "not-connected",
      "pending",
      "restricted",
      "unknown-error",
      "offline",
      "permission-denied",
    ];
    for (const payoutState of states) {
      const selected = jest.fn();
      let tree!: Renderer;
      await TestRenderer.act(async () => {
        tree = TestRenderer.create(
          <OfferingChooser payoutState={payoutState} onSelect={selected} />,
        );
      });
      for (const option of OFFERING_OPTIONS) {
        const nodes = byTestId(tree.root, `offering-chooser-${option.kind}`);
        expect(nodes.length).toBeGreaterThan(0);
        const semanticNode = nodes.find((node) =>
          node.props.accessibilityRole === "button" &&
          typeof node.props.accessibilityLabel === "string"
        );
        expect(semanticNode).toBeDefined();
        expect(semanticNode!.props.disabled).not.toBe(true);
        expect(String(semanticNode!.props.accessibilityLabel)).toContain("Free");
      }
      const event = byTestId(tree.root, "offering-chooser-event")[0]!;
      await TestRenderer.act(async () => {
        press(event);
        press(event);
      });
      expect(selected).toHaveBeenCalledTimes(1);
      expect(haptic).toHaveBeenCalledWith("Medium");
      await TestRenderer.act(async () => tree.unmount());
    }
  });

  test("the narrow grid is 2+2 plus full-width Venue with minimum targets and a 720 wide ceiling", async () => {
    let tree!: Renderer;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <OfferingChooser payoutState="not-connected" onSelect={jest.fn()} />,
      );
    });
    for (const kind of ["event", "trip", "experience", "rsvp"] as OfferingKind[]) {
      const nodes = byTestId(tree.root, `offering-chooser-${kind}`);
      const styleNode = nodes.find((node) => typeof node.props.style === "function") ??
        nodes[nodes.length - 1]!;
      const style = flatStyle(styleNode.props.style);
      expect(style.flexBasis).toBe("48%");
      expect(style.minHeight).toBeGreaterThanOrEqual(132);
    }
    const venueNodes = byTestId(tree.root, "offering-chooser-venue");
    const venueStyleNode = venueNodes.find((node) => typeof node.props.style === "function") ??
      venueNodes[venueNodes.length - 1]!;
    const venueStyle = flatStyle(venueStyleNode.props.style);
    expect(venueStyle.flexBasis).toBe("100%");
    expect(venueStyle.minHeight).toBeGreaterThanOrEqual(104);
    const maxWidthNodes = tree.root.findAll((node) => {
      const style = flatStyle(node.props.style);
      return style.maxWidth === 720;
    });
    expect(maxWidthNodes.length).toBeGreaterThan(0);
    await TestRenderer.act(async () => tree.unmount());
  });

  test("closed return URLs stay same-origin and hostile destinations never become open redirects", () => {
    const brandId = "27190000-0000-4000-8000-000000000099";
    expect(buildBankConnectWebReturnUrl("https://host.usemingla.com", brandId, "brand-create"))
      .toBe(`https://host.usemingla.com/brand/new?resume_brand=${brandId}`);
    expect(buildBankConnectWebReturnUrl("https://host.usemingla.com", brandId))
      .toBe(`https://host.usemingla.com/brand/${brandId}/payments`);
    expect(buildBankConnectWebReturnUrl(
      "https://host.usemingla.com",
      brandId,
      " BRAND-CREATE " as never,
    )).toBe(`https://host.usemingla.com/brand/${brandId}/payments`);
    expect(buildBankConnectWebReturnUrl(
      "https://host.usemingla.com",
      brandId,
      ["brand-create"] as never,
    )).toBe(`https://host.usemingla.com/brand/${brandId}/payments`);
    expect(() => buildBankConnectWebReturnUrl("http://host.usemingla.com", brandId))
      .toThrow("secure HTTPS");
    expect(() => routeForOffering("malformed" as OfferingKind))
      .toThrow("Unknown offering kind");
  });

  test("an inaccessible resume renders denial truth and performs zero writes or navigation", async () => {
    searchParams = { resume_brand: "27190000-0000-4000-8000-000000000404" };
    resumedBrand = null;
    resumeAccepted = false;
    createBrand.mockClear();
    updateBrand.mockClear();
    routerPush.mockClear();
    routerReplace.mockClear();
    let tree!: Renderer;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <BrandCreationFlow onComplete={jest.fn()} onCancel={jest.fn()} />,
      );
      await Promise.resolve();
    });
    expect(byText(tree.root, "This brand wasn’t found or you no longer have access. No changes were made.").length)
      .toBeGreaterThan(0);
    expect(createBrand).not.toHaveBeenCalled();
    expect(updateBrand).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
    expect(routerReplace).not.toHaveBeenCalled();
    await TestRenderer.act(async () => tree.unmount());
    searchParams = {};
  });
});
