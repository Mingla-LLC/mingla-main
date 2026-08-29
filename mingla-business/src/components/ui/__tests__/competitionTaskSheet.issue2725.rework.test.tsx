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
  it("keeps the default presentation contract and adds only the named opt-in", () => {
    expect(mobile).toContain('presentation?: "competition"');
    expect(mobileFlat).toContain(
      'competition ? "rgba(0, 0, 0, 0.68)" : SCRIM_COLOR',
    );
    expect(mobile).toContain("panelBackground={panelBackground}");
    expect(mobile).toContain('const SCRIM_COLOR = "rgba(0, 0, 0, 0.5)"');
    expect(mobile).toContain(
      'const FALLBACK_BACKGROUND = "rgba(20, 22, 26, 0.92)"',
    );
    expect(mobile).toContain("accessibilityViewIsModal");
  });

  it("owns the matching opaque responsive web branch without changing the default card", () => {
    expect(webFlat).toContain(
      'competition ? "rgba(0, 0, 0, 0.68)" : SCRIM_COLOR',
    );
    expect(web).toContain("panelBackground ?? CARD_BACKGROUND");
    expect(webFlat).toContain("viewportWidth < 1280 ? 640 : 720");
    expect(web).toContain("viewportHeight - CARD_VIEWPORT_GUTTER");
    expect(web).toContain('const CARD_BACKGROUND = "rgba(20, 22, 26, 0.92)"');
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
