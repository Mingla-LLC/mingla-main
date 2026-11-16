/**
 * #4420 device round 2 (Android walk): selecting "Themed Party" bumped the
 * label weight and Android drew "Themed" in a pill sized for both words.
 * FAILS ON REVERT: put the weight change back or drop the one-line label.
 */
import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.join(__dirname, "..", "CreatorStep1Basics.tsx"), "utf8");

describe("#4420 taxonomy pill label", () => {
  test("one line with simple breaking", () => {
    expect(src).toMatch(/numberOfLines=\{1\}\s*\n\s*textBreakStrategy="simple"\s*\n\s*>\s*\n\s*\{label\}/);
  });
  test("the selected state keeps the label weight", () => {
    const block = src.match(/\n {2}taxonomyPillLabelActive: \{[^}]*\}/)?.[0] ?? "";
    expect(block.length).toBeGreaterThan(0);
    expect(block).not.toContain("fontWeight");
  });
});
