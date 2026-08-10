/**
 * Issue #1735 T-G12 (happy half) — the Overview Site-check cross-link tile.
 *
 * Fails-on-revert anchor: deleting the report-exists gate (rendering the
 * tile on `status:"none"` / loading / error) turns the renders-NOTHING
 * assertions RED; deleting the deep link turns the route assertion RED.
 */

import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ReactLocal = require("react") as typeof React;

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  useRouter: () => ({ push: mockPush }),
}));

const mockUseIntelSubjectLatest = jest.fn();
jest.mock("../../../../hooks/useGrowthTools", () => ({
  __esModule: true,
  useIntelSubjectLatest: (...args: unknown[]) =>
    mockUseIntelSubjectLatest(...args),
}));

jest.mock("../../../ui/GlassCard", () => ({
  __esModule: true,
  GlassCard: (props: { children?: unknown; testID?: string }) =>
    ReactLocal.createElement("GlassCard", props, props.children as never),
}));
jest.mock("../SiteCheckInstrument", () => ({
  __esModule: true,
  GradeBadge: (props: Record<string, unknown>) =>
    ReactLocal.createElement("GradeBadge", props),
}));

import { SiteCheckOverviewTile } from "../SiteCheckOverviewTile";

interface RenderNode {
  type?: unknown;
  props: Record<string, unknown> & { children?: unknown; testID?: string };
}
interface RenderTree {
  root: { findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[] };
  toJSON: () => unknown;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const render = async (): Promise<RenderTree> => {
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <SiteCheckOverviewTile brandId="brand-1" venueId="venue-1" />,
    );
  });
  return tree!;
};

beforeEach(() => {
  mockPush.mockReset();
  mockUseIntelSubjectLatest.mockReset();
});

describe("issue #1735 SiteCheckOverviewTile (T-G12)", () => {
  it("renders the tile ONLY when a persisted report exists, deep-linking to Insights", async () => {
    mockUseIntelSubjectLatest.mockReturnValue({
      data: {
        status: "report_ready",
        latest: {
          runId: "r1",
          createdAt: "2026-08-01T00:00:00Z",
          report: {
            scores: {
              grade: "B",
              first_impression: 80,
              reasons: { first_impression: "Strong hero." },
            },
          },
          input: null,
        },
        previous: null,
      },
      isLoading: false,
      isError: false,
    });
    const tree = await render();
    // Filter to the HOST node — react-test-renderer surfaces both the mock
    // component fiber and its host element for the same testID.
    const tile = tree.root.findAll(
      (n) => n.type === "GlassCard" && n.props.testID === "overview-site-check-tile",
    );
    expect(tile).toHaveLength(1);
    const press = tree.root.findAll(
      (n) => n.props.testID === "overview-site-check-tile-press",
    )[0]!;
    (press.props.onPress as () => void)();
    expect(mockPush).toHaveBeenCalledWith("/venue/venue-1?module=insights");
    // The tile reads the SAME subjectRead key family (RQ-deduped).
    expect(mockUseIntelSubjectLatest).toHaveBeenCalledWith(
      "brand-1",
      "venues",
      "venue:venue-1",
    );
  });

  it("status none ⇒ renders NOTHING (module + to-do own acquisition)", async () => {
    mockUseIntelSubjectLatest.mockReturnValue({
      data: { status: "none" },
      isLoading: false,
      isError: false,
    });
    const tree = await render();
    expect(tree.toJSON()).toBeNull();
  });

  it("loading ⇒ renders NOTHING", async () => {
    mockUseIntelSubjectLatest.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    const tree = await render();
    expect(tree.toJSON()).toBeNull();
  });

  it("error ⇒ renders NOTHING (never an empty nudge tile here)", async () => {
    mockUseIntelSubjectLatest.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    const tree = await render();
    expect(tree.toJSON()).toBeNull();
  });
});
