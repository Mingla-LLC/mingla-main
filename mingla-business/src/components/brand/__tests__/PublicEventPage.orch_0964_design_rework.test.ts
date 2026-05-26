import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), "..", relativePath), "utf8");

describe("ORCH-0964 design rework — public event page premium renderer", () => {
  const sharedSource = repoFile("packages/event-rendering/PublicEventPage.tsx");
  const packageSource = repoFile("packages/event-rendering/package.json");

  test("event body keeps the cover-scroll concept and upgrades into a glass sheet", () => {
    const heroWrapBlock =
      sharedSource.match(/heroWrap: \{[\s\S]*?\n  \},/)?.[0] ?? "";
    const bodyContentBlock =
      sharedSource.match(/bodyContent: \{[\s\S]*?\n  \},/)?.[0] ?? "";
    expect(sharedSource).toContain('import { BlurView } from "expo-blur"');
    expect(packageSource).toContain('"expo-blur": "*"');
    expect(heroWrapBlock).toContain('position: "absolute"');
    expect(heroWrapBlock).toContain("height: 380");
    expect(sharedSource).toContain("paddingTop: 288");
    expect(sharedSource).toContain('pointerEvents="none"');
    expect(sharedSource).toContain("style={styles.bodyGlassLayer}");
    expect(bodyContentBlock).toContain("maxWidth: 660");
    expect(bodyContentBlock).toContain("borderTopLeftRadius: 28");
    expect(bodyContentBlock).toContain(
      'backgroundColor: "rgba(8, 10, 14, 0.92)"',
    );
  });

  test("tickets render as large themed cards instead of divider rows", () => {
    const ticketCardBlock =
      sharedSource.match(/ticketCard: \{[\s\S]*?\n  \},/)?.[0] ?? "";
    const ticketBuyerBlock =
      sharedSource.match(/ticketBuyerBtn: \{[\s\S]*?\n  \},/)?.[0] ?? "";
    expect(sharedSource).toContain("styles.ticketCard");
    expect(sharedSource).toContain("styles.ticketHeaderRow");
    expect(sharedSource).toContain("styles.ticketPricePill");
    expect(sharedSource).toContain("styles.ticketFooterRow");
    expect(sharedSource).toContain("borderColor: theme.color");
    expect(ticketCardBlock).toContain("shadowOpacity: 0.2");
    expect(ticketBuyerBlock).toContain("minHeight: 52");
    expect(ticketBuyerBlock).toContain('alignItems: "center"');
    expect(sharedSource).not.toContain("ticketRowDivider");
    expect(sharedSource).not.toContain("isLast");
  });

  test("brand and venue affordances use the selected theme color beyond text accents", () => {
    expect(sharedSource).toContain("const heroColor =");
    expect(sharedSource).toContain("styles.brandKicker");
    expect(sharedSource).toContain("styles.brandTextCol");
    expect(sharedSource).toContain("{ borderColor: theme.color }");
    expect(sharedSource).toContain("styles.venueIconDisk");
    expect(sharedSource).toContain("{ backgroundColor: theme.color }");
    expect(sharedSource).toContain("Presented by");
  });
});
