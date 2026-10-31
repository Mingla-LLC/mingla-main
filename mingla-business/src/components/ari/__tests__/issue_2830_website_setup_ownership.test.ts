import fs from "node:fs";
import path from "node:path";

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), "utf8");

describe("#2830 Ari owns Website setup without trapping the owner", () => {
  const screen = read("../../../screens/ari/AriChatScreen.tsx");
  const pane = read("../AriWebsiteSetupPane.tsx");
  const route = read("../../../../app/brand/[id]/website/ari.tsx");
  const overview = read("../../sites/website/sections/OverviewSection.tsx");

  it("routes pre-draft setup to a distinct Ari mode and keeps edit mode intact", () => {
    expect(route).toContain('requestedIntent === "setup" ? "setup" : "edit"');
    expect(route).toContain("setupPart=");
    expect(overview).toContain("/website/ari?intent=setup");
    expect(screen).toContain('const websiteSetup = sitesIntent === "setup"');
    expect(screen).toContain("sitesIntent === \"edit\" || websiteSetup");
    expect(screen).toContain("setCurrentBrandId(sitesBrandId)");
  });

  it("loads the plan beside Ari and starts with a real audit before any draft", () => {
    expect(screen).toContain("<AriWebsiteSetupPane");
    expect(screen).toContain("First read get_site_plan");
    expect(screen).toContain("every field-level gap");
    expect(screen).toContain("Do not create a website draft until setup and brand context are complete");
    expect(pane).toContain("/site-plan");
    expect(pane).toContain('testID="ari-website-setup"');
  });

  it("offers the complete ownership path and both self-service exits", () => {
    expect(pane).toContain("Fix all gaps with Ari");
    expect(pane).toContain("Add it myself");
    expect(pane).toContain("Back to setup plan");
    expect(screen).toContain("ask me one question at a time");
    expect(screen).toContain("checkpoint after each gap");
    expect(screen).toContain("keep re-auditing until required and recommended gaps are zero");
  });

  it("refreshes server truth while Ari works and labels uploads as human actions", () => {
    expect(pane).toContain("refetchInterval: 3_000");
    expect(pane).toContain('gap.humanActionRequired ? "your upload"');
    expect(pane).toContain("Ari will not guess");
  });
});
