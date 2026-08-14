import React from "react";
import { PrePublishGateSheet } from "../PrePublishGateSheet";
import { TurnoutGateSection } from "../TurnoutGateSection";

const mockRun = jest.fn();
const mockIntel = {
  state: "result",
  report: {
    forecast: {
      total_low: 24,
      total_high: 36,
      capacity: 40,
      confidence: "medium",
    },
    fixes: [
      {
        title: "Move the start time",
        why: "The current time suppresses demand",
        change: "Start one hour later",
      },
    ],
    factors: [
      {
        key: "timing",
        label: "Early start",
        status: "hurt",
        detail: "Guests are less likely to arrive this early",
      },
    ],
    competitors: [],
    demand_read: "Demand is strongest after work.",
    meta: {
      generated_at: new Date().toISOString(),
      research_source: "grounded",
    },
  },
  blockReason: null,
  gateFailureCount: 0,
  run: mockRun,
  navigateTo: jest.fn(),
  openReport: jest.fn(),
};

jest.mock("../TurnoutIntelContext", () => ({
  useTurnoutIntel: () => mockIntel,
}));
jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? React.createElement("Sheet", null, children) : null,
}));
jest.mock("../../ui/Button", () => ({
  Button: ({ label }: { label: string }) => React.createElement("Button", null, label),
}));
jest.mock("../IntelProgress", () => ({
  IntelProgress: () => React.createElement("Progress"),
}));
jest.mock("../IntelCard", () => ({
  IntelCard: ({ children }: { children: React.ReactNode }) =>
    React.createElement("IntelCard", null, children),
}));
jest.mock("../../ui/Icon", () => ({
  Icon: () => React.createElement("Icon"),
}));
jest.mock("../../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));

// The repository intentionally omits @types/react-test-renderer.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (work: () => void) => void;
  create: (node: React.ReactElement) => { toJSON: () => unknown };
};

describe("#1742 independent pre-publish gate adversary", () => {
  afterEach(() => {
    mockIntel.state = "result";
    mockIntel.gateFailureCount = 0;
  });

  it("keeps a finite-capacity Experience in fill-band mode with actionable truth", () => {
    const holder: { instance: { toJSON: () => unknown } | null } = {
      instance: null,
    };
    act(() => {
      holder.instance = create(
        <PrePublishGateSheet
          visible
          onClose={jest.fn()}
          onPublish={jest.fn()}
          onEstimate={jest.fn()}
          estimate={null}
        />,
      );
    });
    const rendered = JSON.stringify(holder.instance?.toJSON() ?? null);
    expect(rendered).toContain("24–36 of 40");
    expect(rendered).not.toContain("~24–36 people expected");
    expect(rendered).toContain("Move the start time");
    expect(rendered).toContain("Early start");
    expect(rendered).toContain("medium");
  });

  it("renders the complete Event/RSVP verdict truth before recommendations", () => {
    const holder: { instance: { toJSON: () => unknown } | null } = {
      instance: null,
    };
    act(() => {
      holder.instance = create(<TurnoutGateSection />);
    });
    const rendered = JSON.stringify(holder.instance?.toJSON() ?? null);
    expect(rendered).toContain("24–36 of 40");
    expect(rendered).toContain("medium");
    expect(rendered).toContain("Checked");
    expect(rendered).toContain("MODELED");
    expect(rendered).toContain("Move the start time");
  });

  it("removes every retry route after the second gate failure", () => {
    mockIntel.state = "error-hidden";
    mockIntel.gateFailureCount = 2;
    const holder: { instance: { toJSON: () => unknown } | null } = {
      instance: null,
    };
    act(() => {
      holder.instance = create(
        <PrePublishGateSheet
          visible
          onClose={jest.fn()}
          onPublish={jest.fn()}
          onEstimate={jest.fn()}
          estimate={null}
        />,
      );
    });
    const rendered = JSON.stringify(holder.instance?.toJSON() ?? null);
    expect(rendered).toContain("you can publish anyway");
    expect(rendered).toContain("Publish now");
    expect(rendered).not.toContain("Try again");
    expect(rendered).not.toContain("Check first");
  });
});
