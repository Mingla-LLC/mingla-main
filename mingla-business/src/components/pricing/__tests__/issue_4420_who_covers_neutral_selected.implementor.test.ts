/**
 * #4420 — "Who covers the costs" (shared by the event, trip and experience
 * wizards and brand pricing defaults) marks the chosen segment with the
 * neutral selected material, never an orange fill (orange is only for Create,
 * the active nav icon, progress/steppers and the upcoming dot).
 *
 * FAILS-ON-REVERT: putting `accent` back on segSelected, or any colour
 * literal, fails this suite.
 */
import fs from "fs";
import path from "path";

const SRC = fs.readFileSync(path.resolve(__dirname, "../WhoCoversCostsSection.tsx"), "utf8");
const block = (name: string): string => {
  const start = SRC.indexOf(`  ${name}: {`);
  return SRC.slice(start, SRC.indexOf("},", start));
};

describe("#4420 WhoCoversCostsSection neutral selected", () => {
  test("selected segment = materials.selected, label = textStrong", () => {
    expect(block("segSelected")).toContain("materials.selected.solidFill");
    expect(block("segSelected")).not.toMatch(/accent/);
    expect(block("segLabelSelected")).toContain("color.textStrong");
  });
  test("no orange and no colour literal anywhere in the section", () => {
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\baccent\b/);
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/rgba?\(/);
  });
  test("the three wizards still mount the shared section", () => {
    for (const f of [
      "../../event/CreatorStep5Tickets.tsx",
      "../../trip/TripCreatorStep4Pricing.tsx",
      "../../experience/ExperiencePricingStep.tsx",
    ]) {
      const s = fs.readFileSync(path.resolve(__dirname, f), "utf8");
      expect([f, /WhoCoversCostsSection/.test(s)]).toEqual([f, true]);
    }
  });
});
