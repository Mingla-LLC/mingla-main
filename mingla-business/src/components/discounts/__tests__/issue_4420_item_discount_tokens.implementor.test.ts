/**
 * #4420 — ItemDiscountControls (venue menu items, venue settings, event
 * ticket tiers) has no colour literals: the two "#fff" selected labels are
 * `color.textStrong`, and the selected limit / day uses the neutral selected
 * material rather than an orange fill.
 *
 * FAILS-ON-REVERT: any literal or `accent` back in the file fails this suite.
 */
import fs from "fs";
import path from "path";

const SRC = fs.readFileSync(path.resolve(__dirname, "../ItemDiscountControls.tsx"), "utf8");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("#4420 ItemDiscountControls on tokens", () => {
  test("no colour literal and no orange selection", () => {
    expect(CODE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CODE).not.toMatch(/rgba?\(/);
    expect(CODE).not.toMatch(/\baccent\b/);
  });
  test("selected labels and surfaces come from tokens", () => {
    expect(CODE).toMatch(/segmentTextOn: \{ color: color\.textStrong \}/);
    expect(CODE).toMatch(/dayTextOn: \{[^}]*color\.textStrong/);
    expect(CODE).toContain("materials.selected.solidFill");
  });
  test("the venue and event screens still mount it", () => {
    for (const f of ["../../venue/VenueSettingsModule.tsx", "../../venue/MenuItemSheet.tsx", "../../event/TicketTierEditSheet.tsx"]) {
      const s = fs.readFileSync(path.resolve(__dirname, f), "utf8");
      expect([f, s.includes("ItemDiscountControls")]).toEqual([f, true]);
    }
  });
});
