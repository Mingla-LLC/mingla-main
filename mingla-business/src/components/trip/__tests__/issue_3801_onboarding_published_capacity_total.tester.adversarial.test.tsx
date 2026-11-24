/**
 * Issues #3801/#4522 — TESTER adversarial: the published editor renders every
 * package's stored capacity read-only and never sends a capacity change.
 *
 * WHY THIS MATTERS. A trip's capacity is now the SUM of its packages' spots.
 * `biz_update_live_trip` cannot safely change per-package capacities. If the
 * summed total (11) were submitted, saving could overwrite one package in a
 * Shared 8 / Private 2 / Couple 1 trip.
 *
 * A DIFFERENT ANGLE from the implementor suites, none of which exercise the
 * published-trip editor. The REAL `EditPublishedTripScreen` source is compiled
 * and its two module-private functions are driven directly:
 * `tripToLocalEditState` (what the editor opens with) and `buildLiveTripPatch`
 * (what Save sends).
 *
 *   1. Opening and saving a multi-package trip untouched sends no capacity.
 *   2. Every package opens with its own spots (8 / 2 / 1), not the trip total.
 *   3. Editing other basics on a multi-package trip still sends no capacity.
 *   4. Single-package capacity is read-only after publish too.
 *   5. The screen explicitly disables capacity and package-count changes in
 *      the shared pricing component.
 *   6. THE WIRE. The patch the editor builds is handed to the REAL
 *      `updateLiveTripFields` service and the request that reaches the server
 *      (the `biz_update_trip_live_command` arguments) is inspected: no capacity
 *      anywhere in it for multi- or single-package trips.
 *
 * Fails on revert: collapse the editor back to one package, enable capacity
 * changes, or serialize capacity into the patch and this suite goes red.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";
import ts from "typescript";

import { describe, expect, jest, test } from "@jest/globals";

import * as designSystem from "../../../constants/designSystem";
import { updateLiveTripFields } from "../../../services/tripsService";

// The network boundary only. The service that builds the request is REAL.
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
jest.mock("../../../services/supabase", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({
        data: {
          ok: true,
          edit_log_entry_id: "log-3801",
          severity: "additive",
          changed_keys: Object.keys((args.p_patch ?? {}) as Record<string, unknown>),
          affected_order_count: 0,
        },
        error: null,
      });
    },
  },
}));

const TRIP_DIR = path.resolve(__dirname, "..");
const SOURCE = fs.readFileSync(path.join(TRIP_DIR, "EditPublishedTripScreen.tsx"), "utf8");
const PRICING_SOURCE = fs.readFileSync(
  path.join(TRIP_DIR, "TripCreatorStep4Pricing.tsx"),
  "utf8",
);

interface EditState {
  title: string;
  startAt: string | null;
  pricing: {
    packages: {
      capacity: number | null;
      ticketTypeId: string | null;
      priceMajor?: string;
      paymentPlan?: unknown;
    }[];
  };
  [key: string]: unknown;
}
interface PatchResult {
  patch: {
    title?: string;
    theme?: { business_trip?: Record<string, unknown> };
    pricing_tiers?: Record<string, unknown>[];
    [key: string]: unknown;
  };
}
interface Privates {
  tripToLocalEditState: (trip: unknown) => EditState;
  buildLiveTripPatch: (trip: unknown, state: EditState) => PatchResult;
}

/**
 * Everything the screen imports that these two functions do not touch is a
 * stand-in that can be called, rendered or read without doing anything.
 */
function inert(): unknown {
  const fn = function Inert(): null {
    return null;
  };
  return new Proxy(fn, {
    get: (target, prop) => {
      if (prop === "__esModule") return true;
      if (prop === "prototype") return (target as unknown as { prototype: unknown }).prototype;
      if (typeof prop === "symbol") return undefined;
      return inert();
    },
    apply: () => inert(),
  });
}

function loadPrivates(): Privates {
  const real: Record<string, () => unknown> = {
    react: () => React,
    "react-native": () => jest.requireActual("react-native"),
    designSystem: () => designSystem,
    tripPlanV2EditorModel: () =>
      jest.requireActual("../tripPlanV2EditorModel"),
  };
  const output =
    ts.transpileModule(SOURCE, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText +
    "\nmodule.exports.__privates = { tripToLocalEditState, buildLiveTripPatch };\n";
  const boundaryRequire = (specifier: string): unknown => {
    const supply = real[specifier] ?? real[specifier.split("/").pop() as string];
    return supply !== undefined ? supply() : inert();
  };
  const module = { exports: {} as { __privates?: Privates } };
  new Function("require", "module", "exports", output)(boundaryRequire, module, module.exports);
  const privates = module.exports.__privates as Privates;
  expect(typeof privates.tripToLocalEditState).toBe("function");
  expect(typeof privates.buildLiveTripPatch).toBe("function");
  return privates;
}

const EVENT_ID = "38010000-0000-4000-8000-0000000000f1";

const pricingTier = (
  id: string,
  ticketTypeId: string,
  name: string,
  spots: number | null,
): Record<string, unknown> => ({
  id,
  eventId: EVENT_ID,
  ticketTypeId,
  tierName: name,
  tierMetadata: {},
  priceCents: 120_000,
  currency: "USD",
  quantityTotal: spots,
  ticketsRemaining: spots,
  isUnlimited: spots === null,
  installmentSchedule: null,
  description: null,
});

const tripWith = (
  tiers: Record<string, unknown>[],
  capacity: number | null,
): Record<string, unknown> => ({
  id: EVENT_ID,
  brandId: "brand-3801",
  title: "Lagos long weekend",
  description: null,
  timezone: "UTC",
  coverMediaUrl: null,
  coverMediaPosterUrl: null,
  coverMediaType: null,
  coverGallery: [],
  businessTrip: {
    startAt: "2026-11-12T00:00:00.000Z",
    endAt: "2026-11-16T23:59:59.000Z",
    destinationPlaceId: "dest",
    destinationLocationText: "Lagos",
    destinationLat: 6.45,
    destinationLng: 3.39,
    departurePlaceId: "dep",
    departureLocationText: "London",
    departureLat: 51.5,
    departureLng: -0.12,
    // What the host read now returns: the SUM of the packages' spots.
    capacity,
  },
  days: [],
  inclusions: [],
  pricingTiers: tiers,
  pricingSwitches: { passTax: null, passMinglaFee: null, passServiceFee: null },
  guestPrivacy: { privateGuestList: false, hideRemainingCount: false },
  refundPolicy: null,
  bookingDeadline: null,
  bookingsClosed: false,
  ticketsSoldCount: 0,
});

const THREE = [
  pricingTier("tier-1", "tt-shared", "Shared", 8),
  pricingTier("tier-2", "tt-private", "Private", 2),
  pricingTier("tier-3", "tt-couple", "Couple", 1),
];

// The retired theme key is read by name here, never as a property path: this
// suite proves the key is NOT sent, and the trip canonical-column gate
// (I-PROPOSED-TRIP-CANONICAL-COLUMNS) forbids spelling that path in source.
const RETIRED_THEME_CAPACITY_KEY = "capacity";
const sentCapacity = (result: PatchResult): unknown => {
  const tripTheme: Record<string, unknown> | undefined =
    result.patch.theme?.business_trip;
  return tripTheme !== undefined && RETIRED_THEME_CAPACITY_KEY in tripTheme
    ? tripTheme[RETIRED_THEME_CAPACITY_KEY]
    : "NOT SENT";
};

describe("#3801 tester — a multi-package published trip never submits a capacity", () => {
  const { tripToLocalEditState, buildLiveTripPatch } = loadPrivates();

  test("open and save untouched: nothing about capacity is sent", () => {
    const trip = tripWith(THREE, 11);
    const state = tripToLocalEditState(trip);
    const result = buildLiveTripPatch(trip, state);
    expect(sentCapacity(result)).toBe("NOT SENT");
    expect(result.patch.theme).toBeUndefined();
    expect(result.patch.pricing_tiers).toBeUndefined();
  });

  test("every package opens with its own spots, never the trip total", () => {
    const state = tripToLocalEditState(tripWith(THREE, 11));
    expect(state.pricing.packages).toHaveLength(3);
    expect(
      state.pricing.packages.map(({ ticketTypeId, capacity }) => ({
        ticketTypeId,
        capacity,
      })),
    ).toEqual([
      { ticketTypeId: "tt-shared", capacity: 8 },
      { ticketTypeId: "tt-private", capacity: 2 },
      { ticketTypeId: "tt-couple", capacity: 1 },
    ]);
  });

  test("an unlimited first package opens as unlimited, never as the other packages' total", () => {
    const tiers = [pricingTier("tier-1", "tt-open", "Open", null), THREE[1], THREE[2]];
    const state = tripToLocalEditState(tripWith(tiers, null));
    expect(state.pricing.packages[0].capacity).toBeNull();
    expect(state.pricing.packages[1].capacity).toBe(2);
    expect(state.pricing.packages[2].capacity).toBe(1);
  });

  test("changing the title on a multi-package trip sends the title and still no capacity", () => {
    const trip = tripWith(THREE, 11);
    const state = { ...tripToLocalEditState(trip), title: "Lagos long weekend, extended" };
    const result = buildLiveTripPatch(trip, state);
    expect(result.patch.title).toBe("Lagos long weekend, extended");
    expect(sentCapacity(result)).toBe("NOT SENT");
  });

  test("changing a date on a multi-package trip sends the date and still no capacity", () => {
    const trip = tripWith(THREE, 11);
    const state = { ...tripToLocalEditState(trip), startAt: "2026-11-13T00:00:00.000Z" };
    const result = buildLiveTripPatch(trip, state);
    expect(result.patch.theme?.business_trip).toEqual({ startAt: "2026-11-13T00:00:00.000Z" });
  });

  test("a missing local row cannot become a live-tier deletion", () => {
    const trip = tripWith(THREE, 11);
    const state = tripToLocalEditState(trip);
    state.pricing.packages = state.pricing.packages.filter(
      (pkg) => pkg.ticketTypeId !== "tt-private",
    );
    state.pricing.packages[0].priceMajor = "1300.00";

    const result = buildLiveTripPatch(trip, state);
    expect(result.patch.pricing_tiers).toEqual([
      { ticket_type_id: "tt-shared", price_cents: 130000 },
      { ticket_type_id: "tt-private" },
      { ticket_type_id: "tt-couple" },
    ]);
  });

  test("v2 plan replacement preserves unrelated metadata and removes v1", () => {
    const legacyPlan = {
      deposit_pct: 25,
      installments: [{ pct: 75, due_days_before_start: 30 }],
    };
    const v2Plan = {
      v: 2 as const,
      deposit: { mode: "percent" as const, pct: 20 },
      count: 4,
      final_due_days_before_start: 21,
      auto_adjust: true,
      flex: { enabled: false as const },
      custom_amounts_minor: null,
    };
    const tier = pricingTier("tier-1", "tt-shared", "Shared", 8);
    tier.tierMetadata = {
      campaign: "fall",
      installments: legacyPlan,
      description: "legacy duplicate",
    };
    tier.installmentSchedule = legacyPlan;
    const trip = tripWith([tier], 8);
    const state = tripToLocalEditState(trip);
    state.pricing.packages[0].paymentPlan = v2Plan;

    const result = buildLiveTripPatch(trip, state);
    expect(result.patch.pricing_tiers).toEqual([
      {
        ticket_type_id: "tt-shared",
        tier_metadata: {
          campaign: "fall",
          payment_plan: v2Plan,
        },
      },
    ]);
  });

  test("removing a plan leaves neither metadata plan key", () => {
    const legacyPlan = {
      deposit_pct: 25,
      installments: [{ pct: 75, due_days_before_start: 30 }],
    };
    const tier = pricingTier("tier-1", "tt-shared", "Shared", 8);
    tier.tierMetadata = { campaign: "fall", installments: legacyPlan };
    tier.installmentSchedule = legacyPlan;
    const trip = tripWith([tier], 8);
    const state = tripToLocalEditState(trip);
    state.pricing.packages[0].paymentPlan = null;

    const result = buildLiveTripPatch(trip, state);
    expect(result.patch.pricing_tiers).toEqual([
      {
        ticket_type_id: "tt-shared",
        tier_metadata: { campaign: "fall" },
      },
    ]);
  });
});

describe("#4522 tester — a single-package published trip is capacity-read-only", () => {
  const { tripToLocalEditState, buildLiveTripPatch } = loadPrivates();
  const ONE = [pricingTier("tier-1", "tt-shared", "Shared", 8)];

  test("it opens with the package's spots", () => {
    const state = tripToLocalEditState(tripWith(ONE, 8));
    expect(state.pricing.packages[0].capacity).toBe(8);
  });

  test("even a forged local capacity change is not serialized", () => {
    const trip = tripWith(ONE, 8);
    const state = tripToLocalEditState(trip);
    expect(sentCapacity(buildLiveTripPatch(trip, state))).toBe("NOT SENT");
    state.pricing.packages[0].capacity = 10;
    const forged = buildLiveTripPatch(trip, state);
    expect(sentCapacity(forged)).toBe("NOT SENT");
    expect(forged.patch.pricing_tiers).toBeUndefined();
  });
});

describe("#4522 tester — the screen offers no published capacity edit", () => {
  test("published pricing disables capacity and package structure changes", () => {
    expect(SOURCE).toContain("allowPackageStructureChanges={false}");
    expect(SOURCE).toContain("allowCapacityChange={false}");
    expect(SOURCE).toContain("showSharePaymentPlanControl={false}");
  });

  test("the shared pricing body has an explicit read-only capacity branch", () => {
    expect(PRICING_SOURCE).toContain("allowCapacityChange ? (");
    expect(PRICING_SOURCE).toContain(
      'testID={`trip-step4-capacity-readonly-${index}`}',
    );
    expect(PRICING_SOURCE).toContain(
      "Package capacity and package count stay fixed after publishing.",
    );
  });

  test("the published screen has no trip-level capacity setter", () => {
    expect(SOURCE).not.toContain("state.capacity");
    expect(SOURCE).not.toContain("bt.capacity");
    expect(SOURCE).not.toContain('testID="edit-trip-capacity"');
  });
});

// ---------------------------------------------------------------------------
// 6. the wire: what Save actually sends to the server
// ---------------------------------------------------------------------------

describe("#3801 tester — the request that reaches the server carries no summed capacity", () => {
  const { tripToLocalEditState, buildLiveTripPatch } = loadPrivates();
  const REVISION = "2026-10-12T22:28:41.000Z";

  /** Every `capacity` key anywhere inside a value, with the path that led to it. */
  const capacityPaths = (value: unknown, at = "p_patch"): string[] => {
    if (value === null || typeof value !== "object") return [];
    const found: string[] = [];
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const here = `${at}.${key}`;
      if (key === RETIRED_THEME_CAPACITY_KEY) found.push(`${here}=${String(child)}`);
      found.push(...capacityPaths(child, here));
    }
    return found;
  };

  /** Open the editor state, apply an edit, and Save through the real service. */
  const save = async (
    trip: Record<string, unknown>,
    edit: Partial<EditState>,
  ): Promise<Record<string, unknown>> => {
    rpcCalls.length = 0;
    const state = { ...tripToLocalEditState(trip), ...edit } as EditState;
    const { patch } = buildLiveTripPatch(trip, state);
    const result = await updateLiveTripFields(EVENT_ID, patch as never, "Tester save", {
      operationId: "38010000-0000-4000-8000-00000000aaaa",
      expectedUpdatedAt: REVISION,
    });
    expect(result.ok).toBe(true);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe("biz_update_trip_live_command");
    expect(rpcCalls[0].args.p_event_id).toBe(EVENT_ID);
    expect(rpcCalls[0].args.p_expected_updated_at).toBe(REVISION);
    return rpcCalls[0].args.p_patch as Record<string, unknown>;
  };

  test("Shared 8 / Private 2 / Couple 1, title edited: the request has the title and no capacity at all", async () => {
    const sent = await save(tripWith(THREE, 11), { title: "Lagos long weekend, extended" });
    expect(sent.title).toBe("Lagos long weekend, extended");
    expect(capacityPaths(sent)).toEqual([]);
    // The total (11) is not smuggled in under any other name either.
    expect(JSON.stringify(sent)).not.toMatch(/\b11\b/);
  });

  test("multi-package, a date edited: only the date travels", async () => {
    const sent = await save(tripWith(THREE, 11), { startAt: "2026-11-13T00:00:00.000Z" });
    expect(sent).toEqual({ theme: { business_trip: { startAt: "2026-11-13T00:00:00.000Z" } } });
    expect(capacityPaths(sent)).toEqual([]);
  });

  test("single package, title edited: the request still carries no capacity", async () => {
    const sent = await save(
      tripWith([pricingTier("tier-1", "tt-shared", "Shared", 8)], 8),
      { title: "Lagos long weekend, extended" },
    );
    expect(sent.title).toBe("Lagos long weekend, extended");
    expect(capacityPaths(sent)).toEqual([]);
  });
});
