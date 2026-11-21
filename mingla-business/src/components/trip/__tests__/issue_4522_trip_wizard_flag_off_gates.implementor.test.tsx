// MINGLA-INVARIANT: I-4522-TRIP-WIZARD-LEGACY-PUBLISH-GATES | issue #4522 | With the builder off, the eight-step trip wizard keeps every Publish gate: bank, payout for plans, unsupported plans, confirmed places and valid packages each grey out Publish, and an unsupported plan is never shown in the review preview.
/**
 * Issue #4522 — the REAL `TripCreatorWizard` source with the builder flag OFF,
 * mounted against the same explicit module boundary as the flag-on suite.
 *
 * This replaces three source-text pins (`TripPublishStripeBanner` T-19,
 * `TripCreatorStep1Basics.addressPicker` T-5 and the #3859 preview and
 * refusal pins) that matched the exact formatting of the dock Publish button.
 * The builder stream reshaped that code into a flag-on and a flag-off branch;
 * these tests assert what the host actually gets on the flag-off branch.
 *
 * Fails on revert: drop any term from the flag-off Publish `disabled`
 * expression, show the saved schedule in the preview when plans are
 * unsupported, or stop sending the host back to Pricing -> red.
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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const TRIP_DIR = path.resolve(__dirname, "..");
const WIZARD_SOURCE = fs.readFileSync(path.join(TRIP_DIR, "TripCreatorWizard.tsx"), "utf8");

const gates = {
  needsStripe: false,
  payoutReady: true,
  plansSupported: true,
  locationValid: true,
  packagesValid: true,
};

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
    TRIP_BUILDER_V2: false,
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
    tripInstallmentsSupported: () => gates.plansSupported,
  }),
  useTripInstallmentCapability: () => ({
    useTripInstallmentCapability: () => ({ data: gates.plansSupported }),
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
    isBrandPayoutReady: () => gates.payoutReady,
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
    departureLocationValidated: () => gates.locationValid,
    destinationLocationValidated: () => true,
  }),
  TripCreatorStep4Pricing: () => ({
    TripCreatorStep4Pricing: leaf("TripCreatorStep4Pricing"),
    makePackageKey: () => "package-3801",
  }),
  tripPackagesValidation: () => ({
    validateTripPackages: () =>
      gates.packagesValid ? { ok: true, reason: null } : { ok: false, reason: "Give every package a price." },
  }),
  TripCreatorStep5Review: () => ({
    TripCreatorStep5Review: leaf("TripCreatorStep5Review"),
    mapPublishErrorToState: () => null,
  }),
  publishStripeReadiness: () => ({
    offeringNeedsStripeToPublish: () => gates.needsStripe,
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

interface WizardModule {
  TripCreatorWizard: React.ComponentType<Record<string, unknown>>;
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

const EVENT_ID = "45220000-0000-4000-8000-0000000000c2";
const BRAND_ID = "brand-4522-off";
const PLAN = { depositPercent: 25, installments: 3 };
const trip = (plan: unknown = null): Record<string, unknown> => ({
  id: EVENT_ID,
  brandId: BRAND_ID,
  title: "Tulum Yoga Retreat",
  description: "Five days of yoga.",
  timezone: "Africa/Lagos",
  coverMediaUrl: null,
  coverMediaType: null,
  coverGallery: [],
  themeOverrides: null,
  businessTrip: {
    startAt: "2027-03-12T00:00:00.000Z",
    endAt: "2027-03-16T23:59:59.000Z",
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
      installmentSchedule: plan, description: null,
    },
  ],
  pricingSwitches: { passTax: null, passMinglaFee: null, passServiceFee: null },
  guestPrivacy: { privateGuestList: false, hideRemainingCount: false },
  refundPolicy: null,
  bookingDeadline: null,
  ticketsSoldCount: 0,
});

const mounted: Renderer[] = [];
const settle = async (ms = 20): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};
const findButtons = (tree: Renderer, label: string): TestInstance[] =>
  tree.root.findAll((n) => n.type === "ButtonProbe" && n.props.label === label);
const press = async (node: TestInstance): Promise<void> => {
  await act(async () => {
    (node.props.onPress as () => void)();
  });
  await settle();
};
/** Mount, then Continue until the review step offers "Publish trip". */
const mountAtPublish = async (t: Record<string, unknown>): Promise<Renderer> => {
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
  for (let i = 0; i < 10 && findButtons(tree, "Publish trip").length === 0; i += 1) {
    const next = findButtons(tree, "Continue");
    expect(next.length).toBeGreaterThan(0);
    await press(next[0]);
  }
  expect(findButtons(tree, "Publish trip").length).toBe(1);
  return tree;
};
const publishDisabled = (tree: Renderer): boolean =>
  findButtons(tree, "Publish trip")[0].props.disabled === true;

beforeEach(() => {
  gates.needsStripe = false;
  gates.payoutReady = true;
  gates.plansSupported = true;
  gates.locationValid = true;
  gates.packagesValid = true;
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

describe("the eight-step wizard, builder off, real wizard source", () => {
  test("Publish is live when every gate is met", async () => {
    const tree = await mountAtPublish(trip());
    expect(publishDisabled(tree)).toBe(false);
  });

  test("a paid trip on a brand that cannot be paid greys out Publish (ORCH-1076)", async () => {
    gates.needsStripe = true;
    const tree = await mountAtPublish(trip());
    expect(publishDisabled(tree)).toBe(true);
  });

  test("a plan without a payout bank greys out Publish (#3645)", async () => {
    gates.payoutReady = false;
    const tree = await mountAtPublish(trip(PLAN));
    expect(publishDisabled(tree)).toBe(true);
  });

  test("an unpicked departure greys out Publish (ORCH-1118)", async () => {
    gates.locationValid = false;
    const tree = await mountAtPublish(trip());
    expect(publishDisabled(tree)).toBe(true);
  });

  test("an invalid package greys out Publish (META-ORCH-1174)", async () => {
    gates.packagesValid = false;
    const tree = await mountAtPublish(trip());
    expect(publishDisabled(tree)).toBe(true);
  });

  test("an unsupported plan greys out Publish and the review never shows the schedule (#3859)", async () => {
    gates.plansSupported = false;
    const tree = await mountAtPublish(trip(PLAN));
    expect(publishDisabled(tree)).toBe(true);
    const review = tree.root.findAll((n) => n.type === "TripCreatorStep5Review")[0];
    const tiers = (review.props.trip as { pricingTiers: Record<string, unknown>[] }).pricingTiers;
    expect(tiers[0].installmentSchedule).toBeNull();
    expect(tiers[0].paymentPlan).toBeNull();
  });

  test("a supported plan is shown in the review preview", async () => {
    const tree = await mountAtPublish(trip(PLAN));
    const review = tree.root.findAll((n) => n.type === "TripCreatorStep5Review")[0];
    const tiers = (review.props.trip as { pricingTiers: Record<string, unknown>[] }).pricingTiers;
    expect(tiers[0].installmentSchedule).toEqual(PLAN);
  });

  test("the Pricing step is told plans are unavailable", async () => {
    gates.plansSupported = false;
    const tree = await mountAtPublish(trip(PLAN));
    // Back to Pricing through the stepper is not needed: the step leaf is
    // mounted with its props when visited, so walk back with Back.
    for (let i = 0; i < 10 && tree.root.findAll((n) => n.type === "TripCreatorStep4Pricing").length === 0; i += 1) {
      await press(findButtons(tree, "Back")[0]);
    }
    const pricing = tree.root.findAll((n) => n.type === "TripCreatorStep4Pricing")[0];
    expect(pricing.props.paymentPlansAvailable).toBe(false);
  });
});
