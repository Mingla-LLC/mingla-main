import fs from "fs";
import path from "path";

const pagePath = path.resolve(__dirname, "..", "PeoplePage.tsx");
const primitivesPath = path.resolve(__dirname, "..", "PeoplePrimitives.tsx");
const layoutPath = path.resolve(__dirname, "../../../../app/(tabs)/marketing/_layout.tsx");
const actionsPath = path.resolve(__dirname, "../../marketing/marketingTabActions.ts");

describe("issue #2024 tester adversarial — shared Marketing FAB without People-only geometry", () => {
  test("keeps the full-height canvas while the shell owns the tab-aware floating action", () => {
    const page = fs.readFileSync(pagePath, "utf8");
    const primitives = fs.readFileSync(primitivesPath, "utf8");
    const layout = fs.readFileSync(layoutPath, "utf8");
    const actions = fs.readFileSync(actionsPath, "utf8");

    expect(page).toContain("paddingBottom: 120");
    expect(page).not.toContain("useStickyFooterOffset");
    expect(page).not.toContain("people-new-campaign");
    expect(layout).toContain("const bottom = useStickyFooterOffset();");
    expect(layout).toContain("<MarketingActionSurfaces hidden={hideActions} />");
    expect(actions).toContain('label: "Import people"');
    expect(actions).toContain('href: "/(tabs)/people/import?returnTo=marketingPeople"');

    for (const forbidden of [
      "floatingActionInset",
      "marginBottom: fabOffset",
      "measuredFabWidth",
      "setFabWidth",
      "LinearGradient",
      "PanResponder",
    ]) {
      expect(page).not.toContain(forbidden);
      expect(primitives).not.toContain(forbidden);
    }
  });
});
