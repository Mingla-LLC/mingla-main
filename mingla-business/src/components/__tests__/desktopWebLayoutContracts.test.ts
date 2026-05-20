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
  });
});
