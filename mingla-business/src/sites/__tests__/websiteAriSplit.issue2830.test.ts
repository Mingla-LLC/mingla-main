import fs from "fs";
import path from "path";

/**
 * #2830 -- Ari edits the website WITH the draft in front of you.
 *
 * Before this, "Edit with Ari" opened the full-screen Ari tab: a conversation
 * with no sight of the page it was changing. You confirmed a proposal, then
 * left to mint a preview to find out what you had agreed to.
 *
 * FAILS ON REVERT: point onOpenAri back at /(tabs)/ari and the routing
 * assertion fails; delete the split branch and the layout assertions fail.
 */
const read = (relative: string) =>
  fs.readFileSync(path.resolve(__dirname, "../../../", relative), "utf8");

const route = read("app/brand/[id]/website/ari.tsx");
const workspace = read("app/brand/[id]/website.tsx");
const ari = read("src/screens/ari/AriChatScreen.tsx");

describe("#2830 Ari website split view", () => {
  it("the workspace opens the split view, not the Ari tab", () => {
    expect(workspace).toContain("/website/ari");
    expect(workspace).not.toContain("sitesIntent=edit");
  });

  it("desktop is preview LEFT, conversation RIGHT", () => {
    const split = route.slice(route.indexOf("isWideDesktop ? ("));
    const draftAt = split.indexOf("{draft}");
    const chatAt = split.indexOf("{conversation}");
    expect(draftAt).toBeGreaterThan(-1);
    expect(chatAt).toBeGreaterThan(draftAt);
    expect(route).toContain('flexDirection: "row"');
  });

  it("phone STACKS instead of splitting -- 390pt cannot carry two columns", () => {
    expect(route).toContain("website-ari-stack");
    expect(route).toContain("ScrollView");
  });

  it("reuses the real Ari rather than a second chat implementation", () => {
    expect(route).toContain("<AriChatScreen embedded />");
    expect(route).not.toContain("InputBar");
    expect(route).not.toContain("MessageList");
  });

  it("embedded mode drops the duplicate header and the double notch pad", () => {
    expect(ari).toContain("embedded ? 0 : insets.top");
    expect(ari).toContain("styles.headerEmbedded");
  });

  it("publishing stays a SEPARATE action from confirming a proposal", () => {
    expect(route).toContain("Review and publish");
    expect(route).not.toMatch(/onPress=\{[^}]*publish\.mutate/);
  });

  it("a failed preview says so instead of failing silently", () => {
    expect(route).toContain("previewError");
    expect(route).toContain("Your draft is unchanged");
  });

  it("is gated on the sites flag and on rank, like the workspace", () => {
    expect(route).toContain('isFeatureEnabled("sites")');
    expect(route).toContain("role.rank < 20");
  });

  it("has a back control, the thing the workspace shipped without", () => {
    expect(route).toContain('leftKind="back"');
    expect(route).toContain("router.canGoBack()");
  });
});
