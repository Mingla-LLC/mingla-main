/**
 * #3389 (umbrella #3393) — implementor happy-path regression: a venue deep
 * link keeps the module the host asked for when the reservation settings
 * request fails and the retry then succeeds.
 *
 * Before the fix the suite shell counted a FAILED settings request as a
 * resolved answer. `reservationsEnabled` reads `false` on that frame, so the
 * shell bounced `?module=tables` to Overview, and when the retry came back
 * with bookings ON the host was left on Overview. A failed request is not a
 * confirmed OFF: the shell now waits for real data before deciding.
 *
 * The REAL VenueSuiteShell and the REAL venueSuiteStore pill-row bridge are
 * mounted under the stock config; only the settings hook and leaf modules are
 * stubbed, so the assertions read exactly what the shell decides.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mockSettingsQuery: {
  data: { reservationsEnabled: boolean } | null | undefined;
  isError: boolean;
};
jest.mock("../../../hooks/useVenueReservationSettings", () => ({
  __esModule: true,
  useVenueReservationSettings: () => mockSettingsQuery,
  useSetReservationsEnabled: () => ({ mutate: () => undefined, isPending: false }),
}));

jest.mock("../../../hooks/useResponsiveLayout", () => ({
  __esModule: true,
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));

jest.mock("react-native-safe-area-context", () => ({
  __esModule: true,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockLeaf = (name: string) => (props: Record<string, unknown>) => {
  const ReactActual = require("react") as typeof React;
  return ReactActual.createElement(name, props, props.children as React.ReactNode);
};

jest.mock("../../ui/Button", () => ({ __esModule: true, Button: mockLeaf("Button") }));
jest.mock("../../ui/GlassCard", () => ({ __esModule: true, GlassCard: mockLeaf("GlassCard") }));
jest.mock("../../../wrappers/SmartScrollView", () => ({
  __esModule: true,
  ScrollView: mockLeaf("ScrollView"),
}));
jest.mock("../../suite/SuiteDesktopShell", () => ({
  __esModule: true,
  SuiteDesktopShell: mockLeaf("SuiteDesktopShell"),
}));
jest.mock("../VenueAvailabilityModule", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    VenueAvailabilityModule: ReactActual.forwardRef(() => null),
  };
});
jest.mock("../VenueIntelligenceModule", () => ({
  __esModule: true,
  VenueIntelligenceModule: mockLeaf("VenueIntelligenceModule"),
}));
jest.mock("../VenueSettingsModule", () => ({
  __esModule: true,
  VenueSettingsModule: mockLeaf("VenueSettingsModule"),
}));
jest.mock("../VenueMenuModule", () => ({ __esModule: true, VenueMenuModule: mockLeaf("VenueMenuModule") }));
jest.mock("../VenueReservationsModule", () => ({
  __esModule: true,
  VenueReservationsModule: mockLeaf("VenueReservationsModule"),
}));
jest.mock("../VenueTablesModule", () => ({ __esModule: true, VenueTablesModule: mockLeaf("VenueTablesModule") }));
jest.mock("../VenueWaitlistModule", () => ({
  __esModule: true,
  VenueWaitlistModule: mockLeaf("VenueWaitlistModule"),
}));

import { useVenueSuiteStore } from "../../../store/venueSuiteStore";
import { VenueSuiteShell } from "../VenueSuiteShell";

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Tree {
  root: TestInstance;
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const shell = (): React.ReactElement => (
  <VenueSuiteShell brandId="brand-3393" venueId="venue-3393" initialModule="tables" />
);

const mounted: Tree[] = [];

async function mountShell(): Promise<Tree> {
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(shell());
  });
  mounted.push(tree);
  return tree;
}

async function settingsAnswer(
  tree: Tree,
  next: typeof mockSettingsQuery,
): Promise<void> {
  mockSettingsQuery = next;
  await TestRenderer.act(async () => {
    tree.update(shell());
  });
}

function rendered(tree: Tree, type: string): number {
  return tree.root.findAll((node) => node.type === type).length;
}

beforeEach(() => {
  mockSettingsQuery = { data: undefined, isError: false };
  useVenueSuiteStore.getState().deactivate();
});

afterEach(async () => {
  await TestRenderer.act(async () => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
});

describe("#3389 — a failed settings request does not lose the requested module", () => {
  test("Tables link: request fails, retry says bookings ON, host lands on Tables with its pill", async () => {
    const tree = await mountShell();

    await settingsAnswer(tree, { data: undefined, isError: true });
    expect(useVenueSuiteStore.getState().activeModule).toBe("tables");
    expect(rendered(tree, "VenueIntelligenceModule")).toBe(0);

    await settingsAnswer(tree, { data: { reservationsEnabled: true }, isError: false });
    const state = useVenueSuiteStore.getState();
    expect(state.activeModule).toBe("tables");
    expect(state.visibleModules).toContain("tables");
    expect(rendered(tree, "VenueTablesModule")).toBe(1);
    expect(rendered(tree, "VenueIntelligenceModule")).toBe(0);
  });

  test("Tables link: request fails, retry confirms bookings OFF, host is sent to Overview", async () => {
    const tree = await mountShell();

    await settingsAnswer(tree, { data: undefined, isError: true });
    await settingsAnswer(tree, { data: null, isError: false });

    expect(useVenueSuiteStore.getState().activeModule).toBe("overview");
    expect(rendered(tree, "VenueIntelligenceModule")).toBe(1);
    expect(rendered(tree, "VenueTablesModule")).toBe(0);
  });

  test("Tables open with bookings ON: a later refresh failure keeps the host on Tables", async () => {
    const tree = await mountShell();

    await settingsAnswer(tree, { data: { reservationsEnabled: true }, isError: false });
    // React Query keeps the last good `data` when a background refetch fails.
    await settingsAnswer(tree, { data: { reservationsEnabled: true }, isError: true });

    expect(useVenueSuiteStore.getState().activeModule).toBe("tables");
    expect(rendered(tree, "VenueTablesModule")).toBe(1);
  });
});
