import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const ReactLocal = require("react") as typeof React;
const mockBrief = jest.fn();

jest.mock("../../../../hooks/useCompetitorIntelligence", () => ({
  useCompetitorBrief: (...args: unknown[]) => mockBrief(...args),
}));
jest.mock("../../../../analytics/competitorIntelligenceAnalytics", () => ({
  captureCompetitorIntelligenceEvent: jest.fn(),
}));
jest.mock("../../../../services/guestFunnelLink", () => ({
  openExternal: jest.fn(),
}));
jest.mock("../../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    ReactLocal.createElement("Button", props),
}));
jest.mock("../../../ui/GlassCard", () => ({
  GlassCard: (props: Record<string, unknown> & { children?: unknown }) =>
    ReactLocal.createElement("GlassCard", props, props.children as never),
}));
jest.mock("../../../ui/Sheet", () => ({
  Sheet: (props: Record<string, unknown> & { children?: unknown }) =>
    ReactLocal.createElement("Sheet", props, props.children as never),
}));

import { CompetitorBriefSheet } from "../CompetitorBriefSheet";
import type { CompetitorWatchV2Row } from "../../../../types/growthTools";

interface Node {
  type?: unknown;
  props: Record<string, unknown> & { children?: unknown; testID?: string };
}
interface Tree {
  root: { findAll: (predicate: (node: Node) => boolean) => Node[] };
  unmount: () => void;
}
const Renderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};
const output = (tree: Tree): string =>
  tree.root
    .findAll((node) => typeof node.props.children === "string")
    .map((node) => String(node.props.children))
    .join(" ");
const byId = (tree: Tree, id: string): Node[] =>
  tree.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === id,
  );

const row: CompetitorWatchV2Row = {
  schemaVersion: 2,
  id: "hostile-first-brief",
  name: "Shiro Lagos",
  city: "Lagos",
  website: "https://shiro.example",
  placePoolId: "place-shiro",
  createdAt: "2026-08-28T13:00:00Z",
  updatedAt: "2026-08-28T13:00:00Z",
  freshness: "current",
  lastBriefUpdatedAt: "2026-08-28T13:00:00Z",
  checkedAt: "2026-08-28T13:00:00Z",
  nextRefreshAt: "2026-09-05T05:03:07Z",
  noMeaningfulChange: false,
  manualRefreshState: "available",
  sources: [
    {
      id: "website-1",
      kind: "website",
      url: "https://shiro.example",
      capability: "analyzed_weekly",
      availability: "enabled",
      availabilityGeneration: 1,
      health: "current",
      lastCheckedAt: "2026-08-28T13:00:00Z",
      safeReason: null,
    },
  ],
  summary: {
    whatChanged: "Mingla checked Shiro Lagos public information.",
    primaryAction: "Launch a Friday event immediately.",
  },
  activeJob: null,
  latest: null,
};

describe("issue 2781 hostile first-brief client boundary", () => {
  it("suppresses generic observations and their fabricated action", async () => {
    mockBrief.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      data: {
        updatedAt: row.createdAt,
        nextRefreshAt: row.nextRefreshAt,
        freshness: "current",
        noMeaningfulChange: false,
        sources: row.sources,
        brief: {
          status: "current",
          whatChanged: [
            {
              id: "generic-1",
              text: "Mingla checked Shiro Lagos public information.",
              sourceId: "website-1",
              evidenceId: "evidence-1",
              confidence: "observed",
            },
            {
              id: "generic-2",
              text: "Public information was checked for Shiro Lagos.",
              sourceId: "website-1",
              evidenceId: "evidence-1",
              confidence: "observed",
            },
          ],
          whyItMatters: [
            {
              text: "This may affect the venue.",
              evidenceIds: ["evidence-1"],
              confidence: "interpretation",
            },
          ],
          worthDoing: [
            {
              id: "fabricated-action",
              text: "Launch a Friday event immediately.",
              kind: "launch",
              confidence: "suggested_action",
              isPrimary: true,
            },
          ],
          evidence: [
            {
              id: "evidence-1",
              sourceId: "website-1",
              publicUrl: "https://shiro.example",
              checkedAt: "2026-08-28T13:00:00Z",
              observation: "Public information was checked.",
            },
          ],
        },
      },
    });

    let tree: Tree | null = null;
    await Renderer.act(async () => {
      tree = Renderer.create(
        <CompetitorBriefSheet
          visible
          onClose={jest.fn()}
          brandId="brand-1"
          venueName="Gogi Lagos"
          row={row}
        />,
      );
    });

    const rendered = output(tree!);
    expect(rendered).toContain(
      "Not enough public detail for a useful brief yet",
    );
    expect(rendered).not.toContain("CURRENT PUBLIC OBSERVATIONS");
    expect(rendered).not.toContain("WORTH DOING NEXT");
    expect(rendered).not.toContain("Launch a Friday event immediately.");
    expect(byId(tree!, "competitor-brief-sheet-insufficient")).toHaveLength(1);
    expect(byId(tree!, "competitor-brief-sheet")[0]?.props.presentation).toBe(
      "competition",
    );

    await Renderer.act(async () => {
      tree!.unmount();
    });
  });
});
