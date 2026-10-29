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
    expect(
      new Set(ARI_RENDITION_FIXTURES.map((fixture) => fixture.id)).size,
    ).toBe(ARI_RENDITION_TOTAL);
    expect(
      new Set(ARI_RENDITION_FIXTURES.map((fixture) => fixture.group)),
    ).toEqual(new Set(ARI_RENDITION_GROUPS));
  });

  it("contains the seven read-only research/browser renditions", () => {
    const research = ARI_RENDITION_FIXTURES.filter(
      (fixture) => fixture.group === "Research and browser",
    );
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
    const route = fs.readFileSync(
      path.join(root, "app/auth/ari-renditions.tsx"),
      "utf8",
    );
    const settings = fs.readFileSync(
      path.join(root, "src/screens/ari/AriSettingsScreen.tsx"),
      "utf8",
    );
    expect(route).toContain("if (!__DEV__)");
    expect(route).toContain('<Redirect href="/" />');
    expect(settings).toContain("{__DEV__ ? (");
    expect(settings).toContain("Open 65-state gallery");
  });

  it("uses Mingla's shared button primitive in the new renderer", () => {
    const preview = fs.readFileSync(
      path.join(root, "src/components/ari/renditions/AriRenditionPreview.tsx"),
      "utf8",
    );
    const button = fs.readFileSync(
      path.join(root, "src/components/ui/Button.tsx"),
      "utf8",
    );
    expect(preview).toContain('import { Button } from "../../ui/Button"');
    expect(preview).toContain("<Button");
    expect(preview).toMatch(
      /action\.style ===\s*"danger"\s*\?\s*"destructiveOutline"/,
    );
    expect(preview).not.toContain("AriActionButton");
    expect(preview).not.toContain("LinearGradient");
    expect(preview).toContain("edgeEffect={");
    expect(preview).toContain('? "animatedGradient"');
    expect(button).toContain(
      'export type ButtonEdgeEffect = "animatedGradient"',
    );
    expect(button).toContain("const EDGE_GRADIENTS");
    expect(button).toContain('require("expo-linear-gradient")');
    expect(button).toContain("withRepeat(");
    expect(button).toContain("duration: loading ? 1300 : 3600");
    expect(button).toContain("if (disabled || reduceMotion)");
    expect(preview).not.toMatch(
      /primaryButtonText:\s*\{[^}]*textTokens\.inverse/s,
    );
    expect(preview).not.toMatch(
      /sendButtonText:\s*\{[^}]*textTokens\.inverse/s,
    );
  });

  it("uses the simple three-circle Ari identity with no glow or raster asset", () => {
    const orb = fs.readFileSync(
      path.join(root, "src/components/ari/AriOrb.tsx"),
      "utf8",
    );
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

  it("keeps the real first-use sheet to one promise, one boundary, and one action", () => {
    const disclosure = fs.readFileSync(
      path.join(root, "src/components/ari/AiDisclosureModal.tsx"),
      "utf8",
    );
    expect(disclosure).toContain('import { Button } from "../ui/Button"');
    expect(disclosure).toContain("Meet Ari.");
    expect(disclosure).toContain("Ari can plan, research, and prepare work.");
    expect(disclosure).toMatch(/Sources stay\s+visible/);
    expect(disclosure).toMatch(/you approve anything important/);
    expect(disclosure).toMatch(/Ari can make\s+mistakes, so/);
    expect(disclosure).toContain("double-check decisions that matter.");
    expect(disclosure).toContain("Start with Ari");
    expect(disclosure).not.toContain("trustLine");
    expect(disclosure).not.toContain("AiDisclosureDesignOption");
    expect(disclosure).not.toContain("briefingCard");
    expect(disclosure).not.toContain("trustList");
    expect(disclosure).not.toContain("capabilityChips");
    expect(disclosure).not.toContain("shadowColor");
  });

  it("mounts every rendition inside one production MessageList thread", () => {
    const gallery = fs.readFileSync(
      path.join(root, "src/screens/ari/AriRenditionGalleryScreen.tsx"),
      "utf8",
    );
    const messageList = fs.readFileSync(
      path.join(root, "src/components/ari/MessageList.tsx"),
      "utf8",
    );
    expect(gallery).toContain("<MessageList");
    expect(gallery).toContain("buildThreadMessages(fixtures)");
    expect(gallery).toContain("<AriProductionThread fixtures={visible} />");
    expect(gallery).toContain("<AiDisclosureModal");
    expect(gallery).toContain("One clear introduction");
    expect(gallery).toContain("Preview simplified sheet");
    expect(gallery).not.toContain("DISCLOSURE_OPTIONS");
    expect(gallery).not.toContain("designOption={disclosureOption}");
    expect(gallery).toContain(
      'import { Button } from "../../components/ui/Button"',
    );
    expect(gallery).toContain('label="Orange"');
    expect(gallery).toContain('label="Black"');
    expect(gallery).toContain('label="White"');
    expect(gallery).toContain('edgeEffect="animatedGradient"');
    expect(gallery).not.toContain("<AriRenditionPreview");
    expect(messageList).toContain("parseAriRendition");
    expect(messageList).toContain("<AriRenditionCard");
    expect(messageList).toContain("receiptPendingActionIds");
    expect(messageList).toContain(
      "negotiated premium receipt owns the completed representation",
    );
    expect(messageList).toContain(
      "keep create/attach proposal exclusive until its lifecycle clears",
    );
  });

  it("inherits the Host app's canonical Ari bubble contract", () => {
    const preview = fs.readFileSync(
      path.join(root, "src/components/ari/renditions/AriRenditionPreview.tsx"),
      "utf8",
    );
    expect(preview).toContain(": glass.tint.profileBase");
    expect(preview).toContain("borderRadius: ariThread.bubbleRadius");
    expect(preview).toContain("borderTopLeftRadius: ariThread.bubbleTail");
    expect(preview).toContain("paddingHorizontal: ariThread.bubblePadH");
    expect(preview).toContain("paddingVertical: ariThread.bubblePadV");
    expect(preview).toContain("borderColor: glass.border.profileBase");
    expect(preview).not.toContain(
      'cardWarning: { borderColor: "#f07a3d", backgroundColor: "#0b0c0f" }',
    );
  });

  it("keeps motion reduced-motion-safe and lifecycle animation bounded to active work", () => {
    const preview = fs.readFileSync(
      path.join(root, "src/components/ari/renditions/AriRenditionPreview.tsx"),
      "utf8",
    );
    expect(preview).toContain("useReducedMotion");
    expect(preview).toContain(
      'state === "loading" || state === "transitioning"',
    );
    expect(preview).toContain("cancelAnimation");
    expect(preview).toContain("withRepeat");
    expect(preview).toContain("withRepeat(\n        withSpring");
  });
});
