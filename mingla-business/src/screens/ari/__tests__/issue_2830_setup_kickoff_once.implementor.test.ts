/**
 * #2830 setup polish, bug 1 — the Ari panel beside Website setup sent
 * "Set up my Website" again every time the screen moved to another part
 * (`?step=` brand → approve → build → publish). The claim key carried the
 * part, so each move was a "new" kickoff that raced the run's own lease.
 */
import fs from "fs";
import path from "path";
import {
  claimWebsiteSetupAutoAudit,
  resetWebsiteSetupAutoAuditsForTests,
  websiteSetupKickoffKey,
} from "../websiteSetupAutoAudit";

const screen = fs.readFileSync(path.join(__dirname, "..", "AriChatScreen.tsx"), "utf8");
const setupScreen = fs.readFileSync(
  path.join(__dirname, "../../../components/sites/setup/WebsiteSetupScreen.tsx"),
  "utf8",
);

describe("#2830 the Website setup kickoff is sent once per run", () => {
  beforeEach(() => resetWebsiteSetupAutoAuditsForTests());

  it("moving between parts never sends the kickoff again", () => {
    // The screen re-runs its effect on every part change; each run asks again.
    const sent: string[] = [];
    for (const part of ["brand", "approve", "build", "publish"]) {
      const key = websiteSetupKickoffKey({ brandId: "brand-1", part, runKnown: true, liveRunConversationId: null });
      if (key !== null && claimWebsiteSetupAutoAudit(key)) sent.push(part);
    }
    expect(sent).toEqual(["brand"]);
  });

  it("a live run of this person's resumes, with no new message", () => {
    expect(websiteSetupKickoffKey({ brandId: "brand-1", part: "build", runKnown: true, liveRunConversationId: "conv-1" })).toBeNull();
  });

  it("nothing is sent before the run is known", () => {
    expect(websiteSetupKickoffKey({ brandId: "brand-1", part: null, runKnown: false, liveRunConversationId: null })).toBeNull();
  });

  it("the panel decides from the run, not from the part", () => {
    expect(screen).toContain("websiteSetupKickoffKey({");
    expect(screen).toMatch(/liveRunConversationId: setup\?\.conversationId \?\? null/);
    expect(screen).not.toMatch(/websiteSetupAutoAuditKey\(sitesBrandId, setupPart\)/);
    expect(setupScreen).toContain("runKnown: presenceKnown,");
  });
});
