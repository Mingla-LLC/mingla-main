import fs from "node:fs";
import path from "node:path";

import { briefServerErrors } from "../gigBrief";
import {
  resultsSince,
  videoDueWords,
} from "../../../utils/creatorProgramFormat";

// #3872 round 2 follow-ups: gig_save's video-due errors must land next to
// Video needed by; the gig and contract show the due date and time; Results
// has a period; the Local review reply follows the keyboard rule.
const root = path.resolve(__dirname, "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const year = new Date().getFullYear();

describe("brief: video-due server errors next to the field", () => {
  it("maps video_due_required and video_due_before_shoot to Video needed by", () => {
    expect(
      briefServerErrors({ ok: false, error: "video_due_required", field: "video_due_at" } as never),
    ).toEqual({ videoDue: "Pick the day and time you need the video by." });
    expect(
      briefServerErrors({ error: "video_due_before_shoot", field: "video_due_at" }),
    ).toEqual({
      videoDue:
        "The video can't be due before the shoot. Pick a later time or an earlier shoot.",
    });
    expect(
      briefServerErrors({ error: "shoot_outside_window", field: "shoot_at" }),
    ).toEqual({ shoot: "Pick a shoot day that works for the listing." });
  });

  it("sends due and shoot times as event-local YYYY-MM-DDTHH:MM, no offset", () => {
    const brief = read("src/components/programs/gigBrief.ts");
    expect(brief).toContain('`${form.videoDueDay}T${form.videoDueTime || "23:59"}`');
    expect(brief).toContain("`${form.shootDay}T${form.shootTime}`");
  });
});

describe("video due date and time on gig and contract", () => {
  it("words a stored due time, and falls back to the day", () => {
    expect(videoDueWords(`${year}-12-05T18:00`, `${year}-12-05`)).toBe("Dec 5, 6:00 PM");
    expect(videoDueWords(null, `${year}-12-05`)).toBe("Dec 5");
    expect(videoDueWords(null, null)).toBe("");
  });

  it("is shown on the gig summary and the contract deal list", () => {
    expect(read("src/components/creators/screens/GigApplicantsScreen.tsx")).toContain(
      "videoDueWords(gig.video_due_at, gig.post_by)",
    );
    const contract = read("src/components/creators/screens/HostGigContractScreen.tsx");
    expect(contract).toMatch(
      // #3872 due change: the contract shows the agreed (current terms) due.
      /title="Video needed by"[\s\S]{0,60}agreedVideoDueWords\(agreedDue\)/,
    );
  });
});

describe("results period", () => {
  it("passes p_since for 7 and 30 days and null for All", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    expect(resultsSince("all", now)).toBeNull();
    expect(resultsSince("7d", now)).toBe(new Date("2026-10-19T12:00:00Z").toISOString());
    expect(resultsSince("30d", now)).toBe(new Date("2026-09-26T12:00:00Z").toISOString());
    expect(read("src/services/creatorGigsService.ts")).toContain("p_since: since ?? null");
    const page = read("src/components/creators/screens/CreatorResultsScreen.tsx");
    expect(page).toMatch(/\["7d", "7 days"\][\s\S]*\["30d", "30 days"\][\s\S]*\["all", "All"\]/);
    expect(page).toContain("resultsSince(period)");
  });
});

describe("Local review reply keyboard rule", () => {
  it("writes the reply in a keyboard-aware sheet whose button hides while typing", () => {
    const src = read("src/components/venue/LocalReviewsManager.tsx");
    expect(src).toContain('import { SheetBody } from "../programs/ProgramKit"');
    expect(src).toMatch(/<SheetBody[\s\S]{0,200}footer=\{[\s\S]{0,1000}Publish reply/);
    // Exactly one reply field, and it lives inside the sheet body.
    expect(src.match(/<TextInput/g)?.length).toBe(1);
    expect(src.indexOf("<TextInput")).toBeGreaterThan(src.indexOf("<SheetBody"));
  });
});
