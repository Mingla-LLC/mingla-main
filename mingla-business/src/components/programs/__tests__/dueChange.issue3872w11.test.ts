import fs from "node:fs";
import path from "node:path";

import {
  agreedVideoDue,
  agreedVideoDueWords,
  dueChangeInitial,
  dueChangeLocalErrors,
  dueChangePayload,
  dueChangeServerErrors,
  proposalChangeWords,
} from "../dueChange";

// #3872: after hire, a video-due change carries a date AND a time, and the
// contract shows the agreed (current terms) due date and time.
const root = path.resolve(__dirname, "../../../..");
const CONTRACT = "src/components/creators/screens/HostGigContractScreen.tsx";
const contractSrc = () => fs.readFileSync(path.join(root, CONTRACT), "utf8");

const local = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m - 1, d, h, min).toISOString();

describe("agreed due", () => {
  const gig = { video_due_at: local(2026, 11, 30, 18, 0), post_by: "2026-11-30" };
  it("reads the current terms version, not the brief", () => {
    const due = agreedVideoDue({
      terms: [
        { version: 1, video_due_at: gig.video_due_at, post_by: "2026-11-30" },
        { version: 2, video_due_at: local(2026, 11, 22, 18, 0), post_by: "2026-11-22" },
      ],
      currentVersion: 2,
      gig,
    });
    expect(agreedVideoDueWords(due)).toBe("Nov 22, 6:00 PM");
  });
  it("falls back to the gig when terms carry no time", () => {
    const due = agreedVideoDue({ terms: [{ version: 1, post_by: "2026-11-30" }], currentVersion: 1, gig });
    expect(due.videoDueAt).toBe(gig.video_due_at);
    expect(agreedVideoDueWords(due)).toBe("Nov 30, 6:00 PM");
  });
});

describe("the change sheet", () => {
  it("prefills the date and time from the agreed due", () => {
    expect(dueChangeInitial({ videoDueAt: local(2026, 11, 22, 18, 5), postBy: "2026-11-22" })).toEqual({
      day: "2026-11-22",
      time: "18:05",
    });
    expect(dueChangeInitial({ videoDueAt: null, postBy: "2026-11-22" })).toEqual({ day: "2026-11-22", time: "23:59" });
  });
  it("needs both a date and a time", () => {
    expect(dueChangeLocalErrors("", "18:00").day).toBeTruthy();
    expect(dueChangeLocalErrors("2026-11-22", "").time).toBeTruthy();
    expect(dueChangeLocalErrors("2026-11-22", "18:00")).toEqual({});
  });
  it("sends changes.video_due_at as local date and time", () => {
    expect(dueChangePayload("2026-11-22", "18:00")).toEqual({ video_due_at: "2026-11-22T18:00" });
  });
  it("puts server refusals next to the fields in plain words", () => {
    expect(dueChangeServerErrors("video_due_required").day).toMatch(/hasn't passed/);
    expect(dueChangeServerErrors("video_due_before_shoot").day).toMatch(/before the shoot/);
    for (const code of ["video_due_required", "video_due_before_shoot", "terms_change_already_open"]) {
      expect(JSON.stringify(dueChangeServerErrors(code))).not.toContain(code);
    }
  });
});

// #4430 item 1c/1d: with the gig's zone known, the prefill and the words are
// the zone's wall clock, whatever the phone's zone is.
describe("in the gig's zone (#4430)", () => {
  const lagosNoon = "2026-12-15T11:00:00Z";
  it("prefills the zone's wall clock, not the phone's", () => {
    expect(dueChangeInitial({ videoDueAt: lagosNoon, postBy: "2026-12-15" }, "Africa/Lagos")).toEqual({
      day: "2026-12-15",
      time: "12:00",
    });
    expect(dueChangeInitial({ videoDueAt: "2026-12-15T23:30:00Z", postBy: "2026-12-16" }, "Africa/Lagos")).toEqual({
      day: "2026-12-16",
      time: "00:30",
    });
  });
  it("labels the agreed and proposed dues with the zone in plain words", () => {
    expect(agreedVideoDueWords({ videoDueAt: lagosNoon, postBy: "2026-12-15" }, "Africa/Lagos")).toBe(
      "Tue Dec 15, 12:00 PM Lagos time",
    );
    // A proposal is saved as the zone's wall clock and shown as written.
    expect(proposalChangeWords({ video_due_at: "2026-12-15T12:00" }, "Africa/Lagos")).toBe(
      "Proposed: Tue Dec 15, 12:00 PM Lagos time",
    );
    expect(proposalChangeWords({ video_due_at: lagosNoon }, "Africa/Lagos")).toBe(
      "Proposed: Tue Dec 15, 12:00 PM Lagos time",
    );
  });
});

describe("proposal cards", () => {
  it("show the proposed date and time", () => {
    expect(
      proposalChangeWords({ video_due_at: local(2026, 11, 22, 18, 0), post_by: "2026-11-22" }),
    ).toBe("Proposed: Nov 22, 6:00 PM");
  });
  it("still read an older date-only change", () => {
    expect(proposalChangeWords({ post_by: "2026-11-22" })).toBe("Proposed: Nov 22");
  });
});

describe("host contract screen", () => {
  it("has a date and a time field and sends video_due_at", () => {
    const src = contractSrc();
    expect(src).toMatch(/title="Change the video-due date"[\s\S]*<DateField[\s\S]*<TimeField[\s\S]*sendDueChange/);
    expect(src).toContain("dueChangePayload(dueDay, dueTime)");
    expect(src).not.toContain("{ post_by: newPostBy }");
  });
  it("shows the agreed due on Video needed by and on proposal cards", () => {
    const src = contractSrc();
    // #4430: both read the gig's zone.
    expect(src).toMatch(/title="Video needed by"[\s\S]{0,400}agreedVideoDueWords\(agreedDue, zone\)/);
    expect(src).toContain("proposalChangeWords(openChange.changes, zone)");
    expect(src).toContain("dueChangeInitial(agreedDue, zone)");
  });
});
