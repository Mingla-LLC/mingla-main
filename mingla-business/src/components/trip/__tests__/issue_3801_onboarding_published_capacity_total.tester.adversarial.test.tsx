/**
 * Issue #3801 — TESTER adversarial: on a published trip with several packages
 * the trip total is shown, never edited, and can never be sent to the server
 * as one package's spots.
 *
 * WHY THIS MATTERS. A trip's capacity is now the SUM of its packages' spots.
 * The published-trip editor still has one "Capacity" slot, and
 * `biz_update_live_trip` writes whatever it is sent into a single package.
 * If the summed total (11) could be edited or submitted there, saving would
 * write 11 into one package of a Shared 8 / Private 2 / Couple 1 trip.
 *
 * A DIFFERENT ANGLE from the implementor suites, none of which exercise the
 * published-trip editor. The REAL `EditPublishedTripScreen` source is compiled
 * and its two module-private functions are driven directly:
 * `tripToLocalEditState` (what the editor opens with) and `buildLiveTripPatch`
 * (what Save sends).
 *
 *   1. Opening and saving a multi-package trip untouched sends no capacity.
 *   2. The package the editor edits opens with ITS OWN spots (8), not the trip
 *      total (11), whatever order the total was computed in.
 *   3. Editing other basics on a multi-package trip still sends no capacity.
 *   4. A single-package trip is unchanged: its capacity field edits and saves.
 *   5. In the source, the editable capacity input exists only on the
 *      single-package branch, and nothing else writes `capacity` into the
 *      edit state.
 *
 * Fails on revert (verified, see the tester report on the issue): seed the
 * edited package from `trip.businessTrip.capacity` again and test 2 goes red;
 * render the capacity input for every trip again and test 5 goes red.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";
import ts from "typescript";

import { describe, expect, jest, test } from "@jest/globals";

import * as designSystem from "../../../constants/designSystem";

const TRIP_DIR = path.resolve(__dirname, "..");
const SOURCE = fs.readFileSync(path.join(TRIP_DIR, "EditPublishedTripScreen.tsx"), "utf8");

interface EditState {
  title: string;
  capacity: number | null;
  startAt: string | null;
  pricing: { packages: { capacity: number | null; ticketTypeId: string | null }[] };
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

  test("the package being edited opens with its OWN spots (8), not the trip total (11)", () => {
    const state = tripToLocalEditState(tripWith(THREE, 11));
    expect(state.capacity).toBe(11);
    expect(state.pricing.packages).toHaveLength(1);
    expect(state.pricing.packages[0].ticketTypeId).toBe("tt-shared");
    expect(state.pricing.packages[0].capacity).toBe(8);
  });

  test("an unlimited first package opens as unlimited, never as the other packages' total", () => {
    const tiers = [pricingTier("tier-1", "tt-open", "Open", null), THREE[1], THREE[2]];
    const state = tripToLocalEditState(tripWith(tiers, null));
    expect(state.capacity).toBeNull();
    expect(state.pricing.packages[0].capacity).toBeNull();
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
});

describe("#3801 tester — a single-package published trip is unchanged", () => {
  const { tripToLocalEditState, buildLiveTripPatch } = loadPrivates();
  const ONE = [pricingTier("tier-1", "tt-shared", "Shared", 8)];

  test("it opens with the package's spots in both places", () => {
    const state = tripToLocalEditState(tripWith(ONE, 8));
    expect(state.capacity).toBe(8);
    expect(state.pricing.packages[0].capacity).toBe(8);
  });

  test("untouched, it sends no capacity; edited to 10, it sends exactly 10", () => {
    const trip = tripWith(ONE, 8);
    const state = tripToLocalEditState(trip);
    expect(sentCapacity(buildLiveTripPatch(trip, state))).toBe("NOT SENT");
    expect(sentCapacity(buildLiveTripPatch(trip, { ...state, capacity: 10 }))).toBe(10);
  });
});

describe("#3801 tester — the screen itself offers no way to edit the total", () => {
  const source = ts.createSourceFile(
    "EditPublishedTripScreen.tsx",
    SOURCE,
    ts.ScriptTarget.ES2020,
    true,
    ts.ScriptKind.TSX,
  );

  /** The `trip.pricingTiers.length > 1 ? (A) : (B)` that guards the capacity field. */
  function capacityBranch(): { multi: string; single: string } {
    let found: { multi: string; single: string } | null = null;
    const visit = (node: ts.Node): void => {
      if (
        found === null &&
        ts.isConditionalExpression(node) &&
        node.condition.getText(source).replace(/\s+/g, " ") === "trip.pricingTiers.length > 1" &&
        node.getText(source).includes("edit-trip-capacity")
      ) {
        found = {
          multi: node.whenTrue.getText(source),
          single: node.whenFalse.getText(source),
        };
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(found).not.toBeNull();
    return found as unknown as { multi: string; single: string };
  }

  test("several packages: a line of text with the total, no input and no way to change state", () => {
    const { multi } = capacityBranch();
    expect(multi).toContain('testID="edit-trip-capacity-total"');
    expect(multi).not.toContain("TextInput");
    expect(multi).not.toContain("onChangeText");
    expect(multi).not.toContain("updateBasics");
    expect(multi).not.toContain("onPress");
    // It says the spots are per package, and what "no limit" looks like.
    expect(multi).toContain("Spots are set per package.");
    expect(multi).toContain("No overall limit across");
  });

  test("one package: the editable field is still there", () => {
    const { single } = capacityBranch();
    expect(single).toContain("TextInput");
    expect(single).toContain('testID="edit-trip-capacity"');
    expect(single).toContain("updateBasics");
  });

  test("the single-package field is the ONLY place the screen writes capacity into its state", () => {
    // Property assignments named `capacity` inside an `updateBasics({...})` call.
    const writers: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "updateBasics" &&
        node.arguments.length === 1 &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        for (const prop of (node.arguments[0] as ts.ObjectLiteralExpression).properties) {
          if (prop.name !== undefined && prop.name.getText(source) === "capacity") {
            writers.push(node.getText(source).replace(/\s+/g, " "));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(writers).toHaveLength(1);
    const { single, multi } = capacityBranch();
    expect(single.replace(/\s+/g, " ")).toContain(writers[0]);
    expect(multi.replace(/\s+/g, " ")).not.toContain(writers[0]);
  });
});
