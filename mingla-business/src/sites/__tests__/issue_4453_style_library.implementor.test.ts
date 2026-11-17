/*
 * #4453 milestone 7 — SITES_STYLE_LIBRARY gates which styles the Business
 * look pickers offer (off: Atelier and Voyage, as before; on: the ten styles
 * with their fixed fit). An owner may pick an "avoid" style: it shows the
 * fixed warning and is never blocked (D6). The plan read carries Core's flag.
 */
import { lookPickerKeys, planFormatOf, styleFitLabel } from "../styleLibrary";
import { normalizeSitePlan } from "../sitePlanState";
import { readFileSync } from "fs";
import { join } from "path";

describe("#4453 SITES_STYLE_LIBRARY look picker", () => {
  it("off: Atelier and Voyage only; a design already in use stays listed", () => {
    expect(lookPickerKeys(false, null)).toEqual(["atelier", "voyage"]);
    expect(lookPickerKeys(false, "nocturne")).toEqual(["nocturne", "atelier", "voyage"]);
  });

  it("on: the ten styles (Atelier only when it is the design in use)", () => {
    const keys = lookPickerKeys(true, null);
    expect(keys).toHaveLength(10);
    expect(keys).not.toContain("atelier");
    expect(lookPickerKeys(true, "atelier")[0]).toBe("atelier");
  });

  it("fit labels come from the fixed table; avoid warns, never blocks", () => {
    expect(styleFitLabel("trips", "voyage")).toEqual({
      fit: "pick",
      label: "Ari's pick",
      reason: "Big landscapes and a sociable voice for group trips.",
      warning: null,
    });
    const avoid = styleFitLabel("trips", "pulse")!;
    expect(avoid.fit).toBe("avoid");
    expect(avoid.warning).toBe("This style is built for other kinds of places. Your bookings will still work.");
    expect(styleFitLabel(null, "voyage")).toBeNull();
    expect(styleFitLabel("trips", "atelier")).toBeNull();
  });

  it("the plan's format follows the main action, else the first tick", () => {
    expect(planFormatOf({ offeringsSelected: ["trips", "events"], story: null })).toBe("trips");
    expect(planFormatOf({ offeringsSelected: ["trips", "events"], story: { main_action: "Come to an event" } })).toBe("events");
    expect(planFormatOf(null)).toBeNull();
  });

  it("the plan read carries Core's flag (false unless Core says true)", () => {
    expect(normalizeSitePlan("b", { style_library: true }).styleLibrary).toBe(true);
    expect(normalizeSitePlan("b", { style_library: "yes" }).styleLibrary).toBe(false);
    expect(normalizeSitePlan("b", {}).styleLibrary).toBe(false);
  });

  it("both pickers read the gate (never DESIGN_KEYS directly) and show the avoid warning", () => {
    const root = join(__dirname, "..", "..", "components", "sites");
    const plan = readFileSync(join(root, "plan", "PlanDesignPart.tsx"), "utf8");
    const look = readFileSync(join(root, "website", "sections", "DesignSection.tsx"), "utf8");
    expect(plan).toContain("lookPickerKeys(planState.styleLibrary, stored)");
    expect(plan).not.toMatch(/DESIGN_KEYS\.map/);
    expect(plan).toContain('testID="plan-design-avoid-warning"');
    expect(look).toContain("lookPickerKeys(styleLibrary, design.key)");
    expect(look).toContain("ctx.plan?.styleLibrary === true");
    expect(look).not.toMatch(/\{DESIGN_KEYS\.map/);
    expect(look).toContain('testID="design-avoid-warning"');
  });
});
