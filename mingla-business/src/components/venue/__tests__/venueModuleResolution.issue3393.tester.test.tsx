/** Independent adversarial module lifecycle tests: use the real shell,
 * parser and UI bridge; stub only fetched settings and rendered child leaves. */
import React from "react";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import type { VenueModule } from "../../../types/venueReservation";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mockSettings: { data: { reservationsEnabled: boolean } | null | undefined; isError: boolean };
const mockHost = (name: string) => function Host(props: Record<string, unknown>) { return React.createElement(name, props, props.children as React.ReactNode); };
jest.mock("../../../hooks/useVenueReservationSettings", () => ({ useVenueReservationSettings: () => mockSettings, useSetReservationsEnabled: () => ({ mutate: jest.fn(), isPending: false }) }));
jest.mock("../../../hooks/useResponsiveLayout", () => ({ useResponsiveLayout: () => ({ isWideDesktop: false }) }));
jest.mock("../../../wrappers/SmartScrollView", () => ({ ScrollView: mockHost("ScrollView") }));
jest.mock("../../suite/SuiteDesktopShell", () => ({ SuiteDesktopShell: mockHost("Desktop") }));
jest.mock("../../ui/Button", () => ({ Button: mockHost("Button") }));
jest.mock("../../ui/GlassCard", () => ({ GlassCard: mockHost("GlassCard") }));
jest.mock("../VenueAvailabilityModule", () => ({ VenueAvailabilityModule: React.forwardRef(function Availability(props, _ref) { return React.createElement("availability", props); }) }));
for (const [path, name, host] of [
  ["../VenueIntelligenceModule", "VenueIntelligenceModule", "overview"],
  ["../VenueMenuModule", "VenueMenuModule", "menu"],
  ["../VenueReservationsModule", "VenueReservationsModule", "reservations"],
  ["../VenueSettingsModule", "VenueSettingsModule", "settings"],
  ["../VenueTablesModule", "VenueTablesModule", "tables"],
  ["../VenueWaitlistModule", "VenueWaitlistModule", "waitlist"],
  ["../VenueOrdersModule", "VenueOrdersModule", "orders"],
  ["../insights/VenueInsightsModule", "VenueInsightsModule", "insights"],
]) jest.doMock(path, () => ({ [name]: mockHost(host) }));
const { VenueSuiteShell } = require("../VenueSuiteShell") as typeof import("../VenueSuiteShell");
const { useVenueSuiteStore } = require("../../../store/venueSuiteStore") as typeof import("../../../store/venueSuiteStore");
const { parseVenueModuleParam, VENUE_MODULES } = require("../venueModules") as typeof import("../venueModules");
const Renderer = require("react-test-renderer");
const mounted: Array<{ unmount: () => void }> = [];
const element = (module: VenueModule) => <VenueSuiteShell brandId="brand-3393" venueId="venue-3393" initialModule={module} />;
async function mount(module: VenueModule) {
  let tree: any;
  await Renderer.act(async () => { tree = Renderer.create(element(module)); });
  mounted.push(tree); return tree;
}
beforeEach(() => { mockSettings = { data: undefined, isError: false }; useVenueSuiteStore.getState().deactivate(); });
afterEach(async () => { await Renderer.act(async () => { mounted.splice(0).forEach(tree => tree.unmount()); }); });
test.each(Object.keys(VENUE_MODULES) as VenueModule[])("%s accepted link renders its real shell branch with this venue", async module => {
  mockSettings = { data: { reservationsEnabled: true }, isError: false };
  const tree = await mount(parseVenueModuleParam(module)!);
  expect(useVenueSuiteStore.getState().activeModule).toBe(module);
  expect(tree.root.findByType(module).props.venueId).toBe("venue-3393");
});
test.each(["__proto__", "constructor", "TABLES", "", "menu?redirect=elsewhere"])("unknown link %s renders Overview", async raw => {
  const tree = await mount(parseVenueModuleParam(raw) ?? "overview");
  expect(tree.root.findByType("overview")).toBeDefined();
});
test.each(["tables", "availability", "reservations", "waitlist"] as VenueModule[])("%s survives repeated loading, resolves ON, then leaves only when OFF", async module => {
  const tree = await mount(module);
  for (let i = 0; i < 2; i++) {
    await Renderer.act(async () => { tree.update(element(module)); });
    expect(useVenueSuiteStore.getState().activeModule).toBe(module);
  }
  mockSettings = { data: { reservationsEnabled: true }, isError: false };
  await Renderer.act(async () => { tree.update(element(module)); });
  expect(tree.root.findByType(module)).toBeDefined();
  mockSettings = { data: { reservationsEnabled: false }, isError: false };
  await Renderer.act(async () => { tree.update(element(module)); });
  expect(useVenueSuiteStore.getState().activeModule).toBe("overview");
  expect(tree.root.findByType("Button").props.label).toBe("Turn on Reservations");
});
test("a failed initial settings request is not a confirmed OFF and must preserve the deep link on retry", async () => {
  const tree = await mount("tables");
  mockSettings = { data: undefined, isError: true };
  await Renderer.act(async () => { tree.update(element("tables")); });
  mockSettings = { data: { reservationsEnabled: true }, isError: false };
  await Renderer.act(async () => { tree.update(element("tables")); });
  expect(useVenueSuiteStore.getState().activeModule).toBe("tables");
  expect(tree.root.findByType("tables")).toBeDefined();
});
