import fs from "fs";
import path from "path";

const pagePath = path.resolve(__dirname, "..", "PeoplePage.tsx");
const primitivesPath = path.resolve(__dirname, "..", "PeoplePrimitives.tsx");

describe("issue #2024 tester adversarial — sibling FAB without People-only geometry", () => {
  test("keeps the full-height canvas and normal full-width People blocks", () => {
    const page = fs.readFileSync(pagePath, "utf8");
    const primitives = fs.readFileSync(primitivesPath, "utf8");

    expect(page).toContain("paddingBottom: 120");
    expect(page).toContain("const fabOffset = useStickyFooterOffset();");
    expect(page).toContain('{ bottom: fabOffset }');
    expect(page).toContain('router.push("/marketing/campaigns/compose" as never)');

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
