/**
 * Issue #3801 — a failed save in the trip wizard is visible on the step where
 * it happened, and never traps the organiser there.
 *
 * THE BUG. `supabase.rpc()` rejects with a PostgREST PLAIN OBJECT
 * `{ message, code, details, hint }` and tripsService re-throws it verbatim.
 * The wizard read it as `e instanceof Error ? e.message : String(e)`, which
 * gives the literal text "[object Object]". So:
 *   - no guard reason could match, and the payments-setup redirect the wizard
 *     already had never fired;
 *   - the fallback wrote its message into a banner only the Review step
 *     renders, so on every other step a failed save showed nothing at all and
 *     both Continue and Back simply stopped working.
 *
 * HOW THIS PROVES THE FIX. The REAL TripCreatorWizard source is compiled with
 * the TypeScript compiler and mounted against an explicit module boundary (the
 * #3439 / #1780 compiled-creator pattern). Wizard state, the autosave, both
 * navigation handlers and their catch blocks execute unchanged. The save
 * mutations are the only thing steered: they reject with the exact plain
 * object PostgREST produces. `paidPublishGuards` and `rsvpRpcFailure` are the
 * REAL modules, so the reason is read and mapped by shipped code.
 *
 * Every import the wizard makes is classified below; an unknown one throws, so
 * a new dependency cannot slip past this suite unexamined.
 *
 * Fails on revert: restore `e instanceof Error ? e.message : String(e ?? "")`
 * in the two catches, or drop the `showToast` / `goBack` lines -> red.
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

const WIZARD_FILE = path.resolve(__dirname, "..", "TripCreatorWizard.tsx");
const WIZARD_SOURCE = fs.readFileSync(WIZARD_FILE, "utf8");

const GENERIC_SAVE_FAILED =
  "We couldn't save this step. Check your connection and try again.";
const GENERIC_DISCARD_FAILED =
  "We couldn't discard this trip. Check your connection and try again.";

/** Exactly what `@supabase/postgrest-js` hands back on the `{ data, error }` path. */
const postgrestError = (message: string, code: string): Record<string, unknown> => ({
  message,
  code,
  details: null,
  hint: null,
});

// ---------------------------------------------------------------------------
// module boundary
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
const saves = {
  basics: jest.fn<Save>(),
  days: jest.fn<Save>(),
};
const idleMutation = { mutateAsync: saveOk, isPending: false };
const routerPush = jest.fn<(href: unknown) => void>();
const asyncNoop = async (): Promise<undefined> => undefined;
const settledIdle = { isPending: false, isFetching: false, isError: false };

const BOUNDARY: Record<string, () => unknown> = {
  // [TEST-MOD-APPROVED #3859] The #3801 fixture has no installment provider;
  // model the new capability boundary without changing its save-error subject.
  "@mingla/offering-rendering/tripInstallmentCapability": () => ({
    tripInstallmentsSupported: () => false,
  }),
  // #3645 — REAL: the bank-setup return target is pure.
  bankSetupReturn: () => jest.requireActual("../../../utils/bankSetupReturn"),
  react: () => React,
  "react-native": () => jest.requireActual("react-native"),
  "expo-router": () => ({
    useRouter: () => ({ push: routerPush, back: jest.fn(), replace: jest.fn() }),
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
  // REAL: the reason is read and mapped by the shipped modules.
  paidPublishGuards: () => paidPublishGuards,
  rsvpRpcFailure: () => rsvpRpcFailure,
  useBrandPaystack: () => ({
    useBrandPaystackStatus: () => ({ data: undefined, isPending: false }),
  }),
  Button: () => ({ Button: leaf("ButtonProbe") }),
  GlassCard: () => ({ GlassCard: leaf("GlassCardProbe") }),
  Icon: () => ({ Icon: nothing }),
  Stepper: () => ({ Stepper: nothing }),
  // The probe keeps its props, so `visible` and `message` can be read.
  Toast: () => ({ Toast: leaf("ToastProbe") }),
  ConfirmDialog: () => ({ ConfirmDialog: leaf("ConfirmDialog") }),
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
  tripSaveQueue: () => jest.requireActual("../../../utils/tripSaveQueue"),
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

function loadWizard(): React.ComponentType<Record<string, unknown>> {
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
  const module = {
    exports: {} as Record<string, React.ComponentType<Record<string, unknown>>>,
  };
  new Function("require", "module", "exports", output)(
    boundaryRequire,
    module,
    module.exports,
  );
  return module.exports.TripCreatorWizard;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const EVENT_ID = "38010000-0000-4000-8000-0000000000e1";
const BRAND_ID = "brand-3801";

const trip = {
  id: EVENT_ID,
  brandId: BRAND_ID,
  title: "Lisbon long weekend",
  timezone: "Europe/London",
  coverMediaUrl: null,
  coverMediaType: null,
  coverGallery: [],
  themeOverrides: null,
  businessTrip: {
    startAt: "2030-06-01T09:00:00Z",
    endAt: "2030-06-04T18:00:00Z",
    destinationPlaceId: "dest",
    destinationLocationText: "Lisbon",
    destinationLat: 38.72,
    destinationLng: -9.14,
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
      id: "tier-3801",
      eventId: EVENT_ID,
      ticketTypeId: "tt-3801",
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

const mounted: Renderer[] = [];
const mountWizard = async (): Promise<Renderer> => {
  const TripCreatorWizard = loadWizard();
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
const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};
const pressLabel = async (tree: Renderer, label: string): Promise<void> => {
  const found = tree.root.findAll(
    (node) => node.type === "ButtonProbe" && node.props.label === label,
  );
  expect(found).toHaveLength(1);
  await act(async () => {
    (found[0].props.onPress as () => void)();
  });
  await settle();
};
/** Which step body is on screen, by the step component the wizard rendered. */
const onStep = (tree: Renderer, stepComponent: string): boolean =>
  tree.root.findAll((node) => node.type === stepComponent).length > 0;
const toast = (tree: Renderer): { visible: boolean; message: string } => {
  const found = tree.root.findAll((node) => node.type === "ToastProbe");
  expect(found).toHaveLength(1);
  return {
    visible: found[0].props.visible === true,
    message: String(found[0].props.message ?? ""),
  };
};

beforeEach(() => {
  routerPush.mockReset();
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

describe("#3801 — the reader the wizard uses never loses a server reason", () => {
  test("a PostgREST plain object yields its message, where String() yields [object Object]", () => {
    const error = postgrestError("stripe_charges_disabled", "P0001");
    // The defect, stated as a fact about the language rather than about us.
    expect(error instanceof Error).toBe(false);
    expect(String(error)).toBe("[object Object]");
    // The fix.
    expect(rsvpRpcFailure.readRpcFailureMessage(error)).toBe("stripe_charges_disabled");
  });

  test("that message reaches the payments-setup guard copy; [object Object] never could", () => {
    const viaReader = paidPublishGuards.resolveProviderNeutralPaidPublishGuardCopy(
      rsvpRpcFailure.readRpcFailureMessage(postgrestError("stripe_charges_disabled", "P0001")),
    );
    expect(viaReader?.action).toBe("payment_onboarding");
    expect(
      paidPublishGuards.resolveProviderNeutralPaidPublishGuardCopy("[object Object]"),
    ).toBeNull();
  });

  test("nothing readable yields the empty string, never the object tag", () => {
    for (const value of [{}, { message: 42 }, null, undefined, 7]) {
      const read = rsvpRpcFailure.readRpcFailureMessage(value);
      expect(read).toBe("");
      expect(read).not.toContain("[object");
    }
    expect(rsvpRpcFailure.readRpcFailureMessage(new Error("boom"))).toBe("boom");
  });
});

describe("#3801 — a failed step save is shown on that step", () => {
  test("Continue: an unmapped server refusal shows the plain toast and stays on the step", async () => {
    // Issue #3801 (#4134) — a revision conflict is now MAPPED (it offers
    // Reload; see issue_3801_trip_wizard_single_save). This case keeps an
    // unmapped refusal.
    saves.basics.mockRejectedValue(postgrestError("trip_graph_invalid", "22023"));
    const tree = await mountWizard();
    expect(onStep(tree, "TripCreatorStep1Basics")).toBe(true);
    expect(toast(tree).visible).toBe(false);

    await pressLabel(tree, "Continue");

    expect(saves.basics).toHaveBeenCalledTimes(1);
    const shown = toast(tree);
    expect(shown.visible).toBe(true);
    expect(shown.message).toBe(GENERIC_SAVE_FAILED);
    // Never the raw code, never the object tag.
    expect(shown.message).not.toContain("trip_graph_invalid");
    expect(shown.message).not.toContain("[object");
    // A failed save does not advance: the data is not there yet.
    expect(onStep(tree, "TripCreatorStep1Basics")).toBe(true);
    expect(onStep(tree, "TripCreatorStep2Itinerary")).toBe(false);
    expect(routerPush).not.toHaveBeenCalled();
  });

  test("Continue: a thrown Error's developer wording is not shown either", async () => {
    saves.basics.mockRejectedValue(new Error("updateTripBasics: trip not found after update"));
    const tree = await mountWizard();

    await pressLabel(tree, "Continue");

    const shown = toast(tree);
    expect(shown.visible).toBe(true);
    expect(shown.message).toBe(GENERIC_SAVE_FAILED);
  });

  // [TEST-MOD-APPROVED #3645] Approved behaviour change: a step save never
  // sends the host to bank setup. The refusal is still READ off the plain
  // object (the point of #3801) — it is now said on the step, in the locked
  // money-setup copy, and nothing navigates.
  test("Continue: a money-setup refusal as a PLAIN OBJECT is said on the step and does not navigate", async () => {
    saves.basics.mockRejectedValue(postgrestError("stripe_charges_disabled", "P0001"));
    const tree = await mountWizard();

    await pressLabel(tree, "Continue");

    expect(routerPush).not.toHaveBeenCalled();
    const shown = toast(tree);
    expect(shown.visible).toBe(true);
    expect(shown.message).toBe(
      paidPublishGuards.resolveProviderNeutralPaidPublishGuardCopy(
        "stripe_charges_disabled",
      )?.body,
    );
    expect(shown.message).not.toBe(GENERIC_SAVE_FAILED);
    expect(shown.message).not.toContain("[object");
    expect(onStep(tree, "TripCreatorStep1Basics")).toBe(true);
  });

  test("Continue: a successful save still advances and shows no failure toast", async () => {
    const tree = await mountWizard();

    await pressLabel(tree, "Continue");

    expect(onStep(tree, "TripCreatorStep2Itinerary")).toBe(true);
    expect(toast(tree).message).not.toBe(GENERIC_SAVE_FAILED);
  });
});

describe("#3801 — Back is never blocked by a failed save", () => {
  test("Back: the save fails, the toast says so, and the wizard goes back anyway", async () => {
    const tree = await mountWizard();
    await pressLabel(tree, "Continue");
    expect(onStep(tree, "TripCreatorStep2Itinerary")).toBe(true);

    saves.days.mockRejectedValue(postgrestError("trip_days_invalid", "22023"));
    await pressLabel(tree, "Back");

    expect(saves.days).toHaveBeenCalledTimes(1);
    const shown = toast(tree);
    expect(shown.visible).toBe(true);
    expect(shown.message).toBe(GENERIC_SAVE_FAILED);
    expect(shown.message).not.toContain("trip_days_invalid");
    expect(onStep(tree, "TripCreatorStep1Basics")).toBe(true);
    expect(onStep(tree, "TripCreatorStep2Itinerary")).toBe(false);
    expect(routerPush).not.toHaveBeenCalled();
  });

  test("Back: a successful save goes back with no failure toast", async () => {
    const tree = await mountWizard();
    await pressLabel(tree, "Continue");

    await pressLabel(tree, "Back");

    expect(saves.days).toHaveBeenCalledTimes(1);
    expect(onStep(tree, "TripCreatorStep1Basics")).toBe(true);
    expect(toast(tree).message).not.toBe(GENERIC_SAVE_FAILED);
  });

  // [TEST-MOD-APPROVED #3645] Approved behaviour change: Back is never a detour
  // to bank setup. A money-setup refusal now behaves like every other failed
  // save on Back: it is said, and the wizard goes back.
  test("Back: a money-setup refusal is said, does not navigate, and still goes back", async () => {
    const tree = await mountWizard();
    await pressLabel(tree, "Continue");

    saves.days.mockRejectedValue(postgrestError("P0001: stripe_charges_disabled", "P0001"));
    await pressLabel(tree, "Back");

    expect(routerPush).not.toHaveBeenCalled();
    const shown = toast(tree);
    expect(shown.visible).toBe(true);
    expect(shown.message).toBe(
      paidPublishGuards.resolveProviderNeutralPaidPublishGuardCopy(
        "stripe_charges_disabled",
      )?.body,
    );
    expect(onStep(tree, "TripCreatorStep1Basics")).toBe(true);
    expect(onStep(tree, "TripCreatorStep2Itinerary")).toBe(false);
  });
});

describe("#3801 — no thrown save error is read with the instanceof-Error idiom", () => {
  test("the wizard source no longer contains the idiom on a caught error", () => {
    expect(WIZARD_SOURCE).not.toMatch(/\be instanceof Error\b/);
    expect(WIZARD_SOURCE).not.toContain("String(e ??");
  });

  test("discard shows one plain sentence, not the thrown text", () => {
    const start = WIZARD_SOURCE.indexOf("const handleConfirmDiscard = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const body = WIZARD_SOURCE.slice(start, start + 1400);
    expect(body).toContain("setDiscardError(TRIP_DISCARD_FAILED_MESSAGE)");
    expect(body).not.toContain("e.message");
    expect(WIZARD_SOURCE).toContain(GENERIC_DISCARD_FAILED);
    expect(WIZARD_SOURCE).toContain(GENERIC_SAVE_FAILED);
  });
});
