import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), "..", relativePath), "utf8");

describe("ORCH-0964 design rework — public event page premium renderer", () => {
  const sharedSource = repoFile("packages/offering-rendering/PublicEventPage.tsx");
  // ORCH-1138 A1 (SPEC amendment A-1) — createThemePalette + the ThemePalette
  // type + the color-math helpers were extracted VERBATIM out of
  // PublicEventPage.tsx into themePalette.ts (behavior-neutral). These three
  // structural assertions now read the new module home; the page still consumes
  // them via `useMemo(() => createThemePalette(theme))` (asserted below against
  // sharedSource). [TEST-MOD-APPROVED ORCH-1138]
  const paletteSource = repoFile("packages/offering-rendering/themePalette.ts");
  const typesSource = repoFile("packages/offering-rendering/types.ts");
  const packageSource = repoFile("packages/offering-rendering/package.json");
  const businessAdapterSource = readFileSync(
    path.join(process.cwd(), "src/components/event/PublicEventPage.tsx"),
    "utf8",
  );
  const consumerSheetSource = repoFile(
    "app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx",
  );

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
    expect(paletteSource).toContain("type ThemePalette");
    expect(paletteSource).toContain(
      "const createThemePalette = (theme: ResolvedTheme)",
    );
    expect(paletteSource).toContain("const contrastAdjustedAccent = (");
    expect(paletteSource).toContain("const contrastAdjustedForWhiteText = (");
    expect(sharedSource).toContain(
      "const palette = useMemo(() => createThemePalette(theme)",
    );
    expect(sharedSource).toContain("tint={palette.glassTint}");
    expect(sharedSource).toContain("backgroundColor: palette.page");
    expect(bodyContentBlock).toContain("maxWidth: 660");
    expect(bodyContentBlock).toContain("borderTopLeftRadius: 28");
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
    expect(sharedSource).toContain("styles.ticketCardAccent");
    expect(sharedSource).toContain("backgroundColor: palette.card");
    expect(sharedSource).toContain("borderColor: palette.cutoutBorder");
    expect(sharedSource).toContain("backgroundColor: palette.accent");
    expect(sharedSource).toContain("borderColor: palette.accentText");
    expect(sharedSource).toContain("shadowColor: palette.accent");
    expect(sharedSource).toContain("color: palette.accentText");
    expect(ticketCardBlock).toContain("borderWidth: 1.5");
    expect(ticketCardBlock).toContain("shadowOpacity: 0.3");
    expect(ticketBuyerBlock).toContain("minHeight: 58");
    expect(ticketBuyerBlock).toContain("borderWidth: 2");
    expect(ticketBuyerBlock).toContain("shadowOpacity: 0.42");
    expect(ticketBuyerBlock).toContain('alignItems: "center"');
    expect(sharedSource).not.toContain("ticketRowDivider");
    expect(sharedSource).not.toContain("isLast");
  });

  test("brand and venue affordances use the selected theme color beyond text accents", () => {
    expect(sharedSource).toContain("const heroColor =");
    expect(sharedSource).toContain("styles.brandKicker");
    expect(sharedSource).toContain("styles.brandTextCol");
    expect(sharedSource).toContain("backgroundColor: palette.glass");
    expect(sharedSource).toContain("color: palette.primaryText");
    expect(sharedSource).toContain("styles.venueIconDisk");
    expect(sharedSource).toContain("color: palette.secondaryText");
    expect(sharedSource).toContain("Presented by");
  });

  test("event date and time labels stay white above the themed event surface", () => {
    expect(sharedSource).toContain(
      '{ color: "#ffffff", fontFamily: theme.fontFamilyValue }',
    );
    expect(sharedSource).toContain("styles.recurrencePillLabel");
    expect(sharedSource).toContain('{ color: "#ffffff" }');
  });

  test("presented-by card renders the brand profile photo when available", () => {
    expect(typesSource).toContain("photo?: string");
    expect(sharedSource).toContain("brand?.photo !== undefined");
    expect(sharedSource).toContain("source={{ uri: brand.photo }}");
    expect(sharedSource).toContain("styles.brandPhoto");
    expect(businessAdapterSource).toContain("photo: brand.photo");
    expect(consumerSheetSource).toContain(
      "photo: card.brandProfilePhotoUrl ?? undefined",
    );
  });

  test("location card opens platform maps without leaking hidden addresses", () => {
    expect(typesSource).toContain("onOpenMaps?: (query: string) => void");
    expect(sharedSource).toContain("const venueMapsQuery =");
    expect(sharedSource).toContain(
      "event.hideAddressUntilTicket || event.venueName === null",
    );
    expect(sharedSource).toContain("callbacks.onOpenMaps?.(venueMapsQuery)");
    expect(sharedSource).toContain("Open maps");
    expect(sharedSource).toContain("styles.venueMapsPill");
    expect(sharedSource).toContain("borderColor: palette.accentText");
    expect(businessAdapterSource).toContain("const openMapsForQuery =");
    expect(businessAdapterSource).toContain('Platform.OS === "ios"');
    expect(businessAdapterSource).toContain("maps://?q=");
    expect(businessAdapterSource).toContain("geo:0,0?q=");
    expect(businessAdapterSource).toContain(
      "https://www.google.com/maps/search/?api=1&query=",
    );
    expect(businessAdapterSource).toContain("onOpenMaps: openMapsForQuery");
    expect(consumerSheetSource).toContain("onOpenMaps: openMapsForQuery");
  });
});
