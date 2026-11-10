/**
 * #4334 rework (P1-1) — a published trip whose pin is re-picked onto the SAME
 * place's refined coordinates keeps its place id.
 *
 * The REAL `EditPublishedTripScreen` source is compiled (the same harness as
 * issue_3801_onboarding_published_capacity_total.tester.adversarial) and its
 * module-private `buildLiveTripPatch` is driven directly; the patch is then
 * handed to the REAL `updateLiveTripFields`, and the command that reaches the
 * network boundary is inspected.
 *
 *   L-1 a same-place refine (only Lat/Lng changed) sends the side's place id,
 *       so Save calls biz_repick_update_trip_live_command
 *   L-2 a pin moved with no place id sends null (the plain command, which
 *       clears the old id)
 *   L-3 an untouched pin sends no pin keys at all
 *
 * Fails on revert: delete the "a moved pin always carries its place id" lines
 * in buildLiveTripPatch and L-1 sees only Lat/Lng and the plain command.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";
import ts from "typescript";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import * as designSystem from "../../../constants/designSystem";
import { updateLiveTripFields } from "../../../services/tripsService";

const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
jest.mock("../../../services/supabase", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({
        data: {
          ok: true, edit_log_entry_id: "log-4334", severity: "additive",
          changed_keys: [], affected_order_count: 0,
        },
        error: null,
      });
    },
  },
}));

const SOURCE = fs.readFileSync(path.join(path.resolve(__dirname, ".."), "EditPublishedTripScreen.tsx"), "utf8");

type EditState = Record<string, unknown>;
interface PatchResult {
  patch: { theme?: { business_trip?: Record<string, unknown> }; [key: string]: unknown };
}
interface Privates {
  tripToLocalEditState: (trip: unknown) => EditState;
  buildLiveTripPatch: (trip: unknown, state: EditState) => PatchResult;
}

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

const PLACE = "ChIJ0Wq9hS_1OxARsFOw5qkW6Y0";
const EVENT_ID = "43340000-0000-4000-8000-0000000000f1";
const trip = {
  id: EVENT_ID, brandId: "brand-4334", title: "Lagos long weekend", description: null,
  timezone: "UTC", coverMediaUrl: null, coverMediaPosterUrl: null, coverMediaType: null, coverGallery: [],
  businessTrip: {
    startAt: "2026-11-12T00:00:00.000Z", endAt: "2026-11-16T23:59:59.000Z",
    destinationPlaceId: "ChIJ8bF1g3T1OxAR5Yx0Qn5pLk8", destinationLocationText: "Lagos",
    destinationLat: 6.45, destinationLng: 3.39,
    departurePlaceId: PLACE, departureLocationText: "London", departureLat: 51.5, departureLng: -0.12,
    capacity: 8,
  },
  days: [], inclusions: [],
  pricingTiers: [{
    id: "tier-1", eventId: EVENT_ID, ticketTypeId: "tt-1", tierName: "Shared", tierMetadata: {},
    priceCents: 120_000, currency: "USD", quantityTotal: 8, ticketsRemaining: 8, isUnlimited: false,
    installmentSchedule: null, description: null,
  }],
  pricingSwitches: { passTax: null, passMinglaFee: null, passServiceFee: null },
  guestPrivacy: { privateGuestList: false, hideRemainingCount: false },
  refundPolicy: null, bookingDeadline: null, bookingsClosed: false, ticketsSoldCount: 0,
};

const save = async (patch: PatchResult["patch"]): Promise<string[]> => {
  await updateLiveTripFields(EVENT_ID, patch as never, "Refined the departure pin", {
    expectedUpdatedAt: "2026-11-10T10:00:00Z", operationId: "op-4334",
  } as never);
  return rpcCalls.map((c) => c.name);
};

describe("#4334 — a re-picked live trip pin keeps its place id", () => {
  const { tripToLocalEditState, buildLiveTripPatch } = loadPrivates();
  beforeEach(() => {
    rpcCalls.length = 0;
  });

  test("L-1 a same-place refine sends the place id and reaches the _repick command", async () => {
    const state = { ...tripToLocalEditState(trip), departureLat: 51.50071, departureLng: -0.12462 };
    const bt = buildLiveTripPatch(trip, state).patch.theme?.business_trip;
    expect(bt).toEqual(expect.objectContaining({
      departurePlaceId: PLACE, departureLat: 51.50071, departureLng: -0.12462,
    }));
    expect(bt).not.toHaveProperty("destinationPlaceId");
    expect(await save(buildLiveTripPatch(trip, state).patch)).toEqual(["biz_repick_update_trip_live_command"]);
  });

  test("L-2 a pin moved with no place id sends null and keeps the plain command", async () => {
    const state = { ...tripToLocalEditState(trip), departurePlaceId: null, departureLat: 48.85, departureLng: 2.35 };
    const bt = buildLiveTripPatch(trip, state).patch.theme?.business_trip;
    expect(bt?.departurePlaceId).toBeNull();
    expect(await save(buildLiveTripPatch(trip, state).patch)).toEqual(["biz_update_trip_live_command"]);
  });

  test("L-3 an untouched pin sends no pin keys", () => {
    const result = buildLiveTripPatch(trip, tripToLocalEditState(trip));
    expect(result.patch.theme).toBeUndefined();
  });
});
