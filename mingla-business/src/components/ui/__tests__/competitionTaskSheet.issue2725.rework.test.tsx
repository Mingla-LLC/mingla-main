/**
 * Issue #2725/#2781 — Competition task sheets are an opt-in presentation.
 *
 * These owner-level guards deliberately inspect both platform implementations:
 * deleting either competition branch, weakening opacity/scrim, or routing the
 * callers back to the default glass presentation makes this suite fail.
 */
import fs from "node:fs";
import path from "node:path";

const read = (relative: string): string =>
  fs.readFileSync(path.resolve(__dirname, relative), "utf8");
const mobile = read("../SheetMobile.tsx");
const web = read("../Sheet.web.tsx");
const mobileFlat = mobile.replace(/\s+/g, " ");
const webFlat = web.replace(/\s+/g, " ");
const add = read("../../venue/insights/CompetitorAddSheet.tsx");
const brief = read("../../venue/insights/CompetitorBriefSheet.tsx");

describe("issue 2725 opt-in Competition task Sheet", () => {
  // [TEST-MOD-APPROVED #4420] colours moved to tokens (scrim.modal, the sheet
  // material's solid fill) and `presentation` gained the web `panel` / `modal`
  // values; `competition` is still the one opt-in for the edge-to-edge panel.
  it("keeps the default presentation contract and adds only the named opt-in", () => {
    expect(mobile).toContain('presentation?: SheetPresentation');
    expect(mobile).toContain('export type SheetPresentation = "competition" | "panel" | "modal"');
    expect(mobile).toContain('const competition = presentation === "competition"');
    expect(mobileFlat).toContain("competition ? COMPETITION_SCRIM : SCRIM_COLOR");
    expect(mobile).toContain("panelBackground={panelBackground}");
    expect(mobile).toContain("const SCRIM_COLOR = scrim.modal");
    expect(mobile).toContain("accessibilityViewIsModal");
  });

  it("owns the matching opaque responsive web branch without changing the default card", () => {
    expect(web).toContain('const competition = presentation === "competition"');
    expect(web).toContain("panelBackground ?? CARD_BACKGROUND");
    expect(webFlat).toContain("? viewportWidth < 1280 ? 640 : 720");
    expect(web).toContain("viewportHeight - CARD_VIEWPORT_GUTTER");
    expect(web).toContain("const CARD_BACKGROUND = materials.sheet.solidFill");
    expect(web).toContain("accessibilityViewIsModal");
  });

  it("opts in only the add and brief owners with premium grid and target hooks", () => {
    for (const owner of [add, brief])
      expect(owner).toContain('presentation="competition"');
    for (const owner of [add, brief]) {
      expect(owner).toContain("panelBackground={competition.surface}");
      expect(owner).toContain("borderColor: glass.border.profileElevated");
      expect(owner).toContain("android: { elevation: 0, shadowOpacity: 0 }");
    }
    expect(add).toContain("shadowOpacity: 0.32");
    expect(add).toContain("minHeight: 56");
    expect(add).toContain("maxHeight: 360");
    expect(add).toContain("backgroundColor: competition.surface");
    expect(brief).toContain("maxWidth: competitorSheet.briefMaxWidth");
    expect(brief).toContain('padding: Platform.OS === "web" ? 24 : 20');
    expect(brief).toContain("backgroundColor: competitionCardSurface");
    expect(brief).toContain("borderColor: competitionBorder");
  });
});
