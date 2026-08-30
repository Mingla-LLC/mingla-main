import React from "react";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const ReactLocal = require("react") as typeof React;
const mockWatch = jest.fn();
const mockBrief = jest.fn();
const mockSearch = jest.fn();
const mutation = {
  mutate: jest.fn(),
  reset: jest.fn(),
  isPending: false,
  isError: false,
  error: null,
};
jest.mock("../../../../hooks/useCompetitorIntelligence", () => ({
  useCompetitorWatch: (...args: unknown[]) => mockWatch(...args),
  useCompetitorBrief: (...args: unknown[]) => mockBrief(...args),
  useAddCompetitor: () => mutation,
  useRefreshCompetitor: () => mutation,
  useRemoveCompetitor: () => mutation,
}));
jest.mock("../../../../hooks/useVenueListings", () => ({
  useVenueListing: () => ({ data: { name: "Gogi Lagos" } }),
}));
jest.mock("../../../../context/AuthContext", () => ({
  useAuth: () => ({
    loading: false,
    isAuthReady: true,
    session: { user: { id: "u1" } },
  }),
}));
jest.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => mockSearch(...args),
}));
jest.mock("../../../../analytics/competitorIntelligenceAnalytics", () => ({
  captureCompetitorIntelligenceEvent: jest.fn(),
  captureIntelCompetitorAdded: jest.fn(),
}));
jest.mock("../../../../services/guestFunnelLink", () => ({
  openExternal: jest.fn(),
}));
jest.mock("../../../ui/Icon", () => ({
  Icon: (props: Record<string, unknown>) =>
    ReactLocal.createElement("Icon", props),
}));
jest.mock("../../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    ReactLocal.createElement("Button", props),
}));
jest.mock("../../../ui/GlassCard", () => ({
  GlassCard: (props: Record<string, unknown> & { children?: unknown }) =>
    ReactLocal.createElement("GlassCard", props, props.children as never),
}));
jest.mock("../../../ui/Input", () => ({
  Input: (props: Record<string, unknown>) =>
    ReactLocal.createElement("Input", props),
}));
jest.mock("../../../ui/Sheet", () => ({
  Sheet: (props: Record<string, unknown> & { children?: unknown }) =>
    ReactLocal.createElement("Sheet", props, props.children as never),
}));
jest.mock("../../../ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: Record<string, unknown>) =>
    ReactLocal.createElement("ConfirmDialog", props),
}));
jest.mock("../../../../wrappers/SmartScrollView", () => ({
  ScrollView: (props: Record<string, unknown> & { children?: unknown }) =>
    ReactLocal.createElement("ScrollView", props, props.children as never),
}));

import { CompetitorAddSheet } from "../CompetitorAddSheet";
import { CompetitorBriefSheet } from "../CompetitorBriefSheet";
import {
  CompetitorWatchSection,
  formatCalendarTime,
} from "../CompetitorWatchSection";
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
const trees: Tree[] = [];
const FIXED_NOW_MS = Date.parse("2026-08-28T16:00:00Z");
const render = async (element: React.ReactElement): Promise<Tree> => {
  let tree: Tree | null = null;
  await Renderer.act(async () => {
    tree = Renderer.create(element);
  });
  trees.push(tree!);
  return tree!;
};
const byId = (tree: Tree, id: string): Node[] =>
  tree.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === id,
  );
const buttons = (tree: Tree, label: string): Node[] =>
  tree.root.findAll(
    (node) => node.type === "Button" && node.props.label === label,
  );
const output = (tree: Tree): string =>
  tree.root
    .findAll((node) => typeof node.props.children === "string")
    .map((node) => String(node.props.children))
    .join(" ");

const row: CompetitorWatchV2Row = {
  schemaVersion: 2,
  id: "shiro",
  name: "Shiro Lagos",
  city: "Lagos",
  website: "https://shiro.example",
  placePoolId: "place-shiro",
  createdAt: "2026-08-28T13:00:00Z",
  updatedAt: "2026-08-28T14:00:00Z",
  freshness: "current",
  lastBriefUpdatedAt: "2026-08-28T14:00:00Z",
  checkedAt: "2026-08-28T14:00:00Z",
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
      lastCheckedAt: "2026-08-28T14:00:00Z",
      safeReason: null,
    },
    {
      id: "instagram-1",
      kind: "instagram",
      url: "https://instagram.com/shirolagos",
      capability: "analyzed_weekly",
      availability: "enabled",
      availabilityGeneration: 1,
      health: "current",
      lastCheckedAt: "2026-08-28T14:00:00Z",
      safeReason: null,
    },
    {
      id: "tiktok-1",
      kind: "tiktok",
      url: "https://tiktok.com/@shirolagos",
      capability: "link_only",
      availability: "enabled",
      availabilityGeneration: 1,
      health: "current",
      lastCheckedAt: null,
      safeReason: null,
    },
  ],
  summary: {
    whatChanged: "Shiro's public Instagram promotes live music Fridays.",
    primaryAction: "Publish Gogi's existing Thursday live-music event.",
  },
  activeJob: null,
  latest: null,
};

beforeEach(() => {
  jest.spyOn(Date, "now").mockReturnValue(FIXED_NOW_MS);
  mockSearch.mockReturnValue({
    data: [
      {
        id: "place-shiro",
        name: "Shiro Lagos",
        city: "Lagos",
        website: "https://shiro.example",
      },
    ],
    isFetching: false,
    isFetched: true,
    isError: false,
    refetch: jest.fn(),
  });
});
afterEach(() => {
  trees.splice(0).forEach((tree) => tree.unmount());
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe("issue 2725 premium Competition live journey", () => {
  it("has one truthful door for empty, populated, loading, error, offline and cap states", async () => {
    for (const state of [
      { data: [], isLoading: false, isError: false },
      { data: [], isLoading: true, isError: false },
      { data: [], isLoading: false, isError: true },
    ]) {
      mockWatch.mockReturnValue({ ...state, refetch: jest.fn() });
      const tree = await render(
        <CompetitorWatchSection
          brandId="b1"
          venueListingId="gogi"
          venueCity="Lagos"
          offline={false}
        />,
      );
      expect(buttons(tree, "Watch a competitor").length).toBe(
        state.isLoading || state.isError ? 0 : 1,
      );
    }
    mockWatch.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    const offline = await render(
      <CompetitorWatchSection brandId="b1" venueListingId="gogi" offline />,
    );
    expect(buttons(offline, "Watch a competitor")).toHaveLength(1);
    expect(buttons(offline, "Watch a competitor")[0]?.props.disabled).toBe(
      true,
    );
    mockWatch.mockReturnValue({
      data: [row],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    const populated = await render(
      <CompetitorWatchSection
        brandId="b1"
        venueListingId="gogi"
        offline={false}
      />,
    );
    expect(buttons(populated, "Watch a competitor")).toHaveLength(1);
    expect(output(populated)).toContain("Keep an eye on nearby venues");
    expect(output(populated)).toContain("Next refresh Sep 5");
    expect(output(populated)).not.toContain("Next refresh today");
    mockWatch.mockReturnValue({
      data: Array.from({ length: 5 }, (_, index) => ({
        ...row,
        id: `shiro-${index}`,
      })),
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    const capped = await render(
      <CompetitorWatchSection
        brandId="b1"
        venueListingId="gogi"
        offline={false}
      />,
    );
    const cappedAction = buttons(capped, "Watch a competitor");
    expect(cappedAction).toHaveLength(1);
    expect(cappedAction[0]?.props.disabled).toBe(true);
    expect(output(capped)).toContain(
      "Watching 5 of 5 — remove one to add another.",
    );
  });

  it("uses local calendar boundaries and never calls a future week today", () => {
    const now = Date.parse("2026-08-28T12:00:00-04:00");
    expect(formatCalendarTime("2026-08-28T17:03:00-04:00", now)).toContain(
      "Today,",
    );
    expect(formatCalendarTime("2026-08-29T05:03:00-04:00", now)).toContain(
      "Tomorrow,",
    );
    expect(formatCalendarTime("2026-09-05T05:03:07-04:00", now)).toContain(
      "Sep 5",
    );
    expect(formatCalendarTime("bad", now)).toBe("—");
  });

  it("keeps preparing, partial, stale, attention, link-only and delayed states honest", async () => {
    const cases: Array<{
      candidate: CompetitorWatchV2Row;
      copy: string;
      action?: string;
    }> = [
      {
        candidate: {
          ...row,
          freshness: "refreshing",
          lastBriefUpdatedAt: null,
          summary: { whatChanged: null, primaryAction: null },
          manualRefreshState: "joined",
        },
        copy: "Preparing your first sourced brief",
      },
      {
        candidate: {
          ...row,
          freshness: "partial",
          sources: row.sources.map((source) =>
            source.kind === "instagram"
              ? { ...source, health: "unreachable", safeReason: "unreachable" }
              : source,
          ),
        },
        copy: "Instagram · Unreachable",
      },
      {
        candidate: {
          ...row,
          freshness: "stale",
          manualRefreshState: "available",
        },
        copy: "Stale",
        action: "Refresh now",
      },
      {
        candidate: {
          ...row,
          freshness: "needs_attention",
          manualRefreshState: "available",
        },
        copy: "Needs attention",
        action: "Try again",
      },
      {
        candidate: {
          ...row,
          freshness: "link_only",
          summary: { whatChanged: null, primaryAction: null },
          sources: row.sources.filter((source) => source.kind === "tiktok"),
        },
        copy: "TikTok is saved as a link; it is not analyzed weekly.",
        action: "Open TikTok",
      },
      {
        candidate: {
          ...row,
          freshness: "budget_delayed",
          summary: { whatChanged: null, primaryAction: null },
        },
        copy: "Your next automatic check is delayed; no action needed.",
      },
    ];
    for (const item of cases) {
      mockWatch.mockReturnValue({
        data: [item.candidate],
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
      });
      const tree = await render(
        <CompetitorWatchSection
          brandId="b1"
          venueListingId="gogi"
          offline={false}
        />,
      );
      expect(output(tree)).toContain(item.copy);
      if (item.action === "Open TikTok") {
        expect(buttons(tree, item.action)).toHaveLength(2);
        expect(
          tree.root.findAll(
            (node) =>
              node.props.importantForAccessibility === "no-hide-descendants",
          ).length,
        ).toBeGreaterThan(0);
      } else if (item.action) {
        expect(buttons(tree, item.action)).toHaveLength(1);
      }
    }
  });

  it("covers nearby selection, manual entry, source validation and dirty dismissal", async () => {
    const onClose = jest.fn();
    const tree = await render(
      <CompetitorAddSheet
        visible
        onClose={onClose}
        brandId="b1"
        venueListingId="gogi"
        venueCity="Lagos"
      />,
    );
    expect(byId(tree, "competitor-source-sheet")[0]?.props.presentation).toBe(
      "competition",
    );
    expect(output(tree)).toContain("NEARBY IN LAGOS");
    const result = tree.root.findAll(
      (node) => node.props.accessibilityLabel === "Select Shiro Lagos in Lagos",
    )[0]!;
    expect((result.props.style as { minHeight?: number }).minHeight ?? 56).toBe(
      56,
    );
    await Renderer.act(async () => {
      (result.props.onPress as () => void)();
    });
    expect(output(tree)).toContain("SOURCES MINGLA CAN WATCH");
    expect(byId(tree, "competitor-source-sheet-submit")[0]?.props.label).toBe(
      "Watch competitor",
    );
    await Renderer.act(async () => {
      (
        byId(tree, "competitor-source-sheet-instagram-input")[0]?.props
          .onChangeText as (value: string) => void
      )("not-a-profile");
    });
    expect(byId(tree, "competitor-source-sheet-instagram-error")).toHaveLength(
      1,
    );
    await Renderer.act(async () => {
      (byId(tree, "competitor-source-sheet")[0]?.props.onClose as () => void)();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(byId(tree, "competitor-source-sheet-discard-confirm")).toHaveLength(
      1,
    );
  });

  it("renders decision-first observations, Gogi relevance, bounded actions and inline evidence in order", async () => {
    mockBrief.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      data: {
        updatedAt: "2026-08-28T14:00:00Z",
        nextRefreshAt: row.nextRefreshAt,
        freshness: "current",
        noMeaningfulChange: false,
        sources: row.sources,
        brief: {
          status: "current",
          whatChanged: [
            {
              id: "f1",
              text: "Shiro's public Instagram promotes live music Fridays.",
              sourceId: "instagram-1",
              evidenceId: "e1",
              confidence: "observed",
            },
          ],
          whyItMatters: [
            {
              text: "Because Gogi publishes a Thursday event, Friday discovery may be worth considering.",
              evidenceIds: ["e1"],
              confidence: "interpretation",
            },
          ],
          worthDoing: [
            {
              id: "a1",
              text: "Publish Gogi's existing Thursday event on Mingla.",
              kind: "publish",
              confidence: "suggested_action",
              isPrimary: true,
            },
            {
              id: "a2",
              text: "A second idea must not render.",
              kind: "ignore",
              confidence: "suggested_action",
              isPrimary: false,
            },
          ],
          evidence: [
            {
              id: "e1",
              sourceId: "instagram-1",
              publicUrl: "https://instagram.com/shirolagos",
              observedAt: "2026-08-27T19:00:00Z",
              checkedAt: "2026-08-28T14:00:00Z",
              observation: "Instagram's public post says “Live music Fridays”.",
            },
          ],
        },
      },
    });
    const tree = await render(
      <CompetitorBriefSheet
        visible
        onClose={jest.fn()}
        brandId="b1"
        venueName="Gogi Lagos"
        row={row}
      />,
    );
    const text = output(tree);
    let cursor = -1;
    for (const heading of [
      "WHAT HAPPENED",
      "Signal health",
      "CURRENT PUBLIC SIGNALS",
      "COMPETITIVE READ",
      "YOUR MOVE",
    ]) {
      const next = text.indexOf(heading);
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(text).not.toContain("Mingla checked public information");
    expect(text).toContain("A second idea must not render");
    expect(text).not.toContain("SOURCE EVIDENCE");
    expect(text).not.toContain("Open original source");
    const evidence = byId(tree, "competitor-signal-f1-evidence");
    expect(evidence).toHaveLength(1);
    expect(
      (evidence[0]?.props.style as { minHeight?: number }).minHeight,
    ).toBe(44);
    expect(byId(tree, "competitor-brief-primary-action-a1")).toHaveLength(1);
    expect(byId(tree, "competitor-brief-secondary-action-a2")).toHaveLength(1);
    expect(byId(tree, "competitor-brief-sheet")[0]?.props.presentation).toBe(
      "competition",
    );
  });
});
