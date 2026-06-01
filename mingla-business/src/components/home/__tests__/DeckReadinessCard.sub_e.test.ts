import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const CARD = join(__dirname, "../../venue", "DeckReadinessCard.tsx");
const HOME = join(__dirname, "../../../..", "app/(tabs)/home.tsx");
const HUB = join(__dirname, "../../../..", "app/(tabs)/hub/_layout.tsx");

describe("META-ORCH-1009 Sub-E deck readiness coaching", () => {
  test("card renders bouncer coaching and one-tap fix labels", () => {
    const src = readFileSync(CARD, "utf8");
    // META-ORCH-1009 Sub-E: business-friendly copy (no "deck" jargon). The card
    // still drives the same one-tap coaching fixes.
    expect(src).toContain("You're live on Mingla");
    expect(src).toContain("Get recommended");
    expect(src).toContain("edit_cover");
    expect(src).toContain("confirm_ai_outputs");
    expect(src).toContain("onFix(fix)");
  });

  test("home surfaces pipeline state for the selected brand", () => {
    const src = readFileSync(HOME, "utf8");
    expect(src).toContain("useBrandPlacePipelineState");
    expect(src).toContain("DeckReadinessCard");
    expect(src).toContain("handleDeckReadinessFix");
    expect(src).toContain("routeForPipelineStateFix");
    expect(src).not.toContain("_fix: string");
    expect(src).not.toContain("/venue/create?pool=1");
  });

  test("hub surfaces pipeline state for the selected brand", () => {
    const src = readFileSync(HUB, "utf8");
    expect(src).toContain("useBrandPlacePipelineState");
    expect(src).toContain("DeckReadinessCard");
    expect(src).toContain("handleDeckReadinessFix");
    expect(src).toContain("routeForPipelineStateFix");
  });
});
