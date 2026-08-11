/**
 * Issue #1735 T-G1/T-G2 (pure halves) — Insights module registration.
 *
 * Fails-on-revert anchors (I-PROPOSED-1735-INSIGHTS-COMMAND-BAND-ADDITIVE):
 * dropping `insights` from EITHER `deriveVenueModules` branch, gating it on
 * the reservations toggle, ordering it after Settings, or flipping
 * `moduleSelfScrolls("insights")` back to false turns this suite RED.
 * The booking-band invariant (I-PROPOSED-1148) stays covered by
 * `venueModules.test.ts` T-1/T-2 (updated arrays, same gating assertions).
 */

// The shell transitively imports native/ESM modules the node ts-jest config
// cannot parse. This suite tests the pure REGISTRY + rail derivation, so
// every workspace/module import of the shell is stubbed at the module
// boundary — the units under test (`deriveVenueModules`,
// `deriveVenueRailModules`, `VENUE_MODULES`, `moduleSelfScrolls`) are all
// REAL and untouched by these mocks.
const nullComponent = (name: string) => ({
  __esModule: true,
  [name]: () => null,
  default: () => null,
});
jest.mock("react-native-safe-area-context", () => ({
  __esModule: true,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../VenueAvailabilityModule", () =>
  nullComponent("VenueAvailabilityModule"),
);
jest.mock("../insights/VenueInsightsModule", () =>
  nullComponent("VenueInsightsModule"),
);
jest.mock("../VenueIntelligenceModule", () =>
  nullComponent("VenueIntelligenceModule"),
);
jest.mock("../VenueMenuModule", () => nullComponent("VenueMenuModule"));
jest.mock("../VenueReservationsModule", () =>
  nullComponent("VenueReservationsModule"),
);
jest.mock("../VenueSettingsModule", () => nullComponent("VenueSettingsModule"));
jest.mock("../VenueTablesModule", () => nullComponent("VenueTablesModule"));
jest.mock("../VenueWaitlistModule", () => nullComponent("VenueWaitlistModule"));
jest.mock("../../suite/SuiteDesktopShell", () => ({
  __esModule: true,
  SuiteDesktopShell: () => null,
}));
jest.mock("../../ui/Button", () => nullComponent("Button"));
jest.mock("../../ui/GlassCard", () => nullComponent("GlassCard"));
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  __esModule: true,
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));
jest.mock("../../../hooks/useVenueReservationSettings", () => ({
  __esModule: true,
  useVenueReservationSettings: () => ({ data: null }),
  useSetReservationsEnabled: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("../../../store/venueSuiteStore", () => ({
  __esModule: true,
  useVenueSuiteStore: (selector: (s: unknown) => unknown) =>
    selector({ sync: jest.fn() }),
}));

import {
  VENUE_MODULES,
  deriveVenueModules,
  isBookingModule,
} from "../venueModules";
import { moduleSelfScrolls } from "../venueShellScroll";
import { deriveVenueRailModules } from "../VenueSuiteShell";
import {
  INSIGHT_INSTRUMENTS,
  insightInstrumentRegistered,
} from "../insights/insightsInstruments";

describe("issue #1735 — Insights module registration (T-G1/T-G2)", () => {
  it("OFF branch carries insights unconditionally, Settings last", () => {
    // Issue #1791 [TEST-MOD-APPROVED #1791] — the pinned array gains "orders"
    // (command-band, both branches). #1735's own invariant is UNTOUCHED:
    // `insights` is still present, still after `menu`, still before Settings.
    expect(deriveVenueModules(false)).toEqual([
      "overview",
      "menu",
      "insights",
      "orders",
      "settings",
    ]);
  });

  it("ON branch carries insights after menu, Settings last, booking band intact", () => {
    const mods = deriveVenueModules(true);
    // Issue #1791 [TEST-MOD-APPROVED #1791] — "orders" appended after
    // "insights"; the insights-after-menu and Settings-last assertions below
    // are unchanged and still enforce #1735's contract.
    expect(mods).toEqual([
      "overview",
      "tables",
      "availability",
      "reservations",
      "waitlist",
      "menu",
      "insights",
      "orders",
      "settings",
    ]);
    expect(mods.indexOf("insights")).toBeGreaterThan(mods.indexOf("menu"));
    expect(mods[mods.length - 1]).toBe("settings");
  });

  it("insights is command-band, never a booking module (the toggle gate is untouched)", () => {
    expect(isBookingModule("insights")).toBe(false);
    expect(VENUE_MODULES.insights).toEqual({
      id: "insights",
      label: "Insights",
      band: "command",
      summary: "Your site, your pricing, your competition.",
    });
  });

  it("T-G2 — the module OWNS its ScrollView (shell must not wrap it)", () => {
    expect(moduleSelfScrolls("insights")).toBe(true);
    // Existing contracts unchanged: Overview self-scrolls, Menu does not.
    expect(moduleSelfScrolls("overview")).toBe(true);
    expect(moduleSelfScrolls("menu")).toBe(false);
    expect(moduleSelfScrolls("settings")).toBe(false);
  });

  it("desktop rail lands Insights between Menu and Settings", () => {
    const rail = deriveVenueRailModules(deriveVenueModules(true)).map(
      (m) => m.key,
    );
    const menuIdx = rail.indexOf("menu");
    const insightsIdx = rail.indexOf("insights");
    const settingsIdx = rail.indexOf("settings");
    expect(insightsIdx).toBeGreaterThan(menuIdx);
    expect(insightsIdx).toBeLessThan(settingsIdx);
    expect(rail[0]).toBe("overview");
  });

  it("the #1737 extension point registers ONLY the site instrument today", () => {
    expect(INSIGHT_INSTRUMENTS).toEqual(["site"]);
    expect(insightInstrumentRegistered("site")).toBe(true);
    // The pricing to-do row + read stay dark until #1737 appends "pricing".
    expect(insightInstrumentRegistered("pricing")).toBe(false);
  });
});
