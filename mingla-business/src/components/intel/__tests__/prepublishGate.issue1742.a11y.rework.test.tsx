import React from "react";

import { PrePublishGateSheet } from "../PrePublishGateSheet";
import { TurnoutGateSection } from "../TurnoutGateSection";

type EstimateState =
  | { kind: "unanswered" }
  | { kind: "answered"; value: number }
  | { kind: "skipped" };

let estimate: EstimateState = { kind: "unanswered" };
let estimateApplied = false;
let blockReason: string | null = null;
let wizard: "event" | "experience" = "experience";

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
    factors: [],
    competitors: [{ name: "Other show" }],
    demand_read: "Demand is strongest after work.",
    meta: {
      generated_at: new Date().toISOString(),
      research_source: "grounded",
    },
  },
  input: {
    title: "Gallery preview",
    category: "Art",
    city: "Lagos",
    venue_name: "Art Roost",
    date: "2027-08-29",
    indoor_outdoor: "indoor",
    ticket_price: 25,
    capacity: 40,
    budget: 0,
    audience_size: null,
    lineup: null,
  },
  get estimate(): EstimateState {
    return estimate;
  },
  get estimateApplied(): boolean {
    return estimateApplied;
  },
  get blockReason(): string | null {
    return blockReason;
  },
  get wizard(): "event" | "experience" {
    return wizard;
  },
  gateFailureCount: 0,
  fresh: true,
  inputKey: "one",
  sessionHonesty: null,
  run: jest.fn(),
  setEstimate: jest.fn(),
  skipEstimate: jest.fn(),
  navigateTo: jest.fn(),
  openReport: jest.fn(),
  gateAnalyticsProps: jest.fn(() => ({ wizard, gate_state: "fresh" })),
};

jest.mock("../TurnoutIntelContext", () => ({
  useTurnoutIntel: () => mockIntel,
}));
jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? React.createElement("Sheet", null, children) : null,
}));
jest.mock("../../ui/Button", () => ({
  Button: ({ label, onPress }: { label: string; onPress: () => void }) =>
    React.createElement(
      "Button",
      {
        accessible: true,
        accessibilityRole: "button",
        accessibilityLabel: label,
        onPress,
      },
      label,
    ),
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

interface TestNode {
  props: Record<string, unknown>;
  findByProps: (props: Record<string, unknown>) => TestNode;
  findAllByType: (type: string) => TestNode[];
}

interface TestRenderer {
  root: TestNode;
  toJSON: () => unknown;
  unmount: () => void;
}

// The repository intentionally omits @types/react-test-renderer.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (work: () => void) => void;
  create: (node: React.ReactElement) => TestRenderer;
};

const render = (node: React.ReactElement): TestRenderer => {
  let renderer: TestRenderer | null = null;
  act(() => {
    renderer = create(node);
  });
  if (renderer === null) throw new Error("renderer did not mount");
  return renderer;
};

const textContent = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(textContent).join("");
  if (value !== null && typeof value === "object" && "children" in value) {
    return textContent((value as { children?: unknown }).children);
  }
  return "";
};

const expectSeparateRecommendationFocus = (
  renderer: TestRenderer,
  prefix: "experience-gate-reco" | "turnout-gate-reco",
): void => {
  const actionable = renderer.root.findByProps({ testID: `${prefix}-fix` });
  expect(actionable.props.accessible).not.toBe(true);
  expect(actionable.props.accessibilityLabel).toBeUndefined();
  const actionableCopy = renderer.root.findByProps({
    testID: `${prefix}-fix-copy`,
  });
  expect(actionableCopy.props).toMatchObject({
    accessible: true,
    accessibilityLabel: "Info: Move the start time",
  });
  expect(actionable.findAllByType("Button")).toHaveLength(1);
  expect(actionable.findAllByType("Button")[0].props).toMatchObject({
    accessible: true,
    accessibilityRole: "button",
    accessibilityLabel: "Review when",
  });

  const informational = renderer.root.findByProps({
    testID: `${prefix}-competitors`,
  });
  expect(informational.props.accessible).not.toBe(true);
  expect(informational.findAllByType("Button")).toHaveLength(0);
  expect(
    renderer.root.findByProps({ testID: `${prefix}-competitors-copy` }).props,
  ).toMatchObject({
    accessible: true,
    accessibilityLabel: "Info: 1 competing event that night",
  });
};

describe("#1742 demand truth and recommendation accessibility rework", () => {
  afterEach(() => {
    estimate = { kind: "unanswered" };
    estimateApplied = false;
    blockReason = null;
    wizard = "experience";
  });

  it("shows the exact estimate pill only for an answered unlimited demand read", () => {
    estimate = { kind: "answered", value: 50 };
    estimateApplied = true;
    const answered = render(
      <PrePublishGateSheet
        visible
        onClose={jest.fn()}
        onPublish={jest.fn()}
      />,
    );
    expect(textContent(answered.toJSON())).toContain(
      "MODELED · your estimate of ~50",
    );
    act(() => answered.unmount());

    blockReason = "unlimited_capacity";
    for (const state of [
      { kind: "unanswered" },
      { kind: "skipped" },
    ] as const) {
      estimate = state;
      const absent = render(
        <PrePublishGateSheet
          visible
          onClose={jest.fn()}
          onPublish={jest.fn()}
        />,
      );
      expect(textContent(absent.toJSON())).not.toContain(
        "MODELED · your estimate of",
      );
      act(() => absent.unmount());
    }
  });

  it("keeps Experience recommendation copy and buttons as separate focus stops", () => {
    estimate = { kind: "answered", value: 50 };
    estimateApplied = true;
    const renderer = render(
      <PrePublishGateSheet
        visible
        onClose={jest.fn()}
        onPublish={jest.fn()}
      />,
    );
    expectSeparateRecommendationFocus(renderer, "experience-gate-reco");
  });

  it("keeps Event/RSVP recommendation copy and buttons as separate focus stops", () => {
    wizard = "event";
    const renderer = render(<TurnoutGateSection />);
    expectSeparateRecommendationFocus(renderer, "turnout-gate-reco");
    expect(textContent(renderer.toJSON())).toContain(
      "Modeled band — not a promise.",
    );
  });
});
