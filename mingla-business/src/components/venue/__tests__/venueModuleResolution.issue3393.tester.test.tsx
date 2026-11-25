/** Independent adversarial module lifecycle tests: use the real shell,
 * parser and UI bridge; stub only fetched settings and rendered child leaves. */
import React from "react";

// #4490 — the shell reads venue features. These harnesses drive the nav from the
// mocked reservation settings, so the features read "fails" here and the shell
// falls back to the server's backfill rule (features follow the old switch).
jest.mock("../../../hooks/useVenueFeatures", () => ({
  useVenueFeatures: () => ({ data: undefined, isError: true, isLoading: false }),
  useSetVenueFeature: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("../../../hooks/useMyVenueAccess", () => ({
  useMyVenueAccess: () => ({
    data: { scoped: false, capabilities: [] },
    isFetched: true,
    isError: false,
    refetch: () => Promise.resolve(),
  }),
}));
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import type { VenueModule } from "../../../types/venueReservation";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mockSettings: { data: { reservationsEnabled: boolean } | null | undefined; isError: boolean };
const mockHost = (name: string) => function Host(props: Record<string, unknown>) { return React.createElement(name, props, props.children as React.ReactNode); };
// [TEST-MOD-APPROVED #3655] VenueSuiteShell leave beforeRemove uses useNavigation;
// mock before the shell import so expo-router's Stack JSX is never loaded.
jest.mock("expo-router", () => ({
  useNavigation: () => ({ addListener: () => () => undefined, dispatch: jest.fn() }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
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
// [TEST-MOD-APPROVED #4420] round-3 item 19: Reviews is its own module, shown only when the page
// passes its reviews panel (a verified venue with a place). The panel is a leaf host here.
const reviewsLeaf = React.createElement("reviews", { venueId: "venue-3393" });
const element = (module: VenueModule, withReviews = true) => <VenueSuiteShell brandId="brand-3393" venueId="venue-3393" initialModule={module} reviewsPanel={withReviews ? reviewsLeaf : null} />;
async function mount(module: VenueModule, withReviews = true) {
  let tree: any;
  await Renderer.act(async () => { tree = Renderer.create(element(module, withReviews)); });
  mounted.push(tree); return tree;
}
beforeEach(() => { mockSettings = { data: undefined, isError: false }; useVenueSuiteStore.getState().deactivate(); });
afterEach(async () => { await Renderer.act(async () => { mounted.splice(0).forEach(tree => tree.unmount()); }); });
// [TEST-MOD-APPROVED #4490] — modules hidden for this venue (no spaces yet, or
// a phase not shipped) are accepted links that land on Overview instead.
// [TEST-MOD-APPROVED #4490] 07-I: Guest list shows only with the guest_list
// feature, which this harness never enables (features fall back to the old
// reservations switch), so a guestlist link lands on Overview like the others.
// [TEST-MOD-APPROVED #4490] spec 08 O1: the Till shows only when released (VENUE_TILL), switched on
// and allowed to sell; none of that holds here, so a till link also lands on Overview.
// [TEST-MOD-APPROVED #4490] spec 08 O3: Kitchen and bar likewise (released, feature on, kitchen rights).
// [TEST-MOD-APPROVED #4490] spec 08 O5 part B: Close the day likewise (released, Sell in person on, money rights).
const HIDDEN_FOR_CLASSIC_VENUE: VenueModule[] = ["offers", "spaces", "today", "calendar", "requests", "members", "checkin", "guestlist", "till", "stations", "close"];
test.each(HIDDEN_FOR_CLASSIC_VENUE)("%s link to a venue that does not show it lands on Overview", async module => {
  mockSettings = { data: { reservationsEnabled: true }, isError: false };
  await mount(parseVenueModuleParam(module)!);
  expect(useVenueSuiteStore.getState().activeModule).toBe("overview");
});
test.each((Object.keys(VENUE_MODULES) as VenueModule[]).filter(m => !HIDDEN_FOR_CLASSIC_VENUE.includes(m)))("%s accepted link renders its real shell branch with this venue", async module => {
  mockSettings = { data: { reservationsEnabled: true }, isError: false };
  const tree = await mount(parseVenueModuleParam(module)!);
  expect(useVenueSuiteStore.getState().activeModule).toBe(module);
  expect(tree.root.findByType(module).props.venueId).toBe("venue-3393");
});
test("a reviews link to a venue with no reviews panel lands on Overview, never an empty module", async () => {
  mockSettings = { data: { reservationsEnabled: true }, isError: false };
  const tree = await mount("reviews", false);
  expect(useVenueSuiteStore.getState().activeModule).toBe("overview");
  expect(useVenueSuiteStore.getState().visibleModules).not.toContain("reviews");
  expect(tree.root.findByType("overview")).toBeDefined();
});
test("Reviews sits right after Overview when the page has a reviews panel", async () => {
  mockSettings = { data: { reservationsEnabled: false }, isError: false };
  await mount("overview");
  expect(useVenueSuiteStore.getState().visibleModules.slice(0, 2)).toEqual(["overview", "reviews"]);
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
  // [TEST-MOD-APPROVED #4420] B8 — the invitation now scrolls with Overview,
  // handed to the module as its `header`, not pinned above it.
  const header = tree.root.findByType("overview").props.header as React.ReactElement;
  const findButton = (node: unknown): { props: { label?: string } } | null => {
    if (!React.isValidElement(node)) return Array.isArray(node) ? node.map(findButton).find(Boolean) ?? null : null;
    if ((node.props as { testID?: string }).testID === "venue-overview-turn-on-reservations") {
      return node as unknown as { props: { label?: string } };
    }
    return findButton((node.props as { children?: unknown }).children);
  };
  expect(findButton(header)?.props.label).toBe("Turn on Reservations");
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
