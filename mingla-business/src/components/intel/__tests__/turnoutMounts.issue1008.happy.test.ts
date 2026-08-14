import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(__dirname, "../../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(root, relative), "utf8");

describe("#1008 turnout surface wiring", () => {
  it("mounts one provider at each wizard root and cards at all six locked surfaces", () => {
    const eventWizard = read("src/components/event/EventCreatorWizard.tsx");
    const rsvpWizard = read("src/components/rsvp/RsvpCreatorWizard.tsx");
    expect(eventWizard.match(/<TurnoutIntelProvider/g)).toHaveLength(1);
    expect(rsvpWizard.match(/<TurnoutIntelProvider/g)).toHaveLength(1);
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
      expect(read(file).match(/<TurnoutForecastCard/g)).toHaveLength(1);
      expect(read(file)).toContain(marker);
    }
  });

  it("does not alter validators, publish guards, stores, or experience creator files", () => {
    const changed = execFileSync("git", ["diff", "--name-only"], {
      cwd: path.resolve(root, ".."),
    })
      .toString()
      .trim()
      .split("\n");
    expect(changed).not.toContain(
      "mingla-business/src/utils/draftEventValidation.ts",
    );
    expect(changed).not.toContain(
      "mingla-business/src/store/draftEventStore.ts",
    );
    expect(
      changed.some((file: string) => file.includes("ExperienceCreatorWizard")),
    ).toBe(false);
  });
});
