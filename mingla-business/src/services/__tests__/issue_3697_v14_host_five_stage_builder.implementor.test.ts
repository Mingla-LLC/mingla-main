import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const route = fs.readFileSync(
  path.join(ROOT, "src/screens/hostAds/HostAdCreateScreen.tsx"),
  "utf8",
);

// #4238 W6a: design v9 grew the spine to six steps (where it runs is its own
// step) and moved the words into hostAds.json; the shape pinned is the same.
const english = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/i18n/locales/en/hostAds.json"), "utf8"),
) as { hostAds: { builder: Record<string, Record<string, string>> } };

describe("issue #3697 Host Ads six-stage builder (#4238 W6a)", () => {
  it("uses the binding six-stage product spine and renders only the active stage", () => {
    const copy = english.hostAds.builder;
    expect(copy.pick.h1).toBe("What are you promoting?");
    expect(copy.audience.h1).toBe("Who should see it?");
    expect(copy.platforms.h1).toBe("Where should it run?");
    expect(copy.budget.h1).toBe("How much?");
    expect(copy.creative.h1).toBe("Your ad");
    expect(copy.review.h1).toBe("Review and pay");
    expect(route).toContain("{bodies[activeStepId]}");
    expect(route).toContain("testID={`host-ad-step-${step.id}`}");
  });

  it("deep-links and persists the exact current stage instead of a generic form", () => {
    expect(route).toContain("step?: string | string[]");
    expect(route).toContain("step: activeStepId");
    expect(route).toContain("hostAdStepId(draft.current_step)");
    expect(route).toContain("currentStep: step");
    expect(route).toContain("persistDraft(draftSnapshot, next.id)");
    expect(route).not.toContain('step = "form"');
  });

  it("uses the shared calendar control and freezes optional schedule boundaries", () => {
    expect(route).toContain('label={hb("budget.starts")}');
    expect(route).toContain('label={hb("budget.ends")}');
    expect(route).toContain("start_date: startDate");
    expect(route).toContain("end_date: endDate");
    // #4238 r6: start and end are frozen from the chosen days in the page's
    // own zone, the end capped at the last day people can book
    // (hostAdScheduleIsos; its behaviour is tested in issue_4238_ads_all_dates).
    expect(route).toContain(
      "...hostAdScheduleIsos(startDate, endDate, scheduleLimit, page?.timezone)",
    );
  });

  it("gates forward navigation by the current stage while keeping back navigation available", () => {
    expect(route).toContain("stepErrors[activeStepId]");
    expect(route).toContain("host-ad-step-next");
    expect(route).toContain("host-ad-step-back");
    expect(route).toContain("index <= maxVisitedStep");
  });
});
