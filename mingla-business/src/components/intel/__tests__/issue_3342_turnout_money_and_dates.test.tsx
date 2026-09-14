/**
 * issue #3342 — the turnout forecast printed raw engine output: "362083 NGN",
 * "(~1290590 NGN)", "~2394 USD", "272 USD" and "2026-10-13".
 *
 * Found filming Scene 04 (2026-09-14) on the event wizard's Preview step. The
 * engine writes plain numbers, ISO codes and ISO dates into its sentences; the
 * app now shows them as "₦362,083", "~$2,394" and "Tue 13 Oct" (display only —
 * the engine and stored reports are unchanged).
 *
 * Mounts the REAL Preview-step card (TurnoutGateSection), the ambient card
 * (TurnoutForecastCardContent) and the full report (EventsReportSections) with
 * an engine-shaped report, and reads what they render.
 *
 * Fails on revert: drop the transform from any of the three surfaces (or from
 * the shared recommendation / driver builders) and the raw strings come back.
 */
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

import type { TurnoutReport } from "../../../types/growthTools";
import {
  formatTurnoutDate,
  formatTurnoutMoney,
  humanizeTurnoutCopy,
  turnoutReportCurrency,
} from "../../../utils/turnoutDisplayCopy";

// The engine's own sentence shapes (growth-tools-events computePaidPlan).
const nairaReport = (): TurnoutReport =>
  ({
    event: { date: "2026-10-13", currency: "NGN" },
    forecast: { total_low: 1200, total_high: 1800, capacity: 2000, confidence: "medium" },
    plan: {
      kind: "paid_optimized",
      currency: "NGN",
      recommended_budget: 362083,
      ad_revenue: 1290590,
      ad_profit: 928507,
      read: "Spend about 362083 NGN on ads to sell ~40–60 extra tickets (~1290590 NGN), netting ~928507 NGN after ad spend.",
      scenarios: [
        {
          label: "Recommended",
          budget: 362083,
          total_attendees: 1650,
          pct_capacity: 83,
          revenue: 1290590,
          profit: 928507,
          roas: 3.6,
          recommended: true,
        },
      ],
    },
    factors: [
      { key: "date", label: "Tuesday night", status: "hurt", detail: "2026-10-13 is a weeknight." },
    ],
    competitors: [{ name: "Lagos Jazz Night", platform: "Eventbrite", date_note: "Also on 2026-10-13" }],
    fixes: [
      {
        title: "Move to 2026-10-17",
        why: "Saturdays sell better",
        change: "Shift the date",
        lift_note: "+120 people",
      },
    ],
    narrative: "At 5000 NGN a ticket, demand is healthy.",
    meta: { research_source: "grounded", generated_at: "2026-09-14T10:00:00.000Z" },
  }) as unknown as TurnoutReport;

const RAW = [/\b\d{4,} ?(NGN|USD)\b/, /\b\d{4}-\d{2}-\d{2}\b/, /\bNGN\b/];

const mockIntel: Record<string, unknown> = {};
// The shared react-native manual mock has Animated but no Easing curves.
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native") as Record<string, unknown>;
  const identity = (t: number): number => t;
  return { ...actual, Easing: { out: () => identity, cubic: identity, quad: identity } };
});
jest.mock("../TurnoutIntelContext", () => ({
  useTurnoutIntel: () => mockIntel,
}));
jest.mock("../../ui/Button", () => ({
  Button: ({ label }: { label: string }) => React.createElement("Button", null, label),
}));
jest.mock("../IntelProgress", () => ({
  IntelProgress: () => React.createElement("Progress"),
  INTEL_RESULT_MIN_HEIGHT: 0,
}));
jest.mock("../IntelCard", () => ({
  IntelCard: ({ children }: { children: React.ReactNode }) =>
    React.createElement("IntelCard", null, children),
}));
jest.mock("../IntelDriverChip", () => ({
  IntelDriverChip: ({ label }: { label: string }) => React.createElement("Chip", null, label),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => React.createElement("Icon") }));
jest.mock("../../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));

// eslint-disable-next-line import/first
import { EventsReportSections } from "../EventsReportSections";
// eslint-disable-next-line import/first
import { TurnoutForecastCardContent } from "../TurnoutForecastCardContent";
// eslint-disable-next-line import/first
import { TurnoutGateSection } from "../TurnoutGateSection";

type Tree = { toJSON: () => unknown; unmount: () => void };
// The repository intentionally omits @types/react-test-renderer.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (work: () => void) => void;
  create: (node: React.ReactElement) => Tree;
};

/** Every text run the tree renders, one entry per <Text>. */
const texts = (node: unknown, out: string[] = []): string[] => {
  if (node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    node.forEach((child) => texts(child, out));
    return out;
  }
  const host = node as { children?: unknown[] | null };
  const children = host.children ?? [];
  const own = children
    .filter((child) => typeof child === "string" || typeof child === "number")
    .join("");
  if (own.length > 0) out.push(own);
  children.forEach((child) => texts(child, out));
  return out;
};

const mount = (node: React.ReactElement): { tree: Tree; shown: string[] } => {
  let tree: Tree | null = null;
  act(() => {
    tree = create(node);
  });
  if (tree === null) throw new Error("did not mount");
  return { tree, shown: texts((tree as Tree).toJSON()) };
};

const expectNoRawEngineOutput = (shown: string[]): void => {
  for (const pattern of RAW) {
    expect(shown.filter((line) => pattern.test(line))).toEqual([]);
  }
};

const setIntel = (report: TurnoutReport): void => {
  Object.assign(mockIntel, {
    state: "result",
    report,
    input: { currency: "NGN", ticket_price: 5000, date: "2026-10-13" },
    blockReason: null,
    wizard: "event",
    gateFailureCount: 0,
    updateFailureCount: 0,
    fresh: true,
    inputKey: "k",
    sessionHonesty: null,
    result: { runId: "r" },
    run: jest.fn(),
    navigateTo: jest.fn(),
    openReport: jest.fn(),
    gateAnalyticsProps: jest.fn(() => ({})),
  });
};

describe("#3342 turnout forecast money and dates", () => {
  const now = new Date(2026, 8, 14);
  afterEach(() => {
    for (const key of Object.keys(mockIntel)) delete mockIntel[key];
  });

  test("the display transform on the engine's own sentences", () => {
    expect(
      humanizeTurnoutCopy(
        "Spend about 362083 NGN on promo to sell ~40–60 extra tickets (~1290590 NGN), netting ~928507 NGN after promo spend.",
        "NGN",
        now,
      ),
    ).toBe(
      "Spend about ₦362,083 on promo to sell ~40–60 extra tickets (~₦1,290,590), netting ~₦928,507 after promo spend.",
    );
    expect(humanizeTurnoutCopy("(~2394 USD), netting ~272 USD", "USD", now)).toBe(
      "(~$2,394), netting ~$272",
    );
    expect(humanizeTurnoutCopy("Your 50 USD could bring more", "USD", now)).toBe(
      "Your $50 could bring more",
    );
    expect(humanizeTurnoutCopy("between 5000–10000 NGN", "NGN", now)).toBe(
      "between ₦5,000–₦10,000",
    );
    expect(humanizeTurnoutCopy("Move to 2026-10-13", null, now)).toBe("Move to Tue 13 Oct");
    expect(humanizeTurnoutCopy("Or 2027-01-12", null, now)).toBe("Or Tue 12 Jan 2027");
    // Left alone: other codes, invalid dates, a report with no currency.
    expect(humanizeTurnoutCopy("20 VIP seats, 2026-02-31", "NGN", now)).toBe(
      "20 VIP seats, 2026-02-31",
    );
    expect(humanizeTurnoutCopy("362083 NGN", null, now)).toBe("362083 NGN");
    expect(formatTurnoutMoney(0.5, "USD")).toBe("$0.50");
    expect(formatTurnoutMoney(362083, null)).toBe("362,083");
    expect(formatTurnoutDate("2026-09-14T10:00:00.000Z", now)).toMatch(/^Mon 14 Sept?$/);
    expect(turnoutReportCurrency(nairaReport())).toBe("NGN");
    expect(turnoutReportCurrency({} as TurnoutReport, "usd")).toBe("USD");
    expect(turnoutReportCurrency({} as TurnoutReport)).toBeNull();
  });

  test("Preview step card: the plan and the top fix read as money and a day", () => {
    setIntel(nairaReport());
    const { tree, shown } = mount(<TurnoutGateSection />);
    const all = shown.join("\n");
    expect(all).toContain("~₦1,290,590");
    expect(all).toContain("₦362,083");
    // Rendered against the real clock: the year is added only outside 2026.
    expect(all).toMatch(/Move to Sat 17 Oct( 2026)?/);
    expect(all).toContain("1,200–1,800 of 2,000");
    expectNoRawEngineOutput(shown);
    act(() => tree.unmount());
  });

  test("ambient card: the top fix and driver details are formatted", () => {
    setIntel(nairaReport());
    const { tree, shown } = mount(<TurnoutForecastCardContent surface={"event" as never} />);
    const all = shown.join("\n");
    expect(all).toMatch(/Move to Sat 17 Oct( 2026)?/);
    expectNoRawEngineOutput(shown);
    act(() => tree.unmount());
  });

  test("full forecast: every amount carries the currency, every date reads as a day", () => {
    const { tree, shown } = mount(<EventsReportSections report={nairaReport()} />);
    const all = shown.join("\n");
    expect(all).toContain("Recommended promo budget: ₦362,083");
    expect(all).toContain("Revenue ₦1,290,590");
    expect(all).toContain("Profit ₦928,507");
    expect(all).toContain("Budget ₦362,083 · 1,650 attendees");
    expect(all).toMatch(/Tue 13 Oct( 2026)? is a weeknight\./);
    expect(all).toContain("At ₦5,000 a ticket");
    expect(all).toMatch(/Generated \w{3} \d{1,2} \w{3,4}/);
    expectNoRawEngineOutput(shown);
    act(() => tree.unmount());
  });
});
