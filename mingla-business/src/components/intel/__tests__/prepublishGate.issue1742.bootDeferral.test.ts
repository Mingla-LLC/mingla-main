import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(root, relative), "utf8");

describe("#1742 pre-publish intelligence boot deferral", () => {
  it("loads Event and RSVP Review gates only when their Review step mounts", () => {
    for (const relative of [
      "src/components/event/CreatorStep7Preview.tsx",
      "src/components/rsvp/RsvpStep7Preview.tsx",
    ]) {
      const source = read(relative);
      expect(source).not.toMatch(
        /import\s+\{\s*TurnoutGateSection\s*\}\s+from/,
      );
      expect(source).toContain(
        'import("../intel/PrePublishIntelligenceSurfaces")',
      );
      expect(source).toContain("React.lazy");
      expect(source).toContain("<LazyTurnoutGateSection />");
    }
  });

  it("preloads the Experience publish gate without making it a boot import", () => {
    const source = read(
      "src/components/experience/ExperienceCreatorWizard.tsx",
    );
    expect(source).not.toMatch(
      /import\s+\{\s*PrePublishGateSheet\s*\}\s+from/,
    );
    expect(source).toContain(
      'import("../intel/PrePublishIntelligenceSurfaces")',
    );
    expect(source).toContain("if (step >= 4) void loadPrePublishGateSheet()");
    expect(source).toContain("<LazyPrePublishGateSheet");
  });

  it("keeps recommendation presentation out of the canonical boot input owner", () => {
    const input = read("src/utils/turnoutInput.ts");
    const recommendations = read("src/utils/turnoutGateRecommendations.ts");
    const eventGate = read("src/components/intel/TurnoutGateSection.tsx");
    const experienceGate = read("src/components/intel/PrePublishGateSheet.tsx");

    expect(input).not.toContain("buildTurnoutGateRecommendations");
    expect(input).not.toContain("classifyTurnoutGateTarget");
    expect(recommendations).toContain(
      "export const buildTurnoutGateRecommendations",
    );
    expect(eventGate).toContain(
      'from "../../utils/turnoutGateRecommendations"',
    );
    expect(experienceGate).toContain(
      'from "../../utils/turnoutGateRecommendations"',
    );
  });

  it("uses one exact async owner so Metro cannot hoist shared gate code", () => {
    const event = read("src/components/event/CreatorStep7Preview.tsx");
    const rsvp = read("src/components/rsvp/RsvpStep7Preview.tsx");
    const experience = read(
      "src/components/experience/ExperienceCreatorWizard.tsx",
    );
    const ambient = read("src/components/intel/TurnoutForecastCard.tsx");
    const specifier = 'import("../intel/PrePublishIntelligenceSurfaces")';
    expect(event).toContain(specifier);
    expect(rsvp).toContain(specifier);
    expect(experience).toContain(specifier);
    expect(ambient).toContain(
      'import("./PrePublishIntelligenceSurfaces")',
    );
  });

  it("keeps the shared provider out of startup for all three creators", () => {
    for (const relative of [
      "src/components/event/EventCreatorWizard.tsx",
      "src/components/rsvp/RsvpCreatorWizard.tsx",
      "src/components/experience/ExperienceCreatorWizard.tsx",
    ]) {
      const source = read(relative);
      expect(source).not.toMatch(
        /import\s+\{\s*TurnoutIntelProvider\s*\}\s+from/,
      );
      expect(source).toContain('import("../intel/TurnoutIntelProvider")');
      expect(source).toContain("<LazyTurnoutIntelProvider");
    }
  });

  it("keeps the shared Experience wizard behind one route-owned boundary", () => {
    const owner = read(
      "src/components/experience/LazyExperienceCreatorWizard.tsx",
    );
    const create = read("app/experience/create.tsx");
    const edit = read("app/experience/[id]/edit.tsx");
    expect(owner).toContain('import("./ExperienceCreatorWizard")');
    expect(create).toContain("<LazyExperienceCreatorWizard");
    expect(edit).toContain("<LazyExperienceCreatorWizard");
    expect(create).not.toMatch(
      /from\s+["']\.\.\/\.\.\/src\/components\/experience\/ExperienceCreatorWizard["']/,
    );
    expect(edit).not.toMatch(
      /from\s+["']\.\.\/\.\.\/\.\.\/src\/components\/experience\/ExperienceCreatorWizard["']/,
    );
  });
});
