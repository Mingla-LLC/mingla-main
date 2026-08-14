import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(__dirname, "../../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(root, relative), "utf8");

describe("#1008 turnout surface wiring", () => {
  it("mounts one provider at each wizard root, ambient cards in-flow, and enriched gates at Review", () => {
    const eventWizard = read("src/components/event/EventCreatorWizard.tsx");
    const rsvpWizard = read("src/components/rsvp/RsvpCreatorWizard.tsx");
    expect(eventWizard.match(/<LazyTurnoutIntelProvider/g)).toHaveLength(1);
    expect(rsvpWizard.match(/<LazyTurnoutIntelProvider/g)).toHaveLength(1);
    expect(eventWizard).toContain("previewActive={currentStep === 6}");
    expect(rsvpWizard).toContain("previewActive={currentStep === 5}");

    const mounts: [string, string][] = [
      ["src/components/event/CreatorStep2When.tsx", 'surface="when"'],
      ["src/components/event/CreatorStep3Where.tsx", 'surface="where"'],
      ["src/components/event/CreatorStep5Tickets.tsx", 'surface="tickets"'],
      ["src/components/event/CreatorStep7Preview.tsx", 'surface="preview"'],
      ["src/components/rsvp/RsvpStep5Setup.tsx", 'surface="rsvp_setup"'],
      ["src/components/rsvp/RsvpStep7Preview.tsx", 'surface="preview"'],
    ];
    for (const [file, marker] of mounts) {
      const source = read(file);
      if (marker === 'surface="preview"') {
        expect(source.match(/<LazyTurnoutGateSection/g)).toHaveLength(1);
      } else {
        expect(source.match(/<TurnoutForecastCard/g)).toHaveLength(1);
        expect(source).toContain(marker);
      }
    }
  });

  // [TEST-MOD-APPROVED #1742] #1008 intentionally reserved Experience for the
  // approved follow-up gate. #1742 now owns that exact, previously excluded seam.
  it("does not alter validators, publish guards, or stores, and mounts the approved Experience follow-up", () => {
    const repoRoot = path.resolve(root, "..");
    const base = execFileSync(
      "git",
      ["merge-base", "HEAD", "origin/main"],
      { cwd: repoRoot },
    )
      .toString()
      .trim();
    const changed = execFileSync(
      "git",
      ["diff", "--name-only", base, "HEAD"],
      { cwd: repoRoot },
    )
      .toString()
      .trim()
      .split("\n");
    expect(changed).not.toContain(
      "mingla-business/src/utils/draftEventValidation.ts",
    );
    expect(changed).not.toContain(
      "mingla-business/src/store/draftEventStore.ts",
    );
    expect(changed).toContain(
      "mingla-business/src/components/experience/ExperienceCreatorWizard.tsx",
    );
    const experienceWizard = read(
      "src/components/experience/ExperienceCreatorWizard.tsx",
    );
    expect(experienceWizard.match(/<LazyTurnoutIntelProvider/g)).toHaveLength(1);
    expect(experienceWizard).toContain("autoRunEnabled={false}");
  });
});
