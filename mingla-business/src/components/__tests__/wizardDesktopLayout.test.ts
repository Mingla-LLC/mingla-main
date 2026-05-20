import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");

const read = (relativePath: string): string =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("desktop wizard layout", () => {
  const eventWizard = read("src/components/event/EventCreatorWizard.tsx");
  const tripWizard = read("src/components/trip/TripCreatorWizard.tsx");

  it("gates desktop wizard chrome through useResponsiveLayout", () => {
    expect(eventWizard).toMatch(/useResponsiveLayout/);
    expect(tripWizard).toMatch(/useResponsiveLayout/);
    expect(eventWizard).toMatch(/isWideDesktop/);
    expect(tripWizard).toMatch(/isWideDesktop/);
  });

  it("adds a desktop step rail and constrained form pane to both creator wizards", () => {
    for (const source of [eventWizard, tripWizard]) {
      expect(source).toMatch(/renderDesktopStepRail/);
      expect(source).toMatch(/desktopStepRail/);
      expect(source).toMatch(/desktopFormPane/);
      expect(source).toMatch(/DESKTOP_WIZARD_RAIL_WIDTH/);
      expect(source).toMatch(/DESKTOP_WIZARD_FORM_MAX_WIDTH/);
    }
  });

  it("restores desktop app chrome without the mobile progress strip", () => {
    for (const source of [eventWizard, tripWizard]) {
      expect(source).toMatch(/renderDesktopAppRail/);
      expect(source).toMatch(/desktopShell/);
      expect(source).toMatch(/desktopTopBarWrap/);
      expect(source).toMatch(/<TopBar leftKind="brand" \/>/);
      expect(source).toMatch(/DESKTOP_RAIL_WIDTH/);
      expect(source).toMatch(/DESKTOP_TOP_INSET/);
    }
  });
});
