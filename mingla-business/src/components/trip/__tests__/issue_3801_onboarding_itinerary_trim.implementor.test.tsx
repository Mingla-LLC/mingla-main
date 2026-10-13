/**
 * Issue #3801 — shortening a trip never drops an itinerary day the host wrote
 * without asking, and Step 1 no longer carries a capacity field.
 *
 * THE BUG. An effect in `TripCreatorWizard` fitted the itinerary to the day
 * count the dates imply by slicing the list. Changing the start date silently
 * removed Day 5, and the next itinerary save (delete-then-insert on the
 * server) made the loss permanent. Separately, Step 1 had a "Capacity (max
 * travelers)" field that was never saved; on reload it showed whichever
 * package's spots came back first.
 *
 * THE FIX. A day holding host content (a title other than the seeded `Day N`,
 * a description, or media) is only removed after the host confirms; declining
 * puts the previous dates back. Empty trailing days are still trimmed quietly.
 * The Step 1 capacity field and its draft key are gone; the trip total shown
 * in the preview is the sum of the packages on screen.
 *
 * HOW THIS PROVES IT. The REAL `TripCreatorWizard` source is compiled with the
 * TypeScript compiler and mounted against an explicit module boundary (the
 * #3439 / #1780 compiled-creator pattern — the same boundary as
 * `issue_3801_trip_step_save_failure.implementor.test.tsx`). Wizard state and
 * the fit effect run unchanged; an unknown import throws.
 *
 * Fails on revert: restore `return current.slice(0, dayCount)` in the fit
 * effect -> the "asks first" tests go red.
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
const STEP1_SOURCE = fs.readFileSync(path.join(TRIP_DIR, "TripCreatorStep1Basics.tsx"), "utf8");

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
  Stepper: () => ({ Stepper: nothing }),
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
      plan: { ...settledIdle, data: undefined },
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
  }),
  useRefundPolicy: () => ({
    useUpdateBookingDeadline: () => idleMutation,
    useUpdateRefundPolicy: () => idleMutation,
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
// fixtures: production trip 2385da2f… — 12 to 16 November, five days
// ---------------------------------------------------------------------------

const EVENT_ID = "38010000-0000-4000-8000-0000000000c1";
const BRAND_ID = "brand-3801";
const START = "2026-11-12T00:00:00.000Z";
const END = "2026-11-16T23:59:59.000Z";
const FOUR_DAY_END = "2026-11-15T23:59:59.000Z";
const LATER_START = "2026-11-13T00:00:00.000Z";

const shell = (ordinal: number): Record<string, unknown> => ({
  ordinal,
  title: `Day ${ordinal}`,
  narrative: null,
  media: [],
});
const dayFive = { ordinal: 5, title: "Day 5", narrative: "Farewell brunch at the lagoon.", media: [] };

const tripWith = (
  days: Record<string, unknown>[],
  endAt: string = END,
): Record<string, unknown> => ({
  id: EVENT_ID,
  brandId: BRAND_ID,
  title: "Lagos long weekend",
  timezone: "UTC",
  coverMediaUrl: null,
  coverMediaType: null,
  coverGallery: [],
  themeOverrides: null,
  businessTrip: {
    startAt: START,
    endAt,
    destinationPlaceId: "dest",
    destinationLocationText: "Lagos",
    destinationLat: 6.45,
    destinationLng: 3.39,
    departurePlaceId: "dep",
    departureLocationText: "London",
    departureLat: 51.5,
    departureLng: -0.12,
    capacity: 11,
  },
  days,
  inclusions: [],
  pricingTiers: [
    {
      id: "tier-3801",
      eventId: EVENT_ID,
      ticketTypeId: "tt-3801",
      tierName: "Shared",
      tierMetadata: {},
      priceCents: 0,
      currency: "USD",
      quantityTotal: 8,
      ticketsRemaining: 8,
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
});

const fiveDaysWithContentOnFive = [shell(1), shell(2), shell(3), shell(4), dayFive];

const mounted: Renderer[] = [];
const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};
const mountWizard = async (trip: Record<string, unknown>): Promise<Renderer> => {
  const { TripCreatorWizard } = loadWizardModule();
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <TripCreatorWizard
        trip={trip}
        brand={{ id: BRAND_ID, slug: "issue-3801", name: "Issue 3801" }}
        onPublished={jest.fn()}
        onExit={jest.fn()}
      />,
    );
  });
  mounted.push(tree);
  await settle();
  return tree;
};

const step1 = (tree: Renderer): TestInstance => {
  const found = tree.root.findAll((node) => node.type === "TripCreatorStep1Basics");
  expect(found).toHaveLength(1);
  return found[0];
};
const step1Draft = (tree: Renderer): Record<string, unknown> =>
  step1(tree).props.draft as Record<string, unknown>;
const changeDates = async (tree: Renderer, patch: Record<string, unknown>): Promise<void> => {
  await act(async () => {
    (step1(tree).props.onChange as (p: Record<string, unknown>) => void)(patch);
  });
  await settle();
};
const trimDialog = (tree: Renderer): TestInstance => {
  const found = tree.root.findAll(
    (node) =>
      node.type === "ConfirmDialogProbe" &&
      node.props.testID === "trip-wizard-day-trim-dialog",
  );
  expect(found).toHaveLength(1);
  return found[0];
};
const answer = async (tree: Renderer, which: "onClose" | "onConfirm"): Promise<void> => {
  await act(async () => {
    (trimDialog(tree).props[which] as () => void)();
  });
  await settle();
};
/** Continue to Step 2 and read the itinerary the host will see and save. */
const itineraryOnStep2 = async (tree: Renderer): Promise<DayDraft[]> => {
  const found = tree.root.findAll(
    (node) => node.type === "ButtonProbe" && node.props.label === "Continue",
  );
  expect(found).toHaveLength(1);
  await act(async () => {
    (found[0].props.onPress as () => void)();
  });
  await settle();
  const step2 = tree.root.findAll((node) => node.type === "TripCreatorStep2Itinerary");
  expect(step2).toHaveLength(1);
  return step2[0].props.days as DayDraft[];
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

// ---------------------------------------------------------------------------

describe("#3801 — shortening a trip asks before removing a day the host wrote", () => {
  test("a shorter end date asks, names the day, and removes nothing yet", async () => {
    const tree = await mountWizard(tripWith(fiveDaysWithContentOnFive));
    expect(trimDialog(tree).props.visible).toBe(false);

    await changeDates(tree, { endAt: FOUR_DAY_END });

    const dialog = trimDialog(tree);
    expect(dialog.props.visible).toBe(true);
    expect(dialog.props.description).toBe(
      "Shortening this trip removes Day 5 and what you wrote for it.",
    );
    expect(dialog.props.cancelLabel).toBe("Keep dates");
    expect(dialog.props.confirmLabel).toBe("Remove day");
  });

  test("Keep dates puts the previous dates back and Day 5 is still there", async () => {
    const tree = await mountWizard(tripWith(fiveDaysWithContentOnFive));
    await changeDates(tree, { endAt: FOUR_DAY_END });

    await answer(tree, "onClose");

    expect(trimDialog(tree).props.visible).toBe(false);
    expect(step1Draft(tree).startAt).toBe(START);
    expect(step1Draft(tree).endAt).toBe(END);
    const days = await itineraryOnStep2(tree);
    expect(days.map((d) => d.ordinal)).toEqual([1, 2, 3, 4, 5]);
    expect(days[4].narrative).toBe("Farewell brunch at the lagoon.");
  });

  test("moving the START later (the reported case) asks too, and Keep dates restores the start", async () => {
    const tree = await mountWizard(tripWith(fiveDaysWithContentOnFive));

    await changeDates(tree, { startAt: LATER_START });
    expect(trimDialog(tree).props.visible).toBe(true);

    await answer(tree, "onClose");
    expect(step1Draft(tree).startAt).toBe(START);
    const days = await itineraryOnStep2(tree);
    expect(days).toHaveLength(5);
  });

  test("Remove day keeps the new dates and removes exactly that day", async () => {
    const tree = await mountWizard(tripWith(fiveDaysWithContentOnFive));
    await changeDates(tree, { endAt: FOUR_DAY_END });

    await answer(tree, "onConfirm");

    expect(trimDialog(tree).props.visible).toBe(false);
    expect(step1Draft(tree).endAt).toBe(FOUR_DAY_END);
    const days = await itineraryOnStep2(tree);
    expect(days.map((d) => d.ordinal)).toEqual([1, 2, 3, 4]);
  });

  test("an EMPTY trailing day is still trimmed without a question", async () => {
    const tree = await mountWizard(tripWith([shell(1), shell(2), shell(3), shell(4), shell(5)]));

    await changeDates(tree, { endAt: FOUR_DAY_END });

    expect(trimDialog(tree).props.visible).toBe(false);
    expect(step1Draft(tree).endAt).toBe(FOUR_DAY_END);
    const days = await itineraryOnStep2(tree);
    expect(days.map((d) => d.ordinal)).toEqual([1, 2, 3, 4]);
  });

  test("opening a trip whose itinerary is longer than its dates removes nothing and asks nothing", async () => {
    const tree = await mountWizard(tripWith(fiveDaysWithContentOnFive, FOUR_DAY_END));

    expect(trimDialog(tree).props.visible).toBe(false);
    const days = await itineraryOnStep2(tree);
    expect(days).toHaveLength(5);
    expect(days[4].narrative).toBe("Farewell brunch at the lagoon.");
  });

  test("lengthening a trip adds empty days and asks nothing", async () => {
    const tree = await mountWizard(tripWith(fiveDaysWithContentOnFive));

    await changeDates(tree, { endAt: "2026-11-18T23:59:59.000Z" });

    expect(trimDialog(tree).props.visible).toBe(false);
    const days = await itineraryOnStep2(tree);
    expect(days.map((d) => d.title)).toEqual([
      "Day 1",
      "Day 2",
      "Day 3",
      "Day 4",
      "Day 5",
      "Day 6",
      "Day 7",
    ]);
    expect(days[4].narrative).toBe("Farewell brunch at the lagoon.");
  });
});

describe("#3801 — the rules behind the question", () => {
  const wizard = loadWizardModule();
  const empty = (ordinal: number): DayDraft => ({
    ordinal,
    title: `Day ${ordinal}`,
    narrative: "",
    media: [],
  });

  test("what counts as something the host wrote", () => {
    expect(wizard.tripDayHasHostContent(empty(3))).toBe(false);
    expect(wizard.tripDayHasHostContent({ ...empty(3), title: "" })).toBe(false);
    expect(wizard.tripDayHasHostContent({ ...empty(3), title: "  Day 3  " })).toBe(false);
    expect(wizard.tripDayHasHostContent({ ...empty(3), title: "Beach day" })).toBe(true);
    // A seeded title that no longer matches its place is the host's own.
    expect(wizard.tripDayHasHostContent({ ...empty(3), title: "Day 2" })).toBe(true);
    expect(wizard.tripDayHasHostContent({ ...empty(3), narrative: "Boat to Tarkwa Bay" })).toBe(true);
    expect(
      wizard.tripDayHasHostContent({
        ...empty(3),
        media: [{ url: "https://example.test/a.jpg", type: "image" }],
      }),
    ).toBe(true);
  });

  test("a day with content anywhere in the part being removed stops the whole trim", () => {
    const current = [empty(1), empty(2), { ...empty(3), narrative: "Market tour" }, empty(4)];
    const fitted = wizard.fitItineraryToDayCount(current, 2);
    expect(fitted.days).toBe(current);
    expect(fitted.atRisk.map((d) => d.ordinal)).toEqual([3]);
  });

  test("the question names every day at risk", () => {
    expect(wizard.describeItineraryDaysAtRisk([empty(5)])).toBe(
      "Shortening this trip removes Day 5 and what you wrote for it.",
    );
    expect(wizard.describeItineraryDaysAtRisk([empty(4), empty(5)])).toBe(
      "Shortening this trip removes Days 4 and 5 and what you wrote for them.",
    );
    expect(wizard.describeItineraryDaysAtRisk([empty(3), empty(4), empty(5)])).toBe(
      "Shortening this trip removes Days 3, 4 and 5 and what you wrote for them.",
    );
  });
});

describe("#3801 — Step 1 has no capacity field; the trip total is derived", () => {
  test("the Step 1 draft the wizard builds has no capacity key", async () => {
    const tree = await mountWizard(tripWith(fiveDaysWithContentOnFive));
    expect(Object.keys(step1Draft(tree))).not.toContain("capacity");
  });

  test("the Step 1 screen has no capacity input and its draft type has no capacity", () => {
    expect(STEP1_SOURCE).not.toContain("trip-step1-capacity");
    expect(STEP1_SOURCE).not.toContain("Capacity (max travelers)");
    const draftType = STEP1_SOURCE.slice(
      STEP1_SOURCE.indexOf("export interface Step1Draft {"),
      STEP1_SOURCE.indexOf("export interface TripCreatorStep1BasicsProps"),
    );
    expect(draftType).not.toMatch(/^\s*capacity\??:/m);
  });

  test("the wizard never sends a trip-level capacity when publishing", () => {
    expect(WIZARD_SOURCE).not.toContain("step1Draft.capacity");
  });

  test("the previewed total is the sum of the packages on screen, or no cap", () => {
    const { draftPackagesTotalSpots } = loadWizardModule();
    expect(
      draftPackagesTotalSpots([{ capacity: 8 }, { capacity: 2 }, { capacity: 1 }]),
    ).toBe(11);
    // Independent of order.
    expect(
      draftPackagesTotalSpots([{ capacity: 1 }, { capacity: 8 }, { capacity: 2 }]),
    ).toBe(11);
    expect(draftPackagesTotalSpots([{ capacity: 8 }, { capacity: null }])).toBeNull();
    expect(draftPackagesTotalSpots([])).toBeNull();
    expect(WIZARD_SOURCE).toContain("capacity: draftPackagesTotalSpots(step4Draft.packages)");
  });
});
