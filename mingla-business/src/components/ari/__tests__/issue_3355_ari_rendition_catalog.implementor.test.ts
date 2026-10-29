import fs from "node:fs";
import path from "node:path";

import {
  ARI_RENDITION_FIXTURES,
  ARI_RENDITION_GROUPS,
  ARI_RENDITION_TOTAL,
} from "../renditions/ariRenditionCatalog";

const root = path.resolve(__dirname, "../../../..");

describe("#3355 Ari rendition foundation", () => {
  it("keeps the agreed 65-state contract unique and complete", () => {
    expect(ARI_RENDITION_TOTAL).toBe(65);
    expect(ARI_RENDITION_FIXTURES).toHaveLength(ARI_RENDITION_TOTAL);
    expect(new Set(ARI_RENDITION_FIXTURES.map((fixture) => fixture.id)).size).toBe(ARI_RENDITION_TOTAL);
    expect(new Set(ARI_RENDITION_FIXTURES.map((fixture) => fixture.group))).toEqual(new Set(ARI_RENDITION_GROUPS));
  });

  it("contains the seven read-only research/browser renditions", () => {
    const research = ARI_RENDITION_FIXTURES.filter((fixture) => fixture.group === "Research and browser");
    expect(research).toHaveLength(7);
    expect(research.map((fixture) => fixture.id)).toEqual([
      "research-scope",
      "research-activity",
      "research-source",
      "social-profile",
      "connector",
      "browser-blocked",
      "research-report",
    ]);
    expect(research.every((fixture) => fixture.lineage === "New")).toBe(true);
  });

  it("ships a development-only route and no production capability claim", () => {
    const route = fs.readFileSync(path.join(root, "app/auth/ari-renditions.tsx"), "utf8");
    const settings = fs.readFileSync(path.join(root, "src/screens/ari/AriSettingsScreen.tsx"), "utf8");
    expect(route).toContain("if (!__DEV__)");
    expect(route).toContain('<Redirect href="/" />');
    expect(settings).toContain("{__DEV__ ? (");
    expect(settings).toContain("Open 65-state gallery");
  });

  it("uses dark ink on the Mingla orange controls in the new renderer", () => {
    const preview = fs.readFileSync(path.join(root, "src/components/ari/renditions/AriRenditionPreview.tsx"), "utf8");
    const actionButton = fs.readFileSync(path.join(root, "src/components/ari/AriActionButton.tsx"), "utf8");
    expect(preview).toContain("<AriActionButton");
    expect(actionButton).toContain('backgroundColor: "#f07a3d"');
    expect(actionButton).toContain('primaryText: { color: "#090a0c" }');
    expect(actionButton).toContain("locationX");
    expect(actionButton).toContain("locationY");
    expect(actionButton).toContain("withSpring");
    expect(actionButton).toContain("withTiming");
    expect(preview).not.toContain("LinearGradient");
    expect(actionButton).not.toContain("LinearGradient");
    expect(actionButton).not.toContain("shadowColor");
    expect(actionButton).not.toContain("expo-gl");
    expect(actionButton).not.toContain("LiquidMetal");
    expect(preview).not.toMatch(/primaryButtonText:\s*\{[^}]*textTokens\.inverse/s);
    expect(preview).not.toMatch(/sendButtonText:\s*\{[^}]*textTokens\.inverse/s);
  });

  it("uses the simple three-circle Ari identity with no glow or raster asset", () => {
    const orb = fs.readFileSync(path.join(root, "src/components/ari/AriOrb.tsx"), "utf8");
    expect(orb).toContain("styles.outerRing");
    expect(orb).toContain("styles.middleRing");
    expect(orb).toContain("styles.core");
    expect(orb).toContain("const translateY = thinking");
    expect(orb).toContain("if (thinking)");
    expect(orb).toContain("withRepeat(");
    expect(orb).toContain("withSpring(1");
    expect(orb).toContain("lg: 7");
    expect(orb).not.toContain("shadowColor");
    expect(orb).not.toContain("Image");
    expect(orb).not.toContain("ari-orb-dimensional-v1.png");
    expect(orb).not.toContain("react-native-svg");
    expect(orb).not.toContain("RadialGradient");
  });

  it("upgrades the real first-use sheet with a clear, shadow-free trust hierarchy", () => {
    const disclosure = fs.readFileSync(path.join(root, "src/components/ari/AiDisclosureModal.tsx"), "utf8");
    expect(disclosure).toContain("Meet Ari, your Mingla copilot.");
    expect(disclosure).toContain("You approve important changes");
    expect(disclosure).toContain("Memory stays under your control");
    expect(disclosure).toContain("Research shows its evidence");
    expect(disclosure).toContain("Start with Ari");
    expect(disclosure).not.toContain("shadowColor");
  });

  it("mounts every rendition inside one production MessageList thread", () => {
    const gallery = fs.readFileSync(path.join(root, "src/screens/ari/AriRenditionGalleryScreen.tsx"), "utf8");
    const messageList = fs.readFileSync(path.join(root, "src/components/ari/MessageList.tsx"), "utf8");
    expect(gallery).toContain("<MessageList");
    expect(gallery).toContain("buildThreadMessages(fixtures)");
    expect(gallery).toContain("<AriProductionThread fixtures={visible} />");
    expect(gallery).toContain("<AiDisclosureModal");
    expect(gallery).toContain("Preview first-use sheet");
    expect(gallery).not.toContain("<AriRenditionPreview");
    expect(messageList).toContain("parseAriRendition");
    expect(messageList).toContain("<AriRenditionCard");
  });

  it("keeps motion reduced-motion-safe and lifecycle animation bounded to active work", () => {
    const preview = fs.readFileSync(path.join(root, "src/components/ari/renditions/AriRenditionPreview.tsx"), "utf8");
    expect(preview).toContain("useReducedMotion");
    expect(preview).toContain('state === "loading" || state === "transitioning"');
    expect(preview).toContain("cancelAnimation");
    expect(preview).toContain("withRepeat");
    expect(preview).toContain("withRepeat(\n        withSpring");
  });
});
