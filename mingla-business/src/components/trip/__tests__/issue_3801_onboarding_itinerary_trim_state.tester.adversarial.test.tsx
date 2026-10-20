/**
 * Issue #3801 — TESTER adversarial: the "remove part of your itinerary?"
 * question under pressure.
 *
 * A DIFFERENT ANGLE from the implementor suite
 * (`issue_3801_onboarding_itinerary_trim.implementor.test.tsx`), which proves
 * the reported case: one date changes, the question appears, each answer does
 * the obvious thing. This file attacks the state the question keeps:
 *
 *   1. "Keep dates" restores BOTH dates, byte for byte, when one change moved
 *      both (the web start field moves the end with it).
 *   2. "Keep dates" restores the last dates the itinerary FITTED, not the
 *      dates the trip opened with: lengthen first, then decline a shortening.
 *      And after "Remove day" the baseline is the new dates.
 *   3. THE RACE: a save that goes out while the question is still unanswered
 *      must send every itinerary day. The server replaces the whole list on a
 *      day save, so a save that ran on the trimmed list would make the loss
 *      permanent before the host answered.
 *   4. Moving the whole trip (both dates, same length) neither asks nor drops.
 *   5. Lengthening never asks, however many times, from either end.
 *   6. What counts as "something the host wrote": spaces and line breaks do
 *      not; a photo on its own does; a seeded "Day N" title does not.
 *   7. "Remove days" removes ONLY the trailing days, names every day at risk,
 *      and the next itinerary save carries exactly the days that are left.
 *
 * The REAL `TripCreatorWizard` source is compiled and mounted against an
 * explicit module boundary (the #3439 / #1780 compiled-creator pattern); the
 * fit effect and both answer handlers run unchanged.
 *
 * Fails on revert (verified, see the tester report on the issue): make the fit
 * slice the list without asking and the race, restore and "names every day"
 * tests go red.
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
  // [TEST-MOD-APPROVED #3859] The #3801 fixture has no installment provider;
  // model the new capability boundary without changing its itinerary subject.
  "@mingla/offering-rendering/tripInstallmentCapability": () => ({
    tripInstallmentsSupported: () => false,
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
  // issue #3827 going-box — the wizard's extras copy + error matcher (pure; real module).
  guestListPrivacy: () => jest.requireActual("../../../constants/guestListPrivacy"),
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
// fixtures: 12 to 16 November, five days
// ---------------------------------------------------------------------------

const EVENT_ID = "38010000-0000-4000-8000-0000000000d1";
const BRAND_ID = "brand-3801";
const START = "2026-11-12T00:00:00.000Z";
const END = "2026-11-16T23:59:59.000Z";
const endOn = (day: number): string => `2026-11-${day}T23:59:59.000Z`;
const startOn = (day: number): string => `2026-11-${day}T00:00:00.000Z`;

type Media = { url: string; type: "image" | "video" };
const day = (
  ordinal: number,
  narrative: string | null = null,
  title: string = `Day ${ordinal}`,
  media: Media[] = [],
): Record<string, unknown> => ({ ordinal, title, narrative, media });

const BRUNCH = "Farewell brunch at the lagoon.";
const MARKET = "Lekki market and the art gallery.";

const tripWith = (
  days: Record<string, unknown>[],
  startAt: string = START,
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
    startAt,
    endAt,
    destinationPlaceId: "dest",
    destinationLocationText: "Lagos",
    destinationLat: 6.45,
    destinationLng: 3.39,
    departurePlaceId: "dep",
    departureLocationText: "London",
    departureLat: 51.5,
    departureLng: -0.12,
    capacity: 8,
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

const contentOnFive = [day(1), day(2), day(3), day(4), day(5, BRUNCH)];

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
const dates = (tree: Renderer): { startAt: unknown; endAt: unknown } => {
  const draft = step1(tree).props.draft as Record<string, unknown>;
  return { startAt: draft.startAt, endAt: draft.endAt };
};
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
const asking = (tree: Renderer): boolean => trimDialog(tree).props.visible === true;
const answer = async (tree: Renderer, which: "onClose" | "onConfirm"): Promise<void> => {
  await act(async () => {
    (trimDialog(tree).props[which] as () => void)();
  });
  await settle();
};
const pressContinue = async (tree: Renderer): Promise<void> => {
  const found = tree.root.findAll(
    (node) => node.type === "ButtonProbe" && node.props.label === "Continue",
  );
  expect(found).toHaveLength(1);
  await act(async () => {
    (found[0].props.onPress as () => void)();
  });
  await settle();
};
const step2Days = (tree: Renderer): DayDraft[] => {
  const step2 = tree.root.findAll((node) => node.type === "TripCreatorStep2Itinerary");
  expect(step2).toHaveLength(1);
  return step2[0].props.days as DayDraft[];
};
/** Continue from Step 1 to Step 2 and read the itinerary the host sees. */
const itinerary = async (tree: Renderer): Promise<DayDraft[]> => {
  await pressContinue(tree);
  return step2Days(tree);
};
const lastDaysSave = (): { ordinal: number; title: string; narrative: string | null }[] => {
  expect(saves.days).toHaveBeenCalled();
  const input = saves.days.mock.calls[saves.days.mock.calls.length - 1][0] as {
    days: { ordinal: number; title: string; narrative: string | null }[];
  };
  return input.days;
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

describe("#3801 tester — 'Keep dates' restores exactly what was there", () => {
  test("one change that moved BOTH dates is undone for both, byte for byte", async () => {
    const tree = await mountWizard(tripWith(contentOnFive));

    // What the web start field does when the new start is past the end.
    await changeDates(tree, { startAt: startOn(20), endAt: endOn(20) });
    expect(asking(tree)).toBe(true);
    expect(trimDialog(tree).props.description).toBe(
      "Shortening this trip removes Day 5 and what you wrote for it.",
    );

    await answer(tree, "onClose");

    expect(asking(tree)).toBe(false);
    expect(dates(tree)).toEqual({ startAt: START, endAt: END });
    const days = await itinerary(tree);
    expect(days.map((d) => d.ordinal)).toEqual([1, 2, 3, 4, 5]);
    expect(days[4].narrative).toBe(BRUNCH);
  });

  test("it restores the last dates the itinerary fitted, not the dates the trip opened with", async () => {
    const tree = await mountWizard(tripWith(contentOnFive));

    // Lengthen to seven days: accepted quietly, two empty days added.
    await changeDates(tree, { endAt: endOn(18) });
    expect(asking(tree)).toBe(false);

    // Now shorten below Day 5 and decline.
    await changeDates(tree, { endAt: endOn(15) });
    expect(asking(tree)).toBe(true);
    await answer(tree, "onClose");

    expect(dates(tree)).toEqual({ startAt: START, endAt: endOn(18) });
    const days = await itinerary(tree);
    expect(days.map((d) => d.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(days[4].narrative).toBe(BRUNCH);
  });

  test("after 'Remove day' the new dates are the baseline for the next question", async () => {
    const tree = await mountWizard(
      tripWith([day(1), day(2), day(3), day(4, MARKET), day(5, BRUNCH)]),
    );

    await changeDates(tree, { endAt: endOn(15) });
    expect(trimDialog(tree).props.description).toBe(
      "Shortening this trip removes Day 5 and what you wrote for it.",
    );
    await answer(tree, "onConfirm");
    expect(dates(tree)).toEqual({ startAt: START, endAt: endOn(15) });

    // Shorten again: Day 4 is now at risk. Decline.
    await changeDates(tree, { endAt: endOn(14) });
    expect(trimDialog(tree).props.description).toBe(
      "Shortening this trip removes Day 4 and what you wrote for it.",
    );
    await answer(tree, "onClose");

    // Back to the four-day dates the host accepted, not the original five.
    expect(dates(tree)).toEqual({ startAt: START, endAt: endOn(15) });
    const days = await itinerary(tree);
    expect(days.map((d) => d.ordinal)).toEqual([1, 2, 3, 4]);
    expect(days[3].narrative).toBe(MARKET);
  });

  test("declining twice in a row leaves the same dates and the same days", async () => {
    const tree = await mountWizard(tripWith(contentOnFive));
    for (const end of [endOn(15), endOn(13)]) {
      await changeDates(tree, { endAt: end });
      expect(asking(tree)).toBe(true);
      await answer(tree, "onClose");
      expect(asking(tree)).toBe(false);
      expect(dates(tree)).toEqual({ startAt: START, endAt: END });
    }
    expect((await itinerary(tree)).map((d) => d.ordinal)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("#3801 tester — a save cannot outrun the question", () => {
  test("a save that goes out while the question is unanswered still sends every day", async () => {
    const tree = await mountWizard(tripWith(contentOnFive));
    await changeDates(tree, { endAt: endOn(15) });
    expect(asking(tree)).toBe(true);

    // The host (or a stray Enter key) continues without answering: Step 1
    // saves, Step 2 opens with every day, and its own save sends every day.
    await pressContinue(tree);
    expect(asking(tree)).toBe(true);
    expect(step2Days(tree).map((d) => d.ordinal)).toEqual([1, 2, 3, 4, 5]);
    await pressContinue(tree);

    const sent = lastDaysSave();
    expect(sent.map((d) => d.ordinal)).toEqual([1, 2, 3, 4, 5]);
    expect(sent[4].narrative).toBe(BRUNCH);
    // No day save anywhere in this run carried fewer than five days.
    for (const call of saves.days.mock.calls) {
      expect((call[0] as { days: unknown[] }).days).toHaveLength(5);
    }
  });

  test("answering 'Remove day' is the only thing that shortens what is saved", async () => {
    const tree = await mountWizard(tripWith(contentOnFive));
    await changeDates(tree, { endAt: endOn(15) });
    await answer(tree, "onConfirm");

    await pressContinue(tree);
    await pressContinue(tree);

    expect(lastDaysSave().map((d) => d.ordinal)).toEqual([1, 2, 3, 4]);
  });
});

describe("#3801 tester — changes that must never ask", () => {
  test("moving the whole trip (both dates, same length) neither asks nor drops a day", async () => {
    const tree = await mountWizard(tripWith(contentOnFive));

    await changeDates(tree, { startAt: startOn(19), endAt: endOn(23) });

    expect(asking(tree)).toBe(false);
    expect(dates(tree)).toEqual({ startAt: startOn(19), endAt: endOn(23) });
    const days = await itinerary(tree);
    expect(days.map((d) => d.ordinal)).toEqual([1, 2, 3, 4, 5]);
    expect(days[4].narrative).toBe(BRUNCH);
  });

  test("lengthening never asks: from the end, from the start, and again", async () => {
    const tree = await mountWizard(tripWith(contentOnFive));

    await changeDates(tree, { endAt: endOn(17) });
    expect(asking(tree)).toBe(false);
    await changeDates(tree, { startAt: startOn(11) });
    expect(asking(tree)).toBe(false);
    await changeDates(tree, { endAt: endOn(20) });
    expect(asking(tree)).toBe(false);

    const days = await itinerary(tree);
    expect(days.map((d) => d.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(days[4].narrative).toBe(BRUNCH);
    // The added days are empty shells, not copies of anything.
    expect(days.slice(5).map((d) => [d.title, d.narrative])).toEqual([
      ["Day 6", ""],
      ["Day 7", ""],
      ["Day 8", ""],
      ["Day 9", ""],
      ["Day 10", ""],
    ]);
  });

  test("lengthening and then coming back to the original dates drops only the empty days it added", async () => {
    const tree = await mountWizard(tripWith(contentOnFive));

    await changeDates(tree, { endAt: endOn(19) });
    await changeDates(tree, { endAt: END });

    expect(asking(tree)).toBe(false);
    const days = await itinerary(tree);
    expect(days.map((d) => d.ordinal)).toEqual([1, 2, 3, 4, 5]);
    expect(days[4].narrative).toBe(BRUNCH);
  });

  test("a single-day trip never goes below one day", async () => {
    const tree = await mountWizard(tripWith([day(1, "Arrive.")], START, endOn(12)));
    await changeDates(tree, { endAt: endOn(12) });
    expect(asking(tree)).toBe(false);
    expect((await itinerary(tree)).map((d) => d.narrative)).toEqual(["Arrive."]);
  });
});

describe("#3801 tester — what counts as something the host wrote", () => {
  test("a trailing day holding only spaces and line breaks is removed without a question", async () => {
    // Whitespace is saved as nothing (the day save trims it to null), so
    // there is nothing to lose and nothing to ask about.
    const tree = await mountWizard(
      tripWith([day(1), day(2), day(3), day(4), day(5, "  \n\t ", "  Day 5  ")]),
    );

    await changeDates(tree, { endAt: endOn(15) });

    expect(asking(tree)).toBe(false);
    expect((await itinerary(tree)).map((d) => d.ordinal)).toEqual([1, 2, 3, 4]);
  });

  test("a trailing day with only a photo is content: it asks", async () => {
    const tree = await mountWizard(
      tripWith([
        day(1),
        day(2),
        day(3),
        day(4),
        day(5, null, "Day 5", [{ url: "https://example.test/lagoon.jpg", type: "image" }]),
      ]),
    );

    await changeDates(tree, { endAt: endOn(15) });

    expect(asking(tree)).toBe(true);
    await answer(tree, "onClose");
    expect((await itinerary(tree))[4].media).toHaveLength(1);
  });

  test("a trailing day with only a title the host typed is content: it asks", async () => {
    const tree = await mountWizard(
      tripWith([day(1), day(2), day(3), day(4), day(5, null, "Departure")]),
    );
    await changeDates(tree, { endAt: endOn(15) });
    expect(asking(tree)).toBe(true);
  });

  test("the rule, on its own, at its edges", () => {
    const { tripDayHasHostContent, fitItineraryToDayCount } = loadWizardModule();
    const d = (ordinal: number, title: string, narrative: string): DayDraft => ({
      ordinal,
      title,
      narrative,
      media: [],
    });
    expect(tripDayHasHostContent(d(5, "Day 5", ""))).toBe(false);
    expect(tripDayHasHostContent(d(5, "", ""))).toBe(false);
    expect(tripDayHasHostContent(d(5, " ", "\n"))).toBe(false);
    // A seeded title that no longer matches its place was edited or moved.
    expect(tripDayHasHostContent(d(5, "Day 4", ""))).toBe(true);
    expect(tripDayHasHostContent(d(5, "day 5", ""))).toBe(true);
    expect(tripDayHasHostContent(d(5, "Day 5", "."))).toBe(true);

    // Fitting never mutates what it was given.
    const before = [d(1, "Day 1", ""), d(2, "Day 2", "x")];
    const frozen = JSON.stringify(before);
    fitItineraryToDayCount(before, 1);
    fitItineraryToDayCount(before, 4);
    expect(JSON.stringify(before)).toBe(frozen);
    // Same length: the very same array comes back, so no re-render is forced.
    expect(fitItineraryToDayCount(before, 2).days).toBe(before);
  });
});

describe("#3801 tester — 'Remove days' removes only the trailing days", () => {
  test("it names every day at risk, keeps earlier content, and the next save carries what is left", async () => {
    const tree = await mountWizard(
      tripWith([day(1), day(2, MARKET), day(3), day(4, "Boat day."), day(5, BRUNCH)]),
    );

    await changeDates(tree, { endAt: endOn(14) });

    const dialog = trimDialog(tree);
    expect(dialog.props.visible).toBe(true);
    expect(dialog.props.description).toBe(
      "Shortening this trip removes Days 4 and 5 and what you wrote for them.",
    );
    expect(dialog.props.confirmLabel).toBe("Remove days");
    expect(dialog.props.cancelLabel).toBe("Keep dates");
    expect(dialog.props.destructive).toBe(true);

    await answer(tree, "onConfirm");

    expect(dates(tree)).toEqual({ startAt: START, endAt: endOn(14) });
    const days = await itinerary(tree);
    expect(days.map((d) => d.ordinal)).toEqual([1, 2, 3]);
    expect(days[1].narrative).toBe(MARKET);

    await pressContinue(tree);
    const sent = lastDaysSave();
    expect(sent.map((d) => [d.ordinal, d.narrative])).toEqual([
      [1, null],
      [2, MARKET],
      [3, null],
    ]);
  });

  test("an empty day between the cut and a written day is named only by the written one", async () => {
    // Shorten five days to three: Day 4 is empty, Day 5 is written.
    const tree = await mountWizard(tripWith(contentOnFive));
    await changeDates(tree, { endAt: endOn(14) });
    expect(trimDialog(tree).props.description).toBe(
      "Shortening this trip removes Day 5 and what you wrote for it.",
    );
    expect(trimDialog(tree).props.confirmLabel).toBe("Remove day");
    await answer(tree, "onConfirm");
    expect((await itinerary(tree)).map((d) => d.ordinal)).toEqual([1, 2, 3]);
  });
});
