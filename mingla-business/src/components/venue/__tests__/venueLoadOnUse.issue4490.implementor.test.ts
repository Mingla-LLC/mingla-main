/**
 * #4490 retest P1 — the venue screens #1486's dormant render suites mount must
 * not load the auth context, the Supabase client or react-native-reanimated
 * just by being imported. The runtime proof is those suites themselves
 * (jest.issue2737 / jest.issue2726 / jest.issue3827.web /
 * jest.orch1190r2|r3.venuewidth.web); this file pins the product-side shape
 * so a later edit cannot quietly put a module-scope import back.
 *
 * FAILS-ON-REVERT: re-add `import { useVenueFeatures } ...` to
 * VenueReservationsModule, a top-level `import { supabase } from "./supabase"`
 * to venueFeaturesService, `Chip` from ../ui/Pill in VenueAvailabilityModule,
 * or a static OrderingModeCard import in VenueMenuModule: the matching case
 * goes red.
 */
import { readFileSync } from "fs";
import path from "path";

const root = path.join(__dirname, "../../../..");
const read = (rel: string): string => readFileSync(path.join(root, rel), "utf8");
const imports = (src: string): string[] =>
  src.split("\n").filter((line) => /^import\s/.test(line) || /^\} from /.test(line));

describe("#4490 venue screens load their heavy dependencies on use", () => {
  it("the reservations screen takes Floor plan from the shell, not its own features read", () => {
    const mod = read("src/components/venue/VenueReservationsModule.tsx");
    expect(mod).not.toMatch(/hooks\/useVenueFeatures"/);
    expect(mod).not.toMatch(/hooks\/useBrandCurrency"/);
    expect(mod).toContain("floorPlanOn = false,");
    expect(mod).toContain("const floorOn = floorPlanOn;");
    for (const shell of [
      "src/components/venue/VenueSuiteShell.tsx",
      "src/components/stay/StaySuiteShell.tsx",
    ]) {
      expect(read(shell)).toContain(
        "floorPlanOn={featuresQuery.data?.features.floor_plan.enabled === true}",
      );
    }
    // The floor (lazily loaded) reads the currency itself.
    expect(read("src/components/venue/features/floor/VenueFloorLive.tsx")).toContain(
      "const currency = useBrandCurrency(brandId);",
    );
  });

  it("venueFeaturesService creates the Supabase client on first call only", () => {
    const src = read("src/services/venueFeaturesService.ts");
    expect(imports(src).some((line) => /["']\.\/supabase["']/.test(line))).toBe(false);
    expect(src).toContain('(await import("./supabase")).supabase');
    expect(src).not.toMatch(/await supabase\b/);
  });

  it("a chip never loads the animated pill", () => {
    const chip = read("src/components/ui/Chip.tsx");
    expect(imports(chip).join("\n")).not.toMatch(/react-native-reanimated|["']\.\/Pill["']/);
    expect(read("src/components/ui/Pill.tsx")).toContain('export { Chip, type ChipProps } from "./Chip";');
    expect(read("src/components/venue/VenueAvailabilityModule.tsx")).toContain(
      'import { Chip } from "../ui/Chip";',
    );
  });

  it("the menu loads its ordering-mode card and stock parts lazily", () => {
    const menuImports = imports(read("src/components/venue/VenueMenuModule.tsx")).join("\n");
    expect(menuImports).not.toMatch(/import \{ OrderingModeCard \}/);
    expect(menuImports).not.toMatch(/import \{ MenuItemStockSection \}/);
    expect(menuImports).not.toMatch(/import \{ MenuStockLoader/);
    const menu = read("src/components/venue/VenueMenuModule.tsx");
    // #4490 venue owners: still loaded on use, now through the one Host venue
    // owner (a separate import() of each put them in __common).
    expect(menu).toContain("(await loadVenueHostScreens()).OrderingModeCard");
    expect(menu).toContain("(await loadVenueHostScreens()).MenuStockLoader");
    expect(menu).toContain("(await loadVenueHostScreens()).MenuItemStockSection");
  });
});
