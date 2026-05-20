import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");

const read = (relativePath: string): string =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("desktop web layout contracts", () => {
  it("keeps DesktopCanvas rail-aware with compact bezel spacing", () => {
    const source = read("src/components/ui/DesktopCanvas.tsx");

    expect(source).toContain("DESKTOP_RAIL_WIDTH");
    expect(source).toContain("DESKTOP_BEZEL_MARGIN");
    expect(source).toContain("DESKTOP_TOP_INSET");
    expect(source).toContain("paddingLeft: DESKTOP_RAIL_WIDTH + DESKTOP_BEZEL_MARGIN");
    expect(source).toContain("paddingRight: DESKTOP_BEZEL_MARGIN");
    expect(source).not.toContain("DESKTOP_CONTENT_MAX_WIDTH");
    expect(source).not.toContain("DESKTOP_CONTENT_PADDING_X");
  });

  it("keeps Hub event, experience, and trip lists as four-column desktop grids", () => {
    for (const relativePath of [
      "app/(tabs)/hub/events.tsx",
      "app/(tabs)/hub/experiences.tsx",
      "app/(tabs)/hub/trips.tsx",
    ]) {
      const source = read(relativePath);

      expect(source).toContain("useResponsiveLayout");
      expect(source).toContain("DESKTOP_HUB_GRID_COLUMNS");
      expect(source).toContain("desktopListGrid");
      expect(source).toContain("desktopListCell");
      expect(source).toContain("gap: 0");
      expect(source).toContain("marginHorizontal: -spacing.xs");
      expect(source).toContain("paddingHorizontal: spacing.xs");
      expect(source).not.toContain("paddingRight: spacing.sm");
    }
  });

  it("keeps Home desktop KPIs fixed and Upcoming list independently scrollable", () => {
    const source = read("app/(tabs)/home.tsx");

    expect(source).toContain("useResponsiveLayout");
    expect(source).toContain("getActiveEventsKpiSub");
    expect(source).toContain("desktopKpiGrid");
    expect(source).toContain("desktopUpcomingPane");
    expect(source).toContain("desktopEventsGrid");
    expect(source).toContain("scrollEnabled={!isWideDesktop}");
    expect(source).toContain("scrollEnabled={isWideDesktop}");
    expect(source).toContain("gap: 0");
    expect(source).toContain("marginHorizontal: -spacing.xs");
    expect(source).toContain("paddingHorizontal: spacing.xs");
    expect(source).toContain("marginBottom: spacing.sm");
  });

  it("keeps the desktop rail visible on the marketing composer", () => {
    const source = read("app/(tabs)/_layout.tsx");

    expect(source).toContain("useResponsiveLayout");
    expect(source).toContain(
      'pathname.includes("/campaigns/compose") && !isWideDesktop',
    );
  });

  it("keeps the marketing composer desktop surface flat and unified", () => {
    const routeSource = read("app/(tabs)/marketing/campaigns/compose.tsx");
    const footerSource = read("src/components/marketing/ComposerFooter.tsx");
    const editorSource = read("src/components/marketing/ComposerV2/ComposerV2Editor.tsx");
    const insertionBarSource = read("src/components/marketing/ComposerV2/InsertionBar.tsx");

    expect(routeSource).toContain("useResponsiveLayout");
    expect(routeSource).toContain("desktopHost");
    expect(footerSource).toContain("desktopFlatBtn");
    expect(footerSource).toContain("desktopPrimaryBtnEnabled");
    expect(editorSource).toContain("desktopBodyHost");
    expect(editorSource).toContain("desktopSubjectPersonalize");
    expect(insertionBarSource).toContain("pillDesktopFlat");
    expect(insertionBarSource).toContain("pillDesktopFlatActive");
  });

  it("locks the desktop marketing composer vertical rhythm", () => {
    const routeSource = read("app/(tabs)/marketing/campaigns/compose.tsx");
    const footerSource = read("src/components/marketing/ComposerFooter.tsx");
    const editorSource = read("src/components/marketing/ComposerV2/ComposerV2Editor.tsx");

    expect(routeSource).toContain("marginBottom: spacing.sm");
    expect(footerSource).toContain('position: "absolute"');
    expect(footerSource).toContain("bottom: spacing.sm");
    expect(footerSource).toContain("paddingBottom: isWideDesktop ? 0");
    expect(editorSource).toContain("Math.max(400, Math.min(rawBodyHeight - 44, 700))");
    expect(editorSource).toContain("marginTop: spacing.md");
    expect(editorSource).toContain("marginBottom: spacing.md");
    expect(editorSource).toContain("borderRadius: radius.lg");
    expect(editorSource).toContain('overflow: "hidden"');
  });
});
