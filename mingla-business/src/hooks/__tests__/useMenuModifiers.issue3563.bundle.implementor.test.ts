/**
 * Issue #3563 — the atomic modifier mutation invalidates authoring, staff-pad,
 * and buyer-ordering caches after installing canonical server truth.
 *
 * The mutation itself sits in an eager shared web path. Importing either the
 * complete order-pad data hook or the venue-ordering barrel solely to obtain a
 * query key hoists those broad modules into Metro's eager `__common` chunk.
 * These probes execute the real module graph and pair each negative assertion
 * with a positive control so an inert mock cannot read as a pass.
 *
 * Fails on revert: restore either broad import in useMenuModifiers.ts and the
 * first test observes that broad module loading during mutation-hook import.
 */
import fs from "node:fs";
import path from "node:path";

const mockBroadModuleLoads = {
  orderPadDataHook: 0,
  venueOrderingBarrel: 0,
};

jest.mock("../useVenueOrderPad", () => {
  mockBroadModuleLoads.orderPadDataHook += 1;
  return {
    orderPadKeys: {
      forBrand: (brandId: string) => ["orderPadMenu", brandId] as const,
    },
  };
});

jest.mock("@mingla/brand-rendering/venueOrdering", () => {
  mockBroadModuleLoads.venueOrderingBarrel += 1;
  return {
    venueOrderingQueryKeys: {
      all: ["venueOrdering"] as const,
    },
  };
});

const hookSource = fs.readFileSync(
  path.resolve(__dirname, "../useMenuModifiers.ts"),
  "utf8",
);

beforeEach(() => {
  mockBroadModuleLoads.orderPadDataHook = 0;
  mockBroadModuleLoads.venueOrderingBarrel = 0;
  jest.resetModules();
});

describe("issue #3563 — atomic modifier saves keep broad readers out of the eager graph", () => {
  test("loading the mutation hook reaches only the lean query-key owners", () => {
    jest.isolateModules(() => {
      const modifiers = jest.requireActual<
        typeof import("../useMenuModifiers")
      >("../useMenuModifiers");
      expect(typeof modifiers.useSaveModifierGroup).toBe("function");
    });

    expect(mockBroadModuleLoads).toEqual({
      orderPadDataHook: 0,
      venueOrderingBarrel: 0,
    });
    expect(hookSource).toContain(
      'from "@mingla/brand-rendering/venueOrdering/venueOrderingQueryKeys"',
    );
    expect(hookSource).toContain('from "./orderPadQueryKeys"');
    expect(hookSource).not.toMatch(
      /from ["']@mingla\/brand-rendering\/venueOrdering["']/,
    );
    expect(hookSource).not.toMatch(/from ["']\.\/useVenueOrderPad["']/);
  });

  test("both broad-module probes fire when their prohibited paths are loaded", () => {
    jest.isolateModules(() => {
      const orderPad = jest.requireMock<{
        orderPadKeys: { forBrand: (brandId: string) => readonly string[] };
      }>("../useVenueOrderPad");
      const venueOrdering = jest.requireMock<{
        venueOrderingQueryKeys: { all: readonly string[] };
      }>("@mingla/brand-rendering/venueOrdering");
      expect(typeof orderPad.orderPadKeys.forBrand).toBe("function");
      expect(venueOrdering.venueOrderingQueryKeys.all).toEqual([
        "venueOrdering",
      ]);
    });

    expect(mockBroadModuleLoads).toEqual({
      orderPadDataHook: 1,
      venueOrderingBarrel: 1,
    });
  });
});
