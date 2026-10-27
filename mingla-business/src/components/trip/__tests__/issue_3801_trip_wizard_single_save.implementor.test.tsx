/**
 * Issue #3801 / #4134 — the trip wizard never sends overlapping saves to one
 * trip, sends and adopts the trip revision, and handles a revision conflict
 * honestly.
 *
 * PRODUCTION EVIDENCE (#3801 comment, 2026-10-26). Step 6 (Traveler info)
 * saved every touched package's questions in a `Promise.all`; both requests
 * carried the same revision, the second was refused with
 * `trip_revision_conflict`, the package's questions were lost and the host saw
 * "Saving…" until they reloaded. Close (X) during a save started a second save
 * the same way. A conflict was then shown as "check your connection", the
 * header said "Unsaved changes — retrying" although nothing retried, and
 * Close swallowed it.
 *
 * HOW. The REAL TripCreatorWizard source is compiled and mounted against an
 * explicit module boundary (the #3439 / #1780 / #3801 compiled-creator
 * pattern). The save queue (`utils/tripSaveQueue`) is the REAL module. Every
 * save the wizard can make is a recorded fake that counts how many are on the
 * wire at once.
 *
 * Fails on revert: restore the Step-6 `Promise.all`, drop the queue or the
 * busy checks, stop passing `revision`, or drop the conflict branch -> red.
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

const WIZARD_FILE = path.resolve(__dirname, "..", "TripCreatorWizard.tsx");
const WIZARD_SOURCE = fs.readFileSync(WIZARD_FILE, "utf8");

const CONFLICT_COPY =
  "This trip was changed somewhere else. Reload to see the latest version.";
const TIMEOUT_COPY =
  "Saving is taking too long. Check your connection and try again.";
const GENERIC_SAVE_FAILED =
  "We couldn't save this step. Check your connection and try again.";

const postgrestError = (message: string, code: string): Record<string, unknown> => ({
  message,
  code,
  details: null,
  hint: null,
});

// ---------------------------------------------------------------------------
// save recorder — every write the wizard can make goes through `record`
// ---------------------------------------------------------------------------

interface Cursor {
  current: string | null;
}
interface SaveCall {
  name: string;
  input: Record<string, unknown>;
  /** The held revision at the moment the save was SENT. */
  revisionAtCall: string | null | undefined;
}
const wire = { inFlight: 0, maxInFlight: 0 };
const calls: SaveCall[] = [];
type Behaviour = (call: SaveCall) => Promise<unknown>;
const behaviours: Record<string, Behaviour> = {};
const defaultBehaviour: Behaviour = async (call) => {
  await new Promise((resolve) => setTimeout(resolve, 5));
  const cursor = call.input.revision as Cursor | undefined;
  // Mimic the service: a successful graph command adopts the new revision.
  if (cursor !== undefined) cursor.current = `rev-after-${call.name}-${calls.length}`;
  return { ticketTypeId: "tt-a" };
};
const record = (name: string) =>
  async (input: unknown = {}): Promise<unknown> => {
    const typed = (input ?? {}) as Record<string, unknown>;
    const call: SaveCall = {
      name,
      input: typed,
      revisionAtCall: (typed.revision as Cursor | undefined)?.current,
    };
    calls.push(call);
    wire.inFlight += 1;
    wire.maxInFlight = Math.max(wire.maxInFlight, wire.inFlight);
    try {
      return await (behaviours[name] ?? defaultBehaviour)(call);
    } finally {
      wire.inFlight -= 1;
    }
  };
const callsNamed = (name: string): SaveCall[] => calls.filter((c) => c.name === name);
const mutationOf = (name: string) => ({ mutateAsync: record(name), isPending: false });

const reloadTrip = jest.fn<(eventId: string) => Promise<unknown>>();
let queueTimeoutMs: number | undefined;
let revisionReads = 0;
/**
 * The stored trip row, as `readTripCoverRevision` reads it. `null` means the
 * row has not been read in this test (the read throws so a stray call shows).
 */
let storedCoverRow: {
  updatedAt: string;
  coverMediaUrl: string | null;
  coverMediaType: string | null;
} | null = null;
let coverRevisionReads = 0;

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
const settledIdle = { isPending: false, isFetching: false, isError: false };
const realQueue = jest.requireActual("../../../utils/tripSaveQueue") as Record<
  string,
  unknown
> & { createTripSaveQueue: (ms?: number) => unknown };

const BOUNDARY: Record<string, () => unknown> = {
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
    useUpdateTripBasics: () => mutationOf("basics"),
    useUpsertTripDays: () => mutationOf("days"),
    useUpsertTripInclusions: () => mutationOf("inclusions"),
    useUpdateTripPricing: () => mutationOf("pricing"),
    useCreateTripPricingTier: () => mutationOf("createTier"),
    useRemoveTripPricingTier: () => mutationOf("removeTier"),
    usePublishTrip: () => mutationOf("publish"),
    useTripWizardServerSync: () => ({
      reloadTrip,
      markTripChanged: (): void => undefined,
    }),
  }),
  useRefundPolicy: () => ({
    useUpdateBookingDeadline: () => mutationOf("deadline"),
    useUpdateRefundPolicy: () => mutationOf("refund"),
  }),
  tripsService: () => ({
    setTripPricingSwitches: (_id: string, input: unknown) =>
      record("switches")(input ?? {}),
    readTripCoverRevision: async () => {
      coverRevisionReads += 1;
      if (storedCoverRow === null) throw new Error("unexpected cover revision read");
      return { ...storedCoverRow };
    },
    readTripRevision: async () => {
      revisionReads += 1;
      return `rev-read-${revisionReads}`;
    },
  }),
  tripSaveQueue: () => ({
    ...realQueue,
    createTripSaveQueue: (ms?: number) =>
      realQueue.createTripSaveQueue(queueTimeoutMs ?? ms),
  }),
  businessEvents: () => ({
    setEventGuestPrivacy: (_id: string, input: unknown) => record("privacy")(input ?? {}),
  }),
  guestListPrivacy: () => jest.requireActual("../../../constants/guestListPrivacy"),
  offeringTheme: () => ({
    normalizeThemeOverrides: (value: unknown) => value ?? null,
    patchOfferingTheme: (input: unknown) => record("theme")(input ?? {}),
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
    useTripIntakeSchemasByEvent: () => ({ data: new Map() }),
    useUpsertTripIntakeSchema: () => mutationOf("intake"),
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
// fixture + helpers
// ---------------------------------------------------------------------------

const EVENT_ID = "38010000-0000-4000-8000-0000000000f1";
const BRAND_ID = "brand-3801";
const LOADED_REVISION = "2027-03-01T10:00:00.000001+00:00";

const tier = (ticketTypeId: string, name: string): Record<string, unknown> => ({
  id: `tier-${ticketTypeId}`,
  eventId: EVENT_ID,
  ticketTypeId,
  tierName: name,
  tierMetadata: {},
  priceCents: 0,
  currency: "GBP",
  quantityTotal: 10,
  ticketsRemaining: 10,
  isUnlimited: false,
  installmentSchedule: null,
  description: null,
});

const trip = {
  id: EVENT_ID,
  brandId: BRAND_ID,
  updatedAt: LOADED_REVISION,
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
  },
  days: [{ ordinal: 1, title: "Day 1", narrative: null, media: [] }],
  inclusions: [],
  pricingTiers: [tier("tt-a", "Shared"), tier("tt-b", "Private")],
  pricingSwitches: { passTax: null, passMinglaFee: null, passServiceFee: null },
  guestPrivacy: { privateGuestList: false, hideRemainingCount: false },
  refundPolicy: null,
  bookingDeadline: null,
  ticketsSoldCount: 0,
};

const mounted: Renderer[] = [];
const onExit = jest.fn<() => void>();
const mountWizard = async (
  initialStep?: number,
  tripOverride?: Record<string, unknown>,
): Promise<Renderer> => {
  const TripCreatorWizard = loadWizard();
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <TripCreatorWizard
        trip={tripOverride ?? trip}
        brand={{ id: BRAND_ID, slug: "issue-3801", name: "Issue 3801" }}
        onPublished={jest.fn()}
        onExit={onExit}
        initialStep={initialStep}
      />,
    );
  });
  mounted.push(tree);
  await settle();
  return tree;
};
const settle = async (ms = 20): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};
const buttons = (tree: Renderer, label: string): TestInstance[] =>
  tree.root.findAll((node) => node.type === "ButtonProbe" && node.props.label === label);
/** Press without waiting for the save to finish (a tap, not a test step). */
const tap = async (tree: Renderer, label: string): Promise<void> => {
  const found = buttons(tree, label);
  expect(found.length).toBeGreaterThan(0);
  await act(async () => {
    (found[0].props.onPress as () => void)();
  });
};
const tapClose = async (tree: Renderer): Promise<void> => {
  const close = tree.root.findAll((node) => node.type === "IconChrome");
  expect(close.length).toBeGreaterThan(0);
  // A web double-activation lands even on a control drawn disabled; call the
  // handler directly so the wizard's own guard is what is tested.
  await act(async () => {
    (close[0].props.onPress as () => void)();
  });
};
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
const screenText = (tree: Renderer): string =>
  tree.root
    .findAll((node) => typeof node.props.children === "string" ||
      (Array.isArray(node.props.children) &&
        (node.props.children as unknown[]).every((c) => typeof c === "string")))
    .map((node) =>
      Array.isArray(node.props.children)
        ? (node.props.children as string[]).join("")
        : String(node.props.children))
    .join("\n");
const deferred = (): { promise: Promise<unknown>; resolve: () => void } => {
  let resolve!: () => void;
  const promise = new Promise<unknown>((res) => {
    resolve = () => res({ ticketTypeId: "tt-a" });
  });
  return { promise, resolve };
};

beforeEach(() => {
  calls.length = 0;
  wire.inFlight = 0;
  wire.maxInFlight = 0;
  revisionReads = 0;
  storedCoverRow = null;
  coverRevisionReads = 0;
  queueTimeoutMs = undefined;
  for (const key of Object.keys(behaviours)) delete behaviours[key];
  onExit.mockReset();
  reloadTrip.mockReset();
  reloadTrip.mockResolvedValue({ ...trip, updatedAt: "rev-reloaded" });
});

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
});

// ---------------------------------------------------------------------------

describe("(a) Step 6 saves every touched package, one at a time", () => {
  test("two dirty packages: two saves, never both on the wire", async () => {
    const tree = await mountWizard(6);
    expect(onStep(tree, "TripCreatorStep6Intake")).toBe(true);
    const step6 = tree.root.findAll((n) => n.type === "TripCreatorStep6Intake")[0];
    const onSchemaChange = step6.props.onSchemaChange as (id: string, next: unknown) => void;
    await act(async () => {
      onSchemaChange("tt-a", { version: 1, questions: [{ id: "q1" }] });
      onSchemaChange("tt-b", { version: 1, questions: [{ id: "q2" }] });
    });

    await tap(tree, "Continue");
    await settle(80);

    const intake = callsNamed("intake");
    expect(intake.map((c) => c.input.ticketTypeId).sort()).toEqual(["tt-a", "tt-b"]);
    expect(wire.maxInFlight).toBe(1);
    // The second package carries the revision the first one made.
    expect(intake[0].revisionAtCall).toBe(LOADED_REVISION);
    expect(intake[1].revisionAtCall).toBe(`rev-after-intake-1`);
    expect(onStep(tree, "TripCreatorStep5Review")).toBe(true);
  });

  test("a failure part-way resends only the package that did not save", async () => {
    let attempt = 0;
    behaviours.intake = async (call) => {
      attempt += 1;
      if (attempt === 2) throw postgrestError("trip_graph_invalid", "22023");
      return defaultBehaviour(call);
    };
    const tree = await mountWizard(6);
    const step6 = tree.root.findAll((n) => n.type === "TripCreatorStep6Intake")[0];
    const onSchemaChange = step6.props.onSchemaChange as (id: string, next: unknown) => void;
    await act(async () => {
      onSchemaChange("tt-a", { version: 1, questions: [{ id: "q1" }] });
      onSchemaChange("tt-b", { version: 1, questions: [{ id: "q2" }] });
    });

    await tap(tree, "Continue");
    await settle(80);
    expect(callsNamed("intake").map((c) => c.input.ticketTypeId)).toEqual(["tt-a", "tt-b"]);
    expect(toast(tree).message).toBe(GENERIC_SAVE_FAILED);

    await tap(tree, "Continue");
    await settle(80);
    expect(callsNamed("intake").map((c) => c.input.ticketTypeId)).toEqual([
      "tt-a",
      "tt-b",
      "tt-b",
    ]);
    expect(wire.maxInFlight).toBe(1);
  });
});

describe("(b) a press during a save never starts a second save", () => {
  test("Close (X) during Continue's save waits for it, then exits without a second save", async () => {
    const gate = deferred();
    behaviours.basics = () => gate.promise;
    const tree = await mountWizard();

    await tap(tree, "Continue");
    await settle();
    expect(callsNamed("basics")).toHaveLength(1);
    // The X is drawn disabled while saving...
    const close = tree.root.findAll((node) => node.type === "IconChrome");
    expect(close[0].props.disabled).toBe(true);
    // ...and a press that lands anyway starts nothing.
    await tapClose(tree);
    await settle();
    expect(callsNamed("basics")).toHaveLength(1);
    expect(onExit).not.toHaveBeenCalled();

    gate.resolve();
    await settle(80);
    expect(callsNamed("basics")).toHaveLength(1);
    expect(wire.maxInFlight).toBe(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  test("a second Continue during the save starts nothing and does not skip a step", async () => {
    const gate = deferred();
    behaviours.basics = () => gate.promise;
    const tree = await mountWizard();

    await tap(tree, "Continue");
    await settle();
    // The button now reads "Saving…"; a web double-activation still calls it.
    await tap(tree, "Saving…");
    await settle();
    expect(callsNamed("basics")).toHaveLength(1);

    gate.resolve();
    await settle(80);
    expect(callsNamed("basics")).toHaveLength(1);
    expect(wire.maxInFlight).toBe(1);
    expect(onStep(tree, "TripCreatorStep2Itinerary")).toBe(true);
  });
});

describe("(c) the wizard sends the revision it loaded and adopts each new one", () => {
  test("Step 1 then Step 2: every save carries the revision the previous one made", async () => {
    const tree = await mountWizard();
    await tap(tree, "Continue");
    await settle(80);
    expect(onStep(tree, "TripCreatorStep2Itinerary")).toBe(true);

    const basics = callsNamed("basics")[0];
    expect(basics.revisionAtCall).toBe(LOADED_REVISION);
    // The theme write cannot return a revision, so it is read once after it.
    expect(revisionReads).toBe(1);
    const pricing = callsNamed("pricing");
    expect(pricing).toHaveLength(2);
    expect(pricing[0].revisionAtCall).toBe("rev-read-1");
    expect(pricing[1].revisionAtCall).toBe(`rev-after-pricing-${calls.indexOf(pricing[0]) + 1}`);
    // One held revision object, shared by every save.
    expect(pricing[0].input.revision).toBe(basics.input.revision);

    const heldAfterStep1 = (basics.input.revision as Cursor).current;
    await tap(tree, "Continue");
    await settle(80);
    const days = callsNamed("days")[0];
    expect(days.revisionAtCall).toBe(heldAfterStep1);
    expect(days.input.revision).toBe(basics.input.revision);
    expect(wire.maxInFlight).toBe(1);
  });
});

describe("(d) a revision conflict is said, never retried, never swallowed", () => {
  test("Continue: the reload copy, a Reload action, an honest header, no retry", async () => {
    behaviours.basics = async () => {
      throw postgrestError("trip_revision_conflict", "PT409");
    };
    const tree = await mountWizard();

    await tap(tree, "Continue");
    await settle(80);
    expect(callsNamed("basics")).toHaveLength(1);
    expect(toast(tree)).toEqual({ visible: true, message: CONFLICT_COPY });
    expect(onStep(tree, "TripCreatorStep1Basics")).toBe(true);
    expect(
      tree.root.findAll((n) => n.props.testID === "trip-wizard-revision-conflict").length,
    ).toBeGreaterThan(0);
    const text = screenText(tree);
    expect(text).toContain(CONFLICT_COPY);
    expect(text).not.toContain("retrying");
    expect(text).not.toContain(GENERIC_SAVE_FAILED);

    // Nothing retries on its own...
    await settle(150);
    expect(callsNamed("basics")).toHaveLength(1);
    // ...and pressing Continue again sends nothing.
    await tap(tree, "Continue");
    await settle(80);
    expect(callsNamed("basics")).toHaveLength(1);
    expect(toast(tree).message).toBe(CONFLICT_COPY);
  });

  test("Close does not swallow it: the first X says it and stays; the second leaves", async () => {
    behaviours.basics = async () => {
      throw postgrestError("trip_revision_conflict", "PT409");
    };
    const tree = await mountWizard();

    await tapClose(tree);
    await settle(80);
    expect(callsNamed("basics")).toHaveLength(1);
    expect(onExit).not.toHaveBeenCalled();
    expect(toast(tree)).toEqual({ visible: true, message: CONFLICT_COPY });

    await tapClose(tree);
    await settle(40);
    expect(callsNamed("basics")).toHaveLength(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  test("Back does not swallow it either, and does not step back", async () => {
    const tree = await mountWizard(2);
    behaviours.days = async () => {
      throw postgrestError("trip_revision_conflict", "PT409");
    };
    await tap(tree, "Back");
    await settle(80);
    expect(toast(tree).message).toBe(CONFLICT_COPY);
    expect(onStep(tree, "TripCreatorStep2Itinerary")).toBe(true);
  });

  test("Reload reads the trip again from the server", async () => {
    behaviours.basics = async () => {
      throw postgrestError("trip_revision_conflict", "PT409");
    };
    const tree = await mountWizard();
    await tap(tree, "Continue");
    await settle(80);

    await tap(tree, "Reload");
    await settle(40);
    expect(reloadTrip).toHaveBeenCalledWith(EVENT_ID);
  });

  test("an intake conflict (the service's named code) is handled the same way", async () => {
    behaviours.intake = async () => {
      throw Object.assign(new Error(CONFLICT_COPY), { code: "trip_revision_conflict" });
    };
    const tree = await mountWizard(6);
    const step6 = tree.root.findAll((n) => n.type === "TripCreatorStep6Intake")[0];
    await act(async () => {
      (step6.props.onSchemaChange as (id: string, next: unknown) => void)("tt-a", {
        version: 1,
        questions: [],
      });
      (step6.props.onSchemaChange as (id: string, next: unknown) => void)("tt-b", {
        version: 1,
        questions: [],
      });
    });
    await tap(tree, "Continue");
    await settle(80);
    // The first refusal stops the rest: tt-b is never sent.
    expect(callsNamed("intake")).toHaveLength(1);
    expect(toast(tree).message).toBe(CONFLICT_COPY);
  });
});

describe("(e) a save that never answers does not leave 'Saving…' forever", () => {
  test("the deadline ends the saving state and says so", async () => {
    queueTimeoutMs = 60;
    behaviours.basics = () => new Promise<unknown>(() => undefined);
    const tree = await mountWizard();

    await tap(tree, "Continue");
    await settle();
    expect(screenText(tree)).toContain("Saving…");

    await settle(150);
    expect(toast(tree)).toEqual({ visible: true, message: TIMEOUT_COPY });
    expect(screenText(tree)).not.toContain("Saving…");
    expect(buttons(tree, "Continue")).toHaveLength(1);
    expect(buttons(tree, "Continue")[0].props.loading).toBe(false);
    const close = tree.root.findAll((node) => node.type === "IconChrome");
    expect(close[0].props.disabled).toBe(false);

    // The request that timed out may still be on the wire: pressing again
    // waits for it (bounded) and does not send a second save alongside it.
    await tap(tree, "Continue");
    await settle(150);
    expect(callsNamed("basics")).toHaveLength(1);
    expect(screenText(tree)).not.toContain("Saving…");
  });
});

// ---------------------------------------------------------------------------
// Rework (tester P1-1): the server applies a cover video while the wizard is
// open. `cover_video_apply_once` UPDATEs events SET cover_media_* and
// updated_at = now() (draft_auto webhook, apply endpoint or reaper, a median
// of 18-42 s after upload). The cover picker then hands Step 1 the video.
// ---------------------------------------------------------------------------

describe("(f) a cover video the server applied is not a conflict; a real edit still is", () => {
  const VIDEO_URL = "https://video.example.test/processed.mp4";
  const APPLIED_REVISION = "2027-03-01T10:00:41.000001+00:00";

  /** The server's compare-and-swap, as in biz_apply_trip_draft_graph. */
  const serverCas = (state: { revision: string }): Behaviour => async (call) => {
    if (call.revisionAtCall !== state.revision) {
      throw postgrestError("trip_revision_conflict", "PT409");
    }
    state.revision = `rev-after-${call.name}-${calls.length}`;
    (call.input.revision as Cursor).current = state.revision;
    return {};
  };
  const emitVideoCover = async (tree: Renderer, url: string): Promise<void> => {
    const step1 = tree.root.findAll((n) => n.type === "TripCreatorStep1Basics")[0];
    await act(async () => {
      (step1.props.onChange as (p: unknown) => void)({
        coverMediaUrl: url,
        coverMediaPosterUrl: "https://video.example.test/poster.jpg",
        coverMediaType: "video",
        coverGallery: [],
      });
    });
  };

  test("the video apply moved the revision: Continue sends the applied revision and moves on", async () => {
    const server = { revision: LOADED_REVISION };
    behaviours.basics = serverCas(server);
    const tree = await mountWizard(1);

    // The server applies the processed video, then the picker emits it.
    server.revision = APPLIED_REVISION;
    storedCoverRow = {
      updatedAt: APPLIED_REVISION,
      coverMediaUrl: VIDEO_URL,
      coverMediaType: "video",
    };
    await emitVideoCover(tree, VIDEO_URL);

    await tap(tree, "Continue");
    await settle(80);

    const basics = callsNamed("basics");
    expect(basics).toHaveLength(1);
    expect(basics[0].revisionAtCall).toBe(APPLIED_REVISION);
    expect(coverRevisionReads).toBe(1);
    expect(toast(tree).message).not.toBe(CONFLICT_COPY);
    expect(onStep(tree, "TripCreatorStep2Itinerary")).toBe(true);
    expect(wire.maxInFlight).toBe(1);
  });

  test("an edit made somewhere else (the row does not hold this video) is still refused, once", async () => {
    const server = { revision: LOADED_REVISION };
    behaviours.basics = serverCas(server);
    const tree = await mountWizard(1);

    // Someone else edited the trip and the stored cover is not this video.
    server.revision = APPLIED_REVISION;
    storedCoverRow = {
      updatedAt: APPLIED_REVISION,
      coverMediaUrl: "https://images.example.test/someone-elses-photo.jpg",
      coverMediaType: "image",
    };
    await emitVideoCover(tree, VIDEO_URL);

    await tap(tree, "Continue");
    await settle(80);

    const basics = callsNamed("basics");
    expect(basics).toHaveLength(1);
    expect(basics[0].revisionAtCall).toBe(LOADED_REVISION);
    expect(toast(tree)).toEqual({ visible: true, message: CONFLICT_COPY });
    expect(onStep(tree, "TripCreatorStep1Basics")).toBe(true);

    // Never retried on its own, and Continue again sends nothing.
    await settle(150);
    await tap(tree, "Continue");
    await settle(80);
    expect(callsNamed("basics")).toHaveLength(1);
  });

  test("no video emit, no extra read: a Step 1 save without a video reads nothing first", async () => {
    const tree = await mountWizard(1);
    await tap(tree, "Continue");
    await settle(80);
    expect(coverRevisionReads).toBe(0);
    expect(callsNamed("basics")[0].revisionAtCall).toBe(LOADED_REVISION);
  });
});

// ---------------------------------------------------------------------------
// Rework 3 (tester retest-2 P1-3): a save is a patch that never clobbers the
// cover. `cover_video_apply_once` writes the host's video onto the trip on its
// own, often after "Close — keep working" unmounted the picker, or after the
// host tapped Continue while the video processed. A Step-1 save or Publish
// from that session used to send the session's old cover (often EMPTY) back.
// Now cover fields ride only when the host changed the cover in this session,
// and never while one of their cover videos is processing.
// ---------------------------------------------------------------------------

describe("(g) Step 1 saves and Publish never put an old or empty cover over the server's", () => {
  const PHOTO_URL = "https://images.example.test/original-photo.jpg";
  const VIDEO_URL = "https://video.example.test/processed.mp4";
  const tripWithPhoto = {
    ...trip,
    coverMediaUrl: PHOTO_URL,
    coverMediaType: "image",
    coverGallery: [{ url: "https://images.example.test/extra-1.jpg", type: "image" }],
  };

  /**
   * The stored trip row, as `biz_apply_trip_draft_graph` merges a patch into
   * it: a key the patch leaves out keeps the stored value.
   */
  const storedRow = (): Record<string, unknown> => ({
    coverMediaUrl: PHOTO_URL,
    coverMediaType: "image",
  });
  const patchMerger = (row: Record<string, unknown>): Behaviour => async (call) => {
    const patch = (call.input.patch ?? {}) as Record<string, unknown>;
    for (const key of ["coverMediaUrl", "coverMediaType", "coverGallery"]) {
      if (key in patch) row[key] = patch[key];
    }
    (call.input.revision as Cursor).current = `rev-after-${call.name}-${calls.length}`;
    return {};
  };
  const step1 = (tree: Renderer): TestInstance =>
    tree.root.findAll((n) => n.type === "TripCreatorStep1Basics")[0];
  /** The cover picker reports a video uploading / processing (or done). */
  const reportVideoProcessing = async (tree: Renderer, processing: boolean): Promise<void> => {
    const handler = step1(tree).props.onCoverVideoProcessingChange as
      | ((p: boolean) => void)
      | undefined;
    expect(typeof handler).toBe("function");
    await act(async () => {
      handler?.(processing);
    });
  };
  const pickCover = async (tree: Renderer, patch: Record<string, unknown>): Promise<void> => {
    await act(async () => {
      (step1(tree).props.onChange as (p: unknown) => void)(patch);
    });
  };
  const patchOf = (call: SaveCall): Record<string, unknown> =>
    (call.input.patch ?? {}) as Record<string, unknown>;
  const COVER_KEYS = ["coverMediaUrl", "coverMediaType", "coverMediaPosterUrl"];
  const sentCoverKeys = (call: SaveCall): string[] =>
    COVER_KEYS.filter((key) => key in patchOf(call));

  test("P1-3a: picker closed while the video processes; the server applies it; Continue sends no cover", async () => {
    const row = storedRow();
    behaviours.basics = patchMerger(row);
    const tree = await mountWizard(1, tripWithPhoto);

    // The host adds a video; it starts processing; they tap "Close — keep
    // working" (the picker unmounts and reports nothing more).
    await reportVideoProcessing(tree, true);
    // The server applies the video to the trip while nobody listens.
    row.coverMediaUrl = VIDEO_URL;
    row.coverMediaType = "video";

    await tap(tree, "Continue");
    await settle(80);

    const basics = callsNamed("basics");
    expect(basics).toHaveLength(1);
    expect(sentCoverKeys(basics[0])).toEqual([]);
    expect("coverGallery" in patchOf(basics[0])).toBe(false);
    expect(row).toEqual({ coverMediaUrl: VIDEO_URL, coverMediaType: "video" });
    expect(onStep(tree, "TripCreatorStep2Itinerary")).toBe(true);
  });

  test("P1-3b: Continue while the video processes, then Back and Continue again: the applied video survives every save", async () => {
    const row = storedRow();
    behaviours.basics = patchMerger(row);
    const tree = await mountWizard(1, tripWithPhoto);
    await reportVideoProcessing(tree, true);

    await tap(tree, "Continue"); // Step 1 save while the video processes
    await settle(80);
    expect(onStep(tree, "TripCreatorStep2Itinerary")).toBe(true);

    // The video applies while the host is on Step 2.
    row.coverMediaUrl = VIDEO_URL;
    row.coverMediaType = "video";

    await tap(tree, "Continue"); // Step 2 save
    await settle(80);
    await tap(tree, "Back");
    await settle(80);
    await tap(tree, "Back");
    await settle(80);
    expect(onStep(tree, "TripCreatorStep1Basics")).toBe(true);
    await tap(tree, "Continue"); // Step 1 save again (the picker never reopened)
    await settle(80);

    const basics = callsNamed("basics");
    expect(basics.length).toBeGreaterThanOrEqual(2);
    for (const call of basics) expect(sentCoverKeys(call)).toEqual([]);
    expect(row).toEqual({ coverMediaUrl: VIDEO_URL, coverMediaType: "video" });
  });

  test("a photo picked first, then a video started: the video is the cover, so the photo is not sent over it", async () => {
    const row = storedRow();
    behaviours.basics = patchMerger(row);
    const tree = await mountWizard(1, tripWithPhoto);
    const EARLIER_PHOTO = "https://images.example.test/picked-first.jpg";
    await pickCover(tree, {
      coverMediaUrl: EARLIER_PHOTO,
      coverMediaPosterUrl: EARLIER_PHOTO,
      coverMediaType: "image",
      coverGallery: tripWithPhoto.coverGallery,
    });
    // Then the host adds a video instead and closes the sheet while it
    // processes; the server applies it.
    await reportVideoProcessing(tree, true);
    row.coverMediaUrl = VIDEO_URL;
    row.coverMediaType = "video";

    await tap(tree, "Continue");
    await settle(80);
    expect(sentCoverKeys(callsNamed("basics")[0])).toEqual([]);
    expect(row).toEqual({ coverMediaUrl: VIDEO_URL, coverMediaType: "video" });
  });

  test("Publish while a cover video processes sends no cover fields", async () => {
    const tree = await mountWizard(1, tripWithPhoto);
    await pickCover(tree, {
      coverMediaUrl: "https://images.example.test/picked-first.jpg",
      coverMediaPosterUrl: "https://images.example.test/picked-first.jpg",
      coverMediaType: "image",
      coverGallery: tripWithPhoto.coverGallery,
    });
    await reportVideoProcessing(tree, true);
    const dialog = tree.root.findAll(
      (n) => n.type === "ConfirmDialog" && n.props.title === "Publish trip?",
    )[0];
    await act(async () => {
      void (dialog.props.onConfirm as () => Promise<void>)();
    });
    await settle(80);

    const publish = callsNamed("publish");
    expect(publish).toHaveLength(1);
    const payload = publish[0].input.draftPayload as Record<string, unknown>;
    for (const key of ["cover_media_url", "cover_media_type", "cover_media_poster_url", "cover_media_gallery"]) {
      expect(key in payload).toBe(false);
    }
    expect(payload.title).toBe("Lisbon long weekend");
  });

  test("an untouched cover is never sent, by Continue or by Publish", async () => {
    const tree = await mountWizard(1, tripWithPhoto);
    await tap(tree, "Continue");
    await settle(80);
    expect(sentCoverKeys(callsNamed("basics")[0])).toEqual([]);
    expect("coverGallery" in patchOf(callsNamed("basics")[0])).toBe(false);

    const dialog = tree.root.findAll(
      (n) => n.type === "ConfirmDialog" && n.props.title === "Publish trip?",
    )[0];
    await act(async () => {
      void (dialog.props.onConfirm as () => Promise<void>)();
    });
    await settle(80);
    const payload = callsNamed("publish")[0].input.draftPayload as Record<string, unknown>;
    expect("cover_media_url" in payload).toBe(false);
  });

  test("a cover the host picks is sent once; the next save does not send it again", async () => {
    const tree = await mountWizard(1, tripWithPhoto);
    const NEW_PHOTO = "https://images.example.test/new-photo.jpg";
    await pickCover(tree, {
      coverMediaUrl: NEW_PHOTO,
      coverMediaPosterUrl: NEW_PHOTO,
      coverMediaType: "image",
      coverGallery: tripWithPhoto.coverGallery,
    });
    await tap(tree, "Continue");
    await settle(80);
    await tap(tree, "Back");
    await settle(80);
    await tap(tree, "Continue");
    await settle(80);

    const basics = callsNamed("basics");
    expect(patchOf(basics[0]).coverMediaUrl).toBe(NEW_PHOTO);
    expect(patchOf(basics[0]).coverMediaType).toBe("image");
    // The gallery did not change, so it is not sent.
    expect("coverGallery" in patchOf(basics[0])).toBe(false);
    const stepOneSaves = basics.filter((c) => "title" in patchOf(c));
    expect(stepOneSaves.length).toBeGreaterThanOrEqual(2);
    expect(sentCoverKeys(stepOneSaves[stepOneSaves.length - 1])).toEqual([]);
  });

  test("removing the cover while nothing processes is still saved (a deliberate removal)", async () => {
    const tree = await mountWizard(1, tripWithPhoto);
    await pickCover(tree, {
      coverMediaUrl: null,
      coverMediaPosterUrl: null,
      coverMediaType: null,
      coverGallery: tripWithPhoto.coverGallery,
    });
    await tap(tree, "Continue");
    await settle(80);
    const patch = patchOf(callsNamed("basics")[0]);
    expect(patch.coverMediaUrl).toBeNull();
    expect(patch.coverMediaType).toBeNull();
  });

  test("a photo picked after the video started ends the hold: the host's pick is saved", async () => {
    const tree = await mountWizard(1, tripWithPhoto);
    await reportVideoProcessing(tree, true);
    const NEW_PHOTO = "https://images.example.test/picked-instead.jpg";
    await pickCover(tree, {
      coverMediaUrl: NEW_PHOTO,
      coverMediaPosterUrl: NEW_PHOTO,
      coverMediaType: "image",
      coverGallery: tripWithPhoto.coverGallery,
    });
    // A later progress report from the same video does not hold the pick back.
    await reportVideoProcessing(tree, true);
    await tap(tree, "Continue");
    await settle(80);
    expect(patchOf(callsNamed("basics")[0]).coverMediaUrl).toBe(NEW_PHOTO);
  });

  test("gallery photos the host changed are saved even while a cover video processes", async () => {
    const tree = await mountWizard(1, tripWithPhoto);
    await reportVideoProcessing(tree, true);
    const gallery = [
      ...tripWithPhoto.coverGallery,
      { url: "https://images.example.test/extra-2.jpg", type: "image" },
    ];
    await act(async () => {
      (step1(tree).props.onChange as (p: unknown) => void)({ coverGallery: gallery });
    });
    await tap(tree, "Continue");
    await settle(80);
    const patch = patchOf(callsNamed("basics")[0]);
    expect(patch.coverGallery).toEqual(gallery);
    expect(sentCoverKeys(callsNamed("basics")[0])).toEqual([]);
  });

  test("the video finishing while the picker is open hands the host the video, which is then saved", async () => {
    const tree = await mountWizard(1, tripWithPhoto);
    await reportVideoProcessing(tree, true);
    await reportVideoProcessing(tree, false);
    await pickCover(tree, {
      coverMediaUrl: VIDEO_URL,
      coverMediaPosterUrl: "https://video.example.test/poster.jpg",
      coverMediaType: "video",
      coverGallery: tripWithPhoto.coverGallery,
    });
    storedCoverRow = { updatedAt: LOADED_REVISION, coverMediaUrl: VIDEO_URL, coverMediaType: "video" };
    await tap(tree, "Continue");
    await settle(80);
    const patch = patchOf(callsNamed("basics")[0]);
    expect(patch.coverMediaUrl).toBe(VIDEO_URL);
    expect(patch.coverMediaType).toBe("video");
  });
});
