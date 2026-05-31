import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const CARD = join(__dirname, "../../venue", "DeckReadinessCard.tsx");
const HOME = join(__dirname, "../../../..", "app/(tabs)/home.tsx");
const HUB = join(__dirname, "../../../..", "app/(tabs)/hub/_layout.tsx");

describe("META-ORCH-1009 Sub-E deck readiness coaching", () => {
  test("card renders bouncer coaching and one-tap fix labels", () => {
    const src = readFileSync(CARD, "utf8");
    expect(src).toContain("Why you're not in the deck yet");
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
