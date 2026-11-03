import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const route = fs.readFileSync(
  path.join(ROOT, "src/screens/hostAds/HostAdCreateScreen.tsx"),
  "utf8",
);

describe("issue #3697 Host Ads five-stage builder", () => {
  it("uses the binding five-stage product spine and renders only the active stage", () => {
    for (const label of [
      "What are you promoting?",
      "Who should see it?",
      "Budget and dates",
      // #4238 plain-language pass.
      "Video and words",
      "Review and launch",
    ]) {
      expect(route).toContain(label);
    }
    for (const step of ["promote", "audience", "budget", "creative", "review"]) {
      expect(route).toContain(`activeStepId === "${step}"`);
    }
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
    expect(route).toContain('label="Start date (optional)"');
    expect(route).toContain('label="End date (optional)"');
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
    expect(route).toContain("index > maxVisitedStep");
  });
});
