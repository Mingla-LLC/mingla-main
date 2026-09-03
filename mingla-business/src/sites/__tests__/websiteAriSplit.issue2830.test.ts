import fs from "fs";
import path from "path";

/**
 * #2830 -- Ari edits the website WITH the draft in front of you.
 *
 * The split view is a MODE OF THE ARI SCREEN, not a second screen, and that is
 * a measured decision. A separate route importing AriChatScreen gave the module
 * a second consumer, and Metro hoists anything shared between two chunks into
 * the payload every Business user downloads before anything renders: measured
 * 2,436,294 B to 2,569,912 B, a 133KB regression for people who may never open
 * Ari. React.lazy does not help -- sharing is what hoists, not eagerness.
 */
const read = (relative: string) =>
  fs.readFileSync(path.resolve(__dirname, "../../../", relative), "utf8");

/**
 * Strip block comments before asserting on imports. Four separate assertions in
 * this issue have now flagged a word inside a COMMENT and reported a defect that
 * was not there; the route's own docblock explains the bundle decision and names
 * the module it deliberately does not import.
 */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");
const imports = (source: string) =>
  [...code(source).matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);

const route = read("app/brand/[id]/website/ari.tsx");
const workspace = read("app/brand/[id]/website.tsx");
const ari = read("src/screens/ari/AriChatScreen.tsx");

describe("#2830 Ari website split view", () => {
  it("the workspace opens the split view, not the plain Ari tab", () => {
    expect(workspace).toContain("/website/ari");
  });

  it("the route carries the brand across and renders NOTHING heavy", () => {
    expect(route).toContain("sitesIntent=edit");
    expect(route).toContain("<Redirect");
    // The whole point: this file must never IMPORT the chat. Its docblock
    // names it, which is why this asserts on imports rather than text.
    expect(imports(route).some((spec) => spec.includes("AriChatScreen"))).toBe(false);
    expect(code(route)).not.toContain("AriChatScreen");
  });

  it("ONLY the Ari screen consumes AriChatScreen", () => {
    // A second importer puts 133KB on every user's boot path.
    const importers = [
      "app/(tabs)/ari.tsx",
      "app/brand/[id]/website/ari.tsx",
    ].filter((file) =>
      imports(read(file)).some((spec) => spec.includes("AriChatScreen"))
    );
    expect(importers).toEqual(["app/(tabs)/ari.tsx"]);
  });

  it("desktop is draft LEFT, conversation RIGHT", () => {
    const split = ari.slice(ari.indexOf("websiteSplit && isWideDesktop"));
    expect(split).toContain("ari-website-draft");
    expect(ari).toContain('websiteSplitHost: { flexDirection: "row"');
  });

  it("phone keeps the full-width conversation -- 390pt cannot carry two columns", () => {
    expect(ari).toContain("websiteSplit && isWideDesktop");
    expect(ari).toContain("useResponsiveLayout()");
  });

  it("the split is a MODE, so there is no second chat implementation", () => {
    expect(ari).toContain("const websiteSplit =");
    expect(route).not.toContain("InputBar");
    expect(route).not.toContain("MessageList");
  });

  it("publishing stays a SEPARATE action from confirming a proposal", () => {
    const split = ari.slice(ari.indexOf("ari-website-draft"));
    expect(split).toContain("publishing");
    expect(split).toContain("Back to the Website workspace");
  });

  it("the split only engages for a real brand and the edit intent", () => {
    expect(ari).toContain('sitesIntent === "edit"');
    expect(ari).toContain("sitesBrandId.length > 0");
  });

  it("embedded mode still drops the duplicate header and notch pad", () => {
    expect(ari).toContain("embedded ? 0 : insets.top");
    expect(ari).toContain("styles.headerEmbedded");
  });
});
