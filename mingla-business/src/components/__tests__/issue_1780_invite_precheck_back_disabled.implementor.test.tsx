/* eslint-disable import/first */
/**
 * #1780 (SPEC #3446 Amendment A1) — the on-screen Back control waits for the
 * invite pre-check.
 *
 * Tapping Publish on the final step first re-reads the saved invite plan and
 * quote (`checkingInvitePublish`), and only then opens the publish confirm
 * (Event, RSVP, Trip) or the invite confirm / publish path (Experience). Back
 * stayed tappable during that await, so the organiser could step back to the
 * Invite step and the confirm then opened THERE. Back is now disabled for the
 * length of the pre-check, in all four creators.
 *
 * Every creator is MOUNTED and driven through its own handlers:
 *   - Event, RSVP and Trip: the real component source is compiled with the
 *     TypeScript compiler and run against an explicit module boundary (the
 *     #3439 cover-timing harness pattern). Every import is classified; an
 *     unknown one fails loudly. Wizard state, handlers, invite gating and the
 *     publish pre-check all execute unchanged.
 *   - Experience: the real module is imported behind jest.mock boundaries
 *     (the #3373 harness pattern), with the invite flag on.
 * Each test reaches the final step, taps Publish while the authoritative
 * re-read is still pending, and reads the Back control's `disabled` prop:
 * enabled before, disabled during, enabled again once the pre-check settles.
 *
 * Fails on revert: remove `checkingInvitePublish` from any Back control's
 * `disabled` -> that creator's test goes red.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";
import ts from "typescript";

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Renderer {
  root: TestInstance;
  unmount: () => void;
}
// CI installs the renderer but not a separate @types package.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

// ---------------------------------------------------------------------------
// shared invite state (flag on, a settled saved plan + matching quote)
// ---------------------------------------------------------------------------

type Deferred = {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};
const mockInvite = {
  flag: { data: true, isPending: false, isFetching: false, isError: false },
  plan: {
    eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    eventType: "event",
    selectionRevision: 3,
    selectedCount: 0,
    brandPersonIds: [] as string[],
    selectionHash: "h".repeat(64),
    state: "draft",
    publishedSelectionRevision: null,
    updatedAt: null,
  },
  quote: {
    selectionRevision: 3,
    selectedCount: 0,
    reachableCount: 0,
    suppressedCount: 0,
    canReceiveCount: 0,
    skippedCount: 0,
    perChannelReachable: { email: 0, sms: 0, push: 0 },
    estimatedCostMinor: 0,
    currency: "GBP",
    quoteHash: "q".repeat(64),
    selectionHash: "h".repeat(64),
  },
  refreshes: [] as Deferred[],
  summary: null as unknown,
};
const settledIdle = { isPending: false, isFetching: false, isError: false };
mockInvite.summary = {
  plan: { ...settledIdle, data: mockInvite.plan },
  quote: { ...settledIdle, data: mockInvite.quote },
  // The authoritative pre-check: stays pending until the test settles it.
  refreshAuthoritative: (): Promise<unknown> => {
    let resolve!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<unknown>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    mockInvite.refreshes.push({ promise, resolve, reject });
    return promise;
  },
};

// ---------------------------------------------------------------------------
// module boundaries (shared by the compiled creators and the Experience import)
// ---------------------------------------------------------------------------

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
  },
}));
jest.mock("../../utils/liveEventConverter", () => ({ convertDraftToLiveEvent: () => null }));

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
const mockRpc = jest.fn<(name: string, args: Record<string, unknown>) => Promise<RpcResult>>();
const mockFrom = jest.fn<(table: string) => unknown>();
jest.mock("../../services/supabase", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args),
    from: (table: string) => mockFrom(table),
  },
}));
jest.mock("../../services/businessEvents", () => ({
  setEventGuestPrivacy: async () => undefined,
}));
jest.mock("../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));
jest.mock("../../wrappers/useKeyboardIsVisible", () => ({
  useKeyboardIsVisible: () => false,
}));
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1780" }, signOut: async () => undefined }),
}));
const mockBrand = {
  id: "brand-1780",
  defaultCurrency: "GBP",
  defaultPassTax: false,
  defaultPassMinglaFee: false,
  defaultPassServiceFee: false,
  takeRateBpsOverride: null,
  stripeStatus: "active",
};
jest.mock("../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => mockBrand,
}));
jest.mock("../../hooks/useExperienceVenueDefault", () => ({
  useExperienceVenueDefault: () => ({ hasPrefill: false, defaultVenue: "" }),
}));
jest.mock("../../hooks/useBrandTaxRegistration", () => ({
  useBrandTaxRegistration: () => ({ data: { hasActiveRegistration: false } }),
}));
jest.mock("../../hooks/useExperienceDraftAdapter", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactActual = require("react") as typeof React;
  return {
    useExperienceDraftAdapter: (
      _brandId: string,
      initialWhen?: Record<string, unknown>,
    ) => {
      const [whenState] = ReactActual.useState(() => ({
        whenMode: initialWhen?.whenMode ?? "single",
        date: initialWhen?.date ?? null,
        doorsOpen: initialWhen?.doorsOpen ?? null,
        endsAt: initialWhen?.endsAt ?? null,
        timezone: initialWhen?.timezone ?? "Europe/London",
        recurrenceRule: initialWhen?.recurrenceRule ?? null,
        multiDates: initialWhen?.multiDates ?? null,
      }));
      return {
        whenState,
        draftEvent: {},
        updateDraft: () => undefined,
        errors: [],
        showErrors: false,
        setShowErrors: () => undefined,
        isValid: true,
        toPayloadWhen: () => ({
          whenMode: whenState.whenMode,
          when: {
            date: whenState.date,
            doorsOpen: whenState.doorsOpen,
            endsAt: whenState.endsAt,
          },
          multiDates: null,
          recurrence_rules: null,
          timezone: whenState.timezone,
        }),
      };
    },
  };
});
jest.mock("../intel/createDeferredTurnoutIntelProvider", () => ({
  createDeferredTurnoutIntelProvider:
    () =>
    ({ children }: { children: React.ReactNode }) =>
      children,
}));
jest.mock("../intel/useTurnoutFocusTarget", () => ({
  useTurnoutFocusTarget: () => false,
}));
jest.mock("../intel/PrePublishIntelligenceSurfaces", () => ({
  PrePublishGateSheet: (): null => null,
}));
jest.mock("../../utils/turnoutGateAnalytics", () => ({
  shouldTrackGatePublishedAnyway: () => false,
}));
jest.mock("../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("ButtonProbe", props),
}));
jest.mock("../ui/Toast", () => ({ Toast: (): null => null }));
jest.mock("../ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../ui/Input", () => ({
  Input: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("InputProbe", props),
}));
jest.mock("../ui/Stepper", () => ({ Stepper: (): null => null }));
jest.mock("../ui/GlassCard", () => ({
  GlassCard: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("GlassCardProbe", props, props.children),
}));
jest.mock("../event/CreatorStep2When", () => ({ CreatorStep2When: (): null => null }));
jest.mock("../experience/ExperienceCoverStep", () => ({ ExperienceCoverStep: (): null => null }));
jest.mock("../experience/ExperienceStopsStep", () => ({ ExperienceStopsStep: (): null => null }));
jest.mock("../pricing/WhoCoversCostsSection", () => ({
  WhoCoversCostsSection: (): null => null,
}));
jest.mock("../offering/StripeBlockedCard", () => ({ StripeBlockedCard: (): null => null }));
jest.mock("../experience/EditAfterPublishExperienceBanner", () => ({
  EditAfterPublishExperienceBanner: (): null => null,
}));
// The #1780 invite step: the real picker loads react-native-reanimated. The
// stand-in reports a saved, ready selection, as the picker does once loaded.
jest.mock("../invites/InvitePeopleStep", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactActual = require("react") as typeof React;
  return {
    InvitePeopleStep: (props: {
      onPlanChange?: (plan: unknown, quote: unknown, navigation: unknown) => void;
    }): null => {
      ReactActual.useEffect(() => {
        props.onPlanChange?.(mockInvite.plan, mockInvite.quote, {
          phase: "ready",
          primaryLabel: "Skip invites",
          blocked: false,
          retry: () => undefined,
        });
      }, []);
      return null;
    },
    InvitePeoplePublishConfirmation: (): null => null,
    InvitePlanReviewSummary: (): null => null,
  };
});
jest.mock("../../hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => mockInvite.flag,
}));
jest.mock("../../hooks/useOfferingInvitePlan", () => ({
  useOfferingInvitePlanSummary: () => mockInvite.summary,
}));
jest.mock("../../hooks/useWizardHardwareBack", () => ({
  useWizardHardwareBack: (): void => undefined,
}));

import * as designSystem from "../../constants/designSystem";
import * as desktopLayout from "../../constants/desktopLayout";
import { buildDraftEvent, useDraftEventStore, type DraftEvent } from "../../store/draftEventStore";
import {
  ExperienceCreatorWizard,
  type ExperienceWizardInitialDraft,
} from "../experience/ExperienceCreatorWizard";

// ---------------------------------------------------------------------------
// compiled-creator loader (Event, RSVP, Trip)
// ---------------------------------------------------------------------------

const leaf = (name: string) => {
  const Leaf = (props: Record<string, unknown>): React.ReactElement =>
    React.createElement(name, props, props.children as React.ReactNode);
  Leaf.displayName = name;
  return Leaf;
};
const ScrollViewLeaf = React.forwardRef((props: Record<string, unknown>, _ref) =>
  React.createElement("ScrollView", props, props.children as React.ReactNode),
);
ScrollViewLeaf.displayName = "ScrollView";

const asyncNoop = async (): Promise<undefined> => undefined;
const mutation = { mutateAsync: async () => ({ ticketTypeId: "tt-1780" }), isPending: false };
const intakeQuery = { data: undefined };
const stripeStatusQuery = { data: { status: "active" } };

/** Wizard import specifier (by its last path segment) -> module the test supplies. */
const BOUNDARY: Record<string, () => unknown> = {
  react: () => React,
  "react-native": () => jest.requireActual("react-native"),
  "expo-router": () => jest.requireMock("expo-router"),
  "react-native-safe-area-context": () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  }),
  "@mingla/brand-assets": () => ({ MINGLA_BUSINESS_LOGO: 1 }),
  SmartScrollView: () => ({ ScrollView: ScrollViewLeaf }),
  useKeyboardIsVisible: () => jest.requireMock("../../wrappers/useKeyboardIsVisible"),
  AuthContext: () => jest.requireMock("../../context/AuthContext"),
  designSystem: () => designSystem,
  desktopLayout: () => desktopLayout,
  useResponsiveLayout: () => ({ useResponsiveLayout: () => ({ isWideDesktop: false }) }),
  // #3409 added this to all four creator wizards. Supply the REAL hook: it
  // only scrolls a ref to the top when the step index changes, so it is inert
  // here (the ScrollView leaf has no scrollTo) and the boundary stays honest.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  useScrollToTopOnStepChange: () => require("../../hooks/useScrollToTopOnStepChange"),
  useServerCoverAdoption: () => ({ useServerCoverAdoption: () => ({ isReady: true }) }),
  draftEventStore: () => ({ buildDraftEvent, useDraftEventStore }),
  draftEventValidation: () => ({
    validatePublish: () => [],
    validateStep: () => [],
    computePublishability: () => ({ status: "ready" }),
  }),
  draftRsvpValidation: () => ({ validateRsvpPublish: () => [], validateRsvpStep: () => [] }),
  draftEventPristine: () => ({ isDraftEventPristine: () => false }),
  brandPayout: () => ({ payoutGateStatus: () => "active" }),
  paidPublishGuards: () => ({
    describeUnmappedPublishGuard: () => null,
    resolveProviderNeutralPaidPublishGuardCopy: () => null,
    resolvePaidPublishGuardCopy: () => null,
    brandPaymentOnboardingRoute: () => "/payments",
  }),
  refundPolicyTerms: () => ({ OfferingRefundTermsError: class extends Error {} }),
  recurrenceRule: () => ({ expandRecurrenceToDates: () => [] }),
  useBrandStripeStatus: () => ({ useBrandStripeStatus: () => stripeStatusQuery }),
  rsvpRpcFailure: () => ({ readRpcFailureMessage: () => "", rsvpRpcFailureCopy: () => "" }),
  chipInPayoutReadiness: () => ({ isChipInPayoutReady: () => true }),
  Button: () => jest.requireMock("../ui/Button"),
  GlassCard: () => jest.requireMock("../ui/GlassCard"),
  Icon: () => jest.requireMock("../ui/Icon"),
  Stepper: () => jest.requireMock("../ui/Stepper"),
  Toast: () => jest.requireMock("../ui/Toast"),
  ConfirmDialog: () => ({ ConfirmDialog: leaf("ConfirmDialog") }),
  IconChrome: () => ({ IconChrome: leaf("IconChrome") }),
  TopBar: () => ({ TopBar: leaf("TopBar") }),
  createDeferredTurnoutIntelProvider: () =>
    jest.requireMock("../intel/createDeferredTurnoutIntelProvider"),
  InvitePeopleStep: () => jest.requireMock("../invites/InvitePeopleStep"),
  // #1780 [bundle budget] — the wizards now take the invite surfaces from their
  // lazy owner. Same stand-in, reachable under the new specifier: this suite's
  // subject is the pre-check Back rule, not which chunk the step arrives in.
  LazyInvitePeopleStep: () => jest.requireMock("../invites/InvitePeopleStep"),
  useOfferingInvitePlan: () => jest.requireMock("../../hooks/useOfferingInvitePlan"),
  useFeatureFlag: () => jest.requireMock("../../hooks/useFeatureFlag"),
  useWizardHardwareBack: () => jest.requireMock("../../hooks/useWizardHardwareBack"),
  // Trip
  useTrips: () => ({
    useUpdateTripBasics: () => mutation,
    useUpsertTripDays: () => mutation,
    useUpsertTripInclusions: () => mutation,
    useUpdateTripPricing: () => mutation,
    useCreateTripPricingTier: () => mutation,
    useRemoveTripPricingTier: () => mutation,
    usePublishTrip: () => mutation,
  }),
  useRefundPolicy: () => ({
    useUpdateBookingDeadline: () => mutation,
    useUpdateRefundPolicy: () => mutation,
  }),
  tripsService: () => ({ setTripPricingSwitches: asyncNoop }),
  businessEvents: () => ({ setEventGuestPrivacy: asyncNoop }),
  offeringTheme: () => ({
    normalizeThemeOverrides: (value: unknown) => value ?? null,
    patchOfferingTheme: asyncNoop,
  }),
  tripLocationValidated: () => ({
    departureLocationValidated: () => true,
    destinationLocationValidated: () => true,
  }),
  TripCreatorStep4Pricing: () => ({
    TripCreatorStep4Pricing: leaf("TripCreatorStep4Pricing"),
    makePackageKey: () => "package-1780",
  }),
  tripPackagesValidation: () => ({ validateTripPackages: () => ({ ok: true, reason: null }) }),
  TripCreatorStep5Review: () => ({
    TripCreatorStep5Review: leaf("TripCreatorStep5Review"),
    mapPublishErrorToState: () => null,
  }),
  publishStripeReadiness: () => ({
    offeringNeedsStripeToPublish: () => false,
    tripDraftIsPaid: () => false,
  }),
  useIntakeSchema: () => ({
    useTripIntakeSchemasByEvent: () => intakeQuery,
    useUpsertTripIntakeSchema: () => mutation,
  }),
};
const STEP_LEAF =
  /^(CreatorStep\d\w+|RsvpStep\d\w+|PublishErrorsSheet|TripCreatorStep(1Basics|2Itinerary|3Inclusions|5Policy|6Intake))$/;

function loadCompiledCreator(relative: string, exportName: string): React.ComponentType<Record<string, unknown>> {
  const file = path.resolve(__dirname, "..", relative);
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const boundaryRequire = (specifier: string): unknown => {
    const key = specifier.split("/").pop() as string;
    const supply = BOUNDARY[specifier] ?? BOUNDARY[key];
    if (supply !== undefined) return supply();
    if (STEP_LEAF.test(key)) return { [key]: leaf(key) };
    throw new Error(`Unclassified creator boundary in ${exportName}: ${specifier}`);
  };
  const module = { exports: {} as Record<string, React.ComponentType<Record<string, unknown>>> };
  new Function("require", "module", "exports", output)(boundaryRequire, module, module.exports);
  return module.exports[exportName];
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const mounted: Renderer[] = [];
const mount = async (element: React.ReactElement): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(element);
  });
  mounted.push(tree);
  return tree;
};
const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};
const buttons = (tree: Renderer, label: string): TestInstance[] =>
  tree.root.findAll((node) => node.type === "ButtonProbe" && node.props.label === label);
const press = async (node: TestInstance): Promise<void> => {
  await act(async () => {
    (node.props.onPress as () => void)();
  });
  await settle();
};
const pressLabel = async (tree: Renderer, label: string): Promise<void> => {
  const found = buttons(tree, label);
  expect(found).toHaveLength(1);
  await press(found[0]);
};
/** Settle the pending authoritative re-read (its failure path shows a toast). */
const settlePreCheck = async (): Promise<void> => {
  expect(mockInvite.refreshes).toHaveLength(1);
  await act(async () => {
    const pending = mockInvite.refreshes[0];
    pending.reject(new Error("offline"));
    await pending.promise.catch(() => undefined);
  });
  await settle();
};

const EVENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const seedDraft = (isRsvp: boolean): DraftEvent => {
  const draft = {
    ...buildDraftEvent("brand-1780", EVENT_ID, "2030-06-01T00:00:00Z"),
    serverSlug: "draft-1780",
    isRsvp,
    name: "Acceptance Event",
  };
  useDraftEventStore.setState({ drafts: [draft], draftEditMeta: {} });
  return draft;
};

/**
 * The shared assertion: Back is enabled on the final step, disabled for the
 * whole pre-check that Publish starts, and enabled again once it settles.
 */
const expectBackWaitsForPreCheck = async (
  tree: Renderer,
  back: () => TestInstance,
  publish: () => TestInstance,
): Promise<void> => {
  expect(back().props.disabled ?? false).toBe(false);
  expect(publish().props.disabled ?? false).toBe(false);

  await press(publish());
  // The pre-check is in flight: Publish shows its spinner…
  expect(mockInvite.refreshes).toHaveLength(1);
  expect(publish().props.loading).toBe(true);
  // …and Back cannot step to the Invite step underneath it.
  expect(back().props.disabled).toBe(true);

  await settlePreCheck();
  expect(publish().props.loading ?? false).toBe(false);
  expect(back().props.disabled ?? false).toBe(false);
  expect(tree.root).toBeDefined();
};

beforeEach(() => {
  mockInvite.refreshes.length = 0;
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: { event: { id: EVENT_ID } }, error: null });
  mockFrom.mockReset();
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  mockFrom.mockImplementation(() => chain);
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
});

// ---------------------------------------------------------------------------

describe("#1780 A1 — on-screen Back waits for the invite pre-check", () => {
  test("Event: the Preview dock Back is disabled while Publish re-reads the invite plan", async () => {
    const EventCreatorWizard = loadCompiledCreator("event/EventCreatorWizard.tsx", "EventCreatorWizard");
    const draft = seedDraft(false);
    const tree = await mount(
      <EventCreatorWizard
        draft={draft}
        brand={null}
        isCreateMode={false}
        initialStep={7}
        onExit={jest.fn()}
        onOpenPreview={jest.fn()}
        onOpenPaymentOnboarding={jest.fn()}
      />,
    );
    await settle();
    await expectBackWaitsForPreCheck(
      tree,
      () => buttons(tree, "Back")[0],
      () => buttons(tree, "Publish event")[0],
    );
  });

  test("RSVP: the Preview dock Back is disabled while Publish re-reads the invite plan", async () => {
    const RsvpCreatorWizard = loadCompiledCreator("rsvp/RsvpCreatorWizard.tsx", "RsvpCreatorWizard");
    const draft = seedDraft(true);
    const tree = await mount(
      <RsvpCreatorWizard
        draft={draft}
        brand={null}
        isCreateMode={false}
        initialStep={6}
        onExit={jest.fn()}
        onOpenPreview={jest.fn()}
      />,
    );
    await settle();
    await expectBackWaitsForPreCheck(
      tree,
      () => buttons(tree, "Back")[0],
      () => buttons(tree, "Publish RSVP")[0],
    );
  });

  test("Trip: the Review dock Back is disabled while Publish re-reads the invite plan", async () => {
    const TripCreatorWizard = loadCompiledCreator("trip/TripCreatorWizard.tsx", "TripCreatorWizard");
    const trip = {
      id: EVENT_ID,
      brandId: "brand-1780",
      title: "Acceptance Trip",
      timezone: "Europe/London",
      coverMediaUrl: null,
      coverMediaType: null,
      coverGallery: [],
      themeOverrides: null,
      businessTrip: {
        startAt: "2030-06-01T09:00:00Z",
        endAt: "2030-06-01T18:00:00Z",
        destinationPlaceId: "dest",
        destinationLocationText: "Brighton",
        destinationLat: 50.82,
        destinationLng: -0.14,
        departurePlaceId: "dep",
        departureLocationText: "London",
        departureLat: 51.5,
        departureLng: -0.12,
        capacity: 10,
      },
      days: [{ ordinal: 1, title: "Day 1", narrative: null, media: [] }],
      inclusions: [],
      pricingTiers: [
        {
          id: "tier-1780",
          eventId: EVENT_ID,
          ticketTypeId: "tt-1780",
          tierName: "Standard",
          tierMetadata: {},
          priceCents: 0,
          currency: "GBP",
          quantityTotal: 10,
          ticketsRemaining: 10,
          isUnlimited: false,
          installmentSchedule: null,
          description: null,
        },
      ],
      pricingSwitches: { passTax: null, passMinglaFee: null, passServiceFee: null },
      guestPrivacy: { privateGuestList: false, hideRemainingCount: false },
      refundPolicy: null,
      bookingDeadline: null,
      ticketsSoldCount: 0,
    };
    const tree = await mount(
      <TripCreatorWizard
        trip={trip}
        brand={{ id: "brand-1780", slug: "acceptance", name: "Acceptance" }}
        onPublished={jest.fn()}
        onExit={jest.fn()}
      />,
    );
    await settle();
    // Steps 1-7 through the wizard's own Continue (each autosaves first).
    for (let step = 1; step < 8; step += 1) {
      await pressLabel(tree, step === 7 ? "Skip invites" : "Continue");
    }
    expect(buttons(tree, "Publish trip")).toHaveLength(1);
    await expectBackWaitsForPreCheck(
      tree,
      () => buttons(tree, "Back")[0],
      () => buttons(tree, "Publish trip")[0],
    );
  });

  test("Experience: the header Back is disabled while Publish re-reads the invite plan", async () => {
    const stop = (i: number) => ({
      clientId: `stop-${i}`,
      placeId: `place-${i}`,
      placeName: `Stop ${i}`,
      address: `${i} High Street, London`,
      city: "London",
      region: null,
      countryCode: "GB",
      lat: 51.5 + i / 100,
      lng: -0.12,
      coordinatePrecision: "exact" as const,
      imageUrls: [],
      startTime: null,
      priceMajor: "0",
      description: `Stop ${i} is a lovely place to be.`,
    });
    const initialDraft: ExperienceWizardInitialDraft = {
      title: "Acceptance Walk",
      description: "Three stops, one great evening of food.",
      intents: ["group-fun"] as never,
      locationMode: "single",
      pricingMode: "whole",
      stops: [stop(1), stop(2)] as never,
      wholePriceMajor: "0.00",
      isFree: true,
      capacity: "20",
      unlimited: false,
      pricingSwitches: { passTax: null, passMinglaFee: null, passServiceFee: null },
      when: {
        whenMode: "single",
        date: "2030-06-01",
        doorsOpen: "19:00",
        endsAt: "22:00",
        timezone: "Europe/London",
        recurrenceRule: null,
        multiDates: null,
      },
    };
    const tree = await mount(
      <ExperienceCreatorWizard
        brandId="brand-1780"
        onComplete={jest.fn()}
        onCancel={jest.fn()}
        existingExperienceId={EVENT_ID}
        initialDraft={initialDraft}
      />,
    );
    await settle();
    // Identity -> Stops -> When -> Pricing -> Cover -> Invite -> Review.
    for (let step = 1; step < 7; step += 1) {
      await pressLabel(tree, step === 6 ? "Skip invites" : "Continue");
    }
    const header = (): TestInstance => {
      const found = tree.root.findAll(
        (node) => node.type === "Pressable" && node.props.accessibilityLabel === "Back",
      );
      expect(found).toHaveLength(1);
      return found[0];
    };
    const publish = (): TestInstance => {
      const found = tree.root.findAll(
        (node) => node.type === "ButtonProbe" && node.props.testID === "experience-footer-publish",
      );
      expect(found).toHaveLength(1);
      return found[0];
    };
    await expectBackWaitsForPreCheck(tree, header, publish);
  });
});
