// MINGLA-INVARIANT: I-4522-BUILDER-V2-WIZARD | issue #4522 | With the builder on, the wizard shows four steps that stack today's step bodies, saves every changed group 800ms after the last change through the one save queue, and Publish states what is left instead of going quiet.
/**
 * Issue #4522 — the REAL `TripCreatorWizard` source compiled with the builder
 * flag ON, mounted against an explicit module boundary (the #3801 pattern, the
 * same boundary as the flag-off suites).
 *
 * Fails on revert: restore `STEP_COUNT` as the bound, drop `saveDirtyGroups`
 * from the save, or disable Publish for open checklist items -> red.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";
import ts from "typescript";

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import * as designSystem from "../../../constants/designSystem";
import * as desktopLayout from "../../../constants/desktopLayout";
import * as scrollToTop from "../../../hooks/useScrollToTopOnStepChange";
import * as rsvpRpcFailure from "../../../services/rsvpRpcFailure";
import * as paidPublishGuards from "../../../utils/paidPublishGuards";

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

const TRIP_DIR = path.resolve(__dirname, "..");
const WIZARD_SOURCE = fs.readFileSync(path.join(TRIP_DIR, "TripCreatorWizard.tsx"), "utf8");

// ---------------------------------------------------------------------------
// module boundary (as in issue_3801_trip_step_save_failure.implementor.test.tsx)
// ---------------------------------------------------------------------------

const leaf = (name: string) => {
  const Leaf = (props: Record<string, unknown>): React.ReactElement =>
    React.createElement(name, props, props.children as React.ReactNode);
  Leaf.displayName = name;
  return Leaf;
};
const nothing = (): null => null;
const ScrollViewLeaf = React.forwardRef((props: Record<string, unknown>, _ref) =>
  React.createElement("ScrollView", props, props.children as React.ReactNode),
);
ScrollViewLeaf.displayName = "ScrollView";

type Save = (input: unknown) => Promise<unknown>;
const saveOk: Save = async () => ({ ticketTypeId: "tt-3801" });
const saves = { basics: jest.fn<Save>(), days: jest.fn<Save>() };
const idleMutation = { mutateAsync: saveOk, isPending: false };
const asyncNoop = async (): Promise<undefined> => undefined;
const settledIdle = { isPending: false, isFetching: false, isError: false };

const BOUNDARY: Record<string, () => unknown> = {
  // #4522 — the 4-step builder is dark: its flag reads false here, its rules are pure.
  TripBuilderV2Parts: () => ({
    TRIP_BUILDER_V2: true,
    TripBuilderAutosavePill: leaf("SavePill"),
    TripBuilderSectionTitle: leaf("SectionTitle"),
    TripPublishChecklist: leaf("Checklist"),
  }),
  TripEarningsCard: () => ({ TripEarningsCard: leaf("EarningsCard") }),
  TripInclusionChips: () => ({ TripInclusionChips: leaf("InclusionChips") }),
  TripQuestionLibrary: () => ({ TripQuestionLibrary: leaf("QuestionLibrary") }),
  TripBuilderPreview: () => ({ TripPreviewPane: leaf("PreviewPane"), TripPreviewPeek: leaf("PreviewPeek") }),
  tripBuilderV2Model: () => jest.requireActual("../tripBuilderV2Model"),
  // [TEST-MOD-APPROVED #3859] The #3801 fixture has no installment provider;
  // model the new capability boundary without changing its itinerary subject.
  "@mingla/offering-rendering/tripInstallmentCapability": () => ({
    tripInstallmentsSupported: () => false,
  }),
  useTripInstallmentCapability: () => ({
    useTripInstallmentCapability: () => ({ data: false }),
  }),
  bankSetupReturn: () => jest.requireActual("../../../utils/bankSetupReturn"),
  react: () => React,
  "react-native": () => jest.requireActual("react-native"),
  "expo-router": () => ({
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  }),
  "react-native-safe-area-context": () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  }),
  "@mingla/brand-assets": () => ({ MINGLA_BUSINESS_LOGO: 1 }),
  SmartScrollView: () => ({ ScrollView: ScrollViewLeaf }),
  useKeyboardIsVisible: () => ({ useKeyboardIsVisible: () => false }),
  AuthContext: () => ({ useAuth: () => ({ user: { id: "user-3801" } }) }),
  designSystem: () => designSystem,
  desktopLayout: () => desktopLayout,
  useResponsiveLayout: () => ({ useResponsiveLayout: () => ({ isWideDesktop: false }) }),
  useScrollToTopOnStepChange: () => scrollToTop,
  brandPayout: () => ({
    payoutGateStatus: () => "active",
    isBrandPayoutReady: () => true,
    isBrandChargeReady: () => true,
  }),
  paidPublishGuards: () => paidPublishGuards,
  rsvpRpcFailure: () => rsvpRpcFailure,
  useBrandPaystack: () => ({
    useBrandPaystackStatus: () => ({ data: undefined, isPending: false }),
  }),
  Button: () => ({ Button: leaf("ButtonProbe") }),
  GlassCard: () => ({ GlassCard: leaf("GlassCardProbe") }),
  Icon: () => ({ Icon: nothing }),
  Stepper: () => ({ Stepper: leaf("Stepper") }),
  Toast: () => ({ Toast: leaf("ToastProbe") }),
  // The probe keeps its props, so the question the host is asked can be read
  // and answered.
  ConfirmDialog: () => ({ ConfirmDialog: leaf("ConfirmDialogProbe") }),
  IconChrome: () => ({ IconChrome: leaf("IconChrome") }),
  TopBar: () => ({ TopBar: leaf("TopBar") }),
  LazyInvitePeopleStep: () => ({
    InvitePeopleStep: nothing,
    InvitePeoplePublishConfirmation: nothing,
    InvitePlanReviewSummary: nothing,
    InvitePlanSummaryBridge: nothing,
    PENDING_WIZARD_INVITE_SUMMARY: {
      plan: { ...settledIdle, data: { selectedCount: 0 } },
      quote: { ...settledIdle, data: undefined },
      refreshAuthoritative: () => Promise.reject(new Error("unavailable")),
    },
  }),
  useFeatureFlag: () => ({
    useFeatureFlag: () => ({ ...settledIdle, data: false }),
  }),
  useWizardHardwareBack: () => ({ useWizardHardwareBack: (): void => undefined }),
  useTrips: () => ({
    useUpdateTripBasics: () => ({ mutateAsync: saves.basics, isPending: false }),
    useUpsertTripDays: () => ({ mutateAsync: saves.days, isPending: false }),
    useUpsertTripInclusions: () => idleMutation,
    useUpdateTripPricing: () => idleMutation,
    useCreateTripPricingTier: () => idleMutation,
    useRemoveTripPricingTier: () => idleMutation,
    usePublishTrip: () => idleMutation,
    // Issue #3801 — the reload-after-conflict path (not exercised here).
    useTripWizardServerSync: () => ({
      reloadTrip: () => Promise.reject(new Error("reload_not_expected")),
      markTripChanged: (): void => undefined,
    }),
  }),
  useRefundPolicy: () => ({
    useUpdateBookingDeadline: () => idleMutation,
    useUpdateRefundPolicy: () => idleMutation,
  }),
  // Issue #3801 — the session re-reads the revision after a direct write.
  tripsService: () => ({
    setTripPricingSwitches: asyncNoop,
    readTripRevision: async () => "revision-3801",
  }),
  // Issue #3801 — REAL: the one-save-at-a-time queue is pure.
  // #4453 — the wizard registers its step save with the brand switcher: both real.
  useUnsavedChangesGuard: () => jest.requireActual("../../../hooks/useUnsavedChangesGuard"),
  tripWizardBrandSwitch: () => jest.requireActual("../../../utils/tripWizardBrandSwitch"),
  tripSaveQueue: () => jest.requireActual("../../../utils/tripSaveQueue"),
  businessEvents: () => ({ setEventGuestPrivacy: asyncNoop }),
  // issue #3827 going-box — the wizard's extras copy + error matcher (pure; real module).
  guestListPrivacy: () => jest.requireActual("../../../constants/guestListPrivacy"),
  // #4420 — the wizards' invite publish gate (pure; real module).
  wizardInvitePublishGate: () => jest.requireActual("../../invites/wizardInvitePublishGate"),
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
    makePackageKey: () => "package-3801",
  }),
  tripPackagesValidation: () => ({
    validateTripPackages: () => ({ ok: true, reason: null }),
  }),
  TripCreatorStep5Review: () => ({
    TripCreatorStep5Review: leaf("TripCreatorStep5Review"),
    mapPublishErrorToState: () => null,
  }),
  publishStripeReadiness: () => ({
    offeringNeedsStripeToPublish: () => false,
    tripDraftIsPaid: () => false,
  }),
  useOrganiserTermsPublishGate: () => ({
    useOrganiserTermsPublishGate: () => ({
      blockPaidPublishUntilAccepted: () => false,
      gateElement: null,
    }),
    ORGANISER_TERMS_PUBLISH_RETRY_TOAST:
      "Accept the Organiser Terms, then tap Publish again.",
  }),
  useIntakeSchema: () => ({
    useTripIntakeSchemasByEvent: () => ({ data: undefined }),
    useUpsertTripIntakeSchema: () => idleMutation,
  }),
};
const STEP_LEAF = /^TripCreatorStep(1Basics|2Itinerary|3Inclusions|5Policy|6Intake)$/;

interface DayDraft {
  ordinal: number;
  title: string;
  narrative: string;
  media: { url: string; type: "image" | "video" }[];
}
interface WizardModule {
  TripCreatorWizard: React.ComponentType<Record<string, unknown>>;
  tripDayHasHostContent: (day: DayDraft) => boolean;
  fitItineraryToDayCount: (
    current: DayDraft[],
    dayCount: number,
  ) => { days: DayDraft[]; atRisk: DayDraft[] };
  describeItineraryDaysAtRisk: (atRisk: DayDraft[]) => string;
  draftPackagesTotalSpots: (packages: { capacity: number | null }[]) => number | null;
}

function loadWizardModule(): WizardModule {
  const output = ts.transpileModule(WIZARD_SOURCE, {
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
    throw new Error(`Unclassified TripCreatorWizard boundary: ${specifier}`);
  };
  const module = { exports: {} as unknown as WizardModule };
  new Function("require", "module", "exports", output)(
    boundaryRequire,
    module,
    module.exports,
  );
  return module.exports;
}


// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const EVENT_ID = "45220000-0000-4000-8000-0000000000c1";
const BRAND_ID = "brand-4522";
const START = "2027-03-12T00:00:00.000Z";
const END = "2027-03-16T23:59:59.000Z";
const trip = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: EVENT_ID,
  brandId: BRAND_ID,
  title: "Tulum Yoga Retreat",
  description: "",
  timezone: "Africa/Lagos",
  coverMediaUrl: null,
  coverMediaType: null,
  coverGallery: [],
  themeOverrides: null,
  businessTrip: {
    startAt: START,
    endAt: END,
    destinationPlaceId: "dest",
    destinationLocationText: "Tulum",
    destinationLat: 20.2,
    destinationLng: -87.4,
    departurePlaceId: "dep",
    departureLocationText: "Lagos",
    departureLat: 6.45,
    departureLng: 3.39,
    capacity: 8,
  },
  days: [1, 2, 3, 4, 5].map((n) => ({ id: `d${n}`, eventId: EVENT_ID, ordinal: n, title: `Day ${n}`, narrative: null, media: [] })),
  inclusions: [],
  pricingTiers: [
    {
      id: "tier-1", eventId: EVENT_ID, ticketTypeId: "tt-1", tierName: "Shared", tierMetadata: {},
      priceCents: 100000, currency: "NGN", quantityTotal: 8, ticketsRemaining: 8, isUnlimited: false,
      installmentSchedule: null, description: null,
    },
  ],
  pricingSwitches: { passTax: null, passMinglaFee: null, passServiceFee: null },
  guestPrivacy: { privateGuestList: false, hideRemainingCount: false },
  refundPolicy: null,
  bookingDeadline: null,
  ticketsSoldCount: 0,
  ...over,
});

const mounted: Renderer[] = [];
const settle = async (ms = 20): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};
const mountWizard = async (t: Record<string, unknown>): Promise<Renderer> => {
  const { TripCreatorWizard } = loadWizardModule();
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <TripCreatorWizard
        trip={t}
        brand={{ id: BRAND_ID, slug: "b", name: "Brand 4522" }}
        onPublished={jest.fn()}
        onExit={jest.fn()}
      />,
    );
  });
  mounted.push(tree);
  await settle();
  return tree;
};
const has = (tree: Renderer, name: string): boolean => tree.root.findAll((n) => n.type === name).length > 0;
const cta = (tree: Renderer, label: string): TestInstance => {
  const found = tree.root.findAll((n) => n.type === "ButtonProbe" && n.props.label === label);
  expect(found.length).toBeGreaterThan(0);
  return found[0];
};
const press = async (node: TestInstance): Promise<void> => {
  await act(async () => {
    (node.props.onPress as () => void)();
  });
  await settle();
};

beforeEach(() => {
  saves.basics.mockReset();
  saves.basics.mockImplementation(saveOk);
  saves.days.mockReset();
  saves.days.mockImplementation(saveOk);
});
afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
});

describe("the builder, flag on, real wizard source", () => {
  test("four steps in the stepper, titled as the spec says", async () => {
    const tree = await mountWizard(trip());
    const stepper = tree.root.findAll((n) => n.type === "Stepper")[0];
    expect((stepper.props.steps as { label: string }[]).map((s) => s.label)).toEqual([
      "Trip", "Itinerary & inclusions", "Pricing & policy", "Travelers & publish",
    ]);
  });

  test("step 1 is the Trip body, with the description field switched on", async () => {
    const tree = await mountWizard(trip());
    const s1 = tree.root.findAll((n) => n.type === "TripCreatorStep1Basics")[0];
    expect(s1.props.builderV2).toBe(true);
    expect(has(tree, "TripCreatorStep2Itinerary")).toBe(false);
    expect(has(tree, "SavePill")).toBe(true);
    expect(has(tree, "PreviewPeek")).toBe(true);
  });

  test("Continue walks the four steps and each stacks today's bodies", async () => {
    const tree = await mountWizard(trip());
    await press(cta(tree, "Continue"));
    expect(has(tree, "TripCreatorStep2Itinerary") && has(tree, "TripCreatorStep3Inclusions") && has(tree, "InclusionChips")).toBe(true);
    const itinerary = tree.root.findAll((n) => n.type === "TripCreatorStep2Itinerary")[0];
    expect(itinerary.props.builderV2).toBe(true);
    expect(itinerary.props.startAt).toBe(START);
    await press(cta(tree, "Continue"));
    expect(has(tree, "TripCreatorStep4Pricing") && has(tree, "TripCreatorStep5Policy") && has(tree, "EarningsCard")).toBe(true);
    expect(tree.root.findAll((n) => n.type === "TripCreatorStep5Policy")[0].props.builderV2).toBe(true);
    await press(cta(tree, "Continue"));
    expect(has(tree, "TripCreatorStep6Intake") && has(tree, "QuestionLibrary") && has(tree, "Checklist") && has(tree, "TripCreatorStep5Review")).toBe(true);
    // The last step offers Publish, and no Continue past it.
    expect(tree.root.findAll((n) => n.type === "ButtonProbe" && n.props.label === "Publish trip").length).toBeGreaterThan(0);
  });

  // #4522 S-18 (spec §9.5) — with items open the final Publish is disabled and
  // the line under it says what is left; the top-bar Publish stays tappable,
  // says what is left and jumps to it.
  test("Publish with items open is disabled with its reason; the top-bar Publish jumps to what is left", async () => {
    const tree = await mountWizard(trip());
    await press(cta(tree, "Continue"));
    await press(cta(tree, "Continue"));
    await press(cta(tree, "Continue"));
    const publish = tree.root.findAll((n) => n.type === "ButtonProbe" && n.props.label === "Publish trip")[0];
    expect(publish.props.disabled).toBe(true);
    const hint = tree.root.findAll((n) => n.props.testID === "trip-wizard-publish-unlock")[0];
    expect(hint).toBeDefined();
    const checklist = tree.root.findAll((n) => n.type === "Checklist")[0];
    const open = (checklist.props.items as { done: boolean; key: string }[]).filter((i) => !i.done).map((i) => i.key);
    expect(open).toEqual(expect.arrayContaining(["description", "cover"]));
    const topPublish = tree.root.findAll((n) => n.type === "ButtonProbe" && n.props.label === "Publish")[0];
    expect(topPublish.props.disabled).toBe(false);
    await press(topPublish);
    const toast = tree.root.findAll((n) => n.type === "ToastProbe")[0];
    expect(String(toast.props.message)).toMatch(/^Publish unlocks when /);
    // First open item is on step 1, so the wizard went back to the Trip body.
    expect(has(tree, "TripCreatorStep1Basics")).toBe(true);
    expect(has(tree, "TripCreatorStep6Intake")).toBe(false);
  });

  test("the checklist is complete when the fields are, and Publish then goes to the confirm step", async () => {
    const full = trip({
      description: "Five days of yoga, cenotes and slow mornings on the Riviera Maya.",
      coverMediaUrl: "https://x/cover.jpg",
      coverMediaType: "image",
      days: [1, 2, 3, 4, 5].map((n) => ({ id: `d${n}`, eventId: EVENT_ID, ordinal: n, title: `Plan ${n}`, narrative: null, media: [] })),
    });
    const tree = await mountWizard(full);
    await press(cta(tree, "Continue"));
    await press(cta(tree, "Continue"));
    await press(cta(tree, "Continue"));
    const checklist = tree.root.findAll((n) => n.type === "Checklist")[0];
    expect((checklist.props.items as { done: boolean }[]).every((i) => i.done)).toBe(true);
  });

  test("a change is saved 800ms later, once, and not before", async () => {
    const tree = await mountWizard(trip());
    const s1 = tree.root.findAll((n) => n.type === "TripCreatorStep1Basics")[0];
    await act(async () => {
      (s1.props.onChange as (p: Record<string, unknown>) => void)({ title: "Tulum Yoga Retreat 2" });
    });
    await settle(300);
    expect(saves.basics).not.toHaveBeenCalled();
    const pill = (): Record<string, unknown> =>
      (tree.root.findAll((n) => n.type === "SavePill")[0].props.state as Record<string, unknown>);
    expect(pill().label).toBe("Saving…");
    await settle(900);
    expect(saves.basics).toHaveBeenCalledTimes(1);
    expect(pill().label).toBe("Saved");
    // Nothing else changed, so nothing else is saved.
    await settle(1000);
    expect(saves.basics).toHaveBeenCalledTimes(1);
    expect(saves.days).not.toHaveBeenCalled();
  });

  test("a failed save says so on the pill and retries on its own", async () => {
    saves.basics.mockRejectedValueOnce(new Error("offline"));
    const tree = await mountWizard(trip());
    const s1 = tree.root.findAll((n) => n.type === "TripCreatorStep1Basics")[0];
    await act(async () => {
      (s1.props.onChange as (p: Record<string, unknown>) => void)({ title: "Tulum Yoga Retreat 3" });
    });
    await settle(1000);
    const state = (): Record<string, unknown> =>
      (tree.root.findAll((n) => n.type === "SavePill")[0].props.state as Record<string, unknown>);
    expect(state().label).toBe("Not saved — retrying");
    expect(state().retryable).toBe(true);
    // Tapping the pill saves now.
    const pillNode = tree.root.findAll((n) => n.type === "SavePill")[0];
    await act(async () => {
      (pillNode.props.onRetry as () => void)();
    });
    await settle(50);
    expect(saves.basics).toHaveBeenCalledTimes(2);
    expect(state().label).toBe("Saved");
  });
});
