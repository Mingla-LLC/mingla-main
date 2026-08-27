import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

import {
  BRAND_CREATION_COPY,
  BrandCreationFlow,
  brandCreationReducer,
  type BrandCreationState,
} from "../BrandCreationFlow";
import {
  OFFERING_OPTIONS,
  OfferingChooser,
  routeForOffering,
  type OfferingKind,
} from "../OfferingChooser";
import { mapUiToBrandUpdatePatch } from "../../../services/brandMapping";
import { resolveBankConnectRail } from "../../../utils/bankConnectRail";
import type { Brand } from "../../../types/brand";

// Currency selects pricing context; it never proves a bank can collect.
// Free creators stay open in every payout state.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const routerPush = jest.fn();
const createBrand = jest.fn<(input: unknown) => Promise<Brand>>();
const updateBrand = jest.fn<(input: unknown) => Promise<Brand>>();
const haptic = jest.fn();
let stripeStatus: "not_connected" | "onboarding" | "active" | "restricted" =
  "not_connected";

const BRAND: Brand = {
  id: "27190000-0000-4000-8000-000000000001",
  displayName: "Issue 2719 Lagos",
  slug: "issue2719lagos",
  address: null,
  coverHue: 25,
  accountId: "account-2719",
  role: "owner",
  stats: { events: 0, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
  currentLiveEvent: null,
  countryCode: "NG",
  paymentProvider: "paystack",
  stripeStatus: "not_connected",
};

jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => routerPush(...args),
    replace: jest.fn(),
    canGoBack: () => false,
  }),
  useLocalSearchParams: () => ({}),
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
    user: { id: "account-2719" },
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
  useUpdateCreatorAccount: () => ({
    mutateAsync: jest.fn(() => Promise.resolve(undefined)),
  }),
}));

jest.mock("../../../hooks/useBrands", () => ({
  SlugCollisionError: class SlugCollisionError extends Error {},
  useBrand: () => ({ data: null, isFetched: false, isError: false, refetch: jest.fn() }),
  useCreateBrand: () => ({
    mutateAsync: (input: unknown) => createBrand(input),
    isPending: false,
  }),
  useUpdateBrand: () => ({
    mutateAsync: (input: unknown) => updateBrand(input),
    isPending: false,
  }),
}));

jest.mock("../../../hooks/useBrandStripeStatus", () => ({
  useBrandStripeStatus: () => ({
    data: { status: stripeStatus },
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
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
}

interface Renderer {
  root: TestNode;
  unmount: () => void;
}

// react-test-renderer is installed in the required full-suite CI lane.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Renderer;
  act: (callback: () => Promise<void> | void) => Promise<void> | void;
};

const byTestId = (root: TestNode, testID: string): TestNode[] =>
  root.findAll((node) => node.props.testID === testID);

const byLabel = (root: TestNode, label: string): TestNode[] =>
  root.findAll((node) => node.props.accessibilityLabel === label);

const press = (node: TestNode): void => {
  const onPress = node.props.onPress;
  if (typeof onPress !== "function") throw new Error("Expected onPress");
  onPress({});
};

const changeText = (node: TestNode, value: string): void => {
  const onChangeText = node.props.onChangeText;
  if (typeof onChangeText !== "function") throw new Error("Expected onChangeText");
  onChangeText(value);
};

describe("#2719 payout-first brand creation happy path", () => {
  test("self creation persists resolver currency, offers an honest skip, then shows five enabled creators", async () => {
    stripeStatus = "not_connected";
    createBrand.mockResolvedValue(BRAND);
    updateBrand.mockResolvedValue({ ...BRAND, defaultCurrency: "NGN" });
    let tree!: Renderer;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <BrandCreationFlow onComplete={jest.fn()} onCancel={jest.fn()} />,
      );
    });

    await TestRenderer.act(async () => {
      changeText(byLabel(tree.root, BRAND_CREATION_COPY.step1.nameLabel)[0]!, "Issue 2719 Lagos");
    });
    await TestRenderer.act(async () => {
      press(byLabel(tree.root, BRAND_CREATION_COPY.step1.cta)[0]!);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(createBrand).toHaveBeenCalledTimes(1);
    expect(byLabel(tree.root, BRAND_CREATION_COPY.step2.skip)).toHaveLength(1);
    await TestRenderer.act(async () => {
      press(byLabel(tree.root, BRAND_CREATION_COPY.step2.skip)[0]!);
    });
    await TestRenderer.act(async () => {
      press(byLabel(tree.root, BRAND_CREATION_COPY.step3.cta)[0]!);
      await Promise.resolve();
    });

    expect(updateBrand).toHaveBeenCalledWith(
      expect.objectContaining({ patch: { defaultCurrency: "NGN" } }),
    );
    expect(byLabel(tree.root, BRAND_CREATION_COPY.step4.secondary)).toHaveLength(1);

    await TestRenderer.act(async () => {
      press(byLabel(tree.root, BRAND_CREATION_COPY.step4.secondary)[0]!);
    });
    expect(OFFERING_OPTIONS.map((option) => option.kind)).toEqual([
      "event",
      "trip",
      "experience",
      "rsvp",
      "venue",
    ]);
    for (const kind of OFFERING_OPTIONS.map((option) => option.kind)) {
      expect(byTestId(tree.root, `offering-chooser-${kind}`).length).toBeGreaterThan(0);
    }
    await TestRenderer.act(async () => tree.unmount());
  });

  test("the mounted chooser sends each exhaustive kind to its real route once", async () => {
    const routes: Record<OfferingKind, string> = {
      event: "/event/create",
      trip: "/trip/create",
      experience: "/experience/create",
      rsvp: "/rsvp/create",
      venue: "/venue/create",
    };
    for (const kind of Object.keys(routes) as OfferingKind[]) {
      const selected = jest.fn();
      let tree!: Renderer;
      await TestRenderer.act(async () => {
        tree = TestRenderer.create(
          <OfferingChooser payoutState="not-connected" onSelect={selected} />,
        );
      });
      await TestRenderer.act(async () => {
        press(byTestId(tree.root, `offering-chooser-${kind}`)[0]!);
        press(byTestId(tree.root, `offering-chooser-${kind}`)[0]!);
      });
      expect(selected).toHaveBeenCalledTimes(1);
      expect(selected).toHaveBeenCalledWith(kind);
      expect(routeForOffering(kind)).toBe(routes[kind]);
      await TestRenderer.act(async () => tree.unmount());
    }
  });

  test("ready auto-advances while the client reducer still bypasses payouts and Create", () => {
    const client: BrandCreationState = {
      step: 3,
      name: "Client brand",
      bio: "",
      address: null,
      brandId: BRAND.id,
      mode: "client",
    };
    expect(brandCreationReducer(client, { type: "next" }).step).toBe(5);
    expect(brandCreationReducer({ ...client, step: 5 }, { type: "back" }).step).toBe(3);

    const self: BrandCreationState = { ...client, mode: "self", step: 4 };
    expect(brandCreationReducer(self, { type: "next" }).step).toBe(6);
    expect(brandCreationReducer({ ...self, step: 6 }, { type: "back" }).step).toBe(4);
  });

  test("rail and mapper establish pricing context without any payout-readiness field", () => {
    expect(resolveBankConnectRail({ countryCode: "NG" }).currency).toBe("NGN");
    expect(resolveBankConnectRail({ countryCode: "US" }).currency).toBe("USD");
    expect(mapUiToBrandUpdatePatch({ defaultCurrency: "NGN" })).toEqual({
      default_currency: "NGN",
    });
  });

  test("mounted payout notices and creator labels stay truthful in every readiness state", async () => {
    const noticeTitles = {
      pending: "Payout setup submitted",
      restricted: "Payout setup needs attention",
      "unknown-error": "We couldn’t check payout status",
      offline: "You’re offline",
      loading: "Checking payout setup…",
      "permission-denied": "Payments access required",
      "not-connected": "Payouts aren’t connected",
    } as const;
    const textNodes = (root: TestNode, text: string): TestNode[] =>
      root.findAll((node) => node.props.children === text);

    for (const [payoutState, title] of Object.entries(noticeTitles)) {
      let tree!: Renderer;
      await TestRenderer.act(async () => {
        tree = TestRenderer.create(
          <OfferingChooser
            payoutState={payoutState as keyof typeof noticeTitles}
            onSelect={jest.fn()}
          />,
        );
      });
      expect(textNodes(tree.root, title).length).toBeGreaterThan(0);
      await TestRenderer.act(async () => tree.unmount());
    }

    const sharedStateLabels = [
      ["pending", "Free publishing works now. Paid features await verification."],
      ["restricted", "Free publishing works now. Paid features await verification."],
      ["unknown-error", "Free publishing works now. Check payout status before charging."],
      ["offline", "Free publishing works now. Check payout status before charging."],
      ["loading", "Free publishing works now. Payout status is still being checked before charging."],
      ["permission-denied", "Free publishing works now. Ask a payments manager before charging."],
    ] as const;
    for (const [payoutState, expectedReadiness] of sharedStateLabels) {
      let tree!: Renderer;
      await TestRenderer.act(async () => {
        tree = TestRenderer.create(
          <OfferingChooser payoutState={payoutState} onSelect={jest.fn()} />,
        );
      });
      for (const option of OFFERING_OPTIONS) {
        const expected = `Create ${option.label.toLowerCase()}. ${option.subhead} ${expectedReadiness}`;
        expect(byLabel(tree.root, expected).length).toBeGreaterThan(0);
      }
      await TestRenderer.act(async () => tree.unmount());
    }

    const notConnectedReadiness: Record<OfferingKind, string> = {
      event: "A free event can be published now. Connect a bank only for paid tickets.",
      trip: "A free trip can be published now. Connect a bank only for paid packages.",
      experience: "A free experience can be published now. Connect a bank only for paid bookings.",
      rsvp: "A free RSVP can be published now. Connect a bank only for optional chip-ins.",
      venue: "A free venue listing can be published now. Connect a bank only for paid orders or reservations.",
    };
    let tree!: Renderer;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <OfferingChooser payoutState="not-connected" onSelect={jest.fn()} />,
      );
    });
    for (const option of OFFERING_OPTIONS) {
      const expected = `Create ${option.label.toLowerCase()}. ${option.subhead} ${notConnectedReadiness[option.kind]}`;
      expect(byLabel(tree.root, expected).length).toBeGreaterThan(0);
    }
    await TestRenderer.act(async () => tree.unmount());
  });
});
