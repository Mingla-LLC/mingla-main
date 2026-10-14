/**
 * #3827 tester-owned adversarial guard: the event and RSVP creators must not
 * hand turnout intelligence a new source merely because their parent renders
 * again with the same draft. The implementor guard attacks rapid Description
 * typing; this guard attacks the separate source-identity boundary that can
 * retrigger the ambient provider's publish effect.
 *
 * These are the real wizard components. Only their deferred provider and
 * unrelated visual/network leaves are replaced. A prop-only parent rerender
 * must preserve each provider's exact source object.
 */

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

Reflect.set(globalThis, "document", { activeElement: null });

type Node = {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: Node) => boolean) => Node[];
};
type Renderer = {
  root: Node;
  unmount: () => void;
  update: (element: React.ReactElement) => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};

function mockLeaf(name: string) {
  const ReactLocal = jest.requireActual<typeof React>("react");
  return (props: { children?: React.ReactNode }) =>
    ReactLocal.createElement(name, null, props.children);
}

jest.mock("../../intel/createDeferredTurnoutIntelProvider", () => {
  const ReactLocal = jest.requireActual<typeof React>("react");
  return {
    createDeferredTurnoutIntelProvider:
      () =>
      (props: {
        children?: React.ReactNode;
        source: unknown;
        wizard: string;
      }) =>
        ReactLocal.createElement(
          "turnout-source-probe",
          { source: props.source, wizard: props.wizard },
          props.children,
        ),
  };
});
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
  },
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: null, signOut: async () => undefined }),
}));
jest.mock("../../../wrappers/useKeyboardIsVisible", () => ({
  useKeyboardIsVisible: () => false,
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const ReactLocal = jest.requireActual<typeof React>("react");
  return {
    ScrollView: ReactLocal.forwardRef(
      (props: { children?: React.ReactNode }, ref) => {
        ReactLocal.useImperativeHandle(ref, () => ({
          scrollTo: () => undefined,
          scrollToEnd: () => undefined,
        }));
        return ReactLocal.createElement("mock-scroll", null, props.children);
      },
    ),
  };
});
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));
jest.mock("../../../hooks/useScrollToTopOnStepChange", () => ({
  useScrollToTopOnStepChange: () => undefined,
}));
jest.mock("../../../hooks/useBrandStripeStatus", () => ({
  useBrandStripeStatus: () => ({
    data: null,
    isPending: false,
    isFetching: false,
    isError: false,
  }),
}));
jest.mock("../../../hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({
    data: false,
    isPending: false,
    isFetching: false,
    isError: false,
  }),
}));
jest.mock("../../../hooks/useWizardHardwareBack", () => ({
  useWizardHardwareBack: () => undefined,
}));
jest.mock("../../../hooks/useOrganiserTermsPublishGate", () => ({
  useOrganiserTermsPublishGate: () => ({
    blockPaidPublishUntilAccepted: async () => false,
    acceptTermsAfterServerRefusal: async () => false,
    gateElement: null,
  }),
}));
jest.mock("../../../hooks/useCurrentBrand", () => {
  const brand = {
    id: "22222222-2222-4222-8222-222222223827",
    defaultCurrency: "USD",
    defaultPassTax: false,
    defaultPassMinglaFee: false,
    defaultPassServiceFee: false,
    takeRateBpsOverride: null,
  };
  return { useCurrentBrand: () => brand };
});
jest.mock("../../../hooks/useExperienceVenueDefault", () => ({
  useExperienceVenueDefault: () => ({
    hasPrefill: false,
    defaultVenue: "",
  }),
}));
jest.mock("../../../hooks/useExperienceDraftAdapter", () => {
  const whenState = {
    whenMode: "single",
    date: null,
    doorsOpen: null,
    endsAt: null,
    timezone: "America/New_York",
    recurrenceRule: null,
    multiDates: null,
  };
  return {
    useExperienceDraftAdapter: () => ({
      whenState,
      isValid: true,
      setShowErrors: () => undefined,
      toPayloadWhen: () => ({}),
      draftEvent: {},
      updateDraft: () => undefined,
      errors: [],
      showErrors: false,
    }),
  };
});
jest.mock("../../../hooks/useBrandTaxRegistration", () => ({
  useBrandTaxRegistration: () => ({
    data: { hasActiveRegistration: false },
    isPending: false,
  }),
}));
jest.mock("../../intel/useTurnoutFocusTarget", () => ({
  useTurnoutFocusTarget: () => false,
}));
jest.mock("../../../services/supabase", () => ({ supabase: {} }));
jest.mock("../../../services/postHogService", () => ({
  postHogService: { capture: () => undefined },
}));
jest.mock("../../../analytics/searchOutcome", () => ({
  captureHostSearchOutcome: () => undefined,
}));
jest.mock("../../ui/useShareNetworkState", () => ({
  useShareNetworkState: () => true,
}));
jest.mock("@mingla/brand-assets", () => ({ MINGLA_BUSINESS_LOGO: 1 }));
jest.mock("../../invites/LazyInvitePeopleStep", () => {
  const settled = { isPending: false, isFetching: false, isError: false };
  return {
    InvitePlanSummaryBridge: () => null,
    PENDING_WIZARD_INVITE_SUMMARY: {
      plan: { ...settled, data: undefined },
      quote: { ...settled, data: undefined },
      refreshAuthoritative: async () => ({ plan: null, quote: null }),
    },
    InvitePeopleStep: mockLeaf("mock-invite-step"),
    InvitePlanReviewSummary: mockLeaf("mock-invite-review"),
    InvitePeoplePublishConfirmation: mockLeaf("mock-invite-confirm"),
  };
});
jest.mock("../../ui/Button", () => ({ Button: mockLeaf("mock-button") }));
jest.mock("../../ui/ConfirmDialog", () => ({
  ConfirmDialog: mockLeaf("mock-confirm"),
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: mockLeaf("mock-glass"),
}));
jest.mock("../../ui/Icon", () => ({ Icon: mockLeaf("mock-icon") }));
jest.mock("../../ui/Input", () => ({
  Input: mockLeaf("mock-input"),
  PHONE_COUNTRIES: [],
}));
jest.mock("../../ui/IconChrome", () => ({
  IconChrome: mockLeaf("mock-icon-chrome"),
}));
jest.mock("../../ui/Stepper", () => ({
  Stepper: mockLeaf("mock-stepper"),
}));
jest.mock("../../ui/TopBar", () => ({ TopBar: mockLeaf("mock-topbar") }));
jest.mock("../../ui/Toast", () => ({ Toast: mockLeaf("mock-toast") }));
jest.mock("../../ui/Sheet", () => ({ Sheet: mockLeaf("mock-sheet") }));
jest.mock("../CreatorStep1Basics", () => ({
  CreatorStep1Basics: mockLeaf("mock-step-1"),
}));
jest.mock("../CreatorStep2When", () => ({
  CreatorStep2When: mockLeaf("mock-step-2"),
}));
jest.mock("../CreatorStep3Where", () => ({
  CreatorStep3Where: mockLeaf("mock-step-3"),
}));
jest.mock("../CreatorStep4Cover", () => ({
  CreatorStep4Cover: mockLeaf("mock-step-4"),
}));
jest.mock("../CreatorStep5Tickets", () => ({
  CreatorStep5Tickets: mockLeaf("mock-step-5"),
}));
jest.mock("../CreatorStep6Settings", () => ({
  CreatorStep6Settings: mockLeaf("mock-step-6"),
}));
jest.mock("../CreatorStep7Preview", () => ({
  CreatorStep7Preview: mockLeaf("mock-step-7"),
}));
jest.mock("../PublishErrorsSheet", () => ({
  PublishErrorsSheet: mockLeaf("mock-publish-errors"),
}));
jest.mock("../../rsvp/RsvpStep5Setup", () => ({
  RsvpStep5Setup: mockLeaf("mock-rsvp-setup"),
}));
jest.mock("../../rsvp/RsvpStep7Preview", () => ({
  RsvpStep7Preview: mockLeaf("mock-rsvp-preview"),
}));
jest.mock("../../experience/ExperienceStopsStep", () => ({
  ExperienceStopsStep: mockLeaf("mock-experience-stops"),
}));
jest.mock("../../experience/ExperiencePricingStep", () => ({
  ExperiencePricingStep: mockLeaf("mock-experience-pricing"),
}));
jest.mock("../../experience/ExperienceCoverStep", () => ({
  ExperienceCoverStep: mockLeaf("mock-experience-cover"),
}));
jest.mock("../../experience/EditAfterPublishExperienceBanner", () => ({
  EditAfterPublishExperienceBanner: mockLeaf("mock-experience-banner"),
}));
jest.mock("../../offering/StripeBlockedCard", () => ({
  StripeBlockedCard: mockLeaf("mock-stripe-blocked"),
}));
jest.mock("../../brand/PayoutCountryInlinePrompt", () => ({
  PayoutCountryInlinePrompt: mockLeaf("mock-payout-country"),
}));

// eslint-disable-next-line import/first
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// eslint-disable-next-line import/first
import { AppState } from "react-native";
// eslint-disable-next-line import/first
import {
  buildDraftEvent,
  useDraftEventStore,
  type DraftEvent,
} from "../../../store/draftEventStore";
// eslint-disable-next-line import/first
import { EventCreatorWizard } from "../EventCreatorWizard";
// eslint-disable-next-line import/first
import { RsvpCreatorWizard } from "../../rsvp/RsvpCreatorWizard";
// eslint-disable-next-line import/first
import { ExperienceCreatorWizard } from "../../experience/ExperienceCreatorWizard";

jest
  .spyOn(AppState, "addEventListener")
  .mockImplementation(() => ({ remove: () => undefined }) as never);

const BRAND_ID = "22222222-2222-4222-8222-222222223827";

const providerSource = (renderer: Renderer, wizard: string): unknown => {
  const probes = renderer.root.findAll(
    (node) =>
      node.type === "turnout-source-probe" &&
      node.props.wizard === wizard &&
      node.props.source !== undefined,
  );
  expect(probes).toHaveLength(1);
  return probes[0].props.source;
};

const queryClient = (): QueryClient =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("#3827 wizard turnout sources stay stable across unrelated rerenders", () => {
  test.each([
    ["event", "11111111-1111-4111-8111-111111113827"],
    ["rsvp", "33333333-3333-4333-8333-333333333827"],
  ] as const)("%s keeps the exact source object", async (wizard, draftId) => {
    const base = buildDraftEvent(BRAND_ID, draftId);
    useDraftEventStore.getState().upsertDraft(base as DraftEvent);
    const draft = useDraftEventStore.getState().getDraft(draftId) as DraftEvent;
    const firstExit = () => undefined;
    const secondExit = () => undefined;
    const renderWizard = (onExit: () => void): React.ReactElement => {
      const shared = {
        draft,
        brand: null,
        initialStep: 0,
        isCreateMode: false,
        onExit,
        onOpenPreview: () => undefined,
      };
      return wizard === "event" ? (
        <EventCreatorWizard
          {...shared}
          onOpenPaymentOnboarding={() => undefined}
        />
      ) : (
        <RsvpCreatorWizard {...shared} />
      );
    };

    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    const client = queryClient();
    let renderer: Renderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        <QueryClientProvider client={client}>
          {renderWizard(firstExit)}
        </QueryClientProvider>,
      );
    });
    const mounted = renderer as unknown as Renderer;
    const firstSource = providerSource(mounted, wizard);

    await TestRenderer.act(async () => {
      mounted.update(
        <QueryClientProvider client={client}>
          {renderWizard(secondExit)}
        </QueryClientProvider>,
      );
    });
    const secondSource = providerSource(mounted, wizard);

    expect(secondSource).toBe(firstSource);
    expect((secondSource as { kind: string }).kind).toBe(wizard);
    expect((secondSource as { draft: DraftEvent }).draft).toBe(draft);

    await TestRenderer.act(async () => {
      mounted.unmount();
    });
  });

  test("experience keeps its equivalent field-complete source stable", async () => {
    const firstCancel = () => undefined;
    const secondCancel = () => undefined;
    const renderWizard = (onCancel: () => void): React.ReactElement => (
      <ExperienceCreatorWizard
        brandId={BRAND_ID}
        onComplete={() => undefined}
        onCancel={onCancel}
      />
    );

    Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
    let renderer: Renderer | null = null;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(renderWizard(firstCancel));
    });
    const mounted = renderer as unknown as Renderer;
    const firstSource = providerSource(mounted, "experience");

    await TestRenderer.act(async () => {
      mounted.update(renderWizard(secondCancel));
    });
    const secondSource = providerSource(mounted, "experience");

    expect(secondSource).toBe(firstSource);
    expect((secondSource as { kind: string }).kind).toBe("experience");
    expect(Object.keys(secondSource as object).sort()).toEqual([
      "brandDefaultCurrency",
      "capacity",
      "intents",
      "isFree",
      "kind",
      "pricingMode",
      "resolvedTotalMajor",
      "stops",
      "title",
      "unlimited",
      "when",
    ]);

    await TestRenderer.act(async () => {
      mounted.unmount();
    });
  });
});
