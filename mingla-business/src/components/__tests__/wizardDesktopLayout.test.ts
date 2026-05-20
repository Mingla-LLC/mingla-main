import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");

const read = (relativePath: string): string =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

describe("desktop wizard layout", () => {
  const eventWizard = read("src/components/event/EventCreatorWizard.tsx");
  const tripWizard = read("src/components/trip/TripCreatorWizard.tsx");

  it("gates desktop wizard chrome through useResponsiveLayout", () => {
    expect(eventWizard).toMatch(/import \{ useResponsiveLayout \}/);
    expect(tripWizard).toMatch(/import \{ useResponsiveLayout \}/);
    expect(eventWizard).toMatch(/const \{ isWideDesktop \} = useResponsiveLayout\(\)/);
    expect(tripWizard).toMatch(/const \{ isWideDesktop \} = useResponsiveLayout\(\)/);
  });

  it("adds a desktop step rail and constrained form pane to both creator wizards", () => {
    for (const source of [eventWizard, tripWizard]) {
      expect(source).toMatch(/const renderDesktopStepRail = \(\): React\.ReactElement =>/);
      expect(source).toMatch(/desktopStepRail/);
      expect(source).toMatch(/desktopFormPane/);
      expect(source).toMatch(/DESKTOP_WIZARD_RAIL_WIDTH/);
      expect(source).toMatch(/DESKTOP_WIZARD_FORM_MAX_WIDTH/);
    }
  });

  it("restores desktop app chrome without the mobile progress strip", () => {
    for (const source of [eventWizard, tripWizard]) {
      expect(source).toMatch(/const renderDesktopAppRail = \(\): React\.ReactElement =>/);
      expect(source).toMatch(/desktopShell/);
      expect(source).toMatch(/desktopTopBarWrap/);
      expect(source).toMatch(/<TopBar\s+leftKind="brand"/);
      expect(source).toMatch(/MINGLA_BUSINESS_LOGO/);
      expect(source).toMatch(/desktopRailBrandMark/);
      expect(source).toMatch(/DESKTOP_WIZARD_NAV_ITEMS/);
      expect(source).toMatch(/desktopRailItemActive/);
      expect(source).toMatch(/desktopAppRail:[\s\S]*zIndex: 20/);
      expect(source).toMatch(/desktopAppRail:[\s\S]*elevation: 20/);
      expect(source).toMatch(/icon: "calendar", href: "\/\(tabs\)\/hub\/(?:events|trips)", active: true/);
      expect(source).toMatch(/handleDesktopRailNavigate/);
      expect(source).toMatch(/router\.replace\(href as never\)/);
      expect(source).toMatch(/<Pressable/);
      expect(source).toMatch(/accessibilityLabel=\{`Go to \$\{item\.label\}`\}/);
      expect(source).toMatch(/DESKTOP_RAIL_WIDTH/);
      expect(source).toMatch(/DESKTOP_TOP_INSET/);
      expect(source).toMatch(/isWideDesktop \? \(/);
    }
  });

  it("wires desktop rail items to real tab routes", () => {
    expect(eventWizard).toContain('href: "/(tabs)/home"');
    expect(eventWizard).toContain('href: "/(tabs)/hub/events"');
    expect(eventWizard).toContain('href: "/(tabs)/ari"');
    expect(eventWizard).toContain('href: "/(tabs)/marketing"');

    expect(tripWizard).toContain('href: "/(tabs)/home"');
    expect(tripWizard).toContain('href: "/(tabs)/hub/trips"');
    expect(tripWizard).toContain('href: "/(tabs)/ari"');
    expect(tripWizard).toContain('href: "/(tabs)/marketing"');
  });
});
